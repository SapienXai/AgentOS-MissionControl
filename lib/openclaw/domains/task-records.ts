import { createHash } from "node:crypto";

import { compactMissionText, stripMissionRouting } from "@/lib/openclaw/presenters";
import type { OpenClawAgent, RuntimeCreatedFile, RuntimeRecord, TaskRecord } from "@/lib/openclaw/types";

export function buildTaskRecords(runtimes: RuntimeRecord[], agents: OpenClawAgent[]): TaskRecord[] {
  const taskRuntimes = runtimes.filter((runtime) => !isDirectChatRuntime(runtime));
  const groups = new Map<string, RuntimeRecord[]>();
  const agentNameById = new Map(agents.map((agent) => [agent.id, compactAgentName(agent)]));
  const dispatchIdBySessionKey = buildDispatchIdBySessionKey(taskRuntimes);

  for (const runtime of taskRuntimes) {
    const groupKey = resolveTaskGroupKey(runtime, dispatchIdBySessionKey);
    const group = groups.get(groupKey) ?? [];
    group.push(runtime);
    groups.set(groupKey, group);
  }

  return Array.from(groups.entries())
    .map(([groupKey, groupedRuntimes]) => buildTaskRecord(groupKey, groupedRuntimes, agentNameById))
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
}

export function buildTaskRecord(
  groupKey: string,
  runtimes: RuntimeRecord[],
  agentNameById: Map<string, string>
): TaskRecord {
  const sortedRuntimes = [...runtimes].sort(sortRuntimesByUpdatedAtDesc);
  const signalRuntimes = selectTaskSignalRuntimes(sortedRuntimes);
  const primaryRuntime =
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
  const sessionIds = uniqueStrings(sortedRuntimes.flatMap((runtime) => (runtime.sessionId ? [runtime.sessionId] : [])));
  const runIds = uniqueStrings(sortedRuntimes.flatMap((runtime) => (runtime.runId ? [runtime.runId] : [])));
  const turnCount = countTaskTurns(sortedRuntimes);
  const primaryAgentId = primaryRuntime?.agentId || agentIds[0];
  const primaryAgentName = primaryAgentId ? agentNameById.get(primaryAgentId) ?? null : null;
  const latestRuntime = sortedRuntimes[0] ?? null;

  return {
    id: createTaskRecordId(groupKey),
    key: groupKey,
    title: compactMissionText(mission || primaryRuntime?.title || "Untitled task", 52) || "Untitled task",
    mission,
    subtitle,
    status: resolveTaskStatus(sortedRuntimes),
    updatedAt: latestRuntime?.updatedAt ?? null,
    ageMs: latestRuntime?.ageMs ?? null,
    workspaceId: primaryRuntime?.workspaceId,
    primaryAgentId,
    primaryAgentName,
    primaryRuntimeId: primaryRuntime?.id,
    dispatchId: resolveDispatchId(sortedRuntimes),
    runtimeIds: sortedRuntimes.map((runtime) => runtime.id),
    agentIds,
    sessionIds,
    runIds,
    runtimeCount: sortedRuntimes.length,
    updateCount: signalRuntimes.filter((runtime) => runtime.source === "turn").length,
    liveRunCount: sortedRuntimes.filter((runtime) => runtime.status === "running" || runtime.status === "queued").length,
    artifactCount: createdFiles.length,
    warningCount: warnings.length,
    tokenUsage,
    metadata: {
      mission,
      routedMission,
      resultPreview,
      turnCount,
      sessionCount: sessionIds.length,
      primaryRuntimeSource: primaryRuntime?.source ?? null,
      bootstrapStage:
        typeof primaryRuntime?.metadata.bootstrapStage === "string"
          ? primaryRuntime.metadata.bootstrapStage
          : null,
      dispatchStatus:
        typeof primaryRuntime?.metadata.dispatchStatus === "string"
          ? primaryRuntime.metadata.dispatchStatus
          : null,
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
      outputDir:
        typeof primaryRuntime?.metadata.outputDir === "string" ? primaryRuntime.metadata.outputDir : null,
      outputDirRelative:
        typeof primaryRuntime?.metadata.outputDirRelative === "string"
          ? primaryRuntime.metadata.outputDirRelative
          : null
    }
  };
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
  if (typeof runtime.metadata.dispatchId === "string" && runtime.metadata.dispatchId.trim()) {
    return false;
  }

  if (typeof runtime.metadata.chatType === "string" && runtime.metadata.chatType === "direct") {
    return true;
  }

  if (typeof runtime.metadata.kind === "string" && runtime.metadata.kind === "direct") {
    return true;
  }

  const prompt =
    resolveRuntimeMissionText(runtime) ||
    (typeof runtime.metadata.turnPrompt === "string" ? runtime.metadata.turnPrompt : null);

  if (typeof prompt === "string" && isDirectChatPrompt(prompt)) {
    return true;
  }

  return false;
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

function resolveTaskGroupKey(
  runtime: RuntimeRecord,
  dispatchIdBySessionKey: Map<
    string,
    Array<{
      dispatchId: string;
      submittedAt: number | null;
    }>
  >
) {
  const taskId = runtime.taskId?.trim();
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

  return hasMission + dispatchScore + sourceScore + statusScore;
}

function resolveTaskStatus(runtimes: RuntimeRecord[]): RuntimeRecord["status"] {
  if (runtimes.some((runtime) => runtime.status === "running")) {
    return "running";
  }

  if (runtimes.some((runtime) => runtime.status === "cancelled")) {
    return "cancelled";
  }

  if (runtimes.some((runtime) => runtime.status === "queued")) {
    return "queued";
  }

  if (runtimes.some((runtime) => runtime.status === "stalled")) {
    return "stalled";
  }

  if (runtimes.some((runtime) => runtime.status === "idle")) {
    return "idle";
  }

  return runtimes[0]?.status ?? "completed";
}

function resolveDispatchId(runtimes: RuntimeRecord[]) {
  for (const runtime of runtimes) {
    if (typeof runtime.metadata.dispatchId === "string" && runtime.metadata.dispatchId.trim()) {
      return runtime.metadata.dispatchId.trim();
    }
  }

  return undefined;
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
    if (subtitle) {
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

function aggregateRuntimeTokenUsage(runtimes: RuntimeRecord[]) {
  const relevant = runtimes.filter((runtime) => runtime.tokenUsage);

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
    ...value.matchAll(/(?:^|[\s(])((?:\.{1,2}\/)?deliverables\/[^\s`),;]+)/g),
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
