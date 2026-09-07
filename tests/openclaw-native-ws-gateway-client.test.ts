import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";

import {
  clearOpenClawGatewayFallbackDiagnosticsForTesting,
  getRecentOpenClawGatewayFallbackDiagnostics,
  NativeWsOpenClawGatewayClient
} from "@/lib/openclaw/client/native-ws-gateway-client";
import { normalizeModelStatusPayload } from "@/lib/openclaw/client/native-ws-gateway-payloads";
import { parseConfigPath } from "@/lib/openclaw/client/native-ws-gateway-utils";
import type {
  NativeHandshakePayload,
  OpenClawGatewayTransport
} from "@/lib/openclaw/client/native-ws-gateway-types";
import type {
  ModelsStatusPayload,
  OpenClawAddAgentInput,
  OpenClawCommandOptions,
  OpenClawGatewayClient,
  OpenClawGatewayConnectionState,
  OpenClawGatewayEventCallbacks,
  OpenClawGatewayEventSubscription
} from "@/lib/openclaw/client/gateway-client";
import {
  AgentOsGatewayRequestPolicy,
  NativeGatewayRequestError
} from "@/lib/openclaw/client/gateway-client";
import { buildModelStatusConnectionStatus } from "@/lib/openclaw/domains/model-provider-connection";
import { resolveModelReadiness } from "@/lib/openclaw/domains/control-plane-normalization";
import { OPENCLAW_RECOMMENDED_VERSION } from "@/lib/openclaw/versions";
import type { OpenClawNativeAuthorizationProof } from "@/lib/openclaw/identity/types";

type SentFrame = {
  type: string;
  id: string;
  method: string;
  params: Record<string, unknown>;
};

function nativeAuthorizationProof(
  grantedScopes: string[] = ["operator.admin"],
  connectionId: string | null = "connection-1"
): OpenClawNativeAuthorizationProof {
  return {
    source: "native-handshake",
    authenticated: true,
    grantedScopesKnown: true,
    grantedScopes,
    requiredScopes: ["operator.admin"],
    connectionId,
    cliFallbackAllowed: true,
    issuedAt: new Date().toISOString()
  };
}

test("config paths preserve quoted model IDs as one segment", () => {
  assert.deepEqual(
    parseConfigPath('agents.defaults.models["ollama/qwen3.5:9b"]'),
    ["agents", "defaults", "models", "ollama/qwen3.5:9b"]
  );
});

test("native model auth normalization keeps OpenAI API keys separate from ChatGPT OAuth", () => {
  const status = normalizeModelStatusPayload(
    {
      providers: [{
        provider: "openai",
        status: "ok",
        profiles: [{ profileId: "openai-api-key", type: "api-key", status: "ok" }]
      }]
    },
    {
      models: [{ id: "gpt-5.5", provider: "openai", name: "gpt-5.5" }]
    }
  );

  assert.deepEqual(status.auth?.providers?.[0]?.profiles, {
    count: 1,
    oauth: 0,
    token: 0,
    apiKey: 1
  });
  assert.equal(status.auth?.providers?.[0]?.effective?.kind, "api-key");
  assert.notEqual(status.auth?.oauth?.providers?.[0]?.status, "ok");

  const connection = buildModelStatusConnectionStatus("openai", status, ["openai/gpt-5.5"]);
  assert.equal(connection?.connected, true);
  assert.equal(connection?.authMethod, "api-key");
});

test("native model auth normalization recognizes only canonical OpenAI OAuth profiles", () => {
  const status = normalizeModelStatusPayload(
    {
      providers: [{
        provider: "openai",
        status: "ok",
        profiles: [{ profileId: "openai:user@example.com", type: "oauth", status: "ok" }]
      }]
    },
    {
      models: [{ id: "gpt-5.5", provider: "openai", name: "gpt-5.5" }]
    }
  );

  assert.equal(status.auth?.providers?.[0]?.effective?.kind, "ok");
  assert.equal(status.auth?.oauth?.providers?.[0]?.status, "ok");
  assert.deepEqual(status.auth?.oauth?.providers?.[0]?.profiles, [
    { profileId: "openai:user@example.com", type: "oauth", status: "ok" }
  ]);

  const connection = buildModelStatusConnectionStatus("openai", status, ["openai/gpt-5.5"]);
  assert.equal(connection?.connected, true);
  assert.equal(connection?.authMethod, "chatgpt-oauth");
});

test("native model auth normalization does not promote a legacy OpenAI OAuth namespace", () => {
  const status = normalizeModelStatusPayload(
    {
      providers: [{
        provider: "openai",
        status: "ok",
        profiles: [{ profileId: "openai-codex:user@example.com", type: "oauth", status: "ok" }]
      }]
    },
    {
      models: [{ id: "gpt-5.5", provider: "openai", name: "gpt-5.5" }]
    }
  );

  assert.equal(status.auth?.providers?.[0]?.profiles?.count, 0);
  assert.equal(status.auth?.providers?.[0]?.effective?.kind, "unusable");
  assert.notEqual(status.auth?.oauth?.providers?.[0]?.status, "ok");

  const connection = buildModelStatusConnectionStatus("openai", status, ["openai/gpt-5.5"]);
  assert.equal(connection?.connected, false);
  assert.equal(connection?.authMethod, null);
});

class FallbackGatewayClient implements OpenClawGatewayClient {
  calls: Array<{ method: string; params?: unknown; options?: OpenClawCommandOptions }> = [];
  configCalls: string[] = [];
  config = new Map<string, unknown>();
  failConfigWithInvalidConfig = false;
  failStatus = false;
  statusPayload: Record<string, unknown> = {};
  updateStatusPayload: Record<string, unknown> = {};
  modelStatusPayload: ModelsStatusPayload = {};
  modelsPayload: Awaited<ReturnType<OpenClawGatewayClient["listModels"]>> = { models: [] };

  async getHealth() {
    this.calls.push({ method: "getHealth" });
    return { ok: true };
  }

  async getStatus() {
    this.calls.push({ method: "getStatus" });
    if (this.failStatus) {
      throw new Error("CLI status failed");
    }
    return this.statusPayload;
  }

  async getUpdateStatus() {
    this.calls.push({ method: "getUpdateStatus" });
    return this.updateStatusPayload;
  }

  async getGatewayStatus() {
    this.calls.push({ method: "getGatewayStatus" });
    return {};
  }

  async getModelStatus() {
    this.calls.push({ method: "getModelStatus" });
    return this.modelStatusPayload;
  }

  async getAgentModelStatus() {
    this.calls.push({ method: "getAgentModelStatus" });
    return {};
  }

  async setModelAuthOrder() {
    this.calls.push({ method: "setModelAuthOrder" });
    return { stdout: "", stderr: "", code: 0 };
  }

  async listAgents() {
    this.calls.push({ method: "listAgents" });
    return { agents: [] };
  }

  async listSessions() {
    this.calls.push({ method: "listSessions" });
    return { sessions: [] };
  }

  async describeSession() {
    this.calls.push({ method: "describeSession" });
    return {};
  }

  async getSessionHistory() {
    this.calls.push({ method: "getSessionHistory" });
    return {};
  }

  async exportSession() {
    this.calls.push({ method: "exportSession" });
    return {};
  }

  async listTasks() {
    this.calls.push({ method: "listTasks" });
    return { tasks: [] };
  }

  async getTask() {
    this.calls.push({ method: "getTask" });
    return {};
  }

  async assignTask() {
    this.calls.push({ method: "assignTask" });
    return {};
  }

  async cancelTask() {
    this.calls.push({ method: "cancelTask" });
    return {};
  }

  async listArtifacts() {
    this.calls.push({ method: "listArtifacts" });
    return { artifacts: [] };
  }

  async getArtifact() {
    this.calls.push({ method: "getArtifact" });
    return {};
  }

  async putArtifact() {
    this.calls.push({ method: "putArtifact" });
    return {};
  }

  async deleteArtifact() {
    this.calls.push({ method: "deleteArtifact" });
    return {};
  }

  async getRuntimeSnapshot() {
    this.calls.push({ method: "getRuntimeSnapshot" });
    return {};
  }

  async getToolsCatalog() {
    this.calls.push({ method: "getToolsCatalog" });
    return { agentId: "agent-1", profiles: [], groups: [] };
  }

  async getEffectiveTools() {
    this.calls.push({ method: "getEffectiveTools" });
    return { agentId: "agent-1", profile: "full", groups: [] };
  }

  async invokeTool() {
    this.calls.push({ method: "invokeTool" });
    return { ok: true, toolName: "shell" };
  }

  async subscribeRuntimeEvents() {
    this.calls.push({ method: "subscribeRuntimeEvents" });
    return {
      close() {
        return undefined;
      }
    };
  }

  async getChannelStatus() {
    this.calls.push({ method: "getChannelStatus" });
    return {
      ts: 0,
      channelOrder: [],
      channelLabels: {},
      channels: {},
      channelAccounts: {},
      channelDefaultAccountId: {}
    };
  }

  async getChannelLogs() {
    this.calls.push({ method: "getChannelLogs" });
    return { lines: [] };
  }

  async provisionChannelAccount() {
    this.calls.push({ method: "provisionChannelAccount" });
    return { stdout: JSON.stringify({ ok: true }), stderr: "" };
  }

  async removeChannelAccount() {
    this.calls.push({ method: "removeChannelAccount" });
    return { stdout: JSON.stringify({ ok: true }), stderr: "" };
  }

  async setupGmailWebhook() {
    this.calls.push({ method: "setupGmailWebhook" });
    return { stdout: JSON.stringify({ ok: true }), stderr: "" };
  }

  async listSkills() {
    this.calls.push({ method: "listSkills" });
    return { skills: [] };
  }

  async listPlugins() {
    this.calls.push({ method: "listPlugins" });
    return { plugins: [] };
  }

  async listModels() {
    this.calls.push({ method: "listModels" });
    return this.modelsPayload;
  }

  async scanModels() {
    return [];
  }

  async probeGateway() {
    return {};
  }

  async controlGateway() {
    this.calls.push({ method: "controlGateway" });
    return {};
  }

  async approveDeviceAccess() {
    this.calls.push({ method: "approveDeviceAccess" });
    return { requestId: "latest", device: { deviceId: "device-1" } };
  }

  async call<TPayload>(
    method: string,
    params: Record<string, unknown> = {},
    options: OpenClawCommandOptions = {}
  ) {
    this.calls.push({ method, params, options });
    return { fallback: true, method, params } as TPayload;
  }

  async getConfig<TPayload>(path: string) {
    this.configCalls.push(path);
    if (this.failConfigWithInvalidConfig) {
      throw new Error(
        "OpenClaw config is invalid\nStatus, health, logs, and doctor commands still run with invalid config."
      );
    }

    return (this.config.has(path) ? this.config.get(path) : null) as TPayload | null;
  }

  async getConfigSchema() {
    return null;
  }

  async hasConfig() {
    return false;
  }

  async setConfig(path: string, value: unknown) {
    this.calls.push({ method: "setConfig", params: { path, value } });
    this.config.set(path, value);
    return { stdout: "", stderr: "", code: 0 };
  }

  async unsetConfig(path: string) {
    this.calls.push({ method: "unsetConfig", params: { path } });
    this.config.delete(path);
    return { stdout: "", stderr: "", code: 0 };
  }

  async addAgent(input: OpenClawAddAgentInput) {
    this.calls.push({ method: "addAgent", params: input });
    return { stdout: "", stderr: "", code: 0 };
  }

  async setAgentIdentity() {
    this.calls.push({ method: "setAgentIdentity" });
    return { stdout: JSON.stringify({ ok: true }), stderr: "" };
  }

  async deleteAgent() {
    this.calls.push({ method: "deleteAgent" });
    return { stdout: "", stderr: "", code: 0 };
  }

  async provisionAutomation() {
    this.calls.push({ method: "provisionAutomation" });
    return { stdout: JSON.stringify({ ok: true }), stderr: "" };
  }

  async runAgentTurn() {
    this.calls.push({ method: "runAgentTurn" });
    return {};
  }

  async abortAgentTurn() {
    this.calls.push({ method: "abortAgentTurn" });
    return {};
  }

  async steerSession() {
    this.calls.push({ method: "steerSession" });
    return {};
  }

  async injectChat() {
    this.calls.push({ method: "injectChat" });
    return {};
  }

  async streamAgentTurn() {
    this.calls.push({ method: "streamAgentTurn" });
    return {};
  }
}

