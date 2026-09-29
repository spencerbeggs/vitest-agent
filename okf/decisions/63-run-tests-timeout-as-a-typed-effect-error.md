---
type: Decision
status: stable
title: run_tests Timeout as a Typed Effect Error
description: Why the MCP run_tests tool models its Vitest-start timeout through Effect's typed TimeoutError channel instead of a Promise.race against a string-sentinel rejection.
tags: [architecture, mcp, effect]
generated:
  by: okfit/claude-code
  at: 2026-09-29T20:39:41Z
  body_sha256: 76811ff3a5512c2ba852e5eef87510e4af71002df4ff1d8d68b9d8a57d4ad915
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
---

# run_tests Timeout as a Typed Effect Error

## Context

`run_tests` used to bound `localVitest.start(...)` with a `Promise.race` against a `setTimeout` that rejected with `new Error("VITEST_TIMEOUT")`; the catch handler then probed `err instanceof Error && err.message === "VITEST_TIMEOUT"` to emit the `{ kind: "timeout" }` result. A string sentinel in `.message` is not a type: any ordinary failure whose message happened to be exactly `VITEST_TIMEOUT` (a test, a plugin, a user's own throw) was reported as a timeout, and the timer/race bookkeeping was hand-rolled.

## Decision

The start call is wrapped in `Effect.tryPromise` and piped through `Effect.timeout(timeoutMs)`, `Effect.map` (→ `outcome: "ok"`), `Effect.catchTag("TimeoutError", …)` (→ `outcome: "timeout"`), and `Effect.catchTag("VitestStartFailure", …)` (→ `outcome: "failed", cause`) (`packages/mcp/src/tools/run-tests.ts`). The result is a success-channel discriminated outcome, so classification happens entirely inside Effect combinators rather than the tool's `catch` block inspecting a message: `timeout` returns `{ kind: "timeout", timeoutSeconds }` (`packages/mcp/src/tools/run-tests.ts`), `failed` rethrows the original cause into the existing `{ kind: "error" }` envelope (`packages/mcp/src/tools/run-tests.ts`), and an error whose message is literally `VITEST_TIMEOUT` now yields `{ kind: "error" }` like any other failure.

Two Effect v4 facts this relies on: `Effect.timeout` fails with `Cause.TimeoutError`, whose `_tag` is `"TimeoutError"`, so `Effect.catchTag("TimeoutError", …)` recovers from exactly that failure and nothing else; and the rejection is wrapped in a tagged `VitestStartFailure` error rather than left `unknown`, because an `unknown` member would collapse `Effect.catchTag`'s tag parameter to `never` (`packages/mcp/src/tools/run-tests.ts`). Folding both branches into the success channel — rather than leaving them as promise rejections — also sidesteps `Effect.runPromise`'s lack of a guarantee that a rejection value is the bare error.

## Alternatives rejected

Continuing to distinguish timeout from ordinary failure by string-matching `.message` was rejected outright as the bug being fixed: any code path that happened to throw with that exact message text would be misclassified. Leaving the two outcomes as promise rejections and matching on error identity in the `catch` block was rejected because `Effect.runPromise` does not guarantee the rejection value is the bare typed error, which would reintroduce a different flavor of the same fragile-matching problem.

## Consequences

Effect fiber interruption cannot cancel an in-flight Promise, so on timeout the underlying Vitest run is still only best-effort abandoned; the `finally` block's `vitest.close()` does the actual teardown, unchanged from before. Any future error thrown from inside `localVitest.start(...)` is automatically routed through `VitestStartFailure` and the `{ kind: "error" }` envelope rather than needing its own message-matching branch, so extending the failure surface here means adding to the tagged-error catch chain, not to a string comparison.
