---
"@vitest-agent/mcp": patch
---

## Refactoring

- Make `test_overview` and `test_history` DataReader bundles pass an explicit `Effect.all(..., { concurrency: "unbounded" })` option so those independent reads keep intentional concurrent-start scheduling.

## Tests

- Add `packages/mcp/__test__/effect-concurrency.test.ts` to pin concurrent start behavior for the `test_overview` and `test_history` query bundles.
