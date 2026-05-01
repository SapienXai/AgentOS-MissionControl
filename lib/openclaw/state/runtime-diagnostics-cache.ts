import type { OpenClawRuntimeState } from "@/lib/openclaw/state/runtime-state";

type RuntimeDiagnosticsCacheEntry = {
  agentIdsKey: string;
  value: OpenClawRuntimeState;
  expiresAt: number;
};

export class RuntimeDiagnosticsStateCache {
  private cache: RuntimeDiagnosticsCacheEntry | null = null;
  private promise: Promise<OpenClawRuntimeState> | null = null;

  constructor(
    private readonly options: {
      ttlMs: number;
      getGeneration: () => number;
      loadState: (agentIds: string[]) => Promise<OpenClawRuntimeState>;
    }
  ) {}

  clear() {
    this.cache = null;
    this.promise = null;
  }

  read(agentIds: string[], force = false) {
    const agentIdsKey = buildRuntimeDiagnosticsAgentKey(agentIds);
    const cached = this.cache;
    const cacheMatches = Boolean(cached && cached.agentIdsKey === agentIdsKey);
    const cacheIsFresh = Boolean(cacheMatches && cached && cached.expiresAt > Date.now());

    if (!force && cacheIsFresh && cached) {
      return cached.value;
    }

    if (!force && cacheMatches && cached) {
      if (!this.promise) {
        this.promise = this.loadForCurrentGeneration(agentIds);
        void this.promise.catch(() => {});
        void this.promise.finally(() => {
          this.promise = null;
        }).catch(() => {});
      }

      return cached.value;
    }

    if (!force && this.promise && cacheMatches && cached) {
      return cached.value;
    }

    if (this.promise && !force) {
      return this.promise;
    }

    if (force && this.promise) {
      return this.promise;
    }

    this.promise = this.loadForCurrentGeneration(agentIds);
    void this.promise.catch(() => {});
    void this.promise.finally(() => {
      this.promise = null;
    }).catch(() => {});

    return force ? this.promise.then((value) => value) : this.promise;
  }

  private loadForCurrentGeneration(agentIds: string[]) {
    const generation = this.options.getGeneration();
    const agentIdsKey = buildRuntimeDiagnosticsAgentKey(agentIds);

    return this.options.loadState(agentIds).then((nextState) => {
      if (generation === this.options.getGeneration()) {
        this.cache = {
          agentIdsKey,
          value: nextState,
          expiresAt: Date.now() + this.options.ttlMs
        };
      }

      return nextState;
    });
  }
}

function buildRuntimeDiagnosticsAgentKey(agentIds: string[]) {
  return [...new Set(agentIds.filter(Boolean))].sort().join("\u0000");
}
