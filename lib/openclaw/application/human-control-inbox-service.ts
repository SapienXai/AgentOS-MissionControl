import "server-only";

import { getMissionControlSnapshot } from "@/lib/openclaw/application/mission-control-service";
import {
  getWorkerEffectiveCapabilities
} from "@/lib/openclaw/application/worker-capability-service";
import type { OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import type {
  OpenClawExecApprovalListPayload,
  OpenClawGatewaySurfacePayload,
  OpenClawQuestionListPayload,
  OpenClawCommandOptions
} from "@/lib/openclaw/client/types";
import { isRuntimeIssueActionRequired, type RuntimeIssue } from "@/lib/openclaw/runtime-issues";
import type {
  AttentionAction,
  AttentionItem,
  AttentionSeverity,
  EffectiveCapability,
  HumanControlInbox,
  HumanControlInboxSummary,
  MissionControlSnapshot,
  OpenClawAgent,
  TaskRecord,
  WorkerEffectiveCapabilitiesPayload
} from "@/lib/openclaw/types";
import { redactSecretText } from "@/lib/security/redaction";

export type HumanControlInboxFilter = {
  type?: AttentionItem["type"];
  workerId?: string;
  missionId?: string;
  severity?: AttentionSeverity;
};

export type CapabilityAttentionCandidate = {
  workerId: string;
  workerLabel?: string | null;
  sessionKey?: string | null;
  taskId?: string | null;
  capability: EffectiveCapability;
  relevance: CapabilityAttentionRelevance;
};

export type CapabilityAttentionRelevance = {
  toolIds: string[];
  sourceKinds: string[];
};

export type HumanControlInboxOptions = HumanControlInboxFilter & {
  adapter?: OpenClawAdapter;
  snapshot?: MissionControlSnapshot;
  capabilities?: CapabilityAttentionCandidate[];
  capabilityResolver?: CapabilityResolver;
};

export type CapabilityResolver = (
  workerId: string,
  options: { sessionKey?: string | null; adapter?: OpenClawAdapter }
) => Promise<WorkerEffectiveCapabilitiesPayload>;

export const HUMAN_CONTROL_CAPABILITY_CANDIDATE_LIMIT = 16;
export const HUMAN_CONTROL_CAPABILITY_RESOLVER_CONCURRENCY = 4;

type NativeApprovalRecord = {
  id: string;
  approvalKind?: "exec" | "plugin";
  request?: Record<string, unknown>;
  createdAtMs?: number;
  expiresAtMs?: number;
};

type QuestionRecord = NonNullable<OpenClawQuestionListPayload["questions"]>[number];

const APPROVAL_DECISIONS = ["allow-once", "allow-always", "deny"] as const;

export async function getHumanControlInbox(options: HumanControlInboxOptions = {}): Promise<HumanControlInbox> {
  const adapter = options.adapter ?? getOpenClawAdapter();
  const [snapshotResult, execResult, pluginResult, questionResult] = await Promise.all([
    options.snapshot ? Promise.resolve(options.snapshot) : getMissionControlSnapshot(),
    settle(adapter.listNativeExecApprovals?.({ status: "pending", limit: 100 }, { timeoutMs: 8_000 })),
    settle(adapter.listNativePluginApprovals?.({}, { timeoutMs: 8_000 })),
    settle(adapter.listQuestions?.({ timeoutMs: 8_000 }))
  ]);

  const snapshot = snapshotResult;
  const agents = snapshot.agents;
  const tasks = snapshot.tasks;
  const nativeItems = [
    ...projectApprovalRecords(readApprovalRecords(execResult), "exec", agents, tasks),
    ...projectApprovalRecords(readApprovalRecords(pluginResult), "plugin", agents, tasks),
    ...projectQuestionRecords(readQuestionRecords(questionResult), agents, tasks),
    ...projectSuggestedWork(snapshot),
    ...projectRuntimeAttention(snapshot, agents)
  ];
  const capabilityResolution = options.capabilities
    ? { candidates: options.capabilities, source: "available" as const, issues: [] as string[] }
    : await resolveHumanControlCapabilityCandidates(snapshot, nativeItems, {
        adapter,
        resolver: options.capabilityResolver
      });
  const items = [
    ...nativeItems,
    ...projectCapabilityAttention(capabilityResolution.candidates)
  ];
  const filtered = filterAttentionItems(dedupeAttentionItems(items), options);
  const issues = [
    ...(execResult.status === "rejected" ? ["Execution approvals could not be verified from OpenClaw."] : []),
    ...(pluginResult.status === "rejected" ? ["Plugin approvals could not be verified from OpenClaw."] : []),
    ...(questionResult.status === "rejected" ? ["Questions could not be verified from OpenClaw."] : []),
    ...capabilityResolution.issues
  ];

  return {
    items: sortAttentionItems(filtered),
    summary: summarizeAttentionItems(filtered),
    sources: {
      approvals: execResult.status === "fulfilled" || pluginResult.status === "fulfilled" ? "available" : "unavailable",
      questions: questionResult.status === "fulfilled" ? "available" : "unavailable",
      suggestedWork: snapshot.nativeWork ? "available" : "unavailable",
      capabilities: capabilityResolution.source,
      runtime: "available"
    },
    generatedAt: new Date().toISOString(),
    ...(issues.length > 0 ? { issues } : {})
  };
}

export async function resolveHumanControlCapabilityCandidates(
  snapshot: MissionControlSnapshot,
  nativeItems: AttentionItem[] = [],
  options: {
    adapter?: OpenClawAdapter;
    resolver?: CapabilityResolver;
    maxCandidates?: number;
    concurrency?: number;
  } = {}
) {
  const maxCandidates = options.maxCandidates ?? HUMAN_CONTROL_CAPABILITY_CANDIDATE_LIMIT;
  const concurrency = options.concurrency ?? HUMAN_CONTROL_CAPABILITY_RESOLVER_CONCURRENCY;
  const contexts = collectCapabilityCandidateContexts(snapshot, nativeItems)
    .filter((context) => context.toolIds.length > 0)
    .slice(0, maxCandidates);
  const resolver = options.resolver ?? getWorkerEffectiveCapabilities;
  const resolved = await mapWithConcurrency(contexts, concurrency, async (context) => {
    try {
      const payload = await resolver(context.workerId, {
        sessionKey: context.sessionKey,
        adapter: options.adapter
      });
      return {
        context,
        payload
      };
    } catch {
      return {
        context,
        payload: null
      };
    }
  });
  const candidates: CapabilityAttentionCandidate[] = [];
  let resolvedCount = 0;
  let failedCount = 0;

  for (const result of resolved) {
    if (!result.payload) {
      failedCount += 1;
      continue;
    }

    resolvedCount += 1;
    for (const capability of result.payload.capabilities) {
      candidates.push({
        workerId: result.context.workerId,
        workerLabel: result.context.workerLabel,
        sessionKey: result.payload.session.key ?? result.context.sessionKey,
        taskId: result.context.taskId,
        capability,
        relevance: {
          toolIds: result.context.toolIds,
          sourceKinds: result.context.sourceKinds
        }
      });
    }
  }

  const source = failedCount === 0
    ? "available" as const
    : resolvedCount > 0
      ? "partial" as const
      : "unavailable" as const;
  return {
    candidates,
    source,
    issues: failedCount > 0 ? ["Some active capability blockers could not be verified."] : [],
    candidateCount: contexts.length,
    resolvedCount,
    failedCount,
    maxCandidates,
    concurrency
  };
}

export function projectApprovalRecords(
  records: NativeApprovalRecord[],
  kind: "exec" | "plugin",
  agents: OpenClawAgent[],
  tasks: TaskRecord[]
): AttentionItem[] {
  return records
    .map((record) => projectApprovalRecord(record, kind, agents, tasks))
    .filter((item): item is AttentionItem => Boolean(item));
}

export function projectApprovalRecord(
  record: NativeApprovalRecord,
  kind: "exec" | "plugin",
  agents: OpenClawAgent[] = [],
  tasks: TaskRecord[] = []
): AttentionItem | null {
  if (!record.id) return null;
  const request = record.request ?? {};
  const agentId = readString(request.agentId);
  const workerLabel = resolveWorkerLabel(agentId, agents);
  const sessionKey = readString(request.sessionKey);
  const task = findTaskForSession(tasks, sessionKey);
  const allowedDecisions = readStringArray(request.allowedDecisions).filter((decision): decision is string =>
    APPROVAL_DECISIONS.includes(decision as (typeof APPROVAL_DECISIONS)[number])
  );
  const effectiveAllowedDecisions = allowedDecisions.length > 0 ? allowedDecisions : [...APPROVAL_DECISIONS];
  const toolId = readString(request.toolName);
  const operation = kind === "exec"
    ? readString(request.commandPreview) ?? readString(request.command) ?? "a shell operation"
    : readString(request.title) ?? "a plugin operation";
  const summary = kind === "exec"
    ? `${workerLabel ?? "This worker"} wants to run ${redactSecretText(truncate(operation, 220))}.`
    : truncate(readString(request.description) ?? `${workerLabel ?? "This worker"} requested a plugin action.`, 260);
  const actions: AttentionAction[] = [];
  if (effectiveAllowedDecisions.includes("deny")) actions.push({ id: "deny", label: "Deny" });
  if (effectiveAllowedDecisions.includes("allow-once") || effectiveAllowedDecisions.includes("allow-always")) {
    actions.push({ id: "approve", label: "Approve once" });
  }

  return {
    id: `approval:${kind}:${record.id}`,
    type: "approval",
    source: {
      system: "openclaw",
      kind: `${kind}.approval`,
      nativeId: record.id,
      sessionKey,
      taskId: task?.id ?? null
    },
    worker: { id: agentId, label: workerLabel },
    ...(task ? { mission: projectTaskMission(task) } : {}),
    severity: kind === "plugin" && request.severity === "critical" ? "critical" : "high",
    title: kind === "plugin" ? "Plugin approval required" : "Approval required",
    summary,
    createdAt: toIso(record.createdAtMs),
    updatedAt: toIso(record.createdAtMs),
    availableActions: actions,
    status: "pending",
    evidence: {
      allowedDecisions: effectiveAllowedDecisions,
      ...(toolId ? { toolId } : {})
    }
  };
}

export function projectQuestionRecords(
  records: QuestionRecord[],
  agents: OpenClawAgent[],
  tasks: TaskRecord[]
): AttentionItem[] {
  return records
    .filter((record) => record.status === "pending")
    .map((record) => projectQuestionRecord(record, agents, tasks))
    .filter((item): item is AttentionItem => Boolean(item));
}

export function projectQuestionRecord(
  record: QuestionRecord,
  agents: OpenClawAgent[] = [],
  tasks: TaskRecord[] = []
): AttentionItem | null {
  if (!record.id || record.status !== "pending" || record.questions.length === 0) return null;
  const agentId = record.agentId ?? null;
  const workerLabel = resolveWorkerLabel(agentId, agents);
  const task = findTaskForSession(tasks, record.sessionKey ?? null);
  const questions = record.questions.map((prompt) => ({
    questionId: prompt.questionId,
    text: prompt.question,
    options: prompt.options,
    multiSelect: prompt.multiSelect === true,
    ...(prompt.isOther === true ? { isOther: true } : {}),
    ...(prompt.isSecret === true ? { isSecret: true } : {})
  }));
  return {
    id: `question:${record.id}`,
    type: "question",
    source: {
      system: "openclaw",
      kind: "question",
      nativeId: record.id,
      sessionKey: record.sessionKey ?? null,
      taskId: task?.id ?? null
    },
    worker: { id: agentId, label: workerLabel },
    ...(task ? { mission: projectTaskMission(task) } : {}),
    severity: task && isBlockingTask(task) ? "high" : "normal",
    title: record.questions[0]?.header || "Question",
    summary: truncate(record.questions[0]?.question ?? "This worker needs a decision.", 260),
    createdAt: toIso(record.createdAtMs),
    updatedAt: toIso(record.createdAtMs),
    availableActions: [{ id: "answer", label: "Answer", requiresPayload: true }],
    status: "pending",
    question: questions
  };
}

export function projectSuggestedWork(snapshot: MissionControlSnapshot): AttentionItem[] {
  return (snapshot.nativeWork?.suggestions ?? []).map((suggestion) => ({
    id: `suggestion:${suggestion.id}`,
    type: "suggested-work" as const,
    source: {
      system: "openclaw" as const,
      kind: "task.suggestion",
      nativeId: suggestion.id,
      sessionKey: suggestion.sourceSessionKey
    },
    worker: {
      id: suggestion.sourceAgentId,
      label: snapshot.agents.find((agent) => agent.id === suggestion.sourceAgentId)?.name ?? null
    },
    severity: "normal" as const,
    title: "Suggested work",
    summary: truncate(suggestion.title || suggestion.summary, 260),
    createdAt: toIso(suggestion.createdAt),
    updatedAt: toIso(suggestion.createdAt),
    availableActions: [
      { id: "review", label: "Review" },
      { id: "accept", label: "Accept" },
      { id: "dismiss", label: "Dismiss" }
    ],
    status: "pending" as const
  }));
}

export function projectCapabilityAttention(candidates: CapabilityAttentionCandidate[]): AttentionItem[] {
  return candidates
    .filter(({ capability, relevance }) =>
      (capability.status === "needs-setup" || capability.status === "blocked") &&
      isCapabilityOperationallyRelevant(capability, relevance)
    )
    .map(({ workerId, workerLabel, sessionKey, taskId, capability }) => {
      const isBlocked = capability.status === "blocked";
      const reasonCode = capability.reasons[0]?.code ?? "unknown";
      const action = isBlocked ? "review-policy" : capability.remediation ? "open-setup" : null;
      return {
        id: buildCapabilityAttentionId({
          type: isBlocked ? "blocked" : "needs-setup",
          workerId,
          sessionKey,
          taskId,
          capabilityId: capability.id,
          reasonCode
        }),
        type: isBlocked ? "blocked" as const : "needs-setup" as const,
        source: {
          system: "agentos" as const,
          kind: "effective-capability",
          sessionKey: sessionKey ?? null,
          taskId: taskId ?? null
        },
        worker: { id: workerId, label: workerLabel ?? null },
        severity: isBlocked ? "high" as const : "normal" as const,
        title: isBlocked ? "Blocked capability" : "Needs setup",
        summary: capability.explanation,
        createdAt: null,
        updatedAt: null,
        availableActions: action ? [{ id: action, label: isBlocked ? "Review policy" : "Open setup" }] : [],
        status: "pending" as const,
        evidence: { capabilityId: capability.id, reasonCode, toolId: capability.evidence.tool?.id }
      };
    });
}

export function isCapabilityOperationallyRelevant(
  capability: EffectiveCapability,
  relevance: CapabilityAttentionRelevance | undefined
) {
  const capabilityToolIds = [
    capability.evidence.tool?.id,
    ...(capability.evidence.tool?.toolIds ?? [])
  ]
    .filter((value): value is string => typeof value === "string")
    .map(normalizeToolIdentity);
  const relevantToolIds = new Set((relevance?.toolIds ?? []).map(normalizeToolIdentity));
  return capabilityToolIds.some((toolId) => relevantToolIds.has(toolId));
}

export function buildCapabilityAttentionId(input: {
  type: "blocked" | "needs-setup";
  workerId: string;
  sessionKey?: string | null;
  taskId?: string | null;
  capabilityId: string;
  reasonCode: string;
}) {
  const context = input.sessionKey?.trim()
    ? `session:${encodeURIComponent(input.sessionKey.trim())}`
    : input.taskId?.trim()
      ? `task:${encodeURIComponent(input.taskId.trim())}`
      : "worker";
  return [
    input.type,
    encodeURIComponent(input.workerId.trim()),
    context,
    encodeURIComponent(input.capabilityId),
    encodeURIComponent(input.reasonCode)
  ].join(":");
}

export function projectRuntimeAttention(snapshot: MissionControlSnapshot, agents: OpenClawAgent[] = snapshot.agents): AttentionItem[] {
  const items = snapshot.diagnostics.runtimeIssues
    .filter(isRuntimeIssueActionRequired)
    .map((issue) => projectRuntimeIssue(issue, agents, snapshot.tasks));
  const existingTaskIds = new Set(items.map((item) => item.source.taskId).filter((id): id is string => Boolean(id)));
  for (const task of snapshot.tasks) {
    if (!isBlockingTask(task) || existingTaskIds.has(task.id)) continue;
    items.push(projectRuntimeTask(task));
  }
  return items;
}

export function projectRuntimeIssue(issue: RuntimeIssue, agents: OpenClawAgent[] = [], tasks: TaskRecord[] = []): AttentionItem {
  const task = findTaskForRuntimeIssue(tasks, issue.requestId);
  return {
    id: `runtime:${issue.id}`,
    type: "runtime-issue",
    source: {
      system: "agentos",
      kind: issue.type,
      nativeId: issue.id,
      sessionKey: task ? resolveTaskSessionKeyForAttention(task) : null,
      taskId: task?.id ?? null
    },
    worker: { id: task?.primaryAgentId ?? null, label: task?.primaryAgentName ?? resolveWorkerLabel(task?.primaryAgentId, agents) },
    ...(task ? { mission: projectTaskMission(task) } : {}),
    severity: issue.severity === "blocked" ? "critical" : "high",
    title: issue.title,
    summary: truncate(issue.message, 280),
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    availableActions: [{ id: "inspect", label: "Inspect" }],
    status: "pending",
    evidence: { runtimeIssueType: issue.type, reasonCode: issue.type }
  };
}

export function projectRuntimeTask(task: TaskRecord): AttentionItem {
  return {
    id: `runtime:task:${task.id}`,
    type: "runtime-issue",
    source: {
      system: "openclaw",
      kind: "task",
      nativeId: task.id,
      sessionKey: resolveTaskSessionKeyForAttention(task),
      taskId: task.id
    },
    worker: { id: task.primaryAgentId ?? null, label: task.primaryAgentName ?? null },
    mission: projectTaskMission(task),
    severity: "high",
    title: "Execution needs review",
    summary: truncate(task.subtitle || `${task.title} stopped unexpectedly.`, 280),
    createdAt: toIso(task.updatedAt),
    updatedAt: toIso(task.updatedAt),
    availableActions: [{ id: "inspect", label: "Inspect" }],
    status: "pending",
    evidence: { runtimeIssueType: "task" }
  };
}

export function dedupeAttentionItems(items: AttentionItem[]): AttentionItem[] {
  const byId = new Map<string, AttentionItem>();
  for (const item of items) {
    if (!byId.has(item.id)) byId.set(item.id, item);
  }
  const current = [...byId.values()];
  return current.filter((item) => {
    if (item.type !== "blocked" && item.type !== "runtime-issue") return true;
    return !current.some((candidate) =>
      (candidate.type === "approval" || candidate.type === "question") &&
      hasSharedWorkIdentity(candidate, item) &&
      (item.type !== "blocked" || hasSharedToolIdentity(candidate, item))
    );
  });
}

export function sortAttentionItems(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort((left, right) => {
    const severityDelta = severityRank(right.severity) - severityRank(left.severity);
    if (severityDelta !== 0) return severityDelta;
    const leftTime = Date.parse(left.createdAt ?? left.updatedAt ?? "") || Number.MAX_SAFE_INTEGER;
    const rightTime = Date.parse(right.createdAt ?? right.updatedAt ?? "") || Number.MAX_SAFE_INTEGER;
    if (leftTime !== rightTime) return leftTime - rightTime;
    return left.id.localeCompare(right.id);
  });
}

export function summarizeAttentionItems(items: AttentionItem[]): HumanControlInboxSummary {
  return items.reduce<HumanControlInboxSummary>((summary, item) => {
    summary.totalPending += item.status === "pending" ? 1 : 0;
    if (item.type === "approval") summary.approvals += 1;
    if (item.type === "question") summary.questions += 1;
    if (item.type === "suggested-work") summary.suggestedWork += 1;
    if (item.type === "needs-setup" || item.type === "blocked") summary.setupAndBlockers += 1;
    if (item.type === "runtime-issue") summary.runtimeIssues += 1;
    return summary;
  }, { totalPending: 0, approvals: 0, questions: 0, suggestedWork: 0, setupAndBlockers: 0, runtimeIssues: 0 });
}

export function filterAttentionItems(items: AttentionItem[], filter: HumanControlInboxFilter): AttentionItem[] {
  return items.filter((item) =>
    (!filter.type || item.type === filter.type) &&
    (!filter.workerId || item.worker.id === filter.workerId) &&
    (!filter.missionId || item.mission?.id === filter.missionId) &&
    (!filter.severity || item.severity === filter.severity)
  );
}

export class AttentionMutationUncertainError extends Error {
  readonly code = "attention-mutation-uncertain";

  constructor(message = "OpenClaw did not confirm whether this action was applied.") {
    super(message);
    this.name = "AttentionMutationUncertainError";
  }
}

export async function resolveAttentionItem(
  itemId: string,
  action: "approve" | "deny" | "answer" | "accept" | "dismiss",
  payload: { answers?: { answers: Record<string, string[]> }; mode?: "worktree" | "local" | "cloud" | "session"; cloudProfileId?: string } = {},
  adapter: OpenClawAdapter = getOpenClawAdapter(),
  commandOptions: OpenClawCommandOptions = {}
) {
  const parsed = parseAttentionId(itemId);
  if (!parsed) throw new Error("Unknown Human Control item.");
  if (parsed.kind === "suggestion") {
    if (action === "accept") {
      if (!adapter.acceptTaskSuggestion) throw new Error("Suggested Work acceptance is unavailable.");
      return adapter.acceptTaskSuggestion({ taskId: parsed.nativeId, mode: payload.mode, cloudProfileId: payload.cloudProfileId }, { ...commandOptions, timeoutMs: 12_000 });
    }
    if (action === "dismiss") {
      if (!adapter.dismissTaskSuggestion) throw new Error("Suggested Work dismissal is unavailable.");
      return adapter.dismissTaskSuggestion({ taskId: parsed.nativeId }, { ...commandOptions, timeoutMs: 8_000 });
    }
    throw new Error("This Suggested Work action is not supported.");
  }
  if (parsed.kind === "question") {
    if (action !== "answer" || !payload.answers || !adapter.listQuestions || !adapter.resolveQuestion) {
      throw new Error("A structured answer is required for this question.");
    }
    const before = await adapter.listQuestions({ ...commandOptions, timeoutMs: 8_000 });
    if (!before.questions.some((question) => question.id === parsed.nativeId && question.status === "pending")) {
      return { reconciled: true, status: "resolved" };
    }
    try {
      return await adapter.resolveQuestion({ id: parsed.nativeId, answers: payload.answers }, { ...commandOptions, timeoutMs: 8_000 });
    } catch (error) {
      const reconciled = await reconcilePendingQuestion(adapter, parsed.nativeId, error, commandOptions);
      if (reconciled) return { reconciled: true, status: "resolved" };
      throw error;
    }
  }
  if (parsed.kind === "exec" || parsed.kind === "plugin") {
    const decision = action === "deny" ? "deny" : action === "approve" ? "allow-once" : null;
    if (!decision) throw new Error("This approval action is not supported.");
    const list = parsed.kind === "exec" ? adapter.listNativeExecApprovals : adapter.listNativePluginApprovals;
    if (!list) throw new Error("Native approval actions are unavailable.");
    const before = await list({}, { ...commandOptions, timeoutMs: 8_000 });
    if (!readApprovalRecords({ status: "fulfilled", value: before }).some((approval) => approval.id === parsed.nativeId)) {
      return { reconciled: true, status: "resolved" };
    }
    try {
      if (parsed.kind === "exec") {
        if (!adapter.resolveNativeExecApproval) throw new Error("Native exec approval resolution is unavailable.");
        return await adapter.resolveNativeExecApproval({ approvalId: parsed.nativeId, decision }, { ...commandOptions, timeoutMs: 8_000 });
      }
      if (!adapter.resolveNativePluginApproval) throw new Error("Native plugin approval resolution is unavailable.");
      return await adapter.resolveNativePluginApproval({ approvalId: parsed.nativeId, decision }, { ...commandOptions, timeoutMs: 8_000 });
    } catch (error) {
      const reconciled = await reconcilePendingApproval(list, parsed.nativeId, error, commandOptions);
      if (reconciled) return { reconciled: true, status: "resolved" };
      throw error;
    }
  }
  throw new Error("This Human Control item cannot be resolved directly.");
}

export function parseAttentionId(itemId: string) {
  if (itemId.startsWith("approval:exec:")) return { kind: "exec", nativeId: itemId.slice("approval:exec:".length) } as const;
  if (itemId.startsWith("approval:plugin:")) return { kind: "plugin", nativeId: itemId.slice("approval:plugin:".length) } as const;
  if (itemId.startsWith("question:")) return { kind: "question", nativeId: itemId.slice("question:".length) } as const;
  if (itemId.startsWith("suggestion:")) return { kind: "suggestion", nativeId: itemId.slice("suggestion:".length) } as const;
  return null;
}

async function reconcilePendingApproval(
  list: (input?: Record<string, unknown>, options?: { timeoutMs?: number }) => Promise<OpenClawExecApprovalListPayload | OpenClawGatewaySurfacePayload>,
  id: string,
  error: unknown,
  commandOptions: OpenClawCommandOptions
) {
  if (!isAmbiguousMutationError(error)) throw error;
  try {
    const result = await list({}, { ...commandOptions, timeoutMs: 8_000 });
    if (!readApprovalRecords({ status: "fulfilled", value: result }).some((approval) => approval.id === id)) return true;
  } catch {
    throw new AttentionMutationUncertainError();
  }
  throw new AttentionMutationUncertainError();
}

async function reconcilePendingQuestion(adapter: OpenClawAdapter, id: string, error: unknown, commandOptions: OpenClawCommandOptions) {
  if (!isAmbiguousMutationError(error)) throw error;
  try {
    const result = await adapter.listQuestions?.({ ...commandOptions, timeoutMs: 8_000 });
    if (result && !result.questions.some((question) => question.id === id && question.status === "pending")) return true;
  } catch {
    throw new AttentionMutationUncertainError();
  }
  throw new AttentionMutationUncertainError();
}

function readApprovalRecords(result: PromiseSettledResult<OpenClawExecApprovalListPayload | OpenClawGatewaySurfacePayload>): NativeApprovalRecord[] {
  if (result.status !== "fulfilled" || !result.value || typeof result.value !== "object") return [];
  const value = result.value as Record<string, unknown>;
  const candidates = Array.isArray(value.approvals) ? value.approvals : Array.isArray(value.pending) ? value.pending : [];
  return candidates.filter((candidate): candidate is NativeApprovalRecord => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
    const record = candidate as Record<string, unknown>;
    return typeof record.id === "string";
  }).map((candidate) => {
    const record = candidate as Record<string, unknown>;
    return {
      id: record.id as string,
      ...(record.approvalKind === "exec" || record.approvalKind === "plugin" ? { approvalKind: record.approvalKind } : {}),
      ...(isRecord(record.request) ? { request: record.request } : {}),
      ...(typeof record.createdAtMs === "number" ? { createdAtMs: record.createdAtMs } : {}),
      ...(typeof record.expiresAtMs === "number" ? { expiresAtMs: record.expiresAtMs } : {})
    };
  });
}

