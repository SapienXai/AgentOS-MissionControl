import { formatDistanceStrict } from "date-fns";

import type { AgentStatus, DiagnosticHealth, RuntimeStatus, OpenClawAgent } from "@/lib/openclaw/types";

export function formatRelativeTime(timestamp: number | null | undefined, referenceTimeMs: number = Date.now()) {
  if (timestamp == null || Number.isNaN(timestamp)) {
    return "No activity";
  }

  return `${formatDistanceStrict(timestamp, referenceTimeMs, { addSuffix: true })}`;
}

export function formatAge(ageMs: number | null | undefined, referenceTimeMs: number = Date.now()) {
  if (typeof ageMs !== "number" || Number.isNaN(ageMs)) {
    return "No age";
  }

  return `${formatDistanceStrict(referenceTimeMs - ageMs, referenceTimeMs, { addSuffix: true })}`;
}

export function resolveRelativeTimeReferenceMs(generatedAt: string | null | undefined) {
  if (!generatedAt) {
    return Date.now();
  }

  const parsed = Date.parse(generatedAt);
  return Number.isNaN(parsed) ? Date.now() : parsed;
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
    return "n/a";
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  }

  return String(value);
}

export function formatModelLabel(modelId: string) {
  return modelId.split("/").at(1) || modelId;
}

export function formatAgentDisplayName(agent: Pick<OpenClawAgent, "name" | "identityName">) {
  return agent.name?.trim() || agent.identityName?.trim() || "OpenClaw";
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
    case "running":
      return "text-cyan-300";
    case "completed":
      return "text-emerald-300";
    case "cancelled":
      return "text-rose-300";
    case "stalled":
      return "text-amber-200";
    case "queued":
      return "text-amber-200";
    default:
      return "text-slate-400";
  }
}

export function badgeVariantForRuntimeStatus(status: RuntimeStatus) {
  switch (status) {
    case "running":
      return "default";
    case "completed":
      return "success";
    case "cancelled":
      return "danger";
    case "stalled":
      return "warning";
    default:
      return "muted";
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

const missionRoutingMarkers = [/^Task output routing:/i, /^Agent operating policy:/i];

export function stripMissionRouting(value: string) {
  const normalized = value.replace(/\r\n/g, "\n").trim();

  if (!normalized) {
    return "";
  }

  const keptLines: string[] = [];

  for (const line of normalized.split("\n")) {
    const trimmedLine = line.trim();

    if (missionRoutingMarkers.some((pattern) => pattern.test(trimmedLine))) {
      break;
    }

    keptLines.push(line);
  }

  return keptLines.join(" ").replace(/\s+/g, " ").trim();
}

export function compactMissionText(value: string | null | undefined, maxLength = 64) {
  if (!value) {
    return "";
  }

  const stripped = stripMissionRouting(value);

  if (!stripped) {
    return "";
  }

  if (stripped.length <= maxLength) {
    return stripped;
  }

  return `${stripped.slice(0, Math.max(maxLength - 1, 1)).trimEnd()}…`;
}
