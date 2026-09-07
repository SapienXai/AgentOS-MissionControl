import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import { controlGateway } from "@/lib/openclaw/application/gateway-service";
import {
  OpenClawLifecycleService,
  setOpenClawLifecycleServiceForTesting
} from "@/lib/openclaw/lifecycle/service";
import type { GatewayLifecycleResult } from "@/lib/openclaw/lifecycle/types";
import {
  GatewayBackedOpenClawAdapter,
  getOpenClawAdapter,
  setOpenClawAdapterForTesting
} from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  getConfigUpdatePacingSnapshot,
  resetConfigUpdatePacingForTesting,
  setConfigUpdatePacingQueuePathForTesting,
  setConfigUpdatePacingForTesting
} from "@/lib/openclaw/application/config-pacing-service";
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
import {
  CliOpenClawGatewayClient,
  type OpenClawCommandOptions,
  type OpenClawGatewayClient
} from "@/lib/openclaw/client/gateway-client";

type MockCall = {
  method: string;
  action?: string;
  options?: OpenClawCommandOptions;
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let configPacingTestRoot: string | null = null;

function configPacingQueuePath() {
  assert.ok(configPacingTestRoot);
  return path.join(configPacingTestRoot, "config-pacing-queue.json");
}

function createMockGatewayClient(overrides: Partial<OpenClawGatewayClient> = {}) {
  const calls: MockCall[] = [];
  const client: OpenClawGatewayClient = {
    async getHealth(options?: OpenClawCommandOptions) {
      calls.push({ method: "getHealth", options });
      return { ok: true };
    },
    async getStatus(options?: OpenClawCommandOptions) {
      calls.push({ method: "getStatus", options });
      return { version: "1.2.3" };
    },
    async getUpdateStatus(options?: OpenClawCommandOptions) {
      calls.push({ method: "getUpdateStatus", options });
      return { latestVersion: "1.2.4" };
    },
    async getGatewayStatus(options?: OpenClawCommandOptions) {
      calls.push({ method: "getGatewayStatus", options });
      return { rpc: { ok: true }, gateway: { port: 18789 } };
    },
    async getModelStatus(options?: OpenClawCommandOptions) {
      calls.push({ method: "getModelStatus", options });
      return { defaultModel: "openai/gpt-5" };
    },
    async getAgentModelStatus(input, options?: OpenClawCommandOptions) {
      calls.push({ method: "getAgentModelStatus", action: input.agentId, options });
      return { defaultModel: "openai/gpt-5", agentDir: `/tmp/${input.agentId}` };
    },
    async setModelAuthOrder(input, options?: OpenClawCommandOptions) {
      calls.push({ method: "setModelAuthOrder", action: input.agentId, options });
      return { stdout: "", stderr: "", code: 0 };
    },
    async listAgents(options?: OpenClawCommandOptions) {
      calls.push({ method: "listAgents", options });
      return { agents: [] };
    },
    async listSessions(_input, options?: OpenClawCommandOptions) {
      calls.push({ method: "listSessions", options });
      return { sessions: [] };
    },
    async describeSession(_input, options?: OpenClawCommandOptions) {
      calls.push({ method: "describeSession", options });
      return { session: { id: "session-1" } };
    },
    async getSessionHistory(_input, options?: OpenClawCommandOptions) {
      calls.push({ method: "getSessionHistory", options });
      return { messages: [] };
    },
    async exportSession(_input, options?: OpenClawCommandOptions) {
      calls.push({ method: "exportSession", options });
      return { format: "json", content: "{}" };
    },
    async listTasks(_input, options?: OpenClawCommandOptions) {
      calls.push({ method: "listTasks", options });
      return { tasks: [] };
    },
    async getTask(input, options?: OpenClawCommandOptions) {
      calls.push({ method: "getTask", action: input.taskId, options });
      return { taskId: input.taskId };
    },
    async assignTask(input, options?: OpenClawCommandOptions) {
      calls.push({ method: "assignTask", action: input.taskId, options });
      return { taskId: input.taskId, status: "assigned" };
    },
    async cancelTask(input, options?: OpenClawCommandOptions) {
      calls.push({ method: "cancelTask", action: input.taskId, options });
      return { taskId: input.taskId, status: "cancelled" };
    },
    async listArtifacts(_input, options?: OpenClawCommandOptions) {
      calls.push({ method: "listArtifacts", options });
      return { artifacts: [] };
    },
    async getArtifact(input, options?: OpenClawCommandOptions) {
      calls.push({ method: "getArtifact", action: input.artifactId, options });
      return { artifactId: input.artifactId };
    },
    async putArtifact(input, options?: OpenClawCommandOptions) {
      calls.push({ method: "putArtifact", action: input.artifactId ?? input.name, options });
      return { artifactId: input.artifactId ?? "artifact-1" };
    },
    async deleteArtifact(input, options?: OpenClawCommandOptions) {
      calls.push({ method: "deleteArtifact", action: input.artifactId, options });
      return { artifactId: input.artifactId };
    },
    async getRuntimeSnapshot(_input, options?: OpenClawCommandOptions) {
      calls.push({ method: "getRuntimeSnapshot", options });
      return { tasks: [], sessions: [] };
    },
    async getToolsCatalog(_input, options?: OpenClawCommandOptions) {
      calls.push({ method: "getToolsCatalog", options });
      return { agentId: "agent-1", profiles: [], groups: [] };
    },
    async getEffectiveTools(_input, options?: OpenClawCommandOptions) {
      calls.push({ method: "getEffectiveTools", options });
      return { agentId: "agent-1", profile: "full", groups: [] };
    },
    async invokeTool(input, options?: OpenClawCommandOptions) {
      calls.push({ method: "invokeTool", action: input.name, options });
      return { ok: true, toolName: input.name };
    },
    async subscribeRuntimeEvents(_input, _callbacks, options?: OpenClawCommandOptions) {
      calls.push({ method: "subscribeRuntimeEvents", options });
      return {
        close() {
          return undefined;
        }
      };
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
    async getChannelLogs(input, options?: OpenClawCommandOptions) {
      calls.push({ method: "getChannelLogs", action: input.channel, options });
      return { lines: [] };
    },
    async provisionChannelAccount(input, options?: OpenClawCommandOptions) {
      calls.push({ method: "provisionChannelAccount", action: input.account ?? undefined, options });
      return { stdout: JSON.stringify({ ok: true }), stderr: "" };
    },
    async removeChannelAccount(input, options?: OpenClawCommandOptions) {
      calls.push({ method: "removeChannelAccount", action: input.account, options });
      return { stdout: JSON.stringify({ ok: true }), stderr: "" };
    },
    async setupGmailWebhook(input, options?: OpenClawCommandOptions) {
      calls.push({ method: "setupGmailWebhook", action: input.account, options });
      return { stdout: JSON.stringify({ ok: true }), stderr: "" };
    },
    async controlGateway(action: "start" | "stop" | "restart", options?: OpenClawCommandOptions) {
      calls.push({ method: "controlGateway", action, options });
      return { ok: true, action };
    },
    async approveDeviceAccess(input, options?: OpenClawCommandOptions) {
      calls.push({ method: "approveDeviceAccess", action: input?.requestId ?? "latest", options });
      return { requestId: input?.requestId ?? "latest", device: { deviceId: "device-1" } };
    },
    async probeGateway(options?: OpenClawCommandOptions) {
      calls.push({ method: "probeGateway", options });
      return {};
    },
    async call<TPayload>(method: string, params?: Record<string, unknown>, options?: OpenClawCommandOptions) {
      calls.push({ method: "call", action: method, options });
      return { params } as TPayload;
    },
    async tailLogs(_input, options?: OpenClawCommandOptions) {
      calls.push({ method: "tailLogs", options });
      return { lines: [] };
    },
    async listExecApprovals(_input, options?: OpenClawCommandOptions) {
      calls.push({ method: "listExecApprovals", options });
      return { approvals: [] };
    },
    async resolveExecApproval(input, options?: OpenClawCommandOptions) {
      calls.push({ method: "resolveExecApproval", action: input.approvalId, options });
      return { ok: true, approvalId: input.approvalId };
    },
    async getCronStatus(options?: OpenClawCommandOptions) {
      calls.push({ method: "getCronStatus", options });
      return { enabled: true };
    },
    async listCronJobs(_input, options?: OpenClawCommandOptions) {
      calls.push({ method: "listCronJobs", options });
      return { jobs: [] };
    },
    async getConfig<TPayload>(path: string, options?: OpenClawCommandOptions) {
      calls.push({ method: "getConfig", action: path, options });
      return { path } as TPayload;
    },
    async getConfigSchema(options?: OpenClawCommandOptions) {
      calls.push({ method: "getConfigSchema", options });
      return null;
    },
    async lookupConfigSchema(input, options?: OpenClawCommandOptions) {
      calls.push({ method: "lookupConfigSchema", action: input.path, options });
      return { path: input.path };
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
    async updateAgent(input, options?: OpenClawCommandOptions) {
      calls.push({ method: "updateAgent", action: input.id, options });
      return { stdout: "", stderr: "", code: 0 };
    },
    async setAgentIdentity(input, options?: OpenClawCommandOptions) {
      calls.push({ method: "setAgentIdentity", action: input.agentId, options });
      return { stdout: "", stderr: "", code: 0 };
    },
    async deleteAgent(agentId: string, options?: OpenClawCommandOptions) {
      calls.push({ method: "deleteAgent", action: agentId, options });
      return { stdout: "", stderr: "", code: 0 };
    },
    async provisionAutomation(input, options?: OpenClawCommandOptions) {
      calls.push({ method: "provisionAutomation", action: input.name, options });
      return { stdout: "", stderr: "", code: 0 };
    },
    async runAgentTurn(input, options?: OpenClawCommandOptions) {
      calls.push({ method: "runAgentTurn", action: input.agentId, options });
      return { runId: "run-1" };
    },
    async abortAgentTurn(input, options?: OpenClawCommandOptions) {
      calls.push({ method: "abortAgentTurn", action: input.runId ?? input.sessionId ?? input.agentId ?? undefined, options });
      return { runId: input.runId ?? undefined };
    },
    async steerSession(input, options?: OpenClawCommandOptions) {
      calls.push({ method: "steerSession", action: input.key ?? input.sessionId ?? undefined, options });
      return { ok: true, method: "chat.send" };
    },
    async injectChat(input, options?: OpenClawCommandOptions) {
      calls.push({ method: "injectChat", action: input.sessionKey ?? input.sessionId ?? undefined, options });
      return { ok: true, method: "chat.inject" };
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

beforeEach(async () => {
  configPacingTestRoot = await mkdtemp(path.join(tmpdir(), "agentos-config-pacing-"));
  setConfigUpdatePacingQueuePathForTesting(configPacingQueuePath());
  resetConfigUpdatePacingForTesting({ clearPersistentQueue: true });
});

afterEach(async () => {
  setOpenClawGatewayClientProvider(null);
  setOpenClawGatewayClientForTesting(null);
  setOpenClawAdapterForTesting(null);
  setOpenClawLifecycleServiceForTesting(null);
  resetConfigUpdatePacingForTesting({ clearPersistentQueue: true });
  setConfigUpdatePacingQueuePathForTesting(null);

  if (configPacingTestRoot) {
    await rm(configPacingTestRoot, { recursive: true, force: true });
    configPacingTestRoot = null;
  }
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

test("gateway application service controls the gateway through the lifecycle service", async () => {
  const { client, calls } = createMockGatewayClient();
  setOpenClawGatewayClientForTesting(client);
  setOpenClawLifecycleServiceForTesting(createTestLifecycleService());

  const result = await controlGateway("restart") as GatewayLifecycleResult;

  assert.equal(result.operation, "restart");
  assert.equal(result.descriptor.ownership, "agentos-managed");
  assert.equal(result.message, "OpenClaw Gateway restarted and is ready.");
  assert.deepEqual(calls, [
    { method: "controlGateway", action: "restart", options: { force: true } }
  ]);
});

test("gateway application service coalesces concurrent identical control actions", async () => {
  const calls: MockCall[] = [];
  const client = createMockGatewayClient({
    async controlGateway(action: "start" | "stop" | "restart", options?: OpenClawCommandOptions) {
      calls.push({ method: "controlGateway", action, options });
      await delay(10);
      return { ok: true, action };
    }
  }).client;
  setOpenClawGatewayClientForTesting(client);
  setOpenClawLifecycleServiceForTesting(createTestLifecycleService());

  const [firstRaw, secondRaw] = await Promise.all([
    controlGateway("restart"),
    controlGateway("restart")
  ]);
  const first = firstRaw as GatewayLifecycleResult;
  const second = secondRaw as GatewayLifecycleResult;

  assert.equal(first.operation, "restart");
  assert.equal(first.descriptor.ownership, "agentos-managed");
  assert.equal(first.message, "OpenClaw Gateway restarted and is ready.");
  assert.equal(first, second);
  assert.deepEqual(calls, [
    { method: "controlGateway", action: "restart", options: { force: true } }
  ]);
});

function createTestLifecycleService() {
  return new OpenClawLifecycleService({
    env: {
      OPENCLAW_GATEWAY_BINARY: "/tmp/agentos-openclaw",
      OPENCLAW_STATE_DIR: "/tmp/agentos-adapter-state",
      OPENCLAW_CONFIG_PATH: "/tmp/agentos-adapter-state/openclaw.json"
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

test("OpenClaw gateway client factory supports a provider extension point", () => {
  const { client } = createMockGatewayClient();
  setOpenClawGatewayClientProvider(() => client);

  assert.equal(getOpenClawGatewayClient(), client);
});

test("OpenClaw adapter fails closed when agent update has no real client capability", async () => {
  const { client } = createMockGatewayClient();
  delete (client as Partial<OpenClawGatewayClient>).updateAgent;
  const adapter = new GatewayBackedOpenClawAdapter(() => client);

  await assert.rejects(
    async () => adapter.updateAgent({ id: "agent-1", name: "Agent One" }),
    /agent update is unavailable.*does not expose agents\.update.*real CLI fallback/i
  );
});

test("CLI Gateway client does not fake successful agent updates", async () => {
  const client: OpenClawGatewayClient = new CliOpenClawGatewayClient();
  const updateAgent = client.updateAgent;
  assert.ok(updateAgent);

  await assert.rejects(
    () => updateAgent({ id: "agent-1", name: "Agent One" }),
    /agent update is unavailable.*safe agent update command/i
  );
});

test("OpenClaw adapter queues the latest config mutation during Gateway config cooldown", { concurrency: false }, async () => {
  setConfigUpdatePacingForTesting({ mode: "respect-gateway", minimumIntervalMs: null });
  const appliedValues: unknown[] = [];
  let attempt = 0;
  const adapter = new GatewayBackedOpenClawAdapter(() => ({
    async setConfig(_path: string, value: unknown) {
      attempt += 1;

      if (attempt === 1) {
        throw new Error(
          "UNAVAILABLE: rate limit exceeded for config.patch; retry after 0.05s Gateway-native operation failed; CLI fallback disabled for this operation."
        );
      }

      appliedValues.push(value);
      return { stdout: JSON.stringify({ ok: true }), stderr: "" };
    }
  } as unknown as OpenClawGatewayClient));

  const first = await adapter.setConfig("agents.defaults", { model: "openai/gpt-5" });
  const second = await adapter.setConfig("agents.defaults", { model: "openai/gpt-5.5" });

  assert.equal(first.metadata?.pending, true);
  assert.equal(second.metadata?.pending, true);

  await delay(90);

  assert.equal(attempt, 2);
  assert.deepEqual(appliedValues, [
    { model: "openai/gpt-5.5" }
  ]);
});

test("OpenClaw adapter persists pending config mutations and resumes retry after restart", { concurrency: false }, async () => {
  setConfigUpdatePacingForTesting({ mode: "respect-gateway", minimumIntervalMs: null });
  let attempt = 0;
  const adapter = new GatewayBackedOpenClawAdapter(() => ({
    async setConfig() {
      attempt += 1;
      throw new Error(
        "UNAVAILABLE: rate limit exceeded for config.patch; retry after 0.5s Gateway-native operation failed; CLI fallback disabled for this operation."
      );
    }
  } as unknown as OpenClawGatewayClient));

  await adapter.setConfig("agents.defaults", { model: "openai/gpt-5" }, { timeoutMs: 5 });
  const queued = await adapter.setConfig("agents.defaults", { model: "openai/gpt-5.5" }, { timeoutMs: 6 });

  assert.equal(queued.metadata?.pending, true);
  assert.equal(attempt, 1);

  const persisted = JSON.parse(await readFile(configPacingQueuePath(), "utf8"));
  assert.equal(persisted.version, 1);
  assert.equal(persisted.queuedMutations.length, 1);
  assert.equal(persisted.queuedMutations[0].path, "agents.defaults");
  assert.deepEqual(persisted.queuedMutations[0].value, { model: "openai/gpt-5.5" });
  assert.deepEqual(persisted.queuedMutations[0].options, { timeoutMs: 6 });
  assert.equal((await stat(configPacingQueuePath())).mode & 0o777, 0o600);

  resetConfigUpdatePacingForTesting();

  const appliedValues: unknown[] = [];
  const { client } = createMockGatewayClient({
    async setConfig(_path: string, value: unknown, options?: OpenClawCommandOptions & { strictJson?: boolean }) {
      appliedValues.push({ value, options });
      return { stdout: JSON.stringify({ ok: true }), stderr: "" };
    }
  });
  setOpenClawGatewayClientForTesting(client);

  const restoredSnapshot = await getConfigUpdatePacingSnapshot();
  assert.equal(restoredSnapshot.queueDurability, "persistent");
  assert.equal(restoredSnapshot.pending, true);
  assert.deepEqual(restoredSnapshot.pendingPaths, ["agents.defaults"]);
  assert.ok(restoredSnapshot.pendingSince);

  await delay(650);

  assert.deepEqual(appliedValues, [
    { value: { model: "openai/gpt-5.5" }, options: { timeoutMs: 6 } }
  ]);
  assert.equal((await getConfigUpdatePacingSnapshot()).pending, false);
});

test("OpenClaw adapter falls back safely when the persistent config queue is corrupt", { concurrency: false }, async () => {
  await mkdir(path.dirname(configPacingQueuePath()), { recursive: true });
  await writeFile(configPacingQueuePath(), "{invalid", { encoding: "utf8", mode: 0o600 });

  const snapshot = await getConfigUpdatePacingSnapshot();

  assert.equal(snapshot.queueDurability, "persistent");
  assert.equal(snapshot.pending, false);
  assert.deepEqual(snapshot.pendingPaths, []);
  assert.match(snapshot.lastIssue ?? "", /could not read the durable config pacing queue/i);
});

test("OpenClaw adapter exposes catalog, config, agent turn, and probe methods", async () => {
  const { client, calls } = createMockGatewayClient();
  setOpenClawGatewayClientForTesting(client);
  setConfigUpdatePacingForTesting({ mode: "respect-gateway", minimumIntervalMs: null });

  const adapter = getOpenClawAdapter();
  await adapter.getHealth({ timeoutMs: 0 });
  await adapter.listSkills({ eligible: true, timeoutMs: 1 });
  await adapter.listPlugins({ timeoutMs: 2 });
  await adapter.listModels({ all: true }, { timeoutMs: 3 });
  await adapter.getAgentModelStatus({ agentId: "agent-1" }, { timeoutMs: 3 });
  await adapter.setModelAuthOrder(
    { provider: "openai", agentId: "agent-1", profileIds: ["profile-1"] },
    { timeoutMs: 3 }
  );
  await adapter.scanModels({ yes: true, noInput: true, timeoutMs: 4 });
  await adapter.listAgents({ timeoutMs: 4 });
  await adapter.listSessions({ limit: 1 }, { timeoutMs: 4 });
  await adapter.describeSession({ key: "agent:agent-1:main" }, { timeoutMs: 4 });
  await adapter.getSessionHistory({ key: "agent:agent-1:main", limit: 5 }, { timeoutMs: 4 });
  await adapter.exportSession({ key: "agent:agent-1:main", format: "json" }, { timeoutMs: 4 });
  await adapter.listTasks({ agentId: "agent-1" }, { timeoutMs: 4 });
  await adapter.getTask({ taskId: "task-1" }, { timeoutMs: 4 });
  await adapter.assignTask({ taskId: "task-1", agentId: "agent-1" }, { timeoutMs: 4 });
  await adapter.cancelTask({ taskId: "task-1" }, { timeoutMs: 4 });
  await adapter.listArtifacts({ taskId: "task-1" }, { timeoutMs: 4 });
  await adapter.getArtifact({ artifactId: "artifact-1" }, { timeoutMs: 4 });
  await adapter.putArtifact({ name: "result.txt", content: "ok" }, { timeoutMs: 4 });
  await adapter.deleteArtifact({ artifactId: "artifact-1" }, { timeoutMs: 4 });
  await adapter.getRuntimeSnapshot({ includeTasks: true }, { timeoutMs: 4 });
  await adapter.getToolsCatalog({ agentId: "agent-1" }, { timeoutMs: 4 });
  await adapter.getEffectiveTools({ agentId: "agent-1", sessionKey: "agent:agent-1:main" }, { timeoutMs: 4 });
  await adapter.invokeTool({ name: "shell", args: { command: "pwd" } }, { timeoutMs: 4 });
  const subscription = await adapter.subscribeRuntimeEvents(
    { includeSessions: false, includeTasks: true },
    { onEvent: () => {} },
    { timeoutMs: 4 }
  );
  subscription.close();
  await adapter.getChannelStatus({ probe: true }, { timeoutMs: 4 });
  await adapter.getChannelLogs({ channel: "telegram", lines: 25 }, { timeoutMs: 4 });
  await adapter.provisionChannelAccount({ channel: "telegram", account: "telegram-main" }, { timeoutMs: 4 });
  await adapter.removeChannelAccount({ channel: "telegram", account: "telegram-main", delete: true }, { timeoutMs: 4 });
  await adapter.setupGmailWebhook({ account: "user@example.com", config: { project: "agentos" } }, { timeoutMs: 4 });
  assert.deepEqual(await adapter.getConfig("gateway", { timeoutMs: 5 }), { path: "gateway" });
  assert.equal(await adapter.getConfigSchema({ timeoutMs: 5 }), null);
  assert.deepEqual(await adapter.lookupConfigSchema({ path: "gateway.remote.url" }, { timeoutMs: 5 }), {
    path: "gateway.remote.url"
  });
  assert.equal(await adapter.hasConfig("gateway.remote.url", { timeoutMs: 6 }), true);
  await adapter.setConfig("gateway.remote.url", "ws://127.0.0.1:18789", { strictJson: true, timeoutMs: 7 });
  await adapter.unsetConfig("gateway.remote.url", { timeoutMs: 8 });
  await adapter.addAgent({ id: "agent-1", workspace: "/workspace", agentDir: "/agent" }, { timeoutMs: 9 });
  await adapter.updateAgent({ id: "agent-1", name: "Agent One" }, { timeoutMs: 9 });
  await adapter.setAgentIdentity({
    agentId: "agent-1",
    workspace: "/workspace",
    identityFile: "/agent/IDENTITY.md",
    name: "Agent One"
  }, { timeoutMs: 9 });
  await adapter.deleteAgent("agent-1", { timeoutMs: 10 });
  await adapter.provisionAutomation({
    name: "Digest",
    agentId: "agent-1",
    message: "Run digest",
    schedule: { kind: "every", value: "1h" }
  }, { timeoutMs: 10 });
  assert.deepEqual(await adapter.runAgentTurn({ agentId: "agent-1", message: "hello" }, { timeoutMs: 11 }), {
    runId: "run-1"
  });
  assert.deepEqual(await adapter.abortAgentTurn({ runId: "run-1" }, { timeoutMs: 11 }), {
    runId: "run-1"
  });
  assert.deepEqual(await adapter.steerSession({ key: "agent:agent-1:main", message: "Focus on tests" }, { timeoutMs: 11 }), {
    ok: true,
    method: "chat.send"
  });
  assert.deepEqual(await adapter.injectChat({ sessionKey: "agent:agent-1:main", message: "Use this reference" }, { timeoutMs: 11 }), {
    ok: true,
    method: "chat.inject"
  });
  assert.deepEqual(
    await adapter.streamAgentTurn({ agentId: "agent-1", message: "hello" }, {}, { timeoutMs: 12 }),
    { runId: "run-2" }
  );
  await adapter.probeGateway({ timeoutMs: 13 });
  await adapter.approveDeviceAccess({ latest: true }, { timeoutMs: 13 });
  assert.deepEqual(await adapter.call("health", { probe: true }, { timeoutMs: 14 }), { params: { probe: true } });
  await adapter.tailLogs({ limit: 10 }, { timeoutMs: 15 });
  await adapter.listExecApprovals({ status: "pending" }, { timeoutMs: 16 });
  await adapter.resolveExecApproval({ approvalId: "approval-1", decision: "allow" }, { timeoutMs: 17 });
  await adapter.getCronStatus({ timeoutMs: 18 });
  await adapter.listCronJobs({ includeDisabled: true }, { timeoutMs: 19 });

  assert.deepEqual(calls, [
    { method: "getHealth", options: { timeoutMs: 0 } },
    { method: "listSkills", options: { eligible: true, timeoutMs: 1 } },
    { method: "listPlugins", options: { timeoutMs: 2 } },
    { method: "listModels", options: { timeoutMs: 3 } },
    { method: "getAgentModelStatus", action: "agent-1", options: { timeoutMs: 3 } },
    { method: "setModelAuthOrder", action: "agent-1", options: { timeoutMs: 3 } },
    { method: "scanModels", options: { yes: true, noInput: true, timeoutMs: 4 } },
    { method: "listAgents", options: { timeoutMs: 4 } },
    { method: "listSessions", options: { timeoutMs: 4 } },
    { method: "describeSession", options: { timeoutMs: 4 } },
    { method: "getSessionHistory", options: { timeoutMs: 4 } },
    { method: "exportSession", options: { timeoutMs: 4 } },
    { method: "listTasks", options: { timeoutMs: 4 } },
    { method: "getTask", action: "task-1", options: { timeoutMs: 4 } },
    { method: "assignTask", action: "task-1", options: { timeoutMs: 4 } },
    { method: "cancelTask", action: "task-1", options: { timeoutMs: 4 } },
    { method: "listArtifacts", options: { timeoutMs: 4 } },
    { method: "getArtifact", action: "artifact-1", options: { timeoutMs: 4 } },
    { method: "putArtifact", action: "result.txt", options: { timeoutMs: 4 } },
    { method: "deleteArtifact", action: "artifact-1", options: { timeoutMs: 4 } },
    { method: "getRuntimeSnapshot", options: { timeoutMs: 4 } },
    { method: "getToolsCatalog", options: { timeoutMs: 4 } },
    { method: "getEffectiveTools", options: { timeoutMs: 4 } },
    { method: "invokeTool", action: "shell", options: { timeoutMs: 4 } },
    { method: "subscribeRuntimeEvents", options: { timeoutMs: 4 } },
    { method: "getChannelStatus", options: { timeoutMs: 4 } },
    { method: "getChannelLogs", action: "telegram", options: { timeoutMs: 4 } },
    { method: "provisionChannelAccount", action: "telegram-main", options: { timeoutMs: 4 } },
    { method: "removeChannelAccount", action: "telegram-main", options: { timeoutMs: 4 } },
    { method: "setupGmailWebhook", action: "user@example.com", options: { timeoutMs: 4 } },
    { method: "getConfig", action: "gateway", options: { timeoutMs: 5 } },
    { method: "getConfigSchema", options: { timeoutMs: 5 } },
    { method: "lookupConfigSchema", action: "gateway.remote.url", options: { timeoutMs: 5 } },
    { method: "hasConfig", action: "gateway.remote.url", options: { timeoutMs: 6 } },
    { method: "setConfig", action: "gateway.remote.url", options: { strictJson: true, timeoutMs: 7 } },
    { method: "unsetConfig", action: "gateway.remote.url", options: { timeoutMs: 8 } },
    { method: "addAgent", action: "agent-1", options: { timeoutMs: 9 } },
    { method: "updateAgent", action: "agent-1", options: { timeoutMs: 9 } },
    { method: "setAgentIdentity", action: "agent-1", options: { timeoutMs: 9 } },
    { method: "deleteAgent", action: "agent-1", options: { timeoutMs: 10 } },
    { method: "provisionAutomation", action: "Digest", options: { timeoutMs: 10 } },
    { method: "runAgentTurn", action: "agent-1", options: { timeoutMs: 11 } },
    { method: "abortAgentTurn", action: "run-1", options: { timeoutMs: 11 } },
    { method: "steerSession", action: "agent:agent-1:main", options: { timeoutMs: 11 } },
    { method: "injectChat", action: "agent:agent-1:main", options: { timeoutMs: 11 } },
    { method: "streamAgentTurn", action: "agent-1", options: { timeoutMs: 12 } },
    { method: "probeGateway", options: { timeoutMs: 13 } },
    { method: "approveDeviceAccess", action: "latest", options: { timeoutMs: 13 } },
    { method: "call", action: "health", options: { timeoutMs: 14 } },
    { method: "tailLogs", options: { timeoutMs: 15 } },
    { method: "listExecApprovals", options: { timeoutMs: 16 } },
    { method: "resolveExecApproval", action: "approval-1", options: { timeoutMs: 17 } },
    { method: "getCronStatus", options: { timeoutMs: 18 } },
    { method: "listCronJobs", options: { timeoutMs: 19 } }
  ]);
});

test("OpenClaw adapter forces the official Gateway model auth refresh", async () => {
  const calls: Array<{ method: string; params?: Record<string, unknown>; options?: OpenClawCommandOptions }> = [];
  const { client } = createMockGatewayClient({
    async call<TPayload>(method: string, params?: Record<string, unknown>, options?: OpenClawCommandOptions) {
      calls.push({ method, params, options });
      return { providers: [] } as TPayload;
    }
  });
  const adapter = new GatewayBackedOpenClawAdapter(() => client);

  assert.deepEqual(
    await adapter.refreshModelAuthStatus?.({ timeoutMs: 8_000 }),
    { providers: [] }
  );
  assert.deepEqual(calls, [{
    method: "models.authStatus",
    params: { refresh: true },
    options: { timeoutMs: 8_000 }
  }]);
});
