"use client";

import {
  AlertTriangle,
  ArrowUpCircle,
  CheckCircle2,
  ChevronDown,
  EyeOff,
  LoaderCircle,
  MoonStar,
  RefreshCw,
  Settings2,
  Square,
  SunMedium
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AddModelsDialog } from "@/components/mission-control/add-models/add-models-dialog";
import { AgentModelPickerDialog } from "@/components/mission-control/agent-model-picker-dialog";
import { AgentCapabilityEditorDialog } from "@/components/mission-control/agent-capability-editor-dialog";
import { CommandBar } from "@/components/mission-control/command-bar";
import { InspectorPanel } from "@/components/mission-control/inspector-panel";
import { OpenClawOnboarding } from "@/components/mission-control/openclaw-onboarding";
import { ResetDialog } from "@/components/mission-control/reset-dialog";
import { MissionSidebar } from "@/components/mission-control/sidebar";
import { WorkspaceChannelsDialog } from "@/components/mission-control/workspace-channels-dialog";
import { WorkspaceWizardDialog } from "@/components/mission-control/workspace-wizard/workspace-wizard-dialog";
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
import dynamic from "next/dynamic";
import { toast } from "@/components/ui/sonner";
import { useMissionControlData } from "@/hooks/use-mission-control-data";
import type { AgentDetailFocus } from "@/components/mission-control/canvas-types";
import {
  CanvasTitlePill as MissionControlCanvasTitlePill,
  CanvasTopBar as MissionControlCanvasTopBar
} from "@/components/mission-control/mission-control-shell.topbar";
import {
  resolveUpdateDialogDescription,
  resolveUpdateDialogTitle,
  resolveUpdateResultIconWrapClassName,
  resolveUpdateResultPanelClassName
} from "@/components/mission-control/mission-control-shell.utils";
import { compactPath, formatAgentDisplayName } from "@/lib/openclaw/presenters";
import {
  isOpenClawMissionReady as resolveOpenClawMissionReady,
  isOpenClawSystemReady as resolveOpenClawSystemReady
} from "@/lib/openclaw/readiness";
import type {
  AddModelsProviderId,
  DiscoveredModelCandidate,
  MissionResponse,
  MissionControlSnapshot,
  OpenClawModelOnboardingPhase,
  OpenClawModelOnboardingStreamEvent,
  OpenClawOnboardingPhase,
  OpenClawOnboardingStreamEvent,
  ResetPreview,
  ResetStreamEvent,
  ResetTarget,
  TaskFeedEvent,
  OpenClawUpdateStreamEvent,
  TaskRecord
} from "@/lib/agentos/contracts";
import { normalizeAddModelsProviderId } from "@/lib/openclaw/model-provider-registry";
import { cn } from "@/lib/utils";

const MissionCanvasView = dynamic(
  () => import("@/components/mission-control/canvas").then((mod) => mod.MissionCanvas),
  {
    ssr: false,
    loading: () => <div className="h-full w-full" />
  }
);

type ComposeIntent = {
  id: string;
  mission: string;
  agentId?: string;
  sourceKind?: "copy" | "reply";
  sourceLabel?: string;
};

type AgentActionRequest = {
  requestId: string;
  kind: "edit" | "delete";
  agentId: string;
};
type CapabilityEditorRequest = {
  requestId: string;
  agentId: string;
  focus: "skills" | "tools";
};
type AgentModelRequest = {
  requestId: string;
  agentId: string;
};
type OptimisticMissionTask = {
  requestId: string;
  dispatchId: string | null;
  task: TaskRecord;
};
type MissionDispatchStart = {
  requestId: string;
  mission: string;
  agentId: string;
  workspaceId: string | null;
  submittedAt: number;
  abortController: AbortController;
};

type SurfaceTheme = "dark" | "light";
type UpdateRunState = "idle" | "running" | "success" | "error";
type TaskAbortState = "idle" | "running" | "error";
type ResetPreviewState = "idle" | "loading" | "ready" | "error";
type OnboardingWizardStage = "system" | "models";
type GatewayControlAction = "start" | "stop" | "restart";
type ModelOnboardingIntent = "auto" | "refresh" | "discover" | "set-default" | "login-provider";
type InspectorTabId = "overview" | "chat" | "output" | "files" | "raw";

const surfaceThemeStorageKey = "mission-control-surface-theme";
const hiddenRuntimeIdsStorageKey = "mission-control-hidden-runtime-ids";
const hiddenTaskKeysStorageKey = "mission-control-hidden-task-keys";
const lockedTaskKeysStorageKey = "mission-control-locked-task-keys";

