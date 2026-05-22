---
status: current
module: vitest-agent-reporter
category: architecture
created: 2026-05-06
updated: 2026-05-21
last-synced: 2026-05-21
completeness: 96
related:
  - ../architecture.md
  - ../components.md
  - ../decisions.md
  - ../data-structures.md
  - ./plugin.md
  - ./reporter.md
  - ./cli.md
  - ./mcp.md
  - ./ui.md
dependencies: []
---

# SDK package (`vitest-agent-sdk`)

The no-internal-dependencies base. Owns the data layer, all shared services
and layers, formatters, error types, schemas, SQLite migrations, SQL
helpers, the XDG path-resolution stack, the public reporter contract types,
and the sidecar dispatch core. Anything used by more than one runtime
package lives here; anything used by exactly one package stays in that
package.

**npm name:** `vitest-agent-sdk`
**Location:** `packages/sdk/`
**Internal dependencies:** none
**Entry points:** three — `.` (the main barrel), `./dispatch` (the sidecar
dispatch core), `./testing` (in-process SQLite test infrastructure)

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
- **ExecutorResolver** — maps environment to executor role (`human`,
  `agent`, `ci`). Simplified to env-only mapping when the per-executor
  console matrix landed; the plugin's `configureVitest` computes the
  same mapping inline to avoid spinning up an Effect runtime, and the
  service is kept for downstream callers that already run inside one.
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

### Agent-agnostic taxonomy services (Phases 1–4)

The agent-taxonomy refactor added five services to the SDK. All five
live in `packages/sdk/src/services/`:

- **ProjectIdentity** — 5-source fallback resolver for the canonical
  per-project identity (`{ projectKey, projectDir, source }`).
  Sources tried in order: explicit option, `vitest-agent.config.toml`
  `projectKey`, `git config remote.origin.url` (canonicalized),
  `package.json#repository.url` (parsed and canonicalized), normalized
  `package.json#name`. Fails with `ProjectIdentityNotResolvableError`
  listing every source attempted. The sidecar CLI's three `_internal`
  subcommands call this against `--cwd` to compute the per-project
  data store directory.
- **RunContext** — captures `{ branch, commitSha, dirty, upstream,
  worktreeDir }` via `git rev-parse` calls. Used by the reporter at
  test-run time to stamp the seven `git_*` and three `host_*` columns
  on every `test_runs` row, and by `_internal register-agent` to
  capture the agent's inherited `start_git_*` context at registration.
  Detached-HEAD state surfaces as literal `'HEAD'` for `branch` with
  `commit_sha` as the reliable identifier.
- **PerClientSessionMap** — read/write surface over the per-client
  `sessions.db`. Two table families: `conversation_map`
  (`transcript_path` → canonical UUID) and `session_map` (host
  `session_id` → `conversation_id`, `project_dir`, `main_agent_id`).
  Hot path is `lookupByProjectDir(projectDir)` which uses the partial
  index on `WHERE ended_at IS NULL` to find the active main agent in
  this project. Used as the dev / test fallback when
  `CLAUDE_ENV_FILE` env injection isn't available.
- **DiscoveryRegistry** — read/write surface over the global
  `registry.db`. Single STRICT `known_projects` table; the registrar
  upserts on `register-agent`. Used by cross-project tooling
  (planned) to list every project the user has ever run
  vitest-agent against without scanning the filesystem.
- **idempotency** — module-level helper functions
  (`deriveIdempotencyKey`, `IdempotencyHit`) that compose with
  `DataStore.registerAgent` and the tRPC middleware. Same SHA-256
  base32(26) algorithm everywhere.

### Schemas added for the taxonomy

- **`schemas/Agent.ts`** — `AgentRow`, `RegisterAgentInput`,
  `Agent` (the application-level brand), plus the `AgentType` literal
  union with the `${hostKind}-` prefix invariant validated at the MCP
  boundary.
