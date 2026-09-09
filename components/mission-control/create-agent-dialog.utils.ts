import type { AgentHeartbeatDraft } from "@/lib/openclaw/agent-heartbeat";
import {
  applyPresetHeartbeat,
  defaultHeartbeatForPreset,
  resolveHeartbeatDraft
} from "@/lib/openclaw/agent-heartbeat";
import {
  AGENT_BOOTSTRAP_FILE_OPTIONS,
  buildAgentBootstrapFileDrafts,
  rebaseAgentBootstrapFileDrafts,
  type AgentBootstrapFileDraft
} from "@/lib/openclaw/agent-bootstrap-files";
import { getAgentPresetMeta, resolveAgentPolicy } from "@/lib/openclaw/agent-presets";
import type { AgentPolicy, AgentPreset, MissionControlSnapshot } from "@/lib/agentos/contracts";

export type AgentDraft = {
  workspaceId: string;
  modelId: string;
  name: string;
  emoji: string;
  theme: string;
  avatar: string;
  role: string;
  mission: string;
  behaviorInstructions: string;
  labels: string[];
  policy: AgentPolicy;
  heartbeat: AgentHeartbeatDraft;
  channelIds: string[];
  skills: string[];
  tools: string[];
};

export type {
  AgentBootstrapFileDraft,
  AgentBootstrapFileKind,
  AgentBootstrapFilePath
} from "@/lib/openclaw/agent-bootstrap-files";

export { AGENT_BOOTSTRAP_FILE_OPTIONS };

export function buildAgentDraft(workspaceId: string, seed: Partial<AgentDraft> = {}): AgentDraft {
  const policy = resolveAgentPolicy(seed.policy?.preset ?? "worker", seed.policy);
  const presetMeta = getAgentPresetMeta(policy.preset);
  const heartbeat = resolveHeartbeatDraft(policy.preset, seed.heartbeat);

  return {
    workspaceId,
    modelId: seed.modelId ?? "",
    name: seed.name ?? presetMeta.defaultName,
    emoji: seed.emoji ?? presetMeta.defaultEmoji,
    theme: seed.theme ?? presetMeta.defaultTheme,
    avatar: seed.avatar ?? "",
    role: seed.role ?? presetMeta.label,
    mission: seed.mission ?? "",
    behaviorInstructions: seed.behaviorInstructions ?? "",
    labels: Array.from(new Set((seed.labels ?? []).map((entry) => entry.trim()).filter(Boolean))),
    policy,
    heartbeat,
    channelIds: Array.from(
      new Set(
        (seed.channelIds ?? []).filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
      )
    ),
    skills: normalizeDraftCapabilityIds(seed.skills ?? presetMeta.skillIds, "skill"),
    tools: normalizeDraftCapabilityIds(seed.tools ?? presetMeta.tools, "tool")
  };
}

export function resolveSuggestedAgentModelId(
  snapshot: Pick<MissionControlSnapshot, "agents" | "diagnostics" | "models">,
  workspaceId?: string | null
) {
  const defaultModel = snapshot.diagnostics.modelReadiness.defaultModelReady
    ? normalizeModelId(
        snapshot.diagnostics.modelReadiness.resolvedDefaultModel ||
        snapshot.diagnostics.modelReadiness.defaultModel
      )
    : null;

  if (defaultModel && isSnapshotModelUsable(snapshot, defaultModel)) {
    return defaultModel;
  }

  const workspaceModel = snapshot.agents
    .filter((agent) => !workspaceId || agent.workspaceId === workspaceId)
    .map((agent) => normalizeModelId(agent.modelId))
    .find((modelId) => modelId && isSnapshotModelUsable(snapshot, modelId));

  if (workspaceModel) {
    return workspaceModel;
  }

  const recommendedModel = normalizeModelId(snapshot.diagnostics.modelReadiness.recommendedModelId);

  if (recommendedModel && isSnapshotModelUsable(snapshot, recommendedModel)) {
    return recommendedModel;
  }

  return snapshot.models
    .map((model) => normalizeModelId(model.id))
    .find((modelId) => modelId && isSnapshotModelUsable(snapshot, modelId)) ?? "";
}

