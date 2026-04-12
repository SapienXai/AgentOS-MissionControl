"use client";

import {
  ReactFlow,
  type ReactFlowInstance,
  MarkerType,
  useEdgesState,
  useNodesState
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useRef, useState } from "react";

import {
  arePersistedNodePositionsEqual,
  edgeTypes,
  emptyPersistedNodePositions,
  extractPersistedNodePositions,
  getNodePositionsStorageKey,
  markTaskAsJustCreated,
  mergeNodePositions,
  nodeTypes,
  readPersistedNodePositions,
  resolveNodeZIndex,
  resolveSurfaceModuleAnchorPosition,
  stepSurfaceModuleSpring,
  toLegacyPersistedAgentPositionKey,
  toLegacyPersistedTaskPositionKey,
  toPersistedAgentPositionKey,
  toPersistedTaskPositionKey,
  writeToLocalStorage
} from "@/components/mission-control/canvas.utils";
import {
  buildCanvasGraph,
  isTaskHidden,
  resolveTaskOwnerId
} from "@/components/mission-control/canvas.graph";
import type {
  AgentDetailFocus,
  CanvasEdge,
  CanvasNode,
  FocusTaskAnchor,
  PersistedNodePositionMap,
  SpringVelocity
} from "@/components/mission-control/canvas-types";
import { resolveRelativeTimeReferenceMs } from "@/lib/openclaw/presenters";
import type { MissionControlSnapshot, TaskRecord } from "@/lib/agentos/contracts";
import { cn } from "@/lib/utils";

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
