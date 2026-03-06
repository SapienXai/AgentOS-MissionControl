import { formatDistanceToNowStrict } from "date-fns";

import type { AgentStatus, DiagnosticHealth, RuntimeStatus } from "@/lib/openclaw/types";

export function formatRelativeTime(timestamp: number | null | undefined) {
  if (!timestamp) {
    return "No activity";
  }

  return `${formatDistanceToNowStrict(timestamp, { addSuffix: true })}`;
}

export function formatAge(ageMs: number | null | undefined) {
  if (typeof ageMs !== "number") {
    return "No age";
  }

  return `${formatDistanceToNowStrict(Date.now() - ageMs, { addSuffix: true })}`;
}

export function formatContextWindow(value: number | null | undefined) {
  if (!value) {
    return "n/a";
  }

  if (value >= 1000) {
    return `${Math.round(value / 1000)}k`;
  }

  return String(value);
}

export function formatTokens(value: number | null | undefined) {
  if (typeof value !== "number") {
    return "0";
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  }

  return String(value);
}

export function formatModelLabel(modelId: string) {
  return modelId.split("/").at(1) || modelId;
}

export function formatProvider(modelId: string) {
  return modelId.split("/").at(0) || "unknown";
}

export function toneForAgentStatus(status: AgentStatus) {
  switch (status) {
    case "engaged":
      return "text-cyan-300";
    case "monitoring":
      return "text-emerald-300";
    case "ready":
      return "text-amber-200";
    case "offline":
      return "text-rose-200";
    default:
      return "text-slate-400";
  }
}

export function toneForRuntimeStatus(status: RuntimeStatus) {
  switch (status) {
    case "active":
      return "text-cyan-300";
    case "completed":
      return "text-emerald-300";
    case "error":
      return "text-rose-200";
    case "queued":
      return "text-amber-200";
    default:
      return "text-slate-400";
  }
}

export function toneForHealth(status: DiagnosticHealth) {
  switch (status) {
    case "healthy":
      return "text-emerald-300";
    case "degraded":
      return "text-amber-200";
    default:
      return "text-rose-200";
  }
}

export function shortId(value: string | undefined, length = 8) {
  if (!value) {
    return "n/a";
  }

  return value.length <= length ? value : value.slice(0, length);
}

export function compactPath(value: string) {
  return value.replace(/^\/Users\/[^/]+/, "~");
}
