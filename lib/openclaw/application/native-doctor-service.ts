import "server-only";

import { getOpenClawAdapter, type OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  classifyNativeMutationError,
  normalizeClientError
} from "@/lib/openclaw/client/native-ws-gateway-errors";
import type {
  OpenClawCommandOptions,
  OpenClawGatewayRestartRequestInput,
  OpenClawGatewaySuspendPrepareInput,
  OpenClawGatewaySuspendResumeInput,
  OpenClawGatewaySuspendStatusInput,
  OpenClawUpdateRunInput
} from "@/lib/openclaw/client/types";
import { openClawScopesAllow } from "@/lib/openclaw/identity/types";
import { redactSecretText } from "@/lib/security/redaction";

export type NativeReadStatus = "available" | "unavailable" | "forbidden" | "unknown";
export type NativeHealthStatus = "healthy" | "degraded" | "unavailable" | "unknown";
export type NativeConfigApplicationStatus = "applied" | "restart-required" | "unknown";
export type NativeUpdateStatus = "available" | "current" | "unavailable" | "unknown";
export type NativeRecoveryStatus = "healthy" | "needs-attention" | "restart-required" | "unavailable" | "unknown";

export type NativeDoctorSnapshot = {
  generatedAt: string;
  source: "openclaw-native";
  runtime: {
    status: NativeHealthStatus;
    reachable: boolean | null;
    explanation: string;
  };
  status: {
    readStatus: NativeReadStatus;
    runtimeVersion: string | null;
    version: string | null;
    updateChannel: string | null;
    gatewayReachable: boolean | null;
    gatewayMode: string | null;
  };
  diagnostics: {
    status: NativeReadStatus;
    stability: Record<string, unknown> | null;
  };
  config: {
    readStatus: NativeReadStatus;
    valid: boolean | null;
    configuredRevisionHash: string | null;
    appliedRevisionHash: string | null;
    hotReloadStatus: string | null;
    application: NativeConfigApplicationStatus;
    explanation: string;
  };
  update: {
    readStatus: NativeReadStatus;
    status: NativeUpdateStatus;
    updateAvailable: boolean | null;
    currentVersion: string | null;
    latestVersion: string | null;
    effectiveChannel: string | null;
    schedule: Record<string, unknown> | null;
    explanation: string;
  };
  recovery: {
    status: NativeRecoveryStatus;
    issues: string[];
    actions: Array<"refresh" | "probe" | "restart" | "update">;
    explanation: string;
  };
  identity: {
    connectionId: string | null;
    deviceId: string | null;
    connectionGeneration: number | null;
    authenticated: boolean | null;
    role: string | null;
    grantedScopesKnown: boolean | null;
  };
  reads: Record<string, NativeReadStatus>;
};

export type NativeDoctorConfirmation = {
  connectionId: string | null;
  effectiveChannel: string | null;
  availableVersion: string | null;
};

export type NativeDoctorMutationOutcome = {
  outcome: "succeeded" | "accepted" | "deferred" | "skipped" | "failed" | "unknown";
  method: string;
  result: Record<string, unknown> | null;
  reconciliation: "not-required" | "confirmed" | "inconclusive";
  verification: NativeDoctorVerification;
  message: string;
};

export type NativeDoctorVerification = {
  status: "not-required" | "verified" | "unknown";
  message: string;
  connectionGeneration: number | null;
};

const NATIVE_READ_TIMEOUT_MS = 12_000;

