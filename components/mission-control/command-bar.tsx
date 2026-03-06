"use client";

import { ChevronDown, Link2, LoaderCircle, Plus, RefreshCcw, SendHorizontal, SlidersHorizontal, Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import type { MissionControlSnapshot, MissionResponse, MissionSubmission } from "@/lib/openclaw/types";
import { cn } from "@/lib/utils";

type ThinkingLevel = NonNullable<MissionSubmission["thinking"]>;
type AgentOption = { label: string; value: string };

export function CommandBar({
  snapshot,
  activeWorkspaceId,
  selectedNodeId,
  composeIntent,
  onRefresh,
  onMissionResponse,
  onMissionDispatchStart,
  onMissionDispatchComplete
}: {
  snapshot: MissionControlSnapshot;
  activeWorkspaceId: string | null;
  selectedNodeId: string | null;
  composeIntent: {
    id: string;
    mission: string;
    agentId?: string;
  } | null;
  onRefresh: () => Promise<void>;
  onMissionResponse: (result: MissionResponse) => void;
  onMissionDispatchStart: (payload: {
    id: string;
    mission: string;
    agentId: string;
    workspaceId: string | null;
    submittedAt: number;
  }) => void;
  onMissionDispatchComplete: (status: "success" | "error") => void;
}) {
  const [mission, setMission] = useState("");
  const [targetAgentId, setTargetAgentId] = useState<string>("");
  const [thinking, setThinking] = useState<ThinkingLevel>("medium");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceDirectory, setWorkspaceDirectory] = useState("");
  const [workspaceModel, setWorkspaceModel] = useState("");
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const autoSelectionScopeRef = useRef<string | null>(null);

  const targetWorkspace =
    snapshot.workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? snapshot.workspaces[0];

  const availableAgents = snapshot.agents.filter((agent) =>
    targetWorkspace ? agent.workspaceId === targetWorkspace.id : true
  );
  const selectedAgent = availableAgents.find((agent) => agent.id === targetAgentId) ?? availableAgents[0] ?? null;
  const agentOptions: AgentOption[] = availableAgents.map((agent) => ({
    label: agent.name,
    value: agent.id
  }));

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
      setTargetAgentId(preferredAgent && availableAgents.some((agent) => agent.id === preferredAgent) ? preferredAgent : availableAgents[0]?.id ?? "");
    }
  }, [snapshot, activeWorkspaceId, selectedNodeId, targetAgentId, availableAgents]);

  useEffect(() => {
    if (!composeIntent) {
      return;
    }

    setMission(composeIntent.mission);

    if (composeIntent.agentId) {
      setTargetAgentId(composeIntent.agentId);
    }

    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(composeIntent.mission.length, composeIntent.mission.length);
    });
  }, [composeIntent]);

  const handleTargetAgentChange = (value: string) => {
    setTargetAgentId(value);
  };

  const submitMission = async (payload: MissionSubmission) => {
    setIsSubmitting(true);
    const resolvedAgentId = payload.agentId || selectedAgent?.id;
    const dispatchId = globalThis.crypto?.randomUUID?.() || `dispatch-${Date.now()}`;
    const submittedAt = Date.now();

    if (resolvedAgentId) {
      onMissionDispatchStart({
        id: dispatchId,
        mission: payload.mission,
        agentId: resolvedAgentId,
        workspaceId: payload.workspaceId ?? activeWorkspaceId,
        submittedAt
      });
    }

    try {
      const response = await fetch("/api/mission", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const result = (await response.json()) as MissionResponse & { error?: string };

      if (!response.ok || result.error) {
        throw new Error(result.error || "OpenClaw rejected the mission.");
      }

      onMissionResponse(result);
      onMissionDispatchComplete("success");
      setMission("");
      toast.success("Mission dispatched to OpenClaw.", {
        description: `Run ${result.runId.slice(0, 8)} via ${result.agentId}`
      });
      await onRefresh();
    } catch (error) {
      onMissionDispatchComplete("error");
      toast.error("Mission dispatch failed.", {
        description: error instanceof Error ? error.message : "Unknown mission error."
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const createWorkspace = async () => {
    setIsCreatingWorkspace(true);

    try {
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: workspaceName,
          directory: workspaceDirectory || undefined,
          modelId: workspaceModel || undefined
        })
      });

      const result = (await response.json()) as { workspacePath?: string; agentId?: string; error?: string };

      if (!response.ok || result.error) {
        throw new Error(result.error || "OpenClaw could not create the workspace.");
      }

      toast.success("Workspace created in OpenClaw.", {
        description: result.workspacePath
      });
      setWorkspaceName("");
      setWorkspaceDirectory("");
      setWorkspaceModel("");
      setIsCreateOpen(false);
      await onRefresh();
    } catch (error) {
      toast.error("Workspace creation failed.", {
        description: error instanceof Error ? error.message : "Unknown workspace error."
      });
    } finally {
      setIsCreatingWorkspace(false);
    }
  };

  return (
    <div className="panel-surface panel-glow rounded-[22px] border border-white/[0.08] bg-slate-950/72 px-2.5 py-2.5 shadow-[0_20px_58px_rgba(0,0,0,0.38)] backdrop-blur-2xl lg:rounded-[24px] lg:px-3 lg:py-2">
      <div className="flex flex-col gap-2 lg:gap-1.5">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[9px] uppercase tracking-[0.26em] text-slate-500">Mission input</p>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {targetWorkspace ? <Badge variant="muted">{targetWorkspace.name}</Badge> : null}
              {selectedAgent ? (
                <AgentSelectorChip
                  value={targetAgentId}
                  options={agentOptions}
                  onChange={handleTargetAgentChange}
                />
              ) : null}
              <InlineSelectChip
                ariaLabel="Select thinking level"
                value={thinking}
                options={[
                  { label: "thinking off", value: "off" },
                  { label: "thinking minimal", value: "minimal" },
                  { label: "thinking low", value: "low" },
                  { label: "thinking medium", value: "medium" },
                  { label: "thinking high", value: "high" }
                ]}
                onChange={(value) => setThinking(value as ThinkingLevel)}
                tone="neutral"
              />
            </div>
          </div>

          <div className="flex items-center gap-1.5 lg:shrink-0">
            <Button
              variant="secondary"
              size="sm"
              className="h-7 rounded-full px-2 text-[11px]"
              onClick={async () => {
                setIsRefreshing(true);
                await onRefresh();
                setIsRefreshing(false);
              }}
            >
              {isRefreshing ? <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />}
              Refresh
            </Button>

            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button variant="secondary" size="sm" className="h-7 rounded-full px-2 text-[11px]">
                  <Plus className="mr-1.5 h-3 w-3" />
                  Create workspace
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create a new OpenClaw workspace</DialogTitle>
                  <DialogDescription>
                    This creates a real workspace directory and a default OpenClaw agent entry.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="workspace-name">Workspace name</Label>
                    <Input
                      id="workspace-name"
                      value={workspaceName}
                      onChange={(event) => setWorkspaceName(event.target.value)}
                      placeholder="AgentOS launch lane"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="workspace-directory">Directory override</Label>
                    <Input
                      id="workspace-directory"
                      value={workspaceDirectory}
                      onChange={(event) => setWorkspaceDirectory(event.target.value)}
                      placeholder="Optional absolute directory"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="workspace-model">Default model</Label>
                    <select
                      id="workspace-model"
                      value={workspaceModel}
                      onChange={(event) => setWorkspaceModel(event.target.value)}
                      className="flex h-11 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white outline-none"
                    >
                      <option value="">Use OpenClaw default</option>
                      {snapshot.models.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.id}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="secondary" onClick={() => setIsCreateOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={createWorkspace} disabled={isCreatingWorkspace || !workspaceName.trim()}>
                    {isCreatingWorkspace ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Create
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="grid gap-1.5 lg:grid-cols-[minmax(0,1fr),138px]">
          <div className="rounded-[16px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(15,23,42,0.88),rgba(9,15,27,0.92))] p-1.5 lg:rounded-[15px] lg:p-1">
            <Textarea
              ref={textareaRef}
              value={mission}
              onChange={(event) => setMission(event.target.value)}
              placeholder="Enter your command..."
              className="min-h-[34px] resize-none border-0 bg-transparent px-2 py-1.5 text-[12.5px] leading-5 text-white placeholder:text-slate-500 focus-visible:ring-0 focus-visible:ring-offset-0 lg:min-h-[28px] lg:px-1.5 lg:py-1 lg:text-[12px]"
            />
          </div>

          <Button
            className={cn(
              "h-[50px] rounded-[16px] border border-cyan-200/20 bg-[linear-gradient(180deg,#3ea5ff_0%,#1464dd_100%)] text-white shadow-[0_14px_30px_rgba(20,100,221,0.34)] hover:brightness-110 lg:h-[44px]",
              "flex-col items-start justify-center gap-0.5 px-3.5"
            )}
            disabled={isSubmitting || !mission.trim() || !targetAgentId}
            onClick={async () => {
              await submitMission({
                mission,
                agentId: targetAgentId,
                workspaceId: activeWorkspaceId ?? undefined,
                thinking
              });
            }}
          >
            <span className="flex items-center gap-1 text-[9px] uppercase tracking-[0.2em] text-white/75">
              {isSubmitting ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              Dispatch
            </span>
            <span className="flex items-center gap-1.5 font-display text-[0.88rem] lg:text-[0.83rem]">
              <SendHorizontal className="h-3 w-3" />
              Launch mission
            </span>
          </Button>
        </div>

        <AnimatePresence initial={false}>
          {isSubmitting ? (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="rounded-[12px] border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-[9px] text-cyan-100"
            >
              OpenClaw is processing the mission against the live gateway.
            </motion.div>
          ) : null}
        </AnimatePresence>

        <div className="flex flex-wrap items-center gap-1">
            <ActionChip
              icon={Plus}
              label="Add Task"
              onClick={() => setMission((current) => current || snapshot.missionPresets[0] || "Create a new task for the selected workspace.")}
            />
            <ActionChip
              icon={Link2}
              label="Link Agent"
              onClick={() =>
                setMission(
                  (current) =>
                    current ||
                    `Link ${selectedAgent?.name || "the selected agent"} into the mission plan and define its first handoff.`
                )
              }
            />
            <ActionChip
              icon={SlidersHorizontal}
              label="Set Priority"
              onClick={() => {
                setThinking("high");
                setMission((current) => current || "Prioritize the mission and define the critical path.");
              }}
            />
        </div>
      </div>
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
    <div
      className={cn(
        "relative inline-flex items-center rounded-full border transition-colors",
        isInteractive
          ? "border-cyan-300/18 bg-cyan-400/10 text-cyan-50"
          : "border-white/[0.08] bg-white/[0.04] text-slate-200"
      )}
    >
      {isInteractive ? (
        <select
          aria-label="Select mission agent"
          value={selected?.value ?? ""}
          onChange={(event) => onChange(event.target.value)}
          className="h-6 appearance-none bg-transparent pl-2.5 pr-7 text-[11px] text-current outline-none"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <span className="px-2.5 text-[11px]">{selected?.label || "No agent"}</span>
      )}

      {isInteractive ? (
        <ChevronDown className="pointer-events-none absolute right-2 h-3 w-3 text-cyan-200/80" />
      ) : null}
    </div>
  );
}

function InlineSelectChip({
  ariaLabel,
  value,
  options,
  onChange,
  tone
}: {
  ariaLabel: string;
  value: string;
  options: AgentOption[];
  onChange: (value: string) => void;
  tone: "accent" | "neutral";
}) {
  const selected = options.find((option) => option.value === value) ?? options[0];

  return (
    <div
      className={cn(
        "relative inline-flex items-center rounded-full border transition-colors",
        tone === "accent"
          ? "border-cyan-300/18 bg-cyan-400/10 text-cyan-50"
          : "border-white/[0.08] bg-white/[0.04] text-slate-200"
      )}
    >
      <select
        aria-label={ariaLabel}
        value={selected?.value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        className="h-6 appearance-none bg-transparent pl-2.5 pr-7 text-[11px] text-current outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className={cn(
          "pointer-events-none absolute right-2 h-3 w-3",
          tone === "accent" ? "text-cyan-200/80" : "text-slate-400"
        )}
      />
    </div>
  );
}

function ActionChip({
  icon: Icon,
  label,
  onClick
}: {
  icon: typeof Plus;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-7 items-center gap-1.5 rounded-[11px] border border-white/[0.08] bg-slate-950/50 px-2.5 text-[11px] font-medium text-slate-200 transition-all hover:border-cyan-300/20 hover:bg-white/[0.06] hover:text-white"
    >
      <Icon className="h-3 w-3 text-cyan-300" />
      {label}
    </button>
  );
}

function ControlSelect({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex h-7 items-center gap-1.5 rounded-[11px] border border-white/[0.08] bg-slate-950/50 px-2 text-slate-300">
      <span className="text-[8px] uppercase tracking-[0.2em] text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-full min-w-0 flex-1 bg-transparent text-[11px] text-white outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
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

  const selectedRuntime = snapshot.runtimes.find((runtime) => runtime.id === selectedNodeId);
  if (selectedRuntime?.agentId) {
    return selectedRuntime.agentId;
  }

  const workspaceAgents = snapshot.agents.filter((agent) =>
    activeWorkspaceId ? agent.workspaceId === activeWorkspaceId : agent.isDefault
  );

  return workspaceAgents.find((agent) => agent.isDefault)?.id || workspaceAgents[0]?.id || snapshot.agents[0]?.id;
}
