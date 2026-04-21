"use client";

import type { MutableRefObject } from "react";

import { ArrowUpCircle, MoonStar, Settings2, SunMedium } from "lucide-react";
import { motion } from "motion/react";

import {
  MissionControlShellSettingsPanel,
  type MissionControlShellSettingsPanelProps
} from "@/components/mission-control/mission-control-shell.settings";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import { cn } from "@/lib/utils";

type SurfaceTheme = "dark" | "light";

type CanvasTopBarProps = MissionControlShellSettingsPanelProps & {
  settingsRef: MutableRefObject<HTMLDivElement | null>;
  isSettingsOpen: boolean;
  onToggleTheme: () => void;
  onToggleSettings: () => void;
};

export function CanvasTitlePill({ surfaceTheme }: { surfaceTheme: SurfaceTheme }) {
  return (
    <div
      className={cn(
        "flex h-11 items-center gap-3 rounded-full border px-4 shadow-[0_18px_50px_rgba(0,0,0,0.24)] backdrop-blur-xl",
        surfaceTheme === "light"
          ? "border-[#d9c9bc]/90 bg-[#f8f5f0]/86 shadow-[0_18px_42px_rgba(161,125,101,0.14)]"
          : "border-cyan-300/10 bg-slate-950/45"
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center overflow-hidden rounded-[8px] border",
            surfaceTheme === "light"
              ? "border-[#d1bcad] bg-[#f5ece4]"
              : "border-white/[0.08] bg-white/[0.03]"
          )}
        >
          <video
            aria-hidden="true"
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
            className="h-full w-full scale-[1.15] object-cover"
          >
            <source src="/assets/logo.webm" type="video/webm" />
          </video>
        </span>
        <p
          className={cn(
            "text-[10px] tracking-[0.18em]",
            surfaceTheme === "light" ? "text-[#8a7261]" : "text-slate-500"
          )}
        >
          AgentOS
        </p>
      </div>
      <span
        aria-hidden="true"
        className={cn("h-4 w-px", surfaceTheme === "light" ? "bg-[#cdb7a8]/80" : "bg-white/[0.08]")}
      />
      <h2
        className={cn(
          "font-display text-[0.88rem]",
          surfaceTheme === "light" ? "text-[#816958]/80" : "text-slate-400/75"
        )}
      >
        Control Plane
      </h2>
    </div>
  );
}

export function CanvasTopBar({
  settingsRef,
  isSettingsOpen,
  onToggleTheme,
  onToggleSettings,
  ...settingsPanelProps
}: CanvasTopBarProps) {
  const { snapshot, surfaceTheme } = settingsPanelProps;
  const { onOpenSetupWizard } = settingsPanelProps;
  const health = snapshot.diagnostics.health;
  const isOffline = health === "offline";
  const healthLabel = formatHealthLabel(health);
  const settingsChromeButtonStyles = settingsChromeButtonClassName(surfaceTheme);
  const settingsThemeSwitchTrackStyles = settingsThemeSwitchTrackClassName(surfaceTheme);
  const settingsThemeSwitchThumbStyles = settingsThemeSwitchThumbClassName(surfaceTheme);

  return (
    <div className="flex w-full items-center px-0 pt-6">
      <div ref={settingsRef} className="pointer-events-auto relative ml-auto">
        <div
          className={cn(
            "flex h-11 items-center gap-3 rounded-full border px-4 shadow-[0_18px_50px_rgba(0,0,0,0.24)] backdrop-blur-xl",
            surfaceTheme === "light"
              ? "border-[#d9c9bc]/90 bg-[#f8f5f0]/86 shadow-[0_18px_42px_rgba(161,125,101,0.14)]"
              : "border-cyan-300/10 bg-slate-950/45"
          )}
        >
          <div className="flex items-baseline gap-[3px]">
            <span
              className={cn(
                "text-[10px] uppercase tracking-[0.3em]",
                surfaceTheme === "light" ? "text-[#8a7261]" : "text-slate-500"
              )}
            >
              OPENCLAW
            </span>
            <span
              className={cn(
                "font-mono text-[8px] tracking-[0.04em]",
                surfaceTheme === "light" ? "text-[#6f5a4b]/85" : "text-slate-300/80"
              )}
            >
              v{snapshot.diagnostics.version || "unknown"}
            </span>
          </div>
          {isOffline ? (
            <motion.button
              type="button"
              onClick={() => onOpenSetupWizard()}
              title="System is offline. Open the setup wizard."
              aria-label="System is offline. Open the setup wizard."
              whileHover={{ scale: 1.03, y: -1 }}
              whileTap={{ scale: 0.98 }}
              transition={{ type: "spring", stiffness: 420, damping: 28 }}
              className={cn(
                "group relative inline-flex cursor-pointer select-none items-center gap-2 overflow-hidden rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.22em] transition-[background-color,border-color,color,box-shadow,transform] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
                statusBadgeClassName(health, surfaceTheme),
                surfaceTheme === "light"
                  ? "shadow-[0_10px_24px_rgba(244,63,94,0.12)] hover:border-rose-300 hover:bg-rose-100 hover:text-rose-800"
                  : "shadow-[0_10px_24px_rgba(244,63,94,0.18)] hover:border-rose-300/40 hover:bg-rose-300/15 hover:text-rose-100"
              )}
            >
              <motion.span
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute inset-0 rounded-full",
                  surfaceTheme === "light"
                    ? "bg-[radial-gradient(circle_at_top,rgba(244,63,94,0.18),rgba(244,63,94,0))]"
                    : "bg-[radial-gradient(circle_at_top,rgba(251,113,133,0.18),rgba(251,113,133,0))]"
                )}
                animate={{ opacity: [0.35, 0.65, 0.35], scale: [0.98, 1.02, 0.98] }}
                transition={{ duration: 2.8, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
              />
              <span
                aria-hidden="true"
                className={cn(
                  "relative z-10 h-2 w-2 rounded-full shadow-[0_0_12px_currentColor]",
                  statusDotClassName(health)
                )}
              />
              <span className="relative z-10 inline-flex items-center gap-1.5">
                <span>{healthLabel}</span>
                <span
                  className={cn(
                    "rounded-full border px-1.5 py-0.5 text-[7px] uppercase tracking-[0.18em]",
                    surfaceTheme === "light"
                      ? "border-rose-300/40 bg-rose-100/70 text-rose-800"
                      : "border-rose-300/25 bg-rose-300/10 text-rose-100/90"
                  )}
                >
                  Setup
                </span>
                <ArrowUpCircle className="h-3 w-3 opacity-80 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </span>
            </motion.button>
          ) : (
            <span
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.22em]",
                statusBadgeClassName(health, surfaceTheme)
              )}
            >
              <span
                aria-hidden="true"
                className={cn("h-2 w-2 rounded-full shadow-[0_0_12px_currentColor]", statusDotClassName(health))}
              />
              {healthLabel}
            </span>
          )}
          <button
            type="button"
            role="switch"
            aria-label={surfaceTheme === "light" ? "Switch to dark theme" : "Switch to light theme"}
            aria-checked={surfaceTheme === "light"}
            onClick={onToggleTheme}
            className={settingsThemeSwitchTrackStyles}
          >
            <span className={settingsThemeSwitchThumbStyles}>
              {surfaceTheme === "light" ? <SunMedium className="h-3 w-3" /> : <MoonStar className="h-3 w-3" />}
            </span>
          </button>
          <button
            type="button"
            aria-label="Open settings"
            aria-expanded={isSettingsOpen}
            aria-haspopup="menu"
            onClick={onToggleSettings}
            className={settingsChromeButtonStyles}
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
        </div>

        {isSettingsOpen ? <MissionControlShellSettingsPanel {...settingsPanelProps} /> : null}
      </div>
    </div>
  );
}

