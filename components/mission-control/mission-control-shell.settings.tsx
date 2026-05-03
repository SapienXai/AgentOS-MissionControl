"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  KeyRound,
  LoaderCircle,
  Plus,
  RefreshCw,
  Settings2,
  SlidersHorizontal,
  Wrench
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { OpenClawInstallSummary } from "@/components/mission-control/mission-control-shell.utils";
import type {
  AddModelsProviderId,
  MissionControlSnapshot,
  OpenClawBinarySelection,
  ResetTarget
} from "@/lib/agentos/contracts";
import type { GatewayNativeAuthStatus } from "@/lib/openclaw/gateway-auth";
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
  isCheckingForUpdates,
  updateRunState,
  lastCheckedAt,
  onCheckForUpdates,
  onOpenSetupWizard,
  onOpenUpdateDialog
}: MissionControlShellSettingsPanelProps) {
  const [gatewayAuthStatus, setGatewayAuthStatus] = useState<GatewayNativeAuthStatus | null>(null);
  const [gatewayAuthError, setGatewayAuthError] = useState<string | null>(null);
  const [isCheckingGatewayAuth, setIsCheckingGatewayAuth] = useState(false);
  const [isRepairingGatewayAccess, setIsRepairingGatewayAccess] = useState(false);
  const isUpdateRunning = updateRunState === "running";
  const isOpenClawReady = isOpenClawOnboardingModelReady(snapshot);
  const hasUpdateAvailable = Boolean(snapshot.diagnostics.updateAvailable && snapshot.diagnostics.latestVersion);
  const isUpdateRegistryLoading = Boolean(
    snapshot.diagnostics.version && !snapshot.diagnostics.latestVersion && !snapshot.diagnostics.updateError
  );
  const updateStatusText = isCheckingForUpdates
    ? "Checking update registry..."
    : hasUpdateAvailable
      ? `Latest v${snapshot.diagnostics.latestVersion}`
      : snapshot.diagnostics.updateError
        ? "Check failed"
        : isUpdateRegistryLoading
          ? snapshot.diagnostics.updateInfo?.trim() || "Registry status is still loading."
          : "Up to date";
  const defaultModel =
    snapshot.diagnostics.modelReadiness.resolvedDefaultModel ||
    snapshot.diagnostics.modelReadiness.defaultModel ||
    "Not selected";
  const gatewayLabel = resolveGatewayLabel(snapshot);
  const hasAuthIssue = Boolean(
    gatewayAuthStatus &&
      !gatewayAuthStatus.native.ok &&
      (gatewayAuthStatus.native.kind === "auth" || gatewayAuthStatus.native.kind === "scope-limited")
  );

  const refreshGatewayAuthStatus = useCallback(async () => {
    setIsCheckingGatewayAuth(true);
    setGatewayAuthError(null);

    try {
      setGatewayAuthStatus(await fetchGatewayAuthStatus());
    } catch (error) {
      setGatewayAuthError(error instanceof Error ? error.message : "Unable to check Gateway auth status.");
    } finally {
      setIsCheckingGatewayAuth(false);
    }
  }, []);

  useEffect(() => {
    void refreshGatewayAuthStatus();
  }, [refreshGatewayAuthStatus]);

  const repairGatewayAccess = async () => {
    setIsRepairingGatewayAccess(true);
    setGatewayAuthError(null);

    try {
      const response = await fetch("/api/settings/gateway", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ action: "repairDeviceAccess" })
      });

      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(result?.error || "Gateway access could not be repaired.");
      }

      const result = (await response.json()) as { authStatus: GatewayNativeAuthStatus };
      setGatewayAuthStatus(result.authStatus);
    } catch (error) {
      setGatewayAuthError(error instanceof Error ? error.message : "Unable to repair Gateway access.");
    } finally {
      setIsRepairingGatewayAccess(false);
    }
  };

  return (
    <div
      role="menu"
      aria-label="System menu"
      className={cn(
        "absolute right-0 top-14 z-50 w-[336px] overflow-hidden rounded-[24px] border p-3 shadow-[0_24px_68px_rgba(40,28,20,0.22)] backdrop-blur-2xl",
        surfaceTheme === "light"
          ? "border-[#dfcfc2] bg-[#fffaf3]/96 text-[#2b211c]"
          : "border-white/[0.10] bg-[#08101c]/98 text-slate-100 shadow-[0_28px_80px_rgba(0,0,0,0.48)]"
      )}
    >
      <div className={cn("rounded-[20px] border p-3.5", menuPanelClassName(surfaceTheme))}>
        <div className="flex items-center justify-between gap-2.5">
          <div>
            <p className={cn("text-[9px] uppercase tracking-[0.22em]", mutedTextClassName(surfaceTheme))}>
              OpenClaw
            </p>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span className="font-display text-[1rem]">{formatHealthLabel(snapshot.diagnostics.health)}</span>
              <StatusPill health={snapshot.diagnostics.health} surfaceTheme={surfaceTheme} />
            </div>
          </div>
          <div className="text-right">
            <p className={cn("text-[9px] uppercase tracking-[0.2em]", mutedTextClassName(surfaceTheme))}>
              Version
            </p>
            <p className="mt-0.5 font-mono text-[11px]">v{snapshot.diagnostics.version || "unknown"}</p>
          </div>
        </div>

        <div className={cn("mt-3 rounded-[18px] border p-3", insetPanelClassName(surfaceTheme))}>
          <div className="flex items-center justify-between gap-2.5">
            <div>
              <p className={cn("text-[9px] uppercase tracking-[0.18em]", mutedTextClassName(surfaceTheme))}>
                Updates
              </p>
              <p className="mt-0.5 text-[13px]">{updateStatusText}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void onCheckForUpdates()}
                disabled={isCheckingForUpdates || isUpdateRunning}
                className={quickButtonClassName(surfaceTheme)}
              >
                {isCheckingForUpdates ? (
                  <LoaderCircle className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                {isCheckingForUpdates ? "Checking..." : "Check"}
              </Button>
              {hasUpdateAvailable ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={onOpenUpdateDialog}
                  disabled={isUpdateRunning}
                  className="rounded-full bg-emerald-600 px-2.5 text-[11px] text-white shadow-[0_12px_24px_rgba(16,185,129,0.24)] hover:bg-emerald-500"
                >
                  <ArrowUpRight className="h-3 w-3" />
                  Update
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div
        className={cn(
          "mt-2 rounded-[16px] border px-3 py-2",
          surfaceTheme === "light"
            ? "border-[#e6d7c9] bg-white text-[#6b5546]"
            : "border-white/[0.08] bg-[#0f1826] text-slate-300"
        )}
      >
        <p className="text-[10px] uppercase tracking-[0.18em]">{isCheckingForUpdates ? "Checking" : "Registry"}</p>
        <p className="mt-1 text-[11px] leading-4">
          {isCheckingForUpdates
            ? "Refreshing OpenClaw update registry..."
            : snapshot.diagnostics.updateInfo?.trim() ||
              (lastCheckedAt ? `Last checked ${new Date(lastCheckedAt).toLocaleTimeString()}.` : "No registry check run yet.")}
        </p>
      </div>

      <div className="mt-2.5 grid gap-1.5">
        <QuickRow
          surfaceTheme={surfaceTheme}
          icon={<Wrench className="h-3.5 w-3.5" />}
          label="Gateway"
          value={gatewayLabel}
          detail={snapshot.diagnostics.gatewayUrl || "No endpoint"}
        />
        <QuickRow
          surfaceTheme={surfaceTheme}
          icon={<SlidersHorizontal className="h-3.5 w-3.5" />}
          label="Default model"
          value={defaultModel}
          wrapValue
          action={
            <Button asChild size="sm" variant="secondary" className={quickButtonClassName(surfaceTheme)}>
              <Link href="/settings#models">
                <Plus className="h-3 w-3" />
                Models
              </Link>
            </Button>
          }
        />
        <QuickRow
          surfaceTheme={surfaceTheme}
          icon={isOpenClawReady ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
          label="Setup"
          value={isOpenClawReady ? "Ready" : "Needs setup"}
          action={
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => onOpenSetupWizard(isOpenClawReady ? "system" : undefined)}
              className={quickButtonClassName(surfaceTheme)}
            >
              Open
            </Button>
          }
        />
      </div>

      {hasAuthIssue || gatewayAuthError ? (
        <div
          className={cn(
            "mt-2.5 rounded-[18px] border p-2.5",
            surfaceTheme === "light"
              ? "border-amber-300/70 bg-amber-50/80 text-amber-950"
              : "border-amber-300/20 bg-amber-300/10 text-amber-100"
          )}
        >
          <div className="flex items-start gap-2.5">
            <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">Gateway auth needs attention</p>
              <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 opacity-80">
                {gatewayAuthError ||
                  gatewayAuthStatus?.native.issue ||
                  "Native Gateway auth is not ready. Open Settings to repair access."}
              </p>
            </div>
          </div>
          <div className="mt-2.5 flex items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => void refreshGatewayAuthStatus()}
              disabled={isCheckingGatewayAuth || isRepairingGatewayAccess}
              className={quickButtonClassName(surfaceTheme)}
            >
              {isCheckingGatewayAuth ? <LoaderCircle className="h-3 w-3 animate-spin" /> : null}
              Test
            </Button>
            {gatewayAuthStatus?.native.kind === "scope-limited" ? (
              <Button
                type="button"
                size="sm"
                onClick={() => void repairGatewayAccess()}
                disabled={isCheckingGatewayAuth || isRepairingGatewayAccess}
                className="rounded-full bg-emerald-600 px-2.5 text-[11px] text-white hover:bg-emerald-500"
              >
                {isRepairingGatewayAccess ? <LoaderCircle className="h-3 w-3 animate-spin" /> : null}
                Repair
              </Button>
            ) : null}
            <Button asChild size="sm" variant="secondary" className={quickButtonClassName(surfaceTheme)}>
              <Link href="/settings#gateway">Open settings</Link>
            </Button>
          </div>
        </div>
      ) : null}

      <div className={cn("mt-2.5 grid grid-cols-2 gap-1.5 border-t pt-2.5", dividerClassName(surfaceTheme))}>
        <Button asChild variant="secondary" className={footerButtonClassName(surfaceTheme)}>
          <Link href="/settings">
            <Settings2 className="h-3.5 w-3.5" />
            Control Center
          </Link>
        </Button>
        <Button asChild variant="secondary" className={footerButtonClassName(surfaceTheme)}>
          <Link href="/settings#diagnostics">
            <AlertTriangle className="h-3.5 w-3.5" />
            Diagnostics
          </Link>
        </Button>
      </div>
    </div>
  );
}

function StatusPill({
  health,
  surfaceTheme
}: {
  health: MissionControlSnapshot["diagnostics"]["health"];
  surfaceTheme: SurfaceTheme;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.18em]",
        health === "healthy"
          ? surfaceTheme === "light"
            ? "border-emerald-300 bg-emerald-50 text-emerald-700"
            : "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
          : health === "degraded"
            ? surfaceTheme === "light"
              ? "border-amber-300 bg-amber-50 text-amber-700"
              : "border-amber-300/25 bg-amber-300/10 text-amber-100"
            : surfaceTheme === "light"
              ? "border-rose-300 bg-rose-50 text-rose-700"
              : "border-rose-300/25 bg-rose-300/10 text-rose-100"
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {formatHealthLabel(health)}
    </span>
  );
}

