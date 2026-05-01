import "server-only";

import { getOpenClawGatewayClient } from "@/lib/openclaw/client/gateway-client-factory";
import type {
  OpenClawCommandOptions,
  OpenClawListModelsInput
} from "@/lib/openclaw/client/types";

export function listOpenClawSkills(options: OpenClawCommandOptions & { eligible?: boolean } = {}) {
  return getOpenClawGatewayClient().listSkills(options);
}

export function listOpenClawPlugins(options: OpenClawCommandOptions = {}) {
  return getOpenClawGatewayClient().listPlugins(options);
}

export function listOpenClawModels(
  input: OpenClawListModelsInput = {},
  options: OpenClawCommandOptions = {}
) {
  return getOpenClawGatewayClient().listModels(input, options);
}

export function scanOpenClawModels(options: OpenClawCommandOptions & {
  yes?: boolean;
  noInput?: boolean;
  noProbe?: boolean;
} = {}) {
  return getOpenClawGatewayClient().scanModels(options);
}
