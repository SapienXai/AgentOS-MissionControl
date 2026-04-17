import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyAgentPreset,
  buildAgentDraft,
  buildScopedAgentId,
  buildUniqueAgentId
} from "@/components/mission-control/create-agent-dialog.utils";
import {
  createOptimisticMissionTaskRecord,
  buildWorkspaceSelectionStorageKey,
  mergeSnapshotWithOptimisticTasks,
  resolveGatewayDraft,
  resolveOnboardingAction,
  serializeWorkspaceSelection,
  resolveWorkspaceSelection
} from "@/components/mission-control/mission-control-shell.utils";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";

test("agent draft helpers keep create flows stable", () => {
  const draft = buildAgentDraft("workspace-1", {
    channelIds: ["alpha", "alpha", "", "beta"]
  });
  const existingAgents = [{ id: "my-workspace-agent-name" }] as unknown as MissionControlSnapshot["agents"];

  assert.equal(draft.workspaceId, "workspace-1");
  assert.deepEqual(draft.channelIds, ["alpha", "beta"]);
  assert.equal(buildScopedAgentId("My Workspace", "Agent Name"), "my-workspace-agent-name");
  assert.equal(buildUniqueAgentId(existingAgents, "My Workspace", "Agent Name"), "my-workspace-agent-name-2");
  assert.equal(applyAgentPreset(draft, "setup").policy.preset, "setup");
});

test("control plane helpers normalize snapshot and onboarding fallback", () => {
  const gatewaySnapshot = {
    diagnostics: { configuredGatewayUrl: "ws://127.0.0.1:18789/" }
  } as unknown as MissionControlSnapshot;
  const onboardingSnapshot = {
    diagnostics: { installed: false, rpcOk: false, loaded: false }
  } as unknown as MissionControlSnapshot;
  const emptySnapshot = {
    agents: [],
    diagnostics: {},
    runtimes: [],
    tasks: []
  } as unknown as MissionControlSnapshot;

  assert.equal(resolveGatewayDraft(gatewaySnapshot), "ws://127.0.0.1:18789");
  assert.equal(resolveOnboardingAction(onboardingSnapshot).label, "Install OpenClaw");

  const optimisticTask = createOptimisticMissionTaskRecord(
    {
      requestId: "req-1",
      mission: "Ship the change",
      agentId: "agent-1",
      workspaceId: "workspace-1",
      submittedAt: 1_700_000_000_000,
      abortController: new AbortController()
    },
    emptySnapshot
  );

  const merged = mergeSnapshotWithOptimisticTasks(
    emptySnapshot,
    [{ requestId: "req-1", dispatchId: null, task: optimisticTask.task }]
  );

  assert.equal(merged.tasks.length, 1);
  assert.equal(merged.tasks[0].key, "optimistic:req-1");
});

test("workspace selection helpers keep the last valid workspace", () => {
  assert.equal(
    buildWorkspaceSelectionStorageKey("/tmp/workspaces"),
    "mission-control-active-workspace-id:/tmp/workspaces"
  );
  assert.equal(serializeWorkspaceSelection(null), "__all__");
  assert.equal(resolveWorkspaceSelection(["workspace-a", "workspace-b"], "workspace-b"), "workspace-b");
  assert.equal(resolveWorkspaceSelection(["workspace-a", "workspace-b"], "workspace-missing"), "workspace-a");
  assert.equal(
    resolveWorkspaceSelection(["workspace-a", "workspace-b"], null, "workspace-b"),
    "workspace-b"
  );
  assert.equal(resolveWorkspaceSelection(["workspace-a", "workspace-b"], "__all__"), null);
  assert.equal(resolveWorkspaceSelection([], "workspace-missing"), null);
});
