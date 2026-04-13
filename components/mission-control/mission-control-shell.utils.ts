import { compactPath, formatAgentDisplayName } from "@/lib/openclaw/presenters";
import { isOpenClawSystemReady } from "@/lib/openclaw/readiness";
import type {
  MissionControlSnapshot,
  OpenClawModelOnboardingPhase,
  TaskFeedEvent,
  TaskRecord
} from "@/lib/agentos/contracts";

type UpdateRunState = "idle" | "running" | "success" | "error";
type SurfaceTheme = "dark" | "light";
type ModelOnboardingIntent = "auto" | "refresh" | "discover" | "set-default" | "login-provider";

export type OptimisticMissionTask = {
  requestId: string;
  dispatchId: string | null;
  task: TaskRecord;
};

type MissionDispatchStart = {
  requestId: string;
  mission: string;
  agentId: string;
  workspaceId: string | null;
  submittedAt: number;
  abortController: AbortController;
};

export function resolveUpdateDialogTitle(runState: UpdateRunState) {
  if (runState === "running") {
    return "Updating OpenClaw";
  }

  if (runState === "success") {
    return "Update complete";
  }

  if (runState === "error") {
    return "Update failed";
  }

  return "Update OpenClaw";
}

export function resolveUpdateDialogDescription(runState: UpdateRunState) {
  if (runState === "running") {
    return "OpenClaw is being updated now. Local gateway activity may pause briefly while the CLI is replaced.";
  }

  if (runState === "success") {
    return "The CLI update finished. Review the result below, then close this panel when you are done.";
  }

  if (runState === "error") {
    return "The update did not complete cleanly. Review the result and captured output before trying again.";
  }

  return "This runs openclaw update against the installed CLI and may briefly interrupt local gateway activity.";
}

export function resolveUpdateResultPanelClassName(runState: UpdateRunState, surfaceTheme: SurfaceTheme) {
  if (runState === "success") {
    return surfaceTheme === "light"
      ? "border-emerald-300 bg-emerald-50/80 text-emerald-950"
      : "border-emerald-300/25 bg-emerald-300/10 text-emerald-50";
  }

  if (runState === "error") {
    return surfaceTheme === "light"
      ? "border-rose-300 bg-rose-50/90 text-rose-950"
      : "border-rose-300/25 bg-rose-300/10 text-rose-50";
  }

  return surfaceTheme === "light"
    ? "border-rose-300 bg-rose-50/90 text-rose-950"
    : "border-rose-300/25 bg-rose-300/10 text-rose-50";
}

export function resolveUpdateResultIconWrapClassName(runState: UpdateRunState, surfaceTheme: SurfaceTheme) {
  if (runState === "success") {
    return surfaceTheme === "light"
      ? "border-emerald-300 bg-white/80 text-emerald-700"
      : "border-emerald-300/25 bg-emerald-300/10 text-emerald-200";
  }

  if (runState === "error") {
    return surfaceTheme === "light"
      ? "border-rose-300 bg-white/80 text-rose-700"
      : "border-rose-300/25 bg-rose-300/10 text-rose-200";
  }

  return surfaceTheme === "light"
    ? "border-rose-300 bg-white/80 text-rose-700"
    : "border-rose-300/25 bg-rose-300/10 text-rose-200";
}

export function resolveTaskPrompt(task: TaskRecord) {
  if (task.mission?.trim()) {
    return task.mission.trim();
  }

  if (task.title.trim()) {
    return task.title.trim();
  }

  return task.subtitle.trim() || "Continue this task.";
}

export function resolveTaskDispatchStatus(task: TaskRecord) {
  return typeof task.metadata.dispatchStatus === "string" ? task.metadata.dispatchStatus : null;
}

export function isTaskAborted(task: TaskRecord) {
  const dispatchStatus = resolveTaskDispatchStatus(task);
  const runtimeStatus = task.status as string;
  return (
    dispatchStatus === "cancelled" ||
    dispatchStatus === "aborted" ||
    runtimeStatus === "cancelled" ||
    runtimeStatus === "aborted"
  );
}

export function isTaskAbortable(task: TaskRecord) {
  if (isTaskAborted(task)) {
    return false;
  }

  const runtimeStatus = task.status as string;
  return runtimeStatus === "running" || runtimeStatus === "queued";
}

