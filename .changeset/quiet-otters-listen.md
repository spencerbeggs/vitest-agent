---
"@vitest-agent/sdk": minor
---

## Bug Fixes

Test history is now keyed by file, not just by test name. Previously `test_history` rows were identified by `(project, fullName, timestamp)`, so two test files that happened to share a `describe > it` name collided on write (`UNIQUE constraint failed: test_history`) and were conflated on read — flaky/persistent/recovered detection could merge two unrelated tests into one series, potentially hiding a real persistent failure behind a same-named passing test in another file.

* Added a `modulePath` column; history identity is now `(project, modulePath, fullName, timestamp)` end to end

## Features

* `TestHistory` schema and the `FlakyTest` / `PersistentFailure` interfaces gain a `modulePath` field
* Exported `historyKey` from `HistoryTracker` — builds the composite `(modulePath, fullName)` key so consumers can key their own lookup maps consistently
* `DataStore.writeHistory` gains a required `modulePath` parameter. Custom reporters or scripts that call `writeHistory` directly need to pass the test module's path:

```ts
// before
yield* store.writeHistory(project, fullName, runId, timestamp, state);

// after
yield* store.writeHistory(project, fullName, modulePath, runId, timestamp, state);
```

Pre-2.0 note: this changes the `test_history` table shape. Delete your local `data.db` after upgrading (standing pre-2.0 policy — no incremental migration was written).
