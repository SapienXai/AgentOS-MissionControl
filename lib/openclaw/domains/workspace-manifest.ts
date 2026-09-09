import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  parseAgentOSWorkerProfile,
  mergeAgentOSWorkerProfile,
  type AgentOSWorkerProfile
} from "@/lib/agentos/worker-profile";
import {
  isAgentFileAccess,
  isAgentInstallScope,
  isAgentMissingToolBehavior,
  isAgentNetworkAccess,
  isAgentPreset
} from "@/lib/openclaw/agent-presets";
import {
  legacyWorkspaceMaterializationFromFields,
  materializationToLegacyWorkspaceFields,
  normalizeWorkspaceMaterialization,
  type WorkspaceMaterialization
} from "@/lib/agentos/domains/workspace-materialization";
import {
  legacyPlannerContextSourceToKnowledgeSource,
  normalizeWorkspaceKnowledgeSources,
  type WorkspaceKnowledgeSource
} from "@/lib/agentos/domains/workspace-knowledge";
import { DEFAULT_WORKSPACE_RULES } from "@/lib/openclaw/workspace-presets";
import type {
  AgentPolicy,
  ChannelRegistry,
  PlannerContextSource,
  WorkspaceChannelGroupAssignment,
  WorkspaceChannelSummary,
  WorkspaceChannelWorkspaceBinding,
  WorkspaceCreateRules,
  WorkspaceModelProfile,
  WorkspaceSourceMode,
  WorkspaceTeamPreset,
  WorkspaceTemplate
} from "@/lib/openclaw/types";

const RECENT_MANIFEST_AGENT_PRUNE_GRACE_MS = 10 * 60 * 1000;

export type WorkspaceProjectManifestAgent = {
  id: string;
  name: string | null;
  role: string | null;
  isPrimary: boolean;
  skillId: string | null;
  skillIds: string[];
  toolIds: string[];
  modelId: string | null;
  enabled: boolean;
  policy: AgentPolicy | null;
  emoji: string | null;
  theme: string | null;
  channelIds: string[];
  workerProfile?: AgentOSWorkerProfile | null;
};

export type WorkspaceProjectManifest = {
  version: 2;
  name: string | null;
  directory: string | null;
  template: WorkspaceTemplate | null;
  materialization: WorkspaceMaterialization | null;
  knowledgeSources: WorkspaceKnowledgeSource[];
  /** Deprecated projections retained only for older read consumers. */
  sourceMode: WorkspaceSourceMode | null;
  agentTemplate: string | null;
  teamPreset: WorkspaceTeamPreset | null;
  modelProfile: WorkspaceModelProfile | null;
  rules: WorkspaceCreateRules | null;
  hidden: boolean;
  systemTag: string | null;
  agents: WorkspaceProjectManifestAgent[];
  channels: WorkspaceChannelSummary[];
  contextSources: PlannerContextSource[];
};

type WorkspaceProjectManifestChannel = WorkspaceChannelSummary;

