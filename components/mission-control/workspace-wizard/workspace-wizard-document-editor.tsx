"use client";

import { useEffect, useMemo, useState } from "react";
import { LoaderCircle, Pencil, Sparkles, X } from "lucide-react";
import { motion } from "motion/react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  buildWorkspaceEditableDocuments,
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
  rewriteBusy?: boolean;
  onClose: () => void;
  onSave: (nextPlan: WorkspacePlan, summary: string) => Promise<boolean>;
  onRewriteWithArchitect: (input: {
    path: string;
    currentContent: string;
    instruction?: string;
  }) => Promise<string | null>;
};

type RewriteAnimationState = {
  prefixLines: string[];
  changedFromLines: string[];
  changedToLines: string[];
  suffixLines: string[];
  changedToText: string;
  changedToCharCount: number;
  revealedCharCount: number;
  nextContent: string;
};

function splitRewriteAnimation(previousContent: string, nextContent: string): RewriteAnimationState | null {
  if (previousContent === nextContent) {
    return null;
  }

  const previousLines = previousContent.split(/\r?\n/);
  const nextLines = nextContent.split(/\r?\n/);

  let prefixCount = 0;
  while (
    prefixCount < previousLines.length &&
    prefixCount < nextLines.length &&
    previousLines[prefixCount] === nextLines[prefixCount]
  ) {
    prefixCount += 1;
  }

  let suffixCount = 0;
  while (
    suffixCount < previousLines.length - prefixCount &&
    suffixCount < nextLines.length - prefixCount &&
    previousLines[previousLines.length - 1 - suffixCount] === nextLines[nextLines.length - 1 - suffixCount]
  ) {
    suffixCount += 1;
  }

  const prefixLines = nextLines.slice(0, prefixCount);
  const changedFromLines = previousLines.slice(prefixCount, previousLines.length - suffixCount);
  const changedToLines = nextLines.slice(prefixCount, nextLines.length - suffixCount);
  const suffixLines = nextLines.slice(nextLines.length - suffixCount);
  const changedToText = changedToLines.join("\n");
  const changedToCharCount = Array.from(changedToText).length;

  return {
    prefixLines,
    changedFromLines,
    changedToLines,
    suffixLines,
    changedToText,
    changedToCharCount,
    revealedCharCount: 0,
    nextContent
  };
}

function sliceTextByCharacters(text: string, count: number) {
  if (count <= 0) {
    return "";
  }

  return Array.from(text).slice(0, count).join("");
}

