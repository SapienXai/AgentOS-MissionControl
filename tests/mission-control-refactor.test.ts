import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  applyAgentPreset,
  buildAgentDraft,
  buildScopedAgentId,
  buildUniqueAgentId,
  isSnapshotModelUsable,
  resolveSuggestedAgentModelId
} from "@/components/mission-control/create-agent-dialog.utils";
import {
  buildPendingAgentsForWorkspaceResult,
  buildPendingWorkspaceMenuEntries,
  parsePendingAgentProjections
} from "@/components/mission-control/pending-agent-projection";
import {
  createOptimisticMissionTaskRecord,
  buildLaunchpadWorkspaceHandoffProgress,
  buildWorkspaceSelectionStorageKey,
  hasCompleteAgentOSWorkspaceSnapshot,
  hasAgentOSWorkspaceSetup,
  mergeSnapshotWithOptimisticTasks,
  resolveGatewayDraft,
  resolveLaunchpadWorkspaceSetupReadiness,
  resolveOpenClawInstallSummary,
  resolveOnboardingAction,
  serializeWorkspaceSelection,
  shouldShowOnboardingLaunchpad,
  resolveWorkspaceSelection,
  resolveWorkspaceContextEngineAgent,
  shouldDeferWorkspaceSelectionHydration
} from "@/components/mission-control/mission-control-shell.utils";
import { shouldPreserveComposerOnBlur } from "@/components/mission-control/command-bar.utils";
import {
  resolveChatGptRecoveryMessage,
  resolveChatGptOnboardingState,
  resolveInitialOnboardingModelId,
  resolveOnboardingModelSelection,
  OPENAI_ONBOARDING_DEFAULT_MODEL_ID,
  ONBOARDING_DEFAULT_THINKING
} from "@/components/mission-control/openclaw-onboarding.utils";
import { preserveMissionControlSnapshotCollections } from "@/hooks/use-mission-control-data";
import { OPENCLAW_RECOMMENDED_VERSION } from "@/lib/openclaw/versions";
import type { MissionControlSnapshot, OperationProgressSnapshot } from "@/lib/agentos/contracts";

const rootDir = process.cwd();

test("onboarding model selection follows live OpenClaw readiness metadata", () => {
  const models = [
    { id: "openai/gpt-5.6-terra" },
    { id: "openai/gpt-5.6-sol" },
    { id: "openai/gpt-5.6-luna" }
  ];

  assert.equal(
    resolveOnboardingModelSelection(
      {
        resolvedDefaultModel: "openai/gpt-5.6-sol",
        recommendedModelId: "openai/gpt-5.6-terra",
        defaultModel: "openai/gpt-5.6-luna"
      },
      models
    ),
    OPENAI_ONBOARDING_DEFAULT_MODEL_ID
  );
  assert.equal(
    resolveOnboardingModelSelection(
      {
        resolvedDefaultModel: "openai/gpt-5.6-unknown",
        recommendedModelId: "openai/gpt-5.6-luna",
        defaultModel: "openai/gpt-5.6-terra"
      },
      models
    ),
    "openai/gpt-5.6-luna"
  );
  assert.equal(
    resolveOnboardingModelSelection(
      {
        resolvedDefaultModel: null,
        recommendedModelId: null,
        defaultModel: null
      },
      models
    ),
    OPENAI_ONBOARDING_DEFAULT_MODEL_ID
  );
  assert.equal(
    resolveOnboardingModelSelection(
      {
        resolvedDefaultModel: "ollama/jonathan-qwen38-q4:latest",
        recommendedModelId: OPENAI_ONBOARDING_DEFAULT_MODEL_ID,
        defaultModel: "ollama/jonathan-qwen38-q4:latest"
      },
      [
        { id: OPENAI_ONBOARDING_DEFAULT_MODEL_ID },
        { id: "ollama/jonathan-qwen38-q4:latest" }
      ]
    ),
    "ollama/jonathan-qwen38-q4:latest"
  );
});

test("ChatGPT onboarding exposes a recoverable Codex plugin setup error", () => {
  assert.match(
    resolveChatGptRecoveryMessage(
      'Plugin "codex" requires capability consent before it can be enabled.'
    ),
    /official Codex plugin enabled with its required capability consent/
  );
});

test("ChatGPT onboarding explains a post-auth model refresh failure", () => {
  assert.match(
    resolveChatGptRecoveryMessage(
      "ChatGPT sign-in completed, but OpenClaw is still refreshing the account and model catalog. Try again in a moment."
    ),
    /could not refresh the model catalog yet/
  );
});

test("ChatGPT onboarding explains a missing OpenClaw device scope", () => {
  assert.match(
    resolveChatGptRecoveryMessage("OpenClaw Gateway rejected the request: missing scope: operator.read"),
    /local device access needs operator scope/
  );
});

