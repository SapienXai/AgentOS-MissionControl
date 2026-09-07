use serde::Serialize;
use tauri::{Emitter, Manager, State, WindowEvent};

mod error;
mod integrations;
mod native;
mod preferences;
mod product;
mod runtime;
mod terminal;
mod workspace;

use error::NativeError;
use native::platform_capabilities;
use preferences::PreferencesManager;
use product::ProductManager;
use runtime::{RuntimeDoctorResult, RuntimeLogEntry, RuntimeManager, RuntimeStatus};
use terminal::TerminalManager;
use workspace::WorkspaceManager;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlatformInfo {
    platform: &'static str,
    capabilities: native::PlatformCapabilities,
    app_version: String,
}

#[tauri::command]
fn platform_info(app: tauri::AppHandle) -> Result<PlatformInfo, String> {
    Ok(PlatformInfo {
        platform: "desktop",
        capabilities: platform_capabilities(),
        app_version: app.package_info().version.to_string(),
    })
}

#[tauri::command]
fn runtime_status(
    app: tauri::AppHandle,
    state: State<'_, RuntimeManager>,
) -> Result<RuntimeStatus, NativeError> {
    state.status(Some(&app))
}

#[tauri::command]
fn runtime_start(
    app: tauri::AppHandle,
    state: State<'_, RuntimeManager>,
) -> Result<RuntimeStatus, NativeError> {
    state.start(&app)
}

#[tauri::command]
fn runtime_stop(
    app: tauri::AppHandle,
    state: State<'_, RuntimeManager>,
) -> Result<RuntimeStatus, NativeError> {
    state.stop(&app)
}

#[tauri::command]
fn runtime_restart(
    app: tauri::AppHandle,
    state: State<'_, RuntimeManager>,
) -> Result<RuntimeStatus, NativeError> {
    state.restart(&app)
}

#[tauri::command]
fn runtime_doctor(
    app: tauri::AppHandle,
    state: State<'_, RuntimeManager>,
) -> Result<RuntimeDoctorResult, NativeError> {
    state.doctor(&app)
}

#[tauri::command]
fn runtime_logs(state: State<'_, RuntimeManager>) -> Vec<RuntimeLogEntry> {
    state.logs()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("AgentOS")
                .build(),
        )
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            integrations::show_main_window(app);
            for argument in argv {
                if let Some(route) = integrations::validate_deep_link(&argument) {
                    let _ = app.emit(integrations::DEEP_LINK_EVENT, route);
                }
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|error| format!("Unable to resolve AgentOS data directory: {error}"))?;
            std::fs::create_dir_all(&data_dir)
                .map_err(|error| format!("Unable to create AgentOS data directory: {error}"))?;
            app.manage(RuntimeManager::new());
            app.manage(TerminalManager::new());
            app.manage(WorkspaceManager::new(data_dir.clone()));
            app.manage(PreferencesManager::new(data_dir));
            app.manage(ProductManager::new());
            integrations::register_deep_link_listener(app.handle());
            integrations::register_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let close_to_tray = window
                    .app_handle()
                    .try_state::<PreferencesManager>()
                    .map(|preferences| preferences.close_to_tray())
                    .unwrap_or(true);
                if close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        });

    #[cfg(feature = "updater")]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    let app = builder
        .invoke_handler(tauri::generate_handler![
            platform_info,
            runtime_status,
            runtime_start,
            runtime_stop,
            runtime_restart,
            runtime_doctor,
            runtime_logs,
            preferences::desktop_preferences,
            preferences::desktop_preferences_save,
            product::product_snapshot,
            workspace::workspace_list,
            workspace::workspace_choose,
            workspace::workspace_list_directory,
            workspace::workspace_read_file,
            workspace::workspace_write_file,
            workspace::workspace_create_directory,
            workspace::workspace_rename,
            workspace::workspace_delete,
            workspace::workspace_git_summary,
            terminal::terminal_spawn,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_kill,
            native::ollama_status,
            native::secure_set,
            native::secure_get,
            native::secure_delete,
            integrations::native_notify,
            integrations::deep_link_current
        ])
        .build(tauri::generate_context!())
        .expect("error while building AgentOS desktop");
    app.run(|app, event| match event {
        tauri::RunEvent::Resumed => {
            let _ = app.emit("runtime-refresh-requested", ());
        }
        tauri::RunEvent::Exit => {
            if let Some(runtime) = app.try_state::<RuntimeManager>() {
                let _ = runtime.stop(app);
                runtime.shutdown(Some(app));
            }
        }
        _ => {}
    });
}
