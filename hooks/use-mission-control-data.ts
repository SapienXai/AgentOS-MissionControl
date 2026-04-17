"use client";

import { startTransition, useEffect, useState } from "react";

import type { ControlPlaneSnapshot } from "@/lib/agentos/contracts";

type ConnectionState = "connecting" | "live" | "retrying";

export function useMissionControlData(initialSnapshot: ControlPlaneSnapshot) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");

  useEffect(() => {
    const source = new EventSource("/api/stream");

    source.addEventListener("snapshot", (event) => {
      const nextSnapshot = JSON.parse(event.data) as ControlPlaneSnapshot;
      startTransition(() => {
        setSnapshot(nextSnapshot);
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
      setSnapshot(nextSnapshot);
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