export function MissionControlShell({
  initialSnapshot
}: {
  initialSnapshot: MissionControlSnapshot;
}) {
  const { snapshot, connectionState, refresh, refreshSnapshot, setSnapshot } = useMissionControlData(initialSnapshot);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(
    initialSnapshot.workspaces[0]?.id ?? null
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    initialSnapshot.workspaces[0]?.id ?? null
  );
  const [selectedAgentDetailFocus, setSelectedAgentDetailFocus] = useState<AgentDetailFocus | null>(null);
  const [focusedAgentId, setFocusedAgentId] = useState<string | null>(null);
  const [composerTargetAgentId, setComposerTargetAgentId] = useState<string | null>(null);
  const [isComposerActive, setIsComposerActive] = useState(false);
  const [composerViewportResetNonce, setComposerViewportResetNonce] = useState(0);
  const [activeInspectorTab, setActiveInspectorTab] = useState<InspectorTabId>("overview");
  const [lastMission, setLastMission] = useState<MissionResponse | null>(null);
  const [recentDispatchId, setRecentDispatchId] = useState<string | null>(null);
  const [optimisticMissionTasks, setOptimisticMissionTasks] = useState<OptimisticMissionTask[]>([]);
  const [composeIntent, setComposeIntent] = useState<ComposeIntent | null>(null);
  const [hiddenRuntimeIds, setHiddenRuntimeIds] = useState<string[]>([]);
  const [hiddenTaskKeys, setHiddenTaskKeys] = useState<string[]>([]);
  const [lockedTaskKeys, setLockedTaskKeys] = useState<string[]>([]);
  const [agentActionRequest, setAgentActionRequest] = useState<AgentActionRequest | null>(null);
  const [capabilityEditorRequest, setCapabilityEditorRequest] = useState<CapabilityEditorRequest | null>(null);
  const [taskAbortRequest, setTaskAbortRequest] = useState<TaskRecord | null>(null);
  const [taskAbortRunState, setTaskAbortRunState] = useState<TaskAbortState>("idle");
  const [taskAbortMessage, setTaskAbortMessage] = useState<string | null>(null);
  const missionDispatchAbortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isCheckingForUpdates, setIsCheckingForUpdates] = useState(false);
  const [resetDialogTarget, setResetDialogTarget] = useState<ResetTarget | null>(null);
  const [resetPreviewState, setResetPreviewState] = useState<ResetPreviewState>("idle");
  const [resetPreview, setResetPreview] = useState<ResetPreview | null>(null);
  const [resetPreviewError, setResetPreviewError] = useState<string | null>(null);
  const [resetRunState, setResetRunState] = useState<UpdateRunState>("idle");
  const [resetStatusMessage, setResetStatusMessage] = useState<string | null>(null);
  const [resetResultMessage, setResetResultMessage] = useState<string | null>(null);
  const [resetBackgroundLogPath, setResetBackgroundLogPath] = useState<string | null>(null);
  const [resetLog, setResetLog] = useState("");
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [gatewayDraft, setGatewayDraft] = useState(() => resolveGatewayDraft(initialSnapshot));
  const [workspaceRootDraft, setWorkspaceRootDraft] = useState(() => resolveWorkspaceRootDraft(initialSnapshot));
  const [isSavingGateway, setIsSavingGateway] = useState(false);
  const [isSavingWorkspaceRoot, setIsSavingWorkspaceRoot] = useState(false);
  const [isUpdateDialogOpen, setIsUpdateDialogOpen] = useState(false);
  const [updateRunState, setUpdateRunState] = useState<UpdateRunState>("idle");
  const [updateStatusMessage, setUpdateStatusMessage] = useState<string | null>(null);
  const [updateResultMessage, setUpdateResultMessage] = useState<string | null>(null);
  const [updateLog, setUpdateLog] = useState("");
  const [onboardingRunState, setOnboardingRunState] = useState<UpdateRunState>("idle");
  const [onboardingPhase, setOnboardingPhase] = useState<OpenClawOnboardingPhase | null>(null);
  const [onboardingStatusMessage, setOnboardingStatusMessage] = useState<string | null>(null);
  const [onboardingResultMessage, setOnboardingResultMessage] = useState<string | null>(null);
  const [onboardingLog, setOnboardingLog] = useState("");
  const [onboardingManualCommand, setOnboardingManualCommand] = useState<string | null>(null);
  const [onboardingDocsUrl, setOnboardingDocsUrl] = useState<string | null>(null);
  const [onboardingStage, setOnboardingStage] = useState<OnboardingWizardStage>("system");
  const [selectedOnboardingModelId, setSelectedOnboardingModelId] = useState<string>("");
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredModelCandidate[]>([]);
  const [modelOnboardingRunState, setModelOnboardingRunState] = useState<UpdateRunState>("idle");
  const [modelOnboardingPhase, setModelOnboardingPhase] = useState<OpenClawModelOnboardingPhase | null>(null);
  const [modelOnboardingStatusMessage, setModelOnboardingStatusMessage] = useState<string | null>(null);
  const [modelOnboardingResultMessage, setModelOnboardingResultMessage] = useState<string | null>(null);
  const [modelOnboardingLog, setModelOnboardingLog] = useState("");
  const [modelOnboardingManualCommand, setModelOnboardingManualCommand] = useState<string | null>(null);
  const [modelOnboardingDocsUrl, setModelOnboardingDocsUrl] = useState<string | null>(null);
  const [isOnboardingDismissed, setIsOnboardingDismissed] = useState(false);
  const [isOnboardingForcedOpen, setIsOnboardingForcedOpen] = useState(false);
  const [showOnboardingReadyState, setShowOnboardingReadyState] = useState(false);
  const [hasSeenMissionReady, setHasSeenMissionReady] = useState(() =>
    resolveOpenClawMissionReady(initialSnapshot)
  );
  const [gatewayControlAction, setGatewayControlAction] = useState<GatewayControlAction | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [surfaceTheme, setSurfaceTheme] = useState<SurfaceTheme>("dark");
  const [isWorkspaceWizardOpen, setIsWorkspaceWizardOpen] = useState(false);
  const [workspaceWizardInitialMode, setWorkspaceWizardInitialMode] = useState<"basic" | "advanced">("basic");
  const [workspaceWizardEditId, setWorkspaceWizardEditId] = useState<string | null>(null);
  const [isWorkspaceChannelsOpen, setIsWorkspaceChannelsOpen] = useState(false);
  const [isAddModelsDialogOpen, setIsAddModelsDialogOpen] = useState(false);
  const [initialAddModelsProvider, setInitialAddModelsProvider] = useState<AddModelsProviderId | null>(null);
  const [agentModelRequest, setAgentModelRequest] = useState<AgentModelRequest | null>(null);
  const [pendingWorkspaceOpenId, setPendingWorkspaceOpenId] = useState<string | null>(null);
  const activeChatAgentId =
    isInspectorOpen && activeInspectorTab === "chat" ? selectedNodeId : null;
  const uiSnapshot = useMemo(
    () => mergeSnapshotWithOptimisticTasks(snapshot, optimisticMissionTasks),
    [snapshot, optimisticMissionTasks]
  );
  const safeHiddenRuntimeIds = useMemo(
    () => (Array.isArray(hiddenRuntimeIds) ? hiddenRuntimeIds : []),
    [hiddenRuntimeIds]
  );
  const safeHiddenTaskKeys = useMemo(
    () => (Array.isArray(hiddenTaskKeys) ? hiddenTaskKeys : []),
    [hiddenTaskKeys]
  );
  const safeLockedTaskKeys = useMemo(
    () => (Array.isArray(lockedTaskKeys) ? lockedTaskKeys : []),
    [lockedTaskKeys]
  );

  const selectNode = useCallback(
    (nodeId: string | null, tab: InspectorTabId = "overview", agentDetailFocus: AgentDetailFocus | null = null) => {
      setSelectedNodeId(nodeId);
      setActiveInspectorTab(tab);
      setSelectedAgentDetailFocus(agentDetailFocus);
    },
    []
  );
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const canvasNodeInteractionActiveRef = useRef(false);
  const pendingComposerBlurRef = useRef(false);
  const activeRuntimeCount = snapshot.runtimes.filter(
    (runtime) =>
      (runtime.status === "running" || runtime.status === "queued") && !isDirectChatRuntime(runtime)
  ).length;
  const isOpenClawSystemReady = resolveOpenClawSystemReady(snapshot);
  const isOpenClawReady = resolveOpenClawMissionReady(snapshot);
  const updateInstallDescriptor = [
    snapshot.diagnostics.updatePackageManager,
    snapshot.diagnostics.updateInstallKind
  ]
    .filter(Boolean)
    .join(" · ");
  const isUpdateRunning = updateRunState === "running";
  const isUpdateFinished = updateRunState === "success" || updateRunState === "error";
  const updateDialogTitle = resolveUpdateDialogTitle(updateRunState);
  const updateDialogDescription = resolveUpdateDialogDescription(updateRunState);
  const onboardingAction = resolveOnboardingAction(snapshot);
  const hasActiveMissionWork = activeRuntimeCount > 0 || optimisticMissionTasks.length > 0;
  const shouldAutoShowOnboarding =
    !isOnboardingDismissed &&
    !isOpenClawReady &&
    !hasActiveMissionWork &&
    (!hasSeenMissionReady || snapshot.diagnostics.health === "offline");
  const shouldShowOnboarding =
    shouldAutoShowOnboarding || showOnboardingReadyState || isOnboardingForcedOpen;
  const scopedTasks = uiSnapshot.tasks.filter(
    (task) => !activeWorkspaceId || task.workspaceId === activeWorkspaceId
  );
  const hiddenScopedTaskCount = scopedTasks.filter((task) =>
    isTaskHiddenByPreferences(task, safeHiddenRuntimeIds, safeHiddenTaskKeys, safeLockedTaskKeys)
  ).length;
  const toggleWorkspaceTaskCards = useCallback(
    (workspaceId: string) => {
      const workspaceTasks = uiSnapshot.tasks.filter((task) => task.workspaceId === workspaceId);
      const toggleableTasks = workspaceTasks.filter((task) => !safeLockedTaskKeys.includes(task.key));

      if (toggleableTasks.length === 0) {
        return;
      }

      const workspaceTaskCardsHidden = toggleableTasks.every((task) =>
        isTaskHiddenByPreferences(task, safeHiddenRuntimeIds, safeHiddenTaskKeys, safeLockedTaskKeys)
      );
      const workspaceTaskKeys = new Set(toggleableTasks.map((task) => task.key));
      const workspaceRuntimeIds = new Set(toggleableTasks.flatMap((task) => task.runtimeIds));

      if (workspaceTaskCardsHidden) {
        setHiddenTaskKeys((current) => current.filter((key) => !workspaceTaskKeys.has(key)));
        setHiddenRuntimeIds((current) => current.filter((runtimeId) => !workspaceRuntimeIds.has(runtimeId)));
        return;
      }

      setHiddenTaskKeys((current) => Array.from(new Set([...current, ...workspaceTaskKeys])));
      setHiddenRuntimeIds((current) =>
        Array.from(new Set([...current, ...workspaceRuntimeIds]))
      );
    },
    [uiSnapshot.tasks, safeHiddenRuntimeIds, safeHiddenTaskKeys, safeLockedTaskKeys]
  );

  const handleFocusAgent = useCallback(
    (agentId: string) => {
      const agent = uiSnapshot.agents.find((entry) => entry.id === agentId);

      if (!agent) {
        return;
      }

      setFocusedAgentId((current) => (current === agentId ? null : agentId));
      setActiveWorkspaceId(agent.workspaceId);
      selectNode(agentId);
    },
    [selectNode, uiSnapshot.agents]
  );

  const handleInspectAgentDetail = useCallback(
    (agentId: string, focus: AgentDetailFocus) => {
      const agent = uiSnapshot.agents.find((entry) => entry.id === agentId);

      if (!agent) {
        return;
      }

      setActiveWorkspaceId(agent.workspaceId);
      setIsInspectorOpen(true);
      selectNode(agent.id, "overview", focus);
    },
    [selectNode, uiSnapshot.agents]
  );

  const handleConfigureAgentCapabilities = useCallback(
    (agentId: string, focus: "skills" | "tools") => {
      const agent = uiSnapshot.agents.find((entry) => entry.id === agentId);

      if (!agent) {
        return;
      }

      setActiveWorkspaceId(agent.workspaceId);
      selectNode(agent.id);
      setCapabilityEditorRequest({
        requestId: `capabilities:${agentId}:${focus}:${Date.now()}`,
        agentId,
        focus
      });
    },
    [selectNode, uiSnapshot.agents]
  );

  const handleConfigureAgentModel = useCallback(
    (agentId: string) => {
      const agent = uiSnapshot.agents.find((entry) => entry.id === agentId);

      if (!agent) {
        return;
      }

      setActiveWorkspaceId(agent.workspaceId);
      selectNode(agent.id);
      setAgentModelRequest({
        requestId: `model:${agentId}:${Date.now()}`,
        agentId
      });
    },
    [selectNode, uiSnapshot.agents]
  );

  const handleAgentModelPickerOpenChange = useCallback((open: boolean) => {
    if (open) {
      return;
    }

    setAgentModelRequest(null);
  }, []);

  const handleCapabilityEditorOpenChange = useCallback((open: boolean) => {
    if (open) {
      return;
    }

    setCapabilityEditorRequest(null);
  }, []);

  const handleComposerTargetAgentSelect = useCallback(
    (agentId: string) => {
      if (!focusedAgentId) {
        return;
      }

      const agent = uiSnapshot.agents.find((entry) => entry.id === agentId);

      if (!agent) {
        return;
      }

      if (
        focusedAgentId === agentId &&
        activeWorkspaceId === agent.workspaceId &&
        selectedNodeId === agentId
      ) {
        return;
      }

      setFocusedAgentId(agentId);
      setActiveWorkspaceId(agent.workspaceId);
      selectNode(agentId);
    },
    [activeWorkspaceId, focusedAgentId, selectNode, selectedNodeId, uiSnapshot.agents]
  );

  const handleCanvasNodePointerDownCapture = useCallback(() => {
    canvasNodeInteractionActiveRef.current = true;
  }, []);

  const handleComposerActiveChange = useCallback(
    (active: boolean) => {
      if (active) {
        pendingComposerBlurRef.current = false;
        setIsComposerActive(true);
        return;
      }

      if (canvasNodeInteractionActiveRef.current) {
        pendingComposerBlurRef.current = true;
        return;
      }

      pendingComposerBlurRef.current = false;
      setIsComposerActive(false);
    },
    []
  );

  const handleResetFocus = useCallback(() => {
    setFocusedAgentId(null);
    selectNode(activeWorkspaceId ?? uiSnapshot.workspaces[0]?.id ?? null);
  }, [activeWorkspaceId, selectNode, uiSnapshot.workspaces]);

  useEffect(() => {
    const handlePointerUp = () => {
      if (!canvasNodeInteractionActiveRef.current) {
        return;
      }

      canvasNodeInteractionActiveRef.current = false;

      if (!pendingComposerBlurRef.current) {
        return;
      }

      pendingComposerBlurRef.current = false;
      setIsComposerActive(false);
      setComposerViewportResetNonce((current) => current + 1);
    };

    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, []);

  const openWorkspaceWizard = useCallback((mode: "basic" | "advanced" = "basic") => {
    setWorkspaceWizardEditId(null);
    setWorkspaceWizardInitialMode(mode);
    setIsWorkspaceWizardOpen(true);
  }, []);

  const openWorkspaceWizardForEdit = useCallback((workspaceId: string) => {
    setWorkspaceWizardEditId(workspaceId);
    setWorkspaceWizardInitialMode("advanced");
    setIsWorkspaceWizardOpen(true);
  }, []);

  const handleWorkspaceWizardOpenChange = useCallback((nextOpen: boolean) => {
    setIsWorkspaceWizardOpen(nextOpen);

    if (!nextOpen) {
      setWorkspaceWizardEditId(null);
      setWorkspaceWizardInitialMode("basic");
    }
  }, []);

  const openWorkspaceChannels = useCallback((workspaceId?: string) => {
    if (workspaceId) {
      setActiveWorkspaceId(workspaceId);
    }

    setIsWorkspaceChannelsOpen(true);
  }, []);

  useEffect(() => {
    if (!activeWorkspaceId) {
      return;
    }

    const workspaceExists = snapshot.workspaces.some((workspace) => workspace.id === activeWorkspaceId);

    if (workspaceExists) {
      if (pendingWorkspaceOpenId === activeWorkspaceId) {
        setPendingWorkspaceOpenId(null);
      }

      return;
    }

    if (pendingWorkspaceOpenId === activeWorkspaceId) {
      return;
    }

    setActiveWorkspaceId(snapshot.workspaces[0]?.id ?? null);
  }, [snapshot.workspaces, activeWorkspaceId, pendingWorkspaceOpenId]);

  useEffect(() => {
    if (optimisticMissionTasks.length === 0) {
      return;
    }

    const replacements = optimisticMissionTasks
      .map((entry) => ({
        entry,
        replacement: findReplacementTaskForOptimisticTask(snapshot.tasks, entry)
      }))
      .filter((entry): entry is { entry: OptimisticMissionTask; replacement: TaskRecord } => Boolean(entry.replacement));

    if (replacements.length === 0) {
      return;
    }

    const replacementByRequestId = new Map(replacements.map(({ entry, replacement }) => [entry.requestId, replacement]));

    setOptimisticMissionTasks((current) =>
      current.filter((entry) => !replacementByRequestId.has(entry.requestId))
    );

    const selectedOptimisticTask = optimisticMissionTasks.find((entry) => entry.task.id === selectedNodeId);
    const nextSelectedTask = selectedOptimisticTask
      ? replacementByRequestId.get(selectedOptimisticTask.requestId) ?? null
      : null;

    if (!nextSelectedTask) {
      return;
    }

    setSelectedNodeId(nextSelectedTask.id);

    if (nextSelectedTask.workspaceId) {
      setActiveWorkspaceId(nextSelectedTask.workspaceId);
    }
  }, [optimisticMissionTasks, selectedNodeId, snapshot.tasks]);

  useEffect(() => {
    if (!selectedNodeId) {
      return;
    }

    const exists =
      uiSnapshot.workspaces.some((entry) => entry.id === selectedNodeId) ||
      uiSnapshot.agents.some((entry) => entry.id === selectedNodeId) ||
      uiSnapshot.tasks.some((entry) => entry.id === selectedNodeId) ||
      uiSnapshot.runtimes.some((entry) => entry.id === selectedNodeId) ||
      uiSnapshot.models.some((entry) => entry.id === selectedNodeId);

    if (exists) {
      if (pendingWorkspaceOpenId === selectedNodeId) {
        setPendingWorkspaceOpenId(null);
      }

      return;
    }

    if (pendingWorkspaceOpenId === selectedNodeId) {
      return;
    }

    selectNode(activeWorkspaceId || uiSnapshot.workspaces[0]?.id || null);
  }, [uiSnapshot, selectedNodeId, activeWorkspaceId, pendingWorkspaceOpenId, selectNode]);

  useEffect(() => {
    const selectedTask = uiSnapshot.tasks.find((task) => task.id === selectedNodeId);
    const taskHidden =
      selectedTask &&
      isTaskHiddenByPreferences(selectedTask, safeHiddenRuntimeIds, safeHiddenTaskKeys, safeLockedTaskKeys);

    if (!selectedNodeId) {
      return;
    }

    if (focusedAgentId && !isComposerActive) {
      const selectionVisibleInFocus =
        selectedNodeId === focusedAgentId || selectedTask?.primaryAgentId === focusedAgentId;

      if (!selectionVisibleInFocus) {
        selectNode(focusedAgentId);
      }
      return;
    }

    if (safeHiddenRuntimeIds.includes(selectedNodeId) || taskHidden) {
      selectNode(activeWorkspaceId || uiSnapshot.workspaces[0]?.id || null);
    }
  }, [
    selectedNodeId,
    focusedAgentId,
    isComposerActive,
    safeHiddenRuntimeIds,
    safeHiddenTaskKeys,
    safeLockedTaskKeys,
    activeWorkspaceId,
    uiSnapshot.workspaces,
    uiSnapshot.tasks,
    selectNode
  ]);

  useEffect(() => {
    if (!focusedAgentId) {
      return;
    }

    const focusedAgentExists = uiSnapshot.agents.some((agent) => agent.id === focusedAgentId);

    if (!focusedAgentExists) {
      setFocusedAgentId(null);
    }
  }, [focusedAgentId, uiSnapshot.agents]);

  useEffect(() => {
    const storedTheme = globalThis.localStorage?.getItem(surfaceThemeStorageKey);
    const storedHiddenRuntimeIds = globalThis.localStorage?.getItem(hiddenRuntimeIdsStorageKey);
    const storedHiddenTaskKeys = globalThis.localStorage?.getItem(hiddenTaskKeysStorageKey);
    const storedLockedTaskKeys = globalThis.localStorage?.getItem(lockedTaskKeysStorageKey);

    if (storedTheme === "dark" || storedTheme === "light") {
      setSurfaceTheme(storedTheme);
    }

    if (storedHiddenRuntimeIds) {
      try {
        const parsed = JSON.parse(storedHiddenRuntimeIds) as unknown;
        if (Array.isArray(parsed)) {
          setHiddenRuntimeIds(parsed.filter((entry): entry is string => typeof entry === "string"));
        }
      } catch {}
    }

    if (storedHiddenTaskKeys) {
      try {
        const parsed = JSON.parse(storedHiddenTaskKeys) as unknown;
        if (Array.isArray(parsed)) {
          setHiddenTaskKeys(parsed.filter((entry): entry is string => typeof entry === "string"));
        }
      } catch {}
    }

    if (storedLockedTaskKeys) {
      try {
        const parsed = JSON.parse(storedLockedTaskKeys) as unknown;
        if (Array.isArray(parsed)) {
          setLockedTaskKeys(parsed.filter((entry): entry is string => typeof entry === "string"));
        }
      } catch {}
    }
  }, []);

  useEffect(() => {
    globalThis.localStorage?.setItem(surfaceThemeStorageKey, surfaceTheme);
  }, [surfaceTheme]);

  useEffect(() => {
    globalThis.localStorage?.setItem(hiddenRuntimeIdsStorageKey, JSON.stringify(hiddenRuntimeIds));
  }, [hiddenRuntimeIds]);

  useEffect(() => {
    globalThis.localStorage?.setItem(hiddenTaskKeysStorageKey, JSON.stringify(hiddenTaskKeys));
  }, [hiddenTaskKeys]);

  useEffect(() => {
    globalThis.localStorage?.setItem(lockedTaskKeysStorageKey, JSON.stringify(lockedTaskKeys));
  }, [lockedTaskKeys]);

  useEffect(() => {
    if (!recentDispatchId) {
      return;
    }

    const relatedTask = snapshot.tasks.find((task) => task.dispatchId === recentDispatchId);

    if (relatedTask) {
      selectNode(relatedTask.id, "overview");
      setIsInspectorOpen(true);
      setRecentDispatchId(null);
    }
  }, [recentDispatchId, snapshot.tasks, selectNode]);

  useEffect(() => {
    setOptimisticMissionTasks((current) =>
      current.filter((entry) => {
        const submittedAt =
          typeof entry.task.metadata.dispatchSubmittedAt === "string"
            ? Date.parse(entry.task.metadata.dispatchSubmittedAt)
            : entry.task.updatedAt ?? Number.NaN;
        const isStale = !Number.isNaN(submittedAt) && Date.now() - submittedAt > 30 * 60 * 1000;

        if (!entry.dispatchId) {
          return !isStale;
        }

        const matchedTask = snapshot.tasks.find((task) => task.dispatchId === entry.dispatchId);

        if (!matchedTask) {
          return !isStale;
        }

        return matchedTask.status === "running" || matchedTask.status === "queued";
      })
    );
  }, [snapshot.tasks]);

  useEffect(() => {
    if (isSettingsOpen || isSavingGateway || isSavingWorkspaceRoot) {
      return;
    }

    setGatewayDraft(resolveGatewayDraft(snapshot));
    setWorkspaceRootDraft(resolveWorkspaceRootDraft(snapshot));
  }, [snapshot, isSettingsOpen, isSavingGateway, isSavingWorkspaceRoot]);

  useEffect(() => {
    if (isOpenClawReady) {
      setIsOnboardingDismissed(false);
    }
  }, [isOpenClawReady]);

  useEffect(() => {
    if (isOpenClawReady) {
      setHasSeenMissionReady(true);
    }
  }, [isOpenClawReady]);

  useEffect(() => {
    setSelectedOnboardingModelId((current) => {
      const availableModelIds = snapshot.models
        .filter((model) => model.available !== false && !model.missing)
        .map((model) => model.id);
      const recommendedModelId = snapshot.diagnostics.modelReadiness.recommendedModelId;

      if (current && availableModelIds.includes(current)) {
        return current;
      }

      if (recommendedModelId && availableModelIds.includes(recommendedModelId)) {
        return recommendedModelId;
      }

      return availableModelIds[0] || "";
    });
  }, [snapshot.models, snapshot.diagnostics.modelReadiness.recommendedModelId]);

  useEffect(() => {
    if (!isOpenClawSystemReady) {
      setOnboardingStage("system");
      return;
    }

    setOnboardingStage("models");
  }, [isOpenClawSystemReady]);

  useEffect(() => {
    if (isOpenClawReady) {
      if (onboardingRunState !== "idle" || modelOnboardingRunState !== "idle") {
        setOnboardingRunState("success");
        setOnboardingPhase("ready");
        setOnboardingStatusMessage(null);
        setOnboardingResultMessage("OpenClaw and a usable default model are ready. Choose your next step.");
        setModelOnboardingRunState("success");
        setModelOnboardingPhase("ready");
        setModelOnboardingStatusMessage(null);
        setModelOnboardingResultMessage("A usable default model is ready. Choose your next step.");
        setOnboardingStage("models");
        setShowOnboardingReadyState(true);
      } else {
        setShowOnboardingReadyState(false);
      }
      return;
    }

    setShowOnboardingReadyState(false);
  }, [isOpenClawReady, onboardingRunState, modelOnboardingRunState]);

  const resetUpdateDialogState = () => {
    if (updateRunState === "running") {
      return;
    }

    setUpdateRunState("idle");
    setUpdateStatusMessage(null);
    setUpdateResultMessage(null);
    setUpdateLog("");
  };

  const appendUpdateLog = (text: string) => {
    setUpdateLog((current) => {
      const next = `${current}${text}`;
      return next.length > 40000 ? next.slice(next.length - 40000) : next;
    });
  };

  const appendOnboardingLog = (text: string) => {
    setOnboardingLog((current) => {
      const next = `${current}${text}`;
      return next.length > 40000 ? next.slice(next.length - 40000) : next;
    });
  };

  const appendModelOnboardingLog = (text: string) => {
    setModelOnboardingLog((current) => {
      const next = `${current}${text}`;
      return next.length > 40000 ? next.slice(next.length - 40000) : next;
    });
  };

  const appendResetLog = (text: string) => {
    setResetLog((current) => {
      const next = `${current}${text}`;
      return next.length > 40000 ? next.slice(next.length - 40000) : next;
    });
  };

  const confirmTaskAbort = useCallback(async () => {
    if (!taskAbortRequest || taskAbortRunState === "running") {
      return;
    }

    const optimisticRequestId =
      typeof taskAbortRequest.metadata.optimisticRequestId === "string"
        ? taskAbortRequest.metadata.optimisticRequestId
        : null;
    const optimisticTaskEntry = optimisticRequestId
      ? optimisticMissionTasks.find((entry) => entry.requestId === optimisticRequestId)
      : optimisticMissionTasks.find((entry) => entry.task.id === taskAbortRequest.id);
    const resolvedDispatchId =
      typeof taskAbortRequest.dispatchId === "string"
        ? taskAbortRequest.dispatchId
        : optimisticTaskEntry?.dispatchId ?? null;

    if (optimisticRequestId && !resolvedDispatchId) {
      missionDispatchAbortControllersRef.current.get(optimisticRequestId)?.abort();
      missionDispatchAbortControllersRef.current.delete(optimisticRequestId);

      setOptimisticMissionTasks((current) =>
        current.map((entry) =>
          entry.requestId === optimisticRequestId
            ? {
                ...entry,
                task: updateOptimisticMissionTask(entry.task, {
                  status: "cancelled",
                  subtitle: "Mission submission cancelled before dispatch.",
                  bootstrapStage: "cancelled",
                  feedEvent: {
                    id: `${entry.task.id}:cancelled:${Date.now()}`,
                    kind: "warning",
                    timestamp: new Date().toISOString(),
                    title: "Dispatch cancelled",
                    detail: "Mission submission cancelled before dispatch.",
                    isError: false
                  }
                })
              }
            : entry
        )
      );

      toast.success("Mission submission cancelled.", {
        description: taskAbortRequest.title
      });
      setTaskAbortRequest(null);
      setTaskAbortRunState("idle");
      setTaskAbortMessage(null);
      return;
    }

    setTaskAbortRunState("running");
    setTaskAbortMessage(null);

    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskAbortRequest.id)}/abort`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          reason: "Aborted from AgentOS.",
          dispatchId: resolvedDispatchId
        })
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            error?: string;
            message?: string;
            summary?: string;
          }
        | null;

      if (!response.ok) {
        throw new Error(
          payload?.error || payload?.message || payload?.summary || "Unable to abort task."
        );
      }

      toast.success("Task abort requested.", {
        description: taskAbortRequest.title
      });
      setTaskAbortRequest(null);
      setTaskAbortRunState("idle");
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown abort error.";
      setTaskAbortRunState("error");
      setTaskAbortMessage(message);
      toast.error("Task abort failed.", {
        description: message
      });
    }
  }, [optimisticMissionTasks, refresh, taskAbortRequest, taskAbortRunState]);

  const applyDiscoveredModels = (nextDiscoveredModels: DiscoveredModelCandidate[] | undefined) => {
    if (!nextDiscoveredModels) {
      return;
    }

    setDiscoveredModels(nextDiscoveredModels);
  };

  useEffect(() => {
    if (!isSettingsOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (settingsRef.current?.contains(event.target as Node)) {
        return;
      }

      setIsSettingsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSettingsOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSettingsOpen]);

  const runOpenClawUpdate = async () => {
    setIsUpdateDialogOpen(true);
    setUpdateRunState("running");
    setUpdateStatusMessage("Starting OpenClaw update...");
    setUpdateResultMessage(null);
    setUpdateLog("");

    try {
      const response = await fetch("/api/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          confirmed: true
        })
      });

      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(result?.error || "OpenClaw update request failed.");
      }

      if (!response.body) {
        throw new Error("OpenClaw update did not return a readable stream.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawDone = false;

      while (true) {
        const { value, done } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        let newlineIndex = buffer.indexOf("\n");

        while (newlineIndex >= 0) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);

          if (line) {
            const event = JSON.parse(line) as OpenClawUpdateStreamEvent;

            if (event.type === "status") {
              setUpdateStatusMessage(event.message);
              appendUpdateLog(`\n> ${event.message}\n`);
            } else if (event.type === "log") {
              appendUpdateLog(event.text);
            } else {
              sawDone = true;
              setUpdateStatusMessage(null);
              setUpdateResultMessage(event.message);
              setUpdateRunState(event.ok ? "success" : "error");

              if (event.snapshot) {
                setSnapshot(event.snapshot);
              }

              if (event.ok) {
                toast.success("OpenClaw updated.", {
                  description: event.message
                });
              } else {
                toast.error("OpenClaw update failed.", {
                  description: event.message
                });
              }
            }
          }

          newlineIndex = buffer.indexOf("\n");
        }
      }

      const trailing = buffer.trim();

      if (trailing) {
        const event = JSON.parse(trailing) as OpenClawUpdateStreamEvent;

        if (event.type === "done") {
          sawDone = true;
          setUpdateStatusMessage(null);
          setUpdateResultMessage(event.message);
          setUpdateRunState(event.ok ? "success" : "error");

          if (event.snapshot) {
            setSnapshot(event.snapshot);
          }
        }
      }

      if (!sawDone) {
        throw new Error("OpenClaw update stream ended unexpectedly.");
      }
    } catch (error) {
      setUpdateRunState("error");
      setUpdateStatusMessage(null);
      setUpdateResultMessage(error instanceof Error ? error.message : "OpenClaw update failed.");
      toast.error("OpenClaw update failed.", {
        description: error instanceof Error ? error.message : "Unknown update error."
      });
    }
  };

  const runOpenClawOnboarding = async () => {
    setIsOnboardingDismissed(false);
    setOnboardingStage("system");
    setOnboardingRunState("running");
    setOnboardingPhase("detecting");
    setOnboardingStatusMessage("Checking local OpenClaw status...");
    setOnboardingResultMessage(null);
    setOnboardingManualCommand(null);
    setOnboardingDocsUrl(null);
    setOnboardingLog("");

    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          intent: "auto"
        })
      });

      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(result?.error || "OpenClaw onboarding request failed.");
      }

      if (!response.body) {
        throw new Error("OpenClaw onboarding did not return a readable stream.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawDone = false;

      while (true) {
        const { value, done } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        let newlineIndex = buffer.indexOf("\n");

        while (newlineIndex >= 0) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);

          if (line) {
            const event = JSON.parse(line) as OpenClawOnboardingStreamEvent;

            if (event.type === "status") {
              setOnboardingPhase(event.phase);
              setOnboardingStatusMessage(event.message);
              appendOnboardingLog(`\n> ${event.message}\n`);
            } else if (event.type === "log") {
              appendOnboardingLog(event.text);
            } else {
              sawDone = true;
              setOnboardingPhase(event.phase);
              setOnboardingStatusMessage(null);
              setOnboardingResultMessage(event.message);
              setOnboardingManualCommand(event.manualCommand ?? null);
              setOnboardingDocsUrl(event.docsUrl ?? null);
              setOnboardingRunState(event.ok ? "success" : "error");

              if (event.snapshot) {
                setSnapshot(event.snapshot);
              }

              if (event.ok) {
                toast.success("System setup ready.", {
                  description: event.message
                });
              } else {
                toast.error("OpenClaw onboarding failed.", {
                  description: event.message
                });
              }
            }
          }

          newlineIndex = buffer.indexOf("\n");
        }
      }

      const trailing = buffer.trim();

      if (trailing) {
        const event = JSON.parse(trailing) as OpenClawOnboardingStreamEvent;

        if (event.type === "done") {
          sawDone = true;
          setOnboardingPhase(event.phase);
          setOnboardingStatusMessage(null);
          setOnboardingResultMessage(event.message);
          setOnboardingManualCommand(event.manualCommand ?? null);
          setOnboardingDocsUrl(event.docsUrl ?? null);
          setOnboardingRunState(event.ok ? "success" : "error");

          if (event.snapshot) {
            setSnapshot(event.snapshot);
          }
        }
      }

      if (!sawDone) {
        throw new Error("OpenClaw onboarding stream ended unexpectedly.");
      }
    } catch (error) {
      setOnboardingRunState("error");
      setOnboardingStatusMessage(null);
      setOnboardingResultMessage(
        error instanceof Error ? error.message : "OpenClaw onboarding failed."
      );
      toast.error("OpenClaw onboarding failed.", {
        description: error instanceof Error ? error.message : "Unknown onboarding error."
      });
    }
  };

  const runModelOnboarding = async (
    payload:
      | { intent: Extract<ModelOnboardingIntent, "auto">; modelId?: string }
      | { intent: Extract<ModelOnboardingIntent, "refresh"> }
      | { intent: Extract<ModelOnboardingIntent, "discover"> }
      | { intent: Extract<ModelOnboardingIntent, "set-default">; modelId: string }
      | { intent: Extract<ModelOnboardingIntent, "login-provider">; provider: string }
  ) => {
    const actionCopy = resolveModelOnboardingActionCopy(payload.intent);

    setIsOnboardingDismissed(false);
    setOnboardingStage("models");
    setModelOnboardingRunState("running");
    setModelOnboardingPhase(resolveModelOnboardingStartPhase(payload.intent));
    setModelOnboardingStatusMessage(actionCopy.statusMessage);
    setModelOnboardingResultMessage(null);
    setModelOnboardingManualCommand(null);
    setModelOnboardingDocsUrl(null);
    setModelOnboardingLog("");

    try {
      const response = await fetch("/api/onboarding/models", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(result?.error || "Model onboarding request failed.");
      }

      if (!response.body) {
        throw new Error("Model onboarding did not return a readable stream.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawDone = false;

      while (true) {
        const { value, done } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        let newlineIndex = buffer.indexOf("\n");

        while (newlineIndex >= 0) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);

          if (line) {
            const event = JSON.parse(line) as OpenClawModelOnboardingStreamEvent;

            if (event.type === "status") {
              setModelOnboardingPhase(event.phase);
              setModelOnboardingStatusMessage(event.message);
              appendModelOnboardingLog(`\n> ${event.message}\n`);
            } else if (event.type === "log") {
              appendModelOnboardingLog(event.text);
            } else {
              sawDone = true;
              setModelOnboardingPhase(event.phase);
              setModelOnboardingStatusMessage(null);
              setModelOnboardingResultMessage(event.message);
              setModelOnboardingManualCommand(event.manualCommand ?? null);
              setModelOnboardingDocsUrl(event.docsUrl ?? null);
              setModelOnboardingRunState(event.ok ? "success" : "error");
              applyDiscoveredModels(event.discoveredModels);

              if (event.snapshot) {
                setSnapshot(event.snapshot);
              }

              if (event.ok) {
                toast.success(actionCopy.successTitle, {
                  description: event.message
                });
              } else if (event.phase === "authenticating" && event.manualCommand) {
                toast.message("Continue in terminal.", {
                  description: event.message
                });
              } else {
                toast.error(actionCopy.errorTitle, {
                  description: event.message
                });
              }
            }
          }

          newlineIndex = buffer.indexOf("\n");
        }
      }

      const trailing = buffer.trim();

      if (trailing) {
        const event = JSON.parse(trailing) as OpenClawModelOnboardingStreamEvent;

        if (event.type === "done") {
          sawDone = true;
          setModelOnboardingPhase(event.phase);
          setModelOnboardingStatusMessage(null);
          setModelOnboardingResultMessage(event.message);
          setModelOnboardingManualCommand(event.manualCommand ?? null);
          setModelOnboardingDocsUrl(event.docsUrl ?? null);
          setModelOnboardingRunState(event.ok ? "success" : "error");
          applyDiscoveredModels(event.discoveredModels);

          if (event.snapshot) {
            setSnapshot(event.snapshot);
          }
        }
      }

      if (!sawDone) {
        throw new Error("Model onboarding stream ended unexpectedly.");
      }
    } catch (error) {
      setModelOnboardingRunState("error");
      setModelOnboardingStatusMessage(null);
      setModelOnboardingResultMessage(
        error instanceof Error ? error.message : "Model onboarding failed."
      );
      toast.error(actionCopy.errorTitle, {
        description: error instanceof Error ? error.message : "Unknown model onboarding error."
      });
    }
  };

  const runModelAutoOnboarding = async () => {
    await runModelOnboarding({
      intent: "auto",
      modelId: selectedOnboardingModelId || undefined
    });
  };

  const runModelRefresh = async () => {
    await runModelOnboarding({
      intent: "refresh"
    });
  };

  const runModelDiscover = async () => {
    await runModelOnboarding({
      intent: "discover"
    });
  };

  const runModelProviderLogin = async (provider: string) => {
    await runModelOnboarding({
      intent: "login-provider",
      provider
    });
  };

  const runModelSetDefault = async (modelId?: string) => {
    const targetModelId = modelId || selectedOnboardingModelId;

    if (targetModelId) {
      await runModelOnboarding({
        intent: "set-default",
        modelId: targetModelId
      });
      return;
    }

    await runModelAutoOnboarding();
  };

  const openSetupWizard = (stage: OnboardingWizardStage = isOpenClawSystemReady ? "models" : "system") => {
    setIsSettingsOpen(false);
    setOnboardingStage(stage);
    setIsOnboardingDismissed(false);
    setShowOnboardingReadyState(false);
    setIsOnboardingForcedOpen(true);
  };

  const dismissOnboarding = () => {
    setIsOnboardingForcedOpen(false);
    setShowOnboardingReadyState(false);

    if (!isOpenClawReady) {
      setIsOnboardingDismissed(true);
    }
  };

  const controlGateway = async (action: GatewayControlAction) => {
    setGatewayControlAction(action);

    try {
      const response = await fetch("/api/gateway/control", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action
        })
      });

      const result = (await response.json()) as {
        error?: string;
        message?: string;
        snapshot?: MissionControlSnapshot;
      };

      if (!response.ok || result.error || !result.snapshot) {
        throw new Error(result.error || "Gateway control request failed.");
      }

      setSnapshot(result.snapshot);
      toast.success("Gateway updated.", {
        description: result.message || "Gateway state changed."
      });
    } catch (error) {
      toast.error("Gateway action failed.", {
        description: error instanceof Error ? error.message : "Unknown gateway control error."
      });
    } finally {
      setGatewayControlAction(null);
    }
  };

  const openAddModelsDialog = (provider?: AddModelsProviderId | null) => {
    setInitialAddModelsProvider(normalizeAddModelsProviderId(provider));
    setIsAddModelsDialogOpen(true);
  };

  const openAddModelsFromModelPicker = () => {
    setAgentModelRequest(null);
    openAddModelsDialog(null);
  };

  const checkForUpdates = async () => {
    setIsCheckingForUpdates(true);

    try {
      const nextSnapshot = await refreshSnapshot();
      const checkedAt = Date.now();
      const updateInfo = nextSnapshot.diagnostics.updateInfo?.trim();

      setLastCheckedAt(checkedAt);

      if (!nextSnapshot.diagnostics.installed) {
        toast.message("OpenClaw is unavailable.", {
          description: nextSnapshot.diagnostics.issues[0] || "AgentOS is running in fallback mode."
        });
        return;
      }

      if (nextSnapshot.diagnostics.updateAvailable) {
        toast.message("Update available.", {
          description:
            updateInfo ||
            `v${nextSnapshot.diagnostics.latestVersion} is available. Current version: v${nextSnapshot.diagnostics.version || "unknown"}.`
        });
        return;
      }

      if (nextSnapshot.diagnostics.latestVersion && !nextSnapshot.diagnostics.version) {
        toast.message("Update status refreshed.", {
          description:
            updateInfo || `Latest available version: v${nextSnapshot.diagnostics.latestVersion}.`
        });
        return;
      }

      if (nextSnapshot.diagnostics.updateError) {
        toast.error("Update check could not reach the registry.", {
          description: updateInfo || nextSnapshot.diagnostics.updateError
        });
        return;
      }

      toast.success("OpenClaw is up to date.", {
        description:
          updateInfo ||
          `Current version: v${nextSnapshot.diagnostics.version || "unknown"}. No newer release was reported.`
      });
    } catch (error) {
      toast.error("Update check failed.", {
        description: error instanceof Error ? error.message : "Unable to refresh OpenClaw status."
      });
    } finally {
      setIsCheckingForUpdates(false);
    }
  };

  const saveGatewaySettings = async (nextGatewayUrl: string | null) => {
    setIsSavingGateway(true);

    try {
      const response = await fetch("/api/settings/gateway", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          gatewayUrl: nextGatewayUrl
        })
      });

      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(result?.error || "Gateway settings could not be updated.");
      }

      const result = (await response.json()) as { snapshot: MissionControlSnapshot };
      setSnapshot(result.snapshot);
      setGatewayDraft(resolveGatewayDraft(result.snapshot));

      toast.success("Gateway updated.", {
        description: nextGatewayUrl?.trim()
          ? `AgentOS now targets ${result.snapshot.diagnostics.configuredGatewayUrl || result.snapshot.diagnostics.gatewayUrl}.`
          : "AgentOS reverted to the local default gateway."
      });
    } catch (error) {
      toast.error("Gateway update failed.", {
        description: error instanceof Error ? error.message : "Unable to update the OpenClaw gateway."
      });
    } finally {
      setIsSavingGateway(false);
    }
  };

  const saveWorkspaceRootSettings = async (nextWorkspaceRoot: string | null) => {
    setIsSavingWorkspaceRoot(true);

    try {
      const response = await fetch("/api/settings/workspace-root", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          workspaceRoot: nextWorkspaceRoot
        })
      });

      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(result?.error || "Workspace root could not be updated.");
      }

      const result = (await response.json()) as { snapshot: MissionControlSnapshot };
      setSnapshot(result.snapshot);
      setWorkspaceRootDraft(resolveWorkspaceRootDraft(result.snapshot));

      toast.success("Workspace root updated.", {
        description: nextWorkspaceRoot?.trim()
          ? `New workspaces will default to ${compactPath(result.snapshot.diagnostics.workspaceRoot)}. Existing workspaces stay where they are.`
          : "AgentOS reverted to the default workspace root. Existing workspaces were not moved."
      });
    } catch (error) {
      toast.error("Workspace root update failed.", {
        description: error instanceof Error ? error.message : "Unable to update the default workspace root."
      });
    } finally {
      setIsSavingWorkspaceRoot(false);
    }
  };

  const clearMissionControlBrowserState = () => {
    if (typeof globalThis.localStorage === "undefined") {
      return;
    }

    const exactKeys = [
      "mission-control-surface-theme",
      "mission-control-workspace-plan-id",
      "mission-control-recent-prompts"
    ];
    const prefixKeys = ["mission-control-composer-draft:"];

    for (const key of exactKeys) {
      globalThis.localStorage.removeItem(key);
    }

    for (let index = globalThis.localStorage.length - 1; index >= 0; index -= 1) {
      const key = globalThis.localStorage.key(index);

      if (!key) {
        continue;
      }

      if (prefixKeys.some((prefix) => key.startsWith(prefix))) {
        globalThis.localStorage.removeItem(key);
      }
    }
  };

  const resetResetDialogState = () => {
    setResetPreviewState("idle");
    setResetPreview(null);
    setResetPreviewError(null);
    setResetRunState("idle");
    setResetStatusMessage(null);
    setResetResultMessage(null);
    setResetBackgroundLogPath(null);
    setResetLog("");
    setResetConfirmText("");
  };

  const loadResetPreview = async (target: ResetTarget) => {
    setResetPreviewState("loading");
    setResetPreview(null);
    setResetPreviewError(null);

    try {
      const response = await fetch("/api/reset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          intent: "preview",
          target
        })
      });

      const result = (await response.json().catch(() => null)) as
        | { preview?: ResetPreview; error?: string }
        | null;

      if (!response.ok || !result?.preview) {
        throw new Error(result?.error || "Reset preview could not be loaded.");
      }

      setResetPreview(result.preview);
      setResetPreviewState("ready");
    } catch (error) {
      setResetPreviewState("error");
      setResetPreviewError(error instanceof Error ? error.message : "Reset preview failed.");
    }
  };

  const openResetDialog = async (target: ResetTarget) => {
    setIsSettingsOpen(false);
    setResetDialogTarget(target);
    resetResetDialogState();
    await loadResetPreview(target);
  };

  const runReset = async () => {
    if (!resetDialogTarget) {
      return;
    }

    setResetRunState("running");
    setResetStatusMessage(
      resetDialogTarget === "full-uninstall"
        ? "Starting full uninstall..."
        : "Starting AgentOS reset..."
    );
    setResetResultMessage(null);
    setResetBackgroundLogPath(null);
    setResetLog("");

    try {
      const response = await fetch("/api/reset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          intent: "execute",
          target: resetDialogTarget,
          confirmed: true
        })
      });

      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(result?.error || "Reset request failed.");
      }

      if (!response.body) {
        throw new Error("Reset request did not return a readable stream.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawDone = false;

      while (true) {
        const { value, done } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        let newlineIndex = buffer.indexOf("\n");

        while (newlineIndex >= 0) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);

          if (line) {
            const event = JSON.parse(line) as ResetStreamEvent;

            if (event.type === "status") {
              setResetStatusMessage(event.message);
              appendResetLog(`\n> ${event.message}\n`);
            } else if (event.type === "log") {
              appendResetLog(`${event.text}\n`);
            } else {
              sawDone = true;
              setResetStatusMessage(null);
              setResetResultMessage(event.message);
              setResetBackgroundLogPath(event.backgroundLogPath ?? null);
              setResetRunState(event.ok ? "success" : "error");

              if (event.snapshot) {
                setSnapshot(event.snapshot);
              }

              if (event.ok) {
                clearMissionControlBrowserState();
                toast.success(
                  resetDialogTarget === "full-uninstall"
                    ? "Full uninstall started."
                    : "AgentOS reset completed.",
                  {
                    description: event.message
                  }
                );
              } else {
                toast.error(
                  resetDialogTarget === "full-uninstall"
                    ? "Full uninstall failed."
                    : "AgentOS reset failed.",
                  {
                    description: event.message
                  }
                );
              }
            }
          }

          newlineIndex = buffer.indexOf("\n");
        }
      }

      const trailing = buffer.trim();

      if (trailing) {
        const event = JSON.parse(trailing) as ResetStreamEvent;

        if (event.type === "done") {
          sawDone = true;
          setResetStatusMessage(null);
          setResetResultMessage(event.message);
          setResetBackgroundLogPath(event.backgroundLogPath ?? null);
          setResetRunState(event.ok ? "success" : "error");

          if (event.snapshot) {
            setSnapshot(event.snapshot);
          }

          if (event.ok) {
            clearMissionControlBrowserState();
          }
        }
      }

      if (!sawDone) {
        throw new Error("Reset stream ended unexpectedly.");
      }
    } catch (error) {
      setResetRunState("error");
      setResetStatusMessage(null);
      setResetResultMessage(error instanceof Error ? error.message : "Reset failed.");
      toast.error(
        resetDialogTarget === "full-uninstall"
          ? "Full uninstall failed."
          : "AgentOS reset failed.",
        {
          description: error instanceof Error ? error.message : "Unknown reset error."
        }
      );
    }
  };

  const handleResetDialogOpenChange = (open: boolean) => {
    if (open) {
      return;
    }

    if (resetRunState === "running") {
      return;
    }

    setResetDialogTarget(null);
    resetResetDialogState();
  };

  return (
    <div
      className={cn(
        "mission-shell relative min-h-screen overflow-hidden",
        surfaceTheme === "light" && "mission-shell--light"
      )}
    >
      <div className="mission-canvas-backdrop absolute inset-0 z-0">
        <div aria-hidden="true" className="mission-canvas-pattern absolute inset-0 z-0" />
        <div className="absolute inset-0 z-10">
          <MissionCanvasView
            snapshot={uiSnapshot}
            activeWorkspaceId={activeWorkspaceId}
            selectedNodeId={selectedNodeId}
            focusedAgentId={focusedAgentId}
            composerTargetAgentId={composerTargetAgentId}
            activeChatAgentId={activeChatAgentId}
            isComposerActive={isComposerActive}
            composerViewportResetNonce={composerViewportResetNonce}
            recentDispatchId={recentDispatchId}
            hiddenRuntimeIds={hiddenRuntimeIds}
            hiddenTaskKeys={hiddenTaskKeys}
            lockedTaskKeys={lockedTaskKeys}
            onToggleWorkspaceTaskCards={toggleWorkspaceTaskCards}
            className="rounded-none"
            onEditAgent={(agentId) => {
              selectNode(agentId);
              setAgentActionRequest({
                requestId: `edit:${agentId}:${Date.now()}`,
                kind: "edit",
                agentId
              });
            }}
            onDeleteAgent={(agentId) => {
              selectNode(agentId);
              setAgentActionRequest({
                requestId: `delete:${agentId}:${Date.now()}`,
                kind: "delete",
                agentId
              });
            }}
            onFocusAgent={handleFocusAgent}
            onConfigureAgentModel={handleConfigureAgentModel}
            onConfigureAgentCapabilities={handleConfigureAgentCapabilities}
            onInspectAgentDetail={handleInspectAgentDetail}
            onOpenWorkspaceChannels={openWorkspaceChannels}
            onMessageAgent={(agentId) => {
              const agent = uiSnapshot.agents.find((entry) => entry.id === agentId);

              if (!agent) {
                return;
              }

              setAgentActionRequest(null);
              setActiveWorkspaceId(agent.workspaceId);
              selectNode(agentId, "chat");
              setIsInspectorOpen(true);
            }}
            onReplyTask={(task) => {
              const prompt = resolveTaskPrompt(task);
              setComposeIntent({
                id: `reply:${task.id}:${Date.now()}`,
                mission: prompt,
                agentId: task.primaryAgentId,
                sourceKind: "reply",
                sourceLabel: task.title.trim() || task.subtitle.trim() || task.id
              });
            }}
            onCopyTaskPrompt={async (task) => {
              const prompt = resolveTaskPrompt(task);
              setComposeIntent({
                id: `copy:${task.id}:${Date.now()}`,
                mission: prompt,
                agentId: task.primaryAgentId,
                sourceKind: "copy",
                sourceLabel: task.title.trim() || task.subtitle.trim() || task.id
              });

              try {
                await navigator.clipboard.writeText(prompt);
                toast.success("Prompt copied to clipboard.", {
                  description: "The mission input was also populated."
                });
              } catch {
                toast.message("Prompt moved into mission input.", {
                  description: "Clipboard access was not available."
                });
              }
            }}
            onHideTask={(task) => {
              if (safeLockedTaskKeys.includes(task.key)) {
                return;
              }

              setHiddenTaskKeys((current) => {
                if (current.includes(task.key)) {
                  return current;
                }

                return [...current, task.key];
              });
              setHiddenRuntimeIds((current) => {
                const next = new Set(current);
                task.runtimeIds.forEach((runtimeId) => next.add(runtimeId));
                return Array.from(next);
              });
            }}
            onToggleTaskLock={(task) => {
              setLockedTaskKeys((current) => {
                const safeCurrent = Array.isArray(current) ? current : [];

                if (safeCurrent.includes(task.key)) {
                  return safeCurrent.filter((key) => key !== task.key);
                }

                return [...safeCurrent, task.key];
              });
            }}
            onAbortTask={(task) => {
              if (!isTaskAbortable(task)) {
                return;
              }

              setTaskAbortRequest(task);
              setTaskAbortRunState("idle");
              setTaskAbortMessage(null);
            }}
            onInspectTask={(task, target) => {
              selectNode(task.id, target);
              setIsInspectorOpen(true);
            }}
            onSelectNode={(nodeId) => {
              selectNode(nodeId);
            }}
            onCanvasNodePointerDownCapture={handleCanvasNodePointerDownCapture}
          />
        </div>
      </div>

      <div
        className={cn(
          "pointer-events-none absolute top-0 z-40 hidden lg:block",
          isSidebarOpen ? "lg:left-[384px]" : "lg:left-[84px]",
          isInspectorOpen ? "lg:right-[426px]" : "lg:right-[84px]"
        )}
      >
        <MissionControlCanvasTopBar
          snapshot={snapshot}
          surfaceTheme={surfaceTheme}
          settingsRef={settingsRef}
          isSettingsOpen={isSettingsOpen}
          gatewayDraft={gatewayDraft}
          workspaceRootDraft={workspaceRootDraft}
          isSavingGateway={isSavingGateway}
          isSavingWorkspaceRoot={isSavingWorkspaceRoot}
          isCheckingForUpdates={isCheckingForUpdates}
          selectedModelId={selectedOnboardingModelId}
          modelOnboardingRunState={modelOnboardingRunState}
          gatewayControlAction={gatewayControlAction}
          lastCheckedAt={lastCheckedAt}
          onToggleTheme={() =>
            setSurfaceTheme((current) => (current === "light" ? "dark" : "light"))
          }
          onToggleSettings={() => setIsSettingsOpen((current) => !current)}
          onGatewayDraftChange={setGatewayDraft}
          onWorkspaceRootDraftChange={setWorkspaceRootDraft}
          onSelectedModelIdChange={setSelectedOnboardingModelId}
          onSaveGatewaySettings={saveGatewaySettings}
          onSaveWorkspaceRootSettings={saveWorkspaceRootSettings}
          onCheckForUpdates={checkForUpdates}
          onControlGateway={controlGateway}
          onOpenSetupWizard={openSetupWizard}
          onRunModelRefresh={runModelRefresh}
          onRunModelSetDefault={runModelSetDefault}
          onOpenAddModels={openAddModelsDialog}
          onOpenUpdateDialog={() => {
            resetUpdateDialogState();
            setIsUpdateDialogOpen(true);
          }}
          onOpenResetDialog={(target) => {
            void openResetDialog(target);
          }}
        />
      </div>

      <div className="relative z-20 min-h-screen pointer-events-none lg:h-screen">
        <div className="pointer-events-none absolute left-1/2 top-4 z-30 -translate-x-1/2 lg:hidden">
          <MissionControlCanvasTitlePill surfaceTheme={surfaceTheme} />
        </div>

        <div className="pointer-events-none absolute left-[84px] top-6 z-10 hidden lg:block">
          <MissionControlCanvasTitlePill surfaceTheme={surfaceTheme} />
        </div>

        <div
          className={cn(
            "pointer-events-auto absolute left-0 top-0 z-30 h-[100dvh] overflow-visible mission-ease-smooth transition-[width] duration-500",
            isSidebarOpen
              ? "w-[calc(100vw-96px)] max-w-[280px] lg:w-[360px] lg:max-w-none"
              : "w-[60px]"
          )}
        >
        <MissionSidebar
          snapshot={uiSnapshot}
          surfaceTheme={surfaceTheme}
          activeWorkspaceId={activeWorkspaceId}
          requestedAgentAction={agentActionRequest}
          connectionState={connectionState}
          collapsed={!isSidebarOpen}
          modelManager={{
              runState: modelOnboardingRunState,
              statusMessage: modelOnboardingStatusMessage,
              resultMessage: modelOnboardingResultMessage,
              log: modelOnboardingLog,
              manualCommand: modelOnboardingManualCommand,
              docsUrl: modelOnboardingDocsUrl,
              discoveredModels,
              systemReady: isOpenClawSystemReady
            }}
            onToggleCollapsed={() => setIsSidebarOpen((current) => !current)}
            onSelectWorkspace={(workspaceId) => {
              setFocusedAgentId(null);
              setActiveWorkspaceId(workspaceId);
              selectNode(workspaceId);
            }}
            onRefresh={refresh}
            onRunModelRefresh={runModelRefresh}
            onRunModelDiscover={runModelDiscover}
            onRunModelSetDefault={runModelSetDefault}
            onConnectModelProvider={runModelProviderLogin}
            onOpenModelSetup={() => openSetupWizard(isOpenClawSystemReady ? "models" : "system")}
            onOpenAddModels={openAddModelsDialog}
            onEditWorkspace={openWorkspaceWizardForEdit}
            onSnapshotChange={setSnapshot}
          />
        </div>

        <div
          className={cn(
            "pointer-events-auto absolute right-0 top-0 z-30 h-[100dvh] overflow-visible mission-ease-smooth transition-[width] duration-500",
            isInspectorOpen
              ? "w-[calc(100vw-112px)] max-w-[300px] lg:w-[394px] lg:max-w-none"
              : "w-[60px]"
          )}
        >
          <InspectorPanel
            snapshot={uiSnapshot}
            surfaceTheme={surfaceTheme}
            selectedNodeId={selectedNodeId}
            agentDetailFocus={selectedAgentDetailFocus}
            lastMission={lastMission}
            onRefresh={refresh}
            onSnapshotChange={setSnapshot}
            onConfigureAgentCapabilities={handleConfigureAgentCapabilities}
            collapsed={!isInspectorOpen}
            onToggleCollapsed={() => setIsInspectorOpen((current) => !current)}
            activeTab={activeInspectorTab}
            onActiveTabChange={setActiveInspectorTab}
            onAbortTask={(task) => {
              if (!isTaskAbortable(task)) {
                return;
              }

              setTaskAbortRequest(task);
              setTaskAbortRunState("idle");
              setTaskAbortMessage(null);
            }}
          />
        </div>

        <AgentCapabilityEditorDialog
          open={Boolean(capabilityEditorRequest)}
          agentId={capabilityEditorRequest?.agentId ?? null}
          initialFocus={capabilityEditorRequest?.focus ?? "skills"}
          snapshot={uiSnapshot}
          onOpenChange={handleCapabilityEditorOpenChange}
          onSnapshotChange={(updater) => setSnapshot(updater)}
          onRefresh={refresh}
        />

        <AgentModelPickerDialog
          open={Boolean(agentModelRequest)}
          agentId={agentModelRequest?.agentId ?? null}
          snapshot={uiSnapshot}
          onOpenChange={handleAgentModelPickerOpenChange}
          onSnapshotChange={(updater) => setSnapshot(updater)}
          onRefresh={refresh}
          onOpenAddModels={openAddModelsFromModelPicker}
        />

        <div className="pointer-events-auto absolute bottom-[calc(env(safe-area-inset-bottom)+12px)] left-4 right-4 z-40 lg:bottom-6 lg:left-1/2 lg:right-auto lg:w-[min(800px,calc(100vw-320px))] lg:-translate-x-1/2">
          <div className="mx-auto mb-1 flex w-fit flex-col items-start gap-1">
            {hiddenScopedTaskCount > 0 ? (
              <div className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-[linear-gradient(180deg,rgba(10,16,26,0.96),rgba(6,10,18,0.94))] px-3 py-1 text-[8px] text-slate-200 shadow-[0_10px_24px_rgba(0,0,0,0.14)]">
                <EyeOff className="h-3 w-3 text-slate-400" />
                <span className="leading-3 text-slate-300">{hiddenScopedTaskCount} hidden</span>
              </div>
            ) : null}
            {focusedAgentId ? (
              <button
                type="button"
                onClick={handleResetFocus}
                className="inline-flex items-center gap-1.5 rounded-full border border-cyan-300/18 bg-[linear-gradient(180deg,rgba(16,25,38,0.98),rgba(8,12,20,0.96))] px-3 py-1 text-[8px] text-cyan-100 shadow-[0_10px_24px_rgba(0,0,0,0.14)] transition-colors hover:border-cyan-200/30 hover:bg-[linear-gradient(180deg,rgba(20,33,49,0.98),rgba(10,15,25,0.96))]"
                aria-label="Reset focus and show the full workspace"
                title="Reset Focus"
              >
                <RefreshCw className="h-3 w-3 text-cyan-300" />
                <span className="leading-3 text-cyan-50">Reset Focus</span>
              </button>
            ) : null}
          </div>
          <CommandBar
            snapshot={uiSnapshot}
            activeWorkspaceId={activeWorkspaceId}
            selectedNodeId={selectedNodeId}
            composeIntent={composeIntent}
            isComposerActive={isComposerActive}
            onTargetAgentChange={setComposerTargetAgentId}
            onTargetAgentSelect={handleComposerTargetAgentSelect}
            onComposerActiveChange={handleComposerActiveChange}
            onRefresh={refresh}
            onOpenWorkspaceCreate={() => {
              openWorkspaceWizard("basic");
            }}
            onOpenWorkspaceChannels={openWorkspaceChannels}
            onMissionDispatchStart={(event) => {
              missionDispatchAbortControllersRef.current.set(event.requestId, event.abortController);

              const optimisticTask = createOptimisticMissionTaskRecord(event, snapshot);

              setOptimisticMissionTasks((current) => [
                optimisticTask,
                ...current.filter((entry) => entry.requestId !== event.requestId)
              ]);

              if (event.workspaceId) {
                setActiveWorkspaceId(event.workspaceId);
              }

              selectNode(optimisticTask.task.id);
              setIsInspectorOpen(true);
            }}
            onMissionDispatchFailure={(requestId, message) => {
              missionDispatchAbortControllersRef.current.delete(requestId);

              setOptimisticMissionTasks((current) =>
                current.map((entry) =>
                  entry.requestId === requestId
                    ? {
                        ...entry,
                        task: updateOptimisticMissionTask(entry.task, {
                          status: "stalled",
                          subtitle: message,
                          bootstrapStage: "stalled",
                          feedEvent: {
                            id: `${entry.task.id}:failed:${Date.now()}`,
                            kind: "warning",
                            timestamp: new Date().toISOString(),
                            title: "Dispatch failed",
                            detail: message,
                            isError: true
                          }
                        })
                      }
                    : entry
                )
              );
            }}
            onMissionResponse={(result, context) => {
              missionDispatchAbortControllersRef.current.delete(context.requestId);
              setLastMission(result);

              setOptimisticMissionTasks((current) =>
                current.map((entry) =>
                  entry.requestId === context.requestId
                    ? {
                        ...entry,
                        dispatchId: result.dispatchId ?? entry.dispatchId,
                        task: updateOptimisticMissionTask(entry.task, {
                          dispatchId: result.dispatchId,
                          status:
                            result.status === "stalled"
                              ? "stalled"
                              : result.status === "cancelled"
                                ? "cancelled"
                                : "queued",
                          subtitle: result.summary,
                          bootstrapStage:
                            result.status === "stalled"
                              ? "stalled"
                              : result.status === "cancelled"
                                ? "cancelled"
                                : "accepted",
                          feedEvent: {
                            id: `${entry.task.id}:response:${Date.now()}`,
                            kind: result.status === "stalled" || result.status === "cancelled" ? "warning" : "status",
                            timestamp: new Date().toISOString(),
                            title:
                              result.status === "stalled"
                                ? "Dispatch blocked"
                                : result.status === "cancelled"
                                  ? "Dispatch cancelled"
                                : "Mission accepted",
                            detail: result.summary || "Mission accepted and queued for OpenClaw execution.",
                            isError: result.status === "stalled" || result.status === "cancelled"
                          }
                        })
                      }
                    : entry
                )
              );

              if (result.dispatchId) {
                setRecentDispatchId(result.dispatchId);
              }
            }}
          />
        </div>

        <WorkspaceChannelsDialog
          snapshot={uiSnapshot}
          workspaceId={activeWorkspaceId ?? uiSnapshot.workspaces[0]?.id ?? null}
          open={isWorkspaceChannelsOpen}
          onOpenChange={setIsWorkspaceChannelsOpen}
          onRefresh={refresh}
          onSnapshotChange={setSnapshot}
        />

        {shouldShowOnboarding ? (
          <OpenClawOnboarding
            snapshot={snapshot}
            surfaceTheme={surfaceTheme}
            stage={onboardingStage}
            systemActionLabel={onboardingAction.label}
            systemActionDescription={onboardingAction.description}
            systemPhase={onboardingPhase}
            modelPhase={modelOnboardingPhase}
            systemRun={{
              runState: onboardingRunState,
              statusMessage: onboardingStatusMessage,
              resultMessage: onboardingResultMessage,
              log: onboardingLog,
              manualCommand: onboardingManualCommand,
              docsUrl: onboardingDocsUrl
            }}
            modelRun={{
              runState: modelOnboardingRunState,
              statusMessage: modelOnboardingStatusMessage,
              resultMessage: modelOnboardingResultMessage,
              log: modelOnboardingLog,
              manualCommand: modelOnboardingManualCommand,
              docsUrl: modelOnboardingDocsUrl
            }}
            selectedModelId={selectedOnboardingModelId}
            discoveredModels={discoveredModels}
            onSelectedModelIdChange={setSelectedOnboardingModelId}
            onRunSystemSetup={runOpenClawOnboarding}
            onRunModelAutoSetup={runModelAutoOnboarding}
            onRunModelDiscover={runModelDiscover}
            onRunModelRefresh={runModelRefresh}
            onRunModelSetDefault={runModelSetDefault}
            onOpenAddModels={openAddModelsDialog}
            onContinueToModels={() => setOnboardingStage("models")}
            onBackToSystem={() => setOnboardingStage("system")}
            onOpenWorkspaceCreate={() => {
              dismissOnboarding();
              openWorkspaceWizard("basic");
            }}
            onDismiss={dismissOnboarding}
            canDismiss={
              !showOnboardingReadyState &&
              onboardingRunState !== "running" &&
              modelOnboardingRunState !== "running"
            }
          />
        ) : null}

        <WorkspaceWizardDialog
          key={workspaceWizardEditId ? `workspace-edit:${workspaceWizardEditId}` : "workspace-create"}
          open={isWorkspaceWizardOpen}
          onOpenChange={handleWorkspaceWizardOpenChange}
          initialMode={workspaceWizardInitialMode}
          workspaceEditId={workspaceWizardEditId}
          surfaceTheme={surfaceTheme}
          snapshot={snapshot}
          onRefresh={refresh}
          onWorkspaceCreated={(workspaceId) => {
            setPendingWorkspaceOpenId(workspaceId);
            setActiveWorkspaceId(workspaceId);
            selectNode(workspaceId);
          }}
          onWorkspaceUpdated={(workspaceId) => {
            setPendingWorkspaceOpenId(workspaceId);
            setActiveWorkspaceId(workspaceId);
            selectNode(workspaceId);
          }}
        />

        <AddModelsDialog
          open={isAddModelsDialogOpen}
          onOpenChange={setIsAddModelsDialogOpen}
          snapshot={snapshot}
          initialProvider={initialAddModelsProvider}
          onSnapshotChange={setSnapshot}
        />

        <ResetDialog
          open={resetDialogTarget !== null}
          target={resetDialogTarget}
          surfaceTheme={surfaceTheme}
          previewState={resetPreviewState}
          preview={resetPreview}
          previewError={resetPreviewError}
          runState={resetRunState}
          statusMessage={resetStatusMessage}
          resultMessage={resetResultMessage}
          backgroundLogPath={resetBackgroundLogPath}
          log={resetLog}
          confirmText={resetConfirmText}
          onConfirmTextChange={setResetConfirmText}
          onRefreshPreview={() => {
            if (!resetDialogTarget) {
              return;
            }

            void loadResetPreview(resetDialogTarget);
          }}
          onExecute={() => {
            void runReset();
          }}
          onOpenChange={handleResetDialogOpenChange}
        />

        <Dialog
          open={taskAbortRequest !== null}
          onOpenChange={(open) => {
            if (taskAbortRunState === "running") {
              return;
            }

            if (!open) {
              setTaskAbortRequest(null);
              setTaskAbortRunState("idle");
              setTaskAbortMessage(null);
            }
          }}
        >
          <DialogContent
            className={cn(
              "max-w-[480px] gap-5 p-5 sm:p-6",
              surfaceTheme === "light"
                ? "border-[#d7c5b7] bg-[rgba(252,247,241,0.98)] text-[#4a382c] shadow-[0_30px_80px_rgba(161,125,101,0.2)]"
                : "border-white/10 bg-slate-950/94 text-slate-100"
            )}
          >
            <DialogHeader>
              <DialogTitle className={surfaceTheme === "light" ? "text-[#3f2f24]" : "text-white"}>
                Abort task?
              </DialogTitle>
              <DialogDescription className={surfaceTheme === "light" ? "text-[#7e6555]" : "text-slate-400"}>
                This stops the current OpenClaw dispatch for the selected task. It does not delete captured evidence or files.
              </DialogDescription>
            </DialogHeader>

            {taskAbortRequest ? (
              <div
                className={cn(
                  "rounded-[20px] border px-4 py-4",
                  surfaceTheme === "light"
                    ? "border-[#e3d4c8] bg-[#fffaf6] text-[#4f3d31]"
                    : "border-rose-400/20 bg-rose-400/10 text-rose-50"
                )}
              >
                <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Selected task</p>
                <p className="mt-2 font-display text-[1.02rem] leading-6 text-inherit">
                  {taskAbortRequest.title}
                </p>
                <p className={cn("mt-1 text-sm leading-6", surfaceTheme === "light" ? "text-[#8b7262]" : "text-rose-100/80")}>
                  {taskAbortRequest.subtitle}
                </p>
                {taskAbortMessage ? (
                  <p className="mt-3 rounded-[16px] border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-sm text-rose-50">
                    {taskAbortMessage}
                  </p>
                ) : null}
              </div>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                disabled={taskAbortRunState === "running"}
                className={surfaceTheme === "light" ? "border-[#d9c9bc] bg-[#f5ebe3] text-[#6c5647] hover:bg-[#eddccf]" : ""}
                onClick={() => {
                  if (taskAbortRunState === "running") {
                    return;
                  }

                  setTaskAbortRequest(null);
                  setTaskAbortRunState("idle");
                  setTaskAbortMessage(null);
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={!taskAbortRequest || taskAbortRunState === "running"}
                onClick={() => {
                  void confirmTaskAbort();
                }}
              >
                {taskAbortRunState === "running" ? (
                  <>
                    <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                    Aborting...
                  </>
                ) : (
                  "Abort task"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div
          className={cn(
            "pointer-events-auto absolute bottom-3 right-[74px] z-30 text-[11px] tracking-[0.04em] lg:bottom-4",
            isInspectorOpen ? "lg:right-[426px]" : "lg:right-[86px]",
            surfaceTheme === "light" ? "text-[#8f7664]" : "text-slate-500"
          )}
        >
          Built on{" "}
          <a
            href="https://openclaw.ai/"
            target="_blank"
            rel="noreferrer"
            className={cn(
              "transition-colors",
              surfaceTheme === "light" ? "text-[#6f5a4b] hover:text-[#4f3d31]" : "text-slate-300 hover:text-slate-100"
            )}
          >
            OpenClaw
          </a>{" "}
          by{" "}
          <a
            href="https://sapienx.app/"
            target="_blank"
            rel="noreferrer"
            className={cn(
              "transition-colors",
              surfaceTheme === "light" ? "text-[#6f5a4b] hover:text-[#4f3d31]" : "text-slate-300 hover:text-slate-100"
            )}
          >
            SapienX
          </a>
        </div>

        <Dialog
          open={isUpdateDialogOpen}
          onOpenChange={(open) => {
            if (updateRunState === "running") {
              return;
            }

            setIsUpdateDialogOpen(open);

            if (!open) {
              resetUpdateDialogState();
            }
          }}
        >
          <DialogContent
            className={cn(
              "max-w-[468px] gap-5 p-5 sm:p-6",
              surfaceTheme === "light"
                ? "border-[#d7c5b7] bg-[rgba(252,247,241,0.98)] text-[#4a382c] shadow-[0_30px_80px_rgba(161,125,101,0.2)]"
                : "border-white/10 bg-slate-950/94 text-slate-100"
            )}
          >
            <DialogHeader>
              <DialogTitle className={surfaceTheme === "light" ? "text-[#3f2f24]" : "text-white"}>
                {updateDialogTitle}
              </DialogTitle>
              <DialogDescription className={surfaceTheme === "light" ? "text-[#7e6555]" : "text-slate-400"}>
                {updateDialogDescription}
              </DialogDescription>
            </DialogHeader>

            {isUpdateFinished ? (
              <div
                className={cn(
                  "space-y-4",
                  surfaceTheme === "light" ? "text-[#4f3d31]" : "text-slate-200"
                )}
              >
                <div
                  className={cn(
                    "rounded-[24px] border px-4 py-5",
                    resolveUpdateResultPanelClassName(updateRunState, surfaceTheme)
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border",
                        resolveUpdateResultIconWrapClassName(updateRunState, surfaceTheme)
                      )}
                    >
                      {updateRunState === "success" ? (
                        <CheckCircle2 className="h-5 w-5" />
                      ) : (
                        <AlertTriangle className="h-5 w-5" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-display text-[1.05rem] leading-6">
                        {updateRunState === "success" ? "OpenClaw is up to date" : "Update needs attention"}
                      </p>
                      <p className="mt-1 text-sm leading-6">
                        {updateResultMessage ||
                          (updateRunState === "success"
                            ? "The update finished successfully."
                            : "The update did not finish cleanly.")}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div
                      className={cn(
                        "rounded-[18px] border px-3 py-3",
                        surfaceTheme === "light" ? "border-white/70 bg-white/70" : "border-white/10 bg-slate-950/30"
                      )}
                    >
                      <p className={surfaceTheme === "light" ? "text-[10px] uppercase tracking-[0.22em] text-[#8d725f]" : "text-[10px] uppercase tracking-[0.22em] text-slate-500"}>
                        Installed version
                      </p>
                      <p className="mt-2 font-display text-lg text-inherit">
                        v{snapshot.diagnostics.version || snapshot.diagnostics.latestVersion || "unknown"}
                      </p>
                    </div>
                    <div
                      className={cn(
                        "rounded-[18px] border px-3 py-3",
                        surfaceTheme === "light" ? "border-white/70 bg-white/70" : "border-white/10 bg-slate-950/30"
                      )}
                    >
                      <p className={surfaceTheme === "light" ? "text-[10px] uppercase tracking-[0.22em] text-[#8d725f]" : "text-[10px] uppercase tracking-[0.22em] text-slate-500"}>
                        Install mode
                      </p>
                      <p className="mt-2 text-sm font-medium text-inherit">{updateInstallDescriptor || "unknown"}</p>
                    </div>
                  </div>
                </div>

                <div
                  className={cn(
                    "rounded-[20px] border",
                    surfaceTheme === "light"
                      ? "border-[#e3d4c8] bg-[#fffaf6]"
                      : "border-white/8 bg-white/[0.03]"
                  )}
                >
                  <div
                    className={cn(
                      "flex items-center justify-between border-b px-4 py-3",
                      surfaceTheme === "light" ? "border-[#eadccf]" : "border-white/8"
                    )}
                  >
                    <p
                      className={cn(
                        "text-[10px] uppercase tracking-[0.24em]",
                        surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-500"
                      )}
                    >
                      Update log
                    </p>
                    <span className={surfaceTheme === "light" ? "text-xs text-[#8b7262]" : "text-xs text-slate-400"}>
                      {updateRunState === "success" ? "Completed" : "Failed"}
                    </span>
                  </div>
                  <pre
                    className={cn(
                      "max-h-[180px] overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-[11px] leading-5",
                      surfaceTheme === "light" ? "text-[#4f3d31]" : "text-slate-200"
                    )}
                  >
                    {updateLog || "No command output was captured."}
                  </pre>
                </div>
              </div>
            ) : (
              <>
                <div
                  className={cn(
                    "grid gap-3 sm:grid-cols-2",
                    surfaceTheme === "light" ? "text-[#4f3d31]" : "text-slate-200"
                  )}
                >
                  <div
                    className={cn(
                      "rounded-[20px] border px-4 py-4",
                      surfaceTheme === "light"
                        ? "border-[#e3d4c8] bg-[#fffaf6]"
                        : "border-white/8 bg-white/[0.03]"
                    )}
                  >
                    <p
                      className={cn(
                        "text-[10px] uppercase tracking-[0.24em]",
                        surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-500"
                      )}
                    >
                      Version target
                    </p>
                    <p className="mt-2 font-display text-[1.1rem] leading-6 text-inherit">
                      v{snapshot.diagnostics.latestVersion || snapshot.diagnostics.version || "unknown"}
                    </p>
                    <p className={surfaceTheme === "light" ? "mt-1 text-xs text-[#8b7262]" : "mt-1 text-xs text-slate-400"}>
                      Current: v{snapshot.diagnostics.version || "unknown"}
                    </p>
                  </div>

                  <div
                    className={cn(
                      "rounded-[20px] border px-4 py-4",
                      surfaceTheme === "light"
                        ? "border-[#e3d4c8] bg-[#fffaf6]"
                        : "border-white/8 bg-white/[0.03]"
                    )}
                  >
                    <p
                      className={cn(
                        "text-[10px] uppercase tracking-[0.24em]",
                        surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-500"
                      )}
                    >
                      Install mode
                    </p>
                    <p className="mt-2 text-sm font-medium leading-6 text-inherit">{updateInstallDescriptor || "unknown"}</p>
                    <p className={surfaceTheme === "light" ? "mt-1 text-xs text-[#8b7262]" : "mt-1 text-xs text-slate-400"}>
                      {compactPath(snapshot.diagnostics.updateRoot || "") || "Install root unavailable"}
                    </p>
                  </div>
                </div>

                <div
                  className={cn(
                    "rounded-[20px] border px-4 py-3 text-sm",
                    activeRuntimeCount > 0
                      ? surfaceTheme === "light"
                        ? "border-rose-300/80 bg-rose-50 text-rose-800"
                        : "border-rose-300/25 bg-rose-300/10 text-rose-100"
                      : surfaceTheme === "light"
                        ? "border-[#e3d4c8] bg-[#fffaf6] text-[#745e4f]"
                        : "border-white/8 bg-white/[0.03] text-slate-300"
                  )}
                >
                  {activeRuntimeCount > 0
                    ? `${activeRuntimeCount} running or queued runtime${activeRuntimeCount === 1 ? "" : "s"} may be interrupted during the update.`
                    : "No running runtimes are currently tracked, so the update risk is lower."}
                </div>

                {isUpdateRunning ? (
                  <div
                    className={cn(
                      "rounded-[20px] border",
                      surfaceTheme === "light"
                        ? "border-[#e3d4c8] bg-[#fffaf6]"
                        : "border-white/8 bg-white/[0.03]"
                    )}
                  >
                    <div
                      className={cn(
                        "flex items-center gap-3 border-b px-4 py-3",
                        surfaceTheme === "light" ? "border-[#eadccf]" : "border-white/8"
                      )}
                    >
                      <div
                        className={cn(
                          "flex h-9 w-9 items-center justify-center rounded-2xl border",
                          surfaceTheme === "light"
                            ? "border-[#dcc6b6] bg-[#f4e8dd] text-[#7b6453]"
                            : "border-white/10 bg-white/[0.05] text-slate-200"
                        )}
                      >
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={surfaceTheme === "light" ? "text-sm font-medium text-[#4a382c]" : "text-sm font-medium text-white"}>
                          Update in progress
                        </p>
                        <p className={surfaceTheme === "light" ? "text-xs text-[#8b7262]" : "text-xs text-slate-400"}>
                          {updateStatusMessage || "Streaming OpenClaw output..."}
                        </p>
                      </div>
                    </div>
                    <pre
                      className={cn(
                        "max-h-[180px] min-h-[120px] overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-[11px] leading-5",
                        surfaceTheme === "light" ? "text-[#4f3d31]" : "text-slate-200"
                      )}
                    >
                      {updateLog || "Waiting for command output..."}
                    </pre>
                  </div>
                ) : null}
              </>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setIsUpdateDialogOpen(false);
                  resetUpdateDialogState();
                }}
                disabled={isUpdateRunning}
                className={surfaceTheme === "light" ? "border-[#d9c9bc] bg-[#f5ebe3] text-[#6c5647] hover:bg-[#eddccf]" : ""}
              >
                {isUpdateFinished ? "Done" : "Cancel"}
              </Button>
              {isUpdateFinished ? null : (
                <Button
                  type="button"
                  onClick={runOpenClawUpdate}
                  disabled={isUpdateRunning}
                  className={cn(
                    snapshot.diagnostics.updateAvailable
                      ? "bg-amber-400 text-slate-950 shadow-lg shadow-amber-400/20 hover:bg-amber-300"
                      : "",
                    surfaceTheme === "light" && !snapshot.diagnostics.updateAvailable
                      ? "bg-[#c8946f] text-white shadow-[0_12px_28px_rgba(200,148,111,0.24)] hover:bg-[#b88461]"
                      : ""
                  )}
                >
                  {isUpdateRunning ? (
                    <>
                      <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    "Update now"
                  )}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

function resolveTaskPrompt(task: TaskRecord) {
  if (task.mission?.trim()) {
    return task.mission.trim();
  }

  if (task.title.trim()) {
    return task.title.trim();
  }

  return task.subtitle.trim() || "Continue this task.";
}

function resolveTaskDispatchStatus(task: TaskRecord) {
  return typeof task.metadata.dispatchStatus === "string" ? task.metadata.dispatchStatus : null;
}

function isTaskAborted(task: TaskRecord) {
  const dispatchStatus = resolveTaskDispatchStatus(task);
  const runtimeStatus = task.status as string;
  return dispatchStatus === "cancelled" || dispatchStatus === "aborted" || runtimeStatus === "cancelled" || runtimeStatus === "aborted";
}

function isTaskAbortable(task: TaskRecord) {
  if (isTaskAborted(task)) {
    return false;
  }

  const runtimeStatus = task.status as string;
  return runtimeStatus === "running" || runtimeStatus === "queued";
}

function mergeSnapshotWithOptimisticTasks(
  snapshot: MissionControlSnapshot,
  optimisticMissionTasks: OptimisticMissionTask[]
) {
  if (optimisticMissionTasks.length === 0) {
    return snapshot;
  }

  const visibleOptimisticTasks = optimisticMissionTasks
    .filter((entry) => !findReplacementTaskForOptimisticTask(snapshot.tasks, entry))
    .map((entry) => entry.task);

  if (visibleOptimisticTasks.length === 0) {
    return snapshot;
  }

  return {
    ...snapshot,
    tasks: [...visibleOptimisticTasks, ...snapshot.tasks]
  };
}

function findReplacementTaskForOptimisticTask(
  tasks: TaskRecord[],
  optimisticTask: OptimisticMissionTask
) {
  return tasks.find((task) => matchesOptimisticTaskReplacement(task, optimisticTask)) ?? null;
}

function matchesOptimisticTaskReplacement(task: TaskRecord, optimisticTask: OptimisticMissionTask) {
  const dispatchId = optimisticTask.dispatchId?.trim();

  if (!dispatchId) {
    return false;
  }

  return task.dispatchId === dispatchId || task.key === `dispatch:${dispatchId}`;
}

function createOptimisticMissionTaskRecord(
  event: MissionDispatchStart,
  snapshot: MissionControlSnapshot
): OptimisticMissionTask {
  const submittedAtIso = new Date(event.submittedAt).toISOString();
  const agent = snapshot.agents.find((entry) => entry.id === event.agentId);
  const feedEvent: TaskFeedEvent = {
    id: `optimistic:${event.requestId}:submitted`,
    kind: "user",
    timestamp: submittedAtIso,
    title: "Mission submitted",
    detail: summarizeTaskTitle(event.mission, 220),
    agentId: event.agentId
  };

  return {
    requestId: event.requestId,
    dispatchId: null,
    task: {
      id: `optimistic-task:${event.requestId}`,
      key: `optimistic:${event.requestId}`,
      title: summarizeTaskTitle(event.mission, 86),
      mission: event.mission,
      subtitle: "Sending mission to AgentOS. Waiting for a dispatch id.",
      status: "queued",
      updatedAt: event.submittedAt,
      ageMs: 0,
      workspaceId: event.workspaceId ?? undefined,
      primaryAgentId: event.agentId,
      primaryAgentName: formatAgentDisplayName(agent ?? { name: "OpenClaw" }),
      runtimeIds: [],
      agentIds: [event.agentId],
      sessionIds: [],
      runIds: [],
      runtimeCount: 0,
      updateCount: 0,
      liveRunCount: 0,
      artifactCount: 0,
      warningCount: 0,
      metadata: {
        optimistic: true,
        optimisticRequestId: event.requestId,
        bootstrapStage: "submitting",
        dispatchSubmittedAt: submittedAtIso,
        optimisticEvents: [feedEvent]
      }
    }
  };
}

function updateOptimisticMissionTask(
  task: TaskRecord,
  input: {
    dispatchId?: string;
    status: TaskRecord["status"];
    subtitle: string;
    bootstrapStage: string;
    feedEvent: TaskFeedEvent;
  }
): TaskRecord {
  const events = readOptimisticTaskEvents(task).concat(input.feedEvent);

  return {
    ...task,
    dispatchId: input.dispatchId ?? task.dispatchId,
    status: input.status,
    subtitle: input.subtitle,
    updatedAt: Date.now(),
    liveRunCount: input.status === "stalled" || input.status === "cancelled" ? 0 : 1,
    warningCount: input.status === "stalled" || input.status === "cancelled" ? 1 : task.warningCount,
    metadata: {
      ...task.metadata,
      bootstrapStage: input.bootstrapStage,
      optimisticEvents: dedupeOptimisticTaskEvents(events)
    }
  };
}

function readOptimisticTaskEvents(task: TaskRecord) {
  const value = task.metadata.optimisticEvents;

  if (!Array.isArray(value)) {
    return [] as TaskFeedEvent[];
  }

  return value.filter(isTaskFeedEvent);
}

function dedupeOptimisticTaskEvents(events: TaskFeedEvent[]) {
  const byId = new Map<string, TaskFeedEvent>();

  for (const event of events) {
    byId.set(event.id, event);
  }

  return [...byId.values()].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
}

function isTaskHiddenByPreferences(
  task: TaskRecord,
  hiddenRuntimeIds: string[],
  hiddenTaskKeys: string[],
  lockedTaskKeys: string[]
) {
  const safeHiddenRuntimeIds = Array.isArray(hiddenRuntimeIds) ? hiddenRuntimeIds : [];
  const safeHiddenTaskKeys = Array.isArray(hiddenTaskKeys) ? hiddenTaskKeys : [];
  const safeLockedTaskKeys = Array.isArray(lockedTaskKeys) ? lockedTaskKeys : [];

  if (safeLockedTaskKeys.includes(task.key)) {
    return false;
  }

  if (safeHiddenTaskKeys.includes(task.key)) {
    return true;
  }

  if (task.runtimeIds.length === 0) {
    return false;
  }

  return task.runtimeIds.every((runtimeId) => safeHiddenRuntimeIds.includes(runtimeId));
}

function isDirectChatRuntime(runtime: { metadata: Record<string, unknown> }) {
  return typeof runtime.metadata.kind === "string" && runtime.metadata.kind === "direct";
}

function isTaskFeedEvent(value: unknown): value is TaskFeedEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as TaskFeedEvent).id === "string" &&
    typeof (value as TaskFeedEvent).kind === "string" &&
    typeof (value as TaskFeedEvent).timestamp === "string" &&
    typeof (value as TaskFeedEvent).title === "string" &&
    typeof (value as TaskFeedEvent).detail === "string"
  );
}

function summarizeTaskTitle(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(maxLength - 1, 1)).trimEnd()}…`;
}

