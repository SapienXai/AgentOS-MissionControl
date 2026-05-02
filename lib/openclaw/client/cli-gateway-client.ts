import "server-only";

import {
  runOpenClaw,
  runOpenClawJson,
  runOpenClawJsonStream
} from "@/lib/openclaw/cli";
import { stringifyCommandFailure } from "@/lib/openclaw/command-failure";
import type {
  AgentPayload,
  GatewayProbePayload,
  GatewayStatusPayload,
  MissionCommandPayload,
  ModelsPayload,
  ModelsStatusPayload,
  OpenClawAddAgentInput,
  OpenClawAgentListPayload,
  OpenClawAgentTurnInput,
  OpenClawCommandOptions,
  OpenClawGatewayClient,
  OpenClawListModelsInput,
  OpenClawListSessionsInput,
  OpenClawModelScanPayload,
  OpenClawPluginListPayload,
  OpenClawSessionsPayload,
  OpenClawSkillListPayload,
  OpenClawStreamCallbacks,
  StatusPayload
} from "@/lib/openclaw/client/types";

function buildAgentTurnArgs(input: OpenClawAgentTurnInput) {
  const args = [
    "agent",
    "--agent",
    input.agentId,
  ];

  if (input.sessionId) {
    args.push("--session-id", input.sessionId);
  }

  args.push(
    "--message",
    input.message,
    "--thinking",
    input.thinking ?? "medium",
    "--timeout",
    String(input.timeoutSeconds ?? 45),
    "--json"
  );

  return args;
}

export class CliOpenClawGatewayClient implements OpenClawGatewayClient {
  getStatus(options: OpenClawCommandOptions = {}) {
    return runOpenClawJson<StatusPayload>(["status", "--json"], options);
  }

  getGatewayStatus(options: OpenClawCommandOptions = {}) {
    return runOpenClawJson<GatewayStatusPayload>(["gateway", "status", "--json"], options);
  }

  getModelStatus(options: OpenClawCommandOptions = {}) {
    return runOpenClawJson<ModelsStatusPayload>(["models", "status", "--json"], options);
  }

  async listAgents(options: OpenClawCommandOptions = {}) {
    const agents = await runOpenClawJson<AgentPayload>(["agents", "list", "--json"], options);

    return {
      agents: agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        identity: {
          name: agent.identityName,
          emoji: agent.identityEmoji
        },
        workspace: agent.workspace,
        model: agent.model ? { primary: agent.model } : undefined
      }))
    } satisfies OpenClawAgentListPayload;
  }

  listSessions(input: OpenClawListSessionsInput = {}, options: OpenClawCommandOptions = {}) {
    return this.call<OpenClawSessionsPayload>("sessions.list", { ...input }, options);
  }

  listSkills(options: OpenClawCommandOptions & { eligible?: boolean } = {}) {
    const args = ["skills", "list"];
    if (options.eligible) {
      args.push("--eligible");
    }
    args.push("--json");
    return runOpenClawJson<OpenClawSkillListPayload>(args, options);
  }

  listPlugins(options: OpenClawCommandOptions = {}) {
    return runOpenClawJson<OpenClawPluginListPayload>(["plugins", "list", "--json"], options);
  }

  listModels(input: OpenClawListModelsInput = {}, options: OpenClawCommandOptions = {}) {
    const args = ["models", "list"];
    if (input.all) {
      args.push("--all");
    }
    args.push("--json");
    if (input.provider) {
      args.push("--provider", input.provider);
    }
    return runOpenClawJson<ModelsPayload>(args, options);
  }

  scanModels(options: OpenClawCommandOptions & { yes?: boolean; noInput?: boolean; noProbe?: boolean } = {}) {
    const args = ["models", "scan", "--json"];
    if (options.yes) {
      args.push("--yes");
    }
    if (options.noInput) {
      args.push("--no-input");
    }
    if (options.noProbe) {
      args.push("--no-probe");
    }
    return runOpenClawJson<OpenClawModelScanPayload>(args, options);
  }

  probeGateway(options: OpenClawCommandOptions = {}) {
    return runOpenClawJson<GatewayProbePayload>(["gateway", "probe", "--json"], options);
  }

  controlGateway(
    action: "start" | "stop" | "restart",
    options: OpenClawCommandOptions = {}
  ) {
    return runOpenClawJson<Record<string, unknown>>(["gateway", action, "--json"], options);
  }

  call<TPayload>(
    method: string,
    params: Record<string, unknown> = {},
    options: OpenClawCommandOptions = {}
  ) {
    return runOpenClawJson<TPayload>(
      ["gateway", "call", method, "--params", JSON.stringify(params), "--json"],
      options
    );
  }

  async getConfig<TPayload>(path: string, options: OpenClawCommandOptions = {}) {
    return runOpenClawJson<TPayload>(["config", "get", path, "--json"], options).catch(() => null);
  }

  async hasConfig(path: string, options: OpenClawCommandOptions = {}) {
    try {
      await runOpenClaw(["config", "get", path, "--json"], options);
      return true;
    } catch (error) {
      const detail = stringifyCommandFailure(error);

      if (detail.includes("Config path not found")) {
        return false;
      }

      throw error;
    }
  }

  setConfig(
    path: string,
    value: unknown,
    options: OpenClawCommandOptions & { strictJson?: boolean } = {}
  ) {
    const args = ["config", "set", path, typeof value === "string" ? value : JSON.stringify(value)];

    if (options.strictJson) {
      args.push("--strict-json");
    }

    return runOpenClaw(args, options);
  }

  unsetConfig(path: string, options: OpenClawCommandOptions = {}) {
    return runOpenClaw(["config", "unset", path], options);
  }

  addAgent(input: OpenClawAddAgentInput, options: OpenClawCommandOptions = {}) {
    const args = [
      "agents",
      "add",
      input.id,
      "--workspace",
      input.workspace,
      "--agent-dir",
      input.agentDir,
      "--non-interactive",
      "--json"
    ];

    if (input.model) {
      args.push("--model", input.model);
    }

    return runOpenClaw(args, options);
  }

  deleteAgent(agentId: string, options: OpenClawCommandOptions = {}) {
    return runOpenClaw(["agents", "delete", agentId, "--force", "--json"], options);
  }

  runAgentTurn(
    input: OpenClawAgentTurnInput,
    options: OpenClawCommandOptions = {}
  ) {
    return runOpenClawJson<MissionCommandPayload>(buildAgentTurnArgs(input), options);
  }

  streamAgentTurn(
    input: OpenClawAgentTurnInput,
    callbacks: OpenClawStreamCallbacks = {},
    options: OpenClawCommandOptions = {}
  ) {
    return runOpenClawJsonStream<MissionCommandPayload>(buildAgentTurnArgs(input), {
      ...options,
      ...callbacks
    });
  }
}
