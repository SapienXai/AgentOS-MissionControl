import {
  createPlannerContextSource,
  createPlannerMessage,
  enrichWorkspacePlan
} from "@/lib/openclaw/planner-core";
import type {
  WorkspaceCreateInput,
  WorkspaceCreateRules,
  WorkspaceModelProfile,
  WorkspacePlan,
  WorkspaceTeamPreset,
  WorkspaceTemplate
} from "@/lib/openclaw/types";
import { DEFAULT_WORKSPACE_RULES } from "@/lib/openclaw/workspace-presets";
import {
  analyzeWorkspaceWizardSourceInput,
  inferWorkspaceWizardTemplate,
  resolveWorkspaceWizardName,
  type WorkspaceWizardBasicDraft
} from "@/lib/openclaw/workspace-wizard-inference";

const basicSourceId = "workspace-wizard-basic-source";
const basicImportPrefix = "Imported quick setup assumptions:";

export type WorkspaceWizardQuickSetupPreset = "standard" | "fastest" | "custom";

export function createWorkspaceWizardQuickCreateRules(
  preset: WorkspaceWizardQuickSetupPreset = "standard"
): WorkspaceCreateRules {
  return {
    ...DEFAULT_WORKSPACE_RULES,
    workspaceOnly: true,
    generateStarterDocs: preset !== "fastest",
    generateMemory: preset !== "fastest",
    kickoffMission: preset !== "fastest"
  };
}

export function normalizeWorkspaceWizardQuickCreateRules(
  rules?: Partial<WorkspaceCreateRules>
): WorkspaceCreateRules {
  return {
    ...createWorkspaceWizardQuickCreateRules(),
    ...rules,
    workspaceOnly: true
  };
}

export function inferWorkspaceWizardQuickSetupPreset(
  rules?: Partial<WorkspaceCreateRules>
): WorkspaceWizardQuickSetupPreset {
  const normalized = normalizeWorkspaceWizardQuickCreateRules(rules);

  if (!normalized.generateStarterDocs && !normalized.generateMemory && !normalized.kickoffMission) {
    return "fastest";
  }

  if (normalized.generateStarterDocs && normalized.generateMemory && normalized.kickoffMission) {
    return "standard";
  }

  return "custom";
}

export function applyBasicInputToWorkspacePlan(
  plan: WorkspacePlan,
  draft: WorkspaceWizardBasicDraft,
  rulesOverride?: Partial<WorkspaceCreateRules>,
  shapeOverride?: {
    template?: WorkspaceTemplate;
    modelProfile?: WorkspaceModelProfile;
  }
) {
  const next = structuredClone(plan);
  const sourceAnalysis = analyzeWorkspaceWizardSourceInput(draft.source);
  const resolvedName = resolveWorkspaceWizardName(draft);
  const goal = draft.goal.trim();

  next.intake.mode = next.intake.mode || "guided";
  next.intake.started = Boolean(goal || draft.source.trim());

  if (goal) {
    if (!next.intake.initialPrompt) {
      next.intake.initialPrompt = goal;
    }

    next.intake.latestPrompt = goal;
    next.company.mission = goal;

    if (!next.product.offer.trim()) {
      next.product.offer = goal;
    }
  }

  next.workspace.name = resolvedName;
  next.workspace.sourceMode = sourceAnalysis.createSourceMode;
  next.workspace.repoUrl = sourceAnalysis.repoUrl;
  next.workspace.existingPath = sourceAnalysis.existingPath;
  next.workspace.template = shapeOverride?.template ?? inferWorkspaceWizardTemplate(`${goal}\n${draft.source}`);
  next.workspace.modelProfile = shapeOverride?.modelProfile ?? next.workspace.modelProfile ?? "balanced";
  next.workspace.rules = normalizeWorkspaceWizardQuickCreateRules(rulesOverride ?? next.workspace.rules);

  next.intake.sources = next.intake.sources.filter((source) => source.id !== basicSourceId);

  if (sourceAnalysis.kind !== "empty") {
    next.intake.sources.unshift(
      createPlannerContextSource({
        id: basicSourceId,
        kind:
          sourceAnalysis.kind === "clone"
            ? "repo"
            : sourceAnalysis.kind === "existing"
              ? "folder"
              : sourceAnalysis.kind === "website"
                ? "website"
                : "prompt",
        label: sourceAnalysis.label,
        summary: sourceAnalysis.hint,
        details: [sourceAnalysis.hint],
        url: sourceAnalysis.repoUrl ?? sourceAnalysis.websiteUrl
      })
    );
  }

  return enrichWorkspacePlan(next);
}

