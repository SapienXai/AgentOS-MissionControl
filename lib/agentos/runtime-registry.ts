import type { AgentRuntime, RuntimeId } from "./runtime-contract";

/**
 * Runtime providers are registered explicitly by the product surface that can
 * actually reach them. The registry intentionally does not manufacture
 * placeholder providers for unsupported execution targets.
 */
export class RuntimeRegistry {
  private readonly runtimes = new Map<RuntimeId, AgentRuntime>();

  constructor(runtimes: AgentRuntime[] = []) {
    runtimes.forEach((runtime) => this.register(runtime));
  }

  register(runtime: AgentRuntime): void {
    if (this.runtimes.has(runtime.id)) {
      throw new Error(`Runtime "${runtime.id}" is already registered.`);
    }
    this.runtimes.set(runtime.id, runtime);
  }

  get(runtimeId: RuntimeId): AgentRuntime | undefined {
    return this.runtimes.get(runtimeId);
  }

  list(): AgentRuntime[] {
    return [...this.runtimes.values()];
  }
}