- **`schemas/Identity.ts`** — `ProjectIdentity` (`{ projectKey,
  projectDir, source }`), the `ProjectIdentitySource` literal union
  (`option`, `config-toml`, `git-remote`, `package-json-repository`,
  `package-json-name`), and `ProjectIdentityNotResolvableError`.

### Utilities added for the taxonomy

`packages/sdk/src/utils/`:

- **`canonicalize-git-url.ts`** — normalizes every git URL form
  (`git@`, `https://`, `ssh://`, mixed case, with/without `.git`) to a
  single `host/org/repo` shape. Replaces `/` with `__` for the
  filesystem-safe `projectKey`. Used in the `ProjectIdentity`
  git-remote and package-json-repository sources to ensure
  `git@github.com:org/repo.git` and `https://GitHub.com/Org/Repo`
  resolve to the same `projectKey`.
- **`match-vitest-command.ts`** — pattern-matches a Bash command
  string against five Vitest invocation patterns
  (`vitest run`, `vitest`, `pnpm vitest`, `pnpm <script>` →
  one-hop indirection through `package.json#scripts`, etc.). Used by
  `_internal inject-env` to decide whether to prepend the
  `VITEST_AGENT_*` env prefix to the user's Bash command.
- **`probe-host-metadata.ts`** — single-shot probe for the
  `host_source` / `host_value` / `host_metadata` triple stamped on
  every `test_runs` row. Resolves the most specific probe first
  (`TMUX_PANE`, `WT_SESSION`, `GITHUB_RUN_ID`, etc.) and falls back to
  `null`.
- **`resolve-project-key-from-cwd.ts`** — thin convenience over
  `ProjectIdentity.resolve` plus `normalizeWorkspaceKey` for callers
  that want only the path-safe `projectKey` string and don't need
  the full `{ projectKey, projectDir, source }` record.

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
  `TddTaskNotFoundError`, `TddTaskAlreadyEndedError`,
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
| `Common.ts` | Shared literals (`TestState`, `Environment`, `Executor`, `OutputFormat`, `DetailLevel`, `HumanConsoleMode`, `AgentConsoleMode`, `CiConsoleMode`, and the union `ConsoleMode`) |
| `AgentReport.ts` | The test-run report shape and its constituents |
| `Coverage.ts` | Coverage report shapes |
| `Thresholds.ts` | Coverage threshold and resolved-threshold shapes |
| `Baselines.ts` | Coverage baseline shapes |
| `Trends.ts` | Coverage trend shapes |
| `CacheManifest.ts` | Cache manifest shapes (legacy file-based manifest discovery) |
| `CoverageLevel.ts` | `CoverageLevel` Effect Schema class with five named presets (`none`, `basic`, `standard`, `strict`, `full`), `.withPerFile()` builder, and `.extend({})` override method. Also exports `CoverageLevelName`, `CoverageInput`, and `resolveCoverageInput`. Also exports `validateCoverageConfig`; the plugin no longer calls it (the `ConfigValidation` service is the read path) and it is kept as a public helper for downstream callers |
| `Options.ts` | After T7: only `ConsoleOutputs`, `AgentPluginOptions`, and `AgentReporterOptions`. `AgentPluginOptions` is the 5-field shape — `console`, `coverageTargets`, `transport` on the schema; `reporter` and `onRunEvent` are function-typed and live on the plugin's `AgentPluginConstructorOptions` companion interface. `AgentReporterOptions` is intentionally tiny — one field (`projectFilter`) — and is the narrow per-instance config bag the reporter implementation accepts; most users never see it. The pre-T7 `CoverageOptions` and `FormatterOptions` schemas were unused dead code and were deleted in the same pass |
| `CoverageTargets.ts` | Extracted from `Options.ts` in T7. Exports `CoverageTargets` and the nested `CoverageTargetsMetrics` schemas. `CoverageTargets` is a `Schema.Record` whose keys are arbitrary strings (treated as either a top-level metric name or a glob pattern) and values are `Schema.Union(Schema.Positive, Schema.Literal(true), CoverageTargetsMetrics)`. A decode-time refinement rejects `true` at any key other than `"100"` so `{ statements: true }` fails parse rather than silently flowing through to a runtime parser that only honors the canonical shorthand at key `"100"`. Negatives and zeros are rejected at decode time |
| `Transport.ts` | New in T7. Single-member discriminated union `Schema.Union(Schema.Struct({ kind: Schema.Literal("local") }))`. Modeled as a union from day one so the 3.0 cloud-backend swap (D1, Turso, etc.) lands as a pure addition of union members rather than a schema-shape change. See [../decisions.md](../decisions.md) D40 |
| `validate-coverage-targets-shape.ts` (in `utils/`) | Pure helper `validateCoverageTargetsShape(input): { errors, warnings, info }`. Walks raw input and emits structured diagnostics with pinpointed paths: `INVALID_TARGET_VALUE` (zero or negative numbers, at the top level or inside glob-pattern entries) and `PERFILE_ON_TARGETS` (the `perFile` key set inside `coverageTargets` rather than on `coverage.thresholds.perFile`). Consumed by the plugin's `ConfigValidation` rule registry |
| `RunEvent.ts` | Discriminated union over the 11 `RunEvent` variants (`RunStarted`, `ModuleQueued`, `ModuleStarted`, `TestStarted`, `TestFinished`, `ModuleFinished`, `CoverageReady`, `ThresholdViolation`, `FailureClassified`, `SuggestedAction`, `RunFinished`). Fed by the plugin's streaming callbacks and consumed by `vitest-agent-ui`'s reducer |
| `RenderState.ts` | The projected shape the `vitest-agent-ui` reducer folds events into (`phase`, `runId`, `modules`, `moduleOrder`, `totals`, `coverage`, `failures`, `suggestedActions`). Both the agent string renderer and the Ink tree read this shape |
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

