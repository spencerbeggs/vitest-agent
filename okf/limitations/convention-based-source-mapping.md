---
type: Limitation
title: Scoped-run source mapping is a filename regex, not an import graph
description: "A partial run's test-to-source mapping strips a literal .test. or .spec. segment from each executed module's relative path; a test that covers a source file under a differently named path is invisible to scoped-coverage threshold checks."
bounds: ../modules/plugin.md
tags: [architecture, testing]
generated:
  by: okfit/claude-code
  at: 2026-09-14T02:24:39Z
sources:
  - id: tested-files
    resource: ../../packages/plugin/src/reporter.ts
  - id: source-file
    resource: ../../packages/plugin/src/reporter.ts
integrity:
  generated:
    body: 5175a839f14e2a76
---

# Scoped-run source mapping is a filename regex, not an import graph

When `AgentReporter.onTestRunEnd` detects a partial (scoped) run, it
derives the set of source files a threshold check should hold
accountable by mapping each executed test module's relative path through
two regex replacements that strip a trailing `.test` or `.spec` segment
back to the bare extension.[^tested-files] The same transformation runs a
second time, independently, when building the `sourceFile` used to write
a `source_test_map` row.[^source-file]

**Condition.** A scoped/partial run (`run_tests` with a `filter`,
`--project`, or any subset of the full spec list) whose coverage-check
scoping depends on knowing which source files the executed tests cover.

**Symptom.** `foo.test.ts` maps to `foo.ts`, and `bar.spec.ts` maps to
`bar.ts` — that covers the overwhelming majority of this repository's own
layout. A test file that does not follow the `<name>.test.<ext>` /
`<name>.spec.<ext>` convention against its source (co-located tests named
something else, a test exercising a source file under a different
basename, or a test whose only relationship to its source is an import
rather than a filename match) is invisible to this mapping: the regex
either leaves the path unchanged (no source file is derived) or derives a
path that does not exist. `CoverageAnalyzer.processScoped` receives that
derived `testedFiles` set as its allow-list for threshold violations, so
a source file the mapping missed is silently excluded from the scoped
run's threshold check even when a test genuinely covers it.

**Why this is acceptable.** This repository's own `DiscoverStrategy`
enforces the `.test.`/`.spec.` naming convention project-wide (see the
test-layout convention), so the mapping matches every test file this
family itself produces. Building a real import-graph resolver (parsing
each test module's static imports, resolving them through TypeScript's
module resolution, and keeping that graph current across watch-mode
reruns) is a materially larger feature for a scoped-run signal that
already degrades safely — a missed mapping only narrows the check, it
never falsely reports a violation.

**What a fix would take.** A `source_test_map` entry populated by
tracing actual `import` resolution (e.g. via Vite's module graph, already
available inside the same Vitest process) rather than filename
convention, with the naming-convention regex kept as the fast-path
default. `source_test_map`'s schema already supports multiple mapping
types for exactly this kind of future expansion.

[^tested-files]: `../../packages/plugin/src/reporter.ts:1569-1577`
[^source-file]: `../../packages/plugin/src/reporter.ts:2037`
