import type { AgentRuntime, RuntimeCapabilities, RuntimeEvent, RuntimeSubscription } from "@/lib/agentos/runtime-contract";

import {
  getPlatformInfo,
  getRuntimeStatus,
  getRuntimeLogs,
  restartRuntime,
  runRuntimeDoctor,
  startRuntime,
  stopRuntime,
  subscribeToRuntimeLogs
} from "./bridge";

/**
 * Thin desktop adapter for the existing OpenClaw lifecycle boundary. Gateway
 * protocol operations remain owned by the existing OpenClaw client/services;
 * this adapter only exposes the desktop runtime contract to React.
 */
export class OpenClawRuntimeAdapter implements AgentRuntime {
  readonly id = "openclaw-local";
  readonly kind = "openclaw" as const;

  async getCapabilities(): Promise<RuntimeCapabilities> {
    const { capabilities } = await getPlatformInfo();
    return {
      ...capabilities,
      browser: false,
      memory: true,
      skills: true,
      multiAgent: true,
      taskExecution: true
    };
  }

  getStatus() {
    return getRuntimeStatus();
  }

  start() {
    return startRuntime();
  }

  stop() {
    return stopRuntime();
  }

  restart() {
    return restartRuntime();
  }

  async doctor() {
    const result = await runRuntimeDoctor();
    return {
      runtimeId: this.id,
      status: result.status.health,
      summary: result.summary,
      issues: result.issues,
      checkedAt: result.status.checkedAt
    };
  }

  subscribe(listener: (event: RuntimeEvent) => void): RuntimeSubscription {
    let active = true;
    let unlisten: (() => void) | undefined;
    void subscribeToRuntimeLogs((entry) => {
      if (active) listener({ type: "log", entry });
    }).then((cleanup) => {
      if (active) unlisten = cleanup;
      else cleanup();
    }).catch(() => {});

    return {
      unsubscribe() {
        active = false;
        unlisten?.();
      }
    };
  }

  getLogs() {
    return getRuntimeLogs();
  }
}
