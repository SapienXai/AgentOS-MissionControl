import "server-only";

import { CliOpenClawGatewayClient } from "@/lib/openclaw/client/cli-gateway-client";
import {
  OPENCLAW_GATEWAY_PROTOCOL_RANGE
} from "@/lib/openclaw/client/gateway-client";
import { createOpenClawGatewayClient } from "@/lib/openclaw/client/gateway-client-factory";
import { getOpenClawGatewayClient } from "@/lib/openclaw/client/gateway-client-factory";
import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { getOpenClawCapabilityMatrix } from "@/lib/openclaw/application/capability-matrix-service";
import { getGatewayNativeAuthStatus } from "@/lib/openclaw/application/settings-service";
import { resolveOpenClawBin, resolveOpenClawVersion } from "@/lib/openclaw/cli";
import type {
  ModelsPayload,
  ModelsStatusPayload
} from "@/lib/openclaw/client/gateway-client";
import { stringifyCommandFailure } from "@/lib/openclaw/command-failure";
import {
  compareVersionStrings,
  resolveModelReadiness
} from "@/lib/openclaw/domains/control-plane-normalization";
import {
  getLatestOpenClawCompatibilitySmokeTest,
  persistOpenClawCompatibilitySmokeTest,
  readMissionControlSettings
} from "@/lib/openclaw/domains/control-plane-settings";
import {
  OPENCLAW_RECOMMENDED_VERSION,
  OPENCLAW_SUPPORTED_BASELINE_VERSION
} from "@/lib/openclaw/versions";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";
import type {
  ModelReadiness,
  OpenClawCapabilityMatrix,
  OpenClawCompatibilitySmokeReport,
  OpenClawCompatibilityStatus,
  OpenClawSmokeTestCheck,
  OpenClawSmokeTestCheckStatus
} from "@/lib/openclaw/types";

export const AGENTOS_REQUIRED_NODE_VERSION = "24.16.0";
export const OPENCLAW_REQUIRED_NODE_VERSION = "24.16.0 or 26.1.0";
export const OPENCLAW_RECOMMENDED_NODE_VERSION = "24.20.0";
export const OPENCLAW_REQUIRED_GATEWAY_PROTOCOL_VERSION = "4";

const requiredNativeTimeoutMs = 5_000;
const optionalNativeTimeoutMs = 3_000;
const cliCheckTimeoutMs = 10_000;
const rawDetailsMaxLength = 12_000;

type CheckResult = {
  status: OpenClawSmokeTestCheckStatus;
  summary: string;
  recovery?: string | null;
  rawDetails?: unknown;
};

type CheckInput = {
  id: string;
  label: string;
  required: boolean;
  run: () => Promise<CheckResult> | CheckResult;
  recovery: string;
};

type SmokeContext = {
  openClawBin: string | null;
  installedVersion: string | null;
  recommendedOpenClawVersion: string | null;
  gatewayProtocolVersion: string | null;
  nodeVersion: string | null;
  nodeStatus: OpenClawCompatibilitySmokeReport["compatibility"]["nodeStatus"];
  gatewayAuthStatus: string;
  nativeGatewayStatus: string;
  modelReadiness: ModelReadiness | null;
  lastFallbackReason: string | null;
};

export async function getLatestOpenClawCompatibilitySmokeReport() {
  const settings = await readMissionControlSettings();
  return getLatestOpenClawCompatibilitySmokeTest(settings);
}

