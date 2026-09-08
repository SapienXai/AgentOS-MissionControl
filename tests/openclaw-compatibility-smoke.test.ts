import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyOpenClawNodeVersion,
  resolveOpenClawCompatibilitySmokeOutcome
} from "@/lib/openclaw/application/compatibility-smoke-service";
import type { OpenClawSmokeTestCheck } from "@/lib/openclaw/types";

function check(
  id: string,
  status: OpenClawSmokeTestCheck["status"],
  required = true
): OpenClawSmokeTestCheck {
  return {
    id,
    label: id,
    status,
    required,
    summary: `${id} ${status}`,
    recovery: status === "pass" ? null : `${id} recovery`,
    durationMs: 1
  };
}

test("OpenClaw compatibility smoke marks supported Node versions", () => {
  assert.equal(classifyOpenClawNodeVersion("24.16.0").status, "supported");
  assert.equal(classifyOpenClawNodeVersion("26.1.0").status, "supported");
  assert.match(classifyOpenClawNodeVersion("24.16.0").summary, /supported AgentOS\/OpenClaw runtime floors/i);
});

test("OpenClaw compatibility smoke rejects old Node versions", () => {
  const result = classifyOpenClawNodeVersion("24.15.0");

  assert.equal(result.status, "unsupported");
  assert.match(result.summary, /outside the supported/i);
  assert.match(result.recovery ?? "", /24\.16\.0/);
  assert.equal(classifyOpenClawNodeVersion("25.0.0").status, "unsupported");
  assert.equal(classifyOpenClawNodeVersion("26.0.0").status, "unsupported");
});

test("OpenClaw compatibility outcome requires all required checks and model readiness", () => {
  assert.deepEqual(
    resolveOpenClawCompatibilitySmokeOutcome(
      [
        check("binary", "pass"),
        check("native", "pass"),
        check("events", "warning", false)
      ],
      { modelReady: true }
    ),
    {
      status: "degraded",
      safeToDispatchMissions: true,
      recovery: "events recovery"
    }
  );

  assert.deepEqual(
    resolveOpenClawCompatibilitySmokeOutcome(
      [
        check("binary", "pass"),
        check("native", "fail")
      ],
      { modelReady: true }
    ),
    {
      status: "incompatible",
      safeToDispatchMissions: false,
      recovery: "native recovery"
    }
  );

  assert.deepEqual(
    resolveOpenClawCompatibilitySmokeOutcome(
      [
        check("binary", "pass"),
        check("native", "pass")
      ],
      { modelReady: false }
    ),
    {
      status: "degraded",
      safeToDispatchMissions: false,
      recovery: "OpenClaw is partially available. Review warnings before dispatching missions."
    }
  );
});
