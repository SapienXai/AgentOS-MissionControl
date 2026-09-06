import type { NativeDoctorSnapshot } from "@/lib/openclaw/application/native-doctor-service";
import { compareVersionStrings } from "@/lib/openclaw/domains/control-plane-normalization";

export type NativeUpdateUserState =
  | "up-to-date"
  | "available-certified"
  | "available-uncertified"
  | "blocked"
  | "held"
  | "unavailable"
  | "unknown";

export function resolveNativeUpdateUserState(input: {
  update: NativeDoctorSnapshot["update"];
  agentOsCertifiedVersion?: string | null;
  agentOsPolicyStatus?: "certified" | "candidate" | "blocked" | "unknown" | null;
}): NativeUpdateUserState {
  if (input.update.readStatus === "forbidden" || input.update.status === "unavailable") {
    return "unavailable";
  }

  if (input.update.readStatus !== "available" || input.update.status === "unknown") {
    return "unknown";
  }

  if (isUpdateHeld(input.update.schedule)) {
    return "held";
  }

  if (input.update.status === "current") {
    return "up-to-date";
  }

  if (input.update.status !== "available") {
    return "unknown";
  }

  if (input.agentOsPolicyStatus === "blocked") {
    return "blocked";
  }

  return isAgentOsCertifiedTarget(input.update.latestVersion, input.agentOsCertifiedVersion)
    ? "available-certified"
    : "available-uncertified";
}

export function isAgentOsCertifiedTarget(
  nativeAvailableVersion: string | null | undefined,
  agentOsCertifiedVersion: string | null | undefined
) {
  if (!nativeAvailableVersion || !agentOsCertifiedVersion) {
    return false;
  }

  return compareVersionStrings(nativeAvailableVersion, agentOsCertifiedVersion) <= 0;
}

export function isUpdateHeld(schedule: NativeDoctorSnapshot["update"]["schedule"]) {
  const campaign = schedule && isRecord(schedule.campaign) ? schedule.campaign : null;
  const campaignState = readString(campaign?.state)?.toLowerCase();
  return Boolean(campaignState && /(hold|pause|paused|held)/.test(campaignState));
}

export function formatNativeChannel(channel: string | null | undefined) {
  switch (channel) {
    case "stable":
      return "Stable";
    case "extended-stable":
      return "Extended stable";
    case "beta":
      return "Beta";
    case "dev":
      return "Dev";
    default:
      return channel?.trim() || "Unknown";
  }
}

export function formatAutomaticUpdateState(schedule: NativeDoctorSnapshot["update"]["schedule"]) {
  if (!schedule) {
    return "Not reported";
  }

  if (typeof schedule.autoEnabled === "boolean") {
    return schedule.autoEnabled ? "On" : "Off";
  }

  return "Managed by OpenClaw";
}

export function formatNativeUpdateStateLabel(state: NativeUpdateUserState) {
  switch (state) {
    case "up-to-date":
      return "Up to date";
    case "available-certified":
      return "Update available";
    case "available-uncertified":
      return "Certification pending";
    case "blocked":
      return "Blocked by AgentOS policy";
    case "held":
      return "Update held";
    case "unavailable":
      return "Status unavailable";
    case "unknown":
      return "Unable to verify";
  }
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
