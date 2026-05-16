# vitest-agent-ui

## 2.0.0

### Breaking Changes

* [`d8ca78d`](https://github.com/spencerbeggs/vitest-agent/commit/d8ca78d0ec40613da3176e37a66bcc6090db0336) ### `mode` and `strategy` removed from `AgentPlugin` options

The `mode: "auto" | "agent" | "silent"` and `strategy: "own" | "complement"` options on `AgentPlugin({})` are gone. They conflated two orthogonal axes: who is observing (human / agent / ci) and what they should see. Replace them with the new per-executor `console` matrix:

```ts
AgentPlugin({
  console: {
    human?: "passthrough" | "silent" | "ink" | "agent",
    agent?: "passthrough" | "silent" | "agent",
    ci?:    "passthrough" | "silent" | "ci-annotations",
  },
})
```

The plugin auto-detects the executor and looks up the matching slot. Per-slot defaults: `human` → `passthrough`, `agent` → `agent`, `ci` → `passthrough`. Any non-`passthrough` value strips Vitest's reporters so the plugin owns stdout. Debug an agent-style output in a human terminal by setting `console.human: "agent"`. Force silence on any slot with `silent`.

* [`47e811f`](https://github.com/spencerbeggs/vitest-agent/commit/47e811f0640ea96e508904a53900ef435f242eab) ### `coverageThresholds` removed from `AgentPlugin` options

`AgentPlugin({ coverageThresholds })` is no longer read. Users set Vitest's native `test.coverage.thresholds` directly — the plugin integrates with the standard Vitest config instead of duplicating its surface. The legacy preset-name string and `CoverageLevel` instance forms are gone from the plugin option; the underlying `CoverageLevel` class still ships from `vitest-agent-sdk` for users who want to compose their own thresholds.

Migration: move the threshold value into Vitest's native config and drop the plugin field.

```ts
// Before
AgentPlugin({ coverageThresholds: "standard" });

// After
const preset = AgentPlugin.COVERAGE_LEVELS.standard;
AgentPlugin({ coverageTargets: preset.coverageTargets });
// test.coverage.thresholds: preset.thresholds
```

* [`14f9eca`](https://github.com/spencerbeggs/vitest-agent/commit/14f9ecae157bd148d2ce8529c066934561c4a266) ### Unified DiscoverStrategy replaces TagStrategy and VitestProject

A single `DiscoverStrategy` abstract class now owns both project detection and tag classification — the responsibilities the pre-2.0 `TagStrategy` and `VitestProject` classes split between them. `DefaultDiscoverStrategy` ships as the implicit default. Custom strategies subclass directly or use `DiscoverStrategy.create({ tags, buildProject, classify })`; `.extend({ additionalTags?, buildProject?, classify? })` layers immutably so chained classifiers and project builders compose without mutating the receiver.

Migration: replace `TagStrategy.create(...)` with `DiscoverStrategy.create(...)` and supply a `buildProject` function that returns either a `TestProjectInlineConfiguration` or `null`. Replace `new VitestProject.unit({ name, include, overrides })` with a plain object that satisfies the Vitest-native type.

* [`c055f7d`](https://github.com/spencerbeggs/vitest-agent/commit/c055f7dcceb90a13c6ebe7c8d6058804ca715d69) ### vitest-agent-ui public surface replaced

The previous renderer-facing exports are removed. Gone are the event-sourced reporter factory and its options type, the live Ink renderer factory and its options type, the live renderer class, the one-shot render-run helper plus its from-state variant, and the render-run mode and options types.

The new public surface is a preassembled default reporter (the value the plugin wires automatically), the dispatch-input builder, the cell-options resolver, and the per-report convenience helpers for agent-string and human-string output.

It also exposes the dispatcher entry points: single dispatch, Ink dispatch, the dispatcher table, the run-shape and outcome classifiers, the footer builder, and the dominant-classification helper. The dispatcher contract types are re-exported from the SDK so every package reads the same definitions.

### Features

* [`d8ca78d`](https://github.com/spencerbeggs/vitest-agent/commit/d8ca78d0ec40613da3176e37a66bcc6090db0336) ### `vitest-agent-ui` — shared event-sourced renderer

A new workspace package owning the post-2.0 terminal-output stack. Re-exports the `RunEvent` discriminated union and `RenderState` projection from the SDK, ships the pure reducer, the markdown-flavored agent renderer (`renderAgent`), the React Ink component tree (`<App>`, `<RunSummary>`, `<ModuleHeader>`, `<TestRow>`, `<ModuleRow>`, `<FailureSection>`, `<CoverageBlock>`, `<SuggestedActions>`, `<StatusIcon>`), an Effect `PubSub` channel for live event transport, two synthesizers (`synthesizeRunEvents` for live Vitest module data, `synthesizeFromAgentReport` for persisted reports), a `renderRun` one-shot helper, the `eventSourcedReporter` factory implementing `VitestAgentReporterFactory`, and `createLiveInk` for long-running Ink mounts driven by streaming events.

Three public consumer surfaces:

```ts
import {
  renderRun,
  eventSourcedReporter,
  createLiveInk,
} from "vitest-agent-ui";
```

* `renderRun(events, mode, options)` — synchronous one-shot. Used by the CLI `show` command and any host that wants a final-frame string.
* `eventSourcedReporter` — `VitestAgentReporterFactory` for the plugin's `reporter` option. Emits one `RenderedOutput` per project in `agent` mode; emits `[]` in `ink`, `silent`, `passthrough`, and `ci-annotations` modes (other channels own the visible work).
* `createLiveInk()` — long-running orchestration handle with `event(e)` / `unmount()` / `snapshot()`. Wire as the plugin's `onRunEvent` tap to get a live Ink mount that redraws as test events arrive.

React and Ink are peer dependencies.

### Features

* [`47e811f`](https://github.com/spencerbeggs/vitest-agent/commit/47e811f0640ea96e508904a53900ef435f242eab) ### `ConfigValidation` Effect service

A new service under `vitest-agent-plugin` runs at plugin init with a seven-rule starter registry: TARGET\_WITHOUT\_THRESHOLD warns, TARGET\_BELOW\_THRESHOLD errors, THRESHOLD\_WITHOUT\_TARGET is silent, INVALID\_TARGET\_VALUE errors with the offending path, UNSUPPORTED\_PROVIDER errors in Full mode, MISSING\_PROVIDER\_PACKAGE errors with the install command, PERFILE\_ON\_TARGETS warns. Warnings and info entries print through the plugin's stderr prefix; errors throw via `formatFatalError` and refuse to start the run. A test-layer factory accepts pre-built results for unit-test injection.

### Features

* [`14f9eca`](https://github.com/spencerbeggs/vitest-agent/commit/14f9ecae157bd148d2ce8529c066934561c4a266) ### Three classifier composition helpers

`classifyByFilename`, `classifyByDirectory`, and `combineClassifiers` ship as pure helpers from `vitest-agent-plugin`. `classifyByFilename` accepts a record of suffix strings or an array of regex tuples. `classifyByDirectory` matches relative paths with slash boundaries so a key like "integration" matches "src/integration/foo.test.ts" but not "my-integration-tests/foo.test.ts". `combineClassifiers` concatenates results in order and deduplicates by tag name, so chained classifiers can safely overlap.

### Features

* [`c055f7d`](https://github.com/spencerbeggs/vitest-agent/commit/c055f7dcceb90a13c6ebe7c8d6058804ca715d69) ### Shape-tailored dispatcher matrix

A new dispatch layer in vitest-agent-ui routes each rendered run by a run-shape and run-outcome pair to a dedicated cell that produces both an agent-oriented string and an Ink-tree variant.

Cells cover the single-test, single-file, single-project, and workspace shapes, crossed with the all-pass, some-fail, and threshold-violation outcomes.

Run shape and outcome are computed by classifier helpers exported alongside the dispatcher table and the dominant-classification helper used to pick a representative outcome when multiple are present.

### Features

* [`01df6ba`](https://github.com/spencerbeggs/vitest-agent/commit/01df6ba7ce3daf0f1ffa19f0e170b0154800f936) ### Cross-package version constants

Exports CURRENT\_UI\_VERSION, a build-time string constant injected from package.json at compile time. The constant follows the same build-time injection pattern used by all six packages in the lockstep release family.

### Maintenance

* [`c055f7d`](https://github.com/spencerbeggs/vitest-agent/commit/c055f7dcceb90a13c6ebe7c8d6058804ca715d69) The MCP package is not directly touched by this workstream but receives a major bump to keep the six runtime packages aligned on the lockstep release.

### `PluginMode` and `ConsoleStrategy` schemas removed from the SDK

The two literal-union schemas are gone. In their place: `HumanConsoleMode`, `AgentConsoleMode`, `CiConsoleMode`, and the umbrella `ConsoleMode` union (re-exported from `vitest-agent-sdk`).

* [`47e811f`](https://github.com/spencerbeggs/vitest-agent/commit/47e811f0640ea96e508904a53900ef435f242eab) ### `ConfigValidation` Effect service

A new service under `vitest-agent-plugin` runs at plugin init with a seven-rule starter registry: TARGET\_WITHOUT\_THRESHOLD warns, TARGET\_BELOW\_THRESHOLD errors, THRESHOLD\_WITHOUT\_TARGET is silent, INVALID\_TARGET\_VALUE errors with the offending path, UNSUPPORTED\_PROVIDER errors in Full mode, MISSING\_PROVIDER\_PACKAGE errors with the install command, PERFILE\_ON\_TARGETS warns. Warnings and info entries print through the plugin's stderr prefix; errors throw via `formatFatalError` and refuse to start the run. A test-layer factory accepts pre-built results for unit-test injection.

* [`14f9eca`](https://github.com/spencerbeggs/vitest-agent/commit/14f9ecae157bd148d2ce8529c066934561c4a266) ### Three classifier composition helpers

`classifyByFilename`, `classifyByDirectory`, and `combineClassifiers` ship as pure helpers from `vitest-agent-plugin`. `classifyByFilename` accepts a record of suffix strings or an array of regex tuples. `classifyByDirectory` matches relative paths with slash boundaries so a key like "integration" matches "src/integration/foo.test.ts" but not "my-integration-tests/foo.test.ts". `combineClassifiers` concatenates results in order and deduplicates by tag name, so chained classifiers can safely overlap.

* [`c055f7d`](https://github.com/spencerbeggs/vitest-agent/commit/c055f7dcceb90a13c6ebe7c8d6058804ca715d69) ### Shape-tailored dispatcher matrix

A new dispatch layer in vitest-agent-ui routes each rendered run by a run-shape and run-outcome pair to a dedicated cell that produces both an agent-oriented string and an Ink-tree variant.

Cells cover the single-test, single-file, single-project, and workspace shapes, crossed with the all-pass, some-fail, and threshold-violation outcomes.

Run shape and outcome are computed by classifier helpers exported alongside the dispatcher table and the dominant-classification helper used to pick a representative outcome when multiple are present.

* [`01df6ba`](https://github.com/spencerbeggs/vitest-agent/commit/01df6ba7ce3daf0f1ffa19f0e170b0154800f936) ### Cross-package version constants

Exports CURRENT\_UI\_VERSION, a build-time string constant injected from package.json at compile time. The constant follows the same build-time injection pattern used by all six packages in the lockstep release family.

### `ResolvedReporterConfig` shape change

The `mode` field on `kit.config` is replaced by `consoleMode: ConsoleMode` — the resolved value the plugin selected for the active executor. Custom reporter factories that switched on `kit.config.mode` need to switch on `kit.config.consoleMode` instead. New `githubSummary: boolean` field on the same struct, populated from the plugin's `githubSummary` option.

### `ExecutorResolver.resolve` signature simplified

The service's `resolve(env, mode)` becomes `resolve(env)`. Executor selection no longer takes a forcing mode — that decision moved into the per-executor console matrix.

### Streaming reporter hooks + `onRunEvent` tap

`AgentReporter` now implements the Vitest streaming hooks (`onTestRunStart`, `onTestModuleQueued`, `onTestModuleStart`, `onTestCaseResult`, `onTestModuleEnd`) alongside the existing `onInit` / `onCoverage` / `onTestRunEnd` trio. Each callback constructs a typed `RunEvent` and fires the new `AgentReporterConstructorOptions.onRunEvent` tap. `onTestRunEnd` emits `RunFinished` at the top of the persistence pipeline so live subscribers see end-of-run before persistence runs. Throwing taps are caught and logged to stderr — persistence never breaks because a live renderer has a bug.

`AgentPlugin` exposes the same tap via its `onRunEvent` option. The plugin forwards events only when the resolved `consoleMode === "ink"`; other modes suppress the tap so a live Ink mount cannot leak into channels the user explicitly opted out of.

### `vitest-agent show` CLI command

A new read-only command renders the latest cached run for a project through the shared event-sourced renderer:

```bash
vitest-agent show --project my-pkg --format auto|agent|human|json [--width 80]
```

`auto` picks `human` (Ink `renderToString`) when stdout is a TTY and `agent` (markdown final frame) otherwise. The implementation routes through `DataReader.getLatestRun` → `synthesizeFromAgentReport` → `renderRun`, sharing every byte of formatting code with the plugin's reporter path.

### `RunEvent` and `RenderState` Effect Schemas in the SDK

`packages/sdk/src/schemas/RunEvent.ts` defines an 11-variant discriminated union covering run lifecycle (`RunStarted`, `RunFinished`), per-module events (`ModuleQueued`, `ModuleStarted`, `ModuleFinished`), per-test events (`TestStarted`, `TestFinished`), coverage events (`CoverageReady`, `ThresholdViolation`), and analysis events (`FailureClassified`, `SuggestedAction`). `packages/sdk/src/schemas/RenderState.ts` defines the denormalized projection the reducer produces and both renderers consume. Both schemas are exported from the SDK root and consumed by `vitest-agent-ui`.

### `githubSummary` option

`AgentPlugin({ githubSummary: boolean })` controls whether the plugin writes a GFM markdown step summary under GitHub Actions. Defaults to `true` when `GITHUB_ACTIONS` is detected. Independent of the `console.ci` slot so users can keep the GHA summary while changing CI stdout behavior.

### `coverageTargets` is now a typed schema

Migration: destructure the preset and route each half to its owner.

```ts
const preset = AgentPlugin.COVERAGE_LEVELS.standard;
defineConfig({
  plugins: [AgentPlugin({ coverageTargets: preset.coverageTargets })],
  test: { coverage: { thresholds: preset.thresholds } },
});
```

### `reporterOptions.autoUpdate` removed; Vitest owns the ratchet

The plugin no longer mutates Vitest's `coverage.thresholds.autoUpdate`. The new `AgentPlugin.COVERAGE_AUTOUPDATE` namespace exposes three tolerance functions (`standard` floors, `strict` ceils, `lenient` floors minus two clamped to zero) that pass directly into Vitest's native `coverage.thresholds.autoUpdate` field — no type augmentation, no sibling option.

### Two operating modes gated by Vitest's `coverage.enabled`

`coverage.enabled: false` puts the plugin in UI-only mode: `AgentReporter.onTestRunEnd` short-circuits before persistence (no DataStore writes, no CoverageAnalyzer, no HistoryTracker resolution) while still building reports purely, resolving the renderer kit, calling the user-supplied reporter factory, and routing output. The streaming taps that drive a live renderer fire identically in both modes. Full mode (the default) runs the existing persistence pipeline unchanged.

### `ResolvedReporterConfig.coverageMode` is new and required

The reporter contract surface adds a `coverageMode: "full" | "ui-only"` field on `ResolvedReporterConfig`. Custom `VitestAgentReporterFactory` implementations can branch on this when their rendering depends on whether persistence is on. The plugin resolves the value from `vitest.config.coverage?.enabled` once during `configureVitest`.

### `validateCoverageTargetsShape` helper

A pure helper in `vitest-agent-sdk` returns structured `{ errors, warnings, info }` diagnostics for a `CoverageTargets` input. Rule layer consumers reuse it for the `INVALID_TARGET_VALUE` and `PERFILE_ON_TARGETS` cases.

### `CoverageLevelPreset` public type

The dual-output preset shape is exported from `vitest-agent-plugin` so user code that builds custom presets can satisfy the contract explicitly.

### Optional peer dependencies

`@vitest/coverage-v8` and `@vitest/coverage-istanbul` are declared as optional peer dependencies on `vitest-agent-plugin`. The `MISSING_PROVIDER_PACKAGE` rule surfaces the install command when the configured provider is not available.

`AgentPluginConstructorOptions.tagStrategy` is renamed to `discoverStrategy`. The Vite transform that injects `test.tags` now consumes a `DiscoverStrategy.classify` rather than a `TagStrategy.classify`; `false` still disables the transform entirely.

### AgentPlugin.discover() returns a thenable builder

`AgentPlugin.discover()` no longer returns a `Promise` directly — it returns a `DiscoverBuilder` that implements `PromiseLike` and exposes `.addProject({ name, path })`. Each `.addProject()` call returns a new builder. Awaiting resolves the merged workspace-plus-added entries through the active strategy. Resolution throws when an added entry's `buildProject` returns null, when an added entry collides on name with a workspace package, or when an added entry's resolved absolute path collides with a workspace package.

```ts
export default async () => {
  const { projects, tags } = await AgentPlugin.discover().addProject({
    name: "integration",
    path: "./test-only",
  });

  return defineConfig({
    plugins: [AgentPlugin()],
    test: { ...(projects ? { projects } : {}), tags },
  });
};
```

### discoverProjects output type changes

The internal `discoverProjects` helper now returns `{ projects: TestProjectInlineConfiguration[] | undefined; tags }` rather than `{ projects: VitestProject[]; tags }`. The `projects` field is undefined when no workspace package and no added entry produced a config, so users can spread the result into Vitest's config without conditional logic. The legacy `DiscoveryOptions` callback shape is gone — users extend the strategy or destructure-and-mutate the result before spreading.

### Three pre-2.0 special-case discovery skips are removed

The hard-coded `relativePath === "."`, `!isDir(srcDir)`, and helper-subdir filtering rules are replaced with a single `strategy.buildProject(input)` predicate. Single-package repos and test-only packages — previously silently unsupported — now work via the default strategy. Repos that depended on the implicit root-package skip should declare a custom strategy that returns null for the root, or rely on the default strategy's "no test files = no project" behavior.

### findTestFiles public utility

A new `findTestFiles(path, patterns)` async helper walks the filesystem for test files matching a list of glob patterns. Used internally by `DefaultDiscoverStrategy.buildProject` and exposed publicly so custom strategies can reuse the walker without re-implementing it. Skips `node_modules`, `.git`, and `dist` directories by default; returns absolute paths.

### DefaultDiscoverStrategy exposed by name

Users can subclass or instantiate the default strategy explicitly with `new DefaultDiscoverStrategy()`. The default classifier remains filename-suffix only (`.e2e.` → `["e2e"]`, `.int.` → `["int"]`, otherwise `["unit"]`); the default tag set keeps the same timeouts (`int` 60 seconds; `e2e` 120 seconds with retry 2 under CI).

A throwing user tap is caught and logged to stderr so a buggy live subscriber no longer breaks persistence. The plugin also adds vitest-agent-ui as a workspace dependency so consumers do not install the UI package directly.

### vitest-agent-cli show command renders one aggregate frame

The show subcommand now emits a single workspace-aggregate frame for multi-project runs instead of one frame per project. The formatter behind it is now async.

### L1 MCP tool-pointer footer

Every dispatched render appends a footer that points at the MCP tool best suited to the agent's next action.

All-pass runs with a coverage gap surface the per-file coverage tool. Some-fail runs surface the test-errors tool together with the failure-signature lookup tool when the failure is classified as new or persistent, or the failure-signature lookup tool alone when the failure is flaky.

The SDK re-exports these from its root so plugin, reporter, UI, and CLI all read the same definitions.

### Per-report convenience helpers

Two new helpers on vitest-agent-ui let one-shot consumers render a single agent report into either an agent-oriented string or a human-oriented string without standing up a full reporter kit. CLI replay paths and custom dashboards use these instead of constructing a transient kit.

### Simpler vitest config

The canonical vitest config no longer imports the event-sourced reporter factory or the live Ink factory. Users wire the plugin with the console matrix and the coverage targets, and the plugin handles the reporter and the live mount internally.

### Patch Changes

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| vitest-agent-sdk | dependency | updated | 1.3.1 | 2.0.0 |
