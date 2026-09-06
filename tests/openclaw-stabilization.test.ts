import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { normalizeControlPlaneSnapshot } from "@/lib/agentos/acl/openclaw";
import { mergeOllamaCatalogModels, parseOllamaListModelNames } from "@/lib/openclaw/domains/model-provider-catalog";
import { getOpenClawBinCandidates, parseOpenClawVersion } from "@/lib/openclaw/cli";
import {
  probeLocalGatewayConfiguration,
  probeLocalGatewayRegistration
} from "@/lib/openclaw/client/local-gateway-probe";
import { probeLocalDefaultModel } from "@/lib/openclaw/state/local-model-status";
import {
  getOpenClawBundledNodeBinPath,
  buildOpenClawSpawnEnv,
  ensureOpenClawLocalBinOnPath,
  getOpenClawInstallCommand,
  getOpenClawLocalPrefixBinPath,
  getOpenClawUserLocalBinPath,
  getOpenClawWindowsNpmBinPath,
  getOpenClawWindowsNpmEntryPath,
  mergeDirectoryIntoPathList,
  pathListIncludesDirectory,
  repairOpenClawWindowsNpmShims
} from "@/lib/openclaw/install";
import {
  buildOpenClawBinarySelectionSnapshot,
  createDefaultOpenClawBinarySelection,
  normalizeOpenClawBinarySelection,
  resolveOpenClawBinarySelectionPath
} from "@/lib/openclaw/binary-selection";
import { resolveRequiredLoginProvider } from "@/lib/openclaw/model-onboarding";
import { resolveOpenAiAuthHandoff } from "@/lib/openclaw/model-auth-errors";
import {
  isAddModelsProviderId,
  isUnsupportedLegacyProviderId,
  modelProviderRegistry,
  normalizeAddModelsProviderId,
  normalizeExplicitProviderId
} from "@/lib/openclaw/model-provider-registry";
import { resolveUpdateInfo } from "@/lib/openclaw/domains/control-plane-normalization";
import { mapRuntimeSmokeTestEntry } from "@/lib/openclaw/domains/control-plane-settings";
import { createMissionDispatchResultFromRuntimeOutput } from "@/lib/openclaw/domains/mission-dispatch-model";
import {
  annotateMissionDispatchMetadata,
  annotateMissionDispatchSessions,
  buildMissionDispatchRuntimes,
  matchMissionDispatchToRuntime
} from "@/lib/openclaw/domains/mission-dispatch-runtime";
import { buildMissionDispatchFeed, buildTaskFeed } from "@/lib/openclaw/domains/task-feed";
import {
  mergeRuntimeHistory as mergeRuntimeHistoryRecords
} from "@/lib/openclaw/domains/runtime-history";
import {
  mapSessionToRuntimes,
  parseRuntimeOutput,
  parseRuntimeOutputFromSessionHistory
} from "@/lib/openclaw/domains/runtime-transcript";
import { mapSessionCatalogEntryToRuntime } from "@/lib/openclaw/domains/runtime-normalizer";
import { resolveModelReadiness } from "@/lib/openclaw/domains/control-plane-normalization";
import { normalizeChannelRegistry } from "@/lib/openclaw/domains/workspace-manifest";
import { buildModelStatusConnectionStatus } from "@/lib/openclaw/domains/model-provider-connection";
import { buildTaskRecords } from "@/lib/openclaw/domains/task-records";
import { extractCodexRolloutTokenUsageForTurn } from "@/lib/openclaw/domains/mission-dispatch-lifecycle";
import { extractMissionDispatchSessionId } from "@/lib/openclaw/domains/mission-dispatch-model";
import { isOpenClawTerminalCommand } from "@/lib/openclaw/terminal-command";
import { matchesMissionText } from "@/lib/openclaw/runtime-matching";
import {
  extractKickoffProgressMessages,
  resolveWorkspaceBootstrapInput,
  resolveWorkspaceCreationTargetDir
} from "@/lib/openclaw/domains/workspace-bootstrap";
import {
  buildModelRecords,
  filterModelsToConfiguredSelection,
  inferFallbackModelMetadata,
  mergeConfiguredModelsIntoModelsPayload,
  mergeModelStatusWithAgentConfigDefaults
} from "@/lib/openclaw/adapter/model-adapter";
import {
  resolveOpenAiAuthOrderRepair,
  resolveOpenAiRuntimeAuthBlock
} from "@/lib/openclaw/application/model-auth-service";
import { inferSessionKindFromCatalogEntry } from "@/lib/openclaw/domains/session-catalog";
import {
  buildSystemSteps,
  resolveEffectiveWizardStage,
  resolveSystemStepActionLabel,
  resolveInitialOnboardingProviderId,
  resolveOnboardingModelProviderId,
  resolvePrimaryAction,
  resolveSelectedOnboardingProviderId
} from "@/components/mission-control/openclaw-onboarding.utils";
import { isNewerSnapshot, preserveConfirmedStatus } from "@/hooks/use-mission-control-data";
import {
  resolveModelOnboardingActionCopy,
  resolveModelOnboardingStartPhase
} from "@/components/mission-control/mission-control-shell.utils";
import {
  applyTaskReviewStateToSnapshot,
  createTaskReviewResolution,
  resolveEffectiveTaskReviewStatus,
  resolveTaskReviewFooterLabel,
  resolveTaskReviewSummary,
  taskReviewContinuationGraceMs
} from "@/components/mission-control/task-review-state";
import { buildTaskReviewContinuationPrompt } from "@/lib/openclaw/domains/task-review-continuation";
import { buildAgentChatPrompt } from "@/lib/openclaw/agent-chat-prompt";
import {
  buildOpenClawDowngradeConfigBlockerManualCommand,
  buildOpenClawUpdateRecoveryManualCommand,
  isOpenClawDowngradeConfigBlocker,
  isOpenClawGatewayReadyOutput,
  resolveOpenClawDowngradeBlockerRestoreVersion,
  shouldAttemptOpenClawUpdateRecovery
} from "@/lib/openclaw/update-recovery";
import {
  resolveOpenClawRuntimeFailureMessage,
  resolveOpenClawRuntimePreflightError,
  buildOpenClawRuntimeSmokeTestRecoveryCommand,
  classifyOpenClawRuntimeSmokeTestFailure
} from "@/lib/openclaw/runtime-compatibility";
import { OPENCLAW_RECOMMENDED_VERSION } from "@/lib/openclaw/versions";
import {
  buildDirectAgentIdentityReply,
  isDirectAgentIdentityQuestion,
  isStaleAgentChatContextRecoveryText
} from "@/lib/openclaw/agent-chat-guards";
import { annotateAgentChatRuntimes } from "@/lib/openclaw/domains/agent-chat-sessions";
import { resolveAgentModelLabel } from "@/lib/openclaw/presenters";
import { buildProvisionConfig, isProvisionFieldSatisfied } from "@/lib/openclaw/surface-provision";
import type { SurfaceProvisionField } from "@/lib/openclaw/surface-catalog";
import type { ControlPlaneSnapshot, MissionControlSnapshot } from "@/lib/agentos/contracts";
import type {
  ChannelRegistry,
  OpenClawAgent,
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

test("surface provisioning config nests dotted OpenClaw fields", () => {
  const fields: SurfaceProvisionField[] = [
    { key: "account", label: "Account" },
    { key: "serve.port", label: "Serve port", inputType: "number" },
    { key: "serve.bind", label: "Serve bind" },
    { key: "tailscale.mode", label: "Tailscale mode" },
    { key: "includeBody", label: "Include body", inputType: "checkbox" }
  ];

  assert.deepEqual(
    buildProvisionConfig(fields, {
      account: "agent@example.com",
      "serve.port": "8788",
      "serve.bind": "127.0.0.1",
      "tailscale.mode": "funnel",
      includeBody: true
    }),
    {
      account: "agent@example.com",
      serve: {
        port: 8788,
        bind: "127.0.0.1"
      },
      tailscale: {
        mode: "funnel"
      },
      includeBody: true
    }
  );
});

test("required numeric surface fields reject empty drafts", () => {
  assert.equal(
    isProvisionFieldSatisfied(
      {
        key: "maxConcurrentRuns",
        label: "Max concurrent runs",
        inputType: "number",
        required: true
      },
      { maxConcurrentRuns: "" }
    ),
    false
  );
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
  if (process.platform === "win32") {
    assert.ok(candidates.includes(getOpenClawWindowsNpmEntryPath().replaceAll("\\", "/")));
    assert.ok(candidates.includes(getOpenClawWindowsNpmBinPath().replaceAll("\\", "/")));
  }
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

test("openclaw Windows shim recovery repairs an installed package without reinstalling it", async () => {
  const npmBinDir = await mkdtemp(path.join(os.tmpdir(), "agentos-openclaw-npm-"));
  const packageDir = path.join(npmBinDir, "node_modules", "openclaw");
  await mkdir(packageDir, { recursive: true });
  await writeFile(path.join(packageDir, "openclaw.mjs"), "#!/usr/bin/env node\n", "utf8");
  await writeFile(path.join(npmBinDir, ".openclaw.cmd-staged"), "@echo off\r\n", "utf8");

  const repairedPath = await repairOpenClawWindowsNpmShims({ npmBinDir, platform: "win32" });

  assert.equal(repairedPath, path.join(npmBinDir, "openclaw.cmd"));
  assert.equal(await readFile(repairedPath!, "utf8"), "@echo off\r\n");
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

test("openclaw update recovery detects post-update setup failures", () => {
  const output = `Update Result: OK
  Root: /Users/example/.openclaw/tools/node-v22.22.0/lib/node_modules/openclaw
  Before: 2026.4.25
  After: 2026.4.27

Completion cache update failed: Error: spawnSync node ETIMEDOUT
Gateway did not become healthy after restart.`;

  assert.equal(shouldAttemptOpenClawUpdateRecovery(output), true);
  assert.equal(shouldAttemptOpenClawUpdateRecovery("npm failed before installing anything"), false);
  assert.equal(
    buildOpenClawUpdateRecoveryManualCommand("/Users/example/.openclaw/bin/openclaw"),
    "/Users/example/.openclaw/bin/openclaw doctor --fix && /Users/example/.openclaw/bin/openclaw gateway restart && /Users/example/.openclaw/bin/openclaw gateway status --deep"
  );
});

test("openclaw update recovery detects newer-config downgrade blockers", () => {
  const output = `Update Result: OK
  Root: /Users/example/.openclaw/tools/node-v22.22.0/lib/node_modules/openclaw
  Before: 2026.6.6
  After: 2026.6.1

Failed to refresh gateway service environment from updated install: Error: updated install refresh failed (/Users/example/.openclaw/tools/node-v22.22.0/lib/node_modules/openclaw/dist/index.js): Gateway install blocked: Refusing to install or rewrite the gateway service because this OpenClaw binary (2026.6.1) is older than the config last written by OpenClaw 2026.6.6.
Gateway: restart failed: Error: updated install restart failed (/Users/example/.openclaw/tools/node-v22.22.0/lib/node_modules/openclaw/dist/index.js): Gateway restart blocked: Refusing to restart the gateway service because this OpenClaw binary (2026.6.1) is older than the config last written by OpenClaw 2026.6.6.`;

  assert.equal(shouldAttemptOpenClawUpdateRecovery(output), true);
  assert.equal(isOpenClawDowngradeConfigBlocker(output), true);
  assert.equal(resolveOpenClawDowngradeBlockerRestoreVersion(output), "2026.6.6");
  assert.equal(
    buildOpenClawDowngradeConfigBlockerManualCommand("/Users/example/.openclaw/bin/openclaw", "2026.6.6"),
    "/Users/example/.openclaw/bin/openclaw update --tag 2026.6.6 --yes && /Users/example/.openclaw/bin/openclaw gateway restart && /Users/example/.openclaw/bin/openclaw gateway status --deep"
  );
});

test("openclaw update recovery extracts restore version from status output", () => {
  const output = `Service config issue: Gateway service was installed by OpenClaw 2026.6.6; current CLI is 2026.6.1.
Your OpenClaw config was written by version 2026.6.6, but this command is running 2026.6.1.`;

  assert.equal(isOpenClawDowngradeConfigBlocker(output), true);
  assert.equal(resolveOpenClawDowngradeBlockerRestoreVersion(output), "2026.6.6");
});

test("openclaw update recovery accepts deep gateway readiness output", () => {
  const deepStatusOutput = `OpenClaw gateway status
LaunchAgent: loaded
Service runtime: status=running, state=active, pid=48670
Gateway port 18789 status: listening
Connectivity probe: ok
Capability: admin-capable`;

  assert.equal(isOpenClawGatewayReadyOutput(deepStatusOutput), true);
  assert.equal(isOpenClawGatewayReadyOutput("Gateway Health\nOK"), true);
  assert.equal(isOpenClawGatewayReadyOutput("Connectivity probe: failed"), false);
  assert.equal(
    buildOpenClawRuntimeSmokeTestRecoveryCommand("/Users/example/.openclaw/bin/openclaw", "Unknown model: openai/gpt-5.4-mini"),
    "/Users/example/.openclaw/bin/openclaw doctor --fix && /Users/example/.openclaw/bin/openclaw gateway restart && /Users/example/.openclaw/bin/openclaw gateway status --deep"
  );
  assert.deepEqual(
    classifyOpenClawRuntimeSmokeTestFailure(
      "[channels] failed to load bundled channel telegram: ENOENT: no such file or directory"
    ),
    {
      kind: "plugin-runtime",
      detail: "bundled channel loading failed after the update. Run `openclaw doctor --fix` and restart the gateway."
    }
  );
  assert.deepEqual(
    classifyOpenClawRuntimeSmokeTestFailure(
      "GatewayClientRequestError: FailoverError: Unknown model: openai-codex/gpt-5.4-mini."
    ),
    {
      kind: "model-route",
      detail:
        "OpenClaw rejected a stale legacy model route. AgentOS accepts canonical `openai/*` model refs and does not migrate OpenClaw state. Run the supported OpenClaw doctor/migration flow, then refresh AgentOS."
    }
  );
  assert.deepEqual(
    classifyOpenClawRuntimeSmokeTestFailure(
      'GatewayClientRequestError: FailoverError: OAuth token refresh failed for openai-codex: OpenAI Codex token refresh failed (401): { "error": { "message": "Your refresh token has already been used to generate a new access token. Please try signing in again." } }'
    ),
    {
      kind: "provider-auth",
      detail:
        "Your ChatGPT session has expired. Reconnect ChatGPT, then retry model discovery or runtime verification. Run: openclaw models auth login --provider openai --set-default"
    }
  );
  assert.deepEqual(
    classifyOpenClawRuntimeSmokeTestFailure("Error: No provider plugins found. Install one via `openclaw plugins install`."),
    {
      kind: "provider-auth",
      detail:
        "OpenClaw needs @openclaw/codex installed and enabled before ChatGPT authorization can continue. Install the plugin through OpenClaw, restart the Gateway, then retry ChatGPT authorization. Run: openclaw plugins install --force --accept-capabilities @openclaw/codex && openclaw gateway restart && openclaw models auth login --provider openai --set-default"
    }
  );
});

test("openclaw runtime failure message explains codex route rejection", () => {
  assert.equal(
    resolveOpenClawRuntimeFailureMessage(
      "GatewayClientRequestError: FailoverError: Unknown model: openai-codex/gpt-5.4-mini."
    ),
    "OpenClaw rejected a stale legacy model route. AgentOS accepts canonical `openai/*` model refs and does not migrate OpenClaw state. Run the supported OpenClaw doctor/migration flow, then refresh AgentOS."
  );
  assert.equal(resolveOpenClawRuntimeFailureMessage("unrelated failure"), null);
  assert.equal(
    resolveOpenClawRuntimeFailureMessage("OpenAI Codex token refresh failed (401)"),
    "Your ChatGPT session has expired. Reconnect ChatGPT, then retry model discovery or runtime verification. Run: openclaw models auth login --provider openai --set-default"
  );
  assert.equal(
    resolveOpenClawRuntimeFailureMessage("Agent failed before reply: auth refresh request timed out after 10s.", {
      modelId: "openai/gpt-5.4-mini"
    }),
    "Your ChatGPT session has expired. Reconnect ChatGPT, then retry model discovery or runtime verification. Run: openclaw models auth login --provider openai --set-default"
  );
  assert.equal(
    resolveOpenClawRuntimeFailureMessage("429 Provider returned error", {
      modelId: "openrouter/google/gemma-4-26b-a4b-it:free"
    }),
    "OpenRouter returned HTTP 429 for the selected model. The API key is connected, but this model or account is currently rate limited or out of available credits. Wait and retry, add OpenRouter credits, or switch the agent to another model route."
  );
  assert.equal(
    resolveOpenClawRuntimeFailureMessage("429 Provider returned error", {
      modelId: "openai/gpt-5.5"
    }),
    null
  );
});

test("ChatGPT OAuth handoff opens the browser without a terminal fallback", () => {
  const ready = resolveOpenAiAuthHandoff("/Users/example/.openclaw/bin/openclaw", true);
  const refresh = resolveOpenAiAuthHandoff("/Users/example/.openclaw/bin/openclaw", true, {
    force: true
  });
  const switchAccount = resolveOpenAiAuthHandoff("/Users/example/.openclaw/bin/openclaw", true, {
    force: true,
    intent: "switch-account"
  });
  const missing = resolveOpenAiAuthHandoff("/Users/example/.openclaw/bin/openclaw", false);

  assert.equal(ready.command, null);
  assert.match(ready.statusMessage, /browser/);
  assert.doesNotMatch(ready.continueMessage, /terminal/i);
  assert.equal(refresh.command, null);
  assert.match(refresh.continueMessage, /refresh the Codex app-server setup/);
  assert.equal(switchAccount.command, null);
  assert.match(switchAccount.continueMessage, /switch the ChatGPT account for Codex app-server/);
  assert.equal(missing.command, null);
  assert.match(missing.continueMessage, /@openclaw\/codex/i);
  assert.doesNotMatch(missing.continueMessage, /terminal/i);
});

test("stale codex auth smoke failures do not keep runtime warnings pinned", () => {
  assert.equal(
    mapRuntimeSmokeTestEntry("main", {
      status: "failed",
      checkedAt: "2020-01-01T00:00:00.000Z",
      error:
        "Your ChatGPT session has expired. Reconnect ChatGPT, then retry model discovery or runtime verification. Run: openclaw models auth login --provider openai --set-default"
    }).status,
    "not-run"
  );
  assert.equal(
    mapRuntimeSmokeTestEntry("main", {
      status: "failed",
      checkedAt: new Date().toISOString(),
      error:
        "Your ChatGPT session has expired. Reconnect ChatGPT, then retry model discovery or runtime verification. Run: openclaw models auth login --provider openai --set-default"
    }).status,
    "failed"
  );
});

test("openclaw runtime preflight rejects bundled channel load failures", () => {
  const snapshot = {
    diagnostics: {
      issues: [
        "[channels] failed to load bundled channel telegram: ENOENT: no such file or directory"
      ],
      runtime: {
        issues: []
      }
    }
  } as unknown as MissionControlSnapshot;

  assert.equal(
    resolveOpenClawRuntimePreflightError(snapshot),
    "OpenClaw runtime is missing bundled channel files after the update. Run `openclaw doctor --fix` and restart the gateway."
  );
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
      agentId: "little-boy",
      agentName: "Little Boy",
      agentDir: "/tmp/agent",
      workspacePath: "/tmp/workspace"
    }
  );

  assert.match(prompt, /Answer the operator's latest message directly/);
  assert.match(prompt, /current AgentOS display name is Little Boy/);
  assert.match(prompt, /matching `AGENTS.md` role section/);
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
          id: "openai/gpt-5.4-mini",
          name: "GPT-5.4 Mini"
        }
      ]
    ),
    "Unassigned"
  );
  assert.equal(
    resolveAgentModelLabel("openai/gpt-5.5", []),
    "gpt-5.5"
  );
});

