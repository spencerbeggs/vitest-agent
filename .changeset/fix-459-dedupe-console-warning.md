---
"@vitest-agent/plugin": patch
---

## Bug Fixes

* Fixed the invalid `VITEST_AGENT_CONSOLE` warning printing once per project instead of once per Vitest run — `resolveConsoleMode` now writes through the same per-instance dedupe sink already used for `ConfigValidation` diagnostics, so an N-project run prints the line once
