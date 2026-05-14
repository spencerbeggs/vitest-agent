# Configuration

## AgentPlugin Options

`AgentPlugin` is the recommended entry point. It wraps `AgentReporter` and
handles environment detection, reporter injection, and cache directory
resolution automatically.

```typescript
import { AgentPlugin } from "vitest-agent-plugin";
import { defineConfig } from "vitest/config";

export default async () => {
  const { projects, tags } = await AgentPlugin.discover();
  const coverage = AgentPlugin.COVERAGE_LEVELS.standard;
  return defineConfig({
    plugins: [
      AgentPlugin({
        console: { human: "passthrough", agent: "agent", ci: "passthrough" },
        coverageTargets: coverage.coverageTargets,
        reporterOptions: {
          coverageConsoleLimit: 5,
        },
      }),
    ],
    test: {
      projects,
      tags,
      pool: "forks",
      coverage: {
        enabled: true,
        provider: "v8",
        thresholds: coverage.thresholds,
      },
    },
  });
};
```

The 2.0 plugin reads coverage thresholds from Vitest's native
`test.coverage.thresholds` only. The legacy `AgentPlugin({ coverageThresholds })`
field was removed from the plugin's read path in T4 Phase 4 — it remains
on the schema until the T7 options cleanup, but the plugin ignores it.

### `console`

The pre-2.0 `mode` and `strategy` (a.k.a. `consoleStrategy`) options are
gone. Console output is now controlled by a per-executor matrix. The plugin
auto-detects the executor (`human`, `agent`, or `ci`) via `EnvironmentDetector`,
looks up the matching slot, and resolves a single `ConsoleMode` value.

```typescript
AgentPlugin({
  console: {
    human?: "passthrough" | "silent" | "ink" | "agent",
    agent?: "passthrough" | "silent" | "agent",
    ci?:    "passthrough" | "silent" | "ci-annotations",
  },
});
```

Per-slot defaults:

| Slot | Default | Rationale |
| --- | --- | --- |
| `human` | `"passthrough"` | Vitest's own reporters do the visible work |
| `agent` | `"agent"` | Markdown-flavored final-frame string |
| `ci` | `"passthrough"` | Vitest's reporters produce log-friendly output |

Available `ConsoleMode` values:

| Value | Behavior |
| --- | --- |
| `"passthrough"` | Vitest's reporters keep ownership of stdout; the plugin emits no console output |
| `"silent"` | Plugin strips Vitest's reporters and emits nothing |
| `"agent"` | Plugin strips Vitest's reporters and emits the markdown-flavored agent string |
| `"ink"` | Plugin strips Vitest's reporters and renders the live React Ink view (drive via `onRunEvent` — see below) |
| `"ci-annotations"` | Plugin strips Vitest's reporters and emits GitHub Actions annotations |

Two derived behaviors fall out of the resolved mode:

1. **Stdout ownership.** Any non-`"passthrough"` value strips Vitest's
   built-in console reporters (`default`, `verbose`, `tree`, `dot`, `tap`,
   `tap-flat`, `hanging-process`, `agent`) and suppresses Vitest's native
   coverage text reporter. Non-console reporters (`json`, `junit`, `html`,
   `blob`, `github-actions`) and any custom reporters you've registered
   are preserved.
2. **`onRunEvent` gating.** The plugin only forwards `onRunEvent` to the
   internal reporter when the resolved mode is `"ink"`. Other modes
   suppress the tap so a live Ink mount cannot leak into a channel the
   user explicitly opted out of.

### `onRunEvent`

Live event tap. The plugin forwards every per-test and per-module `RunEvent`
to this callback as the run progresses; hosts drive a live renderer from
here. Pair with `console.<slot>: "ink"` and the `createLiveInk` helper from
`vitest-agent-ui`:

```typescript
import { AgentPlugin } from "vitest-agent-plugin";
import { createLiveInk } from "vitest-agent-ui";
import { defineConfig } from "vitest/config";

const live = createLiveInk();

export default async () => {
  const { projects, tags } = await AgentPlugin.discover();
  return defineConfig({
    plugins: [
      AgentPlugin({
        console: { human: "ink" },
        onRunEvent: live.event,
      }),
    ],
    test: { projects, tags, pool: "forks" },
  });
};
```

