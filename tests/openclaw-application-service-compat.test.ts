import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { clearMissionControlCaches } from "@/lib/openclaw/application/mission-control-service";
import {
  abortMissionTask as abortMissionTaskFromApplication,
  submitMission as submitMissionFromApplication
} from "@/lib/openclaw/application/mission-service";
import {
  getRuntimeOutput as getRuntimeOutputFromApplication,
  getTaskDetail as getTaskDetailFromApplication
} from "@/lib/openclaw/application/runtime-service";
import {
  updateGatewayRemoteUrl as updateGatewayRemoteUrlFromApplication,
  updateWorkspaceRoot as updateWorkspaceRootFromApplication
} from "@/lib/openclaw/application/settings-service";
import {
  abortMissionTask as abortMissionTaskFromCompatibility,
  getRuntimeOutput as getRuntimeOutputFromCompatibility,
  getTaskDetail as getTaskDetailFromCompatibility,
  submitMission as submitMissionFromCompatibility,
  updateGatewayRemoteUrl as updateGatewayRemoteUrlFromCompatibility,
  updateWorkspaceRoot as updateWorkspaceRootFromCompatibility
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

test("mission application service preserves submit validation shape", async () => {
  const input = {
    mission: " "
  };

  assert.equal(
    await readErrorMessage(() => submitMissionFromApplication(input)),
    await readErrorMessage(() => submitMissionFromCompatibility(input))
  );
});

test("mission application service preserves abort missing-task shape", async () => {
  const taskId = "task:missing-application-service-compat";

  assert.equal(
    await readErrorMessage(() => abortMissionTaskFromApplication(taskId)),
    await readErrorMessage(() => abortMissionTaskFromCompatibility(taskId))
  );
});

test("runtime application service preserves missing runtime response shape", async () => {
  const runtimeId = "runtime:missing-application-service-compat";

  assert.deepEqual(
    await getRuntimeOutputFromApplication(runtimeId),
    await getRuntimeOutputFromCompatibility(runtimeId)
  );
});

test("runtime application service preserves missing task error shape", async () => {
  const taskId = "task:missing-runtime-service-compat";

  assert.equal(
    await readErrorMessage(() => getTaskDetailFromApplication(taskId)),
    await readErrorMessage(() => getTaskDetailFromCompatibility(taskId))
  );
});

test("settings application service preserves gateway URL validation shape", async () => {
  assert.equal(
    await readErrorMessage(() => updateGatewayRemoteUrlFromApplication({ gatewayUrl: "https://example.com" })),
    await readErrorMessage(() => updateGatewayRemoteUrlFromCompatibility({ gatewayUrl: "https://example.com" }))
  );
});

test("settings application service preserves workspace root validation shape", async () => {
  assert.equal(
    await readErrorMessage(() => updateWorkspaceRootFromApplication({ workspaceRoot: "relative/path" })),
    await readErrorMessage(() => updateWorkspaceRootFromCompatibility({ workspaceRoot: "relative/path" }))
  );
});