export async function getNativeDoctorSnapshot(
  options: { adapter?: OpenClawAdapter; commandOptions?: OpenClawCommandOptions; probe?: boolean; refreshCheckout?: boolean } = {}
): Promise<NativeDoctorSnapshot> {
  const adapter = options.adapter ?? getOpenClawAdapter();
  const commandOptions = {
    timeoutMs: NATIVE_READ_TIMEOUT_MS,
    ...options.commandOptions
  };

  const [health, status, diagnostics, config, identity] = await Promise.all([
    readNative(() => adapter.getNativeHealth?.({
      ...commandOptions,
      ...(options.probe === undefined ? {} : { probe: options.probe })
    })),
    readNative(() => adapter.getNativeStatus?.(commandOptions)),
    readNative(() => adapter.getDiagnosticsStability?.(commandOptions)),
    readNative(() => adapter.getConfigSnapshot?.(commandOptions)),
    readNative(async () => {
      const connection = adapter.getConnectionIdentity?.();
      const nativeIdentity = await connection?.client.getOperatorIdentity?.(commandOptions);
      const diagnostics = connection?.client.getDiagnostics?.();
      return nativeIdentity ?? diagnostics?.operatorIdentity ?? null;
    })
  ]);
  const update = identity.status === "available" && identity.value?.grantedScopesKnown === true
    && !openClawScopesAllow(identity.value.grantedScopes, ["operator.admin"])
    ? { status: "forbidden" as const, value: null }
    : await readNative(() => adapter.getNativeUpdateStatus?.({
      ...commandOptions,
      ...(options.refreshCheckout === undefined ? {} : { refreshCheckout: options.refreshCheckout })
    }));

  const healthPayload = health.value;
  const healthStatus: NativeHealthStatus = health.status === "unavailable"
    ? "unavailable"
    : health.status !== "available"
      ? "unknown"
      : healthPayload?.ok === true
        ? "healthy"
        : healthPayload?.ok === false
          ? "degraded"
          : "unknown";
  const configPayload = config.value;
  const configuredRevisionHash = readNonEmptyString(configPayload?.configRevisionHash);
  const appliedRevisionHash = readNonEmptyString(configPayload?.appliedConfigHash);
  const configApplication: NativeConfigApplicationStatus = configuredRevisionHash && appliedRevisionHash
    ? configuredRevisionHash === appliedRevisionHash
      ? "applied"
      : "restart-required"
    : "unknown";
  const healthConfigReload = isRecord(healthPayload?.configReload) ? healthPayload.configReload : null;
  const statusPayload = status.value;
  const updatePayload = update.value;
  const updateAvailableRecord = isRecord(updatePayload?.updateAvailable) ? updatePayload.updateAvailable : null;
  const updateAvailable = updatePayload
    ? updateAvailableRecord !== null
    : null;
  const recoveryStatus: NativeRecoveryStatus = configApplication === "restart-required"
    ? "restart-required"
    : healthStatus === "unavailable"
      ? "unavailable"
      : healthStatus === "unknown" || status.status === "unknown"
        ? "unknown"
        : healthStatus === "degraded"
          ? "needs-attention"
          : "healthy";
  const recoveryIssues = [
    ...(configApplication === "restart-required" ? ["Saved configuration is newer than the active Gateway."] : []),
    ...(healthStatus === "degraded" ? ["OpenClaw reported a degraded runtime."] : []),
    ...(healthStatus === "unavailable" ? ["OpenClaw health is unavailable."] : []),
    ...(healthStatus === "unknown" ? ["OpenClaw health could not be verified."] : []),
  ];
  const recoveryActions: NativeDoctorSnapshot["recovery"]["actions"] = ["refresh", "probe"];
  if (configApplication === "restart-required") recoveryActions.push("restart");
  if (updateAvailable) recoveryActions.push("update");

  return {
    generatedAt: new Date().toISOString(),
    source: "openclaw-native",
    runtime: {
      status: healthStatus,
      reachable: health.status === "available" ? true : health.status === "unavailable" ? false : null,
      explanation: healthStatus === "healthy"
        ? "OpenClaw reported a healthy Gateway."
        : healthStatus === "degraded"
          ? "OpenClaw is reachable but reported a degraded runtime."
          : healthStatus === "unavailable"
            ? "The native OpenClaw health method is unavailable."
        : "AgentOS could not verify the current OpenClaw runtime health.",
    },
    status: {
      readStatus: status.status,
      runtimeVersion: readNonEmptyString(statusPayload?.runtimeVersion),
      version: readNonEmptyString(statusPayload?.version),
      updateChannel: readNonEmptyString(statusPayload?.updateChannel),
      gatewayReachable: typeof statusPayload?.gateway?.reachable === "boolean" ? statusPayload.gateway.reachable : null,
      gatewayMode: readNonEmptyString(statusPayload?.gateway?.mode)
    },
    diagnostics: {
      status: diagnostics.status,
      stability: diagnostics.value ? projectStability(diagnostics.value) : null
    },
    config: {
      readStatus: config.status,
      valid: typeof configPayload?.valid === "boolean" ? configPayload.valid : null,
      configuredRevisionHash,
      appliedRevisionHash,
      hotReloadStatus: readNonEmptyString(healthConfigReload?.hotReloadStatus),
      application: configApplication,
      explanation: configApplication === "applied"
        ? "The configured revision is applied by the active Gateway."
        : configApplication === "restart-required"
          ? "The configured revision differs from the revision applied by the active Gateway."
          : "AgentOS could not determine whether the configured revision is applied.",
    },
    update: {
      readStatus: update.status,
      status: update.status === "unavailable" || update.status === "forbidden"
        ? "unavailable"
        : update.status !== "available"
          ? "unknown"
          : updateAvailable
            ? "available"
            : "current",
      updateAvailable,
      currentVersion: readNonEmptyString(updateAvailableRecord?.currentVersion),
      latestVersion: readNonEmptyString(updateAvailableRecord?.latestVersion),
      effectiveChannel: readNonEmptyString(updatePayload?.effectiveChannel),
      schedule: projectUpdateSchedule(updatePayload?.schedule),
      explanation: update.status === "available"
        ? updateAvailable
          ? "OpenClaw reports an update is available."
          : "OpenClaw reports no update is currently available."
        : update.status === "unavailable"
          ? "The native OpenClaw update status method is unavailable."
          : update.status === "forbidden"
            ? "OpenClaw update status requires operator admin access."
          : "AgentOS could not verify the current OpenClaw update state.",
    },
    recovery: {
      status: recoveryStatus,
      issues: recoveryIssues,
      actions: recoveryActions,
      explanation: recoveryStatus === "restart-required"
        ? "OpenClaw reports that a restart is required to apply the saved configuration."
        : recoveryStatus === "needs-attention"
          ? "OpenClaw reported an operational issue that needs investigation."
          : recoveryStatus === "unavailable"
            ? "OpenClaw recovery state is unavailable."
            : recoveryStatus === "unknown"
              ? "AgentOS could not verify the current recovery state."
              : "No native recovery issue is currently reported."
    },
    identity: {
      connectionId: readNonEmptyString(identity.value?.connectionId),
      deviceId: readNonEmptyString(identity.value?.deviceId),
      connectionGeneration: readConnectionGeneration(adapter),
      authenticated: typeof identity.value?.authenticated === "boolean" ? identity.value.authenticated : null,
      role: readNonEmptyString(identity.value?.role),
      grantedScopesKnown: typeof identity.value?.grantedScopesKnown === "boolean"
        ? identity.value.grantedScopesKnown
        : null
    },
    reads: {
      health: health.status,
      status: status.status,
      "diagnostics.stability": diagnostics.status,
      "config.get": config.status,
      "update.status": update.status,
      identity: identity.status
    }
  };
}

