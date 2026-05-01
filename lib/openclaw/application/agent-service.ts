import "server-only";

import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_AGENT_PRESET,
  filterKnownOpenClawSkillIds,
  filterKnownOpenClawToolIds,
  formatAgentPresetLabel,
  getAgentPresetMeta,
  resolveAgentPolicy
} from "@/lib/openclaw/agent-presets";
import {
  resolveHeartbeatDraft,
  serializeHeartbeatConfig
} from "@/lib/openclaw/agent-heartbeat";
import { parseAgentIdentityMarkdown } from "@/lib/openclaw/agent-bootstrap-files";
import { getOpenClawGatewayClient } from "@/lib/openclaw/client/gateway-client-factory";
import {
  clearMissionControlRuntimeHistoryCache,
  getMissionControlSnapshot,
  invalidateMissionControlSnapshotCache
} from "@/lib/openclaw/application/mission-control-service";
import {
  applyAgentIdentity,
  buildAgentPolicySkillId,
  buildWorkspaceAgentStatePath,
  filterAgentPolicySkills,
  mapAgentHeartbeatToInput,
  normalizeDeclaredAgentTools,
  readAgentConfigList,
  upsertAgentConfigEntry,
  writeAgentBootstrapFiles,
  writeAgentConfigList
} from "@/lib/openclaw/domains/agent-config";
import {
  ensureAgentPolicySkill as ensureAgentPolicySkillFromProvisioning,
  ensureWorkspaceSkillMarkdown as ensureWorkspaceSkillMarkdownFromProvisioning
} from "@/lib/openclaw/domains/agent-provisioning";
import {
  parseWorkspaceProjectManifestAgent,
  type WorkspaceProjectManifestAgent
} from "@/lib/openclaw/domains/workspace-manifest";
import { normalizeOptionalValue } from "@/lib/openclaw/domains/control-plane-normalization";
import { writeTextFileEnsured } from "@/lib/openclaw/domains/workspace-bootstrap";
import type {
  AgentCreateInput,
  AgentDeleteInput,
  AgentPolicy,
  AgentUpdateInput,
  MissionControlSnapshot,
  OpenClawAgent
} from "@/lib/openclaw/types";

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
  const presetSkillIds = filterKnownOpenClawSkillIds(presetMeta.skillIds);
  const presetToolIds = filterKnownOpenClawToolIds(presetMeta.tools);
  const bootstrapFiles = input.bootstrapFiles ?? [];
  const bootstrapFileMap = new Map(bootstrapFiles.map((entry) => [entry.path, entry.content] as const));
  const identityMarkdown = bootstrapFileMap.get("IDENTITY.md") ?? null;
  const parsedIdentity = identityMarkdown ? parseAgentIdentityMarkdown(identityMarkdown) : null;
  const displayName =
    normalizeOptionalValue(parsedIdentity?.name) ??
    normalizeOptionalValue(input.name) ??
    presetMeta.defaultName;
  const emoji =
    normalizeOptionalValue(parsedIdentity?.emoji) ??
    normalizeOptionalValue(input.emoji) ??
    presetMeta.defaultEmoji;
  const theme =
    normalizeOptionalValue(parsedIdentity?.theme) ??
    normalizeOptionalValue(input.theme) ??
    presetMeta.defaultTheme;
  const avatar = normalizeOptionalValue(parsedIdentity?.avatar) ?? normalizeOptionalValue(input.avatar);
  const heartbeat = serializeHeartbeatConfig(resolveHeartbeatDraft(policy.preset, input.heartbeat));
  const setupAgentId =
    snapshot.agents.find((entry) => entry.workspaceId === resolvedWorkspaceId && entry.policy.preset === "setup")?.id ?? null;
  const agentDir = buildWorkspaceAgentStatePath(resolvedWorkspacePath, agentId);
  const requestedModelId = normalizeOptionalValue(input.modelId);
  const agentModelId = requestedModelId ?? resolveSnapshotDefaultAgentModelId(snapshot);

  await getOpenClawGatewayClient().addAgent({
    id: agentId,
    workspace: resolvedWorkspacePath,
    agentDir,
    model: agentModelId
  });

  const policySkillId = await ensureAgentPolicySkillFromProvisioning({
    workspacePath: resolvedWorkspacePath,
    agentId,
    agentName: displayName,
    policy,
    setupAgentId,
    snapshot
  });
  for (const skillId of presetSkillIds) {
    await ensureWorkspaceSkillMarkdownFromProvisioning(resolvedWorkspacePath, skillId);
  }

  const configEntry = await upsertAgentConfigEntry(
    agentId,
    resolvedWorkspacePath,
    {
      name: displayName,
      model: agentModelId,
      heartbeat,
      skills: uniqueStrings([...presetSkillIds, policySkillId]),
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
    avatar,
    content: identityMarkdown ?? undefined
  }, agentDir);

  const bootstrapFilesToWrite = bootstrapFiles.filter((entry) => entry.path !== "IDENTITY.md");

  if (bootstrapFilesToWrite.length > 0) {
    await writeAgentBootstrapFiles(agentId, resolvedWorkspacePath, bootstrapFilesToWrite, agentDir);
  }

  await upsertWorkspaceProjectAgentMetadata(resolvedWorkspacePath, {
    id: agentId,
    name: displayName,
    role: formatAgentPresetLabel(policy.preset),
    emoji,
    theme,
    enabled: true,
    skillId: presetSkillIds[0] ?? policySkillId,
    toolIds: presetToolIds,
    modelId: agentModelId,
    isPrimary: false,
    policy,
    channelIds: input.channelIds ?? []
  });

  invalidateMissionControlSnapshotCache();
  await syncWorkspaceAgentPolicySkills(resolvedWorkspacePath);

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
  const presetMeta = getAgentPresetMeta(policy.preset);
  const presetSkillIds = filterKnownOpenClawSkillIds(presetMeta.skillIds);
  const presetToolIds = filterKnownOpenClawToolIds(presetMeta.tools);
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
  const nextModelId =
    input.modelId !== undefined
      ? normalizeOptionalValue(input.modelId)
      : agent.modelId === "unassigned"
        ? resolveSnapshotDefaultAgentModelId(snapshot)
        : agent.modelId;
  const onlyModelChanged =
    input.modelId !== undefined &&
    input.name === undefined &&
    input.emoji === undefined &&
    input.theme === undefined &&
    input.avatar === undefined &&
    input.policy === undefined &&
    input.heartbeat === undefined &&
    input.channelIds === undefined &&
    input.skills === undefined &&
    input.tools === undefined;

  if (onlyModelChanged) {
    await upsertAgentConfigEntry(
      agentId,
      resolvedWorkspacePath,
      {
        model: nextModelId
      },
      snapshot
    );

    await upsertWorkspaceProjectAgentMetadata(resolvedWorkspacePath, {
      id: agentId,
      name: currentName ?? agent.name ?? agentId,
      emoji: currentEmoji,
      theme: currentTheme,
      enabled: true,
      modelId: nextModelId,
      isPrimary: agent.isDefault,
      policy
    });

    invalidateMissionControlSnapshotCache();

    return {
      agentId,
      workspaceId: resolvedWorkspaceId
    };
  }

  const policySkillId = await ensureAgentPolicySkillFromProvisioning({
    workspacePath: resolvedWorkspacePath,
    agentId,
    agentName: normalizeOptionalValue(input.name) ?? currentName ?? agentId,
    policy,
    setupAgentId,
    snapshot
  });
  const currentDeclaredSkills = filterAgentPolicySkills(agent.skills);
  const currentDeclaredTools = normalizeDeclaredAgentTools(agent.tools);
  const shouldResetSkills = policy.preset !== agent.policy.preset || currentDeclaredSkills.length === 0;
  const shouldResetTools = policy.preset !== agent.policy.preset || currentDeclaredTools.length === 0;
  const nextDeclaredSkills =
    input.skills === undefined
      ? shouldResetSkills
        ? presetSkillIds
        : currentDeclaredSkills
      : filterKnownOpenClawSkillIds(filterAgentPolicySkills(input.skills));
  for (const skillId of nextDeclaredSkills) {
    await ensureWorkspaceSkillMarkdownFromProvisioning(resolvedWorkspacePath, skillId);
  }

  const configEntry = await upsertAgentConfigEntry(
    agentId,
    resolvedWorkspacePath,
    {
      name: normalizeOptionalValue(input.name),
      model: nextModelId,
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
    input.tools === undefined
      ? shouldResetTools
        ? presetToolIds
        : undefined
      : normalizeDeclaredAgentTools(input.tools);

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
    modelId: nextModelId,
    isPrimary: agent.isDefault,
    policy,
    channelIds: input.channelIds,
    skillId: nextDeclaredSkills[0] ?? policySkillId,
    toolIds: nextDeclaredTools
  });

  invalidateMissionControlSnapshotCache();
  await syncWorkspaceAgentPolicySkills(resolvedWorkspacePath);

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

  await getOpenClawGatewayClient().deleteAgent(agent.id);

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

    invalidateMissionControlSnapshotCache();
    await syncWorkspaceAgentPolicySkills(workspace.path);
  }

  clearMissionControlRuntimeHistoryCache();

  return {
    agentId: agent.id,
    workspaceId: agent.workspaceId,
    workspacePath: agent.workspacePath,
    deletedRuntimeCount: runtimeCount
  };
}

