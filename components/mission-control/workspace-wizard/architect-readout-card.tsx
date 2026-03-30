"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  Boxes,
  Building2,
  Check,
  ChevronRight,
  FileText,
  FolderOpen,
  GitBranch,
  Globe,
  Pencil,
  Sparkles,
  Users,
  type LucideIcon
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { getPlannerStageLabel, humanizePlannerValue } from "@/lib/openclaw/planner-presenters";
import { WORKSPACE_TEMPLATE_OPTIONS } from "@/lib/openclaw/workspace-presets";
import {
  buildWorkspaceContextManifest,
  normalizeWorkspaceDocOverrides
} from "@/lib/openclaw/workspace-docs";
import type { WorkspaceBlueprintEditorFocus } from "@/components/mission-control/workspace-wizard/workspace-wizard-blueprint-editor";
import type {
  PlannerContextSource,
  PlannerInference,
  WorkspacePlan,
  WorkspaceTemplate
} from "@/lib/openclaw/types";
import { cn } from "@/lib/utils";

export type SurfaceTheme = "dark" | "light";

const templateLabels = Object.fromEntries(
  WORKSPACE_TEMPLATE_OPTIONS.map((option) => [option.value, option.label])
) as Record<WorkspaceTemplate, string>;

const sourceMeta: Record<
  PlannerContextSource["kind"],
  {
    label: string;
    icon: LucideIcon;
  }
> = {
  prompt: {
    label: "Prompt",
    icon: Sparkles
  },
  website: {
    label: "Website",
    icon: Globe
  },
  repo: {
    label: "Repo",
    icon: GitBranch
  },
  folder: {
    label: "Folder",
    icon: FolderOpen
  }
};

type ArchitectReadoutCardProps = {
  surfaceTheme: SurfaceTheme;
  plan: WorkspacePlan;
  variant?: "panel" | "message";
  summaryText?: string;
  className?: string;
  onOpenBlueprintEditor?: (focus?: WorkspaceBlueprintEditorFocus) => void;
  onOpenDocumentEditor?: (path: string) => void;
};

