use tauri::{AppHandle, Manager};

#[tauri::command]
pub fn finish_startup(app: AppHandle) -> Result<(), String> {
    if let Some(main_window) = app.get_webview_window("main") {
        main_window.show().map_err(|e| e.to_string())?;
        let _ = main_window.set_focus();
    }

    if let Some(splash_window) = app.get_webview_window("splash") {
        let _ = splash_window.close();
    }

    Ok(())
}