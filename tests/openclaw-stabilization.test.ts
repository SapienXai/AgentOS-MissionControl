import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeControlPlaneSnapshot } from "@/lib/agentos/acl/openclaw";
import { getOpenClawBinCandidates, parseOpenClawVersion } from "@/lib/openclaw/cli";
import {
  getOpenClawBundledNodeBinPath,
  getOpenClawInstallCommand,
  getOpenClawLocalPrefixBinPath,
  getOpenClawUserLocalBinPath
} from "@/lib/openclaw/install";
import {
  buildOpenClawBinarySelectionSnapshot,
  createDefaultOpenClawBinarySelection,
  normalizeOpenClawBinarySelection,
  resolveOpenClawBinarySelectionPath
} from "@/lib/openclaw/binary-selection";
import { resolveRequiredLoginProvider } from "@/lib/openclaw/model-onboarding";
import { resolveUpdateInfo } from "@/lib/openclaw/domains/control-plane-normalization";
import { createMissionDispatchResultFromRuntimeOutput } from "@/lib/openclaw/domains/mission-dispatch-model";
import {
  annotateMissionDispatchMetadata,
  annotateMissionDispatchSessions
} from "@/lib/openclaw/domains/mission-dispatch-runtime";
import { mapSessionCatalogEntryToRuntime } from "@/lib/openclaw/domains/runtime-normalizer";
import { resolveModelReadiness } from "@/lib/openclaw/domains/control-plane-normalization";
import { normalizeChannelRegistry } from "@/lib/openclaw/domains/workspace-manifest";
import { buildTaskRecords } from "@/lib/openclaw/domains/task-records";
import { isOpenClawTerminalCommand } from "@/lib/openclaw/terminal-command";
import {
  extractKickoffProgressMessages,
  resolveWorkspaceBootstrapInput,
  resolveWorkspaceCreationTargetDir
} from "@/lib/openclaw/domains/workspace-bootstrap";
import { inferFallbackModelMetadata } from "@/lib/openclaw/service";
import { inferSessionKindFromCatalogEntry } from "@/lib/openclaw/domains/session-catalog";
import {
  resolveInitialOnboardingProviderId
} from "@/components/mission-control/openclaw-onboarding.utils";
import { isNewerSnapshot } from "@/hooks/use-mission-control-data";
import {
  resolvePrimaryAction
} from "@/components/mission-control/openclaw-onboarding.utils";
import {
  resolveModelOnboardingActionCopy,
  resolveModelOnboardingStartPhase
} from "@/components/mission-control/mission-control-shell.utils";
import { buildAgentChatPrompt } from "@/lib/openclaw/agent-chat-prompt";
import {
  buildDirectAgentIdentityReply,
  isDirectAgentIdentityQuestion,
  isStaleAgentChatContextRecoveryText
} from "@/lib/openclaw/agent-chat-guards";
import { resolveAgentModelLabel } from "@/lib/openclaw/presenters";
import type { ControlPlaneSnapshot, MissionControlSnapshot } from "@/lib/agentos/contracts";
import type {
  ChannelRegistry,
  RuntimeOutputRecord,
  RuntimeRecord,
  WorkspaceCreateInput
} from "@/lib/openclaw/types";