`ResolvedReporterConfig` carries a required `readonly coverageMode: "full" |
"ui-only"` field. The plugin resolves it from Vitest's native
`coverage.enabled` (false maps to `ui-only`; anything else maps to `full`)
and threads it through `buildReporterKit` into every reporter's kit. The
internal `AgentReporter` lifecycle class reads `coverageMode` to gate the
persistence pipeline in `onTestRunEnd` (see [./plugin.md](./plugin.md) for
the short-circuit). Locking `coverageMode` on the resolved kit rather than
on `AgentReporterOptions` keeps it as a per-run resolved fact — see
[../decisions.md](../decisions.md) for the rationale.

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
- **`registerAgent` is idempotency-aware.** `DataStore.registerAgent`
  composes `deriveIdempotencyKey(agentType, parentOrSentinel,
  clientNonce)` then performs an upsert against the
  `(session_id, idempotency_key)` UNIQUE index. Returns either a
  fresh `Agent` or an `IdempotencyHit` carrying the already-registered
  row. The `_internal register-agent` CLI surface forwards the hit
  state back to the SessionStart hook through the JSON output so the
  hook can short-circuit re-export of env without re-writing
  rows.
- **`upsertSession` and parent-walking reads.** `DataStore.upsertSession`
  is idempotent on `chat_id` and sets `parent_session_id` on
  insert. `DataReader.findSessionsByChatPrefix` and
  `DataReader.listTddTasksForSession({ walkParents })` traverse
  the `parent_session_id` chain so artifact/turn writes always land
  under the correct canonical `sessions.id` even when Claude Code
  rotates `chat_id` mid-window. See the CLI's
  `resolveSessionForRecording` helper for the consumer side.
- **Per-run git + host context on `test_runs`.** The reporter calls
  `RunContext.capture` and `probeHostMetadata` immediately before
  `writeRun`, and `DataStore.writeRun` accepts the seven `git_*` and
  three `host_*` columns. Detached-HEAD state surfaces as literal
  `'HEAD'` for `git_branch`.
