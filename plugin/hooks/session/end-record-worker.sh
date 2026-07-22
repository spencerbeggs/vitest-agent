#!/bin/bash
# SessionEnd worker: the actual persistence + wrap-up work, factored out
# of end-record.sh so the foreground hook can detach it on true session
# exits (see end-record.sh for why).
#
# Per spec W5: agent reviews touched tests/files, records insights via
# note_create, marks hypotheses validated/invalidated, updates
# tdd_tasks.outcome. Wrap-up content from formatWrapupEffect via
# the wrapup CLI.
#
# Args:
#   $1 chat_id   host session id
#   $2 cwd       workspace root the session ran in
#   $3 reason    SessionEnd reason (other|clear|resume|logout|...)
#   $4 mode      "wrapup" -> compute + print the wrap-up prompt to stdout
#                "quiet"  -> skip the wrap-up (nobody is listening on exit)
#
# stdout is reserved for the wrap-up prompt ONLY (mode=wrapup); every
# CLI call routes its own output to /dev/null or the error log, and the
# hook_debug/hook_error helpers write to log files, so a caller can
# safely capture stdout via command substitution.

set -euo pipefail

chat_id="${1:-}"
cwd="${2:-}"
reason="${3:-}"
mode="${4:-quiet}"

# shellcheck source=../lib/hook-debug.sh
. "$(dirname "$0")/../lib/hook-debug.sh"

_HOOK="session-end-record"

if [ -z "$chat_id" ] || [ -z "$cwd" ]; then
	exit 0
fi

hook_debug "$_HOOK" "WORKER chat_id=$chat_id cwd=$cwd reason=$reason mode=$mode"

# shellcheck source=../lib/detect-pm.sh
. "$(dirname "$0")/../lib/detect-pm.sh"
pm_exec=$(detect_pm_exec "$cwd")

ended_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# 1. Record a hook_fire turn so acceptance_metrics can track SessionEnd events.
fire_payload=$(jq -nc --arg cc "$chat_id" \
	'{type: "hook_fire", hook_kind: "SessionEnd", chat_id: $cc}')
_fire_err=$(mktemp)
_fire_out=$(cd "$cwd" && $pm_exec vitest-agent agent record turn \
	--chat-id "$chat_id" \
	"$fire_payload" 2>"$_fire_err") || {
	_rc=$?
	hook_error "$_HOOK" "record turn hook_fire rc=$_rc cc=$chat_id: $(cat "$_fire_err")"
}
rm -f "$_fire_err"
hook_debug "$_HOOK" "record turn hook_fire: $_fire_out"

# 2. Record the session end.
if [ -n "$reason" ]; then
	cd "$cwd" >/dev/null && $pm_exec vitest-agent agent record session-end \
		--chat-id "$chat_id" \
		--ended-at "$ended_at" \
		--end-reason "$reason" \
		>/dev/null 2>&1 \
		|| true
else
	cd "$cwd" >/dev/null && $pm_exec vitest-agent agent record session-end \
		--chat-id "$chat_id" \
		--ended-at "$ended_at" \
		>/dev/null 2>&1 \
		|| true
fi

# 2b. Close the agent-taxonomy rows. Source the session-env dir to pull
# in VITEST_AGENT_MAIN_AGENT_ID written by SessionStart; CLAUDE_ENV_FILE
# is NOT auto-sourced into hook subprocesses.
# shellcheck source=../lib/source-session-env.sh
. "$(dirname "$0")/../lib/source-session-env.sh"
source_session_env "$chat_id"

if [ -n "${VITEST_AGENT_MAIN_AGENT_ID:-}" ]; then
	ended_at_unix=$(date -u +%s)
	# shellcheck disable=SC2086
	_end_err=$(mktemp)
	# shellcheck disable=SC2086
	if ! (cd "$cwd" && $pm_exec vitest-agent agent end-agent \
		--agent-id "$VITEST_AGENT_MAIN_AGENT_ID" \
		--host-session-id "$chat_id" \
		--ended-at "$ended_at_unix" \
		--cwd "$cwd" >/dev/null 2>"$_end_err"); then
		hook_error "$_HOOK" "end-agent cc=$chat_id agent=$VITEST_AGENT_MAIN_AGENT_ID: $(cat "$_end_err")"
	fi
	rm -f "$_end_err"
	hook_debug "$_HOOK" "end-agent: ok agent=$VITEST_AGENT_MAIN_AGENT_ID"
fi

# Janitorial cleanup: remove the active-subagents dir so orphaned files
# from SubagentStop crashes don't accumulate across sessions.
rm -rf "$HOME/.claude/session-env/$chat_id/active-subagents" 2>/dev/null || true

# 3. Compute the wrap-up prompt only when a caller is still able to show
# it (mode=wrapup on the clear/resume path). On a true exit nobody is
# listening, so skip the extra CLI spawn entirely.
if [ "$mode" = "wrapup" ]; then
	wrapup=$(cd "$cwd" && $pm_exec vitest-agent agent wrapup \
		--chat-id "$chat_id" \
		--kind session_end \
		--format markdown 2>/dev/null || echo "")
	if [ -n "$wrapup" ]; then
		printf '%s\n' "$wrapup"
	fi
fi

exit 0
