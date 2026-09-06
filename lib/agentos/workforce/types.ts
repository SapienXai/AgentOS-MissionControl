import type { AttentionItem, MissionControlSnapshot, RuntimeCreatedFile } from "@/lib/agentos/contracts";

export type WorkforceMissionState =
  | "queued"
  | "starting"
  | "running"
  | "waiting-human"
  | "waiting-worker"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled"
  | "reconnecting";

export type WorkforceMissionSource = "agentos-dispatch" | "openclaw-task";

export type WorkforceRuntimeReference = {
  dispatchId: string | null;
  taskIds: string[];
  runtimeIds: string[];
  sessionIds: string[];
  runIds: string[];
};

export type WorkforceWorkerProjection = {
  id: string | null;
  name: string;
  state: WorkforceMissionState | "idle";
  activity: string;
  relationship: "primary" | "delegated";
  parentTaskId: string | null;
  taskId: string | null;
  runtimeId: string | null;
  startedAt: string | null;
  elapsedMs: number | null;
};

export type WorkforceWorkItem = {
  id: string;
  title: string;
  state: WorkforceMissionState | "idle";
  agentId: string | null;
  agentName: string;
  relationship: "primary" | "delegated";
  parentId: string | null;
  taskId: string | null;
  runtimeId: string | null;
  source: "openclaw-task" | "agentos-dispatch";
  startedAt: string | null;
  updatedAt: string | null;
};

export type WorkforceTimelineEvent = {
  id: string;
  at: string;
  kind: "created" | "assigned" | "started" | "delegated" | "completed" | "approval" | "blocked" | "failed" | "resumed" | "artifact" | "note";
  title: string;
  detail: string | null;
  workerLabel: string | null;
  source: "agentos" | "openclaw" | "human";
};

export type WorkforceArtifact = RuntimeCreatedFile & {
  id: string;
  category: "document" | "file" | "link" | "report" | "code-output" | "other";
  source: "openclaw-runtime";
  taskId: string | null;
  runtimeId: string | null;
};

export type WorkforceMissionActions = {
  canCancel: boolean;
  canResume: boolean;
  canOpenRuntime: boolean;
};

export type WorkforceMissionProjection = {
  id: string;
  title: string;
  goal: string;
  state: WorkforceMissionState;
  stateLabel: string;
  workspaceId: string | null;
  workspaceName: string | null;
  createdAt: string | null;
  submittedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string | null;
  durationMs: number | null;
  source: WorkforceMissionSource;
  primaryAgentId: string | null;
  primaryAgentName: string;
  dispatchId: string | null;
  rootTaskId: string | null;
  summary: string | null;
  result: string | null;
  error: string | null;
  connection: "live" | "reconnecting" | "unknown";
  activeWorkers: WorkforceWorkerProjection[];
  workTree: WorkforceWorkItem[];
  humanControlItems: AttentionItem[];
  timeline: WorkforceTimelineEvent[];
  artifacts: WorkforceArtifact[];
  runtime: WorkforceRuntimeReference;
  availableActions: WorkforceMissionActions;
};

export type WorkforceMissionListResponse = {
  missions: WorkforceMissionProjection[];
  summary: {
    needsYou: number;
    running: number;
    queued: number;
    completed: number;
    failed: number;
  };
  generatedAt: string;
  revision: number | null;
};

export type WorkforceMissionServiceInput = {
  snapshot?: MissionControlSnapshot;
  workspaceId?: string | null;
  search?: string | null;
  state?: WorkforceMissionState | null;
  agentId?: string | null;
  detail?: boolean;
};
