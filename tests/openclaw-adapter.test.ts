import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { controlGateway } from "@/lib/openclaw/application/gateway-service";
import { getOpenClawAdapter, setOpenClawAdapterForTesting } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  settleGatewayStatusPayloadFromOpenClaw,
  settleModelStatusPayloadFromOpenClaw,
  settleStatusPayloadFromOpenClaw
} from "@/lib/openclaw/adapter/gateway-payloads";
import {
  getOpenClawGatewayClient,
  setOpenClawGatewayClientForTesting,
  setOpenClawGatewayClientProvider
} from "@/lib/openclaw/client/gateway-client-factory";
import type {
  OpenClawCommandOptions,
  OpenClawGatewayClient
} from "@/lib/openclaw/client/gateway-client";

type MockCall = {
  method: string;
  action?: string;
  options?: OpenClawCommandOptions;
};

function createMockGatewayClient(overrides: Partial<OpenClawGatewayClient> = {}) {
  const calls: MockCall[] = [];
  const client: OpenClawGatewayClient = {
    async getStatus(options?: OpenClawCommandOptions) {
      calls.push({ method: "getStatus", options });
      return { version: "1.2.3" };
    },
    async getGatewayStatus(options?: OpenClawCommandOptions) {
      calls.push({ method: "getGatewayStatus", options });
      return { rpc: { ok: true }, gateway: { port: 18789 } };
    },
    async getModelStatus(options?: OpenClawCommandOptions) {
      calls.push({ method: "getModelStatus", options });
      return { defaultModel: "openai/gpt-5" };
    },
    async listAgents(options?: OpenClawCommandOptions) {
      calls.push({ method: "listAgents", options });
      return { agents: [] };
    },
    async listSessions(_input, options?: OpenClawCommandOptions) {
      calls.push({ method: "listSessions", options });
      return { sessions: [] };
    },
    async getChannelStatus(_input, options?: OpenClawCommandOptions) {
      calls.push({ method: "getChannelStatus", options });
      return {
        ts: 0,
        channelOrder: [],
        channelLabels: {},
        channels: {},
        channelAccounts: {},
        channelDefaultAccountId: {}
      };
    },
    async controlGateway(action: "start" | "stop" | "restart", options?: OpenClawCommandOptions) {
      calls.push({ method: "controlGateway", action, options });
      return { ok: true, action };
    },
    async probeGateway(options?: OpenClawCommandOptions) {
      calls.push({ method: "probeGateway", options });
      return {};
    },
    async call<TPayload>(method: string, params?: Record<string, unknown>, options?: OpenClawCommandOptions) {
      calls.push({ method: "call", action: method, options });
      return { params } as TPayload;
    },
    async getConfig<TPayload>(path: string, options?: OpenClawCommandOptions) {
      calls.push({ method: "getConfig", action: path, options });
      return { path } as TPayload;
    },
    async hasConfig(path: string, options?: OpenClawCommandOptions) {
      calls.push({ method: "hasConfig", action: path, options });
      return true;
    },
    async setConfig(path: string, _value: unknown, options?: OpenClawCommandOptions & { strictJson?: boolean }) {
      calls.push({ method: "setConfig", action: path, options });
      return { stdout: "", stderr: "", code: 0 };
    },
    async unsetConfig(path: string, options?: OpenClawCommandOptions) {
      calls.push({ method: "unsetConfig", action: path, options });
      return { stdout: "", stderr: "", code: 0 };
    },
    async addAgent(input, options?: OpenClawCommandOptions) {
      calls.push({ method: "addAgent", action: input.id, options });
      return { stdout: "", stderr: "", code: 0 };
    },
    async deleteAgent(agentId: string, options?: OpenClawCommandOptions) {
      calls.push({ method: "deleteAgent", action: agentId, options });
      return { stdout: "", stderr: "", code: 0 };
    },
    async runAgentTurn(input, options?: OpenClawCommandOptions) {
      calls.push({ method: "runAgentTurn", action: input.agentId, options });
      return { runId: "run-1" };
    },
    async streamAgentTurn(input, _callbacks, options?: OpenClawCommandOptions) {
      calls.push({ method: "streamAgentTurn", action: input.agentId, options });
      return { runId: "run-2" };
    },
    async listSkills(options?: OpenClawCommandOptions & { eligible?: boolean }) {
      calls.push({ method: "listSkills", options });
      return { skills: [] };
    },
    async listPlugins(options?: OpenClawCommandOptions) {
      calls.push({ method: "listPlugins", options });
      return { plugins: [] };
    },
    async listModels(_input, options?: OpenClawCommandOptions) {
      calls.push({ method: "listModels", options });
      return { models: [] };
    },
    async scanModels(options?: OpenClawCommandOptions & { yes?: boolean; noInput?: boolean; noProbe?: boolean }) {
      calls.push({ method: "scanModels", options });
      return [];
    },
  };
  Object.assign(client, overrides);

  return { client, calls };
}

afterEach(() => {
  setOpenClawGatewayClientProvider(null);
  setOpenClawGatewayClientForTesting(null);
  setOpenClawAdapterForTesting(null);
});

