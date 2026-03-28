"use client";

import {
  ReactFlow,
  type Edge,
  type Node,
  type ReactFlowInstance,
  MarkerType,
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
  MissionEdgeData,
  TaskNodeData,
  TelegramTetherNodeData,
  WorkspaceNodeData
} from "@/components/mission-control/canvas-types";
import { AgentNode } from "@/components/mission-control/nodes/agent-node";
import { MissionConnectionEdge } from "@/components/mission-control/edges/mission-connection-edge";
import { TaskNode } from "@/components/mission-control/nodes/task-node";
import { TelegramTetherNode } from "@/components/mission-control/nodes/telegram-tether-node";
import { WorkspaceNode } from "@/components/mission-control/nodes/workspace-node";
import { resolveRelativeTimeReferenceMs } from "@/lib/openclaw/presenters";
import type { MissionControlSnapshot, OpenClawAgent, TaskRecord } from "@/lib/openclaw/types";
import { cn } from "@/lib/utils";

type WorkspaceCanvasNode = Node<WorkspaceNodeData, "workspace">;
type AgentCanvasNode = Node<AgentNodeData, "agent">;
type TaskCanvasNode = Node<TaskNodeData, "task">;
type TelegramModuleCanvasNode = Node<TelegramTetherNodeData, "telegram-module">;
type CanvasEdge = Edge<MissionEdgeData, "simplebezier">;
type CanvasNode = WorkspaceCanvasNode | AgentCanvasNode | TaskCanvasNode | TelegramModuleCanvasNode;
type PersistedNodePosition = {
  x: number;
  y: number;
};
type PersistedNodePositionMap = Record<string, PersistedNodePosition>;
type TelegramTetherSummary = {
  channelCount: number;
  channelNames: string[];
  roleLines: string[];
  roleTone: "primary" | "owner" | "delegate" | "mixed";
};
const emptyPersistedNodePositions: PersistedNodePositionMap = {};

const nodeTypes = {
  workspace: WorkspaceNode,
  agent: AgentNode,
  task: TaskNode,
  "telegram-module": TelegramTetherNode
};
const edgeTypes = {
  simplebezier: MissionConnectionEdge
};
const justCreatedTaskDurationMs = 12000;
const nodePositionsStorageKey = "mission-control-node-positions";

