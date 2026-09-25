---
"@vitest-agent/plugin": major
---

## Breaking Changes

As the carrier that ships the `vitest-agent-mcp` bin, `@vitest-agent/plugin` carries the `@vitest-agent/mcp` wire break through to consumers: the `UnexpectedToolError` envelope is gone (undeclared tool failures now surface a scrubbed internal-error message), and the `tdd_goal`/`tdd_behavior`/`tdd_phase_transition_request` remediation field is renamed `humanHint` → `hint`. See the `@vitest-agent/mcp` changelog for the full list.

## Features

* Added a `CURRENT_PLUGIN_VERSION` module, and threaded the carrier's own identity through both the `vitest-agent` and `vitest-agent-mcp` bin shims so each front end can report it was launched via the carrier.
