"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

import type { LucideIcon } from "lucide-react";
import {
  ChevronLeft,
  ChevronRight,
  Cpu,
  Eye,
  FileJson,
  FolderGit2,
  Radar,
  TerminalSquare
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { Badge } from "@/components/ui/badge";
import {
  compactPath,
  formatContextWindow,
  formatRelativeTime,
  formatTokens,
  shortId
} from "@/lib/openclaw/presenters";
import type {
  MissionControlSnapshot,
  MissionResponse,
  RuntimeOutputRecord
} from "@/lib/openclaw/types";
import { cn } from "@/lib/utils";

export function InspectorPanel({
  snapshot,
  selectedNodeId,
  lastMission,
  collapsed,
  onToggleCollapsed
}: {
  snapshot: MissionControlSnapshot;
  selectedNodeId: string | null;
  lastMission: MissionResponse | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const [activeTab, setActiveTab] = useState("overview");
  const [runtimeOutput, setRuntimeOutput] = useState<RuntimeOutputRecord | null>(null);
  const [runtimeOutputLoading, setRuntimeOutputLoading] = useState(false);
  const [runtimeOutputError, setRuntimeOutputError] = useState<string | null>(null);
  const selectedWorkspace = snapshot.workspaces.find((workspace) => workspace.id === selectedNodeId);
  const selectedAgent = snapshot.agents.find((agent) => agent.id === selectedNodeId);
  const selectedRuntime = snapshot.runtimes.find((runtime) => runtime.id === selectedNodeId);
  const selectedModel = snapshot.models.find((model) => model.id === selectedNodeId);
  const selectedEntity = selectedWorkspace || selectedAgent || selectedRuntime || selectedModel || null;
  const selectedRuntimeId = selectedRuntime?.id ?? null;
  const showOutputTab = Boolean(selectedRuntime);
  const selectedLabel =
    selectedWorkspace?.name ||
    selectedAgent?.name ||
    selectedRuntime?.title ||
    selectedModel?.name ||
    "Gateway overview";
  const selectedDetail = selectedWorkspace
    ? "workspace focus"
    : selectedAgent
      ? "agent focus"
      : selectedRuntime
        ? "run focus"
        : selectedModel
          ? "model focus"
          : "live selection";
  const navItems = useMemo(
    () =>
      [
        { id: "overview", label: "Overview", icon: Eye, enabled: true },
        { id: "output", label: "Output", icon: TerminalSquare, enabled: showOutputTab },
        { id: "raw", label: "Raw", icon: FileJson, enabled: true }
      ] satisfies Array<{ id: string; label: string; icon: LucideIcon; enabled: boolean }>,
    [showOutputTab]
  );

  useEffect(() => {
    setActiveTab("overview");
  }, [selectedNodeId]);

  useEffect(() => {
    if (activeTab === "output" && !showOutputTab) {
      setActiveTab("overview");
    }
  }, [activeTab, showOutputTab]);

  useEffect(() => {
    if (!selectedRuntimeId) {
      setRuntimeOutput(null);
      setRuntimeOutputLoading(false);
      setRuntimeOutputError(null);
      return;
    }

    const controller = new AbortController();
    setRuntimeOutputLoading(true);
    setRuntimeOutputError(null);

    fetch(`/api/runtimes/${encodeURIComponent(selectedRuntimeId)}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json()) as RuntimeOutputRecord & { error?: string };

        if (!response.ok) {
          throw new Error(payload.error || "Unable to load runtime output.");
        }

        setRuntimeOutput(payload);
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }

        setRuntimeOutput(null);
        setRuntimeOutputError(error instanceof Error ? error.message : "Unable to load runtime output.");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setRuntimeOutputLoading(false);
        }
      });

    return () => controller.abort();
  }, [selectedRuntimeId]);

  return (
    <div className="panel-surface panel-glow flex h-full flex-row-reverse overflow-hidden rounded-[30px] border border-white/[0.08] bg-[#04070e]/88 shadow-[0_28px_90px_rgba(0,0,0,0.42)] backdrop-blur-2xl">
      <div
        className={cn(
          "flex h-full shrink-0 flex-col items-center bg-[linear-gradient(180deg,rgba(7,10,18,0.98),rgba(3,6,12,0.98))] px-3 py-4",
          collapsed ? "w-full" : "w-[78px] border-l border-white/[0.08]"
        )}
      >
        <button
          type="button"
          aria-label={collapsed ? "Expand inspector" : "Collapse inspector"}
          onClick={onToggleCollapsed}
          className="flex h-12 w-12 items-center justify-center rounded-[18px] border border-cyan-300/20 bg-cyan-400/[0.12] shadow-[0_10px_24px_rgba(34,211,238,0.18)] transition-all hover:border-cyan-200/30 hover:bg-cyan-400/[0.16]"
        >
          <TerminalSquare className="h-5 w-5 text-cyan-200" />
        </button>

        <button
          type="button"
          aria-label={collapsed ? "Expand inspector" : "Collapse inspector"}
          onClick={onToggleCollapsed}
          className="mt-4 inline-flex h-11 w-11 items-center justify-center rounded-[16px] border border-white/10 bg-white/[0.04] text-slate-300 transition-all hover:border-cyan-300/18 hover:bg-white/[0.08] hover:text-white"
        >
          {collapsed ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        <div className="mt-6 flex flex-1 flex-col items-center gap-2">
          {navItems.map((item) => (
            <InspectorRailButton
              key={item.id}
              icon={item.icon}
              label={item.label}
              active={activeTab === item.id}
              disabled={!item.enabled}
              onClick={() => {
                if (!item.enabled) {
                  return;
                }

                setActiveTab(item.id);

                if (collapsed) {
                  onToggleCollapsed();
                }
              }}
            />
          ))}
        </div>

        <div className="mt-4 flex flex-col items-center gap-2">
          <Badge variant="muted">{selectedEntity ? "live" : "idle"}</Badge>
          {collapsed ? (
            <p className="max-w-[56px] truncate text-center text-[9px] uppercase tracking-[0.16em] text-slate-500">
              {selectedDetail}
            </p>
          ) : null}
        </div>
      </div>

      {!collapsed ? (
        <div className="min-w-0 flex-1 bg-[linear-gradient(180deg,rgba(6,10,18,0.96),rgba(3,6,14,0.98))]">
          <div className="mission-scroll flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain">
            <div className="shrink-0 border-b border-white/[0.08] px-5 pb-4 pt-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Inspector</p>
                  <h2 className="mt-2 font-display text-[1.38rem] leading-tight text-white">{selectedLabel}</h2>
                  <p className="mt-2 text-[12px] leading-5 text-slate-400">
                    {selectedEntity
                      ? "Live OpenClaw-backed details for the selected entity."
                      : "Local gateway health, recent presence, and last mission response."}
                  </p>
                </div>

                <div className="rounded-[18px] border border-white/10 bg-white/[0.04] p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                  <TerminalSquare className="h-4 w-4 text-cyan-200" />
                </div>
              </div>

              <div className="mt-4 rounded-[22px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(13,20,34,0.98),rgba(6,10,18,0.96))] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Selected entity</p>
                    <p className="mt-1.5 text-[14px] text-white">{selectedLabel}</p>
                  </div>
                  <Badge variant="muted">{selectedDetail}</Badge>
                </div>

                {selectedRuntime ? (
                  <p className="mt-3 text-[12px] leading-5 text-slate-400">
                    Run {shortId(selectedRuntime.runId || selectedRuntime.id, 10)} · {selectedRuntime.status} · {formatRelativeTime(selectedRuntime.updatedAt)}
                  </p>
                ) : null}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {navItems
                  .filter((item) => item.enabled)
                  .map((item) => (
                    <InspectorTabButton
                      key={item.id}
                      label={item.label}
                      active={activeTab === item.id}
                      onClick={() => setActiveTab(item.id)}
                    />
                  ))}
              </div>
            </div>

            <div className="flex-1 p-4">
              <AnimatePresence mode="wait">
                <motion.div
                  key={`${selectedNodeId || "overview"}:${activeTab}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="space-y-3.5"
                >
                  {activeTab === "overview" ? (
                    <>
                      {selectedWorkspace ? <WorkspaceContent snapshot={snapshot} workspaceId={selectedWorkspace.id} /> : null}
                      {selectedAgent ? <AgentContent snapshot={snapshot} agentId={selectedAgent.id} /> : null}
                      {selectedRuntime ? (
                        <RuntimeContent
                          snapshot={snapshot}
                          runtimeId={selectedRuntime.id}
                          runtimeOutput={runtimeOutput}
                          runtimeOutputLoading={runtimeOutputLoading}
                          runtimeOutputError={runtimeOutputError}
                        />
                      ) : null}
                      {selectedModel ? <ModelContent snapshot={snapshot} modelId={selectedModel.id} /> : null}
                      {!selectedEntity ? <GatewayOverview snapshot={snapshot} lastMission={lastMission} /> : null}
                    </>
                  ) : null}

                  {activeTab === "output" && selectedRuntime ? (
                    <RuntimeOutputContent
                      runtime={selectedRuntime}
                      runtimeOutput={runtimeOutput}
                      runtimeOutputLoading={runtimeOutputLoading}
                      runtimeOutputError={runtimeOutputError}
                    />
                  ) : null}

                  {activeTab === "raw" ? (
                    <pre className="overflow-x-auto rounded-[18px] border border-white/[0.08] bg-slate-950/[0.72] p-3 text-[11px] leading-5 text-slate-300">
                      {JSON.stringify(
                        selectedRuntime && runtimeOutput
                          ? { runtime: selectedRuntime, output: runtimeOutput }
                          : selectedEntity || snapshot,
                        null,
                        2
                      )}
                    </pre>
                  ) : null}
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="shrink-0 border-t border-white/[0.08] p-4">
              <div className="rounded-[22px] border border-cyan-300/10 bg-[linear-gradient(180deg,rgba(7,22,31,0.95),rgba(5,13,22,0.95))] p-4 shadow-[0_16px_40px_rgba(0,0,0,0.22)]">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full border border-cyan-300/15 bg-cyan-400/[0.12] text-cyan-200">
                    <Radar className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-display text-[15px] text-white">{selectedLabel}</p>
                    <p className="mt-1 text-[12px] text-slate-400">
                      {selectedRuntime
                        ? `${runtimeOutput?.items.length ?? 0} transcript entries`
                        : selectedAgent
                          ? `${selectedAgent.activeRuntimeIds.length} tracked runs`
                          : selectedWorkspace
                            ? `${selectedWorkspace.agentIds.length} agents attached`
                            : `${snapshot.presence.length} live beacons`}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function GatewayOverview({
  snapshot,
  lastMission
}: {
  snapshot: MissionControlSnapshot;
  lastMission: MissionResponse | null;
}) {
  return (
    <>
      <InfoCard icon={Radar} title="Gateway health" value={snapshot.diagnostics.health}>
        <p>{snapshot.diagnostics.gatewayUrl}</p>
        <p>{snapshot.diagnostics.dashboardUrl}</p>
      </InfoCard>

      <InfoCard icon={TerminalSquare} title="Presence beacons" value={String(snapshot.presence.length)}>
        {snapshot.presence.length === 0 ? <p>No live presence payloads.</p> : null}
        {snapshot.presence.map((entry) => (
          <div
            key={entry.ts}
            className="rounded-[14px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(11,18,32,0.86),rgba(8,13,24,0.82))] px-3 py-2"
          >
            <div className="text-[13px] text-white">{entry.host}</div>
            <div className="mt-1 text-xs text-slate-400">
              {entry.ip} · {entry.platform} · {entry.version}
            </div>
          </div>
        ))}
      </InfoCard>

      {lastMission ? (
        <InfoCard icon={Cpu} title="Last mission" value={lastMission.status}>
          <p className="text-sm text-white">{lastMission.summary}</p>
          <p className="font-mono text-xs text-slate-500">Run {lastMission.runId}</p>
          {lastMission.payloads[0]?.text ? (
            <div className="rounded-[14px] border border-cyan-400/15 bg-cyan-400/8 px-3 py-2 text-[13px] text-cyan-50">
              {lastMission.payloads[0].text}
            </div>
          ) : null}
        </InfoCard>
      ) : null}
    </>
  );
}

function WorkspaceContent({
  snapshot,
  workspaceId
}: {
  snapshot: MissionControlSnapshot;
  workspaceId: string;
}) {
  const workspace = snapshot.workspaces.find((entry) => entry.id === workspaceId);
  const agents = snapshot.agents.filter((agent) => agent.workspaceId === workspaceId);

  if (!workspace) {
    return null;
  }

  return (
    <>
      <InfoCard icon={FolderGit2} title="Workspace path" value={workspace.slug}>
        <p className="font-mono text-xs text-slate-400">{compactPath(workspace.path)}</p>
      </InfoCard>
      <InfoCard icon={Cpu} title="Attached agents" value={String(agents.length)}>
        {agents.map((agent) => (
          <div
            key={agent.id}
            className="flex items-center justify-between rounded-[14px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(11,18,32,0.86),rgba(8,13,24,0.82))] px-3 py-2"
          >
            <span className="text-[13px] text-white">{agent.name}</span>
            <Badge variant="muted">{agent.status}</Badge>
          </div>
        ))}
      </InfoCard>
    </>
  );
}

function AgentContent({
  snapshot,
  agentId
}: {
  snapshot: MissionControlSnapshot;
  agentId: string;
}) {
  const agent = snapshot.agents.find((entry) => entry.id === agentId);
  const workspace = snapshot.workspaces.find((entry) => entry.id === agent?.workspaceId);
  const model = snapshot.models.find((entry) => entry.id === agent?.modelId);
  const activeRuntimes = snapshot.runtimes
    .filter((runtime) => agent?.activeRuntimeIds.includes(runtime.id))
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));

  if (!agent) {
    return null;
  }

  return (
    <>
      <InfoCard icon={Cpu} title="Agent identity" value={agent.id}>
        <p>{agent.name}</p>
        <p>{agent.identity.emoji ? `${agent.identity.emoji} · ${agent.identity.theme ?? "theme unset"}` : "No identity emoji"}</p>
        <div className="flex flex-wrap gap-2">
          {agent.isDefault ? <Badge variant="default">default agent</Badge> : null}
          {agent.identity.source ? <Badge variant="muted">{agent.identity.source}</Badge> : null}
        </div>
      </InfoCard>

      <InfoCard icon={FolderGit2} title="Workspace" value={workspace?.name || "n/a"}>
        <p className="font-mono text-xs text-slate-400">{compactPath(agent.workspacePath)}</p>
        <p>{agent.sessionCount} recorded sessions</p>
      </InfoCard>

      <InfoCard icon={Cpu} title="Model assignment" value={model?.name || agent.modelId}>
        <p>{model ? `${model.provider} · ${formatContextWindow(model.contextWindow)} ctx` : "Model metadata unavailable"}</p>
        <p>{model?.available === false ? "Currently unavailable" : model?.local ? "Local model route" : "Remote model route"}</p>
      </InfoCard>

      <InfoCard icon={Cpu} title="Agent profile" value={agent.profile.purpose || "Profile not declared"}>
        <p>{agent.profile.purpose || "No explicit purpose was found in the workspace bootstrap files."}</p>
        <div className="flex flex-wrap gap-2">
          {agent.profile.sourceFiles.length > 0 ? (
            agent.profile.sourceFiles.map((sourceFile) => (
              <Badge key={sourceFile} variant="muted">
                {sourceFile}
              </Badge>
            ))
          ) : (
            <Badge variant="warning">derived from config</Badge>
          )}
        </div>
      </InfoCard>

      <InfoCard
        icon={TerminalSquare}
        title="Operating style"
        value={`${agent.profile.operatingInstructions.length} rules`}
      >
        <div className="space-y-3">
          <div>
            <p className="mb-2 text-[10px] uppercase tracking-[0.22em] text-slate-500">Operating instructions</p>
            <InspectorBulletList
              emptyLabel="No workspace bootstrap instructions were found."
              items={agent.profile.operatingInstructions}
            />
          </div>

          <div>
            <p className="mb-2 text-[10px] uppercase tracking-[0.22em] text-slate-500">Response style</p>
            <InspectorTagGroup
              emptyLabel="No explicit response style"
              items={agent.profile.responseStyle}
              emptyVariant="muted"
              itemVariant="muted"
            />
          </div>

          <div>
            <p className="mb-1 text-[10px] uppercase tracking-[0.22em] text-slate-500">Output preference</p>
            <p>{agent.profile.outputPreference || "No explicit output preference was found."}</p>
          </div>
        </div>
      </InfoCard>

      <InfoCard icon={Radar} title="Runtime posture" value={agent.status}>
        <p>{agent.currentAction}</p>
        <p>Last active {formatRelativeTime(agent.lastActiveAt)}</p>
        <p>{agent.heartbeat.enabled ? `Heartbeat ${agent.heartbeat.every}` : "Heartbeat disabled"}</p>
        <div className="flex flex-wrap gap-2">
          <Badge variant={agent.heartbeat.enabled ? "success" : "muted"}>
            {agent.heartbeat.enabled ? "heartbeat on" : "heartbeat off"}
          </Badge>
          {typeof agent.heartbeat.everyMs === "number" ? (
            <Badge variant="muted">{Math.round(agent.heartbeat.everyMs / 1000)}s interval</Badge>
          ) : null}
        </div>
      </InfoCard>

      <InfoCard icon={TerminalSquare} title="Run history" value={String(activeRuntimes.length)}>
        {activeRuntimes.length === 0 ? <p>No runtime history has been recorded for this agent yet.</p> : null}
        {activeRuntimes.map((runtime) => (
          <div
            key={runtime.id}
            className="flex items-center justify-between rounded-[14px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(11,18,32,0.86),rgba(8,13,24,0.82))] px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-[13px] text-white">{runtime.title}</p>
              <p className="truncate text-[10px] uppercase tracking-[0.18em] text-slate-500">{runtime.subtitle}</p>
            </div>
            <Badge variant={runtime.status === "active" ? "default" : runtime.status === "completed" ? "success" : "muted"}>
              {runtime.status}
            </Badge>
          </div>
        ))}
      </InfoCard>

      <InfoCard icon={Cpu} title="Capabilities" value={`${agent.skills.length} skills`}>
        <InspectorTagGroup
          emptyLabel="No explicit skills"
          items={agent.skills}
          emptyVariant="muted"
          itemVariant="muted"
        />
        <div className="pt-1">
          <p className="mb-2 text-[10px] uppercase tracking-[0.22em] text-slate-500">Tools</p>
          <InspectorTagGroup
            emptyLabel="No explicit tools"
            items={agent.tools}
            emptyVariant="muted"
            itemVariant="warning"
          />
        </div>
      </InfoCard>
    </>
  );
}

function RuntimeContent({
  snapshot,
  runtimeId,
  runtimeOutput,
  runtimeOutputLoading,
  runtimeOutputError
}: {
  snapshot: MissionControlSnapshot;
  runtimeId: string;
  runtimeOutput: RuntimeOutputRecord | null;
  runtimeOutputLoading: boolean;
  runtimeOutputError: string | null;
}) {
  const runtime = snapshot.runtimes.find((entry) => entry.id === runtimeId);

  if (!runtime) {
    return null;
  }

  return (
    <>
      <InfoCard icon={TerminalSquare} title="Runtime key" value={runtime.status}>
        <p className="font-mono text-xs text-slate-400">{runtime.key}</p>
        <p>Session {shortId(runtime.sessionId, 12)}</p>
        {runtime.taskId ? <p>Task {shortId(runtime.taskId, 12)}</p> : null}
        {runtime.runId ? <p>Run {shortId(runtime.runId, 12)}</p> : null}
      </InfoCard>
      <InfoCard icon={Radar} title="Activity" value={formatRelativeTime(runtime.updatedAt)}>
        <p>{runtime.subtitle}</p>
        <p>{formatTokens(runtime.tokenUsage?.total)} tokens</p>
      </InfoCard>
      <InfoCard
        icon={Cpu}
        title="Latest output"
        value={runtimeOutput?.stopReason || (runtimeOutputLoading ? "loading" : "no transcript")}
      >
        {runtimeOutputLoading ? <p>Loading transcript output…</p> : null}
        {runtimeOutputError ? <p>{runtimeOutputError}</p> : null}
        {!runtimeOutputLoading && !runtimeOutputError ? (
          <p className="whitespace-pre-wrap text-[13px] leading-5 text-slate-100">
            {runtimeOutput?.finalText || runtimeOutput?.errorMessage || "No assistant output has been recorded for this runtime yet."}
          </p>
        ) : null}
        {runtimeOutput?.finalTimestamp ? (
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
            Updated {formatRelativeTime(new Date(runtimeOutput.finalTimestamp).getTime())}
          </p>
        ) : null}
      </InfoCard>
    </>
  );
}

function RuntimeOutputContent({
  runtime,
  runtimeOutput,
  runtimeOutputLoading,
  runtimeOutputError
}: {
  runtime: MissionControlSnapshot["runtimes"][number];
  runtimeOutput: RuntimeOutputRecord | null;
  runtimeOutputLoading: boolean;
  runtimeOutputError: string | null;
}) {
  if (runtimeOutputLoading) {
    return (
      <InfoCard icon={TerminalSquare} title="Runtime output" value="loading">
        <p>Loading transcript output for {runtime.title}…</p>
      </InfoCard>
    );
  }

  if (runtimeOutputError) {
    return (
      <InfoCard icon={TerminalSquare} title="Runtime output" value="error">
        <p>{runtimeOutputError}</p>
      </InfoCard>
    );
  }

  if (!runtimeOutput) {
    return (
      <InfoCard icon={TerminalSquare} title="Runtime output" value="missing">
        <p>No transcript data is available for this runtime.</p>
      </InfoCard>
    );
  }

  return (
    <div className="space-y-3.5">
      <InfoCard icon={TerminalSquare} title="Final response" value={runtimeOutput.stopReason || runtimeOutput.status}>
        <p className="whitespace-pre-wrap text-[13px] leading-5 text-slate-100">
          {runtimeOutput.finalText || runtimeOutput.errorMessage || "No assistant output has been recorded for this runtime yet."}
        </p>
        {runtimeOutput.finalTimestamp ? (
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
            {new Date(runtimeOutput.finalTimestamp).toLocaleString()}
          </p>
        ) : null}
      </InfoCard>

      <InfoCard icon={Radar} title="Transcript trail" value={String(runtimeOutput.items.length)}>
        {runtimeOutput.items.length === 0 ? <p>No transcript entries were found.</p> : null}
        <div className="space-y-2">
          {runtimeOutput.items.map((item) => (
            <div
              key={item.id}
              className="rounded-[14px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(11,18,32,0.86),rgba(8,13,24,0.82))] px-3 py-2.5"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      item.role === "assistant"
                        ? item.isError
                          ? "danger"
                          : "default"
                        : item.role === "toolResult"
                          ? "warning"
                          : "muted"
                    }
                  >
                    {item.role}
                  </Badge>
                  {item.toolName ? <Badge variant="muted">{item.toolName}</Badge> : null}
                </div>
                <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                  {formatRelativeTime(new Date(item.timestamp).getTime())}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-5 text-slate-100">{item.text}</p>
            </div>
          ))}
        </div>
      </InfoCard>
    </div>
  );
}

function ModelContent({
  snapshot,
  modelId
}: {
  snapshot: MissionControlSnapshot;
  modelId: string;
}) {
  const model = snapshot.models.find((entry) => entry.id === modelId);

  if (!model) {
    return null;
  }

  return (
    <>
      <InfoCard icon={Cpu} title="Model routing" value={model.provider}>
        <p>{model.name}</p>
        <p>{model.local ? "Local model" : "Remote model"}</p>
      </InfoCard>
      <InfoCard icon={Radar} title="Capacity" value={`${formatContextWindow(model.contextWindow)} ctx`}>
        <p>{model.input}</p>
        <p>{model.available === false ? "Unavailable" : "Available"}</p>
        <p>{model.usageCount} attached agents</p>
      </InfoCard>
    </>
  );
}

function InspectorRailButton({
  icon: Icon,
  label,
  active,
  disabled = false,
  onClick
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-11 w-11 items-center justify-center rounded-[16px] border transition-all",
        disabled
          ? "border-white/5 bg-white/[0.02] text-slate-600"
          : active
            ? "border-cyan-300/20 bg-cyan-400 text-slate-950 shadow-[0_12px_28px_rgba(96,165,250,0.35)]"
            : "border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/15 hover:bg-white/[0.08] hover:text-white"
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function InspectorTabButton({
  label,
  active,
  onClick
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-2 text-[11px] uppercase tracking-[0.18em] transition-all",
        active
          ? "border-cyan-300/20 bg-cyan-400 text-slate-950 shadow-[0_10px_24px_rgba(96,165,250,0.28)]"
          : "border-white/[0.08] bg-white/[0.03] text-slate-300 hover:bg-white/[0.07] hover:text-white"
      )}
    >
      {label}
    </button>
  );
}

function InfoCard({
  icon: Icon,
  title,
  value,
  children
}: {
  icon: LucideIcon;
  title: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[18px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(12,19,34,0.86),rgba(8,13,24,0.82))] p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">{title}</p>
          <p className="font-display text-[1rem] text-white">{value}</p>
        </div>
        <div className="rounded-[14px] border border-white/[0.08] bg-white/5 p-2 text-slate-300">
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      <div className="mt-3 space-y-1.5 text-[12.5px] leading-5 text-slate-300">{children}</div>
    </section>
  );
}

function InspectorTagGroup({
  items,
  emptyLabel,
  itemVariant,
  emptyVariant
}: {
  items: string[];
  emptyLabel: string;
  itemVariant: React.ComponentProps<typeof Badge>["variant"];
  emptyVariant: React.ComponentProps<typeof Badge>["variant"];
}) {
  if (items.length === 0) {
    return <Badge variant={emptyVariant}>{emptyLabel}</Badge>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <Badge key={item} variant={itemVariant}>
          {item}
        </Badge>
      ))}
    </div>
  );
}

function InspectorBulletList({
  items,
  emptyLabel
}: {
  items: string[];
  emptyLabel: string;
}) {
  if (items.length === 0) {
    return <p className="text-[12px] text-slate-400">{emptyLabel}</p>;
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div
          key={item}
          className="rounded-[14px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(11,18,32,0.86),rgba(8,13,24,0.82))] px-3 py-2"
        >
          <p className="text-[12px] leading-5 text-slate-200">{item}</p>
        </div>
      ))}
    </div>
  );
}
