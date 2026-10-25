---
"@vitest-agent/engine": minor
---

## Features

### Run retention for `data.db`

* `DataStore.pruneRuns(policy)` applies a `RunRetentionPolicy`: every `test_runs` row beyond the newest `keepRuns` of its project, and any run older than `maxAgeDays` when set, is deleted in one statement; the schema's cascades remove the dependent modules, cases, tags, errors, frames, coverage and trend rows, and a second statement garbage-collects `files` rows nothing references any more. Returns `{ prunedRuns, prunedFiles }`. Safe to run inside `withPersistTransaction` after the run's own writes: the run just written is never pruned. Before deleting, `file_coverage` rows held by a pruned run are moved onto the lowest surviving run of the same invocation (skipped when a survivor already has coverage rows), so a sibling project's coverage read stays whole.
* Migration `0003_run_retention`: `test_history.run_id` becomes nullable with `ON DELETE SET NULL` (the table is rebuilt with every row kept), so pruning a run detaches its classification history instead of deleting it; every child foreign-key column a run prune or the file GC reaches is indexed, plus `test_runs(project, timestamp)`.
