import "server-only";

import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  AGENTOS_GATEWAY_AUTH_STATE_FILE,
  AGENTOS_RUNTIME_DIR_ENV,
  isAgentOsPackageRuntime,
  readAgentOsGatewayAuthCredential,
  resolveAgentOsGatewayAuthStatePath,
  saveAgentOsGatewayAuthCredential
} from "@/lib/agentos/runtime-auth";
import { getOpenClawAdapter, type OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
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
  isCliGatewayClientForcedByEnv
} from "@/lib/openclaw/client/native-ws-gateway-policy";
import {
  createOpenClawGatewayClient,
  resetOpenClawGatewayClient
} from "@/lib/openclaw/client/gateway-client-factory";
import { getOpenClawLifecycleService } from "@/lib/openclaw/lifecycle/service";
import { isOpenClawInvalidConfigError } from "@/lib/openclaw/command-failure";
import { OPENCLAW_OPERATOR_SCOPES } from "@/lib/openclaw/identity/contract";
import type { OpenClawDeviceApprovePayload } from "@/lib/openclaw/client/gateway-client";
import type { OpenClawCommandOptions } from "@/lib/openclaw/client/types";
import type {
  GatewayAuthSecretState,
  GatewayNativeAuthCredentialKind,
  GatewayNativeDeviceAccessRepairResult,
  GatewayNativeAuthIssueKind,
  GatewayNativeAuthStatus
} from "@/lib/openclaw/gateway-auth";
import { OPENCLAW_DEFAULT_GATEWAY_BIND_MODE } from "@/lib/openclaw/gateway-defaults";
import { redactErrorMessage } from "@/lib/security/redaction";
import {
  OPENCLAW_SESSION_SECURITY_CONFIG_PATHS,
  normalizeAgentToAgentAllow,
  readAgentOsSessionSecurityPosture,
  type AgentOsSessionSecurityPosture,
  type OpenClawSessionToolsVisibility
} from "@/lib/openclaw/domains/session-security-policy";

const GATEWAY_REMOTE_URL_CONFIG_KEY = "gateway.remote.url";
const GATEWAY_BIND_CONFIG_KEY = "gateway.bind";
const REDACTED_OPENCLAW_SECRET = "__OPENCLAW_REDACTED__";
const GATEWAY_NATIVE_AUTH_CHECK_TIMEOUT_MS = 2_500;
const GATEWAY_AUTH_CONFIG_MUTATION_TIMEOUT_MS = 30_000;
const GATEWAY_AUTH_ENV_FILE_NAME = ".env.local";
const GATEWAY_AUTH_TOKEN_ENV_NAME = "AGENTOS_OPENCLAW_GATEWAY_TOKEN";
const GATEWAY_AUTH_PASSWORD_ENV_NAME = "AGENTOS_OPENCLAW_GATEWAY_PASSWORD";
const GATEWAY_AUTH_MODE_CONFIG_KEY = "gateway.auth.mode";
const GATEWAY_AUTH_TOKEN_CONFIG_KEY = "gateway.auth.token";
const GATEWAY_AUTH_RESTART_SETTLE_MS = 1_250;
const GATEWAY_AUTH_RESTART_VERIFY_DELAYS_MS = [0, 500, 1_000, 1_500, 2_500, 3_500];
const GATEWAY_DEVICE_ACCESS_REPAIR_TIMEOUT_MS = 10_000;
const SESSION_TOOLS_VISIBILITY_CONFIG_KEY = OPENCLAW_SESSION_SECURITY_CONFIG_PATHS.sessionsVisibility;
const AGENT_TO_AGENT_ENABLED_CONFIG_KEY = OPENCLAW_SESSION_SECURITY_CONFIG_PATHS.agentToAgentEnabled;
const AGENT_TO_AGENT_ALLOW_CONFIG_KEY = OPENCLAW_SESSION_SECURITY_CONFIG_PATHS.agentToAgentAllow;
const GATEWAY_DEVICE_ACCESS_REQUIRED_SCOPES = [
  "operator.admin",
  "operator.read",
  "operator.write",
  "operator.approvals",
  "operator.questions",
  "operator.pairing",
  "operator.talk",
  "operator.talk.secrets"
];

