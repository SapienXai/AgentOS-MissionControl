"use client";

import * as simpleIcons from "simple-icons";

import { getSurfaceCatalogEntry } from "@/lib/openclaw/surface-catalog";
import type { MissionControlSurfaceProvider } from "@/lib/openclaw/types";
import { cn } from "@/lib/utils";

type SimpleIconData = {
  title: string;
  hex: string;
  path: string;
};

const simpleIconMap = simpleIcons as Record<string, SimpleIconData | undefined>;

export function SurfaceIcon({
  provider,
  className
}: {
  provider: MissionControlSurfaceProvider;
  className?: string;
}) {
  const catalogEntry = getSurfaceCatalogEntry(provider);
  const icon = catalogEntry.iconKey ? simpleIconMap[catalogEntry.iconKey] : undefined;

  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-full border border-white/12 bg-slate-950/72 text-white shadow-[0_8px_18px_rgba(0,0,0,0.28)] backdrop-blur-xl",
        className
      )}
      aria-hidden="true"
    >
      {icon ? (
        <svg
          viewBox="0 0 24 24"
          className="h-[58%] w-[58%] select-none"
          fill={catalogEntry.accentColor || `#${icon.hex}`}
        >
          <path d={icon.path} />
        </svg>
      ) : (
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/88">
          {catalogEntry.label.slice(0, 1)}
        </span>
      )}
    </div>
  );
}
