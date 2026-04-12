export type * from "@/lib/openclaw/types";

import type {
  ChannelAccountRecord,
  MissionControlSnapshot,
  OpenClawAgent,
  WorkspaceChannelSummary,
  WorkspaceChannelWorkspaceBinding,
  WorkspaceProject
} from "@/lib/openclaw/types";

export type ControlPlaneSnapshot = MissionControlSnapshot;
export type AgentRecord = OpenClawAgent;
export type WorkspaceRecord = WorkspaceProject;
export type SurfaceAccountRecord = ChannelAccountRecord;
export type SurfaceChannelRecord = WorkspaceChannelSummary;
export type SurfaceBindingRecord = WorkspaceChannelWorkspaceBinding;
