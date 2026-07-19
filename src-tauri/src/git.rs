use std::process::Command;

#[derive(serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: String,
    pub orig_path: Option<String>,
    pub x: String,
    pub y: String,
    pub staged: bool,
    pub unstaged: bool,
}

#[derive(serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub repo: bool,
    pub toplevel: String,
    pub branch: String,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub files: Vec<FileEntry>,
}

// Run `git -C <dir> <args...>`; stdout on success, stderr string on failure.
fn git_out(dir: &str, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

// Parse one `1 `/`2 ` porcelain-v2 body: "XY sub mH mI mW hH hI [Xscore] path[\torig]".
// ponytail: assumes no tabs/newlines in filenames (git v2 leaves them unquoted only
// for plain names) — the 99% case. Weird names would mis-split; add core.quotePath
// handling if that ever bites.
fn parse_ordinary(rest: &str, renamed: bool) -> Option<FileEntry> {
    let fixed = if renamed { 8 } else { 7 }; // fields before the path
    let mut it = rest.splitn(fixed + 1, ' ');
    let xy = it.next()?;
    for _ in 1..fixed {
        it.next()?;
    }
    let pathfield = it.next()?;
    let x = xy.get(0..1).unwrap_or(".");
    let y = xy.get(1..2).unwrap_or(".");
    let (path, orig_path) = if renamed {
        let mut p = pathfield.splitn(2, '\t');
        (p.next().unwrap_or("").to_string(), p.next().map(str::to_string))
    } else {
        (pathfield.to_string(), None)
    };
    Some(FileEntry {
        path,
        orig_path,
        x: x.to_string(),
        y: y.to_string(),
        staged: x != ".",
        unstaged: y != ".",
    })
}

fn parse_status(out: &str) -> GitStatus {
    let mut s = GitStatus { repo: true, ..Default::default() };
    for line in out.lines() {
        if let Some(rest) = line.strip_prefix("# branch.head ") {
            s.branch = rest.to_string();
        } else if let Some(rest) = line.strip_prefix("# branch.upstream ") {
            s.upstream = Some(rest.to_string());
        } else if let Some(rest) = line.strip_prefix("# branch.ab ") {
            for tok in rest.split_whitespace() {
                if let Some(a) = tok.strip_prefix('+') {
                    s.ahead = a.parse().unwrap_or(0);
                } else if let Some(b) = tok.strip_prefix('-') {
                    s.behind = b.parse().unwrap_or(0);
                }
            }
        } else if let Some(rest) = line.strip_prefix("1 ") {
            if let Some(f) = parse_ordinary(rest, false) {
                s.files.push(f);
            }
        } else if let Some(rest) = line.strip_prefix("2 ") {
            if let Some(f) = parse_ordinary(rest, true) {
                s.files.push(f);
            }
        } else if let Some(rest) = line.strip_prefix("? ") {
            s.files.push(FileEntry {
                path: rest.to_string(),
                x: "?".into(),
                y: "?".into(),
                unstaged: true,
                ..Default::default()
            });
        }
    }
    s
}

#[tauri::command]
pub fn git_status(root: String) -> Result<GitStatus, String> {
    let toplevel = match git_out(&root, &["rev-parse", "--show-toplevel"]) {
        Ok(t) => t.trim().to_string(),
        Err(_) => return Ok(GitStatus { repo: false, ..Default::default() }),
    };
    let out = git_out(&toplevel, &["status", "--porcelain=v2", "--branch"])?;
    let mut s = parse_status(&out);
    s.toplevel = toplevel;
    Ok(s)
}

#[tauri::command]
pub fn git_diff(root: String, path: String, staged: bool) -> Result<String, String> {
    let mut args: Vec<&str> = vec!["diff"];
    if staged {
        args.push("--cached");
    }
    args.push("--");
    args.push(&path);
    let d = git_out(&root, &args)?;
    if !d.trim().is_empty() {
        return Ok(d);
    }
    // Untracked file: `git diff` shows nothing — diff it against /dev/null.
    // --no-index exits 1 when files differ, so read stdout directly regardless of status.
    let out = Command::new("git")
        .arg("-C")
        .arg(&root)
        .args(["diff", "--no-index", "--", "/dev/null", &path])
        .output()
        .map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&out.stdout).to_string();
    // Empty stdout AND a failure is a real error (file deleted since the status poll,
    // unreadable, no git) — not "no changes". Surface it instead of painting a blank
    // pane that looks identical to a clean file.
    if text.is_empty() && !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(text)
}

