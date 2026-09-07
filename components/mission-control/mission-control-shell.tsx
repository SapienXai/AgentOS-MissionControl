"use client";

import {
  EyeOff,
  Menu,
  PanelRightOpen,
  RefreshCw,
} from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { AddModelsDialog } from "@/components/mission-control/add-models/add-models-dialog";
import { AgentModelPickerDialog } from "@/components/mission-control/agent-model-picker-dialog";
import { AgentCapabilityEditorDialog } from "@/components/mission-control/agent-capability-editor-dialog";
import { CommandBar } from "@/components/mission-control/command-bar";
import { workspaceTaskCardFiltersStorageKey } from "@/components/mission-control/canvas.persistence";
import { CreateAgentDialog } from "@/components/mission-control/create-agent-dialog";
import { ContextEngineDialog } from "@/components/mission-control/context-engine-dialog";
import { InspectorPanel } from "@/components/mission-control/inspector-panel";
import {
  clampInspectorWidth,
  inspectorCompactWidth,
  inspectorDetailWidth,
  isInspectorDetailWidth
} from "@/components/mission-control/inspector-resize";
import { MissionControlShellDialogs } from "@/components/mission-control/mission-control-shell.dialogs";
import { OpenClawOnboarding } from "@/components/mission-control/openclaw-onboarding";
import type { ModelSwitchFeedback } from "@/components/mission-control/openclaw-onboarding.stages";
import { ResetDialog } from "@/components/mission-control/reset-dialog";
import { SettingsControlCenter } from "@/components/mission-control/settings-control-center";
import { MissionSidebar } from "@/components/mission-control/sidebar";
import { useSidebarPinning } from "@/components/mission-control/use-sidebar-pinning";
import { TaskReviewDialog } from "@/components/mission-control/task-review-dialog";
import {
  applyTaskReviewStateToSnapshot,
  resolveTaskReviewKey,
  taskReviewStateStorageKey
} from "@/components/mission-control/task-review-state";
import {
  missionControlPreferenceStorageKeys,
  useMissionControlPreferences
} from "@/components/mission-control/use-mission-control-preferences";
import { useMissionControlSelection } from "@/components/mission-control/use-mission-control-selection";
import { useMissionControlAgentActions } from "@/components/mission-control/use-mission-control-agent-actions";
import { useMissionControlResetState } from "@/components/mission-control/use-mission-control-reset-state";
import { useMissionControlTaskActions } from "@/components/mission-control/use-mission-control-task-actions";
import { useMissionControlWorkspaceActions } from "@/components/mission-control/use-mission-control-workspace-actions";
import { useTaskReviewWorkflow } from "@/components/mission-control/use-task-review-workflow";
import { WorkspaceChannelsDialog } from "@/components/mission-control/workspace-channels-dialog";
import { WorkspaceWizardDialog } from "@/components/mission-control/workspace-wizard/workspace-wizard-dialog";
import { resolveSuggestedAgentModelId } from "@/components/mission-control/create-agent-dialog.utils";
import {
  buildPendingAgentsForWorkspaceResult,
  parsePendingAgentProjections,
  pendingAgentProjectionStorageKey,
  type PendingAgentProjection,
  type PendingWorkspaceMenuEntry
} from "@/components/mission-control/pending-agent-projection";
import { ConnectAccountWizard } from "@/components/operations/accounts/accounts-page-content";
import dynamic from "next/dynamic";
import { toast } from "@/components/ui/sonner";
import { useMissionControlData } from "@/hooks/use-mission-control-data";
import { resolveTaskWorkspaceId } from "@/components/mission-control/canvas.graph";
import type { OptimisticMissionTask } from "@/components/mission-control/mission-control-shell.utils";
import {
  CanvasTitlePill as MissionControlCanvasTitlePill,
  CanvasTopBar as MissionControlCanvasTopBar
} from "@/components/mission-control/mission-control-shell.topbar";
import type { MissionControlShellSettingsPanelProps } from "@/components/mission-control/mission-control-shell.settings";
import {
  createOptimisticMissionTaskRecord,
  createOptimisticScheduledTaskRecord,
  findReplacementTaskForOptimisticTask,
  buildLaunchpadWorkspaceHandoffProgress,
  hasCompleteAgentOSWorkspaceSnapshot,
  hasAgentOSWorkspaceSetup,
  isDirectChatRuntime,
  isTaskHiddenByPreferences,
  mergeSnapshotWithOptimisticTasks,
  resolveLaunchpadWorkspaceSetupReadiness,
  resolveGatewayDraft,
  describeLaunchpadWorkspaceSetupReadiness,
  resolveModelOnboardingActionCopy,
  resolveModelOnboardingStartPhase,
  resolveOnboardingAction,
  resolveOpenClawInstallSummary,
  resolveTaskPrompt,
  buildWorkspaceSelectionStorageKey,
  resolveWorkspaceRootDraft,
  resolveWorkspaceSelection,
  resolveWorkspaceContextEngineAgent,
  serializeWorkspaceSelection,
  shouldShowOnboardingLaunchpad,
  shouldDeferWorkspaceSelectionHydration,
  updateOptimisticMissionTask
} from "@/components/mission-control/mission-control-shell.utils";
import {
  resolveEffectiveWizardStage,
  resolveInitialOnboardingModelId,
  resolveChatGptRecoveryMessage,
  isChatGptConnectionReady,
  isOnboardingModelStepComplete,
  ONBOARDING_DEFAULT_THINKING
} from "@/components/mission-control/openclaw-onboarding.utils";
import { compactPath } from "@/lib/openclaw/presenters";
import { compareVersionStrings } from "@/lib/openclaw/domains/control-plane-normalization";
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
  AddModelsProviderActionResult,
  AddModelsProviderId,
  ChatGptBrowserAuthSnapshot,
  DiscoveredModelCandidate,
  MissionResponse,
  MissionControlSnapshot,
  OpenClawBinarySelection,
  OpenClawCapabilityDiffReport,
  OpenClawCertificationScorecardReport,
  OpenClawModelOnboardingPhase,
  OpenClawModelOnboardingStreamEvent,
  OpenClawOnboardingPhase,
  OpenClawOnboardingStreamEvent,
  OpenClawThinkingLevel,
  OperationProgressSnapshot,
  ResetPreview,
  ResetStreamEvent,
  ResetTarget,
  OpenClawUpdateStreamEvent,
  WorkspaceCreateResult,
  WorkspaceCreateStreamEvent,
  WorkspacePlanDeployResult,
  WorkItemRecord
} from "@/lib/agentos/contracts";
import {
  getModelProviderDescriptor,
  normalizeAddModelsProviderId
} from "@/lib/openclaw/model-provider-registry";
import {
  readChatGptBrowserAuth,
  startChatGptBrowserAuth,
  submitChatGptBrowserAuth
} from "@/lib/openclaw/model-provider-adapters";
import { syncTauriDesktopPlatformMarker } from "@/lib/desktop/window-platform";
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

type UpdateRunState = "idle" | "running" | "success" | "error";
type OnboardingWizardStage = "system" | "models";
type GatewayControlAction = "start" | "stop" | "restart" | "doctor";
type ModelOnboardingIntent = "auto" | "refresh" | "discover" | "set-default" | "login-provider" | "verify";
type ModelOnboardingRunOptions = {
  autoOpenTerminal?: boolean;
  forceOpen?: boolean;
  forceAuth?: boolean;
  verifyProvider?: AddModelsProviderId;
};
type InspectorScopeShortcut = "workspace" | "agent" | "tasks";

const modelAuthTerminalAutoOpenCooldownMs = 2 * 60 * 1000;
const modelAuthStatusPollDelaysMs = [4_000, 8_000, 15_000, 30_000, 45_000, 60_000];
const chatGptStatusRetryDelaysMs = [0, 500, 1_000, 2_000, 4_000, 8_000];
const launchpadWorkspaceHandoffPollDelaysMs = [0, 800, 1_200, 1_800, 2_600, 3_600, 5_000, 6_500];
const launchpadWorkspaceHandoffSuccessPauseMs = 450;
const openClawCapabilityDiffStorageKey = "agentos:last-openclaw-capability-diff";
const openClawCertificationScorecardStorageKey = "agentos:last-openclaw-certification-scorecard";
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

function isMissingTranscriptActivityMessage(value: string | null | undefined) {
  return (
    typeof value === "string" &&
    (/No transcript file was found for this runtime session/i.test(value) ||
      /No transcript entries were found for this runtime/i.test(value))
  );
}

