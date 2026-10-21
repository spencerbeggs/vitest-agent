---
"@vitest-agent/engine": minor
---

## Features

### `withPersistTransaction`

New `@public` export that runs `DataStore` writes as a single SQLite write transaction. Everything inside the block commits together or not at all: a failure rolls the whole block back before the error propagates.

* Inside the block, `DataStoreLive` caches tag and file ids per run and defers the `test_history` keep-10 prune to one statement per run, executed before commit. The persisted rows are the same as without the block.
* The block does not yield to the scheduler, so a second connection in the same process cannot deadlock it in `node:sqlite`'s busy handler. Keep the wrapped effect free of genuinely asynchronous work.

## Performance

* `data.db` connections now open with `PRAGMA synchronous = NORMAL`, so commits under WAL no longer fsync.
