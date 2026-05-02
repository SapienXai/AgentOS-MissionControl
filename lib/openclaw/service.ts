import "server-only";

import {
  createAgent as createAgentFromApplication,
  deleteAgent as deleteAgentFromApplication,
  updateAgent as updateAgentFromApplication
} from "@/lib/openclaw/application/agent-service";
import {
  bindWorkspaceChannelAgent as bindWorkspaceChannelAgentFromApplication,
  createManagedChatChannelAccount as createManagedChatChannelAccountFromApplication,
  createManagedSurfaceAccount as createManagedSurfaceAccountFromApplication,
  createTelegramChannelAccount as createTelegramChannelAccountFromApplication,
  deleteWorkspaceChannelEverywhere as deleteWorkspaceChannelEverywhereFromApplication,
  disconnectWorkspaceChannel as disconnectWorkspaceChannelFromApplication,
  setWorkspaceChannelGroups as setWorkspaceChannelGroupsFromApplication,
  setWorkspaceChannelPrimary as setWorkspaceChannelPrimaryFromApplication,
  unbindWorkspaceChannelAgent as unbindWorkspaceChannelAgentFromApplication,
  upsertWorkspaceChannel as upsertWorkspaceChannelFromApplication
} from "@/lib/openclaw/application/channel-service";
import {
  createWorkspaceProject as createWorkspaceProjectFromApplication,
  deleteWorkspaceProject as deleteWorkspaceProjectFromApplication,
  readWorkspaceEditSeed as readWorkspaceEditSeedFromApplication,
  updateWorkspaceProject as updateWorkspaceProjectFromApplication
} from "@/lib/openclaw/application/workspace-service";
import {
  abortMissionTask as abortMissionTaskFromApplication,
  submitMission as submitMissionFromApplication
} from "@/lib/openclaw/application/mission-service";
import {
  updateGatewayRemoteUrl as updateGatewayRemoteUrlFromApplication,
  updateWorkspaceRoot as updateWorkspaceRootFromApplication
} from "@/lib/openclaw/application/settings-service";
import {
  clearMissionControlCaches as clearMissionControlCachesFromApplication,
  getMissionControlSnapshot as getMissionControlSnapshotFromApplication
} from "@/lib/openclaw/application/mission-control-service";
import {
  ensureOpenClawRuntimeSmokeTest as ensureOpenClawRuntimeSmokeTestFromApplication,
  ensureOpenClawRuntimeStateAccess as ensureOpenClawRuntimeStateAccessFromApplication,
  getRuntimeOutput as getRuntimeOutputFromApplication,
  getTaskDetail as getTaskDetailFromApplication,
  touchOpenClawRuntimeStateAccess as touchOpenClawRuntimeStateAccessFromApplication
} from "@/lib/openclaw/application/runtime-service";
import {
  renderAgentsMarkdown as renderAgentsMarkdownFromDomain,
  renderArchitectureMarkdown as renderArchitectureMarkdownFromDomain,
  renderBlueprintMarkdown as renderBlueprintMarkdownFromDomain,
  renderBriefMarkdown as renderBriefMarkdownFromDomain,
  renderDecisionsMarkdown as renderDecisionsMarkdownFromDomain,
  renderDeliverablesMarkdown as renderDeliverablesMarkdownFromDomain,
  renderHeartbeatMarkdown as renderHeartbeatMarkdownFromDomain,
  renderIdentityMarkdown as renderIdentityMarkdownFromDomain,
  renderMemoryMarkdown as renderMemoryMarkdownFromDomain,
  renderSoulMarkdown as renderSoulMarkdownFromDomain,
  renderTemplateSpecificDoc as renderTemplateSpecificDocFromDomain,
  renderToolsMarkdown as renderToolsMarkdownFromDomain
} from "@/lib/openclaw/domains/workspace-document-renderers";
import {
  discoverDiscordRoutes,
  discoverSurfaceRoutes,
  discoverTelegramGroups,
  getChannelRegistry
} from "@/lib/openclaw/domains/channels";
import type { TimingCollector } from "@/lib/openclaw/timing";
import type {
  AgentCreateInput,
  AgentDeleteInput,
  OperationProgressSnapshot,
  AgentUpdateInput,
  MissionAbortResponse,
  MissionResponse,
  MissionSubmission,
  WorkspaceAgentBlueprintInput,
  WorkspaceCreateResult,
  WorkspaceCreateRules,
  WorkspaceDeleteInput,
  WorkspaceCreateInput,
  WorkspaceEditSeed,
  WorkspaceSourceMode,
  WorkspaceTemplate,
  WorkspaceUpdateInput,
  MissionControlSurfaceProvider,
  WorkspaceChannelGroupAssignment
} from "@/lib/openclaw/types";

