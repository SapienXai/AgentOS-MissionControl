import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const rootDir = process.cwd();

function toProjectPath(filePath: string) {
  return path.relative(rootDir, filePath).split(path.sep).join("/");
}

function walkFiles(dir: string, predicate: (filePath: string) => boolean) {
  const files: string[] = [];

  for (const entry of readdirSync(dir)) {
    const filePath = path.join(dir, entry);
    const stat = statSync(filePath);

    if (stat.isDirectory()) {
      files.push(...walkFiles(filePath, predicate));
      continue;
    }

    if (stat.isFile() && predicate(filePath)) {
      files.push(filePath);
    }
  }

  return files;
}

function readProjectSourceFiles(dirs: string[]) {
  return dirs.flatMap((dir) =>
    walkFiles(path.join(rootDir, dir), (filePath) => /\.(ts|tsx)$/.test(filePath))
  );
}

test("OpenClaw production code does not import the legacy service entrypoint", () => {
  const productionFiles = readProjectSourceFiles(["app", "components", "hooks", "lib"]).filter(
    (filePath) => toProjectPath(filePath) !== "lib/openclaw/service.ts"
  );
  const offenders = productionFiles
    .filter((filePath) => {
      const source = readFileSync(filePath, "utf8");
      return /from\s+["'][^"']*openclaw\/service["']/.test(source);
    })
    .map(toProjectPath);

  assert.deepEqual(offenders, []);
});

test("app, components, and hooks do not import low-level OpenClaw clients directly", () => {
  const allowedTransitionalApiRoutes = new Set([
    "app/api/models/providers/route.ts",
    "app/api/onboarding/models/route.ts",
    "app/api/onboarding/route.ts",
    "app/api/settings/openclaw-binary/route.ts",
    "app/api/update/route.ts"
  ]);
  const forbidden = [
    "@/lib/openclaw/cli",
    "@/lib/openclaw/client/cli-gateway-client",
    "@/lib/openclaw/client/native-ws-gateway-client",
    "@/lib/openclaw/client/gateway-client-factory"
  ];
  const offenders = readProjectSourceFiles(["app", "components", "hooks"])
    .filter((filePath) => !allowedTransitionalApiRoutes.has(toProjectPath(filePath)))
    .flatMap((filePath) => {
      const source = readFileSync(filePath, "utf8");
      return forbidden
        .filter((specifier) => source.includes(`from "${specifier}"`) || source.includes(`from '${specifier}'`))
        .map((specifier) => `${toProjectPath(filePath)} -> ${specifier}`);
    })
    .sort();

  assert.deepEqual(offenders, []);
});

test("OpenClaw direct CLI JSON usage remains in documented fallback/discovery files", () => {
  const allowed = new Set([
    "lib/openclaw/cli.ts",
    "lib/openclaw/client/cli-gateway-client.ts",
    "lib/openclaw/application/channel-connect-service.ts",
    "lib/openclaw/application/chatgpt-provider-auth-service.ts",
    "lib/openclaw/application/mobile-pairing-service.ts",
    "lib/openclaw/application/task-health-service.ts"
  ]);
  const offenders = readProjectSourceFiles(["lib/openclaw"])
    .filter((filePath) => readFileSync(filePath, "utf8").includes("runOpenClawJson"))
    .map(toProjectPath)
    .filter((filePath) => !allowed.has(filePath));

  assert.deepEqual(offenders, []);
});

test("OpenClaw direct CLI command usage remains in documented fallback/provisioning files", () => {
  const allowed = new Set([
    "lib/openclaw/application/channel-connect-service.ts",
    "lib/openclaw/application/chatgpt-provider-auth-service.ts",
    "lib/openclaw/application/gateway-service.ts",
    "lib/openclaw/application/mobile-pairing-service.ts",
    "lib/openclaw/application/mission-control/diagnostics.ts",
    "lib/openclaw/client/cli-gateway-client.ts",
    "lib/openclaw/reset.ts"
  ]);
  const offenders = readProjectSourceFiles(["lib/openclaw"])
    .filter((filePath) => toProjectPath(filePath) !== "lib/openclaw/cli.ts")
    .filter((filePath) => {
      const source = readFileSync(filePath, "utf8");
      return /import\s+\{[^}]*\brunOpenClaw\b[^}]*\}\s+from\s+["']@\/lib\/openclaw\/cli["']/.test(source);
    })
    .map(toProjectPath)
    .filter((filePath) => !allowed.has(filePath));

  assert.deepEqual(offenders, []);
});

