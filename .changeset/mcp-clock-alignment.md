---
"@vitest-agent/mcp": patch
---

## Refactoring

- Tool handlers read the time from Effect's `Clock` / `DateTime` instead of the wall clock (`cache_health` staleness, TDD task, phase and hypothesis timestamps, `register_agent`, idempotent-replay records), so tests can drive them with `TestClock`. The stored and served formats are unchanged.
