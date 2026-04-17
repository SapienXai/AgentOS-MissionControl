import { readFile } from "node:fs/promises";
import path from "node:path";

import { runOpenClawJson } from "@/lib/openclaw/cli";
import { parseDiscordRouteId, type DiscordRouteId } from "@/lib/openclaw/domains/discord-route";
import { readOpenClawSurfaceAccounts } from "@/lib/openclaw/surface-adapters";
import { getSurfaceKind } from "@/lib/openclaw/surface-catalog";
import { measureTiming, type TimingCollector } from "@/lib/openclaw/timing";
import { normalizeChannelRegistry, parseWorkspaceChannelSummary } from "@/lib/openclaw/domains/workspace-manifest";
import type {
  ChannelAccountRecord,
  ChannelRegistry,
  DiscoveredSurfaceRoute,
  MissionControlSurfaceProvider,
  WorkspaceChannelGroupAssignment,
  WorkspaceChannelSummary
} from "@/lib/openclaw/types";

export { parseDiscordRouteId };

const missionControlRootPath = path.join(/*turbopackIgnore: true*/ process.cwd(), ".mission-control");
const channelRegistryPath = path.join(missionControlRootPath, "channel-registry.json");

type OpenClawChannelLogsPayload = {
  lines?: Array<{
    time?: string;
    message?: string;
    raw?: string;
  }>;
};

type TelegramAllowlistConfig = Record<
  string,
  {
    requireMention?: boolean;
  }
>;

type DiscordGuildConfig = Record<
  string,
  {
    requireMention?: boolean;
    roles?: unknown;
    channels?: Record<string, unknown>;
    name?: string;
  }
>;

type DiscordRouteContext = {
  accountId: string | null;
  guildId: string | null;
  guildName: string | null;
  channelId: string | null;
  channelName: string | null;
  threadId: string | null;
  threadName: string | null;
};

export type ManagedDiscordBinding =
  | {
      agentId: string;
      match: {
        channel: "discord";
        accountId: string;
        guildId: string;
        roles: string[];
      };
    }
  | {
      agentId: string;
      match: {
        channel: "discord";
        accountId: string;
        guildId?: string;
        peer: {
          kind: "channel" | "thread";
          id: string;
        };
      };
    }
  | null;

function normalizeOptionalValue(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function getChannelRegistry() {
  return readChannelRegistry();
}

export async function readChannelRegistry() {
  try {
    const raw = await readFile(channelRegistryPath, "utf8");
    const candidate = JSON.parse(raw);
    const parsed = isObjectRecord(candidate) ? candidate : {};
    const channels = Array.isArray(parsed.channels)
      ? parsed.channels
          .map((entry) => parseWorkspaceChannelSummary(entry))
          .filter((entry): entry is WorkspaceChannelSummary => Boolean(entry))
      : [];
    const registry = normalizeChannelRegistry({
      version: 1 as const,
      channels
    });
    return await reconcileTelegramRegistryAccounts(registry);
  } catch {
    return normalizeChannelRegistry({
      version: 1 as const,
      channels: []
    });
  }
}

export async function readChannelAccounts() {
  try {
    const accounts = await readOpenClawSurfaceAccounts();
    return dedupeChannelAccounts(accounts);
  } catch {
    return [] as ChannelAccountRecord[];
  }
}

export function applyChannelAccountDisplayNames(accounts: ChannelAccountRecord[], registry: ChannelRegistry) {
  const labels = new Map(
    registry.channels
      .filter((channel) => Boolean(channel.id))
      .map((channel) => [channel.id, channel.name.trim() || channel.id] as const)
  );

  return accounts.map((account) => ({
    ...account,
    name: labels.get(account.id) ?? account.name
  }));
}

export function buildLegacyRegistrySurfaceAccounts(registry: ChannelRegistry) {
  return registry.channels
    .filter((channel) => channel.type !== "internal" && channel.workspaces.length > 0)
    .map(
      (channel) =>
        ({
          id: channel.id,
          type: channel.type,
          name: channel.name.trim() || channel.id,
          enabled: true,
          kind: getSurfaceKind(channel.type),
          capabilities: [getSurfaceKind(channel.type)],
          metadata: {
            source: "channel-registry",
            legacy: true
          }
        }) satisfies ChannelAccountRecord
    );
}

export function mergeMissionControlSurfaceAccounts(accounts: ChannelAccountRecord[]) {
  const merged = new Map<string, ChannelAccountRecord>();

  for (const account of accounts) {
    const key = `${account.type}:${account.id}`;
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, account);
      continue;
    }

    merged.set(key, {
      ...existing,
      name: existing.name || account.name,
      enabled: existing.enabled !== false,
      kind: existing.kind ?? account.kind,
      capabilities: uniqueStrings([...(existing.capabilities ?? []), ...(account.capabilities ?? [])]),
      metadata: {
        ...(account.metadata ?? {}),
        ...(existing.metadata ?? {})
      }
    });
  }

  return Array.from(merged.values());
}

