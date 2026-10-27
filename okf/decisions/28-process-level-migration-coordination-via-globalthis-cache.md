---
type: Decision
title: Process-Level Migration Coordination via globalThis Cache
description: "A globalThis-keyed run registry behind ensureMigrated, now @effected/store's Store.migrateOnce, makes SQLite migration succeed at most once per database per process, closing a SQLITE_BUSY race between per-project reporter instances sharing one database."
status: stable
tags:
  - architecture
  - effect
generated:
  by: okfit/claude-code
  at: 2026-10-27T13:30:27Z
sources:
  - id: engine-ensure-migrated
    resource: ../../packages/engine/src/utils/ensure-migrated.ts
  - id: plugin-reporter
    resource: ../../packages/plugin/src/reporter.ts
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
integrity:
  generated:
    body: a8f63b00e1b46f1d
---

# Process-Level Migration Coordination via globalThis Cache

## Context

In multi-project Vitest configurations sharing a single `data.db`, Vitest
calls `configureVitest` once per project, so each project gets its own
`AgentReporter` instance and, with it, its own `SqliteClient` connection.
Running SQLite migrations independently through each connection against a
fresh database put two connections in a race: both started deferred
transactions and then tried to upgrade to a write transaction, producing
`SQLITE_BUSY`. SQLite's busy handler is not invoked for write-write upgrade
conflicts on deferred transactions, so `busy_timeout` did nothing to help.

## Decision

`ensureMigrated(dbPath, logLevel?, logFile?, env?)`
(`packages/engine/src/utils/ensure-migrated.ts`) is the single entry point
every reporter instance calls before touching the database. It runs the
project migrations through `@effected/store`'s `Store.migrateOnce`, whose
run registry lives on `globalThis` under `Symbol.for("@effected/store/migrateOnce")`:
at most one successful migration run per database per process, and every
concurrent caller for the same database awaits that same in-flight run
instead of starting its own transaction. A run is keyed on the real path
of the file's directory plus its name, so a relative, an absolute and a
symlinked spelling of one database share it. A failed run (for example
`SQLITE_BUSY`) is not remembered, so the next call tries again.

The `globalThis` key is load-bearing rather than a convenience: Vite's
multi-project pipeline can load the reporter's plugin module under separate
module instances within the same process, so a module-scoped `Map` would
give each project its own independent cache and defeat the coordination —
`globalThis` is the one namespace guaranteed to be shared across those
module instances, and across copies of the kit loaded in one process.

`AgentReporter` awaits `ensureMigrated` before its main persistence effect
runs (`packages/plugin/src/reporter.ts`), guarded so it only fires when
a `dbPath` was resolved and persistence has not already been disabled. On
rejection, the reporter no longer aborts the whole run: it records the
failure as `persistDisabled` and continues rendering against
`fallbackReports` — the render-despite-persistence-failure contract
(`packages/plugin/src/reporter.ts`). After migration completes
once, normal reads and writes from separate connections proceed safely under
WAL mode plus `busy_timeout`. The fix lives at this call site deliberately:
the migrator's own transaction boundaries in
`packages/engine/src/migrations/` are not rewritten to solve a
process-coordination problem that has nothing to do with what a single
migration transaction does.

## Alternatives rejected

- **Fix the race inside the migrator's transaction boundaries** (e.g. retry
  on `SQLITE_BUSY`, or restructure the migration transaction): rejected
  because the race is a process-level coordination problem — multiple
  independent runtimes deciding to migrate the same file at the same
  moment — not a property of what any one migration transaction does. A
  retry loop would mask the symptom per attempt without preventing repeated
  contention.
- **A module-scoped cache (plain `Map`) instead of a `globalThis` key**:
  rejected because Vite's multi-project pipeline can load the same plugin
  source under distinct module instances in one process; a module-scoped
  cache would silently degrade to "each project migrates independently"
  again, reintroducing the exact failure this decision fixes.

## Consequences

- Every consumer of the database — the reporter, the CLI, and the MCP
  server — must route through `ensureMigrated` (or otherwise coordinate)
  before opening a connection for reads or writes; a new call site that
  constructs its own `SqliteClient`/migrator pair directly on a shared
  `dbPath` reintroduces the SQLITE_BUSY race this decision closed.
  [Decision 32](./32-keep-ensuremigrated-instead-of-the-kit-s-sqlite-state-layer.md)
  records the earlier choice of a small hand-written cache; the kit's
  `Store.migrateOnce` now provides the same coordination.
- The cache is process-lifetime only; it does not persist across separate
  `vitest-agent`/`vitest-agent-mcp` process invocations, each of which pays
  the migration check once per process, not once per machine.
- A migration failure degrades persistence rather than crashing rendering —
  callers displaying `AgentReport` output must be prepared to see a run with
  `persistDisabled` set and no history/trend data behind it.

## Related

- [Decision 32 — Keep ensureMigrated Instead of the Kit's SQLite-State Layer](./32-keep-ensuremigrated-instead-of-the-kit-s-sqlite-state-layer.md)