export async function executeNativeDoctorMutation(
  input:
    | { action: "update.run"; input?: OpenClawUpdateRunInput }
    | { action: "update.hold" }
    | { action: "gateway.restart.request"; input?: OpenClawGatewayRestartRequestInput }
    | { action: "gateway.suspend.prepare"; input: OpenClawGatewaySuspendPrepareInput }
    | { action: "gateway.suspend.status"; input: OpenClawGatewaySuspendStatusInput }
    | { action: "gateway.suspend.resume"; input: OpenClawGatewaySuspendResumeInput },
  options: { adapter?: OpenClawAdapter; commandOptions?: OpenClawCommandOptions } = {}
): Promise<NativeDoctorMutationOutcome> {
  const adapter = options.adapter ?? getOpenClawAdapter();
  const commandOptions = options.commandOptions;

  try {
    let result: Record<string, unknown>;
    switch (input.action) {
      case "update.run":
        result = await requireNativeMethod(adapter.runNativeUpdate, "update.run")?.call(adapter, input.input, commandOptions) as Record<string, unknown>;
        return normalizeNativeUpdateRunOutcome(result);
      case "update.hold":
        result = await requireNativeMethod(adapter.holdNativeUpdate, "update.hold")?.call(adapter, commandOptions) as Record<string, unknown>;
        return buildMutationOutcome("update.hold", result, "succeeded", "OpenClaw processed the update hold request.");
      case "gateway.restart.request":
        result = await requireNativeMethod(adapter.requestNativeGatewayRestart, "gateway.restart.request")?.call(adapter, input.input, commandOptions) as Record<string, unknown>;
        return buildMutationOutcome("gateway.restart.request", result, readRestartOutcome(result), "OpenClaw accepted the native Gateway restart request.");
      case "gateway.suspend.prepare":
        result = await requireNativeMethod(adapter.prepareNativeGatewaySuspend, "gateway.suspend.prepare")?.call(adapter, input.input, commandOptions) as Record<string, unknown>;
        return buildMutationOutcome("gateway.suspend.prepare", result, readSuspendOutcome(result), "OpenClaw returned the native Gateway suspension state.");
      case "gateway.suspend.status":
        result = await requireNativeMethod(adapter.getNativeGatewaySuspendStatus, "gateway.suspend.status")?.call(adapter, input.input, commandOptions) as Record<string, unknown>;
        return buildMutationOutcome("gateway.suspend.status", result, "succeeded", "OpenClaw returned the native suspension state.");
      case "gateway.suspend.resume":
        result = await requireNativeMethod(adapter.resumeNativeGatewaySuspend, "gateway.suspend.resume")?.call(adapter, input.input, commandOptions) as Record<string, unknown>;
        return buildMutationOutcome("gateway.suspend.resume", result, "succeeded", "OpenClaw accepted the native Gateway resume request.");
    }
  } catch (error) {
    const classification = classifyNativeMutationError(error);
    const method = input.action;
    return {
      outcome: classification.disposition === "definite-rejection" ? "failed" : "unknown",
      method,
      result: null,
      reconciliation: "inconclusive",
      verification: {
        status: "unknown",
        message: "The native request outcome could not be verified.",
        connectionGeneration: null
      },
      message: classification.disposition === "definite-rejection"
        ? redactSecretText(classification.message)
        : "The native request outcome is uncertain. AgentOS did not retry it; re-read OpenClaw state before acting again."
    };
  }
}

