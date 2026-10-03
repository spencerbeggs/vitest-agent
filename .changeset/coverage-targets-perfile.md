---
"@vitest-agent/plugin": patch
---

## Bug Fixes

* A file matched by a `coverageTargets` glob entry with an object `perFile` is now checked against the `perFile` numbers when deciding `belowTarget`, the same precedence the threshold check already used. Previously the glob's aggregate metric numbers were applied to every matched file and `perFile` was ignored.
