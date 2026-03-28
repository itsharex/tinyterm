use anyhow::Result;
use keyring::Entry;

const SERVICE_NAME: &str = "tinyterm";
const ENTRY_ACCOUNT: &str = "secret";

fn entry(scope: &str, id: &str, field: &str) -> Result<Entry> {
    Entry::new(
        &format!("{}.{}.{}.{}", SERVICE_NAME, scope, field, id),
        ENTRY_ACCOUNT,
    )
    .map_err(Into::into)
}

fn legacy_entry(scope: &str, id: &str, field: &str) -> Result<Entry> {
    Entry::new(SERVICE_NAME, &format!("{}:{}:{}", scope, id, field)).map_err(Into::into)
}

fn get_secret(scope: &str, id: &str, field: &str) -> Result<Option<String>> {
    let entry = entry(scope, id, field)?;
    match entry.get_password() {
        Ok(value) if value.is_empty() => {
            eprintln!(
                "[tinyterm keychain get] scope={} id={} field={} found=true len=0",
                scope,
                id,
                field,
            );
            Ok(None)
        }
        Ok(value) => {
            eprintln!(
                "[tinyterm keychain get] scope={} id={} field={} found=true len={}",
                scope,
                id,
                field,
                value.chars().count(),
            );
            Ok(Some(value))
        }
        Err(keyring::Error::NoEntry) => {
            let legacy_entry = legacy_entry(scope, id, field)?;
            match legacy_entry.get_password() {
                Ok(value) if value.is_empty() => {
                    eprintln!(
                        "[tinyterm keychain get] scope={} id={} field={} found=true legacy=true len=0",
                        scope,
                        id,
                        field,
                    );
                    Ok(None)
                }
                Ok(value) => {
                    eprintln!(
                        "[tinyterm keychain get] scope={} id={} field={} found=true legacy=true len={}",
                        scope,
                        id,
                        field,
                        value.chars().count(),
                    );
                    Ok(Some(value))
                }
                Err(keyring::Error::NoEntry) => {
                    eprintln!(
                        "[tinyterm keychain get] scope={} id={} field={} found=false",
                        scope,
                        id,
                        field,
                    );
                    Ok(None)
                }
                Err(error) => {
                    eprintln!(
                        "[tinyterm keychain get] scope={} id={} field={} legacy_error={}",
                        scope,
                        id,
                        field,
                        error,
                    );
                    Err(error.into())
                }
            }
        }
        Err(error) => {
            eprintln!(
                "[tinyterm keychain get] scope={} id={} field={} error={}",
                scope,
                id,
                field,
                error,
            );
            Err(error.into())
        }
    }
}

fn set_secret(scope: &str, id: &str, field: &str, value: Option<&str>) -> Result<()> {
    let entry = entry(scope, id, field)?;
    let legacy_entry = legacy_entry(scope, id, field)?;
    if let Some(value) = value.filter(|candidate| !candidate.is_empty()) {
        eprintln!(
            "[tinyterm keychain set] scope={} id={} field={} incoming_len={}",
            scope,
            id,
            field,
            value.chars().count(),
        );

        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(error) => return Err(error.into()),
        }

        match legacy_entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(error) => return Err(error.into()),
        }

        entry.set_password(value).map_err(anyhow::Error::from)?;

        let persisted_value = entry.get_password().map_err(anyhow::Error::from)?;
        if persisted_value != value {
            anyhow::bail!("keychain verification failed for {}:{}:{}", scope, id, field);
        }

        eprintln!(
            "[tinyterm keychain set] scope={} id={} field={} verified_len={}",
            scope,
            id,
            field,
            persisted_value.chars().count(),
        );
    } else {
        eprintln!(
            "[tinyterm keychain delete] scope={} id={} field={}",
            scope,
            id,
            field,
        );
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(error) => return Err(error.into()),
        }
        match legacy_entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

fn delete_secret(scope: &str, id: &str, field: &str) -> Result<()> {
    set_secret(scope, id, field, None)
}

pub fn get_bookmark_password(id: &str) -> Result<Option<String>> {
    get_secret("bookmark", id, "password")
}

pub fn set_bookmark_password(id: &str, value: Option<&str>) -> Result<()> {
    set_secret("bookmark", id, "password", value)
}

pub fn get_bookmark_private_key(id: &str) -> Result<Option<String>> {
    get_secret("bookmark", id, "private_key")
}

pub fn set_bookmark_private_key(id: &str, value: Option<&str>) -> Result<()> {
    set_secret("bookmark", id, "private_key", value)
}

pub fn get_bookmark_passphrase(id: &str) -> Result<Option<String>> {
    get_secret("bookmark", id, "passphrase")
}

pub fn set_bookmark_passphrase(id: &str, value: Option<&str>) -> Result<()> {
    set_secret("bookmark", id, "passphrase", value)
}

pub fn delete_bookmark_secrets(id: &str, fields: &[&str]) -> Result<()> {
    for field in fields {
        delete_secret("bookmark", id, field)?;
    }
    Ok(())
}

pub fn get_profile_password(id: &str) -> Result<Option<String>> {
    get_secret("profile", id, "password")
}

pub fn set_profile_password(id: &str, value: Option<&str>) -> Result<()> {
    set_secret("profile", id, "password", value)
}

pub fn get_profile_private_key(id: &str) -> Result<Option<String>> {
    get_secret("profile", id, "private_key")
}

pub fn set_profile_private_key(id: &str, value: Option<&str>) -> Result<()> {
    set_secret("profile", id, "private_key", value)
}

pub fn get_profile_passphrase(id: &str) -> Result<Option<String>> {
    get_secret("profile", id, "passphrase")
}

pub fn set_profile_passphrase(id: &str, value: Option<&str>) -> Result<()> {
    set_secret("profile", id, "passphrase", value)
}

pub fn delete_profile_secrets(id: &str, fields: &[&str]) -> Result<()> {
    for field in fields {
        delete_secret("profile", id, field)?;
    }
    Ok(())
}