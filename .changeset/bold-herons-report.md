---
"@vitest-agent/plugin": patch
---

## Bug Fixes

* The `tdd-task` agent can now deliver its final report and answer a `shutdown_request` when dispatched as a named teammate — added `SendMessage` to its tool allowlist, since without an explicit reply the orchestrator never saw the agent's result (#137)
