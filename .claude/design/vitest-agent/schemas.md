---
status: current
module: vitest-agent-reporter
category: architecture
created: 2026-05-06
updated: 2026-05-07
last-synced: 2026-05-07
completeness: 90
related:
  - ./architecture.md
  - ./data-structures.md
  - ./data-flows.md
  - ./decisions.md
  - ./components/sdk.md
dependencies: []
---

# Schemas — vitest-agent

The shared shapes the system exchanges across package boundaries: TypeScript
contract types, Effect Schema definitions, the SQLite table inventory, and the
input/output types of `DataStore` and `DataReader`.

This document explains intent and load-bearing invariants. Field-by-field
type signatures live in `packages/sdk/src/schemas/` and the relevant service
files; do not duplicate them here.

## Single source of truth

All persisted shapes are Effect Schema definitions in
`packages/sdk/src/schemas/`. TypeScript types derive via
`typeof Schema.Type`. Effect Schema is canonical because every input that
crosses a process boundary (CLI stdin payload, MCP tRPC request, hook envelope)
is decoded through the same schema, so there is one authority for what the
shape looks like at runtime and at compile time. See
[./decisions.md](./decisions.md) for the rationale (D5).

The Common schema literals (`Environment`, `Executor`, `OutputFormat`,
`DetailLevel`) live in `packages/sdk/src/schemas/Common.ts`. The MCP server's
tRPC `McpContext` (carrying a `ManagedRuntime` over `DataReader | DataStore |
ProjectDiscovery | OutputRenderer`) is defined in
`packages/mcp/src/context.ts`. Formatter types (`Formatter`,
`FormatterContext`, `RenderedOutput`) live in
`packages/sdk/src/formatters/types.ts`.

## Reporter contract

`packages/sdk/src/contracts/reporter.ts` defines the public boundary between
`vitest-agent-plugin` and any implementer of a `VitestAgentReporterFactory`
(the named factories in `vitest-agent-reporter`, or any third-party reporter).

The contract is four types:

- **`ResolvedReporterConfig`** — the plugin's resolved configuration handed
  to the factory. `dbPath` is optional at the type level so a stdout-only
  renderer can advertise that it ignores persistence; the plugin always
  populates it in practice.
- **`ReporterKit`** — a named-field bag passed to the factory at construction
  time. The `std*` prefix on fields (`stdEnv`, `stdOsc8`) marks these as
  "the plugin gives you these — don't import equivalents yourself"; they are
  pre-resolved with full context (environment, executor, NO_COLOR,
  target=stdout). Open shape, so future fields don't break existing reporters.
- **`ReporterRenderInput`** — per-run data handed to `render()`. Carries
  `reports[]` (one per project), `classifications` keyed by
  `TestReport.fullName`, and an optional `trendSummary` present only on full
  (non-scoped) runs.
- **`VitestAgentReporterFactory`** — `(kit) => VitestAgentReporter |
  ReadonlyArray<VitestAgentReporter>`. Returning an array models Vitest's
  multi-reporter pattern; the plugin concatenates each reporter's
  `RenderedOutput[]` before routing. Persistence still runs exactly once
  because the plugin owns the Vitest lifecycle and reporters never see Vitest
  events directly.

The reporter returns `RenderedOutput[]`; the plugin routes each entry to its
declared target (`stdout` / `github-summary` / `file`), so the reporter never
opens write streams. A no-op reporter is one line:
`() => ({ render: () => [] })`.

## Reports and coverage

Effect Schema definitions in `packages/sdk/src/schemas/`:

- **`AgentReport`** — the per-project report shape produced after a run.
  Carries summary stats, the `failed[]` modules with their tests, unhandled
  errors, a `failedFiles[]` quick index, an optional `coverage` block, and
  an optional `tagCounts` record (`Record<string, TagCountEntry>` where
  `TagCountEntry` is `{ passed?, failed?, skipped? }`). The plugin
  reporter aggregates per-tag pass/fail/skip counts from
  `TestReport.tags` for terminal-formatter rendering.
