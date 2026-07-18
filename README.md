

## TT

<img width="1912" height="1243" alt="Screenshot 2026-07-18 at 14 05 16" src="https://github.com/user-attachments/assets/7c2fbed6-3cfc-4d22-b73c-816d77cea75c" />

--

Every coding-agent CLI in one place. A desktop app (Tauri + xterm.js): add a
project folder, then spawn **Claude Code, Codex, Cursor, or a plain terminal**
in any directory - tiled side-by-side, each with a live activity dot and a
workflow status you set.

## Install (macOS)

Download the latest `.dmg` from [Releases](https://github.com/acanturgut/tt/releases),
open it, and drag **tt** to Applications.

The build is unsigned, so on first launch: right-click **tt** -> **Open** -> **Open**
(only needed once). Then install the agent CLIs you want (see Requirements).

## Features

- **Projects** - add a folder via the native picker; switch via the top-bar
  dropdown (persisted).
- **Directory tree** (right panel) - browse, create folders, and open an agent
  in any folder.
- **Auto-grid tiling** of all running agents; click a tile to zoom (focus mode).
- **Status** - a live dot (working / idle / exited) plus a workflow tag you set:
  Planning · In progress · In review · Done (it colors the tile).
- **Rename** agents (double-click the title); **collapse** the left/right panels.
- **× kill** an agent from its tile or the rail.

## Requirements

- **Rust** (rustup) and **Node 20+**
- **tmux** (optional) - agents run inside it so their sessions survive closing/restarting
  the app; without tmux they still work but don't persist.
- The agent CLIs you want to use, on your `PATH`:
  - `claude` - Claude Code
  - `codex` - Codex CLI
  - `cursor-agent` - Cursor CLI
  - `gemini` - Gemini CLI
  - `opencode` - opencode CLI
  - `antigravity` - Antigravity CLI
  - a shell for the plain terminal (uses `$SHELL`)

  > Gemini's free Google sign-in was deprecated for the CLI. Set a `GEMINI_API_KEY`
  > (free key at aistudio.google.com/apikey) or choose "Use Gemini API Key" in its prompt.

## Develop / Run

```sh
# from the repo root
source scripts/dev-env.sh   # puts cargo + node on PATH (see note below)
npm install
npm run tauri dev           # compiles the Rust, opens the app window
```

Production build: `npm run tauri build`.

> **`scripts/dev-env.sh`** exists because this machine loads node through an nvm
> lazy-loader that only works in interactive shells; it drops the stub and points
> `PATH` at node + `~/.cargo/bin`. If cargo and node are already on your `PATH`,
> you can skip sourcing it.

## Agent commands

Each agent is launched in the folder you pick:

| Agent | Command |
|-------|---------|
| claude | `claude --permission-mode auto --effort high --session-id <uuid>` |
| codex | `codex --sandbox workspace-write --ask-for-approval never` |
| cursor | `cursor-agent` |
| gemini | `gemini` |
| opencode | `opencode` |
| antigravity | `antigravity` |
| terminal | `$SHELL -l` |

Claude gets a pinned `--session-id` so tt reads exactly that session's title +
token count from `~/.claude/projects` (no cross-talk between two claudes in one
folder).

## MCP — let agents spawn agents

While tt is running it exposes an MCP server at `http://127.0.0.1:4127/mcp`
(loopback only, no auth). Point any agent CLI at it and that agent can spawn and
coordinate more agents — the new agents appear as normal tiles in tt.

**Tools:** `spawn_agent(agent, dir)` · `list_agents()` · `send(agent_number, text)` ·
`broadcast(text, numbered?)` · `close_agent(agent_number)`. Agent numbers are
hierarchical — a sub-agent spawned by #1 is `1-1`.

Add it to Claude Code (restart the session afterward):

```sh
claude mcp add tt --transport http http://127.0.0.1:4127/mcp
# verify:  claude mcp list   →   tt … ✔ Connected
```

Every other CLI uses the same URL — see [docs/MCP.md](docs/MCP.md) for Codex,
Cursor, Gemini, and opencode config snippets.

## Tests

```sh
source scripts/dev-env.sh
cd src-tauri && cargo test    # Rust: registry, PTY, jsonl parsing, fs
cd .. && npm test             # frontend: store + tiling math
```

## Design docs

`docs/superpowers/specs/` (design) and `docs/superpowers/plans/` (implementation
plan).


<img width="256" height="256" alt="cd92468d-07d3-44a1-86ef-960b428b169c-1" src="https://github.com/user-attachments/assets/624d7637-1c55-45de-ab85-1cb5e371b268" />
