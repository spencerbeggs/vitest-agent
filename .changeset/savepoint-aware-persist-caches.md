---
"@vitest-agent/engine": patch
---

## Bug Fixes

- Adds `withPersistSavepoint`, a nested transaction for use inside `withPersistTransaction` that discards the tag and file ids cached while a savepoint was open when that savepoint rolls back, so a write the caller recovers from can no longer leave a later write in the same batch referencing a `files` or `tags` row the rollback removed (a `FOREIGN KEY constraint failed` or a dangling id). Outside a batch it is a plain `sql.withTransaction`.
- `DataStore`'s multi-statement writes (`writeCoveragePolicy`, `writeTurn`, `writeTddTask`, `createBehavior`, `updateBehavior`) now open their transaction through it.
