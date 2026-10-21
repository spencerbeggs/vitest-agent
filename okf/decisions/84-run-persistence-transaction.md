---
type: Decision
title: Persist Each Run in One SQLite Transaction with synchronous=NORMAL
description: "The reporter's run-end writes commit as one SQLite transaction through withPersistTransaction, every data.db connection opens with synchronous=NORMAL, and DataStoreLive caches tag and file ids and prunes test_history once per run inside the block; per-statement tuning and INSERT ... RETURNING id were rejected."
status: stable
tags:
  - performance
  - ci
  - architecture
sources:
  - id: persist-transaction
    resource: ../../packages/engine/src/utils/persist-transaction.ts
  - id: platform-ts
    resource: ../../packages/engine/src/platform.ts
  - id: data-store-live
    resource: ../../packages/engine/src/layers/DataStoreLive.ts
  - id: reporter-ts
    resource: ../../packages/plugin/src/reporter.ts
  - id: issue-568
    resource: https://github.com/spencerbeggs/vitest-agent/issues/568
generated:
  by: okfit/claude-code
  at: 2026-10-21T16:41:41Z
integrity:
  generated:
    body: 60fd501fe555592f
  verified:
    by: human:spencer
    at: 2026-10-21T16:43:20Z
    content: 8316b9217052ef78
verified:
  - by: human:spencer
    at: 2026-10-21T16:43:20Z
---

# Persist Each Run in One SQLite Transaction with synchronous=NORMAL

## Context

At the end of a run, `AgentReporter.onTestRunEnd` writes settings, runs,
modules, suites, test cases, tags, errors, coverage, and history through
`DataStore`. Before this change, every statement autocommitted. Under WAL
with the driver's default `synchronous = FULL`, every commit fsynced. On
large suites the persist phase was most of the time between the last test
and process exit. Issue 568[^issue-568] reported about 24 s of that gap on
spencerbeggs/effected's GitHub CI. A run that failed partway through left
the rows written so far in place, so the database could hold half a run.

The numbers are in the [run persistence
measurement](../measurements/run-persistence-2026-10-21.md).

## Decision

1. **One transaction per run.** The reporter wraps its whole persist block
   in `withPersistTransaction`, a new `@public` export of
   `@vitest-agent/engine`[^persist-transaction][^reporter-ts]. Every write
   in it commits together or rolls back together. Coverage analysis runs
   before the block, so the write lock is held only for the writes.
2. **`PRAGMA synchronous = NORMAL` on every `data.db` connection.**
   `makeSqliteStack` sets it as each connection opens, before the migrator
   runs[^platform-ts]. WAL plus NORMAL is SQLite's documented pairing: a
   commit no longer fsyncs, and the database stays consistent across an
   application crash. Only a power loss or OS crash can roll back the most
   recent commits.
3. **Per-run caching inside the block.** `DataStoreLive` reads a
   `PersistBatch` `Context.Reference` (internal) that
   `withPersistTransaction` provides[^data-store-live]. While it is set,
   `ensureFile` and `writeTestCases` look each file path and tag name up
   once per run, and `writeHistory` records the run id instead of pruning
   per test. One `ROW_NUMBER()` `DELETE` per run then keeps the newest 10
   rows of every series that run wrote, before commit.
4. **No behaviour change outside the block.** With no `PersistBatch` set,
   `DataStoreLive` runs exactly as before: per-call lookups and a per-write
   prune. Inside the block it writes the same rows as outside it, and a
   test compares the two paths.
5. **The block never yields to the scheduler.** See [Invariant: the
   run-persist transaction never yields to the
   scheduler](../invariants/persist-transaction-no-yield.md) for why, and
   for the constraint that nothing genuinely asynchronous may run inside
   it.

As a consequence, persistence is atomic. A failure rolls the whole run
back instead of leaving it half-written, and the render program still runs
against the fallback reports as [Decision
47](47-rendering-never-depends-on-persistence.md) requires.

## Alternatives rejected

- **Only `synchronous = NORMAL`, keeping autocommit.** This removes the
  fsync but still pays one commit per statement: 1.0 s against 0.12 s for
  one transaction in the raw 16k-test benchmark.
- **Only the transaction, keeping `FULL`.** The transaction alone fixes the
  reporter. NORMAL is cheap and also speeds every writer outside it: hooks,
  MCP tools, and the CLI.
- **`INSERT ... RETURNING id` instead of `SELECT last_insert_rowid()`.**
  It drops a statement per insert, but it measured 586–719 ms against
  87–100 ms for 16k inserts on the six-index `test_cases` table.
- **A plain `sql.withTransaction`.** It deadlocks against a second
  connection in the same process; see the invariant above.
- **Writing coverage once per invocation in the same change.** This
  belongs to the data model, not the transaction, and the readers depend
  on the per-project copies. It is tracked separately as issue 622.

## Consequences

- The post-run window on a 17k-test suite fell from about 6.8 s to 1.5 s.
- `withPersistTransaction` is public, so another multi-statement writer can
  reuse it instead of writing a bare `withTransaction`.
- A power loss can now lose the last committed run. `data.db` is a cache of
  test history, not a system of record, so that trade is acceptable.
- The CI persistence opt-out (issue 625) and a retention policy for the
  unbounded database (issue 623) remain open.

[^persist-transaction]: `../../packages/engine/src/utils/persist-transaction.ts`
[^reporter-ts]: `../../packages/plugin/src/reporter.ts:2076`
[^platform-ts]: `../../packages/engine/src/platform.ts:67`
[^data-store-live]: `../../packages/engine/src/layers/DataStoreLive.ts`
[^issue-568]: <https://github.com/spencerbeggs/vitest-agent/issues/568>
