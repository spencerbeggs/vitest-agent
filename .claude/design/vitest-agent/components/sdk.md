---
status: current
module: vitest-agent-reporter
category: architecture
created: 2026-05-06
updated: 2026-05-07
last-synced: 2026-05-07
completeness: 90
related:
  - ../architecture.md
  - ../components.md
  - ../decisions.md
  - ../data-structures.md
  - ./plugin.md
  - ./reporter.md
  - ./cli.md
  - ./mcp.md
dependencies: []
---

# SDK package (`vitest-agent-sdk`)

The no-internal-dependencies base. Owns the data layer, all shared services
and layers, formatters, error types, schemas, SQLite migrations, SQL
helpers, the XDG path-resolution stack, and the public reporter contract
types. Anything used by more than one runtime package lives here; anything
used by exactly one package stays in that package.

**npm name:** `vitest-agent-sdk`
**Location:** `packages/sdk/`
**Internal dependencies:** none

**Key external dependencies:**

- `xdg-effect` — `AppDirs` namespace, `XdgLive` layer
- `config-file-effect` — TOML config file resolution with `FirstMatch`
  strategy across `WorkspaceRoot`/`GitRoot`/`UpwardWalk` resolvers
- `workspaces-effect` — `WorkspaceDiscovery`, `WorkspaceRoot`,
  `WorkspaceRootNotFoundError`
- `acorn` + `acorn-typescript` — AST parser used by `findFunctionBoundary`
  to identify the smallest enclosing function for a given source line.
  TypeScript plugin lets us parse `.ts` sources with type annotations,
  generics, decorators, and `as` casts without throwing
- `effect`, `@effect/platform`, `@effect/platform-node`, `@effect/sql`,
  `@effect/sql-sqlite-node`, `std-env`

For decisions referenced throughout: see [../decisions.md](../decisions.md).

---

## Effect services

`packages/sdk/src/services/`. Each service is an `Context.Tag` with a typed
interface. Live implementations use `@effect/platform` and
`@effect/sql-sqlite-node` for I/O; test implementations use mock state
containers.

The shared package owns the services every runtime needs:

- **DataStore** — writes test data to SQLite. See *DataStore* below.
- **DataReader** — reads test data from SQLite. See *DataReader* below.
- **EnvironmentDetector** — wraps `std-env` for four-environment detection
  (`agent-shell`, `terminal`, `ci-github`, `ci-generic`).
- **ExecutorResolver** — maps environment + plugin mode to executor role
  (`human`, `agent`, `ci`).
- **FormatSelector** — selects output format from executor role and any
  explicit override. The optional `environment` parameter exists for the
  `ci-github` branch alone (auto-selecting `ci-annotations`).
- **DetailResolver** — determines output detail level from executor role
  and run health (`hasFailures`, `belowTargets`, `hasTargets`).
- **OutputRenderer** — renders `AgentReport` arrays through the selected
  formatter.
- **ProjectDiscovery** — glob-based test file discovery. Used by the CLI;
  has no SQLite dependency.
- **HistoryTracker** — classifies test outcomes against stored history (see
  *Failure history & classification* below).
- **VitestAgentReporterConfigFile** — typed `Context.Tag` for the loaded
  TOML config; live layer is `ConfigLive(projectDir)`.

`CoverageAnalyzer` is the one service that lives outside this package — it
stays with the plugin because only the lifecycle class consumes istanbul
data. See [./plugin.md](./plugin.md).

## Effect layers

`packages/sdk/src/layers/`. Live and test implementations for the shared
services. The composite layers each runtime needs (`ReporterLive`,
`CliLive`, `McpLive`) live in their respective packages; only the shared
composite `OutputPipelineLive` lives here, because every runtime composes
it.

- One-to-one live layers per service.
- `LoggerLive(logLevel?, logFile?)` — structured NDJSON logging factory.
  See *LoggerLive* below.
- `OutputPipelineLive` — composite of EnvironmentDetectorLive +
  ExecutorResolverLive + FormatSelectorLive + DetailResolverLive +
  OutputRendererLive.
- `ConfigLive(projectDir)` — TOML config loader anchored at `projectDir`
  (not `process.cwd()`) so the plugin-spawned MCP server sees the right
  config when invoked from elsewhere.
- `PathResolutionLive(projectDir)` — composite of `XdgLive`, `ConfigLive`,
  and `WorkspacesLive`. See *XDG path resolution* below.

