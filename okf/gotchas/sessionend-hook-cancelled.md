---
type: Gotcha
title: An interactive exit can print "Hook cancelled" even though SessionEnd succeeded
description: >-
  Claude Code aborts an in-flight SessionEnd hook on an interactive exit and
  reports "Hook cancelled", which looks like a failed session-close write;
  the plugin's shim already detaches the real work so the write still lands.
tags: [dx]
stale_after: "2027-03-12T00:00:00Z"
generated:
  by: okfit/claude-code
  at: 2026-09-25T17:01:39Z
  body_sha256: 064d2610234484d510ca425e8e8e2f19e2b132c5588ae2598ef48c8c5e00ea7b
sources:
  - id: end-record
    resource: ../../plugins/claude-code/hooks/session/end-record.sh
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
`plugins/claude-code/hooks/session/end-record.sh`[^end-record]: on a true
exit reason (`other`, `prompt_input_exit`, `bypass_permissions_disabled`,
`logout`) the shim detaches the real worker,
`end-record-worker.sh`, into a disowned background job whose file
descriptors point at a log file rather than the host's stdout/stderr pipe
(`nohup bash "$worker" ... </dev/null >>"${log_dir}/session-end-worker.log"
2>&1 3>&- &` followed by `disown`)[^end-record]. The foreground shim
returns `emit_noop` within milliseconds, so the host has nothing left to
abort by the time its timeout fires, and the worker finishes the writes
after the session has already exited. On a continuation reason (`clear`,
`resume`) there is no teardown race, so the shim instead runs the worker
synchronously and surfaces its wrap-up `systemMessage`.

The practical upshot: seeing "Hook cancelled" on interactive exit is not,
by itself, evidence of a lost `agents.ended_at` / `session_map.ended_at`
write. Check `~/.claude/session-env/<chat_id>/session-end-worker.log` (the
detached worker's own log) or query the `agents` / `session_map` tables
directly before concluding the close failed.

## Related

- [Module: claude-code-plugin](../modules/claude-code-plugin.md)

[^end-record]: `../../plugins/claude-code/hooks/session/end-record.sh`
