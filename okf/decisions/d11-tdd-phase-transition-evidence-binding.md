---
type: Decision
title: TDD Phase-Transition Evidence Binding
description: A pure validatePhaseTransition function enforces three D2 binding rules — evidence in the current phase window and session, behavior match, and the cited test wasn't already failing — plus two source-phase guards, so a phase advance requires evidence that is actually current, not merely present.
status: draft
tags:
  - tdd
  - mcp
generated:
  by: okfit/claude-code
  at: 2026-09-25T17:01:39Z
  body_sha256: 5be10e8b3f6e729401ac007391a73e45254c53ee9ce453779146e7d916e14506
sources:
  - id: validate-phase-transition
    resource: ../../packages/sdk/src/utils/validate-phase-transition.ts
  - id: tdd-phase-transition-request
    resource: ../../packages/mcp/src/tools/tdd-phase-transition-request.ts
---

# TDD Phase-Transition Evidence Binding

## Context

The TDD orchestrator advances a behavior through phases (`spike`, `red`,
`red.triangulate`, `green`, `green.fake-it`, `refactor`) by citing evidence —
a recorded `tdd_artifacts` row — for the transition. Accepting a citation at
face value would let a stale or misattributed artifact (a test that failed
in an earlier phase, in another session, or for another behavior) stand in
for genuine evidence that the current phase's work actually happened.

## Decision

