import type {
  AgentFileAccess,
  AgentInstallScope,
  AgentMissingToolBehavior,
  AgentNetworkAccess,
  AgentPolicy,
  AgentPreset
} from "@/lib/openclaw/types";

type Option<T extends string> = {
  value: T;
  label: string;
  description: string;
};

type PresetMeta = {
  label: string;
  description: string;
  defaultName: string;
  defaultEmoji: string;
  defaultTheme: string;
  badgeVariant: "default" | "muted" | "success" | "warning";
  tools: string[];
  skills: string[];
};

export const DEFAULT_AGENT_PRESET: AgentPreset = "worker";

const PRESET_META: Record<AgentPreset, PresetMeta> = {
  worker: {
    label: "Worker",
    description: "Default execution agent for code changes, docs, research, and review work. Best when the task stays inside the workspace and does not need system-level changes.",
    defaultName: "Worker",
    defaultEmoji: "🛠️",
    defaultTheme: "slate",
    badgeVariant: "default",
    tools: ["exec", "read", "write", "edit", "apply_patch"],
    skills: ["Builder", "Reviewer", "Tester"]
  },
  setup: {
    label: "Setup / Operator",
    description: "Bootstraps environments, handles installs, and unblocks the workspace so other agents can move faster.",
    defaultName: "Setup Operator",
    defaultEmoji: "🧰",
    defaultTheme: "amber",
    badgeVariant: "warning",
    tools: ["exec", "process", "gateway", "read", "write"],
    skills: ["Builder", "Ops", "Learner"]
  },
  browser: {
    label: "Browser",
    description: "Captures browser evidence, screenshots, and user-path validation for UI-heavy work.",
    defaultName: "Browser Agent",
    defaultEmoji: "🌐",
    defaultTheme: "blue",
    badgeVariant: "success",
    tools: ["browser", "web_search", "web_fetch", "image"],
    skills: ["Browser", "Tester", "Researcher"]
  },
  monitoring: {
    label: "Monitoring",
    description: "Runs on a watch cycle, checks health and drift, and leaves concise triage handoffs.",
    defaultName: "Monitoring Agent",
    defaultEmoji: "🛰️",
    defaultTheme: "teal",
    badgeVariant: "warning",
    tools: ["cron", "gateway", "sessions_list", "message", "web_fetch"],
    skills: ["Analyst", "Reviewer", "Learner"]
  },
  custom: {
    label: "Custom",
    description: "Starts from the safe baseline and lets you fine-tune identity, policy, and operating style by hand.",
    defaultName: "Custom Agent",
    defaultEmoji: "🧩",
    defaultTheme: "violet",
    badgeVariant: "muted",
    tools: ["exec", "read", "edit", "message"],
    skills: ["Researcher", "Builder", "Analyst"]
  }
};

const DEFAULT_POLICY_BY_PRESET: Record<AgentPreset, Omit<AgentPolicy, "preset">> = {
  worker: {
    missingToolBehavior: "fallback",
    installScope: "none",
    fileAccess: "workspace-only",
    networkAccess: "enabled"
  },
  setup: {
    missingToolBehavior: "allow-install",
    installScope: "workspace",
    fileAccess: "workspace-only",
    networkAccess: "enabled"
  },
  browser: {
    missingToolBehavior: "ask-setup",
    installScope: "none",
    fileAccess: "workspace-only",
    networkAccess: "enabled"
  },
  monitoring: {
    missingToolBehavior: "fallback",
    installScope: "none",
    fileAccess: "workspace-only",
    networkAccess: "enabled"
  },
  custom: {
    missingToolBehavior: "fallback",
    installScope: "none",
    fileAccess: "workspace-only",
    networkAccess: "enabled"
  }
};

export const AGENT_PRESET_OPTIONS: Array<Option<AgentPreset>> = (
  Object.entries(PRESET_META) as Array<[AgentPreset, PresetMeta]>
).map(([value, meta]) => ({
  value,
  label: meta.label,
  description: meta.description
}));

export const AGENT_MISSING_TOOL_BEHAVIOR_OPTIONS: Array<Option<AgentMissingToolBehavior>> = [
  {
    value: "fallback",
    label: "Fallback",
    description: "Produce the nearest viable output format instead of failing the task."
  },
  {
    value: "ask-setup",
    label: "Ask for setup",
    description: "Stop before environment changes and report the missing capability clearly."
  },
  {
    value: "route-setup",
    label: "Route to setup agent",
    description: "Leave an explicit setup handoff instead of attempting installs directly."
  },
  {
    value: "allow-install",
    label: "Allow install",
    description: "Install missing tooling when policy allows it and the task truly depends on it."
  }
];

