import {
  buildWorkspaceBootstrapProfileCache,
  readBootstrapProfileFile,
  type WorkspaceBootstrapProfileCache
} from "@/lib/openclaw/adapter/workspace-inspector-adapter";
import type {
  OpenClawAgent,
  WorkspaceCreateRules,
  WorkspaceTemplate
} from "@/lib/openclaw/types";

type AgentBootstrapProfile = OpenClawAgent["profile"];

export async function readAgentBootstrapProfile(
  workspacePath: string,
  options: {
    agentId: string;
    agentName: string;
    agentDir?: string;
    configuredSkills: string[];
    configuredTools: string[];
    template?: WorkspaceTemplate | null;
    rules?: WorkspaceCreateRules;
    workspaceBootstrapProfile?: WorkspaceBootstrapProfileCache;
  }
): Promise<AgentBootstrapProfile> {
  const workspaceBootstrapProfile =
    options.workspaceBootstrapProfile ??
    (await buildWorkspaceBootstrapProfileCache(
      workspacePath,
      options.template,
      options.rules
    ));
  const profileFiles = workspaceBootstrapProfile.profileFiles;
  const contextManifest = workspaceBootstrapProfile.contextManifest;
  const sections = new Map(workspaceBootstrapProfile.workspaceSections);
  const sources = [...workspaceBootstrapProfile.workspaceSources];
  const agentDir = normalizeOptionalValue(options.agentDir);

  if (agentDir) {
    const agentEntries = await Promise.all(
      profileFiles.map((fileName) => readBootstrapProfileFile(agentDir, workspacePath, fileName))
    );

    for (const entry of agentEntries) {
      if (!entry) {
        continue;
      }

      sources.push(entry.source);
      sections.set(entry.fileName, entry.lines);
    }
  }

  const purpose =
    extractPurpose(sections) ??
    inferPurposeFromConfig({
      agentId: options.agentId,
      agentName: options.agentName,
      skills: options.configuredSkills
    });
  const operatingInstructions = collectBulletSections(sections, [
    { file: "AGENTS.md", heading: "Safety defaults" },
    { file: "AGENTS.md", heading: "Daily memory" },
    { file: "AGENTS.md", heading: "Output" },
    { file: "SOUL.md", heading: "How I Operate" },
    { file: "TOOLS.md", heading: "Examples" },
    { file: "MEMORY.md", heading: "Stable facts" },
    { file: "memory/blueprint.md", heading: "Constraints" },
    { file: "memory/blueprint.md", heading: "Unknowns" },
    { file: "docs/brief.md", heading: "Success signals" },
    { file: "docs/brief.md", heading: "Open questions" },
    { file: "docs/architecture.md", heading: "Dependencies" },
    { file: "docs/architecture.md", heading: "Risks" },
    { file: "deliverables/README.md", heading: "Deliverables" },
    ...contextManifest.resources
      .filter(
        (spec) =>
          spec.relativePath.startsWith("docs/") &&
          spec.relativePath !== "docs/brief.md" &&
          spec.relativePath !== "docs/architecture.md"
      )
      .flatMap((spec) => spec.headings.map((heading) => ({ file: spec.relativePath, heading })))
  ]).slice(0, 8);
  const responseStyle =
    uniqueStrings([
      ...extractInlineList(sections.get("IDENTITY.md"), "Vibe"),
      ...extractBulletSection(sections.get("SOUL.md"), "My Quirks"),
      ...extractBulletSection(sections.get("SOUL.md"), "How I Operate")
    ]).slice(0, 6) || [];
  const outputPreference =
    extractOutputPreference(sections.get("AGENTS.md")) ??
    extractOutputPreference(sections.get("deliverables/README.md")) ??
    inferOutputPreference(options.configuredTools);

  return {
    purpose,
    operatingInstructions:
      operatingInstructions.length > 0 ? operatingInstructions : inferOperatingInstructions(options.configuredTools),
    responseStyle,
    outputPreference,
    sourceFiles: sources
  };
}

function collectBulletSections(
  sections: Map<string, string[]>,
  entries: Array<{ file: string; heading: string }>
) {
  return uniqueStrings(entries.flatMap((entry) => extractBulletSection(sections.get(entry.file), entry.heading)));
}

