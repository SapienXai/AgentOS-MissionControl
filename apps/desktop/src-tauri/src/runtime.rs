use std::{
    collections::VecDeque,
    env,
    io::{BufRead, BufReader, Read},
    path::PathBuf,
    process::{Child, Command, ExitStatus, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::error::NativeError;

const GATEWAY_PORT: &str = "18789";
const MAX_LOG_ENTRIES: usize = 200;
const COMMAND_TIMEOUT: Duration = Duration::from_secs(12);
const OPENCLAW_BASELINE: &str = "2026.9.1";

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub runtime_id: String,
    pub kind: String,
    pub display_name: String,
    pub connection: String,
    pub installed: bool,
    pub running: bool,
    pub ready: bool,
    pub health: String,
    pub version: Option<String>,
    pub pid: Option<u32>,
    pub reason: Option<String>,
    pub checked_at: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeLogEntry {
    pub id: String,
    pub source: String,
    pub level: String,
    pub message: String,
    pub timestamp: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDoctorResult {
    pub summary: String,
    pub issues: Vec<String>,
    pub status: RuntimeStatus,
}

pub struct RuntimeManager {
    process: Mutex<Option<Child>>,
    operation: Mutex<()>,
    logs: Arc<Mutex<VecDeque<RuntimeLogEntry>>>,
    log_sequence: Arc<AtomicU64>,
}

impl RuntimeManager {
    pub fn new() -> Self {
        Self {
            process: Mutex::new(None),
            operation: Mutex::new(()),
            logs: Arc::new(Mutex::new(VecDeque::with_capacity(MAX_LOG_ENTRIES))),
            log_sequence: Arc::new(AtomicU64::new(0)),
        }
    }

    pub fn status(&self, app: Option<&AppHandle>) -> Result<RuntimeStatus, NativeError> {
        let managed_pid = self.refresh_managed_process(app)?;
        let binary = resolve_openclaw_binary();
        let checked_at = unix_timestamp();
        let Some(binary) = binary else {
            return Ok(status_offline(
                checked_at,
                None,
                None,
                "OpenClaw is not installed or could not be resolved.",
            ));
        };

        let version = run_command(&binary, &["--version"])
            .ok()
            .and_then(|result| parse_version(&format!("{}\n{}", result.stdout, result.stderr)));
        let gateway = run_command(&binary, &["gateway", "status", "--deep", "--json"])
            .ok()
            .and_then(|result| parse_json(&format!("{}\n{}", result.stdout, result.stderr)));
        let gateway_running = gateway.as_ref().map(is_gateway_running).unwrap_or(false);
        let running = managed_pid.is_some() || gateway_running;
        let ready = gateway.as_ref().map(is_gateway_ready).unwrap_or(false);
        let health = if !running {
            "offline"
        } else if gateway.as_ref().map(is_gateway_degraded).unwrap_or(false) {
            "degraded"
        } else if ready {
            "healthy"
        } else {
            "unknown"
        };
        let pid = managed_pid.or_else(|| gateway.as_ref().and_then(gateway_pid));
        let reason = if version
            .as_deref()
            .map(|value| compare_versions(value, OPENCLAW_BASELINE) < 0)
            .unwrap_or(false)
        {
            Some(format!(
                "OpenClaw {OPENCLAW_BASELINE} or newer is required by AgentOS."
            ))
        } else if gateway.is_none() && running {
            Some(
                "The OpenClaw process exists, but Gateway status could not be verified."
                    .to_string(),
            )
        } else if !running {
            Some("OpenClaw is installed but the Gateway is stopped.".to_string())
        } else if !ready {
            Some("OpenClaw is running but Gateway readiness is not verified.".to_string())
        } else {
            None
        };

        Ok(RuntimeStatus {
            runtime_id: "openclaw-local".to_string(),
            kind: "openclaw".to_string(),
            display_name: "OpenClaw".to_string(),
            connection: "local".to_string(),
            installed: true,
            running,
            ready,
            health: health.to_string(),
            version,
            pid,
            reason,
            checked_at,
        })
    }

    pub fn start(&self, app: &AppHandle) -> Result<RuntimeStatus, NativeError> {
        let _guard = self.operation.lock().map_err(|_| {
            NativeError::new(
                "runtime-lock",
                "Runtime operation lock is unavailable.",
                true,
            )
        })?;
        let current = self.status(Some(app))?;
        if current.running {
            return Ok(current);
        }
        let binary = resolve_openclaw_binary().ok_or_else(|| {
            NativeError::new(
                "runtime-not-installed",
                "OpenClaw is not installed or could not be resolved on PATH.",
                false,
            )
        })?;
        let mut child = Command::new(&binary)
            .args([
                "gateway",
                "run",
                "--port",
                GATEWAY_PORT,
                "--bind",
                "loopback",
                "--allow-unconfigured",
                "--ws-log",
                "compact",
                "--no-color",
            ])
            .env("OPENCLAW_GATEWAY_PORT", GATEWAY_PORT)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| {
                NativeError::new(
                    "runtime-start-failed",
                    format!("OpenClaw Gateway could not be started: {error}"),
                    true,
                )
            })?;
        let pid = child.id();
        self.emit_system_log(app, "OpenClaw Gateway process started.");
        if let Some(stdout) = child.stdout.take() {
            self.spawn_log_reader(app.clone(), stdout, "stdout");
        }
        if let Some(stderr) = child.stderr.take() {
            self.spawn_log_reader(app.clone(), stderr, "stderr");
        }
        let mut process = self.process.lock().map_err(|_| {
            NativeError::new(
                "runtime-lock",
                "Runtime process state is unavailable.",
                true,
            )
        })?;
        *process = Some(child);
        drop(process);
        thread::sleep(Duration::from_millis(350));
        let status = self.status(Some(app))?;
        if status.pid.is_none() && !status.running {
            return Err(NativeError::new(
                "runtime-start-failed",
                "OpenClaw Gateway exited before it became observable.",
                true,
            ));
        }
        let _ = pid;
        Ok(status)
    }

    pub fn stop(&self, app: &AppHandle) -> Result<RuntimeStatus, NativeError> {
        let _guard = self.operation.lock().map_err(|_| {
            NativeError::new(
                "runtime-lock",
                "Runtime operation lock is unavailable.",
                true,
            )
        })?;
        self.stop_locked(app)?;
        self.status(Some(app))
    }

    pub fn restart(&self, app: &AppHandle) -> Result<RuntimeStatus, NativeError> {
        let _guard = self.operation.lock().map_err(|_| {
            NativeError::new(
                "runtime-lock",
                "Runtime operation lock is unavailable.",
                true,
            )
        })?;
        self.stop_locked(app)?;
        drop(_guard);
        self.start(app)
    }

    pub fn doctor(&self, app: &AppHandle) -> Result<RuntimeDoctorResult, NativeError> {
        let status = self.status(Some(app))?;
        let Some(binary) = resolve_openclaw_binary() else {
            return Ok(RuntimeDoctorResult {
                summary: "OpenClaw is not installed.".to_string(),
                issues: vec!["Install OpenClaw, then refresh the local runtime.".to_string()],
                status,
            });
        };
        let command = run_command(
            &binary,
            &["doctor", "--lint", "--json", "--no-workspace-suggestions"],
        )
        .map_err(|error| NativeError::new("doctor-failed", error.message, true))?;
        let output = sanitize_text(&format!("{}\n{}", command.stdout, command.stderr));
        let issues = output
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .take(12)
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();
        let summary = if command.success() && issues.is_empty() {
            "OpenClaw doctor completed without reported issues."
        } else if command.success() {
            "OpenClaw doctor completed; review the reported diagnostics."
        } else {
            "OpenClaw doctor reported a problem."
        };
        Ok(RuntimeDoctorResult {
            summary: summary.to_string(),
            issues,
            status,
        })
    }

    pub fn logs(&self) -> Vec<RuntimeLogEntry> {
        self.logs
            .lock()
            .map(|logs| logs.iter().cloned().collect())
            .unwrap_or_default()
    }

    pub fn shutdown(&self) {
        if let Ok(mut process) = self.process.lock() {
            if let Some(mut child) = process.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }

    fn stop_locked(&self, app: &AppHandle) -> Result<(), NativeError> {
        let child = self
            .process
            .lock()
            .map_err(|_| {
                NativeError::new(
                    "runtime-lock",
                    "Runtime process state is unavailable.",
                    true,
                )
            })?
            .take();
        if let Some(mut child) = child {
            let _ = child.kill();
            let _ = child.wait();
            self.emit_system_log(app, "Managed OpenClaw Gateway process stopped.");
            return Ok(());
        }
        let current = self.status(Some(app))?;
        if !current.running {
            return Ok(());
        }
        if let Some(binary) = resolve_openclaw_binary() {
            let result = run_command(&binary, &["gateway", "stop", "--json"])?;
            if !result.success() {
                return Err(NativeError::new(
                    "runtime-stop-failed",
                    "OpenClaw rejected the Gateway stop request.",
                    true,
                ));
            }
            self.emit_system_log(
                app,
                "OpenClaw Gateway stop request accepted by its native service.",
            );
        }
        Ok(())
    }

    fn refresh_managed_process(&self, app: Option<&AppHandle>) -> Result<Option<u32>, NativeError> {
        let mut process = self.process.lock().map_err(|_| {
            NativeError::new(
                "runtime-lock",
                "Runtime process state is unavailable.",
                true,
            )
        })?;
        let Some(child) = process.as_mut() else {
            return Ok(None);
        };
        match child.try_wait() {
            Ok(None) => Ok(Some(child.id())),
            Ok(Some(status)) => {
                let pid = child.id();
                *process = None;
                if let Some(app) = app {
                    self.emit_system_log(
                        app,
                        &format!("Managed OpenClaw Gateway exited ({status})."),
                    );
                    let _ = crate::integrations::notify_event(app, "runtime-crashed");
                }
                Ok(Some(pid))
            }
            Err(error) => Err(NativeError::new(
                "runtime-inspect-failed",
                format!("Could not inspect the OpenClaw process: {error}"),
                true,
            )),
        }
    }

    fn spawn_log_reader<R: Read + Send + 'static>(
        &self,
        app: AppHandle,
        reader: R,
        source: &'static str,
    ) {
        let logs = Arc::clone(&self.logs);
        let sequence = Arc::clone(&self.log_sequence);
        thread::spawn(move || {
            let buffered = BufReader::new(reader);
            for line in buffered.lines().map_while(Result::ok) {
                let id = sequence.fetch_add(1, Ordering::Relaxed);
                let entry = RuntimeLogEntry {
                    id: format!("runtime-log-{id}"),
                    source: source.to_string(),
                    level: if source == "stderr" {
                        "warn".to_string()
                    } else {
                        "info".to_string()
                    },
                    message: sanitize_text(&line),
                    timestamp: unix_timestamp(),
                };
                push_log(&logs, &app, entry);
            }
        });
    }

    fn emit_system_log(&self, app: &AppHandle, message: &str) {
        let id = self.log_sequence.fetch_add(1, Ordering::Relaxed);
        push_log(
            &self.logs,
            app,
            RuntimeLogEntry {
                id: format!("runtime-log-{id}"),
                source: "system".to_string(),
                level: "info".to_string(),
                message: message.to_string(),
                timestamp: unix_timestamp(),
            },
        );
    }
}

impl Drop for RuntimeManager {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn push_log(logs: &Arc<Mutex<VecDeque<RuntimeLogEntry>>>, app: &AppHandle, entry: RuntimeLogEntry) {
    if let Ok(mut current) = logs.lock() {
        current.push_back(entry.clone());
        while current.len() > MAX_LOG_ENTRIES {
            current.pop_front();
        }
    }
    let _ = app.emit("runtime-log", entry);
}

#[derive(Debug)]
struct CommandOutput {
    stdout: String,
    stderr: String,
    status: ExitStatus,
}
impl CommandOutput {
    fn success(&self) -> bool {
        self.status.success()
    }
}

fn run_command(binary: &str, args: &[&str]) -> Result<CommandOutput, NativeError> {
    let mut child = Command::new(binary)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            NativeError::new(
                "runtime-command-failed",
                format!("OpenClaw command could not start: {error}"),
                true,
            )
        })?;
    let started = SystemTime::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let output = child.wait_with_output().map_err(|error| {
                    NativeError::new(
                        "runtime-command-failed",
                        format!("OpenClaw command output could not be read: {error}"),
                        true,
                    )
                })?;
                return Ok(CommandOutput {
                    stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
                    stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
                    status,
                });
            }
            Ok(None) if started.elapsed().unwrap_or_default() < COMMAND_TIMEOUT => {
                thread::sleep(Duration::from_millis(40))
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(NativeError::new(
                    "runtime-command-timeout",
                    "OpenClaw command timed out.",
                    true,
                ));
            }
            Err(error) => {
                return Err(NativeError::new(
                    "runtime-command-failed",
                    format!("OpenClaw command could not be inspected: {error}"),
                    true,
                ))
            }
        }
    }
}