export async function discoverSurfaceRoutes(input: {
  provider: MissionControlSurfaceProvider;
  accountId?: string | null;
}, timings?: TimingCollector) {
  switch (input.provider) {
    case "telegram":
      return discoverTelegramGroups(timings);
    case "discord":
      return discoverDiscordRoutes(input.accountId, timings);
    default:
      return [] as DiscoveredSurfaceRoute[];
  }
}

export async function discoverTelegramGroups(timings?: TimingCollector) {
  const payload = await measureTiming(timings, "telegram-discovery.read-channel-logs", () =>
    runOpenClawJson<OpenClawChannelLogsPayload>([
      "channels",
      "logs",
      "--channel",
      "telegram",
      "--json",
      "--lines",
      "200"
    ]).catch(() => null)
  );

  if (!payload?.lines?.length) {
    return await readTelegramAllowlistGroups(timings);
  }

  const discovered = new Map<string, DiscoveredSurfaceRoute>();

  const rememberGroup = (group: DiscoveredSurfaceRoute) => {
    const existing = discovered.get(group.routeId);
    if (!existing) {
      discovered.set(group.routeId, group);
      return;
    }

    discovered.set(group.routeId, {
      routeId: group.routeId,
      provider: "telegram",
      kind: "group",
      title: group.title ?? existing.title,
      lastSeen: selectLatestIsoTimestamp(existing.lastSeen, group.lastSeen)
    });
  };

  for (const line of payload.lines) {
    const lineTime = typeof line?.time === "string" ? line.time : null;

    for (const group of extractTelegramGroupsFromUnknown(line, lineTime)) {
      rememberGroup(group);
    }

    if (typeof line?.raw === "string") {
      try {
        const parsed = JSON.parse(line.raw);
        for (const group of extractTelegramGroupsFromUnknown(parsed, lineTime)) {
          rememberGroup(group);
        }
      } catch {
        for (const group of extractTelegramGroupsFromText(line.raw, lineTime)) {
          rememberGroup(group);
        }
      }
    }

    if (typeof line?.message === "string") {
      for (const group of extractTelegramGroupsFromText(line.message, lineTime)) {
        rememberGroup(group);
      }
    }
  }

  for (const group of await readTelegramAllowlistGroups(timings)) {
    if (!discovered.has(group.routeId)) {
      discovered.set(group.routeId, group);
    }
  }

  return Array.from(discovered.values()).sort((left, right) => {
    const leftLabel = left.title ?? left.routeId;
    const rightLabel = right.title ?? right.routeId;
    return leftLabel.localeCompare(rightLabel);
  });
}

export async function discoverDiscordRoutes(accountId?: string | null, timings?: TimingCollector) {
  const payload = await measureTiming(timings, "discord-discovery.read-channel-logs", () =>
    runOpenClawJson<OpenClawChannelLogsPayload>([
      "channels",
      "logs",
      "--channel",
      "discord",
      "--json",
      "--lines",
      "300"
    ]).catch(() => null)
  );

  const discovered = new Map<string, DiscoveredSurfaceRoute>();

  const rememberRoute = (route: DiscoveredSurfaceRoute) => {
    const existing = discovered.get(route.routeId);
    if (!existing) {
      discovered.set(route.routeId, route);
      return;
    }

    discovered.set(route.routeId, {
      ...existing,
      title: route.title ?? existing.title,
      subtitle: route.subtitle ?? existing.subtitle,
      lastSeen: selectLatestIsoTimestamp(existing.lastSeen, route.lastSeen),
      guildId: route.guildId ?? existing.guildId,
      parentId: route.parentId ?? existing.parentId
    });
  };

  for (const route of await readDiscordConfiguredRoutes(timings)) {
    rememberRoute(route);
  }

  for (const line of payload?.lines ?? []) {
    const lineTime = typeof line?.time === "string" ? line.time : null;

    for (const route of extractDiscordRoutesFromUnknown(line, lineTime, accountId)) {
      rememberRoute(route);
    }

    if (typeof line?.raw === "string") {
      try {
        const parsed = JSON.parse(line.raw);
        for (const route of extractDiscordRoutesFromUnknown(parsed, lineTime, accountId)) {
          rememberRoute(route);
        }
      } catch {
        for (const route of extractDiscordRoutesFromText(line.raw, lineTime, accountId)) {
          rememberRoute(route);
        }
      }
    }

    if (typeof line?.message === "string") {
      for (const route of extractDiscordRoutesFromText(line.message, lineTime, accountId)) {
        rememberRoute(route);
      }
    }
  }

  return Array.from(discovered.values()).sort((left, right) => {
    const leftLabel = left.title ?? left.routeId;
    const rightLabel = right.title ?? right.routeId;
    return leftLabel.localeCompare(rightLabel);
  });
}