Throwing taps are caught and logged to stderr — persistence never breaks
because a live renderer has a bug. When the resolved mode is anything other
than `"ink"`, the plugin drops `onRunEvent` silently.

### `reporter`

Optional `VitestAgentReporterFactory`. Defaults to `defaultReporter` from
`vitest-agent-reporter`, which selects a formatter based on `kit.config.format`
and adds the GitHub Summary sidecar under GitHub Actions. To use the
event-sourced renderer end-to-end (the same path the live Ink view rides),
pass `eventSourcedReporter` from `vitest-agent-ui`:

```typescript
import { AgentPlugin } from "vitest-agent-plugin";
import { eventSourcedReporter } from "vitest-agent-ui";

AgentPlugin({
  console: { agent: "agent" },
  reporter: eventSourcedReporter,
});
```

`eventSourcedReporter` emits the agent string when `consoleMode === "agent"`
and emits nothing for `"ink"`, `"ci-annotations"`, `"silent"`, and
`"passthrough"` (the channels that own the visible work themselves).

### `format`

`format` is an opt-in formatter override for the default reporter factory.
When unset, the plugin derives it from the resolved console mode. Most
users never set this; prefer `console` instead.

| Value | Behavior |
| --- | --- |
| `"markdown"` | Structured markdown output |
| `"terminal"` | Terminal-flavored output (the default for `"agent"` and `"ink"` modes) |
| `"json"` | JSON output |
| `"vitest-bypass"` | Defer to Vitest's reporters (the default for `"passthrough"`) |
| `"silent"` | No console output |
| `"ci-annotations"` | GitHub Actions annotations |

### `logLevel`

Log level for Effect runtime logging. Accepts `"debug"`, `"info"`,
`"warn"`, `"error"`, or `"none"`. Case-insensitive. When set to `"debug"`,
the reporter emits detailed logs for each lifecycle hook and Effect service
call. Defaults to `"info"`.

### `logFile`

Path to a log file. When set, Effect runtime log output is written to this
file instead of stderr. Useful for capturing debug output without polluting
the terminal.

### `mcp`

When `true`, the "Next steps" section of console output includes a hint
to use MCP tools (`test_history`, `test_coverage`, `test_trends`) for
deeper analysis. Defaults to `false`. Set automatically when the Claude
Code plugin is active.

### `tagStrategy`