function createFakeGatewayTransport(
  respond: (socket: {
    emitMessage: (frame: Record<string, unknown>) => void;
    emitRaw: (data: string) => void;
    close: () => void;
  }, frame: SentFrame) => void,
  transportOptions: { requestedScopes?: string[] } = {}
) {
  const sentFrames: SentFrame[] = [];
  const sockets: Array<{
    emitMessage: (frame: Record<string, unknown>) => void;
    emitRaw: (data: string) => void;
    close: () => void;
  }> = [];

  let socket: typeof sockets[number] | null = null;
  let handshake: NativeHandshakePayload | null = null;
  let state: OpenClawGatewayConnectionState = "idle";
  let generation = 0;
  let lastConnectedAt: string | null = null;
  let lastDisconnectedAt: string | null = null;
  const pending = new Map<string, {
    method: string;
    resolve: (payload: unknown) => void;
    reject: (error: unknown) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  const eventCallbacks = new Set<OpenClawGatewayEventCallbacks>();

  const emitRaw = (data: string) => {
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(data) as Record<string, unknown>;
    } catch (error) {
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new NativeGatewayRequestError(
          "OpenClaw Gateway returned malformed JSON.",
          request.method,
          true,
          { cause: error, kind: "malformed-response" }
        ));
      }
      pending.clear();
      return;
    }
    if (frame.type === "event") {
      for (const callbacks of eventCallbacks) {
        callbacks.onEvent(frame as never);
      }
      return;
    }
    const id = typeof frame.id === "string" ? frame.id : null;
    const request = id ? pending.get(id) : undefined;
    if (!id || !request) {
      return;
    }
    pending.delete(id);
    clearTimeout(request.timer);
    if (frame.ok === false) {
      const errorRecord = frame.error && typeof frame.error === "object"
        ? frame.error as Record<string, unknown>
        : {};
      request.reject(new NativeGatewayRequestError(
        typeof errorRecord.message === "string" ? errorRecord.message : "OpenClaw Gateway request failed.",
        request.method,
        true,
        { cause: frame.error }
      ));
      return;
    }
    request.resolve(frame.payload);
  };

  const closeSocket = (closedSocket: typeof sockets[number]) => {
    if (socket !== closedSocket) {
      return;
    }
    socket = null;
    handshake = null;
    lastDisconnectedAt = new Date().toISOString();
    state = "connecting";
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new NativeGatewayRequestError(
        `OpenClaw Gateway request "${request.method}" was interrupted by a connection close.`,
        request.method,
        true,
        { kind: "unreachable" }
      ));
    }
    pending.clear();
  };

  const createSocket = () => {
    const created = {
      emitMessage: (frame: Record<string, unknown>) => emitRaw(JSON.stringify(frame)),
      emitRaw,
      close: () => closeSocket(created)
    };
    sockets.push(created);
    socket = created;
    return created;
  };

  const request = async <TPayload>(method: string, params: Record<string, unknown>, options: OpenClawCommandOptions, timeoutMs: number) => {
    if (method !== "connect" && !handshake) {
      await transport.probe(options, timeoutMs);
    }
    const activeSocket = socket ?? createSocket();
    const id = `fake-${sentFrames.length + 1}`;
    const frame: SentFrame = {
      type: "req",
      id,
      method,
      params: method === "connect"
        ? {
            minProtocol: 4,
            maxProtocol: 4,
            client: {
              id: "gateway-client",
              version: "agentos",
              platform: process.platform,
              mode: "backend"
            },
            role: "operator",
            scopes: transportOptions.requestedScopes ?? [
              "operator.admin",
              "operator.read",
              "operator.write",
              "operator.approvals",
              "operator.questions",
              "operator.pairing",
              "operator.talk",
              "operator.talk.secrets"
            ],
            caps: ["agent-kind", "tool-events"]
          }
        : JSON.parse(JSON.stringify(params)) as Record<string, unknown>
    };
    sentFrames.push(frame);
    return new Promise<TPayload>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new NativeGatewayRequestError(
          `OpenClaw Gateway request "${method}" timed out after ${timeoutMs} ms.`,
          method,
          true,
          { kind: "timeout" }
        ));
      }, timeoutMs);
      pending.set(id, {
        method,
        resolve: (payload) => resolve(payload as TPayload),
        reject,
        timer
      });
      respond(activeSocket, frame);
    });
  };

  const transport: OpenClawGatewayTransport = {
    lifecycleOwner: "official",
    async probe(options, timeoutMs) {
      if (handshake) {
        return handshake;
      }
      state = "connecting";
      const payload = await request<NativeHandshakePayload>("connect", {}, options, timeoutMs);
      if (payload.protocol !== undefined && payload.protocol !== 4) {
        state = "error";
        throw new NativeGatewayRequestError(
          `OpenClaw Gateway protocol ${payload.protocol} is outside the supported range 4-4.`,
          "connect",
          true,
          { kind: "protocol-mismatch" }
        );
      }
      handshake = payload;
      generation += 1;
      state = "connected";
      lastConnectedAt = new Date().toISOString();
      return payload;
    },
    request,
    async subscribe(params, callbacks, options, timeoutMs): Promise<OpenClawGatewayEventSubscription> {
      eventCallbacks.add(callbacks);
      try {
        await transport.probe(options, timeoutMs);
        if (params.subscribeSessions || params.includeSessions) {
          await transport.request("sessions.subscribe", {}, options, timeoutMs);
        }
        const sessionKeys = Array.isArray(params.sessionKeys)
          ? params.sessionKeys.filter((value): value is string => typeof value === "string")
          : [];
        for (const key of sessionKeys) {
          await transport.request("sessions.messages.subscribe", { key }, options, timeoutMs);
        }
        return {
          reconnectManagedByClient: true,
          close: () => eventCallbacks.delete(callbacks)
        };
      } catch (error) {
        eventCallbacks.delete(callbacks);
        throw error;
      }
    },
    close() {
      if (socket) {
        closeSocket(socket);
      }
      state = "closed";
      eventCallbacks.clear();
    },
    getDiagnostics() {
      return {
        connectionState: state === "connected"
          ? "connected"
          : state === "closed"
            ? "closed"
            : state === "error"
              ? "error"
              : "connecting",
        protocolVersion: typeof handshake?.protocol === "number" ? handshake.protocol : null,
        gatewayCapabilities: [],
        pendingRequestCount: pending.size,
        lastNativeError: null,
        lastConnectedAt,
        lastDisconnectedAt,
        operatorIdentity: transport.getOperatorIdentity()
      };
    },
    getOperatorIdentity() {
      const auth = handshake?.auth;
      return {
        requestedRole: "operator",
        role: typeof auth?.role === "string" ? auth.role : null,
        requestedScopes: transportOptions.requestedScopes ?? [
          "operator.admin",
          "operator.read",
          "operator.write",
          "operator.approvals",
          "operator.questions",
          "operator.pairing",
          "operator.talk",
          "operator.talk.secrets"
        ],
        grantedScopes: Array.isArray(auth?.scopes) ? auth.scopes.filter((value): value is string => typeof value === "string") : [],
        grantedScopesKnown: Array.isArray(auth?.scopes),
        deviceId: null,
        connectionId: typeof handshake?.server?.connId === "string" ? handshake.server.connId : null,
        authenticated: Boolean(auth?.role),
        source: auth?.role ? "native-handshake" : "unavailable"
      };
    },
    getGeneration: () => generation,
    getLifecycleState: () => state
  };

  return { transport, sentFrames, sockets };
}

async function waitForNativePolicy(predicate: () => boolean, timeoutMs = 1_000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for official Gateway request-policy state.");
    }
    await delay(1);
  }
}

test("native WS gateway client handshakes and correlates request responses", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 4 }
          : { ok: true, method: frame.method, params: frame.params }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const result = await client.call<{ ok: boolean; method: string; params: Record<string, unknown> }>(
    "health",
    { probe: true }
  );

  assert.deepEqual(result, { ok: true, method: "health", params: { probe: true } });
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "health"]);
  assert.equal(fallback.calls.length, 0);
});

test("native channel lifecycle uses channels.start and channels.stop without CLI fallback", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 4 }
          : frame.method === "channels.start"
            ? {
                channel: "telegram",
                accountId: "operations",
                started: false,
                outcome: { status: "retry", reason: "start-in-flight" }
              }
            : { channel: "telegram", accountId: "operations", stopped: true }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const started = await client.startChannel({ channel: "telegram", accountId: "operations" });
  const stopped = await client.stopChannel({ channel: "telegram", accountId: "operations" });

  assert.deepEqual(started, {
    channel: "telegram",
    accountId: "operations",
    started: false,
    outcome: { status: "retry", reason: "start-in-flight" }
  });
  assert.deepEqual(stopped, {
    channel: "telegram",
    accountId: "operations",
    stopped: true
  });
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "channels.start", "channels.stop"]);
  assert.deepEqual(sentFrames.slice(1).map((frame) => frame.params), [
    { channel: "telegram", accountId: "operations" },
    { channel: "telegram", accountId: "operations" }
  ]);
  assert.equal(fallback.calls.length, 0);
});

test("Railway rejects Gateway lifecycle control without invoking the CLI fallback", async () => {
  const previousPlatform = process.env.AGENTOS_DEPLOYMENT_PLATFORM;
  process.env.AGENTOS_DEPLOYMENT_PLATFORM = "railway";

  try {
    const fallback = new FallbackGatewayClient();
    const { transport } = createFakeGatewayTransport(() => {});
    const client = new NativeWsOpenClawGatewayClient({
      fallback,
      transport,
      url: "ws://127.0.0.1:18789"
    });

    await assert.rejects(
      () => client.controlGateway("restart"),
      /container supervisor owns the Gateway process lifecycle/
    );
    assert.equal(fallback.calls.some((call) => call.method === "controlGateway"), false);
  } finally {
    if (previousPlatform === undefined) {
      delete process.env.AGENTOS_DEPLOYMENT_PLATFORM;
    } else {
      process.env.AGENTOS_DEPLOYMENT_PLATFORM = previousPlatform;
    }
  }
});

test("session model reset uses native sessions.patch without CLI fallback", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect" ? { protocol: 4 } : { ok: true }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await client.patchSessionModel({
    key: "agent:researcher:main",
    agentId: "researcher",
    model: null
  });

  const patchFrame = sentFrames.find((frame) => frame.method === "sessions.patch");
  assert.deepEqual(patchFrame?.params, {
    key: "agent:researcher:main",
    agentId: "researcher",
    model: null
  });
  assert.equal(fallback.calls.length, 0);
});

test("native WS gateway client reuses one persistent handshake for multiple RPCs", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 4 }
          : { ok: true, method: frame.method }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await client.call("health");
  await client.call("status");
  await client.call("models.list");

  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "health", "status", "models.list"]);
  assert.equal(client.getDiagnostics().protocolVersion, 4);
  assert.equal(client.getDiagnostics().connectionState, "connected");
});

test("native WS gateway client resolves out-of-order responses by request id", async () => {
  const fallback = new FallbackGatewayClient();
  const queued: Array<{ socket: { emitMessage: (frame: Record<string, unknown>) => void }; frame: SentFrame }> = [];
  const { transport } = createFakeGatewayTransport((socket, frame) => {
    if (frame.method === "connect") {
      globalThis.queueMicrotask(() => {
        socket.emitMessage({ type: "res", id: frame.id, ok: true, payload: { protocol: 4 } });
      });
      return;
    }

    queued.push({ socket, frame });
    if (queued.length === 2) {
      const [first, second] = queued;
      second.socket.emitMessage({
        type: "res",
        id: second.frame.id,
        ok: true,
        payload: { method: second.frame.method }
      });
      first.socket.emitMessage({
        type: "res",
        id: first.frame.id,
        ok: true,
        payload: { method: first.frame.method }
      });
    }
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const [first, second] = await Promise.all([
    client.call<{ method: string }>("agents.list"),
    client.call<{ method: string }>("sessions.list")
  ]);

  assert.deepEqual(first, { method: "agents.list" });
  assert.deepEqual(second, { method: "sessions.list" });
});

test("native WS gateway client ignores event frames while resolving RPC responses", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect" ? { protocol: 4 } : { ok: true }
      });
      if (frame.method !== "connect") {
        socket.emitMessage({
          type: "event",
          event: "sessions.changed",
          payload: { key: "agent:main:main" }
        });
      }
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(await client.call("health"), { ok: true });
});

test("native WS gateway client exposes handshake feature discovery", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: {
          type: "hello-ok",
          protocol: 4,
              server: { version: OPENCLAW_RECOMMENDED_VERSION, connId: "connection-1" },
          features: {
            methods: ["status", "chat.send", "sessions.subscribe"],
            events: ["chat", "sessions.changed"]
          },
          snapshot: {},
          auth: { role: "operator", scopes: ["operator.read"] },
          policy: { maxPayload: 1000000, maxBufferedBytes: 1000000, tickIntervalMs: 15000 }
        }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const hello = await client.probeNativeHandshake();

  assert.equal(hello.protocol, 4);
  assert.deepEqual(hello.features?.methods, ["status", "chat.send", "sessions.subscribe"]);
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect"]);
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client records requested and granted operator identity separately", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? {
              type: "hello-ok",
              protocol: 4,
              server: { version: OPENCLAW_RECOMMENDED_VERSION, connId: "connection-1" },
              features: { methods: [], events: [] },
              snapshot: {},
              auth: { role: "operator", scopes: ["operator.read"] },
              policy: { maxPayload: 1000000, maxBufferedBytes: 1000000, tickIntervalMs: 15000 }
            }
          : { ok: true }
      });
    });
  }, { requestedScopes: ["operator.read", "operator.write", "operator.questions"] });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250,
    role: "operator",
    scopes: ["operator.read", "operator.write", "operator.questions"]
  });

  const identity = await client.getOperatorIdentity();
  assert.equal(identity.requestedRole, "operator");
  assert.equal(identity.role, "operator");
  assert.deepEqual(identity.requestedScopes, ["operator.read", "operator.write", "operator.questions"]);
  assert.deepEqual(identity.grantedScopes, ["operator.read"]);
  assert.equal(identity.grantedScopesKnown, true);
  assert.equal(identity.connectionId, "connection-1");
  assert.equal(identity.authenticated, true);
  assert.equal(identity.source, "native-handshake");
});

test("native WS gateway client records protocol mismatch recovery diagnostics", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: { protocol: 99 }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await assert.rejects(
    () => client.getStatus(),
    /Gateway-native operation failed; CLI fallback disabled/
  );
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect"]);
  assert.deepEqual(fallback.calls, []);
  assert.deepEqual(getRecentOpenClawGatewayFallbackDiagnostics(), []);
  const diagnostics = client.getDiagnostics();
  assert.equal(diagnostics.gatewayMode, "unreachable");
  assert.match(diagnostics.lastNativeError ?? "", /supported range 4-4/);
  assert.match(diagnostics.recovery ?? "", /supported range 4-4/);
});

