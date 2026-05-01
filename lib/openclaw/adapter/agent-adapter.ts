import path from "node:path";

import type {
  AgentConfigPayload,
  AgentPayload
} from "@/lib/openclaw/client/gateway-client";
import { normalizeOptionalValue } from "@/lib/openclaw/domains/control-plane-normalization";

export function buildAgentPayloadsFromConfig(
  agentConfig: AgentConfigPayload,
  openClawStateRootPath: string
): AgentPayload {
  return agentConfig.map((entry) => ({
    id: entry.id,
    name: entry.name || entry.identity?.name || entry.id,
    identityName: entry.identity?.name,
    identityEmoji: entry.identity?.emoji,
    identitySource: entry.identity ? "config" : undefined,
    workspace: normalizeOptionalValue(entry.workspace) ?? "",
    agentDir: entry.agentDir || path.join(openClawStateRootPath, "agents", entry.id, "agent"),
    model: entry.model,
    isDefault: Boolean(entry.default)
  }));
}
