import "server-only";

import path from "node:path";
import { readFile } from "node:fs/promises";

import type { AgentConfigPayload } from "@/lib/openclaw/client/gateway-client";

export async function settleAgentConfigFromStateFile(
  openClawStateRootPath: string
): Promise<PromiseSettledResult<AgentConfigPayload>> {
  try {
    const raw = await readFile(path.join(openClawStateRootPath, "openclaw.json"), "utf8");
    const parsed = JSON.parse(raw) as {
      agents?: {
        list?: unknown;
      };
    };
    const list = parsed.agents?.list;

    return {
      status: "fulfilled",
      value: Array.isArray(list) ? (list as AgentConfigPayload) : []
    };
  } catch (error) {
    return {
      status: "rejected",
      reason: error
    };
  }
}
