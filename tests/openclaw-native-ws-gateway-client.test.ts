import assert from "node:assert/strict";
import { test } from "node:test";

import {
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

  async getStatus() {
    return {};
  }

  async getGatewayStatus() {
    return {};
  }

  async getModelStatus() {
    return {};
  }

  async listSkills() {
    return { skills: [] };
  }

  async listPlugins() {
    return { plugins: [] };
  }

  async listModels() {
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

  async getConfig() {
    return null;
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
