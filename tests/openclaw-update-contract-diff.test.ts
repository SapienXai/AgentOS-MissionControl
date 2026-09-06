import assert from "node:assert/strict";
import { test } from "node:test";

import {
  compareOpenClawCoreMethodSpecs,
  getOpenClawServerMethodContractDiff,
  parseOpenClawCoreMethodSpecs,
  resetOpenClawServerMethodContractDiffCache
} from "@/lib/openclaw/application/update-contract-diff-service";

const currentDescriptor = `
export const CORE_GATEWAY_METHOD_SPECS = [
  { name: "health", scope: "operator.read" },
  { name: "models.list", scope: "operator.read" },
  { name: "agents.update", scope: "operator.write", controlPlaneWrite: true },
] as const;
`;

const targetDescriptor = `
export const CORE_GATEWAY_METHOD_SPECS = [
  { name: "models.list", scope: "operator.admin" },
  { name: "agents.update", scope: "operator.write", controlPlaneWrite: true },
  { name: "gateway.identity.get", scope: "operator.read" },
] as const;
`;

const tupleDescriptor = `
const CORE_GATEWAY_METHOD_SPECS = [
  ["health", "health", "operator.read", "<=2026.7"],
  [
    "device.pair.setupCode",
    "device-pair-setup",
    "operator.admin",
    "2026.8",
    { advertise: false, compatibilityRestored: true, description: "setup code" },
  ],
  ["sessions.create", "sessions-create", "dynamic", "<=2026.7", { startup: true }],
  ["question.request", "questions", "operator.questions", "2026.8"],
] as const satisfies readonly CoreGatewayMethodSpecRow[];
`;

const upstreamSharedPolicyDescriptor = `
const CONTROL_PLANE_WRITE = { controlPlaneWrite: true };
const CORE_GATEWAY_METHOD_SPECS = [
  ["config.apply", "config", "operator.admin", "<=2026.7", CONTROL_PLANE_WRITE],
] as const;
`;

test("core Gateway descriptors are parsed without executing OpenClaw source", () => {
  const methods = parseOpenClawCoreMethodSpecs(currentDescriptor);

  assert.deepEqual(methods.map((method) => method.name), ["health", "models.list", "agents.update"]);
  assert.equal(methods[2]?.controlPlaneWrite, true);
  assert.equal(methods[0]?.advertise, true);
});

test("v8 tuple descriptors preserve scopes and policy metadata", () => {
  const methods = parseOpenClawCoreMethodSpecs(tupleDescriptor);

  assert.deepEqual(methods.map((method) => method.name), [
    "health",
    "device.pair.setupCode",
    "sessions.create",
    "question.request"
  ]);
  assert.equal(methods[1]?.family, "device-pair-setup");
  assert.equal(methods[1]?.since, "2026.8");
  assert.equal(methods[1]?.advertise, false);
  assert.equal(methods[1]?.compatibilityRestored, true);
  assert.equal(methods[2]?.scope, "dynamic");
  assert.equal(methods[3]?.scope, "operator.questions");
});

test("tuple descriptors accept the pinned OpenClaw shared mutation policy constant", () => {
  const methods = parseOpenClawCoreMethodSpecs(upstreamSharedPolicyDescriptor);

  assert.equal(methods[0]?.name, "config.apply");
  assert.equal(methods[0]?.controlPlaneWrite, true);
});

test("malformed or unsupported descriptor rows fail closed", () => {
  assert.throws(
    () => parseOpenClawCoreMethodSpecs("const CORE_GATEWAY_METHOD_SPECS = [{ name: \"health\", scope: \"operator.read\" }, { nope: true }] as const;"),
    /unsupported field/
  );
  assert.throws(
    () => parseOpenClawCoreMethodSpecs("const CORE_GATEWAY_METHOD_SPECS = [[\"health\", \"health\", \"operator.read\"]] as const;"),
    /invalid tuple length/
  );
  assert.throws(
    () => parseOpenClawCoreMethodSpecs("const CORE_GATEWAY_METHOD_SPECS = [{ name: \"health\", scope: \"operator.read\" }, { name: \"health\", scope: \"operator.read\" }] as const;"),
    /duplicate method/
  );
});

