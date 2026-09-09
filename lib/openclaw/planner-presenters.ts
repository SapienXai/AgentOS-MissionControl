import {
  Bot,
  Boxes,
  BriefcaseBusiness,
  Building2,
  Rocket,
  Workflow,
  type LucideIcon
} from "lucide-react";

import type { WorkspacePlan, WorkspacePlanStage } from "@/lib/openclaw/types";

export type PlannerSectionId =
  | "company"
  | "product"
  | "workspace"
  | "team"
  | "operations"
  | "deploy";

export const plannerSectionMeta: Array<{
  id: PlannerSectionId;
  label: string;
  icon: LucideIcon;
}> = [
  { id: "company", label: "Company", icon: Building2 },
  { id: "product", label: "Product", icon: BriefcaseBusiness },
  { id: "workspace", label: "Workspace", icon: Boxes },
  { id: "team", label: "Team", icon: Bot },
  { id: "operations", label: "Operations", icon: Workflow },
  { id: "deploy", label: "Deploy", icon: Rocket }
];

const plannerStages: Array<{
  id: WorkspacePlanStage;
  label: string;
  section: PlannerSectionId;
}> = [
  { id: "intake", label: "Intake", section: "company" },
  { id: "context-harvest", label: "Context", section: "workspace" },
  { id: "team-synthesis", label: "Team", section: "team" },
  { id: "pressure-test", label: "Review", section: "operations" },
  { id: "decision-lock", label: "Lock", section: "deploy" },
  { id: "ready", label: "Ready", section: "deploy" },
  { id: "deploying", label: "Deploying", section: "deploy" },
  { id: "deployed", label: "Live", section: "deploy" }
];

export function getPlannerSectionForStage(stage: WorkspacePlanStage): PlannerSectionId {
  return plannerStages.find((entry) => entry.id === stage)?.section ?? "company";
}

export function getPlannerStageLabel(stage: WorkspacePlanStage) {
  return plannerStages.find((entry) => entry.id === stage)?.label ?? "Draft";
}

export function getPlannerSectionHealth(plan: WorkspacePlan, sectionId: PlannerSectionId): {
  label: string;
  variant: "muted" | "success" | "warning" | "danger";
} {
  switch (sectionId) {
    case "company": {
      const missing = [plan.company.name, plan.company.mission, plan.company.targetCustomer].filter((value) => !value.trim()).length;

      return missing === 0
        ? { label: "Ready to review", variant: "success" }
        : { label: `${missing} core field${missing === 1 ? "" : "s"} missing`, variant: "warning" };
    }
    case "product": {
      const missing = [
        plan.product.offer.trim() ? 0 : 1,
        plan.product.scopeV1.length > 0 ? 0 : 1,
        plan.product.launchPriority.length > 0 ? 0 : 1
      ].reduce((total, value) => total + value, 0);

      return missing === 0
        ? { label: "Scope is defined", variant: "success" }
        : { label: `${missing} product decision${missing === 1 ? "" : "s"} pending`, variant: "warning" };
    }
    case "workspace": {
      let missing = plan.workspace.name.trim() ? 0 : 1;

      if (plan.workspace.materialization.mode === "clone" && !plan.workspace.materialization.repoUrl.trim()) {
        missing += 1;
      }

      if (plan.workspace.materialization.mode === "existing" && !plan.workspace.materialization.existingPath.trim()) {
        missing += 1;
      }

      return missing === 0
        ? { label: "Provisioning path set", variant: "success" }
        : { label: `${missing} workspace input${missing === 1 ? "" : "s"} missing`, variant: "warning" };
    }
    case "team": {
      const enabledAgents = plan.team.persistentAgents.filter((agent) => agent.enabled).length;
      const hasPrimary = plan.team.persistentAgents.some((agent) => agent.enabled && agent.isPrimary);

      if (enabledAgents === 0) {
        return { label: "Add at least one agent", variant: "danger" };
      }

      if (!hasPrimary) {
        return { label: "Primary agent missing", variant: "warning" };
      }

      return { label: `${enabledAgents} active agent${enabledAgents === 1 ? "" : "s"}`, variant: "success" };
    }
    case "operations": {
      const enabledWorkflows = plan.operations.workflows.filter((workflow) => workflow.enabled).length;
      const enabledAutomations = plan.operations.automations.filter((automation) => automation.enabled).length;

      if (enabledWorkflows === 0 && enabledAutomations === 0) {
        return { label: "No runtime loops yet", variant: "warning" };
      }

      return { label: `${enabledWorkflows} workflows, ${enabledAutomations} automations`, variant: "success" };
    }
    case "deploy":
    default: {
      if (!plan.intake.reviewRequested && plan.status !== "deploying" && plan.status !== "deployed") {
        return { label: "Review not opened yet", variant: "muted" };
      }

      if (plan.deploy.blockers.length > 0) {
        return { label: `${plan.deploy.blockers.length} blocker${plan.deploy.blockers.length === 1 ? "" : "s"}`, variant: "danger" };
      }

      if (plan.deploy.warnings.length > 0) {
        return { label: `${plan.deploy.warnings.length} warning${plan.deploy.warnings.length === 1 ? "" : "s"}`, variant: "warning" };
      }

      return { label: "Ready to deploy", variant: "success" };
    }
  }
}

export function summarizePlannerSection(plan: WorkspacePlan, sectionId: PlannerSectionId) {
  switch (sectionId) {
    case "company":
      return plan.company.name
        ? `${plan.company.name}${plan.company.mission ? ` · ${plan.company.mission}` : ""}`
        : "Mission and audience are still being shaped.";
    case "product":
      return plan.product.offer || "Offer and V1 scope are still being drafted.";
    case "workspace":
      return `${humanizePlannerValue(plan.workspace.template)} · ${humanizePlannerValue(plan.workspace.materialization.mode)}`;
    case "team":
      return `${plan.team.persistentAgents.filter((agent) => agent.enabled).length} agents drafted`;
    case "operations":
      return `${plan.operations.workflows.filter((workflow) => workflow.enabled).length} workflows · ${plan.operations.automations.filter((automation) => automation.enabled).length} automations`;
    case "deploy":
    default:
      return plan.intake.reviewRequested ? "Deploy review is open." : "Review not started.";
  }
}

export function humanizePlannerValue(value: string) {
  return value
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
