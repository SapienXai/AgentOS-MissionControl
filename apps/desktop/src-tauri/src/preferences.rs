use std::{fs, path::PathBuf, sync::Mutex};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::NativeError;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPreferences {
    pub onboarding_completed: bool,
    pub close_to_tray: bool,
    pub notifications_enabled: bool,
    pub start_runtime_on_launch: bool,
}

impl Default for DesktopPreferences {
    fn default() -> Self {
        Self {
            onboarding_completed: false,
            close_to_tray: true,
            notifications_enabled: true,
            start_runtime_on_launch: false,
        }
    }
}

pub struct PreferencesManager {
    value: Mutex<DesktopPreferences>,
    path: PathBuf,
}

impl PreferencesManager {
    pub fn new(data_dir: PathBuf) -> Self {
        let path = data_dir.join("preferences.json");
        let value = fs::read_to_string(&path)
            .ok()
            .and_then(|content| serde_json::from_str(&content).ok())
            .unwrap_or_default();
        Self {
            value: Mutex::new(value),
            path,
        }
    }

    pub fn get(&self) -> DesktopPreferences {
        self.value
            .lock()
            .map(|value| value.clone())
            .unwrap_or_default()
    }

    pub fn close_to_tray(&self) -> bool {
        self.get().close_to_tray
    }

    fn save(&self, next: DesktopPreferences) -> Result<(), NativeError> {
        let content = serde_json::to_vec_pretty(&next).map_err(|_| {
            NativeError::new(
                "preferences-save-failed",
                "Desktop preferences could not be serialized.",
                true,
            )
        })?;
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|_| {
                NativeError::new(
                    "preferences-save-failed",
                    "Desktop preferences directory could not be created.",
                    true,
                )
            })?;
        }
        fs::write(&self.path, content).map_err(|_| {
            NativeError::new(
                "preferences-save-failed",
                "Desktop preferences could not be saved.",
                true,
            )
        })?;
        *self.value.lock().map_err(|_| {
            NativeError::new(
                "preferences-lock",
                "Desktop preferences are unavailable.",
                true,
            )
        })? = next;
        Ok(())
    }
}

#[tauri::command]
pub fn desktop_preferences(
    state: State<'_, PreferencesManager>,
) -> Result<DesktopPreferences, NativeError> {
    Ok(state.get())
}

#[tauri::command]
pub fn desktop_preferences_save(
    preferences: DesktopPreferences,
    state: State<'_, PreferencesManager>,
) -> Result<(), NativeError> {
    state.save(preferences)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_conservative_for_runtime_startup() {
        let preferences = DesktopPreferences::default();
        assert!(!preferences.onboarding_completed);
        assert!(preferences.close_to_tray);
        assert!(preferences.notifications_enabled);
        assert!(!preferences.start_runtime_on_launch);
    }

    #[test]
    fn malformed_preferences_fall_back_to_defaults() {
        let path =
            std::env::temp_dir().join(format!("agentos-preferences-test-{}", std::process::id()));
        fs::create_dir_all(&path).expect("preferences directory");
        fs::write(path.join("preferences.json"), "not-json").expect("malformed preferences");
        let manager = PreferencesManager::new(path.clone());
        assert_eq!(manager.get().onboarding_completed, false);
        fs::remove_dir_all(path).expect("preferences cleanup");
    }
}
