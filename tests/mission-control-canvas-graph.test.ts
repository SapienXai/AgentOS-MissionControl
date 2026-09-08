import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCanvasGraph,
  filterWorkspaceTasksForCanvas,
  isActiveTaskForCanvas,
  isSystemOwnedMonitorTask
} from "@/components/mission-control/canvas.graph";
import type { MissionControlSnapshot, WorkItemRecord } from "@/lib/agentos/contracts";

test("Active Runs keeps scheduled, running, and review tasks only", () => {
  const tasks = (["queued", "running", "stalled", "completed", "cancelled", "idle"] as const).map(
    (status) => ({ id: status, status }) as WorkItemRecord
  );

  assert.deepEqual(
    filterWorkspaceTasksForCanvas(tasks, "active").map((task) => task.id),
    ["queued", "running", "stalled"]
  );
  assert.equal(tasks.filter(isActiveTaskForCanvas).length, 3);
  assert.equal(filterWorkspaceTasksForCanvas(tasks, "all").length, 6);
  assert.equal(filterWorkspaceTasksForCanvas(tasks, "hidden").length, 0);
});

test("Mission Control keeps native OpenClaw monitors compact and outside normal task filters", () => {
  const monitor = {
    id: "heartbeat-main",
    metadata: { systemOwnedMonitor: "heartbeat" }
  } as unknown as WorkItemRecord;
  const operatorTask = { id: "operator-task", status: "queued", metadata: {} } as unknown as WorkItemRecord;

  assert.equal(isSystemOwnedMonitorTask(monitor), true);
  assert.equal(isSystemOwnedMonitorTask(operatorTask), false);
  assert.deepEqual(filterWorkspaceTasksForCanvas([monitor, operatorTask], "all").map((task) => task.id), ["operator-task", "heartbeat-main"]);
  assert.deepEqual(filterWorkspaceTasksForCanvas([monitor, operatorTask], "active").map((task) => task.id), ["operator-task", "heartbeat-main"]);
  assert.deepEqual(filterWorkspaceTasksForCanvas([monitor, operatorTask], "hidden").map((task) => task.id), ["heartbeat-main"]);
});

test("canvas places agent-owned tasks when task workspace id is missing", () => {
  const snapshot = {
    agents: [
      {
        id: "agent-1",
        name: "Research Lead",
        workspaceId: "workspace-1",
        modelId: "gpt-5.5",
        isDefault: false,
        status: "engaged",
        sessionCount: 1,
        lastActiveAt: null,
        currentAction: "Working",
        activeRuntimeIds: [],
        heartbeat: {
          enabled: false,
          every: null,
          everyMs: null
        },
        identity: {},
        profile: {
          purpose: null,
          operatingInstructions: [],
          responseStyle: [],
          outputPreference: null,
          sourceFiles: []
        },
        skills: [],
        tools: [],
        policy: {
          preset: "worker",
          installScope: "none",
          fileAccess: "workspace",
          network: "enabled",
          missingToolBehavior: "fallback"
        }
      }
    ],
    channelRegistry: {
      channels: [
        {
          id: "telegram-main",
          name: "Telegram Main",
          type: "telegram",
          primaryAgentId: "agent-1",
          workspaces: [
            {
              workspaceId: "workspace-1",
              agentIds: ["agent-1"],
              groupAssignments: []
            }
          ]
        }
      ]
    },
    models: [],
    relationships: [],
    runtimes: [],
    tasks: [
      {
        id: "task-1",
        key: "session:session-1",
        title: "Gateway runtime event",
        mission: "Prepare launch notes",
        subtitle: "agent",
        status: "running",
        updatedAt: 0,
        ageMs: 0,
        primaryAgentId: "agent-1",
        primaryAgentName: "Research Lead",
        runtimeIds: ["runtime-1"],
        agentIds: ["agent-1"],
        sessionIds: ["session-1"],
        runIds: [],
        runtimeCount: 1,
        updateCount: 1,
        liveRunCount: 1,
        artifactCount: 0,
        warningCount: 0,
        metadata: {}
      }
    ],
    workspaces: [
      {
        id: "workspace-1",
        name: "Workspace",
        path: "/tmp/workspace-1",
        description: null,
        agentIds: ["agent-1"],
        runtimeIds: [],
        activeRuntimeIds: [],
        taskIds: ["task-1"],
        status: "engaged",
        metadata: {}
      }
    ]
  } as unknown as MissionControlSnapshot;

  const graph = buildCanvasGraph(
    snapshot,
    [],
    [],
    0,
    null,
    null,
    null,
    null,
    null,
    null,
    false,
    [],
    [],
    [],
    [],
    () => {},
    undefined,
    undefined,
    () => {},
    () => {},
    () => {},
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    () => {},
    () => {},
    () => {},
    () => {},
    () => {},
    () => {},
    () => {},
    () => {},
    [],
    {},
    {}
  );

  assert.ok(graph.nodes.some((node) => node.id === "task-1" && node.type === "task"));
  const agentNode = graph.nodes.find((node) => node.id === "agent-1");
  const taskNode = graph.nodes.find((node) => node.id === "task-1" && node.type === "task");
  const taskEdge = graph.edges.find((edge) => edge.id === "edge:agent-1:task-1");
  const surfaceTetherEdge = graph.edges.find((edge) => edge.id.startsWith("edge:agent-1:surface-module-v1:"));

  assert.ok(agentNode);
  assert.ok(taskNode);
  assert.ok(taskEdge);
  assert.equal(taskNode.data.agentThemeRgb, taskEdge.data?.agentThemeRgb);
  assert.match(taskNode.data.agentThemeRgb ?? "", /^\d{1,3},\s*\d{1,3},\s*\d{1,3}$/);
  assert.ok(surfaceTetherEdge);
  assert.equal(surfaceTetherEdge.zIndex, 8);
  assert.ok((surfaceTetherEdge.zIndex ?? 0) < (agentNode.zIndex ?? 0));
});

