---
"@vitest-agent/ui": patch
---

## Bug Fixes

- `dispatch` and `dispatchInk` now append a "Coverage thresholds skipped: partial run (N of M test files)" note on a scoped run, and `synthesizeFromAgentReport` no longer recomputes threshold violations for a scoped run — thresholds compared against a subset of files were never meaningful (#160).
- `formatBelowTargetTable` no longer truncates file paths; the file column now sizes itself to the longest printed path instead of clipping long paths to a fixed width (#237).