Test layers exist for `DataStore`, `EnvironmentDetector`,
`ProjectDiscovery`, and `HistoryTracker`.

## Error types

`packages/sdk/src/errors/`. Tagged error types for Effect failure channels.

- `DataStoreError` — `{ operation, table, reason }`. Constructor sets a
  derived message via `Object.defineProperty` so `Cause.pretty()` surfaces
  the operation/table/reason instead of the default "An error has
  occurred". Also exports `extractSqlReason(e)` which pulls
  `SqlError.cause.message` (the actual SQLite text like `SQLITE_BUSY: ...`)
  instead of the generic `"Failed to execute statement"` wrapper.
  `DataStoreLive` and `DataReaderLive` route every `Effect.mapError` site
  through this so the underlying SQLite text reaches the user.
- `DiscoveryError` — same derived-message pattern, scoped to
  glob/read/stat operations.
- `PathResolutionError` — raised when the data directory can't be
  resolved. The most common case (missing workspace identity) usually
  surfaces as the underlying `WorkspaceRootNotFoundError`; this error
  covers path-resolution failures that don't already have a more-specific
  tagged error.
- `TddErrors` — tagged errors for the goal/behavior CRUD surface
  (`GoalNotFoundError`, `BehaviorNotFoundError`,
  `TddSessionNotFoundError`, `TddSessionAlreadyEndedError`,
  `IllegalStatusTransitionError`). Validation lives at the DataStore
  boundary, not in SQL triggers — triggers would surface as raw `SqlError`
  and defeat the typed-error contract. The MCP boundary catches these via
  `_tdd-error-envelope.ts` and surfaces success-shape `{ ok: false, error:
  { _tag, ..., remediation } }` responses; tRPC `TRPCError` envelopes are
  reserved for transport-level failures.

## Schemas

`packages/sdk/src/schemas/`. Single source of truth for all data
structures. Defines Effect Schema definitions with `typeof Schema.Type` for
TypeScript types and `Schema.decodeUnknown`/`Schema.encodeUnknown` for JSON
encode/decode.

| File | Contents |
| ---- | -------- |
| `Common.ts` | Shared literals (`TestState`, `Environment`, `Executor`, `OutputFormat`, `DetailLevel`, etc.) |
| `AgentReport.ts` | The test-run report shape and its constituents |
| `Coverage.ts` | Coverage report shapes |
| `Thresholds.ts` | Coverage threshold and resolved-threshold shapes |
| `Baselines.ts` | Coverage baseline shapes |
| `Trends.ts` | Coverage trend shapes |
| `CacheManifest.ts` | Cache manifest shapes (legacy file-based manifest discovery) |
| `Options.ts` | `AgentReporterOptions`, `AgentPluginOptions`, `CoverageOptions`, `FormatterOptions` |
| `History.ts` | `TestRun`, `TestHistory`, `HistoryRecord` |
| `Config.ts` | `VitestAgentConfig` for the optional `vitest-agent.config.toml`. Both fields (`cacheDir?`, `projectKey?`) are optional; absence falls back to deriving the path from the workspace's `package.json` `name` |
| `Tdd.ts` | Application-level (camelCase) shapes for the three-tier hierarchy: `GoalStatus`/`BehaviorStatus`, `GoalRow`, `BehaviorRow`, `GoalDetail`, `BehaviorDetail`. SQL row shapes (snake_case) live in `sql/rows.ts`; these are the API shapes |
| `ChannelEvent.ts` | Discriminated union over the orchestrator's progress events. `tdd_progress_push` validates payloads against this union. Also exports `BehaviorScopedEventTypes` — the subset whose `goalId`/`sessionId` the MCP server resolves server-side from `behaviorId` |
| `turns/` | Discriminated `TurnPayload` union over the per-payload schemas (user-prompt, tool-call, tool-result, file-edit, hook-fire, note, hypothesis). The `record` CLI validates JSON-stringified payloads against this union before writing `turns.payload` |

Istanbul duck-type interfaces remain as TypeScript interfaces, not schemas
— they describe an external library's shape we observe.

## Public reporter contract

