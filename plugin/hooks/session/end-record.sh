#!/bin/bash
# SessionEnd hook: fast foreground shim over end-record-worker.sh.
#
# Why a shim + worker split: the host runs SessionEnd hooks under
# `signal: AbortSignal.timeout(budget)` and, on an interactive interrupt
# (Ctrl+C), aborts the in-flight hook unconditionally. Our persistence
# does several serial `<pm> exec vitest-agent` spawns that can outlast
# that window on a cold cache, so the host would kill the hook mid-run
# and print "SessionEnd hook [...] failed: Hook cancelled" — and leave
# rows half-written. (Verified against the Claude Code binary: an aborted
# hook returns ABORT_ERR -> the "Hook cancelled" message; the SessionEnd
# budget is max(per-hook timeout)*1000, overridable via
# CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS.)
#
# Fix: on true exit reasons (other / prompt_input_exit /
# bypass_permissions_disabled / logout) the process is tearing down, so
# we DETACH the worker into a disowned background job whose fds point at
# a log file (never the host's stdout/stderr pipe). The foreground shim
# returns emit_noop within milliseconds, so the host has nothing to
# abort, and the worker completes the writes after the session exits.
#
# On continuation reasons (clear / resume) the session keeps running,
# there is no teardown, and the wrap-up systemMessage is still worth
# showing — so we run the worker synchronously and surface its output.

set -euo pipefail

# shellcheck source=../lib/hook-output.sh
. "$(dirname "$0")/../lib/hook-output.sh"
# shellcheck source=../lib/hook-debug.sh
. "$(dirname "$0")/../lib/hook-debug.sh"

_HOOK="session-end-record"

hook_json=$(cat)

chat_id=$(jq -r '.session_id // ""' <<< "$hook_json")
cwd=$(jq -r '.cwd // ""' <<< "$hook_json")
reason=$(jq -r '.reason // ""' <<< "$hook_json")

hook_debug "$_HOOK" "INPUT session_id=$chat_id cwd=$cwd reason=$reason"

if [ -z "$chat_id" ] || [ -z "$cwd" ]; then
	emit_noop
	exit 0
fi

worker="$(dirname "$0")/end-record-worker.sh"

case "$reason" in
	clear | resume)
		# Session continues — no teardown to race. Run synchronously and
		# surface the wrap-up prompt if the worker produced one.
		wrapup=$(bash "$worker" "$chat_id" "$cwd" "$reason" wrapup 2>/dev/null || echo "")
		if [ -n "$wrapup" ]; then
			emit_system_message "$wrapup"
		else
			emit_noop
		fi
		;;
	*)
		# True exit — detach so the host's abort/timeout can neither cancel
		# nor truncate the persistence. All worker fds are redirected away
		# from this hook's stdout/stderr pipe so the host's stream-close
		# wait resolves as soon as the shim exits.
		log_dir="${HOME}/.claude/session-env/${chat_id}"
		mkdir -p "$log_dir" 2>/dev/null || true
		nohup bash "$worker" "$chat_id" "$cwd" "$reason" quiet \
			</dev/null >>"${log_dir}/session-end-worker.log" 2>&1 &
		disown 2>/dev/null || true
		emit_noop
		;;
esac

exit 0
