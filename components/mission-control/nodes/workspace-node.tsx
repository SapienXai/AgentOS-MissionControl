"use client";

import type { Node, NodeProps } from "@xyflow/react";
import { FolderKanban, Layers3, Orbit, Sparkles } from "lucide-react";
import { motion } from "motion/react";

import type { WorkspaceNodeData } from "@/components/mission-control/canvas-types";
import { Badge } from "@/components/ui/badge";
import { compactPath } from "@/lib/openclaw/presenters";
import { cn } from "@/lib/utils";

type WorkspaceFlowNode = Node<WorkspaceNodeData, "workspace">;

export function WorkspaceNode({ data, selected }: NodeProps<WorkspaceFlowNode>) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "workspace-node h-full rounded-[26px] border border-white/[0.04] bg-[linear-gradient(180deg,rgba(4,11,22,0.18),rgba(4,9,18,0.06))] p-3 text-white backdrop-blur-[2px]",
        data.emphasis ? "opacity-100" : "opacity-75",
        selected && "border-cyan-300/[0.16]"
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-slate-950/75 px-2.5 py-1.5 shadow-[0_14px_28px_rgba(0,0,0,0.2)]">
            <div className="rounded-full border border-white/10 bg-white/[0.06] p-1.5">
              <FolderKanban className="h-3 w-3 text-cyan-200" />
            </div>
            <div>
              <p className="font-display text-[12px] tracking-[0.04em] text-white">{data.workspace.name}</p>
              <p className="workspace-node__slug text-[9px] uppercase tracking-[0.22em] text-slate-500">
                {data.workspace.slug}
              </p>
            </div>
          </div>

          <p className="workspace-node__path max-w-[300px] truncate pl-1 text-[9px] uppercase tracking-[0.16em] text-slate-600">
            {compactPath(data.workspace.path)}
          </p>
        </div>

        <div className="flex shrink-0 max-w-[48%] flex-wrap items-center justify-end gap-1.5">
          <Badge
            variant="muted"
            data-health={data.workspace.health}
            className={cn("workspace-node__health", workspaceHealthBadgeClasses(data.workspace.health))}
          >
            {data.workspace.health}
          </Badge>

          <div className="flex flex-wrap justify-end gap-1.5">
            <Metric icon={Orbit} label="Agents" value={String(data.workspace.agentIds.length)} />
            <Metric icon={Layers3} label="Models" value={String(data.workspace.modelIds.length)} />
            <Metric icon={Sparkles} label="Runs" value={String(data.workspace.activeRuntimeIds.length)} />
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function Metric({
  icon: Icon,
  label,
  value
}: {
  icon: typeof FolderKanban;
  label: string;
  value: string;
}) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-slate-950/65 px-2.5 py-1 text-slate-300">
      <Icon className="h-3 w-3 text-slate-400" />
      <span className="workspace-node__metric-label text-[9px] uppercase tracking-[0.16em] text-slate-500">
        {label}
      </span>
      <span className="font-display text-[12px] text-white">{value}</span>
    </div>
  );
}

function workspaceHealthBadgeClasses(health: WorkspaceNodeData["workspace"]["health"]) {
  switch (health) {
    case "engaged":
      return "border-cyan-300/30 bg-cyan-300/14 text-cyan-50";
    case "monitoring":
      return "border-emerald-300/30 bg-emerald-300/14 text-emerald-50";
    case "ready":
      return "border-amber-300/30 bg-amber-300/14 text-amber-50";
    case "offline":
      return "border-rose-300/30 bg-rose-300/14 text-rose-50";
    default:
      return "border-white/12 bg-white/[0.07] text-slate-100";
  }
}
