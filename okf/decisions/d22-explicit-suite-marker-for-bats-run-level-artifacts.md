---
type: Decision
title: Explicit suite Marker for bats Run-Level Artifacts
description: tdd_artifacts.suite is a stored, CHECK-constrained column distinguishing vitest from bats runs, because a bats test has no test_case_id and inferring "bats" from a null test_case_id would also accept the vitest run-level evidence the phase-transition gate exists to reject.
status: stable
tags:
  - tdd
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-09-29T20:39:41Z
  body_sha256: 8c6a5c3d0ec0a96c763faea5fc4c63b6502efa3b43b8be1f8f94202ba14a7a38
sources:
  - id: migration-0001-suite-column
    resource: ../../packages/engine/src/migrations/0001_initial.ts
  - id: hooks-tdd-artifact
    resource: ../../plugins/claude-code/hooks/post-tool-use/tdd-artifact.sh
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
---

# Explicit suite Marker for bats Run-Level Artifacts

## Context

`post-tool-use/tdd-artifact.sh` records `test_failed_run` /
`test_passed_run` artifacts for bats invocations, so shell-hook behaviors
whose only tests are `plugins/claude-code/__test__/*.bats` leave run
evidence. Those rows are necessarily **run-level** — there is no
`test_cases` row for a bats test, so no `test_case_id` — and the
phase-transition validator's rule against anchorless artifacts denied
every run-level artifact regardless of which test runner produced it. A
bats-only cycle could therefore never pass `red → green` through the
gate. Accepting any null-`test_case_id` artifact outright was not a fix:
it would also accept a vitest run-level artifact, which is precisely the
"whole suite failed for an unrelated reason" evidence the anchorless-run
rule exists to reject.

## Decision

`tdd_artifacts` gains an explicit
`suite TEXT NOT NULL DEFAULT 'vitest' CHECK (suite IN ('vitest', 'bats'))`
column (`packages/engine/src/migrations/0001_initial.ts`). The
marker is threaded end to end: the write-side input defaults to
`"vitest"` when omitted; the validator's read path and
`listTddArtifactsForTask` (and therefore the `tdd_artifact_list` MCP
output) both carry `suite`; the CLI exposes
`agent record tdd-artifact --suite vitest|bats`; and the hook's bats
regex is tested *separately* from — and before — the
vitest/jest/package-manager-`test` pattern, passing `--suite bats` on a
match (`plugins/claude-code/hooks/post-tool-use/tdd-artifact.sh`). The
validator then carves out exactly
`test_case_id === null && suite === "bats"`: it keeps the phase-window
check (the artifact's own `phase_id` must equal the task's
`current_phase_id`) and skips the authored-in-session check, which has
no test case to consult. A vitest run-level artifact is denied exactly as
before.

**Why a stored column rather than inference.** Inferring "bats" from a
null `test_case_id` is the widening rejected above. Inferring it from the
command text at read time would put the hook's matcher inside the
validator, coupling two things that should stay independently testable. A
stored, CHECK-constrained marker is set once at the only write path (the
hook, via the CLI sidecar — see
[Decision D16](d16-sidecar-cli-over-mcp-tool-hooks.md)) and read as plain
data, which is what keeps the phase-transition validator pure and lets
the vitest guard stay exactly as strict as it was. The hook's regex split
is the load-bearing piece on the write side: a package-manager script
named `test:bats` also satisfies the vitest pattern's `test` substring,
so testing the bats alternation first is what stops that command from
being misrecorded as `vitest`.

## Alternatives rejected

Accepting any artifact with a null `test_case_id` as valid run-level
evidence was rejected: it would silently accept vitest whole-suite
failures unrelated to the behavior under test as if they were targeted
evidence, defeating the anchorless-run rule's purpose.

Inferring the suite from the recorded command text at validation time was
rejected: it would move the hook's regex-matching concern into the
validator, coupling a text-classification heuristic to the code path that
has to stay strict and easy to reason about.

## Consequences

What binding a bats artifact guarantees is weaker than what a vitest
artifact guarantees, and that gap is accepted knowingly. The phase window
is the whole guarantee for a bats artifact — the run happened inside the
phase being transitioned out of — whereas the vitest path additionally
proves the specific test was authored in-session and, for `red → green`,
first failed in the cited run. bats has no per-test identity the system
can see, and a phase-bound run-level artifact is honest evidence where
the alternative was no gate at all for shell-hook behaviors.
