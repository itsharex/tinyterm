use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use ssh2::Session;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;
use crate::models::Bookmark;

/// Enable TCP keepalive on the stream with platform-specific methods.
/// Sends first probe after 60s idle, retries every 15s.
fn set_tcp_keepalive(tcp: &TcpStream) -> std::io::Result<()> {
    let keepalive = socket2::TcpKeepalive::new()
        .with_time(Duration::from_secs(60))
        .with_interval(Duration::from_secs(15));

    #[cfg(unix)]
    {
        use std::os::fd::{AsRawFd, FromRawFd};
        let raw_fd = tcp.as_raw_fd();
        // SAFETY: wrap the fd temporarily; forget() prevents socket2 from closing it.
        let sock = unsafe { socket2::Socket::from_raw_fd(raw_fd) };
        sock.set_keepalive(true)?;
        sock.set_tcp_keepalive(&keepalive)?;
        std::mem::forget(sock);
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::{AsRawSocket, FromRawSocket};
        let raw_socket = tcp.as_raw_socket();
        // SAFETY: wrap the socket temporarily; forget() prevents socket2 from closing it.
        let sock = unsafe { socket2::Socket::from_raw_socket(raw_socket) };
        sock.set_keepalive(true)?;
        sock.set_tcp_keepalive(&keepalive)?;
        std::mem::forget(sock);
    }
    Ok(())
}

/// Establish the TCP transport and SSH handshake, but do not authenticate yet.
pub fn connect_ssh_transport(bookmark: &Bookmark) -> Result<Session> {
    let addr = format!("{}:{}", bookmark.host, bookmark.port);
    let tcp = TcpStream::connect(&addr)
        .map_err(|e| anyhow!("TCP connect to {} failed: {}", addr, e))?;
    tcp.set_read_timeout(Some(Duration::from_secs(30)))?;

    // Enable TCP keepalive so the OS detects dead connections
    // even when the app is idle (e.g. window occluded).
    set_tcp_keepalive(&tcp).unwrap_or_else(|e| {
        log::warn!("Failed to set TCP keepalive: {}", e);
    });

    let mut sess = Session::new().map_err(|e| anyhow!("SSH session init failed: {}", e))?;
    sess.set_tcp_stream(tcp);
    sess.handshake().map_err(|e| anyhow!("SSH handshake failed: {}", e))?;

    Ok(sess)
}

pub fn get_host_key_fingerprint(sess: &Session) -> Result<String> {
    let hash = sess
        .host_key_hash(ssh2::HashType::Sha256)
        .ok_or_else(|| anyhow!("Failed to compute host key fingerprint"))?;
    Ok(format!("SHA256:{}", STANDARD_NO_PAD.encode(hash)))
}

pub fn get_host_key_type(sess: &Session) -> Result<String> {
    let (_, key_type) = sess
        .host_key()
        .ok_or_else(|| anyhow!("Failed to read SSH host key"))?;

    let label = match key_type {
        ssh2::HostKeyType::Rsa => "ssh-rsa",
        ssh2::HostKeyType::Dss => "ssh-dss",
        ssh2::HostKeyType::Ecdsa256 => "ecdsa-sha2-nistp256",
        ssh2::HostKeyType::Ecdsa384 => "ecdsa-sha2-nistp384",
        ssh2::HostKeyType::Ecdsa521 => "ecdsa-sha2-nistp521",
        ssh2::HostKeyType::Ed25519 => "ssh-ed25519",
        ssh2::HostKeyType::Unknown => "unknown",
    };

    Ok(label.to_string())
}

pub fn verify_host_key(sess: &Session, expected_key_type: &str, expected_fingerprint: &str) -> Result<()> {
    let actual_key_type = get_host_key_type(sess)?;
    let actual_fingerprint = get_host_key_fingerprint(sess)?;

    if actual_key_type != expected_key_type || actual_fingerprint != expected_fingerprint {
        return Err(anyhow!(
            "Host key mismatch: expected {} {}, got {} {}",
            expected_key_type,
            expected_fingerprint,
            actual_key_type,
            actual_fingerprint,
        ));
    }

    Ok(())
}

pub fn authenticate_ssh(sess: &Session, bookmark: &Bookmark, password: Option<&str>) -> Result<()> {

    // Choose auth method
    match bookmark.auth_type.as_str() {
        "privateKey" => {
            // Authenticate via private key
            let key_content = bookmark.private_key.as_deref()
                .ok_or_else(|| anyhow!("Private key content is empty"))?;
            let passphrase = bookmark.passphrase.as_deref();
            sess.userauth_pubkey_memory(
                &bookmark.username,
                None, // public key (derived from private)
                key_content,
                passphrase,
            ).map_err(|e| anyhow!("Private key auth failed: {}", e))?;
        }
        _ => {
            // Password auth
            let pwd = password
                .or_else(|| bookmark.password.as_deref())
                .ok_or_else(|| anyhow!("No password provided"))?;
            sess.userauth_password(&bookmark.username, pwd)
                .map_err(|e| anyhow!("Password auth failed: {}", e))?;
        }
    }

    if !sess.authenticated() {
        return Err(anyhow!("Authentication failed"));
    }

    Ok(())
}

/// Build an SSH session from a bookmark.
pub fn connect_ssh(bookmark: &Bookmark, password: Option<&str>) -> Result<Session> {
    let sess = connect_ssh_transport(bookmark)?;
    authenticate_ssh(&sess, bookmark, password)?;

    Ok(sess)
}

/// Open a PTY shell channel on the session
pub fn open_shell_channel(sess: &Session, term: &str, cols: u32, rows: u32) -> Result<ssh2::Channel> {
    let mut channel = sess.channel_session()
        .map_err(|e| anyhow!("Channel open failed: {}", e))?;
    channel.request_pty(term, None, Some((cols, rows, 0, 0)))
        .map_err(|e| anyhow!("PTY request failed: {}", e))?;
    channel.shell()
        .map_err(|e| anyhow!("Shell request failed: {}", e))?;
    Ok(channel)
}

/// Read available data from a channel (non-blocking)
pub fn read_channel_data(channel: &mut ssh2::Channel) -> Result<Vec<u8>> {
    let mut buf = vec![0u8; 4096];
    match channel.read(&mut buf) {
        Ok(n) if n > 0 => Ok(buf[..n].to_vec()),
        Ok(_) => Ok(vec![]),
        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => Ok(vec![]),
        Err(e) => Err(anyhow!("Read channel error: {}", e)),
    }
}

/// Write data to a channel
pub fn write_channel_data(channel: &mut ssh2::Channel, data: &[u8]) -> Result<()> {
    channel.write_all(data)
        .map_err(|e| anyhow!("Write channel error: {}", e))?;
    Ok(())
}

/// Resize the terminal
pub fn resize_channel(channel: &mut ssh2::Channel, cols: u32, rows: u32) -> Result<()> {
    channel.request_pty_size(cols, rows, None, None)
        .map_err(|e| anyhow!("Resize PTY failed: {}", e))?;
    Ok(())
}
