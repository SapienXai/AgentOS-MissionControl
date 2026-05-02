import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clearOpenClawGatewayFallbackDiagnosticsForTesting,
  getRecentOpenClawGatewayFallbackDiagnostics,
  NativeWsOpenClawGatewayClient,
  type WebSocketFactory
} from "@/lib/openclaw/client/native-ws-gateway-client";
import type {
  OpenClawCommandOptions,
  OpenClawGatewayClient
} from "@/lib/openclaw/client/gateway-client";

type SentFrame = {
  type: string;
  id: string;
  method: string;
  params: Record<string, unknown>;
};

class FallbackGatewayClient implements OpenClawGatewayClient {
  calls: Array<{ method: string; params?: Record<string, unknown>; options?: OpenClawCommandOptions }> = [];
  config = new Map<string, unknown>();
  failStatus = false;

  async getStatus() {
    this.calls.push({ method: "getStatus" });
    if (this.failStatus) {
      throw new Error("CLI status failed");
    }
    return {};
  }

  async getGatewayStatus() {
    this.calls.push({ method: "getGatewayStatus" });
    return {};
  }

  async getModelStatus() {
    this.calls.push({ method: "getModelStatus" });
    return {};
  }

  async listAgents() {
    this.calls.push({ method: "listAgents" });
    return { agents: [] };
  }

  async listSessions() {
    this.calls.push({ method: "listSessions" });
    return { sessions: [] };
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
    return { models: [] };
  }

  async scanModels() {
    return [];
  }

  async probeGateway() {
    return {};
  }

  async controlGateway() {
    return {};
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
    return (this.config.has(path) ? this.config.get(path) : null) as TPayload | null;
  }

  async hasConfig() {
    return false;
  }

  async setConfig() {
    return { stdout: "", stderr: "", code: 0 };
  }

  async unsetConfig() {
    return { stdout: "", stderr: "", code: 0 };
  }

  async addAgent() {
    return { stdout: "", stderr: "", code: 0 };
  }

  async deleteAgent() {
    return { stdout: "", stderr: "", code: 0 };
  }

  async runAgentTurn() {
    return {};
  }

  async streamAgentTurn() {
    return {};
  }
}

function createFakeWebSocket(
  respond: (socket: {
    emitMessage: (frame: Record<string, unknown>) => void;
    emitRaw: (data: string) => void;
    close: () => void;
  }, frame: SentFrame) => void
) {
  const sentFrames: SentFrame[] = [];

  class FakeWebSocket {
    readyState = 0;
    private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

    constructor(readonly url: string) {
      globalThis.queueMicrotask(() => {
        this.readyState = 1;
        this.emit("open", {});
      });
    }

    addEventListener(type: string, listener: (event: unknown) => void) {
      const listeners = this.listeners.get(type) ?? new Set();
      listeners.add(listener);
      this.listeners.set(type, listeners);
    }

    removeEventListener(type: string, listener: (event: unknown) => void) {
      this.listeners.get(type)?.delete(listener);
    }

    send(data: string) {
      const frame = JSON.parse(data) as SentFrame;
      sentFrames.push(frame);
      respond(
        {
          emitMessage: (response) => this.emit("message", { data: JSON.stringify(response) }),
          emitRaw: (response) => this.emit("message", { data: response }),
          close: () => this.close()
        },
        frame
      );
    }

    close() {
      this.readyState = 3;
      this.emit("close", { code: 1000, reason: "closed" });
    }

    private emit(type: string, event: unknown) {
      for (const listener of this.listeners.get(type) ?? []) {
        listener(event);
      }
    }
  }

  return {
    WebSocketImpl: FakeWebSocket as unknown as WebSocketFactory,
    sentFrames
  };
}

test("native WS gateway client handshakes and correlates request responses", async () => {
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 3 }
          : { ok: true, method: frame.method, params: frame.params }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
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

test("native WS gateway client uses Gateway first for typed status requests", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 3 }
          : { version: "9.9.9", ignored: true }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(await client.getStatus(), { version: "9.9.9", ignored: true });
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "status"]);
  assert.deepEqual(sentFrames[0]?.params.client, {
    id: "cli",
    version: "agentos",
    platform: process.platform,
    mode: "cli"
  });
  assert.deepEqual(sentFrames[0]?.params.scopes, [
    "operator.admin",
    "operator.read",
    "operator.write",
    "operator.approvals",
    "operator.pairing"
  ]);
  assert.deepEqual(fallback.calls, []);
  assert.deepEqual(getRecentOpenClawGatewayFallbackDiagnostics(), []);
});

