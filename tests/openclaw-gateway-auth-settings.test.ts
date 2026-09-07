import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import {
  generateGatewayNativeAuthToken,
  getGatewayBindMode,
  getGatewayNativeAuthStatus,
  repairGatewayNativeDeviceAccess,
  saveGatewayNativeAuthCredential
} from "@/lib/openclaw/application/settings-service";
import {
  setOpenClawAdapterForTesting,
  type OpenClawAdapter
} from "@/lib/openclaw/adapter/openclaw-adapter";
import { OpenClawLifecycleService, setOpenClawLifecycleServiceForTesting } from "@/lib/openclaw/lifecycle/service";

test("Gateway settings route unreachable Gateway repair to rollback or process recovery", () => {
  const source = readFileSync(join(process.cwd(), "components/mission-control/settings-control-center.tsx"), "utf8");

  assert.match(source, /hasOpenClawRollbackIssue/);
  assert.match(source, /gatewayAccessRepairBlockMessage/);
  assert.match(source, /Rollback to last working OpenClaw/);
  assert.match(source, /disabled=\{gatewayActionBusy \|\| Boolean\(gatewayAccessRepairDisabledReason\)\}/);
});

test("Gateway settings expose native OpenClaw diagnostics through Gateway control", () => {
  const settingsSource = readFileSync(join(process.cwd(), "components/mission-control/settings-control-center.tsx"), "utf8");
  const routeSource = readFileSync(join(process.cwd(), "app/api/gateway/control/route.ts"), "utf8");
  const serviceSource = readFileSync(join(process.cwd(), "lib/openclaw/application/gateway-service.ts"), "utf8");

  assert.match(settingsSource, /\{ action: "start", label: "Start"/);
  assert.match(settingsSource, /\{ action: "doctor", label: "Native diagnostics"/);
  assert.match(settingsSource, /Native diagnostics/);
  assert.match(settingsSource, /<NativeDoctorPanel/);
  assert.match(routeSource, /z\.enum\(\["start", "stop", "restart", "doctor"\]\)/);
  assert.match(serviceSource, /runOpenClaw\(\["doctor", "--fix"\]/);
});

test("Gateway settings separate live health from historical diagnostics", () => {
  const source = readFileSync(join(process.cwd(), "components/mission-control/settings-control-center.tsx"), "utf8");

  assert.match(source, /aria-label="Live Gateway health"/);
  assert.match(source, /Saved compatibility evidence does not override the live service, authentication, or transport state above\./);
  assert.match(source, /Historical evidence/);
  assert.match(source, /Show saved technical report/);
  assert.match(source, /Checked \{gatewayAuthStatus\?\.native\.checkedAt/);
});

test("Gateway settings prioritize actions from current service and auth state", () => {
  const source = readFileSync(join(process.cwd(), "components/mission-control/settings-control-center.tsx"), "utf8");

  assert.match(source, /resolveGatewayActionGuidance\(\{/);
  assert.match(source, /aria-label="Recommended Gateway action"/);
  assert.match(source, /The Gateway is already running\./);
  assert.match(source, /Local access repair is available when required operator scopes are missing\./);
  assert.match(source, /Token repair is available when the configured credential does not match the Gateway\./);
  assert.match(source, /Use a known credential/);
  assert.match(source, /disabled=\{isSavingGatewayAuthCredential \|\| !gatewayAuthCredential\.trim\(\)\}/);
});

test("Gateway operations keep visible progress and durable results", () => {
  const settingsSource = readFileSync(join(process.cwd(), "components/mission-control/settings-control-center.tsx"), "utf8");
  const shellSource = readFileSync(join(process.cwd(), "components/mission-control/mission-control-shell.tsx"), "utf8");

  assert.match(settingsSource, /aria-label="Gateway operation progress"/);
  assert.match(settingsSource, /"Prepare native request", "Request safe Gateway restart", "Await reconnect verification"/);
  assert.match(settingsSource, /finishGatewayOperation\("repair-token", "success"/);
  assert.match(settingsSource, /finishGatewayOperation\("repair-access", "error"/);
  assert.match(settingsSource, /Dismiss Gateway operation result/);
  assert.match(shellSource, /throw gatewayError;/);
});

test("Gateway settings keep operator controls ahead of collapsed technical detail", () => {
  const source = readFileSync(join(process.cwd(), "components/mission-control/settings-control-center.tsx"), "utf8");
  const serviceControlsIndex = source.indexOf("Service controls");
  const connectionSettingsIndex = source.indexOf("Connection settings");
  const compatibilityPanelIndex = source.indexOf("<CompatibilityPanel");

  assert.ok(serviceControlsIndex > 0);
  assert.ok(connectionSettingsIndex > serviceControlsIndex);
  assert.ok(compatibilityPanelIndex > connectionSettingsIndex);
  assert.match(source, /Native transport details/);
  assert.match(source, /shadow-none hover:bg-primary\/90 disabled:border disabled:border-border disabled:bg-muted/);
  assert.match(source, /action === "stop" &&/);
});

test("OpenClaw Control UI opens through the CLI bootstrap flow", () => {
  const settingsSource = readFileSync(join(process.cwd(), "components/mission-control/settings-control-center.tsx"), "utf8");
  const routeSource = readFileSync(join(process.cwd(), "app/api/openclaw/dashboard/route.ts"), "utf8");
  const serviceSource = readFileSync(join(process.cwd(), "lib/openclaw/application/gateway-service.ts"), "utf8");

  assert.match(settingsSource, /fetch\("\/api\/openclaw\/dashboard"/);
  assert.match(routeSource, /openOpenClawDashboard/);
  assert.match(serviceSource, /runOpenClaw\(\["dashboard"\]/);
  assert.doesNotMatch(settingsSource, /href=\{snapshot\.diagnostics\.dashboardUrl\}/);
});

test("mobile pairing verifies auth before enabling LAN and exposes short-lived fallback data", () => {
  const serviceSource = readFileSync(join(process.cwd(), "lib/openclaw/application/mobile-pairing-service.ts"), "utf8");
  const routeSource = readFileSync(join(process.cwd(), "app/api/openclaw/mobile-pairing/route.ts"), "utf8");
  const dialogSource = readFileSync(join(process.cwd(), "components/mission-control/openclaw-app-connect-dialog.tsx"), "utf8");
  const settingsSource = readFileSync(join(process.cwd(), "components/mission-control/settings-control-center.tsx"), "utf8");

  assert.match(serviceSource, /getGatewayNativeAuthStatus\(\)/);
  assert.match(serviceSource, /hasVerifiedGatewayAuthentication/);
  assert.match(serviceSource, /setConfig\(gatewayBindConfigKey, "lan"/);
  assert.match(serviceSource, /controlGateway\("restart"\)/);
  assert.match(serviceSource, /waitForMobilePairingSetupCode/);
  assert.match(serviceSource, /gatewayRestartReadyTimeoutMs = 30_000/);
  assert.match(serviceSource, /gateway starting\|retry shortly/);
  assert.match(serviceSource, /"device\.pair\.setupCode"/);
  assert.match(serviceSource, /runOpenClawJson<OpenClawSetupCodePayload>\(\["qr", "--json"\]/);
  assert.match(serviceSource, /decodeOpenClawMobileSetupCode\(setupCode\)/);
  assert.doesNotMatch(routeSource, /setupCode/);
  assert.doesNotMatch(routeSource, /bootstrapToken|pairingToken/);
  assert.match(routeSource, /"Cache-Control": "private, no-store, max-age=0"/);
  assert.match(dialogSource, /Connect OpenClaw App/);
  assert.match(dialogSource, /Pair your OpenClaw mobile app with this AgentOS workspace\./);
  assert.match(dialogSource, /Setup code fallback/);
  assert.match(dialogSource, /Manual setup/);
  assert.match(dialogSource, /leave Password blank/);
  assert.doesNotMatch(dialogSource, /Device connected/);
  assert.match(dialogSource, /onPairingPrepared\?\.\(\)/);
  assert.match(settingsSource, /onPairingPrepared=\{\(\) => void refreshGatewayBind\(\)\}/);
});

function createSettingsAdapter(config: Record<string, unknown> = {}): OpenClawAdapter {
  const mutableConfig = { ...config };
  return {
    async getHealth() {
      return { ok: true };
    },
    async getStatus() {
      return {};
    },
    async getUpdateStatus() {
      return {};
    },
    async getGatewayStatus() {
      return {};
    },
    async getModelStatus() {
      return {};
    },
    async getAgentModelStatus() {
      return {};
    },
    async setModelAuthOrder() {
      return { stdout: "", stderr: "", code: 0 };
    },
    async listAgents() {
      return { agents: [] };
    },
    async listSessions() {
      return { sessions: [] };
    },
    async describeSession() {
      return {};
    },
    async getSessionHistory() {
      return {};
    },
    async exportSession() {
      return {};
    },
    async listTasks() {
      return { tasks: [] };
    },
    async getTask() {
      return {};
    },
    async assignTask() {
      return {};
    },
    async cancelTask() {
      return {};
    },
    async listArtifacts() {
      return { artifacts: [] };
    },
    async getArtifact() {
      return {};
    },
    async putArtifact() {
      return {};
    },
    async deleteArtifact() {
      return {};
    },
    async getRuntimeSnapshot() {
      return {};
    },
    async getToolsCatalog() {
      return { agentId: "agent-1", profiles: [], groups: [] };
    },
    async getEffectiveTools() {
      return { agentId: "agent-1", profile: "full", groups: [] };
    },
    async invokeTool() {
      return { ok: true, toolName: "shell" };
    },
    async subscribeRuntimeEvents() {
      return {
        close() {
          return undefined;
        }
      };
    },
    async getChannelStatus() {
      return {
        ts: 0,
        channelOrder: [],
        channelLabels: {},
        channels: {},
        channelAccounts: {},
        channelDefaultAccountId: {}
      };
    },
    async getChannelLogs() {
      return { lines: [] };
    },
    async provisionChannelAccount() {
      return { stdout: JSON.stringify({ ok: true }), stderr: "" };
    },
    async removeChannelAccount() {
      return { stdout: JSON.stringify({ ok: true }), stderr: "" };
    },
    async setupGmailWebhook() {
      return { stdout: JSON.stringify({ ok: true }), stderr: "" };
    },
    async listModels() {
      return { models: [] };
    },
    async listSkills() {
      return { skills: [] };
    },
    async listPlugins() {
      return { plugins: [] };
    },
    async scanModels() {
      return [];
    },
    async getConfig<TPayload>(path: string) {
      return (Object.hasOwn(mutableConfig, path) ? mutableConfig[path] : null) as TPayload | null;
    },
    async getConfigSchema() {
      return null;
    },
    async lookupConfigSchema() {
      return null;
    },
    async hasConfig(path: string) {
      return Object.hasOwn(mutableConfig, path);
    },
    async setConfig(path: string, value: unknown) {
      mutableConfig[path] = value;
      return { stdout: "", stderr: "", code: 0 };
    },
    async unsetConfig() {
      return { stdout: "", stderr: "", code: 0 };
    },
    async addAgent() {
      return { stdout: "", stderr: "", code: 0 };
    },
    async updateAgent() {
      return { stdout: "", stderr: "", code: 0 };
    },
    async setAgentIdentity() {
      return { stdout: "", stderr: "", code: 0 };
    },
    async deleteAgent() {
      return { stdout: "", stderr: "", code: 0 };
    },
    async provisionAutomation() {
      return { stdout: "", stderr: "", code: 0 };
    },
    async runAgentTurn() {
      return {};
    },
    async abortAgentTurn() {
      return {};
    },
    async steerSession() {
      return {};
    },
    async injectChat() {
      return {};
    },
    async streamAgentTurn() {
      return {};
    },
    async probeGateway() {
      return {};
    },
    async controlGateway() {
      return {};
    },
    async approveDeviceAccess() {
      return { requestId: "latest", device: { deviceId: "device-1" } };
    },
    async call<TPayload>() {
      return {} as TPayload;
    },
    async tailLogs() {
      return {};
    },
    async listExecApprovals() {
      return {};
    },
    async resolveExecApproval() {
      return {};
    },
    async getCronStatus() {
      return {};
    },
    async listCronJobs() {
      return {};
    }
  };
}

function createSettingsLifecycleService() {
  return new OpenClawLifecycleService({
    env: {
      OPENCLAW_GATEWAY_BINARY: "/tmp/agentos-openclaw",
      OPENCLAW_STATE_DIR: "/tmp/agentos-settings-state",
      OPENCLAW_CONFIG_PATH: "/tmp/agentos-settings-state/openclaw.json"
    },
    resolveBinary: async () => "/tmp/agentos-openclaw",
    readinessProbe: async () => ({
      ready: true,
      authenticated: true,
      health: "live",
      protocolVersion: 4,
      version: "2026.9.1",
      sourceCommit: null,
      checkedAt: new Date().toISOString(),
      reason: null
    })
  });
}

afterEach(() => {
  setOpenClawAdapterForTesting(null);
  setOpenClawLifecycleServiceForTesting(null);
  delete process.env.AGENTOS_OPENCLAW_GATEWAY_TOKEN;
  delete process.env.AGENTOS_OPENCLAW_GATEWAY_PASSWORD;
  delete process.env.AGENTOS_PACKAGE_RUNTIME;
  delete process.env.AGENTOS_RUNTIME_DIR;
  delete process.env.OPENCLAW_STATE_DIR;
});

beforeEach(() => {
  setOpenClawLifecycleServiceForTesting(createSettingsLifecycleService());
});

test("Gateway settings read the current bind through native config without exposing the config snapshot", async () => {
  setOpenClawAdapterForTesting(createSettingsAdapter({
    "gateway.bind": "lan"
  }));

  assert.equal(await getGatewayBindMode(), "lan");

  setOpenClawAdapterForTesting(createSettingsAdapter());
  assert.equal(await getGatewayBindMode(), "loopback");

  const routeSource = readFileSync(join(process.cwd(), "app/api/settings/gateway/route.ts"), "utf8");
  const settingsSource = readFileSync(join(process.cwd(), "components/mission-control/settings-control-center.tsx"), "utf8");

  assert.match(routeSource, /gatewayBind: await getGatewayBindMode\(\)/);
  assert.match(settingsSource, /fetch\("\/api\/settings\/gateway\?view=bind", \{ cache: "no-store" \}\)/);
  assert.match(settingsSource, /displayedGatewayBind=\{displayedGatewayBind\}/);
  assert.match(settingsSource, /<span className="font-medium">Gateway bind:<\/span> \{displayedGatewayBind\}/);
  assert.match(settingsSource, /detail=\{`Bind: \$\{displayedGatewayBind\}`\}/);
  assert.match(settingsSource, /OPENCLAW_DEFAULT_GATEWAY_BIND_MODE/);
  assert.match(settingsSource, /document\.addEventListener\("visibilitychange", refreshWhenVisible\)/);
  assert.doesNotMatch(settingsSource, /refreshInterval/);
});

test("Gateway native auth token generation configures OpenClaw and local env without exposing the token", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "agentos-gateway-auth-generate-"));
  await writeFile(join(cwd, ".gitignore"), ".env*.local\n", "utf8");
  const adapter = createSettingsAdapter({
    "gateway.auth.mode": "token",
    "gateway.auth.token": "__OPENCLAW_REDACTED__"
  });
  setOpenClawAdapterForTesting(adapter);

  const result = await generateGatewayNativeAuthToken({
    cwd,
    verifyNativeAuth: async () => ({ version: "9.9.9" })
  });
  const envFile = await readFile(join(cwd, ".env.local"), "utf8");
  const configuredToken = await adapter.getConfig<string>("gateway.auth.token");

  assert.equal(result.activeEnvName, "AGENTOS_OPENCLAW_GATEWAY_TOKEN");
  assert.equal(result.restarted, true);
  assert.equal(result.verified, true);
  assert.equal(typeof configuredToken, "string");
  assert.notEqual(configuredToken, "__OPENCLAW_REDACTED__");
  assert.match(envFile, /AGENTOS_OPENCLAW_GATEWAY_TOKEN="/);
  assert.ok(configuredToken);
  assert.equal(envFile.includes(configuredToken), true);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(configuredToken));
});

test("Gateway native auth token repair gives CLI config fallback enough time to start", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "agentos-gateway-auth-timeout-"));
  const adapter = createSettingsAdapter();
  const mutationTimeouts: Array<number | undefined> = [];
  const originalSetConfig = adapter.setConfig.bind(adapter);
  adapter.setConfig = async (path, value, options) => {
    mutationTimeouts.push(options?.timeoutMs);
    return originalSetConfig(path, value, options);
  };
  setOpenClawAdapterForTesting(adapter);

  await generateGatewayNativeAuthToken({
    cwd,
    verifyNativeAuth: async () => ({ version: "9.9.9" })
  });

  assert.deepEqual(mutationTimeouts, [30_000, 30_000]);
});

test("Gateway native auth token repair restarts before writing the development env file", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "agentos-gateway-auth-order-"));
  const adapter = createSettingsAdapter();
  let envFileExistedDuringRestart = true;
  adapter.controlGateway = async () => {
    envFileExistedDuringRestart = existsSync(join(cwd, ".env.local"));
    return {};
  };
  setOpenClawAdapterForTesting(adapter);

  await generateGatewayNativeAuthToken({
    cwd,
    verifyNativeAuth: async () => ({ version: "9.9.9" })
  });

  assert.equal(envFileExistedDuringRestart, false);
  assert.equal(existsSync(join(cwd, ".env.local")), true);
});

test("Gateway native auth token generation restarts even when auth config reports hot reload", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "agentos-gateway-auth-hot-reload-"));
  const adapter = createSettingsAdapter();
  const controlActions: Array<{ action: string; force?: boolean }> = [];
  const setConfigPaths: string[] = [];
  adapter.setConfig = async (path: string) => {
    setConfigPaths.push(path);
    return {
      stdout: JSON.stringify({ configMutation: { reloadKind: "hot" } }),
      stderr: "",
      code: 0,
      metadata: {
        openClawConfig: {
          reloadKind: "hot",
          restartRequired: false,
          hotReloaded: true
        }
      }
    };
  };
  adapter.controlGateway = async (action, options) => {
    controlActions.push({ action, force: options?.force });
    return {};
  };
  setOpenClawAdapterForTesting(adapter);

  const result = await generateGatewayNativeAuthToken({
    cwd,
    verifyNativeAuth: async () => ({ version: "9.9.9" })
  });

  assert.equal(result.restartRequired, true);
  assert.equal(result.restarted, true);
  assert.deepEqual(controlActions, [{ action: "restart", force: true }]);
  assert.deepEqual(setConfigPaths, ["gateway.auth.mode", "gateway.auth.token"]);
});

