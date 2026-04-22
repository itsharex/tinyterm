pub mod commands;
pub mod crypto;
pub mod models;
pub mod session;
pub mod ssh;
pub mod storage;

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, webview::Color, webview::PageLoadEvent};

const STARTUP_SPLASH_MIN_MS: u64 = 2000;

fn create_main_window(app: &AppHandle) -> tauri::Result<()> {
    if app.get_webview_window("main").is_some() {
        return Ok(());
    }

    let main_window_config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .ok_or_else(|| tauri::Error::AssetNotFound("main window config".into()))?;

    WebviewWindowBuilder::from_config(app, main_window_config)?
        .on_page_load(|window, payload| {
            if payload.event() != PageLoadEvent::Finished {
                return;
            }

            let _ = window.show();
            let _ = window.set_focus();

            if let Some(splash_window) = window.app_handle().get_webview_window("splash") {
                let _ = splash_window.close();
            }
        })
        .build()?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            WebviewWindowBuilder::new(app, "splash", WebviewUrl::App("splash.html".into()))
                .title("TinyTerm")
                .inner_size(420.0, 156.0)
                .resizable(false)
                .decorations(false)
                .transparent(true)
                .background_color(Color(0, 0, 0, 0))
                .always_on_top(true)
                .center()
                .skip_taskbar(true)
                .build()
                .expect("failed to create splash window");

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(STARTUP_SPLASH_MIN_MS)).await;
                let _ = create_main_window(&app_handle);
            });

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