export { inferSessionKindFromCatalogEntry } from "@/lib/openclaw/domains/session-catalog";

export { inferFallbackModelMetadata } from "@/lib/openclaw/adapter/model-adapter";

export { discoverDiscordRoutes, discoverSurfaceRoutes, discoverTelegramGroups, getChannelRegistry };

// Compatibility exports: new code should prefer application services, the adapter,
// or client layer directly. Keep this module stable until legacy imports are removed.
type WorkspaceCreateOptions = {
  onProgress?: (snapshot: OperationProgressSnapshot) => Promise<void> | void;
};

export function clearMissionControlCaches() {
  return clearMissionControlCachesFromApplication();
}

export async function getMissionControlSnapshot(options: { force?: boolean; includeHidden?: boolean } = {}) {
  return getMissionControlSnapshotFromApplication(options);
}

export async function ensureOpenClawRuntimeStateAccess(options: {
  agentId?: string | null;
} = {}) {
  return ensureOpenClawRuntimeStateAccessFromApplication(options);
}

export async function touchOpenClawRuntimeStateAccess(options: {
  agentId?: string | null;
} = {}) {
  return touchOpenClawRuntimeStateAccessFromApplication(options);
}

export async function ensureOpenClawRuntimeSmokeTest(options: {
  agentId?: string | null;
  force?: boolean;
} = {}) {
  return ensureOpenClawRuntimeSmokeTestFromApplication(options);
}

export async function submitMission(input: MissionSubmission): Promise<MissionResponse> {
  return submitMissionFromApplication(input);
}

export async function abortMissionTask(
  taskId: string,
  reason?: string | null,
  dispatchId?: string | null
): Promise<MissionAbortResponse> {
  return abortMissionTaskFromApplication(taskId, reason, dispatchId);
}

export async function getRuntimeOutput(runtimeId: string) {
  return getRuntimeOutputFromApplication(runtimeId);
}

export async function getTaskDetail(
  taskId: string,
  options: {
    dispatchId?: string | null;
  } = {}
) {
  return getTaskDetailFromApplication(taskId, options);
}

export async function createAgent(input: AgentCreateInput) {
  return createAgentFromApplication(input);
}

export async function updateAgent(input: AgentUpdateInput) {
  return updateAgentFromApplication(input);
}

export async function deleteAgent(input: AgentDeleteInput) {
  return deleteAgentFromApplication(input);
}

export async function upsertWorkspaceChannel(input: {
  workspaceId: string;
  workspacePath: string;
  channelId: string;
  type: MissionControlSurfaceProvider;
  name: string;
  primaryAgentId?: string | null;
  agentIds?: string[];
  groupAssignments?: WorkspaceChannelGroupAssignment[];
}, timings?: TimingCollector) {
  return upsertWorkspaceChannelFromApplication(input, timings);
}

export async function disconnectWorkspaceChannel(input: {
  workspaceId: string;
  channelId: string;
}, timings?: TimingCollector) {
  return disconnectWorkspaceChannelFromApplication(input, timings);
}

export async function deleteWorkspaceChannelEverywhere(input: {
  channelId: string;
}, timings?: TimingCollector) {
  return deleteWorkspaceChannelEverywhereFromApplication(input, timings);
}

export async function setWorkspaceChannelPrimary(input: {
  channelId: string;
  primaryAgentId: string | null;
}, timings?: TimingCollector) {
  return setWorkspaceChannelPrimaryFromApplication(input, timings);
}

export async function setWorkspaceChannelGroups(input: {
  channelId: string;
  workspaceId: string;
  groupAssignments: WorkspaceChannelGroupAssignment[];
}, timings?: TimingCollector) {
  return setWorkspaceChannelGroupsFromApplication(input, timings);
}

