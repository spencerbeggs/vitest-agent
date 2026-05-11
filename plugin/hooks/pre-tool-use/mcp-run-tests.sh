#!/bin/bash
# PreToolUse hook for the MCP `run_tests` tool: inject the active agent
# attribution context into the tool input so the in-process Vitest
# reporter can attribute the run.
#
# Background. The MCP server child does NOT auto-source CLAUDE_ENV_FILE
# (verified empirically — `ps eww` shows neither VITEST_AGENT_* nor
# CLAUDE_ENV_FILE in the MCP process env, contradicting earlier
# documentation). Tools therefore cannot read VITEST_AGENT_* directly
# from process.env. We work around this by sourcing the per-session
# env-files dir from the hook (which DOES inherit CLAUDE_PLUGIN_ROOT
# but still misses CLAUDE_ENV_FILE auto-source) and forwarding the
# values into `tool_input._sessionContext`. The MCP `run_tests`
# handler reads from `input._sessionContext` first, falling back to
# its boot-time SessionContextRef.
#
# Hook returns a `hookSpecificOutput.updatedInput` that REPLACES the
# entire input object — preserves all original fields and adds the
# `_sessionContext` block.

set -euo pipefail

# shellcheck source=../lib/hook-output.sh
. "$(dirname "$0")/../lib/hook-output.sh"
# shellcheck source=../lib/hook-debug.sh
. "$(dirname "$0")/../lib/hook-debug.sh"

_HOOK="pre-tool-use-mcp-run-tests"

hook_json=$(cat)

session_id=$(jq -r '.session_id // ""' <<< "$hook_json")
tool_input=$(jq -c '.tool_input // {}' <<< "$hook_json")

# Self-source the session-env dir to pull in SessionStart-written
# exports (VITEST_AGENT_CHAT_ID, _CONVERSATION_ID, _MAIN_AGENT_ID,
# _AGENT_ID). Hook subprocesses do NOT get auto-source per the docs.
# shellcheck source=../lib/source-session-env.sh
. "$(dirname "$0")/../lib/source-session-env.sh"
if [ -n "$session_id" ]; then
	source_session_env "$session_id"
fi

va_chat_id="${VITEST_AGENT_CHAT_ID:-}"
va_conversation_id="${VITEST_AGENT_CONVERSATION_ID:-}"
va_main_agent_id="${VITEST_AGENT_MAIN_AGENT_ID:-${VITEST_AGENT_AGENT_ID:-}}"

if [ -z "$va_chat_id" ] || [ -z "$va_conversation_id" ] || [ -z "$va_main_agent_id" ]; then
	# Nothing to inject — pass through.
	hook_debug "$_HOOK" "no session context available; pass-through"
	emit_noop
	exit 0
fi

hook_debug "$_HOOK" "injecting _sessionContext for chat=$va_chat_id"

# updatedInput REPLACES the entire input object. Merge the original
# tool_input with the new _sessionContext block via jq's `*` operator.
jq -n \
	--argjson orig "$tool_input" \
	--arg cid_chat "$va_chat_id" \
	--arg cid "$va_conversation_id" \
	--arg aid "$va_main_agent_id" '{
		hookSpecificOutput: {
			hookEventName: "PreToolUse",
			permissionDecision: "allow",
			updatedInput: ($orig + {
				_sessionContext: {
					chatId: $cid_chat,
					conversationId: $cid,
					mainAgentId: $aid
				}
			})
		}
	}'
