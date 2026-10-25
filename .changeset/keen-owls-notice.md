---
"@vitest-agent/mcp": minor
---

## Features

* `run_tests` errors can carry `reason: "stale-install"` with a remedy to restart the MCP server via `/mcp`, when the project's Vitest install changed under the running server
* `run_tests` results can include `suggestedActions`, such as coverage-config warnings
* `test_history` returns `strayOutput` with `runs`, `runsWithStrayOutput` and `latest`; `test_status` entries can carry `strayOutput`; `triage_brief` adds a stray-output line

## Bug Fixes

* The `run_tests` help text lists `projectRoot` instead of the removed `format` parameter
