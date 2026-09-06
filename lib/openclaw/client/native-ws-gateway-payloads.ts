import "server-only";

import { z } from "zod";

import { OpenClawGatewayClientError } from "@/lib/openclaw/client/native-ws-gateway-errors";
import {
  isObjectRecord,
  readNonEmptyString
} from "@/lib/openclaw/client/native-ws-gateway-utils";
import type {
  ModelsPayload,
  ModelsStatusPayload,
  OpenClawPluginListPayload,
  OpenClawSessionExportInput,
  OpenClawSessionExportPayload,
  StatusPayload
} from "@/lib/openclaw/client/types";
import { compareVersionStrings } from "@/lib/openclaw/domains/control-plane-normalization";

export type StatusUpdateRegistry = NonNullable<NonNullable<StatusPayload["update"]>["registry"]>;

export const statusPayloadSchema = z
  .object({
    runtimeVersion: z.string().optional(),
    version: z.string().optional(),
    updateChannel: z.string().optional()
  })
  .passthrough();

export const agentListPayloadSchema = z
  .object({
    defaultId: z.string().optional(),
    mainKey: z.string().optional(),
    scope: z.string().optional(),
    agents: z.array(
      z
        .object({
          id: z.string(),
          kind: z.enum(["agent", "system"]).optional(),
          createdVia: z.enum(["operator", "agent", "claw"]).optional(),
          creatorAgentId: z.string().nullable().optional(),
          createdAt: z.number().int().nonnegative().optional(),
          name: z.string().optional(),
          identity: z
            .object({
              name: z.string().optional(),
              theme: z.string().optional(),
              emoji: z.string().optional(),
              avatar: z.string().optional(),
              avatarUrl: z.string().optional()
            })
            .passthrough()
            .optional(),
          workspace: z.string().optional(),
          model: z
            .object({
              primary: z.string().optional(),
              fallbacks: z.array(z.string()).optional()
            })
            .passthrough()
            .optional()
        })
        .passthrough()
    )
  })
  .passthrough();

export const sessionsPayloadSchema = z
  .object({
    sessions: z.array(z.object({}).passthrough())
  })
  .passthrough();

export const channelStatusPayloadSchema = z
  .object({
    ts: z.number().optional(),
    channelOrder: z.array(z.string()).optional().default([]),
    channelLabels: z.record(z.string(), z.string()).optional().default({}),
    channelDetailLabels: z.record(z.string(), z.string()).optional(),
    channelSystemImages: z.record(z.string(), z.string()).optional(),
    channelMeta: z.array(
      z
        .object({
          id: z.string(),
          label: z.string(),
          detailLabel: z.string(),
          systemImage: z.string().optional()
        })
        .passthrough()
    ).optional(),
    channels: z.record(z.string(), z.unknown()),
    channelAccounts: z.record(
      z.string(),
      z.array(
        z
          .object({
            accountId: z.string()
          })
          .passthrough()
      )
    ),
    channelDefaultAccountId: z.record(z.string(), z.union([z.string(), z.null()])).optional().default({})
  })
  .passthrough();

export const modelsPayloadSchema = z
  .object({
    models: z.array(
      z
        .object({
          key: z.string().optional(),
          id: z.string().optional(),
          provider: z.string().optional(),
          name: z.string(),
          input: z.union([z.string(), z.array(z.string())]).optional().default("text"),
          contextWindow: z.number().nullable().optional().default(null),
          contextWindows: z.array(z.object({ id: z.string(), label: z.string(), contextWindow: z.number() }).passthrough()).optional(),
          contextWindowDefault: z.string().optional(),
          local: z.boolean().nullable().optional().default(null),
          available: z.boolean().nullable().optional().default(null),
          unavailableReason: z.string().optional(),
          unavailableUntil: z.number().optional(),
          reasoning: z.boolean().optional(),
          thinkingLevels: z.array(z.object({ id: z.string(), label: z.string() }).passthrough()).optional(),
          thinkingDefault: z.string().optional(),
          supportsTools: z.boolean().optional(),
          alias: z.string().optional(),
          apiKeySupported: z.boolean().optional(),
          agentRuntime: z.object({ id: z.string() }).passthrough().optional(),
          deprecated: z.boolean().optional(),
          disabled: z.boolean().optional(),
          tags: z.array(z.string()).optional().default([]),
          missing: z.boolean().optional().default(false)
        })
        .passthrough()
    ),
    providerOutcomes: z.array(z.object({
      provider: z.string(),
      profileId: z.string().optional(),
      status: z.string()
    }).passthrough()).optional()
  })
  .passthrough();

