import "server-only";

import { z } from "zod";

import { CliOpenClawGatewayClient } from "@/lib/openclaw/client/cli-gateway-client";
import type { CommandResult } from "@/lib/openclaw/cli";
import type {
  GatewayProbePayload,
  GatewayStatusPayload,
  ModelsPayload,
  ModelsStatusPayload,
  OpenClawAddAgentInput,
  OpenClawAgentListPayload,
  OpenClawAgentTurnInput,
  OpenClawCommandOptions,
  OpenClawGatewayClient,
  OpenClawListModelsInput,
  OpenClawListSessionsInput,
  OpenClawModelScanPayload,
  OpenClawPluginListPayload,
  OpenClawSessionsPayload,
  OpenClawSkillListPayload,
  OpenClawStreamCallbacks,
  StatusPayload,
} from "@/lib/openclaw/client/types";

const DEFAULT_GATEWAY_URL = "ws://127.0.0.1:18789";
const DEFAULT_NATIVE_TIMEOUT_MS = 3_000;
const CONNECT_METHOD = "connect";
const CONTROL_PROTOCOL_VERSION = 3;
const SERVER_OPERATOR_CLIENT_ID = "cli";
const SERVER_OPERATOR_CLIENT_MODE = "cli";
const DEFAULT_OPERATOR_SCOPES = [
  "operator.admin",
  "operator.read",
  "operator.write",
  "operator.approvals",
  "operator.pairing"
];
const REDACTED_OPENCLAW_SECRET = "__OPENCLAW_REDACTED__";

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
  readonly kind: OpenClawGatewayClientErrorKind;

  constructor(
    message: string,
    options: {
      cause?: unknown;
      kind?: OpenClawGatewayClientErrorKind;
    } = {}
  ) {
    super(message);
    this.name = "NativeGatewayError";
    this.kind = options.kind ?? classifyGatewayError(message);
    this.cause = options.cause;
  }
}

type OpenClawGatewayClientErrorKind =
  | "auth"
  | "malformed-response"
  | "scope-limited"
  | "timeout"
  | "unreachable"
  | "unknown";

export class OpenClawGatewayClientError extends Error {
  constructor(
    message: string,
    readonly kind: OpenClawGatewayClientErrorKind,
    options: {
      cause?: unknown;
    } = {}
  ) {
    super(message);
    this.name = "OpenClawGatewayClientError";
    this.cause = options.cause;
  }
}

export type OpenClawGatewayFallbackDiagnostic = {
  at: string;
  operation: string;
  issue: string;
  kind: OpenClawGatewayClientErrorKind;
};

const recentGatewayFallbackDiagnostics: OpenClawGatewayFallbackDiagnostic[] = [];
const maxGatewayFallbackDiagnostics = 20;

export function getRecentOpenClawGatewayFallbackDiagnostics() {
  return [...recentGatewayFallbackDiagnostics];
}

export function clearOpenClawGatewayFallbackDiagnosticsForTesting() {
  recentGatewayFallbackDiagnostics.length = 0;
}

function recordGatewayFallbackDiagnostic(operation: string, error: unknown) {
  const normalized = normalizeClientError(error);
  clearGatewayFallbackDiagnostic(operation);
  recentGatewayFallbackDiagnostics.unshift({
    at: new Date().toISOString(),
    operation,
    issue: normalized.message,
    kind: normalized.kind
  });

  recentGatewayFallbackDiagnostics.splice(maxGatewayFallbackDiagnostics);
}

function clearGatewayFallbackDiagnostic(operation: string) {
  for (let index = recentGatewayFallbackDiagnostics.length - 1; index >= 0; index -= 1) {
    if (recentGatewayFallbackDiagnostics[index]?.operation === operation) {
      recentGatewayFallbackDiagnostics.splice(index, 1);
    }
  }
}

function normalizeClientError(error: unknown) {
  if (error instanceof OpenClawGatewayClientError) {
    return error;
  }

  if (error instanceof NativeGatewayError) {
    return new OpenClawGatewayClientError(error.message, error.kind, { cause: error.cause ?? error });
  }

  const message = error instanceof Error ? error.message : String(error || "OpenClaw Gateway request failed.");
  return new OpenClawGatewayClientError(message, classifyGatewayError(message), { cause: error });
}