function formatHealthLabel(health: MissionControlSnapshot["diagnostics"]["health"]) {
  switch (health) {
    case "healthy":
      return "Online";
    case "degraded":
      return "Degraded";
    default:
      return "Offline";
  }
}

function statusBadgeClassName(
  health: MissionControlSnapshot["diagnostics"]["health"],
  surfaceTheme: SurfaceTheme
) {
  switch (health) {
    case "healthy":
      return surfaceTheme === "light"
        ? "border-emerald-300/80 bg-emerald-50 text-emerald-700"
        : "border-emerald-400/25 bg-emerald-400/10 text-emerald-200";
    case "degraded":
      return surfaceTheme === "light"
        ? "border-amber-300/90 bg-amber-50 text-amber-700"
        : "border-amber-300/25 bg-amber-300/10 text-amber-200";
    default:
      return surfaceTheme === "light"
        ? "border-rose-300/80 bg-rose-50 text-rose-700"
        : "border-rose-300/25 bg-rose-300/10 text-rose-200";
  }
}

function statusDotClassName(health: MissionControlSnapshot["diagnostics"]["health"]) {
  switch (health) {
    case "healthy":
      return "bg-emerald-400";
    case "degraded":
      return "bg-amber-300";
    default:
      return "bg-rose-300";
  }
}

function settingsChromeButtonClassName(surfaceTheme: SurfaceTheme) {
  return cn(
    "inline-flex h-8 w-8 items-center justify-center rounded-full border transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.96]",
    surfaceTheme === "light"
      ? "border-[#d0bcae] bg-[#efe5dc] text-[#7f6554] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] hover:bg-[#e7d9ce] hover:border-[#c8b09f] hover:text-[#5f4a3d] active:bg-[#ddcdbf]"
      : "border-white/12 bg-white/[0.08] text-slate-200 hover:bg-white/[0.12] hover:border-white/16 hover:text-slate-100 active:bg-white/[0.16]"
  );
}

function settingsThemeSwitchTrackClassName(surfaceTheme: SurfaceTheme) {
  return cn(
    "relative inline-flex h-7 w-14 items-center rounded-full border transition-[background-color,border-color,transform] duration-150 active:scale-[0.98]",
    surfaceTheme === "light"
      ? "border-[#d0bcae] bg-[#eaded3] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] hover:bg-[#e3d5c8] hover:border-[#c8b09f] active:bg-[#d9c8ba]"
      : "border-white/12 bg-white/[0.08] hover:bg-white/[0.12] hover:border-white/16 active:bg-white/[0.16]"
  );
}

function settingsThemeSwitchThumbClassName(surfaceTheme: SurfaceTheme) {
  return cn(
    "absolute left-1 inline-flex h-5 w-5 items-center justify-center rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.18)] transition-[transform,background-color,color] duration-150",
    surfaceTheme === "light"
      ? "translate-x-7 bg-[#c8946f] text-white"
      : "translate-x-0 bg-cyan-300 text-slate-950"
  );
}
