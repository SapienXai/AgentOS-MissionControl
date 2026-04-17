import { mkdir } from "node:fs/promises";
import path from "node:path";

import {
  formatAgentPresetLabel,
  formatCapabilityLabel,
  filterKnownOpenClawSkillIds,
  inferAgentPresetFromContext,
  resolveAgentPolicy
} from "@/lib/openclaw/agent-presets";
import { serializeHeartbeatConfig } from "@/lib/openclaw/agent-heartbeat";
import { runOpenClaw } from "@/lib/openclaw/cli";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import { measureTiming, type TimingCollector } from "@/lib/openclaw/timing";
import {
  buildAgentPolicySkillId,
  buildWorkspaceAgentStatePath,
  applyAgentIdentity,
  upsertAgentConfigEntry
} from "@/lib/openclaw/domains/agent-config";
import { buildAgentPolicyPromptLines, renderSkillMarkdown, writeTextFileEnsured, writeTextFileIfMissing } from "@/lib/openclaw/domains/workspace-bootstrap";
import { readWorkspaceProjectManifest, uniqueByChatId } from "@/lib/openclaw/domains/workspace-manifest";
import type {
  AgentPolicy,
  ChannelRegistry,
  MissionControlSnapshot,
  OpenClawAgent,
  WorkspaceAgentBlueprintInput
} from "@/lib/openclaw/types";

type TelegramCoordinationChannelSummary = {
  channelId: string;
  channelName: string;
  groups: Array<{ chatId: string; title: string | null }>;
  peers: Array<{ agentId: string; name: string; summary: string }>;
};

type TelegramOwnedGroupSummary = {
  channelId: string;
  channelName: string;
  chatId: string;
  title: string | null;
  primaryAgentId: string;
  primaryAgentName: string;
  peers: Array<{ agentId: string; name: string; summary: string }>;
};

type TelegramCoordinationContext = {
  primaryChannels: TelegramCoordinationChannelSummary[];
  ownedGroups: TelegramOwnedGroupSummary[];
  delegateChannels: Array<
    TelegramCoordinationChannelSummary & {
      primaryAgentId: string;
      primaryAgentName: string;
    }
  >;
};

type WorkspaceTeamMemberSummary = {
  agentId: string;
  name: string;
  role: string;
  isPrimary: boolean;
  isCurrent: boolean;
};

type WorkspaceTeamContext = {
  members: WorkspaceTeamMemberSummary[];
};

function normalizeOptionalValue(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function findDuplicateStrings(values: string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
      continue;
    }

    seen.add(value);
  }

  return Array.from(duplicates).sort((left, right) => left.localeCompare(right));
}

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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

export function createWorkspaceAgentId(workspaceSlug: string, agentKey: string) {
  return `${workspaceSlug}-${slugify(agentKey) || "agent"}`;
}

export function assertWorkspaceBootstrapAgentIdsAvailable(
  snapshot: MissionControlSnapshot,
  workspaceSlug: string,
  agents: WorkspaceAgentBlueprintInput[]
) {
  const finalAgentIds = agents.map((agent) => createWorkspaceAgentId(workspaceSlug, agent.id));
  const duplicateFinalIds = findDuplicateStrings(finalAgentIds);

  if (duplicateFinalIds.length > 0) {
    throw new Error(`Workspace bootstrap would create duplicate agent ids: ${duplicateFinalIds.join(", ")}.`);
  }

  for (const agentId of finalAgentIds) {
    const existingAgent = snapshot.agents.find((agent) => agent.id === agentId);

    if (!existingAgent) {
      continue;
    }

    throw new Error(
      `Workspace bootstrap would create agent id "${agentId}", but it already exists in workspace "${describeAgentWorkspace(snapshot, existingAgent)}". Rename the workspace or adjust the agent ids.`
    );
  }
}

