"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  LoaderCircle,
  PauseCircle,
  RefreshCw,
  ShieldAlert,
  Wrench
} from "lucide-react";

import {
  KeyValue,
  OperationsPageLayout,
  PageHeader,
  SectionCard,
  StatusBadge,
  ToolbarButton,
  type StatusTone
} from "@/components/operations/operations-ui";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { PikoLoader } from "@/components/ui/piko-loader";
import { toast } from "@/components/ui/sonner";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import type {
  NativeDoctorConfirmation,
  NativeDoctorSnapshot
} from "@/lib/openclaw/application/native-doctor-service";
import {
  formatAutomaticUpdateState,
  formatNativeChannel,
  formatNativeUpdateStateLabel,
  type NormalOpenClawUpdatePolicy,
  type NativeUpdateUserState
} from "@/lib/openclaw/update-presentation";
import type {
  OpenClawStabilityRelease,
  OpenClawStabilitySnapshot
} from "@/lib/openclaw/stability-types";
import { cn } from "@/lib/utils";

type UpdatesPageContentProps = {
  snapshot: MissionControlSnapshot;
  rootSnapshot: MissionControlSnapshot;
  refresh: () => Promise<void>;
  setSnapshot: Dispatch<SetStateAction<MissionControlSnapshot>>;
};

type NativeDoctorResponse = {
  snapshot?: NativeDoctorSnapshot;
  confirmation?: NativeDoctorConfirmation;
  policy?: NormalOpenClawUpdatePolicy;
  error?: string;
};

type NativeUpdateMutationResult = {
  outcome?: "succeeded" | "accepted" | "deferred" | "skipped" | "failed" | "unknown";
  message?: string;
  verification?: {
    status?: "not-required" | "verified" | "unknown";
    message?: string;
  };
};

type CommunityResponse = {
  stability?: OpenClawStabilitySnapshot;
};

type UpdateActionState = "idle" | "running" | "success" | "error" | "unknown";

