---
"@vitest-agent/mcp": patch
---

## Performance

- Run `test_overview` and `test_history` DataReader lookups with explicit `Effect.all(..., { concurrency: "unbounded" })` so independent reads can overlap instead of defaulting to sequential execution.

## Tests

- Add `packages/mcp/__test__/effect-concurrency.test.ts` to pin concurrent start behavior for the `test_overview` and `test_history` query bundles.
