import type { Edge, Node } from "@xyflow/react";

import type {
  MissionControlSurfaceProvider,
  ModelRecord,
  OpenClawAgent,
  RuntimeRecord,
  TaskRecord,
  WorkspaceProject
} from "@/lib/agentos/contracts";

export type WorkspaceNodeData = Record<string, unknown> & {
  workspace: WorkspaceProject;
  emphasis: boolean;
  taskCardCount: number;
  taskCardsHidden: boolean;
  onToggleTaskCards?: () => void;
};

export type AgentDetailFocus = "skills" | "tools" | "sessions";

export type AgentSurfaceBadge = {
  provider: MissionControlSurfaceProvider;
  label: string;
  count: number;
  roleLabel: string;
  roleTone?: "primary" | "owner" | "delegate" | "mixed";
  accentColor?: string | null;
  surfaceNames?: string[];
};

export type AgentNodeData = Record<string, unknown> & {
  agent: OpenClawAgent;
  modelLabel: string;
  emphasis: boolean;
  focused?: boolean;
  composerFocused?: boolean;
  taskFocused?: boolean;
  creationPulse?: boolean;
  activeTaskCount?: number;
  chatOpen?: boolean;
  relativeTimeReferenceMs: number;
  surfaceBadges?: AgentSurfaceBadge[];
  onMessage?: (agentId: string) => void;
  onEdit?: (agentId: string) => void;
  onDelete?: (agentId: string) => void;
  onFocus?: (agentId: string) => void;
  onConfigureModel?: (agentId: string) => void;
  onConfigureCapabilities?: (agentId: string, focus: "skills" | "tools") => void;
  onInspect?: (agentId: string, focus: AgentDetailFocus) => void;
  onOpenWorkspaceChannels?: (workspaceId?: string) => void;
};

export type SurfaceTetherNodeData = Record<string, unknown> & {
  agent: OpenClawAgent;
  emphasis: boolean;
  provider: MissionControlSurfaceProvider;
  label: string;
  variant?: "surface" | "add";
  anchorIndex: number;
  anchorCount: number;
  surfaceCount: number;
  surfaceNames: string[];
  roleLabel: string;
  roleTone: "primary" | "owner" | "delegate" | "mixed";
  accentColor?: string | null;
  actionLabel?: string;
  onClick?: () => void;
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
  workspacePath?: string;
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
  taskFocused?: boolean;
  surfaceTether?: boolean;
  surfaceAccentColor?: string | null;
};

type WorkspaceCanvasNode = Node<WorkspaceNodeData, "workspace">;
type AgentCanvasNode = Node<AgentNodeData, "agent">;
type SurfaceTetherCanvasNode = Node<SurfaceTetherNodeData, "surface-module">;
type TaskCanvasNode = Node<TaskNodeData, "task">;

export type CanvasEdge = Edge<MissionEdgeData, "simplebezier">;
export type CanvasNode = WorkspaceCanvasNode | AgentCanvasNode | SurfaceTetherCanvasNode | TaskCanvasNode;
export type PersistedNodePosition = {
  x: number;
  y: number;
};
export type SpringVelocity = {
  x: number;
  y: number;
};
export type PersistedNodePositionMap = Record<string, PersistedNodePosition>;
export type FocusTaskAnchor = {
  taskId: string;
  agentId: string | null;
};
