"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Bot,
  Box,
  Check,
  ChevronDown,
  Copy,
  Folder,
  KeyRound,
  LoaderCircle,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  ShieldCheck,
  TerminalSquare,
  Trash2,
  Wrench
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { MissionControlShellSettingsPanelProps } from "@/components/mission-control/mission-control-shell.settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  GatewayNativeAuthCredentialKind,
  GatewayNativeAuthStatus
} from "@/lib/openclaw/gateway-auth";
import { compactPath } from "@/lib/openclaw/presenters";
import { cn } from "@/lib/utils";

const binaryModes: Array<{
  value: MissionControlShellSettingsPanelProps["openClawBinarySelection"]["mode"];
  label: string;
}> = [
  { value: "auto", label: "Auto" },
  { value: "local-prefix", label: "Local prefix" },
  { value: "global-path", label: "Global PATH" },
  { value: "custom", label: "Custom" }
];

type SurfaceTheme = "dark" | "light";
type SettingsSectionId =
  | "openclaw"
  | "gateway"
  | "models"
  | "workspace"
  | "agents"
  | "diagnostics"
  | "advanced"
  | "danger-zone";

export function SettingsControlCenter(props: MissionControlShellSettingsPanelProps) {
  const {
    snapshot,
    surfaceTheme,
    gatewayDraft,
    workspaceRootDraft,
    openClawBinarySelection,
    isSavingGateway,
    isSavingWorkspaceRoot,
    isSavingOpenClawBinary,
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
    onOpenClawBinarySelectionModeChange,
    onOpenClawBinarySelectionPathChange,
    onSaveOpenClawBinarySettings,
    installSummary
  } = props;
  const [gatewayAuthStatus, setGatewayAuthStatus] = useState<GatewayNativeAuthStatus | null>(null);
  const [gatewayAuthError, setGatewayAuthError] = useState<string | null>(null);
  const [gatewayAuthCredentialKind, setGatewayAuthCredentialKind] =
    useState<GatewayNativeAuthCredentialKind>("token");
  const [gatewayAuthCredential, setGatewayAuthCredential] = useState("");
  const [gatewayAuthSaveMessage, setGatewayAuthSaveMessage] = useState<string | null>(null);
  const [isCheckingGatewayAuth, setIsCheckingGatewayAuth] = useState(false);
  const [isSavingGatewayAuthCredential, setIsSavingGatewayAuthCredential] = useState(false);
  const [isGeneratingGatewayAuthToken, setIsGeneratingGatewayAuthToken] = useState(false);
  const [isRepairingGatewayDeviceAccess, setIsRepairingGatewayDeviceAccess] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(() => resolveInitialSettingsSection());
  const hasUpdateAvailable = Boolean(snapshot.diagnostics.updateAvailable && snapshot.diagnostics.latestVersion);
  const defaultModel =
    snapshot.diagnostics.modelReadiness.resolvedDefaultModel ||
    snapshot.diagnostics.modelReadiness.defaultModel ||
    "";
  const selectedOrDefaultModelId = selectedModelId || defaultModel || "";
  const selectedModel = snapshot.models.find((model) => model.id === selectedOrDefaultModelId);
  const modelProvider =
    selectedModel?.provider ||
    snapshot.diagnostics.modelReadiness.preferredLoginProvider ||
    deriveProviderFromModel(defaultModel) ||
    "Not connected";
  const commandHistory = useMemo(
    () => snapshot.diagnostics.commandHistory ?? [],
    [snapshot.diagnostics.commandHistory]
  );
  const latestCommands = commandHistory.slice(0, 6);
  const commandStats = useMemo(
    () => ({
      ok: commandHistory.filter((command) => command.status === "ok").length,
      failed: commandHistory.filter((command) => command.status !== "ok").length
    }),
    [commandHistory]
  );
  const nativeAuthLabel = gatewayAuthStatus
    ? gatewayAuthStatus.native.ok
      ? "Authenticated"
      : formatGatewayAuthIssue(gatewayAuthStatus.native.kind)
    : "Unknown";

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

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const syncActiveSectionFromHash = () => {
      setActiveSection(resolveInitialSettingsSection());
    };

    window.addEventListener("hashchange", syncActiveSectionFromHash);
    syncActiveSectionFromHash();

    return () => {
      window.removeEventListener("hashchange", syncActiveSectionFromHash);
    };
  }, []);

  const saveGatewayAuthCredential = async () => {
    const credential = gatewayAuthCredential.trim();
    if (!credential) {
      setGatewayAuthError("Gateway token/password is required.");
      return;
    }

    setIsSavingGatewayAuthCredential(true);
    setGatewayAuthError(null);
    setGatewayAuthSaveMessage(null);

    try {
      const response = await fetch("/api/settings/gateway", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "saveCredential",
          kind: gatewayAuthCredentialKind,
          value: credential
        })
      });

      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(result?.error || "Gateway credential could not be saved.");
      }

      const result = (await response.json()) as { authStatus: GatewayNativeAuthStatus };
      setGatewayAuthStatus(result.authStatus);
      setGatewayAuthCredential("");
      setGatewayAuthSaveMessage("Saved to .env.local and applied to the current AgentOS server session.");
    } catch (error) {
      setGatewayAuthError(error instanceof Error ? error.message : "Unable to save Gateway credential.");
    } finally {
      setIsSavingGatewayAuthCredential(false);
    }
  };

  const generateGatewayAuthToken = async () => {
    setIsGeneratingGatewayAuthToken(true);
    setGatewayAuthError(null);
    setGatewayAuthSaveMessage(null);

    try {
      const response = await fetch("/api/settings/gateway", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ action: "generateLocalToken" })
      });

      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(result?.error || "Gateway token could not be generated.");
      }

      const result = (await response.json()) as { authStatus: GatewayNativeAuthStatus };
      setGatewayAuthStatus(result.authStatus);
      setGatewayAuthSaveMessage("Generated a local Gateway token and applied it to AgentOS.");
    } catch (error) {
      setGatewayAuthError(error instanceof Error ? error.message : "Unable to generate Gateway token.");
    } finally {
      setIsGeneratingGatewayAuthToken(false);
    }
  };

  const repairGatewayDeviceAccess = async () => {
    setIsRepairingGatewayDeviceAccess(true);
    setGatewayAuthError(null);
    setGatewayAuthSaveMessage(null);

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
        throw new Error(result?.error || "Gateway device access could not be repaired.");
      }

      const result = (await response.json()) as { authStatus: GatewayNativeAuthStatus };
      setGatewayAuthStatus(result.authStatus);
      setGatewayAuthSaveMessage("Local Gateway device access repaired for AgentOS.");
    } catch (error) {
      setGatewayAuthError(error instanceof Error ? error.message : "Unable to repair Gateway access.");
    } finally {
      setIsRepairingGatewayDeviceAccess(false);
    }
  };

  return (
    <main
      className={cn(
        "relative z-10 min-h-screen",
        surfaceTheme === "light" ? "text-[#2c211a]" : "text-slate-100"
      )}
    >
        <section className="min-w-0 px-4 pb-8 pt-[86px] sm:px-6 lg:ml-[384px] lg:mr-[84px] lg:px-7 xl:px-8">
          <div className="mx-auto max-w-[1160px] 2xl:max-w-[1240px]">
            <div className="flex flex-col">
              <Link
                href="/"
                className={cn(
                  "mb-2 inline-flex w-fit items-center gap-2 rounded-full border px-3 py-2 text-xs shadow-[0_12px_28px_rgba(91,63,43,0.08)] lg:hidden",
                  surfaceTheme === "light"
                    ? "border-[#decfc2] bg-[#fffaf3]/86 text-[#6f5a4b]"
                    : "border-white/10 bg-[#0e1726]/96 text-slate-200 shadow-[0_12px_28px_rgba(0,0,0,0.24)]"
                )}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Mission Control
              </Link>
            </div>

            <div className="mt-5 flex flex-col gap-4">
              {activeSection === "openclaw" ? (
              <section id="openclaw" className="scroll-mt-24">
                <div
                  className={cn(
                    "panel-surface panel-glow min-h-full overflow-hidden rounded-[22px] p-4",
                    surfaceTheme === "light"
                      ? "border-white/[0.08] bg-[linear-gradient(180deg,rgba(12,19,32,0.98),rgba(6,10,18,0.97))] text-white"
                      : "border-white/[0.08] bg-[linear-gradient(180deg,rgba(16,24,38,0.98),rgba(7,11,18,0.96))] text-slate-100"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border",
                        surfaceTheme === "light"
                          ? "border-white/10 bg-white/[0.04] text-emerald-200"
                          : "border-cyan-300/15 bg-cyan-300/10 text-cyan-200"
                      )}
                    >
                      <Activity className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 className="font-display text-lg">OpenClaw</h2>
                      <p
                        className={cn(
                          "mt-0.5 text-xs leading-5",
                          surfaceTheme === "light" ? "text-white/54" : "text-slate-400"
                        )}
                      >
                        Source of truth for runtime and control state.
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <Metric
                      label="Current version"
                      value={`v${snapshot.diagnostics.version || "unknown"}`}
                      surfaceTheme={surfaceTheme}
                      dark
                    />
                    <Metric
                      label="Latest available"
                      value={snapshot.diagnostics.latestVersion ? `v${snapshot.diagnostics.latestVersion}` : "Unknown"}
                      badge={hasUpdateAvailable ? "Update" : "Stable"}
                      surfaceTheme={surfaceTheme}
                      dark
                    />
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      onClick={onOpenUpdateDialog}
                      disabled={!hasUpdateAvailable || updateRunState === "running"}
                      className="h-9 rounded-full bg-emerald-600 px-4 text-xs text-white hover:bg-emerald-500"
                    >
                      {updateRunState === "running" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <PackageCheck className="h-3.5 w-3.5" />}
                      Update now
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void onCheckForUpdates()}
                      disabled={isCheckingForUpdates || updateRunState === "running"}
                      className={secondaryButtonClassName(surfaceTheme, "px-4")}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Check
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => onOpenSetupWizard()}
                      className={secondaryButtonClassName(surfaceTheme, "px-4")}
                    >
                      <Wrench className="h-3.5 w-3.5" />
                      Open wizard
                    </Button>
                  </div>

                  <div className="mt-5 grid gap-3 border-t border-white/10 pt-4 sm:grid-cols-2">
                    <Metric
                      label="Detected install"
                      value={installSummary.label || "Unknown"}
                      surfaceTheme={surfaceTheme}
                      dark
                      compact
                    />
                    <Metric
                      label="Resolved path"
                      value={shortPath(openClawBinarySelection.resolvedPath || "openclaw", 26)}
                      surfaceTheme={surfaceTheme}
                      dark
                      compact
                    />
                  </div>

                  <div className="mt-4 rounded-[18px] border border-white/10 bg-white/[0.035] p-3.5">
                    <Label className={labelClassName(surfaceTheme)}>OpenClaw binary mode</Label>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {binaryModes.map((mode) => (
                        <button
                          key={mode.value}
                          type="button"
                          onClick={() => onOpenClawBinarySelectionModeChange(mode.value)}
                          className={cn(
                            "h-9 rounded-full border px-3 text-xs transition-colors",
                            openClawBinarySelection.mode === mode.value
                              ? "border-emerald-300 bg-emerald-300/14 text-emerald-100"
                              : surfaceTheme === "light"
                                ? "border-white/10 bg-white/[0.03] text-white/70 hover:bg-white/[0.08]"
                                : "border-white/10 bg-[#121d2d] text-slate-200 hover:bg-[#182538]"
                          )}
                        >
                          {mode.label}
                        </button>
                      ))}
                    </div>
                    {openClawBinarySelection.mode === "custom" ? (
                      <Input
                        value={openClawBinarySelection.path ?? ""}
                        onChange={(event) => onOpenClawBinarySelectionPathChange(event.target.value)}
                        placeholder="/path/to/openclaw"
                        className={inputClassName(surfaceTheme, "mt-3")}
                      />
                    ) : null}
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void onSaveOpenClawBinarySettings(openClawBinarySelection)}
                      disabled={isSavingOpenClawBinary}
                      className={secondaryButtonClassName(surfaceTheme, "mt-3 w-full")}
                    >
                      {isSavingOpenClawBinary ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      Save selection
                    </Button>
                  </div>
                </div>
              </section>
              ) : null}

              {activeSection === "gateway" ? (
              <section id="gateway" className="scroll-mt-24">
                <Card title="Gateway" icon={ShieldCheck} surfaceTheme={surfaceTheme}>
                  <InfoRows
                    surfaceTheme={surfaceTheme}
                    rows={[
                      ["Status", `${resolveGatewayLocality(snapshot)} / ${snapshot.diagnostics.loaded || snapshot.diagnostics.rpcOk ? "Online" : "Offline"}`],
                      ["Endpoint", snapshot.diagnostics.gatewayUrl || "Not configured"],
                      ["Auth status", nativeAuthLabel]
                    ]}
                    successIndex={2}
                  />

                  <div className="mt-4 space-y-3">
                    <div>
                      <Label className={labelClassName(surfaceTheme)}>Gateway endpoint</Label>
                      <Input
                        value={gatewayDraft}
                        onChange={(event) => onGatewayDraftChange(event.target.value)}
                        placeholder="ws://127.0.0.1:18789"
                        className={inputClassName(surfaceTheme, "mt-2")}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        onClick={() => void onSaveGatewaySettings(gatewayDraft.trim() || null)}
                        disabled={isSavingGateway}
                        className="h-9 rounded-full bg-emerald-600 text-xs text-white hover:bg-emerald-500"
                      >
                        {isSavingGateway ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                        Save endpoint
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void onSaveGatewaySettings(null)}
                        disabled={isSavingGateway}
                        className={secondaryButtonClassName(surfaceTheme)}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Clear
                      </Button>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2">
                    {(["start", "stop", "restart"] as const).map((action) => (
                      <Button
                        key={action}
                        type="button"
                        variant="secondary"
                        onClick={() => void onControlGateway(action)}
                        disabled={gatewayControlAction !== null}
                        className={cn(secondaryButtonClassName(surfaceTheme), "capitalize")}
                      >
                        {gatewayControlAction === action ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
                        {action}
                      </Button>
                    ))}
                  </div>

                  <div
                    className={cn(
                      "mt-4 rounded-[18px] p-3.5",
                      surfaceTheme === "light"
                        ? "border border-emerald-200 bg-emerald-50/55"
                        : "border border-cyan-300/12 bg-cyan-300/[0.06]"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <KeyRound
                        className={cn(
                          "mt-0.5 h-4 w-4",
                          surfaceTheme === "light" ? "text-emerald-700" : "text-cyan-200"
                        )}
                      />
                      <div>
                        <p className={cn("text-sm font-medium", surfaceTheme === "light" ? "text-[#2f624b]" : "text-slate-100")}>
                          Native Gateway auth
                        </p>
                        <p
                          className={cn(
                            "mt-1 text-xs leading-5",
                            surfaceTheme === "light" ? "text-[#6f836f]" : "text-slate-400"
                          )}
                        >
                          Use local repair when AgentOS reports missing operator scopes.
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void repairGatewayDeviceAccess()}
                        disabled={isRepairingGatewayDeviceAccess}
                        className={secondaryButtonClassName(surfaceTheme, "px-3", "gateway-contrast")}
                      >
                        {isRepairingGatewayDeviceAccess ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}
                        Repair local access
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void generateGatewayAuthToken()}
                        disabled={isGeneratingGatewayAuthToken}
                        className={secondaryButtonClassName(surfaceTheme, "px-3", "gateway-contrast")}
                      >
                        {isGeneratingGatewayAuthToken ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                        Generate token
                      </Button>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-[112px_1fr]">
                      <select
                        value={gatewayAuthCredentialKind}
                        onChange={(event) => setGatewayAuthCredentialKind(event.target.value as GatewayNativeAuthCredentialKind)}
                        className={inputClassName(surfaceTheme)}
                      >
                        <option value="token">Token</option>
                        <option value="password">Password</option>
                      </select>
                      <Input
                        type="password"
                        value={gatewayAuthCredential}
                        onChange={(event) => setGatewayAuthCredential(event.target.value)}
                        placeholder="Paste known credential"
                        className={inputClassName(surfaceTheme)}
                      />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        onClick={() => void saveGatewayAuthCredential()}
                        disabled={isSavingGatewayAuthCredential}
                        className="h-9 rounded-full bg-emerald-600 text-xs text-white hover:bg-emerald-500"
                      >
                        {isSavingGatewayAuthCredential ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                        Save credential
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void refreshGatewayAuthStatus()}
                        disabled={isCheckingGatewayAuth}
                        className={secondaryButtonClassName(surfaceTheme, undefined, "gateway-contrast")}
                      >
                        {isCheckingGatewayAuth ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        Test auth
                      </Button>
                    </div>
                    {gatewayAuthError || gatewayAuthSaveMessage || gatewayAuthStatus?.native.issue ? (
                      <p
                        className={cn(
                          "mt-3 text-xs leading-5",
                          gatewayAuthError
                            ? surfaceTheme === "light"
                              ? "text-red-700"
                              : "text-rose-300"
                            : surfaceTheme === "light"
                              ? "text-[#52735e]"
                              : "text-slate-400"
                        )}
                      >
                        {gatewayAuthError || gatewayAuthSaveMessage || gatewayAuthStatus?.native.issue}
                      </p>
                    ) : null}
                  </div>
                </Card>
              </section>
              ) : null}

              {activeSection === "models" ? (
              <section id="models" className="scroll-mt-24">
                <Card title="Models" icon={Box} surfaceTheme={surfaceTheme}>
                  <InfoRows
                    surfaceTheme={surfaceTheme}
                    rows={[
                      ["Default model", defaultModel || "Not selected"],
                      ["Provider", modelProvider],
                      ["Available", `${snapshot.diagnostics.modelReadiness.availableModelCount} of ${snapshot.diagnostics.modelReadiness.totalModelCount}`]
                    ]}
                  />
                  <div className="mt-4">
                    <Label className={labelClassName(surfaceTheme)}>Model</Label>
                    <select
                      value={selectedOrDefaultModelId}
                      onChange={(event) => onSelectedModelIdChange(event.target.value)}
                      className={inputClassName(surfaceTheme, "mt-2")}
                    >
                      <option value="">Choose model</option>
                      {snapshot.models.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name || model.id}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      onClick={() => void onRunModelSetDefault(selectedOrDefaultModelId)}
                      disabled={!selectedOrDefaultModelId || modelOnboardingRunState === "running"}
                      className="h-9 rounded-full bg-emerald-600 text-xs text-white hover:bg-emerald-500"
                    >
                      {modelOnboardingRunState === "running" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      Use selected
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => onOpenAddModels(null)}
                      className={secondaryButtonClassName(surfaceTheme)}
                    >
                      Add models
                    </Button>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void onRunModelRefresh()}
                    disabled={modelOnboardingRunState === "running"}
                    className={cn(secondaryButtonClassName(surfaceTheme), "mt-3 w-full")}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Refresh models
                  </Button>
                </Card>
              </section>
              ) : null}

              {activeSection === "workspace" ? (
              <section id="workspace" className="scroll-mt-24">
                <Card title="Workspace" icon={Folder} surfaceTheme={surfaceTheme}>
                  <div>
                    <Label className={labelClassName(surfaceTheme)}>Workspace root</Label>
                    <div className="mt-2 flex gap-2">
                      <Input
                        value={workspaceRootDraft}
                        onChange={(event) => onWorkspaceRootDraftChange(event.target.value)}
                        placeholder="~/Documents/AgentOS"
                        className={inputClassName(surfaceTheme)}
                      />
                      <button
                        type="button"
                        aria-label="Copy workspace root"
                        onClick={() => copyToClipboard(workspaceRootDraft || snapshot.diagnostics.workspaceRoot)}
                        className={copyButtonClassName(surfaceTheme)}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      onClick={() => void onSaveWorkspaceRootSettings(workspaceRootDraft.trim() || null)}
                      disabled={isSavingWorkspaceRoot}
                      className="h-9 rounded-full bg-emerald-600 text-xs text-white hover:bg-emerald-500"
                    >
                      {isSavingWorkspaceRoot ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      Save
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void onSaveWorkspaceRootSettings(null)}
                      disabled={isSavingWorkspaceRoot}
                      className={secondaryButtonClassName(surfaceTheme)}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Reset
                    </Button>
                  </div>
                  <div
                    className={cn(
                      "mt-4 rounded-[18px] p-3.5",
                      surfaceTheme === "light"
                        ? "border border-[#eadbcf] bg-[#fbf4ec]/78"
                        : "border border-white/[0.08] bg-[#101a2a]/92"
                    )}
                  >
                    <p className={labelClassName(surfaceTheme)}>Current root</p>
                    <p className={cn("mt-2 break-all text-sm", surfaceTheme === "light" ? "text-[#4f3e34]" : "text-slate-200")}>
                      {shortPath(snapshot.diagnostics.workspaceRoot, 56)}
                    </p>
                  </div>
                </Card>
              </section>
              ) : null}

              {activeSection === "diagnostics" ? (
              <section id="diagnostics" className="scroll-mt-24">
                <Card
                  title="Diagnostics"
                  icon={TerminalSquare}
                  surfaceTheme={surfaceTheme}
                  action={
                    <span
                      className={cn(
                        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs",
                        surfaceTheme === "light"
                          ? "border-[#e2d1c4] bg-white text-[#7b6353]"
                          : "border-white/[0.08] bg-[#101a2a]/92 text-slate-300"
                      )}
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      {commandStats.ok} OK
                      {commandStats.failed ? <span className="text-red-600">{commandStats.failed} failed</span> : null}
                    </span>
                  }
                >
                  <div className="space-y-2">
                    {latestCommands.length ? (
                      latestCommands.map((command) => (
                        <details
                          key={command.id}
                          className={cn(
                            "group rounded-[16px] border",
                            surfaceTheme === "light"
                              ? "border-[#e7d8ca] bg-[#fffdf9]"
                              : "border-white/[0.08] bg-[#101a2a]/92"
                          )}
                        >
                          <summary className="flex cursor-pointer list-none items-center gap-3 px-3.5 py-2.5">
                            <code className={cn("min-w-0 flex-1 truncate font-mono text-[11px]", surfaceTheme === "light" ? "text-[#3b2d24]" : "text-slate-200")}>
                              {command.command} {command.args.join(" ")}
                            </code>
                            <span
                              className={cn(
                                "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] uppercase tracking-[0.12em]",
                                command.status === "ok"
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border-red-200 bg-red-50 text-red-700"
                              )}
                            >
                              {command.status}
                            </span>
                            <span className={cn("hidden text-xs sm:inline", surfaceTheme === "light" ? "text-[#9a8271]" : "text-slate-400")}>
                              {command.durationMs} ms
                            </span>
                            <ChevronDown className={cn("h-4 w-4 transition-transform group-open:rotate-180", surfaceTheme === "light" ? "text-[#9a8271]" : "text-slate-400")} />
                          </summary>
                          <div
                            className={cn(
                              "border-t p-3.5",
                              surfaceTheme === "light" ? "border-[#eadbcf]" : "border-white/[0.08]"
                            )}
                          >
                            <div className="grid gap-3 sm:grid-cols-2">
                              <DiagnosticBlock title="stdout" value={command.stdoutPreview} surfaceTheme={surfaceTheme} />
                              <DiagnosticBlock title="stderr" value={command.stderrPreview} surfaceTheme={surfaceTheme} />
                            </div>
                            <p className={cn("mt-3 text-xs", surfaceTheme === "light" ? "text-[#8a7464]" : "text-slate-400")}>
                              Exit code: {command.exitCode ?? "n/a"} | Started: {formatTimestamp(command.startedAt)}
                            </p>
                          </div>
                        </details>
                      ))
                    ) : (
                      <EmptyState
                        title="No recent CLI calls"
                        detail="Diagnostics will appear after AgentOS uses fallback commands."
                        surfaceTheme={surfaceTheme}
                      />
                    )}
                  </div>
                </Card>
              </section>
              ) : null}

              {activeSection === "agents" ? (
              <section id="agents" className="scroll-mt-24">
                <Card title="Agents" icon={Bot} surfaceTheme={surfaceTheme}>
                  <InfoRows
                    surfaceTheme={surfaceTheme}
                    rows={[
                      ["Agents", String(snapshot.agents.length)],
                      ["Workspaces", String(snapshot.workspaces.length)],
                      ["Active runtimes", String(snapshot.runtimes.filter((runtime) => runtime.status === "running").length)]
                    ]}
                  />
                  <Button
                    asChild
                    variant="secondary"
                    className={cn(secondaryButtonClassName(surfaceTheme), "mt-4 w-full")}
                  >
                    <Link href="/">Open mission control</Link>
                  </Button>
                </Card>
              </section>
              ) : null}

              {activeSection === "advanced" ? (
              <section id="advanced" className="scroll-mt-24">
                <Card title="Advanced" icon={Settings2} surfaceTheme={surfaceTheme}>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Metric
                      label="Install method"
                      value={snapshot.diagnostics.updateInstallKind || installSummary.label || "Unknown"}
                      surfaceTheme={surfaceTheme}
                    />
                    <Metric
                      label="Updater"
                      value={snapshot.diagnostics.updatePackageManager || "Unknown"}
                      surfaceTheme={surfaceTheme}
                    />
                    <Metric
                      label="Last checked"
                      value={lastCheckedAt ? new Date(lastCheckedAt).toLocaleTimeString() : "Not checked"}
                      surfaceTheme={surfaceTheme}
                    />
                  </div>
                  <div
                    className={cn(
                      "mt-4 rounded-[18px] p-3.5",
                      surfaceTheme === "light"
                        ? "border border-[#eadbcf] bg-[#fbf4ec]/78"
                        : "border border-white/[0.08] bg-[#101a2a]/92"
                    )}
                  >
                    <p className={labelClassName(surfaceTheme)}>Install root</p>
                    <p className={cn("mt-2 break-all text-sm", surfaceTheme === "light" ? "text-[#4f3e34]" : "text-slate-200")}>
                      {shortPath(snapshot.diagnostics.updateRoot || installSummary.root || "Not detected", 80)}
                    </p>
                  </div>
                </Card>
              </section>
              ) : null}

              {activeSection === "danger-zone" ? (
              <section id="danger-zone" className="scroll-mt-24">
                <div
                  className={cn(
                    "rounded-[22px] p-4 shadow-[0_18px_44px_rgba(185,28,28,0.06)]",
                    surfaceTheme === "light"
                      ? "border border-red-200 bg-red-50/58"
                      : "border border-rose-400/20 bg-rose-500/[0.08]"
                  )}
                >
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-start gap-3">
                      <span
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border",
                          surfaceTheme === "light"
                            ? "border-red-200 bg-white text-red-600"
                            : "border-rose-300/20 bg-rose-400/10 text-rose-200"
                        )}
                      >
                        <AlertTriangle className="h-4 w-4" />
                      </span>
                      <div>
                        <h2 className={cn("font-display text-lg", surfaceTheme === "light" ? "text-red-700" : "text-rose-100")}>
                          Danger Zone
                        </h2>
                        <p className={cn("mt-1.5 max-w-2xl text-sm leading-6", surfaceTheme === "light" ? "text-red-700/72" : "text-rose-100/80")}>
                          These actions are destructive and cannot be undone. Confirmation is required before anything runs.
                        </p>
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 md:min-w-[340px]">
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={() => onOpenResetDialog("mission-control")}
                        className="h-9 rounded-full bg-red-600 text-xs text-white hover:bg-red-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Reset AgentOS
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => onOpenResetDialog("full-uninstall")}
                        className={cn(
                          "h-9 rounded-full text-xs",
                          surfaceTheme === "light"
                            ? "border-red-200 bg-white text-red-700 hover:bg-red-50"
                            : "border-rose-300/20 bg-[#121d2d] text-rose-100 hover:bg-[#182538]"
                        )}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Full uninstall
                      </Button>
                    </div>
                  </div>
                </div>
              </section>
              ) : null}
            </div>
          </div>
        </section>
    </main>
  );
}

