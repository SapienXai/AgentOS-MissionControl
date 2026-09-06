import { createHash } from "node:crypto";

import { compactMissionText, stripMissionRouting } from "@/lib/openclaw/presenters";
import type { OpenClawAgent, RuntimeCreatedFile, RuntimeRecord, TaskRecord } from "@/lib/openclaw/types";
import { deriveTaskFollowUpsFromRuntimes } from "@/lib/openclaw/domains/task-follow-up-records";
import { executionIdentityFromRuntime } from "@/lib/openclaw/domains/execution-identity";
import { resolveCanonicalTaskStatus } from "@/lib/openclaw/domains/task-status";

export function buildTaskRecords(runtimes: RuntimeRecord[], agents: OpenClawAgent[]): TaskRecord[] {
  const taskRuntimes = runtimes.filter((runtime) => !isDirectChatRuntime(runtime));
  const groups = new Map<string, RuntimeRecord[]>();
  const agentNameById = new Map(agents.map((agent) => [agent.id, compactAgentName(agent)]));
  const agentWorkspaceIdById = new Map(agents.map((agent) => [agent.id, agent.workspaceId]));
  const dispatchIdBySessionKey = buildDispatchIdBySessionKey(taskRuntimes);
  const nativeTaskIdByRuntimeLink = buildNativeTaskIdByRuntimeLink(taskRuntimes);

  for (const runtime of taskRuntimes) {
    const groupKey = resolveTaskGroupKey(runtime, dispatchIdBySessionKey, nativeTaskIdByRuntimeLink);
    const group = groups.get(groupKey) ?? [];
    group.push(runtime);
    groups.set(groupKey, group);
  }

  const tasks = Array.from(groups.entries())
    .map(([groupKey, groupedRuntimes]) =>
      buildTaskRecord(groupKey, groupedRuntimes, agentNameById, agentWorkspaceIdById)
    );

  return tasks
    .map((task) => attachDerivedFollowUps(task, runtimes))
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
}

