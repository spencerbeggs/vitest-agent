---
"@vitest-agent/plugin": patch
---

## Performance

* The reporter now persists each run's results in one SQLite transaction. On a 17k-test suite the post-run window dropped from about 6.8 s to 1.5 s locally (about 24 s on CI before).

## Bug Fixes

* Run-end persistence is atomic: a run that fails midway is rolled back instead of leaving partial data. Fixes #568.
