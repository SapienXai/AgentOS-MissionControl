use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    path::{Component, Path, PathBuf},
    process::Command,
    sync::Mutex,
    time::UNIX_EPOCH,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::error::NativeError;

const MAX_DIRECTORY_ENTRIES: usize = 500;
const MAX_TEXT_FILE_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalWorkspace {
    pub id: String,
    pub name: String,
    pub path: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntry {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub size: Option<u64>,
    pub modified_at: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitSummary {
    pub available: bool,
    pub repository: bool,
    pub branch: Option<String>,
    pub dirty: Option<bool>,
    pub summary: Option<String>,
    pub reason: Option<String>,
}

pub struct WorkspaceManager {
    workspaces: Mutex<Vec<LocalWorkspace>>,
    store_path: PathBuf,
}

impl WorkspaceManager {
    pub fn new(data_dir: PathBuf) -> Self {
        let store_path = data_dir.join("workspaces.json");
        let workspaces = fs::read_to_string(&store_path)
            .ok()
            .and_then(|value| serde_json::from_str::<Vec<LocalWorkspace>>(&value).ok())
            .unwrap_or_default();
        Self {
            workspaces: Mutex::new(workspaces),
            store_path,
        }
    }

    fn save(&self) -> Result<(), NativeError> {
        let workspaces = self.workspaces.lock().map_err(|_| {
            NativeError::new("workspace-lock", "Workspace state is unavailable.", true)
        })?;
        let content = serde_json::to_vec_pretty(&*workspaces).map_err(|_| {
            NativeError::new(
                "workspace-save-failed",
                "Workspace state could not be serialized.",
                true,
            )
        })?;
        if let Some(parent) = self.store_path.parent() {
            fs::create_dir_all(parent).map_err(|_| {
                NativeError::new(
                    "workspace-save-failed",
                    "Workspace state directory could not be created.",
                    true,
                )
            })?;
        }
        fs::write(&self.store_path, content).map_err(|_| {
            NativeError::new(
                "workspace-save-failed",
                "Workspace state could not be saved.",
                true,
            )
        })
    }

    fn find(&self, id: &str) -> Result<LocalWorkspace, NativeError> {
        if id.trim().is_empty() {
            return Err(NativeError::new(
                "workspace-invalid-id",
                "Workspace id is required.",
                false,
            ));
        }
        self.workspaces
            .lock()
            .map_err(|_| {
                NativeError::new("workspace-lock", "Workspace state is unavailable.", true)
            })?
            .iter()
            .find(|workspace| workspace.id == id)
            .cloned()
            .ok_or_else(|| {
                NativeError::new(
                    "workspace-not-found",
                    "The approved workspace no longer exists.",
                    false,
                )
            })
    }

    pub(crate) fn find_for_terminal(&self, id: &str) -> Result<LocalWorkspace, NativeError> {
        self.find(id)
    }
}

#[tauri::command]
pub fn workspace_list(
    state: State<'_, WorkspaceManager>,
) -> Result<Vec<LocalWorkspace>, NativeError> {
    Ok(state
        .workspaces
        .lock()
        .map_err(|_| NativeError::new("workspace-lock", "Workspace state is unavailable.", true))?
        .clone())
}

#[tauri::command]
pub fn workspace_choose(
    app: AppHandle,
    state: State<'_, WorkspaceManager>,
) -> Result<Option<LocalWorkspace>, NativeError> {
    let Some(file_path) = app
        .dialog()
        .file()
        .set_title("Choose an AgentOS workspace")
        .blocking_pick_folder()
    else {
        return Ok(None);
    };
    let selected = file_path.into_path().map_err(|_| {
        NativeError::new(
            "workspace-invalid-path",
            "The selected folder could not be resolved.",
            false,
        )
    })?;
    let root = selected.canonicalize().map_err(|_| {
        NativeError::new(
            "workspace-unavailable",
            "The selected folder is not accessible.",
            false,
        )
    })?;
    if !root.is_dir() {
        return Err(NativeError::new(
            "workspace-not-directory",
            "The selected path is not a directory.",
            false,
        ));
    }
    let path = root.to_string_lossy().to_string();
    let id = workspace_id(&path);
    let workspace = LocalWorkspace {
        id,
        name: root
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty())
            .unwrap_or("Workspace")
            .to_string(),
        path,
        created_at: unix_timestamp(),
    };
    let mut workspaces = state
        .workspaces
        .lock()
        .map_err(|_| NativeError::new("workspace-lock", "Workspace state is unavailable.", true))?;
    if let Some(existing) = workspaces
        .iter()
        .find(|candidate| candidate.id == workspace.id)
    {
        return Ok(Some(existing.clone()));
    }
    workspaces.push(workspace.clone());
    drop(workspaces);
    state.save()?;
    Ok(Some(workspace))
}

#[tauri::command]
pub fn workspace_list_directory(
    workspace_id: String,
    relative_path: Option<String>,
    state: State<'_, WorkspaceManager>,
) -> Result<Vec<WorkspaceEntry>, NativeError> {
    let workspace = state.find(&workspace_id)?;
    let target = safe_path(&workspace, relative_path.as_deref().unwrap_or(""))?;
    let mut entries = fs::read_dir(&target)
        .map_err(|_| {
            NativeError::new(
                "workspace-read-failed",
                "The workspace directory could not be read.",
                true,
            )
        })?
        .filter_map(Result::ok)
        .take(MAX_DIRECTORY_ENTRIES + 1)
        .map(|entry| entry_to_model(&workspace, entry))
        .collect::<Result<Vec<_>, _>>()?;
    if entries.len() > MAX_DIRECTORY_ENTRIES {
        entries.truncate(MAX_DIRECTORY_ENTRIES);
    }
    entries.sort_by(|left, right| {
        left.kind
            .cmp(&right.kind)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(entries)
}

#[tauri::command]
pub fn workspace_read_file(
    workspace_id: String,
    relative_path: String,
    state: State<'_, WorkspaceManager>,
) -> Result<String, NativeError> {
    let workspace = state.find(&workspace_id)?;
    let target = safe_path(&workspace, &relative_path)?;
    let metadata = fs::metadata(&target).map_err(|_| {
        NativeError::new(
            "workspace-file-missing",
            "The requested workspace file is not available.",
            false,
        )
    })?;
    if !metadata.is_file() {
        return Err(NativeError::new(
            "workspace-not-file",
            "The requested workspace path is not a file.",
            false,
        ));
    }
    if metadata.len() > MAX_TEXT_FILE_BYTES {
        return Err(NativeError::new(
            "workspace-file-too-large",
            "The requested file is larger than the safe text preview limit.",
            false,
        ));
    }
    let bytes = fs::read(&target).map_err(|_| {
        NativeError::new(
            "workspace-read-failed",
            "The workspace file could not be read.",
            true,
        )
    })?;
    String::from_utf8(bytes).map_err(|_| {
        NativeError::new(
            "workspace-binary-file",
            "Binary workspace files are not opened as text.",
            false,
        )
    })
}

#[tauri::command]
pub fn workspace_write_file(
    workspace_id: String,
    relative_path: String,
    contents: String,
    state: State<'_, WorkspaceManager>,
) -> Result<(), NativeError> {
    if contents.len() as u64 > MAX_TEXT_FILE_BYTES {
        return Err(NativeError::new(
            "workspace-file-too-large",
            "The workspace write exceeds the safe text file limit.",
            false,
        ));
    }
    let workspace = state.find(&workspace_id)?;
    let target = safe_path_for_write(&workspace, &relative_path)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|_| {
            NativeError::new(
                "workspace-write-failed",
                "The workspace file parent could not be created.",
                true,
            )
        })?;
    }
    fs::write(target, contents).map_err(|_| {
        NativeError::new(
            "workspace-write-failed",
            "The workspace file could not be written.",
            true,
        )
    })
}

#[tauri::command]
pub fn workspace_create_directory(
    workspace_id: String,
    relative_path: String,
    state: State<'_, WorkspaceManager>,
) -> Result<(), NativeError> {
    let workspace = state.find(&workspace_id)?;
    let target = safe_path_for_write(&workspace, &relative_path)?;
    fs::create_dir_all(target).map_err(|_| {
        NativeError::new(
            "workspace-directory-failed",
            "The workspace directory could not be created.",
            true,
        )
    })
}

#[tauri::command]
pub fn workspace_rename(
    workspace_id: String,
    from: String,
    to: String,
    state: State<'_, WorkspaceManager>,
) -> Result<(), NativeError> {
    let workspace = state.find(&workspace_id)?;
    let source = safe_path_for_remove(&workspace, &from)?;
    let root = PathBuf::from(&workspace.path).canonicalize().map_err(|_| {
        NativeError::new(
            "workspace-unavailable",
            "The approved workspace directory is missing or inaccessible.",
            false,
        )
    })?;
    if source == root {
        return Err(NativeError::new(
            "workspace-root-protected",
            "The approved workspace root cannot be renamed from AgentOS.",
            false,
        ));
    }
    if fs::symlink_metadata(&source)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(NativeError::new(
            "workspace-path-denied",
            "Workspace symbolic links cannot be renamed.",
            false,
        ));
    }
    let target = safe_path_for_write(&workspace, &to)?;
    if target.exists() {
        return Err(NativeError::new(
            "workspace-target-exists",
            "The destination already exists.",
            false,
        ));
    }
    fs::rename(source, target).map_err(|_| {
        NativeError::new(
            "workspace-rename-failed",
            "The workspace path could not be renamed.",
            true,
        )
    })
}