export const AGENT_INSTALL_SCOPE_OPTIONS: Array<Option<AgentInstallScope>> = [
  {
    value: "none",
    label: "None",
    description: "Do not install workspace or system dependencies."
  },
  {
    value: "workspace",
    label: "Workspace only",
    description: "Only install dependencies inside the project or workspace environment."
  },
  {
    value: "system",
    label: "System",
    description: "Permit system-wide installs when they are necessary and intentional."
  }
];

export const AGENT_FILE_ACCESS_OPTIONS: Array<Option<AgentFileAccess>> = [
  {
    value: "workspace-only",
    label: "Workspace only",
    description: "Keep file work grounded inside the attached workspace."
  },
  {
    value: "extended",
    label: "Extended",
    description: "Allow broader file access when the task explicitly needs it."
  }
];

export const AGENT_NETWORK_ACCESS_OPTIONS: Array<Option<AgentNetworkAccess>> = [
  {
    value: "restricted",
    label: "Off",
    description: "Avoid network access unless the task explicitly depends on it."
  },
  {
    value: "enabled",
    label: "On",
    description: "Use network access when the task needs external information or downloads."
  }
];

export function getAgentPresetMeta(preset: AgentPreset) {
  return PRESET_META[preset];
}

export function resolveAgentPolicy(
  preset: AgentPreset = DEFAULT_AGENT_PRESET,
  overrides?: Partial<AgentPolicy> | null
): AgentPolicy {
  const resolvedOverrides = overrides ?? {};

  return {
    ...DEFAULT_POLICY_BY_PRESET[preset],
    ...resolvedOverrides,
    preset
  };
}

export function inferAgentPresetFromContext(params: {
  skills?: string[];
  id?: string;
  name?: string;
}): AgentPreset {
  const combined = [
    ...(params.skills ?? []),
    params.id ?? "",
    params.name ?? ""
  ]
    .join(" ")
    .toLowerCase();

  if (/browser|playwright|screenshot|web/.test(combined)) {
    return "browser";
  }

  if (/monitor|heartbeat|watch|triage|observer/.test(combined)) {
    return "monitoring";
  }

  if (/setup|operator|ops|install|environment/.test(combined)) {
    return "setup";
  }

  if (/custom/.test(combined)) {
    return "custom";
  }

  return DEFAULT_AGENT_PRESET;
}

export function isAgentPreset(value: unknown): value is AgentPreset {
  return value === "worker" || value === "setup" || value === "browser" || value === "monitoring" || value === "custom";
}

export function isAgentMissingToolBehavior(value: unknown): value is AgentMissingToolBehavior {
  return value === "fallback" || value === "ask-setup" || value === "route-setup" || value === "allow-install";
}

export function isAgentInstallScope(value: unknown): value is AgentInstallScope {
  return value === "none" || value === "workspace" || value === "system";
}

export function isAgentFileAccess(value: unknown): value is AgentFileAccess {
  return value === "workspace-only" || value === "extended";
}

export function isAgentNetworkAccess(value: unknown): value is AgentNetworkAccess {
  return value === "restricted" || value === "enabled";
}

export function formatAgentPresetLabel(value: AgentPreset) {
  return PRESET_META[value].label;
}

export function formatCapabilityLabel(value: string) {
  if (value === "fs.workspaceOnly") {
    return "Workspace only";
  }

  return value
    .replace(/^agent-policy-/, "")
    .replace(/^project-/, "")
    .replace(/[._-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function formatAgentMissingToolBehaviorLabel(value: AgentMissingToolBehavior) {
  return AGENT_MISSING_TOOL_BEHAVIOR_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function formatAgentInstallScopeLabel(value: AgentInstallScope) {
  return AGENT_INSTALL_SCOPE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function formatAgentFileAccessLabel(value: AgentFileAccess) {
  return AGENT_FILE_ACCESS_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function formatAgentNetworkAccessLabel(value: AgentNetworkAccess) {
  return AGENT_NETWORK_ACCESS_OPTIONS.find((option) => option.value === value)?.label ?? value;
}
