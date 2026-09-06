import "server-only";

import { getHumanControlInbox } from "@/lib/openclaw/application/human-control-inbox-service";
import { getMissionControlSnapshot } from "@/lib/openclaw/application/mission-control-service";
import { getTaskDetail } from "@/lib/openclaw/application/runtime-service";
import {
  readMissionDispatchRecords,
  type MissionDispatchRecord
} from "@/lib/openclaw/domains/mission-dispatch-lifecycle";
import {
  resolveMissionDispatchCompletionDetail,
  resolveMissionDispatchResultText,
  resolveMissionDispatchRuntimeStatus
} from "@/lib/openclaw/domains/mission-dispatch-model";
import type {
  AttentionItem,
  MissionControlSnapshot,
  RuntimeRecord,
  RuntimeStatus,
  TaskDetailRecord,
  TaskFeedEvent,
  TaskRecord
} from "@/lib/agentos/contracts";
import { redactSecretText } from "@/lib/security/redaction";
import {
  deriveMissionTitle,
  resolveWorkforceMissionState,
  workforceMissionStateLabel
} from "@/lib/agentos/workforce/mission-state";
import type {
  WorkforceArtifact,
  WorkforceMissionListResponse,
  WorkforceMissionProjection,
  WorkforceMissionServiceInput,
  WorkforceTimelineEvent,
  WorkforceWorkItem,
  WorkforceWorkerProjection
} from "@/lib/agentos/workforce/types";

type MissionSeed = {
  id: string;
  source: "agentos-dispatch" | "openclaw-task";
  record: MissionDispatchRecord | null;
  tasks: TaskRecord[];
};

type MissionBuildContext = {
  snapshot: MissionControlSnapshot;
  seed: MissionSeed;
  humanControlItems: AttentionItem[];
  detail: TaskDetailRecord | null;
};

export async function getWorkforceMissionList(
  input: WorkforceMissionServiceInput = {}
): Promise<WorkforceMissionListResponse> {
  const snapshot = input.snapshot ?? await getMissionControlSnapshot();
  const records = await readMissionDispatchRecords();
  // The list needs native approvals/questions and runtime blockers, but does
  // not need a per-worker capability sweep. Human Control performs that
  // bounded sweep on its own page where those blockers are the primary task.
  const inbox = await getHumanControlInbox({ snapshot, capabilities: [] });
  const seeds = buildMissionSeeds(snapshot.tasks, records);
  const missions = seeds
    .map((seed) => buildMissionProjection({ snapshot, seed, humanControlItems: missionAttention(seed, inbox.items), detail: null }))
    .filter((mission) => matchesMissionFilter(mission, input))
    .sort(compareMissions);

  return {
    missions,
    summary: {
      needsYou: missions.filter((mission) => ["waiting-human", "blocked", "failed"].includes(mission.state)).length,
      running: missions.filter((mission) => ["starting", "running", "waiting-worker", "reconnecting"].includes(mission.state)).length,
      queued: missions.filter((mission) => mission.state === "queued").length,
      completed: missions.filter((mission) => mission.state === "completed").length,
      failed: missions.filter((mission) => mission.state === "failed").length
    },
    generatedAt: new Date().toISOString(),
    revision: snapshot.revision ?? null
  };
}

export async function getWorkforceMissionDetail(
  missionId: string,
  input: Omit<WorkforceMissionServiceInput, "detail"> = {}
) {
  const snapshot = input.snapshot ?? await getMissionControlSnapshot();
  const records = await readMissionDispatchRecords();
  const inbox = await getHumanControlInbox({ snapshot });
  const seed = buildMissionSeeds(snapshot.tasks, records).find((candidate) => candidate.id === missionId) ?? null;

  if (!seed) return null;

  const rootTask = findRootTask(seed);
  let detail: TaskDetailRecord | null = null;
  if (rootTask || seed.record) {
    try {
      detail = await getTaskDetail(rootTask?.id ?? seed.record?.id ?? missionId, {
        dispatchId: seed.record?.id ?? rootTask?.dispatchId ?? null
      });
    } catch {
      // The list projection remains useful while a newly accepted dispatch is
      // waiting for OpenClaw to expose its task/session identity.
      detail = null;
    }
  }

  return buildMissionProjection({
    snapshot,
    seed,
    humanControlItems: missionAttention(seed, inbox.items),
    detail
  });
}

