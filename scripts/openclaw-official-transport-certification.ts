import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_OPERATOR_SCOPES,
  NativeGatewayRequestError,
  OfficialOpenClawGatewayTransport
} from "@/lib/openclaw/client/gateway-client";
import type { HelloOk } from "@openclaw/gateway-protocol/frame-guards";
import { normalizeClientError } from "@/lib/openclaw/client/native-ws-gateway-errors";
import { redactGatewayUrl } from "@/lib/openclaw/compat/targets";
import { OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT } from "@/lib/openclaw/identity/contract";
import { OPENCLAW_NATIVE_CONTRACT_VERSION } from "@/lib/openclaw/versions";

const TARGET_VERSION = process.env.OPENCLAW_OFFICIAL_CERT_TARGET?.trim() || OPENCLAW_NATIVE_CONTRACT_VERSION;
const TARGET_COMMIT = process.env.OPENCLAW_OFFICIAL_CERT_TARGET_COMMIT?.trim() ||
  OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT;
const GATEWAY_URL = process.env.OPENCLAW_OFFICIAL_CERT_GATEWAY_URL?.trim() || "ws://127.0.0.1:18789";
const TOKEN = process.env.OPENCLAW_OFFICIAL_CERT_TOKEN?.trim() || null;
const STATE_DIR = process.env.OPENCLAW_OFFICIAL_CERT_STATE_DIR?.trim();
const OUTPUT_PATH = process.env.OPENCLAW_OFFICIAL_CERT_OUTPUT?.trim() ||
  path.resolve(`docs/evidence/openclaw-${TARGET_VERSION}-official-transport-certification.json`);
const REQUEST_TIMEOUT_MS = 8_000;

async function main() {
  if (!TOKEN) {
    throw new Error("Official Gateway transport certification requires OPENCLAW_OFFICIAL_CERT_TOKEN.");
  }

  const events: string[] = [];
  const gaps: Array<{ expected: number; received: number }> = [];
  let hello: HelloOk | null = null;
  const client = new OfficialOpenClawGatewayTransport({
    url: GATEWAY_URL,
    token: TOKEN,
    scopes: [...DEFAULT_OPERATOR_SCOPES],
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
    stateDir: STATE_DIR,
    sharedStateMode: "read-only",
    callbacks: {
      onHello: (value) => { hello = value; },
      onEvent: (event) => { events.push(event.event); },
      onGap: (gap) => { gaps.push(gap); }
    }
  });
  const results: Record<string, Awaited<ReturnType<typeof requestProbe>>> = {};
  let denial: Awaited<ReturnType<typeof requestProbe>> | null = null;
  const startedAt = new Date().toISOString();

  try {
    client.start();
    await waitFor(() => hello !== null, 10_000);
    for (const [label, method, params] of [
      ["health", "health", {}],
      ["status", "status", {}],
      ["models.list", "models.list", {}],
      ["agents.list", "agents.list", {}],
      ["sessions.list", "sessions.list", { limit: 1 }],
      ["tasks.list", "tasks.list", { limit: 1 }],
      ["channels.status", "channels.status", {}],
      ["config.get", "config.get", {}]
    ] as const) {
      results[label] = await requestProbe(client, method, params);
    }

    const readClient = new OfficialOpenClawGatewayTransport({
      url: GATEWAY_URL,
      token: TOKEN,
      scopes: ["operator.read"],
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
      stateDir: STATE_DIR,
      sharedStateMode: "read-only"
    });
    try {
      readClient.start();
      await waitFor(() => readClient.getHandshake() !== null, 10_000);
      denial = await requestProbe(readClient, "config.patch", {});
    } finally {
      await readClient.stopAndWait({ timeoutMs: 1_000 });
    }
  } finally {
    await client.stopAndWait({ timeoutMs: 1_000 });
  }

  const handshake = hello as unknown as HelloOk;
  const report = {
    certification: "official-gateway-transport",
    target: {
      version: TARGET_VERSION,
      sourceCommit: TARGET_COMMIT,
      protocol: handshake.protocol,
      gatewayUrl: redactGatewayUrl(GATEWAY_URL) ?? "[redacted]"
    },
    identity: {
      clientName: client.getConnectionMetadata().clientName ?? null,
      mode: client.getConnectionMetadata().mode ?? null,
      hasDeviceIdentity: client.getConnectionMetadata().hasDeviceIdentity
    },
    handshake: {
      serverVersion: handshake.server.version,
      connectionId: handshake.server.connId,
      grantedRole: handshake.auth.role,
      grantedScopes: handshake.auth.scopes
    },
    requests: results,
    authorizationDenial: denial ? {
      status: denial.status,
      kind: denial.kind,
      message: denial.message
    } : null,
    eventCount: events.length,
    sequenceGaps: gaps,
    startedAt,
    completedAt: new Date().toISOString()
  };
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    target: report.target,
    protocol: report.handshake?.serverVersion ? report.target.protocol : null,
    passedRequests: Object.values(results).filter((result) => result.status === "passed").length,
    totalRequests: Object.keys(results).length,
    authorizationDenial: report.authorizationDenial,
    output: OUTPUT_PATH
  })}\n`);

  const requiredFailures = Object.entries(results).filter(([, result]) => result.status !== "passed");
  if (requiredFailures.length || denial?.status !== "denied") {
    throw new Error("Official Gateway transport certification did not satisfy all required probes.");
  }
}

async function requestProbe(
  client: OfficialOpenClawGatewayTransport,
  method: string,
  params: unknown
) {
  try {
    await client.request(method, params, { timeoutMs: REQUEST_TIMEOUT_MS });
    return { status: "passed" as const, kind: null, message: null };
  } catch (error) {
    const normalized = normalizeClientError(error);
    return {
      status: method === "config.patch" && error instanceof NativeGatewayRequestError
        ? "denied" as const
        : "failed" as const,
      kind: normalized.kind,
      message: normalized.message
    };
  }
}

async function waitFor(predicate: () => boolean, timeoutMs: number) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for the official Gateway handshake.");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
