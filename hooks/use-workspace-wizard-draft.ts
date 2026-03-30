"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { toast } from "@/components/ui/sonner";
import { consumeNdjsonStream } from "@/lib/ndjson";
import {
  createPlannerMessage,
  enrichWorkspacePlan
} from "@/lib/openclaw/planner-core";
import {
  buildPlannerDeployProgressTemplate,
  buildWorkspaceCreateProgressTemplate,
  createPendingOperationProgressSnapshot
} from "@/lib/openclaw/operation-progress";
import type {
  OperationProgressSnapshot,
  WorkspaceEditSeed,
  WorkspaceCreateResult,
  WorkspaceCreateRules,
  WorkspaceCreateStreamEvent,
  WorkspacePlan,
  WorkspacePlanDeployResult,
  WorkspacePlanDeployStreamEvent
} from "@/lib/openclaw/types";
import {
  applyBasicInputToWorkspacePlan,
  appendBasicModeImportNote,
  buildWorkspaceCreateInputFromPlan,
  createWorkspaceWizardQuickCreateRules,
  extractBasicRulesFromWorkspacePlan,
  hasAdvancedWorkspaceDetails,
  inferWorkspaceWizardQuickSetupPreset,
  type WorkspaceWizardQuickSetupPreset
} from "@/lib/openclaw/workspace-wizard-mappers";
import { buildWorkspaceScaffoldDocuments } from "@/lib/openclaw/workspace-docs";
import {
  analyzeWorkspaceWizardSourceInput,
  createInitialWorkspaceWizardBasicDraft,
  extractBasicDraftFromWorkspacePlan,
  type WorkspaceWizardBasicDraft
} from "@/lib/openclaw/workspace-wizard-inference";

const plannerStorageKey = "mission-control-workspace-plan-id";

export type WorkspaceWizardMode = "basic" | "advanced";

type WorkspaceWizardNotice = {
  tone: "muted" | "warning";
  title: string;
  description: string;
};

type UseWorkspaceWizardDraftOptions = {
  open: boolean;
  initialMode: WorkspaceWizardMode;
  workspaceEditId?: string | null;
  onRefresh: () => Promise<void>;
  onWorkspaceCreated: (workspaceId: string) => void;
  onWorkspaceUpdated?: (workspaceId: string) => void;
};

