#!/bin/bash
# SubagentStart hook scoped to tdd-task: capture the launch into the sessions
# table as a subagent row.
#
# The tdd-task agent's tdd_task({ action: "start" }) MCP call (issued from
# inside the subagent) writes the tdd_tasks row; this hook makes sure the
# parent sessions row exists with agent_kind='subagent' and the parent's
# session id linked, registers the subagent in the agent taxonomy, and writes a
# per-dispatch state file SubagentStop pairs against.

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
parent_chat_id=$(hook_input parent_session_id)
cwd=$(hook_input cwd)

if [ -z "$chat_id" ] || [ -z "$cwd" ]; then
	hook_noop
	exit 0
fi

# Claude Code reuses the parent's chat_id for subagent tool calls when
# context:fork is active, so the parent's session row already exists. Mint a
# synthetic per-dispatch key by appending a timestamp+PID suffix. Artifacts
# still resolve via the real chat_id (written by PostToolUse hooks), but this
# row lets session_list(agentKind:'subagent') confirm the dispatch fired.
subagent_session_key="${chat_id}-subagent-$(date +%s)-$$"

cli=$(va_cli "$cwd") || {
	hook_noop
	exit 0
}

project=$(va_project_name "$cwd")
started_at=$(va_now)

hook_debug "session_id=$chat_id parent=$parent_chat_id synthetic_key=$subagent_session_key cwd=$cwd cli=$cli"

# Ensure the parent main row exists before the subagent row references it.
# SessionStart usually creates this row, but Claude Code can rotate `chat_id`
# mid-window (continuation, compaction, /mcp reconnect) without re-firing
# SessionStart for the new id. `record session-start` is idempotent on
# `chat_id` (UPSERT via ON CONFLICT DO NOTHING): no-op when the row already
# exists, bootstrap when it does not.
_parent_err=$(mktemp)
_parent_out=$(cd "$cwd" && $cli agent record session-start \
	--chat-id "$chat_id" \
	--project "$project" \
	--cwd "$cwd" \
	--agent-kind main \
	--started-at "$started_at" 2>"$_parent_err") || {
	_rc=$?
	hook_log "record session-start (parent bootstrap) rc=$_rc cc=$chat_id: $(cat "$_parent_err")"
}
rm -f "$_parent_err"
hook_debug "record session-start (parent bootstrap): $_parent_out"

# Always link the subagent row to the parent main row via the orchestrator's
# chat_id. Earlier code conditioned on `parent_chat_id` from the hook payload,
# but Claude Code does not reliably populate that field for context:fork
# dispatches, leaving the subagent row orphaned and breaking the parent walk
# that `record-tdd-artifact` uses to find the open tdd_task.
_session_err=$(mktemp)
_session_out=$(cd "$cwd" && $cli agent record session-start \
	--chat-id "$subagent_session_key" \
	--project "$project" \
	--cwd "$cwd" \
	--agent-kind subagent \
	--agent-type tdd-task \
	--parent-chat-id "$chat_id" \
	--started-at "$started_at" 2>"$_session_err") || {
	_rc=$?
	hook_log "record session-start rc=$_rc synthetic_key=$subagent_session_key: $(cat "$_session_err")"
}
rm -f "$_session_err"
hook_debug "record session-start: $_session_out"

# Register the subagent in the agent-taxonomy stores, wiring parent_agent_id
# to the main agent SessionStart recorded in the session env.
subagent_agent_id=""
if [ -n "${VITEST_AGENT_MAIN_AGENT_ID:-}" ]; then
	transcript_path=$(hook_input transcript_path)
	# When the subagent shares the parent's transcript (context:fork without a
	# separate transcript file), fall back to a synthetic transcript path so the
	# conversation_map row is keyed on the subagent's per-dispatch identity
	# instead of the parent's.
	if [ -z "$transcript_path" ]; then
		transcript_path="/synthetic/${subagent_session_key}.jsonl"
	fi
	# Capture stderr separately (not 2>&1): pnpm's stderr notices would
	# otherwise corrupt the JSON jq parses below and zero out the agentId.
	_register_err=$(mktemp)
	_register_out=$(cd "$cwd" && $cli agent register-agent \
		--host-kind claude-code \
		--agent-type claude-code-tdd-task \
		--host-session-id "$subagent_session_key" \
		--transcript-path "$transcript_path" \
		--cwd "$cwd" \
		--parent-agent-id "$VITEST_AGENT_MAIN_AGENT_ID" 2>"$_register_err") || {
		_rc=$?
		hook_log "register-agent (subagent) rc=$_rc key=$subagent_session_key parent=$VITEST_AGENT_MAIN_AGENT_ID: $(cat "$_register_err")"
		_register_out=""
	}
	rm -f "$_register_err"
	if [ -n "$_register_out" ]; then
		subagent_agent_id=$(printf '%s' "$_register_out" | jq -r '.agentId // ""' 2>/dev/null || echo "")
		hook_debug "subagent registered: agentId=$subagent_agent_id parent=$VITEST_AGENT_MAIN_AGENT_ID"
	fi
fi

# Write the per-dispatch state file so SubagentStop can call end-agent. It
# lives in the plugin's data directory, one subdirectory per chat_id; the file
# name is the synthetic key AFTER the "${chat_id}-subagent-" prefix, so the
# directory stays scannable by mtime.
if [ -n "$subagent_agent_id" ]; then
	case "$chat_id" in
	*/* | *..* | .) ;;
	*)
		state_dir="$(va_state_dir)/active-subagents/$chat_id"
		if mkdir -p "$state_dir" 2>/dev/null; then
			state_file="${state_dir}/${subagent_session_key#"${chat_id}-subagent-"}.json"
			jq -cn \
				--arg agentId "$subagent_agent_id" \
				--arg agentType "$agent_type" \
				--arg syntheticKey "$subagent_session_key" \
				--arg startedAt "$started_at" \
				'{ agentId: $agentId, agentType: $agentType, syntheticKey: $syntheticKey, startedAt: $startedAt }' \
				>"$state_file"
			hook_debug "wrote state file: $state_file agentId=$subagent_agent_id"
		else
			hook_log "cannot create $state_dir"
		fi
		;;
	esac
fi

hook_noop
