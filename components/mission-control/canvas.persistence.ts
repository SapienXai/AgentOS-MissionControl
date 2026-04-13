import type {
  CanvasNode,
  PersistedNodePosition,
  PersistedNodePositionMap
} from "@/components/mission-control/canvas-types";
import type { OpenClawAgent, TaskRecord } from "@/lib/agentos/contracts";

export const emptyPersistedNodePositions: PersistedNodePositionMap = {};

const nodePositionsStorageKey = "mission-control-node-positions:v2";
const legacyNodePositionsStorageKey = "mission-control-node-positions";

export function readPersistedNodePositions(scopeKey: string) {
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

export function extractPersistedNodePositions(nodes: CanvasNode[]) {
  return Object.fromEntries(
    nodes
      .filter(isPersistableCanvasNode)
      .map((node) => [
        resolveNodePersistedPositionKey(node),
        {
          x: node.position.x,
          y: node.position.y
        }
      ])
  ) as PersistedNodePositionMap;
}

export function arePersistedNodePositionsEqual(
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

export function parsePersistedNodePositions(raw: string) {
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

export function getNodePositionsStorageKey(scopeKey: string) {
  return `${nodePositionsStorageKey}:${scopeKey}`;
}

export function resolvePersistedPosition(
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

type PersistableCanvasNode = Extract<CanvasNode, { type: "agent" | "task" }>;

function isPersistableCanvasNode(node: CanvasNode): node is PersistableCanvasNode {
  return node.type === "agent" || node.type === "task";
}

export function resolveNodePersistedPositionKey(node: PersistableCanvasNode) {
  if (node.type === "agent") {
    return toPersistedAgentPositionKey(node.data.agent);
  }

  return toPersistedTaskPositionKey(node.data.task);
}

export function toPersistedAgentPositionKey(agent: OpenClawAgent) {
  return `agent:${agent.workspaceId}:${agent.id}`;
}

export function toLegacyPersistedAgentPositionKey(agentId: string) {
  return `agent:${agentId}`;
}

export function toPersistedTaskPositionKey(task: TaskRecord) {
  return `task:${task.workspaceId || "global"}:${task.key}`;
}

export function toLegacyPersistedTaskPositionKey(taskId: string) {
  return `task:${taskId}`;
}

export function readFromLocalStorage(key: string) {
  const storage = globalThis.localStorage;

  if (!storage || typeof storage.getItem !== "function") {
    return null;
  }

  return storage.getItem(key);
}

export function writeToLocalStorage(key: string, value: string) {
  const storage = globalThis.localStorage;

  if (!storage || typeof storage.setItem !== "function") {
    return;
  }

  storage.setItem(key, value);
}
