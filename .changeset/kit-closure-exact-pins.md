---
"@vitest-agent/plugin": patch
---

## Build System

* Every `@vitest-agent/*` package now publishes exact versions of `effect`, `@effect/*` and `@effected/*`, so an installed `@vitest-agent/plugin` runs exactly the Effect and kit releases it was tested with
* A project that uses a different Effect or `@effected` kit release can install the plugin alongside it; the plugin keeps its own copies instead of picking up newer kit patches with no plugin release