#[tauri::command]
pub fn workspace_delete(
    workspace_id: String,
    relative_path: String,
    confirm: bool,
    state: State<'_, WorkspaceManager>,
) -> Result<(), NativeError> {
    if !confirm {
        return Err(NativeError::new(
            "workspace-delete-confirmation-required",
            "Deleting a workspace path requires explicit confirmation.",
            false,
        ));
    }
    let workspace = state.find(&workspace_id)?;
    let root = PathBuf::from(&workspace.path).canonicalize().map_err(|_| {
        NativeError::new(
            "workspace-unavailable",
            "The approved workspace directory is missing or inaccessible.",
            false,
        )
    })?;
    let target = safe_path_for_remove(&workspace, &relative_path)?;
    if target == root {
        return Err(NativeError::new(
            "workspace-root-protected",
            "The approved workspace root cannot be deleted from AgentOS.",
            false,
        ));
    }
    let metadata = fs::symlink_metadata(&target).map_err(|_| {
        NativeError::new(
            "workspace-path-missing",
            "The requested workspace path does not exist.",
            false,
        )
    })?;
    if metadata.is_dir() {
        fs::remove_dir_all(target)
    } else {
        fs::remove_file(target)
    }
    .map_err(|_| {
        NativeError::new(
            "workspace-delete-failed",
            "The workspace path could not be deleted.",
            true,
        )
    })
}

