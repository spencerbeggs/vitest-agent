---
"@vitest-agent/mcp": patch
---

## Bug Fixes

* `ServerLayer` no longer requires the engine's `OutputRenderer` service — no tool or prompt ever used it, so embedders and test harnesses no longer have to provide an output-pipeline layer for nothing
