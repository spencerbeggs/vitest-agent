---
status: current
module: vitest-agent-reporter
category: architecture
created: 2026-05-06
updated: 2026-05-07
last-synced: 2026-05-07
completeness: 90
related:
  - ../architecture.md
  - ../components.md
  - ../decisions.md
  - ../data-structures.md
  - ./sdk.md
  - ./reporter.md
dependencies: []
---

# Plugin package (`vitest-agent-plugin`)

The plugin package owns everything Vitest-API-aware: the Vitest plugin, the
internal `AgentReporter` lifecycle class, the istanbul-aware
`CoverageAnalyzer`, and the reporter-side utilities that bridge the plugin to
a user-supplied `VitestAgentReporterFactory`.

**npm name:** `vitest-agent-plugin`
**Location:** `packages/plugin/`
**Internal dependencies:** `vitest-agent-sdk`
**Required peers:** `vitest-agent-reporter`, `vitest-agent-cli`,
`vitest-agent-mcp`, `vitest >= 4.1.0`

The plugin owns persistence, classification, baselines, trends, and Vitest
lifecycle wiring. Rendering is delegated to whatever reporter(s) the factory
returns. The `VitestAgentReporter` contract types live in
[./sdk.md](./sdk.md) (`packages/sdk/src/contracts/reporter.ts`).

For decisions that shaped this design, see [../decisions.md](../decisions.md):
D34 (plugin/reporter split), D28 (process-level migration coordination),
D31 (XDG-derived data path), D10 (failure signatures).

---

## AgentPlugin

`packages/plugin/src/plugin.ts`. The Vitest plugin entry point. Hooks into
Vitest's `configureVitest`, detects the environment, resolves the cache
directory, parses coverage thresholds and targets, picks the user's
`VitestAgentReporterFactory` (defaulting to `defaultReporter`), then
constructs an `AgentReporter` per project and pushes it onto
`vitest.config.reporters`.

**Cache directory resolution.** Two-step priority: explicit
`reporter.cacheDir` option, then `outputFile['vitest-agent']` from the Vitest
config. When both are unset, `cacheDir: undefined` is passed through and the
reporter falls through to XDG-based resolution via `resolveDataPath` — the
canonical default. There is no Vite-cacheDir fallback.

**Per-project isolation.** In multi-project Vitest configs, the plugin
constructs one `AgentReporter` per project via `projectFilter`. Each reporter
filters `testModules` to its own project before persistence and rendering.
Coverage dedup runs by alphabetical project ordering: only the first project
processes the global `CoverageMap`, others skip to avoid double-counting.

**Console-reporter stripping.** In `agent`/`own` mode, the plugin strips
Vitest's built-in console reporters (`default`, `verbose`, `tree`, `dot`,
`tap`, `tap-flat`, `hanging-process`, `agent`) from the chain. Custom
reporters and non-console built-ins (`json`, `junit`, `html`, `blob`,
`github-actions`) are preserved.

**Naming note.** The constructor accepts the rendering hook as
`reporterFactory` because `options.reporter` is already a config bag carrying
`cacheDir`, `coverageThresholds`, `coverageTargets`, etc. The two slots are
deliberately separate.

## AgentReporter (internal Vitest-API class)

`packages/plugin/src/reporter.ts`. Internal lifecycle class — constructed by
`AgentPlugin`, never exported as a public API. Standalone reporter consumers
go through the named factories in `vitest-agent-reporter`.

The class's job is the persistence pipeline; rendering is delegated.

**Lifecycle:**

- `onInit` resolves `dbPath`. If `options.cacheDir` is set, the helper
  short-circuits to `<cacheDir>/data.db` — skipping the heavy XDG/workspace
  layer stack that would otherwise eagerly scan lockfiles. Otherwise it runs
  `resolveDataPath(process.cwd())` and memoizes on `this.dbPath`. On
  rejection, prints `formatFatalError(err)` to stderr and returns early.
- `onCoverage` stashes coverage data; fires before `onTestRunEnd`.
- `onTestRunEnd` is the load-bearing hook. See below.

**`onTestRunEnd` flow:**

1. `await ensureMigrated(dbPath)` to serialize migration across reporter
   instances sharing a `dbPath`. See [./sdk.md](./sdk.md) for why this
   coordination is required.
2. Persist Vitest settings + env vars via `DataStore.writeSettings()`.
3. Filter `testModules` by `projectFilter`, group by project name. First
   project (alphabetically) processes global coverage; others skip.
