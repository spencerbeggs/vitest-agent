---
"@vitest-agent/engine": minor
---

## Features

- `DataReader.getCoverage`, `getLatestRun` and `getFileCoverage` resolve a project run's per-file coverage through the sibling run in the same `invocation_id` that carries the `file_coverage` rows, so a reporter that writes them once per invocation still answers every project's coverage queries
- Databases written by older reporters (one copy of the rows under every run of an invocation) read back as exactly one copy; the lookup never crosses an invocation boundary
