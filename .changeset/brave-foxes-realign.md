---
"@vitest-agent/engine": patch
---

## Bug Fixes

Fixes runtime incompatibility with `effect` `4.0.0-rc.118` and the current `@effected` kit. Published `0.2.8` pins `effect`/`@effect/platform-node`/`@effect/sql-sqlite-node` to `4.0.0-rc.117` and older `@effected` package ranges; installed next to a consumer on `rc.118` this fails at import time. This release moves the dependency range to `4.0.0-rc.118` and the matching `@effected/*` ranges, and renames every `effect/unstable/*` import (including inside the SQLite migrations) to its `effect/*` equivalent to match. No public API or schema changes.