export function buildMissionSeeds(tasks: TaskRecord[], records: MissionDispatchRecord[]): MissionSeed[] {
  const byDispatchId = new Map<string, MissionSeed>();
  for (const record of records) {
    byDispatchId.set(record.id, {
      id: record.id,
      source: "agentos-dispatch",
      record,
      tasks: []
    });
  }

  const missionTasks = tasks.filter(isMissionTask);
  for (const task of missionTasks) {
    if (task.dispatchId && byDispatchId.has(task.dispatchId)) {
      byDispatchId.get(task.dispatchId)?.tasks.push(task);
      continue;
    }

    const id = task.dispatchId || `task:${task.id}`;
    const existing = byDispatchId.get(id);
    if (existing) {
      existing.tasks.push(task);
      continue;
    }

    byDispatchId.set(id, {
      id,
      source: "openclaw-task",
      record: null,
      tasks: [task]
    });
  }

  const missionTaskIds = new Set(missionTasks.map((task) => task.id));
  for (const task of tasks) {
    if (missionTaskIds.has(task.id)) continue;
    const owner = [...byDispatchId.values()].find((seed) => {
      const root = findRootTask(seed);
      return Boolean(root && hasNativeParentLink(task, root));
    });
    if (owner) owner.tasks.push(task);
  }

  return [...byDispatchId.values()];
}

export function isMissionTask(task: TaskRecord) {
  if (typeof task.metadata.operationJobId === "string" || task.metadata.source === "cron" || task.metadata.kind === "cron") {
    return false;
  }
  return Boolean(
    task.dispatchId ||
    task.mission ||
    task.metadata.provenance === "dispatch-derived" ||
    (task.metadata.dispatchId && typeof task.metadata.dispatchId === "string")
  );
}

