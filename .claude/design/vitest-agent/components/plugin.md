---
status: current
module: vitest-agent
category: architecture
created: 2026-05-06
updated: 2026-09-04
last-synced: 2026-09-04
completeness: 93
related:
  - ../architecture.md
  - ../components.md
  - ../decisions.md
  - ../schemas.md
  - ./sdk.md
  - ./reporter.md
  - ./ui.md
dependencies: []
---

# Plugin package (`@vitest-agent/plugin`)

The plugin package owns everything Vitest-API-aware: the Vitest plugin, the
internal `AgentReporter` lifecycle class, the istanbul-aware
`CoverageAnalyzer`, and the reporter-side utilities that bridge the plugin to
a user-supplied `VitestAgentReporterFactory`.

**npm name:** `@vitest-agent/plugin`
**Location:** `packages/plugin/`
**Internal dependencies:** `@vitest-agent/sdk`, `@vitest-agent/reporter`, `@vitest-agent/cli`, `@vitest-agent/mcp`
**Required peers:** `vitest >= 4.1.0`, `@vitest/runner`, `@vitest/coverage-v8`, `@vitest/coverage-istanbul`

`@vitest-agent/cli` and `@vitest-agent/mcp` are regular workspace `dependencies` (`workspace:*`) in source and publish as exact-pinned regular `dependencies` — the earlier `savvy.build.ts` transform that promoted them into `peerDependencies` for the published manifest was removed. The plugin imports no code from either; they are declared so the `vitest-agent` and `vitest-agent-mcp` bins the Claude Code plugin's hook scripts shell out to are installed. Their bins resolve because `@savvy-web/pnpm-plugin-silk` publicly hoists both packages; the peer form was actively harmful — pnpm's `autoInstallPeers` resolution of the cli/mcp peers forced wrong Effect versions into consuming repos. See D33 in [../decisions.md](../decisions.md).

The plugin owns persistence, classification, baselines, trends, and Vitest
lifecycle wiring. Rendering is delegated entirely to the reporter factory —
the plugin owns no Ink mount and no rendering code. The plugin has no direct
`@vitest-agent/ui` dependency: it imports `DefaultVitestAgentReporter` from
`@vitest-agent/reporter` and nothing from `ui`. It carries no `react` or
`ink` — JSX lives only in `@vitest-agent/reporter`. The `VitestAgentReporter`
contract types live in [./sdk.md](./sdk.md)
(`packages/sdk/src/contracts/reporter.ts`).

For decisions that shaped this design, see [../decisions.md](../decisions.md):
D40 (five-field options surface), D34 (plugin/reporter split), D28
(process-level migration coordination), D31 (XDG-derived data path), D10
(failure signatures).

---

## AgentPlugin

`packages/plugin/src/plugin.ts`. The Vitest plugin entry point. Hooks into
Vitest's `configureVitest`, detects the environment, parses coverage
thresholds and targets, picks the user's `VitestAgentReporterFactory`
(defaulting to `DefaultVitestAgentReporter` from `@vitest-agent/reporter`),
then constructs an `AgentReporter` per project and pushes it onto
`vitest.config.reporters`. The default reporter lives in
`@vitest-agent/reporter`; the plugin imports it as a workspace dependency
and does not touch `@vitest-agent/ui` directly.

**The user-facing options shape.** `AgentPluginOptions` is exactly
five fields — see [./sdk.md](./sdk.md) for the schema and
[../decisions.md](../decisions.md) D40 for the rationale.

| Field | Source of truth | Notes |
| ----- | --------------- | ----- |
| `console` | `AgentPluginOptions` (schema) | Per-executor `ConsoleOutputs` matrix |
| `coverageTargets` | `AgentPluginOptions` (schema) | Typed `CoverageTargets` schema with positive-numbers-only validation |
| `transport` | `AgentPluginOptions` (schema) | Single-member `{ kind: "local" }` union; 2.x default |
| `reporter` | `AgentPluginConstructorOptions` (companion interface) | `VitestAgentReporterFactory`; function-typed, lives outside the schema |
| `onRunEvent` | `AgentPluginConstructorOptions` (companion interface) | Tee-out hook for the live `RunEvent` stream |

Plus `discoverStrategy` on the companion interface for the transform-hook
override. Everything that is really a plugin-internal resolved fact stays
out of the user surface — see the **Resolved internally** section below.

**Cache directory resolution.** Resolved entirely through the XDG path
stack in `packages/sdk/src/utils/resolve-data-path.ts` — programmatic
`cacheDir` option, then `vitest-agent.config.toml`'s `cacheDir`, then its
`projectKey`, then the workspace `package.json#name`. The plugin no
longer reads `outputFile['vitest-agent']` and there is no Vite-cacheDir
fallback. See [../file-structure.md](../file-structure.md) for the
resolver precedence.

**Per-project isolation.** In multi-project Vitest configs, the plugin
constructs one `AgentReporter` per project via `projectFilter`. Each reporter
filters `testModules` to its own project before persistence and rendering.
Coverage dedup runs by alphabetical project ordering: only the first project
processes the global `CoverageMap`, others skip to avoid double-counting.

**Console matrix → `ConsoleMode` resolution.** The plugin reads
`options.console.{human,agent,ci}` (the per-executor matrix from
`AgentPluginOptions`), looks up the slot matching the detected executor,
and resolves a single `ConsoleMode` value. Per-slot defaults: `human →
passthrough`, `agent → agent`, `ci → passthrough`. The pre-2.0 `mode` and
`strategy` design is superseded — see [../decisions-retired.md](../decisions-retired.md)
for the retired single-flag form.

