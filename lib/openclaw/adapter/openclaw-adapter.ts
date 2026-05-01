import "server-only";

import { getOpenClawGatewayClient } from "@/lib/openclaw/client/gateway-client-factory";
import type {
  GatewayStatusPayload,
  ModelsStatusPayload,
  OpenClawCommandOptions,
  OpenClawGatewayClient,
  StatusPayload
} from "@/lib/openclaw/client/gateway-client";

export interface OpenClawAdapter {
  getStatus(options?: OpenClawCommandOptions): Promise<StatusPayload>;
  getGatewayStatus(options?: OpenClawCommandOptions): Promise<GatewayStatusPayload>;
  getModelStatus(options?: OpenClawCommandOptions): Promise<ModelsStatusPayload>;
  controlGateway(
    action: "start" | "stop" | "restart",
    options?: OpenClawCommandOptions
  ): Promise<Record<string, unknown>>;
}

export class GatewayBackedOpenClawAdapter implements OpenClawAdapter {
  constructor(private readonly getClient: () => OpenClawGatewayClient = getOpenClawGatewayClient) {}

  getStatus(options: OpenClawCommandOptions = {}) {
    return this.getClient().getStatus(options);
  }

  getGatewayStatus(options: OpenClawCommandOptions = {}) {
    return this.getClient().getGatewayStatus(options);
  }

  getModelStatus(options: OpenClawCommandOptions = {}) {
    return this.getClient().getModelStatus(options);
  }

  controlGateway(action: "start" | "stop" | "restart", options: OpenClawCommandOptions = {}) {
    return this.getClient().controlGateway(action, options);
  }
}

let defaultAdapter: OpenClawAdapter | null = null;

export function getOpenClawAdapter() {
  defaultAdapter ??= new GatewayBackedOpenClawAdapter();
  return defaultAdapter;
}

export function setOpenClawAdapterForTesting(adapter: OpenClawAdapter | null) {
  defaultAdapter = adapter;
}