export async function createBootstrappedWorkspaceAgent(params: {
  workspacePath: string;
  workspaceSlug: string;
  workspaceModelId?: string;
  agent: WorkspaceAgentBlueprintInput;
}) {
  const agentId = createWorkspaceAgentId(params.workspaceSlug, params.agent.id);
  const modelId =
    normalizeOptionalValue(params.agent.modelId) ?? normalizeOptionalValue(params.workspaceModelId);
  const policy = resolveAgentPolicy(
    params.agent.policy?.preset ??
      inferAgentPresetFromContext({
        skills: params.agent.skillId ? [params.agent.skillId] : [],
        id: agentId,
        name: params.agent.name
      }),
    params.agent.policy
  );
  const args = [
    "agents",
    "add",
    agentId,
    "--workspace",
    params.workspacePath,
    "--agent-dir",
    buildWorkspaceAgentStatePath(params.workspacePath, agentId),
    "--non-interactive",
    "--json"
  ];

  if (modelId) {
    args.push("--model", modelId);
  }

  await runOpenClaw(args);

  const policySkillId = await ensureAgentPolicySkill({
    workspacePath: params.workspacePath,
    agentId,
    agentName: params.agent.name,
    policy
  });

  const configEntry = await upsertAgentConfigEntry(agentId, params.workspacePath, {
    name: normalizeOptionalValue(params.agent.name) ?? undefined,
    model: modelId ?? undefined,
    heartbeat: serializeHeartbeatConfig(params.agent.heartbeat),
    skills: [normalizeOptionalValue(params.agent.skillId), policySkillId].filter(
      (value): value is string => Boolean(value)
    ),
    tools:
      policy.fileAccess === "workspace-only"
        ? {
            fs: {
              workspaceOnly: true
            }
          }
        : null
  });

  await applyAgentIdentity(
    agentId,
    params.workspacePath,
    {
      name: normalizeOptionalValue(params.agent.name) ?? configEntry.name,
      emoji: normalizeOptionalValue(params.agent.emoji) ?? undefined,
      theme: normalizeOptionalValue(params.agent.theme) ?? undefined
    },
    buildWorkspaceAgentStatePath(params.workspacePath, agentId)
  );

  return agentId;
}

export async function ensureAgentPolicySkill(params: {
  workspacePath: string;
  agentId: string;
  agentName: string;
  policy: AgentPolicy;
  setupAgentId?: string | null;
  snapshot?: MissionControlSnapshot;
  channelRegistry?: ChannelRegistry;
  timings?: TimingCollector;
}) {
  const skillId = buildAgentPolicySkillId(params.agentId);
  await measureTiming(params.timings, "agent-policy.ensure-telegram-helper", () =>
    ensureTelegramDelegationHelper(params.workspacePath)
  );
  const team = await measureTiming(params.timings, "agent-policy.build-team-context", () =>
    buildWorkspaceTeamContext(params.workspacePath, params.agentId, params.snapshot ?? null)
  );
  const coordination = await measureTiming(params.timings, "agent-policy.build-telegram-coordination", () =>
    buildTelegramCoordinationContext(
      params.agentId,
      params.snapshot ?? null,
      params.channelRegistry ?? params.snapshot?.channelRegistry ?? null
    )
  );
  await measureTiming(params.timings, "agent-policy.write-skill", () =>
    writeTextFileEnsured(
      path.join(params.workspacePath, "skills", skillId, "SKILL.md"),
      `${renderAgentPolicySkillMarkdown(params.agentName, params.policy, params.setupAgentId, team, coordination)}\n`
    )
  );
  return skillId;
}

export async function ensureWorkspaceSkillMarkdown(workspacePath: string, skillId: string) {
  const [knownSkillId] = filterKnownOpenClawSkillIds([skillId]);

  if (!knownSkillId) {
    return;
  }

  const skillPath = path.join(workspacePath, "skills", skillId);
  await mkdir(skillPath, { recursive: true });
  await writeTextFileIfMissing(path.join(skillPath, "SKILL.md"), `${renderSkillMarkdown(knownSkillId, formatCapabilityLabel(knownSkillId))}\n`);
}

