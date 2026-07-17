---
"@vitest-agent/sdk": major
---

## Breaking Changes

### Effect v4 runtime

`@vitest-agent/sdk` now runs on Effect v4 (`effect@4.0.0-beta.98`). Consumers embedding the SDK's schemas, services, or layers directly must upgrade to Effect v4 — the v3 API surface (`Effect.catchAll`, `Schema.annotations`, etc.) is no longer compatible.

### SQLite driver moved to node:sqlite

The data layer moved from `better-sqlite3` to Node's built-in `node:sqlite`, via `effect/unstable/sql` and `@effect/sql-sqlite-node`. `better-sqlite3` is no longer a dependency anywhere in the family. This raises the effective Node requirement to `>=24.11.0`.

### XDG, config-file, and workspace resolution now use `@effected/*`

`xdg-effect`, `config-file-effect`, and `workspaces-effect` are replaced by the `@effected` kit (`@effected/xdg`, `@effected/config-file`, `@effected/workspaces`, plus their `@effected/jsonc`, `@effected/toml`, `@effected/yaml`, and `@effected/walker` building blocks). `WorkspaceRootNotFoundError`'s shape changed: the free-form `reason: string` field is replaced by `markers: ReadonlyArray<string>`.

**Workspace-root discovery no longer treats a bare `.git` directory as a workspace boundary.** A single-package repo with no `pnpm-workspace.yaml` and no `package.json#workspaces` field now fails `WorkspaceRootNotFoundError` where it previously resolved via `.git`. Whether to add a `.git` fallback is still under discussion — treat this as a known caveat rather than a settled design decision.

### SQL error unwrapping walks the full cause chain

`extractSqlReason` now walks the entire `cause` chain instead of unwrapping a single level. The `node:sqlite` driver commonly nests two wrapper errors, and the previous one-level unwrap surfaced the generic "Failed to execute statement" message instead of the real SQLite reason (e.g. "UNIQUE constraint failed: ...").

## Features

* New `countSuiteFailures(report)` utility — counts suite-level (collection/load) failures that `report.summary.failed` does not capture, so downstream reporters can fold them into failure totals.

## Dependencies

| Dependency            | Type       | Action  | From          | To             |
| :--------------------- | :--------- | :------ | :------------ | :------------- |
| @effect/cluster        | dependency | removed | 0.59.0        | —               |
| @effect/experimental   | dependency | removed | 0.60.0        | —               |
| @effect/platform       | dependency | removed | 0.96.3        | —               |
| @effect/platform-node  | dependency | updated | 0.107.0       | 4.0.0-beta.98   |
| @effect/rpc            | dependency | removed | 0.75.1        | —               |
| @effect/sql            | dependency | removed | 0.51.1        | —               |
| @effect/sql-sqlite-node| dependency | updated | 0.52.0        | 4.0.0-beta.98   |
| @effect/workflow       | dependency | removed | 0.18.2        | —               |
| @effected/config-file  | dependency | added   | —              | 0.1.2           |
| @effected/jsonc        | dependency | added   | —              | 0.2.0           |
| @effected/toml         | dependency | added   | —              | 0.1.0           |
| @effected/walker       | dependency | added   | —              | 0.2.1           |
| @effected/workspaces   | dependency | added   | —              | 0.3.1           |
| @effected/xdg          | dependency | added   | —              | 0.1.2           |
| @effected/yaml         | dependency | added   | —              | 0.3.0           |
| @types/acorn           | dependency | removed | 6.0.4         | —               |
| config-file-effect     | dependency | removed | 0.3.0         | —               |
| effect                 | dependency | updated | 3.22.0        | 4.0.0-beta.98   |
| workspaces-effect      | dependency | removed | 2.1.0         | —               |
| xdg-effect             | dependency | removed | 2.1.1         | —               |