function QuickRow({
  surfaceTheme,
  icon,
  label,
  value,
  detail,
  action,
  wrapValue = false
}: {
  surfaceTheme: SurfaceTheme;
  icon: ReactNode;
  label: string;
  value: string;
  detail?: string;
  action?: ReactNode;
  wrapValue?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-3 rounded-[20px] border p-3", menuPanelClassName(surfaceTheme))}>
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border",
          surfaceTheme === "light"
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-cyan-300/15 bg-cyan-300/10 text-cyan-200"
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("text-[10px] uppercase tracking-[0.18em]", mutedTextClassName(surfaceTheme))}>{label}</p>
        <p
          className={cn(
            "mt-1 text-sm font-medium",
            wrapValue ? "break-words leading-4" : "truncate"
          )}
          title={value}
        >
          {value}
        </p>
        {detail ? (
          <p className={cn("mt-0.5", wrapValue ? "break-words text-[11px] leading-4" : "truncate text-xs", mutedTextClassName(surfaceTheme))}>
            {detail}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

async function fetchGatewayAuthStatus() {
  const response = await fetch("/api/settings/gateway", {
    method: "GET",
    cache: "no-store"
  });

  if (!response.ok) {
    const result = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(result?.error || "Unable to check Gateway auth status.");
  }

  const result = (await response.json()) as { authStatus: GatewayNativeAuthStatus };
  return result.authStatus;
}

function resolveGatewayLabel(snapshot: MissionControlSnapshot) {
  const { diagnostics } = snapshot;
  const locality = diagnostics.bindMode === "remote" || diagnostics.configuredGatewayUrl ? "Remote" : "Local";
  const state = diagnostics.rpcOk || diagnostics.loaded ? "Online" : "Offline";
  return `${locality} / ${state}`;
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

function menuPanelClassName(surfaceTheme: SurfaceTheme) {
  return surfaceTheme === "light"
    ? "border-[#e5d7c9] bg-[#fffaf4]/86 shadow-[0_18px_48px_rgba(119,91,70,0.08)]"
    : "border-white/[0.08] bg-[#0d1624]/96";
}

function insetPanelClassName(surfaceTheme: SurfaceTheme) {
  return surfaceTheme === "light"
    ? "border-[#eadbcf] bg-[#f9f1e8]/80"
    : "border-white/[0.08] bg-[#101a2a]/92";
}

function mutedTextClassName(surfaceTheme: SurfaceTheme) {
  return surfaceTheme === "light" ? "text-[#8c7564]" : "text-slate-400";
}

function dividerClassName(surfaceTheme: SurfaceTheme) {
  return surfaceTheme === "light" ? "border-[#e6d7c9]" : "border-white/[0.08]";
}

function quickButtonClassName(surfaceTheme: SurfaceTheme) {
  return cn(
    "h-8 rounded-full px-3 text-xs",
    surfaceTheme === "light"
      ? "border-[#dcc9bb] bg-[#fffaf3] text-[#5d493b] hover:bg-[#f3e7dc]"
      : "border-white/10 bg-[#121d2d] text-slate-200 hover:bg-[#182538]"
  );
}

function footerButtonClassName(surfaceTheme: SurfaceTheme) {
  return cn(
    "h-10 rounded-full text-xs",
    surfaceTheme === "light"
      ? "border-[#dcc9bb] bg-[#fffaf3] text-[#4d3c32] hover:bg-[#f3e7dc]"
      : "border-white/10 bg-[#121d2d] text-slate-200 hover:bg-[#182538]"
  );
}