async function readTelegramAllowlistGroups(timings?: TimingCollector) {
  try {
    const groups = await measureTiming(timings, "telegram-discovery.read-allowlist-config", () =>
      runOpenClawJson<TelegramAllowlistConfig>([
        "config",
        "get",
        "channels.telegram.groups",
        "--json"
      ])
    );

    return Object.keys(groups ?? {})
      .map((chatId) => ({
        routeId: chatId,
        provider: "telegram" as const,
        kind: "group" as const,
        title: null,
        lastSeen: null
      }))
      .sort((left, right) => left.routeId.localeCompare(right.routeId));
  } catch {
    return [] as DiscoveredSurfaceRoute[];
  }
}

async function readDiscordConfiguredRoutes(timings?: TimingCollector) {
  try {
    const guilds = await measureTiming(timings, "discord-discovery.read-config", () =>
      runOpenClawJson<DiscordGuildConfig>([
        "config",
        "get",
        "channels.discord.guilds",
        "--json"
      ])
    );
    const routes: DiscoveredSurfaceRoute[] = [];

    for (const [guildId, rawGuild] of Object.entries(guilds ?? {})) {
      if (!normalizeDiscordId(guildId) || !isObjectRecord(rawGuild)) {
        continue;
      }

      const guild = rawGuild as Record<string, unknown>;
      const guildLabel = normalizeOptionalValue(guild.name as string | null | undefined) ?? guildId;
      const roleIds = Array.isArray(guild.roles)
        ? guild.roles
            .filter((entry) => typeof entry === "string" || typeof entry === "number")
            .map((entry) => String(entry).trim())
            .filter((entry) => Boolean(normalizeDiscordId(entry)))
        : [];

      for (const roleId of roleIds) {
        routes.push({
          routeId: encodeDiscordRouteId({
            kind: "role",
            guildId,
            targetId: roleId
          }),
          provider: "discord",
          kind: "role",
          title: `@${roleId}`,
          subtitle: guildLabel,
          lastSeen: null,
          guildId
        });
      }

      const channels = isObjectRecord(guild.channels) ? (guild.channels as Record<string, unknown>) : {};
      for (const [channelKey, rawChannel] of Object.entries(channels)) {
        const channelRecord = isObjectRecord(rawChannel) ? (rawChannel as Record<string, unknown>) : {};
        const channelId =
          normalizeDiscordId(channelKey) ??
          normalizeDiscordId(channelRecord.id as string | number | null | undefined);

        if (!channelId) {
          continue;
        }

        const label =
          normalizeOptionalValue(channelRecord.name as string | null | undefined) ??
          normalizeOptionalValue(channelRecord.label as string | null | undefined) ??
          `#${channelId}`;

        routes.push({
          routeId: encodeDiscordRouteId({
            kind: "channel",
            guildId,
            targetId: channelId
          }),
          provider: "discord",
          kind: "channel",
          title: label,
          subtitle: guildLabel,
          lastSeen: null,
          guildId
        });
      }
    }

    return routes;
  } catch {
    return [] as DiscoveredSurfaceRoute[];
  }
}

