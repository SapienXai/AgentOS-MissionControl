#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(not(debug_assertions))]
use std::collections::VecDeque;
#[cfg(windows)]
use std::io::Write;
#[cfg(not(debug_assertions))]
use std::io::{BufRead, BufReader};
#[cfg(not(debug_assertions))]
use std::net::TcpListener;
use std::process::Child;
#[cfg(not(debug_assertions))]
use std::process::Command;
#[cfg(not(debug_assertions))]
use std::process::Stdio;
#[cfg(not(debug_assertions))]
use std::sync::Arc;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::thread;
use std::time::{Duration, Instant};

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_opener::OpenerExt;

#[cfg(not(debug_assertions))]
const STARTUP_TIMEOUT: Duration = Duration::from_secs(60);
#[cfg(not(debug_assertions))]
const STARTUP_POLL: Duration = Duration::from_millis(250);
#[cfg(not(debug_assertions))]
const STARTUP_ATTEMPTS: usize = 4;
#[cfg(not(debug_assertions))]
const STARTUP_RETRY_DELAY: Duration = Duration::from_millis(150);
const SHUTDOWN_GRACE: Duration = Duration::from_secs(5);

struct DesktopState {
    child: Mutex<Option<Child>>,
    allowed_port: Mutex<Option<u16>>,
    #[cfg(not(debug_assertions))]
    output: Arc<Mutex<VecDeque<String>>>,
    quitting: AtomicBool,
    restarting: AtomicBool,
}