test("required method removal and privilege escalation block update preflight evidence", async () => {
  resetOpenClawServerMethodContractDiffCache();
  const report = await getOpenClawServerMethodContractDiff(
    { currentVersion: "2026.6.8", targetVersion: "2026.7.1" },
    {
      bypassCache: true,
      now: () => new Date("2026-07-01T10:00:00.000Z"),
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/compare/")) {
          return jsonResponse({
            files: [
              { filename: "src/gateway/server-methods/models.ts" },
              { filename: "packages/gateway-protocol/src/schema/models.ts" }
            ]
          });
        }

        return new Response(url.includes("v2026.6.8") ? currentDescriptor : targetDescriptor);
      }
    }
  );

  assert.equal(report.status, "blocker");
  assert.equal(report.source, "github-static");
  assert.equal(report.currentMethodCount, 3);
  assert.equal(report.targetMethodCount, 3);
  assert.equal(report.changedServerMethodFiles.length, 1);
  assert.equal(report.changedProtocolFiles.length, 1);
  assert.equal(report.changes.some((change) => change.method === "health" && change.status === "blocker"), true);
  assert.equal(report.changes.some((change) => change.method === "models.list" && change.kind === "scope-changed"), true);
});

test("scope changes use warning and unknown evidence instead of a privilege ladder", async () => {
  const report = await getOpenClawServerMethodContractDiff(
    { currentVersion: "2026.6.8", targetVersion: "2026.7.1" },
    {
      bypassCache: true,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/compare/")) {
          return jsonResponse({ files: [] });
        }
        return new Response(url.includes("v2026.6.8")
          ? `export const CORE_GATEWAY_METHOD_SPECS = [
              { name: "sessions.create", scope: "operator.write" },
              { name: "talk.session.create", scope: "operator.write" },
              { name: "config.schema", scope: "operator.admin" },
            ] as const;`
          : `export const CORE_GATEWAY_METHOD_SPECS = [
              { name: "sessions.create", scope: "dynamic" },
              { name: "talk.session.create", scope: "operator.talk" },
              { name: "config.schema", scope: "operator.read" },
            ] as const;`);
      }
    }
  );

  assert.equal(report.status, "warning");
  assert.equal(report.unknownCount, 1);
  assert.equal(report.changes.find((change) => change.method === "sessions.create")?.status, "unknown");
  assert.equal(report.changes.find((change) => change.method === "sessions.create")?.authorizationEvidence, "runtime-required");
  assert.match(report.changes.find((change) => change.method === "sessions.create")?.message ?? "", /does not prove|runtime verification/i);
  assert.equal(report.changes.find((change) => change.method === "talk.session.create")?.status, "warning");
  assert.equal(report.changes.find((change) => change.method === "config.schema")?.status, "warning");
  assert.equal(report.changes.some((change) => change.status === "blocker"), false);
});

test("dynamic target descriptors never certify authorization from advertisement alone", () => {
  const methods = ["sessions.create", "sessions.patch", "sessions.delete", "node.invoke", "agent", "talk.config"];
  const changes = compareOpenClawCoreMethodSpecs(
    methods.map((name) => ({
      name,
      family: null,
      scope: "operator.write",
      since: null,
      advertise: true,
      startup: false,
      controlPlaneWrite: false,
      compatibilityRestored: false,
      description: null
    })),
    methods.map((name) => ({
      name,
      family: null,
      scope: "dynamic",
      since: null,
      advertise: true,
      startup: false,
      controlPlaneWrite: false,
      compatibilityRestored: false,
      description: null
    }))
  );

  for (const method of methods) {
    const change = changes.find((candidate) => candidate.method === method);
    assert.equal(change?.status, "unknown");
    assert.equal(change?.authorizationEvidence, "runtime-required");
    assert.match(change?.message ?? "", /runtime verification/i);
  }
});

test("optional loss with a disabled fallback is warning evidence, and operation siblings are not replacements", async () => {
  const report = await getOpenClawServerMethodContractDiff(
    { currentVersion: "2026.6.8", targetVersion: "2026.7.1" },
    {
      bypassCache: true,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/compare/")) {
          return jsonResponse({ files: [] });
        }
        return new Response(url.includes("v2026.6.8")
          ? `export const CORE_GATEWAY_METHOD_SPECS = [
              { name: "tools.catalog", scope: "operator.read" },
              { name: "talk.session.join", scope: "operator.write" },
            ] as const;`
          : `export const CORE_GATEWAY_METHOD_SPECS = [
              { name: "talk.session.create", scope: "operator.talk" },
            ] as const;`);
      }
    }
  );

  assert.equal(report.status, "warning");
  assert.equal(report.changes.find((change) => change.method === "tools.catalog")?.status, "warning");
  assert.equal(report.changes.find((change) => change.method === "talk.session.join")?.kind, "removed");
  assert.equal(report.replacedCount, 0);
});

