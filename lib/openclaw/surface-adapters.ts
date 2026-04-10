import "server-only";

import { runOpenClawJson } from "@/lib/openclaw/cli";
import { formatSurfaceProviderLabel, getSurfaceKind } from "@/lib/openclaw/surface-catalog";
import type {
  ChannelAccountRecord,
  MissionControlSurfaceProvider,
  PlannerChannelType
} from "@/lib/openclaw/types";

const CHAT_PROVIDERS = new Set<PlannerChannelType>(["telegram", "discord", "slack", "googlechat"]);
const ACCOUNT_ID_FALLBACKS: Record<string, string> = {
  cron: "cron-default",
  email: "email-default",
  gmail: "gmail-default",
  webhook: "webhook-default"
};

export async function readOpenClawSurfaceAccounts() {
  const [
    channelsConfig,
    hooksConfig,
    hooksGmailConfig,
    hooksWebhookConfig,
    cronConfig,
    cronJobs,
    gmailConfig,
    emailConfig
  ] = await Promise.all([
    readOpenClawConfig<Record<string, unknown>>(["config", "get", "channels", "--json"]),
    readOpenClawConfig<Record<string, unknown>>(["config", "get", "hooks", "--json"]),
    readOpenClawConfig<Record<string, unknown>>(["config", "get", "hooks.gmail", "--json"]),
    readOpenClawConfig<Record<string, unknown>>(["config", "get", "hooks.webhook", "--json"]),
    readOpenClawConfig<Record<string, unknown>>(["config", "get", "cron", "--json"]),
    readOpenClawConfig<unknown>(["cron", "list", "--json"]),
    readOpenClawConfig<Record<string, unknown>>(["config", "get", "gmail", "--json"]),
    readOpenClawConfig<Record<string, unknown>>(["config", "get", "email", "--json"])
  ]);

  return dedupeSurfaceAccounts([
    ...parseChatSurfaceAccounts(channelsConfig),
    ...parseInboxSurfaceAccounts("gmail", gmailConfig, "config.gmail"),
    ...parseInboxSurfaceAccounts("gmail", hooksGmailConfig, "config.hooks.gmail"),
    ...parseInboxSurfaceAccounts("email", emailConfig, "config.email"),
    ...parseHookSurfaceAccounts(hooksConfig),
    ...parseWebhookSurfaceAccounts(hooksWebhookConfig),
    ...parseCronSurfaceAccounts(cronConfig, cronJobs)
  ]);
}

async function readOpenClawConfig<T>(args: string[]) {
  try {
    return await runOpenClawJson<T>(args);
  } catch {
    return null;
  }
}

function parseChatSurfaceAccounts(channelsConfig: Record<string, unknown> | null) {
  if (!isObjectRecord(channelsConfig)) {
    return [] as ChannelAccountRecord[];
  }

  const accounts: ChannelAccountRecord[] = [];

  for (const [provider, rawConfig] of Object.entries(channelsConfig)) {
    if (!isChatProvider(provider) || !isObjectRecord(rawConfig)) {
      continue;
    }

    const config = rawConfig as Record<string, unknown>;
    const namedAccounts = isObjectRecord(config.accounts) ? (config.accounts as Record<string, unknown>) : {};

    for (const [accountId, account] of Object.entries(namedAccounts)) {
      accounts.push(
        buildSurfaceAccount(provider, accountId, account, {
          fallbackName: buildDefaultAccountLabel(provider, accountId),
          source: "config.channels.accounts"
        })
      );
    }

    const directDefaultAccountId =
      normalizeOptionalString(config.defaultAccount) ?? (hasDirectAccountConfig(config) ? "default" : null);

    if (directDefaultAccountId && !(directDefaultAccountId in namedAccounts)) {
      accounts.push(
        buildSurfaceAccount(provider, directDefaultAccountId, config, {
          fallbackName: buildDefaultAccountLabel(provider, directDefaultAccountId),
          source: "config.channels.default"
        })
      );
    }
  }

  return accounts;
}

