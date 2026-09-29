---
type: Decision
title: Process-Level Migration Coordination via globalThis Cache
description: A globalThis-keyed promise cache in ensureMigrated makes SQLite migration run exactly once per dbPath per process, closing a SQLITE_BUSY race between per-project reporter instances sharing one database.
status: stable
tags:
  - architecture
  - effect
generated:
  by: okfit/claude-code
  at: 2026-09-29T20:39:41Z
  body_sha256: af354798ab9937b57e24950e5a64a624600039efef20c6a4554c2f1c94581583
sources:
  - id: engine-ensure-migrated
    resource: ../../packages/engine/src/utils/ensure-migrated.ts
  - id: plugin-reporter
    resource: ../../packages/plugin/src/reporter.ts
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
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

`ensureMigrated(dbPath, logLevel?, logFile?)`
(`packages/engine/src/utils/ensure-migrated.ts`) is the single entry point
every reporter instance calls before touching the database. A promise cache
keyed on `Symbol.for("vitest-agent/migration-promises")` and stashed on
`globalThis` (`packages/engine/src/utils/ensure-migrated.ts`) ensures
migrations for a given `dbPath` run exactly once per process: the first
caller builds the migration promise and stores it in the cache keyed by
`dbPath` (`packages/engine/src/utils/ensure-migrated.ts`); every
concurrent caller for the same `dbPath` receives and awaits that same
in-flight promise instead of starting its own transaction.

The `globalThis` key is load-bearing rather than a convenience: Vite's
multi-project pipeline can load the reporter's plugin module under separate
module instances within the same process, so a module-scoped `Map` would
give each project its own independent cache and defeat the coordination —
`globalThis` is the one namespace guaranteed to be shared across those
module instances.

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
  explains why this stays a small hand-written cache rather than a bundled
  state-layer abstraction.
- The cache is process-lifetime only; it does not persist across separate
  `vitest-agent`/`vitest-agent-mcp` process invocations, each of which pays
  the migration check once per process, not once per machine.
- A migration failure degrades persistence rather than crashing rendering —
  callers displaying `AgentReport` output must be prepared to see a run with
  `persistDisabled` set and no history/trend data behind it.

## Related

- [Decision 32 — Keep ensureMigrated Instead of the Kit's SQLite-State Layer](./32-keep-ensuremigrated-instead-of-the-kit-s-sqlite-state-layer.md)
