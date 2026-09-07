use std::{
    collections::HashMap,
    env,
    io::{Read, Write},
    sync::{Arc, Mutex},
    thread,
};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::{error::NativeError, workspace::WorkspaceManager};

const MAX_TERMINAL_INPUT_BYTES: usize = 8 * 1024;
const MAX_TERMINAL_DIMENSION: u16 = 500;

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
    sessions: Mutex<HashMap<String, SessionState>>,
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
            sessions: Mutex::new(HashMap::new()),
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
        let id = format!(
            "terminal-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        let session = TerminalSession {
            id: id.clone(),
            workspace_id: workspace_id.to_string(),
            shell,
        };
        let state = SessionState {
            master: Arc::new(Mutex::new(pty.master)),
            writer: Arc::new(Mutex::new(writer)),
            child: Arc::new(Mutex::new(child)),
        };
        self.sessions
            .lock()
            .map_err(|_| NativeError::new("terminal-lock", "Terminal state is unavailable.", true))?
            .insert(id.clone(), state);
        spawn_reader(app.clone(), id, reader);
        Ok(session)
    }

    fn write(&self, session_id: &str, data: &str) -> Result<(), NativeError> {
        if session_id.trim().is_empty() || data.is_empty() || data.len() > MAX_TERMINAL_INPUT_BYTES
        {
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
        if cols == 0 || rows == 0 || cols > MAX_TERMINAL_DIMENSION || rows > MAX_TERMINAL_DIMENSION
        {
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

fn spawn_reader<R: Read + Send + 'static>(app: AppHandle, session_id: String, mut reader: R) {
    thread::spawn(move || {
        let mut buffer = [0_u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(size) => {
                    let output = TerminalOutput {
                        session_id: session_id.clone(),
                        data: String::from_utf8_lossy(&buffer[..size]).into_owned(),
                    };
                    let _ = app.emit("terminal-output", output);
                }
            }
        }
    });
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
