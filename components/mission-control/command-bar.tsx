"use client";

import {
  CalendarClock,
  ChevronDown,
  LoaderCircle,
  SendHorizontal,
  SlidersHorizontal,
  X
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Textarea } from "@/components/ui/textarea";
import { PikoLoader } from "@/components/ui/piko-loader";
import { toast } from "@/components/ui/sonner";
import { shouldPreserveComposerOnBlur } from "@/components/mission-control/command-bar.utils";
import type { MissionControlSnapshot, MissionResponse, MissionSubmission } from "@/lib/agentos/contracts";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import { cn } from "@/lib/utils";

type ThinkingLevel = NonNullable<MissionSubmission["thinking"]>;
type ScheduleMode = "now" | "cron" | "every" | "at";
type AgentOption = { label: string; value: string };
type ComposeIntent = {
  id: string;
  mission: string;
  agentId?: string;
  sourceKind?: "copy" | "reply";
  sourceLabel?: string;
};
type ComposerSuggestion = {
  id: string;
  mission: string;
  sourceKind: "copy" | "reply";
  sourceLabel: string;
};
type DraftRecord = {
  mission: string;
  thinking: ThinkingLevel;
};
type MissionDispatchStart = {
  requestId: string;
  mission: string;
  agentId: string;
  workspaceId: string | null;
  submittedAt: number;
  abortController: AbortController;
};
type ScheduledOperationStart = { jobId: string; mission: string; agentId: string; workspaceId: string | null; scheduleLabel: string };
type RecentPrompt = {
  id: string;
  mission: string;
  agentId: string;
  agentName: string;
  workspaceId: string | null;
  workspaceName: string | null;
  submittedAt: number;
};
const composerDraftStoragePrefix = "mission-control-composer-draft";
const recentPromptsStorageKey = "mission-control-recent-prompts";
const maxRecentPrompts = 6;

