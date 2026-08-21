---
"@vitest-agent/mcp": patch
---

## Bug Fixes

`hypothesis({ action: "validate" })` no longer requires an explicit `validatedAt`. The served schema already declared it optional, but the handler required it internally, so a bare `{ id, outcome }` call failed with an unhelpful error. `validatedAt` now defaults server-side to the current time when omitted, and is honored verbatim when supplied.