- **`CoverageReport`** — totals plus thresholds, optional aspirational
  `targets`, optional auto-ratcheting `baselines`, and a `lowCoverage[]` list
  with `uncoveredLines` rendered as a compressed string (e.g.
  `"42-50,99,120-135"`). `scoped` and `scopedFiles` mark scoped runs that
  intentionally skip baseline ratcheting.
- **`ResolvedThresholds`** / **`CoverageBaselines`** / **`TrendRecord`** —
  the threshold/baseline/trend triple used by Vitest-native
  `coverageThresholds`, the auto-ratcheting baselines, and the per-project
  trend tracking. `TrendRecord.entries` is a sliding window capped at 50.

`TestClassification` is the per-test label HistoryTracker assigns:
`stable` / `new-failure` / `persistent` / `flaky` / `recovered`. The reporter
uses these to drive the suggested-actions output.

## Cache manifest

`CacheManifest` is now assembled on-the-fly by `DataReader.getManifest()`
from the `test_runs` table — there is no separate manifest file on disk. The
type still exists because the CLI and MCP surfaces speak it.

## Failure history

`HistoryRecord` is the per-test sliding-window log. `TestHistory.runs` is
capped at 10 entries per `fullName`. The DB is the authoritative store; this
type is the in-memory shape for classification.

## Failure signature

`FailureSignatureInput` (in `packages/sdk/src/utils/failure-signature.ts`) is
the **compute-time** input to `computeFailureSignature` — the un-hashed
fields that get hashed into the signature.

`FailureSignatureWriteInput` (in `packages/sdk/src/services/DataStore.ts`) is
the **persistence-time** input to `DataStore.writeFailureSignature` — the
already-computed `signatureHash` plus the metadata to store alongside it. The
`*WriteInput` suffix mirrors the convention used for the other DataStore
inputs (`TestRunInput`, `ModuleInput`, `TestCaseInput`) and disambiguates the
two "FailureSignature" inputs cleanly.

`computeFailureSignature` produces a 16-char sha256 hex hash over
`<error_name>|<normalized shape>|<fn name>|<line coord>` where the line
coordinate is `fb:<boundary>` if known, else `raw:<floor(line/10)*10>`
(10-line bucket), else `raw:?`. The bucketing keeps signatures stable across
unrelated whitespace edits while still varying when the failure moves to a
different function.

## Turn payload union

`packages/sdk/src/schemas/turns/` defines a discriminated `TurnPayload` union
keyed by a `type` literal that mirrors the `turns.type` CHECK constraint.
The variants:

- `user_prompt` — Claude Code user prompts
- `tool_call` — outbound tool invocations
- `tool_result` — tool responses
- `file_edit` — Edit/Write/MultiEdit deltas (also flattened into `file_edits`)
- `hook_fire` — hook lifecycle events
- `note` — agent notes
- `hypothesis` — agent hypotheses citing test errors or stack frames

The union is the source of truth for the `record turn` CLI: the payload is
JSON-decoded against `TurnPayload` before `DataStore.writeTurn` persists it.
Hook envelopes are mostly opaque to the schema — `hook_kind` covers the full
Claude Code event taxonomy (SessionStart through FileChanged) so any new hook
flows through the same schema.

## Phase transition validation

`packages/sdk/src/utils/validate-phase-transition.ts` exports the
TDD evidence-binding contract.

`Phase` is the 8-value lifecycle: `spike`, `red`, `red.triangulate`, `green`,
`green.fake-it`, `refactor`, `extended-red`, `green-without-red`.
`ArtifactKind` is the 6-value evidence kind:
`test_written`, `test_failed_run`, `code_written`, `test_passed_run`,
`refactor`, `test_weakened`.

`CitedArtifact` is the de-normalized row the validator consumes — the
`tdd_artifacts` row joined with `test_cases` and the originating `turns` so
the D2 binding rules can be checked in a pure function. The
`test_case_authored_in_session` boolean is precomputed by the DataReader from
`test_cases.created_turn_id` because the validator must not query the DB.

