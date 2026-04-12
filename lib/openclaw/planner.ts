import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { runOpenClaw, runOpenClawJson } from "@/lib/openclaw/cli";
import { resolveAgentPolicy } from "@/lib/openclaw/agent-presets";
import {
  buildPlannerDeployProgressTemplate,
  createOperationProgressTracker
} from "@/lib/openclaw/operation-progress";
import {
  applyPlannerInput,
  applyPlannerTemplate,
  createPlannerAgentSpec,
  createPlannerAutomationSpec,
  createArchitectReply,
  createPlannerChannelSpec,
  createPlannerContextSource,
  createPlannerHookSpec,
  createInitialWorkspacePlan,
  createPlannerMessage,
  createPlannerRuntimeState,
  createPlannerSandboxSpec,
  createPlannerWorkflowSpec,
  detectPlannerTextLanguage,
  enrichWorkspacePlan,
  getPlannerWorkspaceSizeProfile,
  resolvePlannerReplyLanguage,
  synthesizePlannerAdvisors
} from "@/lib/openclaw/planner-core";
import {
  buildWorkspaceEditableDocuments,
  normalizeWorkspaceDocOverrides,
  type WorkspaceScaffoldDocument
} from "@/lib/openclaw/workspace-docs";
import {
  createAgent,
  createWorkspaceProject,
  getMissionControlSnapshot,
  submitMission
} from "@/lib/agentos/control-plane";
import type {
  PlannerAdvisorId,
  PlannerAdvisorNote,
  PlannerExperienceMode,
  PlannerAutomationSpec,
  PlannerChannelSpec,
  PlannerContextSource,
  PlannerHookSpec,
  OperationProgressSnapshot,
  PlannerPersistentAgentSpec,
  PlannerSandboxSpec,
  PlannerWorkflowSpec,
  WorkspaceDocOverride,
  WorkspaceTemplate,
  WorkspaceAgentBlueprintInput,
  WorkspaceCreateInput,
  WorkspacePlan,
  WorkspacePlanDeployResult
} from "@/lib/openclaw/types";

const plannerRootPath = path.join(process.cwd(), ".mission-control", "planner");
const plansRootPath = path.join(plannerRootPath, "plans");
const plannerRuntimeWorkspacePath = path.join(plannerRootPath, "runtime-workspace");
const WEBSITE_INSPECTION_TIMEOUT_MS = 3500;
const WEBSITE_FOLLOWUP_TIMEOUT_MS = 1800;
const PLANNER_RUNTIME_NAME = "AgentOS Planner Runtime";
const PLANNER_RUNTIME_SYSTEM_TAG = "mission-control-planner";

type WorkspacePlanDeployOptions = {
  onProgress?: (snapshot: OperationProgressSnapshot) => Promise<void> | void;
};

type PlannerOperationProgressUpdate = {
  message: string;
  percent: number;
  status?: "active" | "done" | "error";
};

type PlannerOperationProgressHandler = (
  update: PlannerOperationProgressUpdate
) => Promise<void> | void;

const plannerRuntimeAgentBlueprints: Array<WorkspaceAgentBlueprintInput> = [
  {
    id: "architect",
    role: "Workspace Architect",
    name: "Workspace Architect",
    enabled: true,
    isPrimary: true,
    emoji: "🤖",
    theme: "cyan",
    skillId: "planner-architect",
    policy: resolveAgentPolicy("worker", {
      fileAccess: "workspace-only",
      networkAccess: "enabled"
    }),
    heartbeat: { enabled: false }
  },
  {
    id: "founder",
    role: "Founder",
    name: "Founder",
    enabled: true,
    emoji: "🏗️",
    theme: "amber",
    skillId: "planner-founder",
    policy: resolveAgentPolicy("worker", {
      fileAccess: "workspace-only",
      networkAccess: "enabled"
    }),
    heartbeat: { enabled: false }
  },
  {
    id: "product",
    role: "Product Lead",
    name: "Product Lead",
    enabled: true,
    emoji: "📐",
    theme: "emerald",
    skillId: "planner-product",
    policy: resolveAgentPolicy("worker", {
      fileAccess: "workspace-only",
      networkAccess: "enabled"
    }),
    heartbeat: { enabled: false }
  },
  {
    id: "ops",
    role: "Operations",
    name: "Operations",
    enabled: true,
    emoji: "⚙️",
    theme: "blue",
    skillId: "planner-ops",
    policy: resolveAgentPolicy("worker", {
      fileAccess: "workspace-only",
      networkAccess: "enabled"
    }),
    heartbeat: { enabled: false }
  },
  {
    id: "growth",
    role: "Growth",
    name: "Growth",
    enabled: true,
    emoji: "📣",
    theme: "violet",
    skillId: "planner-growth",
    policy: resolveAgentPolicy("worker", {
      fileAccess: "workspace-only",
      networkAccess: "enabled"
    }),
    heartbeat: { enabled: false }
  },
  {
    id: "reviewer",
    role: "Reviewer",
    name: "Reviewer",
    enabled: true,
    emoji: "🔍",
    theme: "rose",
    skillId: "planner-reviewer",
    policy: resolveAgentPolicy("worker", {
      fileAccess: "workspace-only",
      networkAccess: "enabled"
    }),
    heartbeat: { enabled: false }
  }
];

const plannerAdvisorOrder: PlannerAdvisorId[] = ["founder", "product", "ops", "growth", "reviewer"];

type PlannerAgentTurnPayload = {
  runId: string;
  status: string;
  summary: string;
  result?: {
    payloads?: Array<{
      text?: string;
      mediaUrl?: string | null;
    }>;
    meta?: Record<string, unknown>;
  };
};

type PlannerAgentPatch = {
  company?: Partial<WorkspacePlan["company"]>;
  product?: Partial<WorkspacePlan["product"]>;
  workspace?: Partial<WorkspacePlan["workspace"]> & {
    removeDocOverridePaths?: string[];
  };
  team?: {
    removeAgentIds?: string[];
    persistentAgents?: Array<Partial<PlannerPersistentAgentSpec> & { id: string }>;
    allowEphemeralSubagents?: boolean;
    maxParallelRuns?: number;
    escalationRules?: string[];
  };
  operations?: {
    removeWorkflowIds?: string[];
    removeChannelIds?: string[];
    removeAutomationIds?: string[];
    removeHookIds?: string[];
    workflows?: Array<Partial<PlannerWorkflowSpec> & { id: string }>;
    channels?: Array<Partial<PlannerChannelSpec> & { id: string; type?: PlannerChannelSpec["type"] }>;
    automations?: Array<Partial<PlannerAutomationSpec> & { id: string }>;
    hooks?: Array<Partial<PlannerHookSpec> & { id: string }>;
    sandbox?: Partial<PlannerSandboxSpec>;
  };
};

type PlannerArchitectAgentResponse = {
  reply: string;
  patch?: PlannerAgentPatch;
  mode?: PlannerExperienceMode | null;
  reviewRequested?: boolean | null;
  assumptions?: string[];
  suggestions?: string[];
  questions?: string[];
};

type PlannerAdvisorAgentResponse = {
  summary: string;
  recommendations?: string[];
  concerns?: string[];
};

type WorkspacePlanTurnResult = {
  plan: WorkspacePlan;
};

type WorkspaceDocumentRewriteResult = {
  plan: WorkspacePlan;
  reply: string;
};

export async function createWorkspacePlan() {
  const plan = createInitialWorkspacePlan();
  await saveWorkspacePlan(plan);
  return {
    plan
  };
}

export async function getWorkspacePlan(planId: string) {
  const plan = await readWorkspacePlan(planId);
  return {
    plan
  };
}

export async function updateWorkspacePlan(planId: string, incomingPlan: WorkspacePlan) {
  const nextPlan = await persistIncomingPlan(planId, incomingPlan);
  return {
    plan: nextPlan
  };
}

export async function submitWorkspacePlanTurn(
  planId: string,
  message: string,
  incomingPlan?: WorkspacePlan
): Promise<WorkspacePlanTurnResult> {
  const trimmedMessage = message.trim();

  if (!trimmedMessage) {
    throw new Error("Planner message is required.");
  }

  const basePlan = incomingPlan
    ? await persistIncomingPlan(planId, incomingPlan)
    : await readWorkspacePlan(planId);
  const harvestedContextPromise = harvestPlannerContext(trimmedMessage);
  let nextPlan = applyPlannerInput(enrichWorkspacePlan(basePlan), trimmedMessage);
  nextPlan.conversation.push(createPlannerMessage("user", "Operator", trimmedMessage));
  const harvestedContext = await harvestedContextPromise;
  nextPlan.intake.sources = mergePlannerSources(nextPlan.intake.sources, harvestedContext.sources);
  nextPlan = enrichWorkspacePlan(nextPlan);

  const runtimeReadyPlan = shouldUseLocalPlannerFastPath(nextPlan)
    ? nextPlan
    : await ensurePlannerRuntime(nextPlan);
  const shouldUseAdvisorBoard =
    runtimeReadyPlan.autopilot &&
    (runtimeReadyPlan.intake.reviewRequested || runtimeReadyPlan.intake.turnCount > 2);
  const advisorNotes = shouldUseAdvisorBoard
    ? await synthesizePlannerAdvisorsWithRuntime(runtimeReadyPlan, trimmedMessage)
    : [];
  runtimeReadyPlan.advisorNotes = advisorNotes;
  const architectTurn = await runArchitectPlannerTurn(
    runtimeReadyPlan,
    trimmedMessage,
    harvestedContext,
    advisorNotes,
    basePlan
  );
  nextPlan = architectTurn.plan;
  nextPlan.conversation.push(
    createPlannerMessage(
      "assistant",
      "Workspace Architect",
      architectTurn.reply
    )
  );
  nextPlan = enrichWorkspacePlan(nextPlan);

  await saveWorkspacePlan(nextPlan);

  return {
    plan: nextPlan
  };
}

export async function submitWorkspaceDocumentRewrite(
  planId: string,
  input: {
    path: string;
    instruction?: string;
    currentContent?: string;
    plan?: WorkspacePlan;
  }
): Promise<WorkspaceDocumentRewriteResult> {
  const trimmedPath = input.path.trim();

  if (!trimmedPath) {
    throw new Error("Document path is required.");
  }

  const basePlan = input.plan
    ? await persistIncomingPlan(planId, input.plan)
    : await readWorkspacePlan(planId);
  const runtimeReadyPlan = await ensurePlannerRuntime(enrichWorkspacePlan(basePlan));
  const rewriteInstruction =
    input.instruction?.trim() ||
    "Rewrite this document to improve clarity, usefulness, and consistency with the workspace context.";
  const rewriteResult = await runWorkspaceDocumentRewriteTurn(
    runtimeReadyPlan,
    trimmedPath,
    input.currentContent,
    rewriteInstruction
  );

  let nextPlan = rewriteResult.plan;
  nextPlan.conversation.push(
    createPlannerMessage("assistant", "Workspace Architect", rewriteResult.reply)
  );
  nextPlan = enrichWorkspacePlan(nextPlan);

  await saveWorkspacePlan(nextPlan);

  return {
    plan: nextPlan,
    reply: rewriteResult.reply
  };
}

export async function simulateWorkspacePlan(
  planId: string,
  incomingPlan?: WorkspacePlan
): Promise<WorkspacePlanTurnResult> {
  const basePlan = incomingPlan
    ? await persistIncomingPlan(planId, incomingPlan)
    : await readWorkspacePlan(planId);
  let nextPlan = await ensurePlannerRuntime(enrichWorkspacePlan(basePlan));
  const advisorNotes = await synthesizePlannerAdvisorsWithRuntime(nextPlan, "Simulate the specialist planning board.");

  nextPlan.advisorNotes = advisorNotes;
  const architectTurn = await runArchitectPlannerTurn(
    nextPlan,
    "Simulate the specialist planning board and tell me what you would refine next.",
    {
      sources: nextPlan.intake.sources,
      confirmations: nextPlan.intake.confirmations,
      inferenceText: nextPlan.intake.inferences.map((entry) => `${entry.label}: ${entry.value}`).join("\n"),
      companyName: nextPlan.company.name || undefined,
      mission: nextPlan.company.mission || undefined,
      offer: nextPlan.product.offer || undefined,
      template: nextPlan.workspace.template
    },
    advisorNotes,
    basePlan
  );
  nextPlan = architectTurn.plan;
  nextPlan.conversation.push(createPlannerMessage("assistant", "Workspace Architect", architectTurn.reply));

  const enrichedPlan = enrichWorkspacePlan(nextPlan);
  await saveWorkspacePlan(enrichedPlan);

  return {
    plan: enrichedPlan
  };
}