test("native WS gateway client discovers configured Gateway auth for handshakes", async () => {
  const fallback = new FallbackGatewayClient();
  fallback.config.set("gateway.remote.token", "remote-token");
  fallback.config.set("gateway.auth.token", "local-token");
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect" ? { protocol: 3 } : { version: "9.9.9" }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await client.getStatus();

  assert.deepEqual(sentFrames[0]?.params.auth, {
    token: "local-token"
  });
});

test("native WS gateway client prefers remote auth for remote Gateway URLs", async () => {
  const fallback = new FallbackGatewayClient();
  fallback.config.set("gateway.remote.token", "remote-token");
  fallback.config.set("gateway.auth.token", "local-token");
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect" ? { protocol: 3 } : { version: "9.9.9" }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "wss://gateway.example.test",
    timeoutMs: 250
  });

  await client.getStatus();

  assert.deepEqual(sentFrames[0]?.params.auth, {
    token: "remote-token"
  });
});

test("native WS gateway client does not send redacted OpenClaw secrets", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  fallback.config.set("gateway.auth.token", "__OPENCLAW_REDACTED__");
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: { protocol: 3 }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(await client.getStatus(), {});
  assert.equal(sentFrames.length, 0);
  assert.match(getRecentOpenClawGatewayFallbackDiagnostics()[0]?.issue, /redacted secret/);
});

test("native WS gateway client falls back when Gateway typed response is malformed", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 3 }
          : { models: [{ name: "missing-key" }] }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(await client.listModels(), { models: [] });
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "models.list"]);
  assert.deepEqual(fallback.calls.map((call) => call.method), ["listModels"]);
  assert.match(getRecentOpenClawGatewayFallbackDiagnostics()[0].issue, /malformed response/);
});

test("native WS gateway client clears operation fallback diagnostics after Gateway recovery", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  let malformed = true;
  const { WebSocketImpl } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 3 }
          : malformed
            ? { models: [{ name: "missing-key" }] }
            : { models: [{ key: "ok", name: "OK", input: "text" }] }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(await client.listModels(), { models: [] });
  assert.equal(getRecentOpenClawGatewayFallbackDiagnostics()[0]?.operation, "models.list");

  malformed = false;
  assert.deepEqual(await client.listModels(), {
    models: [{
      key: "ok",
      name: "OK",
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
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 3 }
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
    webSocketFactory: WebSocketImpl,
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
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 3 }
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
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.equal(await client.getConfig("gateway.remote.url"), "ws://127.0.0.1:18789");
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "config.get"]);
  assert.deepEqual(sentFrames[1]?.params, {});
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client uses Gateway first for session list", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 3 }
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
    webSocketFactory: WebSocketImpl,
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

test("native WS gateway client mutates config through Gateway snapshots", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 3 }
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
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const result = await client.setConfig("gateway.remote.url", "ws://127.0.0.1:18789");

  assert.match(result.stdout, /"ok":true/);
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "config.get", "connect", "config.set"]);
  assert.deepEqual(sentFrames[3]?.params, {
    raw: JSON.stringify({ gateway: { remote: { url: "ws://127.0.0.1:18789" } } }),
    baseHash: "hash-1"
  });
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client surfaces CLI fallback failures after Gateway failure", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  fallback.failStatus = true;
  const { WebSocketImpl } = createFakeWebSocket((socket, frame) => {
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
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await assert.rejects(() => client.getStatus(), /CLI status failed/);
  const [diagnostic] = getRecentOpenClawGatewayFallbackDiagnostics();
  assert.equal(diagnostic.operation, "status");
  assert.equal(diagnostic.kind, "scope-limited");
});

test("native WS gateway client falls back to CLI client when handshake fails", async () => {
  const fallback = new FallbackGatewayClient();
  const failures: string[] = [];
  const { WebSocketImpl } = createFakeWebSocket((socket, frame) => {
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
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250,
    onNativeFailure: (error) => failures.push(error instanceof Error ? error.message : String(error))
  });

  const result = await client.call<{ fallback: boolean; method: string }>("health", { probe: true });

  assert.deepEqual(result, { fallback: true, method: "health", params: { probe: true } });
  assert.equal(fallback.calls.length, 1);
  assert.match(failures[0], /auth failed/);
});

test("native WS gateway client falls back to CLI client on timeout", async () => {
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl } = createFakeWebSocket(() => {});
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 20
  });

  const result = await client.call<{ fallback: boolean; method: string }>("health", { probe: true });

  assert.deepEqual(result, { fallback: true, method: "health", params: { probe: true } });
  assert.equal(fallback.calls.length, 1);
});
