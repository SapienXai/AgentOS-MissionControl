"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, RefreshCw, RotateCcw, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import type {
  NativeDoctorConfirmation,
  NativeDoctorSnapshot
} from "@/lib/openclaw/application/native-doctor-service";
import { cn } from "@/lib/utils";

type SurfaceTheme = "dark" | "light";

export function NativeDoctorPanel({ surfaceTheme }: { surfaceTheme: SurfaceTheme }) {
  const [snapshot, setSnapshot] = useState<NativeDoctorSnapshot | null>(null);
  const [confirmation, setConfirmation] = useState<NativeDoctorConfirmation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<"restart" | null>(null);
  const [operationNotice, setOperationNotice] = useState<string | null>(null);

  const load = useCallback(async (probe = false) => {
    setLoading(true);
    setError(null);
    setOperationNotice(null);
    try {
      const response = await fetch(`/api/openclaw/native-doctor${probe ? "?probe=1" : ""}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as {
        snapshot?: NativeDoctorSnapshot;
        confirmation?: NativeDoctorConfirmation;
        error?: string;
      } | null;
      if (!response.ok || !payload?.snapshot) {
        throw new Error(payload?.error || "Native OpenClaw diagnostics are unavailable.");
      }
      setSnapshot(payload.snapshot);
      setConfirmation(payload.confirmation ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Native OpenClaw diagnostics are unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = async (kind: "restart") => {
    if (!confirmation) return;
    const confirmed = window.confirm(
      "Request a safe native OpenClaw Gateway restart? Active work may be deferred while the Gateway reconnects."
    );
    if (!confirmed) return;
    setAction(kind);
    setError(null);
    setOperationNotice(null);
    try {
      const response = await fetch("/api/openclaw/native-doctor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          action: "gateway.restart.request",
          confirmation,
          reason: "AgentOS operator recovery"
        })
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        result?: {
          message?: string;
          outcome?: string;
          verification?: { status?: string };
        };
      } | null;
      if (payload?.result?.verification?.status === "unknown" || payload?.result?.outcome === "unknown") {
        setOperationNotice(payload.result.message || "OpenClaw may have applied the operation, but AgentOS could not verify the final state.");
        return;
      }
      if (!response.ok) {
        throw new Error(payload?.error || payload?.result?.message || "Native OpenClaw operation failed.");
      }
      setOperationNotice(payload?.result?.message || "Native OpenClaw operation completed.");
      if (payload?.result?.verification?.status === "verified") {
        await load(true);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Native OpenClaw operation failed.");
    } finally {
      setAction(null);
    }
  };

  const muted = surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400";
  const strong = surfaceTheme === "light" ? "text-foreground" : "text-slate-100";
  const panel = surfaceTheme === "light"
    ? "border-border bg-muted/35"
    : "border-white/[0.08] bg-[#101a2a]/92";

  return (
    <div className={cn("rounded-[18px] border p-3.5", panel)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <Wrench className={cn("mt-0.5 h-4 w-4 shrink-0", muted)} />
          <div className="min-w-0">
            <p className={cn("text-sm font-medium", strong)}>Native Doctor & recovery</p>
            <p className={cn("mt-1 text-xs leading-5", muted)}>
              OpenClaw is the source of truth for runtime, config application, updates, and restart state.
            </p>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => void load(true)}
          disabled={loading || action !== null}
          className="shrink-0"
          aria-label="Refresh native diagnostics"
        >
          {loading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </Button>
      </div>

      {snapshot ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <DoctorValue label="Runtime" value={formatStatus(snapshot.runtime.status)} tone={snapshot.runtime.status === "healthy" ? "good" : "warn"} surfaceTheme={surfaceTheme} />
          <DoctorValue label="Config" value={formatStatus(snapshot.config.application)} tone={snapshot.config.application === "applied" ? "good" : "warn"} surfaceTheme={surfaceTheme} />
          <DoctorValue label="Updates" value={formatStatus(snapshot.update.status)} tone={snapshot.update.status === "current" ? "good" : "warn"} surfaceTheme={surfaceTheme} />
        </div>
      ) : null}

      {snapshot ? (
        <div className={cn("mt-3 rounded-[14px] border px-3 py-2.5", surfaceTheme === "light" ? "border-border bg-card" : "border-white/[0.07] bg-black/10")}>
          <p className={cn("text-xs", strong)}>{snapshot.runtime.explanation}</p>
          {(snapshot.status.version || snapshot.status.runtimeVersion || snapshot.status.updateChannel) ? (
            <p className={cn("mt-1 text-[11px] leading-5", muted)}>
              OpenClaw {snapshot.status.version || snapshot.status.runtimeVersion || "version unknown"}
              {snapshot.status.updateChannel ? ` · ${snapshot.status.updateChannel} channel` : ""}
            </p>
          ) : null}
          <p className={cn("mt-1 text-[11px] leading-5", muted)}>{snapshot.config.explanation}</p>
          <p className={cn("mt-1 text-[11px] leading-5", muted)}>{snapshot.update.explanation}</p>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => void runAction("restart")}
          disabled={!confirmation?.connectionId || loading || action !== null || snapshot?.runtime.status === "unavailable"}
        >
          {action === "restart" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
          Request safe restart
        </Button>
        <Button asChild type="button" size="sm" variant="secondary">
          <Link href="/updates">Open Updates</Link>
        </Button>
      </div>

      {error ? <p className={cn("mt-2 text-xs", surfaceTheme === "light" ? "text-rose-700" : "text-rose-300")}>{error}</p> : null}
      {operationNotice ? <p className={cn("mt-2 text-xs", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-300")}>{operationNotice}</p> : null}
    </div>
  );
}

function DoctorValue({
  label,
  value,
  tone,
  surfaceTheme
}: {
  label: string;
  value: string;
  tone: "good" | "warn";
  surfaceTheme: SurfaceTheme;
}) {
  return (
    <div className={cn("rounded-[14px] border px-3 py-2", surfaceTheme === "light" ? "border-border bg-card" : "border-white/[0.07] bg-black/10")}>
      <p className={cn("text-[9px] uppercase tracking-[0.16em]", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-500")}>{label}</p>
      <p className={cn("mt-1 text-xs font-medium", tone === "good" ? "text-emerald-600" : "text-amber-600")}>{value}</p>
    </div>
  );
}

function formatStatus(value: string) {
  return value.replaceAll("-", " ");
}
