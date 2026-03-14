"use client";

import {
  AlertTriangle,
  ArrowUpCircle,
  CheckCircle2,
  LoaderCircle,
  MoonStar,
  RefreshCw,
  Settings2,
  SunMedium
} from "lucide-react";
import { useEffect, useRef, useState, type MutableRefObject } from "react";

import { MissionCanvas } from "@/components/mission-control/canvas";
import { CommandBar } from "@/components/mission-control/command-bar";
import { InspectorPanel } from "@/components/mission-control/inspector-panel";
import { OpenClawOnboarding } from "@/components/mission-control/openclaw-onboarding";
import { ResetDialog } from "@/components/mission-control/reset-dialog";
import { MissionSidebar } from "@/components/mission-control/sidebar";
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
import { toast } from "@/components/ui/sonner";
import { useMissionControlData } from "@/hooks/use-mission-control-data";
import { compactPath } from "@/lib/openclaw/presenters";
import {
  isOpenClawMissionReady as resolveOpenClawMissionReady,
  isOpenClawSystemReady as resolveOpenClawSystemReady
} from "@/lib/openclaw/readiness";
import { matchesMissionRuntime } from "@/lib/openclaw/runtime-matching";
import type {
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
  OpenClawUpdateStreamEvent,
  RuntimeRecord
} from "@/lib/openclaw/types";
import { cn } from "@/lib/utils";

type PendingMissionCard = {
  id: string;
  mission: string;
  agentId: string;
  workspaceId: string | null;
  submittedAt: number;
};

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

type SurfaceTheme = "dark" | "light";
type UpdateRunState = "idle" | "running" | "success" | "error";
type ResetPreviewState = "idle" | "loading" | "ready" | "error";
type OnboardingWizardStage = "system" | "models";
type GatewayControlAction = "start" | "stop" | "restart";
type ModelOnboardingIntent = "auto" | "refresh" | "discover" | "set-default" | "login-provider";

