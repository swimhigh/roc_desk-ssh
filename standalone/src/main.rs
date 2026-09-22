#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

fn main() {
    // The main window is declared once in tauri.conf.json.
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir().expect("resolve app data dir");
            std::fs::create_dir_all(&app_data_dir).expect("create app data dir");
            let db_path = app_data_dir.join("roc_desk_ssh.db");
            let state = roc_desk_ssh::RocDeskSshAppState::new(&db_path, app.handle().clone())
                .expect("initialize SSH tool state");
            app.manage(state);
            Ok(())
        })
        .invoke_handler(roc_desk_ssh::cmd::handlers())
        .run(tauri::generate_context!())
        .expect("failed to run standalone tool");
}
