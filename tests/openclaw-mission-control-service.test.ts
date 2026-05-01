import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  clearMissionControlCaches as clearApplicationMissionControlCaches,
  getMissionControlSnapshot as getApplicationMissionControlSnapshot
} from "@/lib/openclaw/application/mission-control-service";
import {
  clearMissionControlCaches as clearCompatibilityMissionControlCaches,
  getMissionControlSnapshot as getCompatibilityMissionControlSnapshot
} from "@/lib/openclaw/service";

const snapshotResponseKeys = [
  "agents",
  "channelAccounts",
  "channelRegistry",
  "diagnostics",
  "generatedAt",
  "missionPresets",
  "mode",
  "models",
  "presence",
  "relationships",
  "revision",
  "runtimes",
  "tasks",
  "workspaces"
];

afterEach(() => {
  clearApplicationMissionControlCaches();
});

test("mission control service preserves the compatibility snapshot response shape", async () => {
  clearCompatibilityMissionControlCaches();

  const compatibilitySnapshot = await getCompatibilityMissionControlSnapshot({
    force: true,
    includeHidden: true
  });
  const applicationSnapshot = await getApplicationMissionControlSnapshot({
    includeHidden: true
  });

  assert.deepEqual(Object.keys(compatibilitySnapshot).sort(), snapshotResponseKeys);
  assert.deepEqual(Object.keys(applicationSnapshot).sort(), snapshotResponseKeys);
  assert.deepEqual(applicationSnapshot, compatibilitySnapshot);
});