export function MissionCanvas({
  snapshot,
  activeWorkspaceId,
  selectedNodeId,
  focusedAgentId,
  composerTargetAgentId,
  isComposerActive,
  recentDispatchId,
  hiddenRuntimeIds,
  hiddenTaskKeys,
  lockedTaskKeys,
  onToggleWorkspaceTaskCards,
  onEditAgent,
  onDeleteAgent,
  onFocusAgent,
  onReplyTask,
  onCopyTaskPrompt,
  onHideTask,
  onToggleTaskLock,
  onAbortTask,
  onInspectTask,
  onSelectNode,
  className
}: {
  snapshot: MissionControlSnapshot;
  activeWorkspaceId: string | null;
  selectedNodeId: string | null;
  focusedAgentId: string | null;
  composerTargetAgentId: string | null;
  isComposerActive: boolean;
  recentDispatchId: string | null;
  hiddenRuntimeIds: string[];
  hiddenTaskKeys: string[];
  lockedTaskKeys: string[];
  onToggleWorkspaceTaskCards: (workspaceId: string) => void;
  onEditAgent: (agentId: string) => void;
  onDeleteAgent: (agentId: string) => void;
  onFocusAgent: (agentId: string) => void;
  onReplyTask: (task: TaskRecord) => void;
  onCopyTaskPrompt: (task: TaskRecord) => void;
  onHideTask: (task: TaskRecord) => void;
  onToggleTaskLock: (task: TaskRecord) => void;
  onAbortTask: (task: TaskRecord) => void;
  onInspectTask: (task: TaskRecord, target: "overview" | "output" | "files") => void;
  onSelectNode: (nodeId: string) => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const reactFlowRef = useRef<ReactFlowInstance<CanvasNode, CanvasEdge> | null>(null);
  const handledDispatchIdsRef = useRef<Set<string>>(new Set());
  const creationTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const persistedNodePositionsRef = useRef<PersistedNodePositionMap>({});
  const hasHydratedPersistedNodePositionsRef = useRef(false);
  const skipNextPersistRef = useRef(false);
  const shouldMergePositionsRef = useRef(false);
  const relativeTimeReferenceMs = resolveRelativeTimeReferenceMs(snapshot.generatedAt);
  const [justCreatedTaskIds, setJustCreatedTaskIds] = useState<string[]>([]);
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);
  const initialGraph = buildCanvasGraph(
    snapshot,
    relativeTimeReferenceMs,
    activeWorkspaceId,
    focusedAgentId,
    composerTargetAgentId,
    isComposerActive,
    justCreatedTaskIds,
    hiddenRuntimeIds,
    hiddenTaskKeys,
    lockedTaskKeys,
    onToggleWorkspaceTaskCards,
    onEditAgent,
    onDeleteAgent,
    onFocusAgent,
    onReplyTask,
    onCopyTaskPrompt,
    onHideTask,
    onToggleTaskLock,
    onAbortTask,
    onInspectTask,
    emptyPersistedNodePositions
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(initialGraph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<CanvasEdge>(initialGraph.edges);

  useEffect(() => {
    const persistedPositions = readPersistedNodePositions();
    persistedNodePositionsRef.current = persistedPositions;
    hasHydratedPersistedNodePositionsRef.current = true;
    skipNextPersistRef.current = true;

    if (Object.keys(persistedPositions).length === 0) {
      return;
    }

    setNodes((previousNodes) =>
      previousNodes.map((node) => {
        if (node.type === "workspace") {
          return node;
        }

        const persistedKey =
          node.type === "agent"
            ? toPersistedAgentPositionKey(node.data.agent)
            : node.type === "telegram-module"
              ? toPersistedTelegramModulePositionKey(node.data.agent)
              : toPersistedTaskPositionKey(node.data.task);
        const legacyPersistedKey =
          node.type === "agent"
            ? toLegacyPersistedAgentPositionKey(node.data.agent.id)
            : node.type === "telegram-module"
              ? undefined
              : toLegacyPersistedTaskPositionKey(node.data.task.id);
        const savedPosition =
          persistedPositions[persistedKey] ||
          (legacyPersistedKey ? persistedPositions[legacyPersistedKey] : undefined);
        if (!savedPosition) {
          return node;
        }

        if (node.position.x === savedPosition.x && node.position.y === savedPosition.y) {
          return node;
        }

        return {
          ...node,
          position: {
            x: savedPosition.x,
            y: savedPosition.y
          }
        };
      })
    );
  }, [setNodes]);

  useEffect(() => {
    const nextGraph = buildCanvasGraph(
      snapshot,
      relativeTimeReferenceMs,
      activeWorkspaceId,
      focusedAgentId,
      composerTargetAgentId,
      isComposerActive,
      justCreatedTaskIds,
      hiddenRuntimeIds,
      hiddenTaskKeys,
      lockedTaskKeys,
      onToggleWorkspaceTaskCards,
      onEditAgent,
      onDeleteAgent,
      onFocusAgent,
      onReplyTask,
      onCopyTaskPrompt,
      onHideTask,
      onToggleTaskLock,
      onAbortTask,
      onInspectTask,
      persistedNodePositionsRef.current
    );
    setNodes((previousNodes) => {
      if (!shouldMergePositionsRef.current && hasHydratedPersistedNodePositionsRef.current) {
        shouldMergePositionsRef.current = true;
        return nextGraph.nodes;
      }

      return mergeNodePositions(previousNodes, nextGraph.nodes);
    });
    setEdges(nextGraph.edges);
  }, [
    snapshot,
    activeWorkspaceId,
    focusedAgentId,
    composerTargetAgentId,
    isComposerActive,
    justCreatedTaskIds,
    hiddenRuntimeIds,
    hiddenTaskKeys,
    lockedTaskKeys,
    onToggleWorkspaceTaskCards,
    onEditAgent,
    onDeleteAgent,
    onFocusAgent,
    onReplyTask,
    onCopyTaskPrompt,
    onHideTask,
    onToggleTaskLock,
    onAbortTask,
    onInspectTask,
    relativeTimeReferenceMs,
    setEdges,
    setNodes
  ]);

  useEffect(() => {
    setNodes((previousNodes) =>
      previousNodes.map((node) => {
        const nextSelected = node.id === selectedNodeId;
        const nextZIndex = resolveNodeZIndex(
          node,
          selectedNodeId,
          composerTargetAgentId,
          isComposerActive
        );

        if (Boolean(node.selected) === nextSelected && node.zIndex === nextZIndex) {
          return node;
        }

        return {
          ...node,
          selected: nextSelected,
          zIndex: nextZIndex
        };
      })
    );
  }, [selectedNodeId, composerTargetAgentId, isComposerActive, setNodes]);

  useEffect(() => {
    if (!reactFlowRef.current) {
      return;
    }

    const timeoutId = setTimeout(() => {
      const reactFlow = reactFlowRef.current;

      if (isComposerActive && composerTargetAgentId && reactFlow) {
        const targetNode = reactFlow.getNode(composerTargetAgentId);

        if (targetNode) {
          const viewportHeight = containerRef.current?.clientHeight ?? 0;
          const composerVerticalBiasPx = Math.min(
            180,
            Math.max(104, Math.round(viewportHeight * 0.13))
          );
          const currentZoom = Math.max(reactFlow.getZoom(), 0.94);

          reactFlow.setCenter(
            targetNode.position.x + (targetNode.width ?? 212) / 2,
            targetNode.position.y + (targetNode.height ?? 220) / 2 + composerVerticalBiasPx / currentZoom,
            {
              zoom: currentZoom,
              duration: 500
            }
          );
          return;
        }
      }

      reactFlow?.fitView({
        padding: focusedAgentId ? 0.2 : 0.14,
        duration: 500,
        maxZoom: focusedAgentId ? 1.05 : 0.9
      });
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [focusedAgentId, composerTargetAgentId, isComposerActive]);

  useEffect(() => {
    if (!recentDispatchId || handledDispatchIdsRef.current.has(recentDispatchId)) {
      return;
    }

    const resolvedTask = snapshot.tasks
      .filter(
        (task) =>
          !isTaskHidden(task, hiddenRuntimeIds, hiddenTaskKeys, lockedTaskKeys) &&
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
  }, [snapshot.tasks, recentDispatchId, hiddenRuntimeIds, hiddenTaskKeys, lockedTaskKeys, onSelectNode]);

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

  useEffect(() => {
    if (!hasHydratedPersistedNodePositionsRef.current) {
      return;
    }

    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }

    const nextPositions = extractPersistedNodePositions(nodes);
    const mergedPositions = { ...persistedNodePositionsRef.current, ...nextPositions };

    if (arePersistedNodePositionsEqual(persistedNodePositionsRef.current, mergedPositions)) {
      return;
    }

    persistedNodePositionsRef.current = mergedPositions;
    writeToLocalStorage(nodePositionsStorageKey, JSON.stringify(mergedPositions));
  }, [nodes]);

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
        autoPanOnNodeDrag={false}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => {
          if (node.type === "telegram-module") {
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
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 16,
            height: 16,
            color: "var(--mission-edge-arrow)"
          },
          style: {
            strokeWidth: 2.25
          }
        }}
        edgeTypes={edgeTypes}
        defaultMarkerColor="var(--mission-edge-arrow)"
        proOptions={{ hideAttribution: true }}
        className="h-full w-full rounded-[inherit]"
      />
    </div>
  );
}

function buildCanvasGraph(
  snapshot: MissionControlSnapshot,
  relativeTimeReferenceMs: number,
  activeWorkspaceId: string | null,
  focusedAgentId: string | null,
  composerTargetAgentId: string | null,
  isComposerActive: boolean,
  justCreatedTaskIds: string[],
  hiddenRuntimeIds: string[],
  hiddenTaskKeys: string[],
  lockedTaskKeys: string[],
  onToggleWorkspaceTaskCards: (workspaceId: string) => void,
  onEditAgent: (agentId: string) => void,
  onDeleteAgent: (agentId: string) => void,
  onFocusAgent: (agentId: string) => void,
  onReplyTask: (task: TaskRecord) => void,
  onCopyTaskPrompt: (task: TaskRecord) => void,
  onHideTask: (task: TaskRecord) => void,
  onToggleTaskLock: (task: TaskRecord) => void,
  onAbortTask: (task: TaskRecord) => void,
  onInspectTask: (task: TaskRecord, target: "overview" | "output" | "files") => void,
  persistedNodePositions: PersistedNodePositionMap
) {
  const safeHiddenRuntimeIds = Array.isArray(hiddenRuntimeIds) ? hiddenRuntimeIds : [];
  const safeHiddenTaskKeys = Array.isArray(hiddenTaskKeys) ? hiddenTaskKeys : [];
  const safeLockedTaskKeys = Array.isArray(lockedTaskKeys) ? lockedTaskKeys : [];
  const focusedAgent = focusedAgentId
    ? snapshot.agents.find((agent) => agent.id === focusedAgentId)
    : null;
  const isFocusMode = focusedAgent !== null && !isComposerActive;
  const focusWorkspaceId = focusedAgent?.workspaceId ?? null;
  const visibleWorkspaces = isFocusMode
    ? snapshot.workspaces.filter((workspace) => workspace.id === focusWorkspaceId)
    : activeWorkspaceId
      ? snapshot.workspaces.filter((workspace) => workspace.id === activeWorkspaceId)
      : [...snapshot.workspaces].sort(
          (left, right) => right.activeRuntimeIds.length - left.activeRuntimeIds.length
        );

  const workspaceNodes: WorkspaceCanvasNode[] = [];
  const contentNodes: Array<AgentCanvasNode | TaskCanvasNode> = [];
  const telegramModuleNodes: TelegramModuleCanvasNode[] = [];
  const graphTasks: TaskRecord[] = [];

  visibleWorkspaces.forEach((workspace, workspaceIndex) => {
    const workspaceAgents = isFocusMode
      ? snapshot.agents.filter(
          (agent) => agent.workspaceId === workspace.id && agent.id === focusedAgentId
        )
      : snapshot.agents.filter((agent) => agent.workspaceId === workspace.id);
    const workspaceTaskRecords = isFocusMode
      ? snapshot.tasks.filter(
          (task) => task.workspaceId === workspace.id && task.primaryAgentId === focusedAgentId
        )
      : snapshot.tasks.filter((task) => task.workspaceId === workspace.id);
    const workspaceToggleTasks = isFocusMode
      ? []
      : workspaceTaskRecords.filter((task) => !safeLockedTaskKeys.includes(task.key));
    const workspaceTasks = isFocusMode
      ? workspaceTaskRecords
      : workspaceTaskRecords.filter(
          (task) => !isTaskHidden(task, safeHiddenRuntimeIds, safeHiddenTaskKeys, safeLockedTaskKeys)
        );
    const workspaceTaskCardsHidden =
      !isFocusMode &&
      workspaceToggleTasks.length > 0 &&
      workspaceToggleTasks.every((task) =>
        isTaskHidden(task, safeHiddenRuntimeIds, safeHiddenTaskKeys, safeLockedTaskKeys)
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
      const isComposerHighlightedAgent = isComposerActive && composerTargetAgentId === agent.id;
      const agentPosition = resolvePersistedPosition(
        toPersistedAgentPositionKey(agent),
        { x: agentX, y: agentY },
        persistedNodePositions,
        toLegacyPersistedAgentPositionKey(agent.id)
      );
      const telegramTether = buildTelegramTetherSummary(snapshot, workspace, agent);
      const showTelegramTether = agent.isDefault || telegramTether.channelCount > 0;

      contentNodes.push({
        id: agent.id,
        type: "agent",
        draggable: true,
        position: agentPosition,
        zIndex: isComposerHighlightedAgent ? 55 : 10,
        selected: false,
        data: {
          agent,
          emphasis: isFocusMode ? true : !activeWorkspaceId || activeWorkspaceId === workspace.id,
          focused: focusedAgentId === agent.id,
          composerFocused: isComposerHighlightedAgent,
          relativeTimeReferenceMs,
          telegramTetherCount: telegramTether.channelCount,
          onEdit: onEditAgent,
          onDelete: onDeleteAgent,
          onFocus: onFocusAgent
        }
      });

      if (showTelegramTether) {
        const telegramModuleId = toTelegramTetherNodeId(agent);

        telegramModuleNodes.push({
          id: telegramModuleId,
          type: "telegram-module",
          parentId: agent.id,
          draggable: true,
          selectable: false,
          width: 64,
          height: 64,
          position: resolvePersistedPosition(
            toPersistedTelegramModulePositionKey(agent),
            { x: -80, y: -32 },
            persistedNodePositions
          ),
          zIndex: isComposerHighlightedAgent ? 55 : 18,
          selected: false,
          data: {
            agent,
            emphasis: isFocusMode ? true : !activeWorkspaceId || activeWorkspaceId === workspace.id,
            channelCount: telegramTether.channelCount,
            channelNames: telegramTether.channelNames,
            telegramRoleLines: telegramTether.roleLines,
            telegramRoleTone: telegramTether.roleTone
          }
        });
      }

      graphTasks.push(...agentTasks);

      agentTasks.forEach((task, taskIndex) => {
        const bootstrapStage = typeof task.metadata.bootstrapStage === "string" ? task.metadata.bootstrapStage : null;
        const isBootstrapTask =
          bootstrapStage === "submitting" ||
          bootstrapStage === "accepted" ||
          bootstrapStage === "waiting-for-heartbeat" ||
          bootstrapStage === "waiting-for-runtime" ||
          bootstrapStage === "runtime-observed";
        const isJustCreatedTask = justCreatedTaskIds.includes(task.id);

        contentNodes.push({
          id: task.id,
          type: "task",
          draggable: true,
          selectable: true,
          position: resolvePersistedPosition(
            toPersistedTaskPositionKey(task),
            { x: taskX, y: agentY + taskIndex * 152 + 10 },
            persistedNodePositions,
            toLegacyPersistedTaskPositionKey(task.id)
          ),
          zIndex: isBootstrapTask ? 40 : isJustCreatedTask ? 28 : 10,
          selected: false,
          data: {
            task,
            emphasis: isFocusMode ? true : !activeWorkspaceId || activeWorkspaceId === workspace.id,
            relativeTimeReferenceMs,
            pendingCreation: isBootstrapTask,
            justCreated: isJustCreatedTask,
            locked: safeLockedTaskKeys.includes(task.key),
            onReply: onReplyTask,
            onCopyPrompt: onCopyTaskPrompt,
            onHide: onHideTask,
            onToggleLock: onToggleTaskLock,
            onAbortTask,
            onInspect: onInspectTask
          }
        });
      });

      laneY += Math.max(152, agentTasks.length * 152 + 44);
    });

    if (!isFocusMode) {
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
          emphasis: !activeWorkspaceId || activeWorkspaceId === workspace.id,
          taskCardCount: workspaceToggleTasks.length,
          taskCardsHidden: workspaceTaskCardsHidden,
          onToggleTaskCards:
            workspaceToggleTasks.length > 0 ? () => onToggleWorkspaceTaskCards(workspace.id) : undefined
        }
      });
    }
  });

  const nodes: CanvasNode[] = [...workspaceNodes, ...contentNodes, ...telegramModuleNodes];
  return {
    nodes,
    edges: [
      ...buildEdgesForNodes(graphTasks, nodes, composerTargetAgentId, isComposerActive),
      ...buildTelegramTetherEdges(nodes, composerTargetAgentId, isComposerActive)
    ]
  };
}