function shouldKeepSidebarOpenForPortal(target: EventTarget | null) {
  if (target instanceof Element && target.closest('[role="dialog"], [data-radix-popper-content-wrapper]')) {
    return true;
  }

  return typeof document !== "undefined" && Boolean(document.querySelector('[role="dialog"]'));
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function loadPendingAgentProjections() {
  if (typeof globalThis.localStorage === "undefined") {
    return [];
  }

  return parsePendingAgentProjections(globalThis.localStorage.getItem(pendingAgentProjectionStorageKey));
}

export function MissionControlShell({
  initialSnapshot,
  mode = "mission"
}: {
  initialSnapshot: MissionControlSnapshot;
  mode?: "mission" | "settings";
}) {
  const { snapshot, connectionState, hasReceivedLiveSnapshot, gatewayReachable, gatewayRegistered, gatewayConfigured, gatewayReady, runtimeWritable, localModelStatus, cliInstalled, refresh, refreshSnapshot, setSnapshot } = useMissionControlData(initialSnapshot);
  const {
    activeWorkspaceId,
    setActiveWorkspaceId,
    selectedNodeId,
    setSelectedNodeId,
    selectedAgentDetailFocus,
    activeInspectorTab,
    setActiveInspectorTab,
    activeTaskCardContext,
    setActiveTaskCardContext,
    selectNode
  } = useMissionControlSelection(initialSnapshot.workspaces[0]?.id ?? null);
  const [composerTargetAgentId, setComposerTargetAgentId] = useState<string | null>(null);
  const [isComposerActive, setIsComposerActive] = useState(false);
  const [isComposerVisible, setIsComposerVisible] = useState(false);
  const [composerViewportResetNonce, setComposerViewportResetNonce] = useState(0);
  const [lastMission, setLastMission] = useState<MissionResponse | null>(null);
  const [composeIntent, setComposeIntent] = useState<ComposeIntent | null>(null);
  const {
    surfaceTheme,
    setSurfaceTheme,
    hiddenRuntimeIds,
    setHiddenRuntimeIds,
    hiddenTaskKeys,
    setHiddenTaskKeys,
    lockedTaskKeys,
    setLockedTaskKeys,
    safeHiddenRuntimeIds,
    safeHiddenTaskKeys,
    safeLockedTaskKeys,
    clearPreferenceState
  } = useMissionControlPreferences();

  useEffect(() => {
    syncTauriDesktopPlatformMarker();
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const hadDarkClass = root.classList.contains("dark");
    const previousColorScheme = root.style.colorScheme;

    root.classList.toggle("dark", surfaceTheme !== "light");
    root.style.colorScheme = surfaceTheme === "light" ? "light" : "dark";

    return () => {
      root.classList.toggle("dark", hadDarkClass);
      root.style.colorScheme = previousColorScheme;
    };
  }, [surfaceTheme]);

  const missionDispatchAbortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const [recentCreatedAgentId, setRecentCreatedAgentId] = useState<string | null>(null);
  const [pendingCreatedAgents, setPendingCreatedAgents] = useState<PendingAgentProjection[]>(loadPendingAgentProjections);
  const [pendingWorkspaceCreations, setPendingWorkspaceCreations] = useState<PendingWorkspaceMenuEntry[]>([]);
  const [agentCreationWarnings, setAgentCreationWarnings] = useState<Record<string, string>>({});
  const [isSidebarOpenState, setIsSidebarOpen] = useState(false);
  const { isSidebarPinned, setIsSidebarPinned } = useSidebarPinning();
  const [isCompactViewport, setIsCompactViewport] = useState(false);
  const isSidebarOpen = isSidebarOpenState || (isSidebarPinned && !isCompactViewport);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const inspectorChatEntryPointRef = useRef<"mission-control" | "inspector">("inspector");
  const [inspectorWidth, setInspectorWidth] = useState(inspectorCompactWidth);
  const [isResizingInspector, setIsResizingInspector] = useState(false);
  const inspectorResizeCleanupRef = useRef<(() => void) | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const isInspectorDetailExpanded = isInspectorDetailWidth(inspectorWidth);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 1023px)");
    const syncViewport = () => setIsCompactViewport(mediaQuery.matches);

    syncViewport();
    mediaQuery.addEventListener("change", syncViewport);
    return () => mediaQuery.removeEventListener("change", syncViewport);
  }, []);

  const handleInspectorTabChange = useCallback(
    (tab: "overview" | "chat" | "output" | "files" | "raw") => {
      if (tab === "chat") {
        inspectorChatEntryPointRef.current = "inspector";
      }

      setActiveInspectorTab(tab);
    },
    [setActiveInspectorTab]
  );

  const handleBackFromInspectorChat = useCallback(() => {
    const entryPoint = inspectorChatEntryPointRef.current;
    inspectorChatEntryPointRef.current = "inspector";
    setActiveInspectorTab("overview");

    if (entryPoint === "mission-control") {
      setIsInspectorOpen(false);
    }
  }, [setActiveInspectorTab]);

  useEffect(() => {
    if (mode !== "settings" || !isCompactViewport || !isSidebarOpenState) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSidebarOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isCompactViewport, isSidebarOpenState, mode]);

  const updateInspectorWidth = useCallback((nextWidth: number) => {
    setInspectorWidth(clampInspectorWidth(nextWidth, window.innerWidth));
  }, []);

  const startInspectorResize = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    inspectorResizeCleanupRef.current?.();
    setIsResizingInspector(true);

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      updateInspectorWidth(window.innerWidth - pointerEvent.clientX);
    };
    const finishResize = () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", finishResize);
      document.removeEventListener("pointercancel", finishResize);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      inspectorResizeCleanupRef.current = null;
      setIsResizingInspector(false);
    };

    inspectorResizeCleanupRef.current = finishResize;
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", finishResize);
    document.addEventListener("pointercancel", finishResize);
  }, [updateInspectorWidth]);

  useEffect(() => () => inspectorResizeCleanupRef.current?.(), []);
  const [isCheckingForUpdates, setIsCheckingForUpdates] = useState(false);
  const {
    resetDialogTarget,
    setResetDialogTarget,
    resetPreviewState,
    setResetPreviewState,
    resetPreview,
    setResetPreview,
    resetPreviewError,
    setResetPreviewError,
    resetRunState,
    setResetRunState,
    resetStatusMessage,
    setResetStatusMessage,
    resetResultMessage,
    setResetResultMessage,
    resetBackgroundLogPath,
    setResetBackgroundLogPath,
    resetLog,
    setResetLog,
    resetConfirmText,
    setResetConfirmText,
    resetResetDialogState
  } = useMissionControlResetState();
  const [launchpadWorkspaceCreateRunState, setLaunchpadWorkspaceCreateRunState] = useState<UpdateRunState>("idle");
  const [launchpadWorkspaceCreateProgress, setLaunchpadWorkspaceCreateProgress] =
    useState<OperationProgressSnapshot | null>(null);
  const [launchpadWorkspaceCreateTarget, setLaunchpadWorkspaceCreateTarget] =
    useState<WorkspaceCreateResult | null>(null);
  const recentCreatedAgentTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const agentCreationWarningTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
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
  const [updateCapabilityDiff, setUpdateCapabilityDiff] = useState<OpenClawCapabilityDiffReport | null>(null);
  const [updateCertificationScorecard, setUpdateCertificationScorecard] =
    useState<OpenClawCertificationScorecardReport | null>(null);
  const [updateTargetVersion, setUpdateTargetVersion] = useState<string | null>(null);
  const [updateMode, setUpdateMode] = useState<"recommended" | "candidate" | "advanced">("recommended");
  const [onboardingRunState, setOnboardingRunState] = useState<UpdateRunState>("idle");
  const [onboardingPhase, setOnboardingPhase] = useState<OpenClawOnboardingPhase | null>(null);
  const [onboardingStatusMessage, setOnboardingStatusMessage] = useState<string | null>(null);
  const [onboardingResultMessage, setOnboardingResultMessage] = useState<string | null>(null);
  const [onboardingLog, setOnboardingLog] = useState("");
  const [onboardingManualCommand, setOnboardingManualCommand] = useState<string | null>(null);
  const [onboardingDocsUrl, setOnboardingDocsUrl] = useState<string | null>(null);
  const [onboardingStage, setOnboardingStage] = useState<OnboardingWizardStage>("system");

  useEffect(() => {
    if (typeof window === "undefined" || updateCapabilityDiff) {
      return;
    }

    const stored = window.localStorage.getItem(openClawCapabilityDiffStorageKey);
    if (!stored) {
      return;
    }

    try {
      setUpdateCapabilityDiff(JSON.parse(stored) as OpenClawCapabilityDiffReport);
    } catch {
      window.localStorage.removeItem(openClawCapabilityDiffStorageKey);
    }
  }, [updateCapabilityDiff]);

  useEffect(() => {
    if (typeof window === "undefined" || !updateCapabilityDiff) {
      return;
    }

    window.localStorage.setItem(openClawCapabilityDiffStorageKey, JSON.stringify(updateCapabilityDiff));
  }, [updateCapabilityDiff]);

  useEffect(() => {
    if (typeof window === "undefined" || updateCertificationScorecard) {
      return;
    }

    const stored = window.localStorage.getItem(openClawCertificationScorecardStorageKey);
    if (!stored) {
      return;
    }

    try {
      setUpdateCertificationScorecard(JSON.parse(stored) as OpenClawCertificationScorecardReport);
    } catch {
      window.localStorage.removeItem(openClawCertificationScorecardStorageKey);
    }
  }, [updateCertificationScorecard]);

  useEffect(() => {
    if (typeof window === "undefined" || !updateCertificationScorecard) {
      return;
    }

    window.localStorage.setItem(openClawCertificationScorecardStorageKey, JSON.stringify(updateCertificationScorecard));
  }, [updateCertificationScorecard]);
  const [selectedOnboardingModelId, setSelectedOnboardingModelId] = useState<string>("");
  const [selectedOnboardingThinking, setSelectedOnboardingThinking] = useState<OpenClawThinkingLevel>(ONBOARDING_DEFAULT_THINKING);
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredModelCandidate[]>([]);
  const [modelOnboardingRunState, setModelOnboardingRunState] = useState<UpdateRunState>("idle");
  const [modelOnboardingPhase, setModelOnboardingPhase] = useState<OpenClawModelOnboardingPhase | null>(null);
  const [modelOnboardingStatusMessage, setModelOnboardingStatusMessage] = useState<string | null>(null);
  const [modelOnboardingResultMessage, setModelOnboardingResultMessage] = useState<string | null>(null);
  const [modelOnboardingLog, setModelOnboardingLog] = useState("");
  const [modelOnboardingManualCommand, setModelOnboardingManualCommand] = useState<string | null>(null);
  const [modelOnboardingDocsUrl, setModelOnboardingDocsUrl] = useState<string | null>(null);
  const [chatGptBrowserAuth, setChatGptBrowserAuth] = useState<ChatGptBrowserAuthSnapshot | null>(null);
  const [modelSwitchFeedback, setModelSwitchFeedback] =
    useState<ModelSwitchFeedback>(initialModelSwitchFeedback);
  const [isOnboardingDismissed, setIsOnboardingDismissed] = useState(false);
  const [isOnboardingForcedOpen, setIsOnboardingForcedOpen] = useState(false);
  const [onboardingSessionKey, setOnboardingSessionKey] = useState(0);
  const [showOnboardingReadyState, setShowOnboardingReadyState] = useState(false);
  const [requiresFreshInstallSystemSetup, setRequiresFreshInstallSystemSetup] = useState(false);
  const [hasSeenMissionReady, setHasSeenMissionReady] = useState(false);
  const [gatewayControlAction, setGatewayControlAction] = useState<GatewayControlAction | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [isAddModelsDialogOpen, setIsAddModelsDialogOpen] = useState(false);
  const [returnToAgentModelId, setReturnToAgentModelId] = useState<string | null>(null);
  const [isSidebarCreateAgentDialogOpen, setIsSidebarCreateAgentDialogOpen] = useState(false);
  const [isSidebarAgentActionModalOpen, setIsSidebarAgentActionModalOpen] = useState(false);
  const [initialAddModelsProvider, setInitialAddModelsProvider] = useState<AddModelsProviderId | null>(null);

  useEffect(() => {
    if (isSidebarCreateAgentDialogOpen && !isSidebarPinned) {
      setIsSidebarOpen(false);
    }
  }, [isSidebarCreateAgentDialogOpen, isSidebarPinned]);

  const handleSidebarPinToggle = useCallback(() => {
    if (window.matchMedia("(max-width: 1023px)").matches) {
      setIsSidebarOpen(false);
      return;
    }

    setIsSidebarPinned((current) => {
      const nextPinned = !current;
      setIsSidebarOpen(nextPinned);
      return nextPinned;
    });
  }, [setIsSidebarPinned]);

  const isSidebarHoverLocked =
    isSidebarPinned || isSidebarCreateAgentDialogOpen || isSidebarAgentActionModalOpen;

  const [pendingWorkspaceOpenId, setPendingWorkspaceOpenId] = useState<string | null>(null);
  const [loadedWorkspaceSelectionRoot, setLoadedWorkspaceSelectionRoot] = useState<string | null>(null);
  const fallbackSnapshotRecoveryKeyRef = useRef<string | null>(null);
  const hydratedOnboardingModelIdRef = useRef<string | null>(null);
  const modelOperationToastIdRef = useRef<string | number | null>(null);
  const modelAuthTerminalAutoOpenRef = useRef<{ command: string; openedAt: number } | null>(null);
  const modelAuthStatusPollRunRef = useRef(0);
  const chatGptOnboardingRunRef = useRef<Promise<void> | null>(null);
  const updateOperationToastIdRef = useRef<string | number | null>(null);
  const {
    recentDispatchId,
    setRecentDispatchId,
    optimisticMissionTasks,
    setOptimisticMissionTasks,
    taskAbortRequest,
    setTaskAbortRequest,
    taskAbortRunState,
    setTaskAbortRunState,
    taskAbortMessage,
    setTaskAbortMessage,
    requestTaskAbort,
    inspectTask,
    updateActiveTaskCard
  } = useMissionControlTaskActions({
    selectedNodeId,
    setActiveTaskCardContext,
    selectNode,
    setIsInspectorOpen
  });
  const {
    taskReviewRequest,
    taskReviewState,
    clearTaskReviewState,
    openTaskReview,
    closeTaskReview,
    acceptTaskReview,
    dismissTaskReview,
    continueTaskReview,
    retryTaskReview,
    openTaskReviewEvidence
  } = useTaskReviewWorkflow({
    selectNode,
    setIsInspectorOpen,
    setComposeIntent: (intent) => {
      setIsComposerVisible(true);
      setComposeIntent(intent);
    },
    setComposerTargetAgentId,
    setIsComposerActive,
    refreshSnapshot
  });
  const activeChatAgentId =
    isInspectorOpen && activeInspectorTab === "chat" ? selectedNodeId : null;
  const uiSnapshot = useMemo(() => {
    const mergedSnapshot = mergeSnapshotWithOptimisticTasks(snapshot, optimisticMissionTasks);
    return applyTaskReviewStateToSnapshot(mergedSnapshot, taskReviewState);
  }, [snapshot, optimisticMissionTasks, taskReviewState]);
  const selectedWorkspace = selectedNodeId
    ? uiSnapshot.workspaces.find((workspace) => workspace.id === selectedNodeId) ?? null
    : null;
  const activeWorkspaceForDialogs = useMemo(
    () =>
      uiSnapshot.workspaces.find((workspace) => workspace.id === (activeWorkspaceId ?? uiSnapshot.workspaces[0]?.id ?? null)) ??
      null,
    [activeWorkspaceId, uiSnapshot.workspaces]
  );
  const selectedAgent = selectedNodeId
    ? uiSnapshot.agents.find((agent) => agent.id === selectedNodeId) ?? null
    : null;
  const selectedTask = selectedNodeId
    ? uiSnapshot.tasks.find((task) => task.id === selectedNodeId) ?? null
    : null;
  const selectedRuntime = selectedNodeId
    ? uiSnapshot.runtimes.find((runtime) => runtime.id === selectedNodeId) ?? null
    : null;
  const selectedRuntimeTask = selectedRuntime?.taskId
    ? uiSnapshot.tasks.find((task) => task.id === selectedRuntime.taskId) ?? null
    : null;
  const {
    focusedAgentId,
    setFocusedAgentId,
    agentActionRequest,
    setAgentActionRequest,
    capabilityEditorRequest,
    setCapabilityEditorRequest,
    agentModelRequest,
    setAgentModelRequest,
    contextEngineAgentId,
    handleFocusAgent,
    handleInspectAgentDetail,
    handleConfigureAgentCapabilities,
    handleConfigureAgentModel,
    openAgentContextEngine,
    handleContextEngineOpenChange
  } = useMissionControlAgentActions({
    agents: uiSnapshot.agents,
    selectNode,
    setActiveWorkspaceId,
    setIsInspectorOpen,
    onClearComposerTarget: () => setComposerTargetAgentId(null)
  });

  useEffect(() => {
    if (agentActionRequest) {
      setIsSidebarOpen(false);
    }
  }, [agentActionRequest]);

  const activeTaskCardTaskId = activeTaskCardContext?.taskId ?? null;
  const selectInspectorScope = useCallback(
    (scope: InspectorScopeShortcut) => {
      const findWorkspace = (workspaceId: string | null) => {
        if (!workspaceId) {
          return null;
        }

        return uiSnapshot.workspaces.find((workspace) => workspace.id === workspaceId) ?? null;
      };
      const findAgent = (agentId: string | null) => {
        if (!agentId) {
          return null;
        }

        return uiSnapshot.agents.find((agent) => agent.id === agentId) ?? null;
      };
      const findTask = (taskId: string | null) => {
        if (!taskId) {
          return null;
        }

        return uiSnapshot.tasks.find((task) => task.id === taskId) ?? null;
      };
      const sortTasksByFreshness = (tasks: typeof uiSnapshot.tasks) =>
        [...tasks].sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
      const workspaceIdForSelection =
        selectedWorkspace?.id ??
        selectedTask?.workspaceId ??
        selectedRuntime?.workspaceId ??
        selectedAgent?.workspaceId ??
        activeWorkspaceId ??
        uiSnapshot.workspaces[0]?.id ??
        null;

      if (scope === "workspace") {
        const workspace =
          findWorkspace(workspaceIdForSelection) ??
          findWorkspace(selectedRuntime?.workspaceId ?? null) ??
          findWorkspace(selectedAgent?.workspaceId ?? null) ??
          findWorkspace(selectedTask?.workspaceId ?? null) ??
          uiSnapshot.workspaces[0] ??
          null;

        if (!workspace) {
          return;
        }

        setActiveWorkspaceId(workspace.id);
        selectNode(workspace.id);
        setIsInspectorOpen(true);
        return;
      }

      if (scope === "agent") {
        const targetAgent =
          selectedAgent ??
          findAgent(selectedTask?.primaryAgentId ?? null) ??
          findAgent(selectedTask?.agentIds[0] ?? null) ??
          findAgent(selectedRuntime?.agentId ?? null) ??
          findAgent(focusedAgentId) ??
          uiSnapshot.agents.find((agent) => agent.workspaceId === workspaceIdForSelection) ??
          uiSnapshot.agents[0] ??
          null;

        if (!targetAgent) {
          return;
        }

        setActiveWorkspaceId(targetAgent.workspaceId);
        selectNode(targetAgent.id);
        setIsInspectorOpen(true);
        return;
      }

      const scopedTasks = sortTasksByFreshness(
        uiSnapshot.tasks.filter((task) =>
          workspaceIdForSelection ? resolveTaskWorkspaceId(task, uiSnapshot.agents) === workspaceIdForSelection : true
        )
      );
      const targetTask =
        selectedTask ??
        selectedRuntimeTask ??
        findTask(activeTaskCardTaskId) ??
        scopedTasks[0] ??
        sortTasksByFreshness(uiSnapshot.tasks)[0] ??
        null;

      if (!targetTask) {
        return;
      }

      const taskWorkspaceId =
        resolveTaskWorkspaceId(targetTask, uiSnapshot.agents) ?? targetTask.workspaceId ?? workspaceIdForSelection;

      if (taskWorkspaceId) {
        setActiveWorkspaceId(taskWorkspaceId);
      }

      selectNode(targetTask.id);
      setIsInspectorOpen(true);
    },
    [
      activeTaskCardTaskId,
      activeWorkspaceId,
      focusedAgentId,
      selectNode,
      selectedAgent,
      selectedRuntime,
      selectedRuntimeTask,
      selectedTask,
      setActiveWorkspaceId,
      selectedWorkspace,
      uiSnapshot
    ]
  );
  const activeTaskReviewTask = useMemo(() => {
    if (!taskReviewRequest) {
      return null;
    }

    return (
      uiSnapshot.tasks.find(
        (task) =>
          task.id === taskReviewRequest.taskId || resolveTaskReviewKey(task) === taskReviewRequest.taskKey
      ) ?? taskReviewRequest.fallbackTask
    );
  }, [taskReviewRequest, uiSnapshot.tasks]);
  const [capabilitiesRevision, setCapabilitiesRevision] = useState(0);
  const openWorkspaceOnCanvas = useCallback(
    (workspaceId: string | null, options: { markPending?: boolean } = {}) => {
      if (options.markPending && workspaceId) {
        setPendingWorkspaceOpenId(workspaceId);
      }

      setFocusedAgentId(null);
      setComposerTargetAgentId(null);
      setActiveWorkspaceId(workspaceId);
      selectNode(workspaceId);
    },
    [selectNode, setActiveWorkspaceId, setFocusedAgentId]
  );
  const openWorkspaceContextEngine = useCallback(
    (workspaceId: string) => {
      const targetAgent = resolveWorkspaceContextEngineAgent(uiSnapshot.agents, workspaceId);

      if (!targetAgent) {
        openWorkspaceOnCanvas(workspaceId);
        toast.error("Context Engine needs a workspace agent.", {
          description: "Create or connect an agent in this workspace before managing its context."
        });
        return;
      }

      openAgentContextEngine(targetAgent.id);
    },
    [openAgentContextEngine, openWorkspaceOnCanvas, uiSnapshot.agents]
  );
  const {
    isWorkspaceWizardOpen,
    workspaceWizardInitialMode,
    workspaceWizardEditId,
    openWorkspaceWizard,
    openWorkspaceWizardForEdit,
    handleWorkspaceWizardOpenChange,
    isWorkspaceChannelsOpen,
    setIsWorkspaceChannelsOpen,
    workspaceChannelsInitialAgentId,
    setWorkspaceChannelsInitialAgentId,
    workspaceChannelsInitialSection,
    setWorkspaceChannelsInitialSection,
    openWorkspaceChannels,
    openAccountsConnect,
    isConnectAccountDialogOpen,
    setIsConnectAccountDialogOpen,
    accountBrowserProfiles,
    accountBrowserProfilesError,
    accountBrowserProfileRecoveryBusy,
    accountSecureBrowserCapabilities,
    accountTargets,
    setAccountTargets,
    accountAccessRules,
    setAccountAccessRules,
    loadAccountBrowserProfiles,
    openConnectAccountDialog,
    restartGatewayForAccountProfiles,
    connectAccount,
    connectSecureBrowserAccount
  } = useMissionControlWorkspaceActions({
    activeWorkspace: activeWorkspaceForDialogs,
    openWorkspaceOnCanvas
  });
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const canvasNodeInteractionActiveRef = useRef(false);
  const pendingComposerBlurRef = useRef(false);
  const activeRuntimeCount = snapshot.runtimes.filter(
    (runtime) =>
      (runtime.status === "running" || runtime.status === "queued") && !isDirectChatRuntime(runtime)
  ).length;
  const isOpenClawOnboardingSystemReady =
    !requiresFreshInstallSystemSetup && resolveOpenClawSystemReady(snapshot);
  const isOpenClawOnboardingModelReady =
    !requiresFreshInstallSystemSetup && resolveOpenClawModelReady(snapshot);
  const effectiveOnboardingStage = resolveEffectiveWizardStage(
    onboardingStage,
    isOpenClawOnboardingSystemReady || onboardingRunState === "success"
  );
  const hasWorkspaceSetup = hasAgentOSWorkspaceSetup(snapshot);
  const openClawInstallSummary = resolveOpenClawInstallSummary(snapshot);
  const onboardingAction = resolveOnboardingAction(snapshot, {
    cliInstalled,
    gatewayRegistered,
    gatewayConfigured,
    gatewayReady,
    runtimeWritable
  });
  const hasActiveMissionWork = activeRuntimeCount > 0 || optimisticMissionTasks.length > 0;
  const shouldShowLaunchpadReadyState = shouldShowOnboardingLaunchpad(snapshot, {
    hasSeenMissionReady,
    modelSwitchSucceeded: modelSwitchFeedback.phase === "success"
  });
  const onboardingAiReady = isOnboardingModelStepComplete({
    chatGptConnectionReady: isChatGptConnectionReady(snapshot),
    explicitSetupComplete: showOnboardingReadyState || modelSwitchFeedback.phase === "success"
  });
  const needsWorkspaceSetup =
    isOpenClawOnboardingSystemReady &&
    isOpenClawOnboardingModelReady &&
    !hasWorkspaceSetup;
  const isOnboardingFullyReady =
    isOpenClawOnboardingSystemReady &&
    isOpenClawOnboardingModelReady &&
    hasWorkspaceSetup;
  const shouldAutoShowOnboarding =
    !hasActiveMissionWork &&
    (!isOnboardingDismissed || needsWorkspaceSetup) &&
    (!isOpenClawOnboardingModelReady || needsWorkspaceSetup) &&
    !shouldShowLaunchpadReadyState;
  const shouldShowOnboarding =
    !isAddModelsDialogOpen &&
    (shouldAutoShowOnboarding || showOnboardingReadyState || isOnboardingForcedOpen);
  const scopedTasks = uiSnapshot.tasks.filter(
    (task) => !activeWorkspaceId || resolveTaskWorkspaceId(task, uiSnapshot.agents) === activeWorkspaceId
  );
  const hiddenScopedTaskCount = scopedTasks.filter((task) =>
    isTaskHiddenByPreferences(task, safeHiddenRuntimeIds, safeHiddenTaskKeys, safeLockedTaskKeys)
  ).length;
  const toggleWorkspaceTaskCards = useCallback(
    (workspaceId: string) => {
      const workspaceTasks = uiSnapshot.tasks.filter(
        (task) => resolveTaskWorkspaceId(task, uiSnapshot.agents) === workspaceId
      );
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
    [
      uiSnapshot.agents,
      uiSnapshot.tasks,
      safeHiddenRuntimeIds,
      safeHiddenTaskKeys,
      safeLockedTaskKeys,
      setHiddenRuntimeIds,
      setHiddenTaskKeys
    ]
  );

  const handleCreatedAgentVisible = useCallback((agentId: string) => {
    setPendingCreatedAgents((current) => current.filter((agent) => agent.id !== agentId));
    setRecentCreatedAgentId(agentId);

    if (recentCreatedAgentTimeoutRef.current) {
      clearTimeout(recentCreatedAgentTimeoutRef.current);
    }

    recentCreatedAgentTimeoutRef.current = setTimeout(() => {
      recentCreatedAgentTimeoutRef.current = null;
      setRecentCreatedAgentId(null);
    }, 2400);
  }, []);

  const handleAgentCreationPending = useCallback((agent: PendingAgentProjection) => {
    setActiveWorkspaceId(agent.workspaceId);
    selectNode(agent.id);
    setPendingCreatedAgents((current) => [
      ...current.filter((entry) => entry.id !== agent.id),
      agent
    ]);

    if (agent.warning) {
      setAgentCreationWarnings((current) => ({
        ...current,
        [agent.id]: agent.warning ?? ""
      }));

      const existingTimeout = agentCreationWarningTimeoutsRef.current.get(agent.id);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }

      const timeout = setTimeout(() => {
        agentCreationWarningTimeoutsRef.current.delete(agent.id);
        setAgentCreationWarnings((current) => {
          const next = { ...current };
          delete next[agent.id];
          return next;
        });
      }, 12000);
      agentCreationWarningTimeoutsRef.current.set(agent.id, timeout);
    }
  }, [selectNode, setActiveWorkspaceId]);

  const handleWorkspaceCreated = useCallback((result: WorkspaceCreateResult | WorkspacePlanDeployResult) => {
    setPendingWorkspaceCreations([]);
    const pendingAgents = buildPendingAgentsForWorkspaceResult(result);

    if (pendingAgents.length > 0) {
      const pendingAgentIds = new Set(pendingAgents.map((agent) => agent.id));
      setPendingCreatedAgents((current) => [
        ...current.filter((agent) => !pendingAgentIds.has(agent.id)),
        ...pendingAgents
      ]);
    }

    openWorkspaceOnCanvas(result.workspaceId, { markPending: true });
  }, [openWorkspaceOnCanvas]);

  const handleWorkspaceCreationStarted = useCallback((workspace: { id: string; name: string; createdAt: number }) => {
    setPendingWorkspaceCreations([{
      ...workspace,
      detail: "Creating workspace",
      pending: true
    }]);
    setIsSidebarOpen(true);
  }, []);

  const handleWorkspaceCreationFinished = useCallback(() => {
    setPendingWorkspaceCreations([]);
  }, []);

  useEffect(() => {
    if (typeof globalThis.localStorage === "undefined") {
      return;
    }

    if (pendingCreatedAgents.length === 0) {
      globalThis.localStorage.removeItem(pendingAgentProjectionStorageKey);
      return;
    }

    globalThis.localStorage.setItem(pendingAgentProjectionStorageKey, JSON.stringify(pendingCreatedAgents));
  }, [pendingCreatedAgents]);

  useEffect(() => {
    if (pendingCreatedAgents.length === 0) {
      return;
    }

    const liveAgentIds = new Set(uiSnapshot.agents.map((agent) => agent.id));
    if (!pendingCreatedAgents.some((agent) => liveAgentIds.has(agent.id))) {
      return;
    }

      setPendingCreatedAgents((current) => current.filter((agent) => !liveAgentIds.has(agent.id)));
  }, [pendingCreatedAgents, uiSnapshot.agents]);

  useEffect(() => {
    const warningTimeouts = agentCreationWarningTimeoutsRef.current;

    return () => {
      warningTimeouts.forEach((timeout) => clearTimeout(timeout));
      warningTimeouts.clear();
    };
  }, [setSnapshot]);

  const handleAgentModelPickerOpenChange = useCallback((open: boolean) => {
    if (open) {
      return;
    }

    setAgentModelRequest(null);
  }, [setAgentModelRequest]);

  const handleCapabilityEditorOpenChange = useCallback((open: boolean) => {
    if (open) {
      return;
    }

    setCapabilityEditorRequest(null);
  }, [setCapabilityEditorRequest]);

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
    [activeWorkspaceId, focusedAgentId, selectNode, selectedNodeId, setActiveWorkspaceId, setFocusedAgentId, uiSnapshot.agents]
  );

  const handleCreateTaskAgent = useCallback(
    (agentId: string) => {
      const agent = uiSnapshot.agents.find((entry) => entry.id === agentId);

      if (!agent) {
        return;
      }

      setActiveWorkspaceId(agent.workspaceId);
      setComposerTargetAgentId(agent.id);
      setIsComposerVisible(true);
      setIsComposerActive(true);
      selectNode(agent.id);
    },
    [selectNode, setActiveWorkspaceId, uiSnapshot.agents]
  );

  const handleCanvasNodePointerDownCapture = useCallback(() => {
    canvasNodeInteractionActiveRef.current = true;
  }, []);

  const handleComposerActiveChange = useCallback(
    (active: boolean) => {
      if (active) {
        pendingComposerBlurRef.current = false;
        setIsComposerVisible(true);
        setIsComposerActive(true);
        return;
      }

      if (canvasNodeInteractionActiveRef.current) {
        pendingComposerBlurRef.current = true;
        return;
      }

      pendingComposerBlurRef.current = false;
      setIsComposerVisible(false);
      setIsComposerActive(false);
    },
    []
  );

  const handleResetFocus = useCallback(() => {
    setFocusedAgentId(null);
    selectNode(activeWorkspaceId ?? uiSnapshot.workspaces[0]?.id ?? null);
  }, [activeWorkspaceId, selectNode, setFocusedAgentId, uiSnapshot.workspaces]);

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
      setIsComposerVisible(false);
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
      modelAuthStatusPollRunRef.current += 1;

      if (recentCreatedAgentTimeoutRef.current) {
        clearTimeout(recentCreatedAgentTimeoutRef.current);
        recentCreatedAgentTimeoutRef.current = null;
      }
    };
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
    setActiveWorkspaceId,
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
      .filter((entry): entry is { entry: OptimisticMissionTask; replacement: WorkItemRecord } => Boolean(entry.replacement));

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
  }, [
    optimisticMissionTasks,
    selectedNodeId,
    setActiveWorkspaceId,
    setOptimisticMissionTasks,
    setSelectedNodeId,
    snapshot.tasks
  ]);

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

    if (resolvedWorkspaceId !== activeWorkspaceId) {
      setActiveWorkspaceId(resolvedWorkspaceId);
      setSelectedNodeId(resolvedWorkspaceId ?? null);
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
  }, [focusedAgentId, setFocusedAgentId, uiSnapshot.agents]);

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
  }, [recentDispatchId, setRecentDispatchId, snapshot.tasks, selectNode]);

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
  }, [setOptimisticMissionTasks, snapshot.tasks]);

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

    const previousHydratedModelId = hydratedOnboardingModelIdRef.current;
    hydratedOnboardingModelIdRef.current = preferredModelId;
    setSelectedOnboardingModelId((currentModelId) => {
      const normalizedCurrentModelId = currentModelId.trim();

      if (!normalizedCurrentModelId || normalizedCurrentModelId === previousHydratedModelId) {
        return preferredModelId;
      }

      return currentModelId;
    });
  }, [
    snapshot
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
    if (onboardingStage === "models" && !isOpenClawOnboardingSystemReady && onboardingRunState !== "success") {
      setOnboardingStage("system");
      return;
    }

    if (onboardingRunState === "success" || isOpenClawOnboardingSystemReady) {
      setOnboardingStage("models");
      return;
    }

    if (modelOnboardingRunState === "running" || modelOnboardingRunState === "success") {
      return;
    }
  }, [isOpenClawOnboardingSystemReady, modelOnboardingRunState, onboardingRunState, onboardingStage]);

  useEffect(() => {
    if (isOnboardingDismissed) {
      setShowOnboardingReadyState(false);
      return;
    }

    if (modelSwitchFeedback.phase === "success") {
      setHasSeenMissionReady(true);
      setOnboardingStage(isOpenClawOnboardingSystemReady ? "models" : "system");
      setShowOnboardingReadyState(isOpenClawOnboardingSystemReady);
      return;
    }

    setShowOnboardingReadyState(false);
  }, [isOnboardingDismissed, isOpenClawOnboardingSystemReady, modelSwitchFeedback.phase]);

  const resetUpdateDialogState = () => {
    if (updateRunState === "running") {
      return;
    }

    setUpdateRunState("idle");
    setUpdateStatusMessage(null);
    setUpdateResultMessage(null);
    setUpdateLog("");
    setUpdateManualCommand(null);
    setUpdateTargetVersion(null);
    setUpdateMode("recommended");
  };

  const resetOnboardingProgressState = () => {
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
    setSelectedOnboardingThinking(ONBOARDING_DEFAULT_THINKING);
    setModelSwitchFeedback(initialModelSwitchFeedback);
    setShowOnboardingReadyState(false);
    setHasSeenMissionReady(false);
    setLaunchpadWorkspaceCreateRunState("idle");
    setLaunchpadWorkspaceCreateProgress(null);
    hydratedOnboardingModelIdRef.current = null;
  };

  const resetFreshInstallOnboardingState = () => {
    resetOnboardingProgressState();
    setRequiresFreshInstallSystemSetup(true);
    setOnboardingStage("system");
    setIsOnboardingDismissed(false);
    setIsOnboardingForcedOpen(true);
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

  const hydrateOnboardingModelSelection = useCallback((
    nextSnapshot: MissionControlSnapshot,
    options: { force?: boolean } = {}
  ) => {
    const preferredModelId = resolveInitialOnboardingModelId(nextSnapshot);

    if (!preferredModelId) {
      return;
    }

    const previousHydratedModelId = hydratedOnboardingModelIdRef.current;
    hydratedOnboardingModelIdRef.current = preferredModelId;
    setSelectedOnboardingModelId((currentModelId) => {
      const normalizedCurrentModelId = currentModelId.trim();

      if (
        options.force ||
        !normalizedCurrentModelId ||
        normalizedCurrentModelId === previousHydratedModelId
      ) {
        return preferredModelId;
      }

      return currentModelId;
    });
  }, []);

  const refreshOnboardingModelSnapshot = useCallback(async (fallbackSnapshot?: MissionControlSnapshot | null) => {
    const immediateSnapshot = fallbackSnapshot ?? null;

    if (immediateSnapshot) {
      setSnapshot(immediateSnapshot);
      hydrateOnboardingModelSelection(immediateSnapshot);

      void refreshSnapshot({ force: true })
        .then((refreshedSnapshot) => {
          setSnapshot(refreshedSnapshot);
          hydrateOnboardingModelSelection(refreshedSnapshot);
        })
        .catch(() => {
          // The lightweight stream will continue refreshing model state.
        });

      return immediateSnapshot;
    }

    try {
      const refreshedSnapshot = await refreshSnapshot({ force: true });
      setSnapshot(refreshedSnapshot);
      hydrateOnboardingModelSelection(refreshedSnapshot);
      return refreshedSnapshot;
    } catch {
      return null;
    }
  }, [
    hydrateOnboardingModelSelection,
    refreshSnapshot,
    setSnapshot
  ]);

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
  }, [
    optimisticMissionTasks,
    refresh,
    setOptimisticMissionTasks,
    setTaskAbortMessage,
    setTaskAbortRequest,
    setTaskAbortRunState,
    taskAbortRequest,
    taskAbortRunState
  ]);

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

  const runOpenClawUpdate = async (action: "update" | "rollback" | "certify-round-trip" = "update") => {
    if (updateRunState === "running") {
      setIsUpdateDialogOpen(true);
      return;
    }

    const updateUpdateToast = (description: string) => {
      updateOperationToastIdRef.current = toast.loading(
        action === "certify-round-trip" ? "Certifying OpenClaw..." : "Updating OpenClaw...",
        {
        id: updateOperationToastIdRef.current ?? undefined,
        description,
        duration: Infinity,
        action: {
          label: "View",
          onClick: () => setIsUpdateDialogOpen(true)
        }
        }
      );
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
        toast.success(action === "certify-round-trip" ? "OpenClaw certification completed." : "OpenClaw updated.", toastOptions);
      } else {
        toast.error(action === "certify-round-trip" ? "OpenClaw certification failed." : "OpenClaw update failed.", toastOptions);
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
    setUpdateStatusMessage(
      action === "rollback"
        ? "Starting OpenClaw rollback..."
        : action === "certify-round-trip"
          ? "Starting OpenClaw certification round-trip..."
          : "Starting OpenClaw update..."
    );
    setUpdateResultMessage(null);
    setUpdateLog("");
    setUpdateManualCommand(null);
    setUpdateCapabilityDiff(null);
    setUpdateCertificationScorecard(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(openClawCapabilityDiffStorageKey);
      window.localStorage.removeItem(openClawCertificationScorecardStorageKey);
    }
    updateUpdateToast(
      action === "rollback"
        ? "Starting OpenClaw rollback..."
        : action === "certify-round-trip"
          ? "Starting OpenClaw certification round-trip..."
          : "Starting OpenClaw update..."
    );

    try {
      const response = await fetch("/api/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action,
          confirmed: true,
          ...(action === "update" || action === "certify-round-trip"
            ? {
                targetVersion: updateTargetVersion ?? snapshot.diagnostics.updateCompatibility?.recommendedVersion,
                mode: updateMode,
                rollbackPolicy: "manual"
              }
            : {})
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
              setUpdateCapabilityDiff(event.capabilityDiff ?? null);
              setUpdateCertificationScorecard(event.certificationScorecard ?? null);

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
          setUpdateCapabilityDiff(event.capabilityDiff ?? null);
          setUpdateCertificationScorecard(event.certificationScorecard ?? null);

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

  const runOpenClawOnboarding = async (
    requestedIntent?: "install" | "prepare" | "start"
  ): Promise<void> => {
    const setupIntent = requestedIntent ?? (
      onboardingAction.label === "Install OpenClaw"
        ? "install"
        : onboardingAction.label === "Prepare local gateway"
          ? "prepare"
          : "start"
    );
    const isContinuation = requestedIntent != null;
    const setupStepNumber = setupIntent === "install" ? 1 : setupIntent === "prepare" ? 2 : 3;
    const setupStepLabel = setupIntent === "install"
      ? "Install OpenClaw"
      : setupIntent === "prepare"
        ? "Prepare local Gateway"
        : "Start and verify Gateway";
    const initialStatusMessage = setupIntent === "install"
      ? "Checking OpenClaw CLI..."
      : setupIntent === "prepare"
        ? "Checking Gateway configuration..."
        : "Starting OpenClaw Gateway...";
    setIsOnboardingDismissed(false);
    setIsOnboardingForcedOpen(true);
    if (!isContinuation) {
      resetOnboardingProgressState();
    }
    setOnboardingStage("system");
    setOnboardingRunState("running");
    setOnboardingPhase(
      setupIntent === "install"
        ? "detecting"
        : setupIntent === "prepare"
          ? "installing-gateway"
          : "starting-gateway"
    );
    setOnboardingStatusMessage(initialStatusMessage);
    setOnboardingResultMessage(null);
    setOnboardingManualCommand(null);
    setOnboardingDocsUrl(null);
    if (isContinuation) {
      appendOnboardingLog(`\n[${setupStepNumber}/3] ${setupStepLabel}\n`);
    } else {
      setOnboardingLog(`[${setupStepNumber}/3] ${setupStepLabel}\n`);
    }

    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          intent: setupIntent
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
      let nextSetupIntent: "prepare" | "start" | null = null;

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
              const stepCompleted = event.ok && event.phase !== "ready";
              if (stepCompleted) {
                nextSetupIntent = setupIntent === "install"
                  ? "prepare"
                  : setupIntent === "prepare"
                    ? "start"
                    : null;
              }
              setOnboardingPhase(event.phase);
              setOnboardingResultMessage(event.message);
              setOnboardingManualCommand(event.manualCommand ?? null);
              setOnboardingDocsUrl(event.docsUrl ?? null);
              if (stepCompleted) {
                if (event.snapshot) {
                  setSnapshot(event.snapshot);
                }
                setRequiresFreshInstallSystemSetup(false);
              } else if (event.ok) {
                if (event.snapshot) {
                  setSnapshot(event.snapshot);
                }
                setRequiresFreshInstallSystemSetup(false);
              } else {
                setOnboardingStatusMessage(null);
                if (event.snapshot) {
                  setSnapshot(event.snapshot);
                }
              }
              setOnboardingStatusMessage(null);
              setOnboardingRunState(stepCompleted ? "idle" : event.ok ? "success" : "error");

              if (stepCompleted) {
                toast.success(setupIntent === "install" ? "OpenClaw installed." : "Local Gateway prepared.", {
                  description: event.message
                });
              } else if (event.ok) {
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
          const stepCompleted = event.ok && event.phase !== "ready";
          if (stepCompleted) {
            nextSetupIntent = setupIntent === "install"
              ? "prepare"
              : setupIntent === "prepare"
                ? "start"
                : null;
          }
          setOnboardingPhase(event.phase);
          setOnboardingResultMessage(event.message);
          setOnboardingManualCommand(event.manualCommand ?? null);
          setOnboardingDocsUrl(event.docsUrl ?? null);
          if (stepCompleted) {
            if (event.snapshot) {
              setSnapshot(event.snapshot);
            }
            setRequiresFreshInstallSystemSetup(false);
          } else if (event.ok) {
            if (event.snapshot) {
              setSnapshot(event.snapshot);
            }
            setRequiresFreshInstallSystemSetup(false);
          } else {
            setOnboardingStatusMessage(null);
            if (event.snapshot) {
              setSnapshot(event.snapshot);
            }
          }
          setOnboardingStatusMessage(null);
          setOnboardingRunState(stepCompleted ? "idle" : event.ok ? "success" : "error");
        }
      }

      if (!sawDone) {
        throw new Error("OpenClaw onboarding stream ended unexpectedly.");
      }

      if (nextSetupIntent) {
        await runOpenClawOnboarding(nextSetupIntent);
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

  const readModelProviderStatus = async (
    provider: AddModelsProviderId,
    options: {
      includeSnapshot?: boolean;
      timeoutMs?: number;
      refreshAuth?: boolean;
      discover?: boolean;
    } = {}
  ) => {
    const abortController = options.timeoutMs ? new AbortController() : null;
    const timeoutId = options.timeoutMs
      ? globalThis.setTimeout(() => abortController?.abort(), options.timeoutMs)
      : null;

    try {
      const response = await fetch("/api/models/providers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "status",
          provider,
          includeSnapshot: options.includeSnapshot,
          refreshAuth: options.refreshAuth,
          discover: options.discover
        }),
        signal: abortController?.signal
      });
      const result = (await response.json().catch(() => null)) as
        | (AddModelsProviderActionResult & { error?: string })
        | null;

      if (!response.ok || !result) {
        throw new Error(result?.error || result?.message || "Provider status could not be loaded.");
      }

      return result;
    } finally {
      if (timeoutId) {
        globalThis.clearTimeout(timeoutId);
      }
    }
  };

  const waitForChatGptProviderStatus = async () => {
    let lastResult: Awaited<ReturnType<typeof readModelProviderStatus>> | null = null;
    let lastError: unknown = null;

    for (const [index, delayMs] of chatGptStatusRetryDelaysMs.entries()) {
      if (delayMs > 0) {
        await new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
      }

      try {
        const result = await readModelProviderStatus("openai", {
          includeSnapshot: true,
          refreshAuth: true,
          discover: true
        });
        lastResult = result;

        if (result.connection.connected) {
          return result;
        }
      } catch (error) {
        lastError = error;
      }

      if (index === chatGptStatusRetryDelaysMs.length - 1) {
        break;
      }
    }

    if (lastResult) {
      if (!lastResult.connection.connected && lastResult.message) {
        throw new Error(lastResult.message);
      }

      return lastResult;
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("OpenClaw could not refresh the ChatGPT account status yet.");
  };

  const markModelProviderConnected = (
    provider: AddModelsProviderId,
    detail?: string | null,
    connectedSnapshot?: MissionControlSnapshot,
    connectedResult?: AddModelsProviderActionResult
  ) => {
    const descriptor = getModelProviderDescriptor(provider);

    modelAuthStatusPollRunRef.current += 1;
    setOnboardingStage("models");
    setIsOnboardingForcedOpen(true);
    setIsOnboardingDismissed(false);
    setModelOnboardingPhase("ready");
    setModelOnboardingStatusMessage("Refreshing OpenClaw model status...");
    setModelOnboardingManualCommand(null);
    setModelOnboardingDocsUrl(null);

    if (connectedSnapshot) {
      setSnapshot(connectedSnapshot);
      hydrateOnboardingModelSelection(connectedSnapshot);
    } else {
      void refreshOnboardingModelSnapshot(null);
    }

    setModelOnboardingStatusMessage(null);
    setModelOnboardingRunState("success");
    const discoveryMessage = connectedResult?.discovery?.status === "failed"
      ? `${descriptor.shortLabel} is connected, but model discovery is temporarily unavailable. Retry discovery when OpenClaw is ready.`
      : connectedResult?.discovery?.status === "empty"
        ? `${descriptor.shortLabel} is connected, but OpenClaw returned no selectable models yet.`
        : `${descriptor.shortLabel} is connected. ${connectedResult?.models?.length ? `Found ${connectedResult.models.length} available model${connectedResult.models.length === 1 ? "" : "s"}.` : "You can discover or add models now."}`;
    setModelOnboardingResultMessage(discoveryMessage);
    appendModelOnboardingLog(`\n> ${descriptor.shortLabel} connected. AgentOS refreshed OpenClaw model status.\n`);
    toast.success(`${descriptor.shortLabel} connected.`, {
      description: detail || connectedResult?.discovery?.error || "AgentOS refreshed OpenClaw model status."
    });
  };

  const startModelProviderStatusPolling = (provider: AddModelsProviderId) => {
    const descriptor = getModelProviderDescriptor(provider);
    const runId = modelAuthStatusPollRunRef.current + 1;

    modelAuthStatusPollRunRef.current = runId;

    for (const [index, delayMs] of modelAuthStatusPollDelaysMs.entries()) {
      globalThis.setTimeout(() => {
        if (modelAuthStatusPollRunRef.current !== runId) {
          return;
        }

        void (async () => {
          try {
            const result = await readModelProviderStatus(provider);

            if (modelAuthStatusPollRunRef.current !== runId) {
              return;
            }

            if (result.connection.connected) {
              modelAuthStatusPollRunRef.current += 1;
              markModelProviderConnected(provider, result.connection.detail, result.snapshot);
              return;
            }

            if (index === modelAuthStatusPollDelaysMs.length - 1) {
              setModelOnboardingStatusMessage(null);
              setModelOnboardingResultMessage(
                `Still waiting for ${descriptor.shortLabel} auth. Finish the browser sign-in, then refresh models.`
              );
            }
          } catch {
            if (index === modelAuthStatusPollDelaysMs.length - 1) {
              setModelOnboardingStatusMessage(null);
            }
          }
        })();
      }, delayMs);
    }
  };

  const openModelOnboardingTerminal = async (command: string) => {
    const normalizedCommand = command.trim();

    if (!normalizedCommand) {
      return false;
    }

    const lastAutoOpen = modelAuthTerminalAutoOpenRef.current;
    const openedRecently =
      lastAutoOpen?.command === normalizedCommand &&
      Date.now() - lastAutoOpen.openedAt < modelAuthTerminalAutoOpenCooldownMs;

    if (openedRecently) {
      return false;
    }

    try {
      const response = await fetch("/api/system/open-terminal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          command: normalizedCommand
        })
      });

      const result = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok || result?.error) {
        throw new Error(result?.error || "Unable to open Terminal.");
      }

      modelAuthTerminalAutoOpenRef.current = {
        command: normalizedCommand,
        openedAt: Date.now()
      };

      toast.success("Terminal opened.", {
        description: "Finish provider auth there, then refresh models."
      });
      return true;
    } catch (error) {
      toast.error("Could not open Terminal.", {
        description: error instanceof Error ? error.message : "Open Terminal manually and run the command."
      });
      return false;
    }
  };

  const runModelOnboarding = async (
    payload:
      | { intent: Extract<ModelOnboardingIntent, "auto">; modelId?: string }
      | { intent: Extract<ModelOnboardingIntent, "refresh"> }
      | { intent: Extract<ModelOnboardingIntent, "discover"> }
      | { intent: Extract<ModelOnboardingIntent, "set-default">; modelId: string }
      | { intent: Extract<ModelOnboardingIntent, "login-provider">; provider: string; force?: boolean }
      | { intent: Extract<ModelOnboardingIntent, "verify"> },
    options: ModelOnboardingRunOptions = {}
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

    let terminalOpenAttempted = false;
    const maybeOpenTerminal = (event: OpenClawModelOnboardingStreamEvent) => {
      const providerToVerify =
        options.verifyProvider ??
        (payload.intent === "login-provider" ? normalizeAddModelsProviderId(payload.provider) : null);

      if (
        !options.autoOpenTerminal ||
        terminalOpenAttempted ||
        event.type !== "done" ||
        event.phase !== "authenticating" ||
        !event.manualCommand
      ) {
        return;
      }

      terminalOpenAttempted = true;
      void openModelOnboardingTerminal(event.manualCommand).finally(() => {
        if (providerToVerify) {
          startModelProviderStatusPolling(providerToVerify);
        }
      });
    };

    if (options.forceOpen) {
      setIsOnboardingForcedOpen(true);
    }
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
              maybeOpenTerminal(event);
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
                if (event.ok && payload.intent === "set-default") {
                  hydrateOnboardingModelSelection(event.snapshot, { force: true });
                }
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
          maybeOpenTerminal(event);
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
            if (event.ok && payload.intent === "set-default") {
              hydrateOnboardingModelSelection(event.snapshot, { force: true });
            }
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

  const runModelProviderLogin = async (provider: string, options: ModelOnboardingRunOptions = {}) => {
    const providerId = normalizeAddModelsProviderId(provider);

    if (!providerId) {
      toast.error("Unknown model provider.", {
        description: "AgentOS could not match this auth request to a supported provider."
      });
      return;
    }

    setIsOnboardingForcedOpen(true);

    const snapshotProvider = snapshot.diagnostics.modelReadiness.authProviders.find(
      (entry) => entry.provider === providerId
    );

    if (!options.forceAuth && snapshotProvider?.connected) {
      markModelProviderConnected(providerId, snapshotProvider.detail, snapshot);
      return;
    }

    if (!options.forceAuth) {
      try {
        const status = await readModelProviderStatus(providerId, { timeoutMs: 2500 });

        if (status.connection.connected) {
          markModelProviderConnected(providerId, status.connection.detail, status.snapshot);
          return;
        }
      } catch {
        // Fall through to the OpenClaw auth handoff if status cannot be read.
      }
    }

    await runModelOnboarding({
      intent: "login-provider",
      provider: providerId,
      force: options.forceAuth || undefined
    }, {
      forceOpen: true,
      verifyProvider: providerId,
      ...options
    });
  };

  const runChatGptOnboarding = async (force = false) => {
    if (chatGptOnboardingRunRef.current) {
      return chatGptOnboardingRunRef.current;
    }

    const run = (async () => {
      setIsOnboardingForcedOpen(true);
      setIsOnboardingDismissed(false);
      setOnboardingStage("models");
      setModelOnboardingRunState("running");
      setModelOnboardingPhase("authenticating");
      setModelOnboardingStatusMessage("Opening secure ChatGPT sign-in...");
      setModelOnboardingResultMessage(null);
      setModelOnboardingManualCommand(null);
      setModelOnboardingDocsUrl(null);
      setModelOnboardingLog("");
      setModelSwitchFeedback(initialModelSwitchFeedback);
      setChatGptBrowserAuth(null);

      let authFlow: ChatGptBrowserAuthSnapshot | null = null;
      try {
        authFlow = await startChatGptBrowserAuth(force);
        setChatGptBrowserAuth(authFlow);

        for (let attempt = 0; attempt < 360; attempt += 1) {
          const currentAuthFlow = authFlow;
          if (!currentAuthFlow) {
            throw new Error("ChatGPT sign-in did not start.");
          }

          if (currentAuthFlow.state === "completed" || currentAuthFlow.state === "error") {
            break;
          }

          await new Promise((resolve) => globalThis.setTimeout(resolve, 1_000));
          authFlow = await readChatGptBrowserAuth(currentAuthFlow.sessionId);
          setChatGptBrowserAuth(authFlow);
        }

        if (!authFlow || authFlow.state !== "completed") {
          throw new Error(authFlow?.error || "ChatGPT sign-in did not complete.");
        }

        setChatGptBrowserAuth((current) => current
          ? {
              ...current,
              message: "ChatGPT sign-in completed. Refreshing the OpenClaw account and discovering models..."
            }
          : current);
        setModelOnboardingPhase("refreshing");
        setModelOnboardingStatusMessage("Refreshing ChatGPT authentication before discovering models...");
        const result = await waitForChatGptProviderStatus();

        if (!result.connection.connected) {
          throw new Error("ChatGPT sign-in completed, but OpenClaw is still refreshing the account and model catalog. Try again in a moment.");
        }

        setChatGptBrowserAuth(null);
        markModelProviderConnected("openai", result.connection.detail, result.snapshot, result);
      } catch (error) {
        const message = resolveChatGptRecoveryMessage(
          authFlow?.state === "error"
            ? authFlow.error
            : error instanceof Error
              ? error.message
              : "ChatGPT sign-in could not be completed."
        );
        setModelOnboardingRunState("error");
        setModelOnboardingPhase("authenticating");
        setModelOnboardingStatusMessage(null);
        setModelOnboardingResultMessage(message);
        toast.error("ChatGPT connection needs attention.", {
          description: message
        });
      }
    })();

    chatGptOnboardingRunRef.current = run;
    try {
      await run;
    } finally {
      if (chatGptOnboardingRunRef.current === run) {
        chatGptOnboardingRunRef.current = null;
      }
    }
  };

  const submitChatGptBrowserRedirect = async (redirectUrl: string) => {
    if (!chatGptBrowserAuth) {
      return;
    }

    try {
      const result = await submitChatGptBrowserAuth(chatGptBrowserAuth.sessionId, redirectUrl);
      setChatGptBrowserAuth(result);
    } catch (error) {
      toast.error("ChatGPT callback was not accepted.", {
        description: error instanceof Error ? error.message : "Paste the complete OpenAI localhost callback URL."
      });
    }
  };

  const runModelSetDefault = async (modelId?: string, thinking?: OpenClawThinkingLevel) => {
    if (thinking) {
      setSelectedOnboardingThinking(thinking);
    }

    const targetModelId = modelId || selectedOnboardingModelId;
    const currentDefaultModelId =
      snapshot.diagnostics.modelReadiness.resolvedDefaultModel ||
      snapshot.diagnostics.modelReadiness.defaultModel ||
      null;

    if (!targetModelId) {
      return;
    }

    if (
      currentDefaultModelId &&
      targetModelId.trim() === currentDefaultModelId.trim() &&
      resolveOpenClawModelReady(snapshot)
    ) {
      await continueFromAi(thinking);
      return;
    }

    await runModelOnboarding(
      currentDefaultModelId &&
      targetModelId.trim() === currentDefaultModelId.trim() &&
      resolveOpenClawModelReady(snapshot)
        ? {
            intent: "auto",
            modelId: targetModelId
          }
        : {
            intent: "set-default",
            modelId: targetModelId
          }
    );
  };

  const dismissOnboarding = useCallback(() => {
    setIsOnboardingForcedOpen(false);
    setShowOnboardingReadyState(false);
    setIsOnboardingDismissed(true);
    setLaunchpadWorkspaceCreateRunState("idle");
    setLaunchpadWorkspaceCreateProgress(null);
    setLaunchpadWorkspaceCreateTarget(null);
  }, []);

  const waitForLaunchpadWorkspaceHandoff = useCallback(async (
    result: WorkspaceCreateResult,
    baseProgress: OperationProgressSnapshot | null
  ) => {
    let latestSnapshot: MissionControlSnapshot = snapshot;
    let latestReadiness = resolveLaunchpadWorkspaceSetupReadiness(latestSnapshot, result);

    setLaunchpadWorkspaceCreateProgress(
      buildLaunchpadWorkspaceHandoffProgress({
        progress: baseProgress,
        readiness: latestReadiness,
        state: latestReadiness.ready ? "ready" : "syncing"
      })
    );

    for (const delayMs of launchpadWorkspaceHandoffPollDelaysMs) {
      if (delayMs > 0) {
        await wait(delayMs);
      }

      const refreshedSnapshot = await refreshSnapshot({ force: true }).catch(() => null);

      if (refreshedSnapshot) {
        latestSnapshot = refreshedSnapshot;
      }

      latestReadiness = resolveLaunchpadWorkspaceSetupReadiness(latestSnapshot, result);

      setLaunchpadWorkspaceCreateProgress(
        buildLaunchpadWorkspaceHandoffProgress({
          progress: baseProgress,
          readiness: latestReadiness,
          state: latestReadiness.ready ? "ready" : "syncing"
        })
      );

      if (latestReadiness.ready) {
        return {
          snapshot: latestSnapshot,
          readiness: latestReadiness
        };
      }
    }

    const errorDetail = describeLaunchpadWorkspaceSetupReadiness(latestReadiness);
    setLaunchpadWorkspaceCreateProgress(
      buildLaunchpadWorkspaceHandoffProgress({
        progress: baseProgress,
        readiness: latestReadiness,
        state: "error",
        errorDetail
      })
    );

    throw new Error(errorDetail);
  }, [refreshSnapshot, snapshot]);

  const finalizeLaunchpadWorkspaceCreate = useCallback(async (
    result: WorkspaceCreateResult,
    readySnapshot: MissionControlSnapshot
  ) => {
    const nextWorkspaceId =
      readySnapshot.workspaces.some((workspace) => workspace.id === result.workspaceId)
        ? result.workspaceId
        : readySnapshot.workspaces[0]?.id ?? result.workspaceId;

    setLaunchpadWorkspaceCreateRunState("success");
    openWorkspaceOnCanvas(nextWorkspaceId, { markPending: true });
    setSnapshot(readySnapshot);
    await wait(launchpadWorkspaceHandoffSuccessPauseMs);
    dismissOnboarding();

    toast.success("Workspace ready.", {
      description: `${result.agentIds.length} agent${result.agentIds.length === 1 ? "" : "s"} visible at ${result.workspacePath}`
    });

    if (result.warnings?.length) {
      toast.message("Workspace created with a sync warning.", {
        description: result.warnings[0]
      });
    }

    if (result.kickoffError) {
      toast.message("Workspace created, but kickoff needs attention.", {
        description: result.kickoffError
      });
    }
  }, [dismissOnboarding, openWorkspaceOnCanvas, setSnapshot]);

  const runLaunchpadWorkspaceCreate = useCallback(async () => {
    if (launchpadWorkspaceCreateRunState === "running") {
      return null;
    }

    if (launchpadWorkspaceCreateRunState === "error" && launchpadWorkspaceCreateTarget) {
      setIsOnboardingDismissed(false);
      setIsOnboardingForcedOpen(true);
      setLaunchpadWorkspaceCreateRunState("running");

      try {
        const handoff = await waitForLaunchpadWorkspaceHandoff(
          launchpadWorkspaceCreateTarget,
          launchpadWorkspaceCreateProgress
        );
        await finalizeLaunchpadWorkspaceCreate(launchpadWorkspaceCreateTarget, handoff.snapshot);
        return launchpadWorkspaceCreateTarget;
      } catch (error) {
        setLaunchpadWorkspaceCreateRunState("error");
        toast.error("Workspace setup needs attention.", {
          description: error instanceof Error ? error.message : "AgentOS could not confirm the canvas handoff."
        });
        return null;
      }
    }

    const targetModelId =
      selectedOnboardingModelId.trim() ||
      resolveSuggestedAgentModelId(snapshot, activeWorkspaceId) ||
      null;

    if (!targetModelId) {
      toast.error("Choose a model first.", {
        description: "OpenClaw needs a usable default model before it can create the first workspace."
      });
      return null;
    }

    let lastCreateProgress = createPendingOperationProgressSnapshot(
      buildWorkspaceCreateProgressTemplate({
        sourceMode: "empty",
        agentCount: 1,
        kickoffMission: true
      })
    );
    let createdResultForError: WorkspaceCreateResult | null = null;

    setIsOnboardingDismissed(false);
    setIsOnboardingForcedOpen(true);
    setLaunchpadWorkspaceCreateRunState("running");
    setLaunchpadWorkspaceCreateTarget(null);
    setLaunchpadWorkspaceCreateProgress(lastCreateProgress);

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
          thinking: selectedOnboardingThinking,
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
          creation: {
            source: "launchpad",
            idempotencyKey: crypto.randomUUID()
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
          lastCreateProgress = event.progress;
          setLaunchpadWorkspaceCreateProgress(event.progress);
          return;
        }

        if (event.progress) {
          lastCreateProgress = event.progress;
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
      createdResultForError = result;
      setLaunchpadWorkspaceCreateTarget(result);

      const handoff = await waitForLaunchpadWorkspaceHandoff(result, lastCreateProgress);
      await finalizeLaunchpadWorkspaceCreate(result, handoff.snapshot);

      return result;
    } catch (error) {
      setLaunchpadWorkspaceCreateRunState("error");
      const message = error instanceof Error ? error.message : "Unknown workspace error.";
      toast.error(createdResultForError ? "Workspace setup needs attention." : "Workspace creation failed.", {
        description: message
      });
      return null;
    }
  }, [
    finalizeLaunchpadWorkspaceCreate,
    launchpadWorkspaceCreateProgress,
    launchpadWorkspaceCreateRunState,
    launchpadWorkspaceCreateTarget,
    activeWorkspaceId,
    selectedOnboardingModelId,
    selectedOnboardingThinking,
    snapshot,
    waitForLaunchpadWorkspaceHandoff
  ]);

  const openSetupWizard = (stage?: OnboardingWizardStage) => {
    const resolvedStage = resolveEffectiveWizardStage(
      stage ?? (isOpenClawOnboardingSystemReady ? "models" : "system"),
      isOpenClawOnboardingSystemReady
    );

    setIsSettingsOpen(false);
    setOnboardingSessionKey((current) => current + 1);
    setOnboardingStage(resolvedStage);
    setIsOnboardingDismissed(false);
    setShowOnboardingReadyState(
      stage === undefined && onboardingAiReady && (shouldShowLaunchpadReadyState || isOnboardingFullyReady)
    );
    setIsOnboardingForcedOpen(true);

    if (resolvedStage === "models") {
      hydrateOnboardingModelSelection(snapshot, { force: true });
    }
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

  const enterAgentOS = useCallback(async (readySnapshot?: MissionControlSnapshot) => {
    const currentSnapshot = readySnapshot ?? snapshot;

    if (!onboardingAiReady && !isChatGptConnectionReady(currentSnapshot)) {
      setIsOnboardingForcedOpen(true);
      setIsOnboardingDismissed(false);
      setShowOnboardingReadyState(false);
      setOnboardingStage("models");
      return;
    }

    let entrySnapshot = currentSnapshot;

    if (!hasCompleteAgentOSWorkspaceSnapshot(entrySnapshot)) {
      const refreshedSnapshot = await refreshSnapshot({ force: true }).catch(() => null);

      if (refreshedSnapshot) {
        entrySnapshot = refreshedSnapshot;
        setSnapshot(refreshedSnapshot);
      }
    }

    if (!hasCompleteAgentOSWorkspaceSnapshot(entrySnapshot)) {
      toast.message("AgentOS is still syncing.", {
        description: "Workspace state is not ready yet. Try entering AgentOS again in a moment."
      });
      return;
    }

    if (!hasAgentOSWorkspaceSetup(entrySnapshot)) {
      if (entrySnapshot.workspaces.length === 0) {
        const refreshedSnapshot = await refreshSnapshot({ force: true }).catch(() => null);

        if (refreshedSnapshot) {
          entrySnapshot = refreshedSnapshot;
          setSnapshot(refreshedSnapshot);
        }
      }

      if (!hasCompleteAgentOSWorkspaceSnapshot(entrySnapshot)) {
        toast.message("AgentOS is still syncing.", {
          description: "Workspace state is not ready yet. Try entering AgentOS again in a moment."
        });
        return;
      }

      if (!hasAgentOSWorkspaceSetup(entrySnapshot) && entrySnapshot.workspaces.length === 0) {
        void runLaunchpadWorkspaceCreate();
        return;
      }
    }

    const targetWorkspaceId =
      (activeWorkspaceId && entrySnapshot.workspaces.some((workspace) => workspace.id === activeWorkspaceId)
        ? activeWorkspaceId
        : entrySnapshot.workspaces[0]?.id) ?? null;

    if (targetWorkspaceId) {
      setPendingWorkspaceOpenId(null);
      openWorkspaceOnCanvas(targetWorkspaceId);
    }

    dismissOnboarding();
  }, [
    activeWorkspaceId,
    dismissOnboarding,
    openWorkspaceOnCanvas,
    onboardingAiReady,
    refreshSnapshot,
    runLaunchpadWorkspaceCreate,
    setSnapshot,
    snapshot
  ]);

  const continueFromAi = useCallback(async (thinking?: OpenClawThinkingLevel) => {
    if (thinking) {
      setSelectedOnboardingThinking(thinking);
    }

    let readySnapshot = snapshot;

    if (!isChatGptConnectionReady(readySnapshot)) {
      const refreshedSnapshot = await refreshSnapshot({ force: true }).catch(() => null);

      if (refreshedSnapshot) {
        readySnapshot = refreshedSnapshot;
        setSnapshot(refreshedSnapshot);
      }
    }

    if (!isChatGptConnectionReady(readySnapshot)) {
      setIsOnboardingForcedOpen(true);
      setIsOnboardingDismissed(false);
      setOnboardingStage("models");
      return;
    }

    if (hasAgentOSWorkspaceSetup(readySnapshot)) {
      void enterAgentOS(readySnapshot);
      return;
    }

    setShowOnboardingReadyState(true);
  }, [enterAgentOS, refreshSnapshot, setSnapshot, snapshot]);

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
      const gatewayError = error instanceof Error ? error : new Error("Unknown gateway control error.");
      toast.error("Gateway action failed.", {
        description: gatewayError.message
      });
      throw gatewayError;
    } finally {
      setGatewayControlAction(null);
    }
  };

  const openAddModelsDialog = (provider?: AddModelsProviderId | null) => {
    setReturnToAgentModelId(null);
    setInitialAddModelsProvider(normalizeAddModelsProviderId(provider));
    setIsAddModelsDialogOpen(true);
  };

  const handleChatGptAccountSwitch = () => {
    setIsAddModelsDialogOpen(false);
    setReturnToAgentModelId(null);
    setInitialAddModelsProvider(null);
    void runChatGptOnboarding(true);
  };

  const handleAddModelsProviderSnapshotReady = (nextSnapshot: MissionControlSnapshot) => {
    setSnapshot(nextSnapshot);

    if (!resolveOpenClawModelReady(nextSnapshot)) {
      return;
    }

    setIsOnboardingForcedOpen(false);
    setShowOnboardingReadyState(false);
    setIsOnboardingDismissed(true);
    setOnboardingStatusMessage(null);
    setOnboardingResultMessage(null);
    setModelOnboardingStatusMessage(null);
    setModelOnboardingResultMessage(null);
  };

  const openAddModelsFromModelPicker = () => {
    const agentId = agentModelRequest?.agentId ?? null;

    setReturnToAgentModelId(agentId);
    setAgentModelRequest(null);
    setInitialAddModelsProvider(null);
    setIsAddModelsDialogOpen(true);
  };

  const handleBackToAgentModelPicker = () => {
    const agentId = returnToAgentModelId;

    setIsAddModelsDialogOpen(false);
    setReturnToAgentModelId(null);

    if (agentId) {
      setAgentModelRequest({
        requestId: `agent-model-return:${agentId}:${Date.now()}`,
        agentId
      });
    }
  };

  const handleAddModelsDialogOpenChange = (open: boolean) => {
    setIsAddModelsDialogOpen(open);

    if (!open) {
      setReturnToAgentModelId(null);
    }
  };

  const checkForUpdates = async () => {
    setIsCheckingForUpdates(true);

    try {
      const nextSnapshot = await refreshSnapshot({ force: true });
      const checkedAt = Date.now();
      const updateInfo = nextSnapshot.diagnostics.updateInfo?.trim();
      const currentVersion = normalizeUpdateVersion(nextSnapshot.diagnostics.version);
      const registryLatestVersion =
        nextSnapshot.diagnostics.updateCompatibility?.latestDecision?.version ??
        resolveLatestVersionFromUpdateInfo(updateInfo) ??
        nextSnapshot.diagnostics.latestVersion ??
        null;
      const hasRegistryUpdateAvailable = Boolean(
        currentVersion &&
          registryLatestVersion &&
          compareVersionStrings(registryLatestVersion, currentVersion) > 0
      );
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

      if (hasRegistryUpdateAvailable) {
        toast.message("Latest OpenClaw needs review.", {
          description:
            updateInfo ||
            `v${registryLatestVersion} is available. Current version: v${nextSnapshot.diagnostics.version || "unknown"}.`
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
      missionControlPreferenceStorageKeys.surfaceTheme,
      missionControlPreferenceStorageKeys.hiddenRuntimeIds,
      missionControlPreferenceStorageKeys.hiddenTaskKeys,
      missionControlPreferenceStorageKeys.lockedTaskKeys,
      workspaceTaskCardFiltersStorageKey,
      "mission-control-workspace-plan-id",
      "mission-control-recent-prompts",
      "mission-control-node-positions",
      pendingAgentProjectionStorageKey,
      taskReviewStateStorageKey
    ];
    const prefixKeys = [
      "mission-control-active-workspace-id:",
      "mission-control-node-positions:v",
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

    clearPreferenceState();
    clearTaskReviewState();
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

    const isFullUninstall = resetDialogTarget === "full-uninstall";
    if (isFullUninstall) {
      setRequiresFreshInstallSystemSetup(true);
      setOnboardingStage("system");
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
                if (isFullUninstall) {
                  setRequiresFreshInstallSystemSetup(false);
                }
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
          } else if (isFullUninstall) {
            setRequiresFreshInstallSystemSetup(false);
          }
        }
      }

      if (!sawDone) {
        throw new Error("Reset stream ended unexpectedly.");
      }
    } catch (error) {
      if (isFullUninstall) {
        setRequiresFreshInstallSystemSetup(false);
      }
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

  const continueToModelSetup = async () => {
    setOnboardingStatusMessage(null);
    setRequiresFreshInstallSystemSetup(false);
    setShowOnboardingReadyState(false);
    await refreshOnboardingModelSnapshot(snapshot);
    setOnboardingStage("models");
  };

  const settingsPanelProps: MissionControlShellSettingsPanelProps = {
    snapshot,
    surfaceTheme,
    connectionState,
    gatewayDraft,
    workspaceRootDraft,
    isSavingGateway,
    isSavingWorkspaceRoot,
    isCheckingForUpdates,
    updateRunState,
    updateCapabilityDiff,
    updateCertificationScorecard,
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
    onOpenUpdateDialog: (targetVersion, mode = "recommended") => {
      if (updateRunState !== "running") {
        resetUpdateDialogState();
      }
      setUpdateTargetVersion(targetVersion ?? null);
      setUpdateMode(mode);
      setIsUpdateDialogOpen(true);
    },
    onRollbackOpenClaw: () => {
      if (updateRunState !== "running") {
        resetUpdateDialogState();
      }
      setIsUpdateDialogOpen(true);
      void runOpenClawUpdate("rollback");
    },
    onOpenResetDialog: (target) => {
      void openResetDialog(target);
    },
    onSnapshotChange: setSnapshot,
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
          key={`onboarding-${onboardingSessionKey}`}
          snapshot={snapshot}
          surfaceTheme={surfaceTheme}
          onToggleTheme={() => setSurfaceTheme((current) => (current === "light" ? "dark" : "light"))}
          stage={effectiveOnboardingStage}
          systemReady={onboardingRunState === "success" || isOpenClawOnboardingSystemReady}
          modelReady={
            modelSwitchFeedback.phase === "success" ||
            showOnboardingReadyState ||
            isOpenClawOnboardingModelReady
          }
          systemSetupRequired={requiresFreshInstallSystemSetup}
          systemStatusChecking={!hasReceivedLiveSnapshot}
          gatewayReachable={gatewayReachable}
          gatewayRegistered={gatewayRegistered}
          gatewayReady={gatewayReady}
          runtimeWritable={runtimeWritable}
          localModelStatus={localModelStatus}
          cliInstalled={cliInstalled}
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
          selectedThinking={selectedOnboardingThinking}
          discoveredModels={discoveredModels}
          onSelectedModelIdChange={setSelectedOnboardingModelId}
          onSelectedThinkingChange={setSelectedOnboardingThinking}
          onClearModelSwitchFeedback={() => setModelSwitchFeedback(initialModelSwitchFeedback)}
          onSnapshotChange={setSnapshot}
          onRunSystemSetup={runOpenClawOnboarding}
          onRunModelSetDefault={runModelSetDefault}
          onOpenAddModels={openAddModelsDialog}
          onOpenGatewayAuthSettings={openGatewayAuthSettings}
          onConnectChatGPT={(force = false) => {
            void runChatGptOnboarding(force);
          }}
          chatGptBrowserAuth={chatGptBrowserAuth}
          onSubmitChatGptRedirect={submitChatGptBrowserRedirect}
          onContinueFromAi={continueFromAi}
          onEnterAgentOS={enterAgentOS}
          onSkipSetup={dismissOnboarding}
          onCreateWorkspace={runLaunchpadWorkspaceCreate}
          onContinueToModels={continueToModelSetup}
          onBackToSystem={() => setOnboardingStage("system")}
          onSelectStage={(stage) => {
            setShowOnboardingReadyState(false);
            setOnboardingStage(resolveEffectiveWizardStage(stage, isOpenClawOnboardingSystemReady));
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
        onWorkspaceCreated={handleWorkspaceCreated}
        onWorkspaceCreationStarted={handleWorkspaceCreationStarted}
        onWorkspaceCreationFinished={handleWorkspaceCreationFinished}
        onWorkspaceUpdated={(workspaceId) => {
          openWorkspaceOnCanvas(workspaceId, { markPending: true });
        }}
      />

      <AddModelsDialog
        open={isAddModelsDialogOpen}
        onOpenChange={handleAddModelsDialogOpenChange}
        snapshot={snapshot}
        initialProvider={initialAddModelsProvider}
        onSwitchChatGptAccount={handleChatGptAccountSwitch}
        onSnapshotChange={setSnapshot}
        onProviderSnapshotReady={handleAddModelsProviderSnapshotReady}
        onBack={returnToAgentModelId ? handleBackToAgentModelPicker : undefined}
        surfaceTheme={surfaceTheme}
      />

      <CreateAgentDialog
        open={isSidebarCreateAgentDialogOpen}
        onOpenChange={setIsSidebarCreateAgentDialogOpen}
        snapshot={uiSnapshot}
        defaultWorkspaceId={activeWorkspaceId}
        onRefresh={refresh}
        onSnapshotChange={setSnapshot}
        onAgentCreationPending={handleAgentCreationPending}
        onAgentCreatedVisible={handleCreatedAgentVisible}
        surfaceTheme={surfaceTheme}
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
        updateCapabilityDiff={updateCapabilityDiff}
        updateCertificationScorecard={updateCertificationScorecard}
        updateTargetVersion={updateTargetVersion}
        updateMode={updateMode}
        activeRuntimeCount={activeRuntimeCount}
        updateInstallSummary={openClawInstallSummary}
        onUpdateDialogOpenChange={(open) => {
          if (updateRunState === "running") {
            setIsUpdateDialogOpen(open);
            return;
          }

          setIsUpdateDialogOpen(open);

          if (!open && updateRunState === "idle") {
            resetUpdateDialogState();
          }
        }}
        onRunOpenClawUpdate={(action) => {
          void runOpenClawUpdate(action);
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

        <div
          className={cn(
            "pointer-events-auto fixed left-0 top-0 z-30 hidden h-[100dvh] overflow-visible mission-ease-smooth transition-[width] duration-500 lg:block",
            isSidebarOpen
              ? "w-[calc(100vw-96px)] max-w-[292px] lg:w-[292px] lg:max-w-none"
              : "w-[56px]"
          )}
          onMouseEnter={() => {
            if (!isSidebarHoverLocked) {
              setIsSidebarOpen(true);
            }
          }}
          onMouseLeave={(event) => {
            if (isSidebarPinned || shouldKeepSidebarOpenForPortal(event.relatedTarget)) {
              return;
            }

            setIsSidebarOpen(false);
          }}
          onFocusCapture={() => {
            if (!isSidebarPinned) {
              setIsSidebarOpen(true);
            }
          }}
          onBlurCapture={(event) => {
            if (isSidebarPinned || shouldKeepSidebarOpenForPortal(event.relatedTarget)) {
              return;
            }

            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setIsSidebarOpen(false);
            }
          }}
        >
          <MissionSidebar
            snapshot={uiSnapshot}
            surfaceTheme={surfaceTheme}
            onToggleTheme={() => setSurfaceTheme((current) => (current === "light" ? "dark" : "light"))}
            activeWorkspaceId={activeWorkspaceId}
            requestedAgentAction={agentActionRequest}
            connectionState={connectionState}
            collapsed={!isSidebarOpen}
            sidebarPinned={isSidebarPinned}
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
            onExpandCollapsed={() => setIsSidebarOpen(true)}
            onToggleCollapsed={handleSidebarPinToggle}
            onSelectWorkspace={(workspaceId) => {
              openWorkspaceOnCanvas(workspaceId);
            }}
            onRefresh={refresh}
            onRunModelRefresh={runModelRefresh}
            onRunModelDiscover={runModelDiscover}
            onRunModelSetDefault={runModelSetDefault}
            onConnectModelProvider={runModelProviderLogin}
            onOpenModelSetup={() => openSetupWizard()}
            onOpenAddModels={openAddModelsDialog}
            onOpenCreateAgent={() => {
              if (!isSidebarPinned) {
                setIsSidebarOpen(false);
              }
              setIsSidebarCreateAgentDialogOpen(true);
            }}
            onOpenWorkspaceCreate={() => openWorkspaceWizard("basic")}
            onEditWorkspace={openWorkspaceWizardForEdit}
            onSnapshotChange={setSnapshot}
            pendingCreatedAgents={pendingCreatedAgents}
            pendingWorkspaceCreations={pendingWorkspaceCreations}
            onAgentCreationPending={handleAgentCreationPending}
            onAgentCreatedVisible={handleCreatedAgentVisible}
            onAgentActionRequestDismiss={() => setAgentActionRequest(null)}
            onAgentActionModalOpenChange={(open) => {
              setIsSidebarAgentActionModalOpen(open);
              if (open && !isSidebarPinned) {
                setIsSidebarOpen(false);
              }
            }}
          />
        </div>

        {isSidebarOpen ? (
          <button
            type="button"
            aria-label="Close navigation"
            className="fixed inset-0 z-40 bg-black/62 backdrop-blur-[2px] lg:hidden"
            onClick={() => setIsSidebarOpen(false)}
          />
        ) : null}

        {!isSidebarOpen ? (
          <div
            className={cn(
              "fixed inset-x-0 top-0 z-30 flex min-h-16 items-center gap-3 border-b px-3 backdrop-blur-xl lg:hidden",
              surfaceTheme === "light"
                ? "border-[#d9c9bc]/80 bg-[#f8f5f0]/94 text-[#2d211b]"
                : "border-white/[0.08] bg-[#07101c]/94 text-slate-100"
            )}
          >
            <button
              type="button"
              aria-label="Open navigation"
              aria-expanded="false"
              onClick={() => setIsSidebarOpen(true)}
              className={cn(
                "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border shadow-sm",
                surfaceTheme === "light"
                  ? "border-[#d9c9bc]/90 bg-white/80 text-[#6f5a4b]"
                  : "border-cyan-300/10 bg-slate-950/82 text-slate-200"
              )}
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">Settings</p>
              <p className={cn("truncate text-[0.68rem]", surfaceTheme === "light" ? "text-[#7a6658]" : "text-slate-400")}>System control center</p>
            </div>
          </div>
        ) : null}

        <div
          className={cn(
            "pointer-events-auto fixed inset-y-0 left-0 z-50 w-[min(88vw,320px)] overflow-hidden mission-ease-smooth bg-[#050a12] shadow-[18px_0_60px_rgba(0,0,0,0.42)] transition-transform duration-300 [&_button]:min-h-11 lg:hidden",
            isSidebarOpen ? "translate-x-0" : "-translate-x-full"
          )}
          inert={!isSidebarOpen}
          onClickCapture={(event) => {
            if (isSidebarOpen && event.target instanceof Element && event.target.closest("a")) {
              setIsSidebarOpen(false);
            }
          }}
        >
          <MissionSidebar
            snapshot={uiSnapshot}
            surfaceTheme={surfaceTheme}
            onToggleTheme={() => setSurfaceTheme((current) => (current === "light" ? "dark" : "light"))}
            activeWorkspaceId={activeWorkspaceId}
            requestedAgentAction={agentActionRequest}
            connectionState={connectionState}
            collapsed={!isSidebarOpen}
            sidebarPinned
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
            onExpandCollapsed={() => setIsSidebarOpen(true)}
            onToggleCollapsed={() => setIsSidebarOpen(false)}
            onSelectWorkspace={(workspaceId) => {
              openWorkspaceOnCanvas(workspaceId);
            }}
            onRefresh={refresh}
            onRunModelRefresh={runModelRefresh}
            onRunModelDiscover={runModelDiscover}
            onRunModelSetDefault={runModelSetDefault}
            onConnectModelProvider={runModelProviderLogin}
            onOpenModelSetup={() => openSetupWizard()}
            onOpenAddModels={openAddModelsDialog}
            onOpenCreateAgent={() => {
              setIsSidebarOpen(false);
              setIsSidebarCreateAgentDialogOpen(true);
            }}
            onOpenWorkspaceCreate={() => openWorkspaceWizard("basic")}
            onEditWorkspace={openWorkspaceWizardForEdit}
            onSnapshotChange={setSnapshot}
            pendingCreatedAgents={pendingCreatedAgents}
            pendingWorkspaceCreations={pendingWorkspaceCreations}
            onAgentCreationPending={handleAgentCreationPending}
            onAgentCreatedVisible={handleCreatedAgentVisible}
            onAgentActionRequestDismiss={() => setAgentActionRequest(null)}
            onAgentActionModalOpenChange={(open) => {
              setIsSidebarAgentActionModalOpen(open);
              if (open) {
                setIsSidebarOpen(false);
              }
            }}
          />
        </div>

        <SettingsControlCenter {...settingsPanelProps} sidebarOpen={isSidebarOpen} />
        <div
          data-tauri-drag-region="deep"
          className={cn(
            "pointer-events-auto fixed top-0 z-40 hidden h-16 lg:block",
            isSidebarOpen ? "lg:left-[316px]" : "lg:left-[80px]",
            "lg:right-[84px]"
          )}
        >
          <MissionControlCanvasTopBar
            settingsRef={settingsRef}
            isSettingsOpen={isSettingsOpen}
            onToggleTheme={() =>
              setSurfaceTheme((current) => (current === "light" ? "dark" : "light"))
            }
            onToggleSettings={() => setIsSettingsOpen((current) => !current)}
            onSnapshotChange={setSnapshot}
            onRefresh={refresh}
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
            surfaceTheme={surfaceTheme}
            pendingCreatedAgents={pendingCreatedAgents}
            agentCreationWarnings={agentCreationWarnings}
            accountTargets={accountTargets}
            accountAccessRules={accountAccessRules}
            sidebarOpen={isSidebarOpen}
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
              setIsSidebarOpen(false);
              selectNode(agentId);
              setAgentActionRequest({
                requestId: `edit:${agentId}:${Date.now()}`,
                kind: "edit",
                agentId
              });
            }}
            onDeleteAgent={(agentId) => {
              setIsSidebarOpen(false);
              selectNode(agentId);
              setAgentActionRequest({
                requestId: `delete:${agentId}:${Date.now()}`,
                kind: "delete",
                agentId
              });
            }}
            onFocusAgent={handleFocusAgent}
            onCreateTaskAgent={handleCreateTaskAgent}
            onConfigureAgentModel={handleConfigureAgentModel}
            onConfigureAgentCapabilities={handleConfigureAgentCapabilities}
            onOpenAgentContextEngine={openAgentContextEngine}
            onRefresh={async () => {
              await refreshSnapshot({ force: true });
            }}
            onInspectAgentDetail={handleInspectAgentDetail}
            onOpenWorkspaceChannels={openWorkspaceChannels}
            onOpenAccounts={openAccountsConnect}
            onOpenWorkspaceContextEngine={openWorkspaceContextEngine}
            onCreateWorkspaceAgent={(workspaceId) => {
              setActiveWorkspaceId(workspaceId);
              setIsSidebarCreateAgentDialogOpen(true);
            }}
            onAddWorkspaceModel={() => openAddModelsDialog()}
            onMessageAgent={(agentId) => {
              const agent = uiSnapshot.agents.find((entry) => entry.id === agentId);

              if (!agent) {
                return;
              }

              setAgentActionRequest(null);
              setActiveWorkspaceId(agent.workspaceId);
              inspectorChatEntryPointRef.current = "mission-control";
              selectNode(agentId, "chat");
              setIsInspectorOpen(true);
            }}
            onReplyTask={(task) => {
              const prompt = resolveTaskPrompt(task);
              setIsComposerVisible(true);
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
              setIsComposerVisible(true);
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
            onAbortTask={requestTaskAbort}
            onInspectTask={inspectTask}
            onActiveTaskCardChange={updateActiveTaskCard}
            onReviewTask={openTaskReview}
            onSelectNode={(nodeId) => {
              selectNode(nodeId);
            }}
            onCanvasNodePointerDownCapture={handleCanvasNodePointerDownCapture}
          />
        </div>
      </div>

      <div
        data-tauri-drag-region="deep"
        className={cn(
          "pointer-events-auto absolute top-0 z-40 hidden h-16 lg:block",
          isSidebarOpen ? "lg:left-[316px]" : "lg:left-[80px]",
          !isInspectorOpen && "lg:right-[76px]"
        )}
        style={isInspectorOpen ? { right: `${inspectorWidth + 32}px` } : undefined}
      >
        <MissionControlCanvasTopBar
          settingsRef={settingsRef}
          isSettingsOpen={isSettingsOpen}
          onToggleTheme={() =>
            setSurfaceTheme((current) => (current === "light" ? "dark" : "light"))
          }
          onToggleSettings={() => setIsSettingsOpen((current) => !current)}
          onSnapshotChange={setSnapshot}
          onRefresh={refresh}
          {...settingsPanelProps}
        />
      </div>

      <div className="relative z-20 min-h-[100dvh] pointer-events-none lg:h-screen">
        {!isInspectorOpen ? (
          <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex items-center justify-between px-3 lg:hidden">
          {!isSidebarOpen ? (
            <button
              type="button"
              aria-label="Open navigation"
              aria-expanded={false}
              onClick={() => {
                setIsInspectorOpen(false);
                setIsSidebarOpen(true);
              }}
              className={cn(
                "pointer-events-auto inline-flex h-11 w-11 items-center justify-center rounded-full border shadow-[0_14px_34px_rgba(0,0,0,0.28)] backdrop-blur-xl",
                surfaceTheme === "light"
                  ? "border-[#d9c9bc]/90 bg-[#f8f5f0]/92 text-[#6f5a4b]"
                  : "border-cyan-300/10 bg-slate-950/82 text-slate-200"
              )}
            >
              <Menu className="h-5 w-5" />
            </button>
          ) : (
            <span aria-hidden="true" className="h-11 w-11" />
          )}
          <button
            type="button"
            aria-label={isInspectorOpen ? "Close inspector" : "Open inspector"}
            aria-expanded={isInspectorOpen}
            onClick={() => {
              setIsSidebarOpen(false);
              setIsInspectorOpen((current) => !current);
            }}
            className={cn(
              "pointer-events-auto inline-flex h-11 w-11 items-center justify-center rounded-full border shadow-[0_14px_34px_rgba(0,0,0,0.28)] backdrop-blur-xl",
              surfaceTheme === "light"
                ? "border-[#d9c9bc]/90 bg-[#f8f5f0]/92 text-[#6f5a4b]"
                : "border-cyan-300/10 bg-slate-950/82 text-slate-200"
            )}
          >
            <PanelRightOpen className="h-5 w-5" />
          </button>
          </div>
        ) : null}

        <div
          data-tauri-drag-region="deep"
          className="pointer-events-auto absolute left-[80px] top-6 z-10 hidden lg:block"
        >
          <MissionControlCanvasTitlePill surfaceTheme={surfaceTheme} />
        </div>

        <div
          className={cn(
            "pointer-events-auto absolute left-0 top-0 z-30 hidden h-[100dvh] overflow-visible mission-ease-smooth transition-[width] duration-500 lg:block",
            isSidebarOpen
              ? "w-[calc(100vw-96px)] max-w-[292px] lg:w-[292px] lg:max-w-none"
              : "w-[56px]"
          )}
          onMouseEnter={() => {
            if (!isSidebarHoverLocked) {
              setIsSidebarOpen(true);
            }
          }}
          onMouseLeave={(event) => {
            if (isSidebarPinned || shouldKeepSidebarOpenForPortal(event.relatedTarget)) {
              return;
            }

            setIsSidebarOpen(false);
          }}
          onFocusCapture={() => {
            if (!isSidebarPinned) {
              setIsSidebarOpen(true);
            }
          }}
          onBlurCapture={(event) => {
            if (isSidebarPinned || shouldKeepSidebarOpenForPortal(event.relatedTarget)) {
              return;
            }

            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setIsSidebarOpen(false);
            }
          }}
        >
          <MissionSidebar
            snapshot={uiSnapshot}
            surfaceTheme={surfaceTheme}
            onToggleTheme={() => setSurfaceTheme((current) => (current === "light" ? "dark" : "light"))}
            activeWorkspaceId={activeWorkspaceId}
            requestedAgentAction={agentActionRequest}
            connectionState={connectionState}
            collapsed={!isSidebarOpen}
            sidebarPinned={isSidebarPinned}
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
            onExpandCollapsed={() => setIsSidebarOpen(true)}
            onToggleCollapsed={handleSidebarPinToggle}
            onSelectWorkspace={(workspaceId) => {
              openWorkspaceOnCanvas(workspaceId);
            }}
            onRefresh={refresh}
            onRunModelRefresh={runModelRefresh}
            onRunModelDiscover={runModelDiscover}
            onRunModelSetDefault={runModelSetDefault}
            onConnectModelProvider={runModelProviderLogin}
            onOpenModelSetup={() => openSetupWizard()}
            onOpenAddModels={openAddModelsDialog}
            onOpenCreateAgent={() => {
              if (!isSidebarPinned) {
                setIsSidebarOpen(false);
              }
              setIsSidebarCreateAgentDialogOpen(true);
            }}
            onOpenWorkspaceCreate={() => openWorkspaceWizard("basic")}
            onEditWorkspace={openWorkspaceWizardForEdit}
            onSnapshotChange={setSnapshot}
            pendingWorkspaceCreations={pendingWorkspaceCreations}
            onAgentCreationPending={handleAgentCreationPending}
            onAgentCreatedVisible={handleCreatedAgentVisible}
            onAgentActionRequestDismiss={() => setAgentActionRequest(null)}
            onAgentActionModalOpenChange={(open) => {
              setIsSidebarAgentActionModalOpen(open);
              if (open && !isSidebarPinned) {
                setIsSidebarOpen(false);
              }
            }}
          />
        </div>

        {isSidebarOpen ? (
          <button
            type="button"
            aria-label="Close navigation"
            className="pointer-events-auto fixed inset-0 z-40 bg-black/62 backdrop-blur-[2px] lg:hidden"
            onClick={() => setIsSidebarOpen(false)}
          />
        ) : null}

        <div
          className={cn(
            "pointer-events-auto fixed inset-y-0 left-0 z-50 w-[min(88vw,320px)] overflow-hidden transition-transform duration-300 lg:hidden",
            surfaceTheme === "light"
              ? "bg-[#fbf7f3] shadow-[18px_0_60px_rgba(76,54,40,0.22)]"
              : "bg-[#050a12] shadow-[18px_0_60px_rgba(0,0,0,0.42)]",
            isSidebarOpen ? "translate-x-0" : "-translate-x-full"
          )}
          aria-hidden={!isSidebarOpen}
          inert={!isSidebarOpen}
          onClickCapture={(event) => {
            if (isSidebarOpen && event.target instanceof Element && event.target.closest("a")) {
              setIsSidebarOpen(false);
            }
          }}
        >
          <MissionSidebar
            snapshot={uiSnapshot}
            surfaceTheme={surfaceTheme}
            onToggleTheme={() => setSurfaceTheme((current) => (current === "light" ? "dark" : "light"))}
            activeWorkspaceId={activeWorkspaceId}
            requestedAgentAction={agentActionRequest}
            connectionState={connectionState}
            collapsed={false}
            sidebarPinned
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
            onToggleCollapsed={() => setIsSidebarOpen(false)}
            onSelectWorkspace={(workspaceId) => {
              openWorkspaceOnCanvas(workspaceId);
              setIsSidebarOpen(false);
            }}
            onRefresh={refresh}
            onRunModelRefresh={runModelRefresh}
            onRunModelDiscover={runModelDiscover}
            onRunModelSetDefault={runModelSetDefault}
            onConnectModelProvider={runModelProviderLogin}
            onOpenModelSetup={() => openSetupWizard()}
            onOpenAddModels={openAddModelsDialog}
            onOpenCreateAgent={() => {
              setIsSidebarOpen(false);
              setIsSidebarCreateAgentDialogOpen(true);
            }}
            onOpenWorkspaceCreate={() => openWorkspaceWizard("basic")}
            onEditWorkspace={openWorkspaceWizardForEdit}
            onSnapshotChange={setSnapshot}
            pendingWorkspaceCreations={pendingWorkspaceCreations}
            onAgentCreationPending={handleAgentCreationPending}
            onAgentCreatedVisible={handleCreatedAgentVisible}
            onAgentActionRequestDismiss={() => setAgentActionRequest(null)}
            onAgentActionModalOpenChange={(open) => {
              setIsSidebarAgentActionModalOpen(open);
              if (open) {
                setIsSidebarOpen(false);
              }
            }}
          />
        </div>

        {isInspectorOpen ? (
          <button
            type="button"
            aria-label="Close inspector"
            className="pointer-events-auto fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px] lg:hidden"
            onClick={() => setIsInspectorOpen(false)}
          />
        ) : null}

        <div
          className={cn(
            "pointer-events-auto fixed inset-0 z-50 h-[100dvh] w-full overflow-hidden rounded-none transition-transform duration-300 lg:absolute lg:inset-x-auto lg:bottom-auto lg:right-0 lg:top-0 lg:z-30 lg:w-auto lg:overflow-visible lg:transition-none",
            isInspectorOpen
              ? cn(
                  "translate-y-0 w-full max-w-full lg:w-[var(--inspector-width)] lg:max-w-none lg:translate-y-0",
                  isResizingInspector ? "transition-none" : "transition-[width,transform] duration-200"
                )
              : "translate-y-full w-full lg:w-[52px] lg:translate-y-0 lg:transition-[width] lg:duration-300"
          )}
          style={{ "--inspector-width": `${inspectorWidth}px` } as CSSProperties}
          inert={!isInspectorOpen && isCompactViewport}
        >
          {isInspectorOpen ? (
            <button
              type="button"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize inspector"
              aria-valuemin={340}
              aria-valuemax={720}
              aria-valuenow={inspectorWidth}
              title="Drag to resize inspector. Use Left and Right arrow keys for precise resizing."
              onPointerDown={startInspectorResize}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  updateInspectorWidth(inspectorWidth + 24);
                } else if (event.key === "ArrowRight") {
                  event.preventDefault();
                  updateInspectorWidth(inspectorWidth - 24);
                } else if (event.key === "Home") {
                  event.preventDefault();
                  updateInspectorWidth(340);
                } else if (event.key === "End") {
                  event.preventDefault();
                  updateInspectorWidth(720);
                }
              }}
              className={cn(
                "group absolute -left-2 top-0 z-50 hidden h-full w-4 cursor-col-resize touch-none outline-none lg:block",
                "focus-visible:bg-cyan-300/10"
              )}
            >
              <span className={cn(
                "absolute bottom-4 left-1/2 top-4 w-px -translate-x-1/2 rounded-full transition-colors",
                isResizingInspector ? "bg-cyan-300" : "bg-transparent group-hover:bg-cyan-200/55 group-focus-visible:bg-cyan-300"
              )} />
            </button>
          ) : null}
          <InspectorPanel
            snapshot={uiSnapshot}
            surfaceTheme={surfaceTheme}
            selectedNodeId={selectedNodeId}
            activeTaskCard={activeTaskCardContext}
            agentDetailFocus={selectedAgentDetailFocus}
            lastMission={lastMission}
            onRefresh={refresh}
            onSnapshotChange={setSnapshot}
            onConfigureAgentCapabilities={handleConfigureAgentCapabilities}
            onConnectModelProvider={(provider) => {
              void runModelProviderLogin(provider, { autoOpenTerminal: true, forceAuth: true });
            }}
            collapsed={!isInspectorOpen}
            onToggleCollapsed={() => setIsInspectorOpen((current) => !current)}
            onSelectScope={selectInspectorScope}
            activeTab={activeInspectorTab}
            onActiveTabChange={handleInspectorTabChange}
            onBackFromChat={handleBackFromInspectorChat}
            onAbortTask={requestTaskAbort}
            onReviewTask={openTaskReview}
            detailExpanded={isInspectorDetailExpanded}
            onExpandDetail={() => setInspectorWidth((current) => Math.max(current, inspectorDetailWidth))}
          />
        </div>

        <AgentCapabilityEditorDialog
          open={Boolean(capabilityEditorRequest)}
          agentId={capabilityEditorRequest?.agentId ?? null}
          initialFocus={capabilityEditorRequest?.focus ?? "skills"}
          snapshot={uiSnapshot}
          onOpenChange={handleCapabilityEditorOpenChange}
          onSnapshotChange={(updater) => setSnapshot(updater)}
          onRefresh={async () => {
            await refreshSnapshot({ force: true });
          }}
          onSaved={() => setCapabilitiesRevision((current) => current + 1)}
          surfaceTheme={surfaceTheme}
        />

        <AgentModelPickerDialog
          open={Boolean(agentModelRequest)}
          agentId={agentModelRequest?.agentId ?? null}
          snapshot={uiSnapshot}
          onOpenChange={handleAgentModelPickerOpenChange}
          onSnapshotChange={(updater) => setSnapshot(updater)}
          onRefresh={async () => {
            await refreshSnapshot({ force: true });
          }}
          onOpenAddModels={openAddModelsFromModelPicker}
          surfaceTheme={surfaceTheme}
        />

        <div
          className={cn(
            "pointer-events-auto absolute bottom-[calc(env(safe-area-inset-bottom)+12px)] left-4 right-4 z-40 lg:bottom-6 lg:left-1/2 lg:right-auto lg:block lg:w-[min(800px,calc(100vw-320px))] lg:-translate-x-1/2",
            isInspectorOpen && "hidden"
          )}
        >
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
          {isComposerVisible ? (
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
            onOperationScheduled={(event) => {
              const optimisticTask = createOptimisticScheduledTaskRecord({ ...event, snapshot });
              setOptimisticMissionTasks((current) => [optimisticTask, ...current.filter((entry) => entry.operationJobId !== event.jobId)]);
              if (event.workspaceId) setActiveWorkspaceId(event.workspaceId);
              selectNode(optimisticTask.task.id);
              setIsInspectorOpen(true);
            }}
            onMissionResponse={(result, context) => {
              missionDispatchAbortControllersRef.current.delete(context.requestId);
              setLastMission(result);
              const waitingForTranscriptOutput =
                result.status === "stalled" && isMissingTranscriptActivityMessage(result.summary);

              setOptimisticMissionTasks((current) =>
                current.map((entry) =>
                  entry.requestId === context.requestId
                    ? {
                        ...entry,
                        dispatchId: result.dispatchId ?? entry.dispatchId,
                        task: updateOptimisticMissionTask(entry.task, {
                          dispatchId: result.dispatchId,
                          status:
                            waitingForTranscriptOutput
                              ? "running"
                              : result.status === "stalled"
                              ? "stalled"
                              : result.status === "cancelled"
                                ? "cancelled"
                                : result.status === "completed"
                                  ? "completed"
                                : "queued",
                          subtitle: result.summary,
                          bootstrapStage:
                            waitingForTranscriptOutput
                              ? "runtime-observed"
                              : result.status === "stalled"
                              ? "stalled"
                              : result.status === "cancelled"
                                ? "cancelled"
                                : result.status === "completed"
                                  ? "completed"
                                : "accepted",
                          feedEvent: {
                            id: `${entry.task.id}:response:${Date.now()}`,
                            kind:
                              result.status === "cancelled" ||
                              (result.status === "stalled" && !waitingForTranscriptOutput)
                                ? "warning"
                                : "status",
                            timestamp: new Date().toISOString(),
                            title:
                              waitingForTranscriptOutput
                                ? "Waiting for output"
                                : result.status === "stalled"
                                ? "Dispatch blocked"
                                : result.status === "cancelled"
                                  ? "Dispatch cancelled"
                                  : result.status === "completed"
                                    ? "Mission finished"
                                  : "Mission accepted",
                            detail:
                              waitingForTranscriptOutput
                                ? "The runtime is live, but AgentOS has not captured transcript output yet."
                                : result.summary || "Mission accepted and queued for OpenClaw execution.",
                            isError:
                              result.status === "cancelled" ||
                              (result.status === "stalled" && !waitingForTranscriptOutput)
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
          ) : null}
        </div>

        <WorkspaceChannelsDialog
          snapshot={uiSnapshot}
          workspaceId={activeWorkspaceId ?? uiSnapshot.workspaces[0]?.id ?? null}
          accountTargets={accountTargets}
          accountAccessRules={accountAccessRules}
          initialAgentId={workspaceChannelsInitialAgentId}
          initialSection={workspaceChannelsInitialSection}
          open={isWorkspaceChannelsOpen}
          onOpenChange={(open) => {
            setIsWorkspaceChannelsOpen(open);
            if (!open) {
              setWorkspaceChannelsInitialAgentId(null);
              setWorkspaceChannelsInitialSection("surfaces");
            }
          }}
          onRefresh={refresh}
          onSnapshotChange={setSnapshot}
          onAccountAccessRulesChange={setAccountAccessRules}
          onAccountTargetsChange={setAccountTargets}
          onConnectAccount={openConnectAccountDialog}
          surfaceTheme={surfaceTheme}
        />
        <ConnectAccountWizard
          open={isConnectAccountDialogOpen}
          workspace={activeWorkspaceForDialogs}
          onOpenChange={setIsConnectAccountDialogOpen}
          onSubmit={connectAccount}
          onSecureSubmit={connectSecureBrowserAccount}
          secureBrowserCapabilities={accountSecureBrowserCapabilities}
          agents={uiSnapshot.agents.filter(
            (agent) => agent.workspaceId === activeWorkspaceForDialogs?.id
          )}
          profiles={accountBrowserProfiles}
          profilesError={accountBrowserProfilesError}
          onRetryProfiles={() => void loadAccountBrowserProfiles()}
          onRestartGateway={() => void restartGatewayForAccountProfiles()}
          restartGatewayBusy={accountBrowserProfileRecoveryBusy === "restart"}
          surfaceTheme={surfaceTheme}
        />

        <ContextEngineDialog
          agentId={contextEngineAgentId}
          open={contextEngineAgentId !== null}
          onOpenChange={handleContextEngineOpenChange}
          onConfigureCapabilities={handleConfigureAgentCapabilities}
          capabilitiesRevision={capabilitiesRevision}
          surfaceTheme={surfaceTheme}
        />

        <TaskReviewDialog
          open={Boolean(taskReviewRequest)}
          task={activeTaskReviewTask}
          snapshot={uiSnapshot}
          surfaceTheme={surfaceTheme}
          onOpenChange={(open) => {
            if (!open) {
              closeTaskReview();
            }
          }}
          onAccept={acceptTaskReview}
          onContinue={continueTaskReview}
          onRetry={retryTaskReview}
          onDismiss={dismissTaskReview}
          onOpenEvidence={openTaskReviewEvidence}
          onOperationComplete={async () => {
            await refreshSnapshot({ force: true });
          }}
        />

        {shouldShowOnboarding ? (
          <OpenClawOnboarding
            key={`onboarding-${onboardingSessionKey}`}
            snapshot={snapshot}
            surfaceTheme={surfaceTheme}
            onToggleTheme={() => setSurfaceTheme((current) => (current === "light" ? "dark" : "light"))}
            stage={effectiveOnboardingStage}
            systemReady={onboardingRunState === "success" || isOpenClawOnboardingSystemReady}
            modelReady={
              modelSwitchFeedback.phase === "success" ||
              showOnboardingReadyState ||
              isOpenClawOnboardingModelReady
            }
            systemSetupRequired={requiresFreshInstallSystemSetup}
            systemStatusChecking={!hasReceivedLiveSnapshot}
            gatewayReachable={gatewayReachable}
            gatewayRegistered={gatewayRegistered}
            gatewayReady={gatewayReady}
            runtimeWritable={runtimeWritable}
            localModelStatus={localModelStatus}
            cliInstalled={cliInstalled}
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
            selectedThinking={selectedOnboardingThinking}
            discoveredModels={discoveredModels}
            onSelectedModelIdChange={setSelectedOnboardingModelId}
            onSelectedThinkingChange={setSelectedOnboardingThinking}
            onClearModelSwitchFeedback={() => setModelSwitchFeedback(initialModelSwitchFeedback)}
            onSnapshotChange={setSnapshot}
            onRunSystemSetup={runOpenClawOnboarding}
            onRunModelSetDefault={runModelSetDefault}
            onOpenAddModels={openAddModelsDialog}
            onOpenGatewayAuthSettings={openGatewayAuthSettings}
            onConnectChatGPT={(force = false) => {
              void runChatGptOnboarding(force);
            }}
            chatGptBrowserAuth={chatGptBrowserAuth}
            onSubmitChatGptRedirect={submitChatGptBrowserRedirect}
            onContinueFromAi={continueFromAi}
            onEnterAgentOS={enterAgentOS}
            onSkipSetup={dismissOnboarding}
            onCreateWorkspace={runLaunchpadWorkspaceCreate}
            onContinueToModels={continueToModelSetup}
            onBackToSystem={() => setOnboardingStage("system")}
            onSelectStage={(stage) => {
              setShowOnboardingReadyState(false);
              setOnboardingStage(resolveEffectiveWizardStage(stage, isOpenClawOnboardingSystemReady));
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
          onWorkspaceCreated={handleWorkspaceCreated}
          onWorkspaceCreationStarted={handleWorkspaceCreationStarted}
          onWorkspaceCreationFinished={handleWorkspaceCreationFinished}
          onWorkspaceUpdated={(workspaceId) => {
            openWorkspaceOnCanvas(workspaceId, { markPending: true });
          }}
        />

        <AddModelsDialog
          open={isAddModelsDialogOpen}
          onOpenChange={handleAddModelsDialogOpenChange}
          snapshot={snapshot}
          initialProvider={initialAddModelsProvider}
          onSwitchChatGptAccount={handleChatGptAccountSwitch}
          onSnapshotChange={setSnapshot}
          onProviderSnapshotReady={handleAddModelsProviderSnapshotReady}
          onBack={returnToAgentModelId ? handleBackToAgentModelPicker : undefined}
          surfaceTheme={surfaceTheme}
        />

        <CreateAgentDialog
          open={isSidebarCreateAgentDialogOpen}
          onOpenChange={setIsSidebarCreateAgentDialogOpen}
          snapshot={uiSnapshot}
          defaultWorkspaceId={activeWorkspaceId}
          onRefresh={refresh}
          onSnapshotChange={setSnapshot}
          onAgentCreationPending={handleAgentCreationPending}
          onAgentCreatedVisible={handleCreatedAgentVisible}
          surfaceTheme={surfaceTheme}
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
          updateCapabilityDiff={updateCapabilityDiff}
          updateCertificationScorecard={updateCertificationScorecard}
          updateTargetVersion={updateTargetVersion}
          updateMode={updateMode}
          activeRuntimeCount={activeRuntimeCount}
          updateInstallSummary={openClawInstallSummary}
          onUpdateDialogOpenChange={(open) => {
            if (updateRunState === "running") {
              setIsUpdateDialogOpen(open);
              return;
            }

            setIsUpdateDialogOpen(open);

            if (!open && updateRunState === "idle") {
              resetUpdateDialogState();
            }
          }}
          onRunOpenClawUpdate={(action) => {
            void runOpenClawUpdate(action);
          }}
        />
      </div>
    </div>
  );
}

function normalizeUpdateVersion(value: string | null | undefined) {
  const normalized = value?.trim().replace(/^v/i, "");
  return normalized || null;
}

function resolveLatestVersionFromUpdateInfo(value: string | null | undefined) {
  const text = value?.trim();
  if (!text) {
    return null;
  }

  return normalizeUpdateVersion(text.match(/Update available:\s*v?([0-9][0-9A-Za-z.-]*)/i)?.[1]);
}
