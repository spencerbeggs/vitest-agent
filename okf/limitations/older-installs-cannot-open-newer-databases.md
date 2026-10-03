---
type: Limitation
title: Older installs cannot open databases this version created
description: "A released 5.x vitest-agent (engine 0.5 or earlier, on effect/sql's SqliteMigrator) that opens a data.db, sessions.db, or registry.db this version created fails with Migration \"1_initial\" failed, because the store ledger is not mirrored into effect_sql_migrations."
bounds: ../modules/engine.md
status: draft
stale_after: 2027-04-01T00:00:00Z
tags: [compat, architecture]
generated:
  by: okfit/claude-code
  at: 2026-10-03T18:15:58Z
  body_sha256: 142d7b9a1d6abbad891d2a2ff788da80e2c79e1ba5409f2925eb9af26ad678d7
sources:
  - id: engine-stores
    resource: ../../packages/engine/src/stores.ts
  - id: owner-no-old-dbs
    resource: conversation with the repository owner
    author: human:spencer
    title: "Drop the ledger mirror: \"I don't think we need to worry about old dbs.\""
    last_modified: 2026-10-03T00:00:00Z
  - id: dogfood-old-install
    resource: "feat/effected-app-layers dogfood loop: a released 5.x install opening a file this version created, checked by hand"
    last_modified: 2026-10-03T00:00:00Z
---

# Older installs cannot open databases this version created

**Condition.** A vitest-agent older than this version, one whose engine
still migrates with effect/sql's `SqliteMigrator` (the released 5.x line,
engine 0.5 or earlier), opens a SQLite file that this version created.
Any of the three databases qualifies. `registry.db` is the likeliest,
because it is machine-global: two projects on one machine that run
different vitest-agent versions share it. A downgrade of one project's
install does the same to that project's `data.db` and `sessions.db`.

**Symptom.** The older binary fails with `MigrationError: Migration
"1_initial" failed`[^dogfood-old-install]. This version records migrations
only in Store's `_store_migrations` table: every store opens with
`LEDGER_OPTIONS = { adoptMigratorLedger: true }` and no
mirror[^engine-stores]. The older migrator finds no
`effect_sql_migrations` table, assumes the file is empty, and re-runs
`0001` against tables that already exist.

A file upgraded from 2.x by this version is not covered either. Its
`effect_sql_migrations` table is left frozen at the point of adoption and
never updated, so whether an older binary happens to accept it is untested
and not promised.

**Why this is acceptable.** Supporting an older install opening a newer
file is not a goal: the repository owner dropped the mirror that provided
it rather than carry a second live ledger in every
database[^owner-no-old-dbs]. Upgrading the older install to this version
or later clears the condition, since adoption and Store's own ledger read
the file correctly. The reasoning is
[Decision 76](../decisions/76-adopt-effected-store-with-an-adopt-only-ledger.md).

**What a fix would take.** Adding `mirrorMigratorLedger: true` back to
`LEDGER_OPTIONS` would keep `effect_sql_migrations` current, as
[Decision 75](../decisions/75-adopt-effected-store-with-ledger-adopt-and-mirror.md)
once did; a newer install would then have to open each file once before
an older one could. No fix is planned.

[^engine-stores]: `../../packages/engine/src/stores.ts`
[^owner-no-old-dbs]: conversation with the repository owner, 2026-10-03
[^dogfood-old-install]: feat/effected-app-layers dogfood loop, manual check of a released 5.x install against a file this version created
