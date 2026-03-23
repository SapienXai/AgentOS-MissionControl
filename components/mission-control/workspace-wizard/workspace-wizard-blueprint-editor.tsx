"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, LoaderCircle, Pencil, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { WORKSPACE_MODEL_PROFILE_OPTIONS, WORKSPACE_SOURCE_OPTIONS, WORKSPACE_TEMPLATE_OPTIONS } from "@/lib/openclaw/workspace-presets";
import type {
  WorkspaceCreateRules,
  WorkspaceModelProfile,
  WorkspacePlan,
  WorkspaceSourceMode,
  WorkspaceTemplate
} from "@/lib/openclaw/types";
import { cn } from "@/lib/utils";

type SurfaceTheme = "dark" | "light";

type BlueprintEditorTab = "fields" | "raw";

type WorkspaceBlueprintSectionFocus = "company" | "product" | "workspace" | "team" | "deploy";
type WorkspaceBlueprintFieldFocus =
  | "company.name"
  | "company.mission"
  | "company.targetCustomer"
  | "company.constraints"
  | "company.successSignals"
  | "product.offer"
  | "product.revenueModel"
  | "product.scopeV1"
  | "product.nonGoals"
  | "product.launchPriority"
  | "workspace.name"
  | "workspace.directory"
  | "workspace.sourceMode"
  | "workspace.repoUrl"
  | "workspace.existingPath"
  | "workspace.template"
  | "workspace.modelProfile"
  | "workspace.modelId"
  | "workspace.stackDecisions"
  | "workspace.docs"
  | "workspace.ruleGenerateStarterDocs"
  | "workspace.ruleGenerateMemory"
  | "workspace.ruleKickoffMission"
  | "team.allowEphemeralSubagents"
  | "team.autopilot"
  | "team.reviewRequested"
  | "team.maxParallelRuns"
  | "team.escalationRules"
  | "deploy.blockers"
  | "deploy.warnings"
  | "deploy.firstMissions";

export type WorkspaceBlueprintEditorFocus = WorkspaceBlueprintSectionFocus | WorkspaceBlueprintFieldFocus | "raw";

type BlueprintDraft = {
  companyName: string;
  companyMission: string;
  companyTargetCustomer: string;
  companyConstraints: string;
  companySuccessSignals: string;
  productOffer: string;
  productRevenueModel: string;
  productScopeV1: string;
  productNonGoals: string;
  productLaunchPriority: string;
  workspaceName: string;
  workspaceDirectory: string;
  workspaceSourceMode: WorkspaceSourceMode;
  workspaceRepoUrl: string;
  workspaceExistingPath: string;
  workspaceTemplate: WorkspaceTemplate;
  workspaceModelProfile: WorkspaceModelProfile;
  workspaceModelId: string;
  workspaceStackDecisions: string;
  workspaceDocs: string;
  workspaceRuleGenerateStarterDocs: boolean;
  workspaceRuleGenerateMemory: boolean;
  workspaceRuleKickoffMission: boolean;
  intakeReviewRequested: boolean;
  intakeAutopilot: boolean;
  teamAllowEphemeralSubagents: boolean;
  teamMaxParallelRuns: string;
  teamEscalationRules: string;
  deployBlockers: string;
  deployWarnings: string;
  deployFirstMissions: string;
};

type WorkspaceWizardBlueprintEditorProps = {
  open: boolean;
  surfaceTheme: SurfaceTheme;
  plan: WorkspacePlan | null;
  focus?: WorkspaceBlueprintEditorFocus;
  busy?: boolean;
  onClose: () => void;
  onSave: (nextPlan: WorkspacePlan, summary: string) => Promise<boolean>;
};

function getBlueprintEditorSectionFocus(focus: WorkspaceBlueprintEditorFocus): WorkspaceBlueprintSectionFocus {
  if (focus === "raw") {
    return "workspace";
  }

  const [section] = focus.split(".") as [WorkspaceBlueprintSectionFocus, ...string[]];
  return section;
}

function getBlueprintEditorFieldFocus(focus: WorkspaceBlueprintEditorFocus): WorkspaceBlueprintFieldFocus | null {
  return focus.includes(".") ? (focus as WorkspaceBlueprintFieldFocus) : null;
}

