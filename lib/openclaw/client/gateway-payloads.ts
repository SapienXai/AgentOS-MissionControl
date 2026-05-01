import "server-only";

import { getOpenClawGatewayClient } from "@/lib/openclaw/client/gateway-client-factory";
import type {
  GatewayStatusPayload,
  ModelsStatusPayload,
  OpenClawGatewayClient,
  StatusPayload
} from "@/lib/openclaw/client/gateway-client";

export async function settleStatusPayloadFromOpenClaw(
  timeoutMs = 20_000,
  client: OpenClawGatewayClient = getOpenClawGatewayClient()
): Promise<PromiseSettledResult<StatusPayload>> {
  try {
    const value = await client.getStatus({
      timeoutMs
    });

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
  client: OpenClawGatewayClient = getOpenClawGatewayClient()
): Promise<PromiseSettledResult<GatewayStatusPayload>> {
  try {
    const value = await client.getGatewayStatus({
      timeoutMs
    });

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
  client: OpenClawGatewayClient = getOpenClawGatewayClient()
): Promise<PromiseSettledResult<ModelsStatusPayload>> {
  try {
    const value = await client.getModelStatus({
      timeoutMs
    });

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
