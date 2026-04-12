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
  mergeSnapshotWithOptimisticTasks,
  resolveGatewayDraft,
  resolveOnboardingAction
} from "@/components/mission-control/mission-control-shell.utils";

test("agent draft helpers keep create flows stable", () => {
  const draft = buildAgentDraft("workspace-1", {
    channelIds: ["alpha", "alpha", "", "beta"]
  });

  assert.equal(draft.workspaceId, "workspace-1");
  assert.deepEqual(draft.channelIds, ["alpha", "beta"]);
  assert.equal(buildScopedAgentId("My Workspace", "Agent Name"), "my-workspace-agent-name");
  assert.equal(
    buildUniqueAgentId([{ id: "my-workspace-agent-name" } as any], "My Workspace", "Agent Name"),
    "my-workspace-agent-name-2"
  );
  assert.equal(applyAgentPreset(draft, "setup").policy.preset, "setup");
});

test("control plane helpers normalize snapshot and onboarding fallback", () => {
  assert.equal(resolveGatewayDraft({ diagnostics: { configuredGatewayUrl: "ws://127.0.0.1:18789/" } } as any), "ws://127.0.0.1:18789");
  assert.equal(
    resolveOnboardingAction({
      diagnostics: { installed: false, rpcOk: false, loaded: false }
    } as any).label,
    "Install OpenClaw"
  );

  const optimisticTask = createOptimisticMissionTaskRecord(
    {
      requestId: "req-1",
      mission: "Ship the change",
      agentId: "agent-1",
      workspaceId: "workspace-1",
      submittedAt: 1_700_000_000_000,
      abortController: new AbortController()
    },
    { agents: [] } as any
  );

  const merged = mergeSnapshotWithOptimisticTasks(
    { tasks: [], agents: [], runtimes: [], diagnostics: {} } as any,
    [{ requestId: "req-1", dispatchId: null, task: optimisticTask.task }]
  );

  assert.equal(merged.tasks.length, 1);
  assert.equal(merged.tasks[0].key, "optimistic:req-1");
});