test("Gateway native auth token generation stop-start cycles when forced restart does not verify", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "agentos-gateway-auth-cycle-"));
  const adapter = createSettingsAdapter();
  const controlActions: Array<{ action: string; force?: boolean }> = [];
  let verifyAttempts = 0;
  adapter.setConfig = async () => ({
    stdout: JSON.stringify({ configMutation: { reloadKind: "restart" } }),
    stderr: "",
    code: 0,
    metadata: {
      openClawConfig: {
        reloadKind: "restart",
        restartRequired: true,
        hotReloaded: false
      }
    }
  });
  adapter.controlGateway = async (action, options) => {
    controlActions.push({ action, force: options?.force });
    return {};
  };
  setOpenClawAdapterForTesting(adapter);

  const result = await generateGatewayNativeAuthToken({
    cwd,
    verifyDelaysMs: [0],
    verifyNativeAuth: async () => {
      verifyAttempts += 1;

      if (verifyAttempts === 1) {
        throw new Error("unauthorized: gateway token mismatch (provide gateway auth token)");
      }

      return { version: "9.9.9" };
    }
  });

  assert.equal(result.restarted, true);
  assert.equal(result.verified, true);
  assert.deepEqual(controlActions, [
    { action: "restart", force: true },
    { action: "stop", force: undefined },
    { action: "start", force: undefined }
  ]);
});

