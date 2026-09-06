"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  Bot,
  Box,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Database,
  Download,
  Folder,
  HelpCircle,
  KeyRound,
  Layers,
  ListChecks,
  LoaderCircle,
  Microscope,
  OctagonAlert,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  ShieldCheck,
  SquareTerminal,
  Star,
  Target,
  TerminalSquare,
  Trash2,
  TriangleAlert,
  Wrench,
  XCircle
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { MissionControlShellSettingsPanelProps } from "@/components/mission-control/mission-control-shell.settings";
import {
  buildOpenClawCapabilityRows,
  formatGatewayFallbackDiagnosticKind,
  resolveGatewayActionGuidance,
  resolveTransportDiagnosticsSummary,
  resolveGatewayFallbackRecovery,
  summarizeOpenClawCapabilityRows,
  type GatewayActionGuidance,
  type OpenClawCapabilityMatrixRow,
  type OpenClawCapabilityMatrixSummary,
  type TransportDiagnosticsSummary,
  type TransportStatusTone
} from "@/components/mission-control/settings-control-center.utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PikoLoader } from "@/components/ui/piko-loader";
import { GatewayProductSurfacePanel } from "@/components/mission-control/gateway-surface-panel";
import { NativeDoctorPanel } from "@/components/mission-control/native-doctor-panel";
import { OpenClawAppConnectDialog } from "@/components/mission-control/openclaw-app-connect-dialog";
import {
  RuntimeGatewayInlineWarning,
  RuntimeInboxPanel
} from "@/components/runtime/runtime-inbox";
import type { OpenClawGatewayProductSurfaceSnapshot as GatewayProductSurfaceSnapshot } from "@/lib/openclaw/application/gateway-surface-types";
import type {
  GatewayNativeAuthCredentialKind,
  GatewayNativeAuthStatus
} from "@/lib/openclaw/gateway-auth";
import { compactPath } from "@/lib/openclaw/presenters";
import { OPENCLAW_SUPPORTED_BASELINE_VERSION } from "@/lib/openclaw/versions";
import type {
  OpenClawCapabilityDiffReport,
  OpenClawCertificationScorecardReport,
  OpenClawShadowProbeReport,
  OpenClawUpdateCompatibilityMode,
  OpenClawUpdateDecision,
  OpenClawUpdateSafetyReport
} from "@/lib/openclaw/types";
import { OPENCLAW_DEFAULT_GATEWAY_BIND_MODE } from "@/lib/openclaw/gateway-defaults";
import type {
  OpenClawCodexFixBundle,
  OpenClawCompatibilityCertificationPromotion,
  OpenClawCompatibilityLabReport
} from "@/lib/openclaw/compatibility-lab/types";
import {
  buildAgentOsOpenClawContractComparison,
  filterAgentOsOpenClawContractRows,
  type AgentOsOpenClawContractComparison
} from "@/lib/openclaw/contracts/contract-diff-service";
import type { AgentOsOpenClawContractComparisonFilter } from "@/lib/openclaw/contracts/types";
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
type CompatibilitySmokeReport = NonNullable<
  MissionControlShellSettingsPanelProps["snapshot"]["diagnostics"]["compatibilitySmokeTest"]
>;
type CompatibilityReport = NonNullable<
  MissionControlShellSettingsPanelProps["snapshot"]["diagnostics"]["compatibilityReport"]
>;
type GatewayControlAction = NonNullable<MissionControlShellSettingsPanelProps["gatewayControlAction"]>;
type GatewayOperationKind = GatewayControlAction | "repair-access" | "repair-token";
type GatewayOperationFeedback = {
  kind: GatewayOperationKind;
  status: "running" | "success" | "error";
  startedAt: string;
  finishedAt: string | null;
  message: string;
};
type ToolSettingId = "browser" | "web-fetch" | "web-search";
type ToolSettingsSaveState = "idle" | "saving" | "saved" | "error";
type SettingsSectionId =
  | "general"
  | "overview"
  | "openclaw"
  | "gateway"
  | "capabilities"
  | "models"
  | "workspace"
  | "agents"
  | "diagnostics"
  | "advanced"
  | "danger-zone";

type SettingsSection = {
  id: SettingsSectionId;
  label: string;
  icon: LucideIcon;
  group: "Core" | "OpenClaw" | "Workspace" | "System";
  destructive?: boolean;
};

const settingsSections: SettingsSection[] = [
  { id: "overview", label: "Overview", icon: Settings2, group: "Core" },
  { id: "general", label: "General", icon: Wrench, group: "Core" },
  { id: "openclaw", label: "OpenClaw", icon: Activity, group: "OpenClaw" },
  { id: "gateway", label: "Gateway", icon: ShieldCheck, group: "OpenClaw" },
  { id: "capabilities", label: "Capabilities", icon: ListChecks, group: "OpenClaw" },
  { id: "models", label: "Models", icon: Box, group: "OpenClaw" },
  { id: "workspace", label: "Workspace", icon: Folder, group: "Workspace" },
  { id: "agents", label: "Agents", icon: Bot, group: "Workspace" },
  { id: "diagnostics", label: "Diagnostics", icon: TerminalSquare, group: "System" },
  { id: "advanced", label: "Advanced", icon: Settings2, group: "System" },
  { id: "danger-zone", label: "Danger Zone", icon: AlertTriangle, group: "System", destructive: true }
];

const settingsSectionGroups = ["Core", "OpenClaw", "Workspace", "System"] as const;

const relatedSettingsSections: Record<SettingsSectionId, SettingsSectionId[]> = {
  general: ["gateway", "capabilities", "agents"],
  overview: ["general", "openclaw", "gateway"],
  openclaw: ["gateway", "diagnostics", "advanced"],
  gateway: ["openclaw", "general", "diagnostics"],
  capabilities: ["gateway", "general", "advanced"],
  models: ["gateway", "workspace", "agents"],
  workspace: ["models", "agents", "diagnostics"],
  agents: ["workspace", "models", "diagnostics"],
  diagnostics: ["gateway", "capabilities", "advanced"],
  advanced: ["diagnostics", "openclaw", "danger-zone"],
  "danger-zone": ["advanced", "diagnostics", "openclaw"]
};

