"use client";

import {
  Bot,
  Boxes,
  BriefcaseBusiness,
  Building2,
  Check,
  LoaderCircle,
  MessageSquare,
  Plus,
  Rocket,
  Sparkles,
  Target,
  Trash2,
  Workflow
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import {
  AGENT_PRESET_OPTIONS,
  resolveAgentPolicy
} from "@/lib/openclaw/agent-presets";
import {
  applyPlannerTemplate,
  createPlannerAgentSpec,
  createPlannerAutomationSpec,
  createPlannerChannelSpec,
  createPlannerHookSpec,
  createPlannerMessage,
  createPlannerWorkflowSpec,
  enrichWorkspacePlan,
  getPlannerWorkspaceSizeProfile
} from "@/lib/openclaw/planner-core";
import type {
  MissionControlSnapshot,
  PlannerAutomationSpec,
  PlannerChannelType,
  PlannerPersistentAgentSpec,
  PlannerWorkspaceSize,
  WorkspacePlan,
  WorkspacePlanDeployResult,
  WorkspaceTemplate
} from "@/lib/openclaw/types";
import { cn } from "@/lib/utils";

const plannerStorageKey = "mission-control-workspace-plan-id";

const plannerStages = [
  {
    id: "intake",
    label: "Intake",
    section: "company"
  },
  {
    id: "context-harvest",
    label: "Context",
    section: "workspace"
  },
  {
    id: "team-synthesis",
    label: "Team",
    section: "team"
  },
  {
    id: "pressure-test",
    label: "Review",
    section: "operations"
  },
  {
    id: "decision-lock",
    label: "Lock",
    section: "deploy"
  },
  {
    id: "ready",
    label: "Ready",
    section: "deploy"
  },
  {
    id: "deploying",
    label: "Deploying",
    section: "deploy"
  },
  {
    id: "deployed",
    label: "Live",
    section: "deploy"
  }
] as const;

const workspaceTemplateOptions: Array<{
  value: WorkspaceTemplate;
  label: string;
}> = [
  { value: "software", label: "Software" },
  { value: "frontend", label: "Frontend" },
  { value: "backend", label: "Backend" },
  { value: "research", label: "Research" },
  { value: "content", label: "Content" }
];

const sourceModeOptions = [
  { value: "empty", label: "Empty" },
  { value: "clone", label: "Clone repo" },
  { value: "existing", label: "Existing folder" }
] as const;

const workspaceSizeOptions: Array<{
  value: PlannerWorkspaceSize;
  label: string;
  description: string;
}> = [
  {
    value: "small",
    label: "Small",
    description: "Lean chat view. Draft 1 agent and 1 task."
  },
  {
    value: "medium",
    label: "Medium",
    description: "Balanced view. Draft 3 agents, 3 tasks, and 1 automation."
  },
  {
    value: "large",
    label: "Large",
    description: "Fuller operating view. Draft 5 agents, 4 tasks, 2 automations, and 1 channel."
  }
] as const;

const modelProfileOptions = [
  { value: "fast", label: "Fast" },
  { value: "balanced", label: "Balanced" },
  { value: "quality", label: "Quality" }
] as const;

const channelTypeOptions: Array<{
  value: PlannerChannelType;
  label: string;
}> = [
  { value: "internal", label: "Internal" },
  { value: "slack", label: "Slack" },
  { value: "telegram", label: "Telegram" },
  { value: "discord", label: "Discord" },
  { value: "googlechat", label: "Google Chat" }
] as const;

type WorkspacePlannerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: MissionControlSnapshot;
  onRefresh: () => Promise<void>;
  onWorkspaceCreated: (workspaceId: string) => void;
};

type PlannerSectionId =
  | "company"
  | "product"
  | "workspace"
  | "team"
  | "operations"
  | "deploy";

type PlannerBusyStatus = {
  title: string;
  description: string;
};

const plannerSections: Array<{
  id: PlannerSectionId;
  label: string;
  icon: typeof Building2;
}> = [
  { id: "company", label: "Company", icon: Building2 },
  { id: "product", label: "Product", icon: BriefcaseBusiness },
  { id: "workspace", label: "Workspace", icon: Boxes },
  { id: "team", label: "Team", icon: Bot },
  { id: "operations", label: "Operations", icon: Workflow },
  { id: "deploy", label: "Deploy", icon: Rocket }
];

