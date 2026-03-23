import { resolveAgentPolicy } from "@/lib/openclaw/agent-presets";
import { buildWorkspaceScaffoldDocumentPaths } from "@/lib/openclaw/workspace-docs";
import type {
  WorkspaceAgentBlueprintInput,
  WorkspaceCreateRules,
  WorkspaceModelProfile,
  WorkspaceSourceMode,
  WorkspaceTeamPreset,
  WorkspaceTemplate
} from "@/lib/openclaw/types";

type Option<T extends string> = {
  value: T;
  label: string;
  description: string;
};

type TemplateMeta = {
  label: string;
  description: string;
  icon: string;
};

type AgentSeed = Omit<WorkspaceAgentBlueprintInput, "enabled"> & {
  description: string;
};

export const WORKSPACE_SOURCE_OPTIONS: Array<Option<WorkspaceSourceMode>> = [
  {
    value: "empty",
    label: "Empty workspace",
    description: "Create a fresh project folder and scaffold the shared OpenClaw context."
  },
  {
    value: "clone",
    label: "Clone repo",
    description: "Clone a repository first, then layer workspace docs, memory, and agents on top."
  },
  {
    value: "existing",
    label: "Use existing folder",
    description: "Attach OpenClaw to a folder that already exists and preserve any current files."
  }
];

export const WORKSPACE_TEMPLATE_OPTIONS: Array<Option<WorkspaceTemplate>> = [
  {
    value: "software",
    label: "Software project",
    description: "Balanced software delivery setup for product and engineering work."
  },
  {
    value: "frontend",
    label: "Frontend app",
    description: "UI-focused team with browser coverage and product-facing documentation."
  },
  {
    value: "backend",
    label: "Backend/API",
    description: "Service and API template with strong testing and delivery defaults."
  },
  {
    value: "research",
    label: "Research",
    description: "Exploration-first workspace for investigation, synthesis, and durable notes."
  },
  {
    value: "content",
    label: "Content/Growth",
    description: "Campaign and content setup for strategy, writing, review, and analytics."
  }
];

export const WORKSPACE_TEAM_PRESET_OPTIONS: Array<Option<WorkspaceTeamPreset>> = [
  {
    value: "solo",
    label: "Solo",
    description: "One primary agent with a shared workspace scaffold."
  },
  {
    value: "core",
    label: "Core team",
    description: "Multi-agent setup with role-specific specialists and a strong shared context."
  },
  {
    value: "custom",
    label: "Custom",
    description: "Start from a recommended team and toggle which specialist agents are enabled."
  }
];

export const WORKSPACE_MODEL_PROFILE_OPTIONS: Array<Option<WorkspaceModelProfile>> = [
  {
    value: "balanced",
    label: "Balanced",
    description: "General-purpose default for daily execution, review, and coordination."
  },
  {
    value: "fast",
    label: "Fast",
    description: "Favor speed and iteration for high-throughput tasking and first passes."
  },
  {
    value: "quality",
    label: "Quality",
    description: "Favor deeper reasoning and more careful outputs for critical work."
  }
];

export const DEFAULT_WORKSPACE_RULES: WorkspaceCreateRules = {
  workspaceOnly: true,
  generateStarterDocs: true,
  generateMemory: true,
  kickoffMission: true
};

const TEMPLATE_META: Record<WorkspaceTemplate, TemplateMeta> = {
  software: {
    label: "Software project",
    description: "Default project template for engineering delivery.",
    icon: "🛠"
  },
  frontend: {
    label: "Frontend app",
    description: "UI and experience work with browser-aware support.",
    icon: "🎨"
  },
  backend: {
    label: "Backend/API",
    description: "Services, infrastructure, and backend-oriented workflows.",
    icon: "⚙️"
  },
  research: {
    label: "Research",
    description: "Investigation-heavy workspace with synthesis and memory capture.",
    icon: "🧠"
  },
  content: {
    label: "Content/Growth",
    description: "Messaging, content production, campaign review, and analysis.",
    icon: "📣"
  }
};

