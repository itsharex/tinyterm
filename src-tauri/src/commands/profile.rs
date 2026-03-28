use tauri::State;

use crate::models::Profile;
use crate::secrets::{
    delete_profile_secrets, get_profile_passphrase, get_profile_password, get_profile_private_key,
    set_profile_passphrase, set_profile_password, set_profile_private_key,
};
use crate::storage::{self, DbPath};

fn resolve_profile_password(
    profile: &Profile,
    existing_profile: Option<&Profile>,
) -> Result<Option<String>, String> {
    if let Some(password) = profile.password.as_deref().filter(|value| !value.is_empty()) {
        return Ok(Some(password.to_string()));
    }

    if let Some(password) = get_profile_password(&profile.id).map_err(|e| e.to_string())? {
        return Ok(Some(password));
    }

    Ok(existing_profile.and_then(|existing| {
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

fn resolve_profile_plain_secret(
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
    eprintln!(
        "[tinyterm profile save] action=create profile_id={} auth_type={} password_present={} password_len={} private_key_present={} private_key_len={} passphrase_present={} passphrase_len={}",
        profile.id,
        profile.auth_type,
        profile.password.as_deref().is_some_and(|value| !value.is_empty()),
        profile.password.as_deref().map(|value| value.chars().count()).unwrap_or(0),
        profile.private_key.as_deref().is_some_and(|value| !value.is_empty()),
        profile.private_key.as_deref().map(|value| value.chars().count()).unwrap_or(0),
        profile.passphrase.as_deref().is_some_and(|value| !value.is_empty()),
        profile.passphrase.as_deref().map(|value| value.chars().count()).unwrap_or(0),
    );

    match profile.auth_type.as_str() {
        "password" => {
            let password = profile.password.clone().filter(|value| !value.is_empty());
            set_profile_password(&profile.id, password.as_deref()).map_err(|e| e.to_string())?;
            delete_profile_secrets(&profile.id, &["private_key", "passphrase"])
                .map_err(|e| e.to_string())?;

            profile.password = password
                .as_ref()
                .map(|value| crate::models::encode_password(value));
            profile.password_encrypted = profile.password.is_some();
            profile.private_key = None;
            profile.passphrase = None;
        }
        "privateKey" => {
            set_profile_private_key(&profile.id, profile.private_key.as_deref())
                .map_err(|e| e.to_string())?;
            set_profile_passphrase(&profile.id, profile.passphrase.as_deref())
                .map_err(|e| e.to_string())?;
            delete_profile_secrets(&profile.id, &["password"]).map_err(|e| e.to_string())?;

            profile.password = None;
            profile.password_encrypted = false;
            profile.private_key = None;
            profile.passphrase = None;
        }
        _ => {
            delete_profile_secrets(&profile.id, &["password", "private_key", "passphrase"])
                .map_err(|e| e.to_string())?;

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
    eprintln!(
        "[tinyterm profile save] action=update profile_id={} auth_type={} password_present={} password_len={} private_key_present={} private_key_len={} passphrase_present={} passphrase_len={}",
        profile.id,
        profile.auth_type,
        profile.password.as_deref().is_some_and(|value| !value.is_empty()),
        profile.password.as_deref().map(|value| value.chars().count()).unwrap_or(0),
        profile.private_key.as_deref().is_some_and(|value| !value.is_empty()),
        profile.private_key.as_deref().map(|value| value.chars().count()).unwrap_or(0),
        profile.passphrase.as_deref().is_some_and(|value| !value.is_empty()),
        profile.passphrase.as_deref().map(|value| value.chars().count()).unwrap_or(0),
    );

    let existing_profile = storage::list_profiles(&db_path)
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|item| item.id == profile.id);

    match profile.auth_type.as_str() {
        "password" => {
            let password = resolve_profile_password(&profile, existing_profile.as_ref())?;
            set_profile_password(&profile.id, password.as_deref()).map_err(|e| e.to_string())?;
            delete_profile_secrets(&profile.id, &["private_key", "passphrase"])
                .map_err(|e| e.to_string())?;

            profile.password = password
                .as_ref()
                .map(|value| crate::models::encode_password(value));
            profile.password_encrypted = profile.password.is_some();
            profile.private_key = None;
            profile.passphrase = None;
        }
        "privateKey" => {
            let private_key = resolve_profile_plain_secret(
                profile.private_key.as_deref(),
                get_profile_private_key(&profile.id).map_err(|e| e.to_string())?,
                existing_profile.as_ref().and_then(|existing| existing.private_key.as_ref()),
            )?;
            let passphrase = resolve_profile_plain_secret(
                profile.passphrase.as_deref(),
                get_profile_passphrase(&profile.id).map_err(|e| e.to_string())?,
                existing_profile.as_ref().and_then(|existing| existing.passphrase.as_ref()),
            )?;

            set_profile_private_key(&profile.id, private_key.as_deref()).map_err(|e| e.to_string())?;
            set_profile_passphrase(&profile.id, passphrase.as_deref()).map_err(|e| e.to_string())?;
            delete_profile_secrets(&profile.id, &["password"]).map_err(|e| e.to_string())?;

            profile.password = None;
            profile.password_encrypted = false;
            profile.private_key = None;
            profile.passphrase = None;
        }
        _ => {
            delete_profile_secrets(&profile.id, &["password", "private_key", "passphrase"])
                .map_err(|e| e.to_string())?;

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
    delete_profile_secrets(&id, &["password", "private_key", "passphrase"])
        .map_err(|e| e.to_string())?;
    storage::delete_profile(&db_path, &id).map_err(|e| e.to_string())
}