Controls the Vite transform that injects Vitest 4.1 tags into every
`test()` and `it()` call based on the test file's path. Defaults to
`TagStrategy.default`, which classifies `.e2e.test.ts` as `e2e`,
`.int.test.ts` as `int`, and everything else as `unit`. Set to `false`
to disable the transform so no tags are injected at parse time. The
companion `AgentPlugin.discover({ tagStrategy: false })` separately
omits the matching `TestTagDefinition[]` from the returned `tags`
array; both calls are needed to fully opt out of tagging. See
[Project Discovery](#project-discovery) for how tags pair with the
`tags` array returned from `AgentPlugin.discover()`, and the
[`Tag` and `TagStrategy` API](#tag-and-tagstrategy-api) section below
for the public classes.

### `coverageThresholds` (deprecated — ignored by the plugin)

This was the pre-T4 plugin-owned threshold input. As of T4 Phase 4 the
plugin no longer reads it; the field remains on the schema only until
the T7 options cleanup removes it entirely. Set Vitest's native
`test.coverage.thresholds` instead — that is the single source of
truth for failure-tier coverage in 2.0. See
[Coverage Thresholds](#coverage-thresholds).

### `coverageTargets`

Aspirational coverage goals using a typed `CoverageTargets` schema
(numeric `lines` / `branches` / `functions` / `statements`, the
`100: true` shortcut, and nested per-glob `CoverageTargetsMetrics`
entries). Falling below a target produces a "yellow" hint — not a
failure. Zero and negative values are rejected at decode time, and
`perFile` is inherited from `coverage.thresholds.perFile` (specifying
it on `coverageTargets` produces a `PERFILE_ON_TARGETS` warning). See
[Coverage Targets](#coverage-targets).

### `reporterOptions`

Nested reporter options passed through to the internal `AgentReporter`. The
plugin manages console output and GitHub Actions detection automatically
based on environment detection, so those fields are not available through
the plugin interface.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `cacheDir` | `string` | XDG-derived (see [Cache Directory Resolution](#cache-directory-resolution)) | Override the cache directory path |
| `coverageConsoleLimit` | `number` | `10` | Max low-coverage files shown in console |
| `omitPassingTests` | `boolean` | `true` | Exclude passing tests from reports |
| `includeBareZero` | `boolean` | `false` | Include files where all four metrics are 0% |
| `githubSummaryFile` | `string` | `GITHUB_STEP_SUMMARY` env var | Override the GFM output file path |

> **Note.** The pre-T4 `reporterOptions.autoUpdate` boolean was removed
> in T4 Phase 4. Auto-ratcheting coverage thresholds is now driven by
> Vitest's native `coverage.thresholds.autoUpdate` callback — use
> `AgentPlugin.COVERAGE_AUTOUPDATE.standard` (or `.strict` / `.lenient`)
> to set the tolerance function. The plugin's `coverageTargets` baseline
> tracking is independent and runs whenever `coverageTargets` is set.

## Project Discovery

`AgentPlugin.discover(options?)` scans the workspace packages for test
files and returns `{ projects, tags }`. Pass `projects` to Vitest's
`test.projects` and `tags` to `test.tags` so Vitest's
`--tags-filter` flag and the tag-aware test API can resolve every tag
the plugin injects:

```typescript
import { AgentPlugin } from "vitest-agent-plugin";
import { defineConfig } from "vitest/config";

export default async () => {
  const { projects, tags } = await AgentPlugin.discover();
  const coverage = AgentPlugin.COVERAGE_LEVELS.standard;
  return defineConfig({
    plugins: [AgentPlugin({ coverageTargets: coverage.coverageTargets })],
    test: {
      projects,
      tags,
      pool: "forks",
      coverage: { enabled: true, provider: "v8", thresholds: coverage.thresholds },
    },
  });
};
```

Once configured, you can filter test runs by tag with Vitest's built-in
flag:

```bash
pnpm vitest run --tags-filter "int"
pnpm vitest run --tags-filter "unit and not e2e"
```

The scanner emits **one project per workspace package** and looks for
test files in two locations per package:

- `packages/*/__test__/*.test.ts` (canonical, flat layout)
- `packages/*/src/**/*.test.ts` (co-located, accepted for backward compatibility)

Helper subdirectories inside `__test__/` (`utils/`, `fixtures/`,
`snapshots/`) are excluded automatically. Test kind is no longer
expressed by suffixing the project name (`pkg:unit`, `pkg:int`,
`pkg:e2e` are gone in 2.0); instead, the active `TagStrategy`
classifies every test file by path and the plugin's Vite transform
injects the resolved tags into the call site, so Vitest's tag
expressions can drive filtering and per-kind timeouts.

The `options` argument accepts either:

- A callback `({ projects }) => void | Promise<void>` to mutate the
  discovered project list in place after scanning.
- An object `{ callback?, tagStrategy? }` where `callback` is the same
  projects mutator and `tagStrategy` is a `TagStrategy` instance (or
  `false` to omit tag definitions from the returned `tags` array).
  Note that `discover()` only controls the returned configuration; the
  Vite transform that injects tags at parse time is configured via
  `AgentPlugin({ tagStrategy })`. Pass `false` to both to fully opt
  out of tagging.

The pre-2.0 per-kind override form (`{ unit?, int?, e2e? }` keyed by
test kind) was removed when discovery consolidated to one project per
package; per-kind shaping now happens through `TagStrategy.classify()`
rather than through projects.

Discovery results are cached per workspace root within the process when
called with no options. Passing a `tagStrategy` or callback skips the
cache.

## Tag and TagStrategy API

`AgentPlugin` exports `Tag` and `TagStrategy` so you can author your
own classification logic. A `TagStrategy` declares the available tags
(timeouts, retries, etc.) and a `classify({ module })` function that
maps each test file to one or more tag names. The default strategy
ships `unit`, `int` (60s timeout), and `e2e` (120s timeout, retry 2
under CI):

```typescript
import { AgentPlugin, Tag, TagStrategy } from "vitest-agent-plugin";

const strategy = TagStrategy.create({
  tags: [
    Tag.make("unit"),
    Tag.make("contract", { timeout: 30_000 }),
    Tag.make("smoke", { timeout: 5_000 }),
  ],
  classify: ({ module }) => {
    if (module.filename.endsWith(".smoke.test.ts")) return ["smoke"];
    if (module.filename.endsWith(".contract.test.ts")) return ["contract"];
    return ["unit"];
  },
});

export default async () => {
  const { projects, tags } = await AgentPlugin.discover({
    tagStrategy: strategy,
  });
  return defineConfig({
    plugins: [AgentPlugin({ tagStrategy: strategy })],
    test: { projects, tags, pool: "forks" },
  });
};
```

`TagStrategy.default.extend({ ... })` chains an extra classifier on top
of the built-in strategy; the extension layer receives the parent's
inherited tags so you can decorate without rewriting. The two surfaces
that accept `tagStrategy` cover different concerns:
`AgentPlugin({ tagStrategy: false })` disables the Vite transform that
injects tags at parse time, and
`AgentPlugin.discover({ tagStrategy: false })` omits tag definitions
from the returned `tags` array. Pass `false` to both to fully opt out
of tagging.

The classification context exposes `ModuleInfo` (`path`,
`relativePath`, `filename`, `packageName`, `packagePath`),
`ClassifyBaseContext` (the bare context passed to the base layer),
and `ClassifyExtendedContext` (adds the `inherited` tags array for
extension layers). Tag construction options are typed as `TagOptions`.

## AgentPlugin.runScript()

`AgentPlugin.runScript(command)` runs a shell command synchronously,
suppressing all output unless the command fails. Designed for use in
Vitest `globalSetup` files to execute build steps or other preparatory
commands without cluttering agent stdout:

```typescript
// vitest.setup.ts
import { AgentPlugin } from "vitest-agent-plugin";

export function setup() {
  AgentPlugin.runScript("pnpm exec turbo run build:dev --output-logs=errors-only");
}
```

When the command fails, the captured stderr and stdout are replayed to
their respective streams before rethrowing, so errors are still visible to
humans and surfaced in CI logs.

Reference the setup file from your Vitest config via `test.globalSetup`:

```typescript
export default async () => {
  const { projects, tags } = await AgentPlugin.discover();
  return defineConfig({
    plugins: [AgentPlugin()],
    test: {
      projects,
      tags,
      pool: "forks",
      globalSetup: ["vitest.setup.ts"],
    },
  });
};
```

Three namespace constants are available on `AgentPlugin`:

| Constant | Description |
| --- | --- |
| `AgentPlugin.COVERAGE_LEVELS` | Object with keys `none \| basic \| standard \| strict \| full`, each returning a dual-output `{ thresholds, coverageTargets }` preset |
| `AgentPlugin.COVERAGE_LEVELS_PER_FILE` | Same as above with `perFile: true` applied to the `thresholds` half only (`coverageTargets` inherits `perFile` from `coverage.thresholds.perFile`) |
| `AgentPlugin.COVERAGE_AUTOUPDATE` | Three `(newThreshold: number) => number` tolerance functions (`standard` floors, `strict` ceils, `lenient` floors and subtracts 2) suitable for Vitest's native `coverage.thresholds.autoUpdate` |

Each `COVERAGE_LEVELS` preset's `coverageTargets` half is the
**next-level-up** preset's threshold numbers, so passing `standard`
sets the floor at `standard` (passed to Vitest) and the aspirational
goal at `strict` (passed to the plugin). The `full` preset is capped
at itself.

Canonical wiring — destructure a preset once, then pass each half to
its rightful owner:

```typescript
const coverage = AgentPlugin.COVERAGE_LEVELS.standard;

defineConfig({
  plugins: [AgentPlugin({ coverageTargets: coverage.coverageTargets })],
  test: {
    coverage: {
      enabled: true,
      provider: "v8",
      thresholds: coverage.thresholds,
    },
  },
});
```

Use `COVERAGE_AUTOUPDATE` to control Vitest's auto-ratcheting tolerance:

```typescript
defineConfig({
  test: {
    coverage: {
      thresholds: {
        autoUpdate: AgentPlugin.COVERAGE_AUTOUPDATE.standard,
        lines: 80,
      },
    },
  },
});
```

## AgentReporter Options

When using `AgentReporter` directly (without the plugin), all options are
available:

```typescript
import { AgentReporter } from "vitest-agent-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    reporters: [
      new AgentReporter({
        cacheDir: ".vitest-agent-reporter",
        consoleOutput: "failures",
        omitPassingTests: true,
        coverageConsoleLimit: 10,
        includeBareZero: false,
        format: "markdown",
        detail: "standard",
        githubActions: false,
        githubSummaryFile: undefined,
      }),
    ],
    coverage: {
      enabled: true,
      provider: "v8",
      thresholds: { lines: 80, branches: 80 },
    },
  },
});
```

Coverage thresholds live on Vitest's native `test.coverage.thresholds`
in 2.0 — the direct-reporter `coverageThresholds` field is kept on the
schema for transitional compatibility but is no longer the recommended
input.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `cacheDir` | `string` | XDG-derived (see [Cache Directory Resolution](#cache-directory-resolution)) | Directory for the SQLite database (`data.db`) |
| `consoleOutput` | `"failures"` `"full"` `"silent"` | `"failures"` | Console output verbosity |
| `omitPassingTests` | `boolean` | `true` | Exclude passing tests from reports |
| `coverageThresholds` | `object` | `{}` | **Deprecated** — set Vitest's native `test.coverage.thresholds` instead. Schema field kept until T7 cleanup. |
| `coverageTargets` | `CoverageTargets` | -- | Aspirational coverage targets (typed positive numbers, `100: true` shortcut, per-glob nested metrics; no `perFile`) |
| `coverageConsoleLimit` | `number` | `10` | Max low-coverage files shown in console |
| `includeBareZero` | `boolean` | `false` | Include files where all four metrics are 0% |
| `format` | `OutputFormat` | auto-detect | Output format: `"markdown"`, `"json"`, `"vitest-bypass"`, `"silent"` |
| `detail` | `DetailLevel` | auto-detect | Detail level: `"minimal"`, `"neutral"`, `"standard"`, `"verbose"` |
| `githubActions` | `boolean` | auto-detect | Force GFM output on/off |
| `githubSummaryFile` | `string` | `GITHUB_STEP_SUMMARY` env var | Override the GFM output file path |
| `logLevel` | `string` | `"info"` | Effect log level: `"debug"`, `"info"`, `"warn"`, `"error"`, `"none"` |
| `logFile` | `string` | -- | Path to write log output (defaults to stderr) |
| `mcp` | `boolean` | `false` | Show MCP tool hints in "Next steps" output |
| `projectFilter` | `string` | -- | Glob pattern to filter which projects are included in output |

### `format` (OutputFormat)

Controls the output format for console output:

| Value | Behavior |
| --- | --- |
| `"markdown"` | Structured markdown (default for agent environments) |
| `"json"` | JSON output |
| `"vitest-bypass"` | Defer to Vitest's built-in reporters |
| `"silent"` | No console output |

### `detail` (DetailLevel)

Controls the verbosity of console output:

| Value | Behavior |
| --- | --- |
| `"minimal"` | One-line summary (used for green-tier all-pass runs) |
| `"neutral"` | Summary with coverage hints (used for yellow-tier below-target runs) |
| `"standard"` | Full detail with errors and diffs (used for red-tier failures) |
| `"verbose"` | Maximum detail including passing tests |

When not set, the detail level is resolved automatically based on the
executor (agent, human, CI) and run health (all pass, below targets,
failures).

## Cache Directory Resolution

In 2.0 the SQLite database lives at an XDG-derived path keyed off the
root workspace's `package.json` `name`. The default location is:

```text
$XDG_DATA_HOME/vitest-agent/<workspaceName>/data.db
# falling back to
~/.local/share/vitest-agent/<workspaceName>/data.db
```

`<workspaceName>` is the `name` field from your root workspace's
`package.json`, normalized for filesystem safety (so `@org/pkg` becomes
`@org__pkg`). Two checkouts of the same repo therefore share history,
and the database survives `rm -rf node_modules`.

Resolution priority (highest to lowest):

1. **Explicit option** -- `reporter.cacheDir` (plugin) or `cacheDir`
   (direct reporter). Used as a literal path; the resolver short-circuits.
2. **`vitest-agent.config.toml` at the workspace root** --
   either `cacheDir = "./.vitest-agent-reporter"` (override the entire
   directory) or `projectKey = "my-app-personal"` (override just the
   `<workspaceName>` slot).
3. **XDG default** -- `$XDG_DATA_HOME/vitest-agent/<workspaceName>/`.

The workspace root is located by walking up from the project directory
looking for a `pnpm-workspace.yaml`, a `workspaces` field in
`package.json`, or a `.git` directory.

To opt back into the 1.x project-local layout, drop a
`vitest-agent.config.toml` next to your root `package.json`:

```toml
cacheDir = "./.vitest-agent-reporter"
```

## Coverage Thresholds

Coverage thresholds in 2.0 are owned by Vitest. Set them on
`test.coverage.thresholds` in your Vitest config; the plugin reads
this value via `configureVitest` and uses it to flag "Coverage gaps"
in console output and reports.

```typescript
defineConfig({
  test: {
    coverage: {
      enabled: true,
      provider: "v8",
      thresholds: {
        lines: 80,
        branches: 75,
        functions: 80,
        statements: 80,
      },
    },
  },
});
```

Vitest's native threshold format supports per-metric values, per-glob
patterns, the `perFile` toggle, and negative numbers (interpreted as
"maximum uncovered items"). `100` enforces full coverage.

```typescript
defineConfig({
  test: {
    coverage: {
      thresholds: {
        lines: 80,
        "src/utils/**": { lines: 90 },
        "src/generated/**": { lines: 0 },
      },
    },
  },
});
```

The pre-T4 plugin-owned `coverageThresholds` field is deprecated. The
plugin's read path was removed in T4 Phase 4 — the field remains on
the schema only until the T7 options cleanup ships, and the plugin's
`ConfigValidation` service emits `THRESHOLD_WITHOUT_TARGET` /
`TARGET_WITHOUT_THRESHOLD` warnings keyed off Vitest's native config.

**Bare-zero files** (all four metrics at 0%) are excluded by default. These
are typically generated files, re-exports, or index files with no executable
code. Set `includeBareZero: true` to include them.

## Coverage Targets

Targets represent aspirational coverage goals. Unlike thresholds, falling
below a target does not produce a "red" failure -- it produces a "yellow"
hint showing room for improvement.

```typescript
defineConfig({
  plugins: [AgentPlugin({ coverageTargets: { lines: 90 } })],
  test: {
    coverage: {
      enabled: true,
      provider: "v8",
      thresholds: { lines: 70 }, // hard floor (Vitest-native)
    },
  },
});
```

`coverageTargets` uses the typed `CoverageTargets` schema: positive
numeric values per metric (`lines`, `branches`, `functions`,
`statements`), the `100: true` shortcut, and nested per-glob
`CoverageTargetsMetrics` entries. Zeros and negatives are rejected
at decode time. `perFile` is **not** accepted on `coverageTargets` —
targets inherit `perFile` from `coverage.thresholds.perFile`, so
duplicating it on the targets half just risks drift (the plugin's
`ConfigValidation` rule `PERFILE_ON_TARGETS` flags this).

### Auto-Ratcheting Baselines

When `coverageTargets` is set, the reporter automatically tracks a
high-water mark (baseline) for each metric. When coverage improves, the
baseline ratchets up so it never regresses. Baselines are stored in the
SQLite database; ratcheting always runs when `coverageTargets` is set.

For Vitest's native threshold auto-ratcheting (a separate mechanism
that mutates `test.coverage.thresholds.*` numbers on disk after a
green run), use the `AgentPlugin.COVERAGE_AUTOUPDATE` tolerance
functions:

```typescript
defineConfig({
  test: {
    coverage: {
      thresholds: {
        lines: 80,
        autoUpdate: AgentPlugin.COVERAGE_AUTOUPDATE.standard,
      },
    },
  },
});
```

## Coverage Trends

The reporter records a coverage trend entry on each full test run. Trends
are stored per project in the SQLite database with a 50-entry sliding
window.

Console output uses a three-tier system based on coverage state:

| Tier | Condition | Console behavior |
| --- | --- | --- |
| Green | All tests pass, all targets met | Single success line with trend direction |
| Yellow | All tests pass, some files below targets | "Room for improvement" section with target gaps |
| Red | Test failures or files below thresholds | Standard failure output with coverage gaps |

Use the CLI `trends` command for detailed trend analysis:

```bash
npx vitest-agent trends
```

## Coverage Config Validation

The plugin runs a `ConfigValidation` service during `configureVitest`
that inspects the combined `(coverage.thresholds, coverageTargets)`
pair and emits diagnostics. Warnings print to stderr prefixed with
`[vitest-agent:plugin]`; errors throw before Vitest starts the run.

Operating mode is derived from `coverage.enabled`:

| Mode | Trigger | Effect |
| --- | --- | --- |
| Full | `coverage.enabled` truthy (or unset and `--coverage` passed) | All rules run; reporter persists data, classifies, and computes baselines/trends |
| UI-only | `coverage.enabled === false` | Provider rules skipped; reporter short-circuits before persistence, still fires renderer events |

The starter rule registry:

| Rule | Severity | Description |
| --- | --- | --- |
| `TARGET_WITHOUT_THRESHOLD` | warn | `coverageTargets` set but no matching `coverage.thresholds` — targets fire yellow hints with no red floor underneath |
| `TARGET_BELOW_THRESHOLD` | error | An aspirational target sits below its hard floor — typo or paste-error |
| `THRESHOLD_WITHOUT_TARGET` | silent | Threshold set with no target — no diagnostic (valid posture; you have a floor, no aspirational goal) |
| `INVALID_TARGET_VALUE` | error | Zero, negative, or non-numeric target value (top-level or nested glob) |
| `UNSUPPORTED_PROVIDER` | error (Full only) | `coverage.provider` is something other than `v8` or `istanbul` |
| `MISSING_PROVIDER_PACKAGE` | error (Full only) | `@vitest/coverage-<provider>` not installed; includes install-command remediation |
| `PERFILE_ON_TARGETS` | warn | `perFile` specified inside `coverageTargets` — inherited from `coverage.thresholds.perFile`, so duplicating risks drift |

## Console Output Modes

`consoleOutput` is a `AgentReporter`-internal knob controlling the
verbosity of the agent string. The plugin sets it automatically based on the
resolved `console` mode and run health, and most users do not need to touch
it. When using `AgentReporter` directly (without the plugin), the available
values are:

### `"failures"` (default)

Shows only failed tests with error messages, diffs, and re-run commands.
Coverage gaps are shown if any files are below threshold. When all tests
pass, a single success line is printed.

### `"full"`

Same as `"failures"` but also includes passing test counts and full module
listings.

### `"silent"`

No console output. Data is still written to the SQLite database. GFM
output is still produced when in GitHub Actions.

## Forcing a Specific Console Mode

There is no global "force agent" toggle in 2.0. Override the per-slot value
directly on the resolved executor to take ownership of console output:

```typescript
// Always emit the agent markdown frame on a human terminal
AgentPlugin({ console: { human: "agent" } })

// Always suppress console output for CI runs
AgentPlugin({ console: { ci: "silent" } })

// Wire the live Ink view to every executor
AgentPlugin({ console: { human: "ink", agent: "ink", ci: "ink" }, onRunEvent: live.event })
```

Useful for:

- **Reviewing agent output locally** — force `human: "agent"` to see the
  markdown frame from a regular terminal.
- **Persistence-only CI pipelines** — set `ci: "silent"` when you only want
  data in SQLite (the GFM summary still writes when `githubSummary` is on).
- **Custom tooling** — pin a slot to a specific mode for agents the
  `EnvironmentDetector` does not yet classify.

## Agent Detection

The `EnvironmentDetector` uses
[std-env](https://github.com/nicolo-ribaudo/std-env) for agent detection.
The following environment variables are checked (list maintained by
`std-env` and may expand as new agents are added):

| Variable | Value | Agent |
| --- | --- | --- |
| `AI_AGENT` | any truthy | Cross-tool standard |
| `AUGMENT_AGENT` | `"1"` | Augment Code |
| `CLAUDECODE` | `"1"` | Claude Code |
| `CLINE_ACTIVE` | `"true"` | Cline (VS Code extension) |
| `CODEX_SANDBOX` | any value | OpenAI Codex CLI |
| `CURSOR_TRACE_ID` | any value | Cursor IDE |
| `CURSOR_AGENT` | `"1"` | Cursor CLI agent |
| `GEMINI_CLI` | `"1"` | Gemini CLI / Gemini Code Assist |
| `AGENT` | any truthy | Goose, Amp, generic agents |

If no agent variables match, CI detection runs:

| Variable | Value | Result |
| --- | --- | --- |
| `GITHUB_ACTIONS` | `"true"` or `"1"` | CI mode |
| `CI` | `"true"` | CI mode |

If nothing matches, the environment is classified as `"human"`.
