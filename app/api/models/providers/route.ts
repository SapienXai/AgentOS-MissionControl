import { NextResponse } from "next/server";
import { z } from "zod";

import {
  formatModelProviderLabel,
  getModelProviderDescriptor,
  isAddModelsProviderId,
  isBuiltInAddModelsProviderId
} from "@/lib/openclaw/model-provider-registry";
import { formatOpenClawCommand, resolveOpenClawBin } from "@/lib/openclaw/cli";
import {
  listOpenClawModels,
  scanOpenClawModels
} from "@/lib/openclaw/application/catalog-service";
import {
  isOpenAiAuthRefreshFailure,
  isOpenAiProviderPluginMissing
} from "@/lib/openclaw/model-auth-errors";
import { connectOpenClawChatGptProvider } from "@/lib/openclaw/application/chatgpt-provider-auth-service";
import {
  clearOpenAiAuthRuntimeSmokeFailures,
  getLatestOpenAiAuthRuntimeSmokeFailure,
  readMissionControlSettings
} from "@/lib/openclaw/domains/control-plane-settings";
import {
  buildModelStatusConnectionStatus,
  normalizeOpenAiModelId
} from "@/lib/openclaw/domains/model-provider-connection";
import { mergeOllamaCatalogModels } from "@/lib/openclaw/domains/model-provider-catalog";
import { clearMissionControlCaches, getMissionControlSnapshot } from "@/lib/agentos/control-plane";
import { clearModelCatalogCache } from "@/lib/openclaw/application/model-catalog-cache-service";
import { readLocalOllamaModels } from "@/lib/openclaw/application/local-model-provider-service";
import {
  addOpenClawModelsToConfig,
  addOpenClawExplicitProviderModelsToConfig,
  buildOpenClawFileBasedProviderConnectionStatus,
  ensureOpenClawOllamaLocalCredential,
  readOpenClawExplicitProviderConfig,
  persistOpenClawExplicitProviderConfig,
  readOpenClawOpenAiProviderConfig,
  persistOpenClawOpenAiProviderConfig,
  persistOpenClawProviderToken,
  readOpenClawProviderConfigSummary,
  readOpenClawConfiguredModelIds,
  readOpenClawExplicitProviderSummaries,
  readOpenClawProviderModelStatus,
  readOpenClawProviderCredentialConfigured,
  replaceOpenClawProviderCredential,
  updateOpenClawProviderSettings,
  setOpenClawDefaultModel
} from "@/lib/openclaw/application/model-provider-state-service";
import {
  disconnectModelProvider,
  disconnectModelProviderCredential,
  inspectModelProviderDisconnect,
  inspectModelRemoval,
  removeModelSafely
} from "@/lib/openclaw/application/model-provider-disconnect-service";
import {
  isModelProviderDisconnected,
  setModelProviderDisconnected
} from "@/lib/openclaw/domains/control-plane-settings";
import {
  isGatewayAuthSetupRecoveryError,
  runWithGatewayAuthSetupRecovery
} from "@/lib/openclaw/model-setup-recovery";
import type {
  AddModelsCatalogModel,
  AddModelsEmptyState,
  AddModelsProviderActionRequest,
  AddModelsProviderActionResult,
  AddModelsProviderConnectionStatus,
  AddModelsProviderId,
  MissionControlSnapshot
} from "@/lib/agentos/contracts";
import type {
  ModelsPayload,
  ModelsStatusPayload,
  OpenClawModelScanPayload as OpenClawModelScanPayloadFromClient
} from "@/lib/openclaw/client/gateway-client";
import type {
  OpenClawProviderModelEntry,
  OpenClawProviderModelsEntry
} from "@/lib/openclaw/application/model-provider-state-service";
import { redactErrorMessage, redactSecretText, redactSecrets } from "@/lib/security/redaction";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const addModelsDocsUrl = "https://docs.openclaw.ai/cli/models";
const openAiDiscoveryTimeoutMs = 15_000;
const explicitProviderDiscoveryTimeoutMs = 8_000;
const explicitProviderIdSchema = z.string().trim().min(2).max(63).refine(
  (value) => isAddModelsProviderId(value),
  "Provider ID must use lowercase letters, numbers, hyphen, or underscore."
);
const optionalInputString = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().trim().min(1).optional());

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("status"),
    provider: explicitProviderIdSchema,
    includeSnapshot: z.boolean().optional(),
    refreshAuth: z.boolean().optional(),
    discover: z.boolean().optional()
  }),
  z.object({
    action: z.literal("connect"),
    provider: explicitProviderIdSchema,
    providerName: optionalInputString,
    apiKey: optionalInputString,
    endpoint: optionalInputString,
    modelId: optionalInputString,
    authMethod: z.enum(["api-key", "chatgpt-oauth"]).optional(),
    force: z.boolean().optional()
  }),
  z.object({
    action: z.literal("update-provider"),
    provider: explicitProviderIdSchema,
    endpoint: z.string().trim().min(1).nullable().optional(),
    api: z.enum([
      "openai-completions",
      "openai-responses",
      "anthropic-messages",
      "google-generative-ai"
    ]).optional()
  }),
  z.object({
    action: z.literal("replace-credential"),
    provider: explicitProviderIdSchema,
    apiKey: z.string().trim().min(1)
  }),
  z.object({
    action: z.literal("switch-account"),
    provider: explicitProviderIdSchema
  }),
  z.object({
    action: z.literal("discover"),
    provider: explicitProviderIdSchema
  }),
  z.object({
    action: z.literal("add-models"),
    provider: explicitProviderIdSchema,
    modelIds: z.array(z.string().trim().min(1)).min(1)
  }),
  z.object({
    action: z.literal("set-default"),
    provider: explicitProviderIdSchema,
    modelId: z.string().trim().min(1)
  }),
  z.object({
    action: z.literal("remove-model-impact"),
    provider: explicitProviderIdSchema,
    modelId: z.string().trim().min(1)
  }),
  z.object({
    action: z.literal("remove-model"),
    provider: explicitProviderIdSchema,
    modelId: z.string().trim().min(1)
  }),
  z.object({
    action: z.literal("disconnect-impact"),
    provider: explicitProviderIdSchema
  }),
  z.object({
    action: z.literal("disconnect"),
    provider: explicitProviderIdSchema,
    confirmed: z.literal(true)
  }),
  z.object({
    action: z.literal("disconnect-credential-impact"),
    provider: explicitProviderIdSchema
  }),
  z.object({
    action: z.literal("disconnect-credential"),
    provider: explicitProviderIdSchema,
    confirmed: z.literal(true)
  }),
  z.object({
    action: z.literal("delete-provider-impact"),
    provider: explicitProviderIdSchema
  }),
  z.object({
    action: z.literal("delete-provider"),
    provider: explicitProviderIdSchema,
    confirmed: z.literal(true)
  })
]);

type OpenClawModelsListPayload = ModelsPayload;
type OpenClawModelScanPayload = OpenClawModelScanPayloadFromClient;

type OllamaState =
  | {
      installed: false;
      models: string[];
    }
  | {
      installed: true;
      models: string[];
    };

const providerTokenRules: Partial<Record<AddModelsProviderId, RegExp>> = {
  openrouter: /^sk-or-/i,
  openai: /^sk-/i,
  anthropic: /^sk-ant-/i
};

class ProviderAuthActionError extends Error {
  constructor(
    message: string,
    readonly manualCommand: string | null = null
  ) {
    super(message);
    this.name = "ProviderAuthActionError";
  }
}

export async function GET(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "runtime.use");
  if ("response" in permission) return permission.response;
  try {
    const providers = await readOpenClawExplicitProviderSummaries();

    return NextResponse.json(redactSecrets({ providers }), { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Model providers could not be loaded.")
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "secrets.manage");
  if ("response" in permission) return permission.response;
  let input: AddModelsProviderActionRequest;

  try {
    input = requestSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Model provider action is required.")
      },
      { status: 400 }
    );
  }

  try {
    const result = await handleProviderAction(input, request.signal);
    return NextResponse.json(redactSecrets(result), { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Add Models request failed.")
      },
      { status: 500 }
    );
  }
}

