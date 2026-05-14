---
"vitest-agent-mcp": minor
"vitest-agent-plugin": minor
---

## Features

### MCP Resources

The MCP server now exposes Vitest documentation and curated patterns as resources:

- vitest://docs/ — index of the vendored Vitest documentation snapshot
- vitest://docs/{path} — any page from the snapshot (e.g. vitest://docs/api/mock)
- vitest-agent://patterns/ — index of the curated patterns library
- vitest-agent://patterns/{slug} — a single pattern (3 launch patterns: testing-effect-services-with-mock-layers, testing-effect-schema-definitions, authoring-a-custom-vitest-agent-reporter)

The Vitest documentation snapshot is vendored under packages/mcp/src/vendor/vitest-docs (pinned to a specific upstream tag) and ships via copyPatterns in rslib.config.ts. Per-page metadata in manifest.json (validated against an Effect Schema) drives the per-page title and description clients see in resources/list. Refreshing the snapshot is a guided workflow in the project-local update-vitest-snapshot skill, backed by Effect-based maintenance scripts under packages/mcp/lib/scripts.

### MCP Resource Annotations

Every per-page resource now carries optional MCP 2025-11-25 annotations: an audience array (user, assistant, or both) and a priority score between 0 and 1. Clients that honor MCP annotations can use these to rank or filter resources before fetching content.

All 187 vendored Vitest documentation pages are annotated end-to-end using editorial priority bands: API reference pages at 0.85–0.95, coverage guides at 0.85, core guides at 0.78, browser/experimental pages at 0.55, and migration pages at 0.45. The three patterns library entries are annotated at 0.9 (TDD core) and 0.7 (general patterns).

Both list callbacks — vitest_docs_page and vitest_agent_pattern — forward annotations when present. The patterns library list callback previously returned undefined; it now returns a full listing. A new PatternsManifest schema gives the patterns _meta.json the same annotation contract as the vendored docs manifest. A validator checks for empty audience arrays, out-of-range priority values, and partial coverage across the snapshot.

### MCP Prompts

The MCP server now exposes six framing-only prompts:

- triage — orient toward a failure-triage workflow
- why-flaky — diagnose a named flaky test
- regression-since-pass — find the change that broke a test
- explain-failure — synthesize a root cause from a failure signature's recurrence history
- tdd-resume — resume the active TDD session from its current phase
- wrapup — generate the same content the post-hooks emit automatically

Each prompt is a small templated message that orients the agent toward the right tools — no tool data is pre-fetched on the server.

## Maintenance

- New project-local update-vitest-snapshot skill driving a 5-phase fetch → prune → scaffold → enrich → validate workflow. Backed by Effect-based scripts under packages/mcp/lib/scripts (fetch-upstream-docs.ts, build-snapshot.ts, validate-snapshot.ts).
- packages/mcp/src/vendor and packages/mcp/src/patterns now live under src and ship via rslib-builder copyPatterns. The previous postbuild copy script is removed.
- A single-source annotations-heuristic module is consumed by both build-snapshot (fresh refresh seeding) and apply-annotations (idempotent bootstrap for existing snapshots), keeping annotation logic in one place across both maintenance paths.
