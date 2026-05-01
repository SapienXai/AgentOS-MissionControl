import "server-only";

import { access, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  getMissionControlSnapshot,
  invalidateMissionControlSnapshotCache
} from "@/lib/openclaw/application/mission-control-service";
import { runOpenClaw } from "@/lib/openclaw/cli";
import {
  filterAgentPolicySkills,
  upsertAgentConfigEntry
} from "@/lib/openclaw/domains/agent-config";
import {
  ensureAgentPolicySkill as ensureAgentPolicySkillFromProvisioning
} from "@/lib/openclaw/domains/agent-provisioning";
import {
  buildManagedDiscordBinding,
  discoverDiscordRoutes,
  discoverSurfaceRoutes,
  discoverTelegramGroups,
  getChannelRegistry,
  parseDiscordRouteId,
  readChannelAccounts,
  readChannelRegistry
} from "@/lib/openclaw/domains/channels";
import type { ManagedDiscordBinding } from "@/lib/openclaw/domains/channels";
import {
  normalizeChannelRegistry,
  uniqueByChatId
} from "@/lib/openclaw/domains/workspace-manifest";
import { writeTextFileEnsured } from "@/lib/openclaw/domains/workspace-bootstrap";
import { normalizeOptionalValue } from "@/lib/openclaw/domains/control-plane-normalization";
import { channelRegistryPath } from "@/lib/openclaw/state/paths";
import { measureTiming, type TimingCollector } from "@/lib/openclaw/timing";
import type {
  ChannelRegistry,
  MissionControlSnapshot,
  MissionControlSurfaceProvider,
  PlannerChannelType,
  WorkspaceChannelGroupAssignment,
  WorkspaceChannelSummary,
  WorkspaceChannelWorkspaceBinding
} from "@/lib/openclaw/types";

export {
  discoverDiscordRoutes,
  discoverSurfaceRoutes,
  discoverTelegramGroups,
  getChannelRegistry
};

function invalidateSnapshotCache() {
  invalidateMissionControlSnapshotCache();
}

export async function upsertWorkspaceChannel(input: {
  workspaceId: string;
  workspacePath: string;
  channelId: string;
  type: MissionControlSurfaceProvider;
  name: string;
  primaryAgentId?: string | null;
  agentIds?: string[];
  groupAssignments?: WorkspaceChannelGroupAssignment[];
}, timings?: TimingCollector) {
  const channelId = normalizeChannelId(input.channelId);
  if (!channelId) {
    throw new Error("Channel id is required.");
  }

  await measureTiming(timings, "workspace-channel.registry-upsert", () =>
    mutateChannelRegistry((registry) => {
      const existingChannel = registry.channels.find((entry) => entry.id === channelId);
      const nextChannel: WorkspaceChannelSummary =
        existingChannel ??
        ({
          id: channelId,
          type: input.type,
          name: input.name.trim() || channelId,
          primaryAgentId: normalizeOptionalValue(input.primaryAgentId) ?? null,
          workspaces: []
        } satisfies WorkspaceChannelSummary);
      const workspaceId = input.workspaceId.trim();
      const workspacePath = input.workspacePath.trim();
      const workspaceBinding =
        nextChannel.workspaces.find((entry) => entry.workspaceId === workspaceId) ??
        ({
          workspaceId,
          workspacePath,
          agentIds: [],
          groupAssignments: []
        } satisfies WorkspaceChannelWorkspaceBinding);
      const nextAgentIds = uniqueStrings([
        ...workspaceBinding.agentIds,
        ...(input.agentIds ?? []).map((entry) => entry.trim()).filter(Boolean)
      ]);
      const nextGroupAssignments = uniqueByChatId([
        ...workspaceBinding.groupAssignments,
        ...(input.groupAssignments ?? []).filter((assignment) => Boolean(assignment.chatId))
      ]);

      const mergedWorkspaceBinding: WorkspaceChannelWorkspaceBinding = {
        ...workspaceBinding,
        workspacePath,
        agentIds: nextAgentIds,
        groupAssignments: nextGroupAssignments
      };

      const workspaceBindings = nextChannel.workspaces.filter((entry) => entry.workspaceId !== workspaceId);
      workspaceBindings.push(mergedWorkspaceBinding);

      const nextPrimaryAgentId = normalizeOptionalValue(input.primaryAgentId) ?? nextChannel.primaryAgentId;

      registry.channels = [
        ...registry.channels.filter((entry) => entry.id !== channelId),
        {
          ...nextChannel,
          id: channelId,
          type: input.type,
          name: input.name.trim() || nextChannel.name || channelId,
          primaryAgentId:
            nextPrimaryAgentId ||
            mergedWorkspaceBinding.agentIds[0] ||
            mergedWorkspaceBinding.groupAssignments.find((assignment) => assignment.agentId)?.agentId ||
            null,
          workspaces: workspaceBindings
        }
      ];
    }, {}, timings)
  );

  invalidateSnapshotCache();
  return getChannelRegistry();
}

