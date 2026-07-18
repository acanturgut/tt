// Minimal MCP server (Streamable HTTP, JSON responses) so any agent running
// inside tt can spawn and coordinate more agents. Loopback only, no auth.
//
// Tool calls don't touch PTYs directly — they emit events the frontend already
// knows how to handle (spawn/send/broadcast/close), so an MCP-spawned agent
// shows up as a normal tile. `list_agents` reads the JSON snapshot the frontend
// pushes via the `mcp_set_agents` command.

use crate::commands::AppState;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tiny_http::{Header, Method, Response, Server};

const PORT: u16 = 4127;

pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let server = match Server::http(("127.0.0.1", PORT)) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[mcp] could not bind 127.0.0.1:{PORT}: {e}");
                return;
            }
        };
        eprintln!("[mcp] listening on http://127.0.0.1:{PORT}/mcp");
        for mut req in server.incoming_requests() {
            let is_post = *req.method() == Method::Post;
            let mut body = String::new();
            if is_post {
                let _ = req.as_reader().read_to_string(&mut body);
            }
            match handle(&app, &body, is_post) {
                Some(v) => {
                    let ct = Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..])
                        .unwrap();
                    let cors =
                        Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap();
                    let _ = req.respond(
                        Response::from_string(v.to_string())
                            .with_header(ct)
                            .with_header(cors),
                    );
                }
                // Notification or non-POST: acknowledge with no JSON-RPC body.
                None => {
                    let _ = req.respond(Response::from_string("").with_status_code(202));
                }
            }
        }
    });
}

fn handle(app: &AppHandle, body: &str, is_post: bool) -> Option<Value> {
    if !is_post {
        return None;
    }
    let req: Value = serde_json::from_str(body).ok()?;
    let method = req.get("method").and_then(|m| m.as_str()).unwrap_or("");
    // Notifications (no id) get acknowledged without a body.
    let id = req.get("id").cloned()?;

    match method {
        "initialize" => {
            let proto = req
                .get("params")
                .and_then(|p| p.get("protocolVersion"))
                .and_then(|v| v.as_str())
                .unwrap_or("2024-11-05");
            Some(result(
                id,
                json!({
                    "protocolVersion": proto,
                    "capabilities": { "tools": {} },
                    "serverInfo": { "name": "tt", "version": env!("CARGO_PKG_VERSION") }
                }),
            ))
        }
        "ping" => Some(result(id, json!({}))),
        "tools/list" => Some(result(id, json!({ "tools": tool_defs() }))),
        "tools/call" => {
            let params = req.get("params").cloned().unwrap_or_else(|| json!({}));
            let name = params.get("name").and_then(|n| n.as_str()).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
            let text = call_tool(app, name, &args);
            Some(result(
                id,
                json!({ "content": [ { "type": "text", "text": text } ] }),
            ))
        }
        _ => Some(error(id, -32601, "method not found")),
    }
}

// agent_number may arrive as an int (2) or a hierarchical string ("1-1").
fn num_arg(args: &Value, key: &str) -> String {
    match args.get(key) {
        Some(Value::String(s)) => s.trim().to_string(),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    }
}

fn result(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}
fn error(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn call_tool(app: &AppHandle, name: &str, args: &Value) -> String {
    match name {
        "spawn_agent" => {
            let agent = args.get("agent").and_then(|v| v.as_str()).unwrap_or("claude");
            let dir = args.get("dir").and_then(|v| v.as_str()).unwrap_or("");
            if dir.is_empty() {
                return "error: 'dir' is required".into();
            }
            let _ = app.emit("mcp-spawn", json!({ "agent": agent, "dir": dir }));
            format!("Spawning {agent} in {dir}. Call list_agents to see it.")
        }
        "list_agents" => {
            let st = app.state::<AppState>();
            let s = st.mcp_agents.lock().map(|g| g.clone()).unwrap_or_default();
            if s.is_empty() {
                "[]".into()
            } else {
                s
            }
        }
        "send" => {
            let n = num_arg(args, "agent_number");
            let text = args.get("text").and_then(|v| v.as_str()).unwrap_or("");
            if n.is_empty() {
                return "error: 'agent_number' is required".into();
            }
            let _ = app.emit("mcp-send", json!({ "number": n, "text": text }));
            format!("Sent to agent {n}.")
        }
        "broadcast" => {
            let text = args.get("text").and_then(|v| v.as_str()).unwrap_or("");
            let numbered = args
                .get("numbered")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let _ = app.emit("mcp-broadcast", json!({ "text": text, "numbered": numbered }));
            "Broadcast sent to all agents.".into()
        }
        "close_agent" => {
            let n = num_arg(args, "agent_number");
            if n.is_empty() {
                return "error: 'agent_number' is required".into();
            }
            let _ = app.emit("mcp-close", json!({ "number": n }));
            format!("Closed agent {n}.")
        }
        _ => format!("unknown tool: {name}"),
    }
}

fn tool_defs() -> Value {
    json!([
        {
            "name": "spawn_agent",
            "description": "Open a new coding-agent in a folder. agent is one of: claude, codex, cursor, gemini, opencode, antigravity, terminal.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "agent": { "type": "string", "description": "which CLI to run" },
                    "dir": { "type": "string", "description": "absolute folder path to run it in" }
                },
                "required": ["agent", "dir"]
            }
        },
        {
            "name": "list_agents",
            "description": "List the current agents with their number, name, kind, dir and status.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "send",
            "description": "Type text (followed by Enter) into a single agent, addressed by its number.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "agent_number": { "type": "string", "description": "agent number, e.g. \"2\" or a sub-agent like \"1-1\"" },
                    "text": { "type": "string" }
                },
                "required": ["agent_number", "text"]
            }
        },
        {
            "name": "broadcast",
            "description": "Send text to every agent. Set numbered=true to prefix each with 'You are agent N of M'.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "text": { "type": "string" },
                    "numbered": { "type": "boolean" }
                },
                "required": ["text"]
            }
        },
        {
            "name": "close_agent",
            "description": "Close (kill) an agent addressed by its number.",
            "inputSchema": {
                "type": "object",
                "properties": { "agent_number": { "type": "string", "description": "agent number, e.g. \"2\" or \"1-1\"" } },
                "required": ["agent_number"]
            }
        }
    ])
}
