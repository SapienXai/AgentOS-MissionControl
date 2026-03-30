import {
  buildDefaultWorkspaceAgents,
  buildWorkspaceAgentName,
  buildWorkspaceScaffoldPreview
} from "@/lib/openclaw/workspace-presets";
import { normalizeWorkspaceDocOverrides } from "@/lib/openclaw/workspace-docs";
import { resolveAgentPolicy } from "@/lib/openclaw/agent-presets";
import type {
  PlannerAdvisorId,
  PlannerAdvisorNote,
  PlannerAutomationSpec,
  PlannerChannelSpec,
  PlannerContextSource,
  PlannerContextSourceKind,
  PlannerChannelType,
  PlannerDecisionStatus,
  PlannerInference,
  PlannerHookSpec,
  PlannerIntakeState,
  PlannerMessage,
  PlannerPersistentAgentSpec,
  PlannerRuntimeState,
  PlannerSandboxSpec,
  PlannerWorkspaceSize,
  PlannerWorkflowSpec,
  WorkspaceCreateRules,
  WorkspacePlan,
  WorkspaceTemplate
} from "@/lib/openclaw/types";

const advisorNames: Record<PlannerAdvisorId, string> = {
  founder: "Founder",
  product: "Product Lead",
  architect: "System Architect",
  ops: "Operations",
  growth: "Growth",
  reviewer: "Reviewer"
};

export type PlannerWorkspaceSizeProfile = {
  label: string;
  agentCount: number;
  workflowCount: number;
  automationCount: number;
  externalChannelCount: number;
  confirmationLimit: number;
  suggestedReplyLimit: number;
};

export const plannerWorkspaceSizeOrder: PlannerWorkspaceSize[] = ["small", "medium", "large"];

const plannerWorkspaceSizeProfiles: Record<PlannerWorkspaceSize, PlannerWorkspaceSizeProfile> = {
  small: {
    label: "Small",
    agentCount: 1,
    workflowCount: 1,
    automationCount: 0,
    externalChannelCount: 0,
    confirmationLimit: 1,
    suggestedReplyLimit: 2
  },
  medium: {
    label: "Medium",
    agentCount: 3,
    workflowCount: 3,
    automationCount: 1,
    externalChannelCount: 0,
    confirmationLimit: 2,
    suggestedReplyLimit: 3
  },
  large: {
    label: "Large",
    agentCount: 5,
    workflowCount: 4,
    automationCount: 2,
    externalChannelCount: 1,
    confirmationLimit: 3,
    suggestedReplyLimit: 4
  }
};

const initialWorkspaceRules: WorkspaceCreateRules = {
  workspaceOnly: true,
  generateStarterDocs: false,
  generateMemory: false,
  kickoffMission: false
};

const workspaceEditSourceId = "workspace-edit-source";

export function getPlannerWorkspaceSizeProfile(size: PlannerWorkspaceSize): PlannerWorkspaceSizeProfile {
  return plannerWorkspaceSizeProfiles[size] ?? plannerWorkspaceSizeProfiles.medium;
}

const channelDefinitions: Record<
  PlannerChannelType,
  {
    label: string;
    requiresCredentials: boolean;
    credentials: Array<{
      key: string;
      label: string;
      placeholder?: string;
      secret: boolean;
    }>;
  }
> = {
  internal: {
    label: "Internal",
    requiresCredentials: false,
    credentials: []
  },
  slack: {
    label: "Slack",
    requiresCredentials: true,
    credentials: [
      {
        key: "botToken",
        label: "Bot token",
        placeholder: "xoxb-...",
        secret: true
      }
    ]
  },
  telegram: {
    label: "Telegram",
    requiresCredentials: true,
    credentials: [
      {
        key: "token",
        label: "Bot token",
        placeholder: "123456:ABC...",
        secret: true
      }
    ]
  },
  discord: {
    label: "Discord",
    requiresCredentials: true,
    credentials: [
      {
        key: "token",
        label: "Bot token",
        placeholder: "Discord bot token",
        secret: true
      }
    ]
  },
  googlechat: {
    label: "Google Chat",
    requiresCredentials: true,
    credentials: [
      {
        key: "webhookUrl",
        label: "Webhook URL",
        placeholder: "https://chat.googleapis.com/...",
        secret: true
      }
    ]
  }
};

export function createWorkspacePlanId() {
  return globalThis.crypto?.randomUUID?.() ?? `plan-${Date.now()}`;
}

export function createPlannerMessage(
  role: PlannerMessage["role"],
  author: string,
  text: string
): PlannerMessage {
  return {
    id: createWorkspacePlanId(),
    role,
    author,
    text,
    createdAt: new Date().toISOString()
  };
}

export function createPlannerContextSource(
  seed: Partial<PlannerContextSource> & {
    kind: PlannerContextSourceKind;
    label: string;
    summary: string;
  }
): PlannerContextSource {
  return {
    id: seed.id?.trim() || createWorkspacePlanId(),
    kind: seed.kind,
    label: seed.label.trim(),
    summary: seed.summary.trim(),
    details: normalizeList(seed.details),
    status: seed.status ?? "ready",
    createdAt: seed.createdAt ?? new Date().toISOString(),
    confidence:
      typeof seed.confidence === "number" ? Math.max(0, Math.min(100, Math.round(seed.confidence))) : undefined,
    url: normalizeOptional(seed.url),
    error: normalizeOptional(seed.error)
  };
}

export function createPlannerInference(
  seed: Partial<PlannerInference> & {
    section: PlannerInference["section"];
    label: string;
    value: string;
  }
): PlannerInference {
  return {
    id: seed.id?.trim() || createWorkspacePlanId(),
    section: seed.section,
    label: seed.label.trim(),
    value: seed.value.trim(),
    confidence: Math.max(0, Math.min(100, Math.round(seed.confidence ?? 72))),
    status: seed.status ?? "inferred",
    rationale: normalizeText(seed.rationale ?? ""),
    sourceLabels: normalizeList(seed.sourceLabels)
  };
}

export function createPlannerAgentSpec(
  seed?: Partial<PlannerPersistentAgentSpec>
): PlannerPersistentAgentSpec {
  const id = slugify(seed?.id || seed?.name || "operator") || "operator";
  const role = seed?.role?.trim() || "Operator";
  const name = seed?.name?.trim() || prettify(id);

  return {
    id,
    role,
    name,
    purpose: seed?.purpose?.trim() || `${name} owns ${role.toLowerCase()} execution and handoffs.`,
    enabled: seed?.enabled !== false,
    isPrimary: Boolean(seed?.isPrimary),
    emoji: seed?.emoji?.trim(),
    theme: seed?.theme?.trim(),
    skillId: seed?.skillId?.trim(),
    modelId: seed?.modelId?.trim(),
    policy: seed?.policy ?? resolveAgentPolicy("worker"),
    heartbeat: seed?.heartbeat ?? { enabled: false },
    responsibilities: normalizeList(seed?.responsibilities),
    outputs: normalizeList(seed?.outputs),
    channelIds: normalizeList(seed?.channelIds)
  };
}

export function createPlannerWorkflowSpec(
  seed?: Partial<PlannerWorkflowSpec>
): PlannerWorkflowSpec {
  return {
    id: slugify(seed?.id || seed?.name || `workflow-${Date.now()}`) || `workflow-${Date.now()}`,
    name: seed?.name?.trim() || "New workflow",
    goal: seed?.goal?.trim() || "",
    trigger: seed?.trigger ?? "manual",
    ownerAgentId: seed?.ownerAgentId?.trim(),
    collaboratorAgentIds: normalizeList(seed?.collaboratorAgentIds),
    successDefinition: seed?.successDefinition?.trim() || "",
    outputs: normalizeList(seed?.outputs),
    channelIds: normalizeList(seed?.channelIds),
    enabled: seed?.enabled !== false
  };
}

export function createPlannerChannelSpec(
  type: PlannerChannelType = "internal",
  seed?: Partial<PlannerChannelSpec>
): PlannerChannelSpec {
  const channelTemplate = channelDefinitions[type];

  return {
    id: slugify(seed?.id || seed?.name || `${type}-${Date.now()}`) || `${type}-${Date.now()}`,
    type,
    name: seed?.name?.trim() || channelTemplate.label,
    purpose: seed?.purpose?.trim() || "",
    target: seed?.target?.trim(),
    enabled: seed?.enabled !== false,
    announce: Boolean(seed?.announce),
    requiresCredentials: channelTemplate.requiresCredentials,
    accountId: seed?.accountId?.trim(),
    primaryAgentId: seed?.primaryAgentId?.trim() ?? null,
    allowedChatIds: normalizeList(seed?.allowedChatIds),
    groupAssignments: Array.isArray(seed?.groupAssignments)
      ? seed.groupAssignments
          .map((assignment) => ({
            chatId: typeof assignment.chatId === "string" ? assignment.chatId.trim() : "",
            agentId: typeof assignment.agentId === "string" ? assignment.agentId.trim() : null,
            title: typeof assignment.title === "string" ? assignment.title.trim() : null,
            enabled: assignment.enabled !== false
          }))
          .filter((assignment) => Boolean(assignment.chatId))
      : [],
    credentials:
      seed?.credentials?.map((credential) => ({
        ...credential,
        value: credential.value ?? ""
      })) ??
      channelTemplate.credentials.map((credential) => ({
        ...credential,
        value: ""
      }))
  };
}

export function createPlannerAutomationSpec(
  seed?: Partial<PlannerAutomationSpec>
): PlannerAutomationSpec {
  return {
    id: slugify(seed?.id || seed?.name || `automation-${Date.now()}`) || `automation-${Date.now()}`,
    name: seed?.name?.trim() || "New automation",
    description: seed?.description?.trim() || "",
    enabled: seed?.enabled !== false,
    scheduleKind: seed?.scheduleKind ?? "every",
    scheduleValue: seed?.scheduleValue?.trim() || "24h",
    agentId: seed?.agentId?.trim(),
    mission: seed?.mission?.trim() || "",
    thinking: seed?.thinking ?? "medium",
    announce: Boolean(seed?.announce),
    channelId: seed?.channelId?.trim()
  };
}

export function createPlannerHookSpec(seed?: Partial<PlannerHookSpec>): PlannerHookSpec {
  return {
    id: slugify(seed?.id || seed?.name || `hook-${Date.now()}`) || `hook-${Date.now()}`,
    name: seed?.name?.trim() || "New hook",
    source: seed?.source?.trim() || "",
    enabled: seed?.enabled !== false,
    notes: seed?.notes?.trim() || ""
  };
}

export function createPlannerSandboxSpec(seed?: Partial<PlannerSandboxSpec>): PlannerSandboxSpec {
  return {
    workspaceOnly: seed?.workspaceOnly ?? true,
    mode: seed?.mode ?? "default",
    notes: normalizeList(seed?.notes)
  };
}

export function createPlannerIntakeState(seed?: Partial<PlannerIntakeState>): PlannerIntakeState {
  return {
    started: Boolean(seed?.started),
    initialPrompt: normalizeText(seed?.initialPrompt ?? ""),
    latestPrompt: normalizeText(seed?.latestPrompt ?? ""),
    sources: (seed?.sources ?? []).map((source) => createPlannerContextSource(source)),
    confirmations: normalizeList(seed?.confirmations)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(0, 3),
    mode: seed?.mode === "advanced" ? "advanced" : "guided",
    size:
      seed?.size === "small" || seed?.size === "large"
        ? seed.size
        : "medium",
    reviewRequested: Boolean(seed?.reviewRequested),
    turnCount: Math.max(0, Math.floor(seed?.turnCount ?? 0)),
    inferences: (seed?.inferences ?? []).map((inference) => createPlannerInference(inference)),
    suggestedReplies: normalizeList(seed?.suggestedReplies).slice(0, 4)
  };
}

export function createPlannerRuntimeState(
  planId: string,
  seed?: Partial<PlannerRuntimeState>
): PlannerRuntimeState {
  const architectSessionId = seed?.architectSessionId?.trim() || `planner-${planId}-architect`;
  const advisorAgentIds = Object.fromEntries(
    Object.entries(seed?.advisorAgentIds ?? {}).filter(([, value]) => typeof value === "string" && value.trim())
  ) as PlannerRuntimeState["advisorAgentIds"];
  const advisorSessionIds = Object.fromEntries(
    (Object.entries(advisorNames) as Array<[PlannerAdvisorId, string]>).map(([advisorId]) => [
      advisorId,
      seed?.advisorSessionIds?.[advisorId]?.trim() || `planner-${planId}-${advisorId}`
    ])
  ) as PlannerRuntimeState["advisorSessionIds"];

  return {
    mode: seed?.mode === "fallback" ? "fallback" : "agent",
    status: seed?.status === "error" ? "error" : seed?.status === "ready" ? "ready" : "pending",
    workspaceId: normalizeOptional(seed?.workspaceId),
    workspacePath: normalizeOptional(seed?.workspacePath),
    architectAgentId: normalizeOptional(seed?.architectAgentId),
    architectSessionId,
    advisorAgentIds,
    advisorSessionIds,
    lastArchitectRunId: normalizeOptional(seed?.lastArchitectRunId),
    lastAdvisorRunIds: normalizeList(seed?.lastAdvisorRunIds),
    lastError: normalizeOptional(seed?.lastError)
  };
}