4. Per project: build the `AgentReport`, classify outcomes via
   `HistoryTracker`, run each error through `processFailure` (source-mapping
   the top non-framework frame, finding the function boundary, computing the
   stable failure signature), upsert `failure_signatures`, then persist runs,
   modules, suites, test cases, errors, coverage, history, and source-map
   entries.
5. Compute updated baselines, write trends on full (non-scoped) runs, and
   read trend summaries back for the `ReporterRenderInput`.
6. **Render delegation.** Build a `ReporterKit` via `buildReporterKit`,
   invoke `opts.reporter(kit)` to get one or more reporters, normalize to an
   array, concatenate the `RenderedOutput[]` produced by each, then route
   each entry via `routeRenderedOutput`.

Each lifecycle hook builds a scoped Effect and runs it with
`Effect.runPromise` against `ReporterLive(dbPath)`.

## CoverageAnalyzer

`packages/plugin/src/services/CoverageAnalyzer.ts` plus its live and test
layers. Effect service that processes istanbul `CoverageMap` data with
optional scoping (full analysis or filtered to tested source files).

**Why it lives here, not in the SDK.** Only the plugin's lifecycle class
consumes istanbul `CoverageMap` data directly. The CLI and MCP packages read
pre-processed coverage from SQLite via `DataReader`. The named reporter
factories receive coverage as part of `AgentReport` (a pure data structure)
and have no istanbul awareness.

The implementation is a pure computation against duck-typed `CoverageMap`
interfaces — no I/O, no native deps — but it is the only service that knows
about istanbul's specific shape, so it stays co-located with the lifecycle
code that feeds it.

## VitestProject

`packages/plugin/src/utils/vitest-project.ts`. Class-based wrapper around
`TestProjectInlineConfiguration` that carries a name, a kind, and a mutable
config with fluent mutation helpers.

**Static factories set kind-appropriate defaults:**

- `VitestProject.unit(options)` — `environment: "node"`, no timeout
  overrides.
- `VitestProject.int(options)` — `testTimeout: 60_000`, `hookTimeout:
  30_000`, `maxConcurrency` half of CPU count (clamped 1–8).
- `VitestProject.e2e(options)` — `testTimeout: 120_000`, `hookTimeout:
  60_000`, same CPU-derived `maxConcurrency`.
- `VitestProject.custom(kind, options)` — no defaults; caller provides full
  `overrides`.

**Mutation methods (all return `this` for chaining):**

- `.override(config)` — deep-merges a partial `TestProjectInlineConfiguration`,
  preserving the project `name` and `include` list.
- `.addInclude(...patterns)` — appends glob patterns to the include list.
- `.addExclude(...patterns)` — appends patterns to the test exclude list.
- `.addCoverageExclude(...patterns)` — accumulates patterns for the caller to
  apply to `coverage.exclude`; the class does not touch coverage config itself.

`.toConfig()` returns the underlying `TestProjectInlineConfiguration`.

## discoverProjects

`packages/plugin/src/utils/discover-projects.ts`. Async workspace scanner
that builds `VitestProject[]` from the pnpm workspace layout. Calls
`findWorkspaceRootSync` and `getWorkspacePackagesSync` from the
`workspaces-effect` sync API — no Effect runtime required.

**Per-package scan:** for each workspace package (skipping the root `.`),
scans `src/` (always) and `__test__/` (if present) for test files by kind.
Filename conventions:

| Pattern | Kind |
| --- | --- |
| `*.e2e.{test,spec}.*` | `e2e` |
| `*.int.{test,spec}.*` | `int` |
| `*.{test,spec}.*` (all others) | `unit` |

When a package has more than one kind, project names get a `:kind` suffix
(`pkg-name:unit`, `pkg-name:e2e`); single-kind packages keep the bare
package name.

**Glob construction:** include arrays contain both `<pkg>/src/**/<pattern>`
and `<pkg>/__test__/**/<pattern>`. Helper subdirs (`utils/`, `fixtures/`,
`snapshots/`) inside `__test__/` are excluded automatically.

**Setup file detection:** if `vitest.setup.{ts,tsx,js,jsx}` exists at the
package root it is added to `setupFiles` for all projects from that package.

**Process-level cache:** results are keyed by workspace root in a
module-local `Map`. Repeated calls from the same process (e.g., multiple
config evaluations) return the cached list without re-scanning.

**DiscoveryOptions:** the optional second-position argument is either a
`ProjectsCallback` `(ctx) => void | Promise<void>` (receives the full
`projects` array) or a per-kind object `{ unit?, int?, e2e? }` where each
value is either a `TestProjectInlineConfiguration["test"]` config object
(applied via `.override()`) or a `ProjectKindCallback` `(map) => void |
Promise<void>` (receives a `Map<name, VitestProject>` for that kind).

