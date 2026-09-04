---
"@vitest-agent/plugin": patch
---

## Bug Fixes

- The reporter now persists the resolved `coverage.thresholds` and `coverageTargets` on every run that configures them, so `test_coverage` can render the enforced threshold and the aspirational target as distinct facets instead of reporting the target as if it were the enforced threshold (#237).
- A scoped or partial run (`files` / `project` / `tags` filter, or fewer test files started than exist in the project) is now detected and routed through a separate coverage-processing path that suppresses `ThresholdViolation` events and neutralizes Vitest's native `coverage.thresholds` check for that run, instead of letting Vitest fail thresholds against the whole-project denominator on a subset of files. `test_runs.scoped` is persisted for every run (#160).