export function buildTaskRecord(
  groupKey: string,
  runtimes: RuntimeRecord[],
  agentNameById: Map<string, string>,
  agentWorkspaceIdById: Map<string, string> = new Map()
): TaskRecord {
  const sortedRuntimes = [...runtimes].sort(sortRuntimesByUpdatedAtDesc);
  const signalRuntimes = selectTaskSignalRuntimes(sortedRuntimes);
  const nativeTaskRuntime = sortedRuntimes.find(isNativeTaskRuntime);
  const primaryRuntime =
    nativeTaskRuntime ??
    [...signalRuntimes].sort((left, right) => scoreTaskRuntime(right) - scoreTaskRuntime(left))[0] ??
    signalRuntimes[0] ??
    sortedRuntimes[0];
  const mission =
    resolveRuntimeMissionText(primaryRuntime) ||
    sortedRuntimes.map((runtime) => resolveRuntimeMissionText(runtime)).find(Boolean) ||
    null;
  const routedMission = resolveTaskRoutedMission(sortedRuntimes);
  const resultPreview = resolveTaskResultPreview(sortedRuntimes);
  const subtitle =
    resultPreview ||
    signalRuntimes
      .map((runtime) => runtime.subtitle?.trim())
      .find((value): value is string => Boolean(value)) ||
    sortedRuntimes
      .map((runtime) => runtime.subtitle?.trim())
      .find((value): value is string => Boolean(value)) ||
    "Awaiting OpenClaw updates.";
  const createdFiles = dedupeCreatedFiles(
    sortedRuntimes
      .flatMap((runtime) => extractCreatedFilesFromRuntimeMetadata(runtime))
      .concat(sortedRuntimes.flatMap((runtime) => inferCreatedFilesFromText(runtime.subtitle)))
  );
  const warnings = uniqueStrings(sortedRuntimes.flatMap((runtime) => extractWarningsFromRuntimeMetadata(runtime)));
  const tokenUsage = aggregateRuntimeTokenUsage(sortedRuntimes);
  const agentIds = uniqueStrings(sortedRuntimes.flatMap((runtime) => (runtime.agentId ? [runtime.agentId] : [])));
  const sessionIds = uniqueStrings(
    sortedRuntimes.flatMap((runtime) =>
      runtime.sessionId && isUsableTaskSessionReference(runtime.sessionId) ? [runtime.sessionId] : []
    )
  );
  const runIds = uniqueStrings(sortedRuntimes.flatMap((runtime) => (runtime.runId ? [runtime.runId] : [])));
  const modelIds = uniqueStrings(sortedRuntimes.flatMap((runtime) => (runtime.modelId ? [runtime.modelId] : [])));
  const turnCount = countTaskTurns(sortedRuntimes);
  const dispatchStatus = resolveTaskDispatchStatus(sortedRuntimes);
  const primaryAgentId = primaryRuntime?.agentId || agentIds[0];
  const primaryAgentName = primaryAgentId ? agentNameById.get(primaryAgentId) ?? null : null;
  const workspaceId = resolveTaskWorkspaceId(sortedRuntimes, primaryAgentId, agentIds, agentWorkspaceIdById);
  const latestRuntime = sortedRuntimes[0] ?? null;
  const dispatchId = resolveDispatchId(sortedRuntimes);
  const provenance = resolveTaskProvenance(sortedRuntimes, dispatchId);
  const openClawTaskId = resolveOpenClawTaskId(sortedRuntimes);
  const sessionKey = resolveTaskSessionKey(sortedRuntimes);
  const sessionId = resolveTaskSessionId(sortedRuntimes, sessionIds, sessionKey);
  const continuationConfidence = resolveTaskContinuationConfidence(provenance, sessionKey, sessionId);
  const executionIdentity = resolveTaskExecutionIdentity(sortedRuntimes, {
    dispatchId: dispatchId ?? null,
    sessionKey,
    sessionId,
    agentId: primaryAgentId ?? null,
    workspaceId: workspaceId ?? null
  });

  return {
    id: createTaskRecordId(groupKey),
    key: groupKey,
    title: compactMissionText(mission || primaryRuntime?.title || "Untitled task", 52) || "Untitled task",
    mission,
    subtitle,
    status: resolveTaskStatus(sortedRuntimes, dispatchStatus),
    updatedAt: latestRuntime?.updatedAt ?? null,
    ageMs: latestRuntime?.ageMs ?? null,
    workspaceId,
    primaryAgentId,
    primaryAgentName,
    primaryRuntimeId: primaryRuntime?.id,
    dispatchId,
    runtimeIds: sortedRuntimes.map((runtime) => runtime.id),
    agentIds,
    sessionIds,
    runIds,
    runtimeCount: sortedRuntimes.length,
    updateCount: signalRuntimes.filter((runtime) => runtime.source === "turn").length,
    liveRunCount: countLiveTaskRuntimes(sortedRuntimes, dispatchStatus),
    artifactCount: createdFiles.length,
    warningCount: warnings.length,
    tokenUsage,
    metadata: {
      mission,
      routedMission,
      resultPreview,
      turnCount,
      sessionCount: sessionIds.length,
      provenance,
      source: provenance,
      dispatchId: dispatchId ?? null,
      clientRequestId:
        sortedRuntimes
          .map((runtime) => runtime.metadata.clientRequestId)
          .find((value): value is string => typeof value === "string" && value.trim().length > 0) ?? null,
      openClawTaskId,
      openClawSessionId: sessionId,
      openClawSessionKey: sessionKey,
      openClawRunId: runIds[0] ?? null,
      parentTaskId: firstMetadataString(sortedRuntimes, "parentTaskId"),
      parentId: firstMetadataString(sortedRuntimes, "parentId"),
      ownerKey: firstMetadataString(sortedRuntimes, "ownerKey"),
      requesterSessionKey: firstMetadataString(sortedRuntimes, "requesterSessionKey"),
      childSessionKey: firstMetadataString(sortedRuntimes, "childSessionKey"),
      flowId: firstMetadataString(sortedRuntimes, "flowId"),
      sourceId: firstMetadataString(sortedRuntimes, "sourceId"),
      executionIdentity,
      identityProvenance: executionIdentity.provenance,
      sourceOfTruth: nativeTaskRuntime ? "openclaw-tasks.list" : "agentos-dispatch-or-runtime",
      modelId: primaryRuntime?.modelId ?? modelIds[0] ?? null,
      modelIds,
      requestedModelId:
        sortedRuntimes
          .map((runtime) => runtime.metadata.requestedModelId)
          .find((value): value is string => typeof value === "string" && value.trim().length > 0) ?? null,
      continuationAvailable: Boolean(primaryAgentId && (sessionKey || sessionId)),
      continuationConfidence,
      continuationSessionId: sessionId,
      continuationSessionKey: sessionKey,
      continuationSource: provenance,
      primaryAgentId: primaryAgentId ?? null,
      workspaceId: workspaceId ?? null,
      primaryRuntimeSource: primaryRuntime?.source ?? null,
      bootstrapStage:
        typeof primaryRuntime?.metadata.bootstrapStage === "string"
          ? primaryRuntime.metadata.bootstrapStage
          : null,
      dispatchStatus:
        dispatchStatus ??
        (typeof primaryRuntime?.metadata.dispatchStatus === "string"
          ? primaryRuntime.metadata.dispatchStatus
          : null),
      dispatchSubmittedAt:
        typeof primaryRuntime?.metadata.dispatchSubmittedAt === "string"
          ? primaryRuntime.metadata.dispatchSubmittedAt
          : null,
      dispatchRunnerStartedAt:
        typeof primaryRuntime?.metadata.dispatchRunnerStartedAt === "string"
          ? primaryRuntime.metadata.dispatchRunnerStartedAt
          : null,
      dispatchHeartbeatAt:
        typeof primaryRuntime?.metadata.dispatchHeartbeatAt === "string"
          ? primaryRuntime.metadata.dispatchHeartbeatAt
          : null,
      dispatchObservedAt:
        typeof primaryRuntime?.metadata.dispatchObservedAt === "string"
          ? primaryRuntime.metadata.dispatchObservedAt
          : null,
      dispatchError:
        typeof primaryRuntime?.metadata.dispatchError === "string"
          ? primaryRuntime.metadata.dispatchError
          : typeof primaryRuntime?.metadata.error === "string"
            ? primaryRuntime.metadata.error
            : null,
      outputDir:
        typeof primaryRuntime?.metadata.outputDir === "string" ? primaryRuntime.metadata.outputDir : null,
      outputDirRelative:
        typeof primaryRuntime?.metadata.outputDirRelative === "string"
          ? primaryRuntime.metadata.outputDirRelative
          : null
    }
  };
}

