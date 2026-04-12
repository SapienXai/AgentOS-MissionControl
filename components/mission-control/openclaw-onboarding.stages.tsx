"use client";

import { ArrowRight, Check, Copy, LoaderCircle, Plus, RefreshCw, SquareTerminal } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import type { DiscoveredModelCandidate, MissionControlSnapshot } from "@/lib/agentos/contracts";
import {
  ghostActionClassName,
  formatProviderLabel,
  secondaryActionClassName,
  stepBadgeClassName,
  stepContainerClassName,
  stepIconClassName,
  type StageRunDetails,
  type SurfaceTheme,
  type StepState,
  resolveSelectedModelLabel
} from "@/components/mission-control/openclaw-onboarding.utils";
import { cn } from "@/lib/utils";

export function SystemStage({
  steps,
  surfaceTheme,
  statusCopy,
  showDetails,
  phaseLabel,
  run
}: {
  steps: Array<{ id: string; label: string; description: string; state: StepState }>;
  surfaceTheme: SurfaceTheme;
  statusCopy: string;
  showDetails: boolean;
  phaseLabel: string;
  run: StageRunDetails;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <>
      <div className="mt-3">
        <p
          className={cn(
            "text-[7px] uppercase tracking-[0.18em]",
            surfaceTheme === "light" ? "text-[#977b69]" : "text-slate-500"
          )}
        >
          Step 1
        </p>
        <h2 className={cn("mt-1 text-[13px] font-medium", surfaceTheme === "light" ? "text-[#33251c]" : "text-white")}>
          System setup
        </h2>
        <p
          className={cn(
            "mt-1 text-[10px] leading-[0.95rem]",
            surfaceTheme === "light" ? "text-[#705b4d]" : "text-slate-400"
          )}
        >
          Install the CLI, start the gateway, and verify RPC.
        </p>
      </div>

      <div className="mt-2.5 space-y-1.5">
        {steps.map((step, index) => (
          <div
            key={step.id}
            className={cn(
              "flex items-center gap-1.5 rounded-[12px] border px-2 py-1.5",
              stepContainerClassName(step.state, surfaceTheme)
            )}
          >
            <span
              className={cn(
                "mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full border text-[9px] font-medium",
                stepIconClassName(step.state, surfaceTheme)
              )}
            >
              {step.state === "complete" ? <Check className="h-2.5 w-2.5" /> : index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-1.5">
                <p className={cn("text-[11px]", surfaceTheme === "light" ? "text-[#3e2f24]" : "text-white")}>
                  {step.label}
                </p>
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[6px] uppercase tracking-[0.14em]",
                    stepBadgeClassName(step.state, surfaceTheme)
                  )}
                >
                  {step.state === "complete"
                    ? "Ready"
                    : step.state === "current"
                      ? "Active"
                      : "Pending"}
                </span>
              </div>
              <p
                className={cn(
                  "mt-0.5 text-[8px] leading-[0.82rem]",
                  surfaceTheme === "light" ? "text-[#8f7664]" : "text-slate-500"
                )}
              >
                {step.description}
              </p>
            </div>
          </div>
        ))}
      </div>

      <StageConsole
        surfaceTheme={surfaceTheme}
        statusCopy={statusCopy}
        showDetails={showDetails}
        phaseLabel={phaseLabel}
        detailsOpen={detailsOpen}
        onDetailsOpenChange={setDetailsOpen}
        run={run}
      />
    </>
  );
}