function readQuestionRecords(result: PromiseSettledResult<OpenClawQuestionListPayload> | undefined): QuestionRecord[] {
  return result?.status === "fulfilled" && Array.isArray(result.value.questions) ? result.value.questions : [];
}

function resolveWorkerLabel(agentId: string | null | undefined, agents: OpenClawAgent[]) {
  return agentId ? agents.find((agent) => agent.id === agentId)?.name ?? null : null;
}

function projectTaskMission(task: TaskRecord) {
  return {
    id: task.dispatchId ?? `task:${task.id}`,
    title: task.mission ?? task.title ?? null
  };
}

function findTaskForSession(tasks: TaskRecord[], sessionKey: string | null) {
  return sessionKey
    ? tasks.find((task) =>
        task.key === sessionKey ||
        task.sessionIds.includes(sessionKey) ||
        resolveTaskSessionKeyForAttention(task) === sessionKey
      )
    : undefined;
}

function findTaskForRuntimeIssue(tasks: TaskRecord[], requestId: string | undefined) {
  const normalizedRequestId = requestId?.trim();
  if (!normalizedRequestId) return undefined;

  return tasks.find((task) =>
    task.id === normalizedRequestId ||
    task.dispatchId === normalizedRequestId ||
    task.runtimeIds.includes(normalizedRequestId) ||
    task.runIds.includes(normalizedRequestId) ||
    task.metadata.openClawTaskId === normalizedRequestId
  );
}