test("native WS gateway client uses Gateway first for typed status requests", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 4 }
          : {
              version: "9.9.9",
              update: {
                registry: {
                  latestVersion: "10.0.0"
                }
              },
              ignored: true
            }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(await client.getStatus(), {
    version: "9.9.9",
    update: {
      registry: {
        latestVersion: "10.0.0"
      }
    },
    ignored: true
  });
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "status"]);
  assert.deepEqual(sentFrames[0]?.params.client, {
    id: "gateway-client",
    version: "agentos",
    platform: process.platform,
    mode: "backend"
  });
  assert.equal(sentFrames[0]?.params.minProtocol, 4);
  assert.equal(sentFrames[0]?.params.maxProtocol, 4);
  assert.deepEqual(sentFrames[0]?.params.scopes, [
    "operator.admin",
    "operator.read",
    "operator.write",
    "operator.approvals",
    "operator.questions",
    "operator.pairing",
    "operator.talk",
    "operator.talk.secrets"
  ]);
  assert.deepEqual(fallback.calls, []);
  assert.deepEqual(getRecentOpenClawGatewayFallbackDiagnostics(), []);
});

test("native WS gateway client does not backfill missing update registry details from CLI status", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  fallback.statusPayload = {
    version: "9.9.9",
    update: {
      registry: {
        latestVersion: "10.0.0"
      }
    }
  };
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect" ? { protocol: 4 } : { version: "9.9.9" }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(await client.getStatus(), { version: "9.9.9" });
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "status"]);
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client uses CLI update status when Gateway lacks availability details", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  fallback.updateStatusPayload = {
    update: {
      registry: {
        latestVersion: "10.0.0"
      }
    },
    availability: {
      available: true,
      latestVersion: "10.0.0"
    }
  };
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect" ? { protocol: 4 } : { sentinel: null }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(await client.getUpdateStatus(), {
    sentinel: null,
    update: {
      registry: {
        latestVersion: "10.0.0"
      }
    },
    availability: {
      available: true,
      latestVersion: "10.0.0"
    }
  });
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "update.status"]);
  assert.deepEqual(fallback.calls.map((call) => call.method), ["getUpdateStatus"]);
  assert.equal(client.getDiagnostics().fallbackTotal, 1);
  assert.equal(getRecentOpenClawGatewayFallbackDiagnostics()[0]?.operation, "update.status");
});

test("native WS gateway client uses CLI update status when Gateway update status is unreachable", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  fallback.updateStatusPayload = {
    update: {
      registry: {
        latestVersion: "10.0.0"
      }
    },
    availability: {
      available: true,
      latestVersion: "10.0.0"
    }
  };
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: frame.method === "connect",
        payload: frame.method === "connect" ? { protocol: 4 } : undefined,
        error: frame.method === "connect" ? undefined : { message: "Gateway unavailable", code: "UNAVAILABLE" }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(await client.getUpdateStatus(), fallback.updateStatusPayload);
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "update.status"]);
  assert.deepEqual(fallback.calls.map((call) => call.method), ["getUpdateStatus"]);
  assert.equal(client.getDiagnostics().fallbackTotal, 1);
  assert.equal(getRecentOpenClawGatewayFallbackDiagnostics()[0]?.operation, "update.status");
});

test("native WS gateway client keeps status native without cached CLI registry backfill", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  fallback.statusPayload = {
    version: "9.9.9",
    update: {
      registry: {
        latestVersion: "10.0.0"
      }
    }
  };
  const { transport } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect" ? { protocol: 4 } : { version: "9.9.9" }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await client.getStatus();

  assert.deepEqual(await client.getStatus(), { version: "9.9.9" });
  assert.deepEqual(fallback.calls, []);
});
test("native WS gateway client does not hide malformed Gateway typed responses behind CLI", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 4 }
          : { models: [{ id: "missing-name" }] }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await assert.rejects(
    () => client.listModels(),
    /Gateway-native operation failed; CLI fallback disabled/
  );
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "models.list"]);
  assert.deepEqual(fallback.calls, []);
  assert.deepEqual(getRecentOpenClawGatewayFallbackDiagnostics(), []);
  assert.match(client.getDiagnostics().lastNativeError ?? "", /malformed response/);
});

test("native models.list keeps provider filtering client-side for the 9.1 Gateway contract", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 4 }
          : {
              models: [
                { id: "gpt-5.6-terra", provider: "openai", name: "GPT-5.6 Terra" },
                { id: "claude-sonnet-5", provider: "anthropic", name: "Claude Sonnet 5" }
              ]
            }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const result = await client.listModels({ all: true, provider: "openai" });

  assert.deepEqual(result.models.map((model) => model.key), ["openai/gpt-5.6-terra"]);
  assert.deepEqual(
    sentFrames.map((frame) => [frame.method, frame.params]).filter(([method]) => method !== "connect"),
    [["models.list", { view: "all" }]]
  );
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client falls back to CLI when Google provider catalog is incomplete", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  fallback.modelsPayload = {
    models: [
      {
        key: "google/gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        input: "text+image",
        contextWindow: 1048576,
        local: false,
        available: true,
        tags: [],
        missing: false
      },
      {
        key: "google/gemini-3.5-flash",
        name: "Gemini 3.5 Flash",
        input: "text+image",
        contextWindow: 1048576,
        local: false,
        available: true,
        tags: [],
        missing: false
      }
    ]
  };
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 4 }
          : { models: [{ id: "gemini-3.5-flash", provider: "google", name: "Gemini 3.5 Flash", input: ["text"] }] }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const result = await client.listModels({ all: true, provider: "google" });

  assert.deepEqual(result, fallback.modelsPayload);
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "models.list"]);
  assert.deepEqual(fallback.calls.map((call) => call.method), ["listModels"]);
  assert.equal(getRecentOpenClawGatewayFallbackDiagnostics()[0]?.operation, "models.list");
});

test("native WS gateway client treats mixed model auth profiles as connected when one profile is usable", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      const payload =
        frame.method === "connect"
          ? { protocol: 4 }
          : frame.method === "models.authStatus"
            ? {
                providers: [{
                  provider: "openai",
                  status: "expired",
                  profiles: [
                    { profileId: "openai:default", status: "expired" },
                    { profileId: "openai:user@example.com", status: "ok" },
                    { profileId: "openai:old@example.com", status: "missing" }
                  ]
                }]
              }
            : {
                models: [{
                  id: "gpt-5.5",
                  provider: "openai",
                  name: "gpt-5.5"
                }]
              };
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const status = await client.getModelStatus();

  assert.deepEqual(status.allowed, ["openai/gpt-5.5"]);
  assert.equal(status.auth?.providers?.[0]?.effective?.kind, "ok");
  assert.equal(status.auth?.providers?.[0]?.profiles?.count, 1);
  assert.equal(status.auth?.oauth?.providers?.[0]?.status, "ok");
  assert.deepEqual(
    sentFrames.map((frame) => frame.method).filter((method) => method !== "connect").sort(),
    ["models.authStatus", "models.list"]
  );
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client derives default model from configured model tags", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      const payload =
        frame.method === "connect"
          ? { protocol: 4 }
          : frame.method === "models.authStatus"
            ? {
                providers: [{
                  provider: "openai",
                  status: "ok",
                  profiles: [{ profileId: "openai:user@example.com", status: "ok" }]
                }]
              }
            : {
                models: [{
                  id: "gpt-5.4-mini",
                  provider: "openai",
                  name: "gpt-5.4-mini",
                  tags: ["default", "configured"]
                }]
              };
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const status = await client.getModelStatus();

  assert.equal(status.defaultModel, "openai/gpt-5.4-mini");
  assert.equal(status.resolvedDefault, "openai/gpt-5.4-mini");
  assert.deepEqual(status.allowed, ["openai/gpt-5.4-mini"]);
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client preserves Codex runtime auth routes for readiness", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      const payload =
        frame.method === "connect"
          ? { protocol: 4 }
          : frame.method === "models.authStatus"
            ? {
                defaultModel: "openai/gpt-5.4-mini",
                resolvedDefault: "openai/gpt-5.4-mini",
                providers: [],
                runtimeAuthRoutes: [
                  {
                    provider: "openai",
                    runtime: "codex",
                    authProvider: "openai",
                    status: "usable"
                  }
                ]
              }
            : {
                models: [{
                  id: "gpt-5.4-mini",
                  provider: "openai",
                  name: "gpt-5.4-mini"
                }]
              };
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const [status, models] = await Promise.all([
    client.getModelStatus(),
    client.listModels()
  ]);
  const readiness = resolveModelReadiness(models.models, status);

  assert.deepEqual(status.auth?.runtimeAuthRoutes, [
    {
      provider: "openai",
      runtime: "codex",
      authProvider: "openai",
      status: "usable"
    }
  ]);
  assert.equal(readiness.ready, true);
  assert.equal(readiness.defaultModelReady, true);
  assert.equal(
    readiness.authProviders.find((provider) => provider.provider === "openai")?.connected,
    true
  );
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client recovers partial Codex model auth status through CLI", async () => {
  const fallback = new FallbackGatewayClient();
  fallback.modelStatusPayload = {
    defaultModel: "openai/gpt-5.5",
    resolvedDefault: "openai/gpt-5.5",
    allowed: ["openai/gpt-5.5"],
    auth: {
      runtimeAuthRoutes: [
        {
          provider: "openai",
          runtime: "codex",
          authProvider: "openai",
          status: "usable"
        }
      ],
      providers: [
        {
          provider: "openai",
          effective: {
            kind: "profiles"
          },
          profiles: {
            count: 2,
            oauth: 2,
            token: 0,
            apiKey: 0
          }
        }
      ],
      oauth: {
        providers: [
          {
            provider: "openai",
            status: "ok",
            profiles: [{ profileId: "openai:user@example.com", status: "static" }]
          }
        ]
      },
      missingProvidersInUse: [],
      unusableProfiles: []
    } as never
  };
  const { transport } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      const payload =
        frame.method === "connect"
          ? { protocol: 4 }
          : frame.method === "models.authStatus"
            ? {
                providers: [{
                  provider: "openrouter",
                  status: "ok",
                  profiles: [{ profileId: "openrouter:manual", status: "static" }]
                }]
              }
            : {
                models: [{
                  id: "gpt-5.5",
                  provider: "openai",
                  name: "gpt-5.5",
                  tags: ["default", "configured"]
                }]
              };
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const status = await client.getModelStatus();
  const readiness = resolveModelReadiness(
    [
      {
        key: "openai/gpt-5.5",
        local: false,
        available: true,
        missing: false
      }
    ],
    status
  );

  assert.deepEqual(status.auth?.runtimeAuthRoutes, [
    {
      provider: "openai",
      runtime: "codex",
      authProvider: "openai",
      status: "usable"
    }
  ]);
  assert.equal(readiness.ready, true);
  assert.deepEqual(fallback.calls.map((call) => call.method), ["getModelStatus"]);
});

test("native WS gateway client recovers a fresh OpenAI OAuth profile without a configured model route", async () => {
  const fallback = new FallbackGatewayClient();
  fallback.modelStatusPayload = {
    allowed: ["openai/gpt-5.5"],
    auth: {
      providers: [{
        provider: "openai",
        effective: { kind: "oauth" },
        profiles: { count: 1, oauth: 1, token: 0, apiKey: 0 }
      }],
      oauth: {
        providers: [{
          provider: "openai",
          status: "ok",
          profiles: [{ profileId: "openai:user@example.com", status: "ok" }]
        }]
      }
    } as never
  };
  const { transport } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      const payload = frame.method === "connect"
        ? { protocol: 4 }
        : frame.method === "models.authStatus"
          ? {
              providers: [{
                provider: "openai",
                status: "ok",
                profiles: [{ profileId: "openai:user@example.com", type: "oauth", status: "ok" }]
              }]
            }
          : { models: [] };
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const status = await client.getModelStatus();

  assert.deepEqual(status.allowed, ["openai/gpt-5.5"]);
  assert.equal(status.auth?.oauth?.providers?.[0]?.status, "ok");
  assert.deepEqual(fallback.calls.map((call) => call.method), ["getModelStatus"]);
});

test("native WS gateway client reads agent model status through Gateway methods", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      const payload =
        frame.method === "connect"
          ? { protocol: 4 }
          : frame.method === "models.authStatus"
            ? {
                agentDir: "/tmp/agent-1",
                providers: [{
                  provider: "openai",
                  status: "expired",
                  profiles: [{ profileId: "openai:user@example.com", status: "ok" }],
                  effectiveProfiles: [{ profileId: "openai:user@example.com" }]
                }]
              }
            : {
                models: [{
                  id: "gpt-5.5",
                  provider: "openai",
                  name: "gpt-5.5"
                }]
              };
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const status = await client.getAgentModelStatus({ agentId: "agent-1" });

  assert.equal(status.agentDir, "/tmp/agent-1");
  assert.deepEqual(status.allowed, ["openai/gpt-5.5"]);
  assert.equal(status.auth?.oauth?.providers?.[0]?.status, "ok");
  assert.deepEqual(status.auth?.oauth?.providers?.[0]?.profiles, [
    { profileId: "openai:user@example.com", status: "ok" }
  ]);
  assert.deepEqual(status.auth?.oauth?.providers?.[0]?.effectiveProfiles, [
    { profileId: "openai:user@example.com" }
  ]);
  assert.deepEqual(
    sentFrames.map((frame) => [frame.method, frame.params]).filter(([method]) => method !== "connect"),
    [
      ["models.authStatus", { agentId: "agent-1" }],
      ["models.list", { view: "configured", agentId: "agent-1" }]
    ]
  );
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client sets model auth order through Gateway before CLI fallback", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect" ? { protocol: 4 } : { ok: true }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const result = await client.setModelAuthOrder({
    provider: "openai",
    agentId: "agent-1",
    profileIds: ["profile-1"]
  });

  assert.equal(result.stderr, "");
  assert.deepEqual(
    sentFrames.map((frame) => [frame.method, frame.params]).filter(([method]) => method !== "connect"),
    [
      ["models.authOrder.set", {
        provider: "openai",
        agentId: "agent-1",
        profileIds: ["profile-1"]
      }]
    ]
  );
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client uses model auth order compatibility aliases before CLI fallback", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 4, features: { methods: ["models.auth.order.set"] } }
          : { ok: true }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await client.setModelAuthOrder({
    provider: "openai",
    agentId: "agent-1",
    profileIds: ["profile-1"]
  });

  assert.deepEqual(
    sentFrames.map((frame) => frame.method),
    ["connect", "models.auth.order.set"]
  );
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client clears operation fallback diagnostics after Gateway recovery", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  let malformed = true;
  const { transport } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: frame.method === "connect" || !malformed,
        payload: frame.method === "connect"
          ? { protocol: 4 }
          : malformed
            ? undefined
            : { models: [{ id: "gpt-5.5", provider: "openai", name: "GPT 5.5", input: ["text"] }] },
        error: frame.method !== "connect" && malformed
          ? { message: "INVALID_REQUEST: unknown method: models.list" }
          : undefined
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(await client.listModels(), { models: [] });
  assert.equal(getRecentOpenClawGatewayFallbackDiagnostics()[0]?.operation, "models.list");

  malformed = false;
  assert.deepEqual(await client.listModels(), {
    models: [{
      key: "openai/gpt-5.5",
      name: "GPT 5.5",
      provider: "openai",
      input: "text",
      contextWindow: null,
      local: null,
      available: null,
      tags: [],
      missing: false
    }]
  });
  assert.deepEqual(getRecentOpenClawGatewayFallbackDiagnostics(), []);
});

