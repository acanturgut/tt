mod claude_watch;
mod commands;
mod git;
mod mcp;
mod pty;
mod quota;
mod registry;

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init()) // keep: capabilities/default.json lists opener:default
        .plugin(tauri_plugin_dialog::init()) // native folder picker (dialog:default)
        .plugin(tauri_plugin_notification::init()) // native notifications (notification:default)
        .plugin(tauri_plugin_clipboard_manager::init()) // native clipboard — WKWebView's navigator.clipboard.readText beeps + gates
        .manage(AppState::default())
        .setup(|app| {
            mcp::start(app.handle().clone()); // MCP server so agents can spawn agents
            commands::start_quota_tick(app.handle().clone()); // account quota polling
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::spawn_agent,
            commands::write_agent,
            commands::resize_agent,
            commands::kill_agent,
            commands::list_dir,
            commands::read_file,
            commands::read_image_data_url,
            commands::make_dir,
            commands::search_dirs,
            commands::search_paths,
            commands::session_alive,
            commands::mcp_set_agents,
            commands::mcp_set_tasks,
            commands::quota_now,
            commands::check_clis,
            commands::local_models,
            git::git_status,
            git::git_diff,
            git::git_show,
            git::git_stage,
            git::git_unstage,
            git::git_commit,
            git::git_push,
            git::git_fetch,
            git::git_pull,
            git::git_log_graph,
            git::git_refs_sig,
            git::git_ensure_graph,
            git::git_worktrees
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