export const skillsPayloadSchema = z
  .object({
    skills: z.array(
      z
        .object({
          name: z.string(),
          description: z.string().optional(),
          emoji: z.string().optional(),
          eligible: z.boolean().optional(),
          disabled: z.boolean().optional(),
          blockedByAllowlist: z.boolean().optional(),
          source: z.string().optional(),
          bundled: z.boolean().optional()
        })
        .passthrough()
    )
  })
  .passthrough();

const skillLibraryEntrySchema = z.object({
  skillId: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  ownerProfileId: z.string().nullable(),
  ownerLabel: z.string(),
  authorProfileId: z.string(),
  shared: z.boolean(),
  enabled: z.boolean(),
  removed: z.boolean(),
  revision: z.string(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  canEdit: z.boolean()
}).passthrough();

const skillLibrarySelectionSchema = z.object({
  skillId: z.string(),
  revision: z.string(),
  name: z.string(),
  ownerProfileId: z.string().nullable(),
  slug: z.string(),
  description: z.string(),
  ownerLabel: z.string()
}).passthrough();

export const skillLibraryListPayloadSchema = z.object({
  entries: z.array(skillLibraryEntrySchema),
  profileId: z.string().nullable(),
  multipleProfiles: z.boolean(),
  defaultTarget: z.enum(["workspace", "personal", "unavailable"]),
  canManageWorkspace: z.boolean(),
  defaultSelectionLimit: z.number().int().nonnegative(),
  defaultSelectionNotice: z.string().optional(),
  session: z.object({
    sessionKey: z.string(),
    selections: z.array(skillLibrarySelectionSchema),
    attachable: z.array(skillLibraryEntrySchema)
  }).passthrough().optional()
}).passthrough();

export const skillLibraryReadPayloadSchema = z.object({
  entry: skillLibraryEntrySchema,
  content: z.string(),
  files: z.array(z.object({
    path: z.string(),
    content: z.string(),
    encoding: z.enum(["utf8", "base64"]).optional(),
    executable: z.boolean().optional()
  }).passthrough()),
  revisions: z.array(z.object({
    revision: z.string(),
    createdAt: z.number().int().nonnegative()
  }).passthrough())
}).passthrough();

export const skillLibraryActivatePayloadSchema = z.object({
  sessionKey: z.string(),
  selections: z.array(skillLibrarySelectionSchema),
  sessionActivation: z.literal("next-turn")
}).passthrough();

const memorySearchResultSchema = z.object({
  path: z.string(),
  startLine: z.number().int().nonnegative(),
  endLine: z.number().int().nonnegative(),
  score: z.number(),
  vectorScore: z.number().optional(),
  textScore: z.number().optional(),
  snippet: z.string(),
  source: z.enum(["memory", "sessions"]),
  importance: z.number().optional(),
  triggers: z.string().optional(),
  projectKey: z.string().optional(),
  originClass: z.string().optional(),
  citation: z.string().optional(),
  provenance: z.object({
    originClass: z.enum(["owner", "agent", "untrusted", "system"]),
    sessionKind: z.enum(["interactive", "cron", "heartbeat", "subagent", "unknown"]),
    observedAt: z.number(),
    supersedesKey: z.string().optional()
  }).passthrough().optional()
}).passthrough();

export const memorySearchPayloadSchema = z.object({
  agentId: z.string(),
  provider: z.string(),
  searchMode: z.enum(["hybrid", "fts-only"]),
  results: z.array(memorySearchResultSchema),
  stale: z.literal(true).optional(),
  warning: z.string().optional(),
  action: z.string().optional()
}).passthrough();

const memoryEmbeddingPayloadSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  checked: z.boolean().optional(),
  cached: z.boolean().optional(),
  checkedAtMs: z.number().optional(),
  cacheExpiresAtMs: z.number().optional()
}).passthrough();

