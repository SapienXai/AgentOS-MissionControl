"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  KeyRound,
  ListChecks,
  LoaderCircle,
  Microscope,
  OctagonAlert,
  RefreshCw,
  TerminalSquare,
  TriangleAlert
} from "lucide-react";
import { useMemo } from "react";

import type { TransportStatusTone } from "@/components/mission-control/settings-control-center.utils";
import { Button } from "@/components/ui/button";
import type { AgentOsSurfaceTheme } from "@/components/ui/design-system";
import type {
  OpenClawGatewayGoldenPathStep,
  OpenClawGatewayProductSurface,
  OpenClawGatewayProductSurfaceAction,
  OpenClawGatewayProductSurfaceInboxItem,
  OpenClawGatewayProductSurfaceProbe,
  OpenClawGatewayProductSurfaceSnapshot,
  OpenClawGatewayProductSurfaceStatus
} from "@/lib/openclaw/application/gateway-surface-types";
import { OPENCLAW_NATIVE_CONTRACT_VERSION } from "@/lib/openclaw/versions";
import { cn } from "@/lib/utils";

export type GatewaySurfaceTheme = AgentOsSurfaceTheme;

export function GatewayProductSurfacePanel({
  snapshot,
  error,
  loading,
  surfaceTheme,
  onRefresh
}: {
  snapshot: OpenClawGatewayProductSurfaceSnapshot | null;
  error: string | null;
  loading: boolean;
  surfaceTheme: GatewaySurfaceTheme;
  onRefresh: () => void;
}) {
  const surfaces = useMemo(() => snapshot?.surfaces ?? [], [snapshot?.surfaces]);
  const inboxItems = useMemo(() => snapshot?.inboxItems ?? [], [snapshot?.inboxItems]);
  const groupedSurfaces = useMemo(
    () => Array.from(new Set(surfaces.map((surface) => surface.category))).map((category) => ({
      category,
      surfaces: surfaces.filter((surface) => surface.category === category)
    })),
    [surfaces]
  );
  const counts = useMemo(
    () => ({
      native: surfaces.filter((surface) => surface.status === "native").length,
      degraded: surfaces.filter((surface) => surface.status === "degraded" || surface.status === "scope-required").length,
      upstream: surfaces.filter((surface) => surface.status === "upstream-needed" || surface.status === "unsupported").length,
      recoveryCli: surfaces.filter((surface) => surface.status === "recovery-cli").length
    }),
    [surfaces]
  );

  return (
    <div className={cn("rounded-[18px] border p-3.5", gatewayInsetPanelClassName(surfaceTheme))}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className={gatewayLabelClassName(surfaceTheme)}>Gateway-native product surface map</p>
          <h3 className={cn("mt-1 text-sm font-semibold", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}>
            OpenClaw {OPENCLAW_NATIVE_CONTRACT_VERSION} capabilities and product surfaces
          </h3>
          <p className={cn("mt-1 max-w-3xl text-xs leading-5", gatewayMutedTextClassName(surfaceTheme))}>
            This panel uses the live compatibility report and read-only native Gateway probes. Failed probes stay degraded and do not fall back to CLI.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={onRefresh}
          disabled={loading}
          className={cn(gatewaySecondaryButtonClassName(surfaceTheme, "h-8 px-3 text-xs", "gateway-contrast"), "shrink-0")}
        >
          {loading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh surfaces
        </Button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <GatewaySurfaceMetric
          label="Runtime"
          value={snapshot ? snapshot.isRealRuntime ? "Real Gateway" : "Simulated" : "Loading"}
          detail={snapshot ? `${snapshot.capabilitySource} / ${formatGatewaySurfaceTimestamp(snapshot.generatedAt)}` : "Waiting for surface snapshot"}
          surfaceTheme={surfaceTheme}
          tone={snapshot?.isRealRuntime ? "success" : "warning"}
        />
        <GatewaySurfaceMetric
          label="Native coverage"
          value={snapshot ? `${snapshot.nativeCoveragePercent}%` : "Unknown"}
          detail={snapshot?.nativeCoverageLabel ?? "Compatibility report not loaded"}
          surfaceTheme={surfaceTheme}
          tone={snapshot && snapshot.nativeCoveragePercent >= 80 ? "success" : "warning"}
        />
        <GatewaySurfaceMetric
          label="Native surfaces"
          value={String(counts.native)}
          detail={`${counts.degraded} degraded/scope-gated, ${counts.upstream} upstream`}
          surfaceTheme={surfaceTheme}
          tone={counts.degraded === 0 && counts.upstream === 0 ? "success" : "warning"}
        />
        <GatewaySurfaceMetric
          label="Runtime inbox"
          value={String(inboxItems.length)}
          detail={`${snapshot?.actionableItemCount ?? 0} actionable item${(snapshot?.actionableItemCount ?? 0) === 1 ? "" : "s"}`}
          surfaceTheme={surfaceTheme}
          tone={(snapshot?.actionableItemCount ?? 0) > 0 ? "warning" : "success"}
        />
        <GatewaySurfaceMetric
          label="Recovery CLI"
          value={String(counts.recoveryCli)}
          detail={`${snapshot?.fallbackActiveCount ?? 0} active fallback diagnostics`}
          surfaceTheme={surfaceTheme}
          tone={counts.recoveryCli > 0 || (snapshot?.cliForced ?? false) ? "warning" : "success"}
        />
      </div>

      {error ? (
        <div className={cn("mt-3 rounded-[14px] border p-3 text-xs leading-5", surfaceTheme === "light" ? "border-red-200 bg-red-50 text-red-800" : "border-rose-300/20 bg-rose-300/10 text-rose-100")}>
          {error}
        </div>
      ) : null}

      {!snapshot && !error ? (
        <div className={cn("mt-3 rounded-[14px] border p-3 text-xs", surfaceTheme === "light" ? "border-border bg-muted/50 text-muted-foreground" : "border-white/[0.08] bg-[#0d1624]/70 text-slate-400")}>
          {loading ? "Loading Gateway-native surface state..." : "Gateway-native surface state has not been loaded yet."}
        </div>
      ) : null}

      {snapshot && !snapshot.isRealRuntime ? (
        <div className={cn("mt-3 rounded-[14px] border p-3 text-xs leading-5", surfaceTheme === "light" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-amber-300/20 bg-amber-300/[0.08] text-amber-100")}>
          Compatibility is not certified against a real live Gateway runtime. Treat supported surfaces as degraded until live capability metadata is advertised.
        </div>
      ) : null}

      {snapshot ? (
        <>
          <GatewayGoldenPathPanel
            steps={snapshot.goldenPathSteps}
            surfaceTheme={surfaceTheme}
          />
          <GatewaySurfaceInboxPanel
            items={inboxItems}
            surfaceTheme={surfaceTheme}
            onRefresh={onRefresh}
            loading={loading}
          />
        </>
      ) : null}

      {groupedSurfaces.length > 0 ? (
        <div className="mt-4 space-y-4">
          {groupedSurfaces.map((group) => (
            <section key={group.category}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className={cn("text-[0.62rem] font-bold uppercase tracking-[0.16em]", gatewayMutedTextClassName(surfaceTheme))}>
                  {group.category}
                </p>
                <span className={cn("text-[0.62rem]", gatewayMutedTextClassName(surfaceTheme))}>
                  {group.surfaces.length} surface{group.surfaces.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="grid gap-2 lg:grid-cols-2">
                {group.surfaces.map((surface) => (
                  <GatewayProductSurfaceCard
                    key={surface.id}
                    surface={surface}
                    surfaceTheme={surfaceTheme}
                    onRefresh={onRefresh}
                    loading={loading}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function GatewayGoldenPathPanel({
  steps,
  surfaceTheme
}: {
  steps: OpenClawGatewayGoldenPathStep[];
  surfaceTheme: GatewaySurfaceTheme;
}) {
  return (
    <div className={cn("mt-3 rounded-[14px] border p-3", gatewayInsetPanelClassName(surfaceTheme))}>
      <div className="flex flex-col gap-1">
        <p className={gatewayLabelClassName(surfaceTheme)}>Golden path reliability</p>
        <p className={cn("text-xs leading-5", gatewayMutedTextClassName(surfaceTheme))}>
          Readiness for workspace create, agent create, dispatch, streaming, and transcript visibility derived from mapped Gateway surfaces.
        </p>
      </div>

      <div className="mt-3 grid gap-2 lg:grid-cols-5">
        {steps.map((step) => (
          <div key={step.id} className={cn("rounded-[12px] border p-2.5 text-xs", gatewayInsetPanelClassName(surfaceTheme))}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={gatewayTransportTonePillClassName(gatewayGoldenPathTone(step.status), surfaceTheme)}>
                {step.statusLabel}
              </span>
              <span className={cn("font-medium", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}>
                {step.label}
              </span>
            </div>
            <p className={cn("mt-1.5 line-clamp-3 leading-5", gatewayMutedTextClassName(surfaceTheme))}>
              {step.reason}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Button
                type="button"
                variant="secondary"
                asChild
                className={gatewaySecondaryButtonClassName(surfaceTheme, "h-7 px-2 text-[11px]", "gateway-contrast")}
              >
                <Link href={step.actionHref}>
                  <ChevronRight className="h-3.5 w-3.5" />
                  {step.actionLabel}
                </Link>
              </Button>
              {step.recoveryHref !== step.actionHref ? (
                <Button
                  type="button"
                  variant="secondary"
                  asChild
                  className={gatewaySecondaryButtonClassName(surfaceTheme, "h-7 px-2 text-[11px]", "gateway-contrast")}
                >
                  <Link href={step.recoveryHref}>
                    <TerminalSquare className="h-3.5 w-3.5" />
                    Recovery
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function GatewaySurfaceInboxPanel({
  items,
  surfaceTheme,
  onRefresh,
  loading
}: {
  items: OpenClawGatewayProductSurfaceInboxItem[];
  surfaceTheme: GatewaySurfaceTheme;
  onRefresh: () => void;
  loading: boolean;
}) {
  const visibleItems = items.slice(0, 5);

  return (
    <div className={cn("mt-3 rounded-[14px] border p-3", gatewayInsetPanelClassName(surfaceTheme))}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className={gatewayLabelClassName(surfaceTheme)}>Gateway runtime inbox</p>
          <p className={cn("mt-1 text-xs leading-5", gatewayMutedTextClassName(surfaceTheme))}>
            Surface readiness issues generated from live compatibility state and native read probes.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={onRefresh}
          disabled={loading}
          className={cn(gatewaySecondaryButtonClassName(surfaceTheme, "h-8 px-3 text-xs", "gateway-contrast"), "shrink-0")}
        >
          {loading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh inbox
        </Button>
      </div>

      {visibleItems.length > 0 ? (
        <div className="mt-3 grid gap-2">
          {visibleItems.map((item) => (
            <GatewaySurfaceInboxItemCard
              key={item.id}
              item={item}
              surfaceTheme={surfaceTheme}
            />
          ))}
          {items.length > visibleItems.length ? (
            <p className={cn("text-[11px]", gatewayMutedTextClassName(surfaceTheme))}>
              {items.length - visibleItems.length} additional Gateway surface item{items.length - visibleItems.length === 1 ? "" : "s"} are visible in the expanded surface list.
            </p>
          ) : null}
        </div>
      ) : (
        <div className={cn("mt-3 rounded-[12px] border p-2.5 text-xs", gatewayInsetPanelClassName(surfaceTheme))}>
          No Gateway surface inbox items. Current mapped product surfaces are native or informational.
        </div>
      )}
    </div>
  );
}

function GatewaySurfaceInboxItemCard({
  item,
  surfaceTheme
}: {
  item: OpenClawGatewayProductSurfaceInboxItem;
  surfaceTheme: GatewaySurfaceTheme;
}) {
  return (
    <div
      className={cn(
        "rounded-[12px] border p-2.5 text-xs leading-5",
        item.severity === "blocked"
          ? surfaceTheme === "light" ? "border-red-200 bg-red-50 text-red-900" : "border-rose-300/20 bg-rose-300/10 text-rose-100"
          : item.severity === "action_required"
            ? surfaceTheme === "light" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-amber-300/20 bg-amber-300/[0.08] text-amber-100"
            : gatewayInsetPanelClassName(surfaceTheme)
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={gatewayTransportTonePillClassName(gatewaySurfaceStatusTone(item.status), surfaceTheme)}>
          {item.severity.replace("_", " ")}
        </span>
        <span className={cn("font-medium", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}>
          {item.title}
        </span>
      </div>
      <p className="mt-1.5">{item.message}</p>
      <p className={cn("mt-1.5", gatewayMutedTextClassName(surfaceTheme))}>
        Recovery: {item.recovery}
      </p>
      {item.method ? (
        <code className={cn("mt-1.5 block break-words text-[11px]", gatewayMutedTextClassName(surfaceTheme))}>
          {item.method}
        </code>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button
          type="button"
          variant="secondary"
          asChild
          className={gatewaySecondaryButtonClassName(surfaceTheme, "h-7 px-2 text-[11px]", "gateway-contrast")}
        >
          <Link href={item.actionHref}>
            <ChevronRight className="h-3.5 w-3.5" />
            {item.actionLabel}
          </Link>
        </Button>
        <Button
          type="button"
          variant="secondary"
          asChild
          className={gatewaySecondaryButtonClassName(surfaceTheme, "h-7 px-2 text-[11px]", "gateway-contrast")}
        >
          <Link href={item.recoveryHref}>
            <TerminalSquare className="h-3.5 w-3.5" />
            Recovery
          </Link>
        </Button>
      </div>
    </div>
  );
}

function GatewayProductSurfaceCard({
  surface,
  surfaceTheme,
  onRefresh,
  loading
}: {
  surface: OpenClawGatewayProductSurface;
  surfaceTheme: GatewaySurfaceTheme;
  onRefresh: () => void;
  loading: boolean;
}) {
  const tone = gatewaySurfaceStatusTone(surface.status);
  const failedProbe = surface.probes.find((probe) => probe.status === "failed");
  const passedProbeCount = surface.probes.filter((probe) => probe.status === "passed").length;

  return (
    <details
      className={cn(
        "group rounded-[16px] border",
        surfaceTheme === "light"
          ? "border-border bg-card"
          : "border-white/[0.08] bg-[#101a2a]/86"
      )}
    >
      <summary className="grid cursor-pointer list-none gap-3 px-3 py-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)_auto] sm:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={gatewayTransportTonePillClassName(tone, surfaceTheme)}>{surface.statusLabel}</span>
            {surface.scopes.length > 0 ? (
              <span className={gatewayBaselinePillClassName("optional", surfaceTheme)}>
                {surface.scopes.length} scope{surface.scopes.length === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>
          <p className={cn("mt-2 truncate text-sm font-medium", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}>
            {surface.label}
          </p>
          <p className={cn("mt-1 truncate text-[11px]", gatewayMutedTextClassName(surfaceTheme))}>
            {surface.uiDestination}
          </p>
        </div>
        <div className="min-w-0">
          <p className={gatewayLabelClassName(surfaceTheme)}>Native probes</p>
          <p className={cn("mt-1 truncate text-xs", surfaceTheme === "light" ? "text-foreground" : "text-slate-200")}>
            {surface.probes.length > 0
              ? `${passedProbeCount}/${surface.probes.length} passed`
              : "No read probe"}
          </p>
          <p className={cn("mt-1 truncate text-[11px]", gatewayMutedTextClassName(surfaceTheme))}>
            {surface.methods.slice(0, 2).join(", ") || "No methods mapped"}
          </p>
          <p className={cn("mt-1 truncate text-[11px]", gatewayMutedTextClassName(surfaceTheme))}>
            Checked {formatGatewaySurfaceTimestamp(surface.lastCheckedAt)}
          </p>
        </div>
        <ChevronDown className={cn("h-4 w-4 transition-transform group-open:rotate-180", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")} />
      </summary>

      <div className={cn("border-t p-3", surfaceTheme === "light" ? "border-border" : "border-white/[0.08]")}>
        <div className="grid gap-2 sm:grid-cols-2">
          <GatewaySurfaceDetail label="Current AgentOS path" value={surface.currentAgentOsPath} surfaceTheme={surfaceTheme} />
          <GatewaySurfaceDetail label="Test target" value={surface.testTarget} surfaceTheme={surfaceTheme} />
          <GatewaySurfaceDetail label="Methods" value={formatGatewaySurfaceShortList(surface.methods, 6)} surfaceTheme={surfaceTheme} />
          <GatewaySurfaceDetail label="Events" value={surface.events.length ? formatGatewaySurfaceShortList(surface.events, 6) : "None"} surfaceTheme={surfaceTheme} />
          <GatewaySurfaceDetail label="Scopes" value={surface.scopes.length ? surface.scopes.join(", ") : "None"} surfaceTheme={surfaceTheme} />
          <GatewaySurfaceDetail label="Fallback operations" value={String(surface.cliFallbackOperationCount)} surfaceTheme={surfaceTheme} />
          <GatewaySurfaceDetail label="AgentOS routes" value={formatGatewaySurfaceShortList(surface.agentOsRoutes, 4)} surfaceTheme={surfaceTheme} />
          <GatewaySurfaceDetail label="AgentOS services" value={formatGatewaySurfaceShortList(surface.agentOsServices, 4)} surfaceTheme={surfaceTheme} />
          <GatewaySurfaceDetail label="AgentOS components" value={formatGatewaySurfaceShortList(surface.agentOsComponents, 4)} surfaceTheme={surfaceTheme} />
        </div>

        <div className="mt-3 space-y-2">
          <p className={cn("text-xs leading-5", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-300")}>
            Reason: {surface.reason}
          </p>
          <p className={cn("text-xs leading-5", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>
            Recovery: {surface.recovery}
          </p>
        </div>

        {surface.actions.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {surface.actions.slice(0, 9).map((action) => (
              <GatewaySurfaceActionButton
                key={action.id}
                action={action}
                surfaceTheme={surfaceTheme}
                onRefresh={onRefresh}
                loading={loading}
              />
            ))}
            {surface.actions.length > 9 ? (
              <span className={cn("inline-flex h-8 items-center text-[11px]", gatewayMutedTextClassName(surfaceTheme))}>
                +{surface.actions.length - 9} gated action{surface.actions.length - 9 === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>
        ) : null}

        {failedProbe ? (
          <div className={cn("mt-3 rounded-[12px] border p-2.5 text-xs leading-5", surfaceTheme === "light" ? "border-red-200 bg-red-50 text-red-800" : "border-rose-300/20 bg-rose-300/10 text-rose-100")}>
            {failedProbe.method}: {failedProbe.error}
          </div>
        ) : null}

        {surface.probes.length > 0 ? (
          <div className="mt-3 grid gap-2">
            {surface.probes.map((probe) => (
              <div key={probe.method} className={cn("rounded-[12px] border p-2.5 text-xs", gatewayInsetPanelClassName(surfaceTheme))}>
                <div className="flex items-center justify-between gap-2">
                  <code className={cn("truncate", surfaceTheme === "light" ? "text-foreground" : "text-slate-200")}>
                    {probe.method}
                  </code>
                  <span className={gatewayTransportTonePillClassName(gatewayProbeTone(probe.status), surfaceTheme)}>
                    {probe.status}
                  </span>
                </div>
                <p className={cn("mt-1.5 leading-5", gatewayMutedTextClassName(surfaceTheme))}>{probe.summary}</p>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </details>
  );
}

function GatewaySurfaceActionButton({
  action,
  surfaceTheme,
  onRefresh,
  loading
}: {
  action: OpenClawGatewayProductSurfaceAction;
  surfaceTheme: GatewaySurfaceTheme;
  onRefresh: () => void;
  loading: boolean;
}) {
  const isProbeAction = action.kind === "run-native-probe" || action.kind === "retry-native-probe";
  const disabled = !action.enabled || (isProbeAction && loading);
  const className = cn(
    gatewaySecondaryButtonClassName(surfaceTheme, "h-8 max-w-full px-2.5 text-[11px]", "gateway-contrast"),
    action.dangerous && (surfaceTheme === "light" ? "border-red-200 text-red-700" : "border-rose-300/20 text-rose-100")
  );
  const content = (
    <>
      {isProbeAction && loading ? (
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <GatewaySurfaceActionIcon kind={action.kind} className="h-3.5 w-3.5 shrink-0" />
      )}
      <span className="min-w-0 truncate">{action.label}</span>
    </>
  );
  const title = `${action.reason}${action.recovery ? ` Recovery: ${action.recovery}` : ""}`;

  if (isProbeAction) {
    return (
      <Button
        type="button"
        variant="secondary"
        onClick={onRefresh}
        disabled={disabled}
        title={title}
        className={className}
      >
        {content}
      </Button>
    );
  }

  if (action.href && action.enabled) {
    return (
      <Button
        type="button"
        variant="secondary"
        asChild
        title={title}
        className={className}
      >
        <Link href={action.href}>
          {content}
        </Link>
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="secondary"
      disabled
      title={title}
      className={className}
    >
      {content}
    </Button>
  );
}

function GatewaySurfaceActionIcon({
  kind,
  className
}: {
  kind: OpenClawGatewayProductSurfaceAction["kind"];
  className?: string;
}) {
  switch (kind) {
    case "open-product-page":
      return <ChevronRight className={className} />;
    case "run-native-probe":
    case "retry-native-probe":
      return <RefreshCw className={className} />;
    case "view-runtime-inbox":
      return <ListChecks className={className} />;
    case "show-scope":
      return <KeyRound className={className} />;
    case "show-degraded":
      return <TriangleAlert className={className} />;
    case "show-upstream":
      return <AlertTriangle className={className} />;
    case "open-recovery":
      return <TerminalSquare className={className} />;
    case "native-read":
      return <Microscope className={className} />;
    case "native-mutation":
      return <OctagonAlert className={className} />;
  }
}

function GatewaySurfaceMetric({
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
  surfaceTheme: GatewaySurfaceTheme;
}) {
  return (
    <div className={cn("rounded-[14px] border p-3", gatewayInsetPanelClassName(surfaceTheme))}>
      <div className="flex items-center justify-between gap-2">
        <p className={gatewayLabelClassName(surfaceTheme)}>{label}</p>
        <span className={gatewayTransportTonePillClassName(tone, surfaceTheme)}>{tone}</span>
      </div>
      <p className={cn("mt-2 truncate text-sm font-semibold", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}>
        {value}
      </p>
      <p className={cn("mt-1 truncate text-[11px]", gatewayMutedTextClassName(surfaceTheme))}>{detail}</p>
    </div>
  );
}

function GatewaySurfaceDetail({
  label,
  value,
  surfaceTheme
}: {
  label: string;
  value: string;
  surfaceTheme: GatewaySurfaceTheme;
}) {
  return (
    <div className={cn("rounded-[16px] border p-3", gatewayInsetPanelClassName(surfaceTheme))}>
      <p className={gatewayLabelClassName(surfaceTheme)}>{label}</p>
      <p className={cn("mt-1.5 break-words text-xs leading-5", surfaceTheme === "light" ? "text-foreground" : "text-slate-200")}>
        {value}
      </p>
    </div>
  );
}

function gatewaySurfaceStatusTone(status: OpenClawGatewayProductSurfaceStatus): TransportStatusTone {
  switch (status) {
    case "native":
      return "success";
    case "scope-required":
    case "degraded":
    case "recovery-cli":
      return "warning";
    case "unsupported":
    case "upstream-needed":
      return "danger";
    case "unknown":
      return "neutral";
  }
}

function gatewayProbeTone(status: OpenClawGatewayProductSurfaceProbe["status"]): TransportStatusTone {
  switch (status) {
    case "passed":
      return "success";
    case "failed":
      return "danger";
    case "skipped":
      return "warning";
  }
}

function gatewayGoldenPathTone(status: OpenClawGatewayGoldenPathStep["status"]): TransportStatusTone {
  switch (status) {
    case "ready":
      return "success";
    case "degraded":
      return "warning";
    case "blocked":
      return "danger";
    case "unknown":
      return "neutral";
  }
}

function gatewayTransportTonePillClassName(tone: TransportStatusTone, surfaceTheme: GatewaySurfaceTheme) {
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

function gatewayBaselinePillClassName(
  baseline: "required" | "optional" | "experimental" | "unknown",
  surfaceTheme: GatewaySurfaceTheme
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

function gatewayLabelClassName(surfaceTheme: GatewaySurfaceTheme) {
  return cn("text-[10px] uppercase tracking-[0.18em]", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400");
}

function gatewaySecondaryButtonClassName(surfaceTheme: GatewaySurfaceTheme, extraClassName?: string, mode?: "default" | "gateway-contrast") {
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

function gatewayInsetPanelClassName(surfaceTheme: GatewaySurfaceTheme) {
  return surfaceTheme === "light"
    ? "border-border bg-muted/45"
    : "border-border bg-[#101a2a]/92";
}

function gatewayMutedTextClassName(surfaceTheme: GatewaySurfaceTheme) {
  return surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400";
}

function formatGatewaySurfaceShortList(values: string[], maxVisible: number) {
  const unique = Array.from(new Set(values));
  const visible = unique.slice(0, maxVisible);
  const suffix = unique.length > visible.length ? ` +${unique.length - visible.length}` : "";

  return `${visible.join(", ")}${suffix}`;
}

function formatGatewaySurfaceTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}
