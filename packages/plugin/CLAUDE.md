# vitest-agent-plugin

The Vitest plugin (`AgentPlugin()`) and internal `AgentReporter` Vitest-API
class. Owns the Vitest lifecycle hooks, persistence, classification,
baseline/trend computation, and delegates rendering entirely to a
`VitestAgentReporterFactory` — it injects `DefaultVitestAgentReporter` from
`vitest-agent-reporter` when the user does not pass a custom `reporter`
option, and never touches rendering itself. The reporter owns mode
branching and the Ink live-mount lifecycle. Declares `vitest-agent-cli`
and `vitest-agent-mcp` as required `peerDependencies` (alongside the
Vitest-side peers `vitest`, `@vitest/runner`, `@vitest/coverage-v8`,
`@vitest/coverage-istanbul`), plus regular workspace `dependencies` on
`vitest-agent-reporter` and `vitest-agent-sdk`. The plugin no longer
depends on `vitest-agent-ui`, `react`, or `ink` — `reporter` pulls those
transitively. `vitest-agent-sidecar` is not a direct dependency — it
arrives transitively through the required `vitest-agent-cli` peer.

## Layout

```text
src/
  index.ts            -- public re-exports
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
                                   are merged in with conflict detection
    classify-helpers.ts        -- classifyByFilename, classifyByDirectory,
                                   combineClassifiers (pure ClassifyFn builders)
    find-test-files.ts         -- async glob walker (node:fs/promises) with an
                                   inline glob-to-regex compiler; skips
                                   node_modules, .git, dist by default
    tag.ts                     -- Tag class + Tag.make factory
    inject-tags.ts             -- Vite transform for test.tags
```

## Key files

| File | Purpose |
| ---- | ------- |
| `plugin.ts` | `AgentPlugin(options?)` factory + `AgentPlugin` namespace. Resolves env + executor + console matrix → single `ConsoleMode` value; strips Vitest reporters and suppresses Vitest's coverage table whenever the resolved mode owns stdout (any value other than `passthrough`); forwards the user's `onRunEvent` tap unconditionally for every consoleMode (the T6 rewrite removed the previous `stream`-only gating); injects `DefaultVitestAgentReporter` from `vitest-agent-reporter` when no `reporter` option is supplied; injects `AgentReporter` per project via `configureVitest`. Resolves `coverageMode` from Vitest's native `coverage.enabled` and threads it onto `ResolvedReporterConfig`. Runs the `ConfigValidation` service in `configureVitest` (warnings to stderr via `[vitest-agent:plugin]`; errors throw via `formatFatalError`). Namespace exposes `COVERAGE_LEVELS`, `COVERAGE_LEVELS_PER_FILE`, `COVERAGE_AUTOUPDATE`, and `discover()` |
| `reporter.ts` | Internal `AgentReporter` class. Imports `DefaultVitestAgentReporter` from `vitest-agent-reporter`; imports nothing from `vitest-agent-ui`. Creates an Effect `PubSub` run-event channel and publishes one `RunEvent` per Vitest streaming callback onto it; it wires every Vitest reporter hook, so the channel carries the complete `RunEvent` surface. The channel rides `ReporterKit.runEvents` (optional field). The reporter factory is invoked at run start (`onInit`) so a live reporter can subscribe before the first event — the plugin no longer drives the Ink mount, holds a `liveInk` field, or calls `hasSubscribers()`. `onTestRunEnd` runs the full persistence/classification/baseline/trend pipeline in Full mode, then calls `opts.reporter.render(input, kit)` and routes `RenderedOutput[]`. In UI-only mode (`opts.coverageMode === "ui-only"`), the handler short-circuits after `RunFinished` and `filteredModules`: builds reports via `buildAgentReport`, runs a tiny `OutputPipelineLive` + `NodeContext.layer` program to resolve env/executor/format/detail, builds the kit, and routes the renderer output. No `ensureMigrated`, no `DataStore.write*`, no `CoverageAnalyzer.process`, no `HistoryTracker` |
| `services/CoverageAnalyzer.ts` | Effect service tag for coverage processing. Only lives here because the reporter lifecycle class feeds it coverage data; CLI/MCP read pre-processed coverage from SQLite |
| `services/ConfigValidation.ts` | Effect service tag `vitest-agent/ConfigValidation` with one method `validate(input): Effect<ValidationResult, never, never>`. `ValidationError` carries optional `path` for pinpointed diagnostics and optional `remediation` for install-command-style fixes |
| `layers/ConfigValidationLive.ts` | Runs the seven-rule starter registry: `TARGET_WITHOUT_THRESHOLD` (warn), `TARGET_BELOW_THRESHOLD` (error), `THRESHOLD_WITHOUT_TARGET` (silent), `INVALID_TARGET_VALUE` (error, top + nested glob), `UNSUPPORTED_PROVIDER` (error, Full mode only), `MISSING_PROVIDER_PACKAGE` (error via `createRequire`, Full mode only, with install-command remediation), `PERFILE_ON_TARGETS` (warn). Mode resolution reads `vitestConfig.coverage?.enabled` — `false` → UI-only (skip provider rules), anything else → Full |
| `layers/ConfigValidationTest.ts` | `ConfigValidationTest.layer(override?: ValidationResult)` for unit tests that inject pre-built results |
| `utils/process-failure.ts` | Per-error signature pipeline. Called from `onTestRunEnd` for each error before `DataStore.writeErrors`. Returns `frames: StackFrameInput[]` and `signatureHash` |
| `utils/build-reporter-kit.ts` | Constructs `ReporterKit` from resolved config + detected environment + `noColor` flag. `stdOsc8` is enabled when `!noColor && (env === "terminal" \|\| env === "agent-shell")` |
| `utils/route-rendered-output.ts` | Dispatches a single `RenderedOutput` to its target: `stdout`, `github-summary` (append), or `file` (no-op) |
| `utils/discover-strategy.ts` | `DiscoverStrategy` abstract class plus the `DefaultDiscoverStrategy` concrete subclass. Base factory is `DiscoverStrategy.create({ tags, buildProject, classify })`; `.extend({ additionalTags?, buildProject?, classify? })` chains immutable layers. The default strategy ships unit / int / e2e tags and a filename-suffix classifier, and its `buildProject` returns null when neither `src/` nor `__test__/` has tests |
| `utils/discover-projects.ts` | `discoverProjects({ strategy?, cwd?, additionalEntries? })` runs the unified scan: every workspace package goes through `strategy.buildProject` (null skips), then `.addProject` entries are merged in with name and normalized-path conflict detection. Returns `{ projects: TestProjectInlineConfiguration[] \| undefined; tags }`. Process cache fires only on the strategy-less, additional-entry-less call path |
| `utils/classify-helpers.ts` | Pure ClassifyFn builders: `classifyByFilename` (record of suffixes or `[RegExp, tags]` tuples), `classifyByDirectory` (slash-bounded segment match), `combineClassifiers` (concat plus dedupe by tag name). Plug into `DiscoverStrategy.create({ classify })` or `.extend({ classify })` |
| `utils/find-test-files.ts` | Async glob walker built on `node:fs/promises` with an inline glob-to-regex compiler. Skips `node_modules`, `.git`, `dist` by default. Exported as part of the public surface so user strategies can reuse the walk without reimplementing it |
| `utils/tag.ts` | `Tag` class with `Tag.make(name, options?)`. Validates the name and exposes a `TestTagDefinition` via `.definition` for Vitest's `test.tags` array |
| `utils/inject-tags.ts` | Vite `transform` that rewrites `test()`/`it()` call options via acorn plus `magic-string`, adding the resolved tags array. Preserves source maps. The plugin enables this transform whenever a `DiscoverStrategy` is active (the default) and bypasses it entirely when the user passes `discoverStrategy: false` |
| `layers/ReporterLive.ts` | Composition layer for `AgentReporter`. Used per-run via `Effect.runPromise` (not ManagedRuntime — the reporter is short-lived per run) |

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

