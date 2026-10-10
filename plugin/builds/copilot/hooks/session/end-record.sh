#!/bin/bash
# SessionEnd hook: fast foreground shim over end-record-worker.sh.
#
# Why a shim + worker split: the host runs SessionEnd hooks under
# `signal: AbortSignal.timeout(budget)` and, on an interactive interrupt
# (Ctrl+C), aborts the in-flight hook unconditionally. Our persistence does
# several serial `vitest-agent` CLI spawns that can outlast that window on a
# cold cache, so the host would kill the hook mid-run and print "SessionEnd
# hook [...] failed: Hook cancelled" — and leave rows half-written. (Verified
# against the Claude Code binary: an aborted hook returns ABORT_ERR -> the
# "Hook cancelled" message; the SessionEnd budget is max(per-hook
# timeout)*1000, overridable via CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS.)
#
# Fix: on true exit reasons (other / prompt_input_exit /
# bypass_permissions_disabled / logout) the process is tearing down, so we
# DETACH the worker into a disowned background job whose fds point away from
# the host's stdout/stderr pipes. The foreground shim answers within
# milliseconds, so the host has nothing to abort, and the worker completes the
# writes after the session exits. The worker logs through the shared
# pluginfinity log library, so its failures land in error.log.
#
# On continuation reasons (clear / resume) the session keeps running and there
# is no teardown, so the worker runs synchronously. (The session-end wrap-up
# the earlier version returned as a systemMessage is no longer computed:
# neither host shows a SessionEnd system message.)

set -euo pipefail

. "$(dirname "$0")/../lib/pluginfinity/hook.sh"
. "$(dirname "$0")/../lib/vitest-agent/common.sh"
hook_require_input

chat_id=$(hook_input session_id)
cwd=$(hook_input cwd)
reason=$(hook_input reason)

hook_debug "session_id=$chat_id cwd=$cwd reason=$reason"

if [ -z "$chat_id" ] || [ -z "$cwd" ]; then
	hook_noop
	exit 0
fi

worker="$(dirname "$0")/end-record-worker.sh"

case "$reason" in
clear | resume)
	# Session continues — no teardown to race, so run synchronously.
	bash "$worker" "$chat_id" "$cwd" "$reason" >/dev/null 2>&1 || true
	;;
*)
	# True exit — detach so the host's abort/timeout can neither cancel nor
	# truncate the persistence. Every worker fd is redirected away from this
	# hook's stdout/stderr pipes so the host's stream-close wait resolves as
	# soon as the shim exits.
	nohup bash "$worker" "$chat_id" "$cwd" "$reason" </dev/null >/dev/null 2>&1 &
	disown 2>/dev/null || true
	;;
esac
hook_noop

