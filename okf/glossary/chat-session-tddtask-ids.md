---
type: Glossary
title: "chatId, sessionId, tddTaskId"
description: >-
  Three-tier agent-facing identifier naming: chatId is the host's rotating
  per-process id, sessionId is the SQLite agent-run row, and tddTaskId is
  one TDD orchestration task. Replaces the earlier ccSessionId/tddSessionId
  vocabulary.
tags: [dx, tdd, architecture]
status: draft
generated:
  by: okfit/claude-code
  at: 2026-10-10T02:40:34Z
  body_sha256: d60edf573d677124cb97e13f6224859ad2cc76619dd8a1c314a746b30bf125c9
sources:
  - id: identity-schema
    resource: ../../packages/sdk/src/schemas/Identity.ts
  - id: migration-0001
    resource: ../../packages/engine/src/migrations/0001_initial.ts
  - id: session-start-hook
    resource: ../../plugin/hooks/session/start.sh
---

# chatId, sessionId, tddTaskId

Three identifiers with overlapping-sounding names appear on almost every
row this repository persists, and each rotates or persists on a different
schedule.

## `chatId` — the host's per-process id, and it rotates

`ChatId` is "the agent host process's chat id (Claude Code's per-process
chat UUID, etc.)" — shorter-lived than a conversation, since one
conversation can span multiple chats across `--resume` invocations
(`packages/sdk/src/schemas/Identity.ts:23-32`). Concretely, it is Claude
Code's own `session_id` field from the hook JSON payload
(`chat_id=$(hook_input session_id)`, `plugin/hooks/session/start.sh`) — it rotates on `/clear`,
on `--resume`, and across compaction. It is stored as `sessions.chat_id`
(`UNIQUE NOT NULL`, `packages/engine/src/migrations/0001_initial.ts:504`).

## `sessionId` — the SQLite agent-run row, stable within one run

`sessions.id` (an `INTEGER PRIMARY KEY AUTOINCREMENT`,
`packages/engine/src/migrations/0001_initial.ts:503`) is what "session id"
means as an agent-facing concept in this codebase today: the primary key of
one row in the `sessions` table, created once per `chatId` at
`SessionStart` and referenced by everything that happened during that
agent run (`agents.session_id`, `turns.session_id`, `tdd_tasks.session_id`,
and more). It does not rotate mid-run the way `chatId` can appear to;
plugin/subagent hierarchies are expressed via `parent_session_id`
referencing another `sessions` row.

## `tddTaskId` — one TDD orchestration task

`TddTaskId` "replaces the legacy `tdd_session_id` vocabulary so 'session'
is unambiguous in the codebase"
(`packages/sdk/src/schemas/Identity.ts:34-41`). Its storage PK is
`tdd_tasks.id`, itself scoped to a containing `sessions` row via
`tdd_tasks.session_id` (`packages/engine/src/migrations/0001_initial.ts:679-692`).
A TDD task's parent/child relationship uses `parent_tdd_task_id`, distinct
from a session's `parent_session_id`.

## Canonical UUIDs vs. the SQLite row PKs

Two more identifiers complete the picture and do not rotate at all:
`AgentId` — "generated server-side at `register_agent` time... stable
across transport reconnects" — and `ConversationId` — "the unit 'all work
on this feature' rolls up to... survives `claude --resume` and parallel
windows" (`packages/sdk/src/schemas/Identity.ts:1-21`). These are populated
by the `SessionStart` hook's `register-agent` call and set as pluginfinity
session values (`hook_env_set VITEST_AGENT_CONVERSATION_ID`,
`plugin/hooks/session/start.sh`), independent of both the
rotating `chatId` and the SQLite `sessions.id` / `tdd_tasks.id` row keys.

## The trap

Older code and prose used `ccSessionId`, `tddSessionId`, and a bare,
overloaded `sessionId` for different things across this same set of
concepts — a naming collision the current schema comment calls out
directly: "Agent-facing ID convention (post `chatId` / `sessionId` /
`tddTaskId` rename): the `sessions` row PK is `sessions.id`, the host chat
UUID column is `sessions.chat_id`, and a TDD task PK is `tdd_tasks.id`"
(`packages/engine/src/migrations/0001_initial.ts:22-24`). One further trap
survives inside the schema itself: the `tdd_session_goals` and
`tdd_session_behaviors` table names retain their legacy `_session_` segment,
but their own `session_id` columns point at `tdd_tasks(id)` — a TDD task,
not a `sessions` row
(`packages/engine/src/migrations/0001_initial.ts:25-27`, `:696-699`).
Reading any of these three names in isolation, without checking which
table's column it is, risks attributing a row to the wrong scope entirely.

See [Decision D18](../decisions/d18-per-instance-identity-from-claude-plugin-data-and-session-id.md),
[Decision D21](../decisions/d21-conversation-tree-fallback-and-task-id-escape-hatch.md),
[Interface hook-env-contract](../interfaces/hook-env-contract.md), and
[DataModel sqlite-schema](../models/sqlite-schema.md).
