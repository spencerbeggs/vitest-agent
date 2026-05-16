# vitest-agent-sdk

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

* [`b5fb28f`](https://github.com/spencerbeggs/vitest-agent/commit/b5fb28f7e4f656fa48420051d1c97fbbe6e6320c) ### Package and directory renames

- `vitest-agent` (Vitest plugin) renamed to `vitest-agent-plugin`; update your `package.json` dependency and `vitest.config.ts` import accordingly
- `packages/agent/` moved to `packages/plugin/`; `packages/shared/` moved to `packages/sdk/`

* [`c055f7d`](https://github.com/spencerbeggs/vitest-agent/commit/c055f7dcceb90a13c6ebe7c8d6058804ca715d69) ### vitest-agent-ui public surface replaced

The previous renderer-facing exports are removed. Gone are the event-sourced reporter factory and its options type, the live Ink renderer factory and its options type, the live renderer class, the one-shot render-run helper plus its from-state variant, and the render-run mode and options types.

The new public surface is a preassembled default reporter (the value the plugin wires automatically), the dispatch-input builder, the cell-options resolver, and the per-report convenience helpers for agent-string and human-string output.

It also exposes the dispatcher entry points: single dispatch, Ink dispatch, the dispatcher table, the run-shape and outcome classifiers, the footer builder, and the dominant-classification helper. The dispatcher contract types are re-exported from the SDK so every package reads the same definitions.

* [`47e811f`](https://github.com/spencerbeggs/vitest-agent/commit/47e811f0640ea96e508904a53900ef435f242eab) ### `ConfigValidation` Effect service

A new service under `vitest-agent-plugin` runs at plugin init with a seven-rule starter registry: TARGET\_WITHOUT\_THRESHOLD warns, TARGET\_BELOW\_THRESHOLD errors, THRESHOLD\_WITHOUT\_TARGET is silent, INVALID\_TARGET\_VALUE errors with the offending path, UNSUPPORTED\_PROVIDER errors in Full mode, MISSING\_PROVIDER\_PACKAGE errors with the install command, PERFILE\_ON\_TARGETS warns. Warnings and info entries print through the plugin's stderr prefix; errors throw via `formatFatalError` and refuse to start the run. A test-layer factory accepts pre-built results for unit-test injection.

* [`14f9eca`](https://github.com/spencerbeggs/vitest-agent/commit/14f9ecae157bd148d2ce8529c066934561c4a266) ### Three classifier composition helpers

`classifyByFilename`, `classifyByDirectory`, and `combineClassifiers` ship as pure helpers from `vitest-agent-plugin`. `classifyByFilename` accepts a record of suffix strings or an array of regex tuples. `classifyByDirectory` matches relative paths with slash boundaries so a key like "integration" matches "src/integration/foo.test.ts" but not "my-integration-tests/foo.test.ts". `combineClassifiers` concatenates results in order and deduplicates by tag name, so chained classifiers can safely overlap.

* [`b5fb28f`](https://github.com/spencerbeggs/vitest-agent/commit/b5fb28f7e4f656fa48420051d1c97fbbe6e6320c) ### Playground sandbox

- Added `playground/` workspace with intentionally imperfect source (`math`, `strings`, `cache`, `Notebook`) as a live dogfooding target for the TDD orchestrator and MCP tools

* [`0a196c0`](https://github.com/spencerbeggs/vitest-agent/commit/0a196c04f78a84eb31d69d09156d014f9433ed73) Introduces the 2.0 data layer: XDG-based DB path resolution, 41-table SQLite schema, session/turn logging, TDD lifecycle tracking, and failure signature persistence.

- [`c055f7d`](https://github.com/spencerbeggs/vitest-agent/commit/c055f7dcceb90a13c6ebe7c8d6058804ca715d69) ### Shape-tailored dispatcher matrix

A new dispatch layer in vitest-agent-ui routes each rendered run by a run-shape and run-outcome pair to a dedicated cell that produces both an agent-oriented string and an Ink-tree variant.

Cells cover the single-test, single-file, single-project, and workspace shapes, crossed with the all-pass, some-fail, and threshold-violation outcomes.

Run shape and outcome are computed by classifier helpers exported alongside the dispatcher table and the dominant-classification helper used to pick a representative outcome when multiple are present.

* [`8bffd58`](https://github.com/spencerbeggs/vitest-agent/commit/8bffd58be1ab3ea5151e57b4d63eb0196245a4c2) ### Three-tier goal/behavior hierarchy

`vitest-agent-sdk` defines the new entity tiers. `tdd_session_goals` stores coherent slices of an objective; `tdd_session_behaviors` stores atomic red-green-refactor units under a goal; `tdd_behavior_dependencies` records ordering constraints without JSON-in-TEXT. Status lifecycle is `pending → in_progress → done | abandoned`; deletes are reserved for cleanup of mistakes and `abandoned` is the normal way to drop work.

* [`01df6ba`](https://github.com/spencerbeggs/vitest-agent/commit/01df6ba7ce3daf0f1ffa19f0e170b0154800f936) ### Cross-package version constants

Exports CURRENT\_SDK\_VERSION, a build-time string constant injected from package.json at compile time. The value is guaranteed non-empty and is used by peer packages to verify lockstep installation.

A shared shape test asserts that all six version constants are non-empty strings and that every peer constant equals CURRENT\_SDK\_VERSION, surfacing version drift before it causes runtime confusion.

* [`14f9eca`](https://github.com/spencerbeggs/vitest-agent/commit/14f9ecae157bd148d2ce8529c066934561c4a266) ### AgentPlugin.runScript()

New `AgentPlugin.runScript(command)` static method runs a shell command silently. Output is suppressed on success; stdout and stderr are surfaced only if the command exits non-zero. Designed for use in Vitest `globalSetup` files to build packages before the test run without polluting agent context:

```ts
// vitest.setup.ts
import { AgentPlugin } from "vitest-agent-plugin";
export function setup() {
  AgentPlugin.runScript(
    "pnpm exec turbo run build:dev --output-logs=errors-only",
  );
}
```

* [`0884572`](https://github.com/spencerbeggs/vitest-agent/commit/088457230bf26a3a65e41e8daff862be7fa080f6) ### TDD session run ID

`tdd_session_start` now accepts an optional `runId` string. When provided, it is stored on the session and returned in `tdd_session_get` output. The idempotency cache key includes both the session identifier and `runId` (e.g. `cc:<ccSessionId>:run:<runId>`), so dispatching the same goal text with a fresh `runId` creates an independent session rather than replaying the cached result from a prior ended session.

The `run_id` column is added to the `tdd_sessions` table with a partial unique index on `(session_id, run_id) WHERE run_id IS NOT NULL`, replacing the previous `UNIQUE(session_id, goal)` constraint. This allows repeated lifecycle runs without goal-text disambiguation workarounds.

* [`324b242`](https://github.com/spencerbeggs/vitest-agent/commit/324b2427502792a403570beb7d2b3c5f57fb2207) ### `tdd_phase_transition_request` auto-resolves the cited artifact

`citedArtifactId` is now optional. When the caller omits it, the tool resolves the most recent matching artifact for the session, with the kind drawn from one of three sources (priority order):

1. An explicit `citedArtifactKind` argument.
2. The kind required by the transition itself (per `requiredArtifactForTransition`: `test_failed_run` for `red→green`, `test_passed_run` for `green→refactor` and `refactor→red`).
3. None — for transitions like `spike→red` that the validator accepts without an artifact, the citation step is skipped entirely.

When the auto-resolve can't find a matching artifact, the tool returns the existing `missing_artifact_evidence` denial with a remediation pointing at `run_tests`. The accepted response now also echoes `citedArtifactId` and `citedArtifactSource` (`explicit-id` | `explicit-kind` | `transition-derived` | `none`) so callers can confirm which row was used.

This removes the per-transition `tdd_artifact_list` lookup that the orchestrator was making before every phase transition — the most common round-trip in the TDD loop.

The SDK helper `requiredArtifactForTransition` is now exported from `vitest-agent-sdk` so the MCP tool (and any future tool surface) can pre-compute the expected kind without duplicating the validator's rule table.

* [`324b242`](https://github.com/spencerbeggs/vitest-agent/commit/324b2427502792a403570beb7d2b3c5f57fb2207) ### Schema-driven MCP tool outputs with `structuredContent`

29 MCP tools now emit dual-channel responses per MCP 2025-06-18: human-readable markdown in `content[]` and a typed JSON object in `structuredContent`. Each tool declares an `outputSchema` derived from an Effect Schema, so clients can validate the structured payload against a discoverable contract instead of parsing markdown.

A new `structuredResult(text, data)` helper in `packages/mcp/src/server.ts` produces both channels from a single source-of-truth Schema, and `Schema.transformOrFail` codecs render markdown one-way from the typed payload. JSON Schema annotations (`title`, `description`, `examples`) survive the round trip so agents see field hints in the tool listing.

* [`324b242`](https://github.com/spencerbeggs/vitest-agent/commit/324b2427502792a403570beb7d2b3c5f57fb2207) ### `DataStore.upsertSession` (idempotent insert)

The data layer gains `upsertSession(input)` alongside the existing `writeSession`. Implemented as `INSERT … ON CONFLICT(cc_session_id) DO NOTHING` followed by `SELECT id`, so concurrent SessionStart hook invocations and lazy bootstrap calls land on the same row id without race conditions. `record session-start` now uses this internally; repeated invocations no longer error on `UNIQUE` constraint violations.

* [`324b242`](https://github.com/spencerbeggs/vitest-agent/commit/324b2427502792a403570beb7d2b3c5f57fb2207) ### `tdd_artifact_list` MCP tool

A new read-only MCP tool, `tdd_artifact_list({ tddSessionId, artifactKind?, phaseId?, behaviorId?, limit?, format? })`, returns the artifacts recorded for a TDD session in newest-first order. Lets the orchestrator answer "what's the artifact id I should cite for this phase transition?" without shelling out to `sqlite3`. Markdown output prominently shows `[id=N]` and `[phaseId=N]` so the value can be lifted directly into a follow-up `tdd_phase_transition_request` call. JSON output is available via `format: "json"`.

The SDK gains a matching `DataReader.listTddArtifactsForSession` method.

* [`8bffd58`](https://github.com/spencerbeggs/vitest-agent/commit/8bffd58be1ab3ea5151e57b4d63eb0196245a4c2) ### Removed `decompose_goal_into_behaviors` MCP tool

Server-side goal-string-splitting is removed. The orchestrator now decomposes via LLM reasoning and creates each entity individually through `tdd_goal_create` and `tdd_behavior_create`. Callers using the old tool will get an unknown-procedure error from the MCP router.

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

* [`0884572`](https://github.com/spencerbeggs/vitest-agent/commit/088457230bf26a3a65e41e8daff862be7fa080f6) Migrations 0003 (`mcp_idempotent_responses`), 0004 (`test_cases.created_turn_id`), 0005 (`failure_signatures.last_seen_at`), and 0006 (`tdd_sessions.run_id`) are folded into `0002_comprehensive` in-place. The four individual migration files are deleted. All consumers (`CliLive`, `McpLive`, `ReporterLive`, `DataStoreTest`, `ensure-migrated`) updated to reference only `0001` and `0002`. Existing development databases must be deleted and recreated — no production databases exist prior to the 2.0 release.

- Config file renamed from `vitest-agent-reporter.config.toml` to `vitest-agent.config.toml`
- XDG data directory changed from `~/.local/share/vitest-agent-reporter/` to `~/.local/share/vitest-agent/`; existing databases are not migrated automatically
- `VitestAgentReporterConfig` renamed to `VitestAgentConfig`; `VitestAgentReporterConfigFile` renamed to `VitestAgentConfigFile`
- Effect `Context.Tag` keys updated from `"vitest-agent-reporter/*"` to `"vitest-agent/*"`

### Features

* [`b5fb28f`](https://github.com/spencerbeggs/vitest-agent/commit/b5fb28f7e4f656fa48420051d1c97fbbe6e6320c) ### Playground sandbox

- Added `playground/` workspace with intentionally imperfect source (`math`, `strings`, `cache`, `Notebook`) as a live dogfooding target for the TDD orchestrator and MCP tools

### Features

* [`c055f7d`](https://github.com/spencerbeggs/vitest-agent/commit/c055f7dcceb90a13c6ebe7c8d6058804ca715d69) ### Shape-tailored dispatcher matrix

A new dispatch layer in vitest-agent-ui routes each rendered run by a run-shape and run-outcome pair to a dedicated cell that produces both an agent-oriented string and an Ink-tree variant.

Cells cover the single-test, single-file, single-project, and workspace shapes, crossed with the all-pass, some-fail, and threshold-violation outcomes.

Run shape and outcome are computed by classifier helpers exported alongside the dispatcher table and the dominant-classification helper used to pick a representative outcome when multiple are present.

### Features

* [`8bffd58`](https://github.com/spencerbeggs/vitest-agent/commit/8bffd58be1ab3ea5151e57b4d63eb0196245a4c2) ### Three-tier goal/behavior hierarchy

`vitest-agent-sdk` defines the new entity tiers. `tdd_session_goals` stores coherent slices of an objective; `tdd_session_behaviors` stores atomic red-green-refactor units under a goal; `tdd_behavior_dependencies` records ordering constraints without JSON-in-TEXT. Status lifecycle is `pending → in_progress → done | abandoned`; deletes are reserved for cleanup of mistakes and `abandoned` is the normal way to drop work.

### Features

* [`324b242`](https://github.com/spencerbeggs/vitest-agent/commit/324b2427502792a403570beb7d2b3c5f57fb2207) ### `DataStore.upsertSession` (idempotent insert)

The data layer gains `upsertSession(input)` alongside the existing `writeSession`. Implemented as `INSERT … ON CONFLICT(cc_session_id) DO NOTHING` followed by `SELECT id`, so concurrent SessionStart hook invocations and lazy bootstrap calls land on the same row id without race conditions. `record session-start` now uses this internally; repeated invocations no longer error on `UNIQUE` constraint violations.

### Features

* [`324b242`](https://github.com/spencerbeggs/vitest-agent/commit/324b2427502792a403570beb7d2b3c5f57fb2207) ### `tdd_artifact_list` MCP tool

A new read-only MCP tool, `tdd_artifact_list({ tddSessionId, artifactKind?, phaseId?, behaviorId?, limit?, format? })`, returns the artifacts recorded for a TDD session in newest-first order. Lets the orchestrator answer "what's the artifact id I should cite for this phase transition?" without shelling out to `sqlite3`. Markdown output prominently shows `[id=N]` and `[phaseId=N]` so the value can be lifted directly into a follow-up `tdd_phase_transition_request` call. JSON output is available via `format: "json"`.

The SDK gains a matching `DataReader.listTddArtifactsForSession` method.

### Bug Fixes

Recording paths (`record turn`, `record tdd-artifact`) no longer fail with `Unknown cc_session_id` when Claude Code rotates the host session id mid-window (continuation, compaction, MCP reconnect) without re-firing `SessionStart` for the new id. A new three-step session resolver in the CLI lib falls through exact match → subagent-prefix fallback → idempotent bootstrap, so a missing main session row self-heals on first hook invocation.

The phase-transition validator can now find evidence written under subagent rows whose tdd\_session lives under the parent main row. `DataReader.listTddSessionsForSession` accepts a `walkParents: true` option that traverses `sessions.parent_session_id` (bounded to 64 hops, cycle-safe). Before this fix, dispatching the TDD orchestrator as a subagent caused every `red → green` transition to fail with `missing_artifact_evidence` because artifacts and tdd\_sessions landed on different session rows.

The `subagent-start-tdd.sh` plugin hook now pre-bootstraps the parent main row before creating the subagent row, and unconditionally sets `parent_session_id` from the orchestrator's host session id. The earlier conditional check on the hook payload's `parent_session_id` field was unreliable because Claude Code does not consistently populate that field for `context: fork` dispatches.

### Documentation

* [`324b242`](https://github.com/spencerbeggs/vitest-agent/commit/324b2427502792a403570beb7d2b3c5f57fb2207) ### `tdd-task` subagent prompt updated

29 MCP tools now emit dual-channel responses per MCP 2025-06-18: human-readable markdown in `content[]` and a typed JSON object in `structuredContent`. Each tool declares an `outputSchema` derived from an Effect Schema, so clients can validate the structured payload against a discoverable contract instead of parsing markdown.

A new `structuredResult(text, data)` helper in `packages/mcp/src/server.ts` produces both channels from a single source-of-truth Schema, and `Schema.transformOrFail` codecs render markdown one-way from the typed payload. JSON Schema annotations (`title`, `description`, `examples`) survive the round trip so agents see field hints in the tool listing.

### Documentation

* [`324b242`](https://github.com/spencerbeggs/vitest-agent/commit/324b2427502792a403570beb7d2b3c5f57fb2207) ### `tdd-task` subagent — explicit data-lookup guidance

The `tdd-task` subagent prompt (`plugin/agents/tdd-task.md`) gained a "Data lookup — use these MCP tools, do NOT shell out to sqlite3" section that maps the eleven most common questions the orchestrator asks ("what's my current phase id?", "what's the most recent test\_failed\_run?", etc.) to the specific tool that answers each one. The section also explicitly licenses exploratory tool use when the table doesn't cover a question. The existing DATABASE\_BYPASS anti-pattern entry was tightened to point at the new map.

### Refactoring

```ts
// vitest.setup.ts
import { AgentPlugin } from "vitest-agent-plugin";
export function setup() {
  AgentPlugin.runScript(
    "pnpm exec turbo run build:dev --output-logs=errors-only",
  );
}
```

### Refactoring

* [`324b242`](https://github.com/spencerbeggs/vitest-agent/commit/324b2427502792a403570beb7d2b3c5f57fb2207) ### `record turn` and `record tdd-artifact` CLI flags

The `--project` and `--cwd` options on these subcommands are now optional. When omitted, the lib resolves `project` from `package.json#name` in `cwd` and `cwd` from `process.cwd()`. Hook scripts that call these subcommands without the flags continue to work unchanged.

### `PluginMode` and `ConsoleStrategy` schemas removed from the SDK

The two literal-union schemas are gone. In their place: `HumanConsoleMode`, `AgentConsoleMode`, `CiConsoleMode`, and the umbrella `ConsoleMode` union (re-exported from `vitest-agent-sdk`).

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

Each named preset returns `{ thresholds, coverageTargets }` instead of a `CoverageLevel` instance. The thresholds half carries the same numbers the prior `CoverageLevel.<preset>` exposed; the coverageTargets half is the next-preset-up's numbers, capped at `full`. `COVERAGE_LEVELS_PER_FILE` applies `perFile: true` only on the thresholds half.

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

### CLI bin

* Binary renamed from `vitest-agent-reporter` to `vitest-agent`; update any scripts or CI steps that invoke it

### Claude Code plugin

* Plugin name changed from `"vitest-agent-reporter"` to `"vitest-agent"`; reinstall the plugin to pick up the new manifest
* MCP server key changed from `"vitest-reporter"` to `"mcp"`

### AgentPlugin options

* The `reporter` field in `AgentPlugin({})` is now typed as a factory function only; pass coverage thresholds and other config bag options under `reporterOptions` instead

### vitest-agent-plugin default reporter and live-event behavior

* [`324b242`](https://github.com/spencerbeggs/vitest-agent/commit/324b2427502792a403570beb7d2b3c5f57fb2207) ### `record turn` and `record tdd-artifact` CLI flags

The `--project` and `--cwd` options on these subcommands are now optional. When omitted, the lib resolves `project` from `package.json#name` in `cwd` and `cwd` from `process.cwd()`. Hook scripts that call these subcommands without the flags continue to work unchanged.

The reporter option on the plugin factory now defaults to the new built-in. The live event tap is forwarded for every console mode, not just the Ink mode it was previously gated to.

A throwing user tap is caught and logged to stderr so a buggy live subscriber no longer breaks persistence. The plugin also adds vitest-agent-ui as a workspace dependency so consumers do not install the UI package directly.

### vitest-agent-cli show command renders one aggregate frame

The show subcommand now emits a single workspace-aggregate frame for multi-project runs instead of one frame per project. The formatter behind it is now async.

### L1 MCP tool-pointer footer

Every dispatched render appends a footer that points at the MCP tool best suited to the agent's next action.

All-pass runs with a coverage gap surface the per-file coverage tool. Some-fail runs surface the test-errors tool together with the failure-signature lookup tool when the failure is classified as new or persistent, or the failure-signature lookup tool alone when the failure is flaky.

Threshold-violation runs surface the test-coverage tool.

### Dispatcher contract types in vitest-agent-sdk

New contract types live under the dispatcher contracts module in the SDK: the run-shape and run-outcome enums, a project-summary record, a trend-summary record, the dispatch-input type passed to every cell, and a cell-options record covering optional renderer flags.

The SDK re-exports these from its root so plugin, reporter, UI, and CLI all read the same definitions.

### Per-report convenience helpers

* [`324b242`](https://github.com/spencerbeggs/vitest-agent/commit/324b2427502792a403570beb7d2b3c5f57fb2207) ### `Schema.Union` outputs no longer crash with `_zod` undefined

Before the bridge wrap, every tool whose output Schema was a `Schema.Union` (`inventory`, `test_status`, `cache_health`, `tdd_task`, several others) crashed at runtime with `Cannot read properties of undefined (reading '_zod')` because the MCP SDK's output validator could not unwrap the union into an object schema. The wrap preserves the structured payload contract while satisfying the SDK's object-only requirement.

* [`324b242`](https://github.com/spencerbeggs/vitest-agent/commit/324b2427502792a403570beb7d2b3c5f57fb2207) ### TDD artifact binding survives `cc_session_id` rotation and orphaned subagent rows

Recording paths (`record turn`, `record tdd-artifact`) no longer fail with `Unknown cc_session_id` when Claude Code rotates the host session id mid-window (continuation, compaction, MCP reconnect) without re-firing `SessionStart` for the new id. A new three-step session resolver in the CLI lib falls through exact match → subagent-prefix fallback → idempotent bootstrap, so a missing main session row self-heals on first hook invocation.

The phase-transition validator can now find evidence written under subagent rows whose tdd\_session lives under the parent main row. `DataReader.listTddSessionsForSession` accepts a `walkParents: true` option that traverses `sessions.parent_session_id` (bounded to 64 hops, cycle-safe). Before this fix, dispatching the TDD orchestrator as a subagent caused every `red → green` transition to fail with `missing_artifact_evidence` because artifacts and tdd\_sessions landed on different session rows.

The `subagent-start-tdd.sh` plugin hook now pre-bootstraps the parent main row before creating the subagent row, and unconditionally sets `parent_session_id` from the orchestrator's host session id. The earlier conditional check on the hook payload's `parent_session_id` field was unreliable because Claude Code does not consistently populate that field for `context: fork` dispatches.

### `tdd_phase_transition_request` requires `goalId` and an explicit `red` phase

The input schema gains a required `goalId: number`. Existing callers that pass only `tddSessionId`, `requestedPhase`, and `citedArtifactId` will fail validation. Pass the parent goal's id alongside; the tool now also pre-validates that the goal status is `in_progress` and that any cited `behaviorId` belongs to the named goal.

Additionally, transitions to `green` are now rejected unless the current phase is `red`, `red.triangulate`, or `green.fake-it`. Callers that previously relied on `spike→green` or `refactor→green` "free transitions" will receive a `wrong_source_phase` denial with a remediation hint pointing at `requestedPhase: "red"`. The `red` phase must now be an explicit named DB row in every TDD cycle.

### Reshaped `tdd_session_behaviors` schema

The behaviors table no longer has `parent_tdd_session_id`, `child_tdd_session_id`, or `depends_on_behavior_ids`. It now references the new `tdd_session_goals` table via `goal_id NOT NULL`, with dependencies stored in a separate `tdd_behavior_dependencies` junction table. `tdd_phases.behavior_id` cascade changed from `SET NULL` to `CASCADE`. `tdd_artifacts` gains a `behavior_id` column for behavior-scoped queries. Pre-2.0 dev databases must be wiped on first pull (the migration ledger has no content hash, so editing `0002_comprehensive` in place does not auto-replay).

### Removed `writeTddSessionBehaviors` from DataStore

The batch behavior-insert path is gone alongside the tool that drove it. Use `createBehavior` per behavior instead.

### 10 new MCP CRUD tools

* `tdd_goal_create` (idempotent on `(sessionId, goal)`), `tdd_goal_get`, `tdd_goal_update`, `tdd_goal_delete`, `tdd_goal_list`.
* `tdd_behavior_create` (idempotent on `(goalId, behavior)`), `tdd_behavior_get`, `tdd_behavior_update`, `tdd_behavior_delete`, `tdd_behavior_list` (discriminated input: `{ scope: "goal" | "session", ... }`).
* Read tools return the full nested shape (goals with nested behaviors; behaviors with parentGoal summary and dependency list) so an agent can analyze a session in one round trip.
* Errors return as `{ ok: false, error: { _tag, ..., remediation } }` success-shape envelopes — never tRPC error envelopes.

### Tagged error API for goal/behavior CRUD

* [`324b242`](https://github.com/spencerbeggs/vitest-agent/commit/324b2427502792a403570beb7d2b3c5f57fb2207) ### `tdd-task` subagent — explicit data-lookup guidance

The `tdd-task` subagent prompt (`plugin/agents/tdd-task.md`) gained a "Data lookup — use these MCP tools, do NOT shell out to sqlite3" section that maps the eleven most common questions the orchestrator asks ("what's my current phase id?", "what's the most recent test\_failed\_run?", etc.) to the specific tool that answers each one. The section also explicitly licenses exploratory tool use when the table doesn't cover a question. The existing DATABASE\_BYPASS anti-pattern entry was tightened to point at the new map.

`vitest-agent-sdk` exports `GoalNotFoundError`, `BehaviorNotFoundError`, `TddSessionNotFoundError`, `TddSessionAlreadyEndedError`, and `IllegalStatusTransitionError`. Each carries a derived message and is surfaced through the MCP envelope shape with a remediation hint pointing the caller at the right recovery tool.

### `tdd_session_get` renders Goals and Behaviors

The main-agent skill (`plugin/skills/tdd/SKILL.md`) takes ownership of channel-event handling and renders the goal+behavior hierarchy flat with `[G<n>.B<m>]` label encoding (Claude Code's `TaskCreate` does not nest cleanly past one parent). Goals appear as marker tasks (`--- Goal N done ---`) inserted between behavior groups. `goal_completed` and `session_complete` carry reconciliation arrays so the renderer is order-independent against dropped intermediate events.

### vitest-agent-sdk/testing subpath

New `vitest-agent-sdk/testing` subpath export provides test-layer utilities and seeded fixture factories for integration tests:

`DataStore.RegisterAgentInput` accepts an optional `agentId` field; the sidecar passes the `main_agent_id` returned from `PerClientSessionMapWriter.mapSession()` so the per-project `agents` row id matches the value the SessionStart hook exports as `VITEST_AGENT_MAIN_AGENT_ID` and `VITEST_AGENT_AGENT_ID`. `test_runs.agent_id` rows now join back to a real `agents` row instead of dangling.

### MCP `run_tests`: inject session attribution from a PreToolUse hook

A new PreToolUse hook, `pre-tool-use-mcp-run-tests.sh`, matches `mcp__plugin_vitest-agent_mcp__run_tests` and injects a `_sessionContext` object into the tool input by sourcing the per-session env-files dir. The MCP tool prefers `input._sessionContext` over its boot-time `SessionContextRef`, working around the fact that Claude Code does not auto-source `CLAUDE_ENV_FILE` into MCP server children. Test runs initiated from the MCP tool are now attributed to the active agent.

### Surface collection-failed test files in `run_tests` output

When a test file fails to import — missing module, syntax error, or `beforeAll` throw — Vitest produced a `TestModule` with `state() === 'failed'`, zero collected tests, and the load error in `errors()`. `buildAgentReport` previously dropped these modules silently because `moduleHasFailure` only flipped on a failed test case; the MCP markdown formatter then reported the run as `0 passed` with a misleading `✅` headline. The reporter now includes collection-failed modules in `failed[]`, and the formatter renders a `Module failed to load` block plus a `N failed to load` tally in the headline. The headline status flips to `❌` for any collection failure or unhandled error, keeping the post-tool-use TDD artifact hook from misclassifying these runs as passes.

When the auto-resolve can't find a matching artifact, the tool returns the existing `missing_artifact_evidence` denial with a remediation pointing at `run_tests`. The accepted response now also echoes `citedArtifactId` and `citedArtifactSource` (`explicit-id` | `explicit-kind` | `transition-derived` | `none`) so callers can confirm which row was used.

This removes the per-transition `tdd_artifact_list` lookup that the orchestrator was making before every phase transition — the most common round-trip in the TDD loop.

The SDK helper `requiredArtifactForTransition` is now exported from `vitest-agent-sdk` so the MCP tool (and any future tool surface) can pre-compute the expected kind without duplicating the validator's rule table.

### `test_errors` surfaces cite-able IDs and gains an XML output mode

The `test_errors` tool now returns `test_errors.id` and the top stack frame's `stack_frames.id` (`topStackFrameId`) alongside each error. These are the values `hypothesis (action: record)` requires as `citedTestErrorId` and `citedStackFrameId`; the previous markdown output omitted them, forcing the orchestrator to hand-wave the citation.

A new `format` argument accepts `"markdown"` (default, with `[testErrorId=N topStackFrameId=N]` heading tokens plus a dedicated "Cite-able IDs" block) or `"xml"` (a `<test_errors>` document with one `<error id="..." topStackFrameId="...">` element per error). XML is recommended when the agent is going to extract IDs programmatically — Anthropic's prompt-engineering guidance is that Claude parses XML-tagged regions more reliably than ad-hoc markdown.

The XML formatter strips XML 1.0 illegal control chars (everything below 0x20 except tab/CR/LF) before escaping the five metacharacters, so the output is always well-formed regardless of what the test error message contains.

The SDK's `TestError` row type gains `id: number` and `topStackFrameId: number | null` fields; `DataReader.getErrors` joins `stack_frames` at `ordinal = 0` to surface the latter.

### Effect Schema to zod bridge

A new `packages/mcp/src/utils/effect-to-zod.ts` bridges Effect Schema to zod via `JSONSchema.make` plus zod 4's experimental `z.fromJSONSchema`, so the MCP SDK still receives the zod schema it expects in `outputSchema`. The bridge inlines `$ref`s recursively before handing the document to zod (zod 4's `fromJSONSchema` does not resolve refs), and wraps non-object roots in `z.object({}).catchall(z.unknown())` because the SDK's `normalizeObjectSchema` rejects `ZodUnion` outputs.

### `DataReader.findSessionsByCcPrefix`

New read query that returns session rows whose `cc_session_id` begins with a given prefix, newest first. The CLI session resolver uses it to recover the synthetic subagent row when a hook fires under the bare parent host id.

### `tdd_task get` surfaces the current phase id

The `tdd_task` tool's `get` action now includes a `current phase: <name> [phaseId=N]` line near the top of its markdown output. Previously the agent had to scan the full `## Phases` block looking for the entry without an `→` arrow, or query the database directly. The phaseId is the value `tdd_phase_transition_request` and `tdd_artifact_list` accept.
