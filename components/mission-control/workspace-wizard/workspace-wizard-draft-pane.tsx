"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  FileText,
  FolderOpen,
  GitBranch,
  Globe,
  LockKeyhole,
  Pencil,
  Rocket,
  Sparkles,
  Zap
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { OperationProgress } from "@/components/mission-control/operation-progress";
import type { WorkspaceBlueprintEditorFocus } from "@/components/mission-control/workspace-wizard/workspace-wizard-blueprint-editor";
import { ArchitectReadoutCard } from "@/components/mission-control/workspace-wizard/architect-readout-card";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { WorkspaceWizardMode } from "@/hooks/use-workspace-wizard-draft";
import {
  getPlannerSectionForStage,
  getPlannerSectionHealth,
  plannerSectionMeta,
  summarizePlannerSection,
  type PlannerSectionId
} from "@/lib/openclaw/planner-presenters";
import type {
  MissionControlSnapshot,
  OperationProgressSnapshot,
  WorkspaceCreateRules,
  WorkspacePlan,
  WorkspaceTemplate
} from "@/lib/openclaw/types";
import { WORKSPACE_TEMPLATE_OPTIONS } from "@/lib/openclaw/workspace-presets";
import {
  buildWorkspaceContextManifest,
  buildWorkspaceContextResourceSpecs,
  buildWorkspaceEditableDocuments,
  WORKSPACE_CONTEXT_CORE_PATHS,
  normalizeWorkspaceDocOverrides
} from "@/lib/openclaw/workspace-docs";
import type { WorkspaceWizardQuickSetupPreset } from "@/lib/openclaw/workspace-wizard-mappers";
import type { WorkspaceWizardSourceAnalysis } from "@/lib/openclaw/workspace-wizard-inference";
import { cn } from "@/lib/utils";

type SurfaceTheme = "dark" | "light";
type WorkspaceDraftMode = "create" | "edit";

const templateLabels = Object.fromEntries(
  WORKSPACE_TEMPLATE_OPTIONS.map((option) => [option.value, option.label])
) as Record<WorkspaceTemplate, string>;

type WorkspaceWizardNotice = {
  tone: "muted" | "warning";
  title: string;
  description: string;
};

type DraftSectionKey =
  | "notice"
  | "progress"
  | "setup-speed"
  | "architect-readout"
  | "summary"
  | "defaults"
  | "documents"
  | "readiness"
  | "deploy-review"
  | `section-${PlannerSectionId}`;

type WorkspaceWizardDraftPaneProps = {
  className?: string;
  surfaceTheme: SurfaceTheme;
  workspaceMode?: WorkspaceDraftMode;
  mode: WorkspaceWizardMode;
  snapshot: MissionControlSnapshot;
  basicQuickSetup?: ReactNode;
  plan: WorkspacePlan | null;
  resolvedName: string;
  resolvedTemplate: WorkspaceTemplate;
  sourceAnalysis: WorkspaceWizardSourceAnalysis;
  workspacePath: string;
  notice: WorkspaceWizardNotice | null;
  basicRules: WorkspaceCreateRules;
  basicPreset: WorkspaceWizardQuickSetupPreset;
  onOpenBlueprintEditor?: (focus?: WorkspaceBlueprintEditorFocus) => void;
  onOpenDocumentEditor?: (path: string) => void;
  onBasicPresetChange: (preset: WorkspaceWizardQuickSetupPreset) => void;
  onBasicRuleToggle: (
    rule: keyof Pick<WorkspaceCreateRules, "generateStarterDocs" | "generateMemory" | "kickoffMission">
  ) => void;
  progress: OperationProgressSnapshot | null;
};

