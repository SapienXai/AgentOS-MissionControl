import "server-only";

import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createFallbackSnapshot } from "@/lib/openclaw/fallback";
import { detectOpenClaw, runOpenClaw, runOpenClawJson } from "@/lib/openclaw/cli";
import type {
  AgentCreateInput,
  AgentStatus,
  AgentUpdateInput,
  MissionControlSnapshot,
  MissionResponse,
  MissionSubmission,
  ModelRecord,
  OpenClawAgent,
  PresenceRecord,
  RelationshipRecord,
  RuntimeRecord,
  RuntimeOutputItem,
  RuntimeOutputRecord,
  WorkspaceDeleteInput,
  WorkspaceCreateInput,
  WorkspaceUpdateInput,
  WorkspaceProject
} from "@/lib/openclaw/types";

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
  overview?: {
    version?: string;
    update?: string;
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
type MutableAgentConfigEntry = AgentConfigPayload[number] & Record<string, unknown>;

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
type SessionTranscriptEntry = {
  type?: string;
  id?: string;
  parentId?: string | null;
  timestamp?: string;
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
    }>;
    stopReason?: string;
    errorMessage?: string;
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
};

let snapshotCache: { snapshot: MissionControlSnapshot; expiresAt: number } | null = null;
let runtimeHistoryCache = new Map<string, RuntimeRecord>();

