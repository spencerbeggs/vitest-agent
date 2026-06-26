# Silencing Leaking Log / Build Output in Tests

## When to use

A test run is polluted with stray log lines, build-tool banners, or framework
diagnostics that drown the signal. The fix differs per source — identify the
source first, then apply the matching technique.

## Guardrail: do not silence output a test asserts on

Before silencing anything, confirm the test does not capture and `expect` on
the output. Some tests deliberately spy on `process.stdout.write` /
`process.stderr.write` (or `console.*`) and assert on `.mock.calls` to verify
what a formatter emits. Silencing those breaks the assertion. If you see a
`vi.spyOn(process.stdout, "write")` whose `.mock.calls` are asserted, that
output is the test subject — leave it alone.

## Decision tree

| Source (what the noise looks like) | Technique |
| --- | --- |
| Effect default logger (`timestamp=… level=INFO message=…`) | Provide a silent logger layer |
| Plain `console.log` / `console.warn` / `console.error` | Spy + mock the method |
| rsbuild (`info build started…`, file-size table) | Set `@rsbuild/core` logger level to silent |
| tsdown / rolldown (`ℹ entry:`, `✔ Build complete`) | Pass `logLevel: "silent"` to the build |
| API Extractor (`(ae-missing-release-tag)` to stderr) | Pass an `onMessage` handler that marks messages handled |

## Effect default logger

Provide a silent logger at the run/layer boundary. This mirrors how the SDK's
own `LoggerLive` builds its silent variant (`packages/sdk/src/layers/LoggerLive.ts`):

```typescript
import { Effect, Logger } from "effect";

const silent = Logger.replace(Logger.defaultLogger, Logger.none);

await Effect.runPromise(program.pipe(Effect.provide(silent)));
```

`Logger.minimumLogLevel(LogLevel.None)` is an equivalent gate.

## Plain `console.*`

```typescript
import { beforeEach, vi } from "vitest";

beforeEach(() => {
 vi.spyOn(console, "warn").mockImplementation(() => {});
 vi.spyOn(console, "error").mockImplementation(() => {});
});
```

## rsbuild reporter

rsbuild writes through its own `logger` singleton, **not** `console.*`, so
console mocks miss it. Set the level and restore it:

```typescript
import { logger } from "@rsbuild/core";

const prev = logger.level;
logger.level = "silent";
try {
 await build();
} finally {
 logger.level = prev;
}
```

## tsdown / rolldown

Pass `logLevel: "silent"` to the build call (or inject a no-op output writer).

## API Extractor

Mark diagnostics handled so they are not printed — this is the production quiet
path:

```typescript
extractorResult = Extractor.invoke(config, {
 messageCallback: (message) => {
  message.handled = true;
 },
});
```

## See also

- `vitest-agent://patterns/known-issues-and-caveats` — distinguishing tooling noise from real failures
- `vitest://docs/api/vi` — the `vi.spyOn` / mock API