function formatGatewayDraft(gatewayUrl: string) {
  return gatewayUrl.replace(/\/$/, "");
}

function resolveGatewayDraft(snapshot: MissionControlSnapshot) {
  return formatGatewayDraft(snapshot.diagnostics.configuredGatewayUrl || snapshot.diagnostics.gatewayUrl);
}

function resolveWorkspaceRootDraft(snapshot: MissionControlSnapshot) {
  return compactPath(snapshot.diagnostics.configuredWorkspaceRoot || snapshot.diagnostics.workspaceRoot);
}

function resolveModelOnboardingStartPhase(intent: ModelOnboardingIntent): OpenClawModelOnboardingPhase {
  if (intent === "refresh") {
    return "refreshing";
  }

  if (intent === "discover") {
    return "discovering";
  }

  return "detecting";
}

function resolveModelOnboardingActionCopy(intent: ModelOnboardingIntent) {
  if (intent === "discover") {
    return {
      statusMessage: "Scanning models...",
      successTitle: "Models discovered.",
      errorTitle: "Model discovery failed."
    };
  }

  if (intent === "login-provider") {
    return {
      statusMessage: "Checking auth...",
      successTitle: "Provider connected.",
      errorTitle: "Provider auth needs attention."
    };
  }

  if (intent === "refresh") {
    return {
      statusMessage: "Refreshing...",
      successTitle: "Model setup refreshed.",
      errorTitle: "Model refresh failed."
    };
  }

  return {
    statusMessage: "Checking models...",
    successTitle: "Model setup ready.",
    errorTitle: "Model setup failed."
  };
}

function resolveOnboardingAction(snapshot: MissionControlSnapshot) {
  if (!snapshot.diagnostics.installed) {
    return {
      label: "Install OpenClaw",
      description: "Download the CLI and get AgentOS ready."
    };
  }

  if (resolveOpenClawSystemReady(snapshot)) {
    return {
      label: "Enter AgentOS",
      description: "OpenClaw is online and runtime state is writable."
    };
  }

  if (snapshot.diagnostics.rpcOk) {
    return {
      label: "Repair runtime access",
      description: "OpenClaw is online, but write access still needs verification."
    };
  }

  if (!snapshot.diagnostics.loaded) {
    return {
      label: "Prepare local gateway",
      description:
        "Register and start the local gateway."
    };
  }

  if (!snapshot.diagnostics.rpcOk) {
    return {
      label: "Start OpenClaw",
      description: "Start the local gateway and wait for RPC."
    };
  }

  return {
    label: "Start OpenClaw",
    description: "Start the local gateway and wait for RPC."
  };
}

