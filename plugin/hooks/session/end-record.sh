#!/bin/bash
# SessionEnd hook: record + inject full wrap-up prompt.
#
# Per spec W5: agent reviews touched tests/files, records insights via
# note_create, marks hypotheses validated/invalidated, updates
# tdd_tasks.outcome. Wrap-up content from formatWrapupEffect via
# the wrapup CLI.

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

# shellcheck source=../lib/detect-pm.sh
. "$(dirname "$0")/../lib/detect-pm.sh"
pm_exec=$(detect_pm_exec "$cwd")

ended_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# 1. Record a hook_fire turn so acceptance_metrics can track SessionEnd events.
fire_payload=$(jq -nc --arg cc "$chat_id" \
	'{type: "hook_fire", hook_kind: "SessionEnd", chat_id: $cc}')
_fire_out=$(cd "$cwd" && $pm_exec vitest-agent record turn \
	--chat-id "$chat_id" \
	"$fire_payload" 2>&1) || {
	hook_error "$_HOOK" "record turn hook_fire rc=$? cc=$chat_id: $_fire_out"
}
hook_debug "$_HOOK" "record turn hook_fire: $_fire_out"

# 2. Record the session end.
if [ -n "$reason" ]; then
	cd "$cwd" >/dev/null && $pm_exec vitest-agent record session-end \
		--chat-id "$chat_id" \
		--ended-at "$ended_at" \
		--end-reason "$reason" \
		>/dev/null 2>&1 \
		|| true
else
	cd "$cwd" >/dev/null && $pm_exec vitest-agent record session-end \
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
	_end_out=$(cd "$cwd" && $pm_exec vitest-agent _internal end-agent \
		--agent-id "$VITEST_AGENT_MAIN_AGENT_ID" \
		--host-session-id "$chat_id" \
		--ended-at "$ended_at_unix" \
		--cwd "$cwd" 2>&1) || {
		hook_error "$_HOOK" "end-agent rc=$? cc=$chat_id agent=$VITEST_AGENT_MAIN_AGENT_ID: $_end_out"
	}
	hook_debug "$_HOOK" "end-agent: ok agent=$VITEST_AGENT_MAIN_AGENT_ID"
fi

# 3. Compute the wrap-up prompt.
wrapup=$(cd "$cwd" && $pm_exec vitest-agent wrapup \
	--chat-id "$chat_id" \
	--kind session_end \
	--format markdown 2>/dev/null || echo "")

# 4. Surface via systemMessage. Claude Code's SessionEnd envelope
# does not accept hookSpecificOutput.additionalContext — that field
# is restricted to PreToolUse / UserPromptSubmit / PostToolUse /
# PostToolBatch.
if [ -n "$wrapup" ]; then
	emit_system_message "$wrapup"
else
	emit_noop
fi

exit 0
