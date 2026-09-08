import {
  inferAgentPresetFromContext,
  resolveAgentPolicy
} from "@/lib/openclaw/agent-presets";
import { filterAgentPolicySkills } from "@/lib/openclaw/domains/agent-config";
import {
  normalizeOptionalValue,
  resolveAgentAction,
  resolveAgentStatus,
  unique
} from "@/lib/openclaw/domains/control-plane-normalization";
import { sortRuntimesByUpdatedAtDesc } from "@/lib/openclaw/domains/runtime-history";
import { isAgentChatSessionActive } from "@/lib/openclaw/domains/agent-chat-sessions";
import type {
  AgentConfigPayload,
  AgentPayload
} from "@/lib/openclaw/client/gateway-client";
import type {
  AgentMemorySearchConfig,
  AgentSandboxConfig,
  AgentToolPolicyConfig,
  OpenClawAgent,
  RelationshipRecord,
  RuntimeRecord
} from "@/lib/openclaw/types";
import type { WorkspaceProjectManifestAgent } from "@/lib/openclaw/domains/workspace-manifest";

type AgentIdentityOverrides = {
  name?: string | null;
  emoji?: string | null;
  theme?: string | null;
  avatar?: string | null;
} | null;

const gatewayEventActiveWindowMs = 2 * 60 * 1000;

export type SnapshotAgentEntry = {
  agent: OpenClawAgent;
  workspacePath: string;
  workspaceId: string;
  primaryModel: string;
  sessionCount: number;
  activeRuntimeIds: string[];
  relationships: RelationshipRecord[];
};

export function resolveSnapshotAgentSkills(
  configuredSkills: string[] | undefined,
  manifestSkillIds: string[] | undefined
) {
  return filterAgentPolicySkills(
    configuredSkills === undefined ? manifestSkillIds ?? [] : configuredSkills
  );
}