export function buildNativeDoctorConfirmation(snapshot: NativeDoctorSnapshot): NativeDoctorConfirmation {
  return {
    connectionId: snapshot.identity.connectionId,
    effectiveChannel: snapshot.update.effectiveChannel,
    availableVersion: snapshot.update.latestVersion
  };
}

export function auditResultForNativeDoctorMutation(outcome: NativeDoctorMutationOutcome["outcome"]): "succeeded" | "failed" | "unknown" {
  if (outcome === "failed") return "failed";
  if (outcome === "unknown") return "unknown";
  return "succeeded";
}

export async function reconcileNativeDoctorMutation(
  mutation: NativeDoctorMutationOutcome,
  options: { before: NativeDoctorSnapshot; adapter?: OpenClawAdapter; commandOptions?: OpenClawCommandOptions }
): Promise<NativeDoctorMutationOutcome> {
  if (mutation.method === "gateway.restart.request") {
    return reconcileRestartMutation(mutation, options);
  }

  if (mutation.method !== "update.run" || mutation.outcome === "failed" || mutation.outcome === "unknown" || mutation.outcome === "skipped") {
    return mutation;
  }

  const restartExpected = isRecord(mutation.result?.restart) || isRecord(mutation.result?.handoff);
  if (!restartExpected) {
    const fresh = await getNativeDoctorSnapshot({ adapter: options.adapter, commandOptions: options.commandOptions, probe: true });
    return applyVerification(mutation, verifyFreshUpdateState(options.before, fresh));
  }

  const generation = await waitForNativeReconnect(options.adapter ?? getOpenClawAdapter(), options.before.identity.connectionGeneration);
  if (generation === null) {
    return applyVerification(mutation, unknownVerification("OpenClaw accepted the update, but AgentOS did not observe a fresh reconnect generation."));
  }
  const fresh = await getNativeDoctorSnapshot({ adapter: options.adapter, commandOptions: options.commandOptions, probe: true });
  return applyVerification(mutation, verifyFreshUpdateState(options.before, fresh, generation));
}