async function handleProviderAction(
  input: AddModelsProviderActionRequest,
  signal?: AbortSignal
): Promise<AddModelsProviderActionResult> {
  const commandBin = await resolveOpenClawBin().catch(() => "openclaw");

  if (input.action === "update-provider") {
    const providerConfig = await updateOpenClawProviderSettings(input.provider, {
      endpoint: input.endpoint,
      api: input.api
    });
    clearModelProviderCaches();
    const statusContext = await readProviderConnectionContext(input.provider);

    return buildActionResult({
      ok: true,
      action: input.action,
      provider: input.provider,
      message: providerConfig.endpointOverride
        ? `Saved the ${getModelProviderDescriptor(input.provider).shortLabel} endpoint override.`
        : `Restored the OpenClaw default endpoint for ${getModelProviderDescriptor(input.provider).shortLabel}.`,
      connection: statusContext.connection,
      providerConfig,
      models: [],
      docsUrl: addModelsDocsUrl
    });
  }

  if (input.action === "replace-credential") {
    validateApiKey(input.provider, input.apiKey);
    await replaceOpenClawProviderCredential(input.provider, input.apiKey);
    await setModelProviderDisconnected(input.provider, false);
    clearModelProviderCaches();
    const statusContext = await readProviderConnectionContext(input.provider);
    const providerConfig = await readOpenClawProviderConfigSummary(input.provider);

    return buildActionResult({
      ok: true,
      action: input.action,
      provider: input.provider,
      message: `Replaced the ${getModelProviderDescriptor(input.provider).shortLabel} credential in OpenClaw.`,
      connection: {
        ...statusContext.connection,
        connected: true,
        verification: "credential-stored",
        detail: "Credential stored in OpenClaw Gateway configuration. Verify by refreshing models."
      },
      providerConfig,
      models: [],
      docsUrl: addModelsDocsUrl
    });
  }

  if (input.action === "disconnect-credential-impact") {
    const [impact, statusContext, providerConfig] = await Promise.all([
      inspectModelProviderDisconnect(input.provider),
      readProviderConnectionContext(input.provider),
      readOpenClawProviderConfigSummary(input.provider)
    ]);

    return buildActionResult({
      ok: !impact.blockedReason && impact.credentialCleanup !== "retained-unsupported",
      action: input.action,
      provider: input.provider,
      message: impact.blockedReason ??
        (impact.credentialCleanup === "retained-unsupported"
          ? "OpenClaw does not expose credential removal for this provider."
          : `Disconnecting the credential keeps ${impact.providerModelIds.length} configured model${impact.providerModelIds.length === 1 ? "" : "s"} in the library.`),
      connection: statusContext.connection,
      providerConfig,
      models: [],
      disconnectImpact: impact,
      docsUrl: addModelsDocsUrl
    });
  }

  if (input.action === "disconnect-credential") {
    const result = await disconnectModelProviderCredential(input.provider);
    const [statusContext, providerConfig] = await Promise.all([
      readProviderConnectionContext(input.provider),
      readOpenClawProviderConfigSummary(input.provider)
    ]);

    return buildActionResult({
      ok: true,
      action: input.action,
      provider: input.provider,
      message: `Disconnected the ${getModelProviderDescriptor(input.provider).shortLabel} credential. Configured models were kept.`,
      connection: {
        ...statusContext.connection,
        connected: false,
        verification: "not-configured",
        source: "agentos-sidecar",
        detail: "Credential disconnected in AgentOS. Provider models remain configured."
      },
      providerConfig,
      models: [],
      disconnectImpact: result.impact,
      snapshot: result.snapshot,
      docsUrl: addModelsDocsUrl
    });
  }

  if (input.action === "delete-provider-impact" || input.action === "delete-provider") {
    if (isBuiltInAddModelsProviderId(input.provider)) {
      throw new Error("Bundled OpenClaw providers cannot be deleted. Disconnect the credential or restore the default endpoint instead.");
    }

    if (input.action === "delete-provider-impact") {
      const [impact, statusContext, providerConfig] = await Promise.all([
        inspectModelProviderDisconnect(input.provider),
        readProviderConnectionContext(input.provider),
        readOpenClawProviderConfigSummary(input.provider)
      ]);

      return buildActionResult({
        ok: !impact.blockedReason,
        action: input.action,
        provider: input.provider,
        message: impact.blockedReason ??
          `Deleting this custom provider removes ${impact.providerModelIds.length} configured model${impact.providerModelIds.length === 1 ? "" : "s"} and its OpenClaw provider definition.`,
        connection: statusContext.connection,
        providerConfig,
        models: [],
        disconnectImpact: impact,
        docsUrl: addModelsDocsUrl
      });
    }

    const result = await disconnectModelProvider(input.provider);
    const statusContext = await readProviderConnectionContext(input.provider);

    return buildActionResult({
      ok: true,
      action: input.action,
      provider: input.provider,
      message: `Deleted the ${getModelProviderDescriptor(input.provider).shortLabel} custom provider from OpenClaw.`,
      connection: {
        ...statusContext.connection,
        connected: false,
        verification: "not-configured",
        detail: "Custom provider deleted from OpenClaw."
      },
      models: [],
      disconnectImpact: result.impact,
      snapshot: result.snapshot,
      docsUrl: addModelsDocsUrl
    });
  }

  if (input.action === "disconnect-impact") {
    const [impact, statusContext] = await Promise.all([
      inspectModelProviderDisconnect(input.provider),
      readProviderConnectionContext(input.provider)
    ]);

    return buildActionResult({
      ok: !impact.blockedReason,
      action: input.action,
      provider: input.provider,
      message: impact.blockedReason ?? buildDisconnectImpactMessage(input.provider, impact),
      connection: statusContext.connection,
      models: [],
      disconnectImpact: impact,
      docsUrl: addModelsDocsUrl
    });
  }

  if (input.action === "remove-model-impact") {
    const [impact, statusContext] = await Promise.all([
      inspectModelRemoval(input.provider, input.modelId),
      readProviderConnectionContext(input.provider)
    ]);
    const providerModels = await readProviderCatalog(input.provider, statusContext.configuredModelIds)
      .catch(() => []);

    return buildActionResult({
      ok: !impact.blockedReason,
      action: input.action,
      provider: input.provider,
      message: impact.blockedReason ?? buildModelRemoveImpactMessage(impact),
      connection: statusContext.connection,
      models: providerModels,
      modelRemoveImpact: impact,
      docsUrl: addModelsDocsUrl
    });
  }

  if (input.action === "disconnect") {
    const result = await disconnectModelProvider(input.provider);
    const statusContext = await readProviderConnectionContext(input.provider);

    return buildActionResult({
      ok: true,
      action: input.action,
      provider: input.provider,
      message: buildDisconnectCompletedMessage(input.provider, result.impact),
      connection: {
        ...statusContext.connection,
        connected: false,
        detail: buildDisconnectedProviderDetail(result.impact.credentialCleanup)
      },
      models: [],
      disconnectImpact: result.impact,
      snapshot: result.snapshot,
      docsUrl: addModelsDocsUrl
    });
  }

  if (input.action === "status") {
    if (input.refreshAuth === true || input.discover === true) {
      clearModelProviderCaches();
    }

    let statusContext: Awaited<ReturnType<typeof readProviderConnectionContext>>;
    let authRefreshError: unknown = null;
    try {
      statusContext = await readProviderConnectionContext(input.provider, {
        refreshAuth: input.refreshAuth === true
      });
    } catch (error) {
      authRefreshError = error;
      statusContext = await readProviderConnectionContext(input.provider).catch(() => ({
        connection: buildUnknownProviderConnectionStatus(input.provider, error),
        configuredModelIds: new Set<string>(),
        ollamaState: null
      }));
    }

    const providerConfig = await readOpenClawProviderConfigSummary(input.provider);
    const intentionallyDisconnected = await isModelProviderDisconnected(input.provider);
    const connection = intentionallyDisconnected
      ? {
          ...statusContext.connection,
          connected: false,
          source: "agentos-sidecar" as const,
          degraded: true,
          stale: false,
          recovery: "Connect again to replace the provider credential and rediscover models.",
          detail: "Disconnected in AgentOS. Connect again to replace the provider credential and rediscover models."
        }
      : statusContext.connection;
    let models: AddModelsCatalogModel[] = [];
    let discovery: AddModelsProviderActionResult["discovery"] = {
      status: "not-requested",
      retryable: false,
      error: null
    };

    if (!authRefreshError && input.discover === true && connection.connected) {
      try {
        models = await readProviderCatalog(input.provider, statusContext.configuredModelIds, { refresh: true });
        discovery = {
          status: models.length > 0 ? "ready" : "empty",
          retryable: true,
          error: null
        };
      } catch (error) {
        discovery = {
          status: "failed",
          retryable: true,
          error: readProviderActionError(error)
        };
      }
    }

    const snapshot = (input.includeSnapshot || input.refreshAuth === true || input.discover === true) && connection.connected
      ? await getMissionControlSnapshot({ force: true }).catch(() => undefined)
      : undefined;

    const responseConnection = authRefreshError
      ? {
          ...connection,
          connected: false,
          verification: "unknown" as const,
          degraded: true,
          recovery: "Retry ChatGPT sign-in after the local OpenClaw Gateway auth state is available.",
          detail: readProviderActionError(authRefreshError)
        }
      : discovery.status === "failed" && connection.connected
        ? {
            ...connection,
            verification: "verified" as const,
            degraded: true,
            recovery: "ChatGPT is connected. Retry model discovery when the OpenClaw catalog is available."
          }
        : connection;

    return buildActionResult({
      ok: true,
      action: input.action,
      provider: input.provider,
      message: authRefreshError
        ? `OpenClaw could not refresh ${formatModelProviderLabel(input.provider)} authentication: ${readProviderActionError(authRefreshError)}`
        : discovery.status === "failed"
          ? `${formatModelProviderLabel(input.provider)} is connected, but model discovery failed: ${discovery.error ?? "OpenClaw did not return a catalog yet."}`
          : resolveProviderStatusMessage(input.provider, responseConnection),
      snapshot,
      connection: responseConnection,
      providerConfig,
      models,
      discovery,
      emptyState: statusContext.ollamaState ? resolveOllamaEmptyState(statusContext.ollamaState) : null,
      docsUrl: addModelsDocsUrl
    });
  }

  if (input.action === "connect") {
    await setModelProviderDisconnected(input.provider, false);
    if (!isBuiltInAddModelsProviderId(input.provider)) {
      return connectExplicitProvider(input);
    }

    if (input.provider === "ollama") {
      return discoverProviderModels(input.provider);
    }

    if (input.provider === "openai" && input.authMethod === "chatgpt-oauth") {
      const statusContext = await readProviderConnectionContext(input.provider);

      if (
        statusContext.connection.connected &&
        statusContext.connection.authMethod === "chatgpt-oauth"
      ) {
        return buildActionResult({
          ok: true,
          action: input.action,
          provider: input.provider,
          message: "ChatGPT is already connected through OpenClaw. Discover models to refresh the catalog.",
          connection: statusContext.connection,
          models: [],
          manualCommand: null,
          docsUrl: addModelsDocsUrl
        });
      }

      try {
        const authResult = await connectOpenClawChatGptProvider({
          force: input.force === true,
          signal
        });
        clearModelProviderCaches();
        const refreshedStatus = await readProviderConnectionContext(input.provider, { refreshAuth: true });
        let models: AddModelsCatalogModel[] = [];
        let discovery: AddModelsProviderActionResult["discovery"] = {
          status: "not-requested",
          retryable: false,
          error: null
        };

        try {
          models = await readProviderCatalog(
            input.provider,
            refreshedStatus.configuredModelIds,
            { refresh: true }
          );
          discovery = {
            status: models.length > 0 ? "ready" : "empty",
            retryable: true,
            error: null
          };
        } catch (error) {
          discovery = {
            status: "failed",
            retryable: true,
            error: readProviderActionError(error)
          };
        }

        const snapshot = await getMissionControlSnapshot({ force: true }).catch(() => undefined);

        return buildActionResult({
          ok: refreshedStatus.connection.connected,
          action: input.action,
          provider: input.provider,
          message: refreshedStatus.connection.connected
            ? discovery.status === "failed"
              ? `${authResult.pluginInstalled ? "Installed @openclaw/codex and connected" : "Connected"} ChatGPT through OpenClaw, but model discovery failed: ${discovery.error ?? "retry discovery to load models."}`
              : `${authResult.pluginInstalled ? "Installed @openclaw/codex and connected" : "Connected"} ChatGPT through OpenClaw. Found ${models.length} available model${models.length === 1 ? "" : "s"}.`
            : "OpenClaw finished ChatGPT sign-in but did not report a usable account yet. Try connecting again.",
          connection: {
            ...refreshedStatus.connection,
            needsTerminal: false,
            verification: refreshedStatus.connection.connected ? "verified" : refreshedStatus.connection.verification,
            degraded: refreshedStatus.connection.connected && discovery.status === "failed",
            recovery: refreshedStatus.connection.connected
              ? discovery.status === "failed"
                ? "ChatGPT is connected. Retry model discovery when the OpenClaw catalog is available."
                : null
              : "Try the in-app ChatGPT sign-in again. AgentOS will reopen OpenClaw's authorization page."
          },
          models,
          discovery,
          snapshot,
          manualCommand: null,
          docsUrl: addModelsDocsUrl
        });
      } catch (error) {
        return buildActionResult({
          ok: false,
          action: input.action,
          provider: input.provider,
          message: readProviderActionError(error),
          connection: {
            ...statusContext.connection,
            connected: false,
            needsTerminal: false,
            recovery: "Try Connect ChatGPT again to restart OpenClaw's in-app authorization flow."
          },
          models: [],
          manualCommand: null,
          docsUrl: addModelsDocsUrl
        });
      }
    }

    const apiKey = input.apiKey?.trim();

    if (!apiKey) {
      const statusContext = await readProviderConnectionContext(input.provider);

      return buildActionResult({
        ok: false,
        action: input.action,
        provider: input.provider,
        message: "Enter an API key to continue.",
        connection: statusContext.connection,
        models: [],
        docsUrl: addModelsDocsUrl
      });
    }

    validateApiKey(input.provider, apiKey);
    let repairedBlankEndpoint = false;
    try {
      if (input.provider === "openai" && input.endpoint) {
        const result = await persistOpenClawOpenAiProviderConfig(apiKey, {
          endpoint: normalizeOpenAiCompatibleProviderBaseUrl(input.endpoint)
        });
        repairedBlankEndpoint = result.repairedBlankEndpoint;
      } else {
        const result = await persistOpenClawProviderToken(input.provider, apiKey, {
          endpoint: input.endpoint
        });
        repairedBlankEndpoint = result.repairedBlankEndpoint;
      }
    } catch (error) {
      const statusContext = await readProviderConnectionContext(input.provider);
      return buildActionResult({
        ok: false,
        action: input.action,
        provider: input.provider,
        message: readProviderActionError(error),
        connection: statusContext.connection,
        models: [],
        docsUrl: addModelsDocsUrl
      });
    }

    clearModelProviderCaches();
    const snapshot = await getMissionControlSnapshot({ force: true }).catch(() => undefined);
    const statusContext = await readProviderConnectionContext(input.provider);
    const connectedLabel =
      input.provider === "openai" && input.endpoint
        ? "custom OpenAI-compatible endpoint"
        : getModelProviderDescriptor(input.provider).shortLabel;

    let models: AddModelsCatalogModel[] = [];
    try {
      models = await readProviderCatalog(input.provider, statusContext.configuredModelIds, {
        preferScan: input.provider === "openai" && Boolean(input.endpoint)
      });
    } catch (error) {
      return buildActionResult({
        ok: false,
        action: input.action,
        provider: input.provider,
        message: readProviderCredentialVerificationError(input.provider, error),
        snapshot,
        connection: {
          ...statusContext.connection,
          verification: "degraded",
          degraded: true,
          recovery: "The credential was saved. Retry discovery when the provider is reachable."
        },
        models: [],
        docsUrl: addModelsDocsUrl
      });
    }

    return buildActionResult({
      ok: true,
      action: input.action,
      provider: input.provider,
      message: `${repairedBlankEndpoint ? `Repaired the invalid ${connectedLabel} endpoint configuration. ` : ""}Connected ${connectedLabel}. Found ${models.length} available model${models.length === 1 ? "" : "s"}.`,
      snapshot,
      connection: {
        ...statusContext.connection,
        verification: "verified",
        detail: models.length > 0
          ? `Credential verified through OpenClaw. ${models.length} model${models.length === 1 ? "" : "s"} available.`
          : "Credential accepted by OpenClaw. No models were returned yet."
      },
      models,
      docsUrl: addModelsDocsUrl
    });
  }

  if (input.action === "switch-account") {
    const statusContext = await readProviderConnectionContext(input.provider);

    if (input.provider !== "openai") {
      return buildActionResult({
        ok: false,
        action: input.action,
        provider: input.provider,
        message: `${getModelProviderDescriptor(input.provider).shortLabel} account switching is not available in OpenClaw yet.`,
        connection: statusContext.connection,
        models: [],
        docsUrl: addModelsDocsUrl
      });
    }

    if (statusContext.connection.authMethod !== "chatgpt-oauth") {
      return buildActionResult({
        ok: false,
        action: input.action,
        provider: input.provider,
        message: "Switch account is available only for an existing ChatGPT OAuth connection.",
        connection: statusContext.connection,
        models: [],
        manualCommand: null,
        docsUrl: addModelsDocsUrl
      });
    }

    try {
      await connectOpenClawChatGptProvider({ force: true, signal });
      clearModelProviderCaches();
      const refreshedStatus = await readProviderConnectionContext(input.provider);
      const models = await readProviderCatalog(
        input.provider,
        refreshedStatus.configuredModelIds
      ).catch(() => []);
      const snapshot = await getMissionControlSnapshot({ force: true }).catch(() => undefined);

      return buildActionResult({
        ok: refreshedStatus.connection.connected,
        action: input.action,
        provider: input.provider,
        message: refreshedStatus.connection.connected
          ? `Switched the ChatGPT account through OpenClaw. Found ${models.length} available model${models.length === 1 ? "" : "s"}.`
          : "OpenClaw finished account switching but did not report a usable ChatGPT account yet.",
        connection: {
          ...refreshedStatus.connection,
          needsTerminal: false
        },
        models,
        snapshot,
        manualCommand: null,
        docsUrl: addModelsDocsUrl
      });
    } catch (error) {
      return buildActionResult({
        ok: false,
        action: input.action,
        provider: input.provider,
        message: readProviderActionError(error),
        connection: {
          ...statusContext.connection,
          needsTerminal: false,
          recovery: "Try Switch account again to restart OpenClaw's in-app authorization flow."
        },
        models: [],
        manualCommand: null,
        docsUrl: addModelsDocsUrl
      });
    }
  }

  if (input.action === "discover") {
    if (!isBuiltInAddModelsProviderId(input.provider)) {
      return discoverExplicitProviderModels(input.provider);
    }

    return discoverProviderModels(input.provider);
  }

  if (input.action === "set-default") {
    return setProviderDefaultModel(input.provider, input.modelId, commandBin);
  }

  if (input.action === "remove-model") {
    return removeProviderModel(input.provider, input.modelId);
  }

  let repairedGatewayAuth = false;

  if (!isBuiltInAddModelsProviderId(input.provider)) {
    return addExplicitProviderModels(input.provider, input.modelIds);
  }

  try {
    const result = await runWithGatewayAuthSetupRecovery(
      () => addOpenClawModelsToConfig(input.provider, input.modelIds),
      {
        operationLabel: "adding models"
      }
    );
    repairedGatewayAuth = Boolean(result.repaired);
  } catch (error) {
    const statusContext = await readProviderConnectionContext(input.provider);
    const providerModels = await readProviderCatalog(input.provider, statusContext.configuredModelIds)
      .catch(() => []);

    return buildActionResult({
      ok: false,
      action: input.action,
      provider: input.provider,
      message: readProviderActionError(error),
      connection: statusContext.connection,
      models: providerModels,
      manualCommand: isGatewayAuthSetupRecoveryError(error)
        ? formatOpenClawCommand(commandBin, ["gateway", "status", "--json"])
        : null,
      docsUrl: addModelsDocsUrl
    });
  }

  clearModelCatalogCache();
  const refreshedSnapshot = await getMissionControlSnapshot({ force: true });
  const statusContext = await readProviderConnectionContext(input.provider);
  const providerModels = await readProviderCatalog(input.provider, statusContext.configuredModelIds);

  return buildActionResult({
    ok: true,
    action: input.action,
    provider: input.provider,
    message: repairedGatewayAuth
      ? `Gateway auth was repaired and ${input.modelIds.length} model${input.modelIds.length === 1 ? " was" : "s were"} added to AgentOS.`
      : `Added ${input.modelIds.length} model${input.modelIds.length === 1 ? "" : "s"} to AgentOS.`,
    snapshot: refreshedSnapshot,
    connection: statusContext.connection,
    models: providerModels,
    docsUrl: addModelsDocsUrl
  });
}