function resolveSnapshotDefaultAgentModelId(snapshot: MissionControlSnapshot) {
  if (!snapshot.diagnostics.modelReadiness.defaultModelReady) {
    return undefined;
  }

  return (
    normalizeOptionalValue(snapshot.diagnostics.modelReadiness.resolvedDefaultModel) ??
    normalizeOptionalValue(snapshot.diagnostics.modelReadiness.defaultModel) ??
    undefined
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

function describeAgentWorkspace(
  snapshot: MissionControlSnapshot,
  agent: Pick<OpenClawAgent, "workspaceId" | "workspacePath">
) {
  return (
    snapshot.workspaces.find((workspace) => workspace.id === agent.workspaceId)?.name ??
    path.basename(agent.workspacePath)
  );
}

async function syncAgentPolicySkills(agentIds: string[], snapshot?: MissionControlSnapshot) {
  const relevantAgentIds = uniqueStrings(agentIds);

  if (relevantAgentIds.length === 0) {
    return;
  }

  const nextSnapshot = snapshot ?? (await getMissionControlSnapshot({ includeHidden: true }));

  for (const agentId of relevantAgentIds) {
    const agent = nextSnapshot.agents.find((entry) => entry.id === agentId);

    if (!agent) {
      continue;
    }

    const setupAgentId =
      nextSnapshot.agents.find(
        (entry) => entry.workspaceId === agent.workspaceId && entry.policy.preset === "setup" && entry.id !== agent.id
      )?.id ?? null;

    const policySkillId = await ensureAgentPolicySkillFromProvisioning({
      workspacePath: agent.workspacePath,
      agentId: agent.id,
      agentName: agent.name,
      policy: agent.policy,
      setupAgentId,
      snapshot: nextSnapshot
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

async function syncWorkspaceAgentPolicySkills(workspacePath: string, snapshot?: MissionControlSnapshot) {
  const nextSnapshot = snapshot ?? (await getMissionControlSnapshot({ includeHidden: true }));
  const agentIds = nextSnapshot.agents
    .filter((entry) => entry.workspacePath === workspacePath)
    .map((entry) => entry.id);

  await syncAgentPolicySkills(agentIds, nextSnapshot);
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

function workspaceIdFromPath(workspacePath: string) {
  const hash = createHash("sha1").update(workspacePath).digest("hex").slice(0, 8);
  return `workspace:${hash}`;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
