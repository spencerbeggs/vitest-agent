---
type: Decision
status: stable
title: Suite-Load Failures Count as Failures
description: A test file that fails to load still routes every render and health-check consumer to a failing state.
tags: [architecture, testing, observability]
generated:
  by: okfit/claude-code
  at: 2026-09-29T20:39:41Z
  body_sha256: 93440634a2070ca315f790e11018603b386d163f74a3002b94df8eb6a64e1744
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
---

# Suite-Load Failures Count as Failures

## Context

A test file that failed to *import* — a syntax error, a missing module, a
throwing top-level side effect — rendered as an all-green run. The root
cause: `buildAgentReport` (`packages/sdk/src/utils/build-report.ts`)
deliberately keeps collection/load failures out of `AgentReport.summary`,
which counts test *cases* only (`summary.failed` at
`packages/sdk/src/utils/build-report.ts`) — a file that never produced
a test case contributed nothing to that count. But every render consumer
and health check keyed off `summary`, so a zero-test-case module that
failed to load looked identical to a clean run.

A second gap surfaced later (issue #213): the failed-module gate inside
`buildAgentReport` itself was narrower than the fix below required. It
originally fired only when `module.state() === "failed"` **and** a
non-empty `module.errors()`. Two shapes slipped through: a module Vitest
marks failed without populating `errors()`, and a `beforeAll` / `afterAll`
throw, which Vitest attaches to the *suite* entity and can leave
`module.state()` green while the file is red.

## Decision

Keep `summary` pure (test-case counts only) and fix the consumers to fold
in suite-level failures explicitly, while widening the gate that decides a
module belongs in `report.failed` at all.

- `buildAgentReport` (`packages/sdk/src/utils/build-report.ts`)
  computes `moduleLevelFailure` from three independent signals: the
  module's own `state()`, a suite scan
  (`testModule.children.allSuites()`, `build-report.ts`) that reads
  each suite's `state()` and its optional `errors()` and folds any
  suite-attached errors into the module's error list, and whether the
  module carries any errors at all
  (`build-report.ts`). A module lands in `failed[]` when any test
  case failed OR any of these three module-level signals fired
  (`build-report.ts`), so a hook throw can never hide behind
  passing `it` counts and a module Vitest marks failed without populated
  `errors()` still surfaces.
- A new SDK helper, `countSuiteFailures(report)`
  (`packages/sdk/src/utils/build-report.ts`), counts modules in
  `report.failed` whose `tests` array contains no failed test case — i.e.
  a module that landed in `failed[]` purely on a load/collection or
  suite-level signal, with zero failing test cases of its own.
- `@vitest-agent/reporter`'s `summarizeProject`
  (`packages/reporter/src/defaultReporter.ts`) adds
  `countSuiteFailures(report)` on top of `report.summary.failed` when
  computing each `ProjectSummary.failCount`.
- `@vitest-agent/ui`'s `synthesizeFromAgentReport`
  (`packages/ui/src/synthesize.ts`) emits, for a module with no
  failed test and no timeout, a synthetic `TestStarted` / `TestFinished`
  pair labeled with `SUITE_LOAD_FAILURE_LABEL`
  (`packages/ui/src/synthesize.ts`, `"test suite failed to load"`)
  carrying the module's first error, and counts it toward that module's
  `failCount` (`synthesize.ts`) and the run's
  `RunFinished.failCount` (`synthesize.ts`, `report.summary.failed +
  suiteFailureCount`). The reducer treats `RunFinished.failCount` as the
  authoritative total, so a suite-load failure routes the run to the
  some-fail render cell rather than the all-pass cell.
- `@vitest-agent/plugin`'s `AgentReporter` keys its `hasFailures` health
  signal off `failedFiles.length` (and `unhandledErrors.length`) in both
  the UI-only path (`packages/plugin/src/reporter.ts`) and the
  Full-mode render path (`packages/plugin/src/reporter.ts`), so the
  persistence-side health check sees load failures the same way the
  renderer does.

`summary.failed` stays a pure test-case count precisely because it has
downstream consumers — history, classification, trend math — that must
not have a synthetic non-test-case failure injected into their per-test
arithmetic. `countSuiteFailures` is a parallel seam that lets the *render*
and *health* paths see the true red state without corrupting that
accounting.

## Alternatives rejected

- **Folding suite failures directly into `summary.failed`:** rejected
  because `summary` feeds classification and trend computations that
  assume every unit in the count is an actual test case; a synthetic
  increment would corrupt per-test arithmetic those consumers rely on.
- **Requiring `module.errors()` to be non-empty before treating a module
  as failed:** the original, narrower gate; retired because it missed a
  module Vitest marks failed without populating `errors()` and any
  `beforeAll`/`afterAll` throw, which attaches to the suite entity rather
  than the module and can leave `module.state()` green.

## Consequences

- A file that fails to load now shows up in `failed[]`, contributes to
  `countSuiteFailures`, and routes every render and health-check consumer
  to a failing state — no more "0 passed, 0 failed" for a module that
  never ran.
- Any new consumer of `AgentReport` that reports "did this run pass?" must
  fold `countSuiteFailures(report)` alongside `summary.failed`, or it
  regresses to the original false-green behavior.
- The suite scan in `buildAgentReport` adds one pass over
  `testModule.children.allSuites()` per module; this is the same style of
  duck-typed walk the rest of the function already performs and carries no
  new failure modes of its own beyond what `mapErrors` already guards.

## Related

- [Decision 48 — Honest Run Reporting](./48-honest-run-reporting.md)
