---
type: DataModel
title: SQLite Schema
description: "The three SQLite databases (per-project data.db, per-client sessions.db, global registry.db), their tables, attribution columns, cascade rules, and migration ledgers, and what breaks when a migration is edited in place."
resource: ../../packages/engine/src/migrations
status: draft
tags:
  - architecture
  - observability
  - tdd
generated:
  by: okfit/claude-code
  at: 2026-10-03T18:15:58Z
  body_sha256: 6f892a665ebfd553c726fd3f7f0312c4840000c86a52823619e00a924e5a30b8
---

# SQLite Schema

## What this covers

Three separate SQLite databases, each with its own migration record and
each opened as an `@effected/store` store: the per-project `data.db`
(`PROJECT_MIGRATIONS` in `migrations/index.ts`, through `makeSqliteStack`),
the per-client session map (`session_map_0001_initial.ts`, the
`SessionMapStore` keyed store), and the global discovery registry
(`registry_0001_initial.ts`, the `RegistryStore` keyed store)[^index]. A maintainer adding a column or table
edits exactly one of these three migration sets — never the wrong one, and
never in place once a migration has shipped.

## The per-project `data.db`

`PROJECT_MIGRATIONS` is `{ "0001_initial": …, "0002_test_artifacts": … }`,
keyed in application order[^index]. `0001_initial.ts` is the consolidated
fresh-install schema (pre-2.0 policy: one canonical migration defines the
whole schema up to that point); every table below except the two `0002`
widenings and the `test_annotations` recreate comes from
it[^migration-0001-header].

### Run and test-result tables

- `files` — one row per source-relative path, referenced by nearly every
  other table via `file_id` so a path string is never duplicated.
- `settings` / `settings_env_vars` — one row per distinct Vitest config
  fingerprint (`hash` PK) plus its captured env vars; `test_runs` FKs to
  `settings.hash` so repeated runs under the same config share one row.
- `test_runs` — one row per reporter invocation: `reason` (`passed` /
  `failed` / `interrupted`), full snapshot-outcome columns, and the
  attribution/git-context columns described below[^migration-0001-test-runs].
- `test_modules` / `test_suites` / `test_cases` — the file → suite → test
  hierarchy for one run, each `ON DELETE CASCADE` from its parent so
  deleting a `test_runs` row (a prune) removes every downstream row
  transitively.
- `test_errors` / `stack_frames` — one row per failure plus its parsed
  stack; `test_errors.signature_hash` FKs to `failure_signatures` with `ON
  DELETE SET NULL` (a stale signature does not orphan the failure row).
- `tags` / `test_case_tags` / `test_suite_tags` — Vitest-native tag
  expressions, many-to-many.
- `test_annotations`, `test_artifacts`, `attachments` — Vitest's
  `context.annotate()` / custom test-artifact surface; see *Migration 0002*
  below.
- `import_durations`, `task_metadata`, `console_logs` — per-module import
  timing, arbitrary key/value metadata scoped to exactly one of
  case/suite/module (a `CHECK` enforces exactly-one), and captured
  `console.log` output.
- `test_history` — a denormalized append log independent of `test_runs`
  retention, keyed `UNIQUE(project, module_path, full_name, timestamp)`, the
  source `HistoryTracker`'s classification reads from.
- `coverage_baselines`, `coverage_trends`, `file_coverage`,
  `source_test_map` — coverage policy state, trend history keyed by
  `targets_hash` (invalidated when `coverageTargets` changes), per-file
  coverage tiers, and the source-to-test correlation the plugin's discovery
  step writes.
- `notes` (+ `notes_fts` and its four triggers) — a hierarchical, FTS5-backed
  note store; `parent_note_id` self-references `ON DELETE CASCADE`.
- `commits`, `run_changed_files`, `run_triggers`, `build_artifacts` — git
  and CI provenance per run.
- `hook_executions` — one row per Vitest lifecycle hook execution, scoped to
  at most one of module/suite/case (`CHECK … <= 1`).
- `failure_signatures` — the write-once-then-increment table `DataStore`'s
  `writeFailureSignature` upserts into (see *DataStore write path*, in
  `okf/modules/engine.md`).
- `mcp_idempotent_responses` — the MCP server's idempotency cache, keyed
  `(procedure_path, key)`.

### The agent-agnostic taxonomy tables

