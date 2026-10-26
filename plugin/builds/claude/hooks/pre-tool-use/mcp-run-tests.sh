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
# original field plus the injected `_sessionContext` and `_callerCwd` (#275).

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

# Issue #275: the payload `.cwd` is the INVOKING agent's working directory (a
# worktree-isolated subagent reports its own worktree). Forward it as
# `_callerCwd` so the server can tell a wrong-worktree call from a right one.
# It is injected independently of `_sessionContext`: either may be present
# without the other, and an absent value means "cannot tell" to the server.
va_caller_cwd=$(hook_input cwd)

have_session=1
if [ -z "$va_chat_id" ] || [ -z "$va_conversation_id" ] || [ -z "$va_main_agent_id" ]; then
	have_session=0
fi

if [ "$have_session" -eq 0 ] && [ -z "$va_caller_cwd" ]; then
	# Nothing to inject — pass through.
	hook_debug "no session context or caller cwd available; pass-through"
	hook_noop
	exit 0
fi

hook_debug "injecting run_tests context (session=$have_session cwd=$va_caller_cwd)"

tool_input=$(hook_input tool_input)
[ -n "$tool_input" ] || tool_input='{}'
updated=$(jq -c \
	--argjson have_session "$have_session" \
	--arg cid_chat "$va_chat_id" \
	--arg cid "$va_conversation_id" \
	--arg aid "$va_main_agent_id" \
	--arg cwd "$va_caller_cwd" \
	'(if type == "object" then . else {} end)
	+ (if $have_session == 1 then {
		_sessionContext: {
			chatId: $cid_chat,
			conversationId: $cid,
			mainAgentId: $aid
		}
	} else {} end)
	+ (if $cwd != "" then {_callerCwd: $cwd} else {} end)' <<<"$tool_input")
hook_allow "" "$updated"
