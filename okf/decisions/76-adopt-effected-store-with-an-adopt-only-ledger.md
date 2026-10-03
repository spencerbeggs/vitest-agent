---
type: Decision
status: draft
supersedes: 75-adopt-effected-store-with-ledger-adopt-and-mirror.md
title: Adopt @effected/store with an Adopt-Only Ledger
description: "All three SQLite databases open as @effected/store stores with adoptMigratorLedger only: a 2.x effect_sql_migrations ledger is copied forward once and never written again, so an older vitest-agent opening a file this version created is not supported."
tags:
  - architecture
  - compat
  - effect
  - deps
generated:
  by: okfit/claude-code
  at: 2026-10-03T18:15:58Z
  body_sha256: c00e9d80a6a7d16d9acac2bce5d2a9954eabc332419f6dd35939e51ca63806f1
sources:
  - id: engine-stores
    resource: ../../packages/engine/src/stores.ts
  - id: engine-platform
    resource: ../../packages/engine/src/platform.ts
  - id: platform-sidecar
    resource: ../../packages/engine/src/programs/platform-sidecar.ts
  - id: hook-paths
    resource: ../../packages/engine/src/programs/hook-paths.ts
  - id: ensure-migrated
    resource: ../../packages/engine/src/utils/ensure-migrated.ts
  - id: effected-store
    resource: "npm:@effected/store"
    title: Store.layer, Store.layerSqliteAs, Store.sqlClient, and the adoptMigratorLedger / mirrorMigratorLedger options
  - id: effected-app
    resource: "npm:@effected/app"
    title: AppStore.location
  - id: owner-no-old-dbs
    resource: conversation with the repository owner
    author: human:spencer
    title: "Drop the ledger mirror: \"I don't think we need to worry about old dbs.\""
    last_modified: 2026-10-03T00:00:00Z
  - id: dogfood-old-install
    resource: "feat/effected-app-layers dogfood loop: a released 5.x install opening a file this version created, checked by hand"
    last_modified: 2026-10-03T00:00:00Z
---

# Adopt @effected/store with an Adopt-Only Ledger

## Context

[Decision 32](32-keep-ensuremigrated-instead-of-the-kit-s-sqlite-state-layer.md)
kept the data layer on a hand-composed `SqliteClient` plus
`SqliteMigrator` stack, partly because the kit's migration ledger was not
effect/sql's `effect_sql_migrations`, so a 2.x database would look
unmigrated to it. `@effected/store` now removes that obstacle: it can
adopt an effect/sql ledger, copying its rows into Store's own
`_store_migrations` once on first open[^effected-store].

Store can also mirror its ledger back into `effect_sql_migrations` so a
released 5.x vitest-agent (engine 0.5 or earlier, still on
`SqliteMigrator`) keeps opening files a newer version wrote.
[Decision 75](75-adopt-effected-store-with-ledger-adopt-and-mirror.md)
took that mirror; before the branch merged, the repository owner dropped
it, because supporting an older install opening a newer file is not a
goal[^owner-no-old-dbs].

## Decision

Open all three databases as `@effected/store` stores, every one with the
same `LEDGER_OPTIONS = { adoptMigratorLedger: true }`[^engine-stores].
Nothing writes `effect_sql_migrations` any more. On a database upgraded
from 2.x it stays behind as a frozen record that adoption read once; on a
database this version created it never exists.

- **`data.db`** stays on `makeSqliteStack`, which builds
  `Store.layer({ migrations: toStoreMigrations(record), ...LEDGER_OPTIONS })`
  over the engine's own `SqliteClient.layer`[^engine-platform].
  `ensureMigrated` still calls `makeSqliteStack` behind its
  `globalThis`-keyed promise cache[^ensure-migrated], so the coordination
  of [Decision 28](28-process-level-migration-coordination-via-globalthis-cache.md)
  holds unchanged; only the migrator underneath it changed. `data.db` is
  not a keyed store because each front end resolves its path early and
  displays or persists it, a user `cacheDir` can be any absolute
  directory, and `PlatformLive` publicly provides `SqliteClient |
  SqlClient`.
- **`sessions.db` and `registry.db`** are keyed stores, both opened in
  `SidecarPlatformLive` with `Store.layerSqliteAs` at the path it is
  given: `SessionMapStore` at the absolute, host-chosen session-map path,
  and `RegistryStore` at `paths.registryDbPath` with
  `REGISTRY_STORE_OPTIONS.migrations`[^platform-sidecar]. Every path in
  `SidecarPaths` is opened as given. `resolveHookPaths` derives
  `registryDbPath` with `@effected/app`'s
  `AppStore.location(REGISTRY_STORE_OPTIONS)`[^hook-paths][^effected-app],
  so the path the CLI passes is still the XDG data root; `AppStore.location`
  is the only `@effected/app` call left. The Live layers keep reading the
  bare `SqlClient`, supplied per database by `Store.sqlClient(tag)`.