impl DesktopState {
    fn new() -> Self {
        Self {
            child: Mutex::new(None),
            allowed_port: Mutex::new(None),
            #[cfg(not(debug_assertions))]
            output: Arc::new(Mutex::new(VecDeque::with_capacity(12))),
            quitting: AtomicBool::new(false),
            restarting: AtomicBool::new(false),
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            app.manage(DesktopState::new());
            let _window = build_main_window(app)?;
            install_tray(app)?;

            #[cfg(not(debug_assertions))]
            start_embedded_agentos(app.handle().clone(), _window.clone());

            #[cfg(debug_assertions)]
            set_allowed_port(&app.state::<DesktopState>(), Some(3000));

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.app_handle().state::<DesktopState>();
                if !state.quitting.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building AgentOS desktop")
        .run(|app, event| {
            if matches!(event, RunEvent::Exit { .. }) {
                shutdown_embedded_agentos(app);
            }
        });
}

fn main() {
    run();
}

fn build_main_window(app: &mut tauri::App) -> Result<WebviewWindow, Box<dyn std::error::Error>> {
    let source = if cfg!(debug_assertions) {
        WebviewUrl::External("http://127.0.0.1:3000".parse()?)
    } else {
        WebviewUrl::App("index.html".into())
    };
    let app_handle = app.handle().clone();
    let window = WebviewWindowBuilder::new(app, "main", source)
        .title("AgentOS")
        .inner_size(1440.0, 920.0)
        .min_inner_size(980.0, 640.0)
        .resizable(true)
        .center()
        .on_navigation(move |url| {
            let port = app_handle
                .state::<DesktopState>()
                .allowed_port
                .lock()
                .ok()
                .and_then(|value| *value);

            if is_allowed_navigation(url, port) {
                true
            } else {
                open_external_url(&app_handle, url.as_str());
                false
            }
        })
        .build()?;
    Ok(window)
}

fn install_tray(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let open = MenuItemBuilder::with_id("open", "Open AgentOS").build(app)?;
    let restart = MenuItemBuilder::with_id("restart", "Restart AgentOS App").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
    let menu = MenuBuilder::new(app)
        .item(&open)
        .item(&restart)
        .separator()
        .item(&quit)
        .build()?;

    TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("AgentOS")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "restart" => {
                let state = app.state::<DesktopState>();
                if state.restarting.swap(true, Ordering::SeqCst) {
                    return;
                }
                state.quitting.store(true, Ordering::SeqCst);
                shutdown_embedded_agentos(app);
                tauri::process::restart(&app.env());
            }
            "quit" => {
                app.state::<DesktopState>()
                    .quitting
                    .store(true, Ordering::SeqCst);
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    Ok(())
}

fn is_allowed_navigation(url: &tauri::Url, allowed_port: Option<u16>) -> bool {
    if url.scheme() == "tauri" && url.host_str() == Some("localhost") {
        return true;
    }

    if url.scheme() != "http:" && url.scheme() != "http" {
        return false;
    }

    let Some(host) = url.host_str() else {
        return false;
    };
    let loopback = matches!(host, "127.0.0.1" | "localhost" | "::1");
    loopback && url.port_or_known_default() == allowed_port
}

fn open_external_url(app: &AppHandle, url: &str) {
    let Ok(parsed) = url.parse::<tauri::Url>() else {
        return;
    };
    if !is_external_web_url(&parsed) {
        return;
    }

    if let Err(error) = app.opener().open_url(parsed.as_str(), None::<&str>) {
        eprintln!("AgentOS could not open external URL: {error}");
    }
}

fn is_external_web_url(url: &tauri::Url) -> bool {
    matches!(url.scheme(), "http:" | "http" | "https:" | "https")
}

#[cfg(not(debug_assertions))]
fn start_embedded_agentos(app: AppHandle, window: WebviewWindow) {
    thread::spawn(move || match spawn_agentos_server(&app) {
        Ok((url, child_output)) => {
            eprintln!("AgentOS embedded server is ready at {url}");
            if let Ok(mut output) = app.state::<DesktopState>().output.lock() {
                *output = child_output;
            }
            if let Ok(target) = url.parse::<tauri::Url>() {
                if let Err(error) = window.navigate(target) {
                    eprintln!("AgentOS WebView navigation failed: {error}");
                }
            } else {
                eprintln!("AgentOS WebView navigation target could not be parsed: {url}");
            }
            monitor_agentos_server(app, window);
        }
        Err(error) => {
            eprintln!("AgentOS embedded server failed to start: {error}");
            shutdown_embedded_agentos(&app);
            if !app.state::<DesktopState>().quitting.load(Ordering::SeqCst) {
                show_bootstrap_error(&window, &format!("AgentOS could not start. {error}"));
            }
        }
    });
}

#[cfg(not(debug_assertions))]
fn spawn_agentos_server(app: &AppHandle) -> Result<(String, VecDeque<String>), String> {
    let mut last_error = String::from("unknown startup failure");

    for attempt in 1..=STARTUP_ATTEMPTS {
        match spawn_agentos_server_once(app) {
            Ok(result) => return Ok(result),
            Err(error) => {
                last_error = error.clone();
                shutdown_embedded_agentos(app);

                if !is_retryable_startup_error(&error) || attempt == STARTUP_ATTEMPTS {
                    return Err(format!(
                        "startup attempt {attempt}/{STARTUP_ATTEMPTS} failed: {error}"
                    ));
                }

                eprintln!(
                    "AgentOS embedded server startup attempt {attempt}/{STARTUP_ATTEMPTS} failed; retrying with a new loopback port: {error}"
                );
                thread::sleep(STARTUP_RETRY_DELAY);
            }
        }
    }

    Err(format!(
        "embedded AgentOS startup failed after {STARTUP_ATTEMPTS} attempts: {last_error}"
    ))
}

#[cfg(not(debug_assertions))]
fn spawn_agentos_server_once(app: &AppHandle) -> Result<(String, VecDeque<String>), String> {
    let state = app.state::<DesktopState>();
    let port = reserve_loopback_port()?;
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("resource directory unavailable: {error}"))?;
    let server_root = resource_dir.join("agentos-runtime").join("agentos");
    let server_path = server_root.join("server.js");
    let server_wrapper_path = server_root.join("agentos-desktop-server.cjs");
    let node_path = resource_dir
        .join("agentos-runtime")
        .join("node")
        .join(if cfg!(windows) {
            "node.exe"
        } else {
            "bin/node"
        });

    if !server_path.is_file() || !server_wrapper_path.is_file() || !node_path.is_file() {
        return Err(
            "the packaged AgentOS server, lifecycle wrapper, or Node runtime is missing"
                .to_string(),
        );
    }

    let runtime_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("AgentOS data directory unavailable: {error}"))?;
    std::fs::create_dir_all(&runtime_dir)
        .map_err(|error| format!("could not create AgentOS data directory: {error}"))?;

    let mut child = Command::new(node_path)
        .arg(server_wrapper_path)
        .current_dir(&server_root)
        .env("NODE_ENV", "production")
        .env("HOSTNAME", "127.0.0.1")
        .env("PORT", port.to_string())
        .env("AGENTOS_PACKAGE_RUNTIME", "1")
        .env("AGENTOS_DESKTOP", "1")
        .env("AGENTOS_RUNTIME_DIR", &runtime_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("could not launch the packaged AgentOS server: {error}"))?;

    let output = state.output.clone();
    if let Ok(mut lines) = output.lock() {
        lines.clear();
    }
    capture_output(child.stdout.take(), output.clone());
    capture_output(child.stderr.take(), output.clone());

    *state
        .child
        .lock()
        .map_err(|_| "AgentOS process state is poisoned".to_string())? = Some(child);
    set_allowed_port(&state, Some(port));

    let url = format!("http://127.0.0.1:{port}/");
    let readiness_url = format!("http://127.0.0.1:{port}/api/auth/status");
    let deadline = Instant::now() + STARTUP_TIMEOUT;
    while Instant::now() < deadline {
        if state.quitting.load(Ordering::SeqCst) {
            return Err("desktop quit requested during AgentOS startup".to_string());
        }

        {
            let mut guard = state
                .child
                .lock()
                .map_err(|_| "AgentOS process state is poisoned".to_string())?;
            if let Some(child) = guard.as_mut() {
                if let Some(status) = child
                    .try_wait()
                    .map_err(|error| format!("could not inspect AgentOS server: {error}"))?
                {
                    let diagnostics = snapshot_output(&state);
                    return Err(format_startup_exit_error(status, &diagnostics));
                }
            }
        }

        let ready = reqwest::blocking::Client::builder()
            .timeout(Duration::from_millis(750))
            .build()
            .ok()
            .and_then(|client| client.get(&readiness_url).send().ok())
            .is_some_and(|response| response.status().is_success());
        if ready {
            let output = state
                .output
                .lock()
                .map(|value| value.clone())
                .unwrap_or_default();
            return Ok((url, output));
        }
        thread::sleep(STARTUP_POLL);
    }

    Err("the packaged AgentOS server did not become ready within 60 seconds".to_string())
}

#[cfg_attr(not(test), allow(dead_code))]
fn is_retryable_startup_error(error: &str) -> bool {
    let lower = error.to_ascii_lowercase();
    lower.contains("eaddrinuse")
        || lower.contains("address already in use")
        || lower.contains("exited during startup")
}

#[cfg(not(debug_assertions))]
fn format_startup_exit_error(status: std::process::ExitStatus, diagnostics: &str) -> String {
    if diagnostics.is_empty() {
        return format!("the packaged AgentOS server exited during startup ({status})");
    }

    format!(
        "the packaged AgentOS server exited during startup ({status}); diagnostics: {diagnostics}"
    )
}

#[cfg(not(debug_assertions))]
fn monitor_agentos_server(app: AppHandle, window: WebviewWindow) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(1));
        let exited = app
            .state::<DesktopState>()
            .child
            .lock()
            .ok()
            .and_then(|mut guard| {
                let status = guard
                    .as_mut()
                    .and_then(|child| child.try_wait().ok().flatten());
                if status.is_some() {
                    guard.take();
                }
                status
            });
        if let Some(status) = exited {
            set_allowed_port(&app.state::<DesktopState>(), None);
            show_bootstrap_error(
                &window,
                &format!(
                    "The embedded AgentOS server stopped ({status}). Restart AgentOS to recover."
                ),
            );
            break;
        }
    });
}

