"use client";

import { useEffect, useRef, useState } from "react";

import { Handle, Position, type Node as FlowNode, type NodeProps } from "@xyflow/react";
import { ChevronDown, MessageCircle, MoreHorizontal, UserPlus } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import type { AgentDetailFocus, AgentNodeData } from "@/components/mission-control/canvas-types";
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
import { formatAgentDisplayName, formatModelLabel, formatRelativeTime } from "@/lib/openclaw/presenters";
import { cn } from "@/lib/utils";

type AgentFlowNode = FlowNode<AgentNodeData, "agent">;
const agentNameVariants = {
  hidden: {
    opacity: 0
  },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.022,
      delayChildren: 0.03
    }
  },
  exit: {
    opacity: 0,
    transition: {
      duration: 0.14,
      ease: "easeInOut"
    }
  }
} as const;

const agentNameGlyphVariants = {
  hidden: {
    opacity: 0,
    y: 10
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.22,
      ease: [0.22, 1, 0.36, 1]
    }
  },
  exit: {
    opacity: 0,
    y: -8,
    transition: {
      duration: 0.14,
      ease: "easeOut"
    }
  }
} as const;

function AnimatedAgentName({ label }: { label: string }) {
  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.span
        key={label}
        variants={agentNameVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        aria-label={label}
        className="inline-block max-w-full whitespace-nowrap"
      >
        {Array.from(label).map((glyph, index) => (
          <motion.span
            key={`${label}:${index}:${glyph}`}
            variants={agentNameGlyphVariants}
            aria-hidden="true"
            className="inline-block"
          >
            {glyph === " " ? "\u00A0" : glyph}
          </motion.span>
        ))}
      </motion.span>
    </AnimatePresence>
  );
}

