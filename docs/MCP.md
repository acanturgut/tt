# tt MCP server

Goal: expose tt itself as an **MCP server** so any agent running inside tt can
spawn and coordinate more agents - a fleet that grows itself. No auth / no
tokens (localhost only).

## Planned tools

| Tool | What it does |
|------|--------------|
| `spawn_agent(agent, dir, prompt?)` | Open a new agent (claude/codex/cursor/gemini/opencode/antigravity/terminal) in a folder; `prompt` is typed in once it boots. |
| `list_agents()` | Current agents: number, name, kind, dir, status. |
| `send(agent_number, text)` | Type text (+Enter) into one agent. |
| `broadcast(text, numbered?)` | Send to all agents; `numbered` prefixes "You are agent N of M". |
| `close_agent(agent_number)` | Kill an agent. |

## Transport

tt will serve **streamable HTTP MCP** on `http://127.0.0.1:4127/mcp` (loopback
only, no auth). Pick a fixed port so the config below is stable.

## Per-agent setup

Once tt's MCP server is running, point each CLI at it. (These are the general
MCP-add mechanisms for each tool - the tt entry is the same URL everywhere.)

### Claude Code
```sh
claude mcp add tt --transport http http://127.0.0.1:4127/mcp
# verify: claude mcp list   ·   in-session: /mcp
```

### Codex
`~/.codex/config.toml`:
```toml
[mcp_servers.tt]
url = "http://127.0.0.1:4127/mcp"
```

### Cursor (cursor-agent)
`~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project):
```json
{
  "mcpServers": {
    "tt": { "url": "http://127.0.0.1:4127/mcp" }
  }
}
```

### Gemini CLI
`~/.gemini/settings.json`:
```json
{
  "mcpServers": {
    "tt": { "httpUrl": "http://127.0.0.1:4127/mcp" }
  }
}
```

### opencode
`opencode.json` (project) or `~/.config/opencode/opencode.json`:
```json
{
  "mcp": {
    "tt": { "type": "remote", "url": "http://127.0.0.1:4127/mcp", "enabled": true }
  }
}
```

> Field names (`url` vs `httpUrl` vs `type: remote`) differ per CLI - the ones
> above match each tool's current MCP config schema. Restart the agent after
> editing its config.

## Status

**Implemented.** While tt is running it serves the tools above at
`http://127.0.0.1:4127/mcp`. An agent spawned via `spawn_agent` shows up as a
normal tile; `list_agents` numbers match the tile numbers. Add it to Claude:

```sh
claude mcp add tt --transport http http://127.0.0.1:4127/mcp
```
