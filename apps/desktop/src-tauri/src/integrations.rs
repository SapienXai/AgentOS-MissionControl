use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, Runtime,
};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_notification::NotificationExt;

use crate::{error::NativeError, runtime::RuntimeManager};

pub const DEEP_LINK_EVENT: &str = "deep-link";

pub fn register_deep_link_listener<R: Runtime>(app: &AppHandle<R>) {
    let handle = app.clone();
    app.deep_link().on_open_url(move |event| {
        for url in event.urls() {
            if let Some(route) = validate_deep_link(url.as_str()) {
                let _ = handle.emit(DEEP_LINK_EVENT, route);
            }
        }
    });

    if let Ok(Some(urls)) = app.deep_link().get_current() {
        for url in urls {
            if let Some(route) = validate_deep_link(url.as_str()) {
                let _ = app.emit(DEEP_LINK_EVENT, route);
            }
        }
    }
}

#[tauri::command]
pub fn deep_link_current<R: Runtime>(app: AppHandle<R>) -> Vec<String> {
    app.deep_link()
        .get_current()
        .ok()
        .flatten()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|url| validate_deep_link(url.as_str()))
        .collect()
}

pub fn register_tray(app: &tauri::AppHandle) -> Result<(), String> {
    let open = MenuItemBuilder::with_id("open", "Open AgentOS")
        .build(app)
        .map_err(|error| error.to_string())?;
    let runtime = MenuItemBuilder::with_id("runtime", "Runtime status")
        .enabled(false)
        .build(app)
        .map_err(|error| error.to_string())?;
    let stop = MenuItemBuilder::with_id("stop-runtime", "Stop managed runtime")
        .build(app)
        .map_err(|error| error.to_string())?;
    let quit = MenuItemBuilder::with_id("quit", "Quit AgentOS")
        .build(app)
        .map_err(|error| error.to_string())?;
    let menu = MenuBuilder::new(app)
        .items(&[&open, &runtime, &stop, &quit])
        .build()
        .map_err(|error| error.to_string())?;

    let mut tray = TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("AgentOS")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main_window(app),
            "stop-runtime" => {
                if let Some(runtime) = app.try_state::<RuntimeManager>() {
                    let _ = runtime.stop(app);
                }
            }
            "quit" => {
                if let Some(runtime) = app.try_state::<RuntimeManager>() {
                    let _ = runtime.stop(app);
                }
                app.exit(0);
            }
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app).map_err(|error| error.to_string())?;
    Ok(())
}

pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn notify_event<R: Runtime>(app: &AppHandle<R>, event: &str) -> Result<(), NativeError> {
    let (title, body) = match event {
        "runtime-crashed" => (
            "OpenClaw needs attention",
            "The managed local runtime exited unexpectedly. Open AgentOS to inspect its health.",
        ),
        "approval-required" => (
            "Approval required",
            "An AgentOS operation is waiting for your review.",
        ),
        "mission-completed" => (
            "Mission completed",
            "An AgentOS mission finished successfully.",
        ),
        "agent-blocked" => (
            "Agent blocked",
            "An AgentOS agent needs operator attention before it can continue.",
        ),
        "critical-error" => (
            "AgentOS needs attention",
            "A critical desktop operation failed. Open AgentOS to recover.",
        ),
        _ => {
            return Err(NativeError::new(
                "notification-event-denied",
                "The requested notification event is not supported.",
                false,
            ))
        }
    };

    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|_| {
            NativeError::new(
                "notification-failed",
                "The desktop notification could not be shown.",
                true,
            )
        })
}

pub fn validate_deep_link(value: &str) -> Option<String> {
    let url = value.parse::<tauri::Url>().ok()?;
    if url.scheme() != "agentos"
        || url.username() != ""
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return None;
    }
    let host = url.host_str()?;
    let segments = url.path_segments()?.filter(|segment| !segment.is_empty());
    let segments = segments.collect::<Vec<_>>();
    match host {
        "agents" | "missions" if segments.len() == 1 && is_safe_segment(segments[0]) => {
            Some(format!("{host}/{}", segments[0]))
        }
        "settings" if segments.as_slice() == ["runtime"] => Some("runtime".to_string()),
        _ => None,
    }
}

fn is_safe_segment(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "._-".contains(character))
}

#[cfg(test)]
mod tests {
    use super::validate_deep_link;

    #[test]
    fn deep_links_accept_only_known_routes() {
        assert_eq!(
            validate_deep_link("agentos://settings/runtime"),
            Some("runtime".to_string())
        );
        assert_eq!(
            validate_deep_link("agentos://missions/mission-1"),
            Some("missions/mission-1".to_string())
        );
        assert_eq!(
            validate_deep_link("agentos://settings/runtime?command=quit"),
            None
        );
        assert_eq!(validate_deep_link("agentos://shell/quit"), None);
        assert_eq!(
            validate_deep_link("https://agentos.ai/missions/mission-1"),
            None
        );
    }
}

#[tauri::command]
pub fn native_notify(app: AppHandle, event: String) -> Result<(), NativeError> {
    notify_event(&app, &event)
}
