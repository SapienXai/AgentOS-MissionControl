import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  legacyWorkspaceMaterializationFromFields,
  normalizeWorkspaceMaterialization,
  normalizeWorkspaceMaterializationInput
} from "@/lib/agentos/domains/workspace-materialization";
import {
  legacyPlannerContextSourceToKnowledgeSource,
  normalizeWorkspaceKnowledgeSource,
  normalizeWorkspaceKnowledgeSources
} from "@/lib/agentos/domains/workspace-knowledge";
import {
  normalizeWorkspaceProjectManifestRecord,
  serializeWorkspaceProjectManifestRecord
} from "@/lib/openclaw/domains/workspace-manifest";
import {
  createInitialWorkspacePlan,
  normalizeWorkspacePlan
} from "@/lib/openclaw/planner-core";
import {
  applyBasicInputToWorkspacePlan
} from "@/lib/openclaw/workspace-wizard-mappers";
import { resolveWorkspaceBootstrapInput, scaffoldWorkspaceContents } from "@/lib/openclaw/domains/workspace-bootstrap";
import { DEFAULT_WORKSPACE_RULES } from "@/lib/openclaw/workspace-presets";

test("workspace materialization enforces the physical starting-point invariants", () => {
  assert.deepEqual(normalizeWorkspaceMaterialization({ mode: "empty" }), { mode: "empty" });
  assert.deepEqual(normalizeWorkspaceMaterialization({ mode: "clone", repoUrl: " https://example.com/repo.git " }), {
    mode: "clone",
    repoUrl: "https://example.com/repo.git"
  });
  assert.deepEqual(normalizeWorkspaceMaterialization({ mode: "existing", existingPath: " /tmp/project " }), {
    mode: "existing",
    existingPath: "/tmp/project"
  });
  assert.deepEqual(legacyWorkspaceMaterializationFromFields({ repoUrl: "https://example.com/repo.git" }), {
    mode: "clone",
    repoUrl: "https://example.com/repo.git"
  });
  assert.deepEqual(legacyWorkspaceMaterializationFromFields({ existingPath: "/tmp/project" }), {
    mode: "existing",
    existingPath: "/tmp/project"
  });

  assert.throws(() => normalizeWorkspaceMaterialization({ mode: "empty", repoUrl: "https://example.com" }), /cannot include/);
  assert.throws(() => normalizeWorkspaceMaterialization({ mode: "clone" }), /requires repoUrl/);
  assert.throws(() => normalizeWorkspaceMaterialization({ mode: "existing", repoUrl: "https://example.com" }), /requires existingPath/);
  assert.throws(
    () => normalizeWorkspaceMaterializationInput({
      materialization: { mode: "empty" },
      sourceMode: "clone",
      repoUrl: "https://example.com/repo.git"
    }),
    /conflicts/
  );
});

