import assert from "node:assert/strict";
import { test } from "node:test";

import {
  bindWorkspaceChannelAgent as bindApplicationWorkspaceChannelAgent,
  deleteWorkspaceChannelEverywhere as deleteApplicationWorkspaceChannelEverywhere,
  disconnectWorkspaceChannel as disconnectApplicationWorkspaceChannel,
  setWorkspaceChannelGroups as setApplicationWorkspaceChannelGroups,
  setWorkspaceChannelPrimary as setApplicationWorkspaceChannelPrimary,
  unbindWorkspaceChannelAgent as unbindApplicationWorkspaceChannelAgent,
  upsertWorkspaceChannel as upsertApplicationWorkspaceChannel
} from "@/lib/openclaw/application/channel-service";
import {
  bindWorkspaceChannelAgent as bindCompatibilityWorkspaceChannelAgent,
  deleteWorkspaceChannelEverywhere as deleteCompatibilityWorkspaceChannelEverywhere,
  disconnectWorkspaceChannel as disconnectCompatibilityWorkspaceChannel,
  setWorkspaceChannelGroups as setCompatibilityWorkspaceChannelGroups,
  setWorkspaceChannelPrimary as setCompatibilityWorkspaceChannelPrimary,
  unbindWorkspaceChannelAgent as unbindCompatibilityWorkspaceChannelAgent,
  upsertWorkspaceChannel as upsertCompatibilityWorkspaceChannel
} from "@/lib/openclaw/service";

async function readErrorMessage(action: () => Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  throw new Error("Expected action to throw.");
}

test("channel application service preserves upsert validation shape", async () => {
  const input = {
    workspaceId: "workspace:test",
    workspacePath: "/tmp/workspace-test",
    channelId: " ",
    type: "telegram",
    name: "Test"
  };

  assert.equal(
    await readErrorMessage(() => upsertApplicationWorkspaceChannel(input)),
    await readErrorMessage(() => upsertCompatibilityWorkspaceChannel(input))
  );
});

test("channel application service preserves disconnect validation shape", async () => {
  const input = {
    workspaceId: "workspace:test",
    channelId: " "
  };

  assert.equal(
    await readErrorMessage(() => disconnectApplicationWorkspaceChannel(input)),
    await readErrorMessage(() => disconnectCompatibilityWorkspaceChannel(input))
  );
});

test("channel application service preserves delete missing-channel shape", async () => {
  const input = {
    channelId: "missing-channel-characterization"
  };

  assert.equal(
    await readErrorMessage(() => deleteApplicationWorkspaceChannelEverywhere(input)),
    await readErrorMessage(() => deleteCompatibilityWorkspaceChannelEverywhere(input))
  );
});

test("channel application service preserves primary missing-channel shape", async () => {
  const input = {
    channelId: "missing-channel-characterization",
    primaryAgentId: null
  };

  assert.equal(
    await readErrorMessage(() => setApplicationWorkspaceChannelPrimary(input)),
    await readErrorMessage(() => setCompatibilityWorkspaceChannelPrimary(input))
  );
});

test("channel application service preserves group missing-channel shape", async () => {
  const input = {
    channelId: "missing-channel-characterization",
    workspaceId: "workspace:test",
    groupAssignments: []
  };

  assert.equal(
    await readErrorMessage(() => setApplicationWorkspaceChannelGroups(input)),
    await readErrorMessage(() => setCompatibilityWorkspaceChannelGroups(input))
  );
});

test("channel application service preserves bind validation shape", async () => {
  const input = {
    channelId: " ",
    workspaceId: "workspace:test",
    workspacePath: "/tmp/workspace-test",
    agentId: " "
  };

  assert.equal(
    await readErrorMessage(() => bindApplicationWorkspaceChannelAgent(input)),
    await readErrorMessage(() => bindCompatibilityWorkspaceChannelAgent(input))
  );
});

test("channel application service preserves unbind validation shape", async () => {
  const input = {
    channelId: " ",
    workspaceId: "workspace:test",
    agentId: " "
  };

  assert.equal(
    await readErrorMessage(() => unbindApplicationWorkspaceChannelAgent(input)),
    await readErrorMessage(() => unbindCompatibilityWorkspaceChannelAgent(input))
  );
});