export function buildRecommendedPlannerAgents(template: WorkspaceTemplate, workspaceName?: string) {
  return buildDefaultWorkspaceAgents(template, "core", workspaceName).map((agent) =>
    createPlannerAgentSpec({
      id: agent.id,
      role: agent.role,
      name: agent.name,
      purpose: describeRecommendedPurpose(agent.id, agent.role, template),
      enabled: agent.enabled,
      isPrimary: agent.isPrimary,
      emoji: agent.emoji,
      theme: agent.theme,
      skillId: agent.skillId,
      modelId: agent.modelId,
      policy: agent.policy ?? resolveAgentPolicy("worker"),
      heartbeat: agent.heartbeat ?? { enabled: false },
      responsibilities: describeRecommendedResponsibilities(agent.id, template),
      outputs: describeRecommendedOutputs(agent.id, template)
    })
  );
}

export function buildRecommendedPlannerWorkflows(
  template: WorkspaceTemplate,
  agents: PlannerPersistentAgentSpec[]
) {
  const primaryAgentId = agents.find((agent) => agent.enabled && agent.isPrimary)?.id;
  const reviewerAgentId = findAgentId(agents, "review");
  const testerAgentId = findAgentId(agents, "test");
  const learnerAgentId = findAgentId(agents, "learn");
  const browserAgentId = findAgentId(agents, "browser");

  if (template === "research") {
    return [
      createPlannerWorkflowSpec({
        id: "research-loop",
        name: "Research loop",
        goal: "Turn the main question into evidence-backed findings and explicit unknowns.",
        trigger: "manual",
        ownerAgentId: primaryAgentId,
        collaboratorAgentIds: [learnerAgentId, reviewerAgentId].filter(Boolean) as string[],
        successDefinition: "Question, evidence, synthesis, and next-step recommendations are documented.",
        outputs: ["docs/research-plan.md", "deliverables/<run>/research-summary.md"]
      }),
      createPlannerWorkflowSpec({
        id: "finding-review",
        name: "Finding review",
        goal: "Pressure-test claims before publishing or acting on them.",
        trigger: "manual",
        ownerAgentId: reviewerAgentId ?? primaryAgentId,
        collaboratorAgentIds: [primaryAgentId].filter(Boolean) as string[],
        successDefinition: "Assumptions, risks, and evidence gaps are explicit.",
        outputs: ["deliverables/<run>/review-notes.md"]
      })
    ];
  }

  if (template === "content") {
    return [
      createPlannerWorkflowSpec({
        id: "strategy",
        name: "Strategy and briefing",
        goal: "Clarify audience, offer, channels, and campaign bets before production.",
        trigger: "manual",
        ownerAgentId: primaryAgentId,
        collaboratorAgentIds: [reviewerAgentId, learnerAgentId].filter(Boolean) as string[],
        successDefinition: "The team agrees on brief, priorities, and success signals.",
        outputs: ["docs/content-brief.md", "deliverables/<run>/campaign-brief.md"]
      }),
      createPlannerWorkflowSpec({
        id: "production",
        name: "Production and QA",
        goal: "Create assets, review them, and prepare a launch package.",
        trigger: "manual",
        ownerAgentId: primaryAgentId,
        collaboratorAgentIds: [reviewerAgentId].filter(Boolean) as string[],
        successDefinition: "Assets are approved and delivery-ready.",
        outputs: ["deliverables/<run>/drafts/", "deliverables/<run>/launch-package.md"]
      }),
      createPlannerWorkflowSpec({
        id: "performance-loop",
        name: "Performance loop",
        goal: "Review outcomes, learn from results, and feed the next iteration.",
        trigger: "cron",
        ownerAgentId: learnerAgentId ?? reviewerAgentId ?? primaryAgentId,
        collaboratorAgentIds: [primaryAgentId].filter(Boolean) as string[],
        successDefinition: "Measured results and next changes are documented.",
        outputs: ["deliverables/<run>/performance-review.md"]
      })
    ];
  }

  const buildOwner = browserAgentId && template === "frontend" ? browserAgentId : primaryAgentId;

  return [
    createPlannerWorkflowSpec({
      id: "scope-v1",
      name: "V1 shaping",
      goal: "Turn the product goal into a constrained first delivery batch.",
      trigger: "manual",
      ownerAgentId: primaryAgentId,
      collaboratorAgentIds: [learnerAgentId, reviewerAgentId].filter(Boolean) as string[],
      successDefinition: "Scope, non-goals, and critical path are documented.",
      outputs: ["docs/brief.md", "memory/blueprint.md"]
    }),
    createPlannerWorkflowSpec({
      id: "delivery",
      name: "Delivery loop",
      goal: "Implement, validate, and hand off the next meaningful increment.",
      trigger: "manual",
      ownerAgentId: buildOwner,
      collaboratorAgentIds: [testerAgentId, reviewerAgentId].filter(Boolean) as string[],
      successDefinition: "A tested increment ships with review notes and clear handoff.",
      outputs: ["deliverables/<run>/release-notes.md", "deliverables/<run>/verification.md"]
    }),
    createPlannerWorkflowSpec({
      id: "launch-readiness",
      name: "Launch readiness",
      goal: "Check blockers, rollback posture, and communication before launch.",
      trigger: "launch",
      ownerAgentId: reviewerAgentId ?? primaryAgentId,
      collaboratorAgentIds: [testerAgentId, learnerAgentId].filter(Boolean) as string[],
      successDefinition: "Launch risks, open blockers, and go/no-go signal are explicit.",
      outputs: ["deliverables/<run>/launch-checklist.md"]
    })
  ];
}

export function buildRecommendedPlannerChannels() {
  return [
    createPlannerChannelSpec("internal", {
      id: "internal-ops",
      name: "Internal ops",
      purpose: "Default internal coordination surface for planner outputs and deploy notes.",
      announce: false
    })
  ];
}

export function buildRecommendedPlannerAutomations(
  template: WorkspaceTemplate,
  agents: PlannerPersistentAgentSpec[],
  channels: PlannerChannelSpec[]
) {
  const reviewerAgentId = findAgentId(agents, "review") ?? agents.find((agent) => agent.enabled)?.id;
  const learnerAgentId = findAgentId(agents, "learn") ?? reviewerAgentId;
  const internalChannelId = channels[0]?.id;

  const items = [
    createPlannerAutomationSpec({
      id: "daily-triage",
      name: "Daily triage",
      description: "Review drift, blockers, and next handoffs every day.",
      scheduleKind: "every",
      scheduleValue: "24h",
      agentId: reviewerAgentId,
      mission:
        template === "content"
          ? "Review active campaigns, blockers, and next content handoffs. Leave a concise operator brief."
          : "Inspect the workspace, surface blockers, and leave a concise next-step handoff for the team.",
      thinking: "medium",
      channelId: internalChannelId
    }),
    createPlannerAutomationSpec({
      id: "weekly-review",
      name: "Weekly review",
      description: "Capture progress, decisions, and next bets once per week.",
      scheduleKind: "every",
      scheduleValue: "168h",
      agentId: learnerAgentId,
      mission:
        template === "research"
          ? "Summarize evidence gathered this week, open questions, and the next investigation batch."
          : "Summarize progress, major decisions, and the next delivery batch for this workspace.",
      thinking: "high",
      channelId: internalChannelId
    })
  ];

  return items.filter((item) => item.agentId);
}

export function buildRecommendedPlannerHooks() {
  return [
    createPlannerHookSpec({
      id: "handoff-audit",
      name: "Handoff audit",
      source: "workspace manifest",
      enabled: true,
      notes: "Keep delivery artifacts and handoffs durable enough for other agents to continue."
    })
  ];
}

export function buildRecommendedFirstMissions(plan: WorkspacePlan) {
  const primaryAgent = plan.team.persistentAgents.find((agent) => agent.enabled && agent.isPrimary);
  const reviewerAgent = plan.team.persistentAgents.find((agent) => /review/i.test(agent.role) && agent.enabled);
  const learnerAgent = plan.team.persistentAgents.find((agent) => /learn/i.test(agent.role) && agent.enabled);

  return uniqueStrings(
    [
      primaryAgent
        ? `Inspect the new workspace, refine docs to match the blueprint, and break the first delivery batch into concrete tasks.`
        : "",
      reviewerAgent
        ? `Review the blueprint against the created workspace, call out execution risks, and leave a launch-readiness checklist.`
        : "",
      learnerAgent
        ? `Capture durable facts, decisions, and conventions in memory files so the team can continue without drift.`
        : ""
    ].filter(Boolean)
  );
}

function buildSupplementalPlannerAgents(template: WorkspaceTemplate) {
  const opsLead = createPlannerAgentSpec({
    id: "ops-lead",
    role: "Operations Lead",
    name: "Operations Lead",
    purpose: "Own automations, reporting cadence, and cross-agent handoffs for the workspace.",
    responsibilities: ["Maintain the operating cadence", "Wire recurring automations", "Keep handoffs durable"],
    outputs: ["ops brief", "automation notes"]
  });

  if (template === "research") {
    return [
      createPlannerAgentSpec({
        id: "analyst",
        role: "Analyst",
        name: "Analyst",
        purpose: "Turn gathered evidence into patterns, themes, and decision-ready summaries.",
        responsibilities: ["Cluster findings", "Spot repeated signals", "Prepare concise summaries"],
        outputs: ["insight summary", "theme map"]
      }),
      opsLead
    ];
  }

  return [opsLead];
}

function buildSupplementalPlannerWorkflows(
  template: WorkspaceTemplate,
  agents: PlannerPersistentAgentSpec[]
) {
  const primaryAgentId = agents.find((agent) => agent.enabled && agent.isPrimary)?.id;
  const reviewerAgentId = findAgentId(agents, "review");
  const learnerAgentId = findAgentId(agents, "learn");
  const opsAgentId = findAgentId(agents, "ops");

  return [
    createPlannerWorkflowSpec({
      id: "context-sync",
      name: template === "research" ? "Evidence sync" : "Context sync",
      goal: "Pull new context from linked sources and keep the blueprint aligned with reality.",
      trigger: "manual",
      ownerAgentId: learnerAgentId ?? primaryAgentId,
      collaboratorAgentIds: [primaryAgentId, reviewerAgentId].filter(Boolean) as string[],
      successDefinition: "New context is reflected in durable docs, scope, and decision notes.",
      outputs: ["memory/blueprint.md", "deliverables/<run>/context-sync.md"]
    }),
    createPlannerWorkflowSpec({
      id: "ops-rhythm",
      name: "Operating rhythm",
      goal: "Review handoffs, automations, and next-step ownership on a repeatable cadence.",
      trigger: "cron",
      ownerAgentId: opsAgentId ?? reviewerAgentId ?? learnerAgentId ?? primaryAgentId,
      collaboratorAgentIds: [primaryAgentId].filter(Boolean) as string[],
      successDefinition: "The workspace has a fresh operator brief and an explicit next batch of work.",
      outputs: ["deliverables/<run>/ops-rhythm.md"]
    })
  ];
}

function buildRecommendedExternalPlannerChannels(template: WorkspaceTemplate) {
  const channelOrder: PlannerChannelType[] =
    template === "content"
      ? ["telegram", "discord", "slack"]
      : ["slack", "discord", "telegram"];

  return channelOrder.map((type) =>
    createPlannerChannelSpec(type, {
      id: `${type}-ops`,
      purpose:
        template === "content"
          ? "Optional distribution or community surface for a larger operating setup."
          : "Optional external operating surface for a larger workspace.",
      enabled: false,
      announce: true
    })
  );
}

function applyPlannerWorkspaceSizeProfile(plan: WorkspacePlan) {
  const nextPlan = clonePlan(plan);
  const profile = getPlannerWorkspaceSizeProfile(nextPlan.intake.size);

  nextPlan.team.persistentAgents = resizePlannerAgents(
    nextPlan.workspace.template,
    nextPlan.team.persistentAgents,
    profile.agentCount
  );
  nextPlan.operations.channels = resizePlannerChannels(
    nextPlan.workspace.template,
    nextPlan.operations.channels,
    profile.externalChannelCount
  );
  nextPlan.operations.workflows = resizePlannerWorkflows(
    nextPlan.workspace.template,
    nextPlan.operations.workflows,
    nextPlan.team.persistentAgents,
    profile.workflowCount
  );
  nextPlan.operations.automations = resizePlannerAutomations(
    nextPlan.workspace.template,
    nextPlan.operations.automations,
    nextPlan.team.persistentAgents,
    nextPlan.operations.channels,
    profile.automationCount
  );

  return nextPlan;
}

function resizePlannerAgents(
  template: WorkspaceTemplate,
  currentAgents: PlannerPersistentAgentSpec[],
  targetCount: number
) {
  if (targetCount <= 0) {
    return [];
  }

  const catalog = dedupeById(
    prioritizePrimaryAgent([
      ...currentAgents,
      ...buildRecommendedPlannerAgents(template),
      ...buildSupplementalPlannerAgents(template)
    ])
  );

  return catalog.slice(0, targetCount).map((agent, index) =>
    createPlannerAgentSpec({
      ...agent,
      enabled: true,
      isPrimary: agent.isPrimary || index === 0
    })
  );
}