export async function getMissionControlSnapshot(options: { force?: boolean } = {}) {
  if (!options.force && snapshotCache && snapshotCache.expiresAt > Date.now()) {
    return snapshotCache.snapshot;
  }

  const openclawInstalled = await detectOpenClaw();

  if (!openclawInstalled) {
    return createFallbackSnapshot("OpenClaw CLI is not installed on this machine.");
  }

  try {
    const [
      gatewayStatusResult,
      statusResult,
      agentsResult,
      agentConfigResult,
      modelsResult,
      sessionsResult,
      presenceResult
    ] = await Promise.allSettled([
      runOpenClawJson<GatewayStatusPayload>(["gateway", "status", "--json"]),
      runOpenClawJson<StatusPayload>(["status", "--json"]),
      runOpenClawJson<AgentPayload>(["agents", "list", "--json"]),
      runOpenClawJson<AgentConfigPayload>(["config", "get", "agents.list", "--json"]),
      runOpenClawJson<ModelsPayload>(["models", "list", "--json"]),
      runOpenClawJson<SessionsPayload>(["sessions", "--all-agents", "--json"]),
      runOpenClawJson<PresencePayload>(["gateway", "call", "system-presence", "--json"])
    ]);

    const gatewayStatus =
      gatewayStatusResult.status === "fulfilled" ? gatewayStatusResult.value : undefined;
    const status = statusResult.status === "fulfilled" ? statusResult.value : undefined;
    const agentsList = agentsResult.status === "fulfilled" ? agentsResult.value : [];
    const agentConfig = agentConfigResult.status === "fulfilled" ? agentConfigResult.value : [];
    const models = modelsResult.status === "fulfilled" ? modelsResult.value.models : [];
    const sessions = sessionsResult.status === "fulfilled" ? sessionsResult.value.sessions : [];
    const presence = presenceResult.status === "fulfilled" ? presenceResult.value : [];

    const workspaceByPath = new Map<string, WorkspaceProject>();
    const profileByWorkspace = new Map<string, AgentBootstrapProfile>();
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

    const runtimes = mergeRuntimeHistory(
      (
        await Promise.all(
          sessions.map((session) => mapSessionToRuntimes(session, agentConfig, agentsList))
        )
      ).flat()
    );

    for (const rawAgent of agentsList) {
      const configured = configByAgent.get(rawAgent.id);
      const workspaceId = workspaceIdFromPath(rawAgent.workspace);
      const sessionList = recentSessionsByAgent.get(rawAgent.id) ?? [];
      const primaryModel = rawAgent.model || configured?.model || "unassigned";
      const profile =
        profileByWorkspace.get(rawAgent.workspace) ??
        (await readAgentBootstrapProfile(rawAgent.workspace, {
          agentId: rawAgent.id,
          agentName: rawAgent.name || rawAgent.identityName || configured?.name || rawAgent.id,
          configuredSkills: configured?.skills ?? [],
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
        skills: configured?.skills ?? [],
        tools: configured?.tools?.fs?.workspaceOnly ? ["fs.workspaceOnly"] : []
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

    const workspaces = Array.from(workspaceByPath.values()).map((workspace) => ({
      ...workspace,
      modelIds: unique(workspace.modelIds),
      activeRuntimeIds: unique(workspace.activeRuntimeIds),
      health: resolveWorkspaceHealth(workspace.agentIds, agents)
    }));

    const modelUsage = new Map<string, number>();
    for (const agent of agents) {
      modelUsage.set(agent.modelId, (modelUsage.get(agent.modelId) ?? 0) + 1);
    }

    const mappedModels: ModelRecord[] = models.map((model) => ({
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
    }));

    const securityWarnings =
      status?.securityAudit?.findings
        ?.filter((entry) => entry.severity === "warn")
        .map((entry) => entry.title || entry.detail || "Security warning") ?? [];

    const diagnostics = {
      installed: true,
      loaded: Boolean(gatewayStatus?.service?.loaded),
      rpcOk: Boolean(gatewayStatus?.rpc?.ok),
      health: resolveDiagnosticHealth(gatewayStatus?.rpc?.ok, securityWarnings.length),
      version: presence[0]?.version || status?.overview?.version,
      dashboardUrl: `http://127.0.0.1:${gatewayStatus?.gateway?.port ?? 18789}/`,
      gatewayUrl: gatewayStatus?.gateway?.probeUrl || "ws://127.0.0.1:18789",
      bindMode: gatewayStatus?.gateway?.bindMode,
      port: gatewayStatus?.gateway?.port,
      updateChannel: "stable",
      updateInfo: status?.overview?.update,
      serviceLabel: gatewayStatus?.service?.label,
      securityWarnings,
      issues: collectIssues({
        gatewayStatus: gatewayStatusResult,
        status: statusResult,
        agents: agentsResult,
        models: modelsResult,
        sessions: sessionsResult
      })
    } satisfies MissionControlSnapshot["diagnostics"];

    const snapshot: MissionControlSnapshot = {
      generatedAt: new Date().toISOString(),
      mode: "live",
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
      workspaces,
      agents,
      models: mappedModels,
      runtimes,
      relationships,
      missionPresets: [
        "Audit the selected workspace and generate a concrete first task batch.",
        "Plan a multi-agent delivery mission for the current product goal.",
        "Review active runtimes, identify blockers, and propose the next handoff."
      ]
    };

    snapshotCache = {
      snapshot,
      expiresAt: Date.now() + 2500
    };

    return snapshot;
  } catch (error) {
    return createFallbackSnapshot(error instanceof Error ? error.message : "Unknown OpenClaw error.");
  }
}

export async function submitMission(input: MissionSubmission): Promise<MissionResponse> {
  const mission = input.mission.trim();

  if (!mission) {
    throw new Error("Mission text is required.");
  }

  const snapshot = await getMissionControlSnapshot({ force: true });
  const agentId = input.agentId || resolveAgentForMission(snapshot, input.workspaceId);

  if (!agentId) {
    throw new Error("No OpenClaw agent is available for mission dispatch.");
  }

  const payload = await runOpenClawJson<MissionCommandPayload>([
    "agent",
    "--agent",
    agentId,
    "--message",
    mission,
    "--thinking",
    input.thinking ?? "medium",
    "--timeout",
    "120",
    "--json"
  ]);

  snapshotCache = null;

  return {
    runId: payload.runId,
    agentId,
    status: payload.status,
    summary: payload.summary,
    payloads: payload.result?.payloads ?? [],
    meta: payload.result?.meta
  };
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
    const turns = extractTranscriptTurns(raw, runtime).filter((turn) => !isHeartbeatTurn(turn.prompt));

    if (turns.length === 0) {
      return [runtime];
    }

    return turns.slice(-6).reverse().map((turn) => createTurnRuntime(runtime, turn));
  } catch {
    return [runtime];
  }
}

export async function getRuntimeOutput(runtimeId: string): Promise<RuntimeOutputRecord> {
  const snapshot = await getMissionControlSnapshot({ force: true });
  const runtime = snapshot.runtimes.find((entry) => entry.id === runtimeId);

  if (!runtime) {
    return {
      runtimeId,
      status: "missing",
      finalText: null,
      finalTimestamp: null,
      stopReason: null,
      errorMessage: "Runtime was not found in the current OpenClaw snapshot.",
      items: []
    };
  }

  if (snapshot.mode === "fallback") {
    return {
      runtimeId,
      sessionId: runtime.sessionId,
      taskId: runtime.taskId,
      status: "available",
      finalText: "Fallback mode is active. Connect a real OpenClaw gateway to inspect live runtime output.",
      finalTimestamp: new Date().toISOString(),
      stopReason: "fallback",
      errorMessage: null,
      items: [
        {
          id: "fallback-assistant",
          role: "assistant",
          timestamp: new Date().toISOString(),
          text: "Fallback mode is active. Connect a real OpenClaw gateway to inspect live runtime output.",
          stopReason: "fallback",
          isError: false
        }
      ]
    };
  }

  if (!runtime.sessionId || !runtime.agentId) {
    return {
      runtimeId,
      sessionId: runtime.sessionId,
      taskId: runtime.taskId,
      status: "missing",
      finalText: null,
      finalTimestamp: null,
      stopReason: null,
      errorMessage: "This runtime does not expose a session transcript yet.",
      items: []
    };
  }

  const agent = snapshot.agents.find((entry) => entry.id === runtime.agentId);
  const transcriptPath = await resolveRuntimeTranscriptPath(runtime.agentId, runtime.sessionId, agent?.workspacePath);

  if (!transcriptPath) {
    return {
      runtimeId,
      sessionId: runtime.sessionId,
      taskId: runtime.taskId,
      status: "missing",
      finalText: null,
      finalTimestamp: null,
      stopReason: null,
      errorMessage: "No transcript file was found for this runtime session.",
      items: []
    };
  }

  try {
    const raw = await readFile(transcriptPath, "utf8");
    return parseRuntimeOutput(runtime, raw);
  } catch (error) {
    return {
      runtimeId,
      sessionId: runtime.sessionId,
      taskId: runtime.taskId,
      status: "error",
      finalText: null,
      finalTimestamp: null,
      stopReason: null,
      errorMessage: error instanceof Error ? error.message : "Unable to read runtime transcript.",
      items: []
    };
  }
}

export async function createAgent(input: AgentCreateInput) {
  const agentId = slugify(input.id.trim());

  if (!agentId) {
    throw new Error("Agent id is required.");
  }

  const snapshot = await getMissionControlSnapshot({ force: true });
  const workspace = snapshot.workspaces.find((entry) => entry.id === input.workspaceId);

  if (!workspace) {
    throw new Error("Workspace was not found for this agent.");
  }

  const args = [
    "agents",
    "add",
    agentId,
    "--workspace",
    workspace.path,
    "--non-interactive",
    "--json"
  ];

  if (input.modelId?.trim()) {
    args.push("--model", input.modelId.trim());
  }

  await runOpenClaw(args);

  const configEntry = await upsertAgentConfigEntry(agentId, workspace.path, {
    name: normalizeOptionalValue(input.name),
    model: normalizeOptionalValue(input.modelId)
  });

  await applyAgentIdentity(agentId, workspace.path, {
    name: normalizeOptionalValue(input.name) ?? configEntry.name,
    emoji: normalizeOptionalValue(input.emoji),
    theme: normalizeOptionalValue(input.theme),
    avatar: normalizeOptionalValue(input.avatar)
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

  const snapshot = await getMissionControlSnapshot({ force: true });
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

  const configEntry = await upsertAgentConfigEntry(agentId, workspace.path, {
    name: normalizeOptionalValue(input.name),
    model: normalizeOptionalValue(input.modelId)
  });

  await applyAgentIdentity(agentId, workspace.path, {
    name: normalizeOptionalValue(input.name) ?? configEntry.name,
    emoji: normalizeOptionalValue(input.emoji),
    theme: normalizeOptionalValue(input.theme),
    avatar: normalizeOptionalValue(input.avatar)
  });

  snapshotCache = null;

  return {
    agentId,
    workspaceId: workspace.id
  };
}

export async function createWorkspaceProject(input: WorkspaceCreateInput) {
  const name = input.name.trim();

  if (!name) {
    throw new Error("Workspace name is required.");
  }

  const slug = slugify(name);
  const targetDir = input.directory?.trim() || path.join(resolveWorkspaceRoot(), slug);
  const agentId = `${slug}-default`;

  await mkdir(targetDir, { recursive: true });

  const args = [
    "agents",
    "add",
    agentId,
    "--workspace",
    targetDir,
    "--non-interactive",
    "--json"
  ];

  if (input.modelId?.trim()) {
    args.push("--model", input.modelId.trim());
  }

  await runOpenClaw(args);
  snapshotCache = null;

  return {
    workspacePath: targetDir,
    agentId
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
            workspace: targetPath
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

  const snapshot = await getMissionControlSnapshot({ force: true });
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

  snapshotCache = null;
  runtimeHistoryCache = new Map();

  return {
    workspaceId: workspace.id,
    workspacePath: workspace.path,
    deletedAgentIds: workspaceAgents.map((agent) => agent.id),
    deletedRuntimeCount: runtimeCount
  };
}

async function upsertAgentConfigEntry(
  agentId: string,
  workspacePath: string,
  updates: {
    name?: string;
    model?: string;
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

function parseRuntimeOutput(runtime: RuntimeRecord, raw: string): RuntimeOutputRecord {
  const turns = extractTranscriptTurns(raw, runtime);

  if (runtime.source === "turn") {
    const turnId = typeof runtime.metadata.turnId === "string" ? runtime.metadata.turnId : null;
    const turn = turnId ? turns.find((entry) => entry.id === turnId) : null;

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
    items: []
  };
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
    items: turn.items.slice(-12)
  };
}

function extractTranscriptTurns(raw: string, runtime: RuntimeRecord) {
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const turns: TranscriptTurn[] = [];
  let currentTurn:
    | (Omit<TranscriptTurn, "status" | "finalText" | "finalTimestamp" | "stopReason" | "errorMessage"> & {
        errorMessage: string | null;
      })
    | null = null;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as SessionTranscriptEntry;

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

      if (!text && !errorMessage) {
        continue;
      }

      const item: RuntimeOutputItem = {
        id: entry.id || `${role}-${Date.now()}`,
        role,
        timestamp: entry.timestamp || new Date().toISOString(),
        text: text || errorMessage || "",
        toolName: role === "toolResult" ? extractToolNameFromTranscriptText(text) : undefined,
        stopReason: role === "assistant" ? entry.message.stopReason ?? null : null,
        errorMessage,
        isError:
          Boolean(errorMessage) ||
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
          errorMessage: null
        };
        continue;
      }

      if (!currentTurn) {
        continue;
      }

      currentTurn.items.push(item);
      currentTurn.updatedAt = item.timestamp;
      currentTurn.errorMessage ||= errorMessage;

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
  turn: Omit<TranscriptTurn, "status" | "finalText" | "finalTimestamp" | "stopReason"> & {
    errorMessage: string | null;
  }
): TranscriptTurn {
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
  const status =
    hasError
      ? "error"
      : lastItem?.role === "assistant" && lastItem.stopReason && lastItem.stopReason !== "toolUse"
        ? "completed"
        : "active";

  return {
    ...turn,
    status,
    finalText: finalAssistant?.text ?? null,
    finalTimestamp: finalAssistant?.timestamp ?? null,
    stopReason,
    errorMessage: turn.errorMessage || finalAssistant?.errorMessage || null
  };
}

function createTurnRuntime(runtime: RuntimeRecord, turn: TranscriptTurn): RuntimeRecord {
  const updatedAt = Date.parse(turn.updatedAt);
  const title = formatTurnTitle(turn.prompt, runtime.agentId);
  const subtitle = turn.finalText
    ? summarizeText(turn.finalText, 90)
    : turn.status === "error"
      ? "Run ended with an error"
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
    runId: turn.runId || turn.id,
    tokenUsage: turn.tokenUsage,
    metadata: {
      ...runtime.metadata,
      turnId: turn.id,
      turnPrompt: turn.prompt,
      stage: "main.turn",
      historical: turn.status !== "active"
    }
  };
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
    health: "standby"
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
    subtitle: taskLabel ? `task ${taskLabel} · ${stage || "active"}` : "main session",
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
      status: runtime.status === "error" ? "error" : "completed",
      metadata: {
        ...runtime.metadata,
        historical: true
      }
    } satisfies RuntimeRecord;

    nextHistory.set(runtimeId, historicalRuntime);
  }

  const prunedHistory = pruneRuntimeHistory(Array.from(nextHistory.values()));
  runtimeHistoryCache = new Map(prunedHistory.map((runtime) => [runtime.id, runtime]));

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
    return "active";
  }

  if (key?.endsWith(":main") && typeof ageMs === "number" && ageMs < 60 * 60 * 1000) {
    return "active";
  }

  if (stage === "completed" || stage === "done") {
    return "completed";
  }

  if (stage === "failed" || stage === "error") {
    return "error";
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

  if (params.activeRuntime?.status === "active") {
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
      if (params.runtime.status === "active") {
        return `Tracking task ${params.runtime.taskId.slice(0, 8)}`;
      }

      if (params.runtime.status === "completed") {
        return `Recent task ${params.runtime.taskId.slice(0, 8)} completed`;
      }

      if (params.runtime.status === "error") {
        return `Recent task ${params.runtime.taskId.slice(0, 8)} ended with an error`;
      }

      return `Recent task ${params.runtime.taskId.slice(0, 8)}`;
    }

    return params.runtime.status === "active"
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

function resolveDiagnosticHealth(rpcOk: boolean | undefined, warningCount: number) {
  if (!rpcOk) {
    return "offline";
  }

  if (warningCount > 0) {
    return "degraded";
  }

  return "healthy";
}

function collectIssues(results: {
  gatewayStatus: PromiseSettledResult<GatewayStatusPayload>;
  status: PromiseSettledResult<StatusPayload>;
  agents: PromiseSettledResult<AgentPayload>;
  models: PromiseSettledResult<ModelsPayload>;
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

function resolveWorkspaceRoot() {
  const sharedProjectsRoot = path.join(os.homedir(), "Documents", "Shared", "projects");
  return sharedProjectsRoot;
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