async function ensureTelegramDelegationHelper(workspacePath: string) {
  const helperPath = path.join(workspacePath, ".openclaw", "tools", "telegram-delegate-agent.mjs");
  await writeTextFileEnsured(helperPath, `${renderTelegramDelegationHelperScript()}\n`);
}

function describeTelegramAgentCapability(agent: OpenClawAgent | null) {
  if (!agent) {
    return "no capability snapshot";
  }

  const parts: string[] = [formatAgentPresetLabel(agent.policy.preset)];

  const purpose = agent.profile.purpose?.trim();
  if (purpose) {
    parts.push(purpose);
  }

  const skills = uniqueStrings(agent.skills).slice(0, 2);
  if (skills.length > 0) {
    parts.push(`skills: ${skills.join(", ")}`);
  }

  const tools = uniqueStrings(agent.tools).slice(0, 2);
  if (tools.length > 0) {
    parts.push(`tools: ${tools.join(", ")}`);
  }

  return parts.join(" · ");
}

function buildTelegramCoordinationContext(
  agentId: string,
  snapshot: MissionControlSnapshot | null,
  registry: ChannelRegistry | null
): TelegramCoordinationContext | null {
  if (!registry) {
    return null;
  }

  const agentNameById = new Map(snapshot?.agents.map((agent) => [agent.id, formatAgentDisplayName(agent)]) ?? []);
  const agentById = new Map(snapshot?.agents.map((agent) => [agent.id, agent]) ?? []);
  const currentAgent = agentById.get(agentId) ?? null;
  const currentWorkspaceId = currentAgent?.workspaceId ?? null;
  const primaryChannels: TelegramCoordinationChannelSummary[] = [];
  const ownedGroups: TelegramOwnedGroupSummary[] = [];
  const delegateChannels: Array<
    TelegramCoordinationChannelSummary & {
      primaryAgentId: string;
      primaryAgentName: string;
    }
  > = [];

  for (const channel of registry.channels.filter((entry) => entry.type === "telegram")) {
    const workspaceBindings = channel.workspaces.filter((workspace) => workspace.workspaceId === currentWorkspaceId);

    if (workspaceBindings.length === 0) {
      continue;
    }

    const groups = uniqueByChatId(
      workspaceBindings.flatMap((workspace) =>
        workspace.groupAssignments.filter((assignment) => assignment.enabled !== false)
      )
    ).map((assignment) => ({
      chatId: assignment.chatId,
      title: assignment.title ?? null
    }));
    const ownedAssignments = uniqueByChatId(
      workspaceBindings.flatMap((workspace) =>
        workspace.groupAssignments.filter((assignment) => assignment.enabled !== false && assignment.agentId === agentId)
      )
    );
    const fallbackGroups = groups.filter(
      (group) =>
        !ownedAssignments.some((assignment) => assignment.chatId === group.chatId) &&
        !workspaceBindings.some((workspace) =>
          workspace.groupAssignments.some(
            (assignment) => assignment.enabled !== false && assignment.chatId === group.chatId && assignment.agentId
          )
        )
    );

    if (channel.primaryAgentId === agentId) {
      const peers = uniqueStrings(
        workspaceBindings.flatMap((workspace) => workspace.agentIds.filter((candidate) => candidate !== agentId))
      ).map((peerId) => {
        const peer = agentById.get(peerId) ?? null;
        return {
          agentId: peerId,
          name: agentNameById.get(peerId) ?? peerId,
          summary: describeTelegramAgentCapability(peer)
        };
      });

      primaryChannels.push({
        channelId: channel.id,
        channelName: channel.name,
        groups: fallbackGroups,
        peers
      });
    }

    for (const assignment of ownedAssignments) {
      const peers = uniqueStrings(
        workspaceBindings.flatMap((workspace) =>
          workspace.agentIds.filter((candidate) => candidate !== agentId && candidate !== channel.primaryAgentId)
        )
      ).map((peerId) => {
        const peer = agentById.get(peerId) ?? null;
        return {
          agentId: peerId,
          name: agentNameById.get(peerId) ?? peerId,
          summary: describeTelegramAgentCapability(peer)
        };
      });

      ownedGroups.push({
        channelId: channel.id,
        channelName: channel.name,
        chatId: assignment.chatId,
        title: assignment.title ?? null,
        primaryAgentId: channel.primaryAgentId ?? agentId,
        primaryAgentName:
          agentNameById.get(channel.primaryAgentId ?? agentId) ?? channel.primaryAgentId ?? agentId,
        peers
      });
    }

    if (channel.primaryAgentId && channel.primaryAgentId !== agentId) {
      const primaryPeer = agentById.get(channel.primaryAgentId) ?? null;
      const peers = uniqueStrings(
        workspaceBindings.flatMap((workspace) =>
          workspace.agentIds.filter(
            (candidate) => candidate !== channel.primaryAgentId && candidate !== agentId
          )
        )
      ).map((peerId) => {
        const peer = agentById.get(peerId) ?? null;
        return {
          agentId: peerId,
          name: agentNameById.get(peerId) ?? peerId,
          summary: describeTelegramAgentCapability(peer)
        };
      });

      delegateChannels.push({
        channelId: channel.id,
        channelName: channel.name,
        groups: fallbackGroups,
        peers,
        primaryAgentId: channel.primaryAgentId,
        primaryAgentName:
          agentNameById.get(channel.primaryAgentId) ??
          (primaryPeer ? formatAgentDisplayName(primaryPeer) : channel.primaryAgentId)
      });
    }
  }

  return {
    primaryChannels: primaryChannels.sort((left, right) => left.channelName.localeCompare(right.channelName)),
    ownedGroups: ownedGroups.sort((left, right) => {
      const leftLabel = `${left.channelName}:${left.title ?? left.chatId}`;
      const rightLabel = `${right.channelName}:${right.title ?? right.chatId}`;
      return leftLabel.localeCompare(rightLabel);
    }),
    delegateChannels: delegateChannels.sort((left, right) => left.channelName.localeCompare(right.channelName))
  };
}

