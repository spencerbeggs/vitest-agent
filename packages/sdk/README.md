# vitest-agent-sdk

Shared library for the
[vitest-agent](https://github.com/spencerbeggs/vitest-agent)
package family. Carries everything `vitest-agent-plugin`,
`vitest-agent-reporter`, `vitest-agent-ui`, `vitest-agent-cli`, and
`vitest-agent-mcp` need:

- Effect schemas, error types, SQLite migrations
- `DataStore` and `DataReader` services with their live + test layers
- Output pipeline (`OutputRenderer`, `FormatSelector`, `DetailResolver`,
  `ExecutorResolver`, `EnvironmentDetector`)
- Formatters (markdown, gfm, json, silent)
- `RunEvent` and `RenderState` schemas consumed by `vitest-agent-ui`'s
  reducer and live PubSub channel
- `HistoryTracker`, `ProjectDiscovery`, classification utilities
- XDG-based path resolution (`resolveDataPath`, `PathResolutionLive`,
  `ConfigLive`)
- `LoggerLive`, `ensureMigrated`, and shared utilities
- `TurnPayload` Effect Schema union for Claude Code session/turn logging
- `computeFailureSignature` and `findFunctionBoundary` for stable failure
  identity hashing across line drift
- `validatePhaseTransition` pure validator for TDD phase-transition
  evidence binding

You almost certainly don't install this directly — install
`vitest-agent-plugin` and the runtime packages get pulled in via
peer dependencies.

## Testing utilities (`vitest-agent-sdk/testing`)

The `vitest-agent-sdk/testing` subpath exports test helpers for packages
that write Effect-based tests against the data layer. Import from the subpath,
not the root entry:

```typescript
import {
  makeTestLayer,
  DataStoreTestLayer,
  empty,
  singlePassingRun,
  withFailures,
  flaky,
  withTddSession,
} from "vitest-agent-sdk/testing";
```

`makeTestLayer(filename)` builds a fully-migrated in-process SQLite layer
(`DataStoreLive + DataReaderLive + SqliteMigrator`). Pass `":memory:"` for a
transient database or a file path for a persistent fixture.

`DataStoreTestLayer` is a convenience shorthand for `makeTestLayer(":memory:")`.

The five preset factory functions seed representative database states and are
useful for testing components that read from the data layer without needing to
write fixtures by hand:

| Factory | Seeded state |
| --- | --- |
| `empty(filename)` | Migrated database with no data |
| `singlePassingRun(filename)` | One passing run with three test cases |
| `withFailures(filename)` | One run with two failures and two passes |
| `flaky(filename)` | Two runs: first fails, second passes (same test) |
| `withTddSession(filename)` | A TDD session with one goal and two behaviors |

Example usage with Vitest:

```typescript
import { Effect } from "effect";
import { DataReader } from "vitest-agent-sdk";
import { singlePassingRun } from "vitest-agent-sdk/testing";

it("returns the latest run", async () => {
  const layer = singlePassingRun(":memory:");
  const result = await Effect.runPromise(
    Effect.provide(
      Effect.flatMap(DataReader, (r) => r.getLatestRun("default", null)),
      layer,
    ),
  );
  expect(result?.reason).toBe("passed");
});
```

## Install

```bash
npm install vitest-agent-sdk
```

## Documentation

See the [main README](https://github.com/spencerbeggs/vitest-agent#readme)
for usage and the architecture overview.

## License

[MIT](./LICENSE)
