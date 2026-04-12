"use client";

import {
  ChevronDown,
  LoaderCircle,
  RefreshCcw,
  SendHorizontal,
  SlidersHorizontal,
  Sparkles,
  X
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { CreateAgentDialog } from "@/components/mission-control/create-agent-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import type { MissionControlSnapshot, MissionResponse, MissionSubmission } from "@/lib/agentos/contracts";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import { cn } from "@/lib/utils";

type ThinkingLevel = NonNullable<MissionSubmission["thinking"]>;
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
type RecentPrompt = {
  id: string;
  mission: string;
  agentId: string;
  agentName: string;
  workspaceId: string | null;
  workspaceName: string | null;
  submittedAt: number;
};
type InlineSuggestion = {
  id: string;
  label: string;
  mission?: string;
  thinking?: ThinkingLevel;
  action?: "apply-mission" | "open-workspace-create";
};

const composerDraftStoragePrefix = "mission-control-composer-draft";
const recentPromptsStorageKey = "mission-control-recent-prompts";
const maxRecentPrompts = 6;

export function CommandBar({
  snapshot,
  activeWorkspaceId,
  selectedNodeId,
  composeIntent,
  isComposerActive,
  onTargetAgentChange,
  onTargetAgentSelect,
  onComposerActiveChange,
  onRefresh,
  onOpenWorkspaceCreate,
  onOpenWorkspaceChannels,
  onMissionDispatchStart,
  onMissionDispatchFailure,
  onMissionResponse
}: {
  snapshot: MissionControlSnapshot;
  activeWorkspaceId: string | null;
  selectedNodeId: string | null;
  composeIntent: ComposeIntent | null;
  isComposerActive: boolean;
  onTargetAgentChange?: (agentId: string | null) => void;
  onTargetAgentSelect?: (agentId: string) => void;
  onComposerActiveChange?: (active: boolean) => void;
  onRefresh: () => Promise<void>;
  onOpenWorkspaceCreate: () => void;
  onOpenWorkspaceChannels: (workspaceId?: string) => void;
  onMissionDispatchStart: (event: MissionDispatchStart) => void;
  onMissionDispatchFailure: (requestId: string, message: string) => void;
  onMissionResponse: (result: MissionResponse, context: { requestId: string }) => void;
}) {
  const [mission, setMission] = useState("");
  const [targetAgentId, setTargetAgentId] = useState<string>("");
  const [thinking, setThinking] = useState<ThinkingLevel>("medium");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [isDesktopLayout, setIsDesktopLayout] = useState(false);
  const [isDockHovered, setIsDockHovered] = useState(false);
  const [isCompactAfterSubmit, setIsCompactAfterSubmit] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [composeSuggestion, setComposeSuggestion] = useState<ComposerSuggestion | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const autoSelectionScopeRef = useRef<string | null>(null);
  const preferredCreatedAgentIdRef = useRef<string | null>(null);
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
  const inlineSuggestions = buildInlineSuggestions();
  const showSuggestions = inlineSuggestions.length > 0;
  const shouldForceCollapsedComposer =
    isCompactAfterSubmit &&
    !isComposerActive &&
    !isAdvancedOpen &&
    mission.trim().length === 0 &&
    composeSuggestion === null;
  const isDesktopCollapsed =
    isDesktopLayout &&
    (!isDockHovered || isSubmitting) &&
    !isComposerActive &&
    !isAdvancedOpen &&
    mission.trim().length === 0 &&
    composeSuggestion === null;
  const shouldRenderCollapsedComposer = shouldForceCollapsedComposer || isDesktopCollapsed;

  useEffect(() => {
    const selectionScope = `${activeWorkspaceId ?? "all"}:${selectedNodeId ?? "none"}:${availableAgents.map((agent) => agent.id).join(",")}`;
    const preferredAgent = resolvePreferredAgentId(snapshot, activeWorkspaceId, selectedNodeId);
    const createdAgentId = preferredCreatedAgentIdRef.current;

    if (createdAgentId && availableAgents.some((agent) => agent.id === createdAgentId)) {
      if (targetAgentId !== createdAgentId) {
        setTargetAgentId(createdAgentId);
      }
      preferredCreatedAgentIdRef.current = null;
      return;
    }

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
    setIsMounted(true);
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
    onTargetAgentChange?.(effectiveTargetAgentId ?? null);
  }, [effectiveTargetAgentId, onTargetAgentChange]);

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

      if (result.status === "stalled") {
        toast.error("Mission could not start.", {
          description: result.summary || resultDescription
        });
      } else {
        toast.success("Mission queued in OpenClaw.", {
          description: resultDescription
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

  const clearCurrentDraft = () => {
    setIsCompactAfterSubmit(false);
    setMission("");
    setThinking("medium");
    setComposeSuggestion(null);
    skipDraftSaveRef.current = true;

    if (draftScopeKey && typeof globalThis.localStorage !== "undefined") {
      globalThis.localStorage.removeItem(draftScopeKey);
    }
  };

  return (
    <div
      className={cn("mx-auto w-full transition-[width] duration-300", isDesktopCollapsed && "lg:w-[360px]")}
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
            className="w-full overflow-hidden rounded-full border border-white/[0.08] bg-[linear-gradient(180deg,rgba(10,16,26,0.96),rgba(6,10,18,0.94))] p-2 text-left shadow-[0_24px_72px_rgba(0,0,0,0.22)] isolate"
          >
            <div className="flex items-center gap-2 rounded-full border border-white/[0.07] bg-[linear-gradient(180deg,rgba(20,28,43,0.9),rgba(11,17,28,0.88))] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <span className="inline-flex h-7 items-center rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 text-[11px] text-slate-300">
                {selectedAgentLabel || "No agent"}
              </span>
              <p className="min-w-0 flex-1 truncate text-[13px] text-[#f6eee5]/58">
                {isSubmitting ? "Creating task..." : dynamicPlaceholder}
              </p>
              <span className="inline-flex h-8 items-center rounded-full bg-white px-3 text-[12px] font-medium text-slate-950">
                {isSubmitting ? (
                  <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <SendHorizontal className="mr-1.5 h-3.5 w-3.5" />
                )}
                {isSubmitting ? "Creating" : "Create task"}
              </span>
            </div>
          </motion.button>
        ) : (
          <motion.div
            key="expanded"
            initial={{ opacity: 0, y: 8, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.985 }}
            className="overflow-hidden rounded-[26px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(10,16,26,0.96),rgba(6,10,18,0.94))] p-2.5 shadow-[0_24px_72px_rgba(0,0,0,0.26)] isolate"
          >
            <AnimatePresence initial={false}>
              {composeSuggestion ? (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="mb-2 flex flex-wrap items-center gap-2 px-1 text-[12px] text-slate-400"
                >
                  <span className="truncate">From {composeSuggestion.sourceLabel}</span>
                  <button
                    type="button"
                    className="text-slate-200 transition-colors hover:text-white"
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
                    className="text-slate-200 transition-colors hover:text-white"
                    onClick={() => applyMissionSnippet(composeSuggestion.mission)}
                  >
                    Append
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white"
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
                "rounded-[22px] border border-white/[0.07] bg-[linear-gradient(180deg,rgba(20,28,43,0.92),rgba(10,16,26,0.9))] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-all duration-200",
                isComposerActive &&
                  "border-white/[0.14] bg-[linear-gradient(180deg,rgba(24,34,50,0.94),rgba(12,18,30,0.92))] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
              )}
              onFocusCapture={() => {
                setIsCompactAfterSubmit(false);
                onComposerActiveChange?.(true);
              }}
              onBlurCapture={(event) => {
                const nextTarget = event.relatedTarget;
                if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
                  onComposerActiveChange?.(false);
                }
              }}
            >
              <div className="flex items-center gap-2 px-2.5 pb-1 pt-2.5">
                {selectedAgent ? (
                  <AgentSelectorChip
                    value={targetAgentId}
                    options={agentOptions}
                    onChange={handleTargetAgentChange}
                  />
                ) : (
                  <SubtlePill>No agent</SubtlePill>
                )}

                <div className="ml-auto flex items-center gap-1">
                  <IconButton
                    label="Refresh AgentOS"
                    onClick={async () => {
                      setIsRefreshing(true);
                      await onRefresh();
                      setIsRefreshing(false);
                    }}
                  >
                    {isRefreshing ? (
                      <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCcw className="h-3.5 w-3.5" />
                    )}
                  </IconButton>

                  <IconButton label="Create workspace" onClick={onOpenWorkspaceCreate}>
                    <Sparkles className="h-3.5 w-3.5" />
                  </IconButton>

                  <IconButton
                    label="Composer settings"
                    onClick={() => setIsAdvancedOpen((current) => !current)}
                    active={isAdvancedOpen || thinking !== "medium"}
                  >
                    <span className="relative inline-flex">
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      {thinking !== "medium" ? (
                        <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-white/80" />
                      ) : null}
                    </span>
                  </IconButton>
                </div>
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

                      await submitMission({
                        mission,
                        agentId: effectiveTargetAgentId,
                        workspaceId: activeWorkspaceId ?? undefined,
                        thinking
                      });
                    }
                  }}
                  placeholder={dynamicPlaceholder}
                  className="min-h-[50px] max-h-[150px] resize-none overflow-y-auto border-0 bg-transparent px-0 py-0.5 text-[15px] leading-[1.6] text-white placeholder:text-[#f6eee5]/60 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                />
              </div>

              <div className="flex items-end justify-between gap-2.5 px-2.5 pb-2.5 pt-1.5">
                <AnimatePresence initial={false}>
                  {showSuggestions ? (
                      <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 4 }}
                        className="flex min-w-0 flex-wrap items-center gap-1.5"
                    >
                      {inlineSuggestions.map((suggestion) => (
                        <SuggestionChip
                          key={suggestion.id}
                          label={suggestion.label}
                          onClick={() => {
                            if (suggestion.action === "open-workspace-create") {
                              onOpenWorkspaceCreate();
                              return;
                            }

                            if (!suggestion.mission) {
                              return;
                            }

                            applyMissionSnippet(suggestion.mission, {
                              thinking: suggestion.thinking
                            });
                          }}
                        />
                      ))}
                      {targetWorkspace ? (
                        <CreateAgentDialog
                          snapshot={snapshot}
                          defaultWorkspaceId={targetWorkspace.id}
                          onRefresh={onRefresh}
                          onAgentCreated={(agentId) => {
                            preferredCreatedAgentIdRef.current = agentId;
                            setTargetAgentId(agentId);
                          }}
                          trigger={
                            <button
                              type="button"
                              className="inline-flex h-8 items-center rounded-full border border-white/[0.08] bg-white/[0.04] px-3 text-[12px] text-slate-300 transition-all hover:bg-white/[0.08] hover:text-white"
                            >
                              + Create Agent
                            </button>
                          }
                        />
                      ) : null}
                      {isMounted && targetWorkspace ? (
                        <button
                          type="button"
                          onClick={() => onOpenWorkspaceChannels()}
                          className="inline-flex h-8 items-center rounded-full border border-cyan-300/18 bg-cyan-400/[0.1] px-3 text-[12px] text-cyan-50 transition-all hover:border-cyan-300/28 hover:bg-cyan-400/[0.14] hover:text-white"
                        >
                          Manage Surfaces
                        </button>
                      ) : null}
                    </motion.div>
                  ) : (
                    <div />
                  )}
                </AnimatePresence>

                <Button
                  className="h-9 rounded-full bg-white px-3.5 text-slate-950 shadow-none hover:bg-white/92"
                  disabled={!canSubmit}
                  onClick={async () => {
                    if (!effectiveTargetAgentId) {
                      return;
                    }

                    await submitMission({
                      mission,
                      agentId: effectiveTargetAgentId,
                      workspaceId: activeWorkspaceId ?? undefined,
                      thinking
                    });
                  }}
                >
                  {isSubmitting ? (
                    <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <SendHorizontal className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Create task
                </Button>
              </div>
            </div>

            <AnimatePresence initial={false}>
              {isAdvancedOpen ? (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="mt-2 flex justify-end"
                >
                  <div className="w-full max-w-[232px] rounded-[20px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(14,20,31,0.96),rgba(10,15,24,0.94))] p-3 shadow-[0_16px_32px_rgba(0,0,0,0.22)]">
                    <p className="text-[11px] text-slate-300">Thinking</p>
                    <div className="mt-2">
                      <InlineSelectChip
                        ariaLabel="Select thinking level"
                        value={thinking}
                        options={[
                          { label: "off", value: "off" },
                          { label: "minimal", value: "minimal" },
                          { label: "low", value: "low" },
                          { label: "medium", value: "medium" },
                          { label: "high", value: "high" }
                        ]}
                        onChange={(value) => setThinking(value as ThinkingLevel)}
                      />
                    </div>
                    <button
                      type="button"
                      className="mt-3 text-[12px] text-slate-400 transition-colors hover:text-white"
                      onClick={clearCurrentDraft}
                    >
                      Clear draft
                    </button>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AgentSelectorChip({
  value,
  options,
  onChange
}: {
  value: string;
  options: AgentOption[];
  onChange: (value: string) => void;
}) {
  const selected = options.find((option) => option.value === value) ?? options[0];
  const isInteractive = options.length > 1;

  return (
    <div className="relative inline-flex items-center rounded-full border border-white/[0.08] bg-white/[0.04] text-slate-100">
      {isInteractive ? (
        <select
          aria-label="Select mission agent"
          value={selected?.value ?? ""}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 appearance-none bg-transparent pl-3 pr-8 text-[12px] outline-none"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <span className="px-3 text-[12px]">{selected?.label || "No agent"}</span>
      )}

      {isInteractive ? (
        <ChevronDown className="pointer-events-none absolute right-3 h-3.5 w-3.5 text-slate-400" />
      ) : null}
    </div>
  );
}

function InlineSelectChip({
  ariaLabel,
  value,
  options,
  onChange
}: {
  ariaLabel: string;
  value: string;
  options: AgentOption[];
  onChange: (value: string) => void;
}) {
  const selected = options.find((option) => option.value === value) ?? options[0];

  return (
    <div className="relative inline-flex w-full items-center rounded-full border border-white/[0.08] bg-white/[0.04] text-slate-100">
      <select
        aria-label={ariaLabel}
        value={selected?.value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full appearance-none bg-transparent pl-3 pr-9 text-[12px] outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 h-3.5 w-3.5 text-slate-400" />
    </div>
  );
}

function IconButton({
  label,
  active = false,
  onClick,
  children
}: {
  label: string;
  active?: boolean;
  onClick?: () => void | Promise<void>;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-full border border-transparent text-slate-400 transition-all hover:border-white/[0.08] hover:bg-white/[0.06] hover:text-white",
        active && "border-white/[0.08] bg-white/[0.06] text-white"
      )}
    >
      {children}
    </button>
  );
}

function SuggestionChip({
  label,
  onClick
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 items-center rounded-full border border-white/[0.08] bg-white/[0.04] px-3 text-[12px] text-slate-300 transition-all hover:bg-white/[0.08] hover:text-white"
    >
      {label}
    </button>
  );
}

function SubtlePill({ children }: { children: ReactNode }) {
  return (
    <div className="inline-flex h-8 items-center rounded-full border border-white/[0.08] bg-white/[0.04] px-3 text-[12px] text-slate-300">
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

function buildInlineSuggestions() {
  const suggestions: InlineSuggestion[] = [];

  suggestions.push({
    id: "workspace-create",
    label: "Create workspace",
    action: "open-workspace-create"
  });

  const seen = new Set<string>();

  return suggestions
    .filter((item) => {
      const key = `${item.action || "mission"}:${item.mission?.trim().toLowerCase() || item.label.toLowerCase()}`;
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .slice(0, 3);
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