test("Gateway native auth status explains redacted config secrets without exposing them", async () => {
  setOpenClawAdapterForTesting(
    createSettingsAdapter({
      "gateway.auth.mode": "token",
      "gateway.auth.token": "__OPENCLAW_REDACTED__"
    })
  );

  const status = await getGatewayNativeAuthStatus({
    env: {},
    now: () => new Date("2026-05-03T12:00:00.000Z"),
    nativeProbe: async () => {
      const error = new Error("gateway.auth.token is configured but OpenClaw returned a redacted secret.");
      Object.assign(error, { kind: "auth" });
      throw error;
    }
  });

  assert.equal(status.mode, "token");
  assert.equal(status.env.token, false);
  assert.equal(status.config.authToken, "redacted");
  assert.equal(status.native.kind, "auth");
  assert.match(status.recommendation, /AGENTOS_OPENCLAW_GATEWAY_TOKEN/);
});

test("Gateway native auth status reports ready when env credentials authenticate", async () => {
  setOpenClawAdapterForTesting(
    createSettingsAdapter({
      "gateway.auth.mode": "token",
      "gateway.auth.token": "__OPENCLAW_REDACTED__"
    })
  );

  const status = await getGatewayNativeAuthStatus({
    env: {
      AGENTOS_OPENCLAW_GATEWAY_TOKEN: "test-token"
    },
    nativeProbe: async () => ({ version: "9.9.9" })
  });

  assert.equal(status.native.ok, true);
  assert.equal(status.env.token, true);
  assert.equal(status.config.authToken, "redacted");
  assert.equal(status.recommendation, "Native OpenClaw Gateway WS auth is ready.");
});

