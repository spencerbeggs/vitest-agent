# @vitest-agent/plugin

The Vitest plugin (`AgentPlugin()`) and internal `AgentReporter` Vitest-API
class. Owns the Vitest lifecycle hooks, persistence, classification,
baseline/trend computation, and delegates rendering entirely to a
`VitestAgentReporterFactory` — it injects `DefaultVitestAgentReporter` from
`@vitest-agent/reporter` when the user does not pass a custom `reporter`
option, and never touches rendering itself. The reporter owns mode branching and the Ink live-mount lifecycle.

**The carrier (rank 5, issue #412).** This is the one package a consumer installs. It declares `@vitest-agent/cli`, `@vitest-agent/mcp`, `@vitest-agent/reporter`, `@vitest-agent/engine`, and `@vitest-agent/sdk` as regular `workspace:*` dependencies (published exact-pinned; a cli/mcp release patch-bumps the plugin) AND declares both bins itself — `bin.vitest-agent` → `src/bin/vitest-agent.ts` (`main({ distribution })` from `@vitest-agent/cli/main`) and `bin.vitest-agent-mcp` → `src/bin/vitest-agent-mcp.ts` (`void main({ distribution })` from `@vitest-agent/mcp/main`), `distribution` being `{ name: "@vitest-agent/plugin", version: CURRENT_PLUGIN_VERSION }`. pnpm links only direct-dependency bins, so these shims are what put `node_modules/.bin/vitest-agent` and `.bin/vitest-agent-mcp` into a consumer under every package manager; no `publicHoistPattern`, pnpm plugin, or manual step is involved. The Vitest-side peers (`vitest`, `@vitest/coverage-v8`, `@vitest/coverage-istanbul`) stay `peerDependencies`. The plugin does not depend on `@vitest-agent/ui`, `react`, or `ink` (reporter pulls them) nor on `@vitest-agent/sidecar` (cli pulls it). `ReporterLive(options: PlatformOptions)` is `CoverageAnalyzerLive` over the engine's `PlatformLive`.

## Layout

```text
src/
  index.ts            -- public re-exports
  bin/
    vitest-agent.ts     -- carrier shim over @vitest-agent/cli/main (passes distribution)
    vitest-agent-mcp.ts -- carrier shim over @vitest-agent/mcp/main (passes distribution)
  version.ts          -- CURRENT_PLUGIN_VERSION (read by the shims)
  plugin.ts           -- AgentPlugin factory + namespace
  reporter.ts         -- internal AgentReporter Vitest-API class
  services/
    CoverageAnalyzer.ts        -- istanbul CoverageMap processor
    ConfigValidation.ts        -- Effect service for coverage-config validation
  layers/
    CoverageAnalyzerLive.ts
    CoverageAnalyzerTest.ts
    ConfigValidationLive.ts    -- 7-rule starter registry
    ConfigValidationTest.ts    -- override factory for unit tests
    ReporterLive.ts            -- per-run composition layer
  utils/
    build-reporter-kit.ts      -- ReporterKit builder
    route-rendered-output.ts   -- RenderedOutput target dispatch
    process-failure.ts         -- per-error signature pipeline
    detect-timeout.ts          -- isTimeoutError: matches Vitest timeout-
                                  flavored failures for the timeoutCount split
    is-partial-run.ts          -- isPartialRun: pure scoped-run decision
    capture-env.ts             -- CI/GITHUB_* env capture
    capture-settings.ts        -- Vitest config snapshot + hash
    resolve-thresholds.ts      -- coverage threshold parser
    strip-console-reporters.ts -- strips Vitest's reporters whenever the
                                   resolved consoleMode owns stdout
                                   (anything other than passthrough)
    discover-strategy.ts       -- DiscoverStrategy abstract class +
                                   DefaultDiscoverStrategy concrete class
    discover-projects.ts       -- unified workspace scanner; strategy.buildProject
                                   decides per-package skips, .addProject entries
                                   are merged in with conflict detection. Process
                                   cache is signature-invalidated (issue #100) over
                                   each package's src/ and __test__/ directories
                                   only, and records a last-real-scan timestamp
                                   into a Symbol.for() process-global for the mcp
                                   handshake
    is-test-shaped-package.ts  -- predicate behind the declined-package
                                   warning (issue #229)
    run-script-lock.ts         -- RunOnce key / dir / timings + the
                                   shellCommand argv for AgentPlugin.runScript
                                   (issue #191)
    classify-helpers.ts        -- classifyByFilename, classifyByDirectory,
                                   combineClassifiers (pure ClassifyFn builders)
    find-test-files.ts         -- glob walk (@effected/walker descendSync)
                                   over the injected WalkerSyncOps, matching through
                                   @effected/glob (dot: true); skips node_modules, .git, dist by
                                   default and stops at any nested package.json
                                   boundary
    walker-fs.ts               -- statOrNull(ops, path): the one stat the
                                   discovery probes make outside a walk
    tag.ts                     -- Tag class + Tag.make factory
    inject-tags.ts             -- prepends a guarded tag prelude per
                                   classified test file (no AST parsing)
    is-benign-vite-source-map-warning.ts -- pure predicate matching the benign
                                   Vite "Failed to load source map" / ENOENT
                                   .js.map noise (issue #110)
    stringify-failure-value.ts -- converts Vitest .expected/.actual to a
                                  single-line string for the stream renderer
    build-module-info.ts       -- builds ModuleInfo (relative path, package
                                  name, package path) from a Vitest module
    to-posix-path.ts           -- normalizes Windows backslash paths to
                                  forward-slash for pattern matching + display
```

## Key files

| File | Purpose |
| ---- | ------- |
| `plugin.ts` | `AgentPlugin(options?)` factory + `AgentPlugin` namespace. Resolves env + executor + console matrix → single `ConsoleMode` value; strips Vitest reporters and suppresses Vitest's coverage table whenever the resolved mode owns stdout (any value other than `passthrough`); forwards the user's `onRunEvent` tap unconditionally for every consoleMode (the T6 rewrite removed the previous `stream`-only gating); injects `DefaultVitestAgentReporter` from `@vitest-agent/reporter` when no `reporter` option is supplied; pushes exactly one aggregating `AgentReporter` per Vitest run from `configureVitest` (the `aggregatedReporterByVitest` WeakSet skips the push on every later project call), with no `projectFilter`. Resolves `coverageMode` from Vitest's native `coverage.enabled` and threads it onto `ResolvedReporterConfig`. Runs the `ConfigValidation` service in `configureVitest` (warnings to stderr via `[vitest-agent:plugin]`; errors throw via `@vitest-agent/engine`'s `formatFatalError`, which renders through `@effected/cli`'s `CliFailure.toDoc`). Namespace exposes `COVERAGE_LEVELS`, `COVERAGE_LEVELS_PER_FILE`, `COVERAGE_AUTOUPDATE`, and `discover()`. A `configResolved` hook wraps the root Vite `logger.warn` in place via `installViteSourceMapWarningFilter` to drop the benign source-map/ENOENT-`.js.map` noise (issue #110); `ResolvedConfigLike` / `ViteLoggerLike` are `@internal` and kept off the public d.ts via an inline structural type on the plugin object Inside the `ownsStdout` branch of `configureVitest` it also calls `installStrayOutputCapture` on `vitest.logger` (never in `passthrough`) |
| `reporter.ts` | Internal `AgentReporter` class. Imports `DefaultVitestAgentReporter` from `@vitest-agent/reporter`; imports nothing from `@vitest-agent/ui`. Creates an Effect `PubSub` run-event channel and publishes one `RunEvent` per Vitest streaming callback onto it; it wires every Vitest reporter hook, so the channel carries the complete `RunEvent` surface. The channel rides `ReporterKit.runEvents` (optional field). The reporter factory is invoked at run start (`onInit`) so a live reporter can subscribe before the first event — the plugin no longer drives the Ink mount, holds a `liveInk` field, or calls `hasSubscribers()`. `onTestRunEnd` is split into two phases in Full mode: a persist program (persistence/classification/baseline/trend, returning `PersistResult`) and a render program that ALWAYS runs — on migration or persist failure it renders `fallbackReports` (built up front, guarded, with empty classifications and no trend) and writes a `persistence failed — results above were rendered but NOT recorded` line to stderr. The render program needs no SQLite (`OutputPipelineLive` + `NodeServices.layer`), then calls `opts.reporter.render(input, kit)` and routes `RenderedOutput[]`. Each project's `test_runs.reason` is derived from that project's own report, not the whole-process Vitest `reason` (`interrupted` stays global). In UI-only mode (`opts.coverageMode === "ui-only"`), the handler short-circuits after `RunFinished` and `filteredModules`: builds reports via `buildAgentReport`, runs a tiny `OutputPipelineLive` + `NodeServices.layer` program to resolve env/executor/detail, builds the kit, and routes the renderer output. No `ensureMigrated`, no `DataStore.write*`, no `CoverageAnalyzer.process`, no `HistoryTracker`. **Partial runs (issues #160, #401):** `isPartialRun` decides a run is scoped when Vitest's `filenamePattern` is set, fewer specs started than exist, a `projectFilter` was given, any CLI/programmatic scope filter is set on the stashed Vitest instance's `config.cliOptions` (`--project`, `--tags-filter`, `--changed`, `--related`, `--shard`, via `hasCliScopeFilter`), or the `testNamePattern` snapshot-diff rule (`hasTestNameFilter`) fires (`onInit` snapshots `configOverride.testNamePattern`; at `onTestRunEnd` a changed `current` means partial iff `current` is truthy, an unchanged one means partial iff `cliOptions.testNamePattern` is truthy); a scoped run routes coverage through `CoverageAnalyzer.processScoped`, persists `test_runs.scoped` (+ `scoped_files`), never emits `ThresholdViolation`, and neutralizes the Vitest coverage provider's `thresholds` before its native check runs — the snapshot in `neutralizedThresholdSnapshot` is restored in `onTestRunStart` so watch-mode reruns keep enforcement **Stray output (Decision 79):** `onInit` finds the capture on `vitest.logger` (`strayOutputCaptureOf`) and routes whole lines to the first reporter whose optional `printStrayLine` takes them (`routeStrayOutput`); `closeReporters` calls `route(undefined)` before awaiting any `close`; `onTestRunStart` resets the recorder; `onTestRunEnd` first calls `flush()` (so a child's unterminated last write prints in its own run, above the frame), then snapshots it onto `RunFinished.strayOutput` and every rendered report (`withStrayOutput`). Never persisted |
| `services/CoverageAnalyzer.ts` | Effect service tag for coverage processing: `process` for full runs, `processScoped(coverage, opts, testedFiles)` for partial runs (marks the report `scoped`, records `scopedFiles` / `totalFiles`, skips threshold evaluation). Only lives here because the reporter lifecycle class feeds it coverage data; CLI/MCP read pre-processed coverage from SQLite |
| `utils/is-partial-run.ts` | `isPartialRun({ filenamePattern, startedSpecCount, totalSpecCount, projectFilter, cliFilters, testNamePattern })` plus the pure `hasCliScopeFilter(cliFilters)` helper — pure decision functions, five signals, any one makes the run partial. `projectFilter` is the `AgentReporter` constructor option, never the CLI `--project` flag. A CLI `--project` run is NOT caught by the spec-count signal — `globTestSpecifications()` applies the same project filter, so started === total — which is why `cliFilters` exists (issue #401): the stashed Vitest instance's `config.cliOptions`, partial when `project` is non-empty, `tagsFilter` is non-empty, `changed` is truthy, `related` is non-empty, or `shard` is non-empty. `cliOptions` is the raw options object `startVitest(mode, filters, options)` captures, so it carries real CLI flags AND the programmatic filters MCP `run_tests` passes, but NOT settings baked into `vitest.config.ts` — deliberate: a permanent config-file `tagsFilter` is the project's own scope, not a partial run. `testNamePattern` is NOT in `CliScopeFilters`; it is a three-way input `{ cli, initial, current }`: `cli` is `config.cliOptions.testNamePattern` (raw pre-resolution string, `undefined` for a config-file-only pattern), `initial` is the `configOverride.testNamePattern` snapshot `AgentReporter.onInit` takes at startup (Vitest's `_setServer` copies the RESOLVED pattern there — `vitest.config.ts` `test.testNamePattern` merged with `-t` — before reporters exist), `current` is `configOverride.testNamePattern` at `onTestRunEnd`. Rule: if `current` differs from `initial` (compared by RegExp source, not identity) the run is partial iff `current` is truthy (watch-mode `t` filter applied via `Vitest.changeNamePattern` → partial; cleared → full); otherwise partial iff `cli` is truthy (`-t foo` → partial; `-t ""`, unset, or config-file-only → full). Neither source alone works: bare `cliOptions` counts `-t ""` and never sees watch mode; bare `configOverride` would mark every run partial for a project with a config-file pattern |
| `services/ConfigValidation.ts` | Effect service tag `vitest-agent/ConfigValidation` with one method `validate(input): Effect<ValidationResult, never, never>`. `ValidationError` carries optional `path` for pinpointed diagnostics and optional `remediation` for install-command-style fixes |
| `layers/ConfigValidationLive.ts` | Runs the seven-rule starter registry: `TARGET_WITHOUT_THRESHOLD` (warn), `TARGET_BELOW_THRESHOLD` (error), `THRESHOLD_WITHOUT_TARGET` (silent), `INVALID_TARGET_VALUE` (error, top + nested glob), `UNSUPPORTED_PROVIDER` (error, Full mode only), `MISSING_PROVIDER_PACKAGE` (error via `createRequire`, Full mode only, with install-command remediation), `PERFILE_ON_TARGETS` (warn). Mode resolution reads `vitestConfig.coverage?.enabled` — `false` → UI-only (skip provider rules), anything else → Full |
| `layers/ConfigValidationTest.ts` | `ConfigValidationTest.layer(override?: ValidationResult)` for unit tests that inject pre-built results |
| `utils/process-failure.ts` | Per-error signature pipeline. Called from `onTestRunEnd` for each error before `DataStore.writeErrors`. Returns `frames: StackFrameInput[]` and `signatureHash` |
| `utils/build-reporter-kit.ts` | Constructs `ReporterKit` from resolved config + detected environment + `noColor` flag. File hyperlinks are not the kit's: the reporter resolves them from `@effected/cli`'s `CliLinks` in its own environment (issue #541) |
| `utils/route-rendered-output.ts` | Dispatches a single `RenderedOutput` to its target: `stdout`, `github-summary` (append), or `file` (no-op) |
| `utils/stray-output-capture.ts` | `installStrayOutputCapture(logger, terminal)` wraps the Vitest Logger's `outputStream` / `errorStream` (once per Logger; published under the sdk's `STRAY_OUTPUT_SOURCE`) with pass-through `Writable`s that record what workers write past Vitest's console capture (forks/vmForks pipe every worker's stdio, and any inherited grandchild stdio, into these streams) into the sdk's bounded recorder. Escape-only writes (Vitest's own cursor/clear writes) pass through unrecorded; `isTTY` / `columns` / `rows` / colour helpers are delegated to the original. `route(printer)` line-buffers and hands whole lines to the printer only for streams whose original is the process's own stdout/stderr (so never under MCP's null sink); `route(undefined)` flushes a held partial line, and `flush()` hands held partial lines to the printer (or the original stream) mid-routing. Line buffering, UTF-8 decoding across writes, the hold limit and escape-only pass-through are `@effected/cli/ui`'s `CliUi.routeStream`; this module only patches the Logger, publishes the capture, and decides that only a terminal original is routed. `strayOutputCaptureOf(logger)` finds an installed capture. A child spawned from a threads/vmThreads worker bypasses it. See [Decision 79](../../okf/decisions/79-capture-stray-output-at-vitest-logger-streams.md) |
| `utils/discover-strategy.ts` | `DiscoverStrategy` abstract class plus the `DefaultDiscoverStrategy` concrete subclass. Base factory is `DiscoverStrategy.create({ tags, buildProject, classify })`; `.extend({ additionalTags?, buildProject?, classify? })` chains immutable layers. The default strategy ships unit / int / e2e tags and a filename-suffix classifier, and its `buildProject` returns null when neither `src/` nor `__test__/` has tests. Include globs are anchored at the package root (`<path>/src/**/*.{test,spec}.{ts,tsx,js,jsx}` and `<path>/__test__/**/*.{test,spec}.{ts,tsx,js,jsx}`, built from `SRC_DIR` / `TEST_DIR` / `TEST_FILE_GLOB_SUFFIX` imported from `@vitest-agent/sdk`); the exclude list re-states `configDefaults.exclude` plus the root-anchored `<path>/__test__/{fixtures,snapshots,utils}/**` (`TEST_HELPER_DIRS`) — NOT `__test__/**/<dir>/**`, which matched at any depth and silently dropped whole nested suites (issue #251); keep it in step with `classifyTestPath`, which inspects only the segment directly under `__test__/`. The exclude is emitted unconditionally and bounds each `NON_DISCOVERABLE_DIRS` entry (`node_modules`, `.git`, `dist`) under BOTH include roots — `<path>/{src,__test__}/**/<dir>/**`. An anchored include already can't reach a package's own top-level `dist/`; the bounded globs additionally cover build output nested deeper (`src/foo/dist/x.test.ts`), which `configDefaults.exclude` does not, so the emitted config prunes exactly what `findTestFiles` prunes |
| `utils/discover-projects.ts` | `discoverProjects({ strategy?, cwd?, additionalEntries?, fs?, syncOps?, maxDepth? })` runs the unified scan (`fs` is `@effected/walker`'s `WalkerSyncOps`, defaulting to `nodeWalkerSyncOps`; `syncOps` defaults to `@effected/workspaces`'s `nodeSyncOps`; `maxDepth`, when provided, forwards to workspace package enumeration): every workspace package goes through `strategy.buildProject` (null skips), then `.addProject` entries are merged in with name and normalized-path conflict detection. Returns `{ projects: TestProjectInlineConfiguration[] \| undefined; tags }`. Process cache fires only on the strategy-less, additional-entry-less call path, and is invalidated by a cheap per-package signature over exactly `src/` and `__test__/` (`SRC_DIR` / `TEST_DIR` from `@vitest-agent/sdk`; relative path + mtimeMs per file from `directorySignature`'s `descendEntriesSync` walk, no content reads) so the long-lived MCP server never serves stale include-globs (issue #100). The walks prune `node_modules` / `.git` / `dist` BEFORE recursing, so a fixture `node_modules` symlinked into the pnpm store is never descended. Every real scan records an ISO last-scan timestamp into a `Symbol.for("vitest-agent:discovery:last-scan-at")` process-global; `getLastDiscoveryScanTimestamp()` reads it (mcp reads the same slot directly — it cannot import the plugin). A declined package that still looks test-shaped (`isTestShapedPackage`) gets one stderr warning pointing at `vitest-agent agent check-test-path`, deduped module-level so a package warns at most once per process (issue #229) |
| `utils/is-test-shaped-package.ts` | `isTestShapedPackage(pkgPath)` — true when a `__test__/` directory exists at the package root (existence alone, not matching content) or `src/` holds a file matching `TEST_FILE_GLOB_SUFFIX`. Takes the same trailing optional `WalkerSyncOps` (default `nodeWalkerSyncOps`); reuses the `@vitest-agent/sdk` constants and the `findTestFiles` walker; drives the one-warning-per-declined-package stderr notice in `discover-projects.ts` |
| `utils/run-script-lock.ts` | The settings one `AgentPlugin.runScript` call runs under; the lock protocol itself (exclusive create, nonce-observed trust, pid-and-host probed takeover, owner-only release) is `@effected/commands`' `RunOnce`. `runScriptOptions(command, cwd, env)` builds the `RunOnceOptions`: `runScriptLockKey(cwd, command)` (truncated SHA-256 over the directory the command runs in plus the command, so a package's build never waits on and skips for the root's; a string and an argv command never share a key), `resolveRunScriptLockDir(env)` (`$XDG_DATA_HOME/vitest-agent/runscript-locks/`, same `~/.local/share` fallback as `data.db`), and the `VITEST_AGENT_RUNSCRIPT_LOCK_STALE_MS` / `_LOCK_WAIT_TIMEOUT_MS` / `_LOCK_POLL_MS` / `_BUILT_RECENTLY_MS` overrides parsed through `parseLockTimingOverride` (whole-string digits, bounds-checked against `MIN_LOCK_POLL_MS` for the poll; anything else falls back to the `RunOnce` default). `shellCommand(command, platform, env)` is the argv a string command runs as: `/bin/sh -c <cmd>`, or on win32 `%ComSpec%` (`cmd.exe`) `/d /s /c "<cmd>"` with `windowsVerbatimArguments`, exactly what Node's `shell` option spawns |
| `utils/is-benign-vite-source-map-warning.ts` | Pure `isBenignViteSourceMapWarning(message)` predicate matching only the benign Vite "Failed to load source map" + ENOENT `.js.map` shape (issue #110). Consumed by `plugin.ts`'s `configResolved` logger filter |
| `utils/classify-helpers.ts` | Pure ClassifyFn builders: `classifyByFilename` (record of suffixes or `[RegExp, tags]` tuples), `classifyByDirectory` (slash-bounded segment match), `combineClassifiers` (concat plus dedupe by tag name). Plug into `DiscoverStrategy.create({ classify })` or `.extend({ classify })` |
| `utils/walker-fs.ts` | `statOrNull(ops, path)`: the one read the discovery probes (`discover-strategy.ts`, `is-test-shaped-package.ts`) make outside a walk, a link-following `stat` that answers `null` instead of throwing. Every walk itself is `@effected/walker`'s `descendSync` / `descendEntriesSync` over the caller's `WalkerSyncOps` (`nodeWalkerSyncOps` in production). Tests pass `memfsWalkerOps(handle)` from `__test__/utils/memfs-walker.ts` (`{ fileSystem: handle.sync, path }`), so the walk makes the same `readdirSync` / `statSync` / `lstatSync` / `realpathSync` calls against a seeded virtual volume; see [Decision 88](../../okf/decisions/88-kit-walker-discovery.md) |
| `utils/find-test-files.ts` | Glob walk: `@effected/walker`'s `descendSync` with a `package.json` boundary, over the injected `WalkerSyncOps` (trailing optional param, defaults to `nodeWalkerSyncOps`); `directorySignature(dir, ops)` is the cache-signature walk (`descendEntriesSync`, same prune rules, no boundary). Matches through `@effected/glob`'s `GlobPattern` (the full minimatch dialect) with `dot: true`, the option Vitest passes to picomatch for `test.include`, so a test under a dot directory is found exactly when Vitest would collect it; a pattern that fails to compile matches nothing. Skips `NON_DISCOVERABLE_DIRS` from `@vitest-agent/sdk` (`node_modules`, `.git`, `dist` — the same constant `classifyTestPath` and the cache-signature walk use), and stops at a nested `package.json` boundary (any directory but the walk root that declares one is another unit — keeps `**/`-shaped patterns from double-counting sibling packages). The boundary applies to every pattern, anchored or not. Exported as part of the public surface so user strategies can reuse the walk without reimplementing it |
| `utils/tag.ts` | `Tag` class with `Tag.make(name, options?)`. Validates the name and exposes a `TestTagDefinition` via `.definition` for Vitest's `test.tags` array |
| `utils/inject-tags.ts` | Prepends a guarded two-line prelude to each classified test file: a namespace `vitest` import plus a try/catch that calls `TestRunner?.getCurrentSuite?.()`, resolves `collector?.suite ?? collector?.file`, and unions the resolved tags into the task's `tags`. Vitest's runner unions parent tags into every suite/test at registration, so every declaration form inherits — native `test`/`it`, wrapper testers like `@effect/vitest`'s `it.effect`, `test.extend` aliases, numeric-timeout third-arg calls, dynamic registration (issue #133). No acorn parsing; the `magic-string` prepend preserves source maps, and the try/catch degrades to untagged tests, never a crash. The plugin enables this transform whenever a `DiscoverStrategy` is active (the default) and bypasses it entirely when the user passes `discoverStrategy: false`. Subprocess e2e coverage lives in `__test__/inject-tags-prelude.e2e.test.ts` with the `__test__/fixtures/tag-prelude-project/` fixture |
| `layers/ReporterLive.ts` | `ReporterLive({ dbPath, env, logLevel?, logFile? })` = `CoverageAnalyzerLive` provided with the engine's `PlatformLive`. Used per-run via `Effect.runPromise` (not ManagedRuntime — the reporter is short-lived per run) |
| `bin/vitest-agent.ts`, `bin/vitest-agent-mcp.ts` | The carrier shims: import `main` from the front end and pass `{ distribution: { name: "@vitest-agent/plugin", version: CURRENT_PLUGIN_VERSION } }` (surfaced by `--version` and MCP `ping`). All process ownership lives in the front ends' `main.ts`. Never add logic here — the cli/mcp packages ship the same bins directly |
| `version.ts` | `CURRENT_PLUGIN_VERSION`, in its own module so the shims read it without importing the plugin graph; `plugin.ts` re-exports it |
| `__test__/workspace-layering.test.ts` | Holds the live package graph to the root `layers.json` through `WorkspaceLayering` (`@effected/workspaces/testing`) — the #412 rank rule (`sdk 1 → ui/sidecar-* 2 → engine/reporter/sidecar 3 → cli/mcp 4 → plugin 5`; root devDepends on plugin only) over runtime fields, no same-layer edge (so cli and mcp never depend on each other), and a DAG across every field. A synthetic upward + `cli -> mcp` edge is the positive control. A new workspace package needs an entry in `layers.json` — a layer, `tooling`, or an `unconstrained` glob, by package name |
| `__test__/undeclared-imports.test.ts` | `ImportGraph.undeclared` (`@effected/workspaces/testing`) over every workspace package's `src/**`: each runtime import must name a package in that package's own `dependencies` / `peerDependencies` / `optionalDependencies` (co-located test files are filtered out). Catches the one packaging bug no e2e test sees: a devDependency (or a root-only package) resolves through Node's upward lookup from `dist/` inside the workspace, and breaks only in a consumer install. Non-vacuous, with a memfs positive control. Replaced the packed-install e2e (#574), which CI never ran (no prod build in the test job) and which cost ~38 s per local run |

## AgentPlugin.discover()

`AgentPlugin.discover(strategy?)` is the canonical way to populate
`test.projects` and `test.tags` in `vitest.config.ts`. It returns a
thenable `DiscoverBuilder` that resolves to
`{ projects: TestProjectInlineConfiguration[] \| undefined; tags }` and
exposes `.addProject({ name, path })` for non-package folders that
hold tests. Use an async config export and await (or `.then`) the
builder:

```ts
export default async () => {
  const { projects, tags } = await AgentPlugin.discover();
  return defineConfig({
    plugins: [AgentPlugin()],
    test: { ...(projects ? { projects } : {}), tags },
  });
};
```

Add a non-package folder via `.addProject`. The builder is immutable —
every call returns a fresh builder. Conflict detection fires on
resolution if an added entry's name or normalized path collides with
an existing workspace package, or if its `buildProject` returns null:

```ts
const { projects, tags } = await AgentPlugin.discover()
  .addProject({ name: "integration", path: "./test-only" });
```

Internally calls `discoverProjects({ strategy?, cwd?, maxDepth?,
additionalEntries? })`. The argument to `discover` is overloaded: pass
a `DiscoverStrategy` directly, or pass an options object with optional
`strategy`, `cwd`, and `maxDepth`. With no argument, the builder uses
`DefaultDiscoverStrategy` and the current working directory.

The pre-2.0 `ProjectsCallback` argument shape and the legacy per-kind
override form (`{ unit?, int?, e2e? }`) were removed alongside the
`VitestProject` builder class and the `TagStrategy` namespace.
Test-kind shaping happens through `DiscoverStrategy.classify()` rather
than through projects. Users that need to mutate projects
post-discovery either extend the strategy or destructure the result
and mutate the array before spreading.

`coverageTargets` is a top-level option on `AgentPluginConstructorOptions`.
`coverageThresholds` is no longer a plugin option in any form — users set
Vitest's native `test.coverage.thresholds` directly. There is no
`discovery` field. The pre-T5 `tagStrategy` plugin option was renamed to
`discoverStrategy`; the `false` sentinel still disables the Vite
transform hook entirely.

The plugin namespace also exposes the dual-output preset constants
(`AgentPlugin.COVERAGE_LEVELS`, `AgentPlugin.COVERAGE_LEVELS_PER_FILE`)
that each return `{ thresholds, coverageTargets }`, plus
`AgentPlugin.COVERAGE_AUTOUPDATE` — three
`(next: number, previous: number) => number` tolerance functions
(`standard`, `strict`, `lenient`) that pass directly into Vitest's
native `coverage.thresholds.autoUpdate`; `lenient` never ratchets below
`previous`. The public `CoverageLevelPreset` type names the dual-output
shape for user wiring.

## AgentPlugin.runScript

`AgentPlugin.runScript(command)` runs a command with output suppressed
unless it fails — built for `globalSetup` build steps. A string command
runs through the platform shell (`shellCommand`), an argv array runs the
executable directly; both go through `RunOnce.commandSync` from
`@effected/commands` over `nodeRunOnceHost`, which captures output to
temporary files (the trailing 1 MiB of each stream is kept for the
failure). Concurrent invocations of the same command from the same
workspace serialize on the `RunOnce` file lock keyed by
`runScriptLockKey` (issue #191): the first caller runs the command, a
concurrent caller that waited on it skips its own run once that owner
succeeds. A previous, sequential run is never trusted unless
`VITEST_AGENT_RUNSCRIPT_BUILT_RECENTLY_MS` opts in. Tune the timings in
tests through the `VITEST_AGENT_RUNSCRIPT_*` env overrides, never by
changing the defaults. Serialization is best-effort by contract: a waiter
still blocked after the wait timeout, or a caller that cannot create the
lock, runs the command unserialized instead of hanging the caller's test
run. On failure the captured stderr and stdout are written to their
streams before the `CommandFailedError` is thrown.

## Conventions

- **No standalone `AgentReporter` export.** The class is an internal
  implementation detail constructed by `AgentPlugin()`. Don't export it.
  Users who want custom rendering implement `VitestAgentReporterFactory`
  and pass it as `reporterFactory` to `AgentPlugin()`.
- **Per-call layer construction is fine here.** The reporter runs
  `Effect.runPromise` in `onTestRunEnd` with `ReporterLive({ dbPath, env, ... })` inline.
  This is appropriate because the reporter runs briefly per test suite.
  Only the MCP server uses `ManagedRuntime`.
- **Rendering never depends on persistence (D47).** Keep `onTestRunEnd`'s
  persist and render programs separate: a DB, migration, or classification
  failure disables persistence and warns on stderr, but the render program
  still runs against `fallbackReports`. Never `return` early out of
  `onTestRunEnd` for a persistence-side failure, and never move
  DB-requiring services into the render program.
- **`ensureMigrated` (from `@vitest-agent/engine`) must be awaited before the persist Effect.** More
  than one connection in a process can open the same `data.db` (the MCP
  server runs Vitest in-process beside its own connection; a config can
  carry more than one reporter); `ensureMigrated` serializes the migration step via `@effected/store`'s
  `Store.migrateOnce`, a `globalThis` run registry (Decision 28). On rejection, record the formatted error
  and skip persistence — do not skip the render.
- **`process-failure.ts` is the only place signatures are computed.**
  Don't compute failure signatures directly in `reporter.ts`. The pipeline:
  `processFailure(error, options)` -> `{ frames, signatureHash }` ->
  `DataStore.writeFailureSignature` -> `DataStore.writeErrors` (with the
  `signatureHash` and `frames` on `TestErrorInput`).
- **`configure Vitest` is async.** Vitest awaits plugin hooks; the
  plugin calls `Effect.runPromise` for environment detection there.
  Don't make it synchronous.
- **One aggregating reporter per Vitest run.** `plugin.ts` pushes a
  single `AgentReporter` per run with no `projectFilter`
  (`aggregatedReporterByVitest`); later per-project `configureVitest`
  calls still apply project-scoped config but push nothing. That reporter
  groups modules by project and writes one `test_runs` row per project.
  It analyzes the global `CoverageMap` once (the `projectFilter` /
  `primaryProject` guard in `onTestRunEnd` only matters for a reporter
  constructed with a `projectFilter`, which the plugin no longer does),
  writes `file_coverage` rows ONCE per invocation under the first project
  group's run, and a `coverage_trends` row under every project's run.
  Readers resolve a project's rows through its `invocation_id` (issue #622;
  see `okf/limitations/coverage-shared-across-projects.md`).
- **The persist block runs inside `withPersistTransaction`.** Every
  `DataStore` write in `onTestRunEnd` commits as one SQLite transaction;
  a failure rolls the whole run back. The block never yields to the
  scheduler, so keep it free of genuinely asynchronous work, and do
  CPU-only work that needs no database (coverage analysis) before it.
  Rationale: `okf/decisions/84-run-persistence-transaction.md`; the trap
  it closes: `okf/invariants/persist-transaction-no-yield.md`.

## When working in this package

- Adding a workspace dependency: it must have a strictly lower rank
  (`workspace-layering.test.ts`); the plugin is the top of the graph, so
  nothing may depend on it except the workspace root.
- Touching `package.json#bin` or the shims: the dev workspace's
  `node_modules/.bin` is linked from this package's
  `publishConfig.linkDirectory` and does not prove a consumer install.
  Verify by hand: `pnpm run build`, pack the carrier and its closure, install
  the tarballs into a scratch consumer under pnpm (strict linker) and npm,
  and run both bins. No automated suite does this any more (#574).
- Adding a new reporter option: extend `AgentPluginOptions` in
  `@vitest-agent/sdk`'s `schemas/Options.ts` for data-shaped fields, or
  add it to the plugin's `AgentPluginConstructorOptions` companion
  interface for function-typed fields (the pattern `reporter` and
  `onRunEvent` already use). Thread it through `plugin.ts` ->
  `reporter.ts` -> `build-reporter-kit.ts` -> `ResolvedReporterConfig`
  as needed. After T7 `AgentReporterOptions` is intentionally tiny —
  one field (`projectFilter`) — and the reporter contract proper lives
  in `packages/sdk/src/contracts/reporter.ts`; do NOT pad
  `AgentReporterOptions` to mirror new plugin options. New
  user-controlled inputs go on `AgentPluginOptions` (or the companion
  interface); per-run resolved facts (for example, `coverageMode`,
  `mcp`, `githubActions`) belong on `ResolvedReporterConfig` and the
  plugin resolves them internally.
- Changing project discovery: edit `utils/discover-strategy.ts` for
  the abstract contract and the default implementation, or
  `utils/discover-projects.ts` for the scanner. The default strategy
  recognises only `<package>/src/` (co-located) and `<package>/__test__/`
  (canonical), both anchored at the package root — no nested `__test__/`
  elsewhere in the tree is discovered — and emits one project per
  workspace package (no kind suffix splitting — that moved to
  `DiscoverStrategy.classify`). The two locations are the single source
  of truth in `@vitest-agent/sdk`'s `utils/test-location.ts`
  (`SRC_DIR`, `TEST_DIR`, `TEST_HELPER_DIRS`, `TEST_FILE_GLOB_SUFFIX`,
  `NON_DISCOVERABLE_DIRS`, plus the `isTestFileName` predicate and
  `classifyTestPath` / `findOwningWorkspace`);
  don't re-derive the rule here. Helper subdirs (`utils/`, `fixtures/`,
  `snapshots/`) are excluded automatically only when they sit DIRECTLY
  under `__test__/`; nested ones (`__test__/unit/utils/`) are ordinary
  suites and must stay discoverable (issue #251). A null
  return from `buildProject` for a workspace package is a silent skip —
  unless the package still looks test-shaped, which earns one stderr
  warning per package per process (issue #229); a null return for an
  `.addProject` entry throws.
- Changing tag classification: edit
  `utils/discover-strategy.ts` for the `DiscoverStrategy` contract,
  `utils/classify-helpers.ts` for the standalone classifier
  builders, or `utils/tag.ts` if the `Tag` shape changes.
  `DefaultDiscoverStrategy` is the only strategy auto-applied;
  user-supplied strategies arrive via
  `AgentPlugin.discover(strategy)` and the renamed
  `discoverStrategy` plugin option. The classify result flows into the `inject-tags.ts` Vite transform, which prepends a file-level tag prelude; tags union into the file task at runner level, so existing user-supplied tags are preserved (set union) and every declaration form inherits them.
- Adding or editing a filesystem walk: walk with `@effected/walker`'s
  `descendSync` / `descendEntriesSync` over a `WalkerSyncOps` taken as a
  trailing optional param defaulting to `nodeWalkerSyncOps` (a lone stat
  goes through `statOrNull` in `utils/walker-fs.ts`) — never import
  `node:fs` into a walker. Tests pass `memfsWalkerOps(handle)` or
  `seedMemfsWalker(root, seed)` from `__test__/utils/memfs-walker.ts`.
- Adding a new utility that only this package uses: put it in
  `utils/`. If the utility is needed by MCP or CLI too, it belongs
  in `@vitest-agent/sdk/utils/` or `@vitest-agent/sdk/lib/`.
- Changing coverage behavior: `CoverageAnalyzer` lives in this package.
  CLI and MCP read pre-processed coverage from SQLite via `DataReader`;
  they never call `CoverageAnalyzer` directly.
- Changing reporter output routing: edit `route-rendered-output.ts`.
  The three targets are: `stdout` (write to `process.stdout`),
  `github-summary` (append to the configured summary file), `file`
  (reserved no-op).
- `strip-console-reporters.ts` removes `default`, `verbose`, `tree`,
  `dot`, `tap`, `tap-flat`, `hanging-process`, `agent` reporters
  whenever the resolved `consoleMode` owns stdout (anything other
  than `passthrough`). Custom reporters (class instances, file
  paths) and non-console built-ins (`json`, `junit`, `html`,
  `blob`, `github-actions`) are preserved.

## Console matrix and the onRunEvent tap

The pre-2.0 `mode` + `strategy` options are gone. After T7 the user-
facing `AgentPluginOptions` shape is exactly five fields. Console output
is controlled by a per-executor matrix at `AgentPluginOptions.console`:

```ts
AgentPlugin({
  console: {
    human?:  "passthrough" | "silent" | "stream" | "agent",
    agent?:  "passthrough" | "silent" | "agent",
    ci?:     "passthrough" | "silent" | "ci-annotations",
  },
  coverageTargets?: CoverageTargets,
  transport?: Transport,             // single-member { kind: "local" } today
  reporter?: VitestAgentReporterFactory,
  onRunEvent?: (event: RunEvent) => void,
})
```

`mcp` is auto-derived from the detected executor (`executor === "agent"`)
and `githubActions` is auto-derived from `EnvironmentDetector.ci` being
`github-actions` (running in GitHub Actions, independent of the console
audience — an agent in claude-code-action keeps it; issue #624) and
`consoleMode !== "silent"` — neither is a user option. `coverageThresholds`
moved to Vitest's native `coverage.thresholds`; `autoUpdate` to
`coverage.thresholds.autoUpdate` (function form via
`AgentPlugin.COVERAGE_AUTOUPDATE.<preset>`). `cacheDir` resolves through
the XDG path stack and `vitest-agent.config.toml`. `logLevel` /
`logFile` read from the `VITEST_REPORTER_LOG_LEVEL` /
`VITEST_REPORTER_LOG_FILE` env vars; the plugin's own debug lines
(component `vitest-agent:plugin`) go through the engine's
`LoggerLive(level, undefined, process.env)` — `CliLog`'s NDJSON
diagnostics-only mode, so NDJSON on stderr even for a human at a TTY, with
workflow commands neutralized under GitHub Actions — and print only at
`debug`, `trace`, or `all`. The reporter passes `process.env` to
`ensureMigrated` for the same reason. The
`discover-strategy` CI check is the pure
`RuntimeEnv.fromRecord(process.env).ci`. The plugin declares
`@effected/cli`, `env`, `glob`, and `walker` as regular dependencies
because reporter and ui take them as peers (and `@effected/cli`, which the plugin provides, takes `env` / `glob` / `walker` as required peers; the plugin imports no `walker` itself). The coverage-provider peers are optional (`peerDependenciesMeta`): a consumer installs one provider, and the plugin names them only as strings.

The plugin auto-detects the executor (`human`/`agent`/`ci`) via
`EnvironmentDetector`, looks up the matching slot, and resolves a
single `ConsoleMode` value; the executor comes from engine's
`ExecutorResolverLive`. A `VITEST_AGENT_CONSOLE` override is read through
`@effected/env`'s `EnvOverride.readResult` (`readConsoleOverride`,
`source: process.env` so each read sees the current env, case-insensitive); one not valid for the detected executor is ignored
with one stderr line the plugin words itself from the structured
rejection — `[vitest-agent:plugin] ignoring VITEST_AGENT_CONSOLE=<v>: not
accepted for the <audience> audience (accepts a|b)` — whose accepted
literals are read off the schema's `.literals`, so the message cannot
drift from the schema. Deduped once per run (issue #459).
Per-slot defaults:

- `human` → `passthrough` (Vitest's own reporters do visible work)
- `agent` → `agent` (markdown-flavored final-frame string)
- `ci` → `passthrough` (Vitest's reporters produce log-friendly output)

Two derived decisions follow from the resolved mode:

1. **Stdout ownership.** Any non-`passthrough` value strips Vitest's reporters and suppresses Vitest's native coverage text reporter. The plugin owns stdout for the run.
2. **Default reporter selection.** When no `reporter` option is supplied, the plugin injects `DefaultVitestAgentReporter` from `@vitest-agent/reporter`. That reporter branches internally on `consoleMode` and owns the Ink live-mount lifecycle itself — the plugin only feeds it the run-event stream (via `ReporterKit.runEvents`) and the resolved kit.

The T6 rewrite removed the per-consoleMode gating of the `onRunEvent` tap. The plugin now forwards the user's `onRunEvent` callback to `AgentReporter` for every consoleMode (`AgentReporter.emit` catches thrown taps and logs to stderr — persistence never breaks because a tap has a bug). Channel suppression for non-`stream` modes is the default reporter's responsibility, not the tap's. Tests for the unconditional-forwarding contract live in `__test__/reporter-streaming.test.ts`.

### `AgentReporter`'s streaming callbacks

`AgentReporter` wires every Vitest reporter hook — the streaming
surface is now complete. Alongside `onInit`/`onCoverage`/`onTestRunEnd`
it implements `onTestRunStart`, `onTestModuleQueued`,
`onTestModuleCollected`, `onTestModuleStart`, `onTestModuleEnd`,
`onTestSuiteReady`, `onTestSuiteResult`, `onTestCaseReady`,
`onTestCaseResult`, `onHookStart`, `onHookEnd`, `onUserConsoleLog`,
`onProcessTimeout`, `onTestCaseAnnotate`, `onTestCaseArtifactRecord`,
`onWatcherStart`, and `onWatcherRerun`. Each callback constructs a
`RunEvent`, publishes it on the `ReporterKit.runEvents` PubSub channel
(so a subscribed reporter sees it live), and fires `options.onRunEvent`
(when set) as a host-introspection tee. `onTestCaseReady` emits
`TestStarted`; `onTestCaseResult` emits only `TestFinished`. The eleven
`RunEvent` variants added by the streaming workstream —
`ModuleCollected`, `SuiteStarted`, `SuiteFinished`, `HookStarted`,
`HookFinished`, `ConsoleLog`, `RunTimedOut`, `TestAnnotated`,
`TestArtifactRecorded`, `WatcherReady`, `WatcherRerun` — complete the
core union. Coverage events (`CoverageReady` / `ThresholdViolation`)
are emitted from `onTestRunEnd`, which also publishes `RunFinished` at
the top of the persistence pipeline so a live reporter sees end-of-run
before the heavy persistence work runs. That `RunFinished` carries
`collectedModules` (the full collected count, passing modules included)
for parity with both `@vitest-agent/ui` synthesizers. Throwing taps are caught and
logged to stderr — persistence never breaks because a live renderer
has a bug.

The stream-mode-states workstream adds timeout and trend signals to the
callback surface. `AgentReporter` runs `isTimeoutError` from
`utils/detect-timeout.ts` over each failed test: a timeout-flavored
failure sets a new optional `timedOut` boolean on `TestFinished`, and
those tests fold into a separate `timeoutCount` (split out of the fail
count) on `ModuleFinished` and `RunFinished`. Each module also tallies
per-module `tagCounts`. After the trend is computed in the end-of-run
pipeline, `onTestRunEnd` emits a new `TrendComputed` `RunEvent`
(carrying `direction` / `runCount`) alongside the existing
`CoverageReady` emit, so a live reporter can render the Trend line. The
timed-out distinction is render-only — a timed-out test still persists
to SQLite as `failed` (no schema or migration change).

## Design references

- [`../../okf/modules/plugin.md`](../../okf/modules/plugin.md)
  Load when working on `AgentPlugin`, the internal `AgentReporter`,
  `CoverageAnalyzer`, or the reporter-side utilities.
- [`../../okf/interfaces/agent-plugin-options.md`](../../okf/interfaces/agent-plugin-options.md)
  Load when tracing the test-run pipeline: `AgentReporter` lifecycle
  (Full-mode persistence/coverage/baseline path and the UI-only
  short-circuit) and `AgentPlugin.configureVitest` (`ConfigValidation` and
  `coverageMode` resolution).
- [`../../okf/decisions/40-agentpluginoptions-is-exactly-five-fields.md`](../../okf/decisions/40-agentpluginoptions-is-exactly-five-fields.md),
  [`../../okf/decisions/34-plugin-reporter-split.md`](../../okf/decisions/34-plugin-reporter-split.md),
  [`../../okf/decisions/47-rendering-never-depends-on-persistence.md`](../../okf/decisions/47-rendering-never-depends-on-persistence.md),
  [`../../okf/decisions/48-honest-run-reporting.md`](../../okf/decisions/48-honest-run-reporting.md),
  [`../../okf/decisions/38-coverage-policy-presets-configvalidation-full-and-ui-only-modes.md`](../../okf/decisions/38-coverage-policy-presets-configvalidation-full-and-ui-only-modes.md),
  [`../../okf/decisions/28-process-level-migration-coordination-via-globalthis-cache.md`](../../okf/decisions/28-process-level-migration-coordination-via-globalthis-cache.md),
  [`../../okf/decisions/d10-stable-failure-signatures-via-ast-function-boundary.md`](../../okf/decisions/d10-stable-failure-signatures-via-ast-function-boundary.md)
  Load when you need rationale for, respectively: the five-field options
  surface and the `transport` forward-declaration, the plugin/reporter
  split, render-never-depends-on-persistence, honest run reporting,
  coverage policy (`coverageMode`, dual-output `COVERAGE_LEVELS` presets,
  `COVERAGE_AUTOUPDATE`, `ConfigValidation`), `ensureMigrated`'s globalThis
  cache, and failure signatures.
- [`../../okf/decisions/59-detect-partial-runs-and-neutralise-the-native-threshold-check.md`](../../okf/decisions/59-detect-partial-runs-and-neutralise-the-native-threshold-check.md)
  Load when touching `isPartialRun` / `hasCliScopeFilter`, the
  `cliFilters` and `testNamePattern` signals (issue #401), or the
  coverage-threshold neutralise-and-restore pair around a scoped run.
- [`../../okf/interfaces/discover-api.md`](../../okf/interfaces/discover-api.md)
  Load when working on `AgentPlugin.discover()`, the `DiscoverBuilder`
  thenable, `discoverProjects()`, `DiscoverStrategy`,
  `DefaultDiscoverStrategy`, the classifier helpers, the `findTestFiles`
  walker, or the `WalkerSyncOps` filesystem seam.
- [`../../okf/conventions/test-layout.md`](../../okf/conventions/test-layout.md), [`../../okf/conventions/test-patterns.md`](../../okf/conventions/test-patterns.md)
  Load when writing tests for this package, including the `__test__/`
  layout and helper subdirectory exclusion conventions.

## Agent-agnostic taxonomy additions (Phase 4)

`AgentReporter` walks attribution sources at `onTestRunEnd` and writes
the result to every `test_runs` row:

1. Source 1 — read `VITEST_AGENT_AGENT_ID` and `VITEST_AGENT_CONVERSATION_ID` from `process.env`. These are populated upstream by the SessionStart hook (writes to `CLAUDE_ENV_FILE`, auto-sourced into Bash subprocesses + the MCP server child), the PreToolUse Bash hook's `updatedInput.command` rewrite (per-call env prefix on Vitest invocations), and the MCP `run_tests` tool's `process.env` mutation from `SessionContextRef`. When set, the reporter records `actor_type='agent'` plus the canonical UUIDs.
2. Source 3 — when no env vars are set, records `actor_type='system'` and NULL agent / conversation ids. CI runs and direct `pnpm vitest` invocations from a human at a terminal land here.

Host metadata is captured via `@vitest-agent/engine`'s `probeHostMetadataFromEnv(process.env)` (`utils/host-metadata.ts`, over `@effected/env`'s `RuntimeEnv` snapshot: terminal session first, then the CI job; issue #548). Git context capture rides the `RunContext` service integration on the future per-run path; today the reporter passes the existing `GITHUB_SHA`/`GITHUB_REF_NAME` columns through the new `git_branch` / `git_commit_sha` slots. `host_metadata` serializes via `JSON.stringify`.