`packages/sdk/src/contracts/reporter.ts`. The plugin/reporter split's load-
bearing types: `ResolvedReporterConfig`, `ReporterKit`,
`ReporterRenderInput`, `VitestAgentReporter`, `VitestAgentReporterFactory`,
`RenderedOutput`. These live in the SDK so the plugin and reporter packages
can share them without either taking a runtime dependency on the other.

For the contract semantics see [./reporter.md](./reporter.md); for how the
plugin assembles the kit and routes outputs see [./plugin.md](./plugin.md).

## DataStore

`packages/sdk/src/services/DataStore.ts`. The write side of the data layer.
Methods cover every persistence concern: settings/runs/modules/suites/test
cases/errors/coverage/history/baselines/trends, the source-to-test mapping,
notes CRUD, sessions and turn fanout, idempotent MCP responses, hypothesis
records and validations, the TDD session/goal/behavior/phase/artifact
surface, commit metadata and per-run changed files, session pruning, and a
test-case-to-turn backfill.

The non-obvious pieces:

- **Turn fanout.** `writeTurn` writes to `turns` and, for `file_edit` and
  `tool_result` payload types, also fans out to per-turn detail tables
  (`file_edits`, `tool_invocations`) inside the same SQL transaction via
  `sql.withTransaction`. Other payload types write only to `turns`.
- **MCP tool-name normalization.** For `tool_result` turns, the live layer
  strips the Claude Code MCP prefix before inserting into
  `tool_invocations`. Claude Code sends tool names in the form
  `mcp__<server>__<name>`; only the bare `<name>` suffix is stored (e.g.
  `note_create` rather than `mcp__plugin_vitest-agent_mcp__note_create`).
  Any name that does not start with `mcp__` is stored as-is.
- **Tool-pair caveat.** `tool_invocations` rows derive from `tool_result`
  turns, **not** from `tool_call` turns. Consumers needing strict
  request/response pairing must join through `payload.tool_use_id`.
- **`turn_no` is auto-assigned.** When omitted, the live layer computes
  `MAX(turn_no)+1` per session inside the same transaction.
- **Failure signature upsert.** `writeFailureSignature` is idempotent on
  `signature_hash`. New rows record `first_seen_run_id` and stamp
  `last_seen_at = first_seen_at`; on conflict, `occurrence_count`
  increments and `last_seen_at` refreshes to the new sighting.
- **Goal/behavior ordinal allocation.** `createGoal` and `createBehavior`
  use single-statement allocation (`INSERT ... SELECT
  COALESCE(MAX(ordinal), -1) + 1 ... WHERE session_id = ?`) so concurrent
  inserts under one session never collide without `BEGIN IMMEDIATE`.
- **Status validation at the DataStore boundary, not in SQL triggers.**
  Closed-lifecycle transitions (`pending → in_progress → done|abandoned`,
  terminal states cannot transition further) raise typed
  `IllegalStatusTransitionError`. Triggers would surface as raw `SqlError`
  and lose the typed-error contract.
- **`tdd_artifacts` are hook-only.** Per [D7](../decisions.md), the
  artifact write path is the `record tdd-artifact` CLI subcommand. The
  agent never writes its own evidence.
- **Phase-transition transactional invariant.** `writeTddPhase` opens a
  new phase row **and closes the prior open phase in the same transaction**
  so the per-session phase ledger is always consistent.
- **Idempotent response persistence is best-effort.**
  `recordIdempotentResponse` uses `INSERT ... ON CONFLICT DO NOTHING`. The
  middleware swallows persistence errors — a transient DB failure must not
  surface as a tool error.
- **Pruning preserves session rows.** `pruneSessions(keepRecent)` drops the
  *turn log* of older sessions; the `sessions` rows themselves remain. The
  return shape's `affectedSessions` counts sessions whose turn-log was
  dropped, not sessions deleted.
- **`SettingsInput` lives here, not in the plugin's `capture-settings.ts`.**
  DataStore owns its full input contract; the plugin's util produces values
  matching this shape. This avoids a circular import between plugin and
  SDK.

## DataReader

`packages/sdk/src/services/DataReader.ts`. The read side. Reads compose into
domain types via assembler functions in `sql/assemblers.ts`. Used by every
runtime: the plugin's classification path, the CLI's read commands, the MCP
tools' query paths.

The non-obvious pieces:

- **`getManifest` resolves cacheDir from SQLite metadata.** It calls
  `PRAGMA database_list` and picks the file path of the `"main"` database.
  In-memory databases report empty.