function resizePlannerChannels(
  template: WorkspaceTemplate,
  currentChannels: PlannerChannelSpec[],
  externalTargetCount: number
) {
  const internalChannel =
    currentChannels.find((channel) => channel.type === "internal") ??
    buildRecommendedPlannerChannels()[0];
  const externalCatalog = dedupeByType([
    ...currentChannels.filter((channel) => channel.type !== "internal"),
    ...buildRecommendedExternalPlannerChannels(template)
  ]);

  return [
    createPlannerChannelSpec("internal", {
      ...internalChannel,
      enabled: true
    }),
    ...externalCatalog.slice(0, externalTargetCount)
  ];
}

function resizePlannerWorkflows(
  template: WorkspaceTemplate,
  currentWorkflows: PlannerWorkflowSpec[],
  agents: PlannerPersistentAgentSpec[],
  targetCount: number
) {
  if (targetCount <= 0) {
    return [];
  }

  const catalog = dedupeById([
    ...currentWorkflows,
    ...buildRecommendedPlannerWorkflows(template, agents),
    ...buildSupplementalPlannerWorkflows(template, agents)
  ]);

  return catalog.slice(0, targetCount).map((workflow) => alignPlannerWorkflowAgents(workflow, agents));
}

function resizePlannerAutomations(
  template: WorkspaceTemplate,
  currentAutomations: PlannerAutomationSpec[],
  agents: PlannerPersistentAgentSpec[],
  channels: PlannerChannelSpec[],
  targetCount: number
) {
  if (targetCount <= 0) {
    return [];
  }

  const catalog = dedupeById([
    ...currentAutomations,
    ...buildRecommendedPlannerAutomations(template, agents, channels)
  ]);

  return catalog
    .slice(0, targetCount)
    .map((automation) => alignPlannerAutomationDependencies(automation, agents, channels));
}

function alignPlannerWorkflowAgents(
  workflow: PlannerWorkflowSpec,
  agents: PlannerPersistentAgentSpec[]
) {
  const enabledAgentIds = new Set(agents.filter((agent) => agent.enabled).map((agent) => agent.id));
  const primaryAgentId = agents.find((agent) => agent.enabled && agent.isPrimary)?.id;
  const reviewerAgentId = findAgentId(agents, "review");
  const learnerAgentId = findAgentId(agents, "learn");
  const ownerAgentId =
    workflow.ownerAgentId && enabledAgentIds.has(workflow.ownerAgentId)
      ? workflow.ownerAgentId
      : reviewerAgentId ?? learnerAgentId ?? primaryAgentId;

  return createPlannerWorkflowSpec({
    ...workflow,
    ownerAgentId,
    collaboratorAgentIds: workflow.collaboratorAgentIds.filter(
      (agentId) => enabledAgentIds.has(agentId) && agentId !== ownerAgentId
    ),
    enabled: true
  });
}

function alignPlannerAutomationDependencies(
  automation: PlannerAutomationSpec,
  agents: PlannerPersistentAgentSpec[],
  channels: PlannerChannelSpec[]
) {
  const enabledAgentIds = new Set(agents.filter((agent) => agent.enabled).map((agent) => agent.id));
  const knownChannelIds = new Set(channels.map((channel) => channel.id));
  const primaryAgentId = agents.find((agent) => agent.enabled && agent.isPrimary)?.id;
  const reviewerAgentId = findAgentId(agents, "review");
  const learnerAgentId = findAgentId(agents, "learn");

  return createPlannerAutomationSpec({
    ...automation,
    agentId:
      automation.agentId && enabledAgentIds.has(automation.agentId)
        ? automation.agentId
        : reviewerAgentId ?? learnerAgentId ?? primaryAgentId,
    channelId:
      automation.channelId && knownChannelIds.has(automation.channelId)
        ? automation.channelId
        : channels[0]?.id,
    enabled: true
  });
}

export function createInitialWorkspacePlan(id = createWorkspacePlanId()): WorkspacePlan {
  const createdAt = new Date().toISOString();
  const template: WorkspaceTemplate = "software";
  const agents = buildRecommendedPlannerAgents(template);
  const channels = buildRecommendedPlannerChannels();
  const basePlan: WorkspacePlan = {
    id,
    status: "draft",
    stage: "intake",
    createdAt,
    updatedAt: createdAt,
    autopilot: true,
    readinessScore: 0,
    architectSummary: "",
    runtime: createPlannerRuntimeState(id),
    intake: createPlannerIntakeState(),
    company: {
      name: "",
      type: "saas",
      mission: "",
      targetCustomer: "",
      constraints: [],
      successSignals: []
    },
    product: {
      offer: "",
      scopeV1: [],
      nonGoals: [],
      revenueModel: "",
      launchPriority: []
    },
    workspace: {
      name: "",
      sourceMode: "empty",
      template,
      modelProfile: "balanced",
      stackDecisions: [],
      docs: buildWorkspaceScaffoldPreview(template, initialWorkspaceRules),
      docOverrides: [],
      rules: { ...initialWorkspaceRules }
    },
    team: {
      persistentAgents: agents,
      allowEphemeralSubagents: true,
      maxParallelRuns: 4,
      escalationRules: [
        "Escalate ambiguous product decisions to the architect before implementation.",
        "Escalate missing tooling or blocked environments before the delivery workflow starts.",
        "Escalate launch blockers when review or verification fails."
      ]
    },
    operations: {
      workflows: buildRecommendedPlannerWorkflows(template, agents),
      channels,
      automations: buildRecommendedPlannerAutomations(template, agents, channels),
      hooks: buildRecommendedPlannerHooks(),
      sandbox: createPlannerSandboxSpec({
        workspaceOnly: true,
        mode: "default",
        notes: ["Keep file work grounded in the target workspace by default."]
      })
    },
    deploy: {
      blockers: [],
      warnings: [],
      firstMissions: [],
      createdAgentIds: [],
      provisionedChannels: [],
      provisionedAutomations: [],
      kickoffRunIds: []
    },
    conversation: [
      createPlannerMessage(
        "assistant",
        "Workspace Architect",
        "Tell me the project in one prompt. I will infer the workspace shape, draft a full first pass, and you can revise anything as many times as you want."
      )
    ],
    advisorNotes: []
  };

  return enrichWorkspacePlan(basePlan);
}

export function applyPlannerTemplate(plan: WorkspacePlan, template: WorkspaceTemplate) {
  const nextPlan = clonePlan(plan);
  const recommendedAgents = buildRecommendedPlannerAgents(template, nextPlan.workspace.name);
  const recommendedChannels = nextPlan.operations.channels.length
    ? nextPlan.operations.channels
    : buildRecommendedPlannerChannels();

  nextPlan.workspace.template = template;
  nextPlan.workspace.docs = buildWorkspaceScaffoldPreview(template, nextPlan.workspace.rules);
  nextPlan.team.persistentAgents = recommendedAgents;
  nextPlan.operations.workflows = buildRecommendedPlannerWorkflows(template, recommendedAgents);
  nextPlan.operations.automations = buildRecommendedPlannerAutomations(
    template,
    recommendedAgents,
    recommendedChannels
  );

  return enrichWorkspacePlan(nextPlan);
}

export function enrichWorkspacePlan(plan: WorkspacePlan): WorkspacePlan {
  let nextPlan = clonePlan(plan);
  const isWorkspaceEditDraft = nextPlan.intake.sources.some((source) => source.id === workspaceEditSourceId);
  nextPlan.runtime = createPlannerRuntimeState(nextPlan.id, nextPlan.runtime);

  nextPlan.intake = createPlannerIntakeState({
    ...nextPlan.intake,
    started:
      Boolean(nextPlan.intake?.started) ||
      nextPlan.conversation.some((entry) => entry.role === "user")
  });

  nextPlan.company.name = normalizeText(nextPlan.company.name);
  nextPlan.company.mission = normalizeText(nextPlan.company.mission);
  nextPlan.company.targetCustomer = normalizeText(nextPlan.company.targetCustomer);
  nextPlan.company.constraints = normalizeList(nextPlan.company.constraints);
  nextPlan.company.successSignals = normalizeList(nextPlan.company.successSignals);

  nextPlan.product.offer = normalizeText(nextPlan.product.offer);
  nextPlan.product.scopeV1 = normalizeList(nextPlan.product.scopeV1);
  nextPlan.product.nonGoals = normalizeList(nextPlan.product.nonGoals);
  nextPlan.product.revenueModel = normalizeText(nextPlan.product.revenueModel);
  nextPlan.product.launchPriority = normalizeList(nextPlan.product.launchPriority);

  nextPlan.workspace.name = normalizeText(nextPlan.workspace.name);
  nextPlan.workspace.directory = normalizeOptional(nextPlan.workspace.directory);
  nextPlan.workspace.repoUrl = normalizeOptional(nextPlan.workspace.repoUrl);
  nextPlan.workspace.existingPath = normalizeOptional(nextPlan.workspace.existingPath);
  nextPlan.workspace.stackDecisions = normalizeList(nextPlan.workspace.stackDecisions);
  nextPlan.workspace.docs = uniqueStrings(
    normalizeList(nextPlan.workspace.docs).concat(
      buildWorkspaceScaffoldPreview(nextPlan.workspace.template, nextPlan.workspace.rules)
    )
  );
  nextPlan.workspace.docOverrides = normalizeWorkspaceDocOverrides(nextPlan.workspace.docOverrides);

  nextPlan.team.persistentAgents = nextPlan.team.persistentAgents
    .map((agent) =>
      createPlannerAgentSpec({
        ...agent,
        id: agent.id,
        role: agent.role,
        name: agent.name,
        purpose: agent.purpose,
        enabled: agent.enabled,
        isPrimary: agent.isPrimary,
        emoji: agent.emoji,
        theme: agent.theme,
        skillId: agent.skillId,
        modelId: agent.modelId,
        policy: agent.policy,
        heartbeat: agent.heartbeat,
        responsibilities: agent.responsibilities,
        outputs: agent.outputs
      })
    )
    .filter((agent, index, agents) => agents.findIndex((entry) => entry.id === agent.id) === index);

  if (!isWorkspaceEditDraft) {
    if (nextPlan.team.persistentAgents.length === 0) {
      nextPlan.team.persistentAgents = buildRecommendedPlannerAgents(
        nextPlan.workspace.template,
        nextPlan.workspace.name
      );
    }

    if (!nextPlan.team.persistentAgents.some((agent) => agent.enabled && agent.isPrimary)) {
      const firstEnabledAgent = nextPlan.team.persistentAgents.find((agent) => agent.enabled);
      if (firstEnabledAgent) {
        firstEnabledAgent.isPrimary = true;
      }
    }

    const primaryAgent = nextPlan.team.persistentAgents.find((agent) => agent.enabled && agent.isPrimary);
    if (primaryAgent && nextPlan.workspace.name && shouldRetitlePrimaryAgent(primaryAgent.name, primaryAgent.role)) {
      primaryAgent.name = buildWorkspaceAgentName(nextPlan.workspace.name, primaryAgent.role, primaryAgent.name);
    }
  } else if (!nextPlan.team.persistentAgents.some((agent) => agent.enabled && agent.isPrimary)) {
    const firstEnabledAgent = nextPlan.team.persistentAgents.find((agent) => agent.enabled);
    if (firstEnabledAgent) {
      firstEnabledAgent.isPrimary = true;
    }
  }

  nextPlan.operations.channels = nextPlan.operations.channels
    .map((channel) => createPlannerChannelSpec(channel.type, channel))
    .filter((channel, index, channels) => channels.findIndex((entry) => entry.id === channel.id) === index);

  if (!isWorkspaceEditDraft && nextPlan.operations.channels.length === 0) {
    nextPlan.operations.channels = buildRecommendedPlannerChannels();
  }

  nextPlan.operations.workflows = nextPlan.operations.workflows
    .map((workflow) => createPlannerWorkflowSpec(workflow))
    .filter((workflow, index, workflows) => workflows.findIndex((entry) => entry.id === workflow.id) === index);

  if (!isWorkspaceEditDraft && nextPlan.operations.workflows.length === 0) {
    nextPlan.operations.workflows = buildRecommendedPlannerWorkflows(
      nextPlan.workspace.template,
      nextPlan.team.persistentAgents
    );
  }

  nextPlan.operations.automations = nextPlan.operations.automations
    .map((automation) => createPlannerAutomationSpec(automation))
    .filter(
      (automation, index, automations) =>
        automations.findIndex((entry) => entry.id === automation.id) === index
    );

  if (!isWorkspaceEditDraft) {
    nextPlan = applyPlannerWorkspaceSizeProfile(nextPlan);
  }

  nextPlan.operations.hooks = nextPlan.operations.hooks
    .map((hook) => createPlannerHookSpec(hook))
    .filter((hook, index, hooks) => hooks.findIndex((entry) => entry.id === hook.id) === index);

  nextPlan.operations.sandbox = createPlannerSandboxSpec(nextPlan.operations.sandbox);
  if (!isWorkspaceEditDraft) {
    nextPlan.deploy.firstMissions = buildRecommendedFirstMissions(nextPlan);
  }

  const companyNameLooksGenerated = looksLikeGeneratedName(nextPlan.company.name);
  const workspaceNameLooksGenerated = looksLikeGeneratedName(nextPlan.workspace.name);

  if ((!nextPlan.company.name || companyNameLooksGenerated) && nextPlan.workspace.name && !workspaceNameLooksGenerated) {
    nextPlan.company.name = nextPlan.workspace.name;
  }

  if ((!nextPlan.workspace.name || workspaceNameLooksGenerated) && nextPlan.company.name && !companyNameLooksGenerated) {
    nextPlan.workspace.name = nextPlan.company.name;
  }

  if (!nextPlan.intake.started) {
    nextPlan.deploy.blockers = [];
    nextPlan.deploy.warnings = [];
    nextPlan.intake.confirmations = [];
    nextPlan.intake.inferences = [];
    nextPlan.intake.suggestedReplies = [];
    nextPlan.readinessScore = 0;
    nextPlan.architectSummary =
      "Start with one prompt. Paste the project goal, website URL, repo, or existing folder and the architect will draft the workspace for you.";
    nextPlan.stage = "intake";
    nextPlan.status = "draft";
    nextPlan.updatedAt = new Date().toISOString();

    return nextPlan;
  }

  const confirmations = buildPlannerConfirmations(nextPlan);
  const blockers = collectPlanBlockers(nextPlan);
  const warnings = collectPlanWarnings(nextPlan);
  const reviewMode = isPlannerReviewMode(nextPlan);

  nextPlan.intake.confirmations = confirmations;
  nextPlan.intake.inferences = buildPlannerInferences(nextPlan);
  nextPlan.intake.suggestedReplies = buildPlannerSuggestedReplies(nextPlan, confirmations);
  nextPlan.deploy.blockers = reviewMode ? blockers : [];
  nextPlan.deploy.warnings = reviewMode ? warnings : [];
  nextPlan.readinessScore = calculateReadinessScore(nextPlan, blockers, warnings, reviewMode);
  nextPlan.architectSummary = buildArchitectSummary(nextPlan, blockers, warnings, reviewMode);
  nextPlan.stage = resolvePlanStage(nextPlan, blockers, warnings, confirmations, reviewMode);
  nextPlan.status = resolvePlanStatus(nextPlan, blockers, confirmations, reviewMode);
  nextPlan.updatedAt = new Date().toISOString();

  return nextPlan;
}