function firstMetadataString(runtimes: RuntimeRecord[], key: string) {
  return runtimes
    .map((runtime) => runtime.metadata[key])
    .find((value): value is string => typeof value === "string" && value.trim().length > 0) ?? null;
}

function attachDerivedFollowUps(task: TaskRecord, runtimes: RuntimeRecord[]): TaskRecord {
  const followUps = deriveTaskFollowUpsFromRuntimes(task, runtimes);
  if (followUps.length === 0) {
    return task;
  }

  return {
    ...task,
    metadata: {
      ...task.metadata,
      followUps
    }
  };
}

function resolveTaskWorkspaceId(
  runtimes: RuntimeRecord[],
  primaryAgentId: string | undefined,
  agentIds: string[],
  agentWorkspaceIdById: Map<string, string>
) {
  const runtimeWorkspaceId = runtimes
    .map((runtime) => runtime.workspaceId?.trim())
    .find((value): value is string => Boolean(value));

  if (runtimeWorkspaceId) {
    return runtimeWorkspaceId;
  }

  const taskAgentIds = uniqueStrings([primaryAgentId, ...agentIds].filter(Boolean) as string[]);

  for (const agentId of taskAgentIds) {
    const workspaceId = agentWorkspaceIdById.get(agentId)?.trim();

    if (workspaceId) {
      return workspaceId;
    }
  }

  return undefined;
}

function compactAgentName(agent: OpenClawAgent) {
  return agent.name.trim() || agent.id;
}

function selectTaskSignalRuntimes(runtimes: RuntimeRecord[]) {
  const turnRuntimes = runtimes.filter(
    (runtime) => runtime.source === "turn" || typeof runtime.metadata.turnId === "string"
  );

  if (turnRuntimes.length > 0) {
    return turnRuntimes;
  }

  const dispatchRuntimes = runtimes.filter(
    (runtime) =>
      typeof runtime.metadata.dispatchId === "string" ||
      typeof runtime.metadata.bootstrapStage === "string"
  );

  if (dispatchRuntimes.length > 0) {
    return dispatchRuntimes;
  }

  return runtimes;
}

function isDirectChatRuntime(runtime: RuntimeRecord) {
  const origin = typeof runtime.metadata.origin === "string" ? runtime.metadata.origin : null;

  if (origin === "mission-dispatch" || origin === "agentos-mission-dispatch") {
    return false;
  }

  if (origin === "agent-chat" || origin === "agentos-direct-chat") {
    return true;
  }

  if (typeof runtime.metadata.dispatchId === "string" && runtime.metadata.dispatchId.trim()) {
    return false;
  }

  const prompt =
    resolveRuntimeMissionText(runtime) ||
    (typeof runtime.metadata.turnPrompt === "string" ? runtime.metadata.turnPrompt : null);

  if (typeof prompt === "string" && isDirectChatPrompt(prompt)) {
    return true;
  }

  if (hasTaskIdentity(runtime)) {
    return false;
  }

  if (origin === "openclaw-gateway-event") {
    return true;
  }

  if (typeof runtime.metadata.chatType === "string" && runtime.metadata.chatType === "direct") {
    return true;
  }

  if (typeof runtime.metadata.kind === "string" && runtime.metadata.kind === "direct") {
    return true;
  }

  if (isUnscopedSessionRuntime(runtime)) {
    return true;
  }

  return false;
}

