import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  clearMissionControlCaches
} from "@/lib/openclaw/application/mission-control-service";
import {
  createWorkspaceProject as createApplicationWorkspaceProject,
  deleteWorkspaceProject as deleteApplicationWorkspaceProject,
  readWorkspaceEditSeed as readApplicationWorkspaceEditSeed,
  updateWorkspaceProject as updateApplicationWorkspaceProject
} from "@/lib/openclaw/application/workspace-service";
import {
  createWorkspaceProject as createCompatibilityWorkspaceProject,
  deleteWorkspaceProject as deleteCompatibilityWorkspaceProject,
  renderAgentsMarkdown as renderCompatibilityAgentsMarkdown,
  renderArchitectureMarkdown as renderCompatibilityArchitectureMarkdown,
  renderBlueprintMarkdown as renderCompatibilityBlueprintMarkdown,
  renderBriefMarkdown as renderCompatibilityBriefMarkdown,
  renderDecisionsMarkdown as renderCompatibilityDecisionsMarkdown,
  renderDeliverablesMarkdown as renderCompatibilityDeliverablesMarkdown,
  renderHeartbeatMarkdown as renderCompatibilityHeartbeatMarkdown,
  renderIdentityMarkdown as renderCompatibilityIdentityMarkdown,
  renderMemoryMarkdown as renderCompatibilityMemoryMarkdown,
  renderSoulMarkdown as renderCompatibilitySoulMarkdown,
  renderTemplateSpecificDoc as renderCompatibilityTemplateSpecificDoc,
  renderToolsMarkdown as renderCompatibilityToolsMarkdown,
  readWorkspaceEditSeed as readCompatibilityWorkspaceEditSeed,
  updateWorkspaceProject as updateCompatibilityWorkspaceProject
} from "@/lib/openclaw/service";
import {
  renderAgentsMarkdown as renderDomainAgentsMarkdown,
  renderArchitectureMarkdown as renderDomainArchitectureMarkdown,
  renderBlueprintMarkdown as renderDomainBlueprintMarkdown,
  renderBriefMarkdown as renderDomainBriefMarkdown,
  renderDecisionsMarkdown as renderDomainDecisionsMarkdown,
  renderDeliverablesMarkdown as renderDomainDeliverablesMarkdown,
  renderHeartbeatMarkdown as renderDomainHeartbeatMarkdown,
  renderIdentityMarkdown as renderDomainIdentityMarkdown,
  renderMemoryMarkdown as renderDomainMemoryMarkdown,
  renderSoulMarkdown as renderDomainSoulMarkdown,
  renderTemplateSpecificDoc as renderDomainTemplateSpecificDoc,
  renderToolsMarkdown as renderDomainToolsMarkdown
} from "@/lib/openclaw/domains/workspace-document-renderers";
import {
  createWorkspaceIdResolver,
  legacyWorkspaceHashIdFromPath,
  workspaceDisambiguatedIdFromPath,
  workspaceIdFromPath,
  workspacePathMatchesId
} from "@/lib/openclaw/domains/workspace-id";

async function readErrorMessage(action: () => Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  throw new Error("Expected action to throw.");
}

afterEach(() => {
  clearMissionControlCaches();
});

test("workspace application service preserves edit seed missing-workspace shape", async () => {
  clearMissionControlCaches();

  const missingWorkspaceId = "workspace:missing-characterization";

  assert.equal(
    await readErrorMessage(() => readApplicationWorkspaceEditSeed(missingWorkspaceId)),
    await readErrorMessage(() => readCompatibilityWorkspaceEditSeed(missingWorkspaceId))
  );
});

test("workspace application service preserves create validation shape", async () => {
  const input = {
    name: "No Agents",
    agents: []
  };

  assert.equal(
    await readErrorMessage(() => createApplicationWorkspaceProject(input)),
    await readErrorMessage(() => createCompatibilityWorkspaceProject(input))
  );
});

test("workspace application service preserves update validation shape", async () => {
  const input = {
    workspaceId: " "
  };

  assert.equal(
    await readErrorMessage(() => updateApplicationWorkspaceProject(input)),
    await readErrorMessage(() => updateCompatibilityWorkspaceProject(input))
  );
});