export async function runOpenClawCompatibilitySmokeTest(): Promise<OpenClawCompatibilitySmokeReport> {
  const checkedAt = new Date().toISOString();
  const startedAt = Date.now();
  const adapter = getOpenClawAdapter();
  const context: SmokeContext = {
    openClawBin: null,
    installedVersion: null,
    recommendedOpenClawVersion: OPENCLAW_RECOMMENDED_VERSION,
    gatewayProtocolVersion: null,
    nodeVersion: process.versions.node || null,
    nodeStatus: classifyOpenClawNodeVersion(process.versions.node).status,
    gatewayAuthStatus: "Unknown",
    nativeGatewayStatus: "Unknown",
    modelReadiness: null,
    lastFallbackReason: null
  };
  let binaryAvailable = false;
  let capabilityMatrix: OpenClawCapabilityMatrix | null = null;
  let modelsPayload: ModelsPayload | null = null;
  let modelStatusPayload: ModelsStatusPayload | null = null;
  const checks: OpenClawSmokeTestCheck[] = [];

  const addCheck = async (input: CheckInput) => {
    const check = await runSmokeCheck(input);
    checks.push(check);
    return check;
  };

  await addCheck({
    id: "openclaw-binary",
    label: "OpenClaw binary",
    required: true,
    recovery: "Install OpenClaw or update the OpenClaw binary selection in Settings.",
    run: async () => {
      const openClawBin = await resolveOpenClawBin();
      context.openClawBin = openClawBin;
      binaryAvailable = true;

      return {
        status: "pass",
        summary: `Resolved ${openClawBin}.`,
        recovery: null,
        rawDetails: { openClawBin }
      };
    }
  });

  await addCheck({
    id: "openclaw-version",
    label: "OpenClaw version",
    required: true,
    recovery: "Run `openclaw update` or reinstall OpenClaw, then rerun the smoke test.",
    run: async () => {
      if (!binaryAvailable) {
        throw new Error("OpenClaw binary is unavailable.");
      }

      const version = await resolveOpenClawVersion();
      context.installedVersion = version;

      if (!version) {
        return {
          status: "fail",
          summary: "AgentOS could not detect the installed OpenClaw version.",
          recovery: "Run `openclaw --version` locally, repair the OpenClaw install if it fails, then rerun the smoke test.",
          rawDetails: { detectedVersion: null }
        };
      }

      return {
        status: "pass",
        summary: `OpenClaw ${version} is installed.`,
        recovery: null,
        rawDetails: { detectedVersion: version }
      };
    }
  });

  await addCheck({
    id: "node-version",
    label: "Node.js version",
    required: true,
    recovery: `Install Node.js ${AGENTOS_REQUIRED_NODE_VERSION} or newer. Node ${OPENCLAW_RECOMMENDED_NODE_VERSION} is recommended for AgentOS and OpenClaw.`,
    run: () => {
      const result = classifyOpenClawNodeVersion(process.versions.node);
      context.nodeVersion = process.versions.node || null;
      context.nodeStatus = result.status;

      return {
        status: result.status === "supported" ? "pass" : "fail",
        summary: result.summary,
        recovery: result.status === "supported" ? null : result.recovery,
        rawDetails: {
          nodeVersion: process.versions.node,
          required: AGENTOS_REQUIRED_NODE_VERSION,
          openClawRequired: OPENCLAW_REQUIRED_NODE_VERSION,
          recommended: OPENCLAW_RECOMMENDED_NODE_VERSION
        }
      };
    }
  });

  await addCheck({
    id: "gateway-status",
    label: "Gateway status",
    required: true,
    recovery: "Start or repair the OpenClaw Gateway, then run `openclaw gateway status --json`.",
    run: async () => {
      if (!binaryAvailable) {
        throw new Error("OpenClaw binary is unavailable.");
      }

      const payload = await adapter.getGatewayStatus({ timeoutMs: cliCheckTimeoutMs });
      const rpcOk = payload.rpc?.ok === true;
      const loaded = payload.service?.loaded === true;

      if (rpcOk) {
        return {
          status: "pass",
          summary: "Gateway status reports RPC ready.",
          recovery: null,
          rawDetails: payload
        };
      }

      return {
        status: loaded ? "warning" : "fail",
        summary: loaded
          ? "Gateway service is loaded, but RPC is not ready."
          : "Gateway service is not loaded or did not report readiness.",
        recovery: "Run `openclaw gateway start`, then retry. Use `openclaw gateway status --json` for RPC proof.",
        rawDetails: payload
      };
    }
  });

  await addCheck({
    id: "gateway-auth",
    label: "Gateway auth",
    required: true,
    recovery: "Repair local Gateway access or save the Gateway token/password in Settings.",
    run: async () => {
      if (!binaryAvailable) {
        throw new Error("OpenClaw binary is unavailable.");
      }

      const authStatus = await getGatewayNativeAuthStatus();
      context.gatewayAuthStatus = authStatus.native.ok
        ? "Authenticated"
        : authStatus.native.kind
          ? `Not ready: ${authStatus.native.kind}`
          : "Not ready";

      return {
        status: authStatus.native.ok ? "pass" : "fail",
        summary: authStatus.native.ok
          ? "Native Gateway auth is ready."
          : authStatus.native.issue || "Native Gateway auth is not ready.",
        recovery: authStatus.native.ok ? null : authStatus.recommendation,
        rawDetails: authStatus
      };
    }
  });

  await addCheck({
    id: "native-gateway-connection",
    label: "Native Gateway connection",
    required: true,
    recovery: "Start the Gateway, fix auth, or update AgentOS/OpenClaw if the protocol range does not overlap.",
    run: async () => {
      if (!binaryAvailable) {
        throw new Error("OpenClaw binary is unavailable.");
      }

      const client = createOpenClawGatewayClient({ timeoutMs: optionalNativeTimeoutMs });
      try {
        const hello = await client.probeNativeHandshake({ timeoutMs: optionalNativeTimeoutMs });
        const protocol = typeof hello.protocol === "number" ? String(hello.protocol) : null;
        context.gatewayProtocolVersion = protocol;
        context.nativeGatewayStatus = "Connected";

        if (!protocol) {
          return {
            status: "warning",
            summary: "Native Gateway connected, but did not advertise a protocol version.",
            recovery: "Update OpenClaw if other Gateway checks fail.",
            rawDetails: hello
          };
        }

        const compatible = isGatewayProtocolCompatible(protocol);
        return {
          status: compatible ? "pass" : "fail",
          summary: compatible
            ? `Native Gateway connected with protocol v${protocol}.`
            : `Gateway protocol v${protocol} is outside AgentOS' supported range.`,
          recovery: compatible
            ? null
            : `Update OpenClaw or AgentOS so the Gateway protocol overlaps ${OPENCLAW_GATEWAY_PROTOCOL_RANGE.min}-${OPENCLAW_GATEWAY_PROTOCOL_RANGE.max}.`,
          rawDetails: hello
        };
      } catch (error) {
        context.nativeGatewayStatus = "Unavailable";
        throw error;
      } finally {
        client.close("compatibility smoke handshake finished");
      }
    }
  });

  await addCheck({
    id: "health-status-rpc",
    label: "Health/status RPC",
    required: true,
    recovery: "Repair Gateway auth or restart OpenClaw Gateway, then rerun the smoke test.",
    run: async () => {
      if (!binaryAvailable) {
        throw new Error("OpenClaw binary is unavailable.");
      }

      const client = createOpenClawGatewayClient({ timeoutMs: requiredNativeTimeoutMs });
      try {
        const [health, status] = await Promise.all([
          client.callNative<Record<string, unknown>>("health", {}, { timeoutMs: requiredNativeTimeoutMs }),
          client.callNative<Record<string, unknown>>("status", {}, { timeoutMs: requiredNativeTimeoutMs })
        ]);
        const healthOk = health.ok !== false;
        const runtimeVersion = readString(status.runtimeVersion) ?? readString(status.version);
        context.installedVersion = context.installedVersion ?? runtimeVersion;
        return {
          status: healthOk ? "pass" : "fail",
          summary: healthOk ? "Native health and status RPCs responded." : "Native health RPC reported not OK.",
          recovery: healthOk ? null : "Inspect `openclaw health` and restart the Gateway after resolving runtime errors.",
          rawDetails: { health, status }
        };
      } finally {
        client.close("compatibility smoke rpc finished");
      }
    }
  });

  await addCheck({
    id: "supported-rpc-methods",
    label: "Supported RPC methods",
    required: false,
    recovery: "Update OpenClaw if required AgentOS Gateway methods are missing.",
    run: async () => {
      if (!binaryAvailable) {
        return skippedOptional("OpenClaw binary is unavailable.");
      }

      capabilityMatrix = await getOpenClawCapabilityMatrix({ force: true });
      context.gatewayProtocolVersion =
        context.gatewayProtocolVersion ?? capabilityMatrix.gatewayProtocolVersion ?? null;
      context.installedVersion = context.installedVersion ?? capabilityMatrix.openClawVersion;

      const contract = capabilityMatrix.compatibility?.methodContract;
      const missingCount = contract?.missingMethodCount ?? capabilityMatrix.unsupportedGatewayMethods.length;
      const advertisedCount = capabilityMatrix.supportedMethods.length;

      if (advertisedCount === 0) {
        return {
          status: "warning",
          summary: "Gateway did not advertise method metadata.",
          recovery: "AgentOS will attempt Gateway calls and use compatibility fallback where safe.",
          rawDetails: capabilityMatrix
        };
      }

      return {
        status: missingCount === 0 ? "pass" : "warning",
        summary: missingCount === 0
          ? `Gateway advertises ${advertisedCount} RPC methods and all AgentOS candidates.`
          : `Gateway advertises ${advertisedCount} RPC methods; ${missingCount} AgentOS candidates are missing.`,
        recovery: missingCount === 0 ? null : contract?.reason ?? "Update OpenClaw if native operations degrade.",
        rawDetails: capabilityMatrix
      };
    }
  });

  await addCheck({
    id: "models-list",
    label: "Models list",
    required: true,
    recovery: "Configure at least one usable OpenClaw model, then refresh models in AgentOS.",
    run: async () => {
      if (!binaryAvailable) {
        throw new Error("OpenClaw binary is unavailable.");
      }

      modelsPayload = await adapter.listModels({}, { timeoutMs: cliCheckTimeoutMs });
      const readyCount = modelsPayload.models.filter((model) => model.available !== false && !model.missing).length;

      return {
        status: modelsPayload.models.length > 0 ? "pass" : "warning",
        summary: `${modelsPayload.models.length} configured model${modelsPayload.models.length === 1 ? "" : "s"} returned; ${readyCount} appear usable.`,
        recovery: modelsPayload.models.length > 0 ? null : "Run OpenClaw model onboarding or add a provider/model.",
        rawDetails: modelsPayload
      };
    }
  });

  await addCheck({
    id: "model-readiness",
    label: "Model readiness",
    required: true,
    recovery: "Choose a default model and complete provider auth before dispatching missions.",
    run: async () => {
      if (!binaryAvailable) {
        throw new Error("OpenClaw binary is unavailable.");
      }

      const models = modelsPayload ?? await adapter.listModels({}, { timeoutMs: cliCheckTimeoutMs });
      modelStatusPayload = await adapter.getModelStatus({ timeoutMs: cliCheckTimeoutMs }).catch(() => null);
      const readiness = resolveModelReadiness(models.models, modelStatusPayload ?? undefined);
      context.modelReadiness = readiness;

      return {
        status: readiness.ready ? "pass" : "fail",
        summary: readiness.ready
          ? `Default model ${readiness.resolvedDefaultModel ?? readiness.defaultModel ?? "unknown"} is ready.`
          : readiness.issues[0] || "OpenClaw model readiness is incomplete.",
        recovery: readiness.ready ? null : "Open Settings > Models, connect provider auth, then set a ready default model.",
        rawDetails: { readiness, modelStatus: modelStatusPayload }
      };
    }
  });

  await addCheck({
    id: "agents-list",
    label: "Agents list",
    required: true,
    recovery: "Create or repair at least one OpenClaw agent before dispatching missions.",
    run: async () => {
      if (!binaryAvailable) {
        throw new Error("OpenClaw binary is unavailable.");
      }

      const payload = await adapter.listAgents({ timeoutMs: cliCheckTimeoutMs });
      const count = payload.agents.length;

      return {
        status: count > 0 ? "pass" : "fail",
        summary: count > 0 ? `${count} OpenClaw agent${count === 1 ? "" : "s"} returned.` : "No OpenClaw agents were returned.",
        recovery: count > 0 ? null : "Use AgentOS onboarding or OpenClaw agent setup to create an agent.",
        rawDetails: payload
      };
    }
  });

  await addCheck({
    id: "sessions-list",
    label: "Sessions list",
    required: true,
    recovery: "Update OpenClaw or repair Gateway read access so sessions can be listed.",
    run: async () => {
      if (!binaryAvailable) {
        throw new Error("OpenClaw binary is unavailable.");
      }

      const payload = await adapter.listSessions({ limit: 5 }, { timeoutMs: cliCheckTimeoutMs });

      return {
        status: "pass",
        summary: `Sessions list responded with ${payload.sessions.length} session${payload.sessions.length === 1 ? "" : "s"}.`,
        recovery: null,
        rawDetails: payload
      };
    }
  });

  await addCheck({
    id: "tasks-list",
    label: "Tasks list",
    required: false,
    recovery: "Update OpenClaw if task RPC support is needed for live task views.",
    run: async () => {
      if (!binaryAvailable) {
        return skippedOptional("OpenClaw binary is unavailable.");
      }

      if (capabilityMatrix && !supportsAnyMethod(capabilityMatrix, ["tasks.list"])) {
        return skippedOptional("Gateway does not advertise tasks.list.");
      }

      const payload = await adapter.listTasks({ limit: 5 }, { timeoutMs: cliCheckTimeoutMs });

      return {
        status: "pass",
        summary: `Tasks list responded with ${payload.tasks?.length ?? 0} task${payload.tasks?.length === 1 ? "" : "s"}.`,
        recovery: null,
        rawDetails: payload
      };
    }
  });

  await addCheck({
    id: "config-read-schema",
    label: "Config read/schema",
    required: false,
    recovery: "Update OpenClaw if live config schema support is needed for control surfaces.",
    run: async () => {
      if (!binaryAvailable) {
        return skippedOptional("OpenClaw binary is unavailable.");
      }

      if (
        capabilityMatrix &&
        !supportsAnyMethod(capabilityMatrix, ["config.get", "config.schema", "config.schema.lookup"])
      ) {
        return skippedOptional("Gateway does not advertise config read/schema methods.");
      }

      const [configValue, schema] = await Promise.all([
        adapter.getConfig<unknown>("gateway", { timeoutMs: cliCheckTimeoutMs }),
        adapter.getConfigSchema({ timeoutMs: cliCheckTimeoutMs })
      ]);

      return {
        status: schema ? "pass" : "warning",
        summary: schema
          ? "Config read and schema calls responded."
          : "Config read responded, but schema was unavailable.",
        recovery: schema ? null : "Update OpenClaw for live schema metadata; basic config reads may still work.",
        rawDetails: { configValue, schema }
      };
    }
  });

  await addCheck({
    id: "event-subscription",
    label: "Event subscription",
    required: false,
    recovery: "Update OpenClaw or repair native Gateway access for live runtime events.",
    run: async () => {
      if (!binaryAvailable) {
        return skippedOptional("OpenClaw binary is unavailable.");
      }

      if (
        capabilityMatrix &&
        !supportsAnyMethod(capabilityMatrix, ["sessions.subscribe", "sessions.messages.subscribe"]) &&
        !supportsAnyEvent(capabilityMatrix, ["session.message", "session.operation", "sessions.changed", "task"])
      ) {
        return skippedOptional("Gateway does not advertise runtime event subscription support.");
      }

      const subscription = await adapter.subscribeRuntimeEvents(
        { includeSessions: true, includeTasks: true },
        { onEvent: () => {} },
        { timeoutMs: optionalNativeTimeoutMs }
      );
      subscription.close();

      return {
        status: "pass",
        summary: "Runtime event subscription opened and closed successfully.",
        recovery: null,
        rawDetails: { subscribed: true }
      };
    }
  });

  await addCheck({
    id: "fallback-behavior",
    label: "CLI fallback behavior",
    required: false,
    recovery: "Keep CLI fallback enabled and repair OpenClaw CLI status if native Gateway recovery is needed.",
    run: async () => {
      if (!binaryAvailable) {
        return skippedOptional("OpenClaw binary is unavailable.");
      }

      const client = createOpenClawGatewayClient({
        url: "ws://127.0.0.1:9",
        timeoutMs: 250,
        fallback: new CliOpenClawGatewayClient()
      });

      try {
        const before = client.getDiagnostics().fallbackTotal;
        const payload = await client.getStatus({ timeoutMs: cliCheckTimeoutMs });
        const afterDiagnostics = client.getDiagnostics();
        const after = afterDiagnostics.fallbackTotal;
        context.lastFallbackReason =
          afterDiagnostics.recentFallbackDiagnostics[0]?.issue ?? context.lastFallbackReason;

        return {
          status: after > before ? "pass" : "warning",
          summary: after > before
            ? "Simulated native failure successfully used CLI fallback."
            : "CLI status returned, but fallback usage was not recorded.",
          recovery: after > before ? null : "Inspect Gateway fallback diagnostics if native failures are not being tracked.",
          rawDetails: { payload, diagnostics: afterDiagnostics }
        };
      } catch (error) {
        const diagnostics = client.getDiagnostics();
        const fallbackAttempted = diagnostics.fallbackTotal > 0;
        const message = redactErrorMessage(error, "Simulated native failure did not complete.");
        const fallbackDisabledByPolicy = message.includes("CLI fallback disabled for this operation");
        context.lastFallbackReason =
          diagnostics.recentFallbackDiagnostics[0]?.issue ?? context.lastFallbackReason;

        if (fallbackDisabledByPolicy) {
          return {
            status: "pass",
            summary: "Simulated native connection failure failed closed instead of pretending CLI fallback was live.",
            recovery: null,
            rawDetails: { simulatedNativeFailure: message, diagnostics }
          };
        }

        return {
          status: fallbackAttempted ? "warning" : "fail",
          summary: fallbackAttempted
            ? `CLI fallback was attempted, but the fallback call did not complete: ${message}`
            : `Simulated native failure did not exercise CLI fallback: ${message}`,
          recovery: fallbackAttempted
            ? "Inspect CLI fallback diagnostics and verify `openclaw gateway status --json` still works."
            : "Repair native Gateway access or keep CLI fallback limited to supported recovery operations.",
          rawDetails: { simulatedNativeFailure: message, diagnostics }
        };
      } finally {
        client.close("compatibility smoke fallback finished");
      }
    }
  });

  const transport = getOpenClawGatewayClient()?.getDiagnostics?.();
  const fallbackTotal = transport?.fallbackTotal ?? 0;
  const lastFallbackReason =
    context.lastFallbackReason ??
    transport?.recentFallbackDiagnostics?.[0]?.issue ??
    null;
  const lastNativeError = transport?.lastNativeError ?? null;
  const outcome = resolveOpenClawCompatibilitySmokeOutcome(checks, {
    modelReady: context.modelReadiness?.ready ?? null
  });
  const report: OpenClawCompatibilitySmokeReport = {
    status: outcome.status,
    checkedAt,
    durationMs: Date.now() - startedAt,
    safeToDispatchMissions: outcome.safeToDispatchMissions,
    recovery: outcome.recovery,
    checks,
    compatibility: {
      installedVersion: context.installedVersion,
      requiredOpenClawVersion: OPENCLAW_SUPPORTED_BASELINE_VERSION,
      recommendedOpenClawVersion: context.recommendedOpenClawVersion,
      gatewayProtocolVersion: context.gatewayProtocolVersion,
      requiredGatewayProtocolVersion: OPENCLAW_REQUIRED_GATEWAY_PROTOCOL_VERSION,
      agentOsSupportedProtocolRange: OPENCLAW_GATEWAY_PROTOCOL_RANGE,
      nodeVersion: context.nodeVersion,
      nodeRequiredVersion: AGENTOS_REQUIRED_NODE_VERSION,
      nodeRecommendedVersion: OPENCLAW_RECOMMENDED_NODE_VERSION,
      nodeStatus: context.nodeStatus,
      gatewayAuthStatus: context.gatewayAuthStatus,
      nativeGatewayStatus: context.nativeGatewayStatus,
      cliFallbackUsageCount: fallbackTotal,
      lastNativeError,
      lastFallbackReason,
      modelReady: context.modelReadiness?.ready ?? null
    }
  };
  const safeReport = redactSecrets(report);

  await persistOpenClawCompatibilitySmokeTest(safeReport);
  return safeReport;
}

