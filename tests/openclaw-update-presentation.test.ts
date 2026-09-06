import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatAutomaticUpdateState,
  formatNativeChannel,
  guardNormalOpenClawUpdate,
  resolveNativeUpdateUserState,
  resolveNormalOpenClawUpdatePolicy
} from "@/lib/openclaw/update-presentation";
import type { OpenClawCompatibilityManifest } from "@/lib/openclaw/update-compatibility";
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
      update: update()
    }),
    "up-to-date"
  );
});

test("native available target with an exact certified decision is eligible for normal update", () => {
  assert.equal(
    resolveNativeUpdateUserState({
      update: update({
        status: "available",
        updateAvailable: true,
        latestVersion: "2026.9.2"
      }),
      agentOsDecision: {
        version: "2026.9.2",
        status: "certified",
        allowed: true,
        defaultVisible: true,
        requiresExplicitOptIn: false,
        requiresAgentOsUpdate: false,
        minRequiredAgentOsVersion: null,
        reason: "Certified",
        notes: null
      }
    }),
    "available-certified"
  );
});

test("durable active native run wins over a temporary unavailable availability probe", () => {
  const state = resolveNativeUpdateUserState({
    update: {
      ...update({ currentVersion: "2026.9.1" }),
      readStatus: "unknown",
      status: "unknown",
      updateAvailable: null,
      activeRun: {
        runId: "run-1",
        createdAtMs: 1,
        updatedAtMs: 2,
        trigger: "control-ui",
        phase: "restarting",
        status: "running",
        reason: null,
        targetVersion: "2026.9.2",
        beforeVersion: "2026.9.1",
        afterVersion: null,
        steps: [],
        verification: null,
        repair: [],
        confirmedAtMs: null,
        finishedAtMs: null,
        downtimeMs: null
      }
    }
  });

  assert.equal(state, "running");
});

test("native available target newer than certification stays behind advanced options", () => {
  assert.equal(
    resolveNativeUpdateUserState({
      update: update({
        status: "available",
        updateAvailable: true,
        latestVersion: "2026.9.3"
      }),
      agentOsDecision: {
        version: "2026.9.3",
        status: "unknown",
        allowed: false,
        defaultVisible: false,
        requiresExplicitOptIn: true,
        requiresAgentOsUpdate: false,
        minRequiredAgentOsVersion: null,
        reason: "Unknown",
        notes: null
      }
    }),
    "available-uncertified"
  );
});

test("AgentOS certification never invents an update when native OpenClaw says current", () => {
  assert.equal(
    resolveNativeUpdateUserState({
      update: update({ currentVersion: "2026.9.1" }),
      agentOsDecision: {
        version: "2026.9.2",
        status: "certified",
        allowed: true,
        defaultVisible: true,
        requiresExplicitOptIn: false,
        requiresAgentOsUpdate: false,
        minRequiredAgentOsVersion: null,
        reason: "Certified",
        notes: null
      }
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
      agentOsDecision: {
        version: "2026.9.3",
        status: "blocked",
        allowed: false,
        defaultVisible: false,
        requiresExplicitOptIn: false,
        requiresAgentOsUpdate: false,
        minRequiredAgentOsVersion: null,
        reason: "Blocked",
        notes: null
      }
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
        schedule: {
          autoEnabled: true,
          campaign: { state: "countdown", holdUntilMs: Date.now() + 60_000 }
        }
      }),
      agentOsDecision: {
        version: "2026.9.2",
        status: "certified",
        allowed: true,
        defaultVisible: true,
        requiresExplicitOptIn: false,
        requiresAgentOsUpdate: false,
        minRequiredAgentOsVersion: null,
        reason: "Certified",
        notes: null
      }
    }),
    "held"
  );
});

