"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

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
import { toast } from "@/components/ui/sonner";
import { ChannelBindingPicker } from "@/components/mission-control/channel-binding-picker";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AGENT_FILE_ACCESS_OPTIONS,
  AGENT_INSTALL_SCOPE_OPTIONS,
  AGENT_MISSING_TOOL_BEHAVIOR_OPTIONS,
  AGENT_NETWORK_ACCESS_OPTIONS,
  AGENT_PRESET_OPTIONS,
  getAgentPresetMeta
} from "@/lib/openclaw/agent-presets";
import {
  AGENT_HEARTBEAT_INTERVAL_OPTIONS,
  defaultHeartbeatForPreset
} from "@/lib/openclaw/agent-heartbeat";
import { syncWorkspaceAgentChannelBindings } from "@/lib/openclaw/channel-bindings";
import type { AgentPreset, MissionControlSnapshot } from "@/lib/agentos/contracts";
import { AgentPolicySelect, AgentPresetCard, FormField } from "@/components/mission-control/create-agent-dialog.parts";
import {
  applyAgentPreset,
  buildAgentDraft,
  buildUniqueAgentId,
  type AgentDraft
} from "@/components/mission-control/create-agent-dialog.utils";

export function CreateAgentDialog({
  snapshot,
  defaultWorkspaceId,
  onRefresh,
  onSnapshotChange,
  onAgentCreated,
  trigger
}: {
  snapshot: MissionControlSnapshot;
  defaultWorkspaceId?: string | null;
  onRefresh: () => Promise<void>;
  onSnapshotChange?: (updater: (snapshot: MissionControlSnapshot) => MissionControlSnapshot) => void;
  onAgentCreated?: (agentId: string) => void;
  trigger: ReactNode;
}) {
  const [isMounted, setIsMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"basics" | "advanced">("basics");
  const [isSaving, setIsSaving] = useState(false);
  const isSubmittingRef = useRef(false);
  const [expandedPreset, setExpandedPreset] = useState<AgentPreset | null>(null);
  const [draft, setDraft] = useState<AgentDraft>(() =>
    buildAgentDraft(defaultWorkspaceId ?? snapshot.workspaces[0]?.id ?? "")
  );
  const selectedWorkspace =
    snapshot.workspaces.find((workspace) => workspace.id === draft.workspaceId) ?? snapshot.workspaces[0] ?? null;
  const currentPresetMeta = getAgentPresetMeta(draft.policy.preset);
  const generatedAgentId = buildUniqueAgentId(
    snapshot.agents,
    selectedWorkspace?.slug,
    draft.name || currentPresetMeta.defaultName
  );
  const canSubmit = Boolean(generatedAgentId && selectedWorkspace) && !isSaving;

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setDraft(buildAgentDraft(defaultWorkspaceId ?? snapshot.workspaces[0]?.id ?? ""));
      setActiveTab("basics");
      setExpandedPreset(null);
    }
  }, [open, defaultWorkspaceId, snapshot.workspaces]);

  const submitCreateAgent = async () => {
    if (isSubmittingRef.current || !generatedAgentId || !selectedWorkspace) {
      return;
    }

    isSubmittingRef.current = true;
    setIsSaving(true);
    let succeeded = false;
    let createdAgentId: string | null = null;

    try {
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ...draft,
          id: generatedAgentId
        })
      });

      const result = (await response.json()) as { agentId?: string; error?: string };

      if (!response.ok || result.error || !result.agentId) {
        throw new Error(result.error || "OpenClaw could not create the agent.");
      }

      if (selectedWorkspace) {
        await syncWorkspaceAgentChannelBindings({
          workspaceId: draft.workspaceId,
          workspacePath: selectedWorkspace.path,
          agentId: result.agentId,
          currentChannelIds: [],
          nextChannelIds: draft.channelIds,
          onRegistryChange: onSnapshotChange
        });
      }

      createdAgentId = result.agentId;
      setOpen(false);
      succeeded = true;
    } catch (error) {
      toast.error("Agent creation failed.", {
        description: error instanceof Error ? error.message : "Unknown agent error."
      });
    } finally {
      setIsSaving(false);
      isSubmittingRef.current = false;
    }

    if (succeeded && createdAgentId) {
      void onRefresh().catch(() => {});
      toast.success("Agent created in OpenClaw.", {
        description: createdAgentId
      });
      onAgentCreated?.(createdAgentId);
    }
  };

  if (!isMounted) {
    return <>{trigger}</>;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="overflow-hidden sm:max-w-4xl">
        <div className="flex max-h-[90vh] min-w-0 flex-col gap-4 overflow-y-auto overflow-x-hidden p-6">
          <DialogHeader>
            <DialogTitle>Create a new OpenClaw agent</DialogTitle>
            <DialogDescription>
              This creates a real isolated agent bound to an existing workspace with a preset policy.
            </DialogDescription>
          </DialogHeader>

          <Tabs className="min-w-0" value={activeTab} onValueChange={(value) => setActiveTab(value as "basics" | "advanced")}>
            <TabsList className="h-10 rounded-[18px] p-0.5">
              <TabsTrigger value="basics" className="h-9 rounded-[15px] px-3 text-[12px]">
                Basics
              </TabsTrigger>
              <TabsTrigger value="advanced" className="h-9 rounded-[15px] px-3 text-[12px]">
                Advanced
              </TabsTrigger>
            </TabsList>

            <TabsContent value="basics" className="min-w-0 space-y-4">
            <div className="space-y-3">
              <div className="flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Agent preset</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Scroll sideways to compare the role, tools, skills, and default policy for each preset.
                  </p>
                  <p className="mt-1 text-[10px] uppercase tracking-[0.22em] text-slate-500">
                    Tap a card to expand or collapse details.
                  </p>
                </div>
                <Badge variant="muted" className="shrink-0 gap-1">
                  <ChevronLeft className="h-3 w-3" />
                  <ChevronRight className="h-3 w-3" />
                  Scroll
                </Badge>
              </div>
              <div className="relative w-full max-w-full overflow-hidden">
                <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-slate-950 via-slate-950/85 to-transparent" />
                <div className="mission-scroll flex min-w-0 max-w-full gap-2.5 overflow-x-auto pb-2 pr-10 snap-x snap-mandatory">
                  {AGENT_PRESET_OPTIONS.map((option) => (
                    <AgentPresetCard
                      key={option.value}
                      preset={option.value}
                      active={draft.policy.preset === option.value}
                      expanded={expandedPreset === option.value}
                      onClick={() => {
                        setDraft((current) => applyAgentPreset(current, option.value));
                        setExpandedPreset((current) => (current === option.value ? null : option.value));
                      }}
                    />
                  ))}
                </div>
                <div className="mt-2 flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.22em] text-slate-500">
                  <span>Drag or scroll to browse presets</span>
                  <span className="inline-flex items-center gap-1">
                    More to the right
                    <ChevronRight className="h-3 w-3" />
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <FormField label="Display name" htmlFor="create-agent-name">
                <Input
                  id="create-agent-name"
                  value={draft.name}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      name: event.target.value
                    }))
                  }
                  placeholder={getAgentPresetMeta(draft.policy.preset).defaultName}
                />
              </FormField>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Workspace" htmlFor="create-agent-workspace">
                <select
                  id="create-agent-workspace"
                  value={draft.workspaceId}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      workspaceId: event.target.value,
                      channelIds: []
                    }))
                  }
                  className="flex h-11 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white outline-none"
                >
                  {snapshot.workspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField label="Model" htmlFor="create-agent-model">
                <select
                  id="create-agent-model"
                  value={draft.modelId}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      modelId: event.target.value
                    }))
                  }
                  className="flex h-11 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white outline-none"
                >
                  <option value="">Use OpenClaw default</option>
                  {snapshot.models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.id}
                    </option>
                  ))}
                </select>
              </FormField>
            </div>

              <div className="rounded-[18px] border border-white/10 bg-white/[0.03] p-4 text-sm leading-6 text-slate-400">
                No need to enter an Agent id. OpenClaw will generate it automatically from the selected workspace and
                display name.
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                <span className="uppercase tracking-[0.18em]">Current id</span>
                <code className="max-w-full break-all rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-slate-200">
                  {generatedAgentId}
                </code>
              </div>
            </div>

            <div className="rounded-[18px] border border-white/10 bg-white/[0.03] p-4 text-sm leading-6 text-slate-400">
              Routing, identity customisation, and policy overrides live in Advanced.
            </div>
            </TabsContent>

            <TabsContent value="advanced" className="min-w-0 space-y-4">
            <ChannelBindingPicker
              snapshot={snapshot}
              workspaceId={draft.workspaceId}
              channelIds={draft.channelIds}
              isSaving={isSaving}
              onChange={(channelIds) =>
                setDraft((current) => ({
                  ...current,
                  channelIds
                }))
              }
            />

            <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Emoji" htmlFor="create-agent-emoji">
                  <Input
                    id="create-agent-emoji"
                    value={draft.emoji}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        emoji: event.target.value
                      }))
                    }
                    placeholder={getAgentPresetMeta(draft.policy.preset).defaultEmoji}
                  />
                </FormField>
                <FormField label="Theme" htmlFor="create-agent-theme">
                  <Input
                    id="create-agent-theme"
                    value={draft.theme}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        theme: event.target.value
                      }))
                    }
                    placeholder={getAgentPresetMeta(draft.policy.preset).defaultTheme}
                  />
                </FormField>
              </div>

              <div className="mt-4">
                <FormField label="Avatar URL" htmlFor="create-agent-avatar">
                  <Input
                    id="create-agent-avatar"
                    value={draft.avatar}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        avatar: event.target.value
                      }))
                    }
                    placeholder="https://example.com/avatar.png"
                  />
                </FormField>
              </div>
            </div>

            <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-white">Heartbeat</p>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    Use this only for periodic watch or triage agents. Leave it off for normal task execution.
                  </p>
                </div>
                <Button
                  type="button"
                  variant={draft.heartbeat.enabled ? "default" : "secondary"}
                  size="sm"
                  className="h-8 rounded-full px-3 text-[11px]"
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      heartbeat: current.heartbeat.enabled
                        ? { ...current.heartbeat, enabled: false }
                        : {
                            ...current.heartbeat,
                            enabled: true,
                            every: current.heartbeat.every || defaultHeartbeatForPreset(current.policy.preset).every
                          }
                    }))
                  }
                >
                  {draft.heartbeat.enabled ? "On" : "Off"}
                </Button>
              </div>

              {draft.heartbeat.enabled ? (
                <div className="mt-3">
                  <FormField label="Interval" htmlFor="create-agent-heartbeat-every">
                    <select
                      id="create-agent-heartbeat-every"
                      value={draft.heartbeat.every}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          heartbeat: {
                            ...current.heartbeat,
                            every: event.target.value
                          }
                        }))
                      }
                      className="flex h-11 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white outline-none"
                    >
                      {AGENT_HEARTBEAT_INTERVAL_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </FormField>
                </div>
              ) : null}
            </div>

            <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-white">Agent policy</p>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    Tune fallback, install scope, file access, and network posture.
                  </p>
                </div>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <AgentPolicySelect
                  label="Missing tool behavior"
                  htmlFor="create-agent-missing-tools"
                  value={draft.policy.missingToolBehavior}
                  options={AGENT_MISSING_TOOL_BEHAVIOR_OPTIONS}
                  onChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      policy: {
                        ...current.policy,
                        missingToolBehavior: value
                      }
                    }))
                  }
                />
                <AgentPolicySelect
                  label="Install scope"
                  htmlFor="create-agent-install-scope"
                  value={draft.policy.installScope}
                  options={AGENT_INSTALL_SCOPE_OPTIONS}
                  onChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      policy: {
                        ...current.policy,
                        installScope: value
                      }
                    }))
                  }
                />
                <AgentPolicySelect
                  label="File access"
                  htmlFor="create-agent-file-access"
                  value={draft.policy.fileAccess}
                  options={AGENT_FILE_ACCESS_OPTIONS}
                  onChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      policy: {
                        ...current.policy,
                        fileAccess: value
                      }
                    }))
                  }
                />
                <AgentPolicySelect
                  label="Network access"
                  htmlFor="create-agent-network-access"
                  value={draft.policy.networkAccess}
                  options={AGENT_NETWORK_ACCESS_OPTIONS}
                  onChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      policy: {
                        ...current.policy,
                        networkAccess: value
                      }
                    }))
                  }
                />
              </div>
            </div>
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={submitCreateAgent} disabled={!canSubmit}>
              {isSaving ? "Creating..." : "Create agent"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