function renderTelegramCoordinationMarkdown(coordination: TelegramCoordinationContext | null | undefined) {
  if (
    !coordination ||
    (coordination.primaryChannels.length === 0 &&
      coordination.ownedGroups.length === 0 &&
      coordination.delegateChannels.length === 0)
  ) {
    return null;
  }

  const lines: string[] = ["## Telegram coordination"];

  if (coordination.primaryChannels.length > 0) {
    lines.push("- You are the public Telegram fallback for these channels:");
    for (const channel of coordination.primaryChannels) {
      const groupSummary =
        channel.groups.length > 0
          ? channel.groups.map((group) => group.title ?? group.chatId).join(", ")
          : "no allowed groups yet";
      lines.push(`  - ${channel.channelName} (\`${channel.channelId}\`) · fallback groups: ${groupSummary}.`);
      if (channel.peers.length > 0) {
        lines.push("  - Internal assistants:");
        for (const peer of channel.peers) {
          lines.push(`    - ${peer.name} (\`${peer.agentId}\`) · ${peer.summary}.`);
        }
      }
    }
    lines.push("- Keep public Telegram replies under your own voice for unassigned groups, even when you ask another agent for help.");
    lines.push("- For specialist help, call another agent from the workspace terminal with:");
    lines.push("```bash");
    lines.push('node .openclaw/tools/telegram-delegate-agent.mjs --agent <delegate-agent-id> --message "Summarize what I need from you"');
    lines.push("```");
    lines.push("- Use delegate turns for internal research, drafting, or analysis only. Do not ask them to answer Telegram directly.");
    lines.push("- After a delegate responds, decide what to share publicly and send the final Telegram reply yourself.");
  }

  if (coordination.ownedGroups.length > 0) {
    lines.push("- You are the public Telegram voice for these assigned groups:");
    for (const group of coordination.ownedGroups) {
      lines.push(
        `  - ${group.channelName} (\`${group.channelId}\`) · ${group.title ?? group.chatId} (\`${group.chatId}\`) · primary ${group.primaryAgentName} (\`${group.primaryAgentId}\`).`
      );
      if (group.peers.length > 0) {
        lines.push("  - Internal assistants for this group:");
        for (const peer of group.peers) {
          lines.push(`    - ${peer.name} (\`${peer.agentId}\`) · ${peer.summary}.`);
        }
      }
    }
    lines.push("- Reply directly to those groups as the public voice. Use other agents only for internal help.");
  }

  if (coordination.delegateChannels.length > 0) {
    lines.push("- You can assist these Telegram admin channels when the primary agent asks:");
    for (const channel of coordination.delegateChannels) {
      const groupSummary =
        channel.groups.length > 0
          ? channel.groups.map((group) => group.title ?? group.chatId).join(", ")
          : "no allowed groups yet";
      lines.push(
        `  - ${channel.channelName} (\`${channel.channelId}\`) · primary ${channel.primaryAgentName} (\`${channel.primaryAgentId}\`) · groups: ${groupSummary}.`
      );
      if (channel.peers.length > 0) {
        lines.push("    - Nearby assistants:");
        for (const peer of channel.peers) {
          lines.push(`      - ${peer.name} (\`${peer.agentId}\`) · ${peer.summary}.`);
        }
      }
    }
    lines.push("- When helping with Telegram work, return concise internal findings or draft language. Do not speak as the public Telegram agent.");
  }

  return lines.join("\n");
}

