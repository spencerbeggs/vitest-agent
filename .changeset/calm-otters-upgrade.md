---
"@vitest-agent/mcp": major
---

## Breaking Changes

### Effect v4

`@vitest-agent/mcp` now runs on Effect v4 (`effect@4.0.0-beta.98`). The SQL/data layer moves to `effect/unstable/sql` on Node's built-in `node:sqlite` (via `@vitest-agent/sdk`), which raises the effective Node requirement to `>=24.11.0`.

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
