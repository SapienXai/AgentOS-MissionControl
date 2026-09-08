import "server-only";

import {
  NativeGatewayRequestError,
  OpenClawGatewayClientError,
  normalizeClientError
} from "@/lib/openclaw/client/native-ws-gateway-errors";
import {
  isObjectRecord,
  parseConfigPath
} from "@/lib/openclaw/client/native-ws-gateway-utils";
import type { OpenClawConfigReloadKind } from "@/lib/openclaw/client/types";

const MAX_OPENCLAW_CHANGED_PATHS = 256;
const MAX_OPENCLAW_CHANGED_PATH_LENGTH = 1024;

export function buildMergePatchForConfigPath(path: string, value: unknown) {
  const segments = parseConfigPath(path);

  if (segments.length === 0) {
    throw new OpenClawGatewayClientError("Config path is required.", "unknown");
  }

  if (segments.some((segment) => typeof segment === "number")) {
    throw new OpenClawGatewayClientError(
      "Gateway config.patch merge updates do not support array-index paths; using CLI config fallback.",
      "unsupported"
    );
  }

  const root: Record<string, unknown> = {};
  let current = root;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index] as string;
    if (index === segments.length - 1) {
      current[segment] = value;
      break;
    }

    const next: Record<string, unknown> = {};
    current[segment] = next;
    current = next;
  }

  return root;
}

export function buildMergePatchReplacementValue(currentValue: unknown, nextValue: unknown): unknown {
  if (!isObjectRecord(nextValue)) {
    return nextValue;
  }

  const currentRecord = isObjectRecord(currentValue) ? currentValue : {};
  const patch: Record<string, unknown> = {};

  for (const key of Object.keys(currentRecord)) {
    if (!(key in nextValue)) {
      patch[key] = null;
    }
  }

  for (const [key, value] of Object.entries(nextValue)) {
    const currentChild = currentRecord[key];

    if (isObjectRecord(value) && isObjectRecord(currentChild)) {
      patch[key] = buildMergePatchReplacementValue(currentChild, value);
      continue;
    }

    patch[key] = value;
  }

  return patch;
}

export function normalizeConfigReloadKind(value: unknown): OpenClawConfigReloadKind {
  if (typeof value !== "string") {
    return "unknown";
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "restart" || normalized === "hot" || normalized === "none") {
    return normalized;
  }

  return "unknown";
}

/**
 * Read only the bounded, path-only metadata OpenClaw exposes after a validated
 * config mutation. Values and secret contents are intentionally rejected.
 */
export function readOpenClawChangedPaths(value: unknown): string[] | undefined {
  if (!isObjectRecord(value) || !Array.isArray(value.changedPaths)) {
    return undefined;
  }

  if (value.changedPaths.length > MAX_OPENCLAW_CHANGED_PATHS) {
    return undefined;
  }

  const paths = value.changedPaths as unknown[];
  if (paths.some((path) => (
    typeof path !== "string" ||
    path.length === 0 ||
    path.length > MAX_OPENCLAW_CHANGED_PATH_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(path)
  ))) {
    return undefined;
  }

  return paths as string[];
}

export function readConfigReloadKindFromSchemaLookup(payload: unknown): OpenClawConfigReloadKind {
  const visited = new Set<unknown>();
  const queue = [payload];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }

    visited.add(current);

    if (isObjectRecord(current)) {
      const reloadKind = normalizeConfigReloadKind(
        current.reloadKind ??
        current.reload ??
        current.reload_kind ??
        current.reloadPolicy ??
        current.reloadRequirement
      );

      if (reloadKind !== "unknown") {
        return reloadKind;
      }

      queue.push(current.schema, current.hint, current.node, current.config);
      continue;
    }

    if (Array.isArray(current)) {
      queue.push(...current);
    }
  }

  return "unknown";
}

export function isGatewayTransportConfigPath(path: string) {
  return /^(gateway\.(remote\.(url|token|password)|auth\.(mode|token|password))|gateway\.mode)$/.test(path);
}

export function canFallbackGatewayAuthConfigRepair(error: unknown, path: string) {
  const kind = normalizeClientError(error).kind;

  if (
    !isGatewayTransportConfigPath(path) ||
    (kind !== "auth" && kind !== "timeout" && kind !== "unreachable")
  ) {
    return false;
  }

  if (error instanceof NativeGatewayRequestError) {
    return !/^config\.(patch|apply|set|unset)$/i.test(error.method);
  }

  return true;
}

export function isGatewayConfigRateLimitError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");

  return /(^|[^a-z])rate limit(?:ed)?\b|retry after|too many requests|HTTP\s*429/i.test(message) &&
    (
      !(error instanceof NativeGatewayRequestError) ||
      /^config\.(get|schema|patch|apply|set|unset)$/i.test(error.method)
    );
}

export function readGatewayConfigRateLimitRetryAfterMs(error: unknown) {
  if (!isGatewayConfigRateLimitError(error)) {
    return null;
  }

  const message = error instanceof Error ? error.message : String(error ?? "");
  const match = message.match(/retry after\s+(\d+(?:\.\d+)?)\s*(ms|msec|millisecond(?:s)?|s|sec|second(?:s)?|m|min|minute(?:s)?)?/i);

  if (!match) {
    return null;
  }

  const amount = Number(match[1]);

  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }

  const unit = match[2]?.toLowerCase() ?? "s";

  if (unit === "ms" || unit === "msec" || unit.startsWith("millisecond")) {
    return Math.round(amount);
  }

  if (unit === "m" || unit === "min" || unit.startsWith("minute")) {
    return Math.round(amount * 60_000);
  }

  return Math.round(amount * 1_000);
}
