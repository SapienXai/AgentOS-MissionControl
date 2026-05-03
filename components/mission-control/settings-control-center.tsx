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

export function SettingsControlCenter(props: MissionControlShellSettingsPanelProps) {
  const {
    snapshot,
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
    <main className="relative z-10 min-h-screen text-[#2c211a]">
        <section className="min-w-0 px-4 pb-8 pt-[86px] sm:px-6 lg:ml-[384px] lg:mr-[84px] lg:px-7 xl:px-8">
          <div className="mx-auto max-w-[1160px] 2xl:max-w-[1240px]">
            <div className="flex flex-col gap-2">
              <Link
                href="/"
                className="mb-2 inline-flex w-fit items-center gap-2 rounded-full border border-[#decfc2] bg-[#fffaf3]/86 px-3 py-2 text-xs text-[#6f5a4b] shadow-[0_12px_28px_rgba(91,63,43,0.08)] lg:hidden"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Mission Control
              </Link>
              <p className="text-[9px] uppercase tracking-[0.24em] text-[#9a8271]">AgentOS</p>
              <h1 className="font-display text-[2rem] leading-tight text-[#2b211c] sm:text-[2.35rem]">
                Settings / Control Center
              </h1>
              <p className="max-w-2xl text-[0.84rem] leading-6 text-[#7e6858]">
                Manage system, models, gateway, workspace, and diagnostics.
              </p>
            </div>

            <div id="general" className="mt-5 grid gap-4 xl:grid-cols-12">
              <section id="openclaw" className="scroll-mt-24 xl:col-span-4">
                <div className="panel-surface panel-glow min-h-full overflow-hidden rounded-[22px] border-white/[0.08] bg-[linear-gradient(180deg,rgba(12,19,32,0.98),rgba(6,10,18,0.97))] p-4 text-white">
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-emerald-200">
                      <Activity className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 className="font-display text-lg">OpenClaw</h2>
                      <p className="mt-0.5 text-xs leading-5 text-white/54">Source of truth for runtime and control state.</p>
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <Metric label="Current version" value={`v${snapshot.diagnostics.version || "unknown"}`} dark />
                    <Metric
                      label="Latest available"
                      value={snapshot.diagnostics.latestVersion ? `v${snapshot.diagnostics.latestVersion}` : "Unknown"}
                      badge={hasUpdateAvailable ? "Update" : "Stable"}
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
                      className="h-9 rounded-full border-white/10 bg-white/[0.04] px-4 text-xs text-white hover:bg-white/[0.08]"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Check
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => onOpenSetupWizard()}
                      className="h-9 rounded-full border-white/10 bg-white/[0.04] px-4 text-xs text-white hover:bg-white/[0.08]"
                    >
                      <Wrench className="h-3.5 w-3.5" />
                      Open wizard
                    </Button>
                  </div>

                  <div className="mt-5 grid gap-3 border-t border-white/10 pt-4 sm:grid-cols-2">
                    <Metric label="Detected install" value={installSummary.label || "Unknown"} dark compact />
                    <Metric
                      label="Resolved path"
                      value={shortPath(openClawBinarySelection.resolvedPath || "openclaw", 26)}
                      dark
                      compact
                    />
                  </div>

                  <div className="mt-4 rounded-[18px] border border-white/10 bg-white/[0.035] p-3.5">
                    <Label className="text-[10px] text-white/56">OpenClaw binary mode</Label>
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
                              : "border-white/10 bg-white/[0.03] text-white/70 hover:bg-white/[0.08]"
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
                        className="mt-3 h-10 rounded-[16px] border-white/12 bg-black/20 text-white placeholder:text-white/34"
                      />
                    ) : null}
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void onSaveOpenClawBinarySettings(openClawBinarySelection)}
                      disabled={isSavingOpenClawBinary}
                      className="mt-3 h-9 w-full rounded-full border-white/10 bg-white/[0.04] text-xs text-white hover:bg-white/[0.08]"
                    >
                      {isSavingOpenClawBinary ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      Save selection
                    </Button>
                  </div>
                </div>
              </section>

              <section id="gateway" className="scroll-mt-24 xl:col-span-4">
                <Card title="Gateway" icon={ShieldCheck}>
                  <InfoRows
                    rows={[
                      ["Status", `${resolveGatewayLocality(snapshot)} / ${snapshot.diagnostics.loaded || snapshot.diagnostics.rpcOk ? "Online" : "Offline"}`],
                      ["Endpoint", snapshot.diagnostics.gatewayUrl || "Not configured"],
                      ["Auth status", nativeAuthLabel]
                    ]}
                    successIndex={2}
                  />

                  <div className="mt-4 space-y-3">
                    <div>
                      <Label className="text-[10px] text-[#8a7464]">Gateway endpoint</Label>
                      <Input
                        value={gatewayDraft}
                        onChange={(event) => onGatewayDraftChange(event.target.value)}
                        placeholder="ws://127.0.0.1:18789"
                        className="mt-2 h-10 rounded-[16px] border-[#e2d1c4] bg-[#fffdf9] text-sm text-[#2d211b] placeholder:text-[#ad9889]"
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
                        className={lightSecondaryButtonClassName()}
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
                        className={cn(lightSecondaryButtonClassName(), "capitalize")}
                      >
                        {gatewayControlAction === action ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
                        {action}
                      </Button>
                    ))}
                  </div>

                  <div className="mt-4 rounded-[18px] border border-emerald-200 bg-emerald-50/55 p-3.5">
                    <div className="flex items-start gap-3">
                      <KeyRound className="mt-0.5 h-4 w-4 text-emerald-700" />
                      <div>
                        <p className="text-sm font-medium text-[#2f624b]">Native Gateway auth</p>
                        <p className="mt-1 text-xs leading-5 text-[#6f836f]">
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
                        className="h-9 rounded-full border-emerald-200 bg-white px-3 text-xs text-[#2f624b] hover:bg-emerald-50"
                      >
                        {isRepairingGatewayDeviceAccess ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}
                        Repair local access
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void generateGatewayAuthToken()}
                        disabled={isGeneratingGatewayAuthToken}
                        className="h-9 rounded-full border-emerald-200 bg-white px-3 text-xs text-[#2f624b] hover:bg-emerald-50"
                      >
                        {isGeneratingGatewayAuthToken ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                        Generate token
                      </Button>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-[112px_1fr]">
                      <select
                        value={gatewayAuthCredentialKind}
                        onChange={(event) => setGatewayAuthCredentialKind(event.target.value as GatewayNativeAuthCredentialKind)}
                        className="h-10 rounded-[16px] border border-emerald-200 bg-white px-3 text-sm text-[#315f49] outline-none"
                      >
                        <option value="token">Token</option>
                        <option value="password">Password</option>
                      </select>
                      <Input
                        type="password"
                        value={gatewayAuthCredential}
                        onChange={(event) => setGatewayAuthCredential(event.target.value)}
                        placeholder="Paste known credential"
                        className="h-10 rounded-[16px] border-emerald-200 bg-white text-sm text-[#2d211b] placeholder:text-[#91a090]"
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
                        className="h-9 rounded-full border-emerald-200 bg-white text-xs text-[#2f624b] hover:bg-emerald-50"
                      >
                        {isCheckingGatewayAuth ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        Test auth
                      </Button>
                    </div>
                    {gatewayAuthError || gatewayAuthSaveMessage || gatewayAuthStatus?.native.issue ? (
                      <p className={cn("mt-3 text-xs leading-5", gatewayAuthError ? "text-red-700" : "text-[#52735e]")}>
                        {gatewayAuthError || gatewayAuthSaveMessage || gatewayAuthStatus?.native.issue}
                      </p>
                    ) : null}
                  </div>
                </Card>
              </section>

              <section id="models" className="scroll-mt-24 xl:col-span-4">
                <Card title="Models" icon={Box}>
                  <InfoRows
                    rows={[
                      ["Default model", defaultModel || "Not selected"],
                      ["Provider", modelProvider],
                      ["Available", `${snapshot.diagnostics.modelReadiness.availableModelCount} of ${snapshot.diagnostics.modelReadiness.totalModelCount}`]
                    ]}
                  />
                  <div className="mt-4">
                    <Label className="text-[10px] text-[#8a7464]">Model</Label>
                    <select
                      value={selectedOrDefaultModelId}
                      onChange={(event) => onSelectedModelIdChange(event.target.value)}
                      className="mt-2 h-10 w-full rounded-[16px] border border-[#e2d1c4] bg-[#fffdf9] px-3 text-sm text-[#2d211b] outline-none focus:ring-2 focus:ring-emerald-300"
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
                      className={lightSecondaryButtonClassName()}
                    >
                      Add models
                    </Button>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void onRunModelRefresh()}
                    disabled={modelOnboardingRunState === "running"}
                    className={cn(lightSecondaryButtonClassName(), "mt-3 w-full")}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Refresh models
                  </Button>
                </Card>
              </section>

              <section id="workspace" className="scroll-mt-24 xl:col-span-4">
                <Card title="Workspace" icon={Folder}>
                  <div>
                    <Label className="text-[10px] text-[#8a7464]">Workspace root</Label>
                    <div className="mt-2 flex gap-2">
                      <Input
                        value={workspaceRootDraft}
                        onChange={(event) => onWorkspaceRootDraftChange(event.target.value)}
                        placeholder="~/Documents/AgentOS"
                        className="h-10 rounded-[16px] border-[#e2d1c4] bg-[#fffdf9] text-sm text-[#2d211b] placeholder:text-[#ad9889]"
                      />
                      <button
                        type="button"
                        aria-label="Copy workspace root"
                        onClick={() => copyToClipboard(workspaceRootDraft || snapshot.diagnostics.workspaceRoot)}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[16px] border border-[#e2d1c4] bg-white text-[#7b6353]"
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
                      className={lightSecondaryButtonClassName()}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Reset
                    </Button>
                  </div>
                  <div className="mt-4 rounded-[18px] border border-[#eadbcf] bg-[#fbf4ec]/78 p-3.5">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-[#9a8271]">Current root</p>
                    <p className="mt-2 break-all text-sm text-[#4f3e34]">
                      {shortPath(snapshot.diagnostics.workspaceRoot, 56)}
                    </p>
                  </div>
                </Card>
              </section>

              <section id="diagnostics" className="scroll-mt-24 xl:col-span-8">
                <Card
                  title="Diagnostics"
                  icon={TerminalSquare}
                  action={
                    <span className="inline-flex items-center gap-2 rounded-full border border-[#e2d1c4] bg-white px-3 py-1.5 text-xs text-[#7b6353]">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      {commandStats.ok} OK
                      {commandStats.failed ? <span className="text-red-600">{commandStats.failed} failed</span> : null}
                    </span>
                  }
                >
                  <div className="space-y-2">
                    {latestCommands.length ? (
                      latestCommands.map((command) => (
                        <details key={command.id} className="group rounded-[16px] border border-[#e7d8ca] bg-[#fffdf9]">
                          <summary className="flex cursor-pointer list-none items-center gap-3 px-3.5 py-2.5">
                            <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-[#3b2d24]">
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
                            <span className="hidden text-xs text-[#9a8271] sm:inline">{command.durationMs} ms</span>
                            <ChevronDown className="h-4 w-4 text-[#9a8271] transition-transform group-open:rotate-180" />
                          </summary>
                          <div className="border-t border-[#eadbcf] p-3.5">
                            <div className="grid gap-3 sm:grid-cols-2">
                              <DiagnosticBlock title="stdout" value={command.stdoutPreview} />
                              <DiagnosticBlock title="stderr" value={command.stderrPreview} />
                            </div>
                            <p className="mt-3 text-xs text-[#8a7464]">
                              Exit code: {command.exitCode ?? "n/a"} | Started: {formatTimestamp(command.startedAt)}
                            </p>
                          </div>
                        </details>
                      ))
                    ) : (
                      <EmptyState title="No recent CLI calls" detail="Diagnostics will appear after AgentOS uses fallback commands." />
                    )}
                  </div>
                </Card>
              </section>

              <section id="agents" className="scroll-mt-24 xl:col-span-4">
                <Card title="Agents" icon={Bot}>
                  <InfoRows
                    rows={[
                      ["Agents", String(snapshot.agents.length)],
                      ["Workspaces", String(snapshot.workspaces.length)],
                      ["Active runtimes", String(snapshot.runtimes.filter((runtime) => runtime.status === "running").length)]
                    ]}
                  />
                  <Button
                    asChild
                    variant="secondary"
                    className={cn(lightSecondaryButtonClassName(), "mt-4 w-full")}
                  >
                    <Link href="/">Open mission control</Link>
                  </Button>
                </Card>
              </section>

              <section id="advanced" className="scroll-mt-24 xl:col-span-8">
                <Card title="Advanced" icon={Settings2}>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Metric label="Install method" value={snapshot.diagnostics.updateInstallKind || installSummary.label || "Unknown"} />
                    <Metric label="Updater" value={snapshot.diagnostics.updatePackageManager || "Unknown"} />
                    <Metric label="Last checked" value={lastCheckedAt ? new Date(lastCheckedAt).toLocaleTimeString() : "Not checked"} />
                  </div>
                  <div className="mt-4 rounded-[18px] border border-[#eadbcf] bg-[#fbf4ec]/78 p-3.5">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-[#9a8271]">Install root</p>
                    <p className="mt-2 break-all text-sm text-[#4f3e34]">
                      {shortPath(snapshot.diagnostics.updateRoot || installSummary.root || "Not detected", 80)}
                    </p>
                  </div>
                </Card>
              </section>

              <section id="danger-zone" className="scroll-mt-24 xl:col-span-12">
                <div className="rounded-[22px] border border-red-200 bg-red-50/58 p-4 shadow-[0_18px_44px_rgba(185,28,28,0.06)]">
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-start gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-red-200 bg-white text-red-600">
                        <AlertTriangle className="h-4 w-4" />
                      </span>
                      <div>
                        <h2 className="font-display text-lg text-red-700">Danger Zone</h2>
                        <p className="mt-1.5 max-w-2xl text-sm leading-6 text-red-700/72">
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
                        className="h-9 rounded-full border-red-200 bg-white text-xs text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Full uninstall
                      </Button>
                    </div>
                  </div>
                </div>
              </section>
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
  action
}: {
  title: string;
  icon: LucideIcon;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="min-h-full rounded-[22px] border border-[#dfd0c2]/90 bg-[#fffaf3]/80 p-4 shadow-[0_20px_54px_rgba(101,74,54,0.07)] backdrop-blur-xl">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700">
            <Icon className="h-4 w-4" />
          </span>
          <h2 className="font-display text-lg text-[#2d211b]">{title}</h2>
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
  dark = false,
  compact = false
}: {
  label: string;
  value: string;
  badge?: string;
  dark?: boolean;
  compact?: boolean;
}) {
  return (
    <div>
      <p className={cn("text-[11px]", dark ? "text-white/54" : "text-[#8a7464]")}>{label}</p>
      <div className="mt-1.5 flex items-center gap-2">
        <p
          className={cn(
            "min-w-0 truncate font-medium",
            compact ? "text-sm" : "text-[1.05rem]",
            dark ? "text-white" : "text-[#2f251f]"
          )}
          title={value}
        >
          {value}
        </p>
        {badge ? (
          <span
            className={cn(
              "shrink-0 rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.12em]",
              dark ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100" : "border-emerald-200 bg-emerald-50 text-emerald-700"
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
  successIndex
}: {
  rows: Array<[string, string]>;
  successIndex?: number;
}) {
  return (
    <div className="overflow-hidden rounded-[18px] border border-[#eadbcf] bg-[#fffdf9]">
      {rows.map(([label, value], index) => (
        <div key={label} className="flex items-center justify-between gap-3 border-b border-[#eadbcf] px-3.5 py-2.5 last:border-b-0">
          <span className="text-sm text-[#8a7464]">{label}</span>
          <span
            className={cn(
              "min-w-0 truncate text-right text-sm text-[#352820]",
              successIndex === index ? "rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-700" : ""
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

function DiagnosticBlock({ title, value }: { title: string; value: string | null }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.18em] text-[#9a8271]">{title}</p>
      <pre className="mt-2 max-h-40 overflow-auto rounded-[14px] border border-[#eadbcf] bg-[#fbf4ec] p-3 text-xs text-[#4b3a30]">
        {value || "No output"}
      </pre>
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-[18px] border border-dashed border-[#decfc2] bg-[#fbf4ec]/60 p-4 text-center">
      <p className="text-sm font-medium text-[#5f493b]">{title}</p>
      <p className="mt-1 text-xs text-[#8a7464]">{detail}</p>
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

function lightSecondaryButtonClassName() {
  return "h-9 rounded-full border-[#d7c4b6] bg-white px-3 text-xs text-[#6b5546] hover:bg-[#f4e9de]";
}
