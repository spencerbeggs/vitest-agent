---
status: current
module: vitest-agent-reporter
category: architecture
created: 2026-05-06
updated: 2026-05-14
last-synced: 2026-05-14
completeness: 93
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
D40 (T7 five-field options surface), D34 (plugin/reporter split), D28
(process-level migration coordination), D31 (XDG-derived data path), D10
(failure signatures).

---

## AgentPlugin

`packages/plugin/src/plugin.ts`. The Vitest plugin entry point. Hooks into
Vitest's `configureVitest`, detects the environment, parses coverage
thresholds and targets, picks the user's `VitestAgentReporterFactory`
(defaulting to `defaultReporter`), then constructs an `AgentReporter` per
project and pushes it onto `vitest.config.reporters`.

**The 2.0 user-facing options shape.** `AgentPluginOptions` is exactly
five fields — see [./sdk.md](./sdk.md) for the schema and
[../decisions.md](../decisions.md) D40 for the rationale.

| Field | Source of truth | Notes |
| ----- | --------------- | ----- |
| `console` | `AgentPluginOptions` (schema) | Per-executor `ConsoleOutputs` matrix |
| `coverageTargets` | `AgentPluginOptions` (schema) | Typed `CoverageTargets` schema with positive-numbers-only validation |
| `transport` | `AgentPluginOptions` (schema) | Single-member `{ kind: "local" }` union; 2.x default |
| `reporter` | `AgentPluginConstructorOptions` (companion interface) | `VitestAgentReporterFactory`; function-typed, lives outside the schema |
| `onRunEvent` | `AgentPluginConstructorOptions` (companion interface) | Tee-out hook for the live `RunEvent` stream |

Plus `discoverStrategy` on the companion interface for the T5 transform-hook
override. Everything that pre-T7 was a user option but is really a
plugin-internal resolved fact has moved out of the surface — see the
**Resolved internally** section below.

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

**Cross-package version drift check.** The very first statement in
`AgentPlugin()` is a call to the internal `checkVersionDrift` helper,
which compares `CURRENT_PLUGIN_VERSION` against `CURRENT_SDK_VERSION`
and `CURRENT_REPORTER_VERSION` and writes one stderr line per
mismatch. A module-level `_hasWarnedDrift` boolean suppresses repeated
warnings so multi-project Vitest configs do not duplicate the line.
The plugin re-exports the public version constant
`CURRENT_PLUGIN_VERSION` (sourced from
`process.env.__PACKAGE_VERSION__` via rslib-builder's `define`
substitution) and a test-only `_resetVersionDriftGuardForTests` hook
that re-arms the once-per-process gate between integration test cases
(`packages/plugin/__test__/version-drift.test.ts`). The plugin
intentionally does not compare against `CURRENT_UI_VERSION` because
`vitest-agent-ui` is not a hard peer dependency — see the root
CLAUDE.md "Cross-package version drift" section and D36 in
[../decisions.md](../decisions.md).

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

## DiscoverStrategy + DefaultDiscoverStrategy

`packages/plugin/src/utils/discover-strategy.ts`. The single extension
point for project detection and tag classification. The T5 wave merged
the legacy `VitestProject` builder class and `TagStrategy` classifier
into one contract.

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
passed. Its `buildProject` calls `findTestFiles` for both `src/` and
`__test__/` patterns and returns null when neither directory contains
matches — that single predicate replaces every pre-2.0 special case
(root package skip, missing `src/` skip, no-test-files placeholder).
Its `classify` is the filename-suffix match (`.e2e.test.ts` to e2e,
`.int.test.ts` to int, otherwise unit).

The pre-2.0 `VitestProject` builder class and `TagStrategy` classifier
were both deleted in T5. The three classifier helpers
(`classifyByFilename`, `classifyByDirectory`, `combineClassifiers`) and
the standalone `findTestFiles` walker live alongside the strategy and
are publicly exported so user-defined strategies do not have to
reinvent the wheel. See [./discover.md](./discover.md) for the full
API surface.

## discoverProjects

`packages/plugin/src/utils/discover-projects.ts`. Async workspace
scanner. After T5 the signature is a single options bag:
`discoverProjects({ strategy?, cwd?, additionalEntries? })`. Returns
`{ projects: TestProjectInlineConfiguration[] | undefined; tags:
TestTagDefinition[] }`. `projects` is `undefined` rather than an empty
array when no projects were produced so Vitest treats the config as
having no projects.

