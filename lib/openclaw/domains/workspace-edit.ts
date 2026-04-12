import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { isAgentPolicySkillId } from "@/lib/openclaw/domains/agent-config";
import type {
  WorkspaceAgentBlueprintInput,
  WorkspaceCreateRules,
  WorkspaceEditSeed,
  WorkspaceProject as WorkspaceProjectType
} from "@/lib/openclaw/types";

function normalizeOptionalValue(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

async function pathMatchesKind(targetPath: string, kind: "file" | "directory") {
  try {
    const targetStat = await stat(targetPath);
    return kind === "directory" ? targetStat.isDirectory() : targetStat.isFile();
  } catch {
    return false;
  }
}

export function createWorkspaceProjectFromEditSeed(seed: WorkspaceEditSeed): WorkspaceProjectType {
  return {
    id: seed.workspaceId,
    name: seed.name,
    slug: path.basename(seed.workspacePath),
    path: seed.workspacePath,
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
    },
    channels: []
  };
}

export function areWorkspaceCreateRulesEqual(left: WorkspaceCreateRules, right: WorkspaceCreateRules) {
  return (
    left.workspaceOnly === right.workspaceOnly &&
    left.generateStarterDocs === right.generateStarterDocs &&
    left.generateMemory === right.generateMemory &&
    left.kickoffMission === right.kickoffMission
  );
}

export function areWorkspaceAgentsEqual(
  left: WorkspaceAgentBlueprintInput[],
  right: WorkspaceAgentBlueprintInput[]
) {
  if (left.length !== right.length) {
    return false;
  }

  const normalizeAgent = (agent: WorkspaceAgentBlueprintInput) => ({
    id: agent.id.trim(),
    role: agent.role.trim(),
    name: agent.name.trim(),
    enabled: agent.enabled,
    emoji: normalizeOptionalValue(agent.emoji) ?? null,
    theme: normalizeOptionalValue(agent.theme) ?? null,
    skillId: normalizeOptionalValue(agent.skillId) ?? null,
    modelId: normalizeOptionalValue(agent.modelId) ?? null,
    isPrimary: Boolean(agent.isPrimary),
    policy: agent.policy
      ? {
          preset: agent.policy.preset,
          missingToolBehavior: agent.policy.missingToolBehavior,
          installScope: agent.policy.installScope,
          fileAccess: agent.policy.fileAccess,
          networkAccess: agent.policy.networkAccess
        }
      : null,
    heartbeat: agent.heartbeat
      ? {
          enabled: agent.heartbeat.enabled,
          every: normalizeOptionalValue(agent.heartbeat.every) ?? null
        }
      : null,
    channelIds: uniqueStrings(agent.channelIds ?? []).sort((left, right) => left.localeCompare(right))
  });

  const sortById = (leftAgent: WorkspaceAgentBlueprintInput, rightAgent: WorkspaceAgentBlueprintInput) =>
    leftAgent.id.localeCompare(rightAgent.id);

  const normalizedLeft = [...left].sort(sortById).map(normalizeAgent);
  const normalizedRight = [...right].sort(sortById).map(normalizeAgent);

  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
}

export async function collectWorkspaceEditableDocPaths(workspacePath: string) {
  const docPaths = new Set<string>();
  const rootEntries = await readdir(workspacePath, { withFileTypes: true });

  for (const entry of rootEntries) {
    if (entry.isFile() && isEditableMarkdownFile(entry.name)) {
      docPaths.add(entry.name);
    }
  }

  for (const directoryName of ["docs", "memory"] as const) {
    const directoryPath = path.join(workspacePath, directoryName);

    if (!(await pathMatchesKind(directoryPath, "directory"))) {
      continue;
    }

    const relativePaths = await collectMarkdownPathsInDirectory(directoryPath, directoryName);
    for (const relativePath of relativePaths) {
      docPaths.add(relativePath);
    }
  }

  const deliverablesReadmePath = path.join(workspacePath, "deliverables", "README.md");
  if (await pathMatchesKind(deliverablesReadmePath, "file")) {
    docPaths.add("deliverables/README.md");
  }

  return Array.from(docPaths).sort((left, right) => left.localeCompare(right));
}

export async function collectMarkdownPathsInDirectory(absoluteDirectoryPath: string, relativePrefix: string) {
  const results: string[] = [];
  const entries = await readdir(absoluteDirectoryPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const nextRelativePath = path.join(relativePrefix, entry.name);
    const nextAbsolutePath = path.join(absoluteDirectoryPath, entry.name);

    if (entry.isDirectory()) {
      results.push(...(await collectMarkdownPathsInDirectory(nextAbsolutePath, nextRelativePath)));
      continue;
    }

    if (entry.isFile() && isEditableMarkdownFile(entry.name)) {
      results.push(nextRelativePath);
    }
  }

  return results;
}

export function isEditableMarkdownFile(fileName: string) {
  return fileName.toLowerCase().endsWith(".md");
}

export async function collectWorkspaceResourceState(
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

export async function listLocalWorkspaceSkills(workspacePath: string) {
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
