"use client";

import type { ReactNode, RefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, ChevronRight, FileText, LoaderCircle, PencilLine, Plus, Sparkles, Trash2, X, type LucideIcon } from "lucide-react";

import { ChannelBindingPicker } from "@/components/mission-control/channel-binding-picker";
import { AgentPolicySelect, AgentPresetCard, FormField } from "@/components/mission-control/create-agent-dialog.parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
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
  defaultHeartbeatForPreset,
  resolveHeartbeatDraft
} from "@/lib/openclaw/agent-heartbeat";
import {
  getWorkspaceChannelIdsForAgent,
  syncWorkspaceAgentChannelBindings
} from "@/lib/openclaw/channel-bindings";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import { parseAgentIdentityMarkdown } from "@/lib/openclaw/agent-bootstrap-files";
import type { AgentPreset, MissionControlSnapshot } from "@/lib/agentos/contracts";
import { cn } from "@/lib/utils";
import {
  applyAgentPreset,
  AGENT_BOOTSTRAP_FILE_OPTIONS,
  buildAgentDraft,
  buildAgentBootstrapFileDraftsForDraft,
  buildUniqueAgentId,
  rebaseAgentBootstrapFilesForDraft,
  type AgentBootstrapFileDraft,
  type AgentBootstrapFileKind,
  type AgentBootstrapFilePath,
  type AgentDraft
} from "@/components/mission-control/create-agent-dialog.utils";

type StartPoint = "empty" | "preset" | "import";
type WizardStage = "start" | "preset" | "import" | "details";
type SurfaceTheme = "dark" | "light";
type CreateAgentProgress = "idle" | "creating" | "syncing";

type CreateAgentDialogProps = {
  snapshot: MissionControlSnapshot;
  defaultWorkspaceId?: string | null;
  onRefresh: () => Promise<void>;
  onSnapshotChange?: (updater: (snapshot: MissionControlSnapshot) => MissionControlSnapshot) => void;
  onAgentCreated?: (agentId: string) => void;
  onAgentCreatedVisible?: (agentId: string) => void;
  trigger: ReactNode;
  surfaceTheme?: SurfaceTheme;
};