const TEMPLATE_AGENT_SEEDS: Record<WorkspaceTemplate, AgentSeed[]> = {
  software: [
    {
      id: "builder",
      role: "Builder",
      name: "Builder",
      emoji: "🛠️",
      theme: "amber",
      skillId: "project-builder",
      isPrimary: true,
      description: "Implements requested changes and drives delivery forward."
    },
    {
      id: "reviewer",
      role: "Reviewer",
      name: "Reviewer",
      emoji: "🔍",
      theme: "rose",
      skillId: "project-reviewer",
      description: "Reviews work for correctness, regressions, and product risk."
    },
    {
      id: "tester",
      role: "Tester",
      name: "Tester",
      emoji: "🧪",
      theme: "emerald",
      skillId: "project-tester",
      description: "Validates behavior, tests, and environment assumptions."
    },
    {
      id: "learner",
      role: "Learner",
      name: "Learner",
      emoji: "🧠",
      theme: "cyan",
      skillId: "project-learner",
      description: "Consolidates durable project knowledge and memory."
    }
  ],
  frontend: [
    {
      id: "builder",
      role: "Builder",
      name: "Builder",
      emoji: "🛠️",
      theme: "amber",
      skillId: "project-builder",
      isPrimary: true,
      description: "Implements UI and frontend product work."
    },
    {
      id: "reviewer",
      role: "Reviewer",
      name: "Reviewer",
      emoji: "🔍",
      theme: "rose",
      skillId: "project-reviewer",
      description: "Reviews interaction, correctness, and regression risk."
    },
    {
      id: "tester",
      role: "Tester",
      name: "Tester",
      emoji: "🧪",
      theme: "emerald",
      skillId: "project-tester",
      description: "Checks behavior, responsive states, and verification gaps."
    },
    {
      id: "learner",
      role: "Learner",
      name: "Learner",
      emoji: "🧠",
      theme: "cyan",
      skillId: "project-learner",
      description: "Maintains stable product and implementation knowledge."
    },
    {
      id: "browser",
      role: "Browser Agent",
      name: "Browser Agent",
      emoji: "🌐",
      theme: "blue",
      skillId: "project-browser",
      description: "Exercises browser flows, captures UI evidence, and validates user paths."
    }
  ],
  backend: [
    {
      id: "builder",
      role: "Builder",
      name: "Builder",
      emoji: "🛠️",
      theme: "amber",
      skillId: "project-builder",
      isPrimary: true,
      description: "Implements service, API, and infrastructure changes."
    },
    {
      id: "reviewer",
      role: "Reviewer",
      name: "Reviewer",
      emoji: "🔍",
      theme: "rose",
      skillId: "project-reviewer",
      description: "Catches correctness, data handling, and operational risks."
    },
    {
      id: "tester",
      role: "Tester",
      name: "Tester",
      emoji: "🧪",
      theme: "emerald",
      skillId: "project-tester",
      description: "Validates APIs, background jobs, migrations, and failure paths."
    },
    {
      id: "learner",
      role: "Learner",
      name: "Learner",
      emoji: "🧠",
      theme: "cyan",
      skillId: "project-learner",
      description: "Maintains architecture notes and durable operational memory."
    }
  ],
  research: [
    {
      id: "researcher",
      role: "Research Lead",
      name: "Research Lead",
      emoji: "🔬",
      theme: "violet",
      skillId: "project-researcher",
      isPrimary: true,
      description: "Runs investigations, frames questions, and synthesizes findings."
    },
    {
      id: "reviewer",
      role: "Reviewer",
      name: "Reviewer",
      emoji: "🔍",
      theme: "rose",
      skillId: "project-reviewer",
      description: "Pressure-tests claims, assumptions, and interpretation quality."
    },
    {
      id: "learner",
      role: "Archivist",
      name: "Archivist",
      emoji: "🧠",
      theme: "cyan",
      skillId: "project-learner",
      description: "Distills durable research notes, memory, and takeaways."
    }
  ],
  content: [
    {
      id: "strategist",
      role: "Strategist",
      name: "Strategist",
      emoji: "📣",
      theme: "orange",
      skillId: "project-strategist",
      isPrimary: true,
      description: "Frames audience, goals, positioning, and campaign direction."
    },
    {
      id: "writer",
      role: "Writer",
      name: "Writer",
      emoji: "✍️",
      theme: "sky",
      skillId: "project-writer",
      description: "Drafts content, messaging, and campaign assets."
    },
    {
      id: "reviewer",
      role: "Reviewer",
      name: "Reviewer",
      emoji: "🔍",
      theme: "rose",
      skillId: "project-reviewer",
      description: "Edits for clarity, quality, and consistency."
    },
    {
      id: "analyst",
      role: "Analyst",
      name: "Analyst",
      emoji: "📈",
      theme: "emerald",
      skillId: "project-analyst",
      description: "Tracks results, experiments, and performance insights."
    }
  ]
};

