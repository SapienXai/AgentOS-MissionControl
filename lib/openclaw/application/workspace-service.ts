import "server-only";

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_AGENT_PRESET,
  formatAgentPresetLabel,
  resolveAgentPolicy
} from "@/lib/openclaw/agent-presets";
import { readAgentBootstrapProfile } from "@/lib/openclaw/adapter/agent-profile-adapter";
import {
  buildWorkspaceBootstrapProfileCache
} from "@/lib/openclaw/adapter/workspace-inspector-adapter";
import { getMissionControlSnapshot } from "@/lib/openclaw/application/mission-control-service";
import {
  buildWorkspaceScaffoldDocuments
} from "@/lib/openclaw/workspace-docs";
import {
  DEFAULT_WORKSPACE_RULES,
  buildDefaultWorkspaceAgents
} from "@/lib/openclaw/workspace-presets";
import {
  detectWorkspaceToolExamples
} from "@/lib/openclaw/domains/workspace-bootstrap";
import {
  collectWorkspaceEditableDocPaths
} from "@/lib/openclaw/domains/workspace-edit";
import { readWorkspaceProjectManifest } from "@/lib/openclaw/domains/workspace-manifest";
import type {
  OpenClawAgent,
  WorkspaceCreateInput,
  WorkspaceCreateResult,
  WorkspaceDeleteInput,
  WorkspaceDocOverride,
  WorkspaceEditSeed,
  WorkspaceUpdateInput,
  WorkspaceAgentBlueprintInput
} from "@/lib/openclaw/types";

export async function createWorkspaceProject(
  input: WorkspaceCreateInput,
  options: {
    onProgress?: (snapshot: import("@/lib/openclaw/types").OperationProgressSnapshot) => Promise<void> | void;
  } = {}
): Promise<WorkspaceCreateResult> {
  const service = await import("@/lib/openclaw/service");
  return service.createWorkspaceProject(input, options);
}

export async function updateWorkspaceProject(input: WorkspaceUpdateInput) {
  const service = await import("@/lib/openclaw/service");
  return service.updateWorkspaceProject(input);
}

export async function deleteWorkspaceProject(input: WorkspaceDeleteInput) {
  const service = await import("@/lib/openclaw/service");
  return service.deleteWorkspaceProject(input);
}

