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
) -> Result<String, String> {
    let cmd =
        registry::command_for(&agent_id).ok_or_else(|| format!("unknown agent: {agent_id}"))?;
    let project_dir = expand_dir(&project_dir);

    let n = state.counter.fetch_add(1, Ordering::Relaxed);
    let id = format!("{agent_id}-{n}");

    // For claude, pin a session id (`--session-id <uuid>`) so we watch exactly this
    // agent's jsonl — two claudes in one folder would otherwise cross their status.
    let mut args = cmd.args;
    let mut session_id = String::new();
    if agent_id == "claude" {
        if let Some(mode) = perm_mode {
            if let Some(i) = args.iter().position(|a| a == "--permission-mode") {
                if i + 1 < args.len() {
                    args[i + 1] = mode;
                }
            }
        }
        session_id = uuid::Uuid::new_v4().to_string();
        args.push("--session-id".to_string());
        args.push(session_id.clone());
    }

    // One flag stops the claude-watch poller. on_exit flips it, so BOTH a natural
    // exit and kill_agent (kill -> child dies -> reader EOF -> on_exit) end it.
    let watch_stop = Arc::new(AtomicBool::new(false));
    let watch_stop_exit = watch_stop.clone();

    let app_out = app.clone();
    let id_out = id.clone();
    let app_exit = app.clone();
    let id_exit = id.clone();

    let session = PtySession::spawn(
        &cmd.program,
        &args,
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
            let _ = app_exit.emit("agent-exit", ExitPayload { id: id_exit.clone() });
        },
    )?;

    // Claude-only: tail the newest jsonl for title + tokens.
    if agent_id == "claude" {
        start_claude_watch(app.clone(), id.clone(), project_dir.clone(), session_id, watch_stop);
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
        s.kill();
    }
    Ok(())
}

#[derive(serde::Serialize)]
pub struct DirEntry {
    name: String,
    path: String,
}

// List immediate subdirectories (dirs only), sorted case-insensitively.
#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&path).map_err(|e| e.to_string())?.flatten() {
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            out.push(DirEntry {
                name: entry.file_name().to_string_lossy().to_string(),
                path: entry.path().to_string_lossy().to_string(),
            });
        }
    }
    out.sort_by_key(|e| e.name.to_lowercase());
    Ok(out)
}

#[tauri::command]
pub fn make_dir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())
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
}
