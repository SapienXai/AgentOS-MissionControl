import type {
  AgentFileAccess,
  AgentInstallScope,
  AgentMissingToolBehavior,
  AgentNetworkAccess,
  AgentPolicy,
  AgentPreset
} from "@/lib/openclaw/types";
import { OPENCLAW_BUILTIN_TOOL_CATALOG } from "@/lib/openclaw/tool-catalog";

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
  skillIds: string[];
};

export const DEFAULT_AGENT_PRESET: AgentPreset = "worker";

const OPENCLAW_SKILL_ID_SET = new Set([
  "project-builder",
  "project-reviewer",
  "project-tester",
  "project-learner",
  "project-browser",
  "project-researcher",
  "project-strategist",
  "project-writer",
  "project-analyst"
]);

const OPENCLAW_TOOL_ID_SET = new Set(OPENCLAW_BUILTIN_TOOL_CATALOG.map((entry) => entry.name));

const PRESET_META: Record<AgentPreset, PresetMeta> = {
  worker: {
    label: "Worker",
    description: "Default execution agent for code changes, docs, research, and review work. Best when the task stays inside the workspace and does not need system-level changes.",
    defaultName: "Worker",
    defaultEmoji: "🛠️",
    defaultTheme: "slate",
    badgeVariant: "default",
    tools: ["exec", "read", "write", "edit", "apply_patch"],
    skillIds: ["project-builder", "project-reviewer", "project-tester"]
  },
  setup: {
    label: "Setup / Operator",
    description: "Bootstraps environments, handles installs, and unblocks the workspace so other agents can move faster.",
    defaultName: "Setup Operator",
    defaultEmoji: "🧰",
    defaultTheme: "amber",
    badgeVariant: "warning",
    tools: ["exec", "process", "gateway", "read", "write"],
    skillIds: ["project-builder", "project-analyst", "project-learner"]
  },
  browser: {
    label: "Browser",
    description: "Captures browser evidence, screenshots, and user-path validation for UI-heavy work.",
    defaultName: "Browser Agent",
    defaultEmoji: "🌐",
    defaultTheme: "blue",
    badgeVariant: "success",
    tools: ["browser", "web_search", "web_fetch", "image"],
    skillIds: ["project-browser", "project-tester", "project-researcher"]
  },
  monitoring: {
    label: "Monitoring",
    description: "Runs on a watch cycle, checks health and drift, and leaves concise triage handoffs.",
    defaultName: "Monitoring Agent",
    defaultEmoji: "🛰️",
    defaultTheme: "teal",
    badgeVariant: "warning",
    tools: ["cron", "gateway", "sessions_list", "message", "web_fetch"],
    skillIds: ["project-analyst", "project-reviewer", "project-learner"]
  },
  custom: {
    label: "Custom",
    description: "Starts from the safe baseline and lets you fine-tune identity, policy, and operating style by hand.",
    defaultName: "Custom Agent",
    defaultEmoji: "🧩",
    defaultTheme: "violet",
    badgeVariant: "muted",
    tools: ["exec", "read", "edit", "message"],
    skillIds: ["project-researcher", "project-builder", "project-analyst"]
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

export function filterKnownOpenClawSkillIds(skillIds: string[]) {
  return uniqueStrings(skillIds.filter((skillId) => OPENCLAW_SKILL_ID_SET.has(skillId)));
}

export function filterKnownOpenClawToolIds(toolIds: string[]) {
  return uniqueStrings(toolIds.filter((toolId) => OPENCLAW_TOOL_ID_SET.has(toolId)));
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

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
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
