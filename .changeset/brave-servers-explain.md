---
"@vitest-agent/mcp": patch
---

## Bug Fixes

- `test_coverage` now renders the enforced `coverage.thresholds` and the aspirational `coverageTargets` as separate columns/sections, and splits files below the enforced threshold (build-blocking) from files below the aspirational target (informational) instead of reporting the target as the enforced threshold (#237).
- `run_tests` no longer fails coverage thresholds on a single-file or otherwise scoped call. The result gains a `scopedNote` field (also folded into the markdown summary) explaining that thresholds were skipped because the run only covered a subset of the project's test files (#160).
