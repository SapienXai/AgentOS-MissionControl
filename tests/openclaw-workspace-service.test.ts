import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  clearMissionControlCaches
} from "@/lib/openclaw/application/mission-control-service";
import {
  createWorkspaceProject as createApplicationWorkspaceProject,
  deleteWorkspaceProject as deleteApplicationWorkspaceProject,
  readWorkspaceEditSeed as readApplicationWorkspaceEditSeed,
  updateWorkspaceProject as updateApplicationWorkspaceProject
} from "@/lib/openclaw/application/workspace-service";
import {
  createWorkspaceProject as createCompatibilityWorkspaceProject,
  deleteWorkspaceProject as deleteCompatibilityWorkspaceProject,
  readWorkspaceEditSeed as readCompatibilityWorkspaceEditSeed,
  updateWorkspaceProject as updateCompatibilityWorkspaceProject
} from "@/lib/openclaw/service";

async function readErrorMessage(action: () => Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  throw new Error("Expected action to throw.");
}

afterEach(() => {
  clearMissionControlCaches();
});

test("workspace application service preserves edit seed missing-workspace shape", async () => {
  clearMissionControlCaches();

  const missingWorkspaceId = "workspace:missing-characterization";

  assert.equal(
    await readErrorMessage(() => readApplicationWorkspaceEditSeed(missingWorkspaceId)),
    await readErrorMessage(() => readCompatibilityWorkspaceEditSeed(missingWorkspaceId))
  );
});

test("workspace application service preserves create validation shape", async () => {
  const input = {
    name: "No Agents",
    agents: []
  };

  assert.equal(
    await readErrorMessage(() => createApplicationWorkspaceProject(input)),
    await readErrorMessage(() => createCompatibilityWorkspaceProject(input))
  );
});

test("workspace application service preserves update validation shape", async () => {
  const input = {
    workspaceId: " "
  };

  assert.equal(
    await readErrorMessage(() => updateApplicationWorkspaceProject(input)),
    await readErrorMessage(() => updateCompatibilityWorkspaceProject(input))
  );
});

test("workspace application service preserves delete validation shape", async () => {
  const input = {
    workspaceId: " "
  };

  assert.equal(
    await readErrorMessage(() => deleteApplicationWorkspaceProject(input)),
    await readErrorMessage(() => deleteCompatibilityWorkspaceProject(input))
  );
});