export function buildMissionProjection(context: MissionBuildContext): WorkforceMissionProjection {
  const { snapshot, seed, humanControlItems, detail } = context;
  const rootTask = findRootTask(seed);
  const runtimeStatuses = relatedRuntimes(snapshot.runtimes, seed);
  const dispatchRuntimeStatus = seed.record ? resolveMissionDispatchRuntimeStatus(seed.record, Date.now()) : null;
  const childTasks = seed.tasks.filter((task) => task.id !== rootTask?.id && hasNativeParentLink(task, rootTask));
  const connection = resolveConnection(snapshot);
  const derivedRootStatus = rootTask?.status ?? (
    seed.record && (seed.record.observation.runtimeId || seed.record.runner.lastHeartbeatAt)
      ? dispatchRuntimeStatus === "stalled" && seed.record.status !== "stalled" ? "running" : dispatchRuntimeStatus
      : null
  );
  const state = resolveWorkforceMissionState({
    dispatchStatus: seed.record?.status === "stalled" ? "stalled" : seed.record?.status ?? null,
    runnerStarted: Boolean(seed.record?.runner.startedAt || seed.record?.runner.pid),
    rootStatus: derivedRootStatus,
    childStatuses: childTasks.map((task) => task.status),
    activeRuntimeStatuses: runtimeStatuses.map((runtime) => runtime.status),
    pendingHumanControl: humanControlItems
      .map((item) => item.type)
      .filter((type): type is "approval" | "question" | "blocked" | "runtime-issue" | "needs-setup" => type !== "suggested-work"),
    connection,
    authoritativeFailure: Boolean(seed.record?.status === "stalled" || rootTask?.status === "stalled"),
    authoritativeCompletion: Boolean(seed.record?.status === "completed" || rootTask?.status === "completed")
  });
  const goal = seed.record?.mission || rootTask?.mission || rootTask?.title || "Give your workforce a goal to get started.";
  const title = deriveMissionTitle(goal);
  const primaryAgentId = seed.record?.agentId ?? rootTask?.primaryAgentId ?? null;
  const primaryAgentName = resolveAgentName(snapshot, primaryAgentId, rootTask?.primaryAgentName);
  const workspaceId = seed.record?.workspaceId ?? rootTask?.workspaceId ?? null;
  const workspaceName = workspaceId ? snapshot.workspaces.find((workspace) => workspace.id === workspaceId)?.name ?? null : null;
  const submittedAt = seed.record?.submittedAt ?? null;
  const createdAt = submittedAt || readTaskTimestamp(rootTask, "createdAt") || toIso(rootTask?.updatedAt);
  const startedAt = seed.record?.runner.startedAt || (rootTask && rootTask.status !== "queued" ? createdAt : null);
  const completedAt = seed.record?.runner.finishedAt || (state === "completed" ? toIso(rootTask?.updatedAt) : null);
  const updatedAt = latestTimestamp(seed.record?.updatedAt, rootTask?.updatedAt, ...seed.tasks.map((task) => task.updatedAt));
  const result = detail?.outputs.find((output) => output.finalText?.trim())?.finalText?.trim() || (seed.record ? resolveMissionDispatchResultText(seed.record) : null);
  const error = seed.record?.error ? redactSecretText(seed.record.error) : rootTask?.status === "stalled" ? redactSecretText(rootTask.subtitle) : null;
  const workTree = buildWorkTree(seed, snapshot, state, primaryAgentName);
  const timeline = buildTimeline({ context, state, title, primaryAgentName, workTree, createdAt, startedAt, completedAt, result });
  const artifacts = buildArtifacts(detail, seed);
  const runtime = buildRuntimeReference(seed, detail, runtimeStatuses);

  return {
    id: seed.id,
    title,
    goal,
    state,
    stateLabel: workforceMissionStateLabel(state),
    workspaceId,
    workspaceName,
    createdAt,
    submittedAt,
    startedAt,
    completedAt,
    updatedAt,
    durationMs: startedAt ? Math.max(0, Date.parse(completedAt ?? new Date().toISOString()) - Date.parse(startedAt)) : null,
    source: seed.source,
    primaryAgentId,
    primaryAgentName,
    dispatchId: seed.record?.id ?? rootTask?.dispatchId ?? null,
    rootTaskId: rootTask?.id ?? null,
    summary: detail?.outputs.find((output) => output.finalText?.trim())?.finalText?.trim() || (seed.record ? resolveMissionDispatchCompletionDetail(seed.record) : rootTask?.subtitle || null),
    result: result ? redactSecretText(result) : null,
    error,
    connection,
    activeWorkers: buildActiveWorkers(workTree, seed, state, startedAt),
    workTree,
    humanControlItems,
    timeline,
    artifacts,
    runtime,
    availableActions: {
      canCancel: ["queued", "starting", "running", "waiting-human", "waiting-worker", "blocked", "reconnecting"].includes(state) && Boolean(rootTask || seed.record),
      canResume: Boolean(rootTask?.metadata.continuationAvailable === true) && ["failed", "blocked"].includes(state),
      canOpenRuntime: runtime.taskIds.length > 0 || runtime.runtimeIds.length > 0 || runtime.sessionIds.length > 0
    },
  };
}

function buildMissionAttention(seed: MissionSeed, items: AttentionItem[]) {
  return items.filter((item) => {
    if (item.status !== "pending") return false;
    if (item.mission?.id === seed.id) return true;
    const taskId = item.source.taskId;
    return Boolean(taskId && seed.tasks.some((task) => task.id === taskId));
  });
}

function missionAttention(seed: MissionSeed, items: AttentionItem[]) {
  return buildMissionAttention(seed, items);
}

function buildWorkTree(seed: MissionSeed, snapshot: MissionControlSnapshot, state: WorkforceMissionProjection["state"], primaryAgentName: string): WorkforceWorkItem[] {
  const rootTask = findRootTask(seed);
  const sortedTasks = [...seed.tasks].sort((left, right) => (left.updatedAt ?? 0) - (right.updatedAt ?? 0) || left.id.localeCompare(right.id));
  const workItems: WorkforceWorkItem[] = [];
  if (rootTask) {
    workItems.push(taskToWorkItem(rootTask, snapshot, "primary", null, state, primaryAgentName));
  } else if (seed.record) {
    workItems.push({
      id: `dispatch:${seed.record.id}`,
      title: deriveMissionTitle(seed.record.mission),
      state,
      agentId: seed.record.agentId,
      agentName: resolveAgentName(snapshot, seed.record.agentId, primaryAgentName),
      relationship: "primary",
      parentId: null,
      taskId: null,
      runtimeId: seed.record.observation.runtimeId,
      source: "agentos-dispatch",
      updatedAt: seed.record.updatedAt
    });
  }
  for (const task of sortedTasks) {
    if (task.id === rootTask?.id) continue;
    const parentId = resolveParentId(task, rootTask, seed.tasks);
    if (!parentId) continue;
    workItems.push(taskToWorkItem(task, snapshot, "delegated", parentId, null, null));
  }
  return workItems;
}

