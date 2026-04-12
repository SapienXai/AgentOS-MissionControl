"use client";

import { Bot, Columns2, LoaderCircle, Sparkles, X } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useWorkspaceWizardDraft, type WorkspaceWizardMode } from "@/hooks/use-workspace-wizard-draft";
import { createPlannerMessage } from "@/lib/openclaw/planner-core";
import {
  getPlannerStageLabel
} from "@/lib/openclaw/planner-presenters";
import type {
  MissionControlSnapshot,
  WorkspacePlan
} from "@/lib/agentos/contracts";
import {
  buildWorkspaceWizardPathPreview,
  inferWorkspaceWizardTemplate,
  resolveWorkspaceWizardName
} from "@/lib/openclaw/workspace-wizard-inference";
import { cn } from "@/lib/utils";

type SurfaceTheme = "dark" | "light";

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
      setBlueprintEditorFocus("workspace.name");
      setDocumentEditorPath("AGENTS.md");
    }

    onOpenChange(nextOpen);
  };

  const resolvedName = isEditingWorkspace
    ? wizard.plan?.workspace.name ?? editingWorkspace?.name ?? resolveWorkspaceWizardName(wizard.basicDraft)
    : resolveWorkspaceWizardName(wizard.basicDraft);
  const resolvedTemplate = isEditingWorkspace
    ? wizard.plan?.workspace.template ?? editingWorkspace?.bootstrap.template ?? inferWorkspaceWizardTemplate(`${wizard.basicDraft.goal}\n${wizard.basicDraft.source}`)
    : inferWorkspaceWizardTemplate(
        `${wizard.basicDraft.goal}\n${wizard.basicDraft.source}`
      );
  const workspacePath = isEditingWorkspace
    ? wizard.plan?.workspace.directory ?? editingWorkspace?.path ?? snapshot.diagnostics.workspaceRoot
    : buildWorkspaceWizardPathPreview(
        snapshot.diagnostics.workspaceRoot,
        wizard.basicDraft,
        wizard.sourceAnalysis
      );

  const headerBadges = useMemo(
    () => buildHeaderBadges(wizard.mode, wizard.plan, isEditingWorkspace),
    [isEditingWorkspace, wizard.mode, wizard.plan]
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
  const basicQuickSetup =
    !isEditingWorkspace && wizard.mode === "basic" ? (
      <BasicQuickStartCard
        surfaceTheme={surfaceTheme}
        name={wizard.basicDraft.name}
        source={wizard.basicDraft.source}
        onNameChange={wizard.setBasicName}
        onSourceChange={wizard.setBasicSource}
      />
    ) : null;

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

            <WorkspaceWizardDraftPane
              className="hidden lg:block"
              surfaceTheme={surfaceTheme}
              workspaceMode={isEditingWorkspace ? "edit" : "create"}
              mode={wizard.mode}
              snapshot={snapshot}
              basicQuickSetup={basicQuickSetup}
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
                basicQuickSetup={basicQuickSetup}
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
                  ? "Chat stays fast. Open the blueprint for details."
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
                      onClick={() => {
                        void wizard.switchMode("advanced");
                      }}
                      disabled={wizard.isCreating || wizard.isSending || wizard.isPlanLoading}
                    >
                      Advanced details
                    </Button>
                    <Button
                      size="sm"
                      className={
                        isLight
                          ? "rounded-full bg-[#161514] text-white hover:bg-[#26231f]"
                          : "rounded-full bg-cyan-300 text-slate-950 hover:bg-cyan-200"
                      }
                      onClick={() => void handleCreateWorkspace()}
                      disabled={wizard.isCreating || wizard.isSending || wizard.isPlanLoading || !hasDraftToCreate}
                    >
                      {wizard.isCreating ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                      Create workspace
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
  source,
  onNameChange,
  onSourceChange
}: {
  surfaceTheme: SurfaceTheme;
  name: string;
  source: string;
  onNameChange: (value: string) => void;
  onSourceChange: (value: string) => void;
}) {
  const isLight = surfaceTheme === "light";

  return (
    <div
      className={
        isLight
          ? "mx-auto w-full max-w-3xl rounded-2xl border border-[#e4ddd3] bg-white p-3.5 shadow-[0_18px_56px_rgba(56,47,38,0.06)]"
          : "mx-auto w-full max-w-3xl rounded-2xl border border-white/10 bg-white/[0.04] p-3.5 shadow-[0_18px_56px_rgba(0,0,0,0.24)]"
      }
    >
      <div className="flex items-start gap-3">
        <span
          className={
            isLight
              ? "inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-[#e4ddd3] bg-[#faf6f1] text-[#5e5750]"
              : "inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-slate-300"
          }
        >
          <Sparkles className="h-3.5 w-3.5" />
        </span>

        <div className="min-w-0 flex-1">
          <p className={isLight ? "text-[10px] uppercase tracking-[0.2em] text-[#8b7262]" : "text-[10px] uppercase tracking-[0.2em] text-slate-500"}>
            Quick details
          </p>
          <p className={isLight ? "mt-1 text-[12px] leading-5 text-[#70685f]" : "mt-1 text-[12px] leading-5 text-slate-300"}>
            Optional name and source live here. Architect can still infer both from the prompt.
          </p>

          <div className="mt-3 grid gap-2.5 md:grid-cols-2">
            <FieldBlock surfaceTheme={surfaceTheme} label="Workspace name">
              <Input
                value={name}
                onChange={(event) => onNameChange(event.target.value)}
                placeholder="Optional. Architect can infer it."
                className={
                  isLight
                    ? "border-[#e4ddd3] bg-[#fcfaf6] text-[#1c1916] placeholder:text-[#9b948c] focus-visible:ring-[#b8ada1]"
                    : "border-white/10 bg-[rgba(4,8,15,0.64)] text-slate-100 placeholder:text-slate-500 focus-visible:ring-cyan-300/60"
                }
              />
            </FieldBlock>
            <FieldBlock surfaceTheme={surfaceTheme} label="Source">
              <Input
                value={source}
                onChange={(event) => onSourceChange(event.target.value)}
                placeholder="Repo URL, website URL, or existing folder path"
                className={
                  isLight
                    ? "border-[#e4ddd3] bg-[#fcfaf6] text-[#1c1916] placeholder:text-[#9b948c] focus-visible:ring-[#b8ada1]"
                    : "border-white/10 bg-[rgba(4,8,15,0.64)] text-slate-100 placeholder:text-slate-500 focus-visible:ring-cyan-300/60"
                }
              />
            </FieldBlock>
          </div>
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

function buildHeaderBadges(mode: WorkspaceWizardMode, plan: WorkspacePlan | null, isEditingWorkspace: boolean) {
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