function buildEdgesForNodes(
  tasks: TaskRecord[],
  nodes: CanvasNode[],
  composerTargetAgentId: string | null,
  isComposerActive: boolean
) {
  const edges: CanvasEdge[] = [];
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
      animated: task.status === "running" || (isComposerActive && task.primaryAgentId === composerTargetAgentId),
      data: {
        composerFocused: isComposerActive && task.primaryAgentId === composerTargetAgentId
      },
      style: {
        strokeWidth:
          task.status === "running" && isComposerActive && task.primaryAgentId === composerTargetAgentId
            ? 3.05
            : task.status === "running"
              ? 2.95
              : isComposerActive && task.primaryAgentId === composerTargetAgentId
                ? 2.8
                : 2.25
      }
    });
  }

  return edges;
}

function buildTelegramTetherEdges(
  nodes: CanvasNode[],
  composerTargetAgentId: string | null,
  isComposerActive: boolean
) {
  const edges: CanvasEdge[] = [];
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  for (const node of nodes) {
    if (node.type !== "telegram-module") {
      continue;
    }

    const sourceAgentId = node.data.agent.id;
    const source = nodesById.get(sourceAgentId);
    const target = nodesById.get(node.id);

    if (!source || !target) {
      continue;
    }

    edges.push({
      id: `edge:${sourceAgentId}:${node.id}`,
      source: sourceAgentId,
      target: node.id,
      sourceHandle: "source-telegram",
      targetHandle: "target-telegram",
      type: "simplebezier",
      zIndex: 16,
      animated: true,
      data: {
        telegramTether: true,
        composerFocused: isComposerActive && composerTargetAgentId === sourceAgentId
      },
      style: {
        strokeWidth: isComposerActive && composerTargetAgentId === sourceAgentId ? 2.15 : 1.85
      }
    });
  }

  return edges;
}

