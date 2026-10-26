---
"@vitest-agent/mcp": minor
---

## Features

* `run_tests` now returns an optional `runDiagnostics` object (performance hints, post-run timing, persistence status) alongside the existing result (#544)
* `run_tests` `suggestedActions` now merges configuration actions first, then diagnostic actions such as "Results were not saved" or slow post-run work
