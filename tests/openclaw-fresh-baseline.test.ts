import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { getOpenClawInstallCommand } from "@/lib/openclaw/install";
import { LOCAL_OPENCLAW_COMPATIBILITY_MANIFEST, resolveOpenClawUpdateDecision } from "@/lib/openclaw/update-compatibility";
import {
  OPENCLAW_RECOMMENDED_VERSION,
  OPENCLAW_SUPPORTED_BASELINE_VERSION
} from "@/lib/openclaw/versions";

test("OpenClaw 2026.9.2 is the recommended fresh baseline while 9.1 remains supported", () => {
  assert.equal(OPENCLAW_RECOMMENDED_VERSION, "2026.9.2");
  assert.equal(OPENCLAW_SUPPORTED_BASELINE_VERSION, "2026.9.1");
  assert.equal(LOCAL_OPENCLAW_COMPATIBILITY_MANIFEST.recommendedVersion, "2026.9.2");
  assert.deepEqual(
    LOCAL_OPENCLAW_COMPATIBILITY_MANIFEST.versions.find((entry) => entry.version === "2026.9.2"),
    {
      version: "2026.9.2",
      status: "certified",
      minRequiredAgentOsVersion: "0.7.2",
      notes: "Recommended stable OpenClaw version for AgentOS Gateway-first operation.",
      reason: "Recommended for current AgentOS compatibility diagnostics and runtime smoke coverage."
    }
  );
});

test("fresh installer contract provisions the promoted baseline directly", () => {
  const command = getOpenClawInstallCommand();
  assert.match(command, new RegExp(`(?:--version|-Tag)\\s+${OPENCLAW_RECOMMENDED_VERSION}`));
  assert.doesNotMatch(command, /update\s+--tag/);
});

test("the historical 6.11 runtime is below the promoted normal-support baseline", () => {
  const decision = resolveOpenClawUpdateDecision({
    agentOsVersion: "0.7.6",
    targetVersion: "2026.6.11",
    mode: "recommended"
  });

  assert.equal(decision.status, "blocked");
  assert.equal(decision.allowed, false);
  assert.equal(decision.defaultVisible, false);
  assert.match(decision.reason, /AgentOS requires OpenClaw 2026\.9\.1 or newer/);
});

test("fresh baseline certification does not invoke the historical migration engine", () => {
  const source = readFileSync(path.join(process.cwd(), "scripts/openclaw-fresh-baseline-e2e.ts"), "utf8");
  const evidence = JSON.parse(readFileSync(
    path.join(process.cwd(), "docs/evidence/openclaw-2026.9.2-fresh-baseline.json"),
    "utf8"
  )) as {
    success?: boolean;
    freshState?: Record<string, unknown>;
    checks?: Record<string, unknown>;
    cleanup?: Record<string, unknown>;
  };

  assert.doesNotMatch(source, /OpenClawMigrationEngine/);
  assert.doesNotMatch(source, /openclaw-migration-e2e/);
  assert.match(source, /sourceStateProvided: false/);
  assert.match(source, /noHistoricalMigrationFixture: true/);
  assert.match(source, /migrationEngineInvoked: false/);
  assert.match(source, /OPENCLAW \$\{TARGET_LABEL\} FRESH BASELINE: PASS/);
  assert.equal(evidence.success, true);
  assert.equal(evidence.freshState?.sourceStateProvided, false);
  assert.equal(evidence.freshState?.historicalMigrationFixtureUsed, false);
  assert.equal(evidence.freshState?.migrationEngineInvoked, false);
  assert.equal(evidence.freshState?.migrationJournalAbsentBeforeCleanup, true);
  assert.equal(evidence.checks?.noHistoricalMigrationFixture, true);
  assert.equal(evidence.checks?.noMigrationJournalBeforeCleanup, true);
  assert.equal(evidence.cleanup?.status, "complete");
});

test("historical migration infrastructure remains pinned to the 6.11 fixture", () => {
  const source = readFileSync(path.join(process.cwd(), "lib/openclaw/migration-engine/engine.ts"), "utf8");

  assert.match(source, /OPENCLAW_PHASE_2B_SOURCE_VERSION = "2026\.6\.11"/);
  assert.match(source, /OPENCLAW_PHASE_2B_TARGET_VERSION = OPENCLAW_SUPPORTED_BASELINE_VERSION/);
});