export function buildManagedDiscordBinding(
  accountId: string,
  assignment: WorkspaceChannelGroupAssignment
): ManagedDiscordBinding {
  const parsed = parseDiscordRouteId(assignment.chatId);
  if (!parsed || !assignment.agentId) {
    return null;
  }

  if (parsed.kind === "role") {
    if (!parsed.guildId) {
      return null;
    }

    return {
      agentId: assignment.agentId,
      match: {
        channel: "discord",
        accountId,
        guildId: parsed.guildId,
        roles: [parsed.targetId]
      }
    };
  }

  return {
    agentId: assignment.agentId,
    match: {
      channel: "discord",
      accountId,
      ...(parsed.guildId ? { guildId: parsed.guildId } : {}),
      peer: {
        kind: parsed.kind,
        id: parsed.targetId
      }
    }
  };
}

function dedupeChannelAccounts(accounts: ChannelAccountRecord[]) {
  const telegramByBot = new Map<string, ChannelAccountRecord>();
  const others: ChannelAccountRecord[] = [];

  for (const account of accounts) {
    if (account.type !== "telegram") {
      others.push(account);
      continue;
    }

    const botId =
      typeof account.metadata?.botId === "string" && account.metadata.botId.trim().length > 0
        ? account.metadata.botId.trim()
        : null;

    if (!botId) {
      if (!telegramByBot.has(account.id)) {
        telegramByBot.set(account.id, account);
      }
      continue;
    }

    const current = telegramByBot.get(botId);
    if (!current) {
      telegramByBot.set(botId, account);
      continue;
    }

    const candidateScore = scoreTelegramAccountChoice(account.id);
    const currentScore = scoreTelegramAccountChoice(current.id);
    if (candidateScore > currentScore) {
      telegramByBot.set(botId, account);
    }
  }

  return [...others, ...Array.from(telegramByBot.values())];
}

function scoreTelegramAccountChoice(accountId: string) {
  if (accountId !== "default") {
    return 2;
  }

  return 1;
}

async function reconcileTelegramRegistryAccounts(registry: ChannelRegistry) {
  const telegramAccounts = (await readChannelAccounts()).filter((account) => account.type === "telegram");
  if (telegramAccounts.length === 0) {
    return registry;
  }

  const accountIds = new Set(telegramAccounts.map((account) => account.id));
  const accountsByName = new Map<string, ChannelAccountRecord[]>();

  for (const account of telegramAccounts) {
    const key = account.name.trim().toLowerCase();
    if (!key) {
      continue;
    }

    const current = accountsByName.get(key) ?? [];
    current.push(account);
    accountsByName.set(key, current);
  }

  let changed = false;
  const nextChannels = registry.channels.map((channel) => {
    if (channel.type !== "telegram" || accountIds.has(channel.id)) {
      return channel;
    }

    const matches = accountsByName.get(channel.name.trim().toLowerCase()) ?? [];
    if (matches.length !== 1) {
      return channel;
    }

    changed = true;
    return {
      ...channel,
      id: matches[0].id,
      name: matches[0].name
    };
  });

  if (!changed) {
    return registry;
  }

  return normalizeChannelRegistry({
    version: 1,
    channels: nextChannels
  });
}

function extractTelegramGroupsFromUnknown(value: unknown, lineTime: string | null): DiscoveredSurfaceRoute[] {
  const discovered = new Map<string, DiscoveredSurfaceRoute>();
  const queue: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth > 6) {
      continue;
    }

    const candidate = current.value;
    if (candidate === null || candidate === undefined) {
      continue;
    }

    if (typeof candidate !== "object") {
      continue;
    }

    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);

    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        queue.push({ value: item, depth: current.depth + 1 });
      }
      continue;
    }

    if (!isObjectRecord(candidate)) {
      continue;
    }

    const chatId = normalizeTelegramGroupChatId(candidate.chatId);
    if (chatId) {
      const title =
        normalizeOptionalValue(candidate.title as string | null | undefined) ??
        normalizeOptionalValue(candidate.chatTitle as string | null | undefined) ??
        null;
      discovered.set(chatId, {
        routeId: chatId,
        provider: "telegram",
        kind: "group",
        title,
        lastSeen: lineTime
      });
    }

    for (const nested of Object.values(candidate)) {
      queue.push({ value: nested, depth: current.depth + 1 });
    }
  }

  return Array.from(discovered.values());
}

