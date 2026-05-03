import "server-only";

import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  clearMissionControlRuntimeHistoryCache,
  getMissionControlSnapshot,
  invalidateMissionControlSnapshotCache
} from "@/lib/openclaw/application/mission-control-service";
import {
  normalizeGatewayRemoteUrl,
  normalizeWorkspaceRoot,
  readMissionControlSettings,
  writeMissionControlSettings
} from "@/lib/openclaw/domains/control-plane-settings";
import {
  isCliGatewayClientForcedByEnv,
  NativeWsOpenClawGatewayClient
} from "@/lib/openclaw/client/native-ws-gateway-client";
import { runOpenClawJson } from "@/lib/openclaw/cli";
import type {
  GatewayAuthSecretState,
  GatewayNativeAuthCredentialKind,
  GatewayNativeDeviceAccessRepairResult,
  GatewayNativeAuthIssueKind,
  GatewayNativeAuthStatus
} from "@/lib/openclaw/gateway-auth";

const GATEWAY_REMOTE_URL_CONFIG_KEY = "gateway.remote.url";
const REDACTED_OPENCLAW_SECRET = "__OPENCLAW_REDACTED__";
const GATEWAY_NATIVE_AUTH_CHECK_TIMEOUT_MS = 2_500;
const GATEWAY_AUTH_ENV_FILE_NAME = ".env.local";
const GATEWAY_AUTH_TOKEN_ENV_NAME = "AGENTOS_OPENCLAW_GATEWAY_TOKEN";
const GATEWAY_AUTH_PASSWORD_ENV_NAME = "AGENTOS_OPENCLAW_GATEWAY_PASSWORD";
const GATEWAY_AUTH_MODE_CONFIG_KEY = "gateway.auth.mode";
const GATEWAY_AUTH_TOKEN_CONFIG_KEY = "gateway.auth.token";
const GATEWAY_AUTH_RESTART_SETTLE_MS = 1_250;
const GATEWAY_DEVICE_ACCESS_REPAIR_TIMEOUT_MS = 10_000;

type GatewayDeviceApprovePayload = {
  requestId?: unknown;
  device?: {
    deviceId?: unknown;
    scopes?: unknown;
    approvedScopes?: unknown;
  };
};

type GatewayNativeAuthStatusOptions = {
  env?: Record<string, string | undefined>;
  now?: () => Date;
  nativeProbe?: () => Promise<unknown>;
  isNativeDisabled?: () => boolean;
  cwd?: string;
};

type GatewayNativeDeviceAccessRepairOptions = {
  nativeProbe?: () => Promise<unknown>;
  approveLatest?: () => Promise<unknown>;
  readDeviceAuthToken?: () => Promise<GatewayDeviceAuthToken | null>;
};

type GatewayDeviceAuthToken = {
  token: string;
  scopes: string[];
};

function invalidateSettingsSnapshot() {
  invalidateMissionControlSnapshotCache();
  clearMissionControlRuntimeHistoryCache();
}

export async function updateGatewayRemoteUrl(input: { gatewayUrl?: string | null }) {
  const gatewayUrl = normalizeGatewayRemoteUrl(input.gatewayUrl);

  if (gatewayUrl) {
    await getOpenClawAdapter().setConfig(GATEWAY_REMOTE_URL_CONFIG_KEY, gatewayUrl);
  } else if (await getOpenClawAdapter().hasConfig(GATEWAY_REMOTE_URL_CONFIG_KEY)) {
    await getOpenClawAdapter().unsetConfig(GATEWAY_REMOTE_URL_CONFIG_KEY);
  }

  invalidateSettingsSnapshot();

  return getMissionControlSnapshot({ force: true });
}

export async function updateWorkspaceRoot(input: { workspaceRoot?: string | null }) {
  const workspaceRoot = normalizeWorkspaceRoot(input.workspaceRoot);
  const settings = await readMissionControlSettings();

  await writeMissionControlSettings({
    ...(workspaceRoot ? { workspaceRoot } : {}),
    ...(settings.runtimePreflight ? { runtimePreflight: settings.runtimePreflight } : {})
  });

  invalidateSettingsSnapshot();

  return getMissionControlSnapshot({ force: true });
}