#[tauri::command]
pub fn workspace_git_summary(
    workspace_id: String,
    state: State<'_, WorkspaceManager>,
) -> Result<GitSummary, NativeError> {
    let workspace = state.find(&workspace_id)?;
    let output = Command::new("git")
        .args(["-C", &workspace.path, "status", "--porcelain", "--branch"])
        .output();
    let Ok(output) = output else {
        return Ok(GitSummary {
            available: false,
            repository: false,
            branch: None,
            dirty: None,
            summary: None,
            reason: Some("Git is not installed or is unavailable on PATH.".to_string()),
        });
    };
    let text = String::from_utf8_lossy(&output.stdout);
    if !output.status.success() {
        return Ok(GitSummary {
            available: true,
            repository: false,
            branch: None,
            dirty: None,
            summary: None,
            reason: Some("This workspace is not a Git repository.".to_string()),
        });
    }
    let branch = text
        .lines()
        .find_map(|line| line.strip_prefix("## "))
        .map(|value| {
            value
                .split("...")
                .next()
                .unwrap_or(value)
                .trim()
                .to_string()
        });
    let dirty = text.lines().skip(1).any(|line| !line.trim().is_empty());
    Ok(GitSummary {
        available: true,
        repository: true,
        branch,
        dirty: Some(dirty),
        summary: Some(if dirty {
            "Working tree has changes.".to_string()
        } else {
            "Working tree is clean.".to_string()
        }),
        reason: None,
    })
}

fn entry_to_model(
    workspace: &LocalWorkspace,
    entry: fs::DirEntry,
) -> Result<WorkspaceEntry, NativeError> {
    let path = entry.path();
    let file_type = entry.file_type().map_err(|_| {
        NativeError::new(
            "workspace-entry-failed",
            "A workspace entry could not be inspected.",
            true,
        )
    })?;
    let metadata = entry.metadata().ok();
    let kind = if file_type.is_symlink() {
        "symlink"
    } else if file_type.is_dir() {
        "directory"
    } else if file_type.is_file() {
        "file"
    } else {
        "other"
    };
    Ok(WorkspaceEntry {
        name: entry.file_name().to_string_lossy().to_string(),
        path: relative_display_path(workspace, &path),
        kind: kind.to_string(),
        size: metadata
            .as_ref()
            .filter(|_| kind == "file")
            .map(|value| value.len()),
        modified_at: metadata
            .and_then(|value| value.modified().ok())
            .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
            .map(|value| value.as_secs().to_string()),
    })
}