#[tauri::command]
pub fn git_show(root: String, hash: String) -> Result<String, String> {
    git_out(&root, &["show", &hash])
}

#[tauri::command]
pub fn git_stage(root: String, path: String) -> Result<(), String> {
    git_out(&root, &["add", "--", &path]).map(|_| ())
}

#[tauri::command]
pub fn git_unstage(root: String, path: String) -> Result<(), String> {
    // `reset` works even before the first commit (unlike `restore --staged`).
    git_out(&root, &["reset", "-q", "--", &path]).map(|_| ())
}

#[tauri::command]
pub fn git_commit(root: String, message: String) -> Result<String, String> {
    git_out(&root, &["commit", "-m", &message])
}

// Remote ops (push/fetch/pull) share this: GIT_TERMINAL_PROMPT=0 so a credential
// prompt fails fast instead of hanging the app, and git writes progress to stderr
// even on success — so fold stderr into the ok message too.
fn git_remote(root: &str, op: &str) -> Result<String, String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(root)
        .arg(op)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| e.to_string())?;
    let so = String::from_utf8_lossy(&out.stdout);
    let se = String::from_utf8_lossy(&out.stderr);
    if out.status.success() {
        Ok(format!("{so}{se}").trim().to_string())
    } else {
        Err(se.trim().to_string())
    }
}

#[tauri::command]
pub fn git_push(root: String) -> Result<String, String> {
    git_remote(&root, "push")
}

#[tauri::command]
pub fn git_fetch(root: String) -> Result<String, String> {
    git_remote(&root, "fetch")
}

#[tauri::command]
pub fn git_pull(root: String) -> Result<String, String> {
    git_remote(&root, "pull")
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRef {
    pub name: String,
    pub kind: String, // "head" | "branch" | "remote" | "tag"
}

// Classify one `--decorate=full` ref token (e.g. "HEAD -> refs/heads/main",
// "tag: refs/tags/v1", "refs/remotes/origin/main"). Returns None to drop noise
// (bare detached HEAD, the origin/HEAD symbolic pointer).
fn classify_ref(raw: &str) -> Option<GitRef> {
    let (is_head, r) = match raw.strip_prefix("HEAD -> ") {
        Some(rest) => (true, rest),
        None => (false, raw),
    };
    if r == "HEAD" {
        return None; // detached-HEAD marker; the commit is already selected in the UI
    }
    if let Some(t) = r.strip_prefix("tag: refs/tags/") {
        return Some(GitRef { name: t.into(), kind: "tag".into() });
    }
    if let Some(b) = r.strip_prefix("refs/heads/") {
        let kind = if is_head { "head" } else { "branch" };
        return Some(GitRef { name: b.into(), kind: kind.into() });
    }
    if let Some(rem) = r.strip_prefix("refs/remotes/") {
        if rem.ends_with("/HEAD") {
            return None; // origin/HEAD symbolic ref → noise
        }
        return Some(GitRef { name: rem.into(), kind: "remote".into() });
    }
    Some(GitRef { name: r.into(), kind: "branch".into() })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub hash: String,
    pub parents: Vec<String>,
    pub refs: Vec<GitRef>,
    pub author: String,
    pub rel_date: String,
    pub subject: String,
}

#[derive(serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub path: String,
    pub branch: String,
    pub head: String,
    pub detached: bool,
    pub bare: bool,
    pub dirty: u32,
    pub ahead: u32,
    pub behind: u32,
}

