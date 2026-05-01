import { resolveWorkspaceHealth, unique } from "@/lib/openclaw/domains/control-plane-normalization";
import type {
  OpenClawAgent,
  WorkspaceProject
} from "@/lib/openclaw/types";
import type { WorkspaceProjectManifest } from "@/lib/openclaw/domains/workspace-manifest";

export function buildWorkspaceProjectEntry(input: {
  workspace: WorkspaceProject;
  manifest: WorkspaceProjectManifest | null;
  metadata: Pick<WorkspaceProject, "bootstrap" | "capabilities">;
  allAgents: OpenClawAgent[];
}): WorkspaceProject {
  return {
    ...input.workspace,
    name: input.manifest?.name ?? input.workspace.name,
    modelIds: unique(input.workspace.modelIds),
    activeRuntimeIds: unique(input.workspace.activeRuntimeIds),
    health: resolveWorkspaceHealth(input.workspace.agentIds, input.allAgents),
    bootstrap: input.metadata.bootstrap,
    capabilities: input.metadata.capabilities,
    channels: input.workspace.channels ?? [],
    agentIds: input.workspace.agentIds,
    totalSessions: input.workspace.totalSessions
  };
}