async function connectExplicitProvider(
  input: Extract<AddModelsProviderActionRequest, { action: "connect" }>
): Promise<AddModelsProviderActionResult> {
  const providerName = input.providerName?.trim() || getModelProviderDescriptor(input.provider).label;
  let baseUrl: string;
  const apiKey = input.apiKey?.trim();
  const manualModelId = input.modelId?.trim();

  if (!input.endpoint?.trim() || !apiKey) {
    const statusContext = await readProviderConnectionContext(input.provider);

    return buildActionResult({
      ok: false,
      action: input.action,
      provider: input.provider,
      message: "Enter a base URL and API key to continue.",
      connection: statusContext.connection,
      models: [],
      docsUrl: addModelsDocsUrl
    });
  }

  try {
    baseUrl = normalizeOpenAiCompatibleProviderBaseUrl(input.endpoint);
  } catch (error) {
    const statusContext = await readProviderConnectionContext(input.provider);

    return buildActionResult({
      ok: false,
      action: input.action,
      provider: input.provider,
      message: readProviderActionError(error),
      connection: statusContext.connection,
      models: [],
      docsUrl: addModelsDocsUrl
    });
  }

  let discoveryFailed = false;
  let discoveryFailureMessage: string | null = null;
  const discoveredModels = await discoverOpenAiCompatibleEndpointModels(baseUrl, apiKey).catch((error) => {
    discoveryFailed = true;
    discoveryFailureMessage = readProviderActionError(error);
    return [];
  });
  const manualModels = manualModelId ? [toExplicitProviderModelEntry(manualModelId)] : [];

  await persistOpenClawExplicitProviderConfig(input.provider, {
    providerName,
    baseUrl,
    apiKey,
    api: "openai-completions",
    models: [...manualModels, ...discoveredModels]
  });
  clearModelProviderCaches();

  const snapshot = await getMissionControlSnapshot({ force: true }).catch(() => undefined);
  const statusContext = await readProviderConnectionContext(input.provider);
  const models = await readExplicitProviderCatalog(input.provider, statusContext.configuredModelIds);

  return buildActionResult({
    ok: true,
    action: input.action,
    provider: input.provider,
    message: discoveryFailed
      ? `Configured ${providerName}, but model discovery failed: ${discoveryFailureMessage ?? "endpoint did not return models"}. Add a model ID manually or retry discovery.`
      : `Connected ${providerName}. ${models.length > 0 ? "Select models to add next." : "Discovery returned no models; add a model ID manually."}`,
    snapshot,
    connection: discoveryFailed
      ? {
          ...statusContext.connection,
          connected: models.length > 0,
          degraded: true,
          stale: false,
          recovery: "Add a model ID manually or retry discovery after confirming the endpoint and key."
        }
      : statusContext.connection,
    models,
    emptyState: models.length === 0
      ? {
          kind: "no-models",
          title: "No models found",
          description: discoveryFailed
            ? "The endpoint configuration was saved, but direct model discovery failed. Enter a model ID manually or retry after checking the endpoint."
            : "The endpoint is configured, but model discovery did not return selectable models. Enter a model ID manually and reconnect."
        }
      : null,
    docsUrl: addModelsDocsUrl
  });
}