- **Action-table attribution.** `writeRun`, `writeHypothesis`,
  `writeNote`, and `writeTddPhase` accept `actor_type` / `agent_id` /
  `conversation_id`. The DataStore boundary upholds the SQL CHECK
  constraints (`agent_id` non-NULL iff `actor_type='agent'`,
  `conversation_id` NULL when `actor_type != 'agent'`).

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
- **`getTddTaskById` materializes the full tree in one round-trip.** It
  pre-rolls every join (sessions → goals → behaviors → phases → artifacts)
  via batched IN-clause joins so `tdd_task({ action: "get" })` returns
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
- **`listTddArtifactsForTask` + `walkParents`.** The new reader
  drives the `tdd_artifact_list` MCP tool. With
  `{ walkParents: true }` it follows the `sessions.parent_session_id`
  chain so the orchestrator finds artifact ids even when
  `chat_id` rotated mid-cycle. Returns the most recent matching
  artifact first so phase-transition auto-resolve can pick the head
  without sorting.
- **`findActiveSubagentSession` resolves per-call subagent identity.** Returns the most-recently-started subagent session whose `parent_session_id` matches the supplied parent id and whose `ended_at IS NULL`. The MCP server's boot context names only the main agent; this reader call is how the `hypothesis (action: record)` handler attributes writes to the active `tdd-task` subagent instead of the main session.
- **Flaky classification requires a fail-after-pass.** The `listFlakyTests` reader query (backing `HistoryTracker.classify`) changed to require that at least one failure occurred at or after the earliest pass — `MAX(timestamp WHERE failed) >= MIN(timestamp WHERE passed)`. A monotonic red-to-green cycle (all failures precede all passes) classifies as `recovered`, not `flaky`. Timestamps are ISO-8601 strings and compare lexicographically.

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

The per-project data-store migration set is now consolidated to a
single file: **`0001_initial.ts`**. Per the pre-2.0 policy, every
schema change before 2.0 ships edits this file directly — there are
no ALTERs, no backfills, no incremental migration history to apply.
The prior `0002_comprehensive.ts` was folded back into
`0001_initial.ts`. Dev databases are deleted and re-created when the
canonical shape changes.

Two additional migration files cover the per-client and registry
SQLite scopes added for the agent-agnostic taxonomy (Phases 1–4):

- **`session_map_0001_initial.ts`** — `conversation_map`
  (`transcript_path` → canonical `conversation_id`) and `session_map`
  (host `session_id` → `conversation_id`, `project_dir`,
  `main_agent_id`) STRICT tables. Plus four indexes including the
  partial `(project_dir) WHERE ended_at IS NULL` for the
  `lookupByProjectDir` hot path. Lives at the per-client path
  `${CLAUDE_PLUGIN_DATA}/sessions.db`.
- **`registry_0001_initial.ts`** — single STRICT `known_projects`
  table indexed by `project_key`. Lives at the cross-project path
  `$XDG_DATA_HOME/vitest-agent/registry.db`. WAL plus
  `busy_timeout=5000`.

**Pre-2.0 migration discipline.** Edit `0001_initial.ts` (or its
session-map/registry siblings) directly. Do not add `0002_*.ts`. Do
not ALTER. Developers delete `data.db` on every breaking schema
change. Post-2.0, the standard incremental-migration discipline
takes over.

`packages/sdk/src/sql/rows.ts` defines `Schema.Struct` row shapes
(snake-case) for every table. `packages/sdk/src/sql/assemblers.ts` joins
these rows into composite domain types (`AgentReport`, `CoverageReport`,
the TDD tree, etc.). The application-level (camelCase) shapes for the TDD
hierarchy live in `schemas/Tdd.ts`.

For the table inventory and column-level details see
[../data-structures.md](../data-structures.md).

