import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import {
  generateGatewayNativeAuthToken,
  getGatewayNativeAuthStatus,
  repairGatewayNativeDeviceAccess,
  saveGatewayNativeAuthCredential
} from "@/lib/openclaw/application/settings-service";
import {
  setOpenClawAdapterForTesting,
  type OpenClawAdapter
} from "@/lib/openclaw/adapter/openclaw-adapter";

function createSettingsAdapter(config: Record<string, unknown> = {}): OpenClawAdapter {
  const mutableConfig = { ...config };
  return {
    async getStatus() {
      return {};
    },
    async getGatewayStatus() {
      return {};
    },
    async getModelStatus() {
      return {};
    },
    async listAgents() {
      return { agents: [] };
    },
    async listSessions() {
      return { sessions: [] };
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
    async deleteAgent() {
      return { stdout: "", stderr: "", code: 0 };
    },
    async runAgentTurn() {
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
    async call<TPayload>() {
      return {} as TPayload;
    }
  };
}

afterEach(() => {
  setOpenClawAdapterForTesting(null);
  delete process.env.AGENTOS_OPENCLAW_GATEWAY_TOKEN;
  delete process.env.AGENTOS_OPENCLAW_GATEWAY_PASSWORD;
});

test("Gateway native auth token generation configures OpenClaw and local env without exposing the token", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "agentos-gateway-auth-generate-"));
  await writeFile(join(cwd, ".gitignore"), ".env*.local\n", "utf8");
  const adapter = createSettingsAdapter({
    "gateway.auth.mode": "token",
    "gateway.auth.token": "__OPENCLAW_REDACTED__"
  });
  setOpenClawAdapterForTesting(adapter);

  const result = await generateGatewayNativeAuthToken({ cwd });
  const envFile = await readFile(join(cwd, ".env.local"), "utf8");
  const configuredToken = await adapter.getConfig<string>("gateway.auth.token");

  assert.equal(result.activeEnvName, "AGENTOS_OPENCLAW_GATEWAY_TOKEN");
  assert.equal(result.restarted, true);
  assert.equal(typeof configuredToken, "string");
  assert.notEqual(configuredToken, "__OPENCLAW_REDACTED__");
  assert.match(envFile, /AGENTOS_OPENCLAW_GATEWAY_TOKEN="/);
  assert.ok(configuredToken);
  assert.equal(envFile.includes(configuredToken), true);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(configuredToken));
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
          approvedScopes: ["operator.read", "operator.write", "operator.admin"]
        }
      };
    },
    readDeviceAuthToken: async () => {
      return {
        token: "operator-device-token",
        scopes: ["operator.read", "operator.write", "operator.admin"]
      };
    }
  });

  assert.equal(probeCalls, 1);
  assert.equal(approveCalls, 1);
  assert.equal(result.approved, true);
  assert.equal(result.requestId, "request-1");
  assert.equal(result.deviceId, "device-1");
  assert.deepEqual(result.scopes, ["operator.read", "operator.write", "operator.admin"]);
  assert.equal(result.envSynced, false);
  assert.equal(result.activeEnvName, null);
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
