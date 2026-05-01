import "server-only";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";

export function controlGateway(action: "start" | "stop" | "restart") {
  return getOpenClawAdapter().controlGateway(action);
}