async function reconcileRestartMutation(
  mutation: NativeDoctorMutationOutcome,
  options: { before: NativeDoctorSnapshot; adapter?: OpenClawAdapter; commandOptions?: OpenClawCommandOptions }
) {
  if (mutation.outcome === "failed" || mutation.outcome === "unknown") {
    return mutation;
  }
  const generation = await waitForNativeReconnect(options.adapter ?? getOpenClawAdapter(), options.before.identity.connectionGeneration);
  if (generation === null) {
    return applyVerification(mutation, unknownVerification("OpenClaw accepted the restart request, but AgentOS did not observe a fresh reconnect generation."));
  }
  const fresh = await getNativeDoctorSnapshot({ adapter: options.adapter, commandOptions: options.commandOptions, probe: true });
  return applyVerification(mutation, verifyFreshRestartState(options.before, fresh, generation));
}

export function verifyFreshRestartState(
  before: NativeDoctorSnapshot,
  after: NativeDoctorSnapshot,
  generation: number | null
): NativeDoctorVerification {
  if (!hasFreshAuthenticatedGeneration(before, after, generation)) {
    return unknownVerification("The Gateway reconnected, but AgentOS could not verify the intended native Gateway identity.", generation);
  }
  if (after.runtime.status !== "healthy" || after.status.readStatus !== "available") {
    return unknownVerification("The Gateway reconnected, but fresh native health or status evidence is incomplete.", generation);
  }
  if (before.config.application === "restart-required" && (
    after.config.application !== "applied" ||
    after.config.configuredRevisionHash === null ||
    after.config.configuredRevisionHash !== after.config.appliedRevisionHash
  )) {
    return unknownVerification("The Gateway reconnected, but the saved configuration is not applied.", generation);
  }
  return verifiedVerification("OpenClaw reconnected with the intended identity and fresh healthy status.", generation);
}

export function verifyFreshUpdateState(
  before: NativeDoctorSnapshot,
  after: NativeDoctorSnapshot,
  generation: number | null = null
): NativeDoctorVerification {
  if (generation !== null && !hasFreshAuthenticatedGeneration(before, after, generation)) {
    return unknownVerification("OpenClaw returned after the update, but AgentOS could not verify the intended native Gateway identity.", generation);
  }
  if (after.runtime.status !== "healthy" || after.status.readStatus !== "available" || after.update.readStatus !== "available") {
    return unknownVerification("OpenClaw may have applied the update, but fresh native health, status, or update evidence is incomplete.", generation);
  }
  if (after.update.status !== "current") {
    return unknownVerification("OpenClaw returned fresh state, but the update is not confirmed current.", generation);
  }
  const expectedVersion = normalizeVersion(before.update.latestVersion);
  const installedVersion = normalizeVersion(
    after.update.currentVersion || after.status.runtimeVersion || after.status.version
  );
  if (expectedVersion && installedVersion !== expectedVersion) {
    return unknownVerification(
      installedVersion
        ? `OpenClaw returned a current runtime at v${installedVersion}, but the confirmed native target was v${expectedVersion}.`
        : `OpenClaw returned current status, but AgentOS could not verify that the native target v${expectedVersion} is installed.`,
      generation
    );
  }
  return verifiedVerification("OpenClaw returned fresh healthy status and confirmed the update state.", generation);
}