export function WorkspaceWizardBlueprintEditor({
  open,
  surfaceTheme,
  plan,
  focus,
  busy = false,
  onClose,
  onSave
}: WorkspaceWizardBlueprintEditorProps) {
  const [tab, setTab] = useState<BlueprintEditorTab>(() => (focus === "raw" ? "raw" : "fields"));
  const [draft, setDraft] = useState<BlueprintDraft | null>(() => (plan ? createBlueprintDraftFromPlan(plan) : null));
  const [rawValue, setRawValue] = useState(() => (plan ? JSON.stringify(plan, null, 2) : ""));
  const [rawError, setRawError] = useState<string | null>(null);
  const sectionRefs = useRef<Partial<Record<WorkspaceBlueprintSectionFocus, HTMLDivElement | null>>>({});
  const fieldRefs = useRef<Partial<Record<WorkspaceBlueprintFieldFocus, HTMLElement | null>>>({});

  const isLight = surfaceTheme === "light";
  const focusSection = focus && focus !== "raw" ? getBlueprintEditorSectionFocus(focus) : null;
  const focusField = focus && focus !== "raw" ? getBlueprintEditorFieldFocus(focus) : null;

  useEffect(() => {
    if (!open || !plan || !focus || focus === "raw" || tab !== "fields") {
      return;
    }

    const sectionFocus = getBlueprintEditorSectionFocus(focus);
    const target = focusField ? fieldRefs.current[focusField] ?? sectionRefs.current[sectionFocus] : sectionRefs.current[sectionFocus];

    if (!target) {
      return;
    }

    globalThis.requestAnimationFrame(() => {
      target.scrollIntoView({
        behavior: "smooth",
        block: focusField ? "center" : "start"
      });

      if (focusField && target === fieldRefs.current[focusField] && typeof target.focus === "function") {
        target.focus({ preventScroll: true });
      }
    });
  }, [focus, focusField, open, plan, tab]);

  const canSave = Boolean(plan && draft);

  if (!open || !plan || !draft) {
    return null;
  }

  const updateDraft = <K extends keyof BlueprintDraft>(key: K, value: BlueprintDraft[K]) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  };

  const registerField = <T extends HTMLElement>(key: WorkspaceBlueprintFieldFocus) => (node: T | null) => {
    fieldRefs.current[key] = node;
  };

  const handleFieldSave = async () => {
    const nextPlan = applyBlueprintDraftToPlan(plan, draft);
    const summary = summarizeBlueprintChanges(plan, nextPlan);
    const saved = await onSave(nextPlan, summary);

    if (saved) {
      onClose();
    }
  };

  const handleRawSave = async () => {
    try {
      const parsed = JSON.parse(rawValue) as WorkspacePlan;
      const summary = "Manual raw blueprint edit applied.";
      const saved = await onSave(parsed, summary);

      if (saved) {
        onClose();
      }
    } catch (error) {
      setRawError(error instanceof Error ? error.message : "Raw JSON could not be parsed.");
    }
  };

  return (
    <div className="absolute inset-0 z-30">
      <button
        type="button"
        aria-label="Close blueprint editor"
        onClick={onClose}
        className={cn(
          "absolute inset-0 h-full w-full cursor-default",
          isLight ? "bg-[rgba(17,14,10,0.26)]" : "bg-[rgba(2,6,13,0.56)]"
        )}
      />

      <div
        className={cn(
          "absolute inset-y-0 right-0 flex h-full w-full flex-col border-l shadow-[0_34px_120px_rgba(0,0,0,0.35)] lg:max-w-[760px]",
          isLight
            ? "border-[#e6ded4] bg-[linear-gradient(180deg,rgba(255,253,249,0.98),rgba(247,241,233,0.98))] text-[#151311]"
            : "border-white/10 bg-[linear-gradient(180deg,rgba(5,9,18,0.98),rgba(3,7,15,0.98))] text-white"
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={cn("flex items-start justify-between gap-4 border-b px-4 py-4 md:px-5", isLight ? "border-[#e7dfd4]" : "border-white/10")}>
          <div className="min-w-0">
            <p className={cn("text-[11px] uppercase tracking-[0.18em]", isLight ? "text-[#9a9085]" : "text-slate-500")}>
              Blueprint editor
            </p>
            <h2 className={cn("mt-1 text-[18px] font-semibold tracking-[-0.03em]", isLight ? "text-[#171410]" : "text-white")}>
              Edit any detail, then keep chatting with Architect
            </h2>
            <p className={cn("mt-1 text-[13px] leading-6", isLight ? "text-[#6f675e]" : "text-slate-300")}>
              Structured fields cover the common edits. Raw JSON lets you change anything else in the same plan.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className={cn(
              "inline-flex size-9 shrink-0 items-center justify-center rounded-full border transition-colors",
              isLight
                ? "border-[#e3dbd0] bg-white text-[#5d564d] hover:bg-[#f5efe6]"
                : "border-white/10 bg-white/[0.05] text-slate-300 hover:bg-white/[0.08]"
            )}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className={cn("flex items-center gap-2 border-b px-4 py-3 md:px-5", isLight ? "border-[#e7dfd4]" : "border-white/10")}>
          <StatusChip surfaceTheme={surfaceTheme} label={`Stage · ${plan.stage}`} />
          <StatusChip surfaceTheme={surfaceTheme} label={`Status · ${plan.status}`} />
          <StatusChip surfaceTheme={surfaceTheme} label={`Readiness · ${plan.readinessScore}%`} />
        </div>

        <Tabs value={tab} onValueChange={(value) => setTab(value as BlueprintEditorTab)} className="flex min-h-0 flex-1 flex-col px-4 py-4 md:px-5">
          <TabsList className={cn("w-fit", isLight ? "bg-[#f2ece4] text-[#645b52]" : "bg-white/5")}>
            <TabsTrigger value="fields">Fields</TabsTrigger>
            <TabsTrigger value="raw">Raw JSON</TabsTrigger>
          </TabsList>

          <TabsContent value="fields" className="min-h-0 flex-1">
            <ScrollArea className="h-full pr-1">
              <div className="space-y-4 pb-4">
                <div className="grid gap-4 xl:grid-cols-2">
                  <SectionCard
                    surfaceTheme={surfaceTheme}
                    sectionId="company"
                    highlighted={focusSection === "company"}
                    title="Company"
                    description="Mission and audience details."
                    register={(node) => {
                      sectionRefs.current.company = node;
                    }}
                  >
                    <FieldGroup label="Name">
                      <Input
                        ref={registerField("company.name")}
                        value={draft.companyName}
                        onChange={(event) => updateDraft("companyName", event.target.value)}
                      />
                    </FieldGroup>
                    <FieldGroup label="Mission">
                      <Textarea
                        ref={registerField("company.mission")}
                        value={draft.companyMission}
                        onChange={(event) => updateDraft("companyMission", event.target.value)}
                        className="min-h-[96px]"
                      />
                    </FieldGroup>
                    <FieldGroup label="Target customer">
                      <Input
                        ref={registerField("company.targetCustomer")}
                        value={draft.companyTargetCustomer}
                        onChange={(event) => updateDraft("companyTargetCustomer", event.target.value)}
                      />
                    </FieldGroup>
                    <FieldGroup label="Constraints">
                      <Textarea
                        ref={registerField("company.constraints")}
                        value={draft.companyConstraints}
                        onChange={(event) => updateDraft("companyConstraints", event.target.value)}
                        placeholder="One constraint per line"
                        className="min-h-[84px]"
                      />
                    </FieldGroup>
                    <FieldGroup label="Success signals">
                      <Textarea
                        ref={registerField("company.successSignals")}
                        value={draft.companySuccessSignals}
                        onChange={(event) => updateDraft("companySuccessSignals", event.target.value)}
                        placeholder="One signal per line"
                        className="min-h-[84px]"
                      />
                    </FieldGroup>
                  </SectionCard>

                  <SectionCard
                    surfaceTheme={surfaceTheme}
                    sectionId="product"
                    highlighted={focusSection === "product"}
                    title="Product"
                    description="Offer and V1 shape."
                    register={(node) => {
                      sectionRefs.current.product = node;
                    }}
                  >
                    <FieldGroup label="Offer">
                      <Textarea
                        ref={registerField("product.offer")}
                        value={draft.productOffer}
                        onChange={(event) => updateDraft("productOffer", event.target.value)}
                        className="min-h-[96px]"
                      />
                    </FieldGroup>
                    <FieldGroup label="Revenue model">
                      <Input
                        ref={registerField("product.revenueModel")}
                        value={draft.productRevenueModel}
                        onChange={(event) => updateDraft("productRevenueModel", event.target.value)}
                      />
                    </FieldGroup>
                    <FieldGroup label="Scope V1">
                      <Textarea
                        ref={registerField("product.scopeV1")}
                        value={draft.productScopeV1}
                        onChange={(event) => updateDraft("productScopeV1", event.target.value)}
                        placeholder="One item per line"
                        className="min-h-[84px]"
                      />
                    </FieldGroup>
                    <FieldGroup label="Non-goals">
                      <Textarea
                        ref={registerField("product.nonGoals")}
                        value={draft.productNonGoals}
                        onChange={(event) => updateDraft("productNonGoals", event.target.value)}
                        placeholder="One item per line"
                        className="min-h-[84px]"
                      />
                    </FieldGroup>
                    <FieldGroup label="Launch priority">
                      <Textarea
                        ref={registerField("product.launchPriority")}
                        value={draft.productLaunchPriority}
                        onChange={(event) => updateDraft("productLaunchPriority", event.target.value)}
                        placeholder="One item per line"
                        className="min-h-[84px]"
                      />
                    </FieldGroup>
                  </SectionCard>
                </div>

                <SectionCard
                  surfaceTheme={surfaceTheme}
                  sectionId="workspace"
                  highlighted={focusSection === "workspace"}
                  title="Workspace"
                  description="Provisioning path and bootstrap rules."
                  register={(node) => {
                    sectionRefs.current.workspace = node;
                  }}
                >
                  <div className="grid gap-4 xl:grid-cols-2">
                    <FieldGroup label="Workspace name">
                      <Input
                        ref={registerField("workspace.name")}
                        value={draft.workspaceName}
                        onChange={(event) => updateDraft("workspaceName", event.target.value)}
                      />
                    </FieldGroup>
                    <FieldGroup label="Workspace directory">
                      <Input
                        ref={registerField("workspace.directory")}
                        value={draft.workspaceDirectory}
                        onChange={(event) => updateDraft("workspaceDirectory", event.target.value)}
                      />
                    </FieldGroup>
                    <FieldGroup label="Repository URL">
                      <Input
                        ref={registerField("workspace.repoUrl")}
                        value={draft.workspaceRepoUrl}
                        onChange={(event) => updateDraft("workspaceRepoUrl", event.target.value)}
                      />
                    </FieldGroup>
                    <FieldGroup label="Existing folder path">
                      <Input
                        ref={registerField("workspace.existingPath")}
                        value={draft.workspaceExistingPath}
                        onChange={(event) => updateDraft("workspaceExistingPath", event.target.value)}
                      />
                    </FieldGroup>
                    <FieldGroup label="Model id">
                      <Input
                        ref={registerField("workspace.modelId")}
                        value={draft.workspaceModelId}
                        onChange={(event) => updateDraft("workspaceModelId", event.target.value)}
                      />
                    </FieldGroup>
                  </div>

                  <OptionSection
                    surfaceTheme={surfaceTheme}
                    label="Source mode"
                    value={draft.workspaceSourceMode}
                    options={WORKSPACE_SOURCE_OPTIONS}
                    onChange={(value) => updateDraft("workspaceSourceMode", value)}
                    fieldRef={registerField("workspace.sourceMode")}
                    highlighted={focusField === "workspace.sourceMode"}
                  />

                  <OptionSection
                    surfaceTheme={surfaceTheme}
                    label="Template"
                    value={draft.workspaceTemplate}
                    options={WORKSPACE_TEMPLATE_OPTIONS}
                    onChange={(value) => updateDraft("workspaceTemplate", value)}
                    fieldRef={registerField("workspace.template")}
                    highlighted={focusField === "workspace.template"}
                  />

                  <OptionSection
                    surfaceTheme={surfaceTheme}
                    label="Model profile"
                    value={draft.workspaceModelProfile}
                    options={WORKSPACE_MODEL_PROFILE_OPTIONS}
                    onChange={(value) => updateDraft("workspaceModelProfile", value)}
                    fieldRef={registerField("workspace.modelProfile")}
                    highlighted={focusField === "workspace.modelProfile"}
                  />

                  <div className="grid gap-4 xl:grid-cols-2">
                    <FieldGroup label="Stack decisions">
                      <Textarea
                        ref={registerField("workspace.stackDecisions")}
                        value={draft.workspaceStackDecisions}
                        onChange={(event) => updateDraft("workspaceStackDecisions", event.target.value)}
                        placeholder="One item per line"
                        className="min-h-[84px]"
                      />
                    </FieldGroup>
                    <FieldGroup label="Docs">
                      <Textarea
                        ref={registerField("workspace.docs")}
                        value={draft.workspaceDocs}
                        onChange={(event) => updateDraft("workspaceDocs", event.target.value)}
                        placeholder="One item per line"
                        className="min-h-[84px]"
                      />
                    </FieldGroup>
                  </div>

                  <RuleRow
                    surfaceTheme={surfaceTheme}
                    label="Starter docs"
                    description="Generate the first brief, architecture, and deliverables scaffold."
                    checked={draft.workspaceRuleGenerateStarterDocs}
                    onToggle={() => updateDraft("workspaceRuleGenerateStarterDocs", !draft.workspaceRuleGenerateStarterDocs)}
                    fieldRef={registerField("workspace.ruleGenerateStarterDocs")}
                    highlighted={focusField === "workspace.ruleGenerateStarterDocs"}
                  />
                  <RuleRow
                    surfaceTheme={surfaceTheme}
                    label="Memory"
                    description="Generate the persistent memory files for blueprint decisions."
                    checked={draft.workspaceRuleGenerateMemory}
                    onToggle={() => updateDraft("workspaceRuleGenerateMemory", !draft.workspaceRuleGenerateMemory)}
                    fieldRef={registerField("workspace.ruleGenerateMemory")}
                    highlighted={focusField === "workspace.ruleGenerateMemory"}
                  />
                  <RuleRow
                    surfaceTheme={surfaceTheme}
                    label="Kickoff mission"
                    description="Run the first mission immediately after bootstrap."
                    checked={draft.workspaceRuleKickoffMission}
                    onToggle={() => updateDraft("workspaceRuleKickoffMission", !draft.workspaceRuleKickoffMission)}
                    fieldRef={registerField("workspace.ruleKickoffMission")}
                    highlighted={focusField === "workspace.ruleKickoffMission"}
                  />
                </SectionCard>

                <div className="grid gap-4 xl:grid-cols-2">
                  <SectionCard
                    surfaceTheme={surfaceTheme}
                    sectionId="team"
                    highlighted={focusSection === "team"}
                    title="Team"
                    description="Planner behavior and coordination rules."
                    register={(node) => {
                      sectionRefs.current.team = node;
                    }}
                  >
                    <RuleRow
                      surfaceTheme={surfaceTheme}
                      label="Allow ephemeral subagents"
                      description="Let the planner spin up temporary helpers when useful."
                      checked={draft.teamAllowEphemeralSubagents}
                      onToggle={() => updateDraft("teamAllowEphemeralSubagents", !draft.teamAllowEphemeralSubagents)}
                      fieldRef={registerField("team.allowEphemeralSubagents")}
                      highlighted={focusField === "team.allowEphemeralSubagents"}
                    />
                    <RuleRow
                      surfaceTheme={surfaceTheme}
                      label="Autopilot"
                      description="Let the planner take a stronger lead when the shape is clear."
                      checked={draft.intakeAutopilot}
                      onToggle={() => updateDraft("intakeAutopilot", !draft.intakeAutopilot)}
                      fieldRef={registerField("team.autopilot")}
                      highlighted={focusField === "team.autopilot"}
                    />
                    <RuleRow
                      surfaceTheme={surfaceTheme}
                      label="Review requested"
                      description="Keep the planner in a review-heavy shaping mode."
                      checked={draft.intakeReviewRequested}
                      onToggle={() => updateDraft("intakeReviewRequested", !draft.intakeReviewRequested)}
                      fieldRef={registerField("team.reviewRequested")}
                      highlighted={focusField === "team.reviewRequested"}
                    />
                    <FieldGroup label="Max parallel runs">
                      <Input
                        ref={registerField("team.maxParallelRuns")}
                        type="number"
                        min={1}
                        value={draft.teamMaxParallelRuns}
                        onChange={(event) => updateDraft("teamMaxParallelRuns", event.target.value)}
                      />
                    </FieldGroup>
                    <FieldGroup label="Escalation rules">
                      <Textarea
                        ref={registerField("team.escalationRules")}
                        value={draft.teamEscalationRules}
                        onChange={(event) => updateDraft("teamEscalationRules", event.target.value)}
                        placeholder="One rule per line"
                        className="min-h-[84px]"
                      />
                    </FieldGroup>
                  </SectionCard>

                  <SectionCard
                    surfaceTheme={surfaceTheme}
                    sectionId="deploy"
                    highlighted={focusSection === "deploy"}
                    title="Deploy"
                    description="Review blockers, warnings, and first missions."
                    register={(node) => {
                      sectionRefs.current.deploy = node;
                    }}
                  >
                    <FieldGroup label="Blockers">
                      <Textarea
                        ref={registerField("deploy.blockers")}
                        value={draft.deployBlockers}
                        onChange={(event) => updateDraft("deployBlockers", event.target.value)}
                        placeholder="One blocker per line"
                        className="min-h-[84px]"
                      />
                    </FieldGroup>
                    <FieldGroup label="Warnings">
                      <Textarea
                        ref={registerField("deploy.warnings")}
                        value={draft.deployWarnings}
                        onChange={(event) => updateDraft("deployWarnings", event.target.value)}
                        placeholder="One warning per line"
                        className="min-h-[84px]"
                      />
                    </FieldGroup>
                    <FieldGroup label="First missions">
                      <Textarea
                        ref={registerField("deploy.firstMissions")}
                        value={draft.deployFirstMissions}
                        onChange={(event) => updateDraft("deployFirstMissions", event.target.value)}
                        placeholder="One mission per line"
                        className="min-h-[84px]"
                      />
                    </FieldGroup>
                  </SectionCard>

                  <SectionCard surfaceTheme={surfaceTheme} title="Note" description="What happens on save?">
                    <p className={cn("text-[13px] leading-6", isLight ? "text-[#6f675e]" : "text-slate-300")}>
                      Derived plan fields like readiness score, stage, and recommended missions are recalculated after you save.
                    </p>
                    <p className={cn("mt-3 text-[13px] leading-6", isLight ? "text-[#6f675e]" : "text-slate-300")}>
                      If you want to edit something that is not shown here, switch to Raw JSON and change the exact nested field.
                    </p>
                  </SectionCard>
                </div>
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="raw" className="min-h-0 flex-1">
            <div className="flex h-full min-h-0 flex-col gap-3">
              <div className={cn("rounded-[18px] border px-4 py-3", isLight ? "border-[#e5ddd2] bg-white" : "border-white/10 bg-white/[0.04]")}>
                <p className={cn("text-[13px] leading-6", isLight ? "text-[#6f675e]" : "text-slate-300")}>
                  This view edits the full blueprint JSON. It is the fastest way to change nested fields, agents, workflows, and any other detail.
                </p>
              </div>

              <Textarea
                value={rawValue}
                onChange={(event) => {
                  setRawValue(event.target.value);
                  setRawError(null);
                }}
                className={cn(
                  "min-h-0 flex-1 font-mono text-[12px] leading-5",
                  isLight ? "border-[#dcd4c9] bg-white text-[#1a1714]" : "border-white/10 bg-[#03060d] text-slate-100"
                )}
              />

              {rawError ? (
                <p className="rounded-xl border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-[13px] leading-5 text-rose-200">
                  {rawError}
                </p>
              ) : null}

              <p className={cn("text-[12px] leading-5", isLight ? "text-[#7b7268]" : "text-slate-400")}>
                Current draft JSON snapshot loaded on open. Changes are saved through the same planner draft path as the structured editor.
              </p>
            </div>
          </TabsContent>
        </Tabs>

        <div className={cn("flex items-center justify-between gap-3 border-t px-4 py-4 md:px-5", isLight ? "border-[#e7dfd4]" : "border-white/10")}>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            className={isLight ? "rounded-full border-[#ddd6cb] bg-[#f7f2eb] text-[#403934] hover:bg-[#f1ebe3]" : "rounded-full border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]"}
          >
            Cancel
          </Button>

          <Button
            type="button"
            onClick={tab === "raw" ? handleRawSave : handleFieldSave}
            disabled={!canSave || busy}
            className={
              isLight
                ? "rounded-full bg-[#161514] text-white hover:bg-[#26231f]"
                : "rounded-full bg-cyan-300 text-slate-950 hover:bg-cyan-200"
            }
          >
            {busy ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Pencil className="mr-2 h-4 w-4" />}
            Apply changes
          </Button>
        </div>
      </div>
    </div>
  );
}

function createBlueprintDraftFromPlan(plan: WorkspacePlan): BlueprintDraft {
  return {
    companyName: plan.company.name,
    companyMission: plan.company.mission,
    companyTargetCustomer: plan.company.targetCustomer,
    companyConstraints: joinLines(plan.company.constraints),
    companySuccessSignals: joinLines(plan.company.successSignals),
    productOffer: plan.product.offer,
    productRevenueModel: plan.product.revenueModel,
    productScopeV1: joinLines(plan.product.scopeV1),
    productNonGoals: joinLines(plan.product.nonGoals),
    productLaunchPriority: joinLines(plan.product.launchPriority),
    workspaceName: plan.workspace.name,
    workspaceDirectory: plan.workspace.directory ?? "",
    workspaceSourceMode: plan.workspace.sourceMode,
    workspaceRepoUrl: plan.workspace.repoUrl ?? "",
    workspaceExistingPath: plan.workspace.existingPath ?? "",
    workspaceTemplate: plan.workspace.template,
    workspaceModelProfile: plan.workspace.modelProfile,
    workspaceModelId: plan.workspace.modelId ?? "",
    workspaceStackDecisions: joinLines(plan.workspace.stackDecisions),
    workspaceDocs: joinLines(plan.workspace.docs),
    workspaceRuleGenerateStarterDocs: plan.workspace.rules.generateStarterDocs,
    workspaceRuleGenerateMemory: plan.workspace.rules.generateMemory,
    workspaceRuleKickoffMission: plan.workspace.rules.kickoffMission,
    intakeReviewRequested: plan.intake.reviewRequested,
    intakeAutopilot: plan.autopilot,
    teamAllowEphemeralSubagents: plan.team.allowEphemeralSubagents,
    teamMaxParallelRuns: String(plan.team.maxParallelRuns),
    teamEscalationRules: joinLines(plan.team.escalationRules),
    deployBlockers: joinLines(plan.deploy.blockers),
    deployWarnings: joinLines(plan.deploy.warnings),
    deployFirstMissions: joinLines(plan.deploy.firstMissions)
  };
}

function applyBlueprintDraftToPlan(plan: WorkspacePlan, draft: BlueprintDraft) {
  const next = structuredClone(plan);
  const previousCompanyName = plan.company.name.trim();
  const previousWorkspaceName = plan.workspace.name.trim();
  const nextCompanyName = draft.companyName.trim();
  const nextWorkspaceName = draft.workspaceName.trim();
  const companyNameChanged = nextCompanyName !== previousCompanyName;
  const workspaceNameChanged = nextWorkspaceName !== previousWorkspaceName;

  next.company.name = nextCompanyName;
  next.company.mission = draft.companyMission.trim();
  next.company.targetCustomer = draft.companyTargetCustomer.trim();
  next.company.constraints = splitLines(draft.companyConstraints);
  next.company.successSignals = splitLines(draft.companySuccessSignals);

  next.product.offer = draft.productOffer.trim();
  next.product.revenueModel = draft.productRevenueModel.trim();
  next.product.scopeV1 = splitLines(draft.productScopeV1);
  next.product.nonGoals = splitLines(draft.productNonGoals);
  next.product.launchPriority = splitLines(draft.productLaunchPriority);

  next.workspace.name = nextWorkspaceName;
  next.workspace.directory = normalizeOptionalValue(draft.workspaceDirectory);
  next.workspace.sourceMode = draft.workspaceSourceMode;
  next.workspace.repoUrl = normalizeOptionalValue(draft.workspaceRepoUrl);
  next.workspace.existingPath = normalizeOptionalValue(draft.workspaceExistingPath);
  next.workspace.template = draft.workspaceTemplate;
  next.workspace.modelProfile = draft.workspaceModelProfile;
  next.workspace.modelId = normalizeOptionalValue(draft.workspaceModelId);
  next.workspace.stackDecisions = splitLines(draft.workspaceStackDecisions);
  next.workspace.docs = splitLines(draft.workspaceDocs);
  next.workspace.rules = {
    ...next.workspace.rules,
    workspaceOnly: true,
    generateStarterDocs: draft.workspaceRuleGenerateStarterDocs,
    generateMemory: draft.workspaceRuleGenerateMemory,
    kickoffMission: draft.workspaceRuleKickoffMission
  } satisfies WorkspaceCreateRules;

  if (workspaceNameChanged && !companyNameChanged) {
    next.company.name = nextWorkspaceName;
  } else if (companyNameChanged && !workspaceNameChanged) {
    next.workspace.name = nextCompanyName;
  }

  next.team.allowEphemeralSubagents = draft.teamAllowEphemeralSubagents;
  next.team.maxParallelRuns = Number.isFinite(Number(draft.teamMaxParallelRuns))
    ? Math.max(1, Number(draft.teamMaxParallelRuns))
    : next.team.maxParallelRuns;
  next.team.escalationRules = splitLines(draft.teamEscalationRules);

  next.intake.reviewRequested = draft.intakeReviewRequested;
  next.autopilot = draft.intakeAutopilot;
  next.deploy.blockers = splitLines(draft.deployBlockers);
  next.deploy.warnings = splitLines(draft.deployWarnings);
  next.deploy.firstMissions = splitLines(draft.deployFirstMissions);

  return next;
}

function summarizeBlueprintChanges(before: WorkspacePlan, after: WorkspacePlan) {
  const sections: string[] = [];

  if (hasChanged(before.company, after.company)) {
    sections.push("company");
  }

  if (hasChanged(before.product, after.product)) {
    sections.push("product");
  }

  if (hasChanged(before.workspace, after.workspace)) {
    sections.push("workspace");
  }

  if (hasChanged(before.team, after.team)) {
    sections.push("team");
  }

  if (hasChanged(
    {
      reviewRequested: before.intake.reviewRequested,
      autopilot: before.autopilot
    },
    {
      reviewRequested: after.intake.reviewRequested,
      autopilot: after.autopilot
    }
  )) {
    sections.push("intake");
  }

  if (hasChanged(before.deploy, after.deploy)) {
    sections.push("deploy");
  }

  if (sections.length === 0) {
    return "Manual blueprint edit applied.";
  }

  return `Manual blueprint edit applied to ${sections.join(", ")}.`;
}

function hasChanged(left: unknown, right: unknown) {
  return JSON.stringify(left) !== JSON.stringify(right);
}

function joinLines(values: string[]) {
  return values.join("\n");
}

function splitLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizeOptionalValue(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function StatusChip({
  surfaceTheme,
  label
}: {
  surfaceTheme: SurfaceTheme;
  label: string;
}) {
  const isLight = surfaceTheme === "light";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em]",
        isLight ? "border-[#e4ddd3] bg-[#f7f2eb] text-[#746b61]" : "border-white/10 bg-white/[0.05] text-slate-300"
      )}
    >
      {label}
    </span>
  );
}