export function classifyOpenClawNodeVersion(version: string | null | undefined): {
  status: OpenClawCompatibilitySmokeReport["compatibility"]["nodeStatus"];
  summary: string;
  recovery: string | null;
} {
  const normalized = normalizeVersion(version);

  if (!normalized) {
    return {
      status: "unknown",
      summary: "Node.js version could not be detected.",
      recovery: `Install Node.js ${AGENTOS_REQUIRED_NODE_VERSION} or newer.`
    };
  }

  const [majorText, minorText] = normalized.split(".");
  const major = Number(majorText);
  const minor = Number(minorText);
  const supported = (major === 24 && minor >= 16) || (major >= 26 && compareVersionStrings(normalized, "26.1.0") >= 0);

  if (!supported) {
    return {
      status: "unsupported",
      summary: `Node.js ${normalized} is outside the supported AgentOS/OpenClaw runtime floors (${OPENCLAW_REQUIRED_NODE_VERSION}).`,
      recovery: `Install Node.js ${AGENTOS_REQUIRED_NODE_VERSION}+ or Node.js 26.1.0+. Node ${OPENCLAW_RECOMMENDED_NODE_VERSION} is recommended.`
    };
  }

  return {
    status: "supported",
    summary: `Node.js ${normalized} satisfies the supported AgentOS/OpenClaw runtime floors.`,
    recovery: null
  };
}

