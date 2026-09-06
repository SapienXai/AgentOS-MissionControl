import { OPENCLAW_RECOMMENDED_VERSION, OPENCLAW_SUPPORTED_BASELINE_VERSION } from "@/lib/openclaw/versions";
import { compareVersionStrings } from "@/lib/openclaw/domains/control-plane-normalization";
import type {
  MissionControlSnapshot,
  OpenClawUpdateDecision,
  OpenClawServerMethodContractDiffReport,
  OpenClawUpdateSafetyCheck,
  OpenClawUpdateSafetyCheckStatus,
  OpenClawUpdateSafetyReport
} from "@/lib/openclaw/types";

type BuildOpenClawUpdatePreflightReportInput = {
  snapshot: MissionControlSnapshot;
  targetVersion: string;
  decision: OpenClawUpdateDecision;
  rollbackSnapshotAvailable: boolean;
  serverMethodContractDiff?: OpenClawServerMethodContractDiffReport | null;
  generatedAt?: Date;
};

export function buildOpenClawUpdatePreflightReport(
  input: BuildOpenClawUpdatePreflightReportInput
): OpenClawUpdateSafetyReport {
  const diagnostics = input.snapshot.diagnostics;
  const compatibilityStatus = diagnostics.compatibilityReport?.status ?? "unknown";
  const fallbackCount = diagnostics.transport?.fallbackTotal ?? 0;
  const unsupportedOperationCount = diagnostics.capabilityMatrix?.unsupportedGatewayMethods.length ?? 0;
  const degradedSurfaceCount =
    diagnostics.capabilityMatrix?.degradedFeatures?.length ??
    diagnostics.compatibilityReport?.summary.degradedSurfaces.length ??
    0;
  const nativeCoverage = diagnostics.compatibilityReport
    ? `${diagnostics.compatibilityReport.summary.nativeGatewayCoveragePercent}% (${diagnostics.compatibilityReport.summary.nativeGatewayCoverageLabel})`
    : "Unknown";
  const protocol = diagnostics.capabilityMatrix?.compatibility?.protocol.version
    ? `v${diagnostics.capabilityMatrix.compatibility.protocol.version}`
    : diagnostics.capabilityMatrix?.gatewayProtocolVersion
      ? `v${diagnostics.capabilityMatrix.gatewayProtocolVersion}`
      : diagnostics.transport?.protocolVersion
        ? `v${diagnostics.transport.protocolVersion}`
        : "Unknown";
  const nativeAuth = diagnostics.capabilityMatrix?.authMode
    ? diagnostics.capabilityMatrix.authMode
    : diagnostics.runtimeIssues.some((issue) => issue.type === "scope_upgrade_pending")
      ? "Scope approval pending"
      : "Unknown";
  const modelReadiness = diagnostics.modelReadiness.ready
    ? "Ready"
    : diagnostics.modelReadiness.issues[0] ?? "Unknown";
  const installedBelowRequiredBaseline = Boolean(
    diagnostics.version && compareVersionStrings(diagnostics.version, OPENCLAW_SUPPORTED_BASELINE_VERSION) < 0
  );
  const isCertifiedRecoveryTarget = Boolean(
    diagnostics.version &&
      input.decision.status === "certified" &&
      compareVersionStrings(diagnostics.version, input.targetVersion) > 0
  );
  const certifiedRecoveryMissingSnapshot = isCertifiedRecoveryTarget && !input.rollbackSnapshotAvailable;
  const hasPendingScopeApproval = diagnostics.runtimeIssues.some((issue) => issue.type === "scope_upgrade_pending");
  const activeRuntimeCount = (input.snapshot.runtimes ?? []).filter((runtime) => runtime.status === "running").length;
  const activeTaskCount = (input.snapshot.tasks ?? []).filter((task) => task.status === "running" || task.status === "queued").length;
  const activeWorkloadCount = activeRuntimeCount + activeTaskCount;
  const hasGatewayReachability = diagnostics.installed && diagnostics.loaded && diagnostics.rpcOk;
  const gatewayReachabilityStatus = hasGatewayReachability
    ? "safe"
    : input.decision.requiresExplicitOptIn || isCertifiedRecoveryTarget
      ? "warning"
      : "blocker";
  const pendingScopeStatus = hasPendingScopeApproval
    ? input.decision.requiresExplicitOptIn || isCertifiedRecoveryTarget
      ? "warning"
      : "blocker"
    : "unknown";

  const checks: OpenClawUpdateSafetyCheck[] = [
    createCheck({
      id: "installed-version",
      label: "Installed OpenClaw version",
      status: diagnostics.version
        ? installedBelowRequiredBaseline
          ? "warning"
          : "safe"
        : "blocker",
      message: diagnostics.version
        ? installedBelowRequiredBaseline
          ? `Current OpenClaw version is v${diagnostics.version}, below the AgentOS required baseline. Updating to v${input.targetVersion} will bring the runtime to the supported baseline.`
          : `Current OpenClaw version is v${diagnostics.version}.`
        : "AgentOS could not detect the installed OpenClaw version."
    }),
    createCheck({
      id: "recommended-baseline",
      label: "AgentOS required baseline",
      status: "safe",
      message: `OpenClaw ${OPENCLAW_SUPPORTED_BASELINE_VERSION}+ required. Recommended version: v${OPENCLAW_RECOMMENDED_VERSION}.`
    }),
    createCheck({
      id: "manifest-decision",
      label: "Compatibility manifest decision",
      status: classifyDecisionStatus(input.decision),
      message: input.decision.reason
    }),
    ...(input.serverMethodContractDiff
      ? [createCheck({
          id: "server-method-contract",
          label: "Gateway server-method contract",
          status: input.serverMethodContractDiff.status,
          message: input.serverMethodContractDiff.error
            ? `${input.serverMethodContractDiff.summary} ${input.serverMethodContractDiff.error}`
            : input.serverMethodContractDiff.summary
        })]
      : []),
    createCheck({
      id: "gateway-reachability",
      label: "Current Gateway reachability",
      status: gatewayReachabilityStatus,
      message: hasGatewayReachability
          ? "The current OpenClaw Gateway is reachable and loaded."
          : input.decision.requiresExplicitOptIn
            ? "The current OpenClaw Gateway is not ready. Advanced install-and-verify may proceed through the OpenClaw CLI, then must prove Gateway health post-update."
            : isCertifiedRecoveryTarget
              ? "The current OpenClaw Gateway is not ready. Certified recovery may proceed through the OpenClaw CLI, then must prove Gateway health post-update."
            : "The current OpenClaw Gateway is not ready. Repair Gateway access before updating."
    }),
    createCheck({
      id: "gateway-protocol",
      label: "Native Gateway protocol",
      status: diagnostics.capabilityMatrix?.compatibility?.protocol.status === "compatible"
        ? "safe"
        : diagnostics.capabilityMatrix?.compatibility?.protocol.status === "unsupported"
          ? "blocker"
          : "unknown",
      message: `Connected protocol: ${protocol}.`
    }),
    createCheck({
      id: "native-coverage",
      label: "Native Gateway coverage",
      status: compatibilityStatus === "incompatible"
        ? "blocker"
        : fallbackCount > 0 || degradedSurfaceCount > 0 || unsupportedOperationCount > 0
          ? "warning"
          : compatibilityStatus === "unknown"
            ? "unknown"
            : "safe",
      message: `Compatibility ${compatibilityStatus}; native coverage ${nativeCoverage}; CLI fallback count ${fallbackCount}.`
    }),
    createCheck({
      id: "config-patch",
      label: "Config read and patch support",
      status: diagnostics.capabilityMatrix?.configPatch === "supported" ? "safe" : "warning",
      message:
        diagnostics.capabilityMatrix?.configPatch === "supported"
          ? "Gateway config patch support is available."
          : "Gateway config patch support is unavailable or unknown; rollback may rely on saved config metadata."
    }),
    createCheck({
      id: "model-readiness",
      label: "Model readiness",
      status: diagnostics.modelReadiness.ready ? "safe" : "warning",
      message: diagnostics.modelReadiness.ready
        ? "Configured models are ready."
        : `Model readiness needs attention: ${modelReadiness}.`
    }),
    createCheck({
      id: "native-auth-scopes",
      label: "Native auth and scopes",
      status: pendingScopeStatus,
      message: hasPendingScopeApproval
        ? input.decision.requiresExplicitOptIn
          ? "A pending OpenClaw scope approval remains a certification risk, but advanced install-and-verify can proceed and will validate post-update behavior."
          : isCertifiedRecoveryTarget
            ? "A pending OpenClaw scope approval remains a recovery risk, but returning to the certified baseline can proceed and will validate post-update behavior."
          : "A pending OpenClaw scope approval must be resolved before a normal certified update."
        : `Native auth state: ${nativeAuth}.`
    }),
    createCheck({
      id: "runtime-issues",
      label: "Current runtime issues",
      status: diagnostics.runtimeIssues.some((issue) => issue.severity === "blocked" || issue.severity === "action_required")
        ? "warning"
        : "safe",
      message: diagnostics.runtimeIssues.length
        ? `${diagnostics.runtimeIssues.length} runtime issue(s) are currently visible in Runtime Inbox.`
        : "No active runtime issues are currently visible."
    }),
    createCheck({
      id: "active-workloads",
      label: "Active workloads",
      status: activeWorkloadCount > 0 ? "warning" : "safe",
      message: activeWorkloadCount > 0
        ? `${activeRuntimeCount} running runtime(s) and ${activeTaskCount} running or queued task(s) may be interrupted by the Gateway restart.`
        : "No running runtimes or queued tasks were detected."
    }),
    createCheck({
      id: "rollback-metadata",
      label: "Rollback metadata",
      status: input.rollbackSnapshotAvailable
        ? "safe"
        : certifiedRecoveryMissingSnapshot
          ? "blocker"
          : "warning",
      message: input.rollbackSnapshotAvailable
        ? "A previous rollback snapshot is available."
        : certifiedRecoveryMissingSnapshot
          ? "Certified recovery needs a saved rollback snapshot because OpenClaw may reject restarting an older binary with config written by a newer version."
        : "No previous rollback snapshot exists yet; AgentOS will create one before mutating OpenClaw."
    })
  ];

  const safeChecks = checks.filter((check) => check.status === "safe");
  const warnings = checks.filter((check) => check.status === "warning");
  const blockers = checks.filter((check) => check.status === "blocker");
  const unknowns = checks.filter((check) => check.status === "unknown");
  const canAttemptUpdate = blockers.length === 0 && input.decision.allowed;
  const requiresExplicitConfirmation =
    input.decision.requiresExplicitOptIn || input.decision.status !== "certified" || isCertifiedRecoveryTarget;

  return {
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    targetVersion: input.targetVersion,
    currentVersion: diagnostics.version ?? null,
    recommendedVersion: OPENCLAW_RECOMMENDED_VERSION,
    supportedBaselineVersion: OPENCLAW_SUPPORTED_BASELINE_VERSION,
    decision: input.decision,
    canAttemptUpdate,
    requiresExplicitConfirmation,
    rollbackSnapshotAvailable: input.rollbackSnapshotAvailable,
    serverMethodContractDiff: input.serverMethodContractDiff ?? null,
    recommendedNextAction: resolveRecommendedNextAction({
      canAttemptUpdate,
      decision: input.decision,
      warnings,
      unknowns,
      blockers
    }),
    safeChecks,
    warnings,
    blockers,
    unknowns,
    summary: {
      gatewayReachable: Boolean(diagnostics.installed && diagnostics.loaded && diagnostics.rpcOk),
      gatewayProtocol: protocol,
      nativeAuth,
      modelReadiness,
      nativeGatewayCoverage: nativeCoverage,
      cliFallbackCount: fallbackCount,
      runtimeIssueCount: diagnostics.runtimeIssues.length,
      unsupportedOperationCount,
      degradedSurfaceCount
    }
  };
}

