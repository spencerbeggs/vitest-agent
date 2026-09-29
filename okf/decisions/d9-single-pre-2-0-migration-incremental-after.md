---
type: Decision
title: Single Pre-2.0 Migration, Incremental After
description: 0001_initial.ts is frozen post-2.0; every schema change ships as a new registered migration file that ALTERs and backfills a table holding data, and only drops a table with zero readers and zero writers.
status: stable
tags:
  - architecture
  - tdd
generated:
  by: okfit/claude-code
  at: 2026-09-29T20:39:41Z
  body_sha256: 11c368f8e3a35afb48e5d63ef4f8c0064f8354dafa69983bed4cef78250f714b
sources:
  - id: migration-0001
    resource: ../../packages/engine/src/migrations/0001_initial.ts
  - id: migration-0002
    resource: ../../packages/engine/src/migrations/0002_test_artifacts.ts
  - id: migrations-index
    resource: ../../packages/engine/src/migrations/index.ts
  - id: platform
    resource: ../../packages/engine/src/platform.ts
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
---

# Single Pre-2.0 Migration, Incremental After

## Context

Before 2.0 shipped to npm, the canonical per-project schema lived in one
migration file, `0001_initial.ts`, and every breaking schema change was an
in-place edit to it — no `0002_*`, no `ALTER`, no backfill, developers wiped
`data.db` on each change. That was workable only because no install carried
data worth preserving yet.

## Decision

Post-2.0, `0001_initial.ts` is frozen — it is the record of what already ran
on every existing install and is never edited again.[^migration-0001] Schema
changes ship as new `000N_*.ts` files, each exporting an `Effect.gen`
migration body run through the SQL client.[^migration-0002] Every new file is
registered by key in `PROJECT_MIGRATIONS`, the single source of truth for the
project database's migration set — `packages/engine/src/migrations/index.ts`
imports each migration module and lists it under its filename-derived
key.[^migrations-index] `makeSqliteStack` defaults its `migrations` parameter
to `PROJECT_MIGRATIONS` and passes it to `SqliteMigrator.fromRecord`, so
registering a migration there is what makes it reach `PlatformLive`,
`ensureMigrated`, the engine's `./testing` layers, and `ReporterLive` in one
step — every process that opens a project database runs the same migration
set without a second registration point.[^platform]

The rule going forward is shape-dependent. A table holding data is `ALTER`ed
and backfilled and is never dropped. `0002_test_artifacts` is the worked
example of both branches in one migration: `test_annotations` and
`test_artifacts`/`attachments` all shipped in `0001_initial` with zero
readers and zero writers, so `test_annotations` (whose `type` column's
`CHECK` constraint didn't match an arbitrary Vitest annotation `type`, and
which duplicated the sibling `attachments` table's 1:N shape via three inline
`attachment_*` columns) is dropped and recreated outright, while
`test_artifacts` and `attachments` gained live readers and writers in the
same migration and are widened in place with `ALTER TABLE … ADD COLUMN`
instead.[^migration-0002] A table with no readers and no writers is not user
data; only that class may be dropped and recreated inside a new migration.
For a breaking shape an `ALTER` cannot express on a table that does hold
data, the escape hatch is a one-shot export/import path on a major bump
rather than a drop.

## Alternatives rejected

- **Keep editing `0001_initial.ts` in place post-2.0.** Rejected because
  users now carry real `data.db` files with real history; an in-place edit
  to the first migration silently changes what "already ran" means for an
  existing install and has no way to reconcile prior data against the new
  shape.
- **Write a preserving migration for pre-2.0 data.** Rejected because prior
  data was already lost when the DB location moved to the XDG
  workspace-keyed path, so a preserving migration would help only a small
  pre-release audience for real engineering cost.
- **Maintain per-column `ALTER` scripts throughout the pre-2.0 churn.**
  Rejected because the schema diff during that period was large and fluid;
  scripting every incremental change against a still-moving canonical shape
  was meaningful test-code volume for marginal value while no users had data
  yet.

## Consequences

Every future schema change is additive at the file level even when it
rewrites a table's SQL: a new `000N_*.ts` file, registered in
`PROJECT_MIGRATIONS`, never a hand-edit to an existing migration file. Future
major bumps that need a non-`ALTER` shape change on a table holding data
require an export/import script in the SDK — that cost is deferred until a
change actually needs it rather than paid up front. Calling out "this is the
last drop-and-recreate of user data" makes the no-data-loss invariant
something code review can hold a PR to, rather than a norm that erodes one
convenient exception at a time.

## Related

- [Module: engine](../modules/engine.md)
- [Model: SQLite Schema](../models/sqlite-schema.md)
- [Convention: Schema Migrations](../conventions/schema-migrations.md)
- [Runbook: Add a Migration](../runbooks/add-a-migration.md)

[^migration-0001]: `../../packages/engine/src/migrations/0001_initial.ts`
[^migration-0002]: `../../packages/engine/src/migrations/0002_test_artifacts.ts`
[^migrations-index]: `../../packages/engine/src/migrations/index.ts`
[^platform]: `../../packages/engine/src/platform.ts`
