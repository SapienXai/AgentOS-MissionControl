"use client";

import { Handle, Position, type Node as FlowNode, type NodeProps } from "@xyflow/react";
import * as simpleIcons from "simple-icons";
import { motion } from "motion/react";

import type { TelegramTetherNodeData } from "@/components/mission-control/canvas-types";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type TelegramTetherFlowNode = FlowNode<TelegramTetherNodeData, "telegram-module">;
type SimpleIconData = {
  title: string;
  hex: string;
  path: string;
};

const simpleIconMap = simpleIcons as Record<string, SimpleIconData | undefined>;
const telegramIcon = requireSimpleIcon("siTelegram", "Telegram");

export function TelegramTetherNode({ data, selected }: NodeProps<TelegramTetherFlowNode>) {
  const activeChannel = data.channelCount > 0 || data.agent.isDefault;
  const roleLines =
    data.telegramRoleLines.length > 0
      ? data.telegramRoleLines
      : data.agent.isDefault
        ? ["Default Telegram anchor"]
        : ["Telegram connection"];
  const channelSummary = formatChannelSummary(data.channelNames);
  const roleDotClass = resolveRoleDotClass(data.telegramRoleTone);
  const tooltipLabel = roleLines.join(" · ");

  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>
          <motion.div
            initial={false}
            animate={{
              scale: [1, 1.03, 1],
              y: [0, -1.5, 0],
              rotate: [0, 0.6, 0]
            }}
            transition={{
              duration: 5.6,
              repeat: Number.POSITIVE_INFINITY,
              ease: "easeInOut"
            }}
            className={cn("relative h-[64px] w-[64px] overflow-visible opacity-100", selected && "opacity-100")}
            aria-label={tooltipLabel}
          >
            <motion.div
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute inset-[-10px] rounded-[20px] blur-lg",
                activeChannel ? "bg-white/16" : "bg-white/10"
              )}
              animate={{
                scale: activeChannel ? [0.98, 1.1, 0.98] : [0.98, 1.05, 0.98]
              }}
              transition={{
                duration: activeChannel ? 3.8 : 4.8,
                repeat: Number.POSITIVE_INFINITY,
                ease: "easeInOut"
              }}
            />
            <motion.div
              aria-hidden="true"
              className="pointer-events-none absolute inset-[-4px] rounded-[20px] border border-white/18"
              animate={{
                rotate: [0, 12, 0],
                scale: [1, 1.015, 1]
              }}
              transition={{ duration: 6.2, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
            />

            <Handle
              type="target"
              id="target-telegram"
              position={Position.Right}
              style={{ right: -4, top: 32 }}
              className="!h-2.5 !w-2.5 !border-0 !bg-white/78 shadow-[0_0_14px_rgba(255,255,255,0.34)]"
            />

            <motion.div
              className={cn(
                "relative z-10 flex h-full w-full items-center justify-center rounded-[18px] border backdrop-blur-xl",
                activeChannel
                  ? "border-white/18 bg-[linear-gradient(180deg,rgba(10,27,48,1),rgba(4,10,20,0.98))] shadow-[0_18px_30px_rgba(0,0,0,0.26),0_0_32px_rgba(255,255,255,0.08)]"
                  : "border-white/14 bg-[linear-gradient(180deg,rgba(9,22,40,0.99),rgba(4,8,16,0.97))] shadow-[0_18px_28px_rgba(0,0,0,0.22),0_0_22px_rgba(255,255,255,0.06)]"
              )}
              animate={{ y: [0, -1.25, 0], rotate: [0, -0.45, 0] }}
              transition={{ duration: 4.2, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
            >
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-[5px] rounded-[14px] bg-[radial-gradient(circle_at_35%_28%,rgba(255,255,255,0.12),rgba(255,255,255,0.02)_42%,rgba(255,255,255,0)_74%)]"
              />

              <svg
                viewBox="0 0 24 24"
                className={cn(
                  "relative z-10 h-10 w-10 select-none drop-shadow-[0_2px_3px_rgba(0,0,0,0.72)] drop-shadow-[0_0_10px_rgba(38,165,228,0.26)]",
                  "opacity-100"
                )}
                fill={`#${telegramIcon.hex}`}
                aria-hidden="true"
              >
                <path d={telegramIcon.path} />
              </svg>

              {activeChannel ? (
                <div className="pointer-events-none absolute" style={{ right: 5, top: 5 }}>
                  <motion.div
                    aria-hidden="true"
                    className="absolute -inset-1.5 rounded-full border border-white/45 shadow-[0_0_10px_rgba(255,255,255,0.2)]"
                    animate={{
                      scale: [0.88, 1.22, 0.88],
                      opacity: [0, 0.95, 0]
                    }}
                    transition={{
                      duration: 1.9,
                      repeat: Number.POSITIVE_INFINITY,
                      ease: "easeInOut"
                    }}
                  />
                  <motion.div
                    aria-hidden="true"
                    className={cn("h-2 w-2 rounded-full shadow-[0_0_10px_rgba(255,255,255,0.42)]", roleDotClass)}
                    animate={{
                      scale: [1, 1.12, 1],
                      opacity: [0.9, 1, 0.9]
                    }}
                    transition={{
                      duration: 1.9,
                      repeat: Number.POSITIVE_INFINITY,
                      ease: "easeInOut"
                    }}
                  />
                </div>
              ) : null}
            </motion.div>
          </motion.div>
        </TooltipTrigger>
        <TooltipContent side="right" align="center" sideOffset={12} className="max-w-[260px]">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className={cn("h-2.5 w-2.5 rounded-full", roleDotClass)} aria-hidden="true" />
              <p className="text-[11px] uppercase tracking-[0.22em] text-white/75">Telegram</p>
            </div>
            <div className="space-y-1">
              {roleLines.map((line) => (
                <p key={line} className="text-[12px] leading-5 text-white">
                  {line}
                </p>
              ))}
            </div>
            {channelSummary ? (
              <p className="text-[11px] leading-4 text-slate-400">Related channels: {channelSummary}</p>
            ) : null}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function requireSimpleIcon(key: string, title: string): SimpleIconData {
  const icon = simpleIconMap[key];

  if (!icon) {
    return {
      title,
      hex: "ffffff",
      path: "M0 0h24v24H0z"
    };
  }

  return icon;
}

function resolveRoleDotClass(roleTone: TelegramTetherNodeData["telegramRoleTone"]) {
  switch (roleTone) {
    case "owner":
      return "bg-emerald-100 shadow-[0_0_12px_rgba(52,211,153,0.9)]";
    case "delegate":
      return "bg-amber-100 shadow-[0_0_12px_rgba(251,191,36,0.9)]";
    case "mixed":
      return "bg-violet-100 shadow-[0_0_12px_rgba(196,181,253,0.9)]";
    case "primary":
    default:
      return "bg-cyan-100 shadow-[0_0_12px_rgba(103,232,249,0.9)]";
  }
}

function formatChannelSummary(channelNames: string[]) {
  if (channelNames.length === 0) {
    return "";
  }

  if (channelNames.length <= 3) {
    return channelNames.join(", ");
  }

  const visibleNames = channelNames.slice(0, 3).join(", ");
  return `${visibleNames} +${channelNames.length - 3} more`;
}