export function applyPlannerInput(plan: WorkspacePlan, message: string) {
  const nextPlan = clonePlan(plan);
  const normalized = message.trim();
  const lower = normalized.toLowerCase();
  const urls = extractUrls(normalized);
  const repoUrl = urls.find((url) => isLikelyRepositoryUrl(url));
  const websiteUrl = urls.find((url) => !isLikelyRepositoryUrl(url));

  nextPlan.intake.started = true;
  if (!nextPlan.intake.initialPrompt) {
    nextPlan.intake.initialPrompt = normalized;
  }
  nextPlan.intake.latestPrompt = normalized;
  nextPlan.intake.turnCount += 1;

  if (/\b(advanced|detailed|full editor|geli[sş]mi[sş]|detayl[ıi]|ileri seviye)\b/.test(lower)) {
    nextPlan.intake.mode = "advanced";
  }

  if (/\b(simple|keep it simple|guided|basit|sade|y[öo]nlendir)\b/.test(lower)) {
    nextPlan.intake.mode = "guided";
  }

  if (/\b(review|deploy review|launch review|final review|go to deploy|deploye ge[cç]|reviewe ge[cç]|son kontrol)\b/.test(lower)) {
    nextPlan.intake.reviewRequested = true;
  }

  if (repoUrl) {
    nextPlan.workspace.sourceMode = "clone";
    nextPlan.workspace.repoUrl = repoUrl;
  }

  if (/\b(existing folder|existing workspace|existing repo|mevcut klas[oö]r|mevcut workspace|mevcut repo)\b/.test(lower)) {
    nextPlan.workspace.sourceMode = "existing";
  }

  if (/\b(empty workspace|from scratch|greenfield|s[ıi]f[ıi]rdan|bo[sş] workspace|bo[sş] proje)\b/.test(lower)) {
    nextPlan.workspace.sourceMode = "empty";
  }

  const template = detectTemplateFromText(lower);
  if (template && template !== nextPlan.workspace.template) {
    const templatePlan = applyPlannerTemplate(nextPlan, template);
    nextPlan.workspace = templatePlan.workspace;
    nextPlan.team = templatePlan.team;
    nextPlan.operations = templatePlan.operations;
    nextPlan.deploy.firstMissions = templatePlan.deploy.firstMissions;
  }

  const companyType = detectCompanyTypeFromText(lower);
  if (companyType) {
    nextPlan.company.type = companyType;
  }

  const quotedName = extractQuotedName(normalized);
  if (quotedName && !nextPlan.workspace.name) {
    nextPlan.workspace.name = quotedName;
    if (!nextPlan.company.name) {
      nextPlan.company.name = quotedName;
    }
  }

  const explicitWorkspaceName = extractNamedField(normalized, "workspace");
  if (explicitWorkspaceName) {
    nextPlan.workspace.name = explicitWorkspaceName;
  }

  const explicitCompanyName = extractNamedField(normalized, "company");
  if (explicitCompanyName) {
    nextPlan.company.name = explicitCompanyName;
    if (!nextPlan.workspace.name) {
      nextPlan.workspace.name = explicitCompanyName;
    }
  }

  if ((!nextPlan.company.name || !nextPlan.workspace.name) && websiteUrl) {
    const inferredName = inferNameFromUrl(websiteUrl);
    if (inferredName) {
      if (!nextPlan.company.name) {
        nextPlan.company.name = inferredName;
      }

      if (!nextPlan.workspace.name) {
        nextPlan.workspace.name = inferredName;
      }
    }
  }

  const customerMatch = normalized.match(
    /(?:for|serving|targeting|i[çc]in|hedef(?:imiz| kitlemiz)?|ilk kullan[ıi]c[ıi](?:lar)?|ilk m[üu][şs]teri(?:ler)?)\s+([^.!?\n]+)/i
  );
  if (customerMatch && !nextPlan.company.targetCustomer) {
    const targetCustomer = sanitizeTargetCustomerText(customerMatch[captureLastGroup(customerMatch)]);
    if (targetCustomer) {
      nextPlan.company.targetCustomer = targetCustomer;
    }
  }

  const missionMatch = normalized.match(/(?:goal|mission|we want to|build|create|amac[ıi]m[ıi]z|hedef(?:imiz)?|istiyoruz|yapmak istedi[ğg]imiz|kurmak istedi[ğg]imiz|olu[sş]turmak istedi[ğg]imiz)\s+([^.!?\n]+)/i);
  if (missionMatch && !nextPlan.company.mission) {
    nextPlan.company.mission = sanitizeExtractedText(missionMatch[captureLastGroup(missionMatch)]);
  }

  addDetectedChannels(nextPlan, lower);
  addDetectedConstraints(nextPlan, normalized);
  addDetectedOffer(nextPlan, normalized, lower);
  addDetectedScope(nextPlan, normalized);
  addDetectedRequestedAgents(nextPlan, lower);

  if (/\bdaily\b/.test(lower) && !nextPlan.operations.automations.some((entry) => entry.id === "daily-triage")) {
    nextPlan.operations.automations.push(
      createPlannerAutomationSpec({
        id: "daily-triage",
        name: "Daily triage",
        description: "Daily workspace review loop.",
        scheduleKind: "every",
        scheduleValue: "24h",
        agentId: nextPlan.team.persistentAgents.find((agent) => agent.enabled)?.id,
        mission: "Inspect the workspace, surface blockers, and leave the next handoff.",
        channelId: nextPlan.operations.channels[0]?.id
      })
    );
  }

  if (/\bweekly\b/.test(lower) && !nextPlan.operations.automations.some((entry) => entry.id === "weekly-review")) {
    nextPlan.operations.automations.push(
      createPlannerAutomationSpec({
        id: "weekly-review",
        name: "Weekly review",
        description: "Weekly synthesis loop.",
        scheduleKind: "every",
        scheduleValue: "168h",
        agentId: nextPlan.team.persistentAgents.find((agent) => /learn|review/i.test(agent.role))?.id,
        mission: "Summarize progress, decisions, and next bets for the workspace.",
        thinking: "high",
        channelId: nextPlan.operations.channels[0]?.id
      })
    );
  }

  return enrichWorkspacePlan(nextPlan);
}

export async function synthesizePlannerAdvisors(plan: WorkspacePlan) {
  const now = new Date().toISOString();
  const blockers = plan.deploy.blockers;
  const warnings = plan.deploy.warnings;
  const primaryWorkflow = plan.operations.workflows.find((workflow) => workflow.enabled);
  const primaryAgent = plan.team.persistentAgents.find((agent) => agent.enabled && agent.isPrimary);

  const notes: Array<{
    advisorId: PlannerAdvisorId;
    summary: string;
    recommendations: string[];
    concerns: string[];
  }> = [
    {
      advisorId: "founder",
      summary:
        plan.company.mission && plan.company.targetCustomer
          ? "Outcome and audience are present."
          : "The commercial story is still thin.",
      recommendations: [
        plan.company.mission
          ? `Mission: ${plan.company.mission}`
          : "State the company mission in one sentence.",
        plan.company.targetCustomer
          ? `Target customer: ${plan.company.targetCustomer}`
          : "Specify the first buyer or user segment.",
        plan.product.revenueModel
          ? `Revenue model: ${plan.product.revenueModel}`
          : "Lock a revenue or value exchange model before launch."
      ].filter(Boolean),
      concerns:
        plan.company.successSignals.length > 0
          ? []
          : ["Success signals are still vague. Add measurable outcomes before deploy."]
    },
    {
      advisorId: "product",
      summary:
        plan.product.scopeV1.length > 0
          ? `V1 scope includes ${plan.product.scopeV1.length} focused items.`
          : "V1 scope is not explicit yet.",
      recommendations: [
        plan.product.offer ? `Offer: ${plan.product.offer}` : "Describe the core offer or user promise.",
        plan.product.scopeV1.length > 0
          ? `Current V1 scope: ${plan.product.scopeV1.join(", ")}`
          : "Define a constrained V1 scope.",
        plan.product.nonGoals.length > 0
          ? `Non-goals: ${plan.product.nonGoals.join(", ")}`
          : "List non-goals to prevent scope creep."
      ].filter(Boolean),
      concerns:
        plan.operations.workflows.length > 0 ? [] : ["No delivery workflow is defined yet."]
    },
    {
      advisorId: "architect",
      summary:
        primaryAgent && primaryWorkflow
          ? `${primaryAgent.name} can own ${primaryWorkflow.name}.`
          : "Agent ownership and workflow design still need alignment.",
      recommendations: [
        `Workspace template: ${prettify(plan.workspace.template)}`,
        `Source mode: ${plan.workspace.sourceMode}`,
        plan.workspace.stackDecisions.length > 0
          ? `Stack decisions: ${plan.workspace.stackDecisions.join(", ")}`
          : "Add the critical stack or platform decisions."
      ].filter(Boolean),
      concerns:
        plan.team.persistentAgents.some((agent) => agent.enabled)
          ? []
          : ["No enabled agents remain in the deploy team."]
    },
    {
      advisorId: "ops",
      summary:
        plan.operations.automations.length > 0
          ? `${plan.operations.automations.length} automations are queued.`
          : "Operations loops are not configured yet.",
      recommendations: [
        plan.operations.channels.some((channel) => channel.enabled)
          ? `${plan.operations.channels.filter((channel) => channel.enabled).length} channels are enabled.`
          : "Choose at least one channel or keep the team internal-only.",
        plan.operations.automations.length > 0
          ? `Automations: ${plan.operations.automations.map((entry) => entry.name).join(", ")}`
          : "Define daily or weekly maintenance loops.",
        `Sandbox mode: ${plan.operations.sandbox.mode}`
      ].filter(Boolean),
      concerns:
        blockers.length > 0 ? blockers.slice(0, 2) : warnings.slice(0, 2)
    },
    {
      advisorId: "growth",
      summary:
        plan.operations.channels.some((channel) => channel.type !== "internal" && channel.enabled)
          ? "External communication channels are in the plan."
          : "Go-to-market channels are still internal-only.",
      recommendations: [
        plan.operations.channels.some((channel) => channel.type !== "internal" && channel.enabled)
          ? `External channels: ${plan.operations.channels
              .filter((channel) => channel.type !== "internal" && channel.enabled)
              .map((channel) => channel.name)
              .join(", ")}`
          : "Add Slack, Telegram, Discord, or Google Chat if the company needs external operating channels.",
        plan.company.successSignals.length > 0
          ? `Success signals: ${plan.company.successSignals.join(", ")}`
          : "Tie the launch to measurable success signals."
      ].filter(Boolean),
      concerns:
        plan.product.launchPriority.length > 0
          ? []
          : ["Launch priorities are not ordered yet."]
    },
    {
      advisorId: "reviewer",
      summary:
        blockers.length === 0
          ? "No hard deploy blockers remain."
          : `${blockers.length} deploy blocker${blockers.length === 1 ? "" : "s"} still need resolution.`,
      recommendations: [
        blockers.length === 0 ? "You can move into final review." : `Resolve blockers: ${blockers.join(" | ")}`,
        warnings.length === 0 ? "No major warnings were detected." : `Warnings: ${warnings.join(" | ")}`
      ],
      concerns: blockers.length > 0 ? blockers : warnings.slice(0, 3)
    }
  ];

  return notes.map((note) =>
    createPlannerAdvisorNote(note.advisorId, note.summary, note.recommendations, note.concerns, now)
  );
}

