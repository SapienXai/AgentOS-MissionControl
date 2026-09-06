import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatAutomaticUpdateState,
  formatNativeChannel,
  resolveNativeUpdateUserState
} from "@/lib/openclaw/update-presentation";
import type { NativeDoctorSnapshot } from "@/lib/openclaw/application/native-doctor-service";

function update(overrides: Partial<NativeDoctorSnapshot["update"]> = {}): NativeDoctorSnapshot["update"] {
  return {
    readStatus: "available",
    status: "current",
    updateAvailable: false,
    currentVersion: "2026.9.1",
    latestVersion: null,
    effectiveChannel: "stable",
    schedule: null,
    explanation: "OpenClaw reports no update is currently available.",
    ...overrides
  };
}

test("native current status is presented as up to date", () => {
  assert.equal(
    resolveNativeUpdateUserState({
      update: update(),
      agentOsCertifiedVersion: "2026.9.1"
    }),
    "up-to-date"
  );
});

test("native available target at or below the certified version is eligible for normal update", () => {
  assert.equal(
    resolveNativeUpdateUserState({
      update: update({
        status: "available",
        updateAvailable: true,
        latestVersion: "2026.9.2"
      }),
      agentOsCertifiedVersion: "2026.9.2"
    }),
    "available-certified"
  );
});

test("native available target newer than certification stays behind advanced options", () => {
  assert.equal(
    resolveNativeUpdateUserState({
      update: update({
        status: "available",
        updateAvailable: true,
        latestVersion: "2026.9.3"
      }),
      agentOsCertifiedVersion: "2026.9.2"
    }),
    "available-uncertified"
  );
});

test("AgentOS certification never invents an update when native OpenClaw says current", () => {
  assert.equal(
    resolveNativeUpdateUserState({
      update: update({ currentVersion: "2026.9.1" }),
      agentOsCertifiedVersion: "2026.9.2"
    }),
    "up-to-date"
  );
});

test("blocked native target remains blocked even when a higher certification value exists", () => {
  assert.equal(
    resolveNativeUpdateUserState({
      update: update({
        status: "available",
        updateAvailable: true,
        latestVersion: "2026.9.3"
      }),
      agentOsCertifiedVersion: "2026.9.3",
      agentOsPolicyStatus: "blocked"
    }),
    "blocked"
  );
});

test("native campaign hold is shown before normal availability action", () => {
  assert.equal(
    resolveNativeUpdateUserState({
      update: update({
        status: "available",
        updateAvailable: true,
        latestVersion: "2026.9.2",
        schedule: { campaign: { state: "paused" } }
      }),
      agentOsCertifiedVersion: "2026.9.2"
    }),
    "held"
  );
});

test("native forbidden, unavailable, and unknown reads are not reported as up to date", () => {
  assert.equal(
    resolveNativeUpdateUserState({
      update: update({ readStatus: "forbidden", status: "unavailable" }),
      agentOsCertifiedVersion: "2026.9.1"
    }),
    "unavailable"
  );
  assert.equal(
    resolveNativeUpdateUserState({
      update: update({ readStatus: "unavailable", status: "unavailable" }),
      agentOsCertifiedVersion: "2026.9.1"
    }),
    "unavailable"
  );
  assert.equal(
    resolveNativeUpdateUserState({
      update: update({ readStatus: "unknown", status: "unknown" }),
      agentOsCertifiedVersion: "2026.9.1"
    }),
    "unknown"
  );
});

test("native channel and automatic update labels preserve the official payload", () => {
  assert.equal(formatNativeChannel("extended-stable"), "Extended stable");
  assert.equal(formatNativeChannel("beta"), "Beta");
  assert.equal(formatNativeChannel("future-channel"), "future-channel");
  assert.equal(formatAutomaticUpdateState({ autoEnabled: true }), "On");
  assert.equal(formatAutomaticUpdateState({ autoEnabled: false }), "Off");
  assert.equal(formatAutomaticUpdateState(null), "Not reported");
});