export function CommandBar({
  snapshot,
  surfaceTheme,
  activeWorkspaceId,
  selectedNodeId,
  composeIntent,
  isComposerActive,
  onTargetAgentChange,
  onTargetAgentSelect,
  onComposerActiveChange,
  onRefresh,
  onMissionDispatchStart,
  onMissionDispatchFailure,
  onMissionResponse,
  onOperationScheduled
}: {
  snapshot: MissionControlSnapshot;
  surfaceTheme: "dark" | "light";
  activeWorkspaceId: string | null;
  selectedNodeId: string | null;
  composeIntent: ComposeIntent | null;
  isComposerActive: boolean;
  onTargetAgentChange?: (agentId: string | null) => void;
  onTargetAgentSelect?: (agentId: string) => void;
  onComposerActiveChange?: (active: boolean) => void;
  onRefresh: () => Promise<void>;
  onMissionDispatchStart: (event: MissionDispatchStart) => void;
  onMissionDispatchFailure: (requestId: string, message: string) => void;
  onMissionResponse: (result: MissionResponse, context: { requestId: string }) => void;
  onOperationScheduled?: (event: ScheduledOperationStart) => void;
}) {
  const [mission, setMission] = useState("");
  const [targetAgentId, setTargetAgentId] = useState<string>("");
  const [thinking, setThinking] = useState<ThinkingLevel>("medium");
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("now");
  const [cronExpression, setCronExpression] = useState("0 9 * * 1-5");
  const [recurrence, setRecurrence] = useState<"weekdays" | "daily" | "weekly" | "custom">("weekdays");
  const [recurrenceTime, setRecurrenceTime] = useState("09:00");
  const [intervalMinutes, setIntervalMinutes] = useState("60");
  const [runAt, setRunAt] = useState("");
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [isScheduleOpen, setIsScheduleOpen] = useState(false);
  const [isDesktopLayout, setIsDesktopLayout] = useState(false);
  const [isDockHovered, setIsDockHovered] = useState(false);
  const [isCompactAfterSubmit, setIsCompactAfterSubmit] = useState(false);
  const [composeSuggestion, setComposeSuggestion] = useState<ComposerSuggestion | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const commandBarRef = useRef<HTMLDivElement | null>(null);
  const pointerDownInsideRef = useRef(false);
  const autoSelectionScopeRef = useRef<string | null>(null);
  const handledComposeIntentIdRef = useRef<string | null>(null);
  const skipDraftSaveRef = useRef(false);
  const suspendDraftHydrationForScopeRef = useRef<string | null>(null);

  const targetWorkspace =
    snapshot.workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? snapshot.workspaces[0];

  const availableAgents = snapshot.agents.filter((agent) =>
    targetWorkspace ? agent.workspaceId === targetWorkspace.id : true
  );
  const selectedAgent = availableAgents.find((agent) => agent.id === targetAgentId) ?? availableAgents[0] ?? null;
  const selectedAgentLabel = selectedAgent ? formatAgentDisplayName(selectedAgent) : null;
  const effectiveTargetAgentId = selectedAgent?.id ?? null;
  const agentOptions: AgentOption[] = availableAgents.map((agent) => ({
    label: formatAgentDisplayName(agent),
    value: agent.id
  }));
  const draftScopeKey = buildDraftScopeKey(targetWorkspace?.id ?? activeWorkspaceId ?? null, effectiveTargetAgentId);
  const canSubmit = Boolean(mission.trim() && effectiveTargetAgentId && !isSubmitting);
  const dynamicPlaceholder = selectedAgentLabel ? `Compose for ${selectedAgentLabel}...` : "Compose a mission...";
  const isLightTheme = surfaceTheme === "light";
  const isComposerEmpty =
    !isComposerActive &&
    !isAdvancedOpen &&
    !isScheduleOpen &&
    mission.trim().length === 0 &&
    composeSuggestion === null;
  const shouldForceCollapsedComposer =
    isCompactAfterSubmit &&
    isComposerEmpty;
  const isDesktopCollapsed =
    isDesktopLayout &&
    (!isDockHovered || isSubmitting) &&
    isComposerEmpty;
  const isMobileCollapsed =
    !isDesktopLayout &&
    !isDockHovered &&
    isComposerEmpty;
  const shouldRenderCollapsedComposer = shouldForceCollapsedComposer || isDesktopCollapsed || isMobileCollapsed;

  useEffect(() => {
    const selectionScope = `${activeWorkspaceId ?? "all"}:${selectedNodeId ?? "none"}:${availableAgents.map((agent) => agent.id).join(",")}`;
    const preferredAgent = resolvePreferredAgentId(snapshot, activeWorkspaceId, selectedNodeId);
    if (autoSelectionScopeRef.current !== selectionScope) {
      autoSelectionScopeRef.current = selectionScope;

      if (preferredAgent && availableAgents.some((agent) => agent.id === preferredAgent)) {
        setTargetAgentId(preferredAgent);
        return;
      }
    }

    if (!availableAgents.some((agent) => agent.id === targetAgentId)) {
      setTargetAgentId(
        preferredAgent && availableAgents.some((agent) => agent.id === preferredAgent)
          ? preferredAgent
          : availableAgents[0]?.id ?? ""
      );
    }
  }, [snapshot, activeWorkspaceId, selectedNodeId, targetAgentId, availableAgents]);

  useEffect(() => {
    const mediaQuery = globalThis.matchMedia("(min-width: 1024px)");
    const syncDesktopLayout = () => {
      setIsDesktopLayout(mediaQuery.matches);

      if (!mediaQuery.matches) {
        setIsDockHovered(false);
      }
    };

    syncDesktopLayout();
    mediaQuery.addEventListener("change", syncDesktopLayout);

    return () => {
      mediaQuery.removeEventListener("change", syncDesktopLayout);
    };
  }, []);

  useEffect(() => {
    resizeTextarea(textareaRef.current);
  }, [mission]);

  useEffect(() => {
    if (!draftScopeKey || typeof globalThis.localStorage === "undefined") {
      return;
    }

    if (suspendDraftHydrationForScopeRef.current === draftScopeKey) {
      suspendDraftHydrationForScopeRef.current = null;
      return;
    }

    const storedDraft = readComposerDraft(draftScopeKey);
    skipDraftSaveRef.current = true;
    setMission(storedDraft?.mission ?? "");
    setThinking(storedDraft?.thinking ?? "medium");
    setComposeSuggestion(null);
  }, [draftScopeKey]);

  useEffect(() => {
    if (!draftScopeKey || typeof globalThis.localStorage === "undefined") {
      return;
    }

    if (skipDraftSaveRef.current) {
      skipDraftSaveRef.current = false;
      return;
    }

    writeComposerDraft(draftScopeKey, {
      mission,
      thinking
    });
  }, [draftScopeKey, mission, thinking]);

  useEffect(() => {
    if (!isComposerActive || isSubmitting) {
      return;
    }

    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      const nextText = textareaRef.current?.value ?? "";
      textareaRef.current?.setSelectionRange(nextText.length, nextText.length);
    });
  }, [isComposerActive, isSubmitting, targetAgentId]);

  useEffect(() => {
    onTargetAgentChange?.(effectiveTargetAgentId ?? null);
  }, [effectiveTargetAgentId, onTargetAgentChange]);

  useEffect(() => {
    const resetPointerDownInside = () => {
      pointerDownInsideRef.current = false;
    };

    window.addEventListener("pointerup", resetPointerDownInside);
    window.addEventListener("pointercancel", resetPointerDownInside);

    return () => {
      window.removeEventListener("pointerup", resetPointerDownInside);
      window.removeEventListener("pointercancel", resetPointerDownInside);
    };
  }, []);

  useEffect(() => {
    if (!composeIntent) {
      return;
    }

    if (handledComposeIntentIdRef.current === composeIntent.id) {
      return;
    }

    handledComposeIntentIdRef.current = composeIntent.id;
    const incomingMission = composeIntent.mission.trim();

    if (!incomingMission) {
      return;
    }

    const nextScopeKey = buildDraftScopeKey(
      targetWorkspace?.id ?? activeWorkspaceId ?? null,
      composeIntent.agentId ?? effectiveTargetAgentId
    );

    if (nextScopeKey) {
      suspendDraftHydrationForScopeRef.current = nextScopeKey;
    }

    const shouldAutoApply = mission.trim().length === 0 || mission.trim() === incomingMission;

    setComposeSuggestion({
      id: composeIntent.id,
      mission: incomingMission,
      sourceKind: composeIntent.sourceKind ?? "copy",
      sourceLabel: composeIntent.sourceLabel ?? "selected runtime"
    });

    if (shouldAutoApply) {
      setMission(incomingMission);
    }

    if (composeIntent.agentId) {
      setTargetAgentId(composeIntent.agentId);
    }

    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      if (shouldAutoApply) {
        textareaRef.current?.setSelectionRange(incomingMission.length, incomingMission.length);
      }
    });
  }, [composeIntent, mission, activeWorkspaceId, effectiveTargetAgentId, targetWorkspace?.id]);

  const handleTargetAgentChange = (value: string) => {
    setIsCompactAfterSubmit(false);
    setTargetAgentId(value);
    onTargetAgentSelect?.(value);
  };

  const submitMission = async (payload: MissionSubmission) => {
    const submittedMission = payload.mission.trim();

    if (!submittedMission) {
      return;
    }

    const previousComposeSuggestion = composeSuggestion;
    const previousAdvancedOpen = isAdvancedOpen;
    setIsSubmitting(true);
    setIsCompactAfterSubmit(true);
    const resolvedAgentId = payload.agentId || effectiveTargetAgentId;
    const submittedAt = Date.now();
    const requestId = globalThis.crypto?.randomUUID?.() || `dispatch:${submittedAt}`;
    const abortController = new AbortController();

    skipDraftSaveRef.current = true;
    setMission("");
    setComposeSuggestion(null);
    setIsAdvancedOpen(false);
    setIsDockHovered(false);
    onComposerActiveChange?.(false);

    if (resolvedAgentId) {
      onMissionDispatchStart({
        requestId,
        mission: submittedMission,
        agentId: resolvedAgentId,
        workspaceId: targetWorkspace?.id ?? activeWorkspaceId ?? null,
        submittedAt,
        abortController
      });
    }

    try {
      const response = await fetch("/api/mission", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        signal: abortController.signal,
        body: JSON.stringify({
          ...payload,
          requestId,
          mission: submittedMission
        })
      });

      const result = (await response.json()) as MissionResponse & { error?: string };

      if (!response.ok || result.error) {
        throw new Error(result.error || "OpenClaw rejected the mission.");
      }

      onMissionResponse(result, { requestId });

      if (draftScopeKey && typeof globalThis.localStorage !== "undefined") {
        globalThis.localStorage.removeItem(draftScopeKey);
      }

      if (resolvedAgentId) {
        saveRecentPrompt({
          id: globalThis.crypto?.randomUUID?.() || `${submittedAt}`,
          mission: submittedMission,
          agentId: resolvedAgentId,
          agentName: selectedAgentLabel ?? "Agent",
          workspaceId: targetWorkspace?.id ?? activeWorkspaceId,
          workspaceName: targetWorkspace?.name ?? null,
          submittedAt
        });
      }

      const resultDescription =
        typeof result.meta?.outputDirRelative === "string"
          ? `${result.status} via ${result.agentId} · ${result.meta.outputDirRelative}`
          : `${result.status} via ${result.agentId}`;
      const waitingForTranscriptOutput =
        result.status === "stalled" && isMissingTranscriptActivityMessage(result.summary);

      if (result.status === "stalled" && !waitingForTranscriptOutput) {
        toast.error("Mission could not start.", {
          description: result.summary || resultDescription
        });
      } else {
        toast.success(waitingForTranscriptOutput ? "Mission is running silently." : "Mission queued in OpenClaw.", {
          description: waitingForTranscriptOutput
            ? "AgentOS is waiting for the first transcript update."
            : resultDescription
        });
      }
      void onRefresh().catch(() => null);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      onMissionDispatchFailure(
        requestId,
        error instanceof Error ? error.message : "Unknown mission error."
      );
      setMission(submittedMission);
      setComposeSuggestion(previousComposeSuggestion);
      setIsAdvancedOpen(previousAdvancedOpen);
      setIsCompactAfterSubmit(false);
      setIsDockHovered(true);
      onComposerActiveChange?.(true);
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(submittedMission.length, submittedMission.length);
      });
      toast.error("Mission dispatch failed.", {
        description: error instanceof Error ? error.message : "Unknown mission error."
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitTask = async () => {
    if (!effectiveTargetAgentId || !mission.trim()) return;
    if (scheduleMode === "now") {
      await submitMission({ mission, agentId: effectiveTargetAgentId, workspaceId: activeWorkspaceId ?? undefined, thinking });
      return;
    }
    const invalid = (scheduleMode === "cron" && !cronExpression.trim()) ||
      (scheduleMode === "every" && (!Number.isFinite(Number(intervalMinutes)) || Number(intervalMinutes) < 1)) ||
      (scheduleMode === "at" && Number.isNaN(Date.parse(runAt)));
    if (invalid) { toast.error("Schedule is invalid."); return; }
    const trigger = scheduleMode === "cron"
      ? { kind: "cron", expression: buildRecurringCronExpression(recurrence, recurrenceTime, cronExpression), timezone }
      : scheduleMode === "every"
        ? { kind: "every", everyMs: Number(intervalMinutes) * 60_000 }
        : { kind: "at", at: new Date(runAt).toISOString(), timezone };
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/operations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", name: mission.trim().slice(0, 120), prompt: mission.trim(), agentId: effectiveTargetAgentId, workspaceId: targetWorkspace?.id ?? activeWorkspaceId, thinking, trigger, safety: { concurrency: "forbid" } })
      });
      const result = await response.json() as { error?: string; jobId?: string };
      if (!response.ok || result.error) throw new Error(result.error || "OpenClaw rejected the scheduled task.");
      if (!result.jobId) throw new Error("OpenClaw did not return a scheduled job id.");
      onOperationScheduled?.({ jobId: result.jobId, mission: mission.trim(), agentId: effectiveTargetAgentId, workspaceId: targetWorkspace?.id ?? activeWorkspaceId, scheduleLabel: formatScheduleButtonLabel({ mode: scheduleMode, recurrence, recurrenceTime, intervalMinutes, runAt }) });
      toast.success("Scheduled task created in OpenClaw.");
      setMission(""); setIsAdvancedOpen(false); setIsScheduleOpen(false); setIsCompactAfterSubmit(true); await onRefresh();
    } catch (error) {
      toast.error("Scheduled task was not created.", { description: error instanceof Error ? error.message : "Unknown error." });
    } finally { setIsSubmitting(false); }
  };

  const applyMissionSnippet = (
    snippet: string,
    options: {
      mode?: "append" | "replace";
      thinking?: ThinkingLevel;
    } = {}
  ) => {
    setIsCompactAfterSubmit(false);

    if (options.thinking) {
      setThinking(options.thinking);
    }

    setMission((current) =>
      options.mode === "replace" ? snippet : mergeMissionText(current, snippet)
    );

    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      const nextText = textareaRef.current?.value ?? "";
      textareaRef.current?.setSelectionRange(nextText.length, nextText.length);
    });
  };

  return (
    <>
      <PikoLoader
        open={isSubmitting}
        title="Submitting task"
        description="Sending the task to OpenClaw and preparing its run."
      />
      <div
        ref={commandBarRef}
        className={cn(
          "mx-auto w-full transition-[width,max-width] duration-300",
          shouldRenderCollapsedComposer && "max-w-[360px]",
          isDesktopCollapsed && "lg:w-[360px]"
        )}
        onMouseEnter={() => {
          if (isDesktopLayout && !isSubmitting) {
            setIsDockHovered(true);
          }
        }}
        onMouseLeave={() => {
          if (isDesktopLayout && !isSubmitting) {
            setIsDockHovered(false);
          }
        }}
        onPointerDownCapture={() => {
          pointerDownInsideRef.current = true;
        }}
        onFocusCapture={() => {
          setIsCompactAfterSubmit(false);
          onComposerActiveChange?.(true);
        }}
        onBlurCapture={(event) => {
          const nextTarget = event.relatedTarget;
          const activeElement = typeof document !== "undefined" ? document.activeElement : null;
          if (shouldPreserveComposerOnBlur({
            pointerDownInside: pointerDownInsideRef.current,
            relatedTargetInside: nextTarget instanceof Node && Boolean(commandBarRef.current?.contains(nextTarget)),
            activeElementInside: activeElement instanceof Node && Boolean(commandBarRef.current?.contains(activeElement))
          })) {
            return;
          }

          setIsAdvancedOpen(false);
          setIsScheduleOpen(false);
          onComposerActiveChange?.(false);
          if (!isDesktopLayout && mission.trim().length === 0 && !isAdvancedOpen && !isScheduleOpen && composeSuggestion === null) {
            setIsDockHovered(false);
          }
        }}
      >
      <AnimatePresence initial={false} mode="wait">
        {shouldRenderCollapsedComposer ? (
          <motion.button
            key="collapsed"
            type="button"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            disabled={isSubmitting}
            onFocus={() => {
              if (!isSubmitting) {
                setIsDockHovered(true);
              }
            }}
            onClick={() => {
              if (isSubmitting) {
                return;
              }

              setIsCompactAfterSubmit(false);
              setIsDockHovered(true);
              requestAnimationFrame(() => {
                textareaRef.current?.focus();
              });
            }}
            className={cn(
              "w-full overflow-hidden rounded-2xl border p-1.5 text-left backdrop-blur-xl transition-[border-color,box-shadow] isolate",
              isLightTheme
                ? "border-[#d9c9bc]/90 bg-[#fdfaf7]/95 text-[#342c28] shadow-[0_16px_38px_rgba(116,79,54,0.12)] hover:border-[#cbb2a0]"
                : "border-white/[0.09] bg-[linear-gradient(180deg,rgba(15,22,34,0.96),rgba(8,13,23,0.94))] text-slate-100 shadow-[0_20px_58px_rgba(0,0,0,0.28)] hover:border-white/[0.15]"
            )}
          >
            <div className={cn(
              "flex items-center gap-2 rounded-xl border px-2.5 py-2",
              isLightTheme
                ? "border-[#eadfd6] bg-white/78 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
                : "border-white/[0.07] bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
            )}>
              <span className={cn(
                "inline-flex h-6 max-w-[132px] items-center truncate rounded-lg border px-2 text-[11px] font-medium",
                isLightTheme
                  ? "border-[#e6d8ce] bg-[#f8f1eb] text-[#795f4e]"
                  : "border-white/[0.08] bg-white/[0.05] text-slate-300"
              )}>
                {selectedAgentLabel || "No agent"}
              </span>
              <p className={cn(
                "min-w-0 flex-1 truncate text-[13px]",
                isLightTheme ? "text-[#9b8373]" : "text-slate-400"
              )}>
                {isSubmitting ? "Creating task..." : dynamicPlaceholder}
              </p>
              <span className={cn(
                "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                isLightTheme ? "bg-[#2e2520] text-white" : "bg-white text-slate-950"
              )}>
                {isSubmitting ? (
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <SendHorizontal className="h-3.5 w-3.5" />
                )}
              </span>
            </div>
          </motion.button>
        ) : (
          <motion.div
            key="expanded"
            initial={{ opacity: 0, y: 8, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.985 }}
            className={cn(
              "overflow-hidden rounded-2xl border p-1.5 backdrop-blur-xl isolate",
              isLightTheme
                ? "border-[#d9c9bc]/90 bg-[#fdfaf7]/95 text-[#342c28] shadow-[0_18px_48px_rgba(116,79,54,0.14)]"
                : "border-white/[0.09] bg-[linear-gradient(180deg,rgba(15,22,34,0.97),rgba(8,13,23,0.96))] text-slate-100 shadow-[0_24px_72px_rgba(0,0,0,0.3)]"
            )}
          >
            <AnimatePresence initial={false}>
              {composeSuggestion ? (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className={cn("mb-1.5 flex flex-wrap items-center gap-2 px-1 text-[11px]", isLightTheme ? "text-[#8b7464]" : "text-slate-400")}
                >
                  <span className="truncate">From {composeSuggestion.sourceLabel}</span>
                  <button
                    type="button"
                    className={cn("transition-colors", isLightTheme ? "text-[#5d4535] hover:text-[#241a14]" : "text-slate-200 hover:text-white")}
                    onClick={() =>
                      applyMissionSnippet(composeSuggestion.mission, {
                        mode: "replace"
                      })
                    }
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    className={cn("transition-colors", isLightTheme ? "text-[#5d4535] hover:text-[#241a14]" : "text-slate-200 hover:text-white")}
                    onClick={() => applyMissionSnippet(composeSuggestion.mission)}
                  >
                    Append
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors",
                      isLightTheme ? "text-[#957e6e] hover:bg-[#f3e9e2] hover:text-[#241a14]" : "text-slate-400 hover:bg-white/[0.06] hover:text-white"
                    )}
                    onClick={() => setComposeSuggestion(null)}
                    aria-label="Dismiss runtime suggestion"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </motion.div>
              ) : null}
            </AnimatePresence>

            <div
              className={cn(
                "rounded-[14px] border transition-all duration-200",
                isLightTheme
                  ? "border-[#e6d8ce] bg-white/82 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
                  : "border-white/[0.07] bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
                isComposerActive &&
                  (isLightTheme
                    ? "border-[#cda98f] bg-white shadow-[0_0_0_3px_rgba(185,123,83,0.10)]"
                    : "border-rose-200/28 bg-white/[0.055] shadow-[0_0_0_3px_rgba(244,63,94,0.08)]")
              )}
            >
              <div className="flex items-center gap-2 px-2.5 pb-0.5 pt-2">
                {selectedAgent ? (
                  <AgentSelectorChip
                    value={targetAgentId}
                    options={agentOptions}
                    onChange={handleTargetAgentChange}
                    surfaceTheme={surfaceTheme}
                  />
                ) : (
                  <SubtlePill surfaceTheme={surfaceTheme}>No agent</SubtlePill>
                )}

                <span className={cn("ml-auto text-[10px]", isLightTheme ? "text-[#9b8373]" : "text-slate-500")}>Task draft</span>
              </div>

              <div className="px-2.5 pt-0.5">
                <Textarea
                  ref={textareaRef}
                  value={mission}
                  onChange={(event) => {
                    setIsCompactAfterSubmit(false);
                    setMission(event.target.value);
                  }}
                  onKeyDown={async (event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                      event.preventDefault();

                      if (!canSubmit || !effectiveTargetAgentId) {
                        return;
                      }

                      await submitTask();
                    }
                  }}
                  placeholder={dynamicPlaceholder}
                  className={cn(
                    "min-h-[54px] max-h-[120px] resize-none overflow-y-auto border-0 bg-transparent px-0 py-1 text-[14px] leading-6 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0",
                    isLightTheme ? "text-[#342c28] placeholder:text-[#a88f7d]" : "text-slate-100 placeholder:text-slate-500"
                  )}
                />
              </div>

              <div className="flex items-center justify-between gap-2 px-2.5 pb-2 pt-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <button
                    type="button"
                    aria-label="Thinking level"
                    title="Choose thinking level"
                    onClick={() => { setIsAdvancedOpen((current) => !current); setIsScheduleOpen(false); }}
                    className={cn("inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 text-[10px] font-medium transition-colors", isLightTheme ? "border-[#e7d9cf] text-[#806856] hover:border-[#cfad96] hover:bg-[#f8f0ea]" : "border-white/[0.08] text-slate-400 hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-slate-200")}
                  >
                    <SlidersHorizontal className="h-3 w-3" />
                    {thinking === "medium" ? "Balanced" : `Thinking: ${thinking}`}
                  </button>
                  <button
                    type="button"
                    aria-label="Task schedule"
                    title="Choose when this task runs"
                    onClick={() => { setIsScheduleOpen((current) => !current); setIsAdvancedOpen(false); }}
                    className={cn("inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 text-[10px] font-medium transition-colors", scheduleMode !== "now" && (isLightTheme ? "border-[#cfad96] bg-[#f8f0ea] text-[#654735]" : "border-cyan-300/25 bg-cyan-300/[0.08] text-cyan-100"), isLightTheme ? "border-[#e7d9cf] text-[#806856] hover:border-[#cfad96] hover:bg-[#f8f0ea]" : "border-white/[0.08] text-slate-400 hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-slate-200")}
                  >
                    <CalendarClock className="h-3 w-3" />
                    {formatScheduleButtonLabel({ mode: scheduleMode, recurrence, recurrenceTime, intervalMinutes, runAt })}
                  </button>
                </div>
                <span className={cn("hidden text-[10px] sm:inline", isLightTheme ? "text-[#a18978]" : "text-slate-500")}>⌘↵ to send</span>
                <button
                  type="button"
                  aria-label="Create task"
                  title="Create task"
                  className={cn(
                    "inline-flex h-8 w-8 items-center justify-center rounded-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-40",
                    isLightTheme ? "bg-[#332720] text-white hover:bg-[#4a382d]" : "bg-white text-slate-950 hover:bg-slate-100"
                  )}
                  disabled={!canSubmit}
                  onClick={async () => {
                    if (!effectiveTargetAgentId) {
                      return;
                    }

                    await submitTask();
                  }}
                >
                  {isSubmitting ? (
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <SendHorizontal className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>

            <AnimatePresence initial={false}>
              {isAdvancedOpen ? (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="mt-1.5"
                >
                  <div className={cn(
                    "flex flex-wrap items-center gap-2 rounded-[10px] border px-2.5 py-2",
                    isLightTheme
                      ? "border-[#dfcfc3] bg-[#fffcf9]"
                      : "border-white/[0.08] bg-white/[0.025]"
                  )}>
                    <span className={cn("mr-1 text-[10px] font-semibold", isLightTheme ? "text-[#806856]" : "text-slate-300")}>Thinking</span>
                    {(["off", "minimal", "low", "medium", "high"] as ThinkingLevel[]).map((level) => <button key={level} type="button" onClick={() => setThinking(level)} className={cn("h-7 rounded-md border px-2 text-[10px] font-medium transition-colors", thinking === level ? "border-primary/35 bg-primary/10 text-primary" : isLightTheme ? "border-[#e7d9cf] text-[#806856] hover:bg-[#f8f0ea]" : "border-white/[0.08] text-slate-400 hover:bg-white/[0.06]")}>{level === "medium" ? "Balanced" : level}</button>)}
                  </div>
                </motion.div>
              ) : null}
              {isScheduleOpen ? <SchedulePopover mode={scheduleMode} recurrence={recurrence} recurrenceTime={recurrenceTime} cronExpression={cronExpression} timezone={timezone} intervalMinutes={intervalMinutes} runAt={runAt} surfaceTheme={surfaceTheme} onModeChange={setScheduleMode} onRecurrenceChange={setRecurrence} onRecurrenceTimeChange={setRecurrenceTime} onCronChange={setCronExpression} onTimezoneChange={setTimezone} onIntervalChange={setIntervalMinutes} onRunAtChange={setRunAt} /> : null}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
      </div>

    </>
  );
}

function SchedulePopover({ mode, recurrence, recurrenceTime, cronExpression, timezone, intervalMinutes, runAt, surfaceTheme, onModeChange, onRecurrenceChange, onRecurrenceTimeChange, onCronChange, onTimezoneChange, onIntervalChange, onRunAtChange }: {
  mode: ScheduleMode; recurrence: "weekdays" | "daily" | "weekly" | "custom"; recurrenceTime: string; cronExpression: string; timezone: string; intervalMinutes: string; runAt: string; surfaceTheme: "dark" | "light";
  onModeChange: (value: ScheduleMode) => void; onRecurrenceChange: (value: "weekdays" | "daily" | "weekly" | "custom") => void; onRecurrenceTimeChange: (value: string) => void; onCronChange: (value: string) => void; onTimezoneChange: (value: string) => void; onIntervalChange: (value: string) => void; onRunAtChange: (value: string) => void;
}) {
  const isLight = surfaceTheme === "light";
  const inputClass = cn("h-7 rounded-md border bg-transparent px-2 text-[10px] outline-none focus:ring-2 focus:ring-primary/20", isLight ? "border-[#e7d9cf] text-[#46352b]" : "border-white/[0.1] text-slate-100");
  const optionClass = isLight ? "border-[#e7d9cf] text-[#806856] hover:bg-[#f8f0ea]" : "border-white/[0.08] text-slate-400 hover:bg-white/[0.06]";
  return <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className={cn("mt-1.5 flex flex-wrap items-center gap-1.5 rounded-[10px] border px-2.5 py-2", isLight ? "border-[#dfcfc3] bg-[#fffcf9]" : "border-white/[0.08] bg-white/[0.025]")}><span className={cn("mr-1 text-[10px] font-semibold", isLight ? "text-[#806856]" : "text-slate-300")}>Schedule</span><ScheduleChoice label="Now" active={mode === "now"} onClick={() => onModeChange("now")} surfaceTheme={surfaceTheme} /><ScheduleChoice label="Once" active={mode === "at"} onClick={() => onModeChange("at")} surfaceTheme={surfaceTheme} /><ScheduleChoice label="Recurring" active={mode === "cron"} onClick={() => onModeChange("cron")} surfaceTheme={surfaceTheme} /><ScheduleChoice label="Interval" active={mode === "every"} onClick={() => onModeChange("every")} surfaceTheme={surfaceTheme} />{mode === "cron" ? <><span className={cn("ml-1 text-[10px]", isLight ? "text-[#9b8373]" : "text-slate-500")}>Repeat</span>{([ ["Weekdays", "weekdays"], ["Daily", "daily"], ["Monday", "weekly"], ["Custom", "custom"] ] as const).map(([label, value]) => <button key={value} type="button" onClick={() => onRecurrenceChange(value)} className={cn("h-7 rounded-md border px-2 text-[10px]", recurrence === value ? "border-primary/35 bg-primary/10 text-primary" : optionClass)}>{label}</button>)}{recurrence === "custom" ? <input aria-label="Cron expression" value={cronExpression} onChange={(event) => onCronChange(event.target.value)} className={cn(inputClass, "w-[112px]")} /> : <input aria-label="Recurring time" type="time" value={recurrenceTime} onChange={(event) => onRecurrenceTimeChange(event.target.value)} className={inputClass} />}<input aria-label="Schedule timezone" value={timezone} onChange={(event) => onTimezoneChange(event.target.value)} className={cn(inputClass, "w-[132px]")} /></> : null}{mode === "every" ? <><span className={cn("ml-1 text-[10px]", isLight ? "text-[#9b8373]" : "text-slate-500")}>Every</span><input aria-label="Interval minutes" type="number" min="1" value={intervalMinutes} onChange={(event) => onIntervalChange(event.target.value)} className={cn(inputClass, "w-16")} /><span className={cn("text-[10px]", isLight ? "text-[#9b8373]" : "text-slate-500")}>minutes</span></> : null}{mode === "at" ? <><span className={cn("ml-1 text-[10px]", isLight ? "text-[#9b8373]" : "text-slate-500")}>Run at</span><input aria-label="Run at" type="datetime-local" value={runAt} onChange={(event) => onRunAtChange(event.target.value)} className={inputClass} /></> : null}{mode === "now" ? <span className={cn("text-[10px]", isLight ? "text-[#9b8373]" : "text-slate-500")}>Dispatches immediately</span> : null}</motion.div>;
}

function ScheduleChoice({ label, active, onClick, surfaceTheme }: { label: string; active: boolean; onClick: () => void; surfaceTheme: "dark" | "light" }) {
  return <button type="button" onClick={onClick} className={cn("h-7 rounded-md border px-2 text-[10px] font-medium transition-colors", active ? "border-primary/35 bg-primary/10 text-primary" : surfaceTheme === "light" ? "border-[#e7d9cf] text-[#806856] hover:bg-[#f8f0ea]" : "border-white/[0.08] text-slate-400 hover:bg-white/[0.06] hover:text-slate-200")}>{label}</button>;
}

function buildRecurringCronExpression(
  recurrence: "weekdays" | "daily" | "weekly" | "custom",
  time: string,
  customExpression: string
) {
  if (recurrence === "custom") return customExpression;
  const [hour = "9", minute = "0"] = time.split(":");
  return recurrence === "daily" ? `${Number(minute)} ${Number(hour)} * * *` : recurrence === "weekly" ? `${Number(minute)} ${Number(hour)} * * 1` : `${Number(minute)} ${Number(hour)} * * 1-5`;
}

function formatScheduleButtonLabel(input: { mode: ScheduleMode; recurrence: "weekdays" | "daily" | "weekly" | "custom"; recurrenceTime: string; intervalMinutes: string; runAt: string }) {
  if (input.mode === "now") return "Schedule";
  if (input.mode === "every") return `Every ${input.intervalMinutes}m`;
  if (input.mode === "at") return input.runAt ? `Once · ${new Date(input.runAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : "One time";
  const label = input.recurrence === "daily" ? "Daily" : input.recurrence === "weekly" ? "Monday" : input.recurrence === "custom" ? "Custom" : "Weekdays";
  return `${label} · ${input.recurrenceTime}`;
}

function isMissingTranscriptActivityMessage(value: string | null | undefined) {
  return (
    typeof value === "string" &&
    (/No transcript file was found for this runtime session/i.test(value) ||
      /No transcript entries were found for this runtime/i.test(value))
  );
}

function AgentSelectorChip({
  value,
  options,
  onChange,
  surfaceTheme
}: {
  value: string;
  options: AgentOption[];
  onChange: (value: string) => void;
  surfaceTheme: "dark" | "light";
}) {
  const selected = options.find((option) => option.value === value) ?? options[0];
  const isInteractive = options.length > 1;

  return (
    <div className={cn(
      "relative inline-flex max-w-[220px] items-center rounded-lg border",
      surfaceTheme === "light"
        ? "border-[#e5d7cd] bg-[#f9f2ec] text-[#705947]"
        : "border-white/[0.08] bg-white/[0.04] text-slate-100"
    )}>
      {isInteractive ? (
        <select
          aria-label="Select mission agent"
          value={selected?.value ?? ""}
          onChange={(event) => onChange(event.target.value)}
          className="h-7 max-w-[220px] appearance-none bg-transparent pl-2.5 pr-7 text-[11px] outline-none"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <span className="truncate px-2.5 text-[11px]">{selected?.label || "No agent"}</span>
      )}

      {isInteractive ? (
        <ChevronDown className={cn("pointer-events-none absolute right-2.5 h-3 w-3", surfaceTheme === "light" ? "text-[#9a806e]" : "text-slate-400")} />
      ) : null}
    </div>
  );
}

function SubtlePill({ children, surfaceTheme }: { children: ReactNode; surfaceTheme: "dark" | "light" }) {
  return (
    <div className={cn(
      "inline-flex h-7 items-center rounded-lg border px-2.5 text-[11px]",
      surfaceTheme === "light"
        ? "border-[#e5d7cd] bg-[#f9f2ec] text-[#705947]"
        : "border-white/[0.08] bg-white/[0.04] text-slate-300"
    )}>
      {children}
    </div>
  );
}

function resolvePreferredAgentId(
  snapshot: MissionControlSnapshot,
  activeWorkspaceId: string | null,
  selectedNodeId: string | null
) {
  const selectedAgent = snapshot.agents.find((agent) => agent.id === selectedNodeId);
  if (selectedAgent) {
    return selectedAgent.id;
  }

  const selectedTask = snapshot.tasks.find((task) => task.id === selectedNodeId);
  if (selectedTask?.primaryAgentId) {
    return selectedTask.primaryAgentId;
  }

  const selectedRuntime = snapshot.runtimes.find((runtime) => runtime.id === selectedNodeId);
  if (selectedRuntime?.agentId) {
    return selectedRuntime.agentId;
  }

  const workspaceAgents = snapshot.agents.filter((agent) =>
    activeWorkspaceId ? agent.workspaceId === activeWorkspaceId : agent.isDefault
  );

  return workspaceAgents.find((agent) => agent.isDefault)?.id || workspaceAgents[0]?.id || snapshot.agents[0]?.id;
}

function buildDraftScopeKey(workspaceId: string | null, agentId: string | null) {
  if (!workspaceId && !agentId) {
    return null;
  }

  return `${composerDraftStoragePrefix}:${workspaceId ?? "global"}:${agentId ?? "unassigned"}`;
}

function readComposerDraft(scopeKey: string): DraftRecord | null {
  try {
    const rawValue = globalThis.localStorage.getItem(scopeKey);

    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue) as Partial<DraftRecord>;

    if (typeof parsed.mission !== "string") {
      return null;
    }

    return {
      mission: parsed.mission,
      thinking: isThinkingLevel(parsed.thinking) ? parsed.thinking : "medium"
    };
  } catch {
    return null;
  }
}

function writeComposerDraft(scopeKey: string, draft: DraftRecord) {
  try {
    if (!draft.mission.trim() && draft.thinking === "medium") {
      globalThis.localStorage.removeItem(scopeKey);
      return;
    }

    globalThis.localStorage.setItem(scopeKey, JSON.stringify(draft));
  } catch {
    // Ignore storage failures so the composer still works without persistence.
  }
}

function readRecentPrompts(): RecentPrompt[] {
  try {
    const rawValue = globalThis.localStorage.getItem(recentPromptsStorageKey);

    if (!rawValue) {
      return [];
    }

    const parsed = JSON.parse(rawValue);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((entry): entry is RecentPrompt => {
        return (
          typeof entry === "object" &&
          entry !== null &&
          typeof entry.id === "string" &&
          typeof entry.mission === "string" &&
          typeof entry.agentId === "string" &&
          typeof entry.agentName === "string" &&
          typeof entry.submittedAt === "number"
        );
      })
      .slice(0, maxRecentPrompts);
  } catch {
    return [];
  }
}

function saveRecentPrompt(entry: RecentPrompt) {
  const nextEntries = [
    entry,
    ...readRecentPrompts().filter(
      (existing) =>
        !(
          existing.mission.trim() === entry.mission.trim() &&
          existing.agentId === entry.agentId &&
          existing.workspaceId === entry.workspaceId
        )
    )
  ].slice(0, maxRecentPrompts);

  try {
    globalThis.localStorage.setItem(recentPromptsStorageKey, JSON.stringify(nextEntries));
  } catch {
    return nextEntries;
  }

  return nextEntries;
}

function resizeTextarea(textarea: HTMLTextAreaElement | null) {
  if (!textarea) {
    return;
  }

  textarea.style.height = "0px";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
}

function mergeMissionText(current: string, next: string) {
  const trimmedCurrent = current.trim();
  const trimmedNext = next.trim();

  if (!trimmedCurrent) {
    return trimmedNext;
  }

  if (!trimmedNext) {
    return trimmedCurrent;
  }

  return `${trimmedCurrent}\n\n${trimmedNext}`;
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return value === "off" || value === "minimal" || value === "low" || value === "medium" || value === "high";
}
