---
type: Measurement
title: Run persistence cost, 2026-10-21
description: "Per-statement autocommit with synchronous=FULL dominated the reporter's post-run window; one transaction per run plus synchronous=NORMAL cut a 16k-test persist from 5.5-12.8 s to 0.9-1.4 s and effected's 17k-test post-run gap from about 6.8 s to 1.5 s, and INSERT ... RETURNING id measured slower than last_insert_rowid()."
justifies:
  - ../decisions/84-run-persistence-transaction.md
tags: [performance, ci]
stale_after: 2027-04-19T00:00:00Z
status: draft
sources:
  - id: issue-568
    resource: https://github.com/spencerbeggs/vitest-agent/issues/568
  - id: owner-measurements
    resource: measurements taken on branch perf/ci-test-speed and reported by the team-lead session
    last_modified: 2026-10-21T00:00:00Z
  - id: persist-transaction
    resource: ../../packages/engine/src/utils/persist-transaction.ts
generated:
  by: okfit/claude-code
  at: 2026-10-21T16:41:41Z
integrity:
  generated:
    body: 425ff05170ac485d
---

# Run persistence cost, 2026-10-21

## Question

How much of the reporter's post-run window is spent persisting to
`data.db`, and which of three levers removes it: the `synchronous`
pragma, one transaction per run, or fewer statements per test.

The question came from issue 568[^issue-568]: on spencerbeggs/effected's
GitHub CI, the gap between the last test finishing and the process exiting
was about 24 s.

## Inputs and method

All numbers come from runs on 2026-10-21, on the branch that added
[`withPersistTransaction`](../invariants/persist-transaction-no-yield.md)[^owner-measurements].
Four set-ups were measured:

1. **Raw `node:sqlite`.** 16k synthetic tests, written with the same
   statement pattern `DataStoreLive` issues per test, in three modes:
   autocommit with `synchronous = FULL` (the driver default), autocommit
   with `synchronous = NORMAL`, and one transaction around all of it.
2. **The real reporter harness.** 16k synthetic tests driven through
   `AgentReporter`'s run-end persist phase, before and after the change.
3. **A real consumer suite.** spencerbeggs/effected's full suite: 17,022
   tests across 40 projects, CI mode, coverage on. Two figures were taken:
   the post-run gap and the total wall time.
4. **`RETURNING id`.** 16k inserts on the `test_cases` schema, which has
   six indexes. One variant reads each new id with
   `INSERT ... RETURNING id`, the other with a separate
   `SELECT last_insert_rowid()`.

## Results

| Set-up | Before | After |
| --- | --- | --- |
| Raw `node:sqlite`, 16k tests | 5.0 s (autocommit, FULL) | 1.0 s (autocommit, NORMAL); 0.12 s (one transaction) |
| Reporter harness, 16k tests | 5.5–12.8 s | 0.9–1.4 s |
| effected post-run gap | 6.6–6.9 s | 1.5 s |
| effected wall time | 61–63 s | 56–57 s |
| 16k `test_cases` inserts | 87–100 ms (`last_insert_rowid()`) | 586–719 ms (`RETURNING id`) |

## What the numbers rule in and out

- **Ruled in: one transaction per run.** Autocommit pays one commit per
  statement. Moving to NORMAL removes the fsync from each commit, which
  accounts for most of the 5.0 s → 1.0 s drop. One transaction removes the
  per-statement commit entirely (1.0 s → 0.12 s). The two changes stack,
  and the commit ships both.
- **Ruled in: `synchronous = NORMAL` as well.** It also speeds every other
  writer on `data.db` that does not run inside the transaction: hooks, MCP
  tools, and `DataStore` calls outside the reporter.
- **Ruled out: `RETURNING id`.** It looked like a way to drop one statement
  per insert, but it ran six to seven times slower on the indexed
  `test_cases` table. The reporter keeps `SELECT last_insert_rowid()`.
- **Not explained by persistence.** The effected local gap was 6.6–6.9 s,
  while the CI gap in issue 568 was about 24 s. This measurement did not
  re-time CI after the change, so how much of the CI gap remains is open.
  Coverage written once per project per run (issue 622) is the known
  remaining duplicate write.

Re-measure when `DataStoreLive`'s per-test statement pattern changes, when
the SQLite driver changes, or when issue 622 lands.

[^issue-568]: <https://github.com/spencerbeggs/vitest-agent/issues/568>
[^owner-measurements]: measurements taken on branch perf/ci-test-speed and reported by the team-lead session, 2026-10-21
