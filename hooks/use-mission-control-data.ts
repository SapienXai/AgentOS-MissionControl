"use client";

import { startTransition, useEffect, useState } from "react";

import type { MissionControlSnapshot } from "@/lib/openclaw/types";

type ConnectionState = "connecting" | "live" | "retrying";

export function useMissionControlData(initialSnapshot: MissionControlSnapshot) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");

  useEffect(() => {
    const source = new EventSource("/api/stream");

    source.addEventListener("snapshot", (event) => {
      const nextSnapshot = JSON.parse(event.data) as MissionControlSnapshot;
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

  const refresh = async () => {
    const response = await fetch("/api/snapshot", {
      cache: "no-store"
    });
    const nextSnapshot = (await response.json()) as MissionControlSnapshot;

    startTransition(() => {
      setSnapshot(nextSnapshot);
    });
  };

  return {
    snapshot,
    connectionState,
    refresh,
    setSnapshot
  };
}