test("Gateway native auth status does not fan out config probes after invalid config", async () => {
  let getConfigCalls = 0;
  const adapter = createSettingsAdapter();
  setOpenClawAdapterForTesting({
    ...adapter,
    async call() {
      throw new Error(
        "OpenClaw config is invalid\nStatus, health, logs, and doctor commands still run with invalid config."
      );
    },
    async getConfig() {
      getConfigCalls += 1;
      return null;
    }
  });

  const status = await getGatewayNativeAuthStatus({
    env: {},
    nativeProbe: async () => ({ version: "9.9.9" })
  });

  assert.equal(getConfigCalls, 0);
  assert.equal(status.config.authToken, "unknown");
  assert.equal(status.config.authPassword, "unknown");
  assert.equal(status.native.ok, true);
});

test("Gateway native auth status directs scope-limited failures to local access repair", async () => {
  setOpenClawAdapterForTesting(createSettingsAdapter());

  const status = await getGatewayNativeAuthStatus({
    env: {
      AGENTOS_OPENCLAW_GATEWAY_TOKEN: "test-token"
    },
    nativeProbe: async () => {
      const error = new Error("INVALID_REQUEST: missing scope: operator.read");
      Object.assign(error, { kind: "scope-limited" });
      throw error;
    }
  });

  assert.equal(status.native.kind, "scope-limited");
  assert.match(status.recommendation, /Repair the local AgentOS device access request/);
  assert.doesNotMatch(status.recommendation, /token\/password/i);
});

