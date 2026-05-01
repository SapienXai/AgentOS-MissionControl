import type { OpenClawRuntimeSmokeTest } from "@/lib/openclaw/types";
import type { OpenClawRuntimeState } from "@/lib/openclaw/state/runtime-state";

export function buildRuntimeDiagnosticsFromState(
  runtimeState: OpenClawRuntimeState,
  smokeTest: OpenClawRuntimeSmokeTest
) {
  const issues = [
    ...runtimeState.issues,
    ...(smokeTest.status === "failed" && smokeTest.error
      ? [
          `Latest runtime smoke test failed for ${smokeTest.agentId ?? "unknown agent"}. ${smokeTest.error}`
        ]
      : [])
  ];

  return {
    ...runtimeState,
    smokeTest,
    issues
  };
}