Added on top of the pre-2.0 baseline, in the same `0001_initial.ts`:

- `sessions` — one row per host chat/window (`chat_id` UNIQUE), with
  `agent_kind` (`main` / `subagent`), `parent_session_id` (self-FK, `ON
  DELETE SET NULL`), and the `conversation_id` / `host_kind` columns that
  let a cross-window rollup and a non-Claude-Code host both resolve.
- `agents` — a `STRICT` table of first-class agent invocations:
  `agent_id` TEXT PK, `session_id` FK `ON DELETE RESTRICT` (a session with
  live agents cannot be deleted), `parent_agent_id` self-FK also
  `RESTRICT` (an agent with attributed actions cannot be dropped), and
  `idempotency_key` unique per session (`uniq_agents_session_idempotency`).
- `turns` — the append-only per-session event log; `type` is one of the
  seven `TurnPayload` discriminators (`user_prompt`, `tool_call`,
  `tool_result`, `file_edit`, `hook_fire`, `note`, `hypothesis`), `payload`
  is the JSON-serialized union member, unique on `(session_id, turn_no)`.
- `tool_invocations` and `file_edits` — the two payload kinds `writeTurn`
  additionally fans out into their own row, keyed by `turn_id`.
- `hypotheses` — one row per recorded hypothesis, with an optional citation
  into `test_errors` / `stack_frames` and a validation outcome.
- `tdd_tasks`, `tdd_session_goals`, `tdd_session_behaviors`,
  `tdd_behavior_dependencies`, `tdd_phases`, `tdd_artifacts` — the TDD
  orchestration hierarchy. See *Cascades and their consequences* below for
  the two FK choices that matter most here.

Six action tables carry the `actor_type` / `agent_id` / `conversation_id`
triad — `test_runs`, `notes`, `hypotheses`, `tdd_phases`, plus `sessions`
and `agents` in their own narrower form. Each of the four narrower tables
repeats the same pair of `CHECK` constraints inline[^migration-0001-test-runs]:
an `agent_id` is required exactly when `actor_type = 'agent'` and forbidden
otherwise, and `conversation_id` is only ever non-`NULL` for an `agent`
actor. **What breaks if this is wrong:** a row claiming `actor_type =
'user'` with a non-`NULL` `agent_id` (or vice versa) fails the `INSERT` at
the database layer, not in application code — the CHECK is the single point
of truth, so a caller cannot construct an inconsistent attribution row even
via a raw `DataStore` call bypassing the schema helpers.

### Immutability triggers

Six `AFTER UPDATE` triggers (`sessions`, `agents`, `test_runs`, `hypotheses`,
`notes`, `tdd_phases`) `RAISE(ABORT, …)` when an `UPDATE` would change a
non-`NULL` `conversation_id` to a different value[^migration-0001-triggers].
`sessions` is the sole exception: because `record session-start` inserts the
row before `register-agent` resolves the canonical conversation id, the
trigger's `WHEN` clause permits exactly one `NULL → value` transition and
still forbids any value-to-different-value change. **What breaks if this is
wrong:** without the trigger, a bug that re-derives `conversation_id` mid-run
would silently re-attribute every already-written turn/hypothesis/note to a
different conversation on the next `UPDATE`; the trigger turns that bug into
an immediate `SQLITE_CONSTRAINT` at the write site instead of a silent
cross-conversation data leak discovered later.

### Cascades and their consequences

- `agents.session_id` and `agents.parent_agent_id` are `ON DELETE
  RESTRICT`, not `CASCADE`[^migration-0001-agents] — deleting a session or
  agent that still has children fails outright. A prune routine has to
  delete agents leaf-first; the schema will not silently orphan attribution.
- `tdd_phases.behavior_id` references `tdd_session_behaviors(id) ON DELETE
  CASCADE`: deleting a behavior (a main-agent action under user
  confirmation) removes every phase transition recorded against it, and
  transitively every `tdd_artifacts` row that references those phases.
- `tdd_artifacts.behavior_id` denormalizes the same behavior reference one
  level down, with its own `ON DELETE CASCADE` and an index on
  it[^migration-0001-behavior-id] — this exists purely so behavior-scoped
  evidence queries are a single-hop `WHERE behavior_id = ?` instead of
  joining `tdd_artifacts → tdd_phases → behavior_id`. **What breaks if this
  is wrong:** if a future migration changed this FK's cascade rule without
  also updating `tdd_phases.behavior_id`'s, a behavior deletion could leave
  `tdd_artifacts` rows referencing a live phase whose behavior no longer
  exists — the two cascades have to move together.
