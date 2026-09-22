---
type: Decision
status: draft
title: Partition the consoleLeaks Signal by Test Outcome
description: run_tests attributes each captured console write to its owning test's pass/fail state so a red run's own failure logging stops masquerading as a console leak.
tags: [testing, mcp]
generated:
  by: okfit/claude-code
  at: 2026-09-22T19:49:15Z
  body_sha256: 9b1e22799d126962bd8def8478df3393d97a019ff51862fb3e1f225f4a505a8d
---

# Partition the consoleLeaks Signal by Test Outcome

## Context

`run_tests` attaches an optional `consoleLeaks` block to each
`AgentReport` — stray `console.*` output captured per task from
`vitest.state.getFiles()`, bucketed by file
(`packages/mcp/src/tools/run-tests.ts:860-863`) — and an agent reads the
block's presence as a warning. The signal was meant to
surface debugging output left behind in *passing* tests. In practice
every red run tripped it: assertion libraries and app code that route
failure output through a logger write to `console.*` inside the failing
test, so a run with three failing tests reported three "leaks" that were
nothing but the failures themselves. The noise camouflaged genuine
leaks — an agent that learned to ignore the warning on red runs also
ignored it on the runs where it mattered.

## Decision

Attribute each captured write to the pass/fail state of the task that
owns it, and partition the aggregate by that outcome.
`collectConsoleLeakEntries` (`packages/sdk/src/utils/console-leaks.ts:134-163`)
walks the Vitest `File[]` task tree, reading the owning test's
`result.state` — or, for output with no owning test, the enclosing
file's own state (a collection or load error) — and marks the entry
`failed: true` when that state is `"fail"` (`console-leaks.ts:145-153`).
`buildConsoleLeaks` (`console-leaks.ts:50-101`) splits entries into
`nonFailing` and `failing` sets (`console-leaks.ts:53-54`), counts only
the non-failing set in `total` / `byFile` — the actionable signal — and
reports the failing bucket in a new optional
`fromFailingTests: { total, files }` summary
(`console-leaks.ts:56-57`). The block is still omitted only when there
is no output at all; a run whose only console output came from failing
tests yields `{ total: 0, byFile: [], fromFailingTests }` rather than
nothing (`console-leaks.ts:59-61`). The agent-facing surface is only
the structured `report.consoleLeaks` field — `total`, `byFile`,
`truncated`, and `fromFailingTests` (`packages/sdk/src/schemas/ConsoleLeaks.ts:42-47`,
attached to `AgentReport` at `packages/sdk/src/schemas/AgentReport.ts:85`)
— which `run_tests` returns in `structuredContent` and, as the same
object serialized to JSON, in `content[0].text`
(`run-tests.ts:860-863`). There is no rendered warning line: an agent
treats `total > 0` as a leak and reads `fromFailingTests` as the
non-leak count of writes from failing tests.

**Why partition rather than suppress.** Dropping failing-test output
entirely would hide a real signal in the other direction: a failing test
that logs is often *why* it is failing, and the agent fixing it wants to
know the output exists. Keeping the count visible but out of the leak
total preserves both facts — "this run has leaks" and "this run's
failures logged" — without letting one masquerade as the other.

## Alternatives rejected

- **Suppress console output from failing tests entirely:** rejected
  because it discards a signal that is often the reason a test is
  failing; the agent debugging the failure benefits from seeing that
  output, just not counted as a leak.
- **Leave the aggregate unpartitioned and rely on the agent to
  cross-reference failures against leak files:** the status quo before
  this decision; it required an agent to already distrust the warning on
  every red run, which trained agents to ignore it universally.

## Consequences

- A warning that fires on every red run is not a warning; the general
  rule this decision states is that a signal meant to describe passing
  code must be scoped to passing code.
- A run whose only console output came from failing tests is
  distinguishable from a genuinely clean run — both now report
  `{ total: 0, byFile: [] }`, but only the former also carries
  `fromFailingTests`.
- Any future consumer of `ConsoleLeaks` (a new formatter, a different
  tool) must read `fromFailingTests` separately from `total` rather than
  summing the two, or it reintroduces the exact conflation this decision
  removes.

## Related

- [Decision 58 — Persist Thresholds, Targets and Baselines as Three Facets](./58-persist-thresholds-targets-and-baselines-as-three-facets.md)