function normalizeModelId(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized && normalized !== "unassigned" ? normalized : null;
}

export function isSnapshotModelUsable(
  snapshot: Pick<MissionControlSnapshot, "models">,
  modelId: string
) {
  const model = snapshot.models.find((entry) => entry.id === modelId);

  if (!model) {
    return false;
  }

  return model.missing !== true && model.available !== false;
}

export function buildUniqueAgentId(
  agents: MissionControlSnapshot["agents"],
  workspaceSlug: string | undefined,
  agentName: string
) {
  const baseId = buildScopedAgentId(workspaceSlug, agentName);

  if (!baseId) {
    return "";
  }

  const existingAgentIds = new Set(agents.map((agent) => agent.id));

  if (!existingAgentIds.has(baseId)) {
    return baseId;
  }

  let suffix = 2;
  let candidate = `${baseId}-${suffix}`;

  while (existingAgentIds.has(candidate)) {
    suffix += 1;
    candidate = `${baseId}-${suffix}`;
  }

  return candidate;
}

export function buildScopedAgentId(workspaceSlug: string | undefined, agentName: string) {
  const normalizedWorkspaceSlug = slugify(workspaceSlug ?? "");
  const normalizedAgentName = slugify(agentName) || "agent";

  return normalizedWorkspaceSlug ? `${normalizedWorkspaceSlug}-${normalizedAgentName}` : normalizedAgentName;
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function applyAgentPreset(draft: AgentDraft, preset: AgentPreset): AgentDraft {
  const previousMeta = getAgentPresetMeta(draft.policy.preset);
  const nextMeta = getAgentPresetMeta(preset);
  const nextPolicy = resolveAgentPolicy(preset);

  return {
    ...draft,
    name: !draft.name || draft.name === previousMeta.defaultName ? nextMeta.defaultName : draft.name,
    emoji: !draft.emoji || draft.emoji === previousMeta.defaultEmoji ? nextMeta.defaultEmoji : draft.emoji,
    theme: !draft.theme || draft.theme === previousMeta.defaultTheme ? nextMeta.defaultTheme : draft.theme,
    role: !draft.role || draft.role === previousMeta.label ? nextMeta.label : draft.role,
    policy: nextPolicy,
    heartbeat: applyPresetHeartbeat(draft.heartbeat, draft.policy.preset, preset),
    skills: [...nextMeta.skillIds],
    tools: [...nextMeta.tools]
  };
}

export function normalizeAgentDraftCapabilities(
  skills: string[],
  tools: string[]
) {
  return {
    skills: normalizeDraftCapabilityIds(skills, "skill"),
    tools: normalizeDraftCapabilityIds(tools, "tool")
  };
}

function normalizeDraftCapabilityIds(values: string[], kind: "skill" | "tool") {
  return Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter((value) => {
          if (!value) {
            return false;
          }

          if (kind === "skill") {
            return !/^agent-policy-/i.test(value);
          }

          return value !== "fs.workspaceOnly";
        })
    )
  );
}

export { defaultHeartbeatForPreset };

export function buildAgentBootstrapFileDraftsForDraft(
  draft: Pick<AgentDraft, "name" | "emoji" | "theme" | "avatar" | "policy" | "heartbeat">
) {
  return buildAgentBootstrapFileDrafts({
    name: draft.name,
    emoji: draft.emoji,
    theme: draft.theme,
    avatar: draft.avatar,
    preset: draft.policy.preset
  });
}

export function rebaseAgentBootstrapFilesForDraft(
  currentFiles: AgentBootstrapFileDraft[],
  draft: Pick<AgentDraft, "name" | "emoji" | "theme" | "avatar" | "policy" | "heartbeat">
) {
  return rebaseAgentBootstrapFileDrafts(currentFiles, buildAgentBootstrapFileDraftsForDraft(draft));
}
