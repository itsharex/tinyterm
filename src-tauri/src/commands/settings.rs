use tauri::State;
use crate::models::Settings;
use crate::storage::{self, DbPath};

#[tauri::command]
pub fn get_settings(db_path: State<DbPath>) -> Result<Settings, String> {
    storage::get_settings(&db_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_settings(db_path: State<DbPath>, settings: Settings) -> Result<(), String> {
    storage::update_settings(&db_path, &settings).map_err(|e| e.to_string())
}
