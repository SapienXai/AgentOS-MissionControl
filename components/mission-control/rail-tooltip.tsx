"use client";

import type { ReactNode } from "react";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type SurfaceTheme = "dark" | "light";

type RailTooltipProps = {
  label: string;
  side: "left" | "right";
  surfaceTheme: SurfaceTheme;
  panelCollapsed: boolean;
  children: ReactNode;
};

export function RailTooltip({ label, side, surfaceTheme, panelCollapsed, children }: RailTooltipProps) {
  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent
          side={side}
          align="center"
          sideOffset={10}
          className={cn(
            "rounded-[10px] px-2.5 py-1.5 text-[10px] font-medium leading-none tracking-[0.12em] whitespace-nowrap shadow-[0_16px_40px_rgba(0,0,0,0.32)]",
            surfaceTheme === "light"
              ? panelCollapsed
                ? "border border-slate-200/80 bg-white/96 text-slate-900 shadow-[0_16px_40px_rgba(15,23,42,0.18)]"
                : "border border-white/10 bg-slate-950/94 text-white shadow-[0_16px_40px_rgba(0,0,0,0.36)]"
              : "border border-white/10 bg-slate-950/92 text-slate-100"
          )}
        >
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