export function UpdatesPageContent({ refresh }: UpdatesPageContentProps) {
  const [native, setNative] = useState<NativeDoctorSnapshot | null>(null);
  const [confirmation, setConfirmation] = useState<NativeDoctorConfirmation | null>(null);
  const [policy, setPolicy] = useState<NormalOpenClawUpdatePolicy | null>(null);
  const [nativeError, setNativeError] = useState<string | null>(null);
  const [community, setCommunity] = useState<OpenClawStabilitySnapshot | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(true);
  const [actionState, setActionState] = useState<UpdateActionState>("idle");
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [confirmUpdate, setConfirmUpdate] = useState(false);

  const loadNative = useCallback(async (probe = false) => {
    setNativeError(null);

    try {
      const response = await fetch(`/api/openclaw/native-doctor${probe ? "?probe=1" : ""}`, {
        cache: "no-store"
      });
      const payload = (await response.json().catch(() => null)) as NativeDoctorResponse | null;

      if (!response.ok || !payload?.snapshot) {
        throw new Error(payload?.error || "OpenClaw update status is unavailable.");
      }

      setNative(payload.snapshot);
      setConfirmation(payload.confirmation ?? null);
      setPolicy(payload.policy ?? null);
    } catch (error) {
      setNativeError(error instanceof Error ? error.message : "OpenClaw update status is unavailable.");
    }
  }, []);

  const loadCommunity = useCallback(async () => {
    try {
      const response = await fetch("/api/openclaw/updates", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as CommunityResponse | null;
      if (response.ok && payload?.stability) {
        setCommunity(payload.stability);
      }
    } catch {
      // Community release intelligence is advisory and must never block native update state.
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setIsRefreshing(true);
    void loadCommunity();
    try {
      await Promise.all([loadNative(true), refresh()]);
    } finally {
      setIsRefreshing(false);
    }
  }, [loadCommunity, loadNative, refresh]);

  useEffect(() => {
    let cancelled = false;
    void loadCommunity();
    void Promise.all([loadNative(), refresh()]).finally(() => {
      if (!cancelled) setIsRefreshing(false);
    });
    return () => {
      cancelled = true;
    };
  }, [loadCommunity, loadNative, refresh]);

  const currentVersion = normalizeVersion(
    policy?.currentVersion || native?.update.currentVersion || native?.status.runtimeVersion || native?.status.version
  );
  const availableVersion = normalizeVersion(policy?.nativeAvailableVersion || native?.update.latestVersion);
  const channel = formatNativeChannel(policy?.effectiveChannel || native?.update.effectiveChannel || native?.status.updateChannel);
  const userState: NativeUpdateUserState = policy?.state ?? "unknown";
  const canRunNativeUpdate = Boolean(policy?.canRunNormalUpdate && confirmation?.connectionId);
  const canHoldNativeUpdate = Boolean(policy?.canHoldUpdate && confirmation?.connectionId);
  const communityRelease = useMemo(
    () => findCommunityRelease(community, availableVersion),
    [availableVersion, community]
  );

  const runNativeUpdate = async () => {
    if (!confirmation?.connectionId || !confirmation.effectiveChannel || !confirmation.availableVersion) {
      setActionState("error");
      setActionMessage("Refresh the OpenClaw update status before trying again.");
      setConfirmUpdate(false);
      return;
    }

    setConfirmUpdate(false);
    setActionState("running");
    setActionMessage("Updating OpenClaw. The runtime may restart and reconnect.");
    const toastId = toast.loading("Updating OpenClaw...", {
      description: "OpenClaw's native update lifecycle is running.",
      duration: Infinity
    });

    try {
      const response = await fetch("/api/openclaw/native-doctor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          action: "update.run",
          confirmation,
          note: "AgentOS Updates"
        })
      });
      const payload = (await response.json().catch(() => null)) as {
        result?: NativeUpdateMutationResult;
        error?: string;
      } | null;
      const result = payload?.result;

      if (!response.ok && !result) {
        throw new Error(payload?.error || "OpenClaw update failed.");
      }

      const resultMessage = result?.message || payload?.error || "OpenClaw returned an update result.";
      const verificationUnknown = result?.verification?.status === "unknown" || result?.outcome === "unknown";
      const deferred = result?.outcome === "deferred";
      const failed = result?.outcome === "failed";
      const skipped = result?.outcome === "skipped";

      if (failed) {
        setActionState("error");
        setActionMessage(resultMessage);
        toast.error("OpenClaw update needs attention", { id: toastId, description: resultMessage });
      } else if (verificationUnknown || deferred) {
        setActionState("unknown");
        setActionMessage(
          deferred
            ? "OpenClaw handed the update to its supervisor. Return here to verify the result."
            : resultMessage
        );
        toast.warning("OpenClaw update verification pending", { id: toastId, description: resultMessage });
      } else if (skipped) {
        setActionState("unknown");
        setActionMessage(resultMessage);
        toast.warning("OpenClaw skipped the update", { id: toastId, description: resultMessage });
      } else {
        setActionState("success");
        setActionMessage(result?.verification?.status === "verified" ? "OpenClaw updated and verified." : resultMessage);
        toast.success("OpenClaw update completed", { id: toastId, description: resultMessage });
      }

      await Promise.all([loadNative(true), refresh()]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "OpenClaw update failed.";
      setActionState("error");
      setActionMessage(message);
      toast.error("OpenClaw update needs attention", { id: toastId, description: message });
    }
  };

  const holdNativeUpdate = async () => {
    if (!confirmation?.connectionId || !confirmation.effectiveChannel || !confirmation.availableVersion) {
      setActionState("error");
      setActionMessage("Refresh the OpenClaw update status before trying again.");
      return;
    }

    setActionState("running");
    setActionMessage("Asking OpenClaw to hold the active update campaign.");
    try {
      const response = await fetch("/api/openclaw/native-doctor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ action: "update.hold", confirmation })
      });
      const payload = (await response.json().catch(() => null)) as {
        result?: NativeUpdateMutationResult;
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error || "OpenClaw could not hold the update campaign.");
      }
      setActionState("success");
      setActionMessage(payload?.result?.message || "OpenClaw held the active update campaign.");
      toast.success("OpenClaw update held", { description: payload?.result?.message });
      await Promise.all([loadNative(true), refresh()]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "OpenClaw could not hold the update campaign.";
      setActionState("error");
      setActionMessage(message);
      toast.error("OpenClaw update hold failed", { description: message });
    }
  };

  const durableUpdateRunning = native?.update.activeRun?.status === "running";

  return (
    <>
      <PikoLoader
        open={actionState === "running" || isRefreshing}
        title={actionState === "running" ? "Updating OpenClaw" : "Checking OpenClaw updates"}
        description={
          actionState === "running"
            ? durableUpdateRunning
              ? "OpenClaw is applying its native update run. This state is owned by OpenClaw and survives reconnects."
              : "OpenClaw may restart. AgentOS will verify the reconnect and final runtime state."
            : "Reading the authoritative native update status."
        }
      />
      <PageHeader
        title="OpenClaw Updates"
        subtitle="Keep the OpenClaw runtime up to date using its native update system."
        actions={(
          <ToolbarButton
            icon={RefreshCw}
            label={isRefreshing ? "Refreshing" : "Refresh"}
            onClick={() => void refreshAll()}
            disabled={isRefreshing || actionState === "running"}
          />
        )}
      />

      <OperationsPageLayout
        main={(
          <div className="space-y-3">
            <PrimaryUpdateCard
              currentVersion={currentVersion}
              availableVersion={availableVersion}
              agentOsDecision={policy?.agentOsDecision ?? null}
              policyReason={policy?.reason ?? null}
              channel={channel}
              state={userState}
              native={native}
              nativeError={nativeError}
              actionState={actionState}
              actionMessage={actionMessage}
              canRunNativeUpdate={canRunNativeUpdate}
              canHoldNativeUpdate={canHoldNativeUpdate}
              onRequestUpdate={() => setConfirmUpdate(true)}
              onHoldUpdate={() => void holdNativeUpdate()}
              onRefresh={() => void refreshAll()}
            />

            {native ? (
              <SectionCard title="Update details">
                <div className="grid gap-2 p-3 sm:grid-cols-2">
                  <KeyValue label="Update channel" value={channel} />
                  <KeyValue label="Automatic updates" value={formatAutomaticUpdateState(native.update.schedule)} />
                  <KeyValue label="Native status" value={native.update.readStatus === "available" ? "Authoritative" : native.update.readStatus} />
                  <KeyValue label="Runtime" value={native.runtime.status.replaceAll("-", " ")} />
                  <KeyValue label="OpenClaw update state" value={formatNativeUpdateStateLabel(userState)} />
                  <KeyValue label="Last native read" value={formatTimestamp(native.generatedAt)} />
                </div>
                <div className="border-t border-border px-3 py-3 text-xs leading-5 text-muted-foreground">
                  Automatic-update controls are shown only when OpenClaw exposes a safe native mutation for them. This runtime currently reports the state read-only.
                </div>
              </SectionCard>
            ) : null}

            {community ? <CommunityDisclosure release={communityRelease} snapshot={community} /> : null}

            <SectionCard title="Advanced">
              <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">Compatibility and recovery tools</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Exact-version certification, preflight, rollback and raw diagnostics remain available to advanced operators.
                  </p>
                </div>
                <Button asChild variant="secondary" size="sm" className="shrink-0">
                  <Link href="/settings#advanced">
                    Open advanced tools
                    <ChevronDown className="ml-1.5 h-3.5 w-3.5 -rotate-90" />
                  </Link>
                </Button>
              </div>
            </SectionCard>
          </div>
        )}
        inspector={(
          <aside className="hidden min-w-0 xl:block">
            <SectionCard title="Native update authority" className="sticky top-4">
              <div className="space-y-3 p-3">
                <StatusLine label="Installed" value={currentVersion ? `v${currentVersion}` : "Unknown"} />
                <StatusLine label="Channel" value={channel} />
                <StatusLine label="Available" value={availableVersion ? `v${availableVersion}` : "None reported"} />
                <StatusLine label="AgentOS compatibility" value={formatAgentOsPolicy(policy?.agentOsDecision ?? null)} />
                <p className="border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
                  OpenClaw owns update availability and execution. AgentOS only applies its certification policy and verifies the returned runtime state.
                </p>
              </div>
            </SectionCard>
          </aside>
        )}
      />

      <Dialog open={confirmUpdate} onOpenChange={setConfirmUpdate}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Update and restart OpenClaw?</DialogTitle>
            <DialogDescription>
              OpenClaw will run its native update lifecycle. The Gateway may disconnect briefly, then AgentOS will reconnect and verify the runtime.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 rounded-lg border border-border bg-muted/35 p-3 text-sm">
            <KeyValue label="Current version" value={currentVersion ? `v${currentVersion}` : "Unknown"} />
            <KeyValue label="Available version" value={availableVersion ? `v${availableVersion}` : "Unknown"} />
            <KeyValue label="Channel" value={channel} />
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setConfirmUpdate(false)}>Cancel</Button>
            <Button type="button" onClick={() => void runNativeUpdate()}>Update & restart</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PrimaryUpdateCard({
  currentVersion,
  availableVersion,
  agentOsDecision,
  policyReason,
  channel,
  state,
  native,
  nativeError,
  actionState,
  actionMessage,
  canRunNativeUpdate,
  canHoldNativeUpdate,
  onRequestUpdate,
  onHoldUpdate,
  onRefresh
}: {
  currentVersion: string | null;
  availableVersion: string | null;
  agentOsDecision: NormalOpenClawUpdatePolicy["agentOsDecision"];
  policyReason: string | null;
  channel: string;
  state: NativeUpdateUserState;
  native: NativeDoctorSnapshot | null;
  nativeError: string | null;
  actionState: UpdateActionState;
  actionMessage: string | null;
  canRunNativeUpdate: boolean;
  canHoldNativeUpdate: boolean;
  onRequestUpdate: () => void;
  onHoldUpdate: () => void;
  onRefresh: () => void;
}) {
  const copy = resolvePrimaryCopy({ state, currentVersion, availableVersion, agentOsDecision, policyReason, nativeError });
  const tone = primaryTone(state, actionState);

  return (
    <SectionCard className="overflow-hidden">
      <div className="border-b border-border px-4 py-5 sm:px-6 sm:py-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge label={copy.statusLabel} tone={tone} />
              {native?.identity.authenticated === false ? <StatusBadge label="Gateway auth required" tone="warning" /> : null}
            </div>
            <h2 className="mt-3 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">{copy.title}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{copy.description}</p>
          </div>
          <div className="shrink-0 text-left sm:text-right">
            <p className="text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Installed</p>
            <p className="mt-1 font-mono text-lg font-semibold text-foreground">{currentVersion ? `v${currentVersion}` : "Unknown"}</p>
            <p className="mt-1 text-xs text-muted-foreground">{channel} channel</p>
          </div>
        </div>

        {availableVersion && (state === "available-certified" || state === "available-uncertified" || state === "blocked" || state === "running") ? (
          <div className="mt-5 grid grid-cols-2 gap-2 sm:max-w-md">
            <VersionTile label="Current" value={currentVersion ? `v${currentVersion}` : "Unknown"} />
            <VersionTile label="Available" value={`v${availableVersion}`} accent />
          </div>
        ) : null}

        {native?.update.activeRun ? <ActiveUpdateRun run={native.update.activeRun} /> : null}
        {!native?.update.activeRun && native?.update.lastRun ? <LastUpdateRun run={native.update.lastRun} /> : null}

        {state === "available-uncertified" ? (
          <div className="mt-4 rounded-lg border border-[hsl(var(--status-warning)/0.25)] bg-[hsl(var(--status-warning)/0.08)] p-3 text-sm">
            <div className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--status-warning-foreground))]" />
              <div>
                <p className="font-medium text-foreground">AgentOS has not certified this exact OpenClaw release.</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">Wait for AgentOS certification before using the normal update action. Advanced compatibility tools remain available if you need to test this release.</p>
              </div>
            </div>
          </div>
        ) : null}

        {actionMessage ? (
          <div className={cn("mt-4 rounded-lg border p-3 text-sm", actionState === "success" ? "border-[hsl(var(--status-success)/0.25)] bg-[hsl(var(--status-success)/0.08)]" : actionState === "error" ? "border-[hsl(var(--status-danger)/0.25)] bg-[hsl(var(--status-danger)/0.08)]" : "border-[hsl(var(--status-warning)/0.25)] bg-[hsl(var(--status-warning)/0.08)]")} role="status">
            <div className="flex items-start gap-2">
              {actionState === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--status-success-foreground))]" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--status-warning-foreground))]" />}
              <p className="leading-5 text-foreground">{actionMessage}</p>
            </div>
          </div>
        ) : null}

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
          {state === "available-certified" ? (
            <Button
              type="button"
              onClick={onRequestUpdate}
              disabled={!canRunNativeUpdate || actionState === "running"}
              title={!canRunNativeUpdate ? "Native OpenClaw update scope or connection confirmation is unavailable." : undefined}
              className="min-h-11 sm:min-h-9"
            >
              {actionState === "running" ? <LoaderCircle className="mr-1.5 h-4 w-4 animate-spin" /> : <Wrench className="mr-1.5 h-4 w-4" />}
              Update & restart
            </Button>
          ) : null}
          {canHoldNativeUpdate ? (
            <Button
              type="button"
              variant="secondary"
              onClick={onHoldUpdate}
              disabled={actionState === "running"}
              className="min-h-11 sm:min-h-9"
            >
              {actionState === "running" ? <LoaderCircle className="mr-1.5 h-4 w-4 animate-spin" /> : <PauseCircle className="mr-1.5 h-4 w-4" />}
              Hold this update
            </Button>
          ) : null}
          {state === "available-uncertified" || state === "blocked" ? (
            <Button asChild type="button" variant="secondary" className="min-h-11 sm:min-h-9">
              <Link href="/settings#advanced">{state === "blocked" ? "View compatibility tools" : "Advanced options"}</Link>
            </Button>
          ) : null}
          {(state === "unavailable" || state === "unknown") ? (
            <Button type="button" variant="secondary" onClick={onRefresh} className="min-h-11 sm:min-h-9">
              <RefreshCw className="mr-1.5 h-4 w-4" />
              Check again
            </Button>
          ) : null}
        </div>
      </div>
      <div className="grid gap-2 bg-muted/25 px-4 py-3 text-xs text-muted-foreground sm:grid-cols-3 sm:px-6">
        <StatusFact label="Channel" value={channel} />
        <StatusFact label="AgentOS compatibility" value={formatAgentOsPolicy(agentOsDecision)} />
        <StatusFact label="Source" value={native ? "OpenClaw update.status" : "Waiting for native status"} />
      </div>
    </SectionCard>
  );
}