#[cfg(not(debug_assertions))]
fn capture_output(
    stream: Option<impl std::io::Read + Send + 'static>,
    output: Arc<Mutex<VecDeque<String>>>,
) {
    let Some(stream) = stream else { return };
    thread::spawn(move || {
        for line in BufReader::new(stream).lines().flatten() {
            let sanitized = sanitize_output(&line);
            if sanitized.is_empty() {
                continue;
            }
            if let Ok(mut lines) = output.lock() {
                if lines.len() >= 12 {
                    lines.pop_front();
                }
                lines.push_back(sanitized);
            }
        }
    });
}

#[cfg(not(debug_assertions))]
fn snapshot_output(state: &DesktopState) -> String {
    state
        .output
        .lock()
        .map(|lines| lines.iter().cloned().collect::<Vec<_>>().join(" | "))
        .unwrap_or_default()
}

#[cfg(not(debug_assertions))]
fn sanitize_output(value: &str) -> String {
    let lower = value.to_ascii_lowercase();
    if lower.contains("token=")
        || lower.contains("password=")
        || lower.contains("secret=")
        || lower.contains("api_key=")
    {
        return "[redacted startup diagnostic]".to_string();
    }
    value.chars().take(240).collect()
}

#[cfg(not(debug_assertions))]
fn show_bootstrap_error(window: &WebviewWindow, message: &str) {
    let encoded = serde_json::to_string(message)
        .unwrap_or_else(|_| "\"AgentOS startup failed.\"".to_string());
    let script = format!(
        "document.body.innerHTML = '<main style=\"margin:auto;max-width:28rem;padding:2rem;font-family:system-ui;color:#f8fafc;background:#0f121e;border:1px solid #334155;border-radius:1rem\"><h1>AgentOS</h1><p id=\"agentos-error\" style=\"color:#fda4af;line-height:1.5\"></p></main>'; document.getElementById('agentos-error').textContent = {encoded};"
    );
    let _ = window.eval(&script);
}