- **Coverage fall-back.** `getCoverage` and `getFileCoverage` only return
  `Option.none()` when **both** `file_coverage` and `coverage_trends` are
  empty. The reporter only writes per-file rows for files below threshold,
  so a passing project with full coverage produces zero per-file rows; in
  that case the query falls back to `coverage_trends` totals.
- **`getTestsForFile` deduplicates.** Uses `SELECT DISTINCT ... ORDER BY
  f.path` because `source_test_map` accumulates a row per run.
- **`getTddSessionById` materializes the full tree in one round-trip.** It
  pre-rolls every join (sessions → goals → behaviors → phases → artifacts)
  via batched IN-clause joins so the MCP `tdd_session_get` tool returns
  the entire three-tier tree without N+1 reads.
- **`resolveGoalIdForBehavior` is best-effort.** Used by `tdd_progress_push`
  to resolve `goalId` (and transitively `sessionId`) server-side from a
  `behaviorId` for behavior-scoped channel events. Returns `Option.none()`
  if the behavior was deleted; the channel event then falls through with
  the original payload.
- **`getCurrentTddPhase` returns the open phase.** That is, the most recent
  `tdd_phases` row whose `ended_at` is NULL. Used both as the source for
  phase-transition validation and to identify which prior phase to close
  in `writeTddPhase`'s same-transaction roll-over.
- **`getTddArtifactWithContext` reconstructs the D2 evidence-binding
  context.** Joins `tdd_artifacts` with `test_cases`, `turns`, `tdd_phases`,
  and `sessions` so the validator's `CitedArtifact` input is a single read.
- **Acceptance metrics are derived, not stored.** `computeAcceptanceMetrics`
  computes the four spec-Annex-A ratios (phase-evidence integrity,
  compliance-hook responsiveness, orientation usefulness, anti-pattern
  detection rate) on demand from the row history. Metric 2
  (compliance-hook responsiveness) counts `hook_fire` turns whose
  `hook_kind` is `'SessionEnd'`, `'PreCompact'`, **or `'Stop'`** — the
  `Stop` kind is included because the session-end-record hook fires before
  the session-end write and records a `hook_fire` turn regardless of the
  triggering event.

## Formatters

`packages/sdk/src/formatters/`. Pluggable output formatters implementing
the `Formatter` interface (`{ format, render(reports, context) }`). Each
formatter produces `RenderedOutput[]` with `target`, `content`,
`contentType`.

The set covers structured console markdown, GFM for `GITHUB_STEP_SUMMARY`,
raw JSON, silent (no output), terminal (plain text + optional ANSI/OSC-8),
and `ci-annotations` (GitHub Actions workflow commands, auto-selected when
`environment === "ci-github"` AND `executor === "ci"`).

The markdown formatter wires the `osc8` utility into failing-test header
lines via a regex post-processor — gated on `target === "stdout"` AND
`!ctx.noColor` so MCP responses never receive OSC-8 codes. Terminal
hyperlinks are CLI-and-stdout-only.

## XDG path resolution

