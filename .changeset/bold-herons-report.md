---
"@vitest-agent/plugin": patch
---

## Bug Fixes

* The `tdd-task` agent can now deliver its final report and answer a `shutdown_request` when dispatched as a named teammate — added `SendMessage` to its tool allowlist, since without an explicit reply the orchestrator never saw the agent's result (#137)
* The `tdd-task` agent's tool allowlist also gains `LSP` (post-edit type errors and code navigation during the red-green-refactor loop) and `ReportFindings` (structured finding reports when its test-quality review passes call for them)
