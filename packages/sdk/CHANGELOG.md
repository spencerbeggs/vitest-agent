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

### Features

* [`b5fb28f`](https://github.com/spencerbeggs/vitest-agent/commit/b5fb28f7e4f656fa48420051d1c97fbbe6e6320c) ### Playground sandbox

- Added `playground/` workspace with intentionally imperfect source (`math`, `strings`, `cache`, `Notebook`) as a live dogfooding target for the TDD orchestrator and MCP tools

### Features

Additionally, transitions to `green` are now rejected unless the current phase is `red`, `red.triangulate`, or `green.fake-it`. Callers that previously relied on `spike→green` or `refactor→green` "free transitions" will receive a `wrong_source_phase` denial with a remediation hint pointing at `requestedPhase: "red"`. The `red` phase must now be an explicit named DB row in every TDD cycle.

### Features

* [`8bffd58`](https://github.com/spencerbeggs/vitest-agent/commit/8bffd58be1ab3ea5151e57b4d63eb0196245a4c2) ### Three-tier goal/behavior hierarchy

`vitest-agent-sdk` defines the new entity tiers. `tdd_session_goals` stores coherent slices of an objective; `tdd_session_behaviors` stores atomic red-green-refactor units under a goal; `tdd_behavior_dependencies` records ordering constraints without JSON-in-TEXT. Status lifecycle is `pending → in_progress → done | abandoned`; deletes are reserved for cleanup of mistakes and `abandoned` is the normal way to drop work.

### Features

* [`324b242`](https://github.com/spencerbeggs/vitest-agent/commit/324b2427502792a403570beb7d2b3c5f57fb2207) ### Schema-driven MCP tool outputs with `structuredContent`

29 MCP tools now emit dual-channel responses per MCP 2025-06-18: human-readable markdown in `content[]` and a typed JSON object in `structuredContent`. Each tool declares an `outputSchema` derived from an Effect Schema, so clients can validate the structured payload against a discoverable contract instead of parsing markdown.

### Features

* [`324b242`](https://github.com/spencerbeggs/vitest-agent/commit/324b2427502792a403570beb7d2b3c5f57fb2207) ### `tdd_artifact_list` MCP tool

A new read-only MCP tool, `tdd_artifact_list({ tddSessionId, artifactKind?, phaseId?, behaviorId?, limit?, format? })`, returns the artifacts recorded for a TDD session in newest-first order. Lets the orchestrator answer "what's the artifact id I should cite for this phase transition?" without shelling out to `sqlite3`. Markdown output prominently shows `[id=N]` and `[phaseId=N]` so the value can be lifted directly into a follow-up `tdd_phase_transition_request` call. JSON output is available via `format: "json"`.

The SDK gains a matching `DataReader.listTddArtifactsForSession` method.

### Bug Fixes

* [`324b242`](https://github.com/spencerbeggs/vitest-agent/commit/324b2427502792a403570beb7d2b3c5f57fb2207) ### `Schema.Union` outputs no longer crash with `_zod` undefined

Before the bridge wrap, every tool whose output Schema was a `Schema.Union` (`inventory`, `test_status`, `cache_health`, `tdd_task`, several others) crashed at runtime with `Cannot read properties of undefined (reading '_zod')` because the MCP SDK's output validator could not unwrap the union into an object schema. The wrap preserves the structured payload contract while satisfying the SDK's object-only requirement.

### Bug Fixes

* [`324b242`](https://github.com/spencerbeggs/vitest-agent/commit/324b2427502792a403570beb7d2b3c5f57fb2207) ### TDD artifact binding survives `cc_session_id` rotation and orphaned subagent rows

- [`324b242`](https://github.com/spencerbeggs/vitest-agent/commit/324b2427502792a403570beb7d2b3c5f57fb2207) ### `DataStore.upsertSession` (idempotent insert)

The data layer gains `upsertSession(input)` alongside the existing `writeSession`. Implemented as `INSERT … ON CONFLICT(cc_session_id) DO NOTHING` followed by `SELECT id`, so concurrent SessionStart hook invocations and lazy bootstrap calls land on the same row id without race conditions. `record session-start` now uses this internally; repeated invocations no longer error on `UNIQUE` constraint violations.

### Documentation

* [`324b242`](https://github.com/spencerbeggs/vitest-agent/commit/324b2427502792a403570beb7d2b3c5f57fb2207) ### `tdd-task` subagent prompt updated

The data-lookup table in `plugin/agents/tdd-task.md` now points at `test_errors({ project, format: "xml" })` for ID extraction. The "Phase transition" section explains that `citedArtifactId` is optional and how to use `citedArtifactKind` when explicit kind selection is desired. The RED→GREEN step in the workflow no longer prescribes a hard-coded `citedArtifactId: <the test_failed_run id>` value.

### Documentation

* [`324b242`](https://github.com/spencerbeggs/vitest-agent/commit/324b2427502792a403570beb7d2b3c5f57fb2207) ### `tdd-task` subagent — explicit data-lookup guidance

The `tdd-task` subagent prompt (`plugin/agents/tdd-task.md`) gained a "Data lookup — use these MCP tools, do NOT shell out to sqlite3" section that maps the eleven most common questions the orchestrator asks ("what's my current phase id?", "what's the most recent test\_failed\_run?", etc.) to the specific tool that answers each one. The section also explicitly licenses exploratory tool use when the table doesn't cover a question. The existing DATABASE\_BYPASS anti-pattern entry was tightened to point at the new map.

### Refactoring

* [`8bffd58`](https://github.com/spencerbeggs/vitest-agent/commit/8bffd58be1ab3ea5151e57b4d63eb0196245a4c2) ### Single-statement ordinal allocation

`createGoal` and `createBehavior` allocate ordinals via a single `INSERT ... SELECT COALESCE(MAX(ordinal), -1) + 1 ...` statement so concurrent inserts under one parent never collide without needing `BEGIN IMMEDIATE`.

* [`14f9eca`](https://github.com/spencerbeggs/vitest-agent/commit/14f9ecae157bd148d2ce8529c066934561c4a266) ### AgentPlugin.runScript()

New `AgentPlugin.runScript(command)` static method runs a shell command silently. Output is suppressed on success; stdout and stderr are surfaced only if the command exits non-zero. Designed for use in Vitest `globalSetup` files to build packages before the test run without polluting agent context:

The `run_id` column is added to the `tdd_sessions` table with a partial unique index on `(session_id, run_id) WHERE run_id IS NOT NULL`, replacing the previous `UNIQUE(session_id, goal)` constraint. This allows repeated lifecycle runs without goal-text disambiguation workarounds.

### Refactoring

* [`324b242`](https://github.com/spencerbeggs/vitest-agent/commit/324b2427502792a403570beb7d2b3c5f57fb2207) ### `record turn` and `record tdd-artifact` CLI flags

The `--project` and `--cwd` options on these subcommands are now optional. When omitted, the lib resolves `project` from `package.json#name` in `cwd` and `cwd` from `process.cwd()`. Hook scripts that call these subcommands without the flags continue to work unchanged.

### Maintenance

`citedArtifactId` is now optional. When the caller omits it, the tool resolves the most recent matching artifact for the session, with the kind drawn from one of three sources (priority order):

1. An explicit `citedArtifactKind` argument.
2. The kind required by the transition itself (per `requiredArtifactForTransition`: `test_failed_run` for `red→green`, `test_passed_run` for `green→refactor` and `refactor→red`).
3. None — for transitions like `spike→red` that the validator accepts without an artifact, the citation step is skipped entirely.

The `test_errors` tool now returns `test_errors.id` and the top stack frame's `stack_frames.id` (`topStackFrameId`) alongside each error. These are the values `hypothesis (action: record)` requires as `citedTestErrorId` and `citedStackFrameId`; the previous markdown output omitted them, forcing the orchestrator to hand-wave the citation.

A new `format` argument accepts `"markdown"` (default, with `[testErrorId=N topStackFrameId=N]` heading tokens plus a dedicated "Cite-able IDs" block) or `"xml"` (a `<test_errors>` document with one `<error id="..." topStackFrameId="...">` element per error). XML is recommended when the agent is going to extract IDs programmatically — Anthropic's prompt-engineering guidance is that Claude parses XML-tagged regions more reliably than ad-hoc markdown.

The XML formatter strips XML 1.0 illegal control chars (everything below 0x20 except tab/CR/LF) before escaping the five metacharacters, so the output is always well-formed regardless of what the test error message contains.

The SDK's `TestError` row type gains `id: number` and `topStackFrameId: number | null` fields; `DataReader.getErrors` joins `stack_frames` at `ordinal = 0` to surface the latter.

### `PluginMode` and `ConsoleStrategy` schemas removed from the SDK

The two literal-union schemas are gone. In their place: `HumanConsoleMode`, `AgentConsoleMode`, `CiConsoleMode`, and the umbrella `ConsoleMode` union (re-exported from `vitest-agent-sdk`).

* [`47e811f`](https://github.com/spencerbeggs/vitest-agent/commit/47e811f0640ea96e508904a53900ef435f242eab) ### `ConfigValidation` Effect service

A new service under `vitest-agent-plugin` runs at plugin init with a seven-rule starter registry: TARGET\_WITHOUT\_THRESHOLD warns, TARGET\_BELOW\_THRESHOLD errors, THRESHOLD\_WITHOUT\_TARGET is silent, INVALID\_TARGET\_VALUE errors with the offending path, UNSUPPORTED\_PROVIDER errors in Full mode, MISSING\_PROVIDER\_PACKAGE errors with the install command, PERFILE\_ON\_TARGETS warns. Warnings and info entries print through the plugin's stderr prefix; errors throw via `formatFatalError` and refuse to start the run. A test-layer factory accepts pre-built results for unit-test injection.

* [`14f9eca`](https://github.com/spencerbeggs/vitest-agent/commit/14f9ecae157bd148d2ce8529c066934561c4a266) ### Three classifier composition helpers

`classifyByFilename`, `classifyByDirectory`, and `combineClassifiers` ship as pure helpers from `vitest-agent-plugin`. `classifyByFilename` accepts a record of suffix strings or an array of regex tuples. `classifyByDirectory` matches relative paths with slash boundaries so a key like "integration" matches "src/integration/foo.test.ts" but not "my-integration-tests/foo.test.ts". `combineClassifiers` concatenates results in order and deduplicates by tag name, so chained classifiers can safely overlap.

* [`b5fb28f`](https://github.com/spencerbeggs/vitest-agent/commit/b5fb28f7e4f656fa48420051d1c97fbbe6e6320c) ### Playground sandbox

- Added `playground/` workspace with intentionally imperfect source (`math`, `strings`, `cache`, `Notebook`) as a live dogfooding target for the TDD orchestrator and MCP tools

* [`0a196c0`](https://github.com/spencerbeggs/vitest-agent/commit/0a196c04f78a84eb31d69d09156d014f9433ed73) Introduces the 2.0 data layer: XDG-based DB path resolution, 41-table SQLite schema, session/turn logging, TDD lifecycle tracking, and failure signature persistence.

- [`8bffd58`](https://github.com/spencerbeggs/vitest-agent/commit/8bffd58be1ab3ea5151e57b4d63eb0196245a4c2) ### Three-tier goal/behavior hierarchy

`vitest-agent-sdk` defines the new entity tiers. `tdd_session_goals` stores coherent slices of an objective; `tdd_session_behaviors` stores atomic red-green-refactor units under a goal; `tdd_behavior_dependencies` records ordering constraints without JSON-in-TEXT. Status lifecycle is `pending → in_progress → done | abandoned`; deletes are reserved for cleanup of mistakes and `abandoned` is the normal way to drop work.

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

* Binary renamed from `vitest-agent-reporter` to `vitest-agent`; update any scripts or CI steps that invoke it

### Claude Code plugin

* Plugin name changed from `"vitest-agent-reporter"` to `"vitest-agent"`; reinstall the plugin to pick up the new manifest
* MCP server key changed from `"vitest-reporter"` to `"mcp"`

### AgentPlugin options

* The `reporter` field in `AgentPlugin({})` is now typed as a factory function only; pass coverage thresholds and other config bag options under `reporterOptions` instead

### Reshaped `tdd_session_behaviors` schema

The behaviors table no longer has `parent_tdd_session_id`, `child_tdd_session_id`, or `depends_on_behavior_ids`. It now references the new `tdd_session_goals` table via `goal_id NOT NULL`, with dependencies stored in a separate `tdd_behavior_dependencies` junction table. `tdd_phases.behavior_id` cascade changed from `SET NULL` to `CASCADE`. `tdd_artifacts` gains a `behavior_id` column for behavior-scoped queries. Pre-2.0 dev databases must be wiped on first pull (the migration ledger has no content hash, so editing `0002_comprehensive` in place does not auto-replay).

### Removed `writeTddSessionBehaviors` from DataStore

* [`324b242`](https://github.com/spencerbeggs/vitest-agent/commit/324b2427502792a403570beb7d2b3c5f57fb2207) ### `Schema.Union` outputs no longer crash with `_zod` undefined

Before the bridge wrap, every tool whose output Schema was a `Schema.Union` (`inventory`, `test_status`, `cache_health`, `tdd_task`, several others) crashed at runtime with `Cannot read properties of undefined (reading '_zod')` because the MCP SDK's output validator could not unwrap the union into an object schema. The wrap preserves the structured payload contract while satisfying the SDK's object-only requirement.

* [`324b242`](https://github.com/spencerbeggs/vitest-agent/commit/324b2427502792a403570beb7d2b3c5f57fb2207) ### TDD artifact binding survives `cc_session_id` rotation and orphaned subagent rows

Recording paths (`record turn`, `record tdd-artifact`) no longer fail with `Unknown cc_session_id` when Claude Code rotates the host session id mid-window (continuation, compaction, MCP reconnect) without re-firing `SessionStart` for the new id. A new three-step session resolver in the CLI lib falls through exact match → subagent-prefix fallback → idempotent bootstrap, so a missing main session row self-heals on first hook invocation.

The phase-transition validator can now find evidence written under subagent rows whose tdd\_session lives under the parent main row. `DataReader.listTddSessionsForSession` accepts a `walkParents: true` option that traverses `sessions.parent_session_id` (bounded to 64 hops, cycle-safe). Before this fix, dispatching the TDD orchestrator as a subagent caused every `red → green` transition to fail with `missing_artifact_evidence` because artifacts and tdd\_sessions landed on different session rows.

The `subagent-start-tdd.sh` plugin hook now pre-bootstraps the parent main row before creating the subagent row, and unconditionally sets `parent_session_id` from the orchestrator's host session id. The earlier conditional check on the hook payload's `parent_session_id` field was unreliable because Claude Code does not consistently populate that field for `context: fork` dispatches.

The batch behavior-insert path is gone alongside the tool that drove it. Use `createBehavior` per behavior instead.

### 10 new MCP CRUD tools

* `tdd_goal_create` (idempotent on `(sessionId, goal)`), `tdd_goal_get`, `tdd_goal_update`, `tdd_goal_delete`, `tdd_goal_list`.
* `tdd_behavior_create` (idempotent on `(goalId, behavior)`), `tdd_behavior_get`, `tdd_behavior_update`, `tdd_behavior_delete`, `tdd_behavior_list` (discriminated input: `{ scope: "goal" | "session", ... }`).
* Read tools return the full nested shape (goals with nested behaviors; behaviors with parentGoal summary and dependency list) so an agent can analyze a session in one round trip.
* Errors return as `{ ok: false, error: { _tag, ..., remediation } }` success-shape envelopes — never tRPC error envelopes.

### Tagged error API for goal/behavior CRUD

`vitest-agent-sdk` exports `GoalNotFoundError`, `BehaviorNotFoundError`, `TddSessionNotFoundError`, `TddSessionAlreadyEndedError`, and `IllegalStatusTransitionError`. Each carries a derived message and is surfaced through the MCP envelope shape with a remediation hint pointing the caller at the right recovery tool.

### `tdd_session_get` renders Goals and Behaviors

When a session has `tdd_session_goals` and `tdd_session_behaviors` rows, `tdd_session_get` now renders a `## Goals and Behaviors` section beneath Phases and Artifacts. Each goal is listed with its 1-based ordinal and text; each behavior is nested under its parent goal with its current status.

### Auto-promote behavior status on phase transition

When `tdd_phase_transition_request` accepts a transition with a `behaviorId` and the behavior is currently `pending`, the server auto-promotes it to `in_progress`. Callers do not need a separate `tdd_behavior_update` for the start-of-cycle transition; only the final `done` transition.

### `ChannelEvent` schema union

* [`324b242`](https://github.com/spencerbeggs/vitest-agent/commit/324b2427502792a403570beb7d2b3c5f57fb2207) ### `tdd-task` subagent — explicit data-lookup guidance

The `tdd-task` subagent prompt (`plugin/agents/tdd-task.md`) gained a "Data lookup — use these MCP tools, do NOT shell out to sqlite3" section that maps the eleven most common questions the orchestrator asks ("what's my current phase id?", "what's the most recent test\_failed\_run?", etc.) to the specific tool that answers each one. The section also explicitly licenses exploratory tool use when the table doesn't cover a question. The existing DATABASE\_BYPASS anti-pattern entry was tightened to point at the new map.

The main-agent skill (`plugin/skills/tdd/SKILL.md`) takes ownership of channel-event handling and renders the goal+behavior hierarchy flat with `[G<n>.B<m>]` label encoding (Claude Code's `TaskCreate` does not nest cleanly past one parent). Goals appear as marker tasks (`--- Goal N done ---`) inserted between behavior groups. `goal_completed` and `session_complete` carry reconciliation arrays so the renderer is order-independent against dropped intermediate events.

### `DataReader.findSessionsByCcPrefix`

New read query that returns session rows whose `cc_session_id` begins with a given prefix, newest first. The CLI session resolver uses it to recover the synthetic subagent row when a hook fires under the bare parent host id.

### `tdd_task get` surfaces the current phase id

The `tdd_task` tool's `get` action now includes a `current phase: <name> [phaseId=N]` line near the top of its markdown output. Previously the agent had to scan the full `## Phases` block looking for the entry without an `→` arrow, or query the database directly. The phaseId is the value `tdd_phase_transition_request` and `tdd_artifact_list` accept.
