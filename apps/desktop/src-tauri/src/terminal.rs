use std::{
    collections::HashMap,
    env,
    io::{Read, Write},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    thread,
};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::{error::NativeError, workspace::WorkspaceManager};

const MAX_TERMINAL_INPUT_BYTES: usize = 8 * 1024;
const MAX_TERMINAL_DIMENSION: u16 = 500;
const MAX_TERMINAL_OUTPUT_BYTES: usize = 1024 * 1024;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSession {
    pub id: String,
    pub workspace_id: String,
    pub shell: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutput {
    pub session_id: String,
    pub data: String,
}

struct SessionState {
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Arc<Mutex<Box<dyn Child + Send>>>,
}

pub struct TerminalManager {
    sessions: Arc<Mutex<HashMap<String, SessionState>>>,
}

impl Drop for TerminalManager {
    fn drop(&mut self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            for (_, session) in sessions.drain() {
                if let Ok(mut child) = session.child.lock() {
                    let _ = child.kill();
                }
            }
        }
    }
}

impl TerminalManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn spawn(
        &self,
        app: &AppHandle,
        workspace: &str,
        workspace_id: &str,
        cols: u16,
        rows: u16,
    ) -> Result<TerminalSession, NativeError> {
        let shell = default_shell()?;
        let pty = native_pty_system()
            .openpty(PtySize {
                rows: rows.min(MAX_TERMINAL_DIMENSION).max(1),
                cols: cols.min(MAX_TERMINAL_DIMENSION).max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|_| {
                NativeError::new(
                    "terminal-start-failed",
                    "The native terminal could not be allocated.",
                    true,
                )
            })?;
        let mut command = CommandBuilder::new(&shell);
        command.cwd(workspace);
        command.env("TERM", "xterm-256color");
        let child = pty.slave.spawn_command(command).map_err(|_| {
            NativeError::new(
                "terminal-start-failed",
                "The terminal shell could not be started in this workspace.",
                true,
            )
        })?;
        let writer = pty.master.take_writer().map_err(|_| {
            NativeError::new(
                "terminal-start-failed",
                "The terminal input stream could not be opened.",
                true,
            )
        })?;
        let reader = pty.master.try_clone_reader().map_err(|_| {
            NativeError::new(
                "terminal-start-failed",
                "The terminal output stream could not be opened.",
                true,
            )
        })?;
        let id = format!("terminal-{}", Uuid::new_v4());
        let session = TerminalSession {
            id: id.clone(),
            workspace_id: workspace_id.to_string(),
            shell,
        };
        let output_bytes = Arc::new(AtomicUsize::new(0));
        let state = SessionState {
            master: Arc::new(Mutex::new(pty.master)),
            writer: Arc::new(Mutex::new(writer)),
            child: Arc::new(Mutex::new(child)),
        };
        self.sessions
            .lock()
            .map_err(|_| NativeError::new("terminal-lock", "Terminal state is unavailable.", true))?
            .insert(id.clone(), state);
        spawn_reader(
            app.clone(),
            Arc::clone(&self.sessions),
            id,
            reader,
            output_bytes,
        );
        Ok(session)
    }

    fn write(&self, session_id: &str, data: &str) -> Result<(), NativeError> {
        if !valid_terminal_input(session_id, data) {
            return Err(NativeError::new(
                "terminal-input-invalid",
                "Terminal input is empty or exceeds the safe input limit.",
                false,
            ));
        }
        let sessions = self.sessions.lock().map_err(|_| {
            NativeError::new("terminal-lock", "Terminal state is unavailable.", true)
        })?;
        let writer = sessions
            .get(session_id)
            .ok_or_else(|| {
                NativeError::new(
                    "terminal-not-found",
                    "The terminal session is no longer available.",
                    false,
                )
            })?
            .writer
            .clone();
        drop(sessions);
        let result = writer
            .lock()
            .map_err(|_| {
                NativeError::new(
                    "terminal-write-failed",
                    "The terminal input stream is unavailable.",
                    true,
                )
            })?
            .write_all(data.as_bytes())
            .map_err(|_| {
                NativeError::new(
                    "terminal-write-failed",
                    "Terminal input could not be delivered.",
                    true,
                )
            });
        result
    }

    fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), NativeError> {
        if !valid_terminal_dimensions(cols, rows) {
            return Err(NativeError::new(
                "terminal-size-invalid",
                "Terminal dimensions are outside the allowed range.",
                false,
            ));
        }
        let sessions = self.sessions.lock().map_err(|_| {
            NativeError::new("terminal-lock", "Terminal state is unavailable.", true)
        })?;
        let master = sessions
            .get(session_id)
            .ok_or_else(|| {
                NativeError::new(
                    "terminal-not-found",
                    "The terminal session is no longer available.",
                    false,
                )
            })?
            .master
            .clone();
        drop(sessions);
        let result = master
            .lock()
            .map_err(|_| {
                NativeError::new(
                    "terminal-resize-failed",
                    "The terminal is unavailable.",
                    true,
                )
            })?
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            });
        result.map_err(|_| {
            NativeError::new(
                "terminal-resize-failed",
                "Terminal dimensions could not be updated.",
                true,
            )
        })
    }

    fn kill(&self, session_id: &str) -> Result<(), NativeError> {
        let state = self
            .sessions
            .lock()
            .map_err(|_| NativeError::new("terminal-lock", "Terminal state is unavailable.", true))?
            .remove(session_id)
            .ok_or_else(|| {
                NativeError::new(
                    "terminal-not-found",
                    "The terminal session is no longer available.",
                    false,
                )
            })?;
        let _ = state
            .child
            .lock()
            .map_err(|_| {
                NativeError::new(
                    "terminal-kill-failed",
                    "The terminal process is unavailable.",
                    true,
                )
            })?
            .kill();
        Ok(())
    }
}

