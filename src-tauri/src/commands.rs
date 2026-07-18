use crate::{claude_watch, pty::PtySession, registry};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct AppState {
    // Arc so a command can clone a handle out and drop the map lock before a
    // blocking PTY op — one stuck child must not freeze every other agent.
    agents: Mutex<HashMap<String, Arc<PtySession>>>,
    counter: AtomicU64,
    // JSON snapshot of the frontend's agent list, for the MCP list_agents tool.
    pub mcp_agents: Mutex<String>,
    // JSON snapshot of the active project's task list, for the MCP task tools.
    pub mcp_tasks: Mutex<String>,
}

#[derive(Clone, serde::Serialize)]
struct OutputPayload {
    id: String,
    data: Vec<u8>,
}

#[derive(Clone, serde::Serialize)]
struct ExitPayload {
    id: String,
}

#[derive(Clone, serde::Serialize)]
struct ClaudePayload {
    id: String,
    title: Option<String>,
    tokens: u64,
}

fn claude_projects_root() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    std::path::Path::new(&home).join(".claude/projects")
}

// Expand a leading `~`/`~/` to $HOME and drop trailing slashes: the PTY cwd is
// used literally (no shell expands it) and the claude-watch slug must match the
// on-disk project dir exactly (a trailing `/` would break the match).
fn expand_dir(dir: &str) -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    let expanded = if dir == "~" {
        home
    } else if let Some(rest) = dir.strip_prefix("~/") {
        format!("{home}/{rest}")
    } else {
        dir.to_string()
    };
    let trimmed = expanded.trim_end_matches('/');
    if trimmed.is_empty() {
        "/".to_string()
    } else {
        trimmed.to_string()
    }
}

fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

fn tmux_available() -> bool {
    use std::sync::OnceLock;
    static AVAIL: OnceLock<bool> = OnceLock::new();
    *AVAIL.get_or_init(|| {
        std::process::Command::new("tmux")
            .arg("-V")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    })
}

fn get_session(state: &State<AppState>, id: &str) -> Result<Arc<PtySession>, String> {
    state
        .agents
        .lock()
        .map_err(|e| e.to_string())?
        .get(id)
        .cloned()
        .ok_or_else(|| format!("no agent: {id}"))
}

#[tauri::command]
pub fn spawn_agent(
    app: AppHandle,
    state: State<AppState>,
    project_dir: String,
    agent_id: String,
    perm_mode: Option<String>,
    session_key: String,
) -> Result<String, String> {
    let cmd =
        registry::command_for(&agent_id).ok_or_else(|| format!("unknown agent: {agent_id}"))?;
    let project_dir = expand_dir(&project_dir);

    let n = state.counter.fetch_add(1, Ordering::Relaxed);
    let id = format!("{agent_id}-{n}");

    let mut args = cmd.args;
    if agent_id == "claude" {
        if let Some(mode) = perm_mode {
            if let Some(i) = args.iter().position(|a| a == "--permission-mode") {
                if i + 1 < args.len() {
                    args[i + 1] = mode;
                }
            }
        }
        // Stable session id (from session_key) so the jsonl watcher still points at
        // the right file after a reattach.
        args.push("--session-id".to_string());
        args.push(session_key.clone());
    }

    // Run inside tmux (if available) so the session survives tt closing and can be
    // reattached on restart. status bar off so tiles have no green tmux bar.
    let tmux_name = if tmux_available() {
        Some(format!("tt-{session_key}"))
    } else {
        None
    };
    let (program, spawn_args): (String, Vec<String>) = if let Some(ref name) = tmux_name {
        let cmdq = std::iter::once(cmd.program.clone())
            .chain(args.iter().cloned())
            .map(|a| sh_quote(&a))
            .collect::<Vec<_>>()
            .join(" ");
        // unset TMUX so we never nest inside the tmux tt itself was launched from
        // (nested attach garbles the tile); our sessions live on the default server.
        let full = format!(
            "unset TMUX; tmux has-session -t {name} 2>/dev/null || tmux new-session -d -s {name} -c {dir} {cmdq}; tmux set -t {name} status off 2>/dev/null; exec tmux attach -t {name}",
            name = name,
            dir = sh_quote(&project_dir),
            cmdq = cmdq,
        );
        ("sh".to_string(), vec!["-c".to_string(), full])
    } else {
        (cmd.program.clone(), args.clone())
    };

    // One flag stops the claude-watch poller. on_exit flips it, so BOTH a natural
    // exit and kill_agent (kill -> child dies -> reader EOF -> on_exit) end it.
    let watch_stop = Arc::new(AtomicBool::new(false));
    let watch_stop_exit = watch_stop.clone();

    let app_out = app.clone();
    let id_out = id.clone();
    let app_exit = app.clone();
    let id_exit = id.clone();

    let session = PtySession::spawn(
        &program,
        &spawn_args,
        &project_dir,
        80,
        24,
        move |data| {
            let _ = app_out.emit(
                "agent-output",
                OutputPayload {
                    id: id_out.clone(),
                    data,
                },
            );
        },
        move || {
            watch_stop_exit.store(true, Ordering::Relaxed);
            let _ = app_exit.emit(
                "agent-exit",
                ExitPayload {
                    id: id_exit.clone(),
                },
            );
        },
        tmux_name.clone(),
    )?;

    // Claude-only: tail the jsonl (keyed by session_key) for title + tokens.
    if agent_id == "claude" {
        start_claude_watch(
            app.clone(),
            id.clone(),
            project_dir.clone(),
            session_key,
            watch_stop,
        );
    }

    state
        .agents
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id.clone(), Arc::new(session));
    Ok(id)
}