export async function deployWorkspacePlan(
  planId: string,
  incomingPlan?: WorkspacePlan,
  options: WorkspacePlanDeployOptions = {}
): Promise<WorkspacePlanDeployResult> {
  const basePlan = incomingPlan
    ? await persistIncomingPlan(planId, incomingPlan)
    : await readWorkspacePlan(planId);
  const nextPlan = enrichWorkspacePlan({
    ...basePlan,
    intake: {
      ...basePlan.intake,
      reviewRequested: true
    }
  });
  const enabledAgentCount = nextPlan.team.persistentAgents.filter((agent) => agent.enabled).length;
  const hasChannels = nextPlan.operations.channels.some(
    (channel) => channel.enabled && channel.type !== "internal"
  );
  const hasAutomations = nextPlan.operations.automations.some((automation) => automation.enabled);
  const hasPlannerKickoffs = nextPlan.deploy.firstMissions.some((mission) => mission.trim().length > 0);
  const progress = createOperationProgressTracker({
    template: buildPlannerDeployProgressTemplate({
      sourceMode: nextPlan.workspace.sourceMode,
      agentCount: enabledAgentCount,
      kickoffMission: nextPlan.workspace.rules.kickoffMission,
      hasChannels,
      hasAutomations,
      hasPlannerKickoffs
    }),
    onProgress: options.onProgress
  });

  await progress.startStep("plan", "Checking deploy blockers and locking the planner state.");

  if (nextPlan.deploy.blockers.length > 0) {
    const blockerMessage = `Resolve deploy blockers first: ${nextPlan.deploy.blockers.join(" ")}`;
    await progress.addActivity("plan", blockerMessage, "error");
    await progress.failStep("plan", blockerMessage);
    throw new Error(`Resolve deploy blockers first: ${nextPlan.deploy.blockers.join(" ")}`);
  }

  await progress.addActivity("plan", "Deploy blockers cleared.", "done");
  nextPlan.status = "deploying";
  nextPlan.stage = "deploying";
  await saveWorkspacePlan(nextPlan);
  await progress.completeStep("plan", "Planner state locked. Workspace bootstrap is starting.");

  try {
    const workspaceInput = buildWorkspaceCreateInput(nextPlan);
    const created = await createWorkspaceProject(workspaceInput, {
      onProgress: async (workspaceProgress) => {
        for (const step of workspaceProgress.steps) {
          await progress.syncStep(step);
        }
      }
    });

    await progress.startStep("blueprint", "Writing planner blueprint and deploy notes into the new workspace.");
    await progress.addActivity("blueprint", "Persisting planner blueprint, deploy report, and docs.");
    await writePlannerWorkspaceFiles(nextPlan, created.workspacePath, created);
    await progress.completeStep("blueprint", "Planner blueprint and docs are now in the workspace.");

    const createdAgentIdMap = buildCreatedAgentIdMap(nextPlan);
    await progress.startStep(
      "channels",
      hasChannels ? "Provisioning enabled external channels." : "No external channels were requested."
    );
    if (!hasChannels) {
      await progress.addActivity("channels", "No enabled external channels. Skipping channel provisioning.", "done");
    }
    const channelProvision = await provisionPlannerChannels(nextPlan.operations.channels, {
      onProgress: async ({ message, percent, status }) => {
        await progress.updateStep("channels", {
          percent,
          detail: message,
          status: status === "error" ? "active" : undefined
        });
        await progress.addActivity("channels", message, status);
      }
    });
    await progress.completeStep(
      "channels",
      hasChannels
        ? `${channelProvision.provisioned.length} channel${channelProvision.provisioned.length === 1 ? "" : "s"} provisioned.`
        : "Channel stage complete."
    );

    await progress.startStep(
      "automations",
      hasAutomations ? "Provisioning enabled automation loops." : "No recurring automations were requested."
    );
    if (!hasAutomations) {
      await progress.addActivity("automations", "No enabled automations. Skipping automation provisioning.", "done");
    }
    const automationProvision = await provisionPlannerAutomations(
      nextPlan,
      created.workspaceId,
      createdAgentIdMap,
      {
        onProgress: async ({ message, percent, status }) => {
          await progress.updateStep("automations", {
            percent,
            detail: message,
            status: status === "error" ? "active" : undefined
          });
          await progress.addActivity("automations", message, status);
        }
      }
    );
    await progress.completeStep(
      "automations",
      hasAutomations
        ? `${automationProvision.provisioned.length} automation${automationProvision.provisioned.length === 1 ? "" : "s"} provisioned.`
        : "Automation stage complete."
    );

    await progress.startStep(
      "planner-kickoff",
      hasPlannerKickoffs ? "Dispatching planner kickoff missions." : "No planner kickoff missions were requested."
    );
    if (!hasPlannerKickoffs) {
      await progress.addActivity(
        "planner-kickoff",
        "No planner kickoff missions. Finalizing deploy.",
        "done"
      );
    }
    const kickoffRunIds = await runPlannerKickoffMissions(
      nextPlan,
      created.workspaceId,
      createdAgentIdMap,
      {
        onProgress: async ({ message, percent, status }) => {
          await progress.updateStep("planner-kickoff", {
            percent,
            detail: message,
            status: status === "error" ? "active" : undefined
          });
          await progress.addActivity("planner-kickoff", message, status);
        }
      }
    );
    await progress.completeStep(
      "planner-kickoff",
      hasPlannerKickoffs
        ? `${kickoffRunIds.length} kickoff mission${kickoffRunIds.length === 1 ? "" : "s"} launched.`
        : "Deploy finalized without extra kickoff missions."
    );
    const warnings = uniqueStrings([
      ...nextPlan.deploy.warnings,
      ...channelProvision.warnings,
      ...automationProvision.warnings
    ]);

    nextPlan.deploy = {
      ...nextPlan.deploy,
      blockers: [],
      warnings,
      lastDeployedAt: new Date().toISOString(),
      workspaceId: created.workspaceId,
      workspacePath: created.workspacePath,
      primaryAgentId: created.primaryAgentId,
      createdAgentIds: created.agentIds,
      provisionedChannels: channelProvision.provisioned,
      provisionedAutomations: automationProvision.provisioned,
      kickoffRunIds: uniqueStrings([
        ...(created.kickoffRunId ? [created.kickoffRunId] : []),
        ...kickoffRunIds
      ])
    };
    nextPlan.status = "deployed";
    nextPlan.stage = "deployed";
    nextPlan.conversation.push(
      createPlannerMessage(
        "assistant",
        "Workspace Architect",
        `DEPLOY completed. Workspace ${created.workspacePath} is live with ${created.agentIds.length} agent${created.agentIds.length === 1 ? "" : "s"}.`
      )
    );

    const finalPlan = enrichWorkspacePlan(nextPlan);
    finalPlan.status = "deployed";
    finalPlan.stage = "deployed";
    await saveWorkspacePlan(finalPlan);

    const result = {
      plan: finalPlan,
      workspaceId: created.workspaceId,
      workspacePath: created.workspacePath,
      primaryAgentId: created.primaryAgentId,
      agentIds: created.agentIds,
      kickoffRunIds: finalPlan.deploy.kickoffRunIds,
      warnings
    };

    return result;
  } catch (error) {
    nextPlan.status = "blocked";
    nextPlan.stage = "pressure-test";
    nextPlan.deploy.warnings = uniqueStrings([
      ...nextPlan.deploy.warnings,
      error instanceof Error ? error.message : "Planner deploy failed."
    ]);
    await saveWorkspacePlan(enrichWorkspacePlan(nextPlan));
    throw error;
  }
}

async function persistIncomingPlan(planId: string, incomingPlan: WorkspacePlan) {
  const storedPlan = await readWorkspacePlan(planId).catch(() => createInitialWorkspacePlan(planId));
  const mergedPlan = enrichWorkspacePlan({
    ...storedPlan,
    ...incomingPlan,
    id: planId,
    createdAt: storedPlan.createdAt,
    runtime: {
      ...storedPlan.runtime,
      ...incomingPlan.runtime
    },
    deploy: {
      ...storedPlan.deploy,
      ...incomingPlan.deploy
    }
  });

  await saveWorkspacePlan(mergedPlan);
  return mergedPlan;
}

async function readWorkspacePlan(planId: string) {
  const filePath = getWorkspacePlanFilePath(planId);
  const raw = await readFile(filePath, "utf8");
  return enrichWorkspacePlan(JSON.parse(raw) as WorkspacePlan);
}

async function saveWorkspacePlan(plan: WorkspacePlan) {
  const filePath = getWorkspacePlanFilePath(plan.id);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
}

function getWorkspacePlanFilePath(planId: string) {
  return path.join(plansRootPath, `${planId}.json`);
}

const plannerAdvisorNames: Record<PlannerAdvisorId, string> = {
  founder: "Founder",
  product: "Product Lead",
  ops: "Operations",
  growth: "Growth",
  reviewer: "Reviewer",
  architect: "Workspace Architect"
};

const plannerRuntimeSkillContents: Record<string, string> = {
  "planner-architect": `# Workspace Architect

You are the primary planning agent for AgentOS.

## Mission
- Understand the operator's intent through conversation.
- Draft a complete, revisable workspace plan proactively.
- Ask questions only when no safe default exists and the workspace cannot stay coherent without one.

## Output Contract
- Always return valid JSON only.
- Never wrap JSON in markdown fences.
- Use this schema:
{
  "reply": "short natural language response to the operator",
  "mode": "guided | advanced | null",
  "reviewRequested": boolean,
  "assumptions": ["assumption you took proactively"],
  "suggestions": ["recommended next move or stronger default"],
  "questions": ["only if a decision would materially change the design"],
  "patch": {}
}

## Rules
- Keep momentum. Prefer a complete draft over hesitation.
- Keep the reply concise and specific, but make the patch rich and complete.
- Treat natural language as enough. Do not wait for rigid field-by-field phrasing.
- Treat the latest user message as either a fresh brief or a revision instruction against the current draft.
- Rewrite any section the operator wants changed and refresh dependent sections in the same patch.
- Prefer website title and domain evidence over raw action phrases when inferring names.
- Never derive a company or workspace name from generic intent text like "workspace kurmak istiyorum" or similar action phrasing.
- If the message includes a proper noun tied to the project, workspace, or brand, treat it as a valid name candidate unless contradicted.
- When the operator names the company or workspace explicitly, apply it immediately.
- If the operator asks for a role in plain language, create or adapt a persistent agent for that role.
- Example: if the operator says "şahsi asistan ekleyelim" or "add a personal assistant", add a persistent agent like { id: "personal-assistant", role: "Personal Assistant", name: "Personal Assistant", ... }.
- Infer likely defaults and say what you assumed instead of bouncing the decision back by default.
- Give proactive suggestions when you see a stronger workspace shape, cleaner V1, or better agent split.
- If the operator asks to rewrite a generated document, update workspace.docOverrides for that document path and keep unrelated plan sections unchanged.
- Use patch as the source of truth. The planner layer should validate the draft, not force the operator to restate it.
- When a domain or website implies a likely brand name, use it unless contradicted.
- If a section must be removed in a revision, use the relevant removeIds list for agents, workflows, channels, automations, or hooks.
- When changing source mode, clear stale repo and folder fields in the same patch.
- Treat AgentOS as the source of truth. Patch only the fields that should change.
`,
  "planner-founder": `# Founder Advisor

Return valid JSON only:
{
  "summary": "commercial read",
  "recommendations": ["..."],
  "concerns": ["..."]
}

Focus on mission clarity, audience, value exchange, and launch posture. Be concise.`,
  "planner-product": `# Product Lead

Return valid JSON only:
{
  "summary": "product read",
  "recommendations": ["..."],
  "concerns": ["..."]
}

Focus on offer, V1 scope, non-goals, and operator experience. Be concise.`,
  "planner-ops": `# Operations Advisor

Return valid JSON only:
{
  "summary": "operations read",
  "recommendations": ["..."],
  "concerns": ["..."]
}

Focus on workflows, automations, channels, run cadence, and reliability. Be concise.`,
  "planner-growth": `# Growth Advisor

Return valid JSON only:
{
  "summary": "growth read",
  "recommendations": ["..."],
  "concerns": ["..."]
}

Focus on acquisition loops, activation, community, and measurable signals. Be concise.`,
  "planner-reviewer": `# Reviewer

Return valid JSON only:
{
  "summary": "risk read",
  "recommendations": ["..."],
  "concerns": ["..."]
}

Pressure-test assumptions, missing info, hidden blockers, and design regressions. Be concise.`
};