export function SettingsControlCenter(
  props: MissionControlShellSettingsPanelProps & { sidebarOpen?: boolean }
) {
  const {
    snapshot,
    surfaceTheme,
    connectionState,
    gatewayDraft,
    workspaceRootDraft,
    openClawBinarySelection,
    isSavingGateway,
    isSavingWorkspaceRoot,
    isSavingOpenClawBinary,
    isCheckingForUpdates,
    updateRunState,
    updateCapabilityDiff,
    updateCertificationScorecard,
    selectedModelId,
    modelOnboardingRunState,
    gatewayControlAction,
    lastCheckedAt,
    onGatewayDraftChange,
    onWorkspaceRootDraftChange,
    onSelectedModelIdChange,
    onSaveGatewaySettings,
    onSaveWorkspaceRootSettings,
    onControlGateway,
    onOpenSetupWizard,
    onRunModelRefresh,
    onRunModelSetDefault,
    onOpenAddModels,
    onOpenUpdateDialog,
    onRollbackOpenClaw,
    onOpenResetDialog,
    onSnapshotChange,
    onOpenClawBinarySelectionModeChange,
    onOpenClawBinarySelectionPathChange,
    onSaveOpenClawBinarySettings,
    installSummary,
    sidebarOpen = false
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
  const [gatewayOperationFeedback, setGatewayOperationFeedback] = useState<GatewayOperationFeedback | null>(null);
  const [isOpeningControlUi, setIsOpeningControlUi] = useState(false);
  const [controlUiOpenError, setControlUiOpenError] = useState<string | null>(null);
  const [isOpenClawAppConnectOpen, setIsOpenClawAppConnectOpen] = useState(false);
  const [compatibilitySmokeReport, setCompatibilitySmokeReport] = useState<CompatibilitySmokeReport | null>(
    () => snapshot.diagnostics.compatibilitySmokeTest ?? null
  );
  const [compatibilitySmokeError, setCompatibilitySmokeError] = useState<string | null>(null);
  const [isRunningCompatibilitySmoke, setIsRunningCompatibilitySmoke] = useState(false);
  const [updateSafetyReport, setUpdateSafetyReport] = useState<OpenClawUpdateSafetyReport | null>(null);
  const [shadowProbeReport, setShadowProbeReport] = useState<OpenClawShadowProbeReport | null>(null);
  const [updateSafetyError, setUpdateSafetyError] = useState<string | null>(null);
  const [isRunningUpdatePreflight, setIsRunningUpdatePreflight] = useState(false);
  const [isRunningShadowProbe, setIsRunningShadowProbe] = useState(false);
  const [compatibilityLabReport, setCompatibilityLabReport] = useState<OpenClawCompatibilityLabReport | null>(null);
  const [compatibilityLabError, setCompatibilityLabError] = useState<string | null>(null);
  const [isGeneratingCompatibilityLabReport, setIsGeneratingCompatibilityLabReport] = useState(false);
  const [codexFixBundle, setCodexFixBundle] = useState<OpenClawCodexFixBundle | null>(null);
  const [isGeneratingCodexFixBundle, setIsGeneratingCodexFixBundle] = useState(false);
  const [certificationPromotion, setCertificationPromotion] =
    useState<OpenClawCompatibilityCertificationPromotion | null>(null);
  const [isPromotingCertification, setIsPromotingCertification] = useState(false);
  const [configUpdatePacing, setConfigUpdatePacing] = useState(() => snapshot.diagnostics.configUpdatePacing);
  const [configUpdatePacingMode, setConfigUpdatePacingMode] = useState(
    () => snapshot.diagnostics.configUpdatePacing.settings.mode
  );
  const [configUpdatePacingCustomSeconds, setConfigUpdatePacingCustomSeconds] = useState(() =>
    String(Math.ceil((snapshot.diagnostics.configUpdatePacing.settings.minimumIntervalMs ?? 10_000) / 1_000))
  );
  const [configUpdatePacingError, setConfigUpdatePacingError] = useState<string | null>(null);
  const [isSavingConfigUpdatePacing, setIsSavingConfigUpdatePacing] = useState(false);
  const [configUpdatePacingTick, setConfigUpdatePacingTick] = useState(0);
  const [browserToolEnabled, setBrowserToolEnabled] = useState<boolean | null>(null);
  const [webFetchToolEnabled, setWebFetchToolEnabled] = useState<boolean | null>(null);
  const [webSearchToolEnabled, setWebSearchToolEnabled] = useState<boolean | null>(null);
  const [toolSettingsError, setToolSettingsError] = useState<string | null>(null);
  const [isLoadingToolSettings, setIsLoadingToolSettings] = useState(false);
  const [savingToolSettingId, setSavingToolSettingId] = useState<ToolSettingId | null>(null);
  const [toolSettingsSaveState, setToolSettingsSaveState] = useState<ToolSettingsSaveState>("idle");
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(() => resolveInitialSettingsSection());
  const [currentGatewayBind, setCurrentGatewayBind] = useState<string | null>(() =>
    snapshot.diagnostics.bindMode || (
      snapshot.diagnostics.configuredGatewayUrl ? null : OPENCLAW_DEFAULT_GATEWAY_BIND_MODE
    )
  );
  const [gatewayBindRefreshState, setGatewayBindRefreshState] =
    useState<"idle" | "refreshing" | "ready" | "error">("idle");
  const [settingsHashHydrated, setSettingsHashHydrated] = useState(false);
  const renderedActiveSection = settingsHashHydrated ? activeSection : resolveInitialSettingsSection();
  const displayedGatewayBind = currentGatewayBind || snapshot.diagnostics.bindMode || (
    gatewayBindRefreshState === "refreshing"
      ? "Refreshing..."
      : gatewayBindRefreshState === "error"
        ? "Unavailable"
        : "Unknown"
  );
  const updateCompatibility = snapshot.diagnostics.updateCompatibility;
  const currentVersion = snapshot.diagnostics.version || "unknown";
  const updateInfo = snapshot.diagnostics.updateInfo?.trim() || null;
  const latestVersion =
    updateCompatibility?.latestDecision?.version ??
    resolveLatestVersionFromUpdateInfo(updateInfo) ??
    snapshot.diagnostics.latestVersion ??
    null;
  const recommendedVersion = updateCompatibility?.recommendedVersion ?? null;
  const normalizedCurrentVersion = normalizeUpdateVersion(currentVersion);
  const normalizedRecommendedVersion = normalizeUpdateVersion(recommendedVersion);
  const normalizedLatestVersion = normalizeUpdateVersion(latestVersion);
  const hasCertifiedUpdateAvailable = Boolean(
    updateCompatibility?.recommendedDecision.allowed &&
      normalizedRecommendedVersion &&
      normalizedRecommendedVersion !== normalizedCurrentVersion
  );
  const hasRegistryUpdateAvailable = Boolean(
    normalizedLatestVersion &&
      normalizedLatestVersion !== normalizedCurrentVersion
  );
  const defaultUpdateTargetVersion =
    hasCertifiedUpdateAvailable && recommendedVersion
      ? recommendedVersion
      : hasRegistryUpdateAvailable && latestVersion
        ? latestVersion
        : recommendedVersion ?? latestVersion ?? undefined;
  const defaultUpdateMode =
    hasCertifiedUpdateAvailable
      ? "recommended"
      : resolveUpdateDecisionMode(updateCompatibility?.latestDecision);
  const canVerifyLatestUpdate = Boolean(
    hasRegistryUpdateAvailable &&
      latestVersion &&
      defaultUpdateMode === "advanced" &&
      updateCompatibility?.latestDecision?.status === "unknown"
  );
  const isUpdateRegistryLoading = Boolean(
    snapshot.diagnostics.version && !recommendedVersion && !snapshot.diagnostics.updateError
  );
  const updateError = snapshot.diagnostics.updateError?.trim() || null;
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
      ok: latestCommands.filter((command) => command.status === "ok").length,
      failed: latestCommands.filter((command) => command.status !== "ok").length
    }),
    [latestCommands]
  );
  const transportSummary = useMemo(
    () => resolveTransportDiagnosticsSummary(snapshot.diagnostics.transport, connectionState, snapshot.diagnostics.eventBridge),
    [connectionState, snapshot.diagnostics.eventBridge, snapshot.diagnostics.transport]
  );
  const activeRuntimeIssues = snapshot.diagnostics.runtimeIssues.filter(
    (issue) => issue.status !== "resolved" && issue.status !== "dismissed"
  );
  const hasScopeUpgradeIssue = activeRuntimeIssues.some((issue) => issue.type === "scope_upgrade_pending");
  const hasOpenClawRollbackIssue = activeRuntimeIssues.some((issue) => issue.type === "openclaw_rollback_needed");
  const isGatewayServiceOnline = snapshot.diagnostics.loaded || snapshot.diagnostics.rpcOk;
  const isGatewayProcessUnavailable =
    !snapshot.diagnostics.loaded ||
    (!snapshot.diagnostics.rpcOk && !hasScopeUpgradeIssue) ||
    (transportSummary.statusTone === "danger" && !hasScopeUpgradeIssue);
  const gatewayAccessRepairBlockMessage = hasOpenClawRollbackIssue
    ? "Gateway access repair is blocked by an incomplete OpenClaw update or rollback. Roll back to the last working OpenClaw snapshot, then restart the Gateway."
    : isGatewayProcessUnavailable
      ? "Gateway access repair needs a running Gateway. Start or restart the Gateway first; if OpenClaw reports a version/config mismatch, roll back to the last working OpenClaw snapshot."
      : null;
  const capabilityMatrix = snapshot.diagnostics.capabilityMatrix;
  const compatibilityReport = snapshot.diagnostics.compatibilityReport;
  const capabilityRows = useMemo(
    () => buildOpenClawCapabilityRows(snapshot.diagnostics),
    [snapshot.diagnostics]
  );
  const capabilitySummary = useMemo(
    () => summarizeOpenClawCapabilityRows(snapshot.diagnostics, capabilityRows),
    [capabilityRows, snapshot.diagnostics]
  );
  const contractComparison = useMemo(
    () => buildAgentOsOpenClawContractComparison({
      diagnostics: snapshot.diagnostics,
      capabilityDiff: updateCapabilityDiff,
      scorecard: updateCertificationScorecard,
      labReport: compatibilityLabReport
    }),
    [compatibilityLabReport, snapshot.diagnostics, updateCapabilityDiff, updateCertificationScorecard]
  );
  const gatewayFallbackDiagnostics = (
    snapshot.diagnostics.gatewayFallbackDiagnostics?.length
      ? snapshot.diagnostics.gatewayFallbackDiagnostics
      : capabilityMatrix?.fallbackDiagnostics ?? []
  ).slice(0, 4);
  const nativeAuthLabel = gatewayAuthStatus
    ? gatewayAuthStatus.native.ok
      ? "Authenticated"
      : formatGatewayAuthIssue(gatewayAuthStatus.native.kind)
    : "Unknown";
  const gatewayActionGuidance = resolveGatewayActionGuidance({
    serviceOnline: isGatewayServiceOnline,
    authOk: gatewayAuthStatus?.native.ok ?? null,
    authIssueKind: gatewayAuthStatus?.native.kind ?? null,
    transportTone: transportSummary.statusTone
  });
  const gatewayRepairBusy = isRepairingGatewayDeviceAccess || isGeneratingGatewayAuthToken;
  const gatewayActionBusy = gatewayControlAction !== null || gatewayRepairBusy;
  const isSettingsOperationInProgress =
    updateRunState === "running" ||
    isCheckingForUpdates ||
    isRunningUpdatePreflight ||
    isRunningShadowProbe ||
    isGeneratingCompatibilityLabReport ||
    isRunningCompatibilitySmoke ||
    gatewayActionBusy ||
    isSavingGatewayAuthCredential ||
    isSavingGateway ||
    isSavingOpenClawBinary ||
    isSavingWorkspaceRoot;
  const settingsOperationTitle =
    updateRunState === "running"
      ? "Updating OpenClaw"
      : isCheckingForUpdates
        ? "Checking for updates"
        : isRunningUpdatePreflight || isRunningShadowProbe || isGeneratingCompatibilityLabReport || isRunningCompatibilitySmoke
          ? "Verifying OpenClaw compatibility"
          : gatewayActionBusy
            ? "Working on the Gateway"
            : isSavingGatewayAuthCredential
              ? "Saving Gateway credential"
              : isSavingGateway
                ? "Saving Gateway settings"
                : isSavingOpenClawBinary
                  ? "Saving OpenClaw runtime settings"
                  : "Saving workspace settings";
  const settingsOperationDescription =
    updateRunState === "running"
      ? "Installing the selected release and verifying the OpenClaw runtime."
      : isCheckingForUpdates
        ? "Reading the update registry and compatibility guidance."
        : isRunningUpdatePreflight || isRunningShadowProbe || isGeneratingCompatibilityLabReport || isRunningCompatibilitySmoke
          ? "Running the selected safety and compatibility checks."
          : gatewayActionBusy
            ? "Applying the requested Gateway operation and refreshing its status."
            : "Saving the setting and refreshing the OpenClaw configuration.";
  const gatewayAuthNeedsScopeRepair = gatewayAuthStatus?.native.kind === "scope-limited";
  const gatewayAuthNeedsTokenRepair = gatewayAuthStatus?.native.kind === "auth";
  const gatewayAccessRepairDisabledReason = gatewayAccessRepairBlockMessage || (
    !gatewayAuthStatus
      ? "Wait for the current authentication check to finish."
      : !gatewayAuthNeedsScopeRepair
        ? "Local access repair is available when required operator scopes are missing."
        : null
  );
  const gatewayTokenRepairDisabledReason = !gatewayAuthStatus
    ? "Wait for the current authentication check to finish."
    : !gatewayAuthNeedsTokenRepair
      ? "Token repair is available when the configured credential does not match the Gateway."
      : null;
  const hasGatewayEndpointChanges = gatewayDraft.trim() !== (snapshot.diagnostics.gatewayUrl || "");
  const hasConfiguredGatewayEndpoint = Boolean(snapshot.diagnostics.configuredGatewayUrl);

  const openControlUi = async () => {
    setIsOpeningControlUi(true);
    setControlUiOpenError(null);

    try {
      const response = await fetch("/api/openclaw/dashboard", {
        method: "POST",
        cache: "no-store"
      });
      const result = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        throw new Error(result?.error || "Unable to open the OpenClaw Control UI.");
      }
    } catch (error) {
      setControlUiOpenError(error instanceof Error ? error.message : "Unable to open the OpenClaw Control UI.");
    } finally {
      setIsOpeningControlUi(false);
    }
  };

  const runUpdatePreflight = async (
    targetVersion = defaultUpdateTargetVersion,
    mode: OpenClawUpdateCompatibilityMode = defaultUpdateMode
  ) => {
    setIsRunningUpdatePreflight(true);
    setUpdateSafetyError(null);
    setUpdateSafetyReport(null);

    try {
      const response = await fetch("/api/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        cache: "no-store",
        body: JSON.stringify({
          action: "preflight",
          targetVersion,
          mode
        })
      });

      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(result?.error || "OpenClaw update preflight failed.");
      }

      const result = (await response.json()) as { report: OpenClawUpdateSafetyReport };
      setUpdateSafetyReport(result.report);
    } catch (error) {
      setUpdateSafetyError(error instanceof Error ? error.message : "Unable to run OpenClaw update preflight.");
    } finally {
      setIsRunningUpdatePreflight(false);
    }
  };

  const runShadowProbe = async (
    targetVersion = defaultUpdateTargetVersion,
    mode: OpenClawUpdateCompatibilityMode = defaultUpdateMode
  ) => {
    setIsRunningShadowProbe(true);
    setUpdateSafetyError(null);
    setShadowProbeReport(null);

    try {
      const response = await fetch("/api/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        cache: "no-store",
        body: JSON.stringify({
          action: "probe",
          targetVersion,
          mode
        })
      });

      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(result?.error || "OpenClaw shadow probe failed.");
      }

      const result = (await response.json()) as { report: OpenClawShadowProbeReport };
      setShadowProbeReport(result.report);
    } catch (error) {
      setUpdateSafetyError(error instanceof Error ? error.message : "Unable to test OpenClaw target safely.");
    } finally {
      setIsRunningShadowProbe(false);
    }
  };

  const runCompatibilityLabReport = async (
    targetVersion = defaultUpdateTargetVersion
  ) => {
    setIsGeneratingCompatibilityLabReport(true);
    setCompatibilityLabError(null);
    setCodexFixBundle(null);
    setCertificationPromotion(null);

    try {
      const response = await fetch("/api/openclaw/compatibility-lab", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        cache: "no-store",
        body: JSON.stringify({
          action: "report",
          targetVersion,
          mode: "recommended"
        })
      });

      const result = (await response.json().catch(() => null)) as {
        report?: OpenClawCompatibilityLabReport;
        error?: string;
      } | null;

      if (!response.ok || !result?.report) {
        throw new Error(result?.error || "OpenClaw Compatibility Lab report failed.");
      }

      setCompatibilityLabReport(result.report);
    } catch (error) {
      setCompatibilityLabError(error instanceof Error ? error.message : "Unable to generate OpenClaw Compatibility Lab report.");
    } finally {
      setIsGeneratingCompatibilityLabReport(false);
    }
  };

  const generateCodexFixBundle = async (reportId = compatibilityLabReport?.id) => {
    if (!reportId) {
      setCompatibilityLabError("Generate a compatibility report before creating a Codex fix bundle.");
      return;
    }

    setIsGeneratingCodexFixBundle(true);
    setCompatibilityLabError(null);

    try {
      const response = await fetch("/api/openclaw/compatibility-lab", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        cache: "no-store",
        body: JSON.stringify({
          action: "fix-bundle",
          reportId
        })
      });

      const result = (await response.json().catch(() => null)) as {
        bundle?: OpenClawCodexFixBundle;
        error?: string;
      } | null;

      if (!response.ok || !result?.bundle) {
        throw new Error(result?.error || "OpenClaw Codex fix bundle generation failed.");
      }

      setCodexFixBundle(result.bundle);
    } catch (error) {
      setCompatibilityLabError(error instanceof Error ? error.message : "Unable to generate Codex fix bundle.");
    } finally {
      setIsGeneratingCodexFixBundle(false);
    }
  };

  const certifyCompatibilityTarget = async (reportId = compatibilityLabReport?.id) => {
    if (!reportId) {
      setCompatibilityLabError("Generate a compatibility report before certifying an OpenClaw target.");
      return;
    }

    setIsPromotingCertification(true);
    setCompatibilityLabError(null);

    try {
      const response = await fetch("/api/openclaw/compatibility-lab", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        cache: "no-store",
        body: JSON.stringify({
          action: "certify",
          reportId
        })
      });

      const result = (await response.json().catch(() => null)) as {
        promotion?: OpenClawCompatibilityCertificationPromotion;
        error?: string;
      } | null;

      if (!response.ok || !result?.promotion) {
        throw new Error(result?.error || "OpenClaw target certification failed.");
      }

      setCertificationPromotion(result.promotion);
    } catch (error) {
      setCompatibilityLabError(error instanceof Error ? error.message : "Unable to certify OpenClaw target.");
    } finally {
      setIsPromotingCertification(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/openclaw/compatibility-lab", {
          method: "GET",
          cache: "no-store"
        });
        const result = (await response.json().catch(() => null)) as {
          report?: OpenClawCompatibilityLabReport | null;
        } | null;

        if (!cancelled && response.ok && result?.report) {
          setCompatibilityLabReport(result.report);
        }
      } catch {
        // Latest lab report is optional; explicit generation surfaces errors.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const snapshotReport = snapshot.diagnostics.compatibilitySmokeTest;
    if (!snapshotReport) {
      return;
    }

    setCompatibilitySmokeReport((current) => {
      if (!current) {
        return snapshotReport;
      }

      const currentTime = Date.parse(current.checkedAt);
      const snapshotTime = Date.parse(snapshotReport.checkedAt);
      return Number.isFinite(snapshotTime) && (!Number.isFinite(currentTime) || snapshotTime > currentTime)
        ? snapshotReport
        : current;
    });
  }, [snapshot.diagnostics.compatibilitySmokeTest]);

  useEffect(() => {
    setConfigUpdatePacing(snapshot.diagnostics.configUpdatePacing);
    setConfigUpdatePacingMode(snapshot.diagnostics.configUpdatePacing.settings.mode);
    setConfigUpdatePacingCustomSeconds(
      String(Math.ceil((snapshot.diagnostics.configUpdatePacing.settings.minimumIntervalMs ?? 10_000) / 1_000))
    );
  }, [snapshot.diagnostics.configUpdatePacing]);

  useEffect(() => {
    if (!configUpdatePacing.cooldownUntil) {
      return;
    }

    const timer = window.setInterval(() => {
      setConfigUpdatePacingTick((value) => value + 1);
    }, 1_000);

    return () => window.clearInterval(timer);
  }, [configUpdatePacing.cooldownUntil]);

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

  const refreshGatewayBind = useCallback(async () => {
    setGatewayBindRefreshState("refreshing");

    try {
      const response = await fetch("/api/settings/gateway?view=bind", { cache: "no-store" });
      const payload = await response.json() as { error?: string; gatewayBind?: string | null };

      if (!response.ok) {
        throw new Error(payload.error || "Unable to read the current Gateway bind value.");
      }

      setCurrentGatewayBind(payload.gatewayBind?.trim() || null);
      setGatewayBindRefreshState("ready");
    } catch {
      setGatewayBindRefreshState("error");
    }
  }, []);

  const refreshToolSettings = useCallback(async () => {
    setIsLoadingToolSettings(true);
    setToolSettingsError(null);

    try {
      const response = await fetch("/api/settings/tools", { cache: "no-store" });
      const payload = await response.json() as {
        error?: string;
        toolSettings?: {
          browserEnabled: boolean;
          webFetchEnabled: boolean;
          webSearchEnabled: boolean;
        };
      };

      if (!response.ok || !payload.toolSettings) {
        throw new Error(payload.error || "Unable to read OpenClaw tool settings.");
      }

      setBrowserToolEnabled(payload.toolSettings.browserEnabled);
      setWebFetchToolEnabled(payload.toolSettings.webFetchEnabled);
      setWebSearchToolEnabled(payload.toolSettings.webSearchEnabled);
      setToolSettingsSaveState("idle");
    } catch (error) {
      setToolSettingsError(error instanceof Error ? error.message : "Unable to read OpenClaw tool settings.");
    } finally {
      setIsLoadingToolSettings(false);
    }
  }, []);

  useEffect(() => {
    void refreshGatewayAuthStatus();
  }, [refreshGatewayAuthStatus]);

  useEffect(() => {
    const refreshTimer = window.setTimeout(() => {
      void refreshGatewayBind();
    }, 0);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshGatewayBind();
      }
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.clearTimeout(refreshTimer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshGatewayBind]);

  useEffect(() => {
    if (
      renderedActiveSection === "general" &&
      browserToolEnabled === null &&
      !isLoadingToolSettings &&
      !toolSettingsError
    ) {
      const timer = window.setTimeout(() => {
        void refreshToolSettings();
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [browserToolEnabled, isLoadingToolSettings, refreshToolSettings, renderedActiveSection, toolSettingsError]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const syncActiveSectionFromHash = () => {
      setActiveSection(resolveHashSettingsSection());
      setSettingsHashHydrated(true);
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

  const saveToolSetting = async (settingId: ToolSettingId, enabled: boolean) => {
    if (
      browserToolEnabled === null ||
      webFetchToolEnabled === null ||
      webSearchToolEnabled === null ||
      savingToolSettingId
    ) {
      return;
    }

    const previousSettings = {
      browserEnabled: browserToolEnabled,
      webFetchEnabled: webFetchToolEnabled,
      webSearchEnabled: webSearchToolEnabled
    };
    const nextSettings = {
      ...previousSettings,
      ...(settingId === "browser" ? { browserEnabled: enabled } : {}),
      ...(settingId === "web-fetch" ? { webFetchEnabled: enabled } : {}),
      ...(settingId === "web-search" ? { webSearchEnabled: enabled } : {})
    };
    const applyToolSettings = (settings: typeof previousSettings) => {
      setBrowserToolEnabled(settings.browserEnabled);
      setWebFetchToolEnabled(settings.webFetchEnabled);
      setWebSearchToolEnabled(settings.webSearchEnabled);
    };

    applyToolSettings(nextSettings);
    setSavingToolSettingId(settingId);
    setToolSettingsSaveState("saving");
    setToolSettingsError(null);

    try {
      const response = await fetch("/api/settings/tools", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextSettings)
      });
      const payload = await response.json() as {
        error?: string;
        toolSettings?: {
          browserEnabled: boolean;
          webFetchEnabled: boolean;
          webSearchEnabled: boolean;
        };
      };

      if (!response.ok || !payload.toolSettings) {
        throw new Error(payload.error || "Unable to save OpenClaw tool settings.");
      }

      applyToolSettings(payload.toolSettings);
      setToolSettingsSaveState("saved");
    } catch (error) {
      applyToolSettings(previousSettings);
      setToolSettingsSaveState("error");
      setToolSettingsError(error instanceof Error ? error.message : "Unable to save OpenClaw tool settings.");
    } finally {
      setSavingToolSettingId(null);
    }
  };

  const beginGatewayOperation = (kind: GatewayOperationKind, message: string) => {
    setGatewayOperationFeedback({
      kind,
      status: "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      message
    });
  };

  const finishGatewayOperation = (
    kind: GatewayOperationKind,
    status: "success" | "error",
    message: string
  ) => {
    setGatewayOperationFeedback((current) => ({
      kind,
      status,
      startedAt: current?.kind === kind ? current.startedAt : new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      message
    }));
  };

  const generateGatewayAuthToken = async () => {
    beginGatewayOperation("repair-token", "Applying a new local credential and waiting for native authentication verification.");
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
      finishGatewayOperation("repair-token", "success", "Gateway token repaired and native authentication verified.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to generate Gateway token.";
      setGatewayAuthError(message);
      finishGatewayOperation("repair-token", "error", message);
    } finally {
      setIsGeneratingGatewayAuthToken(false);
    }
  };

  const repairGatewayDeviceAccess = async () => {
    beginGatewayOperation("repair-access", "Approving required operator scopes and waiting for native authentication verification.");
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
      finishGatewayOperation("repair-access", "success", "Local Gateway access repaired and native authentication verified.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to repair Gateway access.";
      setGatewayAuthError(message);
      finishGatewayOperation("repair-access", "error", message);
    } finally {
      setIsRepairingGatewayDeviceAccess(false);
    }
  };

  const runGatewayControlAction = async (action: GatewayControlAction) => {
    beginGatewayOperation(action, gatewayControlRunningMessage(action));

    try {
      await onControlGateway(action);
      finishGatewayOperation(action, "success", gatewayControlSuccessMessage(action));
    } catch (error) {
      finishGatewayOperation(
        action,
        "error",
        error instanceof Error ? error.message : "Gateway control action failed."
      );
    }
  };

  const runRecommendedGatewayAction = () => {
    switch (gatewayActionGuidance.action) {
      case "start":
        void runGatewayControlAction("start");
        break;
      case "restart":
        void runGatewayControlAction("restart");
        break;
      case "repair-access":
        void repairGatewayDeviceAccess();
        break;
      case "repair-token":
        void generateGatewayAuthToken();
        break;
      default:
        break;
    }
  };

  const runCompatibilitySmokeTest = async () => {
    setIsRunningCompatibilitySmoke(true);
    setCompatibilitySmokeError(null);

    try {
      const response = await fetch("/api/openclaw/compatibility-smoke", {
        method: "POST",
        cache: "no-store"
      });

      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(result?.error || "OpenClaw compatibility smoke test failed.");
      }

      const result = (await response.json()) as { report: CompatibilitySmokeReport };
      setCompatibilitySmokeReport(result.report);
    } catch (error) {
      setCompatibilitySmokeError(
        error instanceof Error ? error.message : "Unable to run OpenClaw compatibility smoke test."
      );
    } finally {
      setIsRunningCompatibilitySmoke(false);
    }
  };

  const saveConfigUpdatePacing = async () => {
    setIsSavingConfigUpdatePacing(true);
    setConfigUpdatePacingError(null);

    try {
      const minimumIntervalMs = configUpdatePacingMode === "custom"
        ? Math.max(1, Math.round(Number(configUpdatePacingCustomSeconds) || 10)) * 1_000
        : null;
      const response = await fetch("/api/settings/config-pacing", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          mode: configUpdatePacingMode,
          minimumIntervalMs
        })
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Unable to update config update pacing.");
      }

      setConfigUpdatePacing(payload.configUpdatePacing);
      setConfigUpdatePacingMode(payload.configUpdatePacing.settings.mode);
      setConfigUpdatePacingCustomSeconds(
        String(Math.ceil((payload.configUpdatePacing.settings.minimumIntervalMs ?? 10_000) / 1_000))
      );
    } catch (error) {
      setConfigUpdatePacingError(error instanceof Error ? error.message : "Unable to update config update pacing.");
    } finally {
      setIsSavingConfigUpdatePacing(false);
    }
  };

  const configUpdatePacingRetryMs = configUpdatePacing.cooldownUntil
    ? Math.max(0, Date.parse(configUpdatePacing.cooldownUntil) - Date.now() + configUpdatePacingTick * 0)
    : null;
  const activeSectionConfig = settingsSections.find((section) => section.id === renderedActiveSection) ?? settingsSections[0];
  const activeSectionLabel = activeSectionConfig.label;
  const relatedSectionIds = relatedSettingsSections[renderedActiveSection];
  const scrollSettingsToTop = () => {
    if (typeof window === "undefined") {
      return;
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const selectSettingsSection = (sectionId: SettingsSectionId) => {
    setActiveSection(sectionId);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `/settings#${sectionId}`);
    }
    scrollSettingsToTop();
  };
  const toolControls: Array<{
    id: ToolSettingId;
    label: string;
    description: string;
    enabled: boolean | null;
  }> = [
    {
      id: "browser",
      label: "Browser",
      description: "Allow OpenClaw to use browser tools.",
      enabled: browserToolEnabled
    },
    {
      id: "web-fetch",
      label: "Web Fetch",
      description: "Allow tools to retrieve content from web pages.",
      enabled: webFetchToolEnabled
    },
    {
      id: "web-search",
      label: "Web Search",
      description: "Allow tools to search the web.",
      enabled: webSearchToolEnabled
    }
  ];

  return (
    <>
      <PikoLoader
        open={isSettingsOperationInProgress}
        title={settingsOperationTitle}
        description={settingsOperationDescription}
      />
      <main
      className={cn(
        "relative z-10 min-h-screen [&_a]:inline-flex [&_a]:min-h-11 [&_a]:min-w-11 [&_a]:items-center [&_button]:min-h-11 [&_button]:min-w-11 [&_input]:min-h-11 [&_select]:min-h-11 sm:[&_a]:min-h-0 sm:[&_a]:min-w-0 sm:[&_button]:min-h-0 sm:[&_button]:min-w-0 sm:[&_input]:min-h-0 sm:[&_select]:min-h-0",
        surfaceTheme === "light" ? "text-foreground" : "bg-[#080d16] text-slate-100"
      )}
    >
        <section
          className={cn(
            "min-w-0 px-3 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-[76px] sm:px-4 lg:px-4 lg:pb-8 lg:pt-[86px] xl:px-5 2xl:px-6",
            sidebarOpen ? "lg:ml-[308px]" : "lg:ml-[72px]"
          )}
        >
          <div className="mx-auto max-w-[1680px] space-y-4 sm:space-y-5">
            <section className="flex flex-col gap-5">
              <div className="order-2 grid grid-cols-2 gap-2 sm:grid-cols-2 xl:grid-cols-[1.05fr_0.9fr_0.9fr_1.45fr_0.7fr_0.72fr]">
                  <SummaryTile
                    label="OpenClaw"
                    value={snapshot.diagnostics.version ? `v${snapshot.diagnostics.version}` : "Unknown"}
                    detail={recommendedVersion ? `AgentOS certified through ${formatVersionValue(recommendedVersion)}` : "AgentOS certification unavailable"}
                    surfaceTheme={surfaceTheme}
                    accent
                    compact
                  />
                  <SummaryTile
                    label="Gateway"
                    value={snapshot.diagnostics.loaded || snapshot.diagnostics.rpcOk ? "Online" : "Offline"}
                    detail={`Bind: ${displayedGatewayBind}`}
                    surfaceTheme={surfaceTheme}
                    compact
                  />
                  <SummaryTile
                    label="Model"
                    value={selectedOrDefaultModelId || "Not selected"}
                    detail={modelProvider}
                    surfaceTheme={surfaceTheme}
                    compact
                  />
                  <SummaryTile
                    label="Workspace"
                    value={compactPath(workspaceRootDraft || snapshot.diagnostics.workspaceRoot || "Not configured")}
                    detail={`${snapshot.workspaces.length} workspace${snapshot.workspaces.length === 1 ? "" : "s"}`}
                    surfaceTheme={surfaceTheme}
                    compact
                  />
                  <SummaryTile
                    label="Status"
                    value={connectionState === "live" ? "Online" : connectionState === "retrying" ? "Retrying" : "Connecting"}
                    detail="AgentOS stream"
                    surfaceTheme={surfaceTheme}
                    compact
                  />
                  <SummaryTile
                    label="Runtime"
                    value={snapshot.runtimes.some((runtime) => runtime.status === "running") ? "Running" : "Idle"}
                    detail={`${activeRuntimeIssues.length} issue${activeRuntimeIssues.length === 1 ? "" : "s"}`}
                    surfaceTheme={surfaceTheme}
                    compact
                  />
              </div>

              <div className="order-1 flex flex-col gap-1.5">
                <h1 className={cn("font-display text-[1.45rem] leading-tight sm:text-[1.85rem]", surfaceTheme === "light" ? "text-[#1f1712]" : "text-slate-50")}>
                  Settings
                </h1>
                <p className={cn("max-w-2xl text-sm leading-6", mutedTextClassName(surfaceTheme))}>
                  System configuration, runtime health, and operator controls.
                </p>
              </div>

            </section>

            <div className="grid items-start gap-5 lg:grid-cols-[224px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)]">
              <SettingsSectionNavigation
                activeSection={renderedActiveSection}
                onSelect={selectSettingsSection}
                surfaceTheme={surfaceTheme}
              />
              <div className="min-w-0 space-y-4">
            <section className="space-y-4">
              <div className="min-w-0 space-y-4">
                <div className="flex flex-col gap-4">
              {renderedActiveSection === "overview" ? (
              <section id="overview" className="scroll-mt-24 space-y-5">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Card title="OpenClaw" icon={Activity} surfaceTheme={surfaceTheme}>
                    <Metric
                      label="Current version"
                      value={snapshot.diagnostics.version ? `v${snapshot.diagnostics.version}` : "Unknown"}
                      badge={recommendedVersion ? `Certified through ${formatVersionValue(recommendedVersion)}` : "Certification unavailable"}
                      surfaceTheme={surfaceTheme}
                    />
                    <SettingsInlineLink href="/settings#openclaw" label="Open settings" surfaceTheme={surfaceTheme} onActivate={() => setActiveSection("openclaw")} />
                  </Card>
                  <Card title="Gateway" icon={ShieldCheck} surfaceTheme={surfaceTheme}>
                    <Metric
                      label="Gateway"
                      value={snapshot.diagnostics.loaded || snapshot.diagnostics.rpcOk ? "Online" : "Offline"}
                      badge={transportSummary.protocolLabel}
                      surfaceTheme={surfaceTheme}
                    />
                    <SettingsInlineLink href="/settings#gateway" label="Open settings" surfaceTheme={surfaceTheme} onActivate={() => setActiveSection("gateway")} />
                  </Card>
                  <Card title="Models" icon={Box} surfaceTheme={surfaceTheme}>
                    <Metric
                      label="Active model"
                      value={selectedOrDefaultModelId || "Not selected"}
                      badge={`${snapshot.diagnostics.modelReadiness.availableModelCount} available`}
                      surfaceTheme={surfaceTheme}
                    />
                    <SettingsInlineLink href="/settings#models" label="Open settings" surfaceTheme={surfaceTheme} onActivate={() => setActiveSection("models")} />
                  </Card>
                  <Card title="Workspace" icon={Folder} surfaceTheme={surfaceTheme}>
                    <Metric
                      label="Current workspace"
                      value={compactPath(workspaceRootDraft || snapshot.diagnostics.workspaceRoot || "Not configured")}
                      badge={`${snapshot.workspaces.length} tracked`}
                      surfaceTheme={surfaceTheme}
                    />
                    <SettingsInlineLink href="/settings#workspace" label="Open settings" surfaceTheme={surfaceTheme} onActivate={() => setActiveSection("workspace")} />
                  </Card>
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <Card
                    title="System Health"
                    icon={Activity}
                    surfaceTheme={surfaceTheme}
                    action={
                      <StatusPill
                        label={activeRuntimeIssues.length ? `${activeRuntimeIssues.length} visible` : "Healthy"}
                        tone={activeRuntimeIssues.length ? "danger" : "success"}
                        surfaceTheme={surfaceTheme}
                      />
                    }
                  >
                    <InfoRows
                      surfaceTheme={surfaceTheme}
                      rows={[
                        ["Runtime issues", `${activeRuntimeIssues.length} visible`],
                        ["Native Gateway coverage", compatibilityReport ? `${compatibilityReport.summary.nativeGatewayCoveragePercent}% (${compatibilityReport.summary.nativeGatewayCoverageLabel})` : "Unknown"],
                        ["CLI fallback count", String(transportSummary.fallbackTotal)],
                        ["Last health check", lastCheckedAt ? new Date(lastCheckedAt).toLocaleTimeString() : "Not checked"]
                      ]}
                    />
                    <SettingsInlineLink href="/settings#diagnostics" label="View diagnostics" surfaceTheme={surfaceTheme} onActivate={() => setActiveSection("diagnostics")} />
                  </Card>

                  <Card title="Quick Actions" icon={Wrench} surfaceTheme={surfaceTheme}>
                    <div className="grid gap-2">
                      <SettingsActionRow icon={Activity} label="Open OpenClaw settings" href="/settings#openclaw" surfaceTheme={surfaceTheme} onActivate={() => setActiveSection("openclaw")} />
                      <SettingsActionRow icon={ShieldCheck} label="Open Gateway settings" href="/settings#gateway" surfaceTheme={surfaceTheme} onActivate={() => setActiveSection("gateway")} />
                      <SettingsActionRow icon={TerminalSquare} label="Run diagnostics" href="/settings#diagnostics" surfaceTheme={surfaceTheme} onActivate={() => setActiveSection("diagnostics")} />
                      <SettingsActionRow icon={Box} label="Manage models" href="/settings#models" surfaceTheme={surfaceTheme} onActivate={() => setActiveSection("models")} />
                    </div>
                  </Card>
                </div>

                <div className="hidden gap-4 sm:grid xl:grid-cols-2">
                  <Card title="Runtime Context" icon={Database} surfaceTheme={surfaceTheme}>
                    <InfoRows
                      surfaceTheme={surfaceTheme}
                      rows={[
                        ["Workspace", compactPath(workspaceRootDraft || snapshot.diagnostics.workspaceRoot || "Not configured")],
                        ["Runtime", snapshot.runtimes.some((runtime) => runtime.status === "running") ? "Running" : "Idle"],
                        ["Transport", transportSummary.statusLabel]
                      ]}
                    />
                  </Card>
                  <Card title="System Snapshot" icon={CheckCircle2} surfaceTheme={surfaceTheme}>
                    <InfoRows
                      surfaceTheme={surfaceTheme}
                      rows={[
                        ["OpenClaw", snapshot.diagnostics.version ? `v${snapshot.diagnostics.version}` : "Unknown"],
                        ["Gateway", snapshot.diagnostics.gatewayUrl || "Not configured"],
                        ["Compatibility", compatibilityReport ? formatCompatibilityReportStatus(compatibilityReport.status) : "Unknown"]
                      ]}
                    />
                  </Card>
                </div>
              </section>
              ) : null}

              {renderedActiveSection === "openclaw" ? (
              <section id="openclaw" className="scroll-mt-24">
                <div
                  className={cn(
                    "panel-surface panel-glow min-h-full overflow-hidden rounded-[18px] p-4",
                    surfaceTheme === "light"
                      ? "border-border bg-card/95 text-foreground shadow-card"
                      : "border-white/[0.08] bg-[linear-gradient(180deg,rgba(16,24,38,0.98),rgba(7,11,18,0.96))] text-slate-100"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border",
                        surfaceTheme === "light"
                          ? "border-primary/15 bg-primary/10 text-primary"
                          : "border-primary/15 bg-primary/10 text-primary"
                      )}
                    >
                      <Activity className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 className="font-display text-lg">OpenClaw</h2>
                      <p
                        className={cn(
                          "mt-0.5 text-xs leading-5",
                          surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400"
                        )}
                      >
                        Source of truth for runtime and control state.
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void openControlUi()}
                        disabled={!snapshot.diagnostics.loaded || isOpeningControlUi}
                        title={snapshot.diagnostics.loaded ? "Open the OpenClaw Control UI." : "Start the OpenClaw Gateway to open its Control UI."}
                        className={secondaryButtonClassName(surfaceTheme)}
                      >
                        {isOpeningControlUi ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
                        {isOpeningControlUi ? "Opening…" : "Open Control UI"}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => setIsOpenClawAppConnectOpen(true)}
                        disabled={!snapshot.diagnostics.loaded}
                        title={snapshot.diagnostics.loaded ? "Pair the OpenClaw mobile app." : "Start the OpenClaw Gateway to pair a mobile app."}
                        className={secondaryButtonClassName(surfaceTheme)}
                      >
                        Connect OpenClaw App
                      </Button>
                    </div>
                  </div>
                  {controlUiOpenError ? (
                    <p className={cn("mt-3 text-xs", surfaceTheme === "light" ? "text-destructive" : "text-rose-300")} role="alert">
                      {controlUiOpenError}
                    </p>
                  ) : null}
                  <OpenClawAppConnectDialog
                    open={isOpenClawAppConnectOpen}
                    onOpenChange={setIsOpenClawAppConnectOpen}
                    surfaceTheme={surfaceTheme}
                    bindMode={snapshot.diagnostics.bindMode}
                    configuredGatewayUrl={snapshot.diagnostics.configuredGatewayUrl}
                    onPairingPrepared={() => void refreshGatewayBind()}
                  />

                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <Metric
                      label="Current version"
                      value={`v${snapshot.diagnostics.version || "unknown"}`}
                      surfaceTheme={surfaceTheme}
                      dark={surfaceTheme === "dark"}
                    />
                    <Metric
                      label="AgentOS certified"
                      value={recommendedVersion ? `v${recommendedVersion}` : "Unknown"}
                      badge={updateCompatibility?.recommendedDecision.status ?? (hasRegistryUpdateAvailable ? "Update" : "Stable")}
                      surfaceTheme={surfaceTheme}
                      dark={surfaceTheme === "dark"}
                    />
                  </div>

                  <div className={cn("mt-4 rounded-[18px] border p-3.5", insetPanelClassName(surfaceTheme))}>
                    <p className={labelClassName(surfaceTheme)}>Current OpenClaw state</p>
                    <InfoRows
                      surfaceTheme={surfaceTheme}
                      rows={[
                        ["Gateway reachability", snapshot.diagnostics.loaded && snapshot.diagnostics.rpcOk ? "Reachable" : "Not ready"],
                        ["Native Gateway protocol", transportSummary.protocolLabel],
                        ["Auth/scopes", nativeAuthLabel],
                        ["Model readiness", snapshot.diagnostics.modelReadiness.ready ? "Ready" : snapshot.diagnostics.modelReadiness.issues[0] ?? "Unknown"],
                        ["Native Gateway coverage", compatibilityReport ? `${compatibilityReport.summary.nativeGatewayCoveragePercent}% (${compatibilityReport.summary.nativeGatewayCoverageLabel})` : "Unknown"],
                        ["CLI fallback count", String(transportSummary.fallbackTotal)],
                        ["Runtime issues", `${activeRuntimeIssues.length} visible`]
                      ]}
                    />
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" asChild className={secondaryButtonClassName(surfaceTheme, "px-4")}>
                      <Link href="/updates">
                        <Download className="h-3.5 w-3.5" />
                        Manage updates
                      </Link>
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
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        window.location.hash = "diagnostics";
                        setActiveSection("diagnostics");
                      }}
                      className={secondaryButtonClassName(surfaceTheme, "px-4")}
                    >
                      <TerminalSquare className="h-3.5 w-3.5" />
                      Open Runtime Inbox
                    </Button>
                  </div>

                  <div className={cn("mt-5 grid gap-3 border-t pt-4 sm:grid-cols-2", surfaceTheme === "light" ? "border-border" : "border-white/10")}>
                    <Metric
                      label="Detected install"
                      value={installSummary.label || "Unknown"}
                      surfaceTheme={surfaceTheme}
                      dark={surfaceTheme === "dark"}
                      compact
                    />
                    <Metric
                      label="Resolved path"
                      value={shortPath(openClawBinarySelection.resolvedPath || "openclaw", 26)}
                      surfaceTheme={surfaceTheme}
                      dark={surfaceTheme === "dark"}
                      compact
                    />
                  </div>

                  <div
                    className={cn(
                      "mt-4 rounded-[18px] border p-3.5",
                      surfaceTheme === "light" ? "border-border bg-muted/45" : "border-white/10 bg-white/[0.035]"
                    )}
                  >
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
                              ? surfaceTheme === "light"
                                ? "border-primary/35 bg-primary/10 text-primary"
                                : "border-primary/30 bg-primary/12 text-primary"
                              : surfaceTheme === "light"
                                ? "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
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

              {renderedActiveSection === "gateway" ? (
              <section id="gateway" className="scroll-mt-24">
                <Card title="Gateway" icon={ShieldCheck} surfaceTheme={surfaceTheme}>
                  <GatewayLiveHealthPanel
                    snapshot={snapshot}
                    transportSummary={transportSummary}
                    gatewayAuthStatus={gatewayAuthStatus}
                    nativeAuthLabel={nativeAuthLabel}
                    displayedGatewayBind={displayedGatewayBind}
                    surfaceTheme={surfaceTheme}
                  />

                  <GatewayRecommendedActionPanel
                    guidance={gatewayActionGuidance}
                    isBusy={gatewayActionBusy}
                    onRun={runRecommendedGatewayAction}
                    surfaceTheme={surfaceTheme}
                  />

                  {gatewayOperationFeedback ? (
                    <GatewayOperationProgressPanel
                      feedback={gatewayOperationFeedback}
                      onDismiss={() => setGatewayOperationFeedback(null)}
                      surfaceTheme={surfaceTheme}
                    />
                  ) : null}

                  <div className="mt-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className={labelClassName(surfaceTheme)}>Service controls</p>
                      <p className={cn("text-xs", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>
                        {isGatewayServiceOnline ? "Gateway is running" : "Gateway is stopped"}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {([
                        { action: "start", label: "Start", disabledReason: isGatewayServiceOnline ? "The Gateway is already running." : null },
                        { action: "stop", label: "Stop", disabledReason: !isGatewayServiceOnline ? "The Gateway is already stopped." : null },
                        { action: "restart", label: "Restart", disabledReason: !isGatewayServiceOnline ? "Start the Gateway before restarting it." : null },
                        { action: "doctor", label: "Native diagnostics", disabledReason: null }
                      ] as const).map(({ action, label, disabledReason }) => (
                        <Button
                          key={action}
                          type="button"
                          variant="secondary"
                          onClick={() => void runGatewayControlAction(action)}
                          disabled={gatewayActionBusy || Boolean(disabledReason)}
                          title={disabledReason ?? undefined}
                          className={cn(
                            secondaryButtonClassName(surfaceTheme),
                            "shadow-none",
                            action === "doctor" ? "normal-case" : "capitalize",
                            action === "stop" && (surfaceTheme === "light" ? "border-rose-200 text-rose-700 hover:bg-rose-50" : "border-rose-300/15 text-rose-200 hover:bg-rose-300/10")
                          )}
                        >
                          {gatewayControlAction === action ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
                          {label}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div
                    className={cn(
                      "mt-4 rounded-[18px] border p-3.5",
                      insetPanelClassName(surfaceTheme)
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <KeyRound className={cn("mt-0.5 h-4 w-4 shrink-0", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")} />
                        <div>
                          <p className={cn("text-sm font-medium", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}>
                            Native Gateway auth
                          </p>
                        <p
                          className={cn(
                            "mt-1 text-xs leading-5",
                            surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400"
                          )}
                        >
                          {!gatewayAuthStatus
                            ? "Checking the current Gateway authentication state."
                            : gatewayAuthStatus.native.ok
                              ? "Authentication is healthy. Repair actions stay disabled until a matching issue is detected."
                              : gatewayAuthNeedsScopeRepair
                                ? "Required operator scopes are missing. Repair local access to continue."
                                : gatewayAuthNeedsTokenRepair
                                  ? "The configured credential does not match the running Gateway."
                                  : gatewayAuthStatus.recommendation}
                        </p>
                        </div>
                      </div>
                      <span className={transportTonePillClassName(
                        !gatewayAuthStatus ? "neutral" : gatewayAuthStatus.native.ok ? "success" : "warning",
                        surfaceTheme
                      )}>
                        {!gatewayAuthStatus ? "Checking" : gatewayAuthStatus.native.ok ? "Healthy" : "Attention"}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void repairGatewayDeviceAccess()}
                        disabled={gatewayActionBusy || Boolean(gatewayAccessRepairDisabledReason)}
                        className={secondaryButtonClassName(surfaceTheme, "px-3", "gateway-contrast")}
                        title={gatewayAccessRepairDisabledReason ?? undefined}
                      >
                        {isRepairingGatewayDeviceAccess ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}
                        Repair local access
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void generateGatewayAuthToken()}
                        disabled={gatewayActionBusy || Boolean(gatewayTokenRepairDisabledReason)}
                        className={secondaryButtonClassName(surfaceTheme, "px-3", "gateway-contrast")}
                        title={gatewayTokenRepairDisabledReason ?? undefined}
                      >
                        {isGeneratingGatewayAuthToken ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                        Repair token
                      </Button>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void refreshGatewayAuthStatus()}
                      disabled={isCheckingGatewayAuth || gatewayActionBusy}
                      className={cn(secondaryButtonClassName(surfaceTheme, "mt-2 w-full", "gateway-contrast"))}
                    >
                      {isCheckingGatewayAuth ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                      Test auth
                    </Button>

                    <details className={cn("group mt-3 rounded-[14px] border", surfaceTheme === "light" ? "border-border bg-white/60" : "border-white/[0.08] bg-black/10")}>
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5">
                        <span className={cn("text-xs font-medium", surfaceTheme === "light" ? "text-foreground" : "text-slate-200")}>Use a known credential</span>
                        <ChevronDown className={cn("h-4 w-4 transition-transform group-open:rotate-180", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")} />
                      </summary>
                      <div className={cn("border-t p-3", surfaceTheme === "light" ? "border-border" : "border-white/[0.08]")}>
                        <div className="grid gap-2 sm:grid-cols-[112px_1fr]">
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
                        <Button
                          type="button"
                          onClick={() => void saveGatewayAuthCredential()}
                          disabled={isSavingGatewayAuthCredential || !gatewayAuthCredential.trim()}
                          title={!gatewayAuthCredential.trim() ? "Enter a known Gateway credential before saving." : undefined}
                          className="mt-2 h-9 w-full rounded-full bg-primary text-xs text-primary-foreground shadow-none hover:bg-primary/90 disabled:border disabled:border-border disabled:bg-muted disabled:text-muted-foreground"
                        >
                          {isSavingGatewayAuthCredential ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                          Save credential
                        </Button>
                      </div>
                    </details>
                    {gatewayAccessRepairBlockMessage ? (
                      <div
                        className={cn(
                          "mt-3 rounded-[14px] border p-3 text-xs leading-5",
                          surfaceTheme === "light"
                            ? "border-amber-200 bg-amber-50 text-amber-900"
                            : "border-amber-300/20 bg-amber-300/[0.08] text-amber-100"
                        )}
                      >
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <p>{gatewayAccessRepairBlockMessage}</p>
                        </div>
                        {hasOpenClawRollbackIssue || isGatewayProcessUnavailable ? (
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={onRollbackOpenClaw}
                            disabled={updateRunState === "running"}
                            className={cn(secondaryButtonClassName(surfaceTheme, "mt-2 px-3", "gateway-contrast"), "w-full")}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Rollback to last working OpenClaw
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                    {gatewayAuthError || gatewayAuthSaveMessage || gatewayAuthStatus?.native.issue ? (
                      <p
                        className={cn(
                          "mt-3 text-xs leading-5",
                          gatewayAuthError
                            ? surfaceTheme === "light"
                              ? "text-red-700"
                              : "text-rose-300"
                            : surfaceTheme === "light"
                              ? "text-muted-foreground"
                              : "text-slate-400"
                        )}
                      >
                        {gatewayAuthError || gatewayAuthSaveMessage || gatewayAuthStatus?.native.issue}
                      </p>
                    ) : null}
                  </div>

                  <details className={cn("group mt-4 rounded-[16px] border", insetPanelClassName(surfaceTheme))}>
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-3">
                      <div className="min-w-0">
                        <p className={cn("text-sm font-medium", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}>Connection settings</p>
                        <p className={cn("mt-0.5 truncate text-xs", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>
                          {snapshot.diagnostics.gatewayUrl || "No Gateway endpoint configured"} · {displayedGatewayBind}
                        </p>
                      </div>
                      <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform group-open:rotate-180", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")} />
                    </summary>
                    <div className={cn("border-t p-3.5", surfaceTheme === "light" ? "border-border" : "border-white/[0.08]")}>
                      <Label className={labelClassName(surfaceTheme)}>Gateway endpoint</Label>
                      <Input
                        value={gatewayDraft}
                        onChange={(event) => onGatewayDraftChange(event.target.value)}
                        placeholder="ws://127.0.0.1:18789"
                        className={inputClassName(surfaceTheme, "mt-2")}
                      />
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <Button
                          type="button"
                          onClick={() => void onSaveGatewaySettings(gatewayDraft.trim() || null)}
                          disabled={isSavingGateway || !hasGatewayEndpointChanges}
                          title={!hasGatewayEndpointChanges ? "The Gateway endpoint has not changed." : undefined}
                          className="h-9 rounded-full bg-primary text-xs text-primary-foreground shadow-none hover:bg-primary/90 disabled:border disabled:border-border disabled:bg-muted disabled:text-muted-foreground"
                        >
                          {isSavingGateway ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                          Save endpoint
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => void onSaveGatewaySettings(null)}
                          disabled={isSavingGateway || !hasConfiguredGatewayEndpoint}
                          title={!hasConfiguredGatewayEndpoint ? "No custom Gateway endpoint is configured." : undefined}
                          className={secondaryButtonClassName(surfaceTheme)}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Clear
                        </Button>
                      </div>
                    </div>
                  </details>

                  <RuntimeGatewayInlineWarning
                    snapshot={snapshot}
                    surfaceTheme={surfaceTheme}
                    onSnapshotChange={onSnapshotChange}
                    onRefresh={async () => {
                      await refreshGatewayAuthStatus();
                    }}
                  />

                  <CompatibilityPanel
                    compatibilityReport={compatibilityReport}
                    report={compatibilitySmokeReport}
                    snapshot={snapshot}
                    capabilityMatrix={capabilityMatrix}
                    transportSummary={transportSummary}
                    nativeAuthLabel={nativeAuthLabel}
                    error={compatibilitySmokeError}
                    isRunning={isRunningCompatibilitySmoke}
                    onRun={() => void runCompatibilitySmokeTest()}
                    surfaceTheme={surfaceTheme}
                  />

                  {transportSummary.recovery || transportSummary.lastNativeError ? (
                    <details className={cn("group mt-3 rounded-[16px] border", insetPanelClassName(surfaceTheme))}>
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-3">
                        <div className="min-w-0">
                          <p className={cn("text-sm font-medium", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}>Native transport details</p>
                          <p className={cn("mt-0.5 truncate text-xs", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>
                            {transportSummary.lastNativeError || transportSummary.recovery}
                          </p>
                        </div>
                        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform group-open:rotate-180", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")} />
                      </summary>
                      <div className={cn("border-t p-3.5", surfaceTheme === "light" ? "border-border" : "border-white/[0.08]")}>
                        {transportSummary.lastNativeError ? (
                          <p className={cn("text-xs leading-5", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-300")}>
                            Last native error: {transportSummary.lastNativeError}
                          </p>
                        ) : null}
                        {transportSummary.recovery ? (
                          <p className={cn("mt-1 text-xs leading-5", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>
                            Recovery: {transportSummary.recovery}
                          </p>
                        ) : null}
                      </div>
                    </details>
                  ) : null}
                </Card>
              </section>
              ) : null}

              {renderedActiveSection === "general" ? (
              <section id="general" className="scroll-mt-24">
                <Card title="General" icon={Wrench} surfaceTheme={surfaceTheme}>
                  <div className={cn(
                    "overflow-hidden rounded-[14px] border",
                    surfaceTheme === "light"
                      ? "border-border bg-card"
                      : "border-white/[0.08] bg-[#0c1522]"
                  )}>
                    {toolControls.map((tool) => (
                      <div
                        key={tool.id}
                        className={cn(
                          "flex min-h-[62px] items-center gap-3 border-b px-3 py-2.5 last:border-b-0 sm:px-3.5",
                          surfaceTheme === "light" ? "border-border" : "border-white/[0.07]"
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <p className={cn("text-sm font-medium", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}>
                            {tool.label}
                          </p>
                          <p className={cn("mt-0.5 text-xs leading-4", mutedTextClassName(surfaceTheme))}>
                            {tool.description}
                          </p>
                        </div>
                        <SettingsToggle
                          checked={tool.enabled === true}
                          disabled={isLoadingToolSettings || tool.enabled === null || savingToolSettingId !== null}
                          loading={isLoadingToolSettings || tool.enabled === null || savingToolSettingId === tool.id}
                          label={tool.label}
                          onCheckedChange={(checked) => void saveToolSetting(tool.id, checked)}
                          surfaceTheme={surfaceTheme}
                        />
                      </div>
                    ))}
                  </div>

                  {toolSettingsError ? (
                    <p className={cn(
                      "mt-3 text-xs leading-5",
                      surfaceTheme === "light" ? "text-red-700" : "text-rose-300"
                    )} role="alert">
                      {toolSettingsError}
                    </p>
                  ) : null}

                  <div className="mt-3 flex items-center justify-between gap-3">
                    <p className={cn("text-[11px] leading-4", mutedTextClassName(surfaceTheme))}>
                      Changes save automatically.
                    </p>
                    {toolSettingsSaveState === "saving" ? (
                      <span className={cn("flex items-center gap-1.5 text-[11px] font-medium", mutedTextClassName(surfaceTheme))} role="status">
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> Saving…
                      </span>
                    ) : toolSettingsSaveState === "saved" ? (
                      <span className={cn("flex items-center gap-1.5 text-[11px] font-medium", surfaceTheme === "light" ? "text-emerald-700" : "text-emerald-300")} role="status">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Saved
                      </span>
                    ) : toolSettingsSaveState === "error" ? (
                      <span className={cn("flex items-center gap-1.5 text-[11px] font-medium", surfaceTheme === "light" ? "text-red-700" : "text-rose-300")} role="status">
                        <XCircle className="h-3.5 w-3.5" /> Not saved
                      </span>
                    ) : null}
                  </div>
                </Card>
              </section>
              ) : null}

              {renderedActiveSection === "capabilities" ? (
              <section id="capabilities" className="scroll-mt-24">
                <Card title="OpenClaw Capability Matrix" icon={ListChecks} surfaceTheme={surfaceTheme}>
                  <CapabilityMatrixPanel
                    rows={capabilityRows}
                    summary={capabilitySummary}
                    snapshot={snapshot}
                    updateCapabilityDiff={updateCapabilityDiff}
                    updateCertificationScorecard={updateCertificationScorecard}
                    contractComparison={contractComparison}
                    surfaceTheme={surfaceTheme}
                  />
                </Card>
              </section>
              ) : null}

              {renderedActiveSection === "models" ? (
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
                      className="h-9 rounded-full bg-primary text-xs text-primary-foreground hover:bg-primary/90"
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

              {renderedActiveSection === "workspace" ? (
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
                      className="h-9 rounded-full bg-primary text-xs text-primary-foreground hover:bg-primary/90"
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
                        ? "border border-border bg-muted/45"
                        : "border border-white/[0.08] bg-[#101a2a]/92"
                    )}
                  >
                    <p className={labelClassName(surfaceTheme)}>Current root</p>
                    <p className={cn("mt-2 break-all text-sm", surfaceTheme === "light" ? "text-foreground" : "text-slate-200")}>
                      {shortPath(snapshot.diagnostics.workspaceRoot, 56)}
                    </p>
                  </div>
                </Card>
              </section>
              ) : null}

              {renderedActiveSection === "diagnostics" ? (
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
                          ? "border-border bg-card text-muted-foreground"
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
                    <NativeDoctorPanel surfaceTheme={surfaceTheme} />
                    <RuntimeInboxPanel
                      snapshot={snapshot}
                      surfaceTheme={surfaceTheme}
                      variant="full"
                      onSnapshotChange={onSnapshotChange}
                    />
                    <TransportDiagnosticsPanel summary={transportSummary} surfaceTheme={surfaceTheme} />
                    {gatewayFallbackDiagnostics.length ? (
                      <div
                        className={cn(
                          "border-l-2 py-1 pl-3",
                          surfaceTheme === "light" ? "border-amber-300" : "border-amber-300/45"
                        )}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className={labelClassName(surfaceTheme)}>Gateway fallback diagnostics</p>
                          <span className={cn("text-[11px]", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>
                            {gatewayFallbackDiagnostics.length} recent
                          </span>
                        </div>
                        <div className="mt-2 space-y-2">
                          {gatewayFallbackDiagnostics.map((diagnostic) => (
                            <div key={`${diagnostic.at}-${diagnostic.operation}`} className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={cn("text-sm font-medium", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}>
                                  {diagnostic.operationLabel}
                                </span>
                                <code className={cn("rounded-full px-2 py-0.5 text-[10px]", surfaceTheme === "light" ? "bg-muted text-muted-foreground" : "bg-white/[0.06] text-slate-300")}>
                                  {diagnostic.operation}
                                </code>
                                <span className={cn("text-[11px]", surfaceTheme === "light" ? "text-amber-700" : "text-amber-200")}>
                                  {formatGatewayFallbackDiagnosticKind(diagnostic.kind)}
                                </span>
                                <span className={cn("text-[11px]", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-500")}>
                                  {formatTimestamp(diagnostic.at)}
                                </span>
                              </div>
                              <p className={cn("mt-1 text-xs", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>
                                Reason: {diagnostic.issue}
                              </p>
                              <p className={cn("mt-0.5 text-xs", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-500")}>
                                Recovery: {diagnostic.recovery || resolveGatewayFallbackRecovery(diagnostic.kind)}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {latestCommands.length ? (
                      latestCommands.map((command) => (
                        <details
                          key={command.id}
                          className={cn(
                            "group rounded-[16px] border",
                            surfaceTheme === "light"
                              ? "border-border bg-card"
                              : "border-white/[0.08] bg-[#101a2a]/92"
                          )}
                        >
                          <summary className="flex cursor-pointer list-none items-center gap-3 px-3.5 py-2.5">
                            <code className={cn("min-w-0 flex-1 truncate font-mono text-[11px]", surfaceTheme === "light" ? "text-foreground" : "text-slate-200")}>
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
                            <span className={cn("hidden text-xs sm:inline", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>
                              {command.durationMs} ms
                            </span>
                            <ChevronDown className={cn("h-4 w-4 transition-transform group-open:rotate-180", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")} />
                          </summary>
                          <div
                            className={cn(
                              "border-t p-3.5",
                              surfaceTheme === "light" ? "border-border" : "border-white/[0.08]"
                            )}
                          >
                            <div className="grid gap-3 sm:grid-cols-2">
                              <DiagnosticBlock title="stdout" value={command.stdoutPreview} surfaceTheme={surfaceTheme} />
                              <DiagnosticBlock title="stderr" value={command.stderrPreview} surfaceTheme={surfaceTheme} />
                            </div>
                            <p className={cn("mt-3 text-xs", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>
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

              {renderedActiveSection === "agents" ? (
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

              {renderedActiveSection === "advanced" ? (
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
                        ? "border border-border bg-muted/45"
                        : "border border-white/[0.08] bg-[#101a2a]/92"
                    )}
                  >
                    <p className={labelClassName(surfaceTheme)}>Install root</p>
                    <p className={cn("mt-2 break-all text-sm", surfaceTheme === "light" ? "text-foreground" : "text-slate-200")}>
                      {shortPath(snapshot.diagnostics.updateRoot || installSummary.root || "Not detected", 80)}
                    </p>
                  </div>
                  <div
                    className={cn(
                      "mt-4 rounded-[18px] p-3.5",
                      surfaceTheme === "light"
                        ? "border border-border bg-muted/45"
                        : "border border-white/[0.08] bg-[#101a2a]/92"
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className={labelClassName(surfaceTheme)}>Config update pacing</p>
                        <p className={cn("mt-1 text-xs leading-5", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>
                          Controls how often AgentOS attempts OpenClaw config updates. It does not change the OpenClaw Gateway rate limit.
                        </p>
                      </div>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.12em]",
                          configUpdatePacing.pending
                            ? surfaceTheme === "light"
                              ? "border-amber-200 bg-amber-50 text-amber-700"
                              : "border-amber-300/24 bg-amber-300/[0.08] text-amber-200"
                            : surfaceTheme === "light"
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-200"
                        )}
                      >
                        {configUpdatePacing.pending ? "Pending config update" : "Idle"}
                      </span>
                    </div>

                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <button
                        type="button"
                        onClick={() => setConfigUpdatePacingMode("respect-gateway")}
                        className={segmentedButtonClassName(surfaceTheme, configUpdatePacingMode === "respect-gateway")}
                      >
                        Respect Gateway
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfigUpdatePacingMode("fast-local-testing")}
                        className={segmentedButtonClassName(surfaceTheme, configUpdatePacingMode === "fast-local-testing")}
                      >
                        Fast testing
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfigUpdatePacingMode("custom")}
                        className={segmentedButtonClassName(surfaceTheme, configUpdatePacingMode === "custom")}
                      >
                        Custom
                      </button>
                    </div>

                    {configUpdatePacingMode === "custom" ? (
                      <div className="mt-3">
                        <Label className={labelClassName(surfaceTheme)}>Minimum local interval, seconds</Label>
                        <Input
                          type="number"
                          min={1}
                          max={600}
                          value={configUpdatePacingCustomSeconds}
                          onChange={(event) => setConfigUpdatePacingCustomSeconds(event.target.value)}
                          className={inputClassName(surfaceTheme, "mt-2")}
                        />
                      </div>
                    ) : null}

                    <InfoRows
                      surfaceTheme={surfaceTheme}
                      rows={[
                        ["Current mode", formatConfigUpdatePacingMode(configUpdatePacing.settings.mode)],
                        ["Minimum local interval", formatConfigUpdatePacingInterval(configUpdatePacing.settings.minimumIntervalMs)],
                        ["Queue durability", configUpdatePacing.queueDurability === "persistent" ? "Persistent AgentOS sidecar queue" : "Volatile memory"],
                        ["Pending paths", configUpdatePacing.pendingPaths.length ? configUpdatePacing.pendingPaths.join(", ") : "None"],
                        ["Pending since", configUpdatePacing.pendingSince ? formatTimestamp(configUpdatePacing.pendingSince) : "None"],
                        ["Retry countdown", configUpdatePacingRetryMs !== null ? formatConfigUpdatePacingInterval(configUpdatePacingRetryMs) : "None"],
                        ["Last update", configUpdatePacing.lastUpdatedAt ? formatTimestamp(configUpdatePacing.lastUpdatedAt) : "None"],
                        ["CLI fallback", "Disabled for Gateway config cooldown recovery"]
                      ]}
                    />

                    {configUpdatePacing.lastIssue ? (
                      <p className={cn("mt-3 text-xs leading-5", surfaceTheme === "light" ? "text-amber-700" : "text-amber-200")}>
                        Last Gateway issue: {configUpdatePacing.lastIssue}
                      </p>
                    ) : null}
                    {configUpdatePacingError ? (
                      <p className={cn("mt-3 text-xs leading-5", surfaceTheme === "light" ? "text-red-700" : "text-rose-300")}>
                        {configUpdatePacingError}
                      </p>
                    ) : null}
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void saveConfigUpdatePacing()}
                      disabled={isSavingConfigUpdatePacing}
                      className={cn(secondaryButtonClassName(surfaceTheme), "mt-3 w-full")}
                    >
                      {isSavingConfigUpdatePacing ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      Save pacing
                    </Button>
                  </div>

                  <div className={cn("mt-5 border-t pt-5", surfaceTheme === "light" ? "border-border" : "border-white/10")}>
                    <div className="flex flex-col gap-1">
                      <p className={cn("text-sm font-medium", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}>Compatibility Lab</p>
                      <p className={cn("text-xs leading-5", mutedTextClassName(surfaceTheme))}>
                        Advanced exact-version testing, certification, preflight, rollback, and native contract evidence. Normal updates stay on Operations → Updates.
                      </p>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void runUpdatePreflight(defaultUpdateTargetVersion, defaultUpdateMode)}
                        disabled={!defaultUpdateTargetVersion || isRunningUpdatePreflight || updateRunState === "running"}
                        className={secondaryButtonClassName(surfaceTheme, "px-4")}
                      >
                        {isRunningUpdatePreflight ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <ListChecks className="h-3.5 w-3.5" />}
                        Run preflight
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void runShadowProbe(defaultUpdateTargetVersion, defaultUpdateMode)}
                        disabled={!defaultUpdateTargetVersion || isRunningShadowProbe || updateRunState === "running"}
                        className={secondaryButtonClassName(surfaceTheme, "px-4")}
                      >
                        {isRunningShadowProbe ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                        Test target safely
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void runCompatibilityLabReport(defaultUpdateTargetVersion)}
                        disabled={!defaultUpdateTargetVersion || isGeneratingCompatibilityLabReport || updateRunState === "running"}
                        className={secondaryButtonClassName(surfaceTheme, "px-4")}
                      >
                        {isGeneratingCompatibilityLabReport ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Microscope className="h-3.5 w-3.5" />}
                        Generate report
                      </Button>
                      {canVerifyLatestUpdate ? (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => onOpenUpdateDialog(latestVersion ?? undefined, "advanced")}
                          disabled={updateRunState === "running"}
                          className={secondaryButtonClassName(surfaceTheme, "px-4")}
                        >
                          <Microscope className="h-3.5 w-3.5" />
                          Install and verify latest
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={onRollbackOpenClaw}
                        disabled={updateRunState === "running"}
                        className={secondaryButtonClassName(surfaceTheme, "px-4")}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Recovery rollback
                      </Button>
                    </div>

                    {updateSafetyError ? (
                      <p className={cn("mt-3 text-xs leading-5", surfaceTheme === "light" ? "text-rose-700" : "text-rose-200")}>
                        {updateSafetyError}
                      </p>
                    ) : null}

                    <UpdateSafetyPanel
                      report={updateSafetyReport}
                      shadowProbeReport={shadowProbeReport}
                      surfaceTheme={surfaceTheme}
                    />

                    <CompatibilityLabPanel
                      report={compatibilityLabReport}
                      bundle={codexFixBundle}
                      scorecard={updateCertificationScorecard}
                      promotion={certificationPromotion}
                      error={compatibilityLabError}
                      isGeneratingReport={isGeneratingCompatibilityLabReport}
                      isGeneratingBundle={isGeneratingCodexFixBundle}
                      isPromotingCertification={isPromotingCertification}
                      isUpdateRunning={updateRunState === "running"}
                      onGenerateReport={() => void runCompatibilityLabReport(defaultUpdateTargetVersion)}
                      onGenerateBundle={() => void generateCodexFixBundle()}
                      onRunCertification={(targetVersion) => onOpenUpdateDialog(targetVersion, "advanced")}
                      onCertifyTarget={() => void certifyCompatibilityTarget()}
                      surfaceTheme={surfaceTheme}
                    />

                    <UpdateRegistryPanel
                      surfaceTheme={surfaceTheme}
                      isCheckingForUpdates={isCheckingForUpdates}
                      isUpdateRegistryLoading={isUpdateRegistryLoading}
                      hasCertifiedUpdateAvailable={hasCertifiedUpdateAvailable}
                      hasRegistryUpdateAvailable={hasRegistryUpdateAvailable}
                      currentVersion={currentVersion}
                      recommendedVersion={recommendedVersion}
                      latestVersion={latestVersion}
                      latestDecision={updateCompatibility?.latestDecision ?? null}
                      updateInfo={updateInfo}
                      updateError={updateError}
                      lastCheckedAt={lastCheckedAt}
                      isUpdateRunning={updateRunState === "running"}
                      updateCompatibility={updateCompatibility}
                      onTryPreviewVersion={(version) => onOpenUpdateDialog(version, "candidate")}
                    />
                  </div>
                </Card>
              </section>
              ) : null}

              {renderedActiveSection === "danger-zone" ? (
              <section id="danger-zone" className="scroll-mt-24">
                <div
                  className={cn(
                    "rounded-[18px] p-4 shadow-[0_18px_44px_rgba(185,28,28,0.06)]",
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
            <div className="hidden gap-4 xl:grid xl:grid-cols-3">
              <Card title="Context" icon={activeSectionConfig.icon} surfaceTheme={surfaceTheme}>
                <InfoRows
                  surfaceTheme={surfaceTheme}
                  rows={[
                    ["Active section", activeSectionLabel],
                    ["Focus", activeSectionConfig.destructive ? "Recovery / confirmation" : "Operational settings"],
                    ["Related", relatedSectionIds.map((id) => settingsSections.find((section) => section.id === id)?.label ?? id).join(" · ")],
                  ]}
                />
              </Card>

              <Card title="Related sections" icon={ChevronRight} surfaceTheme={surfaceTheme}>
                <div className="grid gap-2">
                  {relatedSectionIds.map((sectionId) => {
                    const section = settingsSections.find((entry) => entry.id === sectionId);
                    if (!section) {
                      return null;
                    }

                    const Icon = section.icon;
                    const active = renderedActiveSection === section.id;

                    return (
                      <Link
                        key={section.id}
                        href={`/settings#${section.id}`}
                        scroll={false}
                        aria-current={active ? "page" : undefined}
                        onClick={() => {
                          setActiveSection(section.id);
                          scrollSettingsToTop();
                        }}
                        className={cn(
                          "flex items-center justify-between gap-3 rounded-[16px] border px-3 py-2 text-sm transition-colors",
                          active
                            ? surfaceTheme === "light"
                              ? "border-primary/25 bg-primary/8 text-primary"
                              : "border-primary/25 bg-primary/10 text-primary"
                            : surfaceTheme === "light"
                              ? "border-border bg-card/70 text-foreground hover:bg-muted/55"
                              : "border-border bg-white/[0.035] text-slate-200 hover:bg-white/[0.06]"
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] border", active ? "border-primary/15 bg-primary/10 text-primary" : "border-border bg-transparent text-current/80")}>
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0 truncate">{section.label}</span>
                        </span>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" />
                      </Link>
                    );
                  })}
                </div>
              </Card>

              <Card title="Snapshot" icon={Activity} surfaceTheme={surfaceTheme}>
                <InfoRows
                  surfaceTheme={surfaceTheme}
                  rows={[
                    ["OpenClaw", snapshot.diagnostics.version ? `v${snapshot.diagnostics.version}` : "Unknown"],
                    ["Transport", transportSummary.statusLabel],
                    ["Fallback", `${transportSummary.fallbackTotal} operations`],
                    ["Compatibility", compatibilityReport ? formatCompatibilityReportStatus(compatibilityReport.status) : "Unknown"]
                  ]}
                />
              </Card>
            </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}

function SettingsSectionNavigation({
  activeSection,
  onSelect,
  surfaceTheme
}: {
  activeSection: SettingsSectionId;
  onSelect: (sectionId: SettingsSectionId) => void;
  surfaceTheme: SurfaceTheme;
}) {
  const activeSectionConfig = settingsSections.find((section) => section.id === activeSection) ?? settingsSections[0];
  const ActiveIcon = activeSectionConfig.icon;

  const renderSectionLink = (section: SettingsSection, mobile = false) => {
    const active = section.id === activeSection;
    const Icon = section.icon;

    return (
      <Link
        key={section.id}
        href={`/settings#${section.id}`}
        scroll={false}
        aria-current={active ? "page" : undefined}
        onClick={(event) => {
          if (mobile) {
            event.currentTarget.closest("details")?.removeAttribute("open");
          }
          onSelect(section.id);
        }}
        className={cn(
          "group flex min-w-0 items-center rounded-xl border font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
          mobile ? "gap-3 px-3 py-2.5 text-sm" : "gap-2.5 px-2.5 py-1.5 text-[0.8rem]",
          active
            ? section.destructive
              ? "border-destructive/25 bg-destructive/12 text-destructive"
              : surfaceTheme === "light"
                ? "border-primary/20 bg-primary/10 text-primary"
                : "border-primary/30 bg-primary/15 text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
            : section.destructive
              ? "border-transparent text-destructive/80 hover:border-destructive/15 hover:bg-destructive/8 hover:text-destructive"
              : surfaceTheme === "light"
                ? "border-transparent text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                : "border-transparent text-slate-300 hover:border-white/[0.08] hover:bg-white/[0.055] hover:text-slate-50"
        )}
      >
        <span className={cn(
          "flex shrink-0 items-center justify-center rounded-[10px] border transition-colors",
          mobile ? "h-8 w-8" : "h-7 w-7",
          active
            ? section.destructive
              ? "border-destructive/20 bg-destructive/10"
              : "border-primary/20 bg-primary/10"
            : "border-border bg-transparent group-hover:border-current/15"
        )}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="truncate">{section.label}</span>
        {active ? <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-current" /> : null}
      </Link>
    );
  };

  return (
    <>
      <details
        className={cn(
          "group overflow-hidden rounded-[18px] border lg:hidden",
          surfaceTheme === "light"
            ? "border-border bg-card"
            : "border-white/[0.10] bg-[#0d1725] shadow-[0_18px_44px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.035)]"
        )}
      >
        <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 px-3.5 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/35 [&::-webkit-details-marker]:hidden">
          <span className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border",
            activeSectionConfig.destructive ? "border-destructive/20 bg-destructive/10 text-destructive" : "border-primary/20 bg-primary/10 text-primary"
          )}>
            <ActiveIcon className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className={cn("block text-[0.65rem] font-semibold uppercase tracking-[0.13em]", mutedTextClassName(surfaceTheme))}>Settings section</span>
            <span className="block truncate text-sm font-semibold">{activeSectionConfig.label}</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-60 transition-transform group-open:rotate-180" />
        </summary>
        <nav aria-label="Settings sections" className={cn("border-t px-2.5 pb-3 pt-2", surfaceTheme === "light" ? "border-border" : "border-white/[0.09] bg-[#0a1320]")}>
          {settingsSectionGroups.map((group) => (
            <div key={group} className="pt-2 first:pt-0">
              <p className={cn("px-3 pb-1 text-[0.62rem] font-semibold uppercase tracking-[0.14em]", mutedTextClassName(surfaceTheme))}>{group}</p>
              <div className="grid gap-0.5 sm:grid-cols-2">
                {settingsSections.filter((section) => section.group === group).map((section) => renderSectionLink(section, true))}
              </div>
            </div>
          ))}
        </nav>
      </details>

      <aside
        className={cn(
          "sticky top-[92px] hidden max-h-[calc(100dvh-112px)] overflow-y-auto rounded-[20px] border p-2.5 lg:block",
          surfaceTheme === "light"
            ? "border-border bg-card"
            : "border-white/[0.10] bg-[#0d1725] shadow-[0_18px_44px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.035)]"
        )}
      >
        <div className="px-3 pb-2 pt-1">
          <p className="text-sm font-semibold">Sections</p>
          <p className={cn("mt-1 text-xs leading-5", mutedTextClassName(surfaceTheme))}>Choose a section to configure.</p>
        </div>
        <nav aria-label="Settings sections" className="space-y-3">
          {settingsSectionGroups.map((group) => (
            <div key={group}>
              <p className={cn("px-3 pb-1 text-[0.62rem] font-semibold uppercase tracking-[0.14em]", mutedTextClassName(surfaceTheme))}>{group}</p>
              <div className="space-y-0.5">
                {settingsSections.filter((section) => section.group === group).map((section) => renderSectionLink(section))}
              </div>
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}

function SettingsToggle({
  checked,
  disabled,
  loading,
  label,
  onCheckedChange,
  surfaceTheme
}: {
  checked: boolean;
  disabled: boolean;
  loading: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
  surfaceTheme: SurfaceTheme;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className={cn(
        "hidden min-w-5 text-right text-[10px] font-semibold uppercase tracking-[0.08em] sm:block",
        checked
          ? surfaceTheme === "light" ? "text-emerald-700" : "text-emerald-300"
          : mutedTextClassName(surfaceTheme)
      )}>
        {loading ? "…" : checked ? "On" : "Off"}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={`${label}: ${checked ? "enabled" : "disabled"}`}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ring/45 disabled:cursor-wait disabled:opacity-60 sm:h-8 sm:w-10"
      >
        <span
          aria-hidden="true"
          className={cn(
            "relative h-5 w-9 rounded-full border transition-colors",
            checked
              ? "border-primary/45 bg-primary"
              : surfaceTheme === "light"
                ? "border-slate-300 bg-slate-200"
                : "border-white/[0.12] bg-[#1a2638]"
          )}
        >
          {loading ? (
            <LoaderCircle className={cn("absolute left-2 top-0.5 h-4 w-4 animate-spin", surfaceTheme === "light" ? "text-slate-500" : "text-slate-300")} />
          ) : (
            <span className={cn(
              "absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.32)] transition-transform",
              checked && "translate-x-4"
            )} />
          )}
        </span>
      </button>
    </div>
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
        "min-h-full min-w-0 rounded-[18px] p-3.5 shadow-[0_16px_40px_rgba(101,74,54,0.07)] backdrop-blur-xl sm:p-4",
        cardClassName(surfaceTheme)
      )}
    >
      <div className="flex min-w-0 items-center justify-between gap-3 sm:gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className={cardIconClassName(surfaceTheme)}>
            <Icon className="h-4 w-4" />
          </span>
          <h2 className={cn("min-w-0 truncate font-display text-lg", surfaceTheme === "light" ? "text-[#2d211b]" : "text-slate-100")}>
            {title}
          </h2>
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  detail,
  surfaceTheme,
  accent = false,
  compact = false
}: {
  label: string;
  value: string;
  detail?: string;
  surfaceTheme: SurfaceTheme;
  accent?: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        compact ? "rounded-[14px] border p-2.5" : "rounded-[18px] border p-3.5",
        surfaceTheme === "light"
          ? accent
            ? "border-primary/20 bg-primary/8"
            : "border-border bg-card/86"
          : accent
            ? "border-primary/30 bg-primary/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
            : "border-white/[0.10] bg-[#111c2c] shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]"
      )}
    >
      <p className={cn(compact ? "text-[9px] uppercase tracking-[0.16em]" : "text-[10px] uppercase tracking-[0.18em]", mutedTextClassName(surfaceTheme))}>
        {label}
      </p>
      <p
        className={cn(
          compact ? "mt-1 truncate text-xs font-medium leading-4" : "mt-2 truncate text-sm font-medium",
          surfaceTheme === "light" ? "text-[#1f1712]" : "text-slate-100"
        )}
        title={value}
      >
        {value}
      </p>
      {detail ? (
        <p className={cn(compact ? "mt-0.5 hidden text-[10px] leading-4 sm:block" : "mt-1 text-[11px] leading-4", mutedTextClassName(surfaceTheme))}>{detail}</p>
      ) : null}
    </div>
  );
}

function StatusPill({
  label,
  tone,
  surfaceTheme
}: {
  label: string;
  tone: "success" | "warning" | "danger" | "neutral";
  surfaceTheme: SurfaceTheme;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[10px] font-medium",
        tone === "success"
          ? surfaceTheme === "light"
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-200"
          : tone === "warning"
            ? surfaceTheme === "light"
              ? "border-amber-200 bg-amber-50 text-amber-700"
              : "border-amber-300/24 bg-amber-300/[0.08] text-amber-200"
            : tone === "danger"
              ? surfaceTheme === "light"
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-rose-300/20 bg-rose-300/[0.08] text-rose-200"
              : surfaceTheme === "light"
                ? "border-border bg-card text-muted-foreground"
                : "border-white/10 bg-white/[0.04] text-slate-300"
      )}
    >
      {label}
    </span>
  );
}

function SettingsInlineLink({
  href,
  label,
  surfaceTheme,
  onActivate
}: {
  href: string;
  label: string;
  surfaceTheme: SurfaceTheme;
  onActivate: () => void;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      onClick={onActivate}
      className={cn("mt-4 inline-flex items-center gap-2 text-xs font-medium", surfaceTheme === "light" ? "text-primary" : "text-primary")}
    >
      {label}
      <ChevronRight className="h-3.5 w-3.5" />
    </Link>
  );
}

function SettingsActionRow({
  icon: Icon,
  label,
  href,
  surfaceTheme,
  onActivate
}: {
  icon: LucideIcon;
  label: string;
  href: string;
  surfaceTheme: SurfaceTheme;
  onActivate: () => void;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      onClick={onActivate}
      className={cn(
        "flex min-h-12 items-center justify-between gap-3 rounded-[14px] border px-3.5 py-2.5 text-sm font-medium transition-colors",
        surfaceTheme === "light"
          ? "border-border bg-card/80 text-foreground hover:border-primary/25 hover:bg-muted/55"
          : "border-border bg-white/[0.035] text-slate-100 hover:border-primary/25 hover:bg-white/[0.06]"
      )}
    >
      <span className="flex min-w-0 items-center gap-3">
        <Icon className={cn("h-4 w-4 shrink-0", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")} />
        <span className="min-w-0 truncate">{label}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 opacity-60" />
    </Link>
  );
}

function CapabilityBaselineComparisonPanel({
  diff,
  scorecard,
  snapshot,
  summary,
  surfaceTheme
}: {
  diff: OpenClawCapabilityDiffReport | null;
  scorecard: OpenClawCertificationScorecardReport | null;
  snapshot: MissionControlShellSettingsPanelProps["snapshot"];
  summary: OpenClawCapabilityMatrixSummary;
  surfaceTheme: SurfaceTheme;
}) {
  const activeVersion = normalizeUpdateVersion(snapshot.diagnostics.version ?? summary.openClawVersionLabel);
  const certifiedVersion = normalizeUpdateVersion(
    snapshot.diagnostics.updateCompatibility?.recommendedVersion ??
      snapshot.diagnostics.compatibilityReport?.openClaw.recommendedVersion ??
      summary.recommendedVersionLabel
  );
  const hasVersionDelta = Boolean(activeVersion && certifiedVersion && activeVersion !== certifiedVersion);
  const diffMatchesActive =
    Boolean(diff) &&
    normalizeUpdateVersion(diff?.targetVersion) === activeVersion &&
    normalizeUpdateVersion(diff?.certifiedVersion) === certifiedVersion;
  const scorecardMatchesActive =
    Boolean(scorecard) &&
    normalizeUpdateVersion(scorecard?.targetVersion) === activeVersion &&
    normalizeUpdateVersion(scorecard?.baselineVersion) === certifiedVersion;
  const capabilityEquivalent = Boolean(diffMatchesActive && diff!.summary.certificationBlockerCount === 0);
  const blockerRows = diffMatchesActive
    ? diff!.rows.filter((row) => isCapabilityDiffTargetBlocker(row))
    : [];
  const changedRows = diffMatchesActive
    ? diff!.rows.filter((row) => row.changeKind !== "unchanged")
    : [];
  const visibleRows = Array.from(new Map([...blockerRows, ...changedRows].map((row) => [row.operationId, row])).values()).slice(0, 5);
  const hasRuntimeGaps =
    summary.missingRequiredOperationCount > 0 || summary.unknownOrDegradedOperationCount > 0;
  const statusLabel = !hasVersionDelta
    ? "Baseline active"
    : scorecardMatchesActive
      ? scorecard!.globalCertification === "certified"
        ? "Certified"
        : capabilityEquivalent
          ? "Capability-equivalent"
          : formatScorecardStatus(scorecard!.status)
      : diffMatchesActive
        ? diff!.summary.certificationBlockerCount > 0
        ? "Review blockers"
        : hasRuntimeGaps
          ? "Runtime gaps remain"
          : "Capability-equivalent"
      : "Diff evidence missing";
  const statusTone = !hasVersionDelta
    ? "success"
    : scorecardMatchesActive
      ? scorecard!.status === "blocked" || scorecard!.status === "evidence_missing"
        ? "danger"
        : scorecard!.status === "compatible_with_warnings" || scorecard!.status === "degraded"
          ? "warning"
          : "success"
      : diffMatchesActive
        ? diff!.summary.certificationBlockerCount > 0
          ? "danger"
          : hasRuntimeGaps
            ? "warning"
            : "success"
      : "warning";

  return (
    <div
      className={cn(
        "rounded-[20px] border p-4",
        surfaceTheme === "light" ? "border-[#e3d4c8] bg-[#fffaf6]" : "border-white/8 bg-white/[0.03]"
      )}
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn("text-[10px] uppercase tracking-[0.22em]", mutedTextClassName(surfaceTheme))}>
            Certified baseline comparison
          </p>
          <h3 className={cn("mt-1 break-words text-sm font-medium", surfaceTheme === "light" ? "text-[#4a382c]" : "text-white")}>
            {formatVersionValue(certifiedVersion)} {"->"} {formatVersionValue(activeVersion)}
          </h3>
        </div>
        <span className={comparisonStatusClassName(statusTone, surfaceTheme)}>{statusLabel}</span>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <Metric
          label="Capability"
          value={capabilityEquivalent ? "Equivalent" : diffMatchesActive ? "Changed" : "-"}
          surfaceTheme={surfaceTheme}
          dark={surfaceTheme === "dark"}
          compact
        />
        <Metric
          label="Certification"
          value={scorecardMatchesActive ? (scorecard!.globalCertification === "certified" ? "Certified" : "Not certified") : "-"}
          surfaceTheme={surfaceTheme}
          dark={surfaceTheme === "dark"}
          compact
        />
        <Metric
          label="Score"
          value={scorecardMatchesActive ? `${scorecard!.score}/100` : "-"}
          surfaceTheme={surfaceTheme}
          dark={surfaceTheme === "dark"}
          compact
        />
        <Metric
          label="Hard blockers"
          value={scorecardMatchesActive ? String(scorecard!.hardBlockers.length) : diffMatchesActive ? String(diff!.summary.certificationBlockerCount) : "-"}
          surfaceTheme={surfaceTheme}
          dark={surfaceTheme === "dark"}
          compact
        />
      </div>

      <p className={cn("mt-3 text-xs leading-5", mutedTextClassName(surfaceTheme))}>
        {!hasVersionDelta
          ? "The active OpenClaw version is the certified baseline, so this page is showing baseline runtime capabilities."
          : scorecardMatchesActive
            ? scorecard!.globalCertification === "certified"
              ? "The active version is globally certified by the AgentOS compatibility registry."
              : capabilityEquivalent
                ? "Capability-equivalent does not certify update, rollback, plugin, config, or runtime behavior. Review the certification scorecard before promoting this version."
                : "The active version is not globally certified. The scorecard includes capability, gateway lifecycle, runtime smoke, update/rollback, and plugin/config evidence."
            : diffMatchesActive
              ? diff!.summary.certificationBlockerCount > 0
              ? "The active version is newer than the certified baseline. The diff was captured during install-and-verify and still has target blockers below."
              : hasRuntimeGaps
                ? "The install-and-verify diff did not add new regressions, but the active runtime matrix still has required or degraded capability gaps."
                : "The active version is capability-equivalent to the certified baseline, but certification scorecard evidence is missing."
            : "This page is showing the active runtime capability matrix only. Run Install and verify latest to capture a certified-vs-active diff for this browser session."}
      </p>

      {visibleRows.length > 0 ? (
        <div className="mt-3 grid gap-2">
          {visibleRows.map((row) => (
            <div
              key={row.operationId}
              className={cn(
                "grid gap-2 rounded-[14px] border px-3 py-2 text-xs sm:grid-cols-[minmax(0,1fr)_minmax(0,10rem)]",
                surfaceTheme === "light" ? "border-[#eadccf] bg-white/70" : "border-white/8 bg-slate-950/25"
              )}
            >
              <div className="min-w-0">
                <p className={cn("break-words font-medium", surfaceTheme === "light" ? "text-[#4a382c]" : "text-slate-100")}>
                  {row.label}
                </p>
                <p className={cn("mt-0.5 break-all", mutedTextClassName(surfaceTheme))}>{row.operationId}</p>
              </div>
              <div className={cn("min-w-0 break-words sm:text-right", mutedTextClassName(surfaceTheme))}>
                <p>{formatCapabilityDiffMode(row.certifiedMode)} {"->"} {formatCapabilityDiffMode(row.targetMode)}</p>
                <p className="mt-0.5">
                  {isCapabilityDiffTargetBlocker(row) ? "Target blocker" : formatCapabilityDiffChange(row.changeKind)}
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function isCapabilityDiffTargetBlocker(row: OpenClawCapabilityDiffReport["rows"][number]) {
  return (
    row.severity === "regression" ||
    row.targetMode === "missing" ||
    row.targetMode === "disabled" ||
    row.missingRequiredMethods.length > 0
  );
}

function comparisonStatusClassName(tone: "success" | "warning" | "danger", surfaceTheme: SurfaceTheme) {
  const base = "rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.14em]";

  if (tone === "danger") {
    return cn(base, surfaceTheme === "light" ? "border-rose-300 bg-rose-50 text-rose-700" : "border-rose-300/25 bg-rose-300/10 text-rose-100");
  }

  if (tone === "warning") {
    return cn(base, surfaceTheme === "light" ? "border-amber-300 bg-amber-50 text-amber-700" : "border-amber-300/25 bg-amber-300/10 text-amber-100");
  }

  return cn(base, surfaceTheme === "light" ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-emerald-300/25 bg-emerald-300/10 text-emerald-100");
}

function formatScorecardStatus(value: OpenClawCertificationScorecardReport["status"]) {
  switch (value) {
    case "certified":
      return "Certified";
    case "pre_certified_eligible":
      return "Pre-certified eligible";
    case "compatible_with_warnings":
      return "Compatible with warnings";
    case "degraded":
      return "Degraded";
    case "blocked":
      return "Blocked";
    case "evidence_missing":
      return "Evidence missing";
  }
}

function formatCapabilityDiffMode(value: string) {
  switch (value) {
    case "gateway-native":
      return "Native";
    case "cli-fallback":
      return "CLI";
    case "degraded":
      return "Degraded";
    case "disabled":
      return "Disabled";
    case "unknown":
      return "Unknown";
    case "missing":
      return "Missing";
    default:
      return value;
  }
}

function formatCapabilityDiffChange(value: OpenClawCapabilityDiffReport["rows"][number]["changeKind"]) {
  switch (value) {
    case "added":
      return "Added";
    case "removed":
      return "Removed";
    case "mode-changed":
      return "Mode changed";
    case "method-changed":
      return "Methods changed";
    case "fallback-changed":
      return "Fallback changed";
    case "unchanged":
      return "Unchanged";
  }
}

function metricBadgeClassName(tone: "success" | "warning" | "danger" | "neutral", dark: boolean) {
  if (tone === "danger") {
    return dark
      ? "border-rose-300/25 bg-rose-300/10 text-rose-100"
      : "border-rose-300 bg-rose-50 text-rose-700";
  }

  if (tone === "warning") {
    return dark
      ? "border-amber-300/25 bg-amber-300/10 text-amber-100"
      : "border-amber-300 bg-amber-50 text-amber-700";
  }

  if (tone === "neutral") {
    return dark
      ? "border-slate-300/20 bg-slate-300/10 text-slate-200"
      : "border-slate-200 bg-slate-50 text-slate-600";
  }

  return dark
    ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100"
    : "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function Metric({
  label,
  value,
  badge,
  badgeTone = "success",
  surfaceTheme,
  dark = false,
  compact = false,
  wrapValue = false
}: {
  label: string;
  value: string;
  badge?: string;
  badgeTone?: "success" | "warning" | "danger" | "neutral";
  surfaceTheme: SurfaceTheme;
  dark?: boolean;
  compact?: boolean;
  wrapValue?: boolean;
}) {
  const cardToneIsDark = dark || surfaceTheme === "dark";
  return (
    <div className="min-w-0">
      <p className={cn("text-[11px]", cardToneIsDark ? "text-slate-400" : "text-muted-foreground")}>{label}</p>
      <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2">
        <p
          className={cn(
            "min-w-0 font-medium",
            wrapValue ? "break-words" : "truncate",
            compact ? "text-sm" : "text-[1.05rem]",
            cardToneIsDark ? "text-white" : "text-foreground"
          )}
          title={value}
        >
          {value}
        </p>
        {badge ? (
          <span
            className={cn(
              "shrink-0 rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.12em]",
              metricBadgeClassName(badgeTone, cardToneIsDark)
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
          <span className={cn("text-sm", cardToneIsDark ? "text-slate-400" : "text-muted-foreground")}>{label}</span>
          <span
            className={cn(
              "min-w-0 truncate text-right text-sm",
              cardToneIsDark ? "text-slate-100" : "text-foreground",
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
            : "border-border bg-muted/55 text-foreground"
        )}
      >
        {value || "No output"}
      </pre>
    </div>
  );
}

function CapabilityMatrixPanel({
  rows,
  summary,
  snapshot,
  updateCapabilityDiff,
  updateCertificationScorecard,
  contractComparison,
  surfaceTheme
}: {
  rows: OpenClawCapabilityMatrixRow[];
  summary: OpenClawCapabilityMatrixSummary;
  snapshot: MissionControlShellSettingsPanelProps["snapshot"];
  updateCapabilityDiff: OpenClawCapabilityDiffReport | null;
  updateCertificationScorecard: OpenClawCertificationScorecardReport | null;
  contractComparison: AgentOsOpenClawContractComparison;
  surfaceTheme: SurfaceTheme;
}) {
  const [showAllMobileCapabilityRows, setShowAllMobileCapabilityRows] = useState(false);
  const [surfaceSnapshot, setSurfaceSnapshot] = useState<GatewayProductSurfaceSnapshot | null>(null);
  const [surfaceSnapshotError, setSurfaceSnapshotError] = useState<string | null>(null);
  const [isLoadingSurfaceSnapshot, setIsLoadingSurfaceSnapshot] = useState(false);
  const rowsByStatus = {
    native: rows.filter((row) => row.status === "gateway-native"),
    fallback: rows.filter((row) => row.status === "cli-fallback" || row.fallbackCount > 0),
    missing: rows.filter((row) => row.status === "missing" || row.missingRequiredMethods.length > 0),
    degraded: rows.filter((row) => row.status === "degraded" || row.status === "unknown"),
    disabled: rows.filter((row) => row.status === "disabled")
  };
  const loadSurfaceSnapshot = useCallback(async () => {
    setIsLoadingSurfaceSnapshot(true);
    setSurfaceSnapshotError(null);

    try {
      const response = await fetch("/api/openclaw/gateway-surfaces", {
        cache: "no-store"
      });
      const result = (await response.json().catch(() => null)) as GatewayProductSurfaceSnapshot & { error?: string } | null;

      if (!response.ok || !result?.surfaces) {
        throw new Error(result?.error || "Gateway surface snapshot failed.");
      }

      setSurfaceSnapshot(result);
    } catch (error) {
      setSurfaceSnapshotError(error instanceof Error ? error.message : "Unable to load Gateway surface snapshot.");
    } finally {
      setIsLoadingSurfaceSnapshot(false);
    }
  }, []);

  useEffect(() => {
    void loadSurfaceSnapshot();
  }, [loadSurfaceSnapshot]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Active OpenClaw"
          value={summary.openClawVersionLabel}
          badge={`Certified baseline ${summary.recommendedVersionLabel}`}
          surfaceTheme={surfaceTheme}
          dark={surfaceTheme === "dark"}
          compact
          wrapValue
        />
        <Metric
          label="AgentOS compatibility"
          value={summary.agentOsCompatibilityLabel}
          badge={summary.gatewayProtocolLabel}
          surfaceTheme={surfaceTheme}
          dark={surfaceTheme === "dark"}
          compact
        />
        <Metric
          label="Native operations"
          value={`${summary.nativeOperationCount}/${summary.totalOperationCount}`}
          badge={summary.cliFallbackOperationCount > 0 ? `${summary.cliFallbackOperationCount} fallback` : "No fallback"}
          surfaceTheme={surfaceTheme}
          dark={surfaceTheme === "dark"}
          compact
        />
        <Metric
          label="Required gaps"
          value={String(summary.missingRequiredOperationCount)}
          badge={
            summary.missingRequiredOperationCount > 0
              ? `${summary.missingRequiredOperationCount} gaps`
              : summary.unknownOrDegradedOperationCount > 0
                ? `${summary.unknownOrDegradedOperationCount} unknown/degraded`
                : "Clear"
          }
          badgeTone={summary.missingRequiredOperationCount > 0 ? "danger" : summary.unknownOrDegradedOperationCount > 0 ? "warning" : "success"}
          surfaceTheme={surfaceTheme}
          dark={surfaceTheme === "dark"}
          compact
        />
      </div>

      <MobileSettingsDisclosure
        title="Certified baseline"
        description="Version delta, certification blockers, and update evidence."
        surfaceTheme={surfaceTheme}
      >
        <CapabilityBaselineComparisonPanel
          diff={updateCapabilityDiff}
          scorecard={updateCertificationScorecard}
          snapshot={snapshot}
          summary={summary}
          surfaceTheme={surfaceTheme}
        />
      </MobileSettingsDisclosure>

      <MobileSettingsDisclosure
        title="Contract registry"
        description={`${contractComparison.rows.length} OpenClaw contract operations with baseline and target evidence.`}
        surfaceTheme={surfaceTheme}
      >
        <ContractComparisonPanel
          comparison={contractComparison}
          surfaceTheme={surfaceTheme}
        />
      </MobileSettingsDisclosure>

      <MobileSettingsDisclosure
        title="Gateway product surfaces"
        description="Native product coverage, runtime inbox, and recovery paths."
        surfaceTheme={surfaceTheme}
      >
        <GatewayProductSurfacePanel
          snapshot={surfaceSnapshot}
          error={surfaceSnapshotError}
          loading={isLoadingSurfaceSnapshot}
          surfaceTheme={surfaceTheme}
          onRefresh={() => void loadSurfaceSnapshot()}
        />
      </MobileSettingsDisclosure>

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric
          label="CLI fallback calls"
          value={String(summary.fallbackTotal)}
          surfaceTheme={surfaceTheme}
          dark={surfaceTheme === "dark"}
          compact
        />
        <Metric
          label="Disabled operations"
          value={String(summary.disabledOperationCount)}
          surfaceTheme={surfaceTheme}
          dark={surfaceTheme === "dark"}
          compact
        />
        <Metric
          label="Last native failure"
          value={summary.lastNativeFailure || "None"}
          surfaceTheme={surfaceTheme}
          dark={surfaceTheme === "dark"}
          compact
        />
      </div>

      <InfoRows
        surfaceTheme={surfaceTheme}
        rows={[
          ["Native", `${rowsByStatus.native.length} operations`],
          ["CLI fallback", `${rowsByStatus.fallback.length} operations`],
          ["Missing required/native", `${rowsByStatus.missing.length} operations`],
          ["Unknown/degraded", `${rowsByStatus.degraded.length} operations`],
          ["Disabled", `${rowsByStatus.disabled.length} operations`]
        ]}
      />

      <MobileSettingsDisclosure
        title="Capability operations"
        description={`${rows.length} normalized operations grouped by native, fallback, and degraded state.`}
        surfaceTheme={surfaceTheme}
      >
      {rows.length > 0 ? (
        <div className="space-y-2">
          {rows.map((row, index) => (
            <details
              key={row.id}
              className={cn(
                "group rounded-[18px] border",
                index >= 8 && !showAllMobileCapabilityRows ? "hidden sm:block" : null,
                surfaceTheme === "light"
                  ? "border-border bg-card"
                  : "border-white/[0.08] bg-[#101a2a]/92"
              )}
            >
              <summary className="grid cursor-pointer list-none gap-3 px-3.5 py-3 sm:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={transportTonePillClassName(row.tone, surfaceTheme)}>
                      {row.statusLabel}
                    </span>
                    <span className={baselinePillClassName(row.baseline, surfaceTheme)}>
                      {formatCapabilityBaseline(row.baseline)}
                    </span>
                  </div>
                  <p className={cn("mt-2 truncate text-sm font-medium", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}>
                    {row.label}
                  </p>
                  <code className={cn("mt-1 block truncate text-[11px]", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>
                    {row.id}
                  </code>
                </div>
                <div className="min-w-0">
                  <p className={labelClassName(surfaceTheme)}>Native coverage</p>
                  <p className={cn("mt-1 truncate text-xs", surfaceTheme === "light" ? "text-foreground" : "text-slate-200")}>
                    {row.methodCoverageLabel}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className={labelClassName(surfaceTheme)}>CLI fallback</p>
                  <p className={cn("mt-1 truncate text-xs", row.fallbackCount > 0 ? surfaceTheme === "light" ? "text-amber-700" : "text-amber-200" : mutedTextClassName(surfaceTheme))}>
                    {row.fallbackAllowed ? `${row.fallbackCount} calls` : "Not allowed"}
                  </p>
                </div>
                <ChevronDown className={cn("h-4 w-4 transition-transform group-open:rotate-180", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")} />
              </summary>
              <div className={cn("border-t p-3.5", surfaceTheme === "light" ? "border-border" : "border-white/[0.08]")}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <CapabilityDetail label="Preferred method" value={row.preferredMethod || "Unknown"} surfaceTheme={surfaceTheme} />
                  <CapabilityDetail label="Supported method" value={row.supportedMethod || "Unknown"} surfaceTheme={surfaceTheme} />
                  <CapabilityDetail label="Alias methods" value={row.aliasMethods.length ? row.aliasMethods.join(", ") : "None"} surfaceTheme={surfaceTheme} />
                  <CapabilityDetail label="Gateway events" value={row.events.length ? row.events.join(", ") : "None"} surfaceTheme={surfaceTheme} />
                  <CapabilityDetail label="Compatibility" value={formatCapabilityCompatibility(row.compatibility)} surfaceTheme={surfaceTheme} />
                  <CapabilityDetail label="Fallback issue" value={row.fallbackIssue || "None"} surfaceTheme={surfaceTheme} />
                </div>

                {row.missingMethods.length > 0 ? (
                  <div className={cn("mt-3 rounded-[16px] border p-3 text-xs leading-5", surfaceTheme === "light" ? "border-red-200 bg-red-50 text-red-800" : "border-rose-300/20 bg-rose-300/10 text-rose-100")}>
                    Missing methods: {row.missingMethods.join(", ")}
                    {row.missingRequiredMethods.length > 0 ? ` / Required: ${row.missingRequiredMethods.join(", ")}` : ""}
                  </div>
                ) : null}

                <div className="mt-3 grid gap-2">
                  <p className={cn("text-xs leading-5", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-300")}>
                    Reason: {row.reason}
                  </p>
                  <p className={cn("text-xs leading-5", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>
                    Recovery: {row.recovery || row.fallbackRecovery || "No recovery suggestion reported."}
                  </p>
                  {row.fallbackKind ? (
                    <p className={cn("text-xs leading-5", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-500")}>
                      Last fallback kind: {formatGatewayFallbackDiagnosticKind(row.fallbackKind)}
                    </p>
                  ) : null}
                </div>
              </div>
            </details>
          ))}
          {!showAllMobileCapabilityRows && rows.length > 8 ? (
            <Button type="button" variant="secondary" className="h-11 w-full rounded-xl text-xs sm:hidden" onClick={() => setShowAllMobileCapabilityRows(true)}>
              Show {rows.length - 8} more capability operations
            </Button>
          ) : null}
        </div>
      ) : (
        <EmptyState
          title="No OpenClaw capability matrix"
          detail="AgentOS has not received Gateway capability diagnostics yet. Start or repair the OpenClaw Gateway, then refresh diagnostics."
          surfaceTheme={surfaceTheme}
        />
      )}
      </MobileSettingsDisclosure>
    </div>
  );
}

function MobileSettingsDisclosure({
  title,
  description,
  surfaceTheme,
  children
}: {
  title: string;
  description: string;
  surfaceTheme: SurfaceTheme;
  children: ReactNode;
}) {
  return (
    <details className={cn("group rounded-[18px] border sm:border-0", surfaceTheme === "light" ? "border-border bg-card sm:bg-transparent" : "border-white/[0.08] bg-[#0f1826] sm:bg-transparent")}>
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-3 py-3 sm:hidden">
        <span className="min-w-0 flex-1">
          <span className={cn("block text-sm font-semibold", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}>{title}</span>
          <span className={cn("mt-1 block text-xs leading-5", mutedTextClassName(surfaceTheme))}>{description}</span>
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform group-open:rotate-180", mutedTextClassName(surfaceTheme))} />
      </summary>
      <div className="p-3 pt-0 sm:!block sm:p-0">{children}</div>
    </details>
  );
}

function CapabilityDetail({
  label,
  value,
  surfaceTheme
}: {
  label: string;
  value: string;
  surfaceTheme: SurfaceTheme;
}) {
  return (
    <div className={cn("rounded-[16px] border p-3", insetPanelClassName(surfaceTheme))}>
      <p className={labelClassName(surfaceTheme)}>{label}</p>
      <p className={cn("mt-1.5 break-words text-xs leading-5", surfaceTheme === "light" ? "text-foreground" : "text-slate-200")}>
        {value}
      </p>
    </div>
  );
}

const contractComparisonFilters: Array<{
  id: AgentOsOpenClawContractComparisonFilter;
  label: string;
  icon: LucideIcon;
}> = [
  { id: "all", label: "All", icon: Box },
  { id: "blockers", label: "Blockers", icon: ShieldCheck },
  { id: "required", label: "Required", icon: Star },
  { id: "warnings", label: "Warnings", icon: TriangleAlert },
  { id: "payload-shape-changes", label: "Payload shape changes", icon: Microscope },
  { id: "cli-fallback", label: "CLI fallback", icon: SquareTerminal }
];

function ContractComparisonPanel({
  comparison,
  surfaceTheme
}: {
  comparison: AgentOsOpenClawContractComparison;
  surfaceTheme: SurfaceTheme;
}) {
  const [filter, setFilter] = useState<AgentOsOpenClawContractComparisonFilter>("all");
  const rows = filterAgentOsOpenClawContractRows(comparison.rows, filter);
  const showReportOnlyPill = comparison.targetEvidenceLabel === "Report-only, target not executed";

  return (
    <section
      className={cn(
        "overflow-hidden rounded-[18px] border p-4 shadow-[0_16px_42px_rgba(15,23,42,0.06)]",
        surfaceTheme === "light"
          ? "border-slate-200 bg-white text-slate-950"
          : "border-white/[0.08] bg-[#101a2a]/92 text-slate-100"
      )}
    >
      <ContractComparisonHeader
        evidenceLabel={comparison.installedEvidenceLabel}
        surfaceTheme={surfaceTheme}
      />

      <ContractSummaryStats
        comparison={comparison}
        showReportOnlyPill={showReportOnlyPill}
        surfaceTheme={surfaceTheme}
      />

      <ContractFilterChips
        filter={filter}
        onFilterChange={setFilter}
        surfaceTheme={surfaceTheme}
      />

      <ContractComparisonTable
        comparison={comparison}
        rows={rows}
        surfaceTheme={surfaceTheme}
      />
    </section>
  );
}

function ContractComparisonHeader({
  evidenceLabel,
  surfaceTheme
}: {
  evidenceLabel: string;
  surfaceTheme: SurfaceTheme;
}) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <p className={cn("text-[11px] font-semibold uppercase tracking-[0.2em]", surfaceTheme === "light" ? "text-blue-600" : "text-blue-300")}>
          Contract comparison
        </p>
        <h3 className={cn("mt-2 text-2xl font-semibold tracking-tight", surfaceTheme === "light" ? "text-slate-950" : "text-slate-50")}>
          AgentOS OpenClaw Contract Registry
        </h3>
        <p className={cn("mt-2 max-w-3xl text-sm leading-6", surfaceTheme === "light" ? "text-slate-600" : "text-slate-400")}>
          Baseline expectations are registry-backed. Installed and target columns show available evidence only.
        </p>
      </div>
      <span
        className={cn(
          "inline-flex h-9 shrink-0 items-center gap-2 self-start rounded-[10px] border px-3 text-sm font-medium",
          surfaceTheme === "light"
            ? "border-blue-300 bg-blue-50 text-blue-700"
            : "border-blue-300/25 bg-blue-300/10 text-blue-100"
        )}
      >
        <Database className="h-4 w-4" />
        {evidenceLabel}
      </span>
    </div>
  );
}

function ContractSummaryStats({
  comparison,
  showReportOnlyPill,
  surfaceTheme
}: {
  comparison: AgentOsOpenClawContractComparison;
  showReportOnlyPill: boolean;
  surfaceTheme: SurfaceTheme;
}) {
  const stats: Array<{
    label: string;
    value: string;
    icon: LucideIcon;
    tone: "blue" | "green" | "purple" | "amber" | "red" | "gray";
  }> = [
    { label: "Baseline", value: `v${comparison.baselineVersion}`, icon: Layers, tone: "blue" },
    { label: "Installed", value: comparison.installedVersion ? `v${comparison.installedVersion}` : "Evidence missing", icon: Download, tone: "green" },
    { label: "Target", value: comparison.targetVersion ? `v${comparison.targetVersion}` : "Evidence missing", icon: Target, tone: "purple" },
    { label: "Passed", value: String(comparison.summary.passed), icon: CheckCircle2, tone: "green" },
    { label: "Warnings", value: String(comparison.summary.warnings), icon: TriangleAlert, tone: "amber" },
    { label: "Failed", value: String(comparison.summary.failed), icon: XCircle, tone: "red" },
    { label: "Unknown", value: String(comparison.summary.unknown), icon: HelpCircle, tone: "gray" },
    { label: "Blockers", value: String(comparison.summary.certificationBlockers), icon: OctagonAlert, tone: "red" }
  ];

  return (
    <div
      className={cn(
        "relative mt-5 rounded-[12px] border",
        surfaceTheme === "light" ? "border-slate-200 bg-slate-50/70" : "border-white/[0.08] bg-white/[0.035]"
      )}
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8">
        {stats.map((stat) => (
          <ContractSummaryStat key={stat.label} {...stat} surfaceTheme={surfaceTheme} />
        ))}
      </div>
      {showReportOnlyPill ? (
        <div className="flex justify-center px-4 pb-3 xl:absolute xl:inset-x-0 xl:-bottom-4 xl:pb-0">
          <span
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em]",
              surfaceTheme === "light"
                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                : "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
            )}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Report-only, target not executed
          </span>
        </div>
      ) : null}
    </div>
  );
}

function ContractSummaryStat({
  label,
  value,
  icon: Icon,
  tone,
  surfaceTheme
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  tone: "blue" | "green" | "purple" | "amber" | "red" | "gray";
  surfaceTheme: SurfaceTheme;
}) {
  return (
    <div className={cn("min-w-0 border-b border-r px-3 py-3 sm:px-4 sm:py-4", surfaceTheme === "light" ? "border-slate-200" : "border-white/[0.08]")}>
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4 shrink-0", contractToneTextClassName(tone, surfaceTheme))} />
        <p className={cn("truncate text-[11px] font-semibold uppercase tracking-[0.14em]", surfaceTheme === "light" ? "text-slate-500" : "text-slate-400")}>
          {label}
        </p>
      </div>
      <p className={cn("mt-2 truncate text-xl font-semibold", surfaceTheme === "light" ? "text-slate-950" : "text-slate-50")} title={value}>
        {value}
      </p>
    </div>
  );
}

function ContractFilterChips({
  filter,
  onFilterChange,
  surfaceTheme
}: {
  filter: AgentOsOpenClawContractComparisonFilter;
  onFilterChange: (filter: AgentOsOpenClawContractComparisonFilter) => void;
  surfaceTheme: SurfaceTheme;
}) {
  return (
    <div className="mt-6 flex gap-2 overflow-x-auto pb-1 sm:mt-8 sm:flex-wrap sm:overflow-visible sm:pb-0">
      {contractComparisonFilters.map((entry) => {
        const Icon = entry.icon;
        const selected = filter === entry.id;

        return (
          <button
            key={entry.id}
            type="button"
            onClick={() => onFilterChange(entry.id)}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-[9px] border px-3 text-xs font-medium transition-colors",
              selected
                ? surfaceTheme === "light"
                  ? "border-blue-300 bg-blue-50 text-blue-700 shadow-[0_8px_18px_rgba(37,99,235,0.08)]"
                  : "border-blue-300/25 bg-blue-300/10 text-blue-100"
                : surfaceTheme === "light"
                  ? "border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50/45"
                  : "border-white/10 bg-[#0f1826] text-slate-300 hover:bg-white/[0.06]"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {entry.label}
          </button>
        );
      })}
    </div>
  );
}

function ContractComparisonTable({
  comparison,
  rows,
  surfaceTheme
}: {
  comparison: AgentOsOpenClawContractComparison;
  rows: AgentOsOpenClawContractComparison["rows"];
  surfaceTheme: SurfaceTheme;
}) {
  const [showAllMobileContractRows, setShowAllMobileContractRows] = useState(false);
  const mobileContractRows = showAllMobileContractRows ? rows : rows.slice(0, 8);

  return (
    <div className={cn("mt-5 overflow-hidden rounded-[12px] border shadow-[0_12px_30px_rgba(15,23,42,0.04)]", surfaceTheme === "light" ? "border-slate-200 bg-white" : "border-white/[0.08] bg-[#0f1826]")}>
      <div className="divide-y divide-border sm:hidden">
        {rows.length > 0 ? mobileContractRows.map((row) => {
          const OperationIcon = resolveContractOperationIcon(row.areaId);
          return (
            <details key={row.operationId} className={cn("group", row.blocksCertification ? surfaceTheme === "light" ? "bg-rose-50/35" : "bg-rose-300/[0.045]" : null)}>
              <summary className="flex min-h-14 cursor-pointer list-none items-start gap-3 px-3 py-3">
                <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border", surfaceTheme === "light" ? "border-slate-200 bg-slate-50 text-slate-600" : "border-white/10 bg-white/[0.04] text-slate-300")}>
                  <OperationIcon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-sm font-semibold", surfaceTheme === "light" ? "text-slate-950" : "text-slate-50")}>{row.label}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5">
                    <RequirementBadge requirement={row.requirement} status={row.status} surfaceTheme={surfaceTheme} />
                    <ContractStatusBadge status={row.status} surfaceTheme={surfaceTheme} />
                    {row.blocksCertification ? <BlocksBadge blocks surfaceTheme={surfaceTheme} /> : null}
                  </span>
                </span>
                <ChevronDown className="mt-2 h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
              </summary>
              <div className="grid gap-2 px-3 pb-3">
                <div className={cn("rounded-xl border p-3", surfaceTheme === "light" ? "border-slate-200 bg-slate-50/70" : "border-white/[0.08] bg-black/10")}>
                  <p className={cn("text-[0.62rem] font-semibold uppercase tracking-[0.12em]", surfaceTheme === "light" ? "text-slate-500" : "text-slate-400")}>Baseline expected</p>
                  <EvidenceSummaryCell evidence={buildBaselineEvidence(row)} surfaceTheme={surfaceTheme} />
                </div>
                <div className={cn("rounded-xl border p-3", surfaceTheme === "light" ? "border-slate-200 bg-slate-50/70" : "border-white/[0.08] bg-black/10")}>
                  <p className={cn("text-[0.62rem] font-semibold uppercase tracking-[0.12em]", surfaceTheme === "light" ? "text-slate-500" : "text-slate-400")}>Installed actual</p>
                  <EvidenceSummaryCell evidence={buildInstalledEvidence(row)} surfaceTheme={surfaceTheme} />
                </div>
                <div className={cn("rounded-xl border p-3", surfaceTheme === "light" ? "border-slate-200 bg-slate-50/70" : "border-white/[0.08] bg-black/10")}>
                  <p className={cn("text-[0.62rem] font-semibold uppercase tracking-[0.12em]", surfaceTheme === "light" ? "text-slate-500" : "text-slate-400")}>Target actual</p>
                  <EvidenceSummaryCell evidence={buildTargetEvidence(row, comparison.targetEvidenceLabel)} surfaceTheme={surfaceTheme} />
                </div>
              </div>
            </details>
          );
        }) : (
          <div className="p-3">
            <EmptyState title="Evidence missing" detail="No contract operations matched this filter. Missing evidence is not treated as passing." surfaceTheme={surfaceTheme} />
          </div>
        )}
        {!showAllMobileContractRows && rows.length > mobileContractRows.length ? (
          <div className="p-3">
            <Button type="button" variant="secondary" className="h-11 w-full rounded-xl text-xs" onClick={() => setShowAllMobileContractRows(true)}>
              Show {rows.length - mobileContractRows.length} more contract operations
            </Button>
          </div>
        ) : null}
        {rows.length > 0 ? <div className={cn("px-3 py-3 text-center text-xs", surfaceTheme === "light" ? "text-slate-500" : "text-slate-400")}>Showing {rows.length} of {comparison.rows.length} operations</div> : null}
      </div>
      <div className="hidden overflow-x-auto sm:block">
        <div className="min-w-[1120px]">
          <div className={cn(
            "grid grid-cols-[1.35fr_0.75fr_1.28fr_1.28fr_1.28fr_0.8fr_0.55fr] border-b px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.12em]",
            surfaceTheme === "light" ? "border-slate-200 bg-slate-50 text-slate-500" : "border-white/[0.08] bg-white/[0.04] text-slate-400"
          )}>
            <span>Operation</span>
            <span>Requirement</span>
            <span>Baseline expected</span>
            <span>Installed actual</span>
            <span>Target actual</span>
            <span>Status</span>
            <span>Blocks</span>
          </div>
          <div>
            {rows.length > 0 ? rows.map((row) => (
              <ContractComparisonRow
                key={row.operationId}
                row={row}
                targetFallbackLabel={comparison.targetEvidenceLabel}
                surfaceTheme={surfaceTheme}
              />
            )) : (
              <div className="p-5">
                <EmptyState
                  title="Evidence missing"
                  detail="No contract operations matched this filter. Missing evidence is not treated as passing."
                  surfaceTheme={surfaceTheme}
                />
              </div>
            )}
          </div>
          {rows.length > 0 ? (
            <div className={cn("border-t px-5 py-3 text-center text-xs", surfaceTheme === "light" ? "border-slate-200 text-slate-500" : "border-white/[0.08] text-slate-400")}>
              Showing {rows.length} of {comparison.rows.length} operations · Use filters above to focus your view
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ContractComparisonRow({
  row,
  targetFallbackLabel,
  surfaceTheme
}: {
  row: AgentOsOpenClawContractComparison["rows"][number];
  targetFallbackLabel: string;
  surfaceTheme: SurfaceTheme;
}) {
  const OperationIcon = resolveContractOperationIcon(row.areaId);

  return (
    <details
      className={cn(
        "group border-b last:border-b-0",
        row.blocksCertification
          ? surfaceTheme === "light"
            ? "border-rose-100 bg-rose-50/35"
            : "border-rose-300/15 bg-rose-300/[0.045]"
          : surfaceTheme === "light"
            ? "border-slate-200 bg-white"
            : "border-white/[0.08] bg-[#0f1826]"
      )}
    >
      <summary className="grid cursor-pointer list-none grid-cols-[1.35fr_0.75fr_1.28fr_1.28fr_1.28fr_0.8fr_0.55fr] items-center gap-4 px-5 py-4">
        <ContractOperationCell row={row} icon={OperationIcon} surfaceTheme={surfaceTheme} />
        <RequirementBadge requirement={row.requirement} status={row.status} surfaceTheme={surfaceTheme} />
        <EvidenceSummaryCell evidence={buildBaselineEvidence(row)} surfaceTheme={surfaceTheme} />
        <EvidenceSummaryCell evidence={buildInstalledEvidence(row)} surfaceTheme={surfaceTheme} />
        <EvidenceSummaryCell evidence={buildTargetEvidence(row, targetFallbackLabel)} surfaceTheme={surfaceTheme} />
        <ContractStatusBadge status={row.status} surfaceTheme={surfaceTheme} />
        <BlocksBadge blocks={row.blocksCertification} surfaceTheme={surfaceTheme} />
      </summary>
      <ExpandedEvidenceDetails row={row} targetFallbackLabel={targetFallbackLabel} surfaceTheme={surfaceTheme} />
    </details>
  );
}

type ContractEvidenceLine = {
  label: string;
  value: string;
  tone: "success" | "warning" | "danger" | "neutral";
};

type ContractEvidenceSummary = {
  lines: ContractEvidenceLine[];
  tags: Array<{
    label: string;
    tone: "success" | "warning" | "danger" | "neutral";
  }>;
};

function ContractOperationCell({
  row,
  icon: Icon,
  surfaceTheme
}: {
  row: AgentOsOpenClawContractComparison["rows"][number];
  icon: LucideIcon;
  surfaceTheme: SurfaceTheme;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span
        className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border",
          row.blocksCertification
            ? surfaceTheme === "light"
              ? "border-rose-100 bg-rose-50 text-rose-600"
              : "border-rose-300/20 bg-rose-300/10 text-rose-100"
            : surfaceTheme === "light"
              ? "border-blue-100 bg-blue-50 text-blue-600"
              : "border-blue-300/15 bg-blue-300/10 text-blue-100"
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className={cn("block truncate text-sm font-semibold", surfaceTheme === "light" ? "text-slate-950" : "text-slate-50")}>
          {row.label}
        </span>
        <span className={cn("mt-1 block truncate text-[11px]", surfaceTheme === "light" ? "text-slate-500" : "text-slate-400")}>
          {row.areaId} / {row.operationId}
        </span>
      </span>
    </div>
  );
}

function EvidenceSummaryCell({
  evidence,
  surfaceTheme
}: {
  evidence: ContractEvidenceSummary;
  surfaceTheme: SurfaceTheme;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      {evidence.lines.map((line) => (
        <div key={`${line.label}:${line.value}`} className="grid grid-cols-[10px_4.8rem_minmax(0,1fr)] items-baseline gap-1.5 text-[11px] leading-4">
          <span className={cn("mt-1 h-1.5 w-1.5 rounded-full", evidenceDotClassName(line.tone, surfaceTheme))} />
          <span className={cn(surfaceTheme === "light" ? "text-slate-500" : "text-slate-400")}>{line.label}:</span>
          <span className={cn("truncate", line.tone === "danger" ? surfaceTheme === "light" ? "text-rose-700" : "text-rose-200" : surfaceTheme === "light" ? "text-slate-700" : "text-slate-200")} title={line.value}>
            {line.value}
          </span>
        </div>
      ))}
      {evidence.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {evidence.tags.map((tag) => (
            <span key={tag.label} className={evidenceTagClassName(tag.tone, surfaceTheme)}>
              {tag.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RequirementBadge({
  requirement,
  status,
  surfaceTheme
}: {
  requirement: AgentOsOpenClawContractComparison["rows"][number]["requirement"];
  status: AgentOsOpenClawContractComparison["rows"][number]["status"];
  surfaceTheme: SurfaceTheme;
}) {
  const label = requirement === "experimental" && status === "warning" ? "Warning" : formatCapabilityBaseline(requirement);
  const tone =
    requirement === "required"
      ? "blue"
      : requirement === "experimental"
        ? "amber"
        : "gray";

  return (
    <span className={contractBadgeClassName(tone, surfaceTheme)}>
      {label}
    </span>
  );
}

function ContractStatusBadge({
  status,
  surfaceTheme
}: {
  status: AgentOsOpenClawContractComparison["rows"][number]["status"];
  surfaceTheme: SurfaceTheme;
}) {
  const Icon = status === "passed"
    ? CheckCircle2
    : status === "failed"
      ? XCircle
      : status === "warning"
        ? TriangleAlert
        : HelpCircle;
  const tone = status === "passed" ? "green" : status === "failed" ? "red" : status === "warning" ? "amber" : "gray";

  return (
    <span className={contractBadgeClassName(tone, surfaceTheme)}>
      <Icon className="h-3.5 w-3.5" />
      {formatCompatibilityLabStatus(status)}
    </span>
  );
}

function BlocksBadge({
  blocks,
  surfaceTheme
}: {
  blocks: boolean;
  surfaceTheme: SurfaceTheme;
}) {
  return (
    <span className={contractBadgeClassName(blocks ? "red" : "gray", surfaceTheme)}>
      {blocks ? "Yes" : "No"}
    </span>
  );
}

function ExpandedEvidenceDetails({
  row,
  targetFallbackLabel,
  surfaceTheme
}: {
  row: AgentOsOpenClawContractComparison["rows"][number];
  targetFallbackLabel: string;
  surfaceTheme: SurfaceTheme;
}) {
  return (
    <div className={cn("grid gap-3 border-t px-5 py-4 lg:grid-cols-3", surfaceTheme === "light" ? "border-slate-200 bg-slate-50/70" : "border-white/[0.08] bg-black/10")}>
      <CapabilityDetail label="Full baseline expectation" value={row.baselineExpected} surfaceTheme={surfaceTheme} />
      <CapabilityDetail label="Full installed evidence" value={row.installedActual || "Evidence missing"} surfaceTheme={surfaceTheme} />
      <CapabilityDetail label="Full target evidence" value={row.targetActual ?? targetFallbackLabel} surfaceTheme={surfaceTheme} />
      <CapabilityDetail label="Payload status" value={row.hasPayloadShapeChange ? "Payload mismatch or shape change detected" : row.actual.payloadShapeStatus ?? "Not checked"} surfaceTheme={surfaceTheme} />
      <CapabilityDetail label="CLI fallback" value={row.usesCliFallback ? "CLI fallback used or regressed" : "No CLI fallback evidence"} surfaceTheme={surfaceTheme} />
      <CapabilityDetail label="Files and tests" value={`Files: ${formatShortList(row.affectedAgentOsFiles, 4)}. Tests: ${formatShortList(row.regressionTests, 4)}.`} surfaceTheme={surfaceTheme} />
      {row.evidence.length > 0 ? (
        <div className="lg:col-span-3">
          <DiagnosticBlock title="raw evidence" value={row.evidence.join("\n")} surfaceTheme={surfaceTheme} />
        </div>
      ) : null}
    </div>
  );
}

function buildBaselineEvidence(row: AgentOsOpenClawContractComparison["rows"][number]): ContractEvidenceSummary {
  return {
    lines: [
      { label: "Methods", value: row.expected.gatewayMethods.slice(0, 2).join(", ") || "none", tone: row.expected.gatewayMethods.length ? "success" : "neutral" },
      { label: "Events", value: row.expected.eventNames.slice(0, 2).join(", ") || "none", tone: row.expected.eventNames.length ? "success" : "neutral" },
      { label: "Payload", value: shortenPayloadLabel(row.expected.payloadShape ?? "not specified"), tone: row.expected.payloadShape ? "success" : "neutral" },
      { label: "Norm", value: "AgentOS", tone: "success" }
    ],
    tags: row.expected.cliFallbackAllowed ? [] : [{ label: "no CLI fallback", tone: "warning" }]
  };
}

function buildInstalledEvidence(row: AgentOsOpenClawContractComparison["rows"][number]): ContractEvidenceSummary {
  const payloadStatus = row.actual.payloadShapeStatus ?? "not checked";
  const payloadTone = payloadStatus === "invalid" ? "danger" : payloadStatus === "not checked" ? "neutral" : "success";

  return {
    lines: [
      { label: "Method", value: row.actual.supportedMethod ?? "none", tone: row.actual.supportedMethod ? "success" : row.status === "failed" ? "danger" : "neutral" },
      { label: "Event", value: row.actual.supportedEvent ?? "none", tone: row.actual.supportedEvent ? "success" : "neutral" },
      { label: "Payload", value: payloadStatus === "valid" ? "accepted" : payloadStatus, tone: payloadTone }
    ],
    tags: [
      { label: row.actual.mode, tone: row.actual.mode === "cli-fallback" ? "warning" : row.actual.mode === "gateway-native" ? "success" : "neutral" },
      ...(row.hasPayloadShapeChange ? [{ label: "payload mismatch", tone: "danger" as const }] : [])
    ]
  };
}

function buildTargetEvidence(
  row: AgentOsOpenClawContractComparison["rows"][number],
  targetFallbackLabel: string
): ContractEvidenceSummary {
  if (!row.targetActual) {
    return {
      lines: [
        { label: "Method", value: "unknown", tone: "neutral" },
        { label: "Event", value: "unknown", tone: "neutral" },
        { label: "Payload", value: "unknown", tone: "neutral" }
      ],
      tags: [{ label: targetFallbackLabel.toLowerCase(), tone: "neutral" }]
    };
  }

  const method = readEvidenceSegment(row.targetActual, "Method") || "none";
  const event = readEvidenceSegment(row.targetActual, "Event") || "none";
  const payload = readEvidenceSegment(row.targetActual, "Payload") || "not checked";
  const mode = readEvidenceMode(row.targetActual);
  const status = row.targetStatus ?? row.status;
  const payloadTone = /invalid|mismatch|partial/i.test(payload) ? "danger" : /unknown|not checked/i.test(payload) ? "neutral" : "success";

  return {
    lines: [
      { label: "Method", value: method, tone: method === "none" ? status === "failed" ? "danger" : "neutral" : "success" },
      { label: "Event", value: event, tone: event === "none" ? "neutral" : "success" },
      { label: "Payload", value: payload === "valid" ? "accepted" : payload, tone: payloadTone }
    ],
    tags: [
      { label: mode, tone: mode === "cli-fallback" ? "warning" : mode === "gateway-native" ? "success" : "neutral" },
      ...(row.usesCliFallback ? [{ label: "CLI fallback used", tone: "warning" as const }] : [])
    ]
  };
}

function readEvidenceSegment(value: string, label: string) {
  return value.match(new RegExp(`${label}:\\s*([^;]+)`, "i"))?.[1]?.trim() ?? null;
}

function readEvidenceMode(value: string) {
  const parts = value.split(";").map((part) => part.trim()).filter(Boolean);
  return parts[1] ?? "unknown evidence";
}

function shortenPayloadLabel(value: string) {
  return value
    .replace(/\s+response accepted by AgentOS normalizers$/i, " response")
    .replace(/\s+accepted by AgentOS normalizers$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveContractOperationIcon(areaId: string): LucideIcon {
  if (areaId === "gateway-protocol") {
    return Activity;
  }
  if (areaId === "models-providers") {
    return Box;
  }
  if (areaId === "sessions-tasks-agents") {
    return Bot;
  }
  if (areaId === "config-patching") {
    return Settings2;
  }
  if (areaId === "channels-accounts-scopes") {
    return KeyRound;
  }
  return Layers;
}

function contractBadgeClassName(
  tone: "blue" | "green" | "amber" | "red" | "gray",
  surfaceTheme: SurfaceTheme
) {
  const base = "inline-flex w-fit items-center justify-center gap-1.5 rounded-[9px] border px-2.5 py-1 text-xs font-medium";

  if (tone === "blue") {
    return cn(base, surfaceTheme === "light" ? "border-blue-300 bg-blue-50 text-blue-700" : "border-blue-300/25 bg-blue-300/10 text-blue-100");
  }
  if (tone === "green") {
    return cn(base, surfaceTheme === "light" ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-emerald-300/25 bg-emerald-300/10 text-emerald-100");
  }
  if (tone === "amber") {
    return cn(base, surfaceTheme === "light" ? "border-amber-300 bg-amber-50 text-amber-700" : "border-amber-300/25 bg-amber-300/10 text-amber-100");
  }
  if (tone === "red") {
    return cn(base, surfaceTheme === "light" ? "border-rose-300 bg-rose-50 text-rose-700" : "border-rose-300/25 bg-rose-300/10 text-rose-100");
  }

  return cn(base, surfaceTheme === "light" ? "border-slate-200 bg-slate-50 text-slate-600" : "border-white/10 bg-white/[0.04] text-slate-300");
}

function contractToneTextClassName(
  tone: "blue" | "green" | "purple" | "amber" | "red" | "gray",
  surfaceTheme: SurfaceTheme
) {
  if (tone === "blue") return surfaceTheme === "light" ? "text-blue-600" : "text-blue-300";
  if (tone === "green") return surfaceTheme === "light" ? "text-emerald-600" : "text-emerald-300";
  if (tone === "purple") return surfaceTheme === "light" ? "text-violet-600" : "text-violet-300";
  if (tone === "amber") return surfaceTheme === "light" ? "text-amber-600" : "text-amber-300";
  if (tone === "red") return surfaceTheme === "light" ? "text-rose-600" : "text-rose-300";
  return surfaceTheme === "light" ? "text-slate-400" : "text-slate-500";
}

function evidenceDotClassName(tone: "success" | "warning" | "danger" | "neutral", surfaceTheme: SurfaceTheme) {
  if (tone === "success") return surfaceTheme === "light" ? "bg-emerald-500" : "bg-emerald-300";
  if (tone === "warning") return "bg-amber-500";
  if (tone === "danger") return "bg-rose-500";
  return surfaceTheme === "light" ? "bg-slate-300" : "bg-slate-500";
}

function evidenceTagClassName(tone: "success" | "warning" | "danger" | "neutral", surfaceTheme: SurfaceTheme) {
  if (tone === "success") return contractBadgeClassName("green", surfaceTheme);
  if (tone === "warning") return contractBadgeClassName("amber", surfaceTheme);
  if (tone === "danger") return contractBadgeClassName("red", surfaceTheme);
  return contractBadgeClassName("gray", surfaceTheme);
}

function GatewayLiveHealthPanel({
  snapshot,
  transportSummary,
  gatewayAuthStatus,
  nativeAuthLabel,
  displayedGatewayBind,
  surfaceTheme
}: {
  snapshot: MissionControlShellSettingsPanelProps["snapshot"];
  transportSummary: TransportDiagnosticsSummary;
  gatewayAuthStatus: GatewayNativeAuthStatus | null;
  nativeAuthLabel: string;
  displayedGatewayBind: string;
  surfaceTheme: SurfaceTheme;
}) {
  const isServiceOnline = snapshot.diagnostics.loaded || snapshot.diagnostics.rpcOk;
  const serviceTone: TransportStatusTone = isServiceOnline ? "success" : "danger";
  const authTone: TransportStatusTone = gatewayAuthStatus
    ? gatewayAuthStatus.native.ok
      ? "success"
      : "danger"
    : "neutral";
  const summary = !isServiceOnline
    ? "The Gateway is unavailable. Start or restart it before repairing authentication."
    : gatewayAuthStatus && !gatewayAuthStatus.native.ok
      ? "The Gateway is running, but native authentication needs attention."
      : transportSummary.statusTone === "danger"
        ? "The Gateway is online, but the native transport is not ready."
        : transportSummary.statusTone === "warning"
          ? "The Gateway is authenticated and available with an explicit recovery path in use."
          : "The Gateway is online, authenticated, and ready for native operations.";

  return (
    <div
      aria-label="Live Gateway health"
      className={cn(
        "rounded-[18px] border p-3.5",
        surfaceTheme === "light"
          ? "border-border bg-card"
          : "border-white/[0.08] bg-[#101a2a]/92"
      )}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className={labelClassName(surfaceTheme)}>Live Gateway health</p>
          <p className={cn("mt-1.5 text-sm font-medium", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}>
            {summary}
          </p>
        </div>
        <p className={cn("shrink-0 text-xs", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>
          Checked {gatewayAuthStatus?.native.checkedAt ? formatTimestamp(gatewayAuthStatus.native.checkedAt) : "from current snapshot"}
        </p>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <GatewayHealthMetric
          label="Service"
          value={isServiceOnline ? "Online" : "Offline"}
          detail={`${resolveGatewayLocality(snapshot)} Gateway`}
          tone={serviceTone}
          surfaceTheme={surfaceTheme}
        />
        <GatewayHealthMetric
          label="Authentication"
          value={nativeAuthLabel}
          detail={gatewayAuthStatus?.mode ? `${gatewayAuthStatus.mode} mode` : "Auth mode unknown"}
          tone={authTone}
          surfaceTheme={surfaceTheme}
        />
        <GatewayHealthMetric
          label="Native transport"
          value={transportSummary.statusLabel}
          detail={transportSummary.gatewayModeLabel}
          tone={transportSummary.statusTone}
          surfaceTheme={surfaceTheme}
        />
      </div>

      <div className={cn("mt-3 grid gap-x-4 gap-y-2 border-t pt-3 text-xs sm:grid-cols-3", surfaceTheme === "light" ? "border-border text-muted-foreground" : "border-white/[0.08] text-slate-400")}>
        <p><span className="font-medium">Endpoint:</span> {snapshot.diagnostics.gatewayUrl || "Not configured"}</p>
        <p><span className="font-medium">Gateway bind:</span> {displayedGatewayBind}</p>
        <p><span className="font-medium">Protocol:</span> {transportSummary.protocolLabel}</p>
      </div>
    </div>
  );
}

function GatewayHealthMetric({
  label,
  value,
  detail,
  tone,
  surfaceTheme
}: {
  label: string;
  value: string;
  detail: string;
  tone: TransportStatusTone;
  surfaceTheme: SurfaceTheme;
}) {
  return (
    <div className={cn("rounded-[16px] border p-3", insetPanelClassName(surfaceTheme))}>
      <div className="flex items-center justify-between gap-2">
        <p className={labelClassName(surfaceTheme)}>{label}</p>
        <span className={transportTonePillClassName(tone, surfaceTheme)}>{value}</span>
      </div>
      <p className={cn("mt-2 text-xs", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>{detail}</p>
    </div>
  );
}

function GatewayRecommendedActionPanel({
  guidance,
  isBusy,
  onRun,
  surfaceTheme
}: {
  guidance: GatewayActionGuidance;
  isBusy: boolean;
  onRun: () => void;
  surfaceTheme: SurfaceTheme;
}) {
  const needsAction = guidance.action !== null;
  const isChecking = guidance.state === "checking";
  const guidanceTone: TransportStatusTone = needsAction ? "warning" : isChecking ? "neutral" : "success";

  return (
    <div
      aria-label="Recommended Gateway action"
      className={cn(
        "mt-3 flex flex-col gap-3 rounded-[16px] border p-3 sm:flex-row sm:items-center sm:justify-between",
        needsAction
          ? surfaceTheme === "light"
            ? "border-amber-200 bg-amber-50/65"
            : "border-amber-300/20 bg-amber-300/[0.07]"
          : isChecking
            ? insetPanelClassName(surfaceTheme)
          : surfaceTheme === "light"
            ? "border-emerald-200 bg-card"
            : "border-emerald-300/15 bg-[#101a2a]/92"
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className={labelClassName(surfaceTheme)}>Recommended action</p>
          <span className={transportTonePillClassName(guidanceTone, surfaceTheme)}>
            {needsAction ? "Attention" : isChecking ? "Checking" : "Ready"}
          </span>
        </div>
        <p className={cn("mt-1.5 text-sm font-medium", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}>{guidance.label}</p>
        <p className={cn("mt-1 text-xs leading-5", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>{guidance.detail}</p>
      </div>
      {needsAction ? (
        <Button
          type="button"
          onClick={onRun}
          disabled={isBusy}
          className="h-9 shrink-0 rounded-full bg-primary px-4 text-xs text-primary-foreground shadow-none hover:bg-primary/90"
        >
          {isBusy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}
          {isBusy ? "Working..." : guidance.label}
        </Button>
      ) : null}
    </div>
  );
}

function GatewayOperationProgressPanel({
  feedback,
  onDismiss,
  surfaceTheme
}: {
  feedback: GatewayOperationFeedback;
  onDismiss: () => void;
  surfaceTheme: SurfaceTheme;
}) {
  const steps = gatewayOperationSteps(feedback.kind);
  const isRunning = feedback.status === "running";
  const tone: TransportStatusTone = isRunning ? "warning" : feedback.status === "success" ? "success" : "danger";

  return (
    <div
      aria-label="Gateway operation progress"
      aria-live="polite"
      className={cn(
        "mt-3 rounded-[16px] border p-3.5",
        feedback.status === "success"
          ? surfaceTheme === "light" ? "border-emerald-200 bg-card" : "border-emerald-300/15 bg-[#101a2a]/92"
          : feedback.status === "error"
            ? surfaceTheme === "light" ? "border-rose-200 bg-rose-50/60" : "border-rose-300/20 bg-rose-300/[0.07]"
            : insetPanelClassName(surfaceTheme)
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className={labelClassName(surfaceTheme)}>Gateway operation</p>
            <span className={transportTonePillClassName(tone, surfaceTheme)}>
              {isRunning ? "In progress" : feedback.status}
            </span>
          </div>
          <p className={cn("mt-1.5 text-sm font-medium", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}>
            {gatewayOperationLabel(feedback.kind)}
          </p>
          <p className={cn("mt-1 text-xs leading-5", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>
            {feedback.message}
          </p>
        </div>
        {!isRunning ? (
          <button
            type="button"
            onClick={onDismiss}
            className={cn("rounded-full p-1 transition-colors", surfaceTheme === "light" ? "text-muted-foreground hover:bg-black/5 hover:text-foreground" : "text-slate-400 hover:bg-white/10 hover:text-white")}
            aria-label="Dismiss Gateway operation result"
          >
            <XCircle className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {steps.map((step, index) => {
          const stepState = feedback.status === "success"
            ? "complete"
            : index === 0
              ? "complete"
              : index === 1
                ? feedback.status === "error" ? "error" : "active"
                : "pending";

          return (
            <div key={step} className={cn("flex items-start gap-2 rounded-[14px] border p-2.5", insetPanelClassName(surfaceTheme))}>
              {stepState === "complete" ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              ) : stepState === "error" ? (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
              ) : stepState === "active" ? (
                <LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-amber-500" />
              ) : (
                <span className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full border", surfaceTheme === "light" ? "border-slate-300" : "border-slate-600")} />
              )}
              <div className="min-w-0">
                <p className={cn("text-xs font-medium", surfaceTheme === "light" ? "text-foreground" : "text-slate-200")}>{step}</p>
                <p className={cn("mt-0.5 text-[10px] uppercase tracking-[0.1em]", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-500")}>
                  {stepState}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <p className={cn("mt-2 text-[10px]", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-500")}>
        Started {formatTimestamp(feedback.startedAt)}
        {feedback.finishedAt ? ` · Finished ${formatTimestamp(feedback.finishedAt)}` : ""}
      </p>
    </div>
  );
}

function gatewayOperationSteps(kind: GatewayOperationKind) {
  switch (kind) {
    case "repair-token":
      return ["Prepare secure repair", "Apply token and restart", "Verify native authentication"];
    case "repair-access":
      return ["Prepare access repair", "Approve scopes and sync", "Verify native authentication"];
    case "restart":
      return ["Prepare native request", "Request safe Gateway restart", "Await reconnect verification"];
    case "start":
      return ["Prepare control request", "Start Gateway service", "Verify refreshed runtime state"];
    case "stop":
      return ["Prepare control request", "Stop Gateway service", "Verify stopped runtime state"];
    case "doctor":
      return ["Prepare native read", "Read OpenClaw runtime evidence", "Refresh Gateway diagnostics"];
  }
}

function gatewayOperationLabel(kind: GatewayOperationKind) {
  switch (kind) {
    case "repair-token":
      return "Repair Gateway token";
    case "repair-access":
      return "Repair local Gateway access";
    case "doctor":
      return "Read native OpenClaw diagnostics";
    default:
      return `${kind.charAt(0).toUpperCase()}${kind.slice(1)} Gateway`;
  }
}

function gatewayControlRunningMessage(action: GatewayControlAction) {
  switch (action) {
    case "doctor":
      return "Reading native OpenClaw diagnostics and waiting for refreshed Gateway state.";
    case "restart":
      return "Requesting a safe native Gateway restart and waiting for reconnect state.";
    case "start":
      return "Starting the Gateway service and waiting for a refreshed runtime snapshot.";
    case "stop":
      return "Stopping the Gateway service and waiting for the stopped runtime state.";
  }
}

function gatewayControlSuccessMessage(action: GatewayControlAction) {
  switch (action) {
    case "doctor":
      return "Native OpenClaw diagnostics completed and Gateway state was refreshed.";
    case "restart":
      return "Native Gateway restart was accepted; reconnect verification is pending.";
    case "start":
      return "Gateway started and the refreshed runtime state was received.";
    case "stop":
      return "Gateway stopped and the refreshed runtime state was received.";
  }
}

function CompatibilityPanel({
  compatibilityReport,
  report,
  snapshot,
  capabilityMatrix,
  transportSummary,
  nativeAuthLabel,
  error,
  isRunning,
  onRun,
  surfaceTheme
}: {
  compatibilityReport: CompatibilityReport | null | undefined;
  report: CompatibilitySmokeReport | null;
  snapshot: MissionControlShellSettingsPanelProps["snapshot"];
  capabilityMatrix: MissionControlShellSettingsPanelProps["snapshot"]["diagnostics"]["capabilityMatrix"];
  transportSummary: TransportDiagnosticsSummary;
  nativeAuthLabel: string;
  error: string | null;
  isRunning: boolean;
  onRun: () => void;
  surfaceTheme: SurfaceTheme;
}) {
  const compatibility = report?.compatibility;
  const reportStatus = compatibilityReport?.status;
  const protocolRange = compatibility
    ? `v${compatibility.agentOsSupportedProtocolRange.min}-v${compatibility.agentOsSupportedProtocolRange.max}`
    : compatibilityReport
      ? `v${compatibilityReport.gateway.protocolRange.min}-v${compatibilityReport.gateway.protocolRange.max}`
      : transportSummary.protocolRangeLabel;
  const fallbackReason =
    compatibility?.lastFallbackReason ||
    compatibilityReport?.fallback.diagnostics[0]?.issue ||
    snapshot.diagnostics.gatewayFallbackDiagnostics?.[0]?.issue ||
    "None";
  const lastNativeError = compatibility?.lastNativeError || transportSummary.lastNativeError || "None";
  const recovery =
    compatibilityReport?.recovery ||
    report?.recovery ||
    transportSummary.recovery ||
    snapshot.diagnostics.issues[0] ||
    "OpenClaw compatibility is not available yet.";
  const statusLabel = reportStatus
    ? formatCompatibilityReportStatus(reportStatus)
    : report
      ? formatCompatibilitySmokeStatus(report.status)
      : "Unknown";
  const statusTone = reportStatus ? compatibilityReportStatusTone(reportStatus) : report ? compatibilitySmokeStatusTone(report.status) : "neutral";
  const safeLabel = report
    ? report.safeToDispatchMissions
      ? "Safe to dispatch"
      : "Do not dispatch"
    : compatibilityReport
      ? compatibilityReport.status === "compatible"
        ? "Compatible"
        : compatibilityReport.status === "degraded"
          ? "Degraded"
          : "Incompatible"
      : "Not tested";
  const reportIssues = compatibilityReport
    ? [
      ...compatibilityReport.summary.failedSurfaces,
      ...compatibilityReport.summary.unsupportedSurfaces,
      ...compatibilityReport.summary.degradedSurfaces
    ]
    : [];
  const visibleContractIssues = compatibilityReport?.contracts
    .filter((check) => check.status !== "ok")
    .slice(0, 5) ?? [];

  return (
    <div className={cn("mt-4 rounded-[18px] border p-3.5", insetPanelClassName(surfaceTheme))}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className={labelClassName(surfaceTheme)}>Technical diagnostics</p>
            {(compatibilityReport || report) ? (
              <span className={transportTonePillClassName("neutral", surfaceTheme)}>Historical evidence</span>
            ) : null}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <p className={cn("font-medium", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}>
              {statusLabel}
            </p>
            <span className={transportTonePillClassName(statusTone, surfaceTheme)}>{safeLabel}</span>
          </div>
          <p className={cn("mt-1 max-w-2xl text-xs leading-5", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>
            Saved compatibility evidence does not override the live service, authentication, or transport state above.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={onRun}
          disabled={isRunning}
          className={secondaryButtonClassName(surfaceTheme, "px-4")}
        >
          {isRunning ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
          {isRunning ? "Running..." : "Run OpenClaw Smoke Test"}
        </Button>
      </div>

      <details className={cn("group mt-3 rounded-[16px] border", surfaceTheme === "light" ? "border-border bg-card" : "border-white/[0.08] bg-[#101a2a]/92")}>
        <summary className="flex cursor-pointer list-none items-center gap-3 px-3.5 py-3">
          <div className="min-w-0 flex-1">
            <p className={cn("text-sm font-medium", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}>Show saved technical report</p>
            <p className={cn("mt-0.5 text-xs", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>
              Report: {compatibilityReport ? formatTimestamp(compatibilityReport.generatedAt) : "Not available"}
              {report ? ` / Smoke: ${formatTimestamp(report.checkedAt)}` : ""}
            </p>
          </div>
          <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform group-open:rotate-180", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")} />
        </summary>

        <div className={cn("border-t p-3.5", surfaceTheme === "light" ? "border-border" : "border-white/[0.08]")}>
          <InfoRows
            surfaceTheme={surfaceTheme}
            rows={[
              ["Installed OpenClaw", formatVersionValue(compatibilityReport?.openClaw.installedVersion ?? compatibility?.installedVersion ?? snapshot.diagnostics.version ?? null)],
              ["Required OpenClaw", formatVersionValue(compatibility?.requiredOpenClawVersion ?? compatibilityReport?.openClaw.supportedBaselineVersion ?? null)],
              ["Recommended OpenClaw", formatVersionValue(compatibilityReport?.openClaw.recommendedVersion ?? compatibility?.recommendedOpenClawVersion ?? snapshot.diagnostics.latestVersion ?? null)],
              ["Gateway protocol status", compatibilityReport ? formatGatewayProtocolReport(compatibilityReport) : compatibility?.gatewayProtocolVersion ? `v${compatibility.gatewayProtocolVersion}` : capabilityMatrix?.gatewayProtocolVersion ? `v${capabilityMatrix.gatewayProtocolVersion}` : transportSummary.protocolLabel],
              ["AgentOS protocol range", protocolRange],
              ["Native Gateway coverage", compatibilityReport ? `${compatibilityReport.summary.nativeGatewayCoveragePercent}% (${compatibilityReport.summary.nativeGatewayCoverageLabel})` : "Unknown"],
              ["CLI fallback operation count", compatibilityReport ? String(compatibilityReport.summary.cliFallbackOperationCount) : "Unknown"],
              ["Unsupported/degraded integrations", compatibilityReport ? (reportIssues.length > 0 ? formatShortList(reportIssues, 3) : "None") : "Unknown"],
              ["Node.js", compatibility?.nodeVersion ? `${compatibility.nodeVersion} / ${formatNodeStatus(compatibility.nodeStatus)}` : "Run smoke test"],
              ["Gateway auth", compatibility?.gatewayAuthStatus || nativeAuthLabel],
              ["Native Gateway", compatibilityReport ? `${compatibilityReport.gateway.health} / ${compatibilityReport.gateway.capabilitySource}` : compatibility?.nativeGatewayStatus || transportSummary.statusLabel],
              ["CLI fallback count", String(compatibility?.cliFallbackUsageCount ?? transportSummary.fallbackTotal)],
              ["Last native error", lastNativeError],
              ["Last fallback reason", fallbackReason]
            ]}
          />

          <div className={cn("mt-3 rounded-[16px] border p-3 text-xs leading-5", surfaceTheme === "light" ? "border-border bg-muted/45 text-foreground" : "border-white/[0.08] bg-[#0d1624] text-slate-300")}>
            <p className={labelClassName(surfaceTheme)}>Recovery suggestion</p>
            <p className="mt-1.5">{recovery}</p>
            {error ? <p className={cn("mt-1.5", surfaceTheme === "light" ? "text-rose-700" : "text-rose-200")}>{error}</p> : null}
          </div>

          {visibleContractIssues.length > 0 ? (
            <div className="mt-3 space-y-2">
              {visibleContractIssues.map((check) => (
                <div key={check.operation} className={cn("rounded-[16px] border p-3", surfaceTheme === "light" ? "border-border bg-card" : "border-white/[0.08] bg-[#101a2a]/92")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={transportTonePillClassName(contractStatusTone(check.status), surfaceTheme)}>{formatContractStatus(check.status)}</span>
                    <p className={cn("text-sm font-medium", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}>{check.label}</p>
                  </div>
                  <p className={cn("mt-2 text-xs leading-5", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-300")}>{check.reason}</p>
                  <p className={cn("mt-1 text-xs leading-5", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>Recovery: {check.suggestedRecovery}</p>
                </div>
              ))}
            </div>
          ) : null}

          {report?.checks.length ? (
            <div className="mt-3 space-y-2">
              {report.checks.map((check) => (
                <details key={check.id} className={cn("group/check rounded-[16px] border", surfaceTheme === "light" ? "border-border bg-card" : "border-white/[0.08] bg-[#101a2a]/92")}>
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-3.5 py-2.5">
                    <span className={transportTonePillClassName(smokeCheckTone(check.status), surfaceTheme)}>{formatSmokeCheckStatus(check.status)}</span>
                    <div className="min-w-0 flex-1">
                      <p className={cn("truncate text-sm font-medium", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}>{check.label}</p>
                      <p className={cn("mt-0.5 truncate text-xs", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>{check.summary}</p>
                    </div>
                    <span className={cn("hidden text-xs sm:inline", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>{check.durationMs} ms</span>
                    <ChevronDown className={cn("h-4 w-4 transition-transform group-open/check:rotate-180", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")} />
                  </summary>
                  <div className={cn("border-t p-3.5", surfaceTheme === "light" ? "border-border" : "border-white/[0.08]")}>
                    {check.recovery ? <p className={cn("mb-3 text-xs leading-5", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-300")}>Recovery: {check.recovery}</p> : null}
                    <DiagnosticBlock title="raw details" value={formatRawDetails(check.rawDetails)} surfaceTheme={surfaceTheme} />
                  </div>
                </details>
              ))}
            </div>
          ) : (
            <EmptyState title="No compatibility smoke report" detail="Run the smoke test to verify OpenClaw binary, Gateway, models, sessions, tasks, config, events, and fallback behavior." surfaceTheme={surfaceTheme} />
          )}
        </div>
      </details>
    </div>
  );
}

function TransportDiagnosticsPanel({
  summary,
  surfaceTheme
}: {
  summary: TransportDiagnosticsSummary;
  surfaceTheme: SurfaceTheme;
}) {
  return (
    <div className={cn("rounded-[18px] border p-3.5", insetPanelClassName(surfaceTheme))}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className={labelClassName(surfaceTheme)}>Gateway Transport</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <p className={cn("font-medium", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}>
              {summary.statusLabel}
            </p>
            <span className={transportTonePillClassName(summary.statusTone, surfaceTheme)}>
              {summary.gatewayModeLabel}
            </span>
          </div>
          <p className={cn("mt-1 text-xs", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>
            {summary.connectionLabel} / {summary.modeLabel}
          </p>
        </div>
        <div className="text-left sm:text-right">
          <p className={labelClassName(surfaceTheme)}>Snapshot stream</p>
          <p className={cn("mt-1.5 text-sm", surfaceTheme === "light" ? "text-foreground" : "text-slate-200")}>
            {summary.streamLabel}
          </p>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        <Metric
          label="Protocol support"
          value={summary.protocolRangeLabel}
          surfaceTheme={surfaceTheme}
          dark={surfaceTheme === "dark"}
          compact
        />
        <Metric
          label="Connected protocol"
          value={summary.protocolLabel}
          surfaceTheme={surfaceTheme}
          dark={surfaceTheme === "dark"}
          compact
        />
        <Metric
          label="CLI fallback used"
          value={String(summary.fallbackTotal)}
          badge={summary.fallbackTotal > 0 ? "Used" : "Clean"}
          surfaceTheme={surfaceTheme}
          dark={surfaceTheme === "dark"}
          compact
        />
        <Metric
          label="Last connected"
          value={summary.lastConnectedLabel}
          surfaceTheme={surfaceTheme}
          dark={surfaceTheme === "dark"}
          compact
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Metric
          label="Last disconnected"
          value={summary.lastDisconnectedLabel}
          surfaceTheme={surfaceTheme}
          dark={surfaceTheme === "dark"}
          compact
        />
        <Metric
          label="Fallback summary"
          value={summary.fallbackSummaryLabel}
          surfaceTheme={surfaceTheme}
          dark={surfaceTheme === "dark"}
          compact
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Metric
          label="Gateway event stream"
          value={summary.eventBridgeLabel}
          badge={summary.eventBridgeTone === "success" ? "Live" : summary.eventBridgeTone === "warning" ? "Degraded" : "Unknown"}
          surfaceTheme={surfaceTheme}
          dark={surfaceTheme === "dark"}
          compact
        />
        <Metric
          label="Last Gateway event"
          value={summary.eventBridgeLastEventLabel}
          surfaceTheme={surfaceTheme}
          dark={surfaceTheme === "dark"}
          compact
        />
      </div>

      {summary.lastNativeError ? (
        <div className="mt-3">
          <DiagnosticBlock title="Last native error" value={summary.lastNativeError} surfaceTheme={surfaceTheme} />
        </div>
      ) : null}
      {summary.eventBridgeLastError ? (
        <div className="mt-3">
          <DiagnosticBlock title="Last event stream error" value={summary.eventBridgeLastError} surfaceTheme={surfaceTheme} />
        </div>
      ) : null}
      {summary.recovery ? (
        <p className={cn("mt-3 text-xs leading-5", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>
          Recovery: {summary.recovery}
        </p>
      ) : null}
      {summary.eventBridgeRecovery ? (
        <p className={cn("mt-2 text-xs leading-5", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>
          Event stream recovery: {summary.eventBridgeRecovery}
        </p>
      ) : null}
    </div>
  );
}

function transportTonePillClassName(tone: TransportStatusTone, surfaceTheme: SurfaceTheme) {
  const base = "inline-flex shrink-0 items-center rounded-full border px-2 py-1 text-[9px] uppercase tracking-[0.12em]";

  if (tone === "success") {
    return cn(
      base,
      surfaceTheme === "light"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : "border-emerald-300/20 bg-emerald-300/10 text-emerald-100"
    );
  }

  if (tone === "danger") {
    return cn(
      base,
      surfaceTheme === "light"
        ? "border-red-200 bg-red-50 text-red-700"
        : "border-rose-300/20 bg-rose-300/10 text-rose-100"
    );
  }

  if (tone === "warning") {
    return cn(
      base,
      surfaceTheme === "light"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-amber-300/20 bg-amber-300/10 text-amber-100"
    );
  }

  return cn(
    base,
    surfaceTheme === "light"
      ? "border-border bg-card text-muted-foreground"
      : "border-white/[0.08] bg-[#101a2a]/92 text-slate-300"
  );
}

function baselinePillClassName(
  baseline: OpenClawCapabilityMatrixRow["baseline"],
  surfaceTheme: SurfaceTheme
) {
  const base = "inline-flex shrink-0 items-center rounded-full border px-2 py-1 text-[9px] uppercase tracking-[0.12em]";

  if (baseline === "required") {
    return cn(
      base,
      surfaceTheme === "light"
        ? "border-sky-200 bg-sky-50 text-sky-700"
        : "border-sky-300/20 bg-sky-300/10 text-sky-100"
    );
  }

  if (baseline === "experimental") {
    return cn(
      base,
      surfaceTheme === "light"
        ? "border-violet-200 bg-violet-50 text-violet-700"
        : "border-violet-300/20 bg-violet-300/10 text-violet-100"
    );
  }

  return cn(
    base,
    surfaceTheme === "light"
      ? "border-border bg-card text-muted-foreground"
      : "border-white/[0.08] bg-[#101a2a]/92 text-slate-300"
  );
}

function formatCapabilityBaseline(value: OpenClawCapabilityMatrixRow["baseline"]) {
  switch (value) {
    case "required":
      return "Required";
    case "optional":
      return "Optional";
    case "experimental":
      return "Experimental";
    case "unknown":
    default:
      return "Unknown";
  }
}

function formatCapabilityCompatibility(value: OpenClawCapabilityMatrixRow["compatibility"]) {
  switch (value) {
    case "preferred":
      return "Preferred native method";
    case "alias":
      return "Compatible alias";
    case "missing":
      return "Missing native method";
    case "unknown":
    default:
      return "Unknown";
  }
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
          ? "border-border bg-muted/45"
          : "border-white/[0.08] bg-[#0d1624]/60"
      )}
    >
      <p className={cn("text-sm font-medium", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}>
        {title}
      </p>
      <p className={cn("mt-1 text-xs", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>{detail}</p>
    </div>
  );
}

function UpdateRegistryPanel({
  surfaceTheme,
  isCheckingForUpdates,
  isUpdateRegistryLoading,
  hasCertifiedUpdateAvailable,
  hasRegistryUpdateAvailable,
  currentVersion,
  recommendedVersion,
  latestVersion,
  latestDecision,
  updateInfo,
  updateError,
  lastCheckedAt,
  isUpdateRunning,
  updateCompatibility,
  onTryPreviewVersion
}: {
  surfaceTheme: SurfaceTheme;
  isCheckingForUpdates: boolean;
  isUpdateRegistryLoading: boolean;
  hasCertifiedUpdateAvailable: boolean;
  hasRegistryUpdateAvailable: boolean;
  currentVersion: string;
  recommendedVersion: string | null;
  latestVersion: string | null;
  latestDecision: OpenClawUpdateDecision | null;
  updateInfo: string | null;
  updateError: string | null;
  lastCheckedAt: number | null;
  isUpdateRunning: boolean;
  updateCompatibility: MissionControlShellSettingsPanelProps["snapshot"]["diagnostics"]["updateCompatibility"];
  onTryPreviewVersion: (version: string) => void;
}) {
  const isBusy = isCheckingForUpdates || isUpdateRunning;
  const statusLabel = isCheckingForUpdates
    ? "Checking registry"
    : isUpdateRunning
      ? "Updating"
      : hasCertifiedUpdateAvailable
        ? "Certified update"
        : hasRegistryUpdateAvailable
          ? "Latest needs review"
        : updateError
          ? "Check failed"
          : isUpdateRegistryLoading
            ? "Registry loading"
            : "Up to date";
  const statusToneClass = hasCertifiedUpdateAvailable
    ? surfaceTheme === "light"
      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
      : "border-emerald-300/20 bg-emerald-300/10 text-emerald-100"
    : hasRegistryUpdateAvailable
      ? surfaceTheme === "light"
        ? "border-amber-300 bg-amber-50 text-amber-700"
        : "border-amber-300/20 bg-amber-300/10 text-amber-100"
    : updateError
      ? surfaceTheme === "light"
        ? "border-rose-300 bg-rose-50 text-rose-700"
        : "border-rose-300/20 bg-rose-300/10 text-rose-100"
      : isBusy || isUpdateRegistryLoading
        ? surfaceTheme === "light"
          ? "border-amber-300 bg-amber-50 text-amber-700"
          : "border-amber-300/20 bg-amber-300/10 text-amber-100"
        : surfaceTheme === "light"
          ? "border-slate-300 bg-white text-slate-600"
          : "border-white/10 bg-[#0f1826] text-slate-300";

  const detailLabel = isCheckingForUpdates
    ? "Refreshing OpenClaw update registry..."
    : isUpdateRunning
      ? "Installing the selected OpenClaw update."
      : hasCertifiedUpdateAvailable
        ? "A certified recommended OpenClaw release is ready to install."
        : hasRegistryUpdateAvailable
          ? "OpenClaw reports a newer latest release, but AgentOS must classify it before it can be applied safely."
        : updateError
          ? "OpenClaw returned an error while checking updates."
          : isUpdateRegistryLoading
            ? "OpenClaw has not reported a latest release yet."
            : "No newer release is currently available.";

  return (
    <div className={cn("mt-3 rounded-[20px] border p-3.5", insetPanelClassName(surfaceTheme))}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn("text-[10px] uppercase tracking-[0.18em]", mutedTextClassName(surfaceTheme))}>Update status</p>
          <div className="mt-1 flex items-center gap-2">
            {isBusy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin text-emerald-400" /> : null}
            <p className={cn("font-medium", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}>{statusLabel}</p>
            <span className={cn("rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.12em]", statusToneClass)}>
              {hasCertifiedUpdateAvailable ? "Certified" : hasRegistryUpdateAvailable ? "Review" : isBusy ? "Working" : updateError ? "Attention" : "Stable"}
            </span>
          </div>
        </div>
        <div className="text-right">
          <p className={cn("text-[10px] uppercase tracking-[0.18em]", mutedTextClassName(surfaceTheme))}>Last checked</p>
          <p className={cn("mt-1 text-[11px]", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-300")}>
            {lastCheckedAt ? new Date(lastCheckedAt).toLocaleTimeString() : "Not yet"}
          </p>
        </div>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            isBusy
              ? "w-1/2 animate-pulse bg-emerald-400/80"
              : hasCertifiedUpdateAvailable
                ? "w-full bg-emerald-500"
                : hasRegistryUpdateAvailable
                  ? "w-4/5 bg-amber-400"
                : updateError
                  ? "w-2/3 bg-rose-400"
                  : "w-5/6 bg-slate-400/70"
          )}
        />
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Current version"
          value={`v${currentVersion}`}
          surfaceTheme={surfaceTheme}
          dark={surfaceTheme === "dark"}
          compact
        />
        <Metric
          label="Recommended"
          value={recommendedVersion ? `v${recommendedVersion}` : "Unknown"}
          badge={hasCertifiedUpdateAvailable ? "Ready" : updateError ? "Error" : isBusy || isUpdateRegistryLoading ? "Loading" : "Stable"}
          surfaceTheme={surfaceTheme}
          dark={surfaceTheme === "dark"}
          compact
        />
        <Metric
          label="Required baseline"
          value={`v${OPENCLAW_SUPPORTED_BASELINE_VERSION}+`}
          badge="Required"
          surfaceTheme={surfaceTheme}
          dark={surfaceTheme === "dark"}
          compact
        />
        <Metric
          label="Latest detected"
          value={latestVersion ? `v${latestVersion}` : "Unknown"}
          badge={latestDecision ? formatUpdateCompatibilityStatus(latestDecision.status) : hasRegistryUpdateAvailable ? "Review" : "Stable"}
          surfaceTheme={surfaceTheme}
          dark={surfaceTheme === "dark"}
          compact
        />
      </div>

      <div
        className={cn(
          "mt-3 rounded-[18px] border p-3 text-[11px] leading-5",
          surfaceTheme === "light"
            ? "border-border bg-card text-foreground"
            : "border-white/[0.08] bg-[#0d1624] text-slate-300"
        )}
      >
        <p className={cn("text-[10px] uppercase tracking-[0.18em]", mutedTextClassName(surfaceTheme))}>Details</p>
        <p className="mt-1.5">{detailLabel}</p>
        {updateInfo ? <p className="mt-1.5 opacity-90">{updateInfo}</p> : null}
        {updateCompatibility ? (
          <p className="mt-1.5 opacity-90">
            Manifest source: {formatManifestSource(updateCompatibility.manifestSource)}. Recommended status:{" "}
            {formatUpdateCompatibilityStatus(updateCompatibility.recommendedDecision.status)}. OpenClaw {OPENCLAW_SUPPORTED_BASELINE_VERSION}+ required.
          </p>
        ) : null}
        {latestDecision ? (
          <p className="mt-1.5 opacity-90">
            Latest detected status: {formatUpdateCompatibilityStatus(latestDecision.status)}. {latestDecision.reason}
          </p>
        ) : null}
        {hasRegistryUpdateAvailable && !hasCertifiedUpdateAvailable ? (
          <p className="mt-1.5 opacity-90">
            Verification path: install the latest target only after operator confirmation, verify the installed version,
            check Gateway compatibility, run a runtime smoke test, and attempt rollback if postflight fails.
          </p>
        ) : null}
        {updateError ? (
          <p className={cn("mt-1.5", surfaceTheme === "light" ? "text-rose-700" : "text-rose-200")}>{updateError}</p>
        ) : null}
        {hasRegistryUpdateAvailable ? (
          <div className="mt-2 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.16em]">
            <span className={cn("rounded-full border px-2 py-1", statusToneClass)}>
              {hasCertifiedUpdateAvailable ? "Certified update ready" : "Latest requires review"}
            </span>
            <span className={cn("rounded-full border px-2 py-1", mutedTextClassName(surfaceTheme))}>
              {latestVersion ? `Latest v${latestVersion}` : "Latest unknown"}
            </span>
          </div>
        ) : null}
      </div>

      {updateCompatibility ? (
        <div className="mt-3 grid gap-2">
          <CompatibilityVersionRows
            label="Certified"
            versions={updateCompatibility.certifiedVersions}
            surfaceTheme={surfaceTheme}
          />
          <CompatibilityVersionRows
            label="Preview"
            versions={updateCompatibility.candidateVersions}
            surfaceTheme={surfaceTheme}
            actionLabel="Try preview version"
            onAction={onTryPreviewVersion}
            disabled={isBusy}
          />
          <CompatibilityVersionRows
            label="Blocked"
            versions={updateCompatibility.blockedVersions}
            surfaceTheme={surfaceTheme}
            blocked
          />
        </div>
      ) : null}
    </div>
  );
}

function CompatibilityVersionRows({
  label,
  versions,
  surfaceTheme,
  actionLabel,
  onAction,
  disabled = false,
  blocked = false
}: {
  label: string;
  versions: NonNullable<MissionControlShellSettingsPanelProps["snapshot"]["diagnostics"]["updateCompatibility"]>["certifiedVersions"];
  surfaceTheme: SurfaceTheme;
  actionLabel?: string;
  onAction?: (version: string) => void;
  disabled?: boolean;
  blocked?: boolean;
}) {
  if (versions.length === 0) {
    return null;
  }

  return (
    <div className={cn("rounded-[16px] border p-3", insetPanelClassName(surfaceTheme))}>
      <p className={cn("text-[10px] uppercase tracking-[0.18em]", mutedTextClassName(surfaceTheme))}>{label}</p>
      <div className="mt-2 grid gap-2">
        {versions.map((entry) => (
          <div key={`${label}:${entry.version}`} className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className={cn("font-mono text-[11px]", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}>
                v{entry.version}
              </p>
              <p className={cn("mt-0.5 text-[11px] leading-4", blocked ? "text-rose-300" : mutedTextClassName(surfaceTheme))}>
                {entry.reason || entry.notes || formatUpdateCompatibilityStatus(entry.status)}
              </p>
            </div>
            {actionLabel && onAction ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => onAction(entry.version)}
                disabled={disabled}
                className={secondaryButtonClassName(surfaceTheme, "px-3")}
              >
                {actionLabel}
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function UpdateSafetyPanel({
  report,
  shadowProbeReport,
  surfaceTheme
}: {
  report: OpenClawUpdateSafetyReport | null;
  shadowProbeReport: OpenClawShadowProbeReport | null;
  surfaceTheme: SurfaceTheme;
}) {
  if (!report && !shadowProbeReport) {
    return null;
  }

  return (
    <div className="mt-4 grid gap-3">
      {report ? (
        <div className={cn("min-w-0 rounded-[18px] border p-3.5", insetPanelClassName(surfaceTheme))}>
          <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
            <div className="min-w-0">
              <p className={labelClassName(surfaceTheme)}>Preflight result</p>
              <h3 className={cn("mt-1 max-w-full break-words text-sm font-medium", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}>
                OpenClaw v{report.targetVersion} preflight
              </h3>
              <p className={cn("mt-1 text-[11px] leading-4", mutedTextClassName(surfaceTheme))}>
                Preflight checks whether the current AgentOS/OpenClaw environment is ready to attempt the selected update. It does not install or certify the target binary.
              </p>
            </div>
            <span
              className={cn(
                "inline-flex max-w-full justify-self-start rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] sm:justify-self-end",
                report.canAttemptUpdate
                  ? surfaceTheme === "light"
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                    : "border-emerald-300/20 bg-emerald-300/10 text-emerald-100"
                  : surfaceTheme === "light"
                    ? "border-rose-300 bg-rose-50 text-rose-700"
                    : "border-rose-300/20 bg-rose-300/10 text-rose-100"
              )}
            >
              {formatUpdateCompatibilityStatus(report.decision.status)}
            </span>
          </div>
          <InfoRows
            surfaceTheme={surfaceTheme}
            rows={[
              ["Installed now", report.currentVersion ? `v${report.currentVersion}` : "Unknown"],
              ["Required baseline", `v${report.supportedBaselineVersion}+`],
              ["Recommended version", `v${report.recommendedVersion}`],
              ["Target gate", report.canAttemptUpdate ? report.requiresExplicitConfirmation ? "Can be attempted with explicit confirmation" : "Can be attempted" : "Blocked"],
              ["Recommended action", report.recommendedNextAction],
              ["Gateway", report.summary.gatewayReachable ? "Reachable" : "Not ready"],
              ["Protocol", report.summary.gatewayProtocol],
              ["Native auth", report.summary.nativeAuth],
              ["Model readiness", report.summary.modelReadiness],
              ["Native coverage", report.summary.nativeGatewayCoverage],
              ["CLI fallback count", String(report.summary.cliFallbackCount)],
              ["Rollback metadata", report.rollbackSnapshotAvailable ? "Available" : "Will be created before mutation"]
            ]}
          />
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <UpdateSafetyCheckGroup title="Blockers" checks={report.blockers} surfaceTheme={surfaceTheme} tone="blocked" />
            <UpdateSafetyCheckGroup title="Warnings" checks={report.warnings} surfaceTheme={surfaceTheme} tone="warning" />
            <UpdateSafetyCheckGroup title="Unknowns" checks={report.unknowns} surfaceTheme={surfaceTheme} tone="unknown" />
            <UpdateSafetyCheckGroup title="Safe checks" checks={report.safeChecks} surfaceTheme={surfaceTheme} tone="safe" />
          </div>
        </div>
      ) : null}

      {shadowProbeReport ? (
        <div className={cn("min-w-0 rounded-[18px] border p-3.5", insetPanelClassName(surfaceTheme))}>
          <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
            <div className="min-w-0">
              <p className={labelClassName(surfaceTheme)}>Shadow probe</p>
              <h3 className={cn("mt-1 max-w-full break-words text-sm font-medium", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}>
                Target v{shadowProbeReport.targetVersion}
              </h3>
              <p className={cn("mt-1 text-[11px] leading-4", mutedTextClassName(surfaceTheme))}>
                Shadow probe is non-mutating. It confirms the active OpenClaw binary and target manifest decision, but cannot execute the target binary until OpenClaw exposes staging.
              </p>
            </div>
            <span className={cn("inline-flex max-w-full justify-self-start rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] sm:justify-self-end", mutedTextClassName(surfaceTheme))}>
              {shadowProbeReport.supported ? "Staged" : "Limited"}
            </span>
          </div>
          {shadowProbeReport.limitation ? (
            <p className={cn("mt-2 text-xs leading-5", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-300")}>
              {shadowProbeReport.limitation}
            </p>
          ) : null}
          <InfoRows
            surfaceTheme={surfaceTheme}
            rows={[
              ["Mutation safety", shadowProbeReport.mutationSafe ? "No active binary change" : "Unknown"],
              ["Target binary coverage", shadowProbeReport.supported ? "Staged target tested" : "Not staged"],
              ["Current binary version", shadowProbeReport.currentBinaryVersion ?? "Unknown"],
              ["Probe command", shadowProbeReport.command ?? "Not available"],
              ["Next action", shadowProbeReport.recommendedNextAction]
            ]}
          />
          <div className="mt-3 grid gap-2">
            {shadowProbeReport.checks.map((check) => (
              <UpdateSafetyCheckRow key={check.id} check={check} surfaceTheme={surfaceTheme} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CompatibilityLabPanel({
  report,
  bundle,
  scorecard,
  promotion,
  error,
  isGeneratingReport,
  isGeneratingBundle,
  isPromotingCertification,
  isUpdateRunning,
  onGenerateReport,
  onGenerateBundle,
  onRunCertification,
  onCertifyTarget,
  surfaceTheme
}: {
  report: OpenClawCompatibilityLabReport | null;
  bundle: OpenClawCodexFixBundle | null;
  scorecard: OpenClawCertificationScorecardReport | null;
  promotion: OpenClawCompatibilityCertificationPromotion | null;
  error: string | null;
  isGeneratingReport: boolean;
  isGeneratingBundle: boolean;
  isPromotingCertification: boolean;
  isUpdateRunning: boolean;
  onGenerateReport: () => void;
  onGenerateBundle: () => void;
  onRunCertification: (targetVersion: string) => void;
  onCertifyTarget: () => void;
  surfaceTheme: SurfaceTheme;
}) {
  if (!report && !error && !isGeneratingReport) {
    return null;
  }

  const blockingAreas = report?.areas.filter((area) => area.blocksCertification && area.status !== "passed") ?? [];
  const nonPassingAreas = report?.areas.filter((area) => area.status !== "passed") ?? [];
  const scorecardMatchesReport = Boolean(
    report &&
      scorecard &&
      normalizeUpdateVersion(scorecard.targetVersion) === normalizeUpdateVersion(report.targetOpenClawVersion) &&
      normalizeUpdateVersion(scorecard.baselineVersion) === normalizeUpdateVersion(report.currentCertifiedBaseline)
  );
  const canPromoteFromScorecard = Boolean(
    scorecardMatchesReport &&
      scorecard?.artifact &&
      scorecard.hardBlockers.length === 0 &&
      scorecard.roundTripEvidence.status === "passed"
  );
  const certificationRunLabel = !report
    ? "Report required"
    : !scorecardMatchesReport
      ? "Target not installed/tested"
      : scorecard!.status === "blocked" || scorecard!.status === "evidence_missing"
        ? "Certification blocked"
        : canPromoteFromScorecard
          ? "Promotion eligible"
          : formatScorecardStatus(scorecard!.status);

  return (
    <div className={cn("mt-4 rounded-[18px] border p-3.5", insetPanelClassName(surfaceTheme))}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className={labelClassName(surfaceTheme)}>Compatibility Lab</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <p className={cn("font-medium", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}>
              {report ? `OpenClaw v${report.targetOpenClawVersion}` : "No report yet"}
            </p>
            {report ? (
              <span className={transportTonePillClassName(compatibilityLabStatusTone(report.status), surfaceTheme)}>
                {formatCompatibilityLabStatus(report.status)}
              </span>
            ) : null}
            {report?.certificationBlocked ? (
              <span className={transportTonePillClassName("warning", surfaceTheme)}>Needs certification</span>
            ) : null}
          </div>
          <p className={cn("mt-1 text-xs leading-5", mutedTextClassName(surfaceTheme))}>
            {report
              ? `Report ${formatTimestamp(report.generatedAt)}. Report-only checks do not certify the target until the target binary is installed, compared, smoked, and rollback evidence is captured.`
              : "Generate a report to combine manifest policy, Gateway contracts, payload shape checks, runtime smoke, and rollback evidence."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onGenerateReport}
            disabled={isGeneratingReport}
            className={secondaryButtonClassName(surfaceTheme, "px-4")}
          >
            {isGeneratingReport ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Microscope className="h-3.5 w-3.5" />}
            {report ? "Refresh report" : "Generate report"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={onGenerateBundle}
            disabled={!report || isGeneratingBundle || nonPassingAreas.length === 0}
            className={secondaryButtonClassName(surfaceTheme, "px-4")}
          >
            {isGeneratingBundle ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
            Generate Codex fix bundle
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => report ? onRunCertification(report.targetOpenClawVersion) : undefined}
            disabled={!report || isUpdateRunning}
            className={secondaryButtonClassName(surfaceTheme, "px-4")}
            title="Opens the advanced update dialog. Use Certify round-trip there to install the target, compare it to the baseline, run smoke checks, and capture rollback evidence."
          >
            {isUpdateRunning ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            Run target certification
          </Button>
        </div>
      </div>

      {error ? (
        <p className={cn("mt-3 text-xs leading-5", surfaceTheme === "light" ? "text-rose-700" : "text-rose-200")}>
          {error}
        </p>
      ) : null}

      {report ? (
        <>
          <InfoRows
            surfaceTheme={surfaceTheme}
            rows={[
              ["Certified baseline", `v${report.currentCertifiedBaseline}`],
              ["Installed OpenClaw", report.installedOpenClawVersion ? `v${report.installedOpenClawVersion}` : "Unknown"],
              ["Manifest status", formatUpdateCompatibilityStatus(report.manifestDecision.status)],
              ["Certification gate", report.certificationBlocked ? "Blocked" : "No lab blockers"],
              ["Target certification run", certificationRunLabel],
              ["Area counts", `${report.summary.passed} passed / ${report.summary.warnings} warning / ${report.summary.failed} failed / ${report.summary.unknown} unknown`],
              ["Next action", report.summary.recommendedNextAction]
            ]}
          />

          <div
            className={cn(
              "mt-3 rounded-[16px] border p-3",
              canPromoteFromScorecard
                ? surfaceTheme === "light"
                  ? "border-emerald-200 bg-emerald-50/70"
                  : "border-emerald-300/20 bg-emerald-300/10"
                : surfaceTheme === "light"
                  ? "border-amber-200 bg-amber-50/70"
                  : "border-amber-300/20 bg-amber-300/10"
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className={cn("text-sm font-medium", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}>
                  Target install comparison
                </p>
                <p className={cn("mt-1 text-xs leading-5", mutedTextClassName(surfaceTheme))}>
                  {scorecardMatchesReport
                    ? `Round-trip evidence ${scorecard!.roundTripEvidence.status}; score ${scorecard!.score}/100; hard blockers ${scorecard!.hardBlockers.length}.`
                    : "The latest lab report has not yet been backed by a target install, baseline comparison, runtime smoke, and rollback verification run."}
                </p>
              </div>
              <span className={transportTonePillClassName(canPromoteFromScorecard ? "success" : "warning", surfaceTheme)}>
                {certificationRunLabel}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => onRunCertification(report.targetOpenClawVersion)}
                disabled={isUpdateRunning}
                className={secondaryButtonClassName(surfaceTheme, "px-4")}
              >
                {isUpdateRunning ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                Install, compare, smoke
              </Button>
              {canPromoteFromScorecard ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={onCertifyTarget}
                  disabled={isPromotingCertification}
                  className={secondaryButtonClassName(surfaceTheme, "px-4")}
                  title="Certifies this target in the local audited compatibility manifest override."
                >
                  {isPromotingCertification ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Certify target
                </Button>
              ) : null}
            </div>
            {promotion ? (
              <p className={cn("mt-3 text-xs leading-5", surfaceTheme === "light" ? "text-emerald-700" : "text-emerald-100")}>
                Certified v{promotion.targetOpenClawVersion} locally at {formatTimestamp(promotion.promotedAt)}.
                Recommended OpenClaw is now v{promotion.promotedRecommendedVersion} after the next snapshot refresh.
              </p>
            ) : null}
          </div>

          {blockingAreas.length > 0 ? (
            <div className="mt-3 space-y-2">
              {blockingAreas.slice(0, 5).map((area) => (
                <div
                  key={area.id}
                  className={cn(
                    "rounded-[16px] border p-3",
                    surfaceTheme === "light" ? "border-amber-200 bg-amber-50/70" : "border-amber-300/20 bg-amber-300/10"
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={transportTonePillClassName(compatibilityLabStatusTone(area.status), surfaceTheme)}>
                      {formatCompatibilityLabStatus(area.status)}
                    </span>
                    <p className={cn("text-sm font-medium", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}>
                      {area.name}
                    </p>
                  </div>
                  <p className={cn("mt-2 text-xs leading-5", mutedTextClassName(surfaceTheme))}>
                    {area.evidence[0] ?? area.recommendedNextAction}
                  </p>
                  <p className={cn("mt-1 text-xs leading-5", mutedTextClassName(surfaceTheme))}>
                    Fix scope: {area.suggestedFixScope}
                  </p>
                  <p className={cn("mt-1 break-words text-[11px] leading-4", mutedTextClassName(surfaceTheme))}>
                    Affected: {formatShortList(area.affectedAgentOsFiles, 3)}
                  </p>
                </div>
              ))}
            </div>
          ) : null}

          {bundle ? (
            <div className={cn("mt-3 rounded-[16px] border p-3", surfaceTheme === "light" ? "border-border bg-card" : "border-white/[0.08] bg-[#101a2a]/92")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className={cn("text-sm font-medium", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}>
                  Codex fix bundle
                </p>
                <span className={transportTonePillClassName(bundle.failures.length > 0 ? "warning" : "success", surfaceTheme)}>
                  {bundle.failures.length} item{bundle.failures.length === 1 ? "" : "s"}
                </span>
              </div>
              <p className={cn("mt-2 text-xs leading-5", mutedTextClassName(surfaceTheme))}>{bundle.instruction}</p>
              {bundle.failures.length > 0 ? (
                <div className="mt-2 grid gap-2">
                  {bundle.failures.slice(0, 3).map((failure) => (
                    <div key={failure.areaId} className={cn("rounded-[12px] border p-2.5 text-xs", insetPanelClassName(surfaceTheme))}>
                      <p className="font-medium">{failure.areaId}</p>
                      <p className={cn("mt-1 break-words", mutedTextClassName(surfaceTheme))}>
                        {failure.suggestedMinimalPatchScope}
                      </p>
                      <p className={cn("mt-1 break-words font-mono text-[10px]", mutedTextClassName(surfaceTheme))}>
                        {failure.failingCommandOrTest}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
              <DiagnosticBlock
                title="fix bundle json"
                value={formatRawDetails(bundle)}
                surfaceTheme={surfaceTheme}
              />
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function UpdateSafetyCheckGroup({
  title,
  checks,
  surfaceTheme,
  tone
}: {
  title: string;
  checks: OpenClawUpdateSafetyReport["safeChecks"];
  surfaceTheme: SurfaceTheme;
  tone: "safe" | "warning" | "blocked" | "unknown";
}) {
  if (checks.length === 0) {
    return (
      <div className={cn("rounded-[14px] border p-3", insetPanelClassName(surfaceTheme))}>
        <p className={labelClassName(surfaceTheme)}>{title}</p>
        <p className={cn("mt-1 text-xs", mutedTextClassName(surfaceTheme))}>None</p>
      </div>
    );
  }

  return (
    <div className={cn("rounded-[14px] border p-3", insetPanelClassName(surfaceTheme))}>
      <p className={labelClassName(surfaceTheme)}>{title}</p>
      <div className="mt-2 grid gap-2">
        {checks.map((check) => (
          <UpdateSafetyCheckRow key={`${tone}:${check.id}`} check={check} surfaceTheme={surfaceTheme} />
        ))}
      </div>
    </div>
  );
}

function UpdateSafetyCheckRow({
  check,
  surfaceTheme
}: {
  check: OpenClawUpdateSafetyReport["safeChecks"][number];
  surfaceTheme: SurfaceTheme;
}) {
  const toneClass =
    check.status === "safe"
      ? surfaceTheme === "light"
        ? "bg-emerald-500"
        : "bg-emerald-300"
      : check.status === "blocker"
        ? "bg-rose-500"
        : check.status === "warning"
          ? "bg-amber-500"
          : "bg-slate-400";

  return (
    <div className="grid grid-cols-[8px_1fr] gap-2">
      <span className={cn("mt-1.5 h-2 w-2 rounded-full", toneClass)} />
      <div className="min-w-0">
        <p className={cn("text-xs font-medium", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}>{check.label}</p>
        <p className={cn("mt-0.5 text-[11px] leading-4", mutedTextClassName(surfaceTheme))}>{check.message}</p>
      </div>
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

function formatCompatibilitySmokeStatus(value: CompatibilitySmokeReport["status"]) {
  switch (value) {
    case "compatible":
      return "Compatible";
    case "degraded":
      return "Degraded";
    case "incompatible":
      return "Incompatible";
    case "unknown":
    default:
      return "Unknown";
  }
}

function formatCompatibilityReportStatus(value: CompatibilityReport["status"]) {
  switch (value) {
    case "compatible":
      return "Compatible";
    case "degraded":
      return "Degraded";
    case "incompatible":
      return "Incompatible";
    case "unknown":
    default:
      return "Unknown";
  }
}

function formatUpdateCompatibilityStatus(value: string) {
  switch (value) {
    case "certified":
      return "Certified";
    case "candidate":
      return "Preview";
    case "blocked":
      return "Blocked";
    case "unknown":
    default:
      return "Needs certification";
  }
}

function formatCompatibilityLabStatus(value: OpenClawCompatibilityLabReport["status"] | OpenClawCompatibilityLabReport["areas"][number]["status"]) {
  switch (value) {
    case "passed":
      return "Passed";
    case "warning":
      return "Warning";
    case "failed":
      return "Failed";
    case "unknown":
    default:
      return "Unknown";
  }
}

function normalizeUpdateVersion(value: string | null | undefined) {
  const normalized = value?.trim().replace(/^v/i, "");
  return normalized || null;
}

function resolveLatestVersionFromUpdateInfo(value: string | null | undefined) {
  const text = value?.trim();
  if (!text) {
    return null;
  }

  return normalizeUpdateVersion(text.match(/Update available:\s*v?([0-9][0-9A-Za-z.-]*)/i)?.[1]);
}

function resolveUpdateDecisionMode(
  decision: OpenClawUpdateDecision | null | undefined
): OpenClawUpdateCompatibilityMode {
  if (decision?.status === "candidate") {
    return "candidate";
  }

  if (decision?.status === "unknown") {
    return "advanced";
  }

  return "recommended";
}

function formatManifestSource(value: string) {
  switch (value) {
    case "local-fallback":
      return "Local fallback";
    case "remote":
      return "Remote";
    case "override":
      return "Override";
    default:
      return value;
  }
}

function compatibilitySmokeStatusTone(value: CompatibilitySmokeReport["status"]): TransportStatusTone {
  switch (value) {
    case "compatible":
      return "success";
    case "degraded":
      return "warning";
    case "incompatible":
      return "danger";
    case "unknown":
    default:
      return "neutral";
  }
}

function compatibilityReportStatusTone(value: CompatibilityReport["status"]): TransportStatusTone {
  switch (value) {
    case "compatible":
      return "success";
    case "degraded":
      return "warning";
    case "incompatible":
      return "danger";
    case "unknown":
    default:
      return "neutral";
  }
}

function compatibilityLabStatusTone(value: OpenClawCompatibilityLabReport["status"] | OpenClawCompatibilityLabReport["areas"][number]["status"]): TransportStatusTone {
  switch (value) {
    case "passed":
      return "success";
    case "warning":
      return "warning";
    case "failed":
      return "danger";
    case "unknown":
    default:
      return "neutral";
  }
}

function formatContractStatus(value: CompatibilityReport["contracts"][number]["status"]) {
  switch (value) {
    case "ok":
      return "OK";
    case "degraded":
      return "Degraded";
    case "unsupported":
      return "Unsupported";
    case "failed":
      return "Failed";
  }
}

function contractStatusTone(value: CompatibilityReport["contracts"][number]["status"]): TransportStatusTone {
  switch (value) {
    case "ok":
      return "success";
    case "degraded":
      return "warning";
    case "unsupported":
    case "failed":
      return "danger";
  }
}

function formatSmokeCheckStatus(value: CompatibilitySmokeReport["checks"][number]["status"]) {
  switch (value) {
    case "pass":
      return "Pass";
    case "warning":
      return "Warning";
    case "fail":
      return "Fail";
    default:
      return "Unknown";
  }
}

function smokeCheckTone(value: CompatibilitySmokeReport["checks"][number]["status"]): TransportStatusTone {
  switch (value) {
    case "pass":
      return "success";
    case "warning":
      return "warning";
    case "fail":
      return "danger";
    default:
      return "neutral";
  }
}

function formatNodeStatus(value: CompatibilitySmokeReport["compatibility"]["nodeStatus"]) {
  switch (value) {
    case "supported":
      return "Supported";
    case "unsupported":
      return "Unsupported";
    case "unknown":
    default:
      return "Unknown";
  }
}

function formatVersionValue(value: string | null | undefined) {
  return value ? `v${value.replace(/^v/i, "")}` : "Unknown";
}

function formatGatewayProtocolReport(report: CompatibilityReport) {
  const version = report.gateway.protocolVersion ? `v${report.gateway.protocolVersion}` : "unknown";
  return `${version} / ${report.gateway.protocolStatus}`;
}

function formatShortList(values: string[], maxVisible: number) {
  const unique = Array.from(new Set(values));
  const visible = unique.slice(0, maxVisible);
  const suffix = unique.length > visible.length ? ` +${unique.length - visible.length}` : "";

  return `${visible.join(", ")}${suffix}`;
}

function formatRawDetails(value: unknown) {
  if (value === undefined || value === null) {
    return "No raw details";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatGatewayAuthIssue(kind: GatewayNativeAuthStatus["native"]["kind"]) {
  switch (kind) {
    case "auth":
      return "Needs credential";
    case "scope-limited":
      return "Needs scope repair";
    case "rate-limited":
      return "Rate limited";
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

function formatConfigUpdatePacingMode(value: string) {
  switch (value) {
    case "fast-local-testing":
      return "Fast local testing";
    case "custom":
      return "Custom";
    case "respect-gateway":
    default:
      return "Respect Gateway cooldown";
  }
}

function formatConfigUpdatePacingInterval(valueMs: number | null | undefined) {
  if (!valueMs || valueMs <= 0) {
    return "Gateway cooldown only";
  }

  const seconds = Math.ceil(valueMs / 1_000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function copyToClipboard(value: string) {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    return;
  }

  void navigator.clipboard.writeText(value);
}

function resolveInitialSettingsSection(): SettingsSectionId {
  return "general";
}

function resolveHashSettingsSection(): SettingsSectionId {
  if (typeof window === "undefined") {
    return resolveInitialSettingsSection();
  }

  switch (window.location.hash.replace(/^#/, "")) {
    case "overview":
      return "overview";
    case "gateway":
      return "gateway";
    case "general":
    case "tools":
      return "general";
    case "capabilities":
      return "capabilities";
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
      return "openclaw";
    default:
      return "overview";
  }
}

function cardClassName(surfaceTheme: SurfaceTheme) {
  return surfaceTheme === "light"
    ? "border-border bg-card/92 text-card-foreground shadow-card"
    : "border border-white/[0.10] bg-[#121d2d] text-slate-100 shadow-[0_22px_56px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.035)]";
}

function cardIconClassName(surfaceTheme: SurfaceTheme) {
  return surfaceTheme === "light"
    ? "flex h-10 w-10 items-center justify-center rounded-[14px] border border-primary/15 bg-primary/10 text-primary"
    : "flex h-10 w-10 items-center justify-center rounded-[14px] border border-primary/15 bg-primary/10 text-primary";
}

function labelClassName(surfaceTheme: SurfaceTheme) {
  return cn("text-[10px] uppercase tracking-[0.18em]", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400");
}

function inputClassName(surfaceTheme: SurfaceTheme, extraClassName?: string) {
  return cn(
    "h-10 rounded-[16px] px-3 text-sm outline-none",
    extraClassName,
    surfaceTheme === "light"
      ? "border-input bg-card text-foreground placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring/25"
      : "border-input bg-[#0f1826] text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
  );
}

function copyButtonClassName(surfaceTheme: SurfaceTheme) {
  return cn(
    "flex h-10 w-10 shrink-0 items-center justify-center rounded-[16px] border",
    surfaceTheme === "light"
      ? "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
      : "border-border bg-[#121d2d] text-slate-200 hover:bg-[#182538]"
  );
}

function secondaryButtonClassName(surfaceTheme: SurfaceTheme, extraClassName?: string, mode?: "default" | "gateway-contrast") {
  return cn(
    "h-9 rounded-full px-3 text-xs",
    extraClassName,
    surfaceTheme === "light"
      ? "border-border bg-card text-secondary-foreground hover:bg-muted hover:text-foreground"
      : mode === "gateway-contrast"
        ? "border-primary/15 bg-[#0f1826] text-foreground hover:bg-[#182538]"
        : "border-border bg-[#121d2d] text-slate-200 hover:bg-[#182538]"
  );
}

function segmentedButtonClassName(surfaceTheme: SurfaceTheme, active: boolean) {
  return cn(
    "h-9 rounded-full border px-3 text-xs transition-colors",
    active
      ? surfaceTheme === "light"
        ? "border-primary/35 bg-primary/10 text-primary"
        : "border-primary/30 bg-primary/12 text-primary"
      : surfaceTheme === "light"
        ? "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
        : "border-border bg-[#121d2d] text-slate-200 hover:bg-[#182538]"
  );
}

function insetPanelClassName(surfaceTheme: SurfaceTheme) {
  return surfaceTheme === "light"
    ? "border-border bg-muted/45"
    : "border-white/[0.08] bg-[#0c1522]";
}

function mutedTextClassName(surfaceTheme: SurfaceTheme) {
  return surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400";
}

function infoRowsShellClassName(surfaceTheme: SurfaceTheme) {
  return surfaceTheme === "light"
    ? "border-border bg-card"
    : "border-white/[0.08] bg-[#0c1522]";
}

function infoRowBorderClassName(surfaceTheme: SurfaceTheme) {
  return surfaceTheme === "light" ? "border-b border-border" : "border-b border-border";
}