function applyVerification(mutation: NativeDoctorMutationOutcome, verification: NativeDoctorVerification): NativeDoctorMutationOutcome {
  return {
    ...mutation,
    reconciliation: verification.status === "verified" ? "confirmed" : "inconclusive",
    verification,
    message: verification.status === "verified" ? verification.message : verification.message
  };
}

function verifiedVerification(message: string, connectionGeneration: number | null): NativeDoctorVerification {
  return { status: "verified", message, connectionGeneration };
}

function unknownVerification(message: string, connectionGeneration: number | null = null): NativeDoctorVerification {
  return { status: "unknown", message, connectionGeneration };
}

function hasFreshAuthenticatedGeneration(before: NativeDoctorSnapshot, after: NativeDoctorSnapshot, generation: number | null) {
  return generation !== null && before.identity.connectionGeneration !== null && generation > before.identity.connectionGeneration
    && before.identity.deviceId !== null
    && after.identity.deviceId !== null
    && before.identity.deviceId === after.identity.deviceId
    && after.identity.authenticated === true;
}

async function waitForNativeReconnect(adapter: OpenClawAdapter, beforeGeneration: number | null): Promise<number | null> {
  if (beforeGeneration === null || !adapter.subscribeNativeRuntimeEvents || adapter.getNativeConnectionGeneration === undefined) {
    return null;
  }

  const timeoutMs = 15_000;
  let subscription: { close: () => void; reconnectManagedByClient?: boolean } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let settled = false;
  const subscribeNativeRuntimeEvents = adapter.subscribeNativeRuntimeEvents;
  return await new Promise<number | null>((resolve) => {
    const finish = (generation: number | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      subscription?.close();
      resolve(generation);
    };
    timer = setTimeout(() => finish(null), timeoutMs);
    void subscribeNativeRuntimeEvents(
      { includeSessions: false, includeTasks: false, includeArtifacts: false, includeApprovals: false },
      {
        onEvent: () => {},
        onReconnected: ({ generation }) => {
          if (generation > beforeGeneration) finish(generation);
        }
      },
      { timeoutMs }
    ).then((nextSubscription) => {
      if (settled) {
        nextSubscription.close();
        return;
      }
      subscription = nextSubscription;
      if (nextSubscription.reconnectManagedByClient !== true) {
        finish(null);
      }
    }).catch(() => finish(null));
  });
}

export function confirmationMatches(
  expected: NativeDoctorConfirmation,
  actual: NativeDoctorConfirmation
) {
  return expected.connectionId !== null
    && actual.connectionId !== null
    && expected.connectionId === actual.connectionId
    && expected.effectiveChannel === actual.effectiveChannel
    && expected.availableVersion === actual.availableVersion;
}

type NativeReadResult<T> = {
  status: NativeReadStatus;
  value: T | null;
};

async function readNative<T>(read: () => Promise<T | null | undefined> | undefined): Promise<NativeReadResult<T>> {
  if (!read) {
    return { status: "unavailable", value: null };
  }
  try {
    const value = await read();
    return value === null || value === undefined
      ? { status: "unknown", value: null }
      : { status: "available", value };
  } catch (error) {
    const normalized = normalizeClientError(error);
    return {
      status: normalized.kind === "unsupported"
        ? "unavailable"
        : normalized.kind === "auth" || normalized.kind === "scope-limited"
          ? "forbidden"
          : "unknown",
      value: null
    };
  }
}

function requireNativeMethod<T extends (...args: never[]) => unknown>(method: T | undefined, name: string) {
  if (!method) {
    throw new Error(`OpenClaw native ${name} is unavailable.`);
  }
  return method;
}

function readConnectionGeneration(adapter: OpenClawAdapter): number | null {
  const generation = adapter.getNativeConnectionGeneration?.();
  return typeof generation === "number" && Number.isSafeInteger(generation) && generation >= 0
    ? generation
    : null;
}

function buildMutationOutcome(
  method: string,
  result: Record<string, unknown>,
  outcome: NativeDoctorMutationOutcome["outcome"],
  message: string
): NativeDoctorMutationOutcome {
  return {
    outcome,
    method,
    result: projectMutationResult(method, result),
    reconciliation: "not-required",
    verification: notRequiredVerification(),
    message
  };
}

