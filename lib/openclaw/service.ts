import "server-only";

import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { createFallbackSnapshot } from "@/lib/openclaw/fallback";
import {
  DEFAULT_AGENT_PRESET,
  formatAgentPresetLabel,
  getAgentPresetMeta,
  inferAgentPresetFromContext,
  isAgentFileAccess,
  isAgentInstallScope,
  isAgentMissingToolBehavior,
  isAgentNetworkAccess,
  isAgentPreset,
  resolveAgentPolicy
} from "@/lib/openclaw/agent-presets";
import {
  resolveHeartbeatDraft,
  serializeHeartbeatConfig
} from "@/lib/openclaw/agent-heartbeat";
import {
  detectOpenClaw,
  resolveOpenClawBin,
  runOpenClaw,
  runOpenClawJson,
  runOpenClawJsonStream
} from "@/lib/openclaw/cli";
import { isOpenClawSystemReady } from "@/lib/openclaw/readiness";
import {
  buildWorkspaceCreateProgressTemplate,
  createOperationProgressTracker
} from "@/lib/openclaw/operation-progress";
import { matchesMissionRuntime, matchesMissionText } from "@/lib/openclaw/runtime-matching";
import {
  compactMissionText,
  formatAgentDisplayName,
  stripMissionRouting
} from "@/lib/openclaw/presenters";
import {
  DEFAULT_WORKSPACE_RULES,
  buildDefaultWorkspaceAgents,
  buildWorkspaceAgentName,
  getWorkspaceTemplateMeta
} from "@/lib/openclaw/workspace-presets";
import {
  buildWorkspaceContextManifest,
  buildWorkspaceScaffoldDocuments,
  WORKSPACE_CONTEXT_CORE_PATHS,
  WORKSPACE_CONTEXT_OPTIONAL_PATHS,
  normalizeWorkspaceDocOverrides,
  type WorkspaceScaffoldDocumentContext
} from "@/lib/openclaw/workspace-docs";
import type {
  AgentCreateInput,
  AgentDeleteInput,
  AgentHeartbeatInput,
  AgentPolicy,
  AgentStatus,
  OperationProgressSnapshot,
  AgentUpdateInput,
  ModelReadiness,
  MissionControlSnapshot,
  MissionAbortResponse,
  MissionDispatchStatus,
  MissionResponse,
  MissionSubmission,
  ModelRecord,
  OpenClawRuntimeSmokeTest,
  OpenClawAgent,
  PresenceRecord,
  RelationshipRecord,
  TaskDetailRecord,
  TaskIntegrityRecord,
  TaskFeedEvent,
  TaskRecord,
  RuntimeRecord,
  WorkspacePlan,
  RuntimeOutputItem,
  RuntimeOutputRecord,
  RuntimeCreatedFile,
  WorkspaceAgentBlueprintInput,
  WorkspaceCreateResult,
  WorkspaceCreateRules,
  WorkspaceDocOverride,
  WorkspaceDeleteInput,
  WorkspaceCreateInput,
  WorkspaceEditSeed,
  WorkspaceModelProfile,
  WorkspaceChannelSummary,
  WorkspaceSourceMode,
  WorkspaceTeamPreset,
  WorkspaceTemplate,
  WorkspaceUpdateInput,
  WorkspaceProject,
  PlannerChannelType,
  ChannelRegistry,
  ChannelAccountRecord,
  PlannerContextSource,
  WorkspaceChannelGroupAssignment,
  WorkspaceChannelWorkspaceBinding
} from "@/lib/openclaw/types";

const execFileAsync = promisify(execFile);

type GatewayStatusPayload = {
  service?: {
    label?: string;
    loaded?: boolean;
  };
  gateway?: {
    bindMode?: string;
    port?: number;
    probeUrl?: string;
  };
  rpc?: {
    ok?: boolean;
  };
};

type StatusPayload = {
  runtimeVersion?: string;
  version?: string;
  updateChannel?: string;
  overview?: {
    version?: string;
    update?: string;
  };
  update?: {
    root?: string;
    installKind?: string;
    packageManager?: string;
    registry?: {
      latestVersion?: string | null;
      error?: string | null;
    };
  };
  securityAudit?: {
    findings?: Array<{ severity?: string; title?: string; detail?: string }>;
  };
  sessions?: {
    recent?: Array<{
      agentId?: string;
      key?: string;
      sessionId?: string;
      updatedAt?: number;
      age?: number;
      inputTokens?: number;
      outputTokens?: number;
      cacheRead?: number;
      totalTokens?: number;
      model?: string;
    }>;
  };
  agents?: {
    defaultId?: string;
  };
  heartbeat?: {
    agents?: Array<{
      agentId: string;
      enabled?: boolean;
      every?: string | null;
      everyMs?: number | null;
    }>;
  };
};

type AgentPayload = Array<{
  id: string;
  name?: string;
  identityName?: string;
  identityEmoji?: string;
  identitySource?: string;
  workspace: string;
  agentDir: string;
  model?: string;
  bindings?: number;
  isDefault?: boolean;
}>;

type AgentConfigPayload = Array<{
  id: string;
  name?: string;
  workspace: string;
  model?: string;
  heartbeat?: {
    every?: string;
  };
  skills?: string[];
  tools?: {
    fs?: {
      workspaceOnly?: boolean;
    };
  };
  identity?: {
    name?: string;
    emoji?: string;
    theme?: string;
    avatar?: string;
  };
  default?: boolean;
}>;

const GATEWAY_REMOTE_URL_CONFIG_KEY = "gateway.remote.url";
const missionControlRootPath = path.join(process.cwd(), ".mission-control");
const missionControlSettingsPath = path.join(missionControlRootPath, "settings.json");
const channelRegistryPath = path.join(missionControlRootPath, "channel-registry.json");
const missionDispatchesRootPath = path.join(missionControlRootPath, "dispatches");
const missionDispatchRunnerPath = path.join(process.cwd(), "scripts", "openclaw-mission-dispatch-runner.mjs");
const openClawStateRootPath = path.join(os.homedir(), ".openclaw");
const runtimeSmokeTestTtlMs = 12 * 60 * 60 * 1000;
const runtimeSmokeTestMessage = "Mission Control runtime smoke test. Reply with a brief READY status.";
const missionDispatchQueuedStallMs = 30_000;
const missionDispatchHeartbeatStallMs = 90_000;
const missionDispatchRetentionMs = 3 * 24 * 60 * 60 * 1000;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
type MutableAgentConfigEntry = AgentConfigPayload[number] & Record<string, unknown>;
type RuntimeSmokeTestCacheEntry = {
  status: "passed" | "failed";
  checkedAt: string;
  runId?: string;
  summary?: string;
  error?: string;
};
type MissionControlSettings = {
  workspaceRoot?: string;
  runtimePreflight?: {
    smokeTests?: Record<string, RuntimeSmokeTestCacheEntry>;
  };
};
type MissionDispatchPayload = {
  agentId: string;
  mission: string;
  routedMission: string;
  thinking: NonNullable<MissionSubmission["thinking"]>;
  workspaceId: string | null;
  workspacePath: string | null;
  outputDir: string | null;
  outputDirRelative: string | null;
  notesDirRelative: string | null;
};
type MissionDispatchObservation = {
  runtimeId: string | null;
  observedAt: string | null;
};
type MissionDispatchRecord = {
  id: string;
  status: MissionDispatchStatus;
  agentId: string;
  sessionId: string | null;
  mission: string;
  routedMission: string;
  thinking: NonNullable<MissionSubmission["thinking"]>;
  workspaceId: string | null;
  workspacePath: string | null;
  submittedAt: string;
  updatedAt: string;
  outputDir: string | null;
  outputDirRelative: string | null;
  notesDirRelative: string | null;
  runner: {
    pid: number | null;
    childPid: number | null;
    startedAt: string | null;
    finishedAt: string | null;
    lastHeartbeatAt: string | null;
  };
  observation: MissionDispatchObservation;
  result: MissionCommandPayload | null;
  error: string | null;
};

type WorkspaceCreateOptions = {
  onProgress?: (snapshot: OperationProgressSnapshot) => Promise<void> | void;
};

type KickoffProgressHandler = (update: {
  message: string;
  percent: number;
}) => Promise<void> | void;

type ModelsPayload = {
  models: Array<{
    key: string;
    name: string;
    input: string;
    contextWindow: number | null;
    local: boolean | null;
    available: boolean | null;
    tags: string[];
    missing: boolean;
  }>;
};

type ModelsStatusPayload = {
  defaultModel?: string | null;
  resolvedDefault?: string | null;
  auth?: {
    providers?: Array<{
      provider?: string;
      effective?: {
        kind?: string;
        detail?: string;
      };
      profiles?: {
        count?: number;
      };
    }>;
    missingProvidersInUse?: string[];
    unusableProfiles?: unknown[];
    oauth?: {
      providers?: Array<{
        provider?: string;
        status?: string;
      }>;
    };
  };
};

type SessionsPayload = {
  sessions: Array<{
    agentId?: string;
    key?: string;
    sessionId?: string;
    updatedAt?: number;
    ageMs?: number;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    model?: string;
    modelProvider?: string;
    cacheRead?: number;
    kind?: string;
  }>;
};

type PresencePayload = Array<{
  host: string;
  ip: string;
  version: string;
  platform: string;
  deviceFamily?: string;
  mode: string;
  reason: string;
  text: string;
  ts: number;
}>;

type MissionCommandPayload = {
  runId: string;
  status: string;
  summary: string;
  result?: {
    payloads?: Array<{
      text: string;
      mediaUrl: string | null;
    }>;
    meta?: Record<string, unknown>;
  };
};

type AgentBootstrapProfile = OpenClawAgent["profile"];
type WorkspaceProjectManifestAgent = {
  id: string;
  name: string | null;
  role: string | null;
  isPrimary: boolean;
  skillId: string | null;
  toolIds: string[];
  modelId: string | null;
  enabled: boolean;
  policy: AgentPolicy | null;
  emoji: string | null;
  theme: string | null;
  channelIds: string[];
};
type WorkspaceProjectManifest = {
  name: string | null;
  directory: string | null;
  template: WorkspaceTemplate | null;
  sourceMode: WorkspaceSourceMode | null;
  agentTemplate: string | null;
  teamPreset: WorkspaceTeamPreset | null;
  modelProfile: WorkspaceModelProfile | null;
  rules: WorkspaceCreateRules | null;
  hidden: boolean;
  systemTag: string | null;
  agents: WorkspaceProjectManifestAgent[];
  channels: WorkspaceChannelSummary[];
};
type SessionTranscriptEntry = {
  type?: string;
  id?: string;
  parentId?: string | null;
  timestamp?: string;
  cwd?: string;
  customType?: string;
  data?: {
    timestamp?: number;
    runId?: string;
    sessionId?: string;
    error?: string;
  };
  message?: {
    role?: "assistant" | "toolResult" | "user";
    content?: Array<{
      type?: string;
      text?: string;
      thinking?: string;
      id?: string;
      name?: string;
      arguments?: Record<string, unknown>;
    }>;
    stopReason?: string;
    errorMessage?: string;
    toolCallId?: string;
    toolName?: string;
    isError?: boolean;
    details?: {
      status?: string;
      exitCode?: number;
      durationMs?: number;
      aggregated?: string;
      cwd?: string;
    };
    usage?: {
      input?: number;
      output?: number;
      totalTokens?: number;
      cacheRead?: number;
    };
  };
};

type TranscriptTurn = {
  id: string;
  prompt: string;
  sessionId?: string;
  runId?: string;
  timestamp: string;
  updatedAt: string;
  items: RuntimeOutputItem[];
  status: RuntimeRecord["status"];
  finalText: string | null;
  finalTimestamp: string | null;
  stopReason: string | null;
  errorMessage: string | null;
  tokenUsage?: RuntimeRecord["tokenUsage"];
  createdFiles: RuntimeCreatedFile[];
  warnings: string[];
  warningSummary: string | null;
  toolNames: string[];
};

const SNAPSHOT_CACHE_TTL_MS = 10_000;
const GATEWAY_STATUS_STALE_GRACE_MS = 60_000;

type SnapshotPair = {
  visible: MissionControlSnapshot;
  full: MissionControlSnapshot;
};

type SnapshotCacheEntry = SnapshotPair & {
  expiresAt: number;
};

type GatewayStatusCacheEntry = {
  value: GatewayStatusPayload;
  capturedAt: number;
};

let snapshotCache: SnapshotCacheEntry | null = null;
let snapshotPromise: Promise<SnapshotPair> | null = null;
let gatewayStatusCache: GatewayStatusCacheEntry | null = null;
let runtimeHistoryCache = new Map<string, RuntimeRecord>();

export function clearMissionControlCaches() {
  snapshotCache = null;
  gatewayStatusCache = null;
  runtimeHistoryCache = new Map();
}

function resolveGatewayStatus(
  result: PromiseSettledResult<GatewayStatusPayload>
): {
  value: GatewayStatusPayload | undefined;
  reusedCachedValue: boolean;
} {
  if (result.status === "fulfilled") {
    gatewayStatusCache = {
      value: result.value,
      capturedAt: Date.now()
    };

    return {
      value: result.value,
      reusedCachedValue: false
    };
  }

  if (gatewayStatusCache && Date.now() - gatewayStatusCache.capturedAt <= GATEWAY_STATUS_STALE_GRACE_MS) {
    return {
      value: gatewayStatusCache.value,
      reusedCachedValue: true
    };
  }

  return {
    value: undefined,
    reusedCachedValue: false
  };
}

export async function getMissionControlSnapshot(options: { force?: boolean; includeHidden?: boolean } = {}) {
  if (!options.force && snapshotCache && snapshotCache.expiresAt > Date.now()) {
    return options.includeHidden ? snapshotCache.full : snapshotCache.visible;
  }

  if (snapshotPromise) {
    const pending = await snapshotPromise;
    return options.includeHidden ? pending.full : pending.visible;
  }

  snapshotPromise = loadMissionControlSnapshots();

  try {
    const nextSnapshot = await snapshotPromise;

    snapshotCache = {
      ...nextSnapshot,
      expiresAt: Date.now() + SNAPSHOT_CACHE_TTL_MS
    };

    return options.includeHidden ? nextSnapshot.full : nextSnapshot.visible;
  } finally {
    snapshotPromise = null;
  }
}

async function loadMissionControlSnapshots(): Promise<SnapshotPair> {
  const openclawInstalled = await detectOpenClaw();

  if (!openclawInstalled) {
    return createSnapshotPair(createFallbackSnapshot("OpenClaw CLI is not installed on this machine."));
  }

  try {
    const settings = await readMissionControlSettings();
    const configuredWorkspaceRoot = normalizeConfiguredWorkspaceRootValue(settings.workspaceRoot) ?? null;
    const [
      gatewayStatusResult,
      gatewayRemoteUrlResult,
      statusResult,
      agentsResult,
      agentConfigResult,
      modelsResult,
      modelStatusResult,
      sessionsResult,
      presenceResult
    ] = await Promise.allSettled([
      runOpenClawJson<GatewayStatusPayload>(["gateway", "status", "--json"]),
      runOpenClawJson<string>(["config", "get", GATEWAY_REMOTE_URL_CONFIG_KEY, "--json"]),
      runOpenClawJson<StatusPayload>(["status", "--json"]),
      runOpenClawJson<AgentPayload>(["agents", "list", "--json"]),
      runOpenClawJson<AgentConfigPayload>(["config", "get", "agents.list", "--json"]),
      runOpenClawJson<ModelsPayload>(["models", "list", "--json"]),
      runOpenClawJson<ModelsStatusPayload>(["models", "status", "--json"]),
      runOpenClawJson<SessionsPayload>(["sessions", "--all-agents", "--json"]),
      runOpenClawJson<PresencePayload>(["gateway", "call", "system-presence", "--json"])
    ]);

    const resolvedGatewayStatus = resolveGatewayStatus(gatewayStatusResult);
    const gatewayStatus = resolvedGatewayStatus.value;
    const configuredGatewayUrl =
      gatewayRemoteUrlResult.status === "fulfilled"
        ? normalizeOptionalValue(gatewayRemoteUrlResult.value)
        : undefined;
    const status = statusResult.status === "fulfilled" ? statusResult.value : undefined;
    const agentsList = agentsResult.status === "fulfilled" ? agentsResult.value : [];
    const agentConfig = agentConfigResult.status === "fulfilled" ? agentConfigResult.value : [];
    const models = modelsResult.status === "fulfilled" ? modelsResult.value.models : [];
    const modelStatus = modelStatusResult.status === "fulfilled" ? modelStatusResult.value : undefined;
    const sessions = sessionsResult.status === "fulfilled" ? sessionsResult.value.sessions : [];
    const presence = presenceResult.status === "fulfilled" ? presenceResult.value : [];
    const hasOpenClawSignal =
      statusResult.status === "fulfilled" ||
      agentsResult.status === "fulfilled" ||
      agentConfigResult.status === "fulfilled" ||
      modelsResult.status === "fulfilled" ||
      modelStatusResult.status === "fulfilled" ||
      sessionsResult.status === "fulfilled" ||
      presenceResult.status === "fulfilled";
    const runtimeDiagnostics = await buildRuntimeDiagnostics(
      agentsList.map((agent) => agent.id),
      settings
    );
    const channelRegistry = await readChannelRegistry();
    const channelAccounts = applyChannelAccountDisplayNames(await readChannelAccounts(), channelRegistry);

    const workspaceByPath = new Map<string, WorkspaceProject>();
    const profileByAgent = new Map<string, AgentBootstrapProfile>();
    const manifestByWorkspace = new Map<string, WorkspaceProjectManifest>();
    const agents: OpenClawAgent[] = [];
    const relationships: RelationshipRecord[] = [];

    const heartbeatByAgent = new Map(
      (status?.heartbeat?.agents ?? []).map((entry) => [entry.agentId, entry])
    );
    const configByAgent = new Map(agentConfig.map((entry) => [entry.id, entry]));
    const recentSessionsByAgent = new Map<string, SessionsPayload["sessions"]>();

    for (const session of sessions) {
      if (!session.agentId) {
        continue;
      }

      const list = recentSessionsByAgent.get(session.agentId) ?? [];
      list.push(session);
      recentSessionsByAgent.set(session.agentId, list);
    }

    const liveSessionRuntimes = (
      await Promise.all(
        sessions.map((session) => mapSessionToRuntimes(session, agentConfig, agentsList))
      )
    ).flat();
    const annotatedLiveSessionRuntimes = await annotateMissionDispatchMetadata(liveSessionRuntimes);
    const baseRuntimes = mergeRuntimeHistory(annotatedLiveSessionRuntimes);
    const dispatchRuntimes = await buildMissionDispatchRuntimes(baseRuntimes);
    const runtimes = mergeRuntimeHistory([...dispatchRuntimes, ...annotatedLiveSessionRuntimes]);

    for (const rawAgent of agentsList) {
      const configured = configByAgent.get(rawAgent.id);
      const identityOverrides = await readAgentIdentityOverrides(rawAgent.agentDir);
      const workspaceId = workspaceIdFromPath(rawAgent.workspace);
      const sessionList = recentSessionsByAgent.get(rawAgent.id) ?? [];
      const manifest =
        manifestByWorkspace.get(rawAgent.workspace) ??
        (await readWorkspaceProjectManifest(rawAgent.workspace));
      manifestByWorkspace.set(rawAgent.workspace, manifest);
      const manifestAgent = manifest.agents.find((entry) => entry.id === rawAgent.id) ?? null;
      const configuredSkills = filterAgentPolicySkills(configured?.skills ?? []);
      const policy =
        manifestAgent?.policy ??
        resolveAgentPolicy(
          inferAgentPresetFromContext({
            skills: configuredSkills,
            id: rawAgent.id,
            name:
              normalizeOptionalValue(identityOverrides.name) ||
              configured?.name ||
              rawAgent.name ||
              configured?.identity?.name ||
              rawAgent.identityName ||
              rawAgent.id
          }),
          {
            fileAccess: configured?.tools?.fs?.workspaceOnly ? "workspace-only" : "extended"
          }
        );
      const configuredTools = uniqueStrings([
        ...(manifestAgent?.toolIds ?? []),
        ...(policy.fileAccess === "workspace-only" ? ["fs.workspaceOnly"] : [])
      ]);
      const primaryModel = rawAgent.model || configured?.model || "unassigned";
      const profileKey = rawAgent.agentDir || rawAgent.id;
      const profile =
        profileByAgent.get(profileKey) ??
        (await readAgentBootstrapProfile(rawAgent.workspace, {
          agentId: rawAgent.id,
          agentName:
            normalizeOptionalValue(identityOverrides.name) ||
            configured?.name ||
            rawAgent.name ||
            configured?.identity?.name ||
          rawAgent.identityName ||
          rawAgent.id,
          agentDir: rawAgent.agentDir,
          configuredSkills,
          configuredTools,
          template: manifest.template,
          rules: manifest.rules ?? DEFAULT_WORKSPACE_RULES
        }));
      profileByAgent.set(profileKey, profile);
      const agentRuntimes = runtimes
        .filter((runtime) => runtime.agentId === rawAgent.id)
        .sort(sortRuntimesByUpdatedAtDesc);
      const observedToolNames = uniqueStrings(agentRuntimes.flatMap((runtime) => runtime.toolNames ?? []));
      const activeRuntimeIds = agentRuntimes.map((runtime) => runtime.id);
      const latestRuntime = agentRuntimes[0];
      const lastActiveAt =
        sessionList
          .map((entry) => entry.updatedAt ?? 0)
          .sort((left, right) => right - left)
          .at(0) || null;
      const heartbeat = heartbeatByAgent.get(rawAgent.id);
      const statusValue = resolveAgentStatus({
        rpcOk: Boolean(gatewayStatus?.rpc?.ok),
        activeRuntime: latestRuntime,
        heartbeatEnabled: Boolean(heartbeat?.enabled),
        lastActiveAt
      });

      const workspace = ensureWorkspace(workspaceByPath, rawAgent.workspace);
      workspace.agentIds.push(rawAgent.id);
      workspace.modelIds.push(primaryModel);
      workspace.activeRuntimeIds.push(...activeRuntimeIds);
      workspace.totalSessions += sessionList.length;

      const agent: OpenClawAgent = {
        id: rawAgent.id,
        name:
          normalizeOptionalValue(identityOverrides.name) ||
          configured?.name ||
          rawAgent.name ||
          configured?.identity?.name ||
          rawAgent.identityName ||
          rawAgent.id,
        identityName:
          normalizeOptionalValue(identityOverrides.name) ||
          configured?.identity?.name ||
          rawAgent.identityName ||
          undefined,
        workspaceId,
        workspacePath: rawAgent.workspace,
        agentDir: rawAgent.agentDir,
        modelId: primaryModel,
        isDefault: Boolean(rawAgent.isDefault || configured?.default),
        status: statusValue,
        sessionCount: sessionList.length,
        lastActiveAt,
        currentAction: resolveAgentAction({
          runtime: latestRuntime,
          heartbeatEvery: heartbeat?.every ?? null,
          status: statusValue
        }),
        activeRuntimeIds,
        heartbeat: {
          enabled: Boolean(heartbeat?.enabled),
          every: heartbeat?.every ?? null,
          everyMs: heartbeat?.everyMs ?? null
        },
        identity: {
          emoji:
            normalizeOptionalValue(identityOverrides.emoji) ||
            configured?.identity?.emoji ||
            rawAgent.identityEmoji,
          theme: configured?.identity?.theme,
          avatar: normalizeOptionalValue(identityOverrides.avatar) || configured?.identity?.avatar,
          source: rawAgent.identitySource
        },
        profile,
        skills: configuredSkills,
        tools: configuredTools,
        observedTools: observedToolNames,
        policy
      };

      agents.push(agent);
      relationships.push({
        id: `edge:${workspaceId}:${agent.id}:contains`,
        sourceId: workspaceId,
        targetId: agent.id,
        kind: "contains",
        label: "workspace member"
      });

      relationships.push({
        id: `edge:${agent.id}:${primaryModel}:model`,
        sourceId: agent.id,
        targetId: primaryModel,
        kind: "uses-model",
        label: "model assignment"
      });

      for (const runtimeId of activeRuntimeIds) {
        relationships.push({
          id: `edge:${agent.id}:${runtimeId}:run`,
          sourceId: agent.id,
          targetId: runtimeId,
          kind: "active-run",
          label: "runtime"
        });
      }
    }

    const agentsByWorkspace = new Map<string, OpenClawAgent[]>();
    for (const agent of agents) {
      const list = agentsByWorkspace.get(agent.workspaceId) ?? [];
      list.push(agent);
      agentsByWorkspace.set(agent.workspaceId, list);
    }

    const workspaces = await Promise.all(
      Array.from(workspaceByPath.values()).map(async (workspace) => {
        const workspaceAgents = agentsByWorkspace.get(workspace.id) ?? [];
        const metadata = await readWorkspaceInspectorMetadata(workspace.path, workspaceAgents);
        const manifest = manifestByWorkspace.get(workspace.path) ?? null;

        return {
          ...workspace,
          name: manifest?.name ?? workspace.name,
          modelIds: unique(workspace.modelIds),
          activeRuntimeIds: unique(workspace.activeRuntimeIds),
          health: resolveWorkspaceHealth(workspace.agentIds, agents),
          bootstrap: metadata.bootstrap,
          capabilities: metadata.capabilities
        };
      })
    );

    const hiddenWorkspaceIds = new Set(
      workspaces
        .filter((workspace) => manifestByWorkspace.get(workspace.path)?.hidden)
        .map((workspace) => workspace.id)
    );
    const visibleAgents = agents.filter((agent) => !hiddenWorkspaceIds.has(agent.workspaceId));
    const hiddenAgentIds = new Set(
      agents
        .filter((agent) => hiddenWorkspaceIds.has(agent.workspaceId))
        .map((agent) => agent.id)
    );
    const visibleRuntimes = runtimes.filter(
      (runtime) =>
        !(runtime.agentId && hiddenAgentIds.has(runtime.agentId)) &&
        !(runtime.workspaceId && hiddenWorkspaceIds.has(runtime.workspaceId))
    );
    const hiddenRuntimeIds = new Set(
      runtimes
        .filter(
          (runtime) =>
            (runtime.agentId && hiddenAgentIds.has(runtime.agentId)) ||
            (runtime.workspaceId && hiddenWorkspaceIds.has(runtime.workspaceId))
        )
        .map((runtime) => runtime.id)
    );
    const hiddenNodeIds = new Set<string>([
      ...hiddenWorkspaceIds,
      ...hiddenAgentIds,
      ...hiddenRuntimeIds
    ]);
    const visibleRelationships = relationships.filter(
      (relationship) =>
        !hiddenNodeIds.has(relationship.sourceId) &&
        !hiddenNodeIds.has(relationship.targetId)
    );
    const visibleWorkspaces = workspaces.filter((workspace) => !hiddenWorkspaceIds.has(workspace.id));

    const mapModels = (sourceAgents: OpenClawAgent[]) => {
      const modelUsage = new Map<string, number>();
      for (const agent of sourceAgents) {
        modelUsage.set(agent.modelId, (modelUsage.get(agent.modelId) ?? 0) + 1);
      }

      return models.map((model) => ({
        id: model.key,
        name: model.name,
        provider: model.key.split("/")[0] || "unknown",
        input: model.input,
        contextWindow: model.contextWindow,
        local: model.local,
        available: model.available,
        missing: model.missing,
        tags: model.tags,
        usageCount: modelUsage.get(model.key) ?? 0
      })) satisfies ModelRecord[];
    };

    const modelReadiness = resolveModelReadiness(models, modelStatus);

    const securityWarnings =
      status?.securityAudit?.findings
        ?.filter((entry) => entry.severity === "warn")
        .map((entry) => entry.title || entry.detail || "Security warning") ?? [];
    const currentVersion = normalizeOptionalValue(
      presence[0]?.version || status?.runtimeVersion || status?.overview?.version || status?.version
    );
    const latestVersion = normalizeOptionalValue(status?.update?.registry?.latestVersion ?? undefined);
    const updateError = normalizeUpdateError(status?.update?.registry?.error ?? undefined);
    const updateAvailable =
      currentVersion && latestVersion ? compareVersionStrings(latestVersion, currentVersion) > 0 : undefined;
    const updateInfo = resolveUpdateInfo({
      currentVersion,
      latestVersion,
      updateError,
      legacyInfo: status?.overview?.update
    });

    const diagnostics = {
      installed: true,
      loaded: Boolean(gatewayStatus?.service?.loaded),
      rpcOk: Boolean(gatewayStatus?.rpc?.ok),
      health: resolveDiagnosticHealth({
        rpcOk: gatewayStatus?.rpc?.ok,
        warningCount: securityWarnings.length,
        runtimeIssueCount: runtimeDiagnostics.issues.length,
        hasOpenClawSignal
      }),
      version: currentVersion,
      latestVersion,
      updateAvailable,
      updateError,
      updateRoot: normalizeOptionalValue(status?.update?.root ?? undefined),
      updateInstallKind: normalizeOptionalValue(status?.update?.installKind ?? undefined),
      updatePackageManager: normalizeOptionalValue(status?.update?.packageManager ?? undefined),
      workspaceRoot: resolveWorkspaceRoot(configuredWorkspaceRoot),
      configuredWorkspaceRoot: configuredWorkspaceRoot ?? null,
      dashboardUrl: `http://127.0.0.1:${gatewayStatus?.gateway?.port ?? 18789}/`,
      gatewayUrl: gatewayStatus?.gateway?.probeUrl || "ws://127.0.0.1:18789",
      configuredGatewayUrl: configuredGatewayUrl ?? null,
      bindMode: gatewayStatus?.gateway?.bindMode,
      port: gatewayStatus?.gateway?.port,
      updateChannel: status?.updateChannel || "stable",
      updateInfo,
      serviceLabel: gatewayStatus?.service?.label,
      modelReadiness,
      runtime: runtimeDiagnostics,
      securityWarnings,
      issues: [
        ...collectIssues({
          gatewayStatus: gatewayStatusResult,
          status: statusResult,
          agents: agentsResult,
          models: modelsResult,
          modelStatus: modelStatusResult,
          sessions: sessionsResult
        }),
        ...(gatewayStatusResult.status === "rejected" && resolvedGatewayStatus.reusedCachedValue
          ? ["gatewayStatus: Reusing the last successful gateway status after a transient OpenClaw check failure."]
          : []),
        ...runtimeDiagnostics.issues
      ]
    } satisfies MissionControlSnapshot["diagnostics"];

    const tasks = buildTaskRecords(runtimes, agents);
    const visibleTasks = buildTaskRecords(visibleRuntimes, visibleAgents);
    const generatedAt = new Date().toISOString();
    const sharedSnapshotFields = {
      generatedAt,
      mode: "live" as const,
      diagnostics,
      channelAccounts,
      channelRegistry,
      presence: presence.map((entry) => ({
        host: entry.host,
        ip: entry.ip,
        version: entry.version,
        platform: entry.platform,
        deviceFamily: entry.deviceFamily,
        mode: entry.mode,
        reason: entry.reason,
        text: entry.text,
        ts: entry.ts
      })) as PresenceRecord[],
      missionPresets: [
        "Audit the selected workspace and generate a concrete first task batch.",
        "Plan a multi-agent delivery mission for the current product goal.",
        "Review active runtimes, identify blockers, and propose the next handoff."
      ]
    };

    return {
      full: {
        ...sharedSnapshotFields,
        workspaces,
        agents,
        models: mapModels(agents),
        runtimes,
        tasks,
        relationships
      },
      visible: {
        ...sharedSnapshotFields,
        workspaces: visibleWorkspaces,
        agents: visibleAgents,
        models: mapModels(visibleAgents),
        runtimes: visibleRuntimes,
        tasks: visibleTasks,
        relationships: visibleRelationships
      }
    };
  } catch (error) {
    return createSnapshotPair(
      createFallbackSnapshot(error instanceof Error ? error.message : "Unknown OpenClaw error.")
    );
  }
}

function createSnapshotPair(snapshot: MissionControlSnapshot): SnapshotPair {
  return {
    visible: snapshot,
    full: snapshot
  };
}

function buildTaskRecords(runtimes: RuntimeRecord[], agents: OpenClawAgent[]): TaskRecord[] {
  const taskRuntimes = runtimes.filter((runtime) => !isDirectChatRuntime(runtime));
  const groups = new Map<string, RuntimeRecord[]>();
  const agentNameById = new Map(agents.map((agent) => [agent.id, formatAgentDisplayName(agent)]));
  const dispatchIdBySessionKey = buildDispatchIdBySessionKey(taskRuntimes);

  for (const runtime of taskRuntimes) {
    const groupKey = resolveTaskGroupKey(runtime, dispatchIdBySessionKey);
    const group = groups.get(groupKey) ?? [];
    group.push(runtime);
    groups.set(groupKey, group);
  }

  return Array.from(groups.entries())
    .map(([groupKey, groupedRuntimes]) =>
      buildTaskRecord(groupKey, groupedRuntimes, agentNameById)
    )
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
}

function buildTaskRecord(
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
  const subtitle =
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
  const warnings = uniqueStrings(
    sortedRuntimes.flatMap((runtime) => extractWarningsFromRuntimeMetadata(runtime))
  );
  const tokenUsage = aggregateRuntimeTokenUsage(sortedRuntimes);
  const agentIds = uniqueStrings(
    sortedRuntimes.flatMap((runtime) => (runtime.agentId ? [runtime.agentId] : []))
  );
  const sessionIds = uniqueStrings(
    sortedRuntimes.flatMap((runtime) => (runtime.sessionId ? [runtime.sessionId] : []))
  );
  const runIds = uniqueStrings(
    sortedRuntimes.flatMap((runtime) => (runtime.runId ? [runtime.runId] : []))
  );
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
    /You are chatting (?:directly )?with the operator inside Mission Control/i.test(text) ||
    /Do not create tasks or mention task cards/i.test(text) ||
    /Messages stay in this drawer and are stored locally in your browser/i.test(text)
  );
}

function buildDispatchIdBySessionKey(runtimes: RuntimeRecord[]) {
  const dispatchIdBySessionKey = new Map<string, string>();

  for (const runtime of runtimes) {
    const sessionId = runtime.sessionId?.trim();
    const dispatchId =
      typeof runtime.metadata.dispatchId === "string" ? runtime.metadata.dispatchId.trim() : "";

    if (!sessionId || !dispatchId) {
      continue;
    }

    // Even when the dispatch runtime is synthetic, it still represents the
    // authoritative dispatch/session pair for that mission. Keep the session
    // pinned to the dispatch so the raw session placeholder does not become a
    // separate task card.
    dispatchIdBySessionKey.set(`${runtime.agentId ?? "unknown"}:${sessionId}`, dispatchId);
  }

  return dispatchIdBySessionKey;
}

function resolveTaskGroupKey(runtime: RuntimeRecord, dispatchIdBySessionKey: Map<string, string>) {
  const taskId = runtime.taskId?.trim();
  const dispatchId =
    typeof runtime.metadata.dispatchId === "string" ? runtime.metadata.dispatchId.trim() : "";
  const mission = resolveRuntimeMissionText(runtime);
  const sessionId = runtime.sessionId?.trim();
  const sessionDispatchId = sessionId
    ? dispatchIdBySessionKey.get(`${runtime.agentId ?? "unknown"}:${sessionId}`)?.trim() ?? ""
    : "";

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

function extractCreatedFilesFromRuntimeMetadata(runtime: RuntimeRecord) {
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

    if (!pathValue) {
      continue;
    }

    createdFiles.push({
      path: pathValue,
      displayPath: pathValue
    });
  }

  return dedupeCreatedFiles(createdFiles);
}

function extractWarningsFromRuntimeMetadata(runtime: RuntimeRecord) {
  const rawWarnings = runtime.metadata.warnings;

  if (!Array.isArray(rawWarnings)) {
    return [];
  }

  return rawWarnings.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function createTaskRecordId(groupKey: string) {
  return `task:${hashTaskKey(groupKey)}`;
}

function hashTaskKey(value: string) {
  return createHash("sha1").update(value).digest("hex").slice(0, 12);
}

function resolveRuntimeSmokeTestAgentId(
  snapshot: MissionControlSnapshot,
  preferredAgentId?: string | null
) {
  if (preferredAgentId && snapshot.agents.some((agent) => agent.id === preferredAgentId)) {
    return preferredAgentId;
  }

  return snapshot.agents.find((agent) => agent.isDefault)?.id || snapshot.agents[0]?.id || null;
}

async function assertOpenClawRuntimeStateAccess(agentId: string | null) {
  const runtimeState = await inspectOpenClawRuntimeState(agentId ? [agentId] : [], {
    touch: true
  });

  if (runtimeState.issues.length > 0) {
    snapshotCache = null;
    throw new Error(
      `OpenClaw runtime state is not writable. AgentOS needs write access to ${runtimeState.stateRoot} and the agent session store before missions can run.`
    );
  }
}

export async function ensureOpenClawRuntimeStateAccess(options: {
  agentId?: string | null;
} = {}) {
  await assertOpenClawRuntimeStateAccess(options.agentId ?? null);
  snapshotCache = null;
  return getMissionControlSnapshot({ force: true, includeHidden: true });
}

export async function ensureOpenClawRuntimeSmokeTest(options: {
  agentId?: string | null;
  force?: boolean;
} = {}): Promise<OpenClawRuntimeSmokeTest> {
  const snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
  const agentId = resolveRuntimeSmokeTestAgentId(snapshot, options.agentId);

  if (!agentId) {
    return {
      status: "not-run",
      checkedAt: null,
      agentId: null,
      runId: null,
      summary: null,
      error: "Mission Control could not find an OpenClaw agent for the runtime smoke test."
    };
  }

  const settings = await readMissionControlSettings();
  const cached = getRuntimeSmokeTestCacheEntry(settings, agentId);

  if (!options.force && isRuntimeSmokeTestFresh(cached)) {
    return mapRuntimeSmokeTestEntry(agentId, cached);
  }

  await assertOpenClawRuntimeStateAccess(agentId);

  try {
    const payload = await runOpenClawJson<MissionCommandPayload>(
      [
        "agent",
        "--agent",
        agentId,
        "--message",
        runtimeSmokeTestMessage,
        "--thinking",
        "off",
        "--timeout",
        "45",
        "--json"
      ],
      { timeoutMs: 50000 }
    );
    const result: OpenClawRuntimeSmokeTest = {
      status: "passed",
      checkedAt: new Date().toISOString(),
      agentId,
      runId: payload.runId,
      summary:
        payload.summary ||
        payload.result?.payloads?.[0]?.text ||
        "Mission Control verified a real OpenClaw turn.",
      error: null
    };

    await persistRuntimeSmokeTest(result);
    snapshotCache = null;
    return result;
  } catch (error) {
    const result: OpenClawRuntimeSmokeTest = {
      status: "failed",
      checkedAt: new Date().toISOString(),
      agentId,
      runId: null,
      summary: null,
      error: stringifyCommandFailure(error) || "OpenClaw runtime smoke test failed."
    };

    await persistRuntimeSmokeTest(result);
    snapshotCache = null;
    return result;
  }
}

function resolveMissionDispatchReadinessError(snapshot: MissionControlSnapshot) {
  if (!isOpenClawSystemReady(snapshot)) {
    return "OpenClaw system setup is incomplete. Verify the CLI, gateway, and runtime state before dispatching missions.";
  }

  if (!snapshot.diagnostics.modelReadiness.ready) {
    return "OpenClaw model setup is incomplete. Configure a usable default model before dispatching missions.";
  }

  return null;
}

export async function submitMission(input: MissionSubmission): Promise<MissionResponse> {
  const mission = input.mission.trim();

  if (!mission) {
    throw new Error("Mission text is required.");
  }

  const snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
  const agentId = input.agentId || resolveAgentForMission(snapshot, input.workspaceId);

  if (!agentId) {
    throw new Error("No OpenClaw agent is available for mission dispatch.");
  }

  const missionAgent = snapshot.agents.find((entry) => entry.id === agentId);
  const missionWorkspace =
    snapshot.workspaces.find((entry) => entry.id === (input.workspaceId || missionAgent?.workspaceId)) ??
    (missionAgent
      ? {
          id: missionAgent.workspaceId,
          path: missionAgent.workspacePath
        }
      : null);
  const workspaceAgents = missionWorkspace
    ? snapshot.agents.filter((entry) => entry.workspaceId === missionWorkspace.id)
    : [];
  const setupAgentId =
    workspaceAgents.find((entry) => entry.policy.preset === "setup" && entry.id !== missionAgent?.id)?.id ?? null;
  const outputPlan = missionWorkspace
    ? await prepareMissionOutputPlan(missionWorkspace.path, mission)
    : null;
  const thinking = input.thinking ?? "medium";
  const routedMission = outputPlan
    ? composeMissionWithOutputRouting(mission, outputPlan, missionAgent?.policy, setupAgentId)
    : mission;
  const readinessError = resolveMissionDispatchReadinessError(snapshot);

  let dispatchRecord = createMissionDispatchRecord({
    agentId,
    mission,
    routedMission,
    thinking,
    workspaceId: missionWorkspace?.id ?? null,
    workspacePath: missionWorkspace?.path ?? null,
    outputDir: outputPlan?.absoluteOutputDir ?? null,
    outputDirRelative: outputPlan?.relativeOutputDir ?? null,
    notesDirRelative: outputPlan?.notesDirRelative ?? null
  });

  await writeMissionDispatchRecord(dispatchRecord);

  if (readinessError) {
    dispatchRecord = {
      ...dispatchRecord,
      status: "stalled",
      updatedAt: new Date().toISOString(),
      error: readinessError
    };
    await writeMissionDispatchRecord(dispatchRecord);
    snapshotCache = null;

    return {
      dispatchId: dispatchRecord.id,
      runId: null,
      agentId,
      status: dispatchRecord.status,
      summary: readinessError,
      payloads: [],
      meta: {
        outputDir: outputPlan?.absoluteOutputDir,
        outputDirRelative: outputPlan?.relativeOutputDir,
        notesDirRelative: outputPlan?.notesDirRelative
      }
    };
  }

  try {
    dispatchRecord = await launchMissionDispatchRunner(dispatchRecord);
  } catch (error) {
    dispatchRecord = {
      ...dispatchRecord,
      status: "stalled",
      updatedAt: new Date().toISOString(),
      error: stringifyCommandFailure(error) || "Mission dispatch runner could not be started."
    };
    await writeMissionDispatchRecord(dispatchRecord);
    snapshotCache = null;
    throw new Error(dispatchRecord.error ?? "Mission dispatch runner could not be started.");
  }

  snapshotCache = null;

  return {
    dispatchId: dispatchRecord.id,
    runId: null,
    agentId,
    status: dispatchRecord.status,
    summary: "Mission accepted and queued for OpenClaw execution.",
    payloads: [],
    meta: {
      outputDir: outputPlan?.absoluteOutputDir,
      outputDirRelative: outputPlan?.relativeOutputDir,
      notesDirRelative: outputPlan?.notesDirRelative
    }
  };
}

export async function abortMissionTask(
  taskId: string,
  reason?: string | null,
  dispatchId?: string | null
): Promise<MissionAbortResponse> {
  const snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
  const task = snapshot.tasks.find((entry) => entry.id === taskId);
  const dispatchRecord = task
    ? await findMissionDispatchRecordForTask(task)
    : dispatchId
      ? await readMissionDispatchRecordById(dispatchId)
      : null;

  if (!task && !dispatchRecord) {
    throw new Error("Task was not found in the current OpenClaw snapshot.");
  }

  if (!dispatchRecord) {
    throw new Error("Mission dispatch record was not found for this task.");
  }

  if (isMissionDispatchTerminalStatus(dispatchRecord.status)) {
    return {
      taskId,
      dispatchId: dispatchRecord.id,
      status: dispatchRecord.status,
      summary: resolveMissionDispatchCompletionDetail(dispatchRecord),
      reason: dispatchRecord.error,
      runnerPid: dispatchRecord.runner.pid,
      childPid: dispatchRecord.runner.childPid,
      abortedAt: dispatchRecord.runner.finishedAt ?? dispatchRecord.updatedAt
    };
  }

  const abortedAt = new Date().toISOString();
  const abortReason = normalizeMissionAbortReason(reason);
  const nextRecord: MissionDispatchRecord = {
    ...dispatchRecord,
    status: "cancelled",
    updatedAt: abortedAt,
    error: abortReason,
    runner: {
      ...dispatchRecord.runner,
      finishedAt: abortedAt,
      lastHeartbeatAt: abortedAt
    }
  };

  await writeMissionDispatchRecord(nextRecord);
  snapshotCache = null;

  const killedChildPid = await stopMissionDispatchChildProcess(nextRecord);

  return {
    taskId,
    dispatchId: nextRecord.id,
    status: nextRecord.status,
    summary: abortReason,
    reason: abortReason,
    runnerPid: nextRecord.runner.pid,
    childPid: killedChildPid ?? nextRecord.runner.childPid,
    abortedAt
  };
}

function createMissionDispatchRecord(payload: MissionDispatchPayload): MissionDispatchRecord {
  const now = new Date().toISOString();

  return {
    id: `dispatch-${randomUUID()}`,
    status: "queued",
    agentId: payload.agentId,
    sessionId: randomUUID(),
    mission: payload.mission,
    routedMission: payload.routedMission,
    thinking: payload.thinking,
    workspaceId: payload.workspaceId,
    workspacePath: payload.workspacePath,
    submittedAt: now,
    updatedAt: now,
    outputDir: payload.outputDir,
    outputDirRelative: payload.outputDirRelative,
    notesDirRelative: payload.notesDirRelative,
    runner: {
      pid: null,
      childPid: null,
      startedAt: null,
      finishedAt: null,
      lastHeartbeatAt: null
    },
    observation: {
      runtimeId: null,
      observedAt: null
    },
    result: null,
    error: null
  };
}

function missionDispatchRecordPath(dispatchId: string) {
  return path.join(missionDispatchesRootPath, `${dispatchId}.json`);
}

async function writeMissionDispatchRecord(record: MissionDispatchRecord) {
  const filePath = missionDispatchRecordPath(record.id);
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(tempPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

async function launchMissionDispatchRunner(record: MissionDispatchRecord) {
  await access(missionDispatchRunnerPath, fsConstants.R_OK);
  const openClawBin = await resolveOpenClawBin();
  const child = spawn(process.execPath, [missionDispatchRunnerPath, missionDispatchRecordPath(record.id)], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      OPENCLAW_BIN: openClawBin
    }
  });

  child.unref();

  return {
    ...record,
    runner: {
      ...record.runner,
      pid: child.pid ?? record.runner.pid
    }
  } satisfies MissionDispatchRecord;
}

async function findMissionDispatchRecordForTask(task: TaskRecord) {
  if (task.dispatchId) {
    const dispatchRecord = await readMissionDispatchRecordById(task.dispatchId);

    if (dispatchRecord) {
      return dispatchRecord;
    }
  }

  const records = await readMissionDispatchRecords();
  const taskRuntimeIds = new Set(task.runtimeIds);
  const taskSessionIds = new Set(task.sessionIds);

  for (const record of records) {
    if (record.agentId !== task.primaryAgentId && !task.agentIds.includes(record.agentId)) {
      continue;
    }

    if (task.mission && record.mission && matchesMissionText(record.mission, task.mission)) {
      return record;
    }

    if (record.observation.runtimeId && taskRuntimeIds.has(record.observation.runtimeId)) {
      return record;
    }

    const sessionId = extractMissionDispatchSessionId(record);
    if (sessionId && taskSessionIds.has(sessionId)) {
      return record;
    }
  }

  return null;
}

function normalizeMissionAbortReason(reason?: string | null) {
  const trimmed = typeof reason === "string" ? reason.trim() : "";
  return trimmed.length > 0 ? trimmed : "Mission aborted by operator.";
}

async function stopMissionDispatchChildProcess(record: MissionDispatchRecord) {
  const childPids = new Set<number>();

  if (typeof record.runner.childPid === "number" && Number.isFinite(record.runner.childPid)) {
    childPids.add(record.runner.childPid);
  }

  if (childPids.size === 0 && typeof record.runner.pid === "number" && Number.isFinite(record.runner.pid)) {
    try {
      const { stdout } = await execFileAsync("pgrep", ["-P", String(record.runner.pid)]);
      for (const line of stdout.split(/\r?\n/)) {
        const pid = Number.parseInt(line.trim(), 10);
        if (Number.isFinite(pid) && pid > 0) {
          childPids.add(pid);
        }
      }
    } catch {
      // The runner heartbeat still terminates the child once the record is cancelled.
    }
  }

  for (const pid of childPids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // The process may already be gone.
    }
  }

  return childPids.values().next().value ?? null;
}

async function buildMissionDispatchRuntimes(currentRuntimes: RuntimeRecord[]) {
  const records = await readMissionDispatchRecords();
  const syntheticRuntimes: RuntimeRecord[] = [];
  const nowMs = Date.now();

  for (const record of records) {
    const matchedRuntime = matchMissionDispatchToRuntime(record, currentRuntimes);

    if (matchedRuntime) {
      await persistMissionDispatchObservation(record, matchedRuntime);
      await reconcileMissionDispatchRuntimeState(record, matchedRuntime);
      continue;
    }

    const observedRuntime = await buildObservedMissionDispatchRuntime(record);

    if (observedRuntime) {
      if (!isMissionDispatchTerminalStatus(record.status)) {
        await reconcileMissionDispatchRuntimeState(record, observedRuntime);
      }

      syntheticRuntimes.push(
        buildMissionDispatchTranscriptRuntime(
          (await readMissionDispatchRecordById(record.id)) ?? record,
          observedRuntime.sessionId ?? extractMissionDispatchSessionId(record) ?? undefined
        )
      );
      continue;
    }

    syntheticRuntimes.push(createMissionDispatchRuntime(record, nowMs));
  }

  return syntheticRuntimes.sort(sortRuntimesByUpdatedAtDesc);
}

async function annotateMissionDispatchMetadata(runtimes: RuntimeRecord[]) {
  if (runtimes.length === 0) {
    return runtimes;
  }

  const records = await readMissionDispatchRecords();

  if (records.length === 0) {
    return runtimes;
  }

  const annotated = [...runtimes];
  const runtimeIndexById = new Map(annotated.map((runtime, index) => [runtime.id, index]));

  for (const record of records) {
    const observedRuntimeId = record.observation.runtimeId?.trim();
    const observedRuntime =
      observedRuntimeId && runtimeIndexById.has(observedRuntimeId)
        ? annotated[runtimeIndexById.get(observedRuntimeId)!]
        : null;
    const matchedRuntime = observedRuntime ?? matchMissionDispatchToRuntime(record, annotated);

    if (!matchedRuntime) {
      continue;
    }

    const runtimeIndex = runtimeIndexById.get(matchedRuntime.id);

    if (typeof runtimeIndex !== "number") {
      continue;
    }

    annotated[runtimeIndex] = annotateRuntimeWithMissionDispatch(matchedRuntime, record);
  }

  return annotated;
}

async function persistMissionDispatchObservation(record: MissionDispatchRecord, runtime: RuntimeRecord) {
  const observedAt = timestampFromUnix(runtime.updatedAt);

  if (record.observation.runtimeId === runtime.id && record.observation.observedAt === observedAt) {
    return;
  }

  const latestRecord = (await readMissionDispatchRecordById(record.id)) ?? record;

  if (latestRecord.observation.runtimeId === runtime.id && latestRecord.observation.observedAt === observedAt) {
    return;
  }

  await writeMissionDispatchRecord({
    ...latestRecord,
    updatedAt: maxIsoTimestamp(latestRecord.updatedAt, observedAt),
    observation: {
      runtimeId: runtime.id,
      observedAt
    }
  });
}

async function reconcileMissionDispatchRuntimeState(record: MissionDispatchRecord, runtime: RuntimeRecord) {
  if (isMissionDispatchTerminalStatus(record.status)) {
    return;
  }

  if (!runtime.agentId || !runtime.sessionId) {
    return;
  }

  const transcriptPath = await resolveRuntimeTranscriptPath(runtime.agentId, runtime.sessionId, record.workspacePath ?? undefined);

  if (!transcriptPath) {
    return;
  }

  let raw = "";
  try {
    raw = await readFile(transcriptPath, "utf8");
  } catch {
    return;
  }

  const output = parseRuntimeOutput(runtime, raw, record.workspacePath ?? undefined);
  const finalizedFromTranscript = Boolean(output.finalTimestamp && output.stopReason && output.stopReason !== "toolUse");
  const stalledFromTranscript =
    Boolean(output.errorMessage) || output.stopReason === "error" || output.stopReason === "aborted";

  if (!finalizedFromTranscript && !stalledFromTranscript) {
    return;
  }

  const latestRecord = (await readMissionDispatchRecordById(record.id)) ?? record;

  if (isMissionDispatchTerminalStatus(latestRecord.status)) {
    return;
  }

  const finishedAt = output.finalTimestamp ?? timestampFromUnix(runtime.updatedAt);
  const nextStatus = stalledFromTranscript ? "stalled" : "completed";

  await writeMissionDispatchRecord({
    ...latestRecord,
    status: nextStatus,
    updatedAt: maxIsoTimestamp(latestRecord.updatedAt, finishedAt),
    runner: {
      ...latestRecord.runner,
      finishedAt,
      lastHeartbeatAt: finishedAt
    },
    result:
      nextStatus === "completed"
        ? latestRecord.result ?? createMissionDispatchResultFromRuntimeOutput(runtime, output)
        : latestRecord.result,
    error:
      nextStatus === "stalled"
        ? output.errorMessage || latestRecord.error || "OpenClaw runtime ended before the dispatch runner finalized."
        : null
  });
}

async function buildObservedMissionDispatchRuntime(record: MissionDispatchRecord) {
  const sessionId = extractMissionDispatchSessionId(record);

  if (!record.agentId || !sessionId) {
    return null;
  }

  const transcriptPath = await resolveRuntimeTranscriptPath(record.agentId, sessionId, record.workspacePath ?? undefined);

  if (!transcriptPath) {
    return null;
  }

  try {
    const raw = await readFile(transcriptPath, "utf8");
    const transcriptRuntime = buildMissionDispatchTranscriptRuntime(record, sessionId);
    const turns = extractTranscriptTurns(raw, transcriptRuntime, record.workspacePath ?? undefined);

    if (turns.length === 0) {
      return null;
    }

    if (record.mission && !turns.some((turn) => matchesMissionText(turn.prompt, record.mission))) {
      return null;
    }

    return transcriptRuntime;
  } catch {
    return null;
  }
}

async function readMissionDispatchRecords() {
  try {
    const entries = await readdir(missionDispatchesRootPath, { withFileTypes: true });
    const nowMs = Date.now();
    const records = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) => {
          const filePath = path.join(missionDispatchesRootPath, entry.name);
          const record = await readMissionDispatchRecord(filePath);

          if (!record) {
            return null;
          }

          if (shouldPruneMissionDispatchRecord(record, nowMs)) {
            await rm(filePath, { force: true });
            return null;
          }

          return record;
        })
    );

    return records
      .filter((record): record is MissionDispatchRecord => Boolean(record))
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  } catch {
    return [];
  }
}

async function readMissionDispatchRecordById(dispatchId: string) {
  return readMissionDispatchRecord(missionDispatchRecordPath(dispatchId));
}

async function readMissionDispatchRecord(filePath: string) {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<MissionDispatchRecord>;

    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.id !== "string" ||
      typeof parsed.agentId !== "string" ||
      typeof parsed.mission !== "string" ||
      typeof parsed.routedMission !== "string" ||
      typeof parsed.submittedAt !== "string" ||
      typeof parsed.updatedAt !== "string"
    ) {
      return null;
    }

    const status = normalizeMissionDispatchStatus(parsed.status);

    return {
      id: parsed.id,
      status,
      agentId: parsed.agentId,
      sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : null,
      mission: parsed.mission,
      routedMission: parsed.routedMission,
      thinking: normalizeMissionThinking(parsed.thinking),
      workspaceId: typeof parsed.workspaceId === "string" ? parsed.workspaceId : null,
      workspacePath: typeof parsed.workspacePath === "string" ? parsed.workspacePath : null,
      submittedAt: parsed.submittedAt,
      updatedAt: parsed.updatedAt,
      outputDir: typeof parsed.outputDir === "string" ? parsed.outputDir : null,
      outputDirRelative: typeof parsed.outputDirRelative === "string" ? parsed.outputDirRelative : null,
      notesDirRelative: typeof parsed.notesDirRelative === "string" ? parsed.notesDirRelative : null,
      runner: {
        pid: typeof parsed.runner?.pid === "number" ? parsed.runner.pid : null,
        childPid: typeof parsed.runner?.childPid === "number" ? parsed.runner.childPid : null,
        startedAt: typeof parsed.runner?.startedAt === "string" ? parsed.runner.startedAt : null,
        finishedAt: typeof parsed.runner?.finishedAt === "string" ? parsed.runner.finishedAt : null,
        lastHeartbeatAt: typeof parsed.runner?.lastHeartbeatAt === "string" ? parsed.runner.lastHeartbeatAt : null
      },
      observation: {
        runtimeId: typeof parsed.observation?.runtimeId === "string" ? parsed.observation.runtimeId : null,
        observedAt: typeof parsed.observation?.observedAt === "string" ? parsed.observation.observedAt : null
      },
      result: isMissionCommandPayload(parsed.result) ? parsed.result : null,
      error: typeof parsed.error === "string" ? parsed.error : null
    } satisfies MissionDispatchRecord;
  } catch {
    return null;
  }
}

function maxIsoTimestamp(left: string | null | undefined, right: string | null | undefined): string {
  const leftMs = left ? Date.parse(left) : Number.NaN;
  const rightMs = right ? Date.parse(right) : Number.NaN;

  if (Number.isNaN(leftMs)) {
    return right ?? new Date().toISOString();
  }

  if (Number.isNaN(rightMs)) {
    return left ?? new Date().toISOString();
  }

  return leftMs >= rightMs ? (left ?? new Date().toISOString()) : right!;
}

function shouldPruneMissionDispatchRecord(record: MissionDispatchRecord, nowMs: number) {
  const updatedAt = Date.parse(record.updatedAt);

  if (Number.isNaN(updatedAt)) {
    return false;
  }

  return nowMs - updatedAt > missionDispatchRetentionMs;
}

function isMissionDispatchTerminalStatus(status: MissionDispatchStatus) {
  return status === "completed" || status === "stalled" || status === "cancelled";
}

function matchMissionDispatchToRuntime(record: MissionDispatchRecord, runtimes: RuntimeRecord[]) {
  const submittedAt = Date.parse(record.submittedAt);
  const nowMs = Date.now();
  const effectiveStatus = resolveMissionDispatchRuntimeStatus(record, nowMs);
  const sessionId = extractMissionDispatchSessionId(record);
  const observedRuntimeId = record.observation.runtimeId?.trim() || null;

  if (shouldPreferSyntheticMissionDispatchRuntime(observedRuntimeId, runtimes, effectiveStatus)) {
    return null;
  }

  return runtimes
    .map((runtime) => ({
      runtime,
      score: scoreMissionDispatchRuntimeMatch(runtime, record, {
        submittedAt,
        sessionId,
        observedRuntimeId,
        effectiveStatus
      })
    }))
    .filter((entry): entry is { runtime: RuntimeRecord; score: number } => typeof entry.score === "number")
    .sort((left, right) => right.score - left.score || sortRuntimesByUpdatedAtDesc(left.runtime, right.runtime))[0]
    ?.runtime;
}

function shouldPreferSyntheticMissionDispatchRuntime(
  observedRuntimeId: string | null,
  runtimes: RuntimeRecord[],
  status: RuntimeRecord["status"]
) {
  if ((status !== "completed" && status !== "stalled" && status !== "cancelled") || !observedRuntimeId) {
    return false;
  }

  return !runtimes.some((runtime) => runtime.id === observedRuntimeId);
}

function scoreMissionDispatchRuntimeMatch(
  runtime: RuntimeRecord,
  record: MissionDispatchRecord,
  options: {
    submittedAt: number;
    sessionId: string | null;
    observedRuntimeId: string | null;
    effectiveStatus: RuntimeRecord["status"];
  }
) {
  if (isSyntheticDispatchRuntime(runtime) || runtime.agentId !== record.agentId) {
    return null;
  }

  const runtimeDispatchId =
    typeof runtime.metadata.dispatchId === "string" ? runtime.metadata.dispatchId.trim() : "";

  if (runtimeDispatchId && runtimeDispatchId !== record.id) {
    return null;
  }

  if ((runtime.updatedAt ?? 0) < (Number.isNaN(options.submittedAt) ? 0 : options.submittedAt - 1500)) {
    return null;
  }

  if (
    options.effectiveStatus === "completed" ||
    options.effectiveStatus === "stalled" ||
    options.effectiveStatus === "cancelled"
  ) {
    return runtimeDispatchId === record.id ? 500 : null;
  }

  if (options.observedRuntimeId && runtime.id === options.observedRuntimeId) {
    return 10_000;
  }

  if (options.sessionId && runtime.sessionId !== options.sessionId) {
    return null;
  }

  const missionMatches = matchesMissionRuntime(runtime, record.mission, {
    agentId: record.agentId,
    submittedAt: options.submittedAt
  });

  if (runtime.source === "turn" && !missionMatches) {
    return null;
  }

  let score = 0;
  score += runtime.source === "turn" ? 400 : runtime.source === "session" ? 40 : 20;
  score += missionMatches ? 240 : 0;
  score += options.sessionId && runtime.sessionId === options.sessionId ? 120 : 0;
  score += runtimeDispatchId === record.id ? 80 : 0;

  return score;
}

function isSyntheticDispatchRuntime(runtime: RuntimeRecord) {
  return runtime.id.startsWith("runtime:dispatch:");
}

function annotateRuntimeWithMissionDispatch(runtime: RuntimeRecord, record: MissionDispatchRecord): RuntimeRecord {
  const currentDispatchId =
    typeof runtime.metadata.dispatchId === "string" ? runtime.metadata.dispatchId.trim() : "";
  const runtimeMission = resolveRuntimeMissionText(runtime);
  const nextStatus =
    isMissionDispatchTerminalStatus(record.status)
      ? record.status
      : runtime.status;

  if (
    currentDispatchId === record.id &&
    runtimeMission &&
    typeof runtime.metadata.dispatchStatus === "string" &&
    runtime.metadata.dispatchStatus === record.status &&
    runtime.status === nextStatus
  ) {
    return runtime;
  }

  return {
    ...runtime,
    status: nextStatus,
    metadata: {
      ...runtime.metadata,
      dispatchId: record.id,
      dispatchStatus: record.status,
      dispatchSubmittedAt: record.submittedAt,
      dispatchRunnerStartedAt: record.runner.startedAt,
      dispatchHeartbeatAt: record.runner.lastHeartbeatAt,
      dispatchObservedAt: record.observation.observedAt,
      mission: runtimeMission ? runtime.metadata.mission : record.mission
    }
  };
}

function buildMissionDispatchTranscriptRuntime(record: MissionDispatchRecord, sessionId?: string): RuntimeRecord {
  const updatedAt = Date.parse(record.observation.observedAt ?? record.updatedAt ?? record.submittedAt);
  const nowMs = Date.now();
  const runtimeStatus = resolveMissionDispatchRuntimeStatus(record, nowMs);
  const resolvedSessionId = sessionId ?? extractMissionDispatchSessionId(record) ?? hashValue(record.id);
  const integrityWarning = resolveMissionDispatchIntegrityWarning(record);

  return {
    id: record.observation.runtimeId || `runtime:${resolvedSessionId}:${hashValue(record.id)}`,
    source: "turn",
    key: `dispatch:${record.id}`,
    title: compactMissionText(record.mission, 38) || "Recovered mission runtime",
    subtitle: integrityWarning
      ? summarizeText(integrityWarning, 90)
      : record.status === "completed" || record.status === "cancelled"
        ? summarizeText(resolveMissionDispatchCompletionDetail(record), 90)
        : record.status === "stalled"
          ? "Recovered the stalled runtime from the saved transcript."
          : "Recovering runtime state from the saved transcript.",
    status: runtimeStatus,
    updatedAt: Number.isNaN(updatedAt) ? null : updatedAt,
    ageMs: Number.isNaN(updatedAt) ? null : Math.max(nowMs - updatedAt, 0),
    agentId: record.agentId,
    workspaceId: record.workspaceId ?? undefined,
    modelId: extractMissionDispatchModelId(record) ?? undefined,
    sessionId: resolvedSessionId,
    tokenUsage: extractMissionDispatchTokenUsage(record),
    metadata: {
      mission: record.mission,
      dispatchId: record.id,
      routedMission: record.routedMission,
      outputDir: record.outputDir,
      outputDirRelative: record.outputDirRelative,
      notesDirRelative: record.notesDirRelative,
      error: record.error,
      sessionId: resolvedSessionId,
      pendingCreation: runtimeStatus === "queued" || runtimeStatus === "running",
      bootstrapStage: resolveMissionDispatchBootstrapStage(record, runtimeStatus),
      dispatchStatus: record.status,
      dispatchSubmittedAt: record.submittedAt,
      dispatchRunnerStartedAt: record.runner.startedAt,
      dispatchHeartbeatAt: record.runner.lastHeartbeatAt,
      dispatchObservedAt: record.observation.observedAt,
      recoveredFromObservation: true,
      ...(integrityWarning ? { warnings: [integrityWarning], warningSummary: integrityWarning } : {})
    }
  };
}

function createMissionDispatchRuntime(record: MissionDispatchRecord, nowMs: number): RuntimeRecord {
  const updatedAt = Date.parse(record.updatedAt);
  const runtimeStatus = resolveMissionDispatchRuntimeStatus(record, nowMs);
  const bootstrapStage = resolveMissionDispatchBootstrapStage(record, runtimeStatus);
  const subtitle = resolveMissionDispatchSubtitle(record, runtimeStatus);
  const sessionId = extractMissionDispatchSessionId(record);
  const modelId = extractMissionDispatchModelId(record);
  const tokenUsage = extractMissionDispatchTokenUsage(record);
  const integrityWarning = resolveMissionDispatchIntegrityWarning(record);

  return {
    id: `runtime:dispatch:${record.id}`,
    source: "turn",
    key: `dispatch:${record.id}`,
    title: compactMissionText(record.mission, 38) || "Queued mission",
    subtitle: integrityWarning ? summarizeText(integrityWarning, 90) : subtitle,
    status: runtimeStatus,
    updatedAt: Number.isNaN(updatedAt) ? Date.parse(record.submittedAt) || null : updatedAt,
    ageMs: Number.isNaN(updatedAt) ? null : Math.max(nowMs - updatedAt, 0),
    agentId: record.agentId,
    workspaceId: record.workspaceId ?? undefined,
    modelId: modelId ?? undefined,
    sessionId: sessionId ?? undefined,
    runId: record.result?.runId,
    tokenUsage,
    metadata: {
      dispatchId: record.id,
      mission: record.mission,
      routedMission: record.routedMission,
      outputDir: record.outputDir,
      outputDirRelative: record.outputDirRelative,
      notesDirRelative: record.notesDirRelative,
      error: record.error,
      sessionId,
      pendingCreation: runtimeStatus === "queued" || runtimeStatus === "running",
      bootstrapStage,
      dispatchStatus: record.status,
      dispatchSubmittedAt: record.submittedAt,
      dispatchRunnerStartedAt: record.runner.startedAt,
      dispatchHeartbeatAt: record.runner.lastHeartbeatAt,
      dispatchObservedAt: record.observation.observedAt,
      ...(integrityWarning ? { warnings: [integrityWarning], warningSummary: integrityWarning } : {})
    }
  };
}

function resolveMissionDispatchBootstrapStage(
  record: MissionDispatchRecord,
  status: RuntimeRecord["status"]
) {
  if (status === "completed") {
    return "completed";
  }

  if (status === "cancelled") {
    return "cancelled";
  }

  if (status === "stalled") {
    return "stalled";
  }

  if (record.observation.runtimeId || record.observation.observedAt) {
    return "runtime-observed";
  }

  if (record.runner.lastHeartbeatAt) {
    return "waiting-for-runtime";
  }

  if (record.runner.startedAt || record.runner.pid) {
    return "waiting-for-heartbeat";
  }

  return "accepted";
}

function resolveMissionDispatchRuntimeStatus(record: MissionDispatchRecord, nowMs: number): RuntimeRecord["status"] {
  if (record.status === "completed") {
    return "completed";
  }

  if (record.status === "cancelled") {
    return "cancelled";
  }

  if (record.status === "stalled") {
    return "stalled";
  }

  if (record.status === "running") {
    const heartbeatAt = Date.parse(record.runner.lastHeartbeatAt || record.updatedAt);
    return !Number.isNaN(heartbeatAt) && nowMs - heartbeatAt > missionDispatchHeartbeatStallMs
      ? "stalled"
      : "running";
  }

  const queuedAt = Date.parse(record.submittedAt);
  return !Number.isNaN(queuedAt) && nowMs - queuedAt > missionDispatchQueuedStallMs ? "stalled" : "queued";
}

function resolveMissionDispatchSubtitle(
  record: MissionDispatchRecord,
  status: RuntimeRecord["status"]
) {
  if (status === "completed") {
    return summarizeText(resolveMissionDispatchCompletionDetail(record), 90);
  }

  if (status === "cancelled") {
    return summarizeText(resolveMissionDispatchCompletionDetail(record), 90);
  }

  if (status === "stalled") {
    if (record.error) {
      return summarizeText(record.error, 90);
    }

    if (!record.runner.lastHeartbeatAt) {
      return "Dispatch stalled before the first runner heartbeat.";
    }

    return "Dispatch stalled while waiting for the first OpenClaw runtime.";
  }

  const bootstrapStage = resolveMissionDispatchBootstrapStage(record, status);

  if (bootstrapStage === "runtime-observed") {
    return "First runtime observed. Promoting the task to live updates.";
  }

  if (bootstrapStage === "waiting-for-runtime") {
    return "Heartbeat received. Waiting for the first OpenClaw runtime.";
  }

  if (bootstrapStage === "waiting-for-heartbeat") {
    return "Dispatch runner started. Waiting for the first heartbeat.";
  }

  return "Mission accepted. Starting the OpenClaw dispatch runner.";
}

function extractMissionDispatchAgentMeta(record: MissionDispatchRecord) {
  const meta = record.result?.result?.meta;

  if (!meta || typeof meta !== "object") {
    return null;
  }

  const agentMeta = (meta as Record<string, unknown>).agentMeta;
  return agentMeta && typeof agentMeta === "object" ? (agentMeta as Record<string, unknown>) : null;
}

function extractMissionDispatchString(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function extractSessionIdFromRuntimeId(runtimeId: string | null | undefined) {
  const trimmed = runtimeId?.trim();

  if (!trimmed?.startsWith("runtime:")) {
    return null;
  }

  const segments = trimmed.split(":");
  const sessionId = segments[1];

  if (!sessionId || sessionId === "dispatch") {
    return null;
  }

  return sessionId;
}

function extractMissionDispatchNumber(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function extractMissionDispatchSessionId(record: MissionDispatchRecord) {
  return (
    (record.sessionId?.trim() || null) ??
    extractMissionDispatchString(extractMissionDispatchAgentMeta(record), "sessionId") ??
    extractSessionIdFromRuntimeId(record.observation.runtimeId)
  );
}

function extractMissionDispatchModelId(record: MissionDispatchRecord) {
  return extractMissionDispatchString(extractMissionDispatchAgentMeta(record), "model");
}

function extractMissionDispatchTokenUsage(record: MissionDispatchRecord): RuntimeRecord["tokenUsage"] | undefined {
  const agentMeta = extractMissionDispatchAgentMeta(record);
  const usage = agentMeta?.usage;

  if (!usage || typeof usage !== "object") {
    return undefined;
  }

  const usageRecord = usage as Record<string, unknown>;
  const total =
    extractMissionDispatchNumber(usageRecord, "total") ??
    extractMissionDispatchNumber(usageRecord, "totalTokens") ??
    extractMissionDispatchNumber(usageRecord, "total_tokens");

  if (total === null) {
    return undefined;
  }

  return {
    input:
      extractMissionDispatchNumber(usageRecord, "input") ??
      extractMissionDispatchNumber(usageRecord, "prompt_tokens") ??
      0,
    output:
      extractMissionDispatchNumber(usageRecord, "output") ??
      extractMissionDispatchNumber(usageRecord, "completion_tokens") ??
      0,
    total,
    cacheRead: extractMissionDispatchNumber(usageRecord, "cacheRead") ?? 0
  };
}

function resolveMissionDispatchSummary(record: MissionDispatchRecord) {
  const summary = record.result?.summary?.trim();

  if (!summary) {
    return null;
  }

  const normalized = summary.toLowerCase();
  return normalized === "completed" ||
    normalized === "ok" ||
    normalized === "success" ||
    isPlaceholderMissionResponseText(summary)
    ? null
    : summary;
}

function resolveMissionDispatchResultText(record: MissionDispatchRecord) {
  const text =
    record.result?.result?.payloads?.find((payload) => payload.text.trim().length > 0)?.text.trim() ?? null;
  return isPlaceholderMissionResponseText(text) ? null : text;
}

function isPlaceholderMissionReply(value: string | null | undefined) {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.replace(/\s+/g, " ").trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  return (
    normalized === "ready" ||
    normalized === "[[reply_to_current]] ready" ||
    normalized === "mission accepted" ||
    normalized === "mission queued"
  );
}

function resolveMissionDispatchIntegrityWarning(record: MissionDispatchRecord) {
  const resultText = resolveMissionDispatchResultText(record);

  if (record.status !== "completed" || !isPlaceholderMissionReply(resultText)) {
    return null;
  }

  if (!record.observation.observedAt) {
    return "Dispatch finished, but the only saved result was READY and no mission transcript was linked.";
  }

  return "Dispatch finished, but the saved reply still looks like a placeholder READY response.";
}

function resolveMissionDispatchCompletionDetail(record: MissionDispatchRecord) {
  const integrityWarning = resolveMissionDispatchIntegrityWarning(record);

  if (integrityWarning) {
    return integrityWarning;
  }

  if (record.status === "cancelled") {
    return summarizeText(record.error || "Mission aborted by operator.", 90);
  }

  const completedSummary = resolveMissionDispatchSummary(record) || resolveMissionDispatchResultText(record);

  if (completedSummary) {
    return completedSummary;
  }

  if (record.observation.observedAt) {
    return "Dispatch runner finished. Waiting for the final runtime transcript to sync.";
  }

  if (record.outputDirRelative) {
    return `Dispatch runner finished · ${record.outputDirRelative}`;
  }

  return "Dispatch runner finished.";
}

function createMissionDispatchResultFromRuntimeOutput(
  runtime: RuntimeRecord,
  output: RuntimeOutputRecord
): MissionCommandPayload | null {
  if (!output.finalText && !runtime.runId) {
    return null;
  }

  return {
    runId: runtime.runId || `runtime:${runtime.id}`,
    status: output.errorMessage ? "error" : "ok",
    summary: output.errorMessage || "completed",
    ...(output.finalText
      ? {
          result: {
            payloads: [
              {
                text: output.finalText,
                mediaUrl: null
              }
            ]
          }
        }
      : {})
  };
}

function normalizeMissionDispatchStatus(value: unknown): MissionDispatchStatus {
  return value === "running" || value === "completed" || value === "stalled" || value === "cancelled"
    ? value
    : "queued";
}

function normalizeMissionThinking(value: unknown): NonNullable<MissionSubmission["thinking"]> {
  return value === "off" || value === "minimal" || value === "low" || value === "high" ? value : "medium";
}

function isMissionCommandPayload(value: unknown): value is MissionCommandPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as MissionCommandPayload).runId === "string" &&
    typeof (value as MissionCommandPayload).status === "string" &&
    typeof (value as MissionCommandPayload).summary === "string"
  );
}

async function mapSessionToRuntimes(
  session: SessionsPayload["sessions"][number],
  agentConfig: AgentConfigPayload,
  agentsList: AgentPayload
) {
  const runtime = mapRuntime(session, agentConfig, agentsList);

  if (!session.key?.endsWith(":main") || !session.agentId || !session.sessionId) {
    return [runtime];
  }

  const agent = agentsList.find((entry) => entry.id === session.agentId);
  const config = agentConfig.find((entry) => entry.id === session.agentId);
  const transcriptPath = await resolveRuntimeTranscriptPath(
    session.agentId,
    session.sessionId,
    agent?.workspace || config?.workspace
  );

  if (!transcriptPath) {
    return [runtime];
  }

  try {
    const raw = await readFile(transcriptPath, "utf8");
    const turns = extractTranscriptTurns(raw, runtime, agent?.workspace || config?.workspace).filter(
      (turn) => !isHeartbeatTurn(turn.prompt)
    );
    const observedToolNames = collectTranscriptToolNames(turns);

    if (turns.length === 0) {
      return [runtime];
    }

    return turns.slice(-6).reverse().map((turn) => createTurnRuntime(runtime, turn, observedToolNames));
  } catch {
    return [runtime];
  }
}

export async function getRuntimeOutput(runtimeId: string): Promise<RuntimeOutputRecord> {
  let snapshot = await getMissionControlSnapshot({ includeHidden: true });
  let runtime = snapshot.runtimes.find((entry) => entry.id === runtimeId);

  if (!runtime) {
    snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
    runtime = snapshot.runtimes.find((entry) => entry.id === runtimeId);
  }

  if (!runtime) {
    return {
      runtimeId,
      status: "missing",
      finalText: null,
      finalTimestamp: null,
      stopReason: null,
      errorMessage: "Runtime was not found in the current OpenClaw snapshot.",
      items: [],
      createdFiles: [],
      warnings: [],
      warningSummary: null
    };
  }

  return getRuntimeOutputForResolvedRuntime(runtime, snapshot);
}

export async function getTaskDetail(taskId: string): Promise<TaskDetailRecord> {
  let snapshot = await getMissionControlSnapshot({ includeHidden: true });
  let task = snapshot.tasks.find((entry) => entry.id === taskId);

  if (!task) {
    snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
    task = snapshot.tasks.find((entry) => entry.id === taskId);
  }

  if (!task) {
    throw new Error("Task was not found in the current OpenClaw snapshot.");
  }

  const runs = task.runtimeIds
    .map((runtimeId) => snapshot.runtimes.find((runtime) => runtime.id === runtimeId))
    .filter((runtime): runtime is RuntimeRecord => Boolean(runtime))
    .sort(sortRuntimesByUpdatedAtDesc);
  const outputs = await Promise.all(
    runs.map((runtime) => getRuntimeOutputForResolvedRuntime(runtime, snapshot))
  );
  const outputByRuntimeId = new Map(outputs.map((output) => [output.runtimeId, output]));
  const createdFiles = dedupeCreatedFiles(
    outputs.flatMap((output) => output.createdFiles).concat(
      runs.flatMap((runtime) => extractCreatedFilesFromRuntimeMetadata(runtime))
    )
  );
  const warnings = uniqueStrings(
    outputs.flatMap((output) => output.warnings).concat(
      runs.flatMap((runtime) => extractWarningsFromRuntimeMetadata(runtime))
    )
  );
  const dispatchRecord = task.dispatchId ? await readMissionDispatchRecordById(task.dispatchId) : null;
  const bootstrapFeed = buildMissionDispatchFeed(task, dispatchRecord, snapshot);
  const runtimeFeed = buildTaskFeed(task, runs, outputByRuntimeId, snapshot);
  const integrity = await buildTaskIntegrityRecord({
    task,
    runs,
    outputs,
    createdFiles,
    dispatchRecord,
    snapshot
  });

  return {
    task,
    runs,
    outputs,
    liveFeed: mergeTaskFeedEvents(bootstrapFeed, runtimeFeed),
    createdFiles,
    warnings,
    integrity
  };
}

async function buildTaskIntegrityRecord(input: {
  task: TaskRecord;
  runs: RuntimeRecord[];
  outputs: RuntimeOutputRecord[];
  createdFiles: RuntimeCreatedFile[];
  dispatchRecord: MissionDispatchRecord | null;
  snapshot: MissionControlSnapshot;
}): Promise<TaskIntegrityRecord> {
  const { task, dispatchRecord, createdFiles, snapshot } = input;
  const outputDirInspection = await inspectMissionDispatchOutputDir(dispatchRecord?.outputDir ?? null);
  const transcriptTurns = dispatchRecord
    ? await readMissionDispatchTranscriptTurns(dispatchRecord, snapshot)
    : ([] as TranscriptTurn[]);
  const missionText = task.mission || dispatchRecord?.mission || null;
  const matchingTranscriptTurns =
    missionText && transcriptTurns.length > 0
      ? transcriptTurns.filter((turn) => matchesMissionText(turn.prompt, missionText))
      : transcriptTurns;
  const latestMatchingTurn =
    [...matchingTranscriptTurns].sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    )[0] ?? null;
  const runtimeFinalText = latestMatchingTurn?.finalText?.trim() || null;
  const dispatchResultText = dispatchRecord ? resolveMissionDispatchResultText(dispatchRecord) : null;
  const finalResponseText = runtimeFinalText || dispatchResultText || null;
  const finalResponseSource = runtimeFinalText ? "runtime" : dispatchResultText ? "dispatch" : "none";
  const sessionMismatch = Boolean(dispatchRecord && transcriptTurns.length > 0 && matchingTranscriptTurns.length === 0);
  const toolNames = collectTranscriptToolNames(matchingTranscriptTurns);
  const emails = extractEmailsFromValues([
    finalResponseText,
    dispatchResultText,
    ...matchingTranscriptTurns.flatMap((turn) => turn.items.map((item) => item.text))
  ]);
  const issues: TaskIntegrityRecord["issues"] = [];
  const placeholderResponse = isPlaceholderMissionResponseText(finalResponseText);
  const expectsFileArtifact = missionRequestsFileArtifact(missionText);
  const expectsEmailAddress = missionRequestsEmailAddress(missionText);
  const expectsExternalLookup = missionNeedsExternalLookup(missionText);

  if (dispatchRecord?.outputDir && !outputDirInspection.exists) {
    issues.push({
      id: "missing-output-dir",
      severity: "warning",
      title: "Output folder is missing",
      detail: `The dispatch points at ${dispatchRecord.outputDirRelative || dispatchRecord.outputDir}, but that folder is not accessible now.`
    });
  }

  if (
    task.status === "completed" &&
    dispatchRecord?.outputDir &&
    outputDirInspection.exists &&
    outputDirInspection.fileCount === 0 &&
    createdFiles.length === 0
  ) {
    issues.push({
      id: "empty-output-dir",
      severity: expectsFileArtifact ? "error" : "warning",
      title: "Deliverables folder is empty",
      detail: expectsFileArtifact
        ? "The task asked for a file deliverable, but the assigned deliverables folder does not contain any files."
        : "The task is marked completed, but the assigned deliverables folder does not contain any files."
    });
  }

  if (task.status === "completed" && transcriptTurns.length === 0) {
    issues.push({
      id: "missing-transcript",
      severity: "warning",
      title: "No runtime transcript was captured",
      detail: "Mission Control could not verify what the agent actually did because no transcript was recovered for this dispatch."
    });
  }

  if (task.status === "cancelled") {
    issues.push({
      id: "task-cancelled",
      severity: "warning",
      title: "Task was cancelled by the operator",
      detail:
        dispatchRecord?.error ||
        "The mission dispatch was stopped before completion, so the captured evidence is intentionally incomplete."
    });
  }

  if (sessionMismatch && dispatchRecord?.agentId) {
    issues.push({
      id: "session-mismatch",
      severity: "error",
      title: "Recovered session does not match the mission",
      detail: "The linked transcript session exists, but none of its user turns match this task mission. The dispatch likely reused or attached the wrong session."
    });
  }

  if (task.status === "completed" && !finalResponseText) {
    issues.push({
      id: "missing-final-response",
      severity: "warning",
      title: "No final answer was captured",
      detail: "The task completed without a final assistant response in either the runtime transcript or the dispatch payload."
    });
  } else if (task.status === "stalled" && finalResponseText) {
    issues.push({
      id: "partial-final-response",
      severity: "warning",
      title: "Final response came from an incomplete runtime",
      detail:
        "The assistant produced output, but the runtime stalled before the task completed. Treat this as the last captured response, not a verified completion."
    });
  } else if (task.status === "completed" && placeholderResponse && finalResponseText) {
    issues.push({
      id: "placeholder-final-response",
      severity:
        outputDirInspection.fileCount === 0 && createdFiles.length === 0 && matchingTranscriptTurns.length === 0
          ? "error"
          : "warning",
      title: "Completion response looks like a placeholder",
      detail: `The captured final response was "${finalResponseText}", which is not enough evidence that the requested work actually finished.`
    });
  }

  if (task.status === "completed" && expectsExternalLookup && matchingTranscriptTurns.length > 0 && toolNames.length === 0) {
    issues.push({
      id: "missing-tool-evidence",
      severity: "warning",
      title: "No tool usage was recovered",
      detail: "This mission looks like it needed external lookup or browsing, but the matching transcript turn does not show any recovered tool calls."
    });
  }

  if (task.status === "completed" && expectsEmailAddress && emails.length === 0) {
    issues.push({
      id: "missing-email",
      severity: "warning",
      title: "Requested email address was not captured",
      detail: "The task appears to ask for an email address, but none was detected in the final response or the matching transcript."
    });
  }

  return {
    status: issues.some((issue) => issue.severity === "error")
      ? "error"
      : issues.length > 0
        ? "warning"
        : "verified",
    outputDir: dispatchRecord?.outputDir ?? null,
    outputDirRelative: dispatchRecord?.outputDirRelative ?? null,
    outputDirExists: outputDirInspection.exists,
    outputFileCount: outputDirInspection.fileCount,
    transcriptTurnCount: transcriptTurns.length,
    matchingTranscriptTurnCount: matchingTranscriptTurns.length,
    finalResponseText,
    finalResponseSource,
    dispatchSessionId: dispatchRecord ? extractMissionDispatchSessionId(dispatchRecord) : null,
    sessionMismatch,
    toolNames,
    emails,
    issues
  };
}

async function inspectMissionDispatchOutputDir(outputDir: string | null) {
  if (!outputDir) {
    return {
      exists: false,
      fileCount: 0
    };
  }

  try {
    const outputStat = await stat(outputDir);

    if (!outputStat.isDirectory()) {
      return {
        exists: true,
        fileCount: 1
      };
    }

    return {
      exists: true,
      fileCount: await countFilesInDirectory(outputDir)
    };
  } catch {
    return {
      exists: false,
      fileCount: 0
    };
  }
}

async function countFilesInDirectory(directoryPath: string): Promise<number> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  let count = 0;

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      count += await countFilesInDirectory(entryPath);
      continue;
    }

    if (entry.isFile()) {
      count += 1;
    }
  }

  return count;
}

async function readMissionDispatchTranscriptTurns(
  record: MissionDispatchRecord,
  snapshot: MissionControlSnapshot
) {
  const sessionId = extractMissionDispatchSessionId(record);

  if (!sessionId) {
    return [] as TranscriptTurn[];
  }

  const agent = snapshot.agents.find((entry) => entry.id === record.agentId);
  const transcriptPath = await resolveRuntimeTranscriptPath(
    record.agentId,
    sessionId,
    record.workspacePath ?? agent?.workspacePath
  );

  if (!transcriptPath) {
    return [] as TranscriptTurn[];
  }

  try {
    const raw = await readFile(transcriptPath, "utf8");
    return extractTranscriptTurns(
      raw,
      buildMissionDispatchTranscriptRuntime(record, sessionId),
      record.workspacePath ?? agent?.workspacePath
    );
  } catch {
    return [] as TranscriptTurn[];
  }
}

function extractEmailsFromValues(values: Array<string | null | undefined>) {
  const emails = new Set<string>();

  for (const value of values) {
    if (!value) {
      continue;
    }

    for (const match of value.match(EMAIL_PATTERN) ?? []) {
      emails.add(match.toLowerCase());
    }
  }

  return [...emails];
}

function isPlaceholderMissionResponseText(value: string | null) {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();

  return (
    normalized === "ready" ||
    normalized === "completed" ||
    normalized === "complete" ||
    normalized === "ok" ||
    normalized === "success"
  );
}

function missionRequestsFileArtifact(value: string | null) {
  if (!value) {
    return false;
  }

  return (
    /\.(txt|md|json|csv|html|pdf|docx?)\b/i.test(value) ||
    /\b(file|files|artifact|artifacts|report|document|save|export|attachment)\b/i.test(value) ||
    /\b(dosya|dosyasi|kaydet|kaydi|cikti)\b/i.test(value)
  );
}

function missionRequestsEmailAddress(value: string | null) {
  if (!value) {
    return false;
  }

  return /\b(email|e-mail|mail|mail address|mail adres|eposta|e-posta)\b/i.test(value);
}

function missionNeedsExternalLookup(value: string | null) {
  if (!value) {
    return false;
  }

  return (
    /https?:\/\//i.test(value) ||
    /\b[a-z0-9-]+\.(com|net|org|io|ai|co|tr|app|dev|me|info|biz|edu|gov)\b/i.test(value) ||
    /\b(site|website|web|browser|browse|fetch|sitesine|siteye|siteyi)\b/i.test(value)
  );
}

async function getRuntimeOutputForResolvedRuntime(
  runtime: RuntimeRecord,
  snapshot: MissionControlSnapshot
): Promise<RuntimeOutputRecord> {
  if (snapshot.mode === "fallback") {
    return createFallbackRuntimeOutput(runtime);
  }

  if (!runtime.sessionId || !runtime.agentId) {
    return createMissingRuntimeOutput(runtime, "This runtime does not expose a session transcript yet.");
  }

  const agent = snapshot.agents.find((entry) => entry.id === runtime.agentId);
  const transcriptPath = await resolveRuntimeTranscriptPath(runtime.agentId, runtime.sessionId, agent?.workspacePath);

  if (!transcriptPath) {
    return createMissingRuntimeOutput(runtime, "No transcript file was found for this runtime session.");
  }

  try {
    const raw = await readFile(transcriptPath, "utf8");
    return parseRuntimeOutput(runtime, raw, agent?.workspacePath);
  } catch (error) {
    return {
      runtimeId: runtime.id,
      sessionId: runtime.sessionId,
      taskId: runtime.taskId,
      status: "error",
      finalText: null,
      finalTimestamp: null,
      stopReason: null,
      errorMessage: error instanceof Error ? error.message : "Unable to read runtime transcript.",
      items: [],
      createdFiles: [],
      warnings: [],
      warningSummary: null
    };
  }
}

export async function createAgent(input: AgentCreateInput) {
  const agentId = slugify(input.id.trim());

  if (!agentId) {
    throw new Error("Agent id is required.");
  }

  let snapshot = await getMissionControlSnapshot({ includeHidden: true });
  let resolvedWorkspacePath =
    normalizeOptionalValue(input.workspacePath) ??
    snapshot.workspaces.find((entry) => entry.id === input.workspaceId)?.path;

  if (!resolvedWorkspacePath) {
    snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
    resolvedWorkspacePath =
      normalizeOptionalValue(input.workspacePath) ??
      snapshot.workspaces.find((entry) => entry.id === input.workspaceId)?.path;
  }

  const resolvedWorkspaceId =
    input.workspaceId || (resolvedWorkspacePath ? workspaceIdFromPath(resolvedWorkspacePath) : null);
  assertAgentIdAvailable(snapshot, agentId, resolvedWorkspaceId);

  if (!resolvedWorkspacePath || !resolvedWorkspaceId) {
    throw new Error("Workspace was not found for this agent.");
  }

  const policy = resolveAgentPolicy(input.policy?.preset ?? DEFAULT_AGENT_PRESET, input.policy);
  const presetMeta = getAgentPresetMeta(policy.preset);
  const displayName = normalizeOptionalValue(input.name) ?? presetMeta.defaultName;
  const emoji = normalizeOptionalValue(input.emoji) ?? presetMeta.defaultEmoji;
  const theme = normalizeOptionalValue(input.theme) ?? presetMeta.defaultTheme;
  const heartbeat = serializeHeartbeatConfig(resolveHeartbeatDraft(policy.preset, input.heartbeat));
  const setupAgentId =
    snapshot.agents.find((entry) => entry.workspaceId === resolvedWorkspaceId && entry.policy.preset === "setup")?.id ?? null;

  const args = [
    "agents",
    "add",
    agentId,
    "--workspace",
    resolvedWorkspacePath,
    "--agent-dir",
    buildWorkspaceAgentStatePath(resolvedWorkspacePath, agentId),
    "--non-interactive",
    "--json"
  ];

  if (input.modelId?.trim()) {
    args.push("--model", input.modelId.trim());
  }

  await runOpenClaw(args);

  const policySkillId = await ensureAgentPolicySkill({
    workspacePath: resolvedWorkspacePath,
    agentId,
    agentName: displayName,
    policy,
    setupAgentId,
    snapshot
  });

  const configEntry = await upsertAgentConfigEntry(
    agentId,
    resolvedWorkspacePath,
    {
      name: displayName,
      model: normalizeOptionalValue(input.modelId),
      heartbeat,
      skills: [policySkillId],
      tools:
        policy.fileAccess === "workspace-only"
          ? {
              fs: {
                workspaceOnly: true
              }
            }
          : null
    },
    snapshot
  );

  await applyAgentIdentity(agentId, resolvedWorkspacePath, {
    name: displayName || configEntry.name,
    emoji,
    theme,
    avatar: normalizeOptionalValue(input.avatar)
  }, buildWorkspaceAgentStatePath(resolvedWorkspacePath, agentId));

  await upsertWorkspaceProjectAgentMetadata(resolvedWorkspacePath, {
    id: agentId,
    name: displayName,
    role: formatAgentPresetLabel(policy.preset),
    emoji,
    theme,
    enabled: true,
    skillId: policySkillId,
    toolIds: presetMeta.tools,
    modelId: normalizeOptionalValue(input.modelId),
    isPrimary: false,
    policy,
    channelIds: input.channelIds ?? []
  });

  await syncWorkspaceAgentPolicySkills(resolvedWorkspacePath);
  snapshotCache = null;

  return {
    agentId,
    workspaceId: resolvedWorkspaceId
  };
}

export async function updateAgent(input: AgentUpdateInput) {
  const agentId = input.id.trim();

  if (!agentId) {
    throw new Error("Agent id is required.");
  }

  let snapshot = await getMissionControlSnapshot({ includeHidden: true });
  let agent = snapshot.agents.find((entry) => entry.id === agentId);

  if (!agent) {
    snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
    agent = snapshot.agents.find((entry) => entry.id === agentId);
  }

  if (!agent) {
    throw new Error("Agent was not found.");
  }

  const resolvedWorkspacePath =
    normalizeOptionalValue(input.workspacePath) ??
    snapshot.workspaces.find((entry) => entry.id === (input.workspaceId || agent.workspaceId))?.path ??
    agent.workspacePath;
  const resolvedWorkspaceId =
    input.workspaceId || (resolvedWorkspacePath ? workspaceIdFromPath(resolvedWorkspacePath) : agent.workspaceId);

  if (!resolvedWorkspacePath || !resolvedWorkspaceId) {
    throw new Error("Workspace was not found for this agent.");
  }

  const policy = resolveAgentPolicy(input.policy?.preset ?? agent.policy.preset, input.policy ?? agent.policy);
  const currentName = normalizeOptionalValue(agent.name);
  const currentEmoji = normalizeOptionalValue(agent.identity.emoji);
  const currentTheme = normalizeOptionalValue(agent.identity.theme);
  const heartbeat = serializeHeartbeatConfig(
    resolveHeartbeatDraft(
      policy.preset,
      input.heartbeat ?? mapAgentHeartbeatToInput(agent.heartbeat)
    )
  );
  const setupAgentId =
    snapshot.agents.find((entry) => entry.workspaceId === resolvedWorkspaceId && entry.policy.preset === "setup" && entry.id !== agentId)?.id ??
    null;
  const policySkillId = await ensureAgentPolicySkill({
    workspacePath: resolvedWorkspacePath,
    agentId,
    agentName: normalizeOptionalValue(input.name) ?? currentName ?? agentId,
    policy,
    setupAgentId,
    snapshot
  });
  const nextDeclaredSkills =
    input.skills === undefined ? agent.skills : filterAgentPolicySkills(input.skills);

  const configEntry = await upsertAgentConfigEntry(
    agentId,
    resolvedWorkspacePath,
    {
      name: normalizeOptionalValue(input.name),
      model: normalizeOptionalValue(input.modelId),
      heartbeat,
      skills: uniqueStrings([...nextDeclaredSkills, policySkillId]),
      tools:
        policy.fileAccess === "workspace-only"
          ? {
              fs: {
                workspaceOnly: true
              }
            }
          : null
    },
    snapshot
  );
  const nextDeclaredTools =
    input.tools === undefined ? undefined : normalizeDeclaredAgentTools(input.tools);

  await applyAgentIdentity(agentId, resolvedWorkspacePath, {
    name: normalizeOptionalValue(input.name) ?? configEntry.name,
    emoji: normalizeOptionalValue(input.emoji) ?? currentEmoji,
    theme: normalizeOptionalValue(input.theme) ?? currentTheme,
    avatar: normalizeOptionalValue(input.avatar)
  }, agent.agentDir ?? buildWorkspaceAgentStatePath(resolvedWorkspacePath, agentId));

  await upsertWorkspaceProjectAgentMetadata(resolvedWorkspacePath, {
    id: agentId,
    name: normalizeOptionalValue(input.name) ?? currentName ?? configEntry.name ?? agentId,
    emoji: normalizeOptionalValue(input.emoji) ?? currentEmoji,
    theme: normalizeOptionalValue(input.theme) ?? currentTheme,
    enabled: true,
    modelId: normalizeOptionalValue(input.modelId) ?? (agent.modelId === "unassigned" ? null : agent.modelId),
    isPrimary: agent.isDefault,
    policy,
    channelIds: input.channelIds ?? [],
    toolIds: nextDeclaredTools
  });

  await syncWorkspaceAgentPolicySkills(resolvedWorkspacePath);
  snapshotCache = null;

  return {
    agentId,
    workspaceId: resolvedWorkspaceId
  };
}

export async function deleteAgent(input: AgentDeleteInput) {
  const agentId = input.agentId.trim();

  if (!agentId) {
    throw new Error("Agent id is required.");
  }

  let snapshot = await getMissionControlSnapshot({ includeHidden: true });
  let agent = snapshot.agents.find((entry) => entry.id === agentId);

  if (!agent) {
    snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
    agent = snapshot.agents.find((entry) => entry.id === agentId);
  }

  if (!agent) {
    throw new Error("Agent was not found.");
  }

  const workspace = snapshot.workspaces.find((entry) => entry.id === agent.workspaceId) ?? null;
  const runtimeCount = snapshot.runtimes.filter((runtime) => runtime.agentId === agent.id).length;

  await runOpenClaw(["agents", "delete", agent.id, "--force", "--json"]);

  try {
    const configList = await readAgentConfigList(snapshot);
    const nextConfigList = configList.filter((entry) => entry.id !== agent.id);

    if (nextConfigList.length !== configList.length) {
      await writeAgentConfigList(nextConfigList);
    }
  } catch {
    // Ignore config cleanup failures if the CLI delete already removed the entry.
  }

  if (workspace) {
    await removeWorkspaceProjectAgentMetadata(workspace.path, agent.id);

    try {
      await rm(path.join(workspace.path, "skills", buildAgentPolicySkillId(agent.id)), {
        recursive: true,
        force: true
      });
    } catch {
      // Ignore skill cleanup failures for already-pruned workspaces.
    }

    await syncWorkspaceAgentPolicySkills(workspace.path);
  }

  snapshotCache = null;
  runtimeHistoryCache = new Map();

  return {
    agentId: agent.id,
    workspaceId: agent.workspaceId,
    workspacePath: agent.workspacePath,
    deletedRuntimeCount: runtimeCount
  };
}

export async function upsertWorkspaceChannel(input: {
  workspaceId: string;
  workspacePath: string;
  channelId: string;
  type: PlannerChannelType;
  name: string;
  primaryAgentId?: string | null;
  agentIds?: string[];
  groupAssignments?: WorkspaceChannelGroupAssignment[];
}) {
  const channelId = slugify(input.channelId.trim());

  if (!channelId) {
    throw new Error("Channel id is required.");
  }

  await mutateChannelRegistry((registry) => {
    const existingChannel = registry.channels.find((entry) => entry.id === channelId);
    const nextChannel: WorkspaceChannelSummary =
      existingChannel ??
      ({
        id: channelId,
        type: input.type,
        name: input.name.trim() || channelId,
        primaryAgentId: normalizeOptionalValue(input.primaryAgentId) ?? null,
        workspaces: []
      } satisfies WorkspaceChannelSummary);
    const workspaceId = input.workspaceId.trim();
    const workspacePath = input.workspacePath.trim();
    const workspaceBinding =
      nextChannel.workspaces.find((entry) => entry.workspaceId === workspaceId) ??
      ({
        workspaceId,
        workspacePath,
        agentIds: [],
        groupAssignments: []
      } satisfies WorkspaceChannelWorkspaceBinding);
    const nextAgentIds = uniqueStrings([
      ...workspaceBinding.agentIds,
      ...(input.agentIds ?? []).map((entry) => entry.trim()).filter(Boolean)
    ]);
    const nextGroupAssignments = uniqueByChatId([
      ...workspaceBinding.groupAssignments,
      ...(input.groupAssignments ?? []).filter((assignment) => Boolean(assignment.chatId))
    ]);

    const mergedWorkspaceBinding: WorkspaceChannelWorkspaceBinding = {
      ...workspaceBinding,
      workspacePath,
      agentIds: nextAgentIds,
      groupAssignments: nextGroupAssignments
    };

    const workspaceBindings = nextChannel.workspaces.filter((entry) => entry.workspaceId !== workspaceId);
    workspaceBindings.push(mergedWorkspaceBinding);

    const nextPrimaryAgentId = normalizeOptionalValue(input.primaryAgentId) ?? nextChannel.primaryAgentId;

    registry.channels = [
      ...registry.channels.filter((entry) => entry.id !== channelId),
      {
        ...nextChannel,
        id: channelId,
        type: input.type,
        name: input.name.trim() || nextChannel.name || channelId,
        primaryAgentId:
          nextPrimaryAgentId ||
          mergedWorkspaceBinding.agentIds[0] ||
          mergedWorkspaceBinding.groupAssignments.find((assignment) => assignment.agentId)?.agentId ||
          null,
        workspaces: workspaceBindings
      }
    ];
  });

  snapshotCache = null;
  return getChannelRegistry();
}

export async function disconnectWorkspaceChannel(input: {
  workspaceId: string;
  channelId: string;
}) {
  const channelId = slugify(input.channelId.trim());
  if (!channelId) {
    throw new Error("Channel id is required.");
  }

  await mutateChannelRegistry((registry) => {
    registry.channels = registry.channels
      .map((channel) => {
        if (channel.id !== channelId) {
          return channel;
        }

        const workspaceBindings = channel.workspaces.filter((entry) => entry.workspaceId !== input.workspaceId);
        const remainingCandidates = uniqueStrings([
          ...workspaceBindings.flatMap((binding) => binding.agentIds),
          ...workspaceBindings.flatMap((binding) =>
            binding.groupAssignments
              .filter((assignment) => assignment.enabled !== false && assignment.agentId)
              .map((assignment) => assignment.agentId as string)
          )
        ]);

        return {
          ...channel,
          primaryAgentId: channel.primaryAgentId && remainingCandidates.includes(channel.primaryAgentId)
            ? channel.primaryAgentId
            : remainingCandidates[0] ?? null,
          workspaces: workspaceBindings
        };
      })
      .filter((channel) => channel.workspaces.length > 0 || channel.primaryAgentId);
  });

  snapshotCache = null;
  return getChannelRegistry();
}

export async function deleteWorkspaceChannelEverywhere(input: {
  channelId: string;
}) {
  const channelId = slugify(input.channelId.trim());
  if (!channelId) {
    throw new Error("Channel id is required.");
  }

  const registry = await readChannelRegistry();
  const channel = registry.channels.find((entry) => entry.id === channelId);

  if (!channel) {
    throw new Error("Channel was not found.");
  }

  const removedGroupIds = uniqueStrings(
    channel.workspaces.flatMap((workspace) =>
      workspace.groupAssignments
        .filter((assignment) => Boolean(assignment.chatId))
        .map((assignment) => assignment.chatId)
    )
  );
  const workspacePaths = uniqueStrings(channel.workspaces.map((workspace) => workspace.workspacePath));

  if (channel.type !== "internal") {
    await runOpenClaw(
      ["channels", "remove", "--channel", channel.type, "--account", channelId, "--delete"],
      { timeoutMs: 60000 }
    );
  }

  await mutateChannelRegistry(
    (nextRegistry) => {
      nextRegistry.channels = nextRegistry.channels.filter((entry) => entry.id !== channelId);
    },
    {
      removedAccountIds: [channelId],
      removedGroupIds
    }
  );

  await Promise.all(workspacePaths.map((workspacePath) => removeWorkspaceProjectChannelReferences(workspacePath, channelId)));

  snapshotCache = null;
  return getChannelRegistry();
}

export async function setWorkspaceChannelPrimary(input: {
  channelId: string;
  primaryAgentId: string | null;
}) {
  const channelId = slugify(input.channelId.trim());
  if (!channelId) {
    throw new Error("Channel id is required.");
  }

  await mutateChannelRegistry((registry) => {
    const channel = registry.channels.find((entry) => entry.id === channelId);
    if (!channel) {
      throw new Error("Channel was not found.");
    }

    channel.primaryAgentId = normalizeOptionalValue(input.primaryAgentId) ?? null;
  });

  snapshotCache = null;
  return getChannelRegistry();
}

export async function setWorkspaceChannelGroups(input: {
  channelId: string;
  workspaceId: string;
  groupAssignments: WorkspaceChannelGroupAssignment[];
}) {
  const channelId = slugify(input.channelId.trim());
  if (!channelId) {
    throw new Error("Channel id is required.");
  }

  const removedGroupIds: string[] = [];

  await mutateChannelRegistry((registry) => {
    const channel = registry.channels.find((entry) => entry.id === channelId);
    if (!channel) {
      throw new Error("Channel was not found.");
    }

    const workspace = channel.workspaces.find((entry) => entry.workspaceId === input.workspaceId);
    if (!workspace) {
      throw new Error("Workspace binding was not found for this channel.");
    }

    const previousGroupIds = new Set(
      workspace.groupAssignments
        .filter((assignment) => assignment.enabled !== false && Boolean(assignment.chatId))
        .map((assignment) => assignment.chatId)
    );

    workspace.groupAssignments = uniqueByChatId(
      input.groupAssignments.map((assignment) => ({
        chatId: assignment.chatId.trim(),
        agentId: normalizeOptionalValue(assignment.agentId) ?? null,
        title: normalizeOptionalValue(assignment.title) ?? null,
        enabled: assignment.enabled !== false
      }))
    );
    workspace.agentIds = uniqueStrings([
      ...workspace.agentIds,
      ...workspace.groupAssignments
        .filter((assignment) => assignment.enabled !== false && assignment.agentId)
        .map((assignment) => assignment.agentId as string)
    ]);

    const nextGroupIds = new Set(
      workspace.groupAssignments
        .filter((assignment) => assignment.enabled !== false && Boolean(assignment.chatId))
        .map((assignment) => assignment.chatId)
    );

    for (const chatId of previousGroupIds) {
      if (!nextGroupIds.has(chatId)) {
        removedGroupIds.push(chatId);
      }
    }
  }, { removedGroupIds });

  snapshotCache = null;
  return getChannelRegistry();
}

export async function bindWorkspaceChannelAgent(input: {
  channelId: string;
  workspaceId: string;
  workspacePath: string;
  agentId: string;
}) {
  const channelId = slugify(input.channelId.trim());
  const agentId = slugify(input.agentId.trim());
  if (!channelId || !agentId) {
    throw new Error("Channel id and agent id are required.");
  }

  await mutateChannelRegistry((registry) => {
    const channel = registry.channels.find((entry) => entry.id === channelId);
    if (!channel) {
      throw new Error("Channel was not found.");
    }

    const workspace = channel.workspaces.find((entry) => entry.workspaceId === input.workspaceId);
    const nextWorkspace: WorkspaceChannelWorkspaceBinding =
      workspace ??
      ({
        workspaceId: input.workspaceId,
        workspacePath: input.workspacePath,
        agentIds: [],
        groupAssignments: []
      } satisfies WorkspaceChannelWorkspaceBinding);

    nextWorkspace.agentIds = uniqueStrings([...nextWorkspace.agentIds, agentId]);
    nextWorkspace.workspacePath = input.workspacePath;
    channel.workspaces = [
      ...channel.workspaces.filter((entry) => entry.workspaceId !== input.workspaceId),
      nextWorkspace
    ];

    if (!channel.primaryAgentId) {
      channel.primaryAgentId = agentId;
    }
  });

  snapshotCache = null;
  return getChannelRegistry();
}

export async function unbindWorkspaceChannelAgent(input: {
  channelId: string;
  workspaceId: string;
  agentId: string;
}) {
  const channelId = slugify(input.channelId.trim());
  const agentId = slugify(input.agentId.trim());
  if (!channelId || !agentId) {
    throw new Error("Channel id and agent id are required.");
  }

  await mutateChannelRegistry((registry) => {
    const channel = registry.channels.find((entry) => entry.id === channelId);
    if (!channel) {
      throw new Error("Channel was not found.");
    }

    const workspace = channel.workspaces.find((entry) => entry.workspaceId === input.workspaceId);
    if (!workspace) {
      return;
    }

    workspace.agentIds = workspace.agentIds.filter((entry) => entry !== agentId);
    workspace.groupAssignments = workspace.groupAssignments.filter((assignment) => assignment.agentId !== agentId);

    if (channel.primaryAgentId === agentId) {
      const fallbackAgent =
        workspace.agentIds[0] ??
        workspace.groupAssignments.find((assignment) => assignment.enabled !== false && assignment.agentId)?.agentId ??
        channel.workspaces
          .flatMap((binding) => binding.agentIds)
          .find((candidate) => candidate !== agentId) ??
        channel.workspaces
          .flatMap((binding) => binding.groupAssignments)
          .find((assignment) => assignment.enabled !== false && assignment.agentId && assignment.agentId !== agentId)
          ?.agentId ??
        null;
      channel.primaryAgentId = fallbackAgent;
    }

    channel.workspaces = [
      ...channel.workspaces.filter((entry) => entry.workspaceId !== input.workspaceId),
      {
        ...workspace,
        agentIds: workspace.agentIds,
        groupAssignments: workspace.groupAssignments
      }
    ];
  });

  snapshotCache = null;
  return getChannelRegistry();
}

export async function createWorkspaceProject(
  input: WorkspaceCreateInput,
  options: WorkspaceCreateOptions = {}
): Promise<WorkspaceCreateResult> {
  const normalized = resolveWorkspaceBootstrapInput(input);
  const enabledAgents = normalized.agents.filter((agent) => agent.enabled);
  const progress = createOperationProgressTracker({
    template: buildWorkspaceCreateProgressTemplate({
      sourceMode: normalized.sourceMode,
      agentCount: enabledAgents.length,
      kickoffMission: normalized.rules.kickoffMission
    }),
    onProgress: options.onProgress
  });

  if (enabledAgents.length === 0) {
    throw new Error("Enable at least one agent for the workspace.");
  }

  await progress.startStep(
    "validate",
    "Resolving workspace settings and reserving the target directory."
  );
  await progress.addActivity("validate", `Validated workspace name "${normalized.name}".`);

  const targetDir = await resolveWorkspaceCreationTargetDir(normalized);
  await progress.updateStep("validate", {
    percent: 38,
    detail: `Reserved target directory at ${targetDir}.`
  });
  await progress.addActivity("validate", `Reserved target directory ${targetDir}.`, "done");

  const snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
  await progress.updateStep("validate", {
    percent: 72,
    detail: "Checking current OpenClaw snapshot and agent ids."
  });
  assertWorkspaceBootstrapAgentIdsAvailable(snapshot, normalized.slug, enabledAgents);
  await progress.completeStep(
    "validate",
    `Workspace input and ${enabledAgents.length} agent configuration${enabledAgents.length === 1 ? "" : "s"} are ready.`
  );

  await progress.startStep("source", describeWorkspaceSourceStart(normalized.sourceMode, targetDir));
  await progress.addActivity("source", describeWorkspaceSourceActivity(normalized.sourceMode, normalized), "active");
  await materializeWorkspaceSource({
    targetDir,
    sourceMode: normalized.sourceMode,
    repoUrl: normalized.repoUrl,
    existingPath: normalized.existingPath
  });
  await progress.completeStep("source", describeWorkspaceSourceCompletion(normalized.sourceMode, targetDir));

  await progress.startStep("scaffold", "Writing the initial workspace scaffold and local metadata.");
  await progress.addActivity("scaffold", "Generating workspace docs, memory, and configuration files.");
  await scaffoldWorkspaceContents(targetDir, {
    name: normalized.name,
    brief: normalized.brief,
    template: normalized.template,
    teamPreset: normalized.teamPreset,
    modelProfile: normalized.modelProfile,
    rules: normalized.rules,
    docOverrides: normalized.docOverrides,
    sourceMode: normalized.sourceMode,
    agents: enabledAgents,
    contextSources: normalized.contextSources
  });
  await progress.completeStep("scaffold", "Workspace files and starter docs are in place.");

  const createdAgentIds: string[] = [];

  await progress.startStep(
    "agents",
    enabledAgents.length === 1
      ? "Provisioning the first workspace agent."
      : `Provisioning ${enabledAgents.length} workspace agents.`
  );

  for (const agent of enabledAgents) {
    const createdCount = createdAgentIds.length;
    const nextIndex = createdCount + 1;
    await progress.updateStep("agents", {
      percent: Math.round((createdCount / enabledAgents.length) * 100),
      detail: `Creating agent ${nextIndex} of ${enabledAgents.length}: ${agent.name}.`
    });
    await progress.addActivity("agents", `Creating ${agent.name} (${agent.role}).`);

    const createdAgentId = await createBootstrappedWorkspaceAgent({
      workspacePath: targetDir,
      workspaceSlug: normalized.slug,
      workspaceModelId: normalized.modelId,
      agent
    });
    createdAgentIds.push(createdAgentId);

    await progress.addActivity("agents", `Created ${agent.name} as ${createdAgentId}.`, "done");
    await progress.updateStep("agents", {
      percent: Math.round((createdAgentIds.length / enabledAgents.length) * 100),
      detail: `${createdAgentIds.length} of ${enabledAgents.length} agent${enabledAgents.length === 1 ? "" : "s"} ready.`
    });
  }
  await progress.completeStep(
    "agents",
    `${createdAgentIds.length} agent${createdAgentIds.length === 1 ? "" : "s"} linked to the workspace.`
  );

  await syncWorkspaceAgentPolicySkills(targetDir);

  const primaryAgentId =
    createdAgentIds.find((agentId) =>
      enabledAgents.some(
        (agent) => agent.isPrimary && createWorkspaceAgentId(normalized.slug, agent.id) === agentId
      )
    ) ?? createdAgentIds[0];

  let kickoffRunId: string | undefined;
  let kickoffStatus: string | undefined;
  let kickoffError: string | undefined;

  if (normalized.rules.kickoffMission) {
    await progress.startStep("kickoff", `Dispatching the kickoff mission to ${primaryAgentId}.`);
    await progress.addActivity("kickoff", `Selected ${primaryAgentId} as the primary agent.`);

    try {
      const kickoffResult = await runWorkspaceKickoffMission({
        agentId: primaryAgentId,
        brief: normalized.brief,
        modelProfile: normalized.modelProfile,
        template: normalized.template,
        rules: normalized.rules
      }, {
        onProgress: async ({ message, percent }) => {
          await progress.updateStep("kickoff", {
            percent,
            detail: message
          });
          await progress.addActivity(
            "kickoff",
            message,
            percent >= 100 ? "done" : "active"
          );
        }
      });
      kickoffRunId = kickoffResult.runId;
      kickoffStatus = kickoffResult.status;
      await progress.completeStep("kickoff", `Kickoff mission finished with status ${kickoffStatus || "unknown"}.`);
    } catch (error) {
      kickoffError =
        error instanceof Error ? error.message : "Kickoff mission could not be started.";
      await progress.addActivity("kickoff", kickoffError, "error");
      await progress.failStep("kickoff", kickoffError);
    }
  } else {
    await progress.startStep("kickoff", "Finalizing workspace bootstrap.");
    await progress.addActivity("kickoff", "Kickoff mission is disabled for this workspace.", "done");
    await progress.completeStep("kickoff", "Workspace bootstrap finished without kickoff.");
  }

  snapshotCache = null;
  runtimeHistoryCache = new Map();

  return {
    workspaceId: workspaceIdFromPath(targetDir),
    workspacePath: targetDir,
    agentIds: createdAgentIds,
    primaryAgentId,
    kickoffRunId,
    kickoffStatus,
    kickoffError
  };
}

export async function updateWorkspaceProject(input: WorkspaceUpdateInput) {
  const workspaceId = input.workspaceId.trim();

  if (!workspaceId) {
    throw new Error("Workspace id is required.");
  }

  if (input.plan) {
    const baseline = input.baseline ?? (await readWorkspaceEditSeed(workspaceId));
    const workspace = createWorkspaceProjectFromEditSeed(baseline);
    return applyWorkspacePlanEdits(workspace, input.plan, {
      name: input.name,
      directory: input.directory,
      baseline
    });
  }

  const snapshot = await getMissionControlSnapshot({ force: true });
  const workspace = snapshot.workspaces.find((entry) => entry.id === workspaceId);

  if (!workspace) {
    throw new Error("Workspace was not found.");
  }

  const targetPath = resolveWorkspaceTargetPath(workspace.path, input.name, input.directory);

  if (targetPath !== workspace.path) {
    await ensurePathAvailable(targetPath, workspace.path);

    try {
      await rename(workspace.path, targetPath);
    } catch (error) {
      throw new Error(
        error instanceof Error ? `Unable to move workspace directory. ${error.message}` : "Unable to move workspace directory."
      );
    }

    const configList = await readAgentConfigList(snapshot);
    const updatedConfig = configList.map((entry) =>
      entry.workspace === workspace.path
        ? {
            ...entry,
            workspace: targetPath,
            agentDir:
              typeof entry.agentDir === "string" && entry.agentDir.startsWith(`${workspace.path}${path.sep}`)
                ? path.join(targetPath, path.relative(workspace.path, entry.agentDir))
                : entry.agentDir
          }
        : entry
    );

    await writeAgentConfigList(updatedConfig);
  }

  snapshotCache = null;
  runtimeHistoryCache = new Map();

  return {
    workspaceId: workspaceIdFromPath(targetPath),
    previousWorkspaceId: workspace.id,
    workspacePath: targetPath
  };
}

function createWorkspaceProjectFromEditSeed(seed: WorkspaceEditSeed): WorkspaceProject {
  return {
    id: seed.workspaceId,
    name: seed.name,
    slug: slugify(path.basename(seed.workspacePath)),
    path: seed.workspacePath,
    kind: "workspace",
    agentIds: [],
    modelIds: [],
    activeRuntimeIds: [],
    totalSessions: 0,
    health: "standby",
    bootstrap: {
      template: null,
      sourceMode: null,
      agentTemplate: null,
      coreFiles: [],
      optionalFiles: [],
      folders: [],
      projectShell: [],
      localSkillIds: []
    },
    capabilities: {
      skills: [],
      tools: [],
      workspaceOnlyAgentCount: 0
    },
    channels: []
  };
}

async function applyWorkspacePlanEdits(
  workspace: WorkspaceProject,
  plan: WorkspacePlan,
  input: {
    name?: string;
    directory?: string;
    baseline: WorkspaceEditSeed;
  }
) {
  const desiredName = normalizeOptionalValue(input.name) ?? normalizeOptionalValue(plan.workspace.name) ?? workspace.name;
  const requestedDirectory = normalizeOptionalValue(input.directory);
  const baselineDirectory = normalizeOptionalValue(input.baseline.directory) ?? workspace.path;
  const baselineName = normalizeOptionalValue(input.baseline.name) ?? workspace.name;
  const baselineBrief = normalizeOptionalValue(input.baseline.brief) ?? "";
  const desiredBrief = normalizeOptionalValue(plan.company.mission) ?? normalizeOptionalValue(plan.product.offer) ?? "";
  const currentDocOverrides = normalizeWorkspaceDocOverrides(plan.workspace.docOverrides);
  const baselineDocOverrides = normalizeWorkspaceDocOverrides(input.baseline.docOverrides);
  const currentDocOverrideMap = new Map(currentDocOverrides.map((entry) => [entry.path, entry.content]));
  const baselineDocOverrideMap = new Map(baselineDocOverrides.map((entry) => [entry.path, entry.content]));
  const currentEnabledAgents = plan.team.persistentAgents.filter((agent) => agent.enabled);
  const baselineEnabledAgents = input.baseline.agents.filter((agent) => agent.enabled);
  const nameChanged = desiredName.trim() !== baselineName.trim();
  const scaffoldInputsChanged =
    nameChanged ||
    desiredBrief !== baselineBrief ||
    plan.workspace.template !== input.baseline.template ||
    plan.workspace.sourceMode !== input.baseline.sourceMode ||
    !areWorkspaceCreateRulesEqual(plan.workspace.rules, input.baseline.rules) ||
    !areWorkspaceAgentsEqual(currentEnabledAgents, baselineEnabledAgents);
  const directoryChanged = Boolean(requestedDirectory && requestedDirectory !== baselineDirectory);
  const targetPath = directoryChanged
    ? resolveWorkspaceTargetPath(workspace.path, undefined, requestedDirectory)
    : nameChanged
      ? resolveWorkspaceTargetPath(workspace.path, desiredName, undefined)
      : workspace.path;
  const workspaceRelocated = targetPath !== workspace.path;
  const snapshot = workspaceRelocated
    ? await getMissionControlSnapshot({ force: true, includeHidden: true })
    : null;

  if (workspaceRelocated) {
    await ensurePathAvailable(targetPath, workspace.path);

    try {
      await rename(workspace.path, targetPath);
    } catch (error) {
      throw new Error(
        error instanceof Error
          ? `Unable to move workspace directory. ${error.message}`
          : "Unable to move workspace directory."
      );
    }

    const configList = await readAgentConfigList(snapshot ?? undefined);
    const updatedConfig = configList.map((entry) =>
      entry.workspace === workspace.path
        ? {
            ...entry,
            workspace: targetPath,
            agentDir:
              typeof entry.agentDir === "string" && entry.agentDir.startsWith(`${workspace.path}${path.sep}`)
                ? path.join(targetPath, path.relative(workspace.path, entry.agentDir))
                : entry.agentDir
          }
        : entry
    );

    await writeAgentConfigList(updatedConfig);
  }

  const currentWorkspacePath = targetPath;
  const projectManifestPath = path.join(currentWorkspacePath, ".openclaw", "project.json");
  let createdAt = new Date().toISOString();
  let hidden = false;
  let systemTag: string | null = null;

  try {
    const raw = await readFile(projectManifestPath, "utf8");
    const parsed = JSON.parse(raw);

    if (isObjectRecord(parsed)) {
      createdAt = typeof parsed.createdAt === "string" ? parsed.createdAt : createdAt;
      hidden = parsed.hidden === true;
      systemTag = typeof parsed.systemTag === "string" ? parsed.systemTag : null;
    }
  } catch {
    // Ignore missing or unreadable metadata and write a fresh manifest below.
  }

  const manifestAgents = plan.team.persistentAgents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    role: agent.role,
    enabled: agent.enabled,
    emoji: normalizeOptionalValue(agent.emoji) ?? null,
    theme: normalizeOptionalValue(agent.theme) ?? null,
    isPrimary: Boolean(agent.isPrimary),
    skillId: normalizeOptionalValue(agent.skillId) ?? null,
    modelId: normalizeOptionalValue(agent.modelId) ?? null,
    policy: agent.policy ?? null
  }));
  const teamPreset: WorkspaceTeamPreset =
    manifestAgents.length <= 1
      ? "solo"
      : manifestAgents.every((agent) => agent.enabled)
        ? "core"
        : "custom";
  const projectManifest = {
    version: 1,
    slug: slugify(path.basename(currentWorkspacePath)),
    name: desiredName,
    directory: currentWorkspacePath,
    icon: getWorkspaceTemplateMeta(plan.workspace.template).icon,
    createdAt,
    updatedAt: new Date().toISOString(),
    template: plan.workspace.template,
    sourceMode: plan.workspace.sourceMode,
    teamPreset,
    modelProfile: plan.workspace.modelProfile,
    agentTemplate: teamPreset === "solo" ? "solo" : "core-team",
    rules: {
      workspaceOnly: plan.workspace.rules.workspaceOnly,
      generateStarterDocs: plan.workspace.rules.generateStarterDocs,
      generateMemory: plan.workspace.rules.generateMemory,
      kickoffMission: plan.workspace.rules.kickoffMission
    },
    contextSources: plan.intake.sources,
    hidden,
    systemTag,
    agents: manifestAgents
  };

  if (scaffoldInputsChanged) {
    const scaffoldDocuments = buildWorkspaceScaffoldDocuments({
      name: desiredName,
      brief: desiredBrief || desiredName,
      template: plan.workspace.template,
      sourceMode: plan.workspace.sourceMode,
      rules: plan.workspace.rules,
      agents: currentEnabledAgents,
      toolExamples: await detectWorkspaceToolExamples(currentWorkspacePath),
      docOverrides: currentDocOverrides,
      contextSources: plan.intake.sources
    });
    const scaffoldPathSet = new Set(scaffoldDocuments.map((document) => document.path));

    for (const document of scaffoldDocuments) {
      await writeTextFileEnsured(path.join(currentWorkspacePath, document.path), document.content);
    }

    for (const override of currentDocOverrides) {
      if (scaffoldPathSet.has(override.path)) {
        continue;
      }

      await writeTextFileEnsured(path.join(currentWorkspacePath, override.path), override.content);
    }
  } else {
    const scaffoldDocuments = buildWorkspaceScaffoldDocuments({
      name: baselineName,
      brief: baselineBrief || baselineName,
      template: input.baseline.template,
      sourceMode: input.baseline.sourceMode,
      rules: input.baseline.rules,
      agents: baselineEnabledAgents,
      toolExamples: [],
      docOverrides: [],
      contextSources: input.baseline.contextSources ?? []
    });
    const scaffoldPathSet = new Set(scaffoldDocuments.map((document) => document.path));

    for (const override of currentDocOverrides) {
      const baselineContent = baselineDocOverrideMap.get(override.path);

      if (baselineContent === override.content) {
        continue;
      }

      await writeTextFileEnsured(path.join(currentWorkspacePath, override.path), override.content);
    }

    for (const baselineOverride of baselineDocOverrides) {
      if (currentDocOverrideMap.has(baselineOverride.path)) {
        continue;
      }

      const scaffoldDocument = scaffoldDocuments.find((document) => document.path === baselineOverride.path);

      if (!scaffoldDocument || !scaffoldPathSet.has(scaffoldDocument.path)) {
        continue;
      }

      await writeTextFileEnsured(path.join(currentWorkspacePath, scaffoldDocument.path), scaffoldDocument.baseContent);
    }
  }

  if (workspaceRelocated || !areWorkspaceAgentsEqual(currentEnabledAgents, baselineEnabledAgents)) {
    const currentWorkspace = {
      ...workspace,
      id: workspaceIdFromPath(currentWorkspacePath),
      path: currentWorkspacePath
    };

    await syncWorkspaceAgentsToPlan({
      currentWorkspace,
      desiredAgents: plan.team.persistentAgents,
      workspaceSlug: slugify(path.basename(currentWorkspacePath)),
      previousWorkspaceId: input.baseline.workspaceId,
      previousWorkspacePath: input.baseline.workspacePath
    });
  }

  await writeTextFileEnsured(projectManifestPath, `${JSON.stringify(projectManifest, null, 2)}\n`);

  snapshotCache = null;
  runtimeHistoryCache = new Map();

  return {
    workspaceId: workspaceIdFromPath(currentWorkspacePath),
    previousWorkspaceId: workspace.id,
    workspacePath: currentWorkspacePath
  };
}

async function syncWorkspaceAgentsToPlan(input: {
  currentWorkspace: WorkspaceProject;
  desiredAgents: WorkspaceAgentBlueprintInput[];
  workspaceSlug: string;
  previousWorkspaceId?: string;
  previousWorkspacePath?: string;
}) {
  const snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
  const currentAgents = Array.from(
    new Map(
      snapshot.agents
        .filter((agent) => {
          if (agent.workspaceId === input.currentWorkspace.id) {
            return true;
          }

          if (input.previousWorkspaceId && agent.workspaceId === input.previousWorkspaceId) {
            return true;
          }

          return Boolean(input.previousWorkspacePath && agent.workspacePath === input.previousWorkspacePath);
        })
        .map((agent) => [agent.id, agent])
    ).values()
  );
  const matchedAgentIds = new Set<string>();

  for (const desiredAgent of input.desiredAgents) {
    const currentAgent = findMatchingWorkspaceAgent(currentAgents, input.workspaceSlug, desiredAgent.id);

    if (!desiredAgent.enabled) {
      if (currentAgent) {
        matchedAgentIds.add(currentAgent.id);
        await deleteAgent({ agentId: currentAgent.id });
      }

      continue;
    }

    if (currentAgent) {
      matchedAgentIds.add(currentAgent.id);
      await updateAgent({
        id: currentAgent.id,
        workspaceId: input.currentWorkspace.id,
        workspacePath: input.currentWorkspace.path,
        name: normalizeOptionalValue(desiredAgent.name) ?? currentAgent.name,
        emoji: normalizeOptionalValue(desiredAgent.emoji) ?? currentAgent.identity.emoji,
        theme: normalizeOptionalValue(desiredAgent.theme) ?? currentAgent.identity.theme,
        modelId: normalizeOptionalValue(desiredAgent.modelId) ?? (currentAgent.modelId === "unassigned" ? undefined : currentAgent.modelId),
        policy: desiredAgent.policy,
        heartbeat: desiredAgent.heartbeat,
        channelIds: desiredAgent.channelIds
      });
      continue;
    }

    const createdAgentId = await createAgent({
      id: createWorkspaceAgentId(input.workspaceSlug, desiredAgent.id),
      workspaceId: input.currentWorkspace.id,
      workspacePath: input.currentWorkspace.path,
      name: normalizeOptionalValue(desiredAgent.name) ?? undefined,
      emoji: normalizeOptionalValue(desiredAgent.emoji) ?? undefined,
      theme: normalizeOptionalValue(desiredAgent.theme) ?? undefined,
      modelId: normalizeOptionalValue(desiredAgent.modelId) ?? undefined,
      policy: desiredAgent.policy,
      heartbeat: desiredAgent.heartbeat,
      channelIds: desiredAgent.channelIds
    });

    matchedAgentIds.add(createdAgentId.agentId);
  }

  for (const currentAgent of currentAgents) {
    if (!matchedAgentIds.has(currentAgent.id)) {
      await deleteAgent({ agentId: currentAgent.id });
    }
  }
}

export async function deleteWorkspaceProject(input: WorkspaceDeleteInput) {
  const workspaceId = input.workspaceId.trim();

  if (!workspaceId) {
    throw new Error("Workspace id is required.");
  }

  const snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
  const workspace = snapshot.workspaces.find((entry) => entry.id === workspaceId);

  if (!workspace) {
    throw new Error("Workspace was not found.");
  }

  const workspaceAgents = snapshot.agents.filter((agent) => agent.workspaceId === workspace.id);
  const runtimeCount = snapshot.runtimes.filter((runtime) => runtime.workspaceId === workspace.id).length;

  for (const agent of workspaceAgents) {
    await runOpenClaw(["agents", "delete", agent.id, "--force", "--json"]);
  }

  try {
    const configList = await readAgentConfigList(snapshot);
    const nextConfigList = configList.filter(
      (entry) => entry.workspace !== workspace.path && !workspaceAgents.some((agent) => agent.id === entry.id)
    );

    if (nextConfigList.length !== configList.length) {
      await writeAgentConfigList(nextConfigList);
    }
  } catch {
    // Ignore config cleanup failures if the agent delete command already pruned state.
  }

  await rm(workspace.path, { recursive: true, force: true });

  clearMissionControlCaches();

  return {
    workspaceId: workspace.id,
    workspacePath: workspace.path,
    deletedAgentIds: workspaceAgents.map((agent) => agent.id),
    deletedRuntimeCount: runtimeCount
  };
}

export async function updateGatewayRemoteUrl(input: { gatewayUrl?: string | null }) {
  const gatewayUrl = normalizeGatewayRemoteUrl(input.gatewayUrl);

  if (gatewayUrl) {
    await runOpenClaw(["config", "set", GATEWAY_REMOTE_URL_CONFIG_KEY, gatewayUrl]);
  } else if (await hasGatewayRemoteUrlConfig()) {
    await runOpenClaw(["config", "unset", GATEWAY_REMOTE_URL_CONFIG_KEY]);
  }

  snapshotCache = null;
  runtimeHistoryCache = new Map();

  return getMissionControlSnapshot({ force: true });
}

export async function updateWorkspaceRoot(input: { workspaceRoot?: string | null }) {
  const workspaceRoot = normalizeWorkspaceRoot(input.workspaceRoot);
  const settings = await readMissionControlSettings();

  await writeMissionControlSettings({
    ...(workspaceRoot ? { workspaceRoot } : {}),
    ...(settings.runtimePreflight ? { runtimePreflight: settings.runtimePreflight } : {})
  });

  snapshotCache = null;
  runtimeHistoryCache = new Map();

  return getMissionControlSnapshot({ force: true });
}

function normalizeGatewayRemoteUrl(value: string | null | undefined) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `ws://${trimmed}`;
  let parsed: URL;

  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("Gateway address must be a valid WebSocket URL.");
  }

  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    throw new Error("Gateway address must start with ws:// or wss://.");
  }

  if (!parsed.hostname) {
    throw new Error("Gateway address must include a hostname.");
  }

  return parsed.toString().replace(/\/$/, "");
}

function normalizeWorkspaceRoot(value: string | null | undefined) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed !== "~" && !trimmed.startsWith("~/") && !path.isAbsolute(trimmed)) {
    throw new Error("Workspace root must be an absolute path or start with ~/.");
  }

  return normalizeConfiguredWorkspaceRootValue(trimmed);
}

function normalizeConfiguredWorkspaceRootValue(value: string | null | undefined) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return undefined;
  }

  const expanded = expandHomeRelativePath(trimmed);
  const normalized = path.normalize(expanded);

  return normalized.length > 1 ? normalized.replace(/[\\/]+$/, "") : normalized;
}

function expandHomeRelativePath(value: string) {
  if (value === "~") {
    return os.homedir();
  }

  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }

  return value;
}

async function hasGatewayRemoteUrlConfig() {
  try {
    await runOpenClaw(["config", "get", GATEWAY_REMOTE_URL_CONFIG_KEY, "--json"]);
    return true;
  } catch (error) {
    const detail = stringifyCommandFailure(error);

    if (detail.includes("Config path not found")) {
      return false;
    }

    throw error;
  }
}

async function getConfiguredWorkspaceRoot() {
  const settings = await readMissionControlSettings();
  return normalizeConfiguredWorkspaceRootValue(settings.workspaceRoot) ?? null;
}

async function readMissionControlSettings(): Promise<MissionControlSettings> {
  let raw: string;

  try {
    raw = await readFile(missionControlSettingsPath, "utf8");
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined;

    if (code === "ENOENT") {
      return {};
    }

    throw error;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const workspaceRoot =
      typeof parsed.workspaceRoot === "string"
        ? normalizeConfiguredWorkspaceRootValue(parsed.workspaceRoot)
        : undefined;
    const runtimePreflight = normalizeRuntimePreflightSettings(
      typeof parsed.runtimePreflight === "object" && parsed.runtimePreflight ? parsed.runtimePreflight : undefined
    );

    return {
      ...(workspaceRoot ? { workspaceRoot } : {}),
      ...(runtimePreflight ? { runtimePreflight } : {})
    };
  } catch {
    return {};
  }
}

async function writeMissionControlSettings(settings: MissionControlSettings) {
  await mkdir(missionControlRootPath, { recursive: true });
  await writeFile(missionControlSettingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

function normalizeRuntimePreflightSettings(value: unknown): MissionControlSettings["runtimePreflight"] | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const smokeTestsSource =
    "smokeTests" in value && value.smokeTests && typeof value.smokeTests === "object"
      ? (value.smokeTests as Record<string, unknown>)
      : {};
  const smokeTests = Object.entries(smokeTestsSource).reduce<Record<string, RuntimeSmokeTestCacheEntry>>(
    (result, [agentId, entry]) => {
      if (!entry || typeof entry !== "object") {
        return result;
      }

      const normalizedEntry = entry as Record<string, unknown>;

      const checkedAt = typeof normalizedEntry.checkedAt === "string" ? normalizedEntry.checkedAt : null;
      const status =
        normalizedEntry.status === "passed" || normalizedEntry.status === "failed"
          ? normalizedEntry.status
          : null;

      if (!checkedAt || !status) {
        return result;
      }

      result[agentId] = {
        status,
        checkedAt,
        ...(typeof normalizedEntry.runId === "string" ? { runId: normalizedEntry.runId } : {}),
        ...(typeof normalizedEntry.summary === "string" ? { summary: normalizedEntry.summary } : {}),
        ...(typeof normalizedEntry.error === "string" ? { error: normalizedEntry.error } : {})
      };
      return result;
    },
    {}
  );

  return Object.keys(smokeTests).length > 0 ? { smokeTests } : undefined;
}

function listRuntimeSmokeTestEntries(settings: MissionControlSettings) {
  return Object.entries(settings.runtimePreflight?.smokeTests ?? {}).sort((left, right) => {
    const leftTs = Date.parse(left[1].checkedAt);
    const rightTs = Date.parse(right[1].checkedAt);
    return rightTs - leftTs;
  });
}

function getRuntimeSmokeTestCacheEntry(settings: MissionControlSettings, agentId: string) {
  return settings.runtimePreflight?.smokeTests?.[agentId] ?? null;
}

function mapRuntimeSmokeTestEntry(
  agentId: string | null,
  entry: RuntimeSmokeTestCacheEntry | null
): OpenClawRuntimeSmokeTest {
  if (!entry || !agentId) {
    return {
      status: "not-run",
      checkedAt: null,
      agentId: null,
      runId: null,
      summary: null,
      error: null
    };
  }

  return {
    status: entry.status,
    checkedAt: entry.checkedAt,
    agentId,
    runId: entry.runId ?? null,
    summary: entry.summary ?? null,
    error: entry.error ?? null
  };
}

function getLatestRuntimeSmokeTest(settings: MissionControlSettings): OpenClawRuntimeSmokeTest {
  const latest = listRuntimeSmokeTestEntries(settings)[0];
  return mapRuntimeSmokeTestEntry(latest?.[0] ?? null, latest?.[1] ?? null);
}

function isRuntimeSmokeTestFresh(entry: RuntimeSmokeTestCacheEntry | null) {
  if (!entry || entry.status !== "passed") {
    return false;
  }

  const checkedAt = Date.parse(entry.checkedAt);
  return Number.isFinite(checkedAt) && Date.now() - checkedAt <= runtimeSmokeTestTtlMs;
}

async function persistRuntimeSmokeTest(result: OpenClawRuntimeSmokeTest) {
  const settings = await readMissionControlSettings();
  const smokeTests = {
    ...(settings.runtimePreflight?.smokeTests ?? {})
  };

  if (!result.agentId || result.status === "not-run" || !result.checkedAt) {
    return;
  }

  smokeTests[result.agentId] = {
    status: result.status,
    checkedAt: result.checkedAt,
    ...(result.runId ? { runId: result.runId } : {}),
    ...(result.summary ? { summary: result.summary } : {}),
    ...(result.error ? { error: result.error } : {})
  };

  await writeMissionControlSettings({
    ...(settings.workspaceRoot ? { workspaceRoot: settings.workspaceRoot } : {}),
    runtimePreflight: {
      smokeTests
    }
  });
}

function buildOpenClawSessionStorePath(agentId: string) {
  return path.join(openClawStateRootPath, "agents", agentId, "sessions");
}

function formatRuntimeWriteabilityIssue(targetPath: string, error: unknown) {
  if (!error || typeof error !== "object") {
    return `${targetPath}: unknown filesystem error`;
  }

  const code =
    "code" in error && typeof error.code === "string"
      ? error.code
      : "unknown";
  const message =
    "message" in error && typeof error.message === "string"
      ? error.message
      : "unknown filesystem error";

  return `${targetPath}: ${code} ${message}`;
}

async function probeDirectoryWriteability(
  targetPath: string,
  options: {
    createIfMissing?: boolean;
    touch?: boolean;
  } = {}
) {
  try {
    if (options.createIfMissing !== false) {
      await mkdir(targetPath, { recursive: true });
    }

    await access(targetPath, fsConstants.R_OK | fsConstants.W_OK);

    if (options.touch) {
      const probeFilePath = path.join(
        targetPath,
        `.agentos-write-check-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
      );

      await writeFile(probeFilePath, "", "utf8");
      await rm(probeFilePath, { force: true });
    }

    return {
      writable: true,
      issue: null
    };
  } catch (error) {
    return {
      writable: false,
      issue: formatRuntimeWriteabilityIssue(targetPath, error)
    };
  }
}

async function inspectOpenClawRuntimeState(
  agentIds: string[],
  options: {
    touch?: boolean;
  } = {}
) {
  const uniqueAgentIds = [...new Set(agentIds.filter(Boolean))];
  const stateRootProbe = await probeDirectoryWriteability(openClawStateRootPath, {
    createIfMissing: true,
    touch: options.touch
  });
  const sessionStores = await Promise.all(
    uniqueAgentIds.map(async (agentId) => {
      const storePath = buildOpenClawSessionStorePath(agentId);
      const probe = await probeDirectoryWriteability(storePath, {
        createIfMissing: true,
        touch: options.touch
      });

      return {
        id: agentId,
        path: storePath,
        writable: probe.writable,
        issue: probe.issue
      };
    })
  );
  const sessionStoreWritable = sessionStores.every((entry) => entry.writable);
  const issues = [
    stateRootProbe.writable
      ? null
      : `OpenClaw state root is not writable. ${stateRootProbe.issue ?? openClawStateRootPath}`,
    ...sessionStores
      .filter((entry) => !entry.writable)
      .map((entry) => `OpenClaw session store for ${entry.id} is not writable. ${entry.issue ?? entry.path}`)
  ].filter((value): value is string => Boolean(value));

  return {
    stateRoot: openClawStateRootPath,
    stateWritable: stateRootProbe.writable,
    sessionStoreWritable: stateRootProbe.writable && sessionStoreWritable,
    sessionStores,
    issues
  };
}

async function buildRuntimeDiagnostics(agentIds: string[], settings: MissionControlSettings) {
  const runtimeState = await inspectOpenClawRuntimeState(agentIds);
  const smokeTest = getLatestRuntimeSmokeTest(settings);
  const issues = [
    ...runtimeState.issues,
    ...(smokeTest.status === "failed" && smokeTest.error
      ? [
          `Latest runtime smoke test failed for ${smokeTest.agentId ?? "unknown agent"}. ${smokeTest.error}`
        ]
      : [])
  ];

  return {
    ...runtimeState,
    smokeTest,
    issues
  } satisfies MissionControlSnapshot["diagnostics"]["runtime"];
}

function stringifyCommandFailure(error: unknown) {
  if (!error || typeof error !== "object") {
    return "";
  }

  const stdout = "stdout" in error ? stringifyFailureChunk(error.stdout) : "";
  const stderr = "stderr" in error ? stringifyFailureChunk(error.stderr) : "";
  const message = "message" in error && typeof error.message === "string" ? error.message : "";

  return `${message}\n${stdout}\n${stderr}`;
}

function stringifyFailureChunk(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString();
  }

  return "";
}

type ResolvedWorkspaceBootstrapInput = {
  name: string;
  slug: string;
  brief?: string;
  directory?: string;
  modelId?: string;
  repoUrl?: string;
  existingPath?: string;
  sourceMode: WorkspaceSourceMode;
  template: WorkspaceTemplate;
  teamPreset: NonNullable<WorkspaceCreateInput["teamPreset"]>;
  modelProfile: WorkspaceModelProfile;
  rules: WorkspaceCreateRules;
  docOverrides: WorkspaceDocOverride[];
  agents: WorkspaceAgentBlueprintInput[];
  contextSources: PlannerContextSource[];
};

async function materializeWorkspaceSource(params: {
  targetDir: string;
  sourceMode: WorkspaceSourceMode;
  repoUrl?: string;
  existingPath?: string;
}) {
  if (params.sourceMode === "existing") {
    await ensureExistingDirectory(params.targetDir);
    return;
  }

  if (params.sourceMode === "clone") {
    const repoUrl = normalizeOptionalValue(params.repoUrl);

    if (!repoUrl) {
      throw new Error("Repository URL is required when cloning a repo.");
    }

    await ensurePathAvailable(params.targetDir, "");
    await mkdir(path.dirname(params.targetDir), { recursive: true });
    await runSystemCommand("git", ["clone", repoUrl, params.targetDir]);
    return;
  }

  await ensureFreshWorkspaceDirectory(params.targetDir);
}

async function scaffoldWorkspaceContents(
  workspacePath: string,
  options: {
    name: string;
    brief?: string;
    template: WorkspaceTemplate;
    teamPreset: NonNullable<WorkspaceCreateInput["teamPreset"]>;
    modelProfile: WorkspaceModelProfile;
    rules: WorkspaceCreateRules;
    sourceMode: WorkspaceSourceMode;
    docOverrides: WorkspaceDocOverride[];
    agents: WorkspaceAgentBlueprintInput[];
    contextSources: WorkspaceScaffoldDocumentContext["contextSources"];
  }
) {
  const templateMeta = getWorkspaceTemplateMeta(options.template);
  const createdAt = new Date().toISOString();
  const toolExamples = await detectWorkspaceToolExamples(workspacePath);

  await ensureWorkspaceGitignore(workspacePath);
  await mkdir(path.join(workspacePath, "skills"), { recursive: true });
  await mkdir(path.join(workspacePath, ".openclaw", "project-shell", "runs"), { recursive: true });
  await mkdir(path.join(workspacePath, ".openclaw", "project-shell", "tasks"), { recursive: true });

  await writeTextFileIfMissing(path.join(workspacePath, ".openclaw", "project-shell", "events.jsonl"), "");
  await writeTextFileIfMissing(
    path.join(workspacePath, ".openclaw", "project.json"),
    `${JSON.stringify(
      {
        version: 1,
        slug: slugify(options.name),
        name: options.name,
        icon: templateMeta.icon,
        createdAt,
        updatedAt: createdAt,
        template: options.template,
        sourceMode: options.sourceMode,
        teamPreset: options.teamPreset,
        modelProfile: options.modelProfile,
        agentTemplate: options.teamPreset === "solo" ? "solo" : "core-team",
        rules: {
          workspaceOnly: options.rules.workspaceOnly,
          generateStarterDocs: options.rules.generateStarterDocs,
          generateMemory: options.rules.generateMemory,
          kickoffMission: options.rules.kickoffMission
        },
        contextSources: options.contextSources,
        agents: options.agents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          role: agent.role,
          enabled: agent.enabled,
          emoji: normalizeOptionalValue(agent.emoji) ?? null,
          theme: normalizeOptionalValue(agent.theme) ?? null,
          isPrimary: Boolean(agent.isPrimary),
          skillId: normalizeOptionalValue(agent.skillId) ?? null,
          modelId: normalizeOptionalValue(agent.modelId) ?? null,
          policy: agent.policy ?? null
        }))
      },
      null,
      2
    )}\n`
  );

  const scaffoldDocuments = buildWorkspaceScaffoldDocuments({
    name: options.name,
    brief: options.brief,
    template: options.template,
    sourceMode: options.sourceMode,
    rules: options.rules,
    agents: options.agents,
    toolExamples,
    docOverrides: options.docOverrides,
    contextSources: options.contextSources
  });

  for (const document of scaffoldDocuments) {
    await writeTextFileIfMissing(path.join(workspacePath, document.path), document.content);
  }

  for (const agent of options.agents) {
    const skillId = normalizeOptionalValue(agent.skillId);

    if (!skillId) {
      continue;
    }

    await mkdir(path.join(workspacePath, "skills", skillId), { recursive: true });
    await writeTextFileIfMissing(
      path.join(workspacePath, "skills", skillId, "SKILL.md"),
      renderSkillMarkdown(skillId, agent.role)
    );
  }
}

const workspaceGitignoreManagedEntries = [
  ".openclaw/agents/",
  ".openclaw/project-shell/events.jsonl",
  ".openclaw/project-shell/runs/",
  ".openclaw/project-shell/tasks/"
] as const;

async function ensureWorkspaceGitignore(workspacePath: string) {
  const gitignorePath = path.join(workspacePath, ".gitignore");
  let existing = "";

  try {
    existing = await readFile(gitignorePath, "utf8");
  } catch {
    existing = "";
  }

  const missingEntries = workspaceGitignoreManagedEntries.filter((entry) => !existing.includes(entry));

  if (missingEntries.length === 0) {
    return;
  }

  const managedBlock = ["# OpenClaw local runtime state", ...missingEntries].join("\n");
  const nextContents =
    existing.trim().length > 0 ? `${existing.trimEnd()}\n\n${managedBlock}\n` : `${managedBlock}\n`;

  await writeTextFileEnsured(gitignorePath, nextContents);
}

async function createBootstrappedWorkspaceAgent(params: {
  workspacePath: string;
  workspaceSlug: string;
  workspaceModelId?: string;
  agent: WorkspaceAgentBlueprintInput;
}) {
  const agentId = createWorkspaceAgentId(params.workspaceSlug, params.agent.id);
  const modelId =
    normalizeOptionalValue(params.agent.modelId) ?? normalizeOptionalValue(params.workspaceModelId);
  const policy = resolveAgentPolicy(
    params.agent.policy?.preset ?? inferAgentPresetFromContext({
      skills: params.agent.skillId ? [params.agent.skillId] : [],
      id: agentId,
      name: params.agent.name
    }),
    params.agent.policy
  );
  const args = [
    "agents",
    "add",
    agentId,
    "--workspace",
    params.workspacePath,
    "--agent-dir",
    buildWorkspaceAgentStatePath(params.workspacePath, agentId),
    "--non-interactive",
    "--json"
  ];

  if (modelId) {
    args.push("--model", modelId);
  }

  await runOpenClaw(args);

  const policySkillId = await ensureAgentPolicySkill({
    workspacePath: params.workspacePath,
    agentId,
    agentName: params.agent.name,
    policy
  });

  const configEntry = await upsertAgentConfigEntry(agentId, params.workspacePath, {
    name: normalizeOptionalValue(params.agent.name),
    model: modelId,
    heartbeat: serializeHeartbeatConfig(params.agent.heartbeat),
    skills: [normalizeOptionalValue(params.agent.skillId), policySkillId].filter((value): value is string => Boolean(value)),
    tools: policy.fileAccess === "workspace-only"
      ? {
          fs: {
            workspaceOnly: true
          }
        }
      : null
  });

  await applyAgentIdentity(agentId, params.workspacePath, {
    name: normalizeOptionalValue(params.agent.name) ?? configEntry.name,
    emoji: normalizeOptionalValue(params.agent.emoji),
    theme: normalizeOptionalValue(params.agent.theme)
  }, buildWorkspaceAgentStatePath(params.workspacePath, agentId));

  return agentId;
}

async function runWorkspaceKickoffMission(
  params: {
    agentId: string;
    brief?: string;
    modelProfile: WorkspaceModelProfile;
    template: WorkspaceTemplate;
    rules: WorkspaceCreateRules;
  },
  options: {
    onProgress?: KickoffProgressHandler;
  } = {}
) {
  const prompt = buildWorkspaceKickoffPrompt(params.template, params.brief, params.rules);
  const thinking =
    params.modelProfile === "fast"
      ? "low"
      : params.modelProfile === "quality"
        ? "high"
        : "medium";

  await options.onProgress?.({
    message: "Submitting the kickoff brief to the primary agent.",
    percent: 18
  });

  const result = await runOpenClawJsonStream<MissionCommandPayload>(
    [
      "agent",
      "--agent",
      params.agentId,
      "--message",
      prompt,
      "--thinking",
      thinking,
      "--timeout",
      "90",
      "--json"
    ],
    {
      timeoutMs: 120000,
      onStdout: async (text: string) => {
        const messages = extractKickoffProgressMessages(text);

        if (messages.length === 0 && text.trim()) {
          await options.onProgress?.({
            message: "Primary agent responded. Finalizing kickoff output.",
            percent: 82
          });
          return;
        }

        for (const message of messages) {
          await options.onProgress?.({
            message,
            percent: 72
          });
        }
      },
      onStderr: async (text: string) => {
        const stderr = text.trim();

        if (!stderr) {
          return;
        }

        await options.onProgress?.({
          message: `Kickoff runtime: ${stderr.split(/\r?\n/)[0]}`,
          percent: 64
        });
      }
    }
  );

  await options.onProgress?.({
    message: "Kickoff mission completed. Recording the resulting run metadata.",
    percent: 100
  });

  return result;
}

function describeWorkspaceSourceStart(sourceMode: WorkspaceSourceMode, targetDir: string) {
  if (sourceMode === "clone") {
    return `Cloning the source repository into ${targetDir}.`;
  }

  if (sourceMode === "existing") {
    return `Preparing the existing workspace folder at ${targetDir}.`;
  }

  return `Creating a fresh workspace folder at ${targetDir}.`;
}

function describeWorkspaceSourceActivity(
  sourceMode: WorkspaceSourceMode,
  normalized: ResolvedWorkspaceBootstrapInput
) {
  if (sourceMode === "clone") {
    return normalized.repoUrl
      ? `Cloning ${normalized.repoUrl}.`
      : "Cloning the requested repository.";
  }

  if (sourceMode === "existing") {
    return normalized.existingPath
      ? `Attaching ${normalized.existingPath}.`
      : "Attaching the requested folder.";
  }

  return "Preparing an empty workspace scaffold.";
}

function describeWorkspaceSourceCompletion(sourceMode: WorkspaceSourceMode, targetDir: string) {
  if (sourceMode === "clone") {
    return `Repository content is available at ${targetDir}.`;
  }

  if (sourceMode === "existing") {
    return `Existing folder linked and ready at ${targetDir}.`;
  }

  return `Fresh workspace folder created at ${targetDir}.`;
}

function extractKickoffProgressMessages(text: string) {
  const trimmed = text.trim();

  if (!trimmed) {
    return [];
  }

  const normalized = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[>•*-]\s*/, ""))
    .filter((line) => !line.startsWith("{") && !line.startsWith("["));

  return Array.from(new Set(normalized)).slice(0, 3);
}

function resolveWorkspaceBootstrapInput(input: WorkspaceCreateInput): ResolvedWorkspaceBootstrapInput {
  const name = input.name.trim();

  if (!name) {
    throw new Error("Workspace name is required.");
  }

  const slug = slugify(name);

  if (!slug) {
    throw new Error("Workspace name must include letters or numbers.");
  }

  const template = input.template ?? "software";
  const teamPreset = input.teamPreset ?? "core";
  const sourceMode = input.sourceMode ?? "empty";
  const modelProfile = input.modelProfile ?? "balanced";
  const rules: WorkspaceCreateRules = {
    ...DEFAULT_WORKSPACE_RULES,
    ...(input.rules ?? {})
  };
  const normalizedAgents = (input.agents?.length
    ? input.agents
    : buildDefaultWorkspaceAgents(template, teamPreset, name)
  ).map((agent) => ({
    id: slugify(agent.id) || "agent",
    role: agent.role.trim() || prettifyAgentName(agent.id),
    name:
      normalizeOptionalValue(agent.name) ??
      (agent.isPrimary
        ? buildWorkspaceAgentName(name, agent.role, prettifyAgentName(agent.id))
        : prettifyAgentName(agent.id)),
    enabled: agent.enabled !== false,
    emoji: normalizeOptionalValue(agent.emoji),
    theme: normalizeOptionalValue(agent.theme),
    skillId: normalizeOptionalValue(agent.skillId),
    modelId: normalizeOptionalValue(agent.modelId),
    isPrimary: Boolean(agent.isPrimary),
    heartbeat: resolveHeartbeatDraft(
      agent.policy?.preset ??
        inferAgentPresetFromContext({
          skills: agent.skillId ? [agent.skillId] : [],
          id: agent.id,
          name: agent.name
        }),
      agent.heartbeat
    ),
    policy: resolveAgentPolicy(
      agent.policy?.preset ??
        inferAgentPresetFromContext({
          skills: agent.skillId ? [agent.skillId] : [],
          id: agent.id,
          name: agent.name
        }),
      {
        ...agent.policy,
        fileAccess: rules.workspaceOnly ? agent.policy?.fileAccess ?? "workspace-only" : "extended"
      }
    )
  }));

  if (!normalizedAgents.some((agent) => agent.enabled && agent.isPrimary)) {
    const firstEnabledAgent = normalizedAgents.find((agent) => agent.enabled);
    if (firstEnabledAgent) {
      firstEnabledAgent.isPrimary = true;
    }
  }

  const duplicateEnabledAgentIds = findDuplicateStrings(
    normalizedAgents.filter((agent) => agent.enabled).map((agent) => agent.id)
  );

  if (duplicateEnabledAgentIds.length > 0) {
    throw new Error(
      `Enabled agents must have unique ids. Conflicts: ${duplicateEnabledAgentIds.join(", ")}.`
    );
  }

  return {
    name,
    slug,
    brief: normalizeOptionalValue(input.brief),
    directory: normalizeOptionalValue(input.directory),
    modelId: normalizeOptionalValue(input.modelId),
    repoUrl: normalizeOptionalValue(input.repoUrl),
    existingPath: normalizeOptionalValue(input.existingPath),
    sourceMode,
    template,
    teamPreset,
    modelProfile,
    rules,
    docOverrides: normalizeWorkspaceDocOverrides(input.docOverrides),
    agents: normalizedAgents,
    contextSources: normalizeWorkspaceContextSources(input.contextSources)
  };
}

function normalizeWorkspaceContextSources(
  sources?: WorkspaceCreateInput["contextSources"]
): PlannerContextSource[] {
  return (sources ?? []).flatMap((source) => {
    if (!source || typeof source !== "object") {
      return [];
    }

    const kind = isPlannerContextSourceKind(source.kind) ? source.kind : "prompt";
    const label = normalizeOptionalValue(source.label) ?? kind;
    const summary = normalizeOptionalValue(source.summary) ?? label;
    const status = source.status === "error" ? "error" : "ready";
    const createdAt = normalizeOptionalValue(source.createdAt) ?? new Date().toISOString();

    if (!label || !summary) {
      return [];
    }

    return [
      {
        id: normalizeOptionalValue(source.id) ?? `${kind}-${slugify(label) || "context"}`,
        kind,
        label,
        summary,
        details: Array.isArray(source.details)
          ? source.details
              .map((entry) => normalizeOptionalValue(entry) ?? "")
              .filter((entry): entry is string => Boolean(entry))
          : [],
        status,
        createdAt,
        ...(typeof source.confidence === "number" ? { confidence: source.confidence } : {}),
        ...(normalizeOptionalValue(source.error)
          ? { error: normalizeOptionalValue(source.error) }
          : {}),
        ...(normalizeOptionalValue(source.url) ? { url: normalizeOptionalValue(source.url) } : {})
      }
    ];
  });
}

function isPlannerContextSourceKind(value: unknown): value is PlannerContextSource["kind"] {
  return value === "prompt" || value === "website" || value === "repo" || value === "folder";
}

async function resolveWorkspaceCreationTargetDir(input: ResolvedWorkspaceBootstrapInput) {
  const workspaceRoot = resolveWorkspaceRoot(await getConfiguredWorkspaceRoot());

  if (input.sourceMode === "existing") {
    const existingPath = input.existingPath || input.directory;

    if (!existingPath) {
      throw new Error("Choose an existing folder for this workspace.");
    }

    return path.isAbsolute(existingPath) ? existingPath : path.resolve(existingPath);
  }

  if (input.directory) {
    return path.isAbsolute(input.directory)
      ? input.directory
      : path.join(workspaceRoot, input.directory);
  }

  return path.join(workspaceRoot, input.slug);
}

async function ensureFreshWorkspaceDirectory(targetDir: string) {
  try {
    const targetStat = await stat(targetDir);

    if (!targetStat.isDirectory()) {
      throw new Error("Target workspace path exists and is not a directory.");
    }

    const entries = await readdir(targetDir);

    if (entries.length > 0) {
      throw new Error("Target workspace directory already contains files. Use Existing folder instead.");
    }
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined;

    if (code === "ENOENT") {
      await mkdir(targetDir, { recursive: true });
      return;
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error("Unable to prepare the workspace directory.");
  }

  await mkdir(targetDir, { recursive: true });
}

async function ensureExistingDirectory(targetDir: string) {
  try {
    const targetStat = await stat(targetDir);

    if (!targetStat.isDirectory()) {
      throw new Error("The selected existing path is not a directory.");
    }
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined;

    if (code === "ENOENT") {
      throw new Error("The selected existing folder does not exist.");
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error("Unable to access the selected existing folder.");
  }
}

async function runSystemCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    timeoutMs?: number;
  } = {}
) {
  try {
    await execFileAsync(command, args, {
      cwd: options.cwd ?? process.cwd(),
      timeout: options.timeoutMs ?? 120000,
      maxBuffer: 8 * 1024 * 1024
    });
  } catch (error) {
    const message =
      typeof error === "object" &&
      error &&
      "stderr" in error &&
      typeof error.stderr === "string" &&
      error.stderr.trim()
        ? error.stderr.trim()
        : error instanceof Error
          ? error.message
          : "Unknown system command failure.";

    throw new Error(message);
  }
}

async function writeTextFileIfMissing(filePath: string, contents: string) {
  try {
    await access(filePath);
  } catch {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, contents, "utf8");
  }
}

async function writeTextFileEnsured(filePath: string, contents: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf8");
}

async function detectWorkspaceToolExamples(workspacePath: string) {
  const examples: string[] = [];
  const packageExamples = await detectPackageExamples(workspacePath);
  const makeExamples = await detectMakeExamples(workspacePath);
  const pythonExamples = await detectPythonExamples(workspacePath);

  examples.push(...packageExamples, ...makeExamples, ...pythonExamples);

  if (examples.length === 0) {
    examples.push(
      "Use repository-local scripts or documented commands for repeatable workflows.",
      "Update this file when the project exposes a cleaner build, test, or release path."
    );
  }

  return uniqueStrings(examples).slice(0, 6);
}

async function detectPackageExamples(workspacePath: string) {
  const packageJsonPath = path.join(workspacePath, "package.json");

  try {
    const raw = await readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as {
      packageManager?: string;
      scripts?: Record<string, string>;
    };
    const scripts = parsed.scripts ?? {};
    const manager = await detectPackageManager(workspacePath, parsed.packageManager);
    const examples = [`Use \`${manager} install\` before the first local run.`];

    for (const scriptName of ["dev", "start", "test", "lint", "build"]) {
      if (scripts[scriptName]) {
        examples.push(`Use \`${formatPackageScript(manager, scriptName)}\` for the ${scriptName} workflow.`);
      }
    }

    return examples;
  } catch {
    return [];
  }
}

async function detectMakeExamples(workspacePath: string) {
  const makefilePath = path.join(workspacePath, "Makefile");

  try {
    const raw = await readFile(makefilePath, "utf8");
    const matches = raw.match(/^(dev|test|lint|build|run):/gm) ?? [];
    return matches.map((entry) => `Use \`make ${entry.replace(/:$/, "")}\` if the Makefile is the primary entry point.`);
  } catch {
    return [];
  }
}

async function detectPythonExamples(workspacePath: string) {
  const examples: string[] = [];

  if (await pathExists(path.join(workspacePath, "pyproject.toml"))) {
    examples.push("Use `pytest` for Python verification if the project exposes a test suite.");
  }

  if (await pathExists(path.join(workspacePath, "requirements.txt"))) {
    examples.push("Install Python dependencies in a virtualenv before running project commands.");
  }

  return examples;
}

async function prepareMissionOutputPlan(workspacePath: string, mission: string) {
  const runFolder = buildMissionOutputFolderName(mission);
  const absoluteOutputDir = path.join(workspacePath, "deliverables", runFolder);
  const relativeOutputDir = normalizeWorkspaceRelativePath(path.join("deliverables", runFolder));
  const notesDirRelative = normalizeWorkspaceRelativePath("memory");

  await mkdir(absoluteOutputDir, { recursive: true });
  await mkdir(path.join(workspacePath, "memory"), { recursive: true });

  return {
    runFolder,
    absoluteOutputDir,
    relativeOutputDir,
    notesDirRelative
  };
}

function composeMissionWithOutputRouting(
  mission: string,
  outputPlan: {
    relativeOutputDir: string;
    notesDirRelative: string;
  },
  policy?: AgentPolicy,
  setupAgentId?: string | null
) {
  const resolvedPolicy = policy ?? resolveAgentPolicy(DEFAULT_AGENT_PRESET);

  return [
    mission,
    "",
    "Task output routing:",
    `- Put substantial outputs, drafts, reports, docs, and file deliverables under \`${outputPlan.relativeOutputDir}/\`.`,
    `- If a file is requested, default to \`${outputPlan.relativeOutputDir}/<descriptive-file-name>\` unless the user explicitly asks for another path.`,
    `- Use \`${outputPlan.notesDirRelative}/\` only for temporary notes or durable workspace memory, not final deliverables.`,
    "- Avoid writing final artifacts to the workspace root.",
    "- Only update shared workspace docs when the change is durable and workspace-wide; task-specific docs should stay inside this run folder.",
    "",
    "Agent operating policy:",
    ...buildAgentPolicyPromptLines(resolvedPolicy, setupAgentId)
  ].join("\n");
}

function buildAgentPolicyPromptLines(policy: AgentPolicy, setupAgentId?: string | null) {
  const lines: string[] = [
    `- Preset: ${formatAgentPresetLabel(policy.preset)}.`
  ];

  if (policy.preset === "browser") {
    lines.push("- Prefer browser-native evidence capture, screenshots, and reproducible user-path validation.");
  } else if (policy.preset === "monitoring") {
    lines.push("- Periodically inspect the workspace, surface blockers, and leave concise triage handoffs without broad implementation changes.");
  } else if (policy.preset === "setup") {
    lines.push("- Prepare the environment, unblock other agents, and keep mutations minimal and explicit.");
  } else if (policy.preset === "worker") {
    lines.push("- Focus on producing deliverables, reviews, analysis, or code without unnecessary environment mutation.");
  } else {
    lines.push("- Operate with the selected policy, keep artifacts reviewable, and avoid surprising side effects.");
  }

  switch (policy.missingToolBehavior) {
    case "fallback":
      lines.push(
        "- If required tooling is unavailable, do not install it. Produce the closest viable fallback artifact, such as .md or .txt, and state the limitation."
      );
      break;
    case "ask-setup":
      lines.push(
        "- If required tooling is unavailable, stop before installing anything and report the missing capability clearly."
      );
      break;
    case "route-setup":
      lines.push(
        setupAgentId
          ? `- If required tooling is unavailable, do not install it yourself. Leave a concrete handoff for setup agent \`${setupAgentId}\` with the exact missing tools or commands.`
          : "- If required tooling is unavailable, do not install it yourself. Leave a concrete setup handoff with the exact missing tools or commands."
      );
      break;
    case "allow-install":
      lines.push("- If required tooling is unavailable, you may install it when the install scope below permits it.");
      break;
  }

  switch (policy.installScope) {
    case "none":
      lines.push("- Install scope: none. Do not run package installation commands.");
      break;
    case "workspace":
      lines.push(
        "- Install scope: workspace only. Limit installs to project-local or workspace-local dependencies and avoid system package managers."
      );
      break;
    case "system":
      lines.push("- Install scope: system. System-wide installs are allowed when necessary, but keep them minimal and report what changed.");
      break;
  }

  lines.push(
    policy.fileAccess === "workspace-only"
      ? "- File access: workspace only. Keep file operations inside the attached workspace."
      : "- File access: extended. Prefer the workspace, but you may touch adjacent paths when the task explicitly needs them."
  );
  lines.push(
    policy.networkAccess === "enabled"
      ? "- Network access: enabled when the task requires external information or downloads."
      : "- Network access: restricted. Avoid network access unless the task explicitly depends on it."
  );

  return lines;
}

async function detectPackageManager(workspacePath: string, declaredPackageManager?: string) {
  const normalizedDeclared = normalizeOptionalValue(declaredPackageManager);

  if (normalizedDeclared) {
    return normalizedDeclared.split("@")[0];
  }

  if (await pathExists(path.join(workspacePath, "pnpm-lock.yaml"))) {
    return "pnpm";
  }

  if (await pathExists(path.join(workspacePath, "yarn.lock"))) {
    return "yarn";
  }

  return "npm";
}

async function pathExists(targetPath: string) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function formatPackageScript(packageManager: string, scriptName: string) {
  return packageManager === "yarn" ? `yarn ${scriptName}` : `${packageManager} run ${scriptName}`;
}

function buildMissionOutputFolderName(mission: string) {
  const now = new Date();
  const timestamp = [
    now.getFullYear(),
    padNumber(now.getMonth() + 1),
    padNumber(now.getDate()),
    padNumber(now.getHours()),
    padNumber(now.getMinutes()),
    padNumber(now.getSeconds())
  ].join("-");
  const normalizedMission = mission.replace(/^\[[^\]]+\]\s*/i, "").trim();
  const missionSlug = slugify(normalizedMission).slice(0, 48).replace(/^-+|-+$/g, "") || "task";

  return `${timestamp}-${missionSlug}`;
}

function createWorkspaceAgentId(workspaceSlug: string, agentKey: string) {
  return `${workspaceSlug}-${slugify(agentKey) || "agent"}`;
}

function findDuplicateStrings(values: string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
      continue;
    }

    seen.add(value);
  }

  return Array.from(duplicates).sort((left, right) => left.localeCompare(right));
}

function describeAgentWorkspace(
  snapshot: MissionControlSnapshot,
  agent: Pick<OpenClawAgent, "workspaceId" | "workspacePath">
) {
  return (
    snapshot.workspaces.find((workspace) => workspace.id === agent.workspaceId)?.name ??
    path.basename(agent.workspacePath)
  );
}

function assertAgentIdAvailable(
  snapshot: MissionControlSnapshot,
  agentId: string,
  targetWorkspaceId?: string | null
) {
  const existingAgent = snapshot.agents.find((agent) => agent.id === agentId);

  if (!existingAgent) {
    return;
  }

  const workspaceLabel = describeAgentWorkspace(snapshot, existingAgent);

  if (existingAgent.workspaceId === targetWorkspaceId) {
    throw new Error(`Agent id "${agentId}" already exists in workspace "${workspaceLabel}".`);
  }

  throw new Error(
    `Agent id "${agentId}" is already used by workspace "${workspaceLabel}". Choose a different id.`
  );
}

function assertWorkspaceBootstrapAgentIdsAvailable(
  snapshot: MissionControlSnapshot,
  workspaceSlug: string,
  agents: WorkspaceAgentBlueprintInput[]
) {
  const finalAgentIds = agents.map((agent) => createWorkspaceAgentId(workspaceSlug, agent.id));
  const duplicateFinalIds = findDuplicateStrings(finalAgentIds);

  if (duplicateFinalIds.length > 0) {
    throw new Error(
      `Workspace bootstrap would create duplicate agent ids: ${duplicateFinalIds.join(", ")}.`
    );
  }

  for (const agentId of finalAgentIds) {
    const existingAgent = snapshot.agents.find((agent) => agent.id === agentId);

    if (!existingAgent) {
      continue;
    }

    throw new Error(
      `Workspace bootstrap would create agent id "${agentId}", but it already exists in workspace "${describeAgentWorkspace(snapshot, existingAgent)}". Rename the workspace or adjust the agent ids.`
    );
  }
}

function buildWorkspaceAgentStatePath(workspacePath: string, agentId: string) {
  return path.join(workspacePath, ".openclaw", "agents", agentId, "agent");
}

function mapAgentHeartbeatToInput(heartbeat: OpenClawAgent["heartbeat"]): AgentHeartbeatInput {
  return {
    enabled: heartbeat.enabled,
    every: heartbeat.every ?? undefined
  };
}

function buildAgentPolicySkillId(agentId: string) {
  return `agent-policy-${slugify(agentId) || "agent"}`;
}

function isAgentPolicySkillId(skillId: string | undefined) {
  return Boolean(skillId && /^agent-policy-/.test(skillId));
}

function filterAgentPolicySkills(skills: string[]) {
  return skills.filter((skillId) => !isAgentPolicySkillId(skillId));
}

function normalizeDeclaredAgentTools(toolIds: string[]) {
  return uniqueStrings(
    toolIds
      .filter((toolId) => typeof toolId === "string")
      .map((toolId) => toolId.trim())
      .filter((toolId) => Boolean(toolId) && toolId !== "fs.workspaceOnly")
  );
}

type TelegramCoordinationChannelSummary = {
  channelId: string;
  channelName: string;
  groups: Array<{ chatId: string; title: string | null }>;
  peers: Array<{ agentId: string; name: string; summary: string }>;
};

type TelegramOwnedGroupSummary = {
  channelId: string;
  channelName: string;
  chatId: string;
  title: string | null;
  primaryAgentId: string;
  primaryAgentName: string;
  peers: Array<{ agentId: string; name: string; summary: string }>;
};

type TelegramCoordinationContext = {
  primaryChannels: TelegramCoordinationChannelSummary[];
  ownedGroups: TelegramOwnedGroupSummary[];
  delegateChannels: Array<
    TelegramCoordinationChannelSummary & {
      primaryAgentId: string;
      primaryAgentName: string;
    }
  >;
};

type WorkspaceTeamMemberSummary = {
  agentId: string;
  name: string;
  role: string;
  isPrimary: boolean;
  isCurrent: boolean;
};

type WorkspaceTeamContext = {
  members: WorkspaceTeamMemberSummary[];
};

async function ensureAgentPolicySkill(params: {
  workspacePath: string;
  agentId: string;
  agentName: string;
  policy: AgentPolicy;
  setupAgentId?: string | null;
  snapshot?: MissionControlSnapshot;
  channelRegistry?: ChannelRegistry;
}) {
  const skillId = buildAgentPolicySkillId(params.agentId);
  await ensureTelegramDelegationHelper(params.workspacePath);
  const team = await buildWorkspaceTeamContext(
    params.workspacePath,
    params.agentId,
    params.snapshot ?? null
  );
  const coordination = buildTelegramCoordinationContext(
    params.agentId,
    params.snapshot ?? null,
    params.channelRegistry ?? params.snapshot?.channelRegistry ?? null
  );
  await writeTextFileEnsured(
    path.join(params.workspacePath, "skills", skillId, "SKILL.md"),
    `${renderAgentPolicySkillMarkdown(params.agentName, params.policy, params.setupAgentId, team, coordination)}\n`
  );
  return skillId;
}

async function ensureTelegramDelegationHelper(workspacePath: string) {
  const helperPath = path.join(workspacePath, ".openclaw", "tools", "telegram-delegate-agent.mjs");
  await writeTextFileEnsured(helperPath, `${renderTelegramDelegationHelperScript()}\n`);
}

function describeTelegramAgentCapability(agent: OpenClawAgent | null) {
  if (!agent) {
    return "no capability snapshot";
  }

  const parts: string[] = [formatAgentPresetLabel(agent.policy.preset)];

  const purpose = agent.profile.purpose?.trim();
  if (purpose) {
    parts.push(purpose);
  }

  const skills = uniqueStrings(agent.skills).slice(0, 2);
  if (skills.length > 0) {
    parts.push(`skills: ${skills.join(", ")}`);
  }

  const tools = uniqueStrings(agent.tools).slice(0, 2);
  if (tools.length > 0) {
    parts.push(`tools: ${tools.join(", ")}`);
  }

  return parts.join(" · ");
}

function buildTelegramCoordinationContext(
  agentId: string,
  snapshot: MissionControlSnapshot | null,
  registry: ChannelRegistry | null
): TelegramCoordinationContext | null {
  if (!registry) {
    return null;
  }

  const agentNameById = new Map(
    snapshot?.agents.map((agent) => [agent.id, formatAgentDisplayName(agent)]) ?? []
  );
  const agentById = new Map(snapshot?.agents.map((agent) => [agent.id, agent]) ?? []);
  const currentAgent = agentById.get(agentId) ?? null;
  const currentWorkspaceId = currentAgent?.workspaceId ?? null;
  const primaryChannels: TelegramCoordinationChannelSummary[] = [];
  const ownedGroups: TelegramOwnedGroupSummary[] = [];
  const delegateChannels: Array<
    TelegramCoordinationChannelSummary & {
      primaryAgentId: string;
      primaryAgentName: string;
    }
  > = [];

  for (const channel of registry.channels.filter((entry) => entry.type === "telegram")) {
    const workspaceBindings = channel.workspaces.filter((workspace) => workspace.workspaceId === currentWorkspaceId);

    if (workspaceBindings.length === 0) {
      continue;
    }

    const groups = uniqueByChatId(
      workspaceBindings.flatMap((workspace) =>
        workspace.groupAssignments.filter((assignment) => assignment.enabled !== false)
      )
    ).map((assignment) => ({
      chatId: assignment.chatId,
      title: assignment.title ?? null
    }));
    const ownedAssignments = uniqueByChatId(
      workspaceBindings.flatMap((workspace) =>
        workspace.groupAssignments.filter(
          (assignment) => assignment.enabled !== false && assignment.agentId === agentId
        )
      )
    );
    const fallbackGroups = groups.filter(
      (group) =>
        !ownedAssignments.some((assignment) => assignment.chatId === group.chatId) &&
        !workspaceBindings.some((workspace) =>
          workspace.groupAssignments.some(
            (assignment) => assignment.enabled !== false && assignment.chatId === group.chatId && assignment.agentId
          )
        )
    );

    if (channel.primaryAgentId === agentId) {
      const peers = uniqueStrings(
        workspaceBindings.flatMap((workspace) => workspace.agentIds.filter((candidate) => candidate !== agentId))
      ).map((peerId) => {
        const peer = agentById.get(peerId) ?? null;
        return {
          agentId: peerId,
          name: agentNameById.get(peerId) ?? peerId,
          summary: describeTelegramAgentCapability(peer)
        };
      });

      primaryChannels.push({
        channelId: channel.id,
        channelName: channel.name,
        groups: fallbackGroups,
        peers
      });
    }

    for (const assignment of ownedAssignments) {
      const peers = uniqueStrings(
        workspaceBindings.flatMap((workspace) =>
          workspace.agentIds.filter((candidate) => candidate !== agentId && candidate !== channel.primaryAgentId)
        )
      ).map((peerId) => {
        const peer = agentById.get(peerId) ?? null;
        return {
          agentId: peerId,
          name: agentNameById.get(peerId) ?? peerId,
          summary: describeTelegramAgentCapability(peer)
        };
      });

      ownedGroups.push({
        channelId: channel.id,
        channelName: channel.name,
        chatId: assignment.chatId,
        title: assignment.title ?? null,
        primaryAgentId: channel.primaryAgentId ?? "",
        primaryAgentName: channel.primaryAgentId ? agentNameById.get(channel.primaryAgentId) ?? channel.primaryAgentId : "Unset",
        peers
      });
    }

    if (workspaceBindings.length === 0 || !channel.primaryAgentId || ownedAssignments.length > 0) {
      if (channel.primaryAgentId !== agentId) {
        continue;
      }
    }

    delegateChannels.push({
      channelId: channel.id,
      channelName: channel.name,
      groups: fallbackGroups,
      peers: uniqueStrings(
        workspaceBindings.flatMap((workspace) =>
          workspace.agentIds.filter((candidate) => candidate !== channel.primaryAgentId && candidate !== agentId)
        )
      ).map((peerId) => {
        const peer = agentById.get(peerId) ?? null;
        return {
          agentId: peerId,
          name: agentNameById.get(peerId) ?? peerId,
          summary: describeTelegramAgentCapability(peer)
        };
      }),
      primaryAgentId: channel.primaryAgentId,
      primaryAgentName: agentNameById.get(channel.primaryAgentId) ?? channel.primaryAgentId
    });
  }

  if (primaryChannels.length === 0 && delegateChannels.length === 0) {
    if (ownedGroups.length === 0) {
      return null;
    }
  }

  return {
    primaryChannels: primaryChannels.sort((left, right) => left.channelName.localeCompare(right.channelName)),
    ownedGroups: ownedGroups.sort((left, right) => {
      const leftLabel = `${left.channelName}:${left.title ?? left.chatId}`;
      const rightLabel = `${right.channelName}:${right.title ?? right.chatId}`;
      return leftLabel.localeCompare(rightLabel);
    }),
    delegateChannels: delegateChannels.sort((left, right) => left.channelName.localeCompare(right.channelName))
  };
}

function renderTelegramCoordinationMarkdown(coordination: TelegramCoordinationContext | null | undefined) {
  if (
    !coordination ||
    (coordination.primaryChannels.length === 0 &&
      coordination.ownedGroups.length === 0 &&
      coordination.delegateChannels.length === 0)
  ) {
    return null;
  }

  const lines: string[] = ["## Telegram coordination"];

  if (coordination.primaryChannels.length > 0) {
    lines.push("- You are the public Telegram fallback for these channels:");
    for (const channel of coordination.primaryChannels) {
      const groupSummary =
        channel.groups.length > 0
          ? channel.groups.map((group) => group.title ?? group.chatId).join(", ")
          : "no allowed groups yet";
      lines.push(`  - ${channel.channelName} (\`${channel.channelId}\`) · fallback groups: ${groupSummary}.`);
      if (channel.peers.length > 0) {
        lines.push("  - Internal assistants:");
        for (const peer of channel.peers) {
          lines.push(`    - ${peer.name} (\`${peer.agentId}\`) · ${peer.summary}.`);
        }
      }
    }
    lines.push("- Keep public Telegram replies under your own voice for unassigned groups, even when you ask another agent for help.");
    lines.push("- For specialist help, call another agent from the workspace terminal with:");
    lines.push("```bash");
    lines.push('node .openclaw/tools/telegram-delegate-agent.mjs --agent <delegate-agent-id> --message "Summarize what I need from you"');
    lines.push("```");
    lines.push("- Use delegate turns for internal research, drafting, or analysis only. Do not ask them to answer Telegram directly.");
    lines.push("- After a delegate responds, decide what to share publicly and send the final Telegram reply yourself.");
  }

  if (coordination.ownedGroups.length > 0) {
    lines.push("- You are the public Telegram voice for these assigned groups:");
    for (const group of coordination.ownedGroups) {
      lines.push(
        `  - ${group.channelName} (\`${group.channelId}\`) · ${group.title ?? group.chatId} (\`${group.chatId}\`) · primary ${group.primaryAgentName} (\`${group.primaryAgentId}\`).`
      );
      if (group.peers.length > 0) {
        lines.push("  - Internal assistants for this group:");
        for (const peer of group.peers) {
          lines.push(`    - ${peer.name} (\`${peer.agentId}\`) · ${peer.summary}.`);
        }
      }
    }
    lines.push("- Reply directly to those groups as the public voice. Use other agents only for internal help.");
  }

  if (coordination.delegateChannels.length > 0) {
    lines.push("- You can assist these Telegram admin channels when the primary agent asks:");
    for (const channel of coordination.delegateChannels) {
      const groupSummary =
        channel.groups.length > 0
          ? channel.groups.map((group) => group.title ?? group.chatId).join(", ")
          : "no allowed groups yet";
      lines.push(
        `  - ${channel.channelName} (\`${channel.channelId}\`) · primary ${channel.primaryAgentName} (\`${channel.primaryAgentId}\`) · groups: ${groupSummary}.`
      );
      if (channel.peers.length > 0) {
        lines.push("    - Nearby assistants:");
        for (const peer of channel.peers) {
          lines.push(`      - ${peer.name} (\`${peer.agentId}\`) · ${peer.summary}.`);
        }
      }
    }
    lines.push("- When helping with Telegram work, return concise internal findings or draft language. Do not speak as the public Telegram agent.");
  }

  return lines.join("\n");
}

function renderTelegramDelegationHelperScript() {
  return String.raw`#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function parseArgs(argv) {
  const options = {
    agentId: "",
    message: "",
    thinking: "low",
    json: false,
    stdin: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--agent") {
      options.agentId = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg === "--message") {
      options.message = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg === "--thinking") {
      options.thinking = argv[index + 1] ?? "low";
      index += 1;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--stdin") {
      options.stdin = true;
      continue;
    }
  }

  return options;
}

function usage() {
  process.stderr.write(
    "Usage: node .openclaw/tools/telegram-delegate-agent.mjs --agent <id> --message <text> [--thinking low|medium|high] [--json]\n"
  );
}

function extractText(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  if (typeof payload.summary === "string" && payload.summary.trim()) {
    return payload.summary.trim();
  }

  if (Array.isArray(payload.payloads)) {
    for (const entry of payload.payloads) {
      if (entry && typeof entry === "object") {
        if (typeof entry.text === "string" && entry.text.trim()) {
          return entry.text.trim();
        }

        if (typeof entry.content === "string" && entry.content.trim()) {
          return entry.content.trim();
        }
      }
    }
  }

  if (payload.result && typeof payload.result === "object") {
    return extractText(payload.result);
  }

  return "";
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.stdin) {
    options.message = await readStdin();
  }

  if (!options.agentId || !options.message.trim()) {
    usage();
    process.exit(1);
  }

  const args = [
    "agent",
    "--agent",
    options.agentId,
    "--message",
    options.message.trim(),
    "--thinking",
    options.thinking,
    "--json"
  ];

  try {
    const { stdout } = await execFileAsync("openclaw", args, {
      cwd: process.cwd(),
      maxBuffer: 4 * 1024 * 1024
    });
    const parsed = JSON.parse(stdout);

    if (options.json) {
      process.stdout.write(JSON.stringify(parsed, null, 2) + "\n");
      return;
    }

    const text = extractText(parsed);
    process.stdout.write((text || JSON.stringify(parsed, null, 2)) + "\n");
  } catch (error) {
    const message =
      error && typeof error === "object" && "stderr" in error && typeof error.stderr === "string"
        ? error.stderr.trim()
        : error instanceof Error
          ? error.message
          : "Telegram delegation failed.";
    process.stderr.write(String(message) + "\n");
    process.exit(1);
  }
}

await main();
`;
}

async function buildWorkspaceTeamContext(
  workspacePath: string,
  agentId: string,
  snapshot: MissionControlSnapshot | null
): Promise<WorkspaceTeamContext | null> {
  if (!snapshot) {
    return null;
  }

  const currentAgent = snapshot.agents.find((entry) => entry.id === agentId);

  if (!currentAgent) {
    return null;
  }

  const manifest = await readWorkspaceProjectManifest(workspacePath);
  const manifestAgentById = new Map(manifest.agents.map((entry) => [entry.id, entry]));
  const members = snapshot.agents
    .filter((entry) => entry.workspaceId === currentAgent.workspaceId)
    .sort((left, right) => {
      if (left.id === agentId && right.id !== agentId) {
        return -1;
      }

      if (right.id === agentId && left.id !== agentId) {
        return 1;
      }

      const leftManifest = manifestAgentById.get(left.id);
      const rightManifest = manifestAgentById.get(right.id);
      const leftPrimary = leftManifest?.isPrimary ?? false;
      const rightPrimary = rightManifest?.isPrimary ?? false;

      if (leftPrimary !== rightPrimary) {
        return leftPrimary ? -1 : 1;
      }

      return formatAgentDisplayName(left).localeCompare(formatAgentDisplayName(right));
    })
    .map((entry) => {
      const manifestAgent = manifestAgentById.get(entry.id);

      return {
        agentId: entry.id,
        name: formatAgentDisplayName(entry),
        role: manifestAgent?.role?.trim() || formatAgentPresetLabel(entry.policy.preset),
        isPrimary: manifestAgent?.isPrimary ?? false,
        isCurrent: entry.id === agentId
      } satisfies WorkspaceTeamMemberSummary;
    });

  return members.length > 0 ? { members } : null;
}

function renderWorkspaceTeamMarkdown(team: WorkspaceTeamContext | null | undefined) {
  if (!team || team.members.length === 0) {
    return null;
  }

  const lines = [
    "## Workspace team",
    "- This workspace currently includes these agents. Do not assume you are the only agent unless you verify the roster again.",
    "- Use these exact agent ids when referring to teammates or handing work off:"
  ];

  for (const member of team.members) {
    const labels = [
      member.isCurrent ? "you" : null,
      member.isPrimary ? "primary" : null,
      member.role
    ].filter((value): value is string => Boolean(value));

    lines.push(`- ${member.name} (\`${member.agentId}\`) · ${labels.join(" · ")}.`);
  }

  lines.push(
    "- If you are asked who is in this workspace, answer from this roster or re-check `.openclaw/project.json` before replying."
  );

  return lines.join("\n");
}

export function renderAgentsMarkdown(params: {
  name: string;
  brief?: string;
  template: WorkspaceTemplate;
  sourceMode: WorkspaceSourceMode;
  agents: WorkspaceAgentBlueprintInput[];
  rules: WorkspaceCreateRules;
}) {
  const templateMeta = getWorkspaceTemplateMeta(params.template);
  const teamLines = params.agents.map(
    (agent) =>
      `- ${agent.role}: ${agent.name}${agent.skillId ? ` · skill ${agent.skillId}` : ""}${
        agent.policy ? ` · ${formatAgentPresetLabel(agent.policy.preset)}` : ""
      }`
  );

  return `# ${params.name}

Shared project context for all agents working in this workspace.

## Workspace
- Template: ${templateMeta.label}
- Source mode: ${params.sourceMode}
- Workspace-only access: ${params.rules.workspaceOnly ? "enabled" : "disabled"}

## Team
${teamLines.join("\n")}

## Customize
${params.brief || "Clarify the project goal, definition of done, constraints, and success signals before large changes."}

## Safety defaults
- Stay inside the attached workspace unless the task explicitly requires another location.
- Prefer direct, reviewable changes over speculative rewrites.
- Preserve user work and avoid destructive actions without clear approval.
- Update durable docs when stable architecture, workflow, or product decisions change.
- Worker and browser agents should not install tooling unless their explicit policy allows it.
- Route environment preparation to setup-oriented agents when the work depends on new tooling.

## Daily memory
- Capture durable facts in MEMORY.md and memory/*.md.
- Record stable decisions in memory/decisions.md.
- Keep temporary chatter and scratch notes in memory/.

## Output
- Be concise in chat and write longer output to files when the artifact matters.
- Put task-specific deliverables, drafts, reports, and docs inside per-run folders under deliverables/.
- Avoid writing final artifacts to the workspace root unless explicitly requested.
`;
}

export function renderSoulMarkdown(template: WorkspaceTemplate, brief?: string) {
  const templateMeta = getWorkspaceTemplateMeta(template);

  return `# SOUL

## My Purpose
Help this ${templateMeta.label.toLowerCase()} workspace turn intent into real outcomes with pragmatic execution, verification, and durable memory.

## How I Operate
- Start from the current workspace reality before proposing large moves.
- Prefer concrete action, visible artifacts, and clear handoffs.
- Keep docs, memory, and deliverables aligned with the actual state of the work.

## My Quirks
- Pragmatic
- Direct
- Product-aware
- Quality-minded

${brief ? `## Active Focus\n${brief}\n` : ""}`;
}

export function renderIdentityMarkdown(template: WorkspaceTemplate) {
  const templateMeta = getWorkspaceTemplateMeta(template);

  return `# IDENTITY

## Role
This workspace hosts a ${templateMeta.label.toLowerCase()} team coordinated through OpenClaw.

**Vibe:** pragmatic, concise, quality-minded, workspace-grounded
`;
}

export function renderToolsMarkdown(template: WorkspaceTemplate, toolExamples: string[]) {
  const templateMeta = getWorkspaceTemplateMeta(template);

  return `# TOOLS

Repository commands and workflow notes for this ${templateMeta.label.toLowerCase()} workspace.

## Examples
${toolExamples.map((line) => `- ${line}`).join("\n")}

## Notes
- Replace these examples with sharper project-specific commands when the repo exposes them.
- Prefer repeatable commands that other agents can run without interpretation drift.
`;
}

export function renderHeartbeatMarkdown(template: WorkspaceTemplate) {
  const templateMeta = getWorkspaceTemplateMeta(template);

  return `# HEARTBEAT

- Start each substantial task by refreshing the brief, docs, and current files.
- Keep the ${templateMeta.label.toLowerCase()} workspace coherent across code, docs, and memory.
- Prefer explicit handoffs between implementation, review, testing, and knowledge capture.
`;
}

export function renderMemoryMarkdown(name: string, template: WorkspaceTemplate, brief?: string) {
  return `# ${name} Memory

Durable project facts for this ${getWorkspaceTemplateMeta(template).label.toLowerCase()} workspace.

## Current brief
${brief || "No brief captured yet. Fill this in as soon as the project goal is clarified."}

## Stable facts
- Add durable architecture, product, or workflow facts here.
- Move longer notes into memory/*.md when they outgrow this file.
`;
}

export function renderBlueprintMarkdown(name: string, template: WorkspaceTemplate, brief?: string) {
  return `# ${name} Blueprint

## Workspace type
${getWorkspaceTemplateMeta(template).label}

## Outcome
${brief || "Define the target outcome, user impact, and quality bar for this workspace."}

## Constraints
- Add technical, product, legal, or operational constraints here.

## Unknowns
- Capture unresolved questions that block confident execution.
`;
}

export function renderDecisionsMarkdown() {
  return `# Decisions

Use this file for durable decisions that should survive across sessions.

## Template
- Date:
- Decision:
- Context:
- Consequence:
`;
}

export function renderBriefMarkdown(
  name: string,
  template: WorkspaceTemplate,
  brief: string | undefined,
  sourceMode: WorkspaceSourceMode
) {
  return `# ${name} Brief

## Template
${getWorkspaceTemplateMeta(template).label}

## Source mode
${sourceMode}

## Objective
${brief || "Clarify the main goal, target user, and success definition for this workspace."}

## Success signals
- Define what success looks like in observable terms.

## Open questions
- List the unknowns worth resolving first.
`;
}

export function renderArchitectureMarkdown(template: WorkspaceTemplate) {
  return `# Architecture

## Current shape
- Describe the main components, systems, or content lanes in this ${getWorkspaceTemplateMeta(template).label.toLowerCase()} workspace.

## Dependencies
- List critical external services, repos, data sources, or channels.

## Risks
- Capture structural, operational, or delivery risks here.
`;
}

export function renderDeliverablesMarkdown() {
  return `# Deliverables

Use this folder for substantial output artifacts that should be easy to hand off or review.

- Create one subfolder per task or run, for example \`deliverables/2026-03-07-15-30-00-launch-brief/\`.
- Put drafts, reports, docs, and publishable assets for that task inside its run folder.
- Keep filenames descriptive and tied to the task or audience.
`;
}

export function renderTemplateSpecificDoc(kind: "ux" | "backend" | "research" | "content") {
  if (kind === "ux") {
    return `# UX Notes

- Track interaction patterns, responsive edge cases, and visual risk areas here.
`;
  }

  if (kind === "backend") {
    return `# Service Map

- Document services, jobs, queues, external dependencies, and critical flows here.
`;
  }

  if (kind === "research") {
    return `# Research Plan

- State the question, method, evidence sources, and expected output before large investigation work.
`;
  }

  return `# Content Brief

- Capture audience, channel, tone, CTA, and distribution assumptions for this content workspace.
`;
}

function renderSkillMarkdown(skillId: string, role: string) {
  switch (skillId) {
    case "project-builder":
      return `# Project Builder

Use this skill when implementing changes in the current project.

- Prefer direct code or artifact changes over speculative planning.
- Respect AGENTS.md, TOOLS.md, MEMORY.md, and memory/*.md before large edits.
- Put task-specific artifacts under the current deliverables run folder instead of the workspace root.
- Verify impact before finishing and leave the workspace in a clearer state.
`;
    case "project-reviewer":
      return `# Project Reviewer

Use this skill when reviewing changes in the current project.

- Prioritize correctness, regressions, edge cases, and missing tests.
- Prefer concrete findings with file and behavior references.
- Keep summaries brief after findings.
`;
    case "project-tester":
      return `# Project Tester

Use this skill when validating behavior in the current project.

- Prefer reproducible checks over assumptions.
- Focus on failures, regressions, missing coverage, and environment constraints.
- Report exactly what was verified and what could not be verified.
`;
    case "project-learner":
      return `# Project Learner

Use this skill when consolidating durable project knowledge.

- Capture stable conventions, architecture decisions, and delivery notes.
- Prefer updating MEMORY.md or memory/*.md with concise, durable facts.
- Avoid ephemeral chatter and duplicated notes.
`;
    case "project-browser":
      return `# Project Browser

Use this skill when validating browser flows in the current workspace.

- Exercise real user paths, not only component-level assumptions.
- Capture screenshots, repro steps, and UI regressions with concrete evidence.
- Hand off findings that need code changes back to the implementation agent.
`;
    case "project-researcher":
      return `# Project Researcher

Use this skill when investigating, synthesizing, or pressure-testing a problem space.

- Start with explicit questions, evidence sources, and output goals.
- Distinguish verified facts from inference.
- Convert durable findings into MEMORY.md or memory/*.md.
`;
    case "project-strategist":
      return `# Project Strategist

Use this skill when shaping positioning, campaign direction, or editorial priorities.

- Tie recommendations to audience, channel, and measurable goals.
- Prefer explicit tradeoffs over vague guidance.
- Save task-specific briefs, plans, and campaign artifacts inside the current deliverables run folder.
- Leave a clear next-step plan other agents can execute.
`;
    case "project-writer":
      return `# Project Writer

Use this skill when drafting messaging, copy, or narrative assets.

- Write for the target audience and channel rather than internal shorthand.
- Keep tone and structure consistent with the workspace brief.
- Save publishable drafts and task-specific docs inside the current deliverables run folder.
- Flag assumptions that need strategic review before publication.
`;
    case "project-analyst":
      return `# Project Analyst

Use this skill when evaluating results, experiments, or performance signals.

- Prefer measurable baselines and explicit comparisons.
- Separate observed performance from speculation about causality.
- Keep task-specific reports and analysis artifacts inside the current deliverables run folder.
- Write down recommendations that can be actioned by the team.
`;
    default:
      return `# ${role}

Use this skill when operating in the current workspace.

- Stay grounded in the shared workspace context.
- Produce durable artifacts when the work needs to be handed off.
- Put task-specific artifacts in the current deliverables run folder and keep notes in memory/.
- Keep outputs specific, reviewable, and easy for other agents to extend.
`;
  }
}

function renderAgentPolicySkillMarkdown(
  agentName: string,
  policy: AgentPolicy,
  setupAgentId?: string | null,
  team?: WorkspaceTeamContext | null,
  coordination?: TelegramCoordinationContext | null
) {
  const presetLabel = formatAgentPresetLabel(policy.preset);
  const teamSection = renderWorkspaceTeamMarkdown(team);
  const coordinationSection = renderTelegramCoordinationMarkdown(coordination);

  return `# ${agentName} Policy

Preset: ${presetLabel}

## Output routing
- Final deliverables belong in the current deliverables run folder for the task.
- Keep temporary notes and durable workspace memory inside memory/.
- Treat MEMORY.md, memory/*.md, docs/brief.md, docs/architecture.md, and any template-specific docs under docs/ as shared workspace context before large edits.
- Avoid writing final artifacts to the workspace root unless the task explicitly asks for it.

## Operating rules
${buildAgentPolicyPromptLines(policy, setupAgentId)
  .map((line) => line.replace(/^- /, "- "))
  .join("\n")}
${teamSection ? `\n\n${teamSection}` : ""}${coordinationSection ? `\n\n${coordinationSection}` : ""}
`;
}

function buildWorkspaceKickoffPrompt(
  template: WorkspaceTemplate,
  brief: string | undefined,
  rules: WorkspaceCreateRules
) {
  const templateMeta = getWorkspaceTemplateMeta(template);
  const contextManifest = buildWorkspaceContextManifest(template, rules);
  const manifestSummary = contextManifest.sections
    .map((section) => {
      const resourceList = section.resources.map((resource) => resource.label).join(", ");
      return section.enabled
        ? `${section.title}: ${resourceList || "none"}`
        : `${section.title}: disabled by workspace rules`;
    })
    .join("\n");

  return [
    `You are bootstrapping a newly created ${templateMeta.label.toLowerCase()} workspace.`,
    brief ? `Project brief: ${brief}` : "No detailed project brief was provided yet.",
    "Inspect the current files and improve the starter workspace without rewriting files that already had meaningful content.",
    "Treat the following workspace context manifest as the source of truth:",
    manifestSummary,
    "If those docs exist, refine the brief, architecture, memory, and deliverables guidance based on the real repository state instead of guessing.",
    "Leave the workspace with a concise first task batch and any critical unknowns clearly called out.",
    "Prefer concrete workspace-grounded edits over verbose chat output."
  ].join("\n\n");
}

async function upsertAgentConfigEntry(
  agentId: string,
  workspacePath: string,
  updates: {
    name?: string;
    model?: string;
    heartbeat?: { every?: string } | null;
    skills?: string[];
    tools?: MutableAgentConfigEntry["tools"] | null;
  },
  snapshot?: MissionControlSnapshot
) {
  const configList = await readAgentConfigList(snapshot);
  const existingIndex = configList.findIndex((entry) => entry.id === agentId);
  const nextEntry: MutableAgentConfigEntry =
    existingIndex >= 0
      ? { ...configList[existingIndex] }
      : {
          id: agentId,
          workspace: workspacePath
        };

  nextEntry.workspace = workspacePath;

  if (updates.name) {
    nextEntry.name = updates.name;
  }

  if (typeof updates.model === "string") {
    nextEntry.model = updates.model;
  } else {
    delete nextEntry.model;
  }

  if (updates.heartbeat?.every) {
    nextEntry.heartbeat = {
      every: updates.heartbeat.every
    };
  } else if (updates.heartbeat === null) {
    delete nextEntry.heartbeat;
  }

  if (Array.isArray(updates.skills) && updates.skills.length > 0) {
    nextEntry.skills = uniqueStrings(updates.skills);
  } else if (Array.isArray(updates.skills)) {
    delete nextEntry.skills;
  }

  if (updates.tools) {
    nextEntry.tools = updates.tools;
  } else if (updates.tools === null) {
    delete nextEntry.tools;
  }

  if (existingIndex >= 0) {
    configList[existingIndex] = nextEntry;
  } else {
    configList.push(nextEntry);
  }

  await writeAgentConfigList(configList);
  return nextEntry;
}

async function readAgentConfigList(snapshot?: MissionControlSnapshot) {
  try {
    const config = await runOpenClawJson<MutableAgentConfigEntry[]>([
      "config",
      "get",
      "agents.list",
      "--json"
    ]);

    return Array.isArray(config) ? config : [];
  } catch (error) {
    if (isMissingAgentConfigListError(error)) {
      return snapshot ? buildAgentConfigListFromSnapshot(snapshot) : [];
    }

    throw error;
  }
}

async function writeAgentConfigList(configList: MutableAgentConfigEntry[]) {
  await runOpenClaw([
    "config",
    "set",
    "--strict-json",
    "agents.list",
    JSON.stringify(configList)
  ]);
}

function isMissingAgentConfigListError(error: unknown) {
  const message = extractErrorMessage(error);
  return /Config path not found:\s*agents\.list|Config path not found:\s*agents\.list/i.test(message);
}

function buildAgentConfigListFromSnapshot(snapshot: MissionControlSnapshot) {
  return snapshot.agents.map((agent) => {
    const displayName = formatAgentDisplayName(agent);
    const identity = {
      name: displayName,
      ...(agent.identity.emoji ? { emoji: agent.identity.emoji } : {}),
      ...(agent.identity.theme ? { theme: agent.identity.theme } : {}),
      ...(agent.identity.avatar ? { avatar: agent.identity.avatar } : {})
    };

    const configEntry: MutableAgentConfigEntry = {
      id: agent.id,
      workspace: agent.workspacePath,
      name: displayName
    };

    if (agent.modelId && agent.modelId !== "unassigned") {
      configEntry.model = agent.modelId;
    }

    if (agent.heartbeat.enabled && agent.heartbeat.every) {
      configEntry.heartbeat = {
        every: agent.heartbeat.every
      };
    }

    if (agent.skills.length > 0) {
      configEntry.skills = uniqueStrings(agent.skills);
    }

    if (agent.tools.includes("fs.workspaceOnly")) {
      configEntry.tools = {
        fs: {
          workspaceOnly: true
        }
      };
    }

    if (Object.keys(identity).length > 0) {
      configEntry.identity = identity;
    }

    if (agent.isDefault) {
      configEntry.default = true;
    }

    return configEntry;
  });
}

function extractErrorMessage(error: unknown) {
  if (!error) {
    return "";
  }

  if (error instanceof Error) {
    const parts = [error.message];
    if ("stderr" in error && typeof error.stderr === "string") {
      parts.push(error.stderr);
    }
    if ("stdout" in error && typeof error.stdout === "string") {
      parts.push(error.stdout);
    }
    return parts.filter(Boolean).join("\n");
  }

  if (typeof error === "string") {
    return error;
  }

  return "";
}

async function applyAgentIdentity(
  agentId: string,
  workspacePath: string,
  identity: {
    name?: string;
    emoji?: string;
    theme?: string;
    avatar?: string;
  },
  agentDir?: string
) {
  const resolvedAgentDir = normalizeOptionalValue(agentDir) ?? buildWorkspaceAgentStatePath(workspacePath, agentId);
  const identityFilePath = path.join(resolvedAgentDir, "IDENTITY.md");
  const identityMarkdown = renderAgentIdentityMarkdown({
    name: normalizeOptionalValue(identity.name) ?? agentId,
    emoji: normalizeOptionalValue(identity.emoji),
    avatar: normalizeOptionalValue(identity.avatar)
  });

  await writeTextFileEnsured(identityFilePath, identityMarkdown);

  const args = [
    "agents",
    "set-identity",
    "--agent",
    agentId,
    "--workspace",
    workspacePath,
    "--identity-file",
    identityFilePath,
    "--json"
  ];

  if (identity.name) {
    args.push("--name", identity.name);
  }

  if (identity.emoji) {
    args.push("--emoji", identity.emoji);
  }

  if (identity.theme) {
    args.push("--theme", identity.theme);
  }

  if (identity.avatar) {
    args.push("--avatar", identity.avatar);
  }

  await runOpenClaw(args);
}

function renderAgentIdentityMarkdown(identity: {
  name: string;
  emoji?: string | null;
  avatar?: string | null;
}) {
  const avatar = normalizeOptionalValue(identity.avatar);

  return `# IDENTITY.md - Who Am I?

- **Name:** ${identity.name}
- **Creature:** OpenClaw agent
- **Vibe:** pragmatic, concise, workspace-grounded
- **Emoji:** ${identity.emoji ?? ""}
- **Avatar:** ${avatar ?? ""}

---

This identity file lives with the agent state so each agent can keep its own identity.
`;
}

async function readAgentIdentityOverrides(agentDir?: string) {
  const resolvedAgentDir = normalizeOptionalValue(agentDir);

  if (!resolvedAgentDir) {
    return { name: null, emoji: null, avatar: null };
  }

  const identityFilePath = path.join(resolvedAgentDir, "IDENTITY.md");

  try {
    const raw = await readFile(identityFilePath, "utf8");
    const lines = raw.split(/\r?\n/);
    const parseField = (label: string) => {
      const match = lines.find((line) => new RegExp(`^-\\s+\\*\\*${label}:\\*\\*\\s*(.*)$`, "i").test(line.trim()));
      const value = match?.match(new RegExp(`^-\\s+\\*\\*${label}:\\*\\*\\s*(.*)$`, "i"))?.[1];
      return normalizeOptionalValue(value ? cleanMarkdown(value) : null) ?? null;
    };

    return {
      name: parseField("Name"),
      emoji: parseField("Emoji"),
      avatar: parseField("Avatar")
    };
  } catch {
    return { name: null, emoji: null, avatar: null };
  }
}

async function resolveRuntimeTranscriptPath(
  agentId: string,
  sessionId: string,
  workspacePath?: string
) {
  const candidates = [
    path.join(os.homedir(), ".openclaw", "agents", agentId, "sessions", `${sessionId}.jsonl`),
    workspacePath
      ? path.join(workspacePath, ".openclaw", "agents", agentId, "sessions", `${sessionId}.jsonl`)
      : null
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

function createFallbackRuntimeOutput(runtime: RuntimeRecord): RuntimeOutputRecord {
  const timestamp = new Date().toISOString();

  return {
    runtimeId: runtime.id,
    sessionId: runtime.sessionId,
    taskId: runtime.taskId,
    status: "available",
    finalText: "Fallback mode is active. Connect a real OpenClaw gateway to inspect live runtime output.",
    finalTimestamp: timestamp,
    stopReason: "fallback",
    errorMessage: null,
    items: [
      {
        id: `${runtime.id}:fallback`,
        role: "assistant",
        timestamp,
        text: "Fallback mode is active. Connect a real OpenClaw gateway to inspect live runtime output.",
        stopReason: "fallback",
        isError: false
      }
    ],
    createdFiles: [],
    warnings: [],
    warningSummary: null
  };
}

function createMissingRuntimeOutput(runtime: RuntimeRecord, errorMessage: string): RuntimeOutputRecord {
  return {
    runtimeId: runtime.id,
    sessionId: runtime.sessionId,
    taskId: runtime.taskId,
    status: "missing",
    finalText: null,
    finalTimestamp: null,
    stopReason: null,
    errorMessage,
    items: [],
    createdFiles: [],
    warnings: [],
    warningSummary: null
  };
}

function buildTaskFeed(
  task: TaskRecord,
  runs: RuntimeRecord[],
  outputsByRuntimeId: Map<string, RuntimeOutputRecord>,
  snapshot: MissionControlSnapshot
) {
  const agentNameById = new Map(snapshot.agents.map((agent) => [agent.id, formatAgentDisplayName(agent)]));
  const events: TaskFeedEvent[] = [];
  const sortedRuns = [...runs].sort((left, right) => (left.updatedAt ?? 0) - (right.updatedAt ?? 0));

  for (const runtime of sortedRuns) {
    if (task.dispatchId && isSyntheticDispatchRuntime(runtime)) {
      continue;
    }

    const output = outputsByRuntimeId.get(runtime.id);
    const agentName = runtime.agentId ? agentNameById.get(runtime.agentId) ?? null : null;
    const runtimeTimestamp = timestampFromRuntime(runtime, output?.finalTimestamp);

    if (output?.items.length) {
      for (const item of output.items) {
        events.push(
          enrichTaskFeedEvent(
            {
              id: `${runtime.id}:${item.id}`,
              kind:
                item.role === "assistant"
                  ? "assistant"
                  : item.role === "toolResult"
                    ? "tool"
                    : "user",
              timestamp: item.timestamp,
              title:
                item.role === "assistant"
                  ? agentName || "Agent update"
                  : item.role === "toolResult"
                    ? item.toolName
                      ? `Tool · ${item.toolName}`
                      : "Tool update"
                    : "Mission",
              detail: summarizeText(item.text.trim() || output.errorMessage || runtime.subtitle, 220),
              runtimeId: runtime.id,
              agentId: runtime.agentId,
              toolName: item.toolName,
              isError: item.isError
            },
            {
              urlSources: [item.text, output?.finalText, output?.errorMessage, runtime.subtitle]
            }
          )
        );
      }
    } else {
      events.push(
        enrichTaskFeedEvent(
          {
            id: `${runtime.id}:status`,
            kind: "status",
            timestamp: runtimeTimestamp,
            title: agentName ? `${agentName} · ${runtime.status}` : `Run · ${runtime.status}`,
            detail: summarizeText(output?.errorMessage || runtime.subtitle, 220),
            runtimeId: runtime.id,
            agentId: runtime.agentId,
            isError: runtime.status === "stalled"
          },
          {
            urlSources: [output?.errorMessage, runtime.subtitle]
          }
        )
      );
    }

    const warningValues = uniqueStrings(
      (output?.warnings ?? []).concat(extractWarningsFromRuntimeMetadata(runtime))
    );
    for (const warning of warningValues) {
      events.push(
        enrichTaskFeedEvent(
          {
            id: `${runtime.id}:warning:${hashTaskKey(warning)}`,
            kind: "warning",
            timestamp: runtimeTimestamp,
            title: "Fallback",
            detail: summarizeText(warning, 220),
            runtimeId: runtime.id,
            agentId: runtime.agentId
          },
          {
            urlSources: [warning]
          }
        )
      );
    }

    const createdFiles = dedupeCreatedFiles(
      (output?.createdFiles ?? []).concat(extractCreatedFilesFromRuntimeMetadata(runtime))
    );
    for (const file of createdFiles) {
      events.push(
        enrichTaskFeedEvent(
          {
            id: `${runtime.id}:artifact:${hashTaskKey(file.path)}`,
            kind: "artifact",
            timestamp: runtimeTimestamp,
            title: "Created file",
            detail: file.displayPath,
            runtimeId: runtime.id,
            agentId: runtime.agentId
          },
          {
            file
          }
        )
      );
    }
  }

  if (events.length === 0 && task.mission && !task.dispatchId) {
    events.push(
      enrichTaskFeedEvent(
        {
          id: `${task.id}:mission`,
          kind: "user",
          timestamp: timestampFromUnix(task.updatedAt),
          title: "Mission",
          detail: summarizeText(task.mission, 220),
          agentId: task.primaryAgentId
        },
        {
          urlSources: [task.mission]
        }
      )
    );
  }

  return events
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
    .slice(-36);
}

function buildMissionDispatchFeed(
  task: TaskRecord,
  record: MissionDispatchRecord | null,
  snapshot: MissionControlSnapshot
) {
  if (!record) {
    return [] as TaskFeedEvent[];
  }

  const agentName = formatAgentDisplayName(
    snapshot.agents.find((agent) => agent.id === task.primaryAgentId) ?? { name: "OpenClaw" }
  );
  const events: TaskFeedEvent[] = [
    enrichTaskFeedEvent(
      {
        id: `${record.id}:accepted`,
        kind: "user",
        timestamp: record.submittedAt,
        title: "Mission accepted",
        detail: summarizeText(task.mission || record.mission || "Mission queued for dispatch.", 220),
        agentId: task.primaryAgentId
      },
      {
        urlSources: [task.mission, record.mission, record.routedMission]
      }
    )
  ];

  if (record.runner.startedAt || record.runner.pid) {
    events.push(
      enrichTaskFeedEvent(
        {
          id: `${record.id}:runner-started`,
          kind: "status",
          timestamp: record.runner.startedAt ?? record.updatedAt,
          title: "Dispatch runner started",
          detail: record.outputDirRelative
            ? `Preparing the first OpenClaw runtime in ${record.outputDirRelative}.`
            : "Preparing the first OpenClaw runtime."
        },
        {
          file:
            record.outputDir && record.outputDirRelative
              ? {
                  path: record.outputDir,
                  displayPath: record.outputDirRelative
                }
              : null
        }
      )
    );
  }

  if (record.runner.lastHeartbeatAt) {
    events.push(
      enrichTaskFeedEvent(
        {
          id: `${record.id}:heartbeat`,
          kind: "status",
          timestamp: record.runner.lastHeartbeatAt,
          title: "Heartbeat received",
          detail: `${agentName} is online. Waiting for the first runtime session.`
        },
        {
          urlSources: [agentName, record.outputDirRelative]
        }
      )
    );
  }

  if (record.observation.observedAt) {
    events.push(
      enrichTaskFeedEvent(
        {
          id: `${record.id}:runtime-observed`,
          kind: "status",
          timestamp: record.observation.observedAt,
          title: "Runtime observed",
          detail: "The task is now live. Runtime updates will continue below."
        },
        {
          urlSources: [record.outputDirRelative]
        }
      )
    );
  }

  if (record.status === "completed") {
    const completionSummary = resolveMissionDispatchSummary(record) || resolveMissionDispatchResultText(record);
    events.push(
      enrichTaskFeedEvent(
        {
          id: `${record.id}:completed`,
          kind: "status",
          timestamp: record.runner.finishedAt ?? record.updatedAt,
          title: completionSummary ? "Mission finished" : "Dispatch runner finished",
          detail: summarizeText(completionSummary || resolveMissionDispatchCompletionDetail(record), 220)
        },
        {
          urlSources: [completionSummary, resolveMissionDispatchCompletionDetail(record), record.outputDirRelative],
          file:
            record.outputDir && record.outputDirRelative
              ? {
                  path: record.outputDir,
                  displayPath: record.outputDirRelative
                }
              : null
        }
      )
    );
  }

  if (record.status === "cancelled") {
    events.push(
      enrichTaskFeedEvent(
        {
          id: `${record.id}:cancelled`,
          kind: "warning",
          timestamp: record.runner.finishedAt ?? record.updatedAt,
          title: "Mission cancelled",
          detail: summarizeText(resolveMissionDispatchCompletionDetail(record), 220),
          isError: false
        },
        {
          urlSources: [record.error, record.outputDirRelative],
          file:
            record.outputDir && record.outputDirRelative
              ? {
                  path: record.outputDir,
                  displayPath: record.outputDirRelative
                }
              : null
        }
      )
    );
  }

  const integrityWarning = resolveMissionDispatchIntegrityWarning(record);

  if (integrityWarning) {
    events.push(
      enrichTaskFeedEvent(
        {
          id: `${record.id}:integrity-warning`,
          kind: "warning",
          timestamp: record.runner.finishedAt ?? record.updatedAt,
          title: "Result needs review",
          detail: summarizeText(integrityWarning, 220),
          isError: true
        },
        {
          urlSources: [record.outputDirRelative],
          file:
            record.outputDir && record.outputDirRelative
              ? {
                  path: record.outputDir,
                  displayPath: record.outputDirRelative
                }
              : null
        }
      )
    );
  }

  if (record.status === "stalled") {
    events.push(
      enrichTaskFeedEvent(
        {
          id: `${record.id}:stalled`,
          kind: "warning",
          timestamp: record.updatedAt,
          title: record.error ? "Dispatch error" : "Dispatch stalled",
          detail: summarizeText(
            record.error ||
              (record.runner.lastHeartbeatAt
                ? "OpenClaw stopped reporting progress while waiting for the first runtime."
                : "OpenClaw did not produce the first heartbeat in time."),
            220
          ),
          isError: true
        },
        {
          urlSources: [record.error, record.outputDirRelative]
        }
      )
    );
  }

  return events;
}

function mergeTaskFeedEvents(...feeds: TaskFeedEvent[][]) {
  const deduped = new Map<string, TaskFeedEvent>();

  for (const event of feeds.flat()) {
    deduped.set(event.id, event);
  }

  return [...deduped.values()]
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
    .slice(-48);
}

function enrichTaskFeedEvent(
  event: TaskFeedEvent,
  options?: {
    urlSources?: Array<string | null | undefined>;
    file?: RuntimeCreatedFile | null;
  }
): TaskFeedEvent {
  const url = extractFirstUrlFromSources(options?.urlSources ?? []);

  return {
    ...event,
    ...(url ? { url } : {}),
    ...(options?.file ? { filePath: options.file.path, displayPath: options.file.displayPath } : {})
  };
}

function extractFirstUrlFromSources(sources: Array<string | null | undefined>) {
  for (const source of sources) {
    if (typeof source !== "string") {
      continue;
    }

    const match = source.match(/https?:\/\/[^\s<>"'`]+/i);

    if (!match) {
      continue;
    }

    const normalized = stripTrailingUrlPunctuation(match[0]);

    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function stripTrailingUrlPunctuation(value: string) {
  return value.replace(/[)\].,;:!?]+$/g, "");
}

function timestampFromRuntime(runtime: RuntimeRecord, preferred?: string | null) {
  if (preferred) {
    return preferred;
  }

  return timestampFromUnix(runtime.updatedAt);
}

function timestampFromUnix(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value).toISOString()
    : new Date().toISOString();
}

function parseRuntimeOutput(runtime: RuntimeRecord, raw: string, workspacePath?: string): RuntimeOutputRecord {
  const turns = extractTranscriptTurns(raw, runtime, workspacePath);

  if (runtime.source === "turn") {
    const turnId = typeof runtime.metadata.turnId === "string" ? runtime.metadata.turnId : null;
    const turn = turnId ? turns.find((entry) => entry.id === turnId) : resolveRuntimeMissionTurn(runtime, turns);

    if (turn) {
      return runtimeOutputFromTurn(runtime, turn);
    }
  }

  const latestTurn = turns.at(-1);

  if (latestTurn) {
    return runtimeOutputFromTurn(runtime, latestTurn);
  }

  return {
    runtimeId: runtime.id,
    sessionId: runtime.sessionId,
    taskId: runtime.taskId,
    status: "missing",
    finalText: null,
    finalTimestamp: null,
    stopReason: null,
    errorMessage: "No transcript entries were found for this runtime.",
    items: [],
    createdFiles: [],
    warnings: [],
    warningSummary: null
  };
}

function resolveRuntimeMissionTurn(runtime: RuntimeRecord, turns: TranscriptTurn[]) {
  const mission = typeof runtime.metadata.mission === "string" ? runtime.metadata.mission : null;

  if (!mission) {
    return null;
  }

  const matchingTurns = turns.filter((turn) => matchesMissionText(turn.prompt, mission));

  if (matchingTurns.length === 0) {
    return null;
  }

  const runtimeUpdatedAt = runtime.updatedAt ?? 0;

  return matchingTurns.sort((left, right) => {
    const leftUpdatedAt = Date.parse(left.updatedAt);
    const rightUpdatedAt = Date.parse(right.updatedAt);
    const leftDelta = Math.abs((Number.isNaN(leftUpdatedAt) ? 0 : leftUpdatedAt) - runtimeUpdatedAt);
    const rightDelta = Math.abs((Number.isNaN(rightUpdatedAt) ? 0 : rightUpdatedAt) - runtimeUpdatedAt);

    return leftDelta - rightDelta;
  })[0];
}

function runtimeOutputFromTurn(runtime: RuntimeRecord, turn: TranscriptTurn): RuntimeOutputRecord {
  return {
    runtimeId: runtime.id,
    sessionId: runtime.sessionId,
    taskId: runtime.taskId,
    status: turn.items.length > 0 ? "available" : "missing",
    finalText: turn.finalText,
    finalTimestamp: turn.finalTimestamp,
    stopReason: turn.stopReason,
    errorMessage: turn.errorMessage,
    items: turn.items.slice(-12),
    createdFiles: turn.createdFiles,
    warnings: turn.warnings,
    warningSummary: turn.warningSummary
  };
}

function extractTranscriptTurns(raw: string, runtime: RuntimeRecord, workspacePath?: string) {
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const turns: TranscriptTurn[] = [];
  let sessionCwd = workspacePath;
  let currentTurn:
    | (Omit<TranscriptTurn, "status" | "finalText" | "finalTimestamp" | "stopReason" | "errorMessage" | "warningSummary"> & {
        errorMessage: string | null;
        pendingCreatedFiles: Map<string, RuntimeCreatedFile>;
        pendingToolNames: Set<string>;
      })
    | null = null;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as SessionTranscriptEntry;

      if (entry.type === "session" && typeof entry.cwd === "string" && entry.cwd.trim()) {
        sessionCwd = entry.cwd.trim();
        continue;
      }

      if (entry.type === "custom" && entry.customType === "openclaw:prompt-error" && currentTurn) {
        currentTurn.runId ||= entry.data?.runId;
        currentTurn.updatedAt = entry.timestamp || currentTurn.updatedAt;
        currentTurn.errorMessage ||= entry.data?.error || null;
        continue;
      }

      if (entry.type !== "message" || !entry.message?.role) {
        continue;
      }

      const role = entry.message.role;

      if (role !== "assistant" && role !== "toolResult" && role !== "user") {
        continue;
      }

      const text = extractTranscriptText(entry.message.content);
      const errorMessage = entry.message.errorMessage ?? null;
      const warningMessage = resolveNonFatalToolWarning(role, entry.message, text, errorMessage);

      if (!text && !errorMessage) {
        if (
          !(
            (role === "assistant" && entry.message.content?.some((item) => item.type === "toolCall")) ||
            (role === "toolResult" && typeof entry.message.toolName === "string" && entry.message.toolName.trim())
          )
        ) {
          continue;
        }
      }

      const item: RuntimeOutputItem = {
        id: entry.id || `${role}-${Date.now()}`,
        role,
        timestamp: entry.timestamp || new Date().toISOString(),
        text: text || errorMessage || "",
        toolName:
          role === "toolResult"
            ? entry.message.toolName?.trim() || extractToolNameFromTranscriptText(text)
            : undefined,
        stopReason: role === "assistant" ? entry.message.stopReason ?? null : null,
        errorMessage,
        isWarning: Boolean(warningMessage),
        isError:
          Boolean(errorMessage) ||
          entry.message.isError === true ||
          entry.message.stopReason === "error" ||
          entry.message.stopReason === "aborted"
      };

      if (role === "user") {
        if (currentTurn) {
          turns.push(finalizeTranscriptTurn(currentTurn));
        }

        currentTurn = {
          id: entry.id || `turn-${turns.length}`,
          prompt: normalizeTranscriptPrompt(item.text),
          sessionId: runtime.sessionId,
          runId: undefined,
          timestamp: item.timestamp,
          updatedAt: item.timestamp,
          items: [item],
          tokenUsage: undefined,
          errorMessage: null,
          createdFiles: [],
          warnings: [],
          toolNames: [],
          pendingCreatedFiles: new Map(),
          pendingToolNames: new Set()
        };
        continue;
      }

      if (!currentTurn) {
        continue;
      }

      if (role === "assistant" && Array.isArray(entry.message.content)) {
        for (const contentItem of entry.message.content) {
          if (contentItem.type !== "toolCall") {
            continue;
          }

          if (typeof contentItem.name === "string" && contentItem.name.trim()) {
            currentTurn.pendingToolNames.add(contentItem.name.trim());
          }

          if (contentItem.name !== "write") {
            continue;
          }

          const candidatePath =
            typeof contentItem.arguments?.path === "string" ? contentItem.arguments.path.trim() : "";

          if (!candidatePath) {
            continue;
          }

          const resolved = resolveTranscriptArtifactPath(candidatePath, sessionCwd);

          if (!resolved) {
            continue;
          }

          currentTurn.pendingCreatedFiles.set(contentItem.id || `${entry.id || "toolCall"}:${candidatePath}`, {
            path: resolved.path,
            displayPath: resolved.displayPath
          });
        }
      }

      currentTurn.items.push(item);
      currentTurn.updatedAt = item.timestamp;
      currentTurn.errorMessage ||= errorMessage;

      if (warningMessage && !currentTurn.warnings.includes(warningMessage)) {
        currentTurn.warnings.push(warningMessage);
      }

      if (
        role === "toolResult" &&
        entry.message.isError !== true &&
        entry.message.toolName === "write" &&
        typeof entry.message.toolCallId === "string"
      ) {
        const createdFile = currentTurn.pendingCreatedFiles.get(entry.message.toolCallId);

        if (createdFile) {
          currentTurn.createdFiles.push(createdFile);
          currentTurn.pendingCreatedFiles.delete(entry.message.toolCallId);
        }
      }

      if (role === "toolResult") {
        const toolName =
          entry.message.toolName?.trim() || extractToolNameFromTranscriptText(item.text)?.trim() || null;

        if (toolName) {
          currentTurn.pendingToolNames.add(toolName);
        }
      }

      if (role === "assistant" && entry.message.usage) {
        const usage = entry.message.usage as {
          input?: number;
          output?: number;
          totalTokens?: number;
          cacheRead?: number;
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
        currentTurn.tokenUsage = {
          input: usage.input ?? usage.prompt_tokens ?? 0,
          output: usage.output ?? usage.completion_tokens ?? 0,
          total:
            usage.totalTokens ??
            usage.total_tokens ??
            (usage.input ?? usage.prompt_tokens ?? 0) + (usage.output ?? usage.completion_tokens ?? 0),
          cacheRead: usage.cacheRead ?? 0
        };
      }
    } catch {
      continue;
    }
  }

  if (currentTurn) {
    turns.push(finalizeTranscriptTurn(currentTurn));
  }

  return turns;
}

function finalizeTranscriptTurn(
  turn: Omit<TranscriptTurn, "status" | "finalText" | "finalTimestamp" | "stopReason" | "warningSummary"> & {
    errorMessage: string | null;
    pendingCreatedFiles: Map<string, RuntimeCreatedFile>;
    pendingToolNames: Set<string>;
  }
): TranscriptTurn {
  const { pendingCreatedFiles, pendingToolNames, ...rest } = turn;
  void pendingCreatedFiles;
  void pendingToolNames;
  const finalAssistant = [...turn.items]
    .reverse()
    .find((item) => item.role === "assistant" && (item.text.trim().length > 0 || item.errorMessage));
  const lastItem = turn.items.at(-1);
  const stopReason = finalAssistant?.stopReason ?? null;
  const hasError =
    Boolean(turn.errorMessage) ||
    finalAssistant?.isError === true ||
    stopReason === "error" ||
    stopReason === "aborted";
  const warnings = unique(turn.warnings);
  const status =
    hasError
      ? "stalled"
      : lastItem?.role === "assistant" && lastItem.stopReason && lastItem.stopReason !== "toolUse"
        ? "completed"
        : "running";

  return {
    ...rest,
    status,
    finalText: finalAssistant?.text ?? null,
    finalTimestamp: finalAssistant?.timestamp ?? null,
    stopReason,
    errorMessage: turn.errorMessage || finalAssistant?.errorMessage || null,
    createdFiles: dedupeCreatedFiles(turn.createdFiles),
    warnings,
    warningSummary: warnings[0] ?? null,
    toolNames: uniqueStrings([...turn.pendingToolNames])
  };
}

function collectTranscriptToolNames(turns: TranscriptTurn[]) {
  return uniqueStrings(turns.flatMap((turn) => turn.toolNames));
}

function createTurnRuntime(
  runtime: RuntimeRecord,
  turn: TranscriptTurn,
  toolNames: string[] = turn.toolNames
): RuntimeRecord {
  const updatedAt = Date.parse(turn.updatedAt);
  const title = formatTurnTitle(turn.prompt, runtime.agentId);
  const subtitle =
    turn.warningSummary
      ? summarizeText(`Completed with fallback: ${turn.warningSummary}`, 90)
      : turn.finalText
        ? summarizeText(turn.finalText, 90)
        : turn.status === "stalled"
          ? "Run stalled"
          : "Main session run";

  return {
    id: `runtime:${runtime.sessionId}:${turn.id}`,
    source: "turn",
    key: `${runtime.key}:turn:${turn.id}`,
    title,
    subtitle,
    status: turn.status,
    updatedAt: Number.isNaN(updatedAt) ? runtime.updatedAt : updatedAt,
    ageMs: Number.isNaN(updatedAt) ? runtime.ageMs : Math.max(Date.now() - updatedAt, 0),
    agentId: runtime.agentId,
    workspaceId: runtime.workspaceId,
    modelId: runtime.modelId,
    sessionId: runtime.sessionId,
    taskId: runtime.taskId,
    runId: turn.runId || turn.id,
    toolNames,
    tokenUsage: turn.tokenUsage,
    metadata: {
      ...runtime.metadata,
      turnId: turn.id,
      turnPrompt: turn.prompt,
      stage: "main.turn",
      historical: turn.status !== "running",
      createdFiles: turn.createdFiles,
      warnings: turn.warnings,
      warningSummary: turn.warningSummary
    }
  };
}

function resolveTranscriptArtifactPath(targetPath: string, basePath?: string) {
  const normalizedTarget = targetPath.trim();

  if (!normalizedTarget) {
    return null;
  }

  const absolutePath = path.isAbsolute(normalizedTarget)
    ? path.normalize(normalizedTarget)
    : basePath
      ? path.resolve(basePath, normalizedTarget)
      : null;

  if (!absolutePath) {
    return null;
  }

  const displayPath =
    basePath && absolutePath.startsWith(`${path.resolve(basePath)}${path.sep}`)
      ? path.relative(path.resolve(basePath), absolutePath) || path.basename(absolutePath)
      : absolutePath;

  return {
    path: absolutePath,
    displayPath
  } satisfies RuntimeCreatedFile;
}

function dedupeCreatedFiles(files: RuntimeCreatedFile[]) {
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

function normalizeTranscriptPrompt(text: string) {
  return text
    .replace(/^Sender \(untrusted metadata\):[\s\S]*?```[\s\S]*?```\s*/i, "")
    .replace(/^\[[^\]]+\]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatTurnTitle(prompt: string, agentId?: string) {
  const normalized = prompt.trim();

  if (!normalized) {
    return `${prettifyAgentName(agentId)} run`;
  }

  return compactMissionText(normalized, 38) || `${prettifyAgentName(agentId)} run`;
}

function summarizeText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(maxLength - 1, 1)).trimEnd()}…`;
}

function resolveNonFatalToolWarning(
  role: NonNullable<SessionTranscriptEntry["message"]>["role"],
  message: NonNullable<SessionTranscriptEntry["message"]>,
  text: string,
  errorMessage: string | null
) {
  if (role !== "toolResult" || message.isError === true || errorMessage) {
    return null;
  }

  const exitCode = message.details?.exitCode;

  if (typeof exitCode !== "number" || exitCode === 0) {
    return null;
  }

  const sourceText = message.details?.aggregated || text;
  const cleaned = sourceText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^\(Command exited with code \d+\)$/i.test(line));
  const primaryLine =
    cleaned.find((line) => !line.startsWith("[WARNING]")) ||
    cleaned.find((line) => line.startsWith("[WARNING]")) ||
    `${message.toolName || "tool"} exited with code ${exitCode}`;
  const normalized = primaryLine.replace(/^\[WARNING\]\s*/i, "").trim();

  return summarizeText(normalized || `${message.toolName || "tool"} exited with code ${exitCode}`, 160);
}

function isHeartbeatTurn(prompt: string) {
  return prompt.toLowerCase().startsWith("read heartbeat.md if it exists");
}

function extractTranscriptText(
  content: Array<{
    type?: string;
    text?: string;
    thinking?: string;
  }> = []
) {
  return content
    .flatMap((item) => {
      if (item.type === "text" && item.text) {
        return [item.text];
      }

      if (item.type === "thinking" && item.thinking) {
        return [`[thinking] ${item.thinking}`];
      }

      return [];
    })
    .join("\n\n")
    .trim();
}

function extractToolNameFromTranscriptText(text: string) {
  const match = text.match(/"tool(Name)?":\s*"([^"]+)"/i);
  return match?.[2];
}

function workspaceIdFromPath(workspacePath: string) {
  const hash = createHash("sha1").update(workspacePath).digest("hex").slice(0, 8);
  return `workspace:${hash}`;
}

async function readAgentBootstrapProfile(
  workspacePath: string,
  options: {
    agentId: string;
    agentName: string;
    agentDir?: string;
    configuredSkills: string[];
    configuredTools: string[];
    template?: WorkspaceTemplate | null;
    rules?: WorkspaceCreateRules;
  }
): Promise<AgentBootstrapProfile> {
  const bootstrapFiles = ["AGENTS.md", "SOUL.md", "IDENTITY.md", "TOOLS.md", "HEARTBEAT.md"] as const;
  const searchRoots = [
    workspacePath,
    normalizeOptionalValue(options.agentDir)
  ].filter((value): value is string => Boolean(value));
  const contextManifest = buildWorkspaceContextManifest(
    options.template,
    options.rules ?? DEFAULT_WORKSPACE_RULES
  );
  const profileFiles = [
    ...new Set([...bootstrapFiles, ...contextManifest.resources.map((spec) => spec.relativePath)])
  ];
  const sources: string[] = [];
  const sections = new Map<string, string[]>();

  for (const fileName of profileFiles) {
    for (const rootPath of searchRoots) {
      const filePath = path.join(rootPath, fileName);

      try {
        await access(filePath);
        const raw = await readFile(filePath, "utf8");
        const trimmed = raw.trim();
        if (!trimmed) {
          continue;
        }

        sources.push(describeBootstrapSourcePath(workspacePath, filePath));
        sections.set(fileName, trimmed.split(/\r?\n/));
      } catch {
        continue;
      }
    }
  }

  const purpose =
    extractPurpose(sections) ??
    inferPurposeFromConfig({
      agentId: options.agentId,
      agentName: options.agentName,
      skills: options.configuredSkills
    });
  const operatingInstructions = collectBulletSections(sections, [
    { file: "AGENTS.md", heading: "Safety defaults" },
    { file: "AGENTS.md", heading: "Daily memory" },
    { file: "AGENTS.md", heading: "Output" },
    { file: "SOUL.md", heading: "How I Operate" },
    { file: "TOOLS.md", heading: "Examples" },
    { file: "MEMORY.md", heading: "Stable facts" },
    { file: "memory/blueprint.md", heading: "Constraints" },
    { file: "memory/blueprint.md", heading: "Unknowns" },
    { file: "docs/brief.md", heading: "Success signals" },
    { file: "docs/brief.md", heading: "Open questions" },
    { file: "docs/architecture.md", heading: "Dependencies" },
    { file: "docs/architecture.md", heading: "Risks" },
    { file: "deliverables/README.md", heading: "Deliverables" },
    ...contextManifest.resources
      .filter((spec) => spec.relativePath.startsWith("docs/") && spec.relativePath !== "docs/brief.md" && spec.relativePath !== "docs/architecture.md")
      .flatMap((spec) => spec.headings.map((heading) => ({ file: spec.relativePath, heading })))
  ]).slice(0, 8);
  const responseStyle =
    uniqueStrings([
      ...extractInlineList(sections.get("IDENTITY.md"), "Vibe"),
      ...extractBulletSection(sections.get("SOUL.md"), "My Quirks"),
      ...extractBulletSection(sections.get("SOUL.md"), "How I Operate")
    ]).slice(0, 6) || [];
  const outputPreference =
    extractOutputPreference(sections.get("AGENTS.md")) ??
    extractOutputPreference(sections.get("deliverables/README.md")) ??
    inferOutputPreference(options.configuredTools);

  return {
    purpose,
    operatingInstructions:
      operatingInstructions.length > 0 ? operatingInstructions : inferOperatingInstructions(options.configuredTools),
    responseStyle,
    outputPreference,
    sourceFiles: sources
  };
}

function describeBootstrapSourcePath(workspacePath: string, filePath: string) {
  const resolvedWorkspacePath = path.resolve(workspacePath);
  const resolvedFilePath = path.resolve(filePath);

  if (
    resolvedFilePath === resolvedWorkspacePath ||
    resolvedFilePath.startsWith(`${resolvedWorkspacePath}${path.sep}`)
  ) {
    return path.relative(resolvedWorkspacePath, resolvedFilePath) || path.basename(resolvedFilePath);
  }

  return resolvedFilePath;
}

async function readWorkspaceInspectorMetadata(
  workspacePath: string,
  agents: OpenClawAgent[]
): Promise<Pick<WorkspaceProject, "bootstrap" | "capabilities">> {
  const projectMeta = await readWorkspaceProjectManifest(workspacePath);
  const contextManifest = buildWorkspaceContextManifest(
    projectMeta.template ?? null,
    projectMeta.rules ?? DEFAULT_WORKSPACE_RULES
  );
  const nonContextPaths = new Set<string>([
    ...WORKSPACE_CONTEXT_CORE_PATHS,
    ...WORKSPACE_CONTEXT_OPTIONAL_PATHS
  ]);
  const [coreFiles, optionalFiles, contextFiles, folders, projectShell, localSkillIds] = await Promise.all([
    collectWorkspaceResourceState(workspacePath, [
      { id: "agents", label: "AGENTS.md", relativePath: "AGENTS.md", kind: "file" },
      { id: "soul", label: "SOUL.md", relativePath: "SOUL.md", kind: "file" },
      { id: "identity", label: "IDENTITY.md", relativePath: "IDENTITY.md", kind: "file" },
      { id: "tools", label: "TOOLS.md", relativePath: "TOOLS.md", kind: "file" },
      { id: "heartbeat", label: "HEARTBEAT.md", relativePath: "HEARTBEAT.md", kind: "file" }
    ]),
    collectWorkspaceResourceState(workspacePath, [
      { id: "memory-md", label: "MEMORY.md", relativePath: "MEMORY.md", kind: "file" }
    ]),
    collectWorkspaceResourceState(
      workspacePath,
      contextManifest.resources.filter((resource) => !nonContextPaths.has(resource.relativePath))
    ),
    collectWorkspaceResourceState(workspacePath, [
      { id: "docs", label: "docs/", relativePath: "docs", kind: "directory" },
      { id: "memory", label: "memory/", relativePath: "memory", kind: "directory" },
      { id: "deliverables", label: "deliverables/", relativePath: "deliverables", kind: "directory" },
      { id: "skills", label: "skills/", relativePath: "skills", kind: "directory" },
      { id: "openclaw", label: ".openclaw/", relativePath: ".openclaw", kind: "directory" }
    ]),
    collectWorkspaceResourceState(workspacePath, [
      {
        id: "project-json",
        label: ".openclaw/project.json",
        relativePath: ".openclaw/project.json",
        kind: "file"
      },
      {
        id: "events",
        label: ".openclaw/project-shell/events.jsonl",
        relativePath: ".openclaw/project-shell/events.jsonl",
        kind: "file"
      },
      {
        id: "runs",
        label: ".openclaw/project-shell/runs",
        relativePath: ".openclaw/project-shell/runs",
        kind: "directory"
      },
      {
        id: "tasks",
        label: ".openclaw/project-shell/tasks",
        relativePath: ".openclaw/project-shell/tasks",
        kind: "directory"
      }
    ]),
    listLocalWorkspaceSkills(workspacePath)
  ]);
  const tools = uniqueStrings(agents.flatMap((agent) => agent.tools));
  const skills = uniqueStrings([...localSkillIds, ...agents.flatMap((agent) => agent.skills)]);
  const workspaceOnlyAgentCount = agents.filter((agent) => agent.tools.includes("fs.workspaceOnly")).length;

  return {
    bootstrap: {
      template: projectMeta.template,
      sourceMode: projectMeta.sourceMode,
      agentTemplate: projectMeta.agentTemplate,
      coreFiles,
      optionalFiles,
      contextFiles,
      folders,
      projectShell,
      localSkillIds
    },
    capabilities: {
      skills,
      tools,
      workspaceOnlyAgentCount
    }
  };
}

export async function readWorkspaceEditSeed(workspaceId: string): Promise<WorkspaceEditSeed> {
  const snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
  const workspace = snapshot.workspaces.find((entry) => entry.id === workspaceId);

  if (!workspace) {
    throw new Error("Workspace was not found.");
  }

  const manifest = await readWorkspaceProjectManifest(workspace.path);
  const displayName = manifest.name ?? workspace.name;
  const workspaceAgents = snapshot.agents.filter((agent) => agent.workspaceId === workspace.id);
  const configuredSkills = uniqueStrings(workspaceAgents.flatMap((agent) => agent.skills));
  const configuredTools = uniqueStrings(workspaceAgents.flatMap((agent) => agent.tools));
  const template = manifest.template ?? workspace.bootstrap.template ?? "software";
  const sourceMode = manifest.sourceMode ?? workspace.bootstrap.sourceMode ?? "empty";
  const teamPreset = manifest.teamPreset ?? (workspaceAgents.length <= 1 ? "solo" : "core");
  const modelProfile = manifest.modelProfile ?? "balanced";
  const rules = manifest.rules ?? DEFAULT_WORKSPACE_RULES;
  const bootstrapProfile = await readAgentBootstrapProfile(workspace.path, {
    agentId: workspaceAgents[0]?.id ?? workspace.id,
    agentName: workspaceAgents[0]?.name ?? displayName,
    configuredSkills,
    configuredTools,
    template,
    rules
  });
  const agents =
    manifest.agents.length > 0
      ? manifest.agents.map((entry) => {
          const currentAgent = findMatchingWorkspaceAgent(workspaceAgents, workspace.slug, entry.id);
          const resolvedPolicy = resolveAgentPolicy(
            entry.policy?.preset ?? currentAgent?.policy.preset ?? DEFAULT_AGENT_PRESET,
            entry.policy ?? currentAgent?.policy
          );

          return {
            id: entry.id,
            role: entry.role ?? formatAgentPresetLabel(resolvedPolicy.preset),
            name: entry.name ?? currentAgent?.name ?? entry.role ?? entry.id,
            enabled: entry.enabled,
            emoji: entry.emoji ?? currentAgent?.identity.emoji,
            theme: entry.theme ?? currentAgent?.identity.theme,
            skillId: entry.skillId ?? undefined,
            modelId:
              entry.modelId ??
              (currentAgent?.modelId && currentAgent.modelId !== "unassigned" ? currentAgent.modelId : undefined),
            isPrimary: entry.isPrimary,
            policy: resolvedPolicy,
            channelIds: entry.channelIds ?? [],
            heartbeat: {
              enabled: currentAgent?.heartbeat.enabled ?? false,
              ...(currentAgent?.heartbeat.every ? { every: currentAgent.heartbeat.every } : {})
            }
          } satisfies WorkspaceAgentBlueprintInput;
        })
      : buildDefaultWorkspaceAgents(template, teamPreset, displayName);
  const scaffoldDocuments = buildWorkspaceScaffoldDocuments({
    name: displayName,
    brief: bootstrapProfile.purpose || displayName,
    template,
    sourceMode,
    rules,
    agents,
    toolExamples: await detectWorkspaceToolExamples(workspace.path),
    docOverrides: [],
    contextSources: manifest.contextSources ?? []
  });
  const docOverrides: WorkspaceDocOverride[] = [];
  const scaffoldPathSet = new Set(scaffoldDocuments.map((document) => document.path));
  const editableDocPaths = await collectWorkspaceEditableDocPaths(workspace.path);

  for (const document of scaffoldDocuments) {
    const filePath = path.join(workspace.path, document.path);

    try {
      const currentContent = await readFile(filePath, "utf8");

      if (currentContent !== document.baseContent) {
        docOverrides.push({
          path: document.path,
          content: currentContent
        });
      }
    } catch {
      continue;
    }
  }

  for (const relativePath of editableDocPaths) {
    if (scaffoldPathSet.has(relativePath)) {
      continue;
    }

    const filePath = path.join(workspace.path, relativePath);

    try {
      const currentContent = await readFile(filePath, "utf8");
      docOverrides.push({
        path: relativePath,
        content: currentContent
      });
    } catch {
      continue;
    }
  }

  return {
    workspaceId: workspace.id,
    workspacePath: workspace.path,
    name: displayName,
    directory: workspace.path,
    template,
    sourceMode,
    teamPreset,
    modelProfile,
    modelId: workspace.modelIds[0] && workspace.modelIds[0] !== "unassigned" ? workspace.modelIds[0] : undefined,
    rules,
    docOverrides,
    agents,
    brief: bootstrapProfile.purpose || displayName,
    contextSources: manifest.contextSources ?? []
  };
}

function areWorkspaceCreateRulesEqual(left: WorkspaceCreateRules, right: WorkspaceCreateRules) {
  return (
    left.workspaceOnly === right.workspaceOnly &&
    left.generateStarterDocs === right.generateStarterDocs &&
    left.generateMemory === right.generateMemory &&
    left.kickoffMission === right.kickoffMission
  );
}

function areWorkspaceAgentsEqual(
  left: WorkspaceAgentBlueprintInput[],
  right: WorkspaceAgentBlueprintInput[]
) {
  if (left.length !== right.length) {
    return false;
  }

  const normalizeAgent = (agent: WorkspaceAgentBlueprintInput) => ({
    id: agent.id.trim(),
    role: agent.role.trim(),
    name: agent.name.trim(),
    enabled: agent.enabled,
    emoji: normalizeOptionalValue(agent.emoji) ?? null,
    theme: normalizeOptionalValue(agent.theme) ?? null,
    skillId: normalizeOptionalValue(agent.skillId) ?? null,
    modelId: normalizeOptionalValue(agent.modelId) ?? null,
    isPrimary: Boolean(agent.isPrimary),
    policy: agent.policy
      ? {
          preset: agent.policy.preset,
          missingToolBehavior: agent.policy.missingToolBehavior,
          installScope: agent.policy.installScope,
          fileAccess: agent.policy.fileAccess,
          networkAccess: agent.policy.networkAccess
        }
      : null,
    heartbeat: agent.heartbeat
      ? {
          enabled: agent.heartbeat.enabled,
          every: normalizeOptionalValue(agent.heartbeat.every) ?? null
        }
      : null,
    channelIds: uniqueStrings(agent.channelIds ?? []).sort((left, right) => left.localeCompare(right))
  });

  const sortById = (leftAgent: WorkspaceAgentBlueprintInput, rightAgent: WorkspaceAgentBlueprintInput) =>
    leftAgent.id.localeCompare(rightAgent.id);

  const normalizedLeft = [...left].sort(sortById).map(normalizeAgent);
  const normalizedRight = [...right].sort(sortById).map(normalizeAgent);

  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
}

async function collectWorkspaceEditableDocPaths(workspacePath: string) {
  const docPaths = new Set<string>();
  const rootEntries = await readdir(workspacePath, { withFileTypes: true });

  for (const entry of rootEntries) {
    if (entry.isFile() && isEditableMarkdownFile(entry.name)) {
      docPaths.add(entry.name);
    }
  }

  for (const directoryName of ["docs", "memory"] as const) {
    const directoryPath = path.join(workspacePath, directoryName);

    if (!(await pathMatchesKind(directoryPath, "directory"))) {
      continue;
    }

    const relativePaths = await collectMarkdownPathsInDirectory(directoryPath, directoryName);
    for (const relativePath of relativePaths) {
      docPaths.add(relativePath);
    }
  }

  const deliverablesReadmePath = path.join(workspacePath, "deliverables", "README.md");
  if (await pathMatchesKind(deliverablesReadmePath, "file")) {
    docPaths.add("deliverables/README.md");
  }

  return Array.from(docPaths).sort((left, right) => left.localeCompare(right));
}

async function collectMarkdownPathsInDirectory(absoluteDirectoryPath: string, relativePrefix: string) {
  const results: string[] = [];
  const entries = await readdir(absoluteDirectoryPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const nextRelativePath = path.join(relativePrefix, entry.name);
    const nextAbsolutePath = path.join(absoluteDirectoryPath, entry.name);

    if (entry.isDirectory()) {
      results.push(...(await collectMarkdownPathsInDirectory(nextAbsolutePath, nextRelativePath)));
      continue;
    }

    if (entry.isFile() && isEditableMarkdownFile(entry.name)) {
      results.push(nextRelativePath);
    }
  }

  return results;
}

function isEditableMarkdownFile(fileName: string) {
  return fileName.toLowerCase().endsWith(".md");
}

async function collectWorkspaceResourceState(
  workspacePath: string,
  entries: Array<{
    id: string;
    label: string;
    relativePath: string;
    kind: "file" | "directory";
  }>
) {
  return Promise.all(
    entries.map(async (entry) => ({
      id: entry.id,
      label: entry.label,
      present: await pathMatchesKind(path.join(workspacePath, entry.relativePath), entry.kind)
    }))
  );
}

async function listLocalWorkspaceSkills(workspacePath: string) {
  const skillsPath = path.join(workspacePath, "skills");

  try {
    const entries = await readdir(skillsPath, { withFileTypes: true });
    const localSkills = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const skillFile = path.join(skillsPath, entry.name, "SKILL.md");
          return (await pathMatchesKind(skillFile, "file")) ? entry.name : null;
        })
    );

    return localSkills
      .filter((entry): entry is string => typeof entry === "string" && !isAgentPolicySkillId(entry))
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

async function readWorkspaceProjectManifest(workspacePath: string) {
  const projectFilePath = path.join(workspacePath, ".openclaw", "project.json");

  try {
    const raw = await readFile(projectFilePath, "utf8");
    const candidate = JSON.parse(raw);
    const parsed = isObjectRecord(candidate) ? candidate : {};
    const agents = Array.isArray(parsed.agents)
      ? parsed.agents
          .map((entry) => parseWorkspaceProjectManifestAgent(entry))
          .filter((entry): entry is WorkspaceProjectManifestAgent => Boolean(entry))
      : [];
    const channels = Array.isArray(parsed.channels)
      ? parsed.channels
          .map((entry) => parseWorkspaceProjectManifestChannel(entry))
          .filter((entry): entry is WorkspaceChannelSummary => Boolean(entry))
      : [];
    const rules = parseWorkspaceCreateRules(parsed.rules);

    return {
      name: typeof parsed.name === "string" ? parsed.name : null,
      directory: typeof parsed.directory === "string" ? parsed.directory : null,
      template: isWorkspaceTemplate(parsed.template) ? parsed.template : null,
      sourceMode: isWorkspaceSourceMode(parsed.sourceMode) ? parsed.sourceMode : null,
      agentTemplate: typeof parsed.agentTemplate === "string" ? parsed.agentTemplate : null,
      teamPreset: isWorkspaceTeamPreset(parsed.teamPreset) ? parsed.teamPreset : null,
      modelProfile: isWorkspaceModelProfile(parsed.modelProfile) ? parsed.modelProfile : null,
      rules,
      hidden: parsed.hidden === true,
      systemTag: typeof parsed.systemTag === "string" ? parsed.systemTag : null,
      contextSources: parseWorkspaceProjectManifestContextSources(parsed.contextSources),
      agents,
      channels
    };
  } catch {
    return {
      name: null,
      directory: null,
      template: null,
      sourceMode: null,
      agentTemplate: null,
      teamPreset: null,
      modelProfile: null,
      rules: null,
      hidden: false,
      systemTag: null,
      contextSources: [],
      agents: [],
      channels: []
    };
  }
}

function parseWorkspaceProjectManifestContextSources(raw: unknown): PlannerContextSource[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.flatMap((entry) => {
    if (!isObjectRecord(entry)) {
      return [];
    }

    const kind = isPlannerContextSourceKind(entry.kind) ? entry.kind : "prompt";
    const label = typeof entry.label === "string" && entry.label.trim() ? entry.label.trim() : kind;
    const summary = typeof entry.summary === "string" && entry.summary.trim() ? entry.summary.trim() : label;
    const id =
      typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : `${kind}-${slugify(label) || "context"}`;

    return normalizeWorkspaceContextSources([
      {
        id,
        kind,
        label,
        summary,
        details: Array.isArray(entry.details) ? entry.details.filter((detail): detail is string => typeof detail === "string") : [],
        status: entry.status === "error" ? "error" : "ready",
        createdAt: typeof entry.createdAt === "string" ? entry.createdAt : new Date().toISOString(),
        confidence: typeof entry.confidence === "number" ? entry.confidence : undefined,
        url: typeof entry.url === "string" ? entry.url : undefined,
        error: typeof entry.error === "string" ? entry.error : undefined
      }
    ]);
  });
}

async function readChannelRegistry() {
  try {
    const raw = await readFile(channelRegistryPath, "utf8");
    const candidate = JSON.parse(raw);
    const parsed = isObjectRecord(candidate) ? candidate : {};
    const channels = Array.isArray(parsed.channels)
      ? parsed.channels
          .map((entry) => parseWorkspaceChannelSummary(entry))
          .filter((entry): entry is WorkspaceChannelSummary => Boolean(entry))
      : [];
    const registry = normalizeChannelRegistry({
      version: 1 as const,
      channels
    } satisfies ChannelRegistry);
    return await reconcileTelegramRegistryAccounts(registry);
  } catch {
    return normalizeChannelRegistry({
      version: 1 as const,
      channels: []
    } satisfies ChannelRegistry);
  }
}

async function readChannelAccounts() {
  try {
    const channels = await runOpenClawJson<Record<string, Record<string, unknown>>>([
      "config",
      "get",
      "channels",
      "--json"
    ]);
    const accounts: ChannelAccountRecord[] = Object.entries(channels).flatMap(([type, config]) => {
      const records = isObjectRecord(config?.accounts) ? (config.accounts as Record<string, unknown>) : {};

      return Object.entries(records).flatMap(([accountId, account]) => {
        if (!isPlannerChannelTypeValue(type)) {
          return [];
        }

        const accountRecord = isObjectRecord(account) ? (account as Record<string, unknown>) : {};

        return [
          {
            id: accountId,
            type,
            name: typeof accountRecord.name === "string" ? accountRecord.name : accountId,
            enabled: accountRecord.enabled !== false
          }
        ] satisfies ChannelAccountRecord[];
      });
    });
    return dedupeChannelAccounts(accounts, channels);
  } catch {
    return [] as ChannelAccountRecord[];
  }
}

type TelegramPairingRequest = {
  id?: string;
  code?: string;
  createdAt?: string;
  lastSeenAt?: string;
  meta?: {
    username?: string;
    firstName?: string;
    accountId?: string;
  };
};

async function readTelegramPairingAccounts() {
  try {
    const raw = await readFile(path.join(openClawStateRootPath, "credentials", "telegram-pairing.json"), "utf8");
    const parsed = JSON.parse(raw) as { requests?: TelegramPairingRequest[] } | null;
    const requests = Array.isArray(parsed?.requests) ? parsed.requests : [];
    const accounts = new Map<string, ChannelAccountRecord>();

    for (const request of requests) {
      const accountId = normalizeOptionalValue(request.meta?.accountId);
      if (!accountId) {
        continue;
      }

      accounts.set(accountId, {
        id: accountId,
        type: "telegram",
        name:
          normalizeOptionalValue(request.meta?.username) ??
          normalizeOptionalValue(request.meta?.firstName) ??
          accountId,
        enabled: true
      });
    }

    return Array.from(accounts.values());
  } catch {
    return [] as ChannelAccountRecord[];
  }
}

async function readTelegramAccountBotIds() {
  try {
    const telegramDir = path.join(openClawStateRootPath, "telegram");
    const files = await readdir(telegramDir);
    const pairs = await Promise.all(
      files
        .filter((fileName) => fileName.startsWith("update-offset-") && fileName.endsWith(".json"))
        .map(async (fileName) => {
          try {
            const raw = await readFile(path.join(telegramDir, fileName), "utf8");
            const parsed = JSON.parse(raw) as { botId?: string } | null;
            const botId = normalizeOptionalValue(parsed?.botId);
            const accountId = fileName.slice("update-offset-".length, -".json".length);

            if (!botId || !accountId) {
              return null;
            }

            return [accountId, botId] as const;
          } catch {
            return null;
          }
        })
    );

    return new Map(pairs.filter((entry): entry is readonly [string, string] => Boolean(entry)));
  } catch {
    return new Map<string, string>();
  }
}

function dedupeChannelAccounts(
  accounts: ChannelAccountRecord[],
  channels: Record<string, Record<string, unknown>>
) {
  const telegramConfig = isObjectRecord(channels.telegram) ? (channels.telegram as Record<string, unknown>) : null;
  const telegramRecords = isObjectRecord(telegramConfig?.accounts)
    ? (telegramConfig.accounts as Record<string, unknown>)
    : {};
  const telegramDefaultAccount = normalizeOptionalValue(telegramConfig?.defaultAccount as string | null | undefined);
  const telegramByBot = new Map<string, ChannelAccountRecord>();
  const others: ChannelAccountRecord[] = [];

  for (const account of accounts) {
    if (account.type !== "telegram") {
      others.push(account);
      continue;
    }

    const record = isObjectRecord(telegramRecords[account.id]) ? (telegramRecords[account.id] as Record<string, unknown>) : null;
    const token = normalizeOptionalValue(record?.botToken as string | null | undefined);
    const botId = token?.split(":", 1)[0]?.trim();

    if (!botId) {
      if (!telegramByBot.has(account.id)) {
        telegramByBot.set(account.id, account);
      }
      continue;
    }

    const current = telegramByBot.get(botId);
    if (!current) {
      telegramByBot.set(botId, account);
      continue;
    }

    const candidateScore = scoreTelegramAccountChoice(account.id, telegramDefaultAccount);
    const currentScore = scoreTelegramAccountChoice(current.id, telegramDefaultAccount);
    if (candidateScore > currentScore) {
      telegramByBot.set(botId, account);
    }
  }

  return [...others, ...Array.from(telegramByBot.values())];
}

function scoreTelegramAccountChoice(accountId: string, defaultAccountId: string | null | undefined) {
  if (defaultAccountId && accountId === defaultAccountId) {
    return 3;
  }

  if (accountId !== "default") {
    return 2;
  }

  return 1;
}

async function findTelegramAccountByToken(token: string, accounts: ChannelAccountRecord[]) {
  const botId = normalizeOptionalValue(token.split(":", 1)[0]);
  if (!botId) {
    return null;
  }

  const accountBotIds = await readTelegramAccountBotIds();
  return accounts.find((account) => accountBotIds.get(account.id) === botId) ?? null;
}

async function reconcileTelegramRegistryAccounts(registry: ChannelRegistry) {
  const telegramAccounts = (await readChannelAccounts()).filter((account) => account.type === "telegram");
  if (telegramAccounts.length === 0) {
    return registry;
  }

  const accountIds = new Set(telegramAccounts.map((account) => account.id));
  const accountsByName = new Map<string, ChannelAccountRecord[]>();

  for (const account of telegramAccounts) {
    const key = account.name.trim().toLowerCase();
    if (!key) {
      continue;
    }

    const current = accountsByName.get(key) ?? [];
    current.push(account);
    accountsByName.set(key, current);
  }

  let changed = false;
  const nextChannels = registry.channels.map((channel) => {
    if (channel.type !== "telegram" || accountIds.has(channel.id)) {
      return channel;
    }

    const matches = accountsByName.get(channel.name.trim().toLowerCase()) ?? [];
    if (matches.length !== 1) {
      return channel;
    }

    changed = true;
    return {
      ...channel,
      id: matches[0].id,
      name: matches[0].name
    };
  });

  if (!changed) {
    return registry;
  }

  return normalizeChannelRegistry({
    version: 1,
    channels: nextChannels
  });
}

async function buildTelegramAccountId(name: string) {
  const baseSlug = slugify(name.trim()) || "telegram";
  const baseId = `telegram-${baseSlug}`;
  const registry = await readChannelRegistry();
  const existingIds = new Set([
    ...registry.channels.filter((channel) => channel.type === "telegram").map((channel) => channel.id),
    ...(await readChannelAccounts()).filter((account) => account.type === "telegram").map((account) => account.id)
  ]);

  if (!existingIds.has(baseId)) {
    return baseId;
  }

  let index = 2;
  while (existingIds.has(`${baseId}-${index}`)) {
    index += 1;
  }

  return `${baseId}-${index}`;
}

async function writeChannelRegistry(registry: ChannelRegistry) {
  await writeTextFileEnsured(channelRegistryPath, `${JSON.stringify(registry, null, 2)}\n`);
}

export async function getChannelRegistry() {
  return readChannelRegistry();
}

export async function createTelegramChannelAccount(input: { name: string; token: string; accountId?: string }) {
  const accountId = normalizeOptionalValue(input.accountId) ?? (await buildTelegramAccountId(input.name));
  const before = new Set(
    (await readChannelAccounts())
      .filter((account) => account.type === "telegram")
      .map((account) => account.id)
  );

  await runOpenClaw(
    [
      "channels",
      "add",
      "--channel",
      "telegram",
      "--account",
      accountId,
      "--token",
      input.token,
      "--name",
      input.name
    ],
    { timeoutMs: 60000 }
  );

  const explicitAccount: ChannelAccountRecord = {
    id: accountId,
    type: "telegram",
    name: input.name.trim() || accountId,
    enabled: true
  };

  const afterAccounts = (await readChannelAccounts()).filter((account) => account.type === "telegram");
  const explicitMatch = afterAccounts.find((account) => account.id === accountId);
  if (explicitMatch) {
    return {
      ...explicitMatch,
      name: input.name.trim() || explicitMatch.name
    };
  }

  const resolveDeadline = Date.now() + 8000;
  let created: ChannelAccountRecord | null = null;

  while (Date.now() < resolveDeadline) {
    const after = (await readChannelAccounts()).filter((account) => account.type === "telegram");
    created =
      after.find((account) => account.id === accountId) ??
      after.find((account) => !before.has(account.id) && account.name === input.name) ??
      after.find((account) => !before.has(account.id)) ??
      after.find((account) => account.name === input.name) ??
      null;

    if (created) {
      break;
    }

    const pairingAccounts = await readTelegramPairingAccounts();
    created =
      pairingAccounts.find((account) => !before.has(account.id) && account.name === input.name) ??
      pairingAccounts.find((account) => !before.has(account.id)) ??
      pairingAccounts.find((account) => account.name === input.name) ??
      null;

    if (created) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 750));
  }

  if (!created) {
    const existing = await findTelegramAccountByToken(
      input.token,
      (await readChannelAccounts()).filter((account) => account.type === "telegram")
    );

    if (existing) {
      created = existing;
    } else {
      created = explicitAccount;
    }
  }

  return {
    ...created,
    name: input.name.trim() || created.name
  };
}

async function upsertWorkspaceProjectAgentMetadata(
  workspacePath: string,
  agent: {
    id: string;
    name?: string | null;
    role?: string | null;
    isPrimary?: boolean;
    enabled?: boolean;
    emoji?: string | null;
    theme?: string | null;
    skillId?: string | null;
    toolIds?: string[];
    modelId?: string | null;
    policy: AgentPolicy;
    channelIds?: string[];
  }
) {
  const projectFilePath = path.join(workspacePath, ".openclaw", "project.json");
  let parsed: Record<string, unknown> = {};
  let existingAgent: WorkspaceProjectManifestAgent | null = null;

  try {
    const raw = await readFile(projectFilePath, "utf8");
    const candidate = JSON.parse(raw);
    parsed = isObjectRecord(candidate) ? candidate : {};
    if (Array.isArray(parsed.agents)) {
      existingAgent =
        parsed.agents
          .map((entry) => parseWorkspaceProjectManifestAgent(entry))
          .filter((entry): entry is WorkspaceProjectManifestAgent => Boolean(entry))
          .find((entry) => entry.id === agent.id) ?? null;
    }
  } catch {
    parsed = {};
  }

  const nextAgent = {
    id: agent.id,
    name: agent.name ?? existingAgent?.name ?? null,
    role: agent.role ?? existingAgent?.role ?? null,
    isPrimary: agent.isPrimary ?? existingAgent?.isPrimary ?? false,
    enabled: agent.enabled ?? existingAgent?.enabled ?? true,
    emoji: agent.emoji ?? existingAgent?.emoji ?? null,
    theme: agent.theme ?? existingAgent?.theme ?? null,
    skillId: agent.skillId ?? existingAgent?.skillId ?? null,
    toolIds: Array.isArray(agent.toolIds)
      ? uniqueStrings(
          agent.toolIds
            .map((toolId) => toolId.trim())
            .filter((toolId) => Boolean(toolId) && toolId !== "fs.workspaceOnly")
        )
      : existingAgent?.toolIds ?? [],
    modelId: agent.modelId ?? existingAgent?.modelId ?? null,
    policy: agent.policy,
    channelIds: Array.isArray(agent.channelIds)
      ? Array.from(new Set(agent.channelIds.filter((entry) => typeof entry === "string" && entry.trim())))
      : existingAgent?.channelIds ?? []
  };
  const agents = Array.isArray(parsed.agents)
    ? parsed.agents.filter((entry) => isObjectRecord(entry) && typeof entry.id === "string" && entry.id !== agent.id)
    : [];

  agents.push(nextAgent);
  parsed.version = typeof parsed.version === "number" ? parsed.version : 1;
  parsed.slug = typeof parsed.slug === "string" ? parsed.slug : slugify(path.basename(workspacePath));
  parsed.name = typeof parsed.name === "string" ? parsed.name : path.basename(workspacePath);
  parsed.updatedAt = new Date().toISOString();
  parsed.agents = agents;

  await writeTextFileEnsured(projectFilePath, `${JSON.stringify(parsed, null, 2)}\n`);
}

async function removeWorkspaceProjectAgentMetadata(workspacePath: string, agentId: string) {
  const projectFilePath = path.join(workspacePath, ".openclaw", "project.json");
  let parsed: Record<string, unknown> = {};

  try {
    const raw = await readFile(projectFilePath, "utf8");
    const candidate = JSON.parse(raw);
    parsed = isObjectRecord(candidate) ? candidate : {};
  } catch {
    return;
  }

  if (!Array.isArray(parsed.agents)) {
    return;
  }

  const existingAgents = parsed.agents
    .map((entry) => parseWorkspaceProjectManifestAgent(entry))
    .filter((entry): entry is WorkspaceProjectManifestAgent => Boolean(entry));
  const nextAgents = existingAgents.filter((entry) => entry.id !== agentId);

  if (nextAgents.length === existingAgents.length) {
    return;
  }

  if (nextAgents.length > 0 && !nextAgents.some((entry) => entry.isPrimary)) {
    nextAgents[0] = {
      ...nextAgents[0],
      isPrimary: true
    };
  }

  parsed.updatedAt = new Date().toISOString();
  parsed.agents = nextAgents;

  await writeTextFileEnsured(projectFilePath, `${JSON.stringify(parsed, null, 2)}\n`);
}

async function removeWorkspaceProjectChannelReferences(workspacePath: string, channelId: string) {
  const projectFilePath = path.join(workspacePath, ".openclaw", "project.json");
  let parsed: Record<string, unknown> = {};

  try {
    const raw = await readFile(projectFilePath, "utf8");
    const candidate = JSON.parse(raw);
    parsed = isObjectRecord(candidate) ? candidate : {};
  } catch {
    return;
  }

  if (!Array.isArray(parsed.agents)) {
    return;
  }

  let didChange = false;
  const nextAgents = parsed.agents.map((entry) => {
    if (!isObjectRecord(entry) || typeof entry.id !== "string") {
      return entry;
    }

    const currentChannelIds = Array.isArray(entry.channelIds)
      ? entry.channelIds.filter((value): value is string => typeof value === "string")
      : [];
    const nextChannelIds = currentChannelIds.filter((entry) => entry !== channelId);

    if (nextChannelIds.length === currentChannelIds.length) {
      return entry;
    }

    didChange = true;
    return {
      ...entry,
      channelIds: nextChannelIds
    };
  });

  if (!didChange) {
    return;
  }

  parsed.updatedAt = new Date().toISOString();
  parsed.agents = nextAgents;

  await writeTextFileEnsured(projectFilePath, `${JSON.stringify(parsed, null, 2)}\n`);
}

async function pathMatchesKind(targetPath: string, kind: "file" | "directory") {
  try {
    const targetStat = await stat(targetPath);
    return kind === "directory" ? targetStat.isDirectory() : targetStat.isFile();
  } catch {
    return false;
  }
}

function isWorkspaceTemplate(value: unknown): value is WorkspaceTemplate {
  return (
    value === "software" ||
    value === "frontend" ||
    value === "backend" ||
    value === "research" ||
    value === "content"
  );
}

function isWorkspaceSourceMode(value: unknown): value is WorkspaceSourceMode {
  return value === "empty" || value === "clone" || value === "existing";
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseWorkspaceProjectManifestAgent(value: unknown): WorkspaceProjectManifestAgent | null {
  if (!isObjectRecord(value) || typeof value.id !== "string") {
    return null;
  }

  return {
    id: value.id,
    name: typeof value.name === "string" ? value.name : null,
    role: typeof value.role === "string" ? value.role : null,
    isPrimary: Boolean(value.isPrimary),
    enabled: value.enabled !== false,
    skillId: typeof value.skillId === "string" ? value.skillId : null,
    toolIds: Array.isArray(value.toolIds)
      ? uniqueStrings(
          value.toolIds
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.trim())
            .filter((entry) => Boolean(entry) && entry !== "fs.workspaceOnly")
        )
      : [],
    modelId: typeof value.modelId === "string" ? value.modelId : null,
    emoji: typeof value.emoji === "string" ? value.emoji : null,
    theme: typeof value.theme === "string" ? value.theme : null,
    policy: parseAgentPolicy(value.policy),
    channelIds: Array.isArray(value.channelIds)
      ? value.channelIds.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
      : []
  };
}

function parseWorkspaceProjectManifestChannel(value: unknown): WorkspaceChannelSummary | null {
  return parseWorkspaceChannelSummary(value);
}

function parseWorkspaceChannelSummary(value: unknown): WorkspaceChannelSummary | null {
  if (!isObjectRecord(value) || typeof value.id !== "string") {
    return null;
  }

  return {
    id: value.id,
    type: isPlannerChannelTypeValue(value.type) ? value.type : "internal",
    name: typeof value.name === "string" ? value.name : value.id,
    primaryAgentId: typeof value.primaryAgentId === "string" ? value.primaryAgentId : null,
    workspaces: Array.isArray(value.workspaces)
      ? value.workspaces
          .map((entry) => parseWorkspaceChannelWorkspaceBinding(entry))
          .filter((entry): entry is WorkspaceChannelWorkspaceBinding => Boolean(entry))
      : []
  };
}

function isPlannerChannelTypeValue(value: unknown): value is PlannerChannelType {
  return value === "internal" || value === "slack" || value === "telegram" || value === "discord" || value === "googlechat";
}

function parseWorkspaceChannelWorkspaceBinding(value: unknown): WorkspaceChannelWorkspaceBinding | null {
  if (!isObjectRecord(value) || typeof value.workspaceId !== "string" || typeof value.workspacePath !== "string") {
    return null;
  }

  return {
    workspaceId: value.workspaceId,
    workspacePath: value.workspacePath,
    agentIds: Array.isArray(value.agentIds)
      ? value.agentIds.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
      : [],
    groupAssignments: Array.isArray(value.groupAssignments)
      ? value.groupAssignments
          .map((entry) => parseWorkspaceChannelGroupAssignment(entry))
          .filter((entry): entry is WorkspaceChannelGroupAssignment => Boolean(entry))
      : []
  };
}

function parseWorkspaceChannelGroupAssignment(value: unknown): WorkspaceChannelGroupAssignment | null {
  if (!isObjectRecord(value) || typeof value.chatId !== "string") {
    return null;
  }

  return {
    chatId: value.chatId,
    agentId: typeof value.agentId === "string" ? value.agentId : null,
    title: typeof value.title === "string" ? value.title : null,
    enabled: value.enabled !== false
  };
}

function normalizeChannelRegistry(registry: ChannelRegistry): ChannelRegistry {
  const channels = registry.channels
    .map((channel) => ({
      id: channel.id.trim(),
      type: isPlannerChannelTypeValue(channel.type) ? channel.type : "internal",
      name: channel.name.trim() || channel.id.trim(),
      primaryAgentId: normalizeOptionalValue(channel.primaryAgentId) ?? null,
      workspaces: channel.workspaces
        .map((workspace) => ({
          workspaceId: workspace.workspaceId.trim(),
          workspacePath: workspace.workspacePath.trim(),
          agentIds: uniqueStrings(workspace.agentIds.map((agentId) => agentId.trim()).filter(Boolean)),
          groupAssignments: workspace.groupAssignments
            .map((assignment) => ({
              chatId: assignment.chatId.trim(),
              agentId: normalizeOptionalValue(assignment.agentId) ?? null,
              title: normalizeOptionalValue(assignment.title) ?? null,
              enabled: assignment.enabled !== false
            }))
            .filter((assignment) => Boolean(assignment.chatId))
        }))
        .filter((workspace) => Boolean(workspace.workspaceId) && Boolean(workspace.workspacePath))
    }))
    .filter((channel) => Boolean(channel.id));

  const deduped = new Map<string, WorkspaceChannelSummary>();

  for (const channel of channels) {
    const existing = deduped.get(channel.id);

    if (!existing) {
      deduped.set(channel.id, {
        ...channel,
        workspaces: channel.workspaces
      });
      continue;
    }

    const workspaceMap = new Map<string, WorkspaceChannelWorkspaceBinding>();
    for (const workspace of existing.workspaces) {
      workspaceMap.set(workspace.workspaceId, workspace);
    }

    for (const workspace of channel.workspaces) {
      const current = workspaceMap.get(workspace.workspaceId);

      if (!current) {
        workspaceMap.set(workspace.workspaceId, workspace);
        continue;
      }

      workspaceMap.set(workspace.workspaceId, {
        ...current,
        agentIds: uniqueStrings([...current.agentIds, ...workspace.agentIds]),
        groupAssignments: uniqueByChatId([...current.groupAssignments, ...workspace.groupAssignments])
      });
    }

    deduped.set(channel.id, {
      ...existing,
      name: existing.name || channel.name,
      primaryAgentId: existing.primaryAgentId || channel.primaryAgentId,
      workspaces: Array.from(workspaceMap.values())
    });
  }

  return {
    version: 1,
    channels: Array.from(deduped.values())
  };
}

function uniqueByChatId(assignments: WorkspaceChannelGroupAssignment[]) {
  const seen = new Map<string, WorkspaceChannelGroupAssignment>();

  for (const assignment of assignments) {
    if (!assignment.chatId) {
      continue;
    }

    seen.set(assignment.chatId, assignment);
  }

  return Array.from(seen.values());
}

function applyChannelAccountDisplayNames(accounts: ChannelAccountRecord[], registry: ChannelRegistry) {
  const labels = new Map(
    registry.channels
      .filter((channel) => Boolean(channel.id))
      .map((channel) => [channel.id, channel.name.trim() || channel.id] as const)
  );

  return accounts.map((account) => ({
    ...account,
    name: labels.get(account.id) ?? account.name
  }));
}

function cloneChannelRegistry(registry: ChannelRegistry): ChannelRegistry {
  return normalizeChannelRegistry({
    version: 1,
    channels: registry.channels.map((channel) => ({
      ...channel,
      workspaces: channel.workspaces.map((workspace) => ({
        ...workspace,
        agentIds: [...workspace.agentIds],
        groupAssignments: workspace.groupAssignments.map((assignment) => ({ ...assignment }))
      }))
    }))
  });
}

async function saveChannelRegistry(registry: ChannelRegistry) {
  await writeChannelRegistry(normalizeChannelRegistry(registry));
}

type ManagedTelegramRoutingCleanup = {
  removedAccountIds?: string[];
  removedGroupIds?: string[];
};

type DiscoveredTelegramGroup = {
  chatId: string;
  title: string | null;
  lastSeen: string | null;
};

type OpenClawChannelLogsPayload = {
  lines?: Array<{
    time?: string;
    message?: string;
    raw?: string;
  }>;
};

type TelegramAllowlistConfig = Record<
  string,
  {
    requireMention?: boolean;
  }
>;

export async function discoverTelegramGroups() {
  const payload = await runOpenClawJson<OpenClawChannelLogsPayload>([
    "channels",
    "logs",
    "--channel",
    "telegram",
    "--json",
    "--lines",
    "200"
  ]).catch(() => null);

  if (!payload?.lines?.length) {
    return await readTelegramAllowlistGroups();
  }

  const discovered = new Map<string, DiscoveredTelegramGroup>();

  const rememberGroup = (group: DiscoveredTelegramGroup) => {
    const existing = discovered.get(group.chatId);
    if (!existing) {
      discovered.set(group.chatId, group);
      return;
    }

    discovered.set(group.chatId, {
      chatId: group.chatId,
      title: group.title ?? existing.title,
      lastSeen: selectLatestIsoTimestamp(existing.lastSeen, group.lastSeen)
    });
  };

  for (const line of payload.lines) {
    const lineTime = typeof line?.time === "string" ? line.time : null;

    for (const group of extractTelegramGroupsFromUnknown(line, lineTime)) {
      rememberGroup(group);
    }

    if (typeof line?.raw === "string") {
      try {
        const parsed = JSON.parse(line.raw);
        for (const group of extractTelegramGroupsFromUnknown(parsed, lineTime)) {
          rememberGroup(group);
        }
      } catch {
        for (const group of extractTelegramGroupsFromText(line.raw, lineTime)) {
          rememberGroup(group);
        }
      }
    }

    if (typeof line?.message === "string") {
      for (const group of extractTelegramGroupsFromText(line.message, lineTime)) {
        rememberGroup(group);
      }
    }
  }

  for (const group of await readTelegramAllowlistGroups()) {
    if (!discovered.has(group.chatId)) {
      discovered.set(group.chatId, group);
    }
  }

  return Array.from(discovered.values()).sort((left, right) => {
    const leftLabel = left.title ?? left.chatId;
    const rightLabel = right.title ?? right.chatId;
    return leftLabel.localeCompare(rightLabel);
  });
}

async function readTelegramAllowlistGroups() {
  try {
    const groups = await runOpenClawJson<TelegramAllowlistConfig>([
      "config",
      "get",
      "channels.telegram.groups",
      "--json"
    ]);

    return Object.keys(groups ?? {})
      .map((chatId) => ({
        chatId,
        title: null,
        lastSeen: null
      }))
      .sort((left, right) => left.chatId.localeCompare(right.chatId));
  } catch {
    return [] as DiscoveredTelegramGroup[];
  }
}

async function updateManagedTelegramRouting(
  registry: ChannelRegistry,
  cleanup: ManagedTelegramRoutingCleanup = {}
) {
  const currentBindings = await runOpenClawJson<unknown[]>(["config", "get", "bindings", "--json"]).catch(
    () => []
  );

  const managedChannels = registry.channels.filter((channel) => channel.type === "telegram");
  const managedAccountIds = new Set(managedChannels.map((channel) => channel.id));
  const removedAccountIds = new Set(cleanup.removedAccountIds ?? []);
  const managedGroupIds = new Set(
    managedChannels.flatMap((channel) =>
      channel.workspaces.flatMap((workspace) =>
        workspace.groupAssignments
          .filter((assignment) => assignment.enabled !== false)
          .map((assignment) => assignment.chatId)
      )
    )
  );
  const removedGroupIds = new Set(cleanup.removedGroupIds ?? []);
  const nextBindings = [
    ...currentBindings.filter((entry) => {
      if (!isObjectRecord(entry)) {
        return true;
      }

      const match = isObjectRecord(entry.match) ? entry.match : null;
      if (!match || match.channel !== "telegram") {
        return true;
      }

      if (
        typeof match.accountId === "string" &&
        (managedAccountIds.has(match.accountId) || removedAccountIds.has(match.accountId))
      ) {
        return false;
      }

      if (
        isObjectRecord(match.peer) &&
        typeof match.peer.id === "string" &&
        (managedGroupIds.has(match.peer.id) || removedGroupIds.has(match.peer.id))
      ) {
        return false;
      }

      return true;
    }),
    ...managedChannels
      .filter((channel) => Boolean(channel.primaryAgentId))
      .map((channel) => ({
        agentId: channel.primaryAgentId as string,
        match: {
          channel: "telegram",
          accountId: channel.id
        }
      })),
    ...managedChannels.flatMap((channel) =>
      channel.workspaces.flatMap((workspace) =>
        workspace.groupAssignments
          .filter((assignment) => assignment.enabled !== false && assignment.agentId)
          .map((assignment) => ({
            agentId: assignment.agentId as string,
            match: {
              channel: "telegram",
              accountId: channel.id,
              peer: {
                kind: "group",
                id: assignment.chatId
              }
            }
          }))
      )
    )
  ];
  await runOpenClaw([
    "config",
    "set",
    "channels.telegram.enabled",
    managedChannels.length > 0 ? "true" : "false",
    "--strict-json"
  ]);

  const defaultAccountId =
    managedChannels.find((channel) => Boolean(channel.primaryAgentId))?.id ??
    managedChannels[0]?.id ??
    null;

  if (defaultAccountId) {
    await runOpenClaw([
      "config",
      "set",
      "channels.telegram.defaultAccount",
      JSON.stringify(defaultAccountId),
      "--strict-json"
    ]);
  } else {
    await runOpenClaw(["config", "unset", "channels.telegram.defaultAccount"]).catch(() => {});
  }

  const nextGroupsConfig = Object.fromEntries(
    Array.from(managedGroupIds).map((chatId) => [chatId, { requireMention: true }])
  );

  await runOpenClaw([
    "config",
    "set",
    "channels.telegram.groups",
    JSON.stringify(nextGroupsConfig),
    "--strict-json"
  ]);

  await runOpenClaw(["config", "set", "bindings", JSON.stringify(nextBindings), "--strict-json"]);
}

function collectTelegramRelatedAgentIds(registry: ChannelRegistry) {
  return uniqueStrings(
    registry.channels
      .filter((channel) => channel.type === "telegram")
      .flatMap((channel) => [
        channel.primaryAgentId ?? "",
        ...channel.workspaces.flatMap((workspace) => workspace.agentIds),
        ...channel.workspaces.flatMap((workspace) =>
          workspace.groupAssignments
            .filter((assignment) => assignment.enabled !== false && assignment.agentId)
            .map((assignment) => assignment.agentId as string)
        )
      ])
  );
}

async function syncAgentPolicySkills(
  agentIds: string[],
  options: {
    snapshot?: MissionControlSnapshot;
    channelRegistry?: ChannelRegistry;
  } = {}
) {
  const relevantAgentIds = uniqueStrings(agentIds);

  if (relevantAgentIds.length === 0) {
    return;
  }

  const snapshot = options.snapshot ?? (await getMissionControlSnapshot({ force: true, includeHidden: true }));
  const nextSnapshot = options.channelRegistry
    ? {
        ...snapshot,
        channelRegistry: options.channelRegistry
      }
    : snapshot;

  for (const agentId of relevantAgentIds) {
    const agent = nextSnapshot.agents.find((entry) => entry.id === agentId);

    if (!agent) {
      continue;
    }

    const setupAgentId =
      nextSnapshot.agents.find(
        (entry) => entry.workspaceId === agent.workspaceId && entry.policy.preset === "setup" && entry.id !== agent.id
      )?.id ?? null;

    const policySkillId = await ensureAgentPolicySkill({
      workspacePath: agent.workspacePath,
      agentId: agent.id,
      agentName: agent.name,
      policy: agent.policy,
      setupAgentId,
      snapshot: nextSnapshot,
      channelRegistry: options.channelRegistry
    });

    await upsertAgentConfigEntry(
      agent.id,
      agent.workspacePath,
      {
        name: agent.name,
        model: normalizeOptionalValue(agent.modelId),
        heartbeat: agent.heartbeat.enabled && agent.heartbeat.every ? { every: agent.heartbeat.every } : null,
        skills: [...filterAgentPolicySkills(agent.skills), policySkillId],
        tools: agent.tools.includes("fs.workspaceOnly")
          ? {
              fs: {
                workspaceOnly: true
              }
            }
          : null
      },
      nextSnapshot
    );
  }
}

async function syncWorkspaceAgentPolicySkills(
  workspacePath: string,
  options: {
    snapshot?: MissionControlSnapshot;
    channelRegistry?: ChannelRegistry;
  } = {}
) {
  const snapshot = options.snapshot ?? (await getMissionControlSnapshot({ force: true, includeHidden: true }));
  const agentIds = snapshot.agents
    .filter((entry) => entry.workspacePath === workspacePath)
    .map((entry) => entry.id);

  await syncAgentPolicySkills(agentIds, {
    snapshot,
    channelRegistry: options.channelRegistry
  });
}

async function syncTelegramCoordinationSkills(previousRegistry: ChannelRegistry, nextRegistry: ChannelRegistry) {
  const relevantAgentIds = uniqueStrings([
    ...collectTelegramRelatedAgentIds(previousRegistry),
    ...collectTelegramRelatedAgentIds(nextRegistry)
  ]);

  if (relevantAgentIds.length === 0) {
    return;
  }

  const snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
  await syncAgentPolicySkills(relevantAgentIds, {
    snapshot,
    channelRegistry: nextRegistry
  });
}

function extractTelegramGroupsFromUnknown(value: unknown, lineTime: string | null): DiscoveredTelegramGroup[] {
  const discovered = new Map<string, DiscoveredTelegramGroup>();
  const queue: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth > 6) {
      continue;
    }

    const candidate = current.value;
    if (candidate === null || candidate === undefined) {
      continue;
    }

    if (typeof candidate !== "object") {
      continue;
    }

    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);

    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        queue.push({ value: item, depth: current.depth + 1 });
      }
      continue;
    }

    if (!isObjectRecord(candidate)) {
      continue;
    }

    const chatId = normalizeTelegramGroupChatId(candidate.chatId);
    if (chatId) {
      const title =
        normalizeOptionalValue(candidate.title as string | null | undefined) ??
        normalizeOptionalValue(candidate.chatTitle as string | null | undefined) ??
        null;
      discovered.set(chatId, {
        chatId,
        title,
        lastSeen: lineTime
      });
    }

    for (const nested of Object.values(candidate)) {
      queue.push({ value: nested, depth: current.depth + 1 });
    }
  }

  return Array.from(discovered.values());
}

function extractTelegramGroupsFromText(text: string, lineTime: string | null): DiscoveredTelegramGroup[] {
  const discovered = new Map<string, DiscoveredTelegramGroup>();
  const objectPattern = /\{[^{}]*"chatId"\s*:\s*-?\d+[^{}]*\}/g;

  for (const match of text.matchAll(objectPattern)) {
    const fragment = match[0];
    try {
      const parsed = JSON.parse(fragment);
      for (const group of extractTelegramGroupsFromUnknown(parsed, lineTime)) {
        discovered.set(group.chatId, group);
      }
      continue;
    } catch {
      // Fall through to regex extraction below.
    }

    const chatIdMatch = fragment.match(/"chatId"\s*:\s*(-?\d+)/);
    const chatId = normalizeTelegramGroupChatId(chatIdMatch?.[1] ?? null);
    if (!chatId) {
      continue;
    }

    const titleMatch = fragment.match(/"title"\s*:\s*"([^"]+)"/);
    discovered.set(chatId, {
      chatId,
      title: titleMatch?.[1] ?? null,
      lastSeen: lineTime
    });
  }

  return Array.from(discovered.values());
}

function normalizeTelegramGroupChatId(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value < 0) {
    return String(value);
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return /^-\d+$/.test(trimmed) ? trimmed : null;
}

function selectLatestIsoTimestamp(current: string | null, candidate: string | null) {
  if (!candidate) {
    return current;
  }

  if (!current) {
    return candidate;
  }

  const currentValue = Date.parse(current);
  const candidateValue = Date.parse(candidate);
  if (Number.isNaN(candidateValue)) {
    return current;
  }

  if (Number.isNaN(currentValue) || candidateValue > currentValue) {
    return candidate;
  }

  return current;
}

async function mutateChannelRegistry(
  mutate: (registry: ChannelRegistry) => void | Promise<void>,
  cleanup: ManagedTelegramRoutingCleanup = {}
) {
  const registry = cloneChannelRegistry(await readChannelRegistry());
  const previousRegistry = cloneChannelRegistry(registry);
  await mutate(registry);
  await saveChannelRegistry(registry);
  await updateManagedTelegramRouting(registry, cleanup);
  await syncTelegramCoordinationSkills(previousRegistry, registry);
  snapshotCache = null;
}

function findMatchingWorkspaceAgent(
  agents: OpenClawAgent[],
  workspaceSlug: string,
  agentKey: string
) {
  const normalizedKey = slugify(agentKey);
  const workspacePrefix = `${workspaceSlug}-`;

  return (
    agents.find((agent) => agent.id === createWorkspaceAgentId(workspaceSlug, agentKey)) ??
    agents.find((agent) => agent.id === `${workspacePrefix}${normalizedKey}`) ??
    agents.find((agent) => normalizedKey.length > 0 && agent.id.endsWith(`-${normalizedKey}`)) ??
    agents.find((agent) => agent.id === normalizedKey) ??
    null
  );
}

function parseWorkspaceCreateRules(value: unknown): WorkspaceCreateRules | null {
  if (!isObjectRecord(value)) {
    return null;
  }

  const workspaceOnly = typeof value.workspaceOnly === "boolean" ? value.workspaceOnly : null;
  const generateStarterDocs =
    typeof value.generateStarterDocs === "boolean" ? value.generateStarterDocs : null;
  const generateMemory = typeof value.generateMemory === "boolean" ? value.generateMemory : null;
  const kickoffMission = typeof value.kickoffMission === "boolean" ? value.kickoffMission : null;

  if (
    workspaceOnly === null &&
    generateStarterDocs === null &&
    generateMemory === null &&
    kickoffMission === null
  ) {
    return null;
  }

  return {
    workspaceOnly: workspaceOnly ?? true,
    generateStarterDocs: generateStarterDocs ?? DEFAULT_WORKSPACE_RULES.generateStarterDocs,
    generateMemory: generateMemory ?? DEFAULT_WORKSPACE_RULES.generateMemory,
    kickoffMission: kickoffMission ?? DEFAULT_WORKSPACE_RULES.kickoffMission
  };
}

function isWorkspaceTeamPreset(value: unknown): value is WorkspaceTeamPreset {
  return value === "solo" || value === "core" || value === "custom";
}

function isWorkspaceModelProfile(value: unknown): value is WorkspaceModelProfile {
  return value === "balanced" || value === "fast" || value === "quality";
}

function parseAgentPolicy(value: unknown): AgentPolicy | null {
  if (!isObjectRecord(value)) {
    return null;
  }

  if (
    !isAgentPreset(value.preset) ||
    !isAgentMissingToolBehavior(value.missingToolBehavior) ||
    !isAgentInstallScope(value.installScope) ||
    !isAgentFileAccess(value.fileAccess) ||
    !isAgentNetworkAccess(value.networkAccess)
  ) {
    return null;
  }

  return {
    preset: value.preset,
    missingToolBehavior: value.missingToolBehavior,
    installScope: value.installScope,
    fileAccess: value.fileAccess,
    networkAccess: value.networkAccess
  };
}

function collectBulletSections(
  sections: Map<string, string[]>,
  entries: Array<{ file: string; heading: string }>
) {
  return uniqueStrings(entries.flatMap((entry) => extractBulletSection(sections.get(entry.file), entry.heading)));
}

function extractPurpose(sections: Map<string, string[]>) {
  const workspaceObjective =
    extractSectionParagraph(sections.get("docs/brief.md"), "Objective") ??
    extractSectionParagraph(sections.get("memory/blueprint.md"), "Outcome") ??
    extractSectionParagraph(sections.get("MEMORY.md"), "Current brief") ??
    extractSectionParagraph(sections.get("SOUL.md"), "My Purpose") ??
    extractSectionParagraph(sections.get("IDENTITY.md"), "Role") ??
    extractSectionParagraph(sections.get("AGENTS.md"), "Customize");

  if (workspaceObjective) {
    return workspaceObjective;
  }

  return null;
}

function extractOutputPreference(lines?: string[]) {
  if (!lines) {
    return null;
  }

  const match = lines.find((line) =>
    /be concise in chat|write longer output to files|output/i.test(line)
  );

  return match ? cleanMarkdown(match) : null;
}

function inferPurposeFromConfig({
  agentId,
  agentName,
  skills
}: {
  agentId: string;
  agentName: string;
  skills: string[];
}) {
  if (skills.length > 0) {
    return `${agentName} specializes in ${skills.join(", ")} workflows inside the attached workspace.`;
  }

  if (/dev|build|coder|engineer/i.test(agentId)) {
    return `${agentName} is configured as a development-focused OpenClaw operator for this workspace.`;
  }

  if (/review/i.test(agentId)) {
    return `${agentName} is configured to review work and surface quality risks for this workspace.`;
  }

  if (/test/i.test(agentId)) {
    return `${agentName} is configured to validate behavior, testing, and runtime quality for this workspace.`;
  }

  return `${agentName} is a general-purpose OpenClaw operator attached to this workspace.`;
}

function inferOperatingInstructions(configuredTools: string[]) {
  if (configuredTools.includes("fs.workspaceOnly")) {
    return ["Operate within the attached workspace and avoid spilling changes outside it."];
  }

  return ["No explicit operating instructions were found in workspace bootstrap files."];
}

function inferOutputPreference(configuredTools: string[]) {
  if (configuredTools.includes("fs.workspaceOnly")) {
    return "Prefer workspace-grounded output tied to real project files and artifacts.";
  }

  return null;
}

function extractSectionParagraph(lines: string[] | undefined, heading: string) {
  if (!lines) {
    return null;
  }

  const start = lines.findIndex((line) => normalizeHeading(line) === normalizeHeading(heading));
  if (start === -1) {
    return null;
  }

  const collected: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();

    if (!line) {
      if (collected.length > 0) {
        break;
      }
      continue;
    }

    if (/^#+\s+/.test(line)) {
      break;
    }

    if (/^[-*]\s+/.test(line)) {
      break;
    }

    collected.push(cleanMarkdown(line));
    if (collected.length >= 2) {
      break;
    }
  }

  return collected.length > 0 ? collected.join(" ") : null;
}

function extractBulletSection(lines: string[] | undefined, heading: string) {
  if (!lines) {
    return [];
  }

  const start = lines.findIndex((line) => normalizeHeading(line) === normalizeHeading(heading));
  if (start === -1) {
    return [];
  }

  const bullets: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();

    if (!line && bullets.length > 0) {
      break;
    }

    if (/^#+\s+/.test(line)) {
      break;
    }

    if (/^[-*]\s+/.test(line)) {
      bullets.push(cleanMarkdown(line.replace(/^[-*]\s+/, "")));
      continue;
    }

    if (bullets.length > 0) {
      break;
    }
  }

  return bullets;
}

function extractInlineList(lines: string[] | undefined, label: string) {
  if (!lines) {
    return [];
  }

  const entry = lines.find((line) => line.toLowerCase().includes(`**${label.toLowerCase()}:**`));
  if (!entry) {
    return [];
  }

  const [, rawValue = ""] = entry.split(":");
  return rawValue
    .split(",")
    .map((item) => cleanMarkdown(item))
    .filter(Boolean);
}

function normalizeHeading(line: string) {
  return line.replace(/^#+\s+/, "").trim().toLowerCase();
}

function cleanMarkdown(value: string) {
  return value
    .replace(/[`*_>#-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function ensureWorkspace(store: Map<string, WorkspaceProject>, workspacePath: string) {
  const workspaceId = workspaceIdFromPath(workspacePath);
  const existing = store.get(workspaceId);

  if (existing) {
    return existing;
  }

  const workspace: WorkspaceProject = {
    id: workspaceId,
    name: prettifyWorkspaceName(workspacePath),
    slug: slugify(path.basename(workspacePath)),
    path: workspacePath,
    kind: "workspace",
    agentIds: [],
    modelIds: [],
    activeRuntimeIds: [],
    totalSessions: 0,
    health: "standby",
    bootstrap: {
      template: null,
      sourceMode: null,
      agentTemplate: null,
      coreFiles: [],
      optionalFiles: [],
      folders: [],
      projectShell: [],
      localSkillIds: []
    },
    capabilities: {
      skills: [],
      tools: [],
      workspaceOnlyAgentCount: 0
    },
    channels: []
  };

  store.set(workspaceId, workspace);
  return workspace;
}

function mapRuntime(
  session: SessionsPayload["sessions"][number],
  agentConfig: AgentConfigPayload,
  agentsList: AgentPayload
): RuntimeRecord {
  const agent = agentsList.find((entry) => entry.id === session.agentId);
  const config = agentConfig.find((entry) => entry.id === session.agentId);
  const workspacePath = agent?.workspace || config?.workspace;
  const workspaceId = workspacePath ? workspaceIdFromPath(workspacePath) : undefined;
  const taskId = extractToken(session.key, "task");
  const stage = extractToken(session.key, "stage");
  const modelId =
    session.model && session.model.includes("/")
      ? session.model
      : config?.model || agent?.model || "unassigned";
  const status = resolveRuntimeStatus(stage, session.key, session.ageMs);
  const runtimeId = createRuntimeId(session);
  const taskLabel = taskId ? taskId.slice(0, 8) : null;

  return {
    id: runtimeId,
    source: "session",
    key: session.key || "unknown-session",
    title: taskLabel
      ? `${prettifyAgentName(session.agentId)} · ${taskLabel}`
      : `${prettifyAgentName(session.agentId)} session`,
    subtitle: taskLabel ? `task ${taskLabel} · ${stage || "running"}` : "main session",
    status,
    updatedAt: session.updatedAt ?? null,
    ageMs: session.ageMs ?? null,
    agentId: session.agentId,
    workspaceId,
    modelId,
    sessionId: session.sessionId,
    taskId,
    tokenUsage:
      typeof session.totalTokens === "number" || typeof session.inputTokens === "number"
        ? {
            input: session.inputTokens ?? 0,
            output: session.outputTokens ?? 0,
            total: session.totalTokens ?? (session.inputTokens ?? 0) + (session.outputTokens ?? 0),
            cacheRead: session.cacheRead ?? 0
          }
        : undefined,
    metadata: {
      kind: session.kind ?? "direct",
      chatType: session.kind ?? "direct",
      stage: stage ?? null,
      historical: false
    }
  };
}

function mergeRuntimeHistory(currentRuntimes: RuntimeRecord[]) {
  const nextHistory = new Map<string, RuntimeRecord>();
  const currentIds = new Set(currentRuntimes.map((runtime) => runtime.id));

  for (const runtime of currentRuntimes) {
    nextHistory.set(runtime.id, runtime);
  }

  for (const [runtimeId, runtime] of runtimeHistoryCache.entries()) {
    if (currentIds.has(runtimeId)) {
      continue;
    }

    const historicalRuntime = {
      ...runtime,
      status:
        runtime.status === "stalled"
          ? "stalled"
          : runtime.status === "cancelled"
            ? "cancelled"
            : "completed",
      metadata: {
        ...runtime.metadata,
        historical: true
      }
    } satisfies RuntimeRecord;

    nextHistory.set(runtimeId, historicalRuntime);
  }

  const prunedHistory = pruneRuntimeHistory(Array.from(nextHistory.values()));
  runtimeHistoryCache = new Map(
    prunedHistory
      .filter((runtime) => !isSyntheticDispatchRuntime(runtime))
      .map((runtime) => [runtime.id, runtime])
  );

  return prunedHistory.sort(sortRuntimesByUpdatedAtDesc);
}

function pruneRuntimeHistory(runtimes: RuntimeRecord[]) {
  const grouped = new Map<string, RuntimeRecord[]>();

  for (const runtime of runtimes) {
    const groupKey = runtime.agentId || runtime.workspaceId || "global";
    const list = grouped.get(groupKey) ?? [];
    list.push(runtime);
    grouped.set(groupKey, list);
  }

  return Array.from(grouped.values()).flatMap((entries) =>
    entries
      .sort(sortRuntimesByUpdatedAtDesc)
      .slice(0, 8)
  );
}

function sortRuntimesByUpdatedAtDesc(left: RuntimeRecord, right: RuntimeRecord) {
  return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
}

function createRuntimeId(session: SessionsPayload["sessions"][number]) {
  const taskId = extractToken(session.key, "task");
  const runtimeKey = taskId || session.key || session.sessionId || String(Math.random());
  const sessionToken = session.sessionId || hashValue(session.agentId || "sessionless");
  return `runtime:${sessionToken}:${hashValue(runtimeKey)}`;
}

function resolveRuntimeStatus(
  stage: string | undefined,
  key: string | undefined,
  ageMs: number | undefined
): RuntimeRecord["status"] {
  if (stage === "in_progress") {
    return "running";
  }

  if (key?.endsWith(":main") && typeof ageMs === "number" && ageMs < 60 * 60 * 1000) {
    return "running";
  }

  if (stage === "completed" || stage === "done") {
    return "completed";
  }

  if (stage === "failed" || stage === "error") {
    return "stalled";
  }

  return "idle";
}

function resolveAgentStatus(params: {
  rpcOk: boolean;
  activeRuntime: RuntimeRecord | undefined;
  heartbeatEnabled: boolean;
  lastActiveAt: number | null;
}): AgentStatus {
  if (!params.rpcOk) {
    return "offline";
  }

  if (params.activeRuntime?.status === "running" || params.activeRuntime?.status === "queued") {
    return "engaged";
  }

  if (params.heartbeatEnabled) {
    return "monitoring";
  }

  if (params.lastActiveAt) {
    return "ready";
  }

  return "standby";
}

function resolveAgentAction(params: {
  runtime: RuntimeRecord | undefined;
  heartbeatEvery: string | null;
  status: AgentStatus;
}) {
  if (params.runtime) {
    if (params.runtime.taskId) {
      if (params.runtime.status === "running" || params.runtime.status === "queued") {
        return `Tracking task ${params.runtime.taskId.slice(0, 8)}`;
      }

      if (params.runtime.status === "completed") {
        return `Recent task ${params.runtime.taskId.slice(0, 8)} completed`;
      }

      if (params.runtime.status === "cancelled") {
        return `Recent task ${params.runtime.taskId.slice(0, 8)} cancelled`;
      }

      if (params.runtime.status === "stalled") {
        return `Recent task ${params.runtime.taskId.slice(0, 8)} stalled`;
      }

      return `Recent task ${params.runtime.taskId.slice(0, 8)}`;
    }

    return params.runtime.status === "running" || params.runtime.status === "queued"
      ? "Maintaining main session context"
      : "Main session recently updated";
  }

  if (params.heartbeatEvery) {
    return `Heartbeat on ${params.heartbeatEvery}`;
  }

  if (params.status === "standby") {
    return "Waiting for assignment";
  }

  return "Ready for next turn";
}

function resolveWorkspaceHealth(agentIds: string[], agents: OpenClawAgent[]): AgentStatus {
  const workspaceAgents = agents.filter((agent) => agentIds.includes(agent.id));
  if (workspaceAgents.some((agent) => agent.status === "engaged")) {
    return "engaged";
  }
  if (workspaceAgents.some((agent) => agent.status === "monitoring")) {
    return "monitoring";
  }
  if (workspaceAgents.some((agent) => agent.status === "ready")) {
    return "ready";
  }
  if (workspaceAgents.some((agent) => agent.status === "offline")) {
    return "offline";
  }
  return "standby";
}

function resolveModelReadiness(
  models: ModelsPayload["models"],
  modelStatus?: ModelsStatusPayload
): ModelReadiness {
  const readyModels = models.filter((model) => isReadyModelRecord(model));
  const providerIds = unique(
    [
      ...models.map((model) => model.key.split("/")[0] || "unknown"),
      ...((modelStatus?.auth?.providers ?? []).map((entry) => entry.provider).filter(isNonEmptyString)),
      ...((modelStatus?.auth?.oauth?.providers ?? []).map((entry) => entry.provider).filter(isNonEmptyString))
    ].filter(isNonEmptyString)
  );
  const authProviderMap = new Map(
    (modelStatus?.auth?.providers ?? [])
      .filter((entry): entry is NonNullable<typeof entry> & { provider: string } => isNonEmptyString(entry.provider))
      .map((entry) => [entry.provider, entry])
  );
  const oauthProviderMap = new Map(
    (modelStatus?.auth?.oauth?.providers ?? [])
      .filter((entry): entry is NonNullable<typeof entry> & { provider: string } => isNonEmptyString(entry.provider))
      .map((entry) => [entry.provider, entry])
  );
  const resolvedDefaultModel = normalizeOptionalValue(modelStatus?.resolvedDefault ?? undefined);
  const defaultModel = normalizeOptionalValue(modelStatus?.defaultModel ?? undefined);
  const defaultModelId = resolvedDefaultModel ?? defaultModel;
  const defaultProvider = defaultModelId ? resolveModelProviderId(defaultModelId) : null;
  const defaultModelReady = Boolean(defaultModelId && readyModels.some((model) => model.key === defaultModelId));
  const recommendedModelId = defaultModelReady ? defaultModelId : readyModels[0]?.key ?? null;
  const authProviders = providerIds.map((provider) => {
    const providerModels = models.filter((model) => (model.key.split("/")[0] || "unknown") === provider);
    const hasRemoteRoute = providerModels.some((model) => model.local !== true);
    const providerAuth = authProviderMap.get(provider);
    const oauthStatus = oauthProviderMap.get(provider);
    const connected =
      providerModels.some((model) => isReadyModelRecord(model)) ||
      (providerAuth?.profiles?.count ?? 0) > 0 ||
      oauthStatus?.status === "ok";
    let detail: string | null = null;

    if (oauthStatus?.status === "ok") {
      detail = "OAuth connected";
    } else if ((providerAuth?.profiles?.count ?? 0) > 0) {
      detail = `${providerAuth?.profiles?.count} auth profile${providerAuth?.profiles?.count === 1 ? "" : "s"}`;
    } else if (providerModels.some((model) => model.local)) {
      detail = "Install or pull a local model to unlock this route.";
    } else if (hasRemoteRoute) {
      detail = resolveProviderSetupDetail(provider);
    }

    return {
      provider,
      connected,
      canLogin: hasRemoteRoute,
      detail
    };
  });
  const missingProvidersInUse = (modelStatus?.auth?.missingProvidersInUse ?? []).filter(isNonEmptyString);
  const missingProviderSet = new Set(missingProvidersInUse);
  const unusableProfileCount = modelStatus?.auth?.unusableProfiles?.length ?? 0;
  const issues: string[] = [];

  if (readyModels.length === 0) {
    issues.push("No available models were detected yet.");
  }

  if (readyModels.length > 0 && !defaultModelId) {
    issues.push("Choose a default model to finish setup.");
  }

  if (defaultModelId && !defaultModelReady) {
    if (defaultProvider && missingProviderSet.has(defaultProvider)) {
      issues.push(`Default model is set, but ${formatProviderLabel(defaultProvider)} auth is still missing.`);
    } else if (missingProvidersInUse.length > 0) {
      issues.push(`Default model is set, but auth is still missing for: ${missingProvidersInUse.join(", ")}.`);
    } else {
      issues.push("The selected default model is not ready yet.");
    }
  }

  if (missingProvidersInUse.length > 0 && !defaultModelId) {
    issues.push(`Auth is still missing for: ${missingProvidersInUse.join(", ")}.`);
  }

  if (unusableProfileCount > 0) {
    issues.push("Some stored model auth profiles are not usable.");
  }

  return {
    ready: readyModels.length > 0 && defaultModelReady,
    defaultModel: defaultModel ?? null,
    resolvedDefaultModel: resolvedDefaultModel ?? null,
    defaultModelReady,
    recommendedModelId: recommendedModelId ?? null,
    preferredLoginProvider:
      authProviders.find(
        (provider) =>
          provider.provider === defaultProvider && !provider.connected && provider.canLogin
      )?.provider ??
      missingProvidersInUse.find((provider) =>
        authProviders.some((entry) => entry.provider === provider && !entry.connected && entry.canLogin)
      ) ??
      authProviders.find((provider) => !provider.connected && provider.canLogin)?.provider ??
      (providerIds.includes("openai-codex") || readyModels.length === 0 ? "openai-codex" : null),
    totalModelCount: models.length,
    availableModelCount: readyModels.length,
    localModelCount: readyModels.filter((model) => model.local).length,
    remoteModelCount: readyModels.filter((model) => model.local !== true).length,
    missingModelCount: models.filter((model) => model.missing || model.available === false).length,
    authProviders,
    issues: unique(issues)
  };
}

function isReadyModelRecord(model: ModelsPayload["models"][number]) {
  return model.available !== false && !model.missing;
}

function resolveModelProviderId(modelId: string) {
  const [provider] = modelId.split("/", 1);
  return provider || null;
}

function formatProviderLabel(provider: string) {
  const normalized = provider.trim().toLowerCase();

  if (normalized === "openrouter") {
    return "OpenRouter";
  }

  if (normalized === "openai-codex") {
    return "OpenAI Codex";
  }

  if (normalized === "openai") {
    return "OpenAI";
  }

  if (normalized === "anthropic") {
    return "Anthropic";
  }

  if (normalized === "ollama") {
    return "Ollama";
  }

  if (normalized === "xai") {
    return "xAI";
  }

  if (normalized === "gemini") {
    return "Gemini";
  }

  if (normalized === "deepseek") {
    return "DeepSeek";
  }

  if (normalized === "mistral") {
    return "Mistral";
  }

  return provider
    .split("-")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function resolveProviderSetupDetail(provider: string) {
  const normalized = provider.trim().toLowerCase();

  if (normalized === "openai-codex") {
    return "Use the ChatGPT account-based login flow in terminal to use this route.";
  }

  if (
    normalized === "openrouter" ||
    normalized === "openai" ||
    normalized === "anthropic" ||
    normalized === "xai" ||
    normalized === "gemini" ||
    normalized === "deepseek" ||
    normalized === "mistral"
  ) {
    return `Add your ${formatProviderLabel(provider)} API key in terminal to use this route.`;
  }

  return `Connect ${formatProviderLabel(provider)} auth in terminal to use this route.`;
}

function resolveDiagnosticHealth(params: {
  rpcOk: boolean | undefined;
  warningCount: number;
  runtimeIssueCount: number;
  hasOpenClawSignal: boolean;
}) {
  if (!params.rpcOk && !params.hasOpenClawSignal) {
    return "offline";
  }

  if (!params.rpcOk || params.warningCount > 0 || params.runtimeIssueCount > 0) {
    return "degraded";
  }

  return "healthy";
}

function collectIssues(results: {
  gatewayStatus: PromiseSettledResult<GatewayStatusPayload>;
  status: PromiseSettledResult<StatusPayload>;
  agents: PromiseSettledResult<AgentPayload>;
  models: PromiseSettledResult<ModelsPayload>;
  modelStatus: PromiseSettledResult<ModelsStatusPayload>;
  sessions: PromiseSettledResult<SessionsPayload>;
}) {
  return Object.entries(results)
    .flatMap(([key, result]) => {
      if (result.status !== "rejected") {
        return [];
      }

      return [`${key}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`];
    });
}

function resolveAgentForMission(snapshot: MissionControlSnapshot, workspaceId?: string) {
  if (!workspaceId) {
    return snapshot.agents.find((agent) => agent.isDefault)?.id || snapshot.agents[0]?.id;
  }

  const workspaceAgents = snapshot.agents.filter((agent) => agent.workspaceId === workspaceId);
  return (
    workspaceAgents.find((agent) => agent.isDefault)?.id ||
    workspaceAgents.find((agent) => agent.status === "engaged")?.id ||
    workspaceAgents[0]?.id
  );
}

function resolveDefaultWorkspaceRoot() {
  return path.join(os.homedir(), "Documents", "Shared", "projects");
}

function resolveWorkspaceRoot(configuredWorkspaceRoot?: string | null) {
  return configuredWorkspaceRoot || resolveDefaultWorkspaceRoot();
}

async function ensurePathAvailable(targetPath: string, currentPath: string) {
  if (targetPath === currentPath) {
    return;
  }

  try {
    await access(targetPath);
    throw new Error("Target workspace directory already exists.");
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined;

    if (code === "ENOENT") {
      return;
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error("Unable to verify target workspace directory.");
  }
}

function resolveWorkspaceTargetPath(currentPath: string, name?: string, directory?: string) {
  const normalizedDirectory = normalizeOptionalValue(directory);

  if (normalizedDirectory) {
    return path.isAbsolute(normalizedDirectory)
      ? normalizedDirectory
      : path.join(path.dirname(currentPath), normalizedDirectory);
  }

  const normalizedName = normalizeOptionalValue(name);

  if (!normalizedName) {
    return currentPath;
  }

  const nextSlug = slugify(normalizedName);

  if (!nextSlug) {
    throw new Error("Workspace name is required.");
  }

  return path.join(path.dirname(currentPath), nextSlug);
}

function extractToken(key: string | undefined, prefix: string) {
  if (!key) {
    return undefined;
  }

  const marker = `:${prefix}:`;
  const index = key.indexOf(marker);

  if (index === -1) {
    return undefined;
  }

  const tail = key.slice(index + marker.length);
  return tail.split(":")[0];
}

function prettifyWorkspaceName(workspacePath: string) {
  const base = path.basename(workspacePath) || workspacePath;
  return base
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function prettifyAgentName(agentId: string | undefined) {
  if (!agentId) {
    return "OpenClaw";
  }

  return agentId
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return Boolean(value);
}

function padNumber(value: number) {
  return String(value).padStart(2, "0");
}

function normalizeWorkspaceRelativePath(targetPath: string) {
  return targetPath.split(path.sep).join("/");
}

function normalizeUpdateError(value: string | undefined) {
  const normalized = normalizeOptionalValue(value);

  if (!normalized) {
    return undefined;
  }

  return normalized.split(/\r?\n/, 1)[0]?.trim() || normalized;
}

function resolveUpdateInfo(params: {
  currentVersion?: string;
  latestVersion?: string;
  updateError?: string;
  legacyInfo?: string;
}) {
  const legacyInfo = normalizeOptionalValue(params.legacyInfo);

  if (params.latestVersion && params.currentVersion) {
    const comparison = compareVersionStrings(params.latestVersion, params.currentVersion);

    if (comparison > 0) {
      return `Update available: v${params.latestVersion} is ready. Current version: v${params.currentVersion}.`;
    }

    if (comparison === 0) {
      return `OpenClaw is up to date on v${params.currentVersion}.`;
    }

    return `Running v${params.currentVersion}. Registry currently reports v${params.latestVersion}.`;
  }

  if (params.latestVersion) {
    return `Latest available version: v${params.latestVersion}. Current version could not be determined.`;
  }

  if (legacyInfo) {
    return legacyInfo;
  }

  if (params.updateError) {
    return `Update registry check failed: ${params.updateError}`;
  }

  return undefined;
}

function compareVersionStrings(left: string, right: string) {
  const leftParts = tokenizeVersion(left);
  const rightParts = tokenizeVersion(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;

    if (typeof leftPart === "number" && typeof rightPart === "number") {
      if (leftPart !== rightPart) {
        return leftPart - rightPart;
      }

      continue;
    }

    const leftText = String(leftPart);
    const rightText = String(rightPart);

    if (leftText !== rightText) {
      return leftText.localeCompare(rightText);
    }
  }

  return 0;
}

function tokenizeVersion(value: string) {
  return value
    .trim()
    .replace(/^v/i, "")
    .split(/[^0-9a-zA-Z]+/)
    .filter(Boolean)
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part.toLowerCase()));
}

function normalizeOptionalValue(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function hashValue(value: string) {
  return createHash("sha1").update(value).digest("hex").slice(0, 10);
}