export const memoryStatusPayloadSchema = z.object({
  agentId: z.string(),
  provider: z.string().optional(),
  embedding: memoryEmbeddingPayloadSchema,
  embeddingRuntime: z.object({
    engine: z.literal("llama.cpp"),
    state: z.enum(["ready", "failed"]),
    backend: z.enum(["metal", "cpu"]).optional(),
    buildInfo: z.string().optional(),
    model: z.object({ id: z.string(), path: z.string().optional() }).passthrough().optional(),
    capabilities: z.object({ vision: z.boolean(), draft: z.boolean() }).passthrough().optional(),
    endpoints: z.record(z.string(), z.enum(["ready", "unavailable"])).optional(),
    loadError: z.string().optional()
  }).passthrough().optional(),
  dreaming: z.object({
    enabled: z.boolean(),
    timezone: z.string().optional(),
    verboseLogging: z.boolean(),
    storageMode: z.enum(["inline", "separate", "both"]),
    separateReports: z.boolean(),
    shortTermCount: z.number().int().nonnegative(),
    recallSignalCount: z.number().int().nonnegative(),
    dailySignalCount: z.number().int().nonnegative(),
    groundedSignalCount: z.number().int().nonnegative(),
    totalSignalCount: z.number().int().nonnegative(),
    phaseSignalCount: z.number().int().nonnegative(),
    lightPhaseHitCount: z.number().int().nonnegative(),
    remPhaseHitCount: z.number().int().nonnegative(),
    promotedTotal: z.number().int().nonnegative(),
    promotedToday: z.number().int().nonnegative(),
    lastPromotedAt: z.string().optional(),
    storeError: z.string().optional(),
    phaseSignalError: z.string().optional(),
    phases: z.record(z.string(), z.record(z.string(), z.unknown())).optional()
  }).passthrough().optional()
}).passthrough();

export const memoryDreamDiaryPayloadSchema = z.object({
  agentId: z.string(),
  found: z.boolean(),
  path: z.string(),
  content: z.string().optional(),
  updatedAtMs: z.number().optional()
}).passthrough();

export const memoryDreamActionPayloadSchema = z.object({
  agentId: z.string(),
  action: z.enum(["backfill", "reset", "resetGroundedShortTerm", "repairDreamingArtifacts", "dedupeDreamDiary"]),
  path: z.string().optional(),
  found: z.boolean().optional(),
  scannedFiles: z.number().int().nonnegative().optional(),
  written: z.number().int().nonnegative().optional(),
  replaced: z.number().int().nonnegative().optional(),
  removedEntries: z.number().int().nonnegative().optional(),
  removedShortTermEntries: z.number().int().nonnegative().optional(),
  changed: z.boolean().optional(),
  archiveDir: z.string().optional(),
  archivedDreamsDiary: z.boolean().optional(),
  archivedSessionCorpus: z.boolean().optional(),
  archivedSessionIngestion: z.boolean().optional(),
  warnings: z.array(z.string()).optional(),
  dedupedEntries: z.number().int().nonnegative().optional(),
  keptEntries: z.number().int().nonnegative().optional()
}).passthrough();

export const pluginsPayloadSchema = z
  .object({
    plugins: z
      .array(
        z
          .object({
            id: z.string(),
            name: z.string(),
            status: z.string().optional(),
            toolNames: z.array(z.string()).optional()
          })
          .passthrough()
      )
      .optional(),
    descriptors: z.array(z.object({}).passthrough()).optional()
  })
  .passthrough();

export const configSnapshotPayloadSchema = z
  .object({
    exists: z.boolean().optional(),
    valid: z.boolean().optional(),
    hash: z.string().optional(),
    configRevisionHash: z.string().optional(),
    appliedConfigHash: z.string().nullable().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    resolved: z.unknown().optional()
  })
  .passthrough();

const updateRunStepSchema = z.object({
  step: z.string().min(1).max(128),
  status: z.enum(["pending", "in_progress", "completed", "failed", "skipped"]),
  startedAtMs: z.number().int().nonnegative().optional(),
  endedAtMs: z.number().int().nonnegative().optional(),
  detail: z.string().max(512).optional()
}).passthrough();

