---
type: Decision
title: Vitest-Native Tag Classification
description: Test-kind (unit/int/e2e) classification rides Vitest's native tag system via a file-task transform prelude, instead of per-kind project splitting or a colon-suffixed project name.
status: stable
tags:
  - architecture
  - testing
generated:
  by: okfit/claude-code
  at: 2026-09-29T20:39:41Z
  body_sha256: b4f02f1b1d0c1e13bb984d91ea114efb54a47f3aa3dfbfdd262109efd4a96354
sources:
  - id: plugin-discover-strategy
    resource: ../../packages/plugin/src/utils/discover-strategy.ts
  - id: plugin-inject-tags
    resource: ../../packages/plugin/src/utils/inject-tags.ts
  - id: plugin-discover-projects
    resource: ../../packages/plugin/src/utils/discover-projects.ts
  - id: plugin-plugin-ts
    resource: ../../packages/plugin/src/plugin.ts
  - id: engine-migration-0001
    resource: ../../packages/engine/src/migrations/0001_initial.ts
  - id: sdk-dispatcher-contract
    resource: ../../packages/sdk/src/contracts/dispatcher.ts
  - id: sdk-format-terminal
    resource: ../../packages/sdk/src/utils/format-terminal.ts
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
---

# Vitest-Native Tag Classification

## Context

Test-kind differentiation (`unit`, `int`, `e2e`) needs to answer queries like
"all unit tests across the workspace" or "everything tagged `e2e` in one
package" without coupling the concept of test kind to a Vitest project's
identity. An earlier 1.x form encoded kind as a colon suffix on the project
name (`my-app:unit`, `my-app:e2e`) and split it back apart with
`splitProject()`; that bled a `(project, subProject)` column pair into every
table and forced one Vitest project per kind per package, and was retired
once Vitest's native tag system could express the same queries.

## Decision

`discoverProjects()` (`packages/plugin/src/utils/discover-projects.ts`) emits
exactly one Vitest project per workspace package, keyed by package name. Test
kind is derived separately, by filename suffix, through
`DiscoverStrategy.classify` (`packages/plugin/src/utils/discover-strategy.ts`):
the `DefaultDiscoverStrategy` registers three tags —
`Tag.make("unit")`, `Tag.make("int", { timeout: 60_000 })`, and
`Tag.make("e2e", { timeout: 120_000, retry: process.env.CI ? 2 : 0 })`
(`packages/plugin/src/utils/discover-strategy.ts`) — and classifies a
module by matching `.e2e.(test|spec).*` or `.int.(test|spec).*` against its
path (`packages/plugin/src/utils/discover-strategy.ts`).

The plugin turns those classifications into real Vitest tags at collection
time rather than at config time. Its Vite `transform` hook
(`packages/plugin/src/utils/inject-tags.ts`) prepends a guarded prelude
per matched file that calls the runner's public
`TestRunner.getCurrentSuite()` static and unions the classified tags array
onto the file task's `tags` (`packages/plugin/src/utils/inject-tags.ts`).
Vitest's runner unions parent tags into every suite and test registered
under that file task, so every declaration form inherits them — including
wrapper testers such as `@effect/vitest`'s `it.effect`, which a retired
per-call AST rewrite had corrupted (issue #133); a prelude that only touches
the file-level task sidesteps per-call rewriting entirely.

`AgentPlugin.discover()` (`packages/plugin/src/plugin.ts`) returns
`{ projects, tags }` so the tag list a `DiscoverStrategy` declares flows
straight into `defineConfig({ test: { projects, tags } })` — the tags a
strategy registers are exactly the tags Vitest itself knows about for
filtering.

Storage keeps one `project` column, holding only the package name
(`packages/engine/src/migrations/0001_initial.ts`) — no `subProject`
companion. Per-tag pass/fail/skip aggregates are computed by the plugin
reporter and attached to `AgentReport.tagCounts`
(`packages/sdk/src/contracts/dispatcher.ts`) for terminal rendering
(`packages/sdk/src/utils/format-terminal.ts`). Filtering at the
command line uses Vitest's own tag-expression syntax (e.g. `--tags-filter
"int"`) rather than a bespoke `subProject` filter parameter.

## Alternatives rejected

- **Colon-suffixed project names with a `(project, subProject)` column
  pair** (the retired 1.x form): rejected because it forced one Vitest
  project per kind per package, coupled test-kind semantics to a string
  convention on the project name, and required every consumer of the
  identity (CLI, MCP, `HistoryTracker.classify`, baselines, trends, notes,
  sessions) to carry a `subProject` field just to unwind the encoding.
- **Per-call AST rewriting of test declarations to inject tags directly on
  each `it`/`test` call**: rejected because it does not generalize to
  wrapper testers layered over Vitest's primitives — `@effect/vitest`'s
  `it.effect` broke under this approach (issue #133). A file-task-level
  prelude that relies on Vitest's own tag inheritance avoids per-call
  rewriting altogether.

## Consequences

- Test-kind filtering is Vitest-native: `--tags-filter` works the same way
  for this project's classification as for any tag a consumer adds by hand,
  and no bespoke `subProject` filter surface needs to exist anywhere in the
  CLI or MCP tool set.
- One project per package means coverage, transform config, and Vite plugin
  wiring are configured once per package rather than duplicated per kind —
  see [Decision 39](./39-unified-discoverstrategy-discoverbuilder.md) for how
  `DiscoverStrategy` and `DiscoverBuilder` compose the classify layers that
  drive this.
- The tag-injection prelude is a transform-time cost paid once per matched
  file, and depends on `TestRunner.getCurrentSuite()` remaining a stable
  public static on the version of Vitest in use — a Vitest internals change
  to suite/task registration is the kind of change that would break this
  mechanism.

## Related

- [Decision 39 — Unified DiscoverStrategy + DiscoverBuilder](./39-unified-discoverstrategy-discoverbuilder.md)
