#!/bin/bash
# SubagentStart hook scoped to tdd-task: capture the launch
# into the sessions table as a subagent row.
#
# The tdd-task agent's tdd_task({ action: "start" }) MCP call (issued
# from inside the subagent) will write the tdd_tasks row; this hook
# just makes sure the parent sessions row exists with
# agent_kind='subagent' and the parent's session id linked.

set -euo pipefail

# shellcheck source=../lib/hook-output.sh
. "$(dirname "$0")/../lib/hook-output.sh"
# shellcheck source=../lib/hook-debug.sh
. "$(dirname "$0")/../lib/hook-debug.sh"

_HOOK="subagent-start-tdd"

hook_json=$(cat)

agent_type=$(echo "$hook_json" | jq -r '.agent_type // ""')
# shellcheck source=../lib/match-tdd-agent.sh
. "$(dirname "$0")/../lib/match-tdd-agent.sh"
if ! is_tdd_agent "$agent_type"; then
	emit_noop
	exit 0
fi

chat_id=$(echo "$hook_json" | jq -r '.session_id // ""')
parent_chat_id=$(echo "$hook_json" | jq -r '.parent_session_id // ""')
cwd=$(echo "$hook_json" | jq -r '.cwd // ""')

if [ -z "$chat_id" ] || [ -z "$cwd" ]; then
	emit_noop
	exit 0
fi

# Claude Code reuses the parent's chat_id for subagent tool
# calls when context:fork is active, so the parent's session row
# already exists. Mint a synthetic per-dispatch key by appending a
# timestamp+PID suffix. Artifacts still resolve via the real
# chat_id (written by PostToolUse hooks), but this row lets
# session_list(agentKind:'subagent') confirm the dispatch fired.
subagent_session_key="${chat_id}-subagent-$(date +%s)-$$"

# shellcheck source=../lib/detect-pm.sh
. "$(dirname "$0")/../lib/detect-pm.sh"
pm_exec=$(detect_pm_exec "$cwd")

project=$(jq -r '.name // "unknown"' < "$cwd/package.json" 2>/dev/null || echo "unknown")
started_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

hook_debug "$_HOOK" "INPUT session_id=$chat_id parent=$parent_chat_id synthetic_key=$subagent_session_key cwd=$cwd pm_exec=$pm_exec"

# Ensure the parent main row exists before the subagent row references
# it. SessionStart usually creates this row, but Claude Code can rotate
# `chat_id` mid-window (continuation, compaction, /mcp reconnect)
# without re-firing SessionStart for the new id. `record session-start`
# is idempotent on `chat_id` (UPSERT via ON CONFLICT DO NOTHING):
# no-op when the row already exists, bootstrap when it does not.
_parent_out=$(cd "$cwd" && $pm_exec vitest-agent agent record session-start \
	--chat-id "$chat_id" \
	--project "$project" \
	--cwd "$cwd" \
	--agent-kind main \
	--started-at "$started_at" 2>&1) || {
	hook_error "$_HOOK" "record session-start (parent bootstrap) rc=$? cc=$chat_id: $_parent_out"
}
hook_debug "$_HOOK" "record session-start (parent bootstrap): $_parent_out"

# Always link the subagent row to the parent main row via the orchestrator's
# chat_id. Earlier code conditioned on `parent_chat_id` from the
# hook payload, but Claude Code does not reliably populate that field for
# context:fork dispatches, leaving the subagent row orphaned and breaking the
# parent walk that `record-tdd-artifact` uses to find the open tdd_task.
_session_out=$(cd "$cwd" && $pm_exec vitest-agent agent record session-start \
	--chat-id "$subagent_session_key" \
	--project "$project" \
	--cwd "$cwd" \
	--agent-kind subagent \
	--agent-type tdd-task \
	--parent-chat-id "$chat_id" \
	--started-at "$started_at" 2>&1) || {
	hook_error "$_HOOK" "record session-start rc=$? synthetic_key=$subagent_session_key: $_session_out"
}
hook_debug "$_HOOK" "record session-start: $_session_out"

# Register the subagent in the agent-taxonomy stores. Source the
# session-env dir to recover VITEST_AGENT_MAIN_AGENT_ID written by
# SessionStart so we can wire parent_agent_id correctly.
# shellcheck source=../lib/source-session-env.sh
. "$(dirname "$0")/../lib/source-session-env.sh"
source_session_env "$chat_id"

if [ -n "${VITEST_AGENT_MAIN_AGENT_ID:-}" ]; then
	transcript_path=$(echo "$hook_json" | jq -r '.transcript_path // ""')
	# When the subagent shares the parent's transcript (context:fork
	# without a separate transcript file), fall back to a synthetic
	# transcript path so the conversation_map row is keyed on the
	# subagent's per-dispatch identity instead of the parent's.
	if [ -z "$transcript_path" ]; then
		transcript_path="/synthetic/${subagent_session_key}.jsonl"
	fi
	# shellcheck disable=SC2086
	_register_out=$(cd "$cwd" && $pm_exec vitest-agent agent register-agent \
		--host-kind claude-code \
		--agent-type claude-code-tdd-task \
		--host-session-id "$subagent_session_key" \
		--transcript-path "$transcript_path" \
		--cwd "$cwd" \
		--parent-agent-id "$VITEST_AGENT_MAIN_AGENT_ID" 2>&1) || {
		hook_error "$_HOOK" "register-agent (subagent) rc=$? key=$subagent_session_key parent=$VITEST_AGENT_MAIN_AGENT_ID: $_register_out"
		_register_out=""
	}
	if [ -n "$_register_out" ]; then
		subagent_agent_id=$(echo "$_register_out" | jq -r '.agentId // ""' 2>/dev/null || echo "")
		hook_debug "$_HOOK" "subagent registered: agentId=$subagent_agent_id parent=$VITEST_AGENT_MAIN_AGENT_ID"
	fi
fi

# Write the per-dispatch state file so SubagentStop can call end-agent.
# The file name is the portion of the synthetic key AFTER the
# "${chat_id}-subagent-" prefix, so the dir stays scannable by mtime.
if [ -n "${subagent_agent_id:-}" ]; then
	state_dir="$HOME/.claude/session-env/$chat_id/active-subagents"
	mkdir -p "$state_dir"
	state_file="${state_dir}/${subagent_session_key#"${chat_id}-subagent-"}.json"
	jq -cn \
		--arg agentId "$subagent_agent_id" \
		--arg agentType "$agent_type" \
		--arg syntheticKey "$subagent_session_key" \
		--arg startedAt "$started_at" \
		'{ agentId: $agentId, agentType: $agentType, syntheticKey: $syntheticKey, startedAt: $startedAt }' \
		> "$state_file"
	hook_debug "$_HOOK" "wrote state file: $state_file agentId=$subagent_agent_id"
fi

emit_noop
exit 0
