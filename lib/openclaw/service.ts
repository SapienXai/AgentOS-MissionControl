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
import {
  isOpenClawSystemReady
} from "@/lib/openclaw/readiness";
import {
  buildWorkspaceCreateProgressTemplate,
  createOperationProgressTracker
} from "@/lib/openclaw/operation-progress";
import { matchesMissionRuntime, matchesMissionText } from "@/lib/openclaw/runtime-matching";
import {
  DEFAULT_WORKSPACE_RULES,
  buildDefaultWorkspaceAgents,
  getWorkspaceTemplateMeta
} from "@/lib/openclaw/workspace-presets";
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
  MissionDispatchStatus,
  MissionResponse,
  MissionSubmission,
  ModelRecord,
  OpenClawRuntimeSmokeTest,
  OpenClawAgent,
  PresenceRecord,
  RelationshipRecord,
  TaskDetailRecord,
  TaskFeedEvent,
  TaskRecord,
  RuntimeRecord,
  RuntimeOutputItem,
  RuntimeOutputRecord,
  RuntimeCreatedFile,
  WorkspaceAgentBlueprintInput,
  WorkspaceCreateResult,
  WorkspaceCreateRules,
  WorkspaceDeleteInput,
  WorkspaceCreateInput,
  WorkspaceModelProfile,
  WorkspaceSourceMode,
  WorkspaceTemplate,
  WorkspaceUpdateInput,
  WorkspaceProject
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
const missionDispatchesRootPath = path.join(missionControlRootPath, "dispatches");
const missionDispatchRunnerPath = path.join(process.cwd(), "scripts", "openclaw-mission-dispatch-runner.mjs");
const openClawStateRootPath = path.join(os.homedir(), ".openclaw");
const runtimeSmokeTestTtlMs = 12 * 60 * 60 * 1000;
const runtimeSmokeTestMessage = "Mission Control runtime smoke test. Reply with a brief READY status.";
const missionDispatchQueuedStallMs = 30_000;
const missionDispatchHeartbeatStallMs = 90_000;
const missionDispatchRetentionMs = 3 * 24 * 60 * 60 * 1000;
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
  modelId: string | null;
  policy: AgentPolicy | null;
};
type WorkspaceProjectManifest = {
  template: WorkspaceTemplate | null;
  sourceMode: WorkspaceSourceMode | null;
  agentTemplate: string | null;
  hidden: boolean;
  systemTag: string | null;
  agents: WorkspaceProjectManifestAgent[];
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
};

const SNAPSHOT_CACHE_TTL_MS = 10_000;

type SnapshotPair = {
  visible: MissionControlSnapshot;
  full: MissionControlSnapshot;
};

type SnapshotCacheEntry = SnapshotPair & {
  expiresAt: number;
};

let snapshotCache: SnapshotCacheEntry | null = null;
let snapshotPromise: Promise<SnapshotPair> | null = null;
let runtimeHistoryCache = new Map<string, RuntimeRecord>();

