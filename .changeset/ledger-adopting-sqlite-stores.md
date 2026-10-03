---
"@vitest-agent/engine": minor
---

## Features

### SQLite assembly on `@effected/store`

All three databases (`data.db`, `sessions.db`, `registry.db`) now open through `@effected/store`, which adopts effect/sql's existing `effect_sql_migrations` ledger on first open.

* Existing 2.x databases keep their migration history and nothing is re-run.
* The ledger is not mirrored back, so an older vitest-agent opening a database this version created is not supported.
* New public type alias `PlatformLiveError` (`StoreError | StoreMigrationError`) is now the error type of `PlatformLive` and of `makeSqliteStack`'s `MigratorLayer`. It is exported from the package barrel and from `./testing`.
* `resolveHookPaths` now derives `registryDbPath` with `@effected/app`'s `AppStore.location`, and `SidecarPlatformLive` opens every path in `SidecarPaths` as given.
* `MigrationRecord` now types each migration's error as `SqlError` (previously `unknown`). A custom record passed to `makeSqliteStack` whose migrations fail with another error type no longer typechecks.
* Migration debug records now come from the store.
