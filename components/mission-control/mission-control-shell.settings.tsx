"use client";

import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  KeyRound,
  LoaderCircle,
  Plus,
  Settings2,
  SlidersHorizontal,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { OpenClawInstallSummary } from "@/components/mission-control/mission-control-shell.utils";
import type {
  AddModelsProviderId,
  MissionControlSnapshot,
  OpenClawBinarySelection,
  OpenClawCertificationScorecardReport,
  ResetTarget
} from "@/lib/agentos/contracts";
import type { GatewayNativeAuthStatus } from "@/lib/openclaw/gateway-auth";
import type { OpenClawCapabilityDiffReport } from "@/lib/openclaw/types";
import { isOpenClawOnboardingModelReady } from "@/lib/openclaw/readiness";
import { cn } from "@/lib/utils";

type SurfaceTheme = "dark" | "light";
type SnapshotStreamState = "connecting" | "live" | "retrying";
type UpdateRunState = "idle" | "running" | "success" | "error";
type GatewayControlAction = "start" | "stop" | "restart" | "doctor";
type OnboardingWizardStage = "system" | "models";

export type MissionControlShellSettingsPanelProps = {
  snapshot: MissionControlSnapshot;
  surfaceTheme: SurfaceTheme;
  connectionState: SnapshotStreamState;
  gatewayDraft: string;
  workspaceRootDraft: string;
  isSavingGateway: boolean;
  isSavingWorkspaceRoot: boolean;
  isCheckingForUpdates: boolean;
  updateRunState: UpdateRunState;
  updateCapabilityDiff: OpenClawCapabilityDiffReport | null;
  updateCertificationScorecard: OpenClawCertificationScorecardReport | null;
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
  onOpenUpdateDialog: (targetVersion?: string, mode?: "recommended" | "candidate" | "advanced") => void;
  onRollbackOpenClaw: () => void;
  onOpenResetDialog: (target: ResetTarget) => void;
  onSnapshotChange?: (snapshot: MissionControlSnapshot) => void;
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
  onOpenSetupWizard,
  onOpenAddModels
}: MissionControlShellSettingsPanelProps) {
  const [gatewayAuthStatus, setGatewayAuthStatus] = useState<GatewayNativeAuthStatus | null>(null);
  const [gatewayAuthError, setGatewayAuthError] = useState<string | null>(null);
  const [isCheckingGatewayAuth, setIsCheckingGatewayAuth] = useState(false);
  const [isRepairingGatewayAccess, setIsRepairingGatewayAccess] = useState(false);
  const isOpenClawReady = isOpenClawOnboardingModelReady(snapshot);
  const certifiedVersion = snapshot.diagnostics.updateCompatibility?.recommendedVersion;
  const updateSummary = "Native status on Updates";
  const defaultModel =
    snapshot.diagnostics.modelReadiness.resolvedDefaultModel ||
    snapshot.diagnostics.modelReadiness.defaultModel ||
    "Not selected";
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
              <span className="font-display text-[1rem]">{formatSnapshotHealthLabel(snapshot)}</span>
              <StatusPill snapshot={snapshot} surfaceTheme={surfaceTheme} />
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
          <div className="min-w-0">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <p className={cn("shrink-0 text-[9px] uppercase tracking-[0.18em]", mutedTextClassName(surfaceTheme))}>
                Updates
              </p>
              <p className={cn("truncate text-right text-[9px] uppercase tracking-[0.14em]", mutedTextClassName(surfaceTheme))}>
                {snapshot.diagnostics.updateChannel || "Channel unknown"}
              </p>
            </div>
            <p className="mt-1 truncate text-[13px]">{updateSummary}</p>
            <p className={cn("mt-1 text-[11px] leading-4", mutedTextClassName(surfaceTheme))}>
              {snapshot.diagnostics.version ? `v${snapshot.diagnostics.version}` : "Version unknown"}
              {certifiedVersion ? ` · AgentOS certified version v${certifiedVersion}` : " · AgentOS certification unavailable"}
            </p>
            <div className="mt-2">
              <Button asChild type="button" size="sm" variant="secondary" className={cn("w-full px-2 text-[10px]", quickButtonClassName(surfaceTheme))}>
                <Link href="/updates">Manage updates <span aria-hidden="true">→</span></Link>
              </Button>
            </div>
          </div>
        </div>
      </div>

      <p className={cn("mt-2 px-1 text-[10px] leading-4", mutedTextClassName(surfaceTheme))}>
        Runtime configuration stays here. Updates are managed from the canonical Updates page.
      </p>

      <div className="mt-2.5 grid gap-1.5">
        <QuickRow
          surfaceTheme={surfaceTheme}
          icon={<SlidersHorizontal className="h-3.5 w-3.5" />}
          label="OpenClaw global default"
          value={defaultModel}
          wrapValue
          action={
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => onOpenAddModels(null)}
              className={quickButtonClassName(surfaceTheme)}
            >
              <Plus className="h-3 w-3" />
              Models
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
  snapshot,
  surfaceTheme
}: {
  snapshot: MissionControlSnapshot;
  surfaceTheme: SurfaceTheme;
}) {
  const isCliFallbackActive = snapshot.diagnostics.transport?.gatewayMode === "fallback-active";
  const health = isCliFallbackActive ? "healthy" : snapshot.diagnostics.health;

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
      {isCliFallbackActive ? "Online" : formatHealthLabel(health)}
      {isCliFallbackActive ? <CliFallbackInfo surfaceTheme={surfaceTheme} /> : null}
    </span>
  );
}

function CliFallbackInfo({ surfaceTheme }: { surfaceTheme: SurfaceTheme }) {
  return (
    <span
      aria-label="CLI fallback active"
      title="CLI fallback active"
      className={cn(
        "inline-flex h-4 w-4 items-center justify-center rounded-full",
        surfaceTheme === "light" ? "text-emerald-700" : "text-emerald-200"
      )}
    >
      <Info className="h-3 w-3 opacity-75" />
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

function formatSnapshotHealthLabel(snapshot: MissionControlSnapshot) {
  const { diagnostics } = snapshot;
  if (diagnostics.health === "degraded") {
    if (diagnostics.transport?.gatewayMode === "fallback-active") {
      return "Online";
    }

    if (diagnostics.eventBridge?.mode === "reconnecting") {
      return "Reconnecting";
    }

    if (diagnostics.eventBridge?.mode === "polling") {
      return "Polling fallback";
    }
  }

  return formatHealthLabel(diagnostics.health);
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