fn parse_log(out: &str) -> Vec<Commit> {
    let mut v = Vec::new();
    for rec in out.split('\u{1e}') {
        let rec = rec.trim_matches(|c| c == '\n' || c == '\r');
        if rec.is_empty() {
            continue;
        }
        let f: Vec<&str> = rec.split('\u{1f}').collect();
        if f.len() < 6 {
            continue;
        }
        let parents = f[1].split_whitespace().map(str::to_string).collect();
        let refs = f[2]
            .split(", ")
            .filter(|s| !s.is_empty())
            .filter_map(classify_ref)
            .collect();
        v.push(Commit {
            hash: f[0].to_string(),
            parents,
            refs,
            author: f[3].to_string(),
            rel_date: f[4].to_string(),
            subject: f[5].to_string(),
        });
    }
    v
}

fn parse_worktrees(out: &str) -> Vec<Worktree> {
    let mut v = Vec::new();
    let mut cur: Option<Worktree> = None;
    for line in out.lines() {
        if let Some(p) = line.strip_prefix("worktree ") {
            if let Some(w) = cur.take() {
                v.push(w);
            }
            cur = Some(Worktree { path: p.to_string(), ..Default::default() });
        } else if let Some(h) = line.strip_prefix("HEAD ") {
            if let Some(w) = cur.as_mut() {
                w.head = h.to_string();
            }
        } else if let Some(b) = line.strip_prefix("branch ") {
            if let Some(w) = cur.as_mut() {
                w.branch = b.trim_start_matches("refs/heads/").to_string();
            }
        } else if line == "detached" {
            if let Some(w) = cur.as_mut() {
                w.detached = true;
            }
        } else if line == "bare" {
            if let Some(w) = cur.as_mut() {
                w.bare = true;
            }
        }
    }
    if let Some(w) = cur.take() {
        v.push(w);
    }
    v
}

#[tauri::command]
pub fn git_log_graph(root: String, limit: Option<u32>) -> Result<Vec<Commit>, String> {
    // None => full history (the frontend virtualizes the list, so the whole graph is cheap to
    // hold and only the visible window renders). Some(n) still caps for any bounded caller.
    let fmt = "--pretty=format:%H%x1f%P%x1f%D%x1f%an%x1f%ar%x1f%s%x1e";
    let mut args = vec!["log", "--all", "--date-order", "--decorate=full", fmt];
    let n = limit.map(|l| format!("-n{l}"));
    if let Some(s) = &n {
        args.push(s);
    }
    let out = git_out(&root, &args)?;
    Ok(parse_log(&out))
}

// Fingerprint of every ref's oid — the exact input set of `git log --all`. Cheap (~ms even on
// huge repos) so the poll can run it every tick and only refetch the graph when refs actually
// moved. ponytail: a detached HEAD not pointing at any ref won't register (rare in tt — worktrees
// live on branches); add `rev-parse HEAD` to the sig if that ever matters.
#[tauri::command]
pub fn git_refs_sig(root: String) -> Result<String, String> {
    git_out(&root, &["for-each-ref", "--format=%(objectname) %(refname)"])
}

// Write/refresh the commit-graph — git's own traversal cache. Without it, `git log` on a deep
// history reads every commit object from the pack (~0.5s at 50k commits); with it that drops
// ~17x to ~0.03s. `--split` makes re-writes incremental (new commits only, ~10ms). Non-destructive
// (git writes the same file during gc/fetch); fire-and-forget on open so it never blocks the UI.
#[tauri::command]
pub fn git_ensure_graph(root: String) -> Result<(), String> {
    git_out(&root, &["commit-graph", "write", "--reachable", "--split"]).map(|_| ())
}