async function buildWorkspaceTeamContext(
  workspacePath: string,
  agentId: string,
  snapshot: MissionControlSnapshot | null
): Promise<WorkspaceTeamContext | null> {
  if (!snapshot) {
    return null;
  }

  const currentAgent = snapshot.agents.find((entry) => entry.id === agentId);

  if (!currentAgent) {
    return null;
  }

  const manifest = await readWorkspaceProjectManifest(workspacePath);
  const manifestAgentById = new Map(manifest.agents.map((entry) => [entry.id, entry]));
  const members = snapshot.agents
    .filter((entry) => entry.workspaceId === currentAgent.workspaceId)
    .sort((left, right) => {
      if (left.id === agentId && right.id !== agentId) {
        return -1;
      }

      if (right.id === agentId && left.id !== agentId) {
        return 1;
      }

      const leftManifest = manifestAgentById.get(left.id);
      const rightManifest = manifestAgentById.get(right.id);
      const leftPrimary = leftManifest?.isPrimary ?? false;
      const rightPrimary = rightManifest?.isPrimary ?? false;

      if (leftPrimary !== rightPrimary) {
        return leftPrimary ? -1 : 1;
      }

      return formatAgentDisplayName(left).localeCompare(formatAgentDisplayName(right));
    })
    .map((entry) => {
      const manifestAgent = manifestAgentById.get(entry.id);

      return {
        agentId: entry.id,
        name: formatAgentDisplayName(entry),
        role: manifestAgent?.role?.trim() || formatAgentPresetLabel(entry.policy.preset),
        isPrimary: manifestAgent?.isPrimary ?? false,
        isCurrent: entry.id === agentId
      } satisfies WorkspaceTeamMemberSummary;
    });

  return members.length > 0 ? { members } : null;
}

function renderWorkspaceTeamMarkdown(team: WorkspaceTeamContext | null | undefined) {
  if (!team || team.members.length === 0) {
    return null;
  }

  const lines = [
    "## Workspace team",
    "- This workspace currently includes these agents. Do not assume you are the only agent unless you verify the roster again.",
    "- Use these exact agent ids when referring to teammates or handing work off:"
  ];

  for (const member of team.members) {
    const labels = [member.isCurrent ? "you" : null, member.isPrimary ? "primary" : null, member.role].filter(
      (value): value is string => Boolean(value)
    );

    lines.push(`- ${member.name} (\`${member.agentId}\`) · ${labels.join(" · ")}.`);
  }

  lines.push(
    "- If you are asked who is in this workspace, answer from this roster or re-check `.openclaw/project.json` before replying."
  );

  return lines.join("\n");
}

