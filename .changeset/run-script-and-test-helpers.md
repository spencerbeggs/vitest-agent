---
"vitest-agent-sdk": minor
"vitest-agent-plugin": minor
---

## Features

### AgentPlugin.runScript()

New `AgentPlugin.runScript(command)` static method runs a shell command silently. Output is suppressed on success; stdout and stderr are surfaced only if the command exits non-zero. Designed for use in Vitest `globalSetup` files to build packages before the test run without polluting agent context:

```ts
// vitest.setup.ts
import { AgentPlugin } from "vitest-agent-plugin";
export function setup() {
  AgentPlugin.runScript("pnpm exec turbo run build:dev --output-logs=errors-only");
}
```

### vitest-agent-sdk/testing subpath

New `vitest-agent-sdk/testing` subpath export provides test-layer utilities and seeded fixture factories for integration tests:

- `makeTestLayer(filename)` — builds a fully-migrated SQLite layer backed by a real file, ready for use with `ManagedRuntime` or `Effect.provide`
- `DataStoreTestLayer` — convenience `:memory:` layer for unit tests that need the full DataStore + DataReader stack
- Five preset factories that seed representative DB states: `empty`, `singlePassingRun`, `withFailures`, `flaky`, `withTddTask`

```ts
import { makeTestLayer, singlePassingRun } from "vitest-agent-sdk/testing";

// Fresh empty DB at a temp path
const layer = makeTestLayer("/tmp/test.db");

// Pre-seeded with one passing run
const layer = singlePassingRun("/tmp/test.db");
```
