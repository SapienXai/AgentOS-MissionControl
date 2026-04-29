import type {
  AgentDetailFocus,
  AgentSurfaceBadge,
  CanvasEdge,
  CanvasNode,
  PersistedNodePositionMap
} from "@/components/mission-control/canvas-types";
import {
  resolveSurfaceActionAnchorPosition,
  resolveSurfaceModuleAnchorPosition,
  toSurfaceActionNodeId,
  toSurfaceTetherNodeId
} from "@/components/mission-control/canvas.motion";
import {
  resolvePersistedPosition,
  toLegacyPersistedAgentPositionKey,
  toLegacyPersistedTaskPositionKey,
  toPersistedAgentPositionKey,
  toPersistedTaskPositionKey
} from "@/components/mission-control/canvas.persistence";
import { getSurfaceCatalogEntry } from "@/lib/openclaw/surface-catalog";
import { resolveAgentModelLabel } from "@/lib/openclaw/presenters";
import type {
  MissionControlSnapshot,
  MissionControlSurfaceProvider,
  OpenClawAgent,
  TaskRecord
} from "@/lib/agentos/contracts";

export function buildCanvasGraph(
  snapshot: MissionControlSnapshot,
  relativeTimeReferenceMs: number,
  activeWorkspaceId: string | null,
  focusedAgentId: string | null,
  recentCreatedAgentId: string | null,
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

  const workspaceNodes: CanvasNode[] = [];
  const contentNodes: CanvasNode[] = [];
  const surfaceModuleNodes: CanvasNode[] = [];
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
      const modelLabel = resolveAgentModelLabel(agent.modelId, snapshot.models);
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
        zIndex:
          recentCreatedAgentId === agent.id
            ? 58
            : isComposerHighlightedAgent
              ? 55
              : isTaskFocusedAgent
                ? 48
                : activeTaskCount > 0
                  ? 24
                  : 10,
        selected: false,
        data: {
          agent,
          emphasis: isFocusMode ? true : !activeWorkspaceId || activeWorkspaceId === workspace.id,
          focused: focusedAgentId === agent.id,
          composerFocused: isComposerHighlightedAgent,
          taskFocused: isTaskFocusedAgent,
          creationPulse: recentCreatedAgentId === agent.id,
          activeTaskCount,
          chatOpen: isAgentChatOpen,
          relativeTimeReferenceMs,
          modelLabel,
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
            workspacePath: workspace.path,
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

export function buildEdgesForNodes(
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

export function buildSurfaceTetherEdges(
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

export function isTaskHidden(
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

export function resolveTaskOwnerId(task: TaskRecord) {
  return task.primaryAgentId || task.agentIds[0] || null;
}

export function isLiveTask(task: TaskRecord) {
  return task.status === "queued" || task.status === "running";
}

export function buildAgentSurfaceBadges(
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
