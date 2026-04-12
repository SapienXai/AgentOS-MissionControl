import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  isAgentFileAccess,
  isAgentInstallScope,
  isAgentMissingToolBehavior,
  isAgentNetworkAccess,
  isAgentPreset
} from "@/lib/openclaw/agent-presets";
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

export type WorkspaceProjectManifestAgent = {
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

export type WorkspaceProjectManifest = {
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

export function parseWorkspaceProjectManifestAgent(
  value: unknown
): WorkspaceProjectManifestAgent | null {
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
