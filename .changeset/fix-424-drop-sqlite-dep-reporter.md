---
"@vitest-agent/reporter": patch
---

## Dependencies

Dropped the unused `@effect/sql-sqlite-node` runtime dependency. The reporter only renders and never touches SQLite, so it no longer declares the engine's driver.

| Dependency              | Type       | Action  | From         | To  |
| :---------------------- | :--------- | :------ | :----------- | :-- |
| @effect/sql-sqlite-node | dependency | removed | 4.0.0-rc.115 | —   |