export function ModelStage({
  snapshot,
  surfaceTheme,
  statusCopy,
  showDetails,
  phaseLabel,
  run,
  selectedModelId,
  availableModels,
  discoveredModels,
  onSelectedModelIdChange,
  onRunModelDiscover,
  onRunModelRefresh,
  onRunModelSetDefault,
  onOpenAddModels
}: {
  snapshot: MissionControlSnapshot;
  surfaceTheme: SurfaceTheme;
  statusCopy: string;
  showDetails: boolean;
  phaseLabel: string;
  run: StageRunDetails;
  selectedModelId: string;
  availableModels: Array<{ id: string; name: string; provider: string }>;
  discoveredModels: DiscoveredModelCandidate[];
  onSelectedModelIdChange: (value: string) => void;
  onRunModelDiscover: () => void;
  onRunModelRefresh: () => void;
  onRunModelSetDefault: (modelId?: string) => void;
  onOpenAddModels: () => void;
}) {
  const modelReadiness = snapshot.diagnostics.modelReadiness;
  const [detailsOpen, setDetailsOpen] = useState(() => discoveredModels.length > 0);
  const connectedProviders = modelReadiness.authProviders.filter((provider) => provider.connected);
  const selectedModelLabel = resolveSelectedModelLabel(selectedModelId, availableModels);
  const defaultModelLabel = modelReadiness.resolvedDefaultModel || modelReadiness.defaultModel || "Not set";
  const summaryLead = selectedModelId ? `Selected: ${selectedModelLabel ?? defaultModelLabel}` : `Default: ${defaultModelLabel}`;
  const summaryCopy = `${summaryLead} · ${modelReadiness.availableModelCount}/${modelReadiness.totalModelCount} routes · ${connectedProviders.length} connected`;
  const hasAdvancedDetails =
    modelReadiness.issues.length > 0 || connectedProviders.length > 0 || discoveredModels.length > 0;
  const handleRunModelDiscover = () => {
    setDetailsOpen(true);
    onRunModelDiscover();
  };

  return (
    <>
      <div className="mt-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p
              className={cn(
                "text-[7px] uppercase tracking-[0.18em]",
                surfaceTheme === "light" ? "text-[#977b69]" : "text-slate-500"
              )}
            >
              Step 2
            </p>
            <h2 className={cn("mt-1 text-[13px] font-medium", surfaceTheme === "light" ? "text-[#33251c]" : "text-white")}>
              Model setup
            </h2>
          </div>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onRunModelRefresh}
            disabled={run.runState === "running"}
            className={secondaryActionClassName(surfaceTheme)}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>

        <p
          className={cn(
            "mt-1 text-[10px] leading-[0.95rem]",
            surfaceTheme === "light" ? "text-[#705b4d]" : "text-slate-400"
          )}
        >
          Pick the default model.
        </p>
      </div>

      <div
        className={cn(
          "mt-2.5 rounded-[12px] border px-2.5 py-2.5",
          surfaceTheme === "light"
            ? "border-[#e5d5c9] bg-[#fffaf6]"
            : "border-white/8 bg-[rgba(255,255,255,0.02)]"
        )}
      >
        <label className="block">
          <span
            className={cn(
              "text-[7px] uppercase tracking-[0.16em]",
              surfaceTheme === "light" ? "text-[#977b69]" : "text-slate-500"
            )}
          >
            Default model
          </span>
          <select
            value={selectedModelId}
            onChange={(event) => onSelectedModelIdChange(event.target.value)}
            className={cn(
              "mt-1.5 h-9 w-full rounded-[12px] border px-2.5 text-[11px] outline-none",
              surfaceTheme === "light"
                ? "border-[#dccabd] bg-white text-[#33251c]"
                : "border-white/10 bg-white/[0.04] text-slate-100"
            )}
          >
            <option value="">Auto choose</option>
            {availableModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name} · {model.provider}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onOpenAddModels}
            className={secondaryActionClassName(surfaceTheme)}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add models
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleRunModelDiscover}
            disabled={run.runState === "running"}
            className={secondaryActionClassName(surfaceTheme)}
          >
            {discoveredModels.length > 0 ? "Scan again" : "Discover models"}
          </Button>
          {hasAdvancedDetails ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDetailsOpen((current) => !current)}
              aria-expanded={detailsOpen}
              className={ghostActionClassName(surfaceTheme)}
            >
              {detailsOpen ? "Hide details" : "Show details"}
            </Button>
          ) : null}
        </div>

        <p
          className={cn(
            "mt-2 text-[9px] leading-[0.95rem]",
            surfaceTheme === "light" ? "text-[#705b4d]" : "text-slate-500"
          )}
        >
          {summaryCopy}
        </p>

        {detailsOpen ? (
          <div className="mt-2.5 space-y-2">
            {modelReadiness.issues.length > 0 ? (
              <div className="space-y-1">
                {modelReadiness.issues.map((issue) => (
                  <p
                    key={issue}
                    className={cn(
                      "rounded-[10px] border px-2 py-1.5 text-[9px] leading-[0.85rem]",
                      surfaceTheme === "light"
                        ? "border-amber-200 bg-amber-50 text-amber-800"
                        : "border-amber-300/20 bg-amber-300/10 text-amber-100"
                    )}
                  >
                    {issue}
                  </p>
                ))}
              </div>
            ) : null}

            {connectedProviders.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {connectedProviders.map((provider) => (
                  <span
                    key={provider.provider}
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[9px]",
                      surfaceTheme === "light"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-emerald-300/20 bg-emerald-300/10 text-emerald-200"
                    )}
                  >
                    {formatProviderLabel(provider.provider)}
                    {provider.detail ? ` · ${provider.detail}` : ""}
                  </span>
                ))}
              </div>
            ) : null}

            {discoveredModels.length > 0 ? (
              <div className="space-y-1.5">
                <p
                  className={cn(
                    "text-[7px] uppercase tracking-[0.16em]",
                    surfaceTheme === "light" ? "text-[#977b69]" : "text-slate-500"
                  )}
                >
                  Routes
                </p>
                <div className="space-y-1.5">
                  {discoveredModels.slice(0, 3).map((model) => (
                    <div
                      key={model.modelId}
                      className={cn(
                        "flex items-center justify-between gap-2 rounded-[12px] border px-2 py-1.5",
                        surfaceTheme === "light"
                          ? "border-[#eadcd0] bg-[#fff7f2]"
                          : "border-white/10 bg-white/[0.03]"
                      )}
                    >
                      <div className="min-w-0">
                        <p
                          className={cn(
                            "truncate text-[10px]",
                            surfaceTheme === "light" ? "text-[#3e2f24]" : "text-white"
                          )}
                        >
                          {model.name}
                        </p>
                        <p
                          className={cn(
                            "mt-0.5 text-[8px] leading-[0.85rem]",
                            surfaceTheme === "light" ? "text-[#8f7664]" : "text-slate-500"
                          )}
                        >
                          {formatProviderLabel(model.provider)}
                          {model.isFree ? " · free" : ""}
                          {model.supportsTools ? " · tools" : ""}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => onRunModelSetDefault(model.modelId)}
                        disabled={run.runState === "running"}
                        className={secondaryActionClassName(surfaceTheme)}
                      >
                        Use
                      </Button>
                    </div>
                  ))}
                </div>
                <p
                  className={cn(
                    "text-[9px] leading-[0.95rem]",
                    surfaceTheme === "light" ? "text-[#705b4d]" : "text-slate-500"
                  )}
                >
                  Configured routes only. Missing credentials will hand you off to OpenClaw.
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <StageConsole
        surfaceTheme={surfaceTheme}
        statusCopy={statusCopy}
        showDetails={showDetails}
        phaseLabel={phaseLabel}
        detailsOpen={detailsOpen}
        onDetailsOpenChange={setDetailsOpen}
        run={run}
      />
    </>
  );
}

