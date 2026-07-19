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
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
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
}
