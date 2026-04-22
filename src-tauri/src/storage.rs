use anyhow::Result;
use rusqlite::{Connection, params};
use std::path::PathBuf;
use crate::crypto;
use crate::models::{Bookmark, BookmarkGroup, Profile, Settings, TrustedHostKey};

pub struct DbPath(pub PathBuf);

pub fn init_db(path: &PathBuf) -> Result<()> {
    let conn = Connection::open(path)?;
    conn.execute_batch("
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS bookmarks (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            host TEXT NOT NULL,
            port INTEGER NOT NULL DEFAULT 22,
            username TEXT NOT NULL,
            auth_type TEXT NOT NULL DEFAULT 'password',
            password TEXT,
            password_encrypted INTEGER NOT NULL DEFAULT 0,
            private_key TEXT,
            passphrase TEXT,
            profile_id TEXT,
            group_id TEXT,
            term TEXT NOT NULL DEFAULT 'xterm-256color',
            encode TEXT NOT NULL DEFAULT 'utf8',
            color TEXT,
            description TEXT,
            start_directory_remote TEXT,
            start_directory_local TEXT,
            enable_sftp INTEGER NOT NULL DEFAULT 1,
            keepalive_interval INTEGER NOT NULL DEFAULT 30000,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS bookmark_groups (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            parent_id TEXT,
            order_index INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS profiles (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            username TEXT NOT NULL,
            auth_type TEXT NOT NULL DEFAULT 'password',
            password TEXT,
            password_encrypted INTEGER NOT NULL DEFAULT 0,
            private_key TEXT,
            passphrase TEXT,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            font_size INTEGER NOT NULL DEFAULT 12,
            font_family TEXT NOT NULL DEFAULT 'Menlo, Monaco, ''Courier New'', monospace',
            theme TEXT NOT NULL DEFAULT 'dark',
            opacity REAL NOT NULL DEFAULT 1.0,
            language TEXT NOT NULL DEFAULT 'zh',
            scrollback INTEGER NOT NULL DEFAULT 5000,
            show_hidden_files INTEGER NOT NULL DEFAULT 0,
            default_protocol TEXT NOT NULL DEFAULT 'ssh',
            cursor_style TEXT NOT NULL DEFAULT 'block',
            cursor_blink INTEGER NOT NULL DEFAULT 1,
            bell_style TEXT NOT NULL DEFAULT 'none'
        );
        CREATE TABLE IF NOT EXISTS trusted_host_keys (
            host TEXT NOT NULL,
            port INTEGER NOT NULL,
            key_type TEXT NOT NULL,
            fingerprint TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (host, port)
        );
        INSERT OR IGNORE INTO settings (id) VALUES (1);
    ")?;
    Ok(())
}

fn get_conn(db_path: &DbPath) -> Result<Connection> {
    Ok(Connection::open(&db_path.0)?)
}

// ---- Bookmarks ----

pub fn list_bookmarks(db_path: &DbPath) -> Result<Vec<Bookmark>> {
    let conn = get_conn(db_path)?;
    let mut stmt = conn.prepare("SELECT id, title, host, port, username, auth_type, password, password_encrypted, private_key, passphrase, profile_id, group_id, term, encode, color, description, start_directory_remote, start_directory_local, enable_sftp, keepalive_interval, created_at, updated_at FROM bookmarks ORDER BY created_at ASC")?;
    let items = stmt.query_map([], |row| {
        Ok(Bookmark {
            id: row.get(0)?,
            title: row.get(1)?,
            host: row.get(2)?,
            port: row.get(3)?,
            username: row.get(4)?,
            auth_type: row.get(5)?,
            password: row.get(6)?,
            password_encrypted: row.get::<_, i32>(7)? != 0,
            private_key: row.get(8)?,
            passphrase: row.get(9)?,
            profile_id: row.get(10)?,
            group_id: row.get(11)?,
            term: row.get(12)?,
            encode: row.get(13)?,
            color: row.get(14)?,
            description: row.get(15)?,
            start_directory_remote: row.get(16)?,
            start_directory_local: row.get(17)?,
            enable_sftp: row.get::<_, i32>(18)? != 0,
            keepalive_interval: row.get(19)?,
            created_at: row.get(20)?,
            updated_at: row.get(21)?,
        })
    })?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(items)
}

pub fn create_bookmark(db_path: &DbPath, bookmark: &Bookmark) -> Result<()> {
    let conn = get_conn(db_path)?;
    conn.execute(
        "INSERT INTO bookmarks (id, title, host, port, username, auth_type, password, password_encrypted, private_key, passphrase, profile_id, group_id, term, encode, color, description, start_directory_remote, start_directory_local, enable_sftp, keepalive_interval, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)",
        params![
            bookmark.id, bookmark.title, bookmark.host, bookmark.port,
            bookmark.username, bookmark.auth_type, bookmark.password,
            bookmark.password_encrypted as i32, bookmark.private_key,
            bookmark.passphrase, bookmark.profile_id, bookmark.group_id,
            bookmark.term, bookmark.encode, bookmark.color, bookmark.description,
            bookmark.start_directory_remote, bookmark.start_directory_local,
            bookmark.enable_sftp as i32, bookmark.keepalive_interval,
            bookmark.created_at, bookmark.updated_at,
        ],
    )?;
    Ok(())
}

pub fn update_bookmark(db_path: &DbPath, bookmark: &Bookmark) -> Result<()> {
    let conn = get_conn(db_path)?;
    conn.execute(
        "UPDATE bookmarks SET title=?2, host=?3, port=?4, username=?5, auth_type=?6, password=?7, password_encrypted=?8, private_key=?9, passphrase=?10, profile_id=?11, group_id=?12, term=?13, encode=?14, color=?15, description=?16, start_directory_remote=?17, start_directory_local=?18, enable_sftp=?19, keepalive_interval=?20, updated_at=?21 WHERE id=?1",
        params![
            bookmark.id, bookmark.title, bookmark.host, bookmark.port,
            bookmark.username, bookmark.auth_type, bookmark.password,
            bookmark.password_encrypted as i32, bookmark.private_key,
            bookmark.passphrase, bookmark.profile_id, bookmark.group_id,
            bookmark.term, bookmark.encode, bookmark.color, bookmark.description,
            bookmark.start_directory_remote, bookmark.start_directory_local,
            bookmark.enable_sftp as i32, bookmark.keepalive_interval,
            bookmark.updated_at,
        ],
    )?;
    Ok(())
}

pub fn delete_bookmark(db_path: &DbPath, id: &str) -> Result<()> {
    let conn = get_conn(db_path)?;
    conn.execute("DELETE FROM bookmarks WHERE id=?1", params![id])?;
    Ok(())
}

pub fn upsert_trusted_host_key(db_path: &DbPath, trusted_host_key: &TrustedHostKey) -> Result<()> {
    let conn = get_conn(db_path)?;
    conn.execute(
        "INSERT INTO trusted_host_keys (host, port, key_type, fingerprint, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(host, port) DO UPDATE SET key_type=excluded.key_type, fingerprint=excluded.fingerprint, updated_at=excluded.updated_at",
        params![
            trusted_host_key.host,
            trusted_host_key.port,
            trusted_host_key.key_type,
            trusted_host_key.fingerprint,
            trusted_host_key.created_at,
            trusted_host_key.updated_at,
        ],
    )?;
    Ok(())
}

pub fn get_trusted_host_key(db_path: &DbPath, host: &str, port: u16) -> Result<Option<TrustedHostKey>> {
    let conn = get_conn(db_path)?;
    let result = conn.query_row(
        "SELECT host, port, key_type, fingerprint, created_at, updated_at FROM trusted_host_keys WHERE host=?1 AND port=?2",
        params![host, port],
        |row| {
            Ok(TrustedHostKey {
                host: row.get(0)?,
                port: row.get(1)?,
                key_type: row.get(2)?,
                fingerprint: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        },
    );

    match result {
        Ok(record) => Ok(Some(record)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(error.into()),
    }
}

pub fn normalize_stored_secrets(db_path: &DbPath) -> Result<()> {
    let conn = get_conn(db_path)?;

    {
        let mut stmt = conn.prepare(
            "SELECT id, auth_type, password, password_encrypted, private_key, passphrase FROM bookmarks",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, i32>(3)? != 0,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
            ))
        })?;

        for row in rows {
            let (id, auth_type, password, password_encrypted, private_key, passphrase) = row?;

            if auth_type != "password" && auth_type != "privateKey" && auth_type != "profile" {
                continue;
            }

            if auth_type == "password" {
                let synced_password = password
                    .filter(|value| !value.is_empty())
                    .map(|password| {
                        let plaintext = if crypto::is_encrypted_secret(&password) {
                            crypto::decrypt_secret(&db_path.0, &password)?
                        } else if password_encrypted {
                            crate::models::decode_password(&password)
                        } else {
                            password
                        };

                        crypto::encrypt_secret(&db_path.0, &plaintext)
                    })
                    .transpose()?;

                let password_present = synced_password.is_some() as i32;
                conn.execute(
                    "UPDATE bookmarks SET password=?2, password_encrypted=?3, private_key=NULL, passphrase=NULL WHERE id=?1",
                    params![id, synced_password, password_present],
                )?;
            } else if auth_type == "privateKey" {
                let synced_private_key = private_key
                    .filter(|value| !value.is_empty())
                    .map(|value| {
                        if crypto::is_encrypted_secret(&value) {
                            Ok(value)
                        } else {
                            crypto::encrypt_secret(&db_path.0, &value)
                        }
                    })
                    .transpose()?;
                let synced_passphrase = passphrase
                    .filter(|value| !value.is_empty())
                    .map(|value| {
                        if crypto::is_encrypted_secret(&value) {
                            Ok(value)
                        } else {
                            crypto::encrypt_secret(&db_path.0, &value)
                        }
                    })
                    .transpose()?;

                conn.execute(
                    "UPDATE bookmarks SET password=NULL, password_encrypted=0, private_key=?2, passphrase=?3 WHERE id=?1",
                    params![id, synced_private_key, synced_passphrase],
                )?;
            } else {
                conn.execute(
                    "UPDATE bookmarks SET password=NULL, password_encrypted=0, private_key=NULL, passphrase=NULL WHERE id=?1",
                    params![id],
                )?;
            }
        }
    }

    conn.execute(
        "UPDATE bookmarks SET private_key=NULL, passphrase=NULL WHERE auth_type != 'privateKey'",
        [],
    )?;

    {
        let mut stmt = conn.prepare(
            "SELECT id, auth_type, password, password_encrypted, private_key, passphrase FROM profiles",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, i32>(3)? != 0,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
            ))
        })?;

        for row in rows {
            let (id, auth_type, password, password_encrypted, private_key, passphrase) = row?;

            if auth_type == "password" {
                let synced_password = password
                    .filter(|value| !value.is_empty())
                    .map(|password| {
                        let plaintext = if crypto::is_encrypted_secret(&password) {
                            crypto::decrypt_secret(&db_path.0, &password)?
                        } else if password_encrypted {
                            crate::models::decode_password(&password)
                        } else {
                            password
                        };

                        crypto::encrypt_secret(&db_path.0, &plaintext)
                    })
                    .transpose()?;

                let password_present = synced_password.is_some() as i32;
                conn.execute(
                    "UPDATE profiles SET password=?2, password_encrypted=?3, private_key=NULL, passphrase=NULL WHERE id=?1",
                    params![id, synced_password, password_present],
                )?;
            } else if auth_type == "privateKey" {
                let synced_private_key = private_key
                    .filter(|value| !value.is_empty())
                    .map(|value| {
                        if crypto::is_encrypted_secret(&value) {
                            Ok(value)
                        } else {
                            crypto::encrypt_secret(&db_path.0, &value)
                        }
                    })
                    .transpose()?;
                let synced_passphrase = passphrase
                    .filter(|value| !value.is_empty())
                    .map(|value| {
                        if crypto::is_encrypted_secret(&value) {
                            Ok(value)
                        } else {
                            crypto::encrypt_secret(&db_path.0, &value)
                        }
                    })
                    .transpose()?;

                conn.execute(
                    "UPDATE profiles SET password=NULL, password_encrypted=0, private_key=?2, passphrase=?3 WHERE id=?1",
                    params![id, synced_private_key, synced_passphrase],
                )?;
            } else {
                conn.execute(
                    "UPDATE profiles SET password=NULL, password_encrypted=0, private_key=NULL, passphrase=NULL WHERE id=?1",
                    params![id],
                )?;
            }
        }
    }

    conn.execute(
        "UPDATE profiles SET private_key=NULL, passphrase=NULL WHERE auth_type != 'privateKey'",
        [],
    )?;

    Ok(())
}