test("required loss blocks when an unrelated operation sibling survives", () => {
  const changes = compareOpenClawCoreMethodSpecs(
    [
      { name: "required.primary", family: null, scope: "operator.read", since: null, advertise: true, startup: false, controlPlaneWrite: false, compatibilityRestored: false, description: null },
      { name: "required.sibling", family: null, scope: "operator.read", since: null, advertise: true, startup: false, controlPlaneWrite: false, compatibilityRestored: false, description: null }
    ],
    [
      { name: "required.sibling", family: null, scope: "operator.read", since: null, advertise: true, startup: false, controlPlaneWrite: false, compatibilityRestored: false, description: null }
    ],
    [{ id: "health", label: "Required composite", methods: ["required.primary", "required.sibling"], baseline: "required" }]
  );

  assert.equal(changes.find((change) => change.method === "required.primary")?.kind, "removed");
  assert.equal(changes.find((change) => change.method === "required.primary")?.status, "blocker");
});

test("explicit replacement evidence prevents a required-loss blocker", () => {
  const changes = compareOpenClawCoreMethodSpecs(
    [
      { name: "required.primary", family: null, scope: "operator.read", since: null, advertise: true, startup: false, controlPlaneWrite: false, compatibilityRestored: false, description: null },
      { name: "required.sibling", family: null, scope: "operator.read", since: null, advertise: true, startup: false, controlPlaneWrite: false, compatibilityRestored: false, description: null }
    ],
    [
      { name: "required.sibling", family: null, scope: "operator.read", since: null, advertise: true, startup: false, controlPlaneWrite: false, compatibilityRestored: false, description: null }
    ],
    [{
      id: "health",
      label: "Required composite",
      methods: ["required.primary", "required.sibling"],
      replacementEvidence: [{
        removedMethod: "required.primary",
        replacementMethods: ["required.sibling"],
        rationale: "The contract explicitly declares these two method names as aliases."
      }],
      baseline: "required"
    }]
  );

  assert.equal(changes.find((change) => change.method === "required.primary")?.kind, "replaced");
  assert.equal(changes.find((change) => change.method === "required.primary")?.status, "warning");
});

test("diverged compare evidence remains incomplete after the bounded first page", async () => {
  const comparePages: number[] = [];
  const report = await getOpenClawServerMethodContractDiff(
    { currentVersion: "2026.6.8", targetVersion: "2026.7.1" },
    {
      bypassCache: true,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/compare/")) {
          const page = Number(new URL(url).searchParams.get("page"));
          comparePages.push(page);
          return jsonResponse({
            status: "diverged",
            total_commits: 10_000,
            files: page === 1
              ? Array.from({ length: 300 }, (_, index) => ({ filename: `docs/file-${index}` }))
              : []
          });
        }
        return new Response(url.includes("v2026.6.8") ? currentDescriptor : currentDescriptor);
      }
    }
  );

  assert.deepEqual(comparePages, [1, 2]);
  assert.deepEqual(report.changedServerMethodFiles, []);
  assert.deepEqual(report.changedProtocolFiles, []);
  assert.equal(report.changes.some((change) => change.method === "__comparison_truncated__" && change.status === "unknown"), true);
  assert.equal(report.unknownCount, 1);
});

test("unavailable target source produces bounded unknown evidence instead of throwing", async () => {
  const report = await getOpenClawServerMethodContractDiff(
    { currentVersion: "2026.6.8", targetVersion: "2026.7.2" },
    {
      bypassCache: true,
      fetchImpl: async (input) => {
        const url = String(input);
        return new Response(url.includes("v2026.7.2") ? "Not found" : currentDescriptor, {
          status: url.includes("v2026.7.2") ? 404 : 200
        });
      }
    }
  );

  assert.equal(report.status, "unknown");
  assert.equal(report.source, "unavailable");
  assert.match(report.error ?? "", /HTTP 404/);
});

test("invalid versions never reach the network", async () => {
  let fetchCalls = 0;
  const report = await getOpenClawServerMethodContractDiff(
    { currentVersion: "../../main", targetVersion: "2026.7.1" },
    {
      bypassCache: true,
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response("");
      }
    }
  );

  assert.equal(report.status, "unknown");
  assert.equal(fetchCalls, 0);
});

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" }
  });
}
