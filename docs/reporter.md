# Direct Reporter Usage

## When to Use Direct vs Plugin

| Approach | Use When |
| --- | --- |
| `AgentPlugin` | You want zero-config environment detection and automatic reporter injection |
| `AgentReporter` | You need full control over output format, detail level, and GitHub Actions settings, or are integrating with custom tooling |

The plugin is a thin wrapper that calls `AgentReporter` internally. Both
produce identical output -- the difference is who manages the options.

## Constructor Options

```typescript
import { AgentReporter } from "vitest-agent-plugin";

const reporter = new AgentReporter({
  cacheDir: ".vitest-agent-reporter",
  consoleOutput: "failures",
  omitPassingTests: true,
  coverageThresholds: { lines: 80, branches: 80 },
  coverageTargets: { lines: 90 },
  autoUpdate: true,
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
| `coverageThresholds` | `{}` | Vitest-native threshold format (per-metric, per-glob) |
| `coverageTargets` | -- | Aspirational targets (same format as thresholds) |
| `autoUpdate` | `true` when targets set | Auto-ratchet baselines when coverage improves |
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
        coverageThresholds: { lines: 80 },
      }),
    ],
  },
});
```

This replaces all reporters with `AgentReporter`. Only structured markdown
is printed to console.

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

In a monorepo with projects named `core:unit` and `api:integration`, all
data is stored in the same SQLite database, organized by project name.

### With Coverage

```typescript
import { AgentReporter } from "vitest-agent-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    reporters: [
      new AgentReporter({ coverageThresholds: { lines: 80 } }),
    ],
    coverage: {
      provider: "v8",
      reporter: ["text"],
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
        coverageThresholds: { lines: 80 },
      }),
    ],
  },
});
```

Setting `githubActions: true` explicitly enables GFM output. By default,
this is auto-detected from `process.env.GITHUB_ACTIONS`. The GFM output
is appended to the file at `process.env.GITHUB_STEP_SUMMARY`.