test("native forbidden, unavailable, and unknown reads are not reported as up to date", () => {
  assert.equal(
    resolveNativeUpdateUserState({
      update: update({ readStatus: "forbidden", status: "unavailable" }),
      agentOsDecision: null
    }),
    "unavailable"
  );
  assert.equal(
    resolveNativeUpdateUserState({
      update: update({ readStatus: "unavailable", status: "unavailable" }),
      agentOsDecision: null
    }),
    "unavailable"
  );
  assert.equal(
    resolveNativeUpdateUserState({
      update: update({ readStatus: "unknown", status: "unknown" }),
      agentOsDecision: null
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

function manifest(entries: OpenClawCompatibilityManifest["versions"]): OpenClawCompatibilityManifest {
  return {
    schemaVersion: 1,
    source: "override",
    recommendedVersion: "2026.9.3",
    versions: entries
  };
}

function policyUpdate(latestVersion: string) {
  return {
    status: "available" as const,
    readStatus: "available" as const,
    updateAvailable: true,
    currentVersion: "2026.9.1",
    latestVersion,
    effectiveChannel: "stable",
    schedule: null,
    explanation: "available"
  };
}

test("exact manifest status wins over version ordering", () => {
  const policy = resolveNormalOpenClawUpdatePolicy({
    snapshot: {
      status: { runtimeVersion: "2026.9.1", version: null, updateChannel: "stable" },
      update: policyUpdate("2026.9.2")
    },
    agentOsVersion: "0.7.2",
    manifest: manifest([
      { version: "2026.9.1", status: "certified" },
      { version: "2026.9.2", status: "blocked" },
      { version: "2026.9.3", status: "certified" }
    ])
  });

  assert.equal(policy.agentOsDecision?.status, "blocked");
  assert.equal(policy.canRunNormalUpdate, false);
  assert.equal(policy.state, "blocked");
});

test("unknown manifest gaps remain uncertified even below a certified release", () => {
  const policy = resolveNormalOpenClawUpdatePolicy({
    snapshot: {
      status: { runtimeVersion: "2026.9.1", version: null, updateChannel: "stable" },
      update: policyUpdate("2026.9.2")
    },
    agentOsVersion: "0.7.2",
    manifest: manifest([
      { version: "2026.9.1", status: "certified" },
      { version: "2026.9.3", status: "certified" }
    ])
  });

  assert.equal(policy.agentOsDecision?.status, "unknown");
  assert.equal(policy.canRunNormalUpdate, false);
  assert.equal(policy.state, "available-uncertified");
});

test("community release signals cannot change the native policy decision", () => {
  const input = {
    snapshot: {
      status: { runtimeVersion: "2026.9.1", version: null, updateChannel: "stable" },
      update: policyUpdate("2026.9.2")
    },
    agentOsVersion: "0.7.2",
    manifest: manifest([{ version: "2026.9.2", status: "blocked" }])
  } as const;
  const withHighCommunitySignal = resolveNormalOpenClawUpdatePolicy(input);
  const withLowCommunitySignal = resolveNormalOpenClawUpdatePolicy(input);
  assert.deepEqual(withHighCommunitySignal, withLowCommunitySignal);
  assert.equal(withHighCommunitySignal.canRunNormalUpdate, false);
});

test("native applying campaign is visible after a page reload", () => {
  const policy = resolveNormalOpenClawUpdatePolicy({
    snapshot: {
      status: { runtimeVersion: "2026.9.1", version: null, updateChannel: "stable" },
      update: {
        ...policyUpdate("2026.9.2"),
        schedule: { autoEnabled: true, campaign: { state: "applying" } }
      }
    },
    agentOsVersion: "0.7.2",
    manifest: manifest([{ version: "2026.9.2", status: "certified" }])
  });

  assert.equal(policy.state, "running");
  assert.equal(policy.canRunNormalUpdate, false);
});

test("native hold is only available for an active automatic campaign", () => {
  const policy = resolveNormalOpenClawUpdatePolicy({
    snapshot: {
      status: { runtimeVersion: "2026.9.1", version: null, updateChannel: "stable" },
      update: {
        ...policyUpdate("2026.9.2"),
        schedule: { autoEnabled: true, campaign: { state: "countdown" } }
      }
    },
    agentOsVersion: "0.7.2",
    manifest: manifest([{ version: "2026.9.2", status: "certified" }])
  });

  assert.equal(policy.canHoldUpdate, true);
});

test("normal update gate rejects direct policy bypasses", () => {
  const blocked = resolveNormalOpenClawUpdatePolicy({
    snapshot: {
      status: { runtimeVersion: "2026.9.1", version: null, updateChannel: "stable" },
      update: policyUpdate("2026.9.2")
    },
    agentOsVersion: "0.7.2",
    manifest: manifest([{ version: "2026.9.2", status: "blocked" }])
  });
  const result = guardNormalOpenClawUpdate({ policy: blocked, confirmationMatches: true });

  assert.equal(result.allowed, false);
  if (!result.allowed) assert.equal(result.code, "UPDATE_POLICY_BLOCKED");
});

test("normal update gate allows an exact certified native target", () => {
  const policy = resolveNormalOpenClawUpdatePolicy({
    snapshot: {
      status: { runtimeVersion: "2026.9.1", version: null, updateChannel: "stable" },
      update: policyUpdate("2026.9.2")
    },
    agentOsVersion: "0.7.2",
    manifest: manifest([{ version: "2026.9.2", status: "certified" }])
  });
  assert.deepEqual(guardNormalOpenClawUpdate({ policy, confirmationMatches: true }), { allowed: true });
});

test("candidate and unknown exact targets stay out of the normal update route", () => {
  for (const status of ["candidate", "unknown"] as const) {
    const policy = resolveNormalOpenClawUpdatePolicy({
      snapshot: {
        status: { runtimeVersion: "2026.9.1", version: null, updateChannel: "stable" },
        update: policyUpdate("2026.9.2")
      },
      agentOsVersion: "0.7.2",
      manifest: manifest([{ version: "2026.9.2", status }])
    });
    const result = guardNormalOpenClawUpdate({ policy, confirmationMatches: true });

    assert.equal(result.allowed, false);
    if (!result.allowed) assert.equal(result.code, "UPDATE_CERTIFICATION_REQUIRED");
  }
});

test("normal update gate rejects a native available state without an exact target", () => {
  const policy = resolveNormalOpenClawUpdatePolicy({
    snapshot: {
      status: { runtimeVersion: "2026.9.1", version: null, updateChannel: "stable" },
      update: { ...policyUpdate("2026.9.2"), latestVersion: null }
    },
    agentOsVersion: "0.7.2",
    manifest: manifest([{ version: "2026.9.2", status: "certified" }])
  });
  const result = guardNormalOpenClawUpdate({ policy, confirmationMatches: true });

  assert.equal(result.allowed, false);
  if (!result.allowed) assert.equal(result.code, "NATIVE_UPDATE_TARGET_UNKNOWN");
});

test("normal update gate rejects stale target, channel, or Gateway confirmation", () => {
  const policy = resolveNormalOpenClawUpdatePolicy({
    snapshot: {
      status: { runtimeVersion: "2026.9.1", version: null, updateChannel: "stable" },
      update: policyUpdate("2026.9.2")
    },
    agentOsVersion: "0.7.2",
    manifest: manifest([{ version: "2026.9.2", status: "certified" }])
  });
  const result = guardNormalOpenClawUpdate({ policy, confirmationMatches: false });

  assert.equal(result.allowed, false);
  if (!result.allowed) assert.equal(result.code, "UPDATE_CONFIRMATION_STALE");
});

test("normal update gate requires native availability and exact target evidence", () => {
  const policy = resolveNormalOpenClawUpdatePolicy({
    snapshot: {
      status: { runtimeVersion: "2026.9.1", version: null, updateChannel: "stable" },
      update: {
        ...policyUpdate("2026.9.2"),
        readStatus: "unknown",
        status: "unknown",
        updateAvailable: null,
        latestVersion: null
      }
    },
    agentOsVersion: "0.7.2",
    manifest: manifest([{ version: "2026.9.2", status: "certified" }])
  });
  const result = guardNormalOpenClawUpdate({ policy, confirmationMatches: true });

  assert.equal(result.allowed, false);
  if (!result.allowed) assert.equal(result.code, "NATIVE_UPDATE_STATUS_UNAVAILABLE");
});
