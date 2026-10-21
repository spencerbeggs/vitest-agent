---
type: Invariant
title: The run-persist transaction never yields to the scheduler
description: "withPersistTransaction runs its whole SQLite write transaction in one event-loop turn by providing References.PreventSchedulerYield, so a second node:sqlite connection in the same process can never block the thread in the busy handler while the first holds the write lock; a test fails if the flag is removed, and nothing genuinely asynchronous may run inside the block."
resource: ../../packages/engine/__test__/persist-transaction.test.ts
tags: [effect, performance, architecture]
status: draft
sources:
  - id: persist-transaction
    resource: ../../packages/engine/src/utils/persist-transaction.ts
  - id: persist-transaction-test
    resource: ../../packages/engine/__test__/persist-transaction.test.ts
  - id: reporter-call-site
    resource: ../../packages/plugin/src/reporter.ts
generated:
  by: okfit/claude-code
  at: 2026-10-21T16:41:41Z
integrity:
  generated:
    body: d0c7bcb1cb50c352
---

# The run-persist transaction never yields to the scheduler

## Property

`withPersistTransaction` from `@vitest-agent/engine` runs its effect as one
SQLite write transaction, and the fiber running it does not yield to the
Effect scheduler until the transaction commits or rolls back. It provides
`References.PreventSchedulerYield = true` around `sql.withTransaction`, so
the whole block runs in one turn of the event loop[^persist-transaction].

A second connection to the same `data.db` in the same process therefore
never gets a turn while the first holds the write lock. It runs before
`BEGIN` or after `COMMIT`, never in between.

## Why it matters

A plain `sql.withTransaction` over `node:sqlite` can deadlock against a
second connection in the same process:

1. Connection A begins a write transaction and starts writing.
2. Effect yields to the scheduler every 2048 operations, so a long write
   loop gives up the thread partway through, with the lock still held.
3. Connection B gets the turn and tries to write. `node:sqlite` is
   synchronous, and its busy handler blocks the thread while it waits for
   the lock.
4. A cannot resume to commit, because B is holding the only thread. B
   spins until `busy_timeout` (5 s) and fails with `SQLITE_BUSY`.

The second connection is real in two shapes:

- the MCP server's `run_tests` runs Vitest in-process, and the server holds
  its own `data.db` connection beside the reporter's;
- a config with more than one reporter writing to the same `data.db` in one
  process.

## Mechanism

`packages/engine/__test__/persist-transaction.test.ts` opens two
connections to one file in one process, each with a 200 ms busy timeout,
and runs 300 runs' worth of writes on each concurrently[^persist-transaction-test]:

- through `withPersistTransaction`, both succeed;
- through a plain `sql.withTransaction` (the control), at least one fails.

Removing the `PreventSchedulerYield` provision makes the first case fail
the same way the control does.

## What would break it

- **Async work inside the block.** Anything that genuinely suspends the
  fiber gives the event loop back to the other connection with the lock
  held: a timer, file I/O, a network call, an `await`ed promise. Keep CPU
  work that needs no database before the block. The reporter runs coverage
  analysis before it opens the transaction for this reason, and its call
  site says so in a comment[^reporter-call-site].
- **Replacing `withPersistTransaction` with a bare `withTransaction`.** A
  new multi-statement write path that wants a transaction should go
  through `withPersistTransaction`, or provide the same reference itself.
- **An asynchronous SQLite driver.** The deadlock comes from a busy handler
  that blocks the thread synchronously. A driver that waits for the lock
  asynchronously would turn this into ordinary contention, and the flag
  would stop mattering.

The cost and the choice behind the transaction are in [Decision
84](../decisions/84-run-persistence-transaction.md) and the [run
persistence measurement](../measurements/run-persistence-2026-10-21.md).

[^persist-transaction]: `../../packages/engine/src/utils/persist-transaction.ts`
[^persist-transaction-test]: `../../packages/engine/__test__/persist-transaction.test.ts`
[^reporter-call-site]: `../../packages/plugin/src/reporter.ts:2076`
