---
"@vitest-agent/mcp": patch
---

## Bug Fixes

- `run_tests` now models its run timeout as a typed Effect error instead of racing a `Promise` against a `setTimeout` that rejected with the string sentinel `"VITEST_TIMEOUT"`. An ordinary error whose message happened to be exactly `"VITEST_TIMEOUT"` was previously misreported as a timeout; it now correctly surfaces through the `{ kind: "error" }` envelope, while a real timeout still reports `{ kind: "timeout" }` (#320).
