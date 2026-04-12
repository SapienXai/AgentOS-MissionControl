import type { AgentHeartbeatDraft } from "@/lib/openclaw/agent-heartbeat";
import {
  applyPresetHeartbeat,
  defaultHeartbeatForPreset,
  resolveHeartbeatDraft
} from "@/lib/openclaw/agent-heartbeat";
import { getAgentPresetMeta, resolveAgentPolicy } from "@/lib/openclaw/agent-presets";
import type { AgentPolicy, AgentPreset, MissionControlSnapshot } from "@/lib/agentos/contracts";

export type AgentDraft = {
  workspaceId: string;
  modelId: string;
  name: string;
  emoji: string;
  theme: string;
  avatar: string;
  policy: AgentPolicy;
  heartbeat: AgentHeartbeatDraft;
  channelIds: string[];
};

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
    policy,
    heartbeat,
    channelIds: Array.from(
      new Set(
        (seed.channelIds ?? []).filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
      )
    )
  };
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
    policy: nextPolicy,
    heartbeat: applyPresetHeartbeat(draft.heartbeat, draft.policy.preset, preset)
  };
}

export { defaultHeartbeatForPreset };