function SectionCard({
  surfaceTheme,
  sectionId,
  highlighted = false,
  title,
  description,
  register,
  children
}: {
  surfaceTheme: SurfaceTheme;
  sectionId?: WorkspaceBlueprintSectionFocus;
  highlighted?: boolean;
  title: string;
  description: string;
  register?: (node: HTMLDivElement | null) => void;
  children: ReactNode;
}) {
  const isLight = surfaceTheme === "light";

  return (
    <section
      ref={register}
      data-blueprint-section={sectionId}
      className={cn(
        "rounded-[22px] border p-4 transition-all duration-300",
        isLight ? "border-[#e5ddd2] bg-white" : "border-white/10 bg-white/[0.04]",
        highlighted &&
          (isLight
            ? "ring-2 ring-[#d8b184]/70 shadow-[0_0_0_1px_rgba(216,177,132,0.18),0_18px_36px_rgba(102,78,47,0.16)]"
            : "ring-2 ring-cyan-300/45 shadow-[0_0_0_1px_rgba(103,232,249,0.14),0_18px_36px_rgba(6,182,212,0.16)]")
      )}
    >
      <div className="mb-4">
        <p className={cn("text-[11px] uppercase tracking-[0.18em]", isLight ? "text-[#a0978b]" : "text-slate-500")}>
          {title}
        </p>
        <p className={cn("mt-1 text-[13px] leading-6", isLight ? "text-[#6f675e]" : "text-slate-300")}>
          {description}
        </p>
      </div>

      <div className="space-y-4">{children}</div>
    </section>
  );
}