// ---- Bookmark Groups ----

pub fn list_bookmark_groups(db_path: &DbPath) -> Result<Vec<BookmarkGroup>> {
    let conn = get_conn(db_path)?;
    let mut stmt = conn.prepare("SELECT id, title, parent_id, order_index, created_at FROM bookmark_groups ORDER BY order_index ASC")?;
    let items = stmt.query_map([], |row| {
        Ok(BookmarkGroup {
            id: row.get(0)?,
            title: row.get(1)?,
            parent_id: row.get(2)?,
            order_index: row.get(3)?,
            created_at: row.get(4)?,
        })
    })?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(items)
}

pub fn create_bookmark_group(db_path: &DbPath, group: &BookmarkGroup) -> Result<()> {
    let conn = get_conn(db_path)?;
    conn.execute(
        "INSERT INTO bookmark_groups (id, title, parent_id, order_index, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![group.id, group.title, group.parent_id, group.order_index, group.created_at],
    )?;
    Ok(())
}

pub fn update_bookmark_group(db_path: &DbPath, group: &BookmarkGroup) -> Result<()> {
    let conn = get_conn(db_path)?;
    conn.execute(
        "UPDATE bookmark_groups SET title=?2, parent_id=?3, order_index=?4 WHERE id=?1",
        params![group.id, group.title, group.parent_id, group.order_index],
    )?;
    Ok(())
}