function isTaskHidden(
  task: TaskRecord,
  hiddenRuntimeIds: string[],
  hiddenTaskKeys: string[],
  lockedTaskKeys: string[]
) {
  const safeHiddenRuntimeIds = Array.isArray(hiddenRuntimeIds) ? hiddenRuntimeIds : [];
  const safeHiddenTaskKeys = Array.isArray(hiddenTaskKeys) ? hiddenTaskKeys : [];
  const safeLockedTaskKeys = Array.isArray(lockedTaskKeys) ? lockedTaskKeys : [];

  if (safeLockedTaskKeys.includes(task.key)) {
    return false;
  }

  if (safeHiddenTaskKeys.includes(task.key)) {
    return true;
  }

  if (task.runtimeIds.length === 0) {
    return false;
  }

  return task.runtimeIds.every((runtimeId) => safeHiddenRuntimeIds.includes(runtimeId));
}

function resolveTaskOwnerId(task: TaskRecord) {
  return task.primaryAgentId || task.agentIds[0] || null;
}

function buildTelegramTetherSummary(
  snapshot: MissionControlSnapshot,
  workspace: MissionControlSnapshot["workspaces"][number],
  agent: OpenClawAgent
): TelegramTetherSummary {
  const relatedChannelNames = new Set<string>();
  let primaryChannelCount = 0;
  let ownerGroupCount = 0;
  let delegateChannelCount = 0;

  for (const channel of snapshot.channelRegistry.channels) {
    if (channel.type !== "telegram") {
      continue;
    }

    const workspaceBinding = channel.workspaces.find((entry) => entry.workspaceId === workspace.id) ?? null;
    if (!workspaceBinding) {
      continue;
    }

    const enabledAssignments = workspaceBinding.groupAssignments.filter((assignment) => assignment.enabled !== false);
    const ownedAssignments = enabledAssignments.filter((assignment) => assignment.agentId === agent.id);
    const isPrimary = channel.primaryAgentId === agent.id;
    const isDelegate = !isPrimary && workspaceBinding.agentIds.includes(agent.id);
    const hasAnyTelegramRole = isPrimary || isDelegate || ownedAssignments.length > 0;

    if (!hasAnyTelegramRole) {
      continue;
    }

    relatedChannelNames.add(channel.name);
    primaryChannelCount += isPrimary ? 1 : 0;
    delegateChannelCount += isDelegate ? 1 : 0;
    ownerGroupCount += ownedAssignments.length;
  }

  const roleLines: string[] = [];

  if (primaryChannelCount > 0) {
    roleLines.push(
      `Primary voice in ${primaryChannelCount} channel${primaryChannelCount === 1 ? "" : "s"}`
    );
  }

  if (ownerGroupCount > 0) {
    roleLines.push(`Group owner in ${ownerGroupCount} chat${ownerGroupCount === 1 ? "" : "s"}`);
  }

  if (delegateChannelCount > 0) {
    roleLines.push(
      `Delegate in ${delegateChannelCount} channel${delegateChannelCount === 1 ? "" : "s"}`
    );
  }

  if (roleLines.length === 0 && agent.isDefault) {
    roleLines.push("Default Telegram anchor");
  }

  const roleTone =
    primaryChannelCount > 0 && (ownerGroupCount > 0 || delegateChannelCount > 0)
      ? "mixed"
      : primaryChannelCount > 0
        ? "primary"
        : ownerGroupCount > 0
          ? "owner"
          : delegateChannelCount > 0
            ? "delegate"
            : "primary";

  return {
    channelCount: relatedChannelNames.size,
    channelNames: [...relatedChannelNames].sort((left, right) => left.localeCompare(right)),
    roleLines,
    roleTone
  };
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

    const selected = previous.selected ?? node.selected;
    const zIndex = previous.selected ? previous.zIndex : node.zIndex;

    return {
      ...node,
      position: previous.position,
      width: previous.width ?? node.width,
      height: previous.height ?? node.height,
      measured: previous.measured ?? node.measured,
      dragging: previous.dragging ?? node.dragging,
      selected,
      zIndex
    };
  });
}

