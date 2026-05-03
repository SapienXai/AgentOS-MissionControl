"use client";

import {
  EyeOff,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { AddModelsDialog } from "@/components/mission-control/add-models/add-models-dialog";
import { AgentModelPickerDialog } from "@/components/mission-control/agent-model-picker-dialog";
import { AgentCapabilityEditorDialog } from "@/components/mission-control/agent-capability-editor-dialog";
import { CommandBar } from "@/components/mission-control/command-bar";
import { InspectorPanel } from "@/components/mission-control/inspector-panel";
import { MissionControlShellDialogs } from "@/components/mission-control/mission-control-shell.dialogs";
import { OpenClawOnboarding } from "@/components/mission-control/openclaw-onboarding";
import type { ModelSwitchFeedback } from "@/components/mission-control/openclaw-onboarding.stages";
import { ResetDialog } from "@/components/mission-control/reset-dialog";
import { SettingsControlCenter } from "@/components/mission-control/settings-control-center";
import { MissionSidebar } from "@/components/mission-control/sidebar";
import { WorkspaceChannelsDialog } from "@/components/mission-control/workspace-channels-dialog";
import { WorkspaceWizardDialog } from "@/components/mission-control/workspace-wizard/workspace-wizard-dialog";
import dynamic from "next/dynamic";
import { toast } from "@/components/ui/sonner";
import { useMissionControlData } from "@/hooks/use-mission-control-data";
import type { AgentDetailFocus } from "@/components/mission-control/canvas-types";
import type { OptimisticMissionTask } from "@/components/mission-control/mission-control-shell.utils";
import {
  CanvasTitlePill as MissionControlCanvasTitlePill,
  CanvasTopBar as MissionControlCanvasTopBar
} from "@/components/mission-control/mission-control-shell.topbar";
import type { MissionControlShellSettingsPanelProps } from "@/components/mission-control/mission-control-shell.settings";
import {
  createOptimisticMissionTaskRecord,
  findReplacementTaskForOptimisticTask,
  hasAgentOSWorkspaceSetup,
  isDirectChatRuntime,
  isTaskAbortable,
  isTaskHiddenByPreferences,
  mergeSnapshotWithOptimisticTasks,
  resolveGatewayDraft,
  resolveModelOnboardingActionCopy,
  resolveModelOnboardingStartPhase,
  resolveOnboardingAction,
  resolveOpenClawInstallSummary,
  resolveTaskPrompt,
  buildWorkspaceSelectionStorageKey,
  resolveWorkspaceRootDraft,
  resolveWorkspaceSelection,
  serializeWorkspaceSelection,
  shouldShowOnboardingLaunchpad,
  shouldDeferWorkspaceSelectionHydration,
  updateOptimisticMissionTask
} from "@/components/mission-control/mission-control-shell.utils";
import { resolveInitialOnboardingModelId } from "@/components/mission-control/openclaw-onboarding.utils";
import { compactPath } from "@/lib/openclaw/presenters";
import { consumeNdjsonStream } from "@/lib/ndjson";
import {
  buildWorkspaceCreateProgressTemplate,
  createPendingOperationProgressSnapshot
} from "@/lib/openclaw/operation-progress";
import {
  isOpenClawOnboardingModelReady as resolveOpenClawModelReady,
  isOpenClawOnboardingSystemReady as resolveOpenClawSystemReady
} from "@/lib/openclaw/readiness";
import type {
  AddModelsProviderId,
  DiscoveredModelCandidate,
  MissionResponse,
    MissionControlSnapshot,
    OpenClawBinarySelection,
    OpenClawModelOnboardingPhase,
  OpenClawModelOnboardingStreamEvent,
  OpenClawOnboardingPhase,
  OpenClawOnboardingStreamEvent,
  OperationProgressSnapshot,
  ResetPreview,
  ResetStreamEvent,
  ResetTarget,
  OpenClawUpdateStreamEvent,
  WorkspaceCreateResult,
  WorkspaceCreateStreamEvent,
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
const sidebarOpenStorageKey = "mission-control-sidebar-open";
const useIsomorphicLayoutEffect = typeof globalThis.window === "undefined" ? useEffect : useLayoutEffect;
const initialModelSwitchFeedback: ModelSwitchFeedback = {
  phase: "idle",
  previousModelId: null,
  nextModelId: null,
  message: null
};

function areOpenClawBinarySelectionsEqual(
  left: OpenClawBinarySelection,
  right: OpenClawBinarySelection
) {
  return (
    left.mode === right.mode &&
    left.path === right.path &&
    left.resolvedPath === right.resolvedPath &&
    left.label === right.label &&
    left.detail === right.detail
  );
}

export function MissionControlShell({
  initialSnapshot,
  mode = "mission"
}: {
  initialSnapshot: MissionControlSnapshot;
  mode?: "mission" | "settings";
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
  const [recentCreatedAgentId, setRecentCreatedAgentId] = useState<string | null>(null);
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
  const [launchpadWorkspaceCreateRunState, setLaunchpadWorkspaceCreateRunState] = useState<UpdateRunState>("idle");
  const [launchpadWorkspaceCreateProgress, setLaunchpadWorkspaceCreateProgress] =
    useState<OperationProgressSnapshot | null>(null);
  const recentCreatedAgentTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [gatewayDraft, setGatewayDraft] = useState(() => resolveGatewayDraft(initialSnapshot));
  const [workspaceRootDraft, setWorkspaceRootDraft] = useState(() => resolveWorkspaceRootDraft(initialSnapshot));
  const [openClawBinarySelectionDraft, setOpenClawBinarySelectionDraft] = useState<OpenClawBinarySelection>(
    () => initialSnapshot.diagnostics.openClawBinarySelection
  );
  const [isSavingGateway, setIsSavingGateway] = useState(false);
  const [isSavingWorkspaceRoot, setIsSavingWorkspaceRoot] = useState(false);
  const [isSavingOpenClawBinary, setIsSavingOpenClawBinary] = useState(false);
  const [isUpdateDialogOpen, setIsUpdateDialogOpen] = useState(false);
  const [updateRunState, setUpdateRunState] = useState<UpdateRunState>("idle");
  const [updateStatusMessage, setUpdateStatusMessage] = useState<string | null>(null);
  const [updateResultMessage, setUpdateResultMessage] = useState<string | null>(null);
  const [updateLog, setUpdateLog] = useState("");
  const [updateManualCommand, setUpdateManualCommand] = useState<string | null>(null);
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
  const [modelSwitchFeedback, setModelSwitchFeedback] =
    useState<ModelSwitchFeedback>(initialModelSwitchFeedback);
  const [isOnboardingDismissed, setIsOnboardingDismissed] = useState(false);
  const [isOnboardingForcedOpen, setIsOnboardingForcedOpen] = useState(false);
  const [showOnboardingReadyState, setShowOnboardingReadyState] = useState(false);
  const [hasSeenMissionReady, setHasSeenMissionReady] = useState(false);
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
  const [loadedWorkspaceSelectionRoot, setLoadedWorkspaceSelectionRoot] = useState<string | null>(null);
  const fallbackSnapshotRecoveryKeyRef = useRef<string | null>(null);
  const hydratedOnboardingModelIdRef = useRef<string | null>(null);
  const modelOperationToastIdRef = useRef<string | number | null>(null);
  const updateOperationToastIdRef = useRef<string | number | null>(null);
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
  const isOpenClawOnboardingSystemReady = resolveOpenClawSystemReady(snapshot);
  const isOpenClawOnboardingModelReady = resolveOpenClawModelReady(snapshot);
  const hasWorkspaceSetup = hasAgentOSWorkspaceSetup(snapshot);
  const openClawInstallSummary = resolveOpenClawInstallSummary(snapshot);
  const onboardingAction = resolveOnboardingAction(snapshot);
  const hasActiveMissionWork = activeRuntimeCount > 0 || optimisticMissionTasks.length > 0;
  const shouldShowLaunchpadReadyState = shouldShowOnboardingLaunchpad(snapshot, {
    hasSeenMissionReady,
    modelSwitchSucceeded: modelSwitchFeedback.phase === "success"
  });
  const needsWorkspaceSetup =
    isOpenClawOnboardingSystemReady &&
    isOpenClawOnboardingModelReady &&
    !hasWorkspaceSetup;
  const shouldAutoShowOnboarding =
    !hasActiveMissionWork &&
    (!isOnboardingDismissed || needsWorkspaceSetup) &&
    (!isOpenClawOnboardingModelReady || needsWorkspaceSetup) &&
    !shouldShowLaunchpadReadyState;
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

  const handleCreatedAgentVisible = useCallback((agentId: string) => {
    setRecentCreatedAgentId(agentId);

    if (recentCreatedAgentTimeoutRef.current) {
      clearTimeout(recentCreatedAgentTimeoutRef.current);
    }

    recentCreatedAgentTimeoutRef.current = setTimeout(() => {
      recentCreatedAgentTimeoutRef.current = null;
      setRecentCreatedAgentId(null);
    }, 2400);
  }, []);

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

  useEffect(() => {
    return () => {
      if (recentCreatedAgentTimeoutRef.current) {
        clearTimeout(recentCreatedAgentTimeoutRef.current);
        recentCreatedAgentTimeoutRef.current = null;
      }
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

    if (shouldDeferWorkspaceSelectionHydration(snapshot)) {
      return;
    }

    setActiveWorkspaceId(snapshot.workspaces[0]?.id ?? null);
  }, [
    activeWorkspaceId,
    pendingWorkspaceOpenId,
    snapshot
  ]);

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

  useIsomorphicLayoutEffect(() => {
    const workspaceRoot = snapshot.diagnostics.workspaceRoot;

    if (loadedWorkspaceSelectionRoot === workspaceRoot) {
      return;
    }

    if (shouldDeferWorkspaceSelectionHydration(snapshot)) {
      return;
    }

    const workspaceSelectionStorageKey = buildWorkspaceSelectionStorageKey(workspaceRoot);
    const storedWorkspaceId = globalThis.localStorage?.getItem(workspaceSelectionStorageKey) ?? null;
    const resolvedWorkspaceId = resolveWorkspaceSelection(
      snapshot.workspaces.map((workspace) => workspace.id),
      storedWorkspaceId,
      activeWorkspaceId
    );

    if (resolvedWorkspaceId && resolvedWorkspaceId !== activeWorkspaceId) {
      setActiveWorkspaceId(resolvedWorkspaceId);
      setSelectedNodeId(resolvedWorkspaceId);
    }

    setLoadedWorkspaceSelectionRoot(workspaceRoot);
  }, [
    activeWorkspaceId,
    loadedWorkspaceSelectionRoot,
    snapshot.diagnostics.loaded,
    snapshot.diagnostics.rpcOk,
    snapshot.diagnostics.workspaceRoot,
    snapshot.mode,
    snapshot.workspaces
  ]);

  useEffect(() => {
    const workspaceRoot = snapshot.diagnostics.workspaceRoot;

    if (loadedWorkspaceSelectionRoot !== workspaceRoot) {
      return;
    }

    const workspaceSelectionStorageKey = buildWorkspaceSelectionStorageKey(workspaceRoot);
    const storage = globalThis.localStorage;

    if (typeof storage === "undefined") {
      return;
    }

    storage.setItem(workspaceSelectionStorageKey, serializeWorkspaceSelection(activeWorkspaceId));
  }, [activeWorkspaceId, loadedWorkspaceSelectionRoot, snapshot.diagnostics.workspaceRoot]);

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
    const storedSidebarOpen = globalThis.localStorage?.getItem(sidebarOpenStorageKey);
    const storedHiddenRuntimeIds = globalThis.localStorage?.getItem(hiddenRuntimeIdsStorageKey);
    const storedHiddenTaskKeys = globalThis.localStorage?.getItem(hiddenTaskKeysStorageKey);
    const storedLockedTaskKeys = globalThis.localStorage?.getItem(lockedTaskKeysStorageKey);

    if (storedTheme === "dark" || storedTheme === "light") {
      setSurfaceTheme(storedTheme);
    }

    if (storedSidebarOpen === "true") {
      setIsSidebarOpen(true);
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
    globalThis.localStorage?.setItem(sidebarOpenStorageKey, String(isSidebarOpen));
  }, [isSidebarOpen]);

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
    if (isSettingsOpen || isSavingOpenClawBinary) {
      return;
    }

    setOpenClawBinarySelectionDraft((current) =>
      areOpenClawBinarySelectionsEqual(current, snapshot.diagnostics.openClawBinarySelection)
        ? current
        : snapshot.diagnostics.openClawBinarySelection
    );
  }, [isSettingsOpen, isSavingOpenClawBinary, snapshot.diagnostics.openClawBinarySelection]);

  useEffect(() => {
    const preferredModelId = resolveInitialOnboardingModelId(snapshot) || "";

    if (!preferredModelId) {
      return;
    }

    if (
      !selectedOnboardingModelId.trim() &&
      hydratedOnboardingModelIdRef.current !== preferredModelId
    ) {
      hydratedOnboardingModelIdRef.current = preferredModelId;
      setSelectedOnboardingModelId(preferredModelId);
    }
  }, [
    snapshot,
    selectedOnboardingModelId
  ]);

  useEffect(() => {
    if (snapshot.mode !== "fallback" || snapshot.diagnostics.installed) {
      return;
    }

    const recoveryKey = `${snapshot.mode}:${snapshot.diagnostics.installed ? "installed" : "missing"}:${snapshot.diagnostics.issues.join("|")}`;

    if (fallbackSnapshotRecoveryKeyRef.current === recoveryKey) {
      return;
    }

    fallbackSnapshotRecoveryKeyRef.current = recoveryKey;
    void refreshSnapshot({ force: true }).catch(() => {});
  }, [
    refreshSnapshot,
    snapshot.diagnostics.installed,
    snapshot.diagnostics.issues,
    snapshot.mode
  ]);

  useEffect(() => {
    if (onboardingRunState === "success" || isOpenClawOnboardingSystemReady) {
      setOnboardingStage("models");
      return;
    }

    if (modelOnboardingRunState === "running" || modelOnboardingRunState === "success") {
      return;
    }
  }, [isOpenClawOnboardingSystemReady, modelOnboardingRunState, onboardingRunState]);

  useEffect(() => {
    if (isOnboardingDismissed) {
      setShowOnboardingReadyState(false);
      return;
    }

    if (modelSwitchFeedback.phase === "success") {
      setHasSeenMissionReady(true);
      setOnboardingStage("models");
      setShowOnboardingReadyState(true);
      return;
    }

    setShowOnboardingReadyState(false);
  }, [isOnboardingDismissed, modelSwitchFeedback.phase]);

  const resetUpdateDialogState = () => {
    if (updateRunState === "running") {
      return;
    }

    setUpdateRunState("idle");
    setUpdateStatusMessage(null);
    setUpdateResultMessage(null);
    setUpdateLog("");
    setUpdateManualCommand(null);
  };

  const resetFreshInstallOnboardingState = () => {
    setOnboardingRunState("idle");
    setOnboardingPhase(null);
    setOnboardingStatusMessage(null);
    setOnboardingResultMessage(null);
    setOnboardingLog("");
    setOnboardingManualCommand(null);
    setOnboardingDocsUrl(null);
    setModelOnboardingRunState("idle");
    setModelOnboardingPhase(null);
    setModelOnboardingStatusMessage(null);
    setModelOnboardingResultMessage(null);
    setModelOnboardingManualCommand(null);
    setModelOnboardingDocsUrl(null);
    setModelOnboardingLog("");
    setDiscoveredModels([]);
    setSelectedOnboardingModelId("");
    setModelSwitchFeedback(initialModelSwitchFeedback);
    setShowOnboardingReadyState(false);
    setHasSeenMissionReady(false);
    setLaunchpadWorkspaceCreateRunState("idle");
    setLaunchpadWorkspaceCreateProgress(null);
    hydratedOnboardingModelIdRef.current = null;
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
    if (updateRunState === "running") {
      setIsUpdateDialogOpen(true);
      return;
    }

    const updateUpdateToast = (description: string) => {
      updateOperationToastIdRef.current = toast.loading("Updating OpenClaw...", {
        id: updateOperationToastIdRef.current ?? undefined,
        description,
        duration: Infinity,
        action: {
          label: "View",
          onClick: () => setIsUpdateDialogOpen(true)
        }
      });
    };
    const completeUpdateToast = (ok: boolean, description: string) => {
      const toastOptions = {
        id: updateOperationToastIdRef.current ?? undefined,
        description,
        duration: ok ? 6000 : 10000,
        action: {
          label: "View details",
          onClick: () => setIsUpdateDialogOpen(true)
        }
      };

      if (ok) {
        toast.success("OpenClaw updated.", toastOptions);
      } else {
        toast.error("OpenClaw update failed.", toastOptions);
      }

      updateOperationToastIdRef.current = null;
    };
    let sawUpdateCommandOutput = false;
    const appendUpdateDoneLog = (event: Extract<OpenClawUpdateStreamEvent, { type: "done" }>) => {
      appendUpdateLog(`\n> ${event.message}\n`);

      if (sawUpdateCommandOutput) {
        return;
      }

      const stdout = event.stdout.trimEnd();
      const stderr = event.stderr.trimEnd();

      if (stdout) {
        appendUpdateLog(`\n[stdout]\n${stdout}\n`);
      }

      if (stderr) {
        appendUpdateLog(`\n[stderr]\n${stderr}\n`);
      }
    };

    setIsUpdateDialogOpen(true);
    setUpdateRunState("running");
    setUpdateStatusMessage("Starting OpenClaw update...");
    setUpdateResultMessage(null);
    setUpdateLog("");
    setUpdateManualCommand(null);
    updateUpdateToast("Starting OpenClaw update...");

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
              updateUpdateToast(event.message);
            } else if (event.type === "log") {
              sawUpdateCommandOutput = true;
              appendUpdateLog(event.text);
            } else {
              sawDone = true;
              appendUpdateDoneLog(event);
              setUpdateStatusMessage(null);
              setUpdateResultMessage(event.message);
              setUpdateRunState(event.ok ? "success" : "error");
              setUpdateManualCommand(event.manualCommand ?? null);

              if (event.snapshot) {
                setSnapshot(event.snapshot);
              }

              if (event.ok) {
                completeUpdateToast(true, event.message);
              } else {
                completeUpdateToast(false, event.message);
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
          appendUpdateDoneLog(event);
          setUpdateStatusMessage(null);
          setUpdateResultMessage(event.message);
          setUpdateRunState(event.ok ? "success" : "error");
          setUpdateManualCommand(event.manualCommand ?? null);

          if (event.snapshot) {
            setSnapshot(event.snapshot);
          }

          completeUpdateToast(event.ok, event.message);
        }
      }

      if (!sawDone) {
        throw new Error("OpenClaw update stream ended unexpectedly.");
      }
    } catch (error) {
      setUpdateRunState("error");
      setUpdateStatusMessage(null);
      setUpdateResultMessage(error instanceof Error ? error.message : "OpenClaw update failed.");
      completeUpdateToast(false, error instanceof Error ? error.message : "Unknown update error.");
    }
  };

  const runOpenClawOnboarding = async () => {
    setIsOnboardingDismissed(false);
    resetFreshInstallOnboardingState();
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
    const previousDefaultModelId =
      snapshot.diagnostics.modelReadiness.resolvedDefaultModel ||
      snapshot.diagnostics.modelReadiness.defaultModel ||
      null;
    const updateSetDefaultToast = (description: string) => {
      if (payload.intent !== "set-default") {
        return;
      }

      modelOperationToastIdRef.current = toast.loading("Setting default model...", {
        id: modelOperationToastIdRef.current ?? undefined,
        description,
        duration: Infinity
      });
    };
    const completeSetDefaultToast = (
      variant: "success" | "message" | "error",
      title: string,
      description: string
    ) => {
      if (payload.intent !== "set-default") {
        return false;
      }

      const toastOptions = {
        id: modelOperationToastIdRef.current ?? undefined,
        description,
        duration: variant === "message" ? Infinity : 6000
      };

      if (variant === "success") {
        toast.success(title, toastOptions);
      } else if (variant === "message") {
        toast.message(title, toastOptions);
      } else {
        toast.error(title, toastOptions);
      }

      modelOperationToastIdRef.current = null;
      return true;
    };

    setIsOnboardingDismissed(false);
    setOnboardingStage("models");
    setModelOnboardingRunState("running");
    setModelOnboardingPhase(resolveModelOnboardingStartPhase(payload.intent));
    setModelOnboardingStatusMessage(actionCopy.statusMessage);
    setModelOnboardingResultMessage(null);
    setModelOnboardingManualCommand(null);
    setModelOnboardingDocsUrl(null);
    setModelOnboardingLog("");
    setModelSwitchFeedback(
      payload.intent === "set-default"
        ? {
            phase: "saving",
            previousModelId: previousDefaultModelId,
            nextModelId: payload.modelId,
            message: actionCopy.statusMessage
          }
        : initialModelSwitchFeedback
    );
    updateSetDefaultToast(actionCopy.statusMessage);

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
              if (payload.intent === "set-default") {
                updateSetDefaultToast(event.message);
                setModelSwitchFeedback({
                  phase: "saving",
                  previousModelId: previousDefaultModelId,
                  nextModelId: payload.modelId,
                  message: event.message
                });
              }
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
              if (payload.intent === "set-default") {
                setModelSwitchFeedback({
                  phase: event.ok ? "success" : "error",
                  previousModelId: previousDefaultModelId,
                  nextModelId: payload.modelId,
                  message: event.message
                });
              }

              if (event.snapshot) {
                setSnapshot(event.snapshot);
              }

              if (event.ok) {
                if (!completeSetDefaultToast("success", actionCopy.successTitle, event.message)) {
                  toast.success(actionCopy.successTitle, {
                    description: event.message
                  });
                }

                if (payload.intent === "set-default") {
                  setShowOnboardingReadyState(true);
                }
              } else if (event.phase === "authenticating" && event.manualCommand) {
                if (!completeSetDefaultToast("message", "Continue in terminal.", event.message)) {
                  toast.message("Continue in terminal.", {
                    description: event.message
                  });
                }
              } else {
                if (!completeSetDefaultToast("error", actionCopy.errorTitle, event.message)) {
                  toast.error(actionCopy.errorTitle, {
                    description: event.message
                  });
                }
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
          if (payload.intent === "set-default") {
            setModelSwitchFeedback({
              phase: event.ok ? "success" : "error",
              previousModelId: previousDefaultModelId,
              nextModelId: payload.modelId,
              message: event.message
            });
          }

          if (event.snapshot) {
            setSnapshot(event.snapshot);
          }

          if (event.ok) {
            completeSetDefaultToast("success", actionCopy.successTitle, event.message);
          } else if (event.phase === "authenticating" && event.manualCommand) {
            completeSetDefaultToast("message", "Continue in terminal.", event.message);
          } else {
            completeSetDefaultToast("error", actionCopy.errorTitle, event.message);
          }

          if (event.ok && payload.intent === "set-default") {
            setShowOnboardingReadyState(true);
          }
        }
      }

      if (!sawDone) {
        throw new Error("Model onboarding stream ended unexpectedly.");
      }
    } catch (error) {
      if (payload.intent === "set-default") {
        setModelSwitchFeedback({
          phase: "error",
          previousModelId: previousDefaultModelId,
          nextModelId: payload.modelId,
          message: error instanceof Error ? error.message : "Default model save failed."
        });
      }
      const errorMessage = error instanceof Error ? error.message : "Unknown model onboarding error.";
      setModelOnboardingRunState("error");
      setModelOnboardingStatusMessage(null);
      setModelOnboardingResultMessage(
        error instanceof Error ? error.message : "Model onboarding failed."
      );
      if (!completeSetDefaultToast("error", actionCopy.errorTitle, errorMessage)) {
        toast.error(actionCopy.errorTitle, {
          description: errorMessage
        });
      }
    }
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
    const currentDefaultModelId =
      snapshot.diagnostics.modelReadiness.resolvedDefaultModel ||
      snapshot.diagnostics.modelReadiness.defaultModel ||
      null;

    if (!targetModelId) {
      return;
    }

    if (currentDefaultModelId && targetModelId.trim() === currentDefaultModelId.trim()) {
      return;
    }

    await runModelOnboarding({
      intent: "set-default",
      modelId: targetModelId
    });
  };

  const dismissOnboarding = useCallback(() => {
    setIsOnboardingForcedOpen(false);
    setShowOnboardingReadyState(false);
    setIsOnboardingDismissed(true);
    setLaunchpadWorkspaceCreateRunState("idle");
    setLaunchpadWorkspaceCreateProgress(null);
  }, []);

  const runLaunchpadWorkspaceCreate = useCallback(async () => {
    if (launchpadWorkspaceCreateRunState === "running") {
      return null;
    }

    const targetModelId =
      selectedOnboardingModelId.trim() ||
      snapshot.diagnostics.modelReadiness.resolvedDefaultModel ||
      snapshot.diagnostics.modelReadiness.defaultModel ||
      null;

    if (!targetModelId) {
      toast.error("Choose a model first.", {
        description: "OpenClaw needs a usable default model before it can create the first workspace."
      });
      return null;
    }

    setLaunchpadWorkspaceCreateRunState("running");
    setLaunchpadWorkspaceCreateProgress(
      createPendingOperationProgressSnapshot(
        buildWorkspaceCreateProgressTemplate({
          sourceMode: "empty",
          agentCount: 1,
          kickoffMission: true
        })
      )
    );

    try {
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: "AgentOS Workspace",
          brief: "First workspace created from the AgentOS launchpad.",
          modelId: targetModelId,
          sourceMode: "empty",
          template: "software",
          teamPreset: "solo",
          modelProfile: "balanced",
          rules: {
            workspaceOnly: true,
            generateStarterDocs: true,
            generateMemory: true,
            kickoffMission: true
          },
          stream: true
        })
      });

      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(result?.error || "OpenClaw could not create the workspace.");
      }

      let createdResult: WorkspaceCreateResult | null = null;
      let createError: string | null = null;

      await consumeNdjsonStream<WorkspaceCreateStreamEvent>(response, async (event) => {
        if (event.type === "progress") {
          setLaunchpadWorkspaceCreateProgress(event.progress);
          return;
        }

        if (event.progress) {
          setLaunchpadWorkspaceCreateProgress(event.progress);
        }

        if (event.ok) {
          createdResult = event.result;
        } else {
          createError = event.error;
        }
      });

      if (createError || !createdResult) {
        throw new Error(createError || "OpenClaw could not create the workspace.");
      }

      const result = createdResult as WorkspaceCreateResult;
      setLaunchpadWorkspaceCreateRunState("success");

      const refreshedSnapshot = await refreshSnapshot({ force: true }).catch(() => null);
      const nextWorkspaceId =
        refreshedSnapshot?.workspaces.some((workspace) => workspace.id === result.workspaceId)
          ? result.workspaceId
          : refreshedSnapshot?.workspaces[0]?.id ?? result.workspaceId;

      setPendingWorkspaceOpenId(nextWorkspaceId);
      setActiveWorkspaceId(nextWorkspaceId);
      selectNode(nextWorkspaceId);

      if (refreshedSnapshot) {
        setSnapshot(refreshedSnapshot);
      } else {
        await refresh().catch(() => {});
      }

      dismissOnboarding();

      toast.success("Workspace created.", {
        description: `${result.agentIds.length} agent${result.agentIds.length === 1 ? "" : "s"} created at ${result.workspacePath}`
      });

      if (result.kickoffError) {
        toast.message("Workspace created, but kickoff needs attention.", {
          description: result.kickoffError
        });
      }

      return result;
    } catch (error) {
      setLaunchpadWorkspaceCreateRunState("error");
      const message = error instanceof Error ? error.message : "Unknown workspace error.";
      toast.error("Workspace creation failed.", {
        description: message
      });
      return null;
    }
  }, [
    dismissOnboarding,
    launchpadWorkspaceCreateRunState,
    refresh,
    refreshSnapshot,
    selectedOnboardingModelId,
    selectNode,
    snapshot.diagnostics.modelReadiness.defaultModel,
    snapshot.diagnostics.modelReadiness.resolvedDefaultModel,
    setSnapshot
  ]);

  const openSetupWizard = (stage?: OnboardingWizardStage) => {
    const systemReady = resolveOpenClawSystemReady(snapshot);
    const resolvedStage = stage ?? (systemReady ? "models" : "system");

    setIsSettingsOpen(false);
    setOnboardingStage(resolvedStage);
    setIsOnboardingDismissed(false);
    setShowOnboardingReadyState(stage === undefined && shouldShowLaunchpadReadyState);
    setIsOnboardingForcedOpen(true);
  };

  const openGatewayAuthSettings = () => {
    setIsOnboardingForcedOpen(false);
    setShowOnboardingReadyState(false);
    setIsOnboardingDismissed(true);

    if (mode === "settings" && typeof window !== "undefined") {
      window.location.hash = "gateway";
      return;
    }

    setIsSettingsOpen(true);
  };

  const enterAgentOS = useCallback(() => {
    if (!hasAgentOSWorkspaceSetup(snapshot)) {
      void runLaunchpadWorkspaceCreate();
      return;
    }

    const targetWorkspaceId =
      (activeWorkspaceId && snapshot.workspaces.some((workspace) => workspace.id === activeWorkspaceId)
        ? activeWorkspaceId
        : snapshot.workspaces[0]?.id) ?? null;

    if (targetWorkspaceId) {
      setActiveWorkspaceId(targetWorkspaceId);
      setPendingWorkspaceOpenId(null);
      selectNode(targetWorkspaceId);
    }

    dismissOnboarding();
  }, [activeWorkspaceId, dismissOnboarding, runLaunchpadWorkspaceCreate, selectNode, snapshot]);

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
      const nextSnapshot = await refreshSnapshot({ force: true });
      const checkedAt = Date.now();
      const updateInfo = nextSnapshot.diagnostics.updateInfo?.trim();
      const isUpdateRegistryLoading =
        Boolean(nextSnapshot.diagnostics.version) &&
        !nextSnapshot.diagnostics.latestVersion &&
        !nextSnapshot.diagnostics.updateError;

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

      if (isUpdateRegistryLoading) {
        toast.message("Update registry is still loading.", {
          description:
            updateInfo ||
            `Running v${nextSnapshot.diagnostics.version || "unknown"}. OpenClaw has not reported a latest release yet.`
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

  const buildOpenClawBinarySelectionDraft = useCallback(
    (mode: OpenClawBinarySelection["mode"], pathValue?: string | null): OpenClawBinarySelection => {
      switch (mode) {
        case "auto":
          return {
            mode: "auto",
            path: null,
            resolvedPath: null,
            label: "Auto",
            detail: "Use the managed resolution order."
          };
        case "local-prefix": {
          return {
            mode: "local-prefix",
            path: null,
            resolvedPath: null,
            label: "Local prefix",
            detail: "Use the managed local prefix install."
          };
        }
        case "global-path":
          return {
            mode: "global-path",
            path: null,
            resolvedPath: null,
            label: "Global PATH",
            detail: "Resolve the first executable named openclaw on PATH when saved."
          };
        default: {
          const normalizedPath = typeof pathValue === "string" ? pathValue.trim() : "";
          return {
            mode: "custom",
            path: normalizedPath || null,
            resolvedPath: normalizedPath || null,
            label: "Custom path",
            detail: normalizedPath || "Enter an absolute path to an executable OpenClaw binary."
          };
        }
      }
    },
    []
  );

  const handleOpenClawBinarySelectionModeChange = useCallback(
    (mode: OpenClawBinarySelection["mode"]) => {
      setOpenClawBinarySelectionDraft((current) => {
        if (mode === current.mode) {
          if (mode === "custom") {
            return buildOpenClawBinarySelectionDraft(mode, current.path);
          }

          return current;
        }

        if (mode === "custom") {
          return buildOpenClawBinarySelectionDraft(mode, current.path);
        }

        return buildOpenClawBinarySelectionDraft(mode);
      });
    },
    [buildOpenClawBinarySelectionDraft]
  );

  const handleOpenClawBinarySelectionPathChange = useCallback((value: string) => {
    setOpenClawBinarySelectionDraft(buildOpenClawBinarySelectionDraft("custom", value));
  }, [buildOpenClawBinarySelectionDraft]);

  const saveOpenClawBinarySettings = async (nextSelection: OpenClawBinarySelection) => {
    setIsSavingOpenClawBinary(true);

    try {
      const response = await fetch("/api/settings/openclaw-binary", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(nextSelection)
      });

      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(result?.error || "OpenClaw binary selection could not be updated.");
      }

      const result = (await response.json()) as {
        snapshot: MissionControlSnapshot;
        selection: OpenClawBinarySelection;
      };

      setSnapshot(result.snapshot);
      setOpenClawBinarySelectionDraft(result.selection);

      const selectionLabel = result.selection.label || "OpenClaw binary";

      toast.success("OpenClaw binary updated.", {
        description:
          result.selection.mode === "auto"
            ? "AgentOS will use the managed resolution order."
            : `${selectionLabel} is now the active choice.`
      });
    } catch (error) {
      toast.error("OpenClaw binary update failed.", {
        description: error instanceof Error ? error.message : "Unable to update the OpenClaw binary."
      });
    } finally {
      setIsSavingOpenClawBinary(false);
    }
  };

  const clearMissionControlBrowserState = () => {
    if (typeof globalThis.localStorage === "undefined") {
      return;
    }

    const exactKeys = [
      "mission-control-surface-theme",
      "mission-control-hidden-runtime-ids",
      "mission-control-hidden-task-keys",
      "mission-control-locked-task-keys",
      "mission-control-workspace-plan-id",
      "mission-control-recent-prompts",
      "mission-control-node-positions"
    ];
    const prefixKeys = [
      "mission-control-active-workspace-id:",
      "mission-control-node-positions:v2:",
      "mission-control-composer-draft:",
      "mission-control-agent-chat:v1:",
      "mission-control-agent-chat-seen:v1:"
    ];

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

    setHiddenRuntimeIds([]);
    setHiddenTaskKeys([]);
    setLockedTaskKeys([]);
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
                if (resetDialogTarget === "full-uninstall") {
                  resetFreshInstallOnboardingState();
                }

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
            if (resetDialogTarget === "full-uninstall") {
              resetFreshInstallOnboardingState();
            }

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

  const handleResetBackToSetup = () => {
    setResetDialogTarget(null);
    resetResetDialogState();
    openSetupWizard("system");
  };

  const settingsPanelProps: MissionControlShellSettingsPanelProps = {
    snapshot,
    surfaceTheme,
    gatewayDraft,
    workspaceRootDraft,
    isSavingGateway,
    isSavingWorkspaceRoot,
    isCheckingForUpdates,
    updateRunState,
    selectedModelId: selectedOnboardingModelId,
    modelOnboardingRunState,
    gatewayControlAction,
    lastCheckedAt,
    onGatewayDraftChange: setGatewayDraft,
    onWorkspaceRootDraftChange: setWorkspaceRootDraft,
    onSelectedModelIdChange: setSelectedOnboardingModelId,
    onSaveGatewaySettings: saveGatewaySettings,
    onSaveWorkspaceRootSettings: saveWorkspaceRootSettings,
    onCheckForUpdates: checkForUpdates,
    onControlGateway: controlGateway,
    onOpenSetupWizard: openSetupWizard,
    onRunModelRefresh: runModelRefresh,
    onRunModelSetDefault: runModelSetDefault,
    onOpenAddModels: openAddModelsDialog,
    onOpenUpdateDialog: () => {
      if (updateRunState === "idle") {
        resetUpdateDialogState();
      }
      setIsUpdateDialogOpen(true);
    },
    onOpenResetDialog: (target) => {
      void openResetDialog(target);
    },
    openClawBinarySelection: openClawBinarySelectionDraft,
    isSavingOpenClawBinary,
    onOpenClawBinarySelectionModeChange: handleOpenClawBinarySelectionModeChange,
    onOpenClawBinarySelectionPathChange: handleOpenClawBinarySelectionPathChange,
    onSaveOpenClawBinarySettings: saveOpenClawBinarySettings,
    installSummary: openClawInstallSummary
  };

  const settingsSystemOverlays = (
    <>
      {shouldShowOnboarding ? (
        <OpenClawOnboarding
          snapshot={snapshot}
          surfaceTheme={surfaceTheme}
          stage={onboardingStage}
          showReadyState={showOnboardingReadyState}
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
          modelSwitchFeedback={modelSwitchFeedback}
          selectedModelId={selectedOnboardingModelId}
          discoveredModels={discoveredModels}
          onSelectedModelIdChange={setSelectedOnboardingModelId}
          onClearModelSwitchFeedback={() => setModelSwitchFeedback(initialModelSwitchFeedback)}
          onRunSystemSetup={runOpenClawOnboarding}
          onRunModelSetDefault={runModelSetDefault}
          onOpenAddModels={openAddModelsDialog}
          onOpenGatewayAuthSettings={openGatewayAuthSettings}
          onEnterAgentOS={enterAgentOS}
          onCreateWorkspace={runLaunchpadWorkspaceCreate}
          onContinueToModels={() => setOnboardingStage("models")}
          onBackToSystem={() => setOnboardingStage("system")}
          onSelectStage={(stage) => {
            setShowOnboardingReadyState(false);
            setOnboardingStage(stage);
          }}
          launchpadCreateProgress={launchpadWorkspaceCreateProgress}
          launchpadCreateRunState={launchpadWorkspaceCreateRunState}
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
        onBackToSetup={handleResetBackToSetup}
        onOpenChange={handleResetDialogOpenChange}
      />

      <MissionControlShellDialogs
        snapshot={snapshot}
        surfaceTheme={surfaceTheme}
        isInspectorOpen={false}
        taskAbortRequest={taskAbortRequest}
        taskAbortRunState={taskAbortRunState}
        taskAbortMessage={taskAbortMessage}
        onTaskAbortOpenChange={(open) => {
          if (taskAbortRunState === "running") {
            return;
          }

          if (!open) {
            setTaskAbortRequest(null);
            setTaskAbortRunState("idle");
            setTaskAbortMessage(null);
          }
        }}
        onTaskAbortConfirm={() => {
          void confirmTaskAbort();
        }}
        updateDialogOpen={isUpdateDialogOpen}
        updateRunState={updateRunState}
        updateStatusMessage={updateStatusMessage}
        updateResultMessage={updateResultMessage}
        updateLog={updateLog}
        updateManualCommand={updateManualCommand}
        activeRuntimeCount={activeRuntimeCount}
        updateInstallSummary={openClawInstallSummary}
        onUpdateDialogOpenChange={(open) => {
          if (updateRunState === "running") {
            setIsUpdateDialogOpen(open);
            return;
          }

          setIsUpdateDialogOpen(open);

          if (!open) {
            resetUpdateDialogState();
          }
        }}
        onRunOpenClawUpdate={() => {
          void runOpenClawUpdate();
        }}
      />
    </>
  );

  if (mode === "settings") {
    return (
      <div
        className={cn(
          "mission-shell relative min-h-screen overflow-hidden",
          surfaceTheme === "light" && "mission-shell--light"
        )}
      >
        <div className="mission-canvas-backdrop fixed inset-0 z-0">
          <div aria-hidden="true" className="mission-canvas-pattern absolute inset-0 z-0" />
        </div>

        <div className="pointer-events-auto fixed left-0 top-0 z-30 hidden h-[100dvh] w-[360px] overflow-visible lg:block">
          <MissionSidebar
            snapshot={uiSnapshot}
            surfaceTheme={surfaceTheme}
            activeWorkspaceId={activeWorkspaceId}
            requestedAgentAction={agentActionRequest}
            connectionState={connectionState}
            collapsed={false}
            settingsMode
            modelManager={{
              runState: modelOnboardingRunState,
              statusMessage: modelOnboardingStatusMessage,
              resultMessage: modelOnboardingResultMessage,
              log: modelOnboardingLog,
              manualCommand: modelOnboardingManualCommand,
              docsUrl: modelOnboardingDocsUrl,
              discoveredModels,
              systemReady: isOpenClawOnboardingSystemReady
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
            onOpenModelSetup={() => openSetupWizard()}
            onOpenAddModels={openAddModelsDialog}
            onEditWorkspace={openWorkspaceWizardForEdit}
            onSnapshotChange={setSnapshot}
            onAgentCreatedVisible={handleCreatedAgentVisible}
          />
        </div>

        <SettingsControlCenter {...settingsPanelProps} />
        <div className="pointer-events-none fixed top-0 z-40 hidden lg:left-[384px] lg:right-[84px] lg:block">
          <MissionControlCanvasTopBar
            settingsRef={settingsRef}
            isSettingsOpen={isSettingsOpen}
            onToggleTheme={() =>
              setSurfaceTheme((current) => (current === "light" ? "dark" : "light"))
            }
            onToggleSettings={() => setIsSettingsOpen((current) => !current)}
            {...settingsPanelProps}
          />
        </div>
        {settingsSystemOverlays}
      </div>
    );
  }

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
            recentCreatedAgentId={recentCreatedAgentId}
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
          settingsRef={settingsRef}
          isSettingsOpen={isSettingsOpen}
          onToggleTheme={() =>
            setSurfaceTheme((current) => (current === "light" ? "dark" : "light"))
          }
          onToggleSettings={() => setIsSettingsOpen((current) => !current)}
          {...settingsPanelProps}
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
              systemReady: isOpenClawOnboardingSystemReady
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
            onOpenModelSetup={() => openSetupWizard()}
            onOpenAddModels={openAddModelsDialog}
            onEditWorkspace={openWorkspaceWizardForEdit}
            onSnapshotChange={setSnapshot}
            onAgentCreatedVisible={handleCreatedAgentVisible}
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
            surfaceTheme={surfaceTheme}
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
            onAgentCreatedVisible={handleCreatedAgentVisible}
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
            showReadyState={showOnboardingReadyState}
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
            modelSwitchFeedback={modelSwitchFeedback}
            selectedModelId={selectedOnboardingModelId}
            discoveredModels={discoveredModels}
            onSelectedModelIdChange={setSelectedOnboardingModelId}
            onClearModelSwitchFeedback={() => setModelSwitchFeedback(initialModelSwitchFeedback)}
            onRunSystemSetup={runOpenClawOnboarding}
            onRunModelSetDefault={runModelSetDefault}
            onOpenAddModels={openAddModelsDialog}
            onOpenGatewayAuthSettings={openGatewayAuthSettings}
            onEnterAgentOS={enterAgentOS}
            onCreateWorkspace={runLaunchpadWorkspaceCreate}
            onContinueToModels={() => setOnboardingStage("models")}
            onBackToSystem={() => setOnboardingStage("system")}
            onSelectStage={(stage) => {
              setShowOnboardingReadyState(false);
              setOnboardingStage(stage);
            }}
            launchpadCreateProgress={launchpadWorkspaceCreateProgress}
            launchpadCreateRunState={launchpadWorkspaceCreateRunState}
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
          onBackToSetup={handleResetBackToSetup}
          onOpenChange={handleResetDialogOpenChange}
        />

        <MissionControlShellDialogs
          snapshot={snapshot}
          surfaceTheme={surfaceTheme}
          isInspectorOpen={isInspectorOpen}
          taskAbortRequest={taskAbortRequest}
          taskAbortRunState={taskAbortRunState}
          taskAbortMessage={taskAbortMessage}
          onTaskAbortOpenChange={(open) => {
            if (taskAbortRunState === "running") {
              return;
            }

            if (!open) {
              setTaskAbortRequest(null);
              setTaskAbortRunState("idle");
              setTaskAbortMessage(null);
            }
          }}
          onTaskAbortConfirm={() => {
            void confirmTaskAbort();
          }}
          updateDialogOpen={isUpdateDialogOpen}
          updateRunState={updateRunState}
          updateStatusMessage={updateStatusMessage}
          updateResultMessage={updateResultMessage}
          updateLog={updateLog}
          updateManualCommand={updateManualCommand}
          activeRuntimeCount={activeRuntimeCount}
          updateInstallSummary={openClawInstallSummary}
          onUpdateDialogOpenChange={(open) => {
            if (updateRunState === "running") {
              setIsUpdateDialogOpen(open);
              return;
            }

            setIsUpdateDialogOpen(open);

            if (!open) {
              resetUpdateDialogState();
            }
          }}
          onRunOpenClawUpdate={() => {
            void runOpenClawUpdate();
          }}
        />
      </div>
    </div>
  );
}