The unified algorithm replaces every pre-2.0 special-case skip with a
single `strategy.buildProject(input)` predicate. The scanner:

1. Locates the workspace root via `findWorkspaceRootSync` from the
   `workspaces-effect` sync API.
2. Iterates every workspace package, calling `strategy.buildProject`
   with the package metadata. A null return appends nothing; otherwise
   the config is added to the result list.
3. Iterates `additionalEntries` (the entries collected by `.addProject`
   calls on the builder). Each entry is conflict-checked against the
   workspace package names and normalized paths. A null return from
   `buildProject` for an added entry throws — added entries are
   explicit user intent and a silent skip would surprise the caller.
4. Materializes `tags` as a copy of `strategy.tagDefinitions`.

**Process-level cache.** Results are keyed by workspace root in a
module-local `Map`. The cache fires only when neither `strategy` nor
`additionalEntries` was supplied so a `DiscoverStrategy` instance never
has to be fingerprinted. Any explicit strategy or any `.addProject`
chain bypasses the cache.

The legacy `ProjectsCallback` argument and the `DiscoveryOptions` union
shape were dropped along with `VitestProject` and `TagStrategy`. Users
that want to mutate projects post-discovery either extend the strategy
(preferred) or destructure the result and mutate the array before
spreading it into `defineConfig`. `discoverProjects` itself is still
exported from `vitest-agent-plugin` but is internal-leaning; T9.6 is
expected to tighten the public surface to `AgentPlugin.discover()` as
the only documented entry point.

## Tag injection transform

`packages/plugin/src/utils/inject-tags.ts` plus the `transform` hook in
`AgentPlugin()`. Vitest 4.1's runner reads tags from `test()` / `it()`
options at parse time. The plugin installs a Vite `transform(code, id)`
hook that, for every test file id:

1. Calls `strategy.classify({ module })` to resolve the tag list for
   the file (for example, `["unit"]` for foo.test.ts, `["e2e"]` for
   foo.e2e.test.ts).
2. Returns null if the tag list is empty (no rewrite, no parse cost).
3. Parses with acorn plus acorn-typescript and walks every test and
   it call expression.
4. Uses magic-string to rewrite the options argument to merge in the
   resolved tags array. Source maps are preserved.

The classifier and the tag declarations both come from a single
`DiscoverStrategy` instance — supplied via the renamed
`discoverStrategy` plugin option (formerly `tagStrategy`). Pass false
to disable the transform entirely. `Tag` and the classifier helpers
are exported from the package for callers that want to compose the
classification side without reimplementing project detection. See
[./discover.md](./discover.md) for the full strategy API.

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
  `vitest-agent-plugin` so user wiring can name the shape directly.

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
- `find-test-files.ts` — async glob walker built on
  `node:fs/promises` with an inline glob-to-regex compiler. Skips
  `node_modules`, `.git`, and `dist` by default. Used by
  `DefaultDiscoverStrategy.buildProject` and exported as part of the
  public surface so user strategies can reuse it.
- `discover-projects.ts` — `discoverProjects` workspace scanner (see
  above).
- `tag.ts` — `Tag` class with `Tag.make` factory and name validation
  (rejects empty names, the reserved words and, or, not, and the
  forbidden characters open-paren, close-paren, ampersand, pipe,
  exclamation mark, asterisk plus whitespace).
- `inject-tags.ts` — AST rewriter built on acorn plus acorn-typescript
  plus magic-string. `injectTags(code, tags)` walks every test and it
  call expression and rewrites the options argument to merge the
  resolved tags array. Source maps are preserved. Used by the
  plugin's Vite transform hook.
- `strip-console-reporters.ts` — removes console reporters from Vitest's
  reporter chain.