function hasTaskIdentity(runtime: RuntimeRecord) {
  const origin = typeof runtime.metadata.origin === "string" ? runtime.metadata.origin : null;
  const runIdIdentifiesTask =
    origin !== "openclaw-gateway-event" &&
    origin !== "agentos-direct-chat" &&
    Boolean(runtime.runId?.trim());
  const metadataRunIdIdentifiesTask =
    origin !== "openclaw-gateway-event" &&
    origin !== "agentos-direct-chat" &&
    typeof runtime.metadata.runId === "string" &&
    Boolean(runtime.metadata.runId.trim());

  return Boolean(
    runtime.taskId?.trim() ||
      runIdIdentifiesTask ||
      resolveRuntimeMetadataMissionText(runtime) ||
      (typeof runtime.metadata.taskId === "string" && runtime.metadata.taskId.trim()) ||
      metadataRunIdIdentifiesTask ||
      (typeof runtime.metadata.bootstrapStage === "string" && runtime.metadata.bootstrapStage.trim()) ||
      (typeof runtime.metadata.dispatchStatus === "string" && runtime.metadata.dispatchStatus.trim())
  );
}

function resolveRuntimeMetadataMissionText(runtime: RuntimeRecord) {
  if (typeof runtime.metadata.mission !== "string") {
    return null;
  }

  const normalized = stripMissionRouting(runtime.metadata.mission);
  return normalized.length > 0 ? normalized : null;
}

function isUnscopedSessionRuntime(runtime: RuntimeRecord) {
  if (runtime.source !== "session") {
    return false;
  }

  const key = runtime.key.trim();
  const title = runtime.title.trim().toLowerCase();
  const subtitle = runtime.subtitle.trim().toLowerCase();

  return (
    /:main$/.test(key) ||
    /:explicit:[^:]+$/.test(key) ||
    title === "agent session" ||
    subtitle === "main session" ||
    subtitle === "direct session"
  );
}

function isDirectChatPrompt(text: string) {
  return (
    /You are chatting (?:directly )?with the operator inside AgentOS/i.test(text) ||
    /Do not create tasks or mention task cards/i.test(text) ||
    /Messages stay in this drawer and are stored locally in your browser/i.test(text)
  );
}

function buildDispatchIdBySessionKey(runtimes: RuntimeRecord[]) {
  const dispatchIdBySessionKey = new Map<
    string,
    Array<{
      dispatchId: string;
      submittedAt: number | null;
    }>
  >();

  for (const runtime of runtimes) {
    const sessionId = runtime.sessionId?.trim();
    const dispatchId =
      typeof runtime.metadata.dispatchId === "string" ? runtime.metadata.dispatchId.trim() : "";
    const dispatchSubmittedAt =
      typeof runtime.metadata.dispatchSubmittedAt === "string"
        ? Date.parse(runtime.metadata.dispatchSubmittedAt)
        : Number.NaN;

    if (!sessionId || !dispatchId) {
      continue;
    }

    const sessionKey = `${runtime.agentId ?? "unknown"}:${sessionId}`;
    const entries = dispatchIdBySessionKey.get(sessionKey) ?? [];

    if (!entries.some((entry) => entry.dispatchId === dispatchId)) {
      entries.push({
        dispatchId,
        submittedAt: Number.isNaN(dispatchSubmittedAt) ? null : dispatchSubmittedAt
      });
      entries.sort(
        (left, right) =>
          (left.submittedAt ?? Number.NEGATIVE_INFINITY) - (right.submittedAt ?? Number.NEGATIVE_INFINITY)
      );
      dispatchIdBySessionKey.set(sessionKey, entries);
    }
  }

  return dispatchIdBySessionKey;
}

function buildNativeTaskIdByRuntimeLink(runtimes: RuntimeRecord[]) {
  const taskIdByLink = new Map<string, string>();

  for (const runtime of runtimes) {
    const taskId = resolveNativeRuntimeTaskId(runtime);

    if (!taskId) {
      continue;
    }

    for (const link of resolveRuntimeTaskLinks(runtime)) {
      if (!taskIdByLink.has(link)) {
        taskIdByLink.set(link, taskId);
      }
    }
  }

  return taskIdByLink;
}