export function createArchitectReply(
  plan: WorkspacePlan,
  advisorNotes: PlannerAdvisorNote[],
  lastUserMessage?: string,
  previousPlan?: WorkspacePlan
) {
  const language = resolvePlannerReplyLanguage(plan, lastUserMessage);

  if (!plan.intake.started) {
    return createPlannerMessage(
      "assistant",
      "Workspace Architect",
      language === "tr"
        ? "Projeyi tek mesajda anlat. Bir website URL'si, repo URL'si ya da mevcut klasör yolu yapıştır; workspace taslağını çıkarırım ve istediğin kadar revize edebiliriz."
        : "Describe the project in one prompt. You can paste a website URL, repo URL, or an existing folder path and I will draft the workspace, then we can revise it as many times as needed."
    );
  }

  const reviewMode = isPlannerReviewMode(plan);
  const blockers = reviewMode ? plan.deploy.blockers : [];
  const isDialogueFirstTurn = isPlannerDialogueFirstTurn(plan);
  const confirmations = plan.intake.confirmations
    .slice(0, 2)
    .map((entry) => localizePlannerPrompt(entry, language));
  const topInferences = plan.intake.inferences
    .slice(0, isDialogueFirstTurn ? 3 : 4)
    .map((entry) => `${entry.label}: ${entry.value}`);
  const sourceReadout = plan.intake.sources
    .slice(Math.max(0, plan.intake.sources.length - 2))
    .map((source) => `${source.label} (${source.status === "ready" ? source.kind : `${source.kind}, needs confirmation`})`);
  const topRecommendations = advisorNotes
    .flatMap((note) => note.recommendations.slice(0, 1))
    .slice(0, reviewMode ? 2 : 1);
  const compactRecommendations = isDialogueFirstTurn ? [] : topRecommendations;
  const lowConfidenceWebsiteSource = getPlannerLowConfidenceWebsiteSource(plan);
  const appliedChanges = summarizePlannerChanges(previousPlan, plan);
  const normalizedLastMessage = (lastUserMessage || "").toLowerCase();
  const wantsGapList = /\b(eksik|eksikleri|missing|what'?s missing|neler eksik)\b/.test(normalizedLastMessage);
  const wantsSourceInference = /\b(siteden|site(?:den)?|website|from the site|from the website|çıkar|extract|infer)\b/.test(
    normalizedLastMessage
  );

  const lines = [
    isDialogueFirstTurn && lowConfidenceWebsiteSource && !plan.company.name && !plan.workspace.name
      ? language === "tr"
        ? `Site adını ${lowConfidenceWebsiteSource.label} olarak geçici varsayım kabul ettim.`
        : `I treated the site name as ${lowConfidenceWebsiteSource.label} for now.`
      : "",
    appliedChanges.length > 0
      ? language === "tr"
        ? "Son yönlendirmene göre taslağı güncelledim."
        : `Applied: ${appliedChanges.join(" ")}`
      : isDialogueFirstTurn
        ? language === "tr"
          ? "İlk mesajdan niyeti çıkardım; tam bir ilk taslak oluşturdum ve onu istediğin kadar revize edebiliriz."
          : "I pulled the intent from your first message, drafted a full first pass, and we can revise it as many times as you want."
        : language === "tr"
          ? "Taslağı son yönlendirmene göre güncelledim."
          : "I updated the draft with your latest direction.",
    sourceReadout.length > 0
      ? language === "tr"
        ? `Kullandığım bağlam: ${sourceReadout.join(" · ")}.`
        : `Context in play: ${sourceReadout.join(" · ")}.`
      : "",
    topInferences.length > 0
      ? language === "tr"
        ? `Şu anki taslak: ${topInferences.join(" | ")}.`
        : `Current draft: ${topInferences.join(" | ")}.`
      : "",
    compactRecommendations.length > 0 && !reviewMode
      ? language === "tr"
        ? `Arka plan taslağı: ${compactRecommendations.join(" ")}`
        : `Background draft: ${compactRecommendations.join(" ")}`
      : "",
    wantsSourceInference && confirmations.length > 0
      ? language === "tr"
        ? `Bağlı kaynaktan çıkarabildiğim her alanı doldurdum. Sayfa şu noktaları hâlâ belirsiz bırakıyor: ${confirmations.join("; ")}.`
        : `I filled what I could from the linked context. The page still leaves these items ambiguous: ${confirmations.join("; ")}.`
      : wantsGapList && confirmations.length > 0
        ? language === "tr"
          ? `Hâlâ eksik ya da düşük güvenli noktalar: ${confirmations.join("; ")}.`
          : `Still missing or low-confidence: ${confirmations.join("; ")}.`
        : !reviewMode && confirmations.length > 0
      ? confirmations.length === 1
        ? language === "tr"
          ? `Sıradaki tek not şu: ${confirmations[0]}`
          : `I still have one unresolved note: ${confirmations[0]}`
        : language === "tr"
          ? `Sıradaki iki not şu: ${confirmations[0]} Sonra ${lowercaseFirst(confirmations[1])}`
          : `I still have two unresolved notes: ${confirmations[0]} Then ${lowercaseFirst(confirmations[1])}`
      : reviewMode && confirmations.length > 0
        ? language === "tr"
          ? `Deploy öncesi şu notları ele alalım: ${confirmations.join("; ")}.`
          : `Before deploy, address: ${confirmations.join("; ")}.`
        : blockers.length > 0
          ? language === "tr"
            ? `DEPLOY öncesi hâlâ şunlara ihtiyacım var: ${blockers.join("; ")}.`
            : `Before DEPLOY I still need: ${blockers.join("; ")}.`
            : reviewMode
              ? language === "tr"
                ? "Blueprint yapısal olarak DEPLOY için hazır. Uyarıları bir kez gözden geçirip ardından launch edebiliriz."
                : "Blueprint is structurally ready for DEPLOY. Review warnings once, then launch."
              : language === "tr"
                ? "Taslak hazır ve revize edilmeye açık. İstersen şimdi gelişmiş editörü açayım ya da devam eden değişiklikleri birlikte yapalım."
                : "The draft is ready and open for revision. If you want, I can open the advanced editor or keep iterating with you.",
    lastUserMessage && appliedChanges.length === 0 && !isDialogueFirstTurn
      ? language === "tr"
        ? `Son yönlendirmeyi kaydettim: "${lastUserMessage.trim()}".`
        : `Latest direction captured: "${lastUserMessage.trim()}".`
      : ""
  ].filter(Boolean);

  return createPlannerMessage("assistant", "Workspace Architect", lines.join("\n\n"));
}

function createPlannerAdvisorNote(
  advisorId: PlannerAdvisorId,
  summary: string,
  recommendations: string[],
  concerns: string[],
  createdAt: string
): PlannerAdvisorNote {
  return {
    id: createWorkspacePlanId(),
    advisorId,
    advisorName: advisorNames[advisorId],
    summary,
    recommendations: normalizeList(recommendations),
    concerns: normalizeList(concerns),
    createdAt
  };
}

function buildArchitectSummary(
  plan: WorkspacePlan,
  blockers: string[],
  warnings: string[],
  reviewMode: boolean
) {
  const language = resolvePlannerReplyLanguage(plan);
  const isDialogueFirstTurn = isPlannerDialogueFirstTurn(plan);
  const lowConfidenceWebsiteSource = getPlannerLowConfidenceWebsiteSource(plan);
  const enabledAgents = plan.team.persistentAgents.filter((agent) => agent.enabled).length;
  const enabledWorkflows = plan.operations.workflows.filter((workflow) => workflow.enabled).length;
  const enabledAutomations = plan.operations.automations.filter((automation) => automation.enabled).length;
  const confirmations = plan.intake.confirmations.length;

  if (!plan.intake.started) {
    return language === "tr" ? "Tek mesajla başla." : "Start with one prompt.";
  }

  if (!reviewMode && isDialogueFirstTurn) {
    const focus = plan.company.mission || plan.product.offer || plan.company.name || plan.workspace.name;
    const sourceDescription =
      plan.workspace.sourceMode === "clone"
        ? language === "tr"
          ? "klon repo"
          : "a cloned repo"
        : plan.workspace.sourceMode === "existing"
          ? language === "tr"
            ? "mevcut klasör"
            : "an existing folder"
          : language === "tr"
            ? "sıfırdan"
            : "scratch";
    const nameNote =
      lowConfidenceWebsiteSource && !plan.company.name && !plan.workspace.name
        ? language === "tr"
          ? `Site adı için ${lowConfidenceWebsiteSource.label} varsayımını kullandım.`
          : `I used ${lowConfidenceWebsiteSource.label} as the site name.`
        : "";

    return language === "tr"
      ? [nameNote, focus ? `İlk taslak ${focus} etrafında hazır.` : `İlk taslak ${sourceDescription} başlangıcıyla hazır.`]
          .filter(Boolean)
          .join(" ")
      : [nameNote, focus ? `First pass ready around ${focus}.` : `First pass ready from ${sourceDescription}.`]
          .filter(Boolean)
          .join(" ");
  }

  if (!reviewMode) {
    return language === "tr"
      ? [
          plan.company.mission
            ? `Odak: ${plan.company.mission}.`
            : plan.company.name || plan.workspace.name
              ? `İlk çıktı: ${plan.company.name || plan.workspace.name}.`
              : "İlk çıktı netleşiyor.",
          plan.company.targetCustomer
            ? `Kitle: ${plan.company.targetCustomer}.`
            : "Kitle açık.",
          plan.intake.sources.length > 0
            ? `${plan.intake.sources.length} kaynak topladım.`
            : "URL, repo ya da kısa brief yeterli.",
          `${enabledAgents} agent, ${enabledWorkflows} görev, ${enabledAutomations} automation.`,
          confirmations > 0
            ? `${confirmations} revizyon kaldı.`
            : "Revizyona hazır."
        ].join(" ")
      : [
          plan.company.mission
            ? `Focus: ${plan.company.mission}.`
            : `First outcome: ${plan.company.name || plan.workspace.name || "this workspace"}.`,
          plan.company.targetCustomer
            ? `Audience: ${plan.company.targetCustomer}.`
            : "Audience open.",
          plan.intake.sources.length > 0
            ? `I have ${plan.intake.sources.length} source${plan.intake.sources.length === 1 ? "" : "s"}.`
            : "Add a URL, repo, or short brief.",
          `${enabledAgents} agents, ${enabledWorkflows} workflows, ${enabledAutomations} automations.`,
          confirmations > 0
            ? `${confirmations} revision${confirmations === 1 ? "" : "s"} left.`
            : "Ready to revise."
        ].join(" ");
  }

  return language === "tr"
    ? [
        plan.company.mission
          ? `Odak: ${plan.company.mission}.`
          : "Misyon kısa bir cümle istiyor.",
        plan.company.targetCustomer
          ? `Kitle: ${plan.company.targetCustomer}.`
          : "Kitle açık.",
        `${enabledAgents} agent, ${enabledWorkflows} görev, ${enabledAutomations} automation.`,
        confirmations > 0
          ? `${confirmations} revizyon kaldı.`
          : blockers.length > 0
            ? `${blockers.length} blocker kaldı.`
            : warnings.length > 0
              ? `${warnings.length} warning var.`
              : "Deploy'a hazır."
      ].join(" ")
    : [
        plan.company.mission
          ? `Focus: ${plan.company.mission}.`
          : "Mission still needs a short sentence.",
        plan.company.targetCustomer
          ? `Audience: ${plan.company.targetCustomer}.`
          : "Audience open.",
        `${enabledAgents} agents, ${enabledWorkflows} workflows, ${enabledAutomations} automations.`,
        confirmations > 0
          ? `${confirmations} revision${confirmations === 1 ? "" : "s"} left.`
          : blockers.length > 0
            ? `${blockers.length} blocker${blockers.length === 1 ? "" : "s"} remain.`
            : warnings.length > 0
              ? `${warnings.length} warning${warnings.length === 1 ? "" : "s"} remain.`
              : "Ready to deploy."
      ].join(" ");
}

function resolvePlanStage(
  plan: WorkspacePlan,
  blockers: string[],
  warnings: string[],
  confirmations: string[],
  reviewMode: boolean
) {
  if (!plan.intake.started) {
    return "intake";
  }

  if (!reviewMode && isPlannerDialogueFirstTurn(plan)) {
    return plan.intake.sources.length > 0 ? "context-harvest" : "intake";
  }

  if (plan.status === "deploying") {
    return "deploying";
  }

  if (plan.status === "deployed") {
    return "deployed";
  }

  if (!hasPlannerDirection(plan)) {
    return plan.intake.turnCount > 1 ? "context-harvest" : "intake";
  }

  if (!hasPlannerDraft(plan)) {
    return "team-synthesis";
  }

  if (!reviewMode) {
    return confirmations.length > 0 ? "team-synthesis" : "decision-lock";
  }

  if (blockers.length > 0) {
    return "pressure-test";
  }

  if (warnings.length > 0 || plan.readinessScore < 90) {
    return "decision-lock";
  }

  return "ready";
}

function resolvePlanStatus(
  plan: WorkspacePlan,
  blockers: string[],
  confirmations: string[],
  reviewMode: boolean
) {
  if (!plan.intake.started) {
    return "draft";
  }

  if (plan.status === "deploying" || plan.status === "deployed") {
    return plan.status;
  }

  if (!reviewMode) {
    if (isPlannerDialogueFirstTurn(plan)) {
      return "draft";
    }

    return confirmations.length > 0 ? "draft" : "review";
  }

  if (plan.status === "blocked" && blockers.length > 0) {
    return "blocked";
  }

  if (blockers.length > 0) {
    return "blocked";
  }

  return plan.readinessScore >= 90 ? "ready" : "review";
}

function calculateReadinessScore(
  plan: WorkspacePlan,
  blockers: string[],
  warnings: string[],
  reviewMode: boolean
) {
  let score = 14;

  if (plan.company.name) score += 10;
  if (plan.company.mission) score += 15;
  if (plan.company.targetCustomer) score += 15;
  if (plan.product.offer) score += 10;
  if (plan.product.scopeV1.length > 0) score += 10;
  if (plan.workspace.name) score += 10;
  if (plan.intake.sources.length > 0) score += 6;
  if (plan.team.persistentAgents.some((agent) => agent.enabled && agent.isPrimary)) score += 10;
  if (plan.operations.workflows.some((workflow) => workflow.enabled)) score += 10;
  if (plan.operations.automations.some((automation) => automation.enabled)) score += 5;

  if (reviewMode) {
    score -= blockers.length * 12;
    score -= warnings.length * 3;
  } else {
    score -= Math.max(0, plan.intake.confirmations.length - 1) * 4;
  }

  return Math.max(0, Math.min(100, score));
}

function isPlannerReviewMode(plan: WorkspacePlan) {
  return plan.intake.reviewRequested || plan.status === "deploying" || plan.status === "deployed";
}

function hasPlannerDirection(plan: WorkspacePlan) {
  return Boolean(
    plan.company.mission ||
      plan.product.offer ||
      plan.workspace.name ||
      plan.intake.sources.length > 0
  );
}

function hasPlannerDraft(plan: WorkspacePlan) {
  return Boolean(
    (plan.company.name || plan.workspace.name) &&
      plan.company.mission &&
      plan.team.persistentAgents.some((agent) => agent.enabled) &&
      plan.operations.workflows.some((workflow) => workflow.enabled)
  );
}

function collectPlanBlockers(plan: WorkspacePlan) {
  const blockers: string[] = [];

  if (!plan.company.name) {
    blockers.push("Company or workspace name is missing.");
  }

  if (!plan.company.mission) {
    blockers.push("Mission is missing.");
  }

  if (!plan.company.targetCustomer) {
    blockers.push("Target customer is missing.");
  }

  if (!plan.workspace.name) {
    blockers.push("Workspace name is missing.");
  }

  if (plan.workspace.sourceMode === "clone" && !plan.workspace.repoUrl) {
    blockers.push("Clone mode needs a repository URL.");
  }

  if (plan.workspace.sourceMode === "existing" && !plan.workspace.existingPath) {
    blockers.push("Existing-folder mode needs a folder path.");
  }

  if (!plan.team.persistentAgents.some((agent) => agent.enabled)) {
    blockers.push("At least one persistent agent must be enabled.");
  }

  if (!plan.team.persistentAgents.some((agent) => agent.enabled && agent.isPrimary)) {
    blockers.push("One enabled agent must be marked as primary.");
  }

  if (!plan.operations.workflows.some((workflow) => workflow.enabled)) {
    blockers.push("At least one enabled workflow is required.");
  }

  for (const workflow of plan.operations.workflows.filter((entry) => entry.enabled)) {
    if (!workflow.name || !workflow.goal || !workflow.successDefinition) {
      blockers.push(`Workflow "${workflow.name || workflow.id}" is incomplete.`);
    }

    if (workflow.ownerAgentId && !plan.team.persistentAgents.some((agent) => agent.id === workflow.ownerAgentId && agent.enabled)) {
      blockers.push(`Workflow "${workflow.name}" points to a missing or disabled owner agent.`);
    }
  }

  for (const automation of plan.operations.automations.filter((entry) => entry.enabled)) {
    if (!automation.mission || !automation.scheduleValue) {
      blockers.push(`Automation "${automation.name}" is incomplete.`);
    }

    if (automation.agentId && !plan.team.persistentAgents.some((agent) => agent.id === automation.agentId && agent.enabled)) {
      blockers.push(`Automation "${automation.name}" points to a missing or disabled agent.`);
    }
  }

  for (const channel of plan.operations.channels.filter((entry) => entry.enabled && entry.requiresCredentials)) {
    const missingCredentials = channel.credentials.filter((credential) => !credential.value.trim());
    if (missingCredentials.length > 0) {
      blockers.push(`Channel "${channel.name}" is missing required credentials.`);
    }
  }

  return uniqueStrings(blockers);
}

function collectPlanWarnings(plan: WorkspacePlan) {
  const warnings: string[] = [];
  const sizeProfile = getPlannerWorkspaceSizeProfile(plan.intake.size);

  if (plan.product.nonGoals.length === 0) {
    warnings.push("No non-goals are defined for V1.");
  }

  if (plan.product.launchPriority.length === 0) {
    warnings.push("Launch priorities are not ordered yet.");
  }

  if (plan.company.successSignals.length === 0) {
    warnings.push("Success signals are still empty.");
  }

  if (plan.workspace.stackDecisions.length === 0 && plan.workspace.template !== "content") {
    warnings.push("Critical stack decisions are not captured yet.");
  }

  if (sizeProfile.automationCount > 0 && !plan.operations.automations.some((entry) => entry.enabled)) {
    warnings.push("No automation loops are enabled.");
  }

  if (
    sizeProfile.externalChannelCount > 0 &&
    !plan.operations.channels.some((entry) => entry.type !== "internal")
  ) {
    warnings.push("Only internal channels are configured.");
  }

  if (sizeProfile.agentCount >= 3 && plan.team.maxParallelRuns < 2) {
    warnings.push("Parallel run limit is conservative for a multi-agent workspace.");
  }

  return uniqueStrings(warnings);
}

function isPlannerDialogueFirstTurn(plan: WorkspacePlan) {
  return plan.intake.turnCount <= 1 && !plan.intake.reviewRequested;
}

function getPlannerLowConfidenceWebsiteSource(plan: WorkspacePlan) {
  return plan.intake.sources.find(
    (source) =>
      source.kind === "website" &&
      source.status === "ready" &&
      typeof source.confidence === "number" &&
      source.confidence < 80 &&
      Boolean(source.label)
  );
}

function buildPlannerConfirmations(plan: WorkspacePlan) {
  const confirmations: string[] = [];
  const sizeProfile = getPlannerWorkspaceSizeProfile(plan.intake.size);

  for (const source of plan.intake.sources.filter((entry) => entry.status === "error")) {
    confirmations.push(
      resolvePlannerReplyLanguage(plan) === "tr"
        ? `${source.label} kaynağını inceleyemedim. Bu kaynak önemliyse şirket bağlamını manuel olarak doğrula.`
        : `I could not inspect ${source.label}. Confirm the company context manually if this source matters.`
    );
  }

  return uniqueStrings(confirmations).slice(0, sizeProfile.confirmationLimit);
}

function buildPlannerInferences(plan: WorkspacePlan) {
  const inferences: PlannerInference[] = [];
  const sourceLabels = plan.intake.sources
    .filter((source) => source.status === "ready")
    .map((source) => source.label);
  const confirmationText = plan.intake.confirmations.join(" ").toLowerCase();

  if (plan.company.name) {
    inferences.push(
      createPlannerInference({
        section: "company",
        label: "Company",
        value: plan.company.name,
        confidence: estimateInferenceConfidence(plan, "company-name"),
        status: resolveInferenceStatus(confirmationText, "company"),
        rationale: sourceLabels.length > 0 ? "Derived from linked context and the current brief." : "Derived from the current brief.",
        sourceLabels
      })
    );
  }

  if (plan.company.mission) {
    inferences.push(
      createPlannerInference({
        section: "company",
        label: "Mission",
        value: plan.company.mission,
        confidence: estimateInferenceConfidence(plan, "mission"),
        status: resolveInferenceStatus(confirmationText, "outcome"),
        rationale: "Architect condensed the first business outcome from the request.",
        sourceLabels
      })
    );
  }

  if (plan.company.targetCustomer) {
    inferences.push(
      createPlannerInference({
        section: "company",
        label: "First audience",
        value: plan.company.targetCustomer,
        confidence: estimateInferenceConfidence(plan, "target-customer"),
        status: resolveInferenceStatus(confirmationText, "audience"),
        rationale: "This is the current best guess for the first user or buyer segment.",
        sourceLabels
      })
    );
  }

  inferences.push(
    createPlannerInference({
      section: "workspace",
      label: "Workspace type",
      value: prettify(plan.workspace.template),
      confidence: estimateInferenceConfidence(plan, "template"),
      status: "inferred",
      rationale: "Template is inferred from the requested operating model and linked context.",
      sourceLabels
    })
  );

  inferences.push(
    createPlannerInference({
      section: "workspace",
      label: "Starting point",
      value:
        plan.workspace.sourceMode === "clone"
          ? plan.workspace.repoUrl || "Clone an existing repository"
          : plan.workspace.sourceMode === "existing"
            ? plan.workspace.existingPath || "Attach an existing folder"
            : "Start from scratch",
      confidence: estimateInferenceConfidence(plan, "source-mode"),
      status: resolveInferenceStatus(confirmationText, "start"),
      rationale: "This is how the workspace will be materialized when you deploy.",
      sourceLabels
    })
  );

  if (plan.product.offer) {
    inferences.push(
      createPlannerInference({
        section: "product",
        label: "Offer",
        value: plan.product.offer,
        confidence: estimateInferenceConfidence(plan, "offer"),
        status: "inferred",
        rationale: "Architect turned the brief into a concrete operator-facing offer.",
        sourceLabels
      })
    );
  }

  const externalChannels = plan.operations.channels.filter((channel) => channel.enabled && channel.type !== "internal");
  if (externalChannels.length > 0) {
    inferences.push(
      createPlannerInference({
        section: "operations",
        label: "External channels",
        value: externalChannels.map((channel) => channel.name).join(", "),
        confidence: estimateInferenceConfidence(plan, "channels"),
        status: "inferred",
        rationale: "The request implies these operating channels should exist after deploy.",
        sourceLabels
      })
    );
  }

  const primaryAgent = plan.team.persistentAgents.find((agent) => agent.enabled && agent.isPrimary);
  if (primaryAgent) {
    inferences.push(
      createPlannerInference({
        section: "team",
        label: "Primary operator",
        value: `${primaryAgent.name} (${primaryAgent.role})`,
        confidence: estimateInferenceConfidence(plan, "team"),
        status: "inferred",
        rationale: "Architect drafted a primary agent to own the first delivery loop.",
        sourceLabels
      })
    );
  }

  const primaryWorkflow = plan.operations.workflows.find((workflow) => workflow.enabled);
  if (primaryWorkflow) {
    inferences.push(
      createPlannerInference({
        section: "operations",
        label: "First workflow",
        value: primaryWorkflow.name,
        confidence: estimateInferenceConfidence(plan, "workflow"),
        status: "inferred",
        rationale: "This is the first operational loop the company would run after deploy.",
        sourceLabels
      })
    );
  }

  return inferences.slice(0, 8);
}

function buildPlannerSuggestedReplies(plan: WorkspacePlan, confirmations: string[]) {
  const language = resolvePlannerReplyLanguage(plan);
  const suggestions: string[] = [];
  const sizeProfile = getPlannerWorkspaceSizeProfile(plan.intake.size);
  const sourceAudience = inferAudienceFromPlannerSources(plan);
  const isDialogueFirstTurn = isPlannerDialogueFirstTurn(plan);

  if (!plan.company.targetCustomer) {
    if (sourceAudience) {
      suggestions.push(
        language === "tr"
          ? `İlk hedef kitle ${lowercaseFirst(sourceAudience)} gibi görünüyor.`
          : `The first audience looks like ${lowercaseFirst(sourceAudience)}.`
      );
    }

    if (plan.workspace.template === "content") {
      suggestions.push(
        language === "tr"
          ? "İlk kullanıcılar topluluk yöneticileri ve moderatörler."
          : "The first users are community managers and moderators."
      );
      suggestions.push(
        language === "tr"
          ? "İlk kullanıcılar daha hızlı moderasyon ve onboarding isteyen Telegram üyeleri."
          : "The first users are Telegram members who need faster moderation and onboarding."
      );
    } else {
      suggestions.push(
        language === "tr"
          ? "İlk kullanıcılar bu iş akışını her gün yürüten operatörler."
          : "The first users are the operators running this workflow every day."
      );
    }
  }

  if (!plan.company.mission) {
    suggestions.push(
      language === "tr"
        ? "İlk hedef, hacmi en yüksek manuel iş akışını otomatikleştirmek."
        : "The first outcome is automating the highest-volume manual workflow."
    );
  }

  if (!plan.product.scopeV1.length && plan.company.mission && plan.company.targetCustomer) {
    suggestions.push(
      language === "tr"
        ? "V1, genişlemeden önce en dar ama faydalı döngüyü uçtan uca çözmeli."
        : "V1 should handle the narrowest useful loop end to end before we expand."
    );
  }

  if (
    !plan.workspace.repoUrl &&
    !plan.workspace.existingPath &&
    !mentionsSourceMode(plan.intake.latestPrompt || plan.intake.initialPrompt)
  ) {
    suggestions.push(
      language === "tr"
        ? "Şimdilik varsayılan bir başlangıçla ilerleyelim; kaynak türünü daha sonra istediğin gibi revize edebiliriz."
        : "We can proceed with a default starting point and revise the source later if you want."
    );
    suggestions.push(
      language === "tr"
        ? "Eğer bir repo ya da mevcut klasör istiyorsan sonraki mesajda sadece onu söylemen yeterli."
        : "If you want a repo or existing folder, just say so in the next edit."
    );
  }

  if (plan.company.successSignals.length === 0 && plan.intake.turnCount >= 2) {
    suggestions.push(
      language === "tr"
        ? "Başarı; daha az manuel iş, daha hızlı yanıt süreleri ve daha net bir operasyon ritmi demek."
        : "Success means less manual work, faster response times, and a clearer operating cadence."
    );
  }

  if (confirmations.length === 0 && !isDialogueFirstTurn) {
    suggestions.push(
      language === "tr"
        ? "İstersen bu taslağı şimdi daha keskin hale getirebiliriz."
        : "If you want, we can tighten this draft right now."
    );
    suggestions.push(language === "tr" ? "Gelişmiş editörü aç." : "Open the advanced editor.");
  }

  return uniqueStrings(suggestions).slice(0, sizeProfile.suggestedReplyLimit);
}

export function resolvePlannerReplyLanguage(plan: WorkspacePlan, lastUserMessage?: string): "en" | "tr" {
  const candidates = [
    lastUserMessage,
    ...plan.conversation
      .slice()
      .reverse()
      .filter((entry) => entry.role === "user")
      .map((entry) => entry.text),
    plan.intake.latestPrompt,
    plan.intake.initialPrompt
  ];

  for (const candidate of candidates) {
    const detectedLanguage = detectPlannerTextLanguage(candidate);
    if (detectedLanguage) {
      return detectedLanguage;
    }
  }

  return "en";
}

export function detectPlannerTextLanguage(value?: string): "en" | "tr" | null {
  if (isProbablyTurkishText(value)) {
    return "tr";
  }

  if (isProbablyEnglishText(value)) {
    return "en";
  }

  return null;
}

function isProbablyTurkishText(value?: string) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return false;
  }

  if (/[çğıöşüÇĞİÖŞÜ]/.test(trimmed)) {
    return true;
  }

  const matches = trimmed
    .toLowerCase()
    .match(/\b(ve|bir|bu|şu|için|ile|olarak|olan|mı|mi|mu|mü|ne|nasıl|hangi|neden|hedef|ilk|müşteri|kullanıcı|oluştur|gerekli|alanları|yardımcı)\b/g);

  return Boolean(matches && matches.length >= 2);
}