export async function readWorkspaceEditSeed(workspaceId: string): Promise<WorkspaceEditSeed> {
  const snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
  const workspace = snapshot.workspaces.find((entry) => entry.id === workspaceId);

  if (!workspace) {
    throw new Error("Workspace was not found.");
  }

  const manifest = await readWorkspaceProjectManifest(workspace.path);
  const displayName = manifest.name ?? workspace.name;
  const workspaceAgents = snapshot.agents.filter((agent) => agent.workspaceId === workspace.id);
  const configuredSkills = uniqueStrings(workspaceAgents.flatMap((agent) => agent.skills));
  const configuredTools = uniqueStrings(workspaceAgents.flatMap((agent) => agent.tools));
  const template = manifest.template ?? workspace.bootstrap.template ?? "software";
  const sourceMode = manifest.sourceMode ?? workspace.bootstrap.sourceMode ?? "empty";
  const teamPreset = manifest.teamPreset ?? (workspaceAgents.length <= 1 ? "solo" : "core");
  const modelProfile = manifest.modelProfile ?? "balanced";
  const rules = manifest.rules ?? DEFAULT_WORKSPACE_RULES;
  const bootstrapProfileCache = await buildWorkspaceBootstrapProfileCache(
    workspace.path,
    manifest.template,
    manifest.rules ?? DEFAULT_WORKSPACE_RULES
  );
  const bootstrapProfile = await readAgentBootstrapProfile(workspace.path, {
    agentId: workspaceAgents[0]?.id ?? workspace.id,
    agentName: workspaceAgents[0]?.name ?? displayName,
    configuredSkills,
    configuredTools,
    template,
    rules,
    workspaceBootstrapProfile: bootstrapProfileCache
  });
  const agents =
    manifest.agents.length > 0
      ? manifest.agents.map((entry) => {
          const currentAgent = findMatchingWorkspaceAgent(workspaceAgents, workspace.slug, entry.id);
          const resolvedPolicy = resolveAgentPolicy(
            entry.policy?.preset ?? currentAgent?.policy.preset ?? DEFAULT_AGENT_PRESET,
            entry.policy ?? currentAgent?.policy
          );

          return {
            id: entry.id,
            role: entry.role ?? formatAgentPresetLabel(resolvedPolicy.preset),
            name: entry.name ?? currentAgent?.name ?? entry.role ?? entry.id,
            enabled: entry.enabled,
            emoji: entry.emoji ?? currentAgent?.identity.emoji,
            theme: entry.theme ?? currentAgent?.identity.theme,
            skillId: entry.skillId ?? undefined,
            modelId:
              entry.modelId ??
              (currentAgent?.modelId && currentAgent.modelId !== "unassigned" ? currentAgent.modelId : undefined),
            isPrimary: entry.isPrimary,
            policy: resolvedPolicy,
            channelIds: entry.channelIds ?? [],
            heartbeat: {
              enabled: currentAgent?.heartbeat.enabled ?? false,
              ...(currentAgent?.heartbeat.every ? { every: currentAgent.heartbeat.every } : {})
            }
          } satisfies WorkspaceAgentBlueprintInput;
        })
      : buildDefaultWorkspaceAgents(template, teamPreset, displayName);
  const scaffoldDocuments = buildWorkspaceScaffoldDocuments({
    name: displayName,
    brief: bootstrapProfile.purpose || displayName,
    template,
    sourceMode,
    rules,
    agents,
    toolExamples: await detectWorkspaceToolExamples(workspace.path),
    docOverrides: [],
    contextSources: manifest.contextSources ?? []
  });
  const docOverrides: WorkspaceDocOverride[] = [];
  const scaffoldPathSet = new Set(scaffoldDocuments.map((document) => document.path));
  const editableDocPaths = await collectWorkspaceEditableDocPaths(workspace.path);

  for (const document of scaffoldDocuments) {
    const filePath = path.join(workspace.path, document.path);

    try {
      const currentContent = await readFile(filePath, "utf8");

      if (currentContent !== document.baseContent) {
        docOverrides.push({
          path: document.path,
          content: currentContent
        });
      }
    } catch {
      continue;
    }
  }

  for (const relativePath of editableDocPaths) {
    if (scaffoldPathSet.has(relativePath)) {
      continue;
    }

    const filePath = path.join(workspace.path, relativePath);

    try {
      const currentContent = await readFile(filePath, "utf8");
      docOverrides.push({
        path: relativePath,
        content: currentContent
      });
    } catch {
      continue;
    }
  }

  return {
    workspaceId: workspace.id,
    workspacePath: workspace.path,
    name: displayName,
    directory: workspace.path,
    template,
    sourceMode,
    teamPreset,
    modelProfile,
    modelId: workspace.modelIds[0] && workspace.modelIds[0] !== "unassigned" ? workspace.modelIds[0] : undefined,
    rules,
    docOverrides,
    agents,
    brief: bootstrapProfile.purpose || displayName,
    contextSources: manifest.contextSources ?? []
  };
}

function findMatchingWorkspaceAgent(
  agents: OpenClawAgent[],
  workspaceSlug: string,
  agentKey: string
) {
  const normalizedKey = slugify(agentKey);
  const workspacePrefix = `${workspaceSlug}-`;

  return (
    agents.find((agent) => agent.id === createWorkspaceAgentId(workspaceSlug, agentKey)) ??
    agents.find((agent) => agent.id === `${workspacePrefix}${normalizedKey}`) ??
    agents.find((agent) => normalizedKey.length > 0 && agent.id.endsWith(`-${normalizedKey}`)) ??
    agents.find((agent) => agent.id === normalizedKey) ??
    null
  );
}

function createWorkspaceAgentId(workspaceSlug: string, agentKey: string) {
  return `${workspaceSlug}-${slugify(agentKey) || "agent"}`;
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

export function workspaceIdFromPath(workspacePath: string) {
  const hash = createHash("sha1").update(workspacePath).digest("hex").slice(0, 8);
  return `workspace:${hash}`;
}
