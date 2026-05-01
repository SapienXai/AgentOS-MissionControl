import "server-only";

import {
  clearMissionControlCaches,
  getMissionControlSnapshot as getOpenClawMissionControlSnapshot
} from "@/lib/openclaw/application/mission-control-service";
import { createAgent, deleteAgent, updateAgent } from "@/lib/openclaw/application/agent-service";
import {
  createWorkspaceProject,
  deleteWorkspaceProject,
  readWorkspaceEditSeed,
  updateWorkspaceProject
} from "@/lib/openclaw/application/workspace-service";
import { abortMissionTask, submitMission } from "@/lib/openclaw/application/mission-service";
import {
  ensureOpenClawRuntimeSmokeTest,
  ensureOpenClawRuntimeStateAccess,
  getRuntimeOutput,
  getTaskDetail,
  touchOpenClawRuntimeStateAccess
} from "@/lib/openclaw/application/runtime-service";
import {
  updateGatewayRemoteUrl,
  updateWorkspaceRoot
} from "@/lib/openclaw/application/settings-service";
import {
  bindWorkspaceChannelAgent,
  createManagedSurfaceAccount,
  createTelegramChannelAccount,
  deleteWorkspaceChannelEverywhere,
  disconnectWorkspaceChannel,
  discoverDiscordRoutes,
  discoverSurfaceRoutes,
  discoverTelegramGroups,
  getChannelRegistry,
  setWorkspaceChannelGroups,
  setWorkspaceChannelPrimary,
  unbindWorkspaceChannelAgent,
  upsertWorkspaceChannel
} from "@/lib/openclaw/application/channel-service";

import { normalizeControlPlaneSnapshot } from "@/lib/agentos/acl/openclaw";
import type { ControlPlaneSnapshot } from "@/lib/agentos/contracts";

export async function getControlPlaneSnapshot(
  options: { force?: boolean; includeHidden?: boolean } = {}
): Promise<ControlPlaneSnapshot> {
  const snapshot = await getOpenClawMissionControlSnapshot(options);
  return normalizeControlPlaneSnapshot(snapshot);
}

export const getMissionControlSnapshot = getControlPlaneSnapshot;

export {
  abortMissionTask,
  bindWorkspaceChannelAgent,
  clearMissionControlCaches,
  createAgent,
  createManagedSurfaceAccount,
  createTelegramChannelAccount,
  createWorkspaceProject,
  deleteAgent,
  deleteWorkspaceChannelEverywhere,
  deleteWorkspaceProject,
  disconnectWorkspaceChannel,
  discoverDiscordRoutes,
  discoverSurfaceRoutes,
  discoverTelegramGroups,
  ensureOpenClawRuntimeSmokeTest,
  ensureOpenClawRuntimeStateAccess,
  getChannelRegistry,
  getRuntimeOutput,
  getTaskDetail,
  readWorkspaceEditSeed,
  setWorkspaceChannelGroups,
  setWorkspaceChannelPrimary,
  submitMission,
  updateAgent,
  updateGatewayRemoteUrl,
  updateWorkspaceProject,
  updateWorkspaceRoot,
  touchOpenClawRuntimeStateAccess,
  unbindWorkspaceChannelAgent,
  upsertWorkspaceChannel
};

export type { ControlPlaneSnapshot } from "@/lib/agentos/contracts";
