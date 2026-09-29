---
type: Decision
title: Three-Tier Objective→Goal→Behavior Hierarchy
description: The TDD ledger stores an objective's goals and each goal's behaviors as first-class rows with their own identity and status lifecycle, decomposed by LLM reasoning through the tdd_goal and tdd_behavior tools rather than by server-side text splitting.
status: stable
tags:
  - tdd
  - mcp
generated:
  by: okfit/claude-code
  at: 2026-09-29T20:39:41Z
  body_sha256: 998bf975f943981f4b7236ff135c4a0896315a51cbde1387f3cf5f1dbe8def5d
sources:
  - id: tdd-goal
    resource: ../../packages/mcp/src/tools/tdd-goal.ts
  - id: tdd-behavior
    resource: ../../packages/mcp/src/tools/tdd-behavior.ts
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
---

# Three-Tier Objective→Goal→Behavior Hierarchy

## Context

A TDD task's objective (the free-text `tdd_tasks.goal` column) is usually too
coarse a unit to drive individual red-green-refactor cycles against: a
single objective decomposes into several goals, and each goal into several
independently testable behaviors. Storing that decomposition only as text
gives nothing addressable for status tracking, ordering, or dependency
references.

## Decision

The TDD ledger is a three-tier hierarchy — Objective (`tdd_tasks.goal`), Goal
(`tdd_session_goals`), Behavior (`tdd_session_behaviors`) — where each tier
below the objective has its own row-level identity, a closed status
lifecycle (`pending → in_progress → done|abandoned`), and a full CRUD
surface. `tdd_goal` and `tdd_behavior` are consolidated MCP tools that
dispatch on an `action` discriminator (`create`, `update`, `delete`, `get`,
`list` / `list_by_goal` / `list_by_tdd_task`) via
`Match.discriminatorsExhaustive("action")`.[^tdd-goal] [^tdd-behavior] The
orchestrator decomposes an objective into goals and behaviors through its
own LLM reasoning and creates each entity individually by calling these
tools; the server stores what it is told and enforces referential integrity
through tagged errors at the `DataStore` boundary — it never linguistically
interprets the goal text itself.

## Alternatives rejected

- **Server-side text splitting of the objective into goals and behaviors.**
  Rejected because "what counts as one behavior" is a judgment call that
  needs the full context a string-splitter does not have — the goal text,
  acceptance criteria, and codebase patterns the LLM can reason over. The
  server's hard guarantees come from schema constraints instead: foreign
  keys, a `CHECK` on status, and junction-table validation mean the caller
  cannot invent a behavior id, create a behavior under a closed goal, or
  make a behavior depend on one in a different goal, regardless of how the
  decomposition was produced.
- **Keep goals as text inside `tdd_tasks.goal`** rather than giving them
  first-class storage. Rejected because goals need to be addressable in
  their own right for status transitions, ordinal allocation, dependency
  junction-table references, and goal-scoped events — storing them as
  session metadata would collide on duplicate goal text and gives nothing
  stable to key a lifecycle event against. A `(session_id, id)` covering
  index supports the behavior→goal→session join path without denormalizing
  `session_id` onto every behavior row.

## Consequences

Two additional tables (`tdd_session_goals`, `tdd_behavior_dependencies`) and
a modest index footprint join the schema. The behavior-level state machine
(the 8 TDD phases, see the phase-transition Decision) stays scoped to one
behavior — goal-level iteration across multiple behaviors is orchestrator
workflow code, not a `tdd_phases` state. Because each tier carries its own
status lifecycle, the phase-transition validator can pre-check "is the cited
behavior's parent goal `in_progress`?" as a referential fact rather than a
derived one.

## Related

- [Module: mcp](../modules/mcp.md)
- [Decision: TDD Phase-Transition Evidence Binding](d11-tdd-phase-transition-evidence-binding.md)
- [Decision: Junction Table for Behavior Dependencies](d14-junction-table-for-behavior-dependencies.md)

[^tdd-goal]: `../../packages/mcp/src/tools/tdd-goal.ts`
[^tdd-behavior]: `../../packages/mcp/src/tools/tdd-behavior.ts`