function resolveNodeZIndex(node: CanvasNode, selectedNodeId: string | null, composerTargetAgentId: string | null, isComposerActive: boolean) {
  if (node.type === "workspace") {
    return 0;
  }

  if (node.type === "agent") {
    if (isComposerActive && composerTargetAgentId === node.id && selectedNodeId === node.id) {
      return 65;
    }

    if (selectedNodeId === node.id) {
      return 60;
    }

    if (isComposerActive && composerTargetAgentId === node.id) {
      return 55;
    }

    return 10;
  }

  if (node.type === "telegram-module") {
    if (isComposerActive && composerTargetAgentId === node.data.agent.id && selectedNodeId === node.id) {
      return 65;
    }

    if (selectedNodeId === node.id) {
      return 60;
    }

    if (isComposerActive && composerTargetAgentId === node.data.agent.id) {
      return 55;
    }

    return 18;
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

function readPersistedNodePositions() {
  const raw = readFromLocalStorage(nodePositionsStorageKey);

  if (!raw) {
    return {} as PersistedNodePositionMap;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!parsed || typeof parsed !== "object") {
      return {} as PersistedNodePositionMap;
    }

    const entries = Object.entries(parsed as Record<string, unknown>).filter(([, value]) => {
      return (
        typeof value === "object" &&
        value !== null &&
        typeof (value as PersistedNodePosition).x === "number" &&
        Number.isFinite((value as PersistedNodePosition).x) &&
        typeof (value as PersistedNodePosition).y === "number" &&
        Number.isFinite((value as PersistedNodePosition).y)
      );
    });

    return Object.fromEntries(entries) as PersistedNodePositionMap;
  } catch {
    return {} as PersistedNodePositionMap;
  }
}

function extractPersistedNodePositions(nodes: CanvasNode[]) {
  return Object.fromEntries(
    nodes
      .filter((node) => node.type === "agent" || node.type === "task" || node.type === "telegram-module")
      .map((node) => [
        resolveNodePersistedPositionKey(node),
        {
          x: node.position.x,
          y: node.position.y
        }
      ])
  ) as PersistedNodePositionMap;
}

function arePersistedNodePositionsEqual(
  left: PersistedNodePositionMap,
  right: PersistedNodePositionMap
) {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);

  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  return leftEntries.every(([key, value]) => {
    const target = right[key];
    return target && target.x === value.x && target.y === value.y;
  });
}