export function resolveOpenClawCompatibilitySmokeOutcome(
  checks: OpenClawSmokeTestCheck[],
  input: { modelReady: boolean | null }
): {
  status: OpenClawCompatibilityStatus;
  safeToDispatchMissions: boolean;
  recovery: string;
} {
  if (checks.length === 0) {
    return {
      status: "unknown",
      safeToDispatchMissions: false,
      recovery: "Run the OpenClaw compatibility smoke test."
    };
  }

  const requiredChecks = checks.filter((check) => check.required);
  const requiredFailure = requiredChecks.find((check) => check.status === "fail");
  const requiredWarning = requiredChecks.find((check) => check.status === "warning");
  const optionalFailure = checks.find((check) => !check.required && check.status === "fail");
  const firstWarning = checks.find((check) => check.status === "warning");
  const firstIssue = requiredFailure ?? requiredWarning ?? optionalFailure ?? firstWarning ?? null;
  const safeToDispatchMissions =
    !requiredFailure &&
    requiredChecks.every((check) => check.status === "pass") &&
    input.modelReady === true;

  if (requiredFailure) {
    return {
      status: "incompatible",
      safeToDispatchMissions: false,
      recovery: requiredFailure.recovery || "Repair failed OpenClaw compatibility checks, then rerun the smoke test."
    };
  }

  if (requiredWarning || optionalFailure || firstWarning || input.modelReady !== true) {
    return {
      status: "degraded",
      safeToDispatchMissions,
      recovery: firstIssue?.recovery || "OpenClaw is partially available. Review warnings before dispatching missions."
    };
  }

  return {
    status: "compatible",
    safeToDispatchMissions,
    recovery: "OpenClaw compatibility checks passed."
  };
}

