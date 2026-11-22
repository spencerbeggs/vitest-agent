---
"@vitest-agent/plugin": minor
---

## Features

- Report Vitest's fs module cache effectiveness per project. The reporter sums each file's `setupFetchDuration + collectFetchDuration` over tracked time (as Vitest's own transform diagnostic does), counts the cache entries written during the run by reading the resolved cache directory through an injected `@effected/walker` `WalkerSyncOps`, attaches the stat to each project's report and `RunFinished`, and persists it on the project's `test_runs` row. Exact hit counts are unavailable and never estimated.