function isProbablyEnglishText(value?: string) {
  const trimmed = value?.trim();

  if (!trimmed || /[çğıöşüÇĞİÖŞÜ]/.test(trimmed)) {
    return false;
  }

  const matches = trimmed
    .toLowerCase()
    .match(/\b(let'?s|the|and|for|with|from|this|that|what|how|why|when|where|who|should|could|would|need|want|start|build|create|launch|project|workspace|customer|user|team|goal|mission|review|deploy|product|website|repo|folder)\b/g);

  return Boolean(matches && matches.length >= 2);
}

function localizePlannerPrompt(value: string, language: "en" | "tr") {
  if (language !== "tr") {
    return value;
  }

  return value
    .replace("What should I call the company or workspace?", "Şirkete ya da workspace'e ne ad verelim?")
    .replace(
      "What exact outcome should this workspace optimize for first?",
      "Bu workspace önce tam olarak hangi çıktıyı optimize etmeli?"
    )
    .replace(
      "Should this start from scratch, clone a repo, or attach an existing folder?",
      "Buna sıfırdan mı başlayalım, bir repo mu klonlayalım, yoksa mevcut bir klasörü mü bağlayalım?"
    )
    .replace("What is the smallest V1 outcome we should launch first?", "İlk çıkaracağımız en küçük V1 sonucu ne olmalı?")
    .replace("What should stay explicitly out of scope for V1?", "V1 için neleri özellikle kapsam dışında bırakalım?")
    .replace("What signal should tell us this workspace is working?", "Bu workspace'in işe yaradığını bize hangi sinyal göstermeli?")
    .replace("Who is the first user or customer segment?", "İlk kullanıcı ya da müşteri segmenti kim?");
}

function getPlannerReadySourceText(plan: WorkspacePlan) {
  return plan.intake.sources
    .filter((source) => source.status === "ready")
    .flatMap((source) => [source.label, source.summary, ...source.details])
    .join(" ")
    .toLowerCase();
}

function inferAudienceFromPlannerSources(plan: WorkspacePlan) {
  const sourceText = getPlannerReadySourceText(plan);

  if (!sourceText) {
    return undefined;
  }

  const hasWeb3 = /\bweb3|onchain|crypto|blockchain|token\b/.test(sourceText);
  const hasStartup = /\bstartup|startups|founder|founders|business(?:es)?\b/.test(sourceText);
  const hasCommunity = /\bcommunity|communities|member|members|holder|holders|nft|dao|governance\b/.test(sourceText);
  const hasDeveloper = /\bdeveloper|developers|builder|builders|engineer|engineers\b/.test(sourceText);
  const hasOperator = /\boperator|operators|moderator|moderators|admin|admins|ops\b/.test(sourceText);

  if (hasStartup && hasCommunity) {
    return hasWeb3 ? "Web3 startups and token-led communities" : "startups and their communities";
  }

  if (hasStartup) {
    return hasWeb3 ? "Web3 startups and founders" : "startups and founders";
  }

  if (hasCommunity) {
    return hasWeb3 ? "DAO, NFT, and Web3 communities" : "community leads and members";
  }

  if (hasDeveloper && hasOperator) {
    return "developers and internal operators";
  }

  if (hasDeveloper) {
    return "developers and technical teams";
  }

  if (hasOperator) {
    return "internal operators and moderators";
  }

  return undefined;
}

function mentionsSourceMode(text: string) {
  return /\b(from scratch|greenfield|empty workspace|clone|repo|existing folder|existing workspace|s[ıi]f[ıi]rdan|mevcut klas[oö]r|mevcut repo|bo[sş])\b/i.test(
    text
  );
}

function estimateInferenceConfidence(plan: WorkspacePlan, kind: string) {
  const prompt = `${plan.intake.initialPrompt} ${plan.intake.latestPrompt}`.toLowerCase();
  const readySources = plan.intake.sources.filter((source) => source.status === "ready");
  let score = 66;

  if (readySources.length > 0) {
    score += 8;
  }

  if (plan.intake.turnCount > 1) {
    score += 6;
  }

  if (
    (kind === "template" && /\b(telegram|discord|community|topluluk|grup|content|marketing|research|frontend|backend)\b/.test(prompt)) ||
    (kind === "source-mode" && mentionsSourceMode(prompt)) ||
    (kind === "channels" && /\b(slack|telegram|discord|google chat)\b/.test(prompt))
  ) {
    score += 10;
  }

  if (kind === "company-name" && readySources.some((source) => source.kind === "website")) {
    score += 6;
  }

  if (kind === "target-customer" && !plan.company.targetCustomer) {
    score -= 18;
  }

  if (kind === "workflow" || kind === "team") {
    score -= 4;
  }

  return Math.max(52, Math.min(96, score));
}

function resolveInferenceStatus(
  confirmationText: string,
  keyword: string
): PlannerDecisionStatus {
  return confirmationText.includes(keyword) ? "needs-confirmation" : "inferred";
}

function detectTemplateFromText(lower: string): WorkspaceTemplate | null {
  if (/\b(telegram|discord|community|topluluk|grup|channel automation|community ops)\b/.test(lower)) {
    return "content";
  }

  if (/\bfrontend\b|\bui\b|\bwebsite\b|\blanding page\b|\bdesign system\b/.test(lower)) {
    return "frontend";
  }

  if (/\bbackend\b|\bapi\b|\bservice\b|\bmicroservice\b/.test(lower)) {
    return "backend";
  }

  if (/\bresearch\b|\binvestigation\b|\banalysis\b|\bthesis\b/.test(lower)) {
    return "research";
  }

  if (/\bcontent\b|\bmarketing\b|\bgrowth\b|\bseo\b|\bnewsletter\b/.test(lower)) {
    return "content";
  }

  if (/\bsoftware\b|\bapp\b|\bweb app\b|\bmobile app\b/.test(lower)) {
    return "software";
  }

  return null;
}

function detectCompanyTypeFromText(lower: string): WorkspacePlan["company"]["type"] | null {
  if (/\b(community|topluluk|telegram|discord)\b/.test(lower)) {
    return "content-brand";
  }

  if (/\bagency\b/.test(lower)) {
    return "agency";
  }

  if (/\bresearch\b|\blab\b/.test(lower)) {
    return "research-lab";
  }

  if (/\bcontent\b|\bmedia\b|\bnewsletter\b/.test(lower)) {
    return "content-brand";
  }

  if (/\binternal ops\b|\bops team\b/.test(lower)) {
    return "internal-ops";
  }

  if (/\bsaas\b|\bapp\b|\bweb app\b|\bmobile app\b/.test(lower)) {
    return "saas";
  }

  return null;
}

function extractQuotedName(text: string) {
  const quotedMatch = text.match(/["“]([^"”]+)["”]/);
  return quotedMatch?.[1]?.trim();
}

function extractNamedField(text: string, kind: "workspace" | "company") {
  const kindTerms =
    kind === "workspace"
      ? ["workspace", "workspace name", "project", "project name", "proje", "proje adı", "proje ismi"]
      : ["company", "company name", "firma", "firma adı", "şirket", "şirket adı", "company name"];
  const nameTerms = ["name", "adı", "adını", "ismi", "ismini"];
  const assignmentTerms = ["is", "should be", "=", ":", "olsun", "diyelim", "verelim", "koyalım", "yap", "yapalım", "değiştir", "değiştirelim", "olarak ayarla"];
  const patterns = [
    new RegExp(
      `\\b(?:${kindTerms.join("|")})\\b\\s+(?:${nameTerms.join("|")})\\s*(?:${assignmentTerms.join("|")})?\\s*([\\p{L}\\p{N}][\\p{L}\\p{N}._ -]{1,40}(?:\\s+[\\p{L}\\p{N}][\\p{L}\\p{N}._ -]{1,40}){0,2})(?=\\s+(?:${assignmentTerms.join("|")}|olarak|için)\\b|[.!?,]|$)`,
      "iu"
    ),
    new RegExp(
      `\\b(?:${nameTerms.join("|")})\\b\\s*(?:of\\s+)?(?:${kindTerms.join("|")})?\\s*(?:${assignmentTerms.join("|")})?\\s*([\\p{L}\\p{N}][\\p{L}\\p{N}._ -]{1,40}(?:\\s+[\\p{L}\\p{N}][\\p{L}\\p{N}._ -]{1,40}){0,2})(?=\\s+(?:${assignmentTerms.join("|")}|olarak|için)\\b|[.!?,]|$)`,
      "iu"
    ),
    new RegExp(
      `\\b(?:${kindTerms.join("|")})\\b\\s+(?:${nameTerms.join("|")})\\s+(?:${assignmentTerms.join("|")})\\s+([\\p{L}\\p{N}][\\p{L}\\p{N}._ -]{1,40}(?:\\s+[\\p{L}\\p{N}][\\p{L}\\p{N}._ -]{1,40}){0,2})(?=\\s+(?:olarak|için)\\b|[.!?,]|$)`,
      "iu"
    )
  ];

  for (const pattern of patterns) {
    const value = sanitizeExtractedName(text.match(pattern)?.[1]?.trim() ?? "");
    if (value) {
      return value;
    }
  }

  return undefined;
}

function addDetectedChannels(plan: WorkspacePlan, lower: string) {
  (["slack", "telegram", "discord", "googlechat"] as PlannerChannelType[]).forEach((type) => {
    if (!lower.includes(type === "googlechat" ? "google chat" : type)) {
      return;
    }

    if (plan.operations.channels.some((channel) => channel.type === type)) {
      return;
    }

    plan.operations.channels.push(
      createPlannerChannelSpec(type, {
        name: channelDefinitions[type].label,
        purpose: "Team communication and announcements.",
        announce: true
      })
    );
  });
}

function addDetectedConstraints(plan: WorkspacePlan, text: string) {
  const constraintPrefixes = [
    "must ",
    "should ",
    "cannot ",
    "can't ",
    "without ",
    "need to ",
    "olmalı",
    "zorunda",
    "gerek",
    "yapmamalı",
    "olmamalı"
  ];
  const sentences = text.split(/[.!?\n]/).map((entry) => entry.trim()).filter(Boolean);

  for (const sentence of sentences) {
    if (!constraintPrefixes.some((prefix) => sentence.toLowerCase().includes(prefix))) {
      continue;
    }

    plan.company.constraints = uniqueStrings([...plan.company.constraints, sentence]);
  }
}

function addDetectedOffer(plan: WorkspacePlan, text: string, lower: string) {
  if (plan.product.offer) {
    return;
  }

  const offerMatch = text.match(/(?:offer|product|service|platform|we are building|sunulan [şs]ey|[üu]r[üu]n|servis|platform)\s*(?:is|:)?\s*([^\n]+)/i);
  if (offerMatch) {
    plan.product.offer = sanitizeExtractedText(offerMatch[captureLastGroup(offerMatch)]);
    return;
  }

  if (/\btelegram\b/.test(lower) && /\b(group|community|grup|topluluk)\b/.test(lower)) {
    plan.product.offer = "Operate and automate the Telegram community experience.";
  }
}

function addDetectedScope(plan: WorkspacePlan, text: string) {
  const scopeMatch = text.match(/(?:scope|v1|mvp|kapsam|ilk s[üu]r[üu]m)\s*(?:is|:)?\s*([^\n]+)/i);
  if (scopeMatch) {
    plan.product.scopeV1 = uniqueStrings([
      ...plan.product.scopeV1,
      ...splitList(scopeMatch[captureLastGroup(scopeMatch)])
    ]);
  }

  const nonGoalMatch = text.match(/(?:non-goals?|not doing|yapmayaca[ğg][ıi]m[ıi]z [şs]eyler|kapsam d[ıi][şs][ıi])\s*(?:are|:)?\s*([^\n]+)/i);
  if (nonGoalMatch) {
    plan.product.nonGoals = uniqueStrings([
      ...plan.product.nonGoals,
      ...splitList(nonGoalMatch[captureLastGroup(nonGoalMatch)])
    ]);
  }

  const successMatch = text.match(/(?:success|metric|north star|ba[sş]ar[ıi]|metrik)\s*(?:is|:)?\s*([^\n]+)/i);
  if (successMatch) {
    plan.company.successSignals = uniqueStrings([
      ...plan.company.successSignals,
      ...splitList(successMatch[captureLastGroup(successMatch)])
    ]);
  }
}

function addDetectedRequestedAgents(plan: WorkspacePlan, lower: string) {
  const requestedAssistant = /\b(şahsi asistan|kişisel asistan|personal assistant|executive assistant)\b/i.test(lower);

  if (requestedAssistant && !plan.team.persistentAgents.some((agent) => /assistant/i.test(`${agent.id} ${agent.role} ${agent.name}`))) {
    plan.team.persistentAgents = [
      createPlannerAgentSpec({
        id: "personal-assistant",
        role: "Personal Assistant",
        name: "Personal Assistant",
        purpose: "Own personal coordination, reminders, executive support, and operator handoffs.",
        responsibilities: [
          "Track the operator's priorities and reminders",
          "Prepare concise handoffs and action lists",
          "Handle lightweight coordination and follow-through"
        ],
        outputs: ["daily brief", "priority queue", "assistant handoff"],
        enabled: true
      }),
      ...plan.team.persistentAgents
    ];

    if (plan.intake.size === "small") {
      plan.intake.size = "medium";
    } else if (plan.intake.size === "medium") {
      plan.intake.size = "large";
    }
  }
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

function isLikelyRepositoryUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();

    return (
      host === "github.com" ||
      host === "gitlab.com" ||
      host === "bitbucket.org" ||
      path.endsWith(".git")
    );
  } catch {
    return false;
  }
}

function captureLastGroup(match: RegExpMatchArray) {
  return match.length - 1;
}

function sanitizeExtractedText(value: string) {
  return value
    .replace(/https?:\/\/[^\s)]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s:,-]+|[\s:,-]+$/g, "")
    .trim();
}

