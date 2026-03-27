use std::fs;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::Arc;
use tauri::{Emitter, State};

use crate::models::{Bookmark, FileInfo};
use crate::session::SessionManager;
use crate::ssh;

/// Acquire the dedicated SFTP session Arc and connection info from the HashMap,
/// releasing the HashMap lock immediately so other sessions are never blocked.
///
/// The returned Arc wraps an `Option<ssh2::Session>` — `None` means the SFTP
/// session hasn't been created yet and must be lazily initialised.
fn get_sftp_info(
    session_manager: &State<SessionManager>,
    session_id: &str,
) -> Result<(Arc<parking_lot::Mutex<Option<ssh2::Session>>>, Bookmark, Option<String>), String> {
    let sessions = session_manager.sessions.lock();
    let s = sessions
        .get(session_id)
        .ok_or_else(|| "Session not found".to_string())?;
    Ok((
        Arc::clone(&s.sftp_session),
        s.resolved_bookmark.clone(),
        s.password_override.clone(),
    ))
}

/// Ensure the dedicated SFTP session exists inside the guard, creating it
/// lazily if needed.  Returns a reference to the live `ssh2::Session`.
///
/// The SFTP session is a **separate TCP + SSH connection** to the same host,
/// so it never contends with the terminal PTY read/write mutex.
fn ensure_sftp_session<'a>(
    guard: &'a mut Option<ssh2::Session>,
    bookmark: &Bookmark,
    password: Option<&str>,
) -> Result<&'a ssh2::Session, String> {
    if guard.is_none() {
        let sess = ssh::connect_ssh(bookmark, password)
            .map_err(|e| format!("SFTP connection failed: {}", e))?;
        // Keep the SFTP session in blocking mode permanently — it never
        // shares the PTY channel so there is no need to toggle.
        sess.set_blocking(true);
        *guard = Some(sess);
    }
    Ok(guard.as_ref().unwrap())
}

/// Run a closure that needs an SFTP subsystem.
///
/// Takes care of:
///   1. Acquiring (or lazily creating) the dedicated SFTP SSH session
///   2. Passing an `ssh2::Sftp` handle to the closure
///   3. Invalidating the cached session on connection-level errors so the
///      next call will reconnect automatically
fn with_sftp<T>(
    session_manager: &State<SessionManager>,
    session_id: &str,
    body: impl FnOnce(&ssh2::Sftp) -> Result<T, String>,
) -> Result<T, String> {
    let (sftp_arc, bookmark, password) = get_sftp_info(session_manager, session_id)?;
    let mut guard = sftp_arc.lock();

    let sess = ensure_sftp_session(&mut guard, &bookmark, password.as_deref())?;

    let sftp = sess.sftp().map_err(|e| {
        // If the SFTP subsystem can't be opened the underlying connection may
        // be broken — drop the cached session so the next attempt reconnects.
        *guard = None;
        format!("SFTP init failed: {}", e)
    })?;

    let result = body(&sftp);

    // If the operation itself failed due to a transport-level error, invalidate
    // the session so subsequent calls reconnect.
    if let Err(ref e) = result {
        let msg = e.to_lowercase();
        if msg.contains("channel")
            || msg.contains("transport")
            || msg.contains("eof")
            || msg.contains("broken pipe")
            || msg.contains("connection reset")
        {
            *guard = None;
        }
    }

    result
}

// ── Remote directory listing ────────────────────────────────────────────────

#[tauri::command]
pub fn list_remote_dir(
    session_manager: State<SessionManager>,
    session_id: String,
    path: String,
) -> Result<Vec<FileInfo>, String> {
    let entries = with_sftp(&session_manager, &session_id, |sftp| {
        sftp.readdir(Path::new(&path))
            .map_err(|e| format!("readdir failed: {}", e))
    })?;

    let mut files: Vec<FileInfo> = entries
        .into_iter()
        .map(|(pathbuf, stat)| {
            let name = pathbuf
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            let full_path = format!("{}/{}", path.trim_end_matches('/'), name);
            FileInfo {
                name,
                path: full_path,
                is_dir: stat.is_dir(),
                size: stat.size.unwrap_or(0),
                modified: stat.mtime.map(|t| t as i64),
                permissions: stat.perm.map(|p| format!("{:o}", p)),
                owner: None,
            }
        })
        .collect();

    files.sort_by(|a, b| {
        if a.is_dir == b.is_dir {
            a.name.cmp(&b.name)
        } else {
            b.is_dir.cmp(&a.is_dir)
        }
    });

    Ok(files)
}

// ── Local directory listing ─────────────────────────────────────────────────

#[tauri::command]
pub fn list_local_dir(path: String) -> Result<Vec<FileInfo>, String> {
    let entries = fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut files = Vec::new();

    for entry in entries.flatten() {
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        let full_path = entry.path().to_string_lossy().to_string();
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64);
        files.push(FileInfo {
            name,
            path: full_path,
            is_dir: meta.is_dir(),
            size: meta.len(),
            modified,
            permissions: None,
            owner: None,
        });
    }

    files.sort_by(|a, b| {
        if a.is_dir == b.is_dir {
            a.name.cmp(&b.name)
        } else {
            b.is_dir.cmp(&a.is_dir)
        }
    });

    Ok(files)
}

