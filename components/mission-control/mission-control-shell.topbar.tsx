"use client";

import type { MutableRefObject } from "react";
import { useEffect, useRef, useState } from "react";

import {
  ArrowUpCircle,
  AlertTriangle,
  ChevronDown,
  LoaderCircle,
  MoonStar,
  RefreshCw,
  Settings2,
  Square,
  SunMedium
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { motion } from "motion/react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  AddModelsProviderId,
  MissionControlSnapshot,
  OpenClawModelOnboardingPhase,
  OpenClawOnboardingPhase,
  ResetTarget
} from "@/lib/agentos/contracts";
import { isOpenClawMissionReady } from "@/lib/openclaw/readiness";
import { cn } from "@/lib/utils";

type SurfaceTheme = "dark" | "light";
type UpdateRunState = "idle" | "running" | "success" | "error";
type GatewayControlAction = "start" | "stop" | "restart";
type OnboardingWizardStage = "system" | "models";

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
  snapshot,
  surfaceTheme,
  settingsRef,
  isSettingsOpen,
  gatewayDraft,
  workspaceRootDraft,
  isSavingGateway,
  isSavingWorkspaceRoot,
  isCheckingForUpdates,
  selectedModelId,
  modelOnboardingRunState,
  gatewayControlAction,
  lastCheckedAt,
  onToggleTheme,
  onToggleSettings,
  onGatewayDraftChange,
  onWorkspaceRootDraftChange,
  onSelectedModelIdChange,
  onSaveGatewaySettings,
  onSaveWorkspaceRootSettings,
  onCheckForUpdates,
  onControlGateway,
  onOpenSetupWizard,
  onRunModelRefresh,
  onRunModelSetDefault,
  onOpenAddModels,
  onOpenUpdateDialog,
  onOpenResetDialog
}: {
  snapshot: MissionControlSnapshot;
  surfaceTheme: SurfaceTheme;
  settingsRef: MutableRefObject<HTMLDivElement | null>;
  isSettingsOpen: boolean;
  gatewayDraft: string;
  workspaceRootDraft: string;
  isSavingGateway: boolean;
  isSavingWorkspaceRoot: boolean;
  isCheckingForUpdates: boolean;
  selectedModelId: string;
  modelOnboardingRunState: UpdateRunState;
  gatewayControlAction: GatewayControlAction | null;
  lastCheckedAt: number | null;
  onToggleTheme: () => void;
  onToggleSettings: () => void;
  onGatewayDraftChange: (value: string) => void;
  onWorkspaceRootDraftChange: (value: string) => void;
  onSelectedModelIdChange: (value: string) => void;
  onSaveGatewaySettings: (value: string | null) => Promise<void>;
  onSaveWorkspaceRootSettings: (value: string | null) => Promise<void>;
  onCheckForUpdates: () => Promise<void>;
  onControlGateway: (action: GatewayControlAction) => Promise<void>;
  onOpenSetupWizard: (stage?: OnboardingWizardStage) => void;
  onRunModelRefresh: () => Promise<void>;
  onRunModelSetDefault: (modelId?: string) => Promise<void>;
  onOpenAddModels: (provider?: AddModelsProviderId | null) => void;
  onOpenUpdateDialog: () => void;
  onOpenResetDialog: (target: ResetTarget) => void;
}) {
  const health = snapshot.diagnostics.health;
  const isOpenClawReady = isOpenClawMissionReady(snapshot);
  const isGatewayControlRunning = gatewayControlAction !== null;
  const isModelActionRunning = modelOnboardingRunState === "running";
  const isOffline = health === "offline";
  const healthLabel = formatHealthLabel(health);
  const settingsSecondaryButtonStyles = settingsButtonClassName(surfaceTheme, "secondary");
  const settingsPrimaryButtonStyles = settingsButtonClassName(surfaceTheme, "primary");
  const settingsWarningButtonStyles = settingsButtonClassName(surfaceTheme, "warning");
  const settingsWarningSolidButtonStyles = settingsButtonClassName(surfaceTheme, "warningSolid");
  const settingsChromeButtonStyles = settingsChromeButtonClassName(surfaceTheme);
  const settingsThemeSwitchTrackStyles = settingsThemeSwitchTrackClassName(surfaceTheme);
  const settingsThemeSwitchThumbStyles = settingsThemeSwitchThumbClassName(surfaceTheme);
  const [gatewayServiceMenuOpen, setGatewayServiceMenuOpen] = useState(false);
  const gatewayServiceMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!gatewayServiceMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as globalThis.Node;

      if (!gatewayServiceMenuRef.current?.contains(target)) {
        setGatewayServiceMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [gatewayServiceMenuOpen]);

  const gatewayServiceStatus = snapshot.diagnostics.rpcOk
    ? "Online"
    : snapshot.diagnostics.loaded
      ? "Service only"
      : "Offline";

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
              onClick={() => onOpenSetupWizard("system")}
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

        {isSettingsOpen ? (
          <div
            role="menu"
            aria-label="OpenClaw settings"
            className={cn(
              "absolute right-0 top-[calc(100%+12px)] z-[70] max-h-[min(82vh,calc(100svh-96px))] w-[300px] overflow-y-auto overscroll-contain rounded-[20px] border p-3 shadow-[0_22px_64px_rgba(0,0,0,0.24)] backdrop-blur-2xl",
              surfaceTheme === "light"
                ? "border-[#dbc9bc]/90 bg-[rgba(252,247,241,0.95)] text-[#4a382c] shadow-[0_24px_60px_rgba(161,125,101,0.18)]"
                : "border-cyan-300/12 bg-[rgba(10,16,28,0.9)] text-slate-100"
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p
                  className={cn(
                    "text-[8px] uppercase tracking-[0.24em]",
                    surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-500"
                  )}
                >
                  Settings
                </p>
                <h3
                  className={cn(
                    "mt-0.5 font-display text-[14px]",
                    surfaceTheme === "light" ? "text-[#3f2f24]" : "text-white"
                  )}
                >
                  OpenClaw surface
                </h3>
              </div>
              <span
                className={cn(
                  "rounded-full border px-1.5 py-0.5 text-[8px] uppercase tracking-[0.18em]",
                  surfaceTheme === "light"
                    ? "border-[#d6c0b0] bg-[#f3e7dc] text-[#8a7261]"
                    : "border-white/10 bg-white/[0.06] text-slate-400"
                )}
              >
                {snapshot.mode}
              </span>
            </div>

            {snapshot.diagnostics.updateAvailable && snapshot.diagnostics.latestVersion ? (
              <div
                className={cn(
                  "mt-2.5 rounded-[18px] border px-3 py-3",
                  surfaceTheme === "light"
                    ? "border-amber-300/90 bg-[linear-gradient(135deg,rgba(255,247,237,0.98),rgba(252,231,214,0.94))] shadow-[0_16px_36px_rgba(194,120,55,0.16)]"
                    : "border-amber-300/30 bg-[linear-gradient(135deg,rgba(71,35,8,0.62),rgba(33,20,8,0.82))] shadow-[0_18px_42px_rgba(245,158,11,0.14)]"
                )}
              >
                <div className="flex items-start justify-between gap-2.5">
                  <div>
                    <p
                      className={cn(
                        "text-[8px] uppercase tracking-[0.18em]",
                        surfaceTheme === "light" ? "text-amber-800/70" : "text-amber-200/80"
                      )}
                    >
                      Update available
                    </p>
                    <div className="mt-1.5 flex items-baseline gap-1.5">
                      <p
                        className={cn(
                          "font-display text-[0.98rem]",
                          surfaceTheme === "light" ? "text-amber-950" : "text-amber-50"
                        )}
                      >
                        v{snapshot.diagnostics.latestVersion}
                      </p>
                      <p
                        className={cn(
                          "text-[9px]",
                          surfaceTheme === "light" ? "text-amber-900/70" : "text-amber-100/70"
                        )}
                      >
                        from v{snapshot.diagnostics.version || "unknown"}
                      </p>
                    </div>
                  </div>
                  <ArrowUpCircle
                    className={cn(
                      "mt-0.5 h-4 w-4",
                      surfaceTheme === "light" ? "text-amber-700" : "text-amber-300"
                    )}
                  />
                </div>
                <p
                  className={cn(
                    "mt-1.5 text-[10px] leading-[1.05rem]",
                    surfaceTheme === "light" ? "text-amber-950/80" : "text-amber-50/85"
                  )}
                >
                  A newer OpenClaw release was detected. You can update directly from AgentOS.
                </p>
                <button
                  type="button"
                  onClick={onOpenUpdateDialog}
                  className={cn("mt-2.5 inline-flex items-center justify-center py-1", settingsWarningSolidButtonStyles)}
                >
                  Update now
                </button>
              </div>
            ) : null}

            <div
              className={cn(
                "mt-2.5 rounded-[16px] border px-2.5 py-2",
                surfaceTheme === "light"
                  ? "border-[#e6d7cb] bg-[#fffaf6]"
                  : "border-white/8 bg-white/[0.03]"
              )}
            >
              <p
                className={cn(
                  "text-[8px] uppercase tracking-[0.18em]",
                  surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-500"
                )}
              >
                OpenClaw version
              </p>
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <p
                  className={cn(
                    "font-display text-[0.88rem]",
                    surfaceTheme === "light" ? "text-[#3f2f24]" : "text-white"
                  )}
                >
                  {snapshot.diagnostics.version || "Unavailable"}
                </p>
                {snapshot.diagnostics.updateChannel ? (
                  <span
                    className={cn(
                      "rounded-full border px-1.5 py-0.5 text-[8px] uppercase tracking-[0.18em]",
                      surfaceTheme === "light"
                        ? "border-[#dcc6b6] bg-[#f4e8dd] text-[#876c5a]"
                        : "border-cyan-400/14 bg-cyan-400/8 text-cyan-100"
                    )}
                  >
                    {snapshot.diagnostics.updateChannel}
                  </span>
                ) : null}
              </div>
              <p
                className={cn(
                  "mt-1.5 text-[10px] leading-[1.05rem]",
                  surfaceTheme === "light" ? "text-[#816958]" : "text-slate-400"
                )}
              >
                {snapshot.diagnostics.updateInfo?.trim() ||
                  "No additional update message was returned in the latest OpenClaw status snapshot."}
              </p>
              <div className="mt-3">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void onCheckForUpdates();
                  }}
                  disabled={isCheckingForUpdates}
                  className={cn(
                    "w-full disabled:cursor-wait",
                    snapshot.diagnostics.updateAvailable
                      ? settingsWarningButtonStyles
                      : settingsSecondaryButtonStyles
                  )}
                >
                  {isCheckingForUpdates ? (
                    <>
                      <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      Checking...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                      Check for updates
                    </>
                  )}
                </Button>
                {lastCheckedAt ? (
                  <p
                    className={cn(
                      "mt-2 text-center text-[9px]",
                      surfaceTheme === "light" ? "text-[#8f7664]" : "text-slate-500"
                    )}
                  >
                    Last checked at{" "}
                    {new Date(lastCheckedAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit"
                    })}
                  </p>
                ) : null}
              </div>
            </div>

            <div
              className={cn(
                "mt-2 rounded-[16px] border px-2.5 py-2.5",
                surfaceTheme === "light"
                  ? "border-[#e6d7cb] bg-[#fffaf6]"
                  : "border-white/8 bg-white/[0.03]"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p
                    className={cn(
                      "text-[8px] uppercase tracking-[0.18em]",
                      surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-500"
                    )}
                  >
                    Setup center
                  </p>
                  <p
                    className={cn(
                      "mt-1 text-[10px] leading-[1.05rem]",
                      surfaceTheme === "light" ? "text-[#816958]" : "text-slate-400"
                    )}
                  >
                    Reopen the wizard or manage the gateway endpoint.
                  </p>
                </div>
                <span
                  className={cn(
                    "rounded-full border px-1.5 py-0.5 text-[8px] uppercase tracking-[0.18em]",
                    isOpenClawReady
                      ? surfaceTheme === "light"
                        ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                        : "border-emerald-300/25 bg-emerald-300/10 text-emerald-200"
                      : surfaceTheme === "light"
                        ? "border-amber-300 bg-amber-50 text-amber-700"
                        : "border-amber-300/25 bg-amber-300/10 text-amber-200"
                  )}
                >
                  {isOpenClawReady ? "Ready" : "Needs attention"}
                </span>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => onOpenSetupWizard(snapshot.diagnostics.rpcOk ? "models" : "system")}
                  className={settingsSecondaryButtonStyles}
                >
                  Open wizard
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={isModelActionRunning}
                  onClick={() => {
                    void onRunModelRefresh();
                  }}
                  className={settingsSecondaryButtonStyles}
                >
                  Refresh setup
                </Button>
              </div>

              <div
                className={cn(
                  "mt-2 rounded-[14px] border px-2.5 py-2.5",
                  surfaceTheme === "light"
                    ? "border-[#eadcd0] bg-white"
                    : "border-white/10 bg-white/[0.03]"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className={cn("text-[11px]", surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-400")}>
                      Model setup
                    </p>
                    <p
                      className={cn(
                        "mt-0.5 text-[10px] leading-[1.05rem]",
                        surfaceTheme === "light" ? "text-[#816958]" : "text-slate-500"
                      )}
                    >
                      Default model: {snapshot.diagnostics.modelReadiness.resolvedDefaultModel || snapshot.diagnostics.modelReadiness.defaultModel || "Not set"}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "rounded-full border px-1.5 py-0.5 text-[8px] uppercase tracking-[0.18em]",
                      snapshot.diagnostics.modelReadiness.ready
                        ? surfaceTheme === "light"
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                          : "border-emerald-300/25 bg-emerald-300/10 text-emerald-200"
                        : surfaceTheme === "light"
                          ? "border-amber-300 bg-amber-50 text-amber-700"
                          : "border-amber-300/25 bg-amber-300/10 text-amber-200"
                    )}
                  >
                    {snapshot.diagnostics.modelReadiness.availableModelCount}/{snapshot.diagnostics.modelReadiness.totalModelCount}
                  </span>
                </div>

                <select
                  value={selectedModelId}
                  onChange={(event) => onSelectedModelIdChange(event.target.value)}
                  disabled={isModelActionRunning}
                  className={cn(
                    "mt-2.5 h-9 w-full rounded-[14px] border px-2.5 text-[11px]",
                    surfaceTheme === "light"
                      ? "border-[#d9c9bc] bg-[#fffdfb] text-[#4f3d31]"
                      : "border-white/10 bg-white/[0.04] text-slate-100"
                  )}
                >
                  <option value="">Auto choose</option>
                  {snapshot.models
                    .filter((model) => model.available !== false && !model.missing)
                    .map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.name} · {model.provider}
                      </option>
                    ))}
                </select>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={isModelActionRunning}
                    onClick={() => {
                      void onRunModelSetDefault();
                    }}
                    className={settingsSecondaryButtonStyles}
                  >
                    {isModelActionRunning ? "Working..." : "Use selected"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={isModelActionRunning}
                    onClick={() => {
                      onOpenAddModels();
                    }}
                    className={settingsSecondaryButtonStyles}
                  >
                    Add models
                  </Button>
                </div>
              </div>
            </div>

            <div
              className={cn(
                "mt-2 rounded-[16px] border px-2.5 py-2.5",
                surfaceTheme === "light"
                  ? "border-[#e6d7cb] bg-[#fffaf6]"
                  : "border-white/8 bg-white/[0.03]"
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label
                    htmlFor="workspace-root"
                    className={cn("text-[11px]", surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-500")}
                  >
                    Workspace root
                  </Label>
                </div>
                <span
                  className={cn(
                    "rounded-full border px-1.5 py-0.5 text-[8px] uppercase tracking-[0.18em]",
                    surfaceTheme === "light"
                      ? "border-[#dcc6b6] bg-[#f4e8dd] text-[#876c5a]"
                      : "border-white/10 bg-white/[0.05] text-slate-300"
                  )}
                >
                  New only
                </span>
              </div>
              <Input
                id="workspace-root"
                value={workspaceRootDraft}
                onChange={(event) => onWorkspaceRootDraftChange(event.target.value)}
                placeholder="~/Documents/Shared/projects"
                disabled={isSavingWorkspaceRoot}
                style={surfaceTheme === "light" ? { colorScheme: "light" } : undefined}
                className={cn(
                  "mt-2.5 h-9 rounded-[14px] px-2.5 text-[11px]",
                  surfaceTheme === "light"
                    ? "border-[#d9c9bc] bg-[#fffdfb] text-[#4f3d31] caret-[#7c5a46] placeholder:text-[#b29b8b] shadow-[inset_0_0_0_1000px_#fffdfb] [-webkit-text-fill-color:#4f3d31] focus-visible:ring-[#c8946f]/45"
                    : "border-white/10 bg-white/[0.04] text-slate-100 placeholder:text-slate-500"
                )}
              />
              <div className="mt-2.5 flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={isSavingWorkspaceRoot}
                  onClick={() => {
                    void onSaveWorkspaceRootSettings(null);
                  }}
                  className={settingsSecondaryButtonStyles}
                >
                  Reset
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={isSavingWorkspaceRoot}
                  onClick={() => {
                    void onSaveWorkspaceRootSettings(workspaceRootDraft);
                  }}
                  className={settingsPrimaryButtonStyles}
                >
                  {isSavingWorkspaceRoot ? (
                    <>
                      <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save"
                  )}
                </Button>
              </div>
            </div>

            <div
              className={cn(
                "mt-2 rounded-[16px] border px-2.5 py-2.5",
                surfaceTheme === "light"
                  ? "border-[#e6d7cb] bg-[#fffaf6]"
                  : "border-white/8 bg-white/[0.03]"
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <p
                  className={cn(
                    "text-[11px] uppercase tracking-[0.18em]",
                    surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-400"
                  )}
                >
                  Gateway
                </p>
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "rounded-full border px-1.5 py-0.5 text-[8px] uppercase tracking-[0.18em]",
                      surfaceTheme === "light"
                        ? "border-[#dcc6b6] bg-[#f4e8dd] text-[#876c5a]"
                        : "border-white/10 bg-white/[0.05] text-slate-300"
                    )}
                  >
                    {snapshot.diagnostics.bindMode || "default"}
                  </span>
                  <div className="relative" ref={gatewayServiceMenuRef}>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={isGatewayControlRunning}
                      onClick={() => {
                        setGatewayServiceMenuOpen((current) => !current);
                      }}
                      className={cn(
                        "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[8px] uppercase tracking-[0.18em] transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.96]",
                        snapshot.diagnostics.rpcOk
                          ? surfaceTheme === "light"
                            ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:border-emerald-300 hover:text-emerald-700"
                            : "border-emerald-300/25 bg-emerald-300/10 text-emerald-200 hover:bg-emerald-300/16 hover:border-emerald-300/35"
                          : snapshot.diagnostics.loaded
                            ? surfaceTheme === "light"
                              ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:border-amber-300 hover:text-amber-800"
                              : "border-amber-300/25 bg-amber-300/10 text-amber-200 hover:bg-amber-300/16 hover:border-amber-300/35"
                            : surfaceTheme === "light"
                              ? "border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 hover:border-rose-300 hover:text-rose-700"
                              : "border-rose-300/25 bg-rose-300/10 text-rose-200 hover:bg-rose-300/16 hover:border-rose-300/35"
                      )}
                      aria-haspopup="menu"
                      aria-expanded={gatewayServiceMenuOpen}
                      aria-label={`Gateway service status: ${gatewayServiceStatus}. Open actions menu.`}
                      title="Gateway actions"
                    >
                      <span>{gatewayServiceStatus}</span>
                      <ChevronDown className="h-3 w-3 opacity-80" />
                    </Button>

                    {gatewayServiceMenuOpen ? (
                      <div
                        className={cn(
                          "absolute right-0 top-[calc(100%+8px)] z-30 min-w-[152px] rounded-[14px] border p-1.5 shadow-[0_20px_44px_rgba(0,0,0,0.42)] backdrop-blur-xl",
                          surfaceTheme === "light"
                            ? "border-[#d9c9bc] bg-[#fdfaf7]/98"
                            : "border-white/[0.1] bg-slate-950/96"
                        )}
                      >
                        <GatewayServiceMenuButton
                          icon={ArrowUpCircle}
                          label={gatewayControlAction === "start" ? "Starting..." : "Start"}
                          disabled={isGatewayControlRunning || snapshot.diagnostics.rpcOk}
                          onClick={() => {
                            setGatewayServiceMenuOpen(false);
                            void onControlGateway("start");
                          }}
                          surfaceTheme={surfaceTheme}
                        />
                        <GatewayServiceMenuButton
                          icon={RefreshCw}
                          label={gatewayControlAction === "restart" ? "Restarting..." : "Restart"}
                          disabled={isGatewayControlRunning || !snapshot.diagnostics.loaded}
                          onClick={() => {
                            setGatewayServiceMenuOpen(false);
                            void onControlGateway("restart");
                          }}
                          surfaceTheme={surfaceTheme}
                        />
                        <GatewayServiceMenuButton
                          icon={Square}
                          label={gatewayControlAction === "stop" ? "Stopping..." : "Stop"}
                          disabled={isGatewayControlRunning || !snapshot.diagnostics.loaded}
                          onClick={() => {
                            setGatewayServiceMenuOpen(false);
                            void onControlGateway("stop");
                          }}
                          surfaceTheme={surfaceTheme}
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="mt-2 grid gap-2">
                <div className="min-w-0">
                  <Label htmlFor="gateway-url" className="sr-only">
                    Gateway endpoint
                  </Label>
                  <Input
                    id="gateway-url"
                    value={gatewayDraft}
                    onChange={(event) => onGatewayDraftChange(event.target.value)}
                    placeholder="ws://127.0.0.1:18789"
                    disabled={isSavingGateway}
                    style={surfaceTheme === "light" ? { colorScheme: "light" } : undefined}
                    className={cn(
                      "h-8 min-w-0 rounded-[12px] px-2.5 font-mono text-[12px]",
                      surfaceTheme === "light"
                        ? "border-[#d9c9bc] bg-[#fffdfb] text-[#4f3d31] caret-[#7c5a46] placeholder:text-[#b29b8b] shadow-[inset_0_0_0_1000px_#fffdfb] [-webkit-text-fill-color:#4f3d31] focus-visible:ring-[#c8946f]/45"
                        : "border-white/10 bg-white/[0.04] text-slate-100 placeholder:text-slate-500"
                    )}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={isSavingGateway}
                    onClick={() => {
                      void onSaveGatewaySettings(null);
                    }}
                    className={settingsSecondaryButtonStyles}
                  >
                    Local
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={isSavingGateway}
                    onClick={() => {
                      void onSaveGatewaySettings(gatewayDraft);
                    }}
                    className={settingsPrimaryButtonStyles}
                  >
                    {isSavingGateway ? (
                      <>
                        <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      "Save"
                    )}
                  </Button>
                </div>
              </div>
            </div>

            <div
              className={cn(
                "mt-2 rounded-[16px] border px-2.5 py-2.5",
                surfaceTheme === "light"
                  ? "border-rose-200 bg-[linear-gradient(135deg,rgba(255,245,245,0.96),rgba(255,236,236,0.92))]"
                  : "border-rose-400/18 bg-[linear-gradient(135deg,rgba(62,16,24,0.46),rgba(24,10,15,0.82))]"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p
                    className={cn(
                      "text-[8px] uppercase tracking-[0.18em]",
                      surfaceTheme === "light" ? "text-rose-700/80" : "text-rose-200/75"
                    )}
                  >
                    Danger zone
                  </p>
                  <p
                    className={cn(
                      "mt-1 text-[10px] leading-[1.05rem]",
                      surfaceTheme === "light" ? "text-rose-900/80" : "text-rose-100/80"
                    )}
                  >
                    Review exactly which workspaces, agents, integration files, and packages would be removed before taking irreversible actions.
                  </p>
                </div>
                <AlertTriangle
                  className={cn(
                    "mt-0.5 h-4 w-4",
                    surfaceTheme === "light" ? "text-rose-700" : "text-rose-200"
                  )}
                />
              </div>

              <div className="mt-3 grid gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => onOpenResetDialog("mission-control")}
                  className={cn(
                    "justify-start",
                    surfaceTheme === "light"
                      ? "border-rose-200 bg-white text-rose-900 hover:bg-rose-50 hover:text-rose-900"
                      : "border-rose-400/20 bg-white/[0.04] text-rose-100 hover:bg-rose-500/10"
                  )}
                >
                  Reset AgentOS
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => onOpenResetDialog("full-uninstall")}
                  className={cn(
                    "justify-start",
                    surfaceTheme === "light"
                      ? "border-rose-300 bg-rose-600 text-white hover:bg-rose-700"
                      : "border-rose-400/24 bg-rose-500/90 text-white hover:bg-rose-500"
                  )}
                >
                  Full Uninstall
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function GatewayServiceMenuButton({
  icon: Icon,
  label,
  disabled = false,
  onClick,
  surfaceTheme
}: {
  icon: LucideIcon;
  label: string;
  disabled?: boolean;
  onClick: () => void;
  surfaceTheme: SurfaceTheme;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-left text-[11px] transition-colors",
        disabled
          ? surfaceTheme === "light"
            ? "cursor-not-allowed text-[#8f7866]/60"
            : "cursor-not-allowed text-slate-400/60"
          : surfaceTheme === "light"
            ? "text-[#4f3d31] hover:bg-[#efe5dc] hover:text-[#34261d]"
            : "text-slate-200 hover:bg-white/[0.06] hover:text-white"
      )}
      onClick={onClick}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span>{label}</span>
    </button>
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

function settingsButtonClassName(surfaceTheme: SurfaceTheme, tone: "secondary" | "primary" | "warning" | "warningSolid") {
  const base =
    "h-8 rounded-[12px] border px-2.5 text-[9px] uppercase tracking-[0.18em] transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:scale-[0.985]";

  if (tone === "primary") {
    return cn(
      base,
      surfaceTheme === "light"
        ? "border-[#c8946f] bg-[#c8946f] text-white shadow-[0_12px_28px_rgba(200,148,111,0.24)] hover:bg-[#b88461] hover:border-[#b88461] hover:text-white active:bg-[#a97553] active:border-[#a97553]"
        : "border-cyan-300/30 bg-cyan-300 text-slate-950 shadow-[0_12px_28px_rgba(34,211,238,0.2)] hover:bg-cyan-200 hover:border-cyan-200 hover:text-slate-950 active:bg-cyan-100 active:border-cyan-100"
    );
  }

  if (tone === "warning") {
    return cn(
      base,
      surfaceTheme === "light"
        ? "border-amber-400/90 bg-amber-100 text-amber-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] hover:bg-amber-200 hover:border-amber-400 hover:text-amber-900 active:bg-amber-300"
        : "border-amber-300/35 bg-amber-300/16 text-amber-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] hover:bg-amber-300/24 hover:border-amber-300/45 hover:text-amber-50 active:bg-amber-300/30"
    );
  }

  if (tone === "warningSolid") {
    return cn(
      base,
      surfaceTheme === "light"
        ? "border-amber-900 bg-amber-900 text-amber-50 shadow-[0_12px_28px_rgba(146,64,14,0.18)] hover:bg-amber-800 hover:border-amber-800 hover:text-amber-50 active:bg-amber-700 active:border-amber-700"
        : "border-amber-300 bg-amber-300 text-slate-950 shadow-[0_12px_28px_rgba(245,158,11,0.18)] hover:bg-amber-200 hover:border-amber-200 hover:text-slate-950 active:bg-amber-100 active:border-amber-100"
    );
  }

  return cn(
    base,
    surfaceTheme === "light"
      ? "border-[#d3bba9] bg-[#f1e3d7] text-[#6f5949] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] hover:bg-[#ead8ca] hover:border-[#caa98f] hover:text-[#5f4a3d] active:bg-[#dfc9b7] active:border-[#bf9c82]"
      : "border-white/12 bg-white/[0.05] text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:bg-white/[0.1] hover:border-white/16 hover:text-slate-100 active:bg-white/[0.14] active:border-white/20"
  );
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
