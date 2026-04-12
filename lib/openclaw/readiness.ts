import type { MissionControlSnapshot } from "@/lib/openclaw/types";

export function isOpenClawRuntimeStateReady(snapshot: MissionControlSnapshot) {
  return snapshot.diagnostics.runtime.stateWritable && snapshot.diagnostics.runtime.sessionStoreWritable;
}

export function isOpenClawRuntimeSmokeTestReady(snapshot: MissionControlSnapshot) {
  return snapshot.diagnostics.runtime.smokeTest.status === "passed";
}

export function isOpenClawSystemReady(snapshot: MissionControlSnapshot) {
  return snapshot.diagnostics.installed && snapshot.diagnostics.rpcOk && isOpenClawRuntimeStateReady(snapshot);
}

export function isOpenClawMissionReady(snapshot: MissionControlSnapshot) {
  return isOpenClawSystemReady(snapshot) &&
    snapshot.diagnostics.modelReadiness.ready &&
    isOpenClawRuntimeSmokeTestReady(snapshot);
}

export function resolveMissionDispatchReadinessError(snapshot: MissionControlSnapshot) {
  if (!isOpenClawSystemReady(snapshot)) {
    return "OpenClaw system setup is incomplete. Verify the CLI, gateway, and runtime state before dispatching missions.";
  }

  if (!snapshot.diagnostics.modelReadiness.ready) {
    return "OpenClaw model setup is incomplete. Configure a usable default model before dispatching missions.";
  }

  return null;
}