- `resolve-thresholds.ts` — parses Vitest-native `coverage.thresholds` into
  `ResolvedThresholds`. Phase 4 dropped the `autoUpdate`-disable side
  effect; Vitest 2.0 owns the native ratchet and users opt in by passing
  one of `AgentPlugin.COVERAGE_AUTOUPDATE.{standard,strict,lenient}` into
  `coverage.thresholds.autoUpdate`.
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
  no-color flag. After T7 the input shape carries only `consoleMode`,
  `env`, and the plugin-resolved derived flags; `consoleOutput`,
  `omitPassingTests`, `coverageConsoleLimit`, `includeBareZero`,
  `githubSummary`, and `githubSummaryFile` are computed inside the kit
  builder from `consoleMode` and `process.env`. `transport` is a
  required input. The pre-bound `stdOsc8` is enabled when `!noColor &&
  (env === "terminal" || env === "agent-shell")` and is a no-op
  otherwise.
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

Vitest 2.0 owns its own threshold ratchet via `coverage.thresholds.autoUpdate`.
The plugin no longer mutates that field — Phase 4 dropped the
`autoUpdate`-disable side effect. Users who want auto-update behavior pass a
tolerance function from `AgentPlugin.COVERAGE_AUTOUPDATE` directly into
Vitest's native field; the plugin's own baseline ratchet still runs
unconditionally on full (non-scoped) runs and is independent of Vitest's
ratchet.

`coverageThresholds` is no longer a plugin option in any form — users
set Vitest's native `test.coverage.thresholds` directly. `coverageTargets`
remains a plugin option, typed by the SDK's `CoverageTargets` schema (now
in its own file at `packages/sdk/src/schemas/CoverageTargets.ts`). The
`ConfigValidation` service catches mismatches between the two surfaces.

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

### Rule registry (starter set)

Seven rules ship in the Live layer:

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

In Phase 4 the plugin's `configureVitest` hook replaced the inline
`resolveCoverageInput(coverageThresholds, ...)` + `validateCoverageConfig`
block with a `ConfigValidation.validate(...)` call:

- Warnings and info entries print to stderr through the
  `[vitest-agent:plugin]` prefix and do not fail the build.
- Errors throw via `formatFatalError`, which surfaces the entries
  including their `path` and `remediation` fields where present.

`coverageMode` is resolved from `vitestConfig.coverage?.enabled` and threaded
through `buildReporterKit` onto `ResolvedReporterConfig`. The kit-building
path is the only writer of `coverageMode` on the resolved kit.

There is an `@internal` `resolvedConfig` getter on `AgentReporter` (tagged
`@tag phase7-review`) so tests can verify mode threading. The
construction-time getter uses placeholder `executor: "ci"`; the real
executor resolves in `onTestRunEnd`. This is a Phase 7 follow-up.

## UI-only mode short-circuit in `onTestRunEnd`

Phase 5 added an early return on the UI-only path in `AgentReporter.onTestRunEnd`:

1. `RunFinished` still fires at the top of the handler so any live mount
   sees end-of-run before the heavy work would have started.
2. `filteredModules` is computed (the per-project filter still applies).
3. **If `opts.coverageMode === "ui-only"`**, the reporter:
   - Builds `AgentReport[]` from `testModules` via the pure
     `buildAgentReport` helper (no DB read, no classifier).
   - Runs a tiny Effect program against `OutputPipelineLive` +
     `NodeContext.layer` to resolve env, executor, format, and detail.
   - Builds the kit via `buildReporterKit` (carrying `coverageMode:
     "ui-only"` through onto `ResolvedReporterConfig`).
   - Calls the user's reporter factory with the kit and routes the
     returned `RenderedOutput[]` to its declared targets.
   - Returns. No `ensureMigrated`, no `DataStore.write*`, no
     `CoverageAnalyzer.process`, no `HistoryTracker.resolve`.
4. Otherwise the Full-mode pipeline runs end-to-end as before.

The streaming taps that drive a live renderer
(`onTestModuleQueued`, `onTestModuleStart`, `onTestCaseResult`,
`onTestModuleEnd`, plus the `RunFinished` emit at the top of `onTestRunEnd`)
fire identically in both modes — UI-only callers see the same event
stream as Full-mode callers, just without persistence side effects.

**Open follow-up.** The kit-building block (env/executor/format/detail
resolution, factory call, route) is duplicated between Full and UI-only
paths. Extracting a shared helper is viable but requires making the
kit-building Effect-context-agnostic. T7's options-cleanup pass touches
the reporter internals and is the natural place to fold this together.