`DenialReason` enumerates every way a transition can be rejected. The 2.0
hierarchy adds the `goal_*` and `behavior_*` cases that fire **before** the
D2 binding rules: a transition request with a stale or wrong-goal behavior
is rejected up front rather than producing a misleading
`evidence_not_in_phase_window`. See [./decisions.md](./decisions.md) D11–D15
for the binding rules and the hierarchy.

`PhaseTransitionResult` is a closed sum over `accepted: true | false`. The
denial branch carries `remediation` with a concrete `suggestedTool` and
`humanHint` so the orchestrator can recover without a round-trip to the
human.

**Authoring-window scope (D2 rule 1):** the check applies to
`test_failed_run` artifacts only. It does not apply to `test_passed_run` or
other kinds, so `green→refactor` transitions citing a `test_passed_run`
artifact are not incorrectly denied with `evidence_not_in_phase_window`.

## Channel events

`packages/sdk/src/schemas/ChannelEvent.ts` defines a discriminated union
over the progress events the TDD orchestrator pushes to the main agent via
the `tdd_progress_push` MCP tool. Each variant carries a `type` literal.
The MCP server validates inbound payloads against this union and **resolves
`goalId` and `sessionId` server-side from `behaviorId`** for behavior-scoped
events (via `DataReader.resolveGoalIdForBehavior`) so a stale orchestrator
context cannot push the wrong tree coordinates. Resolution is best-effort;
malformed JSON or DB read failures fall through with the original payload.

The variants cover goal lifecycle (`goals_ready`, `goal_added`,
`goal_started`, `goal_completed`, `goal_abandoned`), behavior lifecycle
(`behaviors_ready`, `behavior_added`, `behavior_started`, `phase_transition`,
`behavior_completed`, `behavior_abandoned`), and session-level
(`blocked`, `session_complete`).

`BehaviorScopedEventTypes` enumerates the variants whose coordinates the
server rewrites. `goal_completed.behaviorIds` and `session_complete.goalIds`
are reconciliation arrays — they let the renderer recover from dropped
intermediate `behavior_completed` / `goal_completed` notifications, so the
final state is correct even if individual events are lost in transit.

## DataStore inputs

`packages/sdk/src/services/DataStore.ts` exports the input types every writer
accepts. These are persistence-shaped — flatter and looser than the wire
schemas because the DataStore commits one row at a time inside a single
`sql.withTransaction`. The notable ones:

- **`TurnInput`** — `turnNo` is optional. When omitted the live layer
  auto-assigns via `MAX(turn_no)+1` per session, so callers (CLI hooks) don't
  have to coordinate.
- **`StackFrameInput`** — carries `source_mapped_line` and
  `function_boundary_line` for evidence binding.
- **`TestErrorInput`** — extended with optional `signatureHash` (FK target
  on `test_errors`) and `frames` (per-frame rows). The reporter populates
  both via `processFailure`.
- **`HypothesisInput`** / **`ValidateHypothesisInput`** — back the
  `hypothesis_record` / `hypothesis_validate` MCP tools. `validateHypothesis`
  raises `DataStoreError` if `id` doesn't exist (no silent no-op).
- **`IdempotentResponseInput`** — backs the tRPC idempotency middleware. See
  Flow 7 in [./data-flows.md](./data-flows.md) and
  [./decisions.md](./decisions.md) for the `(procedure_path, key)` PK and
  the replay semantics.
- **TDD lifecycle inputs** — `TddSessionInput`, `EndTddSessionInput`,
  `CreateGoalInput` / `UpdateGoalInput`, `CreateBehaviorInput` /
  `UpdateBehaviorInput`, `WriteTddPhaseInput` / `WriteTddPhaseOutput`,
  `WriteTddArtifactInput`, `WriteCommitInput`, `WriteRunChangedFilesInput`.
  Re-exported literal types: `Phase`, `ArtifactKind`, `ChangeKind`,
  `GoalStatus`, `BehaviorStatus` so callers don't dip into `schemas/`
  directly.

**Column-name vs input-name drift.** The `TddSessionInput.agentSessionId`
input field maps to `tdd_sessions.session_id` (NOT `agent_session_id` — no
such column exists). Likewise `WriteTddArtifactInput.tddPhaseId` maps to
`tdd_artifacts.phase_id`. The input names are kept for callsite clarity; the
DataStore is the only place the column-name mapping happens.