- **Migration records stay effect/sql-shaped** (`"NNNN_name"` →
  migration). `toStoreMigrations` parses each key with effect/sql's own
  `fromRecord` pattern, `/^(\d+)_(.+)$/`, so ids and names match the rows
  an adopted ledger holds[^engine-stores]. `MigrationRecord` types each
  migration as `Effect<void, SqlError, SqlClient>`.
- **`PlatformLiveError = StoreError | StoreMigrationError`** is the public
  name for what `makeSqliteStack`'s migrator layer and `PlatformLive` fail
  with[^engine-platform]. It is exported from the barrel and from
  `./testing`, so a dependent such as the plugin's `ReporterLive` can spell
  its return type without depending on `@effected/store`.

The schema, the database paths, and every migration body are unchanged.

## Alternatives rejected

- **Keep `SqliteMigrator` (Decision 32 as written).** Rejected because
  the ledger mismatch that justified it is solved upstream, and keeping it
  means hand-maintaining a client-plus-migrator pair for each of the three
  databases instead of reading the store from the kit.
- **Adopt and mirror (Decision 75).** Rejected because the only thing the
  mirror buys is an older install opening a newer file, which this project
  does not promise[^owner-no-old-dbs]. It would also keep two live ledgers
  in every database that each new store and call site has to keep in step.
- **Make `data.db` a keyed store too.** Rejected for the path-ownership
  and public-surface reasons above, and because doing so would move
  `data.db` out from under `ensureMigrated`'s coordination.

## Consequences

- An older vitest-agent cannot open a database this version created: a
  released 5.x install fails with `Migration "1_initial" failed`, because
  it finds no `effect_sql_migrations` and re-runs `0001` against tables
  that already exist[^dogfood-old-install]. See
  [Limitation: older installs cannot open newer databases](../limitations/older-installs-cannot-open-newer-databases.md).
- `_store_migrations` (with a `_store_meta` marker for one-shot adoption)
  is the only live ledger. A new store, or a new call site for an existing
  database, must open with `LEDGER_OPTIONS`, or it would skip adoption and
  re-run every migration on an upgraded 2.x file. A shipped migration key
  must never be renamed, because adoption matches on the parsed id and
  name.
- Adding a migration is still a file registered in the database's record
  ([Add a Migration](../runbooks/add-a-migration.md)); Store applies it
  and records it in `_store_migrations` only.
- The `Running migration` / `Migrations complete` debug records come from
  `@effected/store`, in the effect/sql shape the CLI's log-routing e2e
  tests match on.
- The driver owns the per-connection busy timeout (5 s) and WAL journal
  mode, and `node:sqlite` enables foreign keys by default. The `PRAGMA`
  statements in the `0001` migrations stay, because `0001` is never
  edited, and are harmless. `DataStoreLive`'s per-connection `PRAGMA
  foreign_keys=ON` stays as defense in depth.
- A brand-new file opened by many processes at once can still fail at the
  WAL switch. This is the same exposure the old stack had; see
  [Limitation: concurrent first open of a new database](../limitations/concurrent-first-open-wal-switch.md).
- Three stable Decisions name `SqliteMigrator` as the migrator underneath
  their choice:
  [Decision 18](18-sqlite-over-json-files.md),
  [Decision D9](d9-single-pre-2-0-migration-incremental-after.md), and
  [Decision 66](66-migration-0002-drops-the-dead-table-and-alters-the-live-ones.md).
  Their choices still hold. Only that mechanism detail is superseded
  here.

## Related

- [Decision 28 — Process-Level Migration Coordination via globalThis Cache](28-process-level-migration-coordination-via-globalthis-cache.md)
- [Convention: Schema migrations](../conventions/schema-migrations.md)
- [DataModel: SQLite schema](../models/sqlite-schema.md)
- [Module: @vitest-agent/engine](../modules/engine.md)

[^engine-stores]: `../../packages/engine/src/stores.ts`
[^engine-platform]: `../../packages/engine/src/platform.ts`
[^platform-sidecar]: `../../packages/engine/src/programs/platform-sidecar.ts`
[^hook-paths]: `../../packages/engine/src/programs/hook-paths.ts`
[^ensure-migrated]: `../../packages/engine/src/utils/ensure-migrated.ts`
[^effected-store]: `npm:@effected/store`
[^effected-app]: `npm:@effected/app`
[^owner-no-old-dbs]: conversation with the repository owner, 2026-10-03
[^dogfood-old-install]: feat/effected-app-layers dogfood loop, manual check of a released 5.x install against a file this version created
