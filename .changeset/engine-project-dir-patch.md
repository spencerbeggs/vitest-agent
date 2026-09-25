---
"@vitest-agent/engine": patch
---

## Bug Fixes

* `resolveProjectDir` now treats blank/whitespace-only values and unsubstituted `${...}` placeholders in `LaunchContext` as unset, instead of resolving them as a literal directory.
