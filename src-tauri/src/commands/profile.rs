use tauri::State;

use crate::crypto;
use crate::models::Profile;
use crate::storage::{self, DbPath};

fn resolve_profile_password(
    db_path: &DbPath,
    profile: &Profile,
    existing_profile: Option<&Profile>,
) -> Result<Option<String>, String> {
    if let Some(password) = profile.password.as_deref().filter(|value| !value.is_empty()) {
        return Ok(Some(password.to_string()));
    }

    if let Some(password) = existing_profile.and_then(|existing| {
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

        return Ok(Some(if existing_profile.is_some_and(|existing| existing.password_encrypted) {
            crate::models::decode_password(&password)
        } else {
            password
        }));
    }

    Ok(None)
}

fn resolve_profile_plain_secret(
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

fn redact_profile(profile: &mut Profile) {
    profile.password = None;
    profile.password_encrypted = false;
    profile.private_key = None;
    profile.passphrase = None;
}

#[tauri::command]
pub fn list_profiles(db_path: State<DbPath>) -> Result<Vec<Profile>, String> {
    let profiles = storage::list_profiles(&db_path).map_err(|e| e.to_string())?;
    Ok(profiles
        .into_iter()
        .map(|mut profile| {
            redact_profile(&mut profile);
            profile
        })
        .collect())
}

#[tauri::command]
pub fn create_profile(db_path: State<DbPath>, mut profile: Profile) -> Result<Profile, String> {
    match profile.auth_type.as_str() {
        "password" => {
            let password = profile.password.clone().filter(|value| !value.is_empty());

            profile.password = password
                .map(|value| crypto::encrypt_secret(&db_path.0, &value))
                .transpose()
                .map_err(|e| e.to_string())?;
            profile.password_encrypted = profile.password.is_some();
            profile.private_key = None;
            profile.passphrase = None;
        }
        "privateKey" => {
            profile.password = None;
            profile.password_encrypted = false;
            profile.private_key = profile
                .private_key
                .clone()
                .filter(|value| !value.is_empty())
                .map(|value| crypto::encrypt_secret(&db_path.0, &value))
                .transpose()
                .map_err(|e| e.to_string())?;
            profile.passphrase = profile
                .passphrase
                .clone()
                .filter(|value| !value.is_empty())
                .map(|value| crypto::encrypt_secret(&db_path.0, &value))
                .transpose()
                .map_err(|e| e.to_string())?;
        }
        _ => {
            profile.password = None;
            profile.password_encrypted = false;
            profile.private_key = None;
            profile.passphrase = None;
        }
    }

    storage::create_profile(&db_path, &profile).map_err(|e| e.to_string())?;

    let mut response = profile;
    redact_profile(&mut response);
    Ok(response)
}

#[tauri::command]
pub fn update_profile(db_path: State<DbPath>, mut profile: Profile) -> Result<Profile, String> {
    let existing_profile = storage::list_profiles(&db_path)
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|item| item.id == profile.id);

    match profile.auth_type.as_str() {
        "password" => {
            let password = resolve_profile_password(&db_path, &profile, existing_profile.as_ref())?;

            profile.password = password
                .map(|value| crypto::encrypt_secret(&db_path.0, &value))
                .transpose()
                .map_err(|e| e.to_string())?;
            profile.password_encrypted = profile.password.is_some();
            profile.private_key = None;
            profile.passphrase = None;
        }
        "privateKey" => {
            let private_key = resolve_profile_plain_secret(
                &db_path,
                profile.private_key.as_deref(),
                existing_profile.as_ref().and_then(|existing| existing.private_key.as_ref()),
            )?;
            let passphrase = resolve_profile_plain_secret(
                &db_path,
                profile.passphrase.as_deref(),
                existing_profile.as_ref().and_then(|existing| existing.passphrase.as_ref()),
            )?;

            profile.password = None;
            profile.password_encrypted = false;
            profile.private_key = private_key
                .map(|value| crypto::encrypt_secret(&db_path.0, &value))
                .transpose()
                .map_err(|e| e.to_string())?;
            profile.passphrase = passphrase
                .map(|value| crypto::encrypt_secret(&db_path.0, &value))
                .transpose()
                .map_err(|e| e.to_string())?;
        }
        _ => {
            profile.password = None;
            profile.password_encrypted = false;
            profile.private_key = None;
            profile.passphrase = None;
        }
    }

    storage::update_profile(&db_path, &profile).map_err(|e| e.to_string())?;

    let mut response = profile;
    redact_profile(&mut response);
    Ok(response)
}

#[tauri::command]
pub fn delete_profile(db_path: State<DbPath>, id: String) -> Result<(), String> {
    storage::delete_profile(&db_path, &id).map_err(|e| e.to_string())
}
