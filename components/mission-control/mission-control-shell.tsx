"use client";

import { ArrowUpCircle, LoaderCircle, MoonStar, RefreshCw, Settings2, SunMedium } from "lucide-react";
import { useEffect, useRef, useState, type MutableRefObject } from "react";

import { MissionCanvas } from "@/components/mission-control/canvas";
import { CommandBar } from "@/components/mission-control/command-bar";
import { InspectorPanel } from "@/components/mission-control/inspector-panel";
import { OpenClawOnboarding } from "@/components/mission-control/openclaw-onboarding";
import { MissionSidebar } from "@/components/mission-control/sidebar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
import { useMissionControlData } from "@/hooks/use-mission-control-data";
import { compactPath } from "@/lib/openclaw/presenters";
import type {
  MissionResponse,
  MissionControlSnapshot,
  OpenClawOnboardingPhase,
  OpenClawOnboardingStreamEvent,
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
  const [isOnboardingDismissed, setIsOnboardingDismissed] = useState(false);
  const [showOnboardingReadyState, setShowOnboardingReadyState] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [surfaceTheme, setSurfaceTheme] = useState<SurfaceTheme>("dark");
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const onboardingSuccessTimeoutRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const activeRuntimeCount = snapshot.runtimes.filter(
    (runtime) => runtime.status === "active" || runtime.status === "queued"
  ).length;
  const isOpenClawReady =
    snapshot.diagnostics.installed && snapshot.diagnostics.loaded && snapshot.diagnostics.rpcOk;
  const updateInstallDescriptor = [
    snapshot.diagnostics.updatePackageManager,
    snapshot.diagnostics.updateInstallKind
  ]
    .filter(Boolean)
    .join(" · ");
  const onboardingAction = resolveOnboardingAction(snapshot);
  const shouldShowOnboarding = (!isOpenClawReady && !isOnboardingDismissed) || showOnboardingReadyState;

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
        runtime.agentId === pendingMission.agentId &&
        (runtime.updatedAt ?? 0) >= pendingMission.submittedAt - 1500
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
    if (isOpenClawReady) {
      setIsOnboardingDismissed(false);
    }
  }, [isOpenClawReady]);

  useEffect(() => {
    if (onboardingSuccessTimeoutRef.current) {
      globalThis.clearTimeout(onboardingSuccessTimeoutRef.current);
      onboardingSuccessTimeoutRef.current = null;
    }

    if (isOpenClawReady && (onboardingRunState === "running" || onboardingRunState === "success")) {
      setOnboardingRunState("success");
      setOnboardingPhase("ready");
      setOnboardingStatusMessage(null);
      setOnboardingResultMessage((current) => current || "OpenClaw is ready. Entering Mission Control...");
      setShowOnboardingReadyState(true);
      onboardingSuccessTimeoutRef.current = globalThis.setTimeout(() => {
        setShowOnboardingReadyState(false);
      }, 1100);
      return;
    }

    if (!isOpenClawReady) {
      setShowOnboardingReadyState(false);
    }
  }, [isOpenClawReady, onboardingRunState]);

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
                toast.success("OpenClaw is ready.", {
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
          isCheckingForUpdates={isCheckingForUpdates}
          lastCheckedAt={lastCheckedAt}
          onToggleTheme={() =>
            setSurfaceTheme((current) => (current === "light" ? "dark" : "light"))
          }
          onToggleSettings={() => setIsSettingsOpen((current) => !current)}
          onCheckForUpdates={checkForUpdates}
          onOpenUpdateDialog={() => {
            resetUpdateDialogState();
            setIsUpdateDialogOpen(true);
          }}
        />
      </div>

      <div className="relative z-20 flex min-h-screen flex-col gap-4 px-4 pb-4 pt-5 pointer-events-none lg:h-screen lg:block lg:px-0 lg:pb-0 lg:pt-0">
        <div
          className={cn(
            "order-1 pointer-events-auto lg:absolute lg:left-6 lg:z-30",
            isSidebarOpen ? "lg:bottom-[244px] lg:top-6 lg:w-[394px]" : "lg:bottom-[244px] lg:top-6 lg:w-[78px]"
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

        <div className="order-2 min-h-[660px] lg:hidden">
          <div
            className={cn(
              "mission-canvas-frame relative h-full overflow-hidden rounded-[32px] border",
              surfaceTheme === "light"
                ? "border-[#d9c9bc]/80 bg-[rgba(255,250,245,0.12)] shadow-[0_24px_60px_rgba(161,125,101,0.12)]"
                : "border-white/[0.05] bg-[rgba(4,10,20,0.12)]"
            )}
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex px-2 pt-2">
              <CanvasTitlePill surfaceTheme={surfaceTheme} />
            </div>
          </div>
        </div>

        <div
          className={cn(
            "order-3 min-h-0 pointer-events-auto lg:absolute lg:right-6 lg:z-30",
            isInspectorOpen ? "lg:bottom-[244px] lg:top-6 lg:w-[394px]" : "lg:bottom-[244px] lg:top-6 lg:w-[78px]"
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

        <div className="order-4 pointer-events-auto lg:absolute lg:bottom-6 lg:left-1/2 lg:z-40 lg:w-[min(800px,calc(100vw-320px))] lg:-translate-x-1/2">
          <CommandBar
            snapshot={snapshot}
            activeWorkspaceId={activeWorkspaceId}
            selectedNodeId={selectedNodeId}
            composeIntent={composeIntent}
            onRefresh={refresh}
            onWorkspaceCreated={(workspaceId) => {
              setActiveWorkspaceId(workspaceId);
              setSelectedNodeId(workspaceId);
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
            runState={onboardingRunState}
            phase={onboardingPhase}
            statusMessage={onboardingStatusMessage}
            resultMessage={onboardingResultMessage}
            log={onboardingLog}
            manualCommand={onboardingManualCommand}
            docsUrl={onboardingDocsUrl}
            actionLabel={onboardingAction.label}
            actionDescription={onboardingAction.description}
            onPrimaryAction={runOpenClawOnboarding}
            onDismiss={() => setIsOnboardingDismissed(true)}
            canDismiss={!showOnboardingReadyState && onboardingRunState !== "running"}
          />
        ) : null}

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
              "max-w-[560px]",
              surfaceTheme === "light"
                ? "border-[#d7c5b7] bg-[rgba(252,247,241,0.98)] text-[#4a382c] shadow-[0_30px_80px_rgba(161,125,101,0.2)]"
                : "border-white/10 bg-slate-950/94 text-slate-100"
            )}
          >
            <DialogHeader>
              <DialogTitle className={surfaceTheme === "light" ? "text-[#3f2f24]" : "text-white"}>
                Update OpenClaw
              </DialogTitle>
              <DialogDescription className={surfaceTheme === "light" ? "text-[#7e6555]" : "text-slate-400"}>
                This runs <span className="font-mono">openclaw update</span> against the installed CLI and may briefly
                interrupt local gateway activity.
              </DialogDescription>
            </DialogHeader>

            <div
              className={cn(
                "rounded-[22px] border px-4 py-4",
                surfaceTheme === "light"
                  ? "border-[#e3d4c8] bg-[#fffaf6]"
                  : "border-white/8 bg-white/[0.03]"
              )}
            >
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p
                    className={cn(
                      "text-[10px] uppercase tracking-[0.24em]",
                      surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-500"
                    )}
                  >
                    Version target
                  </p>
                  <div className="mt-2 flex items-baseline gap-2">
                    <p
                      className={cn(
                        "font-display text-[1.2rem]",
                        surfaceTheme === "light" ? "text-[#3f2f24]" : "text-white"
                      )}
                    >
                      v{snapshot.diagnostics.latestVersion || snapshot.diagnostics.version || "unknown"}
                    </p>
                    <p className={surfaceTheme === "light" ? "text-xs text-[#8b7262]" : "text-xs text-slate-400"}>
                      from v{snapshot.diagnostics.version || "unknown"}
                    </p>
                  </div>
                </div>
                {snapshot.diagnostics.updateAvailable ? (
                  <span
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.22em]",
                      surfaceTheme === "light"
                        ? "border-amber-300 bg-amber-100 text-amber-900"
                        : "border-amber-300/35 bg-amber-300/14 text-amber-100"
                    )}
                  >
                    Update pending
                  </span>
                ) : null}
              </div>

              <div className="mt-4 space-y-3 text-xs">
                <div>
                  <p className={surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-500"}>Install root</p>
                  <p
                    className={cn(
                      "mt-1 break-all font-mono leading-5",
                      surfaceTheme === "light" ? "text-[#4f3d31]" : "text-slate-200"
                    )}
                  >
                    {snapshot.diagnostics.updateRoot || "Unavailable"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-500"}>
                    Install mode
                  </span>
                  <span
                    className={cn(
                      "rounded-full border px-2 py-1 font-mono text-[11px]",
                      surfaceTheme === "light"
                        ? "border-[#dcc6b6] bg-[#f4e8dd] text-[#7b6453]"
                        : "border-white/10 bg-white/[0.05] text-slate-300"
                    )}
                  >
                    {updateInstallDescriptor || "unknown"}
                  </span>
                </div>
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
                ? `${activeRuntimeCount} active or queued runtime${activeRuntimeCount === 1 ? "" : "s"} may be interrupted during the update.`
                : "No active runtimes are currently tracked, so the update risk is lower."}
            </div>

            <div
              className={cn(
                "rounded-[22px] border",
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
                  {updateStatusMessage || updateResultMessage || "Waiting for confirmation"}
                </span>
              </div>
              <pre
                className={cn(
                  "max-h-[240px] min-h-[140px] overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-[11px] leading-5",
                  surfaceTheme === "light" ? "text-[#4f3d31]" : "text-slate-200"
                )}
              >
                {updateLog ||
                  "No command output yet.\n\nConfirm the update to run openclaw update and stream its output here."}
              </pre>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setIsUpdateDialogOpen(false);
                  resetUpdateDialogState();
                }}
                disabled={updateRunState === "running"}
                className={surfaceTheme === "light" ? "border-[#d9c9bc] bg-[#f5ebe3] text-[#6c5647] hover:bg-[#eddccf]" : ""}
              >
                {updateRunState === "success" || updateRunState === "error" ? "Close" : "Cancel"}
              </Button>
              <Button
                type="button"
                onClick={runOpenClawUpdate}
                disabled={updateRunState === "running"}
                className={cn(
                  snapshot.diagnostics.updateAvailable
                    ? "bg-amber-400 text-slate-950 shadow-lg shadow-amber-400/20 hover:bg-amber-300"
                    : "",
                  surfaceTheme === "light" && !snapshot.diagnostics.updateAvailable
                    ? "bg-[#c8946f] text-white shadow-[0_12px_28px_rgba(200,148,111,0.24)] hover:bg-[#b88461]"
                    : ""
                )}
              >
                {updateRunState === "running" ? (
                  <>
                    <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                    Updating...
                  </>
                ) : (
                  "Update now"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
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
      <p
        className={cn(
          "text-[10px] uppercase tracking-[0.3em]",
          surfaceTheme === "light" ? "text-[#8a7261]" : "text-slate-500"
        )}
      >
        Canvas
      </p>
      <span
        aria-hidden="true"
        className={cn(
          "h-4 w-px",
          surfaceTheme === "light" ? "bg-[#cdb7a8]/80" : "bg-white/[0.08]"
        )}
      />
      <h2
        className={cn(
          "font-display text-[0.98rem]",
          surfaceTheme === "light" ? "text-[#3f2f24]" : "text-white"
        )}
      >
        Orchestration Surface
      </h2>
    </div>
  );
}

function CanvasTopBar({
  snapshot,
  surfaceTheme,
  settingsRef,
  isSettingsOpen,
  isCheckingForUpdates,
  lastCheckedAt,
  onToggleTheme,
  onToggleSettings,
  onCheckForUpdates,
  onOpenUpdateDialog
}: {
  snapshot: MissionControlSnapshot;
  surfaceTheme: SurfaceTheme;
  settingsRef: MutableRefObject<HTMLDivElement | null>;
  isSettingsOpen: boolean;
  isCheckingForUpdates: boolean;
  lastCheckedAt: number | null;
  onToggleTheme: () => void;
  onToggleSettings: () => void;
  onCheckForUpdates: () => Promise<void>;
  onOpenUpdateDialog: () => void;
}) {
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
            aria-pressed={surfaceTheme === "light"}
            onClick={onToggleTheme}
            className={cn(
              "relative inline-flex h-7 w-14 items-center rounded-full border transition-colors",
              surfaceTheme === "light"
                ? "border-[#d0bcae] bg-[#eaded3]"
                : "border-white/10 bg-white/[0.08]"
            )}
          >
            <span
              className={cn(
                "absolute left-1 inline-flex h-5 w-5 items-center justify-center rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.18)] transition-transform",
                surfaceTheme === "light"
                  ? "translate-x-7 bg-[#c8946f] text-white"
                  : "translate-x-0 bg-cyan-300 text-slate-950"
              )}
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
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors",
              surfaceTheme === "light"
                ? "border-[#d0bcae] bg-[#efe5dc] text-[#7f6554] hover:bg-[#e7d9ce]"
                : "border-white/10 bg-white/[0.08] text-slate-200 hover:bg-white/[0.12]"
            )}
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
        </div>

        {isSettingsOpen ? (
          <div
            role="menu"
            aria-label="OpenClaw settings"
            className={cn(
              "absolute right-0 top-[calc(100%+12px)] z-[70] w-[272px] rounded-[22px] border p-3.5 shadow-[0_22px_64px_rgba(0,0,0,0.24)] backdrop-blur-2xl",
              surfaceTheme === "light"
                ? "border-[#dbc9bc]/90 bg-[rgba(252,247,241,0.95)] text-[#4a382c] shadow-[0_24px_60px_rgba(161,125,101,0.18)]"
                : "border-cyan-300/12 bg-[rgba(10,16,28,0.9)] text-slate-100"
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p
                  className={cn(
                    "text-[9px] uppercase tracking-[0.28em]",
                    surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-500"
                  )}
                >
                  Settings
                </p>
                <h3
                  className={cn(
                    "mt-0.5 font-display text-[15px]",
                    surfaceTheme === "light" ? "text-[#3f2f24]" : "text-white"
                  )}
                >
                  OpenClaw surface
                </h3>
              </div>
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.22em]",
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
                  "mt-3 rounded-[20px] border px-3.5 py-3.5",
                  surfaceTheme === "light"
                    ? "border-amber-300/90 bg-[linear-gradient(135deg,rgba(255,247,237,0.98),rgba(252,231,214,0.94))] shadow-[0_16px_36px_rgba(194,120,55,0.16)]"
                    : "border-amber-300/30 bg-[linear-gradient(135deg,rgba(71,35,8,0.62),rgba(33,20,8,0.82))] shadow-[0_18px_42px_rgba(245,158,11,0.14)]"
                )}
              >
                <div className="flex items-start justify-between gap-2.5">
                  <div>
                    <p
                      className={cn(
                        "text-[9px] uppercase tracking-[0.24em]",
                        surfaceTheme === "light" ? "text-amber-800/70" : "text-amber-200/80"
                      )}
                    >
                      Update available
                    </p>
                    <div className="mt-1.5 flex items-baseline gap-1.5">
                      <p
                        className={cn(
                          "font-display text-[1.08rem]",
                          surfaceTheme === "light" ? "text-amber-950" : "text-amber-50"
                        )}
                      >
                        v{snapshot.diagnostics.latestVersion}
                      </p>
                      <p
                        className={cn(
                          "text-[10px]",
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
                    "mt-2 text-[11px] leading-[1.15rem]",
                    surfaceTheme === "light" ? "text-amber-950/80" : "text-amber-50/85"
                  )}
                >
                  A newer OpenClaw release was detected. You can update directly from Mission Control.
                </p>
                <button
                  type="button"
                  onClick={onOpenUpdateDialog}
                  className={cn(
                    "mt-3 inline-flex items-center justify-center rounded-[14px] border px-2.5 py-1.5 text-[10px] uppercase tracking-[0.22em] transition-colors",
                    surfaceTheme === "light"
                      ? "border-amber-400/90 bg-amber-900 text-amber-50 hover:bg-amber-800"
                      : "border-amber-300/40 bg-amber-300/18 text-amber-100 hover:bg-amber-300/24"
                  )}
                >
                  Update now
                </button>
              </div>
            ) : null}

            <div
              className={cn(
                "mt-3 rounded-[18px] border px-3 py-2.5",
                surfaceTheme === "light"
                  ? "border-[#e6d7cb] bg-[#fffaf6]"
                  : "border-white/8 bg-white/[0.03]"
              )}
            >
              <p
                className={cn(
                  "text-[9px] uppercase tracking-[0.22em]",
                  surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-500"
                )}
              >
                OpenClaw version
              </p>
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <p
                  className={cn(
                    "font-display text-[0.94rem]",
                    surfaceTheme === "light" ? "text-[#3f2f24]" : "text-white"
                  )}
                >
                  {snapshot.diagnostics.version || "Unavailable"}
                </p>
                {snapshot.diagnostics.updateChannel ? (
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.2em]",
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
                  "mt-1.5 text-[11px] leading-[1.15rem]",
                  surfaceTheme === "light" ? "text-[#816958]" : "text-slate-400"
                )}
              >
                {snapshot.diagnostics.updateInfo?.trim() ||
                  "No additional update message was returned in the latest OpenClaw status snapshot."}
              </p>
            </div>

            <div
              className={cn(
                "mt-2.5 rounded-[18px] border px-3 py-2.5",
                surfaceTheme === "light"
                  ? "border-[#e6d7cb] bg-[#fffaf6]"
                  : "border-white/8 bg-white/[0.03]"
              )}
            >
              <p
                className={cn(
                  "text-[9px] uppercase tracking-[0.22em]",
                  surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-500"
                )}
              >
                Workspace root
              </p>
              <p
                className={cn(
                  "mt-1.5 break-all font-mono text-[10px] leading-[1.1rem]",
                  surfaceTheme === "light" ? "text-[#4f3d31]" : "text-slate-200"
                )}
              >
                {compactPath(snapshot.diagnostics.workspaceRoot)}
              </p>
              <p
                className={cn(
                  "mt-1.5 text-[11px] leading-[1.15rem]",
                  surfaceTheme === "light" ? "text-[#816958]" : "text-slate-400"
                )}
              >
                Newly created workspaces are stored under this default parent path.
              </p>
            </div>

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                void onCheckForUpdates();
              }}
              disabled={isCheckingForUpdates}
              className={cn(
                "mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-[15px] border px-3 py-2.5 text-[10px] uppercase tracking-[0.24em] transition-colors disabled:cursor-wait disabled:opacity-70",
                snapshot.diagnostics.updateAvailable
                  ? surfaceTheme === "light"
                    ? "border-amber-400/90 bg-amber-100 text-amber-900 hover:bg-amber-200"
                    : "border-amber-300/35 bg-amber-300/16 text-amber-100 hover:bg-amber-300/22"
                  : surfaceTheme === "light"
                    ? "border-[#d3bba9] bg-[#f1e3d7] text-[#6f5949] hover:bg-[#ead8ca]"
                    : "border-cyan-400/18 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/14"
              )}
            >
              {isCheckingForUpdates ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {isCheckingForUpdates
                ? "Checking..."
                : snapshot.diagnostics.updateAvailable
                  ? "Update available"
                  : "Check for update"}
            </button>

            {lastCheckedAt ? (
              <p
                className={cn(
                  "mt-2.5 text-center text-[10px]",
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

function resolveOnboardingAction(snapshot: MissionControlSnapshot) {
  if (!snapshot.diagnostics.installed) {
    return {
      label: "Install OpenClaw",
      description: "Download the OpenClaw CLI and prepare this machine for Mission Control."
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
    label: "Enter Mission Control",
    description: "OpenClaw is already online."
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