test("Gateway native auth device access repair approves latest local scope request", async () => {
  setOpenClawAdapterForTesting(createSettingsAdapter());
  process.env.OPENCLAW_STATE_DIR = await mkdtemp(join(tmpdir(), "agentos-gateway-device-repair-"));
  let probeCalls = 0;
  let approveCalls = 0;

  const result = await repairGatewayNativeDeviceAccess({
    nativeProbe: async () => {
      probeCalls += 1;
      const error = new Error("INVALID_REQUEST: missing scope: operator.read");
      Object.assign(error, { kind: "scope-limited" });
      throw error;
    },
    approveLatest: async () => {
      approveCalls += 1;
      return {
        requestId: "request-1",
        device: {
          deviceId: "device-1",
          approvedScopes: [
            "operator.admin",
            "operator.read",
            "operator.write",
            "operator.approvals",
            "operator.questions",
            "operator.pairing",
            "operator.talk",
            "operator.talk.secrets"
          ]
        }
      };
    },
    readDeviceAuthToken: async () => {
      return {
        token: "operator-device-token",
        scopes: [
          "operator.admin",
          "operator.read",
          "operator.write",
          "operator.approvals",
          "operator.questions",
          "operator.pairing",
          "operator.talk",
          "operator.talk.secrets"
        ]
      };
    }
  });

  assert.equal(probeCalls, 1);
  assert.equal(approveCalls, 1);
  assert.equal(result.approved, true);
  assert.equal(result.requestId, "request-1");
  assert.equal(result.deviceId, "device-1");
  assert.deepEqual(result.scopes, [
    "operator.admin",
    "operator.read",
    "operator.write",
    "operator.approvals",
    "operator.questions",
    "operator.pairing",
    "operator.talk",
    "operator.talk.secrets"
  ]);
  assert.equal(result.envSynced, false);
  assert.equal(result.activeEnvName, null);
});

