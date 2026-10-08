---
type: Limitation
title: Stray output is not persisted and not shown on the CI surfaces
description: "A run's strayOutput rides RunFinished, every AgentReport, the run.json report file and run_tests' result, but it is never written to SQLite and never rendered in the GitHub step summary, summary.md, or the ::group:: log, so no history tool can query it and a CI reader only sees it in the raw job log."
status: draft
bounds: ../modules/reporter.md
tags: [observability, ci]
generated:
  by: okfit/claude-code
  at: 2026-10-08T03:59:37Z
  body_sha256: ee472e694e732ee8da595dc4f6a4f4a5a8f1d9ad116017fbb975f8cf78bc4010
sources:
  - id: plugin-reporter
    resource: ../../packages/plugin/src/reporter.ts
  - id: reporter-default
    resource: ../../packages/reporter/src/defaultReporter.ts
  - id: reporter-github-log
    resource: ../../packages/reporter/src/githubLog.ts
---

# Stray output is not persisted and not shown on the CI surfaces

`AgentReporter` snapshots a run's stray output at `onTestRunEnd` and puts it
on `RunFinished` and every project `AgentReport` as `strayOutput`, and on
nothing else.[^plugin-reporter] Two consequences follow.

**Not persisted.** No SQLite table or column holds it, and the persistence
path never reads it. *Symptom:* `test_history`, `triage_brief` and the other
MCP query tools never mention stray output. The only places it can be read
back are the run's own `run.json` report file, the `run_tests` result
(`report.strayOutput`), and the live render. *Acceptable* because the
signal is about one run's terminal hygiene, not test history. *Fix:* a new
migration adding a column or table, plus a reader on the query tools.

**Not rendered on the CI surfaces.** The note is appended by the ui's
`dispatch` and `dispatchInk` and drawn by `StreamApp`'s final frame. The
GitHub step summary, `summary.md`, and the `::group::` log that
`DefaultVitestAgentReporter` builds for `ci-annotations` do not include
it.[^reporter-default] [^reporter-github-log] *Symptom:* on GitHub
Actions the stray lines show up in the raw job log with no note
explaining them. *Fix:* add a section to the step-summary builder and the
group log. Nobody has scoped it.

[^plugin-reporter]: `../../packages/plugin/src/reporter.ts` (`onTestRunEnd`, `withStrayOutput`)
[^reporter-default]: `../../packages/reporter/src/defaultReporter.ts`
[^reporter-github-log]: `../../packages/reporter/src/githubLog.ts`
