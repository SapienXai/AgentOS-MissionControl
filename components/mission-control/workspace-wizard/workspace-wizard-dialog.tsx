"use client";

import { Bot, Check, ChevronRight, Columns2, FolderOpen, GitBranch, Globe, LoaderCircle, Sparkles, X, Zap } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { OperationProgress } from "@/components/mission-control/operation-progress";
import {
  WorkspaceWizardBlueprintEditor,
  type WorkspaceBlueprintEditorFocus
} from "@/components/mission-control/workspace-wizard/workspace-wizard-blueprint-editor";
import {
  WorkspaceWizardDocumentEditor
} from "@/components/mission-control/workspace-wizard/workspace-wizard-document-editor";
import { WorkspaceWizardDraftPane } from "@/components/mission-control/workspace-wizard/workspace-wizard-draft-pane";
import { WorkspaceWizardHeader } from "@/components/mission-control/workspace-wizard/workspace-wizard-header";
import { WizardComposer } from "@/components/mission-control/workspace-wizard/wizard-composer";
import {
  type WizardMessageRecord,
  WizardMessageList
} from "@/components/mission-control/workspace-wizard/wizard-message-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspaceWizardDraft, type WorkspaceWizardMode } from "@/hooks/use-workspace-wizard-draft";
import { createPlannerMessage } from "@/lib/openclaw/planner-core";
import {
  getPlannerStageLabel
} from "@/lib/openclaw/planner-presenters";
import type {
  MissionControlSnapshot,
  WorkspaceCreateRules,
  WorkspaceModelProfile,
  WorkspacePlan,
  WorkspaceTeamPreset,
  WorkspaceTemplate
} from "@/lib/agentos/contracts";
import { type WorkspaceWizardQuickSetupPreset } from "@/lib/openclaw/workspace-wizard-mappers";
import {
  WORKSPACE_MODEL_PROFILE_OPTIONS,
  WORKSPACE_TEAM_PRESET_OPTIONS,
  WORKSPACE_TEMPLATE_OPTIONS,
  getWorkspaceTemplateMeta
} from "@/lib/openclaw/workspace-presets";
import {
  buildWorkspaceWizardPathPreview,
  resolveWorkspaceWizardName
} from "@/lib/openclaw/workspace-wizard-inference";
import type { WorkspaceWizardSourceAnalysis } from "@/lib/openclaw/workspace-wizard-inference";
import { cn } from "@/lib/utils";

type SurfaceTheme = "dark" | "light";
type WorkspaceCreateStep = "intake" | "shape" | "review";

type WorkspaceWizardDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMode?: WorkspaceWizardMode;
  workspaceEditId?: string | null;
  surfaceTheme: SurfaceTheme;
  snapshot: MissionControlSnapshot;
  onRefresh: () => Promise<void>;
  onWorkspaceCreated: (workspaceId: string) => void;
  onWorkspaceUpdated?: (workspaceId: string) => void;
};

