use std::{
    env,
    io::{Read, Write},
    net::{TcpStream, ToSocketAddrs},
    process::Command,
    time::Duration,
};

use keyring::Entry;
use serde::Serialize;
use serde_json::Value;

use crate::error::NativeError;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OllamaStatus {
    pub installed: bool,
    pub running: bool,
    pub endpoint: Option<String>,
    pub models: Vec<String>,
    pub reason: Option<String>,
}

pub fn platform_capabilities() -> PlatformCapabilities {
    PlatformCapabilities {
        native_filesystem: true,
        local_runtime_control: true,
        native_notifications: true,
        secure_credential_store: true,
        terminal: true,
        system_tray: true,
        updater: cfg!(feature = "updater"),
    }
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlatformCapabilities {
    pub native_filesystem: bool,
    pub local_runtime_control: bool,
    pub native_notifications: bool,
    pub secure_credential_store: bool,
    pub terminal: bool,
    pub system_tray: bool,
    pub updater: bool,
}

#[tauri::command]
pub fn ollama_status() -> Result<OllamaStatus, NativeError> {
    let installed = Command::new(if cfg!(windows) {
        "ollama.exe"
    } else {
        "ollama"
    })
    .arg("--version")
    .output()
    .map(|output| output.status.success())
    .unwrap_or(false);
    let endpoint = env::var("OLLAMA_HOST")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "http://127.0.0.1:11434".to_string());
    let Some((host, port, path)) = parse_local_http_endpoint(&endpoint) else {
        return Ok(OllamaStatus {
            installed,
            running: false,
            endpoint: Some(endpoint),
            models: Vec::new(),
            reason: Some("Ollama endpoint is not a supported local HTTP address.".to_string()),
        });
    };
    let response = ollama_get(&host, port, &path);
    let models = response
        .as_ref()
        .and_then(|value| value.get("models"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    item.get("name")
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned)
                })
                .take(100)
                .collect()
        })
        .unwrap_or_default();
    Ok(OllamaStatus {
        installed,
        running: response.is_some(),
        endpoint: Some(endpoint),
        models,
        reason: if response.is_some() {
            None
        } else if installed {
            Some("Ollama is installed but its local service is not reachable.".to_string())
        } else {
            Some("Ollama is not installed on this computer.".to_string())
        },
    })
}

#[tauri::command]
pub fn secure_set(key: String, value: String) -> Result<(), NativeError> {
    let key = validate_secret_key(&key)?;
    if value.is_empty() || value.len() > 16_384 {
        return Err(NativeError::new(
            "secure-value-invalid",
            "Credential value must be between 1 and 16384 bytes.",
            false,
        ));
    }
    Entry::new("ai.sapienx.agentos", &key)
        .map_err(|_| {
            NativeError::new(
                "secure-store-unavailable",
                "The platform secure credential store is unavailable.",
                true,
            )
        })?
        .set_password(&value)
        .map_err(|_| {
            NativeError::new(
                "secure-store-write-failed",
                "The credential could not be saved in the platform secure store.",
                true,
            )
        })
}

#[tauri::command]
pub fn secure_get(key: String) -> Result<String, NativeError> {
    let key = validate_secret_key(&key)?;
    Entry::new("ai.sapienx.agentos", &key)
        .map_err(|_| {
            NativeError::new(
                "secure-store-unavailable",
                "The platform secure credential store is unavailable.",
                true,
            )
        })?
        .get_password()
        .map_err(|_| {
            NativeError::new(
                "secure-value-not-found",
                "The requested credential is not stored.",
                false,
            )
        })
}

#[tauri::command]
pub fn secure_delete(key: String) -> Result<(), NativeError> {
    let key = validate_secret_key(&key)?;
    Entry::new("ai.sapienx.agentos", &key)
        .map_err(|_| {
            NativeError::new(
                "secure-store-unavailable",
                "The platform secure credential store is unavailable.",
                true,
            )
        })?
        .delete_credential()
        .map_err(|_| {
            NativeError::new(
                "secure-store-delete-failed",
                "The credential could not be removed from the platform secure store.",
                true,
            )
        })
}

fn validate_secret_key(value: &str) -> Result<String, NativeError> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 64
        || !value
            .chars()
            .all(|char| char.is_ascii_alphanumeric() || matches!(char, '.' | '_' | '-'))
    {
        return Err(NativeError::new(
            "secure-key-invalid",
            "Credential keys may contain only letters, numbers, dot, underscore, and hyphen.",
            false,
        ));
    }
    Ok(value.to_string())
}

fn parse_local_http_endpoint(endpoint: &str) -> Option<(String, u16, String)> {
    let parsed = endpoint.parse::<tauri::Url>().ok()?;
    if parsed.scheme() != "http"
        || parsed.host_str()? != "127.0.0.1" && parsed.host_str()? != "localhost"
    {
        return None;
    }
    Some((
        parsed.host_str()?.to_string(),
        parsed.port().unwrap_or(11434),
        "/api/tags".to_string(),
    ))
}
fn ollama_get(host: &str, port: u16, path: &str) -> Option<Value> {
    let mut addresses = (host, port).to_socket_addrs().ok()?;
    let address = addresses.next()?;
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(800)).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(2))).ok()?;
    stream
        .set_write_timeout(Some(Duration::from_secs(2)))
        .ok()?;
    write!(
        stream,
        "GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n"
    )
    .ok()?;
    let mut body = Vec::new();
    stream.read_to_end(&mut body).ok()?;
    let text = String::from_utf8_lossy(&body);
    let payload = text.split_once("\r\n\r\n")?.1;
    serde_json::from_str(payload).ok()
}
