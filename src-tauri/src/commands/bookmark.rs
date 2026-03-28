use tauri::State;

use crate::models::{Bookmark, BookmarkGroup};
use crate::secrets::{
    delete_bookmark_secrets, get_bookmark_passphrase, get_bookmark_password,
    get_bookmark_private_key, set_bookmark_passphrase, set_bookmark_password,
    set_bookmark_private_key,
};
use crate::storage::{self, DbPath};

fn resolve_bookmark_password(
    bookmark: &Bookmark,
    existing_bookmark: Option<&Bookmark>,
) -> Result<Option<String>, String> {
    if let Some(password) = bookmark.password.as_deref().filter(|value| !value.is_empty()) {
        return Ok(Some(password.to_string()));
    }

    if let Some(password) = get_bookmark_password(&bookmark.id).map_err(|e| e.to_string())? {
        return Ok(Some(password));
    }

    Ok(existing_bookmark.and_then(|existing| {
        existing.password.as_ref().and_then(|password| {
            if password.is_empty() {
                None
            } else if existing.password_encrypted {
                Some(crate::models::decode_password(password))
            } else {
                Some(password.clone())
            }
        })
    }))
}

fn resolve_bookmark_plain_secret(
    incoming_value: Option<&str>,
    existing_keychain_value: Option<String>,
    existing_db_value: Option<&String>,
) -> Result<Option<String>, String> {
    if let Some(value) = incoming_value.filter(|value| !value.is_empty()) {
        return Ok(Some(value.to_string()));
    }

    if let Some(value) = existing_keychain_value {
        return Ok(Some(value));
    }

    Ok(existing_db_value.cloned().filter(|value| !value.is_empty()))
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
            set_bookmark_password(&bookmark.id, password.as_deref()).map_err(|e| e.to_string())?;
            delete_bookmark_secrets(&bookmark.id, &["private_key", "passphrase"])
                .map_err(|e| e.to_string())?;

            bookmark.password = password
                .as_ref()
                .map(|value| crate::models::encode_password(value));
            bookmark.password_encrypted = bookmark.password.is_some();
            bookmark.private_key = None;
            bookmark.passphrase = None;
        }
        "privateKey" => {
            set_bookmark_private_key(&bookmark.id, bookmark.private_key.as_deref())
                .map_err(|e| e.to_string())?;
            set_bookmark_passphrase(&bookmark.id, bookmark.passphrase.as_deref())
                .map_err(|e| e.to_string())?;
            delete_bookmark_secrets(&bookmark.id, &["password"]).map_err(|e| e.to_string())?;

            bookmark.password = None;
            bookmark.password_encrypted = false;
            bookmark.private_key = None;
            bookmark.passphrase = None;
        }
        _ => {
            delete_bookmark_secrets(&bookmark.id, &["password", "private_key", "passphrase"])
                .map_err(|e| e.to_string())?;

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
            let password = resolve_bookmark_password(&bookmark, existing_bookmark.as_ref())?;
            set_bookmark_password(&bookmark.id, password.as_deref()).map_err(|e| e.to_string())?;
            delete_bookmark_secrets(&bookmark.id, &["private_key", "passphrase"])
                .map_err(|e| e.to_string())?;

            bookmark.password = password
                .as_ref()
                .map(|value| crate::models::encode_password(value));
            bookmark.password_encrypted = bookmark.password.is_some();
            bookmark.private_key = None;
            bookmark.passphrase = None;
        }
        "privateKey" => {
            let private_key = resolve_bookmark_plain_secret(
                bookmark.private_key.as_deref(),
                get_bookmark_private_key(&bookmark.id).map_err(|e| e.to_string())?,
                existing_bookmark.as_ref().and_then(|existing| existing.private_key.as_ref()),
            )?;
            let passphrase = resolve_bookmark_plain_secret(
                bookmark.passphrase.as_deref(),
                get_bookmark_passphrase(&bookmark.id).map_err(|e| e.to_string())?,
                existing_bookmark.as_ref().and_then(|existing| existing.passphrase.as_ref()),
            )?;

            set_bookmark_private_key(&bookmark.id, private_key.as_deref()).map_err(|e| e.to_string())?;
            set_bookmark_passphrase(&bookmark.id, passphrase.as_deref()).map_err(|e| e.to_string())?;
            delete_bookmark_secrets(&bookmark.id, &["password"]).map_err(|e| e.to_string())?;

            bookmark.password = None;
            bookmark.password_encrypted = false;
            bookmark.private_key = None;
            bookmark.passphrase = None;
        }
        _ => {
            delete_bookmark_secrets(&bookmark.id, &["password", "private_key", "passphrase"])
                .map_err(|e| e.to_string())?;

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
    delete_bookmark_secrets(&id, &["password", "private_key", "passphrase"])
        .map_err(|e| e.to_string())?;
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