export function WorkspaceWizardDialog({
  open,
  onOpenChange,
  initialMode = "basic",
  workspaceEditId = null,
  surfaceTheme,
  snapshot,
  onRefresh,
  onWorkspaceCreated,
  onWorkspaceUpdated
}: WorkspaceWizardDialogProps) {
  const isEditingWorkspace = Boolean(workspaceEditId);
  const wizard = useWorkspaceWizardDraft({
    open,
    initialMode,
    workspaceEditId,
    onRefresh,
    onWorkspaceCreated,
    onWorkspaceUpdated
  });

  const [composerValue, setComposerValue] = useState("");
  const [isMobileBlueprintOpen, setIsMobileBlueprintOpen] = useState(false);
  const [isBlueprintEditorOpen, setIsBlueprintEditorOpen] = useState(false);
  const [isDocumentEditorOpen, setIsDocumentEditorOpen] = useState(false);
  const [basicStep, setBasicStep] = useState<WorkspaceCreateStep>("intake");
  const [blueprintEditorFocus, setBlueprintEditorFocus] = useState<WorkspaceBlueprintEditorFocus>("workspace.name");
  const [documentEditorPath, setDocumentEditorPath] = useState("AGENTS.md");
  const isLight = surfaceTheme === "light";
  const editingWorkspace = isEditingWorkspace
    ? snapshot.workspaces.find((workspace) => workspace.id === workspaceEditId) ?? null
    : null;

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setComposerValue("");
      setIsMobileBlueprintOpen(false);
      setIsBlueprintEditorOpen(false);
      setIsDocumentEditorOpen(false);
      setBasicStep("intake");
      setBlueprintEditorFocus("workspace.name");
      setDocumentEditorPath("AGENTS.md");
    }

    onOpenChange(nextOpen);
  };

  const resolvedName = isEditingWorkspace
    ? wizard.plan?.workspace.name ?? editingWorkspace?.name ?? resolveWorkspaceWizardName(wizard.basicDraft)
    : resolveWorkspaceWizardName(wizard.basicDraft);
  const resolvedTemplate = isEditingWorkspace
    ? wizard.plan?.workspace.template ?? editingWorkspace?.bootstrap.template ?? wizard.basicTemplate
    : wizard.plan?.workspace.template ?? wizard.basicTemplate;
  const workspacePath = isEditingWorkspace
    ? wizard.plan?.workspace.directory ?? editingWorkspace?.path ?? snapshot.diagnostics.workspaceRoot
    : buildWorkspaceWizardPathPreview(
        snapshot.diagnostics.workspaceRoot,
        wizard.basicDraft,
        wizard.sourceAnalysis
      );

  const headerBadges = useMemo(
    () => buildHeaderBadges(wizard.mode, wizard.plan, isEditingWorkspace, basicStep),
    [basicStep, isEditingWorkspace, wizard.mode, wizard.plan]
  );

  const activeMessages = useMemo<WizardMessageRecord[]>(
    () => buildConversationMessages(wizard.plan, wizard.pendingUserMessage),
    [wizard.pendingUserMessage, wizard.plan]
  );
  const architectMessageId = useMemo(() => {
    for (let index = activeMessages.length - 1; index >= 0; index -= 1) {
      const message = activeMessages[index];

      if (message.role === "assistant" && message.author === "Architect") {
        return message.id;
      }
    }

    return null;
  }, [activeMessages]);

  const activeProgress = wizard.isCreating ? wizard.createProgress : wizard.isDeploying ? wizard.deployProgress : null;
  const isArchitectBusy =
    wizard.isSending ||
    wizard.isPlanLoading ||
    wizard.isDeploying ||
    wizard.isCreating ||
    wizard.isDocumentRewriting ||
    wizard.isApplyingWorkspaceChanges;
  const showResumeBanner = wizard.mode === "basic" && wizard.hasStoredDraft && !wizard.plan && !wizard.isPlanLoading;
  const hasPrimaryActionDraft = isEditingWorkspace
    ? Boolean(wizard.plan || composerValue.trim())
    : Boolean(wizard.plan?.intake.started || wizard.basicDraft.goal.trim() || composerValue.trim());
  const hasDraftToCreate = Boolean(
    wizard.plan?.intake.started ||
      wizard.basicDraft.name.trim() ||
      wizard.basicDraft.goal.trim() ||
      wizard.basicDraft.source.trim() ||
      composerValue.trim()
  );

  const submitComposerIntent = async (override?: string) => {
    const nextMessage = (override ?? composerValue).trim();

    if (!nextMessage) {
      return false;
    }

    const previousValue = composerValue;
    const isDirectComposerSubmit = typeof override === "undefined";

    if (isDirectComposerSubmit) {
      setComposerValue("");
    }

    const success = await wizard.submitArchitectTurn(nextMessage);

    if (!success && isDirectComposerSubmit) {
      setComposerValue(previousValue);
    }

    return success;
  };

  const handleCreateWorkspace = async () => {
    if (isEditingWorkspace) {
      const success = composerValue.trim() ? await submitComposerIntent() : true;

      if (!success) {
        return;
      }

      const result = await wizard.applyWorkspaceChanges();

      if (result) {
        handleOpenChange(false);
      }

      return;
    }

    if (composerValue.trim()) {
      const success = await submitComposerIntent();

      if (!success) {
        return;
      }
    }

    const result = await wizard.createWorkspace();

    if (result) {
      handleOpenChange(false);
    }
  };

  const handleBasicStepBack = () => {
    if (basicStep === "shape") {
      setBasicStep("intake");
      return;
    }

    if (basicStep === "review") {
      setBasicStep("shape");
    }
  };

  const handleBasicStepPrimary = () => {
    if (basicStep === "intake") {
      setBasicStep("shape");
      return;
    }

    if (basicStep === "shape") {
      setBasicStep("review");
      return;
    }

    void handleCreateWorkspace();
  };

  const handleDeployWorkspace = async () => {
    if (isEditingWorkspace) {
      return;
    }

    const result = await wizard.deployPlan();

    if (result) {
      handleOpenChange(false);
    }
  };

  const handleBlueprintEditorSave = async (nextPlan: WorkspacePlan, summary: string) => {
    const planWithNote = summary.trim()
      ? {
          ...nextPlan,
          conversation: [
            ...nextPlan.conversation,
            createPlannerMessage("system", "Workspace Wizard", summary)
          ]
        }
      : nextPlan;

    return wizard.savePlan(planWithNote);
  };

  const handleDocumentEditorSave = async (nextPlan: WorkspacePlan, summary: string) => {
    const planWithNote = summary.trim()
      ? {
          ...nextPlan,
          conversation: [
            ...nextPlan.conversation,
            createPlannerMessage("system", "Workspace Wizard", summary)
          ]
        }
      : nextPlan;

    return wizard.savePlan(planWithNote);
  };

  const openBlueprintEditor = (focus: WorkspaceBlueprintEditorFocus = "workspace.name") => {
    setBlueprintEditorFocus(focus);
    setIsMobileBlueprintOpen(false);
    setIsBlueprintEditorOpen(true);
    setIsDocumentEditorOpen(false);
  };

  const openDocumentEditor = (path: string) => {
    setDocumentEditorPath(path);
    setIsMobileBlueprintOpen(false);
    setIsBlueprintEditorOpen(false);
    setIsDocumentEditorOpen(true);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={
          isLight
            ? "h-[92vh] max-w-[min(1380px,96vw)] gap-0 overflow-hidden border-[#e7dfd4] bg-[#fcfaf6] p-0 text-[#161411] shadow-[0_40px_140px_rgba(16,12,8,0.45)]"
            : "h-[92vh] max-w-[min(1380px,96vw)] gap-0 overflow-hidden border-white/10 bg-[rgba(4,8,15,0.96)] p-0 text-white shadow-[0_40px_140px_rgba(0,0,0,0.58)]"
        }
      >
        <DialogTitle className="sr-only">{isEditingWorkspace ? "Edit workspace" : "Create workspace"}</DialogTitle>
        <DialogDescription className="sr-only">
          {isEditingWorkspace
            ? "Edit the existing workspace blueprint, documents, and agents using Architect."
            : "Create a workspace in Basic or Advanced mode using the Architect wizard."}
        </DialogDescription>
        <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
          <div
            className={
              isLight
                ? "pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.86),transparent_34%),linear-gradient(180deg,rgba(248,244,237,0.92),rgba(252,250,246,0.86)_24%,rgba(244,238,230,0.82)_100%)]"
                : "pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.14),transparent_28%),radial-gradient(circle_at_80%_18%,rgba(56,189,248,0.12),transparent_24%),linear-gradient(180deg,rgba(9,15,27,0.98),rgba(4,8,15,0.96)_28%,rgba(2,6,13,0.98)_100%)]"
            }
          />
          <WorkspaceWizardHeader
            surfaceTheme={surfaceTheme}
            mode={wizard.mode}
            onModeChange={(mode) => {
              void wizard.switchMode(mode);
            }}
            onNewDraft={
              isEditingWorkspace
                ? undefined
                : () => {
                    setComposerValue("");
                    setIsMobileBlueprintOpen(false);
                    setIsBlueprintEditorOpen(false);
                    setIsDocumentEditorOpen(false);
                    setBasicStep("intake");
                    void wizard.startFreshDraft();
                  }
            }
            title={isEditingWorkspace ? "Edit workspace" : "Create workspace"}
            showModeToggle={!isEditingWorkspace}
            showNewDraft={!isEditingWorkspace}
            badges={headerBadges}
          />

          <div className="relative z-[1] grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr),390px] xl:grid-cols-[minmax(0,1fr),420px]">
          <div
            className={
              isLight
                ? "flex min-h-0 flex-col bg-[linear-gradient(180deg,rgba(252,250,246,0.7),rgba(247,242,235,0.92))]"
                : "flex min-h-0 flex-col bg-[linear-gradient(180deg,rgba(8,13,24,0.2),rgba(6,10,18,0.42))]"
            }
          >
              {wizard.mode === "basic" && !isEditingWorkspace ? (
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-5">
                    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
                      {showResumeBanner ? (
                        <ResumeDraftBanner
                          surfaceTheme={surfaceTheme}
                          isBusy={isArchitectBusy}
                          onResume={() => {
                            void wizard.resumeStoredDraft();
                          }}
                          onStartFresh={wizard.discardStoredDraft}
                        />
                      ) : null}

                      {wizard.isPlanLoading ? <LoadingGreeting surfaceTheme={surfaceTheme} /> : <BasicGreeting surfaceTheme={surfaceTheme} />}

                      <WorkspaceWizardBasicFlow
                        surfaceTheme={surfaceTheme}
                        step={basicStep}
                        isBusy={isArchitectBusy}
                        basicDraft={wizard.basicDraft}
                        basicTemplate={wizard.basicTemplate}
                        basicTeamPreset={wizard.basicTeamPreset}
                        basicModelProfile={wizard.basicModelProfile}
                        basicRules={wizard.basicRules}
                        basicPreset={wizard.basicPreset}
                        resolvedName={resolvedName}
                        resolvedTemplate={resolvedTemplate}
                        sourceAnalysis={wizard.sourceAnalysis}
                        workspacePath={workspacePath}
                        onStepChange={setBasicStep}
                        onBasicNameChange={wizard.setBasicName}
                        onBasicGoalChange={wizard.setBasicGoal}
                        onBasicSourceChange={wizard.setBasicSource}
                        onBasicTemplateChange={wizard.setBasicTemplate}
                        onBasicTeamPresetChange={wizard.setBasicTeamPreset}
                        onBasicModelProfileChange={wizard.setBasicModelProfile}
                        onBasicPresetChange={wizard.setBasicPreset}
                        onBasicRuleToggle={wizard.toggleBasicRule}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col">
                  {wizard.architectBusyStatus ? (
                    <div className={isLight ? "border-b border-[#ece5db] px-4 py-2.5 md:px-5" : "border-b border-white/10 px-4 py-2.5 md:px-5"}>
                      <div className={isLight ? "rounded-2xl border border-[#e6dfd5] bg-white px-3 py-2" : "rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2"}>
                        <p className={isLight ? "text-[10px] uppercase tracking-[0.2em] text-[#8b7262]" : "text-[10px] uppercase tracking-[0.2em] text-slate-500"}>
                          {wizard.architectBusyStatus.title}
                        </p>
                        <p className={isLight ? "mt-1 text-[12px] leading-5 text-[#6d665e]" : "mt-1 text-[12px] leading-5 text-slate-300"}>
                          {wizard.architectBusyStatus.description}
                        </p>
                      </div>
                    </div>
                  ) : null}

                  <div className="min-h-0 flex-1">
                    <WizardMessageList
                      surfaceTheme={surfaceTheme}
                      messages={activeMessages}
                      architectMessageId={architectMessageId}
                      architectPlan={wizard.plan}
                      isTyping={wizard.isSending}
                      typingLabel="Architect is shaping the next pass..."
                      emptyState={
                        wizard.isPlanLoading && activeMessages.length === 0 ? (
                          <LoadingGreeting surfaceTheme={surfaceTheme} />
                        ) : activeMessages.length === 0 && wizard.mode === "basic" ? (
                          <BasicGreeting surfaceTheme={surfaceTheme} />
                        ) : activeMessages.length === 0 ? (
                          <AdvancedGreeting surfaceTheme={surfaceTheme} />
                        ) : null
                      }
                      auxiliary={
                        <>
                          {showResumeBanner ? (
                            <ResumeDraftBanner
                              surfaceTheme={surfaceTheme}
                              isBusy={isArchitectBusy}
                              onResume={() => {
                                void wizard.resumeStoredDraft();
                              }}
                              onStartFresh={wizard.discardStoredDraft}
                            />
                          ) : null}

                          {activeProgress ? (
                            <div className="mx-auto w-full max-w-3xl">
                              <OperationProgress
                                progress={activeProgress}
                                className={isLight ? "border-[#e6dfd5] bg-white" : "border-white/10 bg-slate-950/50"}
                              />
                            </div>
                          ) : null}
                        </>
                      }
                    />
                  </div>

                  <div
                    className={
                      isLight
                        ? "border-t border-[#ece5db] bg-[linear-gradient(180deg,rgba(252,250,246,0.7),rgba(247,242,235,0.92))] px-4 py-4 md:px-5"
                        : "border-t border-white/10 bg-[linear-gradient(180deg,rgba(5,9,18,0.68),rgba(4,8,15,0.94))] px-4 py-4 md:px-5"
                    }
                  >
                    <div className="mx-auto w-full max-w-3xl">
                      <WizardComposer
                        surfaceTheme={surfaceTheme}
                        value={composerValue}
                        onChange={setComposerValue}
                        onSubmit={async () => {
                          await submitComposerIntent();
                        }}
                        placeholder={
                          isEditingWorkspace
                            ? "Tell Architect what to change in this workspace..."
                            : wizard.mode === "basic"
                            ? "Describe what this workspace should do..."
                            : "Refine the blueprint with Architect..."
                        }
                        disabled={isArchitectBusy}
                        isBusy={wizard.isSending}
                        helperText={
                          isEditingWorkspace
                            ? "Architect updates the existing workspace draft as you chat."
                            : wizard.mode === "basic"
                            ? "Architect keeps the fast-path draft synced as you chat."
                            : "Architect updates the shared blueprint on every turn."
                        }
                        toolbar={
                          isEditingWorkspace ? (
                            <span
                              className={
                                isLight
                                  ? "inline-flex items-center rounded-full border border-[#e3ddd4] bg-[#f6f1ea] px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-[#6c645b]"
                                  : "inline-flex items-center rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-slate-300"
                              }
                            >
                              Editing draft
                            </span>
                          ) : wizard.mode === "basic" && !wizard.plan ? (
                            <span
                              className={
                                isLight
                                  ? "inline-flex items-center rounded-full border border-[#e3ddd4] bg-[#f6f1ea] px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-[#6c645b]"
                                  : "inline-flex items-center rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-slate-300"
                              }
                            >
                              Live draft
                            </span>
                          ) : wizard.plan ? (
                            <span
                              className={
                                isLight
                                  ? "inline-flex items-center rounded-full border border-[#e3ddd4] bg-[#f6f1ea] px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-[#6c645b]"
                                  : "inline-flex items-center rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-slate-300"
                              }
                            >
                              Stage · {getPlannerStageLabel(wizard.plan.stage)}
                            </span>
                          ) : null
                        }
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <WorkspaceWizardDraftPane
              className="hidden lg:block"
              surfaceTheme={surfaceTheme}
              workspaceMode={isEditingWorkspace ? "edit" : "create"}
              mode={wizard.mode}
              snapshot={snapshot}
              plan={wizard.plan}
              resolvedName={resolvedName}
              resolvedTemplate={resolvedTemplate}
              sourceAnalysis={wizard.sourceAnalysis}
              workspacePath={workspacePath}
              notice={wizard.notice}
              basicRules={wizard.basicRules}
              basicPreset={wizard.basicPreset}
              onOpenBlueprintEditor={openBlueprintEditor}
              onOpenDocumentEditor={openDocumentEditor}
              onBasicPresetChange={wizard.setBasicPreset}
              onBasicRuleToggle={wizard.toggleBasicRule}
              progress={
                isEditingWorkspace
                  ? null
                  : wizard.mode === "basic"
                    ? wizard.createProgress
                    : wizard.isDeploying
                      ? wizard.deployProgress
                      : null
              }
            />
          </div>

          {isMobileBlueprintOpen ? (
            <div
              className={
                isLight
                  ? "absolute inset-0 z-20 flex flex-col bg-[rgba(22,18,14,0.18)] backdrop-blur-sm lg:hidden"
                  : "absolute inset-0 z-20 flex flex-col bg-[rgba(2,6,13,0.56)] backdrop-blur-sm lg:hidden"
              }
            >
              <div className={isLight ? "flex items-center justify-between border-b border-[#e7dfd4] bg-[#fcfaf6] px-4 py-3" : "flex items-center justify-between border-b border-white/10 bg-[rgba(4,8,15,0.96)] px-4 py-3"}>
                <div>
                  <p className={isLight ? "text-[11px] uppercase tracking-[0.18em] text-[#9f958a]" : "text-[11px] uppercase tracking-[0.18em] text-slate-500"}>
                    {wizard.mode === "basic" ? "Workspace draft" : "Workspace blueprint"}
                  </p>
                  <p className={isLight ? "text-[13px] text-[#6f675e]" : "text-[13px] text-slate-300"}>
                    Review the structured side of the same wizard.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {wizard.plan ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => openBlueprintEditor()}
                      className={
                        isLight
                          ? "rounded-full border-[#ddd6cb] bg-[#f7f2eb] text-[#403934] hover:bg-[#f1ebe3]"
                          : "rounded-full border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]"
                      }
                    >
                      Edit details
                    </Button>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => setIsMobileBlueprintOpen(false)}
                    className={
                      isLight
                        ? "inline-flex size-9 items-center justify-center rounded-full border border-[#e4ddd3] bg-white text-[#4f4943] transition-colors hover:bg-[#f4efe7]"
                        : "inline-flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-slate-200 transition-colors hover:bg-white/[0.08]"
                    }
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <WorkspaceWizardDraftPane
                className="min-h-0 flex-1 border-t-0 lg:hidden"
              surfaceTheme={surfaceTheme}
              workspaceMode={isEditingWorkspace ? "edit" : "create"}
              mode={wizard.mode}
              snapshot={snapshot}
              plan={wizard.plan}
              resolvedName={resolvedName}
              resolvedTemplate={resolvedTemplate}
              sourceAnalysis={wizard.sourceAnalysis}
                workspacePath={workspacePath}
                notice={wizard.notice}
                basicRules={wizard.basicRules}
                basicPreset={wizard.basicPreset}
                onOpenBlueprintEditor={openBlueprintEditor}
                onOpenDocumentEditor={openDocumentEditor}
                onBasicPresetChange={wizard.setBasicPreset}
                onBasicRuleToggle={wizard.toggleBasicRule}
                progress={
                  isEditingWorkspace
                    ? null
                    : wizard.mode === "basic"
                      ? wizard.createProgress
                      : wizard.isDeploying
                        ? wizard.deployProgress
                        : null
                }
            />
            </div>
          ) : null}

          {isBlueprintEditorOpen && wizard.plan ? (
            <WorkspaceWizardBlueprintEditor
              key={`${wizard.plan.id}:${blueprintEditorFocus}`}
              open={isBlueprintEditorOpen}
              surfaceTheme={surfaceTheme}
              plan={wizard.plan}
              busy={wizard.isSaving}
              focus={blueprintEditorFocus}
              onClose={() => setIsBlueprintEditorOpen(false)}
              onSave={handleBlueprintEditorSave}
            />
          ) : null}

          {isDocumentEditorOpen && wizard.plan ? (
            <WorkspaceWizardDocumentEditor
              key={`${wizard.plan.id}:${documentEditorPath}`}
              open={isDocumentEditorOpen}
              surfaceTheme={surfaceTheme}
              plan={wizard.plan}
              path={documentEditorPath}
              busy={wizard.isSaving}
              rewriteBusy={wizard.isDocumentRewriting}
              onClose={() => setIsDocumentEditorOpen(false)}
              onSave={handleDocumentEditorSave}
              onRewriteWithArchitect={wizard.rewriteDocumentWithArchitect}
            />
          ) : null}

          <div
            className={
              isLight
                ? "relative z-[1] border-t border-[#e7dfd4] bg-white/90 px-4 py-3 backdrop-blur-sm md:px-5"
                : "relative z-[1] border-t border-white/10 bg-[rgba(4,8,15,0.88)] px-4 py-3 backdrop-blur-sm md:px-5"
            }
          >
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <p className={isLight ? "text-[13px] text-[#776f65]" : "text-[13px] text-slate-300"}>
                {wizard.mode === "basic"
                  ? basicStep === "intake"
                    ? "Step 1 of 3. Capture the mission and source first."
                    : basicStep === "shape"
                      ? "Step 2 of 3. Pick the template and default shape."
                      : "Step 3 of 3. Review the draft before creating."
                  : "Chat and blueprint stay synced as you refine the plan."}
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  className={
                    isLight
                      ? "rounded-full border-[#dfd8ce] bg-[#f7f2eb] text-[#403934] hover:bg-[#f1ebe3] lg:hidden"
                      : "rounded-full border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08] lg:hidden"
                  }
                  onClick={() => setIsMobileBlueprintOpen(true)}
                >
                  <Columns2 className="mr-2 h-4 w-4" />
                  View blueprint
                </Button>

                {isEditingWorkspace ? (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      className={
                        isLight
                          ? "rounded-full border-[#dfd8ce] bg-[#f7f2eb] text-[#403934] hover:bg-[#f1ebe3]"
                          : "rounded-full border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]"
                      }
                      onClick={() => void wizard.savePlan()}
                      disabled={!wizard.plan || wizard.isSaving || wizard.isPlanLoading}
                    >
                      {wizard.isSaving ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Save draft
                    </Button>
                    <Button
                      size="sm"
                      className={
                        isLight
                          ? "rounded-full bg-[#161514] text-white hover:bg-[#26231f]"
                          : "rounded-full bg-cyan-300 text-slate-950 hover:bg-cyan-200"
                      }
                      onClick={() => void handleCreateWorkspace()}
                      disabled={!hasPrimaryActionDraft || wizard.isPlanLoading || wizard.isSending || wizard.isSaving || wizard.isApplyingWorkspaceChanges}
                    >
                      {wizard.isApplyingWorkspaceChanges ? (
                        <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="mr-2 h-4 w-4" />
                      )}
                      Apply changes
                    </Button>
                  </>
                ) : wizard.mode === "basic" ? (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      className={
                        isLight
                          ? "rounded-full border-[#dfd8ce] bg-[#f7f2eb] text-[#403934] hover:bg-[#f1ebe3]"
                          : "rounded-full border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]"
                      }
                      onClick={
                        basicStep === "intake"
                          ? () => {
                              void wizard.switchMode("advanced");
                            }
                          : handleBasicStepBack
                      }
                      disabled={wizard.isCreating || wizard.isSending || wizard.isPlanLoading}
                    >
                      {basicStep === "intake" ? "Advanced details" : "Back"}
                    </Button>
                    <Button
                      size="sm"
                      className={
                        isLight
                          ? "rounded-full bg-[#161514] text-white hover:bg-[#26231f]"
                          : "rounded-full bg-cyan-300 text-slate-950 hover:bg-cyan-200"
                      }
                      onClick={handleBasicStepPrimary}
                      disabled={
                        wizard.isCreating ||
                        wizard.isSending ||
                        wizard.isPlanLoading ||
                        (basicStep === "review" && !hasDraftToCreate)
                      }
                    >
                      {basicStep === "review" ? (
                        wizard.isCreating ? (
                          <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Sparkles className="mr-2 h-4 w-4" />
                        )
                      ) : (
                        <ChevronRight className="mr-2 h-4 w-4" />
                      )}
                      {basicStep === "intake" ? "Continue" : basicStep === "shape" ? "Review draft" : "Create workspace"}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      className={
                        isLight
                          ? "rounded-full border-[#dfd8ce] bg-[#f7f2eb] text-[#403934] hover:bg-[#f1ebe3]"
                          : "rounded-full border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]"
                      }
                      onClick={() => void wizard.savePlan()}
                      disabled={!wizard.plan || wizard.isSaving || wizard.isPlanLoading}
                    >
                      {wizard.isSaving ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Save draft
                    </Button>
                    {!wizard.plan?.intake.reviewRequested ? (
                      <Button
                        size="sm"
                        className={
                          isLight
                            ? "rounded-full bg-[#161514] text-white hover:bg-[#26231f]"
                            : "rounded-full bg-cyan-300 text-slate-950 hover:bg-cyan-200"
                        }
                        onClick={() => wizard.requestReview()}
                        disabled={!wizard.plan || wizard.isSending || wizard.isDeploying}
                      >
                        Review blueprint
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        className={
                          isLight
                            ? "rounded-full bg-[#161514] text-white hover:bg-[#26231f]"
                            : "rounded-full bg-cyan-300 text-slate-950 hover:bg-cyan-200"
                        }
                        onClick={() => void handleDeployWorkspace()}
                        disabled={
                          !wizard.plan ||
                          wizard.plan.deploy.blockers.length > 0 ||
                          wizard.isDeploying ||
                          wizard.isPlanLoading
                        }
                      >
                        {wizard.isDeploying ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Bot className="mr-2 h-4 w-4" />}
                        Deploy workspace
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BasicGreeting({ surfaceTheme }: { surfaceTheme: SurfaceTheme }) {
  const isLight = surfaceTheme === "light";

  return (
    <div className="mx-auto mt-4 flex w-full max-w-2xl flex-col gap-3 px-4 md:mt-12 md:px-6">
      <p className={cn("text-[10px] uppercase tracking-[0.22em]", isLight ? "text-[#8b7262]" : "text-slate-500")}>
        Fast path
      </p>
      <p className={isLight ? "text-[24px] font-semibold tracking-[-0.03em] text-[#181612]" : "text-[24px] font-semibold tracking-[-0.03em] text-white"}>
        Start with one prompt.
      </p>
      <p className={isLight ? "text-[15px] leading-7 text-[#7f756b]" : "text-[15px] leading-7 text-slate-400"}>
        Tell Architect what this workspace should do. It will reflect the intent back and ask the next critical question.
      </p>
    </div>
  );
}

function AdvancedGreeting({ surfaceTheme }: { surfaceTheme: SurfaceTheme }) {
  const isLight = surfaceTheme === "light";

  return (
    <div className="mx-auto mt-4 flex w-full max-w-2xl flex-col gap-3 px-4 md:mt-12 md:px-6">
      <p className={cn("text-[10px] uppercase tracking-[0.22em]", isLight ? "text-[#8b7262]" : "text-slate-500")}>
        Blueprint mode
      </p>
      <p className={isLight ? "text-[24px] font-semibold tracking-[-0.03em] text-[#181612]" : "text-[24px] font-semibold tracking-[-0.03em] text-white"}>
        Shape the workspace with Architect.
      </p>
      <p className={isLight ? "text-[15px] leading-7 text-[#7f756b]" : "text-[15px] leading-7 text-slate-400"}>
        Describe the operating model, and the structured draft updates as you chat.
      </p>
    </div>
  );
}

function LoadingGreeting({ surfaceTheme }: { surfaceTheme: SurfaceTheme }) {
  const isLight = surfaceTheme === "light";

  return (
    <div
      className={
        isLight
          ? "mx-auto mt-10 flex w-full max-w-2xl items-center gap-3 rounded-2xl border border-[#e6dfd5] bg-white px-4 py-3 text-[13px] text-[#6d665e]"
          : "mx-auto mt-10 flex w-full max-w-2xl items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-[13px] text-slate-300"
      }
    >
      <LoaderCircle className="h-4 w-4 animate-spin" />
      Architect is opening the planning session and extracting intent from the latest brief.
    </div>
  );
}

function BasicQuickStartCard({
  surfaceTheme,
  name,
  goal,
  source,
  resolvedName,
  resolvedTemplate,
  workspacePath,
  sourceAnalysis,
  disabled,
  onNameChange,
  onGoalChange,
  onSourceChange
}: {
  surfaceTheme: SurfaceTheme;
  name: string;
  goal: string;
  source: string;
  resolvedName: string;
  resolvedTemplate: WorkspaceTemplate;
  workspacePath: string;
  sourceAnalysis: WorkspaceWizardSourceAnalysis;
  disabled?: boolean;
  onNameChange: (value: string) => void;
  onGoalChange: (value: string) => void;
  onSourceChange: (value: string) => void;
}) {
  const isLight = surfaceTheme === "light";
  const sourceIcon =
    sourceAnalysis.kind === "clone"
      ? GitBranch
      : sourceAnalysis.kind === "website"
        ? Globe
        : FolderOpen;

  return (
    <div
      className={cn(
        "mx-auto w-full rounded-[24px] border p-4 shadow-[0_18px_56px_rgba(56,47,38,0.06)] md:p-5",
        isLight ? "border-[#e4ddd3] bg-white" : "border-white/10 bg-white/[0.04]"
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "inline-flex size-8 shrink-0 items-center justify-center rounded-full border",
            isLight ? "border-[#e4ddd3] bg-[#faf6f1] text-[#5e5750]" : "border-white/10 bg-white/[0.05] text-slate-300"
          )}
        >
          <Sparkles className="h-3.5 w-3.5" />
        </span>

        <div className="min-w-0 flex-1">
          <p className={isLight ? "text-[10px] uppercase tracking-[0.2em] text-[#8b7262]" : "text-[10px] uppercase tracking-[0.2em] text-slate-500"}>
            Step 1 · Intake
          </p>
          <p className={isLight ? "mt-1 text-[12px] leading-5 text-[#70685f]" : "mt-1 text-[12px] leading-5 text-slate-300"}>
            Give Architect the mission and source. The name can stay optional.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        <FieldBlock surfaceTheme={surfaceTheme} label="Workspace name">
          <Input
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="Optional. Architect can infer it."
            disabled={disabled}
            className={
              isLight
                ? "border-[#e4ddd3] bg-[#fcfaf6] text-[#1c1916] placeholder:text-[#9b948c] focus-visible:ring-[#b8ada1]"
                : "border-white/10 bg-[rgba(4,8,15,0.64)] text-slate-100 placeholder:text-slate-500 focus-visible:ring-cyan-300/60"
            }
          />
        </FieldBlock>

        <FieldBlock surfaceTheme={surfaceTheme} label="Goal">
          <Textarea
            value={goal}
            onChange={(event) => onGoalChange(event.target.value)}
            placeholder="What should this workspace help you accomplish?"
            disabled={disabled}
            className={
              isLight
                ? "min-h-[100px] border-[#e4ddd3] bg-[#fcfaf6] text-[#1c1916] placeholder:text-[#9b948c] focus-visible:ring-[#b8ada1]"
                : "min-h-[100px] border-white/10 bg-[rgba(4,8,15,0.64)] text-slate-100 placeholder:text-slate-500 focus-visible:ring-cyan-300/60"
            }
          />
        </FieldBlock>

        <FieldBlock surfaceTheme={surfaceTheme} label="Source">
          <Input
            value={source}
            onChange={(event) => onSourceChange(event.target.value)}
            placeholder="Repo URL, website URL, or existing folder path"
            disabled={disabled}
            className={
              isLight
                ? "border-[#e4ddd3] bg-[#fcfaf6] text-[#1c1916] placeholder:text-[#9b948c] focus-visible:ring-[#b8ada1]"
                : "border-white/10 bg-[rgba(4,8,15,0.64)] text-slate-100 placeholder:text-slate-500 focus-visible:ring-cyan-300/60"
            }
          />
        </FieldBlock>
      </div>

      <div
        className={cn(
          "mt-4 rounded-[20px] border px-3 py-3",
          isLight ? "border-[#e8e0d6] bg-[#faf6f1]" : "border-white/10 bg-white/[0.03]"
        )}
      >
        <div className="flex items-center gap-2">
          <Sparkles className={cn("h-4 w-4", isLight ? "text-[#5f5952]" : "text-slate-300")} />
          <p className={cn("text-[11px] uppercase tracking-[0.18em]", isLight ? "text-[#a0978b]" : "text-slate-500")}>
            Live preview
          </p>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <PreviewMetric surfaceTheme={surfaceTheme} label="Name" value={resolvedName} icon={Sparkles} />
          <PreviewMetric
            surfaceTheme={surfaceTheme}
            label="Template"
            value={getWorkspaceTemplateMeta(resolvedTemplate).label}
            icon={Zap}
          />
          <PreviewMetric surfaceTheme={surfaceTheme} label="Source" value={sourceAnalysis.label} icon={sourceIcon} />
          <PreviewMetric surfaceTheme={surfaceTheme} label="Path" value={workspacePath} icon={FolderOpen} mono />
        </div>
      </div>
    </div>
  );
}

function ResumeDraftBanner({
  surfaceTheme,
  isBusy,
  onResume,
  onStartFresh
}: {
  surfaceTheme: SurfaceTheme;
  isBusy: boolean;
  onResume: () => void;
  onStartFresh: () => void;
}) {
  const isLight = surfaceTheme === "light";

  return (
    <div
      className={
        isLight
          ? "mx-auto w-full max-w-3xl rounded-[22px] border border-[#e4ddd3] bg-[#fffaf3] px-4 py-4 shadow-[0_18px_48px_rgba(56,47,38,0.05)]"
          : "mx-auto w-full max-w-3xl rounded-[22px] border border-white/10 bg-white/[0.05] px-4 py-4"
      }
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className={isLight ? "text-[11px] uppercase tracking-[0.18em] text-[#8b7262]" : "text-[11px] uppercase tracking-[0.18em] text-slate-500"}>
            Previous draft found
          </p>
          <p className={isLight ? "mt-1 text-[14px] leading-6 text-[#30261d]" : "mt-1 text-[14px] leading-6 text-white"}>
            Architect still has an earlier workspace blueprint. Resume it or start fresh before creating a new one.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            className={
              isLight
                ? "rounded-full border-[#dfd8ce] bg-white text-[#403934] hover:bg-[#f7f2eb]"
                : "rounded-full border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]"
            }
            onClick={onStartFresh}
            disabled={isBusy}
          >
            Start fresh
          </Button>
          <Button
            size="sm"
            className={
              isLight
                ? "rounded-full bg-[#161514] text-white hover:bg-[#26231f]"
                : "rounded-full bg-cyan-300 text-slate-950 hover:bg-cyan-200"
            }
            onClick={onResume}
            disabled={isBusy}
          >
            Resume blueprint
          </Button>
        </div>
      </div>
    </div>
  );
}

function FieldBlock({
  surfaceTheme,
  label,
  children
}: {
  surfaceTheme: SurfaceTheme;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <p className={surfaceTheme === "light" ? "text-[11px] uppercase tracking-[0.16em] text-[#8d8276]" : "text-[11px] uppercase tracking-[0.16em] text-slate-500"}>
        {label}
      </p>
      {children}
    </div>
  );
}

const WORKSPACE_CREATE_STEP_OPTIONS: Array<{
  id: WorkspaceCreateStep;
  label: string;
  hint: string;
}> = [
  {
    id: "intake",
    label: "Intake",
    hint: "Mission, name, source"
  },
  {
    id: "shape",
    label: "Shape",
    hint: "Template and defaults"
  },
  {
    id: "review",
    label: "Review",
    hint: "Confirm and launch"
  }
];

function getWorkspaceCreateStepLabel(step: WorkspaceCreateStep) {
  return WORKSPACE_CREATE_STEP_OPTIONS.find((option) => option.id === step)?.label ?? "Intake";
}

function getWorkspaceCreateStepIndex(step: WorkspaceCreateStep) {
  return WORKSPACE_CREATE_STEP_OPTIONS.findIndex((option) => option.id === step);
}

function WorkspaceWizardBasicFlow({
  surfaceTheme,
  step,
  isBusy,
  basicDraft,
  basicTemplate,
  basicTeamPreset,
  basicModelProfile,
  basicRules,
  basicPreset,
  resolvedName,
  resolvedTemplate,
  sourceAnalysis,
  workspacePath,
  onStepChange,
  onBasicNameChange,
  onBasicGoalChange,
  onBasicSourceChange,
  onBasicTemplateChange,
  onBasicTeamPresetChange,
  onBasicModelProfileChange,
  onBasicPresetChange,
  onBasicRuleToggle
}: {
  surfaceTheme: SurfaceTheme;
  step: WorkspaceCreateStep;
  isBusy: boolean;
  basicDraft: {
    name: string;
    goal: string;
    source: string;
  };
  basicTemplate: WorkspaceTemplate;
  basicTeamPreset: WorkspaceTeamPreset;
  basicModelProfile: WorkspaceModelProfile;
  basicRules: WorkspaceCreateRules;
  basicPreset: WorkspaceWizardQuickSetupPreset;
  resolvedName: string;
  resolvedTemplate: WorkspaceTemplate;
  sourceAnalysis: WorkspaceWizardSourceAnalysis;
  workspacePath: string;
  onStepChange: (step: WorkspaceCreateStep) => void;
  onBasicNameChange: (value: string) => void;
  onBasicGoalChange: (value: string) => void;
  onBasicSourceChange: (value: string) => void;
  onBasicTemplateChange: (value: WorkspaceTemplate) => void;
  onBasicTeamPresetChange: (value: WorkspaceTeamPreset) => void;
  onBasicModelProfileChange: (value: WorkspaceModelProfile) => void;
  onBasicPresetChange: (preset: WorkspaceWizardQuickSetupPreset) => void;
  onBasicRuleToggle: (
    rule: keyof Pick<WorkspaceCreateRules, "generateStarterDocs" | "generateMemory" | "kickoffMission">
  ) => void;
}) {
  return (
    <div className="space-y-4">
      <BasicStepRail surfaceTheme={surfaceTheme} step={step} onStepChange={onStepChange} />

      {step === "intake" ? (
        <BasicQuickStartCard
          surfaceTheme={surfaceTheme}
          name={basicDraft.name}
          goal={basicDraft.goal}
          source={basicDraft.source}
          resolvedName={resolvedName}
          resolvedTemplate={resolvedTemplate}
          workspacePath={workspacePath}
          sourceAnalysis={sourceAnalysis}
          onNameChange={onBasicNameChange}
          onGoalChange={onBasicGoalChange}
          onSourceChange={onBasicSourceChange}
        />
      ) : step === "shape" ? (
        <BasicShapeStep
          surfaceTheme={surfaceTheme}
          basicTemplate={basicTemplate}
          basicTeamPreset={basicTeamPreset}
          basicModelProfile={basicModelProfile}
          basicRules={basicRules}
          basicPreset={basicPreset}
          onBasicTemplateChange={onBasicTemplateChange}
          onBasicTeamPresetChange={onBasicTeamPresetChange}
          onBasicModelProfileChange={onBasicModelProfileChange}
          onBasicPresetChange={onBasicPresetChange}
          onBasicRuleToggle={onBasicRuleToggle}
          isBusy={isBusy}
        />
      ) : (
        <BasicReviewStep
          surfaceTheme={surfaceTheme}
          basicDraft={basicDraft}
          basicTeamPreset={basicTeamPreset}
          basicModelProfile={basicModelProfile}
          basicRules={basicRules}
          basicPreset={basicPreset}
          resolvedName={resolvedName}
          resolvedTemplate={resolvedTemplate}
          sourceAnalysis={sourceAnalysis}
          workspacePath={workspacePath}
          onStepChange={onStepChange}
        />
      )}
    </div>
  );
}

function BasicStepRail({
  surfaceTheme,
  step,
  onStepChange
}: {
  surfaceTheme: SurfaceTheme;
  step: WorkspaceCreateStep;
  onStepChange: (step: WorkspaceCreateStep) => void;
}) {
  const isLight = surfaceTheme === "light";
  const activeIndex = WORKSPACE_CREATE_STEP_OPTIONS.findIndex((option) => option.id === step);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {WORKSPACE_CREATE_STEP_OPTIONS.map((option, index) => {
        const isActive = option.id === step;
        const isComplete = index < activeIndex;

        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onStepChange(option.id)}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-left transition-colors",
              isActive
                ? isLight
                  ? "border-[#c89e73]/35 bg-[#f8efe4] text-[#5d4331]"
                  : "border-cyan-300/30 bg-cyan-400/10 text-cyan-50"
                : isComplete
                  ? isLight
                    ? "border-[#dccfc3] bg-white text-[#7e6757]"
                    : "border-emerald-300/20 bg-emerald-400/10 text-emerald-50"
                  : isLight
                    ? "border-[#e6dbd0] bg-white/80 text-[#8b7563]"
                    : "border-white/10 bg-white/[0.04] text-slate-400"
            )}
          >
            <span
              className={cn(
                "inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-medium",
                isActive
                  ? isLight
                    ? "bg-[#c89e73]/15 text-[#5d4331]"
                    : "bg-cyan-300/20 text-cyan-50"
                  : isComplete
                    ? isLight
                      ? "bg-[#f0e7de] text-[#7a6556]"
                      : "bg-emerald-300/20 text-emerald-50"
                    : isLight
                      ? "bg-[#f2ece6] text-[#917866]"
                      : "bg-white/10 text-slate-400"
              )}
            >
              {index + 1}
            </span>
            <span className="min-w-0">
              <span className="block text-[10px] font-medium uppercase tracking-[0.16em]">
                {option.label}
              </span>
              <span className="block text-[10px] leading-4 opacity-75">
                {option.hint}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function BasicShapeStep({
  surfaceTheme,
  basicTemplate,
  basicTeamPreset,
  basicModelProfile,
  basicRules,
  basicPreset,
  onBasicTemplateChange,
  onBasicTeamPresetChange,
  onBasicModelProfileChange,
  onBasicPresetChange,
  onBasicRuleToggle,
  isBusy
}: {
  surfaceTheme: SurfaceTheme;
  basicTemplate: WorkspaceTemplate;
  basicTeamPreset: WorkspaceTeamPreset;
  basicModelProfile: WorkspaceModelProfile;
  basicRules: WorkspaceCreateRules;
  basicPreset: WorkspaceWizardQuickSetupPreset;
  onBasicTemplateChange: (value: WorkspaceTemplate) => void;
  onBasicTeamPresetChange: (value: WorkspaceTeamPreset) => void;
  onBasicModelProfileChange: (value: WorkspaceModelProfile) => void;
  onBasicPresetChange: (preset: WorkspaceWizardQuickSetupPreset) => void;
  onBasicRuleToggle: (
    rule: keyof Pick<WorkspaceCreateRules, "generateStarterDocs" | "generateMemory" | "kickoffMission">
  ) => void;
  isBusy: boolean;
}) {
  const isLight = surfaceTheme === "light";
  const templateMeta = getWorkspaceTemplateMeta(basicTemplate);

  return (
    <section
      className={cn(
        "rounded-[24px] border p-4 md:p-5",
        isLight ? "border-[#e4ddd3] bg-white" : "border-white/10 bg-white/[0.04]"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn("text-[10px] uppercase tracking-[0.2em]", isLight ? "text-[#8b7262]" : "text-slate-500")}>
            Step 2 · Shape
          </p>
          <p className={cn("mt-1 text-[12px] leading-5", isLight ? "text-[#70685f]" : "text-slate-300")}>
            Pick the template and defaults that best match the workspace.
          </p>
        </div>

        <Badge variant="muted" className={cn("shrink-0", isLight ? "border-[#ddd6cb] bg-[#f7f2eb] text-[#574a40]" : "")}>
          {templateMeta.label}
        </Badge>
      </div>

      <div className="mt-4 space-y-4">
        <OptionGroup
          surfaceTheme={surfaceTheme}
          title="Template"
          summary="This sets the scaffold, documents, and default capabilities."
        >
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {WORKSPACE_TEMPLATE_OPTIONS.map((option) => {
              const meta = getWorkspaceTemplateMeta(option.value);

              return (
                <ChoiceCard
                  key={option.value}
                  surfaceTheme={surfaceTheme}
                  selected={basicTemplate === option.value}
                  title={option.label}
                  description={option.description}
                  icon={
                    <span className="text-[14px] leading-none" aria-hidden="true">
                      {meta.icon}
                    </span>
                  }
                  onClick={() => onBasicTemplateChange(option.value)}
                  disabled={isBusy}
                />
              );
            })}
          </div>
        </OptionGroup>

        <OptionGroup
          surfaceTheme={surfaceTheme}
          title="Team preset"
          summary="Choose how many permanent agents the workspace should start with."
        >
          <div className="grid gap-2 md:grid-cols-3">
            {WORKSPACE_TEAM_PRESET_OPTIONS.map((option) => (
              <ChoiceCard
                key={option.value}
                surfaceTheme={surfaceTheme}
                selected={basicTeamPreset === option.value}
                title={option.label}
                description={option.description}
                icon={<Bot className="h-4 w-4" />}
                onClick={() => onBasicTeamPresetChange(option.value)}
                disabled={isBusy}
              />
            ))}
          </div>
        </OptionGroup>

        <OptionGroup
          surfaceTheme={surfaceTheme}
          title="Model profile"
          summary="Favor speed, balance, or quality for the default workspace runs."
        >
          <div className="grid gap-2 md:grid-cols-3">
            {WORKSPACE_MODEL_PROFILE_OPTIONS.map((option) => (
              <ChoiceCard
                key={option.value}
                surfaceTheme={surfaceTheme}
                selected={basicModelProfile === option.value}
                title={option.label}
                description={option.description}
                icon={<Zap className="h-4 w-4" />}
                onClick={() => onBasicModelProfileChange(option.value)}
                disabled={isBusy}
              />
            ))}
          </div>
        </OptionGroup>

        <div
          className={cn(
            "rounded-[20px] border p-3",
            isLight ? "border-[#e8e0d6] bg-[#faf6f1]" : "border-white/10 bg-white/[0.03]"
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className={cn("text-[11px] uppercase tracking-[0.18em]", isLight ? "text-[#8d8276]" : "text-slate-500")}>
                Bootstrap speed
              </p>
              <p className={cn("mt-1 text-[12px] leading-5", isLight ? "text-[#766e64]" : "text-slate-400")}>
                Use a preset or tune the bootstrap rules manually.
              </p>
            </div>
            <Badge variant="muted">{basicPreset}</Badge>
          </div>

          <div className="mt-3 grid gap-2 md:grid-cols-3">
            <PresetButton
              surfaceTheme={surfaceTheme}
              active={basicPreset === "standard"}
              title="Standard"
              description="Docs, memory, kickoff"
              disabled={isBusy}
              onClick={() => onBasicPresetChange("standard")}
            />
            <PresetButton
              surfaceTheme={surfaceTheme}
              active={basicPreset === "fastest"}
              title="Fastest"
              description="Core files only"
              disabled={isBusy}
              onClick={() => onBasicPresetChange("fastest")}
            />
            <PresetButton
              surfaceTheme={surfaceTheme}
              active={basicPreset === "custom"}
              title="Custom"
              description="Manually choose rules"
              disabled={isBusy}
              onClick={() => onBasicPresetChange("custom")}
            />
          </div>
        </div>

        <div
          className={cn(
            "rounded-[20px] border p-3",
            isLight ? "border-[#e8e0d6] bg-[#faf6f1]" : "border-white/10 bg-white/[0.03]"
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className={cn("text-[11px] uppercase tracking-[0.18em]", isLight ? "text-[#8d8276]" : "text-slate-500")}>
                Workspace rules
              </p>
              <p className={cn("mt-1 text-[12px] leading-5", isLight ? "text-[#766e64]" : "text-slate-400")}>
                Toggle the bootstrap steps that should ship with the workspace.
              </p>
            </div>
            <Badge variant="muted">
              {[
                basicRules.generateStarterDocs,
                basicRules.generateMemory,
                basicRules.kickoffMission
              ].filter(Boolean).length}
              /3
            </Badge>
          </div>

          <div className="mt-3 space-y-2">
            <RuleToggleRow
              surfaceTheme={surfaceTheme}
              title="Starter docs"
              description="Generate the brief, scaffolding notes, and handoff docs."
              checked={basicRules.generateStarterDocs}
              disabled={isBusy}
              onToggle={() => onBasicRuleToggle("generateStarterDocs")}
            />
            <RuleToggleRow
              surfaceTheme={surfaceTheme}
              title="Memory"
              description="Write durable context and decisions into memory files."
              checked={basicRules.generateMemory}
              disabled={isBusy}
              onToggle={() => onBasicRuleToggle("generateMemory")}
            />
            <RuleToggleRow
              surfaceTheme={surfaceTheme}
              title="Kickoff mission"
              description="Launch the first mission right after bootstrap."
              checked={basicRules.kickoffMission}
              disabled={isBusy}
              onToggle={() => onBasicRuleToggle("kickoffMission")}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function BasicReviewStep({
  surfaceTheme,
  basicDraft,
  basicTeamPreset,
  basicModelProfile,
  basicRules,
  basicPreset,
  resolvedName,
  resolvedTemplate,
  sourceAnalysis,
  workspacePath,
  onStepChange
}: {
  surfaceTheme: SurfaceTheme;
  basicDraft: {
    name: string;
    goal: string;
    source: string;
  };
  basicTeamPreset: WorkspaceTeamPreset;
  basicModelProfile: WorkspaceModelProfile;
  basicRules: WorkspaceCreateRules;
  basicPreset: WorkspaceWizardQuickSetupPreset;
  resolvedName: string;
  resolvedTemplate: WorkspaceTemplate;
  sourceAnalysis: WorkspaceWizardSourceAnalysis;
  workspacePath: string;
  onStepChange: (step: WorkspaceCreateStep) => void;
}) {
  const isLight = surfaceTheme === "light";
  const sourceIcon =
    sourceAnalysis.kind === "clone"
      ? GitBranch
      : sourceAnalysis.kind === "website"
        ? Globe
        : FolderOpen;
  const enabledRuleCount = [
    basicRules.generateStarterDocs,
    basicRules.generateMemory,
    basicRules.kickoffMission
  ].filter(Boolean).length;

  return (
    <section
      className={cn(
        "rounded-[24px] border p-4 md:p-5",
        isLight ? "border-[#e4ddd3] bg-white" : "border-white/10 bg-white/[0.04]"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn("text-[10px] uppercase tracking-[0.2em]", isLight ? "text-[#8b7262]" : "text-slate-500")}>
            Step 3 · Review
          </p>
          <p className={cn("mt-1 text-[12px] leading-5", isLight ? "text-[#70685f]" : "text-slate-300")}>
            Check the final draft before creating the workspace.
          </p>
        </div>

        <Badge variant="success">Ready</Badge>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <PreviewMetric surfaceTheme={surfaceTheme} label="Name" value={resolvedName} icon={Sparkles} />
        <PreviewMetric
          surfaceTheme={surfaceTheme}
          label="Template"
          value={getWorkspaceTemplateMeta(resolvedTemplate).label}
          icon={Zap}
        />
        <PreviewMetric surfaceTheme={surfaceTheme} label="Source" value={sourceAnalysis.label} icon={sourceIcon} />
        <PreviewMetric surfaceTheme={surfaceTheme} label="Path" value={workspacePath} icon={FolderOpen} mono />
        <PreviewMetric
          surfaceTheme={surfaceTheme}
          label="Team"
          value={WORKSPACE_TEAM_PRESET_OPTIONS.find((option) => option.value === basicTeamPreset)?.label ?? basicTeamPreset}
          icon={Bot}
        />
        <PreviewMetric
          surfaceTheme={surfaceTheme}
          label="Model"
          value={WORKSPACE_MODEL_PROFILE_OPTIONS.find((option) => option.value === basicModelProfile)?.label ?? basicModelProfile}
          icon={Zap}
        />
      </div>

      <div
        className={cn(
          "mt-4 rounded-[20px] border p-3",
          isLight ? "border-[#e8e0d6] bg-[#faf6f1]" : "border-white/10 bg-white/[0.03]"
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className={cn("text-[11px] uppercase tracking-[0.18em]", isLight ? "text-[#8d8276]" : "text-slate-500")}>
              Launch summary
            </p>
            <p className={cn("mt-1 text-[12px] leading-5", isLight ? "text-[#766e64]" : "text-slate-400")}>
              {basicPreset === "fastest"
                ? "Fast path will keep the scaffold lean."
                : basicPreset === "custom"
                  ? "Custom bootstrap rules are active."
                  : "Starter docs, memory, and kickoff are enabled."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="muted">{enabledRuleCount}/3 rules</Badge>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onStepChange("intake")}
              className={
                isLight
                  ? "rounded-full border-[#dfd8ce] bg-white text-[#403934] hover:bg-[#f7f2eb]"
                  : "rounded-full border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]"
              }
            >
              Edit intake
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onStepChange("shape")}
              className={
                isLight
                  ? "rounded-full border-[#dfd8ce] bg-white text-[#403934] hover:bg-[#f7f2eb]"
                  : "rounded-full border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]"
              }
            >
              Edit shape
            </Button>
          </div>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <div
            className={cn(
              "rounded-[18px] border px-3 py-2.5",
              isLight ? "border-[#e8e0d6] bg-white" : "border-white/10 bg-white/[0.03]"
            )}
          >
            <p className={cn("text-[10px] uppercase tracking-[0.16em]", isLight ? "text-[#8d8276]" : "text-slate-500")}>
              Goal
            </p>
            <p className={cn("mt-1 text-[13px] leading-6", isLight ? "text-[#34281f]" : "text-slate-200")}>
              {basicDraft.goal.trim() || "No goal provided yet."}
            </p>
          </div>
          <div
            className={cn(
              "rounded-[18px] border px-3 py-2.5",
              isLight ? "border-[#e8e0d6] bg-white" : "border-white/10 bg-white/[0.03]"
            )}
          >
            <p className={cn("text-[10px] uppercase tracking-[0.16em]", isLight ? "text-[#8d8276]" : "text-slate-500")}>
              Source kind
            </p>
            <p className={cn("mt-1 text-[13px] leading-6", isLight ? "text-[#34281f]" : "text-slate-200")}>
              {sourceAnalysis.kind === "empty" ? "Fresh workspace" : sourceAnalysis.label}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function OptionGroup({
  surfaceTheme,
  title,
  summary,
  children
}: {
  surfaceTheme: SurfaceTheme;
  title: string;
  summary: string;
  children: ReactNode;
}) {
  const isLight = surfaceTheme === "light";

  return (
    <div className="space-y-2">
      <div>
        <p className={cn("text-[11px] uppercase tracking-[0.18em]", isLight ? "text-[#8d8276]" : "text-slate-500")}>
          {title}
        </p>
        <p className={cn("mt-1 text-[12px] leading-5", isLight ? "text-[#766e64]" : "text-slate-400")}>
          {summary}
        </p>
      </div>
      {children}
    </div>
  );
}

function ChoiceCard({
  surfaceTheme,
  selected,
  title,
  description,
  icon,
  onClick,
  disabled = false
}: {
  surfaceTheme: SurfaceTheme;
  selected: boolean;
  title: string;
  description: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  const isLight = surfaceTheme === "light";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "group flex h-full min-h-[90px] flex-col justify-between rounded-[18px] border p-3 text-left transition-colors",
        selected
          ? isLight
            ? "border-[#1f1b17] bg-[#1f1b17] text-white"
            : "border-cyan-300 bg-cyan-300/10 text-white"
          : isLight
            ? "border-[#e8e0d6] bg-[#faf6f1] text-[#171410] hover:border-[#d7c8ba] hover:bg-[#f6efe6]"
            : "border-white/10 bg-white/[0.03] text-white hover:border-white/15 hover:bg-white/[0.05]",
        disabled && "cursor-not-allowed opacity-70"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "inline-flex size-8 shrink-0 items-center justify-center rounded-full border",
              selected
                ? isLight
                  ? "border-white/15 bg-white/10 text-white"
                  : "border-white/15 bg-white/10 text-white"
                : isLight
                  ? "border-[#ddd3c5] bg-white text-[#5f564b]"
                  : "border-white/10 bg-white/[0.04] text-slate-200"
            )}
          >
            {icon}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium">{title}</p>
            <p className={cn("mt-0.5 text-[11px] leading-4", selected ? "text-current/80" : isLight ? "text-[#766e64]" : "text-slate-400")}>
              {description}
            </p>
          </div>
        </div>

        {selected ? (
          <Badge variant={isLight ? "muted" : "default"} className={isLight ? "bg-white text-[#3d342b]" : ""}>
            Selected
          </Badge>
        ) : null}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className={cn("text-[10px] uppercase tracking-[0.16em]", selected ? "text-current/70" : isLight ? "text-[#8d8276]" : "text-slate-500")}>
          {selected ? "Active choice" : "Select"}
        </span>
        <span
          className={cn(
            "inline-flex size-5 items-center justify-center rounded-full border",
            selected
              ? isLight
                ? "border-white/15 bg-white/10 text-white"
                : "border-white/15 bg-white/10 text-white"
              : isLight
                ? "border-[#d9cec2] bg-white text-transparent"
                : "border-white/10 bg-transparent text-transparent"
          )}
        >
          <Check className="h-3 w-3" />
        </span>
      </div>
    </button>
  );
}

function RuleToggleRow({
  surfaceTheme,
  title,
  description,
  checked,
  onToggle,
  disabled = false
}: {
  surfaceTheme: SurfaceTheme;
  title: string;
  description: string;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  const isLight = surfaceTheme === "light";

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        "flex w-full items-start gap-3 rounded-[18px] border px-3 py-3 text-left transition-colors",
        isLight ? "border-[#e8e0d6] bg-white" : "border-white/10 bg-white/[0.03]",
        disabled ? "cursor-not-allowed opacity-70" : isLight ? "hover:border-[#d7c8ba] hover:bg-[#f7f0e6]" : "hover:border-white/15 hover:bg-white/[0.05]"
      )}
    >
      <span
        className={cn(
          "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-md border",
          checked
            ? isLight
              ? "border-[#1f1b17] bg-[#1f1b17] text-white"
              : "border-cyan-300 bg-cyan-300 text-slate-950"
            : isLight
              ? "border-[#d9d0c6] bg-white text-transparent"
              : "border-white/15 bg-transparent text-transparent"
        )}
      >
        <Check className="h-3 w-3" />
      </span>

      <div className="min-w-0 flex-1">
        <p className={cn("text-[13px] font-medium", isLight ? "text-[#171410]" : "text-white")}>{title}</p>
        <p className={cn("mt-1 text-[12px] leading-5", isLight ? "text-[#766e64]" : "text-slate-400")}>{description}</p>
      </div>
    </button>
  );
}

function PresetButton({
  surfaceTheme,
  active,
  title,
  description,
  disabled = false,
  onClick
}: {
  surfaceTheme: SurfaceTheme;
  active: boolean;
  title: string;
  description: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  const isLight = surfaceTheme === "light";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full rounded-[14px] border px-3 py-2 text-left transition-colors",
        active
          ? isLight
            ? "border-[#1f1b17] bg-[#1f1b17] text-white"
            : "border-cyan-300 bg-cyan-300/15 text-cyan-50"
          : isLight
            ? "border-[#e8e0d6] bg-[#faf6f1] text-[#171410] hover:border-[#d8c9ba] hover:bg-[#f6efe6]"
            : "border-white/10 bg-white/[0.03] text-white hover:border-white/15 hover:bg-white/[0.05]",
        disabled && "cursor-not-allowed opacity-70"
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Zap className="h-3.5 w-3.5 shrink-0" />
          <p className="truncate text-[12px] font-medium">{title}</p>
        </div>
        <p
          className={cn(
            "truncate text-right text-[11px] leading-4",
            active ? "opacity-80" : isLight ? "text-[#776f65]" : "text-slate-400"
          )}
        >
          {description}
        </p>
      </div>
    </button>
  );
}

function PreviewMetric({
  surfaceTheme,
  label,
  value,
  icon: Icon,
  mono = false
}: {
  surfaceTheme: SurfaceTheme;
  label: string;
  value: string;
  icon: typeof Sparkles;
  mono?: boolean;
}) {
  const isLight = surfaceTheme === "light";

  return (
    <div
      className={cn(
        "rounded-[16px] border px-3 py-2.5",
        isLight ? "border-[#e8e0d6] bg-white" : "border-white/10 bg-white/[0.03]"
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "inline-flex size-6 shrink-0 items-center justify-center rounded-full border",
            isLight ? "border-[#e0d7cc] bg-[#faf6f1] text-[#615a52]" : "border-white/10 bg-white/[0.05] text-slate-300"
          )}
        >
          <Icon className="h-3 w-3" />
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn("text-[10px] uppercase tracking-[0.16em]", isLight ? "text-[#8d8276]" : "text-slate-500")}>
            {label}
          </p>
          <p
            className={cn(
              "truncate text-[12px] font-medium leading-4",
              mono && "font-mono text-[12px]",
              isLight ? "text-[#171410]" : "text-white"
            )}
            title={value}
          >
            {value}
          </p>
        </div>
      </div>
    </div>
  );
}

function buildHeaderBadges(
  mode: WorkspaceWizardMode,
  plan: WorkspacePlan | null,
  isEditingWorkspace: boolean,
  basicStep?: WorkspaceCreateStep
) {
  const badges: Array<{
    id: string;
    label: string;
    tone: "muted" | "success" | "warning" | "danger";
  }> = [
    {
      id: "surface",
      label: isEditingWorkspace
        ? "Editing workspace"
        : mode === "basic"
          ? "Architect-assisted fast path"
          : "Architect co-design",
      tone: "muted"
    }
  ];

  if (!isEditingWorkspace && mode === "basic" && basicStep) {
    badges.push({
      id: "step",
      label: `Step ${getWorkspaceCreateStepIndex(basicStep) + 1} / 3 · ${getWorkspaceCreateStepLabel(basicStep)}`,
      tone: "muted"
    });
  }

  if (!plan) {
    return badges;
  }

  if (mode === "basic") {
    if (plan.intake.confirmations.length > 0) {
      badges.push({
        id: "confirmations",
        label: `${plan.intake.confirmations.length} decision${plan.intake.confirmations.length === 1 ? "" : "s"} needed`,
        tone: plan.intake.confirmations.length > 1 ? "warning" : "muted"
      });
    } else if (plan.intake.started) {
      badges.push({
        id: "draft",
        label: "Draft synced live",
        tone: "muted"
      });
    }

    return badges;
  }

  if (plan.intake.confirmations.length > 0) {
    badges.push({
      id: "confirmations",
      label: `${plan.intake.confirmations.length} decision${plan.intake.confirmations.length === 1 ? "" : "s"} needed`,
      tone: plan.intake.confirmations.length > 1 ? "warning" : "muted"
    });
  }

  badges.push({
    id: "stage",
    label: `Stage · ${getPlannerStageLabel(plan.stage)}`,
    tone: "muted" as const
  });

  badges.push({
    id: "readiness",
    label: `${plan.readinessScore}% drafted`,
    tone: plan.readinessScore >= 85 ? "success" : plan.readinessScore >= 45 ? "warning" : "muted"
  });

  badges.push({
    id: "status",
    label: `Status · ${plan.status}`,
    tone:
      plan.status === "blocked"
        ? "danger"
        : plan.status === "ready" || plan.status === "deployed"
          ? "success"
          : plan.status === "review"
            ? "warning"
            : "muted"
  });

  return badges;
}

function buildConversationMessages(plan: WorkspacePlan | null, pendingUserMessage: string | null) {
  const messages: WizardMessageRecord[] =
    plan?.conversation.map((message) => ({
      id: message.id,
      role: message.role,
      author:
        message.role === "assistant"
          ? "Architect"
          : message.role === "system"
            ? "Workspace Wizard"
            : message.author,
      text: message.text
    })) ?? [];

  if (pendingUserMessage?.trim()) {
    messages.push({
      id: "pending-user-message",
      role: "user",
      text: pendingUserMessage.trim(),
      status: "pending"
    });
  }

  return messages;
}
