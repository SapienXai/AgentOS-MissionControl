"use client";

import { startTransition, useEffect, useState } from "react";

import type { ControlPlaneSnapshot } from "@/lib/agentos/contracts";

type ConnectionState = "connecting" | "live" | "retrying";

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
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");

  useEffect(() => {
    const source = new EventSource("/api/stream");

    source.addEventListener("snapshot", (event) => {
      const nextSnapshot = JSON.parse(event.data) as ControlPlaneSnapshot;
      startTransition(() => {
        setSnapshot((currentSnapshot) =>
          isNewerSnapshot(nextSnapshot, currentSnapshot) ? nextSnapshot : currentSnapshot
        );
        setConnectionState("live");
      });
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
  }, []);

  const refreshSnapshot = async (options: { force?: boolean } = {}) => {
    const url = options.force ? "/api/snapshot?force=true" : "/api/snapshot";
    const response = await fetch(url, {
      cache: "no-store"
    });
    const nextSnapshot = (await response.json()) as ControlPlaneSnapshot;

    startTransition(() => {
      setSnapshot((currentSnapshot) =>
        isNewerSnapshot(nextSnapshot, currentSnapshot) ? nextSnapshot : currentSnapshot
      );
      setConnectionState("live");
    });

    return nextSnapshot;
  };

  const refresh = async () => {
    await refreshSnapshot();
  };

  return {
    snapshot,
    connectionState,
    refresh,
    refreshSnapshot,
    setSnapshot
  };
}