export function LaunchpadStage({
  surfaceTheme,
  workspaceCount,
  defaultModelLabel
}: {
  surfaceTheme: SurfaceTheme;
  workspaceCount: number;
  defaultModelLabel: string;
}) {
  const hasWorkspaces = workspaceCount > 0;
  const launchSummary = hasWorkspaces
    ? `You already have ${workspaceCount} workspace${workspaceCount === 1 ? "" : "s"} online. Use AgentOS to inspect them or create another workspace for a new mission.`
    : "No workspace exists yet. Create one first so the live system has a place to keep context and deliverables.";

  return (
    <>
      <div
        className={cn(
          "mt-3 rounded-[16px] border px-3 py-3",
          surfaceTheme === "light"
            ? "border-emerald-200/80 bg-[linear-gradient(180deg,rgba(240,250,245,0.95),rgba(248,244,236,0.95))]"
            : "border-emerald-300/15 bg-[linear-gradient(180deg,rgba(9,18,19,0.96),rgba(7,11,18,0.94))]"
        )}
      >
        <div className="flex items-start gap-2.5">
          <span
            className={cn(
              "mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border",
              surfaceTheme === "light"
                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                : "border-emerald-300/20 bg-emerald-300/10 text-emerald-200"
            )}
          >
            <Check className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <p
              className={cn(
                "text-[7px] uppercase tracking-[0.18em]",
                surfaceTheme === "light" ? "text-emerald-700/75" : "text-emerald-200/75"
              )}
            >
              Launchpad
            </p>
            <h2
              className={cn(
                "mt-1 text-[13px] font-medium",
                surfaceTheme === "light" ? "text-[#2d2118]" : "text-white"
              )}
            >
              OpenClaw is ready.
            </h2>
            <p
              className={cn(
                "mt-1 text-[10px] leading-[0.95rem]",
                surfaceTheme === "light" ? "text-[#5f4b3e]" : "text-slate-300"
              )}
            >
              {launchSummary}
            </p>
          </div>
        </div>

        <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
          <LaunchpadMetric
            surfaceTheme={surfaceTheme}
            label="System"
            value="Online"
            detail="CLI, gateway, and runtime access verified"
          />
          <LaunchpadMetric
            surfaceTheme={surfaceTheme}
            label="Default model"
            value={defaultModelLabel}
            detail="Usable model route selected"
          />
          <LaunchpadMetric
            surfaceTheme={surfaceTheme}
            label="Runtime"
            value="Smoke test passed"
            detail="A live agent turn was verified"
          />
          <LaunchpadMetric
            surfaceTheme={surfaceTheme}
            label="Workspaces"
            value={String(workspaceCount)}
            detail={hasWorkspaces ? "Ready for mission planning" : "Create one to begin"}
          />
        </div>
      </div>

      <div
        className={cn(
          "mt-2.5 rounded-[12px] border px-2.5 py-2",
          surfaceTheme === "light" ? "border-[#e5d5c9] bg-[#fffaf6]" : "border-white/8 bg-[rgba(255,255,255,0.02)]"
        )}
      >
        <p
          className={cn(
            "text-[7px] uppercase tracking-[0.16em]",
            surfaceTheme === "light" ? "text-[#977b69]" : "text-slate-500"
          )}
        >
          Next step
        </p>
        <p
          className={cn(
            "mt-1 text-[11px] leading-[1rem]",
            surfaceTheme === "light" ? "text-[#5f4b3e]" : "text-slate-300"
          )}
        >
          {hasWorkspaces
            ? "Open AgentOS to inspect the live graph, or create another workspace if you want a separate mission lane."
            : "Create the first workspace now. That is the shortest path from a ready system to a real mission."}
        </p>
      </div>
    </>
  );
}