test("control plane snapshots normalize duplicates and nested registries", () => {
  const snapshot = {
    generatedAt: "2026-04-13T00:00:00.000Z",
    mode: "live",
    missionPresets: ["core", " core ", "ops", "ops"],
    channelAccounts: [
      {
        id: " discord-main ",
        type: " discord ",
        name: "Alpha",
        enabled: true,
        capabilities: ["read", "send", "send"],
        metadata: {
          source: "first"
        }
      },
      {
        id: "discord-main",
        type: "discord",
        name: "",
        enabled: false,
        capabilities: ["send", "write"],
        metadata: {
          source: "second",
          extra: true
        }
      }
    ],
    channelRegistry: {
      version: 1,
      channels: [
        {
          id: " surface-a ",
          type: "discord",
          name: " ",
          primaryAgentId: " agent-a ",
          workspaces: [
            {
              workspaceId: " workspace-1 ",
              workspacePath: " /tmp/workspace-1 ",
              agentIds: ["agent-1", "agent-1", "agent-2"],
              groupAssignments: [
                {
                  chatId: " chat-1 ",
                  agentId: " agent-1 ",
                  title: " First ",
                  enabled: true
                }
              ]
            }
          ]
        },
        {
          id: "surface-a",
          type: "discord",
          name: "Surface A",
          primaryAgentId: "agent-b",
          workspaces: [
            {
              workspaceId: "workspace-1",
              workspacePath: "/tmp/workspace-1",
              agentIds: ["agent-2", "agent-3"],
              groupAssignments: [
                {
                  chatId: "chat-1",
                  agentId: "agent-2",
                  title: " Override ",
                  enabled: false
                },
                {
                  chatId: "chat-2",
                  agentId: null,
                  title: null,
                  enabled: true
                }
              ]
            }
          ]
        }
      ]
    }
  } as unknown as ControlPlaneSnapshot;

  const normalized = normalizeControlPlaneSnapshot(snapshot);

  assert.deepEqual(normalized.missionPresets, ["core", "ops"]);
  assert.equal(normalized.channelAccounts.length, 1);
  assert.equal(normalized.channelAccounts[0].id, "discord-main");
  assert.equal(normalized.channelAccounts[0].type, "discord");
  assert.equal(normalized.channelAccounts[0].name, "Alpha");
  assert.deepEqual(normalized.channelAccounts[0].capabilities, ["read", "send", "write"]);
  assert.deepEqual(normalized.channelAccounts[0].metadata, {
    source: "first",
    extra: true
  });

  const channel = normalized.channelRegistry.channels[0];
  const workspace = channel.workspaces[0];

  assert.equal(channel.id, "surface-a");
  assert.equal(channel.name, "surface-a");
  assert.equal(channel.primaryAgentId, "agent-a");
  assert.deepEqual(workspace.agentIds, ["agent-1", "agent-2", "agent-3"]);
  assert.deepEqual(
    workspace.groupAssignments.map((assignment) => ({
      chatId: assignment.chatId,
      agentId: assignment.agentId,
      title: assignment.title,
      enabled: assignment.enabled
    })),
    [
      {
        chatId: "chat-1",
        agentId: "agent-2",
        title: "Override",
        enabled: false
      },
      {
        chatId: "chat-2",
        agentId: null,
        title: null,
        enabled: true
      }
    ]
  );
});

test("openclaw version parsing extracts the release tag", () => {
  assert.equal(parseOpenClawVersion("OpenClaw 2026.4.15 (041266a)"), "2026.4.15");
  assert.equal(parseOpenClawVersion("OpenClaw version unknown"), null);
});

test("openclaw resolver considers local prefix fallbacks", () => {
  const candidates = getOpenClawBinCandidates().map((candidate) => candidate.replaceAll("\\", "/"));
  const bundledNodeBinIndex = candidates.indexOf(getOpenClawBundledNodeBinPath().replaceAll("\\", "/"));
  const localPrefixBinIndex = candidates.indexOf(getOpenClawLocalPrefixBinPath().replaceAll("\\", "/"));

  assert.notEqual(bundledNodeBinIndex, -1);
  assert.notEqual(localPrefixBinIndex, -1);
  assert.ok(bundledNodeBinIndex < localPrefixBinIndex);
  assert.ok(candidates.includes(getOpenClawLocalPrefixBinPath().replaceAll("\\", "/")));
  assert.ok(candidates.includes(getOpenClawUserLocalBinPath().replaceAll("\\", "/")));
});

test("openclaw resolver does not let the managed wrapper shadow the bundled node install", () => {
  const previousOpenClawBin = process.env.OPENCLAW_BIN;
  process.env.OPENCLAW_BIN = getOpenClawLocalPrefixBinPath();

  try {
    const candidates = getOpenClawBinCandidates().map((candidate) => candidate.replaceAll("\\", "/"));

    assert.equal(candidates[0], getOpenClawBundledNodeBinPath().replaceAll("\\", "/"));
  } finally {
    if (previousOpenClawBin === undefined) {
      delete process.env.OPENCLAW_BIN;
    } else {
      process.env.OPENCLAW_BIN = previousOpenClawBin;
    }
  }
});

test("openclaw binary selection helpers preserve explicit choices", () => {
  const autoSelection = normalizeOpenClawBinarySelection(null);
  assert.deepEqual(autoSelection, createDefaultOpenClawBinarySelection());
  assert.equal(resolveOpenClawBinarySelectionPath(autoSelection), null);

  const customSelection = normalizeOpenClawBinarySelection({
    mode: "custom",
    path: "/opt/homebrew/bin/openclaw"
  });

  assert.equal(customSelection.mode, "custom");
  assert.equal(customSelection.path, "/opt/homebrew/bin/openclaw");
  assert.equal(resolveOpenClawBinarySelectionPath(customSelection), "/opt/homebrew/bin/openclaw");

  const snapshotSelection = buildOpenClawBinarySelectionSnapshot(
    customSelection,
    "/opt/homebrew/bin/openclaw"
  );

  assert.equal(snapshotSelection.resolvedPath, "/opt/homebrew/bin/openclaw");
  assert.equal(snapshotSelection.label, "Custom path");
});