function sanitizeTargetCustomerText(value: string) {
  const cleaned = sanitizeExtractedText(value)
    .replace(/^(?:yeni|bir|the|a|an|bir de|bide)\s+/i, "")
    .replace(/\b(?:birlikte|ile|ve|veya)\b/gi, " ")
    .replace(/\b(?:olarak|diye|benim|bide)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || looksLikeProceduralTargetCustomer(cleaned)) {
    return "";
  }

  return cleaned;
}

function sanitizeExtractedName(value: string) {
  const cleaned = sanitizeExtractedText(value)
    .replace(/\b(projesi|projesini|workspace|project|company|firma|şirket)\b/gi, " ")
    .replace(
      /\b(yapal[ıi]m|ekleyelim|kural[ıi]m|başlatal[ıi]m|olsun|diyelim|verelim|koyal[ıi]m|kurmak|kurulum|oluşturmak|oluşturma|başlatmak|başlama|yapmak|yapma|istiyorum|istiyoruz|istemek|want|build|create|make|start|launch|setup|set up)\b/gi,
      " "
    )
    .replace(/\b(yeni|bir)\b/gi, " ")
    .replace(/\b(diye|olarak|benim|bide|bir de|için)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || looksLikeGeneratedName(cleaned)) {
    return "";
  }

  return cleaned;
}

