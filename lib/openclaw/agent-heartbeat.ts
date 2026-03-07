import type { AgentHeartbeatInput, AgentPreset } from "@/lib/openclaw/types";

export type AgentHeartbeatDraft = {
  enabled: boolean;
  every: string;
};

export const DEFAULT_MONITORING_HEARTBEAT_INTERVAL = "30m";

export const AGENT_HEARTBEAT_INTERVAL_OPTIONS: Array<{
  value: string;
  label: string;
}> = [
  {
    value: "15m",
    label: "15 min"
  },
  {
    value: "30m",
    label: "30 min"
  },
  {
    value: "60m",
    label: "1 hour"
  },
  {
    value: "240m",
    label: "4 hours"
  }
];

export function defaultHeartbeatForPreset(preset: AgentPreset): AgentHeartbeatDraft {
  return preset === "monitoring"
    ? {
        enabled: true,
        every: DEFAULT_MONITORING_HEARTBEAT_INTERVAL
      }
    : {
        enabled: false,
        every: DEFAULT_MONITORING_HEARTBEAT_INTERVAL
      };
}

export function resolveHeartbeatDraft(
  preset: AgentPreset,
  heartbeat?: AgentHeartbeatInput | { enabled?: boolean; every?: string | null } | null
): AgentHeartbeatDraft {
  const defaults = defaultHeartbeatForPreset(preset);
  const normalizedEvery =
    typeof heartbeat?.every === "string" && heartbeat.every.trim() && heartbeat.every !== "disabled"
      ? heartbeat.every.trim()
      : defaults.every;

  if (typeof heartbeat?.enabled === "boolean") {
    return {
      enabled: heartbeat.enabled,
      every: normalizedEvery
    };
  }

  if (heartbeat?.every === "disabled") {
    return {
      enabled: false,
      every: normalizedEvery
    };
  }

  return defaults;
}

export function applyPresetHeartbeat(
  heartbeat: AgentHeartbeatDraft,
  previousPreset: AgentPreset,
  nextPreset: AgentPreset
) {
  const previousDefaults = defaultHeartbeatForPreset(previousPreset);

  if (
    heartbeat.enabled !== previousDefaults.enabled ||
    heartbeat.every !== previousDefaults.every
  ) {
    return heartbeat;
  }

  return defaultHeartbeatForPreset(nextPreset);
}

export function serializeHeartbeatConfig(heartbeat: AgentHeartbeatDraft | AgentHeartbeatInput | undefined | null) {
  if (!heartbeat?.enabled) {
    return null;
  }

  const every =
    typeof heartbeat.every === "string" && heartbeat.every.trim()
      ? heartbeat.every.trim()
      : DEFAULT_MONITORING_HEARTBEAT_INTERVAL;

  return {
    every
  };
}
