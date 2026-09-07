import "server-only";

import {
  GatewayClient,
  GatewayClientRequestError,
  GatewayClientRequestTimeoutError,
  type GatewayClientCloseInfo,
  type GatewayClientConnectionMetadata,
  type GatewayClientHostDeps,
  type GatewayClientRequestOptions,
  type GatewayReconnectPausedInfo
} from "@openclaw/gateway-client";
import {
  GATEWAY_CLIENT_MODES,
  GATEWAY_CLIENT_NAMES,
  type GatewayClientMode,
  type GatewayClientName
} from "@openclaw/gateway-protocol/client-info";
import type { EventFrame, HelloOk } from "@openclaw/gateway-protocol/frame-guards";

import {
  AGENTOS_GATEWAY_CLIENT_CAPABILITIES,
  OPENCLAW_GATEWAY_PROTOCOL_RANGE,
  SERVER_OPERATOR_CLIENT_ID,
  SERVER_OPERATOR_CLIENT_MODE
} from "@/lib/openclaw/client/openclaw-protocol";
import {
  DEFAULT_OPERATOR_SCOPES,
  DEFAULT_GATEWAY_URL
} from "@/lib/openclaw/client/native-ws-gateway-types";
import {
  NativeGatewayError,
  NativeGatewayRequestError,
  normalizeClientError
} from "@/lib/openclaw/client/native-ws-gateway-errors";
import {
  createAgentOsGatewayClientHostDeps,
  type AgentOsGatewayClientHostOptions
} from "@/lib/openclaw/client/official-gateway-host";
import type { OpenClawGatewayEventConnectionState } from "@/lib/openclaw/client/types";
import { redactSecretText } from "@/lib/security/redaction";

export type OfficialGatewayTransportCallbacks = {
  onHello?: (hello: HelloOk) => void;
  onEvent?: (event: EventFrame) => void;
  onClose?: (code: number, reason: string, info?: GatewayClientCloseInfo) => void;
  onError?: (error: Error) => void;
  onReconnectPaused?: (info: GatewayReconnectPausedInfo) => void;
  onGap?: (info: { expected: number; received: number }) => void;
  onConnectionStateChange?: (state: OpenClawGatewayEventConnectionState) => void;
};

export type OfficialGatewayTransportOptions = AgentOsGatewayClientHostOptions & {
  url?: string;
  token?: string | null;
  password?: string | null;
  deviceToken?: string | null;
  timeoutMs?: number;
  requestTimeoutMs?: number;
  clientName?: GatewayClientName;
  clientVersion?: string;
  clientBuildId?: string;
  instanceId?: string;
  role?: string;
  scopes?: string[];
  caps?: string[];
  mode?: GatewayClientMode;
  platform?: string;
  deviceFamily?: string;
  minProtocol?: number;
  maxProtocol?: number;
  hostDeps?: GatewayClientHostDeps;
  /** Certification/managed flows may bind device proof to an explicit shared token. */
  includeDeviceIdentityWithExplicitAuth?: boolean;
  callbacks?: OfficialGatewayTransportCallbacks;
};

export type OfficialGatewayRequestOptions = GatewayClientRequestOptions;

/**
 * Thin AgentOS boundary around @openclaw/gateway-client.
 *
 * The official package owns WebSocket lifecycle, protocol correlation,
 * timeout/abort handling, reconnect, sequence-gap detection, and device
 * authentication. This class only supplies AgentOS metadata/host hooks and
 * maps package errors into the existing AgentOS error vocabulary.
 */