test("native WS gateway client uses Gateway first for agent list", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 4 }
          : {
              defaultId: "main",
              mainKey: "main",
              scope: "per-sender",
              agents: [{
                id: "main",
                identity: { name: "Main" },
                workspace: "/workspace",
                model: { primary: "openai/test-model" },
                ignored: true
              }]
            }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(await client.listAgents(), {
    defaultId: "main",
    mainKey: "main",
    scope: "per-sender",
    agents: [{
      id: "main",
      identity: { name: "Main" },
      workspace: "/workspace",
      model: { primary: "openai/test-model" },
      ignored: true
    }]
  });
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "agents.list"]);
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client reads config paths from Gateway snapshots", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 4 }
          : {
              exists: true,
              valid: true,
              hash: "hash-1",
              config: {
                gateway: {
                  remote: {
                    url: "ws://127.0.0.1:18789"
                  }
                }
              }
            }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.equal(await client.getConfig("gateway.remote.url"), "ws://127.0.0.1:18789");
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "config.get"]);
  assert.deepEqual(sentFrames[1]?.params, {});
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client dedupes concurrent config snapshot reads", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    if (frame.method === "connect") {
      globalThis.queueMicrotask(() => {
        socket.emitMessage({ type: "res", id: frame.id, ok: true, payload: { protocol: 4 } });
      });
      return;
    }

    globalThis.setTimeout(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: {
          exists: true,
          valid: true,
          hash: "hash-1",
          config: {
            gateway: {
              remote: {
                url: "ws://127.0.0.1:18789"
              }
            }
          }
        }
      });
    }, 5);
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const values = await Promise.all(
    Array.from({ length: 10 }, () => client.getConfig("gateway.remote.url"))
  );
  const cachedValue = await client.getConfig("gateway.remote.url");

  assert.deepEqual(values, Array.from({ length: 10 }, () => "ws://127.0.0.1:18789"));
  assert.equal(cachedValue, "ws://127.0.0.1:18789");
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "config.get"]);
  assert.equal(client.getDiagnostics().cachedReadRequestCount, 1);
  assert.equal(client.getDiagnostics().sharedInFlightRequestCount, 0);
  assert.deepEqual(fallback.calls, []);
});

test("official transport preserves shared AgentOS request-policy semantics", async () => {
  let now = 1_000;
  let readCount = 0;
  const pendingResponses = new Map<string, (payload: unknown) => void>();
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames, sockets } = createFakeGatewayTransport((socket, frame) => {
    if (frame.method === "policy.signal") {
      if (sentFrames.filter((sent) => sent.method === "policy.signal").length === 1) {
        pendingResponses.set(frame.id, (payload) => socket.emitMessage({
          type: "res",
          id: frame.id,
          ok: true,
          payload
        }));
        return;
      }
      globalThis.queueMicrotask(() => {
        socket.emitMessage({
          type: "res",
          id: frame.id,
          ok: true,
          payload: { value: "normal" }
        });
      });
      return;
    }

    if (frame.method === "policy.pending") {
      pendingResponses.set(frame.id, (payload) => socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload
      }));
      return;
    }

    if (frame.method === "policy.update" && frame.params?.ambiguous === true) {
      return;
    }

    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 4 }
          : frame.method === "policy.read"
            ? { value: ++readCount }
            : { ok: true }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    requestPolicy: new AgentOsGatewayRequestPolicy({ now: () => now }),
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  try {
    const [first, equivalent] = await Promise.all([
      client.call<{ value: number }>("policy.read", { a: 1, b: 2 }),
      client.call<{ value: number }>("policy.read", { b: 2, a: 1 })
    ]);
    assert.deepEqual(first, { value: 1 });
    assert.deepEqual(equivalent, { value: 1 });
    assert.equal(sentFrames.filter((frame) => frame.method === "policy.read").length, 1);

    now += 301;
    assert.deepEqual(await client.call("policy.read", { a: 1, b: 2 }), { value: 2 });
    await client.call("policy.update", {});
    assert.deepEqual(await client.call("policy.read", { a: 1, b: 2 }), { value: 3 });

    const pending = client.callNative("policy.pending", {}, {}, { safety: "read" });
    await waitForNativePolicy(() => sentFrames.filter((frame) => frame.method === "policy.pending").length === 1);
    assert.equal(client.getDiagnostics().sharedInFlightRequestCount, 1);
    pendingResponses.get(sentFrames.find((frame) => frame.method === "policy.pending")?.id ?? "")?.({ ok: true });
    await pending;
    assert.equal(client.getDiagnostics().sharedInFlightRequestCount, 0);

    const controller = new AbortController();
    const signalled = client.callNative(
      "policy.signal",
      { key: "same-read" },
      { signal: controller.signal },
      { safety: "read" }
    );
    await waitForNativePolicy(() => sentFrames.filter((frame) => frame.method === "policy.signal").length === 1);
    const normal = client.callNative("policy.signal", { key: "same-read" }, {}, { safety: "read" });
    await waitForNativePolicy(() => sentFrames.filter((frame) => frame.method === "policy.signal").length === 2);
    controller.abort();
    await assert.rejects(signalled);
    const signalFrames = sentFrames.filter((frame) => frame.method === "policy.signal");
    sockets[0]?.emitMessage({ type: "res", id: signalFrames[1]?.id, ok: true, payload: { value: "normal" } });
    assert.deepEqual(await normal, { value: "normal" });

    await client.call("policy.read", { id: "ambiguous" });
    await assert.rejects(
      client.callNative(
        "policy.update",
        { ambiguous: true },
        { timeoutMs: 20 },
        { safety: "mutation" }
      ),
      (error: unknown) => {
        assert.ok(error instanceof NativeGatewayRequestError);
        assert.equal(error.sent, true);
        return true;
      }
    );
    await client.call("policy.read", { id: "ambiguous" });

  client.close("request policy reconnect");
    await delay(0);
    await client.call("policy.read", { a: 1, b: 2 });
    assert.equal(sentFrames.filter((frame) => frame.method === "policy.read").length, 6);
    assert.deepEqual(fallback.calls, []);
  } finally {
  client.close("request-policy test cleanup");
  }
});

test("native WS gateway client uses Gateway first for session list", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 4 }
          : {
              sessions: [{
                key: "agent:main:direct:test",
                agentId: "main",
                sessionId: "session-1",
                updatedAt: 123
              }],
              ignored: true
            }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(await client.listSessions({ limit: 1 }), {
    sessions: [{
      key: "agent:main:direct:test",
      agentId: "main",
      sessionId: "session-1",
      updatedAt: 123
    }],
    ignored: true
  });
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "sessions.list"]);
  assert.deepEqual(sentFrames[1]?.params, { limit: 1 });
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client uses Gateway first for channel status", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 4 }
          : {
              ts: 123,
              channelOrder: ["telegram"],
              channelLabels: { telegram: "Telegram" },
              channelDetailLabels: { telegram: "Telegram Bot" },
              channels: { telegram: { configured: true } },
              channelAccounts: {
                telegram: [{
                  accountId: "main",
                  connected: true,
                  ignored: true
                }]
              },
              channelDefaultAccountId: { telegram: "main" },
              ignored: true
            }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(await client.getChannelStatus({ probe: true, timeoutMs: 500 }), {
    ts: 123,
    channelOrder: ["telegram"],
    channelLabels: { telegram: "Telegram" },
    channelDetailLabels: { telegram: "Telegram Bot" },
    channels: { telegram: { configured: true } },
    channelAccounts: {
      telegram: [{
        accountId: "main",
        connected: true,
        ignored: true
      }]
    },
    channelDefaultAccountId: { telegram: "main" },
    ignored: true
  });
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "channels.status"]);
  assert.deepEqual(sentFrames[1]?.params, { probe: true, timeoutMs: 500 });
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client surfaces malformed channel status without CLI fallback", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect" ? { protocol: 4 } : { channelOrder: [] }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await assert.rejects(
    () => client.getChannelStatus(),
    /Gateway-native operation failed; CLI fallback disabled/
  );
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "channels.status"]);
  assert.deepEqual(fallback.calls, []);
  assert.deepEqual(getRecentOpenClawGatewayFallbackDiagnostics(), []);
  assert.match(client.getDiagnostics().lastNativeError ?? "", /malformed response/);
});