test("agent chat prompt keeps direct identity chat out of task recovery", () => {
  const prompt = buildAgentChatPrompt(
    [
      {
        role: "user",
        text: "hello boy"
      },
      {
        role: "assistant",
        text: "I couldn't recover any prior task context from memory or the workspace. Send me the last goal or file."
      }
    ],
    "so what is your name and how old are you",
    {
      agentName: "Little Boy",
      agentDir: "/tmp/agent",
      workspacePath: "/tmp/workspace"
    }
  );

  assert.match(prompt, /Answer the operator's latest message directly/);
  assert.match(prompt, /Your current display name in AgentOS is Little Boy/);
  assert.match(prompt, /Operator: so what is your name and how old are you/);
  assert.doesNotMatch(prompt, /couldn't recover any prior task context/i);
  assert.doesNotMatch(prompt, /Send me the last goal or file/i);
  assert.equal(isDirectAgentIdentityQuestion("so what is your name and how old are you"), true);
  assert.equal(
    isStaleAgentChatContextRecoveryText(
      "I can’t continue because there’s still no recoverable task context. I checked workspace files, memory, and recent session metadata."
    ),
    true
  );
  assert.equal(
    isStaleAgentChatContextRecoveryText(
      "I still don’t have any task state to resume from. I’ve already checked the workspace, memory, and session metadata. Send me the last task, file, or error."
    ),
    true
  );
  assert.equal(
    buildDirectAgentIdentityReply("Little Boy"),
    "My name is Little Boy. I do not have a real age; I am an AI agent running inside AgentOS."
  );
});

test("agent model labels show missing assignments explicitly", () => {
  assert.equal(
    resolveAgentModelLabel(
      "unassigned",
      [
        {
          id: "openai-codex/gpt-5.4-mini",
          name: "GPT-5.4 Mini"
        }
      ]
    ),
    "Unassigned"
  );
  assert.equal(
    resolveAgentModelLabel("openai-codex/gpt-5.5", []),
    "gpt-5.5"
  );
});

test("openclaw onboarding uses the official installer command", () => {
  const command = getOpenClawInstallCommand();

  if (process.platform === "win32") {
    assert.match(command, /install\.ps1/);
    assert.match(command, /-NoOnboard/);
    return;
  }

  assert.match(command, /install-cli\.sh/);
  assert.match(command, /--no-onboard/);
  assert.match(command, /\$HOME\/\.openclaw/);
});

test("openclaw terminal command detection accepts quoted binary paths", () => {
  assert.equal(isOpenClawTerminalCommand("openclaw models auth login --provider openai-codex"), true);
  assert.equal(
    isOpenClawTerminalCommand("'/Users/kazim akgul/.openclaw/bin/openclaw' models auth login --provider openai-codex"),
    true
  );
  assert.equal(
    isOpenClawTerminalCommand('"/Users/kazim akgul/.openclaw/bin/openclaw" models auth login --provider openai-codex'),
    true
  );
  assert.equal(isOpenClawTerminalCommand("node /tmp/whatever.js"), false);
});

test("openrouter selection keeps openrouter auth prioritized", () => {
  const snapshot = {
    diagnostics: {
      modelReadiness: {
        resolvedDefaultModel: "openrouter/google/gemma-4-31b-it:free",
        authProviders: [
          {
            provider: "openrouter",
            connected: false,
            canLogin: true
          },
          {
            provider: "openai-codex",
            connected: false,
            canLogin: true
          }
        ]
      }
    }
  } as unknown as MissionControlSnapshot;

  assert.equal(
    resolveRequiredLoginProvider(snapshot, "openrouter/google/gemma-4-31b-it:free"),
    "openrouter"
  );
  assert.equal(resolveRequiredLoginProvider(snapshot, undefined), "openrouter");
});

test("ollama never requires provider auth handoff", () => {
  const snapshot = {
    diagnostics: {
      modelReadiness: {
        resolvedDefaultModel: "ollama/llama3.2",
        defaultModel: "ollama/llama3.2",
        preferredLoginProvider: "ollama",
        authProviders: [
          {
            provider: "ollama",
            connected: false,
            canLogin: true
          }
        ]
      }
    }
  } as unknown as MissionControlSnapshot;

  assert.equal(resolveRequiredLoginProvider(snapshot, "ollama/llama3.2"), null);
  assert.equal(resolveRequiredLoginProvider(snapshot, undefined), null);
});

test("mission control snapshots prefer live data over fallback snapshots", () => {
  const current = {
    generatedAt: "2026-04-21T10:00:00.000Z",
    revision: 1,
    mode: "live"
  } as ControlPlaneSnapshot;
  const fallback = {
    generatedAt: "2026-04-21T10:00:01.000Z",
    revision: 1,
    mode: "fallback"
  } as ControlPlaneSnapshot;
  const refreshed = {
    generatedAt: "2026-04-21T10:00:02.000Z",
    revision: 2,
    mode: "live"
  } as ControlPlaneSnapshot;

  assert.equal(isNewerSnapshot(fallback, current), false);
  assert.equal(isNewerSnapshot(refreshed, current), true);
});

test("onboarding starts on the selected, connected, or preferred provider", () => {
  const snapshot = {
    diagnostics: {
      modelReadiness: {
        recommendedModelId: "anthropic/claude-3-7-sonnet",
        preferredLoginProvider: "openrouter",
        authProviders: [
          {
            provider: "openrouter",
            connected: false,
            canLogin: true,
            detail: null
          },
          {
            provider: "openai-codex",
            connected: false,
            canLogin: true,
            detail: null
          }
        ]
      }
    }
  } as unknown as MissionControlSnapshot;

  assert.equal(
    resolveInitialOnboardingProviderId(snapshot, "openrouter/google/gemma-4-31b-it:free"),
    "openrouter"
  );
  assert.equal(resolveInitialOnboardingProviderId(snapshot, undefined), "openrouter");

  const connectedSnapshot = {
    diagnostics: {
      modelReadiness: {
        recommendedModelId: "anthropic/claude-3-7-sonnet",
        preferredLoginProvider: "openrouter",
        authProviders: [
          {
            provider: "ollama",
            connected: true,
            canLogin: false,
            detail: null
          },
          {
            provider: "openrouter",
            connected: false,
            canLogin: true,
            detail: null
          }
        ]
      }
    }
  } as unknown as MissionControlSnapshot;

  assert.equal(resolveInitialOnboardingProviderId(connectedSnapshot, undefined), "ollama");
});

test("model onboarding requires an explicit selection before verification", () => {
  assert.deepEqual(
    resolvePrimaryAction({
      stage: "models",
      systemReady: true,
      modelReady: false,
      systemActionLabel: "Continue",
      selectedModelId: ""
    }),
    {
      kind: "select-model",
      label: "Select a model"
    }
  );

  assert.deepEqual(
    resolvePrimaryAction({
      stage: "models",
      systemReady: true,
      modelReady: false,
      systemActionLabel: "Continue",
      selectedModelId: "openai/gpt-5.4",
      defaultModelId: "openai/gpt-5.4"
    }),
    {
      kind: "dismiss",
      label: "Enter AgentOS"
    }
  );

  assert.deepEqual(
    resolvePrimaryAction({
      stage: "models",
      systemReady: true,
      modelReady: false,
      systemActionLabel: "Continue",
      selectedModelId: "openrouter/google/gemma-4-31b-it:free",
      defaultModelId: "openai/gpt-5.4"
    }),
    {
      kind: "set-default",
      label: "Set as default"
    }
  );

  assert.deepEqual(
    resolvePrimaryAction({
      stage: "models",
      systemReady: true,
      modelReady: false,
      systemActionLabel: "Continue",
      selectedModelId: "openai/gpt-5.4",
      defaultModelId: "openai/gpt-5.4"
    }),
    {
      kind: "set-default",
      label: "Set as default"
    }
  );

  assert.deepEqual(
    resolvePrimaryAction({
      stage: "models",
      systemReady: true,
      modelReady: true,
      systemActionLabel: "Continue",
      selectedModelId: "openai-codex/gpt-5.4",
      defaultModelId: "openai/gpt-5.4"
    }),
    {
      kind: "set-default",
      label: "Set as default"
    }
  );

  assert.deepEqual(
    resolvePrimaryAction({
      stage: "models",
      systemReady: true,
      modelReady: true,
      systemActionLabel: "Continue",
      selectedModelId: "openai/gpt-5.4",
      defaultModelId: "openai/gpt-5.4"
    }),
    {
      kind: "dismiss",
      label: "Enter AgentOS"
    }
  );

  assert.equal(resolveModelOnboardingStartPhase("set-default"), "configuring-default");
  assert.deepEqual(resolveModelOnboardingActionCopy("set-default"), {
    statusMessage: "Saving default model...",
    successTitle: "Default model saved.",
    errorTitle: "Default model save failed."
  });
});

test("remote provider connection depends on auth rather than configured models", () => {
  const readiness = resolveModelReadiness(
    [
      {
        key: "openrouter/google/gemma-4-31b-it:free",
        local: false,
        available: true,
        missing: false
      }
    ],
    {
      auth: {
        providers: [
          {
            provider: "openrouter",
            profiles: {
              count: 0
            }
          }
        ],
        oauth: {
          providers: []
        },
        missingProvidersInUse: [],
        unusableProfiles: []
      }
    } as never
  );

  assert.equal(
    readiness.authProviders.find((provider) => provider.provider === "openrouter")?.connected,
    false
  );
});

test("ollama is treated as a local provider without auth login", () => {
  const readiness = resolveModelReadiness(
    [
      {
        key: "ollama/llama3.2",
        local: true,
        available: true,
        missing: false
      }
    ],
    {
      defaultModel: "ollama/llama3.2",
      resolvedDefault: "ollama/llama3.2",
      auth: {
        providers: [
          {
            provider: "ollama",
            profiles: {
              count: 0
            }
          }
        ],
        oauth: {
          providers: []
        },
        missingProvidersInUse: ["ollama"],
        unusableProfiles: []
      }
    } as never
  );

  const ollamaProvider = readiness.authProviders.find((provider) => provider.provider === "ollama");

  assert.equal(ollamaProvider?.connected, true);
  assert.equal(ollamaProvider?.canLogin, false);
  assert.equal(readiness.preferredLoginProvider, null);
});

test("fallback model metadata keeps local and context hints", () => {
  assert.deepEqual(inferFallbackModelMetadata("ollama/qwen3.5:9b"), {
    contextWindow: 262144,
    local: true
  });
  assert.deepEqual(inferFallbackModelMetadata("openai-codex/gpt-5.4-mini"), {
    contextWindow: 272000,
    local: false
  });
});

test("update info falls back to a loading message when only the installed version is known", () => {
  assert.equal(
    resolveUpdateInfo({ currentVersion: "2026.4.15" }),
    "Running v2026.4.15. Update registry status is still loading."
  );
});

test("session catalog entries preserve task-like sessions when chatType is missing", () => {
  assert.equal(
    inferSessionKindFromCatalogEntry(
      {
        updatedAt: 1776455964086,
        systemPromptReport: {
          source: "run"
        }
      },
      "agent:faros-strategist:main"
    ),
    "task"
  );
  assert.equal(
    inferSessionKindFromCatalogEntry(
      {
        chatType: "direct",
        deliveryContext: {
          to: "heartbeat"
        }
      },
      "agent:key2web3-telegram-admin:main"
    ),
    "direct"
  );
  assert.equal(
    inferSessionKindFromCatalogEntry(
      {
        chatType: "group",
        channel: "telegram",
        groupId: "-1001646245594"
      },
      "agent:faros-strategist:telegram:group:-1001646245594"
    ),
    "group"
  );
});

test("channel registry normalization trims ids and dedupes workspace bindings", () => {
  const registry = {
    version: 1,
    channels: [
      {
        id: " discord ",
        type: "discord",
        name: " ",
        primaryAgentId: " agent-a ",
        workspaces: [
          {
            workspaceId: " workspace-1 ",
            workspacePath: " /tmp/workspace-1 ",
            agentIds: ["agent-1", "agent-1", "agent-2"],
            groupAssignments: [
              {
                chatId: "chat-1",
                agentId: "agent-1",
                title: "First",
                enabled: true
              }
            ]
          }
        ]
      },
      {
        id: "discord",
        type: "discord",
        name: "Surface",
        primaryAgentId: "agent-b",
        workspaces: [
          {
            workspaceId: "workspace-1",
            workspacePath: "/tmp/workspace-1",
            agentIds: ["agent-2", "agent-3"],
            groupAssignments: [
              {
                chatId: "chat-1",
                agentId: "agent-2",
                title: "Override",
                enabled: false
              },
              {
                chatId: "chat-2",
                agentId: null,
                title: null,
                enabled: true
              }
            ]
          }
        ]
      }
    ]
  } as ChannelRegistry;

  const normalized = normalizeChannelRegistry(registry);

  assert.equal(normalized.channels.length, 1);
  assert.equal(normalized.channels[0].id, "discord");
  assert.equal(normalized.channels[0].name, "discord");
  assert.equal(normalized.channels[0].primaryAgentId, "agent-a");
  assert.deepEqual(normalized.channels[0].workspaces[0].agentIds, ["agent-1", "agent-2", "agent-3"]);
  assert.deepEqual(
    normalized.channels[0].workspaces[0].groupAssignments.map((assignment) => ({
      chatId: assignment.chatId,
      agentId: assignment.agentId,
      title: assignment.title,
      enabled: assignment.enabled
    })),
    [
      {
        chatId: "chat-1",
        agentId: "agent-2",
        title: "Override",
        enabled: false
      },
      {
        chatId: "chat-2",
        agentId: null,
        title: null,
        enabled: true
      }
    ]
  );
});

test("mission dispatch runtime output merges into a mission payload", () => {
  const runtime = {
    id: "runtime-1"
  } as unknown as RuntimeRecord;
  const output = {
    runtimeId: "runtime-1",
    status: "available",
    finalText: "Deploy complete.",
    finalTimestamp: "2026-04-13T00:00:00.000Z",
    stopReason: null,
    errorMessage: null,
    items: [],
    createdFiles: [],
    warnings: [],
    warningSummary: null
  } as unknown as RuntimeOutputRecord;

  assert.deepEqual(createMissionDispatchResultFromRuntimeOutput(runtime, output), {
    runId: "runtime:runtime-1",
    status: "ok",
    summary: "completed",
    result: {
      payloads: [
        {
          text: "Deploy complete.",
          mediaUrl: null
        }
      ]
    }
  });
});

test("mission dispatch groups direct session turns into one task card", () => {
  const submittedAt = "2026-04-13T00:00:00.000Z";
  const dispatchRecord = {
    id: "dispatch-1",
    status: "completed",
    agentId: "agent-1",
    sessionId: "session-1",
    mission: "Create the Faros document",
    routedMission: "Create the Faros document\n\nTask output routing:\n- Put outputs under deliverables/run/",
    thinking: "medium",
    workspaceId: "workspace-1",
    workspacePath: "/tmp/workspace-1",
    submittedAt,
    updatedAt: "2026-04-13T00:01:00.000Z",
    outputDir: "/tmp/workspace-1/deliverables/run",
    outputDirRelative: "deliverables/run",
    notesDirRelative: "memory",
    runner: {
      pid: null,
      childPid: null,
      startedAt: submittedAt,
      finishedAt: "2026-04-13T00:01:00.000Z",
      lastHeartbeatAt: "2026-04-13T00:01:00.000Z",
      logPath: null
    },
    observation: {
      runtimeId: null,
      observedAt: null
    },
    result: null,
    error: null
  } as const;
  const runtimes = [
    {
      id: "runtime:session-1:turn-1",
      source: "turn",
      key: "agent:agent-1:main:turn:turn-1",
      title: "Create the Faros document",
      subtitle: "Planning work",
      status: "completed",
      updatedAt: Date.parse("2026-04-13T00:00:20.000Z"),
      ageMs: 0,
      agentId: "agent-1",
      workspaceId: "workspace-1",
      sessionId: "session-1",
      metadata: {
        kind: "direct",
        chatType: "direct",
        turnId: "turn-1",
        turnPrompt:
          "[Retry after the previous model attempt failed or timed out]\n\nCreate the Faros document\n\nTask output routing:\n- Put outputs under deliverables/run/"
      }
    },
    {
      id: "runtime:session-1:turn-2",
      source: "turn",
      key: "agent:agent-1:main:turn:turn-2",
      title: "Create the Faros document",
      subtitle: "Wrote the deliverable",
      status: "completed",
      updatedAt: Date.parse("2026-04-13T00:00:50.000Z"),
      ageMs: 0,
      agentId: "agent-1",
      workspaceId: "workspace-1",
      sessionId: "session-1",
      metadata: {
        kind: "direct",
        chatType: "direct",
        turnId: "turn-2",
        turnPrompt: "Create the Faros document\n\nTask output routing:\n- Put outputs under deliverables/run/",
        createdFiles: [
          {
            path: "/tmp/workspace-1/deliverables/run/faros.md",
            displayPath: "deliverables/run/faros.md"
          }
        ]
      }
    }
  ] as unknown as RuntimeRecord[];

  const annotated = annotateMissionDispatchMetadata(runtimes, [dispatchRecord]);
  const tasks = buildTaskRecords(annotated, [
    {
      id: "agent-1",
      name: "Research Lead"
    }
  ] as Parameters<typeof buildTaskRecords>[1]);

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].key, "dispatch:dispatch-1");
  assert.equal(tasks[0].dispatchId, "dispatch-1");
  assert.equal(tasks[0].runtimeCount, 2);
  assert.deepEqual(tasks[0].runtimeIds.sort(), ["runtime:session-1:turn-1", "runtime:session-1:turn-2"]);
  assert.equal(tasks[0].artifactCount, 1);
});