**Junction-table writes.** `CreateBehaviorInput.dependsOnBehaviorIds` writes
rows into `tdd_behavior_dependencies` in the same `sql.withTransaction` as
the parent behavior insert, with each id validated to belong to the same goal
(else `BehaviorNotFoundError`). The 1.x JSON-in-TEXT
`depends_on_behavior_ids` column is gone; see
[./decisions.md](./decisions.md) D14 for why the junction table replaced it.

**Status transitions.** Goal and behavior `status` fields go through a
closed lifecycle (`pending → in_progress → done|abandoned`) validated at the
DataStore boundary. Illegal transitions surface as
`IllegalStatusTransitionError` (entity: `"goal"` or `"behavior"`).

## DataReader outputs

`packages/sdk/src/services/DataReader.ts` exports the output shapes every
MCP read tool and CLI command consumes. Like the inputs, these are
persistence-shaped — typically a row plus a small amount of joined context.
The notable ones:

- **`SessionSummary`** / **`ListSessionsOptions`** — backs `session_list`.
- **`FailureSignatureDetail`** — `lastSeenAt` is nullable because it has no
  backfill for rows written before the `failure_signatures.last_seen_at`
  column was added (now part of `0002_comprehensive`).
  See `failure_signatures` in the table inventory below for the recurrence
  semantics.
- **`TddSessionDetail`** — carries the full goal+behavior tree alongside
  phases and artifacts. The goals are materialized via a single batched
  IN-clause join from `tdd_session_goals` to `tdd_session_behaviors` so
  `tdd_session_resume` returns the complete view in one read.
- **`GoalRow` / `BehaviorRow`** are the canonical row types. `GoalDetail`
  nests `behaviors[]`. `BehaviorDetail` includes `parentGoal` and
  `dependencies[]` resolved through the junction table.
- **`HypothesisDetail`** extends `HypothesisSummary` with the resolved
  `cited_test_error` for display.
- **`CurrentTddPhase`** — the most-recent OPEN phase
  (`ended_at IS NULL`) for a TDD session. Backs the orchestrator's resume
  flow.
- **`CitedArtifactRow`** — the de-normalized row consumed verbatim as
  `CitedArtifact` input to the pure `validatePhaseTransition` function. The
  reader does the joins so the validator stays pure.
- **`CommitChangesEntry`** — backs `commit_changes`. Single sha (when
  provided) or the most-recent commits (when omitted, capped at 20).
- **`TddSessionSummary`** — TDD sessions whose `session_id` FK points at
  the given Claude Code session. Used by `tdd_session_resume` to find a
  suitable open TDD session.
- **`FindIdempotentResponse`** — `(procedurePath, key) =>
  Effect<Option<string>, DataStoreError>`. Returns `Option.none()` when no
  cached response exists; otherwise the stored `result_json`.

## Reporter failure-processing output

`packages/plugin/src/utils/process-failure.ts` exports `ProcessFailureResult`
(`{ frames, signatureHash }`) and the `processFailure(error, options)`
function that walks Vitest stack frames, source-maps the top non-framework
frame, runs `findFunctionBoundary` on the resolved source, and calls
`computeFailureSignature` with the parsed pieces. The result feeds
`DataStore.writeFailureSignature` and the per-frame `stack_frames` rows.

## SQLite table inventory

The canonical schema lives entirely in two migration files:
`packages/sdk/src/migrations/0001_initial.ts` (legacy 1.x schema) and
`packages/sdk/src/migrations/0002_comprehensive.ts` (drop-and-recreate
that now folds in all 2.0 additions: goal/behavior hierarchy,
`mcp_idempotent_responses`, the `test_cases.created_turn_id` FK,
`failure_signatures.last_seen_at`, and `tdd_sessions.run_id`). The
former separate files `0003`–`0006` were deleted and merged into `0002`
in-place. All migrations run via `@effect/sql-sqlite-node`'s
`SqliteMigrator` with WAL journal mode and foreign keys enabled.

