use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::Component;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter, State};
use log::{info, warn};

use crate::models::{Bookmark, FileInfo, RemoteDeleteStatus, TransferProgress};
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
) -> Result<(Arc<parking_lot::Mutex<Option<ssh2::Session>>>, Bookmark, Option<String>, String, String), String> {
    let sessions = session_manager.sessions.lock();
    let s = sessions
        .get(session_id)
        .ok_or_else(|| "Session not found".to_string())?;
    Ok((
        Arc::clone(&s.sftp_session),
        s.resolved_bookmark.clone(),
        s.password_override.clone(),
        s.trusted_host_fingerprint.clone(),
        s.trusted_host_key_type.clone(),
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
    expected_host_fingerprint: &str,
    expected_host_key_type: &str,
) -> Result<&'a ssh2::Session, String> {
    if guard.is_none() {
        let sess = ssh::connect_ssh_transport(bookmark)
            .map_err(|e| format!("SFTP connection failed: {}", e))?;
        ssh::verify_host_key(&sess, expected_host_key_type, expected_host_fingerprint)
            .map_err(|e| format!("SFTP host key verification failed: {}", e))?;
        ssh::authenticate_ssh(&sess, bookmark, password)
            .map_err(|e| format!("SFTP authentication failed: {}", e))?;
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
    let (sftp_arc, bookmark, password, trusted_host_fingerprint, trusted_host_key_type) = get_sftp_info(session_manager, session_id)?;
    let mut guard = sftp_arc.lock();

    let sess = ensure_sftp_session(
        &mut guard,
        &bookmark,
        password.as_deref(),
        &trusted_host_fingerprint,
        &trusted_host_key_type,
    )?;

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

fn is_filesystem_root(path: &Path) -> bool {
    let mut components = path.components();
    match (components.next(), components.next(), components.next()) {
        (Some(Component::RootDir), None, None) => true,
        (Some(Component::Prefix(_)), Some(Component::RootDir), None) => true,
        _ => false,
    }
}

fn guard_local_delete_target(path: &Path) -> Result<(), String> {
    if is_filesystem_root(path) {
        return Err("Refusing to delete filesystem root".to_string());
    }

    if let Some(home_dir) = dirs::home_dir() {
        let home_dir = fs::canonicalize(home_dir).map_err(|e| e.to_string())?;
        if path == home_dir {
            return Err("Refusing to delete local home directory".to_string());
        }
    }

    Ok(())
}

fn normalize_remote_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let mut normalized = trimmed.to_string();
    while normalized.len() > 1 && normalized.ends_with('/') {
        normalized.pop();
    }
    normalized
}

fn get_remote_home_dir(ssh_session: &Arc<parking_lot::Mutex<ssh2::Session>>) -> Result<String, String> {
    let sess = ssh_session.lock();
    sess.set_blocking(true);
    sess.set_timeout(5000);

    let result = (|| -> Result<String, String> {
        let mut channel = sess.channel_session().map_err(|e| format!("channel_session: {}", e))?;
        channel.exec("printf '%s' \"$HOME\"").map_err(|e| format!("exec: {}", e))?;

        let mut output = String::new();
        channel.read_to_string(&mut output).map_err(|e| format!("read: {}", e))?;
        channel.wait_close().map_err(|e| format!("wait_close: {}", e))?;

        Ok(normalize_remote_path(&output))
    })();

    sess.set_timeout(0);
    sess.set_blocking(false);

    result
}

fn guard_remote_delete_target(
    session_manager: &State<SessionManager>,
    session_id: &str,
    path: &str,
) -> Result<String, String> {
    let normalized_input = normalize_remote_path(path);
    if normalized_input.is_empty() || normalized_input == "/" {
        return Err("Refusing to delete remote root directory".to_string());
    }

    let canonical_path = with_sftp(session_manager, session_id, |sftp| {
        sftp.realpath(Path::new(&normalized_input))
            .map(|pathbuf| normalize_remote_path(&pathbuf.to_string_lossy()))
            .map_err(|_| normalized_input.clone())
    })
    .unwrap_or_else(|_| normalized_input.clone());

    if canonical_path == "/" {
        return Err("Refusing to delete remote root directory".to_string());
    }

    let ssh_session = get_ssh_session(session_manager, session_id)?;
    let home_dir = get_remote_home_dir(&ssh_session)?;
    if !home_dir.is_empty() && canonical_path == home_dir {
        return Err("Refusing to delete remote home directory".to_string());
    }

    Ok(canonical_path)
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
pub fn cancel_transfer(session_manager: State<SessionManager>, transfer_id: String) -> Result<(), String> {
    let mut cancelled = session_manager.cancelled_transfers.lock();
    cancelled.insert(transfer_id);
    Ok(())
}

fn emit_transfer_progress(
    app: &AppHandle,
    transfer_id: &str,
    file_name: &str,
    direction: &str,
    total: u64,
    transferred: u64,
    status: &str,
    error: Option<String>,
    target_path: Option<String>,
    conflict_path: Option<String>,
    conflict_is_dir: Option<bool>,
) {
    let _ = app.emit(
        "transfer-progress",
        TransferProgress {
            id: transfer_id.to_string(),
            file_name: file_name.to_string(),
            direction: direction.to_string(),
            total,
            transferred,
            status: status.to_string(),
            error,
            target_path,
            conflict_path,
            conflict_is_dir,
        },
    );
}

fn map_stage_progress(raw_total: u64, raw_transferred: u64, stage_start: u64, stage_span: u64) -> u64 {
    if stage_span == 0 {
        return stage_start;
    }
    if raw_total == 0 {
        return stage_start;
    }

    let scaled = raw_transferred.saturating_mul(stage_span) / raw_total;
    stage_start.saturating_add(scaled).min(stage_start.saturating_add(stage_span))
}

#[tauri::command]
pub fn upload_file(
    session_manager: State<SessionManager>,
    session_id: String,
    local_path: String,
    remote_path: String,
    overwrite: bool,
    transfer_id: Option<String>,
    display_name: Option<String>,
    progress_total: Option<u64>,
    progress_start: Option<u64>,
    progress_span: Option<u64>,
    target_path_override: Option<String>,
    app: AppHandle,
) -> Result<(), String> {
    info!(
        "upload_file request session_id={} local_path={} remote_path={} overwrite={} transfer_id={}",
        session_id,
        local_path,
        remote_path,
        overwrite,
        transfer_id.clone().unwrap_or_else(|| format!("upload:{}", remote_path))
    );
    let file_name = display_name.unwrap_or_else(|| {
        Path::new(&local_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string()
    });

    let raw_total = fs::metadata(&local_path)
        .map_err(|e| e.to_string())?
        .len();
    let transfer_id = transfer_id.unwrap_or_else(|| format!("upload:{}", remote_path));
    let stage_total = progress_total.unwrap_or(raw_total);
    let stage_start = progress_start.unwrap_or(0);
    let stage_span = progress_span.unwrap_or(raw_total);
    let target_path = target_path_override.unwrap_or_else(|| remote_path.clone());

    // Synchronous conflict check — stat the remote path before spawning the thread
    // so invoke() returns Err("CONFLICT:...") and the frontend can detect it directly.
    // Skipped when overwrite=true (user already confirmed they want to replace).
    if !overwrite {
        let conflict = with_sftp(&session_manager, &session_id, |sftp| {
            Ok(sftp.stat(Path::new(&remote_path)).is_ok())
        })?;
        if conflict {
            return Err(format!("CONFLICT:{}", remote_path));
        }
    }

    let sftp_info = get_sftp_info(&session_manager, &session_id)?;
    let cancelled_transfers = Arc::clone(&session_manager.cancelled_transfers);
    cancelled_transfers.lock().remove(&transfer_id);

    emit_transfer_progress(
        &app,
        &transfer_id,
        &file_name,
        "upload",
        stage_total,
        stage_start,
        "pending",
        None,
        Some(target_path.clone()),
        None,
        None,
    );

    thread::spawn(move || {
        let (sftp_arc, bookmark, password, trusted_host_fingerprint, trusted_host_key_type) = sftp_info;
        let result = (|| -> Result<(), String> {
            let local_file = File::open(&local_path).map_err(|e| e.to_string())?;
            let mut local_reader = BufReader::new(local_file);

            let mut guard = sftp_arc.lock();
            let sess = ensure_sftp_session(
                &mut guard,
                &bookmark,
                password.as_deref(),
                &trusted_host_fingerprint,
                &trusted_host_key_type,
            )?;
            let sftp = sess.sftp().map_err(|e| {
                *guard = None;
                format!("SFTP init failed: {}", e)
            })?;

            let remote = Path::new(&remote_path);
            let mut remote_file = sftp
                .create(remote)
                .map_err(|e| format!("Create remote file failed: {}", e))?;

            emit_transfer_progress(
                &app,
                &transfer_id,
                &file_name,
                "upload",
                stage_total,
                stage_start,
                "transferring",
                None,
                Some(target_path.clone()),
                None,
                None,
            );

            const CHUNK: usize = 32768;
            let mut transferred = 0u64;
            let mut last_pct = 0u64;
            let mut buf = [0u8; CHUNK];

            loop {
                if cancelled_transfers.lock().contains(&transfer_id) {
                    return Err("Cancelled".to_string());
                }

                let n = local_reader.read(&mut buf).map_err(|e| e.to_string())?;
                if n == 0 {
                    break;
                }

                remote_file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
                transferred += n as u64;

                // Throttle: emit at most once per 1 % progress change
                let pct = if raw_total > 0 { transferred * 100 / raw_total } else { 0 };
                if pct > last_pct {
                    last_pct = pct;
                    emit_transfer_progress(
                        &app,
                        &transfer_id,
                        &file_name,
                        "upload",
                        stage_total,
                        map_stage_progress(raw_total, transferred, stage_start, stage_span),
                        "transferring",
                        None,
                        Some(target_path.clone()),
                        None,
                        None,
                    );
                }
            }

            remote_file.flush().map_err(|e| e.to_string())?;
            Ok(())
        })();

        match result {
            Ok(()) => {
                info!(
                    "upload_file success transfer_id={} target_path={}",
                    transfer_id,
                    target_path
                );
                cancelled_transfers.lock().remove(&transfer_id);
                emit_transfer_progress(
                    &app,
                    &transfer_id,
                    &file_name,
                    "upload",
                    stage_total,
                    stage_start.saturating_add(stage_span).min(stage_total),
                    "done",
                    None,
                    Some(target_path.clone()),
                    None,
                    None,
                )
            }
            Err(err) => {
                warn!(
                    "upload_file failed transfer_id={} target_path={} error={}",
                    transfer_id,
                    target_path,
                    err
                );
                cancelled_transfers.lock().remove(&transfer_id);
                emit_transfer_progress(
                    &app,
                    &transfer_id,
                    &file_name,
                    "upload",
                    stage_total,
                    stage_start,
                    "error",
                    Some(err),
                    Some(target_path.clone()),
                    None,
                    None,
                )
            }
        }
    });

    Ok(())
}

// ── Download (remote → local) ───────────────────────────────────────────────

#[tauri::command]
pub fn download_file(
    session_manager: State<SessionManager>,
    session_id: String,
    remote_path: String,
    local_path: String,
    overwrite: bool,
    transfer_id: Option<String>,
    display_name: Option<String>,
    progress_total: Option<u64>,
    progress_start: Option<u64>,
    progress_span: Option<u64>,
    target_path_override: Option<String>,
    app: AppHandle,
) -> Result<(), String> {
    info!(
        "download_file request session_id={} remote_path={} local_path={} overwrite={} transfer_id={}",
        session_id,
        remote_path,
        local_path,
        overwrite,
        transfer_id.clone().unwrap_or_else(|| format!("download:{}", local_path))
    );
    let file_name = display_name.unwrap_or_else(|| {
        Path::new(&remote_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string()
    });
    let transfer_id = transfer_id.unwrap_or_else(|| format!("download:{}", local_path));
    let configured_stage_total = progress_total;
    let stage_start = progress_start.unwrap_or(0);
    let target_path = target_path_override.unwrap_or_else(|| local_path.clone());

    // Synchronous conflict check — return Err so the frontend invoke() catches it directly.
    // Skipped when overwrite=true (user already confirmed they want to replace).
    if !overwrite && Path::new(&local_path).exists() {
        return Err(format!("CONFLICT:{}", local_path));
    }

    let parent = PathBuf::from(&local_path)
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "Invalid local path".to_string())?;
    fs::create_dir_all(&parent).map_err(|e| e.to_string())?;

    emit_transfer_progress(
        &app,
        &transfer_id,
        &file_name,
        "download",
        configured_stage_total.unwrap_or(0),
        stage_start,
        "pending",
        None,
        Some(target_path.clone()),
        None,
        None,
    );

    // Spawn a background thread to run the download asynchronously.
    // Matches the behavior of upload_file for consistency.
    let sftp_info = get_sftp_info(&session_manager, &session_id)?;
    let cancelled_transfers = Arc::clone(&session_manager.cancelled_transfers);
    cancelled_transfers.lock().remove(&transfer_id);

    thread::spawn(move || {
        let result = (|| -> Result<u64, String> {
            let (sftp_arc, bookmark, password, trusted_host_fingerprint, trusted_host_key_type) = sftp_info;
            let mut guard = sftp_arc.lock();
            let sess = ensure_sftp_session(
                &mut guard,
                &bookmark,
                password.as_deref(),
                &trusted_host_fingerprint,
                &trusted_host_key_type,
            )?;

            // Single scp_recv — get the stat and the data channel in one call.
            let (mut remote_file, stat) = sess
                .scp_recv(Path::new(&remote_path))
                .map_err(|e| format!("SCP recv failed: {}", e))?;

            let total = stat.size();
            let stage_total = configured_stage_total.unwrap_or(total);
            let stage_span = progress_span.unwrap_or(total);

            emit_transfer_progress(
                &app,
                &transfer_id,
                &file_name,
                "download",
                stage_total,
                stage_start,
                "transferring",
                None,
                Some(target_path.clone()),
                None,
                None,
            );

            let local_file = File::create(&local_path).map_err(|e| e.to_string())?;
            let mut local_writer = BufWriter::new(local_file);

            let mut transferred = 0u64;
            let mut last_pct = 0u64;
            let mut buf = [0u8; 32768];

            loop {
                if cancelled_transfers.lock().contains(&transfer_id) {
                    return Err("Cancelled".to_string());
                }

                match remote_file.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        local_writer
                            .write_all(&buf[..n])
                            .map_err(|e| e.to_string())?;
                        transferred += n as u64;

                        // Throttle: emit at most once per 1 % progress change
                        let pct = if total > 0 { transferred * 100 / total } else { 0 };
                        if pct > last_pct {
                            last_pct = pct;
                            emit_transfer_progress(
                                &app,
                                &transfer_id,
                                &file_name,
                                "download",
                                stage_total,
                                map_stage_progress(total, transferred, stage_start, stage_span),
                                "transferring",
                                None,
                                Some(target_path.clone()),
                                None,
                                None,
                            );
                        }
                    }
                    Err(e) => return Err(e.to_string()),
                }
            }

            local_writer.flush().map_err(|e| e.to_string())?;
            Ok(total)
        })();

        match result {
            Ok(total) => {
                info!(
                    "download_file success transfer_id={} target_path={} total_bytes={}",
                    transfer_id,
                    target_path,
                    total
                );
                cancelled_transfers.lock().remove(&transfer_id);
                let stage_total = configured_stage_total.unwrap_or(total);
                emit_transfer_progress(
                    &app,
                    &transfer_id,
                    &file_name,
                    "download",
                    stage_total,
                    stage_start
                        .saturating_add(progress_span.unwrap_or(total))
                        .min(stage_total),
                    "done",
                    None,
                    Some(target_path.clone()),
                    None,
                    None,
                );
            }
            Err(err) => {
                warn!(
                    "download_file failed transfer_id={} target_path={} error={}",
                    transfer_id,
                    target_path,
                    err
                );
                cancelled_transfers.lock().remove(&transfer_id);
                emit_transfer_progress(
                    &app,
                    &transfer_id,
                    &file_name,
                    "download",
                    configured_stage_total.unwrap_or(0),
                    stage_start,
                    "error",
                    Some(err.clone()),
                    Some(target_path.clone()),
                    None,
                    None,
                );
            }
        }
    });

    Ok(())
}

// ── Remote file/directory operations ────────────────────────────────────────

/// Recursively scan a remote folder and return all files with their info.
/// Returns a flat list of (path, name, is_dir, size) for every file in the tree.
fn scan_folder_recursive(
    sftp: &ssh2::Sftp,
    base_path: &str,
) -> Result<Vec<FileInfo>, String> {
    let entries = sftp
        .readdir(Path::new(base_path))
        .map_err(|e| format!("readdir failed: {}", e))?;

    let mut result = Vec::new();

    for (pathbuf, stat) in entries {
        let name = pathbuf
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        let full_path = format!("{}/{}", base_path.trim_end_matches('/'), name);

        if stat.is_dir() {
            // Skip . and ..
            if name == "." || name == ".." {
                continue;
            }
            // Recurse into subdirectory
            let sub_files = scan_folder_recursive(sftp, &full_path)?;
            result.extend(sub_files);
        } else {
            result.push(FileInfo {
                name,
                path: full_path,
                is_dir: false,
                size: stat.size.unwrap_or(0),
                modified: stat.mtime.map(|t| t as i64),
                permissions: stat.perm.map(|p| format!("{:o}", p)),
                owner: None,
            });
        }
    }

    Ok(result)
}

#[tauri::command]
pub fn scan_remote_folder(
    session_manager: State<SessionManager>,
    session_id: String,
    path: String,
) -> Result<Vec<FileInfo>, String> {
    with_sftp(&session_manager, &session_id, |sftp| {
        scan_folder_recursive(&sftp, &path)
    })
}

fn remove_remote_dir_recursive(sftp: &ssh2::Sftp, dir_path: &Path) -> Result<(), String> {
    let entries = sftp
        .readdir(dir_path)
        .map_err(|e| format!("readdir failed: {}", e))?;

    for (pathbuf, stat) in entries {
        let name = pathbuf
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");

        if name == "." || name == ".." {
            continue;
        }

        if stat.is_dir() {
            remove_remote_dir_recursive(sftp, &pathbuf)?;
        } else {
            sftp.unlink(&pathbuf).map_err(|e| format!("unlink failed for {:?}: {}", pathbuf, e))?;
        }
    }
    sftp.rmdir(dir_path)
        .map_err(|e| format!("rmdir failed for {:?}: {}", dir_path, e))
}

fn remove_remote_path(sftp: &ssh2::Sftp, path: &Path, is_dir: bool) -> Result<(), String> {
    if is_dir {
        remove_remote_dir_recursive(sftp, path)
    } else {
        sftp.unlink(path).map_err(|e| e.to_string())
    }
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace("'", "'\"'\"'"))
}

fn get_ssh_session(
    session_manager: &State<SessionManager>,
    session_id: &str,
) -> Result<Arc<parking_lot::Mutex<ssh2::Session>>, String> {
    let sessions = session_manager.sessions.lock();
    let session = sessions
        .get(session_id)
        .ok_or_else(|| "Session disconnected".to_string())?;
    Ok(Arc::clone(&session.session))
}

fn remove_remote_path_fast(
    ssh_session: &Arc<parking_lot::Mutex<ssh2::Session>>,
    path: &str,
    is_dir: bool,
) -> Result<(), String> {
    let command = if is_dir {
        format!("rm -rf -- {}", shell_quote(path))
    } else {
        format!("rm -f -- {}", shell_quote(path))
    };

    let sess = ssh_session.lock();
    sess.set_blocking(true);
    let result = (|| -> Result<(), String> {
        let mut channel = sess
            .channel_session()
            .map_err(|e| format!("channel_session: {}", e))?;
        channel.exec(&command).map_err(|e| format!("exec: {}", e))?;

        let mut stdout = String::new();
        channel.read_to_string(&mut stdout).map_err(|e| format!("read: {}", e))?;
        channel.wait_close().map_err(|e| format!("wait_close: {}", e))?;

        let exit_status = channel.exit_status().unwrap_or(-1);
        if exit_status != 0 {
            let mut stderr = String::new();
            let mut stderr_channel = channel.stderr();
            let _ = stderr_channel.read_to_string(&mut stderr);
            return Err(format!("Command failed with exit code {}: {}, {}", exit_status, stdout, stderr));
        }

        Ok(())
    })();

    sess.set_timeout(0);
    sess.set_blocking(false);

    result
}

fn emit_remote_delete_status(
    app: &AppHandle,
    path: String,
    is_dir: bool,
    success: bool,
    error: Option<String>,
) {
    let _ = app.emit(
        "remote-delete-status",
        RemoteDeleteStatus {
            path,
            is_dir,
            success,
            error,
        },
    );
}

#[tauri::command]
pub fn delete_remote(
    session_manager: State<SessionManager>,
    session_id: String,
    path: String,
    is_dir: bool,
) -> Result<(), String> {
    let guarded_path = guard_remote_delete_target(&session_manager, &session_id, &path)?;
    let ssh_session = get_ssh_session(&session_manager, &session_id)?;
    remove_remote_path_fast(&ssh_session, &guarded_path, is_dir).or_else(|_| {
        with_sftp(&session_manager, &session_id, |sftp| {
            remove_remote_path(&sftp, Path::new(&guarded_path), is_dir)
        })
    })
}

#[tauri::command]
pub fn delete_remote_async(
    session_manager: State<SessionManager>,
    session_id: String,
    path: String,
    is_dir: bool,
    app: AppHandle,
) -> Result<(), String> {
    let guarded_path = guard_remote_delete_target(&session_manager, &session_id, &path)?;
    let sftp_info = get_sftp_info(&session_manager, &session_id)?;
    let ssh_session = get_ssh_session(&session_manager, &session_id)?;
    let target_path = path.clone();

    thread::spawn(move || {
        let result = (|| -> Result<(), String> {
            remove_remote_path_fast(&ssh_session, &guarded_path, is_dir).or_else(|_| {
                let (sftp_arc, bookmark, password, trusted_host_fingerprint, trusted_host_key_type) = sftp_info;
                let mut guard = sftp_arc.lock();
                let sess = ensure_sftp_session(
                    &mut guard,
                    &bookmark,
                    password.as_deref(),
                    &trusted_host_fingerprint,
                    &trusted_host_key_type,
                )?;
                let sftp = sess.sftp().map_err(|e| {
                    *guard = None;
                    format!("SFTP init failed: {}", e)
                })?;

                remove_remote_path(&sftp, Path::new(&guarded_path), is_dir)
            })
        })();

        match result {
            Ok(()) => emit_remote_delete_status(&app, target_path, is_dir, true, None),
            Err(error) => emit_remote_delete_status(&app, target_path, is_dir, false, Some(error)),
        }
    });

    Ok(())
}

#[tauri::command]
pub fn create_remote_dir(
    session_manager: State<SessionManager>,
    session_id: String,
    path: String,
) -> Result<(), String> {
    with_sftp(&session_manager, &session_id, |sftp| {
        match sftp.mkdir(Path::new(&path), 0o755) {
            Ok(_) => Ok(()),
            Err(e) => {
                // If it already exists, stat it to make sure it's a directory
                if let Ok(stat) = sftp.stat(Path::new(&path)) {
                    if stat.is_dir() {
                        return Ok(());
                    }
                }
                Err(e.to_string())
            }
        }
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
pub fn delete_local(path: String, _is_dir: bool) -> Result<(), String> {
    let raw_path = PathBuf::from(&path);
    let metadata = fs::symlink_metadata(&raw_path).map_err(|e| e.to_string())?;

    if metadata.file_type().is_symlink() {
        return fs::remove_file(&raw_path).map_err(|e| e.to_string());
    }

    let resolved_path = fs::canonicalize(&raw_path).map_err(|e| e.to_string())?;
    guard_local_delete_target(&resolved_path)?;

    if metadata.is_dir() {
        fs::remove_dir_all(&resolved_path).map_err(|e| e.to_string())
    } else {
        fs::remove_file(&resolved_path).map_err(|e| e.to_string())
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