test("mission dispatch sessions carry explicit task origin before runtime matching", () => {
  const dispatchRecord = {
    id: "dispatch-1",
    status: "running",
    agentId: "agent-1",
    sessionId: "session-1",
    mission: "Create the Faros document",
    routedMission: "Create the Faros document\n\nTask output routing:\n- Put outputs under deliverables/run/",
    thinking: "medium",
    workspaceId: "workspace-1",
    workspacePath: "/tmp/workspace-1",
    submittedAt: "2026-04-13T00:00:00.000Z",
    updatedAt: "2026-04-13T00:00:30.000Z",
    outputDir: "/tmp/workspace-1/deliverables/run",
    outputDirRelative: "deliverables/run",
    notesDirRelative: "memory",
    runner: {
      pid: null,
      childPid: null,
      startedAt: "2026-04-13T00:00:00.000Z",
      finishedAt: null,
      lastHeartbeatAt: "2026-04-13T00:00:30.000Z",
      logPath: null
    },
    observation: {
      runtimeId: null,
      observedAt: null
    },
    result: null,
    error: null
  } as const;
  const sessions = annotateMissionDispatchSessions(
    [
      {
        agentId: "agent-1",
        key: "agent:agent-1:explicit:session-1",
        sessionId: "session-1",
        updatedAt: Date.parse("2026-04-13T00:00:20.000Z"),
        ageMs: 0,
        model: "openai/gpt-5.4-mini"
      }
    ],
    [dispatchRecord]
  );
  const runtime = mapSessionCatalogEntryToRuntime(
    sessions[0],
    [
      {
        id: "agent-1",
        workspace: "/tmp/workspace-1",
        model: "openai/gpt-5.4-mini"
      }
    ],
    [
      {
        id: "agent-1",
        workspace: "/tmp/workspace-1",
        model: "openai/gpt-5.4-mini"
      }
    ]
  );
  const tasks = buildTaskRecords([runtime], [
    {
      id: "agent-1",
      name: "Research Lead"
    }
  ] as Parameters<typeof buildTaskRecords>[1]);

  assert.equal(runtime.metadata.origin, "mission-dispatch");
  assert.equal(runtime.metadata.dispatchId, "dispatch-1");
  assert.equal(runtime.metadata.mission, "Create the Faros document");
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].key, "dispatch:dispatch-1");
  assert.equal(tasks[0].dispatchId, "dispatch-1");
});

