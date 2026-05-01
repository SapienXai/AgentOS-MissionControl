import type { GatewayStatusPayload } from "@/lib/openclaw/client/gateway-client";

type GatewayStatusCacheEntry = {
  value: GatewayStatusPayload;
  capturedAt: number;
};

export class GatewayStatusCache {
  private cache: GatewayStatusCacheEntry | null = null;

  constructor(private readonly staleGraceMs: number) {}

  clear() {
    this.cache = null;
  }

  shouldRefresh() {
    return !this.cache || Date.now() - this.cache.capturedAt > this.staleGraceMs;
  }

  getCachedPort(fallbackPort = 18789) {
    return this.cache?.value.gateway?.port ?? fallbackPort;
  }

  write(value: GatewayStatusPayload) {
    this.cache = {
      value,
      capturedAt: Date.now()
    };
  }

  resolve(result: PromiseSettledResult<GatewayStatusPayload>): {
    value: GatewayStatusPayload | undefined;
    reusedCachedValue: boolean;
  } {
    if (result.status === "fulfilled") {
      this.write(result.value);

      return {
        value: result.value,
        reusedCachedValue: false
      };
    }

    if (this.cache && Date.now() - this.cache.capturedAt <= this.staleGraceMs) {
      return {
        value: this.cache.value,
        reusedCachedValue: true
      };
    }

    return {
      value: undefined,
      reusedCachedValue: false
    };
  }
}
