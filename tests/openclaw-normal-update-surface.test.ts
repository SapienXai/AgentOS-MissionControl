import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

function read(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("canonical Updates page reads native status and runs native update.run", () => {
  const source = read("components/operations/updates/updates-page-content.tsx");

  assert.match(source, /\/api\/openclaw\/native-doctor/);
  assert.match(source, /action:\s*"update\.run"/);
  assert.match(source, /OpenClaw update\.status/);
  assert.doesNotMatch(source, /\/api\/update/);
  assert.doesNotMatch(source, /--tag/);
  assert.match(source, /Community release intelligence is advisory/);
  assert.match(source, /Community confidence never decides whether OpenClaw is up to date or whether an update runs/);
});

test("normal native update endpoint enforces the shared server policy and target confirmation", () => {
  const route = read("app/api/openclaw/native-doctor/route.ts");
  const policyDomain = read("lib/openclaw/domains/normal-update-policy.ts");
  const policyService = read("lib/openclaw/application/normal-update-policy-service.ts");

  assert.match(route, /getNormalOpenClawUpdatePolicy/);
  assert.match(route, /guardNormalOpenClawUpdate/);
  assert.match(route, /refreshCheckout:\s*true/);
  assert.match(route, /action:\s*z\.literal\("update\.run"\)/);
  assert.match(route, /availableVersion:\s*z\.string\(\)\.nullable\(\)/);
  assert.match(route, /reconcileAgentOsSessionSecurityDefaults/);
  assert.match(route, /UPDATE_SECURITY_POLICY_REQUIRED/);
  assert.doesNotMatch(route, /override\s*:/);
  assert.match(policyDomain, /resolveOpenClawUpdateDecision/);
  assert.doesNotMatch(policyDomain, /compareVersionStrings/);
  assert.match(policyService, /readOpenClawCompatibilityManifestOverride/);
});

test("Settings and Native Doctor link to Updates without duplicate normal update actions", () => {
  const settings = read("components/mission-control/mission-control-shell.settings.tsx");
  const controlCenter = read("components/mission-control/settings-control-center.tsx");
  const doctor = read("components/mission-control/native-doctor-panel.tsx");

  assert.match(settings, /href="\/updates"/);
  assert.doesNotMatch(settings, /onCheckForUpdates\(\)/);
  assert.doesNotMatch(settings, /onOpenUpdateDialog\(recommendedVersion/);
  assert.match(controlCenter, /href="\/updates"/);
  assert.match(controlCenter, /Compatibility Lab/);
  assert.match(doctor, /href="\/updates"/);
  assert.doesNotMatch(doctor, /Run native update/);
});

test("legacy update API remains available for advanced exact-version workflows", () => {
  const source = read("app/api/update/route.ts");

  assert.match(source, /buildOpenClawUpdateArgs/);
  assert.match(source, /rollbackPolicy/);
  assert.match(source, /certificationScorecard/);
});