export function WorkspaceWizardDraftPane({
  className,
  surfaceTheme,
  workspaceMode = "create",
  mode,
  snapshot,
  basicQuickSetup,
  plan,
  resolvedName,
  resolvedTemplate,
  sourceAnalysis,
  workspacePath,
  notice,
  basicRules,
  basicPreset,
  onOpenBlueprintEditor,
  onOpenDocumentEditor,
  onBasicPresetChange,
  onBasicRuleToggle,
  progress
}: WorkspaceWizardDraftPaneProps) {
  const isLight = surfaceTheme === "light";
  const sectionRefs = useRef<Partial<Record<DraftSectionKey, HTMLDivElement | null>>>({});
  const previousSnapshotRef = useRef<TrackedDraftSnapshot | null>(null);
  const [activeSection, setActiveSection] = useState<DraftSectionKey | null>(null);
  const openBlueprintEditor = (focus: WorkspaceBlueprintEditorFocus = "workspace.name") => {
    onOpenBlueprintEditor?.(focus);
  };
  const trackedSnapshot = useMemo(
    () =>
      buildTrackedDraftSnapshot({
        mode,
        plan,
        notice,
        progress,
        resolvedName,
        resolvedTemplate,
        basicRules,
        basicPreset,
        sourceAnalysis,
        workspacePath
      }),
    [basicPreset, basicRules, mode, notice, plan, progress, resolvedName, resolvedTemplate, sourceAnalysis, workspacePath]
  );
  const editableDocuments = useMemo(
    () =>
      plan
        ? buildWorkspaceEditableDocuments({
            name: plan.workspace.name || "Workspace",
            brief: plan.company.mission || plan.product.offer || undefined,
            template: plan.workspace.template,
            sourceMode: plan.workspace.sourceMode,
            rules: plan.workspace.rules,
            agents: plan.team.persistentAgents.filter((agent) => agent.enabled),
            docOverrides: plan.workspace.docOverrides,
            toolExamples: [],
            contextSources: plan.intake.sources
          })
        : [],
    [plan]
  );
  const editableDocumentsByPath = useMemo(
    () => new Map(editableDocuments.map((document) => [document.path, document])),
    [editableDocuments]
  );
  const contextManifest = useMemo(
    () =>
      buildWorkspaceContextManifest(plan?.workspace.template ?? resolvedTemplate, plan?.workspace.rules ?? basicRules),
    [basicRules, plan?.workspace.rules, plan?.workspace.template, resolvedTemplate]
  );

  useEffect(() => {
    const previousSnapshot = previousSnapshotRef.current;
    previousSnapshotRef.current = trackedSnapshot;

    if (!previousSnapshot) {
      return;
    }

    const nextActiveSection = resolveTrackedDraftSection(previousSnapshot, trackedSnapshot);

    if (!nextActiveSection) {
      return;
    }

    setActiveSection(nextActiveSection);
  }, [trackedSnapshot]);

  useEffect(() => {
    if (!activeSection) {
      return;
    }

    const target = sectionRefs.current[activeSection];

    if (target) {
      globalThis.requestAnimationFrame(() => {
        target.scrollIntoView({
          behavior: "smooth",
          block: "center"
        });
      });
    }

    const timeout = globalThis.setTimeout(() => {
      setActiveSection((current) => (current === activeSection ? null : current));
    }, 2200);

    return () => {
      globalThis.clearTimeout(timeout);
    };
  }, [activeSection]);

  return (
    <aside
      className={cn(
        "min-h-0 border-t lg:border-l lg:border-t-0",
        isLight ? "border-[#ebe5dd] bg-[#f7f2eb]" : "border-white/10 bg-[rgba(5,9,18,0.92)]",
        className
      )}
    >
      <ScrollArea className="h-full">
        <div className="space-y-4 p-4 md:p-5">
          <PaneHeader
            surfaceTheme={surfaceTheme}
            title={mode === "basic" ? "Workspace draft" : "Workspace blueprint"}
            subtitle={
              mode === "basic"
                ? "Live draft view. The fast path stays available while Architect fills in the details."
                : "Structured blueprint synced with the conversation."
            }
            action={
              plan && onOpenBlueprintEditor ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => openBlueprintEditor("workspace.name")}
                  className={
                    isLight
                      ? "rounded-full border-[#ddd6cb] bg-[#f7f2eb] text-[#403934] hover:bg-[#f1ebe3]"
                      : "rounded-full border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]"
                  }
                >
                  <Pencil className="mr-2 h-3.5 w-3.5" />
                  Edit details
                </Button>
              ) : null
            }
          />

          {workspaceMode === "create" ? (
            <>
              <TrackedSection
                sectionKey="setup-speed"
                activeSection={activeSection}
                surfaceTheme={surfaceTheme}
                register={(node) => {
                  sectionRefs.current["setup-speed"] = node;
                }}
              >
                <SetupSpeedCard
                  surfaceTheme={surfaceTheme}
                  mode={mode}
                  preset={basicPreset}
                  onPresetChange={onBasicPresetChange}
                  onOpenBlueprintEditor={openBlueprintEditor}
                />
              </TrackedSection>

              {basicQuickSetup ? <div className="space-y-3">{basicQuickSetup}</div> : null}
            </>
          ) : null}

          {notice ? (
            <TrackedSection
              sectionKey="notice"
              activeSection={activeSection}
              surfaceTheme={surfaceTheme}
              register={(node) => {
                sectionRefs.current.notice = node;
              }}
            >
              <div
                className={cn(
                  "rounded-[18px] border px-4 py-3",
                  notice.tone === "warning"
                    ? isLight
                      ? "border-amber-200 bg-amber-50 text-amber-900"
                      : "border-amber-400/25 bg-amber-400/10 text-amber-100"
                    : isLight
                      ? "border-[#e3ddd4] bg-white text-[#3f3933]"
                      : "border-white/10 bg-white/[0.04] text-slate-200"
                )}
              >
                <p className={cn("text-[11px] uppercase tracking-[0.18em]", isLight ? "text-[#9c9389]" : "text-slate-500")}>
                  {notice.title}
                </p>
                <p className="mt-1 text-[13px] leading-6">{notice.description}</p>
              </div>
            </TrackedSection>
          ) : null}

          {progress ? (
            <TrackedSection
              sectionKey="progress"
              activeSection={activeSection}
              surfaceTheme={surfaceTheme}
              register={(node) => {
                sectionRefs.current.progress = node;
              }}
            >
              <OperationProgress
                progress={progress}
                className={cn(
                  isLight
                    ? "border-[#e5ded3] bg-white text-slate-900 [&_p]:text-inherit"
                    : "border-white/10 bg-slate-950/50"
                )}
              />
            </TrackedSection>
          ) : null}

          {mode === "basic" ? (
            <div className="space-y-3">
              {plan ? (
                <TrackedSection
                  sectionKey="architect-readout"
                  activeSection={activeSection}
                  surfaceTheme={surfaceTheme}
                  register={(node) => {
                    sectionRefs.current["architect-readout"] = node;
                  }}
                >
                  <ArchitectReadoutCard
                    key={plan.updatedAt}
                    surfaceTheme={surfaceTheme}
                    plan={plan}
                    variant="panel"
                    onOpenBlueprintEditor={openBlueprintEditor}
                    onOpenDocumentEditor={onOpenDocumentEditor}
                  />
                </TrackedSection>
              ) : null}

              <TrackedSection sectionKey="summary" activeSection={activeSection} surfaceTheme={surfaceTheme} register={(node) => {
                sectionRefs.current.summary = node;
              }}>
                <BasicSummaryCard
                  surfaceTheme={surfaceTheme}
                  resolvedName={resolvedName}
                  resolvedTemplate={resolvedTemplate}
                  sourceAnalysis={sourceAnalysis}
                  workspacePath={workspacePath}
                  workspaceRoot={snapshot.diagnostics.workspaceRoot}
                  summaryLabel={
                    plan ? "Architect refreshed the draft." : "Resolved from quick setup."
                  }
                  onOpenBlueprintEditor={openBlueprintEditor}
                />
              </TrackedSection>

              <TrackedSection sectionKey="defaults" activeSection={activeSection} surfaceTheme={surfaceTheme} register={(node) => {
                sectionRefs.current.defaults = node;
              }}>
                <div
                  className={cn(
                    "rounded-[22px] border p-4",
                    isLight ? "border-[#e5ddd2] bg-white" : "border-white/10 bg-white/[0.04]"
                  )}
                >
                  <p className={cn("text-[11px] uppercase tracking-[0.18em]", isLight ? "text-[#a0978b]" : "text-slate-500")}>
                    Fast-path defaults
                  </p>
                  <BasicSetupCard
                    surfaceTheme={surfaceTheme}
                    plan={plan}
                    template={resolvedTemplate}
                    rules={basicRules}
                    preset={basicPreset}
                    onRuleToggle={onBasicRuleToggle}
                    onOpenBlueprintEditor={openBlueprintEditor}
                    onOpenDocumentEditor={onOpenDocumentEditor}
                  />
                </div>
              </TrackedSection>
            </div>
          ) : plan ? (
            <div className="space-y-3">
              <TrackedSection sectionKey="readiness" activeSection={activeSection} surfaceTheme={surfaceTheme} register={(node) => {
                sectionRefs.current.readiness = node;
              }}>
                <button
                  type="button"
                  onClick={() => openBlueprintEditor("deploy.blockers")}
                  className={cn(
                    "w-full rounded-[22px] border p-4 text-left transition-colors",
                    isLight
                      ? "border-[#e5ddd2] bg-white hover:border-[#d9ccbf] hover:bg-[#fdfbf7]"
                      : "border-white/10 bg-white/[0.04] hover:border-white/15 hover:bg-white/[0.06]"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className={cn("text-[11px] uppercase tracking-[0.18em]", isLight ? "text-[#a0978b]" : "text-slate-500")}>Readiness</p>
                      <p className={cn("mt-1 text-[28px] font-semibold tracking-[-0.03em]", isLight ? "text-[#181612]" : "text-white")}>
                        {plan.readinessScore}%
                      </p>
                      <p className={cn("text-[13px] leading-6", isLight ? "text-[#6e665d]" : "text-slate-300")}>{plan.architectSummary}</p>
                    </div>
                    <span
                      className={cn(
                        "inline-flex size-10 items-center justify-center rounded-full border",
                        isLight
                          ? "border-[#e5ddd2] bg-[#f5f0e8] text-[#6a635b]"
                          : "border-white/10 bg-white/[0.05] text-slate-300"
                      )}
                      >
                        <Bot className="h-4 w-4" />
                      </span>
                    </div>
                </button>
              </TrackedSection>

              {plannerSectionMeta.map((section) => {
                const health = getPlannerSectionHealth(plan, section.id);
                const Icon = section.icon;
                const sectionKey = `section-${section.id}` as const;

                return (
                  <TrackedSection
                    key={section.id}
                    sectionKey={sectionKey}
                    activeSection={activeSection}
                    surfaceTheme={surfaceTheme}
                    register={(node) => {
                      sectionRefs.current[sectionKey] = node;
                    }}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        openBlueprintEditor(
                          section.id === "company"
                            ? "company.mission"
                            : section.id === "product"
                              ? "product.offer"
                              : section.id === "workspace"
                                ? "workspace.name"
                                : section.id === "team"
                                  ? "team.maxParallelRuns"
                                  : "deploy.blockers"
                        )
                      }
                      className={cn(
                        "w-full rounded-[22px] border p-4 text-left transition-colors",
                        isLight
                          ? "border-[#e5ddd2] bg-white hover:border-[#d9ccbf] hover:bg-[#fdfbf7]"
                          : "border-white/10 bg-white/[0.04] hover:border-white/15 hover:bg-white/[0.06]"
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={cn(
                            "inline-flex size-9 shrink-0 items-center justify-center rounded-full border",
                            isLight
                              ? "border-[#e7e0d6] bg-[#faf6f1] text-[#5e5750]"
                              : "border-white/10 bg-white/[0.05] text-slate-300"
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </span>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className={cn("text-[14px] font-semibold", isLight ? "text-[#171410]" : "text-white")}>{section.label}</p>
                            <StatusPill surfaceTheme={surfaceTheme} tone={health.variant} label={health.label} />
                          </div>
                          <p className={cn("mt-1 text-[13px] leading-6", isLight ? "text-[#70685f]" : "text-slate-300")}>
                            {summarizePlannerSection(plan, section.id)}
                          </p>
                        </div>
                      </div>
                    </button>
                  </TrackedSection>
                );
              })}

              <TrackedSection
                sectionKey="documents"
                activeSection={activeSection}
                surfaceTheme={surfaceTheme}
                register={(node) => {
                  sectionRefs.current.documents = node;
                }}
              >
                <div
                  className={cn(
                    "rounded-[22px] border p-4",
                    isLight ? "border-[#e5ddd2] bg-white" : "border-white/10 bg-white/[0.04]"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <FileText className={cn("h-4 w-4", isLight ? "text-[#5f5952]" : "text-slate-300")} />
                    <p className={cn("text-[14px] font-semibold", isLight ? "text-[#171410]" : "text-white")}>Documents</p>
                  </div>

                  <div className="mt-3 space-y-3">
                    {contextManifest.sections.map((section) => {
                      const sectionDocuments = section.resources
                        .map((resource) => editableDocumentsByPath.get(resource.relativePath))
                        .filter((document): document is (typeof editableDocuments)[number] => Boolean(document));

                      return (
                        <div
                          key={section.id}
                          className={cn(
                            "rounded-[18px] border px-3 py-3",
                            isLight ? "border-[#e8e0d6] bg-[#faf6f1]" : "border-white/10 bg-white/[0.03]"
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className={cn("text-[12px] font-semibold", isLight ? "text-[#171410]" : "text-white")}>
                                {section.title}
                              </p>
                              <p className={cn("mt-1 text-[11px] leading-5", isLight ? "text-[#7a7168]" : "text-slate-400")}>
                                {section.description}
                              </p>
                            </div>
                            <StatusPill
                              surfaceTheme={surfaceTheme}
                              tone={section.enabled ? "success" : "muted"}
                              label={section.enabled ? "Included" : "Skipped"}
                            />
                          </div>

                          {sectionDocuments.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {sectionDocuments.map((document) => (
                                <FileToken
                                  key={document.path}
                                  surfaceTheme={surfaceTheme}
                                  label={document.path}
                                  tone={
                                    document.generated
                                      ? document.overridden
                                        ? "success"
                                        : "default"
                                      : "accent"
                                  }
                                  interactive={Boolean(onOpenDocumentEditor)}
                                  onClick={onOpenDocumentEditor ? () => onOpenDocumentEditor(document.path) : undefined}
                                />
                              ))}
                            </div>
                          ) : (
                            <p className={cn("mt-2 text-[11px] leading-5", isLight ? "text-[#7a7168]" : "text-slate-400")}>
                              Disabled by the current workspace rules.
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {onOpenDocumentEditor ? (
                    <p className={cn("mt-2 text-[11px] leading-5", isLight ? "text-[#7a7168]" : "text-slate-400")}>
                      {workspaceMode === "edit"
                        ? "These are the current workspace files grouped by the canonical context manifest."
                        : "These are the scaffold documents that will be written for this workspace."}
                    </p>
                  ) : null}
                </div>
              </TrackedSection>

              <TrackedSection sectionKey="deploy-review" activeSection={activeSection} surfaceTheme={surfaceTheme} register={(node) => {
                sectionRefs.current["deploy-review"] = node;
              }}>
                <button
                  type="button"
                  onClick={() => openBlueprintEditor("deploy.blockers")}
                  className={cn(
                    "w-full rounded-[22px] border p-4 text-left transition-colors",
                    isLight
                      ? "border-[#e5ddd2] bg-white hover:border-[#d9ccbf] hover:bg-[#fdfbf7]"
                      : "border-white/10 bg-white/[0.04] hover:border-white/15 hover:bg-white/[0.06]"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Rocket className={cn("h-4 w-4", isLight ? "text-[#5f5952]" : "text-slate-300")} />
                    <p className={cn("text-[14px] font-semibold", isLight ? "text-[#171410]" : "text-white")}>Deploy review</p>
                  </div>

                  {plan.deploy.blockers.length > 0 ? (
                    <ReadinessList
                      surfaceTheme={surfaceTheme}
                      title="Blockers"
                      tone="danger"
                      items={plan.deploy.blockers}
                    />
                  ) : null}

                  {plan.deploy.warnings.length > 0 ? (
                    <ReadinessList
                      surfaceTheme={surfaceTheme}
                      title="Warnings"
                      tone="warning"
                      items={plan.deploy.warnings}
                    />
                  ) : null}

                  {plan.deploy.blockers.length === 0 && plan.deploy.warnings.length === 0 ? (
                    <p className={cn("mt-3 text-[13px] leading-6", isLight ? "text-[#70685f]" : "text-slate-300")}>
                      Architect has not surfaced blockers or warnings yet. Request review when the blueprint feels directionally right.
                    </p>
                  ) : null}
                </button>
              </TrackedSection>
            </div>
          ) : (
            <div
              className={cn(
                "rounded-[22px] border border-dashed p-5",
                isLight ? "border-[#ddd5ca] bg-white/80" : "border-white/10 bg-white/[0.04]"
              )}
            >
              <p className={cn("text-[14px] font-medium", isLight ? "text-[#211d19]" : "text-white")}>Architect is preparing the blueprint.</p>
              <p className={cn("mt-1 text-[13px] leading-6", isLight ? "text-[#776f65]" : "text-slate-300")}>
                Once the first plan is ready, this pane will start reflecting the structured workspace draft.
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}

type TrackedDraftSnapshot = {
  mode: WorkspaceWizardMode;
  noticeSignature: string;
  progressSignature: string;
    basic: {
      architectSignature: string;
      summarySignature: string;
      defaultsSignature: string;
    };
  advanced: {
    stage: WorkspacePlan["stage"] | null;
    readinessSignature: string;
    deploySignature: string;
    sectionSignatures: Record<PlannerSectionId, string>;
  };
};

function buildTrackedDraftSnapshot({
  mode,
  plan,
  notice,
  progress,
  resolvedName,
  resolvedTemplate,
  basicRules,
  basicPreset,
  sourceAnalysis,
  workspacePath
}: Pick<
  WorkspaceWizardDraftPaneProps,
  | "mode"
  | "plan"
  | "notice"
  | "progress"
  | "resolvedName"
  | "resolvedTemplate"
  | "basicRules"
  | "basicPreset"
  | "sourceAnalysis"
  | "workspacePath"
>): TrackedDraftSnapshot {
  return {
    mode,
    noticeSignature: notice ? `${notice.tone}:${notice.title}:${notice.description}` : "",
    progressSignature: progress ? JSON.stringify(progress) : "",
    basic: {
      architectSignature: plan
        ? [
            plan.architectSummary,
            plan.company.name,
            plan.company.mission,
            plan.company.targetCustomer,
            plan.workspace.template,
            JSON.stringify(plan.workspace.rules),
            plan.intake.sources
              .map((source) => `${source.kind}:${source.status}:${source.label}:${Math.round((source.confidence ?? 0) * 100)}`)
              .join("|"),
            plan.intake.inferences
              .map((inference) => `${inference.section}:${inference.status}:${inference.label}:${inference.value}`)
              .join("|"),
            plan.intake.confirmations.join("|")
          ].join(":")
        : "",
      summarySignature: [
        resolvedName,
        resolvedTemplate,
        sourceAnalysis.kind,
        sourceAnalysis.label,
        sourceAnalysis.hint,
        sourceAnalysis.repoUrl ?? "",
        sourceAnalysis.existingPath ?? "",
        sourceAnalysis.websiteUrl ?? "",
        workspacePath
      ].join(":"),
      defaultsSignature: `${basicPreset}:${basicRules.generateStarterDocs}:${basicRules.generateMemory}:${basicRules.kickoffMission}`
    },
    advanced: {
      stage: plan?.stage ?? null,
      readinessSignature: plan ? `${plan.readinessScore}:${plan.architectSummary}` : "",
      deploySignature: plan
        ? `${plan.intake.reviewRequested}:${plan.deploy.blockers.join("|")}:${plan.deploy.warnings.join("|")}`
        : "",
      sectionSignatures: Object.fromEntries(
        plannerSectionMeta.map((section) => [
          section.id,
          plan
            ? `${getPlannerSectionHealth(plan, section.id).label}:${getPlannerSectionHealth(plan, section.id).variant}:${summarizePlannerSection(plan, section.id)}`
            : ""
        ])
      ) as Record<PlannerSectionId, string>
    }
  };
}

function resolveTrackedDraftSection(
  previousSnapshot: TrackedDraftSnapshot,
  nextSnapshot: TrackedDraftSnapshot
): DraftSectionKey | null {
  if (previousSnapshot.mode !== nextSnapshot.mode) {
    return nextSnapshot.mode === "basic"
      ? nextSnapshot.basic.architectSignature
        ? "architect-readout"
        : "summary"
      : nextSnapshot.advanced.stage
        ? (`section-${getPlannerSectionForStage(nextSnapshot.advanced.stage)}` as DraftSectionKey)
        : "readiness";
  }

  if (previousSnapshot.noticeSignature !== nextSnapshot.noticeSignature && nextSnapshot.noticeSignature) {
    return "notice";
  }

  if (previousSnapshot.progressSignature !== nextSnapshot.progressSignature && nextSnapshot.progressSignature) {
    return "progress";
  }

  if (nextSnapshot.mode === "basic") {
    if (
      previousSnapshot.basic.architectSignature !== nextSnapshot.basic.architectSignature &&
      nextSnapshot.basic.architectSignature
    ) {
      return "architect-readout";
    }

    if (previousSnapshot.basic.summarySignature !== nextSnapshot.basic.summarySignature) {
      return "summary";
    }

    if (previousSnapshot.basic.defaultsSignature !== nextSnapshot.basic.defaultsSignature) {
      return "defaults";
    }

    return null;
  }

  if (previousSnapshot.advanced.deploySignature !== nextSnapshot.advanced.deploySignature && nextSnapshot.advanced.deploySignature) {
    return "deploy-review";
  }

  if (previousSnapshot.advanced.stage !== nextSnapshot.advanced.stage && nextSnapshot.advanced.stage) {
    return `section-${getPlannerSectionForStage(nextSnapshot.advanced.stage)}`;
  }

  if (
    previousSnapshot.advanced.readinessSignature !== nextSnapshot.advanced.readinessSignature &&
    nextSnapshot.advanced.readinessSignature
  ) {
    return "readiness";
  }

  for (const section of plannerSectionMeta) {
    if (previousSnapshot.advanced.sectionSignatures[section.id] !== nextSnapshot.advanced.sectionSignatures[section.id]) {
      return `section-${section.id}`;
    }
  }

  return null;
}

function TrackedSection({
  sectionKey,
  activeSection,
  surfaceTheme,
  register,
  children
}: {
  sectionKey: DraftSectionKey;
  activeSection: DraftSectionKey | null;
  surfaceTheme: SurfaceTheme;
  register: (node: HTMLDivElement | null) => void;
  children: ReactNode;
}) {
  const isActive = activeSection === sectionKey;
  const isLight = surfaceTheme === "light";

  return (
    <div
      ref={register}
      className={cn(
        "scroll-mt-6 rounded-[26px] transition-all duration-500",
        isActive &&
          (isLight
            ? "ring-2 ring-[#d8b184]/70 shadow-[0_0_0_1px_rgba(216,177,132,0.18),0_18px_36px_rgba(102,78,47,0.16)]"
            : "ring-2 ring-cyan-300/45 shadow-[0_0_0_1px_rgba(103,232,249,0.14),0_18px_36px_rgba(6,182,212,0.16)]")
      )}
    >
      {children}
    </div>
  );
}

function PaneHeader({
  surfaceTheme,
  title,
  subtitle,
  action
}: {
  surfaceTheme: SurfaceTheme;
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  const isLight = surfaceTheme === "light";

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className={cn("text-[11px] uppercase tracking-[0.18em]", isLight ? "text-[#8b7262]" : "text-slate-500")}>{title}</p>
        <p className={cn("mt-1 text-[13px] leading-6", isLight ? "text-[#705b4d]" : "text-slate-300")}>{subtitle}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function BasicSummaryCard({
  surfaceTheme,
  resolvedName,
  resolvedTemplate,
  sourceAnalysis,
  workspacePath,
  workspaceRoot,
  summaryLabel,
  onOpenBlueprintEditor
}: {
  surfaceTheme: SurfaceTheme;
  resolvedName: string;
  resolvedTemplate: WorkspaceTemplate;
  sourceAnalysis: WorkspaceWizardSourceAnalysis;
  workspacePath: string;
  workspaceRoot: string;
  summaryLabel: string;
  onOpenBlueprintEditor?: (focus?: WorkspaceBlueprintEditorFocus) => void;
}) {
  const isLight = surfaceTheme === "light";

  return (
    <div className={cn("rounded-[22px] border p-4", isLight ? "border-[#e5ddd2] bg-white" : "border-white/10 bg-white/[0.04]")}>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "inline-flex size-9 shrink-0 items-center justify-center rounded-full border",
            isLight ? "border-[#e7e0d6] bg-[#faf6f1] text-[#5e5750]" : "border-white/10 bg-white/[0.05] text-slate-300"
          )}
        >
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn("text-[11px] uppercase tracking-[0.18em]", isLight ? "text-[#a0978b]" : "text-slate-500")}>
            Fast-path snapshot
          </p>
          <p className={cn("mt-1 text-[12px] leading-5", isLight ? "text-[#776f65]" : "text-slate-400")}>
            {summaryLabel}
          </p>

          <div className="mt-4 space-y-2">
            <SummaryMetric
              surfaceTheme={surfaceTheme}
              label="Name"
              value={resolvedName}
              icon={Sparkles}
              onClick={() => onOpenBlueprintEditor?.("workspace.name")}
            />
            <SummaryMetric
              surfaceTheme={surfaceTheme}
              label="Template"
              value={templateLabels[resolvedTemplate]}
              icon={Zap}
              onClick={() => onOpenBlueprintEditor?.("workspace.template")}
            />
            <SummaryMetric
              surfaceTheme={surfaceTheme}
              label="Source"
              value={sourceAnalysis.label}
              icon={sourceAnalysis.kind === "clone" ? GitBranch : sourceAnalysis.kind === "website" ? Globe : FolderOpen}
              onClick={() => onOpenBlueprintEditor?.("workspace.sourceMode")}
            />
            <SummaryMetric
              surfaceTheme={surfaceTheme}
              label="Path"
              value={workspacePath}
              icon={FolderOpen}
              mono
              title={`Root: ${workspaceRoot}`}
              onClick={() => onOpenBlueprintEditor?.("workspace.directory")}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryMetric({
  surfaceTheme,
  label,
  value,
  icon: Icon,
  detail,
  mono = false,
  title,
  onClick
}: {
  surfaceTheme: SurfaceTheme;
  label: string;
  value: string;
  icon: typeof Sparkles;
  detail?: string;
  mono?: boolean;
  title?: string;
  onClick?: () => void;
}) {
  const isLight = surfaceTheme === "light";
  const isInteractive = Boolean(onClick);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-[14px] border px-3 py-2.5 text-left transition-colors",
        isLight ? "border-[#e8e0d6] bg-[#faf6f1]" : "border-white/10 bg-white/[0.03]",
        isInteractive &&
          (isLight
            ? "cursor-pointer hover:border-[#d9b78b] hover:bg-[#f7efe3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d9b78b]/60"
            : "cursor-pointer hover:border-cyan-300/30 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/30")
      )}
      title={title}
    >
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "inline-flex size-6 shrink-0 items-center justify-center rounded-full border",
            isLight ? "border-[#e0d7cc] bg-white text-[#615a52]" : "border-white/10 bg-white/[0.05] text-slate-300"
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
              isLight ? "text-[#171410]" : "text-white",
              mono && "font-mono text-[12px]"
            )}
            title={value}
          >
            {value}
          </p>
        </div>

        {isInteractive ? <Pencil className={cn("h-3.5 w-3.5 shrink-0", isLight ? "text-[#8f8377]" : "text-slate-400")} /> : null}
        {detail ? (
          <span className={cn("shrink-0 text-[10px] leading-4", isLight ? "text-[#776f65]" : "text-slate-400")}>{detail}</span>
        ) : null}
      </div>
    </button>
  );
}

function StatusPill({
  surfaceTheme,
  tone,
  label
}: {
  surfaceTheme: SurfaceTheme;
  tone: "muted" | "success" | "warning" | "danger";
  label: string;
}) {
  const isLight = surfaceTheme === "light";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em]",
        tone === "muted" && (isLight ? "border-[#e4ddd3] bg-[#f7f2eb] text-[#746b61]" : "border-white/10 bg-white/[0.05] text-slate-300"),
        tone === "success" && "border-emerald-200 bg-emerald-50 text-emerald-700",
        tone === "warning" && "border-amber-200 bg-amber-50 text-amber-700",
        tone === "danger" && "border-rose-200 bg-rose-50 text-rose-700"
      )}
    >
      {label}
    </span>
  );
}

type BasicRuleToggleKey = keyof Pick<
  WorkspaceCreateRules,
  "generateStarterDocs" | "generateMemory" | "kickoffMission"
>;

function BasicSetupCard({
  surfaceTheme,
  plan,
  template,
  rules,
  preset,
  onRuleToggle,
  onOpenBlueprintEditor,
  onOpenDocumentEditor
}: {
  surfaceTheme: SurfaceTheme;
  plan: WorkspacePlan | null;
  template: WorkspaceTemplate;
  rules: WorkspaceCreateRules;
  preset: WorkspaceWizardQuickSetupPreset;
  onRuleToggle: (rule: BasicRuleToggleKey) => void;
  onOpenBlueprintEditor?: (focus?: WorkspaceBlueprintEditorFocus) => void;
  onOpenDocumentEditor?: (path: string) => void;
}) {
  const isLight = surfaceTheme === "light";
  const contextManifest = buildWorkspaceContextManifest(template, rules);
  const toggleItems = buildBasicSetupToggleItems(template, rules);
  const overriddenFilePaths = useMemo(
    () => new Set(normalizeWorkspaceDocOverrides(plan?.workspace.docOverrides).map((entry) => entry.path)),
    [plan?.workspace.docOverrides]
  );
  const hasPlan = Boolean(plan);
  const presetSummary =
    preset === "fastest"
      ? "Core files only."
      : preset === "custom"
        ? "Only the extras you kept."
        : "Starter docs, memory, kickoff.";

  return (
    <div className="mt-3 space-y-4">
      <div className="flex items-center justify-between gap-2">
        {preset === "custom" ? <StatusPill surfaceTheme={surfaceTheme} tone="muted" label="Custom mix" /> : <span />}
        {onOpenBlueprintEditor ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onOpenBlueprintEditor("workspace.ruleGenerateStarterDocs")}
            className={
              isLight
                ? "rounded-full border-[#ddd6cb] bg-[#f7f2eb] text-[#403934] hover:bg-[#f1ebe3]"
                : "rounded-full border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]"
            }
          >
            <Pencil className="mr-2 h-3.5 w-3.5" />
            Edit section
          </Button>
        ) : null}
      </div>

      <div className="space-y-2">
        {toggleItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={item.rule ? () => onRuleToggle(item.rule) : undefined}
            disabled={!item.rule}
            className={cn(
              "w-full rounded-[18px] border px-3 py-3 text-left transition-colors",
              isLight ? "border-[#e8e0d6] bg-[#faf6f1]" : "border-white/10 bg-white/[0.03]",
              item.rule
                ? isLight
                  ? "hover:border-[#d8c9ba] hover:bg-[#f6efe6]"
                  : "hover:border-white/15 hover:bg-white/[0.05]"
                : "cursor-default"
            )}
          >
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-md border",
                  item.checked
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
                <div className="flex flex-wrap items-center gap-2">
                  <p className={cn("text-[13px] font-medium", isLight ? "text-[#171410]" : "text-white")}>
                    {item.title}
                  </p>
                  {item.locked ? (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.16em]",
                        isLight
                          ? "border-[#e0d7cc] bg-white text-[#7a7168]"
                          : "border-white/10 bg-white/[0.05] text-slate-400"
                      )}
                    >
                      <LockKeyhole className="h-3 w-3" />
                      Required
                    </span>
                  ) : null}
                </div>
                <p className={cn("mt-1 text-[12px] leading-5", isLight ? "text-[#776f65]" : "text-slate-400")}>
                  {item.description}
                </p>
                {item.files.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {item.files.map((file) => (
                      <FileToken key={file} surfaceTheme={surfaceTheme} label={file} />
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </button>
        ))}
      </div>

      <div
        className={cn(
          "rounded-[18px] border px-3 py-3",
          isLight ? "border-[#e8e0d6] bg-[#faf6f1]" : "border-white/10 bg-white/[0.03]"
        )}
      >
        <div className="flex items-center gap-2">
          <FileText className={cn("h-4 w-4", isLight ? "text-[#5f5952]" : "text-slate-300")} />
          <p className={cn("text-[12px] uppercase tracking-[0.16em]", isLight ? "text-[#8d8276]" : "text-slate-500")}>
            Canonical manifest
          </p>
        </div>
        <div className="mt-3 space-y-3">
          {contextManifest.sections.map((section) => (
            <div
              key={section.id}
              className={cn(
                "rounded-[16px] border px-3 py-3",
                isLight ? "border-[#e2d9cc] bg-white" : "border-white/10 bg-white/[0.02]"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={cn("text-[12px] font-semibold", isLight ? "text-[#171410]" : "text-white")}>
                    {section.title}
                  </p>
                  <p className={cn("mt-1 text-[11px] leading-5", isLight ? "text-[#7b7269]" : "text-slate-400")}>
                    {section.description}
                  </p>
                </div>
                <StatusPill
                  surfaceTheme={surfaceTheme}
                  tone={section.enabled ? "success" : "muted"}
                  label={section.enabled ? "Included" : "Skipped"}
                />
              </div>
              {section.resources.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {section.resources.map((resource) => (
                    <FileToken
                      key={resource.relativePath}
                      surfaceTheme={surfaceTheme}
                      label={resource.label}
                      tone={overriddenFilePaths.has(resource.relativePath) ? "success" : "default"}
                      interactive={Boolean(hasPlan && onOpenDocumentEditor)}
                      onClick={
                        hasPlan && onOpenDocumentEditor
                          ? () => onOpenDocumentEditor(resource.relativePath)
                          : undefined
                      }
                    />
                  ))}
                </div>
              ) : (
                <p className={cn("mt-2 text-[11px] leading-5", isLight ? "text-[#7a7168]" : "text-slate-400")}>
                  Disabled by the current workspace rules.
                </p>
              )}
            </div>
          ))}
        </div>
        {rules.kickoffMission ? <FileToken surfaceTheme={surfaceTheme} label="Kickoff mission" tone="accent" /> : null}
        {hasPlan && onOpenDocumentEditor ? (
          <p className={cn("mt-2 text-[11px] leading-5", isLight ? "text-[#7a7168]" : "text-slate-400")}>
            Click a file chip to edit its scaffold or override.
          </p>
        ) : null}
      </div>

      <p className={cn("text-[13px] leading-6", isLight ? "text-[#70685f]" : "text-slate-300")}>
        {presetSummary} Switch to Advanced later if you need more control.
      </p>
    </div>
  );
}

function SetupSpeedCard({
  surfaceTheme,
  mode,
  preset,
  onPresetChange,
  onOpenBlueprintEditor
}: {
  surfaceTheme: SurfaceTheme;
  mode: WorkspaceWizardMode;
  preset: WorkspaceWizardQuickSetupPreset;
  onPresetChange: (preset: WorkspaceWizardQuickSetupPreset) => void;
  onOpenBlueprintEditor?: (focus?: WorkspaceBlueprintEditorFocus) => void;
}) {
  const isLight = surfaceTheme === "light";

  return (
    <div
      className={cn(
        "rounded-xl border p-3",
        isLight ? "border-[#e5ddd2] bg-white" : "border-white/10 bg-white/[0.04]"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={cn("text-[10px] uppercase tracking-[0.18em]", isLight ? "text-[#a0978b]" : "text-slate-500")}>
            Setup speed
          </p>
          <p className={cn("mt-1 text-[11px] leading-5", isLight ? "text-[#70685f]" : "text-slate-300")}>
            {mode === "basic"
              ? "Choose how much scaffold the fast path should write."
              : "These presets also update the bootstrap rules."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {preset === "custom" ? <StatusPill surfaceTheme={surfaceTheme} tone="muted" label="Custom" /> : null}
          {onOpenBlueprintEditor ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onOpenBlueprintEditor("workspace.ruleGenerateStarterDocs")}
              className={
                isLight
                  ? "rounded-full border-[#ddd6cb] bg-[#f7f2eb] text-[#403934] hover:bg-[#f1ebe3]"
                  : "rounded-full border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]"
              }
            >
              <Pencil className="mr-2 h-3.5 w-3.5" />
              Edit
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <PresetButton
          surfaceTheme={surfaceTheme}
          active={preset === "standard"}
          title="Standard"
          description="Docs, memory, kickoff"
          onClick={() => onPresetChange("standard")}
        />
        <PresetButton
          surfaceTheme={surfaceTheme}
          active={preset === "fastest"}
          title="Fastest setup"
          description="Core files only"
          onClick={() => onPresetChange("fastest")}
        />
      </div>
    </div>
  );
}

function PresetButton({
  surfaceTheme,
  active,
  title,
  description,
  onClick
}: {
  surfaceTheme: SurfaceTheme;
  active: boolean;
  title: string;
  description: string;
  onClick: () => void;
}) {
  const isLight = surfaceTheme === "light";

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-[14px] border px-3 py-2 text-left transition-colors",
        active
          ? isLight
            ? "border-[#1f1b17] bg-[#1f1b17] text-white"
            : "border-cyan-300 bg-cyan-300/15 text-cyan-50"
          : isLight
            ? "border-[#e8e0d6] bg-[#faf6f1] text-[#171410] hover:border-[#d8c9ba] hover:bg-[#f6efe6]"
            : "border-white/10 bg-white/[0.03] text-white hover:border-white/15 hover:bg-white/[0.05]"
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

function FileToken({
  surfaceTheme,
  label,
  tone = "default",
  interactive = false,
  onClick
}: {
  surfaceTheme: SurfaceTheme;
  label: string;
  tone?: "default" | "accent" | "success";
  interactive?: boolean;
  onClick?: () => void;
}) {
  const toneClassName =
    tone === "accent"
      ? surfaceTheme === "light"
        ? "border-[#d8b184] bg-[#f8efe3] text-[#7c5a34]"
        : "border-cyan-300/30 bg-cyan-300/10 text-cyan-100"
      : tone === "success"
        ? surfaceTheme === "light"
          ? "border-emerald-300 bg-emerald-50 text-emerald-900"
          : "border-emerald-300/30 bg-emerald-300/12 text-emerald-100"
        : surfaceTheme === "light"
          ? "border-[#e4ddd3] bg-white text-[#6c645b]"
          : "border-white/10 bg-white/[0.05] text-slate-300";

  const className = cn(
    "inline-flex items-center rounded-full border px-2.5 py-1 font-mono text-[10px] transition-colors",
    toneClassName,
    interactive
      ? tone === "success"
        ? surfaceTheme === "light"
          ? "cursor-pointer hover:border-emerald-400 hover:bg-emerald-100"
          : "cursor-pointer hover:border-emerald-300/45 hover:bg-emerald-300/16"
        : surfaceTheme === "light"
          ? "cursor-pointer hover:border-[#d8c8ba] hover:bg-[#f6efe6]"
          : "cursor-pointer hover:border-white/15 hover:bg-white/[0.08]"
      : ""
  );

  if (interactive) {
    return (
      <button type="button" onClick={onClick} aria-label={`Edit ${label}`} className={className}>
        <Pencil className="mr-1 h-3 w-3" />
        {label}
      </button>
    );
  }

  return (
    <span className={className}>
      <Check className="mr-1 h-3 w-3" />
      {label}
    </span>
  );
}

function buildBasicSetupToggleItems(
  template: WorkspaceTemplate,
  rules: WorkspaceCreateRules
) {
  const contextResourceSpecs = buildWorkspaceContextResourceSpecs(template);
  const corePathSet = new Set<string>(WORKSPACE_CONTEXT_CORE_PATHS);
  const coreFiles = contextResourceSpecs
    .filter((resource) => corePathSet.has(resource.relativePath))
    .map((resource) => resource.label);
  const starterFiles = contextResourceSpecs
    .filter((resource) => resource.relativePath.startsWith("docs/") || resource.relativePath.startsWith("deliverables/"))
    .map((resource) => resource.label);
  const memoryFiles = contextResourceSpecs
    .filter((resource) => resource.relativePath === "MEMORY.md" || resource.relativePath.startsWith("memory/"))
    .map((resource) => resource.label);

  return [
    {
      id: "core",
      title: "Core agent files",
      description: "Identity and operating rules.",
      checked: true,
      locked: true,
      files: coreFiles,
      rule: undefined
    },
    {
      id: "docs",
      title: "Starter docs",
      description: "Brief, architecture, handoff.",
      checked: rules.generateStarterDocs,
      locked: false,
      files: starterFiles,
      rule: "generateStarterDocs" as const
    },
    {
      id: "memory",
      title: "Memory files",
      description: "Durable decisions and context.",
      checked: rules.generateMemory,
      locked: false,
      files: memoryFiles,
      rule: "generateMemory" as const
    },
    {
      id: "kickoff",
      title: "Kickoff mission",
      description: "Starts the first mission.",
      checked: rules.kickoffMission,
      locked: false,
      files: [],
      rule: "kickoffMission" as const
    }
  ];
}

function ReadinessList({
  surfaceTheme,
  title,
  tone,
  items
}: {
  surfaceTheme: SurfaceTheme;
  title: string;
  tone: "warning" | "danger";
  items: string[];
}) {
  const isLight = surfaceTheme === "light";

  return (
    <div
      className={cn(
        "mt-3 rounded-[18px] border px-4 py-3",
        tone === "danger"
          ? isLight
            ? "border-rose-200 bg-rose-50"
            : "border-rose-400/25 bg-rose-400/10"
          : isLight
            ? "border-amber-200 bg-amber-50"
            : "border-amber-400/25 bg-amber-400/10"
      )}
    >
      <p className={cn("text-[11px] uppercase tracking-[0.18em]", isLight ? "text-[#9f958a]" : "text-slate-500")}>{title}</p>
      <div className="mt-2 space-y-2">
        {items.map((item) => (
          <div key={item} className={cn("flex items-start gap-2 text-[13px] leading-6", isLight ? "text-[#403934]" : "text-slate-200")}>
            <AlertTriangle className="mt-1 h-3.5 w-3.5 shrink-0" />
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
