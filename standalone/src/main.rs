#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

/// If `table_name` already exists (this db file was created by someone
/// else's migration under a different name -- e.g. the full `roc_desk.exe`
/// host, whose `sessions.db` creates the same tables via its own
/// `0002`/`0010`/`0013` migration set, not this crate's single
/// `migration_name`), record `migration_name` as already-applied so this
/// crate's own `apply_migrations` skips re-running its `CREATE TABLE`
/// (which has no `IF NOT EXISTS` and would error on a table that's already
/// there). Does nothing on a genuinely fresh file -- `table_name` doesn't
/// exist yet, so the normal migration runs and creates it itself.
fn bridge_migration_if_table_exists(
    db_path: &std::path::Path,
    migration_name: &str,
    table_name: &str,
) -> Result<(), roc_desk_core::error::AppError> {
    let pool = roc_desk_core::db::pool::create_pool(db_path)?;
    let conn = pool.get()?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            name TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )?;
    let table_exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
        [table_name],
        |r| r.get(0),
    )?;
    if table_exists {
        conn.execute(
            "INSERT OR IGNORE INTO schema_migrations (name) VALUES (?1)",
            [migration_name],
        )?;
    }
    Ok(())
}

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
            // Same file the host's own SSH/RDP/Agent panel reads/writes
            // (`sessions/sessions.db`, see host `src-tauri/src/lib.rs`) --
            // not a separate `roc_desk_ssh.db` of this exe's own, so
            // connections saved in either place show up in both.
            let sessions_dir = app_data_dir.join("sessions");
            std::fs::create_dir_all(&sessions_dir).expect("create sessions dir");
            let db_path = sessions_dir.join("sessions.db");
            bridge_migration_if_table_exists(&db_path, "0001_ssh_init", "connections")
                .expect("bridge legacy sessions.db migration state");
            let state = roc_desk_ssh::RocDeskSshAppState::new(&db_path, app.handle().clone())
                .expect("initialize SSH tool state");
            app.manage(state);
            Ok(())
        })
        .invoke_handler(roc_desk_ssh::cmd::handlers())
        .run(tauri::generate_context!())
        .expect("failed to run standalone tool");
}
