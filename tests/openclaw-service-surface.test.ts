import assert from "node:assert/strict";
import { test } from "node:test";

import * as openClawService from "@/lib/openclaw/service";

test("OpenClaw service compatibility surface stays explicit", () => {
  const expectedExports = [
    "abortMissionTask",
    "bindWorkspaceChannelAgent",
    "clearMissionControlCaches",
    "createAgent",
    "createManagedChatChannelAccount",
    "createManagedSurfaceAccount",
    "createTelegramChannelAccount",
    "createWorkspaceProject",
    "deleteAgent",
    "deleteWorkspaceChannelEverywhere",
    "deleteWorkspaceProject",
    "disconnectWorkspaceChannel",
    "discoverDiscordRoutes",
    "discoverSurfaceRoutes",
    "discoverTelegramGroups",
    "ensureOpenClawRuntimeSmokeTest",
    "ensureOpenClawRuntimeStateAccess",
    "getChannelRegistry",
    "getMissionControlSnapshot",
    "getRuntimeOutput",
    "getTaskDetail",
    "inferFallbackModelMetadata",
    "inferSessionKindFromCatalogEntry",
    "readWorkspaceEditSeed",
    "renderAgentsMarkdown",
    "renderArchitectureMarkdown",
    "renderBlueprintMarkdown",
    "renderBriefMarkdown",
    "renderDecisionsMarkdown",
    "renderDeliverablesMarkdown",
    "renderHeartbeatMarkdown",
    "renderIdentityMarkdown",
    "renderMemoryMarkdown",
    "renderSoulMarkdown",
    "renderTemplateSpecificDoc",
    "renderToolsMarkdown",
    "setWorkspaceChannelGroups",
    "setWorkspaceChannelPrimary",
    "submitMission",
    "touchOpenClawRuntimeStateAccess",
    "unbindWorkspaceChannelAgent",
    "updateAgent",
    "updateGatewayRemoteUrl",
    "updateWorkspaceProject",
    "updateWorkspaceRoot",
    "upsertWorkspaceChannel"
  ];

  assert.deepEqual(Object.keys(openClawService).sort(), expectedExports.sort());
});