function createCheck(input: OpenClawUpdateSafetyCheck) {
  return input;
}

function classifyDecisionStatus(decision: OpenClawUpdateDecision): OpenClawUpdateSafetyCheckStatus {
  if (!decision.allowed || decision.requiresAgentOsUpdate || decision.status === "blocked") {
    return "blocker";
  }

  if (decision.status === "candidate" || decision.status === "unknown" || decision.requiresExplicitOptIn) {
    return "warning";
  }

  return decision.status === "certified" ? "safe" : "unknown";
}

function resolveRecommendedNextAction(input: {
  canAttemptUpdate: boolean;
  decision: OpenClawUpdateDecision;
  warnings: OpenClawUpdateSafetyCheck[];
  unknowns: OpenClawUpdateSafetyCheck[];
  blockers: OpenClawUpdateSafetyCheck[];
}) {
  if (input.blockers.length > 0) {
    return `Do not update yet. Resolve blocker: ${input.blockers[0]?.message}`;
  }

  if (!input.canAttemptUpdate) {
    return input.decision.reason;
  }

  if (input.decision.status === "certified" && input.warnings.length === 0 && input.unknowns.length === 0) {
    return "Certified path is clear. AgentOS can apply this update after operator confirmation.";
  }

  if (input.decision.status === "certified") {
    return "Certified path is allowed, but review warnings and unknowns before applying the update.";
  }

  return "This target requires explicit operator risk acceptance before AgentOS can attempt the update.";
}
