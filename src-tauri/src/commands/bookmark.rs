use tauri::State;
use crate::models::{Bookmark, BookmarkGroup};
use crate::storage::{self, DbPath};

#[tauri::command]
pub fn list_bookmarks(db_path: State<DbPath>) -> Result<Vec<Bookmark>, String> {
    storage::list_bookmarks(&db_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_bookmark(db_path: State<DbPath>, mut bookmark: Bookmark) -> Result<Bookmark, String> {
    // Encode password if present and not already encrypted
    if let Some(ref pwd) = bookmark.password.clone() {
        if !bookmark.password_encrypted && !pwd.is_empty() {
            bookmark.password = Some(crate::models::encode_password(pwd));
            bookmark.password_encrypted = true;
        }
    }
    storage::create_bookmark(&db_path, &bookmark).map_err(|e| e.to_string())?;
    Ok(bookmark)
}

#[tauri::command]
pub fn update_bookmark(db_path: State<DbPath>, mut bookmark: Bookmark) -> Result<Bookmark, String> {
    // Encode password if changed (not yet encrypted)
    if let Some(ref pwd) = bookmark.password.clone() {
        if !bookmark.password_encrypted && !pwd.is_empty() {
            bookmark.password = Some(crate::models::encode_password(pwd));
            bookmark.password_encrypted = true;
        }
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    bookmark.updated_at = now;
    storage::update_bookmark(&db_path, &bookmark).map_err(|e| e.to_string())?;
    Ok(bookmark)
}

#[tauri::command]
pub fn delete_bookmark(db_path: State<DbPath>, id: String) -> Result<(), String> {
    storage::delete_bookmark(&db_path, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_bookmark_groups(db_path: State<DbPath>) -> Result<Vec<BookmarkGroup>, String> {
    storage::list_bookmark_groups(&db_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_bookmark_group(db_path: State<DbPath>, group: BookmarkGroup) -> Result<BookmarkGroup, String> {
    storage::create_bookmark_group(&db_path, &group).map_err(|e| e.to_string())?;
    Ok(group)
}

#[tauri::command]
pub fn update_bookmark_group(db_path: State<DbPath>, group: BookmarkGroup) -> Result<BookmarkGroup, String> {
    storage::update_bookmark_group(&db_path, &group).map_err(|e| e.to_string())?;
    Ok(group)
}

#[tauri::command]
pub fn delete_bookmark_group(db_path: State<DbPath>, id: String) -> Result<(), String> {
    storage::delete_bookmark_group(&db_path, &id).map_err(|e| e.to_string())
}
