---
type: Decision
status: stable
title: Honest Run Reporting
description: A run's rendered summary states exactly what it knows about collected counts, timeouts, unhandled errors, and per-project reasons, and admits what it does not know rather than defaulting to green.
tags: [observability, testing]
generated:
  by: okfit/claude-code
  at: 2026-09-29T20:39:41Z
  body_sha256: 9af46f435b06c0595a324a550fa8bc59ecd43d5536943007e8aa2d6d52d44d35
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
---

# Honest Run Reporting

## Context

Three separate ways the output could lie about a run, all found together: a
fully-green run rendered "0 modules all-passed", a run that collected
nothing rendered as a satisfied pass, and every project in a multi-project
run recorded `reason = "failed"` when only a single project failed.

## Decision

Carry the collected count explicitly rather than inferring it, and make
every totals consumer fold in every non-passing signal.

- **Collected count.** `AgentReport.summary` carries an optional `modules`
  field, populated from `testModules.length`
  (`packages/sdk/src/utils/build-report.ts`). `RunFinished` and
  `RenderState` carry a matching optional `collectedModules`. `moduleOrder`
  cannot serve as the count because a report replay only queues *failing*
  modules — on a green run it is empty, which is exactly how "0 modules"
  got printed. All producers populate the field: the plugin's live emit
  and both `@vitest-agent/ui` synthesizers (the reducer folds
  `RunFinished.collectedModules` at `packages/ui/src/reducer.ts`).
  Every field is optional, so older replay data and hand-built fixtures
  still decode and fall back to `moduleOrder.length`.
  `formatModulesSection` (`packages/ui/src/render-agent.ts`) prefers
  `state.collectedModules` over `modules.length`
  (`render-agent.ts`), prints an explicit `0 tests collected.`
  warning plus likely causes for a genuinely empty run
  (`render-agent.ts`) rather than a green summary, and omits the
  module sentence entirely when neither count is known.
- **Timeouts are non-passing everywhere the counts are read.** The reducer
  splits timed-out tests out of `failCount` into `timeoutCount` so the
  renderer can say "timed out" rather than "failed" (Vitest itself reports
  both as `failed`). Every consumer of the totals has to re-fold that
  split: `classifyOutcome`
  (`packages/ui/src/dispatcher/classify.ts`) routes
  `timeoutCount > 0` to `some-fail`, below real failures in precedence, so
  a mixed run still reads as a failure run; `formatTotals`
  (`packages/ui/src/dispatcher/helpers.ts`) and
  `formatModulesSection`'s total (`render-agent.ts`) both fold
  `timeoutCount` into the denominator and emit an `N timed out` part.
  `ProjectSummary` carries an optional per-project `timeoutCount`
  (`packages/ui/src/dispatcher/helpers.ts`); a project row
  without it is treated as zero, so the workspace projects table can
  attribute a timeout to its project.
- **`reason` self-corrects inside `buildAgentReport`.** A caller-supplied
  `"passed"` becomes `"failed"` when the walk produced any failed files or
  unhandled errors
  (`packages/sdk/src/utils/build-report.ts`), so no caller can
  report green over a red walk. The MCP `run_tests` tool leans on this and
  passes a deliberately preliminary reason.
- **Unhandled errors are non-passing everywhere too.** `RunFinished` and
  `RenderState` both carry `unhandledErrors: ReportError[]` (`RenderState`
  defaulting to `[]`); every producer populates it — the plugin's live
  `onTestRunEnd` emit from Vitest's own argument, and
  `synthesizeFromAgentReport` from `report.unhandledErrors`.
  `classifyOutcome` treats a non-empty list as `some-fail`
  (`packages/ui/src/dispatcher/classify.ts`) — below real failures,
  above timeouts in precedence — and both renderers add an "Unhandled
  errors:" section (`render-agent.ts` for the agent string). Unlike
  the aggregate Failures section, which the leaf shapes omit because they
  expand each failure inline under its test row, the unhandled-errors
  section is shape-independent: a process-level error has no owning test
  to expand under, so every shape renders it.
- **Per-project run rows derive their own reason.** `writeRun`
  (`packages/plugin/src/reporter.ts`) no longer
  writes Vitest's process-wide `reason` to every project's row; it
  computes `failed` from that project's own `summary.failed` /
  `failedFiles`, with `interrupted` passing through globally because a
  killed run is killed for everyone. This intentionally diverges from
  `baseReport.reason` for an unhandled-error-only project
  (`packages/plugin/src/reporter.ts`): the persisted per-project
  reason looks only at that project's own failed tests and files, so
  `baseReport.reason` can read `"failed"` (self-corrected by
  `buildAgentReport` whenever unhandled errors are present, even with zero
  `failedFiles`) while the `projectReason` written to that row reads
  `"passed"`.

## Alternatives rejected

- **Deriving the collected count from `moduleOrder.length` everywhere:**
  rejected — this is precisely the bug being fixed. A report replay only
  queues failing modules onto `moduleOrder`, so a clean run's `moduleOrder`
  is empty and the count reads zero regardless of how many modules
  actually ran.
- **Writing Vitest's process-wide `reason` to every project's `test_runs`
  row:** the prior behavior; superseded because it marked every project in
  a multi-project run "failed" when only one project failed, which is
  false for the rest.
- **Treating a timeout as an ordinary failure without a separate count:**
  rejected — the whole point of the split is to let the renderer say "N
  timed out" distinctly from "N failed"; folding timeouts back into
  `failCount` unconditionally would lose that distinction the render
  layer depends on.

## Consequences

- Any new totals consumer must fold `timeoutCount` and check
  `unhandledErrors` explicitly, or it can regress to routing a
  timeout-only or unhandled-error-only run into an all-pass cell. The
  split-then-re-fold shape is accepted as the cost of the honest label.
- `ProjectSummary` still carries no per-project breakdown finer than
  `timeoutCount`, so a workspace table cannot attribute anything more
  granular than that to a project's row.
- A reader of `test_runs` must remember that a project's persisted
  `reason` can diverge from the top-level `AgentReport.reason` for an
  unhandled-error-only run — this is intentional, not data corruption.

## Related

- [Decision 45 — Suite-Load Failures Count as Failures](./45-suite-load-failures-count-as-failures.md)
- [Decision 47 — Rendering Never Depends on Persistence](./47-rendering-never-depends-on-persistence.md)