test("native WS gateway client runs channel QR login and logout through Gateway", async () => {
  const fallback = new FallbackGatewayClient();
  const qrDataUrl = "data:image/png;base64,cXItY29kZQ==";
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      const payload = frame.method === "connect"
        ? { protocol: 4 }
        : frame.method === "web.login.start"
          ? { connected: false, qrDataUrl }
          : frame.method === "web.login.wait"
            ? { connected: true, message: "linked" }
            : { channel: "whatsapp", accountId: "default", loggedOut: true };
      socket.emitMessage({ type: "res", id: frame.id, ok: true, payload });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(await client.startWebLogin({ force: true, accountId: "default" }), {
    connected: false,
    qrDataUrl
  });
  assert.deepEqual(await client.waitForWebLogin({ accountId: "default", currentQrDataUrl: qrDataUrl }), {
    connected: true,
    message: "linked"
  });
  assert.deepEqual(await client.logoutChannel({ channel: "whatsapp", accountId: "default" }), {
    channel: "whatsapp",
    accountId: "default",
    loggedOut: true
  });
  assert.deepEqual(sentFrames.map((frame) => frame.method), [
    "connect",
    "web.login.start",
    "web.login.wait",
    "channels.logout"
  ]);
  assert.deepEqual(sentFrames[1]?.params, { force: true, accountId: "default" });
  assert.deepEqual(sentFrames[2]?.params, { accountId: "default", currentQrDataUrl: qrDataUrl });
  assert.deepEqual(sentFrames[3]?.params, { channel: "whatsapp", accountId: "default" });
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client reads channel logs through Gateway before CLI fallback", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 4 }
          : { lines: [{ time: "2026-05-18T12:00:00.000Z", message: "hello" }] }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(await client.getChannelLogs({ channel: "telegram", lines: 25 }), {
    lines: [{ time: "2026-05-18T12:00:00.000Z", message: "hello" }]
  });
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "channels.logs"]);
  assert.deepEqual(sentFrames[1]?.params, { channel: "telegram", lines: 25 });
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client provisions channel accounts through Gateway before CLI fallback", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect" ? { protocol: 4 } : { ok: true, accountId: "telegram-main" }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const result = await client.provisionChannelAccount({
    channel: "telegram",
    account: "telegram-main",
    token: "token",
    name: "Telegram Main"
  });
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, accountId: "telegram-main" });
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "channels.add"]);
  assert.deepEqual(sentFrames[1]?.params, {
    channel: "telegram",
    account: "telegram-main",
    accountId: "telegram-main",
    name: "Telegram Main",
    token: "token"
  });
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client removes channel accounts through Gateway before CLI fallback", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect" ? { protocol: 4 } : { ok: true }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(JSON.parse((await client.removeChannelAccount({
    channel: "telegram",
    account: "telegram-main",
    delete: true
  })).stdout), { ok: true });
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "channels.remove"]);
  assert.deepEqual(sentFrames[1]?.params, {
    channel: "telegram",
    account: "telegram-main",
    accountId: "telegram-main",
    delete: true
  });
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client sets up Gmail webhooks through Gateway before CLI fallback", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect" ? { protocol: 4 } : { ok: true }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(JSON.parse((await client.setupGmailWebhook({
    account: "user@example.com",
    config: { project: "agentos" }
  })).stdout), { ok: true });
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "webhooks.gmail.setup"]);
  assert.deepEqual(sentFrames[1]?.params, {
    account: "user@example.com",
    config: { project: "agentos" }
  });
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client approves device access through Gateway before CLI fallback", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      const payload = frame.method === "connect"
        ? { protocol: 4 }
        : frame.method === "device.pair.list"
          ? {
              pending: [
                { requestId: "older-request", ts: 1 },
                { requestId: "latest-request", ts: 2 }
              ]
            }
          : { requestId: "latest-request", device: { deviceId: "device-1", approvedScopes: ["operator.read"] } };

      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(await client.approveDeviceAccess({ latest: true }), {
    requestId: "latest-request",
    device: { deviceId: "device-1", approvedScopes: ["operator.read"] }
  });
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "device.pair.list", "device.pair.approve"]);
  assert.deepEqual(sentFrames[2]?.params, { requestId: "latest-request" });
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client retries device approval without scopes for older Gateway contracts", async () => {
  const fallback = new FallbackGatewayClient();
  let approveCalls = 0;
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      if (frame.method === "connect") {
        socket.emitMessage({
          type: "res",
          id: frame.id,
          ok: true,
          payload: { protocol: 4 }
        });
        return;
      }

      if (frame.method === "device.pair.list") {
        socket.emitMessage({
          type: "res",
          id: frame.id,
          ok: true,
          payload: { pending: [{ requestId: "latest-request", ts: 2 }] }
        });
        return;
      }

      approveCalls += 1;
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: approveCalls > 1,
        payload: approveCalls > 1
          ? {
              requestId: "latest-request",
              device: { deviceId: "device-1", approvedScopes: ["operator.read", "operator.write"] }
            }
          : undefined,
        error: approveCalls > 1
          ? undefined
          : {
              message: "INVALID_REQUEST: invalid device.pair.approve params: at root: unexpected property 'scopes'"
            }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(await client.approveDeviceAccess({
    latest: true,
    scopes: ["operator.read", "operator.write"]
  }), {
    requestId: "latest-request",
    device: { deviceId: "device-1", approvedScopes: ["operator.read", "operator.write"] }
  });
  assert.deepEqual(sentFrames.map((frame) => frame.method), [
    "connect",
    "device.pair.list",
    "device.pair.approve",
    "device.pair.approve"
  ]);
  assert.deepEqual(sentFrames[2]?.params, {
    requestId: "latest-request",
    scopes: ["operator.read", "operator.write"]
  });
  assert.deepEqual(sentFrames[3]?.params, { requestId: "latest-request" });
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client mutates config through Gateway snapshots", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 4 }
          : frame.method === "config.get"
            ? {
                exists: true,
                valid: true,
                hash: "hash-1",
                config: {
                  gateway: {
                    remote: {}
                  }
                }
              }
            : { ok: true, path: "/config/openclaw.json", config: {} }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const result = await client.setConfig("gateway.remote.url", "ws://127.0.0.1:18789");

  assert.match(result.stdout, /"ok":true/);
  assert.deepEqual(sentFrames.map((frame) => frame.method), [
    "connect",
    "config.get",
    "config.schema.lookup",
    "config.patch"
  ]);
  assert.deepEqual(sentFrames[3]?.params, {
    raw: JSON.stringify({ gateway: { remote: { url: "ws://127.0.0.1:18789" } } }),
    baseHash: "hash-1"
  });
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client persists agents.list even when the Gateway snapshot already matches", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 4 }
          : frame.method === "config.get"
            ? {
                exists: true,
                valid: true,
                hash: "hash-1",
                config: {
                  agents: {
                    list: [{ id: "agent-1", workspace: "/workspace" }]
                  }
                }
              }
            : { ok: true }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const result = await client.setConfig("agents.list", [{ id: "agent-1", workspace: "/workspace" }], { strictJson: true });

  assert.match(result.stdout, /"appliedVia":"config.patch"/);
  assert.deepEqual(sentFrames.map((frame) => frame.method), [
    "connect",
    "config.get",
    "config.schema.lookup",
    "config.patch"
  ]);
  assert.deepEqual(sentFrames[3]?.params, {
    raw: JSON.stringify({ agents: { list: [{ id: "agent-1", workspace: "/workspace" }] } }),
    replacePaths: ["agents.list[].skills"],
    baseHash: "hash-1"
  });
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway config object replacement removes omitted members with merge-patch tombstones", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 4 }
          : frame.method === "config.get"
            ? {
                exists: true,
                valid: false,
                hash: "hash-provider",
                config: {
                  models: {
                    providers: {
                      openrouter: {
                        baseUrl: "",
                        models: [{ id: "auto" }]
                      }
                    }
                  }
                }
              }
            : { ok: true }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await client.setConfig("models.providers.openrouter", {
    apiKey: "sk-or-test",
    models: [{ id: "auto" }]
  });

  assert.deepEqual(sentFrames.map((frame) => frame.method), [
    "connect",
    "config.get",
    "config.schema.lookup",
    "config.patch"
  ]);
  assert.deepEqual(sentFrames[3]?.params, {
    raw: JSON.stringify({
      models: {
        providers: {
          openrouter: {
            baseUrl: null,
            apiKey: "sk-or-test",
            models: [{ id: "auto" }]
          }
        }
      }
    }),
    baseHash: "hash-provider"
  });
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client returns config reload metadata from schema lookup", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 4 }
          : frame.method === "config.get"
            ? { exists: true, valid: true, hash: "hash-1", config: { gateway: { auth: {} } } }
            : frame.method === "config.schema.lookup"
              ? { path: "gateway.auth.token", reloadKind: "restart" }
              : { ok: true }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const result = await client.setConfig("gateway.auth.token", "secret-token");
  const payload = JSON.parse(result.stdout);

  assert.equal(result.metadata?.openClawConfig && typeof result.metadata.openClawConfig === "object"
    ? (result.metadata.openClawConfig as { reloadKind?: unknown }).reloadKind
    : null, "restart");
  assert.equal(payload.configMutation.reloadKind, "restart");
  assert.equal(payload.configMutation.restartRequired, true);
});

test("native WS gateway client closes persistent connection after Gateway auth URL config mutation", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 4 }
          : frame.method === "config.get"
            ? { exists: true, valid: true, hash: "hash-1", config: { gateway: { remote: {} } } }
            : frame.method === "status"
              ? { version: "9.9.9" }
              : { ok: true }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await client.setConfig("gateway.remote.url", "ws://127.0.0.1:18789");
  await client.getStatus();

  assert.deepEqual(sentFrames.map((frame) => frame.method), [
    "connect",
    "config.get",
    "config.schema.lookup",
    "config.patch",
    "connect",
    "status"
  ]);
});

test("native WS gateway client falls back to CLI for Gateway auth config repair when token mismatches", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: false,
        error: {
          message: "INVALID_REQUEST: unauthorized: gateway token mismatch (provide gateway auth token)"
        }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await client.setConfig("gateway.auth.token", "fresh-token", { allowGatewayAuthRepairFallback: true });

  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect"]);
  assert.deepEqual(fallback.calls.map((call) => call.method), ["setConfig"]);
  assert.equal(fallback.config.get("gateway.auth.token"), "fresh-token");
  assert.equal(getRecentOpenClawGatewayFallbackDiagnostics()[0]?.kind, "auth");
});

test("native WS gateway client reports OK after auth repair reconnects", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  let connectAttempts = 0;
  const { transport } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      if (frame.method === "connect") {
        connectAttempts += 1;
        socket.emitMessage({
          type: "res",
          id: frame.id,
          ok: connectAttempts > 1,
          payload: connectAttempts > 1 ? { protocol: 4 } : undefined,
          error: connectAttempts === 1
            ? { message: "INVALID_REQUEST: unauthorized: gateway token mismatch (provide gateway auth token)" }
            : undefined
        });
        return;
      }

      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "status" ? { version: "9.9.9" } : { ok: true }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await client.setConfig("gateway.auth.token", "fresh-token", { allowGatewayAuthRepairFallback: true });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await client.getStatus();

  const diagnostics = client.getDiagnostics();
  assert.equal(diagnostics.gatewayMode, "native-ws");
  assert.equal(diagnostics.statusLabel, "Native Gateway: OK");
  assert.equal(diagnostics.recovery, null);
  assert.equal(diagnostics.fallbackTotal, 1);
  assert.equal(diagnostics.recentFallbackDiagnostics[0]?.kind, "auth");
  assert.match(diagnostics.lastNativeError ?? "", /token mismatch/);
});

test("native WS gateway client falls back from config.patch to config.apply", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      if (frame.method === "config.patch") {
        socket.emitMessage({
          type: "res",
          id: frame.id,
          ok: false,
          error: { message: "unknown method: config.patch" }
        });
        return;
      }

      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 4 }
          : frame.method === "config.get"
            ? {
                exists: true,
                valid: true,
                hash: "hash-2",
                config: {
                  gateway: {
                    remote: {}
                  }
                }
              }
            : { ok: true, method: frame.method }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const result = await client.setConfig("gateway.remote.url", "ws://127.0.0.1:18789");

  assert.match(result.stdout, /"ok":true/);
  assert.deepEqual(sentFrames.map((frame) => frame.method), [
    "connect",
    "config.get",
    "config.schema.lookup",
    "config.patch",
    "config.apply"
  ]);
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client does not use CLI fallback when config.patch is rate limited", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      if (frame.method === "config.patch") {
        socket.emitMessage({
          type: "res",
          id: frame.id,
          ok: false,
          error: { message: "UNAVAILABLE: rate limit exceeded for config.patch; retry after 17s" }
        });
        return;
      }

      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 4 }
          : frame.method === "config.get"
            ? { exists: true, valid: true, hash: "hash-3", config: { agents: {} } }
            : { ok: true, method: frame.method }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await assert.rejects(
    () => client.setConfig("agents.list", [{ id: "agent-1", workspace: "/workspace" }], { strictJson: true }),
    /rate limit exceeded for config\.patch.*CLI fallback disabled/
  );

  assert.deepEqual(sentFrames.map((frame) => frame.method), [
    "connect",
    "config.get",
    "config.schema.lookup",
    "config.patch"
  ]);
  assert.deepEqual(fallback.calls, []);
  assert.deepEqual(getRecentOpenClawGatewayFallbackDiagnostics(), []);
  assert.equal(client.getDiagnostics().gatewayMode, "degraded");
  assert.match(client.getDiagnostics().recovery ?? "", /cooldown/);
});

test("native WS gateway client does not escalate config.patch conflict to apply or CLI fallback", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: frame.method !== "config.patch",
        payload: frame.method === "connect"
          ? { protocol: 4 }
          : frame.method === "config.get"
            ? { exists: true, valid: true, hash: "hash-2", config: { gateway: { remote: {} } } }
            : frame.method === "config.patch"
              ? undefined
              : { ok: true },
        error: frame.method === "config.patch"
          ? { code: "CONFIG_CONFLICT", message: "baseHash conflict" }
          : undefined
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await assert.rejects(
    () => client.setConfig("gateway.remote.url", "ws://127.0.0.1:18789"),
    /baseHash conflict/
  );
  assert.deepEqual(sentFrames.map((frame) => frame.method), [
    "connect",
    "config.get",
    "config.schema.lookup",
    "config.patch"
  ]);
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client does not escalate config.patch auth failure to apply or CLI fallback", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: frame.method !== "config.patch",
        payload: frame.method === "connect"
          ? { protocol: 4 }
          : frame.method === "config.get"
            ? { exists: true, valid: true, hash: "hash-2", config: { gateway: { remote: {} } } }
            : frame.method === "config.patch"
              ? undefined
              : { ok: true },
        error: frame.method === "config.patch"
          ? { message: "missing operator.admin scope" }
          : undefined
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await assert.rejects(
    () => client.setConfig("gateway.remote.url", "ws://127.0.0.1:18789"),
    /operator\.admin/
  );
  assert.deepEqual(sentFrames.map((frame) => frame.method), [
    "connect",
    "config.get",
    "config.schema.lookup",
    "config.patch"
  ]);
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client does not CLI fallback after sent config.apply timeout", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      if (frame.method === "config.patch") {
        socket.emitMessage({
          type: "res",
          id: frame.id,
          ok: false,
          error: { message: "unknown method: config.patch" }
        });
        return;
      }

      if (frame.method === "config.apply") {
        return;
      }

      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 4 }
          : frame.method === "config.get"
            ? { exists: true, valid: true, hash: "hash-2", config: { gateway: { remote: {} } } }
            : { ok: true }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 20
  });

  await assert.rejects(
    () => client.setConfig("gateway.remote.url", "ws://127.0.0.1:18789"),
    /timed out after/
  );
  assert.deepEqual(sentFrames.map((frame) => frame.method), [
    "connect",
    "config.get",
    "config.schema.lookup",
    "config.patch",
    "config.apply"
  ]);
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client refuses redacted config writes without CLI fallback", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport(() => {});
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await assert.rejects(
    () => client.setConfig("gateway.auth.token", "__OPENCLAW_REDACTED__"),
    /Refusing to write a redacted OpenClaw secret/
  );
  assert.deepEqual(sentFrames, []);
  assert.deepEqual(fallback.calls, []);
});