fn resolve_openclaw_binary() -> Option<String> {
    let mut candidates = Vec::<String>::new();
    if let Ok(value) = env::var("OPENCLAW_BIN") {
        if !value.trim().is_empty() {
            candidates.push(value);
        }
    }
    if let Some(path) = env::var_os("PATH") {
        for directory in env::split_paths(&path) {
            candidates.push(
                directory
                    .join(if cfg!(windows) {
                        "openclaw.cmd"
                    } else {
                        "openclaw"
                    })
                    .to_string_lossy()
                    .to_string(),
            );
            candidates.push(
                directory
                    .join(if cfg!(windows) {
                        "openclaw.exe"
                    } else {
                        "openclaw"
                    })
                    .to_string_lossy()
                    .to_string(),
            );
        }
    }
    if let Some(home) = env::var_os("HOME") {
        let home = PathBuf::from(home);
        candidates.push(
            home.join(".local/bin/openclaw")
                .to_string_lossy()
                .to_string(),
        );
        candidates.push(
            home.join(".openclaw/bin/openclaw")
                .to_string_lossy()
                .to_string(),
        );
    }
    if cfg!(windows) {
        if let Some(app_data) = env::var_os("APPDATA") {
            candidates.push(
                PathBuf::from(app_data)
                    .join("npm/openclaw.cmd")
                    .to_string_lossy()
                    .to_string(),
            );
        }
    }
    candidates.push(if cfg!(windows) {
        "openclaw.cmd".to_string()
    } else {
        "openclaw".to_string()
    });
    candidates
        .into_iter()
        .find(|candidate| candidate == "openclaw" || PathBuf::from(candidate).is_file())
}

