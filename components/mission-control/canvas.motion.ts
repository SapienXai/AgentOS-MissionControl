import type {
  AgentSurfaceBadge,
  PersistedNodePosition,
  SpringVelocity
} from "@/components/mission-control/canvas-types";
import type { OpenClawAgent } from "@/lib/agentos/contracts";

const surfaceModuleSpringStiffness = 220;
const surfaceModuleSpringDamping = 20;
const surfaceModuleSettlingThreshold = 0.35;

export function toSurfaceTetherNodeId(agent: OpenClawAgent, provider: AgentSurfaceBadge["provider"]) {
  return `surface-module-v1:${agent.workspaceId}:${agent.id}:${provider}`;
}

export function toSurfaceActionNodeId(agent: OpenClawAgent) {
  return `surface-add-v1:${agent.workspaceId}:${agent.id}`;
}

export function resolveSurfaceModuleAnchorPosition(
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

export function resolveSurfaceActionAnchorPosition(
  agentPosition: PersistedNodePosition,
  surfaceCount: number,
  agentWidth = 212,
  agentHeight = 220
) {
  return resolveSurfaceModuleAnchorPosition(agentPosition, 0, surfaceCount + 1, agentWidth, agentHeight);
}

export function stepSurfaceModuleSpring(
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
