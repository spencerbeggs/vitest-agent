---
"@vitest-agent/reporter": patch
---

## Bug Fixes

- Fixes `MaxPerformanceEntryBufferExceededWarning` on long test runs. React 19's development reconciler emits a `performance.measure()` per component render and nothing drained the global user-timing buffer; the live renderer now clears it after each render cycle.
