---
"@vitest-agent/mcp": patch
---

## Refactoring

* `createCurrentSessionIdRef` is now backed by Effect's `MutableRef` instead of a hand-rolled closure cell (issue #331). The `CurrentSessionIdRef` interface and its `get`/`set` semantics are unchanged.
