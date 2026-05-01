import "server-only";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import type {
  GatewayStatusPayload,
  ModelsStatusPayload,
  StatusPayload
} from "@/lib/openclaw/client/gateway-client";
import type { OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";

export async function settleStatusPayloadFromOpenClaw(
  timeoutMs = 20_000,
  adapter: OpenClawAdapter = getOpenClawAdapter()
): Promise<PromiseSettledResult<StatusPayload>> {
  try {
    const value = await adapter.getStatus({ timeoutMs });

    return {
      status: "fulfilled",
      value
    };
  } catch (error) {
    return {
      status: "rejected",
      reason: error
    };
  }
}

export async function settleGatewayStatusPayloadFromOpenClaw(
  timeoutMs = 20_000,
  adapter: OpenClawAdapter = getOpenClawAdapter()
): Promise<PromiseSettledResult<GatewayStatusPayload>> {
  try {
    const value = await adapter.getGatewayStatus({ timeoutMs });

    return {
      status: "fulfilled",
      value
    };
  } catch (error) {
    return {
      status: "rejected",
      reason: error
    };
  }
}

export async function settleModelStatusPayloadFromOpenClaw(
  timeoutMs = 20_000,
  adapter: OpenClawAdapter = getOpenClawAdapter()
): Promise<PromiseSettledResult<ModelsStatusPayload>> {
  try {
    const value = await adapter.getModelStatus({ timeoutMs });

    return {
      status: "fulfilled",
      value
    };
  } catch (error) {
    return {
      status: "rejected",
      reason: error
    };
  }
}