`validatePhaseTransition` in
`packages/sdk/src/utils/validate-phase-transition.ts` is a pure function: it
takes a `PhaseTransitionContext` (current phase, requested phase, the cited
artifact, and the requested behavior id) and returns a discriminated
`PhaseTransitionResult` — either `{ accepted: true, phase }` or
`{ accepted: false, phase, denialReason, remediation }`, where
`DenialReason` is a closed string-literal union and `Remediation` carries a
`suggestedTool`, `suggestedArgs`, and a `humanHint` (served on the wire as
`hint`, `@effected/engine`'s `Remediation` shape).[^validate-phase-transition]
No I/O and no async: the MCP tool `tdd_phase_transition_request` loads the
binding context (cited artifact details, session info) through `DataReader`
Effect calls and passes the resolved plain data in, so the orchestrator can
match on a typed reason and recover programmatically instead of parsing free
text.[^tdd-phase-transition-request]

**Artifact-kind precondition.** Before any binding rule runs,
`requiredArtifactForTransition(from, to)` says which `ArtifactKind` a
transition needs: `red → green` and `red.triangulate → green` require
`test_failed_run`; `green → refactor` and `refactor → red` require
`test_passed_run` (refactor must end with all tests still passing). A cited
artifact of the wrong kind is denied with `wrong_artifact_kind` before any
other check runs. Transitions with no required artifact — `spike → red`,
`red.triangulate → red`, `green.fake-it → refactor`, and others — are
accepted unconditionally.[^validate-phase-transition]

**Two source-phase guards fire regardless of evidence.** `green` may only be
entered from `red`, `red.triangulate`, or `green.fake-it`; requesting it from
anywhere else is denied `wrong_source_phase` before artifact resolution even
runs, because skipping the named red phase would leave `tdd_phases` without
a `phase="red"` row and break the phase-evidence integrity metric.
Symmetrically, `refactor` may only be entered from `green` or
`green.fake-it`; a `red → refactor` (or `red.triangulate → refactor`, or
`spike → refactor`) request is denied `refactor_without_passing_run` before
artifact resolution, because otherwise auto-resolution could cite a stale
`test_passed_run` left over from an earlier behavior's cycle and let the
transition through with zero evidence that this behavior's implementation
actually passes.[^validate-phase-transition]

**The three D2 binding rules**, checked once the artifact-kind precondition
passes:

1. **Evidence in phase window and session.** The cited artifact's own
   `phase_id` must equal `PhaseTransitionContext.current_phase_id` (skipped
   when `current_phase_id` is `null`, meaning no `tdd_phases` row exists
   yet), and the cited test must have been authored in the current session.
   The anchor is the artifact's own phase binding, not the test case's
   first-ever creation turn — a test authored during `spike` and re-run
   inside `red` is not stale evidence as long as the cited
   `test_failed_run` was itself recorded in the current phase; what is
   stale is an artifact recorded in a *different*, already-closed phase
   being replayed against the current one. A `vitest` run-level artifact
   (no `test_case_id`) has no anchor to check and is denied outright with
   `missing_artifact_evidence`. A `bats` run-level artifact is exempted
   from that denial — there is no `test_cases` row for a bats test — and
   instead gets only the phase-window portion of rule 1, skipping the
   authored-in-session check entirely; the carve-out is keyed on the
   explicit `suite` marker on the artifact, never inferred from a null
   `test_case_id`.[^validate-phase-transition]
2. **Behavior match.** Scoped only to `red → green` and `green → refactor`
   via the exported predicate `transitionEnforcesBehaviorMatch(from, to)`:
   when the orchestrator supplies a `requested_behavior_id`, the cited
   artifact's `behavior_id` must equal it. It does not apply to
   `refactor → red` (the required `test_passed_run` necessarily belongs to
   the just-finished behavior, never the new target) or to
   `red.triangulate → green` (the cited failing run legitimately belongs to
   an earlier batch member).[^validate-phase-transition]
3. **Test wasn't already failing.** For a cited `test_failed_run`, the
   test's `test_first_failure_run_id` must equal the cited `test_run_id` —
   otherwise the test was already failing before this phase and citing it
   proves nothing about the current cycle.[^validate-phase-transition]

**Triangulation-aware `red.triangulate → green`.**
`requiredArtifactForTransition` returns `test_failed_run` for this
transition (rather than `null`, which would have accepted it with zero
evidence). The kind check, the specific-test check, the
authored-in-session check, and rule 3 still apply, but the phase-window
portion of rule 1 and all of rule 2 are skipped: in a triangulation batch,
one shared implementation satisfies several behaviors, so later behaviors'
tests never fail on their own — the batch's real failing run, which belongs
to an earlier behavior, is accepted as evidence for each member. A specific,
real, in-session failing test must still exist.[^validate-phase-transition]

**One predicate keeps the validator and auto-resolution in lockstep.** The
same exported `transitionEnforcesBehaviorMatch(from, to)` that gates rule 2
in the validator also scopes the MCP tool's artifact auto-resolution:
`tdd_phase_transition_request` passes `behaviorId` into its artifact lookup
only when the helper returns true for the requested transition, and leaves
the lookup unscoped (batch-wide or prior-behavior) otherwise — so
auto-resolution narrows to the requested behavior on exactly the transitions
where the validator will require it, and picks the newest matching artifact
task-wide everywhere else.[^tdd-phase-transition-request]

## Alternatives rejected

- **An Effect service wrapping the validator.** Rejected because the
  function takes a context object and returns a result with no I/O and no
  async; wrapping it in a service would be ceremony with no testability
  gain. Loading the binding context via `DataReader` stays the
  orchestrator's job, one layer up.
- **Free-text denial reasons.** Rejected in favor of a closed `DenialReason`
  union with a structured `Remediation`, so the orchestrator can match on
  the reason programmatically and act on a concrete `suggestedTool` /
  `suggestedArgs` pair instead of parsing a message for intent.
- **Binding the phase window to the test case's first-ever creation turn.**
  This was the original anchor and was replaced because a `test_cases` row
  is created once and reused across every later run: a test authored during
  `spike` and re-run inside `red` was denied even though the cited artifact
  was genuinely produced in the current phase, and the remediation ("write
  a new failing test") could not be satisfied without duplicating the test.
  The artifact's own `phase_id` binding is the honest anchor because it
  reflects when the evidence was actually produced, not when the test file
  first came into existence.
- **Denying every bats run-level artifact outright**, matching the existing
  vitest run-level denial. Rejected because there is no `test_cases` row
  for a bats test, so no bats-only TDD cycle could ever pass `red → green`
  or `green → refactor`; the explicit `suite` marker lets the carve-out
  apply only where it is structurally justified rather than inferring it
  from an ambiguous null `test_case_id`.
- **Enforcing behavior-match on every evidence-bearing transition whenever a
  `behaviorId` is supplied.** This was the original scope and made a
  one-step behavior-boundary crossing impossible: a `refactor → red` call
  that also set the new `behaviorId` would fail rule 2 because the cited
  passing run necessarily belonged to the prior behavior. Scoping the rule
  to only `red → green` and `green → refactor` lets a boundary crossing
  happen in one `refactor → red` step, replacing what used to be a two-step
  `refactor → red` then `red → red` rebind.

## Consequences

The validator only enforces the binding rules — it does not verify that the
cited artifact actually exists, that the session is still open, or that the
goal has started. Those remain pre-validator responsibilities of the
orchestrating MCP tool, which already needs the artifact's details to build
the context object, so duplicating those checks inside the pure function
would be redundant. Every transition falls into exactly one of three
buckets — evidence-free and always accepted, source-phase-guarded
regardless of evidence, or evidence-bearing under the three D2 rules — which
keeps the state machine's evidence requirements exhaustively enumerable
rather than an ad hoc case-by-case policy.

## Related

- [Module: mcp](../modules/mcp.md)
- [Module: claude-code-plugin](../modules/claude-code-plugin.md)
- [Gotcha: Phase Transition Not Idempotent](../gotchas/phase-transition-not-idempotent.md)

[^validate-phase-transition]: `../../packages/sdk/src/utils/validate-phase-transition.ts:115-389`
[^tdd-phase-transition-request]: `../../packages/mcp/src/tools/tdd-phase-transition-request.ts:164-396`