The migration ledger has no content hash, so editing an existing migration
in place does not auto-replay on existing dev DBs. This is fine for pre-1.0
development but means a wipe of the dev DB is required when schema-shape
edits land on an existing migration. See [./decisions.md](./decisions.md)
D9 for the "0002 was the last drop-and-recreate" decision.

**Spine.** `test_runs` is the run record; each owns one or more
`test_modules`, which own `test_suites` and `test_cases`. Errors attach via
`test_errors` with parsed `stack_frames`. The `files` table is the shared FK
target for any path-like column (test modules, source maps, coverage rows,
file edits, run-changed files), so paths deduplicate naturally.

**FTS.** `notes_fts` is an FTS5 virtual table over `notes` kept in sync via
insert/update/delete triggers. The UPDATE pair uses **BEFORE UPDATE** for
the FTS delete (capturing `OLD.id` / `OLD.content`) plus **AFTER UPDATE**
for the FTS insert (writing `NEW`). Using AFTER UPDATE for both steps would
read the already-updated row and accumulate stale tokens.

**Tables** (one row per persisted entity):

| Table | Purpose |
| ----- | ------- |
| `files` | Deduplicated path FK target |
| `settings` | Vitest config snapshots, keyed by hash |
| `settings_env_vars` | Env vars per settings snapshot |
| `test_runs` | Per-project run records with summary stats |
| `scoped_files` | Files included in scoped runs |
| `test_modules` | Test modules per run |
| `test_suites` | Suites (describe blocks) per module |
| `test_cases` | Individual cases per module; `created_turn_id` FK enables D2 binding rule 1 |
| `test_errors` | Errors with diffs / stacks; `signature_hash` FK to `failure_signatures` |
| `stack_frames` | Parsed frames; carries `source_mapped_line` and `function_boundary_line` |
| `tags` | Deduplicated tag names |
| `test_case_tags` / `test_suite_tags` | Tag associations |
| `test_annotations` | Notice / warning / error annotations |
| `test_artifacts` / `attachments` | Artifacts and binary blobs |
| `import_durations` | Module import timing |
| `task_metadata` | Key-value metadata |
| `console_logs` | Per-test stdout/stderr capture |
| `test_history` | Per-test sliding-window history |
| `coverage_baselines` | Auto-ratcheting high-water marks |
| `coverage_trends` | Per-project trend entries |
| `file_coverage` | Per-file coverage per run |
| `source_test_map` | Source file → test module mapping |
| `notes` | Scoped notes with threading and expiration |
| `sessions` | Claude Code conversations; `cc_session_id` unique, `agent_kind`, `parent_session_id` self-FK |
| `turns` | Per-session turn log; `payload` is JSON-stringified `TurnPayload`; `type` CHECK matches the union discriminators |
| `tool_invocations` | Flattened projection over `tool_result` payloads (one row per result turn) |
| `file_edits` | Flattened projection over `file_edit` payloads (1:1 with `file_edit` turns) |
| `hypotheses` | Agent hypotheses with `cited_test_error_id` / `cited_stack_frame_id` evidence FKs |
| `commits` | Git commit metadata, idempotent on `sha` |
| `run_changed_files` | Files changed for a run; `run_id NOT NULL` |
| `run_triggers` | 1:1 with `test_runs`; CHECK over the trigger taxonomy |
| `build_artifacts` | Captured tsc/biome/eslint output |
| `tdd_sessions` | TDD session goal + outcome; `session_id` FK to `sessions(id)`; `run_id TEXT` (nullable, unique-per-session-id when set) |
| `tdd_session_goals` | Tier-2 goals decomposed from a session objective |
| `tdd_session_behaviors` | Tier-3 atomic red-green-refactor units; `goal_id` FK |
| `tdd_behavior_dependencies` | Junction table for behavior ordering, replacing the old JSON-in-TEXT column |
| `tdd_phases` | Phase transitions; `behavior_id` FK CASCADE on delete |
| `tdd_artifacts` | Evidence per phase; `phase_id` FK; `behavior_id` FK enables behavior-scoped queries without joining through phases |
| `failure_signatures` | `signature_hash` PK; `last_seen_at` bumped on recurrence |
| `hook_executions` | Vitest hook lifecycle |
| `mcp_idempotent_responses` | Cached MCP mutation results, composite PK `(procedure_path, key)` |

