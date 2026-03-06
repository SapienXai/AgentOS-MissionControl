"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { BrainCircuit } from "lucide-react";
import { motion } from "motion/react";

import type { AgentNodeData } from "@/components/mission-control/canvas-types";
import { StatusDot } from "@/components/mission-control/status-dot";
import { Badge } from "@/components/ui/badge";
import { formatModelLabel, toneForAgentStatus } from "@/lib/openclaw/presenters";
import { cn } from "@/lib/utils";

type AgentFlowNode = Node<AgentNodeData, "agent">;

export function AgentNode({ data, selected }: NodeProps<AgentFlowNode>) {
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

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        "w-[212px] rounded-[16px] border border-white/[0.1] bg-[linear-gradient(180deg,rgba(15,24,40,0.94),rgba(8,13,24,0.94))] px-3 py-2.5 shadow-[0_16px_28px_rgba(0,0,0,0.26)] backdrop-blur-xl",
        data.emphasis ? "opacity-100" : "opacity-72",
        selected && "border-cyan-300/[0.45] shadow-[0_18px_42px_rgba(34,211,238,0.16)]"
      )}
    >
      <Handle
        type="source"
        id="source-right"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !border-0 !bg-cyan-300/90 shadow-[0_0_14px_rgba(103,232,249,0.42)]"
      />

      <div className="flex items-start justify-between gap-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.22em] text-slate-500">
            <StatusDot tone={dotTone} pulse={data.agent.status === "engaged" || data.agent.status === "monitoring"} />
            Agent
          </div>
          <p className="mt-1.5 truncate font-display text-[0.96rem] text-white">{data.agent.name}</p>
          <p className="mt-0.5 truncate text-[10px] uppercase tracking-[0.16em] text-slate-500">
            {data.agent.identity.theme ?? "OpenClaw operator"}
          </p>
        </div>

        <div className="rounded-full border border-white/[0.08] bg-white/[0.05] p-1.5 text-slate-300">
          <BrainCircuit className="h-3 w-3" />
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

      <div className="mt-2.5 border-t border-white/[0.08] pt-2.5">
        <p className="text-[12px] leading-4 text-slate-100">{data.agent.currentAction}</p>
        <p className={cn("mt-1.5 text-[9px] uppercase tracking-[0.2em]", tone)}>{data.agent.id}</p>
      </div>
    </motion.div>
  );
}
