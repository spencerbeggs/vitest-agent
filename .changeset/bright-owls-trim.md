---
"@vitest-agent/engine": major
---

## Breaking Changes

Removed the unused `FormatSelector` service and its `FormatSelectorLive` layer. `PlatformServices` and `OutputPipelineLive` no longer include it, so a program that provided or required `FormatSelector` must drop it.

`PlatformLiveError` and `SqliteStack.SqliteLayer` now include `SqlError` in their error channel, because `@effect/sql-sqlite-node` 4.0.2 types opening the database as fallible. Code that exhaustively handles those errors needs to account for it.