function normalizeOptionalValue(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function readWorkspaceProjectManifest(
  workspacePath: string
): Promise<WorkspaceProjectManifest> {
  const projectFilePath = path.join(workspacePath, ".openclaw", "project.json");

  try {
    const raw = await readFile(projectFilePath, "utf8");
    const candidate = JSON.parse(raw);
    return normalizeWorkspaceProjectManifestRecord(isObjectRecord(candidate) ? candidate : {});
  } catch {
    return normalizeWorkspaceProjectManifestRecord({
      version: 2,
      materialization: null,
      knowledgeSources: [],
      agents: [],
      channels: []
    });
  }
}

/** Read V1 and V2 without rewriting the project file. */
export function normalizeWorkspaceProjectManifestRecord(value: unknown): WorkspaceProjectManifest {
  const parsed = isObjectRecord(value) ? value : {};
  let materialization: WorkspaceMaterialization | null = null;

  try {
    if (parsed.materialization !== undefined && parsed.materialization !== null) {
      materialization = normalizeWorkspaceMaterialization(parsed.materialization);
    } else if (parsed.materialization === undefined && (parsed.sourceMode !== undefined || parsed.repoUrl !== undefined || parsed.existingPath !== undefined)) {
      materialization = legacyWorkspaceMaterializationFromFields({
        sourceMode: isWorkspaceSourceMode(parsed.sourceMode) ? parsed.sourceMode : undefined,
        repoUrl: typeof parsed.repoUrl === "string" ? parsed.repoUrl : undefined,
        existingPath: typeof parsed.existingPath === "string" ? parsed.existingPath : undefined,
        directory: typeof parsed.directory === "string" ? parsed.directory : undefined
      });
    }
  } catch {
    materialization = null;
  }

  const legacySources = parseWorkspaceProjectManifestContextSources(parsed.contextSources);
  let knowledgeSources: WorkspaceKnowledgeSource[] = [];
  try {
    knowledgeSources = Array.isArray(parsed.knowledgeSources)
      ? normalizeWorkspaceKnowledgeSources(parsed.knowledgeSources)
      : legacySources.map((source) => legacyPlannerContextSourceToKnowledgeSource(source));
  } catch {
    knowledgeSources = [];
  }
  const legacyMaterialization = materialization
    ? materializationToLegacyWorkspaceFields(materialization)
    : { sourceMode: null, repoUrl: undefined, existingPath: undefined };
  const agents = Array.isArray(parsed.agents)
    ? parsed.agents.map((entry) => parseWorkspaceProjectManifestAgent(entry)).filter((entry): entry is WorkspaceProjectManifestAgent => Boolean(entry))
    : [];
  const channels = Array.isArray(parsed.channels)
    ? parsed.channels.map((entry) => parseWorkspaceProjectManifestChannel(entry)).filter((entry): entry is WorkspaceChannelSummary => Boolean(entry))
    : [];

  return {
    version: 2,
    name: typeof parsed.name === "string" ? parsed.name : null,
    directory: typeof parsed.directory === "string" ? parsed.directory : null,
    template: isWorkspaceTemplate(parsed.template) ? parsed.template : null,
    materialization,
    knowledgeSources,
    sourceMode: legacyMaterialization.sourceMode ?? (isWorkspaceSourceMode(parsed.sourceMode) ? parsed.sourceMode : null),
    agentTemplate: typeof parsed.agentTemplate === "string" ? parsed.agentTemplate : null,
    teamPreset: isWorkspaceTeamPreset(parsed.teamPreset) ? parsed.teamPreset : null,
    modelProfile: isWorkspaceModelProfile(parsed.modelProfile) ? parsed.modelProfile : null,
    rules: parseWorkspaceCreateRules(parsed.rules),
    hidden: parsed.hidden === true,
    systemTag: typeof parsed.systemTag === "string" ? parsed.systemTag : null,
    contextSources: knowledgeSources.map((source) => knowledgeSourceToLegacyPlannerContextSource(source)),
    agents,
    channels: channels
  };
}

/** Serialize canonical V2 metadata while preserving unrelated and unknown fields. */
export function serializeWorkspaceProjectManifestRecord(
  value: unknown,
  updates: {
    materialization?: WorkspaceMaterialization | null;
    knowledgeSources?: WorkspaceKnowledgeSource[];
    [key: string]: unknown;
  } = {}
) {
  const existing = isObjectRecord(value) ? { ...value } : {};
  const normalized = normalizeWorkspaceProjectManifestRecord(existing);
  const next: Record<string, unknown> = {
    ...existing,
    version: 2,
    materialization: updates.materialization !== undefined
      ? (updates.materialization === null ? null : normalizeWorkspaceMaterialization(updates.materialization))
      : normalized.materialization ?? { mode: "empty" },
    knowledgeSources: updates.knowledgeSources !== undefined ? normalizeWorkspaceKnowledgeSources(updates.knowledgeSources) : normalized.knowledgeSources
  };

  delete next.sourceMode;
  delete next.repoUrl;
  delete next.existingPath;
  delete next.contextSources;

  for (const [key, update] of Object.entries(updates)) {
    if (key !== "materialization" && key !== "knowledgeSources" && update !== undefined) {
      next[key] = update;
    }
  }

  return next;
}

function knowledgeSourceToLegacyPlannerContextSource(source: WorkspaceKnowledgeSource): PlannerContextSource {
  const url = source.locator.kind === "website"
    ? source.locator.url
    : source.locator.kind === "repository"
      ? source.locator.remoteUrl ?? source.locator.localPath
      : source.locator.kind === "file" || source.locator.kind === "folder"
        ? source.locator.path
        : undefined;
  return {
    id: source.id,
    kind: source.kind === "repository" ? "repo" : source.kind === "file" || source.kind === "connector" ? "prompt" : source.kind,
    label: source.label,
    summary: source.summary,
    details: source.details,
    status: source.status,
    createdAt: source.createdAt,
    ...(source.confidence !== undefined ? { confidence: source.confidence } : {}),
    ...(url ? { url } : {}),
    ...(source.error ? { error: source.error } : {})
  };
}

/**
 * Persists the AgentOS worker-profile projection without putting agent
 * persona/policy content into the shared OpenClaw AGENTS.md context file.
 */
export async function updateWorkspaceProjectManifestAgentProfile(
  workspacePath: string,
  agentId: string,
  behaviorInstructions: string
) {
  const projectFilePath = path.join(workspacePath, ".openclaw", "project.json");
  const raw = await readFile(projectFilePath, "utf8");
  const candidate = JSON.parse(raw);
  const parsed = isObjectRecord(candidate) ? candidate : {};

  if (!Array.isArray(parsed.agents)) {
    throw new Error("Workspace project manifest does not contain agents.");
  }

  const agent = parsed.agents.find(
    (entry): entry is Record<string, unknown> => isObjectRecord(entry) && entry.id === agentId
  );

  if (!agent) {
    throw new Error("Agent was not found in the workspace project manifest.");
  }

  const currentProfile = parseAgentOSWorkerProfile(agent.workerProfile, {
    name: typeof agent.name === "string" ? agent.name : null,
    role: typeof agent.role === "string" ? agent.role : null,
    emoji: typeof agent.emoji === "string" ? agent.emoji : null,
    theme: typeof agent.theme === "string" ? agent.theme : null
  });
  const normalizedBehavior = behaviorInstructions.trim();
  const workerProfile = currentProfile
    ? {
        ...currentProfile,
        employment: {
          ...currentProfile.employment,
          behaviorInstructions: normalizedBehavior || null
        }
      }
    : mergeAgentOSWorkerProfile(
        null,
        {
          schemaVersion: 1,
          employment: {
            behaviorInstructions: normalizedBehavior || null
          }
        },
        {
          name: typeof agent.name === "string" ? agent.name : null,
          role: typeof agent.role === "string" ? agent.role : null,
          emoji: typeof agent.emoji === "string" ? agent.emoji : null,
          theme: typeof agent.theme === "string" ? agent.theme : null
        }
      );

  agent.workerProfile = workerProfile;
  const serialized = serializeWorkspaceProjectManifestRecord(parsed, {
    updatedAt: new Date().toISOString(),
    agents: parsed.agents
  });
  await writeFile(projectFilePath, `${JSON.stringify(serialized, null, 2)}\n`, "utf8");

  return readWorkspaceProjectManifest(workspacePath);
}

export async function reconcileWorkspaceProjectManifestAgents(
  workspacePath: string,
  activeAgentIds: Iterable<string>
): Promise<WorkspaceProjectManifest> {
  const projectFilePath = path.join(workspacePath, ".openclaw", "project.json");
  const activeIds = new Set(
    Array.from(activeAgentIds)
      .map((agentId) => normalizeOptionalValue(agentId))
      .filter((agentId): agentId is string => Boolean(agentId))
  );

  if (activeIds.size === 0) {
    return readWorkspaceProjectManifest(workspacePath);
  }

  try {
    const raw = await readFile(projectFilePath, "utf8");
    const candidate = JSON.parse(raw);
    const parsed = isObjectRecord(candidate) ? candidate : {};

    if (!Array.isArray(parsed.agents)) {
      return readWorkspaceProjectManifest(workspacePath);
    }

    const existingAgents = parsed.agents
      .map((entry) => parseWorkspaceProjectManifestAgent(entry))
      .filter((entry): entry is WorkspaceProjectManifestAgent => Boolean(entry));
    const preserveMissingAgents = isRecentlyUpdatedManifest(parsed.updatedAt);
    const nextAgents = existingAgents.filter((entry) => activeIds.has(entry.id) || preserveMissingAgents);
    const staleAgentIds = existingAgents
      .filter((entry) => !activeIds.has(entry.id) && !preserveMissingAgents)
      .map((entry) => entry.id);

    if (nextAgents.length === existingAgents.length) {
      return readWorkspaceProjectManifest(workspacePath);
    }

    if (nextAgents.length > 0 && !nextAgents.some((entry) => entry.isPrimary)) {
      nextAgents[0] = {
        ...nextAgents[0],
        isPrimary: true
      };
    }

    const serialized = serializeWorkspaceProjectManifestRecord(parsed, {
      updatedAt: new Date().toISOString(),
      agents: nextAgents
    });

    await writeFile(projectFilePath, `${JSON.stringify(serialized, null, 2)}\n`, "utf8");
    await Promise.all(
      staleAgentIds.map((agentId) =>
        rm(path.join(workspacePath, "skills", buildAgentPolicySkillDirectoryName(agentId)), {
          recursive: true,
          force: true
        }).catch(() => undefined)
      )
    );
  } catch {
    return readWorkspaceProjectManifest(workspacePath);
  }

  return readWorkspaceProjectManifest(workspacePath);
}

function isRecentlyUpdatedManifest(value: unknown) {
  if (typeof value !== "string") {
    return false;
  }

  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp) && Date.now() - timestamp < RECENT_MANIFEST_AGENT_PRUNE_GRACE_MS;
}