export function LaunchpadMetric({
  surfaceTheme,
  label,
  value,
  detail
}: {
  surfaceTheme: SurfaceTheme;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[12px] border px-2.5 py-2",
        surfaceTheme === "light" ? "border-[#e6d7cb] bg-white" : "border-white/10 bg-white/[0.03]"
      )}
    >
      <p
        className={cn(
          "text-[7px] uppercase tracking-[0.16em]",
          surfaceTheme === "light" ? "text-[#977b69]" : "text-slate-500"
        )}
      >
        {label}
      </p>
      <p
        title={value}
        className={cn(
          "mt-1 truncate text-[10px]",
          surfaceTheme === "light" ? "text-[#33251c]" : "text-white"
        )}
      >
        {value}
      </p>
      <p
        className={cn(
          "mt-0.5 text-[8px] leading-[0.85rem]",
          surfaceTheme === "light" ? "text-[#8f7664]" : "text-slate-500"
        )}
      >
        {detail}
      </p>
    </div>
  );
}

function StageConsole({
  surfaceTheme,
  statusCopy,
  showDetails,
  phaseLabel,
  detailsOpen,
  onDetailsOpenChange,
  run
}: {
  surfaceTheme: SurfaceTheme;
  statusCopy: string;
  showDetails: boolean;
  phaseLabel: string;
  detailsOpen: boolean;
  onDetailsOpenChange: (value: boolean) => void;
  run: StageRunDetails;
}) {
  const [isOpeningTerminal, setIsOpeningTerminal] = useState(false);
  const canOpenTerminal = Boolean(run.manualCommand?.trim().startsWith("openclaw "));

  const copyCommand = async () => {
    if (!run.manualCommand) {
      return;
    }

    try {
      await navigator.clipboard.writeText(run.manualCommand);
      toast.success("Command copied.", {
        description: "Open Terminal and paste it."
      });
    } catch (error) {
      toast.error("Could not copy command.", {
        description: error instanceof Error ? error.message : "Clipboard access is unavailable."
      });
    }
  };

  const openTerminal = async () => {
    if (!run.manualCommand || !canOpenTerminal) {
      return;
    }

    setIsOpeningTerminal(true);

    try {
      const response = await fetch("/api/system/open-terminal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          command: run.manualCommand
        })
      });

      const result = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok || result?.error) {
        throw new Error(result?.error || "Unable to open Terminal.");
      }

      toast.success("Terminal opened.", {
        description: "Finish auth there, then refresh."
      });
    } catch (error) {
      toast.error("Could not open Terminal.", {
        description: error instanceof Error ? error.message : "Open Terminal manually and run the command."
      });
    } finally {
      setIsOpeningTerminal(false);
    }
  };

  return (
    <div
      className={cn(
        "mt-2.5 rounded-[12px] border",
        surfaceTheme === "light"
          ? "border-[#e5d5c9] bg-[#fffaf6]"
          : "border-white/8 bg-[rgba(255,255,255,0.02)]"
      )}
    >
      <div className="px-2.5 py-2">
        <div className="flex items-center justify-between gap-2">
          <p
            className={cn(
              "text-[7px] uppercase tracking-[0.16em]",
              surfaceTheme === "light" ? "text-[#977b69]" : "text-slate-500"
            )}
          >
            Status
          </p>
          {showDetails ? (
            <button
              type="button"
              onClick={() => onDetailsOpenChange(!detailsOpen)}
              className={cn(
                "text-[8px] uppercase tracking-[0.16em] transition-colors",
                surfaceTheme === "light" ? "text-[#8f7664] hover:text-[#6f5949]" : "text-slate-500 hover:text-slate-300"
              )}
            >
              {detailsOpen ? "Hide details" : "Show details"}
            </button>
          ) : null}
        </div>
        <p
          className={cn(
            "mt-1 text-[11px] leading-[1rem]",
            surfaceTheme === "light" ? "text-[#5f4b3e]" : "text-slate-300"
          )}
        >
          {statusCopy}
        </p>
      </div>

      {showDetails && detailsOpen ? (
        <>
          <div
            className={cn(
              "flex items-center justify-between border-y px-2.5 py-1.5",
              surfaceTheme === "light" ? "border-[#ebddd2]" : "border-white/8"
            )}
          >
            <p
              className={cn(
                "text-[8px] uppercase tracking-[0.16em]",
                surfaceTheme === "light" ? "text-[#977b69]" : "text-slate-500"
              )}
            >
              Log
            </p>
            <span className={surfaceTheme === "light" ? "text-[10px] text-[#8c7362]" : "text-[10px] text-slate-400"}>
              {phaseLabel}
            </span>
          </div>
          <pre
            className={cn(
              "max-h-[120px] min-h-[68px] overflow-auto whitespace-pre-wrap break-words px-2.5 py-2 font-mono text-[8px] leading-[0.82rem]",
              surfaceTheme === "light" ? "text-[#4f3d31]" : "text-slate-200"
            )}
          >
            {run.log || "No output yet.\n\nStart the step to stream logs."}
          </pre>
          {run.manualCommand ? (
            <div
              className={cn(
                "border-t px-2.5 py-2",
                surfaceTheme === "light" ? "border-[#ebddd2]" : "border-white/8"
              )}
            >
              <p
                className={cn(
                  "text-[8px] uppercase tracking-[0.16em]",
                  surfaceTheme === "light" ? "text-[#977b69]" : "text-slate-500"
                )}
              >
                {canOpenTerminal ? "Terminal" : "Manual"}
              </p>
              {canOpenTerminal ? (
                <p
                  className={cn(
                    "mt-1 text-[9px] leading-[0.95rem]",
                    surfaceTheme === "light" ? "text-[#705b4d]" : "text-slate-400"
                  )}
                >
                  Open Terminal and run this command.
                </p>
              ) : null}
              <p
                className={cn(
                  "mt-1 break-all font-mono text-[9px] leading-[0.92rem]",
                  surfaceTheme === "light" ? "text-[#4f3d31]" : "text-slate-200"
                )}
              >
                {run.manualCommand}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={copyCommand}
                  className={secondaryActionClassName(surfaceTheme)}
                >
                  <Copy className="mr-1.5 h-3 w-3" />
                  Copy command
                </Button>
                {canOpenTerminal ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={openTerminal}
                    disabled={isOpeningTerminal}
                    className={secondaryActionClassName(surfaceTheme)}
                  >
                    {isOpeningTerminal ? (
                      <>
                        <LoaderCircle className="mr-1.5 h-3 w-3 animate-spin" />
                        Opening...
                      </>
                    ) : (
                      <>
                        <SquareTerminal className="mr-1.5 h-3 w-3" />
                        Open Terminal
                      </>
                    )}
                  </Button>
                ) : null}
              </div>
              {run.docsUrl ? (
                <a
                  href={run.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    "mt-2 inline-flex items-center gap-1 text-[9px] underline underline-offset-4",
                    surfaceTheme === "light" ? "text-[#7f6554]" : "text-slate-300"
                  )}
                >
                  Setup docs
                  <ArrowRight className="h-2.5 w-2.5" />
                </a>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
