---
"@vitest-agent/cli": patch
---

## Bug Fixes

- `agent register-agent` now populates `sessions.conversationId`, a column that was never actually set in production, so the cross-session TDD-task lookups it powers were silently going nowhere (#144).
- `agent record tdd-artifact` gained a `--tdd-task-id` escape hatch that bypasses `chat_id` → session → task resolution entirely, for a detached-session environment where neither the parent-session walk nor the conversation-id fallback resolves the right task (#144).