export function WorkspaceWizardDocumentEditor({
  open,
  surfaceTheme,
  plan,
  path,
  busy = false,
  rewriteBusy = false,
  onClose,
  onSave,
  onRewriteWithArchitect
}: WorkspaceWizardDocumentEditorProps) {
  const isLight = surfaceTheme === "light";

  const document = useMemo(() => {
    if (!open || !plan) {
      return null;
    }

    const documents = buildWorkspaceEditableDocuments({
      name: plan.workspace.name || "Workspace",
      brief: plan.company.mission || plan.product.offer || undefined,
      template: plan.workspace.template,
      sourceMode: plan.workspace.sourceMode,
      rules: plan.workspace.rules,
      agents: plan.team.persistentAgents.filter((agent) => agent.enabled),
      docOverrides: plan.workspace.docOverrides,
      toolExamples: [],
      contextSources: plan.intake.sources
    });

    return documents.find((entry) => entry.path === path) ?? null;
  }, [open, path, plan]);
  const [draftValue, setDraftValue] = useState(() => document?.content ?? "");
  const [rewritePrompt, setRewritePrompt] = useState("");
  const [rewriteAnimation, setRewriteAnimation] = useState<RewriteAnimationState | null>(null);

  const isLocked = busy || rewriteBusy || Boolean(rewriteAnimation);

  useEffect(() => {
    if (!rewriteAnimation) {
      return;
    }

    if (rewriteAnimation.revealedCharCount >= rewriteAnimation.changedToCharCount) {
      const finishTimer = globalThis.setTimeout(() => {
        setDraftValue(rewriteAnimation.nextContent);
        setRewriteAnimation(null);
      }, 120);

      return () => {
        globalThis.clearTimeout(finishTimer);
      };
    }

    const charCount = Math.max(rewriteAnimation.changedToCharCount, 1);
    const delay = Math.max(12, Math.min(24, Math.round(1800 / charCount)));
    const timer = globalThis.setTimeout(() => {
      setRewriteAnimation((current) =>
        current
          ? {
              ...current,
              revealedCharCount: Math.min(current.revealedCharCount + 1, current.changedToCharCount)
            }
          : current
      );
    }, delay);

    return () => {
      globalThis.clearTimeout(timer);
    };
  }, [rewriteAnimation]);

  if (!open || !plan || !document) {
    return null;
  }

  const handleReset = () => {
    setDraftValue(document.baseContent);
  };

  const handleRewrite = async () => {
    const previousContent = draftValue;
    const rewrittenContent = await onRewriteWithArchitect({
      path: document.path,
      currentContent: draftValue,
      instruction: rewritePrompt.trim() || undefined
    });

    if (!rewrittenContent) {
      return;
    }

    const animation = splitRewriteAnimation(previousContent, rewrittenContent);

    if (!animation) {
      setDraftValue(rewrittenContent);
      setRewritePrompt("");
      return;
    }

    setRewriteAnimation(animation);
    setRewritePrompt("");
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
        ? document.generated
          ? `Reset ${document.path} to the generated default scaffold.`
          : `Kept ${document.path} at the loaded workspace content.`
        : document.generated
          ? `Updated ${document.path} scaffold content.`
          : `Updated ${document.path} existing file content.`;

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
        <div className={cn("flex items-center justify-between gap-4 border-b px-4 py-3 md:px-5", isLight ? "border-[#e7dfd4]" : "border-white/10")}>
          <div className="flex min-w-0 items-center gap-2">
            <p className={cn("text-[11px] uppercase tracking-[0.18em]", isLight ? "text-[#9a9085]" : "text-slate-500")}>
              Document editor
            </p>
            <span className={cn("text-[11px] uppercase tracking-[0.18em]", isLight ? "text-[#c2b6a5]" : "text-slate-600")}>
              /
            </span>
            <p className={cn("truncate font-mono text-[12px]", isLight ? "text-[#4a433b]" : "text-slate-300")}>
              {document.path}
            </p>
            <span
              className={cn(
                "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.16em]",
                document.generated
                  ? document.overridden
                    ? isLight
                      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                      : "border-emerald-300/30 bg-emerald-300/12 text-emerald-100"
                    : isLight
                      ? "border-[#e0d7cc] bg-white text-[#7a7168]"
                      : "border-white/10 bg-white/[0.05] text-slate-400"
                  : isLight
                    ? "border-cyan-200 bg-cyan-50 text-cyan-900"
                    : "border-cyan-300/25 bg-cyan-300/12 text-cyan-100"
              )}
            >
              {document.generated ? (document.overridden ? "Customized" : "Generated") : "Existing"}
            </span>
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

        <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-3 md:px-5">
          <ScrollArea className="min-h-0 flex-1">
            {rewriteAnimation ? (
              <RewritePreview surfaceTheme={surfaceTheme} animation={rewriteAnimation} />
            ) : (
              <Textarea
                value={draftValue}
                onChange={(event) => setDraftValue(event.target.value)}
                className={cn(
                  "min-h-[60vh] font-mono text-[12px] leading-5",
                  isLight ? "border-[#dcd4c9] bg-white text-[#1a1714]" : "border-white/10 bg-[#03060d] text-slate-100"
                )}
                disabled={isLocked}
              />
            )}
          </ScrollArea>

          <div className="flex items-center justify-between gap-3 border-t pt-2" style={{ borderColor: isLight ? "#e7dfd4" : "rgba(255,255,255,0.1)" }}>
            <Button
              type="button"
              variant="secondary"
              onClick={handleReset}
              disabled={isLocked}
              className={
                isLight
                  ? "rounded-full border-[#ddd6cb] bg-[#f7f2eb] text-[#403934] hover:bg-[#f1ebe3]"
                  : "rounded-full border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]"
              }
            >
              {document.generated ? "Reset to default" : "Reset to loaded content"}
            </Button>

            <Button
              type="button"
              onClick={handleSave}
              disabled={isLocked}
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

          <div className={cn("rounded-[18px] border px-4 py-3", isLight ? "border-[#e5ded3] bg-white" : "border-white/10 bg-white/[0.04]")}>
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr),auto] md:items-end">
              <div className="min-w-0">
                <label
                  htmlFor="architect-rewrite-prompt"
                  className={cn(
                    "text-[11px] uppercase tracking-[0.18em]",
                    isLight ? "text-[#8b8278]" : "text-slate-400"
                  )}
                >
                  Architect instructions
                </label>
                <Textarea
                  id="architect-rewrite-prompt"
                  value={rewritePrompt}
                  onChange={(event) => setRewritePrompt(event.target.value)}
                  placeholder="Tell Architect what to rewrite in this document."
                  className={cn(
                    "mt-2 min-h-[88px] font-sans text-[13px] leading-6",
                    isLight ? "border-[#dcd4c9] bg-white text-[#1a1714]" : "border-white/10 bg-[#03060d] text-slate-100"
                  )}
                  disabled={isLocked}
                />
                <p className={cn("mt-2 text-[12px] leading-5", isLight ? "text-[#7b7268]" : "text-slate-400")}>
                  Leave it blank for a general pass. Architect will rewrite only the changed block and keep the rest intact.
                </p>
              </div>

              <Button
                type="button"
                variant="secondary"
                onClick={handleRewrite}
                disabled={isLocked}
                className={
                  isLight
                    ? "rounded-full border-[#d8d0c4] bg-[#f8f3eb] text-[#3f3831] hover:bg-[#f1ebe4]"
                    : "rounded-full border-cyan-300/20 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/16"
                }
              >
                {rewriteBusy ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                Rewrite with Architect
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RewritePreview({
  surfaceTheme,
  animation
}: {
  surfaceTheme: SurfaceTheme;
  animation: RewriteAnimationState;
}) {
  const isLight = surfaceTheme === "light";

  const lineClassName = cn(
    "whitespace-pre-wrap break-words rounded-lg border px-3 py-2",
    isLight ? "border-[#e4ddd2] bg-white text-[#1a1714]" : "border-white/10 bg-[#040810] text-slate-100"
  );
  const revealedText = sliceTextByCharacters(animation.changedToText, animation.revealedCharCount);

  return (
    <div
      className={cn(
        "rounded-[18px] border px-4 py-3",
        isLight ? "border-[#e5ded3] bg-white" : "border-white/10 bg-white/[0.04]"
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between gap-2 whitespace-nowrap text-[9px] uppercase tracking-[0.18em] leading-none",
          isLight ? "text-[#8b8278]" : "text-slate-400"
        )}
      >
        <span className="min-w-0 truncate">Rewriting</span>
        <span
          className={cn(
            "shrink-0 rounded-full border px-2 py-0.5",
            isLight ? "border-[#dfd7cc] bg-[#faf6f1] text-[#6e6458]" : "border-white/10 bg-white/[0.04] text-slate-300"
          )}
        >
          {animation.revealedCharCount}/{animation.changedToCharCount || 1}
        </span>
      </div>

      <div className="mt-2 space-y-2 font-mono text-[12px] leading-5">
        {animation.prefixLines.length ? (
          <div className={cn("space-y-1.5", isLight ? "text-[#27231e]" : "text-slate-100")}>
            {animation.prefixLines.map((line, index) => (
              <div key={`prefix-${index}`} className="whitespace-pre-wrap break-words">
                {line || "\u00A0"}
              </div>
            ))}
          </div>
        ) : null}

        <div
          className={cn(
            "rounded-2xl border px-3 py-2.5",
            isLight ? "border-[#d8cdbc] bg-[#f9f5ef]" : "border-cyan-300/20 bg-cyan-300/6"
          )}
        >
          <div className="grid gap-2 md:grid-cols-2">
            <div className="min-w-0">
              <p className={cn("mb-1 text-[9px] uppercase tracking-[0.18em]", isLight ? "text-[#968a7c]" : "text-slate-400")}>
                Old
              </p>
              <div className={lineClassName}>
                {animation.changedFromLines.length ? (
                  animation.changedFromLines.map((line, index) => (
                    <div key={`before-${index}`} className="whitespace-pre-wrap break-words opacity-55 line-through">
                      {line || "\u00A0"}
                    </div>
                  ))
                ) : (
                  <div className="opacity-45">[empty]</div>
                )}
              </div>
            </div>

            <div className="min-w-0">
              <p className={cn("mb-1 text-[9px] uppercase tracking-[0.18em]", isLight ? "text-[#968a7c]" : "text-slate-400")}>
                New
              </p>
              <div className={cn(lineClassName, "min-h-[96px]")}>
                {animation.changedToCharCount > 0 ? (
                  <>
                    <span className="whitespace-pre-wrap break-words">{revealedText}</span>
                    {animation.revealedCharCount < animation.changedToCharCount ? (
                      <motion.span
                        aria-hidden="true"
                        className={cn(
                          "ml-0.5 inline-block align-[-0.15em] text-[1.1em] leading-none",
                          isLight ? "text-[#161514]" : "text-cyan-100"
                        )}
                        animate={{ opacity: [0, 1, 0] }}
                        transition={{ duration: 0.8, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
                      >
                        |
                      </motion.span>
                    ) : null}
                  </>
                ) : (
                  <span className={cn("opacity-45", isLight ? "text-[#7d7266]" : "text-slate-400")}>
                    [removed]
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {animation.suffixLines.length ? (
          <div className={cn("space-y-1.5", isLight ? "text-[#27231e]" : "text-slate-100")}>
            {animation.suffixLines.map((line, index) => (
              <div key={`suffix-${index}`} className="whitespace-pre-wrap break-words">
                {line || "\u00A0"}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