test("task cards use explicit runtime origin before direct-chat heuristics", () => {
  const runtimes = [
    {
      id: "runtime:agent-chat",
      source: "session",
      key: "agent:agent-1:explicit:agent-chat",
      title: "Agent chat session",
      subtitle: "direct chat",
      status: "completed",
      updatedAt: Date.parse("2026-04-13T00:00:00.000Z"),
      ageMs: 0,
      agentId: "agent-1",
      workspaceId: "workspace-1",
      sessionId: "agent-chat-session",
      metadata: {
        origin: "agent-chat",
        dispatchId: "should-not-win",
        mission: "This should stay out of task cards"
      }
    },
    {
      id: "runtime:mission-dispatch",
      source: "session",
      key: "agent:agent-1:explicit:mission-dispatch",
      title: "Agent session",
      subtitle: "direct session",
      status: "running",
      updatedAt: Date.parse("2026-04-13T00:00:30.000Z"),
      ageMs: 0,
      agentId: "agent-1",
      workspaceId: "workspace-1",
      sessionId: "mission-session",
      metadata: {
        origin: "mission-dispatch",
        dispatchId: "dispatch-1",
        kind: "direct",
        chatType: "direct",
        mission: "Create the Faros document"
      }
    }
  ] as unknown as RuntimeRecord[];

  const tasks = buildTaskRecords(runtimes, [
    {
      id: "agent-1",
      name: "Research Lead"
    }
  ] as Parameters<typeof buildTaskRecords>[1]);

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].key, "dispatch:dispatch-1");
  assert.deepEqual(tasks[0].runtimeIds, ["runtime:mission-dispatch"]);
});

