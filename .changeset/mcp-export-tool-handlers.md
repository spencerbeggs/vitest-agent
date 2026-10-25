---
"@vitest-agent/mcp": minor
---

## Features

- Export every tool's `Tool` value and `handle<Name>` handler from the package entry, alongside the input and result schemas. `toolHandlers` already exposed the handler types, and under TypeScript 7.1 its declaration names each handler instead of inlining the signature, so the handlers are now first-class exports.
- Export the input and result schemas and types for `hypothesis`, `tdd_task`, `tdd_goal`, and `tdd_behavior`, which were missing from the entry.
