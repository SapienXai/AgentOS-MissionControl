"use client";

import {
  ReactFlow,
  type Edge,
  type Node,
  useEdgesState,
  useNodesState
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect } from "react";

import type {
  AgentNodeData,
  RuntimeNodeData,
  WorkspaceNodeData
} from "@/components/mission-control/canvas-types";
import { AgentNode } from "@/components/mission-control/nodes/agent-node";
import { RuntimeNode } from "@/components/mission-control/nodes/runtime-node";
import { WorkspaceNode } from "@/components/mission-control/nodes/workspace-node";
import type { MissionControlSnapshot, RuntimeRecord } from "@/lib/openclaw/types";

type PendingMissionCard = {
  id: string;
  mission: string;
  agentId: string;
  workspaceId: string | null;
  submittedAt: number;
};

type WorkspaceCanvasNode = Node<WorkspaceNodeData, "workspace">;
type AgentCanvasNode = Node<AgentNodeData, "agent">;
type RuntimeCanvasNode = Node<RuntimeNodeData, "runtime">;
type CanvasNode = WorkspaceCanvasNode | AgentCanvasNode | RuntimeCanvasNode;

const nodeTypes = {
  workspace: WorkspaceNode,
  agent: AgentNode,
  runtime: RuntimeNode
};

