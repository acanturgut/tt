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

// Surfaced to every connecting agent in the MCP initialize response, so both
// lead and worker agents learn how to coordinate through the shared task board.
const TT_INSTRUCTIONS: &str = "\
tt runs several coding agents side by side. Besides spawning and messaging agents \
(spawn_agent, send, broadcast, close_agent, list_agents), tt has a shared TASK BOARD \
for the human's active project — use it to divide and track work across agents.

Board tools:
- add_task(title, description?) — creates a task in the Planning column, returns its id (e.g. \"t3\").
- list_tasks() — returns the current project's tasks: id, title, status, assignee, result.
- update_task(id, status?, assignee?, result?) — changes a task.
Statuses: planning, in-progress, in-review, done. The board follows the human's active project.

As a LEAD agent: break the work into tasks with add_task. Dispatch a task to a specific \
worker with send(agent_number, \"...work task t3...\"), or let idle workers pull. Watch \
progress with list_tasks; when a worker marks a task done with a result, read it and synthesize.

As a WORKER agent: find work with list_tasks. Claim a Planning task with \
update_task(id, status=\"in-progress\", assignee=\"<your agent number>\") so no one else takes it. \
Do the work, then update_task(id, status=\"done\", result=\"<short summary / where the output is>\"). \
Use status=\"in-review\" instead of done when a task needs lead or human review before it's finished.

Your own agent number is the N a numbered broadcast gives you (\"You are agent N of M\"); \
use that N as your assignee.";

use std::sync::atomic::{AtomicUsize, Ordering};
static TASK_SEQ: AtomicUsize = AtomicUsize::new(1);

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
                    "serverInfo": { "name": "tt", "version": env!("CARGO_PKG_VERSION") },
                    "instructions": TT_INSTRUCTIONS
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
        "add_task" => {
            let title = args.get("title").and_then(|v| v.as_str()).unwrap_or("").trim();
            if title.is_empty() {
                return "error: 'title' is required".into();
            }
            let description = args.get("description").and_then(|v| v.as_str()).unwrap_or("");
            let id = format!("t{}", TASK_SEQ.fetch_add(1, Ordering::Relaxed));
            let _ = app.emit(
                "mcp-task-add",
                json!({ "id": id, "title": title, "description": description }),
            );
            format!("Added task {id}: {title}")
        }
        "list_tasks" => {
            let st = app.state::<AppState>();
            let s = st.mcp_tasks.lock().map(|g| g.clone()).unwrap_or_default();
            if s.is_empty() { "[]".into() } else { s }
        }
        "update_task" => {
            let id = args.get("id").and_then(|v| v.as_str()).unwrap_or("").trim();
            if id.is_empty() {
                return "error: 'id' is required".into();
            }
            // Validate against the snapshot the frontend keeps fresh (same source list_tasks reads).
            let st = app.state::<AppState>();
            let snap = st.mcp_tasks.lock().map(|g| g.clone()).unwrap_or_default();
            let exists = serde_json::from_str::<Value>(&snap)
                .ok()
                .and_then(|v| v.as_array().map(|a| a.iter().any(|t| t.get("id").and_then(|x| x.as_str()) == Some(id))))
                .unwrap_or(false);
            if !exists {
                return format!("error: no task {id} in the current project");
            }
            let mut payload = json!({ "id": id });
            for key in ["status", "assignee", "result"] {
                if let Some(v) = args.get(key).and_then(|v| v.as_str()) {
                    payload[key] = json!(v);
                }
            }
            let _ = app.emit("mcp-task-update", payload);
            format!("Updated task {id}.")
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
        ,{
            "name": "add_task",
            "description": "Add a task to the current project's board. Returns the new task id (e.g. \"t3\"). New tasks start in the Planning column.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": { "type": "string", "description": "short task title" },
                    "description": { "type": "string", "description": "optional detail" }
                },
                "required": ["title"]
            }
        },
        {
            "name": "list_tasks",
            "description": "List the current project's tasks as JSON: id, title, status, assignee, result. status is one of planning, in-progress, in-review, done.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "update_task",
            "description": "Update a task by id. Claim it by setting status=in-progress and assignee to your agent number; finish by setting status=done and result. status is one of planning, in-progress, in-review, done.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "task id from list_tasks/add_task" },
                    "status": { "type": "string" },
                    "assignee": { "type": "string" },
                    "result": { "type": "string" }
                },
                "required": ["id"]
            }
        }
    ])
}
