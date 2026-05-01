import "server-only";

import { CliOpenClawGatewayClient } from "@/lib/openclaw/client/cli-gateway-client";
import type { OpenClawGatewayClient } from "@/lib/openclaw/client/types";

let defaultClient: OpenClawGatewayClient | null = null;

export function getOpenClawGatewayClient() {
  defaultClient ??= new CliOpenClawGatewayClient();
  return defaultClient;
}

export function setOpenClawGatewayClientForTesting(client: OpenClawGatewayClient | null) {
  defaultClient = client;
}