pub fn delete_bookmark_group(db_path: &DbPath, id: &str) -> Result<()> {
    let conn = get_conn(db_path)?;
    conn.execute("DELETE FROM bookmark_groups WHERE id=?1", params![id])?;
    // Move bookmarks in this group to no group
    conn.execute("UPDATE bookmarks SET group_id=NULL WHERE group_id=?1", params![id])?;
    Ok(())
}

// ---- Profiles ----

pub fn list_profiles(db_path: &DbPath) -> Result<Vec<Profile>> {
    let conn = get_conn(db_path)?;
    let mut stmt = conn.prepare("SELECT id, title, username, auth_type, password, password_encrypted, private_key, passphrase, created_at FROM profiles ORDER BY created_at ASC")?;
    let items = stmt.query_map([], |row| {
        Ok(Profile {
            id: row.get(0)?,
            title: row.get(1)?,
            username: row.get(2)?,
            auth_type: row.get(3)?,
            password: row.get(4)?,
            password_encrypted: row.get::<_, i32>(5)? != 0,
            private_key: row.get(6)?,
            passphrase: row.get(7)?,
            created_at: row.get(8)?,
        })
    })?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(items)
}

pub fn create_profile(db_path: &DbPath, profile: &Profile) -> Result<()> {
    let conn = get_conn(db_path)?;
    conn.execute(
        "INSERT INTO profiles (id, title, username, auth_type, password, password_encrypted, private_key, passphrase, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![profile.id, profile.title, profile.username, profile.auth_type, profile.password, profile.password_encrypted as i32, profile.private_key, profile.passphrase, profile.created_at],
    )?;
    Ok(())
}

