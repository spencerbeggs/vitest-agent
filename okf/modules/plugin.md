---
type: Module
title: "@vitest-agent/plugin"
description: "The carrier and the Vitest-API-aware half of the family: AgentPlugin, the internal AgentReporter lifecycle class, CoverageAnalyzer, ConfigValidation, and workspace discovery."
kind: package
layer: L5
resource: ../../packages/plugin
status: stable
tags:
  - architecture
  - effect
  - testing
  - dx
generated:
  by: okfit/claude-code
  at: 2026-09-14T02:24:39Z
  body_sha256: 368185c2a703b295ff1abbcf33d2c752e9438ede75e78aa266d8a36e13010ac6
---

# @vitest-agent/plugin

## Purpose

`@vitest-agent/plugin` owns everything Vitest-API-aware: the Vitest plugin
(`AgentPlugin`), the internal `AgentReporter` lifecycle class, the
istanbul-aware `CoverageAnalyzer`, the `ConfigValidation` service, workspace
discovery (`AgentPlugin.discover()`), the tag-injection Vite transform, and
the reporter-side utilities that bridge Vitest's reporter API to a
user-supplied `VitestAgentReporterFactory`. It owns persistence,
classification, baselines, and trends; rendering is delegated entirely to
the reporter factory. See [@vitest-agent/reporter](./reporter.md) for the
render half of the lifecycle this Module drives.

## Boundary

Rank 5 in the workspace's ranked layering[^layering-test] — the top of the
graph, and the family's carrier: a consumer installs only
`@vitest-agent/plugin`. See [Ranked Layering](../invariants/ranked-layering.md)
for the invariant this package sits atop and [Carrier](../glossary/carrier.md)
for what "carrier" means in this repository. Its workspace `dependencies`
are `@vitest-agent/cli`, `@vitest-agent/mcp`, `@vitest-agent/reporter`,
`@vitest-agent/engine`, and `@vitest-agent/sdk` — published exact-pinned,
never `peerDependencies` (an earlier `savvy.build.ts` transform that
promoted `cli`/`mcp` to peers was actively harmful: pnpm's
`autoInstallPeers` resolution of those peers forced wrong Effect versions
into consuming repos). The plugin's *source* imports nothing from `cli` or
`mcp`; they are declared only so the two front ends install and the plugin
re-exposes their bins. The plugin has no direct dependency on
`@vitest-agent/ui`: it imports `DefaultVitestAgentReporter` from
`@vitest-agent/reporter` and nothing else; it carries no `react` or `ink`.
Nothing may depend on the plugin except the workspace root (a
devDependency, for the dogfood `node_modules/.bin`).

**Release gate.** `@vitest-agent/engine` must publish before the plugin: a
consumer resolves `engine` only through the plugin's dependency graph, and
the packed-install e2e only passes because it overrides every family
package with a local tarball.

## Public surface

The `AgentPlugin` factory and namespace (`packages/plugin/src/plugin.ts`),
the `DiscoverStrategy` / `DefaultDiscoverStrategy` contract and the
classifier and walker helpers, `discoverProjects`, `Tag` /  `Tag.make`, the
`WalkerFileSystem` port, and the two carrier bin shims. `AgentReporter`
itself is never exported — it is an internal implementation detail
constructed by `AgentPlugin()`; a custom rendering path is built by
implementing `VitestAgentReporterFactory` and passing it as `reporter`.

## Key files

- `src/bin/vitest-agent.ts`, `src/bin/vitest-agent-mcp.ts` — the carrier
  shims.
- `src/plugin.ts` — `AgentPlugin(options?)` factory and namespace.
- `src/reporter.ts` — the internal `AgentReporter` class.
- `src/services/CoverageAnalyzer.ts`, `src/services/ConfigValidation.ts`.
- `src/layers/ReporterLive.ts`, `CoverageAnalyzerLive.ts`,
  `ConfigValidationLive.ts`, `ConfigValidationTest.ts`.
- `src/utils/discover-strategy.ts`, `discover-projects.ts`,
  `classify-helpers.ts`, `find-test-files.ts`, `walker-fs.ts`, `tag.ts`,
  `inject-tags.ts`, `is-test-shaped-package.ts`, `run-script-lock.ts`,
  `is-benign-vite-source-map-warning.ts`, `resolve-thresholds.ts`,
  `resolve-coverage-dir-isolation.ts`, `is-partial-run.ts`,
  `capture-env.ts`, `capture-settings.ts`, `process-failure.ts`,
  `build-reporter-kit.ts`, `route-rendered-output.ts`, `report-writer.ts`.

## The carrier bins

The plugin declares both bins itself as four-line shims under
`packages/plugin/src/bin/`:

```ts
// src/bin/vitest-agent.ts
#!/usr/bin/env node
import { main } from "@vitest-agent/cli/main";
main();

// src/bin/vitest-agent-mcp.ts
#!/usr/bin/env node
import { main } from "@vitest-agent/mcp/main";
void main();
```

pnpm links only direct-dependency bins, which is why the shims live here
rather than behind a `publicHoistPattern` or a pnpm plugin: the root
`package.json` lists only `@vitest-agent/plugin` as a workspace
devDependency, and `pnpm-workspace.yaml` carries no hoist pattern. Under
npm, yarn (node-modules linker), and bun — which hoist transitive bins —
`@vitest-agent/cli`'s own `vitest-agent` bin wins the `.bin` slot and
shadows the carrier's shim, which is the same program either way. See
[Carrier Pattern and Ranked Layering](../decisions/70-carrier-pattern-and-ranked-layering.md).