#[tauri::command]
pub fn git_worktrees(root: String) -> Result<Vec<Worktree>, String> {
    let out = git_out(&root, &["worktree", "list", "--porcelain"])?;
    let mut wts = parse_worktrees(&out);
    for w in wts.iter_mut() {
        if w.bare {
            continue;
        }
        if let Ok(s) = git_out(&w.path, &["status", "--porcelain"]) {
            w.dirty = s.lines().filter(|l| !l.is_empty()).count() as u32;
        }
        // `@{u}...HEAD` left-right count = "<behind> <ahead>" (left=upstream-only, right=HEAD-only).
        if let Ok(ab) = git_out(&w.path, &["rev-list", "--left-right", "--count", "@{u}...HEAD"]) {
            let mut it = ab.split_whitespace();
            w.behind = it.next().and_then(|s| s.parse().ok()).unwrap_or(0);
            w.ahead = it.next().and_then(|s| s.parse().ok()).unwrap_or(0);
        }
    }
    Ok(wts)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    pub name: String,       // "main" or "origin/main"
    pub kind: String,       // "local" | "remote"
    pub current: bool,
    pub upstream: Option<String>,
}

// One-shot list of local + remote branches via for-each-ref (no per-ref shell-outs).
#[tauri::command]
pub fn git_branches(root: String) -> Result<Vec<Branch>, String> {
    let fmt = "%(refname)%09%(HEAD)%09%(upstream:short)";
    let out = git_out(
        &root,
        &["for-each-ref", "--format", fmt, "refs/heads", "refs/remotes"],
    )?;
    let mut v = Vec::new();
    for line in out.lines() {
        let mut f = line.splitn(3, '\t');
        let refname = f.next().unwrap_or("");
        let head = f.next().unwrap_or("");
        let upstream = f.next().unwrap_or("");
        if let Some(name) = refname.strip_prefix("refs/heads/") {
            v.push(Branch {
                name: name.into(),
                kind: "local".into(),
                current: head == "*",
                upstream: if upstream.is_empty() { None } else { Some(upstream.into()) },
            });
        } else if let Some(name) = refname.strip_prefix("refs/remotes/") {
            if name.ends_with("/HEAD") {
                continue; // origin/HEAD symbolic ref → noise
            }
            v.push(Branch {
                name: name.into(),
                kind: "remote".into(),
                current: false,
                upstream: None,
            });
        }
    }
    Ok(v)
}

// Checkout local branch by name, or a remote (creates a tracking local branch of the same short name).
#[tauri::command]
pub fn git_checkout(root: String, name: String) -> Result<String, String> {
    // If `name` looks like "origin/foo" and no local "foo" exists, `git checkout foo` DWIM auto-tracks it.
    let short = name.split_once('/').map(|x| x.1).unwrap_or(&name);
    let local_exists = git_out(&root, &["show-ref", "--verify", "--quiet", &format!("refs/heads/{short}")]).is_ok();
    let target: &str = if local_exists || !name.contains('/') { &name } else { short };
    git_out(&root, &["checkout", target])
}

#[tauri::command]
pub fn git_branch_create(root: String, name: String, checkout: bool, from: Option<String>) -> Result<(), String> {
    let base = from.unwrap_or_default();
    let mut args: Vec<&str> = if checkout { vec!["checkout", "-b", &name] } else { vec!["branch", &name] };
    if !base.is_empty() { args.push(&base); }
    git_out(&root, &args).map(|_| ())
}

#[tauri::command]
pub fn git_branch_rename(root: String, old: String, new: String) -> Result<(), String> {
    git_out(&root, &["branch", "-m", &old, &new]).map(|_| ())
}

