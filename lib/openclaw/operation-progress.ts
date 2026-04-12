import type {
  OperationProgressActivity,
  OperationProgressSnapshot,
  OperationProgressStepSnapshot,
  OperationProgressStepStatus,
  WorkspaceSourceMode
} from "@/lib/openclaw/types";

type OperationProgressTemplateStep = Pick<
  OperationProgressStepSnapshot,
  "id" | "label" | "description"
>;

export type OperationProgressTemplate = {
  title: string;
  description: string;
  steps: OperationProgressTemplateStep[];
};

type OperationProgressTrackerOptions = {
  template: OperationProgressTemplate;
  onProgress?: (snapshot: OperationProgressSnapshot) => Promise<void> | void;
};

type StepUpdate = Partial<Pick<OperationProgressStepSnapshot, "label" | "description" | "detail">> & {
  percent?: number;
  status?: OperationProgressStepStatus;
};

export function buildWorkspaceCreateProgressTemplate(input: {
  sourceMode: WorkspaceSourceMode;
  agentCount: number;
  kickoffMission: boolean;
}): OperationProgressTemplate {
  const sourceStep =
    input.sourceMode === "clone"
      ? {
          label: "Cloning repository",
          description: "The repository is being cloned before workspace files are added."
        }
      : input.sourceMode === "existing"
        ? {
            label: "Attaching existing folder",
            description: "AgentOS is validating the existing directory and preparing it for bootstrap."
          }
        : {
            label: "Preparing workspace folder",
            description: "A fresh workspace directory is being created inside the configured workspace root."
          };

  return {
    title: "Provisioning workspace",
    description: "AgentOS is creating the workspace and reporting each real bootstrap step as it finishes.",
    steps: [
      {
        id: "validate",
        label: "Checking input and target path",
        description: "Workspace input, agent ids, and the destination directory are being validated."
      },
      {
        id: "source",
        label: sourceStep.label,
        description: sourceStep.description
      },
      {
        id: "scaffold",
        label: "Scaffolding workspace files",
        description: "Core docs, local state, starter memory, and shared workspace metadata are being written."
      },
      {
        id: "agents",
        label: input.agentCount === 1 ? "Creating the first agent" : "Creating workspace agents",
        description:
          input.agentCount === 1
            ? "The primary agent is being provisioned and linked to the workspace."
            : "Each enabled agent is being provisioned and linked to the workspace."
      },
      {
        id: "kickoff",
        label: input.kickoffMission ? "Running kickoff mission" : "Finalizing workspace",
        description: input.kickoffMission
          ? "The primary agent is inspecting the new workspace and refining the initial setup."
          : "Workspace bootstrap is wrapping up without a kickoff mission."
      }
    ]
  };
}

export function buildPlannerDeployProgressTemplate(input: {
  sourceMode: WorkspaceSourceMode;
  agentCount: number;
  kickoffMission: boolean;
  hasChannels: boolean;
  hasAutomations: boolean;
  hasPlannerKickoffs: boolean;
}): OperationProgressTemplate {
  const createTemplate = buildWorkspaceCreateProgressTemplate({
    sourceMode: input.sourceMode,
    agentCount: input.agentCount,
    kickoffMission: input.kickoffMission
  });

  return {
    title: "Deploying workspace",
    description: "The planner is turning the blueprint into a live workspace and streaming each deploy stage.",
    steps: [
      {
        id: "plan",
        label: "Locking deploy plan",
        description: "Deploy blockers are being checked and the planner state is being locked for launch."
      },
      ...createTemplate.steps,
      {
        id: "blueprint",
        label: "Writing planner files",
        description: "Planner blueprint, company notes, and workflow docs are being written into the workspace."
      },
      {
        id: "channels",
        label: input.hasChannels ? "Provisioning channels" : "Checking channels",
        description: input.hasChannels
          ? "Enabled external channels are being provisioned and connected."
          : "No external channels are enabled, so this stage will pass quickly."
      },
      {
        id: "automations",
        label: input.hasAutomations ? "Provisioning automations" : "Checking automation loops",
        description: input.hasAutomations
          ? "Enabled recurring loops are being attached to their target agents."
          : "No recurring automations are enabled, so this stage is mostly validation."
      },
      {
        id: "planner-kickoff",
        label: input.hasPlannerKickoffs ? "Running planner kickoff missions" : "Finalizing deploy",
        description: input.hasPlannerKickoffs
          ? "The first missions are being dispatched so the new workspace starts with clear momentum."
          : "The workspace is being finalized and the deploy request is wrapping up."
      }
    ]
  };
}