## Workspace-layering and packed-install tests

Two guardrails live in this package's test tree because the carrier is the
top of the graph and root-level tests are not discovered
(`classifyTestPath`).

`__test__/workspace-layering.test.ts` reads every workspace manifest
(`__test__/utils/workspace-graph.ts`'s `readWorkspaceGraph(rootDir)` over
`packages/*`, `plugins/*`, `website`, `playground`, and the root) and
asserts every package has a declared rank, every dependency edge points to
a strictly lower rank, the two front ends never depend on each other, and
a topological sort consumes every node[^layering-test]. See
[Ranked Layering](../invariants/ranked-layering.md).

`__test__/bins-packed-install.e2e.test.ts` proves the carrier's promise
outside the workspace: it packs every family package from
`dist/prod/npm/pkg` with `npm pack`, writes a scratch consumer
`package.json` depending on the plugin tarball with tarball overrides for
the rest, installs under npm, pnpm, yarn (berry via corepack,
`nodeLinker: node-modules`), and bun with `XDG_DATA_HOME` pointed inside
the scratch dir, and asserts per manager that `node_modules/.bin/vitest-agent`
and `vitest-agent-mcp` are executable, that `--version` exits 0 with a
semver, and that the MCP bin answers a JSON-RPC `initialize` with empty
stderr and exit 0. Network is required; `KEEP_PACKED_INSTALL=1` keeps the
scratch tree for inspection.

## AgentPlugin

`packages/plugin/src/plugin.ts`. Hooks into Vitest's `configureVitest`,
detects the environment, parses coverage thresholds and targets, picks the
user's `VitestAgentReporterFactory` (defaulting to
`DefaultVitestAgentReporter` from `@vitest-agent/reporter`), then
constructs an `AgentReporter` per project and pushes it onto
`vitest.config.reporters`.

**The user-facing options shape.** `AgentPluginOptions` is exactly six
fields; see [AgentPluginOptions](../interfaces/agent-plugin-options.md) for
the field-by-field contract. Everything that is a resolved fact rather than
a user choice — `mcp` (derived from `executor === "agent"`),
`githubActions` (derived from `env === "ci-github" && consoleMode !==
"silent"`), `format`, `consoleOutput`, `detail`, `coverageConsoleLimit`,
`omitPassingTests`, `includeBareZero`, `githubSummary`,
`githubSummaryFile` — stays off the user surface and lands on
`ResolvedReporterConfig` instead, so custom reporters can still inspect it.

**Cache directory resolution.** Resolved entirely through the XDG path
stack in `@vitest-agent/engine`'s `resolve-data-path.ts` — programmatic
`cacheDir`, then `vitest-agent.config.toml`'s `cacheDir`, then its
`projectKey`, then the workspace `package.json#name`. See
[`@vitest-agent/engine`](./engine.md) *XDG path resolution*.

**Per-project isolation.** In multi-project Vitest configs, the plugin
constructs one `AgentReporter` per project via `projectFilter`. Each
reporter filters `testModules` to its own project before persistence and
rendering. Coverage dedup runs by alphabetical project ordering: only the
first project processes the global `CoverageMap`, others skip to avoid
double-counting.

**Console matrix → `ConsoleMode` resolution.** The plugin reads
`options.console.{human,agent,ci}`, looks up the slot matching the
detected executor, and resolves a single `ConsoleMode` value. Per-slot
defaults: `human → passthrough`, `agent → agent`, `ci → passthrough`. A
non-empty `VITEST_AGENT_CONSOLE` override wins over the configured slot,
but only when legal for the detected executor — the three slots accept
three different literal unions, so the accepted-values list in the
rejection warning is introspected from the SDK schema's `.literals` rather
than hand-listed, so it cannot drift from the schema on the next mode
addition. The three `Schema.is` guards stay separate rather than
collapsing into a ternary-produced union, which confuses tsgo on
annotations-method contravariance.

**Console-reporter stripping.** Whenever the resolved `consoleMode` owns
stdout (anything other than `passthrough`), the plugin strips Vitest's
built-in console reporters (`default`, `verbose`, `tree`, `dot`, `tap`,
`tap-flat`, `hanging-process`, `agent`) from the chain and zeroes
`coverage.reporter` to suppress Vitest's native coverage text table.
Custom reporters and non-console built-ins (`json`, `junit`, `html`,
`blob`, `github-actions`) are preserved.

**`onRunEvent` is a stream tee, not a gating switch.** `AgentReporter.emit`
publishes onto the internal run-event `PubSub` and then calls the
user-supplied `onRunEvent` tap unconditionally, for every `consoleMode`.
Throwing user callbacks are caught and logged to stderr so a buggy tap
never breaks persistence or rendering.

**Version constant.** The plugin re-exports `CURRENT_PLUGIN_VERSION`
(sourced from `process.env.__PACKAGE_VERSION__` via the bundler's `define`
substitution) with no internal drift check against the SDK or reporter
version — the earlier lockstep drift check was removed when the family
moved to independent versioning.

## AgentReporter (internal Vitest-API class)

`packages/plugin/src/reporter.ts`. Constructed by `AgentPlugin`, never
exported as a public API. Its job is the persistence pipeline plus the
live event stream; all rendering is delegated to the configured
`VitestAgentReporterFactory`.

