---
status: current
module: vitest-agent-reporter
category: architecture
created: 2026-05-06
updated: 2026-05-12
last-synced: 2026-05-12
completeness: 90
related:
  - ../architecture.md
  - ../components.md
  - ../decisions.md
  - ../data-structures.md
  - ./sdk.md
  - ./reporter.md
  - ./ui.md
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

**Console matrix → `ConsoleMode` resolution.** The plugin reads
`options.console.{human,agent,ci}` (the per-executor matrix from
`AgentPluginOptions`), looks up the slot matching the detected executor,
and resolves a single `ConsoleMode` value. Per-slot defaults: `human →
passthrough`, `agent → agent`, `ci → passthrough`. The pre-2.0 `mode` and
`strategy` options are gone — see [../decisions-retired.md](../decisions-retired.md)
for the retired entries.

**Console-reporter stripping.** Whenever the resolved `consoleMode` owns
stdout (any value other than `passthrough`), the plugin strips Vitest's
built-in console reporters (`default`, `verbose`, `tree`, `dot`, `tap`,
`tap-flat`, `hanging-process`, `agent`) from the chain and zeroes
`coverage.reporter` to suppress Vitest's native coverage text table.
Custom reporters and non-console built-ins (`json`, `junit`, `html`,
`blob`, `github-actions`) are preserved.

**`onRunEvent` tap gating.** The plugin accepts an optional
`onRunEvent: (event: RunEvent) => void` callback for hosts that want a
live view. The tap is forwarded to `AgentReporter` **only when the
resolved `consoleMode === "ink"`**. Every other mode renders statically
(`agent`, `ci-annotations`) or asked for silence (`passthrough`,
`silent`); forwarding the tap regardless would leak a live Ink mount
into channels the user explicitly opted out of. Tests for the gating
contract live in `packages/plugin/__test__/plugin.test.ts` under
"onRunEvent tap gating".

**GitHub Step Summary.** Independent of `consoleMode`. Defaults on under
GitHub Actions (`env === "ci-github" && consoleMode !== "silent"`); the
user can force it via `githubSummary: true|false`.

## AgentReporter (internal Vitest-API class)

`packages/plugin/src/reporter.ts`. Internal lifecycle class — constructed by
`AgentPlugin`, never exported as a public API. Standalone reporter consumers
go through the named factories in `vitest-agent-reporter` or
`vitest-agent-ui`.

The class's job is the persistence pipeline plus the live event stream;
end-of-run rendering is delegated to the configured factory.

**Lifecycle hooks:**

- `onInit` resolves `dbPath`. If `options.cacheDir` is set, the helper
  short-circuits to `<cacheDir>/data.db` — skipping the heavy XDG/workspace
  layer stack that would otherwise eagerly scan lockfiles. Otherwise it runs
  `resolveDataPath(process.cwd())` and memoizes on `this.dbPath`. On
  rejection, prints `formatFatalError(err)` to stderr and returns early.
- `onCoverage` stashes coverage data; fires before `onTestRunEnd`.
- `onTestRunEnd` is the load-bearing hook for persistence and end-of-run
  rendering. See below.

**Streaming hooks (for the live tap).** When `options.onRunEvent` is set,
the reporter also implements Vitest's per-event streaming callbacks
(`onTestRunStart`, `onTestModuleQueued`, `onTestModuleStart`,
`onTestCaseResult`, `onTestModuleEnd`). Each callback constructs the
matching `RunEvent` variant (`RunStarted`, `ModuleQueued`, `ModuleStarted`,
`TestFinished`, `ModuleFinished`) and forwards it to the tap. `onTestRunEnd`
also fires `RunFinished` at the top of its handler so the live mount sees
end-of-run before the heavy persistence work runs. Throwing taps are
caught and logged to stderr — persistence never breaks because a live
renderer has a bug. When `onRunEvent` is undefined the streaming
callbacks short-circuit immediately, so the no-tap path pays no cost.

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

`discoverProjects()` only ever calls `.unit(...)` since each workspace
package now produces a single Vitest project. The `int`, `e2e`, and
`custom` factories remain on the class for callers that hand-construct
projects, but the discovery scanner does not use them.

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
that builds `{ projects: VitestProject[]; tags: TestTagDefinition[] }` from
the pnpm workspace layout. Calls `findWorkspaceRootSync` and
`getWorkspacePackagesSync` from the `workspaces-effect` sync API — no
Effect runtime required.

