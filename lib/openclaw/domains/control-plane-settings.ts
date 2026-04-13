import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { stringifyCommandFailure } from "@/lib/openclaw/command-failure";
import { runOpenClaw } from "@/lib/openclaw/cli";
import type { OpenClawRuntimeSmokeTest } from "@/lib/agentos/contracts";

const GATEWAY_REMOTE_URL_CONFIG_KEY = "gateway.remote.url";
const missionControlRootPath = path.join(process.cwd(), ".mission-control");
const missionControlSettingsPath = path.join(missionControlRootPath, "settings.json");
const runtimeSmokeTestTtlMs = 12 * 60 * 60 * 1000;

export type RuntimeSmokeTestCacheEntry = {
  status: "passed" | "failed";
  checkedAt: string;
  runId?: string;
  summary?: string;
  error?: string;
};

export type MissionControlSettings = {
  workspaceRoot?: string;
  runtimePreflight?: {
    smokeTests?: Record<string, RuntimeSmokeTestCacheEntry>;
  };
};

export function normalizeGatewayRemoteUrl(value: string | null | undefined) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `ws://${trimmed}`;
  let parsed: URL;

  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("Gateway address must be a valid WebSocket URL.");
  }

  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    throw new Error("Gateway address must start with ws:// or wss://.");
  }

  if (!parsed.hostname) {
    throw new Error("Gateway address must include a hostname.");
  }

  return parsed.toString().replace(/\/$/, "");
}

export function normalizeWorkspaceRoot(value: string | null | undefined) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed !== "~" && !trimmed.startsWith("~/") && !path.isAbsolute(trimmed)) {
    throw new Error("Workspace root must be an absolute path or start with ~/.");
  }

  return normalizeConfiguredWorkspaceRootValue(trimmed);
}

export function normalizeConfiguredWorkspaceRootValue(value: string | null | undefined) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return undefined;
  }

  const expanded = expandHomeRelativePath(trimmed);
  const normalized = path.normalize(expanded);

  return normalized.length > 1 ? normalized.replace(/[\\/]+$/, "") : normalized;
}

export async function hasGatewayRemoteUrlConfig() {
  try {
    await runOpenClaw(["config", "get", GATEWAY_REMOTE_URL_CONFIG_KEY, "--json"]);
    return true;
  } catch (error) {
    const detail = stringifyCommandFailure(error);

    if (detail.includes("Config path not found")) {
      return false;
    }

    throw error;
  }
}

export async function getConfiguredWorkspaceRoot() {
  const settings = await readMissionControlSettings();
  return normalizeConfiguredWorkspaceRootValue(settings.workspaceRoot) ?? null;
}

export async function readMissionControlSettings(): Promise<MissionControlSettings> {
  let raw: string;

  try {
    raw = await readFile(missionControlSettingsPath, "utf8");
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined;

    if (code === "ENOENT") {
      return {};
    }

    throw error;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const workspaceRoot =
      typeof parsed.workspaceRoot === "string"
        ? normalizeConfiguredWorkspaceRootValue(parsed.workspaceRoot)
        : undefined;
    const runtimePreflight = normalizeRuntimePreflightSettings(
      typeof parsed.runtimePreflight === "object" && parsed.runtimePreflight ? parsed.runtimePreflight : undefined
    );

    return {
      ...(workspaceRoot ? { workspaceRoot } : {}),
      ...(runtimePreflight ? { runtimePreflight } : {})
    };
  } catch {
    return {};
  }
}