**The run-event channel.** The constructor creates an unbounded Effect
`PubSub<RunEvent>`, threaded onto `ReporterKit.runEvents`. Live-rendering
orchestration lives in the reporter package; this class only publishes
events onto the channel and hands the channel to the factory.

**Lifecycle hooks.** `onInit` resolves `dbPath` then calls
`initReporters()`, which resolves a run-start `ReporterKit` (neutral run
health) and invokes `opts.reporter(kit)` **at run start** so a
live-painting reporter can subscribe before the first event; the resolved
reporters are stashed for reuse by `onTestRunEnd`. `onCoverage` stashes
coverage data. `onTestRunEnd` is the load-bearing hook for persistence and
end-of-run rendering.

**Every Vitest reporter hook is wired** to an emitted `RunEvent`, so the
internal event surface is complete. Two emit details are load-bearing:
`onTestCaseReady` emits a standalone `TestStarted` while `onTestCaseResult`
emits only `TestFinished`, so the transient running state gets its own
render frame; and `CoverageReady` plus one `ThresholdViolation` per
violated metric are emitted from `onTestRunEnd` after `CoverageAnalyzer`
finishes, because the raw `onCoverage` istanbul map cannot fill those
payloads on its own. On a partial run `CoverageReady` also carries
`scoped: true`, `scopedFiles`, and `totalFiles`, and no
`ThresholdViolation` is emitted at all.

`isTimeoutError` (`utils/detect-timeout.ts`) is a pure matcher the reporter
runs per failed test to set the optional `timedOut` boolean on
`TestFinished` — Vitest reports a timed-out test as `failed` with a
timeout-flavored error, and the distinction is render-layer only.
`onTestModuleEnd` tallies a per-tag test count as `tagCounts` on
`ModuleFinished`. `onTestRunEnd` emits `TrendComputed` after trend
computation and `RunFinished` at the top of its handler (carrying
`collectedModules: testModules.length`, the full collected count including
passing modules) so a subscribed reporter sees end-of-run before the heavy
persistence work runs. A `wantsRunEvents()` gate (true when `onRunEvent` is
set, `consoleMode === "stream"`, or a custom reporter is in use) skips
event construction when nothing will consume the stream.

**`onTestRunEnd` flow (Full mode).** The handler splits into a **persist**
program (needs SQLite) and a **render** program (does not), so a
persistence failure can never swallow the run's output:

1. Resolve `dbPath` via `ensureDbPath()`. A rejection leaves `dbPath`
   undefined and records a `persistDisabled` reason rather than returning
   — the render program is DB-free, so the run still reports its results.
2. Build fallback reports up front, outside any Effect, wrapped in a
   `try` — `buildAgentReport` walks duck-typed Vitest getters bare, so a
   throwing getter degrades to a `formatFatalError` line on stderr and an
   early return rather than an unhandled rejection with no output at all.
3. `await ensureMigrated(dbPath)` to serialize migration across reporter
   instances sharing a `dbPath`. A rejection records `persistDisabled` and
   skips straight to the render program.
4. **Persist program** (`DataStore | DataReader | CoverageAnalyzer |
   HistoryTracker`, provided by `ReporterLive({ dbPath, env, … })`):
   persists settings, builds the `AgentReport` per project, classifies
   outcomes, runs each error through `processFailure`, upserts
   `failure_signatures`, and persists runs, modules, suites, test cases,
   errors, coverage, history, and source-map entries. The same per-test
   walk reads `testCase.annotations()` and `testCase.artifacts()` and
   calls `DataStore.writeAnnotations` / `writeArtifacts`. First project
   (alphabetically) processes global coverage; others skip. A partial run
   routes coverage through `CoverageAnalyzer.processScoped` and emits no
   `ThresholdViolation`. On full (non-scoped) runs the program computes
   updated baselines, writes trends, and persists the resolved
   `coverage.thresholds` and `coverageTargets` independently of
   `autoUpdate`.
5. **Render program** (`OutputPipelineLive` + `NodeServices.layer`, no
   SQLite — the same DB-free wiring the UI-only branch uses): resolves
   env/executor/format/detail, builds a second, health-aware `ReporterKit`,
   reuses the reporters resolved at run start, calls each reporter's
   `render(input, kit)`, concatenates the `RenderedOutput[]`, then routes
   each entry via `routeRenderedOutput`.

**Render survives persistence failure.** The render program always runs.
Its input is the persist program's `PersistResult` when persistence
succeeded, and otherwise a `PersistResult` synthesized from the fallback
reports with an empty classifications map and no `trendSummary`. After
rendering, a failed or disabled persist phase writes one line to stderr:
`vitest-agent: persistence failed — results above were rendered but NOT
recorded: <reason>`. The pre-split behavior — return early, render nothing
— was the worst possible outcome for an agent, which then had no run
result at all.

**Per-project run outcome.** Vitest's `reason` argument to `onTestRunEnd`
is the whole-process outcome; writing it verbatim marked every project
`failed` when one failed. `writeRun` derives a per-project reason from
that project's own report instead: `interrupted` passes through globally,
otherwise `failed` when `summary.failed > 0 || failedFiles.length > 0`,
`passed` otherwise. The health-aware kit's `hasFailures` keys off
`report.failedFiles.length > 0 || report.unhandledErrors.length > 0`, NOT
`summary.failed` — so a module that failed to *collect / load* (zero
failing test cases) still marks the run red.