const updateRunVerificationSchema = z.object({
  booted: z.boolean().optional(),
  runningVersion: z.string().max(128).nullable().optional(),
  runningBuildId: z.string().max(256).nullable().optional(),
  serviceRunning: z.boolean().optional(),
  versionMatch: z.boolean().optional(),
  channelsReady: z.boolean().optional(),
  inferenceProbe: z.enum(["passed", "failed", "skipped"]).optional(),
  noticeDelivered: z.boolean().optional(),
  doctorHint: z.string().max(512).nullable().optional()
}).passthrough();

const updateRunRecordSchema = z.object({
  runId: z.string().min(1).max(128),
  createdAtMs: z.number().int().nonnegative(),
  updatedAtMs: z.number().int().nonnegative(),
  trigger: z.enum(["chat", "control-ui", "cli", "campaign", "mac-app", "api"]),
  phase: z.enum(["requested", "staging", "validating", "repairing", "activating", "restarting", "verifying", "finished"]),
  status: z.enum(["running", "succeeded", "failed", "rolled-back", "skipped"]),
  reason: z.string().max(512).nullable(),
  target: z.object({
    channel: z.string().max(64).optional(),
    tag: z.string().max(128).optional(),
    kind: z.enum(["package", "git"]).optional(),
    version: z.string().max(128).optional(),
    sha: z.string().max(256).optional()
  }).passthrough().optional(),
  before: z.object({
    version: z.string().max(128).nullable().optional(),
    sha: z.string().max(256).nullable().optional(),
    buildId: z.string().max(256).nullable().optional()
  }).passthrough().optional(),
  after: z.object({
    version: z.string().max(128).nullable().optional(),
    sha: z.string().max(256).nullable().optional(),
    buildId: z.string().max(256).nullable().optional()
  }).passthrough().optional(),
  steps: z.array(updateRunStepSchema).max(128).optional(),
  verification: updateRunVerificationSchema.optional(),
  repair: z.array(z.object({
    attempt: z.number().int().nonnegative(),
    status: z.enum(["succeeded", "failed", "skipped"]),
    startedAtMs: z.number().int().nonnegative().optional(),
    endedAtMs: z.number().int().nonnegative().optional(),
    summary: z.string().max(512).optional(),
    reason: z.string().max(512).optional()
  }).passthrough()).max(16).optional(),
  confirmedAtMs: z.number().int().nonnegative().nullable().optional(),
  finishedAtMs: z.number().int().nonnegative().nullable().optional(),
  downtimeMs: z.number().int().nonnegative().nullable().optional()
}).passthrough();

export const nativeUpdateStatusPayloadSchema = z
  .object({
    sentinel: z.unknown(),
    updateAvailable: z.record(z.string(), z.unknown()).nullable(),
    activeRun: updateRunRecordSchema.nullable().optional(),
    lastRun: updateRunRecordSchema.nullable().optional(),
    effectiveChannel: z.enum(["stable", "extended-stable", "beta", "dev"]).optional(),
    schedule: z.record(z.string(), z.unknown()).optional()
  })
  .passthrough();

export const genericObjectPayloadSchema = z.object({}).passthrough();

export function parseGatewayPayload<TPayload>(operation: string, schema: z.ZodTypeAny, payload: unknown) {
  const parsed = schema.safeParse(payload);

  if (!parsed.success) {
    throw new OpenClawGatewayClientError(
      `${operation}: OpenClaw Gateway returned a malformed response.`,
      "malformed-response",
      { cause: parsed.error }
    );
  }

  return parsed.data as TPayload;
}

export function parseObjectGatewayPayload<TPayload>(operation: string, payload: unknown) {
  return parseGatewayPayload<TPayload>(operation, genericObjectPayloadSchema, payload);
}

export function hasNativeStatusUpdateRegistry(status: StatusPayload) {
  return Boolean(status.update?.registry?.latestVersion || status.update?.registry?.error);
}

export function rememberStatusUpdateRegistry(registry: StatusUpdateRegistry | undefined) {
  if (!registry?.latestVersion && !registry?.error) {
    return;
  }

  cachedStatusUpdateRegistry = { ...registry };
}

