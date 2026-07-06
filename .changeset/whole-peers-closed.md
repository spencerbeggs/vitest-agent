---
"@vitest-agent/cli": patch
"@vitest-agent/mcp": patch
"@vitest-agent/plugin": patch
"@vitest-agent/reporter": patch
"@vitest-agent/sdk": patch
---

## Bug Fixes

- Completed the transitive Effect peer closure so no `@effect` peer resolution escapes to the consuming workspace's importer. Previously a consumer workspace that also contained an effect v4 beta project could have its package manager auto-install the v4 beta into the v3 stack, crashing at runtime with module-not-found errors.

## Dependencies

| Dependency            | Type       | Action | From | To      |
| --------------------- | ---------- | ------ | ---- | ------- |
| @effect/experimental  | dependency | added  | —    | ^0.60.0 |
| @effect/workflow      | dependency | added  | —    | ^0.18.2 |
| @effect/printer       | dependency | added  | —    | ^0.49.0 |
| @effect/printer-ansi  | dependency | added  | —    | ^0.49.0 |
| @effect/typeclass     | dependency | added  | —    | ^0.40.0 |
