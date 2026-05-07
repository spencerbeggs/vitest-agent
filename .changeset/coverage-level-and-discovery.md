---
"vitest-agent-sdk": minor
"vitest-agent-plugin": minor
---

## Features

### CoverageLevel

New `CoverageLevel` class in `vitest-agent-sdk` provides named coverage presets with a fluent API for composing threshold and target configurations.

Five built-in presets (accessible via `AgentPlugin.COVERAGE_LEVELS`):

| Preset | Lines | Branches | Functions | Statements |
| --- | --- | --- | --- | --- |
| `none` | 0 | 0 | 0 | 0 |
| `basic` | 50 | 40 | 50 | 50 |
| `standard` | 70 | 65 | 70 | 70 |
| `strict` | 80 | 80 | 80 | 80 |
| `full` | 100 | 100 | 100 | 100 |

```ts
AgentPlugin({
  coverageThresholds: "standard",
  coverageTargets: AgentPlugin.COVERAGE_LEVELS.strict.extend({ branches: 80 }),
})
```

* `.extend({ lines?, branches?, functions?, statements? })` — return a new level with overridden fields
* `.withPerFile()` — return a per-file variant of the same level
* `AgentPlugin.COVERAGE_LEVELS_PER_FILE` — convenience constant with all five presets pre-configured for per-file enforcement

`coverageThresholds` and `coverageTargets` are now top-level options on `AgentPlugin()` in addition to the existing `reporterOptions` path.

### AgentPlugin.discover()

New `AgentPlugin.discover(options?)` static method automatically discovers Vitest projects from your workspace layout. Use it with an async config export to populate `test.projects` before Vitest reads the config:

```ts
export default async () => {
  const projects = await AgentPlugin.discover();
  return defineConfig({
    plugins: [AgentPlugin()],
    test: { projects, pool: "forks" },
  });
};
```

The scanner walks all workspace packages, detects test files in both `src/` and `__test__/` directories, classifies them by filename suffix (`.e2e.`, `.int.`, or plain), and emits typed `VitestProject` objects. Results are cached per workspace root within the process.

The `options` argument accepts either:

* A top-level callback `({ projects }) => void | Promise<void>` for full-list mutation after discovery.
* A per-kind object `{ unit?, int?, e2e? }` where each value is a config fragment merged into `test.*` or a `(projectsMap) => void | Promise<void>` callback scoped to that kind.

### VitestProject

New `VitestProject` builder class in `vitest-agent-plugin` constructs typed `TestProjectInlineConfiguration` objects. Available via static factories:

* `VitestProject.unit({ name, include, overrides? })`
* `VitestProject.int({ name, include, overrides? })`
* `VitestProject.e2e({ name, include, overrides? })`
* `VitestProject.custom({ name, include, kind?, overrides? })`

Fluent mutators: `.override(config)`, `.addInclude(glob)`, `.addExclude(glob)`, `.addCoverageExclude(glob)`. Call `.toConfig()` to get the final `TestProjectInlineConfiguration`.

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

* `makeTestLayer(filename)` — builds a fully-migrated SQLite layer backed by a real file, ready for use with `ManagedRuntime` or `Effect.provide`
* `DataStoreTestLayer` — convenience `:memory:` layer for unit tests that need the full DataStore + DataReader stack
* Five preset factories that seed representative DB states: `empty`, `singlePassingRun`, `withFailures`, `flaky`, `withTddSession`

```ts
import { makeTestLayer, singlePassingRun } from "vitest-agent-sdk/testing";

// Fresh empty DB at a temp path
const layer = makeTestLayer("/tmp/test.db");

// Pre-seeded with one passing run
const layer = singlePassingRun("/tmp/test.db");
```
