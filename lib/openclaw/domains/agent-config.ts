import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { runOpenClaw, runOpenClawJson } from "@/lib/openclaw/cli";
import {
  parseAgentIdentityMarkdown,
  renderAgentIdentityMarkdown as renderAgentIdentityMarkdownTemplate
} from "@/lib/openclaw/agent-bootstrap-files";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import { measureTiming, type TimingCollector } from "@/lib/openclaw/timing";
import type {
  AgentBootstrapFileInput,
  AgentHeartbeatInput,
  MissionControlSnapshot,
  OpenClawAgent
} from "@/lib/openclaw/types";

export type MutableAgentConfigEntry = {
  id: string;
  workspace: string;
  name?: string;
  model?: string;
  heartbeat?: {
    every?: string;
  };
  skills?: string[];
  tools?:
    | {
        fs?: {
          workspaceOnly?: boolean;
        };
      }
    | null;
  identity?: {
    name?: string;
    emoji?: string;
    theme?: string;
    avatar?: string;
  };
  default?: boolean;
} & Record<string, unknown>;

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

function extractErrorMessage(error: unknown) {
  if (!error) {
    return "";
  }

  if (error instanceof Error) {
    const parts = [error.message];
    if ("stderr" in error && typeof error.stderr === "string") {
      parts.push(error.stderr);
    }
    if ("stdout" in error && typeof error.stdout === "string") {
      parts.push(error.stdout);
    }
    return parts.filter(Boolean).join("\n");
  }

  if (typeof error === "string") {
    return error;
  }

  return "";
}

export function buildWorkspaceAgentStatePath(workspacePath: string, agentId: string) {
  return path.join(workspacePath, ".openclaw", "agents", agentId, "agent");
}

export function mapAgentHeartbeatToInput(heartbeat: OpenClawAgent["heartbeat"]): AgentHeartbeatInput {
  return {
    enabled: heartbeat.enabled,
    every: heartbeat.every ?? undefined
  };
}

export function buildAgentPolicySkillId(agentId: string) {
  return `agent-policy-${slugify(agentId) || "agent"}`;
}

export function isAgentPolicySkillId(skillId: string | undefined) {
  return Boolean(skillId && /^agent-policy-/.test(skillId));
}

export function filterAgentPolicySkills(skills: string[]) {
  return skills.filter((skillId) => !isAgentPolicySkillId(skillId));
}

export function normalizeDeclaredAgentTools(toolIds: string[]) {
  return uniqueStrings(
    toolIds
      .filter((toolId) => typeof toolId === "string")
      .map((toolId) => toolId.trim())
      .filter((toolId) => Boolean(toolId) && toolId !== "fs.workspaceOnly")
  );
}

export async function readAgentConfigList(snapshot?: MissionControlSnapshot) {
  try {
    const config = await runOpenClawJson<MutableAgentConfigEntry[]>([
      "config",
      "get",
      "agents.list",
      "--json"
    ]);

    return Array.isArray(config) ? config : [];
  } catch (error) {
    if (isMissingAgentConfigListError(error)) {
      return snapshot ? buildAgentConfigListFromSnapshot(snapshot) : [];
    }

    throw error;
  }
}

export async function writeAgentConfigList(configList: MutableAgentConfigEntry[]) {
  await runOpenClaw([
    "config",
    "set",
    "--strict-json",
    "agents.list",
    JSON.stringify(configList)
  ]);
}

export async function upsertAgentConfigEntry(
  agentId: string,
  workspacePath: string,
  updates: {
    name?: string;
    model?: string;
    heartbeat?: { every?: string } | null;
    skills?: string[];
    tools?:
      | {
          fs?: {
            workspaceOnly?: boolean;
          };
        }
      | null;
  },
  snapshot?: MissionControlSnapshot,
  timings?: TimingCollector
) {
  const configList = await measureTiming(timings, "agent-config.read", () => readAgentConfigList(snapshot));
  const existingIndex = configList.findIndex((entry) => entry.id === agentId);
  const nextEntry: MutableAgentConfigEntry =
    existingIndex >= 0
      ? { ...configList[existingIndex] }
      : {
          id: agentId,
          workspace: workspacePath
        };

  nextEntry.workspace = workspacePath;

  if (updates.name) {
    nextEntry.name = updates.name;
  }

  if (typeof updates.model === "string") {
    nextEntry.model = updates.model;
  } else {
    delete nextEntry.model;
  }

  if (updates.heartbeat?.every) {
    nextEntry.heartbeat = {
      every: updates.heartbeat.every
    };
  } else if (updates.heartbeat === null) {
    delete nextEntry.heartbeat;
  }

  if (Array.isArray(updates.skills) && updates.skills.length > 0) {
    nextEntry.skills = uniqueStrings(updates.skills);
  } else if (Array.isArray(updates.skills)) {
    delete nextEntry.skills;
  }

  if (updates.tools) {
    nextEntry.tools = updates.tools;
  } else if (updates.tools === null) {
    delete nextEntry.tools;
  }

  if (existingIndex >= 0) {
    configList[existingIndex] = nextEntry;
  } else {
    configList.push(nextEntry);
  }

  await measureTiming(timings, "agent-config.write", () => writeAgentConfigList(configList));
  return nextEntry;
}

