---
"@vitest-agent/plugin": patch
---

## Bug Fixes

Fixes runtime incompatibility with `effect` `4.0.0-rc.118` and the current `@effected` kit. Published `5.0.1` pins `effect`/`@effect/platform-node` to `4.0.0-rc.117` and older `@effected` package ranges; installed next to a consumer on `rc.118` this fails at import time. This release moves the dependency range to `4.0.0-rc.118` and the matching `@effected/*` ranges, and renames the `effect/unstable/sql/*` imports used for the reporter layer's return type to their `effect/sql/*` equivalents. No public API changes.
