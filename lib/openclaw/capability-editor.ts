import type { MissionControlSnapshot } from "@/lib/openclaw/types";
import type { OpenClawToolCatalogEntry } from "@/lib/openclaw/tool-catalog";

export type CapabilityCatalogSkillEntry = {
  name: string;
  description: string;
  emoji: string | null;
  source: string;
  eligible: boolean;
};

export type CapabilityCatalogToolEntry = OpenClawToolCatalogEntry & {
  pluginId?: string;
  pluginName?: string;
};

export type CapabilityCatalogResponse = {
  generatedAt: string;
  skills: CapabilityCatalogSkillEntry[];
  tools: CapabilityCatalogToolEntry[];
};

export type CapabilityKind = "skills" | "tools";

export type CapabilityOption = {
  value: string;
  label: string;
  description: string;
  sourceLabel: string;
  sourceRank: number;
  kind: "skill" | "tool";
  category?: "builtin" | "plugin" | "group" | "workspace" | "custom";
};

export function buildCapabilityOptions(options: CapabilityOption[], kind: CapabilityOption["kind"]) {
  const optionMap = new Map<string, CapabilityOption>();

  for (const option of options) {
    const value = option.value.trim();
    if (!value) {
      continue;
    }

    const existing = optionMap.get(value);
    if (!existing) {
      optionMap.set(value, {
        ...option,
        value,
        label: option.label || value,
        description: option.description || "",
        sourceLabel: option.sourceLabel || (kind === "skill" ? "OpenClaw" : "OpenClaw"),
        sourceRank: option.sourceRank ?? 99,
        kind: option.kind || kind,
        category: option.category
      });
      continue;
    }

    existing.description = existing.description || option.description;
    existing.sourceLabel = mergeCapabilitySourceLabels(existing.sourceLabel, option.sourceLabel);
    existing.sourceRank = Math.min(existing.sourceRank, option.sourceRank ?? existing.sourceRank);
    existing.category = existing.category ?? option.category;
  }

  return Array.from(optionMap.values()).sort((left, right) => {
    const rankDelta = left.sourceRank - right.sourceRank;
    if (rankDelta !== 0) {
      return rankDelta;
    }

    const labelDelta = left.label.localeCompare(right.label);
    if (labelDelta !== 0) {
      return labelDelta;
    }

    return left.value.localeCompare(right.value);
  });
}

export function filterCapabilityOptions(
  options: CapabilityOption[],
  query: string,
  selectedValues: string[],
  limit = 8
) {
  const normalizedQuery = query.trim().toLowerCase();
  const selectedSet = new Set(normalizeCapabilityValues(selectedValues));

  return options
    .filter((option) => !selectedSet.has(option.value))
    .filter((option) => {
      if (!normalizedQuery) {
        return true;
      }

      return scoreCapabilityOption(option, normalizedQuery) < 5;
    })
    .sort((left, right) => {
      const leftScore = scoreCapabilityOption(left, normalizedQuery);
      const rightScore = scoreCapabilityOption(right, normalizedQuery);

      if (leftScore !== rightScore) {
        return leftScore - rightScore;
      }

      const rankDelta = left.sourceRank - right.sourceRank;
      if (rankDelta !== 0) {
        return rankDelta;
      }

      return left.label.localeCompare(right.label);
    })
    .slice(0, limit);
}

export function formatSkillSourceLabel(source: string) {
  if (source === "openclaw-bundled") {
    return "OpenClaw bundled";
  }

  if (source === "workspace") {
    return "Workspace";
  }

  return source;
}

export function formatToolSourceLabel(entry: CapabilityCatalogToolEntry | OpenClawToolCatalogEntry) {
  if (entry.category === "builtin") {
    return "OpenClaw built-in";
  }

  if (entry.category === "group") {
    return "OpenClaw docs";
  }

  return entry.source;
}

export function normalizeCapabilityValues(values: string[]) {
  const seen = new Set<string>();
  const next: string[] = [];

  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    next.push(normalized);
  }

  return next;
}

export function splitCapabilityInput(value: string) {
  return normalizeCapabilityValues(
    value
      .split(/[\n,]/g)
      .map((entry) => entry.trim())
      .filter((entry) => Boolean(entry))
  );
}

export function areCapabilityListsEqual(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

export function updateSnapshotAgentCapabilities(
  snapshot: MissionControlSnapshot,
  agentId: string,
  skills: string[],
  tools: string[]
) {
  const normalizedSkills = normalizeCapabilityValues(skills);
  const normalizedTools = normalizeCapabilityValues(tools);
  const nextAgents = snapshot.agents.map((agent) =>
    agent.id === agentId
      ? {
          ...agent,
          skills: normalizedSkills,
          tools: normalizedTools
        }
      : agent
  );
  const updatedAgent = nextAgents.find((agent) => agent.id === agentId);

  if (!updatedAgent) {
    return snapshot;
  }

  const nextWorkspaces = snapshot.workspaces.map((workspace) => {
    if (workspace.id !== updatedAgent.workspaceId) {
      return workspace;
    }

    const workspaceAgents = nextAgents.filter((agent) => agent.workspaceId === workspace.id);

    return {
      ...workspace,
      capabilities: {
        ...workspace.capabilities,
        skills: normalizeCapabilityValues(workspaceAgents.flatMap((agent) => agent.skills)),
        tools: normalizeCapabilityValues(workspaceAgents.flatMap((agent) => agent.tools)),
        workspaceOnlyAgentCount: workspaceAgents.filter((agent) => agent.tools.includes("fs.workspaceOnly")).length
      }
    };
  });

  return {
    ...snapshot,
    agents: nextAgents,
    workspaces: nextWorkspaces
  };
}

function mergeCapabilitySourceLabels(left: string, right: string) {
  const labels = normalizeCapabilityValues([left, right].filter((value): value is string => Boolean(value)));
  return labels.join(" · ");
}

function scoreCapabilityOption(option: CapabilityOption, query: string) {
  if (!query) {
    return 0;
  }

  const haystacks = [
    option.value.toLowerCase(),
    option.label.toLowerCase(),
    option.description.toLowerCase(),
    option.sourceLabel.toLowerCase()
  ];

  if (haystacks.some((value) => value === query)) {
    return 0;
  }

  if (haystacks.some((value) => value.startsWith(query))) {
    return 1;
  }

  if (haystacks.some((value) => value.includes(query))) {
    return 2;
  }

  return 5;
}