**Error-text coercion at the persistence boundary.** Every value the
reporter pulls off a Vitest error before handing it to `DataStore` goes
through the SDK's `coerceErrorField`, because the property access itself
is the hazard: a live getter can throw before the value ever reaches a
coercion helper. The raw error is no longer spread into `processFailure`
(`{ ...e }` invokes every enumerable getter) — the reporter builds an
explicit object of already-coerced `message` / `name` / `stack` plus a
`stacks` array read through a local guard.

## CoverageAnalyzer

`packages/plugin/src/services/CoverageAnalyzer.ts` plus its live and test
layers. Effect service that processes istanbul `CoverageMap` data with
optional scoping. It lives here rather than in the SDK because only this
package's lifecycle class consumes istanbul `CoverageMap` data directly —
the CLI and MCP packages read pre-processed coverage from SQLite via
`DataReader`, and the reporter factories receive coverage as part of the
pure `AgentReport` structure. The implementation is a pure computation
against duck-typed `CoverageMap` interfaces — no I/O, no native deps — but
it is the only service that knows istanbul's specific shape, so it stays
co-located with the lifecycle code that feeds it. `CoverageOptions`
carries an optional `totalFiles`, meaningful only on `processScoped`,
threaded verbatim onto `CoverageReport.totalFiles` so the scoped-coverage
note can render "N of M test files" — the analyzer cannot derive it,
only the reporter has the project-wide spec count.

## DiscoverStrategy + discoverProjects

`packages/plugin/src/utils/discover-strategy.ts` and
`discover-projects.ts`. The single extension point for project detection
and tag classification. See [Discovery API](../interfaces/discover-api.md)
for the consumer-facing contract and
[Unified DiscoverStrategy + DiscoverBuilder](../decisions/39-unified-discoverstrategy-discoverbuilder.md).

**Bucketing.** A test file is discoverable only at `<workspace>/src/**` or
`<workspace>/__test__/**`, anchored at the package root. A `__test__/`
directory nested anywhere else — `lib/scripts/__test__/`, for example — is
never included; the include globs are absolute and package-anchored, not
the unanchored `**/__test__/**` that shipped in 2.1.0 and caused issue 227
(Vitest globs a pattern literally with no nested-`package.json`
concept, so for the root workspace the pattern globbed the entire
repository and collected foreign test suites against the wrong toolchain).
The rule lives in one place, `classifyTestPath` in `@vitest-agent/sdk`'s
`utils/test-location.ts`, and the discovery globs are generated from the
same constants that back it. The helper-subdirectory excludes (`utils`,
`fixtures`, `snapshots`) apply only directly under `__test__/`, never at
any depth — the earlier any-depth form dropped a legitimate suite at
`__test__/unit/utils/foo.test.ts` from discovery with no warning (issue
251; a real consumer lost 5 suites / 60 cases).

**Signature-invalidated process cache.** `discoverProjects` results are
keyed by workspace root in a module-local `Map`, fired only when neither
`strategy` nor `additionalEntries` was supplied. Each entry stores
`{ result, signature }`: the signature is a cheap fingerprint of exactly
`src/` and `__test__/` per package (recursive relative-path + `mtimeMs`
pairs, sorted, no file contents), pruning `node_modules`, `.git`, and
`dist` *before* recursing — Node's recursive `readdir` follows symlinked
directories, and a pnpm `node_modules` tree is symlinks into the
content-addressed store, so an unguarded walk would traverse the whole
store or hit a cycle. A mismatch triggers a rescan rather than returning
stale include-globs (issue #100 — the long-lived MCP server otherwise
silently dropped tests after a test-file move). Every real scan records
an ISO timestamp under a `Symbol.for()` process-global slot, readable via
`getLastDiscoveryScanTimestamp()`, which `@vitest-agent/mcp` reads back
without a circular import.

