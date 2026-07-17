---
"@vitest-agent/reporter": major
---

## Breaking Changes

### Effect v4

`@vitest-agent/reporter` now runs on Effect v4 (`effect@4.0.0-beta.98`). `better-sqlite3` is no longer a dependency — the data layer runs on Node's built-in `node:sqlite`.

## Bug Fixes

* Project summary `failCount` now includes suite-level (collection/load) failures via the new `countSuiteFailures` helper from `@vitest-agent/sdk`, so a file that fails to import turns its project row red instead of showing a misleading all-green pass.

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
| effect                 | dependency | updated | 3.22.0  | 4.0.0-beta.98  |
| ink                    | dependency | updated | 7.1.0   | 7.1.1          |