export function AgentNode({ data, selected }: NodeProps<AgentFlowNode>) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const drawerPanelId = `agent-drawer-${data.agent.id}`;
  const agentLabel = formatAgentDisplayName(data.agent);
  const isAttentionActive = selected || data.composerFocused;
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
  const declaredTools = data.agent.tools;
  const observedTools = data.agent.observedTools ?? [];
  const declaredToolCount = declaredTools.length;
  const observedToolCount = observedTools.length;
  const displayToolCount = new Set([
    ...declaredTools.filter((tool) => tool !== "fs.workspaceOnly"),
    ...observedTools
  ]).size;
  const inspectAgentSection = (focus: AgentDetailFocus) => {
    data.onInspect?.(data.agent.id, focus);
  };
  const configureAgentCapabilities = (focus: "skills" | "tools") => {
    if (data.onConfigureCapabilities) {
      data.onConfigureCapabilities(data.agent.id, focus);
      return;
    }

    inspectAgentSection(focus);
  };
  const statusBadgeVariant =
    data.agent.status === "engaged"
      ? "default"
      : data.agent.status === "monitoring"
        ? "success"
        : data.agent.status === "ready"
          ? "warning"
          : data.agent.status === "offline"
            ? "danger"
            : "muted";
  const themeLabel = data.agent.identity.theme ?? formatAgentPresetLabel(data.agent.policy.preset);
  const skillCount = data.agent.skills.length;
  const telegramTetherCount = data.telegramTetherCount ?? 0;
  const hasTelegramTether = data.agent.isDefault || telegramTetherCount > 0;
  const heartbeatLabel = data.agent.heartbeat.enabled
    ? data.agent.heartbeat.every ??
      (typeof data.agent.heartbeat.everyMs === "number"
        ? `${Math.round(data.agent.heartbeat.everyMs / 1000)}s`
        : null)
    : null;
  const currentActionLabel = typeof data.agent.currentAction === "string" ? data.agent.currentAction.trim() : "";
  const purposeLabel = data.agent.profile?.purpose?.trim() || currentActionLabel || "OpenClaw operator";
  const lastSeenLabel = data.agent.lastActiveAt
    ? formatRelativeTime(data.agent.lastActiveAt, data.relativeTimeReferenceMs)
    : "never";
  const metaLabel = `${formatAgentFileAccessLabel(data.agent.policy.fileAccess)} · Heartbeat ${
    data.agent.heartbeat.enabled ? heartbeatLabel ?? "on" : "off"
  } · Last seen ${lastSeenLabel}`;
  const visibleSkills = data.agent.skills.slice(0, 4);
  const visibleDeclaredTools = declaredTools.slice(0, 3);
  const visibleObservedTools = observedTools.slice(0, 3);
  const remainingSkills = Math.max(data.agent.skills.length - visibleSkills.length, 0);
  const remainingDeclaredTools = Math.max(declaredToolCount - visibleDeclaredTools.length, 0);
  const remainingObservedTools = Math.max(observedToolCount - visibleObservedTools.length, 0);

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
        "agent-node relative isolate w-[272px] overflow-visible rounded-[24px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(18,20,26,0.96),rgba(9,11,15,0.96))] pt-0 pb-0 shadow-[0_20px_44px_rgba(0,0,0,0.34)] backdrop-blur-xl",
        data.emphasis ? "opacity-100" : "opacity-72",
        selected && "border-cyan-300/[0.42] shadow-[0_22px_48px_rgba(34,211,238,0.16)]",
        isAttentionActive && "border-cyan-200/[0.54] shadow-[0_24px_56px_rgba(34,211,238,0.22)]"
      )}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[24px]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_10%,rgba(34,211,238,0.18),transparent_36%),radial-gradient(circle_at_84%_18%,rgba(16,185,129,0.08),transparent_28%)]" />
        <div className="pointer-events-none absolute inset-y-4 left-0 w-[3px] rounded-r-full bg-[linear-gradient(180deg,rgba(125,211,252,0.9),rgba(34,211,238,0.14))]" />
        <div className="pointer-events-none absolute inset-x-3 top-0 h-px bg-cyan-200/10" />
        <div className="pointer-events-none absolute right-2 top-2 h-10 w-10 rounded-full bg-cyan-300/10 blur-xl" />
      </div>

      {hasTelegramTether ? (
        <Handle
          type="source"
          id="source-telegram"
          position={Position.Top}
          style={{ left: 14, top: 6 }}
          className="!z-30 !h-2.5 !w-2.5 !border-0 !bg-cyan-200/90 shadow-[0_0_16px_rgba(34,211,238,0.52)]"
        />
      ) : null}

      {isAttentionActive ? (
        <>
          <div aria-hidden="true" className="agent-node__composer-glow pointer-events-none absolute inset-[-1px] z-0 rounded-[25px]" />
          <svg
            aria-hidden="true"
            className="agent-node__composer-svg pointer-events-none absolute inset-[-1px] z-20 h-[calc(100%+2px)] w-[calc(100%+2px)] overflow-hidden rounded-[25px]"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            <rect
              x="0"
              y="0"
              width="100"
              height="100"
              rx="8.5"
              ry="8.5"
              pathLength={100}
              className="agent-node__composer-rail"
            />
            <rect
              x="0"
              y="0"
              width="100"
              height="100"
              rx="8.5"
              ry="8.5"
              pathLength={100}
              className="agent-node__composer-trace agent-node__composer-trace--glow"
            />
            <rect
              x="0"
              y="0"
              width="100"
              height="100"
              rx="8.5"
              ry="8.5"
              pathLength={100}
              className="agent-node__composer-trace agent-node__composer-trace--tail"
            />
            <rect
              x="0"
              y="0"
              width="100"
              height="100"
              rx="8.5"
              ry="8.5"
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
          className="!z-30 !h-2.5 !w-2.5 !border-0 !bg-cyan-300/90 shadow-[0_0_14px_rgba(103,232,249,0.42)]"
        />

        <div className="relative rounded-t-[24px]">
          <div className="relative h-[144px] overflow-hidden rounded-t-[24px] border-b border-white/[0.12] bg-[linear-gradient(180deg,rgba(14,16,20,0.98),rgba(8,10,14,0.95))]">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(34,211,238,0.22),transparent_34%),radial-gradient(circle_at_82%_18%,rgba(251,191,36,0.16),transparent_30%)]" />
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/10" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-[linear-gradient(180deg,transparent,rgba(8,10,14,0.82))]" />

            <video
              className="pointer-events-none absolute inset-0 h-full w-full object-cover object-center brightness-[0.88] contrast-[1.04] saturate-[0.92]"
              autoPlay
              loop
              muted
              playsInline
              preload="metadata"
              aria-hidden="true"
            >
              <source src="/assets/agent.mp4" type="video/mp4" />
            </video>

            <motion.div
              aria-hidden="true"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(3,4,7,0.48),rgba(3,4,7,0.84)),radial-gradient(circle_at_center,transparent_38%,rgba(3,4,7,0.34)_100%),radial-gradient(circle_at_20%_10%,rgba(34,211,238,0.07),transparent_34%),radial-gradient(circle_at_82%_18%,rgba(251,191,36,0.04),transparent_28%)]"
            />

            <div
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-2 right-5 h-12 w-12 rounded-full bg-cyan-300/14 blur-2xl"
            />

            <div className="absolute inset-x-0 bottom-0 z-30 p-3.5">
              <div className="max-w-[86%]">
                <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.22em] text-white/65">
                  <StatusDot tone={dotTone} pulse={data.agent.status === "engaged" || data.agent.status === "monitoring"} />
                  Agent
                </div>
                <p className="mt-1 truncate font-display text-[1.08rem] leading-5 text-white">
                  <AnimatedAgentName label={agentLabel} />
                </p>
                <p className="mt-0.5 truncate text-[10px] uppercase tracking-[0.16em] text-amber-200/90">{themeLabel}</p>
              </div>
            </div>
          </div>

          <div className="absolute right-2 top-2 z-40" ref={menuRef}>
            <button
              type="button"
              aria-label={`${agentLabel} actions`}
              onClick={(event) => {
                event.stopPropagation();
                setMenuOpen((current) => !current);
              }}
              onPointerDown={(event) => event.stopPropagation()}
              className="nodrag nopan inline-flex rounded-full border border-white/[0.08] bg-slate-950/60 p-1.5 text-slate-300 shadow-[0_10px_22px_rgba(0,0,0,0.22)] transition-colors hover:bg-slate-900/75 hover:text-white"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>

            {menuOpen ? (
              <div
                className="absolute right-0 top-[calc(100%+8px)] z-50 min-w-[136px] rounded-[14px] border border-white/[0.1] bg-slate-950/96 p-1.5 shadow-[0_20px_44px_rgba(0,0,0,0.42)] backdrop-blur-xl"
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

        <div className="px-3.5 pt-3.5 pb-3.5">
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge variant={statusBadgeVariant}>{data.agent.status}</Badge>
            <Badge variant="muted" className="max-w-[150px] truncate">
              {formatModelLabel(data.agent.modelId)}
            </Badge>
          </div>

          <div className="mt-2.5">
            <p className="line-clamp-2 text-[12px] leading-5 text-slate-300">{purposeLabel}</p>
            <p className="mt-2 truncate text-[9px] uppercase tracking-[0.18em] text-slate-500">{metaLabel}</p>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <AgentStatTile
              label="Skills"
              value={skillCount}
              ariaLabel={`Open skills for ${agentLabel}`}
              onClick={() => configureAgentCapabilities("skills")}
            />
            <AgentStatTile
              label="Tools"
              value={displayToolCount}
              ariaLabel={`Open tools for ${agentLabel}`}
              onClick={() => configureAgentCapabilities("tools")}
            />
            <AgentStatTile
              label="Sessions"
              value={data.agent.sessionCount}
              ariaLabel={`Open sessions for ${agentLabel}`}
              onClick={() => inspectAgentSection("sessions")}
            />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              className="nodrag nopan inline-flex h-10 items-center justify-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.05] px-3.5 text-[12px] text-slate-200 transition-colors hover:bg-white/[0.08] hover:text-white"
              onClick={(event) => {
                event.stopPropagation();
                data.onMessage?.(data.agent.id);
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <MessageCircle className="h-3.5 w-3.5" />
              <span>Message</span>
            </button>

            <button
              type="button"
              className={cn(
                "nodrag nopan inline-flex h-10 items-center justify-center gap-1.5 rounded-full border px-3.5 text-[12px] transition-colors",
                data.focused
                  ? "border-amber-200/40 bg-[linear-gradient(180deg,rgba(252,211,77,0.96),rgba(217,119,6,0.9))] text-slate-950 shadow-[0_12px_26px_rgba(217,119,6,0.28)]"
                  : "border-amber-200/35 bg-[linear-gradient(180deg,rgba(251,191,36,0.94),rgba(217,119,6,0.88))] text-slate-950 shadow-[0_12px_26px_rgba(217,119,6,0.24)]"
              )}
              onClick={(event) => {
                event.stopPropagation();
                data.onFocus?.(data.agent.id);
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <UserPlus className="h-3.5 w-3.5" />
              <span>{data.focused ? "Following" : "Follow +"}</span>
            </button>
          </div>
        </div>

        <div className="overflow-hidden rounded-b-[24px] border-t border-white/[0.08] bg-white/[0.03] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <button
            type="button"
            aria-expanded={drawerOpen}
            aria-controls={drawerPanelId}
            className="nodrag nopan group flex h-9 w-full items-center gap-2 px-2.5 text-left transition-colors hover:bg-white/[0.04]"
            onClick={(event) => {
              event.stopPropagation();
              setDrawerOpen((current) => !current);
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="flex min-w-0 items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300/75 shadow-[0_0_10px_rgba(34,211,238,0.35)]"
              />
              <p className="truncate text-[8px] uppercase tracking-[0.22em] leading-none text-slate-500 transition-colors group-hover:text-slate-400">
                Agent details
              </p>
            </div>
            <p className="ml-auto min-w-0 truncate text-[8px] leading-none text-slate-400">
              {skillCount} skill{skillCount === 1 ? "" : "s"} · {displayToolCount} tool
              {displayToolCount === 1 ? "" : "s"} · policy
            </p>
            <div className="shrink-0 rounded-full border border-white/[0.08] bg-white/[0.04] p-0.5 text-slate-400 transition-colors group-hover:border-white/[0.12] group-hover:text-slate-200">
              <ChevronDown className={cn("h-2.5 w-2.5 transition-transform duration-200", drawerOpen && "rotate-180")} />
            </div>
          </button>

          <AnimatePresence initial={false}>
            {drawerOpen ? (
              <motion.div
                id={drawerPanelId}
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="nodrag nopan overflow-hidden nowheel border-t border-white/[0.08]"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="px-2.5 py-2">
                  <ScrollArea className="h-[100px] w-full pr-2">
                    <div className="space-y-2">
                      <div>
                        <p className="mb-1 text-[8px] uppercase tracking-[0.22em] text-slate-500">Capabilities</p>
                        <div className="flex flex-wrap gap-1">
                          {visibleSkills.length > 0 ? (
                            visibleSkills.map((skill) => (
                              <Badge key={skill} variant="muted" className="max-w-full truncate text-[10px]">
                                {skill}
                              </Badge>
                            ))
                          ) : (
                            <Badge variant="muted" className="text-[10px]">
                              No explicit skills
                            </Badge>
                          )}
                          {remainingSkills > 0 ? (
                            <Badge variant="muted" className="text-[10px]">
                              +{remainingSkills}
                            </Badge>
                          ) : null}
                        </div>
                      </div>

                      <div>
                        <p className="mb-1 text-[8px] uppercase tracking-[0.22em] text-slate-500">Declared tools</p>
                        <div className="flex flex-wrap gap-1">
                          {visibleDeclaredTools.length > 0 ? (
                            visibleDeclaredTools.map((tool) => (
                              <Badge key={tool} variant="warning" className="max-w-full truncate text-[10px]">
                                {tool}
                              </Badge>
                            ))
                          ) : (
                            <Badge variant="muted" className="text-[10px]">
                              No explicit tools
                            </Badge>
                          )}
                          {remainingDeclaredTools > 0 ? (
                            <Badge variant="muted" className="text-[10px]">
                              +{remainingDeclaredTools}
                            </Badge>
                          ) : null}
                        </div>
                      </div>

                      {observedTools.length > 0 ? (
                        <div>
                          <p className="mb-1 text-[8px] uppercase tracking-[0.22em] text-slate-500">Observed tools</p>
                          <div className="flex flex-wrap gap-1">
                            {visibleObservedTools.length > 0 ? (
                              visibleObservedTools.map((tool) => (
                                <Badge key={tool} variant="default" className="max-w-full truncate text-[10px]">
                                  {tool}
                                </Badge>
                              ))
                            ) : (
                              <Badge variant="muted" className="text-[10px]">
                                None recorded
                              </Badge>
                            )}
                            {remainingObservedTools > 0 ? (
                              <Badge variant="muted" className="text-[10px]">
                                +{remainingObservedTools}
                              </Badge>
                            ) : null}
                          </div>
                        </div>
                      ) : null}

                      <div className="grid grid-cols-2 gap-1.5">
                        <AgentDrawerRow label="File" value={formatAgentFileAccessLabel(data.agent.policy.fileAccess)} />
                        <AgentDrawerRow label="Network" value={formatAgentNetworkAccessLabel(data.agent.policy.networkAccess)} />
                        <AgentDrawerRow label="Install" value={formatAgentInstallScopeLabel(data.agent.policy.installScope)} />
                        <AgentDrawerRow
                          label="Missing"
                          value={formatAgentMissingToolBehaviorLabel(data.agent.policy.missingToolBehavior)}
                        />
                      </div>

                      <AgentDrawerRow
                        label="Heartbeat"
                        value={data.agent.heartbeat.enabled ? (heartbeatLabel ? `On · ${heartbeatLabel}` : "On") : "Off"}
                      />
                    </div>
                  </ScrollArea>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function AgentStatTile({
  label,
  value,
  onClick,
  ariaLabel
}: {
  label: string;
  value: number | string;
  onClick?: () => void;
  ariaLabel?: string;
}) {
  const content = (
    <>
      <p className="text-[15px] font-semibold leading-none text-white">{value}</p>
      <p className="mt-1 text-[8px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        aria-label={ariaLabel ?? label}
        className="nodrag nopan w-full rounded-[16px] border border-white/[0.08] bg-white/[0.03] px-2.5 py-2 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:border-cyan-300/18 hover:bg-cyan-400/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40 focus-visible:ring-offset-0"
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {content}
      </button>
    );
  }

  return (
    <div className="w-full rounded-[16px] border border-white/[0.08] bg-white/[0.03] px-2.5 py-2 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      {content}
    </div>
  );
}

function AgentDrawerRow({
  label,
  value
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start justify-between gap-2 rounded-[12px] border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5">
      <span className="shrink-0 text-[8px] uppercase tracking-[0.18em] text-slate-500">{label}</span>
      <span className="min-w-0 text-right text-[9px] leading-4 text-slate-100">{value}</span>
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
