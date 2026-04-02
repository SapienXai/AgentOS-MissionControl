import type {
  ModelRecord,
  OpenClawAgent,
  RuntimeRecord,
  TaskRecord,
  WorkspaceProject
} from "@/lib/openclaw/types";

export type WorkspaceNodeData = Record<string, unknown> & {
  workspace: WorkspaceProject;
  emphasis: boolean;
  taskCardCount: number;
  taskCardsHidden: boolean;
  onToggleTaskCards?: () => void;
};

export type AgentDetailFocus = "skills" | "tools" | "sessions";

export type AgentNodeData = Record<string, unknown> & {
  agent: OpenClawAgent;
  emphasis: boolean;
  focused?: boolean;
  composerFocused?: boolean;
  relativeTimeReferenceMs: number;
  telegramTetherCount?: number;
  onMessage?: (agentId: string) => void;
  onEdit?: (agentId: string) => void;
  onDelete?: (agentId: string) => void;
  onFocus?: (agentId: string) => void;
  onConfigureCapabilities?: (agentId: string, focus: "skills" | "tools") => void;
  onInspect?: (agentId: string, focus: AgentDetailFocus) => void;
};

export type TelegramTetherNodeData = Record<string, unknown> & {
  agent: OpenClawAgent;
  emphasis: boolean;
  channelCount: number;
  channelNames: string[];
  telegramRoleLines: string[];
  telegramRoleTone: "primary" | "owner" | "delegate" | "mixed";
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

export type TaskNodeData = Record<string, unknown> & {
  task: TaskRecord;
  emphasis: boolean;
  relativeTimeReferenceMs: number;
  pendingCreation?: boolean;
  justCreated?: boolean;
  locked?: boolean;
  onInspect?: (task: TaskRecord, target: "overview" | "output" | "files") => void;
  onReply?: (task: TaskRecord) => void;
  onCopyPrompt?: (task: TaskRecord) => void;
  onHide?: (task: TaskRecord) => void;
  onToggleLock?: (task: TaskRecord) => void;
  onAbortTask?: (task: TaskRecord) => void;
};

export type ModelNodeData = Record<string, unknown> & {
  model: ModelRecord;
  emphasis: boolean;
};

export type MissionEdgeData = {
  composerFocused?: boolean;
  telegramTether?: boolean;
};
