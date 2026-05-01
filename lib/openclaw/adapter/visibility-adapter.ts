import type {
  OpenClawAgent,
  RelationshipRecord,
  RuntimeRecord,
  WorkspaceProject
} from "@/lib/openclaw/types";

export function buildVisibleSnapshotCollections(input: {
  workspaces: WorkspaceProject[];
  agents: OpenClawAgent[];
  runtimes: RuntimeRecord[];
  relationships: RelationshipRecord[];
  isWorkspaceHidden: (workspace: WorkspaceProject) => boolean;
}) {
  const hiddenWorkspaceIds = new Set(
    input.workspaces
      .filter((workspace) => input.isWorkspaceHidden(workspace))
      .map((workspace) => workspace.id)
  );
  const visibleAgents = input.agents.filter((agent) => !hiddenWorkspaceIds.has(agent.workspaceId));
  const hiddenAgentIds = new Set(
    input.agents
      .filter((agent) => hiddenWorkspaceIds.has(agent.workspaceId))
      .map((agent) => agent.id)
  );
  const visibleRuntimes = input.runtimes.filter(
    (runtime) =>
      !(runtime.agentId && hiddenAgentIds.has(runtime.agentId)) &&
      !(runtime.workspaceId && hiddenWorkspaceIds.has(runtime.workspaceId))
  );
  const hiddenRuntimeIds = new Set(
    input.runtimes
      .filter(
        (runtime) =>
          (runtime.agentId && hiddenAgentIds.has(runtime.agentId)) ||
          (runtime.workspaceId && hiddenWorkspaceIds.has(runtime.workspaceId))
      )
      .map((runtime) => runtime.id)
  );
  const hiddenNodeIds = new Set<string>([
    ...hiddenWorkspaceIds,
    ...hiddenAgentIds,
    ...hiddenRuntimeIds
  ]);
  const visibleRelationships = input.relationships.filter(
    (relationship) =>
      !hiddenNodeIds.has(relationship.sourceId) &&
      !hiddenNodeIds.has(relationship.targetId)
  );
  const visibleWorkspaces = input.workspaces.filter((workspace) => !hiddenWorkspaceIds.has(workspace.id));

  return {
    visibleWorkspaces,
    visibleAgents,
    visibleRuntimes,
    visibleRelationships
  };
}
