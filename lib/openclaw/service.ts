import "server-only";

import path from "node:path";

import {
  formatAgentPresetLabel,
} from "@/lib/openclaw/agent-presets";
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
  getWorkspaceTemplateMeta
} from "@/lib/openclaw/workspace-presets";
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
  MissionControlSnapshot,
  MissionAbortResponse,
  MissionResponse,
  MissionSubmission,
  OpenClawAgent,
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

function createWorkspaceAgentId(workspaceSlug: string, agentKey: string) {
  return `${workspaceSlug}-${slugify(agentKey) || "agent"}`;
}

function findDuplicateStrings(values: string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
      continue;
    }

    seen.add(value);
  }

  return Array.from(duplicates).sort((left, right) => left.localeCompare(right));
}

function describeAgentWorkspace(
  snapshot: MissionControlSnapshot,
  agent: Pick<OpenClawAgent, "workspaceId" | "workspacePath">
) {
  return (
    snapshot.workspaces.find((workspace) => workspace.id === agent.workspaceId)?.name ??
    path.basename(agent.workspacePath)
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _assertWorkspaceBootstrapAgentIdsAvailable(
  snapshot: MissionControlSnapshot,
  workspaceSlug: string,
  agents: WorkspaceAgentBlueprintInput[]
) {
  const finalAgentIds = agents.map((agent) => createWorkspaceAgentId(workspaceSlug, agent.id));
  const duplicateFinalIds = findDuplicateStrings(finalAgentIds);

  if (duplicateFinalIds.length > 0) {
    throw new Error(
      `Workspace bootstrap would create duplicate agent ids: ${duplicateFinalIds.join(", ")}.`
    );
  }

  for (const agentId of finalAgentIds) {
    const existingAgent = snapshot.agents.find((agent) => agent.id === agentId);

    if (!existingAgent) {
      continue;
    }

    throw new Error(
      `Workspace bootstrap would create agent id "${agentId}", but it already exists in workspace "${describeAgentWorkspace(snapshot, existingAgent)}". Rename the workspace or adjust the agent ids.`
    );
  }
}

export function renderAgentsMarkdown(params: {
  name: string;
  brief?: string;
  template: WorkspaceTemplate;
  sourceMode: WorkspaceSourceMode;
  agents: WorkspaceAgentBlueprintInput[];
  rules: WorkspaceCreateRules;
}) {
  const templateMeta = getWorkspaceTemplateMeta(params.template);
  const teamLines = params.agents.map(
    (agent) =>
      `- ${agent.role}: ${agent.name}${agent.skillId ? ` · skill ${agent.skillId}` : ""}${
        agent.policy ? ` · ${formatAgentPresetLabel(agent.policy.preset)}` : ""
      }`
  );

  return `# ${params.name}

Shared project context for all agents working in this workspace.

## Workspace
- Template: ${templateMeta.label}
- Source mode: ${params.sourceMode}
- Workspace-only access: ${params.rules.workspaceOnly ? "enabled" : "disabled"}

## Team
${teamLines.join("\n")}

## Customize
${params.brief || "Clarify the project goal, definition of done, constraints, and success signals before large changes."}

## Safety defaults
- Stay inside the attached workspace unless the task explicitly requires another location.
- Prefer direct, reviewable changes over speculative rewrites.
- Preserve user work and avoid destructive actions without clear approval.
- Update durable docs when stable architecture, workflow, or product decisions change.
- Worker and browser agents should not install tooling unless their explicit policy allows it.
- Route environment preparation to setup-oriented agents when the work depends on new tooling.

## Daily memory
- Capture durable facts in MEMORY.md and memory/*.md.
- Record stable decisions in memory/decisions.md.
- Keep temporary chatter and scratch notes in memory/.

## Output
- Be concise in chat and write longer output to files when the artifact matters.
- Put task-specific deliverables, drafts, reports, and docs inside per-run folders under deliverables/.
- Avoid writing final artifacts to the workspace root unless explicitly requested.
`;
}

export function renderSoulMarkdown(template: WorkspaceTemplate, brief?: string) {
  const templateMeta = getWorkspaceTemplateMeta(template);

  return `# SOUL

## My Purpose
Help this ${templateMeta.label.toLowerCase()} workspace turn intent into real outcomes with pragmatic execution, verification, and durable memory.

## How I Operate
- Start from the current workspace reality before proposing large moves.
- Prefer concrete action, visible artifacts, and clear handoffs.
- Keep docs, memory, and deliverables aligned with the actual state of the work.

## My Quirks
- Pragmatic
- Direct
- Product-aware
- Quality-minded

${brief ? `## Active Focus\n${brief}\n` : ""}`;
}

export function renderIdentityMarkdown(template: WorkspaceTemplate) {
  const templateMeta = getWorkspaceTemplateMeta(template);

  return `# IDENTITY

## Role
This workspace hosts a ${templateMeta.label.toLowerCase()} team coordinated through OpenClaw.

**Vibe:** pragmatic, concise, quality-minded, workspace-grounded
`;
}

export function renderToolsMarkdown(template: WorkspaceTemplate, toolExamples: string[]) {
  const templateMeta = getWorkspaceTemplateMeta(template);

  return `# TOOLS

Repository commands and workflow notes for this ${templateMeta.label.toLowerCase()} workspace.

## Examples
${toolExamples.map((line) => `- ${line}`).join("\n")}

## Notes
- Replace these examples with sharper project-specific commands when the repo exposes them.
- Prefer repeatable commands that other agents can run without interpretation drift.
`;
}

export function renderHeartbeatMarkdown(template: WorkspaceTemplate) {
  const templateMeta = getWorkspaceTemplateMeta(template);

  return `# HEARTBEAT

- Start each substantial task by refreshing the brief, docs, and current files.
- Keep the ${templateMeta.label.toLowerCase()} workspace coherent across code, docs, and memory.
- Prefer explicit handoffs between implementation, review, testing, and knowledge capture.
`;
}

export function renderMemoryMarkdown(name: string, template: WorkspaceTemplate, brief?: string) {
  return `# ${name} Memory

Durable project facts for this ${getWorkspaceTemplateMeta(template).label.toLowerCase()} workspace.

## Current brief
${brief || "No brief captured yet. Fill this in as soon as the project goal is clarified."}

## Stable facts
- Add durable architecture, product, or workflow facts here.
- Move longer notes into memory/*.md when they outgrow this file.
`;
}

export function renderBlueprintMarkdown(name: string, template: WorkspaceTemplate, brief?: string) {
  return `# ${name} Blueprint

## Workspace type
${getWorkspaceTemplateMeta(template).label}

## Outcome
${brief || "Define the target outcome, user impact, and quality bar for this workspace."}

## Constraints
- Add technical, product, legal, or operational constraints here.

## Unknowns
- Capture unresolved questions that block confident execution.
`;
}

export function renderDecisionsMarkdown() {
  return `# Decisions

Use this file for durable decisions that should survive across sessions.

## Template
- Date:
- Decision:
- Context:
- Consequence:
`;
}

export function renderBriefMarkdown(
  name: string,
  template: WorkspaceTemplate,
  brief: string | undefined,
  sourceMode: WorkspaceSourceMode
) {
  return `# ${name} Brief

## Template
${getWorkspaceTemplateMeta(template).label}

## Source mode
${sourceMode}

## Objective
${brief || "Clarify the main goal, target user, and success definition for this workspace."}

## Success signals
- Define what success looks like in observable terms.

## Open questions
- List the unknowns worth resolving first.
`;
}

export function renderArchitectureMarkdown(template: WorkspaceTemplate) {
  return `# Architecture

## Current shape
- Describe the main components, systems, or content lanes in this ${getWorkspaceTemplateMeta(template).label.toLowerCase()} workspace.

## Dependencies
- List critical external services, repos, data sources, or channels.

## Risks
- Capture structural, operational, or delivery risks here.
`;
}

export function renderDeliverablesMarkdown() {
  return `# Deliverables

Use this folder for substantial output artifacts that should be easy to hand off or review.

- Create one subfolder per task or run, for example \`deliverables/2026-03-07-15-30-00-launch-brief/\`.
- Put drafts, reports, docs, and publishable assets for that task inside its run folder.
- Keep filenames descriptive and tied to the task or audience.
`;
}

export function renderTemplateSpecificDoc(kind: "ux" | "backend" | "research" | "content") {
  if (kind === "ux") {
    return `# UX Notes

- Track interaction patterns, responsive edge cases, and visual risk areas here.
`;
  }

  if (kind === "backend") {
    return `# Service Map

- Document services, jobs, queues, external dependencies, and critical flows here.
`;
  }

  if (kind === "research") {
    return `# Research Plan

- State the question, method, evidence sources, and expected output before large investigation work.
`;
  }

  return `# Content Brief

- Capture audience, channel, tone, CTA, and distribution assumptions for this content workspace.
`;
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
function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