fn safe_path(workspace: &LocalWorkspace, relative: &str) -> Result<PathBuf, NativeError> {
    let root = PathBuf::from(&workspace.path).canonicalize().map_err(|_| {
        NativeError::new(
            "workspace-unavailable",
            "The approved workspace directory is missing or inaccessible.",
            false,
        )
    })?;
    let candidate = Path::new(relative);
    if candidate.is_absolute()
        || candidate
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(NativeError::new(
            "workspace-path-denied",
            "Workspace paths must stay inside the approved directory.",
            false,
        ));
    }
    let joined = root.join(candidate);
    let resolved = joined.canonicalize().map_err(|_| {
        NativeError::new(
            "workspace-path-missing",
            "The requested workspace path does not exist.",
            false,
        )
    })?;
    if !resolved.starts_with(&root) {
        return Err(NativeError::new(
            "workspace-path-denied",
            "Workspace paths must stay inside the approved directory.",
            false,
        ));
    }
    Ok(resolved)
}

fn safe_path_for_write(workspace: &LocalWorkspace, relative: &str) -> Result<PathBuf, NativeError> {
    let root = PathBuf::from(&workspace.path).canonicalize().map_err(|_| {
        NativeError::new(
            "workspace-unavailable",
            "The approved workspace directory is missing or inaccessible.",
            false,
        )
    })?;
    let candidate = Path::new(relative);
    if candidate.is_absolute()
        || candidate
            .components()
            .any(|component| matches!(component, Component::ParentDir))
        || relative.trim().is_empty()
    {
        return Err(NativeError::new(
            "workspace-path-denied",
            "Workspace paths must stay inside the approved directory.",
            false,
        ));
    }
    let target = root.join(candidate);
    let mut existing_parent = target.parent().ok_or_else(|| {
        NativeError::new(
            "workspace-path-denied",
            "The workspace destination is invalid.",
            false,
        )
    })?;
    while !existing_parent.exists() {
        existing_parent = existing_parent.parent().ok_or_else(|| {
            NativeError::new(
                "workspace-path-denied",
                "The workspace destination is invalid.",
                false,
            )
        })?;
    }
    if !existing_parent
        .canonicalize()
        .map_err(|_| {
            NativeError::new(
                "workspace-path-denied",
                "The workspace destination is invalid.",
                false,
            )
        })?
        .starts_with(&root)
    {
        return Err(NativeError::new(
            "workspace-path-denied",
            "Workspace paths must stay inside the approved directory.",
            false,
        ));
    }
    if fs::symlink_metadata(&target)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(NativeError::new(
            "workspace-path-denied",
            "Workspace writes cannot target symbolic links.",
            false,
        ));
    }
    if target.exists()
        && !target
            .canonicalize()
            .map_err(|_| {
                NativeError::new(
                    "workspace-path-denied",
                    "The workspace destination is invalid.",
                    false,
                )
            })?
            .starts_with(&root)
    {
        return Err(NativeError::new(
            "workspace-path-denied",
            "Workspace paths must stay inside the approved directory.",
            false,
        ));
    }
    Ok(target)
}

fn safe_path_for_remove(
    workspace: &LocalWorkspace,
    relative: &str,
) -> Result<PathBuf, NativeError> {
    let root = PathBuf::from(&workspace.path).canonicalize().map_err(|_| {
        NativeError::new(
            "workspace-unavailable",
            "The approved workspace directory is missing or inaccessible.",
            false,
        )
    })?;
    let candidate = Path::new(relative);
    if candidate.is_absolute()
        || candidate
            .components()
            .any(|component| matches!(component, Component::ParentDir))
        || relative.trim().is_empty()
    {
        return Err(NativeError::new(
            "workspace-path-denied",
            "Workspace paths must stay inside the approved directory.",
            false,
        ));
    }
    let target = root.join(candidate);
    let parent = target.parent().ok_or_else(|| {
        NativeError::new(
            "workspace-path-denied",
            "The workspace path is invalid.",
            false,
        )
    })?;
    let resolved_parent = parent.canonicalize().map_err(|_| {
        NativeError::new(
            "workspace-path-denied",
            "Workspace paths must stay inside the approved directory.",
            false,
        )
    })?;
    if !resolved_parent.starts_with(&root) {
        return Err(NativeError::new(
            "workspace-path-denied",
            "Workspace paths must stay inside the approved directory.",
            false,
        ));
    }
    let metadata = fs::symlink_metadata(&target).map_err(|_| {
        NativeError::new(
            "workspace-path-missing",
            "The requested workspace path does not exist.",
            false,
        )
    })?;
    if metadata.file_type().is_symlink() {
        return Ok(target);
    }
    let resolved = target.canonicalize().map_err(|_| {
        NativeError::new(
            "workspace-path-missing",
            "The requested workspace path does not exist.",
            false,
        )
    })?;
    if !resolved.starts_with(&root) {
        return Err(NativeError::new(
            "workspace-path-denied",
            "Workspace paths must stay inside the approved directory.",
            false,
        ));
    }
    Ok(target)
}

