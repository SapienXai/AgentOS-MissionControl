import "server-only";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import type {
  OpenClawCommandOptions,
  OpenClawListModelsInput
} from "@/lib/openclaw/client/types";

export function listOpenClawSkills(options: OpenClawCommandOptions & { eligible?: boolean } = {}) {
  return getOpenClawAdapter().listSkills(options);
}

export function listOpenClawPlugins(options: OpenClawCommandOptions = {}) {
  return getOpenClawAdapter().listPlugins(options);
}

export function listOpenClawModels(
  input: OpenClawListModelsInput = {},
  options: OpenClawCommandOptions = {}
) {
  return getOpenClawAdapter().listModels(input, options);
}

export function scanOpenClawModels(options: OpenClawCommandOptions & {
  yes?: boolean;
  noInput?: boolean;
  noProbe?: boolean;
} = {}) {
  return getOpenClawAdapter().scanModels(options);
}
