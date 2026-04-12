import { mkdir } from "node:fs/promises";
import path from "node:path";

import { DEFAULT_AGENT_PRESET, resolveAgentPolicy } from "@/lib/openclaw/agent-presets";
import { buildAgentPolicyPromptLines } from "@/lib/openclaw/domains/workspace-bootstrap";
import type { AgentPolicy } from "@/lib/openclaw/types";

export interface MissionOutputPlan {
  runFolder: string;
  absoluteOutputDir: string;
  relativeOutputDir: string;
  notesDirRelative: string;
}

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeWorkspaceRelativePath(targetPath: string) {
  return targetPath.split(path.sep).join("/");
}

export function buildMissionOutputFolderName(mission: string) {
  const now = new Date();
  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0")
  ].join("-");
  const normalizedMission = mission.replace(/^\[[^\]]+\]\s*/i, "").trim();
  const missionSlug = slugify(normalizedMission).slice(0, 48).replace(/^-+|-+$/g, "") || "task";

  return `${timestamp}-${missionSlug}`;
}

export async function prepareMissionOutputPlan(workspacePath: string, mission: string): Promise<MissionOutputPlan> {
  const runFolder = buildMissionOutputFolderName(mission);
  const absoluteOutputDir = path.join(workspacePath, "deliverables", runFolder);
  const relativeOutputDir = normalizeWorkspaceRelativePath(path.join("deliverables", runFolder));
  const notesDirRelative = normalizeWorkspaceRelativePath("memory");

  await mkdir(absoluteOutputDir, { recursive: true });
  await mkdir(path.join(workspacePath, "memory"), { recursive: true });

  return {
    runFolder,
    absoluteOutputDir,
    relativeOutputDir,
    notesDirRelative
  };
}

export function composeMissionWithOutputRouting(
  mission: string,
  outputPlan: Pick<MissionOutputPlan, "relativeOutputDir" | "notesDirRelative">,
  policy?: AgentPolicy,
  setupAgentId?: string | null
) {
  const resolvedPolicy = policy ?? resolveAgentPolicy(DEFAULT_AGENT_PRESET);

  return [
    mission,
    "",
    "Task output routing:",
    `- Put substantial outputs, drafts, reports, docs, and file deliverables under \`${outputPlan.relativeOutputDir}/\`.`,
    `- If a file is requested, default to \`${outputPlan.relativeOutputDir}/<descriptive-file-name>\` unless the user explicitly asks for another path.`,
    `- Use \`${outputPlan.notesDirRelative}/\` only for temporary notes or durable workspace memory, not final deliverables.`,
    "- Avoid writing final artifacts to the workspace root.",
    "- Only update shared workspace docs when the change is durable and workspace-wide; task-specific docs should stay inside this run folder.",
    "",
    "Agent operating policy:",
    ...buildAgentPolicyPromptLines(resolvedPolicy, setupAgentId)
  ].join("\n");
}
