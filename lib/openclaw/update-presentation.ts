import type { NativeDoctorSnapshot } from "@/lib/openclaw/application/native-doctor-service";
import {
  canHoldNativeUpdate,
  guardNormalOpenClawUpdate,
  isNativeUpdateInProgress,
  isUpdateHeld,
  resolveNativeUpdateUserState,
  resolveNormalOpenClawUpdatePolicy,
  type NativeUpdateUserState,
  type NormalOpenClawUpdateGateResult,
  type NormalOpenClawUpdatePolicy
} from "@/lib/openclaw/domains/normal-update-policy";

export {
  canHoldNativeUpdate,
  guardNormalOpenClawUpdate,
  isNativeUpdateInProgress,
  isUpdateHeld,
  resolveNativeUpdateUserState,
  resolveNormalOpenClawUpdatePolicy,
  type NativeUpdateUserState,
  type NormalOpenClawUpdateGateResult,
  type NormalOpenClawUpdatePolicy
};

export function formatNativeChannel(channel: string | null | undefined) {
  switch (channel) {
    case "stable": return "Stable";
    case "extended-stable": return "Extended stable";
    case "beta": return "Beta";
    case "dev": return "Dev";
    default: return channel?.trim() || "Unknown";
  }
}

export function formatAutomaticUpdateState(schedule: NativeDoctorSnapshot["update"]["schedule"]) {
  if (!schedule) return "Not reported";
  if (typeof schedule.autoEnabled === "boolean") return schedule.autoEnabled ? "On" : "Off";
  return "Managed by OpenClaw";
}

export function formatNativeUpdateStateLabel(state: NativeUpdateUserState) {
  switch (state) {
    case "up-to-date": return "Up to date";
    case "available-certified": return "Update available";
    case "available-uncertified": return "Certification pending";
    case "blocked": return "Blocked by AgentOS policy";
    case "held": return "Update held";
    case "running": return "Updating OpenClaw";
    case "unavailable": return "Status unavailable";
    case "unknown": return "Unable to verify";
  }
}