test("workspace application service preserves delete validation shape", async () => {
  const input = {
    workspaceId: " "
  };

  assert.equal(
    await readErrorMessage(() => deleteApplicationWorkspaceProject(input)),
    await readErrorMessage(() => deleteCompatibilityWorkspaceProject(input))
  );
});

test("workspace ids match snapshot slugs while accepting legacy hash aliases", () => {
  const workspacePath = "/tmp/AgentOS Consistency Probe";
  const currentId = workspaceIdFromPath(workspacePath);
  const legacyId = legacyWorkspaceHashIdFromPath(workspacePath);

  assert.equal(currentId, "agentos-consistency-probe");
  assert.match(legacyId, /^workspace:[a-f0-9]{8}$/);
  assert.notEqual(currentId, legacyId);
  assert.equal(workspacePathMatchesId(workspacePath, currentId), true);
  assert.equal(workspacePathMatchesId(workspacePath, legacyId), true);
  assert.equal(workspacePathMatchesId(workspacePath, "other-workspace"), false);
});

test("workspace id resolver disambiguates same-basename workspace paths", () => {
  const firstPath = "/tmp/one/Same Workspace";
  const secondPath = "/tmp/two/Same Workspace";
  const resolveWorkspaceId = createWorkspaceIdResolver([firstPath, secondPath]);

  assert.equal(resolveWorkspaceId(firstPath), "same-workspace");
  assert.equal(resolveWorkspaceId(secondPath), workspaceDisambiguatedIdFromPath(secondPath));
  assert.notEqual(resolveWorkspaceId(firstPath), resolveWorkspaceId(secondPath));
  assert.equal(workspacePathMatchesId(secondPath, resolveWorkspaceId(secondPath)), true);
  assert.equal(workspacePathMatchesId(secondPath, legacyWorkspaceHashIdFromPath(secondPath)), true);
});

test("service workspace document render helpers delegate to domain renderers", () => {
  const agentsInput = {
    name: "Example",
    brief: "Ship the thing.",
    template: "software" as const,
    sourceMode: "empty" as const,
    agents: [
      {
        id: "builder",
        role: "Builder",
        name: "Builder",
        enabled: true,
        skillId: "project-builder"
      }
    ],
    rules: {
      workspaceOnly: true,
      generateStarterDocs: true,
      generateMemory: true,
      kickoffMission: false
    }
  };

  assert.equal(renderCompatibilityAgentsMarkdown(agentsInput), renderDomainAgentsMarkdown(agentsInput));
  assert.equal(renderCompatibilitySoulMarkdown("software", "Focus"), renderDomainSoulMarkdown("software", "Focus"));
  assert.equal(renderCompatibilityIdentityMarkdown("frontend"), renderDomainIdentityMarkdown("frontend"));
  assert.equal(
    renderCompatibilityToolsMarkdown("backend", ["pnpm test"]),
    renderDomainToolsMarkdown("backend", ["pnpm test"])
  );
  assert.equal(renderCompatibilityHeartbeatMarkdown("research"), renderDomainHeartbeatMarkdown("research"));
  assert.equal(
    renderCompatibilityMemoryMarkdown("Example", "content", "Focus"),
    renderDomainMemoryMarkdown("Example", "content", "Focus")
  );
  assert.equal(
    renderCompatibilityBlueprintMarkdown("Example", "software", "Outcome"),
    renderDomainBlueprintMarkdown("Example", "software", "Outcome")
  );
  assert.equal(renderCompatibilityDecisionsMarkdown(), renderDomainDecisionsMarkdown());
  assert.equal(
    renderCompatibilityBriefMarkdown("Example", "frontend", "Brief", "empty"),
    renderDomainBriefMarkdown("Example", "frontend", "Brief", "empty")
  );
  assert.equal(renderCompatibilityArchitectureMarkdown("backend"), renderDomainArchitectureMarkdown("backend"));
  assert.equal(renderCompatibilityDeliverablesMarkdown(), renderDomainDeliverablesMarkdown());
  assert.equal(renderCompatibilityTemplateSpecificDoc("ux"), renderDomainTemplateSpecificDoc("ux"));
});