export function getCachedStatusUpdateRegistry(status: StatusPayload): StatusUpdateRegistry | undefined {
  const currentVersion = normalizeStatusVersion(status);
  const cachedLatestVersion = cachedStatusUpdateRegistry?.latestVersion?.trim();

  if (!cachedStatusUpdateRegistry) {
    return undefined;
  }

  if (currentVersion && cachedLatestVersion && compareVersionStrings(currentVersion, cachedLatestVersion) > 0) {
    cachedStatusUpdateRegistry = null;
    return undefined;
  }

  return cachedStatusUpdateRegistry ?? undefined;
}

export function normalizeStatusVersion(status: StatusPayload) {
  return (status.runtimeVersion || status.overview?.version || status.version || "").trim().replace(/^v/i, "") || null;
}

export function mergeStatusPayload(status: StatusPayload, fallbackStatus: StatusPayload | null): StatusPayload {
  const nativeUpdate = status.update ?? {};
  const fallbackUpdate = fallbackStatus?.update ?? {};
  const cachedRegistry = getCachedStatusUpdateRegistry(status);
  const registry = nativeUpdate.registry ?? fallbackUpdate.registry;
  const resolvedRegistry = registry ?? cachedRegistry ?? undefined;

  if (resolvedRegistry) {
    rememberStatusUpdateRegistry(resolvedRegistry);
  }

  if (!fallbackStatus && !resolvedRegistry) {
    return status;
  }

  const update: NonNullable<StatusPayload["update"]> = {
    ...fallbackUpdate,
    ...nativeUpdate
  };

  if (resolvedRegistry) {
    update.registry = resolvedRegistry;
  }

  return {
    ...fallbackStatus,
    ...status,
    update
  };
}

export let cachedStatusUpdateRegistry: StatusUpdateRegistry | null = null;

export function normalizeModelsPayload(payload: unknown): ModelsPayload {
  const parsed = parseGatewayPayload<{ models: Array<Record<string, unknown>> }>(
    "models.list",
    modelsPayloadSchema,
    payload
  );

  return {
    ...parsed,
    models: parsed.models.map((entry) => {
      const id = readNonEmptyString(entry.id);
      const provider = readNonEmptyString(entry.provider);
      const key = readNonEmptyString(entry.key) ?? (provider && id ? `${provider}/${id}` : id);
      const input = Array.isArray(entry.input)
        ? entry.input.filter((value): value is string => typeof value === "string").join(",") || "text"
        : readNonEmptyString(entry.input) ?? "text";
      const tags = Array.isArray(entry.tags) ? entry.tags.filter((tag): tag is string => typeof tag === "string") : [];

      if ((entry.default === true || entry.isDefault === true) && !tags.includes("default")) {
        tags.push("default");
      }

      return {
        key: key ?? readNonEmptyString(entry.name) ?? "unknown",
        name: readNonEmptyString(entry.name) ?? key ?? id ?? "Unknown model",
        ...(provider ? { provider } : {}),
        input,
        contextWindow: typeof entry.contextWindow === "number" ? entry.contextWindow : null,
        ...(Array.isArray(entry.contextWindows) ? { contextWindows: entry.contextWindows } : {}),
        ...(typeof entry.contextWindowDefault === "string" ? { contextWindowDefault: entry.contextWindowDefault } : {}),
        local: typeof entry.local === "boolean" ? entry.local : null,
        available: typeof entry.available === "boolean" ? entry.available : null,
        ...(typeof entry.unavailableReason === "string" ? { unavailableReason: entry.unavailableReason } : {}),
        ...(typeof entry.unavailableUntil === "number" ? { unavailableUntil: entry.unavailableUntil } : {}),
        ...(typeof entry.reasoning === "boolean" ? { reasoning: entry.reasoning } : {}),
        ...(Array.isArray(entry.thinkingLevels) ? { thinkingLevels: entry.thinkingLevels } : {}),
        ...(typeof entry.thinkingDefault === "string" ? { thinkingDefault: entry.thinkingDefault } : {}),
        ...(typeof entry.supportsTools === "boolean" ? { supportsTools: entry.supportsTools } : {}),
        ...(typeof entry.alias === "string" ? { alias: entry.alias } : {}),
        ...(typeof entry.apiKeySupported === "boolean" ? { apiKeySupported: entry.apiKeySupported } : {}),
        ...(isObjectRecord(entry.agentRuntime) && typeof entry.agentRuntime.id === "string"
          ? { agentRuntime: entry.agentRuntime as { id: string; fallback?: "openclaw" | "none"; source?: string } }
          : {}),
        ...(typeof entry.deprecated === "boolean" ? { deprecated: entry.deprecated } : {}),
        ...(typeof entry.disabled === "boolean" ? { disabled: entry.disabled } : {}),
        tags,
        missing: entry.missing === true
      };
    })
  };
}