// ── Upload (local → remote) ────────────────────────────────────────────────

#[tauri::command]
pub fn upload_file(
    session_manager: State<SessionManager>,
    session_id: String,
    local_path: String,
    remote_path: String,
    window: tauri::Window,
) -> Result<(), String> {
    // Read local file BEFORE acquiring any SSH locks
    let local_data = fs::read(&local_path).map_err(|e| e.to_string())?;
    let total = local_data.len() as u64;
    let file_name = Path::new(&local_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string();

    with_sftp(&session_manager, &session_id, |sftp| {
        let remote = Path::new(&remote_path);
        let mut remote_file = sftp
            .create(remote)
            .map_err(|e| format!("Create remote file failed: {}", e))?;

        const CHUNK: usize = 32768;
        let mut transferred = 0u64;
        for chunk in local_data.chunks(CHUNK) {
            remote_file.write_all(chunk).map_err(|e| e.to_string())?;
            transferred += chunk.len() as u64;
            let _ = window.emit(
                "transfer-progress",
                serde_json::json!({
                    "file_name": file_name,
                    "direction": "upload",
                    "total": total,
                    "transferred": transferred,
                    "status": "transferring"
                }),
            );
        }
        Ok(())
    })?;

    let _ = window.emit(
        "transfer-progress",
        serde_json::json!({
            "file_name": file_name,
            "direction": "upload",
            "total": total,
            "transferred": total,
            "status": "done"
        }),
    );

    Ok(())
}

// ── Download (remote → local) ───────────────────────────────────────────────

#[tauri::command]
pub fn download_file(
    session_manager: State<SessionManager>,
    session_id: String,
    remote_path: String,
    local_path: String,
    window: tauri::Window,
) -> Result<(), String> {
    let file_name = Path::new(&remote_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string();

    // Download uses the dedicated SFTP session for the read so the terminal
    // PTY channel stays responsive throughout the transfer.
    let (sftp_arc, bookmark, password) = get_sftp_info(&session_manager, &session_id)?;
    let mut guard = sftp_arc.lock();
    let sess = ensure_sftp_session(&mut guard, &bookmark, password.as_deref())?;

    // SCP recv needs a blocking session (already the case for our SFTP session)
    let buf = {
        let (mut remote_file, stat) = sess
            .scp_recv(Path::new(&remote_path))
            .map_err(|e| format!("SCP recv failed: {}", e))?;

        let total = stat.size();
        let mut buf = Vec::new();
        let mut transferred = 0u64;
        let mut tmp = [0u8; 32768];

        loop {
            match remote_file.read(&mut tmp) {
                Ok(0) => break,
                Ok(n) => {
                    buf.extend_from_slice(&tmp[..n]);
                    transferred += n as u64;
                    let _ = window.emit(
                        "transfer-progress",
                        serde_json::json!({
                            "file_name": file_name,
                            "direction": "download",
                            "total": total,
                            "transferred": transferred,
                            "status": "transferring"
                        }),
                    );
                }
                Err(e) => return Err(e.to_string()),
            }
        }
        buf
    };

    // Release the SFTP session lock before doing local I/O
    drop(guard);

    let total = buf.len() as u64;
    fs::write(&local_path, &buf).map_err(|e| e.to_string())?;

    let _ = window.emit(
        "transfer-progress",
        serde_json::json!({
            "file_name": file_name,
            "direction": "download",
            "total": total,
            "transferred": total,
            "status": "done"
        }),
    );

    Ok(())
}

// ── Remote file/directory operations ────────────────────────────────────────

#[tauri::command]
pub fn delete_remote(
    session_manager: State<SessionManager>,
    session_id: String,
    path: String,
    is_dir: bool,
) -> Result<(), String> {
    with_sftp(&session_manager, &session_id, |sftp| {
        if is_dir {
            sftp.rmdir(Path::new(&path)).map_err(|e| e.to_string())
        } else {
            sftp.unlink(Path::new(&path)).map_err(|e| e.to_string())
        }
    })
}

#[tauri::command]
pub fn create_remote_dir(
    session_manager: State<SessionManager>,
    session_id: String,
    path: String,
) -> Result<(), String> {
    with_sftp(&session_manager, &session_id, |sftp| {
        sftp.mkdir(Path::new(&path), 0o755)
            .map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn rename_remote(
    session_manager: State<SessionManager>,
    session_id: String,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    with_sftp(&session_manager, &session_id, |sftp| {
        sftp.rename(Path::new(&old_path), Path::new(&new_path), None)
            .map_err(|e| e.to_string())
    })
}

// ── Local file/directory operations ─────────────────────────────────────────

#[tauri::command]
pub fn delete_local(path: String, is_dir: bool) -> Result<(), String> {
    if is_dir {
        fs::remove_dir_all(&path).map_err(|e| e.to_string())
    } else {
        fs::remove_file(&path).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn create_local_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_local(old_path: String, new_path: String) -> Result<(), String> {
    fs::rename(&old_path, &new_path).map_err(|e| e.to_string())
}