test("knowledge sources cover all declaration kinds without credentials and dedupe obvious locators", () => {
  const rawSources = [
    {
      id: "prompt",
      kind: "prompt",
      label: "Brief",
      summary: "The operator brief",
      status: "ready",
      createdAt: "2026-09-09T00:00:00.000Z",
      provenance: "operator",
      locator: { kind: "prompt", text: "The operator brief" }
    },
    {
      id: "website-a",
      kind: "website",
      label: "Example",
      summary: "Website",
      status: "ready",
      createdAt: "2026-09-09T00:00:00.000Z",
      provenance: "wizard",
      locator: { kind: "website", url: "https://example.com" }
    },
    {
      id: "website-b",
      kind: "website",
      label: "Example duplicate",
      summary: "Website",
      status: "ready",
      createdAt: "2026-09-09T00:00:00.000Z",
      provenance: "planner",
      locator: { kind: "website", url: "https://example.com/" }
    },
    {
      id: "repository",
      kind: "repository",
      label: "Repo",
      summary: "Remote repository",
      status: "ready",
      createdAt: "2026-09-09T00:00:00.000Z",
      provenance: "operator",
      locator: { kind: "repository", remoteUrl: "https://example.com/repo.git" }
    },
    {
      id: "file",
      kind: "file",
      label: "Spec",
      summary: "A PDF reference",
      status: "ready",
      createdAt: "2026-09-09T00:00:00.000Z",
      provenance: "operator",
      locator: { kind: "file", path: "/tmp/spec.pdf" }
    },
    {
      id: "folder",
      kind: "folder",
      label: "References",
      summary: "Reference folder",
      status: "ready",
      createdAt: "2026-09-09T00:00:00.000Z",
      provenance: "operator",
      locator: { kind: "folder", path: "/tmp/references/" }
    },
    {
      id: "connector",
      kind: "connector",
      label: "Drive",
      summary: "A connected reference",
      status: "ready",
      createdAt: "2026-09-09T00:00:00.000Z",
      provenance: "operator",
      locator: { kind: "connector", provider: "drive", accountId: "account-1", resourceId: "file-1", resourceType: "file" }
    }
  ];

  const sources = normalizeWorkspaceKnowledgeSources(rawSources);
  assert.equal(sources.length, 6);
  assert.deepEqual(sources.map((source) => source.kind), ["prompt", "website", "repository", "file", "folder", "connector"]);
  assert.equal(sources.find((source) => source.kind === "repository")?.locator.kind, "repository");
  assert.throws(
    () => normalizeWorkspaceKnowledgeSource({ ...rawSources[0], locator: { kind: "prompt", text: "brief", credentials: "no" } }),
    /credentials|secret/
  );
  assert.equal(
    legacyPlannerContextSourceToKnowledgeSource({
      id: "legacy-repo",
      kind: "repo",
      label: "Legacy repo",
      summary: "Legacy repository",
      details: [],
      status: "ready",
      createdAt: "2026-09-09T00:00:00.000Z",
      url: "https://example.com/legacy.git"
    }).kind,
    "repository"
  );
});

test("manifest V1 reads as V2 and V2 writes preserve unknown metadata", () => {
  const v1 = {
    version: 1,
    name: "Legacy",
    directory: "/tmp/legacy",
    sourceMode: "clone",
    repoUrl: "https://example.com/repo.git",
    contextSources: [
      {
        id: "legacy-repo",
        kind: "repo",
        label: "Legacy repo",
        summary: "Legacy repository",
        details: [],
        status: "ready",
        createdAt: "2026-09-09T00:00:00.000Z",
        url: "https://example.com/repo.git"
      }
    ],
    unknownMetadata: { keep: true }
  };
  const normalized = normalizeWorkspaceProjectManifestRecord(v1);
  assert.equal(normalized.version, 2);
  assert.deepEqual(normalized.materialization, { mode: "clone", repoUrl: "https://example.com/repo.git" });
  assert.equal(normalized.knowledgeSources[0]?.kind, "repository");
  assert.equal(v1.version, 1, "read normalization must not rewrite the input record");

  const serialized = serializeWorkspaceProjectManifestRecord(v1, {
    name: "Migrated",
    materialization: { mode: "empty" },
    knowledgeSources: []
  });
  assert.equal(serialized.version, 2);
  assert.deepEqual(serialized.materialization, { mode: "empty" });
  assert.deepEqual(serialized.knowledgeSources, []);
  assert.deepEqual(serialized.unknownMetadata, { keep: true });
  assert.equal("sourceMode" in serialized, false);
  assert.equal("contextSources" in serialized, false);
});

test("old planner plans normalize into independent materialization and knowledge sections", () => {
  const oldPlan = createInitialWorkspacePlan("old-plan");
  const raw = {
    ...oldPlan,
    workspace: {
      ...oldPlan.workspace,
      sourceMode: "empty",
      repoUrl: undefined,
      existingPath: undefined
    },
    intake: {
      ...oldPlan.intake,
      sources: [
        {
          id: "site",
          kind: "website",
          label: "Example",
          summary: "Reference",
          details: [],
          status: "ready",
          createdAt: "2026-09-09T00:00:00.000Z",
          url: "https://example.com/"
        }
      ]
    }
  };
  delete (raw as { knowledge?: unknown }).knowledge;
  const normalized = normalizeWorkspacePlan(raw);
  assert.deepEqual(normalized.workspace.materialization, { mode: "empty" });
  assert.equal(normalized.knowledge.sources[0]?.kind, "website");
  assert.equal("sources" in normalized.intake, false);
});

