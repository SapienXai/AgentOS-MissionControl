# AgentOS Workspace Domain V2

## Decision

AgentOS models a workspace as two independent declarations:

- `materialization` describes the physical starting point: `empty`, `clone`, or `existing`.
- `knowledge.sources` (and the V2 manifest field `knowledgeSources`) describes declared or referenced context: prompt, website, repository, file, folder, or connector.

OpenClaw remains the source of truth for the runtime workspace, bootstrap files, agents, channels, and lifecycle. AgentOS owns the operator-facing plan, project metadata projection, and the minimum mapping needed to create or edit a workspace.

## Invariants

`empty` has no repository URL or existing path. `clone` requires a repository URL and has no existing path. `existing` requires an existing path and has no repository URL. The normalizer rejects contradictory representations before filesystem work begins.

Repository knowledge is independent from repository cloning. A repository source can be declared while the materialization is empty, and a clone can be paired with website, file, folder, prompt, or connector references.

Knowledge source records contain locators, human-readable summaries, provenance, and declaration/availability status. They do not contain credentials, ingestion state, chunks, embeddings, crawl state, or index state. `ready` means the declaration is available for the current planner or operator flow; it does not mean indexed.

## Compatibility and migration

V1 `sourceMode`, `repoUrl`, `existingPath`, and `contextSources` are accepted at input boundaries and normalized on read. V1 planner intake sources move to `knowledge.sources` in memory. V1 `.openclaw/project.json` records map to V2 `materialization` and `knowledgeSources`, with `repo` normalized to `repository`.

Reads do not rewrite files. New workspace creation, natural workspace metadata edits, and other manifest writes serialize V2 while preserving unrelated and unknown-safe metadata. Legacy fields are removed only during those writes.

The wizard keeps its existing quick-create interaction. Its mapping is explicit: GitHub URL means clone plus repository source; website URL means empty plus website source; existing folder means existing plus folder source; plain context means empty plus prompt source; no source means empty with no knowledge source.

Planner harvesting is lightweight context collection. Harvested sources are declared references and explicit planner evidence, not an ingestion pipeline. Materialization patches clear only stale materialization fields; knowledge patches never mutate materialization.

## Phase 2 boundary

The next phase may add connection/authentication and ingestion capabilities behind separate domains and OpenClaw-compatible adapters. It must not add credentials to `WorkspaceKnowledgeSource`, make the wizard responsible for crawling, or turn the project manifest into an index database.
