import type { MissionControlSnapshot } from "@/lib/openclaw/types";
import { getSurfaceCatalogEntry } from "@/lib/openclaw/surface-catalog";

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeChannelIds(values: string[]) {
  return uniqueStrings(values.map((value) => value.trim()).filter(Boolean));
}

type ChannelMutationResponse = {
  error?: string;
  registry?: MissionControlSnapshot["channelRegistry"];
};

export function getWorkspaceChannels(snapshot: MissionControlSnapshot, workspaceId: string) {
  return snapshot.channelRegistry.channels
    .filter((channel) => channel.workspaces.some((binding) => binding.workspaceId === workspaceId))
    .sort((left, right) => {
      const leftKind = getSurfaceCatalogEntry(left.type).kind;
      const rightKind = getSurfaceCatalogEntry(right.type).kind;

      if (leftKind !== rightKind) {
        return leftKind.localeCompare(rightKind);
      }

      if (left.type !== right.type) {
        return getSurfaceCatalogEntry(left.type).label.localeCompare(getSurfaceCatalogEntry(right.type).label);
      }

      return left.name.localeCompare(right.name);
    });
}

export function getWorkspaceChannelIdsForAgent(
  snapshot: MissionControlSnapshot,
  workspaceId: string,
  agentId: string
) {
  return getWorkspaceChannels(snapshot, workspaceId)
    .filter((channel) =>
      channel.primaryAgentId === agentId ||
      channel.workspaces.some(
        (binding) =>
          binding.workspaceId === workspaceId &&
          (binding.agentIds.includes(agentId) ||
            binding.groupAssignments.some((assignment) => assignment.enabled !== false && assignment.agentId === agentId))
      )
    )
    .map((channel) => channel.id);
}

export function replaceSnapshotChannelRegistry(
  snapshot: MissionControlSnapshot,
  channelRegistry: MissionControlSnapshot["channelRegistry"]
) {
  return {
    ...snapshot,
    channelRegistry
  };
}

export function upsertSnapshotChannelAccount(
  snapshot: MissionControlSnapshot,
  account: MissionControlSnapshot["channelAccounts"][number]
) {
  const nextAccounts = snapshot.channelAccounts.filter((entry) => entry.id !== account.id);

  return {
    ...snapshot,
    channelAccounts: [...nextAccounts, account]
  };
}

export function removeSnapshotChannelAccount(snapshot: MissionControlSnapshot, accountId: string) {
  return {
    ...snapshot,
    channelAccounts: snapshot.channelAccounts.filter((entry) => entry.id !== accountId)
  };
}

export async function syncWorkspaceAgentChannelBindings(input: {
  workspaceId: string;
  workspacePath: string;
  agentId: string;
  currentChannelIds: string[];
  nextChannelIds: string[];
  onRegistryChange?: (updater: (snapshot: MissionControlSnapshot) => MissionControlSnapshot) => void;
}) {
  const currentChannelIds = normalizeChannelIds(input.currentChannelIds);
  const nextChannelIds = normalizeChannelIds(input.nextChannelIds);
  const added = nextChannelIds.filter((channelId) => !currentChannelIds.includes(channelId));
  const removed = currentChannelIds.filter((channelId) => !nextChannelIds.includes(channelId));

  for (const channelId of added) {
    const response = await fetch(`/api/workspaces/${encodeURIComponent(input.workspaceId)}/channels`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "bind-agent",
        channelId,
        agentId: input.agentId,
        workspacePath: input.workspacePath
      })
    });

    const payload = (await response.json()) as ChannelMutationResponse;

    if (!response.ok || payload.error) {
      throw new Error(payload.error || "OpenClaw could not bind the channel.");
    }

    if (payload.registry && input.onRegistryChange) {
      input.onRegistryChange((current) => replaceSnapshotChannelRegistry(current, payload.registry!));
    }
  }

  for (const channelId of removed) {
    const response = await fetch(`/api/workspaces/${encodeURIComponent(input.workspaceId)}/channels`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "unbind-agent",
        channelId,
        agentId: input.agentId
      })
    });

    const payload = (await response.json()) as ChannelMutationResponse;

    if (!response.ok || payload.error) {
      throw new Error(payload.error || "OpenClaw could not unbind the channel.");
    }

    if (payload.registry && input.onRegistryChange) {
      input.onRegistryChange((current) => replaceSnapshotChannelRegistry(current, payload.registry!));
    }
  }
}