test("native WS gateway client surfaces native failure without CLI fallback after Gateway failure", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  fallback.failStatus = true;
  const { transport } = createFakeGatewayTransport((socket, frame) => {
    if (frame.method !== "connect") {
      return;
    }

    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: false,
        error: { message: "scope denied" }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await assert.rejects(
    () => client.getStatus(),
    /Gateway-native operation failed; CLI fallback disabled/
  );
  assert.deepEqual(fallback.calls, []);
  assert.deepEqual(getRecentOpenClawGatewayFallbackDiagnostics(), []);
  assert.match(client.getDiagnostics().lastNativeError ?? "", /scope denied/);
});

test("native WS gateway client does not CLI fallback when handshake auth fails", async () => {
  const fallback = new FallbackGatewayClient();
  const failures: string[] = [];
  const { transport } = createFakeGatewayTransport((socket, frame) => {
    if (frame.method !== "connect") {
      return;
    }

    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: false,
        error: {
          message: "auth failed"
        }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250,
    onNativeFailure: (error) => failures.push(error instanceof Error ? error.message : String(error))
  });

  await assert.rejects(
    () => client.call<{ fallback: boolean; method: string }>("health", { probe: true }),
    /Gateway-native operation failed; CLI fallback disabled/
  );
  assert.deepEqual(fallback.calls, []);
  assert.match(failures[0], /auth failed/);
});

test("native WS gateway client does not CLI fallback on native timeout", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport } = createFakeGatewayTransport(() => {});
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 20
  });

  await assert.rejects(
    () => client.call<{ fallback: boolean; method: string }>("health", { probe: true }),
    /Gateway-native operation failed; CLI fallback disabled/
  );
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client does not CLI fallback after sent mutation timeout", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    if (frame.method === "connect") {
      globalThis.queueMicrotask(() => {
        socket.emitMessage({ type: "res", id: frame.id, ok: true, payload: { protocol: 4 } });
      });
    }
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 20
  });

  await assert.rejects(
    () => client.deleteAgent("agent-1"),
    /timed out after/
  );
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "agents.delete"]);
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client attempts an omitted mutation before applying fallback policy", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    if (frame.method === "connect") {
      globalThis.queueMicrotask(() => {
        socket.emitMessage({
          type: "res",
          id: frame.id,
          ok: true,
          payload: { protocol: 4, features: { methods: ["status"] } }
        });
      });
    }
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await assert.rejects(
    () => client.deleteAgent("agent-1"),
    /timed out after/
  );

  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "agents.delete"]);
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client blocks CLI fallback for sent mutation auth failures", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: frame.method === "connect",
        payload: frame.method === "connect" ? { protocol: 4 } : undefined,
        error: frame.method === "connect" ? undefined : { message: "unauthorized" }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await assert.rejects(
    () => client.deleteAgent("agent-1"),
    /unauthorized/
  );
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "agents.delete"]);
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client blocks CLI fallback for sent mutation malformed request failures", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: frame.method === "connect",
        payload: frame.method === "connect" ? { protocol: 4 } : undefined,
        error: frame.method === "connect" ? undefined : { message: "invalid request payload" }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await assert.rejects(
    () => client.provisionChannelAccount({ channel: "telegram", account: "main" }),
    /invalid request payload/
  );
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "channels.add"]);
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client honors forced CLI mode without opening a socket", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport(() => {
    throw new Error("socket should not be used");
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250,
    forceCli: true
  });

  const result = await client.call<{ fallback: boolean; method: string }>("health", { probe: true });

  assert.deepEqual(result, { fallback: true, method: "health", params: { probe: true } });
  assert.deepEqual(sentFrames, []);
  assert.deepEqual(fallback.calls.map((call) => call.method), ["health"]);
});

test("native WS gateway client blocks per-request CLI mutation fallback without native proof", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport(() => {
    throw new Error("socket should not be used");
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await assert.rejects(
    () => client.streamAgentTurn(
      { agentId: "agent-1", sessionId: "session-1", message: "hello" },
      {},
      { forceCli: true }
    ),
    /CLI fallback for OpenClaw mutation chat\.send requires a current native Gateway authorization proof/
  );

  assert.deepEqual(sentFrames, []);
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client classifies unknown Gateway methods as unsupported", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  const { transport } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: frame.method === "connect",
        payload: frame.method === "connect" ? { protocol: 4 } : undefined,
        error: frame.method === "connect" ? undefined : { message: "INVALID_REQUEST: unknown method: models.authStatus" }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await client.getModelStatus();

  assert.deepEqual(fallback.calls.map((call) => call.method), ["getModelStatus"]);
  assert.equal(getRecentOpenClawGatewayFallbackDiagnostics()[0]?.operation, "models.authStatus");
  assert.equal(getRecentOpenClawGatewayFallbackDiagnostics()[0]?.kind, "unsupported");
});

test("native WS gateway client uses Gateway first for critical workflows with compatible payloads", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? {
              protocol: 4,
              server: { connId: "connection-1" },
              auth: { role: "operator", scopes: ["operator.admin"] }
            }
          : { runId: "run-1", status: "running" }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await client.probeNativeHandshake();
  await client.addAgent(
    { id: "agent-1", workspace: "/workspace", agentDir: "/agent" },
    { authorizationProof: nativeAuthorizationProof() }
  );
  await client.deleteAgent("agent-1");
  await client.runAgentTurn({ agentId: "agent-1", message: "hello", workspace: "/workspace" });
  await client.abortAgentTurn({ runId: "run-1", reason: "stop" });

  assert.deepEqual(sentFrames.map((frame) => frame.method), [
    "connect",
    "agents.create",
    "agents.delete",
    "chat.send",
    "sessions.abort"
  ]);
  assert.deepEqual(fallback.calls, []);
  assert.deepEqual(sentFrames.find((frame) => frame.method === "agents.create")?.params, {
    name: "agent-1",
    workspace: "/workspace"
  });
  const chatParams = sentFrames.find((frame) => frame.method === "chat.send")?.params;
  assert.equal(chatParams?.sessionKey, "agent:agent-1:main");
  assert.equal(Object.hasOwn(chatParams ?? {}, "agentId"), false);
  assert.equal(Object.hasOwn(chatParams ?? {}, "workspace"), false);
  assert.equal(sentFrames.find((frame) => frame.method === "sessions.abort")?.params.runId, "run-1");
});

test("native WS gateway client waits for agent turn completion when a timeout is requested", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? {
              protocol: 4,
              features: {
                methods: ["chat.send", "agent.wait"]
              }
            }
          : frame.method === "agent.wait"
            ? {
                runId: "run-1",
                status: "completed",
                summary: "Done",
                payloads: [{ text: "Done", mediaUrl: null }]
              }
            : {
                runId: "run-1",
                status: "started"
              }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const result = await client.runAgentTurn({
    agentId: "agent-1",
    sessionId: "session-1",
    message: "hello",
    timeoutSeconds: 1
  });

  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "chat.send", "agent.wait"]);
  assert.deepEqual(sentFrames[2]?.params, {
    runId: "run-1",
    timeoutMs: 1000
  });
  assert.equal(result.status, "completed");
  assert.equal(result.payloads?.[0]?.text, "Done");
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client retries agent wait with session params for legacy Gateway schemas", async () => {
  const fallback = new FallbackGatewayClient();
  let waitAttempts = 0;
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      if (frame.method === "connect") {
        socket.emitMessage({
          type: "res",
          id: frame.id,
          ok: true,
          payload: {
            protocol: 4,
            features: {
              methods: ["chat.send", "agent.wait"]
            }
          }
        });
        return;
      }

      if (frame.method === "agent.wait") {
        waitAttempts += 1;
        socket.emitMessage({
          type: "res",
          id: frame.id,
          ok: waitAttempts > 1,
          error: waitAttempts === 1
            ? { message: "INVALID_REQUEST: invalid agent.wait params: must have required property 'sessionKey'" }
            : undefined,
          payload: waitAttempts > 1
            ? {
                runId: "run-1",
                status: "completed",
                summary: "Done",
                payloads: [{ text: "Done", mediaUrl: null }]
              }
            : undefined
        });
        return;
      }

      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: {
          runId: "run-1",
          status: "started"
        }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const result = await client.runAgentTurn({
    agentId: "agent-1",
    sessionId: "session-1",
    message: "hello",
    timeoutSeconds: 1
  });

  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "chat.send", "agent.wait", "agent.wait"]);
  assert.deepEqual(sentFrames[2]?.params, {
    runId: "run-1",
    timeoutMs: 1000
  });
  assert.deepEqual(sentFrames[3]?.params, {
    runId: "run-1",
    sessionKey: "agent:agent-1:explicit:session-1",
    sessionId: "session-1",
    timeoutMs: 1000
  });
  assert.equal(result.status, "completed");
  assert.equal(result.payloads?.[0]?.text, "Done");
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client returns Gateway wait timeout payloads", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? {
              protocol: 4,
              features: {
                methods: ["chat.send", "agent.wait"]
              }
            }
          : frame.method === "agent.wait"
            ? {
                runId: "run-1",
                status: "timeout",
                timeoutPhase: "gateway_draining"
              }
            : {
                runId: "run-1",
                status: "started"
              }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const result = await client.runAgentTurn({
    agentId: "agent-1",
    message: "hello",
    timeoutSeconds: 1
  });

  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "chat.send", "agent.wait"]);
  assert.equal(result.status, "timeout");
  assert.equal((result as { timeoutPhase?: string }).timeoutPhase, "gateway_draining");
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client retries chat.send when the Gateway registry confirms the agent", async () => {
  const fallback = new FallbackGatewayClient();
  let chatAttempts = 0;
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      if (frame.method === "connect") {
        socket.emitMessage({
          type: "res",
          id: frame.id,
          ok: true,
          payload: { protocol: 4 }
        });
        return;
      }

      if (frame.method === "chat.send") {
        chatAttempts += 1;
        socket.emitMessage({
          type: "res",
          id: frame.id,
          ok: chatAttempts > 1,
          payload: chatAttempts > 1 ? { runId: "run-1", status: "running" } : undefined,
          error: chatAttempts === 1 ? { message: 'INVALID_REQUEST: agent "agent-1" not found' } : undefined
        });
        return;
      }

      if (frame.method === "agents.list") {
        socket.emitMessage({
          type: "res",
          id: frame.id,
          ok: true,
          payload: {
            agents: [
              {
                id: "agent-1",
                workspace: "/workspace"
              }
            ]
          }
        });
        return;
      }

      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: { ok: true }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const result = await client.runAgentTurn({ agentId: "agent-1", message: "hello", workspace: "/workspace" });

  assert.equal(result.runId, "run-1");
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "chat.send", "agents.list", "chat.send"]);
  assert.deepEqual(
    sentFrames.filter((frame) => frame.method === "chat.send").map((frame) => frame.params.sessionKey),
    ["agent:agent-1:main", "agent:agent-1:main"]
  );
  assert.equal(
    sentFrames.filter((frame) => frame.method === "chat.send").some((frame) => Object.hasOwn(frame.params, "agentId")),
    false
  );
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client sends task steering and context injection without CLI fallback", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect" ? { protocol: 4 } : { ok: true, method: frame.method }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const steerResult = await client.steerSession({ key: "agent:agent-1:main", message: "Focus on tests" });
  assert.deepEqual(steerResult, { ok: true, method: "chat.send" });
  assert.deepEqual(
    await client.injectChat({ sessionKey: "agent:agent-1:main", message: "Use this reference" }),
    { ok: true, method: "chat.inject" }
  );

  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "chat.send", "chat.inject"]);
  assert.deepEqual(sentFrames.find((frame) => frame.method === "chat.send")?.params, {
    sessionKey: "agent:agent-1:main",
    message: "Focus on tests",
    queueMode: "steer",
    idempotencyKey: sentFrames.find((frame) => frame.method === "chat.send")?.params.idempotencyKey
  });
  assert.equal(typeof sentFrames.find((frame) => frame.method === "chat.send")?.params.idempotencyKey, "string");
  assert.deepEqual(sentFrames.find((frame) => frame.method === "chat.inject")?.params, {
    sessionKey: "agent:agent-1:main",
    message: "Use this reference"
  });
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client omits workspace when falling back from chat.send to sessions.send", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: frame.method !== "chat.send",
        payload: frame.method === "connect"
          ? { protocol: 4 }
          : frame.method === "sessions.send"
            ? { runId: "run-1", status: "running" }
            : undefined,
        error: frame.method === "chat.send" ? { message: "INVALID_REQUEST: unknown method: chat.send" } : undefined
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await client.runAgentTurn({ agentId: "agent-1", message: "hello", workspace: "/workspace" });

  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "chat.send", "sessions.send"]);
  assert.equal(Object.hasOwn(sentFrames[1]?.params ?? {}, "workspace"), false);
  assert.equal(Object.hasOwn(sentFrames[2]?.params ?? {}, "workspace"), false);
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client creates explicit sessions without patching metadata before chat send", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? {
              protocol: 4,
              features: {
                methods: ["sessions.create", "sessions.patch", "chat.send"]
              }
            }
          : frame.method === "chat.send"
            ? { runId: "run-1", status: "running" }
            : { ok: true }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await client.runAgentTurn({
    agentId: "agent-1",
    sessionId: "session-1",
    message: "hello",
    workspace: "/workspace",
    dispatchId: "dispatch-1"
  });

  assert.deepEqual(sentFrames.map((frame) => frame.method), [
    "connect",
    "sessions.create",
    "chat.send"
  ]);
  assert.deepEqual(sentFrames[1]?.params, {
    key: "agent:agent-1:explicit:session-1",
    agentId: "agent-1"
  });
  assert.equal(sentFrames.some((frame) => frame.method === "sessions.patch"), false);
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client keeps direct chat moving when session creation params are rejected", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: frame.method !== "sessions.create",
        payload: frame.method === "connect"
          ? {
              protocol: 4,
              features: {
                methods: ["sessions.create", "sessions.patch", "chat.send"]
              }
            }
          : frame.method === "chat.send"
            ? { runId: "run-1", status: "running" }
            : { ok: true },
        error: frame.method === "sessions.create"
          ? {
              message:
                "INVALID_REQUEST: invalid sessions.create params: at root: unexpected property 'sessionKey'"
            }
          : undefined
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const result = await client.runAgentTurn({
    agentId: "agent-1",
    sessionId: "session-1",
    message: "hello",
    workspace: "/workspace"
  });

  assert.deepEqual(sentFrames.map((frame) => frame.method), [
    "connect",
    "sessions.create",
    "chat.send"
  ]);
  assert.equal(result.runId, "run-1");
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client keeps agent creation on the native lifecycle", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? {
              protocol: 4,
              features: {
                methods: ["agents.list", "agents.create", "agents.delete"]
              }
            }
          : { ok: true }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await client.addAgent({ id: "agent-1", workspace: "/workspace", agentDir: "/agent" });

  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "agents.create"]);
  assert.deepEqual(sentFrames[1]?.params, { name: "agent-1", workspace: "/workspace" });
  assert.deepEqual(fallback.calls, []);
  assert.deepEqual(getRecentOpenClawGatewayFallbackDiagnostics(), []);
});

