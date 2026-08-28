---
"@vitest-agent/mcp": patch
---

## Refactoring

- Extract shared per-project target resolution and non-empty group accumulation into a private helper used by `inventory` and `test`, reducing duplicated query/aggregation paths while preserving each tool's response shape and counts.
