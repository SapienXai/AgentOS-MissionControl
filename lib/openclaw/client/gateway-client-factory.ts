import "server-only";

import { CliOpenClawGatewayClient } from "@/lib/openclaw/client/cli-gateway-client";
import {
  isCliGatewayClientForcedByEnv,
  NativeWsOpenClawGatewayClient
} from "@/lib/openclaw/client/native-ws-gateway-client";
import type { OpenClawGatewayClient } from "@/lib/openclaw/client/types";

let defaultClient: OpenClawGatewayClient | null = null;

function createDefaultOpenClawGatewayClient() {
  const cliClient = new CliOpenClawGatewayClient();

  if (isCliGatewayClientForcedByEnv()) {
    return cliClient;
  }

  return new NativeWsOpenClawGatewayClient({
    fallback: cliClient
  });
}

export function getOpenClawGatewayClient() {
  if (!defaultClient) {
    defaultClient = createDefaultOpenClawGatewayClient();
  }

  return defaultClient;
}

export function setOpenClawGatewayClientForTesting(client: OpenClawGatewayClient | null) {
  defaultClient = client;
}
