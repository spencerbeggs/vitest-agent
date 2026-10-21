---
type: Limitation
title: Coverage is one workspace-wide map, copied under every project's run
description: "Vitest fires one onCoverage per run against a single global CoverageMap; the one aggregating AgentReporter analyzes it once, then writes the same file_coverage rows and trend entry under every project's run_id, so per-project coverage queries all return the whole-workspace figures and storage grows with the project count (issue 622)."
bounds: ../modules/plugin.md
tags: [architecture, observability]
status: draft
generated:
  by: okfit/claude-code
  at: 2026-10-21T16:41:41Z
sources:
  - id: oncoverage
    resource: ../../packages/plugin/src/reporter.ts
  - id: dedup
    resource: ../../packages/plugin/src/reporter.ts
  - id: baselines
    resource: ../../packages/plugin/src/reporter.ts
  - id: per-project-write
    resource: ../../packages/plugin/src/reporter.ts
  - id: one-reporter
    resource: ../../packages/plugin/src/plugin.ts
  - id: issue-622
    resource: https://github.com/spencerbeggs/vitest-agent/issues/622
integrity:
  generated:
    body: 6479857f3c577d61
---

# Coverage is one workspace-wide map, copied under every project's run

Vitest's coverage provider calls `onCoverage` once per test run with a
single istanbul `CoverageMap` that spans every project in the run. It is
not scoped per project. `AgentReporter.onCoverage` stashes it for the later
`onTestRunEnd` pass[^oncoverage].

The plugin pushes exactly one aggregating `AgentReporter` per Vitest run,
with no `projectFilter`[^one-reporter]. That reporter analyzes the stashed
map once with `CoverageAnalyzer.process` (or `processScoped` on a partial
run)[^dedup], against the `__global__` baselines[^baselines]. It then walks
every project in the run and, inside that per-project loop, writes the same
`file_coverage` rows and coverage trend entry under each project's
`run_id`[^per-project-write].

The `projectFilter` / `primaryProject` check in the same block is a guard
for a reporter constructed with a `projectFilter`. The plugin no longer
constructs one, so for every plugin-driven run the guard always passes.

**Condition.** Coverage enabled. The duplication grows with the number of
projects in the run.

**Symptom.** Every project's latest run carries the same whole-workspace
coverage: per-file tiers, totals, and trend. A consumer querying coverage
for project A sees the files project B's tests covered too.
`file_coverage` grows by files × projects per run: one full run of
spencerbeggs/effected writes 3,520 rows, 88 files × 40 projects, all from
one map[^issue-622].

**Why this is acceptable.** Istanbul's `CoverageMap` has no project
boundary: a file is covered by whichever test exercised it, whichever
project ran that test. There is no correct per-project split to compute.
The readers rely on the copies: `DataReader.getCoverage(project)` and
`getLatestRun(project)` read coverage by that project's latest `run_id`, so
writing the rows once would empty every other project's coverage. Since
the run is persisted in one transaction ([Decision
84](../decisions/84-run-persistence-transaction.md)), the duplicate inserts
cost little time; what remains is storage.

**What a fix would take.** Issue 622 proposes writing coverage and its
trend row once per invocation, and having readers resolve a project run's
coverage through the sibling run in the same `invocation_id` that carries
the rows. That needs no schema change. It also proposes limiting stored
files to the configured `coverage.include` and project sources.

[^oncoverage]: `../../packages/plugin/src/reporter.ts:1522`
[^dedup]: `../../packages/plugin/src/reporter.ts:2002-2030`
[^baselines]: `../../packages/plugin/src/reporter.ts:1996-1999`
[^per-project-write]: `../../packages/plugin/src/reporter.ts:2088` (per-project loop), `../../packages/plugin/src/reporter.ts:2532` (`writeCoverage`), `../../packages/plugin/src/reporter.ts:2546` (`writeTrends`)
[^one-reporter]: `../../packages/plugin/src/plugin.ts:639-653`
[^issue-622]: <https://github.com/spencerbeggs/vitest-agent/issues/622>