test("quick wizard maps physical materialization separately from knowledge", () => {
  const githubPlan = applyBasicInputToWorkspacePlan(createInitialWorkspacePlan("github"), {
    name: "Repo workspace",
    goal: "Ship the repo",
    source: "https://github.com/example/project"
  });
  assert.deepEqual(githubPlan.workspace.materialization, {
    mode: "clone",
    repoUrl: "https://github.com/example/project"
  });
  assert.equal(githubPlan.knowledge.sources[0]?.kind, "repository");

  const websitePlan = applyBasicInputToWorkspacePlan(createInitialWorkspacePlan("website"), {
    name: "Website workspace",
    goal: "Understand the product",
    source: "https://example.com"
  });
  assert.deepEqual(websitePlan.workspace.materialization, { mode: "empty" });
  assert.equal(websitePlan.knowledge.sources[0]?.kind, "website");
});

test("create input accepts canonical materialization and preserves independent references", () => {
  const resolved = resolveWorkspaceBootstrapInput({
    name: "Combined workspace",
    materialization: { mode: "clone", repoUrl: "https://example.com/project.git" },
    knowledgeSources: [
      {
        id: "website",
        kind: "website",
        label: "Product site",
        summary: "Public product context",
        details: [],
        status: "ready",
        createdAt: "2026-09-09T00:00:00.000Z",
        provenance: "operator",
        locator: { kind: "website", url: "https://example.com" }
      },
      {
        id: "spec",
        kind: "file",
        label: "Spec",
        summary: "PDF reference",
        details: [],
        status: "ready",
        createdAt: "2026-09-09T00:00:00.000Z",
        provenance: "operator",
        locator: { kind: "file", path: "/tmp/spec.pdf" }
      },
      {
        id: "brief",
        kind: "prompt",
        label: "Brief",
        summary: "Extra context",
        details: [],
        status: "ready",
        createdAt: "2026-09-09T00:00:00.000Z",
        provenance: "wizard",
        locator: { kind: "prompt", text: "Extra context" }
      }
    ]
  });

  assert.deepEqual(resolved.materialization, { mode: "clone", repoUrl: "https://example.com/project.git" });
  assert.deepEqual(resolved.knowledgeSources.map((source) => source.kind), ["website", "file", "prompt"]);
  assert.equal(resolved.contextSources[0]?.kind, "website");
  assert.throws(
    () => resolveWorkspaceBootstrapInput({
      name: "Conflict",
      materialization: { mode: "empty" },
      sourceMode: "clone",
      repoUrl: "https://example.com/project.git"
    }),
    /conflicts/
  );
});

test("workspace scaffold writes V2 metadata and describes sources without claiming ingestion", async () => {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), "agentos-workspace-v2-"));
  try {
    await scaffoldWorkspaceContents(workspacePath, {
      name: "Scaffolded workspace",
      brief: "A source-aware workspace",
      template: "software",
      teamPreset: "solo",
      modelProfile: "balanced",
      rules: { ...DEFAULT_WORKSPACE_RULES, generateStarterDocs: true, generateMemory: false, kickoffMission: false },
      materialization: { mode: "empty" },
      docOverrides: [],
      agents: [],
      knowledgeSources: [
        {
          id: "site",
          kind: "website",
          label: "Product site",
          summary: "Declared website source",
          details: [],
          status: "ready",
          createdAt: "2026-09-09T00:00:00.000Z",
          provenance: "wizard",
          locator: { kind: "website", url: "https://example.com" }
        }
      ]
    });
    const manifest = JSON.parse(await readFile(path.join(workspacePath, ".openclaw", "project.json"), "utf8")) as Record<string, unknown>;
    const brief = await readFile(path.join(workspacePath, "docs", "brief.md"), "utf8");
    assert.equal(manifest.version, 2);
    assert.deepEqual(manifest.materialization, { mode: "empty" });
    assert.equal(Array.isArray(manifest.knowledgeSources), true);
    assert.equal("sourceMode" in manifest, false);
    assert.match(brief, /Declared sources/);
    assert.doesNotMatch(brief, /indexed|embedded|crawled/i);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});
