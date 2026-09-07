use std::{collections::HashMap, sync::Mutex};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, State};

use crate::{
    error::NativeError,
    integrations,
    preferences::PreferencesManager,
    runtime::{parse_json, resolve_openclaw_binary, run_command, sanitize_text, unix_timestamp},
};

const RUNTIME_ID: &str = "openclaw-local";
const EXECUTION_TARGET_ID: &str = "this-computer-openclaw";
const MAX_ACTIVITY: usize = 60;
const MAX_SKILLS: usize = 80;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionTarget {
    pub id: String,
    pub label: String,
    pub runtime_id: String,
    pub location: String,
    pub status: String,
    pub capabilities: ExecutionTargetCapabilities,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionTargetCapabilities {
    pub filesystem: bool,
    pub terminal: bool,
    pub browser: bool,
    pub memory: bool,
    pub skills: bool,
    pub multi_agent: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAgent {
    pub id: String,
    pub name: String,
    pub workspace_path: Option<String>,
    pub model_id: Option<String>,
    pub status: String,
    pub current_action: Option<String>,
    pub runtime_id: String,
    pub execution_target_id: String,
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DesktopMission {
    pub id: String,
    pub title: String,
    pub summary: Option<String>,
    pub status: String,
    pub agent_id: Option<String>,
    pub agent_name: Option<String>,
    pub runtime_id: String,
    pub execution_target_id: String,
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DesktopApproval {
    pub id: String,
    pub title: String,
    pub summary: Option<String>,
    pub agent_id: Option<String>,
    pub mission_id: Option<String>,
    pub status: String,
    pub runtime_id: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DesktopActivity {
    pub id: String,
    pub title: String,
    pub detail: Option<String>,
    pub kind: String,
    pub agent_id: Option<String>,
    pub runtime_id: String,
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DesktopModel {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub local: Option<bool>,
    pub available: Option<bool>,
    pub tags: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSkill {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub available: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DesktopMemoryStatus {
    pub available: bool,
    pub indexed_files: u64,
    pub dirty: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DesktopConnection {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub connection_type: String,
    pub status: String,
    pub detail: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DesktopConnectivity {
    pub cli_installed: bool,
    pub gateway_reachable: Option<bool>,
    pub gateway_ready: Option<bool>,
    pub reason: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DesktopProductSnapshot {
    pub generated_at: String,
    pub source: String,
    pub mode: String,
    pub reason: Option<String>,
    pub issues: Vec<String>,
    pub agents: Vec<DesktopAgent>,
    pub missions: Vec<DesktopMission>,
    pub approvals: Vec<DesktopApproval>,
    pub activity: Vec<DesktopActivity>,
    pub models: Vec<DesktopModel>,
    pub skills: Vec<DesktopSkill>,
    pub memory: DesktopMemoryStatus,
    pub execution_targets: Vec<ExecutionTarget>,
    pub connections: Vec<DesktopConnection>,
    pub connectivity: DesktopConnectivity,
}

pub struct ProductManager {
    previous: Mutex<Option<DesktopProductSnapshot>>,
}

impl ProductManager {
    pub fn new() -> Self {
        Self {
            previous: Mutex::new(None),
        }
    }

    fn snapshot(
        &self,
        app: &AppHandle,
        notifications_enabled: bool,
    ) -> Result<DesktopProductSnapshot, NativeError> {
        let snapshot = build_snapshot();
        if notifications_enabled {
            let mut previous = self.previous.lock().map_err(|_| {
                NativeError::new("product-lock", "Product state is unavailable.", true)
            })?;
            if let Some(previous) = previous.as_ref() {
                emit_transition_notifications(app, previous, &snapshot);
            }
            *previous = Some(snapshot.clone());
        } else if let Ok(mut previous) = self.previous.lock() {
            *previous = Some(snapshot.clone());
        }
        Ok(snapshot)
    }
}

#[tauri::command]
pub fn product_snapshot(
    app: AppHandle,
    state: State<'_, ProductManager>,
    preferences: State<'_, PreferencesManager>,
) -> Result<DesktopProductSnapshot, NativeError> {
    state.snapshot(&app, preferences.get().notifications_enabled)
}

fn build_snapshot() -> DesktopProductSnapshot {
    let generated_at = unix_timestamp();
    let Some(binary) = resolve_openclaw_binary() else {
        return offline_snapshot(generated_at);
    };

    let mut issues = Vec::new();
    let agents_json = read_command(
        &binary,
        "agents",
        &["agents", "list", "--json"],
        &mut issues,
    );
    let sessions_json = read_command(
        &binary,
        "sessions",
        &[
            "sessions",
            "list",
            "--json",
            "--all-agents",
            "--limit",
            "100",
        ],
        &mut issues,
    );
    let tasks_json = read_command(&binary, "tasks", &["tasks", "list", "--json"], &mut issues);
    let models_json = read_command(
        &binary,
        "models",
        &["models", "list", "--json"],
        &mut issues,
    );
    let approvals_json = read_command(
        &binary,
        "approvals",
        &["approvals", "pending", "--json"],
        &mut issues,
    );
    let skills_json = read_command(
        &binary,
        "skills",
        &["skills", "list", "--json"],
        &mut issues,
    );
    let memory_json = read_command(
        &binary,
        "memory",
        &["memory", "status", "--json"],
        &mut issues,
    );
    let status_json = read_command(&binary, "status", &["status", "--json"], &mut issues);

    let agent_values = array_values(agents_json.as_ref());
    let task_values = array_at(tasks_json.as_ref(), "tasks");
    let session_values = array_at(sessions_json.as_ref(), "sessions");
    let tasks_by_agent = task_values.iter().fold(
        HashMap::<String, Vec<&Value>>::new(),
        |mut grouped, task| {
            if !is_automation(task) {
                if let Some(agent_id) = first_string(task, &["agentId", "agent_id"]) {
                    grouped.entry(agent_id).or_default().push(*task);
                }
            }
            grouped
        },
    );

    let agents = agent_values
        .iter()
        .filter_map(|agent| {
            let agent_id = string_at(agent, "id")?;
            build_agent(agent, tasks_by_agent.get(&agent_id))
        })
        .collect::<Vec<_>>();
    let agent_names = agents
        .iter()
        .map(|agent| (agent.id.clone(), agent.name.clone()))
        .collect::<HashMap<_, _>>();

    let missions = task_values
        .iter()
        .filter_map(|task| build_mission(task, &agent_names))
        .collect::<Vec<_>>();
    let approvals = build_approvals(approvals_json.as_ref());
    let mut activity = build_task_activity(&task_values, &agent_names);
    activity.extend(build_session_activity(&session_values));
    activity.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    activity.truncate(MAX_ACTIVITY);

    let models = array_at(models_json.as_ref(), "models")
        .iter()
        .filter_map(|model| build_model(model))
        .collect::<Vec<_>>();
    let skills = array_at(skills_json.as_ref(), "skills")
        .iter()
        .take(MAX_SKILLS)
        .filter_map(|skill| build_skill(skill))
        .collect::<Vec<_>>();
    let memory = build_memory(memory_json.as_ref());
    let (gateway_reachable, gateway_ready, gateway_reason, connections) =
        build_connectivity(status_json.as_ref());
    let mode = if issues.is_empty() && gateway_ready == Some(true) {
        "live"
    } else if issues.len() == 8 && gateway_reachable.is_none() {
        "offline"
    } else {
        "degraded"
    };
    let reason = gateway_reason.clone().or_else(|| issues.first().cloned());

    DesktopProductSnapshot {
        generated_at,
        source: "openclaw-cli".to_string(),
        mode: mode.to_string(),
        reason,
        issues,
        agents,
        missions,
        approvals,
        activity,
        models,
        skills,
        memory: memory.clone(),
        execution_targets: vec![local_execution_target(
            mode,
            agents_json.is_some(),
            skills_json.is_some(),
            memory.available,
        )],
        connections,
        connectivity: DesktopConnectivity {
            cli_installed: true,
            gateway_reachable,
            gateway_ready,
            reason: gateway_reason,
        },
    }
}

fn offline_snapshot(generated_at: String) -> DesktopProductSnapshot {
    DesktopProductSnapshot {
        generated_at,
        source: "openclaw-cli".to_string(),
        mode: "offline".to_string(),
        reason: Some("OpenClaw is not installed or could not be resolved.".to_string()),
        issues: vec!["OpenClaw is not installed or could not be resolved.".to_string()],
        agents: Vec::new(),
        missions: Vec::new(),
        approvals: Vec::new(),
        activity: Vec::new(),
        models: Vec::new(),
        skills: Vec::new(),
        memory: DesktopMemoryStatus {
            available: false,
            indexed_files: 0,
            dirty: false,
            reason: Some("OpenClaw memory status is unavailable.".to_string()),
        },
        execution_targets: vec![local_execution_target("offline", false, false, false)],
        connections: Vec::new(),
        connectivity: DesktopConnectivity {
            cli_installed: false,
            gateway_reachable: None,
            gateway_ready: None,
            reason: Some("OpenClaw is not installed or could not be resolved.".to_string()),
        },
    }
}

fn local_execution_target(
    mode: &str,
    agents_available: bool,
    skills_available: bool,
    memory_available: bool,
) -> ExecutionTarget {
    ExecutionTarget {
        id: EXECUTION_TARGET_ID.to_string(),
        label: "This Computer · OpenClaw".to_string(),
        runtime_id: RUNTIME_ID.to_string(),
        location: "local".to_string(),
        status: match mode {
            "live" => "ready",
            "offline" => "offline",
            "degraded" => "degraded",
            _ => "unknown",
        }
        .to_string(),
        capabilities: ExecutionTargetCapabilities {
            filesystem: true,
            terminal: true,
            browser: false,
            memory: memory_available,
            skills: skills_available,
            multi_agent: agents_available,
        },
    }
}

fn read_command(
    binary: &str,
    label: &str,
    args: &[&str],
    issues: &mut Vec<String>,
) -> Option<Value> {
    match run_command(binary, args) {
        Ok(output) => parse_json(&format!("{}\n{}", output.stdout, output.stderr)).or_else(|| {
            issues.push(format!("OpenClaw {label} data is unavailable."));
            None
        }),
        Err(_) => {
            issues.push(format!("OpenClaw {label} data is unavailable."));
            None
        }
    }
}

fn build_agent(value: &Value, tasks: Option<&Vec<&Value>>) -> Option<DesktopAgent> {
    let id = string_at(value, "id")?;
    let task = tasks.and_then(|items| {
        items
            .iter()
            .copied()
            .find(|task| task_status(task) == "running")
            .or_else(|| items.first().copied())
    });
    let status = task.map(task_status).map(agent_status).unwrap_or("ready");
    Some(DesktopAgent {
        id,
        name: first_string(value, &["name", "identityName"]).unwrap_or_else(|| "Agent".to_string()),
        workspace_path: first_string(value, &["workspace", "workspacePath"]),
        model_id: first_string(value, &["model", "modelId"]),
        status: status.to_string(),
        current_action: task
            .and_then(|task| first_string(task, &["progressSummary", "label", "task"])),
        runtime_id: RUNTIME_ID.to_string(),
        execution_target_id: EXECUTION_TARGET_ID.to_string(),
        updated_at: task.and_then(latest_timestamp),
    })
}

fn build_mission(value: &Value, agent_names: &HashMap<String, String>) -> Option<DesktopMission> {
    if is_automation(value) {
        return None;
    }
    let id = first_string(value, &["taskId", "id"])?;
    let agent_id = first_string(value, &["agentId", "agent_id"]);
    Some(DesktopMission {
        id,
        title: first_string(value, &["label", "task", "name"])
            .unwrap_or_else(|| "Untitled mission".to_string()),
        summary: first_string(value, &["progressSummary", "error", "summary"]),
        status: task_status(value).to_string(),
        agent_name: agent_id
            .as_ref()
            .and_then(|id| agent_names.get(id).cloned()),
        agent_id,
        runtime_id: RUNTIME_ID.to_string(),
        execution_target_id: EXECUTION_TARGET_ID.to_string(),
        updated_at: latest_timestamp(value),
    })
}

fn build_approvals(value: Option<&Value>) -> Vec<DesktopApproval> {
    array_values(value)
        .iter()
        .filter_map(|approval| {
            let id = first_string(approval, &["id", "approvalId", "requestId"])?;
            Some(DesktopApproval {
                id,
                title: first_string(approval, &["title", "label", "tool", "name"])
                    .unwrap_or_else(|| "Approval request".to_string()),
                summary: first_string(approval, &["summary", "reason", "description"]),
                agent_id: first_string(approval, &["agentId", "agent_id"]),
                mission_id: first_string(approval, &["taskId", "missionId"]),
                status: "pending".to_string(),
                runtime_id: RUNTIME_ID.to_string(),
            })
        })
        .collect()
}

fn build_task_activity(
    tasks: &[&Value],
    agent_names: &HashMap<String, String>,
) -> Vec<DesktopActivity> {
    tasks
        .iter()
        .filter(|task| !is_automation(task))
        .filter_map(|task| {
            let id = first_string(task, &["taskId", "id"])?;
            let agent_id = first_string(task, &["agentId", "agent_id"]);
            Some(DesktopActivity {
                id: format!("task:{id}"),
                title: first_string(task, &["label", "task", "name"])
                    .or_else(|| {
                        agent_id
                            .as_ref()
                            .and_then(|id| agent_names.get(id).cloned())
                    })
                    .unwrap_or_else(|| "OpenClaw task".to_string()),
                detail: first_string(task, &["progressSummary", "error", "status"]),
                kind: "task".to_string(),
                agent_id,
                runtime_id: RUNTIME_ID.to_string(),
                updated_at: latest_timestamp(task),
            })
        })
        .collect()
}

fn build_session_activity(sessions: &[&Value]) -> Vec<DesktopActivity> {
    sessions
        .iter()
        .filter_map(|session| {
            let id = first_string(session, &["sessionId", "key"])?;
            Some(DesktopActivity {
                id: format!("session:{id}"),
                title: first_string(session, &["label", "key"])
                    .unwrap_or_else(|| "OpenClaw session".to_string()),
                detail: first_string(session, &["model", "modelProvider", "status"]),
                kind: "session".to_string(),
                agent_id: first_string(session, &["agentId", "agent_id"]),
                runtime_id: RUNTIME_ID.to_string(),
                updated_at: latest_timestamp(session),
            })
        })
        .collect()
}

fn build_model(value: &Value) -> Option<DesktopModel> {
    let id = first_string(value, &["key", "id"])?;
    let provider = id.split('/').next().unwrap_or("unknown").to_string();
    Some(DesktopModel {
        name: first_string(value, &["name", "label"]).unwrap_or_else(|| id.clone()),
        id,
        provider,
        local: value.get("local").and_then(Value::as_bool),
        available: value.get("available").and_then(Value::as_bool),
        tags: string_array(value.get("tags")),
    })
}

fn build_skill(value: &Value) -> Option<DesktopSkill> {
    let id = first_string(value, &["name", "id"])?;
    Some(DesktopSkill {
        name: id.clone(),
        id,
        description: first_string(value, &["description", "summary"]),
        available: value
            .get("eligible")
            .and_then(Value::as_bool)
            .unwrap_or(false)
            && !value
                .get("disabled")
                .and_then(Value::as_bool)
                .unwrap_or(false),
    })
}

fn build_memory(value: Option<&Value>) -> DesktopMemoryStatus {
    let status = value
        .and_then(|value| match value {
            Value::Array(items) => items
                .first()
                .and_then(|item| item.get("status").or(Some(item))),
            _ => value.get("status").or(Some(value)),
        })
        .unwrap_or(&Value::Null);
    let available = status.get("backend").and_then(Value::as_str).is_some();
    let dirty = status
        .get("dirty")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let reason = first_string(status, &["reason"])
        .or_else(|| {
            status
                .pointer("/custom/indexIdentity/reason")
                .and_then(Value::as_str)
                .map(sanitize_text)
        })
        .or_else(|| dirty.then(|| "The OpenClaw memory index needs reconciliation.".to_string()));
    DesktopMemoryStatus {
        available,
        indexed_files: status.get("files").and_then(Value::as_u64).unwrap_or(0),
        dirty,
        reason,
    }
}

fn build_connectivity(
    value: Option<&Value>,
) -> (
    Option<bool>,
    Option<bool>,
    Option<String>,
    Vec<DesktopConnection>,
) {
    let Some(value) = value else {
        return (None, None, None, Vec::new());
    };
    let gateway = value.get("gateway").unwrap_or(value);
    let reachable = gateway.get("reachable").and_then(Value::as_bool);
    let detail = gateway
        .get("error")
        .and_then(Value::as_str)
        .map(sanitize_text);
    let ready = reachable.map(|reachable| reachable && detail.is_none());
    let status = match ready {
        Some(true) => "connected",
        Some(false) => "configured",
        None => "unknown",
    };
    let mut connections = vec![DesktopConnection {
        id: "openclaw-gateway".to_string(),
        name: "OpenClaw Gateway".to_string(),
        connection_type: "gateway".to_string(),
        status: status.to_string(),
        detail: detail.clone(),
    }];
    if let Some(channels) = value.get("channelSummary").and_then(Value::as_object) {
        for (id, channel) in channels.iter().take(20) {
            let state = channel
                .get("status")
                .or_else(|| channel.get("state"))
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            connections.push(DesktopConnection {
                id: format!("channel:{id}"),
                name: id.to_string(),
                connection_type: "channel".to_string(),
                status: match state {
                    "connected" | "ready" | "running" => "connected",
                    "configured" | "setup" => "configured",
                    "offline" | "stopped" => "offline",
                    _ => "unknown",
                }
                .to_string(),
                detail: Some(sanitize_text(state)),
            });
        }
    }
    (
        reachable,
        ready,
        detail.map(|detail| format!("OpenClaw Gateway: {detail}")),
        connections,
    )
}

fn emit_transition_notifications(
    app: &AppHandle,
    previous: &DesktopProductSnapshot,
    next: &DesktopProductSnapshot,
) {
    let previous_approvals = previous
        .approvals
        .iter()
        .map(|approval| approval.id.as_str())
        .collect::<std::collections::HashSet<_>>();
    if next
        .approvals
        .iter()
        .any(|approval| !previous_approvals.contains(approval.id.as_str()))
    {
        let _ = integrations::notify_event(app, "approval-required");
    }
    let previous_missions = previous
        .missions
        .iter()
        .map(|mission| (mission.id.as_str(), mission.status.as_str()))
        .collect::<HashMap<_, _>>();
    for mission in &next.missions {
        let Some(previous_status) = previous_missions.get(mission.id.as_str()) else {
            continue;
        };
        if *previous_status != "completed" && mission.status == "completed" {
            let _ = integrations::notify_event(app, "mission-completed");
        }
        if *previous_status != "blocked" && mission.status == "blocked" {
            let _ = integrations::notify_event(app, "agent-blocked");
        }
    }
}

fn array_values(value: Option<&Value>) -> Vec<&Value> {
    match value {
        Some(Value::Array(items)) => items.iter().collect(),
        Some(value) => value
            .get("items")
            .or_else(|| value.get("data"))
            .and_then(Value::as_array)
            .map(|items| items.iter().collect())
            .unwrap_or_default(),
        None => Vec::new(),
    }
}

fn array_at<'a>(value: Option<&'a Value>, key: &str) -> Vec<&'a Value> {
    array_values(value.and_then(|value| value.get(key)).or(value))
}

fn string_at(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(sanitize_text)
}

fn first_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| string_at(value, key))
}

fn string_array(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(sanitize_text)
                .take(12)
                .collect()
        })
        .unwrap_or_default()
}

fn latest_timestamp(value: &Value) -> Option<String> {
    [
        "updatedAt",
        "lastEventAt",
        "endedAt",
        "createdAt",
        "timestamp",
    ]
    .iter()
    .find_map(|key| timestamp_value(value.get(*key)))
}

fn timestamp_value(value: Option<&Value>) -> Option<String> {
    let raw = value?;
    if let Some(number) = raw.as_u64() {
        return Some(
            (if number > 100_000_000_000 {
                number / 1_000
            } else {
                number
            })
            .to_string(),
        );
    }
    raw.as_str().and_then(|value| {
        value
            .parse::<u64>()
            .ok()
            .map(|number| {
                (if number > 100_000_000_000 {
                    number / 1_000
                } else {
                    number
                })
                .to_string()
            })
            .or_else(|| Some(sanitize_text(value)))
    })
}

fn task_status(value: &Value) -> &'static str {
    match first_string(value, &["status", "completionStatus"])
        .as_deref()
        .unwrap_or("unknown")
    {
        "queued" | "pending" | "scheduled" => "queued",
        "running" | "active" | "in_progress" => "running",
        "succeeded" | "success" | "completed" | "done" => "completed",
        "failed" | "error" | "timed_out" | "timeout" | "lost" => "failed",
        "blocked" | "needs_attention" => "blocked",
        "cancelled" | "canceled" => "cancelled",
        _ => "unknown",
    }
}

fn agent_status(status: &str) -> &'static str {
    match status {
        "running" => "working",
        "blocked" => "blocked",
        "failed" => "blocked",
        "completed" | "cancelled" => "idle",
        _ => "ready",
    }
}

fn is_automation(value: &Value) -> bool {
    first_string(value, &["runtime", "taskKind", "kind"])
        .map(|value| value == "cron" || value == "automation_run" || value == "cron-run")
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_status_normalizes_openclaw_lifecycle_values() {
        for (input, expected) in [
            ("pending", "queued"),
            ("running", "running"),
            ("succeeded", "completed"),
            ("timed_out", "failed"),
            ("cancelled", "cancelled"),
        ] {
            assert_eq!(task_status(&serde_json::json!({"status": input})), expected);
        }
    }

    #[test]
    fn automation_tasks_are_not_projected_as_missions() {
        let task = serde_json::json!({
            "taskId": "cron-1",
            "runtime": "cron",
            "label": "heartbeat-main"
        });
        assert!(build_mission(&task, &HashMap::new()).is_none());
    }

    #[test]
    fn local_target_is_explicit_and_provider_neutral() {
        let target = local_execution_target("degraded", true, true, false);
        assert_eq!(target.label, "This Computer · OpenClaw");
        assert_eq!(target.runtime_id, RUNTIME_ID);
        assert!(!target.capabilities.browser);
    }

    #[test]
    fn malformed_payload_does_not_create_product_records() {
        assert!(build_model(&serde_json::json!({"name": "missing-id"})).is_none());
        assert!(build_approvals(Some(&serde_json::json!({"unexpected": true}))).is_empty());
    }

    #[test]
    fn gateway_readiness_preserves_degraded_error() {
        let value = serde_json::json!({
            "gateway": {"reachable": true, "error": "missing scope: operator.read"}
        });
        let (reachable, ready, reason, connections) = build_connectivity(Some(&value));
        assert_eq!(reachable, Some(true));
        assert_eq!(ready, Some(false));
        assert!(reason.expect("gateway reason").contains("OpenClaw Gateway"));
        assert_eq!(connections[0].status, "configured");
    }

    #[test]
    fn memory_status_reads_the_native_array_envelope() {
        let value = serde_json::json!([{"agentId": "main", "status": {"backend": "builtin", "files": 4, "dirty": true}}]);
        let memory = build_memory(Some(&value));
        assert!(memory.available);
        assert_eq!(memory.indexed_files, 4);
        assert!(memory.dirty);
    }
}
