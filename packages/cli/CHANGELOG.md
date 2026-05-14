# vitest-agent-cli

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

### Breaking Changes

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

### Breaking Changes

* [`14f9eca`](https://github.com/spencerbeggs/vitest-agent/commit/14f9ecae157bd148d2ce8529c066934561c4a266) ### Unified DiscoverStrategy replaces TagStrategy and VitestProject

A single `DiscoverStrategy` abstract class now owns both project detection and tag classification — the responsibilities the pre-2.0 `TagStrategy` and `VitestProject` classes split between them. `DefaultDiscoverStrategy` ships as the implicit default. Custom strategies subclass directly or use `DiscoverStrategy.create({ tags, buildProject, classify })`; `.extend({ additionalTags?, buildProject?, classify? })` layers immutably so chained classifiers and project builders compose without mutating the receiver.

Migration: replace `TagStrategy.create(...)` with `DiscoverStrategy.create(...)` and supply a `buildProject` function that returns either a `TestProjectInlineConfiguration` or `null`. Replace `new VitestProject.unit({ name, include, overrides })` with a plain object that satisfies the Vitest-native type.

### Breaking Changes

* [`8bffd58`](https://github.com/spencerbeggs/vitest-agent/commit/8bffd58be1ab3ea5151e57b4d63eb0196245a4c2) ### Removed `decompose_goal_into_behaviors` MCP tool

Server-side goal-string-splitting is removed. The orchestrator now decomposes via LLM reasoning and creates each entity individually through `tdd_goal_create` and `tdd_behavior_create`. Callers using the old tool will get an unknown-procedure error from the MCP router.

* [`324b242`](https://github.com/spencerbeggs/vitest-agent/commit/324b2427502792a403570beb7d2b3c5f57fb2207) ### `record turn` and `record tdd-artifact` CLI flags

The `--project` and `--cwd` options on these subcommands are now optional. When omitted, the lib resolves `project` from `package.json#name` in `cwd` and `cwd` from `process.cwd()`. Hook scripts that call these subcommands without the flags continue to work unchanged.

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| vitest-agent-sdk | dependency | updated | 1.3.1 | 2.0.0 |
| vitest-agent-ui  | dependency | updated | 1.3.1 | 2.0.0 |

### Features

* [`0a196c0`](https://github.com/spencerbeggs/vitest-agent/commit/0a196c04f78a84eb31d69d09156d014f9433ed73) Introduces the 2.0 CLI: session-start/end/turn record subcommands, triage and wrapup generators, and run-trigger association.

- [`d8ca78d`](https://github.com/spencerbeggs/vitest-agent/commit/d8ca78d0ec40613da3176e37a66bcc6090db0336) ### `vitest-agent-ui` — shared event-sourced renderer

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

- [`47e811f`](https://github.com/spencerbeggs/vitest-agent/commit/47e811f0640ea96e508904a53900ef435f242eab) ### `coverageThresholds` removed from `AgentPlugin` options

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

React and Ink are peer dependencies.

* [`47e811f`](https://github.com/spencerbeggs/vitest-agent/commit/47e811f0640ea96e508904a53900ef435f242eab) ### `ConfigValidation` Effect service

A new service under `vitest-agent-plugin` runs at plugin init with a seven-rule starter registry: TARGET\_WITHOUT\_THRESHOLD warns, TARGET\_BELOW\_THRESHOLD errors, THRESHOLD\_WITHOUT\_TARGET is silent, INVALID\_TARGET\_VALUE errors with the offending path, UNSUPPORTED\_PROVIDER errors in Full mode, MISSING\_PROVIDER\_PACKAGE errors with the install command, PERFILE\_ON\_TARGETS warns. Warnings and info entries print through the plugin's stderr prefix; errors throw via `formatFatalError` and refuse to start the run. A test-layer factory accepts pre-built results for unit-test injection.

* [`14f9eca`](https://github.com/spencerbeggs/vitest-agent/commit/14f9ecae157bd148d2ce8529c066934561c4a266) ### Three classifier composition helpers

`classifyByFilename`, `classifyByDirectory`, and `combineClassifiers` ship as pure helpers from `vitest-agent-plugin`. `classifyByFilename` accepts a record of suffix strings or an array of regex tuples. `classifyByDirectory` matches relative paths with slash boundaries so a key like "integration" matches "src/integration/foo.test.ts" but not "my-integration-tests/foo.test.ts". `combineClassifiers` concatenates results in order and deduplicates by tag name, so chained classifiers can safely overlap.

* [`b5fb28f`](https://github.com/spencerbeggs/vitest-agent/commit/b5fb28f7e4f656fa48420051d1c97fbbe6e6320c) ### Playground sandbox

- Added `playground/` workspace with intentionally imperfect source (`math`, `strings`, `cache`, `Notebook`) as a live dogfooding target for the TDD orchestrator and MCP tools

* [`8bffd58`](https://github.com/spencerbeggs/vitest-agent/commit/8bffd58be1ab3ea5151e57b4d63eb0196245a4c2) ### Three-tier goal/behavior hierarchy

`vitest-agent-sdk` defines the new entity tiers. `tdd_session_goals` stores coherent slices of an objective; `tdd_session_behaviors` stores atomic red-green-refactor units under a goal; `tdd_behavior_dependencies` records ordering constraints without JSON-in-TEXT. Status lifecycle is `pending → in_progress → done | abandoned`; deletes are reserved for cleanup of mistakes and `abandoned` is the normal way to drop work.

* [`324b242`](https://github.com/spencerbeggs/vitest-agent/commit/324b2427502792a403570beb7d2b3c5f57fb2207) ### `DataStore.upsertSession` (idempotent insert)

The data layer gains `upsertSession(input)` alongside the existing `writeSession`. Implemented as `INSERT … ON CONFLICT(cc_session_id) DO NOTHING` followed by `SELECT id`, so concurrent SessionStart hook invocations and lazy bootstrap calls land on the same row id without race conditions. `record session-start` now uses this internally; repeated invocations no longer error on `UNIQUE` constraint violations.

### Bug Fixes

* [`324b242`](https://github.com/spencerbeggs/vitest-agent/commit/324b2427502792a403570beb7d2b3c5f57fb2207) ### Unify project-key resolution between reporter and sidecar CLI

The reporter (via `resolveDataPath`) and the sidecar CLI's `_internal` subcommands previously derived different `projectKey` values for the same workspace, fragmenting writes across two `data.db` files under `$XDG_DATA_HOME/vitest-agent/`. A new SDK helper, `resolveProjectKeyFromCwd`, reads `package.json` directly: it prefers `repository.url` canonicalized to `host__path` and falls back to the normalized `name`. Both call sites now use the same helper, so a single `data.db` per workspace is produced.

### Bug Fixes

* [`324b242`](https://github.com/spencerbeggs/vitest-agent/commit/324b2427502792a403570beb7d2b3c5f57fb2207) ### TDD artifact binding survives `cc_session_id` rotation and orphaned subagent rows

Recording paths (`record turn`, `record tdd-artifact`) no longer fail with `Unknown cc_session_id` when Claude Code rotates the host session id mid-window (continuation, compaction, MCP reconnect) without re-firing `SessionStart` for the new id. A new three-step session resolver in the CLI lib falls through exact match → subagent-prefix fallback → idempotent bootstrap, so a missing main session row self-heals on first hook invocation.

The phase-transition validator can now find evidence written under subagent rows whose tdd\_session lives under the parent main row. `DataReader.listTddSessionsForSession` accepts a `walkParents: true` option that traverses `sessions.parent_session_id` (bounded to 64 hops, cycle-safe). Before this fix, dispatching the TDD orchestrator as a subagent caused every `red → green` transition to fail with `missing_artifact_evidence` because artifacts and tdd\_sessions landed on different session rows.

The `subagent-start-tdd.sh` plugin hook now pre-bootstraps the parent main row before creating the subagent row, and unconditionally sets `parent_session_id` from the orchestrator's host session id. The earlier conditional check on the hook payload's `parent_session_id` field was unreliable because Claude Code does not consistently populate that field for `context: fork` dispatches.

### Refactoring

* [`324b242`](https://github.com/spencerbeggs/vitest-agent/commit/324b2427502792a403570beb7d2b3c5f57fb2207) ### `record turn` and `record tdd-artifact` CLI flags

The `--project` and `--cwd` options on these subcommands are now optional. When omitted, the lib resolves `project` from `package.json#name` in `cwd` and `cwd` from `process.cwd()`. Hook scripts that call these subcommands without the flags continue to work unchanged.

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| vitest-agent-sdk | dependency | updated | 1.3.1 | 2.0.0 |
| vitest-agent-ui  | dependency | updated | 1.3.1 | 2.0.0 |

### `PluginMode` and `ConsoleStrategy` schemas removed from the SDK

The two literal-union schemas are gone. In their place: `HumanConsoleMode`, `AgentConsoleMode`, `CiConsoleMode`, and the umbrella `ConsoleMode` union (re-exported from `vitest-agent-sdk`).

### `ResolvedReporterConfig` shape change

The `mode` field on `kit.config` is replaced by `consoleMode: ConsoleMode` — the resolved value the plugin selected for the active executor. Custom reporter factories that switched on `kit.config.mode` need to switch on `kit.config.consoleMode` instead. New `githubSummary: boolean` field on the same struct, populated from the plugin's `githubSummary` option.

### `ExecutorResolver.resolve` signature simplified

The service's `resolve(env, mode)` becomes `resolve(env)`. Executor selection no longer takes a forcing mode — that decision moved into the per-executor console matrix.

```bash
vitest-agent show --project my-pkg --format auto|agent|human|json [--width 80]
```

`auto` picks `human` (Ink `renderToString`) when stdout is a TTY and `agent` (markdown final frame) otherwise. The implementation routes through `DataReader.getLatestRun` → `synthesizeFromAgentReport` → `renderRun`, sharing every byte of formatting code with the plugin's reporter path.

### `RunEvent` and `RenderState` Effect Schemas in the SDK

`packages/sdk/src/schemas/RunEvent.ts` defines an 11-variant discriminated union covering run lifecycle (`RunStarted`, `RunFinished`), per-module events (`ModuleQueued`, `ModuleStarted`, `ModuleFinished`), per-test events (`TestStarted`, `TestFinished`), coverage events (`CoverageReady`, `ThresholdViolation`), and analysis events (`FailureClassified`, `SuggestedAction`). `packages/sdk/src/schemas/RenderState.ts` defines the denormalized projection the reducer produces and both renderers consume. Both schemas are exported from the SDK root and consumed by `vitest-agent-ui`.

### `githubSummary` option

`AgentPlugin({ githubSummary: boolean })` controls whether the plugin writes a GFM markdown step summary under GitHub Actions. Defaults to `true` when `GITHUB_ACTIONS` is detected. Independent of the `console.ci` slot so users can keep the GHA summary while changing CI stdout behavior.

### `coverageTargets` is now a typed schema

`AgentPluginOptions.coverageTargets` is a typed `Schema.Record` mirroring Vitest's threshold shape: per-metric positive numbers, the `100: true` value shortcut, glob-pattern entries with nested metric objects. Negatives and zero are rejected at decode time. The `perFile` key is no longer accepted on `coverageTargets` — it is inherited from `coverage.thresholds.perFile` so the two halves cannot drift.

### `AgentPlugin.COVERAGE_LEVELS.<preset>` is now dual-output

Each named preset returns `{ thresholds, coverageTargets }` instead of a `CoverageLevel` instance. The thresholds half carries the same numbers the prior `CoverageLevel.<preset>` exposed; the coverageTargets half is the next-preset-up's numbers, capped at `full`. `COVERAGE_LEVELS_PER_FILE` applies `perFile: true` only on the thresholds half.

Migration: destructure the preset and route each half to its owner.

`coverage.enabled: false` puts the plugin in UI-only mode: `AgentReporter.onTestRunEnd` short-circuits before persistence (no DataStore writes, no CoverageAnalyzer, no HistoryTracker resolution) while still building reports purely, resolving the renderer kit, calling the user-supplied reporter factory, and routing output. The streaming taps that drive a live renderer fire identically in both modes. Full mode (the default) runs the existing persistence pipeline unchanged.

### `ResolvedReporterConfig.coverageMode` is new and required

The reporter contract surface adds a `coverageMode: "full" | "ui-only"` field on `ResolvedReporterConfig`. Custom `VitestAgentReporterFactory` implementations can branch on this when their rendering depends on whether persistence is on. The plugin resolves the value from `vitest.config.coverage?.enabled` once during `configureVitest`.

### `validateCoverageTargetsShape` helper

A pure helper in `vitest-agent-sdk` returns structured `{ errors, warnings, info }` diagnostics for a `CoverageTargets` input. Rule layer consumers reuse it for the `INVALID_TARGET_VALUE` and `PERFILE_ON_TARGETS` cases.

### `CoverageLevelPreset` public type

The dual-output preset shape is exported from `vitest-agent-plugin` so user code that builds custom presets can satisfy the contract explicitly.

### Optional peer dependencies

`@vitest/coverage-v8` and `@vitest/coverage-istanbul` are declared as optional peer dependencies on `vitest-agent-plugin`. The `MISSING_PROVIDER_PACKAGE` rule surfaces the install command when the configured provider is not available.

### VitestProject and TagStrategy are deleted

`packages/plugin/src/utils/vitest-project.ts` and `packages/plugin/src/utils/tag-strategy.ts` are removed. The public export surface drops `VitestProject`, `VitestProjectKind`, `VitestProjectOptions`, `TagStrategy`, `TagStrategyCreateOptions`, `TagStrategyExtendOptions`, and the four TagStrategy-era classify type aliases.

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

* [`b5fb28f`](https://github.com/spencerbeggs/vitest-agent/commit/b5fb28f7e4f656fa48420051d1c97fbbe6e6320c) ### Package and directory renames

- `vitest-agent` (Vitest plugin) renamed to `vitest-agent-plugin`; update your `package.json` dependency and `vitest.config.ts` import accordingly
- `packages/agent/` moved to `packages/plugin/`; `packages/shared/` moved to `packages/sdk/`

### App namespace

* Config file renamed from `vitest-agent-reporter.config.toml` to `vitest-agent.config.toml`
* XDG data directory changed from `~/.local/share/vitest-agent-reporter/` to `~/.local/share/vitest-agent/`; existing databases are not migrated automatically
* `VitestAgentReporterConfig` renamed to `VitestAgentConfig`; `VitestAgentReporterConfigFile` renamed to `VitestAgentConfigFile`
* Effect `Context.Tag` keys updated from `"vitest-agent-reporter/*"` to `"vitest-agent/*"`

### CLI bin

* Binary renamed from `vitest-agent-reporter` to `vitest-agent`; update any scripts or CI steps that invoke it

### Claude Code plugin

* Plugin name changed from `"vitest-agent-reporter"` to `"vitest-agent"`; reinstall the plugin to pick up the new manifest
* MCP server key changed from `"vitest-reporter"` to `"mcp"`

### AgentPlugin options

* The `reporter` field in `AgentPlugin({})` is now typed as a factory function only; pass coverage thresholds and other config bag options under `reporterOptions` instead

### `tdd_phase_transition_request` requires `goalId` and an explicit `red` phase

The input schema gains a required `goalId: number`. Existing callers that pass only `tddSessionId`, `requestedPhase`, and `citedArtifactId` will fail validation. Pass the parent goal's id alongside; the tool now also pre-validates that the goal status is `in_progress` and that any cited `behaviorId` belongs to the named goal.

Additionally, transitions to `green` are now rejected unless the current phase is `red`, `red.triangulate`, or `green.fake-it`. Callers that previously relied on `spike→green` or `refactor→green` "free transitions" will receive a `wrong_source_phase` denial with a remediation hint pointing at `requestedPhase: "red"`. The `red` phase must now be an explicit named DB row in every TDD cycle.

* [`324b242`](https://github.com/spencerbeggs/vitest-agent/commit/324b2427502792a403570beb7d2b3c5f57fb2207) ### TDD artifact binding survives `cc_session_id` rotation and orphaned subagent rows

Recording paths (`record turn`, `record tdd-artifact`) no longer fail with `Unknown cc_session_id` when Claude Code rotates the host session id mid-window (continuation, compaction, MCP reconnect) without re-firing `SessionStart` for the new id. A new three-step session resolver in the CLI lib falls through exact match → subagent-prefix fallback → idempotent bootstrap, so a missing main session row self-heals on first hook invocation.

The phase-transition validator can now find evidence written under subagent rows whose tdd\_session lives under the parent main row. `DataReader.listTddSessionsForSession` accepts a `walkParents: true` option that traverses `sessions.parent_session_id` (bounded to 64 hops, cycle-safe). Before this fix, dispatching the TDD orchestrator as a subagent caused every `red → green` transition to fail with `missing_artifact_evidence` because artifacts and tdd\_sessions landed on different session rows.

The `subagent-start-tdd.sh` plugin hook now pre-bootstraps the parent main row before creating the subagent row, and unconditionally sets `parent_session_id` from the orchestrator's host session id. The earlier conditional check on the hook payload's `parent_session_id` field was unreliable because Claude Code does not consistently populate that field for `context: fork` dispatches.

### Reshaped `tdd_session_behaviors` schema

The behaviors table no longer has `parent_tdd_session_id`, `child_tdd_session_id`, or `depends_on_behavior_ids`. It now references the new `tdd_session_goals` table via `goal_id NOT NULL`, with dependencies stored in a separate `tdd_behavior_dependencies` junction table. `tdd_phases.behavior_id` cascade changed from `SET NULL` to `CASCADE`. `tdd_artifacts` gains a `behavior_id` column for behavior-scoped queries. Pre-2.0 dev databases must be wiped on first pull (the migration ledger has no content hash, so editing `0002_comprehensive` in place does not auto-replay).

### Removed `writeTddSessionBehaviors` from DataStore

The batch behavior-insert path is gone alongside the tool that drove it. Use `createBehavior` per behavior instead.

When a session has `tdd_session_goals` and `tdd_session_behaviors` rows, `tdd_session_get` now renders a `## Goals and Behaviors` section beneath Phases and Artifacts. Each goal is listed with its 1-based ordinal and text; each behavior is nested under its parent goal with its current status.

### Auto-promote behavior status on phase transition

When `tdd_phase_transition_request` accepts a transition with a `behaviorId` and the behavior is currently `pending`, the server auto-promotes it to `in_progress`. Callers do not need a separate `tdd_behavior_update` for the start-of-cycle transition; only the final `done` transition.

### `ChannelEvent` schema union

`vitest-agent-sdk` defines a typed union over the 13 orchestrator → main-agent progress events: `goals_ready`, `goal_added`, `goal_started`, `goal_completed` (with `behaviorIds[]` for order-independent rendering), `goal_abandoned`, `behaviors_ready`, `behavior_added`, `behavior_started`, `phase_transition`, `behavior_completed`, `behavior_abandoned`, `blocked`, and `session_complete` (with `goalIds[]`). `tdd_progress_push` validates payloads against this union and resolves `goalId` / `sessionId` server-side from `behaviorId` for behavior-scoped events so a stale orchestrator context cannot push the wrong tree coordinates.

### Orchestrator restricted-tools hook

`vitest-agent-plugin` ships `pre-tool-use-tdd-restricted.sh`, a PreToolUse hook scoped to the TDD orchestrator subagent that denies `tdd_goal_delete`, `tdd_behavior_delete`, and `tdd_artifact_record` with a remediation hint pointing at `status: 'abandoned'`. Defense-in-depth — the orchestrator's `tools[]` frontmatter is a soft enumeration; the hook is the runtime gate. Delete tools are also intentionally omitted from the auto-allow list so main-agent calls require explicit user confirmation before a cascade.

`createGoal` and `createBehavior` allocate ordinals via a single `INSERT ... SELECT COALESCE(MAX(ordinal), -1) + 1 ...` statement so concurrent inserts under one parent never collide without needing `BEGIN IMMEDIATE`.

### Status validation in DataStore boundary

Goal and behavior status transitions are validated at the DataStore service tag (typed `IllegalStatusTransitionError`) rather than via SQL triggers. Triggers would surface as raw `SqlError`, defeating the "errors are typed and carry remediation" design principle.

### Pin `agents.agent_id` to `session_map.main_agent_id`

`DataStore.RegisterAgentInput` accepts an optional `agentId` field; the sidecar passes the `main_agent_id` returned from `PerClientSessionMapWriter.mapSession()` so the per-project `agents` row id matches the value the SessionStart hook exports as `VITEST_AGENT_MAIN_AGENT_ID` and `VITEST_AGENT_AGENT_ID`. `test_runs.agent_id` rows now join back to a real `agents` row instead of dangling.

### MCP `run_tests`: inject session attribution from a PreToolUse hook

A new PreToolUse hook, `pre-tool-use-mcp-run-tests.sh`, matches `mcp__plugin_vitest-agent_mcp__run_tests` and injects a `_sessionContext` object into the tool input by sourcing the per-session env-files dir. The MCP tool prefers `input._sessionContext` over its boot-time `SessionContextRef`, working around the fact that Claude Code does not auto-source `CLAUDE_ENV_FILE` into MCP server children. Test runs initiated from the MCP tool are now attributed to the active agent.

### Surface collection-failed test files in `run_tests` output

When a test file fails to import — missing module, syntax error, or `beforeAll` throw — Vitest produced a `TestModule` with `state() === 'failed'`, zero collected tests, and the load error in `errors()`. `buildAgentReport` previously dropped these modules silently because `moduleHasFailure` only flipped on a failed test case; the MCP markdown formatter then reported the run as `0 passed` with a misleading `✅` headline. The reporter now includes collection-failed modules in `failed[]`, and the formatter renders a `Module failed to load` block plus a `N failed to load` tally in the headline. The headline status flips to `❌` for any collection failure or unhandled error, keeping the post-tool-use TDD artifact hook from misclassifying these runs as passes.

### `DataReader.findSessionsByCcPrefix`

New read query that returns session rows whose `cc_session_id` begins with a given prefix, newest first. The CLI session resolver uses it to recover the synthetic subagent row when a hook fires under the bare parent host id.