test("task cards ignore unscoped direct session records", () => {
  const runtimes = [
    {
      id: "runtime:main-session",
      source: "session",
      key: "agent:agent-1:main",
      title: "Agent session",
      subtitle: "main session",
      status: "idle",
      updatedAt: Date.parse("2026-04-13T00:00:00.000Z"),
      ageMs: 0,
      agentId: "agent-1",
      workspaceId: "workspace-1",
      sessionId: "session-main",
      metadata: {}
    },
    {
      id: "runtime:explicit-session",
      source: "session",
      key: "agent:agent-1:explicit:session-explicit",
      title: "Agent session",
      subtitle: "direct session",
      status: "completed",
      updatedAt: Date.parse("2026-04-13T00:00:10.000Z"),
      ageMs: 0,
      agentId: "agent-1",
      workspaceId: "workspace-1",
      sessionId: "session-explicit",
      metadata: {}
    },
    {
      id: "runtime:dispatch-1",
      source: "session",
      key: "agent:agent-1:explicit:dispatch-session",
      title: "Create the Faros document",
      subtitle: "Wrote the deliverable",
      status: "completed",
      updatedAt: Date.parse("2026-04-13T00:01:00.000Z"),
      ageMs: 0,
      agentId: "agent-1",
      workspaceId: "workspace-1",
      sessionId: "dispatch-session",
      metadata: {
        dispatchId: "dispatch-1",
        mission: "Create the Faros document"
      }
    }
  ] as unknown as RuntimeRecord[];

  const tasks = buildTaskRecords(runtimes, [
    {
      id: "agent-1",
      name: "Research Lead"
    }
  ] as Parameters<typeof buildTaskRecords>[1]);

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].key, "dispatch:dispatch-1");
  assert.deepEqual(tasks[0].runtimeIds, ["runtime:dispatch-1"]);
});