function CommunityDisclosure({
  release,
  snapshot
}: {
  release: OpenClawStabilityRelease | null;
  snapshot: OpenClawStabilitySnapshot;
}) {
  return (
    <details className="group rounded-lg border border-border bg-card/80">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
        <span>Release intelligence <span className="ml-1 text-xs font-normal text-muted-foreground">(advisory)</span></span>
        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-border px-4 py-3 text-xs leading-5 text-muted-foreground">
        <p>Community confidence never decides whether OpenClaw is up to date or whether an update runs.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <StatusFact label="Source" value="isitstable.iclaw.digital" />
          <StatusFact label="Latest signal" value={snapshot.latestVersion ? `v${snapshot.latestVersion}` : "Unavailable"} />
          <StatusFact label="Target signal" value={release?.score == null ? "Unavailable" : `${release.score.toFixed(1)} / 10`} />
        </div>
        {snapshot.error ? <p className="mt-3 text-[hsl(var(--status-warning-foreground))]">Advisory source issue: {snapshot.error}</p> : null}
        {release?.url ? (
          <a href={release.url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 font-medium text-primary hover:underline">
            Review community release signal <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </div>
    </details>
  );
}

function ActiveUpdateRun({ run }: { run: NonNullable<NativeDoctorSnapshot["update"]["activeRun"]> }) {
  const target = run.targetVersion ? ` · v${run.targetVersion}` : "";
  return (
    <div className="mt-4 rounded-lg border border-[hsl(var(--status-warning)/0.25)] bg-[hsl(var(--status-warning)/0.08)] p-3" role="status">
      <div className="flex items-start gap-2">
        <LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-[hsl(var(--status-warning-foreground))]" />
        <div className="min-w-0">
          <p className="font-medium text-foreground">OpenClaw update in progress{target}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {formatNativeUpdateRunPhase(run.phase)} Gateway state is owned by OpenClaw. AgentOS will re-read it after reconnect.
          </p>
        </div>
      </div>
    </div>
  );
}

function LastUpdateRun({ run }: { run: NonNullable<NativeDoctorSnapshot["update"]["lastRun"]> }) {
  const outcome = run.status === "succeeded" ? "Completed" : run.status === "failed" || run.status === "rolled-back" ? "Needs attention" : "Skipped";
  return (
    <details className="group mt-4 rounded-lg border border-border bg-muted/20">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
        <span>
          <span className="font-medium text-foreground">Last update</span>
          <span className="ml-2 text-xs text-muted-foreground">{outcome} · {formatTimestampMs(run.finishedAtMs ?? run.updatedAtMs)}</span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-border px-3 py-3 text-xs leading-5 text-muted-foreground">
        <div className="grid gap-2 sm:grid-cols-3">
          <StatusFact label="From" value={run.beforeVersion ? `v${run.beforeVersion}` : "Unknown"} />
          <StatusFact label="To" value={run.afterVersion || run.targetVersion ? `v${run.afterVersion || run.targetVersion}` : "Unknown"} />
          <StatusFact label="Verification" value={run.verification?.versionMatch === true ? "Verified" : run.verification?.versionMatch === false ? "Mismatch" : "Not reported"} />
        </div>
        {run.reason ? <p className="mt-3">{run.reason}</p> : null}
      </div>
    </details>
  );
}

function formatNativeUpdateRunPhase(phase: NonNullable<NativeDoctorSnapshot["update"]["activeRun"]>["phase"]) {
  switch (phase) {
    case "requested":
      return "Preparing the update…";
    case "staging":
    case "validating":
    case "repairing":
      return "Updating OpenClaw…";
    case "activating":
    case "restarting":
      return "Restarting the Gateway…";
    case "verifying":
      return "Verifying the runtime…";
    case "finished":
      return "Finishing the update…";
  }
}

function StatusLine({ label, value }: { label: string; value: string }) {
  return <KeyValue label={label} value={value} />;
}

function StatusFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-medium text-foreground" title={value}>{value}</p>
    </div>
  );
}

function VersionTile({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={cn("rounded-lg border px-3 py-2.5", accent ? "border-primary/25 bg-primary/10" : "border-border bg-muted/40")}>
      <p className="text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function resolvePrimaryCopy(input: {
  state: NativeUpdateUserState;
  currentVersion: string | null;
  availableVersion: string | null;
  agentOsDecision: NormalOpenClawUpdatePolicy["agentOsDecision"];
  policyReason: string | null;
  nativeError: string | null;
}) {
  switch (input.state) {
    case "up-to-date":
      return {
        statusLabel: "Up to date",
        title: "OpenClaw is up to date",
        description: `OpenClaw reports no update on the ${input.currentVersion ? `v${input.currentVersion} ` : ""}active channel.`
      };
    case "available-certified":
      return {
        statusLabel: "Update available",
        title: `OpenClaw ${input.availableVersion ? `v${input.availableVersion}` : "update"} is available`,
        description: "AgentOS has verified this OpenClaw release. Updating will use OpenClaw's native updater and restart the Gateway if required."
      };
    case "available-uncertified":
      return {
        statusLabel: "Certification pending",
        title: `OpenClaw ${input.availableVersion ? `v${input.availableVersion}` : "update"} is available`,
        description: input.agentOsDecision?.reason || "AgentOS has not certified this exact OpenClaw release."
      };
    case "blocked":
      return {
        statusLabel: "Blocked by AgentOS policy",
        title: `OpenClaw ${input.availableVersion ? `v${input.availableVersion}` : "update"} is available`,
        description: input.agentOsDecision?.reason || input.policyReason || "AgentOS compatibility policy currently blocks this release. Review the Compatibility Lab for recovery options."
      };
    case "held":
      return {
        statusLabel: "Update held",
        title: "OpenClaw has paused this update",
        description: "The active OpenClaw rollout or campaign is on hold. AgentOS is showing the native state without creating a separate lifecycle."
      };
    case "running":
      return {
        statusLabel: "Updating OpenClaw",
        title: "OpenClaw is updating",
        description: "OpenClaw is applying its native update campaign. The Gateway may restart before final verification."
      };
    case "unavailable":
      return {
        statusLabel: "Unavailable",
        title: "OpenClaw update status is unavailable",
        description: input.nativeError || "OpenClaw did not authorize or expose the native update status method."
      };
    case "unknown":
      return {
        statusLabel: "Unknown",
        title: "OpenClaw update status could not be verified",
        description: input.nativeError || "Refresh the page after the Gateway reconnects, then check the native update status again."
      };
  }
}

function primaryTone(state: NativeUpdateUserState, actionState: UpdateActionState): StatusTone {
  if (actionState === "success") return "success";
  if (actionState === "error") return "danger";
  if (actionState === "running" || actionState === "unknown" || state === "running") return "warning";
  if (state === "up-to-date" || state === "available-certified") return state === "up-to-date" ? "success" : "info";
  if (state === "available-uncertified" || state === "blocked" || state === "held") return "warning";
  return "muted";
}

function formatAgentOsPolicy(decision: NormalOpenClawUpdatePolicy["agentOsDecision"]) {
  switch (decision?.status) {
    case "certified":
      return "Certified";
    case "candidate":
      return "Candidate — advanced only";
    case "blocked":
      return "Blocked";
    case "unknown":
      return "Not yet certified";
    default:
      return "Unavailable";
  }
}

function normalizeVersion(value: string | null | undefined) {
  const normalized = value?.trim().replace(/^v/i, "");
  return normalized || null;
}

function findCommunityRelease(snapshot: OpenClawStabilitySnapshot | null, version: string | null) {
  if (!snapshot || !version) return null;
  return snapshot.releases.find((release) => normalizeVersion(release.version) === version) ?? null;
}

function formatTimestamp(value: string) {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? "Unknown" : new Date(timestamp).toLocaleString();
}

function formatTimestampMs(value: number | null) {
  return value === null ? "Unknown" : formatTimestamp(new Date(value).toISOString());
}
