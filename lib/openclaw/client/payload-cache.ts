export const SLOW_PAYLOAD_CACHE_TTL_MS = 5 * 60_000;
export const DEFERRED_SNAPSHOT_PAYLOAD_MESSAGE = "Deferred to background refresh.";

export type CachedPayload<T> = {
  value: T;
  capturedAt: number;
};

export class CachedPayloadController<T> {
  private cache: CachedPayload<T> | null = null;
  private refreshPromise: Promise<void> | null = null;

  constructor(private readonly ttlMs = SLOW_PAYLOAD_CACHE_TTL_MS) {}

  clear() {
    this.cache = null;
    this.refreshPromise = null;
  }

  shouldRefresh() {
    return !this.cache || Date.now() - this.cache.capturedAt > this.ttlMs;
  }

  resolve(result: PromiseSettledResult<T>) {
    return resolveCachedPayload(result, this.cache, (entry) => {
      this.cache = entry;
    }, this.ttlMs);
  }

  scheduleRefresh(load: () => Promise<PromiseSettledResult<T>>) {
    if (this.refreshPromise || !this.shouldRefresh()) {
      return;
    }

    this.refreshPromise = (async () => {
      try {
        const value = await load();

        if (value.status === "fulfilled") {
          this.cache = {
            value: value.value,
            capturedAt: Date.now()
          };
        }
      } catch {
        // Background refresh is best-effort.
      } finally {
        this.refreshPromise = null;
      }
    })();

    void this.refreshPromise.catch(() => {});
  }
}

export function resolveCachedPayload<T>(
  result: PromiseSettledResult<T>,
  cached: CachedPayload<T> | null,
  writeCache: (entry: CachedPayload<T>) => void,
  ttlMs = SLOW_PAYLOAD_CACHE_TTL_MS
) {
  if (result.status === "fulfilled") {
    const entry = {
      value: result.value,
      capturedAt: Date.now()
    };

    writeCache(entry);

    return {
      value: result.value,
      reusedCachedValue: false,
      failed: false
    };
  }

  if (cached && Date.now() - cached.capturedAt <= ttlMs) {
    return {
      value: cached.value,
      reusedCachedValue: true,
      failed: true
    };
  }

  return {
    value: undefined,
    reusedCachedValue: false,
    failed: true
  };
}

export function createDeferredPayloadResult<T>(): PromiseSettledResult<T> {
  return {
    status: "rejected",
    reason: new Error(DEFERRED_SNAPSHOT_PAYLOAD_MESSAGE)
  };
}

export function isDeferredPayloadResult(result: PromiseSettledResult<unknown>) {
  return (
    result.status === "rejected" &&
    result.reason instanceof Error &&
    result.reason.message === DEFERRED_SNAPSHOT_PAYLOAD_MESSAGE
  );
}
