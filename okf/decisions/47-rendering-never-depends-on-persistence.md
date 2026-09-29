---
type: Decision
status: stable
title: Rendering Never Depends on Persistence
description: A test run's results are always rendered, even when the database write that would have persisted them fails.
tags: [architecture, observability]
generated:
  by: okfit/claude-code
  at: 2026-09-29T20:39:41Z
  body_sha256: 2f5e251ad0f8636e6bcf1c11e15dd51a98110c3f18d76bbb3aa15e1affd242ba
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
---

# Rendering Never Depends on Persistence

## Context

`AgentReporter.onTestRunEnd` used to run one Effect program over the
DB-backed services and render from inside it. Any persistence failure — a
rejected migration, a `SQLITE_BUSY`, a bad bind — took the render down with
it: the user got a fatal-error line and no test results at all. Worse, the
failures that triggered this were often caused by the failing tests
themselves — a test that threw a non-string value bound that value to a
`TEXT` column and killed the write, so the exact run the agent most needed
to see was the one that printed nothing.

## Decision

Split the handler into a persist phase and a render phase that runs
unconditionally.

- **Fallback reports are built first, outside any Effect**
  (`packages/plugin/src/reporter.ts`), using the same
  per-project grouping the persist program uses. They are pure
  `buildAgentReport` output — no DB read, no classifier — so they exist
  before persistence is even attempted.
- **Migration failure is no longer fatal.** It records a `persistDisabled`
  reason and skips the persist program instead of returning early
  (`packages/plugin/src/reporter.ts`). The two earlier DB-path
  steps take the same route: a rejecting `ensureDbPath()` — an unreadable
  cache dir or unresolvable workspace identity — leaves `dbPath` undefined
  and records the same kind of reason
  (`packages/plugin/src/reporter.ts`); both used to `return`.
  `onInit`'s own `ensureDbPath()` call is best-effort for the same reason
  (`packages/plugin/src/reporter.ts`): Vitest awaits `onInit`, so
  rejecting there would kill the run before a single test executed.
- **The persist program** (`packages/plugin/src/reporter.ts`) keeps
  every DB-dependent concern and returns a `PersistResult` (`{ reports,
  classifications, trendSummary? }`).
- **The render program always runs**
  (`packages/plugin/src/reporter.ts`), provided
  `OutputPipelineLive` plus `NodeServices.layer` and nothing else — the
  same DB-free wiring the UI-only branch already uses
  (`packages/plugin/src/reporter.ts`). Its input is the
  `PersistResult`, or one synthesized from the fallback reports with empty
  classifications and no trend when persistence was disabled or failed
  (`packages/plugin/src/reporter.ts`).
- **Failure is reported, not hidden.** After rendering, a disabled or
  failed persist phase writes one stderr line: `persistence failed —
  results above were rendered but NOT recorded: <reason>`
  (`packages/plugin/src/reporter.ts`). Degrading silently would
  be worse than crashing — an agent would bank on history that was never
  written.
- **Untrusted error text is coerced at every boundary.** The crashes that
  motivated the split came from values typed as `string` that were not.
  `coerceErrorText` (`packages/sdk/src/utils/coerce-error-text.ts`) is
  applied wherever such a value meets a typed sink. Its companion,
  `coerceErrorField(source, key)`
  (`packages/sdk/src/utils/coerce-error-text.ts`), guards the property
  *read* itself — `coerceErrorField(e, "message")` evaluates a live getter
  at the call site rather than reaching the helper's own exception
  handling after the throw already escaped, so a throwing getter yields a
  placeholder string instead of propagating. `buildAgentReport`'s error
  mapping (`packages/sdk/src/utils/build-report.ts`) reads every
  field of a raw Vitest error object through `coerceErrorField` rather
  than a raw property access or an object spread (`{ ...e }` invokes every
  enumerable getter). The formatters on the failure path —
  `extractSqlReason` (`packages/sdk/src/errors/DataStoreError.ts`),
  `stringifyFailureValue`
  (`packages/plugin/src/utils/stringify-failure-value.ts`), and the
  fatal-error formatter the reporter calls at every persist-disable site —
  are exception-safe for the same reason: a throwing `message` getter,
  Effect's `ConfigError` being the canonical case, would otherwise escape
  the very code meant to report the failure.

## Alternatives rejected

- **Retrying the DB write before giving up on the render:** rejected —
  retry logic adds latency to every run for a failure mode that is rare
  and, when it happens, is often caused by the test run itself (a
  non-string thrown value corrupting a bind). The fix is to make the
  render independent of the outcome, not to make the persist step more
  resilient at the cost of the render's timeliness.
- **Rejecting `onInit`'s `ensureDbPath()` call on failure:** rejected
  because Vitest awaits `onInit`; a rejection there would abort the run
  before a single test executes, which is strictly worse than a
  best-effort resolution that `onTestRunEnd` re-attempts.

## Consequences

- The one remaining no-render failure path is a throw from the fallback
  build itself: `buildAgentReport` walks duck-typed Vitest getters bare,
  so a malformed module shape (a throwing `state()` / `errors()`) is
  caught in the fallback-build `try` and degrades to a fatal-error line on
  stderr with no return value — there is no renderable data to protect at
  that point.
- The two ordinary no-render exits that precede the pipeline — the
  `rendered` idempotence check and an empty `filteredModules` under a
  `projectFilter` — are not failures and are unaffected by this decision.
- Any new I/O added to `onTestRunEnd` must be classified up front as
  belonging to the persist program or the render program; moving a
  DB-requiring service into the render program, or returning early out of
  `onTestRunEnd` for a persistence-side failure, silently reintroduces the
  no-render-on-DB-failure bug this decision closed.

## Related

- [Decision 45 — Suite-Load Failures Count as Failures](./45-suite-load-failures-count-as-failures.md)
- [Decision 48 — Honest Run Reporting](./48-honest-run-reporting.md)
