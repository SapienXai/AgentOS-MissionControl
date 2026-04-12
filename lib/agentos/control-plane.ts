import "server-only";

import {
  abortMissionTask,
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
  getMissionControlSnapshot as getOpenClawMissionControlSnapshot,
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
  unbindWorkspaceChannelAgent,
  upsertWorkspaceChannel,
  bindWorkspaceChannelAgent
} from "@/lib/openclaw/service";

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
  unbindWorkspaceChannelAgent,
  upsertWorkspaceChannel
};

export type { ControlPlaneSnapshot } from "@/lib/agentos/contracts";