test("Gateway device repair probes admin-level config access instead of read-only status", () => {
  const source = readFileSync(
    join(process.cwd(), "lib/openclaw/application/settings-service.ts"),
    "utf8"
  );

  assert.match(source, /options\.nativeProbe \?\? \(\(\) => assertGatewayNativeConfigMutationAccess/);
  assert.match(source, /includeDeviceIdentityWithExplicitAuth: true/);
  assert.match(source, /ensureDeviceIdentity: true/);
  assert.match(source, /callNative\("config\.schema\.lookup", \{ path: "agents\.entries" \}/);
  assert.doesNotMatch(source, /probeGatewayNativeStatusForDeviceAccessRepair/);
});

test("Gateway native auth device access repair still approves CLI scopes when native auth already works", async () => {
  setOpenClawAdapterForTesting(createSettingsAdapter());
  process.env.OPENCLAW_STATE_DIR = await mkdtemp(join(tmpdir(), "agentos-gateway-device-repair-"));
  let probeCalls = 0;
  let approveCalls = 0;

  const result = await repairGatewayNativeDeviceAccess({
    nativeProbe: async () => {
      probeCalls += 1;
      return { version: "9.9.9" };
    },
    approveLatest: async () => {
      approveCalls += 1;
      return {
        requestId: "request-1",
        device: {
          deviceId: "device-1",
          approvedScopes: [
            "operator.admin",
            "operator.read",
            "operator.write",
            "operator.approvals",
            "operator.questions",
            "operator.pairing",
            "operator.talk",
            "operator.talk.secrets"
          ]
        }
      };
    },
    readDeviceAuthToken: async () => {
      return {
        token: "operator-device-token",
        scopes: [
          "operator.admin",
          "operator.read",
          "operator.write",
          "operator.approvals",
          "operator.questions",
          "operator.pairing",
          "operator.talk",
          "operator.talk.secrets"
        ]
      };
    }
  });

  assert.equal(probeCalls, 1);
  assert.equal(approveCalls, 1);
  assert.equal(result.approved, true);
  assert.equal(result.requestId, "request-1");
  assert.equal(result.deviceId, "device-1");
  assert.deepEqual(result.scopes, [
    "operator.admin",
    "operator.read",
    "operator.write",
    "operator.approvals",
    "operator.questions",
    "operator.pairing",
    "operator.talk",
    "operator.talk.secrets"
  ]);
  assert.equal(result.approvalIssue, null);
});

test("Gateway native auth device access repair syncs approved pairing token for CLI harnesses", async () => {
  setOpenClawAdapterForTesting(createSettingsAdapter());
  const stateDir = await mkdtemp(join(tmpdir(), "agentos-gateway-device-sync-"));
  const deviceId = "device-1";
  const scopes = [
    "operator.admin",
    "operator.read",
    "operator.write",
    "operator.approvals",
    "operator.questions",
    "operator.pairing",
    "operator.talk",
    "operator.talk.secrets"
  ];
  process.env.OPENCLAW_STATE_DIR = stateDir;
  await mkdir(join(stateDir, "identity"), { recursive: true });
  await mkdir(join(stateDir, "devices"), { recursive: true });
  await writeFile(join(stateDir, "identity", "device.json"), JSON.stringify({
    version: 1,
    deviceId
  }), "utf8");
  await writeFile(join(stateDir, "identity", "device-auth.json"), JSON.stringify({
    version: 1,
    deviceId,
    tokens: {
      operator: {
        token: "old-token",
        role: "operator",
        scopes: ["operator.read"]
      }
    }
  }), "utf8");
  await writeFile(join(stateDir, "devices", "paired.json"), JSON.stringify({
    [deviceId]: {
      deviceId,
      tokens: {
        operator: {
          token: "new-token",
          role: "operator",
          scopes
        }
      }
    }
  }), "utf8");

  const result = await repairGatewayNativeDeviceAccess({
    nativeProbe: async () => ({ version: "9.9.9" }),
    approveLatest: async () => ({
      requestId: "request-1",
      device: {
        deviceId,
        approvedScopes: scopes
      }
    })
  });
  const authStore = JSON.parse(await readFile(join(stateDir, "identity", "device-auth.json"), "utf8")) as {
    tokens?: {
      operator?: {
        token?: string;
        scopes?: string[];
      };
    };
  };

  assert.equal(result.approved, true);
  assert.deepEqual(result.scopes, scopes);
  assert.equal(authStore.tokens?.operator?.token, "new-token");
  assert.deepEqual(authStore.tokens?.operator?.scopes, scopes);
});

test("Gateway native auth device access repair trusts verified native access when CLI token scopes lag", async () => {
  setOpenClawAdapterForTesting(createSettingsAdapter());
  process.env.OPENCLAW_STATE_DIR = await mkdtemp(join(tmpdir(), "agentos-gateway-token-lag-"));
  let probeCalls = 0;

  const result = await repairGatewayNativeDeviceAccess({
    nativeProbe: async () => {
      probeCalls += 1;
      if (probeCalls === 1) {
        throw new Error("scope upgrade pending approval");
      }
      return { ok: true };
    },
    approveLatest: async () => ({
      requestId: "request-1",
      device: {
        deviceId: "device-1",
        approvedScopes: ["operator.read"]
      }
    }),
    readDeviceAuthToken: async () => ({
      token: "operator-device-token",
      scopes: ["operator.read"]
    })
  });

  assert.equal(probeCalls, 2);
  assert.equal(result.approved, true);
  assert.deepEqual(result.scopes, [
    "operator.admin",
    "operator.read",
    "operator.write",
    "operator.approvals",
    "operator.questions",
    "operator.pairing",
    "operator.talk",
    "operator.talk.secrets"
  ]);
  assert.match(result.approvalIssue ?? "", /local CLI device token has not reported/);
});

test("Gateway native auth device access repair is idempotent when native access is already valid", async () => {
  setOpenClawAdapterForTesting(createSettingsAdapter());
  process.env.OPENCLAW_STATE_DIR = await mkdtemp(join(tmpdir(), "agentos-gateway-repair-idempotent-"));
  let probeCalls = 0;

  const result = await repairGatewayNativeDeviceAccess({
    nativeProbe: async () => {
      probeCalls += 1;
      return { ok: true };
    },
    approveLatest: async () => {
      throw new Error("No pending OpenClaw device access request found.");
    },
    readDeviceAuthToken: async () => ({
      token: "operator-device-token",
      scopes: ["operator.read"]
    })
  });

  assert.equal(probeCalls, 1);
  assert.equal(result.approved, true);
  assert.deepEqual(result.scopes, [
    "operator.admin",
    "operator.read",
    "operator.write",
    "operator.approvals",
    "operator.questions",
    "operator.pairing",
    "operator.talk",
    "operator.talk.secrets"
  ]);
  assert.match(result.approvalIssue ?? "", /No pending OpenClaw device access request found/);
});

test("Gateway native auth status does not probe when native WS is force-disabled", async () => {
  setOpenClawAdapterForTesting(createSettingsAdapter());
  let probeCalls = 0;

  const status = await getGatewayNativeAuthStatus({
    env: {},
    isNativeDisabled: () => true,
    nativeProbe: async () => {
      probeCalls += 1;
      return {};
    }
  });

  assert.equal(probeCalls, 0);
  assert.equal(status.native.disabledByEnv, true);
  assert.equal(status.native.kind, "disabled");
  assert.match(status.recommendation, /AGENTOS_OPENCLAW_NATIVE_WS/);
});

test("Gateway native auth credential save writes a gitignored local env file without returning secrets", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "agentos-gateway-auth-"));
  await writeFile(join(cwd, ".gitignore"), ".env*.local\n", "utf8");

  const result = await saveGatewayNativeAuthCredential({
    kind: "token",
    value: "test-token",
    cwd
  });
  const envFile = await readFile(join(cwd, ".env.local"), "utf8");

  assert.equal(result.envFile, ".env.local");
  assert.equal(result.activeEnvName, "AGENTOS_OPENCLAW_GATEWAY_TOKEN");
  assert.equal(result.restartRecommended, true);
  assert.match(envFile, /AGENTOS_OPENCLAW_GATEWAY_TOKEN="test-token"/);
  assert.doesNotMatch(JSON.stringify(result), /test-token/);

  setOpenClawAdapterForTesting(createSettingsAdapter());
  const status = await getGatewayNativeAuthStatus({
    cwd,
    env: {},
    nativeProbe: async () => ({})
  });

  assert.equal(status.envFile.token, true);
  assert.equal(status.envFile.password, false);
  assert.equal(status.envFile.gitignored, true);
});

