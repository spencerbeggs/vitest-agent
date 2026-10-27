---
"@vitest-agent/mcp": major
---

## Breaking Changes

* Removed the `withIdempotency` export and the idempotency module. Replay of repeated tool calls is now handled by the kit's `ToolReplay`, so remove any direct use of `withIdempotency`.
* TDD error envelopes are now built through `ToolOutcome` and carry a `message` field. `tdd_goal` and `tdd_behavior` keep serving `$defs/TddErrorEnvelope` and `$defs/TddBehaviorErrorEnvelope`, but `error` is now a union of the five tagged TDD errors rather than an open record, so a client that generated types from the served schema sees a stricter shape.

## Bug Fixes

* `run_tests` is serialized on an exclusive lane with `ProcessScope` and `StdioCapture`, so a hung `vitest.start` no longer wedges cancellation.
* The crash-injection environment variable is parsed through `McpGuard`.
