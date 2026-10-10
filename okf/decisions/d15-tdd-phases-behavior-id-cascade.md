---
type: Decision
title: tdd_phases behavior_id Cascade
description: tdd_phases.behavior_id and tdd_artifacts.behavior_id both CASCADE on delete, because a phase or artifact row without a behavior_id cannot be reasoned about downstream; abandonment, not deletion, is how the orchestrator drops work.
status: stable
tags:
  - architecture
  - tdd
generated:
  by: okfit/claude-code
  at: 2026-10-10T02:40:34Z
  body_sha256: 964f9cd4bd5db2d3e68f062560f117877e6ece805146968db386f24e2d43145c
sources:
  - id: migration-0001-phases-cascade
    resource: ../../packages/engine/src/migrations/0001_initial.ts
verified:
  - by: human:spencer
    at: 2026-10-08T03:57:59Z
---

# tdd_phases behavior_id Cascade

## Context

Every phase transition and every evidence artifact is attributed to a
behavior. When a behavior is removed, the question is what happens to
the phase ledger and artifacts recorded under it — the binding-rule
validator, the channel-event renderer, and the metrics computation all
assume `behavior_id` is meaningful when it is present.

## Decision

`tdd_phases.behavior_id` is declared
`REFERENCES tdd_session_behaviors(id) ON DELETE CASCADE`
(`packages/engine/src/migrations/0001_initial.ts`), and
`tdd_artifacts.behavior_id` carries the same
`ON DELETE CASCADE` (`packages/engine/src/migrations/0001_initial.ts`).
Deleting a behavior therefore erases its entire phase ledger and,
transitively, every artifact recorded against those phases.

The system draws a hard line between two different ways work stops:

- **Delete = "this never existed."** Used to clean up duplicates the
  orchestrator created by mistake. Removing all evidence is correct here
  because there is nothing legitimate to attribute — the row was a
  mistake, not a result.
- **Abandon (`status = 'abandoned'`) = "we tried but didn't finish,
  preserve evidence."** This is the orchestrator's only sanctioned way to
  drop work in progress. It keeps the phase ledger and artifacts
  available for downstream consumers: acceptance-metrics computation,
  failure-signature recurrence tracking, and post-hoc analysis.

**Why CASCADE instead of `ON DELETE SET NULL`:** a `tdd_phases` row with
a NULL `behavior_id` cannot be reasoned about by the binding-rule
validator, the channel-event renderer, or the metrics computation — all
three key off which behavior a phase belongs to. Keeping such rows around
is a data leak (orphaned rows nothing can attribute), not preservation.
Real preservation is the abandon-via-status path above, which never
deletes the behavior row at all.

## Alternatives rejected

`ON DELETE SET NULL` on both FKs was rejected for the reason above: a
nulled `behavior_id` produces unattributable rows that are worse than no
rows, since they still show up in phase/artifact listings without
carrying the context a reader needs to interpret them.

## Consequences

Cascade delete is a destructive, irreversible operation, so it is gated:
the orchestrator agent is denied delete-shaped MCP tools by
`plugin/hooks/pre-tool-use/tdd-restricted.sh` (see
[Decision D13](d13-mcp-permits-agent-restricts.md)), so a cascade delete
of a behavior only happens via a main-agent call under explicit user
confirmation — never as a side effect of routine orchestrator activity.
Abandon-via-status is the path available inside the restricted loop, and
it is the one that keeps rows around for
[Decision D11](d11-tdd-phase-transition-evidence-binding.md)'s evidence
model and for the recurrence tracking in
[Decision D10](d10-stable-failure-signatures-via-ast-function-boundary.md).
