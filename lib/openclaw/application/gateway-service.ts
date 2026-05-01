import "server-only";

import { getOpenClawGatewayClient } from "@/lib/openclaw/client/gateway-client-factory";

export function controlGateway(action: "start" | "stop" | "restart") {
  return getOpenClawGatewayClient().controlGateway(action);
}
