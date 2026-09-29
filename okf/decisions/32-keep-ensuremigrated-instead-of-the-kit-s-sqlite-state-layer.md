---
type: Decision
title: Keep ensureMigrated Instead of the Kit's SQLite-State Layer
description: The data layer stays a direct hand-composed stack on ensureMigrated and @effect/sql-sqlite-node rather than adopting @effected/xdg's bundled SQLite-state layer or the broader @effected/store or @effected/app abstractions.
status: stable
tags:
  - architecture
  - effect
generated:
  by: okfit/claude-code
  at: 2026-09-29T20:39:41Z
  body_sha256: f6174deafc9a89a108251ea893e489f08de3d51eb419d74a35af69c5f497bf8a
sources:
  - id: engine-ensure-migrated
    resource: ../../packages/engine/src/utils/ensure-migrated.ts
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
---

# Keep ensureMigrated Instead of the Kit's SQLite-State Layer

## Context

The `@effected/xdg` line ships a bundled state layer that combines an
XDG-resolved path, a SQLite client, and a migrator into a single layer
construction. The Effect v4 migration initially proposed adopting that
bundled layer (and the broader `@effected/store` / `@effected/app`
abstractions) in place of this project's hand-rolled data layer; the shipped
implementation did not take that path.

## Decision

This project keeps `ensureMigrated`
(`packages/engine/src/utils/ensure-migrated.ts`) and its existing
migrator setup, and more broadly keeps the whole data layer in direct
composition on `@effect/sql-sqlite-node` (`makeSqliteStack`, called from
`ensureMigrated` at `packages/engine/src/utils/ensure-migrated.ts`)
rather than adopting a bundled kit abstraction for it.

Reasons:

- A bundled state layer constructs its migrator as part of layer
  construction, with no process-level coordination across independent layer
  instances. Because Vitest gives each project its own reporter instance and
  therefore its own runtime construction, multiple independent layer
  instances would each try to migrate a fresh, shared database
  simultaneously — reintroducing exactly the `SQLITE_BUSY` race
  [Decision 28](./28-process-level-migration-coordination-via-globalthis-cache.md)
  fixed with a `globalThis`-keyed promise cache that a bundled layer's own
  construction sequence cannot replicate without being rewritten.
- The migration tracking tables in this project's schema differ from the
  kit's own tracking convention, and `@effect/sql-sqlite-node`'s
  `SqliteMigrator` uses its own `effect_sql_migrations` table. Reconciling
  the two tracking schemes would be a real bootstrap-compatibility project
  with its own test surface, not a drop-in swap.
- `ensureMigrated`'s `globalThis`-keyed promise cache is small and the
  ongoing maintenance cost of keeping it is close to zero, compared to the
  integration cost of adopting the bundled layer.

[Decision 28](./28-process-level-migration-coordination-via-globalthis-cache.md)
remains in force as the canonical fix for the `SQLITE_BUSY` race; this
decision is about which abstraction owns migration lifecycle, not about
re-litigating that fix.

## Alternatives rejected

- **Adopt the `@effected/xdg` bundled SQLite-state layer** (path +
  client + migrator as one layer): rejected because its construction model
  has no cross-instance coordination, and Vitest's per-project reporter
  instantiation would reintroduce the exact SQLITE_BUSY race Decision 28
  exists to prevent.
- **Adopt `@effected/store` / `@effected/app` more broadly** for the data
  layer, as the initial migration plan proposed: rejected for the same
  reason plus the migration-tracking-table mismatch — the kit's own
  `SqliteMigrator` tracking table is not this project's tracking table, and
  reconciling them was assessed as real integration cost with no
  corresponding benefit over the existing direct composition.

## Consequences

- The data layer stays a direct, hand-composed stack on
  `@effect/sql-sqlite-node` (`SqliteLayer`, `MigratorLayer` from
  `makeSqliteStack`) rather than a kit-provided abstraction, so future
  `@effected/xdg` or `@effected/store` releases that improve the bundled
  layer do not automatically benefit this project — any future adoption
  would need this decision revisited, not assumed.
- `ensureMigrated`'s `globalThis`-keyed cache
  (`packages/engine/src/utils/ensure-migrated.ts`) remains the one
  place that owns migration-run coordination; any new call site that
  constructs a `SqliteClient`/migrator pair outside `ensureMigrated` against
  a shared `dbPath` bypasses that coordination and can reintroduce the race
  this decision's sibling fixed.
- Schema-migration additions continue to follow the incremental-migration
  discipline (new numbered migration files, never editing a shipped one in
  place) on the existing custom tracking table, rather than any tracking
  scheme a kit abstraction might impose.

## Related

- [Decision 28 — Process-Level Migration Coordination via globalThis Cache](./28-process-level-migration-coordination-via-globalthis-cache.md)
