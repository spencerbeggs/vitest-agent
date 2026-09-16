---
"@vitest-agent/plugin": patch
---

## Bug Fixes

Fixes `ConfigValidation` printing identical diagnostics once per project in a multi-project Vitest run (issue #400).

* `configureVitest` fires once per project against root-level `ConfigValidation` config that is identical across every project, so an N-project run previously printed N copies of every warning/info line
* Each distinct diagnostic line (code + message + remediation) is now written to stderr at most once per Vitest instance, tracked via a module-scoped `WeakMap` keyed on the Vitest instance, matching the existing per-instance guard pattern used for the aggregating reporter and cache-key generator
* A different Vitest run in the same process still reports its own diagnostics from a fresh state; errors still throw exactly as before