function looksLikeGeneratedName(value: string) {
  const lower = value.toLowerCase();
  return /\b(yapal[ıi]m|ekleyelim|başlatal[ıi]m|kural[ıi]m|olsun|diyelim|verelim|koyal[ıi]m|kurmak|kurulum|oluşturmak|oluşturma|başlatmak|başlama|yapmak|yapma|istiyorum|istiyoruz|istemek|want|build|create|make|start|launch|setup|set up)\b/.test(
    lower
  );
}

function looksLikeProceduralTargetCustomer(value: string) {
  const lower = value.toLowerCase();

  return (
    /\b(yapal[ıi]m|ekleyelim|başlatal[ıi]m|kural[ıi]m|olsun|diyelim|verelim|koyal[ıi]m|kurmak|kurulum|oluşturmak|oluşturma|başlatmak|başlama|yapmak|yapma|istiyorum|istiyoruz|istemek|want|build|create|make|start|launch|setup|set up)\b/.test(
      lower
    ) ||
    /\b(workspace|workspaces|workspace oluştur|workspace oluşturalım|workspace kur|workspace kuralım)\b/.test(lower)
  );
}

function shouldRetitlePrimaryAgent(agentName: string, role: string) {
  const normalizedName = agentName.trim().toLowerCase();
  const normalizedRole = role.trim().toLowerCase();

  if (!normalizedName) {
    return true;
  }

  return (
    normalizedName === "default agent" ||
    normalizedName === normalizedRole ||
    normalizedName === "primary agent" ||
    normalizedName === "workspace agent"
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

function inferNameFromUrl(value: string) {
  try {
    const hostname = new URL(value).hostname.replace(/^www\./, "");
    const [rawName] = hostname.split(".");

    if (!rawName) {
      return undefined;
    }

    return rawName
      .split(/[-_]+/g)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  } catch {
    return undefined;
  }
}

function summarizePlannerChanges(previousPlan: WorkspacePlan | undefined, plan: WorkspacePlan) {
  if (!previousPlan) {
    return [];
  }

  const changes: string[] = [];

  if (previousPlan.company.name !== plan.company.name && plan.company.name) {
    changes.push(`Company name is now ${plan.company.name}.`);
  }

  if (previousPlan.workspace.name !== plan.workspace.name && plan.workspace.name) {
    changes.push(`Workspace name is now ${plan.workspace.name}.`);
  }

  if (previousPlan.company.mission !== plan.company.mission && plan.company.mission) {
    changes.push(`First outcome is ${plan.company.mission}.`);
  }

  if (previousPlan.company.targetCustomer !== plan.company.targetCustomer && plan.company.targetCustomer) {
    changes.push(`First audience is ${plan.company.targetCustomer}.`);
  }

  if (previousPlan.product.offer !== plan.product.offer && plan.product.offer) {
    changes.push(`Core offer is ${plan.product.offer}.`);
  }

  if (previousPlan.workspace.sourceMode !== plan.workspace.sourceMode) {
    changes.push(`Starting point is ${describeSourceMode(plan.workspace.sourceMode)}.`);
  }

  if (previousPlan.intake.sources.length !== plan.intake.sources.length) {
    const delta = plan.intake.sources.length - previousPlan.intake.sources.length;
    if (delta > 0) {
      changes.push(`Added ${delta} new context source${delta === 1 ? "" : "s"}.`);
    }
  }

  return changes;
}

function describeSourceMode(sourceMode: WorkspacePlan["workspace"]["sourceMode"]) {
  if (sourceMode === "clone") {
    return "clone an existing repository";
  }

  if (sourceMode === "existing") {
    return "attach an existing folder";
  }

  return "start from scratch";
}

function lowercaseFirst(value: string) {
  return value ? value.charAt(0).toLowerCase() + value.slice(1) : value;
}

function findAgentId(agents: PlannerPersistentAgentSpec[], keyword: string) {
  return agents.find((agent) => new RegExp(keyword, "i").test(`${agent.id} ${agent.role} ${agent.name}`))?.id;
}

function describeRecommendedPurpose(id: string, role: string, template: WorkspaceTemplate) {
  if (/review/i.test(id) || /review/i.test(role)) {
    return `Pressure-test ${template} work for correctness, regression risk, and missing validation.`;
  }

  if (/test/i.test(id) || /test/i.test(role)) {
    return `Validate behavior, environment assumptions, and release confidence for this ${template} workspace.`;
  }

  if (/learn/i.test(id) || /learn/i.test(role)) {
    return `Keep the workspace memory, conventions, and durable decisions coherent over time.`;
  }

  if (/browser/i.test(id) || /browser/i.test(role)) {
    return `Exercise real UI flows and collect evidence for browser-facing work.`;
  }

  return `Own hands-on delivery and keep the ${template} workspace moving.`;
}

function describeRecommendedResponsibilities(id: string, template: WorkspaceTemplate) {
  if (/review/i.test(id)) {
    return ["Review active work", "Call out regressions", "Protect launch quality"];
  }

  if (/test/i.test(id)) {
    return ["Run verification loops", "Capture evidence", "Surface failing assumptions"];
  }

  if (/learn/i.test(id)) {
    return ["Update durable memory", "Track decisions", "Reduce restart friction"];
  }

  if (/browser/i.test(id)) {
    return ["Exercise flows", "Capture screenshots", "Validate responsive states"];
  }

  return template === "content"
    ? ["Drive content production", "Coordinate handoffs", "Prepare launch artifacts"]
    : ["Implement the next increment", "Coordinate specialists", "Keep execution momentum"];
}

function describeRecommendedOutputs(id: string, template: WorkspaceTemplate) {
  if (/review/i.test(id)) {
    return ["review notes", "risk checklist"];
  }

  if (/test/i.test(id)) {
    return ["verification report", "repro steps"];
  }

  if (/learn/i.test(id)) {
    return ["memory updates", "decision log entries"];
  }

  if (/browser/i.test(id)) {
    return ["screenshots", "browser validation notes"];
  }

  return template === "research"
    ? ["research summary", "evidence log"]
    : ["implementation artifacts", "handoff summary"];
}

function prioritizePrimaryAgent(agents: PlannerPersistentAgentSpec[]) {
  const primaryAgent = agents.find((agent) => agent.isPrimary) ?? agents[0];

  if (!primaryAgent) {
    return agents;
  }

  return [primaryAgent, ...agents.filter((agent) => agent.id !== primaryAgent.id)];
}

function dedupeById<T extends { id: string }>(items: T[]) {
  return items.filter((item, index, list) => list.findIndex((entry) => entry.id === item.id) === index);
}

function dedupeByType<T extends { type: string }>(items: T[]) {
  return items.filter((item, index, list) => list.findIndex((entry) => entry.type === item.type) === index);
}

function normalizeText(value: string) {
  return value.trim();
}

function normalizeOptional(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeList(values: string[] | undefined) {
  return uniqueStrings(
    (values ?? [])
      .flatMap((value) => splitList(value))
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function splitList(value: string) {
  return value
    .split(/\r?\n|,/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function clonePlan(plan: WorkspacePlan): WorkspacePlan {
  return structuredClone(plan);
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function prettify(value: string) {
  return value
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}
