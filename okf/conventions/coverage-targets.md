---
type: Convention
title: Coverage targets — thresholds, exclusions, and remap ordering
description: "Root vitest.config.ts enforces AgentPlugin.COVERAGE_LEVELS.basic thresholds via the v8 provider, excludes bin/glue/layer-composition/types-only files with **/-prefixed globs, and depends on excludeAfterRemap to make those excludes match under Vitest 5."
tags: [testing, ci]
status: stable
stale_after: 2027-03-13T00:00:00Z
sources:
  - id: vitest-config
    resource: ../../vitest.config.ts
    title: Root vitest.config.ts coverage block
  - id: coverage-level
    resource: ../../packages/sdk/src/schemas/CoverageLevel.ts
    title: CoverageLevel named presets
  - id: coverage-levels-namespace
    resource: ../../packages/plugin/src/plugin.ts
    title: AgentPlugin.COVERAGE_LEVELS dual-output preset map
  - id: package-json-scripts
    resource: ../../package.json
    title: ci:test script
generated:
  by: okfit/claude-code
  at: 2026-09-14T02:24:39Z
integrity:
  generated:
    body: c337454d72aa424f
---

# Coverage targets — thresholds, exclusions, and remap ordering

## The enforced thresholds come from a named preset, not a hand-written table

Root `vitest.config.ts` sets `test.coverage.thresholds` to
`AgentPlugin.COVERAGE_LEVELS.basic.thresholds` and passes
`AgentPlugin.COVERAGE_LEVELS.basic.coverageTargets` to the plugin's own
`coverageTargets` option[^vitest-config]. `COVERAGE_LEVELS` is a dual-output
map: each named level pairs a stricter `CoverageLevel` preset for the
plugin's own `coverageTargets` policy against a looser one for Vitest's
native `thresholds`, so `basic` enforces `CoverageLevel.basic` (50% lines,
functions, branches, statements) as the native gate while holding
`CoverageLevel.standard` (70% lines/functions/statements, 65% branches) as
the `coverageTargets` this repository is tracking toward[^coverage-levels-namespace][^coverage-level].
Do not read the two numbers as one threshold — a change to either preset
name in `vitest.config.ts` changes both sides of that pair at once, and a
change to `CoverageLevel`'s own static values changes every preset that
derives from it across the whole family.

## Coverage excludes are `**/`-prefixed and depend on `excludeAfterRemap`

The `coverage.exclude` list is written as `**/`-prefixed globs
(`**/cli/src/bin.ts`, `**/reporter/src/index.ts`, `**/engine/src/migrations/**`,
and similar) rather than `packages/`-anchored ones, and the config sets
`excludeAfterRemap: true`[^vitest-config]. Both facts are load-bearing
together: coverage `include` / `exclude` match a root-relative path, and
under a `--project` filter the coverage root becomes that project's own
`config.root`, so a `packages/`-anchored pattern silently stops matching once
a run is scoped to one project. `excludeAfterRemap` applies the exclude list
to the remapped, original-source paths instead of the v8-instrumented output
paths — under Vitest 5 that is what makes a source-file exclude land at all;
without it, v8 filters before the source map is applied and an excluded
module reappears in the report under its transformed identity.

## What is excluded, and why each category is not separately testable

The exclude list targets four categories, each covered by a different test
strategy instead of a coverage number: bin entries
(`packages/{cli,mcp}/src/bin.ts`) and process-owning `main.ts` files, covered
instead by the spawned-bin e2e suites; command glue (`cli/src/commands/**`,
`cli/src/layers/**`), thin wrappers with no independent logic; layer
composition factories that only merge other layers
(`engine/src/layers/OutputPipelineLive.ts`, `engine/src/services/*.ts`); and
types-only modules with no runtime behavior (`reporter/src/index.ts`,
`plugin/src/index.ts`, `cli/src/index.ts`)[^vitest-config]. A file that
belongs in one of these four categories is excluded because a different kind
of test already covers its behavior, or because it has none to cover — do
not add a file to this list to dodge a coverage gap a unit test could close.

## `pool: "forks"` and `ci:test` are the enforcement path, not an optional local nicety

`pool` is set to `"forks"`, not `"threads"`, for broader compatibility with
the SQLite driver[^vitest-config]. CI runs coverage through the root
`ci:test` script (`CI="true" vitest run --coverage`), which sets `CI=true`
and enables the v8 provider[^package-json-scripts] — the same
`vitest.config.ts` thresholds apply whether the run is local or in CI; there
is no separate, looser CI-only threshold.

## Related concepts

- [test-patterns convention](./test-patterns.md) documents the test shapes
  these thresholds are measured against.
- [Decision 38 — Coverage Policy](../decisions/38-coverage-policy-presets-configvalidation-full-and-ui-only-modes.md)
  is the rationale for the preset/`ConfigValidation`/full-vs-UI-only design
  this convention states the current numbers for.

[^vitest-config]: ../../vitest.config.ts
[^coverage-level]: ../../packages/sdk/src/schemas/CoverageLevel.ts
[^coverage-levels-namespace]: ../../packages/plugin/src/plugin.ts
[^package-json-scripts]: ../../package.json