function taskToWorkItem(task: TaskRecord, snapshot: MissionControlSnapshot, relationship: "primary" | "delegated", parentId: string | null, fallbackState: WorkforceMissionProjection["state"] | null, fallbackAgentName: string | null): WorkforceWorkItem {
  const state = fallbackState && task.status === "idle" ? fallbackState : resolveTaskState(task.status);
  return {
    id: task.id,
    title: task.title || task.mission || "OpenClaw work item",
    state,
    agentId: task.primaryAgentId ?? null,
    agentName: resolveAgentName(snapshot, task.primaryAgentId ?? null, task.primaryAgentName || fallbackAgentName),
    relationship,
    parentId,
    taskId: task.id,
    runtimeId: task.primaryRuntimeId ?? task.runtimeIds[0] ?? null,
    source: "openclaw-task",
    updatedAt: toIso(task.updatedAt)
  };
}

function buildActiveWorkers(workTree: WorkforceWorkItem[], seed: MissionSeed, missionState: WorkforceMissionProjection["state"], startedAt: string | null): WorkforceWorkerProjection[] {
  const active = workTree.filter((item) => ["queued", "starting", "running", "waiting-worker", "reconnecting"].includes(item.state));
  if (active.length > 0) {
    return active.map((item) => ({
      id: item.agentId,
      name: item.agentName,
      state: item.state,
      activity: item.title,
      relationship: item.relationship,
      parentTaskId: item.parentId,
      taskId: item.taskId,
      runtimeId: item.runtimeId,
      startedAt,
      elapsedMs: startedAt ? Math.max(0, Date.now() - Date.parse(startedAt)) : null
    }));
  }
  if (seed.record && ["queued", "starting", "running", "waiting-worker", "reconnecting"].includes(missionState)) {
    return [{
      id: seed.record.agentId,
      name: seed.record.agentId,
      state: missionState,
      activity: deriveMissionTitle(seed.record.mission),
      relationship: "primary",
      parentTaskId: null,
      taskId: null,
      runtimeId: seed.record.observation.runtimeId,
      startedAt,
      elapsedMs: startedAt ? Math.max(0, Date.now() - Date.parse(startedAt)) : null
    }];
  }
  return [];
}

function buildTimeline(input: {
  context: MissionBuildContext;
  state: WorkforceMissionProjection["state"];
  title: string;
  primaryAgentName: string;
  workTree: WorkforceWorkItem[];
  createdAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  result: string | null;
}) {
  const { context, state, title, primaryAgentName, workTree, createdAt, startedAt, completedAt, result } = input;
  const events: WorkforceTimelineEvent[] = [];
  if (createdAt) events.push({ id: "mission-created", at: createdAt, kind: "created", title: "Mission created", detail: title, workerLabel: null, source: "agentos" });
  if (createdAt && primaryAgentName) events.push({ id: "mission-assigned", at: createdAt, kind: "assigned", title: "Assigned to worker", detail: null, workerLabel: primaryAgentName, source: "agentos" });
  if (startedAt) events.push({ id: "mission-started", at: startedAt, kind: "started", title: "Mission started", detail: null, workerLabel: primaryAgentName, source: "openclaw" });
  for (const item of workTree.filter((candidate) => candidate.relationship === "delegated")) {
    if (!item.updatedAt) continue;
    events.push({ id: `delegated:${item.id}`, at: item.updatedAt, kind: "delegated", title: "Delegated work started", detail: item.title, workerLabel: item.agentName, source: "openclaw" });
  }
  for (const item of context.humanControlItems) {
    if (!item.createdAt) continue;
    events.push({ id: `attention:${item.id}`, at: item.createdAt, kind: item.type === "approval" || item.type === "question" ? "approval" : "blocked", title: item.title, detail: item.summary, workerLabel: item.worker.label, source: "openclaw" });
  }
  if (completedAt && state === "completed") events.push({ id: "mission-completed", at: completedAt, kind: "completed", title: "Mission completed", detail: result ? redactSecretText(result).slice(0, 220) : null, workerLabel: primaryAgentName, source: "openclaw" });
  if (state === "failed" && completedAt) events.push({ id: "mission-failed", at: completedAt, kind: "failed", title: "Mission needs recovery", detail: result ? redactSecretText(result).slice(0, 220) : null, workerLabel: primaryAgentName, source: "openclaw" });
  if (context.detail) {
    for (const event of context.detail.liveFeed.filter(isUserFacingFeedEvent)) {
      events.push(feedEventToTimeline(event));
    }
  }
  return events.sort((left, right) => Date.parse(left.at) - Date.parse(right.at) || left.id.localeCompare(right.id));
}