export function buildSnapshotAgentEntry(input: {
  rawAgent: AgentPayload[number];
  configured: AgentConfigPayload[number] | undefined;
  identityOverrides: AgentIdentityOverrides;
  workspaceId: string;
  sessionList: Array<{ updatedAt?: number | null }>;
  heartbeat?: {
    enabled?: boolean;
    every?: string | null;
    everyMs?: number | null;
  } | null;
  manifestAgent: WorkspaceProjectManifestAgent | null;
  agentRuntimes: RuntimeRecord[];
  gatewayRpcOk: boolean;
  profile: OpenClawAgent["profile"];
}) {
  const configuredSkills = resolveSnapshotAgentSkills(
    input.configured?.skills,
    input.manifestAgent?.skillIds
  );
  const workerProfile = input.manifestAgent?.workerProfile ?? null;
  const agentName = resolveSnapshotAgentDisplayName(
    input.rawAgent.id,
    [
      input.identityOverrides?.name,
      input.configured?.identity?.name,
      input.configured?.name,
      workerProfile?.identity.displayName,
      input.manifestAgent?.name,
      input.rawAgent.identityName,
      input.rawAgent.name,
      input.rawAgent.id
    ],
    {
      workspaceId: input.workspaceId
    }
  );
  const policy =
    input.manifestAgent?.policy ??
    resolveAgentPolicy(
      inferAgentPresetFromContext({
        skills: configuredSkills,
        id: input.rawAgent.id,
        name: agentName
      }),
      {
        fileAccess: input.configured?.tools?.fs?.workspaceOnly ? "workspace-only" : "extended"
      }
    );
  const configuredTools = unique([
    ...(input.manifestAgent?.toolIds ?? []),
    ...(policy.fileAccess === "workspace-only" ? ["fs.workspaceOnly"] : [])
  ]);
  const primaryModel = input.configured?.model || input.manifestAgent?.modelId || input.rawAgent.model || "unassigned";
  const agentRuntimes = input.agentRuntimes.sort(sortRuntimesByUpdatedAtDesc);
  const observedToolNames = unique(agentRuntimes.flatMap((runtime) => runtime.toolNames ?? []));
  const liveRuntimes = agentRuntimes.filter(isCurrentlyActiveRuntime);
  const activeRuntimeIds = liveRuntimes.map((runtime) => runtime.id);
  const latestRuntime = agentRuntimes.find((runtime) => runtime.metadata.origin !== "openclaw-gateway-event");
  const heartbeat = input.heartbeat ?? (
    input.configured?.heartbeat?.every
      ? {
          enabled: true,
          every: input.configured.heartbeat.every,
          everyMs: null
        }
      : null
  );
  const lastActiveAt =
    input.sessionList
      .map((entry) => entry.updatedAt ?? 0)
      .sort((left, right) => right - left)
      .at(0) || null;
  const statusValue = resolveAgentStatus({
    rpcOk: input.gatewayRpcOk,
    activeRuntime: liveRuntimes[0],
    heartbeatEnabled: Boolean(heartbeat?.enabled),
    lastActiveAt
  });
  const profile = mergeWorkerProfileProjection(input.profile, workerProfile, input.configured?.description);

  const agent: OpenClawAgent = {
    id: input.rawAgent.id,
    kind: input.rawAgent.kind,
    createdVia: input.rawAgent.createdVia,
    creatorAgentId: input.rawAgent.creatorAgentId,
    createdAt: input.rawAgent.createdAt,
    name: agentName,
    identityName:
      resolveSnapshotAgentIdentityName(
        input.rawAgent.id,
        [
          input.identityOverrides?.name,
          input.configured?.identity?.name,
          input.rawAgent.identityName,
          workerProfile?.identity.displayName,
          input.manifestAgent?.name
        ],
        {
          workspaceId: input.workspaceId
        }
      ) ||
      undefined,
    workspaceId: input.workspaceId,
    workspacePath: input.rawAgent.workspace,
    agentDir: input.rawAgent.agentDir,
    modelId: primaryModel,
    isDefault: Boolean(input.rawAgent.isDefault || input.configured?.default),
    status: statusValue,
    sessionCount: input.sessionList.length,
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
        normalizeOptionalValue(input.identityOverrides?.emoji) ||
        workerProfile?.identity.emoji ||
        input.manifestAgent?.emoji ||
        input.configured?.identity?.emoji ||
        input.rawAgent.identityEmoji,
      theme:
        normalizeOptionalValue(input.identityOverrides?.theme) ||
        workerProfile?.identity.theme ||
        input.manifestAgent?.theme ||
        input.configured?.identity?.theme,
      avatar:
        normalizeOptionalValue(input.identityOverrides?.avatar) ||
        workerProfile?.identity.avatar ||
        input.configured?.identity?.avatar,
      source: input.rawAgent.identitySource
    },
    profile,
    workerProfile,
    toolPolicy: normalizeAgentToolPolicyConfig(input.configured?.tools),
    sandbox: normalizeAgentSandboxConfig(input.configured?.sandbox),
    memorySearch: normalizeAgentMemorySearchConfig(input.configured?.memorySearch),
    skills: configuredSkills,
    tools: configuredTools,
    observedTools: observedToolNames,
    policy
  };

  const relationships: RelationshipRecord[] = [
    {
      id: `edge:${input.workspaceId}:${agent.id}:contains`,
      sourceId: input.workspaceId,
      targetId: agent.id,
      kind: "contains",
      label: "workspace member"
    },
    {
      id: `edge:${agent.id}:${primaryModel}:model`,
      sourceId: agent.id,
      targetId: primaryModel,
      kind: "uses-model",
      label: "model assignment"
    },
    ...activeRuntimeIds.map((runtimeId) => ({
      id: `edge:${agent.id}:${runtimeId}:run`,
      sourceId: agent.id,
      targetId: runtimeId,
      kind: "active-run" as const,
      label: "runtime"
    }))
  ];

  return {
    agent,
    workspacePath: input.rawAgent.workspace,
    workspaceId: input.workspaceId,
    primaryModel,
    sessionCount: input.sessionList.length,
    activeRuntimeIds,
    relationships
  } satisfies SnapshotAgentEntry;
}

function isCurrentlyActiveRuntime(runtime: RuntimeRecord) {
  if (runtime.metadata.historical === true || (runtime.status !== "running" && runtime.status !== "queued")) {
    return false;
  }

  const runtimeOrigin = typeof runtime.metadata.origin === "string" ? runtime.metadata.origin : "";
  if (runtimeOrigin === "agent-chat") {
    const sessionId =
      typeof runtime.metadata.agentChatSessionId === "string"
        ? runtime.metadata.agentChatSessionId
        : runtime.sessionId;

    return (
      isAgentChatSessionActive({ agentId: runtime.agentId, sessionId })
    );
  }

  if (runtimeOrigin !== "openclaw-gateway-event") {
    return true;
  }

  if (runtime.metadata.gatewayObjectKind === "task" || runtime.taskId) {
    return true;
  }

  return typeof runtime.ageMs === "number" && runtime.ageMs <= gatewayEventActiveWindowMs;
}

function mergeWorkerProfileProjection(
  profile: OpenClawAgent["profile"],
  workerProfile: WorkspaceProjectManifestAgent["workerProfile"],
  configuredDescription?: string
): OpenClawAgent["profile"] {
  const configuredMission = normalizeOptionalValue(configuredDescription);

  if (!workerProfile) {
    return configuredMission ? { ...profile, purpose: configuredMission } : profile;
  }

  const behaviorInstructions = normalizeOptionalValue(workerProfile.employment.behaviorInstructions);

  return {
    ...profile,
    purpose:
      normalizeOptionalValue(workerProfile.employment.mission) ||
      configuredMission ||
      normalizeOptionalValue(workerProfile.employment.role) ||
      profile.purpose,
    operatingInstructions: behaviorInstructions
      ? unique([behaviorInstructions, ...profile.operatingInstructions])
      : profile.operatingInstructions
  };
}

