"use client";

import {
  ReactFlow,
  type Edge,
  type Node,
  type ReactFlowInstance,
  useEdgesState,
  useNodesState
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction
} from "react";

import type {
  AgentNodeData,
  TaskNodeData,
  WorkspaceNodeData
} from "@/components/mission-control/canvas-types";
import { AgentNode } from "@/components/mission-control/nodes/agent-node";
import { TaskNode } from "@/components/mission-control/nodes/task-node";
import { WorkspaceNode } from "@/components/mission-control/nodes/workspace-node";
import type { MissionControlSnapshot, TaskRecord } from "@/lib/openclaw/types";
import { cn } from "@/lib/utils";

type WorkspaceCanvasNode = Node<WorkspaceNodeData, "workspace">;
type AgentCanvasNode = Node<AgentNodeData, "agent">;
type TaskCanvasNode = Node<TaskNodeData, "task">;
type CanvasNode = WorkspaceCanvasNode | AgentCanvasNode | TaskCanvasNode;

const nodeTypes = {
  workspace: WorkspaceNode,
  agent: AgentNode,
  task: TaskNode
};
const justCreatedTaskDurationMs = 12000;

export function MissionCanvas({
  snapshot,
  activeWorkspaceId,
  selectedNodeId,
  recentDispatchId,
  hiddenRuntimeIds,
  onEditAgent,
  onDeleteAgent,
  onReplyTask,
  onCopyTaskPrompt,
  onHideTask,
  onSelectNode,
  className
}: {
  snapshot: MissionControlSnapshot;
  activeWorkspaceId: string | null;
  selectedNodeId: string | null;
  recentDispatchId: string | null;
  hiddenRuntimeIds: string[];
  onEditAgent: (agentId: string) => void;
  onDeleteAgent: (agentId: string) => void;
  onReplyTask: (task: TaskRecord) => void;
  onCopyTaskPrompt: (task: TaskRecord) => void;
  onHideTask: (task: TaskRecord) => void;
  onSelectNode: (nodeId: string) => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const reactFlowRef = useRef<ReactFlowInstance<CanvasNode, Edge> | null>(null);
  const handledDispatchIdsRef = useRef<Set<string>>(new Set());
  const creationTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [justCreatedTaskIds, setJustCreatedTaskIds] = useState<string[]>([]);
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);
  const initialGraph = buildCanvasGraph(
    snapshot,
    activeWorkspaceId,
    justCreatedTaskIds,
    hiddenRuntimeIds,
    onEditAgent,
    onDeleteAgent,
    onReplyTask,
    onCopyTaskPrompt,
    onHideTask
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(initialGraph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialGraph.edges);

  useEffect(() => {
    const nextGraph = buildCanvasGraph(
      snapshot,
      activeWorkspaceId,
      justCreatedTaskIds,
      hiddenRuntimeIds,
      onEditAgent,
      onDeleteAgent,
      onReplyTask,
      onCopyTaskPrompt,
      onHideTask
    );
    setNodes((previousNodes) => mergeNodePositions(previousNodes, nextGraph.nodes));
    setEdges(nextGraph.edges);
  }, [
    snapshot,
    activeWorkspaceId,
    justCreatedTaskIds,
    hiddenRuntimeIds,
    onEditAgent,
    onDeleteAgent,
    onReplyTask,
    onCopyTaskPrompt,
    onHideTask,
    setEdges,
    setNodes
  ]);

  useEffect(() => {
    setNodes((previousNodes) =>
      previousNodes.map((node) => ({
        ...node,
        selected: node.id === selectedNodeId,
        zIndex: resolveNodeZIndex(node, selectedNodeId)
      }))
    );
  }, [selectedNodeId, setNodes]);

  useEffect(() => {
    if (!recentDispatchId || handledDispatchIdsRef.current.has(recentDispatchId)) {
      return;
    }

    const resolvedTask = snapshot.tasks
      .filter(
        (task) =>
          !isTaskHidden(task, hiddenRuntimeIds) &&
          task.dispatchId === recentDispatchId &&
          task.metadata.optimistic !== true
      )
      .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))[0];

    if (!resolvedTask) {
      return;
    }

    handledDispatchIdsRef.current.add(recentDispatchId);
    markTaskAsJustCreated(
      resolvedTask.id,
      setJustCreatedTaskIds,
      creationTimeoutsRef,
      setFocusTaskId
    );
    onSelectNode(resolvedTask.id);
  }, [snapshot.tasks, recentDispatchId, hiddenRuntimeIds, onSelectNode]);

  useEffect(() => {
    const creationTimeouts = creationTimeoutsRef.current;

    return () => {
      creationTimeouts.forEach((timeoutId) => {
        clearTimeout(timeoutId);
      });
      creationTimeouts.clear();
    };
  }, []);

  useEffect(() => {
    if (!focusTaskId || !reactFlowRef.current) {
      return;
    }

    const targetNode = nodes.find((node) => node.id === focusTaskId);

    if (!targetNode) {
      return;
    }

    reactFlowRef.current.setCenter(
      targetNode.position.x + (targetNode.width ?? 272) / 2,
      targetNode.position.y + (targetNode.height ?? 204) / 2,
      {
        zoom: Math.max(reactFlowRef.current.getZoom(), 0.88),
        duration: 650
      }
    );

    const timeoutId = setTimeout(() => {
      setFocusTaskId((current) => (current === focusTaskId ? null : current));
    }, 900);

    return () => clearTimeout(timeoutId);
  }, [focusTaskId, nodes]);

  useEffect(() => {
    const container = containerRef.current;

    if (!container || typeof ResizeObserver === "undefined") {
      return;
    }

    let fitTimeoutId: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver(() => {
      if (!reactFlowRef.current || nodes.length === 0) {
        return;
      }

      if (fitTimeoutId) {
        clearTimeout(fitTimeoutId);
      }

      fitTimeoutId = setTimeout(() => {
        reactFlowRef.current?.fitView({ padding: 0.14, duration: 260, maxZoom: 0.9 });
      }, 90);
    });

    observer.observe(container);

    return () => {
      observer.disconnect();

      if (fitTimeoutId) {
        clearTimeout(fitTimeoutId);
      }
    };
  }, [nodes.length]);

  return (
    <div ref={containerRef} className={cn("h-full w-full", className)}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onInit={(instance) => {
          reactFlowRef.current = instance;
        }}
        elevateNodesOnSelect={false}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => onSelectNode(node.id)}
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
        className="h-full w-full rounded-[inherit]"
      />
    </div>
  );
}

