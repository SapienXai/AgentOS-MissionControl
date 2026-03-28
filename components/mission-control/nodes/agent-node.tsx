"use client";

import { useEffect, useRef, useState } from "react";

import { Handle, Position, type Node as FlowNode, type NodeProps } from "@xyflow/react";
import { ChevronDown, ChevronUp, MoreHorizontal } from "lucide-react";
import { motion } from "motion/react";

import type { AgentNodeData } from "@/components/mission-control/canvas-types";
import { StatusDot } from "@/components/mission-control/status-dot";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  formatAgentFileAccessLabel,
  formatAgentInstallScopeLabel,
  formatAgentMissingToolBehaviorLabel,
  formatAgentNetworkAccessLabel,
  formatAgentPresetLabel
} from "@/lib/openclaw/agent-presets";
import { formatModelLabel, formatRelativeTime, toneForAgentStatus } from "@/lib/openclaw/presenters";
import { cn } from "@/lib/utils";

type AgentFlowNode = FlowNode<AgentNodeData, "agent">;

export function AgentNode({ data, selected }: NodeProps<AgentFlowNode>) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const detailsPanelId = `agent-details-${data.agent.id}`;
  const isAttentionActive = selected || data.composerFocused;
  const tone = toneForAgentStatus(data.agent.status);
  const dotTone =
    data.agent.status === "engaged"
      ? "bg-cyan-300"
      : data.agent.status === "monitoring"
        ? "bg-emerald-300"
        : data.agent.status === "ready"
          ? "bg-amber-200"
          : data.agent.status === "offline"
            ? "bg-rose-300"
            : "bg-slate-500";
  const skillCount = data.agent.skills.length;
  const declaredTools = data.agent.tools;
  const observedTools = data.agent.observedTools ?? [];
  const declaredToolCount = declaredTools.length;
  const observedToolCount = observedTools.length;
  const skillLabel = `${skillCount} skill${skillCount === 1 ? "" : "s"}`;
  const toolLabel =
    observedToolCount > 0
      ? `${observedToolCount} observed tool${observedToolCount === 1 ? "" : "s"}`
      : declaredToolCount > 0
        ? `${declaredToolCount} configured tool${declaredToolCount === 1 ? "" : "s"}`
        : "No tools observed";
  const telegramTetherCount = data.telegramTetherCount ?? 0;
  const hasTelegramTether = data.agent.isDefault || telegramTetherCount > 0;
  const heartbeatLabel = data.agent.heartbeat.enabled
    ? data.agent.heartbeat.every ??
      (typeof data.agent.heartbeat.everyMs === "number"
        ? `${Math.round(data.agent.heartbeat.everyMs / 1000)}s`
        : null)
    : null;
  const lastActiveLabel = data.agent.lastActiveAt
    ? formatRelativeTime(data.agent.lastActiveAt, data.relativeTimeReferenceMs)
    : "No recent activity";
  const roleSummary = `${formatAgentPresetLabel(data.agent.policy.preset)} · ${skillLabel} · ${toolLabel}`;
  const postureSummary = data.agent.lastActiveAt
    ? `${formatAgentFileAccessLabel(data.agent.policy.fileAccess)} · Heartbeat ${data.agent.heartbeat.enabled ? heartbeatLabel ?? "on" : "off"} · Last active ${lastActiveLabel}`
    : `${formatAgentFileAccessLabel(data.agent.policy.fileAccess)} · Heartbeat ${data.agent.heartbeat.enabled ? heartbeatLabel ?? "on" : "off"} · ${lastActiveLabel}`;

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [menuOpen]);

  return (
    <div
      className={cn(
        "agent-node relative isolate w-[212px] overflow-visible rounded-[16px] border border-cyan-300/12 bg-[linear-gradient(180deg,rgba(15,24,40,0.94),rgba(8,13,24,0.94))] px-3 py-2.5 shadow-[0_16px_28px_rgba(0,0,0,0.26)] backdrop-blur-xl",
        data.emphasis ? "opacity-100" : "opacity-72",
        selected && "border-cyan-300/[0.45] shadow-[0_18px_42px_rgba(34,211,238,0.16)]",
        isAttentionActive && "border-cyan-200/[0.56] shadow-[0_20px_52px_rgba(34,211,238,0.24)]"
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_10%,rgba(34,211,238,0.18),transparent_36%),radial-gradient(circle_at_84%_18%,rgba(16,185,129,0.08),transparent_28%)]" />
      <div className="pointer-events-none absolute inset-y-4 left-0 w-[3px] rounded-r-full bg-[linear-gradient(180deg,rgba(125,211,252,0.9),rgba(34,211,238,0.14))]" />
      <div className="pointer-events-none absolute inset-x-3 top-0 h-px bg-cyan-200/10" />
      <div className="pointer-events-none absolute right-2 top-2 h-10 w-10 rounded-full bg-cyan-300/10 blur-xl" />
      {hasTelegramTether ? (
        <div className="pointer-events-none absolute left-[-4px] top-[-4px] h-12 w-12 rounded-full bg-cyan-300/14 blur-xl" />
      ) : null}
      {hasTelegramTether ? (
        <Handle
          type="source"
          id="source-telegram"
          position={Position.Top}
          style={{ left: 14, top: -4 }}
          className="!h-2.5 !w-2.5 !border-0 !bg-cyan-200/90 shadow-[0_0_16px_rgba(34,211,238,0.52)]"
        />
      ) : null}
      {isAttentionActive ? (
        <>
          <div aria-hidden="true" className="agent-node__composer-glow pointer-events-none absolute inset-[-7px] z-0 rounded-[22px]" />
          <svg
            aria-hidden="true"
            className="agent-node__composer-svg pointer-events-none absolute inset-[-4px] z-0 h-[calc(100%+8px)] w-[calc(100%+8px)] overflow-visible"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            <rect
              x="3.5"
              y="3.5"
              width="93"
              height="93"
              rx="16.5"
              pathLength={100}
              className="agent-node__composer-rail"
            />
            <rect
              x="3.5"
              y="3.5"
              width="93"
              height="93"
              rx="16.5"
              pathLength={100}
              className="agent-node__composer-trace agent-node__composer-trace--glow"
            />
            <rect
              x="3.5"
              y="3.5"
              width="93"
              height="93"
              rx="16.5"
              pathLength={100}
              className="agent-node__composer-trace agent-node__composer-trace--tail"
            />
            <rect
              x="3.5"
              y="3.5"
              width="93"
              height="93"
              rx="16.5"
              pathLength={100}
              className="agent-node__composer-trace agent-node__composer-trace--core"
            />
          </svg>
        </>
      ) : null}

      <div className="relative z-10">
        <Handle
          type="source"
          id="source-right"
          position={Position.Right}
          className="!h-2.5 !w-2.5 !border-0 !bg-cyan-300/90 shadow-[0_0_14px_rgba(103,232,249,0.42)]"
        />

        <div className="flex items-start justify-between gap-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.22em] text-slate-500">
              <StatusDot tone={dotTone} pulse={data.agent.status === "engaged" || data.agent.status === "monitoring"} />
              Agent
            </div>
            <p className="mt-1.5 truncate font-display text-[0.96rem] text-white">{data.agent.name}</p>
            <p className="mt-0.5 truncate text-[10px] uppercase tracking-[0.16em] text-slate-500">
              {data.agent.identity.theme ?? "OpenClaw operator"}
            </p>
          </div>

          <div className="nodrag nopan relative" ref={menuRef}>
            <button
              type="button"
              aria-label={`${data.agent.name} actions`}
              onClick={(event) => {
                event.stopPropagation();
                setMenuOpen((current) => !current);
              }}
              onPointerDown={(event) => event.stopPropagation()}
              className="nodrag nopan inline-flex rounded-full border border-white/[0.08] bg-white/[0.05] p-1.5 text-slate-300 transition-colors hover:bg-white/[0.1] hover:text-white"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>

            {menuOpen ? (
              <div
                className="absolute right-0 top-[calc(100%+8px)] z-30 min-w-[136px] rounded-[14px] border border-white/[0.1] bg-slate-950/96 p-1.5 shadow-[0_20px_44px_rgba(0,0,0,0.42)] backdrop-blur-xl"
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <AgentMenuButton
                  label={data.focused ? "Clear focus" : "Focus"}
                  onClick={() => {
                    data.onFocus?.(data.agent.id);
                    setMenuOpen(false);
                  }}
                />
                <AgentMenuButton
                  label="Edit"
                  onClick={() => {
                    data.onEdit?.(data.agent.id);
                    setMenuOpen(false);
                  }}
                />
                <AgentMenuButton
                  label="Delete"
                  danger
                  onClick={() => {
                    data.onDelete?.(data.agent.id);
                    setMenuOpen(false);
                  }}
                />
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <Badge variant={data.agent.status === "engaged" ? "default" : data.agent.status === "monitoring" ? "success" : "warning"}>
            {data.agent.status}
          </Badge>
          <Badge variant="muted" className="max-w-[132px] truncate">
            {formatModelLabel(data.agent.modelId)}
          </Badge>
        </div>

        <div className="mt-2.5 rounded-[14px] border border-cyan-300/10 bg-cyan-400/[0.05] px-2.5 py-2">
          <p className="text-[9px] uppercase tracking-[0.22em] text-cyan-100/70">Active command</p>
          <p className="mt-1 text-[12px] leading-4 text-slate-100">{data.agent.currentAction}</p>
          <p className={cn("mt-1.5 text-[9px] uppercase tracking-[0.2em]", tone)}>{data.agent.id}</p>
        </div>

        <div className={cn("mt-2.5 border-t border-white/[0.08] pt-2.5", expanded && "pb-1")}>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={detailsPanelId}
            className="nodrag nopan group flex w-full items-start justify-between gap-3 rounded-[14px] border border-transparent px-1 py-1.5 text-left transition-colors hover:border-white/[0.06] hover:bg-white/[0.02]"
            onClick={(event) => {
              event.stopPropagation();
              setExpanded((current) => !current);
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="min-w-0">
              <p className="text-[9px] uppercase tracking-[0.2em] text-slate-500 transition-colors group-hover:text-slate-400">
                Agent details
              </p>
              <p className="mt-1 truncate text-[10px] text-slate-300">{roleSummary}</p>
              <p className="mt-1 truncate text-[10px] text-slate-500">{postureSummary}</p>
            </div>
            <div className="mt-0.5 shrink-0 rounded-full border border-white/[0.08] bg-white/[0.04] p-1 text-slate-400 transition-colors group-hover:border-white/[0.12] group-hover:text-slate-200">
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </div>
          </button>

          {expanded ? (
            <motion.div
              id={detailsPanelId}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="nodrag nopan overflow-hidden nowheel"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="pt-2.5">
                <ScrollArea className="h-[160px] w-full pr-3">
                  <div className="space-y-2.5">
                    <div>
                      <p className="mb-2 text-[9px] uppercase tracking-[0.2em] text-slate-500">Capabilities</p>
                      <div className="flex flex-wrap gap-1.5">
                        {data.agent.skills.length > 0 ? (
                          data.agent.skills.map((skill) => (
                            <Badge key={skill} variant="muted" className="max-w-full truncate">
                              {skill}
                            </Badge>
                          ))
                        ) : (
                          <Badge variant="muted">No explicit skills</Badge>
                        )}
                      </div>
                    </div>

                    <div>
                      <p className="mb-2 text-[9px] uppercase tracking-[0.2em] text-slate-500">Declared tools</p>
                      <div className="flex flex-wrap gap-1.5">
                        {declaredTools.length > 0 ? (
                          declaredTools.map((tool) => (
                            <Badge key={tool} variant="warning" className="max-w-full truncate">
                              {tool}
                            </Badge>
                          ))
                        ) : (
                          <Badge variant="muted">No explicit tools configured</Badge>
                        )}
                      </div>
                    </div>

                    <div>
                      <p className="mb-2 text-[9px] uppercase tracking-[0.2em] text-slate-500">Observed tools</p>
                      <div className="flex flex-wrap gap-1.5">
                        {observedTools.length > 0 ? (
                          observedTools.map((tool) => (
                            <Badge key={tool} variant="default" className="max-w-full truncate">
                              {tool}
                            </Badge>
                          ))
                        ) : (
                          <Badge variant="muted">No runtime tool calls recovered yet</Badge>
                        )}
                      </div>
                    </div>

                    <div>
                      <p className="mb-2 text-[9px] uppercase tracking-[0.2em] text-slate-500">Permissions</p>
                      <div className="grid gap-1.5">
                        <AgentDetailRow
                          label="File access"
                          value={formatAgentFileAccessLabel(data.agent.policy.fileAccess)}
                        />
                        <AgentDetailRow
                          label="Network"
                          value={formatAgentNetworkAccessLabel(data.agent.policy.networkAccess)}
                        />
                        <AgentDetailRow
                          label="Install scope"
                          value={formatAgentInstallScopeLabel(data.agent.policy.installScope)}
                        />
                        <AgentDetailRow
                          label="Missing tools"
                          value={formatAgentMissingToolBehaviorLabel(data.agent.policy.missingToolBehavior)}
                        />
                      </div>
                    </div>

                    <div>
                      <p className="mb-2 text-[9px] uppercase tracking-[0.2em] text-slate-500">Runtime posture</p>
                      <div className="grid gap-1.5">
                        <AgentDetailRow label="Last active" value={lastActiveLabel} />
                        <AgentDetailRow
                          label="Heartbeat"
                          value={data.agent.heartbeat.enabled ? (heartbeatLabel ? `On · ${heartbeatLabel}` : "On") : "Off"}
                        />
                        <AgentDetailRow label="Sessions" value={String(data.agent.sessionCount)} />
                        <AgentDetailRow label="Active runs" value={String(data.agent.activeRuntimeIds.length)} />
                      </div>
                    </div>
                  </div>
                </ScrollArea>
              </div>
            </motion.div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AgentMenuButton({
  label,
  onClick,
  danger = false
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "nodrag nopan flex w-full items-center rounded-[10px] px-2.5 py-2 text-left text-[11px] transition-colors",
        danger
          ? "text-rose-200 hover:bg-rose-400/10 hover:text-rose-100"
          : "text-slate-200 hover:bg-white/[0.06] hover:text-white"
      )}
      onClick={onClick}
    >
      <span>{label}</span>
    </button>
  );
}

function AgentDetailRow({
  label,
  value
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-[10px] bg-white/[0.02] px-2.5 py-1.5">
      <span className="shrink-0 text-[9px] uppercase tracking-[0.18em] text-slate-500">{label}</span>
      <span className="min-w-0 text-right text-[10px] leading-4 text-slate-100">{value}</span>
    </div>
  );
}