test("Gateway native auth credential save uses user runtime state in packaged runtime", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "agentos-gateway-auth-package-cwd-"));
  const runtimeDir = await mkdtemp(join(tmpdir(), "agentos-gateway-auth-runtime-"));
  process.env.AGENTOS_PACKAGE_RUNTIME = "1";
  process.env.AGENTOS_RUNTIME_DIR = runtimeDir;

  const result = await saveGatewayNativeAuthCredential({
    kind: "token",
    value: "package-token",
    cwd
  });
  const stateFile = await readFile(join(runtimeDir, "openclaw-gateway-auth.json"), "utf8");

  assert.equal(existsSync(join(cwd, ".env.local")), false);
  assert.equal(result.envFile, "openclaw-gateway-auth.json");
  assert.equal(result.activeEnvName, "AGENTOS_OPENCLAW_GATEWAY_TOKEN");
  assert.doesNotMatch(JSON.stringify(result), /package-token/);
  assert.match(stateFile, /"kind": "token"/);
  assert.match(stateFile, /"value": "package-token"/);
  assert.equal((await stat(join(runtimeDir, "openclaw-gateway-auth.json"))).mode & 0o777, 0o600);

  setOpenClawAdapterForTesting(createSettingsAdapter());
  const status = await getGatewayNativeAuthStatus({
    cwd,
    env: {},
    nativeProbe: async () => ({})
  });

  assert.equal(status.envFile.path, join(runtimeDir, "openclaw-gateway-auth.json"));
  assert.equal(status.envFile.token, true);
  assert.equal(status.envFile.password, false);
  assert.equal(status.envFile.gitignored, true);
});
