import "server-only";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  clearMissionControlRuntimeHistoryCache,
  getMissionControlSnapshot,
  invalidateMissionControlSnapshotCache
} from "@/lib/openclaw/application/mission-control-service";
import {
  normalizeGatewayRemoteUrl,
  normalizeWorkspaceRoot,
  readMissionControlSettings,
  writeMissionControlSettings
} from "@/lib/openclaw/domains/control-plane-settings";

const GATEWAY_REMOTE_URL_CONFIG_KEY = "gateway.remote.url";

function invalidateSettingsSnapshot() {
  invalidateMissionControlSnapshotCache();
  clearMissionControlRuntimeHistoryCache();
}

export async function updateGatewayRemoteUrl(input: { gatewayUrl?: string | null }) {
  const gatewayUrl = normalizeGatewayRemoteUrl(input.gatewayUrl);

  if (gatewayUrl) {
    await getOpenClawAdapter().setConfig(GATEWAY_REMOTE_URL_CONFIG_KEY, gatewayUrl);
  } else if (await getOpenClawAdapter().hasConfig(GATEWAY_REMOTE_URL_CONFIG_KEY)) {
    await getOpenClawAdapter().unsetConfig(GATEWAY_REMOTE_URL_CONFIG_KEY);
  }

  invalidateSettingsSnapshot();

  return getMissionControlSnapshot({ force: true });
}

export async function updateWorkspaceRoot(input: { workspaceRoot?: string | null }) {
  const workspaceRoot = normalizeWorkspaceRoot(input.workspaceRoot);
  const settings = await readMissionControlSettings();

  await writeMissionControlSettings({
    ...(workspaceRoot ? { workspaceRoot } : {}),
    ...(settings.runtimePreflight ? { runtimePreflight: settings.runtimePreflight } : {})
  });

  invalidateSettingsSnapshot();

  return getMissionControlSnapshot({ force: true });
}