#[cfg(not(debug_assertions))]
fn reserve_loopback_port() -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| format!("could not reserve a loopback port: {error}"))?;
    listener
        .local_addr()
        .map(|address| address.port())
        .map_err(|error| format!("could not read reserved port: {error}"))
}

fn set_allowed_port(state: &DesktopState, port: Option<u16>) {
    if let Ok(mut allowed_port) = state.allowed_port.lock() {
        *allowed_port = port;
    }
}

fn shutdown_embedded_agentos(app: &AppHandle) {
    let state = app.state::<DesktopState>();
    let Ok(mut child) = state.child.lock() else {
        return;
    };
    let Some(mut child) = child.take() else {
        set_allowed_port(&state, None);
        return;
    };

    if child.try_wait().ok().flatten().is_none() {
        let _ = request_graceful_termination(&mut child);
        if !wait_for_child_exit(&mut child, SHUTDOWN_GRACE) {
            eprintln!(
                "AgentOS embedded server exceeded the shutdown grace period; forcing termination."
            );
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    set_allowed_port(&state, None);
}

fn wait_for_child_exit(child: &mut Child, grace: Duration) -> bool {
    let deadline = Instant::now() + grace;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return true,
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(50)),
            Ok(None) => return false,
            Err(_) => return false,
        }
    }
}

#[cfg(unix)]
fn request_graceful_termination(child: &mut Child) -> bool {
    unsafe { libc::kill(child.id() as libc::pid_t, libc::SIGTERM) == 0 }
}

#[cfg(windows)]
fn request_graceful_termination(child: &mut Child) -> bool {
    // Windows has no portable POSIX signal equivalent. The packaged wrapper
    // receives this command over stdin and emits the existing Next.js cleanup
    // signal inside the server process. A non-wrapper child still gets the
    // native termination fallback so tests and unexpected children cannot leak.
    if let Some(stdin) = child.stdin.as_mut() {
        if stdin
            .write_all(b"shutdown\n")
            .and_then(|_| stdin.flush())
            .is_ok()
        {
            return true;
        }
    }

    child.kill().is_ok()
}

