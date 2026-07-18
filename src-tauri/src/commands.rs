use crate::{claude_watch, pty::PtySession, registry};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct AppState {
    agents: Mutex<HashMap<String, PtySession>>,
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

#[tauri::command]
pub fn spawn_agent(
    app: AppHandle,
    state: State<AppState>,
    project_dir: String,
    agent_id: String,
) -> Result<String, String> {
    let cmd =
        registry::command_for(&agent_id).ok_or_else(|| format!("unknown agent: {agent_id}"))?;

    let n = state.counter.fetch_add(1, Ordering::Relaxed);
    let id = format!("{agent_id}-{n}");

    let app_out = app.clone();
    let id_out = id.clone();
    let app_exit = app.clone();
    let id_exit = id.clone();

    let session = PtySession::spawn(
        &cmd.program,
        &cmd.args,
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
            let _ = app_exit.emit("agent-exit", ExitPayload { id: id_exit.clone() });
        },
    )?;

    // Claude-only: tail the newest jsonl for title + tokens.
    if agent_id == "claude" {
        start_claude_watch(
            app.clone(),
            id.clone(),
            project_dir.clone(),
            session.stop_flag(),
        );
    }

    state
        .agents
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id.clone(), session);
    Ok(id)
}

fn start_claude_watch(app: AppHandle, id: String, project_dir: String, stop: Arc<AtomicBool>) {
    thread::spawn(move || {
        let root = claude_projects_root();
        let mut last = String::new();
        while !stop.load(Ordering::Relaxed) {
            if let Some(p) = claude_watch::newest_jsonl(&root, &project_dir) {
                let st = claude_watch::read_status(&p);
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
            }
            // ponytail: poll, not fs-notify — a sidebar number doesn't need sub-2s latency
            thread::sleep(Duration::from_secs(2));
        }
    });
}

#[tauri::command]
pub fn write_agent(state: State<AppState>, id: String, data: String) -> Result<(), String> {
    let agents = state.agents.lock().map_err(|e| e.to_string())?;
    let s = agents.get(&id).ok_or_else(|| format!("no agent: {id}"))?;
    s.write(data.as_bytes())
}

#[tauri::command]
pub fn resize_agent(
    state: State<AppState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let agents = state.agents.lock().map_err(|e| e.to_string())?;
    let s = agents.get(&id).ok_or_else(|| format!("no agent: {id}"))?;
    s.resize(cols, rows)
}

#[tauri::command]
pub fn kill_agent(state: State<AppState>, id: String) -> Result<(), String> {
    let mut agents = state.agents.lock().map_err(|e| e.to_string())?;
    if let Some(s) = agents.remove(&id) {
        s.kill();
    }
    Ok(())
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
}