export function resolveTaskSessionKeyForAttention(task: TaskRecord) {
  const metadataKeys = [
    task.metadata.openClawSessionKey,
    task.metadata.continuationSessionKey,
    task.metadata.sessionKey,
    task.metadata.gatewaySessionKey
  ];
  const metadataSessionKey = metadataKeys.find((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (metadataSessionKey) return metadataSessionKey.trim();

  const taskKey = task.key.trim();
  return taskKey.startsWith("agent:") ? taskKey : null;
}

type CapabilityCandidateContext = {
  workerId: string;
  workerLabel: string | null;
  sessionKey: string | null;
  taskId: string | null;
  toolIds: string[];
  sourceKinds: string[];
};

function collectCapabilityCandidateContexts(snapshot: MissionControlSnapshot, nativeItems: AttentionItem[]) {
  const contexts = new Map<string, CapabilityCandidateContext>();
  const agentLabels = new Map(snapshot.agents.map((agent) => [agent.id, agent.name]));

  const addContext = (input: {
    workerId?: string | null;
    workerLabel?: string | null;
    sessionKey?: string | null;
    taskId?: string | null;
    toolIds?: string[];
    sourceKinds?: string[];
  }) => {
    const workerId = input.workerId?.trim();
    if (!workerId) return;

    const sessionKey = input.sessionKey?.trim() || null;
    const taskId = input.taskId?.trim() || null;
    const identity = `${workerId}:${sessionKey ?? `task:${taskId ?? "active"}`}`;
    const current = contexts.get(identity);
    if (current) {
      current.workerLabel ||= input.workerLabel?.trim() || agentLabels.get(workerId) || null;
      current.toolIds = uniqueToolIdentities([...current.toolIds, ...(input.toolIds ?? [])]);
      current.sourceKinds = uniqueStrings([...current.sourceKinds, ...(input.sourceKinds ?? [])]);
      return;
    }

    contexts.set(identity, {
      workerId,
      workerLabel: input.workerLabel?.trim() || agentLabels.get(workerId) || null,
      sessionKey,
      taskId,
      toolIds: uniqueToolIdentities(input.toolIds ?? []),
      sourceKinds: uniqueStrings(input.sourceKinds ?? [])
    });
  };

  const runtimes = Array.isArray(snapshot.runtimes) ? snapshot.runtimes : [];
  const runtimesById = new Map(runtimes.map((runtime) => [runtime.id, runtime]));

  for (const task of snapshot.tasks) {
    if (task.status !== "running" && task.status !== "queued" && task.status !== "stalled") continue;
    const taskRuntimes = runtimes.filter((runtime) =>
      task.runtimeIds.includes(runtime.id) ||
      runtime.taskId === task.id ||
      runtime.metadata.taskId === task.id
    );
    const runtimeToolIds = [
      ...taskRuntimes.flatMap((runtime) => runtime.toolNames ?? []),
      ...(task.primaryRuntimeId ? runtimesById.get(task.primaryRuntimeId)?.toolNames ?? [] : [])
    ];
    addContext({
      workerId: task.primaryAgentId ?? task.agentIds[0] ?? null,
      workerLabel: task.primaryAgentName,
      sessionKey: resolveTaskSessionKeyForAttention(task),
      taskId: task.id,
      toolIds: runtimeToolIds,
      sourceKinds: ["task", ...taskRuntimes.map((runtime) => runtime.metadata.event).filter((event): event is string => typeof event === "string")]
    });
  }

  for (const item of nativeItems) {
    if (item.type !== "approval" && item.type !== "question" && item.type !== "suggested-work" && item.type !== "runtime-issue") continue;
    addContext({
      workerId: item.worker.id,
      workerLabel: item.worker.label,
      sessionKey: item.source.sessionKey,
      taskId: item.source.taskId,
      toolIds: item.evidence?.toolId ? [item.evidence.toolId] : [],
      sourceKinds: [item.source.kind]
    });
  }

  return [...contexts.values()];
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  const workerCount = Math.min(Math.max(1, Math.floor(concurrency)), items.length);
  let nextIndex = 0;

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index]);
    }
  }));

  return results;
}

