import assert from "node:assert/strict";
import { test } from "node:test";

import { createRuntimeEvidence } from "@/lib/openclaw/runtime-certification/evidence-model";
import { bridgeOpenClawStaticRuntimeEvidence } from "@/lib/openclaw/runtime-certification/evidence-bridge";
import type {
  OpenClawRuntimeCertificationReport,
  OpenClawRuntimeCertificationResult
} from "@/lib/openclaw/runtime-certification/types";
import type { OpenClawServerMethodContractDiffReport } from "@/lib/openclaw/types";

test("evidence bridge certifies only an exact target-version method proof", () => {
  const result = bridgeOpenClawStaticRuntimeEvidence({
    staticReport: createStaticReport({
      targetVersion: "2026.9.1",
      changes: [{ method: "sessions.create", status: "unknown", authorizationEvidence: "runtime-required" }]
    }),
    runtimeReport: createRuntimeReport({
      targetVersion: "2026.9.1",
      results: [runtimeResult("sessions.create", "PASS", createRuntimeEvidence({ availability: "proven", authorization: "proven", positiveExecution: "proven", responseShape: "proven" }))]
    })
  });

  assert.equal(result.runtimeVersionMatched, true);
  assert.equal(result.rows[0]?.outcome, "certified");
  assert.equal(result.summary.certified, 1);
});

test("evidence bridge ignores a proof for the wrong method", () => {
  const result = bridgeOpenClawStaticRuntimeEvidence({
    staticReport: createStaticReport({
      targetVersion: "2026.9.1",
      changes: [{ method: "sessions.create", status: "unknown", authorizationEvidence: "runtime-required" }]
    }),
    runtimeReport: createRuntimeReport({
      targetVersion: "2026.9.1",
      results: [runtimeResult("sessions.patch", "PASS", createRuntimeEvidence({ availability: "proven", positiveExecution: "proven", responseShape: "proven" }))]
    })
  });

  assert.equal(result.rows[0]?.outcome, "uncertified");
  assert.equal(result.summary.uncertified, 1);
});

test("evidence bridge ignores a proof for the wrong target version", () => {
  const result = bridgeOpenClawStaticRuntimeEvidence({
    staticReport: createStaticReport({
      targetVersion: "2026.9.1",
      changes: [{ method: "sessions.create", status: "warning", authorizationEvidence: "static" }]
    }),
    runtimeReport: createRuntimeReport({
      targetVersion: "2026.8.1",
      results: [runtimeResult("sessions.create", "PASS", createRuntimeEvidence({ availability: "proven", positiveExecution: "proven", responseShape: "proven" }))]
    })
  });

  assert.equal(result.runtimeVersionMatched, false);
  assert.equal(result.rows[0]?.outcome, "static-only");
  assert.match(result.rows[0]?.reason ?? "", /exactly match/);
});

test("evidence bridge lets a failed runtime proof override static optimism", () => {
  const result = bridgeOpenClawStaticRuntimeEvidence({
    staticReport: createStaticReport({
      targetVersion: "2026.9.1",
      changes: [{ method: "talk.config", status: "safe", authorizationEvidence: "static" }]
    }),
    runtimeReport: createRuntimeReport({
      targetVersion: "2026.9.1",
      results: [runtimeResult("talk.config", "FAIL", createRuntimeEvidence({ availability: "proven", positiveExecution: "failed" }))]
    })
  });

  assert.equal(result.rows[0]?.outcome, "failed");
  assert.equal(result.summary.failed, 1);
});

test("evidence bridge keeps authorization denial partial until positive execution exists", () => {
  const result = bridgeOpenClawStaticRuntimeEvidence({
    staticReport: createStaticReport({
      targetVersion: "2026.9.1",
      changes: [{ method: "node.invoke", status: "unknown", authorizationEvidence: "runtime-required" }]
    }),
    runtimeReport: createRuntimeReport({
      targetVersion: "2026.9.1",
      results: [runtimeResult("node.invoke", "EXPECTED-DENIAL", createRuntimeEvidence({ availability: "proven", authorization: "proven" }), "authorization-denial")]
    })
  });

  assert.equal(result.rows[0]?.outcome, "partially-certified");
  assert.equal(result.rows[0]?.runtimeOperation?.evidenceDimensions.positiveExecution, "not-tested");
});