function buildAgentPolicySkillDirectoryName(agentId: string) {
  return `agent-policy-${slugify(agentId) || "agent"}`;
}

export function parseWorkspaceProjectManifestAgent(
  value: unknown
): WorkspaceProjectManifestAgent | null {
  if (!isObjectRecord(value) || typeof value.id !== "string") {
    return null;
  }

  const skillIds = uniqueStrings([
    ...(Array.isArray(value.skillIds)
      ? value.skillIds
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.trim())
      : []),
    typeof value.skillId === "string" ? value.skillId.trim() : ""
  ]);

  return {
    id: value.id,
    name: typeof value.name === "string" ? value.name : null,
    role: typeof value.role === "string" ? value.role : null,
    isPrimary: Boolean(value.isPrimary),
    enabled: value.enabled !== false,
    skillId: skillIds[0] ?? null,
    skillIds,
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
    workerProfile: parseAgentOSWorkerProfile(value.workerProfile, {
      name: typeof value.name === "string" ? value.name : null,
      role: typeof value.role === "string" ? value.role : null,
      emoji: typeof value.emoji === "string" ? value.emoji : null,
      theme: typeof value.theme === "string" ? value.theme : null,
      avatar: typeof value.avatar === "string" ? value.avatar : null
    }),
    channelIds: Array.isArray(value.channelIds)
      ? value.channelIds.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
      : []
  };
}