test("buildCanvasGraph renders a pending agent birth node until the live snapshot catches up", () => {
  const snapshot = {
    generatedAt: new Date().toISOString(),
    agents: [],
    tasks: [],
    channelRegistry: {
      channels: []
    },
    models: [{ id: "openai/gpt-4.1", name: "GPT-4.1", provider: "OpenAI" }],
    workspaces: [
      {
        id: "workspace-1",
        name: "Workspace",
        path: "/tmp/workspace-1",
        description: null,
        agentIds: [],
        runtimeIds: [],
        activeRuntimeIds: [],
        taskIds: [],
        status: "idle",
        metadata: {}
      }
    ]
  } as unknown as MissionControlSnapshot;

  const graph = buildCanvasGraph(
    snapshot,
    [],
    [],
    0,
    "workspace-1",
    null,
    null,
    "workspace-1-worker",
    null,
    null,
    false,
    [],
    [],
    [],
    [],
    () => {},
    undefined,
    undefined,
    () => {},
    () => {},
    () => {},
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    () => {},
    () => {},
    () => {},
    () => {},
    () => {},
    () => {},
    () => {},
    () => {},
    [
      {
        id: "workspace-1-worker",
        workspaceId: "workspace-1",
        workspacePath: "/tmp/workspace-1",
        name: "Worker",
        modelId: "openai/gpt-4.1",
        emoji: "*",
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
        createdAt: 1
      }
    ],
    {},
    {}
  );

  const agentNode = graph.nodes.find((node) => node.id === "workspace-1-worker");

  assert.equal(agentNode?.type, "agent");
  assert.equal(agentNode?.data.pendingCreation, true);
  assert.equal(agentNode?.data.agent.currentAction, "Provisioning in OpenClaw");
});

test("buildCanvasGraph renders pending workspace agents before the workspace snapshot catches up", () => {
  const snapshot = {
    generatedAt: new Date().toISOString(),
    agents: [],
    tasks: [],
    channelRegistry: {
      channels: []
    },
    models: [{ id: "openai/gpt-4.1", name: "GPT-4.1", provider: "OpenAI" }],
    workspaces: []
  } as unknown as MissionControlSnapshot;

  const graph = buildCanvasGraph(
    snapshot,
    [],
    [],
    0,
    "tortellini",
    null,
    null,
    "tortellini-builder",
    null,
    null,
    false,
    [],
    [],
    [],
    [],
    () => {},
    undefined,
    undefined,
    () => {},
    () => {},
    () => {},
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    () => {},
    () => {},
    () => {},
    () => {},
    () => {},
    () => {},
    () => {},
    () => {},
    [
      {
        id: "tortellini-builder",
        workspaceId: "tortellini",
        workspacePath: "/tmp/tortellini",
        workspaceName: "Tortellini",
        name: "Builder",
        modelId: "openai/gpt-4.1",
        emoji: "*",
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
        createdAt: 1
      }
    ],
    {},
    {}
  );

  const workspaceNode = graph.nodes.find((node) => node.id === "tortellini");
  const agentNode = graph.nodes.find((node) => node.id === "tortellini-builder");

  assert.equal(workspaceNode?.type, "workspace");
  assert.equal(agentNode?.type, "agent");
  assert.equal(agentNode?.data.agent.name, "Builder");
  assert.equal(agentNode?.data.pendingCreation, true);
});