async function ensurePlannerRuntime(plan: WorkspacePlan) {
  const currentRuntime = createPlannerRuntimeState(plan.id, plan.runtime);
  const expectedArchitectAgentId = buildPlannerRuntimeAgentId("architect");

  if (
    currentRuntime.status === "ready" &&
    currentRuntime.architectAgentId === expectedArchitectAgentId &&
    currentRuntime.workspacePath === plannerRuntimeWorkspacePath
  ) {
    return enrichWorkspacePlan({
      ...plan,
      runtime: currentRuntime
    });
  }

  const nextPlan = structuredClone(plan);

  try {
    let snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
    let workspace = snapshot.workspaces.find((entry) => entry.path === plannerRuntimeWorkspacePath) ?? null;

    if (!workspace) {
      await createWorkspaceProject({
        name: PLANNER_RUNTIME_NAME,
        directory: plannerRuntimeWorkspacePath,
        sourceMode: "empty",
        template: "research",
        teamPreset: "custom",
        modelProfile: "balanced",
        rules: {
          workspaceOnly: true,
          generateStarterDocs: false,
          generateMemory: false,
          kickoffMission: false
        },
        agents: plannerRuntimeAgentBlueprints
      });
      await configurePlannerRuntimeWorkspace(plannerRuntimeWorkspacePath);
      snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
      workspace = snapshot.workspaces.find((entry) => entry.path === plannerRuntimeWorkspacePath) ?? null;
    } else {
      await configurePlannerRuntimeWorkspace(workspace.path);
    }

    if (!workspace) {
      throw new Error("Planner runtime workspace could not be found after provisioning.");
    }

    const agentIdsByRole = Object.fromEntries(
      plannerRuntimeAgentBlueprints.map((agent) => [agent.id, buildPlannerRuntimeAgentId(agent.id)])
    ) as Record<string, string>;
    const existingAgentIds = new Set(
      snapshot.agents
        .filter((agent) => agent.workspaceId === workspace.id)
        .map((agent) => agent.id)
    );

    for (const agent of plannerRuntimeAgentBlueprints) {
      const expectedAgentId = agentIdsByRole[agent.id];
      if (existingAgentIds.has(expectedAgentId)) {
        continue;
      }

      await createAgent({
        id: expectedAgentId,
        workspaceId: workspace.id,
        name: agent.name,
        emoji: agent.emoji,
        theme: agent.theme,
        policy: agent.policy,
        heartbeat: agent.heartbeat
      });
    }

    await configurePlannerRuntimeWorkspace(workspace.path);

    nextPlan.runtime = createPlannerRuntimeState(plan.id, {
      ...currentRuntime,
      mode: "agent",
      status: "ready",
      workspaceId: workspace.id,
      workspacePath: workspace.path,
      architectAgentId: agentIdsByRole.architect,
      advisorAgentIds: {
        founder: agentIdsByRole.founder,
        product: agentIdsByRole.product,
        ops: agentIdsByRole.ops,
        growth: agentIdsByRole.growth,
        reviewer: agentIdsByRole.reviewer
      },
      lastError: undefined
    });
  } catch (error) {
    nextPlan.runtime = createPlannerRuntimeState(plan.id, {
      ...currentRuntime,
      mode: "fallback",
      status: "error",
      lastError: error instanceof Error ? error.message : "Planner runtime provisioning failed."
    });
  }

  return enrichWorkspacePlan(nextPlan);
}

