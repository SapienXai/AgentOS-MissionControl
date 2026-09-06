import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  LOCAL_OPENCLAW_COMPATIBILITY_MANIFEST,
  resolveOpenClawUpdateCompatibilitySnapshot,
  resolveOpenClawUpdateDecision,
  shouldShowDefaultOpenClawUpdate,
  type OpenClawCompatibilityManifest
} from "@/lib/openclaw/update-compatibility";
import { buildOpenClawUpdatePreflightReport } from "@/lib/openclaw/update-safety";
import type { MissionControlSnapshot } from "@/lib/openclaw/types";
import {
  OPENCLAW_RECOMMENDED_VERSION,
  OPENCLAW_SUPPORTED_BASELINE_VERSION
} from "@/lib/openclaw/versions";

const manifest: OpenClawCompatibilityManifest = {
  schemaVersion: 1,
  source: "override",
  recommendedVersion: "2026.9.1",
  minRequiredAgentOsVersion: "0.7.2",
  versions: [
    {
      version: "2026.9.1",
      status: "certified",
      reason: "Certified stable baseline."
    },
    {
      version: "2026.9.10",
      status: "candidate",
      reason: "Preview validation in progress."
    },
    {
      version: "2026.9.3",
      status: "blocked",
      reason: "Known Gateway regression."
    },
    {
      version: "2026.9.2",
      status: "certified",
      minRequiredAgentOsVersion: "0.8.0",
      reason: "Requires newer AgentOS protocol support."
    }
  ]
};

test("certified OpenClaw version is allowed in the normal update path", () => {
  const decision = resolveOpenClawUpdateDecision({
    manifest,
    agentOsVersion: "0.7.2",
    targetVersion: "2026.9.1",
    mode: "recommended"
  });

  assert.equal(decision.status, "certified");
  assert.equal(decision.allowed, true);
  assert.equal(decision.defaultVisible, true);
  assert.equal(shouldShowDefaultOpenClawUpdate({ currentVersion: "2026.6.7", decision }), true);
});

test("OpenClaw versions below the required baseline are blocked", () => {
  const decision = resolveOpenClawUpdateDecision({
    manifest,
    agentOsVersion: "0.7.2",
    targetVersion: "2026.7.1",
    mode: "advanced"
  });

  assert.equal(decision.status, "blocked");
  assert.equal(decision.allowed, false);
  assert.equal(decision.defaultVisible, false);
  assert.match(decision.reason, /AgentOS requires OpenClaw 2026\.9\.1 or newer/);
});

test("candidate OpenClaw version requires explicit opt-in", () => {
  const defaultDecision = resolveOpenClawUpdateDecision({
    manifest,
    agentOsVersion: "0.7.2",
    targetVersion: "2026.9.10",
    mode: "recommended"
  });
  const previewDecision = resolveOpenClawUpdateDecision({
    manifest,
    agentOsVersion: "0.7.2",
    targetVersion: "2026.9.10",
    mode: "candidate"
  });

  assert.equal(defaultDecision.status, "candidate");
  assert.equal(defaultDecision.allowed, false);
  assert.equal(defaultDecision.requiresExplicitOptIn, true);
  assert.equal(previewDecision.allowed, true);
});

test("unknown OpenClaw version is hidden from the default update path", () => {
  const decision = resolveOpenClawUpdateDecision({
    manifest,
    agentOsVersion: "0.7.2",
    targetVersion: "2027.0.0",
    mode: "recommended"
  });

  assert.equal(decision.status, "unknown");
  assert.equal(decision.allowed, false);
  assert.equal(decision.defaultVisible, false);
});

test("Compatibility Lab report generation keeps unknown latest in report-only policy mode", () => {
  const settingsSource = readFileSync(
    path.join(process.cwd(), "components/mission-control/settings-control-center.tsx"),
    "utf8"
  );

  assert.match(settingsSource, /\/api\/openclaw\/compatibility-lab/);
  assert.match(settingsSource, /action:\s*"report"/);
  assert.match(settingsSource, /mode:\s*"recommended"/);
  assert.doesNotMatch(settingsSource, /action:\s*"report"[\s\S]{0,160}mode:\s*"advanced"/);
});

