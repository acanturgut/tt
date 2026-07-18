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
