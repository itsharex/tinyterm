use tauri::State;

use crate::crypto;
use crate::models::{Bookmark, BookmarkGroup};
use crate::storage::{self, DbPath};

fn resolve_bookmark_password(
    db_path: &DbPath,
    bookmark: &Bookmark,
    existing_bookmark: Option<&Bookmark>,
) -> Result<Option<String>, String> {
    if let Some(password) = bookmark.password.as_deref().filter(|value| !value.is_empty()) {
        return Ok(Some(password.to_string()));
    }

    if let Some(password) = existing_bookmark.and_then(|existing| {
        existing.password.as_ref().and_then(|password| {
            if password.is_empty() {
                None
            } else {
                Some(password.clone())
            }
        })
    }) {
        if crypto::is_encrypted_secret(&password) {
            return crypto::decrypt_secret(&db_path.0, &password)
                .map(Some)
                .map_err(|e| e.to_string());
        }

        return Ok(Some(if existing_bookmark.is_some_and(|existing| existing.password_encrypted) {
            crate::models::decode_password(&password)
        } else {
            password
        }));
    }

    Ok(None)
}

fn resolve_bookmark_plain_secret(
    db_path: &DbPath,
    incoming_value: Option<&str>,
    existing_db_value: Option<&String>,
) -> Result<Option<String>, String> {
    if let Some(value) = incoming_value.filter(|value| !value.is_empty()) {
        return Ok(Some(value.to_string()));
    }

    if let Some(value) = existing_db_value.cloned().filter(|value| !value.is_empty()) {
        if crypto::is_encrypted_secret(&value) {
            return crypto::decrypt_secret(&db_path.0, &value)
                .map(Some)
                .map_err(|e| e.to_string());
        }

        return Ok(Some(value));
    }

    Ok(None)
}

fn redact_bookmark(bookmark: &mut Bookmark) {
    bookmark.password = None;
    bookmark.password_encrypted = false;
    bookmark.private_key = None;
    bookmark.passphrase = None;
}

#[tauri::command]
pub fn list_bookmarks(db_path: State<DbPath>) -> Result<Vec<Bookmark>, String> {
    let bookmarks = storage::list_bookmarks(&db_path).map_err(|e| e.to_string())?;
    Ok(bookmarks
        .into_iter()
        .map(|mut bookmark| {
            redact_bookmark(&mut bookmark);
            bookmark
        })
        .collect())
}

#[tauri::command]
pub fn create_bookmark(db_path: State<DbPath>, mut bookmark: Bookmark) -> Result<Bookmark, String> {
    match bookmark.auth_type.as_str() {
        "password" => {
            let password = bookmark.password.clone().filter(|value| !value.is_empty());

            bookmark.password = password
                .map(|value| crypto::encrypt_secret(&db_path.0, &value))
                .transpose()
                .map_err(|e| e.to_string())?;
            bookmark.password_encrypted = bookmark.password.is_some();
            bookmark.private_key = None;
            bookmark.passphrase = None;
        }
        "privateKey" => {
            bookmark.password = None;
            bookmark.password_encrypted = false;
            bookmark.private_key = bookmark
                .private_key
                .clone()
                .filter(|value| !value.is_empty())
                .map(|value| crypto::encrypt_secret(&db_path.0, &value))
                .transpose()
                .map_err(|e| e.to_string())?;
            bookmark.passphrase = bookmark
                .passphrase
                .clone()
                .filter(|value| !value.is_empty())
                .map(|value| crypto::encrypt_secret(&db_path.0, &value))
                .transpose()
                .map_err(|e| e.to_string())?;
        }
        _ => {
            bookmark.password = None;
            bookmark.password_encrypted = false;
            bookmark.private_key = None;
            bookmark.passphrase = None;
        }
    }

    storage::create_bookmark(&db_path, &bookmark).map_err(|e| e.to_string())?;

    let mut response = bookmark;
    redact_bookmark(&mut response);
    Ok(response)
}

#[tauri::command]
pub fn update_bookmark(db_path: State<DbPath>, mut bookmark: Bookmark) -> Result<Bookmark, String> {
    let existing_bookmark = storage::list_bookmarks(&db_path)
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|item| item.id == bookmark.id);

    match bookmark.auth_type.as_str() {
        "password" => {
            let password = resolve_bookmark_password(&db_path, &bookmark, existing_bookmark.as_ref())?;

            bookmark.password = password
                .map(|value| crypto::encrypt_secret(&db_path.0, &value))
                .transpose()
                .map_err(|e| e.to_string())?;
            bookmark.password_encrypted = bookmark.password.is_some();
            bookmark.private_key = None;
            bookmark.passphrase = None;
        }
        "privateKey" => {
            let private_key = resolve_bookmark_plain_secret(
                &db_path,
                bookmark.private_key.as_deref(),
                existing_bookmark.as_ref().and_then(|existing| existing.private_key.as_ref()),
            )?;
            let passphrase = resolve_bookmark_plain_secret(
                &db_path,
                bookmark.passphrase.as_deref(),
                existing_bookmark.as_ref().and_then(|existing| existing.passphrase.as_ref()),
            )?;

            bookmark.password = None;
            bookmark.password_encrypted = false;
            bookmark.private_key = private_key
                .map(|value| crypto::encrypt_secret(&db_path.0, &value))
                .transpose()
                .map_err(|e| e.to_string())?;
            bookmark.passphrase = passphrase
                .map(|value| crypto::encrypt_secret(&db_path.0, &value))
                .transpose()
                .map_err(|e| e.to_string())?;
        }
        _ => {
            bookmark.password = None;
            bookmark.password_encrypted = false;
            bookmark.private_key = None;
            bookmark.passphrase = None;
        }
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    bookmark.updated_at = now;
    storage::update_bookmark(&db_path, &bookmark).map_err(|e| e.to_string())?;

    let mut response = bookmark;
    redact_bookmark(&mut response);
    Ok(response)
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
