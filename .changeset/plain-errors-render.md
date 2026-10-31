---
"@vitest-agent/sdk": patch
---

## Bug Fixes

* `coerceErrorText` now renders `Error` instances, cycles, bigints, and symbols properly, so the error text stored for such values changes.
* `DataStoreError` and the project-identity errors expose `message` through a getter, so `JSON.stringify` of these errors no longer includes `message`.
* The `inject-env` prefix now only splices UUID-shaped ids.