export async function getGatewayNativeAuthStatus(
  options: GatewayNativeAuthStatusOptions = {}
): Promise<GatewayNativeAuthStatus> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const checkedAt = (options.now ?? (() => new Date()))().toISOString();
  const adapter = getOpenClawAdapter();
  const [
    mode,
    authToken,
    authPassword,
    remoteToken,
    remotePassword
  ] = await Promise.all([
    readConfigString("gateway.auth.mode"),
    readConfigSecretState("gateway.auth.token"),
    readConfigSecretState("gateway.auth.password"),
    readConfigSecretState("gateway.remote.token"),
    readConfigSecretState("gateway.remote.password")
  ]);
  const disabledByEnv = (options.isNativeDisabled ?? isCliGatewayClientForcedByEnv)();
  const envToken = Boolean(
    env.AGENTOS_OPENCLAW_GATEWAY_TOKEN?.trim() || env.OPENCLAW_GATEWAY_TOKEN?.trim()
  );
  const envPassword = Boolean(
    env.AGENTOS_OPENCLAW_GATEWAY_PASSWORD?.trim() || env.OPENCLAW_GATEWAY_PASSWORD?.trim()
  );
  const config = {
    authToken,
    authPassword,
    remoteToken,
    remotePassword
  };
  const envFile = await readGatewayAuthEnvFileState(cwd);

  if (disabledByEnv) {
    return {
      mode,
      env: {
        token: envToken,
        password: envPassword
      },
      config,
      native: {
        ok: false,
        checkedAt,
        kind: "disabled",
        issue: "Native OpenClaw Gateway WS is disabled by environment configuration.",
        disabledByEnv: true
      },
      envFile,
      recommendation:
        "Unset AGENTOS_OPENCLAW_GATEWAY_CLIENT/OPENCLAW_GATEWAY_CLIENT=cli or AGENTOS_OPENCLAW_NATIVE_WS=0, then restart AgentOS."
    };
  }

  try {
    await (options.nativeProbe ?? (() =>
      new NativeWsOpenClawGatewayClient().callNative("status", {}, {
        timeoutMs: GATEWAY_NATIVE_AUTH_CHECK_TIMEOUT_MS
      })))();

    return {
      mode,
      env: {
        token: envToken,
        password: envPassword
      },
      config,
      native: {
        ok: true,
        checkedAt,
        kind: null,
        issue: null,
        disabledByEnv: false
      },
      envFile,
      recommendation: "Native OpenClaw Gateway WS auth is ready."
    };
  } catch (error) {
    const issue = error instanceof Error ? error.message : String(error || "Native Gateway auth check failed.");
    const kind = readGatewayIssueKind(error, issue);

    return {
      mode,
      env: {
        token: envToken,
        password: envPassword
      },
      config,
      native: {
        ok: false,
        checkedAt,
        kind,
        issue,
        disabledByEnv: false
      },
      envFile,
      recommendation: buildGatewayNativeAuthRecommendation({
        kind,
        envToken,
        envPassword,
        config
      })
    };
  }

  async function readConfigString(path: string) {
    try {
      const value = await adapter.getConfig<unknown>(path, {
        timeoutMs: GATEWAY_NATIVE_AUTH_CHECK_TIMEOUT_MS
      });
      return typeof value === "string" && value.trim() ? value.trim() : null;
    } catch {
      return null;
    }
  }

  async function readConfigSecretState(path: string): Promise<GatewayAuthSecretState> {
    try {
      const value = await adapter.getConfig<unknown>(path, {
        timeoutMs: GATEWAY_NATIVE_AUTH_CHECK_TIMEOUT_MS
      });
      return classifyGatewaySecret(value);
    } catch {
      return "unknown";
    }
  }
}

export async function saveGatewayNativeAuthCredential(input: {
  kind: GatewayNativeAuthCredentialKind;
  value: string;
  cwd?: string;
}) {
  const value = input.value.trim();
  if (!value) {
    throw new Error("Gateway token/password is required.");
  }

  if (value.length > 4096) {
    throw new Error("Gateway token/password is too long.");
  }

  const envFilePath = join(input.cwd ?? process.cwd(), GATEWAY_AUTH_ENV_FILE_NAME);
  const existing = await readOptionalText(envFilePath);
  const next = updateEnvFileCredential(existing, input.kind, value);

  await writeFile(envFilePath, next, "utf8");

  if (input.kind === "token") {
    process.env[GATEWAY_AUTH_TOKEN_ENV_NAME] = value;
    delete process.env[GATEWAY_AUTH_PASSWORD_ENV_NAME];
  } else {
    process.env[GATEWAY_AUTH_PASSWORD_ENV_NAME] = value;
    delete process.env[GATEWAY_AUTH_TOKEN_ENV_NAME];
  }

  return {
    envFile: GATEWAY_AUTH_ENV_FILE_NAME,
    activeEnvName: input.kind === "token" ? GATEWAY_AUTH_TOKEN_ENV_NAME : GATEWAY_AUTH_PASSWORD_ENV_NAME,
    restartRecommended: true
  };
}

