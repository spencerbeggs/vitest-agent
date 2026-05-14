# Direct Reporter Usage

## When to Use Direct vs Plugin

| Approach | Use When |
| --- | --- |
| `AgentPlugin` | Canonical path — environment detection, console matrix, reporter injection, and `ConfigValidation` all wire automatically |
| `AgentReporter` | **Transitional** — kept exported during the 2.0 split for backward compatibility; prefer `AgentPlugin` for new wiring |

The plugin owns the Vitest lifecycle and constructs an internal
`AgentReporter` per project with `consoleMode` and `coverageMode`
already resolved. Direct `AgentReporter` usage skips that resolution
pipeline (no executor detection, no `ConfigValidation`, no
auto-injected `RunFinished` tap gating) and is not the recommended
2.0 wiring.

## Constructor Options

```typescript
import { AgentReporter } from "vitest-agent-plugin";

const reporter = new AgentReporter({
  cacheDir: ".vitest-agent-reporter",
  consoleOutput: "failures",
  omitPassingTests: true,
  // `coverageThresholds` is deprecated; set Vitest's native
  // `test.coverage.thresholds` instead. The field remains on the
  // schema until the T7 options cleanup.
  coverageTargets: { lines: 90 },
  coverageConsoleLimit: 10,
  includeBareZero: false,
  format: "markdown",
  detail: "standard",
  githubActions: false,
  githubSummaryFile: undefined,
  logLevel: "info",
  logFile: undefined,
  mcp: false,
  projectFilter: undefined,
});
```

All options are optional. Defaults:

| Option | Default | Description |
| --- | --- | --- |
| `cacheDir` | XDG-derived (see [Configuration > Cache Directory Resolution](configuration.md#cache-directory-resolution)) | Override the directory holding `data.db`. When unset, the path is derived from `$XDG_DATA_HOME` and the root workspace name. |
| `consoleOutput` | `"failures"` | `"failures"`, `"full"`, or `"silent"` |
| `omitPassingTests` | `true` | Exclude passing tests from reports |
| `coverageThresholds` | `{}` | **Deprecated** — plugin no longer reads this field (T4 Phase 4); set Vitest's native `test.coverage.thresholds` instead. Schema field kept until T7 cleanup. |
| `coverageTargets` | -- | Aspirational targets, typed `CoverageTargets` schema (positive numbers, `100: true` shortcut, per-glob nested metrics). `perFile` not accepted — inherited from `coverage.thresholds.perFile`. |
| `coverageConsoleLimit` | `10` | Max low-coverage files in console |
| `includeBareZero` | `false` | Include files where all metrics are 0% |
| `format` | auto-detect | Output format: `"markdown"`, `"json"`, `"vitest-bypass"`, `"silent"` |
| `detail` | auto-detect | Detail level: `"minimal"`, `"neutral"`, `"standard"`, `"verbose"` |
| `githubActions` | auto-detect | Force GFM output on/off |
| `githubSummaryFile` | `GITHUB_STEP_SUMMARY` env | Override GFM output path |
| `logLevel` | `"info"` | Effect log level: `"debug"`, `"info"`, `"warn"`, `"error"`, `"none"` |
| `logFile` | -- | Path to write log output (defaults to stderr) |
| `mcp` | `false` | Show MCP tool hints in "Next steps" output |
| `projectFilter` | -- | Glob pattern to filter which projects are included in output |

Note: both `AgentPlugin` and `AgentReporter` resolve `cacheDir` the
same way in 2.0 — by deriving an XDG path from the root workspace
`name`. Setting `cacheDir` explicitly skips the resolver and uses the
literal path. See
[Configuration > Cache Directory Resolution](configuration.md#cache-directory-resolution)
for the full priority order, including the optional
`vitest-agent.config.toml` overrides.

## Lifecycle Hooks

`AgentReporter` implements three Vitest Reporter lifecycle hooks:

### `onInit(vitest)`

Called once at the start of the test run. Stores the Vitest instance for
project enumeration.

### `onCoverage(coverage)`

Called after coverage collection but **before** `onTestRunEnd`. Stashes the
istanbul `CoverageMap` as instance state. Both `@vitest/coverage-v8` and
`@vitest/coverage-istanbul` normalize to the same interface -- the reporter
duck-types at runtime, so no specific coverage provider is required as a
peer dependency.

### `onTestRunEnd(testModules, unhandledErrors, reason)`

The main hook where all output is generated. Processing steps:

1. Initialize the SQLite database if needed
2. Group test modules by `testModule.project.name`
3. Process stashed coverage data (if available)
4. Build per-project `AgentReport` objects
5. Write test runs, modules, test cases, errors, coverage, and history
   to the SQLite database via `DataStore`
6. Compute and write baselines and trends
7. Emit console output (unless `"silent"`)
8. Write GFM summary to `GITHUB_STEP_SUMMARY` (if GitHub Actions)

Database write failures are logged to stderr but never crash the test run.

## Vitest Configuration

### Basic Setup

```typescript
import { AgentReporter } from "vitest-agent-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    reporters: [
      "default",
      new AgentReporter({ consoleOutput: "silent" }),
    ],
  },
});
```

This keeps Vitest's default reporter for human-readable output and adds
`AgentReporter` in silent mode for database persistence only.

### Agent-Only Setup

```typescript
import { AgentReporter } from "vitest-agent-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    reporters: [
      new AgentReporter({
        consoleOutput: "failures",
      }),
    ],
    coverage: {
      enabled: true,
      provider: "v8",
      thresholds: { lines: 80 },
    },
  },
});
```

This replaces all reporters with `AgentReporter`. Only structured markdown
is printed to console. Coverage thresholds live on Vitest's native
`test.coverage.thresholds` in 2.0.

### Monorepo Setup

No special configuration needed. The reporter groups results by Vitest
project name automatically:

```typescript
import { AgentReporter } from "vitest-agent-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    reporters: [
      new AgentReporter({ cacheDir: ".vitest-agent-reporter" }),
    ],
  },
});
```

In a monorepo with one project per workspace package (e.g. `core` and
`api`), all data is stored in the same SQLite database, organized by
project name. Test kind (unit / integration / e2e) is expressed via
Vitest 4.1 tags rather than project-name suffixes — see
[Configuration > Project Discovery](configuration.md#project-discovery)
and the
[DiscoverStrategy API](configuration.md#discoverstrategy-api)
section for how the plugin classifies test files into tags.

### With Coverage

```typescript
import { AgentReporter } from "vitest-agent-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    reporters: [new AgentReporter({})],
    coverage: {
      enabled: true,
      provider: "v8",
      reporter: ["text"],
      thresholds: { lines: 80 },
    },
  },
});
```

The reporter integrates with coverage data from the `onCoverage` hook.
Both `v8` and `istanbul` providers work -- the reporter duck-types the
coverage map interface at runtime.

### GitHub Actions

```typescript
import { AgentReporter } from "vitest-agent-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    reporters: [
      "default",
      new AgentReporter({
        consoleOutput: "silent",
        githubActions: true,
      }),
    ],
    coverage: {
      enabled: true,
      provider: "v8",
      thresholds: { lines: 80 },
    },
  },
});
```

Setting `githubActions: true` explicitly enables GFM output. By default,
this is auto-detected from `process.env.GITHUB_ACTIONS`. The GFM output
is appended to the file at `process.env.GITHUB_STEP_SUMMARY`.