function Card({
  title,
  icon: Icon,
  children,
  action,
  surfaceTheme
}: {
  title: string;
  icon: LucideIcon;
  children: ReactNode;
  action?: ReactNode;
  surfaceTheme: SurfaceTheme;
}) {
  return (
    <div
      className={cn(
        "min-h-full rounded-[22px] p-4 shadow-[0_20px_54px_rgba(101,74,54,0.07)] backdrop-blur-xl",
        cardClassName(surfaceTheme)
      )}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className={cardIconClassName(surfaceTheme)}>
            <Icon className="h-4 w-4" />
          </span>
          <h2 className={cn("font-display text-lg", surfaceTheme === "light" ? "text-[#2d211b]" : "text-slate-100")}>
            {title}
          </h2>
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function Metric({
  label,
  value,
  badge,
  surfaceTheme,
  dark = false,
  compact = false
}: {
  label: string;
  value: string;
  badge?: string;
  surfaceTheme: SurfaceTheme;
  dark?: boolean;
  compact?: boolean;
}) {
  const cardToneIsDark = dark || surfaceTheme === "dark";
  return (
    <div>
      <p className={cn("text-[11px]", cardToneIsDark ? "text-white/54" : "text-[#8a7464]")}>{label}</p>
      <div className="mt-1.5 flex items-center gap-2">
        <p
          className={cn(
            "min-w-0 truncate font-medium",
            compact ? "text-sm" : "text-[1.05rem]",
            cardToneIsDark ? "text-white" : "text-[#2f251f]"
          )}
          title={value}
        >
          {value}
        </p>
        {badge ? (
          <span
            className={cn(
              "shrink-0 rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.12em]",
              cardToneIsDark
                ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
            )}
          >
            {badge}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function InfoRows({
  rows,
  successIndex,
  surfaceTheme
}: {
  rows: Array<[string, string]>;
  successIndex?: number;
  surfaceTheme: SurfaceTheme;
}) {
  const cardToneIsDark = surfaceTheme === "dark";
  return (
    <div className={cn("overflow-hidden rounded-[18px] border", infoRowsShellClassName(surfaceTheme))}>
      {rows.map(([label, value], index) => (
        <div key={label} className={cn("flex items-center justify-between gap-3 px-3.5 py-2.5 last:border-b-0", infoRowBorderClassName(surfaceTheme))}>
          <span className={cn("text-sm", cardToneIsDark ? "text-slate-400" : "text-[#8a7464]")}>{label}</span>
          <span
            className={cn(
              "min-w-0 truncate text-right text-sm",
              cardToneIsDark ? "text-slate-100" : "text-[#352820]",
              successIndex === index
                ? cardToneIsDark
                  ? "rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2 py-1 text-xs text-emerald-100"
                  : "rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-700"
                : ""
            )}
            title={value}
          >
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

function DiagnosticBlock({
  title,
  value,
  surfaceTheme
}: {
  title: string;
  value: string | null;
  surfaceTheme: SurfaceTheme;
}) {
  const cardToneIsDark = surfaceTheme === "dark";
  return (
    <div>
      <p className={labelClassName(surfaceTheme)}>{title}</p>
      <pre
        className={cn(
          "mt-2 max-h-40 overflow-auto rounded-[14px] border p-3 text-xs",
          cardToneIsDark
            ? "border-white/[0.08] bg-[#0d1624]/92 text-slate-200"
            : "border-[#eadbcf] bg-[#fbf4ec] text-[#4b3a30]"
        )}
      >
        {value || "No output"}
      </pre>
    </div>
  );
}

function EmptyState({
  title,
  detail,
  surfaceTheme
}: {
  title: string;
  detail: string;
  surfaceTheme: SurfaceTheme;
}) {
  return (
    <div
      className={cn(
        "rounded-[18px] border border-dashed p-4 text-center",
        surfaceTheme === "light"
          ? "border-[#decfc2] bg-[#fbf4ec]/60"
          : "border-white/[0.08] bg-[#0d1624]/60"
      )}
    >
      <p className={cn("text-sm font-medium", surfaceTheme === "light" ? "text-[#5f493b]" : "text-slate-100")}>
        {title}
      </p>
      <p className={cn("mt-1 text-xs", surfaceTheme === "light" ? "text-[#8a7464]" : "text-slate-400")}>{detail}</p>
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

function resolveGatewayLocality(snapshot: MissionControlShellSettingsPanelProps["snapshot"]) {
  return snapshot.diagnostics.bindMode === "remote" || snapshot.diagnostics.configuredGatewayUrl
    ? "Remote"
    : "Local";
}

function formatGatewayAuthIssue(kind: GatewayNativeAuthStatus["native"]["kind"]) {
  switch (kind) {
    case "auth":
      return "Needs credential";
    case "scope-limited":
      return "Needs scope repair";
    case "disabled":
      return "Disabled";
    case "unreachable":
      return "Unreachable";
    case "timeout":
      return "Timed out";
    case "malformed-response":
      return "Invalid response";
    default:
      return "Check failed";
  }
}

function deriveProviderFromModel(modelId: string | null) {
  if (!modelId) {
    return null;
  }

  const [provider] = modelId.split("/");
  return provider || null;
}

function shortPath(value: string, maxLength: number) {
  const compacted = compactPath(value);
  if (compacted.length <= maxLength) {
    return compacted;
  }

  return `${compacted.slice(0, Math.max(0, maxLength - 3))}...`;
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function copyToClipboard(value: string) {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    return;
  }

  void navigator.clipboard.writeText(value);
}

function resolveInitialSettingsSection(): SettingsSectionId {
  if (typeof window === "undefined") {
    return "openclaw";
  }

  switch (window.location.hash.replace(/^#/, "")) {
    case "gateway":
      return "gateway";
    case "models":
      return "models";
    case "workspace":
      return "workspace";
    case "agents":
      return "agents";
    case "diagnostics":
      return "diagnostics";
    case "advanced":
      return "advanced";
    case "danger-zone":
      return "danger-zone";
    case "openclaw":
    default:
      return "openclaw";
  }
}

function cardClassName(surfaceTheme: SurfaceTheme) {
  return surfaceTheme === "light"
    ? "border-[#dfd0c2]/90 bg-[#fffaf3]/80 text-[#2d211b]"
    : "border-white/[0.08] bg-[#0d1624]/96 text-slate-100 shadow-[0_20px_54px_rgba(0,0,0,0.26)]";
}

function cardIconClassName(surfaceTheme: SurfaceTheme) {
  return surfaceTheme === "light"
    ? "flex h-10 w-10 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700"
    : "flex h-10 w-10 items-center justify-center rounded-full border border-cyan-300/15 bg-cyan-300/10 text-cyan-200";
}

function labelClassName(surfaceTheme: SurfaceTheme) {
  return cn("text-[10px] uppercase tracking-[0.18em]", surfaceTheme === "light" ? "text-[#9a8271]" : "text-slate-400");
}

function inputClassName(surfaceTheme: SurfaceTheme, extraClassName?: string) {
  return cn(
    "h-10 rounded-[16px] px-3 text-sm outline-none",
    extraClassName,
    surfaceTheme === "light"
      ? "border-[#e2d1c4] bg-[#fffdf9] text-[#2d211b] placeholder:text-[#ad9889]"
      : "border-white/10 bg-[#0f1826] text-slate-100 placeholder:text-slate-500"
  );
}

function copyButtonClassName(surfaceTheme: SurfaceTheme) {
  return cn(
    "flex h-10 w-10 shrink-0 items-center justify-center rounded-[16px] border",
    surfaceTheme === "light"
      ? "border-[#e2d1c4] bg-white text-[#7b6353]"
      : "border-white/10 bg-[#121d2d] text-slate-200 hover:bg-[#182538]"
  );
}

function secondaryButtonClassName(surfaceTheme: SurfaceTheme, extraClassName?: string, mode?: "default" | "gateway-contrast") {
  return cn(
    "h-9 rounded-full px-3 text-xs",
    extraClassName,
    surfaceTheme === "light"
      ? "border-[#d7c4b6] bg-white text-[#6b5546] hover:bg-[#f4e9de]"
      : mode === "gateway-contrast"
        ? "border-emerald-300/15 bg-[#0f1826] text-slate-100 hover:bg-[#182538]"
        : "border-white/10 bg-[#121d2d] text-slate-200 hover:bg-[#182538]"
  );
}

function infoRowsShellClassName(surfaceTheme: SurfaceTheme) {
  return surfaceTheme === "light"
    ? "border-[#eadbcf] bg-[#fffdf9]"
    : "border-white/[0.08] bg-[#0f1826]";
}

function infoRowBorderClassName(surfaceTheme: SurfaceTheme) {
  return surfaceTheme === "light" ? "border-b border-[#eadbcf]" : "border-b border-white/[0.08]";
}
