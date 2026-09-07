import "server-only";

import type { GatewayClientName } from "@openclaw/gateway-protocol/client-info";
import {
  readAgentOsGatewayAuthCredentialSync,
  type AgentOsGatewayAuthCredential
} from "@/lib/agentos/runtime-auth";
import { CliOpenClawGatewayClient } from "@/lib/openclaw/client/cli-gateway-client";
import { resolveOpenClawStateDir } from "@/lib/openclaw/client/gateway-state";
import {
  createOfficialBackedOpenClawGatewayClient,
  type OfficialBackedOpenClawGatewayClientOptions
} from "@/lib/openclaw/client/official-gateway-factory";
import { isCliGatewayClientForcedByEnv, resolveGatewayUrl } from "@/lib/openclaw/client/native-ws-gateway-policy";
import type { OpenClawGatewayClient } from "@/lib/openclaw/client/types";

let defaultClient: OpenClawGatewayClient | null = null;
let configuredProvider: OpenClawGatewayClientProvider | null = null;

export type OpenClawGatewayClientProvider = () => OpenClawGatewayClient;

export type OpenClawGatewayClientFactoryOptions = Omit<
  OfficialBackedOpenClawGatewayClientOptions,
  "clientName" | "url"
> & {
  url?: string | null;
  clientName?: string;
};

export function createOpenClawGatewayClient(
  options: OpenClawGatewayClientFactoryOptions = {}
) {
  const cliClient = options.fallback ?? new CliOpenClawGatewayClient();
  const forceCli = options.forceCli || isCliGatewayClientForcedByEnv();

  const commonOptions = {
    fallback: cliClient,
    url: options.url ?? resolveGatewayUrl()
  } as const;

  return createOfficialBackedOpenClawGatewayClient({
    ...options,
    ...commonOptions,
    forceCli,
    token: options.token !== undefined
      ? options.token
      : resolveGatewayCredential("token", "AGENTOS_OPENCLAW_GATEWAY_TOKEN", "OPENCLAW_GATEWAY_TOKEN"),
    password: options.password !== undefined
      ? options.password
      : resolveGatewayCredential("password", "AGENTOS_OPENCLAW_GATEWAY_PASSWORD", "OPENCLAW_GATEWAY_PASSWORD"),
    stateDir: options.stateDir ?? resolveOpenClawStateDir(),
    sharedStateMode: options.sharedStateMode ?? "managed-write",
    clientName: options.clientName as GatewayClientName | undefined,
  } as OfficialBackedOpenClawGatewayClientOptions);
}

function createDefaultOpenClawGatewayClient() {
  if (isCliGatewayClientForcedByEnv()) {
    return new CliOpenClawGatewayClient();
  }

  return createOpenClawGatewayClient();
}

function resolveGatewayCredential(
  kind: AgentOsGatewayAuthCredential["kind"],
  ...names: string[]
) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }

  const persisted = readAgentOsGatewayAuthCredentialSync();
  return persisted?.kind === kind ? persisted.value : null;
}

export function getOpenClawGatewayClient() {
  if (!defaultClient) {
    defaultClient = (configuredProvider ?? createDefaultOpenClawGatewayClient)();
  }

  return defaultClient;
}

export function resetOpenClawGatewayClient(reason = "reset") {
  const client = defaultClient;
  defaultClient = null;

  try {
    client?.close?.(reason);
  } catch {
    // Best-effort cleanup; the next request will create a fresh client.
  }
}

export function setOpenClawGatewayClientProvider(provider: OpenClawGatewayClientProvider | null) {
  resetOpenClawGatewayClient("provider changed");
  configuredProvider = provider;
}

export function setOpenClawGatewayClientForTesting(client: OpenClawGatewayClient | null) {
  resetOpenClawGatewayClient("testing client changed");
  defaultClient = client;
}
