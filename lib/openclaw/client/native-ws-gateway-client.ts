import "server-only";

import { CliOpenClawGatewayClient } from "@/lib/openclaw/client/cli-gateway-client";
import type {
  OpenClawAddAgentInput,
  OpenClawAgentTurnInput,
  OpenClawCommandOptions,
  OpenClawGatewayClient,
  OpenClawListModelsInput,
  OpenClawStreamCallbacks,
} from "@/lib/openclaw/client/types";

const DEFAULT_GATEWAY_URL = "ws://127.0.0.1:18789";
const DEFAULT_NATIVE_TIMEOUT_MS = 3_000;
const CONNECT_METHOD = "connect";
const CONTROL_PROTOCOL_VERSION = 3;

type WebSocketLike = {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener?: (type: string, listener: (event: unknown) => void) => void;
  removeEventListener?: (type: string, listener: (event: unknown) => void) => void;
  onopen?: ((event: unknown) => void) | null;
  onmessage?: ((event: unknown) => void) | null;
  onerror?: ((event: unknown) => void) | null;
  onclose?: ((event: unknown) => void) | null;
};

export type WebSocketFactory = new (url: string) => WebSocketLike;

export type NativeWsOpenClawGatewayClientOptions = {
  url?: string | null;
  token?: string | null;
  password?: string | null;
  timeoutMs?: number;
  clientName?: string;
  clientVersion?: string;
  instanceId?: string;
  role?: string;
  scopes?: string[];
  fallback?: OpenClawGatewayClient;
  webSocketFactory?: WebSocketFactory;
  forceCli?: boolean;
  onNativeFailure?: (error: unknown, method: string) => void;
};

type GatewayResponseFrame = {
  type?: string;
  id?: string | number;
  ok?: boolean;
  payload?: unknown;
  error?: unknown;
  message?: string;
  code?: string;
};

class NativeGatewayError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message);
    this.name = "NativeGatewayError";
    this.cause = options.cause;
  }
}

function normalizeEnvFlag(value: string | undefined) {
  return value?.trim().toLowerCase();
}

export function isCliGatewayClientForcedByEnv() {
  const clientMode = normalizeEnvFlag(
    process.env.AGENTOS_OPENCLAW_GATEWAY_CLIENT ?? process.env.OPENCLAW_GATEWAY_CLIENT
  );
  const nativeFlag = normalizeEnvFlag(process.env.AGENTOS_OPENCLAW_NATIVE_WS);

  return clientMode === "cli" || nativeFlag === "0" || nativeFlag === "false" || nativeFlag === "off";
}

function resolveGatewayUrl(input?: string | null) {
  return (
    input?.trim() ||
    process.env.AGENTOS_OPENCLAW_GATEWAY_URL?.trim() ||
    process.env.OPENCLAW_GATEWAY_URL?.trim() ||
    DEFAULT_GATEWAY_URL
  );
}

function resolveNativeTimeoutMs(input?: number) {
  if (typeof input === "number" && Number.isFinite(input) && input > 0) {
    return input;
  }

  const envTimeout = Number(process.env.AGENTOS_OPENCLAW_NATIVE_WS_TIMEOUT_MS);
  if (Number.isFinite(envTimeout) && envTimeout > 0) {
    return envTimeout;
  }

  return DEFAULT_NATIVE_TIMEOUT_MS;
}

function resolveWebSocketFactory(input?: WebSocketFactory): WebSocketFactory {
  const factory = input ?? (globalThis.WebSocket as unknown as WebSocketFactory | undefined);

  if (!factory) {
    throw new NativeGatewayError("Native WebSocket is not available in this runtime.");
  }

  return factory;
}

