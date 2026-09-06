import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { OPENCLAW_STATIC_METHOD_SCOPES } from "@/lib/openclaw/identity/contract";
import { nativeUpdateStatusPayloadSchema } from "@/lib/openclaw/client/native-ws-gateway-payloads";

const root = process.cwd();

test("machine-checkable 9.1 to 9.2 contract diff records the durable update and security changes", async () => {
  const diff = JSON.parse(await readFile(path.join(root, "docs/evidence/openclaw-2026.9.1-to-2026.9.2-contract-diff.json"), "utf8")) as {
    status: string;
    to: { openclawVersion: string; sourceCommit: string; buildId: string };
    gatewayMethods: { added: string[]; scopeChanges: string[] };
    schemaChanges: Array<{ method?: string; field?: string; event?: string }>;
    securityBehaviorChanges: Array<{ setting?: string; behavior?: string }>;
  };

  assert.equal(diff.status, "certified-with-trusted-gateway-boundary");
  assert.equal(diff.to.openclawVersion, "2026.9.2");
  assert.equal(diff.to.sourceCommit, "3928bad9badfcb6c7d140530435e806fb8092190");
  assert.match(diff.to.buildId, /^2026\.9\.2-release-/);
  assert.deepEqual(diff.gatewayMethods.added, ["update.runs.get", "update.runs.list"]);
  assert.deepEqual(diff.gatewayMethods.scopeChanges, []);
  assert.equal(diff.schemaChanges.some((entry) => entry.method === "update.status" && entry.field === "activeRun"), true);
  assert.equal(diff.schemaChanges.some((entry) => entry.method === "update.status" && entry.field === "lastRun"), true);
  assert.equal(diff.schemaChanges.some((entry) => entry.event === "update.run.changed"), true);
  assert.equal(diff.securityBehaviorChanges.some((entry) => entry.setting === "tools.sessions.visibility"), true);
  assert.equal(diff.securityBehaviorChanges.some((entry) => entry.setting === "tools.agentToAgent.enabled"), true);
});

test("9.2 native update status accepts bounded durable run records", () => {
  const parsed = nativeUpdateStatusPayloadSchema.parse({
    sentinel: null,
    updateAvailable: null,
    effectiveChannel: "stable",
    activeRun: {
      runId: "run-9-2",
      createdAtMs: 1,
      updatedAtMs: 2,
      trigger: "control-ui",
      phase: "verifying",
      status: "running",
      reason: null,
      verification: { versionMatch: false }
    },
    lastRun: null
  });

  assert.equal(parsed.activeRun?.phase, "verifying");
  assert.deepEqual(parsed.lastRun, null);
  assert.equal(OPENCLAW_STATIC_METHOD_SCOPES["update.runs.get"]?.[0], "operator.admin");
  assert.equal(OPENCLAW_STATIC_METHOD_SCOPES["update.runs.list"]?.[0], "operator.admin");
});