async function discoverExplicitProviderModels(
  provider: AddModelsProviderId
): Promise<AddModelsProviderActionResult> {
  const statusContext = await readProviderConnectionContext(provider);
  const models = await readExplicitProviderCatalog(provider, statusContext.configuredModelIds);

  return buildActionResult({
    ok: true,
    action: "discover",
    provider,
    message: models.length > 0
      ? `Found ${models.length} configured model${models.length === 1 ? "" : "s"}.`
      : "No models were returned for this provider.",
    connection: statusContext.connection,
    models,
    emptyState:
      models.length === 0
        ? {
            kind: "no-models",
            title: "No models found",
            description: "This provider is configured, but no model metadata is stored yet. Enter a model ID manually."
          }
        : null,
    docsUrl: addModelsDocsUrl
  });
}

async function addExplicitProviderModels(
  provider: AddModelsProviderId,
  modelIds: string[]
): Promise<AddModelsProviderActionResult> {
  const statusContext = await readProviderConnectionContext(provider);
  const catalogModels = await readExplicitProviderCatalog(provider, statusContext.configuredModelIds);
  const catalogById = new Map(catalogModels.map((model) => [model.id, model] as const));
  const metadata = modelIds
    .map((modelId) => catalogById.get(modelId))
    .filter((model): model is AddModelsCatalogModel => Boolean(model))
    .map((model) => {
      const metadata: OpenClawProviderModelEntry = {
        id: model.id.startsWith(`${provider}/`) ? model.id.slice(`${provider}/`.length) : model.id,
        name: model.name,
        input: model.input
      };

      if (typeof model.contextWindow === "number") {
        metadata.contextWindow = model.contextWindow;
      }

      return metadata;
    });

  await addOpenClawExplicitProviderModelsToConfig(provider, modelIds, metadata);
  clearModelProviderCaches();

  const refreshedSnapshot = await getMissionControlSnapshot({ force: true }).catch(() => undefined);
  const refreshedStatus = await readProviderConnectionContext(provider);
  const refreshedModels = await readExplicitProviderCatalog(provider, refreshedStatus.configuredModelIds);

  return buildActionResult({
    ok: true,
    action: "add-models",
    provider,
    message: `Added ${modelIds.length} model${modelIds.length === 1 ? "" : "s"} to AgentOS.`,
    snapshot: refreshedSnapshot,
    connection: refreshedStatus.connection,
    models: refreshedModels,
    docsUrl: addModelsDocsUrl
  });
}