The data path is a **function of workspace identity, not filesystem
layout**. Closes [issue #39](https://github.com/spencerbeggs/vitest-agent-reporter/issues/39).
See [../decisions.md](../decisions.md) D31.

`packages/sdk/src/utils/resolve-data-path.ts` orchestrates resolution.
Precedence (highest first):

1. Programmatic `options.cacheDir`. Used by the reporter's `ensureDbPath`
   short-circuit when `reporter.cacheDir` is set — skips the heavy
   XDG/workspace layer stack entirely (since `WorkspacesLive` eagerly scans
   lockfiles and walks the package graph at layer construction).
2. `cacheDir` from `vitest-agent.config.toml`.
3. `projectKey` from the same TOML, used as the workspace-key segment under
   the XDG data root.
4. Workspace name from the root `package.json` `name`, resolved via
   `WorkspaceDiscovery`.
5. Fail with `WorkspaceRootNotFoundError`. **No silent fallback to a path
   hash.**

The XDG data root is `AppDirs.ensureData` from `xdg-effect` with
`namespace: "vitest-agent"`. `ensureData` creates the directory if missing
so better-sqlite3 can open without a separate `mkdir`.

`normalizeWorkspaceKey` (`packages/sdk/src/utils/normalize-workspace-key.ts`)
is the path-segment normalizer: replaces `/` with `__` so `@org/pkg`
collapses to `@org__pkg`, replaces any character outside
`[A-Za-z0-9._@-]` with `_`, and collapses runs of underscores produced by
the second step.

`PathResolutionLive(projectDir)` composes `XdgLive`, `ConfigLive`, and
`WorkspacesLive` in one shot. Callers still need to provide `FileSystem`
and `Path` (typically via `NodeContext.layer`).

## TOML config file

Optional `vitest-agent.config.toml` lets users override the XDG default
without code changes. Both fields (`cacheDir`, `projectKey`) are optional.

`projectKey` is the override for the "two unrelated `my-app`s" collision
case, or when a stable key independent of `name` changes is needed.

`ConfigLive(projectDir)` chains `WorkspaceRoot → GitRoot → UpwardWalk`
resolvers. When no file is present, downstream callers use
`config.loadOrDefault(new VitestAgentConfig({}))` to get an empty config —
never an error.

## LoggerLive

`packages/sdk/src/layers/LoggerLive.ts`. Effect-based structured logging
factory. NDJSON to stderr plus optional file logging via `Logger.zip`.
Configured by `logLevel`/`logFile` options with environment-variable
fallbacks (`VITEST_REPORTER_LOG_LEVEL`, `VITEST_REPORTER_LOG_FILE`).

`Effect.logDebug` calls thread through every DataStore/DataReader method
for comprehensive I/O tracing.

## ensureMigrated

`packages/sdk/src/utils/ensure-migrated.ts`. Process-level migration
coordinator that ensures the SQLite database at a given `dbPath` is
migrated **exactly once per process** before any reporter instance reads
or writes.

**Why this exists.** In multi-project Vitest configs, multiple
`AgentReporter` instances share the same `data.db`. On a fresh database,
two connections both starting deferred transactions and then upgrading to
write produced `SQLITE_BUSY` — SQLite's busy handler is not invoked for
write-write upgrade conflicts in deferred transactions. With migration
serialized through this coordinator, subsequent concurrent writes work
normally under WAL mode plus better-sqlite3's busy timeout. See D28.

**Why it lives on `globalThis`.** The cache (`Map<dbPath, Promise<void>>`)
is keyed by `Symbol.for("vitest-agent/migration-promises")`. Vite's
multi-project pipeline can load this module under separate module instances
within one process; a module-local Map would defeat the coordination.

The coordinator suppresses `unhandledRejection` on the cached promise
reference; callers await the returned promise and handle rejection
themselves.

## SQLite migrations and SQL helpers

`packages/sdk/src/migrations/`. Migrations register through `ensureMigrated`,
which feeds them to `@effect/sql-sqlite-node`'s `SqliteMigrator` (WAL
journal mode, foreign keys enabled).

The current migration set is two files: `0001_initial.ts` (the legacy
1.x 25-table schema) and `0002_comprehensive.ts` (the drop-and-recreate
that folds in all 2.0 additions — the goal/behavior hierarchy,
`mcp_idempotent_responses`, the `test_cases.created_turn_id` link,
`failure_signatures.last_seen_at`, and `tdd_sessions.run_id`).
The former separate migration files `0003`–`0006` were deleted and their
content merged into `0002_comprehensive.ts` in-place. `ensureMigrated`'s
`fromRecord` now references only `"0001_initial"` and
`"0002_comprehensive"` — the four numeric keys that once pointed to
`0003`–`0006` are gone.

**Migration discipline.** Per D9, the comprehensive migration is the **last
drop-and-recreate**; future migrations are ALTER-only. The migration
ledger has no content hash, so editing a previously-applied migration in
place does not auto-replay on existing dev DBs — pre-existing dev databases
have to be wiped on first pull when a migration is amended. This is
acceptable for development; production DBs never see edits-in-place.

`packages/sdk/src/sql/rows.ts` defines `Schema.Struct` row shapes
(snake-case) for every table. `packages/sdk/src/sql/assemblers.ts` joins
these rows into composite domain types (`AgentReport`, `CoverageReport`,
the TDD tree, etc.). The application-level (camelCase) shapes for the TDD
hierarchy live in `schemas/Tdd.ts`.

For the table inventory and column-level details see
[../data-structures.md](../data-structures.md).

## Output pipeline

`packages/sdk/src/layers/OutputPipelineLive.ts` composes the five chained
services:
