---
type: Gotcha
title: tdd_phase_transition_request is annotated Idempotent but is not
description: >-
  The tool declares Tool.Idempotent(true) yet is absent from the MCP
  idempotency-key registry, so a retried call opens a second phase
  transition instead of replaying the first.
resource: ../../packages/mcp/src/tools/tdd-phase-transition-request.ts
tags: [dx, mcp, tdd]
stale_after: "2027-03-12T00:00:00Z"
generated:
  by: okfit/claude-code
  at: 2026-09-14T02:24:39Z
sources:
  - id: phase-transition-tool
    resource: ../../packages/mcp/src/tools/tdd-phase-transition-request.ts
  - id: idempotency
    resource: ../../packages/mcp/src/idempotency.ts
integrity:
  generated:
    body: 5d5e16b773e8d2fe
---

# tdd_phase_transition_request is annotated Idempotent but is not

A reader inspecting `tddPhaseTransitionRequestTool`'s annotations sees
`.annotate(Tool.Idempotent, true)`[^phase-transition-tool] and reasonably
concludes that retrying the call — after a timeout, a dropped connection,
or an agent's own retry-on-failure loop — is safe: the MCP protocol's own
convention for an idempotent tool is that calling it twice with the same
arguments has the same effect as calling it once. **What is actually
true:** the handler is not wrapped in `withIdempotency`, and
`tdd_phase_transition_request` does not appear among the paths registered
in `packages/mcp/src/idempotency.ts` — only `hypothesis` (validate),
`tdd_task` (start/end), `tdd_goal` (create), and `tdd_behavior` (create)
are[^idempotency]. Every accepted call to
`handlePhaseTransitionRequest` runs `store.writeTddPhase`, which opens a
new `tdd_phases` row and closes whichever row was previously open,
unconditionally.

A retried call therefore does not detect the earlier one and replay its
result — it evaluates the current phase fresh (now the phase the first
call just opened), and if the requested phase and evidence still validate
against that new current phase, it opens a second transition row on top
of the first. Two consequences follow: the `tdd_phases` history for a
task gains a spurious extra row for what was, from the caller's point of
view, one logical transition, and any behavior auto-promotion
(`pending` → `in_progress`, step 7 in the handler) that already ran once
on the first call may re-run redundantly on the retry — mostly harmless
since it only fires on `status === "pending"`, but a symptom of the same
missing guard.

Callers that need retry safety around this tool should track their own
"have I already requested this transition" state (for example, by
checking the current phase via `tdd_phase_get` before retrying) rather
than relying on the `Idempotent` annotation.

## Related

- [Module: mcp](../modules/mcp.md)
- [Decision D11 — TDD Phase-Transition Evidence Binding](../decisions/d11-tdd-phase-transition-evidence-binding.md)

[^phase-transition-tool]: `../../packages/mcp/src/tools/tdd-phase-transition-request.ts`
[^idempotency]: `../../packages/mcp/src/idempotency.ts`