- `tdd_behavior_dependencies` is a junction table with a `CHECK (behavior_id
  != depends_on_id)` — see
  [Junction Table for Behavior Dependencies](../decisions/d14-junction-table-for-behavior-dependencies.md).
  See [tdd_phases.behavior_id Cascade](../decisions/d15-tdd-phases-behavior-id-cascade.md)
  for the cascade choice itself.
- `writeTurn`'s two fan-out payloads (`file_edit` → `file_edits`,
  `tool_result` → `tool_invocations`) both key their target row on the
  *result* turn, not the *call* turn, so `tool_invocations.params_hash` is
  always `NULL` — the matching `tool_call` row was written earlier and is
  out of scope by the time the `tool_result` insert runs. **What breaks if
  an entry is wrong:** treating `params_hash` as populated anywhere
  downstream (a report, an MCP tool) silently reads a column that is never
  filled; a consumer needing the call's params has to join back through
  `payload.tool_use_id` on the `turns` table itself.

## Migration 0002 — widening, not replacing

`0002_test_artifacts.ts` demonstrates the append-only discipline against a
concrete example: `test_annotations`, `test_artifacts`, and `attachments`
shipped in `0001_initial` with zero readers and zero writers, so `0002` is
free to drop and recreate `test_annotations` outright (widening `type` from
a three-value `CHECK` to an unconstrained `TEXT`, and dropping three inline
`attachment_*` columns the sibling `attachments` table already modelled
relationally)[^migration-0002]. `test_artifacts` and `attachments` already
had readers by the time `0002` shipped, so those two are `ALTER TABLE ADD
COLUMN` only — `test_artifacts.data` (JSON of custom fields) and
`attachments.byte_size` / `attachments.body_encoding`. See
[Migration 0002 Drops the Dead Table and ALTERs the Live Ones](../decisions/66-migration-0002-drops-the-dead-table-and-alters-the-live-ones.md)
for the rule this exemplifies, and
[Schema Migrations](../conventions/schema-migrations.md) for the standing
convention. **What breaks if this rule is broken:** editing `0001_initial.ts`
in place after 2.0 shipped changes the schema an already-migrated consumer's
`data.db` was built against without a migration ever running against it —
the file on disk and the code's expectation of it silently diverge, and every
downstream read either errors on a missing column or silently returns
`undefined` for one the code assumes exists.

## The session-map database

`session_map_0001_initial.ts` — a per-client SQLite at
`${CLAUDE_PLUGIN_DATA}/sessions.db` (or the client-specific
equivalent)[^session-map]. Two `STRICT` tables: `conversation_map` (keyed on
the transcript-file UUID, mapping to the canonical `conversation_id`) and
`session_map` (keyed on the host's native session id, FKing to
`conversation_map.conversation_id` `ON DELETE RESTRICT`). This is the table
that lets `claude --resume` reuse the same `conversation_id` UUID across a
restarted host session — a host-specific side channel translating
client-native identifiers into the canonical UUIDs `data.db` expects.
Concurrent writers from multiple host windows converge via `UPSERT` on the
native-id keys.

## The discovery registry database

`registry_0001_initial.ts` — one `STRICT` table, `known_projects`, at
`$XDG_DATA_HOME/vitest-agent/registry.db`[^registry] (the path
`resolveHookPaths` derives with `AppStore.location`, `directory: "data"`,
and `SidecarPlatformLive` opens as given with `Store.layerSqliteAs`), keyed by
`project_key` (the filesystem-safe form `ProjectIdentity` produces).
Tooling that needs to enumerate every vitest-agent project a machine has
ever run on (an MCP dashboard, a cross-project query) reads this table
instead of walking the filesystem. Writes are `ON CONFLICT(project_key) DO
UPDATE` upserts and are explicitly best-effort — the registry never blocks
a run.

## The migration-registry triplet