type GatewayNativeAuthStatusOptions = {
  env?: Record<string, string | undefined>;
  now?: () => Date;
  nativeProbe?: () => Promise<unknown>;
  isNativeDisabled?: () => boolean;
  cwd?: string;
};

export async function getGatewayBindMode(
  adapter: OpenClawAdapter = getOpenClawAdapter()
): Promise<string> {
  const value = await adapter.getConfig<unknown>(GATEWAY_BIND_CONFIG_KEY, {
    timeoutMs: GATEWAY_NATIVE_AUTH_CHECK_TIMEOUT_MS
  });

  return typeof value === "string" && value.trim() ? value.trim() : OPENCLAW_DEFAULT_GATEWAY_BIND_MODE;
}

type GatewayNativeDeviceAccessRepairOptions = {
  nativeProbe?: () => Promise<unknown>;
  approveLatest?: (requiredScopes: string[], options?: OpenClawCommandOptions) => Promise<unknown>;
  readDeviceAuthToken?: () => Promise<GatewayDeviceAuthToken | null>;
  requiredScopes?: string[];
  gatewayOptions?: OpenClawCommandOptions;
};

type GatewayDeviceAuthToken = {
  token: string;
  scopes: string[];
};

type GatewayAuthConfigSnapshot = {
  config: Record<string, unknown>;
  resolved: Record<string, unknown>;
};

type GatewayAuthConfigSnapshotResult = {
  snapshot: GatewayAuthConfigSnapshot | null;
  invalidConfig: boolean;
};

type GatewayConfigCommandResult = {
  stdout?: string;
  metadata?: Record<string, unknown>;
};

export type CrossAgentMessageSettings = {
  enabled: boolean;
  sessionsVisibility: OpenClawSessionToolsVisibility;
  agentToAgentEnabled: boolean;
  allow: string[];
  source: "openclaw-config";
  securityPosture: AgentOsSessionSecurityPosture;
};

type CrossAgentMessageSettingsUpdateInput = {
  enabled: boolean;
  targetAgentId?: string | null;
  knownTargetAgentIds?: string[];
};

function invalidateSettingsSnapshot() {
  invalidateMissionControlSnapshotCache();
  clearMissionControlRuntimeHistoryCache();
}

export async function updateGatewayRemoteUrl(
  input: { gatewayUrl?: string | null },
  options: OpenClawCommandOptions = {}
) {
  const gatewayUrl = normalizeGatewayRemoteUrl(input.gatewayUrl);

  if (gatewayUrl) {
    await getOpenClawAdapter().setConfig(GATEWAY_REMOTE_URL_CONFIG_KEY, gatewayUrl, options);
  } else if (await getOpenClawAdapter().hasConfig(GATEWAY_REMOTE_URL_CONFIG_KEY)) {
    await getOpenClawAdapter().unsetConfig(GATEWAY_REMOTE_URL_CONFIG_KEY, options);
  }

  invalidateSettingsSnapshot();

  return getMissionControlSnapshot({ force: true });
}

export async function updateWorkspaceRoot(input: { workspaceRoot?: string | null }) {
  const workspaceRoot = normalizeWorkspaceRoot(input.workspaceRoot);
  const settings = await readMissionControlSettings();
  const nextSettings = {
    ...settings,
    ...(workspaceRoot ? { workspaceRoot } : {})
  };

  if (!workspaceRoot) {
    delete nextSettings.workspaceRoot;
  }

  await writeMissionControlSettings(nextSettings);

  invalidateSettingsSnapshot();

  return getMissionControlSnapshot({ force: true });
}