#[tauri::command]
pub fn git_branch_delete(root: String, name: String, force: bool) -> Result<(), String> {
    let flag = if force { "-D" } else { "-d" };
    git_out(&root, &["branch", flag, &name]).map(|_| ())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stash {
    pub index: u32,   // 0 = stash@{0}
    pub name: String, // "stash@{0}"
    pub subject: String,
    pub branch: String,
}

#[tauri::command]
pub fn git_stash_list(root: String) -> Result<Vec<Stash>, String> {
    // %gd = ref name (stash@{N}), %gs = reflog subject ("WIP on main: ...")
    let out = git_out(&root, &["stash", "list", "--format=%gd%x1f%gs"])?;
    let mut v = Vec::new();
    for (i, line) in out.lines().enumerate() {
        let mut f = line.splitn(2, '\u{1f}');
        let name = f.next().unwrap_or("").to_string();
        let subj = f.next().unwrap_or("").to_string();
        // "WIP on main: <hash> <subject>" or "On main: <msg>"
        let branch = subj
            .strip_prefix("WIP on ").or_else(|| subj.strip_prefix("On "))
            .and_then(|s| s.split_once(':').map(|x| x.0.to_string()))
            .unwrap_or_default();
        v.push(Stash { index: i as u32, name, subject: subj, branch });
    }
    Ok(v)
}

#[tauri::command]
pub fn git_stash_save(root: String, message: String, include_untracked: bool) -> Result<String, String> {
    let msg = message.trim();
    let mut args: Vec<&str> = vec!["stash", "push"];
    if include_untracked { args.push("-u"); }
    if !msg.is_empty() { args.push("-m"); args.push(msg); }
    git_out(&root, &args)
}

#[tauri::command]
pub fn git_stash_apply(root: String, name: String) -> Result<String, String> {
    git_out(&root, &["stash", "apply", &name])
}

#[tauri::command]
pub fn git_stash_pop(root: String, name: String) -> Result<String, String> {
    git_out(&root, &["stash", "pop", &name])
}

#[tauri::command]
pub fn git_stash_drop(root: String, name: String) -> Result<(), String> {
    git_out(&root, &["stash", "drop", &name]).map(|_| ())
}

// Discard working-tree changes for a single path. Untracked → delete the file; tracked → restore from HEAD.
#[tauri::command]
pub fn git_discard(root: String, path: String) -> Result<(), String> {
    // ls-files --error-unmatch exits non-zero for untracked paths — cheapest tracked check.
    let tracked = git_out(&root, &["ls-files", "--error-unmatch", "--", &path]).is_ok();
    if tracked {
        // Undo both staged AND unstaged: `restore --staged --worktree` in one shot.
        git_out(&root, &["restore", "--staged", "--worktree", "--", &path]).map(|_| ())
    } else {
        // Untracked: `clean -f` respects .gitignore-safety and only removes the given path.
        git_out(&root, &["clean", "-f", "--", &path]).map(|_| ())
    }
}

// ── commit context-menu actions (checkout/branch-here reuse git_checkout/git_branch_create) ──

// Cherry-pick a commit onto HEAD. On conflict git stops mid-pick and exits non-zero;
// the stderr surfaces as a toast and the conflicted files show up in status.
#[tauri::command]
pub fn git_cherry_pick(root: String, hash: String) -> Result<String, String> {
    git_out(&root, &["cherry-pick", &hash])
}

// Revert a commit as a new commit. --no-edit so it never blocks on $EDITOR (there's no
// terminal — an editor prompt would hang the subprocess).
#[tauri::command]
pub fn git_revert(root: String, hash: String) -> Result<String, String> {
    git_out(&root, &["revert", "--no-edit", &hash])
}

// Move the current branch to `hash`. mode is validated here — anything but the three
// known values is rejected rather than passed to git as an arbitrary flag.
#[tauri::command]
pub fn git_reset(root: String, hash: String, mode: String) -> Result<String, String> {
    let flag = match mode.as_str() {
        "soft" => "--soft",
        "mixed" => "--mixed",
        "hard" => "--hard",
        _ => return Err(format!("bad reset mode: {mode}")),
    };
    git_out(&root, &["reset", flag, &hash])
}

// Lightweight tag at `hash`.
#[tauri::command]
pub fn git_tag_create(root: String, name: String, hash: String) -> Result<(), String> {
    git_out(&root, &["tag", &name, &hash]).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_status_reads_branch_and_files() {
        let out = "\
# branch.oid abc123
# branch.head main
# branch.upstream origin/main
# branch.ab +2 -1
1 .M N... 100644 100644 100644 aaa bbb src/main.ts
1 M. N... 100644 100644 100644 aaa bbb src/foo.ts
1 MM N... 100644 100644 100644 aaa bbb src/bar.ts
2 R. N... 100644 100644 100644 aaa bbb R100 new.ts\told.ts
? untracked.txt
";
        let s = parse_status(out);
        assert!(s.repo);
        assert_eq!(s.branch, "main");
        assert_eq!(s.upstream.as_deref(), Some("origin/main"));
        assert_eq!(s.ahead, 2);
        assert_eq!(s.behind, 1);
        assert_eq!(s.files.len(), 5);

        let main = s.files.iter().find(|f| f.path == "src/main.ts").unwrap();
        assert!(main.unstaged && !main.staged && main.y == "M");

        let foo = s.files.iter().find(|f| f.path == "src/foo.ts").unwrap();
        assert!(foo.staged && !foo.unstaged && foo.x == "M");

        let bar = s.files.iter().find(|f| f.path == "src/bar.ts").unwrap();
        assert!(bar.staged && bar.unstaged);

        let rn = s.files.iter().find(|f| f.path == "new.ts").unwrap();
        assert!(rn.staged);
        assert_eq!(rn.orig_path.as_deref(), Some("old.ts"));

        let un = s.files.iter().find(|f| f.path == "untracked.txt").unwrap();
        assert!(un.unstaged && un.y == "?");
    }

    #[test]
    fn stage_status_commit_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_string_lossy().to_string();
        let run = |args: &[&str]| {
            Command::new("git").arg("-C").arg(&dir).args(args).output().unwrap();
        };
        run(&["init", "-q"]);
        run(&["config", "user.email", "t@t"]);
        run(&["config", "user.name", "t"]);
        std::fs::write(tmp.path().join("a.txt"), "hi\n").unwrap();

        // untracked shows up
        let s = git_status(dir.clone()).unwrap();
        assert!(s.repo);
        assert!(s.files.iter().any(|f| f.path == "a.txt" && f.y == "?"));

        // stage -> file is staged
        git_stage(dir.clone(), "a.txt".into()).unwrap();
        assert!(git_status(dir.clone()).unwrap().files.iter().any(|f| f.path == "a.txt" && f.staged));

        // diff --cached shows the addition
        let d = git_diff(dir.clone(), "a.txt".into(), true).unwrap();
        assert!(d.contains("+hi"));

        // commit -> tree clean
        git_commit(dir.clone(), "init".into()).unwrap();
        assert!(git_status(dir.clone()).unwrap().files.is_empty());
    }

    #[test]
    fn parse_log_splits_records_and_refs() {
        // fields joined by \x1f, records terminated by \x1e; refs in --decorate=full form
        let out = "h1\u{1f}p1 p2\u{1f}HEAD -> refs/heads/main, refs/remotes/origin/main, refs/remotes/origin/HEAD, tag: refs/tags/v1\u{1f}Ann\u{1f}2h ago\u{1f}subject one\u{1e}\
h2\u{1f}\u{1f}\u{1f}Bob\u{1f}3h ago\u{1f}root commit\u{1e}";
        let v = parse_log(out);
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].hash, "h1");
        assert_eq!(v[0].parents, vec!["p1", "p2"]);
        // origin/HEAD is dropped as noise; the rest classified by kind
        let refs: Vec<(&str, &str)> = v[0].refs.iter().map(|r| (r.name.as_str(), r.kind.as_str())).collect();
        assert_eq!(refs, vec![("main", "head"), ("origin/main", "remote"), ("v1", "tag")]);
        assert_eq!(v[0].subject, "subject one");
        assert!(v[1].parents.is_empty());
        assert!(v[1].refs.is_empty());
    }

    #[test]
    fn branches_stash_discard_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_string_lossy().to_string();
        let run = |args: &[&str]| { Command::new("git").arg("-C").arg(&dir).args(args).output().unwrap(); };
        run(&["init", "-q", "-b", "main"]);
        run(&["config", "user.email", "t@t"]);
        run(&["config", "user.name", "t"]);
        std::fs::write(tmp.path().join("a.txt"), "hi\n").unwrap();
        git_stage(dir.clone(), "a.txt".into()).unwrap();
        git_commit(dir.clone(), "init".into()).unwrap();

        // branches: create + checkout + list + rename + delete
        git_branch_create(dir.clone(), "feat".into(), true, None).unwrap();
        let bs = git_branches(dir.clone()).unwrap();
        let feat = bs.iter().find(|b| b.name == "feat").unwrap();
        assert!(feat.current && feat.kind == "local");
        assert!(bs.iter().any(|b| b.name == "main" && !b.current));
        git_checkout(dir.clone(), "main".into()).unwrap();
        git_branch_rename(dir.clone(), "feat".into(), "feature".into()).unwrap();
        assert!(git_branches(dir.clone()).unwrap().iter().any(|b| b.name == "feature"));
        git_branch_delete(dir.clone(), "feature".into(), false).unwrap();
        assert!(!git_branches(dir.clone()).unwrap().iter().any(|b| b.name == "feature"));

        // stash: save → list → pop
        std::fs::write(tmp.path().join("a.txt"), "changed\n").unwrap();
        git_stash_save(dir.clone(), "wip".into(), false).unwrap();
        let sl = git_stash_list(dir.clone()).unwrap();
        assert_eq!(sl.len(), 1);
        assert_eq!(sl[0].name, "stash@{0}");
        assert_eq!(sl[0].branch, "main");
        git_stash_pop(dir.clone(), "stash@{0}".into()).unwrap();
        assert!(git_stash_list(dir.clone()).unwrap().is_empty());
        assert!(git_status(dir.clone()).unwrap().files.iter().any(|f| f.path == "a.txt"));

        // discard: tracked change reverts, untracked file removed
        git_discard(dir.clone(), "a.txt".into()).unwrap();
        assert!(git_status(dir.clone()).unwrap().files.is_empty());
        std::fs::write(tmp.path().join("junk.txt"), "x").unwrap();
        git_discard(dir.clone(), "junk.txt".into()).unwrap();
        assert!(!tmp.path().join("junk.txt").exists());
    }

    #[test]
    fn parse_worktrees_reads_blocks() {
        let out = "\
worktree /a/main
HEAD abc
branch refs/heads/main

worktree /a/feat
HEAD def
detached

worktree /a/bare
bare
";
        let v = parse_worktrees(out);
        assert_eq!(v.len(), 3);
        assert_eq!(v[0].path, "/a/main");
        assert_eq!(v[0].branch, "main");
        assert_eq!(v[0].head, "abc");
        assert!(v[1].detached);
        assert!(v[2].bare);
    }

    #[test]
    fn revert_tag_reset_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_string_lossy().to_string();
        let run = |args: &[&str]| { Command::new("git").arg("-C").arg(&dir).args(args).output().unwrap(); };
        run(&["init", "-q", "-b", "main"]);
        run(&["config", "user.email", "t@t"]);
        run(&["config", "user.name", "t"]);
        let commit = |content: &str, msg: &str| {
            std::fs::write(tmp.path().join("a.txt"), content).unwrap();
            git_stage(dir.clone(), "a.txt".into()).unwrap();
            git_commit(dir.clone(), msg.into()).unwrap();
        };
        commit("1\n", "c1");
        commit("2\n", "c2");

        // tag at HEAD → it lists
        git_tag_create(dir.clone(), "v2".into(), "HEAD".into()).unwrap();
        assert!(git_out(&dir, &["tag", "-l"]).unwrap().contains("v2"));

        // revert the last commit → content rolls back to "1", history grows
        git_revert(dir.clone(), "HEAD".into()).unwrap();
        assert_eq!(std::fs::read_to_string(tmp.path().join("a.txt")).unwrap(), "1\n");

        // bad reset mode is rejected before git runs
        assert!(git_reset(dir.clone(), "HEAD".into(), "bogus".into()).is_err());

        // hard reset back one commit discards the revert, restoring "2"
        git_reset(dir.clone(), "HEAD~1".into(), "hard".into()).unwrap();
        assert_eq!(std::fs::read_to_string(tmp.path().join("a.txt")).unwrap(), "2\n");
    }
}