function resolvePersistedPosition(
  persistedKey: string,
  fallback: PersistedNodePosition,
  persistedNodePositions: PersistedNodePositionMap,
  legacyPersistedKey?: string
) {
  const saved =
    persistedNodePositions[persistedKey] ||
    (legacyPersistedKey ? persistedNodePositions[legacyPersistedKey] : undefined);

  if (!saved) {
    return fallback;
  }

  return { x: saved.x, y: saved.y };
}

function resolveNodePersistedPositionKey(
  node: AgentCanvasNode | TaskCanvasNode | TelegramModuleCanvasNode
) {
  if (node.type === "agent") {
    return toPersistedAgentPositionKey(node.data.agent);
  }

  if (node.type === "telegram-module") {
    return toPersistedTelegramModulePositionKey(node.data.agent);
  }

  return toPersistedTaskPositionKey(node.data.task);
}

function toPersistedAgentPositionKey(agent: OpenClawAgent) {
  return `agent:${agent.workspaceId}:${agent.id}`;
}

function toLegacyPersistedAgentPositionKey(agentId: string) {
  return `agent:${agentId}`;
}

function toTelegramTetherNodeId(agent: OpenClawAgent) {
  return `telegram-module-v3:${agent.workspaceId}:${agent.id}`;
}

function toPersistedTelegramModulePositionKey(agent: OpenClawAgent) {
  return toTelegramTetherNodeId(agent);
}

function toPersistedTaskPositionKey(task: TaskRecord) {
  return `task:${task.workspaceId || "global"}:${task.key}`;
}

function toLegacyPersistedTaskPositionKey(taskId: string) {
  return `task:${taskId}`;
}

function readFromLocalStorage(key: string) {
  const storage = globalThis.localStorage;

  if (!storage || typeof storage.getItem !== "function") {
    return null;
  }

  return storage.getItem(key);
}

function writeToLocalStorage(key: string, value: string) {
  const storage = globalThis.localStorage;

  if (!storage || typeof storage.setItem !== "function") {
    return;
  }

  storage.setItem(key, value);
}
