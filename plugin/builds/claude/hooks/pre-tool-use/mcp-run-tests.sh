#!/bin/bash
# PreToolUse hook for the MCP `run_tests` tool: inject the active agent
# attribution context into the tool input so the in-process Vitest reporter can
# attribute the run.
#
# Background. The MCP server child does NOT see the session's VITEST_AGENT_*
# values (verified empirically — `ps eww` shows none of them in the MCP process
# env). Tools therefore cannot read them from process.env. This hook reads them
# from the plugin's session env (SessionStart set them) and forwards them as
# `tool_input._sessionContext`. The MCP `run_tests` handler reads
# `input._sessionContext` first, falling back to its boot-time
# SessionContextRef.
#
# The replacement input REPLACES the entire input object, so it carries every
# original field plus the `_sessionContext` block.

set -euo pipefail

. "$(dirname "$0")/../lib/pluginfinity/hook.sh"
. "$(dirname "$0")/../lib/vitest-agent/common.sh"
hook_require_input

op=$(va_mcp_op "$(hook_input tool_name)") || op=""
if [ "$op" != "run_tests" ]; then
	hook_noop
	exit 0
fi

va_chat_id="${VITEST_AGENT_CHAT_ID:-}"
va_conversation_id="${VITEST_AGENT_CONVERSATION_ID:-}"
va_main_agent_id="${VITEST_AGENT_MAIN_AGENT_ID:-${VITEST_AGENT_AGENT_ID:-}}"

if [ -z "$va_chat_id" ] || [ -z "$va_conversation_id" ] || [ -z "$va_main_agent_id" ]; then
	# Nothing to inject — pass through.
	hook_debug "no session context available; pass-through"
	hook_noop
	exit 0
fi

hook_debug "injecting _sessionContext for chat=$va_chat_id"

tool_input=$(hook_input tool_input)
[ -n "$tool_input" ] || tool_input='{}'
updated=$(jq -c \
	--arg cid_chat "$va_chat_id" \
	--arg cid "$va_conversation_id" \
	--arg aid "$va_main_agent_id" \
	'(if type == "object" then . else {} end) + {
		_sessionContext: {
			chatId: $cid_chat,
			conversationId: $cid,
			mainAgentId: $aid
		}
	}' <<<"$tool_input")
hook_allow "" "$updated"