export function normalizeNativeUpdateRunOutcome(result: Record<string, unknown>): NativeDoctorMutationOutcome {
  const nativeResult = isRecord(result.result) ? result.result : null;
  const nativeStatus = readNonEmptyString(nativeResult?.status);
  const handoffStatus = readNonEmptyString(isRecord(result.handoff) ? result.handoff.status : null);
  const nativeReason = readNonEmptyString(nativeResult?.reason);

  if (nativeStatus === "ok") {
    const restart = isRecord(result.restart) ? result.restart : null;
    return buildMutationOutcome(
      "update.run",
      result,
      restart || handoffStatus === "started" ? "accepted" : "succeeded",
      restart || handoffStatus === "started"
        ? "OpenClaw applied the update and accepted the native restart or handoff."
        : "OpenClaw reported that the native update completed."
    );
  }

  if (nativeStatus === "skipped") {
    const handoffOutcome = handoffStatus === "started" ? "deferred" : "skipped";
    return buildMutationOutcome(
      "update.run",
      result,
      handoffOutcome,
      handoffOutcome === "deferred"
        ? "OpenClaw handed the update to its managed-service supervisor; completion is not yet verified."
        : nativeReason
          ? `OpenClaw skipped the native update: ${redactSecretText(nativeReason)}`
          : "OpenClaw skipped the native update."
    );
  }

  if (nativeStatus === "error") {
    return buildMutationOutcome(
      "update.run",
      result,
      "failed",
      nativeReason
        ? `OpenClaw rejected the native update: ${redactSecretText(nativeReason)}`
        : "OpenClaw reported a native update error."
    );
  }

  return buildMutationOutcome(
    "update.run",
    result,
    "unknown",
    "OpenClaw returned an update response whose native result status could not be determined."
  );
}

function notRequiredVerification(): NativeDoctorVerification {
  return {
    status: "not-required",
    message: "No post-operation reconnect verification was required.",
    connectionGeneration: null
  };
}

function readRestartOutcome(result: Record<string, unknown>): NativeDoctorMutationOutcome["outcome"] {
  const status = readNonEmptyString(result.status);
  return status === "deferred" ? "deferred" : "accepted";
}

