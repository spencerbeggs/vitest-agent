---
"vitest-agent-sdk": patch
"vitest-agent-cli": patch
"vitest-agent-plugin": patch
---

## Bug Fixes

### TDD artifact binding survives `cc_session_id` rotation and orphaned subagent rows

Recording paths (`record turn`, `record tdd-artifact`) no longer fail with `Unknown cc_session_id` when Claude Code rotates the host session id mid-window (continuation, compaction, MCP reconnect) without re-firing `SessionStart` for the new id. A new three-step session resolver in the CLI lib falls through exact match → subagent-prefix fallback → idempotent bootstrap, so a missing main session row self-heals on first hook invocation.

The phase-transition validator can now find evidence written under subagent rows whose tdd_session lives under the parent main row. `DataReader.listTddSessionsForSession` accepts a `walkParents: true` option that traverses `sessions.parent_session_id` (bounded to 64 hops, cycle-safe). Before this fix, dispatching the TDD orchestrator as a subagent caused every `red → green` transition to fail with `missing_artifact_evidence` because artifacts and tdd_sessions landed on different session rows.

The `subagent-start-tdd.sh` plugin hook now pre-bootstraps the parent main row before creating the subagent row, and unconditionally sets `parent_session_id` from the orchestrator's host session id. The earlier conditional check on the hook payload's `parent_session_id` field was unreliable because Claude Code does not consistently populate that field for `context: fork` dispatches.

## Features

### `DataStore.upsertSession` (idempotent insert)

The data layer gains `upsertSession(input)` alongside the existing `writeSession`. Implemented as `INSERT … ON CONFLICT(cc_session_id) DO NOTHING` followed by `SELECT id`, so concurrent SessionStart hook invocations and lazy bootstrap calls land on the same row id without race conditions. `record session-start` now uses this internally; repeated invocations no longer error on `UNIQUE` constraint violations.

### `DataReader.findSessionsByCcPrefix`

New read query that returns session rows whose `cc_session_id` begins with a given prefix, newest first. The CLI session resolver uses it to recover the synthetic subagent row when a hook fires under the bare parent host id.

## Refactoring

### `record turn` and `record tdd-artifact` CLI flags

The `--project` and `--cwd` options on these subcommands are now optional. When omitted, the lib resolves `project` from `package.json#name` in `cwd` and `cwd` from `process.cwd()`. Hook scripts that call these subcommands without the flags continue to work unchanged.
