use anyhow::{anyhow, Result};
use ssh2::Session;
use std::io::{Read, Write};
use std::net::TcpStream;
use crate::models::Bookmark;

/// Build an SSH session from a bookmark
pub fn connect_ssh(bookmark: &Bookmark, password: Option<&str>) -> Result<Session> {
    let addr = format!("{}:{}", bookmark.host, bookmark.port);
    let tcp = TcpStream::connect(&addr)
        .map_err(|e| anyhow!("TCP connect to {} failed: {}", addr, e))?;
    tcp.set_read_timeout(Some(std::time::Duration::from_secs(30)))?;

    let mut sess = Session::new().map_err(|e| anyhow!("SSH session init failed: {}", e))?;
    sess.set_tcp_stream(tcp);
    sess.handshake().map_err(|e| anyhow!("SSH handshake failed: {}", e))?;

    // Choose auth method
    match bookmark.auth_type.as_str() {
        "privateKey" => {
            // Authenticate via private key
            let key_content = bookmark.private_key.as_deref()
                .ok_or_else(|| anyhow!("Private key content is empty"))?;
            let passphrase = bookmark.passphrase.as_deref()
                .or_else(|| password);
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
            // Decode if encrypted
            let decoded = if bookmark.password_encrypted {
                crate::models::decode_password(pwd)
            } else {
                pwd.to_string()
            };
            sess.userauth_password(&bookmark.username, &decoded)
                .map_err(|e| anyhow!("Password auth failed: {}", e))?;
        }
    }

    if !sess.authenticated() {
        return Err(anyhow!("Authentication failed"));
    }

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
