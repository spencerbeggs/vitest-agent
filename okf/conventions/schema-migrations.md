---
type: Convention
title: Schema migrations — append-only, one registry, never edit 0001
description: "Post-2.0 schema changes land as a new 000N_*.ts migration registered in PROJECT_MIGRATIONS; never edit 0001_initial.ts in place; ALTER and backfill a table with data; drop and recreate only a dead table; breaking renames in sdk schemas, MCP tools, or CLI flags are majors with changesets."
tags: [architecture, compat]
status: stable
stale_after: 2027-03-13T00:00:00Z
sources:
  - id: migrations-index
    resource: ../../packages/engine/src/migrations/index.ts
    title: PROJECT_MIGRATIONS — the single migration registry
  - id: migration-0001
    resource: ../../packages/engine/src/migrations/0001_initial.ts
    title: 0001_initial.ts
  - id: migration-0002
    resource: ../../packages/engine/src/migrations/0002_test_artifacts.ts
    title: 0002_test_artifacts.ts
  - id: platform
    resource: ../../packages/engine/src/platform.ts
    title: makeSqliteStack's default migrations parameter
  - id: ensure-migrated
    resource: ../../packages/engine/src/utils/ensure-migrated.ts
    title: ensureMigrated builds through makeSqliteStack
  - id: testing-layers
    resource: ../../packages/engine/src/testing/layers.ts
    title: makeTestLayer builds through makeSqliteStack with no override
  - id: stores
    resource: ../../packages/engine/src/stores.ts
    title: toStoreMigrations and LEDGER_OPTIONS
generated:
  by: okfit/claude-code
  at: 2026-10-03T18:02:06Z
  body_sha256: ed61036214b0109ce898f66753efa2350d3d769ae1fba3108664c6dee46ddf86
---

# Schema migrations — append-only, one registry, never edit 0001

## Every schema change is a new `000N_*.ts` file, registered once

`packages/engine/src/migrations/index.ts` exports `PROJECT_MIGRATIONS`, an
ordered record of every migration that must run against a per-project
`data.db`, keyed by migration id (`"0001_initial"`, `"0002_test_artifacts"`,
and so on)[^migrations-index]. This is the single place a new migration is
registered. `makeSqliteStack(filename, migrations = PROJECT_MIGRATIONS)`
defaults its `migrations` parameter to that record and runs it through
`@effected/store`'s `Store.layer`, converted by `toStoreMigrations` and
opened with `LEDGER_OPTIONS`[^platform], so
every consumer that calls `makeSqliteStack` with the default —
`PlatformLive`, `ensureMigrated`[^ensure-migrated],
`packages/engine/src/testing/layers.ts`'s `makeTestLayer`[^testing-layers],
and `SidecarPlatformLive` — reaches the new migration automatically the
moment it is added to `PROJECT_MIGRATIONS`. Add `0003_*.ts` and beyond;
register each one in that record, and never call `makeSqliteStack` with an
explicit second argument that is a partial or hand-picked migration list —
doing so silently strands that call site on an older schema than every
default-argument caller sees. The session-map and discovery-registry
databases are deliberately separate schemas with their own migration
records and are never touched by this one.

## Keep every key `NNNN_name`, and open every store with `LEDGER_OPTIONS`

`toStoreMigrations` parses each record key with effect/sql's `fromRecord`
pattern, `/^(\d+)_(.+)$/`, and skips a key that does not match[^stores].
The parsed id and name are what ledger adoption matches against the
`effect_sql_migrations` rows a 2.x install already wrote, so never rename a
shipped key and never introduce a key outside that shape. Open any new
store — or any new call site for an existing database — with the shared
`LEDGER_OPTIONS` (`adoptMigratorLedger` and `mirrorMigratorLedger`), and
never hand-roll a `SqliteMigrator` or a bare `Store.layer` without them: a
store that does not mirror leaves `effect_sql_migrations` behind, and an
older vitest-agent opening the same file would then try to re-run
migrations that already ran. See
[Decision 75](../decisions/75-adopt-effected-store-with-ledger-adopt-and-mirror.md).

## Never edit `0001_initial.ts`, or any already-shipped migration, in place

`0001_initial.ts`[^migration-0001] and every migration that has shipped in a
published `@vitest-agent/engine` version are frozen. 2.x is already published
and consumers carry real `data.db` history running against those exact
migration bodies — rewriting one changes what a consumer's already-applied
migration id means, which the migrator cannot detect or recover from. A
correction to a shipped migration's intent ships as a new migration that
performs the correction, never as an edit to the file consumers already ran.

## ALTER and backfill a table that holds data; drop and recreate only a table that never accumulated any

`0002_test_artifacts.ts`[^migration-0002] is the worked example of the rule
this repository follows when a table's shape needs to change: a table that
already has real deployed data is `ALTER`ed and its existing rows are
backfilled in the same migration, never dropped, because dropping it would
discard every consumer's history. A table is only a candidate for drop-and-
recreate when it was dead — nothing had ever written a row to it in a shipped
release — so there is no data a drop would destroy.

## Breaking renames in SDK schemas, the MCP tool surface, or CLI flags are majors with changesets

A schema rename in `@vitest-agent/sdk`, a change to the MCP tool surface
(tool names, an `action`/`kind` discriminator's accepted values, a served
schema's required fields), or a CLI flag rename are breaking changes to a
public contract, not free edits alongside a migration. Each ships as a major
version bump with its own changeset naming the affected package — never
folded silently into the same commit that adds a migration file, even when
the migration and the rename are motivated by the same underlying change.

## Related concepts

- [runbooks/add-a-migration.md](../runbooks/add-a-migration.md) is the
  step-by-step procedure for adding and registering a new migration file.
- [models/sqlite-schema.md](../models/sqlite-schema.md) documents the tables
  these migrations build, from the maintainer's side.
- [Decision D9 — Single Pre-2.0 Migration, Incremental After](../decisions/d9-single-pre-2-0-migration-incremental-after.md)
  is the rationale for the append-only discipline stated here.
- [Decision 66 — Migration 0002 Drops the Dead Table and ALTERs the Live Ones](../decisions/66-migration-0002-drops-the-dead-table-and-alters-the-live-ones.md)
  is the rationale behind the ALTER-vs-drop rule, worked through `0002`'s
  actual table set.

[^migrations-index]: ../../packages/engine/src/migrations/index.ts
[^migration-0001]: ../../packages/engine/src/migrations/0001_initial.ts
[^migration-0002]: ../../packages/engine/src/migrations/0002_test_artifacts.ts
[^platform]: ../../packages/engine/src/platform.ts
[^ensure-migrated]: ../../packages/engine/src/utils/ensure-migrated.ts
[^testing-layers]: ../../packages/engine/src/testing/layers.ts
[^stores]: ../../packages/engine/src/stores.ts