function resolveTaskGroupKey(
  runtime: RuntimeRecord,
  dispatchIdBySessionKey: Map<
    string,
    Array<{
      dispatchId: string;
      submittedAt: number | null;
    }>
  >,
  nativeTaskIdByRuntimeLink: Map<string, string>
) {
  const taskId = runtime.taskId?.trim();
  const nativeTaskId = resolveLinkedNativeTaskId(runtime, nativeTaskIdByRuntimeLink);
  const dispatchId =
    typeof runtime.metadata.dispatchId === "string" ? runtime.metadata.dispatchId.trim() : "";
  const mission = resolveRuntimeMissionText(runtime);
  const sessionId = runtime.sessionId?.trim();
  const sessionDispatchEntries = sessionId
    ? dispatchIdBySessionKey.get(`${runtime.agentId ?? "unknown"}:${sessionId}`) ?? []
    : [];
  const runtimeUpdatedAt = runtime.updatedAt ?? 0;
  const sessionDispatchId =
    sessionDispatchEntries
      .filter((entry) => entry.submittedAt === null || runtimeUpdatedAt >= entry.submittedAt - 1500)
      .sort(
        (left, right) =>
          (right.submittedAt ?? Number.NEGATIVE_INFINITY) - (left.submittedAt ?? Number.NEGATIVE_INFINITY)
      )[0]?.dispatchId ?? "";

  if (nativeTaskId) {
    return `task:${nativeTaskId}`;
  }

  if (dispatchId) {
    return `dispatch:${dispatchId}`;
  }

  if (sessionDispatchId) {
    return `dispatch:${sessionDispatchId}`;
  }

  if (taskId) {
    return `task:${taskId}`;
  }

  if (mission) {
    return `mission:${runtime.agentId ?? "unknown"}:${hashTaskKey(mission)}`;
  }

  if (sessionId) {
    return `session:${sessionId}`;
  }

  return `runtime:${runtime.id}`;
}

function resolveLinkedNativeTaskId(runtime: RuntimeRecord, nativeTaskIdByRuntimeLink: Map<string, string>) {
  return resolveRuntimeTaskLinks(runtime)
    .map((link) => nativeTaskIdByRuntimeLink.get(link))
    .find((value): value is string => Boolean(value)) ?? null;
}

function resolveRuntimeTaskLinks(runtime: RuntimeRecord) {
  const links = new Set<string>();
  const dispatchId =
    typeof runtime.metadata.dispatchId === "string" ? runtime.metadata.dispatchId.trim() : "";
  const agentId = runtime.agentId?.trim() || "unknown";
  const sessionIds = normalizeTaskSessionReferences(runtime.sessionId);

  if (dispatchId) {
    links.add(`dispatch:${dispatchId}`);
  }

  if (runtime.runId?.trim()) {
    links.add(`run:${runtime.runId.trim()}`);
  }

  for (const sessionId of sessionIds) {
    links.add(`session:${agentId}:${sessionId}`);
  }

  return [...links];
}

export function normalizeTaskSessionReferences(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed || !isUsableTaskSessionReference(trimmed)) {
    return [];
  }

  const match = trimmed.match(/^agent:([^:]+):explicit:(.+)$/);
  return match
    ? uniqueStrings([trimmed, match[2] ?? ""]).filter(isUsableTaskSessionReference)
    : [trimmed];
}

function resolveRuntimeMissionText(runtime: RuntimeRecord) {
  const mission =
    typeof runtime.metadata.mission === "string"
      ? runtime.metadata.mission
      : typeof runtime.metadata.turnPrompt === "string"
        ? runtime.metadata.turnPrompt
        : null;

  if (!mission) {
    return null;
  }

  const normalized = stripMissionRouting(mission);
  return normalized.length > 0 ? normalized : null;
}

function scoreTaskRuntime(runtime: RuntimeRecord) {
  const hasMission = resolveRuntimeMissionText(runtime) ? 8 : 0;
  const nativeTaskScore = isNativeTaskRuntime(runtime) ? 10 : 0;
  const dispatchScore = typeof runtime.metadata.dispatchId === "string" ? 6 : 0;
  const sourceScore = runtime.source === "turn" ? 6 : runtime.source === "session" ? 4 : 2;
  const statusScore =
    runtime.status === "running"
      ? 3
      : runtime.status === "queued"
        ? 2
        : runtime.status === "cancelled"
          ? 3
          : runtime.status === "stalled"
            ? 3
            : runtime.status === "idle"
              ? 2
              : 1;

  return nativeTaskScore + hasMission + dispatchScore + sourceScore + statusScore;
}

function resolveTaskStatus(
  runtimes: RuntimeRecord[],
  dispatchStatus: RuntimeRecord["status"] | null = null
): RuntimeRecord["status"] {
  return resolveCanonicalTaskStatus({
    nativeTaskStatus: resolveNativeTaskStatus(runtimes),
    runtimeStatuses: runtimes.map((runtime) => runtime.status),
    dispatchStatus
  });
}

function countLiveTaskRuntimes(runtimes: RuntimeRecord[], dispatchStatus: RuntimeRecord["status"] | null) {
  const nativeTaskStatus = resolveNativeTaskStatus(runtimes);
  if (
    (nativeTaskStatus && isTerminalTaskStatus(resolveCanonicalTaskStatus({ nativeTaskStatus, runtimeStatuses: [] }))) ||
    (!nativeTaskStatus && dispatchStatus && isTerminalTaskStatus(dispatchStatus))
  ) {
    return 0;
  }

  return runtimes.filter((runtime) => runtime.status === "running" || runtime.status === "queued").length;
}

