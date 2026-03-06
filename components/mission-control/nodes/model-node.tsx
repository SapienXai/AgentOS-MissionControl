"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Bot, DatabaseZap } from "lucide-react";
import { motion } from "motion/react";

import type { ModelNodeData } from "@/components/mission-control/canvas-types";
import { Badge } from "@/components/ui/badge";
import { formatContextWindow, formatProvider } from "@/lib/openclaw/presenters";
import { cn } from "@/lib/utils";

type ModelFlowNode = Node<ModelNodeData, "model">;

export function ModelNode({ data, selected }: NodeProps<ModelFlowNode>) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        "w-[168px] rounded-[16px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(14,22,38,0.92),rgba(8,13,24,0.92))] px-3 py-2.5 shadow-[0_14px_24px_rgba(0,0,0,0.22)] backdrop-blur-xl",
        data.emphasis ? "opacity-100" : "opacity-68",
        selected && "border-cyan-300/[0.42]"
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !border-0 !bg-white/35"
      />

      <div className="flex items-start justify-between gap-2.5">
        <div className="min-w-0">
          <div className="text-[9px] uppercase tracking-[0.2em] text-slate-500">{formatProvider(data.model.id)}</div>
          <p className="mt-1.5 truncate font-display text-[0.9rem] text-white">{data.model.name}</p>
        </div>

        <div className="rounded-full border border-white/[0.08] bg-white/[0.05] p-1.5 text-slate-300">
          {data.model.local ? <DatabaseZap className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <Badge variant={data.model.local ? "success" : "muted"}>{data.model.local ? "local" : "remote"}</Badge>
        <Badge variant={data.model.missing ? "danger" : "muted"}>{data.model.missing ? "missing" : "ready"}</Badge>
      </div>

      <div className="mt-2.5 border-t border-white/[0.08] pt-2.5 text-[9px] uppercase tracking-[0.16em] text-slate-500">
        {data.model.input} · {formatContextWindow(data.model.contextWindow)} ctx
      </div>
    </motion.div>
  );
}
