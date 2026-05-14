# vitest-agent-reporter

## 2.0.0

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

* [`14f9eca`](https://github.com/spencerbeggs/vitest-agent/commit/14f9ecae157bd148d2ce8529c066934561c4a266) ### Unified DiscoverStrategy replaces TagStrategy and VitestProject

A single `DiscoverStrategy` abstract class now owns both project detection and tag classification — the responsibilities the pre-2.0 `TagStrategy` and `VitestProject` classes split between them. `DefaultDiscoverStrategy` ships as the implicit default. Custom strategies subclass directly or use `DiscoverStrategy.create({ tags, buildProject, classify })`; `.extend({ additionalTags?, buildProject?, classify? })` layers immutably so chained classifiers and project builders compose without mutating the receiver.

Migration: replace `TagStrategy.create(...)` with `DiscoverStrategy.create(...)` and supply a `buildProject` function that returns either a `TestProjectInlineConfiguration` or `null`. Replace `new VitestProject.unit({ name, include, overrides })` with a plain object that satisfies the Vitest-native type.

* [`b5fb28f`](https://github.com/spencerbeggs/vitest-agent/commit/b5fb28f7e4f656fa48420051d1c97fbbe6e6320c) ### Package and directory renames

- `vitest-agent` (Vitest plugin) renamed to `vitest-agent-plugin`; update your `package.json` dependency and `vitest.config.ts` import accordingly
- `packages/agent/` moved to `packages/plugin/`; `packages/shared/` moved to `packages/sdk/`

* [`8bffd58`](https://github.com/spencerbeggs/vitest-agent/commit/8bffd58be1ab3ea5151e57b4d63eb0196245a4c2) ### Removed `decompose_goal_into_behaviors` MCP tool

Server-side goal-string-splitting is removed. The orchestrator now decomposes via LLM reasoning and creates each entity individually through `tdd_goal_create` and `tdd_behavior_create`. Callers using the old tool will get an unknown-procedure error from the MCP router.

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

* [`0a196c0`](https://github.com/spencerbeggs/vitest-agent/commit/0a196c04f78a84eb31d69d09156d014f9433ed73) Introduces the 2.0 reporter: named `VitestAgentReporterFactory` contract, `defaultReporter` composition, and a renderer-only factory pattern.

### Features

* [`8bffd58`](https://github.com/spencerbeggs/vitest-agent/commit/8bffd58be1ab3ea5151e57b4d63eb0196245a4c2) ### Three-tier goal/behavior hierarchy

`vitest-agent-sdk` defines the new entity tiers. `tdd_session_goals` stores coherent slices of an objective; `tdd_session_behaviors` stores atomic red-green-refactor units under a goal; `tdd_behavior_dependencies` records ordering constraints without JSON-in-TEXT. Status lifecycle is `pending → in_progress → done | abandoned`; deletes are reserved for cleanup of mistakes and `abandoned` is the normal way to drop work.

### Refactoring

* [`8bffd58`](https://github.com/spencerbeggs/vitest-agent/commit/8bffd58be1ab3ea5151e57b4d63eb0196245a4c2) ### Single-statement ordinal allocation

`createGoal` and `createBehavior` allocate ordinals via a single `INSERT ... SELECT COALESCE(MAX(ordinal), -1) + 1 ...` statement so concurrent inserts under one parent never collide without needing `BEGIN IMMEDIATE`.

### `coverageTargets` is now a typed schema

`AgentPluginOptions.coverageTargets` is a typed `Schema.Record` mirroring Vitest's threshold shape: per-metric positive numbers, the `100: true` value shortcut, glob-pattern entries with nested metric objects. Negatives and zero are rejected at decode time. The `perFile` key is no longer accepted on `coverageTargets` — it is inherited from `coverage.thresholds.perFile` so the two halves cannot drift.

### `AgentPlugin.COVERAGE_LEVELS.<preset>` is now dual-output

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

* [`14f9eca`](https://github.com/spencerbeggs/vitest-agent/commit/14f9ecae157bd148d2ce8529c066934561c4a266) ### Three classifier composition helpers

`classifyByFilename`, `classifyByDirectory`, and `combineClassifiers` ship as pure helpers from `vitest-agent-plugin`. `classifyByFilename` accepts a record of suffix strings or an array of regex tuples. `classifyByDirectory` matches relative paths with slash boundaries so a key like "integration" matches "src/integration/foo.test.ts" but not "my-integration-tests/foo.test.ts". `combineClassifiers` concatenates results in order and deduplicates by tag name, so chained classifiers can safely overlap.

* [`b5fb28f`](https://github.com/spencerbeggs/vitest-agent/commit/b5fb28f7e4f656fa48420051d1c97fbbe6e6320c) ### Playground sandbox

- Added `playground/` workspace with intentionally imperfect source (`math`, `strings`, `cache`, `Notebook`) as a live dogfooding target for the TDD orchestrator and MCP tools

* [`0a196c0`](https://github.com/spencerbeggs/vitest-agent/commit/0a196c04f78a84eb31d69d09156d014f9433ed73) Introduces the 2.0 reporter: named `VitestAgentReporterFactory` contract, `defaultReporter` composition, and a renderer-only factory pattern.

- [`8bffd58`](https://github.com/spencerbeggs/vitest-agent/commit/8bffd58be1ab3ea5151e57b4d63eb0196245a4c2) ### Three-tier goal/behavior hierarchy

`vitest-agent-sdk` defines the new entity tiers. `tdd_session_goals` stores coherent slices of an objective; `tdd_session_behaviors` stores atomic red-green-refactor units under a goal; `tdd_behavior_dependencies` records ordering constraints without JSON-in-TEXT. Status lifecycle is `pending → in_progress → done | abandoned`; deletes are reserved for cleanup of mistakes and `abandoned` is the normal way to drop work.

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

### VitestProject and TagStrategy are deleted

`packages/plugin/src/utils/vitest-project.ts` and `packages/plugin/src/utils/tag-strategy.ts` are removed. The public export surface drops `VitestProject`, `VitestProjectKind`, `VitestProjectOptions`, `TagStrategy`, `TagStrategyCreateOptions`, `TagStrategyExtendOptions`, and the four TagStrategy-era classify type aliases.

### AgentPlugin option tagStrategy renamed to discoverStrategy

`AgentPluginConstructorOptions.tagStrategy` is renamed to `discoverStrategy`. The Vite transform that injects `test.tags` now consumes a `DiscoverStrategy.classify` rather than a `TagStrategy.classify`; `false` still disables the transform entirely.

### discoverProjects output type changes

The internal `discoverProjects` helper now returns `{ projects: TestProjectInlineConfiguration[] | undefined; tags }` rather than `{ projects: VitestProject[]; tags }`. The `projects` field is undefined when no workspace package and no added entry produced a config, so users can spread the result into Vitest's config without conditional logic. The legacy `DiscoveryOptions` callback shape is gone — users extend the strategy or destructure-and-mutate the result before spreading.

### Three pre-2.0 special-case discovery skips are removed

The hard-coded `relativePath === "."`, `!isDir(srcDir)`, and helper-subdir filtering rules are replaced with a single `strategy.buildProject(input)` predicate. Single-package repos and test-only packages — previously silently unsupported — now work via the default strategy. Repos that depended on the implicit root-package skip should declare a custom strategy that returns null for the root, or rely on the default strategy's "no test files = no project" behavior.

### findTestFiles public utility

A new `findTestFiles(path, patterns)` async helper walks the filesystem for test files matching a list of glob patterns. Used internally by `DefaultDiscoverStrategy.buildProject` and exposed publicly so custom strategies can reuse the walker without re-implementing it. Skips `node_modules`, `.git`, and `dist` directories by default; returns absolute paths.

### DefaultDiscoverStrategy exposed by name

Users can subclass or instantiate the default strategy explicitly with `new DefaultDiscoverStrategy()`. The default classifier remains filename-suffix only (`.e2e.` → `["e2e"]`, `.int.` → `["int"]`, otherwise `["unit"]`); the default tag set keeps the same timeouts (`int` 60 seconds; `e2e` 120 seconds with retry 2 under CI).

### AgentPlugin options

* The `reporter` field in `AgentPlugin({})` is now typed as a factory function only; pass coverage thresholds and other config bag options under `reporterOptions` instead

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

`vitest-agent-sdk` exports `GoalNotFoundError`, `BehaviorNotFoundError`, `TddSessionNotFoundError`, `TddSessionAlreadyEndedError`, and `IllegalStatusTransitionError`. Each carries a derived message and is surfaced through the MCP envelope shape with a remediation hint pointing the caller at the right recovery tool.

### `tdd_session_get` renders Goals and Behaviors

When a session has `tdd_session_goals` and `tdd_session_behaviors` rows, `tdd_session_get` now renders a `## Goals and Behaviors` section beneath Phases and Artifacts. Each goal is listed with its 1-based ordinal and text; each behavior is nested under its parent goal with its current status.

### Auto-promote behavior status on phase transition

When `tdd_phase_transition_request` accepts a transition with a `behaviorId` and the behavior is currently `pending`, the server auto-promotes it to `in_progress`. Callers do not need a separate `tdd_behavior_update` for the start-of-cycle transition; only the final `done` transition.

### `ChannelEvent` schema union

`vitest-agent-sdk` defines a typed union over the 13 orchestrator → main-agent progress events: `goals_ready`, `goal_added`, `goal_started`, `goal_completed` (with `behaviorIds[]` for order-independent rendering), `goal_abandoned`, `behaviors_ready`, `behavior_added`, `behavior_started`, `phase_transition`, `behavior_completed`, `behavior_abandoned`, `blocked`, and `session_complete` (with `goalIds[]`). `tdd_progress_push` validates payloads against this union and resolves `goalId` / `sessionId` server-side from `behaviorId` for behavior-scoped events so a stale orchestrator context cannot push the wrong tree coordinates.

### Orchestrator restricted-tools hook

`vitest-agent-plugin` ships `pre-tool-use-tdd-restricted.sh`, a PreToolUse hook scoped to the TDD orchestrator subagent that denies `tdd_goal_delete`, `tdd_behavior_delete`, and `tdd_artifact_record` with a remediation hint pointing at `status: 'abandoned'`. Defense-in-depth — the orchestrator's `tools[]` frontmatter is a soft enumeration; the hook is the runtime gate. Delete tools are also intentionally omitted from the auto-allow list so main-agent calls require explicit user confirmation before a cascade.

### Three-tier task list rendering

The main-agent skill (`plugin/skills/tdd/SKILL.md`) takes ownership of channel-event handling and renders the goal+behavior hierarchy flat with `[G<n>.B<m>]` label encoding (Claude Code's `TaskCreate` does not nest cleanly past one parent). Goals appear as marker tasks (`--- Goal N done ---`) inserted between behavior groups. `goal_completed` and `session_complete` carry reconciliation arrays so the renderer is order-independent against dropped intermediate events.

### Status validation in DataStore boundary

Goal and behavior status transitions are validated at the DataStore service tag (typed `IllegalStatusTransitionError`) rather than via SQL triggers. Triggers would surface as raw `SqlError`, defeating the "errors are typed and carry remediation" design principle.

### Patch Changes

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| vitest-agent-sdk | dependency | updated | 1.3.1 | 2.0.0 |
| vitest-agent-cli | dependency | updated | 1.3.1 | 2.0.0 |
| vitest-agent-mcp | dependency | updated | 1.3.1 | 2.0.0 |

## 1.3.1

### Bug Fixes

* [`0e0c0ec`](https://github.com/spencerbeggs/vitest-agent-reporter/commit/0e0c0ecdcffb3bd103283715a5c6db84c1ef7352) ### Migration race in multi-project Vitest configs

Fixes intermittent `SqliteError: database is locked` when running tests on a fresh database in a multi-project Vitest configuration. Concurrent reporter instances opening their own SqliteClient connections raced on the initial migration; SQLite's busy\_handler does not retry write-write upgrades in deferred transactions, so one instance failed instead of waiting.

* Added `ensureMigrated(dbPath)` which serializes migrations once per database path within a process, using a `globalThis`-keyed promise cache so it works across the separate plugin module instances Vite creates per project.
* `AgentReporter.onTestRunEnd` now awaits `ensureMigrated(dbPath, logLevel, logFile)` before opening its own runtime; subsequent concurrent reads/writes work normally under WAL plus better-sqlite3's 5s busy\_timeout.

### Useful `DataStoreError` and `DiscoveryError` messages

Reporter failures previously surfaced as `DataStoreError: An error has occurred` with no operation, table, or underlying cause. The custom fields existed but Effect's `Cause.pretty()` ignored them because `message` was empty.

* `DataStoreError` and `DiscoveryError` now expose a derived `message` formatted as `[operation table] reason` (or `[operation path] reason`), so `Cause.pretty()` produces actionable output.
* New exported helper `extractSqlReason(e)` pulls the underlying SQLite message from `SqlError.cause` (e.g. `SQLITE_BUSY: database is locked`, `UNIQUE constraint failed: ...`) instead of the generic `Failed to execute statement` wrapper.
* All `mapError` callsites in `DataStoreLive` and `DataReaderLive` now use `extractSqlReason`, so the reason field reflects what SQLite actually said.

### Claude Code plugin MCP loader

Replaces `npx vitest-agent-reporter-mcp` with a Node loader bundled in the plugin. The previous configuration could fall back to downloading from npm on first run, which can exceed Claude Code's MCP startup window and produces an opaque "MCP server failed to start" with no diagnostic.

* `mcpServers` now lives inline in `plugin/.claude-plugin/plugin.json`; standalone `plugin/.mcp.json` is removed.
* New `plugin/bin/mcp-server.mjs` walks up from `$CLAUDE_PROJECT_DIR` (falling back to `process.cwd()`) looking for `node_modules/vitest-agent-reporter`, reads its `exports['./mcp']`, and dynamically imports it via `file://` URL. The `CLAUDE_PROJECT_DIR` anchor is required for marketplace installs, where the plugin lives under `~/.claude/plugins/...` and the MCP server's spawn-time cwd is unrelated to the user's project.
* The MCP server itself (`mcp/index.ts`) now resolves the user's project dir via `process.env.VITEST_AGENT_REPORTER_PROJECT_DIR` (set by the loader) → `process.env.CLAUDE_PROJECT_DIR` → `process.cwd()`, then threads it explicitly through `resolveDbPath(projectDir)`. This ensures the database is found at `<project>/node_modules/.vite/...` even when two Claude Code sessions in different terminals are running with cwds outside their projects.
* `resolveDbPath` (in `cli/lib/resolve-cache-dir.ts`) now accepts an optional `projectDir` parameter that anchors path resolution. The default of `""` preserves the prior cwd-relative behavior for direct CLI invocations.
* Removed unused `resolveCacheDir` export. It looked for `manifest.json` to identify a cache directory, but Phase 5 stopped writing that file when the cache moved to SQLite, so the function would never have found anything. No CLI command was calling it; `resolveDbPath` is the working replacement.
* Missing-package failure now prints clear stderr instructions for npm/pnpm/yarn/bun and exits non-zero, so the failure mode is diagnosable.
* The plugin's SessionStart hook (`plugin/hooks/session-start.sh`) now also anchors at `$CLAUDE_PROJECT_DIR`, detects the project's package manager (`pnpm exec` / `yarn exec` / `bunx` / `npx --no`), and runs the CLI from the project rather than from the marketplace plugin's install location. Eliminates the same `npx`-fallback latency at session startup.

`vitest-agent-reporter` must now be installed as a project dependency for the Claude Code plugin to work.

## 1.3.0

### Features

* [`bf6d781`](https://github.com/spencerbeggs/vitest-agent-reporter/commit/bf6d781e07a2e2d247edd5056264cd5f1c5f9f7e) The `run_tests` MCP tool now uses Vitest's programmatic API (`createVitest()` + `start()` from `vitest/node`) instead of `spawnSync`. Tests run in-process, results flow through the full reporter pipeline into SQLite, and stdout/stderr are redirected to a null writable to protect the MCP stdio transport. Closes #23.
* Added `test_get` MCP tool for single-test drill-down. Returns the test's current state, error messages, classification badge (`[new-failure]`, `[persistent]`, `[flaky]`, `[stable]`, `[recovered]`), and run history.
* Added `file_coverage` MCP tool for per-file coverage data, returning line, branch, function, and statement percentages along with uncovered line ranges.
* `run_tests` output now includes classification badges and a Next Steps section after the run completes.
* Reporter now captures suite hierarchy via `allSuites()`, writes test tags to the `tags` and `test_case_tags` tables, and parses error stacks into structured `stack_frames` rows.
* Added a `coverage-improvement` skill to the Claude Code plugin with guidance on reading coverage gaps and writing tests to close them.

### Bug Fixes

* [`bf6d781`](https://github.com/spencerbeggs/vitest-agent-reporter/commit/bf6d781e07a2e2d247edd5056264cd5f1c5f9f7e) Fixed a crash when Vitest's `TestCase.diagnostic()` or `TestCase.result()` returns `undefined` for skipped, pending, or todo tests. Null guards have been added at all call sites in the report builder and reporter.
* Fixed `note_get` to return a structured response instead of `null` when a note is found.
* Fixed classification queries passing the wrong `subProject` parameter.
* Fixed nested suite `parentSuiteId` tracking so suite hierarchies are stored correctly in the database.

### Maintenance

* [`bf6d781`](https://github.com/spencerbeggs/vitest-agent-reporter/commit/bf6d781e07a2e2d247edd5056264cd5f1c5f9f7e) Status icons in MCP tool output replaced with Unicode symbols.
* `help.ts` updated to document all 24 current MCP tools.
* Session-start hook trimmed from 63 lines to 15 lines, removing redundant context.
* State enum validation added to the `test_list` discovery tool.

## 1.2.1

### Bug Fixes

* [`3db06ac`](https://github.com/spencerbeggs/vitest-agent-reporter/commit/3db06ac3f75bb46f0f986a716f35fcc49e066d98) Fix hook JSON output validation errors by outputting proper hookSpecificOutput JSON instead of plain markdown, using XML tags for additionalContext, and consuming stdin in SessionStart hook

## 1.2.0

### Features

* [`d3be9f3`](https://github.com/spencerbeggs/vitest-agent-reporter/commit/d3be9f327c6d776cf656eaf764e0f579d1528e3a) ### MCP Help Tool

New `help` MCP tool that returns a complete catalog of all 22 tools organized by category with parameter names and descriptions. Agents can call `help()` to explore available capabilities.

### Bug Fixes

* [`d3be9f3`](https://github.com/spencerbeggs/vitest-agent-reporter/commit/d3be9f327c6d776cf656eaf764e0f579d1528e3a) ### Fatal Error Stack Traces

Fixed fatal errors swallowing stack traces and producing unhelpful `defect: {}` output. All four entry points (reporter, plugin, CLI, MCP server) now use `Cause.pretty()` to extract full error details from Effect FiberFailure instances. Fatal error output includes a link to the issue tracker.

### Plugin Error Handling

The `configureVitest` hook now wraps its body in a try/catch, logging formatted errors to stderr before re-throwing so Vitest knows configuration failed.

### Improved Session Context

The SessionStart hook now explains what vitest-agent-reporter does, encourages MCP tool usage over raw `vitest run` commands, lists all 22 tools (previously 11), and includes `run_tests` usage examples at different scopes.

## 1.1.0

### Features

* [`87d3a86`](https://github.com/spencerbeggs/vitest-agent-reporter/commit/87d3a866cfdcd2acb4ae60fc8def03d933fc084f) Add `project_list` MCP tool to list all known projects with latest run status
* Add `test_list` MCP tool to list test cases with optional state/module/limit filters
* Add `module_list` MCP tool to list test modules (files) for a project
* Add `suite_list` MCP tool to list test suites (describe blocks) for a project
* Add `settings_list` MCP tool to list available settings hashes for the configure tool

All discovery tools return markdown tables with ID columns for use in other tool calls.

### Bug Fixes

* [`87d3a86`](https://github.com/spencerbeggs/vitest-agent-reporter/commit/87d3a866cfdcd2acb4ae60fc8def03d933fc084f) Fix `test_coverage` returning "no data" by reading from `file_coverage` table via new `getCoverage()` DataReader method
* Fix `test_for_file` returning empty by wiring up `writeSourceMap()` in the reporter
* Fix `configure` to default to latest settings when no hash provided
* Fix `note_list` and `note_search` to return markdown instead of raw JSON
* Fix `run_tests` to return formatted text instead of JSON object

Closes #15, closes #16

## 1.0.0

### Breaking Changes

* [`b2ef93a`](https://github.com/spencerbeggs/vitest-agent-reporter/commit/b2ef93ab7ff9f023957c47b26f252d5c8f8620db) `CacheReader` service replaced by `DataReader`
* `CacheReaderLive` layer replaced by `DataReaderLive`
* `CacheWriter` service replaced by `DataStore`
* `CacheWriterLive` layer replaced by `DataStoreLive`
* `CacheError` replaced by `DataStoreError`
* `AgentDetection` service replaced by `EnvironmentDetector`
* `AgentDetectionLive` layer replaced by `EnvironmentDetectorLive`
* `HistoryTracker.classify` signature changed (`cacheDir` removed, `subProject` added)
* `ReporterLive` and `CliLive` are now functions of `dbPath` (not static layers)
* JSON cache files no longer written (SQLite replaces them)
* `manifest.json` no longer exists (computed from SQL queries)
* `consoleStrategy` option mapped to `format` internally (`complement` becomes `vitest-bypass`, `own` becomes `markdown`)
* Three-environment model (`agent`/`ci`/`human`) replaced by four-environment model (`agent-shell`/`terminal`/`ci-github`/`ci-generic`)

### Features

* [`b2ef93a`](https://github.com/spencerbeggs/vitest-agent-reporter/commit/b2ef93ab7ff9f023957c47b26f252d5c8f8620db) ### SQLite Persistence

Replaced JSON file persistence with a normalized 25-table SQLite database via `@effect/sql-sqlite-node`. All test data -- runs, modules, suites, test cases, errors, coverage, history, baselines, trends, and notes -- stored in a single `data.db` file.

* `DataStore` and `DataReader` Effect services for typed SQL writes and reads
* Migration-based schema management via `SqliteMigrator`
* File path interning, settings snapshots with env var tracking
* Git commit/branch correlation on test runs
* Invocation ID for monorepo run correlation
* Notes system with FTS5 full-text search, scoping, threading, and expiration
* Source-to-test file mapping, suite hierarchy preservation
* `splitProject()` utility for `project:subProject` convention
* `captureSettings()` and `captureEnvVars()` for configuration snapshots

### Output Pipeline

Formalized output rendering into five composable Effect services replacing ad-hoc formatting logic.

* `EnvironmentDetector` -- four-environment detection via `std-env` (`agent-shell`, `terminal`, `ci-github`, `ci-generic`)
* `ExecutorResolver` -- maps environment + mode to executor role (`human`, `agent`, `ci`)
* `FormatSelector` -- selects output format (`markdown`, `json`, `vitest-bypass`, `silent`)
* `DetailResolver` -- determines verbosity from run health (`minimal`, `neutral`, `standard`, `verbose`)
* `OutputRenderer` -- dispatches to registered `Formatter` implementations
* Four built-in formatters: `MarkdownFormatter`, `GfmFormatter`, `JsonFormatter`, `SilentFormatter`
* `OutputPipelineLive` composition layer included in `ReporterLive`, `CliLive`, and `McpLive`
* `--format` flag on all CLI commands for markdown/json output
* `format`, `detail`, and `mode` options on `AgentReporterOptions`

### MCP Server

New MCP server entry point (`vitest-agent-reporter-mcp`) exposing 16 tools over stdio transport for LLM agent integration.

* tRPC router with Effect Schema validators (`Schema.standardSchemaV1`)
* `@modelcontextprotocol/sdk` stdio transport with `McpServer` + `StdioServerTransport`
* Test data tools: `test_status`, `test_overview`, `test_coverage`, `test_history`, `test_trends`, `test_errors`, `test_for_file`
* Action tools: `run_tests` (with argument sanitization via `spawnSync`), `cache_health`, `configure`
* Note CRUD tools: `note_create`, `note_list`, `note_get`, `note_update`, `note_delete`, `note_search`
* `McpLive` composition layer with `ManagedRuntime` for long-lived process

### Claude Code Plugin

File-based Claude Code plugin with MCP auto-registration, hooks, skills, and commands.

* `.mcp.json` auto-registers the MCP server when the plugin is enabled
* `SessionStart` hook injects project status and available tools into Claude's context
* `PostToolUse` hook detects test runs and suggests MCP tools when tests fail
* Skills: TDD workflow, debugging guide, configuration reference
* Commands: `/setup` (add plugin to vitest config), `/configure` (view/modify settings)
* Distributed via `spencerbeggs/bot` Claude Code marketplace

## 0.3.0

### Breaking Changes

* [`32a01ac`](https://github.com/spencerbeggs/vitest-agent-reporter/commit/32a01ac771e87500c7411e47b31cefacd07df9c4) `coverageThreshold: number` replaced by `coverageThresholds` (Vitest
  `coverage.thresholds` format)
* `CoverageReport.threshold` replaced by `CoverageReport.thresholds`
  object with `global` and `patterns` fields

### Features

* [`32a01ac`](https://github.com/spencerbeggs/vitest-agent-reporter/commit/32a01ac771e87500c7411e47b31cefacd07df9c4) Restructure as pnpm monorepo with publishable package in `package/`
  and example workspaces in `examples/`
* Replace `coverageThreshold` with Vitest-native `coverageThresholds`
  format supporting per-metric, per-glob, and negative number semantics
* Add `coverageTargets` for aspirational coverage goals with
  auto-ratcheting baselines stored in the cache
* Add per-project coverage trend tracking with 50-entry sliding window
* Add tiered console output: green (targets met), yellow (below
  targets), red (failures or threshold violations)
* Add `trends` CLI command for coverage trajectory analysis
* Add `cache path` and `cache clean` commands for cache management
* Add `doctor` command for cache health diagnostics

### Bug Fixes

* [`32a01ac`](https://github.com/spencerbeggs/vitest-agent-reporter/commit/32a01ac771e87500c7411e47b31cefacd07df9c4) Fix CLI cache directory resolution for Vite's hash-based vitest
  subdirectory (`node_modules/.vite/vitest/<hash>/`)

## 0.2.1

### Bug Fixes

* [`1f951fd`](https://github.com/spencerbeggs/vitest-agent-reporter/commit/1f951fd916f3d8f98e3dedcbccc282b8f35d0b60) Execute the cli with `@efffect/platform-node`

## 0.2.0

### Bug Fixes

* [`73b0c82`](https://github.com/spencerbeggs/vitest-agent-reporter/commit/73b0c82388780520ae91b6d81996c41953e68b03) Forgot to link the cli correctly, my bad

## 0.1.0

### Features

* [`3ef80f9`](https://github.com/spencerbeggs/vitest-agent-reporter/commit/3ef80f926388a296442f0488782381d13e02df5f) **AgentReporter** -- Vitest Reporter producing structured markdown to
  console, persistent JSON to disk per project, and optional GFM for
  GitHub Actions check runs. Groups results by project natively via the
  Reporter v2 API. Uses Effect services for file I/O and coverage
  processing via `Effect.runPromise` with scoped layers.
* **AgentPlugin** -- Vitest plugin that auto-injects AgentReporter with
  three-environment detection (agent/CI/human) via `std-env`. Two console
  strategies: `"complement"` (default) layers on Vitest's built-in agent
  reporter, adding JSON cache and manifest; `"own"` takes over console
  output entirely, stripping built-in reporters.
* **CLI bin** (`vitest-agent-reporter`) with four on-demand commands:
  * `status` -- per-project pass/fail state from cached results
  * `overview` -- test landscape summary with file-to-test mapping
  * `coverage` -- coverage gap analysis using thresholds from cached reports
  * `history` -- failure trend analysis with P/F visualization, flaky
    detection, and persistent failure tracking
* **Agent detection** via `std-env` (covers Claude Code, Cursor, Gemini
  CLI, Codex, Devin, Augment, Goose, Kiro, and more)
* **Coverage integration** with istanbul duck-typing (works with both
  `@vitest/coverage-v8` and `@vitest/coverage-istanbul`)
* **Scoped coverage** for partial test runs -- only flags threshold
  violations for files related to the tests that were run
* **Manifest-first cache** -- agents read `manifest.json` once to find
  failing projects, then selectively read only those report files
* **Effect Schema** for all data structures (reports, manifests, options)
  with `CacheReader` and `CacheReaderLive` exported for programmatic
  cache access
* **GitHub Actions GFM** -- auto-detected, writes structured summaries to
  `GITHUB_STEP_SUMMARY` with collapsible per-project details
* **Cache directory resolution** -- derives from Vite's cacheDir by default,
  configurable via explicit option or `outputFile` config
* **Coverage thresholds** read from Vitest config automatically
* **Compact console output** with failure details, error diffs, coverage
  gaps with uncovered line ranges, and re-run commands
* **Failure history** -- per-test pass/fail tracking across runs in a
  10-run sliding window with automatic classification: `new-failure`,
  `persistent`, `flaky`, `recovered`, `stable`
* **Classification-driven suggestions** -- console output labels failed
  tests with their classification and provides prioritized next steps
  (new failures first, then persistent, then flaky)
