"use client";

import {
  ReactFlow,
  type ReactFlowInstance,
  MarkerType,
  useEdgesState,
  useNodesState
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";

import {
  arePersistedNodePositionsEqual,
  edgeTypes,
  emptyPersistedNodePositions,
  extractPersistedNodePositions,
  getNodePositionsStorageKey,
  markTaskAsJustCreated,
  mergeSurfaceModulePositions,
  mergeNodePositions,
  nodeTypes,
  readPersistedNodePositions,
  readWorkspaceTaskCardFilters,
  resolveNodeZIndex,
  resolveSurfaceModuleAnchorPosition,
  stepSurfaceModuleSpring,
  toLegacyPersistedAgentPositionKey,
  toLegacyPersistedTaskPositionKey,
  toPersistedAgentPositionKey,
  toPersistedTaskPositionKey,
  writeToLocalStorage,
  writeWorkspaceTaskCardFilters
} from "@/components/mission-control/canvas.utils";
import {
  buildCanvasGraph,
  isTaskHidden,
  resolveTaskOwnerId,
  resolveTaskWorkspaceId
} from "@/components/mission-control/canvas.graph";
import type {
  AgentDetailFocus,
  CanvasEdge,
  CanvasNode,
  FocusTaskAnchor,
  PersistedNodePositionMap,
  SpringVelocity,
  TaskNodeData,
  WorkspaceMenuState,
  WorkspaceTaskCardFilter
} from "@/components/mission-control/canvas-types";
import type { PendingAgentProjection } from "@/components/mission-control/pending-agent-projection";
import { resolveRelativeTimeReferenceMs } from "@/lib/openclaw/presenters";
import { isSystemOwnedMonitorTask } from "@/lib/openclaw/domains/operation-task-projection";
import type { MissionControlSnapshot, WorkItemRecord } from "@/lib/agentos/contracts";
import type { AccountAccessRuleView } from "@/lib/agentos/account-access-policy-types";
import type { AccountLoginTargetView } from "@/lib/agentos/account-login-target-types";
import { cn } from "@/lib/utils";

export function MissionCanvas({
  snapshot,
  surfaceTheme = "dark",
  pendingCreatedAgents,
  agentCreationWarnings,
  accountTargets,
  accountAccessRules,
  sidebarOpen,
  activeWorkspaceId,
  selectedNodeId,
  focusedAgentId,
  recentCreatedAgentId,
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
  onCreateTaskAgent,
  onEditAgent,
  onDeleteAgent,
  onFocusAgent,
  onConfigureAgentModel,
  onConfigureAgentCapabilities,
  onOpenAgentContextEngine,
  onRefresh,
  onInspectAgentDetail,
  onOpenWorkspaceChannels,
  onOpenAccounts,
  onOpenWorkspaceContextEngine,
  onCreateWorkspaceAgent,
  onAddWorkspaceModel,
  onReplyTask,
  onCopyTaskPrompt,
  onHideTask,
  onToggleTaskLock,
  onAbortTask,
  onInspectTask,
  onActiveTaskCardChange,
  onReviewTask,
  onSelectNode,
  onCanvasNodePointerDownCapture,
  className
}: {
  snapshot: MissionControlSnapshot;
  surfaceTheme?: "dark" | "light";
  pendingCreatedAgents?: PendingAgentProjection[];
  agentCreationWarnings?: Record<string, string>;
  accountTargets: AccountLoginTargetView[];
  accountAccessRules: AccountAccessRuleView[];
  sidebarOpen: boolean;
  activeWorkspaceId: string | null;
  selectedNodeId: string | null;
  focusedAgentId: string | null;
  recentCreatedAgentId: string | null;
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
  onCreateTaskAgent?: (agentId: string) => void;
  onEditAgent: (agentId: string) => void;
  onDeleteAgent: (agentId: string) => void;
  onFocusAgent: (agentId: string) => void;
  onConfigureAgentModel?: (agentId: string) => void;
  onConfigureAgentCapabilities?: (agentId: string, focus: "skills" | "tools") => void;
  onOpenAgentContextEngine?: (agentId: string) => void;
  onRefresh?: () => Promise<void> | void;
  onInspectAgentDetail?: (agentId: string, focus: AgentDetailFocus) => void;
  onOpenWorkspaceChannels?: (workspaceId?: string, agentId?: string) => void;
  onOpenAccounts?: (workspaceId?: string, agentId?: string) => void;
  onOpenWorkspaceContextEngine?: (workspaceId: string) => void;
  onCreateWorkspaceAgent?: (workspaceId: string) => void;
  onAddWorkspaceModel?: (workspaceId: string) => void;
  onReplyTask: (task: WorkItemRecord) => void;
  onCopyTaskPrompt: (task: WorkItemRecord) => void;
  onHideTask: (task: WorkItemRecord) => void;
  onToggleTaskLock: (task: WorkItemRecord) => void;
  onAbortTask: (task: WorkItemRecord) => void;
  onInspectTask: NonNullable<TaskNodeData["onInspect"]>;
  onActiveTaskCardChange: NonNullable<TaskNodeData["onActiveCardChange"]>;
  onReviewTask: (task: WorkItemRecord) => void;
  onSelectNode: (nodeId: string) => void;
  onCanvasNodePointerDownCapture?: () => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const reactFlowRef = useRef<ReactFlowInstance<CanvasNode, CanvasEdge> | null>(null);
  const handledDispatchIdsRef = useRef<Set<string>>(new Set());
  const creationTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const surfaceSpringVelocitiesRef = useRef<Map<string, SpringVelocity>>(new Map());
  const surfaceAnimationFrameRef = useRef<number | null>(null);
  const surfaceAnimationPreviousTimeRef = useRef(0);
  const surfaceAnimationRunnerRef = useRef<(time: number) => void>(() => {});
  const persistedNodePositionsRef = useRef<PersistedNodePositionMap>({});
  const hasHydratedPersistedNodePositionsRef = useRef(false);
  const skipNextPersistRef = useRef(false);
  const shouldMergePositionsRef = useRef(false);
  const lastCanvasScopeKeyRef = useRef<string | null>(null);
  const lastComposerViewportResetNonceRef = useRef(composerViewportResetNonce);
  const relativeTimeReferenceMs = resolveRelativeTimeReferenceMs(snapshot.generatedAt);
  const [justCreatedTaskIds, setJustCreatedTaskIds] = useState<string[]>([]);
  const [elevatedAgentMenuId, setElevatedAgentMenuId] = useState<string | null>(null);
  const [focusTaskAnchor, setFocusTaskAnchor] = useState<FocusTaskAnchor | null>(null);
  const [canvasZoom, setCanvasZoom] = useState(0.9);
  const [workspaceTaskCardFilters, setWorkspaceTaskCardFilters] = useState<Record<string, WorkspaceTaskCardFilter>>({});
  const [workspaceTaskCardFiltersHydrated, setWorkspaceTaskCardFiltersHydrated] = useState(false);
  const [openWorkspaceMenu, setOpenWorkspaceMenu] = useState<WorkspaceMenuState | null>(null);
  const canvasScopeKey = focusedAgentId
    ? `focus:${focusedAgentId}`
    : activeWorkspaceId
      ? `workspace:${activeWorkspaceId}`
      : "all";

  useEffect(() => {
    queueMicrotask(() => {
      setWorkspaceTaskCardFilters(readWorkspaceTaskCardFilters());
      setWorkspaceTaskCardFiltersHydrated(true);
    });
  }, []);

  useEffect(() => {
    if (!workspaceTaskCardFiltersHydrated) return;
    writeWorkspaceTaskCardFilters(workspaceTaskCardFilters);
  }, [workspaceTaskCardFilters, workspaceTaskCardFiltersHydrated]);

  const handleAgentConnectionMenuOpenChange = useCallback((agentId: string, open: boolean) => {
    setElevatedAgentMenuId((current) => {
      if (open) {
        return agentId;
      }

      return current === agentId ? null : current;
    });
  }, []);

  const handleWorkspaceTaskCardFilterChange = useCallback((workspaceId: string, filter: WorkspaceTaskCardFilter) => {
    const workspaceTasks = snapshot.tasks.filter(
      (task) => resolveTaskWorkspaceId(task, snapshot.agents) === workspaceId && !isSystemOwnedMonitorTask(task)
    );
    const toggleableTasks = workspaceTasks.filter((task) => !lockedTaskKeys.includes(task.key));
    const allHidden = toggleableTasks.length > 0 && toggleableTasks.every(
      (task) => isTaskHidden(task, hiddenRuntimeIds, hiddenTaskKeys, lockedTaskKeys)
    );

    if ((filter === "all" || filter === "active") && allHidden) {
      onToggleWorkspaceTaskCards(workspaceId);
    } else if (filter === "hidden" && !allHidden && toggleableTasks.length > 0) {
      onToggleWorkspaceTaskCards(workspaceId);
    }

    setWorkspaceTaskCardFilters((current) => ({ ...current, [workspaceId]: filter }));
  }, [hiddenRuntimeIds, hiddenTaskKeys, lockedTaskKeys, onToggleWorkspaceTaskCards, snapshot.agents, snapshot.tasks]);

  const handleWorkspaceMenuChange = useCallback((menu: WorkspaceMenuState | null) => {
    setOpenWorkspaceMenu(menu);
  }, []);

  const initialGraph = buildCanvasGraph(
    snapshot,
    accountTargets,
    accountAccessRules,
    relativeTimeReferenceMs,
    activeWorkspaceId,
    focusedAgentId,
    recentCreatedAgentId,
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
    onCreateTaskAgent,
    onEditAgent,
    onDeleteAgent,
    onFocusAgent,
    onConfigureAgentModel,
    onConfigureAgentCapabilities,
    onOpenAgentContextEngine,
    onRefresh,
    handleAgentConnectionMenuOpenChange,
    onInspectAgentDetail,
    onOpenWorkspaceChannels,
    onOpenAccounts,
    onOpenWorkspaceContextEngine,
    onReplyTask,
    onCopyTaskPrompt,
    onHideTask,
    onToggleTaskLock,
    onAbortTask,
    onInspectTask,
    onActiveTaskCardChange,
    onReviewTask,
    pendingCreatedAgents ?? [],
    agentCreationWarnings ?? {},
    emptyPersistedNodePositions,
    surfaceTheme,
    workspaceTaskCardFilters,
    handleWorkspaceTaskCardFilterChange,
    onCreateWorkspaceAgent,
    onAddWorkspaceModel,
    onSelectNode,
    openWorkspaceMenu,
    handleWorkspaceMenuChange
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
      accountTargets,
      accountAccessRules,
      relativeTimeReferenceMs,
      activeWorkspaceId,
      focusedAgentId,
      recentCreatedAgentId,
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
      onCreateTaskAgent,
      onEditAgent,
      onDeleteAgent,
      onFocusAgent,
      onConfigureAgentModel,
      onConfigureAgentCapabilities,
      onOpenAgentContextEngine,
      onRefresh,
      handleAgentConnectionMenuOpenChange,
      onInspectAgentDetail,
      onOpenWorkspaceChannels,
      onOpenAccounts,
      onOpenWorkspaceContextEngine,
      onReplyTask,
      onCopyTaskPrompt,
      onHideTask,
      onToggleTaskLock,
      onAbortTask,
      onInspectTask,
      onActiveTaskCardChange,
      onReviewTask,
      pendingCreatedAgents ?? [],
      agentCreationWarnings ?? {},
      persistedNodePositionsRef.current,
      surfaceTheme,
      workspaceTaskCardFilters,
      handleWorkspaceTaskCardFilterChange,
      onCreateWorkspaceAgent,
      onAddWorkspaceModel,
      onSelectNode,
      openWorkspaceMenu,
      handleWorkspaceMenuChange
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
    accountTargets,
    accountAccessRules,
    activeWorkspaceId,
    focusedAgentId,
    recentCreatedAgentId,
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
    onCreateTaskAgent,
    onEditAgent,
    onDeleteAgent,
    onFocusAgent,
    onConfigureAgentModel,
    onConfigureAgentCapabilities,
    onOpenAgentContextEngine,
    onRefresh,
    handleAgentConnectionMenuOpenChange,
    onInspectAgentDetail,
    onOpenWorkspaceChannels,
    onOpenAccounts,
    onOpenWorkspaceContextEngine,
    onReplyTask,
    onCopyTaskPrompt,
    onHideTask,
    onToggleTaskLock,
    onAbortTask,
    onInspectTask,
    onActiveTaskCardChange,
    onReviewTask,
    pendingCreatedAgents,
    agentCreationWarnings,
    surfaceTheme,
    workspaceTaskCardFilters,
    handleWorkspaceTaskCardFilterChange,
    onCreateWorkspaceAgent,
    onAddWorkspaceModel,
    onSelectNode,
    openWorkspaceMenu,
    handleWorkspaceMenuChange,
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
          isComposerActive,
          elevatedAgentMenuId
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
  }, [selectedNodeId, composerTargetAgentId, isComposerActive, elevatedAgentMenuId, setNodes]);

  const runSurfaceAnimationFrame = useCallback((time: number) => {
    surfaceAnimationFrameRef.current = null;
    const currentNodes = reactFlowRef.current?.getNodes();

    if (!currentNodes) {
      return;
    }

    const previousTime = surfaceAnimationPreviousTimeRef.current || time;
    const dtSeconds = Math.min(0.032, Math.max(0.008, (time - previousTime) / 1000));
    surfaceAnimationPreviousTimeRef.current = time;
    let shouldContinue = false;
    const surfacePositionUpdates = new Map<string, { x: number; y: number }>();
    const nodesById = new Map(currentNodes.map((node) => [node.id, node]));
    currentNodes.forEach((node) => {
      if (node.type !== "surface-module") {
        return;
      }

      const agentNode = nodesById.get(node.data.agent.id);
      if (!agentNode || agentNode.type !== "agent") {
        surfaceSpringVelocitiesRef.current.delete(node.id);
        return;
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
          return;
        }

        surfacePositionUpdates.set(node.id, targetPosition);
        return;
      }

      shouldContinue = true;
      surfaceSpringVelocitiesRef.current.set(node.id, springVelocity);

      if (
        Math.abs(nextPosition.position.x - node.position.x) < 0.001 &&
        Math.abs(nextPosition.position.y - node.position.y) < 0.001
      ) {
        return;
      }

      surfacePositionUpdates.set(node.id, nextPosition.position);
    });

    if (surfacePositionUpdates.size > 0) {
      setNodes((latestNodes) => mergeSurfaceModulePositions(latestNodes, surfacePositionUpdates));
    }

    if (shouldContinue) {
      surfaceAnimationFrameRef.current = window.requestAnimationFrame((nextTime) => {
        surfaceAnimationRunnerRef.current(nextTime);
      });
    }
  }, [setNodes]);

  useEffect(() => {
    surfaceAnimationRunnerRef.current = runSurfaceAnimationFrame;
  }, [runSurfaceAnimationFrame]);

  useEffect(() => {
    if (
      surfaceAnimationFrameRef.current !== null ||
      !nodes.some((node) => node.type === "surface-module")
    ) {
      return;
    }

    surfaceAnimationPreviousTimeRef.current = performance.now();
    surfaceAnimationFrameRef.current = window.requestAnimationFrame((time) => {
      surfaceAnimationRunnerRef.current(time);
    });
  }, [nodes]);

  useEffect(() => () => {
    if (surfaceAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(surfaceAnimationFrameRef.current);
      surfaceAnimationFrameRef.current = null;
    }
  }, []);

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
  }, [focusedAgentId, composerTargetAgentId, isComposerActive, composerViewportResetNonce, canvasScopeKey]);

  useEffect(() => {
    if (!recentDispatchId || handledDispatchIdsRef.current.has(recentDispatchId)) {
      return;
    }

    const resolvedTask = snapshot.tasks
      .filter(
        (task) =>
          !isTaskHidden(task, hiddenRuntimeIds, hiddenTaskKeys, lockedTaskKeys) &&
          !isSystemOwnedMonitorTask(task) &&
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
  }, [setCanvasZoom]);

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

  const adjustCanvasZoom = useCallback((delta: number) => {
    const reactFlow = reactFlowRef.current;

    if (!reactFlow) {
      return;
    }

    const nextZoom = Math.min(1.2, Math.max(0.42, reactFlow.getZoom() + delta));
    setCanvasZoom(nextZoom);
    void reactFlow.zoomTo(nextZoom, { duration: 180 });
  }, [setCanvasZoom]);

  const fitCanvasToView = useCallback(() => {
    const reactFlow = reactFlowRef.current;

    if (!reactFlow) {
      return;
    }

    void reactFlow.fitView({
      padding: focusedAgentId ? 0.2 : 0.14,
      duration: 260,
      maxZoom: focusedAgentId ? 1.05 : 0.9
    });
  }, [focusedAgentId]);

  const zoomPercent = Math.round(canvasZoom * 100);

  return (
    <div ref={containerRef} className={cn("relative h-full w-full", className)}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onInit={(instance) => {
          reactFlowRef.current = instance;
          setCanvasZoom(instance.getZoom());
        }}
        onMove={(_, viewport) => setCanvasZoom(viewport.zoom)}
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
      <div
        className={cn(
          "nodrag nopan absolute bottom-5 z-20 flex items-center overflow-hidden rounded-xl border p-1 shadow-[0_12px_30px_rgba(0,0,0,0.20)] backdrop-blur-xl transition-[left] duration-500",
          sidebarOpen
            ? "left-4 lg:left-[308px]"
            : "left-4 lg:left-[72px]",
          surfaceTheme === "light"
            ? "border-border bg-card/90 text-foreground"
            : "border-white/10 bg-slate-950/78 text-slate-100"
        )}
      >
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out"
          disabled={canvasZoom <= 0.42}
          onClick={() => adjustCanvasZoom(-0.1)}
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-35",
            surfaceTheme === "light" ? "hover:bg-muted" : "hover:bg-white/[0.09]"
          )}
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Fit canvas to view"
          title="Fit canvas to view"
          onClick={fitCanvasToView}
          className={cn(
            "flex h-8 min-w-12 items-center justify-center gap-1 rounded-lg px-2 text-[11px] font-semibold tabular-nums transition-colors",
            surfaceTheme === "light" ? "hover:bg-muted" : "hover:bg-white/[0.09]"
          )}
        >
          <Maximize2 className="h-3.5 w-3.5" />
          {zoomPercent}%
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in"
          disabled={canvasZoom >= 1.2}
          onClick={() => adjustCanvasZoom(0.1)}
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-35",
            surfaceTheme === "light" ? "hover:bg-muted" : "hover:bg-white/[0.09]"
          )}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
