import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { controlGateway } from "@/lib/openclaw/application/gateway-service";
import { setOpenClawAdapterForTesting } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  settleGatewayStatusPayloadFromOpenClaw,
  settleModelStatusPayloadFromOpenClaw,
  settleStatusPayloadFromOpenClaw
} from "@/lib/openclaw/adapter/gateway-payloads";
import { setOpenClawGatewayClientForTesting } from "@/lib/openclaw/client/gateway-client-factory";
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
    async controlGateway(action: "start" | "stop" | "restart", options?: OpenClawCommandOptions) {
      calls.push({ method: "controlGateway", action, options });
      return { ok: true, action };
    },
    async probeGateway() {
      return {};
    },
    async call<TPayload>() {
      return {} as TPayload;
    },
    async getConfig() {
      return null;
    },
    async setConfig() {
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
    async listSkills() {
      return { skills: [] };
    },
    async listPlugins() {
      return { plugins: [] };
    },
    async listModels() {
      return { models: [] };
    },
    async scanModels() {
      return [];
    },
  };
  Object.assign(client, overrides);

  return { client, calls };
}

afterEach(() => {
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
