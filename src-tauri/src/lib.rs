pub mod commands;
pub mod crypto;
pub mod models;
pub mod session;
pub mod ssh;
pub mod storage;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Initialize storage
            let app_dir = app.path().app_data_dir().expect("failed to get app data dir");
            std::fs::create_dir_all(&app_dir).expect("failed to create app data dir");
            let db_path = app_dir.join("tinyterm.db");
            storage::init_db(&db_path).expect("failed to initialize database");
            storage::normalize_stored_secrets(&storage::DbPath(db_path.clone()))
                .expect("failed to normalize stored secrets");
            app.manage(storage::DbPath(db_path));
            app.manage(session::SessionManager::new());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Bookmark commands
            commands::bookmark::list_bookmarks,
            commands::bookmark::create_bookmark,
            commands::bookmark::update_bookmark,
            commands::bookmark::delete_bookmark,
            commands::bookmark::list_bookmark_groups,
            commands::bookmark::create_bookmark_group,
            commands::bookmark::update_bookmark_group,
            commands::bookmark::delete_bookmark_group,
            // Profile commands
            commands::profile::list_profiles,
            commands::profile::create_profile,
            commands::profile::update_profile,
            commands::profile::delete_profile,
            // Settings commands
            commands::settings::get_settings,
            commands::settings::update_settings,
            // SSH/Terminal session commands
            commands::ssh::create_session,
            commands::ssh::close_session,
            commands::ssh::check_session_alive,
            commands::ssh::write_to_session,
            commands::ssh::resize_terminal,
            commands::ssh::subscribe_session,
            commands::ssh::get_remote_cwd,
            commands::ssh::execute_remote_command,
            commands::ssh::trust_host_key,
            commands::ssh::check_host_port,
            // SFTP commands
            commands::sftp::list_remote_dir,
            commands::sftp::list_local_dir,
            commands::sftp::scan_remote_folder,
            commands::sftp::upload_file,
            commands::sftp::download_file,
            commands::sftp::cancel_transfer,
            commands::sftp::delete_remote,
            commands::sftp::delete_remote_async,
            commands::sftp::create_remote_dir,
            commands::sftp::delete_local,
            commands::sftp::create_local_dir,
            commands::sftp::rename_local,
            commands::sftp::rename_remote,
            // Local FS commands
            commands::local_fs::pack_local_dir,
            commands::local_fs::unpack_local_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