## Testing subpath

`packages/sdk/src/testing/` — exported via the `vitest-agent-sdk/testing`
subpath (`"./testing": "./src/testing/index.ts"` in `package.json`).

Provides in-process SQLite test infrastructure without requiring the full
Effect runtime. Two layers:

- **`makeTestLayer(filename)`** — builds a fully-migrated SQLite layer from
  a path or `:memory:`. Composes `DataStoreLive`, `DataReaderLive`,
  `SqliteMigrator` (running both migrations), `SqliteClient`, and
  `NodeContext`. Tests pass this as the `provide` argument to `Effect.runPromise`
  or as the layer in `it.effect`.
- **`DataStoreTestLayer`** — `makeTestLayer(":memory:")`. The shared in-memory
  convenience for tests that don't need a persistent file.

Five preset factories seed representative DB states for use across test
files. Each accepts `filename` and internally calls `makeTestLayer`, then
seeds data via `Layer.effectDiscard`:

| Factory | Seeds |
| ------- | ----- |
| `empty(filename)` | Migrated DB, no rows |
| `singlePassingRun(filename)` | One run, one module, three passing tests |
| `withFailures(filename)` | One run, one module, two failing tests |
| `flaky(filename)` | Two runs with opposing outcomes (flaky classification) |
| `withTddTask(filename)` | One session, one TDD session, one goal, two behaviors |

**When to use.** Import from `vitest-agent-sdk/testing`. The preset layers
remove boilerplate from per-test fixture setup. Use `empty` for tests that
need precise control; use the named presets when the scenario matches to
keep tests concise.

## Dispatch subpath

The sidecar dispatch core is exported through a dedicated narrow entry
point, `vitest-agent-sdk/dispatch` (barrel `packages/sdk/src/dispatch.ts`).
It re-exports `dispatch` / `DispatchResult` (`src/sidecar-dispatch.ts` — the
`dispatch(argv)` argv dispatcher plus its hand-rolled flag parser), `injectEnv`
/ `InjectEnvInput` (`src/internal-inject-env.ts`), and `exitCodeForTag`
(`src/exit-code-for-tag.ts`). These symbols moved into the SDK from
`vitest-agent-cli` to break a workspace dependency cycle — see
[./cli.md](./cli.md) and [./sidecar.md](./sidecar.md).

**Why a dedicated entry, not the main barrel.** The four per-platform
`vitest-agent-sidecar-<platform>` SEA binaries import `dispatch` from this
subpath, and the SEA must stay small. Importing from the `.` barrel would
force the bundler to start from the full module graph — Effect, the SQLite
data layer, migrations, every service — and tree-shake it away; the dedicated
`./dispatch` entry guarantees a minimal reachable graph from the start. The
moved symbols are deliberately **not** re-exported from the main barrel.

## CURRENT_SDK_VERSION

`packages/sdk/src/index.ts` exports `CURRENT_SDK_VERSION: string`,
inlined from `process.env.__PACKAGE_VERSION__` by the SDK's
`rslib.config.ts` `define` block at build time. The constant is the
authoritative version reference for the cross-package drift checks
wired in the plugin factory, the MCP bin, and the CLI bin — each peer
compares its own `CURRENT_<PKG>_VERSION` against this one at init and
emits a stderr warning on mismatch (see D36).

A shared shape test at
`packages/sdk/__test__/version-constants-shape.test.ts` imports all six
`CURRENT_*_VERSION` constants through dist/dev and asserts they are
non-empty strings and lockstep-equal. Each runtime package also has a
local `__test__/version-constant.test.ts` that imports its own
constant through dist/dev (so it sees the substituted literal, not
the source-time `process.env.__PACKAGE_VERSION__!` expression) and
asserts it matches that package's `package.json#version`.

## Output pipeline

`packages/sdk/src/layers/OutputPipelineLive.ts` composes the five chained
services:
