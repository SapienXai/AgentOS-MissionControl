import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAgentPayloadsFromConfig,
  buildAgentPayloadsFromGatewayList
} from "@/lib/openclaw/adapter/agent-adapter";
import { buildSnapshotAgentEntry } from "@/lib/openclaw/adapter/agent-snapshot-adapter";
import {
  markAgentChatSessionActive,
  markAgentChatSessionInactive
} from "@/lib/openclaw/domains/agent-chat-sessions";

test("agent adapter suppresses legacy native-create duplicates in config fallback", () => {
  const agents = buildAgentPayloadsFromConfig([
    {
      id: "sen-atlas",
      name: "Sen Atlas",
      workspace: "/Users/example/.openclaw/workspace",
      agentDir: "/Users/example/.openclaw/agents/sen-atlas/agent"
    },
    {
      id: "workspace-sen-atlas",
      name: "Sen Atlas",
      workspace: "/Users/example/.openclaw/workspace",
      agentDir: "/Users/example/.openclaw/workspace/.openclaw/agents/workspace-sen-atlas/agent"
    },
    {
      id: "workspace-reviewer",
      name: "Reviewer",
      workspace: "/Users/example/.openclaw/workspace",
      agentDir: "/Users/example/.openclaw/workspace/.openclaw/agents/workspace-reviewer/agent"
    }
  ], "/Users/example/.openclaw");

  assert.deepEqual(agents.map((agent) => agent.id), ["workspace-sen-atlas", "workspace-reviewer"]);
});

test("agent adapter preserves same-name workspace-local agents", () => {
  const agents = buildAgentPayloadsFromConfig([
    {
      id: "workspace-reviewer-a",
      name: "Reviewer",
      workspace: "/Users/example/project",
      agentDir: "/Users/example/project/.openclaw/agents/workspace-reviewer-a/agent"
    },
    {
      id: "workspace-reviewer-b",
      name: "Reviewer",
      workspace: "/Users/example/project",
      agentDir: "/Users/example/project/.openclaw/agents/workspace-reviewer-b/agent"
    }
  ], "/Users/example/.openclaw");

  assert.deepEqual(agents.map((agent) => agent.id), ["workspace-reviewer-a", "workspace-reviewer-b"]);
});

test("agent adapter suppresses legacy native-create duplicates in Gateway list snapshots", () => {
  const agents = buildAgentPayloadsFromGatewayList(
    {
      agents: [
        {
          id: "sen-atlas",
          name: "Sen Atlas",
          workspace: "/Users/example/.openclaw/workspace"
        },
        {
          id: "workspace-sen-atlas",
          name: "Sen Atlas",
          workspace: "/Users/example/.openclaw/workspace"
        }
      ]
    },
    [
      {
        id: "sen-atlas",
        name: "Sen Atlas",
        workspace: "/Users/example/.openclaw/workspace",
        agentDir: "/Users/example/.openclaw/agents/sen-atlas/agent"
      },
      {
        id: "workspace-sen-atlas",
        name: "Sen Atlas",
        workspace: "/Users/example/.openclaw/workspace",
        agentDir: "/Users/example/.openclaw/workspace/.openclaw/agents/workspace-sen-atlas/agent"
      }
    ],
    "/Users/example/.openclaw"
  );

  assert.deepEqual(agents.map((agent) => agent.id), ["workspace-sen-atlas"]);
});

test("agent adapter keeps configured display name when Gateway reports id as name", () => {
  const agents = buildAgentPayloadsFromGatewayList(
    {
      agents: [
        {
          id: "workspace-aslans-chinesse-builder-manyak-musti",
          name: "workspace-aslans-chinesse-builder-manyak-musti",
          workspace: "/Users/example/project"
        }
      ]
    },
    [
      {
        id: "workspace-aslans-chinesse-builder-manyak-musti",
        name: "Manyak Musti",
        workspace: "/Users/example/project",
        agentDir: "/Users/example/project/.openclaw/agents/workspace-aslans-chinesse-builder-manyak-musti/agent",
        identity: {
          name: "Manyak Musti"
        }
      }
    ],
    "/Users/example/.openclaw"
  );

  assert.equal(agents[0]?.name, "Manyak Musti");
  assert.equal(agents[0]?.identityName, "Manyak Musti");
});

test("agent adapter excludes typed system agents from workforce projections", () => {
  const agents = buildAgentPayloadsFromGatewayList(
    {
      defaultId: "worker-a",
      agents: [
        {
          id: "system-setup",
          kind: "system",
          name: "System Setup",
          workspace: "/Users/example/.openclaw"
        },
        {
          id: "worker-a",
          kind: "agent",
          createdVia: "operator",
          creatorAgentId: null,
          createdAt: 1_725_000_000_000,
          name: "Worker A",
          workspace: "/Users/example/project"
        }
      ]
    },
    [],
    "/Users/example/.openclaw"
  );

  assert.deepEqual(agents, [{
    id: "worker-a",
    kind: "agent",
    createdVia: "operator",
    creatorAgentId: null,
    createdAt: 1_725_000_000_000,
    name: "Worker A",
    identityName: undefined,
    identityEmoji: undefined,
    identitySource: undefined,
    workspace: "/Users/example/project",
    agentDir: "/Users/example/.openclaw/agents/worker-a/agent",
    model: undefined,
    isDefault: true
  }]);
});

test("agent adapter falls back to identity name when config name is the id", () => {
  const agents = buildAgentPayloadsFromConfig([
    {
      id: "workspace-aslans-chinesse-builder-manyak-musti",
      name: "workspace-aslans-chinesse-builder-manyak-musti",
      workspace: "/Users/example/project",
      agentDir: "/Users/example/project/.openclaw/agents/workspace-aslans-chinesse-builder-manyak-musti/agent",
      identity: {
        name: "Manyak Musti"
      }
    }
  ], "/Users/example/.openclaw");

  assert.equal(agents[0]?.name, "Manyak Musti");
});

test("snapshot adapter prefers manifest display name over scoped id-like names", () => {
  const entry = buildSnapshotAgentEntry({
    rawAgent: {
      id: "tortellini-builder",
      name: "tortellini-builder",
      workspace: "/Users/example/tortellini",
      agentDir: "/Users/example/tortellini/.openclaw/agents/tortellini-builder/agent",
      model: "openai/test"
    },
    configured: {
      id: "tortellini-builder",
      name: "tortellini-builder",
      workspace: "/Users/example/tortellini",
      agentDir: "/Users/example/tortellini/.openclaw/agents/tortellini-builder/agent",
      model: "openai/test",
      identity: {
        name: "tortellini-builder"
      }
    },
    identityOverrides: {
      name: "tortellini-builder"
    },
    workspaceId: "tortellini",
    sessionList: [],
    manifestAgent: {
      id: "tortellini-builder",
      name: "Builder",
      role: "Builder",
      isPrimary: true,
      skillId: "project-builder",
      skillIds: ["project-builder"],
      toolIds: [],
      modelId: "openai/test",
      enabled: true,
      policy: null,
      emoji: null,
      theme: null,
      channelIds: []
    },
    agentRuntimes: [],
    gatewayRpcOk: true,
    heartbeat: null,
    profile: {
      purpose: null,
      operatingInstructions: [],
      responseStyle: [],
      outputPreference: null,
      sourceFiles: []
    }
  });

  assert.equal(entry.agent.name, "Builder");
  assert.equal(entry.agent.identityName, "Builder");
});

test("snapshot adapter derives display name from workspace scoped ids when metadata was pruned", () => {
  const entry = buildSnapshotAgentEntry({
    rawAgent: {
      id: "world-of-builders-hulk-ak",
      name: "world-of-builders-hulk-ak",
      workspace: "/Users/example/world-of-builders",
      agentDir: "/Users/example/world-of-builders/.openclaw/agents/world-of-builders-hulk-ak/agent",
      model: "openai/test"
    },
    configured: {
      id: "world-of-builders-hulk-ak",
      name: "world-of-builders-hulk-ak",
      workspace: "/Users/example/world-of-builders",
      agentDir: "/Users/example/world-of-builders/.openclaw/agents/world-of-builders-hulk-ak/agent",
      model: "openai/test"
    },
    identityOverrides: null,
    workspaceId: "world-of-builders",
    sessionList: [],
    manifestAgent: null,
    agentRuntimes: [],
    gatewayRpcOk: true,
    heartbeat: null,
    profile: {
      purpose: null,
      operatingInstructions: [],
      responseStyle: [],
      outputPreference: null,
      sourceFiles: []
    }
  });

  assert.equal(entry.agent.name, "Hulk AK");
  assert.equal(entry.agent.identityName, "Hulk AK");
});

test("snapshot adapter does not treat stale Gateway events as active agent runtimes", () => {
  const entry = buildSnapshotAgentEntry({
    rawAgent: {
      id: "agent-1",
      name: "agent-1",
      workspace: "/Users/example/project",
      agentDir: "/Users/example/project/.openclaw/agents/agent-1/agent",
      model: "ollama/local"
    },
    configured: {
      id: "agent-1",
      name: "agent-1",
      workspace: "/Users/example/project",
      agentDir: "/Users/example/project/.openclaw/agents/agent-1/agent",
      model: "ollama/local"
    },
    identityOverrides: null,
    workspaceId: "project",
    sessionList: [],
    manifestAgent: null,
    agentRuntimes: [
      {
        id: "stale-chat-event",
        source: "turn",
        key: "chat-1",
        title: "Gateway runtime event",
        subtitle: "chat",
        status: "running",
        updatedAt: Date.now() - 10 * 60 * 1000,
        ageMs: 10 * 60 * 1000,
        agentId: "agent-1",
        metadata: { origin: "openclaw-gateway-event", event: "chat" }
      },
      {
        id: "recent-chat-event",
        source: "turn",
        key: "chat-2",
        title: "Gateway runtime event",
        subtitle: "chat",
        status: "running",
        updatedAt: Date.now() - 5_000,
        ageMs: 5_000,
        agentId: "agent-1",
        metadata: { origin: "openclaw-gateway-event", event: "chat" }
      }
    ],
    gatewayRpcOk: true,
    heartbeat: null,
    profile: {
      purpose: null,
      operatingInstructions: [],
      responseStyle: [],
      outputPreference: null,
      sourceFiles: []
    }
  });

  assert.deepEqual(entry.agent.activeRuntimeIds, ["recent-chat-event"]);
  assert.equal(entry.agent.status, "engaged");
});

test("snapshot adapter leaves an agent ready when only stale Gateway events remain", () => {
  const entry = buildSnapshotAgentEntry({
    rawAgent: {
      id: "agent-1",
      name: "agent-1",
      workspace: "/Users/example/project",
      agentDir: "/Users/example/project/.openclaw/agents/agent-1/agent",
      model: "ollama/local"
    },
    configured: {
      id: "agent-1",
      name: "agent-1",
      workspace: "/Users/example/project",
      agentDir: "/Users/example/project/.openclaw/agents/agent-1/agent",
      model: "ollama/local"
    },
    identityOverrides: null,
    workspaceId: "project",
    sessionList: [],
    manifestAgent: null,
    agentRuntimes: [{
      id: "stale-chat-event",
      source: "turn",
      key: "chat-1",
      title: "Gateway runtime event",
      subtitle: "chat",
      status: "running",
      updatedAt: Date.now() - 10 * 60 * 1000,
      ageMs: 10 * 60 * 1000,
      agentId: "agent-1",
      metadata: { origin: "openclaw-gateway-event", event: "chat" }
    }],
    gatewayRpcOk: true,
    heartbeat: null,
    profile: {
      purpose: null,
      operatingInstructions: [],
      responseStyle: [],
      outputPreference: null,
      sourceFiles: []
    }
  });

  assert.deepEqual(entry.agent.activeRuntimeIds, []);
  assert.equal(entry.agent.status, "standby");
});

test("snapshot adapter ignores completed direct-chat events but keeps an in-flight chat active", () => {
  const sessionId = "chat-session-1";
  const runtime = {
    id: "stale-agent-chat",
    source: "turn" as const,
    key: "chat-1",
    title: "Agent chat session",
    subtitle: "direct chat",
    status: "running" as const,
    updatedAt: Date.now() - 10 * 60 * 1000,
    ageMs: 10 * 60 * 1000,
    agentId: "agent-1",
    sessionId,
    metadata: { origin: "agent-chat", agentChatSessionId: sessionId }
  };
  const input = {
    rawAgent: {
      id: "agent-1",
      name: "agent-1",
      workspace: "/Users/example/project",
      agentDir: "/Users/example/project/.openclaw/agents/agent-1/agent",
      model: "ollama/local"
    },
    configured: {
      id: "agent-1",
      name: "agent-1",
      workspace: "/Users/example/project",
      agentDir: "/Users/example/project/.openclaw/agents/agent-1/agent",
      model: "ollama/local"
    },
    identityOverrides: null,
    workspaceId: "project",
    sessionList: [],
    manifestAgent: null,
    agentRuntimes: [runtime],
    gatewayRpcOk: true,
    heartbeat: null,
    profile: {
      purpose: null,
      operatingInstructions: [],
      responseStyle: [],
      outputPreference: null,
      sourceFiles: []
    }
  };

  assert.deepEqual(buildSnapshotAgentEntry(input).agent.activeRuntimeIds, []);

  markAgentChatSessionActive({ agentId: "agent-1", sessionId });
  try {
    assert.deepEqual(buildSnapshotAgentEntry(input).agent.activeRuntimeIds, ["stale-agent-chat"]);
  } finally {
    markAgentChatSessionInactive({ agentId: "agent-1", sessionId });
  }
});