export function useWorkspaceWizardDraft({
  open,
  initialMode,
  workspaceEditId,
  onRefresh,
  onWorkspaceCreated,
  onWorkspaceUpdated
}: UseWorkspaceWizardDraftOptions) {
  const [mode, setMode] = useState<WorkspaceWizardMode>(initialMode);
  const [plan, setPlan] = useState<WorkspacePlan | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [hasStoredDraft, setHasStoredDraft] = useState(false);
  const [basicDraft, setBasicDraft] = useState<WorkspaceWizardBasicDraft>(createInitialWorkspaceWizardBasicDraft);
  const [basicRules, setBasicRules] = useState<WorkspaceCreateRules>(() =>
    createWorkspaceWizardQuickCreateRules("fastest")
  );
  const [notice, setNotice] = useState<WorkspaceWizardNotice | null>(null);
  const [isPlanLoading, setIsPlanLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isDocumentRewriting, setIsDocumentRewriting] = useState(false);
  const [isApplyingWorkspaceChanges, setIsApplyingWorkspaceChanges] = useState(false);
  const [, setWorkspaceEditSeed] = useState<WorkspaceEditSeed | null>(null);
  const [deployProgress, setDeployProgress] = useState<OperationProgressSnapshot | null>(null);
  const [createProgress, setCreateProgress] = useState<OperationProgressSnapshot | null>(null);
  const [sendProgressStep, setSendProgressStep] = useState(0);
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(null);
  const planRequestRef = useRef<Promise<WorkspacePlan | null> | null>(null);
  const planRef = useRef<WorkspacePlan | null>(null);
  const workspaceEditSeedRef = useRef<WorkspaceEditSeed | null>(null);
  const storageKey = useMemo(
    () => (workspaceEditId ? `${plannerStorageKey}:${workspaceEditId}` : plannerStorageKey),
    [workspaceEditId]
  );

  const sourceAnalysis = useMemo(
    () => analyzeWorkspaceWizardSourceInput(basicDraft.source),
    [basicDraft.source]
  );
  const basicPreset = useMemo<WorkspaceWizardQuickSetupPreset>(
    () => inferWorkspaceWizardQuickSetupPreset(basicRules),
    [basicRules]
  );

  const architectBusyStatus = useMemo(
    () => getPlannerBusyStatus({
      initialTurn: !plan?.intake.started,
      step: isSending ? sendProgressStep : 0,
      active: isSending || isDocumentRewriting || isApplyingWorkspaceChanges
    }),
    [isApplyingWorkspaceChanges, isDocumentRewriting, isSending, plan?.intake.started, sendProgressStep]
  );

  const commitPlan = useCallback(
    (nextPlan: WorkspacePlan | null) => {
      planRef.current = nextPlan;
      setPlan(nextPlan);
      setHasStoredDraft(Boolean(nextPlan));

      if (!nextPlan) {
        setPlanId(null);
        return null;
      }

      setPlanId(nextPlan.id);
      setBasicDraft(extractBasicDraftFromWorkspacePlan(nextPlan));
      setBasicRules(extractBasicRulesFromWorkspacePlan(nextPlan));
      globalThis.localStorage?.setItem(storageKey, nextPlan.id);

      return nextPlan;
    },
    [storageKey]
  );

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
  }, [isSending]);

  const updatePlan = useCallback(
    (updater: (current: WorkspacePlan) => WorkspacePlan) => {
      if (!plan) {
        return null;
      }

      const nextPlan = enrichWorkspacePlan(updater(structuredClone(plan)));
      commitPlan(nextPlan);
      return nextPlan;
    },
    [commitPlan, plan]
  );

  const getStoredPlanId = useCallback(() => {
    return globalThis.localStorage?.getItem(storageKey) ?? null;
  }, [storageKey]);

  const clearStoredPlan = useCallback(() => {
    globalThis.localStorage?.removeItem(storageKey);
    setHasStoredDraft(false);
  }, [storageKey]);

  const requestPlanner = useCallback(
    async ({ resumeStored }: { resumeStored: boolean }) => {
      if (workspaceEditId) {
        const storedPlanId = resumeStored ? globalThis.localStorage?.getItem(storageKey) : null;

        if (storedPlanId) {
          const response = await fetch(`/api/planner/${storedPlanId}`, {
            cache: "no-store"
          });

          if (response.ok) {
            const result = (await response.json()) as { plan: WorkspacePlan };
            return result.plan;
          }
        }

        const response = await fetch(`/api/workspaces/${workspaceEditId}/edit-draft`, {
          method: "POST"
        });
        const result = (await response.json()) as {
          plan?: WorkspacePlan;
          seed?: WorkspaceEditSeed;
          error?: string;
        };

        if (!response.ok || !result.plan) {
          throw new Error(result.error || "Unable to create workspace edit draft.");
        }

        if (result.seed) {
          workspaceEditSeedRef.current = result.seed;
          setWorkspaceEditSeed(result.seed);
        }

        return result.plan;
      }

      const storedPlanId = resumeStored ? globalThis.localStorage?.getItem(storageKey) : null;

      if (storedPlanId) {
        const response = await fetch(`/api/planner/${storedPlanId}`, {
          cache: "no-store"
        });

        if (response.ok) {
          const result = (await response.json()) as { plan: WorkspacePlan };
          return result.plan;
        }
      }

      const response = await fetch("/api/planner", {
        method: "POST"
      });
      const result = (await response.json()) as { plan?: WorkspacePlan; error?: string };

      if (!response.ok || !result.plan) {
        throw new Error(result.error || "Unable to create planner workspace.");
      }

      return result.plan;
    },
    [storageKey, workspaceEditId]
  );

  const ensurePlan = useCallback(
    async ({
      resumeStored,
      draftOverride
    }: {
      resumeStored: boolean;
      draftOverride?: WorkspaceWizardBasicDraft;
    }) => {
      if (plan) {
        return plan;
      }

      if (planRequestRef.current) {
        return planRequestRef.current;
      }

      const request = (async () => {
        setIsPlanLoading(true);

        try {
          const fetchedPlan = await requestPlanner({ resumeStored });
          const draftToApply = draftOverride ?? basicDraft;
          const seededPlan =
            draftToApply.goal.trim() || draftToApply.source.trim() || draftToApply.name.trim()
              ? applyBasicInputToWorkspacePlan(fetchedPlan, draftToApply, basicRules)
              : fetchedPlan;

          return commitPlan(seededPlan);
        } catch (error) {
          toast.error("Workspace architect could not start.", {
            description: error instanceof Error ? error.message : "Unknown planner error."
          });
          return null;
        } finally {
          setIsPlanLoading(false);
          planRequestRef.current = null;
        }
      })();

      planRequestRef.current = request;
      return request;
    },
    [basicDraft, basicRules, commitPlan, plan, requestPlanner]
  );

  const startFreshDraft = useCallback(async () => {
    setNotice(null);
    setDeployProgress(null);
    setCreateProgress(null);
    setIsSending(false);
    setIsSaving(false);
    setIsSimulating(false);
    setIsDeploying(false);
    setIsCreating(false);
    setIsDocumentRewriting(false);
    setPendingUserMessage(null);
    planRequestRef.current = null;

    if (workspaceEditId) {
      clearStoredPlan();
      setPlan(null);
      planRef.current = null;
      setPlanId(null);
      const nextPlan = await ensurePlan({ resumeStored: false, draftOverride: undefined });

      if (nextPlan) {
        setMode("advanced");
      }

      return;
    }

    if (mode === "basic") {
      clearStoredPlan();
      setPlan(null);
      planRef.current = null;
      setPlanId(null);
      setBasicDraft(createInitialWorkspaceWizardBasicDraft());
      setBasicRules(createWorkspaceWizardQuickCreateRules("fastest"));
      return;
    }

    clearStoredPlan();
    setPlan(null);
    planRef.current = null;
    setPlanId(null);
    const blankDraft = createInitialWorkspaceWizardBasicDraft();
    setBasicDraft(blankDraft);
    setBasicRules(createWorkspaceWizardQuickCreateRules("fastest"));
    const nextPlan = await ensurePlan({ resumeStored: false, draftOverride: blankDraft });

    if (nextPlan) {
      setMode("advanced");
    }
  }, [clearStoredPlan, ensurePlan, mode, workspaceEditId]);

  const discardStoredDraft = useCallback(() => {
    clearStoredPlan();
    setNotice(null);
  }, [clearStoredPlan]);

  const savePlan = useCallback(
    async (planOverride?: WorkspacePlan) => {
      const activePlan = planOverride ?? planRef.current;

      if (!activePlan || !planId) {
        return false;
      }

      setIsSaving(true);

      try {
        const response = await fetch(`/api/planner/${planId}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            plan: activePlan
          })
        });
        const result = (await response.json()) as { plan?: WorkspacePlan; error?: string };

        if (!response.ok || !result.plan) {
          throw new Error(result.error || "Unable to save planner workspace.");
        }

        commitPlan(result.plan);
        toast.success("Planner draft saved.");
        return true;
      } catch (error) {
        toast.error("Planner draft could not be saved.", {
          description: error instanceof Error ? error.message : "Unknown planner save error."
        });
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [commitPlan, planId]
  );

  const simulatePlan = useCallback(async (planOverride?: WorkspacePlan) => {
    const activePlan = planOverride ?? planRef.current;

    if (!activePlan || !planId) {
      return false;
    }

    setIsSimulating(true);

    try {
      const response = await fetch(`/api/planner/${planId}/simulate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          plan: activePlan
        })
      });
      const result = (await response.json()) as { plan?: WorkspacePlan; error?: string };

      if (!response.ok || !result.plan) {
        throw new Error(result.error || "Unable to simulate planner team.");
      }

      commitPlan(result.plan);
      toast.success("Planner team simulated.");
      return true;
    } catch (error) {
      toast.error("Planner simulation failed.", {
        description: error instanceof Error ? error.message : "Unknown planner simulation error."
      });
      return false;
    } finally {
      setIsSimulating(false);
    }
  }, [commitPlan, planId]);

  const requestReview = useCallback(() => {
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
  }, [updatePlan]);

  const createWorkspace = useCallback(async () => {
    if (workspaceEditId) {
      return null;
    }

    const basePlan = (await ensurePlan({ resumeStored: false, draftOverride: basicDraft })) ?? planRef.current;

    if (!basePlan) {
      return null;
    }

    const ensuredPlan = applyBasicInputToWorkspacePlan(basePlan, basicDraft, basicRules);

    commitPlan(ensuredPlan);
    setIsCreating(true);

    const initialProgress = createPendingOperationProgressSnapshot(
      buildWorkspaceCreateProgressTemplate({
        sourceMode: ensuredPlan.workspace.sourceMode,
        agentCount: 1,
        kickoffMission: ensuredPlan.workspace.rules.kickoffMission ?? true
      })
    );

    setCreateProgress(initialProgress);

    try {
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ...buildWorkspaceCreateInputFromPlan(ensuredPlan),
          stream: true
        })
      });

      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(result?.error || "OpenClaw could not create the workspace.");
      }

      let createdResult: WorkspaceCreateResult | null = null;
      let createError: string | null = null;

      await consumeNdjsonStream<WorkspaceCreateStreamEvent>(response, async (event) => {
        if (event.type === "progress") {
          setCreateProgress(event.progress);
          return;
        }

        if (event.progress) {
          setCreateProgress(event.progress);
        }

        if (event.ok) {
          createdResult = event.result;
        } else {
          createError = event.error;
        }
      });

      if (createError || !createdResult) {
        throw new Error(createError || "OpenClaw could not create the workspace.");
      }

      const result = createdResult as WorkspaceCreateResult;
      clearStoredPlan();
      await onRefresh();
      onWorkspaceCreated(result.workspaceId);

      toast.success("Workspace created.", {
        description: `${result.agentIds.length} agent${result.agentIds.length === 1 ? "" : "s"} created at ${result.workspacePath}`
      });

      if (result.kickoffError) {
        toast.message("Workspace created, but kickoff needs attention.", {
          description: result.kickoffError
        });
      }

      return result;
    } catch (error) {
      toast.error("Workspace creation failed.", {
        description: error instanceof Error ? error.message : "Unknown workspace error."
      });
      return null;
    } finally {
      setIsCreating(false);
    }
  }, [basicDraft, basicRules, clearStoredPlan, commitPlan, ensurePlan, onRefresh, onWorkspaceCreated, workspaceEditId]);

  const applyWorkspaceChanges = useCallback(async () => {
    const activePlan = planRef.current;
    const activeBaseline = workspaceEditSeedRef.current;

    if (!activePlan || !workspaceEditId) {
      return null;
    }

    setIsApplyingWorkspaceChanges(true);

    try {
      const response = await fetch("/api/workspaces", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          workspaceId: workspaceEditId,
          name: activePlan.workspace.name,
          directory: activePlan.workspace.directory,
          plan: activePlan,
          baseline: activeBaseline
        })
      });

      const result = (await response.json()) as {
        workspaceId?: string;
        workspacePath?: string;
        error?: string;
      };

      if (!response.ok || result.error) {
        throw new Error(result.error || "OpenClaw could not update the workspace.");
      }

      clearStoredPlan();
      await onRefresh();
      onWorkspaceUpdated?.(result.workspaceId ?? workspaceEditId);

      toast.success("Workspace updated.", {
        description: result.workspacePath || activePlan.workspace.directory || activePlan.workspace.name
      });

      return result;
    } catch (error) {
      toast.error("Workspace update failed.", {
        description: error instanceof Error ? error.message : "Unknown workspace error."
      });
      return null;
    } finally {
      setIsApplyingWorkspaceChanges(false);
    }
  }, [clearStoredPlan, onRefresh, onWorkspaceUpdated, workspaceEditId]);

  const deployPlan = useCallback(async () => {
    const activePlan = planRef.current;

    if (!activePlan || !planId) {
      return null;
    }

    setIsDeploying(true);
    const initialProgress = createPendingOperationProgressSnapshot(
      buildPlannerDeployProgressTemplate({
        sourceMode: activePlan.workspace.sourceMode ?? "empty",
        agentCount: activePlan.team.persistentAgents.filter((agent) => agent.enabled).length,
        kickoffMission: activePlan.workspace.rules.kickoffMission ?? true,
        hasChannels: Boolean(
          activePlan.operations.channels.some((channel) => channel.enabled && channel.type !== "internal")
        ),
        hasAutomations: Boolean(
          activePlan.operations.automations.some((automation) => automation.enabled)
        ),
        hasPlannerKickoffs: Boolean(activePlan.deploy.firstMissions.some((mission) => mission.trim().length > 0))
      })
    );

    setDeployProgress(initialProgress);

    try {
      const response = await fetch(`/api/planner/${planId}/deploy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          plan: activePlan,
          stream: true
        })
      });

      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(result?.error || "Unable to deploy planner workspace.");
      }

      let deployResult: WorkspacePlanDeployResult | null = null;
      let deployError: string | null = null;

      await consumeNdjsonStream<WorkspacePlanDeployStreamEvent>(response, async (event) => {
        if (event.type === "progress") {
          setDeployProgress(event.progress);
          return;
        }

        if (event.progress) {
          setDeployProgress(event.progress);
        }

        if (event.ok) {
          deployResult = event.result;
        } else {
          deployError = event.error;
        }
      });

      if (deployError || !deployResult) {
        throw new Error(deployError || "Unable to deploy planner workspace.");
      }

      const result = deployResult as WorkspacePlanDeployResult;
      commitPlan(result.plan);
      clearStoredPlan();
      await onRefresh();
      onWorkspaceCreated(result.workspaceId);

      toast.success("Workspace deployed.", {
        description: result.workspacePath
      });

      return result;
    } catch (error) {
      toast.error("Planner deploy failed.", {
        description: error instanceof Error ? error.message : "Unknown deploy error."
      });
      return null;
    } finally {
      setIsDeploying(false);
    }
  }, [clearStoredPlan, commitPlan, onRefresh, onWorkspaceCreated, planId]);

  const submitArchitectTurn = useCallback(
    async (message: string) => {
      if (!message.trim()) {
        return false;
      }

      setIsSending(true);
      setPendingUserMessage(message.trim());

      try {
        const shouldResumeStoredPlan =
          initialMode === "advanced" &&
          !plan &&
          !basicDraft.goal.trim() &&
          !basicDraft.source.trim() &&
          !basicDraft.name.trim();
        const ensuredPlan =
          (await ensurePlan({
            resumeStored: shouldResumeStoredPlan,
            draftOverride: basicDraft
          })) ?? plan;

        if (!ensuredPlan) {
          return false;
        }

        const response = await fetch(`/api/planner/${ensuredPlan.id}/turn`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            message,
            plan: ensuredPlan
          })
        });
        const result = (await response.json()) as { plan?: WorkspacePlan; error?: string };

        if (!response.ok || !result.plan) {
          throw new Error(result.error || "Unable to process planner turn.");
        }

        commitPlan(result.plan);
        setNotice(null);
        return true;
      } catch (error) {
        toast.error("Planner turn failed.", {
          description: error instanceof Error ? error.message : "Unknown planner turn error."
        });
        return false;
      } finally {
        setPendingUserMessage(null);
        setIsSending(false);
      }
    },
    [basicDraft, commitPlan, ensurePlan, initialMode, plan]
  );

  const rewriteDocumentWithArchitect = useCallback(
    async ({
      path,
      currentContent,
      instruction
    }: {
      path: string;
      currentContent: string;
      instruction?: string;
    }): Promise<string | null> => {
      const activePlan = plan;

      if (!activePlan || !planId) {
        return null;
      }

      const trimmedPath = path.trim();
      if (!trimmedPath) {
        return null;
      }

      setIsDocumentRewriting(true);

      try {
        const response = await fetch(`/api/planner/${planId}/document-rewrite`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            plan: activePlan,
            path: trimmedPath,
            currentContent,
            instruction: instruction?.trim() || "Rewrite this document to improve clarity, usefulness, and consistency with the workspace context."
          })
        });
        const result = (await response.json()) as { plan?: WorkspacePlan; reply?: string; error?: string };

        if (!response.ok || !result.plan) {
          throw new Error(result.error || "Unable to rewrite the document.");
        }

        commitPlan(result.plan);
        setNotice(null);
        const rewrittenDocuments = buildWorkspaceScaffoldDocuments({
          name: result.plan.workspace.name || "Workspace",
          brief: result.plan.company.mission || result.plan.product.offer || undefined,
          template: result.plan.workspace.template,
          sourceMode: result.plan.workspace.sourceMode,
          rules: result.plan.workspace.rules,
          agents: result.plan.team.persistentAgents.filter((agent) => agent.enabled),
          docOverrides: result.plan.workspace.docOverrides,
          toolExamples: [],
          contextSources: result.plan.intake.sources
        });
        const rewrittenDocument = rewrittenDocuments.find((entry) => entry.path === trimmedPath);

        toast.success(`Architect rewrote ${trimmedPath}.`, {
          description: result.reply || "The document override has been updated."
        });
        return rewrittenDocument?.content ?? null;
      } catch (error) {
        toast.error("Document rewrite failed.", {
          description: error instanceof Error ? error.message : "Unknown document rewrite error."
        });
        return null;
      } finally {
        setIsDocumentRewriting(false);
      }
    },
    [commitPlan, plan, planId]
  );

  const resumeStoredDraft = useCallback(async () => {
    const storedPlanId = getStoredPlanId();

    if (!storedPlanId) {
      setHasStoredDraft(false);
      return false;
    }

    setIsPlanLoading(true);

    try {
      const response = await fetch(`/api/planner/${storedPlanId}`, {
        cache: "no-store"
      });
      const result = (await response.json()) as { plan?: WorkspacePlan; error?: string };

      if (!response.ok || !result.plan) {
        throw new Error(result.error || "Unable to load the stored planner draft.");
      }

      commitPlan(result.plan);
      setMode("advanced");
      setNotice({
        tone: "muted",
        title: workspaceEditId ? "Resumed workspace edit" : "Resumed previous draft",
        description: workspaceEditId
          ? "Architect restored your earlier edit session so you can keep shaping the same workspace."
          : "Architect restored your earlier blueprint so you can keep shaping the same workspace."
      });
      return true;
    } catch (error) {
      toast.error("Stored draft could not be resumed.", {
        description: error instanceof Error ? error.message : "Unknown planner error."
      });
      return false;
    } finally {
      setIsPlanLoading(false);
      planRequestRef.current = null;
    }
  }, [commitPlan, getStoredPlanId, workspaceEditId]);

  const switchMode = useCallback(
    async (nextMode: WorkspaceWizardMode) => {
      if (nextMode === mode) {
        return;
      }

      if (workspaceEditId) {
        if (nextMode === "basic") {
          return;
        }

        setMode("advanced");
        return;
      }

      if (nextMode === "advanced") {
        const ensuredPlan = await ensurePlan({ resumeStored: false, draftOverride: basicDraft });

        if (!ensuredPlan) {
          return;
        }

        const seededPlan = applyBasicInputToWorkspacePlan(ensuredPlan, basicDraft, basicRules);
        const shouldAppendImportNote =
          !seededPlan.intake.started &&
          seededPlan.conversation.filter((message) => message.role !== "system").length <= 1;
        const importedPlan = shouldAppendImportNote
          ? appendBasicModeImportNote(seededPlan, basicDraft)
          : seededPlan;

        commitPlan(importedPlan);
        setNotice(
          importedPlan.intake.started || basicDraft.goal.trim() || basicDraft.source.trim()
            ? {
                tone: "muted",
                title: "Same draft, deeper controls",
                description:
                  "Architect will keep extending the exact same conversation and blueprint as you move into Advanced."
              }
            : null
        );
        setMode("advanced");
        return;
      }

      if (plan) {
        setBasicDraft(extractBasicDraftFromWorkspacePlan(plan));
        setBasicRules(extractBasicRulesFromWorkspacePlan(plan));
        setNotice(
          hasAdvancedWorkspaceDetails(plan)
            ? {
                tone: "warning",
                title: "Advanced details preserved",
                description: "Basic mode will keep showing the fast path, but the richer blueprint remains in memory if you switch back."
              }
            : null
        );
      } else {
        setNotice(null);
      }

      setMode("basic");
    },
    [basicDraft, basicRules, commitPlan, ensurePlan, mode, plan, workspaceEditId]
  );

  const setBasicGoal = useCallback((goal: string) => {
    setBasicDraft((current) => {
      const nextDraft = {
        ...current,
        goal
      };

      if (mode === "basic") {
        setPlan((activePlan) => {
          const nextPlan = activePlan ? applyBasicInputToWorkspacePlan(activePlan, nextDraft, basicRules) : activePlan;
          planRef.current = nextPlan;
          return nextPlan;
        });
      }

      return nextDraft;
    });
  }, [basicRules, mode]);

  const setBasicSource = useCallback((source: string) => {
    setBasicDraft((current) => {
      const nextDraft = {
        ...current,
        source
      };

      if (mode === "basic") {
        setPlan((activePlan) => {
          const nextPlan = activePlan ? applyBasicInputToWorkspacePlan(activePlan, nextDraft, basicRules) : activePlan;
          planRef.current = nextPlan;
          return nextPlan;
        });
      }

      return nextDraft;
    });
  }, [basicRules, mode]);

  const setBasicName = useCallback((name: string) => {
    setBasicDraft((current) => {
      const nextDraft = {
        ...current,
        name
      };

      if (mode === "basic") {
        setPlan((activePlan) => {
          const nextPlan = activePlan ? applyBasicInputToWorkspacePlan(activePlan, nextDraft, basicRules) : activePlan;
          planRef.current = nextPlan;
          return nextPlan;
        });
      }

      return nextDraft;
    });
  }, [basicRules, mode]);

  const setBasicPreset = useCallback(
    (preset: WorkspaceWizardQuickSetupPreset) => {
      const nextRules = createWorkspaceWizardQuickCreateRules(preset);
      setBasicRules(nextRules);
      setPlan((activePlan) => {
        const nextPlan = activePlan ? applyBasicInputToWorkspacePlan(activePlan, basicDraft, nextRules) : activePlan;
        planRef.current = nextPlan;
        return nextPlan;
      });
    },
    [basicDraft]
  );

  const toggleBasicRule = useCallback(
    (rule: keyof Pick<WorkspaceCreateRules, "generateStarterDocs" | "generateMemory" | "kickoffMission">) => {
      setBasicRules((current) => {
        const nextRules = {
          ...current,
          [rule]: !current[rule],
          workspaceOnly: true
        };

        setPlan((activePlan) => {
          const nextPlan = activePlan ? applyBasicInputToWorkspacePlan(activePlan, basicDraft, nextRules) : activePlan;
          planRef.current = nextPlan;
          return nextPlan;
        });

        return nextRules;
      });
    },
    [basicDraft]
  );

  useEffect(() => {
    if (!open) {
      setMode(initialMode);
      setPlan(null);
      planRef.current = null;
      setPlanId(null);
      setHasStoredDraft(false);
      setBasicDraft(createInitialWorkspaceWizardBasicDraft());
      setBasicRules(createWorkspaceWizardQuickCreateRules("fastest"));
      setNotice(null);
      setCreateProgress(null);
      setDeployProgress(null);
      setIsDocumentRewriting(false);
      setIsApplyingWorkspaceChanges(false);
      setPendingUserMessage(null);
      setWorkspaceEditSeed(null);
      workspaceEditSeedRef.current = null;
      planRequestRef.current = null;
      return;
    }

    const storedPlanId = getStoredPlanId();

    setMode(workspaceEditId ? "advanced" : initialMode);
    setHasStoredDraft(!workspaceEditId && Boolean(storedPlanId));
    setBasicDraft(createInitialWorkspaceWizardBasicDraft());
    setBasicRules(createWorkspaceWizardQuickCreateRules("fastest"));
    setNotice(null);
    setCreateProgress(null);
    setDeployProgress(null);
    setIsDocumentRewriting(false);
    setIsApplyingWorkspaceChanges(false);
    setPendingUserMessage(null);
    setWorkspaceEditSeed(null);
    workspaceEditSeedRef.current = null;
    planRequestRef.current = null;

    if (!workspaceEditId && initialMode !== "advanced") {
      setPlan(null);
      planRef.current = null;
      setPlanId(null);
      return;
    }

    if (workspaceEditId || initialMode === "advanced") {
      const request = (async () => {
        setIsPlanLoading(true);

        try {
          const nextPlan = await requestPlanner({ resumeStored: !workspaceEditId });
          const committedPlan = commitPlan(nextPlan);

          if (!workspaceEditId && storedPlanId && committedPlan) {
            setNotice({
              tone: "muted",
              title: "Resumed previous draft",
              description: "Architect restored the last saved blueprint. Start a new draft if you want a clean slate."
            });
          }

          return committedPlan;
        } catch (error) {
          toast.error("Workspace architect could not start.", {
            description: error instanceof Error ? error.message : "Unknown planner error."
          });
          return null;
        } finally {
          setIsPlanLoading(false);
          planRequestRef.current = null;
        }
      })();

      planRequestRef.current = request;
      void request;
    } else {
      setPlan(null);
      planRef.current = null;
      setPlanId(null);
    }
  }, [commitPlan, getStoredPlanId, initialMode, open, requestPlanner, workspaceEditId]);

  return {
    mode,
    plan,
    planId,
    hasStoredDraft,
    notice,
    sourceAnalysis,
    basicDraft,
    basicRules,
    basicPreset,
    isPlanLoading,
    isSending,
    isSaving,
    isSimulating,
    isDeploying,
    isCreating,
    isApplyingWorkspaceChanges,
    isDocumentRewriting,
    createProgress,
    deployProgress,
    architectBusyStatus,
    pendingUserMessage,
    setBasicGoal,
    setBasicSource,
    setBasicName,
    setBasicPreset,
    toggleBasicRule,
    setNotice,
    updatePlan,
    switchMode,
    startFreshDraft,
    discardStoredDraft,
    resumeStoredDraft,
    savePlan,
    simulatePlan,
    requestReview,
    createWorkspace,
    deployPlan,
    applyWorkspaceChanges,
    submitArchitectTurn,
    rewriteDocumentWithArchitect
  };
}

function getPlannerBusyStatus({
  initialTurn,
  step,
  active
}: {
  initialTurn: boolean;
  step: number;
  active: boolean;
}) {
  if (!active) {
    return null;
  }

  if (initialTurn) {
    if (step >= 2) {
      return {
        title: "Still working",
        description:
          "The first turn is the slowest. The planner is usually inspecting links, extracting intent, and narrowing the plan."
      };
    }

    if (step >= 1) {
      return {
        title: "Collecting context",
        description:
          "The architect is reading the prompt, extracting intent, and drafting the next clarifying question."
      };
    }

    return {
      title: "Starting planner",
      description: "The architect is opening the planning session and preparing the first intent pass."
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