function FieldGroup({
  label,
  children
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function OptionSection<T extends string>({
  surfaceTheme,
  label,
  value,
  options,
  onChange,
  fieldRef,
  highlighted = false
}: {
  surfaceTheme: SurfaceTheme;
  label: string;
  value: T;
  options: Array<{ value: T; label: string; description: string }>;
  onChange: (value: T) => void;
  fieldRef?: (node: HTMLDivElement | null) => void;
  highlighted?: boolean;
}) {
  const isLight = surfaceTheme === "light";

  return (
    <div
      ref={fieldRef}
      tabIndex={-1}
      className={cn(
        "space-y-2 rounded-[18px] border p-3 transition-all",
        isLight ? "border-[#e8e0d6] bg-[#faf6f1]" : "border-white/10 bg-white/[0.03]",
        highlighted &&
          (isLight
            ? "ring-2 ring-[#d8b184]/60 shadow-[0_0_0_1px_rgba(216,177,132,0.12)]"
            : "ring-2 ring-cyan-300/30 shadow-[0_0_0_1px_rgba(103,232,249,0.12)]")
      )}
    >
      <Label>{label}</Label>
      <div className="grid gap-2 md:grid-cols-2">
        {options.map((option) => {
          const active = option.value === value;

          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className={cn(
                "rounded-[16px] border px-3 py-3 text-left transition-colors",
                active
                  ? isLight
                    ? "border-[#161514] bg-[#161514] text-white"
                    : "border-cyan-300 bg-cyan-300/15 text-cyan-50"
                  : isLight
                    ? "border-[#e7dfd4] bg-[#faf6f1] text-[#171410] hover:border-[#d6cab9] hover:bg-[#f6efe6]"
                    : "border-white/10 bg-white/[0.03] text-slate-100 hover:border-white/15 hover:bg-white/[0.05]"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium">{option.label}</p>
                  <p className={cn("mt-1 text-[12px] leading-5", active ? "opacity-80" : isLight ? "text-[#70685e]" : "text-slate-400")}>
                    {option.description}
                  </p>
                </div>
                {active ? <Check className="mt-0.5 h-4 w-4 shrink-0" /> : null}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RuleRow({
  surfaceTheme,
  label,
  description,
  checked,
  onToggle,
  fieldRef,
  highlighted = false
}: {
  surfaceTheme: SurfaceTheme;
  label: string;
  description: string;
  checked: boolean;
  onToggle: () => void;
  fieldRef?: (node: HTMLButtonElement | null) => void;
  highlighted?: boolean;
}) {
  const isLight = surfaceTheme === "light";

  return (
    <button
      type="button"
      onClick={onToggle}
      ref={fieldRef}
      className={cn(
        "w-full rounded-[16px] border px-3 py-3 text-left transition-colors",
        checked
          ? isLight
            ? "border-[#1f1b17] bg-[#1f1b17] text-white"
            : "border-cyan-300 bg-cyan-300/15 text-cyan-50"
          : isLight
            ? "border-[#e7dfd4] bg-[#faf6f1] text-[#171410] hover:border-[#d6cab9] hover:bg-[#f6efe6]"
            : "border-white/10 bg-white/[0.03] text-slate-100 hover:border-white/15 hover:bg-white/[0.05]",
        highlighted &&
          (isLight
            ? "ring-2 ring-[#d8b184]/60 shadow-[0_0_0_1px_rgba(216,177,132,0.12)]"
            : "ring-2 ring-cyan-300/30 shadow-[0_0_0_1px_rgba(103,232,249,0.12)]")
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium">{label}</p>
          <p className={cn("mt-1 text-[12px] leading-5", checked ? "opacity-80" : isLight ? "text-[#70685e]" : "text-slate-400")}>
            {description}
          </p>
        </div>
        <span
          className={cn(
            "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full border",
            checked
              ? isLight
                ? "border-white/25 bg-white text-[#171410]"
                : "border-white/20 bg-white text-slate-950"
              : isLight
                ? "border-[#cfc6ba] bg-transparent text-transparent"
                : "border-white/15 bg-transparent text-transparent"
          )}
        >
          <Check className="h-3 w-3" />
        </span>
      </div>
    </button>
  );
}