export async function writeMissionControlSettings(settings: MissionControlSettings) {
  await mkdir(missionControlRootPath, { recursive: true });
  await writeFile(missionControlSettingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

export function getRuntimeSmokeTestCacheEntry(settings: MissionControlSettings, agentId: string) {
  return settings.runtimePreflight?.smokeTests?.[agentId] ?? null;
}

export function mapRuntimeSmokeTestEntry(
  agentId: string | null,
  entry: RuntimeSmokeTestCacheEntry | null
): OpenClawRuntimeSmokeTest {
  if (!entry || !agentId) {
    return {
      status: "not-run",
      checkedAt: null,
      agentId: null,
      runId: null,
      summary: null,
      error: null
    };
  }

  return {
    status: entry.status,
    checkedAt: entry.checkedAt,
    agentId,
    runId: entry.runId ?? null,
    summary: entry.summary ?? null,
    error: entry.error ?? null
  };
}

export function getLatestRuntimeSmokeTest(settings: MissionControlSettings): OpenClawRuntimeSmokeTest {
  const latest = listRuntimeSmokeTestEntries(settings)[0];
  return mapRuntimeSmokeTestEntry(latest?.[0] ?? null, latest?.[1] ?? null);
}

export function isRuntimeSmokeTestFresh(entry: RuntimeSmokeTestCacheEntry | null) {
  if (!entry || entry.status !== "passed") {
    return false;
  }

  const checkedAt = Date.parse(entry.checkedAt);
  return Number.isFinite(checkedAt) && Date.now() - checkedAt <= runtimeSmokeTestTtlMs;
}

export async function persistRuntimeSmokeTest(result: OpenClawRuntimeSmokeTest) {
  const settings = await readMissionControlSettings();
  const smokeTests = {
    ...(settings.runtimePreflight?.smokeTests ?? {})
  };

  if (!result.agentId || result.status === "not-run" || !result.checkedAt) {
    return;
  }

  smokeTests[result.agentId] = {
    status: result.status,
    checkedAt: result.checkedAt,
    ...(result.runId ? { runId: result.runId } : {}),
    ...(result.summary ? { summary: result.summary } : {}),
    ...(result.error ? { error: result.error } : {})
  };

  await writeMissionControlSettings({
    ...(settings.workspaceRoot ? { workspaceRoot: settings.workspaceRoot } : {}),
    runtimePreflight: {
      smokeTests
    }
  });
}

function listRuntimeSmokeTestEntries(settings: MissionControlSettings) {
  return Object.entries(settings.runtimePreflight?.smokeTests ?? {}).sort((left, right) => {
    const leftTs = Date.parse(left[1].checkedAt);
    const rightTs = Date.parse(right[1].checkedAt);
    return rightTs - leftTs;
  });
}

function normalizeRuntimePreflightSettings(value: unknown): MissionControlSettings["runtimePreflight"] | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const smokeTestsSource =
    "smokeTests" in value && value.smokeTests && typeof value.smokeTests === "object"
      ? (value.smokeTests as Record<string, unknown>)
      : {};
  const smokeTests = Object.entries(smokeTestsSource).reduce<Record<string, RuntimeSmokeTestCacheEntry>>(
    (result, [agentId, entry]) => {
      if (!entry || typeof entry !== "object") {
        return result;
      }

      const normalizedEntry = entry as Record<string, unknown>;

      const checkedAt = typeof normalizedEntry.checkedAt === "string" ? normalizedEntry.checkedAt : null;
      const status =
        normalizedEntry.status === "passed" || normalizedEntry.status === "failed"
          ? normalizedEntry.status
          : null;

      if (!checkedAt || !status) {
        return result;
      }

      result[agentId] = {
        status,
        checkedAt,
        ...(typeof normalizedEntry.runId === "string" ? { runId: normalizedEntry.runId } : {}),
        ...(typeof normalizedEntry.summary === "string" ? { summary: normalizedEntry.summary } : {}),
        ...(typeof normalizedEntry.error === "string" ? { error: normalizedEntry.error } : {})
      };
      return result;
    },
    {}
  );

  return Object.keys(smokeTests).length > 0 ? { smokeTests } : undefined;
}

function expandHomeRelativePath(value: string) {
  if (value === "~") {
    return os.homedir();
  }

  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }

  return value;
}
