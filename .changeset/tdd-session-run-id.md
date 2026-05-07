---
"vitest-agent-sdk": minor
"vitest-agent-mcp": minor
---

## Features

### TDD session run ID

`tdd_session_start` now accepts an optional `runId` string. When provided, it is stored on the session and returned in `tdd_session_get` output. The MCP idempotency cache is re-keyed on `(procedure_path, run_id)` so dispatching the same goal text multiple times with different run IDs creates independent sessions rather than returning the same ended session.

The `run_id` column is added to the `tdd_sessions` table with a partial unique index on `(session_id, run_id) WHERE run_id IS NOT NULL`, replacing the previous `UNIQUE(session_id, goal)` constraint. This allows repeated lifecycle runs without goal-text disambiguation workarounds.

## Maintenance

- Migrations 0003 (`mcp_idempotent_responses`), 0004 (`test_cases.created_turn_id`), 0005 (`failure_signatures.last_seen_at`), and 0006 (`tdd_sessions.run_id`) are folded into `0002_comprehensive` in-place. The four individual migration files are deleted. All consumers (`CliLive`, `McpLive`, `ReporterLive`, `DataStoreTest`, `ensure-migrated`) updated to reference only `0001` and `0002`. Existing development databases must be deleted and recreated — no production databases exist prior to the 2.0 release.
