---
"@vitest-agent/mcp": patch
---

## Bug Fixes

* `run_tests` now gives each MCP-driven invocation its own coverage `reportsDirectory` (via `mkdtemp`), fixing collisions where two concurrent runs deleted each other's in-flight coverage report files
* Scope: this fix covers runs launched through the MCP server's `run_tests` tool. Concurrent direct `vitest` process invocations outside the MCP tool still share the default coverage directory and can still collide