test("kickoff progress parser hides terminal control and auth-profile noise", () => {
  assert.deepEqual(
    extractKickoffProgressMessages(
      "\u001b[33magents/auth-profiles\u001b[39m \u001b[36minherited auth-profiles from main agent\u001b[39m\n> Preparing kickoff output"
    ),
    ["Preparing kickoff output"]
  );
});

test("workspace bootstrap input keeps the path contract stable", () => {
  const input = {
    name: "  Alpha Workspace  ",
    directory: "  alpha-workspace  ",
    sourceMode: "empty",
    rules: {
      workspaceOnly: true,
      generateStarterDocs: false,
      generateMemory: true,
      kickoffMission: true
    },
    docOverrides: [
      {
        path: " docs/brief.md ",
        content: "old"
      },
      {
        path: "docs/brief.md",
        content: "new"
      },
      {
        path: " ",
        content: "ignored"
      }
    ],
    agents: [
      {
        id: " primary lead ",
        role: " Lead ",
        name: "Primary Lead",
        enabled: true,
        isPrimary: true,
        policy: {
          preset: "worker",
          missingToolBehavior: "fallback",
          installScope: "none",
          fileAccess: "extended",
          networkAccess: "enabled"
        }
      }
    ]
  } satisfies WorkspaceCreateInput;

  const resolved = resolveWorkspaceBootstrapInput(input);
  const targetDir = resolveWorkspaceCreationTargetDir(resolved, "/workspaces");

  assert.equal(resolved.name, "Alpha Workspace");
  assert.equal(resolved.slug, "alpha-workspace");
  assert.equal(resolved.directory, "alpha-workspace");
  assert.equal(resolved.rules.workspaceOnly, true);
  assert.equal(resolved.agents[0].id, "primary-lead");
  assert.equal(resolved.agents[0].role, "Lead");
  assert.equal(resolved.agents[0].name, "Primary Lead");
  assert.equal(resolved.agents[0].policy?.fileAccess, "workspace-only");
  assert.deepEqual(resolved.docOverrides, [
    {
      path: "docs/brief.md",
      content: "new"
    }
  ]);
  assert.equal(targetDir, "/workspaces/alpha-workspace");
});