function readSuspendOutcome(result: Record<string, unknown>): NativeDoctorMutationOutcome["outcome"] {
  const status = readNonEmptyString(result.status);
  return status === "busy" || status === "draining" ? "deferred" : "accepted";
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeVersion(value: string | null | undefined) {
  const normalized = value?.trim().replace(/^v/i, "");
  return normalized || null;
}

function projectStability(value: Record<string, unknown>) {
  const safe: Record<string, unknown> = {};
  for (const key of ["status", "healthy", "ok", "checksRun", "checksSkipped", "warningCount", "errorCount"]) {
    const item = value[key];
    if (typeof item === "string" || typeof item === "boolean" || typeof item === "number") {
      safe[key] = item;
    }
  }
  return safe;
}

function projectMutationResult(method: string, value: Record<string, unknown>) {
  const safe: Record<string, unknown> = {};
  const keys = method === "update.run"
    ? ["ok", "status", "reason", "durationMs", "result", "restart", "handoff"]
    : method === "gateway.suspend.prepare" || method === "gateway.suspend.status"
      ? ["status", "suspensionId", "retryAfterMs", "expiresAtMs", "blockers"]
      : ["ok", "status", "resumed", "reason"];
  for (const key of keys) {
    const item = value[key];
    if (typeof item === "string" || typeof item === "boolean" || typeof item === "number") {
      safe[key] = item;
    } else if ((key === "restart" || key === "handoff") && isRecord(item)) {
      const nested: Record<string, unknown> = {};
      for (const nestedKey of ["status", "reconnected", "verified", "delayMs", "coalesced"]) {
        const nestedValue = item[nestedKey];
        if (typeof nestedValue === "string" || typeof nestedValue === "boolean" || typeof nestedValue === "number") {
          nested[nestedKey] = nestedValue;
        }
      }
      if (Object.keys(nested).length > 0) safe[key] = nested;
    } else if (key === "result" && isRecord(item)) {
      const nested: Record<string, unknown> = {};
      for (const nestedKey of ["status", "reason", "mode", "durationMs"]) {
        const nestedValue = item[nestedKey];
        if (typeof nestedValue === "string" || typeof nestedValue === "number") {
          nested[nestedKey] = nestedValue;
        }
      }
      for (const nestedKey of ["before", "after"]) {
        const versioned = item[nestedKey];
        if (!isRecord(versioned)) continue;
        const versionedSafe: Record<string, unknown> = {};
        for (const versionKey of ["sha", "version", "buildId", "upstreamRef"]) {
          const versionValue = versioned[versionKey];
          if (typeof versionValue === "string") versionedSafe[versionKey] = versionValue;
        }
        if (Object.keys(versionedSafe).length > 0) nested[nestedKey] = versionedSafe;
      }
      if (Object.keys(nested).length > 0) safe[key] = nested;
    } else if (key === "blockers" && Array.isArray(item)) {
      safe[key] = item.filter((entry): entry is string => typeof entry === "string").slice(0, 8).map(redactSecretText);
    }
  }
  return safe;
}

function projectUpdateSchedule(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const safe: Record<string, unknown> = {};
  const channel = readNonEmptyString(value.channel);
  if (channel) safe.channel = channel;
  if (typeof value.autoEnabled === "boolean") safe.autoEnabled = value.autoEnabled;
  const target = projectScheduleTarget(value.target);
  if (target) safe.target = target;
  const campaign = projectScheduleCampaign(value.campaign);
  if (campaign) safe.campaign = campaign;
  const install = isRecord(value.install) ? projectScheduleInstall(value.install) : null;
  if (install) safe.install = install;
  return Object.keys(safe).length > 0 ? safe : null;
}

function projectScheduleTarget(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const safe: Record<string, unknown> = {};
  const kind = readNonEmptyString(value.kind);
  if (kind) safe.kind = kind;
  for (const key of ["version", "upstreamRef", "upstreamSha"]) {
    const item = readNonEmptyString(value[key]);
    if (item) safe[key] = item;
  }
  if (typeof value.commitsBehind === "number" && Number.isSafeInteger(value.commitsBehind) && value.commitsBehind >= 0) {
    safe.commitsBehind = value.commitsBehind;
  }
  return Object.keys(safe).length > 0 ? safe : null;
}

function projectScheduleCampaign(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const safe: Record<string, unknown> = {};
  const id = readNonEmptyString(value.id);
  const state = readNonEmptyString(value.state);
  if (id) safe.id = id;
  if (state) safe.state = state;
  for (const key of ["announcedAtMs", "applyAtMs", "holdUntilMs", "forceAtMs", "updatedAtMs"]) {
    const item = value[key];
    if (typeof item === "number" && Number.isSafeInteger(item) && item >= 0) safe[key] = item;
  }
  return Object.keys(safe).length > 0 ? safe : null;
}

function projectScheduleInstall(value: Record<string, unknown>): Record<string, unknown> | null {
  const safe: Record<string, unknown> = {};
  const kind = readNonEmptyString(value.kind);
  if (kind) safe.kind = kind;
  const git = value.git;
  if (isRecord(git)) {
    const gitSafe: Record<string, unknown> = {};
    const status = readNonEmptyString(git.status);
    const reason = readNonEmptyString(git.reason);
    const currentSha = readNonEmptyString(git.currentSha);
    if (status) gitSafe.status = status;
    if (reason) gitSafe.reason = reason;
    if (currentSha) gitSafe.currentSha = currentSha;
    for (const key of ["commitsBehind", "commitsAhead"]) {
      const item = git[key];
      if (typeof item === "number" && Number.isSafeInteger(item) && item >= 0) gitSafe[key] = item;
    }
    if (Object.keys(gitSafe).length > 0) safe.git = gitSafe;
  }
  return Object.keys(safe).length > 0 ? safe : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