test("OpenClaw adapter status slice uses the injected gateway client", async () => {
  const { client, calls } = createMockGatewayClient();
  setOpenClawGatewayClientForTesting(client);

  const [statusResult, gatewayResult, modelResult] = await Promise.all([
    settleStatusPayloadFromOpenClaw(111),
    settleGatewayStatusPayloadFromOpenClaw(222),
    settleModelStatusPayloadFromOpenClaw(333)
  ]);

  assert.equal(statusResult.status, "fulfilled");
  assert.equal(gatewayResult.status, "fulfilled");
  assert.equal(modelResult.status, "fulfilled");
  assert.deepEqual(calls, [
    { method: "getStatus", options: { timeoutMs: 111 } },
    { method: "getGatewayStatus", options: { timeoutMs: 222 } },
    { method: "getModelStatus", options: { timeoutMs: 333 } }
  ]);
});

test("OpenClaw adapter status settlement preserves rejected payload shape", async () => {
  const failure = new Error("status failed");
  const { client } = createMockGatewayClient({
    async getStatus() {
      throw failure;
    }
  });
  setOpenClawGatewayClientForTesting(client);

  const result = await settleStatusPayloadFromOpenClaw(444);

  assert.equal(result.status, "rejected");
  assert.equal(result.reason, failure);
});

test("gateway application service controls the gateway through the adapter", async () => {
  const { client, calls } = createMockGatewayClient();
  setOpenClawGatewayClientForTesting(client);

  const result = await controlGateway("restart");

  assert.deepEqual(result, { ok: true, action: "restart" });
  assert.deepEqual(calls, [
    { method: "controlGateway", action: "restart", options: {} }
  ]);
});

test("OpenClaw gateway client factory supports a provider extension point", () => {
  const { client } = createMockGatewayClient();
  setOpenClawGatewayClientProvider(() => client);

  assert.equal(getOpenClawGatewayClient(), client);
});

test("OpenClaw adapter exposes catalog, config, agent turn, and probe methods", async () => {
  const { client, calls } = createMockGatewayClient();
  setOpenClawGatewayClientForTesting(client);

  const adapter = getOpenClawAdapter();
  await adapter.listSkills({ eligible: true, timeoutMs: 1 });
  await adapter.listPlugins({ timeoutMs: 2 });
  await adapter.listModels({ all: true }, { timeoutMs: 3 });
  await adapter.scanModels({ yes: true, noInput: true, timeoutMs: 4 });
  await adapter.listAgents({ timeoutMs: 4 });
  await adapter.listSessions({ limit: 1 }, { timeoutMs: 4 });
  await adapter.getChannelStatus({ probe: true }, { timeoutMs: 4 });
  assert.deepEqual(await adapter.getConfig("gateway", { timeoutMs: 5 }), { path: "gateway" });
  assert.equal(await adapter.hasConfig("gateway.remote.url", { timeoutMs: 6 }), true);
  await adapter.setConfig("gateway.remote.url", "ws://127.0.0.1:18789", { strictJson: true, timeoutMs: 7 });
  await adapter.unsetConfig("gateway.remote.url", { timeoutMs: 8 });
  await adapter.addAgent({ id: "agent-1", workspace: "/workspace", agentDir: "/agent" }, { timeoutMs: 9 });
  await adapter.deleteAgent("agent-1", { timeoutMs: 10 });
  assert.deepEqual(await adapter.runAgentTurn({ agentId: "agent-1", message: "hello" }, { timeoutMs: 11 }), {
    runId: "run-1"
  });
  assert.deepEqual(
    await adapter.streamAgentTurn({ agentId: "agent-1", message: "hello" }, {}, { timeoutMs: 12 }),
    { runId: "run-2" }
  );
  await adapter.probeGateway({ timeoutMs: 13 });
  assert.deepEqual(await adapter.call("health", { probe: true }, { timeoutMs: 14 }), { params: { probe: true } });

  assert.deepEqual(calls, [
    { method: "listSkills", options: { eligible: true, timeoutMs: 1 } },
    { method: "listPlugins", options: { timeoutMs: 2 } },
    { method: "listModels", options: { timeoutMs: 3 } },
    { method: "scanModels", options: { yes: true, noInput: true, timeoutMs: 4 } },
    { method: "listAgents", options: { timeoutMs: 4 } },
    { method: "listSessions", options: { timeoutMs: 4 } },
    { method: "getChannelStatus", options: { timeoutMs: 4 } },
    { method: "getConfig", action: "gateway", options: { timeoutMs: 5 } },
    { method: "hasConfig", action: "gateway.remote.url", options: { timeoutMs: 6 } },
    { method: "setConfig", action: "gateway.remote.url", options: { strictJson: true, timeoutMs: 7 } },
    { method: "unsetConfig", action: "gateway.remote.url", options: { timeoutMs: 8 } },
    { method: "addAgent", action: "agent-1", options: { timeoutMs: 9 } },
    { method: "deleteAgent", action: "agent-1", options: { timeoutMs: 10 } },
    { method: "runAgentTurn", action: "agent-1", options: { timeoutMs: 11 } },
    { method: "streamAgentTurn", action: "agent-1", options: { timeoutMs: 12 } },
    { method: "probeGateway", options: { timeoutMs: 13 } },
    { method: "call", action: "health", options: { timeoutMs: 14 } }
  ]);
});
