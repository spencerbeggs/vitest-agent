---
type: Runbook
title: Add a schema migration to the project database
description: How to add a new incremental SQLite migration for the project data.db without editing the frozen 0001_initial migration, registered once in the single PROJECT_MIGRATIONS record every consumer defaults to.
resource: ../../packages/engine/src/migrations/index.ts
tags: [architecture, dx]
generated:
  by: okfit/claude-code
  at: 2026-10-03T18:02:06Z
  body_sha256: 4f151c58714fffa8f802c9f802ca199b17ac8efa11574ec9dcb05741179233de
sources:
  - id: migrations-index
    resource: ../../packages/engine/src/migrations/index.ts
  - id: migration-0001
    resource: ../../packages/engine/src/migrations/0001_initial.ts
  - id: migration-0002
    resource: ../../packages/engine/src/migrations/0002_test_artifacts.ts
  - id: engine-platform
    resource: ../../packages/engine/src/platform.ts
  - id: ensure-migrated
    resource: ../../packages/engine/src/utils/ensure-migrated.ts
  - id: testing-layers
    resource: ../../packages/engine/src/testing/layers.ts
  - id: migration-0002-test
    resource: ../../packages/engine/__test__/migration-0002.test.ts
  - id: engine-stores
    resource: ../../packages/engine/src/stores.ts
---

# Add a schema migration to the project database

## Trigger

A change to the SQLite schema for a per-project `data.db` is needed — a
new column, a new table, or a shape fix to a table already shipped in a
released version — and `0001_initial.ts` can no longer be edited in place
because published installs already carry data created from it as
shipped.[^migration-0001]

## Steps

1. **Decide ALTER-and-backfill vs. drop-and-recreate.** Check whether the
   table has any released reader or writer. A table with real readers and
   writers is `ALTER TABLE ... ADD COLUMN` and backfilled, never dropped.
   A table that shipped with zero readers and zero writers in every
   released version may be dropped and recreated outright, because doing
   so cannot destroy a row that exists — this is exactly the reasoning
   `0002_test_artifacts.ts` uses for `test_annotations` (dropped and
   recreated to fix its `CHECK` constraint and remove three inline
   columns that duplicated the sibling `attachments` table) versus
   `test_artifacts` and `attachments` (widened in place with `ALTER TABLE`
   because both had gained live readers and writers in that same
   migration).[^migration-0002]
2. **Create `packages/engine/src/migrations/000N_<name>.ts`**, the next
   sequential number after the highest existing file. Export an
   `Effect.gen` migration body that runs SQL through the ambient
   `SqlClient` and fails only with `SqlError` (the `MigrationRecord` value
   type is `Effect<void, SqlError, SqlClient>`), following
   `0002_test_artifacts.ts` as the worked example.[^migration-0002]
3. **Register the migration in `PROJECT_MIGRATIONS`.**
   `packages/engine/src/migrations/index.ts` imports each migration module
   and lists it under its filename-derived key, `NNNN_name`, in
   application order.[^migrations-index] The key is load-bearing:
   `toStoreMigrations` parses it with effect/sql's `fromRecord` pattern
   (`/^(\d+)_(.+)$/`, so `0003_foo` is id 3, name `foo`), and a key that does
   not match is silently skipped.[^engine-stores] `@effected/store` records
   the applied migration in `_store_migrations` and mirrors it into
   `effect_sql_migrations`, so an older vitest-agent opening the same file
   sees it as applied. This one record is the single source of
   truth every migration-consuming call site defaults to:
   `makeSqliteStack(filename, migrations = PROJECT_MIGRATIONS)` in
   `platform.ts`,[^engine-platform] `ensureMigrated`'s call to
   `makeSqliteStack(dbPath)`,[^ensure-migrated] and the engine's
   `testing/layers.ts` test-layer factory[^testing-layers] all resolve the
   same migration set through that one default — there is one registry to
   update, not three call sites to keep in sync. A migration for
   `sessions.db` or `registry.db` instead goes in that database's own
   record: the inline `{ "0001_initial": … }` in
   `programs/platform-sidecar.ts` for the session map, or
   `REGISTRY_STORE_OPTIONS.migrations` in `programs/hook-paths.ts` for the
   registry, keyed the same way.
4. **Never edit `0001_initial.ts`.** It is the record of what already ran
   on every existing install; a schema fix always ships as a new
   `000N_*.ts` file, even when the fix targets a table `0001_initial`
   introduced.
5. **Rebuild.** `pnpm build` — the engine's compiled output must include
   the new migration file before any process that imports
   `@vitest-agent/engine` picks it up.
6. **Reset the local database** so the new migration runs against a real
   `data.db` from a known-good starting point rather than being masked by
   an already-migrated dev database. See
   [Runbook: Reset the database](reset-the-database.md).
7. **Run the engine tests.** `pnpm vitest run packages/engine` (or
   `pnpm run test` for the full suite) — add or extend a migration-shape
   test alongside `migration-0002.test.ts`'s pattern so a future migration
   cannot silently regress a column or table shape this one
   introduced.[^migration-0002-test]

## Observable end state

The new migration file is registered under its key in `PROJECT_MIGRATIONS`,
`pnpm build` completes, a fresh `data.db` created after `db reset` (or the
first process to touch a missing `data.db`) ends up on the new schema
version with the migration's row present in both `_store_migrations` and
`effect_sql_migrations`, and `pnpm vitest run packages/engine` passes including any new
migration-shape assertions.

## Related

- [Convention: Schema migrations](../conventions/schema-migrations.md)
- [DataModel: SQLite schema](../models/sqlite-schema.md)
- [Decision D9 — Single Pre-2.0 Migration, Incremental After](../decisions/d9-single-pre-2-0-migration-incremental-after.md)
- [Decision 66 — Migration 0002 Drops the Dead Table and ALTERs the Live Ones](../decisions/66-migration-0002-drops-the-dead-table-and-alters-the-live-ones.md)
- [Runbook: Reset the database](reset-the-database.md)

[^migration-0001]: `../../packages/engine/src/migrations/0001_initial.ts:33-90`
[^migration-0002]: `../../packages/engine/src/migrations/0002_test_artifacts.ts:1-58`
[^migrations-index]: `../../packages/engine/src/migrations/index.ts:1-24`
[^engine-platform]: `../../packages/engine/src/platform.ts:67`
[^ensure-migrated]: `../../packages/engine/src/utils/ensure-migrated.ts:44`
[^testing-layers]: `../../packages/engine/src/testing/layers.ts:7`
[^migration-0002-test]: `../../packages/engine/__test__/migration-0002.test.ts`
[^engine-stores]: `../../packages/engine/src/stores.ts:48`
