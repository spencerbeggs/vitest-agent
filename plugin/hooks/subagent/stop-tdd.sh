#!/bin/bash
# SubagentStop hook scoped to tdd-task: close out the subagent's
# agents.ended_at via the state-file written by SubagentStart, then
# generate the structured handoff message via wrapup --kind=tdd_handoff
# and store it as a note turn on the parent session.

set -euo pipefail

# shellcheck source=../lib/hook-output.sh
. "$(dirname "$0")/../lib/hook-output.sh"
# shellcheck source=../lib/hook-debug.sh
. "$(dirname "$0")/../lib/hook-debug.sh"

_HOOK="subagent-stop-tdd"

hook_json=$(cat)

agent_type=$(echo "$hook_json" | jq -r '.agent_type // ""')
# shellcheck source=../lib/match-tdd-agent.sh
. "$(dirname "$0")/../lib/match-tdd-agent.sh"
if ! is_tdd_agent "$agent_type"; then
	emit_noop
	exit 0
fi

chat_id=$(echo "$hook_json" | jq -r '.session_id // ""')
cwd=$(echo "$hook_json" | jq -r '.cwd // ""')

if [ -z "$chat_id" ] || [ -z "$cwd" ]; then
	emit_noop
	exit 0
fi

# shellcheck source=../lib/detect-pm.sh
. "$(dirname "$0")/../lib/detect-pm.sh"
pm_exec=$(detect_pm_exec "$cwd")

# Close the subagent's agents.ended_at by pairing with the oldest state
# file that matches this agent_type. SubagentStart writes one
# ~/.claude/session-env/${chat_id}/active-subagents/<ts>-<pid>.json per
# dispatch; oldest-stop-pairs-with-oldest-start (approximate for
# concurrent same-type dispatches, exact for sequential ones).
state_dir="$HOME/.claude/session-env/$chat_id/active-subagents"
state_file=""
if [ -d "$state_dir" ]; then
	# grep -rl finds all files that contain the agentType JSON value,
	# xargs ls -tr sorts by mtime ascending, head -1 takes the oldest.
	# The `|| true` guards against SIGPIPE from head -1 closing the pipe
	# before grep/xargs finish writing (which pipefail would otherwise
	# surface as a non-zero exit code).
	# shellcheck disable=SC2012
	state_file=$(
		grep -rl "\"agentType\":\"$agent_type\"" "$state_dir" 2>/dev/null \
			| xargs -r ls -tr 2>/dev/null \
			| head -1 \
			|| true
	)
fi
if [ -n "$state_file" ] && [ -f "$state_file" ]; then
	subagent_agent_id=$(jq -r '.agentId // empty' < "$state_file")
	if [ -n "$subagent_agent_id" ]; then
		ended_at_unix=$(date -u +%s)
		# shellcheck disable=SC2086
		_end_err=$(mktemp)
		# shellcheck disable=SC2086
		if ! (cd "$cwd" && $pm_exec vitest-agent agent end-agent \
			--agent-id "$subagent_agent_id" \
			--ended-at "$ended_at_unix" \
			--cwd "$cwd" >/dev/null 2>"$_end_err"); then
			hook_error "$_HOOK" "end-agent (subagent) agent=$subagent_agent_id: $(cat "$_end_err")"
		fi
		rm -f "$_end_err"
		hook_debug "$_HOOK" "end-agent (subagent): ok agent=$subagent_agent_id"
	fi
	rm -f "$state_file"
fi

# Generate the handoff message using the wrapup CLI in tdd_handoff mode.
handoff=$(cd "$cwd" && $pm_exec vitest-agent agent wrapup \
	--chat-id "$chat_id" \
	--kind tdd_handoff \
	--format markdown 2>/dev/null || echo "")

# The parent agent's next Stop hook injects from notes; we don't
# write directly to additionalContext here because SubagentStop
# lifecycle isn't an injection point (per spec W5).
if [ -n "$handoff" ]; then
	# Attempt to record the handoff as a turn (note type) on the parent session.
	parent_cc=$(echo "$hook_json" | jq -r '.parent_session_id // ""')
	if [ -n "$parent_cc" ]; then
		payload=$(jq -nc --arg c "$handoff" '{type: "note", scope: "tdd_handoff", content: $c}')
		cd "$cwd" >/dev/null && $pm_exec vitest-agent agent record turn \
			--chat-id "$parent_cc" \
			"$payload" \
			>/dev/null 2>&1 \
			|| true
	fi
fi

emit_noop
exit 0
