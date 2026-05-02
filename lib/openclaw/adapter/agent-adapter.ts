import path from "node:path";

import type {
  AgentConfigPayload,
  AgentPayload,
  OpenClawAgentListPayload
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

export function buildAgentPayloadsFromGatewayList(
  gatewayPayload: OpenClawAgentListPayload,
  agentConfig: AgentConfigPayload,
  openClawStateRootPath: string
): AgentPayload {
  const configByAgent = new Map(agentConfig.map((entry) => [entry.id, entry]));

  return gatewayPayload.agents.map((entry) => {
    const configured = configByAgent.get(entry.id);
    const identity = entry.identity ?? configured?.identity;
    const workspace = normalizeOptionalValue(entry.workspace) ?? normalizeOptionalValue(configured?.workspace) ?? "";
    const model = entry.model?.primary ?? configured?.model;

    return {
      id: entry.id,
      name: entry.name || identity?.name || configured?.name || entry.id,
      identityName: identity?.name,
      identityEmoji: identity?.emoji,
      identitySource: entry.identity ? "gateway" : configured?.identity ? "config" : undefined,
      workspace,
      agentDir: configured?.agentDir || path.join(openClawStateRootPath, "agents", entry.id, "agent"),
      model,
      isDefault: entry.id === gatewayPayload.defaultId || Boolean(configured?.default)
    };
  });
}