function extractTelegramGroupsFromText(text: string, lineTime: string | null): DiscoveredSurfaceRoute[] {
  const discovered = new Map<string, DiscoveredSurfaceRoute>();
  const objectPattern = /\{[^{}]*"chatId"\s*:\s*-?\d+[^{}]*\}/g;

  for (const match of text.matchAll(objectPattern)) {
    const fragment = match[0];
    try {
      const parsed = JSON.parse(fragment);
      for (const group of extractTelegramGroupsFromUnknown(parsed, lineTime)) {
        discovered.set(group.routeId, group);
      }
      continue;
    } catch {
      // Fall through to regex extraction below.
    }

    const chatIdMatch = fragment.match(/"chatId"\s*:\s*(-?\d+)/);
    const chatId = normalizeTelegramGroupChatId(chatIdMatch?.[1] ?? null);
    if (!chatId) {
      continue;
    }

    const titleMatch = fragment.match(/"title"\s*:\s*"([^"]+)"/);
    discovered.set(chatId, {
      routeId: chatId,
      provider: "telegram",
      kind: "group",
      title: titleMatch?.[1] ?? null,
      lastSeen: lineTime
    });
  }

  return Array.from(discovered.values());
}

function extractDiscordRoutesFromUnknown(
  value: unknown,
  lineTime: string | null,
  accountIdFilter?: string | null
): DiscoveredSurfaceRoute[] {
  const discovered = new Map<string, DiscoveredSurfaceRoute>();
  const queue: Array<{ value: unknown; depth: number; context: DiscordRouteContext }> = [
    {
      value,
      depth: 0,
      context: {
        accountId: null,
        guildId: null,
        guildName: null,
        channelId: null,
        channelName: null,
        threadId: null,
        threadName: null
      }
    }
  ];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth > 7) {
      continue;
    }

    const candidate = current.value;
    if (candidate === null || candidate === undefined) {
      continue;
    }

    if (typeof candidate !== "object") {
      continue;
    }

    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);

    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        queue.push({
          value: item,
          depth: current.depth + 1,
          context: current.context
        });
      }
      continue;
    }

    if (!isObjectRecord(candidate)) {
      continue;
    }

    const nextContext = mergeDiscordRouteContext(current.context, candidate);
    if (accountIdFilter && nextContext.accountId && nextContext.accountId !== accountIdFilter) {
      continue;
    }

    const channelRoute = createDiscoveredDiscordChannelRoute(nextContext, lineTime);
    if (channelRoute) {
      discovered.set(channelRoute.routeId, channelRoute);
    }

    const threadRoute = createDiscoveredDiscordThreadRoute(nextContext, lineTime);
    if (threadRoute) {
      discovered.set(threadRoute.routeId, threadRoute);
    }

    for (const roleRoute of extractDiscordRoleRoutes(candidate, nextContext, lineTime)) {
      discovered.set(roleRoute.routeId, roleRoute);
    }

    for (const nested of Object.values(candidate)) {
      queue.push({
        value: nested,
        depth: current.depth + 1,
        context: nextContext
      });
    }
  }

  return Array.from(discovered.values());
}