test("openclaw onboarding uses the official installer command", () => {
  const command = getOpenClawInstallCommand();

  if (process.platform === "win32") {
    assert.match(command, /install\.ps1/);
    assert.match(command, new RegExp(`-Tag\\s+${OPENCLAW_RECOMMENDED_VERSION}`));
    assert.match(command, /-NoOnboard/);
    assert.doesNotMatch(command, /update\s+--tag/);
    return;
  }

  assert.match(command, /install-cli\.sh/);
  assert.match(command, new RegExp(`--version\\s+${OPENCLAW_RECOMMENDED_VERSION}`));
  assert.match(command, /--no-onboard/);
  assert.match(command, /\$HOME\/\.openclaw/);
  assert.doesNotMatch(command, /update\s+--tag/);
});

test("Windows OpenClaw commands request a hidden Gateway task launcher", () => {
  if (process.platform !== "win32") {
    return;
  }

  const env = buildOpenClawSpawnEnv({ NODE_ENV: "test" });

  assert.equal(env.OPENCLAW_WINDOWS_TASK_HIDDEN_LAUNCHER, "1");
  assert.match(env.NODE_OPTIONS ?? "", /openclaw-windows-hide\.cjs/);
});

test("openclaw path list helpers avoid duplicate terminal path entries", () => {
  assert.equal(
    mergeDirectoryIntoPathList("/usr/bin:/bin", "/Users/example/.openclaw/bin", "darwin"),
    "/Users/example/.openclaw/bin:/usr/bin:/bin"
  );
  assert.equal(
    mergeDirectoryIntoPathList("/Users/example/.openclaw/bin:/usr/bin", "/Users/example/.openclaw/bin", "darwin"),
    "/Users/example/.openclaw/bin:/usr/bin"
  );
  assert.equal(
    pathListIncludesDirectory(
      "C:\\Users\\Example\\.openclaw\\bin;C:\\Windows\\System32",
      "c:\\users\\example\\.openclaw\\bin",
      "win32"
    ),
    true
  );
});

test("openclaw path setup writes idempotent zsh startup files", async () => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "agentos-openclaw-path-"));
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    PATH: "/usr/bin",
    SHELL: "/bin/zsh"
  };
  const binDir = path.join(homeDir, ".openclaw", "bin");
  const zshrcPath = path.join(homeDir, ".zshrc");
  const envFilePath = path.join(homeDir, ".openclaw", "agentos-env.sh");

  const firstResult = await ensureOpenClawLocalBinOnPath({
    env,
    homeDir,
    platform: "darwin",
    shell: "/bin/zsh"
  });

  assert.equal(env.PATH?.startsWith(`${binDir}:`), true);
  assert.equal(firstResult.createdFiles.includes(zshrcPath), true);
  assert.equal(firstResult.createdFiles.includes(envFilePath), true);
  assert.match(await readFile(envFilePath, "utf8"), /\$HOME\/\.openclaw\/bin/);

  const firstZshrc = await readFile(zshrcPath, "utf8");
  assert.match(firstZshrc, /OpenClaw PATH/);
  assert.match(firstZshrc, /\$HOME\/\.openclaw\/agentos-env\.sh/);

  const secondResult = await ensureOpenClawLocalBinOnPath({
    env,
    homeDir,
    platform: "darwin",
    shell: "/bin/zsh"
  });

  assert.equal(secondResult.createdFiles.length, 0);
  assert.equal(secondResult.updatedFiles.length, 0);
  assert.equal(await readFile(zshrcPath, "utf8"), firstZshrc);
});

test("openclaw path setup updates Windows user PATH without setx", async () => {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    Path: "C:\\Windows\\System32"
  };
  const scripts: string[] = [];
  const result = await ensureOpenClawLocalBinOnPath({
    env,
    homeDir: "C:\\Users\\Example",
    platform: "win32",
    windowsUserPath: "C:\\Windows\\System32",
    runPowerShellScript: async (script) => {
      scripts.push(script);
      return "";
    }
  });

  assert.equal(result.updatedWindowsUserPath, true);
  assert.equal(
    pathListIncludesDirectory(env.Path, "C:\\Users\\Example\\.openclaw\\bin", "win32"),
    true
  );
  assert.equal(scripts.length, 1);
  assert.match(scripts[0], /SetEnvironmentVariable\('Path'/);
});