**`VITEST_AGENT_CONSOLE` override and its rejection warning.** A
non-empty `VITEST_AGENT_CONSOLE` wins over the configured slot, but only
when the value is legal *for the detected executor* — the three slots
accept three different literal unions (`HumanConsoleMode`,
`AgentConsoleMode`, `CiConsoleMode`), so a value that is valid for one
executor is genuinely invalid for another. An illegal value is ignored
with a stderr warning that now appends the accepted values for that
executor, introspected from the SDK schema's `.literals` rather than
hand-listed (issue #233). Hand-listing was the whole problem: the prior
warning named only the rejected value, leaving the user to guess which
of three per-executor unions applied and what was in it, and any
hard-coded list would drift from the schema on the next mode addition.
The three `Schema.is` guards stay separate rather than collapsing into a
ternary-produced union — that form confuses tsgo on annotations-method
contravariance.

**Console-reporter stripping.** Whenever the resolved `consoleMode` owns
stdout (any value other than `passthrough`), the plugin strips Vitest's
built-in console reporters (`default`, `verbose`, `tree`, `dot`, `tap`,
`tap-flat`, `hanging-process`, `agent`) from the chain and zeroes
`coverage.reporter` to suppress Vitest's native coverage text table.
Custom reporters and non-console built-ins (`json`, `junit`, `html`,
`blob`, `github-actions`) are preserved.

**`onRunEvent` is a stream tee, not a gating switch.** The plugin
accepts an optional `onRunEvent: (event: RunEvent) => void` callback. It
is independent of the internal run-event channel: `AgentReporter.emit`
does `Effect.runSync(PubSub.publish(runEvents, event))` to feed the
reporter, then calls the user `onRunEvent` tap. The tap is a read-only
tee for custom dashboards, log forwarders or analytics sinks, fired for
**every** `consoleMode`. Throwing user callbacks are caught and logged
to stderr by `emit` so a buggy tap never breaks persistence or the
reporter. Tests live in `packages/plugin/__test__/plugin.test.ts` under
"tap forwards for every mode" and "throwing user callback caught".

**Resolved internally (no longer user-facing).** The plugin auto-derives
two flags from the detected environment and the resolved console mode
rather than taking them as options.

- `mcp` is `true` when `executor === "agent"` and `false` otherwise. The
  agent slot is the only one that owns the MCP attribution path, so a
  separate option would have been a second way to spell the same fact.
- `githubActions` is `env === "ci-github" && consoleMode !== "silent"`.
  Users who want to suppress the GitHub Step Summary set the `console.ci`
  slot to `"silent"`.

Both values are threaded onto `ResolvedReporterConfig` so custom
reporters still see them. Other former-user-options (`format`,
`consoleOutput`, `detail`, `coverageConsoleLimit`, `omitPassingTests`,
`includeBareZero`, `githubSummary`, `githubSummaryFile`) are resolved
inside `buildReporterKit` as kit-internal constants or env-derived
values and surface on the same `ResolvedReporterConfig` for custom
reporters that branch on them. `cacheDir` resolves via the XDG path
stack; `logLevel` and `logFile` resolve from the
`VITEST_REPORTER_LOG_LEVEL` and `VITEST_REPORTER_LOG_FILE` env vars via
`resolveLogLevel` / `resolveLogFile` in the SDK.

**Version constant (no runtime drift check).** The plugin re-exports the public version constant `CURRENT_PLUGIN_VERSION` (sourced from `process.env.__PACKAGE_VERSION__` via rslib-builder's `define` substitution). Under the earlier lockstep design the `AgentPlugin()` factory compared this against `CURRENT_SDK_VERSION` and `CURRENT_REPORTER_VERSION` and warned on drift; that check (and its `_hasWarnedDrift` guard, `_resetVersionDriftGuardForTests` hook, and `version-drift.test.ts` suite) was removed when the packages moved to independent versioning, so the constant is now public API with no internal consumer. See D36 in [../decisions.md](../decisions.md).

## AgentReporter (internal Vitest-API class)

`packages/plugin/src/reporter.ts`. Internal lifecycle class — constructed by
`AgentPlugin`, never exported as a public API.

The class's job is the persistence pipeline plus the live event stream;
all rendering is delegated to the configured `VitestAgentReporterFactory`.

**The run-event channel.** The `AgentReporter` constructor creates an
unbounded Effect `PubSub<RunEvent>` (`Effect.runSync(PubSub.unbounded())`).
That channel is threaded onto `ReporterKit.runEvents` (an optional field
on the kit — see [./sdk.md](./sdk.md)) and is the transport by which a
live-painting reporter receives run events. Live-rendering orchestration
lives in the reporter, so the plugin's job here is to publish events onto
the channel and hand the channel to the factory — it owns no Ink mount.

**Lifecycle hooks:**

- `onInit` resolves `dbPath` (as before — the `cacheDir` short-circuit
  still applies), then calls `initReporters()`. `initReporters` resolves
  a run-start `ReporterKit` (neutral run health — `hasFailures: false`)
  and invokes `opts.reporter(kit)` **at run start** so a live-painting
  reporter can subscribe to `kit.runEvents` before the first event. The
  resolved reporters are stashed on the instance for reuse by
  `onTestRunEnd`. If `initReporters` throws, it logs to stderr and the
  factory is retried at run end.
- `onCoverage` stashes coverage data; fires before `onTestRunEnd`.
- `onTestRunEnd` is the load-bearing hook for persistence and end-of-run
  rendering. See below.

**Streaming hooks (event emission).** `AgentReporter` wires **every**
Vitest 4.x reporter hook to an emitted `RunEvent`, so the internal event
surface is complete — future consumers never have to widen the plugin's
Vitest-API layer. Each callback constructs the matching `RunEvent`
variant and calls `emit(event)`, which publishes onto the run-event
`PubSub` and calls the user-supplied `onRunEvent` tap. The variant
inventory and the deliberately-unmapped hooks (`onInit`,
`onBrowserInit`, `onServerRestart`, `onTestRemoved`) live in
[../schemas.md](../schemas.md).

Two emit details are load-bearing:

- **`TestStarted` emit point.** `onTestCaseReady` is wired to emit a
  standalone `TestStarted`; `onTestCaseResult` emits only `TestFinished`,
  so the transient running state gets its own render frame.
- **Coverage events.** `CoverageReady` and one `ThresholdViolation`
  per violated metric are emitted from `onTestRunEnd` after the
  `CoverageAnalyzer` finishes, populated from the analyzed result. The
  raw `onCoverage` istanbul map cannot fill those payloads, so the
  events fire once the analyzed coverage is ready. On a partial run
  `CoverageReady` also carries `scoped: true`, `scopedFiles` (count) and
  `totalFiles`, and **no** `ThresholdViolation` is emitted at all — see
  *Partial-run detection and threshold suppression* below (issue #160).

The three module-event variants (`ModuleQueued`, `ModuleStarted`,
`ModuleFinished`) are populated with the optional `projectName` from the
Vitest `TestModule.project.name` in hand.

**Timeout detection.** Vitest reports a timed-out test as `failed` with
a timeout-flavored error. `isTimeoutError` in
`packages/plugin/src/utils/detect-timeout.ts` is a pure matcher that
detects those failures; the reporter runs it per failed test and sets
the optional `timedOut: boolean` on the emitted `TestFinished` so the
`@vitest-agent/ui` reducer can route the test into `timeoutCount`. The
distinction is render-layer only — see [../schemas.md](../schemas.md).

**Per-module tag counts.** `onTestModuleEnd` tallies a per-tag test count from `TestReport.tags` and sets it as the optional `tagCounts` field on the `ModuleFinished` `RunEvent`, which `StreamApp` renders as fixed-width tag-count columns on aggregate rows (see [./ui.md](./ui.md)).

**`TrendComputed` emit.** `onTestRunEnd` emits a `TrendComputed`
`RunEvent` after trend computation — mirroring the `CoverageReady` emit
after the coverage analyzer — carrying trend direction and run count, so
a live-painting reporter sees trend without reading the database.

`onTestRunEnd` also emits `RunFinished` at the top of its handler so a
subscribed reporter sees end-of-run before the heavy persistence work
runs. That live emit carries `collectedModules: testModules.length` — the
count of every collected module, passing ones included — matching what both
`@vitest-agent/ui` synthesizers put on their own `RunFinished`. Without it
the live path was the one route where the reducer could not tell "no
modules" from "no failing modules" (see [./ui.md](./ui.md)). A `wantsRunEvents()` gate (true when `onRunEvent` is set, when
`consoleMode === "stream"`, or when a custom reporter is in use) skips
event construction when nothing will consume the stream. The `emit` helper
catches throwing user callbacks and logs to stderr — persistence and the
reporter never break because a tap has a bug.

**`onTestRunEnd` flow (Full mode).** The handler is split into two
programs — a **persist** program that needs SQLite and a **render** program
that does not — so a persistence failure can never swallow the run's
output. See *Render survives persistence failure* below and Decision 47 in
[../decisions.md](../decisions.md).

1. Resolve `dbPath` via `ensureDbPath()` (defensive — `onInit` normally
   did it already), then filter `testModules` by `projectFilter` and group
   by project name. A rejection here — an unreadable cache dir, an
   unresolvable workspace identity — leaves `dbPath` undefined and records
   a `persistDisabled` reason instead of returning: the render program is
   DB-free, so the run still reports its results. The defensive
   `mkdirSync(dirname(dbPath))` a few lines later is guarded the same way.
   `onInit`'s own `ensureDbPath()` is likewise best-effort (Vitest awaits
   `onInit`, so a rejection there would abort the run before any test ran).
2. **Build fallback reports up front**, outside any Effect: the same
   per-project grouping the persist program uses, run through
   `buildAgentReport` with no DB read and no classifier. The whole build is
   wrapped in a `try` — `buildAgentReport` walks duck-typed Vitest getters
   (`state()`, `errors()`) bare, so a throwing getter degrades to a
   `formatFatalError` line on stderr and an early return rather than an
   unhandled rejection with no output at all.
3. `await ensureMigrated(dbPath)` to serialize migration across reporter
   instances sharing a `dbPath`. See [./sdk.md](./sdk.md) for why this
   coordination is required. A rejection here no longer returns early — it
   records a `persistDisabled` reason and skips straight to the render
   program.
4. **Persist program** (`DataStore | DataReader | CoverageAnalyzer |
   HistoryTracker`, provided by `ReporterLive(dbPath)`): persist Vitest
   settings + env vars via `DataStore.writeSettings()`; per project build
   the `AgentReport`, classify outcomes via `HistoryTracker`, run each
   error through `processFailure` (source-mapping the top non-framework
   frame, finding the function boundary, computing the stable failure
   signature), upsert `failure_signatures`, then persist runs, modules,
   suites, test cases, errors, coverage, history, and source-map entries.
   First project (alphabetically) processes global coverage; others skip.
   Before the program runs, the handler decides `isPartial` (see
   *Partial-run detection and threshold suppression* below) — a partial run
   routes coverage through `CoverageAnalyzer.processScoped` with the
   convention-derived tested source files and `totalFiles`, is persisted
   with `test_runs.scoped = 1`, and emits no `ThresholdViolation`.
   Compute updated baselines, write trends on full (non-scoped) runs, and
   — also full runs only — persist the resolved `coverage.thresholds` via
   `DataStore.writeThresholds` and the `coverageTargets` via
   `DataStore.writeTargets` whenever each is configured, independent of
   `autoUpdate` (issue #237). Read trend summaries back and aggregate the
   flat `classifications` index. The program returns
   `{ reports, classifications, trendSummary? }` — the `PersistResult` the
   render program consumes.
5. **Render program** (`OutputPipelineLive` + `NodeServices.layer`, no
   SQLite — the same DB-free wiring the UI-only branch uses). It resolves
   env / executor / format / detail, builds a second, health-aware
   `ReporterKit` via `buildReporterKit` (carrying post-run `detail` and the
   same `runEvents` channel), reuses the reporters resolved at run start by
   `initReporters` — resolving the factory here only when `onInit` did not
   run — calls each reporter's `render(input, kit)`, concatenates the
   `RenderedOutput[]`, then routes each entry via `routeRenderedOutput`.
   The factory is invoked at most once; `render` receives the run-end kit
   while the factory received the run-start kit.

**Render survives persistence failure.** The render program always runs.
Its input is the persist program's `PersistResult` when persistence
succeeded, and otherwise a `PersistResult` synthesized from the fallback
reports with an empty `classifications` map and no `trendSummary` — the
results still render, just without history-derived classification or trend.
After rendering, a failed or disabled persist phase writes one line to
stderr:

```text
vitest-agent: persistence failed — results above were rendered but NOT recorded: <reason>
```

Both failure sources funnel into that line: `persistDisabled` (`dbPath`
resolution, the defensive `mkdirSync`, or the migration rejected) and
`persistFailure` (the persist program itself rejected). The pre-split
behavior — return early, print nothing but the migration error, render
nothing — was the worst possible outcome for an agent, which then had no
run result at all.

**The remaining no-render exits** are three, and none of them is a
persistence failure: the `this.rendered` idempotence guard (a second
`onTestRunEnd` for the same run), the empty-`filteredModules` guard under
a `projectFilter` (this reporter instance owns no modules in this run),
and a throw from the guarded fallback build itself — at which point there
is no renderable data left to protect.

**Per-project run outcome.** The `reason` Vitest hands `onTestRunEnd` is
the whole-process outcome. Writing it verbatim to every project's
`test_runs` row marked all thirteen projects `failed` when one failed
(issue #147). `writeRun` now derives a per-project reason from that
project's own report: `interrupted` passes through globally (a killed run
is killed for everyone), otherwise `failed` when the project's
`summary.failed > 0 || failedFiles.length > 0` and `passed` otherwise.
This diverges deliberately from `baseReport.reason`, which
`buildAgentReport` self-corrects to `failed` on unhandled errors alone —
the persisted per-project reason only ever looks at that project's own
failed tests and files.

The health-aware kit's `hasFailures` keys off
`report.failedFiles.length > 0 || report.unhandledErrors.length > 0`, NOT
`summary.failed` — so a module that failed to *collect / load* (which
produces zero failing test cases) still marks the run red. This is the
plugin-side half of the false-green fix; `summary` stays a pure test-case
count and the suite-level failure is folded in at the render/health seam.
See Decision 45 in [../decisions.md](../decisions.md).

**Error-text coercion at the persistence boundary.** Every value the
reporter pulls off a Vitest error before handing it to `DataStore` goes
through the SDK's `coerceErrorField` — the three `TestErrorInput` push
sites (test-scope, module-scope, unhandled-scope) and the `errorMap`
lookup that feeds classification. `coerceErrorField(e, "message")` rather
than `coerceErrorText(e.message)` because the property access itself is
the hazard: a live getter (Effect's `ConfigError.message`) throws before
the value ever reaches a coercion helper. For the same reason the raw
error is no longer spread into `processFailure` — `{ ...e }` invokes every
enumerable getter — so the reporter builds an explicit object of
already-coerced `message` / `name` / `stack` plus a `stacks` array read
through the local `readErrorStacks` guard (frames are dropped, never
thrown). The coerced `message` (with `"<missing message>"` as the not-null
sentinel) and `stack` are what `processFailure` sees, so signature
computation never runs against a non-string. Rationale and the failure
shapes this defends against live in [./sdk.md](./sdk.md).

Each lifecycle hook builds a scoped Effect and runs it with
`Effect.runPromise`. The persist program is provided
`ReporterLive(dbPath)`; the render program is provided
`OutputPipelineLive` merged with `NodeServices.layer`, and touches no
SQLite service.

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

`CoverageOptions` carries an optional `totalFiles` (issue #160): only
meaningful on a `processScoped` call, it is threaded verbatim onto
`CoverageReport.totalFiles` (alongside `scoped: true` and `scopedFiles`)
so the scoped-coverage note can render "N of M test files". The analyzer
cannot derive it — only the reporter has the project-wide spec count.

## DiscoverStrategy + DefaultDiscoverStrategy

`packages/plugin/src/utils/discover-strategy.ts`. The single extension
point for project detection and tag classification — one contract owns
both concerns.

A `DiscoverStrategy` carries a readonly `Tag` list, exposes a
`tagDefinitions` getter (the shape that flows into `test.tags`), an
async `buildProject(input)` method that returns either a
`TestProjectInlineConfiguration` or `null` (null means "skip this
package"), a synchronous `classify({ module })` method that returns the
tag list per test file, and an `extend` method that produces a new
immutable strategy with optional `additionalTags`, an inheriting
`buildProject`, and an inheriting `classify` layered on top.

Construct a base strategy with `DiscoverStrategy.create({ tags,
buildProject, classify })`. Chain `.extend({ additionalTags?,
buildProject?, classify? })` to layer behavior on top — extension
classifiers see the inherited tag list via the `inherited` argument;
extension `buildProject` implementations receive the prior layer's
result as a second argument so they can augment or replace it.

`DefaultDiscoverStrategy` is the strategy applied when no override is
passed. Its `buildProject` makes a single `findTestFiles` walk against both
patterns — `src/**/*.{test,spec}.*` and `__test__/**/*.{test,spec}.*` —
and returns null when neither bucket has matches; a single predicate covers
what would otherwise be several special cases (root package skip, missing
`src/` skip, no-test-files placeholder). Its `classify` is the
filename-suffix match (`.e2e.test.ts` to e2e, `.int.test.ts` to int,
otherwise unit).

Bucketing is "under `src/` or not": a test file is discoverable only at
`<workspace>/src/**` or `<workspace>/__test__/**`, anchored at the package
root, and nowhere else. A `__test__/` directory nested anywhere else in the
tree — `lib/scripts/__test__/`, for example — is never included; the emitted
include globs are absolute and package-anchored (`<path>/src/**/...` and/or
`<path>/__test__/**/...`), not the unanchored `**/__test__/**` that shipped
in 2.1.0. That unanchored form is what caused issue #227: Vitest globs a
pattern literally with no nested-`package.json` concept, so for the root
workspace — which `@effected/workspaces` reports at the repo root — the
pattern globbed the entire repository and collected foreign test suites
against the wrong toolchain. It had been widened to reach the path reported
in issue #184, which turned out to be an invalid report (see
[../decisions-retired.md](../decisions-retired.md)). The rule now lives in
one place, `classifyTestPath` in `@vitest-agent/sdk`'s
`utils/test-location.ts`, and these globs are generated from the same
constants that back it. The unanchored `**/dist/**` exclude is gone,
replaced by bounded globs: each `NON_DISCOVERABLE_DIRS` entry
(`node_modules`, `.git`, `dist`) is excluded under BOTH include roots,
`<path>/{src,__test__}/**/<dir>/**`. An anchored include already cannot
reach a package's own top-level `dist/`, but it can reach one nested deeper
(`src/foo/dist/x.test.ts`), which `configDefaults.exclude` does not cover —
so the emitted config now prunes exactly what `findTestFiles` prunes,
closing the last divergence between the walker and the glob. The
helper-subdirectory excludes (`utils`, `fixtures`, `snapshots`) are
anchored at the test root as `<path>/__test__/{fixtures,snapshots,utils}/**`
— helper-directory exclusion applies under `__test__/` only, never under
`src/`, and only to a helper directory *directly under* `__test__/`. The
earlier `<path>/__test__/**/{fixtures,snapshots,utils}/**` form matched a
helper-named segment at any depth, so a legitimate suite at
`__test__/unit/utils/foo.test.ts` — the natural mirror of `src/utils/` —
was dropped from discovery with no warning (issue #251; a real consumer
lost 5 suites / 60 cases). `classifyTestPath` carried the same any-depth
bug and was anchored in the same pass, which matters more than the glob:
an `excluded` verdict makes the `test-location` PreToolUse hook *deny*
creating the file. The exclude list is now emitted unconditionally; only the
helper-subdirectory entries are conditional on the `__test__` bucket
producing matches.

The three classifier helpers (`classifyByFilename`, `classifyByDirectory`,
`combineClassifiers`) and the standalone `findTestFiles` walker live
alongside the strategy and are publicly exported so user-defined strategies
do not have to reinvent the wheel. See [./discover.md](./discover.md) for
the full API surface.

## discoverProjects

`packages/plugin/src/utils/discover-projects.ts`. Async workspace
scanner. The signature is a single options bag: `discoverProjects({ strategy?, cwd?, additionalEntries?, fs?, syncOps? })`. The last two are injection points that both default to their `node:fs` bindings — `fs` is the `WalkerFileSystem` port the walks read through and `syncOps` is what `@effected/workspaces` resolves the root and package list through, so a whole discovery run is drivable against a virtual volume. Returns `{ projects: TestProjectInlineConfiguration[] | undefined; tags: TestTagDefinition[] }`. `projects` is `undefined` rather than an empty array when no projects were produced so Vitest treats the config as having no projects.

The unified algorithm uses a single `strategy.buildProject(input)`
predicate to decide whether a package contributes a project. The scanner:

1. Locates the workspace root via the bare `findWorkspaceRootSync(cwd, syncOps)` const from `@effected/workspaces` (`syncOps` defaults to `nodeSyncOps` from `@effected/workspaces/node-sync`), then enumerates packages via `getWorkspacePackagesSync(root, syncOps)`. This is the raw sync-ops form, not the arg-less `WorkspacesSync` namespace the kit docs describe.
2. Iterates every workspace package, calling `strategy.buildProject`
   with the package metadata. A null return appends nothing (but may
   warn — see below); otherwise the config is added to the result list.
3. Iterates `additionalEntries` (the entries collected by `.addProject`
   calls on the builder). Each entry is conflict-checked against the
   workspace package names and normalized paths. A null return from
   `buildProject` for an added entry throws — added entries are
   explicit user intent and a silent skip would surprise the caller.
4. Materializes `tags` as a copy of `strategy.tagDefinitions`.

**Signature-invalidated process cache.** Results are keyed by workspace root in a module-local `Map`. The cache fires only when neither `strategy` nor `additionalEntries` was supplied so a `DiscoverStrategy` instance never has to be fingerprinted. Any explicit strategy or any `.addProject` chain bypasses the cache. Each entry stores `{ result, signature }`: the signature is a cheap fingerprint of exactly two directories per package — `src/` and `__test__/` — via `computeDirSignature` / `computeWorkspaceSignature` (recursive relative-path + `mtimeMs` pairs, sorted, no file contents). Discovery cannot see a test file anywhere else, so nothing else can change the emitted project list (issue #227), and the signature only needs to cover the same two locations discovery walks. `computeDirSignature` prunes `node_modules`, `.git` and `dist` *before* recursing (`SIGNATURE_SKIP_DIRS`) rather than filtering results afterwards: Node's recursive `readdir` follows symlinked directories, and a pnpm `node_modules` tree is nothing but symlinks into the content-addressed store, so an unguarded walk from a package's `src/` or `__test__/` root — or from a fixture `node_modules` nested inside one — walks the whole store or hits a symlink cycle. On the cacheable path the signature is recomputed and compared before a cached result is returned, so a test file added/removed/moved/renamed on disk triggers a rescan rather than returning stale include-globs (issue #100 — the long-lived MCP server otherwise silently dropped tests after a test-file move). Every real scan also records an ISO timestamp under `Symbol.for("vitest-agent:discovery:last-scan-at")`, readable via the exported `getLastDiscoveryScanTimestamp()`, which `@vitest-agent/mcp` reads back to surface `discoveryLastScannedAt` on `run_tests` results without a circular import. See [./discover.md](./discover.md) and [../decisions-retired.md](../decisions-retired.md) (Decision 43's #184 extension, reversed).

**Declined test-shaped packages warn once (issue #229).** A null
`buildProject` return is silent by contract — most workspace packages
legitimately hold no tests, and warning on each would be pure noise. But
when a *declined* package still looks test-shaped, the silence hides the
"forgot the `.test.` suffix" / "wrong extension" / "`__test__/` nested
somewhere undiscoverable" mistake, and the user's tests simply never run
or persist with no signal at all. `warnIfDeclinedPackageIsTestShaped`
therefore writes one stderr line naming the package and pointing at
`vitest-agent agent check-test-path <path>` for the diagnosis.

The `isTestShapedPackage` predicate
(`packages/plugin/src/utils/is-test-shaped-package.ts`) is true when a
`__test__/` directory exists at the package root **regardless of its
contents**, or when `src/` holds at least one file matching
`TEST_FILE_GLOB_SUFFIX`. The directory counts on existence alone on
purpose: the failure mode being caught *is* a `__test__/` directory
whose files do not match the naming convention, so requiring a match
would make the predicate blind to exactly its motivating case. It reuses
`SRC_DIR` / `TEST_DIR` / `TEST_FILE_GLOB_SUFFIX` from the SDK's
`utils/test-location.ts` and the existing `findTestFiles` walker rather
than re-deriving the layout rule. The warned-set is **module-level**,
not per-call, so a package is named at most once per process no matter
how many times Vite re-invokes `configureVitest` (and therefore
discovery) across a multi-project config.

The dedup is **reservation-based**, not check-then-set: the path is
added to the warned-set *before* the async `isTestShapedPackage` probe,
not after the warning is written. Two overlapping `discoverProjects()`
calls — the long-lived MCP server re-resolving discovery while a Vitest
config load is in flight — would otherwise both clear the `has()` guard
while the first was still awaiting the probe, and both would warn. The
reservation is released again when the package turns out **not** to be
test-shaped (and on a probe throw, before rethrowing), so a package that
later grows a `__test__/` directory can still be warned about in a
subsequent run.

Users that want to mutate projects post-discovery either extend the strategy
(preferred) or destructure the result and mutate the array before
spreading it into `defineConfig`. `discoverProjects` itself is exported
from `@vitest-agent/plugin` but is internal-leaning; `AgentPlugin.discover()`
is the documented entry point.

## Tag injection transform

`packages/plugin/src/utils/inject-tags.ts` plus the `transform` hook in
`AgentPlugin()`. The plugin installs a Vite `transform(code, id)`
hook that, for every test file id:

1. Calls `strategy.classify({ module })` to resolve the tag list for
   the file (for example, `["unit"]` for foo.test.ts, `["e2e"]` for
   foo.e2e.test.ts).
2. Returns null if the tag list is empty (no rewrite).
3. Prepends one guarded two-line prelude via magic-string (source maps preserved): a namespace import of `vitest` plus a try/catch that calls `TestRunner?.getCurrentSuite?.()` (a public static since vitest 4.1, the plugin's peer floor), resolves the file task as `collector?.suite ?? collector?.file` (mirroring vitest's own parent-task resolution) and unions the classified tags into `task.tags`.

Vitest's runner unions parent tags into every suite and test it registers at collection time, so every declaration form inherits the file-level tags: native `it`/`test`, wrapper testers with a `(name, self, timeout)` signature such as `@effect/vitest`'s `it.effect`, `test.extend` aliases, numeric-timeout calls and dynamically registered tests. The previous implementation parsed each file with acorn plus acorn-typescript and rewrote every `test()`/`it()` call's options argument — that corrupted wrapper testers (the injected options object became the test body, vitest threw "Cannot use two functions as arguments" and collected zero tests — issue #133) and could never reach dynamic or numeric-timeout declarations. There is no parsing at all now; acorn and acorn-typescript were dropped from the plugin's dependencies.

Semantics under the prelude: tests declaring their own `tags` get the classification tags unioned in (the old rewrite skipped such calls), user `@module-tag` pragmas coexist and files with no statically visible test calls are still tagged. Every failure mode degrades to untagged tests, never a crash: a changed collector shape is absorbed by the try/catch; an environment whose `vitest` entry lacks the `TestRunner` export (e.g. browser mode) degrades via the namespace import plus optional chaining instead of failing module instantiation; helpers that register tests at import time evaluate before the prelude (ESM import hoisting) and miss the tags; a classified test file importing another classified test file runs the imported prelude during the importer's collection (benign tag bleed).

The classifier and the tag declarations both come from a single
`DiscoverStrategy` instance — supplied via the `discoverStrategy` plugin
option. Pass false to disable the transform entirely. `Tag` and the
classifier helpers
are exported from the package for callers that want to compose the
classification side without reimplementing project detection. See
[./discover.md](./discover.md) for the full strategy API.

## Vite source-map warning filter (`configResolved`)

Under v8 coverage, Vite core's `loadAndTransform` emits a benign `[vite] (ssr) Failed to load source map ...` / `ENOENT: ... .js.map` warning for dependencies that ship a `.js` referencing a `.js.map` sibling that was never published (canonical case: `typescript/lib/typescript.js`). This rides Vite's `environment.logger.warn`, not per-test console output, so it never reaches `task.logs` / `state.getFiles()` and the console-leak path cannot filter it (issue #110). The plugin adds a Vite `configResolved(resolvedConfig)` hook that calls `installViteSourceMapWarningFilter`, which wraps `resolvedConfig.logger.warn` in place: messages matching `isBenignViteSourceMapWarning` are dropped, everything else forwards untouched. Every per-environment logger (`client`, `ssr`, ...) delegates to the single root `logger.warn` reference, so mutating that one function intercepts all environments. The wrap lives in `configResolved` rather than a `config`-hook `customLogger` because Vite can construct or replace the logger between `config` and `configResolved` — mutating the already-resolved instance is the wiring that survives. The predicate lives in `packages/plugin/src/utils/is-benign-vite-source-map-warning.ts` and matches only the `Failed to load source map` + `ENOENT:.*\.js\.map` shape, so unrelated warnings and other-extension ENOENT errors still surface. The two backing types (`ResolvedConfigLike`, `ViteLoggerLike`) are `@internal`; the `configResolved` field uses an inline structural type so api-extractor's public surface stays clean. See [../decisions.md](../decisions.md) Decision 44.

## AgentPlugin.discover()

`packages/plugin/src/plugin.ts` (as a static method on the `AgentPlugin`
namespace). The canonical entry point for workspace-driven Vitest
project discovery. Returns a `DiscoverBuilder` — a thenable
PromiseLike that resolves to `{ projects: TestProjectInlineConfiguration[]
| undefined; tags: TestTagDefinition[] }` and exposes `.addProject({
name, path })` for non-package folders that hold tests.

**Why this is a separate static, not a `configureVitest` hook.** Vitest
pre-parses project configs before it evaluates Vite plugin hooks. A
plugin using `configureVitest` to inject projects arrives too late —
Vitest has already finished its project resolution pass. Users
therefore call `AgentPlugin.discover()` in an async config export so
discovery runs during config evaluation:

```ts
export default async () => {
  const { projects, tags } = await AgentPlugin.discover();
  return defineConfig({
    plugins: [AgentPlugin()],
    test: { ...(projects ? { projects } : {}), tags },
  });
};
```

When the workspace contains a folder that holds tests but is not itself
a workspace package, chain `.addProject({ name, path })` on the builder
— it is immutable, returning a new builder on every call so consumers
can safely fork. Conflict detection fires on `.then` resolution if an
added entry's `name` or normalized path collides with an existing
workspace package, or if its `buildProject` returns null.

The async arrow function form (rather than `defineConfig(async () => {...})`)
is recommended because it prevents TypeScript from widening string-literal
option types (e.g., `provider: "v8"` stays a string literal instead of being
widened to `string`).

**Coverage-level constants on the namespace.** Each preset returns a
dual-output `CoverageLevelPreset` shape — `{ thresholds, coverageTargets }`
— so users pass `preset.thresholds` to Vitest's native
`coverage.thresholds` and `preset.coverageTargets` to
`AgentPlugin({ coverageTargets })` from a single source of truth. The
underlying `CoverageLevel` numeric set (lines, functions, branches,
statements per preset name) is unchanged; the namespace builds a
"next preset up" mapping for the `coverageTargets` half so that
`none → basic`, `basic → standard`, `standard → strict`, `strict → full`,
and `full → full` (caps at full). The thresholds half always matches the
preset name itself.

- `AgentPlugin.COVERAGE_LEVELS` — record of the five preset names mapped
  to `CoverageLevelPreset`.
- `AgentPlugin.COVERAGE_LEVELS_PER_FILE` — same presets with `perFile: true`
  set on the `thresholds` half only. The `coverageTargets` half does not
  carry `perFile`; it inherits the flag from `coverage.thresholds.perFile`
  when the user wires the dual output through Vitest.
- `CoverageLevelPreset` is exported as a public type from
  `@vitest-agent/plugin` so user wiring can name the shape directly.

**`AgentPlugin.COVERAGE_AUTOUPDATE`.** A frozen record of three
`(n: number) => number` tolerance functions for Vitest's native
`coverage.thresholds.autoUpdate` field (Vitest's contract is
`autoUpdate?: boolean | ((newThreshold: number) => number)` — the plain
function form is supported directly, so no type-augmentation tricks are
needed). `standard` floors the suggested value; `strict` ceils it;
`lenient` floors and subtracts 2 clamped to 0 to leave a slack buffer.
Users pass one of these into Vitest's native field; the plugin does not
configure or override `autoUpdate` itself.

**Canonical 2.0 wiring pattern:**

```ts
const preset = AgentPlugin.COVERAGE_LEVELS.standard;
defineConfig({
  plugins: [AgentPlugin({ coverageTargets: preset.coverageTargets })],
  test: {
    coverage: {
      thresholds: preset.thresholds,
      // optional: thresholds.autoUpdate: AgentPlugin.COVERAGE_AUTOUPDATE.standard,
    },
  },
});
```

## AgentPlugin.runScript and its advisory lock

`AgentPlugin.runScript(command)` is the `globalSetup` helper that runs a
shell command with `stdio: "pipe"`, staying silent unless the command
fails (on failure it writes the captured stderr/stdout to their real
streams before rethrowing, so humans and CI still see it).

**The concurrency problem (issue #191, sub-item B).** Two `vitest`
invocations in one checkout — an MCP `run_tests` alongside a Bash
`vitest run`, or two MCP calls — each run the `globalSetup` build, and
the two builds race over the same `dist/` output. This is the same class
of shared-resource collision as the coverage-directory race described in
[./mcp.md](./mcp.md), but it cannot be fixed the same way: per-invocation
isolation is meaningless for a build whose whole point is a shared
output directory. Serialization is the only option. See
[../decisions.md](../decisions.md) Decision 52 (and 49 for the
coverage-directory sibling).

`packages/plugin/src/utils/run-script-lock.ts` implements a file-based
advisory lock over three moving parts:

- **Exclusive create.** `openSync(lockPath, "wx")` is the atomic
  acquire; `EEXIST` means someone else holds it. The lock lives under
  `resolveRunScriptLockDir()` — `$XDG_DATA_HOME/vitest-agent/runscript-locks`,
  falling back to `~/.local/share`, matching the `data.db` resolution
  convention — keyed by a truncated SHA-256 of `(cwd, command)` so
  different `globalSetup` commands in one checkout don't share a lock
  while repeat invocations of the same command do.
- **Done marker + freshness window.** The winner writes a `.done` marker
  on success. A waiter that sees a marker younger than
  `builtRecentlyMs` (30s) returns `recentlyBuilt: true` and
  `runScript` **skips its own run entirely** rather than rebuilding what
  a concurrent process just built. The marker check runs at the top of
  every poll iteration, not only on the `EEXIST` branch: the winner
  removes its lock file *after* writing the marker, so a waiter landing
  in that gap would otherwise see a free lock, acquire it, and re-run
  the command — defeating the marker.
- **Two-tier stale takeover — liveness first, age second.** A lock left
  behind by a process killed mid-build would otherwise hang every future
  `vitest` invocation forever, so takeover has to exist; but age alone is
  not evidence of abandonment, because the lock file's mtime is never
  refreshed during a build and a long-but-healthy build therefore looks
  identical to a dead one. The lock file records the owner's pid, and
  once the lock is older than `staleMs` that pid is probed with
  `process.kill(pid, 0)`. A live owner keeps its lock however old it is;
  `EPERM` counts as **alive** (the process exists, it just belongs to
  another user) and is emphatically not ours to take. Only a dead owner
  (`ESRCH`), or a lock file whose owner record is missing or corrupt —
  observed mid-write, truncated, hand-edited, in which case age is all
  there is to go on — is taken over.
- **Release is ownership-gated by a nonce.** `acquireRunScriptLock`
  stamps a random per-acquisition token (`ownerNonce`, 12 random bytes
  hex) into the lock file, returned on the `RunScriptLock` and `null`
  when this call did not acquire. `releaseRunScriptLock` re-reads the
  file and deletes it only while the nonce on disk still matches. Without
  that gate, an owner that had already lost its lock to a takeover would
  delete the *takeover* owner's lock in its `finally`, admitting a third
  process while the second was still building — the release path
  re-creating the very race the lock exists to prevent.
- **Init-failure cleanup.** The `wx` create and the owner-record write
  are separate steps, so a throw between them leaves a lock file nobody
  holds; every later caller would then stall until stale recovery or its
  own wait timeout. The write is wrapped so a failure removes the file it
  just created before rethrowing, and the descriptor is closed in a
  `finally` on both paths.
- **The wait timeout is an escape valve, not serialization giving up
  quietly.** A waiter blocked past `waitTimeoutMs` (10m) on a still-live
  lock returns `{ acquired: false, recentlyBuilt: false }` and
  `AgentPlugin.runScript` runs its command **unserialized**. That
  reproduces the original race for that one pair of processes and is
  documented as deliberate: a slow-yet-successful duplicate build is a
  far better failure mode than hanging a caller's test run forever.

`DEFAULT_LOCK_STALE_MS` is **60s**, down from the original 5 minutes. The
shortening is safe precisely because it is no longer load-bearing for
correctness: with the pid probe in front of it, age only decides the
unreadable-record case, and one minute comfortably covers the
`globalSetup` build steps this lock is built for. Liveness carries the
correctness; age is the fallback.

The wait is a synchronous thread block (`Atomics.wait` on a throwaway
`SharedArrayBuffer`), not an async sleep, because `runScript` is a
synchronous helper called from `globalSetup`. All four timings are
injectable as options and readable from `VITEST_AGENT_RUNSCRIPT_*` env
vars so the concurrency e2e suite can use millisecond-scale values
instead of the production-sized defaults — but those overrides are
parsed **strictly**, by the exported `parseLockTimingOverride`, not by a
bare `Number.parseInt`. `parseInt` happily accepts `"200ms"` (→ 200),
`"-1"` (→ a negative stale window, making every lock instantly stale)
and `"0"` for a poll interval (a tight spin loop). The parser requires a
whole-string run of digits, a safe integer, and a value at or above a
per-setting `minimum` — `MIN_LOCK_POLL_MS` (10) for the poll interval,
1 elsewhere — and falls back to the default for anything else. A typo in
a test's env var must degrade to the production default, never to a
broken lock. `markRunScriptDone` and `releaseRunScriptLock` are both
best-effort: a failed marker write only costs the next process its
short-circuit, and a failed release means a stale takeover cleans up
instead.

## Reporter-side utilities

`packages/plugin/src/utils/`. Pure utilities only the plugin's lifecycle
class calls. Anything used by more than one runtime package lives in the SDK
instead.

- `discover-strategy.ts` — `DiscoverStrategy` abstract class plus the
  `DefaultDiscoverStrategy` concrete subclass. Owns `ModuleInfo`,
  `DiscoverInput`, `ClassifyFn`, and `ClassifyContext`. The base
  factory `DiscoverStrategy.create({ tags, buildProject, classify })`
  returns an immutable concrete strategy whose `.extend` chains layers.
- `classify-helpers.ts` — `classifyByFilename`, `classifyByDirectory`,
  and `combineClassifiers`. Pure ClassifyFn builders for users that
  want to compose classification without writing a custom strategy.
- `find-test-files.ts` — async glob walker with an inline glob-to-regex compiler, reading through the injected `WalkerFileSystem` port (`node:fs/promises` by default). Skips
  `node_modules`, `.git`, and `dist` by default, and stops at a **nested
  `package.json` boundary**: any directory other than the walk's own root
  that declares a `package.json` is an independent unit (another workspace
  package, or a fixture package deliberately shaped like one) whose test
  files belong to a separate discovery pass. Without that stop, the
  unanchored `**/__test__/**` pattern walking from a package that
  structurally contains other packages — a monorepo root most of all —
  reaches into sibling packages and double-counts their test files across
  two projects' include globs. The boundary check runs once per directory,
  independent of which pattern is being matched, so it also applies to
  anchored patterns like `src/**/*.test.ts`. Used by
  `DefaultDiscoverStrategy.buildProject` and exported as part of the
  public surface so user strategies can reuse it.
- `walker-fs.ts` — the `WalkerFileSystem` port (`readDirectory` / `statEntry`), its `WalkerEntry` / `WalkerEntryStat` shapes, and the `nodeWalkerFs` `node:fs/promises` binding every walker defaults to. Public API: user strategies that reuse `findTestFiles` can supply their own filesystem. It exists so the discovery walks are testable against a virtual volume rather than a real temp tree — see [../decisions.md](../decisions.md) Decision 53.
- `discover-projects.ts` — `discoverProjects` workspace scanner (see
  above).
- `is-test-shaped-package.ts` — async predicate backing the declined-package warning (issue #229), reading through the same `WalkerFileSystem` port. True when a `__test__/`
  directory exists at the package root or `src/` holds a file matching
  `TEST_FILE_GLOB_SUFFIX`. See "discoverProjects" above for why the
  directory counts on existence alone.
- `run-script-lock.ts` — file-based advisory lock backing
  `AgentPlugin.runScript` (issue #191). See "AgentPlugin.runScript and
  its advisory lock" above.
- `tag.ts` — `Tag` class with `Tag.make` factory and name validation
  (rejects empty names, the reserved words and, or, not, and the
  forbidden characters open-paren, close-paren, ampersand, pipe,
  exclamation mark, asterisk plus whitespace).
- `inject-tags.ts` — `injectTags(source, tags)` prepends the guarded file-level tag prelude via magic-string (source maps preserved) and returns null only for an empty tag list. No parsing — the acorn AST rewrite was removed (issue #133). Used by the plugin's Vite transform hook; see "Tag injection transform" above.
- `stringify-failure-value.ts` — converts a Vitest error's `expected` /
  `actual` into a single-line string for the stream renderer. Like the SDK
  formatters it is exception-safe end to end: `JSON.stringify` falls back to
  `String(value)`, which falls back to `"<unserializable value>"` when the
  value's own `toString` throws.
- `strip-console-reporters.ts` — removes console reporters from Vitest's
  reporter chain.
- `is-benign-vite-source-map-warning.ts` — pure predicate `isBenignViteSourceMapWarning(message)` matching only the benign Vite `Failed to load source map` / ENOENT `.js.map` noise. Consumed by the `configResolved` logger filter (issue #110).
- `resolve-thresholds.ts` — parses Vitest-native `coverage.thresholds` into
  `ResolvedThresholds`. The plugin does not touch `autoUpdate`; Vitest owns
  the native ratchet and users opt in by passing one of
  `AgentPlugin.COVERAGE_AUTOUPDATE.{standard,strict,lenient}` into
  `coverage.thresholds.autoUpdate`.
- `is-partial-run.ts` — pure `isPartialRun({ filenamePattern,
  startedSpecCount, totalSpecCount, projectFilter }): boolean`. True when
  `filenamePattern` is a non-empty array, when fewer specs started than
  exist in total, or when a `projectFilter` was supplied. The decision
  function behind the scoped-coverage routing in `onTestRunEnd` — see
  *Partial-run detection and threshold suppression* (issue #160).
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
  no-color flag. The input shape carries only `consoleMode`, `env`, and
  the plugin-resolved derived flags; `consoleOutput`, `omitPassingTests`,
  `coverageConsoleLimit`, `includeBareZero`, `githubSummary`, and
  `githubSummaryFile` are computed inside the kit builder from
  `consoleMode` and `process.env`. `transport` is a required input. The
  optional `runEvents` `PubSub<RunEvent>` channel is
  passed straight through onto `ReporterKit.runEvents` so the reporter
  can subscribe for live painting. The pre-bound `stdOsc8` is enabled
  when `!noColor && (env === "terminal" || env === "agent-shell")` and
  is a no-op otherwise. The builder runs twice per run — once in
  `initReporters` (run-start, neutral health) and once in `onTestRunEnd`
  (run-end, health-aware) — so the factory and `render` each get the
  kit appropriate to their phase.
- `route-rendered-output.ts` — dispatches a `RenderedOutput` by its declared
  `target`. `stdout` writes to `process.stdout`; `github-summary` appends to
  the resolved `GITHUB_STEP_SUMMARY` file or user override; `file` is
  reserved (currently a no-op) pending a future convention for arbitrary
  on-disk artifacts.

## ReporterLive composition layer

`packages/plugin/src/layers/ReporterLive.ts`. Composes the live layers the
plugin's lifecycle class needs from the SDK plus the agent-local
`CoverageAnalyzerLive`. Does not pull `NodeServices` directly because
`ensureMigrated` and `resolveDataPath` provide their own platform layers
earlier in the pipeline.

## Reporter actor resolution

The reporter reads `process.env.VITEST_AGENT_AGENT_ID`,
`_PARENT_AGENT_ID`, `_CONVERSATION_ID`, `_MAIN_AGENT_ID`, and
`_SESSION_ID` at `onTestRunEnd` time and stamps every `test_runs` row
with `actor_type='agent'` plus the canonical UUIDs. The four env
exports flow in by one of three paths:

1. **Direct CC subprocess.** Claude Code auto-sources
   `${CLAUDE_ENV_FILE}` into Bash tool subprocesses; the SessionStart
   hook's exports are visible in `pnpm vitest run` invocations
   directly from the agent.
2. **MCP `run_tests`.** The MCP server mutates `process.env` from
   `SessionContextRef` before `createVitest` so the in-process
   reporter sees the active attribution.
3. **PreToolUse Bash override.** When the active actor is a
   subagent, the PreToolUse Bash hook computes an env-prefix
   override and rewrites `tool_input.command` to prepend
   `VITEST_AGENT_AGENT_ID=<subagent_id> VITEST_AGENT_PARENT_AGENT_ID=<main_id> ...`
   before Claude Code spawns the subprocess. POSIX env-prefix scope is
   the immediately-following process only.

Pass-through case: a direct `pnpm vitest run` typed by a human at a
terminal, with no Claude window open against the project, has none
of the env vars set. The reporter records `actor_type='system'` and
NULL `agent_id`. Same shape applies to CI runs.

## Per-run git + host context capture

Before each `writeRun`, the reporter calls the SDK's
`RunContext.capture` service to populate the seven `git_*` columns
(`git_branch`, `git_commit_sha`, `git_dirty`, `git_upstream`,
`git_worktree_dir`) and the three `host_*` columns
(`host_source`, `host_value`, `host_metadata`) on every `test_runs`
row. Detached-HEAD state surfaces as literal `'HEAD'` for the
branch with the SHA as the reliable identifier. `probeHostMetadata`
resolves the most specific environment probe (`TMUX_PANE`,
`WT_SESSION`, `GITHUB_RUN_ID`, etc.) and falls back to null.

These columns let `test_runs` rows attribute back to specific git
states (for "why did this regress?" forensics) and to specific
terminal windows or CI runs (for "all runs from this iTerm window"
queries via the compound `(host_source, host_value)` index). See
[../schemas.md](../schemas.md) for the column inventory.

## Coverage threshold extraction

The plugin extracts thresholds from Vitest's already-resolved coverage config
rather than re-parsing the user's input. This is load-bearing: Vitest applies
its own pattern expansion and inheritance rules, and the plugin must see the
same resolved values Vitest will enforce. `resolveThresholds` in the
reporter-side utilities does this conversion.

Vitest owns its own threshold ratchet via `coverage.thresholds.autoUpdate`.
The plugin does not mutate that field. Users who want auto-update behavior
pass a tolerance function from `AgentPlugin.COVERAGE_AUTOUPDATE` directly
into Vitest's native field; the plugin's own baseline ratchet still runs
unconditionally on full (non-scoped) runs and is independent of Vitest's
ratchet.

`coverageThresholds` is no longer a plugin option in any form — users
set Vitest's native `test.coverage.thresholds` directly. `coverageTargets`
remains a plugin option, typed by the SDK's `CoverageTargets` schema (now
in its own file at `packages/sdk/src/schemas/CoverageTargets.ts`). The
`ConfigValidation` service catches mismatches between the two surfaces.

**Thresholds and targets are persisted distinctly from the baseline
(issue #237).** At the end of the persist program `onTestRunEnd` writes the
resolved `coverage.thresholds` via `DataStore.writeThresholds` and the
`coverageTargets` via `DataStore.writeTargets` — each only when configured,
so a run with neither writes nothing. The writes are independent of the
`autoUpdate` gate (an agent asking "what bar am I held to" must be
answerable whether or not the ratchet is on) but are gated on
`!coverageReport.scoped` like the baseline and trend writes: a partial
run's totals reflect the whole project, not what ran, so recording them as
"the enforced bar" would misrepresent a value nothing in that run
re-validated. The rows land in `coverage_baselines` under
`kind = 'threshold'` / `'target'`, never colliding with the `'baseline'`
rows the ratchet writes. See Decision 58 in
[../decisions.md](../decisions.md).

## Partial-run detection and threshold suppression

Vitest enforces `coverage.thresholds` against the **whole-project**
denominator regardless of how many test files ran: its coverage provider's
`allTestsRun` flag gates only `autoUpdate`, not `checkThresholds`, and
`checkThresholds` runs unconditionally from `reportCoverage` **after every
reporter's `onTestRunEnd`** (Vitest 4.1.11, `Vitest.runFiles`). A
`vitest run foo.test.ts` therefore fails on coverage that nothing in the
run touched, and previously the plugin compounded it by persisting the run
with `scoped = false` and emitting its own `ThresholdViolation` events
(issue #160). The fix has three parts.

**Detection.** `onTestRunStart` unconditionally stores
`specifications.length` as `startedSpecCount` (outside the
`wantsRunEvents()` gate — `onTestRunEnd` needs it whether or not anything
subscribes). `onTestRunEnd` then best-effort globs the project-wide total
via `vitest.globTestSpecifications()`; a missing method (tests calling
`onTestRunEnd` directly) or a throw leaves `totalSpecCount ===
startedSpecCount`, so that channel degrades to "not partial" and never
throws. Both counts, Vitest's `filenamePattern`, and the reporter's own
`projectFilter` feed the pure `isPartialRun` (`utils/is-partial-run.ts`).
Three signals are needed because each filter surface hides from the
others: a CLI path filter sets `filenamePattern`; `--project` sets
`projectFilter`; a tags-only `run_tests` filter sets **neither** and is
caught only by the spec-count comparison.

**Routing.** When partial, the tested source files are derived by the same
`*.test.ts → *.ts` / `*.spec.ts → *.ts` convention `writeSourceMap` uses,
and coverage goes through `CoverageAnalyzer.processScoped` with
`totalFiles: totalSpecCount` so the resulting `CoverageReport` carries
`scoped: true`, `scopedFiles` and `totalFiles`. `test_runs.scoped` is
written from `isPartial` (it was hardcoded `false`). No
`ThresholdViolation` is emitted, and `CoverageReady` carries the scoped
triple so the live `stream` path renders the same note the end-of-run
render does. Baseline, trend, threshold and target writes are all skipped.

**Neutralising Vitest's native check.** Because `checkThresholds` runs
after the reporter and reads `coverageProvider.options.thresholds` in
place, the reporter deletes every metric key (`lines` / `functions` /
`branches` / `statements`) and every glob-pattern entry from that object
on a partial run, keeping only the shape-only `perFile` / `autoUpdate` keys
and Vitest's internal `100` shorthand. There is no public API for this —
`resolveOptions()` returns the object but accepts no override — so the
reach into provider internals is guarded end to end: a missing provider,
options or thresholds shape is a no-op, and the whole block is
try/caught so it can never crash the run. Nothing needs restoring
afterward because every `vitest.start` re-initialises the provider. The
rationale and the accepted risk are recorded as Decision 59 in
[../decisions.md](../decisions.md).

## ConfigValidation service

`packages/plugin/src/services/ConfigValidation.ts`, with live and test
layers under `packages/plugin/src/layers/`. Effect service tag
`vitest-agent/ConfigValidation` exposes a single method:

```ts
validate(input: ValidationInput): Effect<ValidationResult, never, never>
// ValidationInput  = { vitestConfig: ResolvedConfig; pluginOptions: AgentPluginOptions }
// ValidationResult = { errors, warnings, info }
```

`ValidationError` carries an optional `path?: string` for pinpointed
diagnostic locations (for example, `INVALID_TARGET_VALUE` rule paths like
`lines` for a top-level metric or `src/**.ts.lines` for a metric inside a
glob entry). The error and warning shapes also carry optional
`remediation?: string`; the Live layer populates it for installable-fix
cases (notably `MISSING_PROVIDER_PACKAGE`, where the remediation is the
`npm install --save-dev <package>` command).

### Operating modes

`ConfigValidationLive` resolves the mode from
`vitestConfig.coverage?.enabled`:

- `coverage.enabled === false` → **UI-only mode**. Skip provider rules
  (`UNSUPPORTED_PROVIDER`, `MISSING_PROVIDER_PACKAGE`) — there is no
  coverage pipeline to need a provider.
- anything else → **Full mode**. All seven rules run.

The mode is also threaded onto `ResolvedReporterConfig.coverageMode` from
the same source so the reporter's persistence short-circuit (see
*UI-only mode short-circuit* below) and the validation rule registry
agree on which mode is active.

### Rule registry

The Live layer ships these rules:

| Code | Severity | Mode | Description |
| ---- | -------- | ---- | ----------- |
| `TARGET_WITHOUT_THRESHOLD` | warn | both | `coverageTargets.<metric>` set, `coverage.thresholds.<metric>` unset. Suggests adding the threshold |
| `TARGET_BELOW_THRESHOLD` | error | both | `coverageTargets.<metric>` is lower than the matching `coverage.thresholds.<metric>`. Targets must be at or above the threshold floor |
| `THRESHOLD_WITHOUT_TARGET` | silent | both | Threshold set, target unset. Treated as the internal zero target — the rule emits nothing |
| `INVALID_TARGET_VALUE` | error | both | Zero or negative numeric values in `coverageTargets`. Detected at the top level and inside nested glob entries via the SDK's `validateCoverageTargetsShape` helper. Carries `path` |
| `UNSUPPORTED_PROVIDER` | error | Full | `coverage.provider` is set to a value other than `v8` or `istanbul` |
| `MISSING_PROVIDER_PACKAGE` | error | Full | `coverage.provider` references a supported package (`@vitest/coverage-v8` or `@vitest/coverage-istanbul`) that is not resolvable via `createRequire(import.meta.url).resolve(packageName)`. The `remediation` field carries the install command |
| `PERFILE_ON_TARGETS` | warn | both | The `perFile` key appears inside `coverageTargets`; users should set `coverage.thresholds.perFile` instead. Surfaced via `validateCoverageTargetsShape` |

### Test layer

`ConfigValidationTest.layer(override?: ValidationResult)` is the test
factory for unit tests that want to inject a pre-built result. Pass an
override `ValidationResult` to assert against fixed errors/warnings, or
call with no argument for a no-op success.

## ConfigValidation wired into `configureVitest`

The plugin's `configureVitest` hook calls `ConfigValidation.validate(...)`:

- Warnings and info entries print to stderr through the
  `[vitest-agent:plugin]` prefix and do not fail the build.
- Errors throw via `formatFatalError`, which surfaces the entries
  including their `path` and `remediation` fields where present.

`coverageMode` is resolved from `vitestConfig.coverage?.enabled` and threaded
through `buildReporterKit` onto `ResolvedReporterConfig`. The kit-building
path is the only writer of `coverageMode` on the resolved kit.

An `@internal` `resolvedConfig` getter on `AgentReporter` lets tests verify
mode threading. The construction-time getter uses placeholder
`executor: "ci"`; the real executor resolves in `onTestRunEnd`.

## UI-only mode short-circuit in `onTestRunEnd`

`AgentReporter.onTestRunEnd` takes an early return on the UI-only path:

1. `RunFinished` is still emitted at the top of the handler so a
   subscribed reporter sees end-of-run before the heavy work would have
   started.
2. `filteredModules` is computed (the per-project filter still applies).
3. **If `opts.coverageMode === "ui-only"`**, the reporter:
   - Builds `AgentReport[]` from `testModules` via the pure
     `buildAgentReport` helper (no DB read, no classifier).
   - Runs a tiny Effect program against `OutputPipelineLive` +
     `NodeServices.layer` to resolve env, executor, format, and detail.
   - Builds the run-end kit via `buildReporterKit` (carrying
     `coverageMode: "ui-only"` through onto `ResolvedReporterConfig`,
     plus the `runEvents` channel).
   - Calls `render(input, kit)` on the reporters and routes the
     returned `RenderedOutput[]` to their declared targets.
   - Returns. No `ensureMigrated`, no `DataStore.write*`, no
     `CoverageAnalyzer.process`, no `HistoryTracker.resolve`.
4. Otherwise the Full-mode pipeline runs end-to-end as before.

The streaming hooks that publish onto the run-event channel fire
identically in both modes — UI-only callers see the same event stream as
Full-mode callers, just without persistence side effects. The coverage
emit (`CoverageReady` / `ThresholdViolation`) also fires in UI-only mode
when a coverage map is present.

The kit-building block (env/executor/format/detail resolution, factory
call, route) is duplicated between the Full and UI-only paths; extracting
a shared helper requires making the kit-building Effect-context-agnostic.