Internally calls `discoverProjects({ strategy?, cwd?,
additionalEntries? })`. The argument to `discover` is overloaded: pass
a `DiscoverStrategy` directly, or pass an options object with optional
`strategy` and `cwd`. With no argument, the builder uses
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
`AgentPlugin.COVERAGE_AUTOUPDATE` — three `(n: number) => number`
tolerance functions (`standard`, `strict`, `lenient`) that pass
directly into Vitest's native `coverage.thresholds.autoUpdate`. The
public `CoverageLevelPreset` type names the dual-output shape for
user wiring.

## Conventions

- **No standalone `AgentReporter` export.** The class is an internal
  implementation detail constructed by `AgentPlugin()`. Don't export it.
  Users who want custom rendering implement `VitestAgentReporterFactory`
  and pass it as `reporterFactory` to `AgentPlugin()`.
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

- Adding a new reporter option: extend `AgentPluginOptions` in
  `vitest-agent-sdk`'s `schemas/Options.ts` for data-shaped fields, or
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
  recognises both `src/` (legacy) and `__test__/` (canonical) test
  directories and emits one project per workspace package (no kind
  suffix splitting — that moved to `DiscoverStrategy.classify`).
  Helper subdirs (`utils/`, `fixtures/`, `snapshots/`) inside
  `__test__/` are excluded automatically. A null return from
  `buildProject` for a workspace package is a silent skip; a null
  return for an `.addProject` entry throws.
