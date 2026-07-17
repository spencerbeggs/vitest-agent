---
"@vitest-agent/plugin": major
---

## Breaking Changes

### Effect v4

`@vitest-agent/plugin` now runs on Effect v4 (`effect@4.0.0-beta.98`). `@effect/platform-node`'s `NodeContext` is renamed to `NodeServices`. `better-sqlite3` is no longer a dependency — the data layer runs on Node's built-in `node:sqlite`, which raises the effective Node requirement to `>=24.11.0`.

### Workspace discovery via `@effected/workspaces`

`AgentPlugin.discover()`'s project auto-detection now resolves workspace packages through `@effected/workspaces` instead of `workspaces-effect`.

### A suite load failure now fails the run

The reporter's failure detection (`hasFailures`, and therefore the process exit code) now checks `failedFiles.length` instead of `summary.failed`. Previously, a test file that failed to import could render the run as all green while the process still exited non-zero. If your CI treated that gap as a pass before, it will now correctly fail — the underlying import error was always there.

## Dependencies

| Dependency            | Type       | Action  | From    | To            |
| :--------------------- | :--------- | :------ | :------ | :------------ |
| @effect/cluster        | dependency | removed | 0.59.0  | —              |
| @effect/experimental   | dependency | removed | 0.60.0  | —              |
| @effect/platform       | dependency | removed | 0.96.3  | —              |
| @effect/platform-node  | dependency | updated | 0.107.0 | 4.0.0-beta.98  |
| @effect/rpc            | dependency | removed | 0.75.1  | —              |
| @effect/sql            | dependency | removed | 0.51.1  | —              |
| @effect/sql-sqlite-node| dependency | updated | 0.52.0  | 4.0.0-beta.98  |
| @effect/workflow       | dependency | removed | 0.18.2  | —              |
| @effected/workspaces   | dependency | added   | —       | 0.3.1          |
| effect                 | dependency | updated | 3.22.0  | 4.0.0-beta.98  |
| magic-string           | dependency | updated | 0.30.21 | 1.0.0          |
| workspaces-effect      | dependency | removed | 2.1.0   | —              |