function buildCanvasGraph(
  snapshot: MissionControlSnapshot,
  activeWorkspaceId: string | null,
  justCreatedTaskIds: string[],
  hiddenRuntimeIds: string[],
  onEditAgent: (agentId: string) => void,
  onDeleteAgent: (agentId: string) => void,
  onReplyTask: (task: TaskRecord) => void,
  onCopyTaskPrompt: (task: TaskRecord) => void,
  onHideTask: (task: TaskRecord) => void
) {
  const visibleWorkspaces = activeWorkspaceId
    ? snapshot.workspaces.filter((workspace) => workspace.id === activeWorkspaceId)
    : [...snapshot.workspaces].sort(
        (left, right) => right.activeRuntimeIds.length - left.activeRuntimeIds.length
      );

  const workspaceNodes: WorkspaceCanvasNode[] = [];
  const contentNodes: Array<AgentCanvasNode | TaskCanvasNode> = [];
  const graphTasks: TaskRecord[] = [];

  visibleWorkspaces.forEach((workspace, workspaceIndex) => {
    const workspaceAgents = snapshot.agents.filter((agent) => agent.workspaceId === workspace.id);
    const workspaceTasks = snapshot.tasks.filter(
      (task) => task.workspaceId === workspace.id && !isTaskHidden(task, hiddenRuntimeIds)
    );
    const groupX = (workspaceIndex % 2) * 1160 + 44;
    const groupY = Math.floor(workspaceIndex / 2) * 920 + 42;
    const agentX = groupX + 52;
    const taskX = groupX + 390;
    let laneY = groupY + 118;

    workspaceAgents.forEach((agent, agentIndex) => {
      const agentTasks = workspaceTasks
        .filter((task) => resolveTaskOwnerId(task) === agent.id)
        .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
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
          emphasis: !activeWorkspaceId || activeWorkspaceId === workspace.id,
          onEdit: onEditAgent,
          onDelete: onDeleteAgent
        }
      });

      graphTasks.push(...agentTasks);

      agentTasks.forEach((task, taskIndex) => {
        const isBootstrapTask = typeof task.metadata.bootstrapStage === "string";
        const isJustCreatedTask = justCreatedTaskIds.includes(task.id);

        contentNodes.push({
          id: task.id,
          type: "task",
          draggable: true,
          selectable: true,
          position: { x: taskX, y: agentY + taskIndex * 152 + 10 },
          zIndex: isBootstrapTask ? 40 : isJustCreatedTask ? 28 : 10,
          selected: false,
          data: {
            task,
            emphasis: !activeWorkspaceId || activeWorkspaceId === workspace.id,
            pendingCreation: isBootstrapTask,
            justCreated: isJustCreatedTask,
            onReply: onReplyTask,
            onCopyPrompt: onCopyTaskPrompt,
            onHide: onHideTask
          }
        });
      });

      laneY += Math.max(152, agentTasks.length * 152 + 44);
    });

    workspaceNodes.push({
      id: workspace.id,
      type: "workspace",
      draggable: false,
      position: { x: groupX, y: groupY },
      zIndex: 0,
      style: {
        width: 1060,
        height: Math.max(laneY - groupY + 112, 700)
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
  return { nodes, edges: buildEdgesForNodes(graphTasks, nodes) };
}

function buildEdgesForNodes(tasks: TaskRecord[], nodes: CanvasNode[]) {
  const edges: Edge[] = [];
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  for (const task of tasks) {
    if (!task.primaryAgentId) {
      continue;
    }

    const source = nodesById.get(task.primaryAgentId);
    const target = nodesById.get(task.id);

    if (!source || !target) {
      continue;
    }

    edges.push({
      id: `edge:${task.primaryAgentId}:${task.id}`,
      source: task.primaryAgentId,
      target: task.id,
      sourceHandle: "source-right",
      targetHandle: "target-left",
      type: "simplebezier",
      zIndex: 4,
      animated: task.status === "running",
      style: {
        stroke: task.status === "running" ? "rgba(107, 190, 255, 0.85)" : "rgba(148, 163, 184, 0.28)",
        strokeWidth: task.status === "running" ? 1.45 : 1.05
      }
    });
  }

  return edges;
}

function isTaskHidden(task: TaskRecord, hiddenRuntimeIds: string[]) {
  if (task.runtimeIds.length === 0) {
    return false;
  }

  return task.runtimeIds.every((runtimeId) => hiddenRuntimeIds.includes(runtimeId));
}

function resolveTaskOwnerId(task: TaskRecord) {
  return task.primaryAgentId || task.agentIds[0] || null;
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

function resolveNodeZIndex(node: CanvasNode, selectedNodeId: string | null) {
  if (node.type === "workspace") {
    return 0;
  }

  if (node.type === "agent") {
    return 10;
  }

  if (node.id === selectedNodeId) {
    return 60;
  }

  if (node.data.pendingCreation) {
    return 40;
  }

  if (node.data.justCreated) {
    return 28;
  }

  return 10;
}

function markTaskAsJustCreated(
  taskId: string,
  setJustCreatedTaskIds: Dispatch<SetStateAction<string[]>>,
  creationTimeoutsRef: MutableRefObject<Map<string, ReturnType<typeof setTimeout>>>,
  setFocusTaskId: Dispatch<SetStateAction<string | null>>
) {
  setJustCreatedTaskIds((current) => (current.includes(taskId) ? current : [...current, taskId]));
  setFocusTaskId(taskId);

  const existingTimeout = creationTimeoutsRef.current.get(taskId);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
  }

  const timeoutId = setTimeout(() => {
    setJustCreatedTaskIds((current) => current.filter((id) => id !== taskId));
    creationTimeoutsRef.current.delete(taskId);
  }, justCreatedTaskDurationMs);

  creationTimeoutsRef.current.set(taskId, timeoutId);
}
