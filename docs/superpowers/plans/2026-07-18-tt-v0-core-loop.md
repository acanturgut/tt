# tt v0 (Core Loop) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Tauri desktop app whose sidebar `+` button spawns a terminal running a chosen agent CLI (claude or codex) in a folder, streams it live in xterm.js, shows a working/idle/exited dot, and — for claude — a live task title + token count.

**Architecture:** Tauri v2. Rust backend owns every PTY (via `portable-pty`) and streams output to the frontend as events; the web frontend is pure UI over those events. Because the backend owns the PTY, working/idle/exited is derived on the frontend from the output/exit events it already receives — no status polling. A claude-only poll thread tails `~/.claude/projects/<slug>/*.jsonl` for title + tokens.

**Tech Stack:** Tauri v2 (Rust), `portable-pty`, vanilla TypeScript + Vite frontend, `@xterm/xterm` + fit + webgl addons, vitest for the one frontend unit test.

## Global Constraints

- Tauri v2 (`tauri = "2"`), Rust edition 2021.
- Frontend terminal packages are the scoped ones: `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-webgl` (NOT the old unscoped `xterm`).
- Agent commands are verbatim from the user's shell setup:
  - `claude` → program `claude`, args `["--permission-mode","auto","--effort","high"]`
  - `codex` → program `codex`, args `["--sandbox","workspace-write","--ask-for-approval","never"]`
- Default new-project folder root: `~/Documents/personal/cc`.
- Claude token number = latest `assistant` record's `usage`: `input_tokens + cache_creation_input_tokens + cache_read_input_tokens + output_tokens`.
- Claude project slug rule: map every non-`[A-Za-z0-9]` char of the absolute dir to `-` (e.g. `/Users/x/p` → `-Users-x-p`). Watch the newest `*.jsonl` in that slug dir.
- App identifier: `com.acanturgut.tt`.
- v0 shows ONE terminal at a time (switch via sidebar). No tiling, no persistence, agents die when the app quits.

## File Structure

```
tt/
  index.html
  package.json
  vite.config.ts
  src/                      # frontend
    main.ts                 # event wiring, spawn flow, mount current terminal
    agents.ts               # store: agents + status transitions (unit-tested)
    agents.test.ts          # vitest: status transitions
    terminal.ts             # AgentTerminal: xterm wrapper
    sidebar.ts              # sidebar render + `+` form
    styles.css
  src-tauri/
    Cargo.toml
    tauri.conf.json
    src/
      main.rs               # thin: calls run()
      lib.rs                # builder, state, module decls
      registry.rs           # agent_id -> command
      pty.rs                # PtySession (spawn/write/resize/kill) + core test
      claude_watch.rs       # slug + newest_jsonl + read_status + test
      commands.rs           # tauri commands + claude watch thread
  docs/superpowers/...      # (already present)
```

---

### Task 1: Scaffold the Tauri v2 app into the existing repo

**Files:**
- Create: whole Tauri vanilla-ts scaffold (`index.html`, `package.json`, `vite.config.ts`, `src/*`, `src-tauri/*`)
- Preserve: existing `README.md`, `docs/`, `.git`

**Interfaces:**
- Produces: a runnable Tauri shell. No exported code yet.

- [ ] **Step 1: Generate the scaffold in a sibling dir**

```bash
cd ~/Documents/personal
npm create tauri-app@latest tt-scaffold -- --template vanilla-ts --manager npm --identifier com.acanturgut.tt --yes
```

- [ ] **Step 2: Copy scaffold into the repo, keeping our README/docs/.git**

```bash
cd ~/Documents/personal/tt-scaffold
# copy everything except its README and any git metadata
rsync -a --exclude='.git' --exclude='README.md' ./ ~/Documents/personal/tt/
cd ~/Documents/personal/tt
git checkout -- README.md 2>/dev/null || true   # ensure our README wins
rm -rf ~/Documents/personal/tt-scaffold
```

