---
"@vitest-agent/reporter": patch
---

## Bug Fixes

- `summarizeProject` now derives `timeoutCount` from per-test timeout errors and subtracts it from `failCount`, so a timed-out test is reported once as a timeout instead of being double-counted as a plain failure (#242).