fn start_claude_watch(
    app: AppHandle,
    id: String,
    project_dir: String,
    session_id: String,
    stop: Arc<AtomicBool>,
) {
    thread::spawn(move || {
        let file = claude_watch::session_file(&claude_projects_root(), &project_dir, &session_id);
        let mut last = String::new();
        while !stop.load(Ordering::Relaxed) {
            let st = claude_watch::read_status(&file);
            let key = format!("{}|{}", st.title.clone().unwrap_or_default(), st.tokens);
            if key != last {
                last = key;
                let _ = app.emit(
                    "agent-claude",
                    ClaudePayload {
                        id: id.clone(),
                        title: st.title,
                        tokens: st.tokens,
                    },
                );
            }
            // ponytail: poll, not fs-notify — a sidebar number doesn't need sub-2s latency
            thread::sleep(Duration::from_secs(2));
        }
    });
}

#[tauri::command]
pub fn write_agent(state: State<AppState>, id: String, data: String) -> Result<(), String> {
    // Clone the Arc out and release the map lock before the (blocking) write.
    get_session(&state, &id)?.write(data.as_bytes())
}

#[tauri::command]
pub fn resize_agent(
    state: State<AppState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    get_session(&state, &id)?.resize(cols, rows)
}

#[tauri::command]
pub fn kill_agent(state: State<AppState>, id: String) -> Result<(), String> {
    let removed = {
        let mut agents = state.agents.lock().map_err(|e| e.to_string())?;
        agents.remove(&id)
    };
    if let Some(s) = removed {
        // A tmux-backed agent's PTY child is only the tmux client; kill the actual
        // session so the agent stops (plain-PTY agents just get killed directly).
        if let Some(name) = s.tmux() {
            let _ = std::process::Command::new("tmux")
                .args(["kill-session", "-t", &name])
                .status();
        }
        s.kill();
    }
    Ok(())
}

