---
"@vitest-agent/plugin": patch
---

## Bug Fixes

* `ReporterLive` declares its return type explicitly, so the published declaration names `MigrationError` through `effect/unstable/sql/Migrator` instead of `@effect/sql-sqlite-node/SqliteMigrator`, a package `@vitest-agent/plugin` does not depend on and a consumer's typecheck could not resolve.