export function normalizeModelStatusPayload(authPayload: unknown, modelsPayload: unknown): ModelsStatusPayload {
  const auth = isObjectRecord(authPayload) ? authPayload : {};
  const models = modelsPayload ? normalizeModelsPayload(modelsPayload).models : [];
  const allowed = models.map((model) => model.key).filter(Boolean);
  const defaultModel = resolveDefaultModelFromStatus(auth, models);
  const resolvedDefault = readNonEmptyString(auth.resolvedDefault) ??
    readNonEmptyString(auth.resolvedDefaultModel) ??
    defaultModel;
  const authProviders = Array.isArray(auth.providers)
    ? auth.providers.filter((entry): entry is Record<string, unknown> => isObjectRecord(entry))
    : [];

  return {
    defaultModel,
    resolvedDefault,
    allowed,
    auth: {
      providers: authProviders.map((entry) => {
        const profileSummary = summarizeAuthProfiles(
          readNonEmptyString(entry.provider),
          entry.profiles
        );
        const rawEffectiveKind = readAuthKind(entry.effective) ??
          readAuthKind(entry) ??
          readNonEmptyString(entry.kind)?.toLowerCase();
        const effectiveKind = resolveNormalizedAuthKind({
          provider: readNonEmptyString(entry.provider),
          profileSummary,
          rawEffectiveKind,
          status: readNonEmptyString(entry.status)
        });

        return {
          provider: readNonEmptyString(entry.provider) ?? undefined,
          effective: {
            kind: effectiveKind,
            detail: readNonEmptyString(entry.detail) ?? undefined
          },
          profiles: {
            count: profileSummary.hasProfileList ? profileSummary.usableCount : undefined,
            oauth: profileSummary.hasProfileList ? profileSummary.usableOauthCount : undefined,
            token: profileSummary.hasProfileList ? profileSummary.usableTokenCount : undefined,
            apiKey: profileSummary.hasProfileList ? profileSummary.usableApiKeyCount : undefined
          }
        };
      }),
      runtimeAuthRoutes: normalizeRuntimeAuthRoutes(auth.runtimeAuthRoutes),
      missingProvidersInUse: Array.isArray(auth.missingProvidersInUse)
        ? auth.missingProvidersInUse.filter((entry): entry is string => typeof entry === "string")
        : [],
      unusableProfiles: Array.isArray(auth.unusableProfiles) ? auth.unusableProfiles : [],
      oauth: {
        providers: authProviders.map((entry) => normalizeOauthProviderEntry(entry))
      }
    }
  };
}

type AuthProfileSummary = {
  hasProfileList: boolean;
  usableCount: number;
  usableOauthCount: number;
  usableTokenCount: number;
  usableApiKeyCount: number;
  oauthProfiles: unknown[];
};

