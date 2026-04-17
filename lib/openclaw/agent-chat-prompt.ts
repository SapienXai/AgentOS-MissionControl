import { formatAgentPresetLabel } from "@/lib/openclaw/agent-presets";
import { MISSION_CONTROL_ACTION_TAG } from "@/lib/openclaw/chat-actions";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import type { MissionControlSnapshot, OpenClawAgent } from "@/lib/openclaw/types";

export type AgentChatHistoryEntry = {
  role: "user" | "assistant";
  text: string;
};

export type AgentChatPromptOptions = {
  agentName: string;
  agentDir?: string;
  workspacePath?: string;
  workspaceTeamPrompt?: string | null;
  workspaceSurfacePrompt?: string | null;
};

export function buildWorkspaceTeamPrompt(snapshot: MissionControlSnapshot, agent: OpenClawAgent) {
  const teammates = snapshot.agents
    .filter((entry) => entry.workspaceId === agent.workspaceId)
    .sort((left, right) => {
      if (left.id === agent.id && right.id !== agent.id) {
        return -1;
      }

      if (right.id === agent.id && left.id !== agent.id) {
        return 1;
      }

      if (left.isDefault !== right.isDefault) {
        return left.isDefault ? -1 : 1;
      }

      return formatAgentDisplayName(left).localeCompare(formatAgentDisplayName(right));
    });

  if (teammates.length === 0) {
    return null;
  }

  const lines = [
    "Workspace team roster:",
    "Use this roster, not `agents_list`, when the operator asks who else is in the workspace. That tool may be restricted to your own scope.",
    "If prior chat messages in this drawer claimed you were the only agent, ignore that older claim if it conflicts with this roster."
  ];

  for (const teammate of teammates) {
    const labels = [
      teammate.id === agent.id ? "you" : null,
      teammate.isDefault ? "primary" : null,
      formatAgentPresetLabel(teammate.policy.preset)
    ].filter(Boolean);

    lines.push(`- ${formatAgentDisplayName(teammate)} (\`${teammate.id}\`) · ${labels.join(" · ")}.`);
  }

  return lines.join("\n");
}

export function buildAgentChatPrompt(
  history: readonly AgentChatHistoryEntry[],
  message: string,
  options: AgentChatPromptOptions
) {
  const turns = history
    .filter((entry) => entry.role === "user" || entry.role === "assistant")
    .slice(-8)
    .map((entry) => `${entry.role === "user" ? "Operator" : "Agent"}: ${entry.text.trim()}`)
    .join("\n");

  const trimmed = message.trim();
  const instructions = [
    "You are chatting directly with the operator inside AgentOS. Reply conversationally, be concise, and ask a clarifying question when needed. Do not create tasks or mention task cards."
  ];

  if (options.agentDir) {
    instructions.push(
      `Your agent-specific identity file is ${options.agentDir}/IDENTITY.md. If the operator renames you or asks about your identity file, use that path.`
    );
  }

  if (options.workspacePath) {
    instructions.push(
      `Do not treat ${options.workspacePath}/IDENTITY.md as your personal identity file unless the operator explicitly asks for a workspace-wide identity change.`
    );
    instructions.push(
      `Do not update ${options.workspacePath}/MEMORY.md for a self-rename unless the operator explicitly asks to store that as workspace memory.`
    );
  }

  instructions.push(
    `AgentOS applies self-renames through a structured action, not by having you edit files yourself. If the operator asks to rename you or set your display name, reply normally and append exactly one action block on its own line using this format: <${MISSION_CONTROL_ACTION_TAG}>{"type":"rename_agent","name":"New Name"}</${MISSION_CONTROL_ACTION_TAG}>.`
  );
  instructions.push(
    "Only emit that action block for an actual rename request. Do not emit it for questions about your current name, hypothetical questions about rename mechanics, or identity discussions that do not request a change."
  );

  if (options.agentDir) {
    instructions.push(
      `If the operator asks which path would be updated, explain that AgentOS applies the rename centrally and then syncs ${options.agentDir}/IDENTITY.md.`
    );
  }

  if (options.workspaceTeamPrompt) {
    instructions.push(options.workspaceTeamPrompt);
  }

  if (options.workspaceSurfacePrompt) {
    instructions.push(options.workspaceSurfacePrompt);
  }

  instructions.push(`Your current display name in AgentOS is ${options.agentName}.`);
  const prefix = `${instructions.join("\n")}\n`;

  return turns
    ? `${prefix}\nConversation so far:\n${turns}\n\nOperator: ${trimmed}`
    : `${prefix}\nOperator: ${trimmed}`;
}

export function normalizeAgentChatHistory(history: readonly AgentChatHistoryEntry[]) {
  return history.map((entry) => ({
    role: entry.role,
    text: entry.text
  }));
}
