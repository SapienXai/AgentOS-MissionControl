import { formatAgentPresetLabel } from "@/lib/openclaw/agent-presets";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import type { ChannelRegistry, MissionControlSnapshot, OpenClawAgent } from "@/lib/openclaw/types";

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

export type TelegramCoordinationContext = {
  primaryChannels: TelegramCoordinationChannelSummary[];
  ownedGroups: TelegramOwnedGroupSummary[];
  delegateChannels: Array<
    TelegramCoordinationChannelSummary & {
      primaryAgentId: string;
      primaryAgentName: string;
    }
  >;
};

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function uniqueByChatId<T extends { chatId: string }>(assignments: T[]) {
  const seen = new Map<string, T>();

  for (const assignment of assignments) {
    if (!assignment.chatId) {
      continue;
    }

    seen.set(assignment.chatId, assignment);
  }

  return Array.from(seen.values());
}

function formatTelegramGroupReference(group: { chatId: string; title: string | null }) {
  return group.title && group.title !== group.chatId ? `${group.title} (\`${group.chatId}\`)` : `\`${group.chatId}\``;
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

export function buildTelegramCoordinationContext(
  agentId: string,
  snapshot: MissionControlSnapshot | null,
  registry: ChannelRegistry | null = snapshot?.channelRegistry ?? null
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

    if (channel.primaryAgentId && channel.primaryAgentId !== agentId && ownedAssignments.length === 0) {
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

export function renderTelegramCoordinationMarkdown(coordination: TelegramCoordinationContext | null | undefined) {
  if (
    !coordination ||
    (coordination.primaryChannels.length === 0 &&
      coordination.ownedGroups.length === 0 &&
      coordination.delegateChannels.length === 0)
  ) {
    return null;
  }

  const lines: string[] = ["## Telegram coordination"];

  lines.push(
    "- Telegram credentials are managed by OpenClaw for the listed channels. Do not ask the operator for `TELEGRAM_BOT_TOKEN` or `channels.telegram.botToken` when sending to listed groups."
  );
  lines.push(
    '- To send or post, call the `message` tool with `action: "send"`, `channel: "telegram"`, `target: "<chatId>"`, and the exact message text. Use the listed chat id as `target`.'
  );
  lines.push("- If sending fails, report the actual tool error instead of inventing a missing-token error.");

  if (coordination.primaryChannels.length > 0) {
    lines.push("- You are the public Telegram fallback for these channels:");
    for (const channel of coordination.primaryChannels) {
      const groupSummary =
        channel.groups.length > 0
          ? channel.groups.map(formatTelegramGroupReference).join(", ")
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
          ? channel.groups.map(formatTelegramGroupReference).join(", ")
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
    lines.push("- When helping with Telegram work for groups not assigned to you, return concise internal findings or draft language. Do not speak as the public Telegram agent for those unassigned groups.");
  }

  return lines.join("\n");
}

export function renderTelegramCoordinationMarkdownForAgent(
  agentId: string,
  snapshot: MissionControlSnapshot | null,
  registry: ChannelRegistry | null = snapshot?.channelRegistry ?? null
) {
  return renderTelegramCoordinationMarkdown(buildTelegramCoordinationContext(agentId, snapshot, registry));
}
