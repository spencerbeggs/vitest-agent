# vitest-agent-plugin

The Vitest plugin (`agentPlugin()`) and internal `AgentReporter` Vitest-API
class. Owns the Vitest lifecycle hooks, persistence, classification,
baseline/trend computation, and delegates rendering to a user-supplied
`VitestAgentReporterFactory`. Declares `vitest-agent-reporter`,
`vitest-agent-cli`, and `vitest-agent-mcp` as required peerDependencies.

## Layout

```text
src/
  index.ts            -- public re-exports
  plugin.ts           -- AgentPlugin: injects AgentReporter via
                         configureVitest, detects environment,
                         resolves coverage config, suppresses Vitest's
                         native coverage table in own mode
  reporter.ts         -- internal AgentReporter Vitest-API class
                         (NOT exported publicly). Owns onInit (async),
                         onCoverage, onTestRunEnd. Delegates rendering
                         to a VitestAgentReporterFactory via ReporterKit
  services/
    CoverageAnalyzer.ts  -- Effect service for istanbul CoverageMap
                           processing (the only istanbul-aware service;
                           lives here because only the reporter lifecycle
                           class feeds it coverage data directly)
  layers/
    CoverageAnalyzerLive.ts
    CoverageAnalyzerTest.ts
    ReporterLive.ts      -- (dbPath, logLevel?, logFile?) composition:
                           DataStore + CoverageAnalyzer + HistoryTracker
                           + OutputPipeline + DataReader + SqliteClient
                           + Migrator + LoggerLive
  utils/
    build-reporter-kit.ts    -- constructs ReporterKit from resolved config
                               + Environment + noColor
    route-rendered-output.ts -- dispatches RenderedOutput by target:
                               stdout / github-summary / file (no-op)
    process-failure.ts       -- per-error pipeline: source-map the top
                               non-framework frame, run findFunctionBoundary,
                               call computeFailureSignature. Returns
                               { frames, signatureHash }
    capture-env.ts           -- captures CI/GITHUB_* env vars for settings
    capture-settings.ts      -- captures Vitest config snapshot + hash
    resolve-thresholds.ts    -- parses Vitest-native coverage threshold format
    strip-console-reporters.ts -- removes built-in console reporters in own mode
    vitest-project.ts        -- VitestProject class: typed builder for
                               TestProjectInlineConfiguration with static
                               factories (.unit, .e2e, .int, .custom) and
                               fluent mutators (override, addInclude,
                               addExclude, addCoverageExclude)
    discover-projects.ts     -- discoverProjects() async scanner: walks
                               workspace packages, detects __test__/ and
                               src/ test files by kind suffix, emits
                               VitestProject[] with per-process result cache
```

## Key files

| File | Purpose |
| ---- | ------- |
| `plugin.ts` | `AgentPlugin(options?)` factory + `AgentPlugin` namespace. Resolves env + cacheDir + coverage options; suppresses Vitest's coverage table in agent/own mode; injects `AgentReporter` per project via `configureVitest`. Namespace exposes `COVERAGE_LEVELS`, `COVERAGE_LEVELS_PER_FILE`, and `discover()` |
| `reporter.ts` | Internal `AgentReporter` class. `onInit` resolves `dbPath` async; `onTestRunEnd` runs the full persistence/classification/baseline/trend pipeline, then calls `opts.reporter(kit)` and routes `RenderedOutput[]` |
| `services/CoverageAnalyzer.ts` | Effect service tag for coverage processing. Only lives here because the reporter lifecycle class feeds it coverage data; CLI/MCP read pre-processed coverage from SQLite |
| `utils/process-failure.ts` | Per-error signature pipeline. Called from `onTestRunEnd` for each error before `DataStore.writeErrors`. Returns `frames: StackFrameInput[]` and `signatureHash` |
| `utils/build-reporter-kit.ts` | Constructs `ReporterKit` from resolved config + detected environment + `noColor` flag. `stdOsc8` is enabled when `!noColor && (env === "terminal" \|\| env === "agent-shell")` |
| `utils/route-rendered-output.ts` | Dispatches a single `RenderedOutput` to its target: `stdout`, `github-summary` (append), or `file` (no-op) |
| `utils/vitest-project.ts` | `VitestProject` builder class. Static factories: `.unit`, `.e2e`, `.int`, `.custom`. Fluent mutators: `override`, `addInclude`, `addExclude`, `addCoverageExclude`. Call `.toConfig()` to get a `TestProjectInlineConfiguration` |
| `utils/discover-projects.ts` | `discoverProjects(options?, cwd?)` walks workspace packages, scans `src/` and `__test__/` for test files classified by filename suffix (`.e2e.`, `.int.`, or plain), and returns `VitestProject[]`. Results are cached per workspace root within the process |
| `layers/ReporterLive.ts` | Composition layer for `AgentReporter`. Used per-run via `Effect.runPromise` (not ManagedRuntime — the reporter is short-lived per run) |

## AgentPlugin.discover()

`AgentPlugin.discover(options?)` is the canonical way to populate
`test.projects` in `vitest.config.ts`. Use an async config export:

```ts
export default async () => {
  const projects = await AgentPlugin.discover();
  return defineConfig({ plugins: [AgentPlugin()], test: { projects } });
};
```

Internally calls `discoverProjects()`, then maps each `VitestProject`
to a `TestProjectInlineConfiguration` via `.toConfig()`. The optional
`options` argument accepts either:

- A callback `({ projects }) => void | Promise<void>` to mutate the
  full list in-place after discovery.
- An object `{ unit?, int?, e2e? }` where each key is either a
  per-kind config override (merged into `test.*`) or a
  `(projectsMap) => void | Promise<void>` callback scoped to that kind.

`coverageThresholds` and `coverageTargets` are top-level options on
`AgentPluginConstructorOptions` — there is no `discovery` field.

## Conventions

- **No standalone `AgentReporter` export.** The class is an internal
  implementation detail constructed by `agentPlugin()`. Don't export it.
  Users who want custom rendering implement `VitestAgentReporterFactory`
  and pass it as `reporterFactory` to `agentPlugin()`.
- **Per-call layer construction is fine here.** The reporter runs
  `Effect.runPromise` in `onTestRunEnd` with `ReporterLive(dbPath)` inline.
  This is appropriate because the reporter runs briefly per test suite.
  Only the MCP server uses `ManagedRuntime`.
- **`ensureMigrated` must be awaited before the main Effect.** In
  multi-project configs, multiple reporter instances share one `data.db`;
  `ensureMigrated` serializes the migration step via the `globalThis`
  promise cache (Decision 28). On rejection, print `formatFatalError` and
  return early.
- **`process-failure.ts` is the only place signatures are computed.**
  Don't compute failure signatures directly in `reporter.ts`. The pipeline:
  `processFailure(error, options)` -> `{ frames, signatureHash }` ->
  `DataStore.writeFailureSignature` -> `DataStore.writeErrors` (with the
  `signatureHash` and `frames` on `TestErrorInput`).
- **`configure Vitest` is async.** Vitest awaits plugin hooks; the
  plugin calls `Effect.runPromise` for environment detection there.
  Don't make it synchronous.
- **Per-project reporter instances.** The plugin passes
  `projectFilter: project.name` to `AgentReporter` so each instance
  filters `testModules` to its own project. Coverage dedup: only the
  first alphabetical project processes the global `CoverageMap`.

## When working in this package

- Adding a new reporter option: extend `AgentPluginOptions` (and
  `AgentReporterOptions`) in `vitest-agent-sdk`'s `schemas/Options.ts`,
  then thread it through `plugin.ts` -> `reporter.ts` ->
  `build-reporter-kit.ts` -> `ResolvedReporterConfig` as needed.
  `coverageThresholds` and `coverageTargets` are top-level options on
  `AgentPluginConstructorOptions`; there is no `discovery` field.
- Changing project discovery: edit `utils/discover-projects.ts`.
  `VitestProject` builders live in `utils/vitest-project.ts`. The
  scanner accepts both `src/` (legacy) and `__test__/` (canonical)
  test directories. Helper subdirs (`utils/`, `fixtures/`,
  `snapshots/`) inside `__test__/` are excluded automatically.
- Adding a new utility that only this package uses: put it in
  `utils/`. If the utility is needed by MCP or CLI too, it belongs
  in `vitest-agent-sdk/utils/` or `vitest-agent-sdk/lib/`.
- Changing coverage behavior: `CoverageAnalyzer` lives in this package.
  CLI and MCP read pre-processed coverage from SQLite via `DataReader`;
  they never call `CoverageAnalyzer` directly.
- Changing reporter output routing: edit `route-rendered-output.ts`.
  The three targets are: `stdout` (write to `process.stdout`),
  `github-summary` (append to the configured summary file), `file`
  (reserved no-op).
- `strip-console-reporters.ts` removes `default`, `verbose`, `tree`,
  `dot`, `tap`, `tap-flat`, `hanging-process`, `agent` reporters in
  own mode. Custom reporters (class instances, file paths) and
  non-console built-ins (`json`, `junit`, `html`, `blob`,
  `github-actions`) are preserved.

## Design references

- `.claude/design/vitest-agent/components/plugin.md`
  Load when working on `AgentPlugin`, the internal `AgentReporter`,
  `CoverageAnalyzer`, or the reporter-side utilities.
- `.claude/design/vitest-agent/data-flows.md`
  Load when tracing the test-run pipeline (Flow 1: end-to-end run
  persistence; Flow 2: coverage processing and dedup).
- `.claude/design/vitest-agent/decisions.md`
  Load when you need rationale (especially D34 plugin/reporter split,
  D7 per-call `Effect.runPromise`, D28 `ensureMigrated` globalThis
  cache, D10 failure signatures).
- `.claude/design/vitest-agent/components/discover.md`
  Load when working on `AgentPlugin.discover()`, `discoverProjects()`,
  `VitestProject`, `DiscoveryOptions`, or the override system.
- `.claude/design/vitest-agent/testing-strategy.md`
  Load when writing tests for this package, including the `__test__/`
  layout and helper subdirectory exclusion conventions.