test("Compatibility Lab route exposes report, fix bundle, and certify actions without update execution", () => {
  const routeSource = readFileSync(
    path.join(process.cwd(), "app/api/openclaw/compatibility-lab/route.ts"),
    "utf8"
  );

  assert.match(routeSource, /"report"/);
  assert.match(routeSource, /"fix-bundle"/);
  assert.match(routeSource, /"certify"/);
  assert.match(routeSource, /promoteOpenClawCompatibilityCertification/);
  assert.doesNotMatch(routeSource, /openclaw update --tag|buildOpenClawUpdateArgs|spawn\(/);
});

test("Compatibility Lab UI requires target install comparison before certification promotion", () => {
  const settingsSource = readFileSync(
    path.join(process.cwd(), "components/mission-control/settings-control-center.tsx"),
    "utf8"
  );

  assert.match(settingsSource, /Run target certification/);
  assert.match(settingsSource, /Install, compare, smoke/);
  assert.match(settingsSource, /onOpenUpdateDialog\(targetVersion,\s*"advanced"\)/);
  assert.match(settingsSource, /Certify target/);
  assert.match(settingsSource, /action:\s*"certify"/);
  assert.match(settingsSource, /local audited compatibility manifest override/);
});

test("round-trip certification persists server-side scorecard evidence for promotion", () => {
  const routeSource = readFileSync(
    path.join(process.cwd(), "app/api/update/route.ts"),
    "utf8"
  );

  assert.match(routeSource, /persistOpenClawCertificationScorecard/);
  assert.match(routeSource, /certificationScorecard/);
});

test("blocked OpenClaw version is rejected with the manifest reason", () => {
  const decision = resolveOpenClawUpdateDecision({
    manifest,
    agentOsVersion: "0.7.2",
    targetVersion: "2026.9.3",
    mode: "advanced"
  });

  assert.equal(decision.status, "blocked");
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /Known Gateway regression/);
});

