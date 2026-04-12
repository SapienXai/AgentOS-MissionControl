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
  AgentDetailFocus,
  AgentSurfaceBadge,
  AgentNodeData,
  MissionEdgeData,
  SurfaceTetherNodeData,
  TaskNodeData,
  WorkspaceNodeData
} from "@/components/mission-control/canvas-types";
import { AgentNode } from "@/components/mission-control/nodes/agent-node";
import { MissionConnectionEdge } from "@/components/mission-control/edges/mission-connection-edge";
import { SurfaceTetherNode } from "@/components/mission-control/nodes/surface-tether-node";
import { TaskNode } from "@/components/mission-control/nodes/task-node";
import { WorkspaceNode } from "@/components/mission-control/nodes/workspace-node";
import { getSurfaceCatalogEntry } from "@/lib/openclaw/surface-catalog";
import { resolveRelativeTimeReferenceMs } from "@/lib/openclaw/presenters";
import type { MissionControlSnapshot, MissionControlSurfaceProvider, OpenClawAgent, TaskRecord } from "@/lib/agentos/contracts";
import { cn } from "@/lib/utils";

type WorkspaceCanvasNode = Node<WorkspaceNodeData, "workspace">;
type AgentCanvasNode = Node<AgentNodeData, "agent">;
type SurfaceTetherCanvasNode = Node<SurfaceTetherNodeData, "surface-module">;
type TaskCanvasNode = Node<TaskNodeData, "task">;
type CanvasEdge = Edge<MissionEdgeData, "simplebezier">;
type CanvasNode = WorkspaceCanvasNode | AgentCanvasNode | SurfaceTetherCanvasNode | TaskCanvasNode;
type PersistedNodePosition = {
  x: number;
  y: number;
};
type SpringVelocity = {
  x: number;
  y: number;
};
type PersistedNodePositionMap = Record<string, PersistedNodePosition>;
type FocusTaskAnchor = {
  taskId: string;
  agentId: string | null;
};
const emptyPersistedNodePositions: PersistedNodePositionMap = {};

const nodeTypes = {
  workspace: WorkspaceNode,
  agent: AgentNode,
  "surface-module": SurfaceTetherNode,
  task: TaskNode
};
const edgeTypes = {
  simplebezier: MissionConnectionEdge
};
const justCreatedTaskDurationMs = 12000;
const nodePositionsStorageKey = "mission-control-node-positions:v2";
const legacyNodePositionsStorageKey = "mission-control-node-positions";
const surfaceModuleSpringStiffness = 220;
const surfaceModuleSpringDamping = 20;
const surfaceModuleSettlingThreshold = 0.35;