function summarizeAuthProfiles(provider: string | null, value: unknown): AuthProfileSummary {
  if (!Array.isArray(value)) {
    return {
      hasProfileList: false,
      usableCount: 0,
      usableOauthCount: 0,
      usableTokenCount: 0,
      usableApiKeyCount: 0,
      oauthProfiles: []
    };
  }

  let usableCount = 0;
  let usableOauthCount = 0;
  let usableTokenCount = 0;
  let usableApiKeyCount = 0;
  const oauthProfiles: unknown[] = [];

  for (const profile of value) {
    const classification = classifyAuthProfile(provider, profile);
    if (!isUsableAuthProfile(profile)) {
      if (classification === "oauth") {
        oauthProfiles.push(profile);
      }
      continue;
    }

    if (provider?.toLowerCase() === "openai" && classification === "unknown") {
      continue;
    }

    usableCount += 1;
    if (classification === "oauth") {
      usableOauthCount += 1;
      oauthProfiles.push(profile);
    } else if (classification === "api-key") {
      usableApiKeyCount += 1;
    } else {
      usableTokenCount += 1;
    }
  }

  return {
    hasProfileList: true,
    usableCount,
    usableOauthCount,
    usableTokenCount,
    usableApiKeyCount,
    oauthProfiles
  };
}

function classifyAuthProfile(provider: string | null, value: unknown): "oauth" | "api-key" | "unknown" {
  if (!isObjectRecord(value)) {
    return "unknown";
  }

  const profileId = readNonEmptyString(value.profileId) ?? readNonEmptyString(value.id);
  const rawKind = readAuthKind(value);
  if (
    provider?.toLowerCase() === "openai" &&
    rawKind === "oauth" &&
    !profileId?.toLowerCase().startsWith("openai:")
  ) {
    return "unknown";
  }
  if (rawKind === "oauth") {
    return "oauth";
  }
  if (rawKind === "api-key") {
    return "api-key";
  }

  if (provider?.toLowerCase() === "openai" && profileId?.toLowerCase().startsWith("openai:")) {
    return "oauth";
  }

  return "unknown";
}

function readAuthKind(value: unknown): "oauth" | "api-key" | null {
  if (!isObjectRecord(value)) {
    return null;
  }

  const rawValues = [value.authMethod, value.method, value.type, value.mode, value.kind]
    .map(readNonEmptyString)
    .filter((entry): entry is string => Boolean(entry));

  for (const rawValue of rawValues) {
    const normalized = rawValue.toLowerCase().replace(/[_\s]/g, "-");
    if (["oauth", "chatgpt-oauth", "chatgpt"].includes(normalized)) {
      return "oauth";
    }
    if (["api-key", "apikey", "api-key-auth", "token", "api-token", "key"].includes(normalized)) {
      return "api-key";
    }
  }

  return null;
}

function resolveNormalizedAuthKind({
  provider,
  profileSummary,
  rawEffectiveKind,
  status
}: {
  provider: string | null;
  profileSummary: AuthProfileSummary;
  rawEffectiveKind: string | undefined;
  status: string | null;
}) {
  if (profileSummary.usableOauthCount > 0) {
    return "ok";
  }
  if (profileSummary.usableApiKeyCount > 0) {
    return "api-key";
  }

  const normalizedRawKind = rawEffectiveKind?.toLowerCase().replace(/[_\s]/g, "-");
  if (
    profileSummary.hasProfileList &&
    profileSummary.oauthProfiles.length > 0 &&
    profileSummary.usableOauthCount === 0
  ) {
    return "unusable";
  }

  if (provider?.toLowerCase() === "openai" && profileSummary.hasProfileList && profileSummary.usableCount === 0) {
    return "unusable";
  }

  if (normalizedRawKind === "oauth") {
    return profileSummary.hasProfileList ? "unusable" : "oauth";
  }
  if (["api-key", "apikey", "token"].includes(normalizedRawKind ?? "")) {
    return profileSummary.hasProfileList ? "unusable" : "api-key";
  }

  return status ?? rawEffectiveKind;
}

function normalizeOauthProviderEntry(entry: Record<string, unknown>) {
  const provider = readNonEmptyString(entry.provider);
  const profileSummary = summarizeAuthProfiles(provider, entry.profiles);
  const rawEffectiveKind = readAuthKind(entry.effective) ??
    readAuthKind(entry) ??
    readNonEmptyString(entry.kind)?.toLowerCase();
  const explicitOauth = rawEffectiveKind?.toLowerCase().replace(/[_\s]/g, "-") === "oauth";
  const hasOauthState = profileSummary.oauthProfiles.length > 0 ||
    (explicitOauth && !profileSummary.hasProfileList);

  return {
    provider: provider ?? undefined,
    status: profileSummary.usableOauthCount > 0
      ? "ok"
      : hasOauthState
        ? readNonEmptyString(entry.status) ?? undefined
        : undefined,
    profiles: profileSummary.oauthProfiles.length > 0 ? profileSummary.oauthProfiles : undefined,
    effectiveProfiles: Array.isArray(entry.effectiveProfiles)
      ? entry.effectiveProfiles.filter((profile) => classifyAuthProfile(provider, profile) === "oauth")
      : undefined
  };
}

