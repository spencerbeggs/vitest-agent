---
"@vitest-agent/sdk": patch
---

## Bug Fixes

Keeps the `generatedAt` ISO-8601 `pattern` in the published run-report JSON Schema under `effect` `4.0.0-rc.118`. That release omits a pattern from generated JSON Schema unless its RegExp carries the `u` flag, which would have silently widened the published contract to any string. The pattern now carries the flag, and the emitted `schemas/5.0/run.json` is unchanged.