function extractPurpose(sections: Map<string, string[]>) {
  const workspaceObjective =
    extractSectionParagraph(sections.get("docs/brief.md"), "Objective") ??
    extractSectionParagraph(sections.get("memory/blueprint.md"), "Outcome") ??
    extractSectionParagraph(sections.get("MEMORY.md"), "Current brief") ??
    extractSectionParagraph(sections.get("SOUL.md"), "My Purpose") ??
    extractSectionParagraph(sections.get("IDENTITY.md"), "Role") ??
    extractSectionParagraph(sections.get("AGENTS.md"), "Customize");

  if (workspaceObjective) {
    return workspaceObjective;
  }

  return null;
}

function extractOutputPreference(lines?: string[]) {
  if (!lines) {
    return null;
  }

  const match = lines.find((line) =>
    /be concise in chat|write longer output to files|output/i.test(line)
  );

  return match ? cleanMarkdown(match) : null;
}

function inferPurposeFromConfig({
  agentId,
  agentName,
  skills
}: {
  agentId: string;
  agentName: string;
  skills: string[];
}) {
  if (skills.length > 0) {
    return `${agentName} specializes in ${skills.join(", ")} workflows inside the attached workspace.`;
  }

  if (/dev|build|coder|engineer/i.test(agentId)) {
    return `${agentName} is configured as a development-focused OpenClaw operator for this workspace.`;
  }

  if (/review/i.test(agentId)) {
    return `${agentName} is configured to review work and surface quality risks for this workspace.`;
  }

  if (/test/i.test(agentId)) {
    return `${agentName} is configured to validate behavior, testing, and runtime quality for this workspace.`;
  }

  return `${agentName} is a general-purpose OpenClaw operator attached to this workspace.`;
}

function inferOperatingInstructions(configuredTools: string[]) {
  if (configuredTools.includes("fs.workspaceOnly")) {
    return ["Operate within the attached workspace and avoid spilling changes outside it."];
  }

  return ["No explicit operating instructions were found in workspace bootstrap files."];
}

function inferOutputPreference(configuredTools: string[]) {
  if (configuredTools.includes("fs.workspaceOnly")) {
    return "Prefer workspace-grounded output tied to real project files and artifacts.";
  }

  return null;
}

function extractSectionParagraph(lines: string[] | undefined, heading: string) {
  if (!lines) {
    return null;
  }

  const start = lines.findIndex((line) => normalizeHeading(line) === normalizeHeading(heading));
  if (start === -1) {
    return null;
  }

  const collected: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();

    if (!line) {
      if (collected.length > 0) {
        break;
      }
      continue;
    }

    if (/^#+\s+/.test(line)) {
      break;
    }

    if (/^[-*]\s+/.test(line)) {
      break;
    }

    collected.push(cleanMarkdown(line));
    if (collected.length >= 2) {
      break;
    }
  }

  return collected.length > 0 ? collected.join(" ") : null;
}

function extractBulletSection(lines: string[] | undefined, heading: string) {
  if (!lines) {
    return [];
  }

  const start = lines.findIndex((line) => normalizeHeading(line) === normalizeHeading(heading));
  if (start === -1) {
    return [];
  }

  const bullets: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();

    if (!line && bullets.length > 0) {
      break;
    }

    if (/^#+\s+/.test(line)) {
      break;
    }

    if (/^[-*]\s+/.test(line)) {
      bullets.push(cleanMarkdown(line.replace(/^[-*]\s+/, "")));
      continue;
    }

    if (bullets.length > 0) {
      break;
    }
  }

  return bullets;
}

function extractInlineList(lines: string[] | undefined, label: string) {
  if (!lines) {
    return [];
  }

  const entry = lines.find((line) => line.toLowerCase().includes(`**${label.toLowerCase()}:**`));
  if (!entry) {
    return [];
  }

  const [, rawValue = ""] = entry.split(":");
  return rawValue
    .split(",")
    .map((item) => cleanMarkdown(item))
    .filter(Boolean);
}

function normalizeHeading(line: string) {
  return line.replace(/^#+\s+/, "").trim().toLowerCase();
}

function cleanMarkdown(value: string) {
  return value
    .replace(/[`*_>#-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeOptionalValue(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}