export async function disconnectWorkspaceChannel(input: {
  workspaceId: string;
  channelId: string;
}, timings?: TimingCollector) {
  const channelId = normalizeChannelId(input.channelId);
  if (!channelId) {
    throw new Error("Channel id is required.");
  }

  await measureTiming(timings, "channel-registry.disconnect", () =>
    mutateChannelRegistry((registry) => {
      registry.channels = registry.channels
        .map((channel) => {
          if (channel.id !== channelId) {
            return channel;
          }

          const workspaceBindings = channel.workspaces.filter((entry) => entry.workspaceId !== input.workspaceId);
          const remainingCandidates = uniqueStrings([
            ...workspaceBindings.flatMap((binding) => binding.agentIds),
            ...workspaceBindings.flatMap((binding) =>
              binding.groupAssignments
                .filter((assignment) => assignment.enabled !== false && assignment.agentId)
                .map((assignment) => assignment.agentId as string)
            )
          ]);

          return {
            ...channel,
            primaryAgentId: channel.primaryAgentId && remainingCandidates.includes(channel.primaryAgentId)
              ? channel.primaryAgentId
              : remainingCandidates[0] ?? null,
            workspaces: workspaceBindings
          };
        })
        .filter((channel) => channel.workspaces.length > 0 || channel.primaryAgentId);
    }, {}, timings)
  );

  invalidateSnapshotCache();
  return getChannelRegistry();
}

export async function deleteWorkspaceChannelEverywhere(input: {
  channelId: string;
}, timings?: TimingCollector) {
  const channelId = normalizeChannelId(input.channelId);
  if (!channelId) {
    throw new Error("Channel id is required.");
  }

  const registry = await measureTiming(timings, "channel-registry.read-before-delete", () => readChannelRegistry());
  const channel = registry.channels.find((entry) => entry.id === channelId);

  if (!channel) {
    throw new Error("Channel was not found.");
  }

  const removedGroupIds = uniqueStrings(
    channel.workspaces.flatMap((workspace) =>
      workspace.groupAssignments
        .filter((assignment) => Boolean(assignment.chatId))
        .map((assignment) => assignment.chatId)
    )
  );
  const workspacePaths = uniqueStrings(channel.workspaces.map((workspace) => workspace.workspacePath));

  if (isPlannerChannelTypeValue(channel.type) && channel.type !== "internal") {
    await measureTiming(timings, "channel.delete-openclaw-remove", () =>
      runOpenClaw(["channels", "remove", "--channel", channel.type, "--account", channelId, "--delete"], {
        timeoutMs: 60000
      })
    );
  }

  await measureTiming(timings, "channel.delete-registry-sync", () =>
    mutateChannelRegistry(
      (nextRegistry) => {
        nextRegistry.channels = nextRegistry.channels.filter((entry) => entry.id !== channelId);
      },
      {
        removedAccountIds: [channelId],
        removedGroupIds
      },
      timings
    )
  );

  await measureTiming(timings, "channel.delete-project-cleanup", () =>
    Promise.all(
      workspacePaths.map((workspacePath) =>
        removeWorkspaceProjectChannelReferences(workspacePath, channelId, timings)
      )
    )
  );

  invalidateSnapshotCache();
  return measureTiming(timings, "channel.delete-read-final-registry", () => getChannelRegistry());
}

export async function setWorkspaceChannelPrimary(input: {
  channelId: string;
  primaryAgentId: string | null;
}, timings?: TimingCollector) {
  const channelId = normalizeChannelId(input.channelId);
  if (!channelId) {
    throw new Error("Channel id is required.");
  }

  await measureTiming(timings, "channel.primary-update", () =>
    mutateChannelRegistry((registry) => {
      const channel = registry.channels.find((entry) => entry.id === channelId);
      if (!channel) {
        throw new Error("Channel was not found.");
      }

      channel.primaryAgentId = normalizeOptionalValue(input.primaryAgentId) ?? null;
    }, {}, timings)
  );

  invalidateSnapshotCache();
  return getChannelRegistry();
}