export async function generateGatewayNativeAuthToken(input: { cwd?: string } = {}) {
  const token = randomBytes(32).toString("base64url");

  await getOpenClawAdapter().setConfig(GATEWAY_AUTH_MODE_CONFIG_KEY, "token", {
    timeoutMs: GATEWAY_NATIVE_AUTH_CHECK_TIMEOUT_MS
  });
  await getOpenClawAdapter().setConfig(GATEWAY_AUTH_TOKEN_CONFIG_KEY, token, {
    timeoutMs: GATEWAY_NATIVE_AUTH_CHECK_TIMEOUT_MS
  });

  const saved = await saveGatewayNativeAuthCredential({
    kind: "token",
    value: token,
    cwd: input.cwd
  });

  let restarted = false;
  let restartIssue: string | null = null;

  try {
    await getOpenClawAdapter().controlGateway("restart", {
      timeoutMs: 20_000
    });
    restarted = true;
    await delay(GATEWAY_AUTH_RESTART_SETTLE_MS);
  } catch (error) {
    restartIssue = error instanceof Error ? error.message : "Gateway restart failed.";
  }

  invalidateSettingsSnapshot();

  return {
    envFile: saved.envFile,
    activeEnvName: saved.activeEnvName,
    restarted,
    restartIssue
  };
}

export async function repairGatewayNativeDeviceAccess(
  options: GatewayNativeDeviceAccessRepairOptions = {}
): Promise<GatewayNativeDeviceAccessRepairResult> {
  try {
    await (options.nativeProbe ?? (() =>
      new NativeWsOpenClawGatewayClient().callNative("status", {}, {
        timeoutMs: GATEWAY_NATIVE_AUTH_CHECK_TIMEOUT_MS
      })))();
  } catch {
    // A failed native probe is still useful here because OpenClaw records the
    // pending scope-upgrade request that devices approve can complete.
  }

  let approvalIssue: string | null = null;
  let deviceToken: GatewayDeviceAuthToken | null = null;
  let result: GatewayNativeDeviceAccessRepairResult = {
    approved: false,
    requestId: null,
    deviceId: null,
    scopes: [],
    envSynced: false,
    activeEnvName: null,
    approvalIssue: null
  };

  try {
    const payload = await (options.approveLatest ?? approveLatestOpenClawDeviceAccess)();
    result = normalizeGatewayDeviceApprovePayload(payload);
    deviceToken = await (options.readDeviceAuthToken ?? readLocalOpenClawDeviceAuthToken)();
  } catch (error) {
    approvalIssue = error instanceof Error ? error.message : "OpenClaw device approval failed.";
    deviceToken = await (options.readDeviceAuthToken ?? readLocalOpenClawDeviceAuthToken)();

    if (!deviceToken?.token) {
      throw error;
    }

    result = {
      ...result,
      scopes: deviceToken.scopes
    };
  }

  invalidateSettingsSnapshot();

  return {
    ...result,
    envSynced: false,
    activeEnvName: null,
    approvalIssue
  };
}

async function approveLatestOpenClawDeviceAccess() {
  return runOpenClawJson<GatewayDeviceApprovePayload>(
    ["devices", "approve", "--latest", "--json"],
    { timeoutMs: GATEWAY_DEVICE_ACCESS_REPAIR_TIMEOUT_MS }
  );
}

function updateEnvFileCredential(
  content: string,
  kind: GatewayNativeAuthCredentialKind,
  value: string
) {
  const activeName = kind === "token" ? GATEWAY_AUTH_TOKEN_ENV_NAME : GATEWAY_AUTH_PASSWORD_ENV_NAME;
  const inactiveName = kind === "token" ? GATEWAY_AUTH_PASSWORD_ENV_NAME : GATEWAY_AUTH_TOKEN_ENV_NAME;
  const nextLine = `${activeName}=${quoteEnvValue(value)}`;
  const lines = content.split(/\r?\n/);
  const output: string[] = [];
  let wroteActive = false;

  for (const line of lines) {
    if (!line.trim()) {
      output.push(line);
      continue;
    }

    const key = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1];
    if (key === activeName) {
      if (!wroteActive) {
        output.push(nextLine);
        wroteActive = true;
      }
      continue;
    }

    if (key === inactiveName) {
      continue;
    }

    output.push(line);
  }

  if (!wroteActive) {
    const needsSpacer = output.some((line) => line.trim()) && output.at(-1)?.trim();
    if (needsSpacer) {
      output.push("");
    }
    output.push("# OpenClaw Gateway native WebSocket auth for AgentOS");
    output.push(nextLine);
  }

  return `${output.join("\n").replace(/\n+$/, "")}\n`;
}

function quoteEnvValue(value: string) {
  return JSON.stringify(value);
}