export function mergeSnapshotWithOptimisticTasks(
  snapshot: MissionControlSnapshot,
  optimisticMissionTasks: OptimisticMissionTask[]
) {
  if (optimisticMissionTasks.length === 0) {
    return snapshot;
  }

  const visibleOptimisticTasks = optimisticMissionTasks
    .filter((entry) => !findReplacementTaskForOptimisticTask(snapshot.tasks, entry))
    .map((entry) => entry.task);

  if (visibleOptimisticTasks.length === 0) {
    return snapshot;
  }

  return {
    ...snapshot,
    tasks: [...visibleOptimisticTasks, ...snapshot.tasks]
  };
}

export function findReplacementTaskForOptimisticTask(tasks: TaskRecord[], optimisticTask: OptimisticMissionTask) {
  return tasks.find((task) => matchesOptimisticTaskReplacement(task, optimisticTask)) ?? null;
}

export function matchesOptimisticTaskReplacement(task: TaskRecord, optimisticTask: OptimisticMissionTask) {
  const dispatchId = optimisticTask.dispatchId?.trim();

  if (!dispatchId) {
    return false;
  }

  return task.dispatchId === dispatchId || task.key === `dispatch:${dispatchId}`;
}

export function createOptimisticMissionTaskRecord(
  event: MissionDispatchStart,
  snapshot: MissionControlSnapshot
): OptimisticMissionTask {
  const submittedAtIso = new Date(event.submittedAt).toISOString();
  const agent = snapshot.agents.find((entry) => entry.id === event.agentId);
  const feedEvent: TaskFeedEvent = {
    id: `optimistic:${event.requestId}:submitted`,
    kind: "user",
    timestamp: submittedAtIso,
    title: "Mission submitted",
    detail: summarizeTaskTitle(event.mission, 220),
    agentId: event.agentId
  };

  return {
    requestId: event.requestId,
    dispatchId: null,
    task: {
      id: `optimistic-task:${event.requestId}`,
      key: `optimistic:${event.requestId}`,
      title: summarizeTaskTitle(event.mission, 86),
      mission: event.mission,
      subtitle: "Sending mission to AgentOS. Waiting for a dispatch id.",
      status: "queued",
      updatedAt: event.submittedAt,
      ageMs: 0,
      workspaceId: event.workspaceId ?? undefined,
      primaryAgentId: event.agentId,
      primaryAgentName: formatAgentDisplayName(agent ?? { name: "OpenClaw" }),
      runtimeIds: [],
      agentIds: [event.agentId],
      sessionIds: [],
      runIds: [],
      runtimeCount: 0,
      updateCount: 0,
      liveRunCount: 0,
      artifactCount: 0,
      warningCount: 0,
      metadata: {
        optimistic: true,
        optimisticRequestId: event.requestId,
        bootstrapStage: "submitting",
        dispatchSubmittedAt: submittedAtIso,
        optimisticEvents: [feedEvent]
      }
    }
  };
}

export function updateOptimisticMissionTask(
  task: TaskRecord,
  input: {
    dispatchId?: string;
    status: TaskRecord["status"];
    subtitle: string;
    bootstrapStage: string;
    feedEvent: TaskFeedEvent;
  }
): TaskRecord {
  const events = readOptimisticTaskEvents(task).concat(input.feedEvent);

  return {
    ...task,
    dispatchId: input.dispatchId ?? task.dispatchId,
    status: input.status,
    subtitle: input.subtitle,
    updatedAt: Date.now(),
    liveRunCount: input.status === "stalled" || input.status === "cancelled" ? 0 : 1,
    warningCount: input.status === "stalled" || input.status === "cancelled" ? 1 : task.warningCount,
    metadata: {
      ...task.metadata,
      bootstrapStage: input.bootstrapStage,
      optimisticEvents: dedupeOptimisticTaskEvents(events)
    }
  };
}

export function readOptimisticTaskEvents(task: TaskRecord) {
  const value = task.metadata.optimisticEvents;

  if (!Array.isArray(value)) {
    return [] as TaskFeedEvent[];
  }

  return value.filter(isTaskFeedEvent);
}

export function dedupeOptimisticTaskEvents(events: TaskFeedEvent[]) {
  const byId = new Map<string, TaskFeedEvent>();

  for (const event of events) {
    byId.set(event.id, event);
  }

  return [...byId.values()].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
}