**Declined test-shaped packages warn once.** A null `buildProject` return
is silent by contract, but when a *declined* package still looks
test-shaped (`isTestShapedPackage` — a `__test__/` directory exists
regardless of contents, or `src/` holds a matching file), the plugin
writes one stderr line naming the package and pointing at
`vitest-agent agent check-test-path <path>` (issue #229). The dedup is
reservation-based: the path is added to the warned-set *before* the async
probe, not after the warning is written, because two overlapping
`discoverProjects()` calls could otherwise both clear the guard while the
first was still awaiting the probe.

## Tag injection transform

`packages/plugin/src/utils/inject-tags.ts` plus the `transform` hook in
`AgentPlugin()`. For every test file id, the plugin calls
`strategy.classify({ module })`, and — when the tag list is non-empty —
prepends one guarded two-line prelude via magic-string (source maps
preserved): a namespace import of `vitest` plus a try/catch that calls
`TestRunner?.getCurrentSuite?.()`, resolves the file task, and unions the
classified tags into `task.tags`. Vitest's runner unions parent tags into
every suite and test it registers at collection time, so every
declaration form inherits the file-level tags — native `it`/`test`,
wrapper testers with a `(name, self, timeout)` signature such as
`@effect/vitest`'s `it.effect`, `test.extend` aliases, numeric-timeout
calls, and dynamically registered tests. There is no parsing at all: the
previous implementation parsed each file with acorn plus acorn-typescript
and rewrote every `test()`/`it()` call's options argument, which corrupted
wrapper testers (the injected options object became the test body, vitest
threw "Cannot use two functions as arguments" and collected zero tests —
issue #133) and could never reach dynamic or numeric-timeout declarations.
Every failure mode degrades to untagged tests, never a crash.

**`fsModuleCache` cache-key registration.** Vitest 5's `fsModuleCache`
persists transformed modules across reruns keyed on file content and
environment config alone — invisible to the filesystem scan this
transform's prelude is derived from. `configureVitest` therefore calls
`ctx.defineCacheKeyGenerator(makeTagCacheKeyGenerator(classifyForCache))`
once per Vitest instance, which runs the same per-id classification and
returns `vitest-agent:tags:<sorted,comma,joined>`.

## Vite source-map warning filter

Under v8 coverage, Vite core's `loadAndTransform` emits a benign `[vite]
(ssr) Failed to load source map ...` / ENOENT `.js.map` warning for
dependencies shipping a `.js` referencing an unpublished `.js.map`
sibling. This rides Vite's `environment.logger.warn`, not per-test console
output, so it never reaches the console-leak path. The plugin adds a Vite
`configResolved(resolvedConfig)` hook that wraps `resolvedConfig.logger.warn`
in place: messages matching `isBenignViteSourceMapWarning` are dropped,
everything else forwards untouched. Every per-environment logger delegates
to the single root `logger.warn` reference, so mutating that one function
intercepts all environments. The wrap lives in `configResolved` rather
than a `config`-hook `customLogger` because Vite can construct or replace
the logger between `config` and `configResolved`.

## AgentPlugin.discover()

`packages/plugin/src/plugin.ts`, a static method on the `AgentPlugin`
namespace. See [Discovery API](../interfaces/discover-api.md) for the
consumer-facing contract. Vitest pre-parses project configs before it
evaluates Vite plugin hooks, so a plugin using `configureVitest` to inject
projects arrives too late; users call `AgentPlugin.discover()` in an async
config export instead so discovery runs during config evaluation.

**Coverage-level constants on the namespace.** Each preset returns a
dual-output `CoverageLevelPreset` shape — `{ thresholds, coverageTargets }`
— so users pass `preset.thresholds` to Vitest's native
`coverage.thresholds` and `preset.coverageTargets` to
`AgentPlugin({ coverageTargets })` from a single source of truth.
`AgentPlugin.COVERAGE_LEVELS` and `AgentPlugin.COVERAGE_LEVELS_PER_FILE`
map the five preset names; `AgentPlugin.COVERAGE_AUTOUPDATE` is a frozen
record of three tolerance functions (`standard` floors, `strict` ceils,
`lenient` floors and subtracts 2 clamped to 0) for Vitest's native
`coverage.thresholds.autoUpdate` — the plugin does not configure or
override `autoUpdate` itself.

## AgentPlugin.runScript and its advisory lock

`AgentPlugin.runScript(command)` is the `globalSetup` helper that runs a
shell command with `stdio: "pipe"`, staying silent unless the command
fails. Two `vitest` invocations in one checkout each run the `globalSetup`
build and race over the same `dist/` output — the same class of
shared-resource collision as the MCP server's per-invocation coverage
directory, but unfixable the same way because the build's whole point is
a shared output directory. Serialization is the only option.

`packages/plugin/src/utils/run-script-lock.ts` implements a file-based
advisory lock: exclusive create (`openSync(lockPath, "wx")`, `EEXIST`
means someone else holds it) under
`$XDG_DATA_HOME/vitest-agent/runscript-locks` keyed by a truncated
SHA-256 of `(cwd, command)`; a done marker with a freshness window (a
waiter that sees a marker younger than `builtRecentlyMs` skips its own
run entirely); two-tier stale takeover (liveness first via
`process.kill(pid, 0)`, age second, and only for an unreadable owner
record); release gated by a per-acquisition nonce so a taken-over owner
cannot delete the new owner's lock; init-failure cleanup; and a wait
timeout as an escape valve — a waiter blocked past `waitTimeoutMs` runs
its command unserialized rather than hanging forever. All four timings
are injectable via `VITEST_AGENT_RUNSCRIPT_*` env vars, parsed strictly by
`parseLockTimingOverride` (a whole-string run of digits, bounds-checked)
rather than a bare `Number.parseInt`, so a typo degrades to the production
default rather than a broken lock.

## Test annotations and test artifacts

`packages/plugin/src/reporter.ts` ingests Vitest 5's `context.annotate`
notes and `recordArtifact` payloads — *test* annotations and *test*
artifacts, distinct from TDD artifacts. Persisted at `onTestRunEnd`
rather than from the streaming hooks: the walk reads
`testCase.annotations()` and `testCase.artifacts()` in the same loop that
feeds `writeErrors`, so a `--merge-reports` run — which replays no
streaming events — still persists everything. `internal:`-prefixed
artifact types are Vitest's own bookkeeping and are skipped everywhere.
Artifact objects are user data, so every field read goes through a guarded
accessor with the same discipline `coerceErrorField` applies to error
objects. A `Uint8Array` attachment body is base64-encoded and stamped
`bodyEncoding: "base64"`; `byteSize` is always the decoded payload size.
The 64 KiB inline-body cap lives in the SDK's `DataStoreLive`, not here.

## Report files

`AgentPlugin({ report })` controls the `.vitest/<scope>/` report files
written through Vitest 5's `vitest.createReport(scope)`. See
[Report Files](../interfaces/report-files.md) for the wire contract.
Option resolution defaults report files on for the `agent` and `ci`
executors and off for `human`; `report: false` disables them; `report:
{ scope }` renames the directory (default scope `vitest-agent`). The
writer (`packages/plugin/src/utils/report-writer.ts`) creates the
directory lazily and synchronously at first write, never calls `clean()`
(it would wipe a prior shard's output and is a no-op under
`--merge-reports` anyway), rejects `/`, `\`, `.`, and `..` in filenames
because Vitest's `Report.writeFile` performs no containment check itself,
treats a rejected write as supplemental (caught, reported on stderr, never
fails the run), and flushes before `onTestRunEnd` resolves — including on
the UI-only short-circuit path.

## ReporterLive composition layer

`packages/plugin/src/layers/ReporterLive.ts`.
`ReporterLive(options: PlatformOptions) = CoverageAnalyzerLive.pipe(Layer.provideMerge(PlatformLive(options)))`
— the engine's one platform composite plus the plugin-only
`CoverageAnalyzer`. See [`@vitest-agent/engine`](./engine.md)
*`PlatformLive`*.

## Reporter actor resolution and per-run context capture

The reporter reads `process.env.VITEST_AGENT_AGENT_ID`,
`_PARENT_AGENT_ID`, `_CONVERSATION_ID`, `_MAIN_AGENT_ID`, and
`_SESSION_ID` at `onTestRunEnd` time and stamps every `test_runs` row with
`actor_type='agent'` plus the canonical UUIDs when set, falling back to
`actor_type='system'` and NULL ids for a plain terminal or CI invocation
with no Claude window attached. Before each `writeRun`, the reporter calls
the SDK's `RunContext.capture` service to populate the seven `git_*`
columns and the three `host_*` columns on every `test_runs` row —
detached-HEAD state surfaces as literal `'HEAD'` for the branch with the
SHA as the reliable identifier.

## Coverage threshold extraction

The plugin extracts thresholds from Vitest's already-resolved coverage
config rather than re-parsing the user's input, because Vitest applies
its own pattern expansion and inheritance rules and the plugin must see
the same resolved values Vitest will enforce. `coverageThresholds` is no
longer a plugin option in any form — users set Vitest's native
`test.coverage.thresholds` directly; `coverageTargets` remains a plugin
option (see [AgentPluginOptions](../interfaces/agent-plugin-options.md)).
Thresholds and targets persist distinctly from the baseline: at the end of
the persist program, `onTestRunEnd` writes the resolved
`coverage.thresholds` via `DataStore.writeThresholds` and
`coverageTargets` via `DataStore.writeTargets`, each only when configured
and only on a full (non-scoped) run — a partial run's totals reflect the
whole project, not what ran, so recording them as "the enforced bar" would
misrepresent a value nothing in that run re-validated. The rows land in
`coverage_baselines` under `kind = 'threshold'` / `'target'`, never
colliding with the `'baseline'` rows the ratchet writes.

## Partial-run detection and threshold suppression

Vitest enforces `coverage.thresholds` against the whole-project
denominator regardless of how many test files ran — its coverage
provider's `allTestsRun` flag gates only `autoUpdate`, not
`checkThresholds`, which runs unconditionally after every reporter's
`onTestRunEnd`. A `vitest run foo.test.ts` therefore fails on coverage
nothing in the run touched. **Detection:** `onTestRunStart` stores
`specifications.length` as `startedSpecCount`; `onTestRunEnd` globs the
project-wide total (best-effort — a missing method or throw makes the
counts equal, degrading to "not partial"). Both counts, Vitest's
`filenamePattern`, the reporter's own `projectFilter`, the stashed Vitest
instance's `config.cliOptions` (as `cliFilters`), and a three-way
`testNamePattern` input (decided by `hasTestNameFilter`) feed the pure `isPartialRun`; any one signal
makes the run partial. The spec-count comparison cannot catch
a CLI `--project` run — `globTestSpecifications()` applies the same
project filter, so started equals total — which is why the `cliFilters`
signal exists (issue #401): the pure `hasCliScopeFilter` helper reports
partial when `project`, `tagsFilter`, `related`, or `shard` is non-empty
or `changed` is truthy. `config.cliOptions` is the raw options object
`startVitest(mode, filters, options)` captures, so it carries real CLI
flags and the programmatic filters MCP `run_tests` passes but not
settings baked into `vitest.config.ts` — deliberately, since a permanent
config-file `tagsFilter` is the project's own scope, not a partial run.
`testNamePattern` is not part of `CliScopeFilters`: it arrives as
`{ cli, initial, current }` — `cli` is `config.cliOptions.testNamePattern`
(the raw pre-resolution string; `undefined` when the pattern comes only
from `vitest.config.ts`), `initial` is the `configOverride.testNamePattern`
value `AgentReporter.onInit` snapshots at startup (Vitest's `_setServer`
copies the resolved pattern — config file merged with `-t` — into
`configOverride` before reporters are created), and `current` is
`configOverride.testNamePattern` at `onTestRunEnd`. When `current` differs
from `initial` (compared by RegExp source, not identity), the run is
partial iff `current` is truthy — a watch-mode `t` filter applied through
`Vitest.changeNamePattern` is partial, a cleared one is full; otherwise
the run is partial iff `cli` is truthy — `-t foo` is partial, while
`-t ""`, no flag, or a config-file-only pattern is full. Neither source
alone suffices: bare `cliOptions` would count `-t ""` and never see a
watch-mode change, and bare `configOverride` would make every run partial
for a project whose config file sets a pattern.
**Routing:** a partial run derives tested source files by
the `*.test.ts → *.ts` convention, routes coverage through
`CoverageAnalyzer.processScoped`, writes `test_runs.scoped` from
`isPartial`, and emits no `ThresholdViolation`; baseline, trend,
threshold, and target writes are all skipped. **Neutralising Vitest's
native check:** because `checkThresholds` reads
`coverageProvider.options.thresholds` in place after the reporter runs,
the reporter deletes every metric key and glob-pattern entry from that
object on a partial run — a reach into provider internals with no public
API, guarded end to end so it can never crash the run. **Restoring:** in
watch mode the provider is created once and scoped reruns reuse it
without re-initializing, so a deleted key would otherwise stay gone for
the rest of the watch session; the reporter snapshots each deleted key
into a private map and re-adds only the still-absent keys on the next
`onTestRunStart`.

## ConfigValidation

`packages/plugin/src/services/ConfigValidation.ts`, with live and test
layers. Effect service `vitest-agent/ConfigValidation` exposing one
method, `validate(input): Effect<ValidationResult, never, never>`.
`ConfigValidationLive` resolves an operating mode from
`vitestConfig.coverage?.enabled`: `false` is UI-only mode (provider rules
skip — there is no coverage pipeline to need a provider); anything else is
Full mode (all seven rules run). The mode is also threaded onto
`ResolvedReporterConfig.coverageMode` from the same source so the
reporter's persistence short-circuit and the validation rule registry
agree on which mode is active. The rule registry covers
`TARGET_WITHOUT_THRESHOLD` (warn), `TARGET_BELOW_THRESHOLD` (error),
`THRESHOLD_WITHOUT_TARGET` (silent — the internal zero target),
`INVALID_TARGET_VALUE` (error, top-level and nested glob entries),
`UNSUPPORTED_PROVIDER` (error, Full mode only), `MISSING_PROVIDER_PACKAGE`
(error via `createRequire(...).resolve`, Full mode only, with an install
command in `remediation`), and `PERFILE_ON_TARGETS` (warn). Warnings and
info entries print to stderr through the `[vitest-agent:plugin]` prefix
and do not fail the build; errors throw via `formatFatalError`.
`ConfigValidationTest.layer(override?)` injects a pre-built
`ValidationResult` for unit tests.

## Coverage directory isolation (plain-CLI agent runs)

`configureVitest` decides, once per Vitest run, whether to relocate
`vitest.config.coverage.reportsDirectory`. Two concurrent plain-CLI
`vitest run` invocations in one checkout share that directory, and the v8
provider's `clean: true` default `rm -rf`s it at run start, so one run can
delete the other's `.tmp` files mid-flight. The pure
`resolveCoverageDirIsolation({ executor, coverageEnabled, env, configured })`
returns `keep` when coverage is off or the executor is `human` or `ci` (or
`VITEST_AGENT_COVERAGE_DIR_ISOLATION` is off), `explicit` with a dir when
`VITEST_AGENT_COVERAGE_DIR` is set (used verbatim, no cleanup), otherwise
`isolate` (a fresh `mkdtemp`, removed via `vitest.onClose(...)`). Removal
rides `onClose`, not `onTestRunEnd`, because in a non-watch run
`Vitest.report("onTestRunEnd", …)` fires and returns *before*
`Vitest.reportCoverage()` writes lcov/html into `reportsDirectory` —
removing the directory from the reporter's `onTestRunEnd` would race that
write and recreate the ENOENT it exists to prevent. What is unaffected:
`file_coverage` persistence reads the istanbul `CoverageMap` handed to
`onCoverage`, never files under `reportsDirectory`.

## UI-only mode short-circuit in `onTestRunEnd`

`RunFinished` is still emitted at the top of the handler; `filteredModules`
is still computed. When `opts.coverageMode === "ui-only"`, the reporter
builds `AgentReport[]` from `testModules` via the pure `buildAgentReport`
helper (no DB read, no classifier), runs a tiny Effect program against
`OutputPipelineLive` + `NodeServices.layer` to resolve env/executor/
format/detail, builds the run-end kit, calls `render(input, kit)`, and
routes the output — then returns, with no `ensureMigrated`, no
`DataStore.write*`, no `CoverageAnalyzer.process`, no `HistoryTracker`.
The streaming hooks and the `RunFinished` event fire identically in both
modes.

## Choices absorbed here

### Reporter-Native Project Grouping

Monorepo users need per-project output. The Reporter API provides project
info natively via `TestProject`, so grouping happens in the reporter via
`testModule.project.name` — no Vite plugin and no `:ai` mirror projects.
The `project` column stores `testModule.project.name` verbatim, one row
per workspace package. Zero configuration; works identically in
monorepos and single repos with one reporter instance.

### Four-Environment Detection

`EnvironmentDetector` distinguishes `agent-shell`, `terminal`,
`ci-github`, and `ci-generic`; `ExecutorResolver` then maps these to three
executor roles (`human`, `agent`, `ci`) for output behavior. The CI split
enables GFM-specific behavior under GitHub Actions without conflating all
CI environments; the two-stage pipeline (fact-finding → behavior
decisions) keeps detection separate from policy.

### History Always-On

`DataStore.writeHistory` runs unconditionally for each test case in
`onTestRunEnd`. History rows are small; the write cost is negligible
relative to test execution, and an opt-in toggle would add API surface
without meaningful benefit — agents always have classification data with
no configuration required.

### Vitest-Native Threshold Format

`coverageThresholds` (before it moved onto Vitest's own field) accepted
the full Vitest thresholds shape — per-metric thresholds, per-glob
patterns, negative numbers for relative thresholds, the `100` shorthand,
and `perFile` mode — parsed by `resolveThresholds()` into a typed
`ResolvedThresholds` structure. Aligning with Vitest's format meant users
who already configure Vitest thresholds got the same shape for free.

### Three-Level Coverage Model

Users need both hard enforcement (fail the build) and aspirational goals
(track progress toward 100%). Three levels: thresholds (enforced
minimums), targets (aspirational goals), and baselines (auto-ratcheting
high-water marks in `coverage_baselines`). A single threshold serves one
purpose; the three-level model lets one project carry "must not regress"
and "still climbing" simultaneously.

### Per-Project Reporter Instances

Vitest calls `configureVitest` per project, giving each project its own
reporter instance. The plugin passes the project name as `projectFilter`
on `AgentReporter`; each instance filters `testModules` to only modules
matching its project. Filtering at the reporter level is simpler than
coordinating between instances, and coverage dedup (only the first
project alphabetically processes global coverage) is deterministic and
requires no shared state.

### Native Coverage Table Suppression

Whenever the resolved `consoleMode` owns stdout, the plugin sets
`coverage.reporter = []` to suppress Vitest's built-in text coverage
table, which would otherwise duplicate the reporter's own compact
coverage output and waste context-window tokens for LLM agents. Setting
`coverage.reporter` to an empty array is the cleanest suppression
mechanism without affecting coverage data collection; in `passthrough`
mode suppression is skipped so Vitest's reporters render normally.

### Discovery Cache Signature Invalidation + Cross-Package Last-Scan Handshake

`discoverProjects()` originally cached its result in a module-level `Map`
keyed by workspace root with no invalidation, for the life of the Node
process — fine for a one-shot `pnpm vitest run`, but the long-lived MCP
server re-loads discovery on every `run_tests` call, so a stale cache
silently dropped ~1290 tests after a test-file move (issue #100). The
directory-signature fix and the `Symbol.for("vitest-agent:discovery:last-scan-at")`
cross-package handshake are described above under *DiscoverStrategy +
discoverProjects*. An extension of the signature to fingerprint nested
`__test__` directories at any depth (made to reach a path reported in
issue #184) was later reversed — #184 was an invalid report, and honoring
it caused issue #227.

### Filter Benign Vite Source-Map Warnings via a `configResolved` Logger Wrap

Described above under *Vite source-map warning filter*. Verified against
vite@8.1.0 that every per-environment logger delegates to the single root
`logger.warn` reference, so wrapping that one function intercepts every
environment; the backing `ResolvedConfigLike` / `ViteLoggerLike` types
stay `@internal` and the `configResolved` field uses an inline structural
type, keeping them off api-extractor's public surface.

### A Narrow Filesystem Port for the Discovery Walkers

The four discovery walkers — `findTestFiles`, `isTestShapedPackage`,
`detectSetupFile`, and the cache-signature walk — used to import
`node:fs/promises` directly, which a virtual filesystem cannot intercept,
forcing every discovery test to build a real temporary directory.
`WalkerFileSystem` (`packages/plugin/src/utils/walker-fs.ts`) defines
exactly two operations, `readDirectory(dir)` and `statEntry(path)`, plus
the `nodeWalkerFs` binding every production call site takes as its
default, so production behavior is unchanged by construction. The shape
is deliberate: not `fs.promises`-shaped (a wider surface would invite call
sites to reach past the port) and not shaped like `@effected/workspaces`'s
`SyncFileSystem` either, which answers entry *names* while the walkers
need the entry *type* `readdir({ withFileTypes: true })` returns in the
same syscall — reading names and then stat-ing each one is exactly the
syscall-doubling the port exists to avoid. The discovery walkers must not
follow symlinks (a pnpm `node_modules` tree is a farm of links into the
content-addressed store), so they sit on `@effected/memfs`'s literal
`Volume` inspection view, while only `getWorkspacePackagesSync` uses the
resolving `syncFileSystem` port — same package, opposite correct symlink
answer, one accessor apart.

### Pattern: Range Compression

Used in coverage output (both console and JSON) for a compact
representation of uncovered lines suited to LLM consumption:
`compressLines()` converts `[1,2,3,5,10,11,12]` to `"1-3,5,10-12"`.

### Pattern: Project-Keyed Accumulation

Used in `AgentReporter.onTestRunEnd`'s result collection: group test
results by `TestProject.name` during the run in a
`Map<string, VitestTestModule[]>`, then emit per-project outputs.

## Related limitations

See [Coverage Shared Across Projects](../limitations/coverage-shared-across-projects.md),
[Convention-Based Source Mapping](../limitations/convention-based-source-mapping.md),
and [Vitest 5 Floor](../limitations/vitest-5-floor.md).

[^layering-test]: `../../packages/plugin/__test__/workspace-layering.test.ts`
