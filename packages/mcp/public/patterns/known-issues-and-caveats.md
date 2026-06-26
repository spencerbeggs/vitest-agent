# Known Issues & Instrumentation Caveats

## When to use

A test run surfaced an error or oddity that looks like a vitest-agent bug.
Check it against this list first — several are upstream Vitest behavior, an
already-shipped fix, or a misconception, not something to investigate as a
consumer-side problem.

## `DataStoreError` on a UNIQUE collision — live, retry

A concurrent agent registration (on `idempotency_key`) or two concurrent turn
writes (on `(session_id, turn_no)`) can race the persistence layer's
check-then-insert and surface a `DataStoreError` carrying
`UNIQUE constraint failed`. It is not a consumer bug and not data corruption —
retry the operation. The SELECT pre-check narrows but does not close the race.

## `coverage/.tmp … ENOENT coverage-0.json` — inherent Vitest, not a bug

Running Vitest in two processes at once (for example a CLI run alongside the
`vitest-vscode` extension) makes them share Vitest's default
`coverage.reportsDirectory`, and one process can delete the temp dir the other
is writing. vitest-agent never sets `reportsDirectory`, so this is an upstream
multi-process Vitest caveat. Give each concurrent process its own
`coverage.reportsDirectory` (or serialize them).

## `MaxPerformanceEntryBufferExceededWarning` — resolved, stop chasing it

This `perf_hooks` warning on long runs was fixed in a shipped
`@vitest-agent/reporter` release: React 19's development reconciler emits a
`performance.measure()` per render, and the live renderer now drains Node's
user-timing buffer after each render cycle. If you still see it, update
`@vitest-agent/reporter`. Do not investigate it as a fault in your own repo.

## Stale test counts — re-run, there is no warm cache

Moving or adding test files does not require an MCP restart. Discovery is
re-walked fresh on every Vitest run; the MCP serves counts from the database,
which only updates when tests are re-run. Stale numbers mean the tests have not
been re-run — not that a discovery cache is warm. Restarting the MCP would not
refresh them.

## A run that rebuilds `dist/` mid-run — expected

A host project's Vitest `globalSetup` may call `AgentPlugin.runScript(...)`
(for example `pnpm turbo run build:dev`), which can transiently tear down and
rebuild `dist/` during the run. This is the host project's configuration, not a
broken workspace.

## See also

- `vitest-agent://patterns/running-tests-via-mcp` — why subset runs "fail" coverage thresholds