export function MissionCanvas({
  snapshot,
  activeWorkspaceId,
  selectedNodeId,
  pendingMission,
  hiddenRuntimeIds,
  onReplyRuntime,
  onCopyRuntimePrompt,
  onHideRuntime,
  onSelectNode
}: {
  snapshot: MissionControlSnapshot;
  activeWorkspaceId: string | null;
  selectedNodeId: string | null;
  pendingMission: PendingMissionCard | null;
  hiddenRuntimeIds: string[];
  onReplyRuntime: (runtime: RuntimeRecord) => void;
  onCopyRuntimePrompt: (runtime: RuntimeRecord) => void;
  onHideRuntime: (runtimeId: string) => void;
  onSelectNode: (nodeId: string) => void;
}) {
  const initialGraph = buildCanvasGraph(
    snapshot,
    activeWorkspaceId,
    pendingMission,
    hiddenRuntimeIds,
    onReplyRuntime,
    onCopyRuntimePrompt,
    onHideRuntime
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(initialGraph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialGraph.edges);

  useEffect(() => {
    const nextGraph = buildCanvasGraph(
      snapshot,
      activeWorkspaceId,
      pendingMission,
      hiddenRuntimeIds,
      onReplyRuntime,
      onCopyRuntimePrompt,
      onHideRuntime
    );
    setNodes((previousNodes) => mergeNodePositions(previousNodes, nextGraph.nodes));
    setEdges(nextGraph.edges);
  }, [
    snapshot,
    activeWorkspaceId,
    pendingMission,
    hiddenRuntimeIds,
    onReplyRuntime,
    onCopyRuntimePrompt,
    onHideRuntime,
    setEdges,
    setNodes
  ]);

  useEffect(() => {
    setNodes((previousNodes) =>
      previousNodes.map((node) => ({
        ...node,
        selected: node.id === selectedNodeId
      }))
    );
  }, [selectedNodeId, setNodes]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      elevateNodesOnSelect={false}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={(_, node) => {
        if (node.id.startsWith("pending-runtime:")) {
          return;
        }

        onSelectNode(node.id);
      }}
      fitView
      fitViewOptions={{ padding: 0.14, duration: 700, maxZoom: 0.9 }}
      minZoom={0.42}
      maxZoom={1.2}
      defaultEdgeOptions={{
        type: "simplebezier",
        style: {
          stroke: "rgba(148, 163, 184, 0.34)",
          strokeWidth: 1.15
        }
      }}
      proOptions={{ hideAttribution: true }}
      className="rounded-[30px]"
    />
  );
}

function buildCanvasGraph(
  snapshot: MissionControlSnapshot,
  activeWorkspaceId: string | null,
  pendingMission: PendingMissionCard | null,
  hiddenRuntimeIds: string[],
  onReplyRuntime: (runtime: RuntimeRecord) => void,
  onCopyRuntimePrompt: (runtime: RuntimeRecord) => void,
  onHideRuntime: (runtimeId: string) => void
) {
  const visibleWorkspaces = activeWorkspaceId
    ? snapshot.workspaces.filter((workspace) => workspace.id === activeWorkspaceId)
    : [...snapshot.workspaces].sort(
        (left, right) => right.activeRuntimeIds.length - left.activeRuntimeIds.length
      );

  const workspaceNodes: WorkspaceCanvasNode[] = [];
  const contentNodes: Array<AgentCanvasNode | RuntimeCanvasNode> = [];
  const graphRuntimes: RuntimeRecord[] = snapshot.runtimes.filter(
    (runtime) => !hiddenRuntimeIds.includes(runtime.id)
  );

  visibleWorkspaces.forEach((workspace, workspaceIndex) => {
    const workspaceAgents = snapshot.agents.filter((agent) => agent.workspaceId === workspace.id);
    const workspaceRuntimes = snapshot.runtimes.filter(
      (runtime) => runtime.workspaceId === workspace.id && !hiddenRuntimeIds.includes(runtime.id)
    );

    const groupX = (workspaceIndex % 2) * 1140 + 44;
    const groupY = Math.floor(workspaceIndex / 2) * 760 + 42;
    const agentX = groupX + 52;
    const runtimeX = groupX + 372;
    let laneY = groupY + 118;

    workspaceAgents.forEach((agent, agentIndex) => {
      const agentRuntimes = workspaceRuntimes
        .filter((runtime) => runtime.agentId === agent.id)
        .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
      const pendingRuntime =
        pendingMission &&
        pendingMission.agentId === agent.id &&
        (!pendingMission.workspaceId || pendingMission.workspaceId === workspace.id)
          ? createPendingRuntime(pendingMission, workspace.id, agent.modelId)
          : null;
      const visibleRuntimes = pendingRuntime ? [pendingRuntime, ...agentRuntimes] : agentRuntimes;
      const agentY = laneY + agentIndex * 4;

      contentNodes.push({
        id: agent.id,
        type: "agent",
        draggable: true,
        position: { x: agentX, y: agentY },
        zIndex: 10,
        selected: false,
        data: {
          agent,
          emphasis: !activeWorkspaceId || activeWorkspaceId === workspace.id
        }
      });

      if (pendingRuntime) {
        graphRuntimes.unshift(pendingRuntime);
      }

      visibleRuntimes.forEach((runtime, runtimeIndex) => {
        contentNodes.push({
          id: runtime.id,
          type: "runtime",
          draggable: runtime.id.startsWith("pending-runtime:") ? false : true,
          selectable: !runtime.id.startsWith("pending-runtime:"),
          position: { x: runtimeX, y: agentY + runtimeIndex * 88 + 10 },
          zIndex: 10,
          selected: false,
          data: {
            runtime,
            emphasis: !activeWorkspaceId || activeWorkspaceId === workspace.id,
            pendingCreation: runtime.id.startsWith("pending-runtime:"),
            onReply: onReplyRuntime,
            onCopyPrompt: onCopyRuntimePrompt,
            onHide: onHideRuntime
          }
        });
      });

      laneY += Math.max(138, visibleRuntimes.length * 88 + 36);
    });

    workspaceNodes.push({
      id: workspace.id,
      type: "workspace",
      draggable: false,
      position: { x: groupX, y: groupY },
      zIndex: 0,
      style: {
        width: 1020,
        height: Math.max(laneY - groupY + 104, 640)
      },
      selectable: true,
      selected: false,
      data: {
        workspace,
        emphasis: !activeWorkspaceId || activeWorkspaceId === workspace.id
      }
    });
  });

  const nodes: CanvasNode[] = [...workspaceNodes, ...contentNodes];
  return { nodes, edges: buildEdgesForNodes(graphRuntimes, nodes) };
}

function buildEdgesForNodes(runtimes: RuntimeRecord[], nodes: CanvasNode[]) {
  const edges: Edge[] = [];
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  for (const runtime of runtimes) {
    if (!runtime.agentId) {
      continue;
    }

    const source = nodesById.get(runtime.agentId);
    const target = nodesById.get(runtime.id);

    if (!source || !target) {
      continue;
    }

    edges.push({
      id: `edge:${runtime.agentId}:${runtime.id}`,
      source: runtime.agentId,
      target: runtime.id,
      sourceHandle: "source-right",
      targetHandle: "target-left",
      type: "simplebezier",
      zIndex: 4,
      animated: runtime.status === "active",
      style: {
        stroke: runtime.status === "active" ? "rgba(107, 190, 255, 0.85)" : "rgba(148, 163, 184, 0.28)",
        strokeWidth: runtime.status === "active" ? 1.45 : 1.05
      }
    });
  }

  return edges;
}

function createPendingRuntime(
  pendingMission: PendingMissionCard,
  workspaceId: string,
  modelId: string
): RuntimeRecord {
  return {
    id: `pending-runtime:${pendingMission.id}`,
    source: "turn",
    key: `pending:${pendingMission.id}`,
    title: summarizeMission(pendingMission.mission, 36),
    subtitle: "Materializing on the OpenClaw canvas…",
    status: "queued",
    updatedAt: pendingMission.submittedAt,
    ageMs: 0,
    agentId: pendingMission.agentId,
    workspaceId,
    modelId,
    runId: pendingMission.id,
    metadata: {
      pendingCreation: true
    }
  };
}

function summarizeMission(mission: string, maxLength: number) {
  const normalized = mission.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(maxLength - 1, 1)).trimEnd()}…`;
}

function mergeNodePositions(previousNodes: CanvasNode[], nextNodes: CanvasNode[]) {
  const previousById = new Map(previousNodes.map((node) => [node.id, node]));

  return nextNodes.map((node) => {
    const previous = previousById.get(node.id);

    if (!previous || previous.type !== node.type) {
      return node;
    }

    if (node.type === "workspace") {
      return node;
    }

    return {
      ...node,
      position: previous.position,
      width: previous.width,
      height: previous.height
    };
  });
}
