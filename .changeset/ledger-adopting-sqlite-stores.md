---
"@vitest-agent/engine": minor
---

## Features

### SQLite assembly on `@effected/store`

All three databases (`data.db`, `sessions.db`, `registry.db`) now open through `@effected/store` and `@effected/app`, with ledger adoption and mirroring of effect/sql's `effect_sql_migrations` table.

* Existing 2.x databases keep their migration history and nothing is re-run.
* Older installs (the released 5.x plugin) can still open files this version created or migrated; this was verified against `@vitest-agent/plugin@5.2.1` in both directions.
* New public type alias `PlatformLiveError` (`StoreError | StoreMigrationError`) is now the error type of `PlatformLive` and of `makeSqliteStack`'s `MigratorLayer`. It is exported from the package barrel and from `./testing`.
* `resolveHookPaths` now derives `registryDbPath` from `AppStore.location`, the same options `SidecarPlatformLive` opens, so the two can no longer disagree.
* Migration debug records now come from the store.
