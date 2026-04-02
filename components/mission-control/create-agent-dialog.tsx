"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";

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
import { toast } from "@/components/ui/sonner";
import { ChannelBindingPicker } from "@/components/mission-control/channel-binding-picker";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AGENT_FILE_ACCESS_OPTIONS,
  AGENT_INSTALL_SCOPE_OPTIONS,
  AGENT_MISSING_TOOL_BEHAVIOR_OPTIONS,
  AGENT_NETWORK_ACCESS_OPTIONS,
  AGENT_PRESET_OPTIONS,
  formatAgentFileAccessLabel,
  formatAgentInstallScopeLabel,
  formatAgentMissingToolBehaviorLabel,
  formatAgentNetworkAccessLabel,
  getAgentPresetMeta,
  resolveAgentPolicy
} from "@/lib/openclaw/agent-presets";
import {
  AGENT_HEARTBEAT_INTERVAL_OPTIONS,
  applyPresetHeartbeat,
  defaultHeartbeatForPreset,
  resolveHeartbeatDraft,
  type AgentHeartbeatDraft
} from "@/lib/openclaw/agent-heartbeat";
import { syncWorkspaceAgentChannelBindings } from "@/lib/openclaw/channel-bindings";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import type { AgentPolicy, AgentPreset, MissionControlSnapshot } from "@/lib/openclaw/types";
import { cn } from "@/lib/utils";

type AgentDraft = {
  id: string;
  workspaceId: string;
  modelId: string;
  name: string;
  emoji: string;
  theme: string;
  avatar: string;
  policy: AgentPolicy;
  heartbeat: AgentHeartbeatDraft;
  channelIds: string[];
};

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
  const [hasCustomId, setHasCustomId] = useState(false);
  const [draft, setDraft] = useState<AgentDraft>(() =>
    buildAgentDraft(defaultWorkspaceId ?? snapshot.workspaces[0]?.id ?? "")
  );
  const selectedWorkspace =
    snapshot.workspaces.find((workspace) => workspace.id === draft.workspaceId) ?? snapshot.workspaces[0] ?? null;
  const suggestedAgentId = buildScopedAgentId(
    selectedWorkspace?.slug,
    draft.name || getAgentPresetMeta(draft.policy.preset).defaultName
  );
  const normalizedAgentId = slugify(draft.id);
  const existingAgentCollision =
    normalizedAgentId.length > 0
      ? snapshot.agents.find((agent) => agent.id === normalizedAgentId) ?? null
      : null;
  const collisionWorkspaceLabel = existingAgentCollision
    ? snapshot.workspaces.find((workspace) => workspace.id === existingAgentCollision.workspaceId)?.name ??
      existingAgentCollision.workspacePath
    : null;
  const canSubmit =
    Boolean(normalizedAgentId && draft.workspaceId) && !isSaving && existingAgentCollision === null;

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setDraft(buildAgentDraft(defaultWorkspaceId ?? snapshot.workspaces[0]?.id ?? ""));
      setActiveTab("basics");
      setHasCustomId(false);
    }
  }, [open, defaultWorkspaceId, snapshot.workspaces]);

  useEffect(() => {
    if (!open || hasCustomId || !suggestedAgentId) {
      return;
    }

    setDraft((current) =>
      current.id === suggestedAgentId
        ? current
        : {
            ...current,
            id: suggestedAgentId
          }
    );
  }, [open, hasCustomId, suggestedAgentId]);

  const submitCreateAgent = async () => {
    if (!normalizedAgentId || existingAgentCollision) {
      return;
    }

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
          id: normalizedAgentId
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Create a new OpenClaw agent</DialogTitle>
          <DialogDescription>
            This creates a real isolated agent bound to an existing workspace with a preset policy.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "basics" | "advanced")}>
          <TabsList className="h-10 rounded-[18px] p-0.5">
            <TabsTrigger value="basics" className="h-9 rounded-[15px] px-3 text-[12px]">
              Basics
            </TabsTrigger>
            <TabsTrigger value="advanced" className="h-9 rounded-[15px] px-3 text-[12px]">
              Advanced
            </TabsTrigger>
          </TabsList>

          <TabsContent value="basics" className="space-y-4">
            <div className="space-y-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Agent preset</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {AGENT_PRESET_OPTIONS.map((option) => (
                  <AgentPresetCard
                    key={option.value}
                    label={option.label}
                    description={option.description}
                    active={draft.policy.preset === option.value}
                    badgeVariant={getAgentPresetMeta(option.value).badgeVariant}
                    onClick={() => setDraft((current) => applyAgentPreset(current, option.value))}
                  />
                ))}
              </div>
            </div>

            <AgentPolicySummary policy={draft.policy} heartbeat={draft.heartbeat} />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Agent id" htmlFor="create-agent-id">
                <Input
                  id="create-agent-id"
                  value={draft.id}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    const nextNormalizedValue = slugify(nextValue);

                    setHasCustomId(Boolean(nextNormalizedValue) && nextNormalizedValue !== suggestedAgentId);
                    setDraft((current) => ({
                      ...current,
                      id: nextValue
                    }));
                  }}
                  placeholder={suggestedAgentId || "workspace-agent"}
                />
                <p
                  className={cn(
                    "text-[12px]",
                    existingAgentCollision ? "text-rose-300" : "text-slate-500"
                  )}
                >
                  {existingAgentCollision
                    ? `ID "${normalizedAgentId}" is already used by ${formatAgentDisplayName(existingAgentCollision)} in ${collisionWorkspaceLabel}.`
                    : normalizedAgentId && normalizedAgentId !== draft.id.trim()
                      ? `Saved as ${normalizedAgentId}. Suggested workspace-scoped id: ${suggestedAgentId}.`
                      : `Workspace-scoped id: ${suggestedAgentId}.`}
                </p>
              </FormField>

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
              Routing, identity customisation, and policy overrides live in Advanced.
            </div>
          </TabsContent>

          <TabsContent value="advanced" className="space-y-4">
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
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={submitCreateAgent}
            disabled={!canSubmit}
          >
            {isSaving ? "Creating..." : "Create agent"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FormField({
  label,
  htmlFor,
  children
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor} className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
        {label}
      </Label>
      {children}
    </div>
  );
}

