use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use openssl::pkey::Private;
use openssl::rand::rand_bytes;
use openssl::rsa::{Padding, Rsa};
use openssl::symm::{decrypt_aead, encrypt_aead, Cipher};
use std::fs;
use std::path::{Path, PathBuf};

const ENCRYPTED_PREFIX: &str = "ttenc:v1:";
const PRIVATE_KEY_FILE: &str = "secret-key.pem";

pub fn is_encrypted_secret(value: &str) -> bool {
    value.starts_with(ENCRYPTED_PREFIX)
}

pub fn encrypt_secret(db_path: &Path, plaintext: &str) -> Result<String> {
    if plaintext.is_empty() {
        return Ok(String::new());
    }

    let rsa = load_or_create_private_key(db_path)?;
    let mut aes_key = [0u8; 32];
    let mut nonce = [0u8; 12];
    let mut tag = [0u8; 16];
    rand_bytes(&mut aes_key)?;
    rand_bytes(&mut nonce)?;

    let ciphertext = encrypt_aead(
        Cipher::aes_256_gcm(),
        &aes_key,
        Some(&nonce),
        &[],
        plaintext.as_bytes(),
        &mut tag,
    )?;

    let public_pem = rsa.public_key_to_pem_pkcs1()?;
    let public_rsa = Rsa::public_key_from_pem_pkcs1(&public_pem)?;
    let mut encrypted_key = vec![0u8; public_rsa.size() as usize];
    let encrypted_key_len = public_rsa.public_encrypt(&aes_key, &mut encrypted_key, Padding::PKCS1_OAEP)?;
    encrypted_key.truncate(encrypted_key_len);

    Ok(format!(
        "{}{}:{}:{}:{}",
        ENCRYPTED_PREFIX,
        STANDARD.encode(encrypted_key),
        STANDARD.encode(nonce),
        STANDARD.encode(tag),
        STANDARD.encode(ciphertext),
    ))
}

pub fn decrypt_secret(db_path: &Path, stored_value: &str) -> Result<String> {
    if stored_value.is_empty() {
        return Ok(String::new());
    }

    if !is_encrypted_secret(stored_value) {
        return Ok(stored_value.to_string());
    }

    let payload = stored_value
        .strip_prefix(ENCRYPTED_PREFIX)
        .ok_or_else(|| anyhow!("invalid encrypted secret prefix"))?;
    let mut parts = payload.split(':');
    let encrypted_key = parts
        .next()
        .ok_or_else(|| anyhow!("missing encrypted key"))?;
    let nonce = parts.next().ok_or_else(|| anyhow!("missing nonce"))?;
    let tag = parts.next().ok_or_else(|| anyhow!("missing tag"))?;
    let ciphertext = parts
        .next()
        .ok_or_else(|| anyhow!("missing ciphertext"))?;

    if parts.next().is_some() {
        return Err(anyhow!("invalid encrypted secret payload"));
    }

    let rsa = load_or_create_private_key(db_path)?;
    let encrypted_key = STANDARD.decode(encrypted_key)?;
    let nonce = STANDARD.decode(nonce)?;
    let tag = STANDARD.decode(tag)?;
    let ciphertext = STANDARD.decode(ciphertext)?;

    let mut aes_key = vec![0u8; rsa.size() as usize];
    let aes_key_len = rsa.private_decrypt(&encrypted_key, &mut aes_key, Padding::PKCS1_OAEP)?;
    aes_key.truncate(aes_key_len);

    let plaintext = decrypt_aead(
        Cipher::aes_256_gcm(),
        &aes_key,
        Some(&nonce),
        &[],
        &ciphertext,
        &tag,
    )?;

    String::from_utf8(plaintext).context("decrypted secret is not valid UTF-8")
}

fn load_or_create_private_key(db_path: &Path) -> Result<Rsa<Private>> {
    let key_path = private_key_path(db_path)?;
    if key_path.exists() {
        let pem = fs::read(&key_path)
            .with_context(|| format!("failed to read encryption key at {}", key_path.display()))?;
        return Rsa::private_key_from_pem(&pem).context("failed to parse encryption key");
    }

    let rsa = Rsa::generate(2048).context("failed to generate RSA keypair")?;
    let pem = rsa.private_key_to_pem().context("failed to encode RSA private key")?;
    fs::write(&key_path, pem)
        .with_context(|| format!("failed to write encryption key at {}", key_path.display()))?;
    restrict_private_key_permissions(&key_path)?;
    Ok(rsa)
}

fn private_key_path(db_path: &Path) -> Result<PathBuf> {
    let app_dir = db_path
        .parent()
        .ok_or_else(|| anyhow!("database path has no parent directory"))?;
    Ok(app_dir.join(PRIVATE_KEY_FILE))
}

#[cfg(unix)]
fn restrict_private_key_permissions(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;

    let mut permissions = fs::metadata(path)?.permissions();
    permissions.set_mode(0o600);
    fs::set_permissions(path, permissions)?;
    Ok(())
}

#[cfg(not(unix))]
fn restrict_private_key_permissions(_path: &Path) -> Result<()> {
    Ok(())
}