async function readGatewayAuthEnvFileState(cwd: string): Promise<GatewayNativeAuthStatus["envFile"]> {
  const envFilePath = join(cwd, GATEWAY_AUTH_ENV_FILE_NAME);
  const content = await readOptionalText(envFilePath);
  const gitignore = await readOptionalText(join(cwd, ".gitignore"));

  return {
    path: GATEWAY_AUTH_ENV_FILE_NAME,
    token: hasEnvFileKey(content, GATEWAY_AUTH_TOKEN_ENV_NAME),
    password: hasEnvFileKey(content, GATEWAY_AUTH_PASSWORD_ENV_NAME),
    gitignored: /^\.env\*?\.local$/m.test(gitignore) || /^\.env\.local$/m.test(gitignore)
  };
}

async function readOptionalText(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function hasEnvFileKey(content: string, key: string) {
  return new RegExp(`^\\s*${key}\\s*=`, "m").test(content);
}

function classifyGatewaySecret(value: unknown): GatewayAuthSecretState {
  if (value === null || value === undefined) {
    return "missing";
  }

  if (typeof value !== "string") {
    return "present";
  }

  const normalized = value.trim();
  if (!normalized) {
    return "missing";
  }

  return normalized === REDACTED_OPENCLAW_SECRET ? "redacted" : "present";
}

function readGatewayIssueKind(error: unknown, issue: string): GatewayNativeAuthIssueKind {
  const kind = (error as { kind?: unknown } | null)?.kind;
  if (
    kind === "auth" ||
    kind === "malformed-response" ||
    kind === "scope-limited" ||
    kind === "timeout" ||
    kind === "unreachable" ||
    kind === "unknown"
  ) {
    return kind;
  }

  if (/auth|token|password|unauthorized|forbidden/i.test(issue)) {
    return "auth";
  }

  if (/scope|permission|not allowed/i.test(issue)) {
    return "scope-limited";
  }

  if (/invalid json|malformed|schema|payload/i.test(issue)) {
    return "malformed-response";
  }

  if (/timed out|timeout/i.test(issue)) {
    return "timeout";
  }

  if (/connect|closed|unreachable|websocket/i.test(issue)) {
    return "unreachable";
  }

  return "unknown";
}

function buildGatewayNativeAuthRecommendation(input: {
  kind: GatewayNativeAuthIssueKind;
  envToken: boolean;
  envPassword: boolean;
  config: GatewayNativeAuthStatus["config"];
}) {
  const hasRedactedSecret = Object.values(input.config).includes("redacted");
  const hasEnvSecret = input.envToken || input.envPassword;

  if (input.kind === "auth" && hasRedactedSecret && !hasEnvSecret) {
    return "Set AGENTOS_OPENCLAW_GATEWAY_TOKEN/PASSWORD or OPENCLAW_GATEWAY_TOKEN/PASSWORD in the AgentOS process environment, then restart AgentOS.";
  }

  if (input.kind === "auth") {
    return "Verify the Gateway token/password exported to the AgentOS process, then restart AgentOS.";
  }

  if (input.kind === "unreachable" || input.kind === "timeout") {
    return "Start or restart the OpenClaw Gateway, then test native auth again.";
  }

  if (input.kind === "scope-limited") {
    return "Repair the local AgentOS device access request so native Gateway WS can use operator scopes. No manual secret entry is required.";
  }

  if (input.kind === "malformed-response") {
    return "Update OpenClaw or continue using CLI fallback until the Gateway contract matches AgentOS.";
  }

  return "Review Gateway diagnostics and continue using CLI fallback until native WS can authenticate.";
}

function normalizeGatewayDeviceApprovePayload(input: unknown): GatewayNativeDeviceAccessRepairResult {
  const payload = input as GatewayDeviceApprovePayload | null;
  const device = payload && typeof payload === "object" ? payload.device : null;
  const scopes = readStringArray(device?.approvedScopes).length
    ? readStringArray(device?.approvedScopes)
    : readStringArray(device?.scopes);

  return {
    approved: Boolean(device),
    requestId: readOptionalString(payload?.requestId),
    deviceId: readOptionalString(device?.deviceId),
    scopes,
    envSynced: false,
    activeEnvName: null,
    approvalIssue: null
  };
}

async function readLocalOpenClawDeviceAuthToken(): Promise<GatewayDeviceAuthToken | null> {
  const content = await readOptionalText(join(homedir(), ".openclaw", "identity", "device-auth.json"));

  if (!content.trim()) {
    return null;
  }

  try {
    const payload = JSON.parse(content) as {
      tokens?: {
        operator?: {
          token?: unknown;
          scopes?: unknown;
        };
      };
    };
    const token = readOptionalString(payload.tokens?.operator?.token);

    if (!token) {
      return null;
    }

    return {
      token,
      scopes: readStringArray(payload.tokens?.operator?.scopes)
    };
  } catch {
    return null;
  }
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()));
}