**Per-package scan:** for each workspace package (skipping the root `.`),
includes both `<pkg>/src/**/*.{test,spec}.*` and (if present)
`<pkg>/__test__/**/*.{test,spec}.*`. Helper subdirs (`utils/`,
`fixtures/`, `snapshots/`) inside `__test__/` are excluded automatically.
Setup file detection picks up `vitest.setup.{ts,tsx,js,jsx}` at the
package root and adds it to `setupFiles`.

**One project per package.** The scanner emits a single `VitestProject`
per workspace package via `VitestProject.unit(...)` — no `:kind` suffix,
no per-kind splitting. Test-kind differentiation comes from Vitest tags
applied by the plugin's transform hook (see Tag injection transform
below). The legacy filename-driven kind classification was retired in
2.0; see [../decisions.md](../decisions.md) Decision 23.

**Process-level cache:** results are keyed by workspace root in a
module-local `Map<string, DiscoverProjectsResult>`. Cache fires only on
the no-options call path so it does not have to fingerprint a
`TagStrategy` instance. Repeated no-options calls from the same process
return the cached result without re-scanning.

**DiscoveryOptions:** the optional first-position argument is either a
`ProjectsCallback` `(ctx) => void | Promise<void>` (receives the full
`projects` array) or an object `{ callback?, tagStrategy? }` where
`tagStrategy` is a `TagStrategy` (or `false` to disable tag injection
entirely). The legacy per-kind override object was removed.

## Tag injection transform

`packages/plugin/src/utils/inject-tags.ts` plus the `transform` hook in
`AgentPlugin()`. Vitest 4.1's runner reads tags from `test()` / `it()`
options at parse time. The plugin installs a Vite `transform(code, id)`
hook that, for every test file id:

1. Calls `strategy.classify({ module })` to resolve the tag list for
   the file (e.g., `["unit"]` for `foo.test.ts`, `["e2e"]` for
   `foo.e2e.test.ts`).
2. Parses with acorn + acorn-typescript and walks every `test(...)` /
   `it(...)` call expression.
3. Uses magic-string to rewrite the options argument to include
   `tags: [...existing, ...resolved]`. Source maps are preserved.

The classifier and the tag declarations both come from a single
`TagStrategy` instance — the same one passed to (or defaulted by)
`discoverProjects`. `Tag` and `TagStrategy` are exported from the
package for callers that want to extend or replace the default
classification. See [./discover.md](./discover.md) for the full strategy
API.

## AgentPlugin.discover()

`packages/plugin/src/plugin.ts` (as a static method on the `AgentPlugin`
namespace). The canonical entry point for workspace-driven Vitest project
discovery. Calls `discoverProjects(options)` and maps each project through
`.toConfig()`, returning `{ projects: TestProjectInlineConfiguration[];
tags: TestTagDefinition[] }` ready for `test.projects` and `test.tags`.

**Why this is a separate static, not a `configureVitest` hook.** Vitest
pre-parses project configs before it evaluates Vite plugin hooks. A plugin
using `configureVitest` to inject projects arrives too late — Vitest has
already finished its project resolution pass. Users therefore call
`AgentPlugin.discover()` in an async config export so discovery runs during
config evaluation:

```ts
export default async () => {
  const { projects, tags } = await AgentPlugin.discover();
  return defineConfig({
    plugins: [AgentPlugin()],
    test: { projects, tags },
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
- `tag.ts` — `Tag` class with `Tag.make` factory and name validation
  (rejects empty names, the reserved words `and`/`or`/`not`, and the
  forbidden characters `()&|!*` plus whitespace).
- `tag-strategy.ts` — `TagStrategy` with `create`, `extend`, and
  `default`. Owns the classifier types (`ClassifyBaseFn`,
  `ClassifyExtendedFn`) and exposes `tagDefinitions` for the discovery
  pipeline to forward into `test.tags`.
- `inject-tags.ts` — AST rewriter built on acorn + acorn-typescript +
  magic-string. `injectTags({ code, classify })` walks every `test()` /
  `it()` call expression and rewrites the options argument to add
  `tags: [...existing, ...resolved]`. Source maps are preserved.
  Used by the plugin's Vite `transform(code, id)` hook.
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

When user-supplied `coverageTargets` are present, the plugin disables
Vitest's `autoUpdate` so the two ratchet mechanisms don't fight. The plugin's
own baseline ratchet runs unconditionally on full (non-scoped) runs.