function buildArtifacts(detail: TaskDetailRecord | null, seed: MissionSeed): WorkforceArtifact[] {
  const sourceFiles = [
    ...(detail?.createdFiles ?? []),
    ...(detail?.outputs.flatMap((output) => output.createdFiles) ?? [])
  ];
  const seen = new Set<string>();
  return sourceFiles.filter((file) => {
    const key = file.path || file.displayPath;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((file, index) => ({
    ...file,
    id: `artifact:${index}:${file.path}`,
    category: artifactCategory(file.displayPath || file.path),
    source: "openclaw-runtime" as const,
    taskId: detail?.task.id ?? seed.tasks[0]?.id ?? null,
    runtimeId: detail?.outputs[0]?.runtimeId ?? seed.record?.observation.runtimeId ?? null
  }));
}

function buildRuntimeReference(seed: MissionSeed, detail: TaskDetailRecord | null, runtimes: RuntimeRecord[]) {
  const taskIds = new Set(seed.tasks.map((task) => task.id));
  const runtimeIds = new Set<string>();
  const sessionIds = new Set<string>();
  const runIds = new Set<string>();
  for (const task of seed.tasks) {
    task.runtimeIds.forEach((id) => runtimeIds.add(id));
    task.sessionIds.forEach((id) => sessionIds.add(id));
    task.runIds.forEach((id) => runIds.add(id));
  }
  for (const runtime of runtimes) {
    runtimeIds.add(runtime.id);
    if (runtime.sessionId) sessionIds.add(runtime.sessionId);
    if (runtime.runId) runIds.add(runtime.runId);
  }
  for (const output of detail?.outputs ?? []) {
    runtimeIds.add(output.runtimeId);
    if (output.sessionId) sessionIds.add(output.sessionId);
    if (output.taskId) taskIds.add(output.taskId);
  }
  if (seed.record?.observation.runtimeId) runtimeIds.add(seed.record.observation.runtimeId);
  if (seed.record?.sessionId) sessionIds.add(seed.record.sessionId);
  return {
    dispatchId: seed.record?.id ?? null,
    taskIds: [...taskIds],
    runtimeIds: [...runtimeIds],
    sessionIds: [...sessionIds],
    runIds: [...runIds]
  };
}

function relatedRuntimes(runtimes: RuntimeRecord[], seed: MissionSeed) {
  const taskIds = new Set(seed.tasks.map((task) => task.id));
  const runtimeIds = new Set(seed.tasks.flatMap((task) => task.runtimeIds));
  if (seed.record?.observation.runtimeId) runtimeIds.add(seed.record.observation.runtimeId);
  return runtimes.filter((runtime) => Boolean(
    runtime.taskId && taskIds.has(runtime.taskId) ||
    runtimeIds.has(runtime.id) ||
    (seed.record?.agentId && runtime.agentId === seed.record.agentId && seed.record.mission && runtime.title.includes(seed.record.mission.slice(0, 24)))
  ));
}

function findRootTask(seed: MissionSeed) {
  return seed.tasks.find((task) => task.dispatchId === seed.record?.id) ?? seed.tasks.find((task) => !resolveParentId(task, null, seed.tasks)) ?? seed.tasks[0] ?? null;
}

function hasNativeParentLink(task: TaskRecord, rootTask: TaskRecord | null) {
  return Boolean(rootTask && resolveParentId(task, rootTask, [task, rootTask]));
}

function resolveParentId(task: TaskRecord, rootTask: TaskRecord | null, tasks: TaskRecord[]) {
  const explicit = readString(task.metadata.parentTaskId) || readString(task.metadata.parentId);
  if (explicit) return tasks.find((candidate) => candidate.id === explicit || readString(candidate.metadata.openClawTaskId) === explicit)?.id ?? null;
  const parentKey = readString(task.metadata.ownerKey) || readString(task.metadata.requesterSessionKey);
  if (!parentKey) return null;
  const parent = tasks.find((candidate) => candidate.key === parentKey || readString(candidate.metadata.openClawSessionKey) === parentKey);
  if (parent && parent.id !== task.id) return parent.id;
  if (rootTask && (rootTask.key === parentKey || readString(rootTask.metadata.openClawSessionKey) === parentKey) && rootTask.id !== task.id) return rootTask.id;
  return null;
}

function resolveTaskState(status: RuntimeStatus): WorkforceMissionProjection["state"] {
  if (status === "running") return "running";
  if (status === "queued") return "queued";
  if (status === "completed") return "completed";
  if (status === "cancelled") return "cancelled";
  if (status === "stalled") return "failed";
  return "queued";
}

function resolveConnection(snapshot: MissionControlSnapshot): "live" | "reconnecting" | "unknown" {
  if (snapshot.mode === "fallback" || snapshot.diagnostics.rpcOk === false) return "reconnecting";
  if (snapshot.diagnostics.health === "healthy") return "live";
  return "unknown";
}

function resolveAgentName(snapshot: MissionControlSnapshot, agentId: string | null | undefined, fallback?: string | null) {
  return fallback?.trim() || (agentId ? snapshot.agents.find((agent) => agent.id === agentId)?.name : null) || agentId || "Unassigned";
}

function readTaskTimestamp(task: TaskRecord | null, key: string) {
  return task ? toIso(task.metadata[key]) : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toIso(value: unknown) {
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  return null;
}

function latestTimestamp(...values: Array<string | number | null | undefined>) {
  const dates = values.map((value) => typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN).filter(Number.isFinite);
  return dates.length ? new Date(Math.max(...dates)).toISOString() : null;
}

function artifactCategory(pathValue: string): WorkforceArtifact["category"] {
  const lower = pathValue.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".doc") || lower.endsWith(".docx")) return "document";
  if (lower.endsWith(".pdf") || lower.endsWith(".csv") || lower.endsWith(".xlsx")) return "report";
  if (lower.endsWith(".ts") || lower.endsWith(".tsx") || lower.endsWith(".js") || lower.endsWith(".py")) return "code-output";
  if (lower.startsWith("http://") || lower.startsWith("https://")) return "link";
  return "file";
}

function isUserFacingFeedEvent(event: TaskFeedEvent) {
  return ["status", "assistant", "artifact", "warning"].includes(event.kind) && !event.title.toLowerCase().includes("tool");
}

function feedEventToTimeline(event: TaskFeedEvent): WorkforceTimelineEvent {
  return {
    id: `feed:${event.id}`,
    at: event.timestamp,
    kind: event.kind === "artifact" ? "artifact" : event.isError || event.kind === "warning" ? "failed" : event.kind === "status" ? "note" : "note",
    title: event.title,
    detail: event.detail || null,
    workerLabel: null,
    source: "openclaw"
  };
}

function matchesMissionFilter(mission: WorkforceMissionProjection, input: WorkforceMissionServiceInput) {
  if (input.workspaceId && mission.workspaceId !== input.workspaceId) return false;
  if (input.state && mission.state !== input.state) return false;
  if (input.agentId && mission.primaryAgentId !== input.agentId) return false;
  const search = input.search?.trim().toLowerCase();
  return !search || [mission.title, mission.goal, mission.primaryAgentName, mission.workspaceName ?? ""].some((value) => value.toLowerCase().includes(search));
}

function compareMissions(left: WorkforceMissionProjection, right: WorkforceMissionProjection) {
  const rank = (state: WorkforceMissionProjection["state"]) => {
    if (["waiting-human", "blocked", "failed"].includes(state)) return 0;
    if (["running", "starting", "waiting-worker", "reconnecting"].includes(state)) return 1;
    if (state === "queued") return 2;
    return 3;
  };
  return rank(left.state) - rank(right.state) || (Date.parse(right.updatedAt ?? right.createdAt ?? "") || 0) - (Date.parse(left.updatedAt ?? left.createdAt ?? "") || 0) || left.id.localeCompare(right.id);
}
