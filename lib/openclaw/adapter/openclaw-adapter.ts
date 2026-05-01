import "server-only";

import type { CommandResult } from "@/lib/openclaw/cli";
import { getOpenClawGatewayClient } from "@/lib/openclaw/client/gateway-client-factory";
import type {
  GatewayProbePayload,
  GatewayStatusPayload,
  MissionCommandPayload,
  ModelsPayload,
  ModelsStatusPayload,
  OpenClawAddAgentInput,
  OpenClawAgentTurnInput,
  OpenClawCommandOptions,
  OpenClawGatewayClient,
  OpenClawListModelsInput,
  OpenClawModelScanPayload,
  OpenClawPluginListPayload,
  OpenClawSkillListPayload,
  OpenClawStreamCallbacks,
  StatusPayload
} from "@/lib/openclaw/client/gateway-client";

export interface OpenClawAdapter {
  getStatus(options?: OpenClawCommandOptions): Promise<StatusPayload>;
  getGatewayStatus(options?: OpenClawCommandOptions): Promise<GatewayStatusPayload>;
  getModelStatus(options?: OpenClawCommandOptions): Promise<ModelsStatusPayload>;
  listModels(input?: OpenClawListModelsInput, options?: OpenClawCommandOptions): Promise<ModelsPayload>;
  listSkills(options?: OpenClawCommandOptions & { eligible?: boolean }): Promise<OpenClawSkillListPayload>;
  listPlugins(options?: OpenClawCommandOptions): Promise<OpenClawPluginListPayload>;
  scanModels(options?: OpenClawCommandOptions & {
    yes?: boolean;
    noInput?: boolean;
    noProbe?: boolean;
  }): Promise<OpenClawModelScanPayload>;
  getConfig<TPayload>(path: string, options?: OpenClawCommandOptions): Promise<TPayload | null>;
  setConfig(
    path: string,
    value: unknown,
    options?: OpenClawCommandOptions & { strictJson?: boolean }
  ): Promise<CommandResult>;
  unsetConfig(path: string, options?: OpenClawCommandOptions): Promise<CommandResult>;
  addAgent(
    input: OpenClawAddAgentInput,
    options?: OpenClawCommandOptions
  ): Promise<CommandResult>;
  deleteAgent(agentId: string, options?: OpenClawCommandOptions): Promise<CommandResult>;
  runAgentTurn(input: OpenClawAgentTurnInput, options?: OpenClawCommandOptions): Promise<MissionCommandPayload>;
  streamAgentTurn(
    input: OpenClawAgentTurnInput,
    callbacks?: OpenClawStreamCallbacks,
    options?: OpenClawCommandOptions
  ): Promise<MissionCommandPayload>;
  probeGateway(options?: OpenClawCommandOptions): Promise<GatewayProbePayload>;
  controlGateway(
    action: "start" | "stop" | "restart",
    options?: OpenClawCommandOptions
  ): Promise<Record<string, unknown>>;
  call<TPayload>(
    method: string,
    params?: Record<string, unknown>,
    options?: OpenClawCommandOptions
  ): Promise<TPayload>;
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

  listModels(input: OpenClawListModelsInput = {}, options: OpenClawCommandOptions = {}) {
    return this.getClient().listModels(input, options);
  }

  listSkills(options: OpenClawCommandOptions & { eligible?: boolean } = {}) {
    return this.getClient().listSkills(options);
  }

  listPlugins(options: OpenClawCommandOptions = {}) {
    return this.getClient().listPlugins(options);
  }

  scanModels(options: OpenClawCommandOptions & { yes?: boolean; noInput?: boolean; noProbe?: boolean } = {}) {
    return this.getClient().scanModels(options);
  }

  getConfig<TPayload>(path: string, options: OpenClawCommandOptions = {}) {
    return this.getClient().getConfig<TPayload>(path, options);
  }

  setConfig(path: string, value: unknown, options: OpenClawCommandOptions & { strictJson?: boolean } = {}) {
    return this.getClient().setConfig(path, value, options);
  }

  unsetConfig(path: string, options: OpenClawCommandOptions = {}) {
    return this.getClient().unsetConfig(path, options);
  }

  addAgent(input: OpenClawAddAgentInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().addAgent(input, options);
  }

  deleteAgent(agentId: string, options: OpenClawCommandOptions = {}) {
    return this.getClient().deleteAgent(agentId, options);
  }

  runAgentTurn(input: OpenClawAgentTurnInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().runAgentTurn(input, options);
  }

  streamAgentTurn(
    input: OpenClawAgentTurnInput,
    callbacks: OpenClawStreamCallbacks = {},
    options: OpenClawCommandOptions = {}
  ) {
    return this.getClient().streamAgentTurn(input, callbacks, options);
  }

  probeGateway(options: OpenClawCommandOptions = {}) {
    return this.getClient().probeGateway(options);
  }

  controlGateway(action: "start" | "stop" | "restart", options: OpenClawCommandOptions = {}) {
    return this.getClient().controlGateway(action, options);
  }

  call<TPayload>(method: string, params: Record<string, unknown> = {}, options: OpenClawCommandOptions = {}) {
    return this.getClient().call<TPayload>(method, params, options);
  }
}

let defaultAdapter: OpenClawAdapter | null = null;

export function getOpenClawAdapter() {
  if (!defaultAdapter) {
    defaultAdapter = new GatewayBackedOpenClawAdapter();
  }

  return defaultAdapter;
}

export function setOpenClawAdapterForTesting(adapter: OpenClawAdapter | null) {
  defaultAdapter = adapter;
}