function addSocketListener(
  socket: WebSocketLike,
  eventName: "open" | "message" | "error" | "close",
  listener: (event: unknown) => void
) {
  if (socket.addEventListener && socket.removeEventListener) {
    socket.addEventListener(eventName, listener);
    return () => socket.removeEventListener?.(eventName, listener);
  }

  const key = `on${eventName}` as "onopen" | "onmessage" | "onerror" | "onclose";
  const previous = socket[key];
  socket[key] = listener;

  return () => {
    if (socket[key] === listener) {
      socket[key] = previous ?? null;
    }
  };
}

function readSocketCloseReason(event: unknown) {
  if (!event || typeof event !== "object") {
    return null;
  }

  const record = event as { code?: unknown; reason?: unknown };
  const code = typeof record.code === "number" ? record.code : null;
  const reason = typeof record.reason === "string" ? record.reason : "";

  return code ? `${code}${reason ? `: ${reason}` : ""}` : reason || null;
}

function normalizeGatewayError(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object") {
    const record = error as { message?: unknown; detail?: unknown; code?: unknown };
    const message = typeof record.message === "string" ? record.message : null;
    const detail = typeof record.detail === "string" ? record.detail : null;
    const code = typeof record.code === "string" ? record.code : null;

    return [code, message, detail].filter(Boolean).join(": ");
  }

  return "";
}

function normalizeGatewayResponseFailure(frame: GatewayResponseFrame) {
  return (
    normalizeGatewayError(frame.error) ||
    frame.message ||
    frame.code ||
    "OpenClaw Gateway request failed."
  );
}

function parseGatewayFrameData(data: unknown): GatewayResponseFrame | null {
  if (typeof data !== "string") {
    if (data instanceof ArrayBuffer) {
      data = new TextDecoder().decode(data);
    } else if (ArrayBuffer.isView(data)) {
      data = new TextDecoder().decode(data);
    } else {
      return null;
    }
  }

  try {
    return JSON.parse(data as string) as GatewayResponseFrame;
  } catch (error) {
    throw new NativeGatewayError("OpenClaw Gateway returned invalid JSON.", { cause: error });
  }
}