test("AgentOS contracts expose explicit runtime aliases instead of wildcard OpenClaw exports", () => {
  const source = readFileSync(path.join(rootDir, "lib/agentos/contracts.ts"), "utf8");

  assert.doesNotMatch(source, /export\s+type\s+\*\s+from\s+["']@\/lib\/openclaw\/types["']/);
  assert.match(source, /export type ControlPlaneSnapshot = MissionControlSnapshot;/);
  assert.match(source, /export type ControlPlaneDiagnostics = GatewayDiagnostics;/);
  assert.match(source, /export type AgentRecord = OpenClawAgent;/);
  assert.match(source, /export type RuntimeActivityRecord = RuntimeRecord;/);
  assert.match(source, /export type WorkItemRecord = TaskRecord;/);
  assert.match(source, /export type RuntimeEventFrame = \{/);
  assert.match(source, /export type RuntimeEventSubscriptionRequest = \{/);
  assert.match(source, /export type RuntimeSnapshotRecord = \{/);
});

test("app, components, and hooks use AgentOS aliases for core runtime records", () => {
  const forbiddenCoreContractTypes = [
    "GatewayDiagnostics",
    "OpenClawAgent",
    "RuntimeRecord",
    "TaskRecord",
    "WorkspaceProject"
  ];
  const offenders = readProjectSourceFiles(["app", "components", "hooks"])
    .flatMap((filePath) => {
      const source = readFileSync(filePath, "utf8");
      const matches = source.matchAll(
        /import\s+type\s+\{([\s\S]*?)\}\s+from\s+["']@\/lib\/agentos\/contracts["']/g
      );

      return Array.from(matches).flatMap((match) =>
        forbiddenCoreContractTypes
          .filter((typeName) => new RegExp(`\\b${typeName}\\b`).test(match[1]))
          .map((typeName) => `${toProjectPath(filePath)} -> ${typeName}`)
      );
    })
    .sort();

  assert.deepEqual(offenders, []);
});

test("model provider API route keeps local OpenClaw config state behind the application service", () => {
  const routeSource = readFileSync(path.join(rootDir, "app/api/models/providers/route.ts"), "utf8");
  const serviceSource = readFileSync(
    path.join(rootDir, "lib/openclaw/application/model-provider-state-service.ts"),
    "utf8"
  );

  assert.match(routeSource, /model-provider-state-service/);
  assert.doesNotMatch(routeSource, /node:fs\/promises|node:os|auth-profiles\.json|openclaw\.json|getOpenClawAdapter/);
  assert.match(serviceSource, /openclaw\.json/);
  assert.match(serviceSource, /auth-profiles\.json/);
});

test("model provider API route keeps ChatGPT OAuth behind the application service", () => {
  const routeSource = readFileSync(path.join(rootDir, "app/api/models/providers/route.ts"), "utf8");
  const serviceSource = readFileSync(
    path.join(rootDir, "lib/openclaw/application/chatgpt-provider-auth-service.ts"),
    "utf8"
  );

  assert.match(routeSource, /connectOpenClawChatGptProvider/);
  assert.match(routeSource, /statusContext\.connection\.connected/);
  assert.doesNotMatch(routeSource, /resolveOpenAiAuthHandoff|manualCommand:\s*authHandoff\.command/);
  assert.match(serviceSource, /readOpenClawCodexPluginReady/);
  assert.match(serviceSource, /\["plugins",\s*"install",\s*"--force",\s*"--accept-capabilities",\s*"@openclaw\/codex"\]/);
  assert.match(serviceSource, /"models",\s*"auth",\s*"login"/);
  assert.match(serviceSource, /"openai"/);
  assert.match(serviceSource, /openclaw-cli-interactive/);
  assert.match(serviceSource, /"\/usr\/bin\/script"/);
  assert.match(routeSource, /authMethod:\s*z\.enum\(\["api-key",\s*"chatgpt-oauth"\]\)/);
  assert.match(routeSource, /input\.provider === "openai" && input\.authMethod === "chatgpt-oauth"/);
  assert.match(routeSource, /requireAgentOsProductPermission\(request, "secrets\.manage"\)/);
  assert.doesNotMatch(routeSource, /input\.(scopes|actor|profileId)/);
  assert.doesNotMatch(routeSource, /models\s+auth\s+login\s+--provider\s+openai-codex\s+--set-default/);
});

test("Model Library preserves discovery results across provider status refreshes", () => {
  const source = readFileSync(
    path.join(rootDir, "components/mission-control/add-models/add-models-dialog.tsx"),
    "utf8"
  );
  const statusHandler = source.match(
    /async function runStatus[\s\S]*?\n  async function connectProvider/
  )?.[0] ?? "";

  assert.match(source, /discoveryLoaded:\s*boolean/);
  assert.match(source, /result\.action === "status" && result\.models\.length === 0/);
  assert.match(source, /result\.action === "discover" \|\| result\.models\.length > 0/);
  assert.doesNotMatch(statusHandler, /models:\s*currentDraft/);
  assert.match(source, /Discovery state" value=\{activeDraft\.discoveryLoaded/);
});

test("Model Library catalog requests are bounded and retain real OpenClaw fallback data", () => {
  const source = readFileSync(path.join(rootDir, "app/api/models/catalog/route.ts"), "utf8");

  assert.match(source, /listOpenClawModels\(\{ all: true \}, \{ timeoutMs: OPENCLAW_CATALOG_TIMEOUT_MS \}\)/);
  assert.match(source, /readModelCatalogCache/);
  assert.match(source, /writeModelCatalogCache/);
  assert.match(source, /resolveModelCatalogCacheAgeMs/);
  assert.match(source, /source: "openclaw-cache"/);
  assert.match(source, /age:/);
  assert.match(source, /getMissionControlSnapshot\(\{ loadProfile: "system" \}\)/);
  assert.match(source, /readOpenClawConfiguredModelIds\(\)/);
  assert.match(source, /markConfiguredCatalogModels\(result\.models, configuredModelIds\)/);
});

test("model onboarding route installs the Codex plugin before provider login when needed", () => {
  const routeSource = readFileSync(path.join(rootDir, "app/api/onboarding/models/route.ts"), "utf8");

  assert.match(routeSource, /readOpenClawCodexPluginReady/);
  assert.match(routeSource, /resolveOpenAiAuthHandoff/);
  assert.match(routeSource, /codexPluginReady/);
  assert.match(routeSource, /force:\s*input\.intent === "login-provider"\s*\?\s*input\.force === true\s*:\s*false/);
  assert.match(routeSource, /normalizeAddModelsProviderId/);
  assert.match(routeSource, /isBuiltInAddModelsProviderId/);
  assert.match(routeSource, /requireAgentOsProductPermission\(request, "secrets\.manage"\)/);
  assert.doesNotMatch(routeSource, /input\.(scopes|actor|profileId)/);
  assert.doesNotMatch(routeSource, /readOpenClawCodexPluginReady\(\)\.catch\(\(\) => true\)/);
});

test("agent chat recovery forces ChatGPT auth refresh instead of trusting stale connected state", () => {
  const shellSource = readFileSync(path.join(rootDir, "components/mission-control/mission-control-shell.tsx"), "utf8");
  const chatRouteSource = readFileSync(path.join(rootDir, "app/api/agents/[agentId]/chat/route.ts"), "utf8");

  assert.match(shellSource, /force:\s*options\.forceAuth\s*\|\|\s*undefined/);
  assert.match(shellSource, /autoOpenTerminal:\s*true,\s*forceAuth:\s*true/);
  assert.match(chatRouteSource, /recoverSilentOpenAiChatFailure/);
});

test("local Gateway port probes do not claim authenticated RPC readiness", () => {
  const probeSource = readFileSync(path.join(rootDir, "lib/openclaw/client/local-gateway-probe.ts"), "utf8");
  const snapshotLoaderSource = readFileSync(
    path.join(rootDir, "lib/openclaw/application/mission-control/snapshot-loader.ts"),
    "utf8"
  );
  const systemReadinessSource = readFileSync(
    path.join(rootDir, "lib/openclaw/application/mission-control/system-readiness-snapshot.ts"),
    "utf8"
  );

  assert.doesNotMatch(probeSource, /rpc:\s*\{\s*ok:\s*true\s*\}/);
  assert.match(snapshotLoaderSource, /const openclawCliInstalled = await detectOpenClaw\(\);/);
  assert.match(snapshotLoaderSource, /const openclawInstalled = openclawCliInstalled \|\| Boolean\(localGatewayStatus\?\.rpc\?\.ok\);/);
  assert.match(snapshotLoaderSource, /const shouldHydrateGatewayStatus = gatewayStatusCacheNeedsRefresh;/);
  assert.doesNotMatch(snapshotLoaderSource, /const shouldHydrateGatewayStatus = !localGatewayStatus/);
  assert.match(snapshotLoaderSource, /let resolvedGatewayStatus = gatewayStatusCache\.resolve\(gatewayStatusResult\);/);
  assert.match(systemReadinessSource, /const gatewayStatusResult = await settleGatewayStatusPayloadFromOpenClaw\(3_000\);/);
});

test("runtime state uses Gateway snapshot and adapter event subscriptions", () => {
  const snapshotLoaderSource = readFileSync(
    path.join(rootDir, "lib/openclaw/application/mission-control/snapshot-loader.ts"),
    "utf8"
  );
  const runtimeReconciliationSource = readFileSync(
    path.join(rootDir, "lib/openclaw/application/mission-control/runtime-reconciliation.ts"),
    "utf8"
  );
  const eventBridgeSource = readFileSync(
    path.join(rootDir, "lib/openclaw/application/event-bridge-service.ts"),
    "utf8"
  );
  const runtimeStateSource = readFileSync(
    path.join(rootDir, "lib/openclaw/application/runtime-state-service.ts"),
    "utf8"
  );

  assert.match(snapshotLoaderSource, /settleRuntimeSnapshotPayloadFromOpenClaw/);
  assert.match(runtimeReconciliationSource, /mapOpenClawRuntimeSnapshotToRuntimes/);
  assert.match(eventBridgeSource, /getOpenClawAdapter\(\)\.subscribeRuntimeEvents/);
  assert.doesNotMatch(eventBridgeSource, /new NativeWsOpenClawGatewayClient/);
  assert.match(runtimeStateSource, /getOpenClawAdapter\(\)\.getRuntimeSnapshot/);
});

test("model auth repair and planner runtime turns stay behind the OpenClaw adapter", () => {
  const modelAuthSource = readFileSync(
    path.join(rootDir, "lib/openclaw/application/model-auth-service.ts"),
    "utf8"
  );
  const plannerSource = readFileSync(path.join(rootDir, "lib/openclaw/planner.ts"), "utf8");

  assert.match(modelAuthSource, /getOpenClawAdapter\(\)\.getAgentModelStatus/);
  assert.match(modelAuthSource, /getOpenClawAdapter\(\)\.setModelAuthOrder/);
  assert.doesNotMatch(modelAuthSource, /runOpenClaw(Json)?/);
  assert.match(plannerSource, /getOpenClawAdapter\(\)\.runAgentTurn/);
  assert.doesNotMatch(plannerSource, /runOpenClaw(Json)?/);
});

test("read-only agent config and channel discovery use the OpenClaw adapter", () => {
  const agentConfigSource = readFileSync(
    path.join(rootDir, "lib/openclaw/domains/agent-config.ts"),
    "utf8"
  );
  const channelsSource = readFileSync(path.join(rootDir, "lib/openclaw/domains/channels.ts"), "utf8");

  assert.match(agentConfigSource, /const OPENCLAW_AGENT_CONFIG_PATH = "agents\.entries"/);
  assert.match(agentConfigSource, /getOpenClawAdapter\(\)\.getConfig<unknown>\(OPENCLAW_AGENT_CONFIG_PATH, options\)/);
  assert.match(channelsSource, /getOpenClawAdapter\(\)\.getConfig<TelegramAllowlistConfig>\("channels\.telegram\.groups"\)/);
  assert.match(channelsSource, /getOpenClawAdapter\(\)\.getConfig<DiscordGuildConfig>\("channels\.discord\.guilds"\)/);
  assert.match(channelsSource, /getOpenClawAdapter\(\)\.getChannelLogs/);
  assert.doesNotMatch(agentConfigSource, /runOpenClawJson/);
  assert.doesNotMatch(channelsSource, /runOpenClawJson/);
});

test("agent config writes stay behind the OpenClaw adapter without workspace identity sync", () => {
  const source = readFileSync(path.join(rootDir, "lib/openclaw/domains/agent-config.ts"), "utf8");

  assert.doesNotMatch(source, /from\s+["']@\/lib\/openclaw\/cli["']/);
  assert.doesNotMatch(source, /runOpenClaw/);
  assert.match(source, /getOpenClawAdapter\(\)\.setConfig\(OPENCLAW_AGENT_CONFIG_PATH, entries, \{ \.\.\.options, strictJson: true \}\)/);
  assert.doesNotMatch(source, /getOpenClawAdapter\(\)\.setAgentIdentity/);
  assert.match(source, /writeFile\(identityFilePath, identityMarkdown, "utf8"\)/);
});

test("channel provisioning writes stay behind the OpenClaw adapter", () => {
  const source = readFileSync(path.join(rootDir, "lib/openclaw/application/channel-service.ts"), "utf8");

  assert.doesNotMatch(source, /from\s+["']@\/lib\/openclaw\/cli["']/);
  assert.doesNotMatch(source, /runOpenClaw/);
  assert.match(source, /getOpenClawAdapter\(\)\.provisionChannelAccount/);
  assert.match(source, /getOpenClawAdapter\(\)\.removeChannelAccount/);
  assert.match(source, /getOpenClawAdapter\(\)\.setupGmailWebhook/);
});

test("surface reconcile dry-run skips OpenClaw config writes and provider side effects", () => {
  const source = readFileSync(path.join(rootDir, "lib/openclaw/application/channel-service.ts"), "utf8");
  const surfaceRuntime = readFileSync(path.join(rootDir, "lib/openclaw/surface-runtime.ts"), "utf8");
  const route = readFileSync(path.join(rootDir, "app/api/workspaces/[workspaceId]/surfaces/reconcile/route.ts"), "utf8");
  const dialog = readFileSync(path.join(rootDir, "components/mission-control/workspace-channels-dialog.tsx"), "utf8");

  assert.match(source, /const dryRun = input\.dryRun === true/);
  assert.match(source, /readSurfaceReconcilePreviewAudit\(confirmedPreviewAuditId\)/);
  assert.match(source, /validateSurfaceReconcilePreviewForApply/);
  assert.match(source, /surfaceReconcilePreviewMaxAgeMs = 15 \* 60 \* 1000/);
  assert.match(source, /approvedSurfaceRepairConfigPaths = new Set/);
  assert.match(source, /assertApprovedSurfaceRepairConfigPaths\(plannedConfigPaths\)/);
  assert.match(surfaceRuntime, /Current OpenClaw bindings changed since preview/);
  assert.match(source, /writeSurfaceReconcileBackup/);
  assert.match(source, /surface-reconcile\.backup-read/);
  assert.match(source, /surface-reconcile\.backup-write/);
  assert.match(source, /previousConfigValues/);
  assert.match(source, /const backup = redactSecrets/);
  assert.match(source, /const audit = redactSecrets/);
  assert.match(source, /const configMutations = dryRun\s+\?\s+undefined\s+:\s+await measureTiming\([\s\S]*?applySurfaceConfigRepairPatch/);
  assert.match(source, /if \(scope === "all" && !dryRun\)/);
  assert.match(source, /if \(!dryRun\) \{\s+invalidateSnapshotCache\(\);/);
  assert.match(source, /writeSurfaceReconcileAudit/);
  assert.match(route, /surfaceReconcileApplyConfirmation = "apply-surface-reconcile"/);
  assert.match(route, /Integration repair apply requires explicit confirmation/);
  assert.match(route, /Integration repair apply requires a dry-run preview audit id/);
  assert.doesNotMatch(dialog, /window\.confirm/);
  assert.match(dialog, /Apply OpenClaw binding repair/);
  assert.match(dialog, /handleApplySurfaceRepairPreview/);
});

test("settings device access repair stays behind the OpenClaw adapter", () => {
  const source = readFileSync(path.join(rootDir, "lib/openclaw/application/settings-service.ts"), "utf8");

  assert.doesNotMatch(source, /from\s+["']@\/lib\/openclaw\/cli["']/);
  assert.doesNotMatch(source, /runOpenClawJson/);
  assert.match(source, /getOpenClawAdapter\(\)\.approveDeviceAccess/);
});

test("dashboard gateway permission issues route to Settings repair flow", () => {
  const source = readFileSync(path.join(rootDir, "components/operations/dashboard/dashboard-page-content.tsx"), "utf8");

  assert.match(source, /const hasGatewayPermissionIssue = attentionItems\.some\(isGatewayPermissionIssue\)/);
  assert.match(source, /operator-scope approval\|device access\|pairing-pending\|scope upgrade/);
  assert.match(source, /Manage Gateway permissions/);
  assert.match(source, /href="\/settings#gateway"/);
  assert.doesNotMatch(source, /fetch\(["']\/api\/settings\/gateway/);
});

test("system onboarding repairs Gateway auth before runtime state verification", () => {
  const source = readFileSync(path.join(rootDir, "app/api/onboarding/route.ts"), "utf8");
  const repairIndex = source.indexOf("const repairedGatewayAuth = await repairGatewayAuthForSystemSetup");
  const runtimeStateIndex = source.indexOf("await touchOpenClawRuntimeStateAccess");

  assert.notEqual(repairIndex, -1);
  assert.notEqual(runtimeStateIndex, -1);
  assert.equal(repairIndex < runtimeStateIndex, true);
  assert.match(source, /const readyTimeoutMs = 180_000/);
  assert.match(source, /const postAuthRepairReadyTimeoutMs = 180_000/);
  assert.match(source, /const readyStatusIntervalMs = 5_000/);
  assert.match(source, /waitForReadySnapshotAfterGatewayAuthRepair/);
  assert.match(source, /clearMissionControlCaches\(\);/);
  assert.match(source, /\["gateway", "restart", "--force", "--json"\]/);
  assert.match(source, /repairGatewayAuthForSystemSetup\(\s*latestSnapshot,\s*send,\s*gatewayStatusRetry,\s*openClawBin\s*\)/);
  assert.match(source, /resolveGatewayAuthSetupIssueFromGatewayStatus/);
  assert.match(source, /syncGatewayAuthTokenBeforeFirstStart/);
  assert.match(source, /gatewayInstallNeedsAgentOsTokenSync/);
  assert.match(source, /saveGatewayNativeAuthCredential/);
  assert.match(source, /Preparing Gateway auth for AgentOS before first start/);
  assert.match(source, /needsGatewayBootstrapConfigRepair/);
  assert.match(source, /\["config", "set", "gateway\.mode", "local"\]/);
  assert.match(source, /writeLocalGatewayBootstrapConfig\(token\)/);
  assert.match(source, /auth:\s*\{[\s\S]*?mode: "token",[\s\S]*?token/);
  assert.doesNotMatch(source, /\["config", "set", "gateway\.auth\.token", token\]/);
  assert.match(source, /Rotating the local Gateway token before system setup readiness/);
  assert.doesNotMatch(source, /generateGatewayNativeAuthToken/);
  assert.match(source, /AgentOS repaired local Gateway token auth during system setup verification/);
});

test("system onboarding prepares local Gateway config before waiting on native readiness", () => {
  const source = readFileSync(path.join(rootDir, "app/api/onboarding/route.ts"), "utf8");
  const preStartRepairIndex = source.indexOf("if (needsGatewayBootstrapConfigRepair(gatewayStatus))");
  const startIndex = source.indexOf('message: "Starting the local gateway service..."');
  const postStartRepairIndex = source.indexOf("Gateway service started without usable local config");
  const waitIndex = source.indexOf('message: "Waiting for AgentOS to detect a live OpenClaw gateway..."');

  assert.notEqual(preStartRepairIndex, -1);
  assert.notEqual(startIndex, -1);
  assert.notEqual(postStartRepairIndex, -1);
  assert.notEqual(waitIndex, -1);
  assert.equal(preStartRepairIndex < startIndex, true);
  assert.equal(postStartRepairIndex < waitIndex, true);
  assert.match(source, /AgentOS prepared Gateway local mode and token auth before first Gateway start/);
  assert.match(source, /AgentOS repaired missing Gateway local config after the first start attempt/);
});

test("planner provisioning writes stay behind the OpenClaw adapter", () => {
  const source = readFileSync(path.join(rootDir, "lib/openclaw/planner.ts"), "utf8");

  assert.doesNotMatch(source, /from\s+["']@\/lib\/openclaw\/cli["']/);
  assert.doesNotMatch(source, /runOpenClaw/);
  assert.match(source, /getOpenClawAdapter\(\)\.provisionChannelAccount/);
  assert.match(source, /getOpenClawAdapter\(\)\.provisionAutomation/);
});

test("Gateway compatibility aliases stay centralized outside application services", () => {
  const compatibilitySource = readFileSync(
    path.join(rootDir, "lib/openclaw/client/gateway-compatibility.ts"),
    "utf8"
  );
  const capabilitySource = readFileSync(
    path.join(rootDir, "lib/openclaw/application/capability-matrix-service.ts"),
    "utf8"
  );
  const nativeClientSource = readFileSync(
    path.join(rootDir, "lib/openclaw/client/native-ws-gateway-client.ts"),
    "utf8"
  );

  assert.match(compatibilitySource, /models\.authOrder\.set/);
  assert.match(compatibilitySource, /models\.auth\.order\.set/);
  assert.match(compatibilitySource, /agentIdentity/);
  assert.match(compatibilitySource, /deviceApproval/);
  assert.match(compatibilitySource, /channelProvisioning/);
  assert.match(compatibilitySource, /channelRemoval/);
  assert.match(compatibilitySource, /gmailProvisioning/);
  assert.match(compatibilitySource, /automationProvisioning/);
  assert.match(compatibilitySource, /label: "Model auth order"/);
  assert.match(compatibilitySource, /getOpenClawGatewayOperationLabel/);
  assert.doesNotMatch(capabilitySource, /const knownGatewayFirstMethods = \[/);
  assert.match(capabilitySource, /OPENCLAW_GATEWAY_COMPATIBILITY_OPERATIONS/);
  assert.match(capabilitySource, /buildGatewayMethodContractAudit/);
  assert.match(capabilitySource, /getOpenClawGatewayOperationLabel\(entry\.operation\)/);
  assert.match(nativeClientSource, /gatewayFirstCompatible/);
  assert.match(nativeClientSource, /getOpenClawGatewayMethodCandidates/);
});

test("settings gateway card keeps contract and fallback evidence in historical diagnostics", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/settings-control-center.tsx"), "utf8");

  assert.match(source, /Historical evidence/);
  assert.match(source, /Show saved technical report/);
  assert.match(source, /visibleContractIssues/);
  assert.match(source, /formatContractStatus\(check\.status\)/);
  assert.match(source, /check\.suggestedRecovery/);
  assert.match(source, /Gateway fallback diagnostics/);
  assert.match(source, /diagnostic\.operationLabel/);
});

test("CLI runtime event subscriptions fail closed instead of pretending to stream", () => {
  const source = readFileSync(path.join(rootDir, "lib/openclaw/client/cli-gateway-client.ts"), "utf8");

  assert.match(source, /subscribeRuntimeEvents/);
  assert.match(source, /require the native Gateway transport/);
  assert.doesNotMatch(source, /subscribeRuntimeEvents[\s\S]*return\s+\{\s*close\(\)/);
});

test("CLI mission dispatch fallback bounds OpenClaw agent execution", () => {
  const runnerSource = readFileSync(path.join(rootDir, "scripts/openclaw-mission-dispatch-runner.mjs"), "utf8");
  const lifecycleSource = readFileSync(path.join(rootDir, "lib/openclaw/domains/mission-dispatch-lifecycle.ts"), "utf8");

  assert.match(lifecycleSource, /OPENCLAW_AGENT_TIMEOUT_SECONDS/);
  assert.match(runnerSource, /process\.env\.OPENCLAW_BIN \|\| "openclaw"/);
  assert.match(runnerSource, /"--timeout",\s*String\(timeoutSeconds\)/);
  assert.match(runnerSource, /OpenClaw mission timed out after/);
  assert.match(runnerSource, /SIGKILL/);
});

test("generated Telegram delegation helper uses configured OpenClaw binary and timeout", () => {
  const source = readFileSync(path.join(rootDir, "lib/openclaw/domains/agent-provisioning.ts"), "utf8");

  assert.match(source, /process\.env\.OPENCLAW_BIN \|\| "openclaw"/);
  assert.match(source, /"--timeout",\s*String\(timeoutSeconds\)/);
  assert.match(source, /timeout: timeoutSeconds \* 1000 \+ 15000/);
  assert.doesNotMatch(source, /execFileAsync\("openclaw", args/);
});

test("full uninstall reset avoids OpenClaw-dependent workspace cleanup", () => {
  const source = readFileSync(path.join(rootDir, "lib/openclaw/reset.ts"), "utf8");

  assert.match(
    source,
    /if \(fullUninstall\) \{\s*await removeWorkspaceFolderDirectly\(workspace, emit\);\s*continue;\s*\}\s*await deleteWorkspaceProject/
  );
  assert.match(
    source,
    /if \(fullUninstall\) \{\s*await removeWorkspaceIntegrationDirectory\(workspace, emit\);\s*continue;\s*\}\s*const snapshot = await getMissionControlSnapshot/
  );
  assert.match(source, /OpenClaw uninstall command failed\. AgentOS will continue with local state cleanup/);
  assert.match(source, /Snapshot refresh skipped after full uninstall/);
});

test("AgentOS does not seed legacy openai-codex model refs in production code", () => {
  const offenders = [
    path.join(rootDir, "app/api/models/providers/route.ts"),
    path.join(rootDir, "lib/openclaw/fallback.ts")
  ]
    .filter((filePath) => readFileSync(filePath, "utf8").includes("openai-codex/gpt-"))
    .map(toProjectPath);

  assert.deepEqual(offenders, []);
});

test("OpenClaw local module imports do not introduce cycles", () => {
  const files = readProjectSourceFiles(["lib/openclaw"]);
  const fileSet = new Set(files.map(toProjectPath));
  const graph = new Map<string, string[]>();

  for (const filePath of files) {
    const source = readFileSync(filePath, "utf8");
    const imports: string[] = [];
    const importPattern =
      /import(?:[\s\S]*?from\s*)?["']([^"']+)["']|export\s+\{[\s\S]*?\}\s+from\s*["']([^"']+)["']/g;
    let match: RegExpExecArray | null;

    while ((match = importPattern.exec(source))) {
      const specifier = match[1] ?? match[2];
      const resolved = resolveLocalOpenClawImport(filePath, specifier);

      if (resolved && fileSet.has(resolved)) {
        imports.push(resolved);
      }
    }

    graph.set(toProjectPath(filePath), imports);
  }

  const cycles = findCycles(graph);

  assert.deepEqual(cycles, []);
});

test("sidebar exposes config-driven mission and admin navigation routes", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/sidebar.tsx"), "utf8");

  assert.match(source, /type SidebarSection = "overview" \| "operations" \| "system";/);
  assert.match(source, /type SidebarItem = \{[\s\S]*?href\?: string;[\s\S]*?icon: LucideIcon;[\s\S]*?section: SidebarSection;/);
  assert.match(source, /const sidebarItems: SidebarItem\[] = \[/);
  assert.match(source, /\{ label: "Mission Control", href: "\/", icon: Gauge, section: "overview" \}/);
  assert.match(source, /\{ label: "Agents", href: "\/agents", icon: Bot, section: "operations" \}/);
  assert.match(source, /\{ label: "Missions", href: "\/missions", icon: ClipboardList, section: "operations" \}/);
  assert.match(source, /\{ label: "Human Control", href: "\/human-control", icon: ShieldAlert, section: "operations" \}/);
  assert.match(source, /\{ label: "Files", href: "\/files", icon: FileText, section: "operations" \}/);
  assert.match(source, /\{ label: "Models", href: "\/models", icon: Cpu, section: "operations" \}/);
  assert.match(source, /\{ label: "Integrations", href: "\/integrations", icon: Plug, section: "operations" \}/);
  assert.match(source, /\{ label: "Settings", href: "\/settings", icon: Settings2, section: "system" \}/);
  assert.match(source, /onOpenWorkspaceCreate: \(\) => void;/);
  assert.match(source, /<span className="block truncate text-\[0\.82rem\] font-medium">Create Workspace<\/span>/);
  assert.match(source, /onOpenWorkspaceCreate\(\);[\s\S]*?setOpen\(false\);/);
  assert.doesNotMatch(source, /label: "Diagnostics"/);
  assert.doesNotMatch(source, /label: "Sessions"/);
  assert.doesNotMatch(source, /label: "Billing"/);
  assert.doesNotMatch(source, /label: "Audit Logs"/);
});

test("sidebar resolves active nav items from path and hash", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/sidebar.tsx"), "utf8");

  assert.match(source, /const \[activeHash, setActiveHash\] = useState\(""\);/);
  assert.match(source, /const syncHash = \(\) => setActiveHash\(window\.location\.hash\.replace/);
  assert.match(source, /window\.addEventListener\("hashchange", syncHash\)/);
  assert.match(source, /function isSidebarItemActive\(item: SidebarItem, pathname: string, activeHash: string\)/);
  assert.match(source, /item\.label === "Mission Control"/);
  assert.match(source, /pathname === "\/" && Boolean\(item\.hash\) && activeHash === item\.hash/);
});

test("sidebar keeps its header and user footer fixed around scrollable navigation", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/sidebar.tsx"), "utf8");

  assert.match(source, /<div className="shrink-0">[\s\S]*?<SidebarBrand[\s\S]*?<WorkspaceSwitcher[\s\S]*?<SidebarCreateAgentAction/);
  assert.match(source, /<nav aria-label="Primary" className="sidebar-scroll mt-6 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">/);
  assert.match(source, /<SidebarUserMenu[\s\S]*?snapshot=\{snapshot\}[\s\S]*?activeWorkspaceId=\{activeWorkspaceId\}/);
  assert.match(source, /function SidebarUserMenu\(\{/);
  assert.match(source, /aria-haspopup="menu"/);
  assert.match(source, /aria-label="User menu"/);
  assert.match(source, /aria-label="Expand sidebar to user menu"/);
  assert.match(source, /fetch\("\/api\/profile", \{ cache: "no-store", signal: controller\.signal \}\)/);
  assert.match(source, /<RailTooltip label=\{resolveOperatorDisplayName\(operatorProfile\)\}[\s\S]*?<UserAvatar profile=\{operatorProfile\} \/>/);
  assert.match(source, /profile\.avatarDataUrl \? \([\s\S]*?src=\{profile\.avatarDataUrl\}/);
  assert.match(source, /label=\{pinned \? "Close sidebar" : "Keep sidebar open"\}/);
  assert.match(source, /aria-pressed=\{pinned\}/);
  assert.match(source, /<SidebarPanelToggleIcon filled=\{pinned\} \/>/);
  assert.match(source, /filled \? "fill-slate-950 dark:fill-slate-100" : "fill-transparent"/);
  assert.match(source, /const collapsedSidebarItems = sidebarItems\.slice\([\s\S]*?item\.label === "Accounts"[\s\S]*?\);/);
  assert.match(source, /\{collapsedSidebarItems[\s\S]*?\.filter\(\(item\) => item\.section === section\.id\)/);
  assert.match(source, /profile\.email\.trim\(\) \|\| \(profile\.username\.trim\(\) \? `@\$\{profile\.username\.trim\(\)\}` : "Personal account"\)/);
  assert.match(source, /<UserProfileDialog[\s\S]*?open=\{profileOpen\}/);
  assert.match(source, /onProfileSaved=\{onProfileSaved\}/);
  assert.match(source, /<SidebarThemeMenuAction surfaceTheme=\{surfaceTheme\} onToggle=\{onToggleTheme\} \/>/);
  assert.match(source, /role="menuitemcheckbox"/);
  assert.match(source, /aria-checked=\{isDark\}/);
  assert.match(source, /<span>Appearance<\/span>/);
});

test("settings shell no longer hardcodes a light-only wrapper", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/mission-control-shell.tsx"), "utf8");

  assert.match(
    source,
    /className=\{cn\([\s\S]*?"mission-shell relative min-h-screen overflow-hidden"[\s\S]*?surfaceTheme === "light" && "mission-shell--light"/
  );
  assert.match(source, /<SettingsControlCenter \{\.\.\.settingsPanelProps\} sidebarOpen=\{isSidebarOpen\} \/>/);
  assert.match(source, /collapsed=\{!isSidebarOpen\}[\s\S]*?settingsMode/);
  assert.match(source, /isSidebarOpen \? "lg:left-\[316px\]" : "lg:left-\[80px\]"/);
});

test("workspace creation provides a compact mobile-first basic flow", () => {
  const source = readFileSync(
    path.join(rootDir, "components/mission-control/workspace-wizard/workspace-wizard-dialog.tsx"),
    "utf8"
  );

  assert.match(source, /contentClassName="[^"]*h-\[100dvh\][^"]*max-h-\[100dvh\][^"]*w-screen[^"]*rounded-none/);
  assert.match(source, /<MobileWorkspaceCreateForm/);
  assert.match(source, /id="mobile-workspace-name"/);
  assert.match(source, /id="mobile-workspace-goal"/);
  assert.match(source, /id="mobile-workspace-source"/);
  assert.match(source, /id="mobile-workspace-template"/);
  assert.match(source, /Core team · Balanced model · Standard setup/);
  assert.match(source, /className="flex w-full items-center gap-2 md:hidden"/);
  assert.match(source, /onClick=\{\(\) => void onCreateWorkspace\(\)\}/);
});

test("mission shell supports hover and pinned sidebar modes", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/mission-control-shell.tsx"), "utf8");
  const mobileSettingsHeaderStart = source.indexOf('"fixed inset-x-0 top-0 z-');
  const mobileSettingsHeaderEnd = source.indexOf('"pointer-events-auto fixed inset-y-0 left-0 z-50', mobileSettingsHeaderStart);

  assert.match(source, /const \[isSidebarOpenState, setIsSidebarOpen\] = useState\(false\);/);
  assert.match(source, /const \[isCompactViewport, setIsCompactViewport\] = useState\(false\);/);
  assert.match(source, /const isSidebarOpen = isSidebarOpenState \|\| \(isSidebarPinned && !isCompactViewport\);/);
  assert.match(source, /const \{ isSidebarPinned, setIsSidebarPinned \} = useSidebarPinning\(\);/);
  assert.match(source, /function shouldKeepSidebarOpenForPortal\(target: EventTarget \| null\)/);
  assert.match(source, /target\.closest\('\[role="dialog"\], \[data-radix-popper-content-wrapper\]'\)/);
  assert.match(source, /document\.querySelector\('\[role="dialog"\]'\)/);
  assert.match(source, /const handleSidebarPinToggle = useCallback\(\(\) => \{/);
  assert.match(source, /window\.matchMedia\("\(max-width: 1023px\)"\)\.matches/);
  assert.match(source, /setIsSidebarPinned\(\(current\) => \{[\s\S]*?setIsSidebarOpen\(nextPinned\);/);
  assert.match(source, /const isSidebarHoverLocked =\s*isSidebarPinned \|\| isSidebarCreateAgentDialogOpen \|\| isSidebarAgentActionModalOpen;/);
  assert.match(source, /onMouseEnter=\{\(\) => \{\s*if \(!isSidebarHoverLocked\) \{\s*setIsSidebarOpen\(true\);/);
  assert.match(
    source,
    /onMouseLeave=\{\(event\) => \{\s*if \(isSidebarPinned \|\| shouldKeepSidebarOpenForPortal\(event\.relatedTarget\)\) \{\s*return;\s*\}\s*setIsSidebarOpen\(false\);/
  );
  assert.match(source, /onFocusCapture=\{\(\) => \{\s*if \(!isSidebarPinned\) \{\s*setIsSidebarOpen\(true\);/);
  assert.match(
    source,
    /onBlurCapture=\{\(event\) => \{\s*if \(isSidebarPinned \|\| shouldKeepSidebarOpenForPortal\(event\.relatedTarget\)\) \{\s*return;\s*\}\s*if \(!event\.currentTarget\.contains\(event\.relatedTarget as Node \| null\)\) \{\s*setIsSidebarOpen\(false\);/
  );
  assert.match(source, /sidebarPinned=\{isSidebarPinned\}[\s\S]*?onToggleCollapsed=\{handleSidebarPinToggle\}/);
  assert.match(source, /aria-label="Close navigation"/);
  assert.match(source, /aria-label="Open navigation"/);
  assert.match(source, /onClick=\{\(\) => setIsSidebarOpen\(true\)\}/);
  assert.match(source, /onClick=\{\(\) => setIsSidebarOpen\(false\)\}/);
  assert.match(source, /isSidebarOpen \? "translate-x-0" : "-translate-x-full"/);
  assert.match(source, /aria-label=\{isInspectorOpen \? "Close inspector" : "Open inspector"\}/);
  assert.equal(source.match(/<MissionControlCanvasTitlePill surfaceTheme=\{surfaceTheme\} \/>/g)?.length, 1);
  assert.ok(mobileSettingsHeaderStart >= 0 && mobileSettingsHeaderEnd > mobileSettingsHeaderStart);
  assert.doesNotMatch(source.slice(mobileSettingsHeaderStart, mobileSettingsHeaderEnd), /connectionState/);
  assert.doesNotMatch(source, /sidebarOpenStorageKey/);
});

test("operations shell shares the persistent pinned sidebar behavior", () => {
  const source = readFileSync(path.join(rootDir, "components/operations/operations-shell.tsx"), "utf8");
  const operationsUiSource = readFileSync(path.join(rootDir, "components/operations/operations-ui.tsx"), "utf8");
  const pinningSource = readFileSync(
    path.join(rootDir, "components/mission-control/use-sidebar-pinning.ts"),
    "utf8"
  );

  assert.match(source, /const \{ isSidebarPinned, setIsSidebarPinned \} = useSidebarPinning\(\);/);
  assert.match(source, /sidebarPinned=\{isSidebarPinned\}/);
  assert.match(source, /onToggleCollapsed=\{handleSidebarPinToggle\}/);
  assert.match(source, /if \(!isSidebarPinned\) setSidebarExpanded\(false\);/);
  assert.match(pinningSource, /agentos\.sidebar\.pinned/);
  assert.match(pinningSource, /window\.localStorage\.setItem\(sidebarPinnedStorageKey, String\(nextPinned\)\)/);
  assert.match(operationsUiSource, /\{!compact \? \(\s*<span/);
  assert.doesNotMatch(operationsUiSource, /compact \? "h-11 px-3"/);
});

test("command bar collapses when empty on mobile and desktop", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/command-bar.tsx"), "utf8");

  assert.match(source, /const isComposerEmpty =\s*!isComposerActive[\s\S]*?composeSuggestion === null;/);
  assert.match(source, /const isDesktopCollapsed =[\s\S]*?isDesktopLayout[\s\S]*?isComposerEmpty;/);
  assert.match(source, /const isMobileCollapsed =[\s\S]*?!isDesktopLayout[\s\S]*?!isDockHovered[\s\S]*?isComposerEmpty;/);
  assert.match(source, /shouldForceCollapsedComposer \|\| isDesktopCollapsed \|\| isMobileCollapsed/);
  assert.match(source, /shouldRenderCollapsedComposer && "max-w-\[360px\]"/);
});

test("settings control center exposes hash navigation for subpages", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/settings-control-center.tsx"), "utf8");

  assert.match(source, /type SettingsSectionId =[\s\S]*?\| "diagnostics"[\s\S]*?\| "advanced"/);
  assert.match(source, /const settingsSections: SettingsSection\[] = \[/);
  assert.match(source, /\{ id: "gateway", label: "Gateway", icon: ShieldCheck, group: "OpenClaw" \}/);
  assert.match(source, /\{ id: "capabilities", label: "Capabilities", icon: ListChecks, group: "OpenClaw" \}/);
  assert.match(source, /\{ id: "diagnostics", label: "Diagnostics", icon: TerminalSquare, group: "System" \}/);
  assert.match(source, /const settingsSectionGroups = \["Core", "OpenClaw", "Workspace", "System"\] as const;/);
  assert.match(source, /function SettingsSectionNavigation\(/);
  assert.match(source, /"border-t px-2\.5 pb-3 pt-2"/);
  assert.match(source, /"bg-\[#080d16\] text-slate-100"/);
  assert.match(source, /"border border-white\/\[0\.10\] bg-\[#121d2d\] text-slate-100/);
  assert.match(source, /"border-white\/\[0\.08\] bg-\[#0c1522\]"/);
  assert.match(source, /"sticky top-\[92px\] hidden[^"]*lg:block"/);
  assert.doesNotMatch(source, /overflow-x-auto rounded-\[18px\]/);
  assert.match(source, /aria-label="Settings sections"/);
  assert.match(source, /href=\{`\/settings#\$\{section\.id\}`\}/);
  assert.match(source, /onSelect\(section\.id\);/);
  assert.match(source, /event\.currentTarget\.closest\("details"\)\?\.removeAttribute\("open"\);/);
  assert.doesNotMatch(source, /title="Settings Sections"/);
  assert.doesNotMatch(source, /resolveSettingsSectionStatus\(/);
  assert.match(source, /function SettingsToggle\(/);
  assert.match(source, /role="switch"/);
  assert.match(source, /aria-checked=\{checked\}/);
  assert.match(source, /const saveToolSetting = async \(settingId: ToolSettingId, enabled: boolean\)/);
  assert.match(source, /applyToolSettings\(nextSettings\);/);
  assert.match(source, /applyToolSettings\(previousSettings\);/);
  assert.match(source, /Changes save automatically\./);
  assert.match(source, /Saving…/);
  assert.match(source, /Saved/);
  assert.doesNotMatch(source, /Save changes/);
  assert.doesNotMatch(source, />\s*Disabled\s*<\/button>[\s\S]*?>\s*Enabled\s*<\/button>/);
  assert.match(source, /case "capabilities":\s*return "capabilities";/);
  assert.match(source, /case "diagnostics":\s*return "diagnostics";/);
  assert.doesNotMatch(source, /id: "billing"/);
  assert.doesNotMatch(source, /id: "audit-logs"/);
});

test("sidebar keeps diagnostics out of the premium navigation surface", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/sidebar.tsx"), "utf8");

  assert.match(source, /function resolveStatusTone\(/);
  assert.doesNotMatch(source, /snapshot\.diagnostics\.issues/);
  assert.doesNotMatch(source, /resolveSidebarDiagnosticIssue/);
  assert.doesNotMatch(source, /Gateway-first request fell back to CLI/);
  assert.doesNotMatch(source, /visibleDiagnosticIssue/);
});

test("mission control snapshot does not call Gateway config.get for remote url", () => {
  const source = readFileSync(
    path.join(rootDir, "lib/openclaw/application/mission-control/payload-loader.ts"),
    "utf8"
  );

  assert.match(source, /const stateRoot = getOpenClawStateRootPath\(\);[\s\S]*readFile\(path\.join\(stateRoot, "openclaw\.json"\), "utf8"\)/);
  assert.match(source, /readNestedConfigValue\(config, gatewayRemoteUrlConfigKey\)/);
  assert.doesNotMatch(source, /call<unknown>\("config\.get", \{\}, \{ timeoutMs: 5_000 \}\)/);
});

test("settings control center renders a single hash-selected section", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/settings-control-center.tsx"), "utf8");

  assert.match(source, /type SettingsSectionId =[\s\S]*?"danger-zone";/);
  assert.match(source, /const \[activeSection, setActiveSection\] = useState<SettingsSectionId>\(\(\) => resolveInitialSettingsSection\(\)\)/);
  assert.match(source, /window\.addEventListener\("hashchange", syncActiveSectionFromHash\)/);
  assert.match(source, /\{ id: "general", label: "General", icon: Wrench, group: "Core" \}/);
  assert.match(source, /case "general":\s*case "tools":\s*return "general"/);
});

test("update check treats loading registry status as loading instead of up to date", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/mission-control-shell.tsx"), "utf8");

  assert.match(source, /const isUpdateRegistryLoading =/);
  assert.match(source, /toast\.message\("Update registry is still loading\."/,);
  assert.match(source, /if \(isUpdateRegistryLoading\) \{/);
});

test("diagnostics command stats count the visible recent command window", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/settings-control-center.tsx"), "utf8");

  assert.match(source, /snapshot\.diagnostics\.transport/);
  assert.match(source, /<TransportDiagnosticsPanel summary=\{transportSummary\}/);
  assert.match(source, /const latestCommands = commandHistory\.slice\(0, 6\);/);
  assert.match(source, /ok: latestCommands\.filter\(\(command\) => command\.status === "ok"\)\.length/);
  assert.match(source, /failed: latestCommands\.filter\(\(command\) => command\.status !== "ok"\)\.length/);
});

test("settings capability matrix uses diagnostics presenters without direct OpenClaw calls", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/settings-control-center.tsx"), "utf8");

  assert.match(source, /buildOpenClawCapabilityRows\(snapshot\.diagnostics\)/);
  assert.match(source, /summarizeOpenClawCapabilityRows\(snapshot\.diagnostics, capabilityRows\)/);
  assert.match(source, /<CapabilityMatrixPanel[\s\S]*rows=\{capabilityRows\}[\s\S]*summary=\{capabilitySummary\}/);
  assert.doesNotMatch(source, /from "@\/lib\/openclaw\/client/);
  assert.doesNotMatch(source, /openclaw gateway/);
});

test("onboarding provider flow skips discovery when provider models already exist", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/openclaw-onboarding-provider-flow.tsx"), "utf8");

  assert.match(source, /hasVisibleModelsForProvider\(providerId\)/);
  assert.match(source, /result\.connection\.connected &&[\s\S]*autoDiscover &&[\s\S]*!hasVisibleModelsForProvider\(providerId\)/);
  assert.match(source, /shouldDiscover \? "discovering" : "idle"/);
});

test("onboarding provider flow applies discovery snapshots to the setup shell", () => {
  const providerFlowSource = readFileSync(path.join(rootDir, "components/mission-control/openclaw-onboarding-provider-flow.tsx"), "utf8");
  const stagesSource = readFileSync(path.join(rootDir, "components/mission-control/openclaw-onboarding.stages.tsx"), "utf8");
  const onboardingSource = readFileSync(path.join(rootDir, "components/mission-control/openclaw-onboarding.tsx"), "utf8");
  const shellSource = readFileSync(path.join(rootDir, "components/mission-control/mission-control-shell.tsx"), "utf8");

  assert.match(providerFlowSource, /onSnapshotChange\?: \(snapshot: MissionControlSnapshot\) => void/);
  assert.match(providerFlowSource, /function applySnapshotResult\(result: AddModelsProviderActionResult\)/);
  assert.match(providerFlowSource, /if \(result\.snapshot\) \{[\s\S]*onSnapshotChange\?\.\(result\.snapshot\);[\s\S]*\}/);
  assert.match(stagesSource, /onSnapshotChange=\{onSnapshotChange\}/);
  assert.match(onboardingSource, /onSnapshotChange=\{onSnapshotChange\}/);
  assert.match(shellSource, /onSnapshotChange=\{setSnapshot\}/);
});

test("model setup exposes explicit providers and the custom provider creation flow", () => {
  const setupSource = readFileSync(
    path.join(rootDir, "components/mission-control/openclaw-onboarding-provider-flow.tsx"),
    "utf8"
  );
  const librarySource = readFileSync(
    path.join(rootDir, "components/mission-control/add-models/add-models-dialog.tsx"),
    "utf8"
  );

  assert.match(setupSource, /buildExplicitModelProviderDescriptor\(providerId\)/);
  assert.match(setupSource, /providerDescriptors\.map\(\(provider\)/);
  assert.match(setupSource, /aria-label="Add custom provider"/);
  assert.match(setupSource, /onOpenAddModels\("custom"\)/);
  assert.match(librarySource, /isInitialCustomProvider = normalizedInitialProvider === "custom"/);
  assert.match(librarySource, /!open \|\| isInitialCustomProvider \|\| activeProviderId \|\| !defaultProviderId/);
  assert.match(librarySource, /setActiveSetupMode\("custom-openai-compatible"\)/);
  assert.match(librarySource, /custom: initialDraftState\(\)/);
});

test("setup wizard rehydrates the verified default model when reopened", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/mission-control-shell.tsx"), "utf8");

  assert.match(source, /options: \{ force\?: boolean \} = \{\}/);
  assert.match(source, /options\.force \|\|[\s\S]*!normalizedCurrentModelId \|\|[\s\S]*normalizedCurrentModelId === previousHydratedModelId/);
  assert.match(source, /if \(resolvedStage === "models"\) \{[\s\S]*hydrateOnboardingModelSelection\(snapshot, \{ force: true \}\);[\s\S]*\}/);
  assert.match(source, /if \(event\.ok && payload\.intent === "set-default"\) \{[\s\S]*hydrateOnboardingModelSelection\(event\.snapshot, \{ force: true \}\);[\s\S]*\}/);
});

test("onboarding runtime step only shows checking while setup is running", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/openclaw-onboarding.stages.tsx"), "utf8");

  assert.match(source, /const isChecking = step\.state === "current" && run\.runState === "running";/);
  assert.match(source, /isRuntimeStep[\s\S]*\? "Needs verification"/);
  assert.doesNotMatch(source, /run\.runState === "running" \|\| isRuntimeStep/);
});

test("onboarding launchpad does not block canvas entry on runtime smoke alone", () => {
  const onboardingSource = readFileSync(path.join(rootDir, "components/mission-control/openclaw-onboarding.tsx"), "utf8");
  const stagesSource = readFileSync(path.join(rootDir, "components/mission-control/openclaw-onboarding.stages.tsx"), "utf8");

  assert.match(
    onboardingSource,
    /const canEnterAgentOS = hasWorkspaceSetup && onboardingSystemReady && modelSetupConfirmed;/
  );
  assert.match(onboardingSource, /disabled=\{!canEnterAgentOS\}/);
  assert.doesNotMatch(onboardingSource, /disabled=\{!operationalReady\}/);
  assert.match(stagesSource, /A real OpenClaw agent turn could not be verified/);
});

test("onboarding refreshes full model snapshot before entering model setup", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/mission-control-shell.tsx"), "utf8");

  assert.match(source, /const refreshOnboardingModelSnapshot = useCallback/);
  assert.match(source, /const continueToModelSetup = async \(\) => \{/);
  assert.match(source, /await refreshOnboardingModelSnapshot\(snapshot\);/);
  assert.match(source, /onContinueToModels=\{continueToModelSetup\}/);
  assert.doesNotMatch(source, /onContinueToModels=\{\(\) => setOnboardingStage\("models"\)\}/);
});

test("connected ChatGPT onboarding keeps the live model picker visible", () => {
  const stagesSource = readFileSync(path.join(rootDir, "components/mission-control/openclaw-onboarding.stages.tsx"), "utf8");
  const flowSource = readFileSync(path.join(rootDir, "components/mission-control/openclaw-onboarding-provider-flow.tsx"), "utf8");

  assert.match(stagesSource, /const showModelSelection = isReady \|\| needsModelSelection;/);
  assert.match(stagesSource, /showModelSelection \? \([\s\S]*compactSelection/);
  assert.match(flowSource, /sharedCatalogModels\.filter\(\(model\) =>[\s\S]*modelMatchesProvider\(/);
  assert.match(flowSource, /filter\(\(model\) => model\.available !== false && !model\.missing\)/);
  assert.match(flowSource, /activeProviderId === "openai" && !showLoadingHero && !compactSelection/);
  assert.doesNotMatch(flowSource, /OpenClaw&apos;s current default is preferred/);
});

test("model onboarding verifies delayed default model writes before surfacing Gateway timeout", () => {
  const source = readFileSync(path.join(rootDir, "app/api/onboarding/models/route.ts"), "utf8");
  const timeoutCheckIndex = source.indexOf("Gateway response timed out. Checking whether OpenClaw applied the default model");
  const failIndex = source.indexOf('await fail("configuring-default", gatewayError');

  assert.notEqual(timeoutCheckIndex, -1);
  assert.notEqual(failIndex, -1);
  assert.equal(timeoutCheckIndex < failIndex, true);
  assert.match(source, /waitForDefaultModelAfterGatewaySettle/);
  assert.match(source, /Default model verified after a delayed OpenClaw Gateway response/);
  assert.match(source, /isLikelyDelayedGatewaySettleError/);
});

test("full uninstall reset reopens onboarding at system setup", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/mission-control-shell.tsx"), "utf8");

  assert.match(source, /const \[requiresFreshInstallSystemSetup, setRequiresFreshInstallSystemSetup\] = useState\(false\);/);
  assert.match(source, /const effectiveOnboardingStage = resolveEffectiveWizardStage/);
  assert.match(source, /setRequiresFreshInstallSystemSetup\(true\);[\s\S]*setOnboardingStage\("system"\);/);
  assert.match(source, /stage=\{effectiveOnboardingStage\}/);
  assert.match(source, /systemSetupRequired=\{requiresFreshInstallSystemSetup\}/);

  const runResetIndex = source.indexOf("const runReset = async () => {");
  const pendingIndex = source.indexOf("setRequiresFreshInstallSystemSetup(true);", runResetIndex);
  const runningIndex = source.indexOf('setResetRunState("running");', runResetIndex);
  assert.equal(runResetIndex >= 0 && pendingIndex > runResetIndex && pendingIndex < runningIndex, true);
});

test("system setup starts Gateway before requesting a full readiness snapshot", () => {
  const source = readFileSync(path.join(rootDir, "app/api/onboarding/route.ts"), "utf8");
  const statusIndex = source.indexOf("let gatewayStatus = await readGatewayStatus(openClawBin);");
  const startIndex = source.indexOf("let gatewayStartResult = await startGatewayForOnboarding", statusIndex);
  const snapshotIndex = source.indexOf("snapshot = await loadSnapshot(true);", statusIndex);

  assert.equal(statusIndex >= 0 && startIndex > statusIndex, true);
  assert.equal(snapshotIndex === -1 || snapshotIndex > startIndex, true);
  assert.match(source, /async function startGatewayForOnboarding[\s\S]*?getOpenClawLifecycleService\(\)\.start\(\)/);
  assert.match(source, /const gatewayStatusTimeoutMs = 3_000;/);
});

test("system setup verifies the installed CLI before advancing to Gateway setup", () => {
  const source = readFileSync(path.join(rootDir, "app/api/onboarding/route.ts"), "utf8");
  const installFunctionStart = source.indexOf("async function installOpenClawCli(");
  const installFunctionEnd = source.indexOf("async function startRegisteredWindowsGateway", installFunctionStart);
  const installBody = source.slice(installFunctionStart, installFunctionEnd);

  assert.match(installBody, /Finalizing the OpenClaw CLI installation/);
  assert.match(installBody, /return await waitForInstalledOpenClawBin\(\);/);
  assert.match(source, /const cliPostInstallResolveTimeoutMs = 30_000;/);
  assert.match(source, /await repairOpenClawWindowsNpmShims\(\)\.catch\(\(\) => null\);/);
  assert.match(source, /await delay\(cliPostInstallResolveIntervalMs\);/);
});

test("Gateway preparation disables browser and web tools by default", () => {
  const source = readFileSync(path.join(rootDir, "app/api/onboarding/route.ts"), "utf8");
  const configWriterStart = source.indexOf("async function writeLocalGatewayBootstrapConfig");
  const configWriterEnd = source.indexOf("function asRecord", configWriterStart);
  const configWriter = source.slice(configWriterStart, configWriterEnd);

  assert.match(configWriter, /const browser = asRecord\(config\.browser\);/);
  assert.match(configWriter, /config\.browser = \{[\s\S]*enabled: false/);
  assert.match(configWriter, /config\.tools = \{[\s\S]*fetch: \{[\s\S]*enabled: false/);
  assert.match(configWriter, /config\.tools = \{[\s\S]*search: \{[\s\S]*enabled: false/);
});

test("system setup restarts a stopped Gateway service before readiness polling", () => {
  const source = readFileSync(path.join(rootDir, "app/api/onboarding/route.ts"), "utf8");
  const postStartIndex = source.indexOf("const postStartGatewayStatus = await readGatewayStatus(openClawBin)");
  const stoppedCheckIndex = source.indexOf("isGatewayServiceStopped(gatewayStatus)", postStartIndex);
  const restartIndex = source.indexOf("restartGatewayForOnboarding", stoppedCheckIndex);
  const waitIndex = source.indexOf("snapshot = await waitForReadySnapshotWithGatewayAuthDetection", restartIndex);

  assert.equal(postStartIndex >= 0 && stoppedCheckIndex > postStartIndex, true);
  assert.equal(restartIndex > stoppedCheckIndex, true);
  assert.equal(waitIndex > restartIndex, true);
  assert.match(source, /Gateway service is registered but stopped\. Restarting it before readiness verification/);
  assert.match(source, /Gateway service is registered, but the process stayed stopped after restart/);
});

test("readiness polling does not load full snapshots before Gateway is reachable", () => {
  const source = readFileSync(path.join(rootDir, "app/api/onboarding/route.ts"), "utf8");
  const functionStart = source.indexOf("async function waitForReadySnapshot(");
  const functionEnd = source.indexOf("async function waitForReadySnapshotWithGatewayAuthDetection", functionStart);
  const body = source.slice(functionStart, functionEnd);

  assert.doesNotMatch(body, /const immediateSnapshot = await loadReadinessSnapshot/);
  assert.match(body, /gatewayCanServeReadiness &&/);
  assert.match(body, /if \(localProbe\?\.rpc\?\.ok && latestSnapshot\) \{\s*return latestSnapshot;/);
  assert.match(source, /initialSnapshot: snapshot/);
  assert.match(source, /const readyTimeoutMs = 180_000;/);
  assert.match(source, /const postAuthRepairReadyTimeoutMs = 180_000;/);
  assert.doesNotMatch(source, /exceeded 60 seconds/);
});

test("Windows setup uses the canonical lifecycle service instead of a task-specific Gateway owner", () => {
  const source = readFileSync(path.join(rootDir, "app/api/onboarding/route.ts"), "utf8");
  const lifecycleStart = source.indexOf("getOpenClawLifecycleService().start()", source.indexOf("async function startGatewayForOnboarding"));

  assert.equal(lifecycleStart >= 0, true);
  assert.doesNotMatch(source, /startRegisteredWindowsGateway/);
});

test("system setup action shows a loader until lightweight status resolves", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/openclaw-onboarding.tsx"), "utf8");

  assert.match(source, /const isPrimaryActionResolving =/);
  assert.match(source, /cliInstalled == null \|\| \(gatewayReachable == null && gatewayRegistered == null\)/);
  assert.match(source, /"Checking\.\.\."/);
});

test("system setup shows Piko while runtime verification is running", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/openclaw-onboarding.tsx"), "utf8");

  assert.match(source, /import \{ PikoLoader \} from "@\/components\/ui\/piko-loader"/);
  assert.match(source, /const isRuntimeVerification = activeStep\?\.id === "runtime"/);
  assert.match(source, /<PikoLoader\s+open=\{isSetupRunning\}/);
  assert.match(source, /title=\{isRuntimeVerification \? "Verifying OpenClaw runtime" : "Setting up OpenClaw"\}/);
  assert.match(source, /<div className="mx-auto max-w-\[720px\]">/);
  assert.doesNotMatch(source, />System Setup<\/h2>/);
  assert.doesNotMatch(source, />Step 1 of 3</);
  assert.match(source, /visualStage === "system" && "sm:overflow-y-hidden"/);
  assert.match(source, /border-slate-200 bg-white shadow-\[0_8px_20px_rgba\(15,23,42,0\.05\)\]/);
  assert.match(source, /border-slate-700\/80 bg-slate-950 shadow-\[0_10px_24px_rgba\(0,0,0,0\.2\)\]/);
  assert.match(source, /const \[isMobileViewport, setIsMobileViewport\] = useState\(false\)/);
  assert.match(source, /window\.matchMedia\("\(max-width: 639px\)"\)/);
  assert.match(source, /h-dvh w-full min-h-0 max-h-dvh max-w-none flex-col overflow-hidden rounded-none border-0/);
});

test("context file list keeps mobile scrolling single-layered and desktop totals visible", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/context-engine-dialog.tsx"), "utf8");

  assert.match(source, /flex min-h-0 flex-col overflow-hidden rounded-\[10px\].*xl:h-full/);
  assert.match(source, /min-h-0 sm:max-h-\[360px\] sm:overflow-y-auto xl:flex-1 xl:max-h-none/);
  assert.match(source, /shrink-0 flex items-center justify-between border-t border-\[var\(--ce-border-subtle\)\]/);
  assert.doesNotMatch(source, /ScrollArea/);
  assert.match(source, /grid h-dvh max-h-dvh w-screen max-w-none grid-rows/);
  assert.doesNotMatch(source, /lg:w-\[min\(90vw,1060px\)\]/);
  assert.match(source, /lg:h-full lg:overflow-hidden lg:p-0/);
  assert.match(source, /lg:h-full lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain/);
  assert.doesNotMatch(source, /lg:h-full lg:min-h-\[465px\] lg:overflow-visible/);
  assert.match(source, /flex snap-x snap-mandatory gap-2 overflow-x-auto/);
  assert.match(source, /w-\[112px\] shrink-0 snap-start/);
});

test("context engine shows Piko during real loading and saving work", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/context-engine-dialog.tsx"), "utf8");

  assert.match(source, /import \{ PikoLoader \} from "@\/components\/ui\/piko-loader"/);
  assert.match(source, /const isContextEngineBusy = open && \(isSavingContext \|\| isSavingFile \|\| isLoadingSnapshot \|\| isLoadingFile\)/);
  assert.match(source, /: isLoadingFile\s+\? "Loading context file"\s+: "Loading Context Engine"/);
  assert.match(source, /open=\{isContextEngineBusy\}/);
  assert.match(source, /Loading this agent's context configuration and runtime capability state\./);
});

test("context engine skills and tools uses real capability state and shared editing", () => {
  const dialogSource = readFileSync(path.join(rootDir, "components/mission-control/context-engine-dialog.tsx"), "utf8");
  const shellSource = readFileSync(path.join(rootDir, "components/mission-control/mission-control-shell.tsx"), "utf8");

  assert.match(dialogSource, /<SkillsToolsPanel snapshot=\{snapshot\} onConfigureCapabilities=\{onConfigureCapabilities\} \/>/);
  assert.match(dialogSource, /snapshot\?\.policy\.effectiveSkills\.length/);
  assert.match(dialogSource, /snapshot\?\.policy\.observedTools\.length/);
  assert.match(dialogSource, /onConfigureCapabilities\?\.\(snapshot\.agent\.id, "skills"\)/);
  assert.match(dialogSource, /onConfigureCapabilities\?\.\(snapshot\.agent\.id, "tools"\)/);
  assert.match(dialogSource, /formatCapabilityImpact\(skillsBudget\)/);
  assert.match(dialogSource, /capabilitiesRevision = 0/);
  assert.match(dialogSource, /void refreshSnapshot\(\)/);
  assert.match(shellSource, /<ContextEngineDialog[\s\S]*onConfigureCapabilities=\{handleConfigureAgentCapabilities\}/);
  assert.match(shellSource, /onSaved=\{\(\) => setCapabilitiesRevision\(\(current\) => current \+ 1\)\}/);
});

test("context engine overview is an actionable health dashboard backed by live context state", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/context-engine-dialog.tsx"), "utf8");

  assert.match(source, /<ContextOverviewDashboard/);
  assert.match(source, /hideHeadingOnMobile/);
  assert.match(source, /hasContextChanges=\{hasContextChanges\}/);
  assert.match(source, /onNavigate=\{setActiveTab\}/);
  assert.match(source, /problemFiles = files\.filter/);
  assert.match(source, /hasBudgetPressure/);
  assert.match(source, /snapshot\?\.runtimeReport\.status !== "exact"/);
  assert.match(source, /label: "Save context"/);
  assert.match(source, /label: "Review project context"/);
  assert.match(source, /label: "Review effective context"/);
  assert.match(source, /largestBudgetItems/);
  assert.match(source, /projectContextTokens = sumKnownTokens/);
  assert.match(source, /resolveOverviewBudget\(snapshot, projectContextTokens\)/);
  assert.match(source, /Project Context total from enabled files/);
  assert.match(source, /overviewBudget\.usedPercent !== null/);
  assert.match(source, /mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3/);
  assert.match(source, /Context delivery/);
  assert.match(source, /Runtime confidence/);
  assert.match(source, /grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-\[minmax\(0,1fr\)_minmax\(0,1fr\)_minmax\(280px,0\.9fr\)\]/);
  assert.match(source, /<span className="sm:hidden">Context: \{health\.label\}<\/span>/);
});

test("effective context is an actionable runtime truth view", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/context-engine-dialog.tsx"), "utf8");

  assert.match(source, /<EffectiveContextPanel snapshot=\{snapshot\} onNavigate=\{onNavigate\} \/>/);
  assert.match(source, /Exact runtime context/);
  assert.match(source, /Estimated context/);
  assert.match(source, /Context stack/);
  assert.match(source, /Not included or unavailable/);
  assert.match(source, /resolveEffectiveContextAction/);
  assert.match(source, /Open project context/);
  assert.match(source, /Review memory & history/);
  assert.match(source, /Review capabilities/);
  assert.match(source, /grid grid-cols-2 gap-2 rounded-\[9px\]/);
  assert.match(source, /grid grid-cols-2 gap-2 xl:grid-cols-3/);
  assert.match(source, /resolveEffectiveContextVisual/);
  assert.match(source, /group relative min-w-0 overflow-hidden rounded-\[10px\].*bg-\[var\(--ce-card\)\]/);
  assert.match(source, /--ce-panel": "#faf9f7"/);
  assert.match(source, /--ce-card": "#fffdfa"/);
  assert.match(source, /mobileLabel: "Project files"/);
  assert.match(source, /hidden h-8 w-8 shrink-0 items-center justify-center.*sm:flex/);
  assert.match(source, /const \[itemsExpanded, setItemsExpanded\] = useState\(false\)/);
  assert.match(source, /itemsExpanded \? section\.items : section\.items\.slice\(0, 2\)/);
  assert.match(source, /aria-expanded=\{itemsExpanded\}/);
  assert.match(source, /Show fewer context items/);
});

test("context engine memory uses real file reading and editing flows", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/context-engine-dialog.tsx"), "utf8");

  assert.match(source, /<MemoryHistoryPanel/);
  assert.match(source, /onOpenMemoryFile=\{\(file, mode\)/);
  assert.match(source, /setActiveTab\("project"\)/);
  assert.match(source, /onOpenFile\(file, "preview"\)/);
  assert.match(source, /onOpenFile\(file, "edit"\)/);
  assert.match(source, /Session transcript editing is not exposed by the current OpenClaw context API\./);
});

test("model dialogs use mobile fullscreen layouts with reachable actions", () => {
  const pickerSource = readFileSync(path.join(rootDir, "components/mission-control/agent-model-picker-dialog.tsx"), "utf8");
  const librarySource = readFileSync(path.join(rootDir, "components/mission-control/add-models/add-models-dialog.tsx"), "utf8");

  assert.match(pickerSource, /h-dvh max-h-dvh w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-0/);
  assert.match(pickerSource, /hidden min-h-0 overflow-y-auto rounded-\[18px\] border p-2\.5 lg:block/);
  assert.match(pickerSource, /<span className="ml-1\.5 text-\[0\.72rem\] lg:hidden">Library<\/span>/);
  assert.match(pickerSource, /const \[mobileFiltersOpen, setMobileFiltersOpen\] = useState\(false\)/);
  assert.match(pickerSource, /Filters\{activeFilterCount > 0/);
  assert.match(pickerSource, /radial-gradient\(circle_at_10%_0%,rgba\(124,58,237,0\.20\)/);
  assert.match(pickerSource, /bg-\[linear-gradient\(135deg,#8b5cf6,#6d28d9\)\]/);
  assert.match(pickerSource, /<PikoLoader[\s\S]*open=\{saving \|\| Boolean\(removingModelId\) \|\| deleteImpactLoading\}/);
  assert.match(librarySource, /h-dvh max-h-dvh w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-0/);
  assert.match(librarySource, /<PikoLoader[\s\S]*open=\{isModelOperationInProgress\}/);
  assert.match(librarySource, /isLoadingDangerImpact \|\|[\s\S]*isApplyingDangerAction \|\|[\s\S]*showLoadingHero/);
  assert.doesNotMatch(librarySource, /agentos-light-modal border-border bg-card text-card-foreground shadow-\[0_35px_100px/);
  assert.match(librarySource, /max-lg:\[&>button\]:w-auto/);
  assert.match(librarySource, /safe-area-inset-top/);
});

test("agent capability and connection dialogs use mobile fullscreen layouts", () => {
  const capabilityDialogSource = readFileSync(
    path.join(rootDir, "components/mission-control/agent-capability-editor-dialog.tsx"),
    "utf8"
  );
  const capabilityColumnSource = readFileSync(
    path.join(rootDir, "components/mission-control/agent-capability-editor-column.tsx"),
    "utf8"
  );
  const channelsDialogSource = readFileSync(
    path.join(rootDir, "components/mission-control/workspace-channels-dialog.tsx"),
    "utf8"
  );
  const accountsSource = readFileSync(
    path.join(rootDir, "components/operations/accounts/accounts-page-content.tsx"),
    "utf8"
  );

  assert.match(capabilityDialogSource, /h-dvh max-h-dvh w-screen max-w-none flex-col overflow-hidden rounded-none border-0/);
  assert.match(capabilityDialogSource, /safe-area-inset-bottom/);
  assert.match(capabilityDialogSource, /!flex-row border-t border-\[var\(--cap-border-subtle\)\]/);
  assert.match(capabilityDialogSource, /h-10 flex-1 rounded-\[8px\]/);
  assert.match(capabilityDialogSource, /const capabilityThemeStyles: Record<"dark" \| "light", CapabilityThemeStyle>/);
  assert.match(capabilityDialogSource, /bg-\[image:var\(--cap-surface\)\]/);
  assert.match(capabilityDialogSource, /border-violet-200\/35 bg-\[linear-gradient/);
  assert.match(capabilityDialogSource, /import \{ PikoLoader \} from "@\/components\/ui\/piko-loader"/);
  assert.match(capabilityDialogSource, /open=\{open && saving\}/);
  assert.match(capabilityDialogSource, /title=\{isSkillsEditor \? "Saving skills" : "Saving tools"\}/);
  assert.match(capabilityDialogSource, /setDraftSkills\(\(current\) => normalizeCapabilityValues\(\[value, \.\.\.current\]\)\)/);
  assert.match(capabilityDialogSource, /setDraftTools\(\(current\) => normalizeCapabilityValues\(\[value, \.\.\.current\]\)\)/);
  assert.match(capabilityColumnSource, /const \[showAllSelected, setShowAllSelected\] = useState\(false\)/);
  assert.match(capabilityColumnSource, /<div className="space-y-3">/);
  assert.doesNotMatch(capabilityColumnSource, /max-h-\[min\(38dvh,360px\)\]/);
  assert.match(capabilityColumnSource, /bg-\[var\(--cap-accent-soft\)\]/);
  assert.match(channelsDialogSource, /h-dvh max-h-dvh w-screen max-w-none flex-col overflow-hidden rounded-none border-0/);
  assert.match(channelsDialogSource, /const workspaceDialogThemeStyles: Record<"dark" \| "light", WorkspaceDialogThemeStyle>/);
  assert.match(channelsDialogSource, /bg-\[image:var\(--wi-surface\)\]/);
  assert.match(channelsDialogSource, /workspace \? `\$\{workspace\.name\} · accounts, owners, and routes`/);
  assert.match(channelsDialogSource, /safe-area-inset-top/);
  assert.match(channelsDialogSource, /overflow-x-hidden overflow-y-auto/);
  assert.match(channelsDialogSource, /flex h-9 w-full gap-1 overflow-x-auto rounded-\[10px\] border/);
  assert.match(channelsDialogSource, /min-w-\[148px\] shrink-0/);
  assert.match(accountsSource, /const connectAccountThemeStyles: Record<"dark" \| "light", ConnectAccountThemeStyle>/);
  assert.match(accountsSource, /bg-\[image:var\(--ca-surface\)\]/);
  assert.match(accountsSource, /h-dvh max-h-dvh w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-0/);
  assert.match(accountsSource, /min-h-0 flex-1 overflow-y-auto px-4 py-4/);
  assert.match(accountsSource, /!flex-row border-t border-\[var\(--ca-border-subtle\)\]/);
  assert.match(accountsSource, /const \[securityTipOpen, setSecurityTipOpen\] = useState\(false\)/);
  assert.match(accountsSource, /aria-label="Account login security information"/);
  assert.match(accountsSource, /AgentOS does not store raw passwords\. Complete login manually/);
});

test("model library keeps selected-model actions visible while browsing", () => {
  const pickerSource = readFileSync(
    path.join(rootDir, "components/mission-control/add-models/global-model-picker.tsx"),
    "utf8"
  );
  const librarySource = readFileSync(
    path.join(rootDir, "components/mission-control/add-models/add-models-dialog.tsx"),
    "utf8"
  );

  assert.match(pickerSource, /sticky bottom-0 z-10/);
  assert.match(pickerSource, /ready to add/);
  assert.match(pickerSource, /onClearSelected/);
  assert.match(librarySource, /function clearCatalogSelection\(\)/);
  assert.match(librarySource, /onClearSelected=\{clearCatalogSelection\}/);
});

test("model library focuses provider setup after a model selection", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/add-models/add-models-dialog.tsx"), "utf8");

  assert.match(source, /const providerSettingsRef = useRef<HTMLElement \| null>\(null\)/);
  assert.match(source, /providerSettingsRef\.current\?\.scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/);
  assert.match(source, /void selectProvider\(provider\.id, \{ scrollToSettings: true \}\)/);
  assert.match(source, /!wasSelected && isAddModelsProviderId\(providerId\)/);
  assert.match(source, /max-lg:\[&>button\]:w-auto/);
});

test("model library returns to change model when opened from its picker", () => {
  const librarySource = readFileSync(path.join(rootDir, "components/mission-control/add-models/add-models-dialog.tsx"), "utf8");
  const shellSource = readFileSync(path.join(rootDir, "components/mission-control/mission-control-shell.tsx"), "utf8");

  assert.match(librarySource, /onBack\?: \(\) => void/);
  assert.match(librarySource, /aria-label="Back to Change Model"/);
  assert.match(librarySource, /<ChevronLeft className="h-5 w-5" \/>/);
  assert.match(shellSource, /const \[returnToAgentModelId, setReturnToAgentModelId\] = useState<string \| null>\(null\)/);
  assert.match(shellSource, /const handleBackToAgentModelPicker = \(\) =>/);
  assert.match(shellSource, /onBack=\{returnToAgentModelId \? handleBackToAgentModelPicker : undefined\}/);
});

test("model library catalog fills the available dialog space", () => {
  const librarySource = readFileSync(path.join(rootDir, "components/mission-control/add-models/add-models-dialog.tsx"), "utf8");
  const pickerSource = readFileSync(path.join(rootDir, "components/mission-control/add-models/global-model-picker.tsx"), "utf8");

  assert.match(librarySource, /TabsContent value="catalog" className="!mt-0 m-0 flex h-full min-h-0 flex-col"/);
  assert.match(librarySource, /flex min-h-0 flex-1 flex-col space-y-2 px-3 py-3/);
  assert.match(pickerSource, /flex min-h-0 flex-1 flex-col rounded-\[15px\] border p-3/);
  assert.match(pickerSource, /mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto/);
});

test("model library keeps OpenClaw catalog failures visible and supports explicit providers", () => {
  const hookSource = readFileSync(path.join(rootDir, "hooks/use-model-catalog.ts"), "utf8");
  const routeSource = readFileSync(path.join(rootDir, "app/api/models/catalog/route.ts"), "utf8");
  const dialogSource = readFileSync(path.join(rootDir, "components/mission-control/add-models/add-models-dialog.tsx"), "utf8");

  assert.match(hookSource, /setError\(error instanceof Error \? error\.message : "OpenClaw catalog could not be loaded\."\)/);
  assert.match(routeSource, /import \{ isAddModelsProviderId \} from "@\/lib\/openclaw\/model-provider-registry"/);
  assert.doesNotMatch(routeSource, /return \[\s*"openai-codex"/);
  assert.match(dialogSource, /const CATALOG_PAGE_SIZE = 15/);
  assert.match(dialogSource, /setExplicitProviderIds\(\(current\) => current\.includes\(providerId\) \? current : \[\.\.\.current, providerId\]\)/);
  assert.match(dialogSource, /catalog model\{activeCatalogSelectedCount === 1 \? "" : "s"\} selected/);
  assert.match(dialogSource, /void refreshGlobalCatalog\(true\)/);
});

test("model library separates provider editing, credential disconnect, and custom deletion", () => {
  const dialogSource = readFileSync(
    path.join(rootDir, "components/mission-control/add-models/add-models-dialog.tsx"),
    "utf8"
  );
  const routeSource = readFileSync(path.join(rootDir, "app/api/models/providers/route.ts"), "utf8");

  assert.match(dialogSource, /Connection settings/);
  assert.match(dialogSource, /const result = await adapter\.getConnectionStatus\(\)/);
  assert.match(dialogSource, /Leave blank to keep the current credential/);
  assert.match(dialogSource, /Disconnect credential/);
  assert.match(dialogSource, /Keep configured models and remove API access/);
  assert.match(dialogSource, /Delete custom provider/);
  assert.match(dialogSource, /Review the OpenClaw impact before applying this change/);
  assert.doesNotMatch(dialogSource, /window\.confirm/);
  assert.match(routeSource, /action === "disconnect-credential"/);
  assert.match(routeSource, /action === "delete-provider"/);
  assert.match(routeSource, /Bundled OpenClaw providers cannot be deleted/);
  assert.match(
    readFileSync(path.join(rootDir, "lib/openclaw/model-provider-adapters.ts"), "utf8"),
    /disconnect-credential-impact"[\s\S]*allowNotOk: true/
  );
});

test("ChatGPT provider connection stays in-app and clears legacy terminal handoff state", () => {
  const dialogSource = readFileSync(
    path.join(rootDir, "components/mission-control/add-models/add-models-dialog.tsx"),
    "utf8"
  );
  const setupSource = readFileSync(
    path.join(rootDir, "components/mission-control/openclaw-onboarding-provider-flow.tsx"),
    "utf8"
  );
  const routeSource = readFileSync(path.join(rootDir, "app/api/models/providers/route.ts"), "utf8");

  assert.match(dialogSource, /manualCommand: null,[\s\S]*Opening ChatGPT authorization/);
  assert.match(dialogSource, /Complete the OpenClaw authorization page in your browser/);
  assert.match(setupSource, /<PikoLoader/);
  assert.match(setupSource, /manualCommand: null,[\s\S]*Opening ChatGPT authorization/);
  assert.match(routeSource, /connectOpenClawChatGptProvider/);
  assert.match(routeSource, /manualCommand: null/);
  assert.doesNotMatch(routeSource, /manualCommand:\s*authHandoff\.command/);
});

test("phase three model surfaces separate setup, assignment, and session scope", () => {
  const pickerSource = readFileSync(
    path.join(rootDir, "components/mission-control/agent-model-picker-dialog.tsx"),
    "utf8"
  );
  const catalogSource = readFileSync(
    path.join(rootDir, "components/mission-control/add-models/global-model-picker.tsx"),
    "utf8"
  );
  const inspectorSource = readFileSync(
    path.join(rootDir, "components/mission-control/inspector-panel.tsx"),
    "utf8"
  );
  const routeSource = readFileSync(path.join(rootDir, "app/api/sessions/model/route.ts"), "utf8");

  assert.match(pickerSource, /Global default/);
  assert.match(pickerSource, /Agent model/);
  assert.match(pickerSource, /Session overrides/);
  assert.match(pickerSource, /pendingSetupModelIdRef/);
  assert.match(pickerSource, /Show setup needed/);
  assert.doesNotMatch(pickerSource, /Model Settings/);
  assert.doesNotMatch(pickerSource, /Sort: Recent/);
  assert.match(catalogSource, /Provider credentials are managed in Providers/);
  assert.match(catalogSource, /Set up provider/);
  assert.match(inspectorSource, /Use agent model/);
  assert.match(routeSource, /action: z\.literal\("inherit"\)/);
});

test("global Models surface stays separate from session overrides", () => {
  const hookSource = readFileSync(path.join(rootDir, "hooks/use-model-catalog.ts"), "utf8");
  const dialogSource = readFileSync(
    path.join(rootDir, "components/mission-control/add-models/add-models-dialog.tsx"),
    "utf8"
  );
  const modelsSource = readFileSync(
    path.join(rootDir, "components/operations/models/models-page-content.tsx"),
    "utf8"
  );
  const routeSource = readFileSync(path.join(rootDir, "app/api/sessions/model/route.ts"), "utf8");
  const serviceSource = readFileSync(
    path.join(rootDir, "lib/openclaw/application/session-model-service.ts"),
    "utf8"
  );

  assert.match(hookSource, /MODEL_CATALOG_RECONCILE_INTERVAL_MS = 60_000/);
  assert.match(dialogSource, /Reconcile library/);
  assert.match(dialogSource, /OpenClaw verified/);
  assert.match(hookSource, /view = "default"/);
  assert.match(modelsSource, /action: "set-default"/);
  assert.match(modelsSource, /action: "set-fallbacks"/);
  assert.match(modelsSource, /Model access policy/);
  assert.doesNotMatch(modelsSource, /Session Model Overrides/);
  assert.doesNotMatch(modelsSource, /Reset all/);
  assert.match(routeSource, /action: z\.literal\("inherit-many"\)/);
  assert.match(serviceSource, /buildSessionModelOverrides\(currentSnapshot\)/);
  assert.match(serviceSource, /for \(const target of targets\)/);
});

function resolveLocalOpenClawImport(filePath: string, specifier: string) {
  if (specifier.startsWith("@/")) {
    return `${specifier.slice(2)}.ts`;
  }

  if (!specifier.startsWith(".")) {
    return null;
  }

  return `${toProjectPath(path.resolve(path.dirname(filePath), specifier))}.ts`;
}

function findCycles(graph: Map<string, string[]>) {
  const cycles: string[][] = [];
  const seen = new Set<string>();
  const active = new Set<string>();
  const stack: string[] = [];

  function visit(node: string) {
    seen.add(node);
    active.add(node);
    stack.push(node);

    for (const next of graph.get(node) ?? []) {
      if (!seen.has(next)) {
        visit(next);
        continue;
      }

      if (active.has(next)) {
        cycles.push([...stack.slice(stack.indexOf(next)), next]);
      }
    }

    stack.pop();
    active.delete(node);
  }

  for (const node of graph.keys()) {
    if (!seen.has(node)) {
      visit(node);
    }
  }

  return cycles.map((cycle) => cycle.join(" -> ")).sort();
}
