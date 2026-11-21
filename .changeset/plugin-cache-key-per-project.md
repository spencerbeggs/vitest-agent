---
"@vitest-agent/plugin": patch
---

## Bug Fixes

- The fs module cache tag cache-key generator is registered for every project, not once per Vitest run. Vitest keeps one generator set per project config, so in a multi-project run every project after the first had no tag material in its cache key. A test file whose tags changed could then be served from Vitest's module cache with its old tag prelude. Every project now folds its files' resolved tags into the key.