export async function applyAgentIdentity(
  agentId: string,
  workspacePath: string,
  identity: {
    name?: string;
    emoji?: string;
    theme?: string;
    avatar?: string;
    content?: string;
  },
  agentDir?: string,
  timings?: TimingCollector
) {
  const resolvedAgentDir = normalizeOptionalValue(agentDir) ?? buildWorkspaceAgentStatePath(workspacePath, agentId);
  const identityFilePath = path.join(resolvedAgentDir, "IDENTITY.md");
  const identityMarkdown =
    normalizeOptionalValue(identity.content) ??
    renderAgentIdentityMarkdownTemplate({
      name: normalizeOptionalValue(identity.name) ?? agentId,
      emoji: normalizeOptionalValue(identity.emoji),
      theme: normalizeOptionalValue(identity.theme),
      avatar: normalizeOptionalValue(identity.avatar)
    });

  await measureTiming(timings, "agent-identity.write-file", async () => {
    await mkdir(path.dirname(identityFilePath), { recursive: true });
    await writeFile(identityFilePath, identityMarkdown, "utf8");
  });

  const args = [
    "agents",
    "set-identity",
    "--agent",
    agentId,
    "--workspace",
    workspacePath,
    "--identity-file",
    identityFilePath,
    "--json"
  ];

  if (identity.name) {
    args.push("--name", identity.name);
  }

  if (identity.emoji) {
    args.push("--emoji", identity.emoji);
  }

  if (identity.theme) {
    args.push("--theme", identity.theme);
  }

  if (identity.avatar) {
    args.push("--avatar", identity.avatar);
  }

  await measureTiming(timings, "agent-identity.sync-openclaw", () => runOpenClaw(args));
}

export async function writeAgentBootstrapFiles(
  agentId: string,
  workspacePath: string,
  files: AgentBootstrapFileInput[],
  agentDir?: string
) {
  const resolvedAgentDir = normalizeOptionalValue(agentDir) ?? buildWorkspaceAgentStatePath(workspacePath, agentId);

  await mkdir(resolvedAgentDir, { recursive: true });

  for (const file of files) {
    const filePath = path.join(resolvedAgentDir, file.path);

    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, file.content, "utf8");
  }
}

export async function readAgentIdentityOverrides(agentDir?: string) {
  const resolvedAgentDir = normalizeOptionalValue(agentDir);

  if (!resolvedAgentDir) {
    return { name: null, emoji: null, theme: null, avatar: null };
  }

  const identityFilePath = path.join(resolvedAgentDir, "IDENTITY.md");

  try {
    const raw = await readFile(identityFilePath, "utf8");
    const parsed = parseAgentIdentityMarkdown(raw);

    return {
      name: parsed.name,
      emoji: parsed.emoji,
      theme: parsed.theme,
      avatar: parsed.avatar
    };
  } catch {
    return { name: null, emoji: null, theme: null, avatar: null };
  }
}

function buildAgentConfigListFromSnapshot(snapshot: MissionControlSnapshot) {
  return snapshot.agents.map((agent) => {
    const displayName = formatAgentDisplayName(agent);
    const identity = {
      name: displayName,
      ...(agent.identity.emoji ? { emoji: agent.identity.emoji } : {}),
      ...(agent.identity.theme ? { theme: agent.identity.theme } : {}),
      ...(agent.identity.avatar ? { avatar: agent.identity.avatar } : {})
    };

    const configEntry: MutableAgentConfigEntry = {
      id: agent.id,
      workspace: agent.workspacePath,
      name: displayName
    };

    if (agent.modelId && agent.modelId !== "unassigned") {
      configEntry.model = agent.modelId;
    }

    if (agent.heartbeat.enabled && agent.heartbeat.every) {
      configEntry.heartbeat = {
        every: agent.heartbeat.every
      };
    }

    if (agent.skills.length > 0) {
      configEntry.skills = uniqueStrings(agent.skills);
    }

    if (agent.tools.includes("fs.workspaceOnly")) {
      configEntry.tools = {
        fs: {
          workspaceOnly: true
        }
      };
    }

    if (Object.keys(identity).length > 0) {
      configEntry.identity = identity;
    }

    if (agent.isDefault) {
      configEntry.default = true;
    }

    return configEntry;
  });
}

function isMissingAgentConfigListError(error: unknown) {
  const message = extractErrorMessage(error);
  return /Config path not found:\s*agents\.list|Config path not found:\s*agents\.list/i.test(message);
}
