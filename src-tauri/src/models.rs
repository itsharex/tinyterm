use serde::{Deserialize, Serialize};
use uuid::Uuid;

// SSH Bookmark
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bookmark {
    pub id: String,
    pub title: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: String, // "password" | "privateKey" | "profile"
    pub password: Option<String>,
    pub password_encrypted: bool,
    pub private_key: Option<String>,
    pub passphrase: Option<String>,
    pub profile_id: Option<String>,
    pub group_id: Option<String>,
    pub term: String,
    pub encode: String,
    pub color: Option<String>,
    pub description: Option<String>,
    pub start_directory_remote: Option<String>,
    pub start_directory_local: Option<String>,
    pub enable_sftp: bool,
    pub keepalive_interval: u32,
    pub created_at: i64,
    pub updated_at: i64,
}

impl Bookmark {
    pub fn new_default() -> Self {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        Self {
            id: Uuid::new_v4().to_string(),
            title: String::new(),
            host: String::new(),
            port: 22,
            username: String::new(),
            auth_type: "password".to_string(),
            password: None,
            password_encrypted: false,
            private_key: None,
            passphrase: None,
            profile_id: None,
            group_id: None,
            term: "xterm-256color".to_string(),
            encode: "utf8".to_string(),
            color: None,
            description: None,
            start_directory_remote: None,
            start_directory_local: None,
            enable_sftp: true,
            keepalive_interval: 30000,
            created_at: now,
            updated_at: now,
        }
    }
}

// Bookmark Group
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookmarkGroup {
    pub id: String,
    pub title: String,
    pub parent_id: Option<String>,
    pub order_index: i32,
    pub created_at: i64,
}

impl BookmarkGroup {
    pub fn new(title: String) -> Self {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        Self {
            id: Uuid::new_v4().to_string(),
            title,
            parent_id: None,
            order_index: 0,
            created_at: now,
        }
    }
}

// Authentication Profile
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub id: String,
    pub title: String,
    pub username: String,
    pub auth_type: String,
    pub password: Option<String>,
    pub password_encrypted: bool,
    pub private_key: Option<String>,
    pub passphrase: Option<String>,
    pub created_at: i64,
}

impl Profile {
    pub fn new(title: String, username: String) -> Self {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        Self {
            id: Uuid::new_v4().to_string(),
            title,
            username,
            auth_type: "password".to_string(),
            password: None,
            password_encrypted: false,
            private_key: None,
            passphrase: None,
            created_at: now,
        }
    }
}

// App Settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub font_size: u32,
    pub font_family: String,
    pub theme: String,
    pub opacity: f32,
    pub language: String,
    pub scrollback: u32,
    pub show_hidden_files: bool,
    pub default_protocol: String,
    pub cursor_style: String,
    pub cursor_blink: bool,
    pub bell_style: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            font_size: 12,
            font_family: "Menlo, Monaco, 'Courier New', monospace".to_string(),
            theme: "dark".to_string(),
            opacity: 1.0,
            language: "zh".to_string(),
            scrollback: 5000,
            show_hidden_files: false,
            default_protocol: "ssh".to_string(),
            cursor_style: "block".to_string(),
            cursor_blink: true,
            bell_style: "none".to_string(),
        }
    }
}

// File info for SFTP
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileInfo {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<i64>,
    pub permissions: Option<String>,
    pub owner: Option<String>,
}

// Transfer progress
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferProgress {
    pub id: String,
    pub file_name: String,
    pub direction: String, // "upload" | "download"
    pub total: u64,
    pub transferred: u64,
    pub status: String, // "pending" | "transferring" | "done" | "error" | "conflict"
    pub error: Option<String>,
    pub target_path: Option<String>,
    pub conflict_path: Option<String>,
    pub conflict_is_dir: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteDeleteStatus {
    pub path: String,
    pub is_dir: bool,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustedHostKey {
    pub host: String,
    pub port: u16,
    pub key_type: String,
    pub fingerprint: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostKeyVerificationPrompt {
    pub host: String,
    pub port: u16,
    pub key_type: String,
    pub fingerprint: String,
    pub reason: String,
}

// Password encode/decode (simple obfuscation matching electerm)
pub fn encode_password(s: &str) -> String {
    s.chars()
        .enumerate()
        .map(|(i, c)| char::from_u32(((c as u32 + i as u32 + 1) % 65536) as u32).unwrap_or(c))
        .collect()
}

pub fn decode_password(s: &str) -> String {
    s.chars()
        .enumerate()
        .map(|(i, c)| {
            let code = c as u32;
            let shifted = i as u32 + 1;
            let result = if code >= shifted {
                code - shifted
            } else {
                code + 65536 - shifted
            };
            char::from_u32(result).unwrap_or(c)
        })
        .collect()
}
