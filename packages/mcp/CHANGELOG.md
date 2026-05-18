# vitest-agent-mcp

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

* [`c055f7d`](https://github.com/spencerbeggs/vitest-agent/commit/c055f7dcceb90a13c6ebe7c8d6058804ca715d69) ### vitest-agent-ui public surface replaced

The previous renderer-facing exports are removed. Gone are the event-sourced reporter factory and its options type, the live Ink renderer factory and its options type, the live renderer class, the one-shot render-run helper plus its from-state variant, and the render-run mode and options types.

The new public surface is a preassembled default reporter (the value the plugin wires automatically), the dispatch-input builder, the cell-options resolver, and the per-report convenience helpers for agent-string and human-string output.

It also exposes the dispatcher entry points: single dispatch, Ink dispatch, the dispatcher table, the run-shape and outcome classifiers, the footer builder, and the dominant-classification helper. The dispatcher contract types are re-exported from the SDK so every package reads the same definitions.

* [`8bffd58`](https://github.com/spencerbeggs/vitest-agent/commit/8bffd58be1ab3ea5151e57b4d63eb0196245a4c2) ### Removed `decompose_goal_into_behaviors` MCP tool

Server-side goal-string-splitting is removed. The orchestrator now decomposes via LLM reasoning and creates each entity individually through `tdd_goal_create` and `tdd_behavior_create`. Callers using the old tool will get an unknown-procedure error from the MCP router.

### Features

* [`47e811f`](https://github.com/spencerbeggs/vitest-agent/commit/47e811f0640ea96e508904a53900ef435f242eab) ### `ConfigValidation` Effect service

A new service under `vitest-agent-plugin` runs at plugin init with a seven-rule starter registry: TARGET\_WITHOUT\_THRESHOLD warns, TARGET\_BELOW\_THRESHOLD errors, THRESHOLD\_WITHOUT\_TARGET is silent, INVALID\_TARGET\_VALUE errors with the offending path, UNSUPPORTED\_PROVIDER errors in Full mode, MISSING\_PROVIDER\_PACKAGE errors with the install command, PERFILE\_ON\_TARGETS warns. Warnings and info entries print through the plugin's stderr prefix; errors throw via `formatFatalError` and refuse to start the run. A test-layer factory accepts pre-built results for unit-test injection.

### Features

* [`14f9eca`](https://github.com/spencerbeggs/vitest-agent/commit/14f9ecae157bd148d2ce8529c066934561c4a266) ### Three classifier composition helpers

`classifyByFilename`, `classifyByDirectory`, and `combineClassifiers` ship as pure helpers from `vitest-agent-plugin`. `classifyByFilename` accepts a record of suffix strings or an array of regex tuples. `classifyByDirectory` matches relative paths with slash boundaries so a key like "integration" matches "src/integration/foo.test.ts" but not "my-integration-tests/foo.test.ts". `combineClassifiers` concatenates results in order and deduplicates by tag name, so chained classifiers can safely overlap.

### Features

* [`0a196c0`](https://github.com/spencerbeggs/vitest-agent/commit/0a196c04f78a84eb31d69d09156d014f9433ed73) Introduces the 2.0 MCP server: 41 tools via tRPC, session ID association for `run_tests`, and per-window `currentSessionId` tracking.

- [`0884572`](https://github.com/spencerbeggs/vitest-agent/commit/088457230bf26a3a65e41e8daff862be7fa080f6) Migrations 0003 (`mcp_idempotent_responses`), 0004 (`test_cases.created_turn_id`), 0005 (`failure_signatures.last_seen_at`), and 0006 (`tdd_sessions.run_id`) are folded into `0002_comprehensive` in-place. The four individual migration files are deleted. All consumers (`CliLive`, `McpLive`, `ReporterLive`, `DataStoreTest`, `ensure-migrated`) updated to reference only `0001` and `0002`. Existing development databases must be deleted and recreated — no production databases exist prior to the 2.0 release.

* [`efbd19f`](https://github.com/spencerbeggs/vitest-agent/commit/efbd19fe703923a8563ac2d451ca0ff8a84746a0) `hook-debug.sh` added to `hooks/lib/` — structured `hook_error` (always-on) and `hook_debug` (env-gated via `VITEST_AGENT_HOOK_DEBUG=1`) logging for all hook scripts
* `hooks/fixtures/` added — synthetic JSON payloads for manual hook invocation during development
* `match-tdd-agent.sh` narrowed — legacy agent\_type forms (`plugin:vitest-agent:tdd-task`, bare `tdd-task`) removed after being confirmed never observed in practice

### Features

* [`b5fb28f`](https://github.com/spencerbeggs/vitest-agent/commit/b5fb28f7e4f656fa48420051d1c97fbbe6e6320c) ### Playground sandbox

- Added `playground/` workspace with intentionally imperfect source (`math`, `strings`, `cache`, `Notebook`) as a live dogfooding target for the TDD orchestrator and MCP tools

A throwing user tap is caught and logged to stderr so a buggy live subscriber no longer breaks persistence. The plugin also adds vitest-agent-ui as a workspace dependency so consumers do not install the UI package directly.

### Features

* [`c055f7d`](https://github.com/spencerbeggs/vitest-agent/commit/c055f7dcceb90a13c6ebe7c8d6058804ca715d69) ### Shape-tailored dispatcher matrix

A new dispatch layer in vitest-agent-ui routes each rendered run by a run-shape and run-outcome pair to a dedicated cell that produces both an agent-oriented string and an Ink-tree variant.

Cells cover the single-test, single-file, single-project, and workspace shapes, crossed with the all-pass, some-fail, and threshold-violation outcomes.

Run shape and outcome are computed by classifier helpers exported alongside the dispatcher table and the dominant-classification helper used to pick a representative outcome when multiple are present.

### Features

* [`8bffd58`](https://github.com/spencerbeggs/vitest-agent/commit/8bffd58be1ab3ea5151e57b4d63eb0196245a4c2) ### Three-tier goal/behavior hierarchy

- `tdd_goal_create` (idempotent on `(sessionId, goal)`), `tdd_goal_get`, `tdd_goal_update`, `tdd_goal_delete`, `tdd_goal_list`.
- `tdd_behavior_create` (idempotent on `(goalId, behavior)`), `tdd_behavior_get`, `tdd_behavior_update`, `tdd_behavior_delete`, `tdd_behavior_list` (discriminated input: `{ scope: "goal" | "session", ... }`).
- Read tools return the full nested shape (goals with nested behaviors; behaviors with parentGoal summary and dependency list) so an agent can analyze a session in one round trip.
- Errors return as `{ ok: false, error: { _tag, ..., remediation } }` success-shape envelopes — never tRPC error envelopes.

* [`efbd19f`](https://github.com/spencerbeggs/vitest-agent/commit/efbd19fe703923a8563ac2d451ca0ff8a84746a0) ### Claude Code plugin: session ID and task panel fixes

Fixes a session ID contamination bug where `get_current_session_id()` could return a stale synthetic subagent key after a `context:fork` dispatch, causing all PostToolUse artifact writes to fail with "no open TDD session" errors. Replaced with `session_list({ agentKind: "main", limit: 1 })` which reads the correct value from the database.

Fixes an orphaned-task bug in the task panel where abandoned sessions (which fire `behaviors_ready` but never `behavior_started`) would leave pending `□` tasks with no associated work. `TaskCreate` is now deferred from `behaviors_ready` to `behavior_started`.

* [`324b242`](https://github.com/spencerbeggs/vitest-agent/commit/324b2427502792a403570beb7d2b3c5f57fb2207) ### `Schema.Union` outputs no longer crash with `_zod` undefined

Before the bridge wrap, every tool whose output Schema was a `Schema.Union` (`inventory`, `test_status`, `cache_health`, `tdd_task`, several others) crashed at runtime with `Cannot read properties of undefined (reading '_zod')` because the MCP SDK's output validator could not unwrap the union into an object schema. The wrap preserves the structured payload contract while satisfying the SDK's object-only requirement.

### Features

* [`01df6ba`](https://github.com/spencerbeggs/vitest-agent/commit/01df6ba7ce3daf0f1ffa19f0e170b0154800f936) ### Cross-package version constants

Exports CURRENT\_MCP\_VERSION, a build-time string constant injected from package.json at compile time.

* vitest://docs/ — index of the vendored Vitest documentation snapshot
* vitest://docs/{path} — any page from the snapshot (e.g. vitest://docs/api/mock)
* vitest-agent://patterns/ — index of the curated patterns library
* vitest-agent://patterns/{slug} — a single pattern (3 launch patterns: testing-effect-services-with-mock-layers, testing-effect-schema-definitions, authoring-a-custom-vitest-agent-reporter)

The MCP server now exposes six framing-only prompts:

* [`93e3d14`](https://github.com/spencerbeggs/vitest-agent/commit/93e3d147c3ce750b2c2cd946fe45cbd58d82236c) New project-local update-vitest-snapshot skill driving a 5-phase fetch → prune → scaffold → enrich → validate workflow. Backed by Effect-based scripts under packages/mcp/lib/scripts (fetch-upstream-docs.ts, build-snapshot.ts, validate-snapshot.ts).
* packages/mcp/src/vendor and packages/mcp/src/patterns now live under src and ship via rslib-builder copyPatterns. The previous postbuild copy script is removed.
* A single-source annotations-heuristic module is consumed by both build-snapshot (fresh refresh seeding) and apply-annotations (idempotent bootstrap for existing snapshots), keeping annotation logic in one place across both maintenance paths.

### Features

* [`324b242`](https://github.com/spencerbeggs/vitest-agent/commit/324b2427502792a403570beb7d2b3c5f57fb2207) ### `tdd_phase_transition_request` auto-resolves the cited artifact

`citedArtifactId` is now optional. When the caller omits it, the tool resolves the most recent matching artifact for the session, with the kind drawn from one of three sources (priority order):

1. An explicit `citedArtifactKind` argument.
2. The kind required by the transition itself (per `requiredArtifactForTransition`: `test_failed_run` for `red→green`, `test_passed_run` for `green→refactor` and `refactor→red`).
3. None — for transitions like `spike→red` that the validator accepts without an artifact, the citation step is skipped entirely.

When the auto-resolve can't find a matching artifact, the tool returns the existing `missing_artifact_evidence` denial with a remediation pointing at `run_tests`. The accepted response now also echoes `citedArtifactId` and `citedArtifactSource` (`explicit-id` | `explicit-kind` | `transition-derived` | `none`) so callers can confirm which row was used.

This removes the per-transition `tdd_artifact_list` lookup that the orchestrator was making before every phase transition — the most common round-trip in the TDD loop.

The SDK helper `requiredArtifactForTransition` is now exported from `vitest-agent-sdk` so the MCP tool (and any future tool surface) can pre-compute the expected kind without duplicating the validator's rule table.

### Features

* [`324b242`](https://github.com/spencerbeggs/vitest-agent/commit/324b2427502792a403570beb7d2b3c5f57fb2207) ### `tdd_artifact_list` MCP tool

A new read-only MCP tool, `tdd_artifact_list({ tddSessionId, artifactKind?, phaseId?, behaviorId?, limit?, format? })`, returns the artifacts recorded for a TDD session in newest-first order. Lets the orchestrator answer "what's the artifact id I should cite for this phase transition?" without shelling out to `sqlite3`. Markdown output prominently shows `[id=N]` and `[phaseId=N]` so the value can be lifted directly into a follow-up `tdd_phase_transition_request` call. JSON output is available via `format: "json"`.

The SDK gains a matching `DataReader.listTddArtifactsForSession` method.

### Bug Fixes

* [`efbd19f`](https://github.com/spencerbeggs/vitest-agent/commit/efbd19fe703923a8563ac2d451ca0ff8a84746a0) ### Claude Code plugin: session ID and task panel fixes

Fixes a session ID contamination bug where `get_current_session_id()` could return a stale synthetic subagent key after a `context:fork` dispatch, causing all PostToolUse artifact writes to fail with "no open TDD session" errors. Replaced with `session_list({ agentKind: "main", limit: 1 })` which reads the correct value from the database.

Fixes an orphaned-task bug in the task panel where abandoned sessions (which fire `behaviors_ready` but never `behavior_started`) would leave pending `□` tasks with no associated work. `TaskCreate` is now deferred from `behaviors_ready` to `behavior_started`.

29 MCP tools now emit dual-channel responses per MCP 2025-06-18: human-readable markdown in `content[]` and a typed JSON object in `structuredContent`. Each tool declares an `outputSchema` derived from an Effect Schema, so clients can validate the structured payload against a discoverable contract instead of parsing markdown.

A new `structuredResult(text, data)` helper in `packages/mcp/src/server.ts` produces both channels from a single source-of-truth Schema, and `Schema.transformOrFail` codecs render markdown one-way from the typed payload. JSON Schema annotations (`title`, `description`, `examples`) survive the round trip so agents see field hints in the tool listing.

### Bug Fixes

* [`324b242`](https://github.com/spencerbeggs/vitest-agent/commit/324b2427502792a403570beb7d2b3c5f57fb2207) ### `Schema.Union` outputs no longer crash with `_zod` undefined

Before the bridge wrap, every tool whose output Schema was a `Schema.Union` (`inventory`, `test_status`, `cache_health`, `tdd_task`, several others) crashed at runtime with `Cannot read properties of undefined (reading '_zod')` because the MCP SDK's output validator could not unwrap the union into an object schema. The wrap preserves the structured payload contract while satisfying the SDK's object-only requirement.

### Documentation

* [`324b242`](https://github.com/spencerbeggs/vitest-agent/commit/324b2427502792a403570beb7d2b3c5f57fb2207) ### `tdd-task` subagent — explicit data-lookup guidance

The `tdd-task` subagent prompt (`plugin/agents/tdd-task.md`) gained a "Data lookup — use these MCP tools, do NOT shell out to sqlite3" section that maps the eleven most common questions the orchestrator asks ("what's my current phase id?", "what's the most recent test\_failed\_run?", etc.) to the specific tool that answers each one. The section also explicitly licenses exploratory tool use when the table doesn't cover a question. The existing DATABASE\_BYPASS anti-pattern entry was tightened to point at the new map.

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| vitest-agent-sdk | dependency | updated | 1.3.1 | 2.0.0 |

### Maintenance

Additionally, transitions to `green` are now rejected unless the current phase is `red`, `red.triangulate`, or `green.fake-it`. Callers that previously relied on `spike→green` or `refactor→green` "free transitions" will receive a `wrong_source_phase` denial with a remediation hint pointing at `requestedPhase: "red"`. The `red` phase must now be an explicit named DB row in every TDD cycle.

### `coverageTargets` is now a typed schema

`AgentPluginOptions.coverageTargets` is a typed `Schema.Record` mirroring Vitest's threshold shape: per-metric positive numbers, the `100: true` value shortcut, glob-pattern entries with nested metric objects. Negatives and zero are rejected at decode time. The `perFile` key is no longer accepted on `coverageTargets` — it is inherited from `coverage.thresholds.perFile` so the two halves cannot drift.

### `AgentPlugin.COVERAGE_LEVELS.<preset>` is now dual-output

Each named preset returns `{ thresholds, coverageTargets }` instead of a `CoverageLevel` instance. The thresholds half carries the same numbers the prior `CoverageLevel.<preset>` exposed; the coverageTargets half is the next-preset-up's numbers, capped at `full`. `COVERAGE_LEVELS_PER_FILE` applies `perFile: true` only on the thresholds half.

* [`14f9eca`](https://github.com/spencerbeggs/vitest-agent/commit/14f9ecae157bd148d2ce8529c066934561c4a266) ### Three classifier composition helpers

`classifyByFilename`, `classifyByDirectory`, and `combineClassifiers` ship as pure helpers from `vitest-agent-plugin`. `classifyByFilename` accepts a record of suffix strings or an array of regex tuples. `classifyByDirectory` matches relative paths with slash boundaries so a key like "integration" matches "src/integration/foo.test.ts" but not "my-integration-tests/foo.test.ts". `combineClassifiers` concatenates results in order and deduplicates by tag name, so chained classifiers can safely overlap.

* [`0a196c0`](https://github.com/spencerbeggs/vitest-agent/commit/0a196c04f78a84eb31d69d09156d014f9433ed73) Introduces the 2.0 MCP server: 41 tools via tRPC, session ID association for `run_tests`, and per-window `currentSessionId` tracking.

- [`b5fb28f`](https://github.com/spencerbeggs/vitest-agent/commit/b5fb28f7e4f656fa48420051d1c97fbbe6e6320c) ### Playground sandbox

* Added `playground/` workspace with intentionally imperfect source (`math`, `strings`, `cache`, `Notebook`) as a live dogfooding target for the TDD orchestrator and MCP tools

- [`c055f7d`](https://github.com/spencerbeggs/vitest-agent/commit/c055f7dcceb90a13c6ebe7c8d6058804ca715d69) ### Shape-tailored dispatcher matrix

A new dispatch layer in vitest-agent-ui routes each rendered run by a run-shape and run-outcome pair to a dedicated cell that produces both an agent-oriented string and an Ink-tree variant.

Cells cover the single-test, single-file, single-project, and workspace shapes, crossed with the all-pass, some-fail, and threshold-violation outcomes.

Run shape and outcome are computed by classifier helpers exported alongside the dispatcher table and the dominant-classification helper used to pick a representative outcome when multiple are present.

* [`8bffd58`](https://github.com/spencerbeggs/vitest-agent/commit/8bffd58be1ab3ea5151e57b4d63eb0196245a4c2) ### Three-tier goal/behavior hierarchy

`vitest-agent-sdk` defines the new entity tiers. `tdd_session_goals` stores coherent slices of an objective; `tdd_session_behaviors` stores atomic red-green-refactor units under a goal; `tdd_behavior_dependencies` records ordering constraints without JSON-in-TEXT. Status lifecycle is `pending → in_progress → done | abandoned`; deletes are reserved for cleanup of mistakes and `abandoned` is the normal way to drop work.

* [`01df6ba`](https://github.com/spencerbeggs/vitest-agent/commit/01df6ba7ce3daf0f1ffa19f0e170b0154800f936) ### Cross-package version constants

Exports CURRENT\_MCP\_VERSION, a build-time string constant injected from package.json at compile time.

Inside main(), the MCP bin compares CURRENT\_MCP\_VERSION against CURRENT\_SDK\_VERSION. Any mismatch emits a single namespaced line to stderr in the form "\[vitest-agent-mcp] version drift: vitest-agent-sdk\@X with vitest-agent-mcp\@Y. Reinstall vitest-agent-\* packages so versions match." The check is observation-only and never throws or exits.

* [`93e3d14`](https://github.com/spencerbeggs/vitest-agent/commit/93e3d147c3ce750b2c2cd946fe45cbd58d82236c) ### MCP Resources

The MCP server now exposes Vitest documentation and curated patterns as resources:

* vitest://docs/ — index of the vendored Vitest documentation snapshot
* vitest://docs/{path} — any page from the snapshot (e.g. vitest://docs/api/mock)
* vitest-agent://patterns/ — index of the curated patterns library
* vitest-agent://patterns/{slug} — a single pattern (3 launch patterns: testing-effect-services-with-mock-layers, testing-effect-schema-definitions, authoring-a-custom-vitest-agent-reporter)

The Vitest documentation snapshot is vendored under packages/mcp/src/vendor/vitest-docs (pinned to a specific upstream tag) and ships via copyPatterns in rslib.config.ts. Per-page metadata in manifest.json (validated against an Effect Schema) drives the per-page title and description clients see in resources/list. Refreshing the snapshot is a guided workflow in the project-local update-vitest-snapshot skill, backed by Effect-based maintenance scripts under packages/mcp/lib/scripts.

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

* [`324b242`](https://github.com/spencerbeggs/vitest-agent/commit/324b2427502792a403570beb7d2b3c5f57fb2207) ### `tdd_artifact_list` MCP tool

A new read-only MCP tool, `tdd_artifact_list({ tddSessionId, artifactKind?, phaseId?, behaviorId?, limit?, format? })`, returns the artifacts recorded for a TDD session in newest-first order. Lets the orchestrator answer "what's the artifact id I should cite for this phase transition?" without shelling out to `sqlite3`. Markdown output prominently shows `[id=N]` and `[phaseId=N]` so the value can be lifted directly into a follow-up `tdd_phase_transition_request` call. JSON output is available via `format: "json"`.

The SDK gains a matching `DataReader.listTddArtifactsForSession` method.

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

### Three pre-2.0 special-case discovery skips are removed

The hard-coded `relativePath === "."`, `!isDir(srcDir)`, and helper-subdir filtering rules are replaced with a single `strategy.buildProject(input)` predicate. Single-package repos and test-only packages — previously silently unsupported — now work via the default strategy. Repos that depended on the implicit root-package skip should declare a custom strategy that returns null for the root, or rely on the default strategy's "no test files = no project" behavior.

### findTestFiles public utility

A new `findTestFiles(path, patterns)` async helper walks the filesystem for test files matching a list of glob patterns. Used internally by `DefaultDiscoverStrategy.buildProject` and exposed publicly so custom strategies can reuse the walker without re-implementing it. Skips `node_modules`, `.git`, and `dist` directories by default; returns absolute paths.

### DefaultDiscoverStrategy exposed by name

Users can subclass or instantiate the default strategy explicitly with `new DefaultDiscoverStrategy()`. The default classifier remains filename-suffix only (`.e2e.` → `["e2e"]`, `.int.` → `["int"]`, otherwise `["unit"]`); the default tag set keeps the same timeouts (`int` 60 seconds; `e2e` 120 seconds with retry 2 under CI).

### CLI bin

* Binary renamed from `vitest-agent-reporter` to `vitest-agent`; update any scripts or CI steps that invoke it

### Claude Code plugin

* Plugin name changed from `"vitest-agent-reporter"` to `"vitest-agent"`; reinstall the plugin to pick up the new manifest
* MCP server key changed from `"vitest-reporter"` to `"mcp"`

### AgentPlugin options

* The `reporter` field in `AgentPlugin({})` is now typed as a factory function only; pass coverage thresholds and other config bag options under `reporterOptions` instead

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

Two new helpers on vitest-agent-ui let one-shot consumers render a single agent report into either an agent-oriented string or a human-oriented string without standing up a full reporter kit. CLI replay paths and custom dashboards use these instead of constructing a transient kit.

### Simpler vitest config

The canonical vitest config no longer imports the event-sourced reporter factory or the live Ink factory. Users wire the plugin with the console matrix and the coverage targets, and the plugin handles the reporter and the live mount internally.

### Removed `writeTddSessionBehaviors` from DataStore

The batch behavior-insert path is gone alongside the tool that drove it. Use `createBehavior` per behavior instead.

### Tagged error API for goal/behavior CRUD

`vitest-agent-sdk` exports `GoalNotFoundError`, `BehaviorNotFoundError`, `TddSessionNotFoundError`, `TddSessionAlreadyEndedError`, and `IllegalStatusTransitionError`. Each carries a derived message and is surfaced through the MCP envelope shape with a remediation hint pointing the caller at the right recovery tool.

### `tdd_session_get` renders Goals and Behaviors

When a session has `tdd_session_goals` and `tdd_session_behaviors` rows, `tdd_session_get` now renders a `## Goals and Behaviors` section beneath Phases and Artifacts. Each goal is listed with its 1-based ordinal and text; each behavior is nested under its parent goal with its current status.

### Auto-promote behavior status on phase transition

When `tdd_phase_transition_request` accepts a transition with a `behaviorId` and the behavior is currently `pending`, the server auto-promotes it to `in_progress`. Callers do not need a separate `tdd_behavior_update` for the start-of-cycle transition; only the final `done` transition.

### `ChannelEvent` schema union

* [`324b242`](https://github.com/spencerbeggs/vitest-agent/commit/324b2427502792a403570beb7d2b3c5f57fb2207) ### `tdd-task` subagent — explicit data-lookup guidance

The `tdd-task` subagent prompt (`plugin/agents/tdd-task.md`) gained a "Data lookup — use these MCP tools, do NOT shell out to sqlite3" section that maps the eleven most common questions the orchestrator asks ("what's my current phase id?", "what's the most recent test\_failed\_run?", etc.) to the specific tool that answers each one. The section also explicitly licenses exploratory tool use when the table doesn't cover a question. The existing DATABASE\_BYPASS anti-pattern entry was tightened to point at the new map.

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| vitest-agent-sdk | dependency | updated | 1.3.1 | 2.0.0 |

Goal and behavior status transitions are validated at the DataStore service tag (typed `IllegalStatusTransitionError`) rather than via SQL triggers. Triggers would surface as raw `SqlError`, defeating the "errors are typed and carry remediation" design principle.

### MCP `run_tests`: inject session attribution from a PreToolUse hook

A new PreToolUse hook, `pre-tool-use-mcp-run-tests.sh`, matches `mcp__plugin_vitest-agent_mcp__run_tests` and injects a `_sessionContext` object into the tool input by sourcing the per-session env-files dir. The MCP tool prefers `input._sessionContext` over its boot-time `SessionContextRef`, working around the fact that Claude Code does not auto-source `CLAUDE_ENV_FILE` into MCP server children. Test runs initiated from the MCP tool are now attributed to the active agent.

### Surface collection-failed test files in `run_tests` output

When a test file fails to import — missing module, syntax error, or `beforeAll` throw — Vitest produced a `TestModule` with `state() === 'failed'`, zero collected tests, and the load error in `errors()`. `buildAgentReport` previously dropped these modules silently because `moduleHasFailure` only flipped on a failed test case; the MCP markdown formatter then reported the run as `0 passed` with a misleading `✅` headline. The reporter now includes collection-failed modules in `failed[]`, and the formatter renders a `Module failed to load` block plus a `N failed to load` tally in the headline. The headline status flips to `❌` for any collection failure or unhandled error, keeping the post-tool-use TDD artifact hook from misclassifying these runs as passes.

### `test_errors` surfaces cite-able IDs and gains an XML output mode

The `test_errors` tool now returns `test_errors.id` and the top stack frame's `stack_frames.id` (`topStackFrameId`) alongside each error. These are the values `hypothesis (action: record)` requires as `citedTestErrorId` and `citedStackFrameId`; the previous markdown output omitted them, forcing the orchestrator to hand-wave the citation.

A new `format` argument accepts `"markdown"` (default, with `[testErrorId=N topStackFrameId=N]` heading tokens plus a dedicated "Cite-able IDs" block) or `"xml"` (a `<test_errors>` document with one `<error id="..." topStackFrameId="...">` element per error). XML is recommended when the agent is going to extract IDs programmatically — Anthropic's prompt-engineering guidance is that Claude parses XML-tagged regions more reliably than ad-hoc markdown.

The data-lookup table in `plugin/agents/tdd-task.md` now points at `test_errors({ project, format: "xml" })` for ID extraction. The "Phase transition" section explains that `citedArtifactId` is optional and how to use `citedArtifactKind` when explicit kind selection is desired. The RED→GREEN step in the workflow no longer prescribes a hard-coded `citedArtifactId: <the test_failed_run id>` value.

### Effect Schema to zod bridge

A new `packages/mcp/src/utils/effect-to-zod.ts` bridges Effect Schema to zod via `JSONSchema.make` plus zod 4's experimental `z.fromJSONSchema`, so the MCP SDK still receives the zod schema it expects in `outputSchema`. The bridge inlines `$ref`s recursively before handing the document to zod (zod 4's `fromJSONSchema` does not resolve refs), and wraps non-object roots in `z.object({}).catchall(z.unknown())` because the SDK's `normalizeObjectSchema` rejects `ZodUnion` outputs.

### `tdd_task get` surfaces the current phase id

The `tdd_task` tool's `get` action now includes a `current phase: <name> [phaseId=N]` line near the top of its markdown output. Previously the agent had to scan the full `## Phases` block looking for the entry without an `→` arrow, or query the database directly. The phaseId is the value `tdd_phase_transition_request` and `tdd_artifact_list` accept.
