#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

fn main() {
    // The main window is declared once in tauri.conf.json.
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Portable, exe-relative `.rock_desk` dir (see
            // `roc_desk_core::paths::portable_data_dir` docs) instead of
            // Tauri's OS AppData default — keeps this standalone tool's data
            // in the same place/layout the full `roc_desk.exe` host uses, so
            // copying several standalone tool exes into one directory makes
            // them share it automatically.
            let app_data_dir =
                roc_desk_core::paths::portable_data_dir().expect("resolve app data dir");
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
