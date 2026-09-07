export type DesktopSnapshotMode = "live" | "degraded" | "offline";

export type DesktopAgentStatus = "working" | "idle" | "ready" | "blocked" | "offline";

export type DesktopMissionStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "cancelled"
  | "unknown";

export type ExecutionTargetStatus = "ready" | "offline" | "degraded" | "unknown";

export type ExecutionTarget = {
  id: string;
  label: string;
  runtimeId: string;
  location: "local" | "remote" | "cloud";
  status: ExecutionTargetStatus;
  capabilities: {
    filesystem: boolean;
    terminal: boolean;
    browser: boolean;
    memory: boolean;
    skills: boolean;
    multiAgent: boolean;
  };
};

export type DesktopAgent = {
  id: string;
  name: string;
  workspacePath: string | null;
  modelId: string | null;
  status: DesktopAgentStatus;
  currentAction: string | null;
  runtimeId: string;
  executionTargetId: string;
  updatedAt: string | null;
};

export type DesktopMission = {
  id: string;
  title: string;
  summary: string | null;
  status: DesktopMissionStatus;
  agentId: string | null;
  agentName: string | null;
  runtimeId: string;
  executionTargetId: string;
  updatedAt: string | null;
};

export type DesktopApproval = {
  id: string;
  title: string;
  summary: string | null;
  agentId: string | null;
  missionId: string | null;
  status: "pending";
  runtimeId: string;
};

export type DesktopActivity = {
  id: string;
  title: string;
  detail: string | null;
  kind: "session" | "task" | "system";
  agentId: string | null;
  runtimeId: string;
  updatedAt: string | null;
};

export type DesktopModel = {
  id: string;
  name: string;
  provider: string;
  local: boolean | null;
  available: boolean | null;
  tags: string[];
};

export type DesktopSkill = {
  id: string;
  name: string;
  description: string | null;
  available: boolean;
};

export type DesktopMemoryStatus = {
  available: boolean;
  indexedFiles: number;
  dirty: boolean;
  reason: string | null;
};

export type DesktopConnection = {
  id: string;
  name: string;
  type: string;
  status: "connected" | "configured" | "offline" | "unknown";
  detail: string | null;
};

export type DesktopConnectivity = {
  cliInstalled: boolean;
  gatewayReachable: boolean | null;
  gatewayReady: boolean | null;
  reason: string | null;
};

export type DesktopProductSnapshot = {
  generatedAt: string;
  source: "openclaw-cli";
  mode: DesktopSnapshotMode;
  reason: string | null;
  issues: string[];
  agents: DesktopAgent[];
  missions: DesktopMission[];
  approvals: DesktopApproval[];
  activity: DesktopActivity[];
  models: DesktopModel[];
  skills: DesktopSkill[];
  memory: DesktopMemoryStatus;
  executionTargets: ExecutionTarget[];
  connections: DesktopConnection[];
  connectivity: DesktopConnectivity;
};

export type DesktopPreferences = {
  onboardingCompleted: boolean;
  closeToTray: boolean;
  notificationsEnabled: boolean;
  startRuntimeOnLaunch: boolean;
};