export function WorkspacePlannerDialog({
  open,
  onOpenChange,
  snapshot,
  onRefresh,
  onWorkspaceCreated
}: WorkspacePlannerDialogProps) {
  const [plan, setPlan] = useState<WorkspacePlan | null>(null);
  const [activeSection, setActiveSection] = useState<PlannerSectionId>("company");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendProgressStep, setSendProgressStep] = useState(0);
  const [planId, setPlanId] = useState<string | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);

  const enabledAgentOptions = useMemo(
    () =>
      (plan?.team.persistentAgents ?? [])
        .filter((agent) => agent.enabled)
        .map((agent) => ({
          label: agent.name,
          value: agent.id
        })),
    [plan]
  );
  const selectedSize = plan?.intake.size ?? "medium";
  const selectedSizeProfile = useMemo(() => getPlannerWorkspaceSizeProfile(selectedSize), [selectedSize]);
  const intakeStarted = plan?.intake.started ?? false;
  const reviewRequested = Boolean(plan?.intake.reviewRequested || plan?.status === "deploying" || plan?.status === "deployed");
  const guidedMode =
    Boolean(intakeStarted && plan?.intake.mode === "guided" && !reviewRequested);
  const canRequestReview = Boolean(
    plan &&
      (plan.company.mission ||
        plan.product.offer ||
        plan.intake.sources.length > 0 ||
        plan.workspace.name)
  );
  const earlyPlanningStage = !reviewRequested;
  const guidedFlowStages = plannerStages.slice(0, 6);
  const activeFlowStageIndex = plan
    ? (() => {
        const stageIndex = guidedFlowStages.findIndex((entry) => entry.id === plan.stage);
        return stageIndex >= 0 ? stageIndex : guidedFlowStages.length - 1;
      })()
    : 0;

  useEffect(() => {
    if (!plan || !messageListRef.current) {
      return;
    }

    messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
  }, [plan]);

  useEffect(() => {
    if (!isSending) {
      setSendProgressStep(0);
      return;
    }

    setSendProgressStep(0);
    const firstTimer = globalThis.setTimeout(() => setSendProgressStep(1), 1800);
    const secondTimer = globalThis.setTimeout(() => setSendProgressStep(2), 6200);

    return () => {
      globalThis.clearTimeout(firstTimer);
      globalThis.clearTimeout(secondTimer);
    };
  }, [isSending, intakeStarted]);

  const sendStatus = useMemo(
    () => getPlannerBusyStatus({ initialTurn: !intakeStarted, step: sendProgressStep, active: isSending }),
    [intakeStarted, isSending, sendProgressStep]
  );

  const createFreshPlan = useCallback(async () => {
    const response = await fetch("/api/planner", {
      method: "POST"
    });
    const result = (await response.json()) as { plan?: WorkspacePlan; error?: string };

    if (!response.ok || !result.plan) {
      throw new Error(result.error || "Unable to create planner workspace.");
    }

    setPlan(result.plan);
    setPlanId(result.plan.id);
    setActiveSection("company");
    setMessage("");
    globalThis.localStorage?.setItem(plannerStorageKey, result.plan.id);
  }, []);

  const loadPlan = useCallback(async () => {
    setIsLoading(true);

    try {
      const storedPlanId = globalThis.localStorage?.getItem(plannerStorageKey);

      if (storedPlanId) {
        const response = await fetch(`/api/planner/${storedPlanId}`, {
          cache: "no-store"
        });

        if (response.ok) {
          const result = (await response.json()) as { plan: WorkspacePlan };
          setPlan(result.plan);
          setPlanId(result.plan.id);
          setActiveSection(getPlannerSectionForStage(result.plan.stage));
          return;
        }
      }

      await createFreshPlan();
    } catch (error) {
      toast.error("Planner could not be loaded.", {
        description: error instanceof Error ? error.message : "Unknown planner error."
      });
    } finally {
      setIsLoading(false);
    }
  }, [createFreshPlan]);

  useEffect(() => {
    if (!open) {
      return;
    }

    void loadPlan();
  }, [loadPlan, open]);

  const updatePlan = (updater: (current: WorkspacePlan) => WorkspacePlan) => {
    setPlan((current) => {
      if (!current) {
        return current;
      }

      return enrichWorkspacePlan(updater(structuredClone(current)));
    });
  };

  const switchPlannerMode = (mode: "guided" | "advanced") => {
    updatePlan((current) => {
      current.intake.mode = mode;
      if (mode === "guided" && current.status !== "deploying" && current.status !== "deployed") {
        current.intake.reviewRequested = false;
      }
      return current;
    });
  };

  const requestDeployReview = () => {
    updatePlan((current) => {
      current.intake.mode = "advanced";
      current.intake.reviewRequested = true;
      current.advisorNotes = [];
      current.conversation.push(
        createPlannerMessage(
          "assistant",
          "Workspace Architect",
          "Deploy review is open now. I am surfacing the real blockers and warnings that matter before launch."
        )
      );
      return current;
    });
    setActiveSection("deploy");
  };

  const savePlan = async (targetPlan = plan) => {
    if (!targetPlan || !planId) {
      return;
    }

    setIsSaving(true);

    try {
      const response = await fetch(`/api/planner/${planId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          plan: targetPlan
        })
      });
      const result = (await response.json()) as { plan?: WorkspacePlan; error?: string };

      if (!response.ok || !result.plan) {
        throw new Error(result.error || "Unable to save planner workspace.");
      }

      setPlan(result.plan);
      toast.success("Planner draft saved.");
    } catch (error) {
      toast.error("Planner draft could not be saved.", {
        description: error instanceof Error ? error.message : "Unknown planner save error."
      });
    } finally {
      setIsSaving(false);
    }
  };

  const submitTurn = async () => {
    if (!plan || !planId || !message.trim()) {
      return;
    }

    setIsSending(true);

    try {
      const response = await fetch(`/api/planner/${planId}/turn`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message,
          plan
        })
      });
      const result = (await response.json()) as { plan?: WorkspacePlan; error?: string };

      if (!response.ok || !result.plan) {
        throw new Error(result.error || "Unable to process planner turn.");
      }

      setPlan(result.plan);
      setMessage("");
    } catch (error) {
      toast.error("Planner turn failed.", {
        description: error instanceof Error ? error.message : "Unknown planner turn error."
      });
    } finally {
      setIsSending(false);
    }
  };

  const simulateTeam = async () => {
    if (!plan || !planId) {
      return;
    }

    setIsSimulating(true);

    try {
      const response = await fetch(`/api/planner/${planId}/simulate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          plan
        })
      });
      const result = (await response.json()) as { plan?: WorkspacePlan; error?: string };

      if (!response.ok || !result.plan) {
        throw new Error(result.error || "Unable to simulate planner team.");
      }

      setPlan(result.plan);
      toast.success("Planner team simulated.");
    } catch (error) {
      toast.error("Planner simulation failed.", {
        description: error instanceof Error ? error.message : "Unknown planner simulation error."
      });
    } finally {
      setIsSimulating(false);
    }
  };

  const deployPlan = async () => {
    if (!plan || !planId) {
      return;
    }

    setIsDeploying(true);

    try {
      const response = await fetch(`/api/planner/${planId}/deploy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          plan
        })
      });
      const result = (await response.json()) as (WorkspacePlanDeployResult & { error?: string }) | null;

      if (!response.ok || !result || !result.plan) {
        throw new Error(result?.error || "Unable to deploy planner workspace.");
      }

      setPlan(result.plan);
      await onRefresh();
      onWorkspaceCreated(result.workspaceId);
      onOpenChange(false);
      toast.success("Workspace deployed.", {
        description: result.workspacePath
      });
    } catch (error) {
      toast.error("Planner deploy failed.", {
        description: error instanceof Error ? error.message : "Unknown deploy error."
      });
    } finally {
      setIsDeploying(false);
    }
  };

  if (!open) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[92vh] max-w-[min(1440px,96vw)] overflow-hidden p-0">
        <div className="flex h-full min-h-0 flex-col bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.07),_transparent_28%),linear-gradient(180deg,_rgba(4,8,15,0.98),_rgba(3,6,12,0.98))]">
          <DialogHeader className="border-b border-white/10 px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-3xl">
                <DialogTitle className="flex items-center gap-2.5 text-base">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-cyan-300/35 bg-cyan-300/10 text-cyan-100">
                    <Bot className="h-[18px] w-[18px]" />
                  </span>
                  <span>
                    <span className="block text-lg font-semibold tracking-tight text-white">Workspace Assistant</span>
                    {!intakeStarted ? (
                      <span className="mt-0.5 block text-xs font-normal uppercase tracking-[0.18em] text-slate-500">
                        Architect-led workspace planning
                      </span>
                    ) : null}
                  </span>
                </DialogTitle>
                {intakeStarted && plan ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {guidedFlowStages.map((stage, index) => {
                      const active = index === activeFlowStageIndex;
                      const complete = index < activeFlowStageIndex;

                      return (
                        <span
                          key={stage.id}
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em]",
                            active
                              ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-100"
                              : complete
                                ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-100"
                                : "border-white/10 bg-white/[0.03] text-slate-500"
                          )}
                        >
                          {stage.label}
                        </span>
                      );
                    })}
                  </div>
                ) : (
                  <DialogDescription className="mt-1.5 text-xs leading-5 text-slate-400">
                    {selectedSizeProfile.label} mode keeps the chat lean while the architect still inspects links, pulls context,
                    and drafts the full workspace blueprint.
                  </DialogDescription>
                )}
              </div>
              {intakeStarted ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="muted">{selectedSizeProfile.label} mode</Badge>
                  {plan ? (
                    <Badge
                      variant={
                        reviewRequested
                          ? plan.status === "ready"
                            ? "success"
                            : plan.status === "blocked"
                              ? "danger"
                              : "muted"
                          : "muted"
                      }
                    >
                      {reviewRequested ? plan.status : `${plan.intake.confirmations.length} decisions pending`}
                    </Badge>
                  ) : null}
                  {plan ? <Badge variant="muted">{plan.readinessScore}% drafted</Badge> : null}
                  <Button variant="secondary" size="sm" onClick={() => void createFreshPlan()} disabled={isLoading || isSaving || isSending || isDeploying}>
                    New
                  </Button>
                  {guidedMode ? (
                    <>
                      <Button variant="secondary" size="sm" onClick={() => switchPlannerMode("advanced")} disabled={isLoading || isSending || isDeploying}>
                        Advanced
                      </Button>
                      <Button size="sm" onClick={requestDeployReview} disabled={!canRequestReview || isLoading || isSending || isDeploying}>
                        Review
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button variant="secondary" size="sm" onClick={() => switchPlannerMode("guided")} disabled={isLoading || isSending || isDeploying || plan?.status === "deploying" || plan?.status === "deployed"}>
                        Guided
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => void savePlan()} disabled={!plan || isSaving || isLoading}>
                        {isSaving ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Save
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => void simulateTeam()} disabled={!plan || isSimulating || isLoading || isDeploying}>
                        {isSimulating ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Simulate
                      </Button>
                      {!reviewRequested ? (
                        <Button size="sm" onClick={requestDeployReview} disabled={!canRequestReview || isLoading || isSending || isDeploying}>
                          Review
                        </Button>
                      ) : (
                        <Button size="sm" onClick={() => void deployPlan()} disabled={!plan || plan.deploy.blockers.length > 0 || isDeploying || isLoading}>
                          {isDeploying ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Rocket className="mr-2 h-4 w-4" />}
                          DEPLOY
                        </Button>
                      )}
                    </>
                  )}
                </div>
              ) : null}
            </div>
          </DialogHeader>

          {isLoading || !plan ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="flex items-center gap-3 text-sm text-slate-300">
                <LoaderCircle className="h-5 w-5 animate-spin" />
                Building planner workspace...
              </div>
            </div>
          ) : !intakeStarted ? (
            <PromptFirstPlannerIntake
              size={selectedSize}
              value={message}
              isSending={isSending}
              sendStatus={sendStatus}
              onChange={setMessage}
              onSelectSize={(size) =>
                updatePlan((current) => {
                  current.intake.size = size;
                  return current;
                })
              }
              onSubmit={() => void submitTurn()}
            />
          ) : guidedMode ? (
            <GuidedPlannerWorkspace
              plan={plan}
              message={message}
              isSending={isSending}
              sendStatus={sendStatus}
              messageListRef={messageListRef}
              onChangeMessage={setMessage}
              onSubmit={() => void submitTurn()}
              onToggleAutopilot={() =>
                updatePlan((current) => ({
                  ...current,
                  autopilot: !current.autopilot
                }))
              }
              onOpenAdvanced={() => switchPlannerMode("advanced")}
              onRequestReview={requestDeployReview}
              canRequestReview={canRequestReview}
              onOpenSection={(section) => {
                setActiveSection(section);
                switchPlannerMode("advanced");
              }}
            />
          ) : (
            <div className="grid min-h-0 flex-1 grid-rows-[auto,minmax(0,1fr),minmax(0,1fr)] lg:grid-cols-[184px,minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr),minmax(0,1fr)] xl:grid-cols-[184px,minmax(0,0.94fr),minmax(0,1.06fr)] xl:grid-rows-1">
              <StageRail
                className="min-h-0 overflow-y-auto border-b border-white/10 bg-[rgba(9,14,22,0.9)] lg:row-span-2 lg:border-b-0 lg:border-r xl:row-span-1"
                plan={plan}
                activeSection={activeSection}
                onSectionChange={setActiveSection}
              />

              <div className="min-h-0 min-w-0 border-b border-white/10 bg-[rgba(7,11,18,0.55)] xl:border-b-0 xl:border-r">
                <div className="flex h-full min-h-0 flex-col">
                  <div className="border-b border-white/10 px-4 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="max-w-xl">
                        <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Architect</p>
                        <p className="mt-1.5 text-sm leading-6 text-slate-300">{plan.architectSummary}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          updatePlan((current) => ({
                            ...current,
                            autopilot: !current.autopilot
                          }))
                        }
                        className={cn(
                          "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors",
                          plan.autopilot
                            ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-100"
                            : "border-white/10 bg-white/[0.03] text-slate-300"
                        )}
                      >
                        <Check className={cn("h-3.5 w-3.5", !plan.autopilot && "opacity-0")} />
                        Autopilot
                      </button>
                    </div>
                    <div className="mt-4 grid gap-2 sm:grid-cols-3">
                      <CompactMetric
                        label={earlyPlanningStage ? "Confirm" : "Blockers"}
                        value={String(earlyPlanningStage ? plan.intake.confirmations.length : plan.deploy.blockers.length)}
                        tone={
                          earlyPlanningStage
                            ? plan.intake.confirmations.length > 0
                              ? "warning"
                              : "success"
                            : plan.deploy.blockers.length > 0
                              ? "danger"
                              : "success"
                        }
                      />
                      <CompactMetric
                        label="Active agents"
                        value={String(plan.team.persistentAgents.filter((agent) => agent.enabled).length)}
                      />
                      <CompactMetric
                        label="Ops"
                        value={`${plan.operations.workflows.filter((workflow) => workflow.enabled).length} wf / ${plan.operations.automations.filter((automation) => automation.enabled).length} auto`}
                      />
                    </div>
                  </div>

                  <div ref={messageListRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
                    {plan.intake.sources.length > 0 ? (
                      <div className="rounded-[18px] border border-white/10 bg-white/[0.02] p-4">
                        <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Collected context</p>
                        <div className="mt-3 space-y-3">
                          {plan.intake.sources.map((source) => (
                            <div key={source.id} className="rounded-[14px] border border-white/10 bg-slate-950/45 p-3">
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-sm font-medium text-white">{source.label}</p>
                                <Badge variant={source.status === "error" ? "warning" : "muted"}>{source.kind}</Badge>
                              </div>
                              <p className="mt-2 text-sm leading-6 text-slate-300">{source.summary}</p>
                              {source.details.length > 0 ? (
                                <div className="mt-2 space-y-1">
                                  {source.details.slice(0, 2).map((detail) => (
                                    <p key={detail} className="text-xs leading-5 text-slate-400">
                                      {detail}
                                    </p>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {plan.intake.confirmations.length > 0 ? (
                      <div className="rounded-[18px] border border-amber-400/20 bg-amber-400/10 p-4">
                        <p className="text-[11px] uppercase tracking-[0.22em] text-amber-100/80">Needs confirmation</p>
                        <div className="mt-3 space-y-2">
                          {plan.intake.confirmations.slice(0, 4).map((item) => (
                            <p key={item} className="text-sm leading-6 text-amber-50">
                              {item}
                            </p>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {plan.conversation.map((entry) => (
                      <div
                        key={entry.id}
                        className={cn(
                          "rounded-[20px] border px-4 py-3 text-sm",
                          entry.role === "assistant"
                            ? "border-cyan-400/20 bg-cyan-400/8 text-slate-100"
                            : entry.role === "user"
                              ? "border-white/10 bg-white/[0.03] text-slate-200"
                              : "border-amber-400/20 bg-amber-400/10 text-amber-100"
                        )}
                      >
                        <div className="mb-2 flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.18em]">
                          <span>{entry.author}</span>
                          <span className="text-slate-500">{new Date(entry.createdAt).toLocaleTimeString()}</span>
                        </div>
                        <p className="whitespace-pre-wrap leading-6">{entry.text}</p>
                      </div>
                    ))}

                    {plan.advisorNotes.length > 0 ? (
                      <div className="rounded-[20px] border border-white/10 bg-white/[0.02] p-4">
                        <div className="flex items-center gap-2">
                          <Bot className="h-4 w-4 text-cyan-300" />
                          <p className="text-sm font-medium text-white">Advisor board</p>
                        </div>
                        <div className="mt-3 grid gap-3">
                          {plan.advisorNotes.map((note) => (
                            <div key={note.id} className="rounded-[16px] border border-white/10 bg-slate-950/55 p-3">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-medium text-white">{note.advisorName}</p>
                                  <p className="mt-1 text-xs leading-5 text-slate-400">{note.summary}</p>
                                </div>
                                <Badge variant="muted">{note.advisorId}</Badge>
                              </div>
                              {note.recommendations.length > 0 ? (
                                <div className="mt-3">
                                  <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Recommendations</p>
                                  <div className="mt-2 space-y-2">
                                    {note.recommendations.map((recommendation) => (
                                      <p key={recommendation} className="text-xs leading-5 text-slate-300">
                                        {recommendation}
                                      </p>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                              {note.concerns.length > 0 ? (
                                <div className="mt-3">
                                  <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Concerns</p>
                                  <div className="mt-2 space-y-2">
                                    {note.concerns.map((concern) => (
                                      <p key={concern} className="text-xs leading-5 text-amber-100">
                                        {concern}
                                      </p>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="border-t border-white/10 px-4 py-4">
                    <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-3">
                      <Textarea
                        value={message}
                        onChange={(event) => setMessage(event.target.value)}
                        onKeyDown={(event) => {
                          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                            event.preventDefault();
                            void submitTurn();
                          }
                        }}
                        placeholder="Tell the architect what to refine next..."
                        className="min-h-[88px] border-0 bg-transparent px-0 py-0 text-sm text-white placeholder:text-slate-500 focus-visible:ring-0"
                      />
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <p className="text-xs text-slate-500">Cmd/Ctrl + Enter to send.</p>
                        <Button size="sm" onClick={() => void submitTurn()} disabled={!message.trim() || isSending}>
                          {isSending ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <MessageSquare className="mr-2 h-4 w-4" />}
                          Send
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="min-h-0 min-w-0 bg-[rgba(6,10,16,0.78)] lg:col-start-2 lg:border-t lg:border-white/10 xl:col-start-auto xl:border-t-0">
                <div className="flex h-full min-h-0 flex-col">
                  <div className="border-b border-white/10 px-4 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Blueprint</p>
                        <p className="mt-1 text-sm text-slate-300">Edit one planning surface at a time instead of one long form.</p>
                      </div>
                      <Badge variant={getPlannerSectionHealth(plan, activeSection).variant}>{getPlannerSectionHealth(plan, activeSection).label}</Badge>
                    </div>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
                      {plannerSections.map((section) => {
                        const Icon = section.icon;
                        const health = getPlannerSectionHealth(plan, section.id);
                        const isActive = activeSection === section.id;

                        return (
                          <button
                            key={section.id}
                            type="button"
                            onClick={() => setActiveSection(section.id)}
                            className={cn(
                              "flex min-w-0 items-start gap-3 rounded-[18px] border px-3 py-3 text-left transition-colors",
                              isActive
                                ? "border-cyan-400/30 bg-cyan-400/10"
                                : "border-white/10 bg-white/[0.02] hover:bg-white/[0.05]"
                            )}
                          >
                            <span
                              className={cn(
                                "mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full border",
                                isActive
                                  ? "border-cyan-300/40 bg-cyan-300/15 text-cyan-100"
                                  : "border-white/10 bg-white/[0.03] text-slate-300"
                              )}
                            >
                              <Icon className="h-4 w-4" />
                            </span>
                            <div>
                              <p className="text-sm font-medium text-white">{section.label}</p>
                              <p className="mt-1 text-[11px] leading-5 text-slate-400">{health.label}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-4 grid gap-2 sm:grid-cols-3">
                      <CompactMetric
                        label="Channels"
                        value={String(plan.operations.channels.filter((channel) => channel.enabled).length)}
                      />
                      <CompactMetric
                        label="Warnings"
                        value={String(plan.deploy.warnings.length)}
                        tone={plan.deploy.warnings.length > 0 ? "warning" : "success"}
                      />
                      <CompactMetric
                        label="Kickoff"
                        value={String(plan.deploy.firstMissions.length)}
                      />
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                    {activeSection === "company" ? (
                      <SectionCard
                        icon={Building2}
                        title="Company"
                        description="Define the mission, customer, and commercial posture."
                      >
                        <FieldGrid>
                          <Field>
                            <Label>Company name</Label>
                            <Input
                              value={plan.company.name}
                              onChange={(event) =>
                                updatePlan((current) => {
                                  current.company.name = event.target.value;
                                  if (!current.workspace.name) {
                                    current.workspace.name = event.target.value;
                                  }
                                  return current;
                                })
                              }
                              placeholder="Company name"
                            />
                          </Field>
                          <Field>
                            <Label>Company type</Label>
                            <select
                              value={plan.company.type}
                              onChange={(event) =>
                                updatePlan((current) => {
                                  current.company.type = event.target.value as WorkspacePlan["company"]["type"];
                                  return current;
                                })
                              }
                              className={selectClassName}
                            >
                              <option value="saas">SaaS</option>
                              <option value="agency">Agency</option>
                              <option value="research-lab">Research lab</option>
                              <option value="content-brand">Content brand</option>
                              <option value="internal-ops">Internal ops</option>
                              <option value="custom">Custom</option>
                            </select>
                          </Field>
                        </FieldGrid>
                        <Field>
                          <Label>Mission</Label>
                          <Textarea
                            value={plan.company.mission}
                            onChange={(event) =>
                              updatePlan((current) => {
                                current.company.mission = event.target.value;
                                return current;
                              })
                            }
                            placeholder="What is this company trying to achieve?"
                          />
                        </Field>
                        <Field>
                          <Label>Target customer</Label>
                          <Input
                            value={plan.company.targetCustomer}
                            onChange={(event) =>
                              updatePlan((current) => {
                                current.company.targetCustomer = event.target.value;
                                return current;
                              })
                            }
                            placeholder="Who is this for first?"
                          />
                        </Field>
                        <FieldGrid>
                          <Field>
                            <Label>Constraints</Label>
                            <Textarea
                              value={plan.company.constraints.join("\n")}
                              onChange={(event) =>
                                updatePlan((current) => {
                                  current.company.constraints = splitTextList(event.target.value);
                                  return current;
                                })
                              }
                              placeholder="Budget, deadlines, compliance, preferred tools..."
                            />
                          </Field>
                          <Field>
                            <Label>Success signals</Label>
                            <Textarea
                              value={plan.company.successSignals.join("\n")}
                              onChange={(event) =>
                                updatePlan((current) => {
                                  current.company.successSignals = splitTextList(event.target.value);
                                  return current;
                                })
                              }
                              placeholder="Weekly revenue, active users, shipped milestones..."
                            />
                          </Field>
                        </FieldGrid>
                      </SectionCard>
                    ) : null}

                    {activeSection === "product" ? (
                      <SectionCard
                        icon={BriefcaseBusiness}
                        title="Product"
                        description="Lock the offer, V1 scope, and launch priorities."
                      >
                        <Field>
                          <Label>Offer</Label>
                          <Textarea
                            value={plan.product.offer}
                            onChange={(event) =>
                              updatePlan((current) => {
                                current.product.offer = event.target.value;
                                return current;
                              })
                            }
                            placeholder="What is the concrete product or service offer?"
                          />
                        </Field>
                        <FieldGrid>
                          <Field>
                            <Label>Revenue model</Label>
                            <Input
                              value={plan.product.revenueModel}
                              onChange={(event) =>
                                updatePlan((current) => {
                                  current.product.revenueModel = event.target.value;
                                  return current;
                                })
                              }
                              placeholder="Subscription, services, license..."
                            />
                          </Field>
                          <Field>
                            <Label>Launch priority</Label>
                            <Textarea
                              value={plan.product.launchPriority.join("\n")}
                              onChange={(event) =>
                                updatePlan((current) => {
                                  current.product.launchPriority = splitTextList(event.target.value);
                                  return current;
                                })
                              }
                              placeholder="Most important launch bets in order..."
                            />
                          </Field>
                        </FieldGrid>
                        <FieldGrid>
                          <Field>
                            <Label>V1 scope</Label>
                            <Textarea
                              value={plan.product.scopeV1.join("\n")}
                              onChange={(event) =>
                                updatePlan((current) => {
                                  current.product.scopeV1 = splitTextList(event.target.value);
                                  return current;
                                })
                              }
                              placeholder="Constrained V1 features..."
                            />
                          </Field>
                          <Field>
                            <Label>Non-goals</Label>
                            <Textarea
                              value={plan.product.nonGoals.join("\n")}
                              onChange={(event) =>
                                updatePlan((current) => {
                                  current.product.nonGoals = splitTextList(event.target.value);
                                  return current;
                                })
                              }
                              placeholder="What is explicitly out of scope?"
                            />
                          </Field>
                        </FieldGrid>
                      </SectionCard>
                    ) : null}

                    {activeSection === "workspace" ? (
                      <SectionCard
                        icon={Boxes}
                        title="Workspace"
                        description="Define the target folder, source mode, template, and scaffold rules."
                      >
                        <FieldGrid>
                          <Field>
                            <Label>Workspace name</Label>
                            <Input
                              value={plan.workspace.name}
                              onChange={(event) =>
                                updatePlan((current) => {
                                  current.workspace.name = event.target.value;
                                  if (!current.company.name) {
                                    current.company.name = event.target.value;
                                  }
                                  return current;
                                })
                              }
                              placeholder="Workspace name"
                            />
                          </Field>
                          <Field>
                            <Label>Template</Label>
                            <select
                              value={plan.workspace.template}
                              onChange={(event) =>
                                setPlan((current) =>
                                  current ? applyPlannerTemplate(current, event.target.value as WorkspaceTemplate) : current
                                )
                              }
                              className={selectClassName}
                            >
                              {workspaceTemplateOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </Field>
                        </FieldGrid>
                        <FieldGrid>
                          <Field>
                            <Label>Source mode</Label>
                            <select
                              value={plan.workspace.sourceMode}
                              onChange={(event) =>
                                updatePlan((current) => {
                                  current.workspace.sourceMode = event.target.value as WorkspacePlan["workspace"]["sourceMode"];
                                  return current;
                                })
                              }
                              className={selectClassName}
                            >
                              {sourceModeOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field>
                            <Label>Model profile</Label>
                            <select
                              value={plan.workspace.modelProfile}
                              onChange={(event) =>
                                updatePlan((current) => {
                                  current.workspace.modelProfile = event.target.value as WorkspacePlan["workspace"]["modelProfile"];
                                  return current;
                                })
                              }
                              className={selectClassName}
                            >
                              {modelProfileOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </Field>
                        </FieldGrid>
                        <Field>
                          <Label>
                            {plan.workspace.sourceMode === "clone"
                              ? "Repository URL"
                              : plan.workspace.sourceMode === "existing"
                                ? "Existing folder path"
                                : "Target directory (optional)"}
                          </Label>
                          <Input
                            value={
                              plan.workspace.sourceMode === "clone"
                                ? plan.workspace.repoUrl ?? ""
                                : plan.workspace.sourceMode === "existing"
                                  ? plan.workspace.existingPath ?? ""
                                  : plan.workspace.directory ?? ""
                            }
                            onChange={(event) =>
                              updatePlan((current) => {
                                if (current.workspace.sourceMode === "clone") {
                                  current.workspace.repoUrl = event.target.value;
                                } else if (current.workspace.sourceMode === "existing") {
                                  current.workspace.existingPath = event.target.value;
                                } else {
                                  current.workspace.directory = event.target.value;
                                }
                                return current;
                              })
                            }
                            placeholder={
                              plan.workspace.sourceMode === "clone"
                                ? "https://github.com/org/repo"
                                : plan.workspace.sourceMode === "existing"
                                  ? "/absolute/path/to/folder"
                                  : "Optional custom directory"
                            }
                          />
                        </Field>
                        <Field>
                          <Label>Stack decisions</Label>
                          <Textarea
                            value={plan.workspace.stackDecisions.join("\n")}
                            onChange={(event) =>
                              updatePlan((current) => {
                                current.workspace.stackDecisions = splitTextList(event.target.value);
                                return current;
                              })
                            }
                            placeholder="Frameworks, services, runtime, database, deployment..."
                          />
                        </Field>
                        <Field>
                          <Label>Scaffold rules</Label>
                          <div className="grid gap-2 sm:grid-cols-2">
                            <ToggleChip
                              checked={plan.workspace.rules.workspaceOnly}
                              label="Workspace-only"
                              onChange={() =>
                                updatePlan((current) => {
                                  current.workspace.rules.workspaceOnly = !current.workspace.rules.workspaceOnly;
                                  current.operations.sandbox.workspaceOnly = current.workspace.rules.workspaceOnly;
                                  return current;
                                })
                              }
                            />
                            <ToggleChip
                              checked={plan.workspace.rules.generateStarterDocs}
                              label="Starter docs"
                              onChange={() =>
                                updatePlan((current) => {
                                  current.workspace.rules.generateStarterDocs = !current.workspace.rules.generateStarterDocs;
                                  return current;
                                })
                              }
                            />
                            <ToggleChip
                              checked={plan.workspace.rules.generateMemory}
                              label="Memory system"
                              onChange={() =>
                                updatePlan((current) => {
                                  current.workspace.rules.generateMemory = !current.workspace.rules.generateMemory;
                                  return current;
                                })
                              }
                            />
                            <ToggleChip
                              checked={plan.workspace.rules.kickoffMission}
                              label="Kickoff mission"
                              onChange={() =>
                                updatePlan((current) => {
                                  current.workspace.rules.kickoffMission = !current.workspace.rules.kickoffMission;
                                  return current;
                                })
                              }
                            />
                          </div>
                        </Field>
                      </SectionCard>
                    ) : null}

                    {activeSection === "team" ? (
                      <SectionCard
                        icon={Bot}
                        title="Persistent agents"
                        description="This is the deploy-time team. Planner subagents can still run in parallel on top."
                        actions={
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() =>
                              updatePlan((current) => {
                                current.team.persistentAgents.push(
                                  createPlannerAgentSpec({
                                    name: "New agent",
                                    role: "Specialist"
                                  })
                                );
                                return current;
                              })
                            }
                          >
                            <Plus className="mr-2 h-4 w-4" />
                            Add agent
                          </Button>
                        }
                      >
                        <FieldGrid>
                          <Field>
                            <Label>Parallel run limit</Label>
                            <Input
                              type="number"
                              min={1}
                              max={12}
                              value={String(plan.team.maxParallelRuns)}
                              onChange={(event) =>
                                updatePlan((current) => {
                                  current.team.maxParallelRuns = Number(event.target.value) || 1;
                                  return current;
                                })
                              }
                            />
                          </Field>
                          <Field>
                            <Label>Ephemeral subagents</Label>
                            <ToggleChip
                              checked={plan.team.allowEphemeralSubagents}
                              label={plan.team.allowEphemeralSubagents ? "Enabled" : "Disabled"}
                              onChange={() =>
                                updatePlan((current) => {
                                  current.team.allowEphemeralSubagents = !current.team.allowEphemeralSubagents;
                                  return current;
                                })
                              }
                            />
                          </Field>
                        </FieldGrid>
                        <Field>
                          <Label>Escalation rules</Label>
                          <Textarea
                            value={plan.team.escalationRules.join("\n")}
                            onChange={(event) =>
                              updatePlan((current) => {
                                current.team.escalationRules = splitTextList(event.target.value);
                                return current;
                              })
                            }
                          />
                        </Field>
                        <div className="space-y-3">
                          {plan.team.persistentAgents.map((agent, index) => (
                            <AgentEditor
                              key={agent.id}
                              agent={agent}
                              models={snapshot.models.map((model) => model.id)}
                              onChange={(nextAgent) =>
                                updatePlan((current) => {
                                  current.team.persistentAgents[index] = nextAgent;
                                  if (nextAgent.isPrimary) {
                                    current.team.persistentAgents = current.team.persistentAgents.map((entry, entryIndex) => ({
                                      ...entry,
                                      isPrimary: entryIndex === index
                                    }));
                                  }
                                  return current;
                                })
                              }
                              onRemove={() =>
                                updatePlan((current) => {
                                  current.team.persistentAgents.splice(index, 1);
                                  return current;
                                })
                              }
                            />
                          ))}
                        </div>
                      </SectionCard>
                    ) : null}

                    {activeSection === "operations" ? (
                      <div className="space-y-4">
                        <SectionCard
                          icon={Workflow}
                          title="Workflows"
                          description="These are the handoff loops the company will run after deploy."
                          actions={
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() =>
                                updatePlan((current) => {
                                  current.operations.workflows.push(
                                    createPlannerWorkflowSpec({
                                      name: "New workflow",
                                      ownerAgentId: enabledAgentOptions[0]?.value
                                    })
                                  );
                                  return current;
                                })
                              }
                            >
                              <Plus className="mr-2 h-4 w-4" />
                              Add workflow
                            </Button>
                          }
                        >
                          <div className="space-y-3">
                            {plan.operations.workflows.map((workflow, index) => (
                              <WorkflowEditor
                                key={workflow.id}
                                workflow={workflow}
                                agents={enabledAgentOptions}
                                channelOptions={plan.operations.channels.map((channel) => ({
                                  label: channel.name,
                                  value: channel.id
                                }))}
                                onChange={(nextWorkflow) =>
                                  updatePlan((current) => {
                                    current.operations.workflows[index] = nextWorkflow;
                                    return current;
                                  })
                                }
                                onRemove={() =>
                                  updatePlan((current) => {
                                    current.operations.workflows.splice(index, 1);
                                    return current;
                                  })
                                }
                              />
                            ))}
                          </div>
                        </SectionCard>

                        <SectionCard
                          icon={Target}
                          title="Channels and automations"
                          description="Provision chat channels if you have credentials now, and wire recurring operations."
                        >
                          <div className="space-y-5">
                            <div>
                              <div className="mb-3 flex items-center justify-between gap-3">
                                <p className="text-sm font-medium text-white">Channels</p>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() =>
                                    updatePlan((current) => {
                                      current.operations.channels.push(createPlannerChannelSpec("slack"));
                                      return current;
                                    })
                                  }
                                >
                                  <Plus className="mr-2 h-4 w-4" />
                                  Add channel
                                </Button>
                              </div>
                              <div className="space-y-3">
                                {plan.operations.channels.map((channel, index) => (
                                  <ChannelEditor
                                    key={channel.id}
                                    channel={channel}
                                    onChange={(nextChannel) =>
                                      updatePlan((current) => {
                                        current.operations.channels[index] = nextChannel;
                                        return current;
                                      })
                                    }
                                    onRemove={() =>
                                      updatePlan((current) => {
                                        current.operations.channels.splice(index, 1);
                                        current.operations.automations = current.operations.automations.map((automation) =>
                                          automation.channelId === channel.id
                                            ? {
                                                ...automation,
                                                channelId: undefined,
                                                announce: false
                                              }
                                            : automation
                                        );
                                        return current;
                                      })
                                    }
                                  />
                                ))}
                              </div>
                            </div>

                            <div>
                              <div className="mb-3 flex items-center justify-between gap-3">
                                <p className="text-sm font-medium text-white">Automations</p>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() =>
                                    updatePlan((current) => {
                                      current.operations.automations.push(
                                        createPlannerAutomationSpec({
                                          name: "New automation",
                                          agentId: enabledAgentOptions[0]?.value
                                        })
                                      );
                                      return current;
                                    })
                                  }
                                >
                                  <Plus className="mr-2 h-4 w-4" />
                                  Add automation
                                </Button>
                              </div>
                              <div className="space-y-3">
                                {plan.operations.automations.map((automation, index) => (
                                  <AutomationEditor
                                    key={automation.id}
                                    automation={automation}
                                    agents={enabledAgentOptions}
                                    channelOptions={plan.operations.channels
                                      .filter((channel) => channel.type !== "internal")
                                      .map((channel) => ({
                                        label: channel.name,
                                        value: channel.id
                                      }))}
                                    onChange={(nextAutomation) =>
                                      updatePlan((current) => {
                                        current.operations.automations[index] = nextAutomation;
                                        return current;
                                      })
                                    }
                                    onRemove={() =>
                                      updatePlan((current) => {
                                        current.operations.automations.splice(index, 1);
                                        return current;
                                      })
                                    }
                                  />
                                ))}
                              </div>
                            </div>
                          </div>
                        </SectionCard>

                        <SectionCard
                          icon={Target}
                          title="Hooks and sandbox"
                          description="Set the runtime guardrails before deploy."
                          actions={
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() =>
                                updatePlan((current) => {
                                  current.operations.hooks.push(createPlannerHookSpec());
                                  return current;
                                })
                              }
                            >
                              <Plus className="mr-2 h-4 w-4" />
                              Add hook
                            </Button>
                          }
                        >
                          <FieldGrid>
                            <Field>
                              <Label>Sandbox mode</Label>
                              <select
                                value={plan.operations.sandbox.mode}
                                onChange={(event) =>
                                  updatePlan((current) => {
                                    current.operations.sandbox.mode = event.target.value as WorkspacePlan["operations"]["sandbox"]["mode"];
                                    return current;
                                  })
                                }
                                className={selectClassName}
                              >
                                <option value="default">Default</option>
                                <option value="strict">Strict</option>
                                <option value="extended">Extended</option>
                              </select>
                            </Field>
                            <Field>
                              <Label>Workspace-only FS</Label>
                              <ToggleChip
                                checked={plan.operations.sandbox.workspaceOnly}
                                label={plan.operations.sandbox.workspaceOnly ? "Enabled" : "Disabled"}
                                onChange={() =>
                                  updatePlan((current) => {
                                    current.operations.sandbox.workspaceOnly = !current.operations.sandbox.workspaceOnly;
                                    current.workspace.rules.workspaceOnly = current.operations.sandbox.workspaceOnly;
                                    return current;
                                  })
                                }
                              />
                            </Field>
                          </FieldGrid>
                          <Field>
                            <Label>Sandbox notes</Label>
                            <Textarea
                              value={plan.operations.sandbox.notes.join("\n")}
                              onChange={(event) =>
                                updatePlan((current) => {
                                  current.operations.sandbox.notes = splitTextList(event.target.value);
                                  return current;
                                })
                              }
                            />
                          </Field>
                          <div className="space-y-3">
                            {plan.operations.hooks.map((hook, index) => (
                              <div key={hook.id} className="rounded-[18px] border border-white/10 bg-white/[0.03] p-4">
                                <div className="flex items-center justify-between gap-3">
                                  <p className="text-sm font-medium text-white">{hook.name || "Hook"}</p>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      updatePlan((current) => {
                                        current.operations.hooks.splice(index, 1);
                                        return current;
                                      })
                                    }
                                    className="text-slate-400 transition-colors hover:text-rose-200"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </div>
                                <FieldGrid className="mt-3">
                                  <Field>
                                    <Label>Name</Label>
                                    <Input
                                      value={hook.name}
                                      onChange={(event) =>
                                        updatePlan((current) => {
                                          current.operations.hooks[index].name = event.target.value;
                                          return current;
                                        })
                                      }
                                    />
                                  </Field>
                                  <Field>
                                    <Label>Source</Label>
                                    <Input
                                      value={hook.source}
                                      onChange={(event) =>
                                        updatePlan((current) => {
                                          current.operations.hooks[index].source = event.target.value;
                                          return current;
                                        })
                                      }
                                      placeholder="workspace manifest, npm pack, local path..."
                                    />
                                  </Field>
                                </FieldGrid>
                                <Field className="mt-3">
                                  <Label>Notes</Label>
                                  <Textarea
                                    value={hook.notes}
                                    onChange={(event) =>
                                      updatePlan((current) => {
                                        current.operations.hooks[index].notes = event.target.value;
                                        return current;
                                      })
                                    }
                                  />
                                </Field>
                              </div>
                            ))}
                          </div>
                        </SectionCard>
                      </div>
                    ) : null}

                    {activeSection === "deploy" ? (
                      <SectionCard
                        icon={Rocket}
                        title="Deploy posture"
                        description="Review blockers, warnings, and the kickoff batch before you launch."
                      >
                        <div className="grid gap-3 lg:grid-cols-2">
                          <ReadinessList title="Blockers" items={plan.deploy.blockers} tone="danger" emptyLabel="No hard blockers remain." />
                          <ReadinessList title="Warnings" items={plan.deploy.warnings} tone="warning" emptyLabel="No warnings detected." />
                        </div>
                        <Field className="mt-4">
                          <Label>Kickoff missions</Label>
                          <Textarea
                            value={plan.deploy.firstMissions.join("\n")}
                            onChange={(event) =>
                              updatePlan((current) => {
                                current.deploy.firstMissions = splitTextList(event.target.value);
                                return current;
                              })
                            }
                          />
                        </Field>
                        {plan.deploy.workspacePath ? (
                          <div className="mt-4 rounded-[18px] border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm text-emerald-50">
                            <p className="font-medium">Last deploy</p>
                            <p className="mt-1 break-all text-emerald-100">{plan.deploy.workspacePath}</p>
                            {plan.deploy.lastDeployedAt ? (
                              <p className="mt-2 text-xs text-emerald-100/80">
                                {new Date(plan.deploy.lastDeployedAt).toLocaleString()}
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                      </SectionCard>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StageRail({
  plan,
  activeSection,
  onSectionChange,
  className
}: {
  plan: WorkspacePlan;
  activeSection: PlannerSectionId;
  onSectionChange: (section: PlannerSectionId) => void;
  className?: string;
}) {
  return (
    <div className={cn("px-3 py-4", className)}>
      <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Planner flow</p>
      <div className="mt-3 space-y-2">
        {plannerStages.map((stage, index) => {
          const currentIndex = plannerStages.findIndex((entry) => entry.id === plan.stage);
          const active = stage.id === plan.stage;
          const completed = currentIndex > index;
          const sectionActive = activeSection === stage.section;

          return (
            <button
              key={stage.id}
              type="button"
              onClick={() => onSectionChange(stage.section)}
              className={cn(
                "w-full rounded-[16px] border px-3 py-3 text-left transition-colors",
                active
                  ? "border-cyan-400/30 bg-cyan-400/10"
                  : completed
                    ? "border-white/10 bg-white/[0.04]"
                    : sectionActive
                      ? "border-white/15 bg-white/[0.05]"
                      : "border-white/5 bg-transparent hover:bg-white/[0.03]"
              )}
            >
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "inline-flex h-7 w-7 items-center justify-center rounded-full border text-xs",
                    active
                      ? "border-cyan-300/40 bg-cyan-300/15 text-cyan-50"
                      : completed
                        ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
                        : "border-white/10 bg-white/[0.03] text-slate-400"
                  )}
                >
                  {completed ? <Check className="h-3.5 w-3.5" /> : index + 1}
                </span>
                <div>
                  <p className="text-sm font-medium text-white">{stage.label}</p>
                  <p className="text-xs text-slate-500">{stage.id}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <div className="mt-4 rounded-[18px] border border-white/10 bg-white/[0.03] p-4">
        <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Snapshot</p>
        <div className="mt-3 space-y-2 text-sm text-slate-300">
          <p>{plan.team.persistentAgents.filter((agent) => agent.enabled).length} active agents</p>
          <p>{plan.operations.workflows.filter((workflow) => workflow.enabled).length} workflows</p>
          <p>{plan.operations.automations.filter((automation) => automation.enabled).length} automations</p>
          <p>{plan.operations.channels.filter((channel) => channel.enabled).length} channels</p>
        </div>
      </div>
    </div>
  );
}

function CompactMetric({
  label,
  value,
  tone = "muted"
}: {
  label: string;
  value: string;
  tone?: "muted" | "success" | "warning" | "danger";
}) {
  return (
    <div
      className={cn(
        "rounded-[16px] border px-3 py-3",
        tone === "success"
          ? "border-emerald-400/25 bg-emerald-400/10"
          : tone === "warning"
            ? "border-amber-400/25 bg-amber-400/10"
            : tone === "danger"
              ? "border-rose-400/25 bg-rose-400/10"
              : "border-white/10 bg-white/[0.03]"
      )}
    >
      <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-medium text-white">{value}</p>
    </div>
  );
}

function PromptFirstPlannerIntake({
  size,
  value,
  isSending,
  sendStatus,
  onChange,
  onSelectSize,
  onSubmit
}: {
  size: PlannerWorkspaceSize;
  value: string;
  isSending: boolean;
  sendStatus: PlannerBusyStatus | null;
  onChange: (value: string) => void;
  onSelectSize: (size: PlannerWorkspaceSize) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto px-4 py-3 sm:px-6 sm:py-4">
      <div className="w-full max-w-2xl">
        <div className="rounded-[22px] border border-white/10 bg-[rgba(8,12,18,0.78)] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.24)] backdrop-blur-sm md:p-5">
          <Badge
            variant="muted"
            className="border-white/8 bg-white/[0.04] px-2 py-0 text-[10px] tracking-[0.18em] text-slate-300"
          >
            Workspace Assistant
          </Badge>
          <h2 className="mt-3 text-[1.45rem] font-medium tracking-[-0.03em] text-white md:text-[1.8rem]">
            Start the workspace conversation.
          </h2>
          <p className="mt-2 max-w-xl text-[13px] leading-5 text-slate-300 md:text-sm">
            Share the goal in plain language. Add a website, repo, or folder if it helps. The architect will gather
            context and draft the workspace with minimal back-and-forth.
          </p>

          <div className="mt-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Workspace size</p>
              <p className="text-[11px] text-slate-400">Full context is always harvested.</p>
            </div>
            <div className="mt-2.5 grid gap-2 sm:grid-cols-3">
              {workspaceSizeOptions.map((option) => {
                const profile = getPlannerWorkspaceSizeProfile(option.value);

                return (
                  <WorkspaceSizeCard
                    key={option.value}
                    label={option.label}
                    description={option.description}
                    metrics={[
                      `${profile.agentCount} agent${profile.agentCount === 1 ? "" : "s"}`,
                      `${profile.workflowCount} task${profile.workflowCount === 1 ? "" : "s"}`,
                      profile.automationCount > 0 ? `${profile.automationCount} automation${profile.automationCount === 1 ? "" : "s"}` : "No automation",
                      profile.externalChannelCount > 0 ? `${profile.externalChannelCount} channel` : "Internal only"
                    ]}
                    selected={size === option.value}
                    onSelect={() => onSelectSize(option.value)}
                  />
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
              <span>Goal in plain language</span>
              <span>Website, repo, docs, or folder path</span>
              <span>New workspace, clone, or existing folder</span>
            </div>
          </div>

          <div className="mt-4 rounded-[18px] border border-white/10 bg-slate-950/45 p-3 md:p-3.5">
            <Textarea
              autoFocus
              value={value}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  onSubmit();
                }
              }}
              placeholder="Example: key2web3.com topluluğu için ilk olarak Telegram grubunu otonom yöneten bir workspace kur. Siteden context topla, ekip ve iş akışlarını öner, şimdilik sıfırdan başlayacağız."
              className="min-h-[104px] max-h-[24vh] border-0 bg-transparent px-0 py-0 text-sm leading-6 text-white placeholder:text-slate-500 focus-visible:ring-0 md:text-[15px]"
            />
            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-500">Cmd/Ctrl + Enter to start planning.</p>
              <Button size="sm" onClick={onSubmit} disabled={!value.trim() || isSending}>
                {isSending ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                Start planning
              </Button>
            </div>
            {sendStatus ? <PlannerBusyNotice className="mt-3" status={sendStatus} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function GuidedPlannerWorkspace({
  plan,
  message,
  isSending,
  sendStatus,
  messageListRef,
  onChangeMessage,
  onSubmit,
  onToggleAutopilot,
  onOpenAdvanced,
  onRequestReview,
  canRequestReview,
  onOpenSection
}: {
  plan: WorkspacePlan;
  message: string;
  isSending: boolean;
  sendStatus: PlannerBusyStatus | null;
  messageListRef: RefObject<HTMLDivElement | null>;
  onChangeMessage: (value: string) => void;
  onSubmit: () => void;
  onToggleAutopilot: () => void;
  onOpenAdvanced: () => void;
  onRequestReview: () => void;
  canRequestReview: boolean;
  onOpenSection: (section: PlannerSectionId) => void;
}) {
  const progressItems = buildGuidedProgressItems(plan);
  const overviewItems = buildGuidedOverviewItems(plan);
  const sizeProfile = getPlannerWorkspaceSizeProfile(plan.intake.size);
  const visibleSuggestions = plan.intake.suggestedReplies.slice(0, sizeProfile.suggestedReplyLimit);
  const compactContextView = plan.intake.size === "small";

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[auto,minmax(0,1fr),auto] xl:grid-cols-[188px,minmax(0,1fr),280px] xl:grid-rows-1">
      <aside className="border-b border-white/10 bg-[rgba(6,10,16,0.82)] px-3 py-3 xl:min-h-0 xl:border-b-0 xl:border-r">
        <div className="rounded-[18px] border border-white/10 bg-white/[0.02] p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">Flow</p>
            <button
              type="button"
              onClick={onToggleAutopilot}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.16em] transition-colors",
                plan.autopilot
                  ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-100"
                  : "border-white/10 bg-white/[0.03] text-slate-400"
              )}
            >
              <Check className={cn("h-3 w-3", !plan.autopilot && "opacity-0")} />
              Auto
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {progressItems.map((item) => (
              <div
                key={item.label}
                className={cn(
                  "flex items-start gap-2.5 rounded-[14px] border px-2.5 py-2.5",
                  item.tone === "success"
                    ? "border-emerald-400/20 bg-emerald-400/10"
                    : item.tone === "warning"
                      ? "border-amber-400/20 bg-amber-400/10"
                      : "border-white/10 bg-white/[0.03]"
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium",
                    item.tone === "success"
                      ? "border-emerald-300/30 bg-emerald-300/15 text-emerald-100"
                      : item.tone === "warning"
                        ? "border-amber-300/30 bg-amber-300/15 text-amber-100"
                        : "border-cyan-300/30 bg-cyan-300/12 text-cyan-100"
                  )}
                >
                  {item.value}
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-medium leading-5 text-white">{item.label}</p>
                  <p className="mt-0.5 text-[11px] leading-[18px] text-slate-400">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </aside>

      <div className="min-h-0 min-w-0 border-b border-white/10 bg-[rgba(7,11,18,0.55)] xl:border-b-0 xl:border-r">
        <div className="flex h-full min-h-0 flex-col">
          <div ref={messageListRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
            {plan.conversation.map((entry) => {
              const assistantBubble = entry.role !== "user";

              return (
                <div
                  key={entry.id}
                  className={cn(
                    "flex gap-3",
                    assistantBubble ? "items-start justify-start" : "justify-end"
                  )}
                >
                  {assistantBubble ? (
                    <span className="mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-cyan-300/35 bg-cyan-300/10 text-cyan-100">
                      <Bot className="h-4 w-4" />
                    </span>
                  ) : null}
                  <div
                    className={cn(
                      "max-w-[84%] rounded-[18px] border px-3.5 py-3 text-sm shadow-[0_20px_60px_-48px_rgba(8,145,178,0.45)]",
                      assistantBubble
                        ? "border-white/10 bg-[linear-gradient(180deg,rgba(23,33,54,0.92),rgba(14,21,37,0.92))] text-slate-100"
                        : "border-cyan-400/25 bg-[linear-gradient(180deg,rgba(15,120,153,0.9),rgba(10,87,118,0.9))] text-white"
                    )}
                  >
                    <div className="mb-1.5 flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.16em]">
                      <span>{entry.author}</span>
                      <span className={assistantBubble ? "text-slate-500" : "text-cyan-50/70"}>
                        {new Date(entry.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap leading-6">{entry.text}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="border-t border-white/10 px-3 py-3 sm:px-4">
            {visibleSuggestions.length > 0 ? (
              <div className="mb-2.5 flex flex-wrap gap-1.5">
                {visibleSuggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => onChangeMessage(suggestion)}
                    className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-slate-300 transition-colors hover:bg-white/[0.06]"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            ) : null}
            {sendStatus ? <PlannerBusyNotice className="mb-2.5" status={sendStatus} /> : null}
            <div className="flex items-end gap-2 rounded-[20px] border border-white/10 bg-white/[0.03] p-2.5">
              <Textarea
                value={message}
                onChange={(event) => onChangeMessage(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    onSubmit();
                  }
                }}
                placeholder="Type your message..."
                className="min-h-[56px] flex-1 border-0 bg-transparent px-1 py-1 text-sm text-white placeholder:text-slate-500 focus-visible:ring-0"
              />
              <div className="flex shrink-0 items-center gap-2">
                <span className="hidden text-[11px] text-slate-500 lg:inline">Cmd/Ctrl + Enter</span>
                <Button size="sm" className="h-10 rounded-full px-4" onClick={onSubmit} disabled={!message.trim() || isSending}>
                  {isSending ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <MessageSquare className="mr-2 h-4 w-4" />}
                  Send
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <aside className="min-h-0 min-w-0 overflow-y-auto bg-[rgba(6,10,16,0.82)] px-3 py-3">
        <div className="rounded-[18px] border border-white/10 bg-white/[0.02] p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">Overview</p>
            <Badge variant="muted">{sizeProfile.label} mode</Badge>
          </div>
          <div className="mt-3 rounded-[14px] border border-white/10 bg-slate-950/35 px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Draft target</p>
            <p className="mt-1 text-[12px] leading-5 text-slate-300">{buildGuidedModeDescription(plan)}</p>
          </div>
          <div className="mt-3 space-y-2">
            {overviewItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpenSection(item.id)}
                className="flex w-full items-start gap-2.5 rounded-[16px] border border-white/10 bg-[linear-gradient(180deg,rgba(15,22,37,0.92),rgba(10,16,28,0.92))] px-3 py-3 text-left transition-colors hover:border-cyan-400/25 hover:bg-[linear-gradient(180deg,rgba(19,30,49,0.96),rgba(11,18,31,0.96))]"
              >
                <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-slate-200">
                  <item.icon className="h-[18px] w-[18px]" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[13px] font-medium text-white">{item.label}</p>
                      <p className="mt-0.5 text-[12px] leading-5 text-slate-300">{item.summary}</p>
                    </div>
                    <Badge variant={item.variant}>{item.badge}</Badge>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {plan.intake.sources.length > 0 ? (
            <div className="mt-3 rounded-[16px] border border-white/10 bg-slate-950/35 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Context</p>
                <Badge variant="muted">{plan.intake.sources.length}</Badge>
              </div>
              {compactContextView ? (
                <p className="mt-2 text-[12px] leading-5 text-slate-300">
                  {plan.intake.sources[0]?.label
                    ? `${plan.intake.sources[0].label}${plan.intake.sources.length > 1 ? ` + ${plan.intake.sources.length - 1} more sources` : ""}`
                    : "Linked sources are feeding the blueprint."}
                </p>
              ) : (
                <div className="mt-2.5 space-y-2">
                  {plan.intake.sources.map((source) => (
                    <div key={source.id} className="rounded-[12px] border border-white/8 bg-white/[0.02] px-2.5 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-[12px] font-medium text-white">{source.label}</p>
                        <Badge variant={source.status === "error" ? "warning" : "muted"}>{source.kind}</Badge>
                      </div>
                      <p className="mt-1 text-[11px] leading-[18px] text-slate-400">{source.summary}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          <div className="mt-3 grid gap-2">
            <Button variant="secondary" size="sm" onClick={onOpenAdvanced}>
              Open advanced editor
            </Button>
            <Button size="sm" onClick={onRequestReview} disabled={!canRequestReview}>
              Review deploy readiness
            </Button>
          </div>
        </div>
      </aside>
    </div>
  );
}

function WorkspaceSizeCard({
  label,
  description,
  metrics,
  selected,
  onSelect
}: {
  label: string;
  description: string;
  metrics: string[];
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "rounded-[16px] border px-3 py-3 text-left transition-colors",
        selected
          ? "border-cyan-400/30 bg-cyan-400/10"
          : "border-white/8 bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]"
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-white">{label}</p>
        {selected ? <Badge variant="muted">Selected</Badge> : null}
      </div>
      <p className="mt-2 text-[12px] leading-5 text-slate-300">{description}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {metrics.map((metric) => (
          <span
            key={metric}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em]",
              selected
                ? "border-cyan-300/25 bg-cyan-300/10 text-cyan-100"
                : "border-white/10 bg-white/[0.03] text-slate-400"
            )}
          >
            {metric}
          </span>
        ))}
      </div>
    </button>
  );
}

function PlannerBusyNotice({
  status,
  className
}: {
  status: PlannerBusyStatus;
  className?: string;
}) {
  return (
    <div className={cn("rounded-[16px] border border-cyan-400/20 bg-cyan-400/10 px-3 py-2.5", className)}>
      <div className="flex items-start gap-2.5">
        <LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-cyan-200" />
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-cyan-100">{status.title}</p>
          <p className="mt-1 text-[12px] leading-5 text-cyan-50/85">{status.description}</p>
        </div>
      </div>
    </div>
  );
}

function getPlannerBusyStatus({
  initialTurn,
  step,
  active
}: {
  initialTurn: boolean;
  step: number;
  active: boolean;
}): PlannerBusyStatus | null {
  if (!active) {
    return null;
  }

  if (initialTurn) {
    if (step >= 2) {
      return {
        title: "Still working",
        description:
          "The first turn is the slowest. The planner is usually inspecting links and provisioning the hidden architect runtime."
      };
    }

    if (step >= 1) {
      return {
        title: "Collecting context",
        description:
          "The architect is reading the prompt, inspecting websites or repos, and drafting the first workspace blueprint."
      };
    }

    return {
      title: "Starting planner",
      description: "The architect is opening the planning session and preparing the first draft."
    };
  }

  if (step >= 2) {
    return {
      title: "Still working",
      description: "The architect is waiting on the planner runtime. This can happen when linked context or advisor runs take longer."
    };
  }

  if (step >= 1) {
    return {
      title: "Updating draft",
      description: "Refreshing context, specialist notes, and the current workspace plan."
    };
  }

  return {
    title: "Architect thinking",
    description: "Applying your latest direction to the workspace draft."
  };
}

function AgentEditor({
  agent,
  models,
  onChange,
  onRemove
}: {
  agent: PlannerPersistentAgentSpec;
  models: string[];
  onChange: (agent: PlannerPersistentAgentSpec) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ToggleChip checked={agent.enabled} label={agent.enabled ? "Enabled" : "Disabled"} onChange={() => onChange({ ...agent, enabled: !agent.enabled })} />
          {agent.isPrimary ? <Badge variant="success">Primary</Badge> : null}
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="text-slate-400 transition-colors hover:text-rose-200"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <FieldGrid className="mt-3">
        <Field>
          <Label>Name</Label>
          <Input value={agent.name} onChange={(event) => onChange({ ...agent, name: event.target.value })} />
        </Field>
        <Field>
          <Label>Role</Label>
          <Input value={agent.role} onChange={(event) => onChange({ ...agent, role: event.target.value })} />
        </Field>
      </FieldGrid>
      <FieldGrid className="mt-3">
        <Field>
          <Label>Preset</Label>
          <select
            value={agent.policy.preset}
            onChange={(event) =>
              onChange({
                ...agent,
                policy: resolveAgentPolicy(event.target.value as PlannerPersistentAgentSpec["policy"]["preset"])
              })
            }
            className={selectClassName}
          >
            {AGENT_PRESET_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Field>
          <Label>Model</Label>
          <select
            value={agent.modelId ?? ""}
            onChange={(event) => onChange({ ...agent, modelId: event.target.value || undefined })}
            className={selectClassName}
          >
            <option value="">OpenClaw default</option>
            {models.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </Field>
      </FieldGrid>
      <Field className="mt-3">
        <Label>Purpose</Label>
        <Textarea value={agent.purpose} onChange={(event) => onChange({ ...agent, purpose: event.target.value })} />
      </Field>
      <FieldGrid className="mt-3">
        <Field>
          <Label>Responsibilities</Label>
          <Textarea
            value={agent.responsibilities.join("\n")}
            onChange={(event) =>
              onChange({
                ...agent,
                responsibilities: splitTextList(event.target.value)
              })
            }
          />
        </Field>
        <Field>
          <Label>Outputs</Label>
          <Textarea
            value={agent.outputs.join("\n")}
            onChange={(event) =>
              onChange({
                ...agent,
                outputs: splitTextList(event.target.value)
              })
            }
          />
        </Field>
      </FieldGrid>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant={agent.isPrimary ? "default" : "secondary"} size="sm" onClick={() => onChange({ ...agent, isPrimary: true, enabled: true })}>
          Mark primary
        </Button>
        <ToggleChip
          checked={agent.heartbeat.enabled}
          label={agent.heartbeat.enabled ? "Heartbeat on" : "Heartbeat off"}
          onChange={() =>
            onChange({
              ...agent,
              heartbeat: {
                ...agent.heartbeat,
                enabled: !agent.heartbeat.enabled
              }
            })
          }
        />
      </div>
    </div>
  );
}

function WorkflowEditor({
  workflow,
  agents,
  channelOptions,
  onChange,
  onRemove
}: {
  workflow: WorkspacePlan["operations"]["workflows"][number];
  agents: Array<{ label: string; value: string }>;
  channelOptions: Array<{ label: string; value: string }>;
  onChange: (workflow: WorkspacePlan["operations"]["workflows"][number]) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ToggleChip checked={workflow.enabled} label={workflow.enabled ? "Enabled" : "Disabled"} onChange={() => onChange({ ...workflow, enabled: !workflow.enabled })} />
          <Badge variant="muted">{workflow.trigger}</Badge>
        </div>
        <button type="button" onClick={onRemove} className="text-slate-400 transition-colors hover:text-rose-200">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <FieldGrid className="mt-3">
        <Field>
          <Label>Name</Label>
          <Input value={workflow.name} onChange={(event) => onChange({ ...workflow, name: event.target.value })} />
        </Field>
        <Field>
          <Label>Trigger</Label>
          <select
            value={workflow.trigger}
            onChange={(event) => onChange({ ...workflow, trigger: event.target.value as WorkspacePlan["operations"]["workflows"][number]["trigger"] })}
            className={selectClassName}
          >
            <option value="manual">Manual</option>
            <option value="event">Event</option>
            <option value="cron">Cron</option>
            <option value="launch">Launch</option>
          </select>
        </Field>
      </FieldGrid>
      <Field className="mt-3">
        <Label>Goal</Label>
        <Textarea value={workflow.goal} onChange={(event) => onChange({ ...workflow, goal: event.target.value })} />
      </Field>
      <FieldGrid className="mt-3">
        <Field>
          <Label>Owner agent</Label>
          <select
            value={workflow.ownerAgentId ?? ""}
            onChange={(event) => onChange({ ...workflow, ownerAgentId: event.target.value || undefined })}
            className={selectClassName}
          >
            <option value="">Unassigned</option>
            {agents.map((agent) => (
              <option key={agent.value} value={agent.value}>
                {agent.label}
              </option>
            ))}
          </select>
        </Field>
        <Field>
          <Label>Collaborators</Label>
          <Textarea
            value={workflow.collaboratorAgentIds.join("\n")}
            onChange={(event) => onChange({ ...workflow, collaboratorAgentIds: splitTextList(event.target.value) })}
            placeholder="Agent ids, one per line"
          />
        </Field>
      </FieldGrid>
      <FieldGrid className="mt-3">
        <Field>
          <Label>Success definition</Label>
          <Textarea
            value={workflow.successDefinition}
            onChange={(event) => onChange({ ...workflow, successDefinition: event.target.value })}
          />
        </Field>
        <Field>
          <Label>Outputs</Label>
          <Textarea
            value={workflow.outputs.join("\n")}
            onChange={(event) => onChange({ ...workflow, outputs: splitTextList(event.target.value) })}
          />
        </Field>
      </FieldGrid>
      <Field className="mt-3">
        <Label>Channel targets</Label>
        <Textarea
          value={workflow.channelIds.join("\n")}
          onChange={(event) => onChange({ ...workflow, channelIds: splitTextList(event.target.value) })}
          placeholder={
            channelOptions.length > 0
              ? `Known channels: ${channelOptions.map((channel) => channel.value).join(", ")}`
              : "Channel ids, one per line"
          }
        />
      </Field>
    </div>
  );
}

function ChannelEditor({
  channel,
  onChange,
  onRemove
}: {
  channel: WorkspacePlan["operations"]["channels"][number];
  onChange: (channel: WorkspacePlan["operations"]["channels"][number]) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ToggleChip checked={channel.enabled} label={channel.enabled ? "Enabled" : "Disabled"} onChange={() => onChange({ ...channel, enabled: !channel.enabled })} />
          {channel.requiresCredentials ? <Badge variant="warning">Credentials required</Badge> : <Badge variant="muted">Manifest only</Badge>}
        </div>
        <button type="button" onClick={onRemove} className="text-slate-400 transition-colors hover:text-rose-200">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <FieldGrid className="mt-3">
        <Field>
          <Label>Type</Label>
          <select
            value={channel.type}
            onChange={(event) =>
              onChange(
                createPlannerChannelSpec(event.target.value as PlannerChannelType, {
                  id: channel.id,
                  name: channel.name,
                  purpose: channel.purpose,
                  target: channel.target,
                  enabled: channel.enabled,
                  announce: channel.announce
                })
              )
            }
            className={selectClassName}
          >
            {channelTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Field>
          <Label>Name</Label>
          <Input value={channel.name} onChange={(event) => onChange({ ...channel, name: event.target.value })} />
        </Field>
      </FieldGrid>
      <FieldGrid className="mt-3">
        <Field>
          <Label>Purpose</Label>
          <Input value={channel.purpose} onChange={(event) => onChange({ ...channel, purpose: event.target.value })} placeholder="Announcements, operator sync, launch alerts..." />
        </Field>
        <Field>
          <Label>Target</Label>
          <Input value={channel.target ?? ""} onChange={(event) => onChange({ ...channel, target: event.target.value })} placeholder="Channel name, chat id, or room id" />
        </Field>
      </FieldGrid>
      <div className="mt-3">
        <ToggleChip checked={channel.announce} label={channel.announce ? "Announce enabled" : "Announce off"} onChange={() => onChange({ ...channel, announce: !channel.announce })} />
      </div>
      {channel.credentials.length > 0 ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {channel.credentials.map((credential) => (
            <Field key={credential.key}>
              <Label>{credential.label}</Label>
              <Input
                type={credential.secret ? "password" : "text"}
                value={credential.value}
                onChange={(event) =>
                  onChange({
                    ...channel,
                    credentials: channel.credentials.map((entry) =>
                      entry.key === credential.key
                        ? {
                            ...entry,
                            value: event.target.value
                          }
                        : entry
                    )
                  })
                }
                placeholder={credential.placeholder}
              />
            </Field>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AutomationEditor({
  automation,
  agents,
  channelOptions,
  onChange,
  onRemove
}: {
  automation: PlannerAutomationSpec;
  agents: Array<{ label: string; value: string }>;
  channelOptions: Array<{ label: string; value: string }>;
  onChange: (automation: PlannerAutomationSpec) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ToggleChip checked={automation.enabled} label={automation.enabled ? "Enabled" : "Disabled"} onChange={() => onChange({ ...automation, enabled: !automation.enabled })} />
          <Badge variant="muted">{automation.scheduleKind}</Badge>
        </div>
        <button type="button" onClick={onRemove} className="text-slate-400 transition-colors hover:text-rose-200">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <FieldGrid className="mt-3">
        <Field>
          <Label>Name</Label>
          <Input value={automation.name} onChange={(event) => onChange({ ...automation, name: event.target.value })} />
        </Field>
        <Field>
          <Label>Agent</Label>
          <select
            value={automation.agentId ?? ""}
            onChange={(event) => onChange({ ...automation, agentId: event.target.value || undefined })}
            className={selectClassName}
          >
            <option value="">Unassigned</option>
            {agents.map((agent) => (
              <option key={agent.value} value={agent.value}>
                {agent.label}
              </option>
            ))}
          </select>
        </Field>
      </FieldGrid>
      <Field className="mt-3">
        <Label>Description</Label>
        <Input
          value={automation.description}
          onChange={(event) => onChange({ ...automation, description: event.target.value })}
          placeholder="What does this automation protect or maintain?"
        />
      </Field>
      <FieldGrid className="mt-3">
        <Field>
          <Label>Schedule type</Label>
          <select
            value={automation.scheduleKind}
            onChange={(event) =>
              onChange({
                ...automation,
                scheduleKind: event.target.value as PlannerAutomationSpec["scheduleKind"]
              })
            }
            className={selectClassName}
          >
            <option value="every">Every</option>
            <option value="cron">Cron</option>
          </select>
        </Field>
        <Field>
          <Label>Schedule</Label>
          <Input
            value={automation.scheduleValue}
            onChange={(event) => onChange({ ...automation, scheduleValue: event.target.value })}
            placeholder={automation.scheduleKind === "every" ? "24h" : "0 9 * * 1"}
          />
        </Field>
      </FieldGrid>
      <Field className="mt-3">
        <Label>Mission</Label>
        <Textarea
          value={automation.mission}
          onChange={(event) => onChange({ ...automation, mission: event.target.value })}
          placeholder="What should the automation ask the agent to do?"
        />
      </Field>
      <FieldGrid className="mt-3">
        <Field>
          <Label>Thinking</Label>
          <select
            value={automation.thinking}
            onChange={(event) =>
              onChange({
                ...automation,
                thinking: event.target.value as PlannerAutomationSpec["thinking"]
              })
            }
            className={selectClassName}
          >
            <option value="off">off</option>
            <option value="minimal">minimal</option>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </Field>
        <Field>
          <Label>Channel</Label>
          <select
            value={automation.channelId ?? ""}
            onChange={(event) => onChange({ ...automation, channelId: event.target.value || undefined })}
            className={selectClassName}
          >
            <option value="">No announce target</option>
            {channelOptions.map((channel) => (
              <option key={channel.value} value={channel.value}>
                {channel.label}
              </option>
            ))}
          </select>
        </Field>
      </FieldGrid>
      <div className="mt-3">
        <ToggleChip checked={automation.announce} label={automation.announce ? "Announce enabled" : "Announce off"} onChange={() => onChange({ ...automation, announce: !automation.announce })} />
      </div>
    </div>
  );
}

function SectionCard({
  icon: Icon,
  title,
  description,
  actions,
  children
}: {
  icon: typeof Building2;
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[22px] border border-white/10 bg-[rgba(11,16,24,0.72)] p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-cyan-200">
            <Icon className="h-[18px] w-[18px]" />
          </span>
          <div>
            <h3 className="text-base font-medium text-white">{title}</h3>
            <p className="mt-1 text-sm text-slate-400">{description}</p>
          </div>
        </div>
        {actions}
      </div>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function FieldGrid({
  className,
  children
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn("grid gap-3 lg:grid-cols-2", className)}>{children}</div>;
}

function Field({
  className,
  children
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn("space-y-2", className)}>{children}</div>;
}

function ToggleChip({
  checked,
  label,
  onChange
}: {
  checked: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors",
        checked
          ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-100"
          : "border-white/10 bg-white/[0.03] text-slate-300"
      )}
    >
      <span
        className={cn(
          "inline-flex h-4 w-4 items-center justify-center rounded border text-[10px]",
          checked
            ? "border-cyan-300/40 bg-cyan-300/15 text-cyan-50"
            : "border-white/10 bg-transparent text-transparent"
        )}
      >
        <Check className="h-3 w-3" />
      </span>
      {label}
    </button>
  );
}

function buildGuidedProgressItems(plan: WorkspacePlan): Array<{
  label: string;
  value: string;
  description: string;
  tone: "muted" | "success" | "warning";
}> {
  const sizeProfile = getPlannerWorkspaceSizeProfile(plan.intake.size);
  const enabledAgents = plan.team.persistentAgents.filter((agent) => agent.enabled).length;
  const enabledWorkflows = plan.operations.workflows.filter((workflow) => workflow.enabled).length;
  const enabledAutomations = plan.operations.automations.filter((automation) => automation.enabled).length;
  const configuredExternalChannels = plan.operations.channels.filter((channel) => channel.type !== "internal").length;
  const structureReady =
    enabledAgents >= sizeProfile.agentCount &&
    enabledWorkflows >= sizeProfile.workflowCount &&
    enabledAutomations >= sizeProfile.automationCount &&
    configuredExternalChannels >= sizeProfile.externalChannelCount;

  return [
    {
      label: "Mode",
      value: sizeProfile.label.charAt(0),
      description: buildGuidedModeDescription(plan),
      tone: "muted"
    },
    {
      label: "Decisions Pending",
      value: String(plan.intake.confirmations.length),
      description:
        plan.intake.confirmations[0] ?? "The architect has enough direction to move toward review.",
      tone: plan.intake.confirmations.length > 0 ? "warning" : "success"
    },
    {
      label: "Draft Structure",
      value: structureReady ? "OK" : String(enabledWorkflows),
      description: buildGuidedStructureDescription(plan),
      tone: structureReady ? "success" : "warning"
    },
    {
      label: "Context Harvested",
      value: String(plan.intake.sources.length),
      description:
        plan.intake.sources.length > 0
          ? "Linked context is already feeding the blueprint."
          : "Add a website, repo, or folder path to sharpen the draft.",
      tone: plan.intake.sources.length > 0 ? "success" : "muted"
    }
  ];
}

function buildGuidedOverviewItems(plan: WorkspacePlan): Array<{
  id: PlannerSectionId;
  label: string;
  summary: string;
  badge: string;
  variant: "muted" | "success" | "warning" | "danger";
  icon: typeof Building2;
}> {
  const visibleSectionIds = getGuidedVisibleSectionIds(plan.intake.size);

  return plannerSections.filter((section) => visibleSectionIds.includes(section.id)).map((section) => {
    const health = getPlannerSectionHealth(plan, section.id);

    return {
      id: section.id,
      label: section.label,
      summary: summarizeGuidedSection(plan, section.id),
      badge: summarizeGuidedSectionBadge(plan, section.id, health.label),
      variant: health.variant,
      icon: section.icon
    };
  });
}

function summarizeGuidedSection(plan: WorkspacePlan, sectionId: PlannerSectionId) {
  switch (sectionId) {
    case "company":
      return plan.company.name
        ? `${plan.company.name}${plan.company.mission ? ` · ${plan.company.mission}` : ""}`
        : "Mission and audience are still being shaped.";
    case "workspace":
      return `${humanizePlannerValue(plan.workspace.template)} · ${humanizePlannerValue(plan.workspace.sourceMode)}`;
    case "team":
      return `${plan.team.persistentAgents.filter((agent) => agent.enabled).length} agents drafted`;
    case "product":
      return plan.product.offer || "Offer and V1 scope are still being drafted.";
    case "operations":
      return `${plan.operations.workflows.filter((workflow) => workflow.enabled).length} tasks, ${plan.operations.automations.filter((automation) => automation.enabled).length} automations`;
    case "deploy":
    default:
      return plan.intake.reviewRequested ? "Deploy review is open." : "Review not started.";
  }
}

function summarizeGuidedSectionBadge(
  plan: WorkspacePlan,
  sectionId: PlannerSectionId,
  fallback: string
) {
  switch (sectionId) {
    case "team":
      return `${plan.team.persistentAgents.filter((agent) => agent.enabled).length} Agents`;
    case "operations":
      return `${plan.operations.workflows.filter((workflow) => workflow.enabled).length} Tasks`;
    case "deploy":
      return plan.intake.reviewRequested ? `${plan.deploy.blockers.length} Blockers` : "Review Pending";
    default:
      return fallback;
  }
}

function buildGuidedModeDescription(plan: WorkspacePlan) {
  const profile = getPlannerWorkspaceSizeProfile(plan.intake.size);

  return `${profile.agentCount} agent${profile.agentCount === 1 ? "" : "s"}, ${profile.workflowCount} task${profile.workflowCount === 1 ? "" : "s"}${
    profile.automationCount > 0 ? `, ${profile.automationCount} automation${profile.automationCount === 1 ? "" : "s"}` : ""
  }${profile.externalChannelCount > 0 ? `, ${profile.externalChannelCount} channel` : ""}.`;
}

function buildGuidedStructureDescription(plan: WorkspacePlan) {
  const profile = getPlannerWorkspaceSizeProfile(plan.intake.size);
  const parts = [
    `${plan.team.persistentAgents.filter((agent) => agent.enabled).length}/${profile.agentCount} agents`,
    `${plan.operations.workflows.filter((workflow) => workflow.enabled).length}/${profile.workflowCount} tasks`
  ];

  if (profile.automationCount > 0) {
    parts.push(
      `${plan.operations.automations.filter((automation) => automation.enabled).length}/${profile.automationCount} automations`
    );
  }

  if (profile.externalChannelCount > 0) {
    parts.push(
      `${plan.operations.channels.filter((channel) => channel.type !== "internal").length}/${profile.externalChannelCount} channels`
    );
  }

  return `${parts.join(" · ")} targeted for ${profile.label.toLowerCase()} mode.`;
}

function getGuidedVisibleSectionIds(size: PlannerWorkspaceSize): PlannerSectionId[] {
  switch (size) {
    case "small":
      return ["company", "workspace", "deploy"];
    case "medium":
      return ["company", "product", "workspace", "operations", "deploy"];
    case "large":
    default:
      return ["company", "product", "workspace", "team", "operations", "deploy"];
  }
}

function getPlannerSectionForStage(stage: WorkspacePlan["stage"]): PlannerSectionId {
  return plannerStages.find((entry) => entry.id === stage)?.section ?? "company";
}

function getPlannerSectionHealth(plan: WorkspacePlan, sectionId: PlannerSectionId): {
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
      if (plan.workspace.sourceMode === "clone" && !plan.workspace.repoUrl?.trim()) {
        missing += 1;
      }
      if (plan.workspace.sourceMode === "existing" && !plan.workspace.existingPath?.trim()) {
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

function ReadinessList({
  title,
  items,
  tone,
  emptyLabel
}: {
  title: string;
  items: string[];
  tone: "danger" | "warning";
  emptyLabel: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[20px] border p-4",
        tone === "danger"
          ? "border-rose-400/20 bg-rose-400/10"
          : "border-amber-400/20 bg-amber-400/10"
      )}
    >
      <p className="text-sm font-medium text-white">{title}</p>
      <div className="mt-3 space-y-2">
        {items.length > 0 ? (
          items.map((item) => (
            <p key={item} className="text-sm leading-6 text-slate-200">
              {item}
            </p>
          ))
        ) : (
          <p className="text-sm text-slate-300">{emptyLabel}</p>
        )}
      </div>
    </div>
  );
}

function splitTextList(value: string) {
  return Array.from(
    new Set(
      value
        .split(/\r?\n|,/g)
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  );
}

function humanizePlannerValue(value: string) {
  return value
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

const selectClassName =
  "flex h-11 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white outline-none";
