---
type: Decision
title: Fence Hook Stdout at the Library, Not the Call Site
description: hook-output.sh redirects real hook stdout to fd 3 at source time so a call site that forgets to redirect a spawned CLI's stdout cannot corrupt the single JSON object Claude Code parses from fd 1, making the whole failure class unrepresentable instead of relying on per-call-site discipline.
status: deprecated
tags:
  - dx
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-09-29T20:39:41Z
  body_sha256: c36a586d77655babc05570320764557f9f8c5e6244d058c0fc7b1466850b69d2
sources:
  - id: hooks-hook-output
    resource: ../../plugins/claude-code/hooks/lib/hook-output.sh
  - id: hooks-test-run
    resource: ../../plugins/claude-code/hooks/post-tool-use/test-run.sh
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
---

# Fence Hook Stdout at the Library, Not the Call Site

## Context

Claude Code parses a hook's stdout as exactly one JSON object, so every
byte the hook script — or anything it spawns — writes to fd 1 is
concatenated into that payload. `post-tool-use/test-run.sh` redirected
only stderr on its two `vitest-agent agent record` calls, and `record
test-case-turns` prints a JSON result object of its own. The host
received two concatenated JSON objects and rejected the hook outright:
"Hook output looks like a JSON object but is not valid JSON" (issue
373, tracked upstream in this repository). The bug is structural rather
than local — it recurs the next time any call site forgets a redirect,
and it is invisible in the transcript because the *whole* hook response
is discarded, permission decision included.

## Decision

`hooks/lib/hook-output.sh` moves the real hook stdout off fd 1 at source
time: `exec 3>&1 1>&2`, guarded by `_VITEST_AGENT_HOOK_STDOUT_FENCED` so a
re-source cannot redirect twice
(`plugins/claude-code/hooks/lib/hook-output.sh`). Every emitter —
`emit_noop`, `emit_allow`, `emit_deny`, `emit_additional_context`,
`emit_system_message`, and the `emit_raw` escape hatch for a payload
shape none of those cover — writes explicitly to `>&3`. Stray stdout from
the sourcing script or any child process it spawns now lands on stderr:
visible for debugging, invisible to the host's JSON parser. Call-site
redirects still exist on the two `record` calls in `test-run.sh` to keep
the logs quiet (`plugins/claude-code/hooks/post-tool-use/test-run.sh`),
but correctness no longer rests on them being present.

**Why a fence over per-call-site discipline.** The alternative is a
convention — "always redirect stdout when spawning a CLI" — enforced by
review across every current and future hook. The fence makes the failure
class unrepresentable instead: the only path to the host is a helper that
names fd 3 explicitly, which is both greppable and testable. It also
forces the escape hatch to be explicit: a hook needing a payload shape
the helpers do not cover pipes into `emit_raw`, because a bare `jq` write
to fd 1 is now diverted to stderr by the fence and yields an empty
payload rather than a wrong one.

**Why the guard is not exported.** A nested script that sources the
library must fence *its own* fd 1. Were the guard exported, the child
would skip the `exec`, leave its stdout pointed at the parent's stderr,
and have its emitters write to whatever the parent parked on fd 3 —
wrong descriptor, wrong stream.

## Alternatives rejected

Enforcing "redirect stdout at every call site" through code review or a
lint rule was rejected: it is a convention that has to be re-applied
correctly at every future call site, and the issue-373 bug is exactly
what happens the first time it is not.

## Consequences

A backgrounded process inherits fd 3 and therefore a handle on the host's
real stdout pipe. That defeats the `SessionEnd` detach pattern (the
`session/end-record.sh` shim), whose entire point is that the host's
stream-close wait resolves the instant the shim exits — so the detached
`nohup ... &` invocation closes fd 3 explicitly (`3>&-`). Any future
detach mechanism owes the same close, or it silently reopens the same
class of bug the fence exists to prevent, just via a held-open descriptor
instead of a forgotten redirect.

Command substitution is unaffected in both directions: `$(cmd)` installs
its own fd 1 for the child, so capture keeps working and the captured
bytes never reach the host. `plugins/claude-code/__test__/hook-stdout-fence.bats`
pins the fence, the double-source guard, the command-substitution
carve-out, and the `test-run.sh` regression, asserting on stdout alone
because bats folds stderr into its captured output and would otherwise
hide the leak under test.
