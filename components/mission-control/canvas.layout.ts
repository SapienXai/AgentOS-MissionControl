import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import type { CanvasNode, FocusTaskAnchor } from "@/components/mission-control/canvas-types";

const justCreatedTaskDurationMs = 12000;

export function mergeNodePositions(previousNodes: CanvasNode[], nextNodes: CanvasNode[]) {
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

export function resolveNodeZIndex(
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

export function markTaskAsJustCreated(
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
