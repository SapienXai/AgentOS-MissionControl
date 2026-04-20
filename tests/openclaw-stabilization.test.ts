import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeControlPlaneSnapshot } from "@/lib/agentos/acl/openclaw";
import { parseOpenClawVersion } from "@/lib/openclaw/cli";
import { resolveUpdateInfo } from "@/lib/openclaw/domains/control-plane-normalization";
import { createMissionDispatchResultFromRuntimeOutput } from "@/lib/openclaw/domains/mission-dispatch-model";
import { normalizeChannelRegistry } from "@/lib/openclaw/domains/workspace-manifest";
import {
  resolveWorkspaceBootstrapInput,
  resolveWorkspaceCreationTargetDir
} from "@/lib/openclaw/domains/workspace-bootstrap";
import { inferSessionKindFromCatalogEntry } from "@/lib/openclaw/service";
import type { ControlPlaneSnapshot } from "@/lib/agentos/contracts";
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
