---
"@vitest-agent/cli": patch
---

## Bug Fixes

Fixes runtime incompatibility with `effect` `4.0.0-rc.118` and the current `@effected` kit. Published `3.2.1` pins `effect`/`@effect/platform-node`/`@effect/sql-sqlite-node` to `4.0.0-rc.117` and older `@effected` package ranges; installed next to a consumer on `rc.118` this fails at import time (for example `ERR_MODULE_NOT_FOUND: effect/process/ChildProcess`). This release moves the dependency range to `4.0.0-rc.118` and the matching `@effected/cli`, `@effected/engine`, and `@effected/workspaces` ranges, and renames every `effect/unstable/*` import to its `effect/*` equivalent to match. No public CLI behavior changes.
