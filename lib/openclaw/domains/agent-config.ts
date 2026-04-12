import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { runOpenClaw, runOpenClawJson } from "@/lib/openclaw/cli";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import type { AgentHeartbeatInput, MissionControlSnapshot, OpenClawAgent } from "@/lib/openclaw/types";

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

function cleanMarkdown(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
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
  snapshot?: MissionControlSnapshot
) {
  const configList = await readAgentConfigList(snapshot);
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

  await writeAgentConfigList(configList);
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
  },
  agentDir?: string
) {
  const resolvedAgentDir = normalizeOptionalValue(agentDir) ?? buildWorkspaceAgentStatePath(workspacePath, agentId);
  const identityFilePath = path.join(resolvedAgentDir, "IDENTITY.md");
  const identityMarkdown = renderAgentIdentityMarkdown({
    name: normalizeOptionalValue(identity.name) ?? agentId,
    emoji: normalizeOptionalValue(identity.emoji),
    avatar: normalizeOptionalValue(identity.avatar)
  });

  await mkdir(path.dirname(identityFilePath), { recursive: true });
  await writeFile(identityFilePath, identityMarkdown, "utf8");

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

  await runOpenClaw(args);
}

function renderAgentIdentityMarkdown(identity: {
  name: string;
  emoji?: string | null;
  avatar?: string | null;
}) {
  const avatar = normalizeOptionalValue(identity.avatar);

  return `# IDENTITY.md - Who Am I?

- **Name:** ${identity.name}
- **Creature:** OpenClaw agent
- **Vibe:** pragmatic, concise, workspace-grounded
- **Emoji:** ${identity.emoji ?? ""}
- **Avatar:** ${avatar ?? ""}

---

This identity file lives with the agent state so each agent can keep its own identity.
`;
}

export async function readAgentIdentityOverrides(agentDir?: string) {
  const resolvedAgentDir = normalizeOptionalValue(agentDir);

  if (!resolvedAgentDir) {
    return { name: null, emoji: null, avatar: null };
  }

  const identityFilePath = path.join(resolvedAgentDir, "IDENTITY.md");

  try {
    const raw = await readFile(identityFilePath, "utf8");
    const lines = raw.split(/\r?\n/);
    const parseField = (label: string) => {
      const match = lines.find((line) => new RegExp(`^-\\s+\\*\\*${label}:\\*\\*\\s*(.*)$`, "i").test(line.trim()));
      const value = match?.match(new RegExp(`^-\\s+\\*\\*${label}:\\*\\*\\s*(.*)$`, "i"))?.[1];
      return normalizeOptionalValue(value ? cleanMarkdown(value) : null) ?? null;
    };

    return {
      name: parseField("Name"),
      emoji: parseField("Emoji"),
      avatar: parseField("Avatar")
    };
  } catch {
    return { name: null, emoji: null, avatar: null };
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