export async function setWorkspaceChannelGroups(input: {
  channelId: string;
  workspaceId: string;
  groupAssignments: WorkspaceChannelGroupAssignment[];
}, timings?: TimingCollector) {
  const channelId = normalizeChannelId(input.channelId);
  if (!channelId) {
    throw new Error("Channel id is required.");
  }

  const removedGroupIds: string[] = [];

  await measureTiming(timings, "channel.groups-update", () =>
    mutateChannelRegistry((registry) => {
      const channel = registry.channels.find((entry) => entry.id === channelId);
      if (!channel) {
        throw new Error("Channel was not found.");
      }

      const workspace = channel.workspaces.find((entry) => entry.workspaceId === input.workspaceId);
      if (!workspace) {
        throw new Error("Workspace binding was not found for this channel.");
      }

      const previousGroupIds = new Set(
        workspace.groupAssignments
          .filter((assignment) => assignment.enabled !== false && Boolean(assignment.chatId))
          .map((assignment) => assignment.chatId)
      );

      workspace.groupAssignments = uniqueByChatId(
        input.groupAssignments.map((assignment) => ({
          chatId: assignment.chatId.trim(),
          agentId: normalizeOptionalValue(assignment.agentId) ?? null,
          title: normalizeOptionalValue(assignment.title) ?? null,
          enabled: assignment.enabled !== false
        }))
      );
      workspace.agentIds = uniqueStrings([
        ...workspace.agentIds,
        ...workspace.groupAssignments
          .filter((assignment) => assignment.enabled !== false && assignment.agentId)
          .map((assignment) => assignment.agentId as string)
      ]);

      const nextGroupIds = new Set(
        workspace.groupAssignments
          .filter((assignment) => assignment.enabled !== false && Boolean(assignment.chatId))
          .map((assignment) => assignment.chatId)
      );

      for (const chatId of previousGroupIds) {
        if (!nextGroupIds.has(chatId)) {
          removedGroupIds.push(chatId);
        }
      }
    }, { removedGroupIds }, timings)
  );

  invalidateSnapshotCache();
  return getChannelRegistry();
}

export async function bindWorkspaceChannelAgent(input: {
  channelId: string;
  workspaceId: string;
  workspacePath: string;
  agentId: string;
}, timings?: TimingCollector) {
  const channelId = normalizeChannelId(input.channelId);
  const agentId = slugify(input.agentId.trim());
  if (!channelId || !agentId) {
    throw new Error("Channel id and agent id are required.");
  }

  await measureTiming(timings, "channel.bind-agent", () =>
    mutateChannelRegistry((registry) => {
      const channel = registry.channels.find((entry) => entry.id === channelId);
      if (!channel) {
        throw new Error("Channel was not found.");
      }

      const workspace = channel.workspaces.find((entry) => entry.workspaceId === input.workspaceId);
      const nextWorkspace: WorkspaceChannelWorkspaceBinding =
        workspace ??
        ({
          workspaceId: input.workspaceId,
          workspacePath: input.workspacePath,
          agentIds: [],
          groupAssignments: []
        } satisfies WorkspaceChannelWorkspaceBinding);

      nextWorkspace.agentIds = uniqueStrings([...nextWorkspace.agentIds, agentId]);
      nextWorkspace.workspacePath = input.workspacePath;
      channel.workspaces = [
        ...channel.workspaces.filter((entry) => entry.workspaceId !== input.workspaceId),
        nextWorkspace
      ];

      if (!channel.primaryAgentId) {
        channel.primaryAgentId = agentId;
      }
    }, {}, timings)
  );

  invalidateSnapshotCache();
  return getChannelRegistry();
}

export async function unbindWorkspaceChannelAgent(input: {
  channelId: string;
  workspaceId: string;
  agentId: string;
}, timings?: TimingCollector) {
  const channelId = normalizeChannelId(input.channelId);
  const agentId = slugify(input.agentId.trim());
  if (!channelId || !agentId) {
    throw new Error("Channel id and agent id are required.");
  }

  await measureTiming(timings, "channel.unbind-agent", () =>
    mutateChannelRegistry((registry) => {
      const channel = registry.channels.find((entry) => entry.id === channelId);
      if (!channel) {
        throw new Error("Channel was not found.");
      }

      const workspace = channel.workspaces.find((entry) => entry.workspaceId === input.workspaceId);
      if (!workspace) {
        return;
      }

      workspace.agentIds = workspace.agentIds.filter((entry) => entry !== agentId);
      workspace.groupAssignments = workspace.groupAssignments.filter((assignment) => assignment.agentId !== agentId);

      if (channel.primaryAgentId === agentId) {
        const fallbackAgent =
          workspace.agentIds[0] ??
          workspace.groupAssignments.find((assignment) => assignment.enabled !== false && assignment.agentId)?.agentId ??
          channel.workspaces
            .flatMap((binding) => binding.agentIds)
            .find((candidate) => candidate !== agentId) ??
          channel.workspaces
            .flatMap((binding) => binding.groupAssignments)
            .find((assignment) => assignment.enabled !== false && assignment.agentId && assignment.agentId !== agentId)
            ?.agentId ??
          null;
        channel.primaryAgentId = fallbackAgent;
      }

      channel.workspaces = [
        ...channel.workspaces.filter((entry) => entry.workspaceId !== input.workspaceId),
        {
          ...workspace,
          agentIds: workspace.agentIds,
          groupAssignments: workspace.groupAssignments
        }
      ];
    }, {}, timings)
  );

  invalidateSnapshotCache();
  return getChannelRegistry();
}