test("native agent creation refreshes its connection after disconnect", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? {
              protocol: 4,
              server: { connId: "connection-1" },
              auth: { role: "operator", scopes: ["operator.admin"] }
            }
          : { ok: true }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  client.close("identity freshness test");
  await client.addAgent({ id: "agent-2", workspace: "/workspace", agentDir: "/agent-2" });
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client uses agents.update when supported", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect" ? { protocol: 4 } : { ok: true, agentId: "agent-1" }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await client.updateAgent({ id: "agent-1", name: "Agent One", workspace: "/workspace", model: "openai/test" });

  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "agents.update"]);
  assert.deepEqual(sentFrames[1]?.params, {
    agentId: "agent-1",
    name: "Agent One",
    workspace: "/workspace",
    model: "openai/test"
  });
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client attempts an omitted mutation without inventing a fallback", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? {
              protocol: 4,
              features: {
                methods: ["agents.list", "agents.create", "agents.delete"]
              }
            }
          : { ok: true }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await client.updateAgent({ id: "agent-1", name: "Agent One", workspace: "/workspace", model: "openai/test" });

  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "agents.update"]);
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client sets agent identity through Gateway before CLI fallback", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect" ? { protocol: 4 } : { ok: true, agentId: "agent-1" }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await client.setAgentIdentity({
    agentId: "agent-1",
    workspace: "/workspace",
    identityFile: "/workspace/.openclaw/agents/agent-1/agent/IDENTITY.md",
    name: "Agent One",
    emoji: "A"
  });

  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "agents.identity.set"]);
  assert.deepEqual(sentFrames[1]?.params, {
    agentId: "agent-1",
    agent: "agent-1",
    workspace: "/workspace",
    identityFile: "/workspace/.openclaw/agents/agent-1/agent/IDENTITY.md",
    name: "Agent One",
    emoji: "A"
  });
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client provisions automations through Gateway before CLI fallback", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect" ? { protocol: 4 } : { ok: true, automationId: "digest" }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await client.provisionAutomation({
    name: "Digest",
    description: "Daily digest",
    agentId: "agent-1",
    message: "Summarize updates",
    thinking: "medium",
    timeoutSeconds: 120,
    declarationKey: "agentos:test:digest",
    schedule: { kind: "every", value: "1d" },
    announce: { channel: "telegram", target: "team" }
  });

  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "cron.add"]);
  assert.deepEqual(sentFrames[1]?.params, {
    name: "Digest",
    description: "Daily digest",
    declarationKey: "agentos:test:digest",
    agentId: "agent-1",
    enabled: true,
    schedule: { kind: "every", everyMs: 86_400_000 },
    sessionTarget: "isolated",
    wakeMode: "now",
    payload: { kind: "agentTurn", message: "Summarize updates", thinking: "medium", timeoutSeconds: 120 },
    delivery: { mode: "announce", channel: "telegram", to: "team" },
    deleteAfterRun: false
  });
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client exposes optional Gateway support methods", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 4 }
          : frame.method === "logs.tail"
            ? { lines: ["log"] }
            : frame.method === "exec.approval.list"
              ? { approvals: [{ id: "approval-1" }] }
              : frame.method === "exec.approval.resolve"
                ? { ok: true, approvalId: "approval-1" }
                : frame.method === "cron.status"
                  ? { enabled: true }
                  : frame.method === "cron.list"
                    ? { jobs: [{ id: "job-1" }] }
                    : { ok: true }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(await client.tailLogs({ limit: 1 }), { lines: ["log"] });
  assert.deepEqual(await client.listExecApprovals({ status: "pending" }), { approvals: [{ id: "approval-1" }] });
  assert.deepEqual(await client.resolveExecApproval({ approvalId: "approval-1", decision: "allow" }), {
    ok: true,
    approvalId: "approval-1"
  });
  assert.deepEqual(await client.getCronStatus(), { enabled: true });
  assert.deepEqual(await client.listCronJobs({ includeDisabled: true }), { jobs: [{ id: "job-1" }] });
  assert.deepEqual(sentFrames.map((frame) => frame.method), [
    "connect",
    "logs.tail",
    "exec.approval.list",
    "exec.approval.resolve",
    "cron.status",
    "cron.list"
  ]);
  assert.deepEqual(fallback.calls, []);
});

test("native Human Control reads preserve exact 9.1 array approval responses and never fall back", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 4 }
          : frame.method === "exec.approval.list" || frame.method === "plugin.approval.list"
            ? [{ id: "approval-1", request: { commandPreview: "echo safe" } }]
            : frame.method === "question.list"
              ? { questions: [] }
              : frame.method.endsWith(".resolve")
                ? { ok: true }
                : { ok: true }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({ fallback, transport, url: "ws://127.0.0.1:18789", timeoutMs: 250 });

  assert.deepEqual(await client.listNativeExecApprovals({ status: "pending" }), { approvals: [{ id: "approval-1", request: { commandPreview: "echo safe" } }] });
  assert.deepEqual(await client.listNativePluginApprovals(), { approvals: [{ id: "approval-1", request: { commandPreview: "echo safe" } }] });
  assert.deepEqual(await client.listQuestions(), { questions: [] });
  await client.resolveNativeExecApproval({ approvalId: "approval-1", decision: "allow-once" });
  await client.resolveNativePluginApproval({ approvalId: "approval-1", decision: "deny" });
  assert.deepEqual(sentFrames.filter((frame) => frame.method !== "connect").map((frame) => [frame.method, frame.params]), [
    ["exec.approval.list", { status: "pending" }],
    ["plugin.approval.list", {}],
    ["question.list", {}],
    ["exec.approval.resolve", { id: "approval-1", decision: "allow-once" }],
    ["plugin.approval.resolve", { id: "approval-1", decision: "deny" }]
  ]);
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client exposes OpenClaw 2026.6.8 Gateway surfaces without CLI fallback", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 4 }
          : frame.method === "artifacts.download"
            ? { artifactId: "artifact-1", content: "payload" }
            : frame.method === "commands.list"
              ? { commands: [{ name: "agent" }] }
              : frame.method === "usage.status"
                ? { enabled: true }
                : frame.method === "doctor.memory.status"
                  ? { ok: true }
                  : frame.method === "agents.files.list"
                    ? { files: [{ path: "AGENTS.md" }] }
                    : frame.method === "environments.list"
                      ? { environments: [] }
                      : frame.method === "talk.catalog"
                        ? { providers: [] }
                        : frame.method === "tts.status"
                          ? { enabled: false }
                          : frame.method === "node.list"
                            ? { nodes: [] }
                            : { ok: true }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(await client.downloadArtifact({ artifactId: "artifact-1" }), {
    artifactId: "artifact-1",
    content: "payload"
  });
  assert.deepEqual(await client.listCommands(), { commands: [{ name: "agent" }] });
  assert.deepEqual(await client.getUsageStatus(), { enabled: true });
  assert.deepEqual(await client.getMemoryDoctorStatus(), { ok: true });
  assert.deepEqual(await client.listAgentFiles({ agentId: "agent-1" }), { files: [{ path: "AGENTS.md" }] });
  assert.deepEqual(await client.listEnvironments(), { environments: [] });
  assert.deepEqual(await client.getTalkCatalog(), { providers: [] });
  assert.deepEqual(await client.getTtsStatus(), { enabled: false });
  assert.deepEqual(await client.listNodes(), { nodes: [] });

  assert.deepEqual(sentFrames.map((frame) => frame.method), [
    "connect",
    "artifacts.download",
    "commands.list",
    "usage.status",
    "doctor.memory.status",
    "agents.files.list",
    "environments.list",
    "talk.catalog",
    "tts.status",
    "node.list"
  ]);
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client exposes Phase 2 runtime Gateway methods", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? {
              protocol: 4,
              features: {
                methods: [
                  "sessions.describe",
                  "sessions.get",
                  "sessions.list",
                  "chat.history",
                  "tasks.list",
                  "tasks.get",
                  "tasks.cancel",
                  "artifacts.list",
                  "artifacts.get",
                  "artifacts.download",
                  "tools.catalog",
                  "tools.effective",
                  "tools.invoke"
                ]
              }
            }
          : frame.method === "sessions.describe"
            ? { session: { id: "session-1" } }
            : frame.method === "chat.history"
              ? { messages: [{ text: "hello" }] }
              : frame.method === "sessions.get"
                ? { format: "json", content: "{}" }
                : frame.method === "sessions.list"
                  ? { sessions: [{ key: "agent:agent-1:main" }] }
                  : frame.method === "tasks.list"
                    ? { tasks: [{ id: "task-1" }] }
                    : frame.method === "tasks.get"
                      ? { task: { id: "task-1" } }
                      : frame.method === "artifacts.list"
                        ? { artifacts: [{ id: "artifact-1" }] }
                        : frame.method === "tools.catalog"
                          ? { agentId: "agent-1", profiles: [], groups: [] }
                          : frame.method === "tools.effective"
                            ? { agentId: "agent-1", profile: "full", groups: [] }
                            : frame.method === "tools.invoke"
                              ? { ok: true, toolName: "shell" }
                              : { ok: true }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(await client.describeSession({ key: "agent:agent-1:main" }), { session: { id: "session-1" } });
  assert.deepEqual(await client.getSessionHistory({ key: "agent:agent-1:main", limit: 5 }), {
    messages: [{ text: "hello" }]
  });
  assert.deepEqual(await client.exportSession({ key: "agent:agent-1:main", format: "json" }), {
    format: "json",
    content: "{}"
  });
  assert.deepEqual(await client.listTasks({ agentId: "agent-1" }), { tasks: [{ id: "task-1" }] });
  assert.deepEqual(await client.getTask({ taskId: "task-1" }), { task: { id: "task-1" } });
  assert.deepEqual(await client.cancelTask({ taskId: "task-1", reason: "duplicate" }), { ok: true });
  assert.deepEqual(
    await client.listArtifacts({ taskId: "task-1", agentId: "agent-1", workspace: "/tmp/workspace", limit: 100 }),
    { artifacts: [{ id: "artifact-1" }] }
  );
  assert.deepEqual(await client.getArtifact({ artifactId: "artifact-1", includeContent: true }), { ok: true });
  assert.deepEqual(await client.getRuntimeSnapshot({ includeTasks: true }), {
    sessions: [{ key: "agent:agent-1:main" }],
    tasks: [{ id: "task-1" }],
    artifacts: []
  });
  assert.deepEqual(await client.getToolsCatalog({ agentId: "agent-1", includePlugins: true }), {
    agentId: "agent-1",
    profiles: [],
    groups: []
  });
  assert.deepEqual(await client.getEffectiveTools({ agentId: "agent-1", sessionKey: "agent:agent-1:main" }), {
    agentId: "agent-1",
    profile: "full",
    groups: []
  });
  assert.deepEqual(await client.invokeTool({ name: "shell", args: { command: "pwd" } }), {
    ok: true,
    toolName: "shell"
  });

  assert.deepEqual(sentFrames.map((frame) => frame.method), [
    "connect",
    "sessions.describe",
    "chat.history",
    "sessions.get",
    "tasks.list",
    "tasks.get",
    "tasks.cancel",
    "artifacts.list",
    "artifacts.get",
    "sessions.list",
    "tasks.list",
    "tools.catalog",
    "tools.effective",
    "tools.invoke"
  ]);
  assert.deepEqual(sentFrames[1]?.params, {
    key: "agent:agent-1:main"
  });
  assert.deepEqual(sentFrames[7]?.params, {
    taskId: "task-1"
  });
  assert.deepEqual(sentFrames[13]?.params, {
    name: "shell",
    args: { command: "pwd" }
  });
  assert.deepEqual(sentFrames[11]?.params, {
    agentId: "agent-1",
    includePlugins: true
  });
  assert.deepEqual(sentFrames[12]?.params, {
    agentId: "agent-1",
    sessionKey: "agent:agent-1:main"
  });
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client attempts omitted stable tool methods natively", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 4, features: { methods: ["health"] } }
          : { ok: true }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const result = await client.getToolsCatalog({ agentId: "agent-1" });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "tools.catalog"]);
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client uses the exact Skills Library read and activation contract", async () => {
  const fallback = new FallbackGatewayClient();
  const skill = {
    skillId: "11111111-1111-4111-8111-111111111111",
    slug: "lead-qualification",
    name: "Lead Qualification",
    description: "Qualify leads.",
    ownerProfileId: "profile-1",
    ownerLabel: "Operator",
    authorProfileId: "profile-1",
    shared: false,
    enabled: true,
    removed: false,
    revision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    createdAt: 1756684800000,
    updatedAt: 1756857600000,
    canEdit: true
  };
  const selection = {
    skillId: skill.skillId,
    revision: skill.revision,
    name: skill.name,
    ownerProfileId: skill.ownerProfileId,
    slug: skill.slug,
    description: skill.description,
    ownerLabel: skill.ownerLabel
  };
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 4, features: { methods: ["skills.library.list", "skills.library.read", "skills.library.activate"] } }
          : frame.method === "skills.library.list"
            ? {
                entries: [skill],
                profileId: "profile-1",
                multipleProfiles: false,
                defaultTarget: "personal",
                canManageWorkspace: false,
                defaultSelectionLimit: 64,
                session: {
                  sessionKey: "agent:worker:main",
                  selections: [selection],
                  attachable: [skill]
                }
              }
            : frame.method === "skills.library.read"
              ? {
                  entry: skill,
                  content: "# Lead Qualification",
                  files: [{ path: "SKILL.md", content: "IyBMRUFEX1FVQUxJRklDQVRJT04=", encoding: "base64", executable: false }],
                  revisions: [{ revision: skill.revision, createdAt: skill.createdAt }]
                }
              : {
                  sessionKey: "agent:worker:main",
                  selections: [selection],
                  sessionActivation: "next-turn"
                }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.equal((await client.listSkillLibrary({ scope: "all", sessionKey: "agent:worker:main" })).entries[0]?.revision, skill.revision);
  assert.equal((await client.readSkillLibrary({ skillId: skill.skillId, revision: skill.revision, sessionKey: "agent:worker:main" })).revisions[0]?.revision, skill.revision);
  assert.equal((await client.activateSkillLibrary({ sessionKey: "agent:worker:main", action: "attach", skillId: skill.skillId, revision: skill.revision })).sessionActivation, "next-turn");
  assert.deepEqual(sentFrames.map((frame) => frame.method), [
    "connect",
    "skills.library.list",
    "skills.library.read",
    "skills.library.activate"
  ]);
  assert.deepEqual(sentFrames[1]?.params, { scope: "all", sessionKey: "agent:worker:main" });
  assert.deepEqual(sentFrames[2]?.params, { skillId: skill.skillId, revision: skill.revision, sessionKey: "agent:worker:main" });
  assert.deepEqual(sentFrames[3]?.params, { sessionKey: "agent:worker:main", action: "attach", skillId: skill.skillId, revision: skill.revision });
  assert.deepEqual(fallback.calls, []);
});

