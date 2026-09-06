import assert from "node:assert/strict";
import { test } from "node:test";

import {
  deriveMissionTitle,
  resolveWorkforceMissionState
} from "@/lib/agentos/workforce/mission-state";

test("workforce mission state derives running work from active runtime evidence", () => {
  assert.equal(resolveWorkforceMissionState({ rootStatus: "running", connection: "live" }), "running");
  assert.equal(resolveWorkforceMissionState({ dispatchStatus: "running", runnerStarted: true, connection: "live" }), "starting");
  assert.equal(resolveWorkforceMissionState({ dispatchStatus: "queued", connection: "live" }), "queued");
});

test("human control takes precedence over running presentation", () => {
  assert.equal(resolveWorkforceMissionState({ rootStatus: "running", pendingHumanControl: ["approval"], connection: "live" }), "waiting-human");
  assert.equal(resolveWorkforceMissionState({ rootStatus: "running", pendingHumanControl: ["approval", "question"], connection: "live" }), "waiting-human");
  assert.equal(resolveWorkforceMissionState({ rootStatus: "running", pendingHumanControl: ["blocked"], connection: "live" }), "blocked");
});

test("a parent waiting on an active child is waiting-worker, not failed", () => {
  assert.equal(resolveWorkforceMissionState({ rootStatus: "idle", childStatuses: ["running"], connection: "live" }), "waiting-worker");
  assert.equal(resolveWorkforceMissionState({ rootStatus: "idle", childStatuses: ["completed"], connection: "live" }), "queued");
});

test("child completion does not complete the parent mission", () => {
  assert.equal(resolveWorkforceMissionState({ rootStatus: "idle", childStatuses: ["completed"], authoritativeCompletion: false, connection: "live" }), "queued");
  assert.equal(resolveWorkforceMissionState({ rootStatus: "completed", childStatuses: ["completed"], connection: "live" }), "completed");
});

test("temporary Gateway loss is reconnecting, not failed", () => {
  assert.equal(resolveWorkforceMissionState({ rootStatus: "running", connection: "reconnecting" }), "reconnecting");
  assert.equal(resolveWorkforceMissionState({ dispatchStatus: "stalled", connection: "reconnecting" }), "failed");
});

test("terminal failure and cancellation remain explicit", () => {
  assert.equal(resolveWorkforceMissionState({ authoritativeFailure: true, connection: "live" }), "failed");
  assert.equal(resolveWorkforceMissionState({ rootStatus: "cancelled", connection: "live" }), "cancelled");
});

test("mission titles are deterministic and bounded", () => {
  assert.equal(deriveMissionTitle("  Prepare   the launch brief  "), "Prepare the launch brief");
  assert.equal(deriveMissionTitle(""), "Untitled mission");
  assert.equal(deriveMissionTitle("a".repeat(100)).length, 70);
});