export function isTaskHiddenByPreferences(
  task: TaskRecord,
  hiddenRuntimeIds: string[],
  hiddenTaskKeys: string[],
  lockedTaskKeys: string[]
) {
  const safeHiddenRuntimeIds = Array.isArray(hiddenRuntimeIds) ? hiddenRuntimeIds : [];
  const safeHiddenTaskKeys = Array.isArray(hiddenTaskKeys) ? hiddenTaskKeys : [];
  const safeLockedTaskKeys = Array.isArray(lockedTaskKeys) ? lockedTaskKeys : [];

  if (safeLockedTaskKeys.includes(task.key)) {
    return false;
  }

  if (safeHiddenTaskKeys.includes(task.key)) {
    return true;
  }

  if (task.runtimeIds.length === 0) {
    return false;
  }

  return task.runtimeIds.every((runtimeId) => safeHiddenRuntimeIds.includes(runtimeId));
}

export function isDirectChatRuntime(runtime: { metadata: Record<string, unknown> }) {
  return typeof runtime.metadata.kind === "string" && runtime.metadata.kind === "direct";
}

export function isTaskFeedEvent(value: unknown): value is TaskFeedEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as TaskFeedEvent).id === "string" &&
    typeof (value as TaskFeedEvent).kind === "string" &&
    typeof (value as TaskFeedEvent).timestamp === "string" &&
    typeof (value as TaskFeedEvent).title === "string" &&
    typeof (value as TaskFeedEvent).detail === "string"
  );
}

export function summarizeTaskTitle(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(maxLength - 1, 1)).trimEnd()}…`;
}

export function formatGatewayDraft(gatewayUrl: string) {
  return gatewayUrl.replace(/\/$/, "");
}

export function resolveGatewayDraft(snapshot: MissionControlSnapshot) {
  return formatGatewayDraft(snapshot.diagnostics.configuredGatewayUrl || snapshot.diagnostics.gatewayUrl);
}

export function resolveWorkspaceRootDraft(snapshot: MissionControlSnapshot) {
  return compactPath(snapshot.diagnostics.configuredWorkspaceRoot || snapshot.diagnostics.workspaceRoot);
}

export function resolveModelOnboardingStartPhase(intent: ModelOnboardingIntent): OpenClawModelOnboardingPhase {
  if (intent === "refresh") {
    return "refreshing";
  }

  if (intent === "discover") {
    return "discovering";
  }

  return "detecting";
}

export function resolveModelOnboardingActionCopy(intent: ModelOnboardingIntent) {
  if (intent === "discover") {
    return {
      statusMessage: "Scanning models...",
      successTitle: "Models discovered.",
      errorTitle: "Model discovery failed."
    };
  }

  if (intent === "login-provider") {
    return {
      statusMessage: "Checking auth...",
      successTitle: "Provider connected.",
      errorTitle: "Provider auth needs attention."
    };
  }

  if (intent === "refresh") {
    return {
      statusMessage: "Refreshing...",
      successTitle: "Model setup refreshed.",
      errorTitle: "Model refresh failed."
    };
  }

  return {
    statusMessage: "Checking models...",
    successTitle: "Model setup ready.",
    errorTitle: "Model setup failed."
  };
}

export function resolveOnboardingAction(snapshot: MissionControlSnapshot) {
  if (!snapshot.diagnostics.installed) {
    return {
      label: "Install OpenClaw",
      description: "Download the CLI and get AgentOS ready."
    };
  }

  if (isOpenClawSystemReady(snapshot)) {
    return {
      label: "Enter AgentOS",
      description: "OpenClaw is online and runtime state is writable."
    };
  }

  if (snapshot.diagnostics.rpcOk) {
    return {
      label: "Repair runtime access",
      description: "OpenClaw is online, but write access still needs verification."
    };
  }

  if (!snapshot.diagnostics.loaded) {
    return {
      label: "Prepare local gateway",
      description: "Register and start the local gateway."
    };
  }

  if (!snapshot.diagnostics.rpcOk) {
    return {
      label: "Start OpenClaw",
      description: "Start the local gateway and wait for RPC."
    };
  }

  return {
    label: "Start OpenClaw",
    description: "Start the local gateway and wait for RPC."
  };
}