function createRequestId() {
  return `agentos:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
}

function buildConnectParams(options: NativeWsOpenClawGatewayClientOptions) {
  const token = options.token?.trim() || process.env.AGENTOS_OPENCLAW_GATEWAY_TOKEN?.trim();
  const password = options.password?.trim() || process.env.AGENTOS_OPENCLAW_GATEWAY_PASSWORD?.trim();
  const auth = token
    ? { mode: "token", token }
    : password
      ? { mode: "password", password }
      : undefined;

  return {
    minProtocol: CONTROL_PROTOCOL_VERSION,
    maxProtocol: CONTROL_PROTOCOL_VERSION,
    client: {
      id: options.clientName ?? "agentos",
      version: options.clientVersion ?? "agentos",
      platform: process.platform,
      mode: "agentos",
      instanceId: options.instanceId
    },
    role: options.role ?? "operator",
    scopes: options.scopes ?? [],
    caps: ["tool-events"],
    ...(auth ? { auth } : {}),
    userAgent: "AgentOS",
    locale: "en"
  };
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new NativeGatewayError("OpenClaw Gateway request was aborted.");
  }
}

async function waitForSocketOpen(socket: WebSocketLike, timeoutMs: number, signal?: AbortSignal) {
  throwIfAborted(signal);

  if (socket.readyState === 1) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanupCallbacks: Array<() => void> = [];

    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      globalThis.clearTimeout(timer);
      for (const cleanup of cleanupCallbacks) {
        cleanup();
      }
      signal?.removeEventListener("abort", onAbort);
      callback();
    };

    const timer = globalThis.setTimeout(() => {
      settle(() => reject(new NativeGatewayError("Timed out connecting to OpenClaw Gateway.")));
    }, timeoutMs);

    const onAbort = () => {
      settle(() => reject(new NativeGatewayError("OpenClaw Gateway request was aborted.")));
    };

    cleanupCallbacks.push(
      addSocketListener(socket, "open", () => settle(resolve)),
      addSocketListener(socket, "error", (event) =>
        settle(() => reject(new NativeGatewayError("Failed to connect to OpenClaw Gateway.", { cause: event })))
      ),
      addSocketListener(socket, "close", (event) =>
        settle(() =>
          reject(
            new NativeGatewayError(
              `OpenClaw Gateway closed before the connection was ready${readSocketCloseReason(event) ? ` (${readSocketCloseReason(event)})` : ""}.`
            )
          )
        )
      )
    );
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

type PendingRequest = {
  resolve: (payload: unknown) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof globalThis.setTimeout>;
  cleanup: () => void;
};

function sendGatewayRequest<TPayload>(
  socket: WebSocketLike,
  pending: Map<string, PendingRequest>,
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number,
  signal?: AbortSignal
) {
  throwIfAborted(signal);

  const id = createRequestId();

  return new Promise<TPayload>((resolve, reject) => {
    function cleanup() {
      globalThis.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }

    function rejectRequest(error: unknown) {
      pending.delete(id);
      cleanup();
      reject(error);
    }

    function onAbort() {
      rejectRequest(new NativeGatewayError("OpenClaw Gateway request was aborted."));
    }

    const timer = globalThis.setTimeout(() => {
      rejectRequest(new NativeGatewayError(`Timed out waiting for OpenClaw Gateway method "${method}".`));
    }, timeoutMs);

    pending.set(id, {
      resolve: (payload) => {
        cleanup();
        resolve(payload as TPayload);
      },
      reject: rejectRequest,
      timer,
      cleanup
    });
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      socket.send(JSON.stringify({ type: "req", id, method, params }));
    } catch (error) {
      rejectRequest(new NativeGatewayError(`Failed to send OpenClaw Gateway method "${method}".`, { cause: error }));
    }
  });
}

export class NativeWsOpenClawGatewayClient implements OpenClawGatewayClient {
  private readonly fallback: OpenClawGatewayClient;

  constructor(private readonly options: NativeWsOpenClawGatewayClientOptions = {}) {
    this.fallback = options.fallback ?? new CliOpenClawGatewayClient();
  }

  getStatus(options: OpenClawCommandOptions = {}) {
    return this.fallback.getStatus(options);
  }

  getGatewayStatus(options: OpenClawCommandOptions = {}) {
    return this.fallback.getGatewayStatus(options);
  }

  getModelStatus(options: OpenClawCommandOptions = {}) {
    return this.fallback.getModelStatus(options);
  }

  listSkills(options: OpenClawCommandOptions & { eligible?: boolean } = {}) {
    return this.fallback.listSkills(options);
  }

  listPlugins(options: OpenClawCommandOptions = {}) {
    return this.fallback.listPlugins(options);
  }

  listModels(input: OpenClawListModelsInput = {}, options: OpenClawCommandOptions = {}) {
    return this.fallback.listModels(input, options);
  }

  scanModels(options: OpenClawCommandOptions & { yes?: boolean; noInput?: boolean; noProbe?: boolean } = {}) {
    return this.fallback.scanModels(options);
  }

  probeGateway(options: OpenClawCommandOptions = {}) {
    return this.fallback.probeGateway(options);
  }

  controlGateway(action: "start" | "stop" | "restart", options: OpenClawCommandOptions = {}) {
    return this.fallback.controlGateway(action, options);
  }

  async call<TPayload>(
    method: string,
    params: Record<string, unknown> = {},
    options: OpenClawCommandOptions = {}
  ) {
    if (this.options.forceCli || isCliGatewayClientForcedByEnv()) {
      return this.fallback.call<TPayload>(method, params, options);
    }

    try {
      return await this.callNative<TPayload>(method, params, options);
    } catch (error) {
      this.options.onNativeFailure?.(error, method);
      return this.fallback.call<TPayload>(method, params, options);
    }
  }

  getConfig<TPayload>(path: string, options: OpenClawCommandOptions = {}) {
    return this.fallback.getConfig<TPayload>(path, options);
  }

  hasConfig(path: string, options: OpenClawCommandOptions = {}) {
    return this.fallback.hasConfig(path, options);
  }

  setConfig(path: string, value: unknown, options: OpenClawCommandOptions & { strictJson?: boolean } = {}) {
    return this.fallback.setConfig(path, value, options);
  }

  unsetConfig(path: string, options: OpenClawCommandOptions = {}) {
    return this.fallback.unsetConfig(path, options);
  }

  addAgent(input: OpenClawAddAgentInput, options: OpenClawCommandOptions = {}) {
    return this.fallback.addAgent(input, options);
  }

  deleteAgent(agentId: string, options: OpenClawCommandOptions = {}) {
    return this.fallback.deleteAgent(agentId, options);
  }

  runAgentTurn(input: OpenClawAgentTurnInput, options: OpenClawCommandOptions = {}) {
    return this.fallback.runAgentTurn(input, options);
  }

  streamAgentTurn(
    input: OpenClawAgentTurnInput,
    callbacks: OpenClawStreamCallbacks = {},
    options: OpenClawCommandOptions = {}
  ) {
    return this.fallback.streamAgentTurn(input, callbacks, options);
  }

  async callNative<TPayload>(
    method: string,
    params: Record<string, unknown> = {},
    options: OpenClawCommandOptions = {}
  ) {
    const timeoutMs = resolveNativeTimeoutMs(options.timeoutMs ?? this.options.timeoutMs);
    const url = resolveGatewayUrl(this.options.url);
    const WebSocketImpl = resolveWebSocketFactory(this.options.webSocketFactory);
    const socket = new WebSocketImpl(url);
    const pending = new Map<string, PendingRequest>();
    const cleanupCallbacks: Array<() => void> = [];

    const rejectPending = (error: unknown) => {
      for (const [id, request] of pending) {
        globalThis.clearTimeout(request.timer);
        pending.delete(id);
        request.reject(error);
      }
    };

    cleanupCallbacks.push(
      addSocketListener(socket, "message", (event) => {
        try {
          const data = (event as { data?: unknown })?.data ?? event;
          const frame = parseGatewayFrameData(data);

          if (!frame || frame.type !== "res" || frame.id === undefined) {
            return;
          }

          const requestId = String(frame.id);
          const request = pending.get(requestId);
          if (!request) {
            return;
          }

          pending.delete(requestId);
          globalThis.clearTimeout(request.timer);

          if (frame.ok === false) {
            request.reject(new NativeGatewayError(normalizeGatewayResponseFailure(frame), { cause: frame }));
            return;
          }

          request.resolve(frame.payload);
        } catch (error) {
          rejectPending(error);
        }
      }),
      addSocketListener(socket, "error", (event) => {
        rejectPending(new NativeGatewayError("OpenClaw Gateway WebSocket error.", { cause: event }));
      }),
      addSocketListener(socket, "close", (event) => {
        if (pending.size === 0) {
          return;
        }

        const detail = readSocketCloseReason(event);
        rejectPending(
          new NativeGatewayError(`OpenClaw Gateway connection closed${detail ? ` (${detail})` : ""}.`)
        );
      })
    );

    try {
      await waitForSocketOpen(socket, timeoutMs, options.signal);
      await sendGatewayRequest(
        socket,
        pending,
        CONNECT_METHOD,
        buildConnectParams(this.options),
        timeoutMs,
        options.signal
      );
      return await sendGatewayRequest<TPayload>(socket, pending, method, params, timeoutMs, options.signal);
    } finally {
      for (const cleanup of cleanupCallbacks) {
        cleanup();
      }
      rejectPending(new NativeGatewayError("OpenClaw Gateway request was cleaned up before completion."));

      try {
        socket.close();
      } catch {
        // Ignore close errors during cleanup.
      }
    }
  }
}
