"use client";

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
};

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
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);

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

  return (
    <div className="mission-shell relative min-h-screen overflow-hidden">
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
          <div className="relative h-full overflow-hidden rounded-[32px] border border-white/[0.05] bg-transparent">
            <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between px-2 pt-2 lg:px-0 lg:pt-6">
              <div className="rounded-[20px] border border-white/[0.08] bg-slate-950/55 px-4 py-3 shadow-[0_18px_50px_rgba(0,0,0,0.28)] backdrop-blur-xl">
                <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Canvas</p>
                <h2 className="mt-1 font-display text-[1.08rem] text-white">Orchestration Surface</h2>
              </div>

              <div className="hidden rounded-full border border-cyan-300/10 bg-slate-950/45 px-4 py-2 text-[10px] uppercase tracking-[0.3em] text-slate-400 shadow-[0_18px_50px_rgba(0,0,0,0.24)] backdrop-blur-xl lg:flex">
                OpenClaw runtime topology
              </div>
            </div>

            <div className="absolute inset-0 pt-24 lg:pt-0">
              <MissionCanvas
                snapshot={snapshot}
                activeWorkspaceId={activeWorkspaceId}
                selectedNodeId={selectedNodeId}
                pendingMission={pendingMission}
                hiddenRuntimeIds={hiddenRuntimeIds}
                onReplyRuntime={(runtime) => {
                  setComposeIntent({
                    id: `reply:${runtime.id}:${Date.now()}`,
                    mission: resolveRuntimePrompt(runtime),
                    agentId: runtime.agentId
                  });
                }}
                onCopyRuntimePrompt={async (runtime) => {
                  const prompt = resolveRuntimePrompt(runtime);
                  setComposeIntent({
                    id: `copy:${runtime.id}:${Date.now()}`,
                    mission: prompt,
                    agentId: runtime.agentId
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