export async function bindWorkspaceChannelAgent(input: {
  channelId: string;
  workspaceId: string;
  workspacePath: string;
  agentId: string;
}, timings?: TimingCollector) {
  return bindWorkspaceChannelAgentFromApplication(input, timings);
}

export async function unbindWorkspaceChannelAgent(input: {
  channelId: string;
  workspaceId: string;
  agentId: string;
}, timings?: TimingCollector) {
  return unbindWorkspaceChannelAgentFromApplication(input, timings);
}

export async function createWorkspaceProject(
  input: WorkspaceCreateInput,
  options: WorkspaceCreateOptions = {}
): Promise<WorkspaceCreateResult> {
  return createWorkspaceProjectFromApplication(input, options);
}

export async function updateWorkspaceProject(input: WorkspaceUpdateInput) {
  return updateWorkspaceProjectFromApplication(input);
}

export async function deleteWorkspaceProject(input: WorkspaceDeleteInput) {
  return deleteWorkspaceProjectFromApplication(input);
}

export async function updateGatewayRemoteUrl(input: { gatewayUrl?: string | null }) {
  return updateGatewayRemoteUrlFromApplication(input);
}

export async function updateWorkspaceRoot(input: { workspaceRoot?: string | null }) {
  return updateWorkspaceRootFromApplication(input);
}

export function renderAgentsMarkdown(params: {
  name: string;
  brief?: string;
  template: WorkspaceTemplate;
  sourceMode: WorkspaceSourceMode;
  agents: WorkspaceAgentBlueprintInput[];
  rules: WorkspaceCreateRules;
}) {
  return renderAgentsMarkdownFromDomain(params);
}

export function renderSoulMarkdown(template: WorkspaceTemplate, brief?: string) {
  return renderSoulMarkdownFromDomain(template, brief);
}

export function renderIdentityMarkdown(template: WorkspaceTemplate) {
  return renderIdentityMarkdownFromDomain(template);
}

export function renderToolsMarkdown(template: WorkspaceTemplate, toolExamples: string[]) {
  return renderToolsMarkdownFromDomain(template, toolExamples);
}

export function renderHeartbeatMarkdown(template: WorkspaceTemplate) {
  return renderHeartbeatMarkdownFromDomain(template);
}

export function renderMemoryMarkdown(name: string, template: WorkspaceTemplate, brief?: string) {
  return renderMemoryMarkdownFromDomain(name, template, brief);
}

export function renderBlueprintMarkdown(name: string, template: WorkspaceTemplate, brief?: string) {
  return renderBlueprintMarkdownFromDomain(name, template, brief);
}

export function renderDecisionsMarkdown() {
  return renderDecisionsMarkdownFromDomain();
}

export function renderBriefMarkdown(
  name: string,
  template: WorkspaceTemplate,
  brief: string | undefined,
  sourceMode: WorkspaceSourceMode
) {
  return renderBriefMarkdownFromDomain(name, template, brief, sourceMode);
}

export function renderArchitectureMarkdown(template: WorkspaceTemplate) {
  return renderArchitectureMarkdownFromDomain(template);
}

export function renderDeliverablesMarkdown() {
  return renderDeliverablesMarkdownFromDomain();
}

export function renderTemplateSpecificDoc(kind: "ux" | "backend" | "research" | "content") {
  return renderTemplateSpecificDocFromDomain(kind);
}

export async function readWorkspaceEditSeed(workspaceId: string): Promise<WorkspaceEditSeed> {
  return readWorkspaceEditSeedFromApplication(workspaceId);
}

export async function createManagedChatChannelAccount(...args: Parameters<typeof createManagedChatChannelAccountFromApplication>) {
  return createManagedChatChannelAccountFromApplication(...args);
}

export async function createManagedSurfaceAccount(...args: Parameters<typeof createManagedSurfaceAccountFromApplication>) {
  return createManagedSurfaceAccountFromApplication(...args);
}

export async function createTelegramChannelAccount(...args: Parameters<typeof createTelegramChannelAccountFromApplication>) {
  return createTelegramChannelAccountFromApplication(...args);
}
