---
"@vitest-agent/mcp": major
---

## Breaking Changes

* Removed the `withIdempotency` export and the idempotency module. Replay of repeated tool calls is now handled by the kit's `ToolReplay`, so remove any direct use of `withIdempotency`.
* TDD error envelopes are now built through `ToolOutcome`. The served `$defs/TddErrorEnvelope` schema is preserved, and error envelopes now carry a `message` field.

## Bug Fixes

* `run_tests` is serialized on an exclusive lane with `ProcessScope` and `StdioCapture`, so a hung `vitest.start` no longer wedges cancellation.
* The crash-injection environment variable is parsed through `McpGuard`.
