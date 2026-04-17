import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import { parseDiscordRouteId } from "@/lib/openclaw/domains/discord-route";
import {
  buildTelegramCoordinationContext,
  renderTelegramCoordinationMarkdown
} from "@/lib/openclaw/telegram-coordination";
import type { ChannelRegistry, MissionControlSnapshot, OpenClawAgent, WorkspaceChannelGroupAssignment } from "@/lib/openclaw/types";

type SurfacePeerSummary = {
  agentId: string;
  name: string;
  summary: string;
};

type DiscordRouteSummary = {
  routeId: string;
  label: string;
  kind: "channel" | "thread" | "role";
  guildId: string | null;
};

type DiscordCoordinationChannelSummary = {
  channelId: string;
  channelName: string;
  routes: DiscordRouteSummary[];
  peers: SurfacePeerSummary[];
};

type DiscordOwnedRouteSummary = {
  channelId: string;
  channelName: string;
  routeId: string;
  label: string;
  kind: "channel" | "thread" | "role";
  guildId: string | null;
  primaryAgentId: string;
  primaryAgentName: string;
  peers: SurfacePeerSummary[];
};

type DiscordCoordinationContext = {
  primaryChannels: DiscordCoordinationChannelSummary[];
  ownedRoutes: DiscordOwnedRouteSummary[];
  delegateChannels: Array<
    DiscordCoordinationChannelSummary & {
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

function describeSurfaceAgentCapability(agent: OpenClawAgent | null) {
  if (!agent) {
    return "no capability snapshot";
  }

  const parts: string[] = [formatAgentDisplayName(agent)];
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

function resolveAgentDisplayName(agent: OpenClawAgent | null, fallback: string) {
  return agent ? formatAgentDisplayName(agent) : fallback;
}

function buildSurfacePeerSummaries(
  snapshot: MissionControlSnapshot | null,
  agentIds: string[],
  exclude: string[]
) {
  const agentNameById = new Map(snapshot?.agents.map((agent) => [agent.id, formatAgentDisplayName(agent)]) ?? []);
  const agentById = new Map(snapshot?.agents.map((agent) => [agent.id, agent]) ?? []);

  return uniqueStrings(agentIds.filter((candidate) => !exclude.includes(candidate))).map((agentId) => {
    const peer = agentById.get(agentId) ?? null;
    return {
      agentId,
      name: agentNameById.get(agentId) ?? agentId,
      summary: describeSurfaceAgentCapability(peer)
    };
  });
}

function describeDiscordRouteAssignment(assignment: WorkspaceChannelGroupAssignment): DiscordRouteSummary {
  const parsed = parseDiscordRouteId(assignment.chatId);
  const fallbackLabel =
    parsed?.kind === "role"
      ? `@${parsed.targetId}`
      : parsed?.kind === "thread"
        ? `Thread ${parsed.targetId}`
        : parsed?.kind === "channel"
          ? `#${parsed.targetId}`
          : assignment.chatId;

  return {
    routeId: assignment.chatId,
    label: assignment.title?.trim() || fallbackLabel,
    kind: parsed?.kind ?? "channel",
    guildId: parsed?.guildId ?? null
  };
}

function buildDiscordCoordinationContext(
  agentId: string,
  snapshot: MissionControlSnapshot | null,
  registry: ChannelRegistry | null = snapshot?.channelRegistry ?? null
): DiscordCoordinationContext | null {
  if (!registry) {
    return null;
  }

  const currentAgent = snapshot?.agents.find((agent) => agent.id === agentId) ?? null;
  const currentWorkspaceId = currentAgent?.workspaceId ?? null;
  const primaryChannels: DiscordCoordinationChannelSummary[] = [];
  const ownedRoutes: DiscordOwnedRouteSummary[] = [];
  const delegateChannels: Array<
    DiscordCoordinationChannelSummary & {
      primaryAgentId: string;
      primaryAgentName: string;
    }
  > = [];

  for (const channel of registry.channels.filter((entry) => entry.type === "discord")) {
    const workspaceBindings = channel.workspaces.filter((workspace) => workspace.workspaceId === currentWorkspaceId);

    if (workspaceBindings.length === 0) {
      continue;
    }

    const routes = uniqueByChatId(
      workspaceBindings.flatMap((workspace) =>
        workspace.groupAssignments.filter((assignment) => assignment.enabled !== false)
      )
    ).map(describeDiscordRouteAssignment);
    const ownedAssignments = uniqueByChatId(
      workspaceBindings.flatMap((workspace) =>
        workspace.groupAssignments.filter((assignment) => assignment.enabled !== false && assignment.agentId === agentId)
      )
    ).map(describeDiscordRouteAssignment);
    const fallbackRoutes = routes.filter(
      (route) =>
        !ownedAssignments.some((assignment) => assignment.routeId === route.routeId) &&
        !workspaceBindings.some((workspace) =>
          workspace.groupAssignments.some(
            (assignment) =>
              assignment.enabled !== false && assignment.chatId === route.routeId && assignment.agentId
          )
        )
    );

    if (channel.primaryAgentId === agentId) {
      const peers = buildSurfacePeerSummaries(
        snapshot,
        workspaceBindings.flatMap((workspace) => workspace.agentIds.filter((candidate) => candidate !== agentId)),
        [agentId]
      );

      primaryChannels.push({
        channelId: channel.id,
        channelName: channel.name,
        routes: fallbackRoutes,
        peers
      });
    }

    for (const assignment of ownedAssignments) {
      const peers = buildSurfacePeerSummaries(
        snapshot,
        workspaceBindings.flatMap((workspace) =>
          workspace.agentIds.filter((candidate) => candidate !== agentId && candidate !== channel.primaryAgentId)
        ),
        [agentId, channel.primaryAgentId ?? ""]
      );

      ownedRoutes.push({
        channelId: channel.id,
        channelName: channel.name,
        routeId: assignment.routeId,
        label: assignment.label,
        kind: assignment.kind,
        guildId: assignment.guildId,
        primaryAgentId: channel.primaryAgentId ?? agentId,
        primaryAgentName: resolveAgentDisplayName(
          snapshot?.agents.find((entry) => entry.id === (channel.primaryAgentId ?? agentId)) ?? null,
          channel.primaryAgentId ?? agentId
        ),
        peers
      });
    }

    if (channel.primaryAgentId && channel.primaryAgentId !== agentId) {
      const peers = buildSurfacePeerSummaries(
        snapshot,
        workspaceBindings.flatMap((workspace) =>
          workspace.agentIds.filter(
            (candidate) => candidate !== channel.primaryAgentId && candidate !== agentId
          )
        ),
        [agentId, channel.primaryAgentId]
      );

      delegateChannels.push({
        channelId: channel.id,
        channelName: channel.name,
        routes: fallbackRoutes,
        peers,
        primaryAgentId: channel.primaryAgentId,
        primaryAgentName: resolveAgentDisplayName(
          snapshot?.agents.find((entry) => entry.id === channel.primaryAgentId) ?? null,
          channel.primaryAgentId
        )
      });
    }
  }

  return {
    primaryChannels: primaryChannels.sort((left, right) => left.channelName.localeCompare(right.channelName)),
    ownedRoutes: ownedRoutes.sort((left, right) => {
      const leftLabel = `${left.channelName}:${left.label}`;
      const rightLabel = `${right.channelName}:${right.label}`;
      return leftLabel.localeCompare(rightLabel);
    }),
    delegateChannels: delegateChannels.sort((left, right) => left.channelName.localeCompare(right.channelName))
  };
}

function renderDiscordCoordinationMarkdown(coordination: DiscordCoordinationContext | null | undefined) {
  if (
    !coordination ||
    (coordination.primaryChannels.length === 0 &&
      coordination.ownedRoutes.length === 0 &&
      coordination.delegateChannels.length === 0)
  ) {
    return null;
  }

  const lines: string[] = ["## Discord coordination"];

  if (coordination.primaryChannels.length > 0) {
    lines.push("- You are the public Discord fallback for these channels:");
    for (const channel of coordination.primaryChannels) {
      const routeSummary =
        channel.routes.length > 0
          ? channel.routes.map((route) => `${route.label} (\`${route.routeId}\`)`).join(", ")
          : "no allowed routes yet";
      lines.push(`  - ${channel.channelName} (\`${channel.channelId}\`) · fallback routes: ${routeSummary}.`);
      if (channel.peers.length > 0) {
        lines.push("  - Internal assistants:");
        for (const peer of channel.peers) {
          lines.push(`    - ${peer.name} (\`${peer.agentId}\`) · ${peer.summary}.`);
        }
      }
    }
    lines.push("- Keep public Discord replies under your own voice for unassigned routes, even when you ask another agent for help.");
  }

  if (coordination.ownedRoutes.length > 0) {
    lines.push("- You are the public Discord voice for these assigned routes:");
    for (const route of coordination.ownedRoutes) {
      lines.push(
        `  - ${route.channelName} (\`${route.channelId}\`) · ${route.label} (\`${route.routeId}\`) · primary ${route.primaryAgentName} (\`${route.primaryAgentId}\`).`
      );
      if (route.peers.length > 0) {
        lines.push("  - Internal assistants for this route:");
        for (const peer of route.peers) {
          lines.push(`    - ${peer.name} (\`${peer.agentId}\`) · ${peer.summary}.`);
        }
      }
    }
    lines.push("- Reply directly to those routes as the public voice. Use other agents only for internal help.");
  }

  if (coordination.delegateChannels.length > 0) {
    lines.push("- You can assist these Discord admin channels when the primary agent asks:");
    for (const channel of coordination.delegateChannels) {
      const routeSummary =
        channel.routes.length > 0
          ? channel.routes.map((route) => `${route.label} (\`${route.routeId}\`)`).join(", ")
          : "no allowed routes yet";
      lines.push(
        `  - ${channel.channelName} (\`${channel.channelId}\`) · primary ${channel.primaryAgentName} (\`${channel.primaryAgentId}\`) · routes: ${routeSummary}.`
      );
      if (channel.peers.length > 0) {
        lines.push("    - Nearby assistants:");
        for (const peer of channel.peers) {
          lines.push(`      - ${peer.name} (\`${peer.agentId}\`) · ${peer.summary}.`);
        }
      }
    }
    lines.push("- When helping with Discord work, return concise internal findings or draft language. Do not speak as the public Discord agent.");
  }

  return lines.join("\n");
}

export function renderWorkspaceSurfaceCoordinationMarkdownForAgent(
  agentId: string,
  snapshot: MissionControlSnapshot | null,
  registry: ChannelRegistry | null = snapshot?.channelRegistry ?? null
) {
  const sections = [
    renderTelegramCoordinationMarkdown(buildTelegramCoordinationContext(agentId, snapshot, registry)),
    renderDiscordCoordinationMarkdown(buildDiscordCoordinationContext(agentId, snapshot, registry))
  ].filter((section): section is string => Boolean(section));

  return sections.length > 0 ? sections.join("\n\n") : null;
}