test("openclaw terminal command detection accepts quoted binary paths", () => {
  assert.equal(isOpenClawTerminalCommand("openclaw models auth login --provider openai"), true);
  assert.equal(
    isOpenClawTerminalCommand("'/Users/kazim akgul/.openclaw/bin/openclaw' models auth login --provider openai"),
    true
  );
  assert.equal(
    isOpenClawTerminalCommand('"/Users/kazim akgul/.openclaw/bin/openclaw" models auth login --provider openai'),
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
            provider: "openai",
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

test("model provider registry keeps ChatGPT as an OpenAI auth method", () => {
  const openAiDescriptors = modelProviderRegistry.filter((provider) => provider.id === "openai");

  assert.equal(openAiDescriptors.length, 1);
  assert.deepEqual(openAiDescriptors[0]?.authMethods, ["api-key", "chatgpt-oauth"]);
  assert.equal(isAddModelsProviderId("openai"), true);
  assert.equal(isAddModelsProviderId("codex"), false);
  assert.equal(isAddModelsProviderId("openai-codex"), false);
  assert.equal(isUnsupportedLegacyProviderId("codex"), true);
  assert.equal(isUnsupportedLegacyProviderId("openai-codex"), true);
  assert.equal(normalizeAddModelsProviderId("openai-codex"), null);
  assert.equal(normalizeExplicitProviderId("openai-codex"), "");
});

test("openai canonical model requests ChatGPT login when Codex owns the route", () => {
  const snapshot = {
    diagnostics: {
      modelReadiness: {
        resolvedDefaultModel: "openai/gpt-5.5",
        defaultModel: "openai/gpt-5.5",
        preferredLoginProvider: "openai",
        authProviders: [
          {
            provider: "openai",
            connected: false,
            canLogin: true
          },
          {
            provider: "openai",
            connected: false,
            canLogin: true
          }
        ]
      }
    }
  } as unknown as MissionControlSnapshot;

  assert.equal(resolveRequiredLoginProvider(snapshot, "openai/gpt-5.5"), "openai");
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
            provider: "openai",
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

test("live gateway probe overrides a stale ready snapshot", () => {
  const snapshot = {
    diagnostics: {
      installed: true,
      version: "2026.6.8",
      loaded: true,
      rpcOk: true,
      runtime: {
        stateWritable: true,
        sessionStoreWritable: true
      }
    }
  } as unknown as MissionControlSnapshot;

  const steps = buildSystemSteps(snapshot, null, { gatewayReachable: false });
  const gatewayStep = steps.find((step) => step.id === "gateway");

  assert.equal(gatewayStep?.state, "pending");
});

test("CLI readiness does not wait for the first full live snapshot", () => {
  const snapshot = {
    diagnostics: {
      installed: true,
      version: "2026.6.8",
      loaded: true,
      rpcOk: true,
      runtime: {
        stateWritable: true,
        sessionStoreWritable: true
      }
    }
  } as unknown as MissionControlSnapshot;

  const steps = buildSystemSteps(snapshot, null, { suppressGatewaySnapshot: true });

  assert.equal(steps.find((step) => step.id === "cli")?.state, "complete");
  assert.equal(steps.find((step) => step.id === "gateway")?.state, "pending");
});

test("lightweight CLI status overrides a stale installed snapshot", () => {
  const snapshot = {
    diagnostics: {
      installed: true,
      version: "2026.6.8",
      loaded: false,
      rpcOk: false,
      runtime: {
        stateWritable: false,
        sessionStoreWritable: false
      }
    }
  } as unknown as MissionControlSnapshot;

  const checkingSteps = buildSystemSteps(snapshot, null, { cliInstalled: null });
  const missingSteps = buildSystemSteps(snapshot, null, { cliInstalled: false });

  assert.equal(checkingSteps.find((step) => step.id === "cli")?.state, "pending");
  assert.equal(missingSteps.find((step) => step.id === "cli")?.state, "pending");
});

test("CLI remains active while the installer is still running", () => {
  const snapshot = {
    diagnostics: {
      installed: true,
      loaded: false,
      rpcOk: false,
      runtime: { stateWritable: false, sessionStoreWritable: false }
    }
  } as unknown as MissionControlSnapshot;

  const steps = buildSystemSteps(snapshot, "installing-cli", { cliInstalled: true });

  assert.equal(steps.find((step) => step.id === "cli")?.state, "current");
  assert.equal(steps.find((step) => step.id === "cli")?.description, "Installing OpenClaw CLI.");
});

test("lightweight registration status completes the Gateway service step while stopped", () => {
  const snapshot = {
    diagnostics: {
      installed: true,
      loaded: false,
      rpcOk: false,
      runtime: { stateWritable: true, sessionStoreWritable: true }
    }
  } as unknown as MissionControlSnapshot;

  const steps = buildSystemSteps(snapshot, null, {
    cliInstalled: true,
    gatewayRegistered: true,
    gatewayReachable: false
  });

  assert.equal(steps.find((step) => step.id === "gateway")?.state, "complete");
  assert.equal(steps.find((step) => step.id === "gateway")?.description, "Registered and configured.");
  assert.equal(steps.find((step) => step.id === "runtime")?.state, "current");
});

test("gateway step stays current while startup can still fall back to installation", () => {
  const snapshot = {
    diagnostics: {
      installed: true,
      loaded: false,
      rpcOk: false,
      runtime: { stateWritable: true, sessionStoreWritable: true }
    }
  } as unknown as MissionControlSnapshot;

  const steps = buildSystemSteps(snapshot, "starting-gateway", {
    cliInstalled: true,
    gatewayRegistered: false,
    gatewayReachable: false
  });

  assert.equal(steps.find((step) => step.id === "gateway")?.state, "current");
  assert.equal(steps.find((step) => step.id === "runtime")?.state, "pending");
});

test("fresh install setup ignores orphaned Gateway registration before CLI is confirmed", () => {
  const snapshot = {
    diagnostics: {
      installed: false,
      loaded: false,
      rpcOk: false,
      runtime: { stateWritable: false, sessionStoreWritable: false }
    }
  } as unknown as MissionControlSnapshot;

  const steps = buildSystemSteps(snapshot, null, {
    forcePending: true,
    cliInstalled: false,
    gatewayRegistered: true,
    gatewayReachable: false
  });

  assert.equal(steps.find((step) => step.id === "cli")?.state, "pending");
  assert.equal(steps.find((step) => step.id === "gateway")?.state, "pending");
  assert.equal(steps.find((step) => step.id === "gateway")?.description, "Register and configure the local Gateway.");
  assert.equal(steps.find((step) => step.id === "runtime")?.state, "pending");
});

test("macOS lightweight registration probe detects the OpenClaw LaunchAgent", async () => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "agentos-macos-gateway-"));
  const launchAgentsDir = path.join(homeDir, "Library", "LaunchAgents");
  await mkdir(launchAgentsDir, { recursive: true });

  assert.equal(
    await probeLocalGatewayRegistration({ platform: "darwin", homeDir, env: { NODE_ENV: "test" } }),
    false
  );

  await writeFile(path.join(launchAgentsDir, "ai.openclaw.gateway.plist"), "<plist />", "utf8");
  assert.equal(
    await probeLocalGatewayRegistration({ platform: "darwin", homeDir, env: { NODE_ENV: "test" } }),
    true
  );
});

test("lightweight Gateway config probe distinguishes prepared local auth", async () => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "agentos-gateway-config-"));
  const stateDir = path.join(homeDir, ".openclaw");
  await mkdir(stateDir, { recursive: true });

  assert.equal(await probeLocalGatewayConfiguration({ homeDir, env: {} }), false);
  await writeFile(
    path.join(stateDir, "openclaw.json"),
    JSON.stringify({ gateway: { mode: "local", auth: { mode: "token", token: "test-token" } } }),
    "utf8"
  );
  assert.equal(await probeLocalGatewayConfiguration({ homeDir, env: {} }), true);

  const customStateDir = path.join(homeDir, "custom-openclaw-state");
  await mkdir(customStateDir, { recursive: true });
  await writeFile(
    path.join(customStateDir, "openclaw.json"),
    JSON.stringify({ gateway: { mode: "local", auth: { mode: "token", token: "custom-token" } } }),
    "utf8"
  );
  assert.equal(
    await probeLocalGatewayConfiguration({ homeDir, env: { OPENCLAW_STATE_DIR: customStateDir } }),
    true
  );
});

test("local model probe reads the configured default without a full snapshot", async () => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "agentos-local-model-"));

  assert.deepEqual(await probeLocalDefaultModel({ homeDir, env: { NODE_ENV: "test" } }), {
    checked: true,
    defaultModelId: null,
    modelIds: []
  });

  const stateDir = path.join(homeDir, ".openclaw");
  await mkdir(stateDir, { recursive: true });
  await writeFile(
    path.join(stateDir, "openclaw.json"),
    JSON.stringify({
      agents: {
        defaults: {
          model: { primary: "openai/gpt-5.2" },
          models: { "anthropic/claude-sonnet-4": {} }
        }
      }
    }),
    "utf8"
  );

  assert.deepEqual(await probeLocalDefaultModel({ homeDir, env: { NODE_ENV: "test" } }), {
    checked: true,
    defaultModelId: "openai/gpt-5.2",
    modelIds: ["openai/gpt-5.2", "anthropic/claude-sonnet-4"]
  });
});

test("system setup CTA follows the active step", () => {
  assert.equal(
    resolveSystemStepActionLabel([{ id: "cli", state: "current" }], "Continue"),
    "Install OpenClaw"
  );
  assert.equal(
    resolveSystemStepActionLabel([
      { id: "cli", state: "complete" },
      { id: "gateway", state: "current" }
    ], "Continue"),
    "Prepare local gateway"
  );
  assert.equal(
    resolveSystemStepActionLabel([
      { id: "gateway", state: "complete" },
      { id: "runtime", state: "current" }
    ], "Continue"),
    "Start OpenClaw"
  );
});

test("starting OpenClaw preserves completed CLI and Gateway steps", () => {
  const snapshot = {
    diagnostics: {
      installed: true,
      loaded: true,
      rpcOk: false,
      runtime: { stateWritable: true, sessionStoreWritable: true }
    }
  } as unknown as MissionControlSnapshot;

  const steps = buildSystemSteps(snapshot, "detecting", {
    cliInstalled: true,
    gatewayRegistered: true,
    gatewayReachable: false
  });

  assert.equal(steps.find((step) => step.id === "cli")?.state, "complete");
  assert.equal(steps.find((step) => step.id === "gateway")?.state, "complete");
  assert.equal(steps.find((step) => step.id === "runtime")?.state, "current");
});

test("lightweight RPC and runtime probes complete the Runtime step", () => {
  const snapshot = {
    diagnostics: {
      installed: true,
      loaded: true,
      rpcOk: false,
      runtime: { stateWritable: false, sessionStoreWritable: false }
    }
  } as unknown as MissionControlSnapshot;

  const steps = buildSystemSteps(snapshot, "verifying", {
    cliInstalled: true,
    gatewayRegistered: true,
    gatewayReady: true,
    runtimeWritable: true
  });

  assert.equal(steps.find((step) => step.id === "runtime")?.state, "complete");
  assert.equal(
    steps.find((step) => step.id === "runtime")?.description,
    "RPC and runtime storage are ready."
  );
});

test("confirmed Gateway registration does not flicker during restart probes", () => {
  assert.equal(preserveConfirmedStatus(null, true), true);
  assert.equal(preserveConfirmedStatus(true, false), true);
  assert.equal(preserveConfirmedStatus(true, null), true);
  assert.equal(preserveConfirmedStatus(null, false), false);
});

test("onboarding treats canonical OpenAI model refs as ChatGPT when Codex auth owns the route", () => {
  const snapshot = {
    diagnostics: {
      modelReadiness: {
        recommendedModelId: "openai/gpt-5.5",
        preferredLoginProvider: "openai",
        authProviders: [
          {
            provider: "openai",
            connected: true,
            canLogin: true,
            detail: "OAuth connected"
          },
          {
            provider: "openai",
            connected: false,
            canLogin: true,
            detail: null
          }
        ]
      }
    }
  } as unknown as MissionControlSnapshot;

  assert.equal(resolveOnboardingModelProviderId(snapshot, "openai/gpt-5.5"), "openai");
  assert.equal(resolveInitialOnboardingProviderId(snapshot, "openai/gpt-5.5"), "openai");
});

test("onboarding preserves provider context for ChatGPT catalog selections", () => {
  const snapshot = {
    models: [],
    diagnostics: {
      modelReadiness: {
        preferredLoginProvider: "openai",
        authProviders: [
          {
            provider: "openai",
            connected: false,
            canLogin: false,
            detail: null
          },
          {
            provider: "openai",
            connected: false,
            canLogin: true,
            detail: null
          }
        ]
      }
    }
  } as unknown as MissionControlSnapshot;

  assert.equal(
    resolveSelectedOnboardingProviderId(snapshot, "openai/gpt-5.5", [
      {
        id: "openai/gpt-5.5",
        provider: "openai"
      }
    ]),
    "openai"
  );
});

