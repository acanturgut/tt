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
- **Toolchain / shell:** node is behind an nvm lazy-loader that breaks in non-interactive shells (`_load_nvm: command not found`). Prefix EVERY `npm`/`npx`/`cargo` command with `source scripts/dev-env.sh;` (the file is committed in the repo) — e.g. `source scripts/dev-env.sh; npm run build`. Verified versions: node v20.19.6, npm 10.8.2, cargo 1.97.1, rustc 1.97.1.
- v0 shows ALL agents at once in an auto-grid tiling stage, with click-to-focus (zoom) one tile. Grid = `cols = ceil(√n)`, `rows = ceil(n/cols)`. No manual splits, no saved layouts, no persistence; agents die when the app quits.

## File Structure

```
tt/
  index.html
  package.json
  vite.config.ts
  scripts/dev-env.sh        # toolchain prelude (source before npm/cargo)
  src/                      # frontend
    main.ts                 # event wiring, spawn flow, grid render + focus
    agents.ts               # store: agents + status + focus (unit-tested)
    agents.test.ts          # vitest: status transitions + focus
    grid.ts                 # pure tiling math: gridDims(n) (unit-tested)
    grid.test.ts            # vitest: gridDims for n=1..6
    terminal.ts             # AgentTerminal: xterm wrapper
    sidebar.ts              # sidebar render + `+` form
    tiles.ts                # grid/tile DOM: headers, colors, zoom
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
        .plugin(tauri_plugin_opener::init()) // keep: capabilities/default.json lists opener:default
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
  - `interface Agent { id: string; agentId: string; dir: string; color: string; status: Status; title?: string; tokens?: number }`
  - `add(a: Agent)`, `list(): Agent[]`, `subscribe(fn): () => void`
  - `focused(): string | null`, `focus(id: string | null)` — the zoomed tile (null = grid view)
  - `markOutput(id)`, `markExit(id)`, `markClaude(id, title?, tokens?)`

- [ ] **Step 1: Write the failing test** — create `src/agents.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as store from './agents';

const A = (over: Partial<store.Agent> = {}): store.Agent => ({
  id: 'a', agentId: 'codex', dir: '/p', color: '#e3b341', status: 'working', ...over,
});

beforeEach(() => store.__resetForTest());

describe('agents store', () => {
  it('adds an agent and lists it', () => {
    store.add(A({ id: 'claude-0', agentId: 'claude' }));
    expect(store.list().map((a) => a.id)).toEqual(['claude-0']);
    expect(store.list()[0].status).toBe('working');
  });

  it('markOutput -> working, then idle after 2s', () => {
    vi.useFakeTimers();
    store.add(A({ status: 'idle' }));
    store.markOutput('a');
    expect(store.list()[0].status).toBe('working');
    vi.advanceTimersByTime(2001);
    expect(store.list()[0].status).toBe('idle');
    vi.useRealTimers();
  });

  it('markExit wins over later output timer', () => {
    store.add(A());
    store.markExit('a');
    store.markOutput('a'); // must NOT resurrect an exited agent
    expect(store.list()[0].status).toBe('exited');
  });

  it('markClaude sets title and tokens', () => {
    store.add(A({ id: 'c', agentId: 'claude' }));
    store.markClaude('c', 'Fixing colors', 12000);
    expect(store.list()[0].title).toBe('Fixing colors');
    expect(store.list()[0].tokens).toBe(12000);
  });

  it('focus sets and clears the zoomed tile', () => {
    store.add(A({ id: 'x' }));
    expect(store.focused()).toBeNull();
    store.focus('x');
    expect(store.focused()).toBe('x');
    store.focus(null);
    expect(store.focused()).toBeNull();
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
  color: string;
  status: Status;
  title?: string;
  tokens?: number;
}

const agents = new Map<string, Agent>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
let focusedId: string | null = null;

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

export function focused(): string | null {
  return focusedId;
}

export function focus(id: string | null) {
  focusedId = id;
  emit();
}

export function add(a: Agent) {
  agents.set(a.id, a);
  emit();
}

export function markOutput(id: string) {
  const a = agents.get(id);
  if (!a || a.status === 'exited') return;
  const changed = a.status !== 'working'; // only notify on transition — avoids a UI render per output chunk
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
  if (changed) emit();
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
  focusedId = null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `source scripts/dev-env.sh; npm test`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agents.ts src/agents.test.ts
git commit -m "feat: frontend agents store with status transitions"
```

---
### Task 7: `grid.ts` — tiling math (spec check #3)

**Files:**
- Create: `src/grid.ts`, `src/grid.test.ts`

**Interfaces:**
- Produces: `grid::gridDims(n: number) => { cols: number; rows: number }`

- [ ] **Step 1: Write the failing test** — create `src/grid.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { gridDims } from './grid';

describe('gridDims', () => {
  it('lays n agents into a near-square grid', () => {
    expect(gridDims(1)).toEqual({ cols: 1, rows: 1 });
    expect(gridDims(2)).toEqual({ cols: 2, rows: 1 });
    expect(gridDims(3)).toEqual({ cols: 2, rows: 2 });
    expect(gridDims(4)).toEqual({ cols: 2, rows: 2 });
    expect(gridDims(5)).toEqual({ cols: 3, rows: 2 });
    expect(gridDims(6)).toEqual({ cols: 3, rows: 2 });
  });

  it('returns 0x0 for no agents', () => {
    expect(gridDims(0)).toEqual({ cols: 0, rows: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `source scripts/dev-env.sh; npm test -- grid`
Expected: FAIL — `./grid` has no export `gridDims`.

- [ ] **Step 3: Write minimal implementation** — create `src/grid.ts`:

```ts
export interface Dims {
  cols: number;
  rows: number;
}

// Near-square auto-grid: cols = ceil(sqrt(n)), rows = ceil(n/cols).
export function gridDims(n: number): Dims {
  if (n <= 0) return { cols: 0, rows: 0 };
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  return { cols, rows };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `source scripts/dev-env.sh; npm test -- grid`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/grid.ts src/grid.test.ts
git commit -m "feat: gridDims — near-square tiling layout math"
```

---

### Task 8: Tiling UI (`terminal.ts`, `tiles.ts`, `sidebar.ts`, `main.ts`, `styles.css`) + end-to-end

**Files:**
- Create: `src/terminal.ts`, `src/tiles.ts`, `src/sidebar.ts`, `src/styles.css`
- Modify: `src/main.ts` (replace generated contents), `index.html`

**Interfaces:**
- Consumes: `agents.ts` (`add`, `list`, `focus`, `focused`, `subscribe`, `markOutput/Exit/Claude`, `Agent`); `grid.ts` `gridDims`; Tauri `invoke` + `listen`; events `agent-output` / `agent-exit` / `agent-claude` and commands from Task 5.
- Produces: `AgentTerminal` (xterm wrapper, opened once, never reparented); `syncTiles(...)`; `renderSidebar(...)`.

**Design note — never reparent a terminal.** Each agent gets ONE persistent tile appended once; re-renders only toggle `display`, the grid template, and header text, then re-`fit()` visible terminals. `stage.innerHTML = ''` is never used. This keeps xterm state/scroll stable while still showing all agents at once and zooming one on focus.

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
  private opened = false;

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

  // Call once, after this.el is attached to the DOM.
  open() {
    if (this.opened) return;
    this.opened = true;
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

- [ ] **Step 2: Tile grid (persistent, no reparenting)** — create `src/tiles.ts`:

```ts
import { gridDims } from './grid';
import type { Agent } from './agents';
import type { AgentTerminal } from './terminal';

const DOT: Record<Agent['status'], string> = {
  working: '#3fb950',
  idle: '#8b949e',
  exited: '#f85149',
};

export interface TilesHandlers {
  onToggleFocus: (id: string) => void;
}

interface TileEls {
  root: HTMLElement;
  dot: HTMLElement;
  meta: HTMLElement;
  term: AgentTerminal;
}

const tiles = new Map<string, TileEls>();

function fmtTokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`;
}

export function syncTiles(
  stage: HTMLElement,
  agents: Agent[],
  focusedId: string | null,
  terms: Map<string, AgentTerminal>,
  h: TilesHandlers,
) {
  // 1. create a tile for each new agent (append once, open once)
  for (const a of agents) {
    if (tiles.has(a.id)) continue;
    const term = terms.get(a.id);
    if (!term) continue;

    const root = document.createElement('div');
    root.className = 'tile';

    const header = document.createElement('div');
    header.className = 'tile-header';
    header.style.borderTopColor = a.color;
    header.onclick = () => h.onToggleFocus(a.id);

    const dot = document.createElement('span');
    dot.className = 'dot';
    const name = document.createElement('span');
    name.className = 'name';
    name.style.color = a.color;
    name.textContent = a.agentId;
    const meta = document.createElement('span');
    meta.className = 'meta';
    header.append(dot, name, meta);

    const body = document.createElement('div');
    body.className = 'tile-body';
    body.appendChild(term.el);

    root.append(header, body);
    stage.appendChild(root);
    tiles.set(a.id, { root, dot, meta, term });
    term.open(); // el is now in the DOM
  }

  // 2. drop tiles whose agent is gone
  const ids = new Set(agents.map((a) => a.id));
  for (const [id, t] of tiles) {
    if (!ids.has(id)) {
      t.root.remove();
      tiles.delete(id);
    }
  }

  // 3. grid template (or single cell when focused)
  const focusMode = !!focusedId;
  const { cols, rows } = gridDims(agents.length);
  stage.style.gridTemplateColumns = focusMode ? '1fr' : `repeat(${cols || 1}, 1fr)`;
  stage.style.gridTemplateRows = focusMode ? '1fr' : `repeat(${rows || 1}, 1fr)`;

  // 4. per-tile visibility + header content
  for (const a of agents) {
    const t = tiles.get(a.id);
    if (!t) continue;
    const visible = !focusMode || a.id === focusedId;
    t.root.style.display = visible ? 'flex' : 'none';
    t.dot.style.background = DOT[a.status];
    t.meta.textContent = a.title
      ? a.title + (a.tokens ? ` · ${fmtTokens(a.tokens)}` : '')
      : '';
  }

  // 5. re-fit visible terminals once the layout has applied
  requestAnimationFrame(() => {
    for (const a of agents) {
      const t = tiles.get(a.id);
      if (t && (!focusMode || a.id === focusedId)) t.term.fitNow();
    }
  });
}
```

- [ ] **Step 3: Sidebar** — create `src/sidebar.ts`:

```ts
import { list, focused, type Agent } from './agents';

const DOT: Record<Agent['status'], string> = {
  working: '#3fb950',
  idle: '#8b949e',
  exited: '#f85149',
};

export interface SidebarHandlers {
  onNew: (agentId: string, dir: string) => void;
  onFocusToggle: (id: string) => void;
  onGrid: () => void;
}

function fmtTokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`;
}

function homeDir(): string {
  return (window as any).__HOME__ ?? '~';
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

  const grid = document.createElement('button');
  grid.className = 'gridbtn';
  grid.textContent = focused() ? '▦ Show all' : '▦ Grid';
  grid.disabled = !focused();
  grid.onclick = () => h.onGrid();
  root.appendChild(grid);

  const cur = focused();
  for (const a of list()) {
    const row = document.createElement('div');
    row.className = 'agentrow' + (a.id === cur ? ' active' : '');
    row.onclick = () => h.onFocusToggle(a.id);
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = DOT[a.status];
    const label = document.createElement('span');
    label.className = 'label';
    label.style.color = a.color;
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
```

- [ ] **Step 4: Wire everything** — replace `src/main.ts` with:

```ts
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { homeDir } from '@tauri-apps/api/path';
import { add, focus, focused, list, markClaude, markExit, markOutput, subscribe } from './agents';
import { AgentTerminal } from './terminal';
import { syncTiles } from './tiles';
import { renderSidebar } from './sidebar';
import './styles.css';

const COLORS = ['#e3b341', '#3fb950', '#58a6ff', '#bc8cff', '#f778ba', '#39c5cf'];
const terms = new Map<string, AgentTerminal>();
const sidebarEl = document.getElementById('sidebar')!;
const stageEl = document.getElementById('stage')!;

function toggleFocus(id: string) {
  focus(focused() === id ? null : id);
}

function render() {
  renderSidebar(sidebarEl, {
    onNew: (agentId, dir) => void spawn(agentId, dir),
    onFocusToggle: toggleFocus,
    onGrid: () => focus(null),
  });
  syncTiles(stageEl, list(), focused(), terms, { onToggleFocus: toggleFocus });
}

async function spawn(agentId: string, dir: string) {
  try {
    const id = await invoke<string>('spawn_agent', { projectDir: dir, agentId });
    terms.set(id, new AgentTerminal(id));
    const color = COLORS[list().length % COLORS.length];
    add({ id, agentId, dir, color, status: 'working' });
  } catch (e) {
    alert(`spawn failed: ${e}`);
  }
}

// Fire-and-forget: we never need the unlisten handles, so no top-level await
// (Tauri's Vite build target predates top-level await).
listen<{ id: string; data: number[] }>('agent-output', (e) => {
  markOutput(e.payload.id);
  terms.get(e.payload.id)?.write(new Uint8Array(e.payload.data));
});
listen<{ id: string }>('agent-exit', (e) => markExit(e.payload.id));
listen<{ id: string; title?: string; tokens: number }>('agent-claude', (e) =>
  markClaude(e.payload.id, e.payload.title, e.payload.tokens),
);

subscribe(render);
window.addEventListener('resize', () => {
  for (const t of terms.values()) t.fitNow();
});
render(); // initial paint (folder input falls back to '~' until home resolves)
homeDir().then((h) => {
  (window as any).__HOME__ = h;
  render();
});
```

Add the Tauri API package if the scaffold didn't already:
```bash
source scripts/dev-env.sh; npm install @tauri-apps/api
```
(`homeDir` comes from `@tauri-apps/api/path` — core in Tauri v2, no extra plugin.)

- [ ] **Step 5: index.html + styles** — set `index.html` `<body>` to:

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
#stage { flex: 1; min-width: 0; display: grid; gap: 6px; padding: 6px; }

.tile { display: flex; flex-direction: column; min-width: 0; min-height: 0; border: 1px solid #30363d; border-radius: 8px; overflow: hidden; background: #010409; }
.tile-header { display: flex; align-items: center; gap: 8px; padding: 4px 8px; border-top: 2px solid #30363d; background: #0d1117; cursor: pointer; user-select: none; }
.tile-header .dot { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto; }
.tile-header .name { font-weight: 700; }
.tile-header .meta { color: #8b949e; margin-left: auto; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tile-body { flex: 1; min-height: 0; }
.tile-body .term { width: 100%; height: 100%; }

.newagent { display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
.newagent input, .newagent select, .newagent button, .gridbtn {
  background: #161b22; color: #e6edf3; border: 1px solid #30363d; border-radius: 6px; padding: 6px;
}
.newagent button, .gridbtn { cursor: pointer; }
.gridbtn { width: 100%; margin-bottom: 12px; }
.gridbtn:disabled { opacity: .5; cursor: default; }
.agentrow { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; cursor: pointer; }
.agentrow.active { background: #161b22; }
.agentrow .dot { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto; }
.agentrow .label { font-weight: 600; }
.agentrow .meta { color: #8b949e; margin-left: auto; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 120px; }
```

- [ ] **Step 6: Build check**

Run: `source scripts/dev-env.sh; npm run build`
Expected: Vite build succeeds, no TS errors.

- [ ] **Step 7: End-to-end verification (manual — the whole point)**

Run: `source scripts/dev-env.sh; npm run tauri dev`

Verify, in order:
1. Sidebar shows the folder input (prefilled `…/Documents/personal/cc`), an agent dropdown, `+ New agent`, and a `▦ Grid` button (disabled while already in grid).
2. Set the folder to a real Claude project dir, choose `claude`, click `+`. A **tile** appears filling the stage (1 agent → 1×1) with a colored header (dot + `claude`). Type a message → keystrokes register and output streams; mouse-select works.
3. Within ~4s the tile header (and the sidebar row) show Claude's task title + token count; the dot is green while working, grey when idle.
4. Choose `codex`, click `+` → the stage **splits to a 2-up grid**, both terminals visible and live at once. Add a third → auto 2×2. **All keep running simultaneously.**
5. Click a tile header (or its sidebar row) → that tile **zooms fullscreen**, others hide, `▦ Show all` enables. Click the header again (or `▦ Show all`) → back to the grid, every terminal intact with its scrollback.
6. In the claude tile, exit Claude (`/exit`). Its dot turns red (`exited`); the tile stays with its last output.

If all six hold, v0 is done.

- [ ] **Step 8: Commit**

```bash
git add src/terminal.ts src/tiles.ts src/sidebar.ts src/main.ts src/styles.css src/grid.ts index.html package.json package-lock.json
git commit -m "feat: auto-grid tiling UI with click-to-focus — v0 core loop end to end"
```

---

## Self-Review

**Spec coverage:**
- Sidebar + `+` picker (claude/codex) → Task 8 (+ registry Task 2). ✓
- Spawn terminal running chosen CLI in a folder → Tasks 3, 5, 8. ✓
- Full mouse/keyboard → xterm (`allowProposedApi` + webgl), Task 8. ✓
- Universal working/idle/exited dot → store (Task 6, emit-on-change) + events (Task 5). ✓
- Claude rich status (title + tokens) → Tasks 4 + 5 (`agent-claude`) + 8 (tile + sidebar). ✓
- Create project as folder under `~/Documents/personal/cc` → Task 8 sidebar default. ✓
- **Auto-grid tiling, all agents at once** → `gridDims` (Task 7) + `syncTiles` (Task 8). ✓
- **Click-to-focus / zoom (focus mode)** → store `focus/focused` (Task 6) + `syncTiles` display toggle + sidebar/header handlers (Task 8). ✓
- **Terminals never reparented / stay alive** → `syncTiles` creates each tile once, toggles `display` only; `open()` guarded. ✓
- Error handling: binary-not-found / exit / watcher degrade → Task 5 (`spawn_agent` Err → alert; `agent-exit`; watch loop tolerates missing files). ✓
- Spec checks present → Task 3 (echo hi), Task 4 (fixture jsonl), Task 7 (gridDims) + Task 6 (focus toggle). ✓
- Out-of-scope (manual splits, saved layouts, persistence, other agents, non-claude rich status) → not implemented, correct.

**Placeholder scan:** No TBD/TODO; every code step shows full code; commands include the `source scripts/dev-env.sh;` prelude where node/cargo are used; the one manual step (Task 8 Step 7) lists exact observable outcomes.

**Type consistency:**
- Commands `spawn_agent(projectDir, agentId)→id`, `write_agent(id,data)`, `resize_agent(id,cols,rows)`, `kill_agent(id)` match Task 5 (Rust snake_case → JS camelCase) and Task 8 (`invoke` camelCase args).
- Event payloads `{id,data}` / `{id}` / `{id,title,tokens}` match emit (Task 5) and listen (Task 8).
- Store API `add/list/focus/focused/subscribe/markOutput/markExit/markClaude` + `Agent` (now with `color`) match Task 6 ↔ Tasks 8. `focus`/`focused` replace the old `select`/`current` consistently (no stale references).
- `gridDims` return `{cols, rows}` matches Task 7 ↔ `syncTiles` usage.

**Perf note:** `markOutput` only emits on the idle→working transition, so streaming output does not trigger UI renders; `syncTiles` never calls `innerHTML=''` and never reparents a terminal, so re-renders (status/title changes) are cheap DOM updates.
