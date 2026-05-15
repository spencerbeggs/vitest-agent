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
        console: { human: "ink", agent: "agent" },
        coverageTargets: coverage.coverageTargets,
      }),
    ],
    test: {
      ...(projects ? { projects } : {}),
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
| `"ink"` | Plugin strips Vitest's reporters and renders the live React Ink view; the live-mount lifecycle is owned by the plugin |
| `"ci-annotations"` | Plugin strips Vitest's reporters and emits GitHub Actions annotations |

One derived behavior falls out of the resolved mode:

**Stdout ownership.** Any non-`"passthrough"` value strips Vitest's built-in console reporters (`default`, `verbose`, `tree`, `dot`, `tap`, `tap-flat`, `hanging-process`, `agent`) and suppresses Vitest's native coverage text reporter. Non-console reporters (`json`, `junit`, `html`, `blob`, `github-actions`) and any custom reporters you've registered are preserved.

When `console.human` resolves to `"ink"`, the plugin mounts the live React Ink view itself. There is no `createLiveInk` import for users to wire and no live-event callback to forward — the lifecycle is fully internal in 2.0.

### `onRunEvent`

Optional stream-tee callback. When set, the plugin forwards every per-test and per-module `RunEvent` to your callback as the run progresses, alongside its own internal consumer. This is read-only introspection — your callback runs in parallel with the built-in renderer, not in place of it. The plugin forwards events for every resolved console mode; channel suppression is the reporter's job, not the tap's.

```typescript
import { AgentPlugin } from "vitest-agent-plugin";
import { defineConfig } from "vitest/config";

export default async () => {
  const { projects, tags } = await AgentPlugin.discover();
  return defineConfig({
    plugins: [
      AgentPlugin({
        console: { agent: "agent" },
        onRunEvent: (event) => {
          // Read-only tee — log, ship to telemetry, etc.
          // The built-in renderer still runs.
          process.stderr.write(`[run] ${event._tag}\n`);
        },
      }),
    ],
    test: { ...(projects ? { projects } : {}), tags, pool: "forks" },
  });
};
```

Throwing taps are caught and logged to stderr — persistence never breaks because a callback has a bug.

### `reporter`

Optional `VitestAgentReporterFactory` override. When unset, the plugin wires its built-in default reporter (preassembled inside `vitest-agent-ui`), which classifies the run into one of four shapes (single-test, single-file, single-project, workspace) and three outcomes (all-pass, some-fail, threshold-violation) and dispatches to the matching cell. Each render carries a footer line pointing at the right MCP tool for the dominant outcome.

Users rarely need to set this. Custom reporters depend on `vitest-agent-reporter` to pull the contract types (`VitestAgentReporterFactory`, `ReporterKit`, `RenderedOutput`) and the dispatch helpers (`buildDispatchInputs`, `resolveCellOptions`) from a single import:

```typescript
import type {
  ReporterKit,
  VitestAgentReporter,
  VitestAgentReporterFactory,
} from "vitest-agent-reporter";
import {
  buildDispatchInputs,
  resolveCellOptions,
} from "vitest-agent-reporter";

const myReporter: VitestAgentReporterFactory = (kit: ReporterKit): VitestAgentReporter => ({
  async render(input) {
    // assemble DispatchInputs / CellOptions the same way the built-in does,
    // then emit your own RenderedOutput[].
    return [];
  },
});

AgentPlugin({
  console: { agent: "agent" },
  reporter: myReporter,
});
```

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

### `discoverStrategy`

Controls both project discovery and the Vite transform that injects
Vitest 4.1 tags into every `test()` and `it()` call based on the test
file's path. Defaults to `DefaultDiscoverStrategy`, which emits one
project per workspace package (recognising both `src/` and
`__test__/` layouts) and classifies `.e2e.test.ts` as `e2e`,
`.int.test.ts` as `int`, and everything else as `unit`. Set to
`false` to disable the Vite transform so no tags are injected at
parse time. Pass a custom `DiscoverStrategy` instance to override
both halves at once — the same strategy you hand to
`AgentPlugin.discover()` should be passed here so discovery results
and the transform stay in sync. See
[Project Discovery](#project-discovery) for the discovery surface
and the
[`DiscoverStrategy` API](#discoverstrategy-api) section below
for the public classes.

The pre-T5 `tagStrategy` plugin option was renamed to
`discoverStrategy` when the legacy `TagStrategy` namespace and the
`VitestProject` builder class were folded into a single
`DiscoverStrategy` contract. Renaming the field is the only required
edit for projects that previously relied on the default strategy.

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

### `transport`

Forward-declared persistence binding. 2.x ships only `{ kind: "local" }`, which is the default and you do not need to set it. The shape is modeled as a single-member discriminated union so a future cloud-backend swap lands as a pure addition of new variants. Most users ignore this field.

> **Note.** The pre-T7 nested `reporterOptions` wrapper was removed. `cacheDir` moved to `vitest-agent.config.toml` (see [Cache Directory Resolution](#cache-directory-resolution)). `coverageConsoleLimit`, `omitPassingTests`, `includeBareZero`, and `githubSummaryFile` are renderer-internal defaults now — write a custom `reporter` factory if you need to override them. The pre-T4 `autoUpdate` boolean moved to Vitest's native `coverage.thresholds.autoUpdate` — use `AgentPlugin.COVERAGE_AUTOUPDATE.standard` (or `.strict` / `.lenient`) for the tolerance function. The `coverageTargets` baseline tracking is independent and runs whenever `coverageTargets` is set.

## Project Discovery

`AgentPlugin.discover(strategy?)` scans the workspace packages for
test files and returns a thenable `DiscoverBuilder` that resolves to
`{ projects, tags }`. Pass `projects` to Vitest's `test.projects` and
`tags` to `test.tags` so Vitest's `--tags-filter` flag and the
tag-aware test API can resolve every tag the plugin injects:

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

`projects` is typed as
`TestProjectInlineConfiguration[] | undefined` — the same
`TestProjectInlineConfiguration` shape Vitest accepts on
`test.projects`. The pre-T5 `VitestProject` builder class was removed;
strategies emit native Vitest inline-config objects directly. When the
scanner finds no test files anywhere in the workspace (and no
`.addProject` entries were added), `projects` is `undefined` so you
can spread it conditionally:

```typescript
test: { ...(projects ? { projects } : {}), tags }
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
`pkg:e2e` are gone in 2.0); instead, the active `DiscoverStrategy`
classifies every test file by path and the plugin's Vite transform
injects the resolved tags into the call site, so Vitest's tag
expressions can drive filtering and per-kind timeouts.

### `.addProject()` for non-package folders

The `DiscoverBuilder` returned by `discover()` is a thenable — you can
chain `.addProject({ name, path })` to register folders that hold
tests but are not pnpm workspace packages, and `await` (or `.then`)
the result to materialize the discovery:

```typescript
const { projects, tags } = await AgentPlugin.discover()
  .addProject({ name: "integration", path: "./test-only" });
```

The builder is **immutable** — every `.addProject()` call returns a
fresh builder; the original is unchanged, so the same builder can be
forked into multiple variants. On resolution, the scanner runs the
active strategy's `buildProject` over both workspace packages and the
added entries, with name and normalized-path conflict detection — a
clash between an added entry and a workspace package throws, and a
null `buildProject` return for an added entry throws (`buildProject`
returning null for a workspace package is a silent skip).

### `discover()` argument shape

The argument to `discover()` is overloaded:

- No argument — uses `DefaultDiscoverStrategy` and the current working
  directory.
- A `DiscoverStrategy` instance — uses that strategy with the current
  working directory.
- An options object `{ strategy?, cwd? }` — pass a custom workspace
  root via `cwd` (useful for tests and tooling that drive discovery
  outside the actual project root).

The pre-2.0 `({ projects }) => void | Promise<void>` callback form
and the legacy per-kind override form (`{ unit?, int?, e2e? }` keyed
by test kind) were removed when discovery consolidated to a single
strategy contract. Callers that need to mutate projects
post-discovery either extend the strategy (recommended) or
destructure the result and mutate the array before spreading:

```typescript
const { projects, tags } = await AgentPlugin.discover();
for (const p of projects ?? []) p.test = { ...p.test, retry: 1 };
```

Discovery results are cached per workspace root within the process
only when called with no argument and no `.addProject()` chain. Any
explicit strategy, custom `cwd`, or `.addProject()` call bypasses the
cache so per-config customization always re-runs.

## DiscoverStrategy API

`AgentPlugin` exports `DiscoverStrategy` (the abstract class),
`DefaultDiscoverStrategy` (the concrete default), and the `Tag` class
so you can author your own classification and project-shaping logic.
A `DiscoverStrategy` declares the available tags (timeouts, retries),
a `classify({ module })` function that maps each test file to one or
more tag names, and a `buildProject(input)` function that returns a
`TestProjectInlineConfiguration` for the package (or `null` to skip
it). The default strategy ships `unit`, `int` (60s timeout), and
`e2e` (120s timeout, retry 2 under CI), classifies by filename
suffix, and skips packages that have no `src/` or `__test__/` test
files.

The simplest path is `DefaultDiscoverStrategy().extend(...)` — chain
an extra classifier or `buildProject` layer on top of the built-in
strategy without rewriting it:

```typescript
import {
  AgentPlugin,
  DefaultDiscoverStrategy,
  Tag,
} from "vitest-agent-plugin";

const strategy = new DefaultDiscoverStrategy().extend({
  additionalTags: [Tag.make("contract", { timeout: 30_000 })],
  classify: ({ module, inherited }) => {
    if (module.filename.endsWith(".contract.test.ts")) return ["contract"];
    return inherited;
  },
});

export default async () => {
  const { projects, tags } = await AgentPlugin.discover(strategy);
  return defineConfig({
    plugins: [AgentPlugin({ discoverStrategy: strategy })],
    test: { ...(projects ? { projects } : {}), tags, pool: "forks" },
  });
};
```

For a strategy authored from scratch (no inheritance), use the
`DiscoverStrategy.create({ tags, classify, buildProject })` factory.
The `tags` array names every tag your `classify` can return, and
`buildProject` returns a `TestProjectInlineConfiguration` (Vitest's
native inline-project shape) or `null` to skip:

```typescript
import {
  AgentPlugin,
  DiscoverStrategy,
  Tag,
} from "vitest-agent-plugin";

const strategy = DiscoverStrategy.create({
  tags: [Tag.make("unit"), Tag.make("smoke", { timeout: 5_000 })],
  classify: ({ module }) => {
    if (module.filename.endsWith(".smoke.test.ts")) return ["smoke"];
    return ["unit"];
  },
  buildProject: async (input) => ({
    extends: true,
    test: {
      name: input.name,
      environment: "node",
      include: [`${input.path}/src/**/*.{test,spec}.{ts,tsx,js,jsx}`],
    },
  }),
});
```

Pass the same `strategy` to both `discover()` and the plugin's
`discoverStrategy` option so discovery results and the parse-time
Vite transform stay in sync. `AgentPlugin({ discoverStrategy: false })`
disables the Vite transform entirely so no tags are injected at
parse time.

For pure tag-classification logic (no `buildProject` changes), the
plugin also exports three composable helpers — `classifyByFilename`,
`classifyByDirectory`, and `combineClassifiers` — that build
`ClassifyFn` values without writing the function by hand. The
classification context exposes `ModuleInfo` (`path`, `relativePath`,
`filename`, `packageName`, `packagePath`) and the strategy's tag
array. Tag construction options are typed as `TagOptions`.

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

## Cross-package Version Drift

The six runtime packages (`vitest-agent-sdk`, `vitest-agent-plugin`,
`vitest-agent-reporter`, `vitest-agent-cli`, `vitest-agent-mcp`,
`vitest-agent-ui`) release in lockstep. If a partial upgrade leaves
them at different versions, three entry points each write a single
stderr line and continue:

```text
[vitest-agent-plugin] version drift: vitest-agent-plugin@<a> with vitest-agent-sdk@<b>. Reinstall vitest-agent-* packages so versions match.
```

The check fires at the top of the `AgentPlugin()` factory (comparing
against `vitest-agent-sdk` and `vitest-agent-reporter`), inside
`vitest-agent-mcp`'s startup (comparing against `vitest-agent-sdk`),
and at the top of the `vitest-agent` CLI before any subcommand runs
(comparing against `vitest-agent-sdk`). The plugin's check is
suppressed after the first call in the same Node process so
multi-project Vitest configs do not duplicate the warning.

The check is observation-only — it never throws and never exits. If
you see the line, reinstall the `vitest-agent-*` packages so the
versions match. The Claude Code marketplace plugin
(`vitest-agent@spencerbeggs`) versions independently of the npm
packages and is not part of the comparison.

Each runtime package also exports its own `CURRENT_<PKG>_VERSION`
string constant (for example `CURRENT_SDK_VERSION`,
`CURRENT_PLUGIN_VERSION`) inlined at build time from the package's
`package.json#version`. The constants exist primarily for the drift
check itself; user code rarely needs to import them.

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
AgentPlugin({ console: { human: "ink", agent: "ink", ci: "ink" } })
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