const surfaceThemeStorageKey = "mission-control-surface-theme";

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
  const [lastMission, setLastMission] = useState<MissionResponse | null>(null);
  const [pendingMission, setPendingMission] = useState<PendingMissionCard | null>(null);
  const [composeIntent, setComposeIntent] = useState<ComposeIntent | null>(null);
  const [hiddenRuntimeIds, setHiddenRuntimeIds] = useState<string[]>([]);
  const [agentActionRequest, setAgentActionRequest] = useState<AgentActionRequest | null>(null);
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
  const [gatewayControlAction, setGatewayControlAction] = useState<GatewayControlAction | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [surfaceTheme, setSurfaceTheme] = useState<SurfaceTheme>("dark");
  const [isWorkspaceWizardOpen, setIsWorkspaceWizardOpen] = useState(false);
  const [workspaceWizardInitialMode, setWorkspaceWizardInitialMode] = useState<"basic" | "advanced">("basic");
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const onboardingSuccessTimeoutRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const activeRuntimeCount = snapshot.runtimes.filter(
    (runtime) => runtime.status === "running" || runtime.status === "queued"
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
  const shouldShowOnboarding =
    (!isOpenClawReady && !isOnboardingDismissed) || showOnboardingReadyState || isOnboardingForcedOpen;

  useEffect(() => {
    if (!activeWorkspaceId || snapshot.workspaces.some((workspace) => workspace.id === activeWorkspaceId)) {
      return;
    }

    setActiveWorkspaceId(snapshot.workspaces[0]?.id ?? null);
  }, [snapshot.workspaces, activeWorkspaceId]);

  useEffect(() => {
    if (!selectedNodeId) {
      return;
    }

    const exists =
      snapshot.workspaces.some((entry) => entry.id === selectedNodeId) ||
      snapshot.agents.some((entry) => entry.id === selectedNodeId) ||
      snapshot.runtimes.some((entry) => entry.id === selectedNodeId) ||
      snapshot.models.some((entry) => entry.id === selectedNodeId);

    if (!exists) {
      setSelectedNodeId(activeWorkspaceId || snapshot.workspaces[0]?.id || null);
    }
  }, [snapshot, selectedNodeId, activeWorkspaceId]);

  useEffect(() => {
    if (selectedNodeId && hiddenRuntimeIds.includes(selectedNodeId)) {
      setSelectedNodeId(activeWorkspaceId || snapshot.workspaces[0]?.id || null);
    }
  }, [selectedNodeId, hiddenRuntimeIds, activeWorkspaceId, snapshot.workspaces]);

  useEffect(() => {
    if (!pendingMission) {
      return;
    }

    const syncedRuntime = snapshot.runtimes.some(
      (runtime) =>
        matchesMissionRuntime(runtime, pendingMission.mission, {
          agentId: pendingMission.agentId,
          submittedAt: pendingMission.submittedAt
        })
    );

    if (syncedRuntime) {
      setPendingMission(null);
    }
  }, [snapshot.runtimes, pendingMission]);

  useEffect(() => {
    const storedTheme = globalThis.localStorage?.getItem(surfaceThemeStorageKey);

    if (storedTheme === "dark" || storedTheme === "light") {
      setSurfaceTheme(storedTheme);
    }
  }, []);

  useEffect(() => {
    globalThis.localStorage?.setItem(surfaceThemeStorageKey, surfaceTheme);
  }, [surfaceTheme]);

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
    if (onboardingSuccessTimeoutRef.current) {
      globalThis.clearTimeout(onboardingSuccessTimeoutRef.current);
      onboardingSuccessTimeoutRef.current = null;
    }

    if (isOpenClawReady) {
      if (onboardingRunState !== "idle" || modelOnboardingRunState !== "idle") {
        setOnboardingRunState("success");
        setOnboardingPhase("ready");
        setOnboardingStatusMessage(null);
        setOnboardingResultMessage("OpenClaw and a usable default model are ready. Entering Mission Control...");
        setModelOnboardingRunState("success");
        setModelOnboardingPhase("ready");
        setModelOnboardingStatusMessage(null);
        setModelOnboardingResultMessage("A usable default model is ready.");
        setOnboardingStage("models");
        setShowOnboardingReadyState(true);
        onboardingSuccessTimeoutRef.current = globalThis.setTimeout(() => {
          setShowOnboardingReadyState(false);
        }, 1100);
      } else {
        setShowOnboardingReadyState(false);
      }
      return;
    }

    setShowOnboardingReadyState(false);
  }, [isOpenClawReady, onboardingRunState, modelOnboardingRunState]);

  useEffect(() => {
    return () => {
      if (onboardingSuccessTimeoutRef.current) {
        globalThis.clearTimeout(onboardingSuccessTimeoutRef.current);
      }
    };
  }, []);

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

  const checkForUpdates = async () => {
    setIsCheckingForUpdates(true);

    try {
      const nextSnapshot = await refreshSnapshot();
      const checkedAt = Date.now();
      const updateInfo = nextSnapshot.diagnostics.updateInfo?.trim();

      setLastCheckedAt(checkedAt);

      if (!nextSnapshot.diagnostics.installed) {
        toast.message("OpenClaw is unavailable.", {
          description: nextSnapshot.diagnostics.issues[0] || "Mission Control is running in fallback mode."
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
          ? `Mission Control now targets ${result.snapshot.diagnostics.configuredGatewayUrl || result.snapshot.diagnostics.gatewayUrl}.`
          : "Mission Control reverted to the local default gateway."
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
          : "Mission Control reverted to the default workspace root. Existing workspaces were not moved."
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
        : "Starting Mission Control reset..."
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
                    : "Mission Control reset completed.",
                  {
                    description: event.message
                  }
                );
              } else {
                toast.error(
                  resetDialogTarget === "full-uninstall"
                    ? "Full uninstall failed."
                    : "Mission Control reset failed.",
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
          : "Mission Control reset failed.",
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
          <MissionCanvas
            snapshot={snapshot}
            activeWorkspaceId={activeWorkspaceId}
            selectedNodeId={selectedNodeId}
            pendingMission={pendingMission}
            hiddenRuntimeIds={hiddenRuntimeIds}
            className="rounded-none"
            onEditAgent={(agentId) => {
              setSelectedNodeId(agentId);
              setAgentActionRequest({
                requestId: `edit:${agentId}:${Date.now()}`,
                kind: "edit",
                agentId
              });
            }}
            onDeleteAgent={(agentId) => {
              setSelectedNodeId(agentId);
              setAgentActionRequest({
                requestId: `delete:${agentId}:${Date.now()}`,
                kind: "delete",
                agentId
              });
            }}
            onReplyRuntime={(runtime) => {
              setComposeIntent({
                id: `reply:${runtime.id}:${Date.now()}`,
                mission: resolveRuntimePrompt(runtime),
                agentId: runtime.agentId,
                sourceKind: "reply",
                sourceLabel: runtime.title.trim() || runtime.subtitle.trim() || runtime.id
              });
            }}
            onCopyRuntimePrompt={async (runtime) => {
              const prompt = resolveRuntimePrompt(runtime);
              setComposeIntent({
                id: `copy:${runtime.id}:${Date.now()}`,
                mission: prompt,
                agentId: runtime.agentId,
                sourceKind: "copy",
                sourceLabel: runtime.title.trim() || runtime.subtitle.trim() || runtime.id
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
            onHideRuntime={(runtimeId) => {
              setHiddenRuntimeIds((current) =>
                current.includes(runtimeId) ? current : [...current, runtimeId]
              );
            }}
            onSelectNode={setSelectedNodeId}
          />
        </div>
      </div>

      <div
        className={cn(
          "pointer-events-none absolute top-0 z-40 hidden lg:block",
          isSidebarOpen ? "lg:left-[442px]" : "lg:left-[118px]",
          isInspectorOpen ? "lg:right-[442px]" : "lg:right-[118px]"
        )}
      >
        <CanvasTopBar
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
          <CanvasTitlePill surfaceTheme={surfaceTheme} />
        </div>

        <div
          className={cn(
            "pointer-events-auto absolute left-4 top-4 z-30",
            isSidebarOpen
              ? "bottom-[calc(env(safe-area-inset-bottom)+124px)] w-[calc(100vw-112px)] max-w-[300px] lg:bottom-[244px] lg:top-6 lg:w-[394px] lg:max-w-none"
              : "w-[78px] lg:bottom-[244px] lg:top-6"
          )}
        >
          <MissionSidebar
            snapshot={snapshot}
            activeWorkspaceId={activeWorkspaceId}
            requestedAgentAction={agentActionRequest}
            connectionState={connectionState}
            collapsed={!isSidebarOpen}
            onToggleCollapsed={() => setIsSidebarOpen((current) => !current)}
            onSelectWorkspace={(workspaceId) => {
              setActiveWorkspaceId(workspaceId);
              setSelectedNodeId(workspaceId);
            }}
            onRefresh={refresh}
          />
        </div>

        <div
          className={cn(
            "pointer-events-auto absolute right-4 top-4 z-30",
            isInspectorOpen
              ? "bottom-[calc(env(safe-area-inset-bottom)+124px)] w-[calc(100vw-112px)] max-w-[300px] lg:bottom-[244px] lg:top-6 lg:w-[394px] lg:max-w-none"
              : "w-[78px] lg:bottom-[244px] lg:top-6"
          )}
        >
          <InspectorPanel
            snapshot={snapshot}
            selectedNodeId={selectedNodeId}
            lastMission={lastMission}
            collapsed={!isInspectorOpen}
            onToggleCollapsed={() => setIsInspectorOpen((current) => !current)}
          />
        </div>

        <div className="pointer-events-auto absolute bottom-[calc(env(safe-area-inset-bottom)+12px)] left-4 right-4 z-40 lg:bottom-6 lg:left-1/2 lg:right-auto lg:w-[min(800px,calc(100vw-320px))] lg:-translate-x-1/2">
          <CommandBar
            snapshot={snapshot}
            activeWorkspaceId={activeWorkspaceId}
            selectedNodeId={selectedNodeId}
            composeIntent={composeIntent}
            onRefresh={refresh}
            onOpenWorkspaceCreate={() => {
              setWorkspaceWizardInitialMode("basic");
              setIsWorkspaceWizardOpen(true);
            }}
            onMissionResponse={setLastMission}
            onMissionDispatchStart={setPendingMission}
            onMissionDispatchComplete={(status) => {
              if (status === "error") {
                setPendingMission(null);
              }
            }}
          />
        </div>

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
            onContinueToModels={() => setOnboardingStage("models")}
            onBackToSystem={() => setOnboardingStage("system")}
            onDismiss={dismissOnboarding}
            canDismiss={
              !showOnboardingReadyState &&
              onboardingRunState !== "running" &&
              modelOnboardingRunState !== "running"
            }
          />
        ) : null}

        <WorkspaceWizardDialog
          open={isWorkspaceWizardOpen}
          onOpenChange={setIsWorkspaceWizardOpen}
          initialMode={workspaceWizardInitialMode}
          surfaceTheme={surfaceTheme}
          snapshot={snapshot}
          onRefresh={refresh}
          onWorkspaceCreated={(workspaceId) => {
            setActiveWorkspaceId(workspaceId);
            setSelectedNodeId(workspaceId);
          }}
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

        <div
          className={cn(
            "pointer-events-auto absolute bottom-3 right-4 z-30 text-[11px] tracking-[0.04em] lg:bottom-4 lg:right-6",
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

function resolveUpdateDialogTitle(runState: UpdateRunState) {
  if (runState === "running") {
    return "Updating OpenClaw";
  }

  if (runState === "success") {
    return "Update complete";
  }

  if (runState === "error") {
    return "Update failed";
  }

  return "Update OpenClaw";
}

function resolveUpdateDialogDescription(runState: UpdateRunState) {
  if (runState === "running") {
    return "OpenClaw is being updated now. Local gateway activity may pause briefly while the CLI is replaced.";
  }

  if (runState === "success") {
    return "The CLI update finished. Review the result below, then close this panel when you are done.";
  }

  if (runState === "error") {
    return "The update did not complete cleanly. Review the result and captured output before trying again.";
  }

  return "This runs openclaw update against the installed CLI and may briefly interrupt local gateway activity.";
}

function resolveUpdateResultPanelClassName(runState: UpdateRunState, surfaceTheme: SurfaceTheme) {
  if (runState === "success") {
    return surfaceTheme === "light"
      ? "border-emerald-300 bg-emerald-50/80 text-emerald-950"
      : "border-emerald-300/25 bg-emerald-300/10 text-emerald-50";
  }

  return surfaceTheme === "light"
    ? "border-rose-300 bg-rose-50/90 text-rose-950"
    : "border-rose-300/25 bg-rose-300/10 text-rose-50";
}

function resolveUpdateResultIconWrapClassName(runState: UpdateRunState, surfaceTheme: SurfaceTheme) {
  if (runState === "success") {
    return surfaceTheme === "light"
      ? "border-emerald-300 bg-white/80 text-emerald-700"
      : "border-emerald-300/25 bg-emerald-300/10 text-emerald-200";
  }

  return surfaceTheme === "light"
    ? "border-rose-300 bg-white/80 text-rose-700"
    : "border-rose-300/25 bg-rose-300/10 text-rose-200";
}

function CanvasTitlePill({ surfaceTheme }: { surfaceTheme: SurfaceTheme }) {
  return (
    <div
      className={cn(
        "flex h-11 items-center gap-3 rounded-full border px-4 shadow-[0_18px_50px_rgba(0,0,0,0.24)] backdrop-blur-xl",
        surfaceTheme === "light"
          ? "border-[#d9c9bc]/90 bg-[#f8f5f0]/86 shadow-[0_18px_42px_rgba(161,125,101,0.14)]"
          : "border-cyan-300/10 bg-slate-950/45"
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center overflow-hidden rounded-[8px] border",
            surfaceTheme === "light"
              ? "border-[#d1bcad] bg-[#f5ece4]"
              : "border-white/[0.08] bg-white/[0.03]"
          )}
        >
          <video
            aria-hidden="true"
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
            className="h-full w-full scale-[1.15] object-cover"
          >
            <source src="/assets/logo.webm" type="video/webm" />
          </video>
        </span>
        <p
          className={cn(
            "text-[10px] tracking-[0.18em]",
            surfaceTheme === "light" ? "text-[#8a7261]" : "text-slate-500"
          )}
        >
          AgentOS
        </p>
      </div>
      <span
        aria-hidden="true"
        className={cn(
          "h-4 w-px",
          surfaceTheme === "light" ? "bg-[#cdb7a8]/80" : "bg-white/[0.08]"
        )}
      />
      <h2
        className={cn(
          "font-display text-[0.88rem]",
          surfaceTheme === "light" ? "text-[#816958]/80" : "text-slate-400/75"
        )}
      >
        Mission Control
      </h2>
    </div>
  );
}

function CanvasTopBar({
  snapshot,
  surfaceTheme,
  settingsRef,
  isSettingsOpen,
  gatewayDraft,
  workspaceRootDraft,
  isSavingGateway,
  isSavingWorkspaceRoot,
  isCheckingForUpdates,
  selectedModelId,
  modelOnboardingRunState,
  gatewayControlAction,
  lastCheckedAt,
  onToggleTheme,
  onToggleSettings,
  onGatewayDraftChange,
  onWorkspaceRootDraftChange,
  onSelectedModelIdChange,
  onSaveGatewaySettings,
  onSaveWorkspaceRootSettings,
  onCheckForUpdates,
  onControlGateway,
  onOpenSetupWizard,
  onRunModelRefresh,
  onRunModelSetDefault,
  onOpenUpdateDialog,
  onOpenResetDialog
}: {
  snapshot: MissionControlSnapshot;
  surfaceTheme: SurfaceTheme;
  settingsRef: MutableRefObject<HTMLDivElement | null>;
  isSettingsOpen: boolean;
  gatewayDraft: string;
  workspaceRootDraft: string;
  isSavingGateway: boolean;
  isSavingWorkspaceRoot: boolean;
  isCheckingForUpdates: boolean;
  selectedModelId: string;
  modelOnboardingRunState: UpdateRunState;
  gatewayControlAction: GatewayControlAction | null;
  lastCheckedAt: number | null;
  onToggleTheme: () => void;
  onToggleSettings: () => void;
  onGatewayDraftChange: (value: string) => void;
  onWorkspaceRootDraftChange: (value: string) => void;
  onSelectedModelIdChange: (value: string) => void;
  onSaveGatewaySettings: (value: string | null) => Promise<void>;
  onSaveWorkspaceRootSettings: (value: string | null) => Promise<void>;
  onCheckForUpdates: () => Promise<void>;
  onControlGateway: (action: GatewayControlAction) => Promise<void>;
  onOpenSetupWizard: (stage?: OnboardingWizardStage) => void;
  onRunModelRefresh: () => Promise<void>;
  onRunModelSetDefault: (modelId?: string) => Promise<void>;
  onOpenUpdateDialog: () => void;
  onOpenResetDialog: (target: ResetTarget) => void;
}) {
  const isOpenClawReady = resolveOpenClawMissionReady(snapshot);
  const isGatewayControlRunning = gatewayControlAction !== null;
  const isModelActionRunning = modelOnboardingRunState === "running";
  const settingsSecondaryButtonStyles = settingsButtonClassName(surfaceTheme, "secondary");
  const settingsPrimaryButtonStyles = settingsButtonClassName(surfaceTheme, "primary");
  const settingsWarningButtonStyles = settingsButtonClassName(surfaceTheme, "warning");
  const settingsWarningSolidButtonStyles = settingsButtonClassName(surfaceTheme, "warningSolid");
  const settingsChromeButtonStyles = settingsChromeButtonClassName(surfaceTheme);
  const settingsThemeSwitchTrackStyles = settingsThemeSwitchTrackClassName(surfaceTheme);
  const settingsThemeSwitchThumbStyles = settingsThemeSwitchThumbClassName(surfaceTheme);

  return (
    <div className="flex w-full items-center justify-between px-0 pt-6">
      <CanvasTitlePill surfaceTheme={surfaceTheme} />

      <div ref={settingsRef} className="pointer-events-auto relative">
        <div
          className={cn(
            "flex h-11 items-center gap-3 rounded-full border px-4 shadow-[0_18px_50px_rgba(0,0,0,0.24)] backdrop-blur-xl",
            surfaceTheme === "light"
              ? "border-[#d9c9bc]/90 bg-[#f8f5f0]/86 shadow-[0_18px_42px_rgba(161,125,101,0.14)]"
              : "border-cyan-300/10 bg-slate-950/45"
          )}
        >
          <div className="flex items-baseline gap-[3px]">
            <span
              className={cn(
                "text-[10px] uppercase tracking-[0.3em]",
                surfaceTheme === "light" ? "text-[#8a7261]" : "text-slate-500"
              )}
            >
              OPENCLAW
            </span>
            <span
              className={cn(
                "font-mono text-[8px] tracking-[0.04em]",
                surfaceTheme === "light" ? "text-[#6f5a4b]/85" : "text-slate-300/80"
              )}
            >
              v{snapshot.diagnostics.version || "unknown"}
            </span>
          </div>
          <span
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.22em]",
              statusBadgeClassName(snapshot.diagnostics.health, surfaceTheme)
            )}
          >
            <span
              aria-hidden="true"
              className={cn("h-2 w-2 rounded-full shadow-[0_0_12px_currentColor]", statusDotClassName(snapshot.diagnostics.health))}
            />
            {formatHealthLabel(snapshot.diagnostics.health)}
          </span>
          <button
            type="button"
            role="switch"
            aria-label={surfaceTheme === "light" ? "Switch to dark theme" : "Switch to light theme"}
            aria-checked={surfaceTheme === "light"}
            onClick={onToggleTheme}
            className={settingsThemeSwitchTrackStyles}
          >
            <span
              className={settingsThemeSwitchThumbStyles}
            >
              {surfaceTheme === "light" ? (
                <SunMedium className="h-3 w-3" />
              ) : (
                <MoonStar className="h-3 w-3" />
              )}
            </span>
          </button>
          <button
            type="button"
            aria-label="Open settings"
            aria-expanded={isSettingsOpen}
            aria-haspopup="menu"
            onClick={onToggleSettings}
            className={settingsChromeButtonStyles}
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
        </div>

        {isSettingsOpen ? (
          <div
            role="menu"
            aria-label="OpenClaw settings"
            className={cn(
              "absolute right-0 top-[calc(100%+12px)] z-[70] max-h-[min(82vh,calc(100svh-96px))] w-[300px] overflow-y-auto overscroll-contain rounded-[20px] border p-3 shadow-[0_22px_64px_rgba(0,0,0,0.24)] backdrop-blur-2xl",
              surfaceTheme === "light"
                ? "border-[#dbc9bc]/90 bg-[rgba(252,247,241,0.95)] text-[#4a382c] shadow-[0_24px_60px_rgba(161,125,101,0.18)]"
                : "border-cyan-300/12 bg-[rgba(10,16,28,0.9)] text-slate-100"
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p
                  className={cn(
                    "text-[8px] uppercase tracking-[0.24em]",
                    surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-500"
                  )}
                >
                  Settings
                </p>
                <h3
                  className={cn(
                    "mt-0.5 font-display text-[14px]",
                    surfaceTheme === "light" ? "text-[#3f2f24]" : "text-white"
                  )}
                >
                  OpenClaw surface
                </h3>
              </div>
              <span
                className={cn(
                  "rounded-full border px-1.5 py-0.5 text-[8px] uppercase tracking-[0.18em]",
                  surfaceTheme === "light"
                    ? "border-[#d6c0b0] bg-[#f3e7dc] text-[#8a7261]"
                    : "border-white/10 bg-white/[0.06] text-slate-400"
                )}
              >
                {snapshot.mode}
              </span>
            </div>

            {snapshot.diagnostics.updateAvailable && snapshot.diagnostics.latestVersion ? (
              <div
                className={cn(
                  "mt-2.5 rounded-[18px] border px-3 py-3",
                  surfaceTheme === "light"
                    ? "border-amber-300/90 bg-[linear-gradient(135deg,rgba(255,247,237,0.98),rgba(252,231,214,0.94))] shadow-[0_16px_36px_rgba(194,120,55,0.16)]"
                    : "border-amber-300/30 bg-[linear-gradient(135deg,rgba(71,35,8,0.62),rgba(33,20,8,0.82))] shadow-[0_18px_42px_rgba(245,158,11,0.14)]"
                )}
              >
                <div className="flex items-start justify-between gap-2.5">
                  <div>
                    <p
                      className={cn(
                        "text-[8px] uppercase tracking-[0.18em]",
                        surfaceTheme === "light" ? "text-amber-800/70" : "text-amber-200/80"
                      )}
                    >
                      Update available
                    </p>
                    <div className="mt-1.5 flex items-baseline gap-1.5">
                      <p
                        className={cn(
                          "font-display text-[0.98rem]",
                          surfaceTheme === "light" ? "text-amber-950" : "text-amber-50"
                        )}
                      >
                        v{snapshot.diagnostics.latestVersion}
                      </p>
                      <p
                        className={cn(
                          "text-[9px]",
                          surfaceTheme === "light" ? "text-amber-900/70" : "text-amber-100/70"
                        )}
                      >
                        from v{snapshot.diagnostics.version || "unknown"}
                      </p>
                    </div>
                  </div>
                  <ArrowUpCircle
                    className={cn(
                      "mt-0.5 h-4 w-4",
                      surfaceTheme === "light" ? "text-amber-700" : "text-amber-300"
                    )}
                  />
                </div>
                <p
                  className={cn(
                    "mt-1.5 text-[10px] leading-[1.05rem]",
                    surfaceTheme === "light" ? "text-amber-950/80" : "text-amber-50/85"
                  )}
                >
                  A newer OpenClaw release was detected. You can update directly from Mission Control.
                </p>
                <button
                  type="button"
                  onClick={onOpenUpdateDialog}
                  className={cn("mt-2.5 inline-flex items-center justify-center py-1", settingsWarningSolidButtonStyles)}
                >
                  Update now
                </button>
              </div>
            ) : null}

            <div
              className={cn(
                "mt-2.5 rounded-[16px] border px-2.5 py-2",
                surfaceTheme === "light"
                  ? "border-[#e6d7cb] bg-[#fffaf6]"
                  : "border-white/8 bg-white/[0.03]"
              )}
            >
              <p
                className={cn(
                  "text-[8px] uppercase tracking-[0.18em]",
                  surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-500"
                )}
              >
                OpenClaw version
              </p>
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <p
                  className={cn(
                    "font-display text-[0.88rem]",
                    surfaceTheme === "light" ? "text-[#3f2f24]" : "text-white"
                  )}
                >
                  {snapshot.diagnostics.version || "Unavailable"}
                </p>
                {snapshot.diagnostics.updateChannel ? (
                  <span
                    className={cn(
                      "rounded-full border px-1.5 py-0.5 text-[8px] uppercase tracking-[0.18em]",
                      surfaceTheme === "light"
                        ? "border-[#dcc6b6] bg-[#f4e8dd] text-[#876c5a]"
                        : "border-cyan-400/14 bg-cyan-400/8 text-cyan-100"
                    )}
                  >
                    {snapshot.diagnostics.updateChannel}
                  </span>
                ) : null}
              </div>
              <p
                className={cn(
                  "mt-1.5 text-[10px] leading-[1.05rem]",
                  surfaceTheme === "light" ? "text-[#816958]" : "text-slate-400"
                )}
              >
                {snapshot.diagnostics.updateInfo?.trim() ||
                  "No additional update message was returned in the latest OpenClaw status snapshot."}
              </p>
              <div className="mt-3">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void onCheckForUpdates();
                  }}
                  disabled={isCheckingForUpdates}
                  className={cn(
                    "w-full disabled:cursor-wait",
                    snapshot.diagnostics.updateAvailable
                      ? settingsWarningButtonStyles
                      : settingsSecondaryButtonStyles
                  )}
                >
                  {isCheckingForUpdates ? (
                    <>
                      <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      Checking...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                      Check for updates
                    </>
                  )}
                </Button>
                {lastCheckedAt ? (
                  <p
                    className={cn(
                      "mt-2 text-center text-[9px]",
                      surfaceTheme === "light" ? "text-[#8f7664]" : "text-slate-500"
                    )}
                  >
                    Last checked at{" "}
                    {new Date(lastCheckedAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit"
                    })}
                  </p>
                ) : null}
              </div>
            </div>

            <div
              className={cn(
                "mt-2 rounded-[16px] border px-2.5 py-2.5",
                surfaceTheme === "light"
                  ? "border-[#e6d7cb] bg-[#fffaf6]"
                  : "border-white/8 bg-white/[0.03]"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p
                    className={cn(
                      "text-[8px] uppercase tracking-[0.18em]",
                      surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-500"
                    )}
                  >
                    Setup center
                  </p>
                  <p
                    className={cn(
                      "mt-1 text-[10px] leading-[1.05rem]",
                      surfaceTheme === "light" ? "text-[#816958]" : "text-slate-400"
                    )}
                  >
                    Reopen the wizard, control the gateway, and manage the minimum model setup from one place.
                  </p>
                </div>
                <span
                  className={cn(
                    "rounded-full border px-1.5 py-0.5 text-[8px] uppercase tracking-[0.18em]",
                    isOpenClawReady
                      ? surfaceTheme === "light"
                        ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                        : "border-emerald-300/25 bg-emerald-300/10 text-emerald-200"
                      : surfaceTheme === "light"
                        ? "border-amber-300 bg-amber-50 text-amber-700"
                        : "border-amber-300/25 bg-amber-300/10 text-amber-200"
                  )}
                >
                  {isOpenClawReady ? "Ready" : "Needs attention"}
                </span>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => onOpenSetupWizard(snapshot.diagnostics.rpcOk ? "models" : "system")}
                  className={settingsSecondaryButtonStyles}
                >
                  Open wizard
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={isModelActionRunning}
                  onClick={() => {
                    void onRunModelRefresh();
                  }}
                  className={settingsSecondaryButtonStyles}
                >
                  Refresh setup
                </Button>
              </div>

              <div
                className={cn(
                  "mt-3 rounded-[14px] border px-2.5 py-2.5",
                  surfaceTheme === "light"
                    ? "border-[#eadcd0] bg-white"
                    : "border-white/10 bg-white/[0.03]"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className={cn("text-[11px]", surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-400")}>
                      Gateway control
                    </p>
                    <p
                      className={cn(
                        "mt-0.5 text-[10px] leading-[1.05rem]",
                        surfaceTheme === "light" ? "text-[#816958]" : "text-slate-500"
                      )}
                    >
                      {snapshot.diagnostics.rpcOk
                        ? "Live RPC connection is online."
                        : snapshot.diagnostics.loaded
                          ? "Service is loaded but Mission Control cannot verify RPC yet."
                          : "Service is not loaded on this machine yet."}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "rounded-full border px-1.5 py-0.5 text-[8px] uppercase tracking-[0.18em]",
                      snapshot.diagnostics.rpcOk
                        ? surfaceTheme === "light"
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                          : "border-emerald-300/25 bg-emerald-300/10 text-emerald-200"
                        : surfaceTheme === "light"
                          ? "border-amber-300 bg-amber-50 text-amber-700"
                          : "border-amber-300/25 bg-amber-300/10 text-amber-200"
                    )}
                  >
                    {snapshot.diagnostics.rpcOk ? "Online" : snapshot.diagnostics.loaded ? "Service only" : "Offline"}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={isGatewayControlRunning || snapshot.diagnostics.rpcOk}
                    onClick={() => {
                      void onControlGateway("start");
                    }}
                    className={settingsSecondaryButtonStyles}
                  >
                    {gatewayControlAction === "start" ? "Starting..." : "Start"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={isGatewayControlRunning || !snapshot.diagnostics.loaded}
                    onClick={() => {
                      void onControlGateway("restart");
                    }}
                    className={settingsSecondaryButtonStyles}
                  >
                    {gatewayControlAction === "restart" ? "Restarting..." : "Restart"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={isGatewayControlRunning || !snapshot.diagnostics.loaded}
                    onClick={() => {
                      void onControlGateway("stop");
                    }}
                    className={settingsSecondaryButtonStyles}
                  >
                    {gatewayControlAction === "stop" ? "Stopping..." : "Stop"}
                  </Button>
                </div>
              </div>

              <div
                className={cn(
                  "mt-2 rounded-[14px] border px-2.5 py-2.5",
                  surfaceTheme === "light"
                    ? "border-[#eadcd0] bg-white"
                    : "border-white/10 bg-white/[0.03]"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className={cn("text-[11px]", surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-400")}>
                      Model setup
                    </p>
                    <p
                      className={cn(
                        "mt-0.5 text-[10px] leading-[1.05rem]",
                        surfaceTheme === "light" ? "text-[#816958]" : "text-slate-500"
                      )}
                    >
                      Default model: {snapshot.diagnostics.modelReadiness.resolvedDefaultModel || snapshot.diagnostics.modelReadiness.defaultModel || "Not set"}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "rounded-full border px-1.5 py-0.5 text-[8px] uppercase tracking-[0.18em]",
                      snapshot.diagnostics.modelReadiness.ready
                        ? surfaceTheme === "light"
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                          : "border-emerald-300/25 bg-emerald-300/10 text-emerald-200"
                        : surfaceTheme === "light"
                          ? "border-amber-300 bg-amber-50 text-amber-700"
                          : "border-amber-300/25 bg-amber-300/10 text-amber-200"
                    )}
                  >
                    {snapshot.diagnostics.modelReadiness.availableModelCount}/{snapshot.diagnostics.modelReadiness.totalModelCount}
                  </span>
                </div>

                <select
                  value={selectedModelId}
                  onChange={(event) => onSelectedModelIdChange(event.target.value)}
                  disabled={isModelActionRunning}
                  className={cn(
                    "mt-2.5 h-9 w-full rounded-[14px] border px-2.5 text-[11px]",
                    surfaceTheme === "light"
                      ? "border-[#d9c9bc] bg-[#fffdfb] text-[#4f3d31]"
                      : "border-white/10 bg-white/[0.04] text-slate-100"
                  )}
                >
                  <option value="">Auto choose</option>
                  {snapshot.models
                    .filter((model) => model.available !== false && !model.missing)
                    .map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.name} · {model.provider}
                      </option>
                    ))}
                </select>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={isModelActionRunning}
                    onClick={() => {
                      void onRunModelSetDefault();
                    }}
                    className={settingsSecondaryButtonStyles}
                  >
                    {isModelActionRunning ? "Working..." : "Use selected"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={isModelActionRunning}
                    onClick={() => {
                      onOpenSetupWizard("models");
                    }}
                    className={settingsSecondaryButtonStyles}
                  >
                    +Add more
                  </Button>
                </div>
              </div>
            </div>

            <div
              className={cn(
                "mt-2 rounded-[16px] border px-2.5 py-2.5",
                surfaceTheme === "light"
                  ? "border-[#e6d7cb] bg-[#fffaf6]"
                  : "border-white/8 bg-white/[0.03]"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Label
                    htmlFor="workspace-root"
                    className={cn("text-[11px]", surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-500")}
                  >
                    Workspace root
                  </Label>
                  <p
                    className={cn(
                      "mt-0.5 text-[10px] leading-[1.05rem]",
                      surfaceTheme === "light" ? "text-[#816958]" : "text-slate-400"
                    )}
                  >
                    Default parent path for newly created workspaces. Existing workspaces stay at their current paths.
                  </p>
                </div>
                <span
                  className={cn(
                    "rounded-full border px-1.5 py-0.5 text-[8px] uppercase tracking-[0.18em]",
                    surfaceTheme === "light"
                      ? "border-[#dcc6b6] bg-[#f4e8dd] text-[#876c5a]"
                      : "border-white/10 bg-white/[0.05] text-slate-300"
                  )}
                >
                  New only
                </span>
              </div>
              <Input
                id="workspace-root"
                value={workspaceRootDraft}
                onChange={(event) => onWorkspaceRootDraftChange(event.target.value)}
                placeholder="~/Documents/Shared/projects"
                disabled={isSavingWorkspaceRoot}
                style={surfaceTheme === "light" ? { colorScheme: "light" } : undefined}
                className={cn(
                  "mt-2.5 h-9 rounded-[14px] px-2.5 text-[11px]",
                  surfaceTheme === "light"
                    ? "border-[#d9c9bc] bg-[#fffdfb] text-[#4f3d31] caret-[#7c5a46] placeholder:text-[#b29b8b] shadow-[inset_0_0_0_1000px_#fffdfb] [-webkit-text-fill-color:#4f3d31] focus-visible:ring-[#c8946f]/45"
                    : "border-white/10 bg-white/[0.04] text-slate-100 placeholder:text-slate-500"
                )}
              />
              <p
                className={cn(
                  "mt-1.5 break-all font-mono text-[9px] leading-[1rem]",
                  surfaceTheme === "light" ? "text-[#6f5a4b]" : "text-slate-300"
                )}
              >
                Configured root: {snapshot.diagnostics.configuredWorkspaceRoot ? compactPath(snapshot.diagnostics.configuredWorkspaceRoot) : "default"}
              </p>
              <p
                className={cn(
                  "mt-1 break-all font-mono text-[9px] leading-[1rem]",
                  surfaceTheme === "light" ? "text-[#6f5a4b]" : "text-slate-300"
                )}
              >
                Effective root: {compactPath(snapshot.diagnostics.workspaceRoot)}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={isSavingWorkspaceRoot}
                  onClick={() => {
                    void onSaveWorkspaceRootSettings(null);
                  }}
                  className={settingsSecondaryButtonStyles}
                >
                  Use default
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={isSavingWorkspaceRoot}
                  onClick={() => {
                    void onSaveWorkspaceRootSettings(workspaceRootDraft);
                  }}
                  className={settingsPrimaryButtonStyles}
                >
                  {isSavingWorkspaceRoot ? (
                    <>
                      <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save root"
                  )}
                </Button>
              </div>
            </div>

            <div
              className={cn(
                "mt-2 rounded-[16px] border px-2.5 py-2.5",
                surfaceTheme === "light"
                  ? "border-[#e6d7cb] bg-[#fffaf6]"
                  : "border-white/8 bg-white/[0.03]"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Label
                    htmlFor="gateway-url"
                    className={cn("text-[11px]", surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-500")}
                  >
                    OpenClaw gateway
                  </Label>
                  <p
                    className={cn(
                      "mt-0.5 text-[10px] leading-[1.05rem]",
                      surfaceTheme === "light" ? "text-[#816958]" : "text-slate-400"
                    )}
                  >
                    Enter a `ws://` or `wss://` endpoint. Leave it empty to use the local default gateway.
                  </p>
                </div>
                <span
                  className={cn(
                    "rounded-full border px-1.5 py-0.5 text-[8px] uppercase tracking-[0.18em]",
                    surfaceTheme === "light"
                      ? "border-[#dcc6b6] bg-[#f4e8dd] text-[#876c5a]"
                      : "border-white/10 bg-white/[0.05] text-slate-300"
                  )}
                >
                  {snapshot.diagnostics.bindMode || "default"}
                </span>
              </div>

              <Input
                id="gateway-url"
                value={gatewayDraft}
                onChange={(event) => onGatewayDraftChange(event.target.value)}
                placeholder="ws://127.0.0.1:18789"
                disabled={isSavingGateway}
                style={surfaceTheme === "light" ? { colorScheme: "light" } : undefined}
                className={cn(
                  "mt-2.5 h-9 rounded-[14px] px-2.5 text-[11px]",
                  surfaceTheme === "light"
                    ? "border-[#d9c9bc] bg-[#fffdfb] text-[#4f3d31] caret-[#7c5a46] placeholder:text-[#b29b8b] shadow-[inset_0_0_0_1000px_#fffdfb] [-webkit-text-fill-color:#4f3d31] focus-visible:ring-[#c8946f]/45"
                    : "border-white/10 bg-white/[0.04] text-slate-100 placeholder:text-slate-500"
                )}
              />

              <p
                className={cn(
                  "mt-1.5 break-all font-mono text-[9px] leading-[1rem]",
                  surfaceTheme === "light" ? "text-[#6f5a4b]" : "text-slate-300"
                )}
              >
                Configured endpoint: {snapshot.diagnostics.configuredGatewayUrl || "local default"}
              </p>
              <p
                className={cn(
                  "mt-1 break-all font-mono text-[9px] leading-[1rem]",
                  surfaceTheme === "light" ? "text-[#6f5a4b]" : "text-slate-300"
                )}
              >
                Effective endpoint: {snapshot.diagnostics.gatewayUrl}
              </p>

              <div className="mt-3 flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={isSavingGateway}
                  onClick={() => {
                    void onSaveGatewaySettings(null);
                  }}
                  className={settingsSecondaryButtonStyles}
                >
                  Use local
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={isSavingGateway}
                  onClick={() => {
                    void onSaveGatewaySettings(gatewayDraft);
                  }}
                  className={settingsPrimaryButtonStyles}
                >
                  {isSavingGateway ? (
                    <>
                      <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save gateway"
                  )}
                </Button>
              </div>
            </div>

            <div
              className={cn(
                "mt-2 rounded-[16px] border px-2.5 py-2.5",
                surfaceTheme === "light"
                  ? "border-rose-200 bg-[linear-gradient(135deg,rgba(255,245,245,0.96),rgba(255,236,236,0.92))]"
                  : "border-rose-400/18 bg-[linear-gradient(135deg,rgba(62,16,24,0.46),rgba(24,10,15,0.82))]"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p
                    className={cn(
                      "text-[8px] uppercase tracking-[0.18em]",
                      surfaceTheme === "light" ? "text-rose-700/80" : "text-rose-200/75"
                    )}
                  >
                    Danger zone
                  </p>
                  <p
                    className={cn(
                      "mt-1 text-[10px] leading-[1.05rem]",
                      surfaceTheme === "light" ? "text-rose-900/80" : "text-rose-100/80"
                    )}
                  >
                    Review exactly which workspaces, agents, integration files, and packages would be removed before taking irreversible actions.
                  </p>
                </div>
                <AlertTriangle
                  className={cn(
                    "mt-0.5 h-4 w-4",
                    surfaceTheme === "light" ? "text-rose-700" : "text-rose-200"
                  )}
                />
              </div>

              <div className="mt-3 grid gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => onOpenResetDialog("mission-control")}
                  className={cn(
                    "justify-start",
                    surfaceTheme === "light"
                      ? "border-rose-200 bg-white text-rose-900 hover:bg-rose-50 hover:text-rose-900"
                      : "border-rose-400/20 bg-white/[0.04] text-rose-100 hover:bg-rose-500/10"
                  )}
                >
                  Reset Mission Control
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => onOpenResetDialog("full-uninstall")}
                  className={cn(
                    "justify-start",
                    surfaceTheme === "light"
                      ? "border-rose-300 bg-rose-600 text-white hover:bg-rose-700"
                      : "border-rose-400/24 bg-rose-500/90 text-white hover:bg-rose-500"
                  )}
                >
                  Full Uninstall
                </Button>
              </div>
            </div>

          </div>
        ) : null}
      </div>
    </div>
  );
}

function resolveRuntimePrompt(runtime: RuntimeRecord) {
  const turnPrompt =
    typeof runtime.metadata.turnPrompt === "string" && runtime.metadata.turnPrompt.trim().length > 0
      ? runtime.metadata.turnPrompt.trim()
      : null;

  if (turnPrompt) {
    return turnPrompt;
  }

  if (runtime.title?.trim()) {
    return runtime.title.trim();
  }

  return runtime.subtitle.trim() || "Continue this run.";
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
      statusMessage: "Scanning remote model routes...",
      successTitle: "Models discovered.",
      errorTitle: "Model discovery failed."
    };
  }

  if (intent === "login-provider") {
    return {
      statusMessage: "Preparing provider auth...",
      successTitle: "Provider connected.",
      errorTitle: "Provider auth needs attention."
    };
  }

  if (intent === "refresh") {
    return {
      statusMessage: "Refreshing model status...",
      successTitle: "Model setup refreshed.",
      errorTitle: "Model refresh failed."
    };
  }

  return {
    statusMessage: "Checking available models and provider auth...",
    successTitle: "Model setup ready.",
    errorTitle: "Model setup failed."
  };
}

function resolveOnboardingAction(snapshot: MissionControlSnapshot) {
  if (!snapshot.diagnostics.installed) {
    return {
      label: "Install OpenClaw",
      description: "Download the OpenClaw CLI and prepare this machine for Mission Control."
    };
  }

  if (resolveOpenClawSystemReady(snapshot)) {
    return {
      label: "Enter Mission Control",
      description: "OpenClaw is online and the runtime state is writable."
    };
  }

  if (snapshot.diagnostics.rpcOk) {
    return {
      label: "Repair runtime access",
      description: "OpenClaw is online, but Mission Control still needs verified write access to the runtime state."
    };
  }

  if (!snapshot.diagnostics.loaded) {
    return {
      label: "Prepare local gateway",
      description:
        "OpenClaw CLI is already ready. Mission Control will register the local gateway service once, then start it."
    };
  }

  if (!snapshot.diagnostics.rpcOk) {
    return {
      label: "Start OpenClaw",
      description: "Start the local gateway service and wait for a live RPC connection."
    };
  }

  return {
    label: "Start OpenClaw",
    description: "Start the local gateway service and wait for a live RPC connection."
  };
}

function formatHealthLabel(health: MissionControlSnapshot["diagnostics"]["health"]) {
  switch (health) {
    case "healthy":
      return "Online";
    case "degraded":
      return "Degraded";
    default:
      return "Offline";
  }
}

type SettingsButtonTone = "secondary" | "primary" | "warning" | "warningSolid";

function settingsButtonClassName(surfaceTheme: SurfaceTheme, tone: SettingsButtonTone) {
  const base =
    "h-8 rounded-[12px] border px-2.5 text-[9px] uppercase tracking-[0.18em] transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:scale-[0.985]";

  if (tone === "primary") {
    return cn(
      base,
      surfaceTheme === "light"
        ? "border-[#c8946f] bg-[#c8946f] text-white shadow-[0_12px_28px_rgba(200,148,111,0.24)] hover:bg-[#b88461] hover:border-[#b88461] hover:text-white active:bg-[#a97553] active:border-[#a97553]"
        : "border-cyan-300/30 bg-cyan-300 text-slate-950 shadow-[0_12px_28px_rgba(34,211,238,0.2)] hover:bg-cyan-200 hover:border-cyan-200 hover:text-slate-950 active:bg-cyan-100 active:border-cyan-100"
    );
  }

  if (tone === "warning") {
    return cn(
      base,
      surfaceTheme === "light"
        ? "border-amber-400/90 bg-amber-100 text-amber-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] hover:bg-amber-200 hover:border-amber-400 hover:text-amber-900 active:bg-amber-300"
        : "border-amber-300/35 bg-amber-300/16 text-amber-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] hover:bg-amber-300/24 hover:border-amber-300/45 hover:text-amber-50 active:bg-amber-300/30"
    );
  }

  if (tone === "warningSolid") {
    return cn(
      base,
      surfaceTheme === "light"
        ? "border-amber-900 bg-amber-900 text-amber-50 shadow-[0_12px_28px_rgba(146,64,14,0.18)] hover:bg-amber-800 hover:border-amber-800 hover:text-amber-50 active:bg-amber-700 active:border-amber-700"
        : "border-amber-300 bg-amber-300 text-slate-950 shadow-[0_12px_28px_rgba(245,158,11,0.18)] hover:bg-amber-200 hover:border-amber-200 hover:text-slate-950 active:bg-amber-100 active:border-amber-100"
    );
  }

  return cn(
    base,
    surfaceTheme === "light"
      ? "border-[#d3bba9] bg-[#f1e3d7] text-[#6f5949] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] hover:bg-[#ead8ca] hover:border-[#caa98f] hover:text-[#5f4a3d] active:bg-[#dfc9b7] active:border-[#bf9c82]"
      : "border-white/12 bg-white/[0.05] text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:bg-white/[0.1] hover:border-white/16 hover:text-slate-100 active:bg-white/[0.14] active:border-white/20"
  );
}

function settingsChromeButtonClassName(surfaceTheme: SurfaceTheme) {
  return cn(
    "inline-flex h-8 w-8 items-center justify-center rounded-full border transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.96]",
    surfaceTheme === "light"
      ? "border-[#d0bcae] bg-[#efe5dc] text-[#7f6554] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] hover:bg-[#e7d9ce] hover:border-[#c8b09f] hover:text-[#5f4a3d] active:bg-[#ddcdbf]"
      : "border-white/12 bg-white/[0.08] text-slate-200 hover:bg-white/[0.12] hover:border-white/16 hover:text-slate-100 active:bg-white/[0.16]"
  );
}

function settingsThemeSwitchTrackClassName(surfaceTheme: SurfaceTheme) {
  return cn(
    "relative inline-flex h-7 w-14 items-center rounded-full border transition-[background-color,border-color,transform] duration-150 active:scale-[0.98]",
    surfaceTheme === "light"
      ? "border-[#d0bcae] bg-[#eaded3] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] hover:bg-[#e3d5c8] hover:border-[#c8b09f] active:bg-[#d9c8ba]"
      : "border-white/12 bg-white/[0.08] hover:bg-white/[0.12] hover:border-white/16 active:bg-white/[0.16]"
  );
}

function settingsThemeSwitchThumbClassName(surfaceTheme: SurfaceTheme) {
  return cn(
    "absolute left-1 inline-flex h-5 w-5 items-center justify-center rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.18)] transition-[transform,background-color,color] duration-150",
    surfaceTheme === "light"
      ? "translate-x-7 bg-[#c8946f] text-white"
      : "translate-x-0 bg-cyan-300 text-slate-950"
  );
}

function statusBadgeClassName(
  health: MissionControlSnapshot["diagnostics"]["health"],
  surfaceTheme: SurfaceTheme
) {
  switch (health) {
    case "healthy":
      return surfaceTheme === "light"
        ? "border-emerald-300/80 bg-emerald-50 text-emerald-700"
        : "border-emerald-400/25 bg-emerald-400/10 text-emerald-200";
    case "degraded":
      return surfaceTheme === "light"
        ? "border-amber-300/90 bg-amber-50 text-amber-700"
        : "border-amber-300/25 bg-amber-300/10 text-amber-200";
    default:
      return surfaceTheme === "light"
        ? "border-rose-300/80 bg-rose-50 text-rose-700"
        : "border-rose-300/25 bg-rose-300/10 text-rose-200";
  }
}

function statusDotClassName(health: MissionControlSnapshot["diagnostics"]["health"]) {
  switch (health) {
    case "healthy":
      return "bg-emerald-400";
    case "degraded":
      return "bg-amber-300";
    default:
      return "bg-rose-300";
  }
}
