---
type: Decision
title: Junction Table for Behavior Dependencies
description: Behavior dependencies live in a tdd_behavior_dependencies junction table with FK enforcement and CASCADE, not JSON-in-TEXT, so recursive CTE walks and orphan rejection come for free.
status: stable
tags:
  - architecture
  - tdd
generated:
  by: okfit/claude-code
  at: 2026-09-29T20:39:41Z
  body_sha256: 50a5ee48a52464b6ee8fbae4f85ce5bbcdfa0b2498f97fbd40dd1b5b40754365
sources:
  - id: migration-0001-junction-table
    resource: ../../packages/engine/src/migrations/0001_initial.ts
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
---

# Junction Table for Behavior Dependencies

## Context

The TDD orchestration model (three-tier objective/goal/behavior
hierarchy) lets one behavior declare that it depends on another behavior
under the same goal finishing first. That dependency graph needs to
survive a behavior being deleted, needs to be queryable in both
directions (what does X depend on; what depends on X), and needs the
same same-goal validation `createBehavior` already enforces on
`dependsOnBehaviorIds`.

## Decision

Dependencies live in a dedicated `tdd_behavior_dependencies` junction
table with composite primary key `(behavior_id, depends_on_id)` and
`ON DELETE CASCADE` on both endpoints referencing
`tdd_session_behaviors(id)`
(`packages/engine/src/migrations/0001_initial.ts`). A
`CHECK (behavior_id != depends_on_id)` on the same table forbids
self-dependencies. A reverse-lookup index,
`idx_tdd_behavior_dependencies_depends_on`, on `depends_on_id` supports
"what depends on X" queries without a table scan.

A junction table over JSON-in-TEXT buys four things:

- **FK enforcement.** Both endpoints reference `tdd_session_behaviors(id)`.
  The database rejects an orphan id the orchestrator might supply by
  mistake, surfacing as `BehaviorNotFoundError` at the DataStore boundary
  rather than as a silently dangling reference inside a JSON blob.
- **Recursive CTE walks.** Traversing the dependency graph is a
  common-table-expression query over rows, not a JSON-parse-then-walk in
  application code or in SQL.
- **CASCADE semantics.** Deleting a behavior removes both sides of every
  dependency edge it participates in. A JSON column would instead orphan
  that behavior's id inside every other behavior's dependency array,
  requiring a fan-out cleanup pass the schema cannot enforce.
- **Same-goal validation.** `createBehavior` validates that every
  `dependsOnBehaviorIds` entry resolves to a behavior under the same
  goal — a relational join, not a client-side scan of a denormalized
  array.

**Why `CHECK (behavior_id != depends_on_id)` in DDL rather than in the
validator:** a self-dependency is always logically wrong — a behavior
that blocks itself can never resolve — so it is cheaper to reject at
insert time than to discover later during a recursive walk that finds
its own starting node.

## Alternatives rejected

A JSON array column on `tdd_session_behaviors` (`depends_on: [1, 2, 3]`)
was rejected: it has no FK enforcement, no CASCADE, and pushes both
same-goal validation and self-dependency rejection into application code
that a future write path could bypass.

## Consequences

Updating a behavior's dependency set is not a single-row update: it
replaces the entire set in one transaction — `updateBehavior` deletes the
old rows and inserts the new ones. That is more SQL than overwriting a
JSON column, but it is bundled inside `sql.withTransaction` so the
replacement is atomic; a failure partway through cannot leave a
half-updated dependency set. See [Decision D12](d12-three-tier-objective-goal-behavior-hierarchy.md)
for the goal/behavior hierarchy this table sits under, and
[Decision D15](d15-tdd-phases-behavior-id-cascade.md) for the sibling
CASCADE decision on `tdd_phases.behavior_id`.
