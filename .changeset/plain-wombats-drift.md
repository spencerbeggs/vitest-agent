---
"@vitest-agent/plugin": patch
---

## Bug Fixes

* The reporter now threads each test's module path into history writes and classification lookups, so identically-named tests in different files are tracked as independent history series instead of colliding (see the `@vitest-agent/sdk` fix for `test_history` identity)
