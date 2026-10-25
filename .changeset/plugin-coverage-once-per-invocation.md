---
"@vitest-agent/plugin": patch
---

## Performance

- Write `file_coverage` rows once per run invocation instead of once per project: a 40-project workspace with 88 flagged files now stores 88 rows per run instead of 3,520. Each project keeps its own `coverage_trends` row, so per-project trend series are unchanged

## Bug Fixes

- `CoverageAnalyzer` drops any coverage-map path under a `node_modules` segment, and honours Vitest's resolved `coverage.include` / `coverage.exclude` globs when available, so a dependency swept in by the untested-files glob never reaches a persisted coverage row