test("buildCanvasGraph keeps a fixed workspace and stacks idle agents with visible banner offsets", () => {
  const buildGraphForAgentCount = (agentCount: number) => {
    const agents = Array.from({ length: agentCount }, (_, index) => ({
      id: `agent-${index + 1}`,
      name: `Agent ${index + 1}`,
      workspaceId: "workspace-1",
      modelId: "gpt-5.5",
      isDefault: index === 0,
      status: "ready",
      sessionCount: 0,
      lastActiveAt: null,
      currentAction: null,
      activeRuntimeIds: [],
      heartbeat: {
        enabled: false,
        every: null,
        everyMs: null
      },
      identity: {},
      profile: {
        purpose: null,
        operatingInstructions: [],
        responseStyle: [],
        outputPreference: null,
        sourceFiles: []
      },
      skills: [],
      tools: [],
      observedTools: [],
      policy: {
        preset: "worker",
        installScope: "none",
        fileAccess: "workspace",
        network: "enabled",
        missingToolBehavior: "fallback"
      }
    }));
    const snapshot = {
      generatedAt: new Date().toISOString(),
      agents,
      tasks: [],
      channelRegistry: {
        channels: []
      },
      models: [],
      workspaces: [
        {
          id: "workspace-1",
          name: "Workspace",
          path: "/tmp/workspace-1",
          description: null,
          agentIds: agents.map((agent) => agent.id),
          runtimeIds: [],
          activeRuntimeIds: [],
          taskIds: [],
          status: "ready",
          metadata: {}
        }
      ]
    } as unknown as MissionControlSnapshot;

    return buildCanvasGraph(
      snapshot,
      [],
      [],
      0,
      "workspace-1",
      null,
      null,
      null,
      null,
      null,
      false,
      [],
      [],
      [],
      [],
      () => {},
      undefined,
      undefined,
      () => {},
      () => {},
      () => {},
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => {},
      () => {},
      () => {},
      () => {},
      () => {},
      () => {},
      () => {},
      () => {},
      [],
      {},
      {}
    );
  };

  const oneAgentGraph = buildGraphForAgentCount(1);
  const threeAgentGraph = buildGraphForAgentCount(3);
  const tenAgentGraph = buildGraphForAgentCount(10);
  const workspaceWithOneAgent = oneAgentGraph.nodes.find((node) => node.id === "workspace-1");
  const workspaceWithThreeAgents = threeAgentGraph.nodes.find((node) => node.id === "workspace-1");
  const workspaceWithTenAgents = tenAgentGraph.nodes.find((node) => node.id === "workspace-1");
  const firstAgentNode = threeAgentGraph.nodes.find((node) => node.id === "agent-1");
  const secondAgentNode = threeAgentGraph.nodes.find((node) => node.id === "agent-2");
  const thirdAgentNode = threeAgentGraph.nodes.find((node) => node.id === "agent-3");

  assert.equal(workspaceWithOneAgent?.style?.width, 1200);
  assert.equal(workspaceWithOneAgent?.style?.height, 900);
  assert.equal(workspaceWithOneAgent?.style?.cursor, "default");
  assert.equal(workspaceWithThreeAgents?.style?.width, 1200);
  assert.equal(workspaceWithThreeAgents?.style?.height, 900);
  assert.equal(workspaceWithTenAgents?.style?.width, 1200);
  assert.equal(workspaceWithTenAgents?.style?.height, 900);
  assert.ok((secondAgentNode?.position.y ?? 0) > (firstAgentNode?.position.y ?? 0));
  assert.ok((thirdAgentNode?.position.y ?? 0) > (secondAgentNode?.position.y ?? 0));
  assert.equal((secondAgentNode?.position.y ?? 0) - (firstAgentNode?.position.y ?? 0), 124);
  assert.ok((secondAgentNode?.position.x ?? 0) > (firstAgentNode?.position.x ?? 0));
  assert.ok((thirdAgentNode?.position.x ?? 0) > (secondAgentNode?.position.x ?? 0));
});