async function configurePlannerRuntimeWorkspace(workspacePath: string) {
  await mkdir(path.join(workspacePath, "skills"), { recursive: true });

  for (const [skillId, contents] of Object.entries(plannerRuntimeSkillContents)) {
    const skillPath = path.join(workspacePath, "skills", skillId, "SKILL.md");
    await mkdir(path.dirname(skillPath), { recursive: true });
    await writeFile(skillPath, `${contents.trim()}\n`, "utf8");
  }

  const projectFilePath = path.join(workspacePath, ".openclaw", "project.json");
  let parsed: Record<string, unknown> = {};

  try {
    parsed = JSON.parse(await readFile(projectFilePath, "utf8")) as Record<string, unknown>;
  } catch {
    parsed = {};
  }

  parsed.name = typeof parsed.name === "string" ? parsed.name : PLANNER_RUNTIME_NAME;
  parsed.hidden = true;
  parsed.systemTag = PLANNER_RUNTIME_SYSTEM_TAG;
  parsed.updatedAt = new Date().toISOString();

  await mkdir(path.dirname(projectFilePath), { recursive: true });
  await writeFile(projectFilePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

async function synthesizePlannerAdvisorsWithRuntime(plan: WorkspacePlan, latestMessage: string) {
  if (plan.runtime.mode !== "agent" || plan.runtime.status !== "ready") {
    return synthesizePlannerAdvisors(plan);
  }

  try {
    const advisorRuns = await Promise.all(
      plannerAdvisorOrder.map(async (advisorId) => {
        const agentId = plan.runtime.advisorAgentIds[advisorId];
        const sessionId = plan.runtime.advisorSessionIds[advisorId];

        if (!agentId || !sessionId) {
          return null;
        }

        const prompt = buildPlannerAdvisorPrompt(plan, advisorId, latestMessage);
        const result = await runPlannerRuntimeAgent<PlannerAdvisorAgentResponse>({
          agentId,
          sessionId,
          message: prompt,
          thinking: "medium"
        });

        return {
          advisorId,
          ...result
        };
      })
    );

    const notes: PlannerAdvisorNote[] = advisorRuns
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .map((entry) => ({
        id: `${entry.advisorId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        advisorId: entry.advisorId,
        advisorName: plannerAdvisorNames[entry.advisorId],
        summary: entry.response.summary?.trim() || "No specialist summary returned.",
        recommendations: uniqueStrings(entry.response.recommendations ?? []).slice(0, 3),
        concerns: uniqueStrings(entry.response.concerns ?? []).slice(0, 3),
        createdAt: new Date().toISOString()
      }));

    plan.runtime = createPlannerRuntimeState(plan.id, {
      ...plan.runtime,
      lastAdvisorRunIds: advisorRuns
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
        .map((entry) => entry.runId),
      lastError: undefined
    });

    return notes.length > 0 ? notes : synthesizePlannerAdvisors(plan);
  } catch (error) {
    plan.runtime = createPlannerRuntimeState(plan.id, {
      ...plan.runtime,
      status: "error",
      mode: "fallback",
      lastError: error instanceof Error ? error.message : "Advisor runtime failed."
    });
    return synthesizePlannerAdvisors(plan);
  }
}

async function runArchitectPlannerTurn(
  plan: WorkspacePlan,
  latestMessage: string,
  harvestedContext: PlannerHarvestResult,
  advisorNotes: PlannerAdvisorNote[],
  previousPlan?: WorkspacePlan
) {
  if (plan.runtime.mode !== "agent" || plan.runtime.status !== "ready" || !plan.runtime.architectAgentId) {
    const fallbackPlan = enrichWorkspacePlan(applyHarvestedDefaults(plan, harvestedContext));
    return {
      plan: fallbackPlan,
      reply: createArchitectReply(fallbackPlan, advisorNotes, latestMessage, previousPlan).text
    };
  }

  try {
    const result = await runPlannerRuntimeAgent<PlannerArchitectAgentResponse>({
      agentId: plan.runtime.architectAgentId,
      sessionId: plan.runtime.architectSessionId,
      message: buildPlannerArchitectPrompt(plan, latestMessage, harvestedContext, advisorNotes),
      thinking: resolveArchitectThinking(plan)
    });

    let nextPlan = structuredClone(plan);
    if (result.response.mode === "guided" || result.response.mode === "advanced") {
      nextPlan.intake.mode = result.response.mode;
    }

    if (typeof result.response.reviewRequested === "boolean") {
      nextPlan.intake.reviewRequested = result.response.reviewRequested;
    }

    if (result.response.patch) {
      nextPlan = applyPlannerAgentPatch(nextPlan, result.response.patch);
    }

    nextPlan.runtime = createPlannerRuntimeState(nextPlan.id, {
      ...nextPlan.runtime,
      mode: "agent",
      status: "ready",
      lastArchitectRunId: result.runId,
      lastError: undefined
    });

    const enrichedPlan = enrichWorkspacePlan(nextPlan);
    const fallbackReply = createArchitectReply(enrichedPlan, advisorNotes, latestMessage, previousPlan).text;

    return {
      plan: enrichedPlan,
      reply: formatArchitectAgentReply(
        result.response,
        fallbackReply,
        resolvePlannerReplyLanguage(enrichedPlan, latestMessage)
      )
    };
  } catch (error) {
    const fallbackPlan = enrichWorkspacePlan({
      ...applyHarvestedDefaults(plan, harvestedContext),
      runtime: createPlannerRuntimeState(plan.id, {
        ...plan.runtime,
        mode: "fallback",
        status: "error",
        lastError: error instanceof Error ? error.message : "Architect runtime failed."
      })
    });

    return {
      plan: fallbackPlan,
      reply: createArchitectReply(fallbackPlan, advisorNotes, latestMessage, previousPlan).text
    };
  }
}

async function runWorkspaceDocumentRewriteTurn(
  plan: WorkspacePlan,
  targetPath: string,
  currentContent: string | undefined,
  instruction: string
): Promise<WorkspaceDocumentRewriteResult> {
  const targetDocument = resolveWorkspaceScaffoldDocumentForRewrite(plan, targetPath, currentContent);

  if (!targetDocument) {
    throw new Error(`Document ${targetPath} is not available in this workspace.`);
  }

  const result = await runPlannerRuntimeAgent<PlannerArchitectAgentResponse>({
    agentId: plan.runtime.architectAgentId ?? buildPlannerRuntimeAgentId("architect"),
    sessionId: plan.runtime.architectSessionId ?? plan.id,
    message: buildPlannerDocumentRewritePrompt(plan, targetDocument, instruction),
    thinking: resolveArchitectThinking(plan)
  });

  const workspacePatch = result.response.patch?.workspace;
  const targetDocOverrides = normalizeWorkspaceDocOverrides(
    workspacePatch?.docOverrides?.filter((entry) => entry.path.trim() === targetPath)
  );
  const targetRemovals = (workspacePatch?.removeDocOverridePaths ?? [])
    .map((entry) => entry.trim())
    .filter((entry) => entry === targetPath);

  if (
    targetDocOverrides.length === 0 &&
    targetRemovals.length === 0
  ) {
    throw new Error(`Architect did not return a rewrite patch for ${targetPath}.`);
  }

  let nextPlan = structuredClone(plan);
  nextPlan = applyPlannerAgentPatch(nextPlan, {
    workspace: {
      docOverrides: targetDocOverrides,
      removeDocOverridePaths: targetRemovals
    }
  });
  nextPlan.runtime = createPlannerRuntimeState(nextPlan.id, {
    ...nextPlan.runtime,
    mode: "agent",
    status: "ready",
    lastArchitectRunId: result.runId,
    lastError: undefined
  });

  const rewrittenDocument = resolveWorkspaceScaffoldDocumentForRewrite(nextPlan, targetPath);

  if (!rewrittenDocument) {
    throw new Error(`Architect could not resolve ${targetPath} after the rewrite patch.`);
  }

  const fallbackReply = `Updated ${targetPath}.`;

  return {
    plan: nextPlan,
    reply: formatArchitectAgentReply(
      result.response,
      fallbackReply,
      resolvePlannerReplyLanguage(nextPlan, instruction)
    )
  };
}

async function runPlannerRuntimeAgent<T>({
  agentId,
  sessionId,
  message,
  thinking
}: {
  agentId: string;
  sessionId: string;
  message: string;
  thinking: "off" | "minimal" | "low" | "medium" | "high";
}) {
  const payload = await runOpenClawJson<PlannerAgentTurnPayload>(
    [
      "agent",
      "--agent",
      agentId,
      "--session-id",
      sessionId,
      "--message",
      message,
      "--thinking",
      thinking,
      "--timeout",
      "120",
      "--json"
    ],
    { timeoutMs: 125000 }
  );
  const text = extractPlannerPayloadText(payload);
  return {
    runId: payload.runId,
    text,
    response: extractPlannerJson<T>(text)
  };
}

function buildPlannerArchitectPrompt(
  plan: WorkspacePlan,
  latestMessage: string,
  harvestedContext: PlannerHarvestResult,
  advisorNotes: PlannerAdvisorNote[]
) {
  const sizeProfile = getPlannerWorkspaceSizeProfile(plan.intake.size);

  return [
    "You are Workspace Architect, the primary planning agent inside AgentOS.",
    "Return valid JSON only. Do not wrap the JSON in markdown fences.",
    'Schema: {"reply":"string","mode":"guided|advanced|null","reviewRequested":boolean,"assumptions":["..."],"suggestions":["..."],"questions":["..."],"patch":{}}',
    "Rules:",
    "- Treat the latest user message as a fresh brief or a revision instruction against the current draft.",
    "- Produce a complete draft, not a sparse diff. Fill the sections you can infer now and rewrite the section the operator wants changed.",
    "- Prefer extracting intent and only filling fields that are strongly supported by the latest message or linked context.",
    "- Treat yourself as the primary intelligence layer. The planner should persist and validate state, not interpret the operator for you.",
    "- If the operator asks you to infer, extract, or revise missing details from linked context, fill the supported fields and refresh dependent sections.",
    "- Ask questions only when a safe default would be materially harmful. Most turns should not ask any question.",
    "- Do not ask about non-goals, polish, or V1 exclusions until mission, audience, and offer are already grounded.",
    "- Prefer website title and domain evidence over raw action phrases when inferring company or workspace names.",
    "- Never derive a company or workspace name from generic intent text like \"workspace kurmak istiyorum\" or similar action phrasing.",
    "- If the message includes a proper noun tied to the project, workspace, or brand, treat it as a valid name candidate unless contradicted.",
    "- If the site title or domain is ambiguous or generic, make the best assumption and keep it in the assumptions list instead of stopping the draft.",
    "- Do not invent workflows, automations, channels, or a large agent roster without evidence, but draft the smallest coherent set that supports the brief.",
    "- Keep the reply to one short sentence when possible.",
    "- Do not repeat the full draft, and do not put assumptions, suggestions, or questions into the reply text.",
    "- Reply in the same language as the operator's latest message.",
    "- If the operator switches languages, follow the latest message only. Do not stick to an older language from earlier turns.",
    "- Treat colloquial Turkish and informal phrasing as first-class input. Infer names, roles, and intent from natural speech instead of waiting for rigid formatting.",
    "- When the operator gives a company or workspace name, apply it immediately.",
    "- Take initiative. If the intent is clear but some details are ambiguous, choose the likeliest workable default and tell the operator what you assumed.",
    "- If the operator asks for a role or agent in plain language, add or adapt a persistent agent for that role instead of asking them to restate it formally.",
    '- Example: "şahsi asistan ekleyelim" should produce a persistent agent patch such as { id: "personal-assistant", role: "Personal Assistant", name: "Personal Assistant" } with a sensible purpose and outputs.',
    "- If the operator explicitly asks to revise a generated document, put the full revised text in workspace.docOverrides for that document path and keep unrelated plan sections unchanged.",
    "- Give recommendations proactively when you see a stronger default, clearer role split, or cleaner V1 path, but prefer a complete draft over a sparse one.",
    "- If currentPlan includes the workspace-edit-source, treat this as an existing workspace revision: preserve the current agent roster, workflows, channels, automations, and hooks unless the latest message explicitly asks to change them.",
    "- For narrow edits like a rename or copy tweak, patch only the directly requested fields and leave the rest of the workspace shape alone.",
    "- When a domain implies a likely brand name, use it unless contradicted.",
    "- When you still need confirmation after reading a source, state what you inferred first and ask only for the remaining ambiguity.",
    "- Respect the selected workspace size. Keep the operator-facing chat concise, but still complete the underlying project context and blueprint.",
    "- Use patch precisely. Update company, product, workspace, agents, workflows, automations, and channels only when the operator intent clearly supports them.",
    "- When removing an agent, workflow, channel, automation, or hook during a revision, use the relevant removeIds field and regenerate dependent items as needed.",
    "- When changing source mode, clear stale repo and folder fields in the same patch.",
    "- When adding a new agent, generate a stable slug id and include role, name, purpose, responsibilities, and outputs.",
    "- Patch only fields that should change.",
    "",
    "Context JSON:",
    JSON.stringify(
      {
        operatorMessage: latestMessage,
        selectedWorkspaceSize: {
          id: plan.intake.size,
          label: sizeProfile.label,
          targets: {
            agents: sizeProfile.agentCount,
            tasks: sizeProfile.workflowCount,
            automations: sizeProfile.automationCount,
            externalChannels: sizeProfile.externalChannelCount
          }
        },
        architectSummary: plan.architectSummary,
        currentPlan: createPlannerPromptContext(plan),
        harvestedContext,
        advisorNotes: advisorNotes.map((note) => ({
          advisor: note.advisorName,
          summary: note.summary,
          recommendations: note.recommendations,
          concerns: note.concerns
        })),
        recentConversation: plan.conversation.slice(-8).map((entry) => ({
          role: entry.role,
          author: entry.author,
          text: entry.text
        }))
      },
      null,
      2
    )
  ].join("\n");
}

function buildPlannerDocumentRewritePrompt(
  plan: WorkspacePlan,
  targetDocument: WorkspaceScaffoldDocument,
  instruction: string
) {
  const sizeProfile = getPlannerWorkspaceSizeProfile(plan.intake.size);

  return [
    "You are Workspace Architect, rewriting one generated workspace document.",
    "Return valid JSON only. Do not wrap the JSON in markdown fences.",
    'Schema: {"reply":"string","mode":"guided|advanced|null","reviewRequested":boolean,"assumptions":["..."],"suggestions":["..."],"questions":["..."],"patch":{}}',
    "Rules:",
    "- Rewrite only the requested document unless the instruction explicitly asks for a broader plan change.",
    "- Treat the provided currentContent as the source of truth for the rewrite.",
    "- Update only workspace.docOverrides for the target path. If the best revision is to restore the generated default scaffold, remove the override for that path.",
    "- Do not change unrelated company, product, team, or operations fields in this document rewrite flow.",
    "- Keep the reply to one short sentence and mention only what changed.",
    "- Reply in the same language as the operator instruction.",
    "",
    "Context JSON:",
    JSON.stringify(
      {
        operatorInstruction: instruction,
        targetDocument: {
          path: targetDocument.path,
          title: targetDocument.title,
          description: targetDocument.description,
          category: targetDocument.category,
          baseContent: targetDocument.baseContent,
          currentContent: targetDocument.content
        },
        selectedWorkspaceSize: {
          id: plan.intake.size,
          label: sizeProfile.label,
          targets: {
            agents: sizeProfile.agentCount,
            tasks: sizeProfile.workflowCount,
            automations: sizeProfile.automationCount,
            externalChannels: sizeProfile.externalChannelCount
          }
        },
        currentPlan: createPlannerPromptContext(plan),
        recentConversation: plan.conversation.slice(-6).map((entry) => ({
          role: entry.role,
          author: entry.author,
          text: entry.text
        }))
      },
      null,
      2
    )
  ].join("\n");
}

function buildPlannerAdvisorPrompt(
  plan: WorkspacePlan,
  advisorId: PlannerAdvisorId,
  latestMessage: string
) {
  return [
    `You are the ${plannerAdvisorNames[advisorId]} advisor for planner orchestration.`,
    "Return valid JSON only. Do not wrap the JSON in markdown fences.",
    'Schema: {"summary":"string","recommendations":["..."],"concerns":["..."]}',
    "Keep the output concise and role-specific.",
    "",
    "Context JSON:",
    JSON.stringify(
      {
        advisor: advisorId,
        latestOperatorMessage: latestMessage,
        currentPlan: createPlannerPromptContext(plan),
        recentConversation: plan.conversation.slice(-6).map((entry) => ({
          role: entry.role,
          author: entry.author,
          text: entry.text
        }))
      },
      null,
      2
    )
  ].join("\n");
}

function formatArchitectAgentReply(
  response: PlannerArchitectAgentResponse,
  fallbackReply: string,
  expectedLanguage: "en" | "tr"
) {
  const reply = response.reply?.trim();
  if (!reply) {
    return compactArchitectReply(fallbackReply);
  }

  const replyLanguage = detectPlannerTextLanguage(reply);
  if (replyLanguage && replyLanguage !== expectedLanguage) {
    return compactArchitectReply(fallbackReply);
  }

  return compactArchitectReply(reply);
}

function compactArchitectReply(reply: string) {
  const normalized = reply.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }

  const sentences = normalized.split(/(?<=[.!?])\s+/).filter(Boolean);
  const compact = sentences.length > 1 ? sentences.slice(0, 2).join(" ") : normalized;

  if (compact.length <= 220) {
    return compact;
  }

  return `${compact.slice(0, 217).trimEnd()}...`;
}

function shouldUseLocalPlannerFastPath(plan: WorkspacePlan) {
  return !plan.intake.reviewRequested && plan.intake.turnCount <= 1 && plan.runtime.status !== "ready";
}

function resolveArchitectThinking(plan: WorkspacePlan) {
  if (plan.intake.reviewRequested) {
    return "high";
  }

  if (plan.intake.turnCount <= 1) {
    return "medium";
  }

  return plan.intake.turnCount <= 2 ? "low" : "medium";
}

function createPlannerPromptContext(plan: WorkspacePlan) {
  const sizeProfile = getPlannerWorkspaceSizeProfile(plan.intake.size);
  const enabledAgents = plan.team.persistentAgents.filter((agent) => agent.enabled);
  const enabledWorkflows = plan.operations.workflows.filter((workflow) => workflow.enabled);
  const enabledAutomations = plan.operations.automations.filter((automation) => automation.enabled);

  return {
    company: plan.company,
    product: plan.product,
    workspace: plan.workspace,
    currentOperatingShape: {
      enabledAgents: enabledAgents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        role: agent.role,
        isPrimary: agent.isPrimary
      })),
      enabledWorkflowCount: enabledWorkflows.length,
      enabledAutomationCount: enabledAutomations.length,
      enabledExternalChannels: plan.operations.channels
        .filter((channel) => channel.enabled && channel.type !== "internal")
        .map((channel) => channel.name)
    },
    team: {
      persistentAgents: plan.team.persistentAgents,
      allowEphemeralSubagents: plan.team.allowEphemeralSubagents,
      maxParallelRuns: plan.team.maxParallelRuns,
      escalationRules: plan.team.escalationRules
    },
    operations: plan.operations,
    intake: {
      mode: plan.intake.mode,
      size: plan.intake.size,
      sizeTargets: {
        agents: sizeProfile.agentCount,
        tasks: sizeProfile.workflowCount,
        automations: sizeProfile.automationCount,
        externalChannels: sizeProfile.externalChannelCount
      },
      reviewRequested: plan.intake.reviewRequested,
      confirmations: plan.intake.confirmations,
      sources: plan.intake.sources,
      inferences: plan.intake.inferences
    }
  };
}

function applyPlannerAgentPatch(plan: WorkspacePlan, patch: PlannerAgentPatch) {
  let nextPlan = structuredClone(plan);

  if (patch.workspace?.template && isWorkspaceTemplateValue(patch.workspace.template) && patch.workspace.template !== nextPlan.workspace.template) {
    nextPlan = applyPlannerTemplate(nextPlan, patch.workspace.template);
  }

  if (patch.company) {
    nextPlan.company = {
      ...nextPlan.company,
      ...patch.company
    };
  }

  if (patch.product) {
    nextPlan.product = {
      ...nextPlan.product,
      ...patch.product
    };
  }

  if (patch.workspace) {
    const nextWorkspace = {
      ...nextPlan.workspace,
      ...patch.workspace,
      rules: {
        ...nextPlan.workspace.rules,
        ...(patch.workspace.rules ?? {})
      }
    };

    if (patch.workspace.sourceMode === "empty") {
      nextWorkspace.repoUrl = undefined;
      nextWorkspace.existingPath = undefined;
    } else if (patch.workspace.sourceMode === "clone") {
      nextWorkspace.existingPath = undefined;
    } else if (patch.workspace.sourceMode === "existing") {
      nextWorkspace.repoUrl = undefined;
    }

    if (patch.workspace.repoUrl !== undefined) {
      nextWorkspace.sourceMode = "clone";
      nextWorkspace.existingPath = undefined;
    }

    if (patch.workspace.existingPath !== undefined) {
      nextWorkspace.sourceMode = "existing";
      nextWorkspace.repoUrl = undefined;
    }

    if (patch.workspace.docOverrides || patch.workspace.removeDocOverridePaths?.length) {
      nextWorkspace.docOverrides = mergePlannerDocOverrides(
        nextPlan.workspace.docOverrides,
        patch.workspace.docOverrides,
        patch.workspace.removeDocOverridePaths
      );
    }

    nextPlan.workspace = nextWorkspace;
  }

  if (patch.team) {
    const baseAgents = patch.team.removeAgentIds?.length
      ? removePlannerEntries(nextPlan.team.persistentAgents, patch.team.removeAgentIds)
      : nextPlan.team.persistentAgents;

    nextPlan.team = {
      ...nextPlan.team,
      allowEphemeralSubagents:
        patch.team.allowEphemeralSubagents ?? nextPlan.team.allowEphemeralSubagents,
      maxParallelRuns: patch.team.maxParallelRuns ?? nextPlan.team.maxParallelRuns,
      escalationRules: patch.team.escalationRules ?? nextPlan.team.escalationRules,
      persistentAgents: patch.team.persistentAgents
        ? mergePlannerAgents(baseAgents, patch.team.persistentAgents)
        : baseAgents
    };
  }

  if (patch.operations) {
    const workflows = patch.operations.removeWorkflowIds?.length
      ? removePlannerEntries(nextPlan.operations.workflows, patch.operations.removeWorkflowIds)
      : nextPlan.operations.workflows;
    const channels = patch.operations.removeChannelIds?.length
      ? removePlannerEntries(nextPlan.operations.channels, patch.operations.removeChannelIds)
      : nextPlan.operations.channels;
    const automations = patch.operations.removeAutomationIds?.length
      ? removePlannerEntries(nextPlan.operations.automations, patch.operations.removeAutomationIds)
      : nextPlan.operations.automations;
    const hooks = patch.operations.removeHookIds?.length
      ? removePlannerEntries(nextPlan.operations.hooks, patch.operations.removeHookIds)
      : nextPlan.operations.hooks;

    nextPlan.operations = {
      ...nextPlan.operations,
      workflows: patch.operations.workflows
        ? mergePlannerWorkflows(workflows, patch.operations.workflows)
        : workflows,
      channels: patch.operations.channels
        ? mergePlannerChannels(channels, patch.operations.channels)
        : channels,
      automations: patch.operations.automations
        ? mergePlannerAutomations(automations, patch.operations.automations)
        : automations,
      hooks: patch.operations.hooks
        ? mergePlannerHooks(hooks, patch.operations.hooks)
        : hooks,
      sandbox: patch.operations.sandbox
        ? createPlannerSandboxSpec({
            ...nextPlan.operations.sandbox,
            ...patch.operations.sandbox
          })
        : nextPlan.operations.sandbox
    };
  }

  return enrichWorkspacePlan(nextPlan);
}

function mergePlannerDocOverrides(
  current: WorkspaceDocOverride[],
  incoming?: WorkspaceDocOverride[],
  removePaths?: string[]
) {
  const merged = new Map<string, string>();

  for (const entry of normalizeWorkspaceDocOverrides(current)) {
    merged.set(entry.path, entry.content);
  }

  for (const removePath of removePaths ?? []) {
    const path = removePath.trim();
    if (!path) {
      continue;
    }

    merged.delete(path);
  }

  for (const entry of normalizeWorkspaceDocOverrides(incoming)) {
    merged.set(entry.path, entry.content);
  }

  return normalizeWorkspaceDocOverrides(
    Array.from(merged.entries()).map(([path, content]) => ({
      path,
      content
    }))
  );
}

function resolveWorkspaceScaffoldDocumentForRewrite(
  plan: WorkspacePlan,
  targetPath: string,
  currentContent?: string
) {
  const documents = buildWorkspaceEditableDocuments({
    name: plan.workspace.name || "Workspace",
    brief: plan.company.mission || plan.product.offer || undefined,
    template: plan.workspace.template,
    sourceMode: plan.workspace.sourceMode,
    rules: plan.workspace.rules,
    agents: plan.team.persistentAgents.filter((agent) => agent.enabled),
    docOverrides: plan.workspace.docOverrides,
    toolExamples: [],
    contextSources: plan.intake.sources
  });

  const document = documents.find((entry) => entry.path === targetPath);

  if (!document) {
    return null;
  }

  if (typeof currentContent === "string") {
    return {
      ...document,
      content: currentContent
    };
  }

  return document;
}

function removePlannerEntries<T extends { id: string }>(current: T[], removeIds: string[]) {
  const ids = new Set(removeIds.map((id) => slugify(id)).filter(Boolean));
  if (ids.size === 0) {
    return current;
  }

  return current.filter((entry) => !ids.has(entry.id));
}

function mergePlannerAgents(
  current: PlannerPersistentAgentSpec[],
  incoming: Array<Partial<PlannerPersistentAgentSpec> & { id: string }>
) {
  const merged = new Map(current.map((agent) => [agent.id, agent]));

  for (const candidate of incoming) {
    const id = slugify(candidate.id);
    if (!id) {
      continue;
    }

    const previous = merged.get(id);
    merged.set(
      id,
      createPlannerAgentSpec({
        ...previous,
        ...candidate,
        id,
        responsibilities: candidate.responsibilities ?? previous?.responsibilities,
        outputs: candidate.outputs ?? previous?.outputs,
        heartbeat: candidate.heartbeat ?? previous?.heartbeat,
        policy: candidate.policy ?? previous?.policy
      })
    );
  }

  return Array.from(merged.values());
}

function mergePlannerWorkflows(
  current: PlannerWorkflowSpec[],
  incoming: Array<Partial<PlannerWorkflowSpec> & { id: string }>
) {
  const merged = new Map(current.map((workflow) => [workflow.id, workflow]));

  for (const candidate of incoming) {
    const id = slugify(candidate.id);
    if (!id) {
      continue;
    }

    const previous = merged.get(id);
    merged.set(
      id,
      createPlannerWorkflowSpec({
        ...previous,
        ...candidate,
        id,
        collaboratorAgentIds: candidate.collaboratorAgentIds ?? previous?.collaboratorAgentIds,
        outputs: candidate.outputs ?? previous?.outputs,
        channelIds: candidate.channelIds ?? previous?.channelIds
      })
    );
  }

  return Array.from(merged.values());
}

function mergePlannerChannels(
  current: PlannerChannelSpec[],
  incoming: Array<Partial<PlannerChannelSpec> & { id: string; type?: PlannerChannelSpec["type"] }>
) {
  const merged = new Map(current.map((channel) => [channel.id, channel]));

  for (const candidate of incoming) {
    const id = slugify(candidate.id);
    const previous = merged.get(id);
    const type = isPlannerChannelTypeValue(candidate.type) ? candidate.type : previous?.type;

    if (!id || !type) {
      continue;
    }

    merged.set(
      id,
      createPlannerChannelSpec(type, {
        ...previous,
        ...candidate,
        id,
        credentials: candidate.credentials ?? previous?.credentials
      })
    );
  }

  return Array.from(merged.values());
}

function mergePlannerAutomations(
  current: PlannerAutomationSpec[],
  incoming: Array<Partial<PlannerAutomationSpec> & { id: string }>
) {
  const merged = new Map(current.map((automation) => [automation.id, automation]));

  for (const candidate of incoming) {
    const id = slugify(candidate.id);
    if (!id) {
      continue;
    }

    const previous = merged.get(id);
    merged.set(
      id,
      createPlannerAutomationSpec({
        ...previous,
        ...candidate,
        id
      })
    );
  }

  return Array.from(merged.values());
}

function mergePlannerHooks(
  current: PlannerHookSpec[],
  incoming: Array<Partial<PlannerHookSpec> & { id: string }>
) {
  const merged = new Map(current.map((hook) => [hook.id, hook]));

  for (const candidate of incoming) {
    const id = slugify(candidate.id);
    if (!id) {
      continue;
    }

    const previous = merged.get(id);
    merged.set(
      id,
      createPlannerHookSpec({
        ...previous,
        ...candidate,
        id
      })
    );
  }

  return Array.from(merged.values());
}

function extractPlannerPayloadText(payload: PlannerAgentTurnPayload) {
  const payloadText = payload.result?.payloads
    ?.map((entry) => entry.text?.trim())
    .filter((entry): entry is string => Boolean(entry))
    .join("\n\n");

  return payloadText || payload.summary || "{}";
}

function extractPlannerJson<T>(text: string): T {
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");

  try {
    return JSON.parse(trimmed) as T;
  } catch {}

  const lines = trimmed.split(/\r?\n/);
  for (let start = 0; start < lines.length; start += 1) {
    const line = lines[start].trim();
    if (!line.startsWith("{") && !line.startsWith("[")) {
      continue;
    }

    for (let end = lines.length; end > start; end -= 1) {
      const candidate = lines.slice(start, end).join("\n").trim();
      try {
        return JSON.parse(candidate) as T;
      } catch {}
    }
  }

  throw new Error(`Planner agent returned invalid JSON: ${trimmed.slice(0, 800)}`);
}

function buildPlannerRuntimeAgentId(agentKey: string) {
  return `${slugify(PLANNER_RUNTIME_NAME)}-${slugify(agentKey) || "agent"}`;
}

function isWorkspaceTemplateValue(value: unknown): value is WorkspaceTemplate {
  return (
    value === "software" ||
    value === "frontend" ||
    value === "backend" ||
    value === "research" ||
    value === "content"
  );
}

function isPlannerChannelTypeValue(value: unknown): value is PlannerChannelSpec["type"] {
  return (
    value === "internal" ||
    value === "slack" ||
    value === "telegram" ||
    value === "discord" ||
    value === "googlechat"
  );
}

function buildWorkspaceCreateInput(plan: WorkspacePlan): WorkspaceCreateInput {
  const enabledAgents = plan.team.persistentAgents.filter((agent) => agent.enabled);

  return {
    name: plan.workspace.name,
    brief: buildWorkspaceBrief(plan),
    directory: plan.workspace.directory,
    modelId: plan.workspace.modelId,
    sourceMode: plan.workspace.sourceMode,
    repoUrl: plan.workspace.repoUrl,
    existingPath: plan.workspace.existingPath,
    template: plan.workspace.template,
    teamPreset: "custom",
    modelProfile: plan.workspace.modelProfile,
    docOverrides: plan.workspace.docOverrides,
    rules: {
      ...plan.workspace.rules,
      workspaceOnly: plan.operations.sandbox.workspaceOnly
    },
    agents: enabledAgents.map(mapPlannerAgentToWorkspaceAgent)
  };
}

function mapPlannerAgentToWorkspaceAgent(
  agent: WorkspacePlan["team"]["persistentAgents"][number]
): WorkspaceAgentBlueprintInput {
  return {
    id: agent.id,
    role: agent.role,
    name: agent.name,
    enabled: agent.enabled,
    emoji: agent.emoji,
    theme: agent.theme,
    skillId: agent.skillId,
    modelId: agent.modelId,
    isPrimary: agent.isPrimary,
    policy: agent.policy,
    heartbeat: agent.heartbeat
  };
}

function buildWorkspaceBrief(plan: WorkspacePlan) {
  return [
    plan.company.mission ? `Mission: ${plan.company.mission}` : "",
    plan.company.targetCustomer ? `Target customer: ${plan.company.targetCustomer}` : "",
    plan.product.offer ? `Offer: ${plan.product.offer}` : "",
    plan.product.scopeV1.length > 0 ? `V1 scope: ${plan.product.scopeV1.join(", ")}` : "",
    plan.product.nonGoals.length > 0 ? `Non-goals: ${plan.product.nonGoals.join(", ")}` : "",
    plan.company.successSignals.length > 0
      ? `Success signals: ${plan.company.successSignals.join(", ")}`
      : "",
    plan.workspace.stackDecisions.length > 0
      ? `Stack decisions: ${plan.workspace.stackDecisions.join(", ")}`
      : ""
  ]
    .filter(Boolean)
    .join("\n");
}

async function writePlannerWorkspaceFiles(
  plan: WorkspacePlan,
  workspacePath: string,
  created: Awaited<ReturnType<typeof createWorkspaceProject>>
) {
  const plannerPath = path.join(workspacePath, ".openclaw", "planner");
  const docsPath = path.join(workspacePath, "docs");

  await mkdir(plannerPath, { recursive: true });
  await mkdir(docsPath, { recursive: true });

  const workflowSummary = plan.operations.workflows
    .map((workflow) =>
      [
        `## ${workflow.name}`,
        `- Goal: ${workflow.goal || "Unset"}`,
        `- Trigger: ${workflow.trigger}`,
        `- Owner: ${workflow.ownerAgentId || "Unassigned"}`,
        workflow.collaboratorAgentIds.length > 0
          ? `- Collaborators: ${workflow.collaboratorAgentIds.join(", ")}`
          : "",
        `- Success: ${workflow.successDefinition || "Unset"}`,
        workflow.outputs.length > 0 ? `- Outputs: ${workflow.outputs.join(", ")}` : ""
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n");

  const companyBrief = [
    `# ${plan.company.name || plan.workspace.name || "Workspace"} Company Plan`,
    "",
    `## Mission`,
    plan.company.mission || "Unset",
    "",
    `## Target customer`,
    plan.company.targetCustomer || "Unset",
    "",
    `## Offer`,
    plan.product.offer || "Unset",
    "",
    `## V1 scope`,
    plan.product.scopeV1.length > 0 ? plan.product.scopeV1.map((entry) => `- ${entry}`).join("\n") : "- Unset",
    "",
    `## Non-goals`,
    plan.product.nonGoals.length > 0 ? plan.product.nonGoals.map((entry) => `- ${entry}`).join("\n") : "- Unset",
    "",
    `## Success signals`,
    plan.company.successSignals.length > 0
      ? plan.company.successSignals.map((entry) => `- ${entry}`).join("\n")
      : "- Unset"
  ].join("\n");

  await writeFile(path.join(plannerPath, "blueprint.json"), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  await writeFile(
    path.join(plannerPath, "deploy-report.json"),
    `${JSON.stringify(
      {
        deployedAt: new Date().toISOString(),
        workspaceId: created.workspaceId,
        workspacePath: created.workspacePath,
        primaryAgentId: created.primaryAgentId,
        agentIds: created.agentIds,
        kickoffRunId: created.kickoffRunId ?? null
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(path.join(docsPath, "company.md"), `${companyBrief}\n`, "utf8");
  await writeFile(path.join(docsPath, "workflows.md"), `# Workflows\n\n${workflowSummary}\n`, "utf8");
}

async function provisionPlannerChannels(
  channels: PlannerChannelSpec[],
  options: {
    onProgress?: PlannerOperationProgressHandler;
  } = {}
) {
  const provisioned: string[] = [];
  const warnings: string[] = [];
  const enabledChannels = channels.filter((entry) => entry.enabled && entry.type !== "internal");

  if (enabledChannels.length === 0) {
    await options.onProgress?.({
      message: "No enabled external channels. Skipping channel provisioning.",
      percent: 100,
      status: "done"
    });
  }

  for (const [index, channel] of enabledChannels.entries()) {
    const credentialMap = Object.fromEntries(
      channel.credentials.map((credential) => [credential.key, credential.value.trim()])
    );
    const args = buildChannelCommandArgs(channel, credentialMap);
    const startingPercent = Math.round((index / enabledChannels.length) * 100);

    await options.onProgress?.({
      message: `Provisioning channel ${index + 1} of ${enabledChannels.length}: ${channel.name}.`,
      percent: startingPercent,
      status: "active"
    });

    if (!args) {
      warnings.push(`Channel "${channel.name}" uses an unsupported provisioning shape.`);
      await options.onProgress?.({
        message: `Skipped ${channel.name}. AgentOS does not know how to provision this channel shape yet.`,
        percent: Math.round(((index + 1) / enabledChannels.length) * 100),
        status: "error"
      });
      continue;
    }

    try {
      await runOpenClaw(args, { timeoutMs: 60000 });
      provisioned.push(channel.name);
      await options.onProgress?.({
        message: `Provisioned ${channel.name}.`,
        percent: Math.round(((index + 1) / enabledChannels.length) * 100),
        status: "done"
      });
    } catch (error) {
      warnings.push(
        `Channel "${channel.name}" could not be provisioned: ${
          error instanceof Error ? error.message : "unknown error"
        }`
      );
      await options.onProgress?.({
        message: `Channel ${channel.name} could not be provisioned: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
        percent: Math.round(((index + 1) / enabledChannels.length) * 100),
        status: "error"
      });
    }
  }

  return {
    provisioned,
    warnings
  };
}

function buildChannelCommandArgs(channel: PlannerChannelSpec, credentialMap: Record<string, string>) {
  switch (channel.type) {
    case "telegram":
      return credentialMap.token
        ? [
            "channels",
            "add",
            "--channel",
            "telegram",
            "--token",
            credentialMap.token,
            "--name",
            channel.name
          ]
        : null;
    case "discord":
      return credentialMap.token
        ? [
            "channels",
            "add",
            "--channel",
            "discord",
            "--token",
            credentialMap.token,
            "--name",
            channel.name
          ]
        : null;
    case "slack":
      return credentialMap.botToken
        ? [
            "channels",
            "add",
            "--channel",
            "slack",
            "--bot-token",
            credentialMap.botToken,
            "--name",
            channel.name
          ]
        : null;
    case "googlechat":
      return credentialMap.webhookUrl
        ? [
            "channels",
            "add",
            "--channel",
            "googlechat",
            "--webhook-url",
            credentialMap.webhookUrl,
            "--name",
            channel.name
          ]
        : null;
    default:
      return null;
  }
}

async function provisionPlannerAutomations(
  plan: WorkspacePlan,
  workspaceId: string,
  createdAgentIdMap: Record<string, string>,
  options: {
    onProgress?: PlannerOperationProgressHandler;
  } = {}
) {
  const provisioned: string[] = [];
  const warnings: string[] = [];
  const enabledAutomations = plan.operations.automations.filter((entry) => entry.enabled);

  if (enabledAutomations.length === 0) {
    await options.onProgress?.({
      message: "No enabled automations. Skipping automation provisioning.",
      percent: 100,
      status: "done"
    });
  }

  for (const [index, automation] of enabledAutomations.entries()) {
    const args = buildAutomationCommandArgs(plan, automation, createdAgentIdMap);
    const startingPercent = Math.round((index / enabledAutomations.length) * 100);

    await options.onProgress?.({
      message: `Provisioning automation ${index + 1} of ${enabledAutomations.length}: ${automation.name}.`,
      percent: startingPercent,
      status: "active"
    });

    if (!args) {
      warnings.push(`Automation "${automation.name}" could not be mapped to a live agent.`);
      await options.onProgress?.({
        message: `Skipped ${automation.name}. It could not be mapped to a live agent.`,
        percent: Math.round(((index + 1) / enabledAutomations.length) * 100),
        status: "error"
      });
      continue;
    }

    try {
      await runOpenClaw(args, { timeoutMs: 60000 });
      provisioned.push(automation.name);
      await options.onProgress?.({
        message: `Provisioned automation ${automation.name}.`,
        percent: Math.round(((index + 1) / enabledAutomations.length) * 100),
        status: "done"
      });
    } catch (error) {
      warnings.push(
        `Automation "${automation.name}" failed to provision: ${
          error instanceof Error ? error.message : "unknown error"
        }`
      );
      await options.onProgress?.({
        message: `Automation ${automation.name} failed: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
        percent: Math.round(((index + 1) / enabledAutomations.length) * 100),
        status: "error"
      });
    }
  }

  const snapshot = await getMissionControlSnapshot({ force: true });
  if (!snapshot.workspaces.some((workspace) => workspace.id === workspaceId)) {
    warnings.push("Workspace snapshot did not refresh immediately after deploy.");
    await options.onProgress?.({
      message: "Workspace snapshot did not refresh immediately after deploy.",
      percent: 100,
      status: "error"
    });
  }

  return {
    provisioned,
    warnings
  };
}

function buildAutomationCommandArgs(
  plan: WorkspacePlan,
  automation: PlannerAutomationSpec,
  createdAgentIdMap: Record<string, string>
) {
  const mappedAgentId = automation.agentId ? createdAgentIdMap[automation.agentId] : undefined;

  if (!mappedAgentId) {
    return null;
  }

  const args = [
    "cron",
    "add",
    "--name",
    automation.name,
    "--description",
    automation.description || automation.name,
    "--agent",
    mappedAgentId,
    "--message",
    automation.mission,
    "--thinking",
    automation.thinking,
    "--timeout-seconds",
    "120",
    "--json"
  ];

  if (automation.scheduleKind === "every") {
    args.push("--every", automation.scheduleValue);
  } else {
    args.push("--cron", automation.scheduleValue);
  }

  if (automation.announce && automation.channelId) {
    const channel = plan.operations.channels.find((entry) => entry.id === automation.channelId);
    if (channel && channel.type !== "internal") {
      args.push("--announce", "--channel", channel.type);
      if (channel.target) {
        args.push("--to", channel.target);
      }
    }
  }

  return args;
}

async function runPlannerKickoffMissions(
  plan: WorkspacePlan,
  workspaceId: string,
  createdAgentIdMap: Record<string, string>,
  options: {
    onProgress?: PlannerOperationProgressHandler;
  } = {}
) {
  const kickoffAssignments = [
    {
      agentId:
        createdAgentIdMap[plan.team.persistentAgents.find((agent) => agent.enabled && agent.isPrimary)?.id ?? ""],
      mission: plan.deploy.firstMissions[0]
    },
    {
      agentId:
        createdAgentIdMap[
          plan.team.persistentAgents.find((agent) => agent.enabled && /review/i.test(agent.role))?.id ?? ""
        ],
      mission: plan.deploy.firstMissions[1]
    },
    {
      agentId:
        createdAgentIdMap[
          plan.team.persistentAgents.find((agent) => agent.enabled && /learn/i.test(agent.role))?.id ?? ""
        ],
      mission: plan.deploy.firstMissions[2]
    }
  ].filter((entry) => entry.agentId && entry.mission);

  const runIds: string[] = [];

  if (kickoffAssignments.length === 0) {
    await options.onProgress?.({
      message: "No planner kickoff missions. Finalizing deploy.",
      percent: 100,
      status: "done"
    });
  }

  for (const [index, assignment] of kickoffAssignments.entries()) {
    const startingPercent = Math.round((index / kickoffAssignments.length) * 100);

    await options.onProgress?.({
      message: `Dispatching kickoff ${index + 1} of ${kickoffAssignments.length} to ${assignment.agentId}.`,
      percent: startingPercent,
      status: "active"
    });

    try {
      const response = await submitMission({
        agentId: assignment.agentId,
        workspaceId,
        mission: assignment.mission,
        thinking: "medium"
      });
      runIds.push(response.runId || response.dispatchId || assignment.agentId);
      await options.onProgress?.({
        message: `Kickoff mission queued for ${assignment.agentId}. ${response.runId ? `Run ${response.runId}.` : `Dispatch ${response.dispatchId ?? "pending"}.`}`,
        percent: Math.round(((index + 1) / kickoffAssignments.length) * 100),
        status: "done"
      });
    } catch {
      await options.onProgress?.({
        message: `Kickoff mission could not be started for ${assignment.agentId}.`,
        percent: Math.round(((index + 1) / kickoffAssignments.length) * 100),
        status: "error"
      });
      continue;
    }
  }

  return runIds;
}

type PlannerHarvestResult = {
  sources: PlannerContextSource[];
  confirmations: string[];
  inferenceText: string;
  companyName?: string;
  companyNameConfidence?: number;
  mission?: string;
  offer?: string;
  targetCustomer?: string;
  successSignals?: string[];
  revenueModel?: string;
  template?: WorkspaceTemplate;
};

type WebsitePageSignals = {
  url: string;
  label: string;
  title?: string;
  description?: string;
  heading?: string;
  snippets: string[];
  companyName?: string;
  companyNameConfidence?: number;
  mission?: string;
  offer?: string;
  targetCustomer?: string;
  successSignals: string[];
  revenueModel?: string;
  template?: WorkspaceTemplate;
};

async function harvestPlannerContext(message: string): Promise<PlannerHarvestResult> {
  const urls = extractUrls(message);
  const confirmations: string[] = [];
  const sources: PlannerContextSource[] = [];
  const inferenceChunks: string[] = [];
  let companyName: string | undefined;
  let companyNameConfidence: number | undefined;
  let mission: string | undefined;
  let offer: string | undefined;
  let targetCustomer: string | undefined;
  let revenueModel: string | undefined;
  const successSignals: string[] = [];
  let template: WorkspaceTemplate | undefined;

  const websiteUrls: string[] = [];

  for (const url of urls) {
    if (isLikelyRepositoryUrl(url)) {
      sources.push(
        createPlannerContextSource({
          kind: "repo",
          label: summarizeUrlLabel(url),
          url,
          summary: "Repository candidate detected from the prompt.",
          details: ["The architect will treat this link as a repository source."]
        })
      );
      continue;
    }
    websiteUrls.push(url);
  }

  const inspectedWebsites = await Promise.all(websiteUrls.map((url) => inspectWebsiteContext(url)));

  for (const inspected of inspectedWebsites) {
    sources.push(inspected.source);

    if (inspected.inferenceText) {
      inferenceChunks.push(inspected.inferenceText);
    }

    if (
      inspected.companyName &&
      (companyNameConfidence === undefined || (inspected.companyNameConfidence ?? 0) >= companyNameConfidence)
    ) {
      companyName = inspected.companyName;
      companyNameConfidence = inspected.companyNameConfidence;
    }

    if (!mission && inspected.mission) {
      mission = inspected.mission;
    }

    if (!offer && inspected.offer) {
      offer = inspected.offer;
    }

    if (!targetCustomer && inspected.targetCustomer) {
      targetCustomer = inspected.targetCustomer;
    }

    if (!revenueModel && inspected.revenueModel) {
      revenueModel = inspected.revenueModel;
    }

    successSignals.push(...(inspected.successSignals ?? []));

    if (!template && inspected.template) {
      template = inspected.template;
    }

    confirmations.push(...inspected.confirmations);
  }

  return {
    sources,
    confirmations: uniqueStrings(confirmations),
    inferenceText: [message.trim(), ...inferenceChunks].filter(Boolean).join("\n"),
    companyName,
    companyNameConfidence,
    mission,
    offer,
    targetCustomer,
    successSignals: uniqueStrings(successSignals).slice(0, 3),
    revenueModel,
    template
  };
}

async function inspectWebsiteContext(url: string): Promise<{
  source: PlannerContextSource;
  confirmations: string[];
  inferenceText: string;
  companyName?: string;
  companyNameConfidence?: number;
  mission?: string;
  offer?: string;
  targetCustomer?: string;
  successSignals?: string[];
  revenueModel?: string;
  template?: WorkspaceTemplate;
}> {
  const label = summarizeUrlLabel(url);

  try {
    const response = await fetchWebsiteResponse(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    const primaryPage = inspectWebsitePage(url, html);
    const followUpUrls = collectWebsiteFollowUpUrls(url, html);
    const followUpPages = await Promise.all(
      followUpUrls.map(async (followUpUrl) => {
        try {
          const followUpResponse = await fetchWebsiteResponse(followUpUrl, WEBSITE_FOLLOWUP_TIMEOUT_MS);

          if (!followUpResponse.ok) {
            return null;
          }

          const followUpHtml = await followUpResponse.text();
          return inspectWebsitePage(followUpUrl, followUpHtml);
        } catch {
          return null;
        }
      })
    );
    const pageSignals = [primaryPage, ...followUpPages.filter((page): page is WebsitePageSignals => Boolean(page))];
    const snippets = uniqueStrings(pageSignals.flatMap((page) => page.snippets)).slice(0, 8);
    const pageNotes = uniqueStrings(
      pageSignals.flatMap((page) => {
        const notes: string[] = [];

        if (page.title) {
          notes.push(`${page.label} title: ${page.title}`);
        }

        if (page.description) {
          notes.push(`${page.label} summary: ${page.description}`);
        }

        if (page.heading && page.heading !== page.description) {
          notes.push(`${page.label} heading: ${page.heading}`);
        }

        for (const snippet of page.snippets.slice(0, 3)) {
          notes.push(`${page.label} note: ${snippet}`);
        }

        return notes;
      })
    ).slice(0, 12);
    const harvestText = uniqueStrings(
      pageSignals.flatMap((page) => [page.title ?? "", page.description ?? "", page.heading ?? "", ...page.snippets])
    )
      .filter(Boolean)
      .join(" ");
    const companyCandidates = pageSignals
      .map((page, index) =>
        page.companyName
          ? ({
              name: page.companyName,
              confidence: page.companyNameConfidence ?? undefined,
              primary: index === 0
            } satisfies { name: string; confidence: number | undefined; primary: boolean })
          : null
      )
      .filter(
        (candidate): candidate is { name: string; confidence: number | undefined; primary: boolean } =>
          Boolean(candidate)
      );
    const chosenCompany = companyCandidates.sort(
      (left, right) =>
        (right.confidence ?? 0) - (left.confidence ?? 0) || Number(right.primary) - Number(left.primary)
    )[0];
    const inferredCompanyName = chosenCompany?.name ?? inferCompanyNameFromUrl(url);
    const companyNameConfidence = chosenCompany?.confidence ?? (inferredCompanyName ? 86 : undefined);
    const inferredMission =
      pickBestWebsiteText(pageSignals.map((page) => page.mission)) ?? primaryPage.description ?? primaryPage.heading;
    const inferredOffer =
      pickBestWebsiteText(pageSignals.map((page) => page.offer)) ?? primaryPage.description ?? primaryPage.heading;
    const templateHint = detectTemplateFromHarvest(
      [primaryPage.title, primaryPage.description, primaryPage.heading, ...snippets, ...pageNotes].filter(Boolean).join(" ")
    );
    const inferredTargetCustomer =
      pickBestWebsiteText(pageSignals.map((page) => page.targetCustomer)) ?? inferTargetCustomerFromHarvest(harvestText);
    const inferredSuccessSignals = uniqueStrings([
      ...pageSignals.flatMap((page) => page.successSignals),
      ...inferSuccessSignalsFromHarvest(harvestText, templateHint)
    ]).slice(0, 3);
    const inferredRevenueModel =
      pickBestWebsiteText(pageSignals.map((page) => page.revenueModel)) ?? inferRevenueModelFromHarvest(harvestText);
    const confirmations: string[] = [];

    if (!primaryPage.description) {
      confirmations.push(`I read ${label}, but the homepage summary is still sparse.`);
    }

    if (followUpPages.some(Boolean)) {
      const followUpCount = followUpPages.filter(Boolean).length;
      confirmations.push(
        `I also checked ${followUpCount} supporting page${followUpCount === 1 ? "" : "s"} for extra context.`
      );
    }

    if (!primaryPage.heading && !inferredTargetCustomer) {
      confirmations.push(`I inspected ${label}, but the target customer is still not obvious from the site alone.`);
    }

    if (inferredCompanyName && companyNameConfidence && companyNameConfidence < 80) {
      confirmations.push(`I found a likely company name, ${inferredCompanyName}, and treated it as a draft assumption.`);
    }

    return {
      source: createPlannerContextSource({
        kind: "website",
        label: inferredCompanyName || label,
        url,
        summary:
          primaryPage.description ||
          primaryPage.heading ||
          pickBestWebsiteText(pageNotes) ||
          "Website context captured from the linked page.",
        details: pageNotes.length > 0 ? pageNotes : snippets,
        confidence: companyNameConfidence
      }),
      confirmations,
      inferenceText: [
        inferredCompanyName
          ? `Company name${companyNameConfidence ? ` (${companyNameConfidence}%)` : ""}: ${inferredCompanyName}`
          : "",
        inferredMission ? `Mission: ${inferredMission}` : "",
        inferredOffer ? `Offer: ${inferredOffer}` : "",
        inferredTargetCustomer ? `Target customer: ${inferredTargetCustomer}` : "",
        inferredRevenueModel ? `Revenue model: ${inferredRevenueModel}` : "",
        inferredSuccessSignals.length > 0 ? `Success signals: ${inferredSuccessSignals.join(" | ")}` : "",
        snippets.length > 0 ? `Website notes: ${snippets.join(" | ")}` : ""
      ]
        .filter(Boolean)
        .join("\n"),
      companyName: inferredCompanyName,
      companyNameConfidence,
      mission: inferredMission,
      offer: inferredOffer,
      targetCustomer: inferredTargetCustomer,
      successSignals: inferredSuccessSignals,
      revenueModel: inferredRevenueModel,
      template: templateHint
    };
  } catch (error) {
    return {
      source: createPlannerContextSource({
        kind: "website",
        label,
        url,
        summary: "Website could not be inspected automatically.",
        details: [],
        status: "error",
        error: error instanceof Error ? error.message : "Unknown website inspection error."
      }),
      confirmations: [`I could not inspect ${label}. Confirm the company context manually if this link matters.`],
      inferenceText: ""
    };
  }
}

function inspectWebsitePage(url: string, html: string): WebsitePageSignals {
  const title = extractPreferredMeta(html, ["og:title", "twitter:title"]) ?? extractTagText(html, "title");
  const siteName = extractPreferredMeta(html, ["og:site_name"]);
  const description =
    extractPreferredMeta(html, ["og:description", "twitter:description", "description"]) ??
    extractFirstParagraph(html);
  const heading = extractTagText(html, "h1");
  const headingSnippets = extractHeadingTexts(html, ["h2", "h3"]);
  const paragraphSnippets = extractParagraphs(html);
  const listItems = extractListItems(html);
  const snippets = uniqueStrings([heading ?? "", ...headingSnippets, ...paragraphSnippets, ...listItems]).filter(
    Boolean
  );
  const harvestText = [title ?? "", description ?? "", heading ?? "", ...snippets].filter(Boolean).join(" ");
  const titleCompanyName = cleanBrandName(title) ?? cleanBrandName(siteName);
  const domainCompanyName = inferCompanyNameFromUrl(url);
  const companyName = titleCompanyName ?? domainCompanyName;
  const companyNameConfidence = titleCompanyName
    ? 96
    : domainCompanyName
      ? domainCompanyName.length <= 3
        ? 78
        : 86
      : undefined;
  const template = detectTemplateFromHarvest(harvestText);

  return {
    url,
    label: summarizeUrlLabel(url),
    title,
    description,
    heading,
    snippets,
    companyName,
    companyNameConfidence,
    mission: pickBestWebsiteText([description, heading, headingSnippets[0], headingSnippets[1]]),
    offer: pickBestWebsiteText([description, heading, paragraphSnippets[0], paragraphSnippets[1]]),
    targetCustomer: inferTargetCustomerFromHarvest(harvestText),
    successSignals: inferSuccessSignalsFromHarvest(harvestText, template),
    revenueModel: inferRevenueModelFromHarvest(harvestText),
    template
  };
}

function collectWebsiteFollowUpUrls(baseUrl: string, html: string) {
  const base = new URL(baseUrl);
  const candidateUrls = new Set<string>();
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const pathPattern = /\b(about|company|team|story|mission|vision|pricing|plans?|services?|solutions?|products?|product|features?|faq|contact|support|docs?|learn|blog|work|why)\b/i;

  for (const match of html.matchAll(anchorPattern)) {
    const href = match[1]?.trim();

    if (!href || /^#|^mailto:|^tel:|^javascript:/i.test(href)) {
      continue;
    }

    try {
      const resolved = new URL(href, base);

      if (resolved.origin !== base.origin) {
        continue;
      }

      if (resolved.pathname === base.pathname && !resolved.search && !resolved.hash) {
        continue;
      }

      const normalized = normalizeWebsiteLink(resolved);
      const anchorText = cleanHtmlText(match[2] ?? "");

      if (!pathPattern.test(`${normalized.pathname} ${anchorText}`)) {
        continue;
      }

      candidateUrls.add(normalized.toString());

      if (candidateUrls.size >= 2) {
        break;
      }
    } catch {
      continue;
    }
  }

  return Array.from(candidateUrls);
}

function normalizeWebsiteLink(url: URL) {
  const normalized = new URL(url.toString());
  normalized.hash = "";
  normalized.search = "";
  return normalized;
}

function extractHeadingTexts(html: string, tags: Array<"h2" | "h3">) {
  return uniqueStrings(
    tags.flatMap((tagName) =>
      Array.from(html.matchAll(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "gi"))).map((match) =>
        cleanHtmlText(match[1])
      )
    ).filter((entry) => entry.length >= 24)
  ).slice(0, 6);
}

function extractListItems(html: string) {
  return uniqueStrings(
    Array.from(html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi))
      .map((match) => cleanHtmlText(match[1]))
      .filter((entry) => entry.length >= 24)
  ).slice(0, 6);
}

function pickBestWebsiteText(values: Array<string | undefined>) {
  return uniqueStrings(values.filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim()))
    .sort((left, right) => right.length - left.length)[0];
}

async function fetchWebsiteResponse(url: string, timeoutMs = WEBSITE_INSPECTION_TIMEOUT_MS) {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(
          new Error(`Website inspection timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`)
        );
      }, timeoutMs);
    });

    return await Promise.race([
      fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent": "OpenClaw AgentOS Planner/0.1"
        },
        cache: "no-store"
      }),
      timeoutPromise
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function applyHarvestedDefaults(plan: WorkspacePlan, harvest: PlannerHarvestResult) {
  let nextPlan = structuredClone(plan);

  if (harvest.template && nextPlan.workspace.template === "software" && harvest.template !== nextPlan.workspace.template) {
    nextPlan = applyPlannerTemplate(nextPlan, harvest.template);
  }

  if (!nextPlan.company.name && harvest.companyName && (harvest.companyNameConfidence ?? 0) >= 80) {
    nextPlan.company.name = harvest.companyName;
  }

  if (!nextPlan.company.mission && harvest.mission) {
    nextPlan.company.mission = harvest.mission;
  }

  if (!nextPlan.product.offer && harvest.offer) {
    nextPlan.product.offer = harvest.offer;
  }

  if (!nextPlan.company.targetCustomer && harvest.targetCustomer) {
    nextPlan.company.targetCustomer = harvest.targetCustomer;
  }

  if (!nextPlan.product.revenueModel && harvest.revenueModel) {
    nextPlan.product.revenueModel = harvest.revenueModel;
  }

  if (harvest.successSignals?.length) {
    nextPlan.company.successSignals = uniqueStrings([
      ...nextPlan.company.successSignals,
      ...harvest.successSignals
    ]).slice(0, 3);
  }

  return nextPlan;
}

function mergePlannerSources(current: PlannerContextSource[], incoming: PlannerContextSource[]) {
  const merged = [...current];

  for (const source of incoming) {
    const existingIndex = merged.findIndex(
      (entry) => (entry.url && source.url ? entry.url === source.url : entry.id === source.id)
    );

    if (existingIndex >= 0) {
      merged[existingIndex] = source;
      continue;
    }

    merged.push(source);
  }

  return merged;
}

function extractUrls(text: string) {
  const explicitUrls = text.match(/https?:\/\/[^\s)]+/g) ?? [];
  const bareDomains =
    text.match(/\b(?:www\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(?:\/[^\s)]*)?/gi) ??
    [];

  return Array.from(
    new Set(
      [...explicitUrls, ...bareDomains]
        .map((value) => normalizeUrlCandidate(value))
        .filter((value): value is string => Boolean(value))
    )
  );
}

function normalizeUrlCandidate(value: string) {
  if (value.includes("@")) {
    return null;
  }

  const cleaned = value.replace(/[),.;!?]+$/g, "");
  const candidate = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;

  try {
    const url = new URL(candidate);
    return url.hostname.includes(".") ? url.toString() : null;
  } catch {
    return null;
  }
}

function isLikelyRepositoryUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const pathname = url.pathname.toLowerCase();

    return (
      host === "github.com" ||
      host === "gitlab.com" ||
      host === "bitbucket.org" ||
      pathname.endsWith(".git")
    );
  } catch {
    return false;
  }
}

function summarizeUrlLabel(value: string) {
  try {
    const url = new URL(value);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

function inferTargetCustomerFromHarvest(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const lower = normalized.toLowerCase();

  const explicitPatterns = [
    /\b(?:for|serving|built for|designed for|helps?|empowers?|supports?)\s+([^.?!:\n]+)/i,
    /\b(?:users?|customers?|audience|members?)\s*[:\-]\s*([^.?!\n]+)/i
  ];

  for (const pattern of explicitPatterns) {
    const match = normalized.match(pattern);
    const candidate = sanitizeHarvestedSegment(match?.[1] ?? "");
    if (looksLikeCustomerSegment(candidate)) {
      return candidate;
    }
  }

  const hasWeb3 = /\bweb3|onchain|crypto|blockchain|token\b/.test(lower);
  const hasStartup = /\bstartup|startups|founder|founders|business(?:es)?\b/.test(lower);
  const hasCommunity = /\bcommunity|communities|member|members|holder|holders|nft|dao|governance\b/.test(lower);
  const hasDeveloper = /\bdeveloper|developers|builder|builders|engineer|engineers\b/.test(lower);
  const hasOperator = /\boperator|operators|moderator|moderators|admin|admins|ops\b/.test(lower);
  const hasBrand = /\bbrand|brands|creator|creators|marketing|marketers|growth teams?\b/.test(lower);

  if (hasStartup && hasCommunity) {
    return hasWeb3 ? "Web3 startups and token-led communities" : "Startups and their communities";
  }

  if (hasStartup) {
    return hasWeb3 ? "Web3 startups and founders" : "Startups and founders";
  }

  if (hasCommunity) {
    return hasWeb3 ? "DAO, NFT, and Web3 communities" : "Community leads and members";
  }

  if (hasDeveloper && hasOperator) {
    return "Developers and internal operators";
  }

  if (hasDeveloper) {
    return "Developers and technical teams";
  }

  if (hasBrand) {
    return "Brands and growth teams";
  }

  if (hasOperator) {
    return "Internal operators and moderators";
  }

  return undefined;
}

function inferSuccessSignalsFromHarvest(text: string, template?: WorkspaceTemplate) {
  const lower = text.toLowerCase();
  const signals: string[] = [];

  if (
    template === "content" ||
    /\bcommunity|telegram|discord|dao|governance|holder|member|members\b/.test(lower)
  ) {
    signals.push("Higher weekly active participation from the target community");
  }

  if (/\bautonom|automate|automation|operate|agents?\b/.test(lower)) {
    signals.push("More work completed autonomously with less manual operator time");
  }

  if (/\bgrow|growth|startup|startups|business(?:es)?\b/.test(lower)) {
    signals.push("More active teams or ventures operating through the workspace");
  }

  return uniqueStrings(signals).slice(0, 3);
}

function inferRevenueModelFromHarvest(text: string) {
  const lower = text.toLowerCase();

  if (/\bsubscription|pricing|plan\b/.test(lower)) {
    return "Subscription software";
  }

  if (/\bprofit share|share in company profits|revenue share\b/.test(lower)) {
    return "Revenue share or profit participation";
  }

  if (/\bnft holders?\b|\btoken holders?\b|\btoken-gated\b/.test(lower)) {
    return "Token or membership-gated participation";
  }

  return undefined;
}

function looksLikeCustomerSegment(value: string) {
  const lower = value.toLowerCase();

  if (!lower || lower.split(/\s+/).length > 12) {
    return false;
  }

  if (/\b(create|operate|grow|power|launch|build|manage|automate|using|with|through)\b/.test(lower)) {
    return false;
  }

  return /\b(user|users|customer|customers|audience|founder|founders|startup|startups|developer|developers|operator|operators|teams?|community|communities|members?|holders?|dao|nft|brand|brands|creator|creators|business|businesses)\b/.test(
    lower
  );
}

function sanitizeHarvestedSegment(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/^[\s:,-]+|[\s:,-]+$/g, "")
    .trim();
}

function detectTemplateFromHarvest(value: string): WorkspaceTemplate | undefined {
  const lower = value.toLowerCase();

  if (/\b(telegram|discord|community|topluluk|content|newsletter|growth|seo)\b/.test(lower)) {
    return "content";
  }

  if (/\b(api|backend|service|infrastructure)\b/.test(lower)) {
    return "backend";
  }

  if (/\b(app|platform|software|product|dashboard)\b/.test(lower)) {
    return "software";
  }

  return undefined;
}

function extractPreferredMeta(html: string, names: string[]) {
  for (const name of names) {
    const value = extractMetaContent(html, name);
    if (value) {
      return value;
    }
  }

  return undefined;
}

function extractMetaContent(html: string, name: string) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${escapeRegex(name)}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escapeRegex(name)}["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+name=["']${escapeRegex(name)}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${escapeRegex(name)}["'][^>]*>`, "i")
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return cleanHtmlText(match[1]);
    }
  }

  return undefined;
}

function extractTagText(html: string, tagName: string) {
  const match = html.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match?.[1] ? cleanHtmlText(match[1]) : undefined;
}

function extractFirstParagraph(html: string) {
  return extractParagraphs(html)[0];
}

function extractParagraphs(html: string) {
  return Array.from(html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi))
    .map((match) => cleanHtmlText(match[1]))
    .filter((entry) => entry.length >= 40)
    .slice(0, 3);
}

function cleanBrandName(value?: string) {
  if (!value) {
    return undefined;
  }

  const parts = value
    .split(/[|:-]/)
    .map((part) => part.trim())
    .filter(Boolean);

  for (const part of parts) {
    if (!isGenericBrandFragment(part)) {
      const trimmed = part.trim();
      if (trimmed.length >= 2 && trimmed.length <= 60 && trimmed.split(/\s+/).length <= 8) {
        return trimmed;
      }
    }
  }

  return undefined;
}

function inferCompanyNameFromUrl(url: string) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    const labels = hostname.split(".").filter(Boolean);

    for (const label of labels) {
      if (isGenericBrandFragment(label)) {
        continue;
      }

      const candidate = label
        .split(/[-_]+/g)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ")
        .trim();

      if (candidate.length >= 2) {
        return candidate;
      }
    }

    return undefined;
  } catch {
    return undefined;
  }
}

function isGenericBrandFragment(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return true;
  }

  if (normalized.split(/\s+/).length > 5) {
    return true;
  }

  if (
    /\b(join|unlock|discover|learn|build|create|launch|get|start|experience|transform|empower|grow|reach|become)\b/.test(
      normalized
    ) &&
    normalized.split(/\s+/).length > 3
  ) {
    return true;
  }

  return /^(home|home page|homepage|welcome|index|dashboard|login|sign in|register|contact|about|blog|news|pricing|services?|support|help|docs?|portal|app|platform|product|products|solutions?|site|website|page|start|overview|landing|demo|example|test|dev|staging|beta|production|prod|localhost|auth)$/.test(
    normalized
  );
}

function cleanHtmlText(value: string) {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildCreatedAgentIdMap(plan: WorkspacePlan) {
  const workspaceSlug = slugify(plan.workspace.name);

  return Object.fromEntries(
    plan.team.persistentAgents
      .filter((agent) => agent.enabled)
      .map((agent) => [agent.id, `${workspaceSlug}-${slugify(agent.id) || "agent"}`])
  );
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}