test("Skills Library activation does not retry an ambiguous sent mutation", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    if (frame.method === "connect") {
      globalThis.queueMicrotask(() => {
        socket.emitMessage({ type: "res", id: frame.id, ok: true, payload: { protocol: 4 } });
      });
    }
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 20
  });

  await assert.rejects(
    () => client.activateSkillLibrary({
      sessionKey: "agent:worker:main",
      action: "attach",
      skillId: "11111111-1111-4111-8111-111111111111",
      revision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }),
    /timed out after/
  );
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "skills.library.activate"]);
  assert.deepEqual(fallback.calls, []);
});

test("Skills Library methods fail closed when the client is CLI-forced", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport } = createFakeGatewayTransport(() => {});
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    forceCli: true,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await assert.rejects(client.listSkillLibrary(), /CLI fallback is disabled/);
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client queries chat history with sessionKey for explicit agent sessions", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? {
              protocol: 4,
              features: {
                methods: ["chat.history"]
              }
            }
          : { messages: [{ role: "assistant", text: "history reply" }] }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(await client.getSessionHistory({ agentId: "agent-1", sessionId: "session-1", limit: 40 }), {
    messages: [{ role: "assistant", text: "history reply" }]
  });

  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "chat.history"]);
  assert.deepEqual(sentFrames[1]?.params, {
    sessionKey: "agent:agent-1:explicit:session-1",
    limit: 40
  });
  assert.equal(Object.hasOwn(sentFrames[1]?.params ?? {}, "agentId"), false);
  assert.equal(Object.hasOwn(sentFrames[1]?.params ?? {}, "sessionId"), false);
  assert.deepEqual(fallback.calls, []);
});

test("native WS runtime snapshot only queries artifacts with an explicit Gateway scope", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? {
              protocol: 4,
              features: {
                methods: ["sessions.list", "tasks.list", "artifacts.list"]
              }
            }
          : frame.method === "artifacts.list"
            ? { artifacts: [{ id: "artifact-1", taskId: "task-1" }] }
            : { sessions: [], tasks: [] }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(
    await client.getRuntimeSnapshot({
      includeSessions: false,
      includeTasks: false,
      includeArtifacts: true,
      taskId: "task-1",
      agentId: "agent-1",
      workspace: "/tmp/workspace",
      limit: 500
    }),
    {
      sessions: [],
      tasks: [],
      artifacts: [{ id: "artifact-1", taskId: "task-1" }]
    }
  );

  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "artifacts.list"]);
  assert.deepEqual(sentFrames[1]?.params, { taskId: "task-1" });
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client receives canonical task events without a task RPC", async () => {
  const fallback = new FallbackGatewayClient();
  const events: unknown[] = [];
  const { transport, sentFrames, sockets } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? {
              protocol: 4,
              features: {
                methods: [],
                events: ["task"]
              }
            }
          : { ok: true }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const subscription = await client.subscribeRuntimeEvents(
    { includeSessions: false, includeTasks: true, taskIds: ["task-1"] },
    {
      onEvent: (event) => {
        events.push(event);
      }
    },
    { timeoutMs: 250 }
  );
  sockets[0]?.emitMessage({
    type: "event",
    event: "task",
    payload: {
      action: "upserted",
      task: { id: "task-1", taskId: "task-1", status: "running" }
    }
  });

  await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
  subscription.close();

  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect"]);
  assert.deepEqual(events, [{
    type: "event",
    event: "task",
    payload: {
      action: "upserted",
      task: { id: "task-1", taskId: "task-1", status: "running" }
    }
  }]);
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client streams agent turns through chat.send and session events", async () => {
  const fallback = new FallbackGatewayClient();
  const stdout: string[] = [];
  let subscriptionSocket: { emitMessage: (frame: Record<string, unknown>) => void } | null = null;
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? {
              protocol: 4,
              features: {
                methods: ["chat.send", "sessions.subscribe", "sessions.messages.subscribe"],
                events: ["session.message"]
              }
            }
          : { ok: true, runId: "run-1", status: "running" }
      });

      if (frame.method === "sessions.messages.subscribe") {
        subscriptionSocket = socket;
      }

      if (frame.method === "chat.send") {
        subscriptionSocket?.emitMessage({
          type: "event",
          event: "session.message",
          payload: {
            sessionKey: "agent:agent-1:explicit:session-1",
            runId: "run-1",
            status: "running",
            message: {
              role: "user",
              text: "You are chatting directly with the operator inside AgentOS."
            }
          }
        });
        subscriptionSocket?.emitMessage({
          type: "event",
          event: "session.message",
          payload: {
            sessionKey: "agent:agent-1:explicit:session-1",
            runId: "run-1",
            status: "completed",
            message: { text: "Done from Gateway" }
          }
        });
      }
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const result = await client.streamAgentTurn(
    { agentId: "agent-1", sessionId: "session-1", message: "hello", timeoutSeconds: 1 },
    {
      onStdout: (text) => {
        stdout.push(text);
      }
    }
  );

  assert.deepEqual(sentFrames.map((frame) => frame.method), [
    "connect",
    "sessions.subscribe",
    "sessions.messages.subscribe",
    "chat.send"
  ]);
  assert.equal(result.runId, "run-1");
  assert.equal(result.status, "completed");
  assert.equal(result.payloads?.[0]?.text, "Done from Gateway");
  assert.match(stdout.join(""), /Done from Gateway/);
  assert.doesNotMatch(stdout.join(""), /You are chatting directly with the operator/);
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client reads assistant text from Gateway message content arrays", async () => {
  const fallback = new FallbackGatewayClient();
  let subscriptionSocket: { emitMessage: (frame: Record<string, unknown>) => void } | null = null;
  const { transport } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? {
              protocol: 4,
              features: {
                methods: ["chat.send", "sessions.subscribe", "sessions.messages.subscribe"],
                events: ["session.message"]
              }
            }
          : { ok: true, runId: "run-1", status: "running" }
      });

      if (frame.method === "sessions.messages.subscribe") {
        subscriptionSocket = socket;
      }

      if (frame.method === "chat.send") {
        subscriptionSocket?.emitMessage({
          type: "event",
          event: "session.message",
          payload: {
            sessionKey: "agent:agent-1:explicit:session-1",
            runId: "run-1",
            status: "completed",
            message: {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: "Done from content array"
                }
              ]
            }
          }
        });
      }
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const result = await client.streamAgentTurn(
    { agentId: "agent-1", sessionId: "session-1", message: "hello", timeoutSeconds: 1 }
  );

  assert.equal(result.status, "completed");
  assert.equal(result.payloads?.[0]?.text, "Done from content array");
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client does not synthesize final text for empty stream completion events", async () => {
  const fallback = new FallbackGatewayClient();
  const stdout: string[] = [];
  let subscriptionSocket: { emitMessage: (frame: Record<string, unknown>) => void } | null = null;
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? {
              protocol: 4,
              features: {
                methods: ["chat.send", "sessions.subscribe", "sessions.messages.subscribe"],
                events: ["session.message"]
              }
            }
          : { runId: "run-1", status: "running" }
      });

      if (frame.method === "sessions.messages.subscribe") {
        subscriptionSocket = socket;
      }

      if (frame.method === "chat.send") {
        subscriptionSocket?.emitMessage({
          type: "event",
          event: "session.message",
          payload: {
            sessionKey: "agent:agent-1:explicit:session-1",
            runId: "run-1",
            status: "completed"
          }
        });
      }
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const result = await client.streamAgentTurn(
    { agentId: "agent-1", sessionId: "session-1", message: "hello" },
    {
      onStdout: (text) => {
        stdout.push(text);
      }
    },
    { timeoutMs: 25 }
  );

  assert.deepEqual(sentFrames.map((frame) => frame.method), [
    "connect",
    "sessions.subscribe",
    "sessions.messages.subscribe",
    "chat.send"
  ]);
  assert.equal(result.runId, "run-1");
  assert.equal(result.status, "running");
  assert.equal(result.summary, undefined);
  assert.deepEqual(stdout, []);
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client explains failed chat stream events without assistant text", async () => {
  const fallback = new FallbackGatewayClient();
  let subscriptionSocket: { emitMessage: (frame: Record<string, unknown>) => void } | null = null;
  const { transport } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? {
              protocol: 4,
              features: {
                methods: ["chat.send", "sessions.subscribe", "sessions.messages.subscribe"],
                events: ["session.message"]
              }
            }
          : { runId: "run-1", status: "running" }
      });

      if (frame.method === "sessions.messages.subscribe") {
        subscriptionSocket = socket;
      }

      if (frame.method === "chat.send") {
        subscriptionSocket?.emitMessage({
          type: "event",
          event: "session.message",
          payload: {
            sessionKey: "agent:agent-1:explicit:session-1",
            runId: "run-1",
            status: "failed",
            error: {
              message: "model provider disconnected before final response"
            }
          }
        });
      }
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const result = await client.streamAgentTurn(
    { agentId: "agent-1", sessionId: "session-1", message: "hello" },
    {},
    { timeoutMs: 25 }
  );

  assert.equal(result.status, "stalled");
  assert.equal(
    result.summary,
    "OpenClaw Gateway ended the chat stream without assistant text: model provider disconnected before final response"
  );
  assert.deepEqual(result.payloads, []);
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client suppresses lifecycle stop reasons for empty chat streams", async () => {
  const fallback = new FallbackGatewayClient();
  let subscriptionSocket: { emitMessage: (frame: Record<string, unknown>) => void } | null = null;
  const { transport } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? {
              protocol: 4,
              features: {
                methods: ["chat.send", "sessions.subscribe", "sessions.messages.subscribe"],
                events: ["session.message"]
              }
            }
          : { runId: "run-1", status: "running" }
      });

      if (frame.method === "sessions.messages.subscribe") {
        subscriptionSocket = socket;
      }

      if (frame.method === "chat.send") {
        subscriptionSocket?.emitMessage({
          type: "event",
          event: "session.message",
          payload: {
            sessionKey: "agent:agent-1:explicit:session-1",
            runId: "run-1",
            status: "failed",
            stopReason: "create"
          }
        });
      }
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const result = await client.streamAgentTurn(
    { agentId: "agent-1", sessionId: "session-1", message: "hello" },
    {},
    { timeoutMs: 25 }
  );

  assert.equal(result.status, "stalled");
  assert.equal(result.summary, "OpenClaw Gateway reported the chat stream failed before assistant text was available.");
  assert.deepEqual(result.payloads, []);
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client resolves stream completion through agent.wait when events have no final text", async () => {
  const fallback = new FallbackGatewayClient();
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? {
              protocol: 4,
              features: {
                methods: ["chat.send", "sessions.subscribe", "sessions.messages.subscribe", "agent.wait"],
                events: ["session.message"]
              }
            }
          : frame.method === "agent.wait"
            ? {
                runId: "run-1",
                status: "completed",
                summary: "Done from wait",
                payloads: [{ text: "Done from wait", mediaUrl: null }]
              }
            : { runId: "run-1", status: "running" }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const result = await client.streamAgentTurn(
    { agentId: "agent-1", sessionId: "session-1", message: "hello" },
    {},
    { timeoutMs: 25 }
  );

  assert.deepEqual(sentFrames.map((frame) => frame.method), [
    "connect",
    "sessions.subscribe",
    "sessions.messages.subscribe",
    "chat.send",
    "agent.wait"
  ]);
  assert.equal(sentFrames[4]?.params.runId, "run-1");
  assert.equal(result.status, "completed");
  assert.equal(result.payloads?.[0]?.text, "Done from wait");
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client subscribes to Gateway session events without legacy events.subscribe", async () => {
  const fallback = new FallbackGatewayClient();
  const events: string[] = [];
  const { transport, sentFrames } = createFakeGatewayTransport((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect" ? { protocol: 4 } : { subscribed: true }
      });
      if (frame.method === "sessions.subscribe") {
        socket.emitMessage({
          type: "event",
          event: "sessions.changed",
          payload: { key: "agent:main:main" }
        });
      }
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const subscription = await client.subscribeNativeEvents(
    { subscribeSessions: true },
    {
      onEvent: (frame) => {
        if (frame.event) {
          events.push(frame.event);
        }
      }
    }
  );
  subscription.close();

  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "sessions.subscribe"]);
  assert.deepEqual(events, ["sessions.changed"]);
});
