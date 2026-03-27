use parking_lot::Mutex;
use ssh2::Session;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::AtomicBool;
use std::sync::mpsc::Sender;
use std::sync::Arc;

use crate::models::Bookmark;

pub struct SshSession {
    /// The main SSH session used for the terminal PTY channel
    pub session: Arc<Mutex<Session>>,
    /// The PTY shell channel
    pub channel: Arc<Mutex<ssh2::Channel>>,
    pub bookmark_id: String,
    /// Dedicated SSH session for SFTP operations (lazily created).
    /// Using a separate TCP connection eliminates contention with terminal I/O —
    /// reads and writes to the PTY channel never block on SFTP and vice-versa.
    pub sftp_session: Arc<Mutex<Option<Session>>>,
    /// Resolved bookmark (with profile credentials already merged) so we can
    /// create the SFTP session on demand without hitting the database again.
    pub resolved_bookmark: Bookmark,
    /// Password override supplied at connection time (if any).
    pub password_override: Option<String>,
    /// Set to `true` to signal the background reader thread to exit cleanly.
    pub stop_reader: Arc<AtomicBool>,
    /// Sender half of the dedicated writer thread's input queue.
    ///
    /// `write_to_session` drops data here and returns immediately — identical
    /// to how the reference project's WebSocket.send() is fire-and-forget.
    /// The writer thread owns the receiver and serialises all SSH writes
    /// without blocking the Tauri command thread or the JS event loop.
    /// Dropping this sender (on session close) causes recv() in the writer
    /// thread to return Err, cleanly terminating the thread.
    pub write_tx: Sender<String>,
}

pub struct SessionManager {
    pub sessions: Mutex<HashMap<String, SshSession>>,
    pub cancelled_transfers: Arc<Mutex<HashSet<String>>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            cancelled_transfers: Arc::new(Mutex::new(HashSet::new())),
        }
    }
}