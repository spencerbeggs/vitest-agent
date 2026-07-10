---
"@vitest-agent/plugin": patch
---

## Bug Fixes

* Fixed `DataStoreError: NOT NULL constraint failed: coverage_baselines.value` on runs with no coverage data (e.g. `vitest run --passWithNoTests` in a workspace with no test files) — an empty coverage map now short-circuits to "no coverage report" instead of producing a report with non-numeric ("Unknown") totals that fed `NaN` into the baseline ratchet math (#130)