function AgentPresetCard({
  label,
  description,
  active,
  badgeVariant,
  onClick
}: {
  label: string;
  description: string;
  active: boolean;
  badgeVariant: "default" | "muted" | "success" | "warning";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-[20px] border p-3 text-left transition-colors",
        active ? "border-cyan-300/30 bg-cyan-400/10" : "border-white/10 bg-white/[0.03]"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-medium text-white">{label}</p>
          <p className="text-[11px] leading-4 text-slate-400">{description}</p>
        </div>
        <Badge variant={badgeVariant}>{active ? "selected" : "preset"}</Badge>
      </div>
    </button>
  );
}

function AgentPolicySummary({
  policy,
  heartbeat
}: {
  policy: AgentPolicy;
  heartbeat: AgentHeartbeatDraft;
}) {
  const presetMeta = getAgentPresetMeta(policy.preset);

  return (
    <div className="rounded-[20px] border border-white/10 bg-slate-950/50 p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-white">{presetMeta.label}</p>
          <p className="mt-1 text-xs leading-5 text-slate-400">{presetMeta.description}</p>
        </div>
        <Badge variant={presetMeta.badgeVariant}>{presetMeta.label}</Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Badge variant="muted">{formatAgentMissingToolBehaviorLabel(policy.missingToolBehavior)}</Badge>
        <Badge variant="muted">{formatAgentInstallScopeLabel(policy.installScope)}</Badge>
        <Badge variant="muted">{formatAgentFileAccessLabel(policy.fileAccess)}</Badge>
        <Badge variant="muted">Network {formatAgentNetworkAccessLabel(policy.networkAccess)}</Badge>
        <Badge variant={heartbeat.enabled ? "success" : "muted"}>
          Heartbeat {heartbeat.enabled ? heartbeat.every : "off"}
        </Badge>
      </div>
    </div>
  );
}

function AgentPolicySelect<T extends string>({
  label,
  htmlFor,
  value,
  options,
  onChange
}: {
  label: string;
  htmlFor: string;
  value: T;
  options: Array<{ value: T; label: string; description: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <FormField label={label} htmlFor={htmlFor}>
      <select
        id={htmlFor}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="flex h-11 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label} - {option.description}
          </option>
        ))}
      </select>
    </FormField>
  );
}

function buildAgentDraft(workspaceId: string, seed: Partial<AgentDraft> = {}): AgentDraft {
  const policy = resolveAgentPolicy(seed.policy?.preset ?? "worker", seed.policy);
  const presetMeta = getAgentPresetMeta(policy.preset);
  const heartbeat = resolveHeartbeatDraft(policy.preset, seed.heartbeat);

  return {
    id: seed.id ?? "",
    workspaceId,
    modelId: seed.modelId ?? "",
    name: seed.name ?? presetMeta.defaultName,
    emoji: seed.emoji ?? presetMeta.defaultEmoji,
    theme: seed.theme ?? presetMeta.defaultTheme,
    avatar: seed.avatar ?? "",
    policy,
    heartbeat,
    channelIds: Array.from(
      new Set(
        (seed.channelIds ?? []).filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
      )
    )
  };
}

function buildScopedAgentId(workspaceSlug: string | undefined, agentName: string) {
  const normalizedWorkspaceSlug = slugify(workspaceSlug ?? "");
  const normalizedAgentName = slugify(agentName) || "agent";

  return normalizedWorkspaceSlug ? `${normalizedWorkspaceSlug}-${normalizedAgentName}` : normalizedAgentName;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function applyAgentPreset(draft: AgentDraft, preset: AgentPreset): AgentDraft {
  const previousMeta = getAgentPresetMeta(draft.policy.preset);
  const nextMeta = getAgentPresetMeta(preset);
  const nextPolicy = resolveAgentPolicy(preset);

  return {
    ...draft,
    name: !draft.name || draft.name === previousMeta.defaultName ? nextMeta.defaultName : draft.name,
    emoji: !draft.emoji || draft.emoji === previousMeta.defaultEmoji ? nextMeta.defaultEmoji : draft.emoji,
    theme: !draft.theme || draft.theme === previousMeta.defaultTheme ? nextMeta.defaultTheme : draft.theme,
    policy: nextPolicy,
    heartbeat: applyPresetHeartbeat(draft.heartbeat, draft.policy.preset, preset)
  };
}
