---
"@vitest-agent/plugin": patch
---

## Dependencies

Dropped the unused `@effect/sql-sqlite-node` runtime dependency. The SQLite stack lives in `@vitest-agent/engine` since the carrier split and nothing in the plugin imports it.

| Dependency              | Type       | Action  | From         | To  |
| :---------------------- | :--------- | :------ | :----------- | :-- |
| @effect/sql-sqlite-node | dependency | removed | 4.0.0-rc.115 | —   |
