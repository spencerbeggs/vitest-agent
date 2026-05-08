# Testing Effect Services with Mock Layers

## When to use

Reach for this pattern when an Effect service has external dependencies (filesystem, SQLite, network) that you do not want to exercise in unit tests. The codebase under `packages/sdk/src/services/` and `packages/sdk/src/layers/` follows this exact shape.

## The shape

Every Effect service has three pieces:

1. **The service tag** (`Context.Tag`) and interface — under `services/`.
2. **The live layer** — wires real I/O against `@effect/platform` adapters.
3. **The test layer** — usually a mutable state container that records what the service was asked to do, with read methods you assert against.

You compose the live layer in production wiring (`ReporterLive`, `CliLive`, `McpLive`); you compose the test layer in tests.

## Minimal example

```typescript
import { Effect, Layer, Ref } from "effect";
import { describe, expect, it } from "vitest";
import { DataStore } from "vitest-agent-sdk";

// Test layer: accumulates writes into a Ref so tests can read them back.
const DataStoreTest = Layer.effect(
 DataStore,
 Effect.gen(function* () {
  const writes = yield* Ref.make<{ runs: ReadonlyArray<unknown> }>({ runs: [] });
  return DataStore.of({
   writeRun: (input) =>
    Ref.update(writes, (s) => ({ runs: [...s.runs, input] })).pipe(
     Effect.as(1),
    ),
   // ... other methods stubbed similarly
  });
 }),
);

it("records the run", async () => {
 const program = Effect.gen(function* () {
  const store = yield* DataStore;
  yield* store.writeRun({ project: "x" });
  // assert via your accumulator pattern
 });
 await Effect.runPromise(program.pipe(Effect.provide(DataStoreTest)));
});
```

## Why not mock the FileSystem directly?

Layer-level swapping is the testable seam Effect was designed around. Mocking `@effect/platform`'s FileSystem implementation works but loses the type checking that ensures your test layer matches the live interface. Layer.effect with the same Tag forces you to satisfy every method.

## Anti-patterns

- **Don't `Effect.runPromise` inside service implementations** — providing `DataStoreTest` and then having the service call `Effect.runPromise` internally bypasses the layer.
- **Don't share `Ref`s across tests** — construct the test layer per-test (or use `beforeEach`) so accumulated state doesn't bleed.
- **Don't assert on layer construction order** — Effect normalizes the merge graph.

## See also

- `vitest://docs/guide/mocking` — Vitest mocking guide (general background)
- `vitest-agent://patterns/testing-effect-schema-definitions` — Companion pattern; most service inputs are Schema-typed
- `packages/sdk/src/layers/DataStoreTest.ts` — The canonical example in this codebase