function resolveTaskDispatchStatus(runtimes: RuntimeRecord[]): RuntimeRecord["status"] | null {
  const statuses = runtimes
    .map((runtime) =>
      typeof runtime.metadata.dispatchStatus === "string" ? runtime.metadata.dispatchStatus.trim() : ""
    )
    .filter(Boolean);

  if (statuses.includes("cancelled")) {
    return "cancelled";
  }

  if (statuses.includes("stalled")) {
    return "stalled";
  }

  if (statuses.includes("completed")) {
    return "completed";
  }

  if (statuses.includes("running")) {
    return "running";
  }

  if (statuses.includes("queued")) {
    return "queued";
  }

  return null;
}

function isTerminalTaskStatus(status: RuntimeRecord["status"]) {
  return status === "completed" || status === "stalled" || status === "cancelled";
}

function resolveDispatchId(runtimes: RuntimeRecord[]) {
  for (const runtime of runtimes) {
    if (typeof runtime.metadata.dispatchId === "string" && runtime.metadata.dispatchId.trim()) {
      return runtime.metadata.dispatchId.trim();
    }
  }

  return undefined;
}

function resolveTaskProvenance(runtimes: RuntimeRecord[], dispatchId: string | undefined) {
  if (runtimes.some(isNativeTaskRuntime)) {
    return "native-task";
  }

  if (dispatchId || runtimes.some(isDispatchDerivedRuntime)) {
    return "dispatch-derived";
  }

  return "runtime-derived";
}

function resolveTaskExecutionIdentity(
  runtimes: RuntimeRecord[],
  overrides: Partial<ReturnType<typeof executionIdentityFromRuntime>>
) {
  const base = executionIdentityFromRuntime(runtimes.find(isNativeTaskRuntime) ?? runtimes[0]!);
  const hasNativeTask = runtimes.some(isNativeTaskRuntime);

  return {
    ...base,
    ...overrides,
    provenance: hasNativeTask ? "authoritative" as const : base.provenance
  };
}

function resolveOpenClawTaskId(runtimes: RuntimeRecord[]) {
  return runtimes
    .map(resolveNativeRuntimeTaskId)
    .find((value): value is string => Boolean(value)) ?? null;
}

function resolveNativeTaskStatus(runtimes: RuntimeRecord[]) {
  const nativeTaskRuntimes = runtimes
    .filter(isNativeTaskRuntime)
    .sort((left, right) => {
      const leftLedger = left.metadata.sourceOfTruth === "openclaw-tasks.list" ? 1 : 0;
      const rightLedger = right.metadata.sourceOfTruth === "openclaw-tasks.list" ? 1 : 0;
      return rightLedger - leftLedger || sortRuntimesByUpdatedAtDesc(left, right);
    });

  for (const runtime of nativeTaskRuntimes) {
    if (typeof runtime.metadata.openClawTaskStatus === "string" && runtime.metadata.openClawTaskStatus.trim()) {
      return runtime.metadata.openClawTaskStatus.trim();
    }
  }

  return null;
}

function resolveNativeRuntimeTaskId(runtime: RuntimeRecord) {
  if (!isNativeTaskRuntime(runtime)) {
    return null;
  }

  const metadataTaskId =
    typeof runtime.metadata.taskId === "string" ? runtime.metadata.taskId.trim() : "";
  const taskId = runtime.taskId?.trim() || metadataTaskId || runtime.key.trim();

  return taskId || null;
}

function resolveTaskSessionKey(runtimes: RuntimeRecord[]) {
  for (const runtime of runtimes) {
    const sessionKey =
      typeof runtime.metadata.openClawSessionKey === "string"
        ? runtime.metadata.openClawSessionKey.trim()
        : typeof runtime.metadata.sessionKey === "string"
        ? runtime.metadata.sessionKey.trim()
        : typeof runtime.metadata.gatewaySessionKey === "string"
          ? runtime.metadata.gatewaySessionKey.trim()
        : runtime.key.trim().startsWith("agent:")
          ? runtime.key.trim()
          : "";

    if (sessionKey) {
      return sessionKey;
    }
  }

  return null;
}

function resolveTaskSessionId(runtimes: RuntimeRecord[], sessionIds: string[], sessionKey: string | null) {
  for (const runtime of runtimes) {
    const metadataSessionId =
      typeof runtime.metadata.openClawSessionId === "string"
        ? runtime.metadata.openClawSessionId.trim()
        : typeof runtime.metadata.sessionId === "string"
          ? runtime.metadata.sessionId.trim()
          : typeof runtime.metadata.gatewaySessionId === "string"
            ? runtime.metadata.gatewaySessionId.trim()
            : "";

    if (metadataSessionId && isUsableTaskSessionReference(metadataSessionId)) {
      return extractExplicitSessionId(metadataSessionId) ?? metadataSessionId;
    }
  }

  for (const sessionId of sessionIds) {
    const normalized = extractExplicitSessionId(sessionId) ?? sessionId.trim();
    if (normalized) {
      return normalized;
    }
  }

  return extractExplicitSessionId(sessionKey) ?? null;
}