For the project database, only two places have to agree for a migration to
reach every process that opens `data.db`: the migration file itself, and
its entry in `PROJECT_MIGRATIONS`. `makeSqliteStack(filename, migrations =
PROJECT_MIGRATIONS)` defaults its second parameter to that same record
rather than requiring each caller to pass it explicitly[^platform-ts], so
`PlatformLive`, `ensureMigrated`, and the `testing/` layer all resolve to
the one registry without restating it — a test helper or a new call site
that omits the second argument automatically sees every migration
`PROJECT_MIGRATIONS` lists, with nothing left to keep in sync by hand. The
session-map and registry stacks remain genuinely separate: `platform-sidecar.ts`
passes each its own inline single-migration record, because those two
databases have their own schemas entirely. See
[Add a Migration](../runbooks/add-a-migration.md) for the procedure that
adds a new file to `PROJECT_MIGRATIONS`. The choice to persist to SQLite at all, rather than
JSON files, is recorded in
[SQLite over JSON Files](../decisions/18-sqlite-over-json-files.md); the
single-canonical-migration-then-incremental policy in
[Single Pre-2.0 Migration, Incremental After](../decisions/d9-single-pre-2-0-migration-incremental-after.md).

## Migration ledgers

Store records applied migrations in `_store_migrations` (plus a
`_store_meta` table for its own markers), and that is the only live
ledger. Every store opens with `LEDGER_OPTIONS = { adoptMigratorLedger:
true }`[^stores]: on the first open of a database that a 2.x
`SqliteMigrator` migrated, Store copies its `effect_sql_migrations` rows
into `_store_migrations` once (a one-shot marker in `_store_meta`), so
nothing re-runs. Store never writes `effect_sql_migrations`: on an upgraded
database the table stays behind, frozen at the point of adoption, and on a
database this version created it never exists. An older vitest-agent that
still runs `SqliteMigrator` therefore cannot open a file this version
created; see
[Limitation: older installs cannot open newer databases](../limitations/older-installs-cannot-open-newer-databases.md).

Adoption only matches when ids and names agree, which is why every record
stays keyed `NNNN_name` and `toStoreMigrations` parses the keys with
effect/sql's own `fromRecord` pattern (`0001_initial` → id 1, name
`initial`). Renaming a shipped key would make adoption miss it and re-run
the migration. The rationale is
[Decision 76](../decisions/76-adopt-effected-store-with-an-adopt-only-ledger.md).

The connection settings come from the driver, not the schema: a 5 s busy
timeout and WAL journal mode per connection, with foreign keys on by
default under `node:sqlite`. The `PRAGMA` statements inside the `0001`
migrations are now redundant but harmless, and stay because `0001` is never
edited; `DataStoreLive`'s per-connection `PRAGMA foreign_keys=ON` is kept as
defense in depth.

## What derives from these tables

`DataReader`'s assemblers (`packages/engine/src/sql/assemblers.ts`) join
these rows into the domain types every read path serves: the MCP query
tools (`test_errors`, `test_history`, `file_coverage`, `triage_brief`, the
`tdd_*` family), the CLI's `db query` command, and the coverage-trend /
failure-classification logic `HistoryTracker` runs against `test_history`
and `failure_signatures` on every new run. A wrong or missing FK, CHECK, or
index in this schema surfaces as a wrong answer from one of those tools
before it surfaces as a database error — an unindexed lookup column
degrades a query silently rather than failing it.

[^platform-ts]: `../../packages/engine/src/platform.ts:67`
[^stores]: `../../packages/engine/src/stores.ts:37`
[^index]: `../../packages/engine/src/migrations/index.ts:21`
[^migration-0001-header]: `../../packages/engine/src/migrations/0001_initial.ts:1`
[^migration-0001-test-runs]: `../../packages/engine/src/migrations/0001_initial.ts:109` (attribution CHECKs), `../../packages/engine/src/migrations/0001_initial.ts:120`
[^migration-0001-triggers]: `../../packages/engine/src/migrations/0001_initial.ts:857`
[^migration-0001-agents]: `../../packages/engine/src/migrations/0001_initial.ts:528`
[^migration-0001-behavior-id]: `../../packages/engine/src/migrations/0001_initial.ts:768`
[^migration-0002]: `../../packages/engine/src/migrations/0002_test_artifacts.ts:1`
[^session-map]: `../../packages/engine/src/migrations/session_map_0001_initial.ts:1`
[^registry]: `../../packages/engine/src/migrations/registry_0001_initial.ts:1`
