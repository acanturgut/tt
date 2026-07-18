# tt — Agent Orchestrator (v0 Design)

**Date:** 2026-07-18
**Status:** approved, ready for implementation plan

## What it is

A desktop app that puts every coding-agent CLI in one place. A sidebar with a
`+` button spawns a terminal running the agent of your choice (Claude Code,
Codex, later gemini / opencode / cursor) in a project folder, shows each one's
live status, and lets you jump between them. It generalizes an existing tmux
setup (`cc4`=claude, `co4`=codex, `tt4`=plain terminals) into a real app.

This document specs **v0 only**: the core loop, proven with two agents. Tiling,
the full agent roster, and persistence are deliberately later specs.

## Decisions (settled during brainstorming)

| Decision | Choice | Why |
|---|---|---|
| Substrate | Full desktop app from scratch | User wants a product, not a tmux wrapper |
| Stack | Tauri (Rust) + xterm.js | Mature, cross-platform, plays to web-frontend strength |
| Persistence | Agents die when tt quits (raw PTY) | Keeps v0 lean; persistence is its own later spec |
| Status | Universal dumb dot **+** Claude-only rich status | Dot works for every CLI; Claude gets title+tokens from jsonl |

**Key insight:** because tt owns every PTY it spawns, working/idle/exited status
comes from PTY output activity alone — no per-CLI parsing, no reading
`~/.claude/projects` for the basic signal. The jsonl watcher exists *only* to add
Claude-specific richness (task title, token count).

## Architecture

Tauri app: Rust backend owns processes; web frontend is pure UI over events.

### Backend components (each has one job, testable in isolation)

- **`pty.rs`** — spawn/kill a PTY child via `portable-pty`, run a command in a
  directory, stream output on a reader thread, accept input bytes + resize.
  Records a `last_output_at` timestamp used for status.
- **`registry.rs`** — the `agent_id → command` table. Seeded from the user's own
  lines:
  - `claude` → `claude --permission-mode auto --effort high`
  - `codex`  → `codex --sandbox workspace-write --ask-for-approval never`

  Adding gemini / opencode / cursor later is one row each.
- **`claude_watch.rs`** — tails `~/.claude/projects/<slug>/*.jsonl` for a
  project directory and emits `{ title, tokens }`. **Claude-only and isolated** —
  no other agent's status path touches this file. Slug = the project dir with
  `/` → `-` (matches Claude Code's on-disk naming).
- **`commands.rs`** — the Tauri command surface: `spawn_agent`, `write_agent`,
  `resize_agent`, `kill_agent`, `list_agents`.

### Frontend components

- **`Sidebar`** — projects (folders); under each, its spawned agents with a
  status dot (and, for Claude, live title + tokens). A `+` button opens
  pick/create-folder (default root `~/Documents/personal/cc`) + pick-agent, then
  calls `spawn_agent`.
- **`Terminal`** — an xterm.js wrapper (fit + webgl addons, full mouse) bound to
  the selected agent's PTY.
- **`useAgents`** — frontend store of agents, their status, and which is focused.

## Data flow

```
sidebar +  ──spawn_agent(dir, id)──►  pty.rs spawns child
child stdout ──reader thread──►  event  agent://output/{id}  ──►  xterm.write
xterm.onData ──write_agent(id, bytes)──►  child stdin
window resize ──resize_agent(id, cols, rows)──►  pty
pty activity  ──►  last_output_at  ──►  status dot  (working / idle / exited)
claude_watch  ──►  event  agent://claude/{id}  { title, tokens }  ──►  sidebar
```

Status thresholds: bytes within ~2s → `working`; quiet → `idle`; process gone →
`exited`.

## Error handling

- **Binary not found** (agent CLI not installed) → error row in the sidebar and a
  message printed into the pane; no crash.
- **PTY exit / EOF** → mark the agent `exited`, keep scrollback visible.
- **Watcher failure** (missing/locked jsonl) → silently degrade to the dumb dot;
  never blocks the terminal.

## v0 scope

**In:** one window; sidebar + one visible terminal (switch via sidebar); full
mouse + keyboard in the terminal; claude + codex; status dots + Claude rich
status; create-project-as-folder under `~/Documents/personal/cc`.

**Out (later specs):** tiling / split view; focus mode; gemini / opencode /
cursor; rich status for non-Claude agents; session persistence across restart.

## Testing (core only — YAGNI on the rest)

1. Spawn `bash -c 'echo hi'` through a PTY and assert the bytes reach the
   frontend channel — proves the engine end to end.
2. Feed `claude_watch` a fixture `.jsonl` and assert it extracts title + tokens.

No UI test harness in v0.

## Later specs (not now)

- **Tiling + focus mode** — splits, saved layouts, zoom.
- **Full agent roster** — gemini / opencode / cursor registry rows + any
  status heuristics.
- **Persistence** — back each agent with a detached process/mux so agents
  survive an app restart.
- **Rich cross-agent status** — unified status model beyond Claude.
