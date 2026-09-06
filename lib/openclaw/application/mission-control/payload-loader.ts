import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { buildAgentPayloadsFromGatewayList } from "@/lib/openclaw/adapter/agent-adapter";
import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import type {
  AgentConfigPayload,
  AgentPayload
} from "@/lib/openclaw/client/gateway-client";
import { normalizeOptionalValue } from "@/lib/openclaw/domains/control-plane-normalization";
import {
  settleSessionsPayloadFromSessionCatalogs,
  type SessionsPayload
} from "@/lib/openclaw/domains/session-catalog";
import { getOpenClawStateRootPath } from "@/lib/openclaw/state/paths";

const gatewayRemoteUrlConfigKey = "gateway.remote.url";

export async function readGatewayRemoteUrlConfig(): Promise<PromiseSettledResult<unknown>> {
  try {
    const stateRoot = getOpenClawStateRootPath();
    const rawConfig = await readFile(path.join(stateRoot, "openclaw.json"), "utf8");
    const config = JSON.parse(rawConfig) as unknown;

    return {
      status: "fulfilled",
      value: readNestedConfigValue(config, gatewayRemoteUrlConfigKey) ?? undefined
    };
  } catch (reason) {
    const code = typeof reason === "object" && reason && "code" in reason ? reason.code : undefined;

    if (code === "ENOENT") {
      return {
        status: "fulfilled",
        value: undefined
      };
    }

    return {
      status: "rejected",
      reason
    };
  }
}

export async function settleAgentPayloadFromOpenClaw(
  agentConfig: AgentConfigPayload
): Promise<PromiseSettledResult<AgentPayload>> {
  try {
    const payload = await getOpenClawAdapter().listAgents({ timeoutMs: 15_000 });

    return {
      status: "fulfilled",
      value: buildAgentPayloadsFromGatewayList(payload, agentConfig, getOpenClawStateRootPath())
    };
  } catch (reason) {
    return {
      status: "rejected",
      reason
    };
  }
}

export async function settleSessionsPayloadFromOpenClaw(
  agentConfig: AgentConfigPayload
): Promise<PromiseSettledResult<SessionsPayload>> {
  try {
    const payload = await getOpenClawAdapter().listSessions({
      limit: 500,
      includeGlobal: false,
      includeUnknown: false
    }, { timeoutMs: 15_000 });

    if (!payload || !Array.isArray(payload.sessions)) {
      throw new Error("OpenClaw Gateway sessions.list returned an invalid payload.");
    }

    return {
      status: "fulfilled",
      value: {
        sessions: (payload.sessions as SessionsPayload["sessions"]).map(annotateGatewaySessionAgent)
      }
    };
  } catch {
    return settleSessionsPayloadFromSessionCatalogs(agentConfig, getOpenClawStateRootPath());
  }
}

/** Gateway sessions.list commonly encodes the owner only in `agent:<id>:…` keys. */
export function annotateGatewaySessionAgent(session: SessionsPayload["sessions"][number]) {
  if (session.agentId) return session;
  const key = typeof session.key === "string" ? session.key : "";
  const match = key.match(/^agent:([^:]+):/);
  return match?.[1] ? { ...session, agentId: match[1] } : session;
}

export function normalizeGatewayRemoteUrlConfigValue(value: unknown) {
  if (typeof value === "string") {
    return normalizeOptionalValue(value);
  }

  if (value && typeof value === "object" && "value" in value && typeof value.value === "string") {
    return normalizeOptionalValue(value.value);
  }

  return undefined;
}

function readNestedConfigValue(source: unknown, path: string) {
  let current = source;

  for (const segment of path.split(".")) {
    if (!isRecord(current) || !Object.hasOwn(current, segment)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
