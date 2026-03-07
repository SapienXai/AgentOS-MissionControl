import "server-only";

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
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
import { detectOpenClaw, runOpenClaw, runOpenClawJson } from "@/lib/openclaw/cli";
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
  const routedMission = outputPlan
    ? composeMissionWithOutputRouting(mission, outputPlan, missionAgent?.policy, setupAgentId)
    : mission;

  const payload = await runOpenClawJson<MissionCommandPayload>([
    "agent",
    "--agent",
    agentId,
    "--message",
    routedMission,
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
    meta: {
      ...(payload.result?.meta ?? {}),
      outputDir: outputPlan?.absoluteOutputDir,
      outputDirRelative: outputPlan?.relativeOutputDir,
      notesDirRelative: outputPlan?.notesDirRelative
    }
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
      items: [],
      createdFiles: [],
      warnings: [],
      warningSummary: null
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
      ],
      createdFiles: [],
      warnings: [],
      warningSummary: null
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
      items: [],
      createdFiles: [],
      warnings: [],
      warningSummary: null
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
      items: [],
      createdFiles: [],
      warnings: [],
      warningSummary: null
    };
  }

  try {
    const raw = await readFile(transcriptPath, "utf8");
    return parseRuntimeOutput(runtime, raw, agent?.workspacePath);
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

  const snapshot = await getMissionControlSnapshot({ force: true });
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

  const snapshot = await getMissionControlSnapshot({ force: true });
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

export async function createWorkspaceProject(input: WorkspaceCreateInput): Promise<WorkspaceCreateResult> {
  const normalized = resolveWorkspaceBootstrapInput(input);
  const targetDir = resolveWorkspaceCreationTargetDir(normalized);
  const snapshot = await getMissionControlSnapshot({ force: true });
  const enabledAgents = normalized.agents.filter((agent) => agent.enabled);

  if (enabledAgents.length === 0) {
    throw new Error("Enable at least one agent for the workspace.");
  }

  assertWorkspaceBootstrapAgentIdsAvailable(snapshot, normalized.slug, enabledAgents);

  await materializeWorkspaceSource({
    targetDir,
    sourceMode: normalized.sourceMode,
    repoUrl: normalized.repoUrl,
    existingPath: normalized.existingPath
  });

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

  const createdAgentIds: string[] = [];

  for (const agent of enabledAgents) {
    const createdAgentId = await createBootstrappedWorkspaceAgent({
      workspacePath: targetDir,
      workspaceSlug: normalized.slug,
      workspaceModelId: normalized.modelId,
      agent
    });
    createdAgentIds.push(createdAgentId);
  }

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
    try {
      const kickoffResult = await runWorkspaceKickoffMission({
        agentId: primaryAgentId,
        brief: normalized.brief,
        modelProfile: normalized.modelProfile,
        template: normalized.template
      });
      kickoffRunId = kickoffResult.runId;
      kickoffStatus = kickoffResult.status;
    } catch (error) {
      kickoffError =
        error instanceof Error ? error.message : "Kickoff mission could not be started.";
    }
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

async function runWorkspaceKickoffMission(params: {
  agentId: string;
  brief?: string;
  modelProfile: WorkspaceModelProfile;
  template: WorkspaceTemplate;
}) {
  const prompt = buildWorkspaceKickoffPrompt(params.template, params.brief);
  const thinking =
    params.modelProfile === "fast"
      ? "low"
      : params.modelProfile === "quality"
        ? "high"
        : "medium";

  return runOpenClawJson<MissionCommandPayload>(
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
    { timeoutMs: 120000 }
  );
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

function resolveWorkspaceCreationTargetDir(input: ResolvedWorkspaceBootstrapInput) {
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
      : path.join(resolveWorkspaceRoot(), input.directory);
  }

  return path.join(resolveWorkspaceRoot(), input.slug);
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

function parseRuntimeOutput(runtime: RuntimeRecord, raw: string, workspacePath?: string): RuntimeOutputRecord {
  const turns = extractTranscriptTurns(raw, runtime, workspacePath);

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
    items: [],
    createdFiles: [],
    warnings: [],
    warningSummary: null
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
  const { pendingCreatedFiles: _pendingCreatedFiles, ...rest } = turn;
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
  const hasWarnings = warnings.length > 0;
  const status =
    hasError
      ? "error"
      : lastItem?.role === "assistant" && lastItem.stopReason && lastItem.stopReason !== "toolUse"
        ? hasWarnings
          ? "partial"
          : "completed"
        : "active";

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
    turn.status === "partial"
      ? summarizeText(turn.warningSummary ? `Completed with fallback: ${turn.warningSummary}` : "Completed with warnings", 90)
      : turn.finalText
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
      historical: turn.status !== "active",
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
      agents
    };
  } catch {
    return {
      template: null,
      sourceMode: null,
      agentTemplate: null,
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
      status: runtime.status === "error" ? "error" : runtime.status === "partial" ? "partial" : "completed",
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

      if (params.runtime.status === "partial") {
        return `Recent task ${params.runtime.taskId.slice(0, 8)} completed with warnings`;
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

function padNumber(value: number) {
  return String(value).padStart(2, "0");
}

function normalizeWorkspaceRelativePath(targetPath: string) {
  return targetPath.split(path.sep).join("/");
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