export class OfficialOpenClawGatewayTransport {
  readonly #client: GatewayClient;
  readonly #requestedRole: string;
  readonly #requestedScopes: string[];
  #hello: HelloOk | null = null;
  #deviceId: string | null = null;
  #lifecycleState: OpenClawGatewayEventConnectionState = "stopped";
  #generation = 0;
  #started = false;
  #intentionalStop = true;
  #lastConnectedAt: string | null = null;
  #lastDisconnectedAt: string | null = null;
  #lastError: string | null = null;
  readonly #readyWaiters = new Set<{
    method: string;
    timer: ReturnType<typeof setTimeout>;
    resolve: (hello: HelloOk) => void;
    reject: (error: unknown) => void;
    signal?: AbortSignal;
    onAbort?: () => void;
  }>();

  constructor(options: OfficialGatewayTransportOptions = {}) {
    const callbacks = options.callbacks ?? {};
    this.#callbacksForState = callbacks;
    const hostDeps = options.hostDeps ?? createAgentOsGatewayClientHostDeps({
      stateDir: options.stateDir,
      sharedStateMode: options.sharedStateMode,
      ensureDeviceIdentity: options.ensureDeviceIdentity,
      overrides: options.overrides
    });
    this.#requestedRole = options.role ?? "operator";
    this.#requestedScopes = [...(options.scopes ?? [...DEFAULT_OPERATOR_SCOPES])];
    if ((!options.token && !options.password) || options.includeDeviceIdentityWithExplicitAuth) {
      try {
        this.#deviceId = hostDeps.loadOrCreateDeviceIdentity?.()?.deviceId ?? null;
      } catch {
        this.#deviceId = null;
      }
    }

    this.#client = new GatewayClient({
      url: options.url ?? DEFAULT_GATEWAY_URL,
      token: options.token?.trim() || undefined,
      password: options.password?.trim() || undefined,
      deviceToken: options.deviceToken?.trim() || undefined,
      clientName: options.clientName ?? GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT,
      clientVersion: options.clientVersion ?? "agentos",
      clientBuildId: options.clientBuildId,
      instanceId: options.instanceId,
      platform: options.platform ?? process.platform,
      deviceFamily: options.deviceFamily,
      mode: options.mode ?? GATEWAY_CLIENT_MODES.BACKEND,
      role: this.#requestedRole,
      scopes: this.#requestedScopes,
      caps: options.caps ?? [...AGENTOS_GATEWAY_CLIENT_CAPABILITIES],
      minProtocol: options.minProtocol ?? OPENCLAW_GATEWAY_PROTOCOL_RANGE.min,
      maxProtocol: options.maxProtocol ?? OPENCLAW_GATEWAY_PROTOCOL_RANGE.max,
      requestTimeoutMs: options.requestTimeoutMs ?? options.timeoutMs,
      // Explicit null prevents the official package from creating a device
      // identity when this transport is used with token/password auth.
      deviceIdentity: options.token || options.password
        ? options.includeDeviceIdentityWithExplicitAuth ? undefined : null
        : undefined,
      hostDeps,
      onHelloOk: (hello) => {
        this.#hello = hello;
        this.#generation += 1;
        this.#lastConnectedAt = new Date().toISOString();
        this.#lastError = null;
        this.#setLifecycleState("connected", callbacks);
        this.#resolveReadyWaiters(hello);
        callbacks.onHello?.(hello);
      },
      onEvent: (event) => callbacks.onEvent?.(event),
      onClose: (code, reason, info) => {
        this.#hello = null;
        this.#lastDisconnectedAt = new Date().toISOString();
        if (this.#intentionalStop) {
          this.#setLifecycleState("stopped", callbacks);
        } else if (this.#lifecycleState === "reconnect-paused") {
          // The official client has made a terminal reconnect decision. The
          // close that carries that decision must not downgrade it to a retry.
          this.#setLifecycleState("reconnect-paused", callbacks);
        } else {
          this.#setLifecycleState("reconnecting", callbacks);
        }
        callbacks.onClose?.(code, reason, info);
      },
      onConnectError: (error) => {
        const mapped = this.#mapConnectionError(error);
        this.#lastError = mapped.message;
        callbacks.onError?.(mapped);
      },
      onReconnectPaused: (info) => {
        this.#lastError = redactSecretText(`OpenClaw Gateway reconnect paused: ${info.reason || "terminal connection state"}.`);
        this.#setLifecycleState("reconnect-paused", callbacks);
        this.#rejectReadyWaiters(new NativeGatewayError(
          `OpenClaw Gateway reconnect paused: ${info.reason || "terminal connection state"}.`,
          { kind: "auth", cause: info }
        ));
        callbacks.onReconnectPaused?.(info);
      },
      onGap: (info) => callbacks.onGap?.(info)
    });
  }

  start() {
    if (this.#started) {
      return;
    }
    this.#started = true;
    this.#intentionalStop = false;
    this.#setLifecycleState("connecting", this.#callbacksForState);
    this.#client.start();
  }

  stop() {
    this.#intentionalStop = true;
    this.#started = false;
    this.#rejectReadyWaiters(new NativeGatewayError("OpenClaw Gateway transport stopped.", { kind: "unreachable" }));
    this.#client.stop();
    this.#setLifecycleState("stopped", this.#callbacksForState);
  }

  stopAndWait(options?: { timeoutMs?: number }) {
    this.#intentionalStop = true;
    this.#started = false;
    this.#rejectReadyWaiters(new NativeGatewayError("OpenClaw Gateway transport stopped.", { kind: "unreachable" }));
    return this.#client.stopAndWait(options).finally(() => {
      this.#setLifecycleState("stopped", this.#callbacksForState);
    });
  }

  waitForReady(options: { method?: string; timeoutMs?: number; signal?: AbortSignal } = {}) {
    if (this.#lifecycleState === "connected" && this.#hello) {
      return Promise.resolve(this.#hello);
    }

    if (this.#lifecycleState === "reconnect-paused") {
      return Promise.reject(new NativeGatewayError(
        this.#lastError ?? "OpenClaw Gateway reconnect is paused.",
        { kind: "auth" }
      ));
    }

    this.start();
    const timeoutMs = typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs)
      ? Math.max(1, options.timeoutMs)
      : 30_000;

    return new Promise<HelloOk>((resolve, reject) => {
      const waiter = {
        method: options.method ?? "connect",
        timer: setTimeout(() => {
          this.#readyWaiters.delete(waiter);
          waiter.signal?.removeEventListener("abort", waiter.onAbort);
          reject(new NativeGatewayRequestError(
            `OpenClaw Gateway request "${waiter.method}" timed out while waiting for the connection to become ready.`,
            waiter.method,
            false,
            { kind: "timeout" }
          ));
        }, timeoutMs),
        resolve,
        reject,
        signal: options.signal,
        onAbort: () => {
          clearTimeout(waiter.timer);
          this.#readyWaiters.delete(waiter);
          reject(new NativeGatewayRequestError(
            `OpenClaw Gateway request "${waiter.method}" was aborted before the connection became ready.`,
            waiter.method,
            false,
            { kind: "unreachable" }
          ));
        }
      };
      if (options.signal?.aborted) {
        waiter.onAbort();
        return;
      }
      options.signal?.addEventListener("abort", waiter.onAbort, { once: true });
      this.#readyWaiters.add(waiter);
    });
  }

  request<T = Record<string, unknown>>(
    method: string,
    params?: unknown,
    options?: OfficialGatewayRequestOptions
  ): Promise<T> {
    return this.waitForReady({ method, timeoutMs: options?.timeoutMs ?? 30_000, signal: options?.signal })
      .then(() => this.#client.request<T>(method, params, options))
      .catch((error: unknown) => {
        const mapped = this.#mapRequestError(method, error);
        this.#markTransientConnectionLoss(mapped);
        throw mapped;
      });
  }

  async requestForGeneration<T = Record<string, unknown>>(
    generation: number,
    method: string,
    params?: unknown,
    options?: OfficialGatewayRequestOptions
  ): Promise<T> {
    await this.waitForReady({ method, timeoutMs: options?.timeoutMs ?? 30_000, signal: options?.signal });
    if (this.#generation !== generation) {
      throw new NativeGatewayError(
        `OpenClaw Gateway request "${method}" crossed a connection generation boundary.`,
        { kind: "unreachable" }
      );
    }
    try {
      return await this.#client.request<T>(method, params, options);
    } catch (error) {
      const mapped = this.#mapRequestError(method, error);
      this.#markTransientConnectionLoss(mapped);
      throw mapped;
    }
  }

  getHandshake() {
    return this.#hello;
  }

  getConnectionMetadata(): GatewayClientConnectionMetadata {
    return this.#client.getConnectionMetadata();
  }

  getLifecycleState() {
    return this.#lifecycleState;
  }

  getGeneration() {
    return this.#generation;
  }

  getDeviceId() {
    return this.#deviceId;
  }

  getRequestedRole() {
    return this.#requestedRole;
  }

  getRequestedScopes() {
    return [...this.#requestedScopes];
  }

  getLastConnectedAt() {
    return this.#lastConnectedAt;
  }

  getLastDisconnectedAt() {
    return this.#lastDisconnectedAt;
  }

  getLastError() {
    return this.#lastError;
  }

  #callbacksForState: OfficialGatewayTransportCallbacks = {};

  #setLifecycleState(
    state: OpenClawGatewayEventConnectionState,
    callbacks: OfficialGatewayTransportCallbacks
  ) {
    this.#lifecycleState = state;
    this.#callbacksForState = callbacks;
    callbacks.onConnectionStateChange?.(state);
  }

  #resolveReadyWaiters(hello: HelloOk) {
    for (const waiter of [...this.#readyWaiters]) {
      clearTimeout(waiter.timer);
      waiter.signal?.removeEventListener("abort", waiter.onAbort ?? (() => {}));
      this.#readyWaiters.delete(waiter);
      waiter.resolve(hello);
    }
  }

  #rejectReadyWaiters(error: unknown) {
    for (const waiter of [...this.#readyWaiters]) {
      clearTimeout(waiter.timer);
      waiter.signal?.removeEventListener("abort", waiter.onAbort ?? (() => {}));
      this.#readyWaiters.delete(waiter);
      waiter.reject(error);
    }
  }

  #markTransientConnectionLoss(error: NativeGatewayError) {
    if (error instanceof NativeGatewayRequestError && !error.sent && error.kind === "unreachable" && !this.#intentionalStop) {
      this.#hello = null;
      this.#setLifecycleState("reconnecting", this.#callbacksForState);
    }
  }

  #mapConnectionError(error: Error) {
    const normalized = normalizeClientError(error);
    return new NativeGatewayError(normalized.message, {
      cause: error,
      kind: normalized.kind
    });
  }

  #mapRequestError(method: string, error: unknown) {
    if (error instanceof GatewayClientRequestTimeoutError) {
      return new NativeGatewayRequestError(
        `OpenClaw Gateway request "${method}" timed out after ${error.timeoutMs} ms.`,
        method,
        error.requestSent,
        { cause: error, kind: "timeout" }
      );
    }

    const normalized = normalizeClientError(error);
    const requestSent = error instanceof GatewayClientRequestError ||
      (error instanceof Error && error.name === "GatewayProtocolRequestError");

    return new NativeGatewayRequestError(normalized.message, method, requestSent, {
      cause: error,
      kind: normalized.kind
    });
  }
}

export {
  SERVER_OPERATOR_CLIENT_ID,
  SERVER_OPERATOR_CLIENT_MODE
};
