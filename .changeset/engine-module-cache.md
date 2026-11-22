---
"@vitest-agent/engine": minor
---

## Features

- Add migration `0008_module_cache`: four nullable `module_cache_*` columns on `test_runs` holding a project's module cache stat, with no backfill. `DataStore.writeRun` accepts `moduleCache`; `DataReader` returns it on `getLatestRun` and on each `getRunsByProject` summary, and adds `getModuleCacheHistory` for recent runs newest first. The triage brief shows each project's latest stat against the previous run.
