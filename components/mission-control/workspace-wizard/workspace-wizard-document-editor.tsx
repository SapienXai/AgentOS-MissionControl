"use client";

import { useMemo, useState } from "react";
import { LoaderCircle, Pencil, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  buildWorkspaceScaffoldDocuments,
  normalizeWorkspaceDocOverrides
} from "@/lib/openclaw/workspace-docs";
import type { WorkspacePlan } from "@/lib/openclaw/types";
import { cn } from "@/lib/utils";

type SurfaceTheme = "dark" | "light";

type WorkspaceWizardDocumentEditorProps = {
  open: boolean;
  surfaceTheme: SurfaceTheme;
  plan: WorkspacePlan | null;
  path: string;
  busy?: boolean;
  onClose: () => void;
  onSave: (nextPlan: WorkspacePlan, summary: string) => Promise<boolean>;
};

export function WorkspaceWizardDocumentEditor({
  open,
  surfaceTheme,
  plan,
  path,
  busy = false,
  onClose,
  onSave
}: WorkspaceWizardDocumentEditorProps) {
  const isLight = surfaceTheme === "light";

  const document = useMemo(() => {
    if (!open || !plan) {
      return null;
    }

    const documents = buildWorkspaceScaffoldDocuments({
      name: plan.workspace.name || "Workspace",
      brief: plan.company.mission || plan.product.offer || undefined,
      template: plan.workspace.template,
      sourceMode: plan.workspace.sourceMode,
      rules: plan.workspace.rules,
      agents: plan.team.persistentAgents.filter((agent) => agent.enabled),
      docOverrides: plan.workspace.docOverrides,
      toolExamples: []
    });

    return documents.find((entry) => entry.path === path) ?? null;
  }, [open, path, plan]);
  const [draftValue, setDraftValue] = useState(() => document?.content ?? "");

  if (!open || !plan || !document) {
    return null;
  }

  const handleReset = () => {
    setDraftValue(document.baseContent);
  };

  const handleSave = async () => {
    const nextPlan = structuredClone(plan);
    const nextOverrides = normalizeWorkspaceDocOverrides([
      ...nextPlan.workspace.docOverrides.filter((entry) => entry.path !== document.path),
      ...(draftValue === document.baseContent
        ? []
        : [
            {
              path: document.path,
              content: draftValue
            }
          ])
    ]);

    nextPlan.workspace.docOverrides = nextOverrides;

    const summary =
      draftValue === document.baseContent
        ? `Reset ${document.path} to the generated default scaffold.`
        : `Updated ${document.path} scaffold content.`;

    const saved = await onSave(nextPlan, summary);

    if (saved) {
      onClose();
    }
  };

  return (
    <div className="absolute inset-0 z-30">
      <button
        type="button"
        aria-label="Close document editor"
        onClick={onClose}
        className={cn(
          "absolute inset-0 h-full w-full cursor-default",
          isLight ? "bg-[rgba(17,14,10,0.26)]" : "bg-[rgba(2,6,13,0.56)]"
        )}
      />

      <div
        className={cn(
          "absolute inset-y-0 right-0 flex h-full w-full flex-col border-l shadow-[0_34px_120px_rgba(0,0,0,0.35)] lg:max-w-[860px]",
          isLight
            ? "border-[#e6ded4] bg-[linear-gradient(180deg,rgba(255,253,249,0.98),rgba(247,241,233,0.98))] text-[#151311]"
            : "border-white/10 bg-[linear-gradient(180deg,rgba(5,9,18,0.98),rgba(3,7,15,0.98))] text-white"
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={cn("flex items-start justify-between gap-4 border-b px-4 py-4 md:px-5", isLight ? "border-[#e7dfd4]" : "border-white/10")}>
          <div className="min-w-0">
            <p className={cn("text-[11px] uppercase tracking-[0.18em]", isLight ? "text-[#9a9085]" : "text-slate-500")}>
              Document editor
            </p>
            <h2 className={cn("mt-1 text-[18px] font-semibold tracking-[-0.03em]", isLight ? "text-[#171410]" : "text-white")}>
              Edit the generated scaffold content
            </h2>
            <p className={cn("mt-1 text-[13px] leading-6", isLight ? "text-[#6f675e]" : "text-slate-300")}>
              Changes are stored as a document override and applied when the workspace is created.
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

        <div className={cn("flex items-center justify-between gap-3 border-b px-4 py-3 md:px-5", isLight ? "border-[#e7dfd4]" : "border-white/10")}>
          <div className="min-w-0">
            <p className={cn("font-mono text-[11px] uppercase tracking-[0.16em]", isLight ? "text-[#6f665b]" : "text-slate-300")}>
              {document.path}
            </p>
            <p className={cn("mt-1 text-[13px] leading-5", isLight ? "text-[#716960]" : "text-slate-300")}>
              {document.description}
            </p>
          </div>

          <span
            className={cn(
              "inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em]",
              document.overridden
                ? isLight
                  ? "border-[#d8b184] bg-[#f8efe3] text-[#7c5a34]"
                  : "border-cyan-300/30 bg-cyan-300/10 text-cyan-100"
                : isLight
                  ? "border-[#e0d7cc] bg-white text-[#7a7168]"
                  : "border-white/10 bg-white/[0.05] text-slate-400"
            )}
          >
            {document.overridden ? "Customized" : "Generated"}
          </span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-4 md:px-5">
          <div
            className={cn(
              "rounded-[18px] border px-4 py-3",
              isLight ? "border-[#e5ded3] bg-white" : "border-white/10 bg-white/[0.04]"
            )}
          >
            <p className={cn("text-[13px] leading-6", isLight ? "text-[#6f675e]" : "text-slate-300")}>
              This editor changes the scaffold content that will be written for {document.path}. If you reset to default, the generated version is restored.
            </p>
            {document.path === "TOOLS.md" ? (
              <p className={cn("mt-2 text-[12px] leading-5", isLight ? "text-[#7b7268]" : "text-slate-400")}>
                The final workspace will still refine this file from the repository&apos;s available commands when the scaffold is created.
              </p>
            ) : null}
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <Textarea
              value={draftValue}
              onChange={(event) => setDraftValue(event.target.value)}
              className={cn(
                "min-h-[480px] font-mono text-[12px] leading-5",
                isLight ? "border-[#dcd4c9] bg-white text-[#1a1714]" : "border-white/10 bg-[#03060d] text-slate-100"
              )}
            />
          </ScrollArea>

          <div className="flex items-center justify-between gap-3 border-t pt-3" style={{ borderColor: isLight ? "#e7dfd4" : "rgba(255,255,255,0.1)" }}>
            <Button
              type="button"
              variant="secondary"
              onClick={handleReset}
              className={
                isLight
                  ? "rounded-full border-[#ddd6cb] bg-[#f7f2eb] text-[#403934] hover:bg-[#f1ebe3]"
                  : "rounded-full border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]"
              }
            >
              Reset to default
            </Button>

            <Button
              type="button"
              onClick={handleSave}
              disabled={busy}
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
    </div>
  );
}
