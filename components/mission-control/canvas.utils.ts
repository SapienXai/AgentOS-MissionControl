import { edgeTypes, nodeTypes } from "@/components/mission-control/canvas.registry";
import {
  arePersistedNodePositionsEqual,
  emptyPersistedNodePositions,
  extractPersistedNodePositions,
  getNodePositionsStorageKey,
  parsePersistedNodePositions,
  readPersistedNodePositions,
  readFromLocalStorage,
  resolveNodePersistedPositionKey,
  resolvePersistedPosition,
  toLegacyPersistedAgentPositionKey,
  toLegacyPersistedTaskPositionKey,
  toPersistedAgentPositionKey,
  toPersistedTaskPositionKey,
  writeToLocalStorage
} from "@/components/mission-control/canvas.persistence";
import {
  resolveSurfaceActionAnchorPosition,
  resolveSurfaceModuleAnchorPosition,
  stepSurfaceModuleSpring,
  toSurfaceActionNodeId,
  toSurfaceTetherNodeId
} from "@/components/mission-control/canvas.motion";
import {
  markTaskAsJustCreated,
  mergeNodePositions,
  resolveNodeZIndex
} from "@/components/mission-control/canvas.layout";
export type {
  CanvasEdge,
  CanvasNode,
  PersistedNodePosition,
  PersistedNodePositionMap,
  SpringVelocity,
  FocusTaskAnchor
} from "@/components/mission-control/canvas-types";
export {
  buildAgentSurfaceBadges,
  buildCanvasGraph,
  buildEdgesForNodes,
  buildSurfaceTetherEdges,
  isLiveTask,
  isTaskHidden,
  resolveTaskOwnerId
} from "@/components/mission-control/canvas.graph";

export {
  edgeTypes,
  nodeTypes,
  emptyPersistedNodePositions,
  arePersistedNodePositionsEqual,
  extractPersistedNodePositions,
  getNodePositionsStorageKey,
  parsePersistedNodePositions,
  readPersistedNodePositions,
  readFromLocalStorage,
  markTaskAsJustCreated,
  mergeNodePositions,
  resolveNodePersistedPositionKey,
  resolvePersistedPosition,
  resolveNodeZIndex,
  resolveSurfaceActionAnchorPosition,
  resolveSurfaceModuleAnchorPosition,
  stepSurfaceModuleSpring,
  toLegacyPersistedAgentPositionKey,
  toLegacyPersistedTaskPositionKey,
  toPersistedAgentPositionKey,
  toPersistedTaskPositionKey,
  toSurfaceActionNodeId,
  toSurfaceTetherNodeId,
  writeToLocalStorage
};