function normalizeRuntimeAuthRoutes(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is Record<string, unknown> => isObjectRecord(entry))
    .map((entry) => ({
      provider: readNonEmptyString(entry.provider) ?? undefined,
      runtime: readNonEmptyString(entry.runtime) ?? undefined,
      authProvider: readNonEmptyString(entry.authProvider) ?? undefined,
      status: readNonEmptyString(entry.status) ?? undefined
    }));
}

export function resolveDefaultModelFromStatus(auth: Record<string, unknown>, models: ModelsPayload["models"]) {
  return readNonEmptyString(auth.defaultModel) ??
    readNonEmptyString(auth.default) ??
    models.find((model) => model.tags.some((tag) => tag.toLowerCase() === "default"))?.key ??
    null;
}

export function countUsableAuthProfiles(value: unknown) {
  if (!Array.isArray(value)) {
    return 0;
  }

  return value.filter((entry) => isUsableAuthProfile(entry)).length;
}

export function isUsableAuthProfile(value: unknown) {
  if (!isObjectRecord(value)) {
    return false;
  }

  const status = readNonEmptyString(value.status)?.toLowerCase();
  if (!status) {
    return true;
  }

  return !["expired", "missing", "invalid", "error", "disabled", "revoked"].includes(status);
}

export function normalizePluginsPayload(payload: unknown): OpenClawPluginListPayload {
  const parsed = parseGatewayPayload<{ plugins?: Array<Record<string, unknown>>; descriptors?: Array<Record<string, unknown>> }>(
    "plugins.uiDescriptors",
    pluginsPayloadSchema,
    payload
  );
  const source = parsed.plugins ?? parsed.descriptors ?? [];

  return {
    plugins: source.map((entry) => ({
      ...entry,
      id: readNonEmptyString(entry.id) ?? readNonEmptyString(entry.pluginId) ?? readNonEmptyString(entry.name) ?? "unknown",
      name: readNonEmptyString(entry.name) ?? readNonEmptyString(entry.label) ?? readNonEmptyString(entry.id) ?? "Unknown plugin",
      status: readNonEmptyString(entry.status) ?? undefined,
      enabled: typeof entry.enabled === "boolean" ? entry.enabled : undefined,
      origin: readNonEmptyString(entry.origin) ?? undefined,
      channelIds: Array.isArray(entry.channelIds)
        ? entry.channelIds.filter((channelId): channelId is string => typeof channelId === "string")
        : undefined,
      toolNames: Array.isArray(entry.toolNames)
        ? entry.toolNames.filter((toolName): toolName is string => typeof toolName === "string")
        : undefined,
      dependencyStatus: isObjectRecord(entry.dependencyStatus)
        ? {
            installed: typeof entry.dependencyStatus.installed === "boolean" ? entry.dependencyStatus.installed : undefined,
            requiredInstalled: typeof entry.dependencyStatus.requiredInstalled === "boolean"
              ? entry.dependencyStatus.requiredInstalled
              : undefined
          }
        : undefined
    }))
  };
}

export function buildSessionExportPayload(
  input: OpenClawSessionExportInput,
  payload: Record<string, unknown>
): OpenClawSessionExportPayload {
  if (typeof payload.content === "string") {
    return {
      ...payload,
      format: input.format ?? (typeof payload.format === "string" ? payload.format : "json")
    };
  }

  const format = input.format ?? "json";
  return {
    ...payload,
    format,
    session: payload.session ?? payload,
    content: format === "json" ? JSON.stringify(payload) : undefined
  };
}

export function summarizeSnapshotError(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason || "Unknown OpenClaw Gateway snapshot error.");
}

export function clearCachedStatusUpdateRegistry() {
  cachedStatusUpdateRegistry = null;
}