async function runSmokeCheck(input: CheckInput): Promise<OpenClawSmokeTestCheck> {
  const startedAt = Date.now();

  try {
    const result = await input.run();
    return {
      id: input.id,
      label: input.label,
      status: result.status,
      required: input.required,
      summary: result.summary,
      recovery: result.recovery ?? null,
      durationMs: Date.now() - startedAt,
      ...(result.rawDetails !== undefined ? { rawDetails: sanitizeRawDetails(result.rawDetails) } : {})
    };
  } catch (error) {
    const failure = stringifyCommandFailure(error);
    return {
      id: input.id,
      label: input.label,
      status: "fail",
      required: input.required,
      summary: redactErrorMessage(error, `${input.label} failed.`),
      recovery: input.recovery,
      durationMs: Date.now() - startedAt,
      rawDetails: sanitizeRawDetails({
        error: failure || redactErrorMessage(error, `${input.label} failed.`)
      })
    };
  }
}

function skippedOptional(summary: string): CheckResult {
  return {
    status: "warning",
    summary,
    recovery: "This check was skipped because the current OpenClaw runtime does not expose the required prerequisite.",
    rawDetails: { skipped: true, reason: summary }
  };
}

function sanitizeRawDetails(value: unknown) {
  const redacted = redactSecrets(value);
  const serialized = safeStringify(redacted);

  if (serialized.length <= rawDetailsMaxLength) {
    return redacted;
  }

  return {
    truncated: true,
    preview: serialized.slice(0, rawDetailsMaxLength)
  };
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function supportsAnyMethod(matrix: OpenClawCapabilityMatrix, methods: string[]) {
  void matrix;
  void methods;
  // Gateway discovery lists are conservative. A missing method is unknown,
  // not a reason to skip the native probe or force CLI fallback.
  return true;
}

function supportsAnyEvent(matrix: OpenClawCapabilityMatrix, events: string[]) {
  void matrix;
  void events;
  // Event metadata is also advisory; let the native subscription prove the
  // capability instead of skipping because an event was omitted.
  return true;
}

function isGatewayProtocolCompatible(protocol: string) {
  const numeric = Number(protocol);
  return Number.isFinite(numeric) &&
    numeric >= OPENCLAW_GATEWAY_PROTOCOL_RANGE.min &&
    numeric <= OPENCLAW_GATEWAY_PROTOCOL_RANGE.max;
}

function normalizeVersion(value: string | null | undefined) {
  const trimmed = value?.trim().replace(/^v/i, "");
  return trimmed || null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
