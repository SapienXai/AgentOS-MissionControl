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