function parseInboxSurfaceAccounts(
  provider: Extract<MissionControlSurfaceProvider, "gmail" | "email">,
  config: Record<string, unknown> | null,
  source: string
) {
  if (!isObjectRecord(config)) {
    return [] as ChannelAccountRecord[];
  }

  const accounts: ChannelAccountRecord[] = [];
  const namedAccounts = isObjectRecord(config.accounts) ? (config.accounts as Record<string, unknown>) : {};

  for (const [accountId, account] of Object.entries(namedAccounts)) {
    accounts.push(
      buildSurfaceAccount(provider, accountId, account, {
        fallbackName: buildDefaultAccountLabel(provider, accountId),
        source: `${source}.accounts`
      })
    );
  }

  if (namedAccounts.default) {
    return accounts;
  }

  if (!hasInboxAccountConfig(config)) {
    return accounts;
  }

  const directId = extractConfiguredAccountId(config, ACCOUNT_ID_FALLBACKS[provider]);
  accounts.push(
    buildSurfaceAccount(provider, directId, config, {
      fallbackName: buildDefaultAccountLabel(provider, directId),
      source
    })
  );

  return accounts;
}

function parseHookSurfaceAccounts(hooksConfig: Record<string, unknown> | null) {
  if (!isObjectRecord(hooksConfig)) {
    return [] as ChannelAccountRecord[];
  }

  const accounts: ChannelAccountRecord[] = [];

  if (hasWebhookHookConfig(hooksConfig)) {
    accounts.push(
      buildSurfaceAccount("webhook", ACCOUNT_ID_FALLBACKS.webhook, hooksConfig, {
        fallbackName: "Webhook ingress",
        source: "config.hooks"
      })
    );
  }

  const gmailHookConfig = isObjectRecord(hooksConfig.gmail) ? (hooksConfig.gmail as Record<string, unknown>) : null;
  if (gmailHookConfig) {
    accounts.push(...parseInboxSurfaceAccounts("gmail", gmailHookConfig, "config.hooks.gmail"));
  }

  return accounts;
}

function parseWebhookSurfaceAccounts(config: Record<string, unknown> | null) {
  if (!isObjectRecord(config) || !hasWebhookHookConfig(config)) {
    return [] as ChannelAccountRecord[];
  }

  return [
    buildSurfaceAccount("webhook", extractConfiguredAccountId(config, ACCOUNT_ID_FALLBACKS.webhook), config, {
      fallbackName: "Webhook ingress",
      source: "config.hooks.webhook"
    })
  ];
}

function parseCronSurfaceAccounts(cronConfig: Record<string, unknown> | null, cronJobsPayload: unknown) {
  const jobs = extractCronJobs(cronJobsPayload);
  if (!isObjectRecord(cronConfig) && jobs.length === 0) {
    return [] as ChannelAccountRecord[];
  }

  const config = isObjectRecord(cronConfig) ? cronConfig : {};
  if (!hasCronConfig(config) && jobs.length === 0) {
    return [] as ChannelAccountRecord[];
  }

  const directId = extractConfiguredAccountId(config, ACCOUNT_ID_FALLBACKS.cron);
  const metadata = {
    ...(isObjectRecord(config.metadata) ? config.metadata : {}),
    jobCount: jobs.length
  };

  return [
    buildSurfaceAccount("cron", directId, { ...config, metadata }, {
      fallbackName: jobs.length > 0 ? `Cron scheduler (${jobs.length} job${jobs.length === 1 ? "" : "s"})` : "Cron scheduler",
      source: "config.cron"
    })
  ];
}

function extractCronJobs(payload: unknown) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!isObjectRecord(payload)) {
    return [] as unknown[];
  }

  if (Array.isArray(payload.jobs)) {
    return payload.jobs;
  }

  if (Array.isArray(payload.items)) {
    return payload.items;
  }

  return [] as unknown[];
}

function buildSurfaceAccount(
  provider: MissionControlSurfaceProvider,
  accountId: string,
  rawConfig: unknown,
  options: {
    fallbackName: string;
    source: string;
  }
): ChannelAccountRecord {
  const config = isObjectRecord(rawConfig) ? (rawConfig as Record<string, unknown>) : {};
  const name =
    normalizeOptionalString(config.name) ??
    normalizeOptionalString(config.label) ??
    normalizeOptionalString(config.accountName) ??
    normalizeOptionalString(config.account) ??
    normalizeOptionalString(config.email) ??
    normalizeOptionalString(config.address) ??
    options.fallbackName;
  const metadata = isObjectRecord(config.metadata) ? { ...config.metadata } : {};
  const telegramBotId = provider === "telegram" ? extractTelegramBotId(config) : null;

  return {
    id: accountId,
    type: provider,
    name,
    enabled: config.enabled !== false,
    kind: getSurfaceKind(provider),
    capabilities: inferSurfaceCapabilities(provider, config),
    metadata: {
      ...metadata,
      source: options.source,
      ...(telegramBotId ? { botId: telegramBotId } : {})
    }
  };
}

