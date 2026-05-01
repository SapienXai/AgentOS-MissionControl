import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { DEFAULT_WORKSPACE_RULES } from "@/lib/openclaw/workspace-presets";
import { buildWorkspaceContextManifest } from "@/lib/openclaw/workspace-docs";
import {
  collectWorkspaceResourceState,
  listLocalWorkspaceSkills
} from "@/lib/openclaw/domains/workspace-edit";
import { readWorkspaceProjectManifest } from "@/lib/openclaw/domains/workspace-manifest";
import type { WorkspaceProjectManifest } from "@/lib/openclaw/domains/workspace-manifest";
import type {
  OpenClawAgent,
  WorkspaceCreateRules,
  WorkspaceProject,
  WorkspaceTemplate
} from "@/lib/openclaw/types";

type BootstrapProfileReadResult = {
  fileName: string;
  lines: string[];
  source: string;
};

export type WorkspaceBootstrapProfileCache = {
  profileFiles: readonly string[];
  contextManifest: ReturnType<typeof buildWorkspaceContextManifest>;
  workspaceSections: Map<string, string[]>;
  workspaceSources: string[];
};

export async function buildWorkspaceBootstrapProfileCache(
  workspacePath: string,
  template?: WorkspaceTemplate | null,
  rules?: WorkspaceCreateRules
): Promise<WorkspaceBootstrapProfileCache> {
  const contextManifest = buildWorkspaceContextManifest(template, rules ?? DEFAULT_WORKSPACE_RULES);
  const bootstrapFiles = ["AGENTS.md", "SOUL.md", "IDENTITY.md", "TOOLS.md", "HEARTBEAT.md"] as const;
  const profileFiles = [
    ...new Set([...bootstrapFiles, ...contextManifest.resources.map((spec) => spec.relativePath)])
  ];
  const entries = await Promise.all(
    profileFiles.map((fileName) => readBootstrapProfileFile(workspacePath, workspacePath, fileName))
  );
  const workspaceSections = new Map<string, string[]>();
  const workspaceSources: string[] = [];

  for (const entry of entries) {
    if (!entry) {
      continue;
    }

    workspaceSections.set(entry.fileName, entry.lines);
    workspaceSources.push(entry.source);
  }

  return {
    profileFiles,
    contextManifest,
    workspaceSections,
    workspaceSources
  };
}

export async function readWorkspaceInspectorMetadata(
  workspacePath: string,
  agents: OpenClawAgent[],
  projectMeta?: WorkspaceProjectManifest
): Promise<Pick<WorkspaceProject, "bootstrap" | "capabilities">> {
  const resolvedProjectMeta = projectMeta ?? (await readWorkspaceProjectManifest(workspacePath));
  const contextManifest = buildWorkspaceContextManifest(
    resolvedProjectMeta.template ?? null,
    resolvedProjectMeta.rules ?? DEFAULT_WORKSPACE_RULES
  );
  const nonContextPaths = new Set<string>([
    "AGENTS.md",
    "SOUL.md",
    "IDENTITY.md",
    "TOOLS.md",
    "HEARTBEAT.md",
    "MEMORY.md"
  ]);
  const [coreFiles, optionalFiles, contextFiles, folders, projectShell, localSkillIds] = await Promise.all([
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
    collectWorkspaceResourceState(
      workspacePath,
      contextManifest.resources.filter((resource) => !nonContextPaths.has(resource.relativePath))
    ),
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
      template: resolvedProjectMeta.template,
      sourceMode: resolvedProjectMeta.sourceMode,
      agentTemplate: resolvedProjectMeta.agentTemplate,
      coreFiles,
      optionalFiles,
      contextFiles,
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

export async function readBootstrapProfileFile(
  rootPath: string,
  workspacePath: string,
  fileName: string
): Promise<BootstrapProfileReadResult | null> {
  const filePath = path.join(rootPath, fileName);

  try {
    await access(filePath);
    const raw = await readFile(filePath, "utf8");
    const trimmed = raw.trim();

    if (!trimmed) {
      return null;
    }

    return {
      fileName,
      lines: trimmed.split(/\r?\n/),
      source: describeBootstrapSourcePath(workspacePath, filePath)
    };
  } catch {
    return null;
  }
}

function describeBootstrapSourcePath(workspacePath: string, filePath: string) {
  const resolvedWorkspacePath = path.resolve(workspacePath);
  const resolvedFilePath = path.resolve(filePath);

  if (resolvedFilePath.startsWith(`${resolvedWorkspacePath}${path.sep}`)) {
    return path.relative(resolvedWorkspacePath, resolvedFilePath) || path.basename(resolvedFilePath);
  }

  return resolvedFilePath;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort();
}
