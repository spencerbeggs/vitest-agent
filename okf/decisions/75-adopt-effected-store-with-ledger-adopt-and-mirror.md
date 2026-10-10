---
type: Decision
status: deprecated
supersedes: 32-keep-ensuremigrated-instead-of-the-kit-s-sqlite-state-layer.md
title: Adopt @effected/store with Ledger Adopt and Mirror
description: "All three SQLite databases open as @effected/store stores (data.db through makeSqliteStack's Store.layer, sessions.db and registry.db as keyed stores), every one with adoptMigratorLedger and mirrorMigratorLedger, so 2.x ledgers carry forward and older vitest-agent versions can still open files this version wrote."
tags:
  - architecture
  - compat
  - effect
  - deps
generated:
  by: okfit/claude-code
  at: 2026-10-10T02:40:34Z
  body_sha256: 9fd800ebcf13e0478c65299e5669239d09d37eaca270f2c402447e6b861118fc
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
    title: AppStore.layerAs and AppStore.location
  - id: start-mcp-sh
    resource: ../../plugin/bin/start-mcp.sh
verified:
  - by: human:spencer
    at: 2026-10-03T17:58:57Z
---

# Adopt @effected/store with Ledger Adopt and Mirror

> **Superseded by [Decision 76](76-adopt-effected-store-with-an-adopt-only-ledger.md).**
> The ledger mirror described below was dropped: every store adopts the
> 2.x ledger once, and older installs opening newer databases is not a
> goal.

## Context

[Decision 32](32-keep-ensuremigrated-instead-of-the-kit-s-sqlite-state-layer.md)
kept the data layer on a hand-composed `SqliteClient` plus
`SqliteMigrator` stack and rejected `@effected/store` / `@effected/app`
for two reasons: a bundled layer migrates with no cross-instance
coordination, which would bring back the `SQLITE_BUSY` race of [Decision
28](28-process-level-migration-coordination-via-globalthis-cache.md); and
the kit's migration ledger was not effect/sql's `effect_sql_migrations`,
so a 2.x database would look unmigrated to it.

The second reason has since gone away. `@effected/store` can adopt an
effect/sql ledger, copying its rows into Store's `_store_migrations` once
on first open, and can mirror its own ledger back into
`effect_sql_migrations`. Mirroring matters here because these files are
shared across versions. `registry.db` is shared by every vitest-agent
install on a machine. `sessions.db` and `data.db` can be opened by
different versions too: each project's own install, and the Claude Code
plugin's MCP loader falling back to `npx --yes
@vitest-agent/mcp@5`[^start-mcp-sh]. A released 5.x (engine 0.5 or
earlier, still on `SqliteMigrator`) must keep opening a file a newer
version created or migrated.

## Decision

Open all three databases as `@effected/store` stores, every one with the
same `LEDGER_OPTIONS = { adoptMigratorLedger: true, mirrorMigratorLedger:
true }`[^engine-stores].

- **`data.db`** stays on `makeSqliteStack`, which now builds
  `Store.layer({ migrations: toStoreMigrations(record), ...LEDGER_OPTIONS })`
  over the engine's own `SqliteClient.layer`[^engine-platform].
  `ensureMigrated` still calls `makeSqliteStack` behind its
  `globalThis`-keyed promise cache[^ensure-migrated], so Decision 28's
  coordination holds unchanged; only the migrator underneath it changed.
  `data.db` is not a keyed store because each front end resolves its path
  early and displays or persists it, a user `cacheDir` can be any absolute
  directory, and `PlatformLive` publicly provides `SqliteClient |
  SqlClient`.
- **`sessions.db`** is `Store.layerSqliteAs(SessionMapStore, { filename,
  … })` at its absolute, host-chosen path, and **`registry.db`** is
  `AppStore.layerAs(RegistryStore, REGISTRY_STORE_OPTIONS)` at the XDG data
  root[^platform-sidecar]. `resolveHookPaths` reports `registryDbPath`
  through `AppStore.location` on the same constant, so the reported path
  and the opened file cannot disagree[^hook-paths]. Their Live layers keep
  reading the bare `SqlClient`, supplied per database by
  `Store.sqlClient(tag)`.
- **Migration records stay effect/sql-shaped** (`"NNNN_name"` →
  migration). `toStoreMigrations` parses each key with effect/sql's own
  `fromRecord` pattern, `/^(\d+)_(.+)$/`, so ids and names match the rows
  an adopted ledger holds[^engine-stores].
- **`PlatformLiveError = StoreError | StoreMigrationError`** is the public
  name for what `makeSqliteStack`'s migrator layer and `PlatformLive` fail
  with[^engine-platform]. It is exported from the barrel and from
  `./testing`, so a dependent such as the plugin's `ReporterLive` can spell
  its return type without depending on `@effected/store`.

This ships as a minor. The schema, the database paths, and every
migration body are unchanged. A database written by either side of the
upgrade stays readable by the other.

## Alternatives rejected

- **Keep `SqliteMigrator` (Decision 32 as written).** Rejected because
  the ledger mismatch that justified it is solved upstream, and keeping it
  means hand-maintaining a client-plus-migrator pair for each of the three
  databases instead of reading the store from the kit.
- **Adopt the ledger without mirroring.** Rejected because an older
  vitest-agent would see an empty or stale `effect_sql_migrations` on a
  file this version created, and try to re-run migrations that had
  already run. Because `registry.db` is machine-global and versions mix in
  practice, that outcome is likely, not a corner case.
- **Make `data.db` a keyed store too.** Rejected for the path-ownership
  and public-surface reasons above, and because doing so would move
  `data.db` out from under `ensureMigrated`'s coordination.

## Consequences

- Every database carries two ledgers, `_store_migrations` (with a
  `_store_meta` marker for one-shot adoption) and a mirrored
  `effect_sql_migrations`. A new store, or a new call site for an existing
  database, must open with `LEDGER_OPTIONS`. A shipped migration key must
  never be renamed, because adoption and mirroring match on the parsed id
  and name.
- Adding a migration is still a file registered in the database's record
  ([Add a Migration](../runbooks/add-a-migration.md)). Store applies it and
  mirrors the row.
- The `Running migration` / `Migrations complete` debug records now come
  from `@effected/store`, in the effect/sql shape the CLI's log-routing
  e2e tests match on.
- The driver now owns the per-connection busy timeout (5 s) and WAL
  journal mode, and `node:sqlite` enables foreign keys by default. The
  `PRAGMA` statements in the `0001` migrations stay, because `0001` is
  never edited, and are harmless. `DataStoreLive`'s per-connection `PRAGMA
  foreign_keys=ON` stays as defense in depth.
- A brand-new file opened by many processes at once can still fail at the
  WAL switch. This is the same exposure the old stack had, not a
  regression; see
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
[^start-mcp-sh]: `../../plugin/bin/start-mcp.sh`
