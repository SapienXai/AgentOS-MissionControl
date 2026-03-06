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
};

export type RuntimeNodeData = Record<string, unknown> & {
  runtime: RuntimeRecord;
  emphasis: boolean;
  pendingCreation?: boolean;
  onReply?: (runtime: RuntimeRecord) => void;
  onCopyPrompt?: (runtime: RuntimeRecord) => void;
  onHide?: (runtimeId: string) => void;
};

export type ModelNodeData = Record<string, unknown> & {
  model: ModelRecord;
  emphasis: boolean;
};