fn parse_json(output: &str) -> Option<Value> {
    serde_json::from_str(output.trim()).ok().or_else(|| {
        let start = output.find('{')?;
        let end = output.rfind('}')?;
        serde_json::from_str(&output[start..=end]).ok()
    })
}

fn parse_version(output: &str) -> Option<String> {
    output
        .split_whitespace()
        .find(|token| {
            token.chars().filter(|char| *char == '.').count() >= 2
                && token.chars().any(|char| char.is_ascii_digit())
        })
        .map(|token| {
            token
                .trim_matches(|char: char| !char.is_ascii_digit() && char != '.')
                .to_string()
        })
        .filter(|value| !value.is_empty())
}
fn compare_versions(left: &str, right: &str) -> i32 {
    let parse = |value: &str| {
        value
            .split('.')
            .map(|part| part.parse::<u32>().unwrap_or(0))
            .collect::<Vec<_>>()
    };
    let left = parse(left);
    let right = parse(right);
    for index in 0..left.len().max(right.len()) {
        let l = *left.get(index).unwrap_or(&0);
        let r = *right.get(index).unwrap_or(&0);
        if l != r {
            return if l > r { 1 } else { -1 };
        }
    }
    0
}
fn pointer<'a>(value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    path.iter()
        .try_fold(value, |current, key| current.get(*key))
}
fn is_gateway_running(value: &Value) -> bool {
    pointer(value, &["service", "runtime", "status"])
        .and_then(Value::as_str)
        .map(|value| value == "running")
        .unwrap_or(false)
        || pointer(value, &["runtime", "status"])
            .and_then(Value::as_str)
            .map(|value| value == "running")
            .unwrap_or(false)
        || pointer(value, &["port", "status"])
            .and_then(Value::as_str)
            .map(|value| value == "busy")
            .unwrap_or(false)
}
fn is_gateway_ready(value: &Value) -> bool {
    pointer(value, &["rpc", "ok"])
        .and_then(Value::as_bool)
        .unwrap_or(false)
        && is_gateway_running(value)
}
fn is_gateway_degraded(value: &Value) -> bool {
    pointer(value, &["configAudit", "ok"])
        .and_then(Value::as_bool)
        .map(|value| !value)
        .unwrap_or(false)
        || (is_gateway_running(value)
            && !pointer(value, &["rpc", "ok"])
                .and_then(Value::as_bool)
                .unwrap_or(false))
}
fn gateway_pid(value: &Value) -> Option<u32> {
    pointer(value, &["service", "runtime", "pid"])
        .and_then(Value::as_u64)
        .or_else(|| {
            pointer(value, &["port", "listeners"])
                .and_then(Value::as_array)
                .and_then(|items| items.first())
                .and_then(|item| item.get("pid"))
                .and_then(Value::as_u64)
        })
        .and_then(|pid| u32::try_from(pid).ok())
}
fn status_offline(
    checked_at: String,
    version: Option<String>,
    pid: Option<u32>,
    reason: &str,
) -> RuntimeStatus {
    RuntimeStatus {
        runtime_id: "openclaw-local".to_string(),
        kind: "openclaw".to_string(),
        display_name: "OpenClaw".to_string(),
        connection: "local".to_string(),
        installed: false,
        running: false,
        ready: false,
        health: "offline".to_string(),
        version,
        pid,
        reason: Some(reason.to_string()),
        checked_at,
    }
}
fn sanitize_text(value: &str) -> String {
    let lower = value.to_ascii_lowercase();
    if [
        "token",
        "api_key",
        "api-key",
        "password",
        "secret",
        "authorization",
        "cookie",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
    {
        return "[redacted sensitive runtime output]".to_string();
    }
    value.chars().take(2_000).collect()
}
fn unix_timestamp() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{seconds}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gateway_status_is_parsed_from_native_json() {
        let status = parse_json(r#"{"service":{"runtime":{"status":"running","pid":42}},"rpc":{"ok":true},"configAudit":{"ok":true}}"#).expect("status payload");
        assert!(is_gateway_running(&status));
        assert!(is_gateway_ready(&status));
        assert_eq!(gateway_pid(&status), Some(42));
        assert!(!is_gateway_degraded(&status));
    }

    #[test]
    fn sensitive_runtime_output_is_redacted() {
        assert_eq!(
            sanitize_text("token=secret-value"),
            "[redacted sensitive runtime output]"
        );
        assert_eq!(sanitize_text("Gateway ready"), "Gateway ready");
    }

    #[test]
    fn version_comparison_handles_release_components() {
        assert!(compare_versions("2026.9.2", OPENCLAW_BASELINE) > 0);
        assert_eq!(compare_versions("2026.9.1", OPENCLAW_BASELINE), 0);
        assert!(compare_versions("2026.8.9", OPENCLAW_BASELINE) < 0);
    }
}