export function getWorkspaceTemplateMeta(template: WorkspaceTemplate) {
  return TEMPLATE_META[template];
}

export function buildDefaultWorkspaceAgents(
  template: WorkspaceTemplate,
  teamPreset: WorkspaceTeamPreset,
  workspaceName?: string
): WorkspaceAgentBlueprintInput[] {
  const seeds = TEMPLATE_AGENT_SEEDS[template];

  if (teamPreset === "solo") {
    const primary = seeds.find((entry) => entry.isPrimary) ?? seeds[0];
    return [
      {
        ...primary,
        name: buildWorkspaceAgentName(
          workspaceName,
          primary.role,
          primary.role === "Builder" ? "Default Agent" : primary.name
        ),
        policy: resolveAgentPolicy(primary.id === "browser" ? "browser" : "worker"),
        enabled: true
      }
    ];
  }

  return seeds.map((entry) => ({
    id: entry.id,
    role: entry.role,
    name: entry.isPrimary
      ? buildWorkspaceAgentName(workspaceName, entry.role, entry.name)
      : entry.name,
      emoji: entry.emoji,
      theme: entry.theme,
      skillId: entry.skillId,
      modelId: entry.modelId,
      isPrimary: Boolean(entry.isPrimary),
      policy: resolveAgentPolicy(entry.id === "browser" ? "browser" : "worker"),
      enabled: true
  }));
}

export function buildWorkspaceAgentName(
  workspaceName: string | undefined,
  role: string,
  fallbackName: string
) {
  const workspaceLabel = deriveWorkspaceAgentPrefix(workspaceName);

  if (!workspaceLabel) {
    return fallbackName;
  }

  const trimmedRole = role.trim();
  return trimmedRole ? `${workspaceLabel} ${trimmedRole}` : workspaceLabel;
}

function deriveWorkspaceAgentPrefix(workspaceName: string | undefined) {
  const trimmed = workspaceName?.trim();

  if (!trimmed) {
    return "";
  }

  const firstLabel = !/\s/.test(trimmed) && trimmed.includes(".") ? trimmed.split(".")[0] : trimmed;
  const cleaned = firstLabel.replace(/[^A-Za-z0-9\u00C0-\u024F]+/g, " ").trim();

  if (!cleaned) {
    return "";
  }

  return cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

export function buildWorkspaceScaffoldPreview(
  template: WorkspaceTemplate,
  rules: WorkspaceCreateRules
) {
  return buildWorkspaceScaffoldDocumentPaths(template, rules);
}

export function buildWorkspaceFolderPreview(rules: WorkspaceCreateRules) {
  const folders = ["skills", ".openclaw/project-shell/runs", ".openclaw/project-shell/tasks"];

  if (rules.generateStarterDocs) {
    folders.push("docs", "deliverables");
  }

  if (rules.generateMemory) {
    folders.push("memory");
  }

  return folders;
}
