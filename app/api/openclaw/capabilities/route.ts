import { NextResponse } from "next/server";

import {
  listOpenClawPlugins,
  listOpenClawSkills
} from "@/lib/openclaw/application/catalog-service";
import {
  OPENCLAW_BUILTIN_TOOL_CATALOG,
  OPENCLAW_TOOL_GROUP_CATALOG,
  type OpenClawToolCatalogEntry
} from "@/lib/openclaw/tool-catalog";

type CapabilitySkillEntry = {
  name: string;
  description: string;
  emoji: string | null;
  source: string;
  eligible: boolean;
};

type CapabilityToolEntry = OpenClawToolCatalogEntry & {
  pluginId?: string;
  pluginName?: string;
};

type CapabilityCatalogResponse = {
  generatedAt: string;
  skills: CapabilitySkillEntry[];
  tools: CapabilityToolEntry[];
};

export async function GET() {
  const [skillResult, pluginResult] = await Promise.allSettled([
    listOpenClawSkills({ eligible: true, timeoutMs: 15_000 }),
    listOpenClawPlugins({ timeoutMs: 15_000 })
  ]);

  const skills =
    skillResult.status === "fulfilled" && Array.isArray(skillResult.value.skills)
      ? skillResult.value.skills
          .map((skill) => ({
            name: skill.name.trim(),
            description: normalizeDescription(skill.description) ?? "No description available.",
            emoji: normalizeDescription(skill.emoji),
            source: normalizeDescription(skill.source) ?? (skill.bundled ? "openclaw-bundled" : "openclaw"),
            eligible: skill.eligible !== false && skill.disabled !== true && skill.blockedByAllowlist !== true
          }))
          .filter((skill) => Boolean(skill.name))
      : [];

  const builtinTools = [...OPENCLAW_BUILTIN_TOOL_CATALOG, ...OPENCLAW_TOOL_GROUP_CATALOG];
  const toolMap = new Map<string, CapabilityToolEntry>();

  for (const entry of builtinTools) {
    toolMap.set(entry.name, entry);
  }

  if (pluginResult.status === "fulfilled" && Array.isArray(pluginResult.value.plugins)) {
    for (const plugin of pluginResult.value.plugins) {
      if (plugin.status !== "loaded" || !Array.isArray(plugin.toolNames)) {
        continue;
      }

      for (const toolName of plugin.toolNames) {
        const trimmedToolName = toolName.trim();
        if (!trimmedToolName || toolMap.has(trimmedToolName)) {
          continue;
        }

        toolMap.set(trimmedToolName, {
          name: trimmedToolName,
          description: `Provided by ${plugin.name}.`,
          source: plugin.name,
          category: "plugin",
          pluginId: plugin.id,
          pluginName: plugin.name
        });
      }
    }
  }

  const response: CapabilityCatalogResponse = {
    generatedAt: new Date().toISOString(),
    skills,
    tools: Array.from(toolMap.values()).sort(sortCatalogEntries)
  };

  return NextResponse.json(response, {
    headers: {
      "Cache-Control": "no-store"
    }
  });
}

function normalizeDescription(value: string | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sortCatalogEntries(left: CapabilityToolEntry, right: CapabilityToolEntry) {
  const categoryRank = getCategoryRank(left.category) - getCategoryRank(right.category);
  if (categoryRank !== 0) {
    return categoryRank;
  }

  const sourceRank = left.source.localeCompare(right.source);
  if (sourceRank !== 0) {
    return sourceRank;
  }

  return left.name.localeCompare(right.name);
}

function getCategoryRank(category: CapabilityToolEntry["category"]) {
  if (category === "builtin") {
    return 0;
  }

  if (category === "plugin") {
    return 1;
  }

  return 2;
}
