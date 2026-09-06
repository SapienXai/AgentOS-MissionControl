import "server-only";

import { createErrorSnapshot } from "@/lib/openclaw/fallback";
import { getRecentOpenClawCommandDiagnostics, getResolvedOpenClawBin } from "@/lib/openclaw/cli";
import { settleGatewayStatusPayloadFromOpenClaw } from "@/lib/openclaw/adapter/gateway-payloads";
import { GatewayStatusCache } from "@/lib/openclaw/client/gateway-status-cache";
import { settleAgentConfigFromStateFile } from "@/lib/openclaw/state/agent-config-payload";
import { getOpenClawStateRootPath } from "@/lib/openclaw/state/paths";
import { inspectOpenClawRuntimeState } from "@/lib/openclaw/state/runtime-state";
import { buildRuntimeDiagnosticsFromState } from "@/lib/openclaw/adapter/runtime-diagnostics-adapter";
import {
  buildModelsPayloadFromFallbackSources,
  buildModelStatusFromAgentConfig
} from "@/lib/openclaw/adapter/model-adapter";
import {
  buildOpenClawBinarySelectionSnapshot,
  readOpenClawBinarySelection
} from "@/lib/openclaw/binary-selection";
import { getCachedOpenClawCapabilityMatrix } from "@/lib/openclaw/application/capability-matrix-service";
import type {
  GatewayStatusPayload
} from "@/lib/openclaw/client/gateway-client";
import { getOpenClawGatewayClient } from "@/lib/openclaw/client/gateway-client-factory";
import { filterActiveOpenClawGatewayFallbackDiagnostics } from "@/lib/openclaw/client/gateway-diagnostic-activity";
import { getOpenClawGatewayOperationLabel } from "@/lib/openclaw/client/gateway-compatibility";
import { resolveModelReadiness } from "@/lib/openclaw/domains/control-plane-normalization";
import {
  getLatestRuntimeSmokeTest,
  type MissionControlSettings
} from "@/lib/openclaw/domains/control-plane-settings";
import type { MissionControlSnapshot } from "@/lib/openclaw/types";
import {
  MISSION_CONTROL_MISSION_PRESETS,
  resolveWorkspaceRoot
} from "@/lib/openclaw/application/mission-control/snapshot-utils";

export async function buildSystemReadinessSnapshot({
  generation,
  settings,
  localGatewayStatus,
  openclawInstalled,
  configuredWorkspaceRoot,
  gatewayStatusCache
}: {
  generation: number;
  settings: MissionControlSettings;
  localGatewayStatus: GatewayStatusPayload | null;
  openclawInstalled: boolean;
  configuredWorkspaceRoot: string | null;
  gatewayStatusCache: GatewayStatusCache;
}): Promise<MissionControlSnapshot> {
  const gatewayStatusResult = await settleGatewayStatusPayloadFromOpenClaw(3_000);
  const gatewayStatus = gatewayStatusCache.resolve(gatewayStatusResult).value ?? localGatewayStatus;
  const stateRoot = getOpenClawStateRootPath();
  const agentConfigResult = await settleAgentConfigFromStateFile(stateRoot);
  const agentConfig = agentConfigResult.status === "fulfilled" ? agentConfigResult.value : [];
  const runtimeState = await inspectOpenClawRuntimeState(
    stateRoot,
    agentConfig.map((agent) => agent.id).filter(Boolean),
    {
      agentDirs: Object.fromEntries(
        agentConfig
          .filter((agent) => agent.id)
          .map((agent) => [agent.id, agent.agentDir])
      )
    }
  );
  const runtimeDiagnostics = buildRuntimeDiagnosticsFromState(
    runtimeState,
    getLatestRuntimeSmokeTest(settings)
  );
  const modelStatus = buildModelStatusFromAgentConfig(agentConfig);
  const localModels = buildModelsPayloadFromFallbackSources(agentConfig, modelStatus);
  const configuredModelIds = agentConfig
    .map((agent) => agent.model?.trim())
    .filter((modelId): modelId is string => Boolean(modelId));
  const modelReadiness = resolveModelReadiness(localModels.models, modelStatus, configuredModelIds);
  const rpcOk = Boolean(gatewayStatus?.rpc?.ok);
  const loaded = Boolean(gatewayStatus?.service?.loaded || rpcOk);
  const ready = openclawInstalled && rpcOk && runtimeDiagnostics.stateWritable && runtimeDiagnostics.sessionStoreWritable;
  const transport = getOpenClawGatewayClient()?.getDiagnostics?.();
  const gatewayFallbackDiagnostics = (transport?.recentFallbackDiagnostics ?? []).map((entry) => ({
    ...entry,
    operationLabel: getOpenClawGatewayOperationLabel(entry.operation)
  }));
  const activeGatewayFallbackDiagnostics = filterActiveOpenClawGatewayFallbackDiagnostics(
    gatewayFallbackDiagnostics,
    transport
  );
  const gatewayFallbackIssues = activeGatewayFallbackDiagnostics.map(
    (entry) => `gateway.${entry.operation}: Gateway-first request fell back to CLI (${entry.kind}): ${entry.issue} Recovery: ${entry.recovery}`
  );
  const issues = [
    rpcOk ? null : "OpenClaw Gateway RPC is not ready.",
    ...runtimeDiagnostics.issues,
    ...gatewayFallbackIssues
  ].filter((issue): issue is string => Boolean(issue));
  const base = createErrorSnapshot(issues[0] ?? "OpenClaw system readiness snapshot.", {
    installed: openclawInstalled,
    loaded,
    rpcOk
  });

  return {
    ...base,
    generatedAt: new Date().toISOString(),
    revision: generation,
    mode: "live",
    diagnostics: {
      ...base.diagnostics,
      installed: openclawInstalled,
      loaded,
      rpcOk,
      health: ready ? "healthy" : openclawInstalled ? "degraded" : "offline",
      workspaceRoot: resolveWorkspaceRoot(configuredWorkspaceRoot),
      configuredWorkspaceRoot,
      gatewayUrl: gatewayStatus?.gateway?.probeUrl ?? base.diagnostics.gatewayUrl,
      bindMode: gatewayStatus?.gateway?.bindMode,
      port: gatewayStatus?.gateway?.port,
      serviceLabel: gatewayStatus?.service?.label,
      openClawBinarySelection: buildOpenClawBinarySelectionSnapshot(
        await readOpenClawBinarySelection(),
        getResolvedOpenClawBin()
      ),
      modelReadiness,
      capabilityMatrix: getCachedOpenClawCapabilityMatrix() ?? undefined,
      gatewayFallbackDiagnostics,
      gatewayFallbackReasons: activeGatewayFallbackDiagnostics.map(
        (entry) => `${entry.operationLabel} (${entry.operation}): ${entry.kind}: ${entry.issue} Recovery: ${entry.recovery}`
      ),
      runtime: runtimeDiagnostics,
      commandHistory: getRecentOpenClawCommandDiagnostics(),
      transport,
      issues
    },
    missionPresets: MISSION_CONTROL_MISSION_PRESETS
  };
}
