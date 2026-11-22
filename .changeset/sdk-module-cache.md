---
"@vitest-agent/sdk": minor
---

## Features

- Add `ModuleCacheStat` and an optional `moduleCache` on `AgentReport`: how well Vitest's fs module cache served a project's run (whether `fsModuleCache` was on, the time spent transforming modules and its share of tracked time, and the cache entries written). Add `ModuleCacheEntry`, an optional `moduleCache` list on `RunFinished` and `RenderState`, and the `formatModuleCacheLine`, `formatModuleCacheLines` and `describeModuleCache` formatters. `ProjectSummary` is unchanged. The published run report schema gains the optional field.
