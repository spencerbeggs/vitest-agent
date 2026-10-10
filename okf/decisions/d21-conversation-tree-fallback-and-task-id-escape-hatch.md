---
type: Decision
title: Conversation-Tree Fallback and Task-Id Escape Hatch
description: A named teammate session has no parent_session_id link back to the task-opening session, so the parent walk that resolves which open TDD task a hook-recorded artifact belongs to silently misses it; a conversation-scoped fallback plus an explicit --tdd-task-id override close the gap without letting the agent choose where its own evidence lands.
status: stable
tags:
  - tdd
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-10-10T02:40:34Z
  body_sha256: f93323f127b56dfbf8f385635e654dfac9df9aada67b4fe76419c778c5cfa507
sources:
  - id: engine-record-tdd-artifact
    resource: ../../packages/engine/src/programs/record-tdd-artifact.ts
  - id: engine-data-reader-service
    resource: ../../packages/engine/src/services/DataReader.ts
  - id: engine-data-reader-live
    resource: ../../packages/engine/src/layers/DataReaderLive.ts
  - id: engine-data-store-live
    resource: ../../packages/engine/src/layers/DataStoreLive.ts
  - id: migration-0001-conversation-trigger
    resource: ../../packages/engine/src/migrations/0001_initial.ts
  - id: hooks-tdd-artifact
    resource: ../../plugin/hooks/post-tool-use/tdd-artifact.sh
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
---

# Conversation-Tree Fallback and Task-Id Escape Hatch

## Context

See [Glossary: chat/session/tddTask ids](../glossary/chat-session-tddtask-ids.md)
for the three identifiers this decision's join walks across. Hooks are
the only writer of `tdd_artifacts`, and phase-transition
evidence binding requires the artifact's task to resolve to the task
whose open phase is being transitioned. The join between the two is
`record tdd-artifact`'s task resolution: `chat_id` → `sessions` row →
walk `parent_session_id` → first open `tdd_tasks` row. That walk assumes
the session hooks attribute writes to has a parent link back to the
session that opened the task. An unnamed background subagent has one —
`SubagentStart` registers it under a synthesized id with
`parent_session_id` set. A **named teammate** does not: it is an
independent session with no parent link, so its artifacts land under a
session the parent walk never reaches, every phase-transition request
denies with `missing_artifact_evidence`, and the only diagnostic was "no
artifact found" — true but not actionable (issue #144). Dispatching TDD
work to a named teammate is still the wrong call, but the failure mode
was silent and unrecoverable.

## Decision

Three layers, in order of how automatic they are.

**1. Conversation-tree fallback (automatic).**
`DataReader.listTddTasksForSession` gains a `walkConversation` option
(`packages/engine/src/services/DataReader.ts`). After the parent
walk, when the session's own `conversation_id` is non-null, the lookup
also includes every other session sharing that `conversation_id`; rows
are ordered so a task owned by an `agent_kind = 'main'` session sorts
first, then by `started_at DESC`
(`packages/engine/src/layers/DataReaderLive.ts`). `record
tdd-artifact` passes `{ walkParents: true, walkConversation: true }`
(`packages/engine/src/programs/record-tdd-artifact.ts`). A null
`conversation_id` never triggers the fallback, so two unrelated sessions
can never be joined by accident. The conversation is the right join key
because it is exactly what a named-teammate dispatch and its dispatcher
still share when the parent-session link is absent.

**2. Explicit task-id escape hatch (manual).** `agent record
tdd-artifact --tdd-task-id <id>` bypasses `chat_id` → session → task
resolution entirely and writes under that task's current open phase,
failing loudly when the task is unknown or already ended
(`packages/engine/src/programs/record-tdd-artifact.ts`,
`recordTddArtifactByTaskIdEffect` selected by
`dispatchRecordTddArtifactEffect` whenever the flag is present). The
`post-tool-use/tdd-artifact.sh` hook forwards
`VITEST_AGENT_TDD_TASK_ID` as this flag
(`plugin/hooks/post-tool-use/tdd-artifact.sh`). This
exists for the shape layer 1 cannot fix — `conversation_id` unpopulated
on one of the two sessions — and the agent-facing docs frame it as a
diagnosed-split override, not a default.

**3. Diagnostic on the denial.** When the gate finds no artifact,
`countRecentArtifactsInOtherSessionsOfConversation`
(`packages/engine/src/services/DataReader.ts`,
`packages/engine/src/layers/DataReaderLive.ts`) counts
artifacts recorded in the last ten minutes under other sessions of the
task's conversation; a non-zero count is appended to the denial's human
hint together with the two remedies above. The bare "no artifact found"
message was true but useless; the diagnostic turns a silent split into an
actionable message without changing the denial shape itself.

**Prerequisite: `sessions.conversation_id` was never populated.** Layer 1
depends on a column that, in production, was always null. `record
session-start` inserts the `sessions` row from the `SessionStart` hook,
whose payload carries no conversation id; the canonical id is minted
later by `register-agent`'s conversation mapping, and an immutability
trigger forbade any subsequent update. Three changes closed that: the
trigger's `WHEN` clause gained
`OLD.conversation_id IS NOT NULL AND ...`, permitting exactly one
null-to-value transition while still aborting any value-to-different-value
change (`packages/engine/src/migrations/0001_initial.ts`);
`DataStore` gained `setSessionConversationIdIfNull`, an
`UPDATE ... WHERE conversation_id IS NULL` that is idempotent and
race-safe (`packages/engine/src/services/DataStore.ts`,
`packages/engine/src/layers/DataStoreLive.ts`); and
`registerAgentEffect` passes `conversationId` on a fresh session insert
and runs the backstop update unconditionally otherwise.
`register-agent` is the only fix point because it is the only
hook-driven path that knows the conversation id.

## Alternatives rejected

Making the task-id escape hatch the default resolution path was rejected.
A task id supplied through the environment is exactly the kind of
agent-supplied evidence pointer hooks-only writes exist to keep out of
the write path: hooks observe, the agent does not choose where its
evidence lands. The hatch is tolerated as a manual override because the
agent still cannot *write* an artifact through it — only redirect a
hook-observed one to a task it already owns — and because
`recordTddArtifactByTaskIdEffect` refuses closed tasks, bounding the
worst misuse to attributing a genuine observation to the wrong *open*
task of the same agent. Making it the default would normalize that
pointer; keeping it behind a diagnosed denial keeps the hooks-only
posture intact.

## Consequences

The immutability-trigger relaxation is narrowly scoped to one
null-to-value transition on `sessions.conversation_id`; every other table
carrying `conversation_id` keeps its unconditional immutability trigger.
Any future join that wants to widen "same task" beyond parent-session and
same-conversation has to extend `listTddTasksForSession`'s options rather
than add a third ad hoc resolution path.
