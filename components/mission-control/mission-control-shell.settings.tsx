"use client";

import type { LucideIcon } from "lucide-react";
import {
  ArrowUpCircle,
  AlertTriangle,
  ChevronDown,
  LoaderCircle,
  RefreshCw,
  Square,
  TerminalSquare
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { OpenClawInstallSummary } from "@/components/mission-control/mission-control-shell.utils";
import type {
  AddModelsProviderId,
  MissionControlSnapshot,
  OpenClawBinarySelection,
  ResetTarget
} from "@/lib/agentos/contracts";
import { isOpenClawOnboardingModelReady } from "@/lib/openclaw/readiness";
import { cn } from "@/lib/utils";

type SurfaceTheme = "dark" | "light";
type UpdateRunState = "idle" | "running" | "success" | "error";
type GatewayControlAction = "start" | "stop" | "restart";
type OnboardingWizardStage = "system" | "models";

export type MissionControlShellSettingsPanelProps = {
  snapshot: MissionControlSnapshot;
  surfaceTheme: SurfaceTheme;
  gatewayDraft: string;
  workspaceRootDraft: string;
  isSavingGateway: boolean;
  isSavingWorkspaceRoot: boolean;
  isCheckingForUpdates: boolean;
  updateRunState: UpdateRunState;
  selectedModelId: string;
  modelOnboardingRunState: UpdateRunState;
  gatewayControlAction: GatewayControlAction | null;
  lastCheckedAt: number | null;
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
  openClawBinarySelection: OpenClawBinarySelection;
  isSavingOpenClawBinary: boolean;
  onOpenClawBinarySelectionModeChange: (value: OpenClawBinarySelection["mode"]) => void;
  onOpenClawBinarySelectionPathChange: (value: string) => void;
  onSaveOpenClawBinarySettings: (value: OpenClawBinarySelection) => Promise<void>;
  installSummary: OpenClawInstallSummary;
};

export function MissionControlShellSettingsPanel({
  snapshot,
  surfaceTheme,
  gatewayDraft,
  workspaceRootDraft,
  isSavingGateway,
  isSavingWorkspaceRoot,
  isCheckingForUpdates,
  updateRunState,
  selectedModelId,
  modelOnboardingRunState,
  gatewayControlAction,
  lastCheckedAt,
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
  onOpenResetDialog,
  openClawBinarySelection,
  isSavingOpenClawBinary,
  onOpenClawBinarySelectionModeChange,
  onOpenClawBinarySelectionPathChange,
  onSaveOpenClawBinarySettings,
  installSummary
}: MissionControlShellSettingsPanelProps) {
  const isOpenClawReady = isOpenClawOnboardingModelReady(snapshot);
  const isGatewayControlRunning = gatewayControlAction !== null;
  const isModelActionRunning = modelOnboardingRunState === "running";
  const isUpdateRunning = updateRunState === "running";
  const hasUpdateAvailable = Boolean(snapshot.diagnostics.updateAvailable && snapshot.diagnostics.latestVersion);
  const settingsSecondaryButtonStyles = settingsButtonClassName(surfaceTheme, "secondary");
  const settingsPrimaryButtonStyles = settingsButtonClassName(surfaceTheme, "primary");
  const settingsWarningButtonStyles = settingsButtonClassName(surfaceTheme, "warning");
  const settingsWarningSolidButtonStyles = settingsButtonClassName(surfaceTheme, "warningSolid");
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
  const commandHistory = snapshot.diagnostics.commandHistory ?? [];
  const hasCustomBinaryPath =
    openClawBinarySelection.mode !== "custom" || Boolean(openClawBinarySelection.path?.trim());
  const resolvedBinaryPreview =
    openClawBinarySelection.resolvedPath ||
    (openClawBinarySelection.mode === "global-path"
      ? "openclaw (PATH)"
      : openClawBinarySelection.mode === "local-prefix"
        ? "Local prefix"
        : "Auto");

  return (
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

      <div
        className={cn(
          "mt-2.5 rounded-[18px] border px-3 py-3",
          hasUpdateAvailable
            ? surfaceTheme === "light"
              ? "border-amber-300/90 bg-[linear-gradient(135deg,rgba(255,247,237,0.98),rgba(252,231,214,0.94))] shadow-[0_16px_36px_rgba(194,120,55,0.16)]"
              : "border-amber-300/30 bg-[linear-gradient(135deg,rgba(71,35,8,0.62),rgba(33,20,8,0.82))] shadow-[0_18px_42px_rgba(245,158,11,0.14)]"
            : surfaceTheme === "light"
              ? "border-[#e6d7cb] bg-[#fffaf6]"
              : "border-white/8 bg-white/[0.03]"
        )}
      >
        <div className="flex items-start justify-between gap-2.5">
          <div>
            <p
              className={cn(
                "text-[8px] uppercase tracking-[0.18em]",
                hasUpdateAvailable
                  ? surfaceTheme === "light"
                    ? "text-amber-800/70"
                    : "text-amber-200/80"
                  : surfaceTheme === "light"
                    ? "text-[#9a7f6c]"
                    : "text-slate-500"
              )}
            >
              {hasUpdateAvailable ? "Update available" : "Update status"}
            </p>
            <div className="mt-1.5 flex items-baseline gap-1.5">
              <p
                className={cn(
                  "font-display text-[0.98rem]",
                  hasUpdateAvailable
                    ? surfaceTheme === "light"
                      ? "text-amber-950"
                      : "text-amber-50"
                    : surfaceTheme === "light"
                      ? "text-[#3f2f24]"
                      : "text-white"
                )}
              >
                {hasUpdateAvailable
                  ? `v${snapshot.diagnostics.latestVersion}`
                  : `v${snapshot.diagnostics.version || "unknown"}`}
              </p>
              <p
                className={cn(
                  "text-[9px]",
                  hasUpdateAvailable
                    ? surfaceTheme === "light"
                      ? "text-amber-900/70"
                      : "text-amber-100/70"
                    : surfaceTheme === "light"
                      ? "text-[#8b7262]"
                      : "text-slate-400"
                )}
              >
                {hasUpdateAvailable
                  ? `from v${snapshot.diagnostics.version || "unknown"}`
                  : snapshot.diagnostics.updateInfo?.trim() ||
                    "No newer OpenClaw release was reported in the latest snapshot."}
              </p>
            </div>
          </div>
          <ArrowUpCircle
            className={cn(
              "mt-0.5 h-4 w-4",
              hasUpdateAvailable
                ? surfaceTheme === "light"
                  ? "text-amber-700"
                  : "text-amber-300"
                : surfaceTheme === "light"
                  ? "text-[#8b7262]"
                  : "text-slate-400"
            )}
          />
        </div>
        <p
          className={cn(
            "mt-1.5 text-[10px] leading-[1.05rem]",
            hasUpdateAvailable
              ? surfaceTheme === "light"
                ? "text-amber-950/80"
                : "text-amber-50/85"
              : surfaceTheme === "light"
                ? "text-[#816958]"
                : "text-slate-400"
          )}
        >
          {hasUpdateAvailable
            ? "A newer OpenClaw release was detected. You can update directly from AgentOS."
            : "OpenClaw is currently on the latest reported release."}
        </p>
        <button
          type="button"
          onClick={onOpenUpdateDialog}
          className={cn(
            "mt-2.5 inline-flex items-center justify-center py-1",
            hasUpdateAvailable ? settingsWarningSolidButtonStyles : settingsSecondaryButtonStyles
          )}
        >
          {isUpdateRunning ? (
            <>
              <LoaderCircle className="mr-1.5 h-3 w-3 animate-spin" />
              View progress
            </>
          ) : hasUpdateAvailable ? (
            "Update now"
          ) : (
            "Review update"
          )}
        </button>
      </div>

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
        <div
          className={cn(
            "mt-2 rounded-[14px] border px-2.5 py-2",
            surfaceTheme === "light"
              ? "border-[#ead8c8] bg-white"
              : "border-white/8 bg-white/[0.03]"
          )}
        >
          <p
            className={cn(
              "text-[8px] uppercase tracking-[0.18em]",
              surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-500"
            )}
          >
            Detected install
          </p>
          <p
            className={cn(
              "mt-1.5 truncate font-display text-[0.86rem]",
              surfaceTheme === "light" ? "text-[#3f2f24]" : "text-white"
            )}
            title={installSummary.label}
          >
            {installSummary.label}
          </p>
          <p
            className={cn(
              "mt-1 text-[10px] leading-[1.05rem]",
              surfaceTheme === "light" ? "text-[#816958]" : "text-slate-400"
            )}
            title={installSummary.root || undefined}
          >
            {installSummary.detail}
          </p>
        </div>
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
              snapshot.diagnostics.updateAvailable ? settingsWarningButtonStyles : settingsSecondaryButtonStyles
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
          "mt-2 rounded-[16px] border px-2.5 py-2",
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
            onClick={() => onOpenSetupWizard()}
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
                Default model:{" "}
                {snapshot.diagnostics.modelReadiness.resolvedDefaultModel ||
                  snapshot.diagnostics.modelReadiness.defaultModel ||
                  "Not set"}
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
              {snapshot.diagnostics.modelReadiness.availableModelCount}/
              {snapshot.diagnostics.modelReadiness.totalModelCount}
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
        <div className="flex items-start justify-between gap-3">
          <div>
            <p
              className={cn(
                "text-[8px] uppercase tracking-[0.18em]",
                surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-500"
              )}
            >
              Binary selector
            </p>
            <p
              className={cn(
                "mt-1 text-[10px] leading-[1.05rem]",
                surfaceTheme === "light" ? "text-[#816958]" : "text-slate-400"
              )}
            >
              Choose which OpenClaw install AgentOS should resolve.
            </p>
          </div>
          <TerminalSquare
            className={cn("mt-0.5 h-4 w-4", surfaceTheme === "light" ? "text-[#8b7262]" : "text-slate-400")}
          />
        </div>

        <div className="mt-2 grid gap-2">
          <div className="min-w-0">
            <Label htmlFor="openclaw-binary-mode" className="sr-only">
              OpenClaw binary mode
            </Label>
            <select
              id="openclaw-binary-mode"
              value={openClawBinarySelection.mode}
              onChange={(event) =>
                onOpenClawBinarySelectionModeChange(event.target.value as OpenClawBinarySelection["mode"])
              }
              disabled={isSavingOpenClawBinary}
              className={cn(
                "h-8 w-full rounded-[12px] border px-2.5 font-mono text-[11px]",
                surfaceTheme === "light"
                  ? "border-[#d9c9bc] bg-[#fffdfb] text-[#4f3d31] shadow-[inset_0_0_0_1000px_#fffdfb]"
                  : "border-white/10 bg-white/[0.04] text-slate-100"
              )}
            >
              <option value="auto">Auto</option>
              <option value="local-prefix">Local prefix</option>
              <option value="global-path">Global PATH</option>
              <option value="custom">Custom path</option>
            </select>
          </div>

          {openClawBinarySelection.mode === "custom" ? (
            <div className="min-w-0">
              <Label htmlFor="openclaw-binary-path" className="sr-only">
                Custom OpenClaw binary path
              </Label>
              <Input
                id="openclaw-binary-path"
                value={openClawBinarySelection.path || ""}
                onChange={(event) => onOpenClawBinarySelectionPathChange(event.target.value)}
                placeholder="/opt/homebrew/bin/openclaw"
                disabled={isSavingOpenClawBinary}
                className={cn(
                  "h-8 min-w-0 rounded-[12px] px-2.5 font-mono text-[12px]",
                  surfaceTheme === "light"
                    ? "border-[#d9c9bc] bg-[#fffdfb] text-[#4f3d31] caret-[#7c5a46] placeholder:text-[#b29b8b] shadow-[inset_0_0_0_1000px_#fffdfb] [-webkit-text-fill-color:#4f3d31] focus-visible:ring-[#c8946f]/45"
                    : "border-white/10 bg-white/[0.04] text-slate-100 placeholder:text-slate-500"
                )}
              />
            </div>
          ) : null}

          <div
            className={cn(
              "rounded-[14px] border px-2.5 py-2",
              surfaceTheme === "light"
                ? "border-[#ead8c8] bg-white"
                : "border-white/8 bg-white/[0.03]"
            )}
          >
            <p
              className={cn(
                "text-[8px] uppercase tracking-[0.18em]",
                surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-500"
              )}
            >
              Resolved path
            </p>
            <p
              className={cn(
                "mt-1 truncate font-display text-[0.86rem]",
                surfaceTheme === "light" ? "text-[#3f2f24]" : "text-white"
              )}
              title={resolvedBinaryPreview}
            >
              {resolvedBinaryPreview}
            </p>
            <p
              className={cn(
                "mt-1 text-[10px] leading-[1.05rem]",
                surfaceTheme === "light" ? "text-[#816958]" : "text-slate-400"
              )}
            >
              {openClawBinarySelection.detail}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={isSavingOpenClawBinary}
              onClick={() => onOpenClawBinarySelectionModeChange("auto")}
              className={settingsSecondaryButtonStyles}
            >
              Auto
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={isSavingOpenClawBinary}
              onClick={() => onOpenClawBinarySelectionModeChange("local-prefix")}
              className={settingsSecondaryButtonStyles}
            >
              Local prefix
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={isSavingOpenClawBinary}
              onClick={() => onOpenClawBinarySelectionModeChange("global-path")}
              className={settingsSecondaryButtonStyles}
            >
              Global PATH
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={isSavingOpenClawBinary || !hasCustomBinaryPath}
              onClick={() => {
                void onSaveOpenClawBinarySettings(openClawBinarySelection);
              }}
              className={settingsPrimaryButtonStyles}
            >
              {isSavingOpenClawBinary ? (
                <>
                  <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save selection"
              )}
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
          <div className="min-w-0">
            <p
              className={cn(
                "text-[11px] uppercase tracking-[0.18em]",
                surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-400"
              )}
            >
              OpenClaw commands
            </p>
            <p
              className={cn(
                "mt-1 text-[10px] leading-4",
                surfaceTheme === "light" ? "text-[#7a6252]" : "text-slate-500"
              )}
            >
              Recent CLI calls used by AgentOS.
            </p>
          </div>
          <TerminalSquare className={cn("h-4 w-4", surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-500")} />
        </div>

        <div className="mt-2 grid gap-1.5">
          {commandHistory.length > 0 ? (
            commandHistory.slice(0, 5).map((entry) => {
              const preview = entry.stderrPreview || entry.stdoutPreview;

              return (
                <div
                  key={entry.id}
                  className={cn(
                    "min-w-0 rounded-[12px] border px-2 py-1.5",
                    surfaceTheme === "light"
                      ? "border-[#e0d0c3] bg-[#fffdfb]"
                      : "border-white/[0.08] bg-black/10"
                  )}
                >
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <p
                      className={cn(
                        "min-w-0 truncate font-mono text-[10px]",
                        surfaceTheme === "light" ? "text-[#4f3d31]" : "text-slate-200"
                      )}
                    >
                      openclaw {entry.args.join(" ")}
                    </p>
                    <span
                      className={cn(
                        "shrink-0 rounded-full border px-1.5 py-0.5 text-[8px] uppercase tracking-[0.16em]",
                        commandStatusClassName(entry.status, surfaceTheme)
                      )}
                    >
                      {entry.status}
                    </span>
                  </div>
                  <div
                    className={cn(
                      "mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]",
                      surfaceTheme === "light" ? "text-[#846d5c]" : "text-slate-500"
                    )}
                  >
                    <span>{formatCommandDuration(entry.durationMs)}</span>
                    <span>{formatCommandTimestamp(entry.finishedAt)}</span>
                    {typeof entry.exitCode === "number" ? <span>exit {entry.exitCode}</span> : null}
                  </div>
                  {preview ? (
                    <p
                      className={cn(
                        "mt-1 line-clamp-2 whitespace-pre-wrap break-words font-mono text-[10px] leading-4",
                        entry.status === "ok"
                          ? surfaceTheme === "light"
                            ? "text-[#846d5c]"
                            : "text-slate-500"
                          : surfaceTheme === "light"
                            ? "text-rose-700"
                            : "text-rose-200"
                      )}
                    >
                      {preview}
                    </p>
                  ) : null}
                </div>
              );
            })
          ) : (
            <p
              className={cn(
                "rounded-[12px] border px-2 py-2 text-[11px]",
                surfaceTheme === "light"
                  ? "border-[#e0d0c3] bg-[#fffdfb] text-[#846d5c]"
                  : "border-white/[0.08] bg-black/10 text-slate-500"
              )}
            >
              No OpenClaw commands have been captured in this server session yet.
            </p>
          )}
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
          <AlertTriangle className={cn("mt-0.5 h-4 w-4", surfaceTheme === "light" ? "text-rose-700" : "text-rose-200")} />
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

function commandStatusClassName(
  status: NonNullable<MissionControlSnapshot["diagnostics"]["commandHistory"]>[number]["status"],
  surfaceTheme: SurfaceTheme
) {
  if (status === "ok") {
    return surfaceTheme === "light"
      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
      : "border-emerald-300/25 bg-emerald-300/10 text-emerald-200";
  }

  if (status === "timeout" || status === "aborted") {
    return surfaceTheme === "light"
      ? "border-amber-300 bg-amber-50 text-amber-800"
      : "border-amber-300/25 bg-amber-300/10 text-amber-200";
  }

  return surfaceTheme === "light"
    ? "border-rose-300 bg-rose-50 text-rose-700"
    : "border-rose-300/25 bg-rose-300/10 text-rose-200";
}

function formatCommandDuration(durationMs: number) {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return "unknown";
  }

  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
}

function formatCommandTimestamp(value: string) {
  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    return "unknown time";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(timestamp);
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
