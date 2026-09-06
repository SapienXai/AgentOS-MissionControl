"use client";

import { startTransition, useCallback, useEffect, useState, type SetStateAction } from "react";

import type { ControlPlaneSnapshot } from "@/lib/agentos/contracts";

type ConnectionState = "connecting" | "live" | "retrying";

const snapshotCollectionKeys = [
  "presence",
  "channelAccounts",
  "workspaces",
  "agents",
  "models",
  "runtimes",
  "tasks",
  "agentInbox",
  "relationships",
  "missionPresets"
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function preserveMissionControlSnapshotCollections(
  currentSnapshot: ControlPlaneSnapshot,
  nextSnapshot: unknown
) {
  if (!isRecord(nextSnapshot)) {
    return currentSnapshot;
  }

  let safeSnapshot = nextSnapshot as unknown as ControlPlaneSnapshot;
  const currentRecord = currentSnapshot as unknown as Record<string, unknown>;

  for (const key of snapshotCollectionKeys) {
    if (Array.isArray(nextSnapshot[key])) {
      continue;
    }

    safeSnapshot = {
      ...safeSnapshot,
      [key]: Array.isArray(currentRecord[key]) ? currentRecord[key] : []
    };
  }

  return safeSnapshot;
}

export function preserveConfirmedStatus(current: boolean | null, next: boolean | null) {
  return current === true ? true : next;
}

export function isNewerSnapshot(nextSnapshot: ControlPlaneSnapshot, currentSnapshot: ControlPlaneSnapshot) {
  const nextRevision = nextSnapshot.revision ?? 0;
  const currentRevision = currentSnapshot.revision ?? 0;

  if (nextRevision !== currentRevision) {
    return nextRevision > currentRevision;
  }

  if (currentSnapshot.mode === "live" && nextSnapshot.mode === "fallback") {
    return false;
  }

  if (currentSnapshot.mode === "fallback" && nextSnapshot.mode === "live") {
    return true;
  }

  const nextGeneratedAt = Date.parse(nextSnapshot.generatedAt);
  const currentGeneratedAt = Date.parse(currentSnapshot.generatedAt);

  if (Number.isNaN(nextGeneratedAt) || Number.isNaN(currentGeneratedAt)) {
    return true;
  }

  return nextGeneratedAt >= currentGeneratedAt;
}

export function useMissionControlData(initialSnapshot: ControlPlaneSnapshot) {
  const [snapshot, setSnapshot] = useState(() =>
    preserveMissionControlSnapshotCollections(initialSnapshot, initialSnapshot)
  );
  const setSafeSnapshot = useCallback((nextSnapshot: SetStateAction<ControlPlaneSnapshot>) => {
    setSnapshot((currentSnapshot) => {
      const resolvedSnapshot = typeof nextSnapshot === "function"
        ? nextSnapshot(currentSnapshot)
        : nextSnapshot;

      return preserveMissionControlSnapshotCollections(currentSnapshot, resolvedSnapshot);
    });
  }, []);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [attentionRefreshGeneration, setAttentionRefreshGeneration] = useState(0);
  const [hasReceivedLiveSnapshot, setHasReceivedLiveSnapshot] = useState(false);
  const [gatewayReachable, setGatewayReachable] = useState<boolean | null>(null);
  const [gatewayRegistered, setGatewayRegistered] = useState<boolean | null>(null);
  const [gatewayConfigured, setGatewayConfigured] = useState<boolean | null>(null);
  const [gatewayReady, setGatewayReady] = useState<boolean | null>(null);
  const [runtimeWritable, setRuntimeWritable] = useState<boolean | null>(null);
  const [localModelStatus, setLocalModelStatus] = useState<{
    checked: boolean;
    defaultModelId: string | null;
    modelIds: string[];
  }>({
    checked: false,
    defaultModelId: null,
    modelIds: []
  });
  const [cliInstalled, setCliInstalled] = useState<boolean | null>(null);

  useEffect(() => {
    const source = new EventSource("/api/stream");

    source.addEventListener("snapshot", (event) => {
      const nextSnapshot = JSON.parse(event.data) as ControlPlaneSnapshot;
      startTransition(() => {
        setSafeSnapshot((currentSnapshot) =>
          isNewerSnapshot(nextSnapshot, currentSnapshot) ? nextSnapshot : currentSnapshot
        );
        setHasReceivedLiveSnapshot(true);
        setConnectionState("live");
      });
    });

    source.addEventListener("attention", (event) => {
      const payload = JSON.parse(event.data) as { revision?: number };
      setAttentionRefreshGeneration((current) =>
        typeof payload.revision === "number" && Number.isFinite(payload.revision)
          ? Math.max(current, payload.revision)
          : current + 1
      );
    });

    source.addEventListener("system-status", (event) => {
      const status = JSON.parse(event.data) as {
        gatewayReachable?: boolean;
        gatewayReady?: boolean;
        gatewayRegistered?: boolean | null;
        gatewayConfigured?: boolean | null;
        cliInstalled?: boolean;
        runtimeWritable?: boolean | null;
        modelStatus?: { checked?: boolean; defaultModelId?: string | null; modelIds?: string[] };
      };
      setGatewayReachable(status.gatewayReachable === true);
      setGatewayRegistered((current) => preserveConfirmedStatus(current, status.gatewayRegistered ?? null));
      setGatewayConfigured((current) => preserveConfirmedStatus(current, status.gatewayConfigured ?? null));
      setGatewayReady((current) => preserveConfirmedStatus(current, status.gatewayReady === true));
      setCliInstalled(status.cliInstalled === true);
      setRuntimeWritable((current) => preserveConfirmedStatus(current, status.runtimeWritable ?? null));
      if (status.modelStatus?.checked) {
        setLocalModelStatus({
          checked: true,
          defaultModelId: status.modelStatus.defaultModelId ?? null,
          modelIds: Array.isArray(status.modelStatus.modelIds) ? status.modelStatus.modelIds : []
        });
      }
    });

    source.addEventListener("error", () => {
      setConnectionState("retrying");
    });

    source.addEventListener("ready", () => {
      setConnectionState("live");
    });

    source.onerror = () => {
      setConnectionState("retrying");
    };

    return () => {
      source.close();
    };
  }, [setSafeSnapshot]);

  const refreshSnapshot = useCallback(async (options: { force?: boolean } = {}) => {
    const url = options.force ? "/api/snapshot?force=true" : "/api/snapshot";
    const response = await fetch(url, {
      cache: "no-store"
    });
    const nextSnapshot = (await response.json()) as ControlPlaneSnapshot;
    const snapshotPending = response.headers.get("X-AgentOS-Snapshot-Pending") === "true";

    startTransition(() => {
      setSafeSnapshot((currentSnapshot) =>
        isNewerSnapshot(nextSnapshot, currentSnapshot) ? nextSnapshot : currentSnapshot
      );
      if (!snapshotPending) {
        setHasReceivedLiveSnapshot(true);
        setConnectionState("live");
      } else {
        setConnectionState("connecting");
      }
    });

    return nextSnapshot;
  }, [setSafeSnapshot]);

  const refresh = useCallback(async () => {
    await refreshSnapshot();
  }, [refreshSnapshot]);

  return {
    snapshot,
    connectionState,
    attentionRefreshGeneration,
    hasReceivedLiveSnapshot,
    gatewayReachable,
    gatewayRegistered,
    gatewayConfigured,
    gatewayReady,
    runtimeWritable,
    localModelStatus,
    cliInstalled,
    refresh,
    refreshSnapshot,
    setSnapshot: setSafeSnapshot
  };
}