fn relative_display_path(workspace: &LocalWorkspace, path: &Path) -> String {
    path.strip_prefix(&workspace.path)
        .ok()
        .unwrap_or(path)
        .to_string_lossy()
        .trim_start_matches(std::path::MAIN_SEPARATOR)
        .to_string()
}
fn workspace_id(path: &str) -> String {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    format!("workspace-{:x}", hasher.finish())
}
fn unix_timestamp() -> String {
    std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_paths_reject_traversal() {
        let root =
            std::env::temp_dir().join(format!("agentos-workspace-test-{}", std::process::id()));
        fs::create_dir_all(&root).expect("test root");
        let workspace = LocalWorkspace {
            id: "test".to_string(),
            name: "test".to_string(),
            path: root.to_string_lossy().to_string(),
            created_at: "0".to_string(),
        };
        let error =
            safe_path_for_write(&workspace, "../outside.txt").expect_err("traversal must fail");
        assert_eq!(error.code, "workspace-path-denied");
        let absolute = std::env::temp_dir().join("outside.txt");
        let error = safe_path_for_write(&workspace, &absolute.to_string_lossy())
            .expect_err("absolute path must fail");
        assert_eq!(error.code, "workspace-path-denied");
        let nested = safe_path_for_write(&workspace, "nested/file.txt").expect("nested path");
        assert!(nested.ends_with("nested/file.txt"));
        fs::remove_dir_all(root).expect("test root cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn write_paths_reject_symlinked_parent_directories() {
        let root = std::env::temp_dir().join(format!(
            "agentos-workspace-nested-symlink-{}",
            std::process::id()
        ));
        let outside = std::env::temp_dir().join(format!(
            "agentos-workspace-nested-target-{}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("test root");
        fs::create_dir_all(&outside).expect("outside directory");
        let root = root.canonicalize().expect("canonical test root");
        std::os::unix::fs::symlink(&outside, root.join("linked")).expect("parent symlink");
        let workspace = LocalWorkspace {
            id: "test".to_string(),
            name: "test".to_string(),
            path: root.to_string_lossy().to_string(),
            created_at: "0".to_string(),
        };

        let error = safe_path_for_write(&workspace, "linked/escape.txt")
            .expect_err("symlinked parent must fail");
        assert_eq!(error.code, "workspace-path-denied");

        fs::remove_file(root.join("linked")).expect("link cleanup");
        fs::remove_dir_all(root).expect("test root cleanup");
        fs::remove_dir_all(outside).expect("outside cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn remove_paths_keep_final_symlinks_inside_the_workspace_boundary() {
        let root = std::env::temp_dir().join(format!(
            "agentos-workspace-symlink-test-{}",
            std::process::id()
        ));
        let outside = std::env::temp_dir().join(format!(
            "agentos-workspace-symlink-target-{}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("test root");
        let root = root.canonicalize().expect("canonical test root");
        fs::write(&outside, "target").expect("test target");
        let link = root.join("link.txt");
        std::os::unix::fs::symlink(&outside, &link).expect("test link");
        let workspace = LocalWorkspace {
            id: "test".to_string(),
            name: "test".to_string(),
            path: root.to_string_lossy().to_string(),
            created_at: "0".to_string(),
        };

        let resolved = safe_path_for_remove(&workspace, "link.txt").expect("link path");
        assert_eq!(resolved, link);
        assert!(fs::symlink_metadata(&resolved)
            .expect("link metadata")
            .file_type()
            .is_symlink());

        fs::remove_file(&link).expect("link cleanup");
        fs::remove_file(outside).expect("target cleanup");
        fs::remove_dir_all(root).expect("test root cleanup");
    }
}
