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
import type {
  AgentConfigPayload,
  AgentPayload
} from "@/lib/openclaw/client/gateway-client";
import type {
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

export type SnapshotAgentEntry = {
  agent: OpenClawAgent;
  workspacePath: string;
  workspaceId: string;
  primaryModel: string;
  sessionCount: number;
  activeRuntimeIds: string[];
  relationships: RelationshipRecord[];
};

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
  const configuredSkills = filterAgentPolicySkills(input.configured?.skills ?? []);
  const agentName =
    normalizeOptionalValue(input.identityOverrides?.name) ||
    input.configured?.name ||
    input.rawAgent.name ||
    input.configured?.identity?.name ||
    input.rawAgent.identityName ||
    input.rawAgent.id;
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
  const primaryModel = input.rawAgent.model || input.configured?.model || "unassigned";
  const agentRuntimes = input.agentRuntimes.sort(sortRuntimesByUpdatedAtDesc);
  const observedToolNames = unique(agentRuntimes.flatMap((runtime) => runtime.toolNames ?? []));
  const activeRuntimeIds = agentRuntimes.map((runtime) => runtime.id);
  const latestRuntime = agentRuntimes[0];
  const lastActiveAt =
    input.sessionList
      .map((entry) => entry.updatedAt ?? 0)
      .sort((left, right) => right - left)
      .at(0) || null;
  const statusValue = resolveAgentStatus({
    rpcOk: input.gatewayRpcOk,
    activeRuntime: latestRuntime,
    heartbeatEnabled: Boolean(input.heartbeat?.enabled),
    lastActiveAt
  });

  const agent: OpenClawAgent = {
    id: input.rawAgent.id,
    name: agentName,
    identityName:
      normalizeOptionalValue(input.identityOverrides?.name) ||
      input.configured?.identity?.name ||
      input.rawAgent.identityName ||
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
      heartbeatEvery: input.heartbeat?.every ?? null,
      status: statusValue
    }),
    activeRuntimeIds,
    heartbeat: {
      enabled: Boolean(input.heartbeat?.enabled),
      every: input.heartbeat?.every ?? null,
      everyMs: input.heartbeat?.everyMs ?? null
    },
    identity: {
      emoji:
        normalizeOptionalValue(input.identityOverrides?.emoji) ||
        input.configured?.identity?.emoji ||
        input.rawAgent.identityEmoji,
      theme: normalizeOptionalValue(input.identityOverrides?.theme) || input.configured?.identity?.theme,
      avatar: normalizeOptionalValue(input.identityOverrides?.avatar) || input.configured?.identity?.avatar,
      source: input.rawAgent.identitySource
    },
    profile: input.profile,
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