export async function createManagedSurfaceAccount(...args: Parameters<typeof import("@/lib/openclaw/service").createManagedSurfaceAccount>) {
  const service = await import("@/lib/openclaw/service");
  return service.createManagedSurfaceAccount(...args);
}

export async function createTelegramChannelAccount(...args: Parameters<typeof import("@/lib/openclaw/service").createTelegramChannelAccount>) {
  const service = await import("@/lib/openclaw/service");
  return service.createTelegramChannelAccount(...args);
}

async function writeChannelRegistry(registry: ChannelRegistry) {
  await writeTextFileEnsured(channelRegistryPath, `${JSON.stringify(registry, null, 2)}\n`);
}

async function removeWorkspaceProjectChannelReferences(
  workspacePath: string,
  channelId: string,
  timings?: TimingCollector
) {
  const projectFilePath = path.join(workspacePath, ".openclaw", "project.json");
  let parsed: Record<string, unknown> = {};

  try {
    const raw = await measureTiming(timings, `workspace-project.${path.basename(workspacePath)}.read`, () =>
      readFile(projectFilePath, "utf8")
    );
    const candidate = JSON.parse(raw);
    parsed = isObjectRecord(candidate) ? candidate : {};
  } catch {
    return;
  }

  if (!Array.isArray(parsed.agents)) {
    return;
  }

  let didChange = false;
  const nextAgents = parsed.agents.map((entry) => {
    if (!isObjectRecord(entry) || typeof entry.id !== "string") {
      return entry;
    }

    const currentChannelIds = Array.isArray(entry.channelIds)
      ? entry.channelIds.filter((value): value is string => typeof value === "string")
      : [];
    const nextChannelIds = currentChannelIds.filter((entry) => entry !== channelId);

    if (nextChannelIds.length === currentChannelIds.length) {
      return entry;
    }

    didChange = true;
    return {
      ...entry,
      channelIds: nextChannelIds
    };
  });

  if (!didChange) {
    return;
  }

  parsed.updatedAt = new Date().toISOString();
  parsed.agents = nextAgents;

  await measureTiming(timings, `workspace-project.${path.basename(workspacePath)}.write`, () =>
    writeTextFileEnsured(projectFilePath, `${JSON.stringify(parsed, null, 2)}\n`)
  );
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function cloneChannelRegistry(registry: ChannelRegistry): ChannelRegistry {
  return normalizeChannelRegistry({
    version: 1,
    channels: registry.channels.map((channel) => ({
      ...channel,
      workspaces: channel.workspaces.map((workspace) => ({
        ...workspace,
        agentIds: [...workspace.agentIds],
        groupAssignments: workspace.groupAssignments.map((assignment) => ({ ...assignment }))
      }))
    }))
  });
}

async function saveChannelRegistry(registry: ChannelRegistry) {
  await writeChannelRegistry(normalizeChannelRegistry(registry));
}

type ManagedTelegramRoutingCleanup = {
  removedAccountIds?: string[];
  removedGroupIds?: string[];
};

type DiscordGuildConfig = Record<
  string,
  {
    requireMention?: boolean;
    roles?: unknown;
    channels?: Record<string, unknown>;
    name?: string;
  }
>;

async function updateManagedSurfaceRouting(
  registry: ChannelRegistry,
  cleanup: ManagedTelegramRoutingCleanup = {},
  timings?: TimingCollector
) {
  const currentBindings = await measureTiming(timings, "routing.read-bindings", () =>
    getOpenClawAdapter().getConfig<unknown[]>("bindings").then((value) => value ?? [])
  );

  const managedChannels = registry.channels.filter(
    (channel) => isPlannerChannelTypeValue(channel.type) && channel.type !== "internal"
  );
  const removedAccountIds = new Set(cleanup.removedAccountIds ?? []);
  const removedGroupIds = new Set(cleanup.removedGroupIds ?? []);
  const managedAccountIdsByProvider = new Map<string, Set<string>>();

  for (const channel of managedChannels) {
    const current = managedAccountIdsByProvider.get(channel.type) ?? new Set<string>();
    current.add(channel.id);
    managedAccountIdsByProvider.set(channel.type, current);
  }

  const managedTelegramChannels = managedChannels.filter((channel) => channel.type === "telegram");
  const managedDiscordChannels = managedChannels.filter((channel) => channel.type === "discord");

  const nextBindings = dedupeManagedBindings([
    ...currentBindings.filter((entry) => {
      if (!isObjectRecord(entry)) {
        return true;
      }

      const match = isObjectRecord(entry.match) ? entry.match : null;
      if (!match || typeof match.channel !== "string") {
        return true;
      }

      const managedAccountIds = managedAccountIdsByProvider.get(match.channel);
      if (
        managedAccountIds &&
        typeof match.accountId === "string" &&
        (managedAccountIds.has(match.accountId) || removedAccountIds.has(match.accountId))
      ) {
        return false;
      }

      if (
        match.channel === "telegram" &&
        isObjectRecord(match.peer) &&
        typeof match.peer.id === "string" &&
        removedGroupIds.has(match.peer.id)
      ) {
        return false;
      }

      return true;
    }),
    ...managedChannels
      .filter((channel) => Boolean(channel.primaryAgentId))
      .map((channel) => ({
        agentId: channel.primaryAgentId as string,
        match: {
          channel: channel.type,
          accountId: channel.id
        }
      })),
    ...managedTelegramChannels.flatMap((channel) =>
      channel.workspaces.flatMap((workspace) =>
        workspace.groupAssignments
          .filter((assignment) => assignment.enabled !== false && assignment.agentId)
          .flatMap((assignment) => {
            const agentId = assignment.agentId as string;

            return [
              {
                agentId,
                match: {
                  channel: "telegram",
                  accountId: channel.id
                }
              },
              {
                agentId,
                match: {
                  channel: "telegram",
                  accountId: channel.id,
                  peer: {
                    kind: "group",
                    id: assignment.chatId
                  }
                }
              }
            ];
          })
      )
    ),
    ...managedDiscordChannels.flatMap((channel) =>
      channel.workspaces.flatMap((workspace) =>
        workspace.groupAssignments
          .filter((assignment) => assignment.enabled !== false && assignment.agentId)
          .map((assignment) => buildManagedDiscordBinding(channel.id, assignment))
          .filter((binding): binding is Exclude<ManagedDiscordBinding, null> => Boolean(binding))
      )
    )
  ]);

  await measureTiming(timings, "routing.write-bindings", () =>
    getOpenClawAdapter().setConfig("bindings", nextBindings, { strictJson: true })
  );
  await measureTiming(timings, "routing.sync-telegram-settings", () =>
    syncManagedTelegramSettings(managedTelegramChannels, timings)
  );
  await measureTiming(timings, "routing.sync-discord-settings", () =>
    syncManagedDiscordSettings(managedDiscordChannels, timings)
  );
}

function dedupeManagedBindings(bindings: unknown[]) {
  const seen = new Set<string>();

  return bindings.filter((binding) => {
    const key = JSON.stringify(binding);
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

async function syncManagedTelegramSettings(managedChannels: WorkspaceChannelSummary[], timings?: TimingCollector) {
  await measureTiming(timings, "telegram-settings.enabled", () =>
    getOpenClawAdapter().setConfig("channels.telegram.enabled", managedChannels.length > 0, {
      strictJson: true
    })
  );

  const defaultAccountId = await measureTiming(timings, "telegram-settings.default-account-resolve", () =>
    resolveManagedTelegramDefaultAccountId(managedChannels, timings)
  );

  if (defaultAccountId) {
    await measureTiming(timings, "telegram-settings.default-account", () =>
      getOpenClawAdapter().setConfig("channels.telegram.defaultAccount", defaultAccountId, {
        strictJson: true
      })
    );
  } else {
    await measureTiming(timings, "telegram-settings.default-account-unset", () =>
      getOpenClawAdapter().unsetConfig("channels.telegram.defaultAccount").catch(() => {})
    );
  }

  const nextGroupsConfig = Object.fromEntries(
    managedChannels.flatMap((channel) =>
      channel.workspaces.flatMap((workspace) =>
        workspace.groupAssignments
          .filter((assignment) => assignment.enabled !== false)
          .map((assignment) => [assignment.chatId, { requireMention: true }] as const)
      )
    )
  );

  await measureTiming(timings, "telegram-settings.groups", () =>
    getOpenClawAdapter().setConfig("channels.telegram.groups", nextGroupsConfig, {
      strictJson: true
    })
  );

  if (defaultAccountId) {
    await measureTiming(timings, "telegram-settings.reconcile-session-stores", () =>
      reconcileManagedTelegramSessionStores(managedChannels, defaultAccountId, timings)
    );
  }
}

function collectManagedTelegramSessionStoreRoots(managedChannels: WorkspaceChannelSummary[]) {
  return uniqueStrings([
    path.join(os.homedir(), ".openclaw", "agents"),
    ...managedChannels.flatMap((channel) =>
      channel.workspaces.map((workspace) => path.join(workspace.workspacePath, ".openclaw", "agents"))
    )
  ]);
}

function isTelegramSessionStoreEntry(value: unknown): value is Record<string, unknown> {
  if (!isObjectRecord(value)) {
    return false;
  }

  if (value.channel === "telegram" || value.lastChannel === "telegram") {
    return true;
  }

  const deliveryContext = isObjectRecord(value.deliveryContext) ? value.deliveryContext : null;
  if (deliveryContext?.channel === "telegram") {
    return true;
  }

  const origin = isObjectRecord(value.origin) ? value.origin : null;
  return origin?.provider === "telegram";
}

function resolveTelegramSessionStoreAccountId(value: Record<string, unknown>) {
  const lastAccountId = normalizeOptionalValue(typeof value.lastAccountId === "string" ? value.lastAccountId : null);
  if (lastAccountId) {
    return lastAccountId;
  }

  const deliveryContext = isObjectRecord(value.deliveryContext) ? value.deliveryContext : null;
  const deliveryAccountId = normalizeOptionalValue(
    typeof deliveryContext?.accountId === "string" ? deliveryContext.accountId : null
  );
  if (deliveryAccountId) {
    return deliveryAccountId;
  }

  const origin = isObjectRecord(value.origin) ? value.origin : null;
  return normalizeOptionalValue(typeof origin?.accountId === "string" ? origin.accountId : null);
}

async function reconcileTelegramSessionStoreFile(
  filePath: string,
  preferredAccountId: string,
  knownAccountIds: Set<string>,
  timings?: TimingCollector
) {
  try {
    const raw = await measureTiming(timings, `telegram-settings.read-session-store.${path.basename(filePath)}`, () =>
      readFile(filePath, "utf8")
    );
    const parsed = JSON.parse(raw);
    if (!isObjectRecord(parsed)) {
      return false;
    }

    let changed = false;

    for (const entry of Object.values(parsed)) {
      if (!isTelegramSessionStoreEntry(entry)) {
        continue;
      }

      const currentAccountId = resolveTelegramSessionStoreAccountId(entry);
      if (currentAccountId && knownAccountIds.has(currentAccountId)) {
        continue;
      }

      if (entry.lastAccountId !== preferredAccountId) {
        entry.lastAccountId = preferredAccountId;
        changed = true;
      }

      if (isObjectRecord(entry.deliveryContext) && entry.deliveryContext.accountId !== preferredAccountId) {
        entry.deliveryContext.accountId = preferredAccountId;
        changed = true;
      }

      if (isObjectRecord(entry.origin) && entry.origin.accountId !== preferredAccountId) {
        entry.origin.accountId = preferredAccountId;
        changed = true;
      }
    }

    if (!changed) {
      return false;
    }

    await measureTiming(timings, `telegram-settings.write-session-store.${path.basename(filePath)}`, () =>
      writeTextFileEnsured(filePath, `${JSON.stringify(parsed, null, 2)}\n`)
    );
    return true;
  } catch {
    return false;
  }
}

async function reconcileManagedTelegramSessionStores(
  managedChannels: WorkspaceChannelSummary[],
  preferredAccountId: string,
  timings?: TimingCollector
) {
  const knownAccountIds = new Set(
    (await readChannelAccounts())
      .filter((account) => account.type === "telegram")
      .map((account) => account.id)
  );
  knownAccountIds.add(preferredAccountId);

  for (const root of collectManagedTelegramSessionStoreRoots(managedChannels)) {
    let entries;

    try {
      entries = await measureTiming(timings, `telegram-settings.read-agent-root.${path.basename(root)}`, () =>
        readdir(root, { withFileTypes: true })
      );
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const sessionsPath = path.join(root, entry.name, "sessions", "sessions.json");
      try {
        await access(sessionsPath);
      } catch {
        continue;
      }

      await reconcileTelegramSessionStoreFile(sessionsPath, preferredAccountId, knownAccountIds, timings);
    }
  }
}

async function resolveManagedTelegramDefaultAccountId(
  managedChannels: WorkspaceChannelSummary[],
  timings?: TimingCollector
) {
  const channelAccounts = await measureTiming(timings, "telegram-settings.read-channel-accounts", () =>
    readChannelAccounts()
  );
  const telegramAccounts = channelAccounts.filter((account) => account.type === "telegram");
  const tokenBackedAccounts = telegramAccounts.filter(
    (account) => typeof account.metadata?.botId === "string" && account.metadata.botId.trim().length > 0
  );
  const managedChannelIds = new Set(managedChannels.map((channel) => channel.id));

  for (const channel of managedChannels) {
    const managedMatch = tokenBackedAccounts.find((account) => account.id === channel.id) ?? null;
    if (managedMatch) {
      return managedMatch.id;
    }
  }

  if (tokenBackedAccounts.length === 1) {
    return tokenBackedAccounts[0].id;
  }

  if (tokenBackedAccounts.length > 1) {
    const managedMatch =
      telegramAccounts.find(
        (account) =>
          managedChannelIds.has(account.id) &&
          typeof account.metadata?.botId === "string" &&
          account.metadata.botId.trim().length > 0
      ) ?? null;

    if (managedMatch) {
      return managedMatch.id;
    }

    return tokenBackedAccounts[0].id;
  }

  return managedChannels.find((channel) => Boolean(channel.primaryAgentId))?.id ?? managedChannels[0]?.id ?? null;
}

async function syncManagedDiscordSettings(managedChannels: WorkspaceChannelSummary[], timings?: TimingCollector) {
  if (managedChannels.length === 0) {
    return;
  }

  const currentGuilds = await measureTiming(timings, "discord-settings.read-guilds", () =>
    getOpenClawAdapter().getConfig<DiscordGuildConfig>("channels.discord.guilds").then((value) => value ?? {})
  );
  const nextGuilds: Record<string, Record<string, unknown>> = {};

  for (const [guildId, rawGuild] of Object.entries(currentGuilds ?? {})) {
    nextGuilds[guildId] = isObjectRecord(rawGuild) ? { ...(rawGuild as Record<string, unknown>) } : {};
  }

  let didChange = false;

  for (const channel of managedChannels) {
    for (const workspace of channel.workspaces) {
      for (const assignment of workspace.groupAssignments.filter((entry) => entry.enabled !== false)) {
        const parsed = parseDiscordRouteId(assignment.chatId);
        if (!parsed?.guildId) {
          continue;
        }

        const guild = nextGuilds[parsed.guildId] ?? {};
        const roles = Array.isArray(guild.roles)
          ? guild.roles
              .filter((entry) => typeof entry === "string" || typeof entry === "number")
              .map((entry) => String(entry))
              .map((entry) => entry.trim())
              .filter(Boolean)
          : [];
        const channels = isObjectRecord(guild.channels) ? { ...(guild.channels as Record<string, unknown>) } : {};

        if (guild.requireMention === undefined) {
          guild.requireMention = true;
          didChange = true;
        }

        if (parsed.kind === "role") {
          if (!roles.includes(parsed.targetId)) {
            roles.push(parsed.targetId);
            didChange = true;
          }
          guild.roles = roles;
        } else {
          const allowedChannelIds = uniqueStrings(
            [parsed.targetId, parsed.kind === "thread" ? parsed.parentId ?? "" : ""].filter(Boolean)
          );

          for (const allowedChannelId of allowedChannelIds) {
            const existing = isObjectRecord(channels[allowedChannelId])
              ? (channels[allowedChannelId] as Record<string, unknown>)
              : {};
            if (existing.allow !== true) {
              existing.allow = true;
              didChange = true;
            }
            if (existing.requireMention === undefined) {
              existing.requireMention = true;
              didChange = true;
            }
            channels[allowedChannelId] = existing;
          }

          guild.channels = channels;
        }

        nextGuilds[parsed.guildId] = guild;
      }
    }
  }

  if (!didChange) {
    return;
  }

  await measureTiming(timings, "discord-settings.write-guilds", () =>
    getOpenClawAdapter().setConfig("channels.discord.guilds", nextGuilds, { strictJson: true })
  );
}

function collectTelegramChannelAgentIds(channel: WorkspaceChannelSummary | null | undefined) {
  if (!channel) {
    return [] as string[];
  }

  return uniqueStrings([
    channel.primaryAgentId ?? "",
    ...channel.workspaces.flatMap((workspace) => [
      ...workspace.agentIds,
      ...workspace.groupAssignments
        .filter((assignment) => assignment.enabled !== false && assignment.agentId)
        .map((assignment) => assignment.agentId as string)
    ])
  ]);
}

function normalizeTelegramCoordinationChannel(channel: WorkspaceChannelSummary | null | undefined) {
  if (!channel) {
    return null;
  }

  return {
    id: channel.id,
    name: channel.name,
    primaryAgentId: channel.primaryAgentId ?? null,
    workspaces: channel.workspaces
      .map((workspace) => ({
        workspaceId: workspace.workspaceId,
        workspacePath: workspace.workspacePath,
        agentIds: uniqueStrings([...workspace.agentIds]).sort(),
        groupAssignments: workspace.groupAssignments
          .map((assignment) => ({
            chatId: assignment.chatId,
            agentId: assignment.agentId ?? null,
            title: assignment.title ?? null,
            enabled: assignment.enabled !== false
          }))
          .sort((left, right) => {
            const leftKey = `${left.chatId}:${left.agentId ?? ""}:${left.title ?? ""}:${left.enabled}`;
            const rightKey = `${right.chatId}:${right.agentId ?? ""}:${right.title ?? ""}:${right.enabled}`;
            return leftKey.localeCompare(rightKey);
          })
      }))
      .sort((left, right) => left.workspaceId.localeCompare(right.workspaceId))
  };
}

function areTelegramCoordinationChannelsEqual(
  previousChannel: WorkspaceChannelSummary | null | undefined,
  nextChannel: WorkspaceChannelSummary | null | undefined
) {
  return (
    JSON.stringify(normalizeTelegramCoordinationChannel(previousChannel)) ===
    JSON.stringify(normalizeTelegramCoordinationChannel(nextChannel))
  );
}

async function syncAgentPolicySkills(
  agentIds: string[],
  options: {
    snapshot?: MissionControlSnapshot;
    channelRegistry?: ChannelRegistry;
    timings?: TimingCollector;
  } = {}
) {
  const relevantAgentIds = uniqueStrings(agentIds);

  if (relevantAgentIds.length === 0) {
    return;
  }

  const snapshot =
    options.snapshot ??
    (await measureTiming(options.timings, "agent-policy.snapshot", () =>
      getMissionControlSnapshot({ includeHidden: true })
    ));
  const nextSnapshot = options.channelRegistry
    ? {
        ...snapshot,
        channelRegistry: options.channelRegistry
      }
    : snapshot;

  for (const agentId of relevantAgentIds) {
    await measureTiming(options.timings, `agent-policy.sync-agent.${agentId}`, async () => {
      const agent = nextSnapshot.agents.find((entry) => entry.id === agentId);

      if (!agent) {
        return;
      }

      const setupAgentId =
        nextSnapshot.agents.find(
          (entry) => entry.workspaceId === agent.workspaceId && entry.policy.preset === "setup" && entry.id !== agent.id
        )?.id ?? null;

      const policySkillId = await ensureAgentPolicySkillFromProvisioning({
        workspacePath: agent.workspacePath,
        agentId: agent.id,
        agentName: agent.name,
        policy: agent.policy,
        setupAgentId,
        snapshot: nextSnapshot,
        channelRegistry: options.channelRegistry,
        timings: options.timings
      });

      await upsertAgentConfigEntry(
        agent.id,
        agent.workspacePath,
        {
          name: agent.name,
          model: normalizeOptionalValue(agent.modelId),
          heartbeat: agent.heartbeat.enabled && agent.heartbeat.every ? { every: agent.heartbeat.every } : null,
          skills: [...filterAgentPolicySkills(agent.skills), policySkillId],
          tools: agent.tools.includes("fs.workspaceOnly")
            ? {
                fs: {
                  workspaceOnly: true
                }
              }
            : null
        },
        nextSnapshot,
        options.timings
      );
    });
  }
}

async function syncTelegramCoordinationSkills(
  previousRegistry: ChannelRegistry,
  nextRegistry: ChannelRegistry,
  timings?: TimingCollector
) {
  const relevantAgentIds = await measureTiming(timings, "telegram-coordination.collect-changes", () => {
    const previousTelegramChannels = new Map(
      previousRegistry.channels
        .filter((channel) => channel.type === "telegram")
        .map((channel) => [channel.id, channel] as const)
    );
    const nextTelegramChannels = new Map(
      nextRegistry.channels
        .filter((channel) => channel.type === "telegram")
        .map((channel) => [channel.id, channel] as const)
    );

    return uniqueStrings(
      uniqueStrings([...previousTelegramChannels.keys(), ...nextTelegramChannels.keys()]).flatMap((channelId) => {
        const previousChannel = previousTelegramChannels.get(channelId) ?? null;
        const nextChannel = nextTelegramChannels.get(channelId) ?? null;

        if (areTelegramCoordinationChannelsEqual(previousChannel, nextChannel)) {
          return [];
        }

        return [...collectTelegramChannelAgentIds(previousChannel), ...collectTelegramChannelAgentIds(nextChannel)];
      })
    );
  });

  if (relevantAgentIds.length === 0) {
    return;
  }

  const snapshot = await measureTiming(timings, "telegram-coordination.snapshot", () =>
    getMissionControlSnapshot({ includeHidden: true })
  );
  await measureTiming(timings, "telegram-coordination.sync-agent-policies", () =>
    syncAgentPolicySkills(relevantAgentIds, {
      snapshot,
      channelRegistry: nextRegistry,
      timings
    })
  );
}

async function mutateChannelRegistry(
  mutate: (registry: ChannelRegistry) => void | Promise<void>,
  cleanup: ManagedTelegramRoutingCleanup = {},
  timings?: TimingCollector
) {
  const registry = cloneChannelRegistry(await measureTiming(timings, "channel-registry.read", () => readChannelRegistry()));
  const previousRegistry = cloneChannelRegistry(registry);
  await measureTiming(timings, "channel-registry.mutate", () => mutate(registry));
  await measureTiming(timings, "channel-registry.save", () => saveChannelRegistry(registry));
  await measureTiming(timings, "channel-registry.update-routing", () =>
    updateManagedSurfaceRouting(registry, cleanup, timings)
  );
  invalidateSnapshotCache();
  await measureTiming(timings, "channel-registry.sync-telegram-coordination", () =>
    syncTelegramCoordinationSkills(previousRegistry, registry, timings)
  );
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeChannelId(value: string) {
  const normalized = normalizeOptionalValue(value);
  return normalized ?? "";
}

function isPlannerChannelTypeValue(value: unknown): value is PlannerChannelType {
  return value === "internal" || value === "slack" || value === "telegram" || value === "discord" || value === "googlechat";
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
