import type {
  GatewayStatusPayload,
  StatusPayload
} from "@/lib/openclaw/client/gateway-client";
import { isDeferredPayloadResult } from "@/lib/openclaw/client/payload-cache";
import {
  collectIssues,
  compareVersionStrings,
  normalizeOptionalValue,
  normalizeUpdateError,
  resolveDiagnosticHealth,
  resolveUpdateInfo
} from "@/lib/openclaw/domains/control-plane-normalization";
import type {
  MissionControlSnapshot,
  ModelReadiness,
  OpenClawBinarySelection,
  OpenClawCommandDiagnostic
} from "@/lib/openclaw/types";

type PayloadReuseState = {
  reusedCachedValue: boolean;
};

export function buildSecurityWarnings(status: StatusPayload | undefined) {
  return (
    status?.securityAudit?.findings
      ?.filter((entry) => entry.severity === "warn")
      .map((entry) => entry.title || entry.detail || "Security warning") ?? []
  );
}

export function buildVersionDiagnostics(input: {
  status: StatusPayload | undefined;
  fallbackVersion?: string;
}) {
  const currentVersion =
    normalizeOptionalValue(
      input.status?.runtimeVersion ||
        input.status?.overview?.version ||
        input.status?.version
    ) ??
    input.fallbackVersion ??
    undefined;
  const latestVersion = normalizeOptionalValue(input.status?.update?.registry?.latestVersion ?? undefined);
  const updateError = normalizeUpdateError(input.status?.update?.registry?.error ?? undefined);
  const updateAvailable =
    currentVersion && latestVersion ? compareVersionStrings(latestVersion, currentVersion) > 0 : undefined;
  const updateInfo = resolveUpdateInfo({
    currentVersion,
    latestVersion,
    updateError,
    legacyInfo: input.status?.overview?.update
  });

  return {
    currentVersion,
    latestVersion,
    updateAvailable,
    updateError,
    updateInfo
  };
}

export function buildGatewayDiagnostics(input: {
  gatewayStatus: GatewayStatusPayload | undefined;
  status: StatusPayload | undefined;
  configuredWorkspaceRoot: string | null;
  workspaceRoot: string;
  configuredGatewayUrl?: string | null;
  hasOpenClawSignal: boolean;
  securityWarnings: string[];
  runtimeDiagnostics: MissionControlSnapshot["diagnostics"]["runtime"];
  openClawBinarySelection: OpenClawBinarySelection;
  modelReadiness: ModelReadiness;
  commandHistory?: OpenClawCommandDiagnostic[];
  issues: string[];
  versionDiagnostics: ReturnType<typeof buildVersionDiagnostics>;
}): MissionControlSnapshot["diagnostics"] {
  return {
    installed: true,
    loaded: Boolean(input.gatewayStatus?.service?.loaded),
    rpcOk: Boolean(input.gatewayStatus?.rpc?.ok),
    health: resolveDiagnosticHealth({
      rpcOk: input.gatewayStatus?.rpc?.ok,
      warningCount: input.securityWarnings.length,
      runtimeIssueCount: input.runtimeDiagnostics.issues.length,
      hasOpenClawSignal: input.hasOpenClawSignal
    }),
    version: input.versionDiagnostics.currentVersion,
    latestVersion: input.versionDiagnostics.latestVersion,
    updateAvailable: input.versionDiagnostics.updateAvailable,
    updateError: input.versionDiagnostics.updateError,
    updateRoot: normalizeOptionalValue(input.status?.update?.root ?? undefined),
    updateInstallKind: normalizeOptionalValue(input.status?.update?.installKind ?? undefined),
    updatePackageManager: normalizeOptionalValue(input.status?.update?.packageManager ?? undefined),
    workspaceRoot: input.workspaceRoot,
    configuredWorkspaceRoot: input.configuredWorkspaceRoot,
    dashboardUrl: `http://127.0.0.1:${input.gatewayStatus?.gateway?.port ?? 18789}/`,
    gatewayUrl: input.gatewayStatus?.gateway?.probeUrl || "ws://127.0.0.1:18789",
    configuredGatewayUrl: input.configuredGatewayUrl ?? null,
    bindMode: input.gatewayStatus?.gateway?.bindMode,
    port: input.gatewayStatus?.gateway?.port,
    updateChannel: input.status?.updateChannel || "stable",
    updateInfo: input.versionDiagnostics.updateInfo,
    serviceLabel: input.gatewayStatus?.service?.label,
    openClawBinarySelection: input.openClawBinarySelection,
    modelReadiness: input.modelReadiness,
    runtime: input.runtimeDiagnostics,
    commandHistory: input.commandHistory,
    securityWarnings: input.securityWarnings,
    issues: input.issues
  };
}

export function buildDiagnosticIssues(input: {
  payloadResults: Record<string, PromiseSettledResult<unknown>>;
  gatewayStatusRejectedWithCachedValue: boolean;
  payloadReuse: Record<string, PayloadReuseState>;
  runtimeIssues: string[];
}) {
  return [
    ...collectIssues(
      Object.fromEntries(
        Object.entries(input.payloadResults).filter(([, result]) => !isDeferredPayloadResult(result))
      )
    ),
    ...(input.gatewayStatusRejectedWithCachedValue
      ? ["gatewayStatus: Reusing the last successful gateway status after a transient OpenClaw check failure."]
      : []),
    ...Object.entries(input.payloadReuse)
      .map(([label, state]) => describeCachedPayloadReuse(label, state.reusedCachedValue))
      .filter((issue): issue is string => Boolean(issue)),
    ...input.runtimeIssues
  ];
}

function describeCachedPayloadReuse(label: string, reusedCachedValue: boolean) {
  return reusedCachedValue
    ? `${label}: Reusing the last successful payload while a slow OpenClaw command refreshes in the background.`
    : null;
}