export async function getCrossAgentMessageSettings(): Promise<CrossAgentMessageSettings> {
  const adapter = getOpenClawAdapter();
  const securityPosture = await readAgentOsSessionSecurityPosture({
    adapter,
    commandOptions: { timeoutMs: 5_000 }
  });
  const normalizedVisibility = securityPosture.sessionsVisibility ?? "tree";
  const normalizedAgentToAgentEnabled = securityPosture.agentToAgentEnabled === true;
  const normalizedAllow = securityPosture.allow;

  return {
    enabled: securityPosture.crossAgentAccess === "explicit-allowlist" || securityPosture.crossAgentAccess === "broad-allow",
    sessionsVisibility: normalizedVisibility,
    agentToAgentEnabled: normalizedAgentToAgentEnabled,
    allow: normalizedAllow,
    source: "openclaw-config",
    securityPosture
  };
}

export async function updateCrossAgentMessageSettings(input: CrossAgentMessageSettingsUpdateInput): Promise<CrossAgentMessageSettings> {
  const adapter = getOpenClawAdapter();
  const targetAgentId = readOptionalString(input.targetAgentId);

  if (targetAgentId) {
    const current = await getCrossAgentMessageSettings();
    const knownTargetAgentIds = normalizeAgentToAgentAllow(input.knownTargetAgentIds).filter((agentId) => agentId !== "*");
    const nextAllow = resolveTargetAgentAllowList({
      allow: current.allow,
      enabled: input.enabled,
      knownTargetAgentIds,
      targetAgentId,
      wildcardActive: false
    });

    if (nextAllow.length > 0) {
      await adapter.setConfig(SESSION_TOOLS_VISIBILITY_CONFIG_KEY, "all", { timeoutMs: 10_000 });
      await adapter.setConfig(AGENT_TO_AGENT_ALLOW_CONFIG_KEY, nextAllow, { strictJson: true, timeoutMs: 10_000 });
      await adapter.setConfig(AGENT_TO_AGENT_ENABLED_CONFIG_KEY, true, { strictJson: true, timeoutMs: 10_000 });
    } else {
      await adapter.setConfig(AGENT_TO_AGENT_ENABLED_CONFIG_KEY, false, { strictJson: true, timeoutMs: 10_000 });
      await adapter.setConfig(AGENT_TO_AGENT_ALLOW_CONFIG_KEY, [], { strictJson: true, timeoutMs: 10_000 });
      await adapter.setConfig(SESSION_TOOLS_VISIBILITY_CONFIG_KEY, "tree", { timeoutMs: 10_000 });
    }

    invalidateSettingsSnapshot();

    return getCrossAgentMessageSettings();
  }

  if (input.enabled) {
    throw new Error("An explicit target agent is required before enabling cross-agent messaging.");
  } else {
    await adapter.setConfig(AGENT_TO_AGENT_ENABLED_CONFIG_KEY, false, { strictJson: true, timeoutMs: 10_000 });
    await adapter.setConfig(AGENT_TO_AGENT_ALLOW_CONFIG_KEY, [], { strictJson: true, timeoutMs: 10_000 });
    await adapter.setConfig(SESSION_TOOLS_VISIBILITY_CONFIG_KEY, "tree", { timeoutMs: 10_000 });
  }

  invalidateSettingsSnapshot();

  return getCrossAgentMessageSettings();
}

