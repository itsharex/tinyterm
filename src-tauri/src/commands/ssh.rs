use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::time::Duration;
use tauri::State;
use uuid::Uuid;
use log::{info, warn};

use crate::crypto;
use crate::models::{HostKeyVerificationPrompt, TrustedHostKey};
use crate::session::{SessionManager, SshSession};
use crate::ssh;
use crate::storage::{self, DbPath};

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateSessionRequest {
    pub bookmark_id: String,
    pub cols: u32,
    pub rows: u32,
    pub password: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateSessionResponse {
    pub session_id: String,
}

fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

fn host_key_prompt_error(prompt: &HostKeyVerificationPrompt) -> String {
    format!(
        "HOST_KEY_PROMPT:{}",
        serde_json::to_string(prompt).unwrap_or_else(|_| "{}".to_string())
    )
}

fn resolve_password_secret(
    db_path: &DbPath,
    db_value: Option<String>,
    password_encrypted: bool,
) -> Result<Option<String>, String> {
    db_value
        .filter(|value| !value.is_empty())
        .map(|value| {
            if crypto::is_encrypted_secret(&value) {
                crypto::decrypt_secret(&db_path.0, &value).map_err(|e| e.to_string())
            } else if password_encrypted {
                Ok(crate::models::decode_password(&value))
            } else {
                Ok(value)
            }
        })
        .transpose()
}

fn resolve_plain_secret(db_path: &DbPath, db_value: Option<String>) -> Result<Option<String>, String> {
    db_value
        .filter(|value| !value.is_empty())
        .map(|value| {
            if crypto::is_encrypted_secret(&value) {
                crypto::decrypt_secret(&db_path.0, &value).map_err(|e| e.to_string())
            } else {
                Ok(value)
            }
        })
        .transpose()
}

fn hydrate_bookmark_auth(db_path: &DbPath, bookmark: &mut crate::models::Bookmark) -> Result<(), String> {
    match bookmark.auth_type.as_str() {
        "password" => {
            bookmark.password = resolve_password_secret(
                db_path,
                bookmark.password.clone(),
                bookmark.password_encrypted,
            )?;
            bookmark.password_encrypted = false;
            bookmark.private_key = None;
            bookmark.passphrase = None;
        }
        "privateKey" => {
            bookmark.private_key = resolve_plain_secret(db_path, bookmark.private_key.clone())?;
            bookmark.passphrase = resolve_plain_secret(db_path, bookmark.passphrase.clone())?;
            bookmark.password = None;
            bookmark.password_encrypted = false;
        }
        _ => {
            bookmark.password = None;
            bookmark.password_encrypted = false;
            bookmark.private_key = None;
            bookmark.passphrase = None;
        }
    }

    Ok(())
}

fn resolve_bookmark_for_connection(db_path: &DbPath, bookmark_id: &str) -> Result<(crate::models::Bookmark, Option<String>), String> {
    let bookmarks = storage::list_bookmarks(db_path).map_err(|e| e.to_string())?;
    let mut bookmark = bookmarks
        .iter()
        .find(|b| b.id == bookmark_id)
        .cloned()
        .ok_or_else(|| "Bookmark not found".to_string())?;

    if bookmark.auth_type == "profile" {
        let profile_id = bookmark
            .profile_id
            .clone()
            .ok_or_else(|| "Host has auth_type=profile but no profile_id set".to_string())?;
        let profiles = storage::list_profiles(db_path).map_err(|e| e.to_string())?;
        let profile = profiles
            .iter()
            .find(|p| p.id == profile_id)
            .ok_or_else(|| format!("Credential '{}' not found", profile_id))?;

        bookmark.username = profile.username.clone();
        bookmark.auth_type = profile.auth_type.clone();
        bookmark.password = resolve_password_secret(
            db_path,
            profile.password.clone(),
            profile.password_encrypted,
        )?;
        bookmark.password_encrypted = false;
        bookmark.private_key = resolve_plain_secret(db_path, profile.private_key.clone())?;
        bookmark.passphrase = resolve_plain_secret(db_path, profile.passphrase.clone())?;
        Ok((bookmark, Some(profile_id)))
    } else {
        hydrate_bookmark_auth(db_path, &mut bookmark)?;
        Ok((bookmark, None))
    }
}

fn ensure_host_key_trusted(db_path: &DbPath, bookmark: &crate::models::Bookmark, sess: &ssh2::Session) -> Result<(String, String), String> {
    let fingerprint = ssh::get_host_key_fingerprint(sess).map_err(|e| e.to_string())?;
    let key_type = ssh::get_host_key_type(sess).map_err(|e| e.to_string())?;
    let trusted = storage::get_trusted_host_key(db_path, &bookmark.host, bookmark.port)
        .map_err(|e| e.to_string())?;

    match trusted {
        Some(record) if record.fingerprint == fingerprint && record.key_type == key_type => {
            Ok((fingerprint, key_type))
        }
        Some(_) => Err(host_key_prompt_error(&HostKeyVerificationPrompt {
            host: bookmark.host.clone(),
            port: bookmark.port,
            key_type,
            fingerprint,
            reason: "mismatch".to_string(),
        })),
        None => Err(host_key_prompt_error(&HostKeyVerificationPrompt {
            host: bookmark.host.clone(),
            port: bookmark.port,
            key_type,
            fingerprint,
            reason: "unknown".to_string(),
        })),
    }
}

/// Establish the SSH connection and open the PTY shell channel.
///
/// Does NOT start any background reader thread — call `subscribe_session`
/// afterwards to begin streaming terminal output.  This separation ensures
/// the frontend's Channel is always ready before the first byte is sent,
/// eliminating the timing gap that caused the initial shell prompt to be lost.
#[tauri::command]
pub fn create_session(
    db_path: State<DbPath>,
    session_manager: State<SessionManager>,
    request: CreateSessionRequest,
) -> Result<CreateSessionResponse, String> {
    info!(
        "create_session request bookmark_id={} cols={} rows={}",
        request.bookmark_id, request.cols, request.rows
    );

    let (bookmark, _) = resolve_bookmark_for_connection(&db_path, &request.bookmark_id)?;

    let password = request.password.as_deref();
    let sess = ssh::connect_ssh_transport(&bookmark).map_err(|e| e.to_string())?;
    let (trusted_host_fingerprint, trusted_host_key_type) = ensure_host_key_trusted(&db_path, &bookmark, &sess)?;
    ssh::authenticate_ssh(&sess, &bookmark, password).map_err(|e| e.to_string())?;
    let channel = ssh::open_shell_channel(&sess, &bookmark.term, request.cols, request.rows)
        .map_err(|e| e.to_string())?;

    // Non-blocking mode: reads return immediately when no data is available.
    sess.set_blocking(false);

    let session_arc = Arc::new(Mutex::new(sess));
    let channel_arc = Arc::new(Mutex::new(channel));

    // ── Dedicated writer thread ───────────────────────────────────────────
    // Mirrors the reference project's WebSocket architecture:
    //   JS  →  WebSocket.send()  →  instant return  →  ws.on('message') → term.write()
    //   JS  →  invoke()          →  instant return  →  mpsc channel     → SSH write
    //
    // write_to_session enqueues data and returns immediately to the JS caller.
    // This writer thread is the sole owner of the receiver; it serialises all
    // SSH channel writes without holding any lock visible to the JS side.
    // When the SshSession is removed from the map (close/reconnect), write_tx
    // is dropped, recv() returns Err, and this thread exits cleanly.
    let (write_tx, write_rx) = mpsc::channel::<String>();
    {
        let w_session = Arc::clone(&session_arc);
        let w_channel = Arc::clone(&channel_arc);
        std::thread::spawn(move || {
            while let Ok(data) = write_rx.recv() {
                // Block until the session mutex is free (reader or get_remote_cwd
                // may hold it briefly). Data is never dropped — it waits here.
                let sess = w_session.lock();
                let mut ch = w_channel.lock();
                // Blocking mode so libssh2 handles SSH flow-control internally.
                sess.set_blocking(true);
                let _ = ch.write_all(data.as_bytes());
                sess.set_blocking(false);
            }
        });
    }

    let connected_bookmark_id = bookmark.id.clone();
    let connected_host = bookmark.host.clone();
    let connected_port = bookmark.port;

    let session_id = Uuid::new_v4().to_string();
    let ssh_session = SshSession {
        session: session_arc,
        channel: channel_arc,
        bookmark_id: bookmark.id.clone(),
        sftp_session: Arc::new(Mutex::new(None)),
        resolved_bookmark: bookmark,
        password_override: request.password,
        trusted_host_fingerprint,
        trusted_host_key_type,
        stop_reader: Arc::new(AtomicBool::new(false)),
        write_tx,
    };

    session_manager
        .sessions
        .lock()
        .insert(session_id.clone(), ssh_session);

    info!(
        "create_session success session_id={} bookmark_id={} host={}:{}",
        session_id,
        connected_bookmark_id,
        connected_host,
        connected_port
    );

    Ok(CreateSessionResponse { session_id })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TrustHostKeyRequest {
    pub host: String,
    pub port: u16,
    pub key_type: String,
    pub fingerprint: String,
}

#[tauri::command]
pub fn trust_host_key(db_path: State<DbPath>, request: TrustHostKeyRequest) -> Result<(), String> {
    info!(
        "trust_host_key host={}:{} key_type={} fingerprint={}",
        request.host,
        request.port,
        request.key_type,
        request.fingerprint
    );
    let now = now_unix();
    storage::upsert_trusted_host_key(&db_path, &TrustedHostKey {
        host: request.host,
        port: request.port,
        key_type: request.key_type,
        fingerprint: request.fingerprint,
        created_at: now,
        updated_at: now,
    }).map_err(|e| e.to_string())
}

/// Start the background SSH reader and wire its output to a Tauri Channel.
///
/// The frontend creates a `Channel<string>` object *before* calling this
/// command, so the channel is guaranteed to be ready from the first byte —
/// no timing gap, no dropped shell prompts.
///
/// Architecture:
///   Rust thread  →  Channel<String>  →  JS onmessage  →  xterm.write()
///
/// Compared with the previous `app_handle.emit()` approach:
///   • No event routing through the main thread's run loop
///   • Data delivered directly into the JS callback — lower latency
///   • No window.listen() race condition (channel exists before thread starts)
#[tauri::command]
pub fn subscribe_session(
    session_manager: State<SessionManager>,
    session_id: String,
    data_channel: tauri::ipc::Channel<String>,
) -> Result<(), String> {
    let (session_arc, channel_arc, stop) = {
        let sessions = session_manager.sessions.lock();
        let s = sessions
            .get(&session_id)
            .ok_or_else(|| "Session not found".to_string())?;
        (
            Arc::clone(&s.session),
            Arc::clone(&s.channel),
            Arc::clone(&s.stop_reader),
        )
    };

    // Reset the stop flag in case this is a re-subscribe after reconnect.
    stop.store(false, Ordering::Relaxed);

    std::thread::spawn(move || {
        let mut buf = vec![0u8; 16384];
        let mut batch = String::new();
        let mut last_flush = std::time::Instant::now();

        // ── Why 5 ms batching? ────────────────────────────────────────────
        // Previously we called data_channel.send() for every single read(),
        // which meant one IPC message per echoed keystroke.  Under fast
        // typing the WebView message queue filled up, starving the macOS
        // IMK run-loop so it could not deliver key events — characters were
        // silently dropped before ever reaching xterm's onData handler.
        //
        // Batching for up to 5 ms coalesces those per-character messages into
        // one, keeping the IPC rate low enough that IMK stays responsive.
        // 5 ms is well below the ~20 ms human perception threshold, so
        // terminal output still feels instant.
        const FLUSH_MS: u128 = 5;

        loop {
            if stop.load(Ordering::Relaxed) {
                // Flush any buffered data before the thread exits.
                if !batch.is_empty() {
                    let _ = data_channel.send(batch);
                }
                break;
            }

            // try_lock: yield immediately if write_to_session or get_remote_cwd
            // holds the session mutex so we never deadlock or stall writes.
            let data_opt = {
                let _sess_guard = match session_arc.try_lock() {
                    Some(g) => g,
                    None => {
                        std::thread::sleep(std::time::Duration::from_micros(500));
                        continue;
                    }
                };
                let mut ch = channel_arc.lock();

                match ch.read(&mut buf) {
                    Ok(0) => None,
                    Ok(n) => Some(String::from_utf8_lossy(&buf[..n]).to_string()),
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => None,
                    Err(_) => {
                        if ch.eof() {
                            Some("\r\n[Session closed]\r\n".to_string())
                        } else {
                            None
                        }
                    }
                }
                // Both locks released here before Channel::send is called.
            };

            match data_opt {
                Some(text) => {
                    batch.push_str(&text);
                    // Flush when the batch window elapses or the buffer is large.
                    if last_flush.elapsed().as_millis() >= FLUSH_MS || batch.len() >= 4096 {
                        if data_channel.send(std::mem::take(&mut batch)).is_err() {
                            break;
                        }
                        last_flush = std::time::Instant::now();
                    }
                    // Don't sleep — try to read more data immediately so we can
                    // fill the batch before the flush window expires.
                }
                None => {
                    // No data right now. Flush pending batch if window elapsed.
                    if !batch.is_empty() && last_flush.elapsed().as_millis() >= FLUSH_MS {
                        if data_channel.send(std::mem::take(&mut batch)).is_err() {
                            break;
                        }
                        last_flush = std::time::Instant::now();
                    }
                    // Short fixed sleep: keeps CPU low while still flushing
                    // any partial batch within the 5 ms window.
                    std::thread::sleep(std::time::Duration::from_micros(1000));
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn close_session(
    session_manager: State<SessionManager>,
    session_id: String,
) -> Result<(), String> {
    info!("close_session request session_id={}", session_id);
    let ssh_sess = { session_manager.sessions.lock().remove(&session_id) };
    if let Some(ssh_sess) = ssh_sess {
        // Signal the reader thread to exit cleanly.
        ssh_sess.stop_reader.store(true, Ordering::Relaxed);

        // Disconnect the dedicated SFTP session (separate TCP connection).
        {
            let mut sftp_guard = ssh_sess.sftp_session.lock();
            if let Some(sftp_sess) = sftp_guard.take() {
                sftp_sess.disconnect(None, "closing", None).ok();
            }
        }

        // Send EOF on the PTY channel to terminate the remote shell.
        // Lock the session mutex so any in-flight write finishes first.
        let _sess = ssh_sess.session.lock();
        let _ = ssh_sess.channel.lock().send_eof();
        info!("close_session success session_id={}", session_id);
    } else {
        warn!("close_session ignored missing session_id={}", session_id);
    }
    Ok(())
}

#[tauri::command]
pub fn check_session_alive(
    session_manager: State<SessionManager>,
    session_id: String,
) -> Result<bool, String> {
    let (session_arc, channel_arc) = {
        let sessions = session_manager.sessions.lock();
        let s = match sessions.get(&session_id) {
            Some(s) => s,
            None => return Ok(false),
        };
        (Arc::clone(&s.session), Arc::clone(&s.channel))
    };

    let sess = session_arc.lock();
    if !sess.authenticated() {
        return Ok(false);
    }

    if sess.keepalive_send().is_err() {
        return Ok(false);
    }

    let channel = channel_arc.lock();
    if channel.eof() {
        return Ok(false);
    }

    Ok(true)
}

#[tauri::command]
pub fn check_host_port(host: String, port: u16) -> Result<bool, String> {
    let host = host.trim();
    if host.is_empty() || port == 0 {
        return Ok(false);
    }

    let addrs: Vec<std::net::SocketAddr> = (host, port)
        .to_socket_addrs()
        .map_err(|e| format!("resolve {}:{} failed: {}", host, port, e))?
        .collect();

    if addrs.is_empty() {
        return Ok(false);
    }

    let timeout = Duration::from_millis(1500);
    for addr in addrs {
        if TcpStream::connect_timeout(&addr, timeout).is_ok() {
            return Ok(true);
        }
    }

    Ok(false)
}

/// Write keyboard input to the PTY channel.
///
/// Enqueues `data` into the session's dedicated writer thread and returns
/// immediately — identical to how the reference project's WebSocket.send()
/// is fire-and-forget from the JS side.
///
/// The writer thread owns the mpsc receiver and performs the actual SSH
/// write with a blocking mutex + blocking-mode libssh2 call, so it handles
/// all lock contention (reader thread, get_remote_cwd) internally without
/// ever signalling an error back to the frontend.  Characters are buffered
/// in the mpsc channel and delivered in order; none are ever dropped.
#[tauri::command]
pub fn write_to_session(
    session_manager: State<SessionManager>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let tx = {
        let sessions = session_manager.sessions.lock();
        let s = sessions
            .get(&session_id)
            .ok_or_else(|| "Session not found".to_string())?;
        s.write_tx.clone()
    };
    // send() only fails if the writer thread has exited (channel closed/crashed).
    tx.send(data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn resize_terminal(
    session_manager: State<SessionManager>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    let (session_arc, channel_arc) = {
        let sessions = session_manager.sessions.lock();
        let s = match sessions.get(&session_id) {
            Some(s) => s,
            None => return Ok(()),
        };
        (Arc::clone(&s.session), Arc::clone(&s.channel))
    };

    let _sess = session_arc.lock();
    let mut channel = channel_arc.lock();
    channel
        .request_pty_size(cols, rows, None, None)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Retrieve the current working directory of the live PTY shell.
///
/// Opens a fresh exec channel and tries (in order):
///   1. /proc sibling scan  — readlink /proc/<pty-pid>/cwd
///   2. lsof               — works on systems without /proc
///   3. pwd                — universal fallback
///
/// A 5-second timeout prevents hangs on unresponsive hosts.
#[tauri::command]
pub fn get_remote_cwd(
    session_manager: State<SessionManager>,
    session_id: String,
) -> Result<String, String> {
    let session_arc = {
        let sessions = session_manager.sessions.lock();
        sessions
            .get(&session_id)
            .map(|s| Arc::clone(&s.session))
            .ok_or_else(|| "Session not found".to_string())?
    };

    let sess = session_arc.lock();

    sess.set_blocking(true);
    sess.set_timeout(5000);

    let result = (|| -> Result<String, String> {
        let mut exec_channel = sess
            .channel_session()
            .map_err(|e| format!("channel_session: {}", e))?;

        let cmd = concat!(
            r#"p=$(cat /proc/$$/status 2>/dev/null|grep -m1 '^PPid:'|awk '{print $2}');"#,
            r#"if [ -n "$p" ];then "#,
            r#"for f in /proc/[0-9]*/status;do "#,
            r#"pid="${f#/proc/}";pid="${pid%/status}";"#,
            r#"[ "$pid" = "$$" ]&&continue;"#,
            r#"pp=$(grep -m1 '^PPid:' "$f" 2>/dev/null|awk '{print $2}');"#,
            r#"if [ "$pp" = "$p" ];then "#,
            r#"cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null)&&[ -n "$cwd" ]&&echo "$cwd"&&exit 0;"#,
            r#"fi;done;fi;"#,
            r#"if command -v lsof >/dev/null 2>&1&&[ -n "$p" ];then "#,
            r#"cwd=$(lsof -a -p "$p" -d cwd -F n 2>/dev/null|grep '^n/'|cut -c2-);"#,
            r#"[ -n "$cwd" ]&&echo "$cwd"&&exit 0;fi;"#,
            r#"pwd"#,
        );

        exec_channel
            .exec(cmd)
            .map_err(|e| format!("exec cwd command: {}", e))?;

        let mut output = String::new();
        exec_channel
            .read_to_string(&mut output)
            .map_err(|e| format!("read cwd output: {}", e))?;

        exec_channel.wait_close().ok();

        let cwd = output.trim().to_string();
        if cwd.is_empty() {
            Err("empty cwd output".to_string())
        } else {
            Ok(cwd)
        }
    })();

    sess.set_timeout(0);
    sess.set_blocking(false);

    result
}

#[tauri::command]
pub fn execute_remote_command(
    session_id: String,
    command: String,
    session_manager: tauri::State<'_, crate::session::SessionManager>,
) -> Result<String, String> {
    let sessions = session_manager.sessions.lock();
    let session = sessions
        .get(&session_id)
        .ok_or("Session disconnected")?;

    let sess = session.session.lock();
    sess.set_blocking(true);
    let result = (|| -> Result<String, String> {
        let mut channel = sess
            .channel_session()
            .map_err(|e| format!("channel_session: {}", e))?;
        channel.exec(&command).map_err(|e| format!("exec: {}", e))?;

        let mut s = String::new();
        use std::io::Read;
        channel.read_to_string(&mut s).map_err(|e| format!("read: {}", e))?;
        channel.wait_close().map_err(|e| format!("wait_close: {}", e))?;

        let exit_status = channel.exit_status().unwrap_or(-1);
        if exit_status != 0 {
            let mut stderr = String::new();
            let mut stderr_channel = channel.stderr();
            let _ = stderr_channel.read_to_string(&mut stderr);
            return Err(format!("Command failed with exit code {}: {}, {}", exit_status, s, stderr));
        }

        Ok(s)
    })();

    sess.set_timeout(0);
    sess.set_blocking(false);

    result
}