#[cfg(not(any(unix, windows)))]
fn request_graceful_termination(child: &mut Child) -> bool {
    child.kill().is_ok()
}

#[cfg(test)]
mod tests {
    use std::process::{Child, Command};
    use std::time::Duration;

    use super::{is_allowed_navigation, is_external_web_url, is_retryable_startup_error};
    use super::{request_graceful_termination, wait_for_child_exit};

    fn spawn_test_child(command: &str) -> Child {
        #[cfg(unix)]
        {
            Command::new("sh")
                .args(["-c", command])
                .spawn()
                .expect("test child should start")
        }

        #[cfg(windows)]
        {
            Command::new("cmd")
                .args(["/C", command])
                .spawn()
                .expect("test child should start")
        }
    }

    #[test]
    fn only_embedded_loopback_urls_are_allowed() {
        assert!(is_allowed_navigation(
            &"http://127.0.0.1:43123/".parse().unwrap(),
            Some(43123)
        ));
        assert!(is_allowed_navigation(
            &"tauri://localhost/index.html".parse().unwrap(),
            Some(43123)
        ));
        assert!(!is_allowed_navigation(
            &"http://127.0.0.1:43124/".parse().unwrap(),
            Some(43123)
        ));
        assert!(!is_allowed_navigation(
            &"https://example.com/".parse().unwrap(),
            Some(43123)
        ));
        assert!(!is_allowed_navigation(
            &"file:///etc/passwd".parse().unwrap(),
            Some(43123)
        ));
        assert!(!is_allowed_navigation(
            &"javascript:alert(1)".parse().unwrap(),
            Some(43123)
        ));
        assert!(!is_allowed_navigation(
            &"http://127.0.0.1.evil.example:43123/".parse().unwrap(),
            Some(43123)
        ));
    }

    #[test]
    fn only_http_urls_are_candidates_for_external_opening() {
        assert!(is_external_web_url(
            &"https://example.com/path?q=1".parse().unwrap()
        ));
        assert!(is_external_web_url(&"http://example.com/".parse().unwrap()));
        assert!(!is_external_web_url(
            &"javascript:alert(1)".parse().unwrap()
        ));
        assert!(!is_external_web_url(&"file:///etc/passwd".parse().unwrap()));
    }

    #[test]
    fn startup_retry_is_limited_to_process_address_collisions() {
        assert!(is_retryable_startup_error(
            "EADDRINUSE: address already in use"
        ));
        assert!(is_retryable_startup_error(
            "the packaged AgentOS server exited during startup"
        ));
        assert!(!is_retryable_startup_error(
            "the packaged AgentOS server or Node runtime is missing"
        ));
    }

    #[test]
    fn shutdown_wait_handles_an_already_exited_child() {
        let mut child = spawn_test_child("exit 0");
        assert!(wait_for_child_exit(&mut child, Duration::from_secs(1)));
    }

    #[test]
    fn shutdown_wait_observes_a_child_exiting_during_the_grace_period() {
        let mut child = spawn_test_child(if cfg!(unix) {
            "sleep 0.1"
        } else {
            "ping 127.0.0.1 -n 2 > nul"
        });
        assert!(wait_for_child_exit(&mut child, Duration::from_secs(2)));
    }

    #[test]
    fn shutdown_wait_has_a_bounded_grace_period_for_a_hung_child() {
        let mut child = spawn_test_child(if cfg!(unix) {
            "sleep 30"
        } else {
            "ping 127.0.0.1 -n 31 > nul"
        });
        assert!(!wait_for_child_exit(&mut child, Duration::from_millis(100)));
        let _ = child.kill();
        let _ = child.wait();
    }

    #[test]
    fn graceful_termination_reaps_a_child_during_shutdown() {
        let mut child = spawn_test_child(if cfg!(unix) {
            "sleep 30"
        } else {
            "ping 127.0.0.1 -n 31 > nul"
        });
        assert!(request_graceful_termination(&mut child));
        assert!(wait_for_child_exit(&mut child, Duration::from_secs(1)));
    }
}
