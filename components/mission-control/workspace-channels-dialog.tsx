"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, Trash2 } from "lucide-react";

import { SurfaceIcon } from "@/components/mission-control/surface-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import {
  getWorkspaceChannels,
  removeSnapshotChannelAccount,
  replaceSnapshotChannelRegistry,
  upsertSnapshotChannelAccount
} from "@/lib/openclaw/channel-bindings";
import {
  getSurfaceCatalogEntry,
  OPENCLAW_SURFACE_CATALOG,
  sortSurfaceAccounts,
  type SurfaceCatalogEntry,
  type SurfaceProvisionField
} from "@/lib/openclaw/surface-catalog";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import type {
  ChannelAccountRecord,
  DiscoveredSurfaceRoute,
  MissionControlSnapshot,
  MissionControlSurfaceKind,
  MissionControlSurfaceProvider,
  WorkspaceChannelGroupAssignment
} from "@/lib/openclaw/types";
import { cn } from "@/lib/utils";

type ChannelMutationResult = {
  error?: string;
  registry?: MissionControlSnapshot["channelRegistry"];
  account?: MissionControlSnapshot["channelAccounts"][number];
};

const SURFACE_KIND_ORDER: MissionControlSurfaceKind[] = ["chat", "inbox", "trigger"];

export function WorkspaceChannelsDialog({
  snapshot,
  workspaceId,
  open,
  onOpenChange,
  onRefresh,
  onSnapshotChange
}: {
  snapshot: MissionControlSnapshot;
  workspaceId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => Promise<void>;
  onSnapshotChange?: (updater: (snapshot: MissionControlSnapshot) => MissionControlSnapshot) => void;
}) {
  const workspace = useMemo(
    () => snapshot.workspaces.find((entry) => entry.id === workspaceId) ?? null,
    [snapshot.workspaces, workspaceId]
  );
  const workspaceAgents = useMemo(
    () => snapshot.agents.filter((agent) => agent.workspaceId === workspace?.id),
    [snapshot.agents, workspace?.id]
  );
  const workspaceSurfaces = useMemo(
    () => (workspace ? getWorkspaceChannels(snapshot, workspace.id) : []),
    [snapshot, workspace]
  );
  const allAccounts = useMemo(() => sortSurfaceAccounts(snapshot.channelAccounts), [snapshot.channelAccounts]);
  const availableKinds = useMemo(() => {
    const catalogKinds = new Set(OPENCLAW_SURFACE_CATALOG.map((entry) => entry.kind));
    return SURFACE_KIND_ORDER.filter((kind) => catalogKinds.has(kind));
  }, []);

  const [activeKind, setActiveKind] = useState<MissionControlSurfaceKind>("chat");
  const [activeProvider, setActiveProvider] = useState<MissionControlSurfaceProvider>("telegram");
  const [isSaving, setIsSaving] = useState(false);
  const [savingMessage, setSavingMessage] = useState<string | null>(null);
  const [newPrimaryAgentId, setNewPrimaryAgentId] = useState("");
  const [delegateDraftBySurfaceId, setDelegateDraftBySurfaceId] = useState<Record<string, string>>({});
  const [discoveredRoutesBySurfaceId, setDiscoveredRoutesBySurfaceId] = useState<
    Record<string, DiscoveredSurfaceRoute[]>
  >({});
  const [loadingRoutesBySurfaceId, setLoadingRoutesBySurfaceId] = useState<Record<string, boolean>>({});
  const [routeErrorsBySurfaceId, setRouteErrorsBySurfaceId] = useState<Record<string, string | null>>({});
  const [deleteTarget, setDeleteTarget] = useState<ChannelAccountRecord | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [provisionDraft, setProvisionDraft] = useState<Record<string, string | boolean>>(
    buildEmptyProvisionDraft(getSurfaceCatalogEntry(activeProvider))
  );

  const providerAccounts = useMemo(
    () => allAccounts.filter((account) => account.type === activeProvider),
    [activeProvider, allAccounts]
  );
  const providerWorkspaceSurfaces = useMemo(
    () => workspaceSurfaces.filter((surface) => surface.type === activeProvider),
    [activeProvider, workspaceSurfaces]
  );
  const currentCatalogEntry = getSurfaceCatalogEntry(activeProvider);
  const basicProvisionFields = currentCatalogEntry.provisionFields.filter((field) => field.section !== "advanced");
  const advancedProvisionFields = currentCatalogEntry.provisionFields.filter((field) => field.section === "advanced");
  const isLinkedAccountId = useCallback(
    (accountId: string) =>
      providerWorkspaceSurfaces.some(
        (surface) => surface.id === accountId || surface.id === toLegacySurfaceId(accountId)
      ),
    [providerWorkspaceSurfaces]
  );
  const resolveAgentDisplayName = useCallback(
    (agentId: string | null | undefined, fallback = "Unset") => {
      if (!agentId) {
        return fallback;
      }

      return formatAgentDisplayName(snapshot.agents.find((agent) => agent.id === agentId) ?? { name: agentId });
    },
    [snapshot.agents]
  );

  const providerOptions = useMemo(() => {
    const providersForKind = OPENCLAW_SURFACE_CATALOG.filter((entry) => entry.kind === activeKind);
    const knownProviders = new Set(providersForKind.map((entry) => entry.provider));
    const dynamicProviders = allAccounts
      .filter((account) => getSurfaceCatalogEntry(account.type).kind === activeKind && !knownProviders.has(account.type))
      .map((account) => account.type);

    return [
      ...providersForKind.map((entry) => entry.provider),
      ...Array.from(new Set(dynamicProviders))
    ];
  }, [activeKind, allAccounts]);

  const refreshSurfaceRoutes = useCallback(
    async (surfaceId: string, provider: MissionControlSurfaceProvider) => {
      if (!workspace?.id) {
        return;
      }

      setLoadingRoutesBySurfaceId((current) => ({ ...current, [surfaceId]: true }));
      setRouteErrorsBySurfaceId((current) => ({ ...current, [surfaceId]: null }));

      try {
        const response = await fetch(
          `/api/workspaces/${encodeURIComponent(workspace.id)}/surfaces/discovery?provider=${encodeURIComponent(
            provider
          )}&accountId=${encodeURIComponent(surfaceId)}`
        );
        const result = (await response.json()) as {
          error?: string;
          routes?: DiscoveredSurfaceRoute[];
          supported?: boolean;
        };

        if (!response.ok || result.error) {
          throw new Error(result.error || `${getSurfaceCatalogEntry(provider).label} route discovery failed.`);
        }

        setDiscoveredRoutesBySurfaceId((current) => ({
          ...current,
          [surfaceId]: result.supported === false || !Array.isArray(result.routes) ? [] : result.routes
        }));
      } catch (error) {
        setRouteErrorsBySurfaceId((current) => ({
          ...current,
          [surfaceId]:
            error instanceof Error ? error.message : `${getSurfaceCatalogEntry(provider).label} discovery failed.`
        }));
      } finally {
        setLoadingRoutesBySurfaceId((current) => ({ ...current, [surfaceId]: false }));
      }
    },
    [workspace?.id]
  );

  useEffect(() => {
    if (!open) {
      setIsSaving(false);
      setSavingMessage(null);
      setDeleteTarget(null);
      setDeleteConfirmText("");
      setProvisionDraft(buildEmptyProvisionDraft(getSurfaceCatalogEntry(activeProvider)));
      setDelegateDraftBySurfaceId({});
      setDiscoveredRoutesBySurfaceId({});
      setRouteErrorsBySurfaceId({});
      setLoadingRoutesBySurfaceId({});
      return;
    }

    if (!newPrimaryAgentId) {
      setNewPrimaryAgentId(workspaceAgents[0]?.id ?? "");
    }
  }, [activeProvider, newPrimaryAgentId, open, workspaceAgents]);

  useEffect(() => {
    setProvisionDraft(buildEmptyProvisionDraft(currentCatalogEntry));
  }, [activeProvider]);

  useEffect(() => {
    if (!providerOptions.includes(activeProvider)) {
      setActiveProvider(providerOptions[0] ?? "telegram");
    }
  }, [activeProvider, providerOptions]);

  useEffect(() => {
    if (!open || !workspace?.id || !currentCatalogEntry.supportsRouteDiscovery) {
      return;
    }

    for (const surface of providerWorkspaceSurfaces) {
      if (discoveredRoutesBySurfaceId[surface.id] || loadingRoutesBySurfaceId[surface.id]) {
        continue;
      }

      void refreshSurfaceRoutes(surface.id, surface.type);
    }
  }, [
    currentCatalogEntry.supportsRouteDiscovery,
    discoveredRoutesBySurfaceId,
    loadingRoutesBySurfaceId,
    open,
    providerWorkspaceSurfaces,
    refreshSurfaceRoutes,
    workspace?.id
  ]);

  const beginSaving = (message: string) => {
    setIsSaving(true);
    setSavingMessage(message);
  };

  const endSaving = () => {
    setIsSaving(false);
    setSavingMessage(null);
  };

  const postWorkspaceSurface = async (payload: Record<string, unknown>) => {
    if (!workspace) {
      throw new Error("Workspace was not found.");
    }

    const response = await fetch(`/api/workspaces/${encodeURIComponent(workspace.id)}/channels`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const result = (await response.json()) as ChannelMutationResult;
    if (!response.ok || result.error) {
      throw new Error(result.error || "OpenClaw could not update this surface right now.");
    }

    return result;
  };

  const patchWorkspaceSurface = async (payload: Record<string, unknown>) => {
    if (!workspace) {
      throw new Error("Workspace was not found.");
    }

    const response = await fetch(`/api/workspaces/${encodeURIComponent(workspace.id)}/channels`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const result = (await response.json()) as ChannelMutationResult;
    if (!response.ok || result.error) {
      throw new Error(result.error || "OpenClaw could not update this surface right now.");
    }

    return result;
  };

  const deleteWorkspaceSurface = async (payload: Record<string, unknown>) => {
    if (!workspace) {
      throw new Error("Workspace was not found.");
    }

    const response = await fetch(`/api/workspaces/${encodeURIComponent(workspace.id)}/channels`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const result = (await response.json()) as ChannelMutationResult;
    if (!response.ok || result.error) {
      throw new Error(result.error || "OpenClaw could not update this surface right now.");
    }

    return result;
  };

  const applyRegistryUpdate = (result: ChannelMutationResult) => {
    if (!result.registry || !onSnapshotChange) {
      return;
    }

    onSnapshotChange((current) => {
      let next = replaceSnapshotChannelRegistry(current, result.registry!);
      if (result.account) {
        next = upsertSnapshotChannelAccount(next, result.account);
      }
      return next;
    });
  };

  const handleAttachExisting = async (account: ChannelAccountRecord) => {
    if (!workspace) {
      return;
    }

    beginSaving(`Connecting ${account.name}...`);

    try {
      const result = await postWorkspaceSurface({
        channelId: account.id,
        type: activeProvider,
        name: account.name,
        primaryAgentId: newPrimaryAgentId || null,
        agentId: newPrimaryAgentId || undefined
      });
      applyRegistryUpdate(result);
      toast.success(`${getSurfaceCatalogEntry(activeProvider).label} connected to this workspace.`);
      void onRefresh().catch(() => {});
    } catch (error) {
      toast.error("Surface connection failed.", {
        description: error instanceof Error ? error.message : "Unknown surface error."
      });
    } finally {
      endSaving();
    }
  };

  const handleProvisionSurface = async () => {
    if (!workspace) {
      return;
    }

    if (!provisionDraft.name.trim()) {
      toast.error("A surface name is required.");
      return;
    }

    beginSaving(`Provisioning ${currentCatalogEntry.label}...`);

    try {
      const config = buildProvisionConfig(currentCatalogEntry.provisionFields, provisionDraft);
      const payload: Record<string, unknown> = {
        type: activeProvider,
        name: provisionDraft.name.trim(),
        config,
        primaryAgentId: newPrimaryAgentId || null,
        agentId: newPrimaryAgentId || undefined
      };

      for (const field of currentCatalogEntry.provisionFields) {
        if (field.key === "token" && typeof config.token === "string") {
          payload.token = config.token;
        }

        if (field.key === "botToken" && typeof config.botToken === "string") {
          payload.botToken = config.botToken;
        }

        if (field.key === "webhookUrl" && typeof config.webhookUrl === "string") {
          payload.webhookUrl = config.webhookUrl;
        }
      }

      const result = await postWorkspaceSurface(payload);
      applyRegistryUpdate(result);
      setProvisionDraft(buildEmptyProvisionDraft(currentCatalogEntry));
      toast.success(`${currentCatalogEntry.label} provisioned and connected.`);
      void onRefresh().catch(() => {});
    } catch (error) {
      toast.error("Surface provisioning failed.", {
        description: error instanceof Error ? error.message : "Unknown surface error."
      });
    } finally {
      endSaving();
    }
  };

  const handlePrimaryChange = async (surfaceId: string, primaryAgentId: string) => {
    if (!workspace || !primaryAgentId) {
      return;
    }

    beginSaving("Updating owner agent...");

    try {
      const surface = workspaceSurfaces.find((entry) => entry.id === surfaceId) ?? null;
      const binding = surface?.workspaces.find((entry) => entry.workspaceId === workspace.id) ?? null;

      if (surface && binding && !binding.agentIds.includes(primaryAgentId)) {
        const bindResult = await patchWorkspaceSurface({
          action: "bind-agent",
          channelId: surfaceId,
          agentId: primaryAgentId,
          workspacePath: workspace.path
        });
        applyRegistryUpdate(bindResult);
      }

      const result = await patchWorkspaceSurface({
        action: "primary",
        channelId: surfaceId,
        primaryAgentId
      });
      applyRegistryUpdate(result);
      toast.success("Owner agent updated.");
      void onRefresh().catch(() => {});
    } catch (error) {
      toast.error("Surface update failed.", {
        description: error instanceof Error ? error.message : "Unknown surface error."
      });
    } finally {
      endSaving();
    }
  };

  const handleDisconnectSurface = async (surfaceId: string) => {
    beginSaving("Disconnecting surface from workspace...");

    try {
      const result = await deleteWorkspaceSurface({ channelId: surfaceId });
      applyRegistryUpdate(result);
      toast.success("Surface disconnected from this workspace.");
      void onRefresh().catch(() => {});
    } catch (error) {
      toast.error("Surface disconnect failed.", {
        description: error instanceof Error ? error.message : "Unknown surface error."
      });
    } finally {
      endSaving();
    }
  };

  const handleAddAssistant = async (surfaceId: string) => {
    const agentId = delegateDraftBySurfaceId[surfaceId]?.trim();
    if (!workspace || !agentId) {
      return;
    }

    beginSaving("Adding assistant agent...");

    try {
      const result = await patchWorkspaceSurface({
        action: "bind-agent",
        channelId: surfaceId,
        agentId,
        workspacePath: workspace.path
      });
      applyRegistryUpdate(result);
      setDelegateDraftBySurfaceId((current) => ({ ...current, [surfaceId]: "" }));
      toast.success("Assistant agent added.");
      void onRefresh().catch(() => {});
    } catch (error) {
      toast.error("Assistant update failed.", {
        description: error instanceof Error ? error.message : "Unknown surface error."
      });
    } finally {
      endSaving();
    }
  };

  const handleRemoveAssistant = async (surfaceId: string, agentId: string) => {
    beginSaving("Removing assistant agent...");

    try {
      const result = await patchWorkspaceSurface({
        action: "unbind-agent",
        channelId: surfaceId,
        agentId
      });
      applyRegistryUpdate(result);
      toast.success("Assistant agent removed.");
      void onRefresh().catch(() => {});
    } catch (error) {
      toast.error("Assistant update failed.", {
        description: error instanceof Error ? error.message : "Unknown surface error."
      });
    } finally {
      endSaving();
    }
  };

  const updateSurfaceAssignments = async (
    surfaceId: string,
    nextAssignments: WorkspaceChannelGroupAssignment[]
  ) => {
    beginSaving("Updating surface routes...");

    try {
      const result = await patchWorkspaceSurface({
        action: "groups",
        channelId: surfaceId,
        groupAssignments: nextAssignments
      });
      applyRegistryUpdate(result);
      void onRefresh().catch(() => {});
    } catch (error) {
      toast.error("Surface route update failed.", {
        description: error instanceof Error ? error.message : "Unknown surface routing error."
      });
    } finally {
      endSaving();
    }
  };

  const handleDeleteAccountEverywhere = async () => {
    if (!deleteTarget) {
      return;
    }

    beginSaving(`Deleting ${deleteTarget.name} from OpenClaw...`);

    try {
      const result = await deleteWorkspaceSurface({
        channelId: deleteTarget.id,
        scope: "global"
      });
      if (result.registry && onSnapshotChange) {
        onSnapshotChange((current) =>
          removeSnapshotChannelAccount(replaceSnapshotChannelRegistry(current, result.registry!), deleteTarget.id)
        );
      }
      setDeleteTarget(null);
      setDeleteConfirmText("");
      toast.success("Surface account deleted everywhere.");
      void onRefresh().catch(() => {});
    } catch (error) {
      toast.error("Surface deletion failed.", {
        description: error instanceof Error ? error.message : "Unknown surface error."
      });
    } finally {
      endSaving();
    }
  };

  const deleteConfirmationValid = deleteTarget
    ? deleteConfirmText.trim().toLowerCase() === deleteTarget.name.trim().toLowerCase()
    : false;
  const provisionPreviewConfig = currentCatalogEntry.kind === "chat"
    ? null
    : buildProvisionConfig(currentCatalogEntry.provisionFields, provisionDraft);
  const provisionPreviewPath = currentCatalogEntry.kind === "chat"
    ? null
    : getProvisionConfigPath(currentCatalogEntry.provider);
  const provisionFieldsReady = currentCatalogEntry.provisionFields.every((field) =>
    isProvisionFieldSatisfied(field, provisionDraft)
  );
  const canProvisionSurface =
    currentCatalogEntry.supportsProvisioning &&
    !isSaving &&
    Boolean(newPrimaryAgentId) &&
    Boolean(provisionDraft.name.trim()) &&
    provisionFieldsReady;

  const renderProvisionField = (field: SurfaceProvisionField) => {
    const fieldId = `surface-${field.key}`;
    const value = provisionDraft[field.key];

    if (field.inputType === "checkbox") {
      return (
        <label
          key={field.key}
          htmlFor={fieldId}
          className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/8 bg-white/[0.02] px-3 py-2.5 transition-colors hover:bg-white/[0.04]"
        >
          <input
            id={fieldId}
            type="checkbox"
            checked={Boolean(value)}
            disabled={isSaving}
            onChange={(event) =>
              setProvisionDraft((current) => ({
                ...current,
                [field.key]: event.target.checked
              }))
            }
            className="mt-0.5 h-4 w-4 rounded border-white/20 bg-white/5 text-cyan-400 focus:ring-cyan-400/60"
          />
          <div className="min-w-0">
            <p className="text-sm font-medium text-white">{field.label}</p>
            {field.helpText ? <p className="mt-1 text-[11px] leading-5 text-slate-500">{field.helpText}</p> : null}
          </div>
        </label>
      );
    }

    return (
      <FormField key={field.key} label={field.label} htmlFor={fieldId}>
        {field.inputType === "select" ? (
          <select
            id={fieldId}
            value={typeof value === "string" ? value : ""}
            onChange={(event) =>
              setProvisionDraft((current) => ({
                ...current,
                [field.key]: event.target.value
              }))
            }
            className="flex h-11 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white outline-none"
            disabled={isSaving}
          >
            <option value="">Select one</option>
            {(field.options ?? []).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : field.inputType === "textarea" ? (
          <Textarea
            id={fieldId}
            value={typeof value === "string" ? value : ""}
            onChange={(event) =>
              setProvisionDraft((current) => ({
                ...current,
                [field.key]: event.target.value
              }))
            }
            placeholder={field.placeholder}
            disabled={isSaving}
          />
        ) : (
          <Input
            id={fieldId}
            type={field.inputType === "number" ? "number" : field.secret ? "password" : field.inputType ?? "text"}
            value={typeof value === "string" ? value : ""}
            onChange={(event) =>
              setProvisionDraft((current) => ({
                ...current,
                [field.key]: event.target.value
              }))
            }
            placeholder={field.placeholder}
            disabled={isSaving}
          />
        )}
        {field.helpText ? <p className="text-[11px] leading-5 text-slate-500">{field.helpText}</p> : null}
      </FormField>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-6xl flex-col overflow-hidden p-0">
        <div className="flex min-h-0 flex-1 flex-col">
        <DialogHeader className="px-4 pb-0 pt-4 sm:px-6 sm:pt-6">
          <DialogTitle>Workspace surfaces</DialogTitle>
          <DialogDescription>
            OpenClaw-first integration management for chat, inbox, and trigger surfaces. AgentOS presets can sit on top
            of these bindings without hiding the raw provider shape.
          </DialogDescription>
        </DialogHeader>

        {isSaving && savingMessage ? (
          <div className="mx-4 mt-4 rounded-2xl border border-cyan-300/20 bg-cyan-400/[0.08] px-3 py-2 sm:mx-6">
            <div className="flex items-center gap-2 text-[11px] text-cyan-50">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>{savingMessage}</span>
            </div>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-4 sm:px-6 sm:pb-6">
        <div className="grid min-h-0 gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="h-fit rounded-[22px] border border-white/10 bg-white/[0.03] p-3 lg:sticky lg:top-0">
            <Tabs value={activeKind} onValueChange={(value) => setActiveKind(value as MissionControlSurfaceKind)}>
              <TabsList className="grid h-10 w-full grid-cols-3">
                {availableKinds.map((kind) => (
                  <TabsTrigger key={kind} className="h-8 rounded-xl px-3 text-[12px]" value={kind}>
                    {kind}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <div className="mt-3 space-y-2">
              {providerOptions.map((provider) => {
                const entry = getSurfaceCatalogEntry(provider);
                const providerSurfaceCount = workspaceSurfaces.filter((surface) => surface.type === provider).length;
                const providerAccountCount = allAccounts.filter((account) => account.type === provider).length;

                return (
                  <button
                    key={provider}
                    type="button"
                    onClick={() => setActiveProvider(provider)}
                    className={cn(
                      "flex w-full items-start justify-between gap-3 rounded-2xl border px-3 py-2.5 text-left transition-colors",
                      activeProvider === provider
                        ? "border-cyan-300/35 bg-cyan-400/[0.08]"
                        : "border-white/8 bg-white/[0.02] hover:bg-white/[0.04]"
                    )}
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <SurfaceIcon provider={provider} className="mt-0.5 h-9 w-9 shrink-0" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white">{entry.label}</p>
                        <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-400">
                          {entry.description}
                        </p>
                      </div>
                    </div>
                    <div className="shrink-0 space-y-1 text-right">
                      <Badge variant="muted" className="h-5 rounded-full px-2 text-[10px]">
                        {providerSurfaceCount} linked
                      </Badge>
                      <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                        {providerAccountCount} account{providerAccountCount === 1 ? "" : "s"}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          <div className="min-w-0 space-y-4">
            <section className="rounded-[22px] border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">{currentCatalogEntry.label} bindings</p>
                  <p className="mt-1 text-xs leading-5 text-slate-400">{currentCatalogEntry.description}</p>
                </div>
                <Badge variant="muted" className="h-6 rounded-full px-2 text-[10px]">
                  {providerWorkspaceSurfaces.length} linked
                </Badge>
              </div>

              {providerWorkspaceSurfaces.length > 0 ? (
                <div className="mt-4 space-y-3">
                  {providerWorkspaceSurfaces.map((surface) => {
                    const workspaceBinding =
                      surface.workspaces.find((binding) => binding.workspaceId === workspace?.id) ?? null;
                    const assistantIds = (workspaceBinding?.agentIds ?? []).filter(
                      (agentId) => agentId !== surface.primaryAgentId
                    );
                    const availableAssistantAgents = workspaceAgents.filter(
                      (agent) =>
                        agent.id !== surface.primaryAgentId &&
                        !(workspaceBinding?.agentIds ?? []).includes(agent.id)
                    );
                    const currentAssignments = (workspaceBinding?.groupAssignments ?? []).filter(
                      (assignment) => assignment.enabled !== false
                    );
                    const discoveredRoutes = discoveredRoutesBySurfaceId[surface.id] ?? [];
                    const isLoadingRoutes = Boolean(loadingRoutesBySurfaceId[surface.id]);
                    const routeError = routeErrorsBySurfaceId[surface.id] ?? null;
                    const routeOptions = buildSurfaceRouteOptions(
                      discoveredRoutes,
                      currentAssignments,
                      surface.type
                    );

                    return (
                      <div
                        key={surface.id}
                        className="rounded-[22px] border border-white/8 bg-white/[0.02] p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex min-w-0 items-start gap-3">
                            <SurfaceIcon provider={surface.type} className="mt-0.5 h-10 w-10 shrink-0" />
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="truncate text-sm font-medium text-white">{surface.name}</p>
                                <Badge variant="muted" className="h-5 rounded-full px-2 text-[10px]">
                                  {currentCatalogEntry.label}
                                </Badge>
                              </div>
                              <p className="mt-1 truncate text-[11px] text-slate-400">{surface.id}</p>
                              <p className="mt-1 text-[11px] text-slate-500">
                                {currentCatalogEntry.kind === "chat"
                                  ? "Chat surface"
                                  : currentCatalogEntry.kind === "inbox"
                                    ? "Inbox surface"
                                    : "Trigger surface"}
                              </p>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              className="h-8 rounded-full px-3 text-[11px]"
                              disabled={isSaving}
                              onClick={() => void handleDisconnectSurface(surface.id)}
                            >
                              Disconnect
                            </Button>
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              className="h-8 rounded-full px-3 text-[11px]"
                              disabled={isSaving}
                              onClick={() => {
                                const exactAccount = providerAccounts.find((entry) => entry.id === surface.id) ?? null;
                                const legacyAccount =
                                  exactAccount ??
                                  providerAccounts.find((entry) => toLegacySurfaceId(entry.id) === surface.id) ??
                                  null;
                                const account =
                                  exactAccount ??
                                  (legacyAccount ? { ...legacyAccount, id: surface.id } : null);
                                if (account) {
                                  setDeleteTarget(account);
                                  setDeleteConfirmText("");
                                }
                              }}
                            >
                              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                              Delete
                            </Button>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                          <div className="space-y-2">
                            <FormField label={currentCatalogEntry.kind === "chat" ? "Primary agent" : "Owner agent"} htmlFor={`primary-${surface.id}`}>
                              <select
                                id={`primary-${surface.id}`}
                                value={surface.primaryAgentId ?? ""}
                                disabled={isSaving}
                                onChange={(event) => void handlePrimaryChange(surface.id, event.target.value)}
                                className="flex h-10 w-full rounded-2xl border border-white/10 bg-white/5 px-3 text-sm text-white outline-none"
                              >
                                <option value="">Select agent</option>
                                {workspaceAgents.map((agent) => (
                                  <option key={agent.id} value={agent.id}>
                                    {formatAgentDisplayName(agent)}
                                  </option>
                                ))}
                              </select>
                            </FormField>
                            <p className="text-[11px] text-slate-400">
                              Current owner: {resolveAgentDisplayName(surface.primaryAgentId)}
                            </p>
                          </div>

                          <div className="space-y-2">
                            <p className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Assistants</p>
                            {assistantIds.length > 0 ? (
                              <div className="flex flex-wrap gap-2">
                                {assistantIds.map((agentId) => (
                                  <button
                                    key={`${surface.id}-${agentId}`}
                                    type="button"
                                    disabled={isSaving}
                                    onClick={() => void handleRemoveAssistant(surface.id, agentId)}
                                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-slate-200 transition-colors hover:bg-white/[0.08]"
                                  >
                                    <span>{resolveAgentDisplayName(agentId, agentId)}</span>
                                    <span className="text-slate-500">remove</span>
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <p className="text-[11px] text-slate-400">No assistant agents attached yet.</p>
                            )}

                            {availableAssistantAgents.length > 0 ? (
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                <select
                                  value={delegateDraftBySurfaceId[surface.id] ?? ""}
                                  disabled={isSaving}
                                  onChange={(event) =>
                                    setDelegateDraftBySurfaceId((current) => ({
                                      ...current,
                                      [surface.id]: event.target.value
                                    }))
                                  }
                                  className="flex h-10 w-full rounded-2xl border border-white/10 bg-white/5 px-3 text-sm text-white outline-none sm:min-w-[180px]"
                                >
                                  <option value="">Select assistant</option>
                                  {availableAssistantAgents.map((agent) => (
                                    <option key={agent.id} value={agent.id}>
                                      {formatAgentDisplayName(agent)}
                                    </option>
                                  ))}
                                </select>
                                <Button
                                  type="button"
                                  size="sm"
                                  className="h-10 rounded-full px-4 text-[11px]"
                                  disabled={isSaving || !(delegateDraftBySurfaceId[surface.id] ?? "").trim()}
                                  onClick={() => void handleAddAssistant(surface.id)}
                                >
                                  Add assistant
                                </Button>
                              </div>
                            ) : null}
                          </div>
                        </div>

                        {currentCatalogEntry.supportsRouteDiscovery ? (
                          <div className="mt-4 rounded-[20px] border border-white/8 bg-white/[0.03] p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-medium text-white">
                                  {getSurfaceCatalogEntry(surface.type).label} routes
                                </p>
                                <p className="mt-1 text-[11px] leading-5 text-slate-400">
                                  {describeSurfaceRouting(surface.type)}
                                </p>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 rounded-full px-3 text-[11px]"
                                disabled={isSaving || isLoadingRoutes}
                                onClick={() => void refreshSurfaceRoutes(surface.id, surface.type)}
                              >
                                {isLoadingRoutes ? (
                                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                                )}
                                Refresh
                              </Button>
                            </div>

                            {routeError ? (
                              <p className="mt-3 text-[11px] text-rose-300">{routeError}</p>
                            ) : null}

                            {routeOptions.length > 0 ? (
                              <div className="mt-3 space-y-2">
                                {routeOptions.map((route) => {
                                  const currentAssignment =
                                    currentAssignments.find((assignment) => assignment.chatId === route.routeId) ?? null;
                                  const enabled = Boolean(currentAssignment);
                                  const nextAssignments = enabled
                                    ? currentAssignments.filter((assignment) => assignment.chatId !== route.routeId)
                                    : [
                                        ...currentAssignments,
                                        {
                                          chatId: route.routeId,
                                          title: route.title ?? null,
                                          agentId: null,
                                          enabled: true
                                        }
                                      ];

                                  return (
                                    <div
                                      key={`${surface.id}:${route.routeId}`}
                                      className="rounded-2xl border border-white/8 bg-white/[0.02] px-3 py-2.5"
                                    >
                                      <div className="flex items-start gap-3">
                                        <input
                                          type="checkbox"
                                          className="mt-0.5 h-4 w-4 rounded border-white/15 bg-white/5 accent-cyan-300"
                                          checked={enabled}
                                          disabled={isSaving}
                                          onChange={() => void updateSurfaceAssignments(surface.id, nextAssignments)}
                                        />
                                        <div className="min-w-0 flex-1">
                                          <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div className="min-w-0">
                                              <div className="flex flex-wrap items-center gap-2">
                                                <p className="truncate text-sm font-medium text-white">
                                                  {route.title ?? route.routeId}
                                                </p>
                                                <Badge variant="muted" className="h-5 rounded-full px-2 text-[10px]">
                                                  {route.kind}
                                                </Badge>
                                              </div>
                                              <p className="mt-1 truncate text-[11px] text-slate-400">
                                                {route.subtitle ?? route.routeId}
                                                {route.lastSeen ? ` · seen ${formatSurfaceTimestamp(route.lastSeen)}` : ""}
                                              </p>
                                            </div>
                                            <select
                                              value={currentAssignment?.agentId ?? ""}
                                              disabled={isSaving || !enabled}
                                              onChange={(event) =>
                                                void updateSurfaceAssignments(
                                                  surface.id,
                                                  currentAssignments.map((assignment) =>
                                                    assignment.chatId === route.routeId
                                                      ? {
                                                          ...assignment,
                                                          title: route.title ?? assignment.title ?? null,
                                                          agentId: event.target.value || null
                                                        }
                                                      : assignment
                                                  )
                                                )
                                              }
                                              className="flex h-8 min-w-[170px] rounded-full border border-white/10 bg-white/5 px-3 text-[11px] text-white outline-none disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                              <option value="">Use primary agent</option>
                                              {workspaceAgents.map((agent) => (
                                                <option key={agent.id} value={agent.id}>
                                                  {formatAgentDisplayName(agent)}
                                                </option>
                                              ))}
                                            </select>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="mt-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-3 py-3 text-[11px] text-slate-400">
                                {getEmptyRouteDiscoveryCopy(surface.type)}
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-4 text-sm text-slate-400">
                  No {currentCatalogEntry.label} surfaces are linked to this workspace yet.
                </div>
              )}
            </section>

            <section className="rounded-[22px] border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">Connect {currentCatalogEntry.label}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    Reuse an OpenClaw account when it already exists. Provision here only for providers that AgentOS can
                    safely set up on top of OpenClaw today.
                  </p>
                </div>
                <Badge variant="muted" className="h-6 rounded-full px-2 text-[10px]">
                  {providerAccounts.length} available
                </Badge>
              </div>

              <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
                <div className="space-y-2">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Existing OpenClaw accounts</p>
                  {providerAccounts.length > 0 ? (
                    providerAccounts.map((account) => {
                      const linked = isLinkedAccountId(account.id);
                      return (
                        <div
                          key={account.id}
                          className="flex flex-col gap-3 rounded-2xl border border-white/8 bg-white/[0.02] px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <SurfaceIcon provider={account.type} className="h-9 w-9 shrink-0" />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-white">{account.name}</p>
                              <p className="mt-1 truncate text-[11px] text-slate-400">{account.id}</p>
                            </div>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant={linked ? "secondary" : "default"}
                            className="h-8 rounded-full px-3 text-[11px]"
                            disabled={isSaving || linked}
                            onClick={() => void handleAttachExisting(account)}
                          >
                            {linked ? "Linked" : "Connect"}
                          </Button>
                        </div>
                      );
                    })
                  ) : (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-4 text-sm text-slate-400">
                      No {currentCatalogEntry.label} accounts were discovered from OpenClaw yet.
                    </div>
                  )}
                </div>

                <div className="space-y-3 rounded-[20px] border border-white/8 bg-white/[0.02] p-4">
                  <div>
                    <p className="text-sm font-medium text-white">Provision from AgentOS</p>
                    <p className="mt-1 text-[11px] leading-5 text-slate-400">
                      {currentCatalogEntry.supportsProvisioning
                        ? `AgentOS will provision ${currentCatalogEntry.label} using the provider-native OpenClaw binding fields, then attach it to this workspace.`
                        : "This provider should be configured directly in OpenClaw first. AgentOS will attach and manage it once the account exists."}
                    </p>
                  </div>

                  <FormField label="Surface name" htmlFor="surface-name">
                    <Input
                      id="surface-name"
                      value={provisionDraft.name}
                      onChange={(event) =>
                        setProvisionDraft((current) => ({ ...current, name: event.target.value }))
                      }
                      placeholder={`${currentCatalogEntry.label} workspace surface`}
                    />
                  </FormField>

                  {basicProvisionFields.length > 0 ? (
                    <div className="grid gap-3 md:grid-cols-2">{basicProvisionFields.map(renderProvisionField)}</div>
                  ) : null}

                  {advancedProvisionFields.length > 0 ? (
                    <details className="rounded-[20px] border border-white/8 bg-white/[0.015] p-4">
                      <summary className="cursor-pointer list-none text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
                        Advanced settings
                      </summary>
                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        {advancedProvisionFields.map(renderProvisionField)}
                      </div>
                    </details>
                  ) : null}

                  {provisionPreviewConfig && provisionPreviewPath ? (
                    <details className="rounded-[20px] border border-cyan-300/15 bg-cyan-400/[0.04] p-4" open>
                      <summary className="cursor-pointer list-none text-xs font-medium uppercase tracking-[0.16em] text-cyan-100">
                        OpenClaw config preview
                      </summary>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Badge variant="muted" className="h-6 rounded-full px-2 text-[10px]">
                          {provisionPreviewPath}
                        </Badge>
                        <p className="text-[11px] leading-5 text-cyan-100/70">
                          This is the JSON AgentOS sends to OpenClaw for this surface.
                        </p>
                      </div>
                      {currentCatalogEntry.provider === "gmail" ? (
                        <p className="mt-2 text-[11px] leading-5 text-cyan-100/70">
                          AgentOS also enables <code>hooks.enabled=true</code> so the Gmail watcher can start on the
                          OpenClaw side.
                        </p>
                      ) : null}
                      <pre className="mt-3 max-h-64 overflow-auto rounded-[18px] border border-white/10 bg-slate-950/80 p-3 text-[11px] leading-5 text-slate-100">
                        {JSON.stringify(provisionPreviewConfig, null, 2)}
                      </pre>
                    </details>
                  ) : null}

                  <FormField label="Primary agent" htmlFor="surface-primary-agent">
                    <select
                      id="surface-primary-agent"
                      value={newPrimaryAgentId}
                      onChange={(event) => setNewPrimaryAgentId(event.target.value)}
                      className="flex h-11 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white outline-none"
                    >
                      <option value="">Select agent</option>
                      {workspaceAgents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {formatAgentDisplayName(agent)}
                        </option>
                      ))}
                    </select>
                  </FormField>

                  <Button
                    type="button"
                    className="h-11 rounded-full px-4"
                    disabled={!canProvisionSurface}
                    onClick={() => void handleProvisionSurface()}
                  >
                    {isSaving ? "Provisioning..." : `Provision ${currentCatalogEntry.label}`}
                  </Button>
                </div>
              </div>
            </section>
          </div>
        </div>

        </div>

        <DialogFooter className="border-t border-white/10 px-4 py-4 sm:px-6">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
        </div>
      </DialogContent>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(nextOpen) => !nextOpen && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Delete OpenClaw account</DialogTitle>
            <DialogDescription>
              This removes the account from every workspace overlay. For provider-backed chat accounts, AgentOS also asks
              OpenClaw to delete the underlying account when supported.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-[20px] border border-rose-500/25 bg-rose-500/[0.08] p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-200" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-rose-50">
                  Type {deleteTarget?.name ?? "the account name"} to confirm deletion.
                </p>
                <p className="mt-1 text-xs leading-5 text-rose-100/80">
                  This action removes the account overlay everywhere and may delete the underlying OpenClaw provider
                  account if the provider supports it.
                </p>
              </div>
            </div>
          </div>

          <FormField label={`Type ${deleteTarget?.name ?? ""} to confirm`} htmlFor="delete-surface-confirm">
            <Input
              id="delete-surface-confirm"
              value={deleteConfirmText}
              onChange={(event) => setDeleteConfirmText(event.target.value)}
              placeholder={deleteTarget?.name ?? ""}
            />
          </FormField>

          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                setDeleteTarget(null);
                setDeleteConfirmText("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!deleteConfirmationValid || isSaving}
              onClick={() => void handleDeleteAccountEverywhere()}
            >
              {isSaving ? "Deleting..." : "Delete everywhere"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-[10px] uppercase tracking-[0.16em] text-slate-400">
        {label}
      </Label>
      {children}
    </div>
  );
}

function buildSurfaceRouteOptions(
  discoveredRoutes: DiscoveredSurfaceRoute[],
  currentAssignments: WorkspaceChannelGroupAssignment[],
  provider: MissionControlSurfaceProvider
) {
  const options = new Map<string, DiscoveredSurfaceRoute>();

  for (const route of discoveredRoutes) {
    options.set(route.routeId, route);
  }

  for (const assignment of currentAssignments) {
    options.set(assignment.chatId, {
      routeId: assignment.chatId,
      provider,
      kind: inferRouteKind(provider, assignment.chatId),
      title: assignment.title ?? options.get(assignment.chatId)?.title ?? null,
      subtitle: options.get(assignment.chatId)?.subtitle ?? null,
      lastSeen: options.get(assignment.chatId)?.lastSeen ?? null
    });
  }

  return Array.from(options.values()).sort((left, right) => {
    const leftLabel = left.title ?? left.routeId;
    const rightLabel = right.title ?? right.routeId;
    return leftLabel.localeCompare(rightLabel);
  });
}

function describeSurfaceRouting(provider: MissionControlSurfaceProvider) {
  if (provider === "telegram") {
    return "OpenClaw route discovery maps Telegram groups to owning agents. Unassigned groups fall back to the primary agent.";
  }

  if (provider === "discord") {
    return "OpenClaw route discovery maps Discord channels, threads, and role routes to owning agents. Unassigned routes fall back to the primary agent.";
  }

  return "OpenClaw route discovery maps provider routes to owning agents. Unassigned routes fall back to the primary agent.";
}

function getEmptyRouteDiscoveryCopy(provider: MissionControlSurfaceProvider) {
  if (provider === "telegram") {
    return "No Telegram groups found yet. Send one message in the target group, then refresh route discovery.";
  }

  if (provider === "discord") {
    return "No Discord channels, threads, or role routes were discovered yet. Send one message in the target server, then refresh route discovery.";
  }

  return "No routes were discovered yet for this provider.";
}

function buildEmptyProvisionDraft(entry: SurfaceCatalogEntry) {
  const draft: Record<string, string | boolean> = {
    name: ""
  };

  for (const field of entry.provisionFields) {
    if (typeof field.defaultValue === "boolean") {
      draft[field.key] = field.defaultValue;
      continue;
    }

    if (typeof field.defaultValue === "string") {
      draft[field.key] = field.defaultValue;
      continue;
    }

    draft[field.key] = field.inputType === "checkbox" ? false : "";
  }

  return draft;
}

function isProvisionFieldSatisfied(field: SurfaceProvisionField, draft: Record<string, string | boolean>) {
  if (!field.required) {
    return true;
  }

  const value = draft[field.key];

  if (field.inputType === "checkbox") {
    return value === true;
  }

  if (field.inputType === "number") {
    const parsed = typeof value === "number" ? value : Number(typeof value === "string" ? value.trim() : "");
    return Number.isFinite(parsed);
  }

  return typeof value === "string" && value.trim().length > 0;
}

function buildProvisionConfig(
  fields: SurfaceProvisionField[],
  draft: Record<string, string | boolean>
) {
  const config: Record<string, unknown> = {};

  for (const field of fields) {
    const value = draft[field.key];

    if (field.inputType === "checkbox") {
      config[field.key] = Boolean(value);
      continue;
    }

    if (field.inputType === "number") {
      const parsed = typeof value === "string" ? Number(value.trim()) : Number(value);
      if (Number.isFinite(parsed)) {
        config[field.key] = parsed;
      }
      continue;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        config[field.key] = parseProvisionTextValue(trimmed);
      }
    }
  }

  return config;
}

function parseProvisionTextValue(value: string) {
  if (
    (value.startsWith("{") && value.endsWith("}")) ||
    (value.startsWith("[") && value.endsWith("]"))
  ) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  return value;
}

function getProvisionConfigPath(provider: MissionControlSurfaceProvider) {
  switch (provider) {
    case "gmail":
      return "hooks.gmail";
    case "email":
      return "email";
    case "webhook":
      return "hooks";
    case "cron":
      return "cron";
    default:
      return provider;
  }
}

function inferRouteKind(provider: MissionControlSurfaceProvider, routeId: string): DiscoveredSurfaceRoute["kind"] {
  if (provider === "telegram") {
    return "group";
  }

  if (provider === "discord") {
    if (routeId.startsWith("thread:")) {
      return "thread";
    }

    if (routeId.startsWith("role:")) {
      return "role";
    }

    return "channel";
  }

  return "channel";
}

function toLegacySurfaceId(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatSurfaceTimestamp(value: string) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }

  return new Date(parsed).toISOString().replace("T", " ").slice(0, 16);
}
