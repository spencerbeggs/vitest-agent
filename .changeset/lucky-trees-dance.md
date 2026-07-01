---
"@vitest-agent/plugin": patch
---

## Build System

The published `peerDependencies` on `@vitest-agent/cli` and `@vitest-agent/mcp` are now exact-pinned instead of an inexact caret range, so an installed plugin always pulls the exact cli and mcp versions it was built against. They are declared as source `workspace:*` dependencies and promoted back to peers by the build transform.

## Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @vitest-agent/cli | peerDependency | updated | ^1.0.2 | 1.0.2 |
| @vitest-agent/mcp | peerDependency | updated | ^1.1.0 | 1.1.0 |