- [ ] **Step 3: Add Rust deps** — edit `src-tauri/Cargo.toml`, add under `[dependencies]` (keep the generated `tauri`, `serde`, `serde_json` lines; add only what's missing):

```toml
portable-pty = "0.8"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

- [ ] **Step 4: Add frontend deps**

```bash
cd ~/Documents/personal/tt
npm install @xterm/xterm @xterm/addon-fit @xterm/addon-webgl
npm install -D vitest
```

- [ ] **Step 5: Add the test script** — in `package.json` `"scripts"`, add:

```json
"test": "vitest run"
```

- [ ] **Step 6: Verify backend compiles and frontend builds**

Run:
```bash
cd ~/Documents/personal/tt/src-tauri && cargo check
cd ~/Documents/personal/tt && npm run build
```
Expected: `cargo check` finishes with `Finished`; `npm run build` writes `dist/` with no errors.

- [ ] **Step 7: Verify the app window opens (manual)**

Run: `cd ~/Documents/personal/tt && npm run tauri dev`
Expected: a desktop window opens showing the default template page. Close it.

- [ ] **Step 8: Commit**

```bash
cd ~/Documents/personal/tt
git add -A
git commit -m "chore: scaffold Tauri v2 app (vanilla-ts) + xterm/vitest deps"
```

---

### Task 2: `registry.rs` — agent command table

**Files:**
- Create: `src-tauri/src/registry.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod registry;`)

**Interfaces:**
- Produces: `registry::AgentCommand { pub program: String, pub args: Vec<String> }` and `registry::command_for(agent_id: &str) -> Option<AgentCommand>`.

- [ ] **Step 1: Write the failing test** — create `src-tauri/src/registry.rs`:

```rust
#[derive(Clone, Debug, PartialEq)]
pub struct AgentCommand {
    pub program: String,
    pub args: Vec<String>,
}

pub fn command_for(agent_id: &str) -> Option<AgentCommand> {
    unimplemented!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_maps_to_its_command() {
        let c = command_for("claude").unwrap();
        assert_eq!(c.program, "claude");
        assert_eq!(c.args, vec!["--permission-mode", "auto", "--effort", "high"]);
    }

    #[test]
    fn codex_maps_to_its_command() {
        let c = command_for("codex").unwrap();
        assert_eq!(c.program, "codex");
        assert_eq!(
            c.args,
            vec!["--sandbox", "workspace-write", "--ask-for-approval", "never"]
        );
    }

    #[test]
    fn unknown_agent_is_none() {
        assert!(command_for("nope").is_none());
    }
}
```

Add `mod registry;` to `src-tauri/src/lib.rs` (near the top, after the existing module lines).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Documents/personal/tt/src-tauri && cargo test registry`
Expected: FAIL — panics with `not implemented` / `unimplemented`.

- [ ] **Step 3: Write minimal implementation** — replace the `command_for` body:

```rust
pub fn command_for(agent_id: &str) -> Option<AgentCommand> {
    let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
    match agent_id {
        "claude" => Some(AgentCommand {
            program: "claude".into(),
            args: s(&["--permission-mode", "auto", "--effort", "high"]),
        }),
        "codex" => Some(AgentCommand {
            program: "codex".into(),
            args: s(&["--sandbox", "workspace-write", "--ask-for-approval", "never"]),
        }),
        _ => None,
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test registry`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/registry.rs src-tauri/src/lib.rs
git commit -m "feat: agent command registry (claude, codex)"
```

---

### Task 3: `pty.rs` — PtySession (the engine; spec check #1)

**Files:**
- Create: `src-tauri/src/pty.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod pty;`)

**Interfaces:**
- Produces:
  - `pty::PtySession` (struct, `Send + Sync`)
  - `PtySession::spawn(program: &str, args: &[String], cwd: &str, cols: u16, rows: u16, on_output: impl Fn(Vec<u8>) + Send + 'static, on_exit: impl FnOnce() + Send + 'static) -> Result<PtySession, String>`
  - `PtySession::write(&self, data: &[u8]) -> Result<(), String>`
  - `PtySession::resize(&self, cols: u16, rows: u16) -> Result<(), String>`
  - `PtySession::kill(&self)`

- [ ] **Step 1: Write the failing test** — create `src-tauri/src/pty.rs`:

```rust
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

pub struct PtySession {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Mutex<Box<dyn portable_pty::Child + Send + Sync>>,
    stop: Arc<AtomicBool>,
}

impl PtySession {
    pub fn spawn(
        _program: &str,
        _args: &[String],
        _cwd: &str,
        _cols: u16,
        _rows: u16,
        _on_output: impl Fn(Vec<u8>) + Send + 'static,
        _on_exit: impl FnOnce() + Send + 'static,
    ) -> Result<PtySession, String> {
        unimplemented!()
    }

    pub fn write(&self, _data: &[u8]) -> Result<(), String> {
        unimplemented!()
    }

    pub fn resize(&self, _cols: u16, _rows: u16) -> Result<(), String> {
        unimplemented!()
    }

    pub fn kill(&self) {
        unimplemented!()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn echo_hi_reaches_the_output_callback() {
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        let _session = PtySession::spawn(
            "bash",
            &["-c".into(), "echo hi".into()],
            "/tmp",
            24,
            80,
            move |bytes| {
                let _ = tx.send(bytes);
            },
            || {},
        )
        .expect("spawn should succeed");

        // Collect output for up to 3 seconds; assert we saw "hi".
        let mut acc = Vec::new();
        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        while std::time::Instant::now() < deadline {
            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(mut chunk) => {
                    acc.append(&mut chunk);
                    if String::from_utf8_lossy(&acc).contains("hi") {
                        return;
                    }
                }
                Err(_) => {}
            }
        }
        panic!("never saw 'hi'; got: {:?}", String::from_utf8_lossy(&acc));
    }
}
```

Add `mod pty;` to `src-tauri/src/lib.rs`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Documents/personal/tt/src-tauri && cargo test pty`
Expected: FAIL — panics with `unimplemented`.

- [ ] **Step 3: Write minimal implementation** — replace the three method bodies:

```rust
    pub fn spawn(
        program: &str,
        args: &[String],
        cwd: &str,
        cols: u16,
        rows: u16,
        on_output: impl Fn(Vec<u8>) + Send + 'static,
        on_exit: impl FnOnce() + Send + 'static,
    ) -> Result<PtySession, String> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;

        let mut cmd = CommandBuilder::new(program);
        cmd.args(args);
        cmd.cwd(cwd);

        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        drop(pair.slave); // release the slave so EOF is delivered on child exit

        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

        // Reader thread: stream output, call on_exit once on EOF/error.
        thread::spawn(move || {
            let mut buf = [0u8; 8192];
            let mut on_exit = Some(on_exit);
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => on_output(buf[..n].to_vec()),
                    Err(_) => break,
                }
            }
            if let Some(cb) = on_exit.take() {
                cb();
            }
        });

        Ok(PtySession {
            master: Mutex::new(pair.master),
            writer: Mutex::new(writer),
            child: Mutex::new(child),
            stop: Arc::new(AtomicBool::new(false)),
        })
    }

    pub fn write(&self, data: &[u8]) -> Result<(), String> {
        let mut w = self.writer.lock().map_err(|e| e.to_string())?;
        w.write_all(data).map_err(|e| e.to_string())?;
        w.flush().map_err(|e| e.to_string())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        let master = self.master.lock().map_err(|e| e.to_string())?;
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())
    }

    pub fn kill(&self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Ok(mut c) = self.child.lock() {
            let _ = c.kill();
        }
    }
```

Note: `stop` also gets read by the claude watch thread (Task 6). Expose it:

```rust
impl PtySession {
    pub fn stop_flag(&self) -> Arc<AtomicBool> {
        self.stop.clone()
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test pty`
Expected: PASS — `echo_hi_reaches_the_output_callback`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/pty.rs src-tauri/src/lib.rs
git commit -m "feat: PtySession — spawn/stream/write/resize/kill a PTY child"
```

---

### Task 4: `claude_watch.rs` — jsonl → {title, tokens} (spec check #2)

**Files:**
- Create: `src-tauri/src/claude_watch.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod claude_watch;`)

**Interfaces:**
- Produces:
  - `claude_watch::ClaudeStatus { pub title: Option<String>, pub tokens: u64 }`
  - `claude_watch::read_status(path: &std::path::Path) -> ClaudeStatus`
  - `claude_watch::slug_for(dir: &str) -> String`
  - `claude_watch::newest_jsonl(projects_root: &std::path::Path, dir: &str) -> Option<std::path::PathBuf>`

- [ ] **Step 1: Write the failing test** — create `src-tauri/src/claude_watch.rs`:

```rust
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Default, PartialEq)]
pub struct ClaudeStatus {
    pub title: Option<String>,
    pub tokens: u64,
}