function classifyGatewayError(message: string): OpenClawGatewayClientErrorKind {
  if (/auth|token|password|unauthorized|forbidden/i.test(message)) {
    return "auth";
  }

  if (/scope|permission|not allowed/i.test(message)) {
    return "scope-limited";
  }

  if (/invalid json|malformed|schema|payload/i.test(message)) {
    return "malformed-response";
  }

  if (/timed out|timeout/i.test(message)) {
    return "timeout";
  }

  if (/connect|closed|unreachable|websocket/i.test(message)) {
    return "unreachable";
  }

  return "unknown";
}

const gatewayStatusPayloadSchema = z
  .object({
    service: z
      .object({
        label: z.string().optional(),
        loaded: z.boolean().optional()
      })
      .passthrough()
      .optional(),
    gateway: z
      .object({
        bindMode: z.string().optional(),
        port: z.number().optional(),
        probeUrl: z.string().optional()
      })
      .passthrough()
      .optional(),
    rpc: z
      .object({
        ok: z.boolean().optional()
      })
      .passthrough()
      .optional()
  })
  .passthrough();

const statusPayloadSchema = z
  .object({
    runtimeVersion: z.string().optional(),
    version: z.string().optional(),
    updateChannel: z.string().optional()
  })
  .passthrough();

const modelStatusPayloadSchema = z
  .object({
    defaultModel: z.string().nullable().optional(),
    resolvedDefault: z.string().nullable().optional(),
    allowed: z.array(z.string()).optional()
  })
  .passthrough();

const agentListPayloadSchema = z
  .object({
    defaultId: z.string().optional(),
    mainKey: z.string().optional(),
    scope: z.string().optional(),
    agents: z.array(
      z
        .object({
          id: z.string(),
          name: z.string().optional(),
          identity: z
            .object({
              name: z.string().optional(),
              theme: z.string().optional(),
              emoji: z.string().optional(),
              avatar: z.string().optional(),
              avatarUrl: z.string().optional()
            })
            .passthrough()
            .optional(),
          workspace: z.string().optional(),
          model: z
            .object({
              primary: z.string().optional(),
              fallbacks: z.array(z.string()).optional()
            })
            .passthrough()
            .optional()
        })
        .passthrough()
    )
  })
  .passthrough();

const sessionsPayloadSchema = z
  .object({
    sessions: z.array(z.object({}).passthrough())
  })
  .passthrough();

const modelsPayloadSchema = z
  .object({
    models: z.array(
      z
        .object({
          key: z.string(),
          name: z.string(),
          input: z.string().default("text"),
          contextWindow: z.number().nullable().optional().default(null),
          local: z.boolean().nullable().optional().default(null),
          available: z.boolean().nullable().optional().default(null),
          tags: z.array(z.string()).optional().default([]),
          missing: z.boolean().optional().default(false)
        })
        .passthrough()
    )
  })
  .passthrough();

const skillsPayloadSchema = z
  .object({
    skills: z.array(
      z
        .object({
          name: z.string(),
          description: z.string().optional(),
          emoji: z.string().optional(),
          eligible: z.boolean().optional(),
          disabled: z.boolean().optional(),
          blockedByAllowlist: z.boolean().optional(),
          source: z.string().optional(),
          bundled: z.boolean().optional()
        })
        .passthrough()
    )
  })
  .passthrough();

const pluginsPayloadSchema = z
  .object({
    plugins: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          status: z.string().optional(),
          toolNames: z.array(z.string()).optional()
        })
        .passthrough()
    )
  })
  .passthrough();

const modelScanPayloadSchema = z.array(
  z
    .object({
      id: z.string(),
      name: z.string(),
      provider: z.string()
    })
    .passthrough()
);

const configSnapshotPayloadSchema = z
  .object({
    exists: z.boolean().optional(),
    valid: z.boolean().optional(),
    hash: z.string().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    resolved: z.unknown().optional()
  })
  .passthrough();