export function MissionCanvas({
  snapshot,
  activeWorkspaceId,
  selectedNodeId,
  focusedAgentId,
  activeChatAgentId,
  composerTargetAgentId,
  isComposerActive,
  composerViewportResetNonce,
  recentDispatchId,
  hiddenRuntimeIds,
  hiddenTaskKeys,
  lockedTaskKeys,
  onToggleWorkspaceTaskCards,
  onMessageAgent,
  onEditAgent,
  onDeleteAgent,
  onFocusAgent,
  onConfigureAgentModel,
  onConfigureAgentCapabilities,
  onInspectAgentDetail,
  onOpenWorkspaceChannels,
  onReplyTask,
  onCopyTaskPrompt,
  onHideTask,
  onToggleTaskLock,
  onAbortTask,
  onInspectTask,
  onSelectNode,
  onCanvasNodePointerDownCapture,
  className
}: {
  snapshot: MissionControlSnapshot;
  activeWorkspaceId: string | null;
  selectedNodeId: string | null;
  focusedAgentId: string | null;
  activeChatAgentId: string | null;
  composerTargetAgentId: string | null;
  isComposerActive: boolean;
  composerViewportResetNonce: number;
  recentDispatchId: string | null;
  hiddenRuntimeIds: string[];
  hiddenTaskKeys: string[];
  lockedTaskKeys: string[];
  onToggleWorkspaceTaskCards: (workspaceId: string) => void;
  onMessageAgent?: (agentId: string) => void;
  onEditAgent: (agentId: string) => void;
  onDeleteAgent: (agentId: string) => void;
  onFocusAgent: (agentId: string) => void;
  onConfigureAgentModel?: (agentId: string) => void;
  onConfigureAgentCapabilities?: (agentId: string, focus: "skills" | "tools") => void;
  onInspectAgentDetail?: (agentId: string, focus: AgentDetailFocus) => void;
  onOpenWorkspaceChannels?: (workspaceId?: string) => void;
  onReplyTask: (task: TaskRecord) => void;
  onCopyTaskPrompt: (task: TaskRecord) => void;
  onHideTask: (task: TaskRecord) => void;
  onToggleTaskLock: (task: TaskRecord) => void;
  onAbortTask: (task: TaskRecord) => void;
  onInspectTask: (task: TaskRecord, target: "overview" | "output" | "files") => void;
  onSelectNode: (nodeId: string) => void;
  onCanvasNodePointerDownCapture?: () => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const reactFlowRef = useRef<ReactFlowInstance<CanvasNode, CanvasEdge> | null>(null);
  const handledDispatchIdsRef = useRef<Set<string>>(new Set());
  const creationTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const surfaceSpringVelocitiesRef = useRef<Map<string, SpringVelocity>>(new Map());
  const persistedNodePositionsRef = useRef<PersistedNodePositionMap>({});
  const hasHydratedPersistedNodePositionsRef = useRef(false);
  const skipNextPersistRef = useRef(false);
  const shouldMergePositionsRef = useRef(false);
  const lastCanvasScopeKeyRef = useRef<string | null>(null);
  const lastComposerViewportResetNonceRef = useRef(composerViewportResetNonce);
  const relativeTimeReferenceMs = resolveRelativeTimeReferenceMs(snapshot.generatedAt);
  const [justCreatedTaskIds, setJustCreatedTaskIds] = useState<string[]>([]);
  const [focusTaskAnchor, setFocusTaskAnchor] = useState<FocusTaskAnchor | null>(null);
  const canvasScopeKey = focusedAgentId
    ? `focus:${focusedAgentId}`
    : activeWorkspaceId
      ? `workspace:${activeWorkspaceId}`
      : "all";
  const initialGraph = buildCanvasGraph(
    snapshot,
    relativeTimeReferenceMs,
    activeWorkspaceId,
    focusedAgentId,
    selectedNodeId,
    activeChatAgentId,
    composerTargetAgentId,
    isComposerActive,
    justCreatedTaskIds,
    hiddenRuntimeIds,
    hiddenTaskKeys,
    lockedTaskKeys,
    onToggleWorkspaceTaskCards,
    onMessageAgent,
    onEditAgent,
    onDeleteAgent,
    onFocusAgent,
    onConfigureAgentModel,
    onConfigureAgentCapabilities,
    onInspectAgentDetail,
    onOpenWorkspaceChannels,
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
    const persistedPositions = readPersistedNodePositions(canvasScopeKey);
    persistedNodePositionsRef.current = persistedPositions;
    hasHydratedPersistedNodePositionsRef.current = true;
    skipNextPersistRef.current = true;

    if (Object.keys(persistedPositions).length === 0) {
      return;
    }

    setNodes((previousNodes) =>
      previousNodes.map((node) => {
        if (node.type === "workspace" || node.type === "surface-module") {
          return node;
        }

        const persistedKey =
          node.type === "agent"
            ? toPersistedAgentPositionKey(node.data.agent)
            : toPersistedTaskPositionKey(node.data.task);
        const legacyPersistedKey =
          node.type === "agent"
            ? toLegacyPersistedAgentPositionKey(node.data.agent.id)
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
  }, [canvasScopeKey, setNodes]);

  useEffect(() => {
    const nextGraph = buildCanvasGraph(
      snapshot,
      relativeTimeReferenceMs,
      activeWorkspaceId,
      focusedAgentId,
      selectedNodeId,
      activeChatAgentId,
      composerTargetAgentId,
      isComposerActive,
      justCreatedTaskIds,
      hiddenRuntimeIds,
      hiddenTaskKeys,
      lockedTaskKeys,
      onToggleWorkspaceTaskCards,
      onMessageAgent,
      onEditAgent,
      onDeleteAgent,
      onFocusAgent,
      onConfigureAgentModel,
      onConfigureAgentCapabilities,
      onInspectAgentDetail,
      onOpenWorkspaceChannels,
      onReplyTask,
      onCopyTaskPrompt,
      onHideTask,
      onToggleTaskLock,
      onAbortTask,
      onInspectTask,
      persistedNodePositionsRef.current
    );
    const scopeChanged = lastCanvasScopeKeyRef.current !== canvasScopeKey;
    lastCanvasScopeKeyRef.current = canvasScopeKey;

    setNodes((previousNodes) => {
      if (scopeChanged || (!shouldMergePositionsRef.current && hasHydratedPersistedNodePositionsRef.current)) {
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
    selectedNodeId,
    activeChatAgentId,
    composerTargetAgentId,
    isComposerActive,
    justCreatedTaskIds,
    hiddenRuntimeIds,
    hiddenTaskKeys,
    lockedTaskKeys,
    onToggleWorkspaceTaskCards,
    onMessageAgent,
    onEditAgent,
    onDeleteAgent,
    onFocusAgent,
    onConfigureAgentModel,
    onConfigureAgentCapabilities,
    onInspectAgentDetail,
    onOpenWorkspaceChannels,
    onReplyTask,
    onCopyTaskPrompt,
    onHideTask,
    onToggleTaskLock,
    onAbortTask,
    onInspectTask,
    relativeTimeReferenceMs,
    canvasScopeKey,
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
    let frameId = 0;
    let previousTime = performance.now();

    const tick = (time: number) => {
      const dtSeconds = Math.min(0.032, Math.max(0.008, (time - previousTime) / 1000));
      previousTime = time;

      setNodes((currentNodes) => {
        let didUpdate = false;
        const nodesById = new Map(currentNodes.map((node) => [node.id, node]));
        const nextNodes = currentNodes.map((node) => {
          if (node.type !== "surface-module") {
            return node;
          }

          const agentNode = nodesById.get(node.data.agent.id);
          if (!agentNode || agentNode.type !== "agent") {
            surfaceSpringVelocitiesRef.current.delete(node.id);
            return node;
          }

          const targetPosition = resolveSurfaceModuleAnchorPosition(
            agentNode.position,
            node.data.anchorIndex,
            node.data.anchorCount,
            agentNode.width ?? agentNode.measured?.width,
            agentNode.height ?? agentNode.measured?.height
          );
          const springVelocity = surfaceSpringVelocitiesRef.current.get(node.id) ?? { x: 0, y: 0 };
          const nextPosition = stepSurfaceModuleSpring(
            node.position,
            targetPosition,
            springVelocity,
            dtSeconds
          );

          if (nextPosition.settled) {
            surfaceSpringVelocitiesRef.current.delete(node.id);

            if (node.position.x === targetPosition.x && node.position.y === targetPosition.y) {
              return node;
            }

            didUpdate = true;
            return {
              ...node,
              position: targetPosition
            };
          }

          surfaceSpringVelocitiesRef.current.set(node.id, springVelocity);

          if (
            Math.abs(nextPosition.position.x - node.position.x) < 0.001 &&
            Math.abs(nextPosition.position.y - node.position.y) < 0.001
          ) {
            return node;
          }

          didUpdate = true;
          return {
            ...node,
            position: nextPosition.position
          };
        });

        return didUpdate ? nextNodes : currentNodes;
      });

      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [setNodes]);

  useEffect(() => {
    if (!reactFlowRef.current) {
      return;
    }

    if (!isComposerActive && composerViewportResetNonce !== lastComposerViewportResetNonceRef.current) {
      lastComposerViewportResetNonceRef.current = composerViewportResetNonce;
      return;
    }

    lastComposerViewportResetNonceRef.current = composerViewportResetNonce;

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
  }, [focusedAgentId, composerTargetAgentId, isComposerActive, composerViewportResetNonce]);

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
      resolveTaskOwnerId(resolvedTask),
      setJustCreatedTaskIds,
      creationTimeoutsRef,
      setFocusTaskAnchor
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
    if (!focusTaskAnchor || !reactFlowRef.current) {
      return;
    }

    const targetNode = nodes.find((node) => node.id === focusTaskAnchor.taskId);

    if (!targetNode) {
      return;
    }

    const agentNode =
      focusTaskAnchor.agentId !== null
        ? nodes.find((node) => node.type === "agent" && node.id === focusTaskAnchor.agentId)
        : null;
    const targetCenterX = targetNode.position.x + (targetNode.width ?? 272) / 2;
    const targetCenterY = targetNode.position.y + (targetNode.height ?? 204) / 2;
    const centerX =
      agentNode && agentNode.type === "agent"
        ? (targetCenterX + agentNode.position.x + (agentNode.width ?? 272) / 2) / 2
        : targetCenterX;
    const centerY =
      agentNode && agentNode.type === "agent"
        ? (targetCenterY + agentNode.position.y + (agentNode.height ?? 220) / 2) / 2
        : targetCenterY;

    reactFlowRef.current.setCenter(
      centerX,
      centerY,
      {
        zoom: Math.max(reactFlowRef.current.getZoom(), 0.88),
        duration: 650
      }
    );

    const timeoutId = setTimeout(() => {
      setFocusTaskAnchor((current) =>
        current?.taskId === focusTaskAnchor.taskId ? null : current
      );
    }, 900);

    return () => clearTimeout(timeoutId);
  }, [focusTaskAnchor, nodes]);

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
    writeToLocalStorage(getNodePositionsStorageKey(canvasScopeKey), JSON.stringify(mergedPositions));
  }, [canvasScopeKey, nodes]);

  return (
    <div ref={containerRef} className={cn("h-full w-full", className)}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onInit={(instance) => {
          reactFlowRef.current = instance;
        }}
        onPointerDownCapture={(event) => {
          if (!(event.target instanceof Element)) {
            return;
          }

          if (event.target.closest(".react-flow__node")) {
            onCanvasNodePointerDownCapture?.();
          }
        }}
        elevateNodesOnSelect={false}
        autoPanOnNodeDrag={false}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => {
          if (node.type === "surface-module") {
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
  selectedNodeId: string | null,
  activeChatAgentId: string | null,
  composerTargetAgentId: string | null,
  isComposerActive: boolean,
  justCreatedTaskIds: string[],
  hiddenRuntimeIds: string[],
  hiddenTaskKeys: string[],
  lockedTaskKeys: string[],
  onToggleWorkspaceTaskCards: (workspaceId: string) => void,
  onMessageAgent: ((agentId: string) => void) | undefined,
  onEditAgent: (agentId: string) => void,
  onDeleteAgent: (agentId: string) => void,
  onFocusAgent: (agentId: string) => void,
  onConfigureAgentModel: ((agentId: string) => void) | undefined,
  onConfigureAgentCapabilities: ((agentId: string, focus: "skills" | "tools") => void) | undefined,
  onInspectAgentDetail: ((agentId: string, focus: AgentDetailFocus) => void) | undefined,
  onOpenWorkspaceChannels: ((workspaceId?: string) => void) | undefined,
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
  const selectedTask = selectedNodeId
    ? snapshot.tasks.find((task) => task.id === selectedNodeId) ?? null
    : null;
  const selectedTaskAgentId = selectedTask ? resolveTaskOwnerId(selectedTask) : null;
  const isFocusMode = focusedAgent !== null;
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
  const surfaceModuleNodes: SurfaceTetherCanvasNode[] = [];
  const graphTasks: TaskRecord[] = [];
  let rowTopY = 42;
  let rowMaxHeight = 0;

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
    const workspaceColumn = workspaceIndex % 2;
    const groupX = workspaceColumn * 1160 + 44;
    const groupY = rowTopY;
    const agentX = groupX + 52;
    const taskX = groupX + 390;
    let laneY = groupY + 118;

    workspaceAgents.forEach((agent, agentIndex) => {
      const agentTasks = workspaceTasks
        .filter((task) => resolveTaskOwnerId(task) === agent.id)
        .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
      const agentY = laneY + agentIndex * 4;
      const isComposerHighlightedAgent = isComposerActive && composerTargetAgentId === agent.id;
      const hasJustCreatedTask = agentTasks.some((task) => justCreatedTaskIds.includes(task.id));
      const isTaskFocusedAgent = selectedTaskAgentId === agent.id || hasJustCreatedTask;
      const activeTaskCount = agentTasks.filter((task) => isLiveTask(task)).length;
      const isAgentChatOpen = activeChatAgentId === agent.id;
      const surfaceBadges = buildAgentSurfaceBadges(snapshot, workspace, agent);
      const agentPosition = resolvePersistedPosition(
        toPersistedAgentPositionKey(agent),
        { x: agentX, y: agentY },
        persistedNodePositions,
        toLegacyPersistedAgentPositionKey(agent.id)
      );

      contentNodes.push({
        id: agent.id,
        type: "agent",
        draggable: true,
        position: agentPosition,
        zIndex: isComposerHighlightedAgent ? 55 : isTaskFocusedAgent ? 48 : activeTaskCount > 0 ? 24 : 10,
        selected: false,
        data: {
          agent,
          emphasis: isFocusMode ? true : !activeWorkspaceId || activeWorkspaceId === workspace.id,
          focused: focusedAgentId === agent.id,
          composerFocused: isComposerHighlightedAgent,
          taskFocused: isTaskFocusedAgent,
          activeTaskCount,
          chatOpen: isAgentChatOpen,
          relativeTimeReferenceMs,
          surfaceBadges,
          onMessage: onMessageAgent,
          onEdit: onEditAgent,
          onDelete: onDeleteAgent,
          onFocus: onFocusAgent,
          onConfigureModel: onConfigureAgentModel,
          onConfigureCapabilities: onConfigureAgentCapabilities,
          onInspect: onInspectAgentDetail,
          onOpenWorkspaceChannels
        }
      });

      surfaceModuleNodes.push({
        id: toSurfaceActionNodeId(agent),
        type: "surface-module",
        draggable: false,
        selectable: false,
        width: 64,
        height: 64,
        position: resolveSurfaceActionAnchorPosition(agentPosition, surfaceBadges.length),
        zIndex: isComposerHighlightedAgent ? 55 : isTaskFocusedAgent ? 48 : 19,
        selected: false,
        data: {
          agent,
          emphasis: isFocusMode ? true : !activeWorkspaceId || activeWorkspaceId === workspace.id,
          provider: "surface-add" as MissionControlSurfaceProvider,
          variant: "add",
          label: "Add surface",
          actionLabel: "Connect a new workspace surface",
          anchorIndex: 0,
          anchorCount: surfaceBadges.length + 1,
          surfaceCount: 0,
          surfaceNames: [],
          roleLabel: "Connect a new workspace surface",
          roleTone: "primary",
          accentColor: "#7dd3fc",
          onClick: onOpenWorkspaceChannels ? () => onOpenWorkspaceChannels(workspace.id) : undefined
        }
      });

      surfaceBadges.forEach((surfaceBadge, surfaceIndex) => {
        surfaceModuleNodes.push({
          id: toSurfaceTetherNodeId(agent, surfaceBadge.provider),
          type: "surface-module",
          draggable: false,
          selectable: false,
          width: 64,
          height: 64,
          position: resolveSurfaceModuleAnchorPosition(agentPosition, surfaceIndex, surfaceBadges.length),
          zIndex: isComposerHighlightedAgent ? 55 : isTaskFocusedAgent ? 48 : 18,
          selected: false,
          data: {
            agent,
            emphasis: isFocusMode ? true : !activeWorkspaceId || activeWorkspaceId === workspace.id,
            provider: surfaceBadge.provider,
            variant: "surface",
            label: surfaceBadge.label,
            anchorIndex: surfaceIndex + 1,
            anchorCount: surfaceBadges.length + 1,
            surfaceCount: surfaceBadge.count,
            surfaceNames: surfaceBadge.surfaceNames ?? [],
            roleLabel: surfaceBadge.roleLabel,
            roleTone: surfaceBadge.roleTone ?? "primary",
            accentColor: surfaceBadge.accentColor ?? null
          }
        });
      });

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
      const workspaceHeight = Math.max(laneY - groupY + 112, 700);

      workspaceNodes.push({
        id: workspace.id,
        type: "workspace",
        draggable: false,
        position: { x: groupX, y: groupY },
        zIndex: 0,
        style: {
          width: 1060,
          height: workspaceHeight
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

      rowMaxHeight = Math.max(rowMaxHeight, workspaceHeight);

      if (workspaceColumn === 1 || workspaceIndex === visibleWorkspaces.length - 1) {
        rowTopY += rowMaxHeight + 80;
        rowMaxHeight = 0;
      }
    }
  });

  const nodes: CanvasNode[] = [...workspaceNodes, ...contentNodes, ...surfaceModuleNodes];
  return {
    nodes,
    edges: [
      ...buildEdgesForNodes(
        graphTasks,
        nodes,
        selectedNodeId,
        justCreatedTaskIds,
        composerTargetAgentId,
        isComposerActive
      ),
      ...buildSurfaceTetherEdges(nodes, composerTargetAgentId, isComposerActive)
    ]
  };
}

function buildEdgesForNodes(
  tasks: TaskRecord[],
  nodes: CanvasNode[],
  selectedNodeId: string | null,
  justCreatedTaskIds: string[],
  composerTargetAgentId: string | null,
  isComposerActive: boolean
) {
  const edges: CanvasEdge[] = [];
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  for (const task of tasks) {
    const ownerAgentId = resolveTaskOwnerId(task);

    if (!ownerAgentId) {
      continue;
    }

    const source = nodesById.get(ownerAgentId);
    const target = nodesById.get(task.id);

    if (!source || !target) {
      continue;
    }

    edges.push({
      id: `edge:${ownerAgentId}:${task.id}`,
      source: ownerAgentId,
      target: task.id,
      sourceHandle: "source-right",
      targetHandle: "target-left",
      type: "simplebezier",
      zIndex: 4,
      animated:
        isLiveTask(task) ||
        task.id === selectedNodeId ||
        justCreatedTaskIds.includes(task.id) ||
        (isComposerActive && ownerAgentId === composerTargetAgentId),
      data: {
        composerFocused: isComposerActive && ownerAgentId === composerTargetAgentId,
        taskFocused: task.id === selectedNodeId || justCreatedTaskIds.includes(task.id)
      },
      style: {
        strokeWidth:
          isLiveTask(task) && isComposerActive && ownerAgentId === composerTargetAgentId
            ? 3.05
            : isLiveTask(task)
              ? 2.95
              : task.id === selectedNodeId || justCreatedTaskIds.includes(task.id)
                ? 2.82
              : isComposerActive && ownerAgentId === composerTargetAgentId
                ? 2.8
                : 2.25
      }
    });
  }

  return edges;
}

function buildSurfaceTetherEdges(
  nodes: CanvasNode[],
  composerTargetAgentId: string | null,
  isComposerActive: boolean
) {
  const edges: CanvasEdge[] = [];
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  for (const node of nodes) {
    if (node.type !== "surface-module") {
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
      sourceHandle: "source-surface",
      targetHandle: node.data.variant === "add" ? "target-surface-action" : "target-surface",
      type: "simplebezier",
      zIndex: 16,
      animated: true,
      data: {
        surfaceTether: true,
        surfaceAccentColor: node.data.accentColor ?? null,
        composerFocused: isComposerActive && composerTargetAgentId === sourceAgentId
      },
      style: {
        strokeWidth: isComposerActive && composerTargetAgentId === sourceAgentId ? 2.2 : 1.95
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

function isLiveTask(task: TaskRecord) {
  return task.status === "queued" || task.status === "running";
}

function buildAgentSurfaceBadges(
  snapshot: MissionControlSnapshot,
  workspace: MissionControlSnapshot["workspaces"][number],
  agent: OpenClawAgent
) {
  const summaries = new Map<
    string,
    {
      surfaceIds: Set<string>;
      surfaceNames: Set<string>;
      primaryCount: number;
      assistantCount: number;
      routeCount: number;
    }
  >();

  for (const channel of snapshot.channelRegistry.channels) {
    const workspaceBinding = channel.workspaces.find((entry) => entry.workspaceId === workspace.id) ?? null;
    if (!workspaceBinding) {
      continue;
    }

    const enabledAssignments = workspaceBinding.groupAssignments.filter((assignment) => assignment.enabled !== false);
    const ownedAssignments = enabledAssignments.filter((assignment) => assignment.agentId === agent.id);
    const isPrimary = channel.primaryAgentId === agent.id;
    const isAssistant = !isPrimary && workspaceBinding.agentIds.includes(agent.id);

    if (!isPrimary && !isAssistant && ownedAssignments.length === 0) {
      continue;
    }

    const current =
      summaries.get(channel.type) ?? {
        surfaceIds: new Set<string>(),
        surfaceNames: new Set<string>(),
        primaryCount: 0,
        assistantCount: 0,
        routeCount: 0
      };
    current.surfaceIds.add(channel.id);
    current.surfaceNames.add(channel.name);
    current.primaryCount += isPrimary ? 1 : 0;
    current.assistantCount += isAssistant ? 1 : 0;
    current.routeCount += ownedAssignments.length;
    summaries.set(channel.type, current);
  }

  return Array.from(summaries.entries())
    .map(([provider, summary]) => {
      const catalogEntry = getSurfaceCatalogEntry(provider);
      const roleParts: string[] = [];

      if (summary.primaryCount > 0) {
        roleParts.push(
          `Primary on ${summary.primaryCount} ${summary.primaryCount === 1 ? "surface" : "surfaces"}`
        );
      }

      if (summary.routeCount > 0) {
        roleParts.push(`Owns ${summary.routeCount} ${summary.routeCount === 1 ? "route" : "routes"}`);
      }

      if (summary.assistantCount > 0) {
        roleParts.push(
          `Assistant on ${summary.assistantCount} ${summary.assistantCount === 1 ? "surface" : "surfaces"}`
        );
      }

      const roleTone =
        summary.primaryCount > 0 && (summary.routeCount > 0 || summary.assistantCount > 0)
          ? "mixed"
          : summary.primaryCount > 0
            ? "primary"
            : summary.routeCount > 0
              ? "owner"
              : "delegate";

      return {
        provider,
        label: catalogEntry.label,
        count: summary.surfaceIds.size,
        roleLabel: roleParts.join(" · "),
        roleTone,
        accentColor: catalogEntry.accentColor ?? null,
        surfaceNames: Array.from(summary.surfaceNames).sort((left, right) => left.localeCompare(right))
      } satisfies AgentSurfaceBadge;
    })
    .sort((left, right) => left.label.localeCompare(right.label));
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

function resolveNodeZIndex(
  node: CanvasNode,
  selectedNodeId: string | null,
  composerTargetAgentId: string | null,
  isComposerActive: boolean
) {
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

    if (node.data.taskFocused) {
      return 48;
    }

    if ((node.data.activeTaskCount ?? 0) > 0) {
      return 24;
    }

    return 10;
  }

  if (node.type === "surface-module") {
    if (node.data.variant === "add") {
      if (isComposerActive && composerTargetAgentId === node.data.agent.id && selectedNodeId === node.id) {
        return 65;
      }

      if (selectedNodeId === node.id) {
        return 60;
      }

      if (isComposerActive && composerTargetAgentId === node.data.agent.id) {
        return 55;
      }

      return 20;
    }

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
  agentId: string | null,
  setJustCreatedTaskIds: Dispatch<SetStateAction<string[]>>,
  creationTimeoutsRef: MutableRefObject<Map<string, ReturnType<typeof setTimeout>>>,
  setFocusTaskAnchor: Dispatch<SetStateAction<FocusTaskAnchor | null>>
) {
  setJustCreatedTaskIds((current) => (current.includes(taskId) ? current : [...current, taskId]));
  setFocusTaskAnchor({
    taskId,
    agentId
  });

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

function readPersistedNodePositions(scopeKey: string) {
  const scopedRaw = readFromLocalStorage(getNodePositionsStorageKey(scopeKey));
  if (scopedRaw !== null) {
    return parsePersistedNodePositions(scopedRaw);
  }

  if (scopeKey !== "all") {
    const legacyRaw = readFromLocalStorage(legacyNodePositionsStorageKey);
    if (legacyRaw !== null) {
      return parsePersistedNodePositions(legacyRaw);
    }
  }

  return {} as PersistedNodePositionMap;
}

function extractPersistedNodePositions(nodes: CanvasNode[]) {
  return Object.fromEntries(
    nodes
      .filter((node) => node.type === "agent" || node.type === "task")
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

function parsePersistedNodePositions(raw: string) {
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

function getNodePositionsStorageKey(scopeKey: string) {
  return `${nodePositionsStorageKey}:${scopeKey}`;
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
  node: AgentCanvasNode | TaskCanvasNode
) {
  if (node.type === "agent") {
    return toPersistedAgentPositionKey(node.data.agent);
  }

  return toPersistedTaskPositionKey(node.data.task);
}

function toPersistedAgentPositionKey(agent: OpenClawAgent) {
  return `agent:${agent.workspaceId}:${agent.id}`;
}

function toLegacyPersistedAgentPositionKey(agentId: string) {
  return `agent:${agentId}`;
}

function toSurfaceTetherNodeId(agent: OpenClawAgent, provider: AgentSurfaceBadge["provider"]) {
  return `surface-module-v1:${agent.workspaceId}:${agent.id}:${provider}`;
}

function toSurfaceActionNodeId(agent: OpenClawAgent) {
  return `surface-add-v1:${agent.workspaceId}:${agent.id}`;
}

function resolveSurfaceModuleAnchorPosition(
  agentPosition: PersistedNodePosition,
  index: number,
  totalCount: number,
  agentWidth = 212,
  agentHeight = 220
) {
  const horizontalOffset = Math.round(Math.max(88, agentWidth * 0.42));
  const verticalOffset = Math.round(Math.max(34, agentHeight * 0.18));
  const rowGap = 76;
  const groupOffset = totalCount > 1 ? ((totalCount - 1) * rowGap) / 2 : 0;

  return {
    x: agentPosition.x - horizontalOffset,
    y: Math.round(agentPosition.y - verticalOffset - groupOffset + index * rowGap)
  };
}

function resolveSurfaceActionAnchorPosition(
  agentPosition: PersistedNodePosition,
  surfaceCount: number,
  agentWidth = 212,
  agentHeight = 220
) {
  return resolveSurfaceModuleAnchorPosition(agentPosition, 0, surfaceCount + 1, agentWidth, agentHeight);
}

function stepSurfaceModuleSpring(
  currentPosition: PersistedNodePosition,
  targetPosition: PersistedNodePosition,
  velocity: SpringVelocity,
  dtSeconds: number
) {
  const forceX =
    (targetPosition.x - currentPosition.x) * surfaceModuleSpringStiffness -
    velocity.x * surfaceModuleSpringDamping;
  const forceY =
    (targetPosition.y - currentPosition.y) * surfaceModuleSpringStiffness -
    velocity.y * surfaceModuleSpringDamping;

  velocity.x += forceX * dtSeconds;
  velocity.y += forceY * dtSeconds;

  const nextPosition = {
    x: currentPosition.x + velocity.x * dtSeconds,
    y: currentPosition.y + velocity.y * dtSeconds
  };

  const settled =
    Math.abs(targetPosition.x - nextPosition.x) < surfaceModuleSettlingThreshold &&
    Math.abs(targetPosition.y - nextPosition.y) < surfaceModuleSettlingThreshold &&
    Math.abs(velocity.x) < surfaceModuleSettlingThreshold &&
    Math.abs(velocity.y) < surfaceModuleSettlingThreshold;

  if (settled) {
    velocity.x = 0;
    velocity.y = 0;

    return {
      position: targetPosition,
      settled: true
    };
  }

  return {
    position: nextPosition,
    settled: false
  };
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