function renderAgentPolicySkillMarkdown(
  agentName: string,
  policy: AgentPolicy,
  setupAgentId?: string | null,
  team?: WorkspaceTeamContext | null,
  coordination?: TelegramCoordinationContext | null
) {
  const presetLabel = formatAgentPresetLabel(policy.preset);
  const teamSection = renderWorkspaceTeamMarkdown(team);
  const coordinationSection = renderTelegramCoordinationMarkdown(coordination);

  return `# ${agentName} Policy

Preset: ${presetLabel}

## Output routing
- Final deliverables belong in the current deliverables run folder for the task.
- Keep temporary notes and durable workspace memory inside memory/.
- Treat MEMORY.md, memory/*.md, docs/brief.md, docs/architecture.md, and any template-specific docs under docs/ as shared workspace context before large edits.
- Avoid writing final artifacts to the workspace root unless the task explicitly asks for it.

## Operating rules
${buildAgentPolicyPromptLines(policy, setupAgentId)
  .map((line) => line.replace(/^- /, "- "))
  .join("\n")}
${teamSection ? `\n\n${teamSection}` : ""}${coordinationSection ? `\n\n${coordinationSection}` : ""}
`;
}

function renderTelegramDelegationHelperScript() {
  return String.raw`#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function parseArgs(argv) {
  const options = {
    agentId: "",
    message: "",
    thinking: "low",
    json: false,
    stdin: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--agent") {
      options.agentId = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg === "--message") {
      options.message = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg === "--thinking") {
      options.thinking = argv[index + 1] ?? "low";
      index += 1;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--stdin") {
      options.stdin = true;
      continue;
    }
  }

  return options;
}

function usage() {
  process.stderr.write(
    "Usage: node .openclaw/tools/telegram-delegate-agent.mjs --agent <id> --message <text> [--thinking low|medium|high] [--json]\n"
  );
}

function extractText(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  if (typeof payload.summary === "string" && payload.summary.trim()) {
    return payload.summary.trim();
  }

  if (Array.isArray(payload.payloads)) {
    for (const entry of payload.payloads) {
      if (entry && typeof entry === "object") {
        if (typeof entry.text === "string" && entry.text.trim()) {
          return entry.text.trim();
        }

        if (typeof entry.content === "string" && entry.content.trim()) {
          return entry.content.trim();
        }
      }
    }
  }

  if (payload.result && typeof payload.result === "object") {
    return extractText(payload.result);
  }

  return "";
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.stdin) {
    options.message = await readStdin();
  }

  if (!options.agentId || !options.message.trim()) {
    usage();
    process.exit(1);
  }

  const args = [
    "agent",
    "--agent",
    options.agentId,
    "--message",
    options.message.trim(),
    "--thinking",
    options.thinking,
    "--json"
  ];

  try {
    const { stdout } = await execFileAsync("openclaw", args, {
      cwd: process.cwd(),
      maxBuffer: 4 * 1024 * 1024
    });
    const parsed = JSON.parse(stdout);

    if (options.json) {
      process.stdout.write(JSON.stringify(parsed, null, 2) + "\n");
      return;
    }

    const text = extractText(parsed);
    process.stdout.write((text || JSON.stringify(parsed, null, 2)) + "\n");
  } catch (error) {
    const message =
      error && typeof error === "object" && "stderr" in error && typeof error.stderr === "string"
        ? error.stderr.trim()
        : error instanceof Error
          ? error.message
          : "Telegram delegation failed.";
    process.stderr.write(String(message) + "\n");
    process.exit(1);
  }
}

await main();
`;
}