function extractDiscordRoutesFromText(
  text: string,
  lineTime: string | null,
  accountIdFilter?: string | null
): DiscoveredSurfaceRoute[] {
  const discovered = new Map<string, DiscoveredSurfaceRoute>();
  const accountIdInText = text.match(/accountId["=:\s]+([A-Za-z0-9._-]+)/i)?.[1] ?? null;
  if (accountIdFilter && accountIdInText && accountIdInText !== accountIdFilter) {
    return [];
  }

  const objectPattern = /\{[^{}]*(guildId|channelId|threadId|roleIds|roles)[^{}]*\}/g;
  for (const match of text.matchAll(objectPattern)) {
    try {
      const parsed = JSON.parse(match[0]);
      for (const route of extractDiscordRoutesFromUnknown(parsed, lineTime, accountIdFilter)) {
        discovered.set(route.routeId, route);
      }
    } catch {
      // Fall back to lightweight regex extraction below.
    }
  }

  const guildId = normalizeDiscordId(text.match(/guild(?:Id)?["=:\s]+(\d{5,})/i)?.[1] ?? null);
  const channelId = normalizeDiscordId(text.match(/channel(?:Id)?["=:\s]+(\d{5,})/i)?.[1] ?? null);
  const threadId = normalizeDiscordId(text.match(/thread(?:Id)?["=:\s]+(\d{5,})/i)?.[1] ?? null);

  if (channelId) {
    const route = createDiscoveredDiscordRoute({
      kind: "channel",
      guildId,
      targetId: channelId,
      title: `#${channelId}`,
      subtitle: guildId ? `Guild ${guildId}` : null,
      lastSeen: lineTime
    });
    discovered.set(route.routeId, route);
  }

  if (threadId) {
    const route = createDiscoveredDiscordRoute({
      kind: "thread",
      guildId,
      targetId: threadId,
      parentId: channelId,
      title: `Thread ${threadId}`,
      subtitle: channelId ? `Channel ${channelId}` : guildId ? `Guild ${guildId}` : null,
      lastSeen: lineTime
    });
    discovered.set(route.routeId, route);
  }

  if (guildId) {
    const rolePattern = /\b(\d{5,})\b/g;
    const rolesBlock = text.match(/roles?["=:\s]+\[([^\]]+)\]/i)?.[1] ?? "";
    for (const match of rolesBlock.matchAll(rolePattern)) {
      const roleId = normalizeDiscordId(match[1]);
      if (!roleId) {
        continue;
      }

      const route = createDiscoveredDiscordRoute({
        kind: "role",
        guildId,
        targetId: roleId,
        title: `@${roleId}`,
        subtitle: `Guild ${guildId}`,
        lastSeen: lineTime
      });
      discovered.set(route.routeId, route);
    }
  }

  return Array.from(discovered.values());
}

function mergeDiscordRouteContext(base: DiscordRouteContext, candidate: Record<string, unknown>): DiscordRouteContext {
  const guildRecord = isObjectRecord(candidate.guild) ? (candidate.guild as Record<string, unknown>) : null;
  const channelRecord = isObjectRecord(candidate.channel) ? (candidate.channel as Record<string, unknown>) : null;
  const threadRecord = isObjectRecord(candidate.thread) ? (candidate.thread as Record<string, unknown>) : null;
  const peerRecord = isObjectRecord(candidate.peer) ? (candidate.peer as Record<string, unknown>) : null;

  const explicitChannelKind = normalizeOptionalValue(candidate.kind as string | null | undefined);
  const explicitType = normalizeOptionalValue(candidate.type as string | null | undefined);
  const candidateId = normalizeDiscordId(candidate.id);

  const channelId =
    normalizeDiscordId(candidate.channelId) ??
    normalizeDiscordId(candidate.channel_id) ??
    normalizeDiscordId(channelRecord?.id) ??
    (peerRecord?.kind === "channel" ? normalizeDiscordId(peerRecord.id) : null) ??
    ((explicitChannelKind === "channel" || explicitType === "channel") && candidateId ? candidateId : null) ??
    base.channelId;
  const threadId =
    normalizeDiscordId(candidate.threadId) ??
    normalizeDiscordId(candidate.thread_id) ??
    normalizeDiscordId(threadRecord?.id) ??
    (peerRecord?.kind === "thread" ? normalizeDiscordId(peerRecord.id) : null) ??
    ((explicitChannelKind === "thread" || explicitType === "thread") && candidateId ? candidateId : null) ??
    base.threadId;

  return {
    accountId:
      normalizeOptionalValue(candidate.accountId as string | null | undefined) ??
      normalizeOptionalValue(candidate.channelAccountId as string | null | undefined) ??
      normalizeOptionalValue(candidate.account as string | null | undefined) ??
      base.accountId,
    guildId:
      normalizeDiscordId(candidate.guildId) ??
      normalizeDiscordId(candidate.guild_id) ??
      normalizeDiscordId(guildRecord?.id) ??
      base.guildId,
    guildName:
      normalizeOptionalValue(candidate.guildName as string | null | undefined) ??
      normalizeOptionalValue(guildRecord?.name as string | null | undefined) ??
      base.guildName,
    channelId,
    channelName:
      normalizeOptionalValue(candidate.channelName as string | null | undefined) ??
      normalizeOptionalValue(channelRecord?.name as string | null | undefined) ??
      ((explicitChannelKind === "channel" || explicitType === "channel")
        ? normalizeOptionalValue(candidate.name as string | null | undefined)
        : null) ??
      base.channelName,
    threadId,
    threadName:
      normalizeOptionalValue(candidate.threadName as string | null | undefined) ??
      normalizeOptionalValue(threadRecord?.name as string | null | undefined) ??
      ((explicitChannelKind === "thread" || explicitType === "thread")
        ? normalizeOptionalValue(candidate.name as string | null | undefined)
        : null) ??
      base.threadName
  };
}

function extractDiscordRoleRoutes(
  candidate: Record<string, unknown>,
  context: DiscordRouteContext,
  lineTime: string | null
) {
  if (!context.guildId) {
    return [] as DiscoveredSurfaceRoute[];
  }

  const routes = new Map<string, DiscoveredSurfaceRoute>();
  const roleCollections: unknown[] = [
    candidate.roleIds,
    candidate.memberRoleIds,
    candidate.roles,
    isObjectRecord(candidate.member) ? (candidate.member as Record<string, unknown>).roles : null
  ];

  for (const collection of roleCollections) {
    if (!Array.isArray(collection)) {
      continue;
    }

    for (const entry of collection) {
      const roleId =
        normalizeDiscordId(entry) ??
        (isObjectRecord(entry) ? normalizeDiscordId((entry as Record<string, unknown>).id) : null);

      if (!roleId) {
        continue;
      }

      const roleName = isObjectRecord(entry)
        ? normalizeOptionalValue((entry as Record<string, unknown>).name as string | null | undefined)
        : null;
      const route = createDiscoveredDiscordRoute({
        kind: "role",
        guildId: context.guildId,
        targetId: roleId,
        title: roleName ? `@${roleName}` : `@${roleId}`,
        subtitle: context.guildName ?? context.guildId,
        lastSeen: lineTime
      });
      routes.set(route.routeId, route);
    }
  }

  return Array.from(routes.values());
}

function createDiscoveredDiscordChannelRoute(context: DiscordRouteContext, lineTime: string | null) {
  if (!context.channelId) {
    return null;
  }

  return createDiscoveredDiscordRoute({
    kind: "channel",
    guildId: context.guildId,
    targetId: context.channelId,
    title: context.channelName ? `#${context.channelName}` : `#${context.channelId}`,
    subtitle: context.guildName ?? context.guildId,
    lastSeen: lineTime
  });
}

function createDiscoveredDiscordThreadRoute(context: DiscordRouteContext, lineTime: string | null) {
  if (!context.threadId) {
    return null;
  }

  return createDiscoveredDiscordRoute({
    kind: "thread",
    guildId: context.guildId,
    targetId: context.threadId,
    parentId: context.channelId,
    title: context.threadName ?? `Thread ${context.threadId}`,
    subtitle:
      context.channelName && context.guildName
        ? `#${context.channelName} · ${context.guildName}`
        : context.channelName
          ? `#${context.channelName}`
          : context.guildName ?? context.guildId,
    lastSeen: lineTime
  });
}

function createDiscoveredDiscordRoute(input: {
  kind: "channel" | "thread" | "role";
  guildId: string | null;
  targetId: string;
  parentId?: string | null;
  title: string | null;
  subtitle: string | null;
  lastSeen: string | null;
}) {
  return {
    routeId: encodeDiscordRouteId({
      kind: input.kind,
      guildId: input.guildId,
      targetId: input.targetId,
      parentId: input.parentId
    }),
    provider: "discord" as const,
    kind: input.kind,
    title: input.title,
    subtitle: input.subtitle,
    lastSeen: input.lastSeen,
    guildId: input.guildId,
    parentId: input.parentId ?? null
  } satisfies DiscoveredSurfaceRoute;
}

function encodeDiscordRouteId(route: DiscordRouteId) {
  const guildId = route.guildId ?? "_";
  if (route.kind === "thread") {
    return `thread:${guildId}:${route.targetId}:${route.parentId ?? "_"}`;
  }

  return `${route.kind}:${guildId}:${route.targetId}`;
}

function normalizeDiscordId(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return /^\d{5,}$/.test(trimmed) ? trimmed : null;
}

function normalizeTelegramGroupChatId(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value < 0) {
    return String(value);
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return /^-\d+$/.test(trimmed) ? trimmed : null;
}

function selectLatestIsoTimestamp(current: string | null, candidate: string | null) {
  if (!candidate) {
    return current;
  }

  if (!current) {
    return candidate;
  }

  const currentValue = Date.parse(current);
  const candidateValue = Date.parse(candidate);
  if (Number.isNaN(candidateValue)) {
    return current;
  }

  if (Number.isNaN(currentValue) || candidateValue > currentValue) {
    return candidate;
  }

  return current;
}