// True if this agent's tmux session is still alive (for reattach on restart).
#[tauri::command]
pub fn session_alive(session_key: String) -> bool {
    std::process::Command::new("tmux")
        .args(["has-session", "-t", &format!("tt-{session_key}")])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

// The frontend pushes its live agent list here (JSON) so the MCP server's
// list_agents tool can report it.
#[tauri::command]
pub fn mcp_set_agents(state: State<AppState>, json: String) {
    if let Ok(mut g) = state.mcp_agents.lock() {
        *g = json;
    }
}

#[tauri::command]
pub fn mcp_set_tasks(state: State<AppState>, json: String) {
    if let Ok(mut g) = state.mcp_tasks.lock() {
        *g = json;
    }
}

#[derive(serde::Serialize)]
pub struct DirEntry {
    name: String,
    path: String,
    dir: bool,
}

// List immediate children (folders and files), folders first, each group
// sorted case-insensitively.
#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&path)
        .map_err(|e| e.to_string())?
        .flatten()
    {
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        out.push(DirEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry.path().to_string_lossy().to_string(),
            dir: is_dir,
        });
    }
    out.sort_by(|a, b| {
        b.dir
            .cmp(&a.dir) // folders (true) before files (false)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(out)
}

// Read a text file for the viewer. Rejects oversized or non-UTF-8 (binary) files.
#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("error: not a regular file".into());
    }
    if meta.len() > 1_000_000 {
        return Err("error: file too large to view".into());
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    String::from_utf8(bytes).map_err(|_| "error: not a text file".into())
}

// Read an image file for the viewer as a data: URL (CSP is disabled, so it renders
// straight into <img src>). Rejects oversized files.
#[tauri::command]
pub fn read_image_data_url(path: String) -> Result<String, String> {
    use base64::Engine;
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("error: not a regular file".into());
    }
    if meta.len() > 20_000_000 {
        return Err("error: image too large to view".into());
    }
    let mime = match path.rsplit('.').next().map(|e| e.to_lowercase()).as_deref() {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        _ => "application/octet-stream",
    };
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

#[tauri::command]
pub fn make_dir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())
}

// Heavy/noisy directories we never descend into during a deep search.
const SEARCH_SKIP: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    "vendor",
    ".venv",
    "venv",
    "__pycache__",
    ".cache",
    ".gradle",
    "Pods",
];

