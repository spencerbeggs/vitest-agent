#!/bin/bash
# SessionEnd worker: the actual persistence + wrap-up work, factored out of
# end-record.sh so the foreground hook can detach it on true session exits
# (see end-record.sh for why). It is not a registered hook: the shim runs it,
# and it inherits the shim's environment, session env values included.
#
# Per spec W5: agent reviews touched tests/files, records insights via
# note_create, marks hypotheses validated/invalidated, updates
# tdd_tasks.outcome. Wrap-up content from formatWrapupEffect via the wrapup
# CLI.
#
# Args:
#   $1 chat_id   host session id
#   $2 cwd       workspace root the session ran in
#   $3 reason    SessionEnd reason (other|clear|resume|logout|...)
#
# It prints nothing: every CLI call routes its own output to /dev/null or the
# error log.

set -euo pipefail

chat_id="${1:-}"
cwd="${2:-}"
reason="${3:-}"

# The shared pluginfinity log library (script_log / script_debug), from this
# script's own build.
_pf_log_dir="$(cd "$(dirname "$0")/../../lib/pluginfinity" && pwd)"
# shellcheck source=/dev/null
. "$_pf_log_dir/log.sh"

if [ -z "$chat_id" ] || [ -z "$cwd" ]; then
	exit 0
fi

script_debug "chat_id=$chat_id cwd=$cwd reason=$reason"

# The CLI resolution rules live with the hooks; this script cannot source the
# hook library (it owns stdin and the response), so it repeats the four rungs.
if [ -n "${VITEST_AGENT_CLI_CMD:-}" ]; then
	cli="$VITEST_AGENT_CLI_CMD"
elif [ -x "$cwd/node_modules/.bin/vitest-agent" ]; then
	cli="node_modules/.bin/vitest-agent"
elif command -v vitest-agent >/dev/null 2>&1; then
	cli="vitest-agent"
else
	exit 0
fi

ended_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# 1. Record a hook_fire turn so acceptance_metrics can track SessionEnd events.
fire_payload=$(jq -nc --arg cc "$chat_id" \
	'{type: "hook_fire", hook_kind: "SessionEnd", chat_id: $cc}')
_fire_err=$(mktemp)
_fire_out=$(cd "$cwd" && $cli agent record turn \
	--chat-id "$chat_id" \
	"$fire_payload" 2>"$_fire_err") || {
	_rc=$?
	script_log "record turn hook_fire rc=$_rc cc=$chat_id: $(cat "$_fire_err")"
}
rm -f "$_fire_err"
script_debug "record turn hook_fire: $_fire_out"

# 2. Record the session end.
if [ -n "$reason" ]; then
	(cd "$cwd" && $cli agent record session-end \
		--chat-id "$chat_id" \
		--ended-at "$ended_at" \
		--end-reason "$reason" \
		>/dev/null 2>&1) ||
		true
else
	(cd "$cwd" && $cli agent record session-end \
		--chat-id "$chat_id" \
		--ended-at "$ended_at" \
		>/dev/null 2>&1) ||
		true
fi

# 2b. Close the agent-taxonomy rows. VITEST_AGENT_MAIN_AGENT_ID comes from the
# session env the shim loaded and exported.
if [ -n "${VITEST_AGENT_MAIN_AGENT_ID:-}" ]; then
	ended_at_unix=$(date -u +%s)
	_end_err=$(mktemp)
	if ! (cd "$cwd" && $cli agent end-agent \
		--agent-id "$VITEST_AGENT_MAIN_AGENT_ID" \
		--host-session-id "$chat_id" \
		--ended-at "$ended_at_unix" \
		--cwd "$cwd" >/dev/null 2>"$_end_err"); then
		script_log "end-agent cc=$chat_id agent=$VITEST_AGENT_MAIN_AGENT_ID: $(cat "$_end_err")"
	fi
	rm -f "$_end_err"
	script_debug "end-agent: agent=$VITEST_AGENT_MAIN_AGENT_ID"
fi

# Janitorial cleanup: remove this session's active-subagents state so orphaned
# files from SubagentStop crashes don't accumulate across sessions. The
# directory is the one subagent/start-tdd.sh writes (va_state_dir).
case "$chat_id" in
*/* | *..* | .) ;;
*)
	state_root="${CLAUDE_PLUGIN_DATA:-${COPILOT_PLUGIN_DATA:-${XDG_STATE_HOME:-$HOME/.local/state}/vitest-agent}}"
	rm -rf "$state_root/active-subagents/$chat_id" 2>/dev/null || true
	;;
esac

exit 0
