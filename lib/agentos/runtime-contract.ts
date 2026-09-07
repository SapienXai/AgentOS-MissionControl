import type { PlatformCapabilities } from "./platform";

export type RuntimeId = string;
export type RuntimeKind = "openclaw";
export type RuntimeConnection = "local" | "remote" | "cloud";
export type RuntimeHealth = "healthy" | "degraded" | "offline" | "unknown";

export type RuntimeCapabilities = PlatformCapabilities & {
  browser: boolean;
  memory: boolean;
  skills: boolean;
  multiAgent: boolean;
  taskExecution: boolean;
};

export type RuntimeStatus = {
  runtimeId: RuntimeId;
  kind: RuntimeKind;
  displayName: string;
  connection: RuntimeConnection;
  installed: boolean;
  running: boolean;
  ready: boolean;
  health: RuntimeHealth;
  version: string | null;
  pid: number | null;
  reason: string | null;
  checkedAt: string;
};

export type RuntimeDoctorResult = {
  runtimeId: RuntimeId;
  status: RuntimeHealth;
  summary: string;
  issues: string[];
  checkedAt: string;
};

export type RuntimeLogEntry = {
  id: string;
  source: "stdout" | "stderr" | "system";
  level: "info" | "warn" | "error";
  message: string;
  timestamp: string;
};

export type RuntimeEvent =
  | { type: "status"; status: RuntimeStatus }
  | { type: "log"; entry: RuntimeLogEntry }
  | { type: "doctor"; result: RuntimeDoctorResult };

export type RuntimeSubscription = { unsubscribe: () => void };

/**
 * The smallest provider-neutral contract supported by the current product.
 * Provider-specific Gateway and protocol details remain in the OpenClaw
 * adapter rather than leaking into desktop UI code.
 */
export interface AgentRuntime {
  readonly id: RuntimeId;
  readonly kind: RuntimeKind;
  getCapabilities(): Promise<RuntimeCapabilities>;
  getStatus(): Promise<RuntimeStatus>;
  start(): Promise<RuntimeStatus>;
  stop(): Promise<RuntimeStatus>;
  restart(): Promise<RuntimeStatus>;
  doctor(): Promise<RuntimeDoctorResult>;
  subscribe(listener: (event: RuntimeEvent) => void): RuntimeSubscription;
}
