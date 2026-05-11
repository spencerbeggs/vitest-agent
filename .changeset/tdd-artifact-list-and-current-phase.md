---
"vitest-agent-sdk": patch
"vitest-agent-mcp": patch
"vitest-agent-plugin": patch
---

## Features

### `tdd_artifact_list` MCP tool

A new read-only MCP tool, `tdd_artifact_list({ tddSessionId, artifactKind?, phaseId?, behaviorId?, limit?, format? })`, returns the artifacts recorded for a TDD session in newest-first order. Lets the orchestrator answer "what's the artifact id I should cite for this phase transition?" without shelling out to `sqlite3`. Markdown output prominently shows `[id=N]` and `[phaseId=N]` so the value can be lifted directly into a follow-up `tdd_phase_transition_request` call. JSON output is available via `format: "json"`.

The SDK gains a matching `DataReader.listTddArtifactsForSession` method.

### `tdd_task get` surfaces the current phase id

The `tdd_task` tool's `get` action now includes a `current phase: <name> [phaseId=N]` line near the top of its markdown output. Previously the agent had to scan the full `## Phases` block looking for the entry without an `→` arrow, or query the database directly. The phaseId is the value `tdd_phase_transition_request` and `tdd_artifact_list` accept.

## Documentation

### `tdd-task` subagent — explicit data-lookup guidance

The `tdd-task` subagent prompt (`plugin/agents/tdd-task.md`) gained a "Data lookup — use these MCP tools, do NOT shell out to sqlite3" section that maps the eleven most common questions the orchestrator asks ("what's my current phase id?", "what's the most recent test_failed_run?", etc.) to the specific tool that answers each one. The section also explicitly licenses exploratory tool use when the table doesn't cover a question. The existing DATABASE_BYPASS anti-pattern entry was tightened to point at the new map.