test("minimum AgentOS version blocks OpenClaw update", () => {
  const decision = resolveOpenClawUpdateDecision({
    manifest,
    agentOsVersion: "0.7.2",
    targetVersion: "2026.9.2",
    mode: "recommended"
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.requiresAgentOsUpdate, true);
  assert.equal(decision.minRequiredAgentOsVersion, "0.8.0");
});

test("offline mode uses local fallback manifest", () => {
  const snapshot = resolveOpenClawUpdateCompatibilitySnapshot({
    agentOsVersion: "0.7.2",
    currentVersion: "2026.6.7"
  });

  assert.equal(snapshot.manifestSource, "local-fallback");
  assert.equal(snapshot.recommendedVersion, OPENCLAW_RECOMMENDED_VERSION);
  assert.equal(snapshot.recommendedDecision.status, "certified");
  assert.equal(LOCAL_OPENCLAW_COMPATIBILITY_MANIFEST.versions[0]?.version, OPENCLAW_SUPPORTED_BASELINE_VERSION);
  assert.equal(
    LOCAL_OPENCLAW_COMPATIBILITY_MANIFEST.versions.some(
      (entry) => entry.version === OPENCLAW_RECOMMENDED_VERSION && entry.status === "certified"
    ),
    true
  );
});

test("failed post-update verification keeps the target installed by default", () => {
  const routeSource = readFileSync(path.join(process.cwd(), "app/api/update/route.ts"), "utf8");

  assert.match(routeSource, /rollbackPolicy:\s*z\.enum\(\["automatic", "manual"\]\)\.default\("manual"\)/);
  assert.match(routeSource, /OpenClaw v\$\{targetVersion\} remains installed because automatic rollback is disabled/);
  assert.match(routeSource, /if \(smokeTest\.status === "failed"\)/);
  assert.match(routeSource, /if \(certifiedTarget \|\| updateRequest\.rollbackPolicy === "manual"\) \{/);
  assert.match(routeSource, /rollbackToCertifiedBaseline:\s*"not-run"/);
  assert.match(routeSource, /compareVersionStrings\(currentVersion, rollbackVersion\) === 0/);
  assert.match(routeSource, /restoreOpenClawRollbackConfigSnapshot\(rollbackSnapshot\)/);
  assert.doesNotMatch(routeSource, /manual rollback was selected/);
});

test("failed automatic rollback exposes a restore command for the rollback snapshot", () => {
  const routeSource = readFileSync(path.join(process.cwd(), "app/api/update/route.ts"), "utf8");

  assert.match(routeSource, /function buildOpenClawRollbackManualCommand/);
  assert.match(routeSource, /parseOpenClawVersion/);
  assert.match(routeSource, /function normalizeOpenClawCommandVersionOutput/);
  assert.match(routeSource, /this command is running\\s\+v\?/);
  assert.match(routeSource, /const restoringToOlderVersion = Boolean/);
  assert.match(routeSource, /compareVersionStrings\(currentVersion, rollbackVersion\) > 0/);
  assert.match(routeSource, /const preRestore = await restoreOpenClawRollbackConfigSnapshot\(rollbackSnapshot\)/);
  assert.match(routeSource, /buildOpenClawDowngradeConfigBlockerManualCommand\(\s*formatOpenClawCommand\(openClawBin, \[\]\),\s*rollbackSnapshot\.version\s*\)/);
  assert.match(routeSource, /recoveryCommand: rollback\.ok \? undefined : buildOpenClawRollbackManualCommand\(openClawBin, rollbackSnapshot\)/);
  assert.match(routeSource, /manualCommand: rollback\.ok \? undefined : buildOpenClawRollbackManualCommand\(openClawBin, rollbackSnapshot\)/);
  assert.match(routeSource, /"gateway", "install", "--force"/);
  assert.match(routeSource, /Gateway service reinstall failed/);
});

test("advanced round-trip certification route is explicit and evidence-backed", () => {
  const routeSource = readFileSync(path.join(process.cwd(), "app/api/update/route.ts"), "utf8");
  const typeSource = readFileSync(path.join(process.cwd(), "lib/openclaw/types.ts"), "utf8");

  assert.match(routeSource, /"certify-round-trip"/);
  assert.match(routeSource, /Round-trip certification requires advanced update mode/);
  assert.match(routeSource, /runOpenClawCertificationRoundTrip/);
  assert.match(routeSource, /roundTripEvidence: roundTrip\.evidence/);
  assert.match(routeSource, /phase: "baseline-restore"/);
  assert.match(routeSource, /"target-install"/);
  assert.match(routeSource, /"target-verify"/);
  assert.match(routeSource, /"rollback-verify"/);
  assert.match(routeSource, /"final-target-verify"/);
  assert.match(typeSource, /OpenClawCertificationRoundTripEvidence/);
  assert.match(typeSource, /OpenClawPluginConfigMigrationFinding/);
});

test("preflight report blocks update when Gateway is not ready", () => {
  const decision = resolveOpenClawUpdateDecision({
    manifest,
    agentOsVersion: "0.7.2",
    targetVersion: "2026.9.1",
    mode: "recommended"
  });
  const report = buildOpenClawUpdatePreflightReport({
    snapshot: createUpdateSafetySnapshot({
      loaded: false,
      rpcOk: false
    }),
    targetVersion: "2026.9.1",
    decision,
    rollbackSnapshotAvailable: false,
    generatedAt: new Date("2026-06-14T10:00:00.000Z")
  });

  assert.equal(report.canAttemptUpdate, false);
  assert.equal(report.blockers.some((check) => check.id === "gateway-reachability"), true);
  assert.match(report.recommendedNextAction, /Do not update yet/);
});

test("preflight allows updating an older installed version to the supported baseline", () => {
  const decision = resolveOpenClawUpdateDecision({
    manifest,
    agentOsVersion: "0.7.2",
    targetVersion: "2026.9.1",
    mode: "recommended"
  });
  const report = buildOpenClawUpdatePreflightReport({
    snapshot: createUpdateSafetySnapshot({ version: "2026.8.2" }),
    targetVersion: "2026.9.1",
    decision,
    rollbackSnapshotAvailable: false,
    generatedAt: new Date("2026-06-14T10:00:00.000Z")
  });

  assert.equal(report.canAttemptUpdate, true);
  assert.equal(report.blockers.some((check) => check.id === "installed-version"), false);
  assert.equal(report.warnings.some((check) => check.id === "installed-version"), true);
  assert.match(
    report.warnings.find((check) => check.id === "installed-version")?.message ?? "",
    /updating to v2026\.9\.1 will bring the runtime to the supported baseline/i
  );
});

test("preflight blocks a target with incompatible Gateway server-method evidence", () => {
  const decision = resolveOpenClawUpdateDecision({
    manifest,
    agentOsVersion: "0.7.2",
    targetVersion: "2026.9.1",
    mode: "recommended"
  });
  const report = buildOpenClawUpdatePreflightReport({
    snapshot: createUpdateSafetySnapshot({}),
    targetVersion: "2026.9.1",
    decision,
    rollbackSnapshotAvailable: true,
    serverMethodContractDiff: {
      generatedAt: "2026-06-14T10:00:00.000Z",
      source: "github-static",
      currentVersion: "2026.6.7",
      targetVersion: "2026.9.1",
      status: "blocker",
      currentMethodCount: 10,
      targetMethodCount: 9,
      currentRegisteredMethodCount: 10,
      targetRegisteredMethodCount: 9,
      changedServerMethodFiles: ["src/gateway/server-methods/models.ts"],
      changedProtocolFiles: [],
      changes: [],
      blockerCount: 1,
      warningCount: 0,
      unknownCount: 0,
      renamedCount: 0,
      replacedCount: 0,
      summary: "A required AgentOS Gateway method is removed.",
      error: null
    }
  });

  assert.equal(report.canAttemptUpdate, false);
  assert.equal(report.blockers.some((check) => check.id === "server-method-contract"), true);
  assert.equal(report.serverMethodContractDiff?.status, "blocker");
});

test("candidate preflight remains attemptable only with explicit opt-in warning", () => {
  const decision = resolveOpenClawUpdateDecision({
    manifest,
    agentOsVersion: "0.7.2",
    targetVersion: "2026.9.10",
    mode: "candidate"
  });
  const report = buildOpenClawUpdatePreflightReport({
    snapshot: createUpdateSafetySnapshot({}),
    targetVersion: "2026.9.10",
    decision,
    rollbackSnapshotAvailable: true,
    generatedAt: new Date("2026-06-14T10:00:00.000Z")
  });

  assert.equal(report.canAttemptUpdate, true);
  assert.equal(report.requiresExplicitConfirmation, true);
  assert.equal(report.warnings.some((check) => check.id === "manifest-decision"), true);
});

test("preflight warns when active workloads may be interrupted", () => {
  const decision = resolveOpenClawUpdateDecision({
    manifest,
    agentOsVersion: "0.7.2",
    targetVersion: "2026.9.1",
    mode: "recommended"
  });
  const snapshot = createUpdateSafetySnapshot({});
  snapshot.runtimes = [{ status: "running" }] as MissionControlSnapshot["runtimes"];
  snapshot.tasks = [{ status: "queued" }] as MissionControlSnapshot["tasks"];
  const report = buildOpenClawUpdatePreflightReport({
    snapshot,
    targetVersion: "2026.9.1",
    decision,
    rollbackSnapshotAvailable: true,
    generatedAt: new Date("2026-06-14T10:00:00.000Z")
  });

  assert.equal(report.canAttemptUpdate, true);
  assert.equal(report.warnings.some((check) => check.id === "active-workloads"), true);
  assert.match(report.warnings.find((check) => check.id === "active-workloads")?.message ?? "", /interrupted/);
});

test("advanced preflight allows install-and-verify when scope approval is pending", () => {
  const decision = resolveOpenClawUpdateDecision({
    manifest,
    agentOsVersion: "0.7.2",
    targetVersion: "2026.9.4",
    mode: "advanced"
  });
  const report = buildOpenClawUpdatePreflightReport({
    snapshot: createUpdateSafetySnapshot({
      pendingScopeApproval: true
    }),
    targetVersion: "2026.9.4",
    decision,
    rollbackSnapshotAvailable: true,
    generatedAt: new Date("2026-06-14T10:00:00.000Z")
  });

  assert.equal(report.canAttemptUpdate, true);
  assert.equal(report.blockers.some((check) => check.id === "native-auth-scopes"), false);
  assert.equal(report.warnings.some((check) => check.id === "native-auth-scopes"), true);
  assert.match(report.recommendedNextAction, /explicit operator risk acceptance/);
});

test("advanced preflight treats current Gateway downtime as a post-update verification risk", () => {
  const decision = resolveOpenClawUpdateDecision({
    manifest,
    agentOsVersion: "0.7.2",
    targetVersion: "2026.9.4",
    mode: "advanced"
  });
  const report = buildOpenClawUpdatePreflightReport({
    snapshot: createUpdateSafetySnapshot({
      loaded: false,
      rpcOk: false
    }),
    targetVersion: "2026.9.4",
    decision,
    rollbackSnapshotAvailable: true,
    generatedAt: new Date("2026-06-14T10:00:00.000Z")
  });

  assert.equal(report.canAttemptUpdate, true);
  assert.equal(report.blockers.some((check) => check.id === "gateway-reachability"), false);
  assert.equal(report.warnings.some((check) => check.id === "gateway-reachability"), true);
  assert.match(
    report.warnings.find((check) => check.id === "gateway-reachability")?.message ?? "",
    /CLI.*post-update/i
  );
});

test("certified preflight still blocks normal update when scope approval is pending", () => {
  const decision = resolveOpenClawUpdateDecision({
    manifest,
    agentOsVersion: "0.7.2",
    targetVersion: "2026.9.1",
    mode: "recommended"
  });
  const report = buildOpenClawUpdatePreflightReport({
    snapshot: createUpdateSafetySnapshot({
      pendingScopeApproval: true
    }),
    targetVersion: "2026.9.1",
    decision,
    rollbackSnapshotAvailable: true,
    generatedAt: new Date("2026-06-14T10:00:00.000Z")
  });

  assert.equal(report.canAttemptUpdate, false);
  assert.equal(report.blockers.some((check) => check.id === "native-auth-scopes"), true);
});

test("certified recovery to the baseline can proceed when scope approval is pending", () => {
  const decision = resolveOpenClawUpdateDecision({
    manifest,
    agentOsVersion: "0.7.2",
    targetVersion: "2026.9.1",
    mode: "recommended"
  });
  const report = buildOpenClawUpdatePreflightReport({
    snapshot: createUpdateSafetySnapshot({
      version: "2026.9.2",
      pendingScopeApproval: true
    }),
    targetVersion: "2026.9.1",
    decision,
    rollbackSnapshotAvailable: true,
    generatedAt: new Date("2026-06-14T10:00:00.000Z")
  });

  assert.equal(report.canAttemptUpdate, true);
  assert.equal(report.requiresExplicitConfirmation, true);
  assert.equal(report.blockers.some((check) => check.id === "native-auth-scopes"), false);
  assert.equal(report.warnings.some((check) => check.id === "native-auth-scopes"), true);
  assert.match(
    report.warnings.find((check) => check.id === "native-auth-scopes")?.message ?? "",
    /returning to the certified baseline/
  );
});

test("certified recovery to the baseline requires a saved rollback snapshot", () => {
  const decision = resolveOpenClawUpdateDecision({
    manifest,
    agentOsVersion: "0.7.2",
    targetVersion: "2026.9.1",
    mode: "recommended"
  });
  const report = buildOpenClawUpdatePreflightReport({
    snapshot: createUpdateSafetySnapshot({
      version: "2026.9.2"
    }),
    targetVersion: "2026.9.1",
    decision,
    rollbackSnapshotAvailable: false,
    generatedAt: new Date("2026-06-14T10:00:00.000Z")
  });

  assert.equal(report.canAttemptUpdate, false);
  assert.equal(report.blockers.some((check) => check.id === "rollback-metadata"), true);
  assert.match(
    report.blockers.find((check) => check.id === "rollback-metadata")?.message ?? "",
    /saved rollback snapshot/
  );
});

test("certified preflight still blocks normal update when the current Gateway is down", () => {
  const decision = resolveOpenClawUpdateDecision({
    manifest,
    agentOsVersion: "0.7.2",
    targetVersion: "2026.9.1",
    mode: "recommended"
  });
  const report = buildOpenClawUpdatePreflightReport({
    snapshot: createUpdateSafetySnapshot({
      loaded: false,
      rpcOk: false
    }),
    targetVersion: "2026.9.1",
    decision,
    rollbackSnapshotAvailable: true,
    generatedAt: new Date("2026-06-14T10:00:00.000Z")
  });

  assert.equal(report.canAttemptUpdate, false);
  assert.equal(report.blockers.some((check) => check.id === "gateway-reachability"), true);
});

test("update route exposes non-mutating preflight and probe actions", () => {
  const routeSource = readFileSync(path.join(process.cwd(), "app/api/update/route.ts"), "utf8");

  assert.match(routeSource, /z\.enum\(\["preflight", "probe", "update", "rollback", "certify-round-trip"\]\)/);
  assert.match(routeSource, /buildOpenClawUpdatePreflightReport/);
  assert.match(routeSource, /runOpenClawShadowProbe/);
  assert.match(routeSource, /recordOpenClawUpdateRuntimeIssue/);
  assert.match(routeSource, /redactSecrets\(\{ report \}\)/);
});

test("Updates page requires confirmation and keeps manually selected targets installed", () => {
  const routeSource = readFileSync(path.join(process.cwd(), "app/api/update/route.ts"), "utf8");
  const updatesSource = readFileSync(
    path.join(process.cwd(), "components/operations/updates/updates-page-content.tsx"),
    "utf8"
  );

  assert.match(routeSource, /rollbackPolicy:\s*z\.enum\(\["automatic", "manual"\]\)/);
  assert.match(routeSource, /updateRequest\.rollbackPolicy === "manual"/);
  assert.match(routeSource, /remains installed because automatic rollback is disabled/);
  assert.match(updatesSource, /rollbackPolicy:\s*"manual"/);
  assert.match(updatesSource, /const requestInstall[\s\S]*setInstallTarget\(release\)/);
  assert.doesNotMatch(updatesSource, /const requestInstall[\s\S]{0,800}void runInstall\(release\)/);
  assert.match(updatesSource, /Rollback policy" value="Manual - keep target on failure/);
});

test("update route uses OpenClaw 2026.9.1+ JSON updater commands", () => {
  const routeSource = readFileSync(path.join(process.cwd(), "app/api/update/route.ts"), "utf8");

  assert.match(routeSource, /\["update", "status", "--json"\]/);
  assert.match(routeSource, /\["update", "--dry-run", "--json"\]/);
  assert.match(routeSource, /\["update", "--channel", "stable", "--yes", "--json"\]/);
  assert.match(routeSource, /\["update", "--tag", targetVersion, "--yes", "--json"\]/);
  assert.match(routeSource, /\["doctor", "--lint", "--json"\]/);
  assert.match(routeSource, /\["gateway", "status", "--deep", "--json"\]/);
  assert.doesNotMatch(routeSource, /isInstalledOpenClawBelowRequiredBaseline/);
});

test("update route treats installed target with down Gateway as unhealthy", () => {
  const routeSource = readFileSync(path.join(process.cwd(), "app/api/update/route.ts"), "utf8");

  assert.match(routeSource, /isTargetOpenClawInstalled\(snapshot, targetVersion\)/);
  assert.match(routeSource, /!isOpenClawSnapshotGatewayReady\(snapshot\)/);
  assert.match(routeSource, /OpenClaw v\$\{targetVersion\} is installed, but the Gateway is not reachable/);
});

test("update route classifies certified restore blocked by newer config", () => {
  const routeSource = readFileSync(path.join(process.cwd(), "app/api/update/route.ts"), "utf8");

  assert.match(routeSource, /isOpenClawDowngradeConfigBlocker\(failureOutput\)/);
  assert.match(routeSource, /OpenClaw certified restore blocked by newer config/);
  assert.match(routeSource, /buildOpenClawDowngradeConfigBlockerManualCommand/);
  assert.match(routeSource, /shouldUseCertifiedRollbackSnapshotRecovery/);
  assert.match(routeSource, /runCertifiedRollbackSnapshotRecovery/);
  assert.match(routeSource, /Using the saved OpenClaw rollback snapshot for certified recovery/);
  assert.match(routeSource, /restoreConfigAndRestartOpenClaw/);
  assert.match(routeSource, /resolveNewerRollbackSnapshotVersion/);
  assert.match(routeSource, /OpenClaw certified baseline blocked by newer config/);
  assert.match(routeSource, /Restore v\$\{newerRollbackSnapshotVersion\}/);
});

test("update route keeps certified targets installed when postflight only has warnings", () => {
  const routeSource = readFileSync(path.join(process.cwd(), "app/api/update/route.ts"), "utf8");

  assert.match(routeSource, /const certifiedTarget = updateDecision\.status === "certified"/);
  assert.match(routeSource, /verifyOpenClawPostUpdateCompatibility\(verifiedSnapshot,\s*\{\s*certifiedTarget\s*\}\)/);
  assert.match(routeSource, /OpenClaw certified postflight completed with warnings/);
  assert.match(routeSource, /OpenClaw certified runtime smoke needs review/);
  assert.match(routeSource, /if \(certifiedTarget \|\| updateRequest\.rollbackPolicy === "manual"\) \{/);
  assert.match(routeSource, /ok: true,\s+message: `\$\{verification\.message\} \$\{smokeFailureMessage\}\$\{targetRetentionMessage\}`/);
});

test("update dialog keeps OpenClaw output and certification scorecard inside the modal width", () => {
  const dialogSource = readFileSync(
    path.join(process.cwd(), "components/mission-control/mission-control-shell.dialogs.tsx"),
    "utf8"
  );

  assert.match(dialogSource, /overflow-x-hidden overflow-y-auto/);
  assert.match(dialogSource, /w-\[calc\(100vw-32px\)\] max-w-\[468px\]/);
  assert.match(dialogSource, /whitespace-pre-wrap break-all/);
  assert.match(dialogSource, /\[overflow-wrap:anywhere\]/);
  assert.match(dialogSource, /sm:grid-cols-\[minmax\(0,1fr\)_minmax\(0,10rem\)\]/);
  assert.match(dialogSource, /Certification scorecard/);
  assert.match(dialogSource, /Generate artifact/);
});

test("opening an update action resets stale failed update dialog state", () => {
  const shellSource = readFileSync(
    path.join(process.cwd(), "components/mission-control/mission-control-shell.tsx"),
    "utf8"
  );
  const quickSettingsSource = readFileSync(
    path.join(process.cwd(), "components/mission-control/mission-control-shell.settings.tsx"),
    "utf8"
  );
  const controlCenterSource = readFileSync(
    path.join(process.cwd(), "components/mission-control/settings-control-center.tsx"),
    "utf8"
  );

  assert.match(shellSource, /onOpenUpdateDialog: \(targetVersion, mode = "recommended"\) => \{\s+if \(updateRunState !== "running"\) \{/);
  assert.match(shellSource, /onRollbackOpenClaw: \(\) => \{\s+if \(updateRunState !== "running"\) \{/);
  assert.match(quickSettingsSource, /compareVersionStrings\(targetVersion, currentVersion\) < 0 \? "rollback" : "update"/);
  assert.match(quickSettingsSource, /Rollback available/);
  assert.match(quickSettingsSource, /isRecommendedRollback \? "Rollback" : "Update"/);
  assert.match(controlCenterSource, /compareVersionStrings\(normalizedRecommendedVersion, normalizedCurrentVersion\) < 0/);
  assert.match(controlCenterSource, /Rollback to certified/);
});

test("update dialog surfaces target blockers even when capability modes are unchanged", () => {
  const dialogSource = readFileSync(
    path.join(process.cwd(), "components/mission-control/mission-control-shell.dialogs.tsx"),
    "utf8"
  );

  assert.match(dialogSource, /capabilityBlockerRows/);
  assert.match(dialogSource, /Hard blockers/);
  assert.match(dialogSource, /target diagnostics still report capability blockers/);
});

test("update stream carries certification scorecard evidence with capability diff", () => {
  const routeSource = readFileSync(path.join(process.cwd(), "app/api/update/route.ts"), "utf8");

  assert.match(routeSource, /certificationScorecard/);
  assert.match(routeSource, /buildOpenClawUpdateCertificationScorecard/);
  assert.match(routeSource, /capabilityDiff: finalCapabilityDiff/);
});

test("capability matrix labels active and certified OpenClaw versions distinctly", () => {
  const settingsSource = readFileSync(
    path.join(process.cwd(), "components/mission-control/settings-control-center.tsx"),
    "utf8"
  );

  assert.match(settingsSource, /label="Active OpenClaw"/);
  assert.match(settingsSource, /Certified baseline/);
  assert.match(settingsSource, /wrapValue/);
  assert.match(settingsSource, /Certified baseline comparison/);
  assert.match(settingsSource, /Runtime gaps remain/);
  assert.match(settingsSource, /Capability-equivalent/);
  assert.match(settingsSource, /Not certified/);
  assert.match(settingsSource, /Capability-equivalent does not certify update, rollback, plugin, config, or runtime behavior/);
  assert.match(settingsSource, /Diff evidence missing/);
  assert.match(settingsSource, /Hard blockers/);
  assert.match(settingsSource, /badgeTone=\{summary\.missingRequiredOperationCount > 0 \? "danger"/);
});

test("rollback snapshot records compatibility summary and config hash", () => {
  const source = readFileSync(path.join(process.cwd(), "lib/openclaw/update-rollback.ts"), "utf8");

  assert.match(source, /configHash/);
  assert.match(source, /createHash\("sha256"\)/);
  assert.match(source, /compatibilitySummary/);
  assert.match(source, /decision: input\.decision/);
});

function createUpdateSafetySnapshot(input: {
  loaded?: boolean;
  rpcOk?: boolean;
  pendingScopeApproval?: boolean;
  version?: string;
}): MissionControlSnapshot {
  const version = input.version ?? "2026.9.1";

  return {
    diagnostics: {
      installed: true,
      loaded: input.loaded ?? true,
      rpcOk: input.rpcOk ?? true,
      health: "healthy",
      version,
      latestVersion: "2026.9.1",
      workspaceRoot: "/tmp/agentos",
      configuredWorkspaceRoot: null,
      dashboardUrl: "http://127.0.0.1:3000",
      gatewayUrl: "ws://127.0.0.1:18789",
      configuredGatewayUrl: null,
      openClawBinarySelection: {
        mode: "auto",
        path: null,
        resolvedPath: "openclaw",
        source: "auto",
        issue: null
      },
      modelReadiness: {
        ready: true,
        issues: [],
        defaultModel: "gpt-5",
        resolvedDefaultModel: "gpt-5",
        preferredLoginProvider: null,
        availableModelCount: 1,
        totalModelCount: 1
      },
      capabilityMatrix: {
        detectedAt: "2026-06-14T10:00:00.000Z",
        openClawVersion: version,
        gatewayProtocolVersion: "1",
        authMode: "local-token",
        supportedMethods: [],
        configSchema: "supported",
        configPatch: "supported",
        chatEvents: "supported",
        missionDispatch: "supported",
        taskFeed: "supported",
        configRead: "supported",
        diagnosticsRead: "supported",
        nativeMissionDispatch: "supported",
        nativeAgentLifecycle: "supported",
        eventBridge: "supported",
        compatibility: {
          protocol: {
            status: "compatible",
            connectedVersion: 1,
            requestedRange: { min: 1, max: 1 },
            reason: "ok"
          },
          methodContract: {
            status: "ok",
            requiredMethodCount: 0,
            supportedRequiredMethodCount: 0,
            missingRequiredMethods: [],
            missingMethodCount: 0
          },
          nativeOperationCount: 0,
          cliFallbackOperationCount: 0,
          unsupportedOperationCount: 0,
          degradedOperations: [],
          aliasOperations: []
        },
        degradedFeatures: [],
        fallbackDiagnostics: [],
        fallbackReasons: [],
        unsupportedGatewayMethods: [],
        diagnostics: []
      },
      compatibilityReport: null,
      configUpdatePacing: {
        settings: {
          mode: "respect-gateway",
          minimumIntervalMs: null
        },
        effectiveMinimumIntervalMs: 10_000,
        staleCacheAllowed: true,
        cacheState: "fresh",
        cooldownUntil: null,
        lastRefreshAt: null,
        nextRefreshAt: null,
        reason: "ok"
      },
      runtime: {
        status: "unknown",
        sessions: [],
        tasks: [],
        artifacts: [],
        approvals: []
      },
      transport: {
        mode: "native-ws",
        gatewayMode: "healthy",
        statusLabel: "Connected",
        recovery: null,
        connectionState: "connected",
        protocolVersion: 1,
        protocolRange: { min: 1, max: 1 },
        fallbackCounts: {},
        fallbackTotal: 0,
        recentFallbackDiagnostics: [],
        lastNativeError: null,
        lastNativeFailureAt: null,
        lastConnectedAt: "2026-06-14T10:00:00.000Z",
        lastDisconnectedAt: null
      },
      runtimeIssues: input.pendingScopeApproval
        ? [{
            id: "scope_upgrade_pending:openclaw_gateway:req-1",
            type: "scope_upgrade_pending",
            source: "openclaw_gateway",
            severity: "action_required",
            status: "active",
            title: "OpenClaw scope approval pending",
            message: "OpenClaw requested additional local operator scopes.",
            firstSeenAt: "2026-06-14T10:00:00.000Z",
            lastSeenAt: "2026-06-14T10:00:00.000Z",
            requestId: "req-1",
            requestedScopes: ["runtime:write"],
            approvedScopes: ["runtime:read"]
          }]
        : [],
      securityWarnings: [],
      issues: []
    },
    mode: "live",
    generatedAt: "2026-06-14T10:00:00.000Z",
    workspaces: [],
    agents: [],
    tasks: [],
    taskGraph: { nodes: [], edges: [] },
    channels: [],
    accounts: [],
    models: []
  } as unknown as MissionControlSnapshot;
}