export function ArchitectReadoutCard({
  surfaceTheme,
  plan,
  variant = "panel",
  summaryText,
  className,
  onOpenBlueprintEditor,
  onOpenDocumentEditor
}: ArchitectReadoutCardProps) {
  const isLight = surfaceTheme === "light";
  const contextManifest = useMemo(
    () => buildWorkspaceContextManifest(plan.workspace.template, plan.workspace.rules),
    [plan.workspace.rules, plan.workspace.template]
  );
  const overriddenFilePaths = useMemo(
    () => new Set(normalizeWorkspaceDocOverrides(plan.workspace.docOverrides).map((entry) => entry.path)),
    [plan.workspace.docOverrides]
  );

  const projectName = plan.company.name || plan.workspace.name || "Workspace";
  const mission = plan.company.mission || plan.product.offer || "Mission still being shaped.";
  const audience = plan.company.targetCustomer || "Audience still being confirmed.";
  const sourceModeLabel = humanizePlannerValue(plan.workspace.sourceMode);
  const templateLabel = templateLabels[plan.workspace.template];
  const companyTypeLabel = humanizePlannerValue(plan.company.type);
  const stageLabel = getPlannerStageLabel(plan.stage);
  const statusLabel = plan.status === "blocked" ? "Blocked" : plan.status === "ready" ? "Ready" : plan.status === "deployed" ? "Live" : plan.status === "deploying" ? "Deploying" : "Draft";
  const readoutText = summaryText?.trim() || plan.architectSummary;
  const primarySource = plan.intake.sources.find((source) => source.status === "ready") ?? plan.intake.sources[0] ?? null;
  const topInferences = plan.intake.inferences.slice(0, 4);
  const fileCount = contextManifest.resources.length;
  const initials = getProjectInitials(projectName);
  const heroIcon = primarySource ? sourceMeta[primarySource.kind].icon : plan.workspace.sourceMode === "clone" ? GitBranch : plan.workspace.sourceMode === "existing" ? FolderOpen : Sparkles;
  const sourceHeadline = primarySource ? primarySource.label : sourceModeLabel;
  const sourceSubline = primarySource ? `${sourceMeta[primarySource.kind].label} · ${sourceStatusLabel(primarySource.status)}` : sourceModeLabel;
  const statusTone = getPlanStatusTone(plan.status);
  const isPanel = variant === "panel";
  const [revealStage, setRevealStage] = useState(0);
  const finalRevealStage = isPanel ? 3 : 5;
  const revealStatusCopy = isPanel
    ? [
        "Collecting context from the prompt and sources…",
        "Shaping the draft with the first signal set…",
        "Writing the scaffold files now…",
        "Draft ready."
      ]
    : [
        "Collecting context from the prompt and sources…",
        "Pulling evidence from the website and files…",
        "Extracting structured facts…",
        "Grouping the file scaffold…",
        "Checking remaining decisions…",
        "Draft ready."
      ];
  const liveStatusCopy = revealStatusCopy[Math.min(revealStage, revealStatusCopy.length - 1)] ?? revealStatusCopy[0];
  const showSummary = revealStage >= 1;
  const showDetailTiles = revealStage >= 1;
  const showStats = revealStage >= 2;
  const showFiles = revealStage >= (isPanel ? 3 : 5);
  const showEvidence = !isPanel && revealStage >= 3;
  const showInferences = !isPanel && revealStage >= 4;
  const showDecisions = !isPanel && revealStage >= 5;
  const visibleFileSections = isPanel ? contextManifest.sections.filter((section) => section.enabled) : contextManifest.sections;
  const visibleFileCount = visibleFileSections.reduce((total, section) => total + section.resources.length, 0);
  const fileSummaryCount = isPanel ? visibleFileCount : fileCount;

  useEffect(() => {
    const reduceMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const bootstrapTimer = globalThis.setTimeout(() => {
      setRevealStage(reduceMotion ? finalRevealStage : 0);
    }, 0);

    if (reduceMotion) {
      return () => {
        globalThis.clearTimeout(bootstrapTimer);
      };
    }

    const timingSteps = isPanel ? [200, 1400, 3200] : [200, 1400, 2600, 4300, 6200];
    const stagedValues = isPanel ? [1, 2, 3] : [1, 2, 3, 4, 5];
    const timers = stagedValues.map((stage, index) =>
      globalThis.setTimeout(() => setRevealStage(stage), timingSteps[index] ?? timingSteps[timingSteps.length - 1] ?? 0)
    );

    return () => {
      globalThis.clearTimeout(bootstrapTimer);
      timers.forEach((timer) => globalThis.clearTimeout(timer));
    };
  }, [isPanel, finalRevealStage]);

  if (isPanel) {
    return (
      <div
        className={cn(
          "workspace-architect-card-enter relative overflow-hidden rounded-[28px] border p-4 md:p-5",
          isLight
            ? "border-[#e5ddd2] bg-white shadow-[0_16px_42px_rgba(56,47,38,0.06)]"
            : "border-white/10 bg-[rgba(6,10,18,0.96)] shadow-[0_16px_42px_rgba(0,0,0,0.2)]",
          className
        )}
      >
        <div
          className={cn(
            "pointer-events-none absolute inset-0",
            isLight
              ? "bg-[radial-gradient(circle_at_top_right,rgba(216,177,132,0.14),transparent_36%),radial-gradient(circle_at_bottom_left,rgba(94,193,255,0.06),transparent_42%)]"
              : "bg-[radial-gradient(circle_at_top_right,rgba(103,232,249,0.12),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.12),transparent_42%)]"
          )}
        />

        <div className="relative space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <div
                className={cn(
                  "inline-flex size-11 shrink-0 items-center justify-center rounded-2xl border text-[12px] font-semibold tracking-[0.12em]",
                  isLight
                    ? "border-[#e4ddd2] bg-[#fcfaf7] text-[#4f4942]"
                    : "border-white/10 bg-white/[0.05] text-slate-100"
                )}
              >
                {initials}
              </div>

              <div className="min-w-0">
                <p className={cn("text-[10px] uppercase tracking-[0.24em]", isLight ? "text-[#8d8174]" : "text-slate-500")}>
                  Architect
                </p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                  <WordStream
                    key={`hero-title:${isPanel ? "panel" : "message"}:${projectName}`}
                    surfaceTheme={surfaceTheme}
                    text={projectName}
                    className={cn("text-[18px] font-semibold tracking-[-0.04em]", isLight ? "text-[#171410]" : "text-white")}
                    startDelayMs={0}
                    wordDelayMs={95}
                  />
                  <StatusPill surfaceTheme={surfaceTheme} tone={statusTone} label={statusLabel} />
                </div>
                <WordStream
                  key={`hero-status:${isPanel ? "panel" : "message"}:${showSummary ? readoutText : liveStatusCopy}`}
                  surfaceTheme={surfaceTheme}
                  text={showSummary ? readoutText : liveStatusCopy}
                  className={cn(
                    "workspace-architect-card-enter mt-1 line-clamp-2 text-[12px] leading-5",
                    isLight ? "text-[#6f685f]" : "text-slate-300",
                    !showSummary && "italic"
                  )}
                  startDelayMs={80}
                  wordDelayMs={115}
                />
              </div>
            </div>

            <div className="shrink-0 text-right">
              <p className={cn("text-[10px] uppercase tracking-[0.2em]", isLight ? "text-[#918577]" : "text-slate-500")}>Readiness</p>
              <p className={cn("mt-1 text-[24px] font-semibold tracking-[-0.05em]", isLight ? "text-[#181612]" : "text-white")}>
                {plan.readinessScore}%
              </p>
              {onOpenBlueprintEditor ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => onOpenBlueprintEditor("workspace.name")}
                  className={
                    isLight
                      ? "mt-2 rounded-full border-[#ddd6cb] bg-[#f7f2eb] px-3 text-[#403934] hover:bg-[#f1ebe3]"
                      : "mt-2 rounded-full border-white/10 bg-white/[0.04] px-3 text-slate-200 hover:bg-white/[0.08]"
                  }
                >
                  <Pencil className="mr-2 h-3.5 w-3.5" />
                  Edit
                </Button>
              ) : null}
            </div>
          </div>

          {showDetailTiles ? (
            <div className="workspace-architect-card-enter grid gap-2.5 sm:grid-cols-3" style={getChipDelayStyle(90)}>
              <DetailTile surfaceTheme={surfaceTheme} label="Mission" value={mission} icon={Sparkles} revealDelayMs={120} />
              <DetailTile surfaceTheme={surfaceTheme} label="Audience" value={audience} icon={Users} revealDelayMs={220} />
              <DetailTile
                surfaceTheme={surfaceTheme}
                label="Source"
                value={sourceHeadline}
                detail={sourceSubline}
                icon={heroIcon}
                revealDelayMs={320}
              />
            </div>
          ) : null}

          {showStats ? (
            <div className="workspace-architect-card-enter flex flex-wrap gap-1.5" style={getChipDelayStyle(170)}>
            <StatChip surfaceTheme={surfaceTheme} label="Mission" value={truncateChipValue(mission, 48)} icon={Sparkles} revealDelayMs={0} />
            <StatChip surfaceTheme={surfaceTheme} label="Source" value={truncateChipValue(sourceHeadline, 34)} icon={heroIcon} revealDelayMs={110} />
            <StatChip surfaceTheme={surfaceTheme} label="Template" value={templateLabel} icon={Boxes} revealDelayMs={220} />
            <StatChip surfaceTheme={surfaceTheme} label="Files" value={String(fileCount)} icon={FileText} revealDelayMs={330} />
          </div>
        ) : null}

          {showFiles ? (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <SectionHeading
                  surfaceTheme={surfaceTheme}
                  title="Files"
                  subtitle={`${visibleFileSections.length} groups in the canonical scaffold.`}
                />
              </div>

              <div className="space-y-2">
                {visibleFileSections.map((section, sectionIndex) => (
                  <div
                    key={section.id}
                    className={cn(
                      "workspace-architect-card-enter rounded-[18px] border px-3 py-3",
                      isLight ? "border-[#e4ddd3] bg-[#faf6f1]" : "border-white/10 bg-white/[0.03]"
                    )}
                    style={getChipDelayStyle(sectionIndex * 72)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <WordStream
                            key={`files-section-title:${section.id}:${sectionIndex}:${section.title}`}
                            surfaceTheme={surfaceTheme}
                            text={section.title}
                            className={cn("text-[13px] font-semibold", isLight ? "text-[#171410]" : "text-white")}
                            startDelayMs={sectionIndex * 120}
                            wordDelayMs={70}
                          />
                          <StatusPill
                            surfaceTheme={surfaceTheme}
                            tone={section.enabled ? "success" : "muted"}
                            label={section.enabled ? "Included" : "Skipped"}
                          />
                        </div>
                        {!isPanel ? (
                          <p className={cn("mt-1 text-[11px] leading-5", isLight ? "text-[#7a7168]" : "text-slate-400")}>
                            {section.description}
                          </p>
                        ) : null}
                      </div>
                      <span className={cn("text-[11px] uppercase tracking-[0.16em]", isLight ? "text-[#95897c]" : "text-slate-500")}>
                        {section.resources.length} file{section.resources.length === 1 ? "" : "s"}
                      </span>
                    </div>

                    {section.resources.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {section.resources.map((resource, resourceIndex) => (
                          <FileChip
                            key={resource.relativePath}
                            surfaceTheme={surfaceTheme}
                            label={resource.label}
                            tone={overriddenFilePaths.has(resource.relativePath) ? "success" : section.id === "core" ? "default" : "accent"}
                            animated
                            delayMs={(sectionIndex * 6 + resourceIndex) * 88}
                            interactive={Boolean(onOpenDocumentEditor)}
                            onClick={onOpenDocumentEditor ? () => onOpenDocumentEditor(resource.relativePath) : undefined}
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
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "workspace-architect-card-enter relative overflow-hidden border",
        isPanel ? "rounded-[28px] p-4 md:p-5" : "rounded-[26px] p-3.5 md:p-4",
        isLight
          ? "border-[#e5ddd2] bg-white shadow-[0_22px_60px_rgba(56,47,38,0.07)]"
          : "border-white/10 bg-[rgba(6,10,18,0.96)] shadow-[0_22px_60px_rgba(0,0,0,0.22)]",
        className
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-0",
          isLight
            ? "bg-[radial-gradient(circle_at_top_right,rgba(216,177,132,0.16),transparent_36%),radial-gradient(circle_at_bottom_left,rgba(94,193,255,0.08),transparent_42%)]"
            : "bg-[radial-gradient(circle_at_top_right,rgba(103,232,249,0.18),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.16),transparent_42%)]"
        )}
      />

      <div className="relative space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div
              className={cn(
                "inline-flex size-12 shrink-0 items-center justify-center rounded-2xl border text-[12px] font-semibold tracking-[0.12em]",
                isLight
                  ? "border-[#e4ddd2] bg-[#fcfaf7] text-[#4f4942]"
                  : "border-white/10 bg-white/[0.05] text-slate-100"
              )}
            >
              {initials}
            </div>

            <div className="min-w-0">
              <p className={cn("text-[10px] uppercase tracking-[0.24em]", isLight ? "text-[#8d8174]" : "text-slate-500")}>
                Architect
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <p className={cn("text-[20px] font-semibold tracking-[-0.04em]", isLight ? "text-[#171410]" : "text-white")}>
                  {projectName}
                </p>
                <StatusPill surfaceTheme={surfaceTheme} tone={statusTone} label={statusLabel} />
              </div>
              <WordStream
                key={`hero-status:${isPanel ? "panel" : "message"}:${showSummary ? readoutText : liveStatusCopy}`}
                surfaceTheme={surfaceTheme}
                text={showSummary ? readoutText : liveStatusCopy}
                className={cn(
                  "workspace-architect-card-enter mt-1 line-clamp-3 text-[13px] leading-6",
                  isLight ? "text-[#6f685f]" : "text-slate-300",
                  !showSummary && "italic"
                )}
                startDelayMs={80}
                wordDelayMs={120}
              />
            </div>
          </div>

          <div className="shrink-0 text-right">
            <p className={cn("text-[10px] uppercase tracking-[0.2em]", isLight ? "text-[#918577]" : "text-slate-500")}>Readiness</p>
            <p className={cn("mt-1 text-[28px] font-semibold tracking-[-0.05em]", isLight ? "text-[#181612]" : "text-white")}>
              {plan.readinessScore}%
            </p>
            {isPanel && onOpenBlueprintEditor ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => onOpenBlueprintEditor("workspace.name")}
                className={
                  isLight
                    ? "mt-2 rounded-full border-[#ddd6cb] bg-[#f7f2eb] text-[#403934] hover:bg-[#f1ebe3]"
                    : "mt-2 rounded-full border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]"
                }
              >
                <Pencil className="mr-2 h-3.5 w-3.5" />
                Edit details
              </Button>
            ) : null}
          </div>
        </div>

        {showDetailTiles ? (
          <div className="workspace-architect-card-enter grid gap-2.5 sm:grid-cols-3" style={getChipDelayStyle(90)}>
            <DetailTile surfaceTheme={surfaceTheme} label="Mission" value={mission} icon={Sparkles} revealDelayMs={120} />
            <DetailTile surfaceTheme={surfaceTheme} label="Audience" value={audience} icon={Users} revealDelayMs={220} />
            <DetailTile
              surfaceTheme={surfaceTheme}
              label="Source"
              value={sourceHeadline}
              detail={sourceSubline}
              icon={heroIcon}
              revealDelayMs={320}
            />
          </div>
        ) : null}

        {showStats ? (
          <div className="workspace-architect-card-enter flex flex-wrap gap-1.5" style={getChipDelayStyle(170)}>
            {isPanel ? (
              <>
                <StatChip surfaceTheme={surfaceTheme} label="Template" value={templateLabel} icon={Boxes} revealDelayMs={0} />
                <StatChip surfaceTheme={surfaceTheme} label="Stage" value={stageLabel} icon={ChevronRight} revealDelayMs={110} />
                <StatChip surfaceTheme={surfaceTheme} label="Files" value={String(fileSummaryCount)} icon={FileText} revealDelayMs={220} />
              </>
            ) : (
              <>
                <StatChip surfaceTheme={surfaceTheme} label="Template" value={templateLabel} icon={Boxes} revealDelayMs={0} />
                <StatChip surfaceTheme={surfaceTheme} label="Company" value={companyTypeLabel} icon={Building2} revealDelayMs={110} />
                <StatChip surfaceTheme={surfaceTheme} label="Stage" value={stageLabel} icon={ChevronRight} revealDelayMs={220} />
                <StatChip surfaceTheme={surfaceTheme} label="Sources" value={String(plan.intake.sources.length)} icon={Globe} revealDelayMs={330} />
                <StatChip surfaceTheme={surfaceTheme} label="Files" value={String(fileCount)} icon={FileText} revealDelayMs={440} />
              </>
            )}
          </div>
        ) : null}

        {showEvidence ? (
          <section className="space-y-3">
            <SectionHeading
              surfaceTheme={surfaceTheme}
              title="Evidence"
              subtitle="What the architect pulled from the prompt, website, repo, or existing folder."
              revealDelayMs={0}
            />

            {plan.intake.sources.length > 0 ? (
              <div className="grid gap-2 md:grid-cols-2">
                {plan.intake.sources.map((source, index) => (
                  <SourceCard
                    key={source.id}
                    surfaceTheme={surfaceTheme}
                    source={source}
                    delayMs={index * 120}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                surfaceTheme={surfaceTheme}
                title="No sources yet"
                description="Add a website, repo, folder, or short brief and the architect will start grounding the draft."
              />
            )}
          </section>
        ) : null}

        {showInferences ? (
          <section className="space-y-3">
            <SectionHeading
              surfaceTheme={surfaceTheme}
              title="Inferred facts"
              subtitle="Structured fields the architect is using to shape the workspace."
              revealDelayMs={0}
            />

            {topInferences.length > 0 ? (
              <div className="grid gap-2 md:grid-cols-2">
                {topInferences.map((inference, index) => (
                  <InferenceCard
                    key={inference.id}
                    surfaceTheme={surfaceTheme}
                    inference={inference}
                    delayMs={index * 120}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                surfaceTheme={surfaceTheme}
                title="No inferences yet"
                description="Architect will populate structured facts once it has enough source signal."
              />
            )}
          </section>
        ) : null}

        {showFiles ? (
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SectionHeading
                surfaceTheme={surfaceTheme}
                title="Files to create"
                subtitle={
                  isPanel
                    ? "Canonical scaffold derived from the current workspace rules."
                    : "The same file set the workspace will scaffold on the next pass."
                }
                revealDelayMs={0}
              />
              <StatusPill
                surfaceTheme={surfaceTheme}
                tone="muted"
                label={`${fileSummaryCount} file${fileSummaryCount === 1 ? "" : "s"}`}
              />
            </div>

            <div className="space-y-2.5">
              {visibleFileSections.map((section, sectionIndex) => (
                <div
                  key={section.id}
                  className={cn(
                    "workspace-architect-card-enter rounded-[18px] border px-3 py-3",
                    isLight ? "border-[#e4ddd3] bg-[#faf6f1]" : "border-white/10 bg-white/[0.03]"
                  )}
                  style={getChipDelayStyle(sectionIndex * 72)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className={cn("text-[13px] font-semibold", isLight ? "text-[#171410]" : "text-white")}>
                          {section.title}
                        </p>
                        <StatusPill
                          surfaceTheme={surfaceTheme}
                          tone={section.enabled ? "success" : "muted"}
                          label={section.enabled ? "Included" : "Skipped"}
                        />
                      </div>
                    </div>
                    <span className={cn("text-[11px] uppercase tracking-[0.16em]", isLight ? "text-[#95897c]" : "text-slate-500")}>
                      {section.resources.length} file{section.resources.length === 1 ? "" : "s"}
                    </span>
                  </div>

                  {section.resources.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {section.resources.map((resource, resourceIndex) => (
                        <FileChip
                          key={resource.relativePath}
                          surfaceTheme={surfaceTheme}
                          label={resource.label}
                          tone={overriddenFilePaths.has(resource.relativePath) ? "success" : section.id === "core" ? "default" : "accent"}
                          animated
                          delayMs={(sectionIndex * 6 + resourceIndex) * 52}
                          interactive={Boolean(onOpenDocumentEditor)}
                          onClick={onOpenDocumentEditor ? () => onOpenDocumentEditor(resource.relativePath) : undefined}
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
          </section>
        ) : null}

        {showDecisions ? (
          plan.intake.confirmations.length > 0 ? (
            <section className="space-y-3">
              <SectionHeading
                surfaceTheme={surfaceTheme}
                title="Open decisions"
                subtitle="These are the remaining items the architect still wants to confirm."
              />
              <div className="flex flex-wrap gap-1.5">
                {plan.intake.confirmations.map((item, index) => (
                  <span
                    key={`decision:${index}:${item}`}
                    className={cn(
                      "workspace-architect-chip-enter inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] leading-4",
                      isLight ? "border-[#ddd6cb] bg-white text-[#6a6157]" : "border-white/10 bg-white/[0.05] text-slate-300"
                    )}
                    style={getChipDelayStyle(index * 48)}
                  >
                    <ChevronRight className="mr-1 h-3 w-3 shrink-0" />
                    <span className="max-w-[28rem] truncate">{item}</span>
                  </span>
                ))}
              </div>
            </section>
          ) : null
        ) : null}
      </div>
    </div>
  );
}

function DetailTile({
  surfaceTheme,
  label,
  value,
  detail,
  icon: Icon,
  revealDelayMs = 0
}: {
  surfaceTheme: SurfaceTheme;
  label: string;
  value: string;
  detail?: string;
  icon: LucideIcon;
  revealDelayMs?: number;
}) {
  const isLight = surfaceTheme === "light";

  return (
    <div
      className={cn(
        "rounded-[18px] border px-3 py-3",
        isLight ? "border-[#e4ddd3] bg-white" : "border-white/10 bg-white/[0.03]"
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "inline-flex size-8 shrink-0 items-center justify-center rounded-full border",
            isLight ? "border-[#e4ddd2] bg-[#faf6f1] text-[#5f5952]" : "border-white/10 bg-white/[0.05] text-slate-300"
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <WordStream
            key={`detail-label:${label}:${revealDelayMs}`}
            surfaceTheme={surfaceTheme}
            text={label}
            className={cn("text-[10px] uppercase tracking-[0.18em]", isLight ? "text-[#8f8274]" : "text-slate-500")}
            startDelayMs={revealDelayMs}
            wordDelayMs={55}
          />
          <WordStream
            key={`detail-value:${label}:${revealDelayMs}`}
            surfaceTheme={surfaceTheme}
            text={value}
            className={cn("mt-1 text-[13px] font-medium leading-5", isLight ? "text-[#171410]" : "text-white")}
            startDelayMs={revealDelayMs + 80}
            wordDelayMs={110}
          />
          {detail ? (
            <WordStream
              key={`detail-extra:${label}:${revealDelayMs}`}
              surfaceTheme={surfaceTheme}
              text={detail}
              className={cn("mt-1 text-[11px] leading-5", isLight ? "text-[#7a7168]" : "text-slate-400")}
              startDelayMs={revealDelayMs + 200}
              wordDelayMs={95}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function WordStream({
  surfaceTheme,
  text,
  className,
  startDelayMs = 0,
  wordDelayMs = 110
}: {
  surfaceTheme: SurfaceTheme;
  text: string;
  className?: string;
  startDelayMs?: number;
  wordDelayMs?: number;
}) {
  const isLight = surfaceTheme === "light";
  const words = useMemo(
    () =>
      text
        .trim()
        .split(/\s+/)
        .filter(Boolean),
    [text]
  );
  const [visibleWords, setVisibleWords] = useState(0);

  useEffect(() => {
    const reduceMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (words.length === 0) {
      return undefined;
    }

    const timers = reduceMotion
      ? [
          globalThis.setTimeout(() => {
            setVisibleWords(words.length);
          }, 0)
        ]
      : words.map((_, index) =>
          globalThis.setTimeout(() => {
            setVisibleWords(index + 1);
          }, startDelayMs + index * wordDelayMs)
        );

    return () => {
      timers.forEach((timer) => globalThis.clearTimeout(timer));
    };
  }, [startDelayMs, wordDelayMs, words]);

  return (
    <p className={className}>
      {words.slice(0, visibleWords).map((word, index) => (
        <span key={`${index}:${word}`}>
          {index > 0 ? " " : ""}
          {word}
        </span>
      ))}
      {visibleWords < words.length ? (
        <span aria-hidden="true" className={cn("ml-0.5 inline-block animate-pulse", isLight ? "text-[#6f685f]" : "text-slate-300")}>
          ▍
        </span>
      ) : null}
    </p>
  );
}

function StatChip({
  surfaceTheme,
  label,
  value,
  icon: Icon,
  revealDelayMs = 0
}: {
  surfaceTheme: SurfaceTheme;
  label: string;
  value: string;
  icon: LucideIcon;
  revealDelayMs?: number;
}) {
  const isLight = surfaceTheme === "light";

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px]",
        isLight ? "border-[#e4ddd2] bg-white text-[#5f5851]" : "border-white/10 bg-white/[0.04] text-slate-300"
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <WordStream
        key={`stat-label:${label}:${revealDelayMs}`}
        surfaceTheme={surfaceTheme}
        text={label}
        className="uppercase tracking-[0.16em]"
        startDelayMs={revealDelayMs}
        wordDelayMs={55}
      />
      <WordStream
        key={`stat-value:${label}:${revealDelayMs}`}
        surfaceTheme={surfaceTheme}
        text={value}
        className="font-medium normal-case tracking-normal"
        startDelayMs={revealDelayMs + 80}
        wordDelayMs={80}
      />
    </div>
  );
}

function SectionHeading({
  surfaceTheme,
  title,
  subtitle,
  revealDelayMs = 0
}: {
  surfaceTheme: SurfaceTheme;
  title: string;
  subtitle: string;
  revealDelayMs?: number;
}) {
  const isLight = surfaceTheme === "light";

  return (
    <div>
      <WordStream
        key={`heading-title:${title}:${revealDelayMs}`}
        surfaceTheme={surfaceTheme}
        text={title}
        className={cn("text-[11px] uppercase tracking-[0.18em]", isLight ? "text-[#8f8274]" : "text-slate-500")}
        startDelayMs={revealDelayMs}
        wordDelayMs={60}
      />
      <WordStream
        key={`heading-subtitle:${title}:${revealDelayMs}`}
        surfaceTheme={surfaceTheme}
        text={subtitle}
        className={cn("mt-1 text-[12px] leading-5", isLight ? "text-[#70665c]" : "text-slate-400")}
        startDelayMs={revealDelayMs + 100}
        wordDelayMs={90}
      />
    </div>
  );
}

function SourceCard({
  surfaceTheme,
  source,
  delayMs = 0
}: {
  surfaceTheme: SurfaceTheme;
  source: PlannerContextSource;
  delayMs?: number;
}) {
  const isLight = surfaceTheme === "light";
  const meta = sourceMeta[source.kind];
  const Icon = meta.icon;

  return (
    <div
      className={cn(
        "workspace-architect-chip-enter rounded-[18px] border px-3 py-3",
        isLight ? "border-[#e4ddd3] bg-white" : "border-white/10 bg-white/[0.03]"
      )}
      style={getChipDelayStyle(delayMs)}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "inline-flex size-8 shrink-0 items-center justify-center rounded-full border",
            isLight ? "border-[#e4ddd2] bg-[#faf6f1] text-[#5f5952]" : "border-white/10 bg-white/[0.05] text-slate-300"
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <WordStream
                key={`source-label:${source.id}:${delayMs}`}
                surfaceTheme={surfaceTheme}
                text={source.label}
                className={cn("text-[12px] font-semibold", isLight ? "text-[#171410]" : "text-white")}
                startDelayMs={delayMs}
                wordDelayMs={70}
              />
              <WordStream
                key={`source-summary:${source.id}:${delayMs}`}
                surfaceTheme={surfaceTheme}
                text={source.summary}
                className={cn("mt-1 text-[11px] leading-5", isLight ? "text-[#7a7168]" : "text-slate-400")}
                startDelayMs={delayMs + 90}
                wordDelayMs={95}
              />
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <StatusPill
                surfaceTheme={surfaceTheme}
                tone={source.status === "ready" ? "success" : "danger"}
                label={sourceStatusLabel(source.status)}
              />
              {typeof source.confidence === "number" ? (
                <span className={cn("text-[10px] uppercase tracking-[0.16em]", isLight ? "text-[#8f8274]" : "text-slate-500")}>
                  {formatConfidence(source.confidence)}
                </span>
              ) : null}
            </div>
          </div>

          {source.details.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {source.details.slice(0, 2).map((detail, index) => (
                <span
                  key={`source-detail:${source.id}:${index}:${detail}`}
                  className={cn(
                    "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] leading-4",
                    isLight ? "border-[#e4ddd2] bg-[#faf6f1] text-[#6d645b]" : "border-white/10 bg-white/[0.04] text-slate-300"
                  )}
                >
                  {detail}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function InferenceCard({
  surfaceTheme,
  inference,
  delayMs
}: {
  surfaceTheme: SurfaceTheme;
  inference: PlannerInference;
  delayMs: number;
}) {
  const isLight = surfaceTheme === "light";

  return (
    <div
      className={cn(
        "workspace-architect-chip-enter rounded-[18px] border px-3 py-3",
        isLight ? "border-[#e4ddd3] bg-white" : "border-white/10 bg-white/[0.03]"
      )}
      style={getChipDelayStyle(delayMs)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <WordStream
            key={`inference-section:${inference.id}:${delayMs}`}
            surfaceTheme={surfaceTheme}
            text={humanizePlannerValue(inference.section)}
            className={cn("text-[10px] uppercase tracking-[0.18em]", isLight ? "text-[#8f8274]" : "text-slate-500")}
            startDelayMs={delayMs}
            wordDelayMs={55}
          />
          <WordStream
            key={`inference-label:${inference.id}:${delayMs}`}
            surfaceTheme={surfaceTheme}
            text={inference.label}
            className={cn("mt-1 text-[12px] font-semibold leading-5", isLight ? "text-[#171410]" : "text-white")}
            startDelayMs={delayMs + 80}
            wordDelayMs={75}
          />
        </div>
        <StatusPill
          surfaceTheme={surfaceTheme}
          tone={inferenceTone(inference.status)}
          label={inference.status === "confirmed" ? "Confirmed" : inference.status === "needs-confirmation" ? "Needs check" : "Inferred"}
        />
      </div>

      <WordStream
        key={`inference-value:${inference.id}:${delayMs}`}
        surfaceTheme={surfaceTheme}
        text={inference.value}
        className={cn("mt-2 text-[13px] leading-6", isLight ? "text-[#5f564e]" : "text-slate-300")}
        startDelayMs={delayMs + 120}
        wordDelayMs={100}
      />
      <WordStream
        key={`inference-rationale:${inference.id}:${delayMs}`}
        surfaceTheme={surfaceTheme}
        text={inference.rationale}
        className={cn("mt-2 text-[11px] leading-5", isLight ? "text-[#7a7168]" : "text-slate-400")}
        startDelayMs={delayMs + 250}
        wordDelayMs={90}
      />

      {inference.sourceLabels.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {inference.sourceLabels.slice(0, 3).map((label, index) => (
            <span
              key={`inference-source:${inference.id}:${index}:${label}`}
              className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] leading-4",
                isLight ? "border-[#e4ddd2] bg-[#faf6f1] text-[#6d645b]" : "border-white/10 bg-white/[0.04] text-slate-300"
              )}
            >
              {label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FileChip({
  surfaceTheme,
  label,
  tone = "default",
  animated = false,
  delayMs = 0,
  interactive = false,
  onClick
}: {
  surfaceTheme: SurfaceTheme;
  label: string;
  tone?: "default" | "accent" | "success" | "muted";
  animated?: boolean;
  delayMs?: number;
  interactive?: boolean;
  onClick?: () => void;
}) {
  const isLight = surfaceTheme === "light";
  const toneClassName =
    tone === "accent"
      ? isLight
        ? "border-[#d8b184] bg-[#f8efe3] text-[#7c5a34]"
        : "border-cyan-300/30 bg-cyan-300/10 text-cyan-100"
      : tone === "success"
        ? isLight
          ? "border-emerald-300 bg-emerald-50 text-emerald-900"
          : "border-emerald-300/30 bg-emerald-300/12 text-emerald-100"
        : tone === "muted"
          ? isLight
            ? "border-[#e4ddd3] bg-[#faf6f1] text-[#6d645b]"
            : "border-white/10 bg-white/[0.04] text-slate-400"
          : isLight
            ? "border-[#e4ddd3] bg-white text-[#6d645b]"
            : "border-white/10 bg-white/[0.05] text-slate-300";

  const className = cn(
    "inline-flex items-center rounded-full border px-2.5 py-1 font-mono text-[10px] leading-4 transition-colors",
    animated && "workspace-architect-chip-enter",
    toneClassName,
    interactive
      ? tone === "success"
        ? isLight
          ? "cursor-pointer hover:border-emerald-400 hover:bg-emerald-100"
          : "cursor-pointer hover:border-emerald-300/45 hover:bg-emerald-300/16"
        : isLight
          ? "cursor-pointer hover:border-[#d8c8ba] hover:bg-[#f6efe6]"
          : "cursor-pointer hover:border-white/15 hover:bg-white/[0.08]"
      : ""
  );

  const icon = interactive ? Pencil : Check;

  if (interactive) {
    const Icon = icon;

    return (
      <button type="button" onClick={onClick} aria-label={`Edit ${label}`} className={className} style={getChipDelayStyle(delayMs)}>
        <Icon className="mr-1 h-3 w-3" />
        {label}
      </button>
    );
  }

  const Icon = icon;

  return (
    <span className={className} style={getChipDelayStyle(delayMs)}>
      <Icon className="mr-1 h-3 w-3" />
      {label}
    </span>
  );
}

function truncateChipValue(value: string, maxLength: number) {
  const trimmed = value.trim();

  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
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

function EmptyState({
  surfaceTheme,
  title,
  description
}: {
  surfaceTheme: SurfaceTheme;
  title: string;
  description: string;
}) {
  const isLight = surfaceTheme === "light";

  return (
    <div
      className={cn(
        "rounded-[18px] border border-dashed px-3 py-3",
        isLight ? "border-[#ddd5ca] bg-white/80" : "border-white/10 bg-white/[0.03]"
      )}
    >
      <WordStream
        key={`empty-title:${title}`}
        surfaceTheme={surfaceTheme}
        text={title}
        className={cn("text-[12px] font-medium", isLight ? "text-[#171410]" : "text-white")}
        startDelayMs={0}
        wordDelayMs={65}
      />
      <WordStream
        key={`empty-description:${title}`}
        surfaceTheme={surfaceTheme}
        text={description}
        className={cn("mt-1 text-[12px] leading-5", isLight ? "text-[#70665c]" : "text-slate-400")}
        startDelayMs={90}
        wordDelayMs={90}
      />
    </div>
  );
}

function getPlanStatusTone(status: WorkspacePlan["status"]): "muted" | "success" | "warning" | "danger" {
  switch (status) {
    case "blocked":
      return "danger";
    case "ready":
    case "deployed":
      return "success";
    case "review":
      return "warning";
    default:
      return "muted";
  }
}

function sourceStatusLabel(status: PlannerContextSource["status"]) {
  return status === "ready" ? "Ready" : "Needs check";
}

function inferenceTone(status: PlannerInference["status"]): "muted" | "success" | "warning" | "danger" {
  switch (status) {
    case "confirmed":
      return "success";
    case "needs-confirmation":
      return "warning";
    default:
      return "muted";
  }
}

function formatConfidence(confidence: number) {
  return `${Math.round(confidence * 100)}%`;
}

function getProjectInitials(name: string) {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const initials = parts.length > 1 ? `${parts[0][0] ?? ""}${parts[1][0] ?? ""}` : name.slice(0, 2);

  return initials.toUpperCase();
}

function getChipDelayStyle(delayMs: number): CSSProperties {
  return {
    animationDelay: `${delayMs}ms`
  };
}