export function clearMissionControlCaches() {
  snapshotCache = null;
  runtimeHistoryCache = new Map();
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

    const gatewayStatus =
      gatewayStatusResult.status === "fulfilled" ? gatewayStatusResult.value : undefined;
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
    const runtimeDiagnostics = await buildRuntimeDiagnostics(
      agentsList.map((agent) => agent.id),
      settings
    );

    const workspaceByPath = new Map<string, WorkspaceProject>();
    const profileByWorkspace = new Map<string, AgentBootstrapProfile>();
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
    const baseRuntimes = mergeRuntimeHistory(liveSessionRuntimes);
    const dispatchRuntimes = await buildMissionDispatchRuntimes(baseRuntimes);
    const runtimes = mergeRuntimeHistory([...dispatchRuntimes, ...liveSessionRuntimes]);

    for (const rawAgent of agentsList) {
      const configured = configByAgent.get(rawAgent.id);
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
            name: rawAgent.name || rawAgent.identityName || configured?.name || rawAgent.id
          }),
          {
            fileAccess: configured?.tools?.fs?.workspaceOnly ? "workspace-only" : "extended"
          }
        );
      const primaryModel = rawAgent.model || configured?.model || "unassigned";
      const profile =
        profileByWorkspace.get(rawAgent.workspace) ??
        (await readAgentBootstrapProfile(rawAgent.workspace, {
          agentId: rawAgent.id,
          agentName: rawAgent.name || rawAgent.identityName || configured?.name || rawAgent.id,
          configuredSkills,
          configuredTools: configured?.tools?.fs?.workspaceOnly ? ["fs.workspaceOnly"] : []
        }));
      profileByWorkspace.set(rawAgent.workspace, profile);
      const agentRuntimes = runtimes
        .filter((runtime) => runtime.agentId === rawAgent.id)
        .sort(sortRuntimesByUpdatedAtDesc);
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
        name: rawAgent.name || rawAgent.identityName || configured?.name || rawAgent.id,
        workspaceId,
        workspacePath: rawAgent.workspace,
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
          emoji: configured?.identity?.emoji || rawAgent.identityEmoji,
          theme: configured?.identity?.theme,
          avatar: configured?.identity?.avatar,
          source: rawAgent.identitySource
        },
        profile,
        skills: configuredSkills,
        tools: configured?.tools?.fs?.workspaceOnly ? ["fs.workspaceOnly"] : [],
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

        return {
          ...workspace,
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
    const currentVersion = normalizeOptionalValue(presence[0]?.version || status?.overview?.version || status?.version);
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
        runtimeIssueCount: runtimeDiagnostics.issues.length
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
  const groups = new Map<string, RuntimeRecord[]>();
  const agentNameById = new Map(agents.map((agent) => [agent.id, agent.name]));

  for (const runtime of runtimes) {
    const groupKey = resolveTaskGroupKey(runtime);
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
  const primaryRuntime =
    [...sortedRuntimes].sort((left, right) => scoreTaskRuntime(right) - scoreTaskRuntime(left))[0] ??
    sortedRuntimes[0];
  const mission =
    resolveRuntimeMissionText(primaryRuntime) ||
    sortedRuntimes.map((runtime) => resolveRuntimeMissionText(runtime)).find(Boolean) ||
    null;
  const subtitle =
    sortedRuntimes
      .map((runtime) => runtime.subtitle?.trim())
      .find((value): value is string => Boolean(value)) || "Awaiting OpenClaw updates.";
  const createdFiles = dedupeCreatedFiles(
    sortedRuntimes.flatMap((runtime) => extractCreatedFilesFromRuntimeMetadata(runtime))
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

  return {
    id: createTaskRecordId(groupKey),
    key: groupKey,
    title: mission || primaryRuntime?.title || "Untitled task",
    mission,
    subtitle,
    status: resolveTaskStatus(sortedRuntimes),
    updatedAt: sortedRuntimes[0]?.updatedAt ?? null,
    ageMs: sortedRuntimes[0]?.ageMs ?? null,
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
    updateCount: sortedRuntimes.filter((runtime) => runtime.source === "turn").length,
    liveRunCount: sortedRuntimes.filter((runtime) => runtime.status === "running" || runtime.status === "queued").length,
    artifactCount: createdFiles.length,
    warningCount: warnings.length,
    tokenUsage,
    metadata: {
      mission,
      primaryRuntimeSource: primaryRuntime?.source ?? null
    }
  };
}

function resolveTaskGroupKey(runtime: RuntimeRecord) {
  const taskId = runtime.taskId?.trim();
  const dispatchId =
    typeof runtime.metadata.dispatchId === "string" ? runtime.metadata.dispatchId.trim() : "";
  const mission = resolveRuntimeMissionText(runtime);
  const sessionId = runtime.sessionId?.trim();

  if (dispatchId) {
    return `dispatch:${dispatchId}`;
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

  const normalized = mission.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function scoreTaskRuntime(runtime: RuntimeRecord) {
  const hasMission = resolveRuntimeMissionText(runtime) ? 8 : 0;
  const sourceScore = runtime.source === "turn" ? 6 : runtime.source === "session" ? 4 : 2;
  const statusScore =
    runtime.status === "running"
      ? 5
      : runtime.status === "queued"
        ? 4
        : runtime.status === "stalled"
          ? 3
          : runtime.status === "idle"
            ? 2
            : 1;

  return hasMission + sourceScore + statusScore;
}

function resolveTaskStatus(runtimes: RuntimeRecord[]): RuntimeRecord["status"] {
  if (runtimes.some((runtime) => runtime.status === "running")) {
    return "running";
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

async function assertMissionDispatchReady(snapshot: MissionControlSnapshot, agentId: string) {
  if (!isOpenClawSystemReady(snapshot)) {
    throw new Error(
      "OpenClaw system setup is incomplete. Verify the CLI, gateway, and runtime state before dispatching missions."
    );
  }

  if (!snapshot.diagnostics.modelReadiness.ready) {
    throw new Error(
      "OpenClaw model setup is incomplete. Configure a usable default model before dispatching missions."
    );
  }

  const smokeTest = await ensureOpenClawRuntimeSmokeTest({ agentId });

  if (smokeTest.status !== "passed") {
    throw new Error(
      smokeTest.error
        ? `OpenClaw runtime preflight failed. ${smokeTest.error}`
        : "OpenClaw runtime preflight failed before the mission could be dispatched."
    );
  }
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

  await assertMissionDispatchReady(snapshot, agentId);

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

function createMissionDispatchRecord(payload: MissionDispatchPayload): MissionDispatchRecord {
  const now = new Date().toISOString();

  return {
    id: `dispatch-${randomUUID()}`,
    status: "queued",
    agentId: payload.agentId,
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

async function buildMissionDispatchRuntimes(currentRuntimes: RuntimeRecord[]) {
  const records = await readMissionDispatchRecords();
  const syntheticRuntimes: RuntimeRecord[] = [];
  const nowMs = Date.now();

  for (const record of records) {
    const matchedRuntime = matchMissionDispatchToRuntime(record, currentRuntimes);

    if (matchedRuntime) {
      continue;
    }

    if (record.observation.runtimeId) {
      continue;
    }

    syntheticRuntimes.push(createMissionDispatchRuntime(record, nowMs));
  }

  return syntheticRuntimes.sort(sortRuntimesByUpdatedAtDesc);
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

function shouldPruneMissionDispatchRecord(record: MissionDispatchRecord, nowMs: number) {
  const updatedAt = Date.parse(record.updatedAt);

  if (Number.isNaN(updatedAt)) {
    return false;
  }

  return nowMs - updatedAt > missionDispatchRetentionMs;
}

function matchMissionDispatchToRuntime(record: MissionDispatchRecord, runtimes: RuntimeRecord[]) {
  const submittedAt = Date.parse(record.submittedAt);
  const sessionId = extractMissionDispatchSessionId(record);

  return runtimes
    .filter(
      (runtime) =>
        !isSyntheticDispatchRuntime(runtime) &&
        runtime.agentId === record.agentId &&
        (!sessionId || runtime.sessionId === sessionId) &&
        (runtime.source !== "turn" ||
          matchesMissionRuntime(runtime, record.mission, {
            agentId: record.agentId,
            submittedAt
          })) &&
        (runtime.updatedAt ?? 0) >= (Number.isNaN(submittedAt) ? 0 : submittedAt - 1500)
    )
    .sort(sortRuntimesByUpdatedAtDesc)[0];
}

function isSyntheticDispatchRuntime(runtime: RuntimeRecord) {
  return runtime.id.startsWith("runtime:dispatch:");
}

function createMissionDispatchRuntime(record: MissionDispatchRecord, nowMs: number): RuntimeRecord {
  const updatedAt = Date.parse(record.updatedAt);
  const runtimeStatus = resolveMissionDispatchRuntimeStatus(record, nowMs);
  const subtitle = resolveMissionDispatchSubtitle(record, runtimeStatus);
  const sessionId = extractMissionDispatchSessionId(record);
  const modelId = extractMissionDispatchModelId(record);
  const tokenUsage = extractMissionDispatchTokenUsage(record);

  return {
    id: `runtime:dispatch:${record.id}`,
    source: "turn",
    key: `dispatch:${record.id}`,
    title: summarizeText(record.mission, 38) || "Queued mission",
    subtitle,
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
      pendingCreation: runtimeStatus === "queued"
    }
  };
}

function resolveMissionDispatchRuntimeStatus(record: MissionDispatchRecord, nowMs: number): RuntimeRecord["status"] {
  if (record.status === "completed") {
    return "completed";
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
    const completedSummary =
      resolveMissionDispatchSummary(record) ||
      resolveMissionDispatchResultText(record) ||
      (record.outputDirRelative ? `Completed · ${record.outputDirRelative}` : "Completed in OpenClaw");
    return summarizeText(completedSummary, 90);
  }

  if (status === "stalled") {
    return summarizeText(record.error || "Dispatch is no longer reporting progress.", 90);
  }

  if (status === "running") {
    return record.outputDirRelative
      ? `Running in OpenClaw · ${record.outputDirRelative}`
      : "Running in OpenClaw";
  }

  return record.outputDirRelative
    ? `Queued for OpenClaw · ${record.outputDirRelative}`
    : "Queued for OpenClaw";
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

function extractMissionDispatchNumber(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function extractMissionDispatchSessionId(record: MissionDispatchRecord) {
  return extractMissionDispatchString(extractMissionDispatchAgentMeta(record), "sessionId");
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
  const total = extractMissionDispatchNumber(usageRecord, "total") ?? extractMissionDispatchNumber(usageRecord, "totalTokens");

  if (total === null) {
    return undefined;
  }

  return {
    input: extractMissionDispatchNumber(usageRecord, "input") ?? 0,
    output: extractMissionDispatchNumber(usageRecord, "output") ?? 0,
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
  return normalized === "completed" || normalized === "ok" || normalized === "success" ? null : summary;
}

function resolveMissionDispatchResultText(record: MissionDispatchRecord) {
  return record.result?.result?.payloads?.find((payload) => payload.text.trim().length > 0)?.text.trim() ?? null;
}

function normalizeMissionDispatchStatus(value: unknown): MissionDispatchStatus {
  return value === "running" || value === "completed" || value === "stalled" ? value : "queued";
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

    if (turns.length === 0) {
      return [runtime];
    }

    return turns.slice(-6).reverse().map((turn) => createTurnRuntime(runtime, turn));
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

  return {
    task,
    runs,
    outputs,
    liveFeed: buildTaskFeed(task, runs, outputByRuntimeId, snapshot),
    createdFiles,
    warnings
  };
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

  const snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
  assertAgentIdAvailable(snapshot, agentId, input.workspaceId);
  const workspace = snapshot.workspaces.find((entry) => entry.id === input.workspaceId);

  if (!workspace) {
    throw new Error("Workspace was not found for this agent.");
  }

  const policy = resolveAgentPolicy(input.policy?.preset ?? DEFAULT_AGENT_PRESET, input.policy);
  const presetMeta = getAgentPresetMeta(policy.preset);
  const displayName = normalizeOptionalValue(input.name) ?? presetMeta.defaultName;
  const emoji = normalizeOptionalValue(input.emoji) ?? presetMeta.defaultEmoji;
  const theme = normalizeOptionalValue(input.theme) ?? presetMeta.defaultTheme;
  const heartbeat = serializeHeartbeatConfig(resolveHeartbeatDraft(policy.preset, input.heartbeat));
  const setupAgentId =
    snapshot.agents.find((entry) => entry.workspaceId === workspace.id && entry.policy.preset === "setup")?.id ?? null;

  const args = [
    "agents",
    "add",
    agentId,
    "--workspace",
    workspace.path,
    "--agent-dir",
    buildWorkspaceAgentStatePath(workspace.path, agentId),
    "--non-interactive",
    "--json"
  ];

  if (input.modelId?.trim()) {
    args.push("--model", input.modelId.trim());
  }

  await runOpenClaw(args);

  const policySkillId = await ensureAgentPolicySkill({
    workspacePath: workspace.path,
    agentId,
    agentName: displayName,
    policy,
    setupAgentId
  });

  const configEntry = await upsertAgentConfigEntry(agentId, workspace.path, {
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
  });

  await applyAgentIdentity(agentId, workspace.path, {
    name: displayName || configEntry.name,
    emoji,
    theme,
    avatar: normalizeOptionalValue(input.avatar)
  });

  await upsertWorkspaceProjectAgentMetadata(workspace.path, {
    id: agentId,
    name: displayName,
    role: formatAgentPresetLabel(policy.preset),
    skillId: policySkillId,
    modelId: normalizeOptionalValue(input.modelId),
    isPrimary: false,
    policy
  });

  snapshotCache = null;

  return {
    agentId,
    workspaceId: workspace.id
  };
}

export async function updateAgent(input: AgentUpdateInput) {
  const agentId = input.id.trim();

  if (!agentId) {
    throw new Error("Agent id is required.");
  }

  const snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
  const agent = snapshot.agents.find((entry) => entry.id === agentId);

  if (!agent) {
    throw new Error("Agent was not found.");
  }

  const workspace = snapshot.workspaces.find(
    (entry) => entry.id === (input.workspaceId || agent.workspaceId)
  );

  if (!workspace) {
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
    snapshot.agents.find((entry) => entry.workspaceId === workspace.id && entry.policy.preset === "setup" && entry.id !== agentId)?.id ??
    null;
  const policySkillId = await ensureAgentPolicySkill({
    workspacePath: workspace.path,
    agentId,
    agentName: normalizeOptionalValue(input.name) ?? currentName ?? agentId,
    policy,
    setupAgentId
  });

  const configEntry = await upsertAgentConfigEntry(agentId, workspace.path, {
    name: normalizeOptionalValue(input.name),
    model: normalizeOptionalValue(input.modelId),
    heartbeat,
    skills: [...agent.skills, policySkillId],
    tools:
      policy.fileAccess === "workspace-only"
        ? {
            fs: {
              workspaceOnly: true
            }
          }
        : null
  });

  await applyAgentIdentity(agentId, workspace.path, {
    name: normalizeOptionalValue(input.name) ?? configEntry.name,
    emoji: normalizeOptionalValue(input.emoji) ?? currentEmoji,
    theme: normalizeOptionalValue(input.theme) ?? currentTheme,
    avatar: normalizeOptionalValue(input.avatar)
  });

  await upsertWorkspaceProjectAgentMetadata(workspace.path, {
    id: agentId,
    name: normalizeOptionalValue(input.name) ?? currentName ?? configEntry.name ?? agentId,
    modelId: normalizeOptionalValue(input.modelId) ?? (agent.modelId === "unassigned" ? null : agent.modelId),
    isPrimary: agent.isDefault,
    policy
  });

  snapshotCache = null;

  return {
    agentId,
    workspaceId: workspace.id
  };
}

export async function deleteAgent(input: AgentDeleteInput) {
  const agentId = input.agentId.trim();

  if (!agentId) {
    throw new Error("Agent id is required.");
  }

  const snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
  const agent = snapshot.agents.find((entry) => entry.id === agentId);

  if (!agent) {
    throw new Error("Agent was not found.");
  }

  const workspace = snapshot.workspaces.find((entry) => entry.id === agent.workspaceId) ?? null;
  const runtimeCount = snapshot.runtimes.filter((runtime) => runtime.agentId === agent.id).length;

  await runOpenClaw(["agents", "delete", agent.id, "--force", "--json"]);

  try {
    const configList = await readAgentConfigList();
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
    sourceMode: normalized.sourceMode,
    agents: enabledAgents
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
        template: normalized.template
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

    const configList = await readAgentConfigList();
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
    const configList = await readAgentConfigList();
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
  agents: WorkspaceAgentBlueprintInput[];
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
    agents: WorkspaceAgentBlueprintInput[];
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
        agents: options.agents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          role: agent.role,
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

  await writeTextFileIfMissing(
    path.join(workspacePath, "AGENTS.md"),
    renderAgentsMarkdown({
      name: options.name,
      brief: options.brief,
      template: options.template,
      sourceMode: options.sourceMode,
      agents: options.agents,
      rules: options.rules
    })
  );
  await writeTextFileIfMissing(
    path.join(workspacePath, "SOUL.md"),
    renderSoulMarkdown(options.template, options.brief)
  );
  await writeTextFileIfMissing(
    path.join(workspacePath, "IDENTITY.md"),
    renderIdentityMarkdown(options.template)
  );
  await writeTextFileIfMissing(
    path.join(workspacePath, "TOOLS.md"),
    renderToolsMarkdown(options.template, toolExamples)
  );
  await writeTextFileIfMissing(
    path.join(workspacePath, "HEARTBEAT.md"),
    renderHeartbeatMarkdown(options.template)
  );

  if (options.rules.generateMemory) {
    await mkdir(path.join(workspacePath, "memory"), { recursive: true });
    await writeTextFileIfMissing(
      path.join(workspacePath, "MEMORY.md"),
      renderMemoryMarkdown(options.name, options.template, options.brief)
    );
    await writeTextFileIfMissing(
      path.join(workspacePath, "memory", "blueprint.md"),
      renderBlueprintMarkdown(options.name, options.template, options.brief)
    );
    await writeTextFileIfMissing(
      path.join(workspacePath, "memory", "decisions.md"),
      renderDecisionsMarkdown()
    );
  }

  if (options.rules.generateStarterDocs) {
    await mkdir(path.join(workspacePath, "docs"), { recursive: true });
    await mkdir(path.join(workspacePath, "deliverables"), { recursive: true });
    await writeTextFileIfMissing(
      path.join(workspacePath, "docs", "brief.md"),
      renderBriefMarkdown(options.name, options.template, options.brief, options.sourceMode)
    );
    await writeTextFileIfMissing(
      path.join(workspacePath, "docs", "architecture.md"),
      renderArchitectureMarkdown(options.template)
    );
    await writeTextFileIfMissing(
      path.join(workspacePath, "deliverables", "README.md"),
      renderDeliverablesMarkdown()
    );

    if (options.template === "frontend") {
      await writeTextFileIfMissing(
        path.join(workspacePath, "docs", "ux-notes.md"),
        renderTemplateSpecificDoc("ux")
      );
    }

    if (options.template === "backend") {
      await writeTextFileIfMissing(
        path.join(workspacePath, "docs", "service-map.md"),
        renderTemplateSpecificDoc("backend")
      );
    }

    if (options.template === "research") {
      await writeTextFileIfMissing(
        path.join(workspacePath, "docs", "research-plan.md"),
        renderTemplateSpecificDoc("research")
      );
    }

    if (options.template === "content") {
      await writeTextFileIfMissing(
        path.join(workspacePath, "docs", "content-brief.md"),
        renderTemplateSpecificDoc("content")
      );
    }
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
  });

  return agentId;
}

async function runWorkspaceKickoffMission(
  params: {
    agentId: string;
    brief?: string;
    modelProfile: WorkspaceModelProfile;
    template: WorkspaceTemplate;
  },
  options: {
    onProgress?: KickoffProgressHandler;
  } = {}
) {
  const prompt = buildWorkspaceKickoffPrompt(params.template, params.brief);
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
    : buildDefaultWorkspaceAgents(template, teamPreset)
  ).map((agent) => ({
    id: slugify(agent.id) || "agent",
    role: agent.role.trim() || prettifyAgentName(agent.id),
    name: normalizeOptionalValue(agent.name) ?? prettifyAgentName(agent.id),
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
    agents: normalizedAgents
  };
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

async function ensureAgentPolicySkill(params: {
  workspacePath: string;
  agentId: string;
  agentName: string;
  policy: AgentPolicy;
  setupAgentId?: string | null;
}) {
  const skillId = buildAgentPolicySkillId(params.agentId);
  await writeTextFileEnsured(
    path.join(params.workspacePath, "skills", skillId, "SKILL.md"),
    `${renderAgentPolicySkillMarkdown(params.agentName, params.policy, params.setupAgentId)}\n`
  );
  return skillId;
}

function renderAgentsMarkdown(params: {
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

function renderSoulMarkdown(template: WorkspaceTemplate, brief?: string) {
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

function renderIdentityMarkdown(template: WorkspaceTemplate) {
  const templateMeta = getWorkspaceTemplateMeta(template);

  return `# IDENTITY

## Role
This workspace hosts a ${templateMeta.label.toLowerCase()} team coordinated through OpenClaw.

**Vibe:** pragmatic, concise, quality-minded, workspace-grounded
`;
}

function renderToolsMarkdown(template: WorkspaceTemplate, toolExamples: string[]) {
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

function renderHeartbeatMarkdown(template: WorkspaceTemplate) {
  const templateMeta = getWorkspaceTemplateMeta(template);

  return `# HEARTBEAT

- Start each substantial task by refreshing the brief, docs, and current files.
- Keep the ${templateMeta.label.toLowerCase()} workspace coherent across code, docs, and memory.
- Prefer explicit handoffs between implementation, review, testing, and knowledge capture.
`;
}

function renderMemoryMarkdown(name: string, template: WorkspaceTemplate, brief?: string) {
  return `# ${name} Memory

Durable project facts for this ${getWorkspaceTemplateMeta(template).label.toLowerCase()} workspace.

## Current brief
${brief || "No brief captured yet. Fill this in as soon as the project goal is clarified."}

## Stable facts
- Add durable architecture, product, or workflow facts here.
- Move longer notes into memory/*.md when they outgrow this file.
`;
}

function renderBlueprintMarkdown(name: string, template: WorkspaceTemplate, brief?: string) {
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

function renderDecisionsMarkdown() {
  return `# Decisions

Use this file for durable decisions that should survive across sessions.

## Template
- Date:
- Decision:
- Context:
- Consequence:
`;
}

function renderBriefMarkdown(
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

function renderArchitectureMarkdown(template: WorkspaceTemplate) {
  return `# Architecture

## Current shape
- Describe the main components, systems, or content lanes in this ${getWorkspaceTemplateMeta(template).label.toLowerCase()} workspace.

## Dependencies
- List critical external services, repos, data sources, or channels.

## Risks
- Capture structural, operational, or delivery risks here.
`;
}

function renderDeliverablesMarkdown() {
  return `# Deliverables

Use this folder for substantial output artifacts that should be easy to hand off or review.

- Create one subfolder per task or run, for example \`deliverables/2026-03-07-15-30-00-launch-brief/\`.
- Put drafts, reports, docs, and publishable assets for that task inside its run folder.
- Keep filenames descriptive and tied to the task or audience.
`;
}

function renderTemplateSpecificDoc(kind: "ux" | "backend" | "research" | "content") {
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

function renderAgentPolicySkillMarkdown(agentName: string, policy: AgentPolicy, setupAgentId?: string | null) {
  const presetLabel = formatAgentPresetLabel(policy.preset);

  return `# ${agentName} Policy

Preset: ${presetLabel}

## Output routing
- Final deliverables belong in the current deliverables run folder for the task.
- Keep temporary notes and durable workspace memory inside memory/.
- Avoid writing final artifacts to the workspace root unless the task explicitly asks for it.

## Operating rules
${buildAgentPolicyPromptLines(policy, setupAgentId)
  .map((line) => line.replace(/^- /, "- "))
  .join("\n")}
`;
}

function buildWorkspaceKickoffPrompt(template: WorkspaceTemplate, brief?: string) {
  const templateMeta = getWorkspaceTemplateMeta(template);

  return [
    `You are bootstrapping a newly created ${templateMeta.label.toLowerCase()} workspace.`,
    brief ? `Project brief: ${brief}` : "No detailed project brief was provided yet.",
    "Inspect the current files and improve the starter workspace without rewriting files that already had meaningful content.",
    "If docs/architecture.md or memory/blueprint.md exist, refine them based on the real repository state.",
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
  }
) {
  const configList = await readAgentConfigList();
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

async function readAgentConfigList() {
  const config = await runOpenClawJson<MutableAgentConfigEntry[]>([
    "config",
    "get",
    "agents.list",
    "--json"
  ]);

  return Array.isArray(config) ? config : [];
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

async function applyAgentIdentity(
  agentId: string,
  workspacePath: string,
  identity: {
    name?: string;
    emoji?: string;
    theme?: string;
    avatar?: string;
  }
) {
  const args = ["agents", "set-identity", "--agent", agentId, "--workspace", workspacePath, "--json"];

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

  if (args.length === 7) {
    return;
  }

  await runOpenClaw(args);
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
  const agentNameById = new Map(snapshot.agents.map((agent) => [agent.id, agent.name]));
  const events: TaskFeedEvent[] = [];
  const sortedRuns = [...runs].sort((left, right) => (left.updatedAt ?? 0) - (right.updatedAt ?? 0));

  for (const runtime of sortedRuns) {
    const output = outputsByRuntimeId.get(runtime.id);
    const agentName = runtime.agentId ? agentNameById.get(runtime.agentId) ?? null : null;
    const runtimeTimestamp = timestampFromRuntime(runtime, output?.finalTimestamp);

    if (output?.items.length) {
      for (const item of output.items) {
        events.push({
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
        });
      }
    } else {
      events.push({
        id: `${runtime.id}:status`,
        kind: "status",
        timestamp: runtimeTimestamp,
        title: agentName ? `${agentName} · ${runtime.status}` : `Run · ${runtime.status}`,
        detail: summarizeText(output?.errorMessage || runtime.subtitle, 220),
        runtimeId: runtime.id,
        agentId: runtime.agentId,
        isError: runtime.status === "stalled"
      });
    }

    const warningValues = uniqueStrings(
      (output?.warnings ?? []).concat(extractWarningsFromRuntimeMetadata(runtime))
    );
    for (const warning of warningValues) {
      events.push({
        id: `${runtime.id}:warning:${hashTaskKey(warning)}`,
        kind: "warning",
        timestamp: runtimeTimestamp,
        title: "Fallback",
        detail: summarizeText(warning, 220),
        runtimeId: runtime.id,
        agentId: runtime.agentId
      });
    }

    const createdFiles = dedupeCreatedFiles(
      (output?.createdFiles ?? []).concat(extractCreatedFilesFromRuntimeMetadata(runtime))
    );
    for (const file of createdFiles) {
      events.push({
        id: `${runtime.id}:artifact:${hashTaskKey(file.path)}`,
        kind: "artifact",
        timestamp: runtimeTimestamp,
        title: "Created file",
        detail: file.displayPath,
        runtimeId: runtime.id,
        agentId: runtime.agentId
      });
    }
  }

  if (events.length === 0 && task.mission) {
    events.push({
      id: `${task.id}:mission`,
      kind: "user",
      timestamp: timestampFromUnix(task.updatedAt),
      title: "Mission",
      detail: summarizeText(task.mission, 220),
      agentId: task.primaryAgentId
    });
  }

  return events
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
    .slice(-36);
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
        if (role !== "assistant" || !entry.message.content?.some((item) => item.type === "toolCall")) {
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
            ? entry.message.toolName || extractToolNameFromTranscriptText(text)
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
          pendingCreatedFiles: new Map()
        };
        continue;
      }

      if (!currentTurn) {
        continue;
      }

      if (role === "assistant" && Array.isArray(entry.message.content)) {
        for (const contentItem of entry.message.content) {
          if (contentItem.type !== "toolCall" || contentItem.name !== "write") {
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

      if (role === "assistant" && entry.message.usage) {
        currentTurn.tokenUsage = {
          input: entry.message.usage.input ?? 0,
          output: entry.message.usage.output ?? 0,
          total: entry.message.usage.totalTokens ?? 0,
          cacheRead: entry.message.usage.cacheRead ?? 0
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
  }
): TranscriptTurn {
  const { pendingCreatedFiles, ...rest } = turn;
  void pendingCreatedFiles;
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
    warningSummary: warnings[0] ?? null
  };
}

function createTurnRuntime(runtime: RuntimeRecord, turn: TranscriptTurn): RuntimeRecord {
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

  return summarizeText(normalized, 38);
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
    configuredSkills: string[];
    configuredTools: string[];
  }
): Promise<AgentBootstrapProfile> {
  const bootstrapFiles = ["AGENTS.md", "SOUL.md", "IDENTITY.md", "TOOLS.md", "HEARTBEAT.md"] as const;
  const sources: string[] = [];
  const sections = new Map<string, string[]>();

  for (const fileName of bootstrapFiles) {
    const filePath = path.join(workspacePath, fileName);

    try {
      await access(filePath);
      const raw = await readFile(filePath, "utf8");
      const trimmed = raw.trim();
      if (!trimmed) {
        continue;
      }

      sources.push(fileName);
      sections.set(fileName, trimmed.split(/\r?\n/));
    } catch {
      continue;
    }
  }

  const purpose =
    extractPurpose(sections) ??
    inferPurposeFromConfig({
      agentId: options.agentId,
      agentName: options.agentName,
      skills: options.configuredSkills
    });
  const operatingInstructions =
    uniqueStrings([
      ...extractBulletSection(sections.get("AGENTS.md"), "Safety defaults"),
      ...extractBulletSection(sections.get("AGENTS.md"), "Daily memory"),
      ...extractBulletSection(sections.get("SOUL.md"), "How I Operate"),
      ...extractBulletSection(sections.get("TOOLS.md"), "Examples")
    ]).slice(0, 6) || [];
  const responseStyle =
    uniqueStrings([
      ...extractInlineList(sections.get("IDENTITY.md"), "Vibe"),
      ...extractBulletSection(sections.get("SOUL.md"), "My Quirks"),
      ...extractBulletSection(sections.get("SOUL.md"), "How I Operate")
    ]).slice(0, 6) || [];
  const outputPreference =
    extractOutputPreference(sections.get("AGENTS.md")) ??
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

async function readWorkspaceInspectorMetadata(
  workspacePath: string,
  agents: OpenClawAgent[]
): Promise<Pick<WorkspaceProject, "bootstrap" | "capabilities">> {
  const [projectMeta, coreFiles, optionalFiles, folders, projectShell, localSkillIds] =
    await Promise.all([
      readWorkspaceProjectManifest(workspacePath),
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

    return {
      template: isWorkspaceTemplate(parsed.template) ? parsed.template : null,
      sourceMode: isWorkspaceSourceMode(parsed.sourceMode) ? parsed.sourceMode : null,
      agentTemplate: typeof parsed.agentTemplate === "string" ? parsed.agentTemplate : null,
      hidden: parsed.hidden === true,
      systemTag: typeof parsed.systemTag === "string" ? parsed.systemTag : null,
      agents
    };
  } catch {
    return {
      template: null,
      sourceMode: null,
      agentTemplate: null,
      hidden: false,
      systemTag: null,
      agents: []
    };
  }
}

async function upsertWorkspaceProjectAgentMetadata(
  workspacePath: string,
  agent: {
    id: string;
    name?: string | null;
    role?: string | null;
    isPrimary?: boolean;
    skillId?: string | null;
    modelId?: string | null;
    policy: AgentPolicy;
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
    skillId: agent.skillId ?? existingAgent?.skillId ?? null,
    modelId: agent.modelId ?? existingAgent?.modelId ?? null,
    policy: agent.policy
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
    skillId: typeof value.skillId === "string" ? value.skillId : null,
    modelId: typeof value.modelId === "string" ? value.modelId : null,
    policy: parseAgentPolicy(value.policy)
  };
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

function extractPurpose(sections: Map<string, string[]>) {
  const soulPurpose = extractSectionParagraph(sections.get("SOUL.md"), "My Purpose");
  if (soulPurpose) {
    return soulPurpose;
  }

  const identityRole = extractSectionParagraph(sections.get("IDENTITY.md"), "Role");
  if (identityRole) {
    return identityRole;
  }

  const agentsCustomize = extractSectionParagraph(sections.get("AGENTS.md"), "Customize");
  if (agentsCustomize) {
    return agentsCustomize;
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
    }
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
      typeof session.totalTokens === "number"
        ? {
            input: session.inputTokens ?? 0,
            output: session.outputTokens ?? 0,
            total: session.totalTokens,
            cacheRead: session.cacheRead ?? 0
          }
        : undefined,
    metadata: {
      kind: session.kind ?? "direct",
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
      status: runtime.status === "stalled" ? "stalled" : "completed",
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

  return provider
    .split("-")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function resolveProviderSetupDetail(provider: string) {
  if (provider.trim().toLowerCase() === "openrouter") {
    return `Add your ${formatProviderLabel(provider)} API key in terminal to use this route.`;
  }

  return `Connect ${formatProviderLabel(provider)} auth in terminal to use this route.`;
}

function resolveDiagnosticHealth(params: {
  rpcOk: boolean | undefined;
  warningCount: number;
  runtimeIssueCount: number;
}) {
  if (!params.rpcOk) {
    return "offline";
  }

  if (params.warningCount > 0 || params.runtimeIssueCount > 0) {
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

function normalizeOptionalValue(value: string | undefined) {
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
