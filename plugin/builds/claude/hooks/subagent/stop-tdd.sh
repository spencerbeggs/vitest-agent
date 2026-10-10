#!/bin/bash
# SubagentStop hook scoped to tdd-task: close out the subagent's
# agents.ended_at via the state file written by SubagentStart, then generate
# the structured handoff message via wrapup --kind=tdd_handoff and store it as
# a note turn on the parent session.

set -euo pipefail

. "$(dirname "$0")/../lib/pluginfinity/hook.sh"
. "$(dirname "$0")/../lib/vitest-agent/common.sh"
hook_require_input

agent_type=$(hook_input agent_type)
if ! va_is_tdd_agent "$agent_type"; then
	hook_noop
	exit 0
fi

chat_id=$(hook_input session_id)
cwd=$(hook_input cwd)

if [ -z "$chat_id" ] || [ -z "$cwd" ]; then
	hook_noop
	exit 0
fi

cli=$(va_cli "$cwd") || {
	hook_noop
	exit 0
}

# Close the subagent's agents.ended_at by pairing with the oldest state file
# that matches this agent_type. SubagentStart writes one
# <state>/active-subagents/<chat_id>/<ts>-<pid>.json per dispatch;
# oldest-stop-pairs-with-oldest-start (approximate for concurrent same-type
# dispatches, exact for sequential ones).
state_file=""
case "$chat_id" in
*/* | *..* | .) state_dir="" ;;
*) state_dir="$(va_state_dir)/active-subagents/$chat_id" ;;
esac
if [ -n "$state_dir" ] && [ -d "$state_dir" ]; then
	# grep -rl finds the files holding the agentType JSON value, ls -tr sorts by
	# mtime ascending, head -1 takes the oldest. The `|| true` guards against
	# SIGPIPE from head -1 closing the pipe early under pipefail.
	# shellcheck disable=SC2012
	state_file=$(
		grep -rl "\"agentType\":\"$agent_type\"" "$state_dir" 2>/dev/null |
			xargs -r ls -tr 2>/dev/null |
			head -1 ||
			true
	)
fi
if [ -n "$state_file" ] && [ -f "$state_file" ]; then
	subagent_agent_id=$(jq -r '.agentId // empty' <"$state_file")
	if [ -n "$subagent_agent_id" ]; then
		ended_at_unix=$(date -u +%s)
		_end_err=$(mktemp)
		if ! (cd "$cwd" && $cli agent end-agent \
			--agent-id "$subagent_agent_id" \
			--ended-at "$ended_at_unix" \
			--cwd "$cwd" >/dev/null 2>"$_end_err"); then
			hook_log "end-agent (subagent) agent=$subagent_agent_id: $(cat "$_end_err")"
		fi
		rm -f "$_end_err"
		hook_debug "end-agent (subagent): agent=$subagent_agent_id"
	fi
	rm -f "$state_file"
fi

# Generate the handoff message using the wrapup CLI in tdd_handoff mode.
handoff=$(cd "$cwd" && $cli agent wrapup \
	--chat-id "$chat_id" \
	--kind tdd_handoff \
	--format markdown 2>/dev/null || echo "")

# The parent agent's next Stop hook injects from notes; SubagentStop is not an
# injection point (per spec W5), so the handoff is recorded, not returned.
if [ -n "$handoff" ]; then
	parent_cc=$(hook_input parent_session_id)
	if [ -n "$parent_cc" ]; then
		payload=$(jq -nc --arg c "$handoff" '{type: "note", scope: "tdd_handoff", content: $c}')
		(cd "$cwd" && $cli agent record turn \
			--chat-id "$parent_cc" \
			"$payload" \
			>/dev/null 2>&1) ||
			true
	fi
fi

hook_noop