export function appendBasicModeImportNote(plan: WorkspacePlan, draft: WorkspaceWizardBasicDraft) {
  const next = structuredClone(plan);
  const goal = draft.goal.trim();
  const source = draft.source.trim();

  next.conversation = next.conversation.filter(
    (message) => !(message.role === "system" && message.author === "Workspace Wizard" && message.text.startsWith(basicImportPrefix))
  );

  if (!goal && !source) {
    return enrichWorkspacePlan(next);
  }

  const segments = [
    goal ? `goal: ${goal}` : null,
    source ? `source: ${source}` : null,
    `fast-path name: ${resolveWorkspaceWizardName(draft)}`
  ].filter(Boolean);

  next.conversation.push(
    createPlannerMessage(
      "system",
      "Workspace Wizard",
      `${basicImportPrefix} ${segments.join(" · ")}`
    )
  );

  return enrichWorkspacePlan(next);
}

export function buildWorkspaceCreateInputFromPlan(
  plan: WorkspacePlan,
  options: {
    teamPreset?: WorkspaceTeamPreset;
  } = {}
): WorkspaceCreateInput {
  return {
    name: plan.workspace.name,
    brief: buildWorkspaceCreateBriefFromPlan(plan),
    directory: plan.workspace.directory,
    modelId: plan.workspace.modelId,
    sourceMode: plan.workspace.sourceMode,
    repoUrl: plan.workspace.repoUrl,
    existingPath: plan.workspace.existingPath,
    template: plan.workspace.template,
    teamPreset: options.teamPreset ?? "solo",
    modelProfile: plan.workspace.modelProfile || "balanced",
    docOverrides: plan.workspace.docOverrides,
    rules: normalizeWorkspaceWizardQuickCreateRules(plan.workspace.rules),
    contextSources: plan.intake.sources
  };
}

export function extractBasicRulesFromWorkspacePlan(plan: WorkspacePlan): WorkspaceCreateRules {
  return normalizeWorkspaceWizardQuickCreateRules(plan.workspace.rules);
}

export function buildWorkspaceCreateBriefFromPlan(plan: WorkspacePlan) {
  const lines = [
    plan.company.mission.trim() || plan.product.offer.trim(),
    plan.company.name.trim() ? `Company: ${plan.company.name.trim()}` : null,
    plan.company.targetCustomer.trim() ? `Audience: ${plan.company.targetCustomer.trim()}` : null,
    plan.product.offer.trim() ? `Offer: ${plan.product.offer.trim()}` : null,
    plan.company.successSignals.length > 0 ? `Success signals: ${plan.company.successSignals.join(", ")}` : null,
    plan.product.scopeV1.length > 0 ? `Scope: ${plan.product.scopeV1.join(", ")}` : null,
    ...plan.intake.sources.flatMap((source) => {
      if (source.id !== basicSourceId && source.kind !== "website") {
        return [];
      }

      if (source.kind === "repo" && source.url) {
        return [`Bootstrap source: clone ${source.url}`];
      }

      if (source.kind === "folder") {
        return [`Bootstrap source: existing folder ${source.summary}`];
      }

      if (source.kind === "website" && source.url) {
        const confidence = typeof source.confidence === "number" ? ` (${source.confidence}%)` : "";
        return [`Reference website${confidence}: ${source.url} - ${source.summary}`];
      }

      if (source.kind === "prompt") {
        return [`Additional context: ${source.summary}`];
      }

      return [];
    })
  ];

  return lines.filter((value): value is string => Boolean(value?.trim())).join("\n");
}

export function hasAdvancedWorkspaceDetails(plan: WorkspacePlan | null) {
  if (!plan) {
    return false;
  }

  return (
    plan.team.persistentAgents.filter((agent) => agent.enabled).length > 1 ||
    plan.operations.workflows.some((workflow) => workflow.enabled) ||
    plan.operations.automations.some((automation) => automation.enabled) ||
    plan.operations.channels.some((channel) => channel.enabled && channel.type !== "internal") ||
    plan.operations.hooks.some((hook) => hook.enabled)
  );
}