- Changing tag classification: edit
  `utils/discover-strategy.ts` for the `DiscoverStrategy` contract,
  `utils/classify-helpers.ts` for the standalone classifier
  builders, or `utils/tag.ts` if the `Tag` shape changes.
  `DefaultDiscoverStrategy` is the only strategy auto-applied;
  user-supplied strategies arrive via
  `AgentPlugin.discover(strategy)` and the renamed
  `discoverStrategy` plugin option. The classify result flows into
  the `inject-tags.ts` Vite transform, which mutates the parsed
  `test()` / `it()` options argument directly so source maps and
  existing user-supplied tags are preserved.
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
and `githubActions` is auto-derived from `env === "ci-github" &&
consoleMode !== "silent"` — neither is a user option. `coverageThresholds`
moved to Vitest's native `coverage.thresholds`; `autoUpdate` to
`coverage.thresholds.autoUpdate` (function form via
`AgentPlugin.COVERAGE_AUTOUPDATE.<preset>`). `cacheDir` resolves through
the XDG path stack and `vitest-agent.config.toml`. `logLevel` /
`logFile` read from the `VITEST_REPORTER_LOG_LEVEL` /
`VITEST_REPORTER_LOG_FILE` env vars.

The plugin auto-detects the executor (`human`/`agent`/`ci`) via
`EnvironmentDetector`, looks up the matching slot, and resolves a
single `ConsoleMode` value. Per-slot defaults:

- `human` → `passthrough` (Vitest's own reporters do visible work)
- `agent` → `agent` (markdown-flavored final-frame string)
- `ci` → `passthrough` (Vitest's reporters produce log-friendly output)

Two derived decisions follow from the resolved mode:

1. **Stdout ownership.** Any non-`passthrough` value strips Vitest's reporters and suppresses Vitest's native coverage text reporter. The plugin owns stdout for the run.
2. **Default reporter selection.** When no `reporter` option is supplied, the plugin injects `DefaultVitestAgentReporter` from `vitest-agent-reporter`. That reporter branches internally on `consoleMode` and owns the Ink live-mount lifecycle itself — the plugin only feeds it the run-event stream (via `ReporterKit.runEvents`) and the resolved kit.

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
before the heavy persistence work runs. Throwing taps are caught and
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

- `@./.claude/design/vitest-agent/components/plugin.md`
  Load when working on `AgentPlugin`, the internal `AgentReporter`,
  `CoverageAnalyzer`, or the reporter-side utilities.
- `@./.claude/design/vitest-agent/data-flows.md`
  Load when tracing the test-run pipeline (Flow 1: `AgentReporter`
  lifecycle, including the Full-mode persistence/coverage/baseline path
  and the UI-only short-circuit; Flow 2: `AgentPlugin.configureVitest`,
  including `ConfigValidation` and `coverageMode` resolution).
- `@./.claude/design/vitest-agent/decisions.md`
  Load when you need rationale (especially D40 T7 five-field options
  surface and the `transport` forward-declaration, D34 plugin/reporter
  split, D38 T4 coverage policy — `coverageMode`, dual-output
  `COVERAGE_LEVELS` presets, `COVERAGE_AUTOUPDATE`, `ConfigValidation`
  service — D7 per-call `Effect.runPromise`, D28 `ensureMigrated`
  globalThis cache, D10 failure signatures).
- `@./.claude/design/vitest-agent/components/discover.md`
  Load when working on `AgentPlugin.discover()`, the `DiscoverBuilder`
  thenable, `discoverProjects()`, `DiscoverStrategy`,
  `DefaultDiscoverStrategy`, the classifier helpers, or the
  `findTestFiles` walker.
- `@./.claude/design/vitest-agent/testing-strategy.md`
  Load when writing tests for this package, including the `__test__/`
  layout and helper subdirectory exclusion conventions.

## Agent-agnostic taxonomy additions (Phase 4)

`AgentReporter` walks attribution sources at `onTestRunEnd` and writes
the result to every `test_runs` row:

1. Source 1 — read `VITEST_AGENT_AGENT_ID` and `VITEST_AGENT_CONVERSATION_ID` from `process.env`. These are populated upstream by the SessionStart hook (writes to `CLAUDE_ENV_FILE`, auto-sourced into Bash subprocesses + the MCP server child), the PreToolUse Bash hook's `updatedInput.command` rewrite (per-call env prefix on Vitest invocations), and the MCP `run_tests` tool's `process.env` mutation from `SessionContextRef`. When set, the reporter records `actor_type='agent'` plus the canonical UUIDs.
2. Source 3 — when no env vars are set, records `actor_type='system'` and NULL agent / conversation ids. CI runs and direct `pnpm vitest` invocations from a human at a terminal land here.

Host metadata is captured via `probeHostMetadataFromEnv(process.env)` (the 9-tier probe chain in `vitest-agent-sdk`'s utils). Git context capture rides the `RunContext` service integration on the future per-run path; today the reporter passes the existing `GITHUB_SHA`/`GITHUB_REF_NAME` columns through the new `git_branch` / `git_commit_sha` slots. `host_metadata` serializes via `JSON.stringify`.
