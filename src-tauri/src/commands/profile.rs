use tauri::State;
use crate::models::Profile;
use crate::storage::{self, DbPath};

#[tauri::command]
pub fn list_profiles(db_path: State<DbPath>) -> Result<Vec<Profile>, String> {
    storage::list_profiles(&db_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_profile(db_path: State<DbPath>, mut profile: Profile) -> Result<Profile, String> {
    if let Some(ref pwd) = profile.password.clone() {
        if !profile.password_encrypted && !pwd.is_empty() {
            profile.password = Some(crate::models::encode_password(pwd));
            profile.password_encrypted = true;
        }
    }
    storage::create_profile(&db_path, &profile).map_err(|e| e.to_string())?;
    Ok(profile)
}

#[tauri::command]
pub fn update_profile(db_path: State<DbPath>, mut profile: Profile) -> Result<Profile, String> {
    if let Some(ref pwd) = profile.password.clone() {
        if !profile.password_encrypted && !pwd.is_empty() {
            profile.password = Some(crate::models::encode_password(pwd));
            profile.password_encrypted = true;
        }
    }
    storage::update_profile(&db_path, &profile).map_err(|e| e.to_string())?;
    Ok(profile)
}

#[tauri::command]
pub fn delete_profile(db_path: State<DbPath>, id: String) -> Result<(), String> {
    storage::delete_profile(&db_path, &id).map_err(|e| e.to_string())
}