function resolveTaskContinuationConfidence(
  provenance: "native-task" | "dispatch-derived" | "runtime-derived",
  sessionKey: string | null,
  sessionId: string | null
) {
  if (!sessionKey && !sessionId) {
    return "none";
  }

  return provenance === "runtime-derived" ? "medium" : "high";
}

function extractExplicitSessionId(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }

  const marker = ":explicit:";
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }

  return normalized.slice(markerIndex + marker.length).trim() || null;
}

function isUsableTaskSessionReference(value: string) {
  const normalized = value.trim().toLowerCase();
  return Boolean(normalized) && !["gateway", "unknown", "none", "null", "n/a"].includes(normalized);
}

function isNativeTaskRuntime(runtime: RuntimeRecord) {
  return runtime.metadata.gatewayObjectKind === "task" && Boolean(runtime.taskId?.trim());
}

function isDispatchDerivedRuntime(runtime: RuntimeRecord) {
  const origin = typeof runtime.metadata.origin === "string" ? runtime.metadata.origin.trim() : "";
  const dispatchId =
    typeof runtime.metadata.dispatchId === "string" ? runtime.metadata.dispatchId.trim() : "";
  const dispatchStatus =
    typeof runtime.metadata.dispatchStatus === "string" ? runtime.metadata.dispatchStatus.trim() : "";

  return Boolean(
    origin === "mission-dispatch" ||
      origin === "agentos-mission-dispatch" ||
      dispatchId ||
      dispatchStatus ||
      typeof runtime.metadata.bootstrapStage === "string"
  );
}

function resolveTaskRoutedMission(runtimes: RuntimeRecord[]) {
  for (const runtime of runtimes) {
    const routedMission =
      typeof runtime.metadata.routedMission === "string" ? runtime.metadata.routedMission.trim() : "";

    if (routedMission) {
      return routedMission;
    }
  }

  return null;
}

function resolveTaskResultPreview(runtimes: RuntimeRecord[]) {
  const orderedCandidates = [
    ...runtimes.filter(
      (runtime) =>
        hasTaskOutputIdentity(runtime) &&
        !isBootstrapOnlyTaskRuntime(runtime) &&
        (runtime.status === "completed" || runtime.status === "stalled" || runtime.status === "cancelled")
    ),
    ...runtimes.filter((runtime) => typeof runtime.metadata.turnId === "string"),
    ...runtimes.filter((runtime) => runtime.metadata.recoveredFromObservation === true),
    ...runtimes.filter(
      (runtime) =>
        !isBootstrapOnlyTaskRuntime(runtime) &&
        (runtime.status === "completed" || runtime.status === "stalled" || runtime.status === "cancelled")
    ),
    ...runtimes.filter((runtime) => !isBootstrapOnlyTaskRuntime(runtime))
  ];
  const seenRuntimeIds = new Set<string>();

  for (const runtime of orderedCandidates) {
    if (seenRuntimeIds.has(runtime.id)) {
      continue;
    }

    seenRuntimeIds.add(runtime.id);

    const subtitle = runtime.subtitle?.trim();
    if (subtitle && isMeaningfulTaskPreview(subtitle)) {
      return subtitle;
    }
  }

  return null;
}

function countTaskTurns(runtimes: RuntimeRecord[]) {
  return runtimes.filter(
    (runtime) =>
      typeof runtime.metadata.turnId === "string" || runtime.metadata.recoveredFromObservation === true
  ).length;
}

function isBootstrapOnlyTaskRuntime(runtime: RuntimeRecord) {
  const bootstrapStage =
    typeof runtime.metadata.bootstrapStage === "string" ? runtime.metadata.bootstrapStage : null;

  return (
    bootstrapStage === "accepted" ||
    bootstrapStage === "waiting-for-heartbeat" ||
    bootstrapStage === "waiting-for-runtime" ||
    bootstrapStage === "runtime-observed"
  );
}

function hasTaskOutputIdentity(runtime: RuntimeRecord) {
  return Boolean(
    typeof runtime.metadata.dispatchId === "string" && runtime.metadata.dispatchId.trim()
  ) || Boolean(resolveRuntimeMissionText(runtime));
}

function isMeaningfulTaskPreview(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim().toLowerCase();

  return Boolean(normalized) && normalized !== "sessions.changed" && normalized !== "session.message";
}

