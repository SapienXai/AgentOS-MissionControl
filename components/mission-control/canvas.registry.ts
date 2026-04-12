import { MissionConnectionEdge } from "@/components/mission-control/edges/mission-connection-edge";
import { AgentNode } from "@/components/mission-control/nodes/agent-node";
import { SurfaceTetherNode } from "@/components/mission-control/nodes/surface-tether-node";
import { TaskNode } from "@/components/mission-control/nodes/task-node";
import { WorkspaceNode } from "@/components/mission-control/nodes/workspace-node";

export const nodeTypes = {
  workspace: WorkspaceNode,
  agent: AgentNode,
  "surface-module": SurfaceTetherNode,
  task: TaskNode
};

export const edgeTypes = {
  simplebezier: MissionConnectionEdge
};
