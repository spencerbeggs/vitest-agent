---
"@vitest-agent/sdk": patch
---

## Bug Fixes

* `writeBaselines` now skips non-finite metric values (e.g. `NaN` produced by ratchet math over an empty coverage run) instead of binding them as SQL `NULL`, which tripped the `NOT NULL` constraint on `coverage_baselines.value` (#130)