function parseGatewayPayload<TPayload>(operation: string, schema: z.ZodTypeAny, payload: unknown) {
  const parsed = schema.safeParse(payload);

  if (!parsed.success) {
    throw new OpenClawGatewayClientError(
      `${operation}: OpenClaw Gateway returned a malformed response.`,
      "malformed-response",
      { cause: parsed.error }
    );
  }

  return parsed.data as TPayload;
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

function readConfigString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readConfigPath(source: unknown, path: string) {
  if (!path.trim()) {
    return source;
  }

  let current = source;
  for (const segment of parseConfigPath(path)) {
    if (Array.isArray(current) && typeof segment === "number") {
      current = current[segment];
      continue;
    }

    if (!isObjectRecord(current) || typeof segment !== "string") {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

function parseConfigPath(path: string): Array<string | number> {
  const segments: Array<string | number> = [];
  const matcher = /([^[.\]]+)|\[(\d+)\]/g;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(path))) {
    if (match[1]) {
      segments.push(match[1]);
    } else if (match[2]) {
      segments.push(Number(match[2]));
    }
  }

  return segments;
}

function cloneJsonObject(value: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function setConfigPathValue(config: Record<string, unknown>, path: string, value: unknown) {
  const segments = parseConfigPath(path);
  if (segments.length === 0) {
    throw new OpenClawGatewayClientError("Config path is required.", "unknown");
  }

  let current: Record<string, unknown> = config;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const nextSegment = segments[index + 1];
    if (typeof segment !== "string") {
      throw new OpenClawGatewayClientError("Array root config paths are not supported.", "unknown");
    }

    const next = current[segment];
    if (isObjectRecord(next) || Array.isArray(next)) {
      current = next as Record<string, unknown>;
      continue;
    }

    const created = typeof nextSegment === "number" ? [] : {};
    current[segment] = created;
    current = created as Record<string, unknown>;
  }

  const last = segments[segments.length - 1];
  if (typeof last === "number") {
    if (!Array.isArray(current)) {
      throw new OpenClawGatewayClientError("Config path points to an array index on a non-array parent.", "unknown");
    }
    current[last] = value;
    return;
  }

  current[last] = value;
}

function unsetConfigPathValue(config: Record<string, unknown>, path: string) {
  const segments = parseConfigPath(path);
  if (segments.length === 0) {
    throw new OpenClawGatewayClientError("Config path is required.", "unknown");
  }

  let current: unknown = config;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    current = Array.isArray(current) && typeof segment === "number"
      ? current[segment]
      : isObjectRecord(current) && typeof segment === "string"
        ? current[segment]
        : undefined;

    if (current === undefined) {
      return;
    }
  }

  const last = segments[segments.length - 1];
  if (Array.isArray(current) && typeof last === "number") {
    current.splice(last, 1);
    return;
  }

  if (isObjectRecord(current) && typeof last === "string") {
    delete current[last];
  }
}

function commandResultFromGatewayPayload(payload: unknown): CommandResult {
  return {
    stdout: JSON.stringify(payload ?? {}),
    stderr: ""
  };
}

function isRedactedOpenClawSecret(value: string) {
  return value === REDACTED_OPENCLAW_SECRET;
}

async function resolveConfiguredGatewaySecret(
  fallback: OpenClawGatewayClient,
  paths: string[],
  options: OpenClawCommandOptions
) {
  for (const path of paths) {
    const value = readConfigString(await fallback.getConfig<unknown>(path, options).catch(() => null));
    if (isRedactedOpenClawSecret(value)) {
      throw new OpenClawGatewayClientError(
        `${path} is configured but OpenClaw returned a redacted secret. Set AGENTOS_OPENCLAW_GATEWAY_TOKEN/PASSWORD or OPENCLAW_GATEWAY_TOKEN/PASSWORD to enable native Gateway WS; using CLI fallback.`,
        "auth"
      );
    }
    if (value) {
      return value;
    }
  }

  return "";
}

async function resolveGatewayAuth(
  fallback: OpenClawGatewayClient,
  options: NativeWsOpenClawGatewayClientOptions,
  url: string,
  commandOptions: OpenClawCommandOptions
) {
  const configTokenPaths = isLocalGatewayUrl(url)
    ? ["gateway.auth.token", "gateway.remote.token"]
    : ["gateway.remote.token", "gateway.auth.token"];
  const configPasswordPaths = isLocalGatewayUrl(url)
    ? ["gateway.auth.password", "gateway.remote.password"]
    : ["gateway.remote.password", "gateway.auth.password"];
  const token =
    options.token?.trim() ||
    process.env.AGENTOS_OPENCLAW_GATEWAY_TOKEN?.trim() ||
    process.env.OPENCLAW_GATEWAY_TOKEN?.trim() ||
    await resolveConfiguredGatewaySecret(fallback, configTokenPaths, commandOptions);
  const password =
    options.password?.trim() ||
    process.env.AGENTOS_OPENCLAW_GATEWAY_PASSWORD?.trim() ||
    process.env.OPENCLAW_GATEWAY_PASSWORD?.trim() ||
    await resolveConfiguredGatewaySecret(fallback, configPasswordPaths, commandOptions);

  return { token, password };
}

function isLocalGatewayUrl(rawUrl: string) {
  try {
    const { hostname } = new URL(rawUrl);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

async function buildConnectParams(
  fallback: OpenClawGatewayClient,
  options: NativeWsOpenClawGatewayClientOptions,
  url: string,
  commandOptions: OpenClawCommandOptions
) {
  const { token, password } = await resolveGatewayAuth(fallback, options, url, commandOptions);
  const auth = token
    ? { token }
    : password
      ? { password }
      : undefined;

  return {
    minProtocol: CONTROL_PROTOCOL_VERSION,
    maxProtocol: CONTROL_PROTOCOL_VERSION,
    client: {
      id: options.clientName ?? SERVER_OPERATOR_CLIENT_ID,
      version: options.clientVersion ?? "agentos",
      platform: process.platform,
      mode: SERVER_OPERATOR_CLIENT_MODE,
      instanceId: options.instanceId
    },
    role: options.role ?? "operator",
    scopes: options.scopes ?? DEFAULT_OPERATOR_SCOPES,
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
    return this.gatewayFirst(
      "status",
      {},
      options,
      (payload) => parseGatewayPayload<StatusPayload>("status", statusPayloadSchema, payload),
      () => this.fallback.getStatus(options)
    );
  }

  getGatewayStatus(options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst(
      "gateway.status",
      {},
      options,
      (payload) => parseGatewayPayload<GatewayStatusPayload>("gateway.status", gatewayStatusPayloadSchema, payload),
      () => this.fallback.getGatewayStatus(options)
    );
  }

  getModelStatus(options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst(
      "models.status",
      {},
      options,
      (payload) => parseGatewayPayload<ModelsStatusPayload>("models.status", modelStatusPayloadSchema, payload),
      () => this.fallback.getModelStatus(options)
    );
  }

  listAgents(options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst(
      "agents.list",
      {},
      options,
      (payload) => parseGatewayPayload<OpenClawAgentListPayload>("agents.list", agentListPayloadSchema, payload),
      () => this.fallback.listAgents(options)
    );
  }

  listSessions(input: OpenClawListSessionsInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst(
      "sessions.list",
      { ...input },
      options,
      (payload) => parseGatewayPayload<OpenClawSessionsPayload>("sessions.list", sessionsPayloadSchema, payload),
      () => this.fallback.listSessions(input, options)
    );
  }

  listSkills(options: OpenClawCommandOptions & { eligible?: boolean } = {}) {
    return this.gatewayFirst(
      "skills.list",
      { eligible: options.eligible === true },
      options,
      (payload) => parseGatewayPayload<OpenClawSkillListPayload>("skills.list", skillsPayloadSchema, payload),
      () => this.fallback.listSkills(options)
    );
  }

  listPlugins(options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst(
      "plugins.list",
      {},
      options,
      (payload) => parseGatewayPayload<OpenClawPluginListPayload>("plugins.list", pluginsPayloadSchema, payload),
      () => this.fallback.listPlugins(options)
    );
  }

  listModels(input: OpenClawListModelsInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst(
      "models.list",
      { ...input },
      options,
      (payload) => parseGatewayPayload<ModelsPayload>("models.list", modelsPayloadSchema, payload),
      () => this.fallback.listModels(input, options)
    );
  }

  scanModels(options: OpenClawCommandOptions & { yes?: boolean; noInput?: boolean; noProbe?: boolean } = {}) {
    return this.gatewayFirst(
      "models.scan",
      {
        yes: options.yes === true,
        noInput: options.noInput === true,
        noProbe: options.noProbe === true
      },
      options,
      (payload) => parseGatewayPayload<OpenClawModelScanPayload>("models.scan", modelScanPayloadSchema, payload),
      () => this.fallback.scanModels(options)
    );
  }

  probeGateway(options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst(
      "gateway.probe",
      {},
      options,
      (payload) => payload as GatewayProbePayload,
      () => this.fallback.probeGateway(options)
    );
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
      const payload = await this.callNative<TPayload>(method, params, options);
      clearGatewayFallbackDiagnostic(method);
      return payload;
    } catch (error) {
      this.options.onNativeFailure?.(error, method);
      recordGatewayFallbackDiagnostic(method, error);
      return this.fallback.call<TPayload>(method, params, options);
    }
  }

  getConfig<TPayload>(path: string, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<TPayload | null>(
      "config.get",
      {},
      options,
      (payload) => {
        const snapshot = parseGatewayPayload<Record<string, unknown>>(
          "config.get",
          configSnapshotPayloadSchema,
          payload
        );
        const config = isObjectRecord(snapshot.config) ? snapshot.config : {};
        const resolved = isObjectRecord(snapshot.resolved) ? snapshot.resolved : {};
        const value = readConfigPath(config, path) ?? readConfigPath(resolved, path);
        return value === undefined ? null : value as TPayload;
      },
      () => this.fallback.getConfig<TPayload>(path, options)
    );
  }

  async hasConfig(path: string, options: OpenClawCommandOptions = {}) {
    try {
      const value = await this.getConfig(path, options);
      return value !== null && value !== undefined;
    } catch {
      return this.fallback.hasConfig(path, options);
    }
  }

  setConfig(path: string, value: unknown, options: OpenClawCommandOptions & { strictJson?: boolean } = {}) {
    return this.gatewayConfigMutationFirst(
      "config.set",
      options,
      (config) => setConfigPathValue(config, path, value),
      () => this.fallback.setConfig(path, value, options)
    );
  }

  unsetConfig(path: string, options: OpenClawCommandOptions = {}) {
    return this.gatewayConfigMutationFirst(
      "config.unset",
      options,
      (config) => unsetConfigPathValue(config, path),
      () => this.fallback.unsetConfig(path, options)
    );
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
    const connectParams = await buildConnectParams(this.fallback, this.options, url, options);
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
        connectParams,
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

  private async gatewayFirst<TPayload>(
    method: string,
    params: Record<string, unknown>,
    options: OpenClawCommandOptions,
    normalize: (payload: unknown) => TPayload,
    fallback: () => Promise<TPayload>
  ) {
    if (this.options.forceCli || isCliGatewayClientForcedByEnv()) {
      return fallback();
    }

    try {
      const payload = normalize(await this.callNative<unknown>(method, params, options));
      clearGatewayFallbackDiagnostic(method);
      return payload;
    } catch (error) {
      this.options.onNativeFailure?.(error, method);
      recordGatewayFallbackDiagnostic(method, error);
      return fallback();
    }
  }

  private async gatewayConfigMutationFirst(
    operation: string,
    options: OpenClawCommandOptions,
    mutate: (config: Record<string, unknown>) => void,
    fallback: () => Promise<CommandResult>
  ) {
    if (this.options.forceCli || isCliGatewayClientForcedByEnv()) {
      return fallback();
    }

    try {
      const snapshot = parseGatewayPayload<Record<string, unknown>>(
        "config.get",
        configSnapshotPayloadSchema,
        await this.callNative<unknown>("config.get", {}, options)
      );
      const config = cloneJsonObject(isObjectRecord(snapshot.config) ? snapshot.config : {});
      mutate(config);
      const params: Record<string, unknown> = {
        raw: JSON.stringify(config)
      };

      if (typeof snapshot.hash === "string" && snapshot.hash.trim()) {
        params.baseHash = snapshot.hash;
      }

      const payload = await this.callNative<unknown>("config.set", params, options);
      clearGatewayFallbackDiagnostic(operation);
      return commandResultFromGatewayPayload(payload);
    } catch (error) {
      this.options.onNativeFailure?.(error, operation);
      recordGatewayFallbackDiagnostic(operation, error);
      return fallback();
    }
  }
}