function inferSurfaceCapabilities(provider: MissionControlSurfaceProvider, config: Record<string, unknown>) {
  const capabilities = new Set<string>();

  if (provider === "telegram" || provider === "discord" || provider === "slack" || provider === "googlechat") {
    capabilities.add("chat");
  }

  if (provider === "gmail" || provider === "email") {
    capabilities.add("inbox");
    if (hasAnyValue(config, ["smtp", "send", "outbound", "drafts"])) {
      capabilities.add("send");
    }
  }

  if (provider === "webhook" || provider === "cron") {
    capabilities.add("trigger");
  }

  if (provider === "gmail" && hasAnyValue(config, ["watch", "pubsub", "topic", "subscription"])) {
    capabilities.add("trigger");
  }

  return Array.from(capabilities);
}

function dedupeSurfaceAccounts(accounts: ChannelAccountRecord[]) {
  const seen = new Map<string, ChannelAccountRecord>();

  for (const account of accounts) {
    const key = `${account.type}:${account.id}`;
    const existing = seen.get(key);

    if (!existing) {
      seen.set(key, account);
      continue;
    }

    seen.set(key, {
      ...existing,
      name: existing.name || account.name,
      enabled: existing.enabled || account.enabled,
      capabilities: Array.from(new Set([...(existing.capabilities ?? []), ...(account.capabilities ?? [])])),
      metadata: {
        ...(account.metadata ?? {}),
        ...(existing.metadata ?? {})
      }
    });
  }

  return Array.from(seen.values());
}

function hasDirectAccountConfig(config: Record<string, unknown>) {
  return config.enabled === true || hasAnyValue(config, ["account", "token", "botToken", "appToken", "webhookUrl", "webhook", "clientId"]);
}

function hasInboxAccountConfig(config: Record<string, unknown>) {
  return (
    config.enabled === true ||
    hasAnyValue(config, ["account", "email", "address", "username", "imap", "smtp", "oauth", "watch", "pubsub"])
  );
}

function hasWebhookHookConfig(config: Record<string, unknown>) {
  return config.enabled === true || hasAnyValue(config, ["token", "secret", "path", "baseUrl", "mappings", "webhook"]);
}

function hasCronConfig(config: Record<string, unknown>) {
  return (
    config.enabled === true ||
    hasAnyValue(config, [
      "jobs",
      "schedules",
      "failureDestination",
      "webhook",
      "webhookToken",
      "store",
      "maxConcurrentRuns",
      "sessionRetention",
      "runLog"
    ])
  );
}

function hasAnyValue(config: Record<string, unknown>, keys: string[]) {
  return keys.some((key) => isConfiguredValue(config[key]));
}

function isConfiguredValue(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return isObjectRecord(value);
}

function extractConfiguredAccountId(config: Record<string, unknown>, fallback: string) {
  return (
    normalizeOptionalString(config.accountId) ??
    normalizeOptionalString(config.account) ??
    normalizeOptionalString(config.id) ??
    normalizeOptionalString(config.email) ??
    normalizeOptionalString(config.address) ??
    fallback
  );
}

function extractTelegramBotId(config: Record<string, unknown>) {
  const token = normalizeOptionalString(config.botToken) ?? normalizeOptionalString(config.token);
  const botId = token?.split(":", 1)[0]?.trim();
  return botId && /^\d+$/.test(botId) ? botId : null;
}

function buildDefaultAccountLabel(provider: MissionControlSurfaceProvider, accountId: string) {
  const label = formatSurfaceProviderLabel(provider);
  return accountId === "default" || accountId === ACCOUNT_ID_FALLBACKS[provider]
    ? `${label} default`
    : `${label} ${accountId}`;
}

function isChatProvider(value: string): value is Exclude<PlannerChannelType, "internal"> {
  return CHAT_PROVIDERS.has(value as PlannerChannelType);
}

function normalizeOptionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