export function parseWorkspaceProjectManifestChannel(
  value: unknown
): WorkspaceProjectManifestChannel | null {
  return parseWorkspaceChannelSummary(value);
}

export function parseWorkspaceChannelSummary(
  value: unknown
): WorkspaceChannelSummary | null {
  if (!isObjectRecord(value) || typeof value.id !== "string") {
    return null;
  }

  return {
    id: value.id,
    type: isMissionControlSurfaceProviderValue(value.type) ? value.type : "internal",
    name: typeof value.name === "string" ? value.name : value.id,
    primaryAgentId: typeof value.primaryAgentId === "string" ? value.primaryAgentId : null,
    workspaces: Array.isArray(value.workspaces)
      ? value.workspaces
          .map((entry) => parseWorkspaceChannelWorkspaceBinding(entry))
          .filter((entry): entry is WorkspaceChannelWorkspaceBinding => Boolean(entry))
      : []
  };
}

export function parseWorkspaceChannelWorkspaceBinding(
  value: unknown
): WorkspaceChannelWorkspaceBinding | null {
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

export function parseWorkspaceChannelGroupAssignment(
  value: unknown
): WorkspaceChannelGroupAssignment | null {
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

export function normalizeChannelRegistry(registry: ChannelRegistry): ChannelRegistry {
  const channels = registry.channels
    .map((channel) => ({
      id: channel.id.trim(),
      type: isMissionControlSurfaceProviderValue(channel.type) ? channel.type : "internal",
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

export function uniqueByChatId(assignments: WorkspaceChannelGroupAssignment[]) {
  const seen = new Map<string, WorkspaceChannelGroupAssignment>();

  for (const assignment of assignments) {
    if (!assignment.chatId) {
      continue;
    }

    seen.set(assignment.chatId, assignment);
  }

  return Array.from(seen.values());
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

function normalizeWorkspaceContextSources(
  sources: Array<{
    id?: string;
    kind?: unknown;
    label?: unknown;
    summary?: unknown;
    details?: unknown;
    status?: unknown;
    createdAt?: unknown;
    confidence?: unknown;
    error?: unknown;
    url?: unknown;
  }>
): PlannerContextSource[] {
  return sources.flatMap((source) => {
    if (!source || typeof source !== "object") {
      return [];
    }

    const kind = isPlannerContextSourceKind(source.kind) ? source.kind : "prompt";
    const label = normalizeOptionalValue(source.label as string | null | undefined) ?? kind;
    const summary = normalizeOptionalValue(source.summary as string | null | undefined) ?? label;
    const status = source.status === "error" ? "error" : "ready";
    const createdAt = normalizeOptionalValue(source.createdAt as string | null | undefined) ?? new Date().toISOString();
    const normalizedError = normalizeOptionalValue(source.error as string | null | undefined);
    const normalizedUrl = normalizeOptionalValue(source.url as string | null | undefined);

    if (!label || !summary) {
      return [];
    }

    return [
      {
        id: normalizeOptionalValue(source.id as string | null | undefined) ?? `${kind}-${slugify(label) || "context"}`,
        kind,
        label,
        summary,
        details: Array.isArray(source.details)
          ? source.details
              .map((entry) => normalizeOptionalValue(entry as string | null | undefined) ?? "")
              .filter((entry): entry is string => Boolean(entry))
          : [],
        status,
        createdAt,
        ...(typeof source.confidence === "number" ? { confidence: source.confidence } : {}),
        ...(normalizedError ? { error: normalizedError } : {}),
        ...(normalizedUrl ? { url: normalizedUrl } : {})
      }
    ];
  });
}

function isPlannerContextSourceKind(value: unknown): value is PlannerContextSource["kind"] {
  return value === "prompt" || value === "website" || value === "repo" || value === "folder";
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

function isWorkspaceTeamPreset(value: unknown): value is WorkspaceTeamPreset {
  return value === "solo" || value === "core" || value === "custom";
}

function isWorkspaceModelProfile(value: unknown): value is WorkspaceModelProfile {
  return value === "balanced" || value === "fast" || value === "quality";
}

function isMissionControlSurfaceProviderValue(value: unknown): value is WorkspaceChannelSummary["type"] {
  return typeof value === "string" && value.trim().length > 0;
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
