export function isStaleAgentChatContextRecoveryText(text: string) {
  const lowerText = text.toLowerCase();

  return (
    (lowerText.includes("couldn't recover") || lowerText.includes("couldn’t recover")) &&
    lowerText.includes("prior") &&
    lowerText.includes("context")
  ) || (
    lowerText.includes("no prior transcript") &&
    lowerText.includes("memory")
  ) || (
    lowerText.includes("send me") &&
    lowerText.includes("last goal") &&
    lowerText.includes("file")
  ) || (
    lowerText.includes("can't continue") &&
    lowerText.includes("recoverable task context")
  ) || (
    lowerText.includes("can’t continue") &&
    lowerText.includes("recoverable task context")
  ) || (
    lowerText.includes("checked") &&
    lowerText.includes("workspace files") &&
    lowerText.includes("recent session metadata")
  ) || (
    lowerText.includes("task state") &&
    lowerText.includes("resume")
  ) || (
    lowerText.includes("failed attempt") &&
    lowerText.includes("last task") &&
    lowerText.includes("error")
  ) || (
    lowerText.includes("workspace") &&
    lowerText.includes("memory") &&
    lowerText.includes("session metadata") &&
    (lowerText.includes("resume") || lowerText.includes("continue"))
  );
}

export function isDirectAgentIdentityQuestion(message: string) {
  const lowerText = message.toLowerCase();

  return (
    /\b(name|ad[ıi]n|ismin|called)\b/.test(lowerText) &&
    /\b(age|old|ya[sş][ıi]n|kaç yaş)\b/.test(lowerText)
  ) || (
    /\b(who are you|kimsin)\b/.test(lowerText)
  );
}

export function buildDirectAgentIdentityReply(agentName: string) {
  return `My name is ${agentName}. I do not have a real age; I am an AI agent running inside AgentOS.`;
}
