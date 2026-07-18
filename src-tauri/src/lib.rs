mod claude_watch;
mod commands;
mod mcp;
mod pty;
mod registry;

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init()) // keep: capabilities/default.json lists opener:default
        .plugin(tauri_plugin_dialog::init()) // native folder picker (dialog:default)
        .plugin(tauri_plugin_notification::init()) // native notifications (notification:default)
        .manage(AppState::default())
        .setup(|app| {
            mcp::start(app.handle().clone()); // MCP server so agents can spawn agents
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::spawn_agent,
            commands::write_agent,
            commands::resize_agent,
            commands::kill_agent,
            commands::list_dir,
            commands::make_dir,
            commands::search_dirs,
            commands::session_alive,
            commands::mcp_set_agents,
            commands::mcp_set_tasks
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