test("model onboarding requires an explicit selection before verification", () => {
  assert.equal(resolveEffectiveWizardStage("models", false), "system");
  assert.equal(resolveEffectiveWizardStage("system", false), "system");
  assert.equal(resolveEffectiveWizardStage("models", true), "models");

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
      kind: "set-default",
      label: "Verify model setup"
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
      label: "Verify model setup"
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

test("an implicit Gateway default never makes a clean install model-ready", () => {
  const readiness = resolveModelReadiness(
    [
      {
        key: "openai/gpt-5.5",
        local: false,
        available: true,
        missing: false
      }
    ],
    {
      defaultModel: "openai/gpt-5.5",
      resolvedDefault: "openai/gpt-5.5",
      auth: {
        providers: [
          {
            provider: "openai",
            profiles: {
              count: 0
            }
          }
        ],
        oauth: {
          providers: []
        },
        missingProvidersInUse: ["openai"],
        unusableProfiles: []
      }
    } as never,
    []
  );

  assert.equal(readiness.ready, false);
  assert.equal(readiness.defaultModelReady, false);
  assert.equal(readiness.recommendedModelId, null);
  assert.equal(readiness.issues.includes("Choose a default model to finish setup."), true);
});

test("model status keeps agent config default when native status omits it", () => {
  const status = mergeModelStatusWithAgentConfigDefaults(
    {
      allowed: ["openai/gpt-5.4-mini", "openai/gpt-5.5"],
      auth: {
        providers: [
          {
            provider: "openai",
            profiles: {
              count: 1
            }
          }
        ]
      }
    },
    [
      {
        id: "main",
        model: "openai/gpt-5.4-mini"
      }
    ] as never
  );

  assert.equal(status?.defaultModel, "openai/gpt-5.4-mini");
  assert.equal(status?.resolvedDefault, "openai/gpt-5.4-mini");
  assert.deepEqual(status?.allowed, ["openai/gpt-5.4-mini", "openai/gpt-5.5"]);
});

test("model status keeps live agent default when state config lags after setup", () => {
  const status = mergeModelStatusWithAgentConfigDefaults(
    {
      allowed: ["openai/gpt-5.4-mini", "openai/gpt-5.5"],
      auth: {
        providers: [
          {
            provider: "openai",
            profiles: {
              count: 1
            }
          }
        ],
        oauth: {
          providers: [
            {
              provider: "openai",
              status: "ok"
            }
          ]
        }
      }
    },
    [],
    [
      {
        modelId: "openai/gpt-5.4-mini",
        isDefault: true
      }
    ]
  );
  const readiness = resolveModelReadiness(
    [
      {
        key: "openai/gpt-5.4-mini",
        local: false,
        available: true,
        missing: false
      }
    ],
    status
  );

  assert.equal(status?.defaultModel, "openai/gpt-5.4-mini");
  assert.equal(status?.resolvedDefault, "openai/gpt-5.4-mini");
  assert.equal(readiness.ready, true);
  assert.equal(readiness.defaultModelReady, true);
});

test("canonical OpenAI models can be ready through ChatGPT Codex auth", () => {
  const readiness = resolveModelReadiness(
    [
      {
        key: "openai/gpt-5.5",
        local: false,
        available: true,
        missing: false
      }
    ],
    {
      defaultModel: "openai/gpt-5.5",
      resolvedDefault: "openai/gpt-5.5",
      auth: {
        providers: [
          {
            provider: "openai",
            profiles: {
              count: 1
            }
          },
          {
            provider: "openai",
            profiles: {
              count: 0
            }
          }
        ],
        oauth: {
          providers: [
            {
              provider: "openai",
              status: "ok"
            },
            {
              provider: "openai",
              status: "ok"
            }
          ]
        },
        missingProvidersInUse: [],
        unusableProfiles: []
      }
    } as never
  );

  assert.equal(readiness.ready, true);
  assert.equal(readiness.defaultModelReady, true);
  assert.equal(
    readiness.authProviders.find((provider) => provider.provider === "openai")?.connected,
    true
  );
  assert.equal(readiness.preferredLoginProvider, null);
});

test("OpenAI OAuth and API-key auth remain distinct under one provider", () => {
  const readiness = resolveModelReadiness(
    [
      {
        key: "openai/gpt-5.4-pro",
        local: false,
        available: true,
        missing: false
      }
    ],
    {
      defaultModel: "openai/gpt-5.4-pro",
      resolvedDefault: "openai/gpt-5.4-pro",
      auth: {
        providers: [
          {
            provider: "openai",
            profiles: {
              count: 1
            }
          },
          {
            provider: "openai",
            profiles: {
              count: 0
            }
          }
        ],
        oauth: {
          providers: [
            {
              provider: "openai",
              status: "ok"
            },
            {
              provider: "openai",
              status: "ok"
            }
          ]
        },
        missingProvidersInUse: [],
        unusableProfiles: []
      }
    } as never
  );

  assert.equal(readiness.ready, true);
  assert.equal(readiness.defaultModelReady, true);
  assert.equal(readiness.authProviders.find((provider) => provider.provider === "openai")?.connected, true);
  assert.equal(readiness.preferredLoginProvider, null);
});

test("provider status treats mixed ChatGPT OAuth profiles as connected", () => {
  const connection = buildModelStatusConnectionStatus(
    "openai",
    {
      allowed: ["openai/gpt-5.5"],
      auth: {
        providers: [
          {
            provider: "openai",
            effective: {
              kind: "profiles"
            },
            profiles: {
              count: 3
            }
          }
        ],
        oauth: {
          providers: [
            {
              provider: "openai",
              status: "expired",
              profiles: [
                {
                  profileId: "openai:default",
                  status: "expired"
                },
                {
                  profileId: "openai:user@example.com",
                  status: "ok"
                }
              ]
            } as never
          ]
        }
      }
    },
    new Set(["openai/gpt-5.5"])
  );

  assert.equal(connection?.connected, true);
  assert.equal(connection?.detail, "ChatGPT OAuth connected");
});

test("provider status does not treat OpenAI API keys as ChatGPT OAuth", () => {
  const connection = buildModelStatusConnectionStatus(
    "openai",
    {
      allowed: ["openai/gpt-5.4-pro"],
      auth: {
        providers: [
          {
            provider: "openai",
            effective: {
              kind: "api-key"
            },
            profiles: {
              count: 1
            }
          }
        ],
        oauth: {
          providers: []
        }
      }
    },
    new Set(["openai/gpt-5.4-pro"])
  );

  assert.equal(connection?.connected, true);
  assert.equal(connection?.authMethod, "api-key");
});

test("provider status does not treat ChatGPT OAuth as an OpenAI API key", () => {
  const connection = buildModelStatusConnectionStatus(
    "openai",
    {
      allowed: ["openai/gpt-5.4-pro"],
      auth: {
        providers: [
          {
            provider: "openai",
            effective: {
              kind: "oauth"
            },
            profiles: {
              count: 1
            }
          }
        ],
        oauth: {
          providers: [
            {
              provider: "openai",
              status: "ok"
            }
          ]
        }
      }
    },
    new Set(["openai/gpt-5.4-pro"])
  );

  assert.equal(connection?.connected, true);
  assert.equal(connection?.authMethod, "chatgpt-oauth");
});

test("provider status does not treat Codex runtime OAuth profiles as OpenAI API connection", () => {
  const connection = buildModelStatusConnectionStatus(
    "openai",
    {
      allowed: ["openai/gpt-5.5"],
      auth: {
        runtimeAuthRoutes: [
          {
            provider: "openai",
            runtime: "codex",
            authProvider: "openai",
            status: "usable"
          }
        ],
        providers: [
          {
            provider: "openai",
            effective: {
              kind: "profiles"
            },
            profiles: {
              count: 1,
              oauth: 1,
              token: 0,
              apiKey: 0
            },
            syntheticAuth: {
              value: "plugin-owned",
              source: "codex-app-server",
              credential: "codex-app-server",
              mode: "token"
            }
          }
        ],
        oauth: {
          providers: [
            {
              provider: "openai",
              status: "ok",
              profiles: [
                {
                  profileId: "openai:user@example.com",
                  status: "static"
                }
              ]
            } as never
          ]
        }
      }
    } as never,
    new Set(["openai/gpt-5.5"])
  );

  assert.equal(connection?.connected, true);
  assert.equal(connection?.authMethod, "chatgpt-oauth");
});

test("provider status treats usable Codex runtime auth routes as ChatGPT connection", () => {
  const connection = buildModelStatusConnectionStatus(
    "openai",
    {
      allowed: ["openai/gpt-5.5"],
      auth: {
        runtimeAuthRoutes: [
          {
            provider: "openai",
            runtime: "codex",
            authProvider: "openai",
            status: "usable"
          }
        ],
        providers: [],
        oauth: {
          providers: []
        }
      }
    },
    new Set(["openai/gpt-5.5"])
  );

  assert.equal(connection?.connected, true);
  assert.equal(connection?.detail, "ChatGPT OAuth connected");
});

test("provider status treats OpenAI API key profiles as OpenAI connection", () => {
  const connection = buildModelStatusConnectionStatus(
    "openai",
    {
      allowed: ["openai/gpt-5.4-pro"],
      auth: {
        providers: [
          {
            provider: "openai",
            effective: {
              kind: "profiles"
            },
            profiles: {
              count: 1,
              oauth: 0,
              token: 0,
              apiKey: 1
            }
          } as never
        ],
        oauth: {
          providers: []
        }
      }
    },
    new Set(["openai/gpt-5.4-pro"])
  );

  assert.equal(connection?.connected, true);
});

test("provider status rejects unsupported Codex app-server provider auth", () => {
  const connection = buildModelStatusConnectionStatus(
    "openai",
    {
      allowed: ["openai/gpt-5.5"],
      auth: {
        providers: [
          {
            provider: "codex",
            effective: {
              kind: "synthetic",
              detail: "codex-app-server"
            },
            profiles: {
              count: 0
            },
            syntheticAuth: {
              value: "plugin-owned",
              source: "codex-app-server",
              credential: "codex-app-server",
              mode: "token"
            }
          }
        ]
      }
    },
    new Set(["openai/gpt-5.5"])
  );

  assert.equal(connection?.connected, false);
  assert.equal(connection?.authMethod, null);
});

test("provider status rejects expired-only ChatGPT OAuth profiles", () => {
  const connection = buildModelStatusConnectionStatus(
    "openai",
    {
      allowed: ["openai/gpt-5.5"],
      auth: {
        providers: [
          {
            provider: "openai",
            effective: {
              kind: "profiles"
            },
            profiles: {
              count: 1
            }
          }
        ],
        oauth: {
          providers: [
            {
              provider: "openai",
              status: "expired",
              profiles: [
                {
                  profileId: "openai:default",
                  status: "expired"
                }
              ]
            } as never
          ]
        }
      }
    },
    new Set(["openai/gpt-5.5"])
  );

  assert.equal(connection?.connected, false);
});

test("snapshot model records display canonical OpenAI Codex routes as ChatGPT", () => {
  const records = buildModelRecords(
    [
      {
        key: "openai/gpt-5.4-mini",
        name: "gpt-5.4-mini",
        input: "text",
        contextWindow: 272000,
        local: false,
        available: true,
        missing: false,
        tags: []
      },
      {
        key: "openai/gpt-5.4-pro",
        name: "gpt-5.4-pro",
        input: "text",
        contextWindow: 1050000,
        local: false,
        available: true,
        missing: false,
        tags: []
      }
    ],
    [],
    {
      allowed: ["openai/gpt-5.4-mini"],
      auth: {
        providers: [
          {
            provider: "openai",
            profiles: {
              count: 1
            }
          }
        ],
        oauth: {
          providers: [
            {
              provider: "openai",
              status: "ok",
              profiles: [
                {
                  profileId: "openai:user@example.com",
                  status: "ok"
                }
              ]
            }
          ]
        }
      }
    }
  );

  assert.equal(records[0]?.provider, "openai");
  assert.equal(records[0]?.available, true);
  assert.equal(records[1]?.provider, "openai");
  assert.equal(records[1]?.available, false);
});

test("snapshot model records keep known Codex routes as ChatGPT without live model status", () => {
  const records = buildModelRecords(
    [
      {
        key: "openai/gpt-5.5",
        name: "GPT-5.5",
        input: "text",
        contextWindow: 272000,
        local: false,
        available: true,
        missing: false,
        tags: []
      },
      {
        key: "openai/gpt-5.4-pro",
        name: "GPT-5.4 Pro",
        input: "text",
        contextWindow: 1050000,
        local: false,
        available: true,
        missing: false,
        tags: []
      }
    ],
    []
  );

  assert.equal(records[0]?.provider, "openai");
  assert.equal(records[1]?.provider, "openai");
});

test("snapshot model records collapse Codex aliases to canonical routes", () => {
  const records = buildModelRecords(
    [
      {
        key: "openai/gpt-5.5",
        name: "GPT-5.5",
        input: "text",
        contextWindow: 272000,
        local: false,
        available: true,
        missing: false,
        tags: []
      },
      {
        key: "openai/gpt-5.5",
        name: "GPT-5.5",
        input: "text",
        contextWindow: 272000,
        local: false,
        available: true,
        missing: false,
        tags: ["chatgpt"]
      }
    ],
    [
      {
        id: "main",
        modelId: "openai/gpt-5.5"
      } as OpenClawAgent
    ]
  );

  assert.equal(records.length, 1);
  assert.equal(records[0]?.id, "openai/gpt-5.5");
  assert.equal(records[0]?.provider, "openai");
  assert.equal(records[0]?.usageCount, 1);
});

test("snapshot model records include configured Codex routes missing from live payloads", () => {
  const models = mergeConfiguredModelsIntoModelsPayload([], ["openai/gpt-5.5"]);
  const records = buildModelRecords(
    models,
    [],
    {
      auth: {
        oauth: {
          providers: [
            {
              provider: "openai",
              status: "ok",
              profiles: [
                {
                  profileId: "openai:user@example.com",
                  status: "ok"
                }
              ]
            }
          ]
        }
      }
    }
  );

  assert.equal(records.length, 1);
  assert.equal(records[0]?.id, "openai/gpt-5.5");
  assert.equal(records[0]?.provider, "openai");
  assert.equal(records[0]?.available, true);
  assert.equal(records[0]?.missing, false);
});

test("configured model merge does not duplicate live Codex model payloads", () => {
  const models = mergeConfiguredModelsIntoModelsPayload(
    [
      {
        key: "openai/gpt-5.5",
        name: "GPT-5.5",
        input: "text",
        contextWindow: 272000,
        local: false,
        available: true,
        missing: false,
        tags: []
      }
    ],
    ["openai/gpt-5.5"]
  );

  assert.equal(models.length, 1);
  assert.equal(models[0]?.key, "openai/gpt-5.5");
});

test("mission control model selection excludes discoverable models removed from config", () => {
  const models = filterModelsToConfiguredSelection(
    [
      {
        key: "openai/gpt-5.5",
        name: "GPT-5.5",
        input: "text",
        contextWindow: 272000,
        local: false,
        available: true,
        missing: false,
        tags: []
      },
      {
        key: "openai/gpt-5.4-mini",
        name: "GPT-5.4 Mini",
        input: "text",
        contextWindow: 272000,
        local: false,
        available: true,
        missing: false,
        tags: []
      }
    ],
    ["openai/gpt-5.5"]
  );

  assert.deepEqual(models.map((model) => model.key), ["openai/gpt-5.5"]);
});

test("mission control model selection retains models assigned to agents", () => {
  const models = filterModelsToConfiguredSelection(
    [
      {
        key: "anthropic/claude-sonnet-4-5",
        name: "Claude Sonnet 4.5",
        input: "text",
        contextWindow: 200000,
        local: false,
        available: true,
        missing: false,
        tags: []
      }
    ],
    [],
    [{ modelId: "anthropic/claude-sonnet-4-5" }]
  );

  assert.deepEqual(models.map((model) => model.key), ["anthropic/claude-sonnet-4-5"]);
});

test("ChatGPT auth order repair prefers usable Codex OAuth profiles", () => {
  const repair = resolveOpenAiAuthOrderRepair({
    auth: {
      oauth: {
        providers: [
          {
            provider: "openai",
            status: "expired",
            profiles: [
              {
                profileId: "openai:default",
                status: "expired"
              },
              {
                profileId: "openai:user@example.com",
                status: "ok"
              }
            ],
            effectiveProfiles: [
              {
                profileId: "openai:default",
                status: "expired"
              },
              {
                profileId: "openai:user@example.com",
                status: "ok"
              }
            ]
          }
        ]
      }
    }
  });

  assert.equal(repair.needsRepair, true);
  assert.deepEqual(repair.profileIds, ["openai:user@example.com"]);
});

test("ChatGPT auth order repair is skipped when effective profile is usable", () => {
  const repair = resolveOpenAiAuthOrderRepair({
    auth: {
      oauth: {
        providers: [
          {
            provider: "openai",
            status: "ok",
            profiles: [
              {
                profileId: "openai:user@example.com",
                status: "ok"
              }
            ],
            effectiveProfiles: [
              {
                profileId: "openai:user@example.com",
                status: "ok"
              }
            ]
          }
        ]
      }
    }
  });

  assert.equal(repair.needsRepair, false);
  assert.deepEqual(repair.profileIds, ["openai:user@example.com"]);
});

test("ChatGPT runtime auth preflight blocks cooldown profiles before dispatch", () => {
  const block = resolveOpenAiRuntimeAuthBlock({
    auth: {
      unusableProfiles: [
        {
          profileId: "openai:user@example.com",
          provider: "openai",
          kind: "cooldown",
          remainingMs: 10_000
        }
      ],
      oauth: {
        providers: [
          {
            provider: "openai",
            status: "ok",
            profiles: [
              {
                profileId: "openai:user@example.com",
                status: "static"
              }
            ]
          }
        ]
      }
    }
  } as never);

  assert.match(block ?? "", /Reconnect ChatGPT/);
  assert.match(block ?? "", /models auth login --provider openai (?:--force )?--set-default/);
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

test("Ollama local fallback parses installed models from ollama list output", () => {
  assert.deepEqual(
    parseOllamaListModelNames(`NAME             ID              SIZE      MODIFIED
qwen3.5:9b       6488c96fa5fa    6.6 GB    3 months ago
qwen3:8b         500a1f067a9f    5.2 GB    4 months ago
llama3:8b        365c0bd3c000    4.7 GB    4 months ago
llama3:latest    365c0bd3c000    4.7 GB    4 months ago
`),
    ["qwen3.5:9b", "qwen3:8b", "llama3:8b", "llama3:latest"]
  );
});

test("Ollama catalog keeps registered models and adds other local models", () => {
  const merged = mergeOllamaCatalogModels(
    [
      {
        id: "ollama/qwen3.5:9b",
        name: "qwen3.5:9b",
        provider: "ollama",
        input: "text",
        contextWindow: null,
        local: false,
        available: true,
        missing: false,
        alreadyAdded: true,
        recommended: true,
        supportsTools: true,
        isFree: false,
        tags: []
      }
    ],
    [
      {
        id: "ollama/qwen3.5:9b",
        name: "qwen3.5:9b",
        provider: "ollama",
        input: "text",
        contextWindow: null,
        local: true,
        available: true,
        missing: false,
        alreadyAdded: true,
        recommended: true,
        supportsTools: true,
        isFree: false,
        tags: ["local-ollama"]
      },
      {
        id: "ollama/llama3:8b",
        name: "llama3:8b",
        provider: "ollama",
        input: "text",
        contextWindow: null,
        local: true,
        available: true,
        missing: false,
        alreadyAdded: false,
        recommended: true,
        supportsTools: true,
        isFree: false,
        tags: ["local-ollama"]
      }
    ]
  );

  assert.deepEqual(merged.map((model) => model.id), ["ollama/qwen3.5:9b", "ollama/llama3:8b"]);
  assert.equal(merged[0]?.local, true);
  assert.deepEqual(merged[0]?.tags, ["local-ollama"]);
});

test("fallback model metadata keeps local and context hints", () => {
  assert.deepEqual(inferFallbackModelMetadata("ollama/qwen3.5:9b"), {
    contextWindow: 262144,
    local: true
  });
  assert.deepEqual(inferFallbackModelMetadata("openai/gpt-5.4-mini"), {
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

test("session runtime mapping derives agent id from Gateway session keys", () => {
  const runtime = mapSessionCatalogEntryToRuntime(
    {
      key: "agent:agent-1:explicit:session-1",
      sessionId: "session-1",
      updatedAt: Date.parse("2026-04-13T00:00:00.000Z"),
      model: "gpt-5.4-mini",
      modelProvider: "openai",
      modelOverrideSource: "user",
      totalTokens: 42
    },
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

  assert.equal(runtime.agentId, "agent-1");
  assert.equal(runtime.modelId, "openai/gpt-5.4-mini");
  assert.equal(runtime.modelOverrideSource, "user");
  assert.equal(runtime.tokenUsage?.total, 42);
});

test("explicit inter-session transcripts produce agent message runtimes", async () => {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), "agentos-inter-session-"));
  const sessionsDir = path.join(workspacePath, ".openclaw", "agents", "agent-b", "sessions");
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(
    path.join(sessionsDir, "target-session.jsonl"),
    [
      JSON.stringify({
        type: "message",
        id: "turn-1",
        timestamp: "2026-04-13T00:00:00.000Z",
        message: {
          role: "user",
          timestamp: "2026-04-13T00:00:00.000Z",
          content:
            "[Inter-session message] sourceSession=agent:agent-a:explicit:source-session sourceChannel=webchat sourceTool=sessions_send isUser=false\nPlease inspect the workspace and report back."
        }
      })
    ].join("\n"),
    "utf8"
  );

  const runtimes = await mapSessionToRuntimes(
    {
      agentId: "agent-b",
      key: "agent:agent-b:explicit:target-session",
      sessionId: "target-session",
      updatedAt: Date.parse("2026-04-13T00:00:00.000Z"),
      ageMs: 0
    },
    [
      {
        id: "agent-b",
        workspace: workspacePath
      }
    ],
    [
      {
        id: "agent-b",
        workspace: workspacePath
      }
    ],
    (session) => mapSessionCatalogEntryToRuntime(session, [{ id: "agent-b", workspace: workspacePath }], [{ id: "agent-b", workspace: workspacePath }])
  );

  assert.equal(runtimes.length, 1);
  assert.equal(runtimes[0].agentId, "agent-b");
  assert.equal(runtimes[0].status, "running");
  assert.equal(runtimes[0].title, "Message from Agent A");
  assert.equal(runtimes[0].metadata.interSessionMessage, true);
  assert.equal(runtimes[0].metadata.sourceAgentId, "agent-a");
  assert.equal(runtimes[0].metadata.sourceTool, "sessions_send");
  assert.equal(runtimes[0].metadata.resultPreview, "Please inspect the workspace and report back.");
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

test("mission dispatch result prefers nonzero transcript usage over zero runtime usage", () => {
  const runtime = {
    id: "runtime-1",
    agentId: "agent-1",
    sessionId: "session-1",
    tokenUsage: {
      input: 0,
      output: 0,
      total: 0,
      cacheRead: 0
    }
  } as unknown as RuntimeRecord;
  const output = {
    runtimeId: "runtime-1",
    status: "available",
    finalText: "Deploy complete.",
    finalTimestamp: "2026-04-13T00:00:00.000Z",
    stopReason: "stop",
    errorMessage: null,
    items: [],
    createdFiles: [],
    warnings: [],
    warningSummary: null,
    tokenUsage: {
      input: 140,
      output: 14,
      total: 154,
      cacheRead: 70
    }
  } as unknown as RuntimeOutputRecord;

  assert.deepEqual(createMissionDispatchResultFromRuntimeOutput(runtime, output)?.meta?.agentMeta, {
    agentId: "agent-1",
    sessionId: "session-1",
    model: undefined,
    usage: {
      input: 140,
      output: 14,
      total: 154,
      cacheRead: 70
    }
  });
});

test("mission dispatch session id prefers recovered session metadata over the placeholder dispatch id", () => {
  const record = {
    id: "dispatch-1",
    agentId: "agent-1",
    mission: "Test mission",
    routedMission: "Test mission",
    thinking: "medium" as const,
    status: "running",
    workspaceId: null,
    workspacePath: null,
    submittedAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:01.000Z",
    outputDir: null,
    outputDirRelative: null,
    notesDirRelative: null,
    runner: {
      pid: null,
      childPid: null,
      startedAt: null,
      finishedAt: null,
      lastHeartbeatAt: null,
      logPath: null
    },
    observation: {
      runtimeId: null,
      observedAt: null
    },
    result: {
      runId: "run-1",
      status: "ok",
      summary: "completed",
      meta: {
        agentMeta: {
          agentId: "agent-1",
          sessionId: "session-real",
          model: "gpt-5",
          usage: {
            input: 10,
            output: 20,
            total: 30
          }
        }
      }
    },
    error: null,
    sessionId: "session-placeholder"
  };

  assert.equal(extractMissionDispatchSessionId(record), "session-real");
});

test("runtime transcript parser reads OpenClaw session content strings and tool calls", () => {
  const runtime = {
    id: "runtime:gateway:completed-1",
    source: "turn",
    key: "dispatch-1",
    title: "Gateway runtime event",
    subtitle: "sessions.changed",
    status: "completed",
    updatedAt: Date.parse("2026-04-13T00:01:00.000Z"),
    ageMs: 0,
    agentId: "agent-1",
    workspaceId: "workspace-1",
    sessionId: "session-1",
    runId: "dispatch-1",
    metadata: {
      mission: "Create the Faros document",
      dispatchId: "dispatch-1",
      dispatchSubmittedAt: "2026-04-13T00:00:00.000Z"
    }
  } as unknown as RuntimeRecord;
  const raw = [
    {
      type: "session",
      timestamp: "2026-04-13T00:00:00.000Z",
      cwd: "/tmp/workspace-1"
    },
    {
      type: "message",
      id: "user-1",
      timestamp: "2026-04-13T00:00:01.000Z",
      message: {
        role: "user",
        content: "Create the Faros document",
        timestamp: Date.parse("2026-04-13T00:00:01.000Z")
      }
    },
    {
      type: "message",
      id: "tool-call-1",
      timestamp: "2026-04-13T00:00:02.000Z",
      message: {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call-1",
            name: "apply_patch",
            arguments: {
              changes: [
                {
                  path: "/tmp/workspace-1/deliverables/faros.md",
                  kind: {
                    type: "add"
                  }
                }
              ]
            }
          }
        ],
        stopReason: "toolUse",
        timestamp: Date.parse("2026-04-13T00:00:02.000Z")
      }
    },
    {
      type: "message",
      id: "tool-result-1",
      timestamp: "2026-04-13T00:00:03.000Z",
      message: {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "apply_patch",
        isError: false,
        content: [
          {
            type: "toolResult",
            text: "{\"status\":\"completed\"}"
          }
        ],
        timestamp: Date.parse("2026-04-13T00:00:03.000Z")
      }
    },
    {
      type: "message",
      id: "assistant-1",
      timestamp: "2026-04-13T00:00:04.000Z",
      message: {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Finished: deliverables/faros.md"
          }
        ],
        stopReason: "stop",
        usage: {
          input: 10,
          output: 8,
          totalTokens: 18
        },
        timestamp: Date.parse("2026-04-13T00:00:04.000Z")
      }
    }
  ].map((entry) => JSON.stringify(entry)).join("\n");

  const output = parseRuntimeOutput(runtime, raw, "/tmp/workspace-1");

  assert.equal(output.status, "available");
  assert.equal(output.finalText, "Finished: deliverables/faros.md");
  assert.equal(output.stopReason, "stop");
  assert.deepEqual(output.tokenUsage, {
    input: 10,
    output: 8,
    total: 18,
    cacheRead: 0
  });
  assert.equal(output.items.length, 4);
  assert.equal(output.items[1].role, "toolCall");
  assert.equal(output.items[1].toolName, "apply_patch");
  assert.deepEqual(output.createdFiles, [
    {
      path: "/tmp/workspace-1/deliverables/faros.md",
      displayPath: "deliverables/faros.md"
    }
  ]);
});

test("runtime transcript parser reads authoritative OpenClaw native session history", () => {
  const runtime = {
    id: "runtime:gateway:native-history-1",
    source: "turn",
    key: "agent:main:main",
    title: "Native Gateway runtime",
    subtitle: "completed",
    status: "completed",
    updatedAt: Date.parse("2026-04-13T00:01:00.000Z"),
    ageMs: 0,
    agentId: "main",
    sessionId: "session-native-1",
    runId: "dispatch-native-1",
    metadata: {
      mission: "Prepare the launch brief",
      dispatchSubmittedAt: "2026-04-13T00:00:00.000Z"
    }
  } as unknown as RuntimeRecord;
  const output = parseRuntimeOutputFromSessionHistory(runtime, {
    messages: [
      {
        role: "user",
        content: "Prepare the launch brief",
        timestamp: Date.parse("2026-04-13T00:00:01.000Z")
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Launch brief is ready." }],
        stopReason: "stop",
        timestamp: Date.parse("2026-04-13T00:00:04.000Z"),
        usage: { input: 10, output: 8, totalTokens: 18 }
      }
    ]
  });

  assert.equal(output.status, "available");
  assert.equal(output.finalText, "Launch brief is ready.");
  assert.equal(output.stopReason, "stop");
  assert.equal(output.finalTimestamp, "2026-04-13T00:00:04.000Z");
  assert.deepEqual(output.tokenUsage, {
    input: 10,
    output: 8,
    total: 18,
    cacheRead: 0
  });
});

test("runtime transcript parser recovers follow-up turns from the stored turn prompt", () => {
  const prompt = [
    "Continue this task in the existing task context. Use the current OpenClaw session state and previous result; do not restart unless the operator explicitly asks for a retry.",
    "",
    "Operator follow-up:",
    "Please verify the rollout status.",
    "",
    "Original mission:",
    "Create the Faros document",
    "",
    "Latest result:",
    "The document is complete."
  ].join("\n");
  const runtime = {
    id: "runtime:gateway:follow-up-1",
    source: "turn",
    key: "dispatch-1:continue:1234",
    title: "Gateway runtime event",
    subtitle: "sessions.changed",
    status: "completed",
    updatedAt: Date.parse("2026-04-13T00:02:00.000Z"),
    ageMs: 0,
    agentId: "agent-1",
    workspaceId: "workspace-1",
    sessionId: "session-1",
    runId: "dispatch-1:continue:1234",
    metadata: {
      turnPrompt: prompt
    }
  } as unknown as RuntimeRecord;
  const raw = [
    {
      type: "session",
      timestamp: "2026-04-13T00:00:00.000Z",
      cwd: "/tmp/workspace-1"
    },
    {
      type: "message",
      id: "user-1",
      timestamp: "2026-04-13T00:02:01.000Z",
      message: {
        role: "user",
        content: prompt,
        timestamp: Date.parse("2026-04-13T00:02:01.000Z")
      }
    },
    {
      type: "message",
      id: "assistant-1",
      timestamp: "2026-04-13T00:02:10.000Z",
      message: {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Rollout status is clear."
          }
        ],
        stopReason: "stop",
        usage: {
          input: 12,
          output: 6,
          totalTokens: 18
        },
        timestamp: Date.parse("2026-04-13T00:02:10.000Z")
      }
    }
  ].map((entry) => JSON.stringify(entry)).join("\n");

  const output = parseRuntimeOutput(runtime, raw, "/tmp/workspace-1");

  assert.equal(output.status, "available");
  assert.equal(output.finalText, "Rollout status is clear.");
});

test("codex rollout parser captures final token usage for mirrored turns", () => {
  const raw = [
    {
      timestamp: "2026-04-13T00:00:01.000Z",
      type: "event_msg",
      payload: {
        type: "task_started",
        turn_id: "turn-1"
      }
    },
    {
      timestamp: "2026-04-13T00:00:02.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 100,
            cached_input_tokens: 25,
            output_tokens: 10,
            total_tokens: 110
          }
        }
      }
    },
    {
      timestamp: "2026-04-13T00:00:03.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 140,
            cached_input_tokens: 70,
            output_tokens: 14,
            total_tokens: 154
          }
        }
      }
    },
    {
      timestamp: "2026-04-13T00:00:04.000Z",
      type: "event_msg",
      payload: {
        type: "task_complete",
        turn_id: "turn-1"
      }
    }
  ].map((entry) => JSON.stringify(entry)).join("\n");

  assert.deepEqual(extractCodexRolloutTokenUsageForTurn(raw, "turn-1"), {
    input: 140,
    output: 14,
    total: 154,
    cacheRead: 70
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

test("task records inherit workspace id from their owning agent", () => {
  const tasks = buildTaskRecords(
    [
      {
        id: "runtime:turn-1",
        source: "turn",
        key: "session-1",
        title: "Gateway runtime event",
        subtitle: "agent",
        status: "running",
        updatedAt: Date.parse("2026-04-13T00:00:30.000Z"),
        ageMs: 0,
        agentId: "agent-1",
        sessionId: "session-1",
        metadata: {
          mission: "Create the Faros document",
          turnId: "turn-1"
        }
      }
    ] as RuntimeRecord[],
    [
      {
        id: "agent-1",
        name: "Research Lead",
        workspaceId: "workspace-1"
      }
    ] as Parameters<typeof buildTaskRecords>[1]
  );

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].workspaceId, "workspace-1");
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

test("mission dispatch terminal status wins over ambient session activity", () => {
  const runtimes = [
    {
      id: "runtime:dispatch-completed",
      source: "turn",
      key: "dispatch-1",
      title: "Gateway runtime event",
      subtitle: "Dispatch runner finished.",
      status: "completed",
      updatedAt: Date.parse("2026-04-13T00:01:00.000Z"),
      ageMs: 0,
      agentId: "agent-1",
      workspaceId: "workspace-1",
      sessionId: "actual-session",
      runId: "dispatch-1",
      metadata: {
        dispatchId: "dispatch-1",
        dispatchStatus: "completed",
        dispatchSubmittedAt: "2026-04-13T00:00:00.000Z",
        mission: "Create the Faros document"
      }
    },
    {
      id: "runtime:ambient-session",
      source: "session",
      key: "agent:agent-1:explicit:actual-session",
      title: "Agent session",
      subtitle: "chat",
      status: "running",
      updatedAt: Date.parse("2026-04-13T00:01:01.000Z"),
      ageMs: 0,
      agentId: "agent-1",
      sessionId: "actual-session",
      metadata: {}
    }
  ] as unknown as RuntimeRecord[];

  const tasks = buildTaskRecords(runtimes, [
    {
      id: "agent-1",
      name: "Research Lead"
    }
  ] as Parameters<typeof buildTaskRecords>[1]);

  assert.equal(tasks[0].key, "dispatch:dispatch-1");
  assert.equal(tasks[0].status, "completed");
  assert.equal(tasks[0].liveRunCount, 0);
  assert.equal(tasks[0].workspaceId, "workspace-1");
});

test("mission dispatch task cards prefer dispatch output over generic gateway events", () => {
  const runtimes = [
    {
      id: "runtime:gateway:session-changed",
      source: "turn",
      key: "actual-session",
      title: "Gateway runtime event",
      subtitle: "sessions.changed",
      status: "completed",
      updatedAt: Date.parse("2026-04-13T00:01:01.000Z"),
      ageMs: 0,
      agentId: "agent-1",
      workspaceId: "workspace-1",
      sessionId: "actual-session",
      metadata: {
        origin: "openclaw-gateway-event"
      }
    },
    {
      id: "runtime:gateway:dispatch-output",
      source: "turn",
      key: "dispatch-1",
      title: "Gateway runtime event",
      subtitle: "Prepared the strategy file: /tmp/workspace-1/deliverables/run/linkedin-strategy.md",
      status: "completed",
      updatedAt: Date.parse("2026-04-13T00:01:00.000Z"),
      ageMs: 0,
      agentId: "agent-1",
      workspaceId: "workspace-1",
      sessionId: "actual-session",
      runId: "dispatch-1",
      metadata: {
        dispatchId: "dispatch-1",
        dispatchStatus: "completed",
        dispatchSubmittedAt: "2026-04-13T00:00:00.000Z",
        mission: "Create the LinkedIn strategy"
      }
    }
  ] as unknown as RuntimeRecord[];

  const tasks = buildTaskRecords(runtimes, [
    {
      id: "agent-1",
      name: "Research Lead"
    }
  ] as Parameters<typeof buildTaskRecords>[1]);

  assert.equal(tasks[0].status, "completed");
  assert.match(tasks[0].subtitle, /Prepared the strategy file/);
  assert.match(String(tasks[0].metadata.resultPreview), /Prepared the strategy file/);
  assert.equal(tasks[0].artifactCount, 1);
});

test("mission dispatch task cards dedupe repeated gateway token usage", () => {
  const tokenUsage = {
    input: 693,
    output: 172,
    total: 81121,
    cacheRead: 80256
  };
  const runtimes = [
    {
      id: "runtime:gateway:event-1",
      source: "turn",
      key: "dispatch-1",
      title: "Gateway runtime event",
      subtitle: "Prepared the strategy file.",
      status: "completed",
      updatedAt: Date.parse("2026-04-13T00:01:01.000Z"),
      ageMs: 0,
      agentId: "agent-1",
      workspaceId: "workspace-1",
      sessionId: "actual-session",
      runId: "dispatch-1",
      tokenUsage,
      metadata: {
        dispatchId: "dispatch-1",
        dispatchStatus: "completed",
        mission: "Create the LinkedIn strategy"
      }
    },
    {
      id: "runtime:gateway:event-2",
      source: "turn",
      key: "dispatch-1",
      title: "Gateway runtime event",
      subtitle: "Prepared the strategy file.",
      status: "completed",
      updatedAt: Date.parse("2026-04-13T00:01:00.000Z"),
      ageMs: 0,
      agentId: "agent-1",
      workspaceId: "workspace-1",
      sessionId: "agent:agent-1:explicit:requested-session",
      runId: "dispatch-1",
      tokenUsage,
      metadata: {
        dispatchId: "dispatch-1",
        dispatchStatus: "completed",
        mission: "Create the LinkedIn strategy"
      }
    }
  ] as unknown as RuntimeRecord[];

  const tasks = buildTaskRecords(runtimes, [
    {
      id: "agent-1",
      name: "Research Lead"
    }
  ] as Parameters<typeof buildTaskRecords>[1]);

  assert.deepEqual(tasks[0].tokenUsage, tokenUsage);
});

test("task feed collapses duplicate dispatch transcript events", () => {
  const task = {
    id: "task-1",
    key: "dispatch:dispatch-1",
    title: "Create the Faros document",
    mission: "Create the Faros document",
    subtitle: "completed",
    status: "completed",
    updatedAt: Date.parse("2026-04-13T00:01:00.000Z"),
    ageMs: 0,
    primaryAgentId: "agent-1",
    runtimeIds: ["runtime:missing", "runtime:available-1", "runtime:available-2"],
    agentIds: ["agent-1"],
    sessionIds: ["session-1"],
    runIds: ["dispatch-1"],
    runtimeCount: 3,
    updateCount: 3,
    liveRunCount: 0,
    artifactCount: 1,
    warningCount: 0,
    dispatchId: "dispatch-1",
    metadata: {}
  } as unknown as Parameters<typeof buildTaskFeed>[0];
  const runs = [
    {
      id: "runtime:missing",
      source: "turn",
      key: "dispatch-1",
      title: "Gateway runtime event",
      subtitle: "sessions.changed",
      status: "completed",
      updatedAt: Date.parse("2026-04-13T00:00:30.000Z"),
      ageMs: 0,
      agentId: "agent-1",
      sessionId: "session-1",
      metadata: {
        dispatchId: "dispatch-1"
      }
    },
    {
      id: "runtime:available-1",
      source: "turn",
      key: "dispatch-1",
      title: "Gateway runtime event",
      subtitle: "completed",
      status: "completed",
      updatedAt: Date.parse("2026-04-13T00:01:00.000Z"),
      ageMs: 0,
      agentId: "agent-1",
      sessionId: "session-1",
      metadata: {
        dispatchId: "dispatch-1"
      }
    },
    {
      id: "runtime:available-2",
      source: "turn",
      key: "dispatch-1",
      title: "Gateway runtime event",
      subtitle: "completed",
      status: "completed",
      updatedAt: Date.parse("2026-04-13T00:01:01.000Z"),
      ageMs: 0,
      agentId: "agent-1",
      sessionId: "session-1",
      metadata: {
        dispatchId: "dispatch-1"
      }
    }
  ] as unknown as RuntimeRecord[];
  const output = {
    sessionId: "session-1",
    status: "available",
    finalText: "Created the Faros document.",
    finalTimestamp: "2026-04-13T00:01:00.000Z",
    stopReason: "stop",
    errorMessage: null,
    items: [
      {
        id: "tool-call-1",
        role: "toolCall",
        timestamp: "2026-04-13T00:00:45.000Z",
        text: "Called apply_patch",
        toolName: "apply_patch"
      },
      {
        id: "assistant-1",
        role: "assistant",
        timestamp: "2026-04-13T00:01:00.000Z",
        text: "Created the Faros document."
      }
    ],
    createdFiles: [
      {
        path: "/tmp/workspace-1/deliverables/run/faros.md",
        displayPath: "deliverables/run/faros.md"
      }
    ],
    warnings: [],
    warningSummary: null
  } as unknown as Omit<RuntimeOutputRecord, "runtimeId">;
  const outputsByRuntimeId = new Map<string, RuntimeOutputRecord>([
    [
      "runtime:missing",
      {
        runtimeId: "runtime:missing",
        status: "missing",
        finalText: null,
        finalTimestamp: null,
        stopReason: null,
        errorMessage: "No transcript file was found for this runtime session.",
        items: [],
        createdFiles: [],
        warnings: [],
        warningSummary: null
      }
    ],
    ["runtime:available-1", { ...output, runtimeId: "runtime:available-1" }],
    ["runtime:available-2", { ...output, runtimeId: "runtime:available-2" }]
  ]);

  const feed = buildTaskFeed(task, runs, outputsByRuntimeId, {
    agents: [
      {
        id: "agent-1",
        name: "Research Lead"
      }
    ]
  } as Parameters<typeof buildTaskFeed>[3]);

  assert.equal(feed.filter((event) => /No transcript file/.test(event.detail)).length, 0);
  assert.equal(feed.filter((event) => event.kind === "tool").length, 1);
  assert.equal(feed.filter((event) => event.kind === "assistant").length, 1);
  assert.equal(feed.filter((event) => event.kind === "artifact").length, 1);
});

test("task feed treats missing transcripts as waiting for output", () => {
  const task = {
    id: "task-1",
    key: "dispatch:dispatch-1",
    title: "Research the launch",
    mission: "Research the launch",
    subtitle: "No transcript entries were found for this runtime.",
    status: "stalled",
    updatedAt: Date.parse("2026-04-13T00:01:00.000Z"),
    ageMs: 0,
    primaryAgentId: "agent-1",
    runtimeIds: ["runtime:quiet"],
    agentIds: ["agent-1"],
    sessionIds: ["session-1"],
    runIds: ["dispatch-1"],
    runtimeCount: 1,
    updateCount: 1,
    liveRunCount: 0,
    artifactCount: 0,
    warningCount: 0,
    dispatchId: "dispatch-1",
    metadata: {}
  } as unknown as Parameters<typeof buildTaskFeed>[0];
  const runs = [
    {
      id: "runtime:quiet",
      source: "turn",
      key: "dispatch-1",
      title: "Gateway runtime event",
      subtitle: "No transcript entries were found for this runtime.",
      status: "stalled",
      updatedAt: Date.parse("2026-04-13T00:01:00.000Z"),
      ageMs: 0,
      agentId: "agent-1",
      sessionId: "session-1",
      metadata: {
        dispatchId: "dispatch-1"
      }
    }
  ] as unknown as RuntimeRecord[];
  const feed = buildTaskFeed(
    task,
    runs,
    new Map<string, RuntimeOutputRecord>([
      [
        "runtime:quiet",
        {
          runtimeId: "runtime:quiet",
          status: "missing",
          finalText: null,
          finalTimestamp: null,
          stopReason: null,
          errorMessage: "No transcript entries were found for this runtime.",
          items: [],
          createdFiles: [],
          warnings: [],
          warningSummary: null
        }
      ]
    ]),
    {
      agents: [
        {
          id: "agent-1",
          name: "Research Lead"
        }
      ]
    } as Parameters<typeof buildTaskFeed>[3]
  );

  assert.equal(feed.filter((event) => /No transcript/.test(event.detail)).length, 0);
  assert.equal(feed.length, 1);
  assert.equal(feed[0].kind, "status");
  assert.equal(feed[0].isError, false);
  assert.match(feed[0].title, /waiting for output/i);
});

test("task review state annotates task metadata with operator action", () => {
  const task = {
    id: "task-1",
    key: "dispatch:dispatch-1",
    title: "Review captured output",
    mission: "Review captured output",
    subtitle: "Partial final response",
    status: "stalled",
    updatedAt: Date.parse("2026-05-21T10:00:00.000Z"),
    ageMs: 0,
    primaryAgentId: "agent-1",
    runtimeIds: ["runtime-1"],
    agentIds: ["agent-1"],
    sessionIds: ["session-1"],
    runIds: ["dispatch-1"],
    runtimeCount: 1,
    updateCount: 1,
    liveRunCount: 0,
    artifactCount: 0,
    warningCount: 1,
    dispatchId: "dispatch-1",
    metadata: {}
  } satisfies MissionControlSnapshot["tasks"][number];
  const snapshot = {
    generatedAt: "2026-05-21T10:00:00.000Z",
    mode: "live",
    diagnostics: {},
    presence: [],
    channelAccounts: [],
    workspaces: [],
    agents: [],
    models: [],
    runtimes: [],
    tasks: [task],
    relationships: [],
    missionPresets: [],
    channelRegistry: {
      version: 1,
      channels: []
    }
  } as unknown as MissionControlSnapshot;
  const resolution = createTaskReviewResolution(
    task,
    "accepted",
    "Accepted result",
    "2026-05-21T10:05:00.000Z"
  );

  const nextSnapshot = applyTaskReviewStateToSnapshot(snapshot, {
    [resolution.taskKey]: resolution
  });

  assert.equal(snapshot.tasks[0].metadata.reviewStatus, undefined);
  assert.equal(nextSnapshot.tasks[0].metadata.reviewStatus, "accepted");
  assert.equal(nextSnapshot.tasks[0].metadata.reviewAction, "Accepted result");
  assert.equal(nextSnapshot.tasks[0].metadata.reviewedAt, "2026-05-21T10:05:00.000Z");
  const reviewEvents = nextSnapshot.tasks[0].metadata.reviewEvents;
  assert.equal(Array.isArray(reviewEvents), true);
  assert.equal((reviewEvents as Array<{ title: string }>)[0].title, "Review accepted");
});

test("continued task review state expires when no live activity follows", () => {
  const task = {
    id: "task-1",
    key: "dispatch:dispatch-1",
    title: "Task",
    mission: "Run task",
    subtitle: "Waiting for output",
    status: "stalled",
    updatedAt: Date.parse("2026-05-21T10:00:00.000Z"),
    ageMs: 0,
    runtimeIds: ["runtime-1"],
    agentIds: ["agent-1"],
    sessionIds: ["session-1"],
    runIds: ["dispatch-1"],
    runtimeCount: 1,
    updateCount: 1,
    liveRunCount: 0,
    artifactCount: 0,
    warningCount: 1,
    dispatchId: "dispatch-1",
    metadata: {}
  } satisfies MissionControlSnapshot["tasks"][number];
  const resolution = createTaskReviewResolution(
    task,
    "continued",
    "Accepted continuation",
    "2026-05-21T10:05:00.000Z"
  );
  const continuedTask = {
    ...task,
    metadata: {
      ...task.metadata,
      reviewStatus: resolution.status,
      reviewAction: resolution.action,
      reviewedAt: resolution.reviewedAt
    }
  };

  assert.equal(
    resolveEffectiveTaskReviewStatus(continuedTask, {
      nowMs: Date.parse("2026-05-21T10:05:30.000Z")
    }),
    "continued"
  );
  assert.equal(resolveTaskReviewFooterLabel("continued"), "continuation accepted");
  assert.equal(resolveTaskReviewSummary("continued"), "OpenClaw accepted a continuation in the existing task session.");
  assert.equal(
    resolveEffectiveTaskReviewStatus(continuedTask, {
      nowMs: Date.parse("2026-05-21T10:05:00.000Z") + taskReviewContinuationGraceMs + 1
    }),
    null
  );
  assert.equal(
    resolveEffectiveTaskReviewStatus(continuedTask, {
      hasLiveActivity: true,
      nowMs: Date.parse("2026-05-21T10:20:00.000Z")
    }),
    "continued"
  );
  assert.equal(
    resolveEffectiveTaskReviewStatus(continuedTask, {
      latestEvidenceAt: "2026-05-21T10:05:01.000Z",
      nowMs: Date.parse("2026-05-21T10:05:30.000Z")
    }),
    null
  );
});

test("mission matching accepts continuation prompts with original mission context", () => {
  assert.equal(
    matchesMissionText(
      [
        "Continue this task in the existing task context. Use the current OpenClaw session state and previous result; do not restart unless the operator explicitly asks for a retry.",
        "",
        "Operator follow-up:",
        "Continue from the captured output, finish the remaining work, and verify the result.",
        "",
        "Original mission:",
        "bana youtube stratejisi önersene bitane kanalı büyütmek için",
        "",
        "Latest result:",
        "..."
      ].join("\n"),
      "bana youtube stratejisi önersene bitane kanalı büyütmek için"
    ),
    true
  );
});

test("task review continuation prompt includes operator reply", () => {
  const task = {
    id: "task-1",
    key: "dispatch:dispatch-1",
    title: "Research competitors",
    mission: "Find three current competitors and summarize positioning.",
    subtitle: "Which market should I prioritize?",
    status: "stalled",
    updatedAt: Date.parse("2026-05-21T10:00:00.000Z"),
    ageMs: 0,
    runtimeIds: ["runtime-1"],
    agentIds: ["agent-1"],
    sessionIds: ["session-1"],
    runIds: ["dispatch-1"],
    runtimeCount: 1,
    updateCount: 1,
    liveRunCount: 0,
    artifactCount: 0,
    warningCount: 1,
    dispatchId: "dispatch-1",
    metadata: {}
  } satisfies MissionControlSnapshot["tasks"][number];

  const prompt = buildTaskReviewContinuationPrompt(
    task,
    "I found two competitors. Which market should I prioritize?",
    "Prioritize the US market and finish the third competitor comparison."
  );

  assert.match(prompt, /Operator follow-up:\nPrioritize the US market/);
  assert.match(prompt, /Original mission:\nFind three current competitors/);
  assert.match(prompt, /Latest result:\nI found two competitors/);
});

test("mission dispatch feed does not turn missing transcripts into dispatch errors", async () => {
  const task = {
    id: "task-1",
    title: "Research the launch",
    mission: "Research the launch",
    status: "stalled",
    primaryAgentId: "agent-1",
    metadata: {}
  } as unknown as Parameters<typeof buildMissionDispatchFeed>[0];
  const feed = await buildMissionDispatchFeed(
    task,
    {
      id: "dispatch-1",
      status: "stalled",
      submittedAt: "2026-04-13T00:00:00.000Z",
      updatedAt: "2026-04-13T00:01:00.000Z",
      mission: "Research the launch",
      routedMission: "Research the launch",
      runner: {
        pid: 1234,
        startedAt: "2026-04-13T00:00:05.000Z",
        finishedAt: null,
        lastHeartbeatAt: "2026-04-13T00:00:45.000Z",
        logPath: null
      },
      observation: {
        runtimeId: "runtime:quiet",
        observedAt: "2026-04-13T00:00:50.000Z"
      },
      outputDir: null,
      outputDirRelative: null,
      error: "No transcript entries were found for this runtime."
    } as unknown as Parameters<typeof buildMissionDispatchFeed>[1],
    {
      agents: [
        {
          id: "agent-1",
          name: "Research Lead"
        }
      ]
    } as Parameters<typeof buildMissionDispatchFeed>[2]
  );

  assert.equal(feed.some((event) => event.title === "Dispatch error"), false);
  const waitingEvent = feed.find((event) => event.id === "dispatch-1:stalled");
  assert.equal(waitingEvent?.kind, "status");
  assert.equal(waitingEvent?.isError, false);
  assert.match(waitingEvent?.title ?? "", /waiting for output/i);
});

test("mission dispatch matches gateway completion by dispatch run id", () => {
  const dispatchRecord = {
    id: "dispatch-1",
    status: "running",
    agentId: "agent-1",
    sessionId: "requested-session",
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
      runtimeId: "runtime:gateway:stale-observation",
      observedAt: "2026-04-13T00:00:30.000Z"
    },
    result: {
      runId: "dispatch-1",
      status: "started"
    },
    error: null
  } as const;
  const runtime = {
    id: "runtime:gateway:completed-1",
    source: "turn",
    key: "dispatch-1",
    title: "Gateway runtime event",
    subtitle: "sessions.changed",
    status: "completed",
    updatedAt: Date.parse("2026-04-13T00:01:00.000Z"),
    ageMs: 0,
    agentId: "agent-1",
    sessionId: "actual-session",
    runId: "dispatch-1",
    metadata: {
      origin: "openclaw-gateway-event"
    }
  } as unknown as RuntimeRecord;
  const laterRunningRuntime = {
    ...runtime,
    id: "runtime:gateway:running-1",
    subtitle: "chat",
    status: "running",
    updatedAt: Date.parse("2026-04-13T00:01:01.000Z"),
    sessionId: "agent:agent-1:explicit:requested-session"
  } as unknown as RuntimeRecord;

  assert.equal(matchMissionDispatchToRuntime(dispatchRecord, [laterRunningRuntime, runtime])?.id, runtime.id);

  const annotated = annotateMissionDispatchMetadata([laterRunningRuntime, runtime], [dispatchRecord]);
  assert.equal(annotated[1].metadata.dispatchId, "dispatch-1");
  assert.equal(annotated[1].metadata.mission, "Create the Faros document");
  assert.equal(annotated[1].workspaceId, "workspace-1");
  assert.equal(annotated[1].metadata.outputDir, "/tmp/workspace-1/deliverables/run");
  assert.equal(annotated[1].metadata.outputDirRelative, "deliverables/run");

  const tasks = buildTaskRecords(annotated, [
    {
      id: "agent-1",
      name: "Research Lead"
    }
  ] as Parameters<typeof buildTaskRecords>[1]);
  assert.equal(tasks[0].workspaceId, "workspace-1");
});

test("mission dispatch hydrates gateway completion token usage from related session", async () => {
  const dispatchRecord = {
    id: "dispatch-1",
    status: "running",
    agentId: "agent-1",
    sessionId: "requested-session",
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
    result: {
      runId: "dispatch-1",
      status: "started"
    },
    error: null
  } as const;
  const completedRuntime = {
    id: "runtime:gateway:completed-1",
    source: "turn",
    key: "dispatch-1",
    title: "Gateway runtime event",
    subtitle: "sessions.changed",
    status: "completed",
    updatedAt: Date.parse("2026-04-13T00:01:00.000Z"),
    ageMs: 0,
    agentId: "agent-1",
    workspaceId: "workspace-1",
    sessionId: "actual-session",
    runId: "dispatch-1",
    metadata: {
      origin: "openclaw-gateway-event"
    }
  } as unknown as RuntimeRecord;
  const sessionRuntime = {
    id: "runtime:actual-session:summary",
    source: "session",
    key: "agent:agent-1:explicit:actual-session",
    title: "Agent session",
    subtitle: "main session",
    status: "running",
    updatedAt: Date.parse("2026-04-13T00:01:01.000Z"),
    ageMs: 0,
    agentId: "agent-1",
    workspaceId: "workspace-1",
    sessionId: "actual-session",
    modelId: "openai/gpt-5.4-mini",
    tokenUsage: {
      input: 259,
      output: 435,
      total: 84355,
      cacheRead: 83661
    },
    metadata: {
      origin: "openclaw-runtime-snapshot"
    }
  } as unknown as RuntimeRecord;

  const runtimes = await buildMissionDispatchRuntimes(
    [completedRuntime, sessionRuntime],
    [dispatchRecord],
    {
      buildObservedRuntime: async () => null,
      persistObservation: async () => {},
      reconcileRuntimeState: async () => {}
    }
  );

  assert.equal(runtimes[0].id, completedRuntime.id);
  assert.equal(runtimes[0].status, "completed");
  assert.deepEqual(runtimes[0].tokenUsage, sessionRuntime.tokenUsage);
  assert.equal(runtimes[0].modelId, "openai/gpt-5.4-mini");
  assert.equal(runtimes[0].metadata.dispatchId, "dispatch-1");
  assert.equal(runtimes[0].metadata.usageSessionRuntimeId, sessionRuntime.id);
});

test("mission dispatch runtimes use reconciled terminal state in the same snapshot", async () => {
  const dispatchRecord = {
    id: "dispatch-1",
    status: "stalled",
    agentId: "agent-1",
    sessionId: "requested-session",
    mission: "Create the LinkedIn strategy",
    routedMission: "Create the LinkedIn strategy",
    thinking: "medium",
    workspaceId: "workspace-1",
    workspacePath: "/tmp/workspace-1",
    submittedAt: "2026-04-13T00:00:00.000Z",
    updatedAt: "2026-04-13T00:01:00.000Z",
    outputDir: "/tmp/workspace-1/deliverables/run",
    outputDirRelative: "deliverables/run",
    notesDirRelative: "memory",
    runner: {
      pid: null,
      childPid: null,
      startedAt: "2026-04-13T00:00:00.000Z",
      finishedAt: "2026-04-13T00:01:00.000Z",
      lastHeartbeatAt: "2026-04-13T00:01:00.000Z",
      logPath: null
    },
    observation: {
      runtimeId: null,
      observedAt: null
    },
    result: {
      runId: "dispatch-1",
      status: "started"
    },
    error: "No transcript entries were found for this runtime."
  } as const;
  const completedRuntime = {
    id: "runtime:gateway:completed-1",
    source: "turn",
    key: "dispatch-1",
    title: "Gateway runtime event",
    subtitle: "Prepared the strategy file.",
    status: "completed",
    updatedAt: Date.parse("2026-04-13T00:01:10.000Z"),
    ageMs: 0,
    agentId: "agent-1",
    workspaceId: "workspace-1",
    sessionId: "actual-session",
    runId: "dispatch-1",
    metadata: {
      origin: "openclaw-gateway-event"
    }
  } as unknown as RuntimeRecord;
  const reconciledRecord = {
    ...dispatchRecord,
    status: "completed",
    updatedAt: "2026-04-13T00:01:10.000Z",
    runner: {
      ...dispatchRecord.runner,
      finishedAt: "2026-04-13T00:01:10.000Z",
      lastHeartbeatAt: "2026-04-13T00:01:10.000Z"
    },
    result: {
      runId: "dispatch-1",
      status: "ok",
      summary: "completed",
      result: {
        payloads: [
          {
            text: "Prepared the strategy file.",
            mediaUrl: null
          }
        ]
      }
    },
    error: null
  } satisfies Parameters<typeof buildMissionDispatchRuntimes>[1][number];

  const runtimes = await buildMissionDispatchRuntimes(
    [completedRuntime],
    [dispatchRecord],
    {
      buildObservedRuntime: async () => null,
      persistObservation: async () => {},
      reconcileRuntimeState: async () => reconciledRecord
    }
  );

  assert.equal(runtimes[0].status, "completed");
  assert.equal(runtimes[0].metadata.dispatchStatus, "completed");
});

test("runtime history keeps current dispatch runtime outside recent agent limit", () => {
  const base = Date.parse("2026-04-13T00:00:00.000Z");
  const recentRuntimes = Array.from({ length: 9 }, (_, index) => ({
    id: `runtime:recent-${index}`,
    source: "session",
    key: `agent:agent-1:explicit:recent-${index}`,
    title: "Agent session",
    subtitle: "main session",
    status: "running",
    updatedAt: base + 10_000 + index,
    ageMs: 0,
    agentId: "agent-1",
    workspaceId: "workspace-1",
    sessionId: `recent-${index}`,
    metadata: {}
  })) as unknown as RuntimeRecord[];
  const dispatchRuntime = {
    id: "runtime:gateway:completed-1",
    source: "turn",
    key: "dispatch-1",
    title: "Gateway runtime event",
    subtitle: "sessions.changed",
    status: "completed",
    updatedAt: base,
    ageMs: 0,
    agentId: "agent-1",
    workspaceId: "workspace-1",
    sessionId: "actual-session",
    runId: "dispatch-1",
    metadata: {
      dispatchId: "dispatch-1"
    }
  } as unknown as RuntimeRecord;

  const result = mergeRuntimeHistoryRecords([...recentRuntimes, dispatchRuntime], new Map());

  assert.ok(result.runtimes.some((runtime) => runtime.id === dispatchRuntime.id));
  assert.equal(result.runtimes.filter((runtime) => runtime.agentId === "agent-1").length, 9);

  const nextResult = mergeRuntimeHistoryRecords(recentRuntimes, result.cache);

  assert.equal(nextResult.runtimes.some((runtime) => runtime.id === dispatchRuntime.id), false);
});

test("runtime history keeps operator-visible agent messages outside recent agent limit", () => {
  const base = Date.parse("2026-04-13T00:00:00.000Z");
  const recentRuntimes = Array.from({ length: 9 }, (_, index) => ({
    id: `runtime:recent-message-${index}`,
    source: "session",
    key: `agent:agent-1:explicit:recent-message-${index}`,
    title: "Agent session",
    subtitle: "main session",
    status: "running",
    updatedAt: base + 10_000 + index,
    ageMs: 0,
    agentId: "agent-1",
    workspaceId: "workspace-1",
    sessionId: `recent-message-${index}`,
    metadata: {}
  })) as unknown as RuntimeRecord[];
  const agentMessageRuntime = {
    id: "runtime:agent-message-1",
    source: "turn",
    key: "agent:agent-1:main:turn:message-1",
    title: "Message from Agent Two",
    subtitle: "Agent message received.",
    status: "completed",
    updatedAt: base,
    ageMs: 0,
    agentId: "agent-1",
    workspaceId: "workspace-1",
    sessionId: "session-1",
    metadata: {
      interSessionMessage: true,
      sourceAgentId: "agent-2"
    }
  } as unknown as RuntimeRecord;

  const result = mergeRuntimeHistoryRecords([...recentRuntimes, agentMessageRuntime], new Map());

  assert.ok(result.runtimes.some((runtime) => runtime.id === agentMessageRuntime.id));
  assert.equal(result.runtimes.filter((runtime) => runtime.agentId === "agent-1").length, 9);
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

test("task cards ignore Gateway runtime events from recorded direct chat sessions", () => {
  const runtimes = annotateAgentChatRuntimes(
    [
      {
        id: "runtime:gateway:direct-chat",
        source: "turn",
        key: "agentos:mpvp9v8y:rdxnctfeg5o",
        title: "Gateway runtime event",
        subtitle: "chat",
        status: "running",
        updatedAt: Date.parse("2026-04-13T00:00:30.000Z"),
        ageMs: 0,
        agentId: "agent-1",
        workspaceId: "workspace-1",
        sessionId: "agent:agent-1:explicit:chat-session",
        runId: "agentos:mpvp9v8y:rdxnctfeg5o",
        metadata: {
          origin: "openclaw-gateway-event",
          event: "chat"
        }
      },
      {
        id: "runtime:mission-dispatch",
        source: "turn",
        key: "dispatch-1",
        title: "Gateway runtime event",
        subtitle: "Wrote the deliverable",
        status: "completed",
        updatedAt: Date.parse("2026-04-13T00:01:00.000Z"),
        ageMs: 0,
        agentId: "agent-1",
        workspaceId: "workspace-1",
        sessionId: "dispatch-session",
        runId: "dispatch-1",
        metadata: {
          origin: "mission-dispatch",
          dispatchId: "dispatch-1",
          mission: "Create the Faros document"
        }
      }
    ] as unknown as RuntimeRecord[],
    new Map([
      [
        "agent-1:chat-session",
        {
          agentId: "agent-1",
          sessionId: "chat-session",
          workspacePath: "/tmp/workspace-1",
          createdAt: "2026-04-13T00:00:00.000Z",
          updatedAt: "2026-04-13T00:00:30.000Z",
          origin: "agent-chat"
        }
      ]
    ])
  );

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

test("task cards ignore raw Gateway events without mission task identity", () => {
  const runtimes = [
    {
      id: "runtime:gateway:raw-event",
      source: "turn",
      key: "agentos:mpvp9v8y:rdxnctfeg5o",
      title: "Gateway runtime event",
      subtitle: "sessions.changed",
      status: "running",
      updatedAt: Date.parse("2026-04-13T00:00:30.000Z"),
      ageMs: 0,
      agentId: "agent-1",
      workspaceId: "workspace-1",
      sessionId: "session-1",
      runId: "agentos:mpvp9v8y:rdxnctfeg5o",
      metadata: {
        origin: "openclaw-gateway-event",
        event: "sessions.changed"
      }
    }
  ] as unknown as RuntimeRecord[];

  const tasks = buildTaskRecords(runtimes, [
    {
      id: "agent-1",
      name: "Research Lead"
    }
  ] as Parameters<typeof buildTaskRecords>[1]);

  assert.equal(tasks.length, 0);
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
    thinking: "xhigh",
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
  assert.equal(resolved.thinking, "xhigh");
  assert.equal(resolved.rules.workspaceOnly, true);
  assert.equal(resolved.agents[0].id, "primary-lead");
  assert.equal(resolved.agents[0].role, "Lead");
  assert.equal(resolved.agents[0].name, "Primary Lead");
  assert.equal(resolved.agents[0].policy?.fileAccess, "extended");
  assert.deepEqual(resolved.docOverrides, [
    {
      path: "docs/brief.md",
      content: "new"
    }
  ]);
  assert.equal(targetDir, "/workspaces/alpha-workspace");
});
