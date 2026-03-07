"use client";

import { MoonStar, SunMedium } from "lucide-react";
import { useEffect, useState } from "react";

import { MissionCanvas } from "@/components/mission-control/canvas";
import { CommandBar } from "@/components/mission-control/command-bar";
import { InspectorPanel } from "@/components/mission-control/inspector-panel";
import { MissionSidebar } from "@/components/mission-control/sidebar";
import { toast } from "@/components/ui/sonner";
import { useMissionControlData } from "@/hooks/use-mission-control-data";
import type { MissionResponse, MissionControlSnapshot, RuntimeRecord } from "@/lib/openclaw/types";
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

const surfaceThemeStorageKey = "mission-control-surface-theme";

export function MissionControlShell({
  initialSnapshot
}: {
  initialSnapshot: MissionControlSnapshot;
}) {
  const { snapshot, connectionState, refresh } = useMissionControlData(initialSnapshot);
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
  const [surfaceTheme, setSurfaceTheme] = useState<SurfaceTheme>("dark");

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

  return (
    <div
      className={cn(
        "mission-shell relative min-h-screen overflow-hidden",
        surfaceTheme === "light" && "mission-shell--light"
      )}
    >
      <div className="relative flex min-h-screen flex-col gap-4 px-4 pb-4 pt-5 lg:h-screen lg:block lg:px-0 lg:pb-0 lg:pt-0">
        <div
          className={cn(
            "order-1 lg:absolute lg:left-6 lg:z-30",
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

        <div
          className={cn(
            "order-2 min-h-[660px] lg:absolute lg:bottom-[108px] lg:top-0 lg:min-h-0",
            isSidebarOpen ? "lg:left-[442px]" : "lg:left-[118px]",
            isInspectorOpen ? "lg:right-[442px]" : "lg:right-[118px]"
          )}
        >
          <div
            className={cn(
              "mission-canvas-frame relative h-full overflow-hidden rounded-[32px] border",
              surfaceTheme === "light"
                ? "border-[#d9c9bc]/80 bg-[rgba(255,250,245,0.38)] shadow-[0_24px_60px_rgba(161,125,101,0.12)]"
                : "border-white/[0.05] bg-transparent"
            )}
          >
            <div aria-hidden="true" className="mission-canvas-pattern absolute inset-0 z-0" />

            <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between px-2 pt-2 lg:px-0 lg:pt-6">
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

              <div
                className={cn(
                  "pointer-events-auto hidden h-11 items-center gap-3 rounded-full border px-4 text-[10px] uppercase tracking-[0.3em] shadow-[0_18px_50px_rgba(0,0,0,0.24)] backdrop-blur-xl lg:flex",
                  surfaceTheme === "light"
                    ? "border-[#d9c9bc]/90 bg-[#f8f5f0]/86 text-[#8a7261] shadow-[0_18px_42px_rgba(161,125,101,0.14)]"
                    : "border-cyan-300/10 bg-slate-950/45 text-slate-400"
                )}
              >
                <span>OpenClaw runtime topology</span>
                <button
                  type="button"
                  role="switch"
                  aria-label={surfaceTheme === "light" ? "Switch to dark theme" : "Switch to light theme"}
                  aria-checked={surfaceTheme === "light"}
                  aria-pressed={surfaceTheme === "light"}
                  onClick={() =>
                    setSurfaceTheme((current) => (current === "light" ? "dark" : "light"))
                  }
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
              </div>
            </div>

            <div className="absolute inset-0 z-10 pt-24 lg:pt-0">
              <MissionCanvas
                snapshot={snapshot}
                activeWorkspaceId={activeWorkspaceId}
                selectedNodeId={selectedNodeId}
                pendingMission={pendingMission}
                hiddenRuntimeIds={hiddenRuntimeIds}
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
        </div>

        <div
          className={cn(
            "order-3 min-h-0 lg:absolute lg:right-6 lg:z-30",
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

        <div className="order-4 lg:absolute lg:bottom-6 lg:left-1/2 lg:z-40 lg:w-[min(860px,calc(100vw-280px))] lg:-translate-x-1/2">
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
