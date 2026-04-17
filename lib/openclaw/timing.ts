export type TimingStep = {
  label: string;
  durationMs: number;
};

export type TimingSummary = {
  scope: string;
  totalMs: number;
  steps: TimingStep[];
};

export interface TimingCollector {
  measure<T>(label: string, fn: () => Promise<T> | T): Promise<T>;
  summary(): TimingSummary;
}

function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

export function createTimingCollector(scope: string): TimingCollector {
  const startedAt = nowMs();
  const steps: TimingStep[] = [];

  return {
    async measure<T>(label: string, fn: () => Promise<T> | T) {
      const stepStartedAt = nowMs();

      try {
        return await fn();
      } finally {
        steps.push({
          label,
          durationMs: Math.round(nowMs() - stepStartedAt)
        });
      }
    },
    summary() {
      return {
        scope,
        totalMs: Math.round(nowMs() - startedAt),
        steps: [...steps]
      };
    }
  };
}

export async function measureTiming<T>(
  collector: TimingCollector | null | undefined,
  label: string,
  fn: () => Promise<T> | T
) {
  return collector ? collector.measure(label, fn) : await fn();
}

export function formatTimingSummary(summary: TimingSummary) {
  const lines = [`[openclaw timing] ${summary.scope} total=${summary.totalMs}ms`];

  for (const step of summary.steps) {
    lines.push(`[openclaw timing]   ${step.label}: ${step.durationMs}ms`);
  }

  return lines.join("\n");
}
