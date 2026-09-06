import type { RuntimeStatus } from "@/lib/agentos/contracts";
import type { WorkforceMissionState } from "@/lib/agentos/workforce/types";

export type WorkforceMissionStateInput = {
  dispatchStatus?: "queued" | "running" | "completed" | "stalled" | "cancelled" | null;
  runnerStarted?: boolean;
  rootStatus?: RuntimeStatus | null;
  childStatuses?: RuntimeStatus[];
  activeRuntimeStatuses?: RuntimeStatus[];
  pendingHumanControl?: Array<"approval" | "question" | "blocked" | "runtime-issue" | "needs-setup">;
  connection?: "live" | "reconnecting" | "unknown";
  authoritativeFailure?: boolean;
  authoritativeCompletion?: boolean;
};

const activeStatuses = new Set<RuntimeStatus>(["running", "queued"]);

export function resolveWorkforceMissionState(input: WorkforceMissionStateInput): WorkforceMissionState {
  const pendingHumanControl = input.pendingHumanControl ?? [];
  const rootStatus = input.rootStatus ?? null;
  const childStatuses = input.childStatuses ?? [];
  const activeRuntimeStatuses = input.activeRuntimeStatuses ?? [];
  const hasActiveRoot = rootStatus !== null && activeStatuses.has(rootStatus);
  const hasActiveChild = childStatuses.some((status) => activeStatuses.has(status));
  const hasActiveRuntime = activeRuntimeStatuses.some((status) => activeStatuses.has(status));

  if (input.dispatchStatus === "cancelled" || rootStatus === "cancelled") return "cancelled";
  if (pendingHumanControl.some((type) => type === "approval" || type === "question")) return "waiting-human";
  if (pendingHumanControl.some((type) => type === "blocked" || type === "runtime-issue" || type === "needs-setup")) return "blocked";
  if (input.authoritativeFailure || input.dispatchStatus === "stalled" || rootStatus === "stalled") return "failed";
  if (input.authoritativeCompletion || input.dispatchStatus === "completed" || rootStatus === "completed") return "completed";
  if (input.connection === "reconnecting") return "reconnecting";
  if (hasActiveChild && !hasActiveRoot && !hasActiveRuntime) return "waiting-worker";
  if (hasActiveRoot || hasActiveRuntime) return "running";
  if (input.dispatchStatus === "running" || input.runnerStarted) return "starting";
  return "queued";
}

export function workforceMissionStateLabel(state: WorkforceMissionState) {
  switch (state) {
    case "waiting-human": return "Waiting for you";
    case "waiting-worker": return "Waiting for worker";
    case "reconnecting": return "Reconnecting";
    case "starting": return "Starting";
    case "queued": return "Queued";
    case "running": return "Running";
    case "blocked": return "Blocked";
    case "completed": return "Completed";
    case "failed": return "Failed";
    case "cancelled": return "Cancelled";
  }
}

export function deriveMissionTitle(goal: string) {
  const normalized = goal.replace(/\s+/g, " ").trim();
  if (!normalized) return "Untitled mission";
  return normalized.length <= 72 ? normalized : `${normalized.slice(0, 69).trimEnd()}…`;
}

export function isWorkforceMissionActive(state: WorkforceMissionState) {
  return ["starting", "running", "waiting-worker", "reconnecting"].includes(state);
}

export function isWorkforceMissionAttentionState(state: WorkforceMissionState) {
  return ["waiting-human", "blocked", "failed"].includes(state);
}
