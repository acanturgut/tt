# tt — Agent Orchestrator (v0 Design)

**Date:** 2026-07-18
**Status:** approved, ready for implementation plan

## What it is

A desktop app that puts every coding-agent CLI in one place. A sidebar with a
`+` button spawns a terminal running the agent of your choice (Claude Code,
Codex, later gemini / opencode / cursor) in a project folder, shows each one's
live status, and lets you jump between them. It generalizes an existing tmux
setup (`cc4`=claude, `co4`=codex, `tt4`=plain terminals) into a real app.

This document specs **v0 only**: the core loop, proven with two agents. The full
agent roster and persistence are deliberately later specs.

## Decisions (settled during brainstorming)

| Decision | Choice | Why |
|---|---|---|
| Substrate | Full desktop app from scratch | User wants a product, not a tmux wrapper |
| Stack | Tauri (Rust) + xterm.js | Mature, cross-platform, plays to web-frontend strength |
| Persistence | Agents die when tt quits (raw PTY) | Keeps v0 lean; persistence is its own later spec |
| Status | Universal dumb dot **+** Claude-only rich status | Dot works for every CLI; Claude gets title+tokens from jsonl |
| Layout | Auto-grid tiling + click-to-focus | See all agents at once (cc4-style); focus mode = zoom one tile |

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
  calls `spawn_agent`. Clicking an agent row focuses (zooms) its tile.
- **`Grid`** — the tiling stage. Lays every live agent's terminal into an
  auto-sized near-square grid (`cols = ceil(√n)`), each tile wrapped in a
  colored header (agent name, status dot, and for Claude its title + tokens).
  Clicking a header — or a sidebar row — zooms that tile fullscreen (focus mode);
  clicking again returns to the grid. See **Tiling** below.
- **`Terminal`** — an xterm.js wrapper (fit + webgl addons, full mouse) bound to
  one agent's PTY. Every agent's xterm instance lives in its own grid cell for
  the agent's lifetime — never torn down; layout/focus changes only move and
  re-`fit()` it. The PTY keeps running whether the tile is gridded, zoomed, or
  behind a zoomed sibling.
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

## Tiling (v0)

- **Auto-grid** — N live agents fill a near-square grid: `cols = ceil(√N)`,
  `rows = ceil(N / cols)` (1→1×1, 2→2×1, 3–4→2×2, 5–6→3×2, …). Pure function,
  unit-tested.
- **Colored tile headers** — each tile has a header bar tinted per agent (reusing
  the cc4 border-color idea): status dot + agent name + (Claude) title + tokens.
- **Focus mode** — click a tile header or its sidebar row → that tile fills the
  stage, siblings hidden; click again → back to the grid. Focus is a single
  `focusedId | null` in the store.
- **All mounted** — terminals are never unmounted on layout change; the grid just
  shows/hides cells and re-`fit()`s the visible ones (on grid change and window
  resize). Scrollback and process state are always preserved.

## Error handling

- **Binary not found** (agent CLI not installed) → error row in the sidebar and a
  message printed into the pane; no crash.
- **PTY exit / EOF** → mark the agent `exited`, keep scrollback visible.
- **Watcher failure** (missing/locked jsonl) → silently degrade to the dumb dot;
  never blocks the terminal.

## v0 scope

**In:** one window; sidebar + an auto-grid tiling stage showing all agents at
once, with click-to-focus (zoom) one tile; full mouse + keyboard in every
terminal; claude + codex; per-tile + sidebar status dots + Claude rich status;
create-project-as-folder under `~/Documents/personal/cc`.

**Out (later specs):** manual/draggable splits; saved layouts; gemini / opencode /
cursor; rich status for non-Claude agents; session persistence across restart.

## Testing (core only — YAGNI on the rest)

1. Spawn `bash -c 'echo hi'` through a PTY and assert the bytes reach the
   frontend channel — proves the engine end to end.
2. Feed `claude_watch` a fixture `.jsonl` and assert it extracts title + tokens.
3. `gridDims(n)` returns the expected `{cols, rows}` for n = 1..6, and the focus
   toggle sets/clears `focusedId`.

No full UI/render test harness in v0.

## v0.1 additions (built)

Layered on top of v0:
- **Projects** — a project = a root folder, added via the native folder picker
  (`@tauri-apps/plugin-dialog`), listed in a top-bar dropdown, persisted in
  `localStorage`. Selecting a project drives the tree.
- **Directory tree (right panel)** — lazy-expand folders (`list_dir`), create a
  folder inline (`make_dir`), and open an agent (claude/codex) in any folder.
  Agent creation moved here from the old left-sidebar form.
- **Workflow status** — a human-set pill per agent (Planning / In progress /
  Done), separate from the automatic activity dot; shown on the tile header and
  the rail row.
- **Kill** — an `×` on both the tile header and the rail row (`kill_agent`).
- **Theme** — super-dark backgrounds + blue accent via CSS variables; per-agent
  colors shifted to a blue/cyan family.
- **New backend commands** — `list_dir`, `make_dir`; dialog plugin registered
  (`dialog:default` capability).

## Later specs (not now)

- **Manual tiling** — draggable dividers, saved/named layouts (v0 auto-grids + zoom).
- **Full agent roster** — gemini / opencode / cursor registry rows + any
  status heuristics.
- **Persistence** — back each agent with a detached process/mux so agents
  survive an app restart.
- **Rich cross-agent status** — unified status model beyond Claude.