pub fn update_profile(db_path: &DbPath, profile: &Profile) -> Result<()> {
    let conn = get_conn(db_path)?;
    conn.execute(
        "UPDATE profiles SET title=?2, username=?3, auth_type=?4, password=?5, password_encrypted=?6, private_key=?7, passphrase=?8 WHERE id=?1",
        params![profile.id, profile.title, profile.username, profile.auth_type, profile.password, profile.password_encrypted as i32, profile.private_key, profile.passphrase],
    )?;
    Ok(())
}

pub fn delete_profile(db_path: &DbPath, id: &str) -> Result<()> {
    let conn = get_conn(db_path)?;
    conn.execute("DELETE FROM profiles WHERE id=?1", params![id])?;
    Ok(())
}

// ---- Settings ----

pub fn get_settings(db_path: &DbPath) -> Result<Settings> {
    let conn = get_conn(db_path)?;
    let settings = conn.query_row(
        "SELECT font_size, font_family, theme, opacity, language, scrollback, show_hidden_files, default_protocol, cursor_style, cursor_blink, bell_style FROM settings WHERE id=1",
        [],
        |row| Ok(Settings {
            font_size: row.get(0)?,
            font_family: row.get(1)?,
            theme: row.get(2)?,
            opacity: row.get(3)?,
            language: row.get(4)?,
            scrollback: row.get(5)?,
            show_hidden_files: row.get::<_, i32>(6)? != 0,
            default_protocol: row.get(7)?,
            cursor_style: row.get(8)?,
            cursor_blink: row.get::<_, i32>(9)? != 0,
            bell_style: row.get(10)?,
        }),
    )?;
    Ok(settings)
}

pub fn update_settings(db_path: &DbPath, settings: &Settings) -> Result<()> {
    let conn = get_conn(db_path)?;
    conn.execute(
        "UPDATE settings SET font_size=?1, font_family=?2, theme=?3, opacity=?4, language=?5, scrollback=?6, show_hidden_files=?7, default_protocol=?8, cursor_style=?9, cursor_blink=?10, bell_style=?11 WHERE id=1",
        params![
            settings.font_size, settings.font_family, settings.theme,
            settings.opacity, settings.language, settings.scrollback,
            settings.show_hidden_files as i32, settings.default_protocol,
            settings.cursor_style, settings.cursor_blink as i32, settings.bell_style,
        ],
    )?;
    Ok(())
}