export function createPendingOperationProgressSnapshot(
  template: OperationProgressTemplate
): OperationProgressSnapshot {
  return {
    title: template.title,
    description: template.description,
    percent: 0,
    steps: template.steps.map((step) => ({
      ...step,
      status: "pending",
      percent: 0,
      activities: []
    }))
  };
}

export function createOperationProgressTracker({
  template,
  onProgress
}: OperationProgressTrackerOptions) {
  const snapshot = createPendingOperationProgressSnapshot(template);
  let activityCounter = 0;

  const getStep = (stepId: string) => {
    const step = snapshot.steps.find((entry) => entry.id === stepId);

    if (!step) {
      throw new Error(`Unknown operation progress step: ${stepId}`);
    }

    return step;
  };

  const emit = async () => {
    snapshot.percent = calculateOverallPercent(snapshot.steps);
    await onProgress?.(structuredClone(snapshot));
  };

  const applyStepUpdate = (stepId: string, update: StepUpdate) => {
    const step = getStep(stepId);

    if (typeof update.label === "string") {
      step.label = update.label;
    }

    if (typeof update.description === "string") {
      step.description = update.description;
    }

    if (typeof update.detail === "string") {
      step.detail = update.detail;
    }

    if (typeof update.percent === "number") {
      step.percent = clampPercent(update.percent);
    }

    if (update.status) {
      step.status = update.status;
    }
  };

  return {
    snapshot() {
      snapshot.percent = calculateOverallPercent(snapshot.steps);
      return structuredClone(snapshot);
    },
    async startStep(stepId: string, detail?: string) {
      applyStepUpdate(stepId, {
        status: "active",
        percent: Math.max(getStep(stepId).percent, 2),
        detail
      });
      await emit();
    },
    async updateStep(stepId: string, update: StepUpdate) {
      applyStepUpdate(stepId, update);
      await emit();
    },
    async addActivity(
      stepId: string,
      message: string,
      status: OperationProgressStepStatus = "active"
    ) {
      const step = getStep(stepId);
      const activity: OperationProgressActivity = {
        id: `${stepId}-${activityCounter}`,
        message,
        status,
      };

      activityCounter += 1;
      step.activities.push(activity);

      if (step.status === "pending" && status === "active") {
        step.status = "active";
      }

      await emit();
    },
    async completeStep(stepId: string, detail?: string) {
      applyStepUpdate(stepId, {
        status: "done",
        percent: 100,
        detail
      });
      await emit();
    },
    async failStep(stepId: string, detail?: string) {
      applyStepUpdate(stepId, {
        status: "error",
        percent: 100,
        detail
      });
      await emit();
    },
    async syncStep(incomingStep: OperationProgressStepSnapshot) {
      const step = getStep(incomingStep.id);
      step.label = incomingStep.label;
      step.description = incomingStep.description;
      step.status = incomingStep.status;
      step.percent = clampPercent(incomingStep.percent);
      step.detail = incomingStep.detail;
      step.activities = structuredClone(incomingStep.activities);
      await emit();
    }
  };
}

function calculateOverallPercent(steps: OperationProgressStepSnapshot[]) {
  if (steps.length === 0) {
    return 0;
  }

  const total = steps.reduce((sum, step) => sum + clampPercent(step.percent), 0);
  return Math.round(total / steps.length);
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round(value)));
}