test("evidence bridge promotes combined positive and denial proofs", () => {
  const result = bridgeOpenClawStaticRuntimeEvidence({
    staticReport: createStaticReport({
      targetVersion: "2026.9.1",
      changes: [{ method: "chat.send", status: "unknown", authorizationEvidence: "runtime-required" }]
    }),
    runtimeReport: createRuntimeReport({
      targetVersion: "2026.9.1",
      results: [
        runtimeResult("chat.send", "PASS", createRuntimeEvidence({ availability: "proven", positiveExecution: "proven", responseShape: "proven" })),
        runtimeResult("chat.send", "EXPECTED-DENIAL", createRuntimeEvidence({ availability: "proven", authorization: "proven" }), "authorization-denial")
      ]
    })
  });

  assert.equal(result.rows[0]?.outcome, "certified");
});

function runtimeResult(
  method: string,
  status: "PASS" | "FAIL" | "SKIPPED" | "EXPECTED-DENIAL",
  evidenceDimensions: OpenClawRuntimeCertificationResult["evidenceDimensions"],
  proofKind: OpenClawRuntimeCertificationResult["proofKind"] = status === "EXPECTED-DENIAL" ? "authorization-denial" : status === "PASS" ? "positive" : "skip"
): OpenClawRuntimeCertificationResult {
  return {
    id: `${method}-${status}`,
    operationId: method,
    operation: method,
    method,
    requirementLevel: "required",
    requiredEvidenceDimensions: ["availability", "authorization", "positiveExecution", "responseShape"],
    requirementRationale: "Runtime proof is required by the test.",
    actualRole: "operator",
    actualScopes: ["operator.admin"],
    expectedOutcome: status === "SKIPPED" ? "not-tested" : status === "EXPECTED-DENIAL" ? "authorization-denied" : "positive",
    actualOutcome: status === "EXPECTED-DENIAL" ? "authorization-denied" : status === "SKIPPED" ? "skip" : status === "FAIL" ? "failure" : "positive",
    status,
    proofKind,
    evidenceDimensions,
    responseShape: status === "PASS" ? "valid" : "unknown",
    errorCode: status === "FAIL" ? "RUNTIME_ERROR" : null,
    errorMessage: status === "FAIL" ? "runtime failure" : null,
    failureKind: status === "FAIL" ? "runtime-error" : status === "EXPECTED-DENIAL" ? "authorization-denied" : "none",
    retryable: false,
    evidence: []
  };
}

function createRuntimeReport(input: {
  targetVersion: string;
  results: OpenClawRuntimeCertificationReport["results"];
}): OpenClawRuntimeCertificationReport {
  return {
    schemaVersion: 2,
    generatedAt: "2026-08-31T00:00:00.000Z",
    targetVersion: input.targetVersion,
    gatewayUrl: "ws://127.0.0.1:28789",
    installedVersion: input.targetVersion,
    buildId: "build",
    protocolVersion: 4,
    role: "operator",
    scopes: ["operator.admin"],
    advertisedMethods: [],
    advertisedEvents: [],
    capabilities: [],
    methodCount: 0,
    eventCount: 0,
    connectionStatus: "connected",
    operations: [],
    results: input.results,
    summary: {
      total: input.results.length,
      passed: input.results.filter((result) => result.status === "PASS").length,
      failed: input.results.filter((result) => result.status === "FAIL").length,
      skipped: input.results.filter((result) => result.status === "SKIPPED").length,
      expectedDenials: input.results.filter((result) => result.status === "EXPECTED-DENIAL").length,
      unknown: 0,
      requiredFailures: 0
    }
  };
}

function createStaticReport(input: {
  targetVersion: string;
  changes: Array<{
    method: string;
    status: "safe" | "warning" | "blocker" | "unknown";
    authorizationEvidence: "static" | "runtime-required";
  }>;
}): OpenClawServerMethodContractDiffReport {
  return {
    generatedAt: "2026-08-31T00:00:00.000Z",
    source: "github-static",
    currentVersion: "2026.6.11",
    targetVersion: input.targetVersion,
    status: "unknown",
    currentMethodCount: null,
    targetMethodCount: null,
    currentRegisteredMethodCount: null,
    targetRegisteredMethodCount: null,
    changedFiles: [],
    changedServerMethodFiles: [],
    changedProtocolFiles: [],
    changes: input.changes.map((change) => ({
      ...change,
      kind: "scope-changed" as const,
      currentScope: "operator.read",
      targetScope: "dynamic",
      affectedOperations: [],
      message: "test static evidence"
    })),
    blockerCount: 0,
    warningCount: 0,
    unknownCount: input.changes.filter((change) => change.status === "unknown").length,
    renamedCount: 0,
    replacedCount: 0,
    summary: "test static evidence",
    error: null
  };
}
