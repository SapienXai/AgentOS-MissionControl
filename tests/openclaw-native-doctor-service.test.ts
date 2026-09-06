import assert from "node:assert/strict";
import { test } from "node:test";

import {
  auditResultForNativeDoctorMutation,
  confirmationMatches,
  executeNativeDoctorMutation,
  getNativeDoctorSnapshot,
  normalizeNativeUpdateRunOutcome,
  reconcileNativeDoctorMutation,
  verifyFreshRestartState,
  verifyFreshUpdateState
} from "@/lib/openclaw/application/native-doctor-service";
import type { OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import type { OpenClawGatewayClient } from "@/lib/openclaw/client/types";
import { NativeGatewayError } from "@/lib/openclaw/client/native-ws-gateway-errors";

function createAdapter(overrides: Partial<OpenClawAdapter> = {}) {
  return {
    async getNativeHealth() {
      return { ok: true };
    },
    async getNativeStatus() {
      return {};
    },
    async getDiagnosticsStability() {
      return { status: "stable", checksRun: 3, privatePath: "/should-not-be-returned" };
    },
    async getConfigSnapshot() {
      return {
        valid: true,
        configRevisionHash: "revision-1",
        appliedConfigHash: "revision-1"
      };
    },
    async getNativeUpdateStatus() {
      return {
        sentinel: null,
        updateAvailable: null,
        effectiveChannel: "stable" as const
      };
    },
    getConnectionIdentity() {
      return {
        connectionId: "connection-1",
        client: {
          async getOperatorIdentity() {
            return {
              requestedRole: "operator",
              role: "operator",
              requestedScopes: ["operator.admin", "operator.read"],
              grantedScopes: ["operator.admin", "operator.read"],
              grantedScopesKnown: true,
              deviceId: "device",
              connectionId: "connection-1",
              authenticated: true,
              source: "native-handshake" as const
            };
          }
        }
      };
    },
    ...overrides
  } as unknown as OpenClawAdapter;
}

test("native Doctor keeps config application and runtime health truthful", async () => {
  const snapshot = await getNativeDoctorSnapshot({ adapter: createAdapter() });

  assert.equal(snapshot.runtime.status, "healthy");
  assert.equal(snapshot.config.application, "applied");
  assert.equal(snapshot.update.status, "current");
  assert.equal(snapshot.identity.connectionId, "connection-1");
  assert.equal(snapshot.diagnostics.stability?.privatePath, undefined);
});

test("native Doctor keeps status separate and sends probe only when requested", async () => {
  let probe: boolean | undefined;
  let refreshCheckout: boolean | undefined;
  const snapshot = await getNativeDoctorSnapshot({
    adapter: createAdapter({
      async getNativeHealth(options) {
        probe = options?.probe;
        return { ok: true };
      },
      async getNativeStatus() {
        return { runtimeVersion: "2026.9.1", gateway: { reachable: true, mode: "local" } };
      },
      async getNativeUpdateStatus(options) {
        refreshCheckout = options?.refreshCheckout;
        return { sentinel: null, updateAvailable: null, effectiveChannel: "stable" as const };
      }
    }),
    probe: true,
    refreshCheckout: true
  });

  assert.equal(probe, true);
  assert.equal(snapshot.status.runtimeVersion, "2026.9.1");
  assert.equal(snapshot.status.gatewayReachable, true);
  assert.equal(snapshot.status.gatewayMode, "local");
  assert.equal(refreshCheckout, true);
});

test("config revision mismatch is restart-required, not silently applied", async () => {
  const snapshot = await getNativeDoctorSnapshot({
    adapter: createAdapter({
      async getConfigSnapshot() {
        return { valid: true, configRevisionHash: "revision-2", appliedConfigHash: "revision-1" };
      }
    })
  });

  assert.equal(snapshot.config.application, "restart-required");
});

test("native read failures become unknown while unsupported native methods are unavailable", async () => {
  const unknown = await getNativeDoctorSnapshot({
    adapter: createAdapter({
      async getNativeHealth() {
        throw new Error("Gateway timed out");
      }
    })
  });
  assert.equal(unknown.runtime.status, "unknown");
  assert.equal(unknown.runtime.reachable, null);

  const unavailable = await getNativeDoctorSnapshot({
    adapter: createAdapter({
      async getNativeHealth() {
        throw new NativeGatewayError("method unsupported", { kind: "unsupported" });
      }
    })
  });
  assert.equal(unavailable.runtime.status, "unavailable");
  assert.equal(unavailable.runtime.reachable, false);
});

test("Doctor keeps read-only surfaces when update.status is forbidden", async () => {
  const snapshot = await getNativeDoctorSnapshot({
    adapter: createAdapter({
      getConnectionIdentity() {
        return {
          connectionId: "connection-read-only",
          client: {
            async getOperatorIdentity() {
              return {
                requestedRole: "operator",
                role: "operator",
                requestedScopes: ["operator.read"],
                grantedScopes: ["operator.read"],
                grantedScopesKnown: true,
                deviceId: "device",
                connectionId: "connection-read-only",
                authenticated: true,
                source: "native-handshake" as const
              };
            }
          } as OpenClawGatewayClient
        };
      },
      async getNativeUpdateStatus() {
        throw new Error("update.status must not be called without operator.admin");
      }
    })
  });

  assert.equal(snapshot.runtime.status, "healthy");
  assert.equal(snapshot.update.readStatus, "forbidden");
  assert.equal(snapshot.update.status, "unavailable");
});

test("native mutation routing does not retry or use a CLI fallback", async () => {
  const calls: string[] = [];
  const adapter = createAdapter({
    async requestNativeGatewayRestart(input) {
      calls.push(`restart:${input?.skipDeferral === false ? "safe" : "unsafe"}`);
      return { ok: true, status: "accepted" };
    },
    async runNativeUpdate() {
      calls.push("update.run");
      return { ok: true, result: { status: "skipped", reason: "restart-unavailable" }, restart: null, handoff: null };
    }
  });

  const restart = await executeNativeDoctorMutation({
    action: "gateway.restart.request",
    input: { reason: "operator recovery", skipDeferral: false }
  }, { adapter });
  const update = await executeNativeDoctorMutation({ action: "update.run" }, { adapter });

  assert.equal(restart.outcome, "accepted");
  assert.equal(update.outcome, "skipped");
  assert.deepEqual(calls, ["restart:safe", "update.run"]);
});

test("native update result status wins over successful RPC transport", () => {
  const skipped = normalizeNativeUpdateRunOutcome({
    ok: true,
    result: { status: "skipped", reason: "external-supervisor-update-required" },
    restart: null,
    handoff: null
  });
  const failed = normalizeNativeUpdateRunOutcome({
    ok: true,
    result: { status: "error", reason: "restart-disabled" },
    restart: null,
    handoff: null
  });
  const succeeded = normalizeNativeUpdateRunOutcome({
    ok: true,
    result: { status: "ok" },
    restart: null,
    handoff: null
  });

  assert.equal(skipped.outcome, "skipped");
  assert.equal(failed.outcome, "failed");
  assert.equal(succeeded.outcome, "succeeded");
});

test("unknown Doctor mutation outcomes are audited as unknown", () => {
  assert.equal(auditResultForNativeDoctorMutation("unknown"), "unknown");
  assert.equal(auditResultForNativeDoctorMutation("failed"), "failed");
  assert.equal(auditResultForNativeDoctorMutation("skipped"), "succeeded");
});

test("accepted restart becomes verified only after a fresh native generation", async () => {
  let generation = 1;
  let subscriptionClosed = false;
  const adapter = createAdapter({
    getNativeConnectionGeneration() {
      return generation;
    },
    async requestNativeGatewayRestart() {
      return { ok: true, status: "scheduled" };
    },
    async subscribeNativeRuntimeEvents(_input, callbacks) {
      generation = 2;
      await callbacks.onReconnected?.({ generation });
      return {
        reconnectManagedByClient: true,
        close() {
          subscriptionClosed = true;
        }
      };
    }
  });
  const before = await getNativeDoctorSnapshot({ adapter });
  const mutation = await executeNativeDoctorMutation({ action: "gateway.restart.request" }, { adapter });
  assert.equal(mutation.outcome, "accepted");
  assert.equal(mutation.verification.status, "not-required");

  const reconciled = await reconcileNativeDoctorMutation(mutation, { before, adapter });
  assert.equal(reconciled.verification.status, "verified");
  assert.equal(reconciled.reconciliation, "confirmed");
  assert.equal(subscriptionClosed, true);
});

test("restart verification rejects the old generation and a different native identity", async () => {
  const before = await getNativeDoctorSnapshot({ adapter: createAdapter({
    getNativeConnectionGeneration() { return 1; }
  }) });
  const oldState = await getNativeDoctorSnapshot({ adapter: createAdapter({
    getNativeConnectionGeneration() { return 1; }
  }) });
  assert.equal(verifyFreshRestartState(before, oldState, 1).status, "unknown");

  const differentIdentity = {
    ...oldState,
    identity: { ...oldState.identity, deviceId: "different-device" }
  };
  assert.equal(verifyFreshRestartState(before, differentIdentity, 2).status, "unknown");
});

test("restart verification requires matching config hashes when config applied restart was the reason", async () => {
  const before = await getNativeDoctorSnapshot({ adapter: createAdapter({
    getNativeConnectionGeneration() { return 1; },
    async getConfigSnapshot() {
      return { valid: true, configRevisionHash: "revision-2", appliedConfigHash: "revision-1" };
    }
  }) });
  const afterApplied = await getNativeDoctorSnapshot({ adapter: createAdapter({
    getNativeConnectionGeneration() { return 2; },
    async getConfigSnapshot() {
      return { valid: true, configRevisionHash: "revision-2", appliedConfigHash: "revision-2" };
    }
  }) });
  const afterMismatch = await getNativeDoctorSnapshot({ adapter: createAdapter({
    getNativeConnectionGeneration() { return 2; },
    async getConfigSnapshot() {
      return { valid: true, configRevisionHash: "revision-2", appliedConfigHash: "revision-1" };
    }
  }) });

  assert.equal(verifyFreshRestartState(before, afterApplied, 2).status, "verified");
  assert.equal(verifyFreshRestartState(before, afterMismatch, 2).status, "unknown");
});

test("skipped and failed native updates do not enter reconnect verification", async () => {
  let subscribed = false;
  const adapter = createAdapter({
    async subscribeNativeRuntimeEvents() {
      subscribed = true;
      throw new Error("skipped update must not subscribe");
    }
  });
  const before = await getNativeDoctorSnapshot({ adapter });
  const skipped = normalizeNativeUpdateRunOutcome({
    ok: true,
    result: { status: "skipped", reason: "restart-disabled" },
    restart: null
  });
  const failed = normalizeNativeUpdateRunOutcome({
    ok: false,
    result: { status: "error", reason: "not-openclaw-root" },
    restart: null
  });
  assert.equal((await reconcileNativeDoctorMutation(skipped, { before, adapter })).outcome, "skipped");
  assert.equal((await reconcileNativeDoctorMutation(failed, { before, adapter })).outcome, "failed");
  assert.equal(subscribed, false);
});

test("ambiguous native mutations are surfaced without a blind retry", async () => {
  let calls = 0;
  const result = await executeNativeDoctorMutation(
    { action: "update.hold" },
    {
      adapter: createAdapter({
        async holdNativeUpdate() {
          calls += 1;
          throw new Error("request timed out after send");
        }
      })
    }
  );

  assert.equal(result.outcome, "unknown");
  assert.equal(calls, 1);
  assert.equal(result.reconciliation, "inconclusive");
});

test("confirmation is tied to the current native connection and channel", () => {
  assert.equal(
    confirmationMatches(
      { connectionId: "connection-1", effectiveChannel: "stable", availableVersion: "2026.9.2" },
      { connectionId: "connection-1", effectiveChannel: "stable", availableVersion: "2026.9.2" }
    ),
    true
  );
  assert.equal(
    confirmationMatches(
      { connectionId: "connection-1", effectiveChannel: "stable", availableVersion: "2026.9.2" },
      { connectionId: "connection-2", effectiveChannel: "stable", availableVersion: "2026.9.2" }
    ),
    false
  );
  assert.equal(
    confirmationMatches(
      { connectionId: "connection-1", effectiveChannel: "stable", availableVersion: "2026.9.2" },
      { connectionId: "connection-1", effectiveChannel: "stable", availableVersion: "2026.9.3" }
    ),
    false
  );
});

test("fresh native update verification rejects a version mismatch", async () => {
  const before = await getNativeDoctorSnapshot({
    adapter: createAdapter({
      async getNativeStatus() {
        return { runtimeVersion: "2026.9.1" };
      },
      async getNativeUpdateStatus() {
        return {
          sentinel: null,
          updateAvailable: {
            currentVersion: "2026.9.1",
            latestVersion: "2026.9.2",
            channel: "stable"
          },
          effectiveChannel: "stable" as const
        };
      }
    })
  });
  const after = await getNativeDoctorSnapshot({
    adapter: createAdapter({
      async getNativeStatus() {
        return { runtimeVersion: "2026.9.1" };
      }
    })
  });

  assert.equal(verifyFreshUpdateState(before, after).status, "unknown");

  const verifiedAfter = await getNativeDoctorSnapshot({
    adapter: createAdapter({
      async getNativeStatus() {
        return { runtimeVersion: "2026.9.2" };
      }
    })
  });
  assert.equal(verifyFreshUpdateState(before, verifiedAfter).status, "verified");
});
