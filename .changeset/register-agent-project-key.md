---
"@vitest-agent/cli": patch
---

## Bug Fixes

* `agent register-agent` and `agent end-agent` now write to the `--project-key` database. They previously reused the cwd-derived data store through Effect's shared layer memo map.