test("ChatGPT onboarding preserves the browser-auth state machine", () => {
  assert.equal(
    resolveChatGptOnboardingState({
      runState: "running",
      phase: "authenticating",
      modelReady: false
    }),
    "connecting"
  );
  assert.equal(
    resolveChatGptOnboardingState({
      runState: "running",
      phase: "verifying",
      modelReady: false
    }),
    "verifying"
  );
  assert.equal(
    resolveChatGptOnboardingState({
      runState: "success",
      phase: null,
      modelReady: false,
      chatGptConnected: true
    }),
    "needs-model"
  );
  assert.equal(
    resolveChatGptOnboardingState({
      runState: "idle",
      phase: null,
      modelReady: true
    }),
    "ready"
  );
  assert.equal(
    resolveChatGptOnboardingState({
      runState: "error",
      phase: "authenticating",
      modelReady: false
    }),
    "error"
  );
});

test("mission composer keeps internal controls open during blur transitions", () => {
  const commandBarSource = readFileSync(path.join(rootDir, "components/mission-control/command-bar.tsx"), "utf8");

  assert.match(commandBarSource, /onPointerDownCapture=\{\(\) => \{\s*pointerDownInsideRef\.current = true;/);
  assert.doesNotMatch(commandBarSource, /queueMicrotask\(\(\) => \{ pointerDownInsideRef\.current = false;/);
  assert.match(commandBarSource, /window\.addEventListener\("pointerup", resetPointerDownInside\)/);
  assert.match(commandBarSource, /shouldPreserveComposerOnBlur\(\{/);

  assert.equal(
    shouldPreserveComposerOnBlur({
      pointerDownInside: true,
      relatedTargetInside: false,
      activeElementInside: false
    }),
    true
  );
  assert.equal(
    shouldPreserveComposerOnBlur({
      pointerDownInside: false,
      relatedTargetInside: true,
      activeElementInside: false
    }),
    true
  );
  assert.equal(
    shouldPreserveComposerOnBlur({
      pointerDownInside: false,
      relatedTargetInside: false,
      activeElementInside: true
    }),
    true
  );
  assert.equal(
    shouldPreserveComposerOnBlur({
      pointerDownInside: false,
      relatedTargetInside: false,
      activeElementInside: false
    }),
    false
  );
});

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

test("workspace Context Engine selects only the preferred agent in that workspace", () => {
  const agents = [
    { id: "other-default", workspaceId: "other", isDefault: true, status: "engaged" },
    { id: "workspace-idle", workspaceId: "workspace", isDefault: false, status: "idle" },
    { id: "workspace-engaged", workspaceId: "workspace", isDefault: false, status: "engaged" },
    { id: "workspace-default", workspaceId: "workspace", isDefault: true, status: "idle" }
  ] as MissionControlSnapshot["agents"];

  assert.equal(resolveWorkspaceContextEngineAgent(agents, "workspace")?.id, "workspace-default");
  assert.equal(resolveWorkspaceContextEngineAgent(agents.slice(0, 3), "workspace")?.id, "workspace-engaged");
  assert.equal(resolveWorkspaceContextEngineAgent(agents.slice(0, 2), "workspace")?.id, "workspace-idle");
  assert.equal(resolveWorkspaceContextEngineAgent(agents, "missing"), null);
});

test("pending agent projections survive remount while live snapshot catches up", () => {
  const pending = parsePendingAgentProjections(JSON.stringify([
    {
      id: "workspace-aslans-chinesse-builder-manyak-musti",
      workspaceId: "workspace-aslans-chinesse-builder",
      workspacePath: "/tmp/workspace",
      name: "Manyak Musti",
      modelId: "openai/gpt-5.4-mini",
      emoji: "M",
      theme: "Build",
      policy: {
        preset: "worker",
        missingToolBehavior: "fallback",
        installScope: "workspace",
        fileAccess: "workspace-only",
        networkAccess: "restricted"
      },
      heartbeat: {
        enabled: false
      },
      skills: [],
      tools: [],
      createdAt: 1_000
    }
  ]), 2_000);

  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.name, "Manyak Musti");
  assert.equal(pending[0]?.id, "workspace-aslans-chinesse-builder-manyak-musti");
});

test("pending workspace menu entries keep creating workspaces reachable", () => {
  const pending = parsePendingAgentProjections(JSON.stringify([
    {
      id: "tortellini-builder",
      workspaceId: "tortellini",
      workspacePath: "/tmp/tortellini",
      workspaceName: "Tortellini",
      name: "Builder",
      modelId: "openai/gpt-5.5",
      policy: {
        preset: "worker",
        missingToolBehavior: "fallback",
        installScope: "workspace",
        fileAccess: "workspace-only",
        networkAccess: "restricted"
      },
      heartbeat: {
        enabled: false
      },
      skills: [],
      tools: [],
      createdAt: 1_000
    },
    {
      id: "tortellini-storm-breaker",
      workspaceId: "tortellini",
      workspacePath: "/tmp/tortellini",
      workspaceName: "Tortellini",
      name: "Storm Breaker",
      modelId: "openai/gpt-5.5",
      policy: {
        preset: "worker",
        missingToolBehavior: "fallback",
        installScope: "workspace",
        fileAccess: "workspace-only",
        networkAccess: "restricted"
      },
      heartbeat: {
        enabled: false
      },
      skills: [],
      tools: [],
      createdAt: 1_000
    }
  ]), 2_000);

  const pendingEntries = buildPendingWorkspaceMenuEntries(pending, new Set());

  assert.deepEqual(pendingEntries, [
    {
      id: "tortellini",
      name: "Tortellini",
      detail: "2 agents creating",
      pending: true,
      createdAt: 1_000
    }
  ]);
  assert.deepEqual(buildPendingWorkspaceMenuEntries(pending, new Set(["tortellini"])), []);
});

test("workspace create results keep display workspace and agent names in pending projections", () => {
  const pending = buildPendingAgentsForWorkspaceResult({
    workspaceId: "tortellini",
    workspaceName: "Tortellini",
    workspacePath: "/tmp/tortellini",
    agentIds: ["tortellini-builder", "tortellini-storm-breaker"],
    primaryAgentId: "tortellini-builder"
  }, 2_000);

  assert.equal(pending[0]?.workspaceName, "Tortellini");
  assert.equal(pending[0]?.name, "Builder");
  assert.equal(pending[1]?.name, "Storm Breaker");
});

test("agent draft model helper prefers workspace and available recommended models when default is missing", () => {
  const snapshot = {
    agents: [
      {
        id: "main",
        workspaceId: "workspace",
        modelId: "openai/gpt-5.4-mini"
      }
    ],
    diagnostics: {
      modelReadiness: {
        defaultModelReady: false,
        defaultModel: null,
        resolvedDefaultModel: null,
        recommendedModelId: "openai/gpt-5.5"
      }
    },
    models: [
      {
        id: "openai/gpt-5.4-mini",
        available: true,
        missing: false
      },
      {
        id: "openai/gpt-5.5",
        available: true,
        missing: false
      }
    ]
  } as unknown as MissionControlSnapshot;

  assert.equal(resolveSuggestedAgentModelId(snapshot, "workspace"), "openai/gpt-5.4-mini");
  assert.equal(resolveSuggestedAgentModelId(snapshot, "other-workspace"), "openai/gpt-5.5");
  assert.equal(isSnapshotModelUsable(snapshot, "openai/gpt-5.4-mini"), true);
  assert.equal(isSnapshotModelUsable(snapshot, "openai/missing"), false);
});

test("agent draft model helper skips unavailable workspace models", () => {
  const snapshot = {
    agents: [
      {
        id: "main",
        workspaceId: "workspace",
        modelId: "openai/gpt-5.4-mini"
      }
    ],
    diagnostics: {
      modelReadiness: {
        defaultModelReady: false,
        defaultModel: null,
        resolvedDefaultModel: null,
        recommendedModelId: "openai/gpt-5.5"
      }
    },
    models: [
      {
        id: "openai/gpt-5.4-mini",
        available: false,
        missing: false
      },
      {
        id: "openai/gpt-5.5",
        available: true,
        missing: false
      }
    ]
  } as unknown as MissionControlSnapshot;

  assert.equal(resolveSuggestedAgentModelId(snapshot, "workspace"), "openai/gpt-5.5");
  assert.equal(isSnapshotModelUsable(snapshot, "openai/gpt-5.4-mini"), false);
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
  assert.match(resolveOnboardingAction(onboardingSnapshot).description, new RegExp(OPENCLAW_RECOMMENDED_VERSION));
  assert.equal(
    resolveOnboardingAction(onboardingSnapshot, {
      cliInstalled: true,
      gatewayRegistered: false,
      gatewayReady: false,
      runtimeWritable: false
    }).label,
    "Prepare local gateway"
  );
  assert.equal(
    resolveOnboardingAction(onboardingSnapshot, {
      cliInstalled: true,
      gatewayRegistered: true,
      gatewayReady: false,
      runtimeWritable: false
    }).label,
    "Start OpenClaw"
  );

  const onlineWithoutWorkspace = {
    workspaces: [],
    agents: [],
    diagnostics: {
      installed: true,
      rpcOk: true,
      runtime: {
        stateWritable: true,
        sessionStoreWritable: true
      }
    }
  } as unknown as MissionControlSnapshot;

  assert.equal(resolveOnboardingAction(onlineWithoutWorkspace).label, "Continue setup");

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

  const realTask = {
    ...optimisticTask.task,
    id: "task-real",
    key: "dispatch:dispatch-real",
    dispatchId: "dispatch-real",
    metadata: {
      ...optimisticTask.task.metadata,
      optimistic: false,
      clientRequestId: "req-1"
    }
  };
  const snapshotWithEarlyRuntime = {
    ...emptySnapshot,
    tasks: [realTask]
  };
  const reconciled = mergeSnapshotWithOptimisticTasks(
    snapshotWithEarlyRuntime,
    [{ requestId: "req-1", dispatchId: null, task: optimisticTask.task }]
  );

  assert.deepEqual(reconciled.tasks.map((task) => task.id), ["task-real"]);
});

test("install summary reflects the active install family and root", () => {
  const localPrefixSnapshot = {
    diagnostics: {
      updateRoot: "/Users/kazimakgul/.openclaw/lib/node_modules/openclaw",
      updateInstallKind: "package",
      updatePackageManager: "npm"
    }
  } as unknown as MissionControlSnapshot;
  const gitSnapshot = {
    diagnostics: {
      updateRoot: "/Users/kazimakgul/openclaw",
      updateInstallKind: "git",
      updatePackageManager: "pnpm"
    }
  } as unknown as MissionControlSnapshot;

  assert.equal(resolveOpenClawInstallSummary(localPrefixSnapshot).label, "Local prefix · npm");
  assert.equal(
    resolveOpenClawInstallSummary(localPrefixSnapshot).detail,
    "Install root: ~/.openclaw/lib/node_modules/openclaw · Updater: npm"
  );
  assert.equal(resolveOpenClawInstallSummary(gitSnapshot).label, "Git checkout");
  assert.equal(
    resolveOpenClawInstallSummary(gitSnapshot).detail,
    "Install root: ~/openclaw · Updater: pnpm"
  );
});

test("initial onboarding model uses a ready default without forcing discovery", () => {
  const blankSnapshot = {
    workspaces: [],
    diagnostics: {
      modelReadiness: {
        resolvedDefaultModel: null,
        defaultModel: null,
        recommendedModelId: "openai/gpt-5.4",
        authProviders: [
          {
            provider: "openai",
            connected: false,
            canLogin: true
          }
        ]
      }
    }
  } as unknown as MissionControlSnapshot;
  const staleDefaultSnapshot = {
    workspaces: [],
    diagnostics: {
      modelReadiness: {
        resolvedDefaultModel: "openai/gpt-5.4",
        defaultModel: "openai/gpt-5.4",
        defaultModelReady: false,
        recommendedModelId: "openai/gpt-5.4",
        authProviders: [
          {
            provider: "openai",
            connected: false,
            canLogin: true
          }
        ]
      }
    }
  } as unknown as MissionControlSnapshot;
  const connectedSnapshot = {
    workspaces: [],
    diagnostics: {
      modelReadiness: {
        resolvedDefaultModel: null,
        defaultModel: null,
        recommendedModelId: "openai/gpt-5.4",
        authProviders: [
          {
            provider: "openai",
            connected: true,
            canLogin: true
          }
        ]
      }
    }
  } as unknown as MissionControlSnapshot;
  const readyDefaultSnapshot = {
    workspaces: [],
    diagnostics: {
      modelReadiness: {
        resolvedDefaultModel: "openai/gpt-5.4",
        defaultModel: "openai/gpt-5.4",
        defaultModelReady: true,
        recommendedModelId: "openai/gpt-5.4",
        authProviders: [
          {
            provider: "openai",
            connected: true,
            canLogin: true
          }
        ]
      }
    }
  } as unknown as MissionControlSnapshot;
  const workspaceSnapshot = {
    workspaces: [
      {
        id: "workspace-1"
      }
    ],
    diagnostics: {
      modelReadiness: {
        resolvedDefaultModel: "openai/gpt-5.4",
        defaultModel: "openai/gpt-5.4",
        defaultModelReady: true,
        recommendedModelId: "openai/gpt-5.4",
        authProviders: [
          {
            provider: "openai",
            connected: true,
            canLogin: true
          }
        ]
      }
    }
  } as unknown as MissionControlSnapshot;

  assert.equal(resolveInitialOnboardingModelId(blankSnapshot), null);
  assert.equal(resolveInitialOnboardingModelId(staleDefaultSnapshot), null);
  assert.equal(resolveInitialOnboardingModelId(connectedSnapshot), null);
  assert.equal(resolveInitialOnboardingModelId(readyDefaultSnapshot), "openai/gpt-5.4");
  assert.equal(resolveInitialOnboardingModelId(workspaceSnapshot), "openai/gpt-5.4");
});

test("onboarding prefers the live Luna model and xhigh reasoning defaults", () => {
  const snapshot = {
    models: [
      {
        id: OPENAI_ONBOARDING_DEFAULT_MODEL_ID,
        available: true,
        missing: false
      },
      {
        id: "openai/gpt-5.6-sol",
        available: true,
        missing: false
      }
    ],
    workspaces: [],
    diagnostics: {
      modelReadiness: {
        resolvedDefaultModel: "openai/gpt-5.6-sol",
        defaultModel: "openai/gpt-5.6-sol",
        defaultModelReady: true,
        recommendedModelId: "openai/gpt-5.6-sol",
        authProviders: []
      }
    }
  } as unknown as MissionControlSnapshot;

  assert.equal(resolveInitialOnboardingModelId(snapshot), OPENAI_ONBOARDING_DEFAULT_MODEL_ID);
  assert.equal(ONBOARDING_DEFAULT_THINKING, "xhigh");
});

test("initial onboarding preserves a configured local Ollama default", () => {
  const snapshot = {
    models: [{
      id: "ollama/jonathan-qwen38-q4:latest",
      provider: "ollama",
      local: true,
      available: true,
      missing: false
    }],
    workspaces: [],
    diagnostics: {
      modelReadiness: {
        resolvedDefaultModel: "ollama/jonathan-qwen38-q4:latest",
        defaultModel: "ollama/jonathan-qwen38-q4:latest",
        defaultModelReady: false,
        recommendedModelId: OPENAI_ONBOARDING_DEFAULT_MODEL_ID,
        authProviders: [{ provider: "ollama", connected: true, canLogin: false }]
      }
    }
  } as unknown as MissionControlSnapshot;

  assert.equal(resolveInitialOnboardingModelId(snapshot), "ollama/jonathan-qwen38-q4:latest");
});

test("onboarding launchpad requires confirmed setup or a workspace-backed model", () => {
  const detectedDefaultOnly = {
    workspaces: [],
    agents: [],
    models: [],
    diagnostics: {
      installed: true,
      rpcOk: true,
      runtime: {
        stateWritable: true,
        sessionStoreWritable: true
      },
      modelReadiness: {
        ready: false,
        resolvedDefaultModel: "openai/gpt-5.4",
        defaultModel: "openai/gpt-5.4"
      }
    }
  } as unknown as MissionControlSnapshot;
  const workspaceBackedDefault = {
    ...detectedDefaultOnly,
    workspaces: [
      {
        id: "workspace-1",
        agentIds: ["agent-1"]
      }
    ],
    agents: [
      {
        id: "agent-1",
        workspaceId: "workspace-1"
      }
    ]
  } as unknown as MissionControlSnapshot;
  const workspaceBackedAgentModel = {
    ...detectedDefaultOnly,
    workspaces: [
      {
        id: "workspace-1"
      }
    ],
    agents: [
      {
        id: "agent-1",
        workspaceId: "workspace-1",
        modelId: "openai/gpt-5.4-mini"
      }
    ],
    models: [
      {
        id: "openai/gpt-5.4-mini",
        available: true,
        missing: false
      }
    ],
    diagnostics: {
      ...detectedDefaultOnly.diagnostics,
      modelReadiness: {
        ...detectedDefaultOnly.diagnostics.modelReadiness,
        resolvedDefaultModel: null,
        defaultModel: null
      }
    }
  } as unknown as MissionControlSnapshot;
  const workspaceWithoutAgent = {
    ...detectedDefaultOnly,
    workspaces: [
      {
        id: "workspace-1"
      }
    ],
    agents: []
  } as unknown as MissionControlSnapshot;
  const readyModel = {
    ...detectedDefaultOnly,
    diagnostics: {
      ...detectedDefaultOnly.diagnostics,
      modelReadiness: {
        ...detectedDefaultOnly.diagnostics.modelReadiness,
        ready: true
      }
    }
  } as unknown as MissionControlSnapshot;

  assert.equal(shouldShowOnboardingLaunchpad(detectedDefaultOnly), false);
  assert.equal(shouldShowOnboardingLaunchpad(workspaceWithoutAgent), false);
  assert.equal(shouldShowOnboardingLaunchpad(workspaceBackedDefault), true);
  assert.equal(shouldShowOnboardingLaunchpad(workspaceBackedAgentModel), true);
  assert.equal(shouldShowOnboardingLaunchpad(readyModel), false);
  assert.equal(
    shouldShowOnboardingLaunchpad(readyModel, {
      hasSeenMissionReady: true
    }),
    true
  );
  assert.equal(
    shouldShowOnboardingLaunchpad(detectedDefaultOnly, {
      modelSwitchSucceeded: true
    }),
    true
  );
});

test("workspace setup requires a workspace-backed agent", () => {
  const unrelatedRecords = {
    workspaces: [
      {
        id: "workspace-1",
        path: "/tmp/workspace-1",
        agentIds: []
      }
    ],
    agents: [
      {
        id: "agent-1",
        workspaceId: "workspace-2",
        workspacePath: "/tmp/workspace-2"
      }
    ]
  } as unknown as MissionControlSnapshot;
  const linkedByWorkspaceAgentIds = {
    ...unrelatedRecords,
    workspaces: [
      {
        id: "workspace-1",
        path: "/tmp/workspace-1",
        agentIds: ["agent-1"]
      }
    ],
    agents: [
      {
        id: "agent-1",
        workspaceId: "workspace-2",
        workspacePath: "/tmp/workspace-2"
      }
    ]
  } as unknown as MissionControlSnapshot;
  const linkedByPath = {
    ...unrelatedRecords,
    agents: [
      {
        id: "agent-1",
        workspaceId: "workspace-2",
        workspacePath: "/tmp/workspace-1/"
      }
    ]
  } as unknown as MissionControlSnapshot;

  assert.equal(hasAgentOSWorkspaceSetup(unrelatedRecords), false);
  assert.equal(hasAgentOSWorkspaceSetup(linkedByWorkspaceAgentIds), true);
  assert.equal(hasAgentOSWorkspaceSetup(linkedByPath), true);
});

test("workspace setup treats an incomplete snapshot as still syncing", () => {
  const incompleteSnapshot = {
    workspaces: undefined,
    agents: undefined
  } as unknown as MissionControlSnapshot;

  assert.equal(hasCompleteAgentOSWorkspaceSnapshot(incompleteSnapshot), false);
  assert.equal(hasAgentOSWorkspaceSetup(incompleteSnapshot), false);
  assert.equal(
    resolveLaunchpadWorkspaceSetupReadiness(incompleteSnapshot, null).ready,
    false
  );
});

test("snapshot state preserves known collections during a partial refresh", () => {
  const currentSnapshot = {
    workspaces: [{ id: "workspace-1" }],
    agents: [{ id: "agent-1" }],
    models: [{ id: "model-1" }]
  } as unknown as MissionControlSnapshot;
  const partialSnapshot = {
    ...currentSnapshot,
    workspaces: undefined,
    agents: undefined
  };

  const preservedSnapshot = preserveMissionControlSnapshotCollections(currentSnapshot, partialSnapshot);

  assert.deepEqual(preservedSnapshot.workspaces, currentSnapshot.workspaces);
  assert.deepEqual(preservedSnapshot.agents, currentSnapshot.agents);
  assert.deepEqual(preservedSnapshot.models, currentSnapshot.models);
});

test("launchpad workspace handoff waits for the workspace and starter agent", () => {
  const target = {
    workspaceId: "workspace-1",
    workspacePath: "/tmp/workspace-1",
    agentIds: ["agent-1"],
    primaryAgentId: "agent-1"
  };
  const workspaceShellSnapshot = {
    workspaces: [
      {
        id: "workspace-1",
        name: "Workspace 1",
        path: "/tmp/workspace-1",
        agentIds: ["agent-1"]
      }
    ],
    agents: []
  } as unknown as MissionControlSnapshot;
  const readySnapshot = {
    ...workspaceShellSnapshot,
    agents: [
      {
        id: "agent-1",
        workspaceId: "workspace-1"
      }
    ]
  } as unknown as MissionControlSnapshot;

  const shellReadiness = resolveLaunchpadWorkspaceSetupReadiness(workspaceShellSnapshot, target);
  const readyReadiness = resolveLaunchpadWorkspaceSetupReadiness(readySnapshot, target);

  assert.equal(shellReadiness.workspaceVisible, true);
  assert.equal(shellReadiness.primaryAgentVisible, false);
  assert.equal(shellReadiness.ready, false);
  assert.equal(readyReadiness.ready, true);

  const baseProgress: OperationProgressSnapshot = {
    title: "Provisioning workspace",
    description: "Creating workspace.",
    percent: 100,
    steps: [
      {
        id: "validate",
        label: "Checking input",
        description: "Checking input and target path.",
        status: "done",
        percent: 100,
        activities: []
      }
    ]
  };
  const syncingProgress = buildLaunchpadWorkspaceHandoffProgress({
    progress: baseProgress,
    readiness: shellReadiness,
    state: "syncing"
  });
  const syncingHandoffStep = syncingProgress.steps[syncingProgress.steps.length - 1];

  assert.equal(syncingProgress.title, "Opening workspace");
  assert.equal(syncingHandoffStep.id, "canvas-handoff");
  assert.equal(syncingHandoffStep.status, "active");
  assert.match(syncingHandoffStep.detail ?? "", /starter agent/);

  const readyProgress = buildLaunchpadWorkspaceHandoffProgress({
    progress: syncingProgress,
    readiness: readyReadiness,
    state: "ready"
  });
  const readyHandoffStep = readyProgress.steps[readyProgress.steps.length - 1];

  assert.equal(readyProgress.percent, 100);
  assert.equal(readyHandoffStep.status, "done");
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

test("workspace selection hydration waits for real snapshots", () => {
  const loadingSnapshot = {
    mode: "fallback",
    diagnostics: {
      loaded: true,
      rpcOk: false
    }
  } as unknown as MissionControlSnapshot;
  const fallbackSnapshot = {
    mode: "fallback",
    diagnostics: {
      loaded: false,
      rpcOk: false
    }
  } as unknown as MissionControlSnapshot;
  const liveSnapshot = {
    mode: "live",
    diagnostics: {
      loaded: true,
      rpcOk: true
    }
  } as unknown as MissionControlSnapshot;

  assert.equal(shouldDeferWorkspaceSelectionHydration(loadingSnapshot), true);
  assert.equal(shouldDeferWorkspaceSelectionHydration(fallbackSnapshot), false);
  assert.equal(shouldDeferWorkspaceSelectionHydration(liveSnapshot), false);
});

test("Mission Control shell delegates operator workflow state to focused hooks", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/mission-control-shell.tsx"), "utf8");
  const hookFiles = [
    "use-mission-control-selection",
    "use-mission-control-agent-actions",
    "use-mission-control-workspace-actions",
    "use-mission-control-task-actions",
    "use-mission-control-reset-state"
  ];

  for (const hookFile of hookFiles) {
    assert.match(source, new RegExp(`@/components/mission-control/${hookFile}`));
  }

  assert.doesNotMatch(source, /const \[focusedAgentId, setFocusedAgentId\] = useState/);
  assert.doesNotMatch(source, /const \[workspaceFilesDialogId, setWorkspaceFilesDialogId\] = useState/);
  assert.doesNotMatch(source, /const \[taskAbortRequest, setTaskAbortRequest\] = useState/);
  assert.doesNotMatch(source, /const \[resetDialogTarget, setResetDialogTarget\] = useState/);
  assert.doesNotMatch(source, /const \[resetPreviewState, setResetPreviewState\] = useState/);
  assert.doesNotMatch(source, /const \[resetRunState, setResetRunState\] = useState/);
});

test("Mission Control keeps model assignment in the agent connection menu and monitor cards compact", () => {
  const agentNodeSource = readFileSync(path.join(rootDir, "components/mission-control/nodes/agent-node.tsx"), "utf8");
  const taskNodeSource = readFileSync(path.join(rootDir, "components/mission-control/nodes/task-node.tsx"), "utf8");

  assert.match(agentNodeSource, /label="Change Model"/);
  assert.match(agentNodeSource, /data\.onConfigureModel\?\.\(data\.agent\.id\)/);
  assert.match(taskNodeSource, /isCompactMonitor \? "w-\[206px\]/);
  assert.match(taskNodeSource, /aria-label=\{[\s\S]*?"Expand monitor details"/);
});

test("Context Engine follows the Mission Control surface theme with semantic contrast tokens", () => {
  const shellSource = readFileSync(path.join(rootDir, "components/mission-control/mission-control-shell.tsx"), "utf8");
  const dialogSource = readFileSync(path.join(rootDir, "components/mission-control/context-engine-dialog.tsx"), "utf8");

  assert.match(shellSource, /<ContextEngineDialog[\s\S]*surfaceTheme=\{surfaceTheme\}/);
  assert.match(dialogSource, /const contextEngineThemeStyles: Record<ContextEngineSurfaceTheme/);
  assert.match(dialogSource, /light: \{/);
  assert.match(dialogSource, /dark: \{/);
  assert.match(dialogSource, /--ce-text-strong/);
  assert.match(dialogSource, /--ce-border-subtle/);
  assert.match(dialogSource, /--ce-success-text/);
  assert.match(dialogSource, /style=\{contextEngineThemeStyles\[surfaceTheme\]\}/);
});

test("inspector moves desktop scope controls into the header and keeps the rail as a collapsed launcher", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/inspector-panel.tsx"), "utf8");
  const visualsSource = readFileSync(path.join(rootDir, "components/mission-control/inspector-visuals.ts"), "utf8");
  const globalStyles = readFileSync(path.join(rootDir, "app/globals.css"), "utf8");
  const shellSource = readFileSync(path.join(rootDir, "components/mission-control/mission-control-shell.tsx"), "utf8");

  assert.match(source, /hidden h-full shrink-0 flex-col items-center px-1\.5 py-3 lg:flex/);
  assert.match(source, /collapsed \? \([\s\S]*InspectorRailButton/);
  assert.match(source, /aria-label="Inspector scope"[\s\S]*hidden items-center gap-1 lg:flex/);
  assert.match(source, /tooltipSide="bottom"[\s\S]*size="header"/);
  assert.match(source, /aria-label="Inspector scope"/);
  assert.match(source, /mt-3 grid-cols-3 gap-1 rounded-\[10px\] border p-1 lg:hidden/);
  assert.match(source, /isChatView \? "hidden" : "grid"/);
  assert.match(source, /aria-label=\{`Show \$\{item\.label\} inspector`\}/);
  assert.match(source, /style=\{isLight \? \{ backdropFilter: "none", WebkitBackdropFilter: "none" \} : undefined\}/);
  assert.match(source, /isLight \? "backdrop-blur-none" : "backdrop-blur-2xl"/);
  assert.match(source, /mission-inspector panel-surface[\s\S]*rounded-none border-0 lg:rounded-l-\[22px\] lg:border lg:border-r-0/);
  assert.match(visualsSource, /shell: "border-\[#ddcec3\] bg-\[#fbf7f3\]/);
  assert.match(visualsSource, /content: "bg-\[#fffdfa\]"/);
  assert.match(globalStyles, /@media \(max-width: 1023px\)[\s\S]*\.mission-shell--light \.mission-inspector-light[\s\S]*background: #fbf7f3 !important;[\s\S]*backdrop-filter: none !important;/);
  assert.match(globalStyles, /\.mission-inspector \{[\s\S]*border-width: 0 !important;[\s\S]*border-radius: 0 !important;/);
  assert.match(shellSource, /fixed inset-0 z-50 h-\[100dvh\] w-full overflow-hidden rounded-none/);
  assert.match(shellSource, /!isInspectorOpen \? \([\s\S]*fixed inset-x-0 top-3 z-\[60\]/);
  assert.doesNotMatch(shellSource, /h-\[min\(78dvh,720px\)\]/);
  assert.doesNotMatch(shellSource, /rounded-t-\[24px\]/);
});

test("agent chat keeps the send action in the composer bottom-right", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/agent-chat-drawer.tsx"), "utf8");

  assert.match(
    source,
    /absolute bottom-1\.5 right-1\.5 h-10 w-10 rounded-full p-0 shadow-none lg:bottom-3 lg:right-3 lg:h-8 lg:w-auto lg:px-3/
  );
  assert.doesNotMatch(source, /absolute bottom-1\.5 right-1\.5[\s\S]*lg:top-3/);
});

test("agent chat exposes real OpenClaw activity as a subdued live feed", () => {
  const drawerSource = readFileSync(path.join(rootDir, "components/mission-control/agent-chat-drawer.tsx"), "utf8");
  const runnerSource = readFileSync(path.join(rootDir, "components/mission-control/agent-chat-runner.ts"), "utf8");
  const routeSource = readFileSync(path.join(rootDir, "app/api/agents/[agentId]/chat/route.ts"), "utf8");

  assert.match(drawerSource, /role="status"[\s\S]*aria-live="polite"/);
  assert.match(drawerSource, /currentActivity/);
  assert.match(drawerSource, /previousActivity/);
  assert.match(drawerSource, /statusHistory=\{runSnapshot\.statusHistory\}/);
  assert.match(drawerSource, /isPendingAssistant[\s\S]*lg:border-0[\s\S]*lg:shadow-none/);
  assert.doesNotMatch(drawerSource, /rounded-\[14px\] border px-3 py-2\.5/);
  assert.doesNotMatch(drawerSource, /Show details|Reading your message|Live activity/);
  assert.match(runnerSource, /statusHistory: string\[\]/);
  assert.match(runnerSource, /maxAgentChatStatusHistory = 5/);
  assert.match(routeSource, /latestItem\?\.role === "toolCall"/);
  assert.match(routeSource, /latestItem\?\.role === "toolResult"/);
});

test("mobile light sidebar uses an opaque surface and hides its launcher while open", () => {
  const shellSource = readFileSync(path.join(rootDir, "components/mission-control/mission-control-shell.tsx"), "utf8");
  const sidebarSource = readFileSync(path.join(rootDir, "components/mission-control/sidebar.tsx"), "utf8");

  assert.match(shellSource, /!isSidebarOpen \? \(/);
  assert.match(shellSource, /aria-label="Open navigation"/);
  assert.match(shellSource, /surfaceTheme === "light"[\s\S]*bg-\[#fbf7f3\] shadow-\[18px_0_60px_rgba\(76,54,40,0\.22\)\]/);
  assert.match(sidebarSource, /surfaceTheme === "light" \? "bg-\[#fbf7f3\] lg:bg-card" : "bg-card"/);
});

test("Inspector uses focused panel modules for task, agent, and runtime truth", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/inspector-panel.tsx"), "utf8");

  assert.match(source, /inspector\/task-panel/);
  assert.match(source, /inspector\/overview-panel/);
  assert.match(source, /inspector\/agent-panel/);
  assert.match(source, /inspector\/runtime-panel/);
  assert.match(source, /buildInspectorTaskSessionView/);
  assert.match(source, /resolvePollingFallbackNotice/);
});
