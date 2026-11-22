---
"@vitest-agent/plugin": minor
---

## Features

- Report Vitest's fs module cache effectiveness per project. The reporter sums each file's `setupFetchDuration + collectFetchDuration` over tracked time (as Vitest's own transform diagnostic does), counts the cache entries each project wrote during the run by reading the resolved cache directory and the project's own `_manifest-*.json` (matched by its `name` and `root`) through an injected `@effected/walker` `WalkerSyncOps` (a project with no manifest wrote nothing; projects sharing a module key both count it, so the per-project counts can sum to more than the directory holds), attaches the stat to each project's report and `RunFinished`, and persists it on the project's `test_runs` row. Exact hit counts are unavailable and never estimated.