function aggregateRuntimeTokenUsage(runtimes: RuntimeRecord[]) {
  const relevant = dedupeRuntimeTokenUsage(runtimes).filter((runtime) => runtime.tokenUsage);

  if (relevant.length === 0) {
    return undefined;
  }

  return relevant.reduce(
    (aggregate, runtime) => ({
      input: aggregate.input + (runtime.tokenUsage?.input ?? 0),
      output: aggregate.output + (runtime.tokenUsage?.output ?? 0),
      total: aggregate.total + (runtime.tokenUsage?.total ?? 0),
      cacheRead: (aggregate.cacheRead ?? 0) + (runtime.tokenUsage?.cacheRead ?? 0)
    }),
    {
      input: 0,
      output: 0,
      total: 0,
      cacheRead: 0
    }
  );
}

function dedupeRuntimeTokenUsage(runtimes: RuntimeRecord[]) {
  const seen = new Set<string>();
  const deduped: RuntimeRecord[] = [];

  for (const runtime of runtimes) {
    if (!runtime.tokenUsage) {
      continue;
    }

    const key = createRuntimeTokenUsageKey(runtime);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(runtime);
  }

  return deduped;
}

function createRuntimeTokenUsageKey(runtime: RuntimeRecord) {
  const dispatchId =
    typeof runtime.metadata.dispatchId === "string" ? runtime.metadata.dispatchId.trim() : "";
  const usage = runtime.tokenUsage ?? {
    input: 0,
    output: 0,
    total: 0,
    cacheRead: 0
  };

  return [
    dispatchId || runtime.runId || runtime.sessionId || runtime.id,
    dispatchId ? "" : runtime.sessionId ?? "",
    usage.input,
    usage.output,
    usage.total,
    usage.cacheRead ?? 0
  ].join(":");
}

export function extractCreatedFilesFromRuntimeMetadata(runtime: RuntimeRecord) {
  const rawCreatedFiles = runtime.metadata.createdFiles;

  if (!Array.isArray(rawCreatedFiles)) {
    return [];
  }

  return rawCreatedFiles.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const pathValue = "path" in entry && typeof entry.path === "string" ? entry.path : null;
    const displayPathValue =
      "displayPath" in entry && typeof entry.displayPath === "string" ? entry.displayPath : pathValue;

    if (!pathValue || !displayPathValue) {
      return [];
    }

    return [
      {
        path: pathValue,
        displayPath: displayPathValue
      } satisfies RuntimeCreatedFile
    ];
  });
}

function inferCreatedFilesFromText(value: string | null | undefined) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return [];
  }

  const matches = [
    ...value.matchAll(/(?:^|[\s:])((?:\/[^\s`),;]+)+\.[A-Za-z0-9][A-Za-z0-9._-]*)/g),
    ...value.matchAll(/(?:^|[\s(])((?:\.{1,2}\/)?deliverables\/[^\s`),;]+)/g),
    ...value.matchAll(/\]\(((?:\/|\.{1,2}\/|deliverables\/)[^)]+)\)/g),
    ...value.matchAll(/`((?:\/|\.{1,2}\/|deliverables\/)[^`\n]+)`/g)
  ];
  const createdFiles: RuntimeCreatedFile[] = [];

  for (const match of matches) {
    const pathValue = (match[1] || "").trim();

    if (!pathValue || !looksLikeArtifactFilePath(pathValue)) {
      continue;
    }

    createdFiles.push({
      path: pathValue,
      displayPath: pathValue
    });
  }

  return dedupeCreatedFiles(createdFiles);
}

function looksLikeArtifactFilePath(pathValue: string) {
  const normalized = pathValue.trim().replace(/[`'")\],;]+$/g, "");

  if (!normalized || normalized.endsWith("/")) {
    return false;
  }

  const basename = normalized.split("/").pop() || "";

  return basename.includes(".");
}

export function extractWarningsFromRuntimeMetadata(runtime: RuntimeRecord) {
  const rawWarnings = runtime.metadata.warnings;

  if (!Array.isArray(rawWarnings)) {
    return [];
  }

  return rawWarnings.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function createTaskRecordId(groupKey: string) {
  return `task:${hashTaskKey(groupKey)}`;
}

export function hashTaskKey(value: string) {
  return createHash("sha1").update(value).digest("hex").slice(0, 12);
}

export function dedupeCreatedFiles(files: RuntimeCreatedFile[]) {
  const seen = new Set<string>();
  const deduped: RuntimeCreatedFile[] = [];

  for (const file of files) {
    if (!file.path || seen.has(file.path)) {
      continue;
    }

    seen.add(file.path);
    deduped.push(file);
  }

  return deduped;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => normalizeOptionalValue(value))
        .filter((value): value is string => Boolean(value))
    )
  );
}

function normalizeOptionalValue(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sortRuntimesByUpdatedAtDesc(left: RuntimeRecord, right: RuntimeRecord) {
  return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
}
