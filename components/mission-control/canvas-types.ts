import type {
  ModelRecord,
  OpenClawAgent,
  RuntimeRecord,
  WorkspaceProject
} from "@/lib/openclaw/types";

export type WorkspaceNodeData = Record<string, unknown> & {
  workspace: WorkspaceProject;
  emphasis: boolean;
};

export type AgentNodeData = Record<string, unknown> & {
  agent: OpenClawAgent;
  emphasis: boolean;
  onEdit?: (agentId: string) => void;
  onDelete?: (agentId: string) => void;
};

export type RuntimeNodeData = Record<string, unknown> & {
  runtime: RuntimeRecord;
  emphasis: boolean;
  pendingCreation?: boolean;
  justCreated?: boolean;
  onReply?: (runtime: RuntimeRecord) => void;
  onCopyPrompt?: (runtime: RuntimeRecord) => void;
  onHide?: (runtimeId: string) => void;
};

export type ModelNodeData = Record<string, unknown> & {
  model: ModelRecord;
  emphasis: boolean;
};