export function CreateAgentDialog({
  snapshot,
  defaultWorkspaceId,
  onRefresh,
  onSnapshotChange,
  onAgentCreated,
  onAgentCreatedVisible,
  trigger,
  surfaceTheme = "dark"
}: CreateAgentDialogProps) {
  const isLight = surfaceTheme === "light";
  const initialWorkspaceId = defaultWorkspaceId ?? snapshot.workspaces[0]?.id ?? "";
  const [isMounted, setIsMounted] = useState(false);
  const [showAdvancedIdentity, setShowAdvancedIdentity] = useState(false);
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<WizardStage>("start");
  const [startPoint, setStartPoint] = useState<StartPoint | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<AgentPreset>("worker");
  const [selectedImportAgentId, setSelectedImportAgentId] = useState<string | null>(null);
  const [importSearch, setImportSearch] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [createProgress, setCreateProgress] = useState<CreateAgentProgress>("idle");
  const [createdAgentId, setCreatedAgentId] = useState<string | null>(null);
  const isSubmittingRef = useRef(false);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState<AgentDraft>(() => createCustomAgentDraft(initialWorkspaceId));
  const [bootstrapFiles, setBootstrapFiles] = useState<AgentBootstrapFileDraft[]>(() =>
    buildAgentBootstrapFileDraftsForDraft(createCustomAgentDraft(initialWorkspaceId))
  );
  const [activeBootstrapFilePath, setActiveBootstrapFilePath] = useState<AgentBootstrapFilePath | null>(null);
  const [bootstrapFileEditorValue, setBootstrapFileEditorValue] = useState("");
  const [bootstrapFileEditorInitialValue, setBootstrapFileEditorInitialValue] = useState("");
  const [bootstrapFileDiscardConfirm, setBootstrapFileDiscardConfirm] = useState(false);
  const [bootstrapFileResetConfirm, setBootstrapFileResetConfirm] = useState(false);
  const [bootstrapFileDiscardNextPath, setBootstrapFileDiscardNextPath] = useState<AgentBootstrapFilePath | null>(null);
  const bootstrapFileEditorTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const createSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedWorkspace = snapshot.workspaces.find((workspace) => workspace.id === draft.workspaceId) ?? null;
  const currentPresetMeta = getAgentPresetMeta(draft.policy.preset);
  const generatedAgentId = buildUniqueAgentId(
    snapshot.agents,
    selectedWorkspace?.slug,
    draft.name || currentPresetMeta.defaultName
  );
  const selectedImportAgent =
    selectedImportAgentId ? snapshot.agents.find((entry) => entry.id === selectedImportAgentId) ?? null : null;
  const selectedImportWorkspace = selectedImportAgent
    ? snapshot.workspaces.find((workspace) => workspace.id === selectedImportAgent.workspaceId) ?? null
    : null;

  const importCandidates = useMemo(() => {
    const query = importSearch.trim().toLowerCase();

    return [...snapshot.agents]
      .filter((agent) => {
        if (!query) {
          return true;
        }

        const workspaceName =
          snapshot.workspaces.find((workspace) => workspace.id === agent.workspaceId)?.name ?? agent.workspaceId;
        const presetLabel = getAgentPresetMeta(agent.policy.preset).label;
        const haystack = [
          formatAgentDisplayName(agent),
          agent.id,
          agent.workspaceId,
          workspaceName,
          presetLabel,
          agent.modelId
        ]
          .join(" ")
          .toLowerCase();

        return haystack.includes(query);
      })
      .sort((left, right) => {
        if (selectedImportAgentId) {
          if (left.id === selectedImportAgentId) {
            return -1;
          }

          if (right.id === selectedImportAgentId) {
            return 1;
          }
        }

        return formatAgentDisplayName(left).localeCompare(formatAgentDisplayName(right));
      });
  }, [importSearch, selectedImportAgentId, snapshot.agents, snapshot.workspaces]);

  const defaultBootstrapFiles = useMemo(
    () => buildAgentBootstrapFileDraftsForDraft(draft),
    [draft]
  );
  const activeBootstrapFile =
    activeBootstrapFilePath ? bootstrapFiles.find((entry) => entry.path === activeBootstrapFilePath) ?? null : null;

  const stepLabels = getWizardStepLabels(startPoint);
  const activeStepIndex = getWizardActiveStepIndex(startPoint, stage);
  const canCreate = Boolean(generatedAgentId && selectedWorkspace) && !isSaving;
  const canAdvanceFromCurrentStage = stage === "details"
    ? canCreate
    : getCanAdvanceFromStage(stage, startPoint, selectedImportAgentId);
  const createdAgentVisible = Boolean(
    createdAgentId && snapshot.agents.some((agent) => agent.id === createdAgentId)
  );
  const createProgressMessage =
    createProgress === "creating"
      ? "Creating the agent and writing its bootstrap files."
      : createProgress === "syncing"
        ? "Agent created. Waiting for the canvas card to appear."
        : null;

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (open) {
      return;
    }

    resetWizardState(initialWorkspaceId);
  }, [initialWorkspaceId, open]);

  useEffect(() => {
    if (!open || stage !== "details") {
      return;
    }

    nameInputRef.current?.focus();
  }, [open, stage, startPoint]);

  useEffect(() => {
    setBootstrapFiles((current) => rebaseAgentBootstrapFilesForDraft(current, draft));
  }, [draft]);

  useEffect(() => {
    if (!activeBootstrapFile) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      bootstrapFileEditorTextareaRef.current?.focus();
    });

    return () => cancelAnimationFrame(frame);
  }, [activeBootstrapFile]);

  useEffect(() => {
    if (!activeBootstrapFilePath) {
      return;
    }

    if (bootstrapFiles.some((entry) => entry.path === activeBootstrapFilePath)) {
      return;
    }

    setActiveBootstrapFilePath(null);
    setBootstrapFileEditorValue("");
    setBootstrapFileEditorInitialValue("");
    setBootstrapFileDiscardConfirm(false);
    setBootstrapFileResetConfirm(false);
    setBootstrapFileDiscardNextPath(null);
  }, [activeBootstrapFilePath, bootstrapFiles]);

  useEffect(() => {
    return () => {
      if (createSyncTimeoutRef.current) {
        clearTimeout(createSyncTimeoutRef.current);
        createSyncTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (createProgress !== "syncing" || !createdAgentId || !createdAgentVisible) {
      return;
    }

    if (createSyncTimeoutRef.current) {
      clearTimeout(createSyncTimeoutRef.current);
      createSyncTimeoutRef.current = null;
    }

    onAgentCreatedVisible?.(createdAgentId);
    onAgentCreated?.(createdAgentId);
    toast.success("Agent created in OpenClaw.", {
      description: createdAgentId
    });
    setCreateProgress("idle");
    setCreatedAgentId(null);
    setOpen(false);
  }, [createProgress, createdAgentId, createdAgentVisible, onAgentCreated, onAgentCreatedVisible]);

  useEffect(() => {
    if (createProgress !== "syncing" || !createdAgentId || createdAgentVisible) {
      return;
    }

    if (createSyncTimeoutRef.current) {
      clearTimeout(createSyncTimeoutRef.current);
    }

    createSyncTimeoutRef.current = setTimeout(() => {
      createSyncTimeoutRef.current = null;
      onAgentCreated?.(createdAgentId);
      toast.message("Agent created.", {
        description: "The canvas is taking longer than usual to refresh."
      });
      setCreateProgress("idle");
      setCreatedAgentId(null);
      setOpen(false);
    }, 12000);

    return () => {
      if (createSyncTimeoutRef.current) {
        clearTimeout(createSyncTimeoutRef.current);
        createSyncTimeoutRef.current = null;
      }
    };
  }, [createProgress, createdAgentId, createdAgentVisible, onAgentCreated]);

  const resetWizardState = (workspaceId: string) => {
    const nextDraft = createCustomAgentDraft(workspaceId);
    setStage("start");
    setStartPoint(null);
    setSelectedPreset("worker");
    setSelectedImportAgentId(null);
    setImportSearch("");
    setDraft(nextDraft);
    setBootstrapFiles(buildAgentBootstrapFileDraftsForDraft(nextDraft));
    setActiveBootstrapFilePath(null);
    setBootstrapFileEditorValue("");
    setBootstrapFileEditorInitialValue("");
    setBootstrapFileDiscardConfirm(false);
    setBootstrapFileResetConfirm(false);
    setBootstrapFileDiscardNextPath(null);
    setIsSaving(false);
    setCreateProgress("idle");
    setCreatedAgentId(null);
    if (createSyncTimeoutRef.current) {
      clearTimeout(createSyncTimeoutRef.current);
      createSyncTimeoutRef.current = null;
    }
    isSubmittingRef.current = false;
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && (isSaving || createProgress !== "idle")) {
      return;
    }

    setOpen(nextOpen);

    if (!nextOpen) {
      resetWizardState(initialWorkspaceId);
    }
  };

  const handleStartPointSelect = (nextStartPoint: StartPoint) => {
    const workspaceId = draft.workspaceId || initialWorkspaceId;
    const nextDraft = createCustomAgentDraft(workspaceId);
    nextDraft.modelId = draft.modelId;

    setStartPoint(nextStartPoint);
    setSelectedPreset("worker");
    setSelectedImportAgentId(null);
    setImportSearch("");
    setDraft(nextDraft);
    setBootstrapFiles(buildAgentBootstrapFileDraftsForDraft(nextDraft));
    setActiveBootstrapFilePath(null);
    setBootstrapFileEditorValue("");
    setBootstrapFileEditorInitialValue("");
    setBootstrapFileDiscardConfirm(false);
    setBootstrapFileResetConfirm(false);
    setBootstrapFileDiscardNextPath(null);

    // Empty için ara adım yok — direkt details'e geç
    if (nextStartPoint === "empty") {
      setStage("details");
    } else {
      setStage("start");
    }
  };

  const handlePresetSelect = (preset: AgentPreset) => {
    setSelectedPreset(preset);
    setDraft((current) => applyAgentPreset(current, preset));
  };

  const handleImportAgentSelect = (agentId: string) => {
    const sourceAgent = snapshot.agents.find((entry) => entry.id === agentId);

    if (!sourceAgent) {
      return;
    }

    const workspaceId = draft.workspaceId || initialWorkspaceId;
    const channelIds =
      workspaceId === sourceAgent.workspaceId
        ? getWorkspaceChannelIdsForAgent(snapshot, sourceAgent.workspaceId, sourceAgent.id)
        : [];

    setSelectedImportAgentId(agentId);
    const nextDraft = buildImportedAgentDraft(workspaceId, sourceAgent, channelIds);
    setDraft(nextDraft);
    setBootstrapFiles(buildAgentBootstrapFileDraftsForDraft(nextDraft));
    setActiveBootstrapFilePath(null);
    setBootstrapFileEditorValue("");
    setBootstrapFileEditorInitialValue("");
    setBootstrapFileDiscardConfirm(false);
    setBootstrapFileResetConfirm(false);
    setBootstrapFileDiscardNextPath(null);
  };

  const handleNext = () => {
    if (stage === "start") {
      if (!startPoint) {
        return;
      }

      if (startPoint === "empty") {
        setStage("details");
        return;
      }

      if (startPoint === "preset") {
        setDraft((current) => applyAgentPreset(current, selectedPreset));
        setStage("preset");
        return;
      }

      setStage(startPoint);
      return;
    }

    if (stage === "preset") {
      setStage("details");
      return;
    }

    if (stage === "import") {
      if (!selectedImportAgentId) {
        return;
      }

      setStage("details");
    }
  };

  const handleBack = () => {
    if (stage === "details") {
      setStage(startPoint === "empty" ? "start" : startPoint ?? "start");
      return;
    }

    if (stage === "preset" || stage === "import") {
      setStage("start");
    }
  };

  const handleStepClick = (index: number) => {
    const activeIndex = getWizardActiveStepIndex(startPoint, stage);

    if (index >= activeIndex) {
      return;
    }

    const labels = getWizardStepLabels(startPoint);
    const label = labels[index];

    if (label === "Start") {
      setStage("start");
    } else if (label === "Preset") {
      setStage("preset");
    } else if (label === "Import") {
      setStage("import");
    }
  };

  const submitCreateAgent = async () => {
    if (isSubmittingRef.current || !generatedAgentId || !selectedWorkspace) {
      return;
    }

    isSubmittingRef.current = true;
    setIsSaving(true);
    setCreateProgress("creating");
    setCreatedAgentId(null);

    try {
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ...draft,
          bootstrapFiles: bootstrapFiles.map((entry) => ({
            path: entry.path,
            content: entry.content
          })),
          id: generatedAgentId
        })
      });

      const result = (await response.json()) as { agentId?: string; error?: string };

      if (!response.ok || result.error || !result.agentId) {
        throw new Error(result.error || "OpenClaw could not create the agent.");
      }

      if (draft.channelIds.length > 0) {
        await syncWorkspaceAgentChannelBindings({
          workspaceId: draft.workspaceId,
          workspacePath: selectedWorkspace.path,
          agentId: result.agentId,
          currentChannelIds: [],
          nextChannelIds: draft.channelIds,
          onRegistryChange: onSnapshotChange
        });
      }

      setCreateProgress("syncing");
      setCreatedAgentId(result.agentId);

      void onRefresh().catch(() => {});
    } catch (error) {
      if (createSyncTimeoutRef.current) {
        clearTimeout(createSyncTimeoutRef.current);
        createSyncTimeoutRef.current = null;
      }

      setCreateProgress("idle");
      setCreatedAgentId(null);
      setIsSaving(false);
      toast.error("Agent creation failed.", {
        description: error instanceof Error ? error.message : "Unknown agent error."
      });
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const handlePrimaryAction = () => {
    if (stage === "details") {
      void submitCreateAgent();
      return;
    }

    handleNext();
  };

  const handleOpenBootstrapFile = (path: AgentBootstrapFilePath) => {
    if (bootstrapFileDiscardConfirm || bootstrapFileResetConfirm || activeBootstrapFilePath === path) {
      return;
    }

    const file = bootstrapFiles.find((entry) => entry.path === path);

    if (!file) {
      return;
    }

    if (activeBootstrapFile && bootstrapFileEditorValue !== bootstrapFileEditorInitialValue) {
      setBootstrapFileDiscardNextPath(path);
      setBootstrapFileDiscardConfirm(true);
      return;
    }

    setActiveBootstrapFilePath(path);
    setBootstrapFileEditorValue(file.content);
    setBootstrapFileEditorInitialValue(file.content);
    setBootstrapFileDiscardConfirm(false);
    setBootstrapFileResetConfirm(false);
    setBootstrapFileDiscardNextPath(null);
  };

  const handleAddBootstrapFile = (kind: AgentBootstrapFileKind) => {
    if (bootstrapFileDiscardConfirm || bootstrapFileResetConfirm) {
      return;
    }

    const template = defaultBootstrapFiles.find((entry) => entry.kind === kind);

    if (!template || bootstrapFiles.some((entry) => entry.path === template.path)) {
      return;
    }

    if (activeBootstrapFile && bootstrapFileEditorValue !== bootstrapFileEditorInitialValue) {
      setBootstrapFileDiscardNextPath(template.path);
      setBootstrapFileDiscardConfirm(true);
      return;
    }

    setBootstrapFiles((current) => sortBootstrapFiles([...current, template]));
    setActiveBootstrapFilePath(template.path);
    setBootstrapFileEditorValue(template.content);
    setBootstrapFileEditorInitialValue(template.content);
    setBootstrapFileDiscardConfirm(false);
    setBootstrapFileResetConfirm(false);
    setBootstrapFileDiscardNextPath(null);
  };

  const handleRemoveBootstrapFile = (path: AgentBootstrapFilePath) => {
    if (bootstrapFileDiscardConfirm || bootstrapFileResetConfirm) {
      return;
    }

    setBootstrapFiles((current) => current.filter((entry) => entry.path !== path));

    if (activeBootstrapFilePath === path) {
      setActiveBootstrapFilePath(null);
      setBootstrapFileEditorValue("");
      setBootstrapFileEditorInitialValue("");
      setBootstrapFileDiscardConfirm(false);
      setBootstrapFileResetConfirm(false);
      setBootstrapFileDiscardNextPath(null);
    }
  };

  const handleSaveBootstrapFile = () => {
    if (!activeBootstrapFile) {
      return;
    }

    const nextContent = bootstrapFileEditorValue;
    const manuallyEdited = nextContent !== activeBootstrapFile.baseContent;

    setBootstrapFiles((current) =>
      sortBootstrapFiles(
        current.map((entry) =>
          entry.path === activeBootstrapFile.path
            ? {
                ...entry,
                content: nextContent,
                manuallyEdited
              }
            : entry
        )
      )
    );

    if (activeBootstrapFile.path === "IDENTITY.md") {
      const parsedIdentity = parseAgentIdentityMarkdown(nextContent);

      setDraft((current) => ({
        ...current,
        name: parsedIdentity.name ?? current.name,
        emoji: parsedIdentity.emoji ?? current.emoji,
        theme: parsedIdentity.theme ?? current.theme,
        avatar: parsedIdentity.avatar ?? current.avatar
      }));
    }

    setActiveBootstrapFilePath(null);
    setBootstrapFileEditorValue("");
    setBootstrapFileEditorInitialValue("");
    setBootstrapFileDiscardConfirm(false);
    setBootstrapFileResetConfirm(false);
    setBootstrapFileDiscardNextPath(null);
  };

  const handleResetBootstrapFile = () => {
    if (!activeBootstrapFile) {
      return;
    }

    setBootstrapFileResetConfirm(true);
  };

  const handleConfirmResetBootstrapFile = () => {
    if (!activeBootstrapFile) {
      return;
    }

    setBootstrapFileEditorValue(activeBootstrapFile.baseContent);
    setBootstrapFileEditorInitialValue(activeBootstrapFile.baseContent);
    setBootstrapFileResetConfirm(false);
  };

  const handleCloseBootstrapFile = () => {
    if (bootstrapFileEditorValue !== bootstrapFileEditorInitialValue) {
      setBootstrapFileDiscardConfirm(true);
      setBootstrapFileDiscardNextPath(null);
      return;
    }

    setActiveBootstrapFilePath(null);
    setBootstrapFileEditorValue("");
    setBootstrapFileEditorInitialValue("");
    setBootstrapFileDiscardNextPath(null);
  };

  const handleConfirmDiscardBootstrapFile = () => {
    setBootstrapFileDiscardConfirm(false);
    setBootstrapFileResetConfirm(false);
    const nextPath = bootstrapFileDiscardNextPath;
    setBootstrapFileDiscardNextPath(null);

    if (nextPath) {
      const nextFile = bootstrapFiles.find((entry) => entry.path === nextPath);
      const nextTemplate = defaultBootstrapFiles.find((entry) => entry.path === nextPath);
      const fileToOpen = nextFile ?? nextTemplate ?? null;

      if (!nextFile && nextTemplate) {
        setBootstrapFiles((current) => sortBootstrapFiles([...current, nextTemplate]));
      }

      if (fileToOpen) {
        setActiveBootstrapFilePath(nextPath);
        setBootstrapFileEditorValue(fileToOpen.content);
        setBootstrapFileEditorInitialValue(fileToOpen.content);
        return;
      }
    }

    setActiveBootstrapFilePath(null);
    setBootstrapFileEditorValue("");
    setBootstrapFileEditorInitialValue("");
  };

  const discardPendingBootstrapFileActionLabel = bootstrapFileDiscardNextPath
    ? bootstrapFiles.some((entry) => entry.path === bootstrapFileDiscardNextPath)
      ? "Discard & switch"
      : "Discard & add"
    : "Discard";

  const bootstrapFileEditor = activeBootstrapFile ? (
    <AgentBootstrapFileEditorPanel
      file={activeBootstrapFile}
      value={bootstrapFileEditorValue}
      surfaceTheme={surfaceTheme}
      discardConfirm={bootstrapFileDiscardConfirm}
      resetConfirm={bootstrapFileResetConfirm}
      onChange={setBootstrapFileEditorValue}
      onClose={handleCloseBootstrapFile}
      onReset={handleResetBootstrapFile}
      onConfirmReset={handleConfirmResetBootstrapFile}
      onCancelReset={() => setBootstrapFileResetConfirm(false)}
      onConfirmDiscard={handleConfirmDiscardBootstrapFile}
      onCancelDiscard={() => {
        setBootstrapFileDiscardConfirm(false);
        setBootstrapFileDiscardNextPath(null);
      }}
      discardActionLabel={discardPendingBootstrapFileActionLabel}
      onRemove={handleRemoveBootstrapFile}
      onSave={handleSaveBootstrapFile}
      textareaRef={bootstrapFileEditorTextareaRef}
    />
  ) : null;

  if (!isMounted) {
    return <>{trigger}</>;
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        overlayClassName={isLight ? "bg-[#eadfd4]/72 backdrop-blur-[18px]" : undefined}
        closeClassName="hidden"
        onEscapeKeyDown={(event) => {
          if (!activeBootstrapFile) {
            return;
          }

          event.preventDefault();
          handleCloseBootstrapFile();
        }}
        className={cn(
          "flex h-[min(84dvh,800px)] w-[calc(100vw-10px)] max-w-[920px] flex-col overflow-hidden p-0 sm:w-[min(920px,calc(100vw-20px))]",
          isLight
            ? "border-[#dfd2c5] bg-[linear-gradient(180deg,rgba(255,252,248,0.99),rgba(247,239,231,0.99))] text-[#3f2f24] shadow-[0_36px_120px_rgba(161,125,101,0.18)]"
            : "border-white/10 bg-[linear-gradient(180deg,rgba(12,18,29,0.98),rgba(7,11,18,0.98))] text-slate-50 shadow-[0_36px_120px_rgba(0,0,0,0.48)]"
        )}
        style={isLight ? { colorScheme: "light" } : undefined}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <div
            className={cn(
              "shrink-0 border-b px-4 py-2.5 pr-10",
              isLight
                ? "border-[#e5d8cb] bg-[linear-gradient(180deg,rgba(255,252,248,0.98),rgba(244,235,224,0.96))]"
                : "border-white/10 bg-[linear-gradient(180deg,rgba(14,20,34,0.98),rgba(9,13,24,0.99))]"
            )}
          >
            {stage === "start" ? (
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <DialogTitle className={cn("text-[18px] font-medium sm:text-[20px]", isLight ? "text-[#37291f]" : "text-white")}>
                    Create New Agent
                  </DialogTitle>
                  <p className={cn("mt-1 text-[12px] leading-4", isLight ? "text-[#9a8574]" : "text-slate-500")}>
                    Choose a starting point.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px]",
                      isLight
                        ? "border-[#e2d3c2] bg-[#f5ece1] text-[#7e6554]"
                        : "border-white/10 bg-white/[0.04] text-slate-300"
                    )}
                  >
                    <span
                      className={cn(
                        "inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-medium",
                        isLight ? "bg-[#eadccf] text-[#6f5646]" : "bg-white/10 text-slate-200"
                      )}
                    >
                      1
                    </span>
                    <span>Start</span>
                  </div>

                  <DialogClose asChild>
                    <button
                      type="button"
                      aria-label="Close dialog"
                      className={cn(
                        "inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors",
                        isLight
                          ? "border-[#e2d3c2] bg-[#f5ece1] text-[#7b6657] hover:bg-[#f2e8df] hover:text-[#3f2f24]"
                          : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08] hover:text-white"
                      )}
                    >
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-4 w-4"
                      >
                        <path d="M18 6 6 18" />
                        <path d="m6 6 12 12" />
                      </svg>
                    </button>
                  </DialogClose>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-4">
                  <DialogTitle className={cn("text-[15px] font-medium sm:text-[17px]", isLight ? "text-[#37291f]" : "text-white")}>
                    Create New Agent
                  </DialogTitle>
                  <div className="flex items-center gap-2">
                    <WizardStepper labels={stepLabels} activeIndex={activeStepIndex} surfaceTheme={surfaceTheme} onStepClick={handleStepClick} />
                    <DialogClose asChild>
                      <button
                        type="button"
                        aria-label="Close dialog"
                        className={cn(
                          "inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors",
                          isLight
                            ? "border-[#e2d3c2] bg-[#f5ece1] text-[#7b6657] hover:bg-[#f2e8df] hover:text-[#3f2f24]"
                            : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08] hover:text-white"
                        )}
                      >
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="h-4 w-4"
                        >
                          <path d="M18 6 6 18" />
                          <path d="m6 6 12 12" />
                        </svg>
                      </button>
                    </DialogClose>
                  </div>
                </div>

                <p className={cn("mt-1.5 max-w-[520px] text-[10px] leading-4", isLight ? "text-[#8c7664]" : "text-slate-500")}>
                  {getWizardStageHint(startPoint, stage)}
                </p>
              </>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5">
            {stage === "start" ? (
              <div className="mx-auto flex h-full w-full max-w-[804px] flex-col items-center justify-center space-y-3 py-6">
                <div className="grid w-full gap-4 md:grid-cols-3 md:justify-items-center lg:gap-5">
                  <StartPointCard
                    icon={Plus}
                    title="Empty / Custom"
                    description="Start from scratch."
                    helper="Fastest if you know the shape."
                    selected={startPoint === "empty"}
                    surfaceTheme={surfaceTheme}
                    onSelect={() => handleStartPointSelect("empty")}
                  />
                  <StartPointCard
                    icon={Sparkles}
                    title="Preset Library"
                    description="Use a role template."
                    helper="Good for common worker roles."
                    selected={startPoint === "preset"}
                    surfaceTheme={surfaceTheme}
                    onSelect={() => handleStartPointSelect("preset")}
                  />
                  <StartPointCard
                    icon={Bot}
                    title="Import Agent"
                    description="Clone an existing agent."
                    helper="Best when a baseline already exists."
                    selected={startPoint === "import"}
                    surfaceTheme={surfaceTheme}
                    onSelect={() => handleStartPointSelect("import")}
                  />
                </div>

                <p className={cn("max-w-[760px] text-center text-[10px] leading-4", isLight ? "text-[#8c7664]" : "text-slate-500")}>
                  Empty is the fastest path. Preset and import prefill the draft so you only adjust what matters.
                </p>
              </div>
            ) : stage === "preset" ? (
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
                <PanelCard
                  title="Browse presets"
                  description="Choose the role that fits the first job."
                  surfaceTheme={surfaceTheme}
                  className="min-w-0"
                >
                  <div className="mt-3.5 grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
                    {AGENT_PRESET_OPTIONS.map((option) => (
                      <AgentPresetCard
                        key={option.value}
                        preset={option.value}
                        active={selectedPreset === option.value}
                        surfaceTheme={surfaceTheme}
                        onClick={() => handlePresetSelect(option.value)}
                      />
                    ))}
                  </div>
                </PanelCard>

                <PanelCard
                  title="Selected preset"
                  description="This seeds the draft before details."
                  surfaceTheme={surfaceTheme}
                  className="xl:sticky xl:top-4 xl:self-start xl:h-fit"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl border text-[14px]",
                          isLight ? "border-[#ded0c2] bg-[#faf5ef] text-[#7b604c]" : "border-white/10 bg-white/5 text-base"
                        )}
                      >
                        {getAgentPresetMeta(selectedPreset).defaultEmoji}
                      </span>
                      <div className="min-w-0">
                        <p className={cn("truncate text-[13px] font-medium", isLight ? "text-[#3f2f24]" : "text-white")}>
                          {getAgentPresetMeta(selectedPreset).label}
                        </p>
                        <p className={cn("mt-0.5 text-[11px] leading-4", isLight ? "text-[#7f6958]" : "text-slate-400")}>
                          {getAgentPresetMeta(selectedPreset).description}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Badge variant="muted" className="px-2 py-0.5 text-[9px] normal-case tracking-normal">
                        {getAgentPresetMeta(selectedPreset).tools.length} tools
                      </Badge>
                      <Badge variant="muted" className="px-2 py-0.5 text-[9px] normal-case tracking-normal">
                        {getAgentPresetMeta(selectedPreset).skillIds.length} skills
                      </Badge>
                      <Badge variant={defaultHeartbeatForPreset(selectedPreset).enabled ? "success" : "muted"} className="px-2 py-0.5 text-[9px] normal-case tracking-normal">
                        Heartbeat {defaultHeartbeatForPreset(selectedPreset).enabled ? defaultHeartbeatForPreset(selectedPreset).every : "off"}
                      </Badge>
                    </div>

                    <AgentBootstrapFilesSummary
                      files={bootstrapFiles}
                      surfaceTheme={surfaceTheme}
                      activePath={activeBootstrapFilePath}
                      onOpenFile={handleOpenBootstrapFile}
                      onAddFile={handleAddBootstrapFile}
                      onRemoveFile={handleRemoveBootstrapFile}
                    />

                    {bootstrapFileEditor}

                    <div
                      className={cn(
                        "rounded-[18px] border p-2.5 text-[11px] leading-5",
                        isLight
                          ? "border-[#e2d5c9] bg-[#faf6f1] text-[#7b6657]"
                          : "border-white/10 bg-white/[0.03] text-slate-400"
                      )}
                    >
                      The preset seeds the draft. You can fine-tune the name, model, policy, and heartbeat next.
                    </div>
                  </div>
                </PanelCard>
              </div>
            ) : stage === "import" ? (
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
                <PanelCard
                  title="Import an existing agent"
                  description="Select an agent to clone."
                  surfaceTheme={surfaceTheme}
                  className="min-w-0"
                >
                  <div className="mt-3.5 space-y-3">
                    <div className="relative">
                      <Input
                        value={importSearch}
                        onChange={(event) => setImportSearch(event.target.value)}
                        placeholder="Search by name, id, workspace, preset, or model"
                        className={getCreateAgentControlClassName(surfaceTheme)}
                      />
                    </div>

                    <div className="space-y-2.5">
                      {importCandidates.length > 0 ? (
                        importCandidates.map((agent) => (
                          <ImportAgentCard
                            key={agent.id}
                            agent={agent}
                            workspaceName={
                              snapshot.workspaces.find((workspace) => workspace.id === agent.workspaceId)?.name ??
                              agent.workspaceId
                            }
                            selected={selectedImportAgentId === agent.id}
                            surfaceTheme={surfaceTheme}
                            onSelect={() => handleImportAgentSelect(agent.id)}
                          />
                        ))
                      ) : (
                        <div
                          className={cn(
                            "rounded-[20px] border border-dashed p-4 text-sm leading-6",
                            isLight ? "border-[#e1d5c8] bg-white text-[#7f6958]" : "border-white/10 bg-white/[0.02] text-slate-400"
                          )}
                        >
                          No agents match this search. Clear the search or go back to choose another start.
                        </div>
                      )}
                    </div>
                  </div>
                </PanelCard>

                <PanelCard
                  title="Import summary"
                  description="The selected agent seeds the draft."
                  surfaceTheme={surfaceTheme}
                  className="xl:sticky xl:top-4 xl:self-start xl:h-fit"
                >
                  {selectedImportAgent ? (
                    <div className="space-y-2.5">
                      <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl border text-[14px]",
                          isLight ? "border-[#ded0c2] bg-[#faf5ef] text-[#7b604c]" : "border-white/10 bg-white/5 text-base"
                        )}
                      >
                        {selectedImportAgent.identity.emoji ?? "🤖"}
                      </span>
                        <div className="min-w-0">
                          <p className={cn("truncate text-[13px] font-medium", isLight ? "text-[#3f2f24]" : "text-white")}>
                            {formatAgentDisplayName(selectedImportAgent)}
                          </p>
                          <p className={cn("mt-0.5 text-[11px] leading-4", isLight ? "text-[#7f6958]" : "text-slate-400")}>
                            {selectedImportAgent.id}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Badge variant="muted" className="px-2 py-0.5 text-[9px] normal-case tracking-normal">
                          {selectedImportWorkspace?.name ?? selectedImportAgent.workspaceId}
                        </Badge>
                        <Badge variant="muted" className="px-2 py-0.5 text-[9px] normal-case tracking-normal">
                          {getAgentPresetMeta(selectedImportAgent.policy.preset).label}
                        </Badge>
                        <Badge variant="muted" className="px-2 py-0.5 text-[9px] normal-case tracking-normal">
                          {selectedImportAgent.modelId === "unassigned" ? "default model" : selectedImportAgent.modelId}
                        </Badge>
                      </div>

                      <AgentBootstrapFilesSummary
                        files={bootstrapFiles}
                        surfaceTheme={surfaceTheme}
                        activePath={activeBootstrapFilePath}
                        onOpenFile={handleOpenBootstrapFile}
                        onAddFile={handleAddBootstrapFile}
                        onRemoveFile={handleRemoveBootstrapFile}
                      />

                      {bootstrapFileEditor}

                      <div
                        className={cn(
                          "rounded-[18px] border p-2.5 text-[11px] leading-5",
                          isLight
                            ? "border-[#e2d5c9] bg-[#faf6f1] text-[#7b6657]"
                            : "border-white/10 bg-white/[0.03] text-slate-400"
                        )}
                      >
                        The cloned draft keeps the source baseline. You can adjust workspace-specific details next.
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      <div
                        className={cn(
                          "rounded-[18px] border border-dashed p-4 text-sm leading-6",
                          isLight ? "border-[#e1d5c8] bg-white text-[#7f6958]" : "border-white/10 bg-white/[0.02] text-slate-400"
                        )}
                      >
                        Choose an existing agent on the left. Its configuration will be cloned into the new draft.
                      </div>

                      <AgentBootstrapFilesSummary
                        files={bootstrapFiles}
                        surfaceTheme={surfaceTheme}
                        activePath={activeBootstrapFilePath}
                        onOpenFile={handleOpenBootstrapFile}
                        onAddFile={handleAddBootstrapFile}
                        onRemoveFile={handleRemoveBootstrapFile}
                      />
                    </div>
                  )}
                </PanelCard>
              </div>
            ) : (
                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
                <div className="space-y-3.5">
                  <PanelCard
                    title="Core details"
                    description="Name, workspace, and model."
                    surfaceTheme={surfaceTheme}
                  >
                    <div className="grid gap-3.5 sm:grid-cols-2">
                      <FormField label="Display name" htmlFor="create-agent-name" surfaceTheme={surfaceTheme}>
                        <Input
                          id="create-agent-name"
                          ref={nameInputRef}
                          value={draft.name}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              name: event.target.value
                            }))
                          }
                          placeholder={currentPresetMeta.defaultName}
                          className={getCreateAgentControlClassName(surfaceTheme)}
                        />
                      </FormField>

                      <FormField label="Workspace" htmlFor="create-agent-workspace" surfaceTheme={surfaceTheme}>
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
                          style={isLight ? { colorScheme: "light" } : undefined}
                          className={getCreateAgentControlClassName(surfaceTheme)}
                        >
                          {snapshot.workspaces.map((workspace) => (
                            <option key={workspace.id} value={workspace.id}>
                              {workspace.name}
                            </option>
                          ))}
                        </select>
                      </FormField>

                      <FormField label="Model" htmlFor="create-agent-model" surfaceTheme={surfaceTheme}>
                        <select
                          id="create-agent-model"
                          value={draft.modelId}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              modelId: event.target.value
                            }))
                          }
                          style={isLight ? { colorScheme: "light" } : undefined}
                          className={getCreateAgentControlClassName(surfaceTheme)}
                        >
                          <option value="">Use OpenClaw default</option>
                          {snapshot.models.map((model) => (
                            <option key={model.id} value={model.id}>
                              {model.id}
                            </option>
                          ))}
                        </select>
                      </FormField>

                      <p className={cn("text-[10px] leading-4", isLight ? "text-[#9a8070]" : "text-slate-500")}>
                        OpenClaw generates the agent id automatically. Review it in the Summary panel.
                      </p>
                    </div>
                  </PanelCard>

                  <PanelCard
                    title="Visual identity"
                    description="Emoji and display customization."
                    surfaceTheme={surfaceTheme}
                  >
                    <div className="space-y-3.5">
                      <FormField label="Emoji" htmlFor="create-agent-emoji" surfaceTheme={surfaceTheme}>
                        <div className="relative">
                          <span
                            aria-hidden="true"
                            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 select-none text-base leading-none"
                          >
                            {draft.emoji || currentPresetMeta.defaultEmoji}
                          </span>
                          <Input
                            id="create-agent-emoji"
                            value={draft.emoji}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                emoji: event.target.value
                              }))
                            }
                            placeholder={currentPresetMeta.defaultEmoji}
                            className={cn(getCreateAgentControlClassName(surfaceTheme), "pl-9")}
                          />
                        </div>
                      </FormField>

                      <button
                        type="button"
                        onClick={() => setShowAdvancedIdentity((v) => !v)}
                        className={cn(
                          "inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] transition-colors",
                          isLight ? "text-[#8b7462] hover:text-[#5d4331]" : "text-slate-500 hover:text-slate-300"
                        )}
                      >
                        <ChevronRight
                          className={cn("h-3 w-3 transition-transform duration-200", showAdvancedIdentity && "rotate-90")}
                        />
                        {showAdvancedIdentity ? "Hide" : "Show"} theme &amp; avatar
                      </button>

                      {showAdvancedIdentity ? (
                        <div className="grid gap-3.5 sm:grid-cols-2">
                          <FormField label="Theme" htmlFor="create-agent-theme" surfaceTheme={surfaceTheme}>
                            <Input
                              id="create-agent-theme"
                              value={draft.theme}
                              onChange={(event) =>
                                setDraft((current) => ({
                                  ...current,
                                  theme: event.target.value
                                }))
                              }
                              placeholder={currentPresetMeta.defaultTheme}
                              className={getCreateAgentControlClassName(surfaceTheme)}
                            />
                          </FormField>

                          <FormField label="Avatar URL" htmlFor="create-agent-avatar" surfaceTheme={surfaceTheme}>
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
                              className={getCreateAgentControlClassName(surfaceTheme)}
                            />
                          </FormField>
                        </div>
                      ) : null}
                    </div>
                  </PanelCard>

                  <ChannelBindingPicker
                    snapshot={snapshot}
                    workspaceId={draft.workspaceId}
                    channelIds={draft.channelIds}
                    isSaving={isSaving}
                    surfaceTheme={surfaceTheme}
                    onChange={(channelIds) =>
                      setDraft((current) => ({
                        ...current,
                        channelIds
                      }))
                    }
                  />

                  <PanelCard
                    title="Heartbeat and policy"
                    description="Only override what you need."
                    surfaceTheme={surfaceTheme}
                  >
                    <div className="space-y-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className={cn("text-sm font-medium", isLight ? "text-[#3f2f24]" : "text-white")}>Heartbeat</p>
                          <p className={cn("mt-1 text-xs leading-5", isLight ? "text-[#7f6958]" : "text-slate-400")}>
                            Enable only for periodic watch or triage agents.
                          </p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={draft.heartbeat.enabled}
                          aria-label="Toggle heartbeat"
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
                          className={cn(
                            "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2",
                            isLight
                              ? draft.heartbeat.enabled
                                ? "bg-[#c89e73] focus-visible:ring-[#c89e73]/40"
                                : "bg-[#ddd0c6] focus-visible:ring-[#c89e73]/40"
                              : draft.heartbeat.enabled
                                ? "bg-cyan-400 focus-visible:ring-cyan-300/40"
                                : "bg-white/20 focus-visible:ring-cyan-300/40"
                          )}
                        >
                          <span
                            className={cn(
                              "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-md ring-0 transition-transform duration-200",
                              draft.heartbeat.enabled ? "translate-x-5" : "translate-x-0"
                            )}
                          />
                        </button>
                      </div>

                      {draft.heartbeat.enabled ? (
                        <FormField label="Interval" htmlFor="create-agent-heartbeat-every" surfaceTheme={surfaceTheme}>
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
                            style={isLight ? { colorScheme: "light" } : undefined}
                            className={getCreateAgentControlClassName(surfaceTheme)}
                          >
                            {AGENT_HEARTBEAT_INTERVAL_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </FormField>
                      ) : null}

                      <div className="grid gap-3.5 sm:grid-cols-2">
                        <AgentPolicySelect
                          label="Missing tool behavior"
                          htmlFor="create-agent-missing-tools"
                          value={draft.policy.missingToolBehavior}
                          options={AGENT_MISSING_TOOL_BEHAVIOR_OPTIONS}
                          surfaceTheme={surfaceTheme}
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
                          surfaceTheme={surfaceTheme}
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
                          surfaceTheme={surfaceTheme}
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
                          surfaceTheme={surfaceTheme}
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
                  </PanelCard>
                </div>

                <div className="space-y-4">
                  <PanelCard
                    title="Summary"
                    description="Review the draft before creating."
                    surfaceTheme={surfaceTheme}
                    className="xl:sticky xl:top-4 xl:self-start xl:h-fit"
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl border text-[14px]",
                          isLight ? "border-[#ded0c2] bg-[#faf5ef] text-[#7b604c]" : "border-white/10 bg-white/5 text-base"
                        )}
                      >
                        {draft.emoji || currentPresetMeta.defaultEmoji}
                      </span>
                        <div className="min-w-0">
                          <p className={cn("truncate text-[13px] font-medium", isLight ? "text-[#3f2f24]" : "text-white")}>
                            {draft.name || currentPresetMeta.defaultName}
                          </p>
                          <p className={cn("mt-0.5 text-[11px] leading-4", isLight ? "text-[#7f6958]" : "text-slate-400")}>
                            {selectedWorkspace?.name ?? "No workspace selected"}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Badge variant="muted" className="px-2 py-0.5 text-[9px] normal-case tracking-normal">
                          {startPoint === "empty"
                            ? "Empty / Custom"
                            : startPoint === "preset"
                              ? `${getAgentPresetMeta(selectedPreset).label} preset`
                              : startPoint === "import"
                                ? "Imported agent"
                                : "Start a flow"}
                        </Badge>
                        <Badge variant="muted" className="px-2 py-0.5 text-[9px] normal-case tracking-normal">
                          {draft.modelId || "OpenClaw default"}
                        </Badge>
                        <Badge variant={draft.heartbeat.enabled ? "success" : "muted"} className="px-2 py-0.5 text-[9px] normal-case tracking-normal">
                          Heartbeat {draft.heartbeat.enabled ? draft.heartbeat.every : "off"}
                        </Badge>
                      </div>

                      <AgentBootstrapFilesSummary
                        files={bootstrapFiles}
                        surfaceTheme={surfaceTheme}
                        onOpenFile={handleOpenBootstrapFile}
                        onAddFile={handleAddBootstrapFile}
                        onRemoveFile={handleRemoveBootstrapFile}
                      />

                      {bootstrapFileEditor}

                      <div
                        className={cn(
                          "rounded-[18px] border p-2.5 text-[11px] leading-5",
                          isLight
                            ? "border-[#e2d5c9] bg-[#faf6f1] text-[#7b6657]"
                            : "border-white/10 bg-white/[0.03] text-slate-400"
                        )}
                      >
                        <p className={cn("text-[10px] uppercase tracking-[0.18em]", isLight ? "text-[#8b7462]" : "text-slate-500")}>
                          Generated id
                        </p>
                        <code
                          className={cn(
                            "mt-1.5 block break-all rounded-2xl border px-3 py-1.5 text-[11px]",
                            isLight ? "border-[#dccfc3] bg-white text-[#4d392e]" : "border-white/10 bg-white/5 text-slate-200"
                          )}
                        >
                          {generatedAgentId || "unavailable"}
                        </code>
                      </div>
                    </div>
                  </PanelCard>
                </div>
              </div>
      )}
          </div>

          <DialogFooter
            className={cn(
              "shrink-0 border-t px-6 py-4",
              isLight ? "border-[#e5d8cb] bg-[#faf6f1]" : "border-white/10 bg-transparent"
            )}
          >
            <div className="flex w-full flex-col gap-3">
              {createProgressMessage ? (
                <div
                  className={cn(
                    "inline-flex items-start gap-2 rounded-2xl border px-3 py-2 text-[11px] leading-4",
                    isLight
                      ? "border-[#ddcfbf] bg-white text-[#6e5646]"
                      : "border-white/10 bg-white/[0.04] text-slate-300"
                  )}
                >
                  <LoaderCircle className="mt-0.5 h-3.5 w-3.5 animate-spin shrink-0" />
                  <span>{createProgressMessage}</span>
                </div>
              ) : null}

              <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => handleOpenChange(false)}
                  disabled={isSaving}
                  className={isLight ? "border-[#d8c7b8] bg-white text-[#4d392f] hover:bg-[#f5efe9]" : undefined}
                >
                  Cancel
                </Button>

                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
                  {stage !== "start" ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={handleBack}
                      disabled={isSaving}
                      className={isLight ? "border-[#d8c7b8] bg-white text-[#4d392f] hover:bg-[#f5efe9]" : undefined}
                    >
                      Back
                    </Button>
                  ) : null}

                  <Button
                    type="button"
                    size="sm"
                    onClick={handlePrimaryAction}
                    disabled={!canAdvanceFromCurrentStage}
                    className={
                      isLight
                        ? "bg-[#c89e73] text-white shadow-[0_10px_26px_rgba(161,125,101,0.22)] hover:bg-[#b47f53]"
                        : undefined
                    }
                  >
                    {stage === "details" ? (
                      isSaving ? (
                        <>
                          <LoaderCircle className="mr-2 h-3.5 w-3.5 animate-spin" />
                          {createProgress === "syncing" ? "Syncing canvas..." : "Creating..."}
                        </>
                      ) : (
                        "Create agent"
                      )
                    ) : stage === "start" ? (
                      startPoint === "empty" ? (
                        "Continue"
                      ) : (
                        "Next"
                      )
                    ) : (
                      "Next"
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function createCustomAgentDraft(workspaceId: string): AgentDraft {
  return applyAgentPreset(buildAgentDraft(workspaceId), "custom");
}

function buildImportedAgentDraft(
  workspaceId: string,
  sourceAgent: MissionControlSnapshot["agents"][number],
  channelIds: string[]
): AgentDraft {
  return buildAgentDraft(workspaceId, {
    modelId: sourceAgent.modelId === "unassigned" ? "" : sourceAgent.modelId,
    name: formatAgentDisplayName(sourceAgent),
    emoji: sourceAgent.identity.emoji ?? "",
    theme: sourceAgent.identity.theme ?? "",
    avatar: sourceAgent.identity.avatar ?? "",
    policy: sourceAgent.policy,
    heartbeat: resolveHeartbeatDraft(sourceAgent.policy.preset, {
      enabled: sourceAgent.heartbeat.enabled,
      every: sourceAgent.heartbeat.every ?? undefined
    }),
    channelIds
  });
}

function getWizardStepLabels(startPoint: StartPoint | null) {
  if (!startPoint) {
    return ["Start"];
  }

  if (startPoint === "empty") {
    return ["Start", "Details"];
  }

  if (startPoint === "preset") {
    return ["Start", "Preset", "Details"];
  }

  return ["Start", "Import", "Details"];
}

function getWizardActiveStepIndex(startPoint: StartPoint | null, stage: WizardStage) {
  if (!startPoint || stage === "start") {
    return 0;
  }

  if (stage === "details") {
    return startPoint === "empty" ? 1 : 2;
  }

  return 1;
}

function getCanAdvanceFromStage(
  stage: WizardStage,
  startPoint: StartPoint | null,
  selectedImportAgentId: string | null
) {
  if (stage === "start") {
    return Boolean(startPoint);
  }

  if (stage === "preset") {
    return true;
  }

  if (stage === "import") {
    return Boolean(selectedImportAgentId);
  }

  return true;
}

function getWizardStageHint(startPoint: StartPoint | null, stage: WizardStage) {
  if (stage === "start") {
    if (startPoint === "empty") {
      return "Empty / Custom is selected. Continue to details.";
    }

    if (startPoint === "preset") {
      return "Preset Library is selected. Click Next to browse presets.";
    }

    if (startPoint === "import") {
      return "Import Agent is selected. Click Next to choose a source agent.";
    }

    return "Choose a starting point.";
  }

  if (stage === "preset") {
    return "Pick a preset. Details come next.";
  }

  if (stage === "import") {
    return "Select an existing agent to clone.";
  }

  if (startPoint === "empty") {
    return "Custom baseline loaded. Finish the details and create it.";
  }

  if (startPoint === "preset") {
    return "Preset baseline loaded. Finish the details and create it.";
  }

  if (startPoint === "import") {
    return "Imported baseline loaded. Review and create.";
  }

  return "";
}

function getCreateAgentControlClassName(surfaceTheme: SurfaceTheme) {
  const isLight = surfaceTheme === "light";

  return cn(
    "flex h-10 w-full rounded-2xl border px-3.5 py-2 text-[13px] outline-none transition-colors",
    isLight
      ? "border-[#dccfc3] bg-white text-[#3f2f24] placeholder:text-[#9b8573] focus:border-[#c89e73] focus:ring-2 focus:ring-[#c89e73]/15"
      : "border-white/10 bg-white/5 text-white placeholder:text-slate-500 focus:border-cyan-300/30 focus:ring-2 focus:ring-cyan-300/15"
  );
}

function WizardStepper({
  labels,
  activeIndex,
  surfaceTheme = "dark",
  onStepClick
}: {
  labels: string[];
  activeIndex: number;
  surfaceTheme?: SurfaceTheme;
  onStepClick?: (index: number) => void;
}) {
  const isLight = surfaceTheme === "light";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {labels.map((label, index) => {
        const isActive = index === activeIndex;
        const isComplete = index < activeIndex;
        const isClickable = isComplete && Boolean(onStepClick);

        const inner = (
          <>
            <span
              className={cn(
                "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-medium",
                isActive
                  ? isLight
                    ? "bg-[#c89e73]/15 text-[#5d4331]"
                    : "bg-cyan-300/20 text-cyan-50"
                  : isComplete
                    ? isLight
                      ? "bg-[#f0e7de] text-[#7a6556]"
                      : "bg-emerald-300/20 text-emerald-50"
                    : isLight
                      ? "bg-[#f2ece6] text-[#917866]"
                      : "bg-white/10 text-slate-400"
              )}
            >
              {index + 1}
            </span>
            <span>{label}</span>
          </>
        );

        const sharedClassName = cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] transition-colors",
          isActive
            ? isLight
              ? "border-[#c89e73]/35 bg-[#f8efe4] text-[#5d4331]"
              : "border-cyan-300/30 bg-cyan-400/10 text-cyan-50"
            : isComplete
              ? isLight
                ? "border-[#dccfc3] bg-white text-[#7e6757]"
                : "border-emerald-300/20 bg-emerald-400/10 text-emerald-50"
              : isLight
                ? "border-[#e6dbd0] bg-white/80 text-[#8b7563]"
                : "border-white/10 bg-white/[0.04] text-slate-400",
          isClickable && (isLight ? "cursor-pointer hover:border-[#c89e73]/50 hover:bg-[#faf3ea]" : "cursor-pointer hover:border-emerald-300/30 hover:bg-emerald-400/15")
        );

        return isClickable ? (
          <button
            key={`${label}-${index}`}
            type="button"
            onClick={() => onStepClick?.(index)}
            className={sharedClassName}
          >
            {inner}
          </button>
        ) : (
          <div key={`${label}-${index}`} className={sharedClassName}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}

function PanelCard({
  title,
  description,
  children,
  className,
  surfaceTheme = "dark"
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  surfaceTheme?: SurfaceTheme;
}) {
  const isLight = surfaceTheme === "light";

  return (
    <section
      className={cn(
        "rounded-[22px] border p-3.5",
        isLight
          ? "border-[#e2d5c9] bg-white/92 shadow-[0_14px_34px_rgba(161,125,101,0.08)]"
          : "border-white/10 bg-white/[0.03] shadow-[0_14px_34px_rgba(0,0,0,0.18)]",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn("text-[13px] font-medium", isLight ? "text-[#3f2f24]" : "text-white")}>{title}</p>
          {description ? (
            <p className={cn("mt-1 text-[11px] leading-4", isLight ? "text-[#7f6958]" : "text-slate-400")}>{description}</p>
          ) : null}
        </div>
      </div>
      <div className="mt-3 min-w-0">{children}</div>
    </section>
  );
}

function StartPointCard({
  icon: Icon,
  title,
  description,
  helper,
  selected,
  surfaceTheme = "dark",
  onSelect
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  helper: string;
  selected: boolean;
  surfaceTheme?: SurfaceTheme;
  onSelect: () => void;
}) {
  const isLight = surfaceTheme === "light";

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex w-full min-h-[272px] flex-col rounded-[28px] border p-3.5 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 md:max-w-[248px]",
        isLight
          ? "focus-visible:ring-[#c89e73]/30"
          : "focus-visible:ring-cyan-300/40",
        selected
          ? isLight
            ? "border-[#d7c1ae] bg-[#fdf7ef] shadow-[0_14px_28px_rgba(161,125,101,0.08)]"
            : "border-cyan-300/30 bg-cyan-400/10 shadow-[0_0_0_1px_rgba(34,211,238,0.1)]"
          : isLight
            ? "border-[#e7dbcf] bg-[rgba(255,252,247,0.9)] shadow-[0_10px_24px_rgba(161,125,101,0.05)] hover:border-[#d9c7b8] hover:bg-[#fffdf9]"
            : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div
          className={cn(
            "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[18px] border",
            isLight ? "border-[#e0d3c6] bg-[#faf6f0] text-[#7a5f4c]" : "border-white/10 bg-white/5 text-white"
          )}
        >
          <Icon className="h-[17px] w-[17px]" />
        </div>
        <Badge
          variant={selected ? "default" : "muted"}
          className={cn(
            "shrink-0 rounded-full px-2.5 py-0.5 text-[9px] normal-case tracking-normal",
            isLight
              ? selected
                ? "border-[#d7c1ae] bg-[#f3e5d8] text-[#6a4b38]"
                : "border-[#e3d6c8] bg-[rgba(255,255,255,0.82)] text-[#8a6f5d]"
              : ""
          )}
        >
          {selected ? "Selected" : "Available"}
        </Badge>
      </div>

      <div className="mt-6 space-y-1.5">
        <p className={cn("text-[15px] font-medium leading-5", isLight ? "text-[#413126]" : "text-white")}>{title}</p>
        <p className={cn("text-[12px] leading-5", isLight ? "text-[#8a7463]" : "text-slate-400")}>{description}</p>
      </div>

      <div className="mt-auto pt-6">
        <div className="flex items-center justify-between gap-3">
          <span className={cn("max-w-[116px] text-[9px] uppercase leading-[1.35] tracking-[0.2em]", isLight ? "text-[#9a8572]" : "text-slate-500")}>
            {helper}
          </span>
          <span className={cn("inline-flex items-center gap-1 text-[9px] uppercase tracking-[0.18em]", isLight ? "text-[#7f6958]" : "text-slate-400")}>
            Select
            <ChevronRight className="h-3 w-3" />
          </span>
        </div>
      </div>
    </button>
  );
}

function ImportAgentCard({
  agent,
  workspaceName,
  selected,
  surfaceTheme = "dark",
  onSelect
}: {
  agent: MissionControlSnapshot["agents"][number];
  workspaceName: string;
  selected: boolean;
  surfaceTheme?: SurfaceTheme;
  onSelect: () => void;
}) {
  const presetMeta = getAgentPresetMeta(agent.policy.preset);
  const modelLabel = agent.modelId === "unassigned" ? "default model" : agent.modelId;
  const isLight = surfaceTheme === "light";

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex w-full flex-col rounded-[22px] border p-3.5 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2",
        isLight ? "focus-visible:ring-[#c89e73]/30" : "focus-visible:ring-cyan-300/40",
        selected
          ? isLight
            ? "border-[#c89e73]/45 bg-[#fff8f0] shadow-[0_16px_40px_rgba(161,125,101,0.12)]"
            : "border-cyan-300/30 bg-cyan-400/10 shadow-[0_0_0_1px_rgba(34,211,238,0.1)]"
          : isLight
            ? "border-[#e3d7cc] bg-white/92 shadow-[0_14px_34px_rgba(161,125,101,0.08)] hover:border-[#d4c2b4] hover:bg-white"
            : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border text-[15px]",
              isLight ? "border-[#ded0c2] bg-[#faf5ef] text-[#7b604c]" : "border-white/10 bg-white/5"
            )}
          >
            {agent.identity.emoji ?? "🤖"}
          </span>
          <div className="min-w-0">
            <p className={cn("truncate text-[13px] font-medium", isLight ? "text-[#3f2f24]" : "text-white")}>
              {formatAgentDisplayName(agent)}
            </p>
            <p className={cn("mt-0.5 truncate text-[11px] leading-4", isLight ? "text-[#7f6958]" : "text-slate-500")}>
              {agent.id}
            </p>
          </div>
        </div>

        <Badge
          variant={selected ? "default" : "muted"}
          className={cn(
            "shrink-0 px-2 py-0.5 text-[9px] normal-case tracking-normal",
            isLight
              ? selected
                ? "border-[#c89e73]/35 bg-[#f5e7d8] text-[#6a4a34]"
                : "border-[#e1d5c8] bg-white text-[#846a58]"
              : ""
          )}
        >
          {selected ? "Selected" : presetMeta.label}
        </Badge>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Badge
          variant="muted"
          className={cn(
            "px-2 py-0.5 text-[9px] normal-case tracking-normal",
            isLight ? "border-[#e1d5c8] bg-[#fbf7f2] text-[#6f5747]" : ""
          )}
        >
          {workspaceName}
        </Badge>
        <Badge
          variant="muted"
          className={cn(
            "px-2 py-0.5 text-[9px] normal-case tracking-normal",
            isLight ? "border-[#e1d5c8] bg-[#fbf7f2] text-[#6f5747]" : ""
          )}
        >
          {modelLabel}
        </Badge>
        <Badge
          variant={agent.status === "ready" ? "success" : "muted"}
          className={cn(
            "px-2 py-0.5 text-[9px] normal-case tracking-normal",
            isLight
              ? agent.status === "ready"
                ? "border-emerald-300/40 bg-emerald-100 text-emerald-800"
                : "border-[#e1d5c8] bg-[#fbf7f2] text-[#6f5747]"
            : ""
          )}
        >
          {agent.status}
        </Badge>
      </div>

      <p className={cn("mt-3 text-[12px] leading-5", isLight ? "text-[#7f6958]" : "text-slate-400")}>{presetMeta.description}</p>

      <div className="mt-3.5 flex items-center justify-between gap-3">
        <span className={cn("text-[10px] uppercase tracking-[0.16em]", isLight ? "text-[#8b7462]" : "text-slate-500")}>
          Import this agent as a new draft
        </span>
        <span className={cn("inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.16em]", isLight ? "text-[#7f6958]" : "text-slate-400")}>
          Select
          <ChevronRight className="h-3 w-3" />
        </span>
      </div>
    </button>
  );
}

function AgentBootstrapFilesSummary({
  files,
  surfaceTheme = "dark",
  activePath,
  onOpenFile,
  onAddFile,
  onRemoveFile
}: {
  files: AgentBootstrapFileDraft[];
  surfaceTheme?: SurfaceTheme;
  activePath?: AgentBootstrapFilePath | null;
  onOpenFile: (path: AgentBootstrapFilePath) => void;
  onAddFile: (kind: AgentBootstrapFileKind) => void;
  onRemoveFile: (path: AgentBootstrapFilePath) => void;
}) {
  const isLight = surfaceTheme === "light";
  const filePaths = new Set(files.map((entry) => entry.path));
  const missingOptionalFiles = AGENT_BOOTSTRAP_FILE_OPTIONS.filter(
    (option) => option.removable && !filePaths.has(option.path)
  );

  return (
    <div
      className={cn(
        "space-y-2.5 rounded-[18px] border p-3.5",
        isLight ? "border-[#e2d5c9] bg-[#faf6f1] text-[#3f2f24]" : "border-white/10 bg-white/[0.03] text-white"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn("text-[10px] uppercase tracking-[0.18em]", isLight ? "text-[#8b7462]" : "text-slate-500")}>
            Files
          </p>
          <p className={cn("mt-1 text-[11px] leading-4", isLight ? "text-[#7f6958]" : "text-slate-400")}>
            These files will be written into the agent state directory. Click a file to edit it inline.
          </p>
        </div>

        <Badge
          variant="muted"
          className={cn(
            "shrink-0 px-2 py-0.5 text-[9px] normal-case tracking-normal",
            isLight ? "border-[#e1d5c8] bg-white text-[#846a58]" : ""
          )}
        >
          {files.length} files
        </Badge>
      </div>

      <div className="flex flex-wrap gap-2">
        {files.map((file) => (
          <AgentBootstrapFileChip
            key={file.path}
            file={file}
            surfaceTheme={surfaceTheme}
            active={activePath === file.path}
            onOpenFile={onOpenFile}
            onRemoveFile={onRemoveFile}
          />
        ))}
      </div>

      {missingOptionalFiles.length > 0 ? (
        <div className="flex flex-wrap gap-2 pt-1">
          {missingOptionalFiles.map((option) => (
            <button
              key={option.path}
              type="button"
              onClick={() => onAddFile(option.kind)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border border-dashed px-2.5 py-1 text-[10px] transition-colors",
                isLight
                  ? "border-[#d9cbbd] bg-white text-[#7f6958] hover:border-[#c89e73] hover:bg-[#fff9f2]"
                  : "border-white/10 bg-white/[0.02] text-slate-400 hover:border-white/20 hover:bg-white/[0.05]"
              )}
            >
              <Plus className="h-3 w-3" />
              Add {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AgentBootstrapFileChip({
  file,
  surfaceTheme = "dark",
  active = false,
  onOpenFile,
  onRemoveFile
}: {
  file: AgentBootstrapFileDraft;
  surfaceTheme?: SurfaceTheme;
  active?: boolean;
  onOpenFile: (path: AgentBootstrapFilePath) => void;
  onRemoveFile: (path: AgentBootstrapFilePath) => void;
}) {
  const isLight = surfaceTheme === "light";
  const isDirty = file.content !== file.baseContent;

  return (
    <div
      className={cn(
        "inline-flex items-stretch overflow-hidden rounded-full border text-left transition-colors",
        isLight
          ? active
            ? "border-[#c89e73] bg-[#fff7ef] text-[#3f2f24] shadow-[0_10px_24px_rgba(161,125,101,0.12)]"
            : file.required
            ? "border-[#d8c9bb] bg-white text-[#3f2f24]"
            : "border-[#d8c9bb] bg-white text-[#3f2f24] hover:border-[#c89e73]"
          : active
            ? "border-cyan-300/30 bg-cyan-400/10 text-white shadow-[0_0_0_1px_rgba(34,211,238,0.08)]"
            : file.required
            ? "border-white/10 bg-white/[0.04] text-white"
            : "border-white/10 bg-white/[0.03] text-white hover:border-white/20"
      )}
    >
      <button
        type="button"
        onClick={() => onOpenFile(file.path)}
        className={cn(
          "flex min-w-0 items-center gap-2 px-2.5 py-1.5 transition-colors",
          isLight ? "hover:bg-[#fff8f0]" : "hover:bg-white/[0.04]"
        )}
      >
        <span
          className={cn(
            "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
            isLight ? "border-[#dfd2c5] bg-[#faf6f0] text-[#7a5f4c]" : "border-white/10 bg-white/5 text-slate-200"
          )}
        >
          <FileText className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0">
          <span className={cn("block truncate text-[10px] font-medium", isLight ? "text-[#3f2f24]" : "text-white")}>
            {file.path}
          </span>
          <span className={cn("block text-[9px] uppercase tracking-[0.14em]", isLight ? "text-[#8b7462]" : "text-slate-500")}>
            {active ? "Editing" : isDirty ? "Edited" : "Open editor"}
          </span>
        </span>
        {isDirty ? <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-amber-400" /> : null}
        <span
          className={cn(
            "ml-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.14em]",
            isLight
              ? active
                ? "border-[#c89e73] bg-[#fff1e1] text-[#5d4331]"
                : "border-[#e1d5c8] bg-[#faf6f1] text-[#8b7462]"
              : active
                ? "border-cyan-300/30 bg-cyan-400/10 text-cyan-50"
                : "border-white/10 bg-white/[0.03] text-slate-400"
          )}
        >
          <PencilLine className="h-3 w-3" />
          Edit
        </span>
      </button>

      {file.removable ? (
        <button
          type="button"
          aria-label={`Remove ${file.path}`}
          onClick={() => onRemoveFile(file.path)}
          className={cn(
            "inline-flex items-center justify-center border-l px-2.5 transition-colors",
            isLight ? "border-[#d8c9bb] text-[#8b7462] hover:bg-[#fff3e8] hover:text-[#5d4331]" : "border-white/10 text-slate-400 hover:bg-white/[0.04] hover:text-white"
          )}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function AgentBootstrapFileEditorPanel({
  file,
  value,
  surfaceTheme = "dark",
  discardConfirm,
  resetConfirm,
  onChange,
  onClose,
  onReset,
  onConfirmReset,
  onCancelReset,
  onConfirmDiscard,
  onCancelDiscard,
  discardActionLabel,
  onRemove,
  onSave,
  textareaRef
}: {
  file: AgentBootstrapFileDraft;
  value: string;
  surfaceTheme?: SurfaceTheme;
  discardConfirm: boolean;
  resetConfirm: boolean;
  onChange: (value: string) => void;
  onClose: () => void;
  onReset: () => void;
  onConfirmReset: () => void;
  onCancelReset: () => void;
  onConfirmDiscard: () => void;
  onCancelDiscard: () => void;
  discardActionLabel: string;
  onRemove: (path: AgentBootstrapFilePath) => void;
  onSave: () => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const isLight = surfaceTheme === "light";
  const isDirty = value !== file.baseContent;

  return (
    <section
      className={cn(
        "space-y-3 rounded-[22px] border p-3.5 shadow-[0_14px_34px_rgba(0,0,0,0.12)]",
        isLight
          ? "border-[#e2d5c9] bg-[#fffaf5] text-[#3f2f24]"
          : "border-white/10 bg-white/[0.03] text-white"
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className={cn("text-[10px] uppercase tracking-[0.18em]", isLight ? "text-[#8b7462]" : "text-slate-500")}>
            Agent file
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className={cn("inline-flex items-center gap-1.5 text-[14px] font-medium", isLight ? "text-[#37291f]" : "text-white")}>
              <FileText className="h-4 w-4" />
              {file.label}
            </span>
            <Badge
              variant="muted"
              className={cn(
                "px-2 py-0.5 text-[9px] normal-case tracking-normal",
                isLight ? "border-[#d8c9bb] bg-white text-[#846a58]" : ""
              )}
            >
              {file.path}
            </Badge>
            <Badge
              variant={file.required ? "default" : "muted"}
              className={cn(
                "px-2 py-0.5 text-[9px] normal-case tracking-normal",
                isLight
                  ? file.required
                    ? "border-[#c89e73]/35 bg-[#f5e7d8] text-[#6a4a34]"
                    : "border-[#d8c9bb] bg-white text-[#846a58]"
                  : ""
              )}
            >
              {file.required ? "Required" : "Optional"}
            </Badge>
            {isDirty ? (
              <Badge
                variant="warning"
                className={cn(
                  "px-2 py-0.5 text-[9px] normal-case tracking-normal",
                  isLight ? "border-amber-300/40 bg-amber-100 text-amber-900" : ""
                )}
              >
                Edited
              </Badge>
            ) : null}
          </div>
          <p className={cn("mt-1 text-[11px] leading-4", isLight ? "text-[#7f6958]" : "text-slate-400")}>{file.description}</p>
        </div>

        <div className="flex items-center gap-2">
          {file.removable ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                onRemove(file.path);
              }}
              className={isLight ? "border-[#d8c7b8] bg-white text-[#4d392f] hover:bg-[#f5efe9]" : undefined}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Remove
            </Button>
          ) : null}

          <button
            type="button"
            aria-label="Close inline file editor"
            onClick={onClose}
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors",
              isLight
                ? "border-[#e2d3c2] bg-[#f5ece1] text-[#7b6657] hover:bg-[#f2e8df] hover:text-[#3f2f24]"
                : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08] hover:text-white"
            )}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={cn(
            "min-h-[240px] resize-y font-mono text-[12px] leading-5",
            isLight
              ? "border-[#dccfc3] bg-white text-[#3f2f24] placeholder:text-[#9b8573] focus-visible:ring-[#c89e73]/30"
              : "border-white/10 bg-white/5 text-white placeholder:text-slate-500"
          )}
        />

        <div
          className={cn(
            "rounded-[18px] border p-3 text-[11px] leading-5",
            isLight
              ? "border-[#e2d5c9] bg-[#faf6f1] text-[#7b6657]"
              : "border-white/10 bg-white/[0.03] text-slate-400"
          )}
        >
          <p className={cn("text-[10px] uppercase tracking-[0.18em]", isLight ? "text-[#8b7462]" : "text-slate-500")}>
            Notes
          </p>
          <p className="mt-1.5">
            {file.path === "IDENTITY.md"
              ? "This file seeds the agent identity. Saving it will also update the name, emoji, theme, and avatar fields."
              : file.path === "SOUL.md"
                ? "This file is read as the agent's operating posture and purpose."
                : file.path === "TOOLS.md"
                  ? "This file captures tool preferences and workflow cues for the agent."
                  : "This file captures recurring watch-cycle guidance for heartbeat-enabled agents."}
          </p>
        </div>
      </div>

      {discardConfirm ? (
        <div className="flex flex-col gap-2 rounded-[18px] border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: isLight ? "#e2d5c9" : "rgba(255,255,255,0.1)" }}>
          <p className={cn("text-[11px] leading-4", isLight ? "text-[#7f6958]" : "text-slate-400")}>
            Discard unsaved changes?
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={onCancelDiscard}
              className={isLight ? "border-[#d8c7b8] bg-white text-[#4d392f] hover:bg-[#f5efe9]" : undefined}
            >
              Keep editing
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={onConfirmDiscard}
            >
              {discardActionLabel}
            </Button>
          </div>
        </div>
      ) : resetConfirm ? (
        <div className="flex flex-col gap-2 rounded-[18px] border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: isLight ? "#e2d5c9" : "rgba(255,255,255,0.1)" }}>
          <p className={cn("text-[11px] leading-4", isLight ? "text-[#7f6958]" : "text-slate-400")}>
            Reset to default content?
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={onCancelReset}
              className={isLight ? "border-[#d8c7b8] bg-white text-[#4d392f] hover:bg-[#f5efe9]" : undefined}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={onConfirmReset}
            >
              Reset
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className={cn("text-[11px] leading-4", isLight ? "text-[#7f6958]" : "text-slate-400")}>
            Changes stay local until you apply them.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onClose}
              className={isLight ? "border-[#d8c7b8] bg-white text-[#4d392f] hover:bg-[#f5efe9]" : undefined}
            >
              Cancel
            </Button>

            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onReset}
              disabled={!isDirty}
              className={isLight ? "border-[#d8c7b8] bg-white text-[#4d392f] hover:bg-[#f5efe9]" : undefined}
            >
              Reset
            </Button>

            <Button
              type="button"
              size="sm"
              onClick={onSave}
              className={
                isLight
                  ? "bg-[#c89e73] text-white shadow-[0_10px_26px_rgba(161,125,101,0.22)] hover:bg-[#b47f53]"
                  : undefined
              }
            >
              <PencilLine className="mr-1.5 h-3.5 w-3.5" />
              Save file
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function sortBootstrapFiles(files: AgentBootstrapFileDraft[]) {
  const order = new Map(AGENT_BOOTSTRAP_FILE_OPTIONS.map((entry, index) => [entry.path, index] as const));

  return [...files].sort((left, right) => (order.get(left.path) ?? 0) - (order.get(right.path) ?? 0));
}
