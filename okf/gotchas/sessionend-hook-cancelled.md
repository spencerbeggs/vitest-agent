---
type: Gotcha
title: An interactive exit can print "Hook cancelled" even though SessionEnd succeeded
description: >-
  Claude Code aborts an in-flight SessionEnd hook on an interactive exit and
  reports "Hook cancelled", which looks like a failed session-close write;
  the plugin's shim already detaches the real work so the write still lands.
tags: [dx]
status: draft
stale_after: "2027-03-12T00:00:00Z"
generated:
  by: okfit/claude-code
  at: 2026-10-10T02:40:34Z
  body_sha256: 4003fc0f284bc98c3d03a8cbc68c9b576a66abd6993dbe446078464081dfe651
sources:
  - id: end-record
    resource: ../../plugin/hooks/session/end-record.sh
---

# An interactive exit can print "Hook cancelled" even though SessionEnd succeeded

A user who exits Claude Code interactively (Ctrl+C, `/exit`, closing the
terminal) and sees `SessionEnd hook [...] failed: Hook cancelled` printed
to the console reasonably concludes that session-close bookkeeping —
`agents.ended_at`, `session_map.ended_at`, the final turn record — did not
happen. **What is actually true:** the message comes from Claude Code
itself, not from this repository. The host runs every `SessionEnd` hook
under `signal: AbortSignal.timeout(budget)` and, on an interactive
interrupt, aborts any hook still in flight unconditionally; an aborted
hook returns `ABORT_ERR`, which the host renders as "Hook cancelled". The
plugin's own persistence work — several serial `vitest-agent` CLI
spawns — can outlast that budget, so the abort would otherwise land
mid-write and leave rows half-written.

The mitigation lives entirely in
`plugin/hooks/session/end-record.sh`[^end-record]. On a true exit reason
(anything but `clear` or `resume`, such as `other`, `prompt_input_exit`,
`bypass_permissions_disabled`, or `logout`), the shim detaches the real
worker, `end-record-worker.sh`, into a disowned background job with every
descriptor pointed away from the host's pipes (`nohup bash "$worker" ...
</dev/null >/dev/null 2>&1 &` followed by `disown`)[^end-record]. The
foreground shim answers `hook_noop` within milliseconds, so the host has
nothing left to abort by the time its timeout fires, and the worker
finishes the writes after the session has already exited. On a
continuation reason (`clear`, `resume`) there is no teardown race, so the
shim runs the worker synchronously.

The practical upshot: seeing "Hook cancelled" on interactive exit is not,
by itself, evidence of a lost `agents.ended_at` / `session_map.ended_at`
write. The detached worker logs failures through pluginfinity's log
library, so check `error.log` under
`${XDG_STATE_HOME:-~/.local/state}/pluginfinity/vitest-agent/` (`pnpm exec
pluginfinity logs`), or query the `agents` / `session_map` tables directly,
before concluding the close failed.

## Related

- [Module: vitest-agent agent plugin](../modules/claude-code-plugin.md)

[^end-record]: `../../plugin/hooks/session/end-record.sh`