function hasSharedWorkIdentity(left: AttentionItem, right: AttentionItem) {
  if (
    left.source.system === right.source.system &&
    left.source.kind === right.source.kind &&
    left.source.nativeId &&
    left.source.nativeId === right.source.nativeId
  ) {
    return true;
  }

  if (left.source.sessionKey && left.source.sessionKey === right.source.sessionKey) {
    return true;
  }

  return Boolean(left.source.taskId && left.source.taskId === right.source.taskId);
}

function hasSharedToolIdentity(left: AttentionItem, right: AttentionItem) {
  return Boolean(left.evidence?.toolId && right.evidence?.toolId && left.evidence.toolId === right.evidence.toolId);
}

function normalizeToolIdentity(value: string) {
  return value.trim().toLowerCase();
}

function uniqueToolIdentities(values: string[]) {
  return [...new Set(values.map(normalizeToolIdentity).filter(Boolean))];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function isBlockingTask(task: TaskRecord) {
  return task.status === "stalled";
}

function severityRank(value: AttentionSeverity) {
  return value === "critical" ? 4 : value === "high" ? 3 : value === "normal" ? 2 : 1;
}

function toIso(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value).toISOString() : null;
}

function truncate(value: string, max: number) {
  const normalized = value.trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1).trim()}…`;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(readString).filter((entry): entry is string => Boolean(entry)) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function settle<T>(promise: Promise<T> | undefined): Promise<PromiseSettledResult<T>> {
  if (!promise) return { status: "rejected", reason: new Error("Native method is unavailable.") };
  try {
    return { status: "fulfilled", value: await promise };
  } catch (reason) {
    return { status: "rejected", reason };
  }
}

function isAmbiguousMutationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|connection|unreachable|socket|aborted|interrupted|closed/i.test(message);
}