// Recursively find subdirectories whose name contains `query` (case-insensitive).
// Skips hidden + heavy dirs and bounds depth/result count so it stays snappy.
#[tauri::command]
pub fn search_dirs(
    root: String,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<DirEntry>, String> {
    let root = expand_dir(&root);
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let limit = limit.unwrap_or(300);
    let max_depth = 12usize;
    let mut out: Vec<DirEntry> = Vec::new();
    let mut stack: Vec<(std::path::PathBuf, usize)> = vec![(std::path::PathBuf::from(&root), 0)];
    while let Some((dir, depth)) = stack.pop() {
        if out.len() >= limit {
            break;
        }
        let rd = match std::fs::read_dir(&dir) {
            Ok(r) => r,
            Err(_) => continue,
        };
        for entry in rd.flatten() {
            if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || SEARCH_SKIP.contains(&name.as_str()) {
                continue;
            }
            let path = entry.path();
            if name.to_lowercase().contains(&q) {
                out.push(DirEntry {
                    name: name.clone(),
                    path: path.to_string_lossy().to_string(),
                    dir: true,
                });
                if out.len() >= limit {
                    break;
                }
            }
            if depth + 1 < max_depth {
                stack.push((path, depth + 1));
            }
        }
    }
    out.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
    Ok(out)
}

// Fuzzy (subsequence) search over files AND folders under root, for the ⌘K palette.
#[tauri::command]
pub fn search_paths(
    root: String,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<DirEntry>, String> {
    let root = expand_dir(&root);
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let limit = limit.unwrap_or(80);
    let base = root.trim_end_matches('/').to_string();
    let max_depth = 14usize;
    let mut out: Vec<DirEntry> = Vec::new();
    let mut stack: Vec<(std::path::PathBuf, usize)> = vec![(std::path::PathBuf::from(&root), 0)];
    while let Some((dir, depth)) = stack.pop() {
        if out.len() >= limit {
            break;
        }
        let rd = match std::fs::read_dir(&dir) {
            Ok(r) => r,
            Err(_) => continue,
        };
        for entry in rd.flatten() {
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || SEARCH_SKIP.contains(&name.as_str()) {
                continue;
            }
            let full = entry.path().to_string_lossy().to_string();
            let rel = full
                .strip_prefix(&base)
                .unwrap_or(&full)
                .trim_start_matches('/')
                .to_lowercase();
            if subsequence(&rel, &q) {
                out.push(DirEntry {
                    name,
                    path: full,
                    dir: is_dir,
                });
                if out.len() >= limit {
                    break;
                }
            }
            if is_dir && depth + 1 < max_depth {
                stack.push((entry.path(), depth + 1));
            }
        }
    }
    out.sort_by(|a, b| {
        b.dir
            .cmp(&a.dir)
            .then(a.path.to_lowercase().cmp(&b.path.to_lowercase()))
    });
    Ok(out)
}

// True if every char of `needle` appears in `hay` in order (fzf-style match).
fn subsequence(hay: &str, needle: &str) -> bool {
    let mut chars = hay.chars();
    needle.chars().all(|c| chars.any(|h| h == c))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn instance_ids_are_unique_per_spawn() {
        let state = AppState::default();
        let a = state.counter.fetch_add(1, Ordering::Relaxed);
        let b = state.counter.fetch_add(1, Ordering::Relaxed);
        assert_ne!(format!("claude-{a}"), format!("claude-{b}"));
    }

    #[test]
    fn expand_dir_handles_tilde_and_trailing_slash() {
        std::env::set_var("HOME", "/Users/x");
        assert_eq!(expand_dir("~"), "/Users/x");
        assert_eq!(expand_dir("~/Documents/cc"), "/Users/x/Documents/cc");
        assert_eq!(expand_dir("/a/b/"), "/a/b");
        assert_eq!(expand_dir("/a/b"), "/a/b");
    }

    #[test]
    fn make_dir_then_list_dir_sees_it() {
        let tmp = tempfile::tempdir().unwrap();
        make_dir(tmp.path().join("newfolder").to_string_lossy().to_string()).unwrap();
        let entries = list_dir(tmp.path().to_string_lossy().to_string()).unwrap();
        assert!(entries.iter().any(|e| e.name == "newfolder"));
    }

    #[test]
    fn read_file_returns_contents_of_small_utf8() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("hello.txt");
        std::fs::write(&p, "hello\nworld").unwrap();
        assert_eq!(
            read_file(p.to_string_lossy().to_string()),
            Ok("hello\nworld".to_string())
        );
    }

    #[test]
    fn read_file_rejects_oversized() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("big.txt");
        std::fs::write(&p, vec![b'a'; 1_000_001]).unwrap();
        assert_eq!(
            read_file(p.to_string_lossy().to_string()),
            Err("error: file too large to view".to_string())
        );
    }

    #[test]
    fn read_file_rejects_non_utf8() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("bin");
        std::fs::write(&p, [0xff, 0xfe]).unwrap();
        assert_eq!(
            read_file(p.to_string_lossy().to_string()),
            Err("error: not a text file".to_string())
        );
    }

    #[test]
    fn read_file_rejects_directory() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(
            read_file(tmp.path().to_string_lossy().to_string()),
            Err("error: not a regular file".to_string())
        );
    }

    #[test]
    fn search_dirs_finds_nested_and_skips_noise() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path();
        std::fs::create_dir_all(base.join("src/components/widgets")).unwrap();
        std::fs::create_dir_all(base.join("node_modules/widgets")).unwrap();
        std::fs::create_dir_all(base.join(".hidden/widgets")).unwrap();
        let root = base.to_string_lossy().to_string();
        let hits = search_dirs(root, "widget".into(), None).unwrap();
        // finds the deep one, not the copies under node_modules / hidden dirs
        assert_eq!(hits.len(), 1);
        assert!(hits[0].path.ends_with("src/components/widgets"));
    }
}