**Plus** `notes_fts` (FTS5 virtual table over `notes`).

**Why `tdd_artifacts.behavior_id` is separate from `tdd_phases.behavior_id`.**
Both columns exist. `tdd_phases.behavior_id` records which behavior the
phase is for; `tdd_artifacts.behavior_id` denormalizes that link onto the
artifact row so behavior-scoped artifact queries don't have to join through
phases. The denormalization is small and the read pattern is hot
(orchestrator resume).

**Why `failure_signatures.last_seen_at` exists.** `first_seen_at` is the
historical anchor; `last_seen_at` is the recency cursor. On recurrence,
`writeFailureSignature` increments `occurrence_count` AND refreshes
`last_seen_at` via `ON CONFLICT(signature_hash) DO UPDATE`. Consumers can
sort/filter by recency without a follow-up join.

**Why `tdd_behavior_dependencies` is a junction table.** It replaced a JSON
array column on `tdd_session_behaviors`. The junction has a reverse-lookup
index on `depends_on_id` so "what depends on behavior X" is a single
indexed read; the JSON column required scanning every row. See
[./decisions.md](./decisions.md) D14 for the trade-off.

**Why `mcp_idempotent_responses` keys on a composite `(procedure_path, key)`
PK.** Different procedures can compute the same key from the same input
(e.g. `hypothesis_record` and `hypothesis_validate` both key on session id +
content). Keying on the procedure path makes those cache slots independent.

For full DDL, see the migration files; do not duplicate them here.

## Console output format (rendered shape)

The default reporter prints to `process.stdout` via the markdown formatter,
which uses the `ansi()` helper that no-ops when `NO_COLOR` is set. The
formatter source at `packages/sdk/src/formatters/markdown.ts` is canonical.

Three modes controlled by `consoleOutput`:

- `"failures"` (default) — tiered output based on run health
- `"full"` — same tiered format, includes passing test details
- `"silent"` — no console output, database only

The output uses three tiers based on run health:

- **Green** (all pass, targets met) — minimal one-line summary
- **Yellow** (pass but below targets) — improvements needed plus CLI hint
- **Red** (failures / threshold violations / regressions) — full detail with
  CLI hints, suggested next-step commands, and the `[new-failure]` /
  `[persistent]` / `[recovered]` classification labels alongside failing test
  names

Examples drift; the formatter source is canonical.

## Error handling

DataStore writes wrap their SQL in `Effect.try`, catching failures as
`DataStoreError` tagged with `operation`, `table`, and a `reason` extracted
via `extractSqlReason(e)` so the underlying SQLite message
(e.g. `"SQLITE_BUSY: database is locked"`,
`"UNIQUE constraint failed: ..."`) surfaces rather than the generic
`"Failed to execute statement"` SqlError wrapper. The error's `message`
property is set to `[operation table] reason` so `Cause.pretty()` produces
useful output. Logged to stderr; never crashes the test run.

DataReader reads use the same pattern; reads on missing data return empty
records rather than failing.

`DiscoveryError` (project discovery) follows the same `[operation path]
reason` message format. The CLI reports the issue and continues with
available data.

Migration failures: if the migration promise rejects, `AgentReporter` prints
`formatFatalError(err)` to stderr and returns early without writing data.

Missing `GITHUB_STEP_SUMMARY`: skipped silently — running outside GitHub
Actions is a normal mode, not an error.

Coverage duck-type mismatch: `CoverageAnalyzer` returns `Option.none()` and
the coverage section is silently skipped — the reporter still runs.

The TDD error envelope (`packages/mcp/src/tools/_tdd-error-envelope.ts`)
catches tagged TDD errors at the MCP boundary and surfaces them as
success-shape `{ ok: false, error: { _tag, ..., remediation } }` responses
so the orchestrator can recover without seeing a tRPC-level failure.
