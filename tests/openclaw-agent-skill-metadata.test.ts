import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach } from "node:test";
import { test } from "node:test";

import { getAgentPresetMeta } from "@/lib/openclaw/agent-presets";
import {
  pruneUnreferencedGeneratedWorkspaceSkills
} from "@/lib/openclaw/domains/agent-provisioning";
import { renderWorkspaceAgentsMarkdown } from "@/lib/openclaw/domains/workspace-agents-document";
import { parseWorkspaceProjectManifestAgent } from "@/lib/openclaw/domains/workspace-manifest";
import { renderSkillMarkdown } from "@/lib/openclaw/domains/workspace-bootstrap";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("custom agents start without implicit shared skills", () => {
  assert.deepEqual(getAgentPresetMeta("custom").skillIds, []);
});

test("workspace agent manifest keeps all declared skill ids", () => {
  const parsed = parseWorkspaceProjectManifestAgent({
    id: "cyberpunk3-custom-agent",
    name: "Digital Kazım",
    role: "Custom",
    skillId: "project-researcher",
    skillIds: ["project-researcher", "project-builder", "project-analyst"]
  });

  assert.ok(parsed);
  assert.equal(parsed.skillId, "project-researcher");
  assert.deepEqual(parsed.skillIds, ["project-researcher", "project-builder", "project-analyst"]);
});

test("new workspace AGENTS.md keeps agent-specific behavior out of shared context", () => {
  const markdown = renderWorkspaceAgentsMarkdown({
    name: "Workspace",
    templateLabel: "Software project",
    sourceMode: "empty",
    workspaceOnly: true,
    toolExamples: ["Use `pnpm test` for verification."],
    agents: [
      {
        id: "cyberpunk3-custom-agent",
        name: "Digital Kazım",
        role: "Custom",
        enabled: true,
        skillIds: ["project-researcher", "project-builder", "project-analyst"]
      }
    ]
  });

  assert.match(markdown, /## Tools/);
  assert.match(markdown, /Use `pnpm test` for verification\./);
  assert.match(markdown, /Digital Kazım/);
  assert.doesNotMatch(markdown, /## Agent Roles/);
  assert.doesNotMatch(markdown, /agent-specific role\/persona/);
});

test("generated workspace skills are pruned only when unreferenced and unchanged", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "agentos-skill-metadata-"));
  tempRoots.push(tempRoot);

  const workspacePath = path.join(tempRoot, "workspace");
  await mkdir(path.join(workspacePath, ".openclaw"), { recursive: true });
  await mkdir(path.join(workspacePath, "skills", "project-builder"), { recursive: true });
  await mkdir(path.join(workspacePath, "skills", "project-analyst"), { recursive: true });
  await writeFile(
    path.join(workspacePath, ".openclaw", "project.json"),
    JSON.stringify(
      {
        agents: [
          {
            id: "builder",
            skillIds: ["project-builder"]
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.join(workspacePath, "skills", "project-builder", "SKILL.md"),
    `${renderSkillMarkdown("project-builder", "Project Builder")}\n`,
    "utf8"
  );
  await writeFile(
    path.join(workspacePath, "skills", "project-analyst", "SKILL.md"),
    `${renderSkillMarkdown("project-analyst", "Project Analyst")}\n`,
    "utf8"
  );

  await pruneUnreferencedGeneratedWorkspaceSkills(workspacePath);

  assert.match(
    await readFile(path.join(workspacePath, "skills", "project-builder", "SKILL.md"), "utf8"),
    /Project Builder/
  );
  await assert.rejects(
    () => readFile(path.join(workspacePath, "skills", "project-analyst", "SKILL.md"), "utf8"),
    /ENOENT/
  );
});
