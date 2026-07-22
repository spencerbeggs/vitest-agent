---
"@vitest-agent/sdk": patch
---

## Bug Fixes

* Added `DataReader.getSessionByTddTaskId`, resolving the session a TDD task was opened under. Powers the MCP `hypothesis` tool's deterministic session binding by `tddTaskId`.