export async function getGatewayNativeAuthStatus(
  options: GatewayNativeAuthStatusOptions = {}
): Promise<GatewayNativeAuthStatus> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const checkedAt = (options.now ?? (() => new Date()))().toISOString();
  const adapter = getOpenClawAdapter();
  const configSnapshotResult = await readGatewayAuthConfigSnapshot(adapter);
  const configSnapshot = configSnapshotResult.snapshot;
  const [
    mode,
    authToken,
    authPassword,
    remoteToken,
    remotePassword
  ] = configSnapshot
    ? [
        readConfigStringFromSnapshot(configSnapshot, "gateway.auth.mode"),
        classifyGatewaySecret(readConfigValueFromSnapshot(configSnapshot, "gateway.auth.token")),
        classifyGatewaySecret(readConfigValueFromSnapshot(configSnapshot, "gateway.auth.password")),
        classifyGatewaySecret(readConfigValueFromSnapshot(configSnapshot, "gateway.remote.token")),
        classifyGatewaySecret(readConfigValueFromSnapshot(configSnapshot, "gateway.remote.password"))
      ]
    : configSnapshotResult.invalidConfig
      ? [
          null,
          "unknown" as GatewayAuthSecretState,
          "unknown" as GatewayAuthSecretState,
          "unknown" as GatewayAuthSecretState,
          "unknown" as GatewayAuthSecretState
        ]
    : await Promise.all([
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
    if (options.nativeProbe) {
      await options.nativeProbe();
    } else {
      const client = createOpenClawGatewayClient();
      try {
        await client.callNative("status", {}, {
          timeoutMs: GATEWAY_NATIVE_AUTH_CHECK_TIMEOUT_MS
        });
      } finally {
        client.close("gateway auth status probe completed");
      }
    }

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
    const issue = redactErrorMessage(error, "Native Gateway auth check failed.");
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

  let savedCredentialPath = AGENTOS_GATEWAY_AUTH_STATE_FILE;

  if (shouldPersistGatewayAuthStateFile()) {
    await saveAgentOsGatewayAuthCredential({
      kind: input.kind,
      value
    });
  } else {
    savedCredentialPath = GATEWAY_AUTH_ENV_FILE_NAME;
  }

  if (!isAgentOsPackageRuntime()) {
    const envFilePath = join(input.cwd ?? process.cwd(), GATEWAY_AUTH_ENV_FILE_NAME);
    const existing = await readOptionalText(envFilePath);
    const next = updateEnvFileCredential(existing, input.kind, value);

    await writeFile(envFilePath, next, {
      encoding: "utf8",
      mode: 0o600
    });
    await chmod(envFilePath, 0o600);
    savedCredentialPath = GATEWAY_AUTH_ENV_FILE_NAME;
  }

  if (input.kind === "token") {
    process.env[GATEWAY_AUTH_TOKEN_ENV_NAME] = value;
    delete process.env[GATEWAY_AUTH_PASSWORD_ENV_NAME];
  } else {
    process.env[GATEWAY_AUTH_PASSWORD_ENV_NAME] = value;
    delete process.env[GATEWAY_AUTH_TOKEN_ENV_NAME];
  }

  resetOpenClawGatewayClient("gateway auth credential updated");

  return {
    envFile: savedCredentialPath,
    activeEnvName: input.kind === "token" ? GATEWAY_AUTH_TOKEN_ENV_NAME : GATEWAY_AUTH_PASSWORD_ENV_NAME,
    restartRecommended: true
  };
}

function shouldPersistGatewayAuthStateFile() {
  return isAgentOsPackageRuntime() || Boolean(process.env[AGENTOS_RUNTIME_DIR_ENV]?.trim());
}

export async function generateGatewayNativeAuthToken(input: {
  cwd?: string;
  verifyNativeAuth?: (token: string) => Promise<unknown>;
  verifyDelaysMs?: readonly number[];
} = {}) {
  const token = randomBytes(32).toString("base64url");

  const modeMutation = await getOpenClawAdapter().setConfig(GATEWAY_AUTH_MODE_CONFIG_KEY, "token", {
    timeoutMs: GATEWAY_AUTH_CONFIG_MUTATION_TIMEOUT_MS
  });
  const tokenMutation = await getOpenClawAdapter().setConfig(GATEWAY_AUTH_TOKEN_CONFIG_KEY, token, {
    timeoutMs: GATEWAY_AUTH_CONFIG_MUTATION_TIMEOUT_MS
  });

  let restarted = false;
  let restartIssue: string | null = null;
  let verified = false;
  let verificationIssue: string | null = null;
  const restartRequired = shouldRestartAfterGatewayConfigMutations([
    [GATEWAY_AUTH_MODE_CONFIG_KEY, modeMutation],
    [GATEWAY_AUTH_TOKEN_CONFIG_KEY, tokenMutation]
  ]);

  if (restartRequired) {
    const restartResult = await restartGatewayAfterAuthTokenRotation();
    restarted = restartResult.restarted;
    restartIssue = restartResult.issue;
  }

  verificationIssue = await waitForGeneratedGatewayTokenAuth(token, input.verifyNativeAuth, input.verifyDelaysMs);

  if (verificationIssue && restartRequired) {
    const cycleResult = await cycleGatewayAfterAuthTokenRotation();
    restarted = restarted || cycleResult.restarted;
    restartIssue = appendGatewayAuthIssue(restartIssue, cycleResult.issue);

    if (cycleResult.restarted) {
      verificationIssue = await waitForGeneratedGatewayTokenAuth(token, input.verifyNativeAuth, input.verifyDelaysMs);
    }
  }

  verified = !verificationIssue;
  // Persist only after the Gateway has restarted and accepted the new token.
  // In local Next.js development, changing .env.local reloads the server and
  // would otherwise interrupt this request before the lifecycle repair runs.
  const saved = await saveGatewayNativeAuthCredential({
    kind: "token",
    value: token,
    cwd: input.cwd
  });
  invalidateSettingsSnapshot();

  return {
    envFile: saved.envFile,
    activeEnvName: saved.activeEnvName,
    restartRequired,
    restarted,
    restartIssue,
    verified,
    verificationIssue
  };
}

async function restartGatewayAfterAuthTokenRotation() {
  try {
    await getOpenClawLifecycleService().restart();
    resetOpenClawGatewayClient("gateway auth token rotated");
    await delay(GATEWAY_AUTH_RESTART_SETTLE_MS);

    return {
      restarted: true,
      issue: null
    };
  } catch (error) {
    return {
      restarted: false,
      issue: redactErrorMessage(error, "Gateway forced restart failed.")
    };
  }
}

async function cycleGatewayAfterAuthTokenRotation() {
  let issue: string | null = null;

  try {
    await getOpenClawLifecycleService().stop();
    await delay(750);
  } catch (error) {
    issue = redactErrorMessage(error, "Gateway stop after token rotation failed.");
  }

  try {
    await getOpenClawLifecycleService().start();
    resetOpenClawGatewayClient("gateway auth token rotation stop/start completed");
    await delay(GATEWAY_AUTH_RESTART_SETTLE_MS);

    return {
      restarted: true,
      issue
    };
  } catch (error) {
    return {
      restarted: false,
      issue: appendGatewayAuthIssue(
        issue,
        redactErrorMessage(error, "Gateway start after token rotation failed.")
      )
    };
  }
}

function appendGatewayAuthIssue(base: string | null, next: string | null) {
  if (!next?.trim()) {
    return base;
  }

  return base ? `${base}\n${next}` : next;
}

async function waitForGeneratedGatewayTokenAuth(
  token: string,
  verifyNativeAuth: ((token: string) => Promise<unknown>) | undefined,
  verifyDelaysMs: readonly number[] = GATEWAY_AUTH_RESTART_VERIFY_DELAYS_MS
) {
  let issue: string | null = null;
  const verify = verifyNativeAuth ?? (async (value: string) => {
    const client = createOpenClawGatewayClient({
      token: value,
      timeoutMs: GATEWAY_NATIVE_AUTH_CHECK_TIMEOUT_MS
    });
    try {
      return await client.callNative("status", {}, {
        timeoutMs: GATEWAY_NATIVE_AUTH_CHECK_TIMEOUT_MS
      });
    } finally {
      client.close("gateway auth token verification completed");
    }
  });

  for (const delayMs of verifyDelaysMs.length > 0 ? verifyDelaysMs : [0]) {
    if (delayMs > 0) {
      await delay(delayMs);
    }

    try {
      await verify(token);
      return null;
    } catch (error) {
      issue = redactErrorMessage(error, "Gateway auth verification failed.");
    }
  }

  return issue;
}

export async function repairGatewayNativeDeviceAccess(
  options: GatewayNativeDeviceAccessRepairOptions = {}
): Promise<GatewayNativeDeviceAccessRepairResult> {
  const readDeviceAuthToken = options.readDeviceAuthToken ?? readLocalOpenClawDeviceAuthToken;
  const requiredScopes = normalizeGatewayRepairScopes(options.requiredScopes);
  const nativeProbe = options.nativeProbe ?? assertGatewayNativeConfigMutationAccess;
  let probeSucceeded = false;

  try {
    await nativeProbe();
    probeSucceeded = true;
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
    const payload = await (options.approveLatest ?? approveLatestOpenClawDeviceAccess)(requiredScopes, options.gatewayOptions);
    result = normalizeGatewayDeviceApprovePayload(payload);
    deviceToken = await syncLocalOpenClawDeviceAuthTokenFromPairing() ?? await readDeviceAuthToken();
  } catch (error) {
    approvalIssue = redactErrorMessage(error, "OpenClaw device approval failed.");
    deviceToken = await syncLocalOpenClawDeviceAuthTokenFromPairing() ?? await readDeviceAuthToken();

    if (!deviceToken?.token || !hasGatewayDeviceAccessRequiredScopes(deviceToken.scopes, requiredScopes)) {
      if (!probeSucceeded) {
        throw error;
      }

      result = {
        ...result,
        approved: true,
        scopes: requiredScopes
      };
    } else {
      result = {
        ...result,
        approved: true,
        scopes: deviceToken.scopes
      };
    }
  }

  if (!result.approved && probeSucceeded && hasGatewayDeviceAccessRequiredScopes(deviceToken?.scopes ?? [], requiredScopes)) {
    result = {
      ...result,
      approved: true,
      scopes: deviceToken?.scopes ?? result.scopes
    };
  }

  if (result.approved && hasGatewayDeviceAccessRequiredScopes(deviceToken?.scopes ?? [], requiredScopes)) {
    result = {
      ...result,
      scopes: deviceToken?.scopes ?? result.scopes
    };
  }

  if (result.approved && !hasGatewayDeviceAccessRequiredScopes(deviceToken?.scopes ?? result.scopes, requiredScopes)) {
    let nativeAccessVerified = probeSucceeded;

    if (!nativeAccessVerified) {
      try {
        await nativeProbe();
        nativeAccessVerified = true;
      } catch {
        nativeAccessVerified = false;
      }
    }

    if (!nativeAccessVerified) {
      throw new Error(
        "OpenClaw device access was approved, but the local CLI device token was not updated with the required operator scopes."
      );
    }

    result = {
      ...result,
      scopes: requiredScopes
    };
    approvalIssue ??= "OpenClaw approved native Gateway access, but the local CLI device token has not reported every requested operator scope yet.";
  }

  resetOpenClawGatewayClient("gateway device access repaired");
  invalidateSettingsSnapshot();

  return {
    ...result,
    envSynced: false,
    activeEnvName: null,
    approvalIssue
  };
}

async function approveLatestOpenClawDeviceAccess(
  requiredScopes: string[],
  gatewayOptions: OpenClawCommandOptions = {}
) {
  return getOpenClawAdapter().approveDeviceAccess(
    { latest: true, scopes: requiredScopes },
    { ...gatewayOptions, timeoutMs: GATEWAY_DEVICE_ACCESS_REPAIR_TIMEOUT_MS }
  );
}

export async function assertGatewayNativeConfigMutationAccess() {
  const client = createOpenClawGatewayClient();

  try {
    return await client.callNative("config.schema.lookup", { path: "agents.entries" }, {
      timeoutMs: GATEWAY_NATIVE_AUTH_CHECK_TIMEOUT_MS
    });
  } finally {
    client.close("gateway config mutation access probe completed");
  }
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

async function readGatewayAuthConfigSnapshot(adapter: OpenClawAdapter): Promise<GatewayAuthConfigSnapshotResult> {
  try {
    const payload = await adapter.call<unknown>("config.get", {}, {
      timeoutMs: GATEWAY_NATIVE_AUTH_CHECK_TIMEOUT_MS
    });

    return {
      snapshot: normalizeGatewayConfigGetPayload(payload),
      invalidConfig: false
    };
  } catch (error) {
    return {
      snapshot: null,
      invalidConfig: isOpenClawInvalidConfigError(error)
    };
  }
}

function normalizeGatewayConfigGetPayload(payload: unknown): GatewayAuthConfigSnapshot | null {
  if (!isObjectRecord(payload)) {
    return null;
  }

  const config = isObjectRecord(payload.config) ? payload.config : null;
  const resolved = isObjectRecord(payload.resolved) ? payload.resolved : null;

  if (!config && !resolved) {
    return null;
  }

  return {
    config: config ?? {},
    resolved: resolved ?? {}
  };
}

function readConfigStringFromSnapshot(snapshot: GatewayAuthConfigSnapshot, path: string) {
  const value = readConfigValueFromSnapshot(snapshot, path);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readConfigValueFromSnapshot(snapshot: GatewayAuthConfigSnapshot, path: string) {
  const value = readConfigPath(snapshot.config, path) ?? readConfigPath(snapshot.resolved, path);
  return value === undefined ? null : value;
}

function readConfigPath(record: Record<string, unknown>, path: string) {
  if (Object.hasOwn(record, path)) {
    return record[path];
  }

  let current: unknown = record;
  for (const segment of path.split(".")) {
    if (!isObjectRecord(current) || !Object.hasOwn(current, segment)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readGatewayAuthEnvFileState(cwd: string): Promise<GatewayNativeAuthStatus["envFile"]> {
  if (isAgentOsPackageRuntime()) {
    const credential = await readAgentOsGatewayAuthCredential();

    return {
      path: resolveAgentOsGatewayAuthStatePath(),
      token: credential?.kind === "token",
      password: credential?.kind === "password",
      gitignored: true
    };
  }

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
    kind === "rate-limited" ||
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

  if (/(^|[^a-z])rate limit(?:ed)?\b|retry after|too many requests/i.test(issue)) {
    return "rate-limited";
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

  if (input.kind === "rate-limited") {
    return "Wait for the Gateway cooldown to expire, then test native auth again.";
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
  const payload = input as OpenClawDeviceApprovePayload | null;
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
  const content = await readOptionalText(join(resolveOpenClawStateDir(), "identity", "device-auth.json"));

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

async function syncLocalOpenClawDeviceAuthTokenFromPairing(): Promise<GatewayDeviceAuthToken | null> {
  const stateDir = resolveOpenClawStateDir();
  const identity = await readOptionalJson<{
    deviceId?: unknown;
  }>(join(stateDir, "identity", "device.json"));
  const deviceId = readOptionalString(identity?.deviceId);

  if (!deviceId) {
    return null;
  }

  const paired = await readOptionalJson<Record<string, {
    tokens?: {
      operator?: {
        token?: unknown;
        role?: unknown;
        scopes?: unknown;
      };
    };
  }>>(join(stateDir, "devices", "paired.json"));
  const operatorToken = paired?.[deviceId]?.tokens?.operator;
  const token = readOptionalString(operatorToken?.token);
  const scopes = readStringArray(operatorToken?.scopes);

  if (!token) {
    return null;
  }

  const authPath = join(stateDir, "identity", "device-auth.json");
  const existing = await readOptionalJson<{
    version?: unknown;
    deviceId?: unknown;
    tokens?: Record<string, unknown>;
  }>(authPath);
  const tokens = existing?.deviceId === deviceId && existing.tokens && typeof existing.tokens === "object"
    ? { ...existing.tokens }
    : {};

  tokens.operator = {
    token,
    role: readOptionalString(operatorToken?.role) ?? "operator",
    scopes,
    updatedAtMs: Date.now()
  };

  await mkdir(dirname(authPath), { recursive: true });
  await writeFile(authPath, `${JSON.stringify({
    version: 1,
    deviceId,
    tokens
  }, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await chmod(authPath, 0o600);

  return {
    token,
    scopes
  };
}

function shouldRestartAfterGatewayConfigMutations(mutations: Array<[string, GatewayConfigCommandResult]>) {
  let restartRequired = false;

  for (const [path, result] of mutations) {
    if (gatewayConfigPathMustRestart(path)) {
      return true;
    }

    const reloadKind = readGatewayConfigReloadKind(result);

    if (reloadKind === "restart") {
      return true;
    }

    if (reloadKind === "unknown" && gatewayConfigPathUsuallyRequiresRestart(path)) {
      restartRequired = true;
    }
  }

  return restartRequired;
}

function gatewayConfigPathMustRestart(path: string) {
  return path === GATEWAY_AUTH_MODE_CONFIG_KEY || path === GATEWAY_AUTH_TOKEN_CONFIG_KEY;
}

function readGatewayConfigReloadKind(result: GatewayConfigCommandResult): "restart" | "hot" | "none" | "unknown" {
  const metadata = result.metadata?.openClawConfig;
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const reloadKind = (metadata as Record<string, unknown>).reloadKind;
    if (reloadKind === "restart" || reloadKind === "hot" || reloadKind === "none") {
      return reloadKind;
    }
  }

  try {
    const parsed = JSON.parse(result.stdout || "{}") as { configMutation?: { reloadKind?: unknown } };
    const reloadKind = parsed.configMutation?.reloadKind;
    if (reloadKind === "restart" || reloadKind === "hot" || reloadKind === "none") {
      return reloadKind;
    }
  } catch {
    return "unknown";
  }

  return "unknown";
}

function gatewayConfigPathUsuallyRequiresRestart(path: string) {
  return path === "gateway.mode" || (/^gateway\./.test(path) && !/^gateway\.remote\./.test(path));
}

async function readOptionalJson<TPayload>(path: string): Promise<TPayload | null> {
  const content = await readOptionalText(path);

  if (!content.trim()) {
    return null;
  }

  try {
    return JSON.parse(content) as TPayload;
  } catch {
    return null;
  }
}

function resolveOpenClawStateDir() {
  const override = process.env.OPENCLAW_STATE_DIR?.trim();
  if (override) {
    return override.startsWith("~") ? join(homedir(), override.slice(1)) : override;
  }

  return join(homedir(), ".openclaw");
}

function normalizeGatewayRepairScopes(scopes: string[] | undefined) {
  const normalized = readStringArray(scopes).filter((scope) =>
    (OPENCLAW_OPERATOR_SCOPES as readonly string[]).includes(scope)
  );
  return normalized.length > 0 ? Array.from(new Set(normalized)).sort() : GATEWAY_DEVICE_ACCESS_REQUIRED_SCOPES;
}

function hasGatewayDeviceAccessRequiredScopes(scopes: string[], requiredScopes = GATEWAY_DEVICE_ACCESS_REQUIRED_SCOPES) {
  const available = new Set(scopes);
  return requiredScopes.every((scope) => available.has(scope));
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function resolveTargetAgentAllowList(input: {
  allow: string[];
  enabled: boolean;
  knownTargetAgentIds: string[];
  targetAgentId: string;
  wildcardActive: boolean;
}) {
  const knownTargetAgentIds = Array.from(new Set(input.knownTargetAgentIds.filter((agentId) => agentId !== input.targetAgentId)));
  const explicitAllow = input.allow.filter((agentId) => agentId !== "*");

  if (input.enabled) {
    if (input.wildcardActive && input.allow.includes("*")) {
      return ["*"];
    }

    return Array.from(new Set([...explicitAllow, input.targetAgentId])).sort();
  }

  if (input.wildcardActive && input.allow.includes("*")) {
    return knownTargetAgentIds.sort();
  }

  return explicitAllow.filter((agentId) => agentId !== input.targetAgentId).sort();
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()));
}