async function setProviderDefaultModel(
  provider: AddModelsProviderId,
  modelId: string,
  commandBin = "openclaw"
): Promise<AddModelsProviderActionResult> {
  if (!modelIdMatchesProviderRequest(provider, modelId)) {
    const statusContext = await readProviderConnectionContext(provider);

    return buildActionResult({
      ok: false,
      action: "set-default",
      provider,
      message: `${getModelProviderDescriptor(provider).shortLabel} cannot set ${modelId} as its default model.`,
      connection: statusContext.connection,
      models: [],
      docsUrl: addModelsDocsUrl
    });
  }

  let repairedGatewayAuth = false;
  let savedDefault: Awaited<ReturnType<typeof setOpenClawDefaultModel>>;

  try {
    const result = await runWithGatewayAuthSetupRecovery(
      () => setOpenClawDefaultModel(modelId, { provider }),
      {
        operationLabel: "setting the default model"
      }
    );
    repairedGatewayAuth = Boolean(result.repaired);
    savedDefault = result.value;
  } catch (error) {
    const statusContext = await readProviderConnectionContext(provider);
    const providerModels = await readProviderCatalog(provider, statusContext.configuredModelIds)
      .catch(() => []);

    return buildActionResult({
      ok: false,
      action: "set-default",
      provider,
      message: readProviderActionError(error),
      connection: statusContext.connection,
      models: providerModels,
      manualCommand: isGatewayAuthSetupRecoveryError(error)
        ? formatOpenClawCommand(commandBin, ["gateway", "status", "--json"])
        : null,
      docsUrl: addModelsDocsUrl
    });
  }

  clearModelCatalogCache();
  const refreshedSnapshot = await getMissionControlSnapshot({ force: true });
  const statusContext = await readProviderConnectionContext(provider);
  const providerModels = await readProviderCatalog(provider, statusContext.configuredModelIds);

  return buildActionResult({
    ok: true,
    action: "set-default",
    provider,
    message: repairedGatewayAuth
      ? `Gateway auth was repaired and ${savedDefault.modelId} was saved as the default model.`
      : `${savedDefault.modelId} was saved as the default model.`,
    snapshot: refreshedSnapshot,
    connection: statusContext.connection,
    models: providerModels,
    docsUrl: addModelsDocsUrl,
    defaultModel: {
      id: savedDefault.modelId,
      provider: savedDefault.provider ?? provider,
      via: savedDefault.via
    }
  });
}

async function removeProviderModel(
  provider: AddModelsProviderId,
  modelId: string
): Promise<AddModelsProviderActionResult> {
  const statusContext = await readProviderConnectionContext(provider);
  let removeResult: Awaited<ReturnType<typeof removeModelSafely>>;

  try {
    const recoveryResult = await runWithGatewayAuthSetupRecovery(
      () => removeModelSafely(provider, modelId),
      {
        operationLabel: "removing the model"
      }
    );
    removeResult = recoveryResult.value;
  } catch (error) {
    const providerModels = await readProviderCatalog(provider, statusContext.configuredModelIds)
      .catch(() => []);

    return buildActionResult({
      ok: false,
      action: "remove-model",
      provider,
      message: readProviderActionError(error),
      connection: statusContext.connection,
      models: providerModels,
      modelRemoveImpact: await inspectModelRemoval(provider, modelId).catch(() => undefined),
      docsUrl: addModelsDocsUrl
    });
  }

  clearModelProviderCaches();
  const refreshedSnapshot = await getMissionControlSnapshot({ force: true }).catch(() => undefined);
  const refreshedStatus = await readProviderConnectionContext(provider);
  const providerModels = await readProviderCatalog(provider, refreshedStatus.configuredModelIds);

  return buildActionResult({
    ok: true,
    action: "remove-model",
    provider,
    message: buildModelRemoveCompletedMessage(removeResult.impact),
    snapshot: refreshedSnapshot ?? removeResult.snapshot,
    connection: refreshedStatus.connection,
    models: providerModels,
    modelRemoveImpact: removeResult.impact,
    docsUrl: addModelsDocsUrl
  });
}

async function discoverProviderModels(
  provider: AddModelsProviderId
): Promise<AddModelsProviderActionResult> {
  if (provider === "ollama") {
    await ensureOpenClawOllamaLocalCredential();
  }

  const { connection, ollamaState, configuredModelIds } = await readProviderConnectionContext(provider);
  const isCustomOpenAiEndpoint = provider === "openai" && isCustomOpenAiEndpointConnection(connection);
  let models: AddModelsCatalogModel[];
  try {
    models = await readProviderCatalog(provider, configuredModelIds, {
      preferScan: isCustomOpenAiEndpoint
    });
    if (isCustomOpenAiEndpoint) {
      models = models.filter((model) => !model.alreadyAdded);
    }
  } catch (error) {
    if (error instanceof ProviderAuthActionError) {
      return buildActionResult({
        ok: false,
        action: "discover",
        provider,
        message: error.message,
        connection: {
          ...connection,
          connected: false,
          detail: "Reconnect ChatGPT to refresh the OpenAI OAuth session."
        },
        models: [],
        emptyState: {
          kind: "no-models",
          title: "Reconnect ChatGPT",
          description: error.message
        },
        manualCommand: error.manualCommand,
        docsUrl: addModelsDocsUrl
      });
    }

    throw error;
  }
  return buildActionResult({
    ok: true,
    action: "discover",
    provider,
    message: models.length
      ? `Found ${models.length} model${models.length === 1 ? "" : "s"}.`
      : "No models were returned for this provider.",
    connection,
    models,
    emptyState:
      models.length === 0
        ? provider === "ollama"
          ? resolveOllamaEmptyState(ollamaState)
          : {
              kind: "no-models",
              title: "No models found",
              description: "This provider connected, but no selectable models were returned yet."
            }
        : null,
    docsUrl: addModelsDocsUrl
  });
}

async function readProviderCatalog(
  provider: AddModelsProviderId,
  configuredModelIds: Set<string>,
  options: { preferScan?: boolean; refresh?: boolean } = {}
): Promise<AddModelsCatalogModel[]> {
  if (options.preferScan) {
    const scanPayload = await scanProviderModels(provider);
    const scanModels = normalizeScanModels(provider, scanPayload, configuredModelIds);

    if (scanModels.length > 0) {
      return scanModels;
    }
  }

  const providerPayload = await readProviderModelPayload(provider, {
    all: true,
    provider,
    ...(options.refresh ? { refresh: true } : {})
  });
  const providerModels = normalizeCatalogModels(provider, providerPayload.models, configuredModelIds);

  if (providerModels.length > 0) {
    return provider === "ollama"
      ? mergeOllamaCatalogModels(providerModels, await readLocalOllamaCatalog(configuredModelIds))
      : providerModels;
  }

  const globalPayload = await readProviderModelPayload(provider, {
    all: true,
    ...(options.refresh ? { refresh: true } : {})
  });
  const globalModels = normalizeCatalogModels(provider, globalPayload.models, configuredModelIds);

  if (globalModels.length > 0) {
    return provider === "ollama"
      ? mergeOllamaCatalogModels(globalModels, await readLocalOllamaCatalog(configuredModelIds))
      : globalModels;
  }

  if (provider === "ollama") {
    return readLocalOllamaCatalog(configuredModelIds);
  }

  const scanPayload = await scanProviderModels(provider);

  return normalizeScanModels(provider, scanPayload, configuredModelIds);
}

async function readExplicitProviderCatalog(
  provider: AddModelsProviderId,
  configuredModelIds: Set<string>
): Promise<AddModelsCatalogModel[]> {
  const providerConfig = await readOpenClawExplicitProviderConfig(provider);
  const configuredModels = normalizeExplicitProviderCatalogModels(provider, providerConfig, configuredModelIds);

  if (configuredModels.length > 0) {
    return configuredModels;
  }

  const baseUrl = readProviderBaseUrl(providerConfig);
  const apiKey = readProviderApiKey(providerConfig);

  if (!baseUrl || !apiKey) {
    return [];
  }

  const discoveredModels = await discoverOpenAiCompatibleEndpointModels(baseUrl, apiKey).catch(() => []);

  if (discoveredModels.length === 0) {
    return [];
  }

  await persistOpenClawExplicitProviderConfig(provider, {
    providerName: readProviderName(providerConfig) ?? formatModelProviderLabel(provider),
    baseUrl,
    apiKey,
    api: "openai-completions",
    models: discoveredModels
  });
  clearModelProviderCaches();

  const refreshedProviderConfig = await readOpenClawExplicitProviderConfig(provider);
  return normalizeExplicitProviderCatalogModels(provider, refreshedProviderConfig, configuredModelIds);
}