#[tauri::command]
pub fn terminal_spawn(
    app: AppHandle,
    workspace_id: String,
    cols: Option<u16>,
    rows: Option<u16>,
    workspace_state: State<'_, WorkspaceManager>,
    terminal_state: State<'_, TerminalManager>,
) -> Result<TerminalSession, NativeError> {
    let workspace = workspace_state.find_for_terminal(&workspace_id)?;
    terminal_state.spawn(
        &app,
        &workspace.path,
        &workspace.id,
        cols.unwrap_or(120),
        rows.unwrap_or(32),
    )
}

#[tauri::command]
pub fn terminal_write(
    session_id: String,
    data: String,
    state: State<'_, TerminalManager>,
) -> Result<(), NativeError> {
    state.write(&session_id, &data)
}

#[tauri::command]
pub fn terminal_resize(
    session_id: String,
    cols: u16,
    rows: u16,
    state: State<'_, TerminalManager>,
) -> Result<(), NativeError> {
    state.resize(&session_id, cols, rows)
}

#[tauri::command]
pub fn terminal_kill(
    session_id: String,
    state: State<'_, TerminalManager>,
) -> Result<(), NativeError> {
    state.kill(&session_id)
}

fn spawn_reader<R: Read + Send + 'static>(
    app: AppHandle,
    sessions: Arc<Mutex<HashMap<String, SessionState>>>,
    session_id: String,
    mut reader: R,
    output_bytes: Arc<AtomicUsize>,
) {
    thread::spawn(move || {
        let mut buffer = [0_u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(size) => {
                    let used = output_bytes.load(Ordering::Relaxed);
                    let emit_size = bounded_output_size(used, size);
                    if emit_size == 0 {
                        break;
                    }
                    output_bytes.fetch_add(emit_size, Ordering::Relaxed);
                    let output = TerminalOutput {
                        session_id: session_id.clone(),
                        data: String::from_utf8_lossy(&buffer[..emit_size]).into_owned(),
                    };
                    let _ = app.emit("terminal-output", output);
                    if emit_size < size {
                        break;
                    }
                }
            }
        }
        if let Ok(mut sessions) = sessions.lock() {
            if let Some(state) = sessions.remove(&session_id) {
                if let Ok(mut child) = state.child.lock() {
                    let _ = child.kill();
                }
            }
        }
        let _ = app.emit("terminal-exit", session_id);
    });
}

fn valid_terminal_input(session_id: &str, data: &str) -> bool {
    !session_id.trim().is_empty() && !data.is_empty() && data.len() <= MAX_TERMINAL_INPUT_BYTES
}

fn valid_terminal_dimensions(cols: u16, rows: u16) -> bool {
    cols > 0 && rows > 0 && cols <= MAX_TERMINAL_DIMENSION && rows <= MAX_TERMINAL_DIMENSION
}

fn bounded_output_size(used: usize, requested: usize) -> usize {
    requested.min(MAX_TERMINAL_OUTPUT_BYTES.saturating_sub(used))
}

fn default_shell() -> Result<String, NativeError> {
    if cfg!(windows) {
        return Ok("powershell.exe".to_string());
    }
    let candidate = env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    let path = std::path::Path::new(&candidate);
    let allowed = ["sh", "bash", "zsh", "fish"]
        .iter()
        .any(|name| path.file_name().and_then(|value| value.to_str()) == Some(*name));
    if !path.is_absolute() || !allowed {
        return Err(NativeError::new(
            "terminal-shell-denied",
            "The configured shell is not an allowed local interactive shell.",
            false,
        ));
    }
    Ok(candidate)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_input_and_dimensions_are_bounded() {
        assert!(valid_terminal_input("terminal-id", "echo hi"));
        assert!(!valid_terminal_input("", "echo hi"));
        assert!(!valid_terminal_input(
            "terminal-id",
            &"x".repeat(MAX_TERMINAL_INPUT_BYTES + 1)
        ));
        assert!(valid_terminal_dimensions(120, 32));
        assert!(!valid_terminal_dimensions(0, 32));
        assert!(!valid_terminal_dimensions(MAX_TERMINAL_DIMENSION + 1, 32));
    }

    #[test]
    fn terminal_output_is_capped_per_session() {
        assert_eq!(bounded_output_size(0, 4096), 4096);
        assert_eq!(bounded_output_size(MAX_TERMINAL_OUTPUT_BYTES - 3, 4096), 3);
        assert_eq!(bounded_output_size(MAX_TERMINAL_OUTPUT_BYTES, 4096), 0);
    }

    #[test]
    fn terminal_session_ids_are_uuid_backed() {
        let id = format!("terminal-{}", Uuid::new_v4());
        assert!(Uuid::parse_str(id.strip_prefix("terminal-").expect("prefix")).is_ok());
    }
}
