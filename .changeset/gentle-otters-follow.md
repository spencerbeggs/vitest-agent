---
"@vitest-agent/sdk": minor
---

## Features

- `DataReader.listTddTasksForSession` gained a `walkConversation` option: when true and the session's `conversationId` is non-null, it also returns TDD tasks opened under other sessions sharing that `conversationId` — the fallback for a named-teammate or otherwise detached session whose hooks can't reach the task through the parent-session walk alone (#144).
- New `DataStore.setSessionConversationIdIfNull` backfills `sessions.conversationId` on a row that was inserted before the canonical conversation id was known; it no-ops when the row already carries a value (#144).
- New `DataReader.countRecentArtifactsInOtherSessionsOfConversation` counts artifacts recently recorded under other sessions of the same conversation — powers a new diagnostic hint in `@vitest-agent/mcp`'s `tdd_phase_transition_request` (#144).
- `SessionInput` and `SessionDetail` gained a `conversationId` field (#144).

## Bug Fixes

- The `trg_sessions_conv_id_immutable` trigger in the canonical `0001_initial` migration now permits one null→value transition on `sessions.conversation_id`, instead of rejecting every UPDATE unconditionally. This is a pre-2.0 schema change with no migration path — reset an existing local `data.db` with `vitest-agent db reset` (#144).