function normalizeExplicitProviderCatalogModels(
  provider: AddModelsProviderId,
  providerConfig: OpenClawProviderModelsEntry | null,
  configuredModelIds: Set<string>
): AddModelsCatalogModel[] {
  return (providerConfig?.models ?? [])
    .filter((model) => typeof model.id === "string" && model.id.trim())
    .map((model) => {
      const scopedId = `${provider}/${model.id?.trim()}`;
      const input = normalizeExplicitProviderInput(model.input);

      return {
        id: scopedId,
        name: model.name?.trim() || model.id?.trim() || scopedId,
        provider,
        input,
        contextWindow: typeof model.contextWindow === "number" ? model.contextWindow : null,
        local: false,
        available: true,
        missing: false,
        alreadyAdded: configuredModelIds.has(scopedId),
        recommended: false,
        supportsTools: input.includes("text"),
        isFree: false,
        tags: ["explicit-provider"]
      };
    });
}

async function discoverOpenAiCompatibleEndpointModels(baseUrl: string, apiKey: string) {
  const modelsUrl = `${normalizeOpenAiCompatibleProviderBaseUrl(baseUrl)}/models`;
  const response = await fetch(modelsUrl, {
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    cache: "no-store",
    signal: AbortSignal.timeout(explicitProviderDiscoveryTimeoutMs)
  });

  if (!response.ok) {
    throw new Error(`Model discovery failed with HTTP ${response.status}.`);
  }

  const payload = await response.json().catch(() => null) as
    | {
        data?: Array<Record<string, unknown>>;
      }
    | null;

  if (!Array.isArray(payload?.data)) {
    return [];
  }

  return payload.data
    .map((entry) => {
      const id = typeof entry.id === "string" ? entry.id.trim() : "";

      return id ? toExplicitProviderModelEntry(id) : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

function normalizeOpenAiCompatibleProviderBaseUrl(endpoint: string) {
  const rawEndpoint = endpoint.trim();

  if (!rawEndpoint) {
    throw new Error("Enter a base URL to continue.");
  }

  let url: URL;
  try {
    url = new URL(rawEndpoint);
  } catch {
    throw new Error("Enter a valid http or https base URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Provider endpoint must use http or https.");
  }

  url.hash = "";
  url.search = "";
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

function toExplicitProviderModelEntry(modelId: string): OpenClawProviderModelEntry {
  return {
    id: modelId.trim(),
    name: modelId.trim()
  };
}

function normalizeExplicitProviderInput(input: OpenClawProviderModelEntry["input"]) {
  if (Array.isArray(input)) {
    const normalizedInput = input.map((entry) => entry.trim()).filter(Boolean).join(",");

    return normalizedInput || "text";
  }

  return typeof input === "string" && input.trim() ? input.trim() : "text";
}

function readProviderBaseUrl(providerConfig: OpenClawProviderModelsEntry | null) {
  const rawBaseUrl = providerConfig?.baseUrl ?? providerConfig?.baseURL;

  if (typeof rawBaseUrl !== "string" || !rawBaseUrl.trim()) {
    return null;
  }

  try {
    return normalizeOpenAiCompatibleProviderBaseUrl(rawBaseUrl);
  } catch {
    return rawBaseUrl.trim().replace(/\/+$/, "");
  }
}

function readProviderApiKey(providerConfig: OpenClawProviderModelsEntry | null) {
  const rawApiKey = providerConfig?.apiKey;

  return typeof rawApiKey === "string" && rawApiKey.trim() ? rawApiKey.trim() : null;
}

function readProviderName(providerConfig: OpenClawProviderModelsEntry | null) {
  const rawName = providerConfig?.label ?? providerConfig?.name;

  return typeof rawName === "string" && rawName.trim() ? rawName.trim() : null;
}

async function readProviderModelPayload(
  provider: AddModelsProviderId,
  input: Parameters<typeof listOpenClawModels>[0]
) {
  try {
    return await listOpenClawModels(input, {
      timeoutMs: provider === "openai" ? openAiDiscoveryTimeoutMs : undefined
    });
  } catch (error) {
    throw normalizeProviderCatalogError(provider, error);
  }
}

async function scanProviderModels(provider: AddModelsProviderId) {
  try {
    return await scanOpenClawModels({
      yes: true,
      noInput: true,
      noProbe: true,
      timeoutMs: provider === "openai" ? openAiDiscoveryTimeoutMs : undefined
    });
  } catch (error) {
    throw normalizeProviderCatalogError(provider, error);
  }
}

function normalizeProviderCatalogError(provider: AddModelsProviderId, error: unknown) {
  const message = stringifyProviderError(error);

  if (
    provider === "openai" &&
    isOpenAiProviderPluginMissing(message)
  ) {
    return new ProviderAuthActionError(
      "OpenClaw needs the @openclaw/codex plugin before ChatGPT authorization can continue. Use Connect ChatGPT in AgentOS to install it and start authorization."
    );
  }

  if (
    provider === "openai" &&
    isOpenAiAuthRefreshFailure(message)
  ) {
    return new ProviderAuthActionError(
      "Your ChatGPT session needs authorization. Use Connect ChatGPT in AgentOS to reopen OpenClaw's sign-in page."
    );
  }

  return error;
}

function stringifyProviderError(error: unknown) {
  if (error instanceof Error) {
    return redactSecretText(error.message);
  }

  if (error && typeof error === "object") {
    const stdout = "stdout" in error && typeof error.stdout === "string" ? error.stdout : "";
    const stderr = "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
    const message = "message" in error && typeof error.message === "string" ? error.message : "";
    return redactSecretText([message, stdout, stderr].filter(Boolean).join("\n"));
  }

  return redactSecretText(String(error || ""));
}

function normalizeCatalogModels(
  provider: AddModelsProviderId,
  models: OpenClawModelsListPayload["models"],
  configuredModelIds: Set<string>
) {
  const uniqueModels = new Map<string, typeof models[number]>();
  for (const model of models || []) {
    const modelKey = normalizeModelIdForProvider(provider, model.key);

    if (!modelMatchesProvider(provider, modelKey)) {
      continue;
    }

    if (!uniqueModels.has(modelKey)) {
      uniqueModels.set(modelKey, {
        ...model,
        key: modelKey
      });
    }
  }

  return Array.from(uniqueModels.values()).map((model) => ({
    id: model.key,
    name: model.name,
    provider,
    input: model.input,
    contextWindow: model.contextWindow ?? null,
    local: Boolean(model.local),
    available: model.available !== false,
    missing: Boolean(model.missing),
    alreadyAdded: configuredModelIds.has(model.key),
    recommended: isRecommendedModel(provider, model.key),
    supportsTools: model.input.includes("text"),
    isFree: /:free$/i.test(model.key) || /\(free\)/i.test(model.name),
    tags: Array.isArray(model.tags) ? model.tags : []
  }));
}

function normalizeScanModels(
  provider: AddModelsProviderId,
  models: OpenClawModelScanPayload,
  configuredModelIds: Set<string>
): AddModelsCatalogModel[] {
  const uniqueModels = new Map<string, OpenClawModelScanPayload[number]>();

  for (const candidate of models || []) {
    const modelId = normalizeModelIdForProvider(provider, resolveDiscoveredModelId(candidate));
    if (!modelId) {
      continue;
    }

    if (
      !modelMatchesProvider(provider, modelId) ||
      uniqueModels.has(modelId)
    ) {
      continue;
    }

    uniqueModels.set(modelId, candidate);
  }

  return Array.from(uniqueModels.values()).map((candidate) => {
    const modelId = normalizeModelIdForProvider(provider, resolveDiscoveredModelId(candidate));

    return {
      id: modelId,
      name: candidate.name.trim(),
      provider,
      input: candidate.supportsToolsMeta ? "text+tools" : "text",
      contextWindow: candidate.contextLength ?? null,
      local: false,
      available: true,
      missing: false,
      alreadyAdded: configuredModelIds.has(modelId),
      recommended: isRecommendedModel(provider, modelId),
      supportsTools: candidate.supportsToolsMeta === true,
      isFree: candidate.isFree === true,
      tags: []
    };
  });
}

function resolveDiscoveredModelId(candidate: OpenClawModelScanPayload[number]) {
  const modelRef = candidate.modelRef?.trim();

  if (modelRef) {
    return modelRef;
  }

  const provider = candidate.provider.trim();
  const id = candidate.id.trim();

  if (!provider || !id) {
    return "";
  }

  return `${provider}/${id}`;
}

function buildActionResult({
  ok,
  action,
  provider,
  message,
  snapshot,
  connection,
  models,
  discovery,
  emptyState = null,
  manualCommand = null,
  docsUrl = null,
  defaultModel,
  disconnectImpact,
  modelRemoveImpact,
  providerConfig
}: {
  ok: boolean;
  action: AddModelsProviderActionResult["action"];
  provider: AddModelsProviderId;
  message: string;
  snapshot?: MissionControlSnapshot;
  connection: AddModelsProviderConnectionStatus;
  models: AddModelsCatalogModel[];
  discovery?: AddModelsProviderActionResult["discovery"];
  emptyState?: AddModelsEmptyState | null;
  manualCommand?: string | null;
  docsUrl?: string | null;
  defaultModel?: AddModelsProviderActionResult["defaultModel"];
  disconnectImpact?: AddModelsProviderActionResult["disconnectImpact"];
  modelRemoveImpact?: AddModelsProviderActionResult["modelRemoveImpact"];
  providerConfig?: AddModelsProviderActionResult["providerConfig"];
}): AddModelsProviderActionResult {
  return {
    ok,
    action,
    provider,
    message,
    connection,
    models,
    discovery,
    emptyState,
    manualCommand,
    docsUrl,
    defaultModel,
    disconnectImpact,
    modelRemoveImpact,
    providerConfig,
    snapshot
  };
}

function buildModelRemoveImpactMessage(
  impact: NonNullable<AddModelsProviderActionResult["modelRemoveImpact"]>
) {
  const replacement = impact.replacementModelId ? ` Replacement: ${impact.replacementModelId}.` : "";
  return `Removing ${impact.modelId} will reassign ${impact.affectedAgents.length} agent${impact.affectedAgents.length === 1 ? "" : "s"} and update the OpenClaw global default: ${impact.defaultModelAffected ? "yes" : "no"}.${replacement}`;
}

function buildModelRemoveCompletedMessage(
  impact: NonNullable<AddModelsProviderActionResult["modelRemoveImpact"]>
) {
  const reassignment = impact.affectedAgents.length > 0
    ? ` Reassigned ${impact.affectedAgents.length} agent${impact.affectedAgents.length === 1 ? "" : "s"} to ${impact.replacementModelId}.`
    : "";
  const defaultUpdate = impact.defaultModelAffected && impact.replacementModelId
    ? ` OpenClaw global default is now ${impact.replacementModelId}.`
    : "";
  return `Removed ${impact.modelId} from OpenClaw config.${reassignment}${defaultUpdate}`;
}

function buildDisconnectImpactMessage(
  provider: AddModelsProviderId,
  impact: NonNullable<AddModelsProviderActionResult["disconnectImpact"]>
) {
  const label = getModelProviderDescriptor(provider).shortLabel;
  return `${label} disconnect will remove ${impact.providerModelIds.length} configured model${impact.providerModelIds.length === 1 ? "" : "s"}, reassign ${impact.affectedAgents.length} agent${impact.affectedAgents.length === 1 ? "" : "s"}, and use ${impact.replacementModelId ?? "no replacement model"}.`;
}

function buildDisconnectCompletedMessage(
  provider: AddModelsProviderId,
  impact: NonNullable<AddModelsProviderActionResult["disconnectImpact"]>
) {
  const label = getModelProviderDescriptor(provider).shortLabel;
  return `${label} was disconnected. Removed ${impact.providerModelIds.length} configured model${impact.providerModelIds.length === 1 ? "" : "s"} and reassigned ${impact.affectedAgents.length} agent${impact.affectedAgents.length === 1 ? "" : "s"}.`;
}

function buildDisconnectedProviderDetail(
  credentialCleanup: NonNullable<AddModelsProviderActionResult["disconnectImpact"]>["credentialCleanup"]
) {
  if (credentialCleanup === "retained-unsupported") {
    return "Provider models and assignments were removed. OpenClaw does not expose credential deletion yet; reconnecting replaces the retained default credential.";
  }

  return "Provider models, assignments, and configuration were removed.";
}

function readProviderActionError(error: unknown) {
  if (isGatewayAuthSetupRecoveryError(error)) {
    return error.message;
  }

  return redactErrorMessage(error, "Model provider action failed.");
}

function buildUnknownProviderConnectionStatus(
  provider: AddModelsProviderId,
  error: unknown
): AddModelsProviderConnectionStatus {
  const descriptor = getModelProviderDescriptor(provider);

  return {
    provider,
    authMethod: null,
    availableAuthMethods: descriptor.authMethods ? [...descriptor.authMethods] : undefined,
    connected: false,
    verification: "unknown",
    canConnect: true,
    needsTerminal: false,
    detail: readProviderActionError(error),
    source: "unknown",
    degraded: true,
    stale: false,
    recovery: "Retry after the local OpenClaw Gateway is available."
  };
}

function clearModelProviderCaches() {
  clearMissionControlCaches();
  clearModelCatalogCache();
}

async function readProviderConnectionContext(
  provider: AddModelsProviderId,
  options: { refreshAuth?: boolean } = {}
) {
  const [configuredModelIds, modelStatus] = await Promise.all([
    readOpenClawConfiguredModelIds(),
    readOpenClawProviderModelStatus({ refreshAuth: options.refreshAuth === true })
  ]);

  if (provider === "ollama") {
    const ollamaState = await readOllamaState();

    return {
      connection: buildOllamaConnectionStatus(ollamaState),
      configuredModelIds,
      ollamaState
    };
  }

  if (!isBuiltInAddModelsProviderId(provider)) {
    return {
      connection: await buildExplicitProviderConnectionStatus(provider, configuredModelIds),
      configuredModelIds,
      ollamaState: null
    };
  }

  const fileBasedStatus = await buildOpenClawFileBasedProviderConnectionStatus(provider, configuredModelIds);

  return {
    connection: await applyProviderRuntimeFailure(
      provider,
      await resolveProviderConnectionStatus(provider, modelStatus, configuredModelIds, fileBasedStatus)
    ),
    configuredModelIds,
    ollamaState: null
  };
}

async function buildExplicitProviderConnectionStatus(
  provider: AddModelsProviderId,
  configuredModelIds: Set<string>
): Promise<AddModelsProviderConnectionStatus> {
  const providerConfig = await readOpenClawExplicitProviderConfig(provider);
  const baseUrl = readProviderBaseUrl(providerConfig);
  const apiKey = readProviderApiKey(providerConfig);
  const modelCount = providerConfig?.models?.length ?? 0;
  const configuredCount = [...configuredModelIds].filter((modelId) => modelMatchesProvider(provider, modelId)).length;

  return {
    provider,
    connected: Boolean(baseUrl && apiKey && (modelCount > 0 || configuredCount > 0)),
    canConnect: true,
    needsTerminal: false,
    source: "openclaw-config",
    degraded: Boolean(baseUrl && apiKey && modelCount === 0 && configuredCount === 0),
    stale: false,
    recovery: baseUrl && apiKey && modelCount === 0 && configuredCount === 0
      ? "Discovery returned no persisted models. Add a model ID manually or retry discovery."
      : null,
    detail: baseUrl
      ? `${configuredCount} configured model${configuredCount === 1 ? "" : "s"} in AgentOS. Endpoint: ${baseUrl}.`
      : "Configure this explicit OpenAI-compatible provider before discovery."
  };
}

async function resolveProviderConnectionStatus(
  provider: AddModelsProviderId,
  modelStatus: ModelsStatusPayload | null,
  configuredModelIds: Set<string>,
  fileBasedStatus: AddModelsProviderConnectionStatus
) {
  const openAiGatewayConfig = provider === "openai"
    ? await readOpenClawOpenAiProviderConfig()
    : null;
  const modelStatusConnection = buildModelStatusConnectionStatus(provider, modelStatus, configuredModelIds);
  const customOpenAiConnection = provider === "openai"
    ? buildCustomOpenAiEndpointConnectionStatus(openAiGatewayConfig, configuredModelIds)
    : null;

  if (modelStatusConnection?.connected) {
    return modelStatusConnection;
  }

  if (customOpenAiConnection?.connected) {
    return customOpenAiConnection;
  }

  const credentialConfigured = await readOpenClawProviderCredentialConfigured(provider);

  if (credentialConfigured) {
    const authMethods = getModelProviderDescriptor(provider).authMethods;

    return {
      provider,
      connected: true,
      verification: "credential-stored" as const,
      canConnect: true,
      needsTerminal: false,
      source: "openclaw-config" as const,
      authMethod: "api-key" as const,
      availableAuthMethods: authMethods ? [...authMethods] : undefined,
      degraded: false,
      stale: false,
      recovery: null,
      detail: "Credential stored in OpenClaw Gateway configuration."
    };
  }

  return modelStatusConnection ?? customOpenAiConnection ?? fileBasedStatus;
}

async function applyProviderRuntimeFailure(
  provider: AddModelsProviderId,
  connection: AddModelsProviderConnectionStatus
) {
  if (provider !== "openai") {
    return connection;
  }

  if (connection.connected) {
    if (await clearOpenAiAuthRuntimeSmokeFailures()) {
      clearModelProviderCaches();
    }

    return connection;
  }

  const settings = await readMissionControlSettings().catch(() => ({}));
  const authFailure = getLatestOpenAiAuthRuntimeSmokeFailure(settings);

  if (!authFailure) {
    return connection;
  }

  return {
    ...connection,
    connected: false,
    degraded: true,
    stale: false,
    recovery: "Reconnect ChatGPT to refresh the OpenAI OAuth session.",
    detail:
      authFailure.error ||
      "Reconnect ChatGPT to refresh the OpenAI OAuth session."
  };
}

function buildOllamaConnectionStatus(ollamaState: OllamaState): AddModelsProviderConnectionStatus {
  return {
    provider: "ollama",
    connected: Boolean(ollamaState.installed && ollamaState.models.length > 0),
    canConnect: true,
    needsTerminal: false,
    source: "local-runtime",
    degraded: true,
    stale: false,
    recovery: "AgentOS probed the local Ollama runtime because OpenClaw catalog data was unavailable or incomplete.",
    detail: !ollamaState.installed
      ? "Ollama is not installed on this machine."
      : ollamaState.models.length > 0
        ? `${ollamaState.models.length} local model${ollamaState.models.length === 1 ? "" : "s"} detected.`
        : "Ollama is installed, but no local models were found yet."
  };
}

function isCustomOpenAiEndpointConnection(connection: AddModelsProviderConnectionStatus | null) {
  return Boolean(connection?.provider === "openai" && connection.detail?.includes("Custom endpoint:"));
}

function buildCustomOpenAiEndpointConnectionStatus(
  providerConfig: OpenClawProviderModelsEntry | null,
  configuredModelIds: Set<string>
): AddModelsProviderConnectionStatus | null {
  const customEndpoint = readOpenAiBaseUrlFromProviderConfig(providerConfig);

  if (!customEndpoint) {
    return null;
  }

  const configuredCount = [...configuredModelIds].filter((modelId) => modelMatchesProvider("openai", modelId)).length;
  const hasApiKey = Boolean(readOpenAiApiKeyFromProviderConfig(providerConfig));
  const authMethods = getModelProviderDescriptor("openai").authMethods;

  return {
    provider: "openai",
    authMethod: hasApiKey ? "api-key" : null,
    availableAuthMethods: authMethods ? [...authMethods] : undefined,
    connected: hasApiKey,
    canConnect: true,
    needsTerminal: false,
    source: "openclaw-config",
    degraded: !hasApiKey,
    stale: false,
    recovery: hasApiKey ? null : "Reconnect OpenAI with an API key before using this custom endpoint.",
    detail: hasApiKey
      ? `${configuredCount} configured model${configuredCount === 1 ? "" : "s"} in AgentOS. Custom endpoint: ${customEndpoint}.`
      : `Custom endpoint: ${customEndpoint}. Connect OpenAI to use it.`
  };
}

function readOpenAiBaseUrlFromProviderConfig(providerConfig: OpenClawProviderModelsEntry | null) {
  const rawBaseUrl = providerConfig?.baseUrl ?? providerConfig?.baseURL;
  const trimmed = typeof rawBaseUrl === "string" ? rawBaseUrl.trim() : "";

  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    return `${url.origin}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return trimmed;
  }
}

function readOpenAiApiKeyFromProviderConfig(providerConfig: OpenClawProviderModelsEntry | null) {
  const rawApiKey = providerConfig?.apiKey;

  return typeof rawApiKey === "string" && rawApiKey.trim() ? rawApiKey.trim() : null;
}

function resolveProviderStatusMessage(
  provider: AddModelsProviderId,
  connection: AddModelsProviderConnectionStatus
) {
  if (provider === "ollama" && !connection.connected) {
    return connection.detail || "Ollama is not available on this machine yet.";
  }

  if (connection.connected) {
    return connection.detail || `${getModelProviderDescriptor(provider).shortLabel} is ready to use.`;
  }

  return `Connect ${getModelProviderDescriptor(provider).shortLabel} to start discovering models.`;
}

function resolveOllamaEmptyState(ollamaState: OllamaState | null): AddModelsEmptyState | null {
  if (!ollamaState) {
    return null;
  }

  if (!ollamaState.installed) {
    return {
      kind: "ollama-missing",
      title: "Ollama not found",
      description: "Install Ollama locally, then return here and retry discovery.",
      commands: ["brew install ollama", "ollama serve"]
    };
  }

  if (ollamaState.models.length === 0) {
    return {
      kind: "ollama-empty",
      title: "No local models yet",
      description: "Ollama is running, but there are no pulled models on this machine yet.",
      commands: ["ollama pull qwen3.5:9b", "ollama pull llama3:8b", "ollama list"]
    };
  }

  return null;
}

async function readOllamaState(): Promise<OllamaState> {
  try {
    const models = await readProviderCatalog("ollama", new Set());

    return {
      installed: true,
      models: models
        .map((model) => (model.id.startsWith("ollama/") ? model.id.slice("ollama/".length) : model.id))
        .filter((modelName) => modelName.length > 0)
    };
  } catch (error) {
    const message = error instanceof Error ? redactSecretText(error.message) : "";

    if (/ollama/i.test(message) && (/spawn/i.test(message) || /not found/i.test(message) || /enoent/i.test(message))) {
      return {
        installed: false,
        models: []
      };
    }

    return {
      installed: true,
      models: []
    };
  }
}

async function readLocalOllamaCatalog(configuredModelIds: Set<string>): Promise<AddModelsCatalogModel[]> {
  const local = await readLocalOllamaModels();

  if (!local.installed) {
    return [];
  }

  return local.models.map((modelName) => {
    const modelId = `ollama/${modelName}`;

    return {
      id: modelId,
      name: modelName,
      provider: "ollama",
      input: "text",
      contextWindow: null,
      local: true,
      available: true,
      missing: false,
      alreadyAdded: configuredModelIds.has(modelId),
      recommended: isRecommendedModel("ollama", modelId),
      supportsTools: true,
      isFree: false,
      tags: ["local-ollama"]
    };
  });
}

function normalizeModelIdForProvider(provider: AddModelsProviderId, modelId: string) {
  return provider === "openai" ? normalizeOpenAiModelId(modelId) : modelId;
}

function validateApiKey(provider: AddModelsProviderId, token: string) {
  const expectedPattern = providerTokenRules[provider];

  if (token.length < 8) {
    throw new Error("That API key looks too short.");
  }

  if (expectedPattern && !expectedPattern.test(token)) {
    if (provider === "openrouter") {
      throw new Error("OpenRouter keys usually start with sk-or-.");
    }

    if (provider === "openai") {
      throw new Error("OpenAI API keys usually start with sk-.");
    }

    if (provider === "anthropic") {
      throw new Error("Anthropic keys usually start with sk-ant-.");
    }
  }
}

function resolveProviderFromModelId(modelId: string) {
  return modelId.split("/")[0] ?? "";
}

function modelMatchesProvider(provider: AddModelsProviderId, modelId: string) {
  const modelProvider = resolveProviderFromModelId(modelId);

  return modelProvider === provider && isAddModelsProviderId(modelProvider);
}

function modelIdMatchesProviderRequest(provider: AddModelsProviderId, modelId: string) {
  if (!modelId.includes("/")) {
    return true;
  }

  return modelMatchesProvider(provider, modelId);
}

function isRecommendedModel(provider: AddModelsProviderId, modelId: string) {
  const normalized = modelId.toLowerCase();

  if (provider === "openrouter") {
    return /gpt-5|claude-sonnet|gemini-2\.5|gemini-3|qwen3-coder|codestral|openrouter\/auto/.test(normalized);
  }

  if (provider === "ollama") {
    return /qwen|llama3/.test(normalized);
  }

  if (provider === "anthropic") {
    return /claude-sonnet|claude-opus/.test(normalized);
  }

  if (provider === "openai") {
    return /gpt-5|o3|o4/.test(normalized);
  }

  if (provider === "xai") {
    return /grok-4|grok-code/.test(normalized);
  }

  if (provider === "google") {
    return /gemini-2\.|gemini-3/.test(normalized);
  }

  if (provider === "deepseek") {
    return /deepseek-(chat|reasoner|coder|r1|v3)/.test(normalized);
  }

  if (provider === "mistral") {
    return /mistral-(large|small|medium|tiny)|codestral|pixtral|ministral/.test(normalized);
  }

  return false;
}

function readProviderCredentialVerificationError(provider: AddModelsProviderId, error: unknown) {
  const message = redactErrorMessage(error, "Provider verification failed.");
  const label = getModelProviderDescriptor(provider).shortLabel;

  if (/\b(?:401|403|unauthori[sz]ed|forbidden|invalid (?:api )?key)\b/i.test(message)) {
    return `The API key was rejected by ${label}.`;
  }

  if (/timeout|unreachable|ECONN|network|fetch failed/i.test(message)) {
    return "The credential was saved, but OpenClaw could not reach the provider.";
  }

  return "OpenClaw did not accept this provider configuration. Review the Gateway logs.";
}