## AgentPlugin.discover()

`packages/plugin/src/plugin.ts` (as a static method on the `AgentPlugin`
namespace). The canonical entry point for workspace-driven Vitest project
discovery. Calls `discoverProjects(options)` and maps the result through
`.toConfig()`, returning `TestProjectInlineConfiguration[]` ready for
`test.projects`.

**Why this is a separate static, not a `configureVitest` hook.** Vitest
pre-parses project configs before it evaluates Vite plugin hooks. A plugin
using `configureVitest` to inject projects arrives too late — Vitest has
already finished its project resolution pass. Users therefore call
`AgentPlugin.discover()` in an async config export so discovery runs during
config evaluation:

```ts
export default async () => {
  const projects = await AgentPlugin.discover();
  return defineConfig({
    plugins: [AgentPlugin()],
    test: { projects },
  });
};
```

The async arrow function form (rather than `defineConfig(async () => {...})`)
is recommended because it prevents TypeScript from widening string-literal
option types (e.g., `provider: "v8"` stays a string literal instead of being
widened to `string`).

**Coverage-level constants on the namespace:**

- `AgentPlugin.COVERAGE_LEVELS` — record of the five `CoverageLevel` presets
  (`none`, `basic`, `standard`, `strict`, `full`).
- `AgentPlugin.COVERAGE_LEVELS_PER_FILE` — same presets with `.withPerFile()`
  applied.

## Reporter-side utilities

`packages/plugin/src/utils/`. Pure utilities only the plugin's lifecycle
class calls. Anything used by more than one runtime package lives in the SDK
instead.

- `vitest-project.ts` — `VitestProject` class (see above).
- `discover-projects.ts` — `discoverProjects` workspace scanner (see above).
- `strip-console-reporters.ts` — removes console reporters from Vitest's
  reporter chain.
- `resolve-thresholds.ts` — parses Vitest-native `coverageThresholds` into
  `ResolvedThresholds`. Disables Vitest's native `autoUpdate` when our own
  targets are set, to prevent Vitest auto-ratcheting independently.
- `capture-env.ts` — captures CI/runner environment variables for settings
  storage.
- `capture-settings.ts` — captures Vitest config (pool, environment,
  timeouts, coverage provider) and computes a deterministic hash. The
  `SettingsInput` return type is owned by `DataStore.ts` in the SDK so
  DataStore controls its full input contract without circular imports.
- `process-failure.ts` — per-error pipeline called before
  `DataStore.writeErrors`. Walks Vitest stack frames, identifies the top
  non-framework frame (skipping `node:internal`, `node_modules/vitest/`),
  source-maps it, runs `findFunctionBoundary` on the resolved source, then
  calls `computeFailureSignature`. Returns `{ frames, signatureHash }` for
  the reporter to feed into `writeErrors` and `writeFailureSignature`.
- `build-reporter-kit.ts` — pure constructor that produces a `ReporterKit`
  from the resolved configuration plus the detected environment and
  no-color flag. The pre-bound `stdOsc8` is enabled when `!noColor && (env
  === "terminal" || env === "agent-shell")` and is a no-op otherwise.
- `route-rendered-output.ts` — dispatches a `RenderedOutput` by its declared
  `target`. `stdout` writes to `process.stdout`; `github-summary` appends to
  the resolved `GITHUB_STEP_SUMMARY` file or user override; `file` is
  reserved (currently a no-op) pending a future convention for arbitrary
  on-disk artifacts.

## ReporterLive composition layer

`packages/plugin/src/layers/ReporterLive.ts`. Composes the live layers the
plugin's lifecycle class needs from the SDK plus the agent-local
`CoverageAnalyzerLive`. Does not pull `NodeContext` directly because
`ensureMigrated` and `resolveDataPath` provide their own platform layers
earlier in the pipeline.

## Coverage threshold extraction

The plugin extracts thresholds from Vitest's already-resolved coverage config
rather than re-parsing the user's input. This is load-bearing: Vitest applies
its own pattern expansion and inheritance rules, and the plugin must see the
same resolved values Vitest will enforce. `resolveThresholds` in the
reporter-side utilities does this conversion.

When user-supplied `coverageTargets` are present, the plugin disables
Vitest's `autoUpdate` so the two ratchet mechanisms don't fight. The plugin's
own baseline ratchet runs unconditionally on full (non-scoped) runs.