pub fn read_status(_path: &Path) -> ClaudeStatus {
    unimplemented!()
}

pub fn slug_for(_dir: &str) -> String {
    unimplemented!()
}

pub fn newest_jsonl(_projects_root: &Path, _dir: &str) -> Option<PathBuf> {
    unimplemented!()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn slug_replaces_non_alnum_with_dash() {
        assert_eq!(slug_for("/Users/x/p"), "-Users-x-p");
        assert_eq!(slug_for("/a/.claude/w"), "-a--claude-w");
    }

    #[test]
    fn read_status_extracts_latest_title_and_token_sum() {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        writeln!(f, r#"{{"type":"ai-title","aiTitle":"old title"}}"#).unwrap();
        writeln!(
            f,
            r#"{{"type":"assistant","message":{{"role":"assistant","usage":{{"input_tokens":2,"cache_creation_input_tokens":31,"cache_read_input_tokens":100,"output_tokens":10}}}}}}"#
        )
        .unwrap();
        writeln!(f, r#"{{"type":"ai-title","aiTitle":"Fixing pane colors"}}"#).unwrap();

        let st = read_status(f.path());
        assert_eq!(st.title.as_deref(), Some("Fixing pane colors"));
        assert_eq!(st.tokens, 2 + 31 + 100 + 10);
    }
}
```

Add `mod claude_watch;` to `src-tauri/src/lib.rs`. Add the `tempfile` dev-dependency in `src-tauri/Cargo.toml`:

```toml
[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Documents/personal/tt/src-tauri && cargo test claude_watch`
Expected: FAIL — `unimplemented`.

- [ ] **Step 3: Write minimal implementation** — replace the three fn bodies:

```rust
pub fn read_status(path: &Path) -> ClaudeStatus {
    let mut out = ClaudeStatus::default();
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return out,
    };
    for line in content.lines() {
        let v: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        match v.get("type").and_then(|t| t.as_str()) {
            Some("ai-title") => {
                if let Some(t) = v.get("aiTitle").and_then(|x| x.as_str()) {
                    out.title = Some(t.to_string());
                }
            }
            Some("assistant") => {
                if let Some(u) = v.pointer("/message/usage") {
                    let g = |k: &str| u.get(k).and_then(|x| x.as_u64()).unwrap_or(0);
                    out.tokens = g("input_tokens")
                        + g("cache_creation_input_tokens")
                        + g("cache_read_input_tokens")
                        + g("output_tokens");
                }
            }
            _ => {}
        }
    }
    out
}

pub fn slug_for(dir: &str) -> String {
    dir.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

pub fn newest_jsonl(projects_root: &Path, dir: &str) -> Option<PathBuf> {
    let d = projects_root.join(slug_for(dir));
    let mut newest: Option<PathBuf> = None;
    let mut newest_m = std::time::SystemTime::UNIX_EPOCH;
    for entry in std::fs::read_dir(&d).ok()?.flatten() {
        let p = entry.path();
        if p.extension().and_then(|x| x.to_str()) != Some("jsonl") {
            continue;
        }
        if let Ok(m) = entry.metadata().and_then(|m| m.modified()) {
            if m >= newest_m {
                newest_m = m;
                newest = Some(p);
            }
        }
    }
    newest
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test claude_watch`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/claude_watch.rs src-tauri/src/lib.rs src-tauri/Cargo.toml
git commit -m "feat: claude_watch — jsonl title + token extraction, slug, newest-file"
```

---

### Task 5: `commands.rs` + `lib.rs` — Tauri command surface, state, events

**Files:**
- Create: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs` (state, module decls, invoke handler)

**Interfaces:**
- Consumes: `registry::command_for`, `pty::PtySession`, `claude_watch::{newest_jsonl, read_status}`.
- Produces (Tauri commands, called from the frontend via `invoke`):
  - `spawn_agent(projectDir: String, agentId: String) -> Result<String, String>` (returns the new instance id)
  - `write_agent(id: String, data: String) -> Result<(), String>`
  - `resize_agent(id: String, cols: u16, rows: u16) -> Result<(), String>`
  - `kill_agent(id: String) -> Result<(), String>`
- Produces (events emitted to the frontend):
  - `agent-output` → `{ id: String, data: Vec<u8> }`
  - `agent-exit` → `{ id: String }`
  - `agent-claude` → `{ id: String, title: Option<String>, tokens: u64 }`

- [ ] **Step 1: Write the state + command module** — create `src-tauri/src/commands.rs`:

```rust
use crate::{claude_watch, pty::PtySession, registry};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

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
    let cmd = registry::command_for(&agent_id)
        .ok_or_else(|| format!("unknown agent: {agent_id}"))?;

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
        start_claude_watch(app.clone(), id.clone(), project_dir.clone(), session.stop_flag());
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
            thread::sleep(Duration::from_secs(2)); // ponytail: poll, not fs-notify — a sidebar number doesn't need sub-2s latency
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
pub fn resize_agent(state: State<AppState>, id: String, cols: u16, rows: u16) -> Result<(), String> {
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
```

- [ ] **Step 2: Wire it into `lib.rs`** — `src-tauri/src/lib.rs` should read (adapt around the generated boilerplate):

```rust
mod claude_watch;
mod commands;
mod pty;
mod registry;

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::spawn_agent,
            commands::write_agent,
            commands::resize_agent,
            commands::kill_agent
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

Leave `src-tauri/src/main.rs` as the generated thin wrapper:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    tt_lib::run()
}
```

(If the generated lib crate name differs, match it — check `[lib] name` in `Cargo.toml`.)

- [ ] **Step 3: Verify it compiles and unit test passes**

Run:
```bash
cd ~/Documents/personal/tt/src-tauri
cargo test commands
cargo check
```
Expected: `cargo test commands` PASS (`instance_ids_are_unique_per_spawn`); `cargo check` `Finished`.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs src-tauri/src/main.rs
git commit -m "feat: tauri commands (spawn/write/resize/kill) + state + agent events"
```

---

### Task 6: Frontend store `agents.ts` (+ vitest)

**Files:**
- Create: `src/agents.ts`, `src/agents.test.ts`

**Interfaces:**
- Produces:
  - `type Status = 'working' | 'idle' | 'exited'`
  - `interface Agent { id: string; agentId: string; dir: string; status: Status; title?: string; tokens?: number }`
  - `add(a: Agent)`, `select(id: string)`, `list(): Agent[]`, `current(): string | null`, `subscribe(fn): () => void`
  - `markOutput(id)`, `markExit(id)`, `markClaude(id, title?, tokens?)`

- [ ] **Step 1: Write the failing test** — create `src/agents.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as store from './agents';

beforeEach(() => store.__resetForTest());

describe('agents store', () => {
  it('adds an agent as current and working', () => {
    store.add({ id: 'claude-0', agentId: 'claude', dir: '/p', status: 'working' });
    expect(store.current()).toBe('claude-0');
    expect(store.list()[0].status).toBe('working');
  });

  it('markOutput -> working, then idle after 2s', () => {
    vi.useFakeTimers();
    store.add({ id: 'a', agentId: 'codex', dir: '/p', status: 'idle' });
    store.markOutput('a');
    expect(store.list()[0].status).toBe('working');
    vi.advanceTimersByTime(2001);
    expect(store.list()[0].status).toBe('idle');
    vi.useRealTimers();
  });

  it('markExit wins over later output timer', () => {
    store.add({ id: 'a', agentId: 'codex', dir: '/p', status: 'working' });
    store.markExit('a');
    store.markOutput('a'); // must NOT resurrect an exited agent
    expect(store.list()[0].status).toBe('exited');
  });

  it('markClaude sets title and tokens', () => {
    store.add({ id: 'c', agentId: 'claude', dir: '/p', status: 'working' });
    store.markClaude('c', 'Fixing colors', 12000);
    expect(store.list()[0].title).toBe('Fixing colors');
    expect(store.list()[0].tokens).toBe(12000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Documents/personal/tt && npm test`
Expected: FAIL — `./agents` has no exports / module not found.

- [ ] **Step 3: Write minimal implementation** — create `src/agents.ts`:

```ts
export type Status = 'working' | 'idle' | 'exited';

export interface Agent {
  id: string;
  agentId: string;
  dir: string;
  status: Status;
  title?: string;
  tokens?: number;
}

const agents = new Map<string, Agent>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
let currentId: string | null = null;

function emit() {
  listeners.forEach((l) => l());
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function list(): Agent[] {
  return [...agents.values()];
}

export function current(): string | null {
  return currentId;
}

export function add(a: Agent) {
  agents.set(a.id, a);
  currentId = a.id;
  emit();
}

export function select(id: string) {
  currentId = id;
  emit();
}

export function markOutput(id: string) {
  const a = agents.get(id);
  if (!a || a.status === 'exited') return;
  a.status = 'working';
  const prev = timers.get(id);
  if (prev) clearTimeout(prev);
  timers.set(
    id,
    setTimeout(() => {
      const cur = agents.get(id);
      if (cur && cur.status !== 'exited') {
        cur.status = 'idle';
        emit();
      }
    }, 2000),
  );
  emit();
}

export function markExit(id: string) {
  const a = agents.get(id);
  if (!a) return;
  a.status = 'exited';
  const prev = timers.get(id);
  if (prev) clearTimeout(prev);
  emit();
}

export function markClaude(id: string, title?: string, tokens?: number) {
  const a = agents.get(id);
  if (!a) return;
  a.title = title;
  a.tokens = tokens;
  emit();
}

// test-only reset
export function __resetForTest() {
  agents.clear();
  timers.clear();
  listeners.clear();
  currentId = null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agents.ts src/agents.test.ts
git commit -m "feat: frontend agents store with status transitions"
```

---

### Task 7: Frontend UI (`terminal.ts`, `sidebar.ts`, `main.ts`, `styles.css`) + end-to-end verification

**Files:**
- Create: `src/terminal.ts`, `src/sidebar.ts`, `src/styles.css`
- Modify: `src/main.ts` (replace generated contents), `index.html`

**Interfaces:**
- Consumes: `agents.ts` store; Tauri `invoke` + `listen`; the `agent-output` / `agent-exit` / `agent-claude` events and the four commands from Task 5.
- Produces: `AgentTerminal` class; `renderSidebar(root, handlers)`.

- [ ] **Step 1: xterm wrapper** — create `src/terminal.ts`:

```ts
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { invoke } from '@tauri-apps/api/core';

export class AgentTerminal {
  term: Terminal;
  fit: FitAddon;
  el: HTMLDivElement;

  constructor(public id: string) {
    this.term = new Terminal({
      fontFamily: 'Menlo, monospace',
      fontSize: 13,
      cursorBlink: true,
      allowProposedApi: true,
    });
    this.fit = new FitAddon();
    this.term.loadAddon(this.fit);
    this.el = document.createElement('div');
    this.el.className = 'term';
    this.term.onData((d) => void invoke('write_agent', { id: this.id, data: d }));
    this.term.onResize(({ cols, rows }) =>
      void invoke('resize_agent', { id: this.id, cols, rows }),
    );
  }

  // Call after this.el is attached to the DOM.
  open() {
    this.term.open(this.el);
    try {
      this.term.loadAddon(new WebglAddon());
    } catch {
      /* webgl unavailable — canvas fallback is fine */
    }
    this.fitNow();
  }

  write(data: Uint8Array) {
    this.term.write(data);
  }

  fitNow() {
    try {
      this.fit.fit();
    } catch {
      /* not visible yet */
    }
  }
}
```

- [ ] **Step 2: Sidebar** — create `src/sidebar.ts`:

```ts
import { list, current, type Agent } from './agents';

const DOT: Record<Agent['status'], string> = {
  working: '#3fb950',
  idle: '#8b949e',
  exited: '#f85149',
};

export interface SidebarHandlers {
  onSelect: (id: string) => void;
  onNew: (agentId: string, dir: string) => void;
}

export function renderSidebar(root: HTMLElement, h: SidebarHandlers) {
  root.innerHTML = '';

  const form = document.createElement('div');
  form.className = 'newagent';
  const dir = document.createElement('input');
  dir.type = 'text';
  dir.value = `${homeDir()}/Documents/personal/cc`;
  dir.placeholder = 'project folder';
  const pick = document.createElement('select');
  for (const a of ['claude', 'codex']) {
    const o = document.createElement('option');
    o.value = a;
    o.textContent = a;
    pick.appendChild(o);
  }
  const btn = document.createElement('button');
  btn.textContent = '+ New agent';
  btn.onclick = () => h.onNew(pick.value, dir.value.trim());
  form.append(dir, pick, btn);
  root.appendChild(form);

  const cur = current();
  for (const a of list()) {
    const row = document.createElement('div');
    row.className = 'agentrow' + (a.id === cur ? ' active' : '');
    row.onclick = () => h.onSelect(a.id);
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = DOT[a.status];
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = a.agentId;
    row.append(dot, label);
    if (a.title) {
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = a.title + (a.tokens ? ` · ${fmtTokens(a.tokens)}` : '');
      row.appendChild(meta);
    }
    root.appendChild(row);
  }
}

function fmtTokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`;
}

function homeDir(): string {
  // Filled in by main.ts before first render; falls back to '~'.
  return (window as any).__HOME__ ?? '~';
}
```

- [ ] **Step 3: Wire everything** — replace `src/main.ts` with:

```ts
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { homeDir } from '@tauri-apps/api/path';
import { add, markClaude, markExit, markOutput, select, current, subscribe } from './agents';
import { AgentTerminal } from './terminal';
import { renderSidebar } from './sidebar';
import './styles.css';

const terms = new Map<string, AgentTerminal>();
const sidebarEl = document.getElementById('sidebar')!;
const stageEl = document.getElementById('stage')!;

function mountCurrent() {
  const id = current();
  stageEl.innerHTML = '';
  if (!id) return;
  const t = terms.get(id);
  if (!t) return;
  stageEl.appendChild(t.el);
  if (!t.el.dataset.opened) {
    t.open();
    t.el.dataset.opened = '1';
  } else {
    t.fitNow();
  }
  t.term.focus();
}

function render() {
  renderSidebar(sidebarEl, {
    onSelect: (id) => {
      select(id);
    },
    onNew: (agentId, dir) => void spawn(agentId, dir),
  });
  mountCurrent();
}

async function spawn(agentId: string, dir: string) {
  try {
    const id = await invoke<string>('spawn_agent', { projectDir: dir, agentId });
    terms.set(id, new AgentTerminal(id));
    add({ id, agentId, dir, status: 'working' });
  } catch (e) {
    alert(`spawn failed: ${e}`);
  }
}

await listen<{ id: string; data: number[] }>('agent-output', (e) => {
  markOutput(e.payload.id);
  terms.get(e.payload.id)?.write(new Uint8Array(e.payload.data));
});
await listen<{ id: string }>('agent-exit', (e) => markExit(e.payload.id));
await listen<{ id: string; title?: string; tokens: number }>('agent-claude', (e) =>
  markClaude(e.payload.id, e.payload.title, e.payload.tokens),
);

(window as any).__HOME__ = await homeDir();
subscribe(render);
window.addEventListener('resize', () => terms.get(current() ?? '')?.fitNow());
render();
```

Add the path plugin (used for `homeDir()`):
```bash
cd ~/Documents/personal/tt && npm install @tauri-apps/api
cd src-tauri && cargo add tauri-plugin-... # NOT needed: path is core in @tauri-apps/api/path
```
(`@tauri-apps/api/path`'s `homeDir` is available without a separate plugin in Tauri v2.)

- [ ] **Step 4: index.html + styles** — set `index.html` `<body>` to:

```html
<body>
  <div id="app">
    <aside id="sidebar"></aside>
    <main id="stage"></main>
  </div>
  <script type="module" src="/src/main.ts"></script>
</body>
```

Create `src/styles.css`:

```css
:root { color-scheme: dark; }
* { box-sizing: border-box; }
html, body, #app { height: 100%; margin: 0; }
body { background: #0d1117; color: #e6edf3; font: 13px Menlo, monospace; }
#app { display: flex; height: 100vh; }
#sidebar { width: 240px; flex: 0 0 240px; border-right: 1px solid #30363d; padding: 8px; overflow-y: auto; }
#stage { flex: 1; min-width: 0; padding: 6px; }
.term { width: 100%; height: 100%; }
.newagent { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
.newagent input, .newagent select, .newagent button {
  background: #161b22; color: #e6edf3; border: 1px solid #30363d; border-radius: 6px; padding: 6px;
}
.newagent button { cursor: pointer; }
.agentrow { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; cursor: pointer; }
.agentrow.active { background: #161b22; }
.agentrow .dot { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto; }
.agentrow .label { font-weight: 600; }
.agentrow .meta { color: #8b949e; margin-left: auto; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 130px; }
```

- [ ] **Step 5: Build check**

Run: `cd ~/Documents/personal/tt && npm run build`
Expected: Vite build succeeds, no TS errors.

- [ ] **Step 6: End-to-end verification (manual — this is the whole point)**

Run: `cd ~/Documents/personal/tt && npm run tauri dev`

Verify, in order:
1. Window shows a sidebar with a folder input (prefilled `…/Documents/personal/cc`), an agent dropdown, and `+ New agent`.
2. Set the folder to a real project dir you use with Claude, choose `claude`, click `+`. A terminal appears and Claude Code starts. **Type a message and confirm keystrokes register and output streams.** Mouse-select text in the pane (xterm mouse works).
3. Within ~4s the sidebar row shows Claude's task title and a token count (e.g. `Fixing… · 12k`); the dot is green while it works, grey when idle.
4. Choose `codex`, click `+` again → a second row appears, its own terminal opens. Switch between the two rows — **both keep running**, each restores its own scrollback.
5. In the claude pane, exit Claude (Ctrl-C / `/exit`). The row dot turns red (`exited`) and the last output stays visible.

If all five hold, v0 is done.

- [ ] **Step 7: Commit**

```bash
git add src/terminal.ts src/sidebar.ts src/main.ts src/styles.css index.html package.json package-lock.json
git commit -m "feat: sidebar + xterm UI, event wiring — v0 core loop end to end"
```

---

## Self-Review

**Spec coverage:**
- Sidebar + `+` picker (claude/codex) → Task 7 (+ registry Task 2). ✓
- Spawn terminal running chosen CLI in a folder → Tasks 3, 5, 7. ✓
- Full mouse/keyboard → xterm (Task 7, `allowProposedApi` + webgl). ✓
- Universal working/idle/exited dot → store (Task 6) + events (Task 5). ✓
- Claude rich status (title + tokens) → Tasks 4 + 5 (`agent-claude`) + 7 render. ✓
- Create project as folder under `~/Documents/personal/cc` → Task 7 sidebar default. ✓
- Switching hides but keeps PTY + xterm alive → Task 7 `mountCurrent` keeps `terms` map + `dataset.opened`. ✓
- Error handling: binary-not-found / exit / watcher degrade → Task 5 (`spawn_agent` Err → alert; `agent-exit`; watch loop tolerates missing files). ✓
- Both spec checks present → Task 3 (echo hi), Task 4 (fixture jsonl). ✓
- Out-of-scope items (tiling, persistence, other agents, non-claude rich status) → not implemented, correct.

**Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output. The one manual-verification task (Task 7 Step 6) lists exact observable outcomes.

**Type consistency:** `spawn_agent(projectDir, agentId)→id`, `write_agent(id,data)`, `resize_agent(id,cols,rows)`, `kill_agent(id)` match between Task 5 (Rust `#[tauri::command]` snake_case params auto-map to camelCase from JS) and Task 7 (`invoke` calls use camelCase `projectDir`). Event payload shapes (`{id,data}`, `{id}`, `{id,title,tokens}`) match emit (Task 5) and listen (Task 7). Store API (`add/select/markOutput/markExit/markClaude`) matches between Task 6 and Task 7.

**Note on Tauri param casing:** Tauri v2 converts snake_case command args to camelCase for JS by default. Task 5 params `project_dir`/`agent_id` are invoked as `projectDir`/`agentId` in Task 7 — consistent. If a future Tauri config disables the rename, align both sides.