function normalizeAgentToolPolicyConfig(
  value: AgentConfigPayload[number]["tools"]
): AgentToolPolicyConfig | null {
  if (!value) {
    return null;
  }

  const profile =
    value.profile === "minimal" ||
    value.profile === "coding" ||
    value.profile === "messaging" ||
    value.profile === "full"
      ? value.profile
      : undefined;
  const allow = Array.isArray(value.allow) ? unique(value.allow.filter((entry) => typeof entry === "string")) : undefined;
  const deny = Array.isArray(value.deny) ? unique(value.deny.filter((entry) => typeof entry === "string")) : undefined;
  const workspaceOnly = typeof value.fs?.workspaceOnly === "boolean" ? value.fs.workspaceOnly : undefined;

  if (profile === undefined && allow === undefined && deny === undefined && workspaceOnly === undefined) {
    return null;
  }

  return {
    ...(profile ? { profile } : {}),
    ...(allow ? { allow } : {}),
    ...(deny ? { deny } : {}),
    ...(workspaceOnly !== undefined ? { fs: { workspaceOnly } } : {})
  };
}

function normalizeAgentSandboxConfig(
  value: AgentConfigPayload[number]["sandbox"]
): AgentSandboxConfig | null {
  if (!value) {
    return null;
  }

  const mode = value.mode === "off" || value.mode === "non-main" || value.mode === "all" ? value.mode : undefined;
  const scope = value.scope === "session" || value.scope === "agent" || value.scope === "shared" ? value.scope : undefined;
  const workspaceAccess =
    value.workspaceAccess === "none" || value.workspaceAccess === "ro" || value.workspaceAccess === "rw"
      ? value.workspaceAccess
      : undefined;

  if (mode === undefined && scope === undefined && workspaceAccess === undefined) {
    return null;
  }

  return {
    ...(mode ? { mode } : {}),
    ...(scope ? { scope } : {}),
    ...(workspaceAccess ? { workspaceAccess } : {})
  };
}

function normalizeAgentMemorySearchConfig(
  value: AgentConfigPayload[number]["memorySearch"]
): AgentMemorySearchConfig | null {
  if (!value) {
    return null;
  }

  const enabled = typeof value.enabled === "boolean" ? value.enabled : undefined;
  const sources = Array.isArray(value.sources)
    ? Array.from(new Set(value.sources.filter((source): source is "memory" | "sessions" => source === "memory" || source === "sessions")))
    : undefined;

  if (enabled === undefined && sources === undefined) {
    return null;
  }

  return {
    ...(enabled !== undefined ? { enabled } : {}),
    ...(sources !== undefined ? { sources } : {})
  };
}

export function resolveSnapshotAgentDisplayName(
  agentId: string,
  candidates: Array<string | null | undefined>,
  options: {
    workspaceId?: string | null;
  } = {}
) {
  const idLikeName = candidates
    .map((candidate) => normalizeOptionalValue(candidate))
    .find((candidate) => candidate && isAgentIdLikeDisplayName(agentId, candidate));
  const displayName = candidates
    .map((candidate) => normalizeOptionalValue(candidate))
    .find((candidate) => candidate && !isAgentIdLikeDisplayName(agentId, candidate));

  return displayName ?? inferScopedAgentDisplayName(agentId, options.workspaceId) ?? idLikeName ?? agentId;
}

function resolveSnapshotAgentIdentityName(
  agentId: string,
  candidates: Array<string | null | undefined>,
  options: {
    workspaceId?: string | null;
  } = {}
) {
  const displayName = candidates
    .map((candidate) => normalizeOptionalValue(candidate))
    .find((candidate) => candidate && !isAgentIdLikeDisplayName(agentId, candidate));

  return displayName ?? inferScopedAgentDisplayName(agentId, options.workspaceId) ?? null;
}

function isAgentIdLikeDisplayName(agentId: string, value: string) {
  const normalizedId = slugifyAgentName(agentId);
  const normalizedValue = slugifyAgentName(value);

  return Boolean(normalizedId && normalizedValue && normalizedId === normalizedValue);
}

function slugifyAgentName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function inferScopedAgentDisplayName(agentId: string, workspaceId: string | null | undefined) {
  const normalizedWorkspaceId = normalizeOptionalValue(workspaceId);

  if (!normalizedWorkspaceId) {
    return null;
  }

  const prefix = `${normalizedWorkspaceId}-`;

  if (!agentId.startsWith(prefix)) {
    return null;
  }

  const localId = agentId.slice(prefix.length);
  const words = localId
    .split(/[-_\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (words.length === 0) {
    return null;
  }

  return words
    .map((word) => word.length <= 2 ? word.toUpperCase() : word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}
