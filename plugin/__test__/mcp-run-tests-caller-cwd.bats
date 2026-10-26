#!/usr/bin/env bats
# mcp-run-tests-caller-cwd.bats — hooks/pre-tool-use/mcp-run-tests.sh injects
# the invoking agent's cwd as tool_input._callerCwd (issue #275), independently
# of the _sessionContext attribution block. Absence of either is a pass-through,
# never a refusal: the MCP server reads a missing _callerCwd as "cannot tell".

load common

HOOK=hooks/pre-tool-use/mcp-run-tests.sh
TOOL=mcp__plugin_vitest-agent_mcp__run_tests

setup() {
	va_stub_cli
}

# _fx <payload-json-extras>: a PreToolUse run_tests payload merged with extras.
_fx() {
	hook_fixture PreToolUse "$(jq -nc --arg t "$TOOL" --argjson e "$1" \
		'{session_id: "test-session-id-bats-001", tool_name: $t, tool_input: {project: "p"}} + $e')"
}

_session() {
	printf '%s\n' VITEST_AGENT_CHAT_ID=chat VITEST_AGENT_CONVERSATION_ID=conv VITEST_AGENT_MAIN_AGENT_ID=main
}

@test "_callerCwd is injected from the payload cwd alongside _sessionContext" {
	for t in "${VA_TARGETS[@]}"; do
		va_hook "$t" "$HOOK" "$(_fx '{"cwd":"/work/tree-a"}')" $(_session)
		assert_hook_exit 0
		[ "$(va_updated_input "$t" | jq -r ._callerCwd)" = /work/tree-a ]
		[ "$(va_updated_input "$t" | jq -r ._sessionContext.chatId)" = chat ]
		[ "$(va_updated_input "$t" | jq -r .project)" = p ]
	done
}

@test "_callerCwd is injected alone when the session values are absent" {
	for t in "${VA_TARGETS[@]}"; do
		va_hook "$t" "$HOOK" "$(_fx '{"cwd":"/work/tree-a"}')"
		assert_hook_exit 0
		[ "$(va_updated_input "$t" | jq -r ._callerCwd)" = /work/tree-a ]
		[ "$(va_updated_input "$t" | jq -c 'has("_sessionContext")')" = false ]
		[ "$(va_updated_input "$t" | jq -r .project)" = p ]
	done
}

@test "_sessionContext is injected alone when the payload carries no cwd" {
	for t in "${VA_TARGETS[@]}"; do
		va_hook "$t" "$HOOK" "$(_fx '{"cwd":""}')" $(_session)
		assert_hook_exit 0
		[ "$(va_updated_input "$t" | jq -c 'has("_callerCwd")')" = false ]
		[ "$(va_updated_input "$t" | jq -r ._sessionContext.chatId)" = chat ]
	done
}

@test "the hook is a pure no-op when neither cwd nor session values are available" {
	for t in "${VA_TARGETS[@]}"; do
		va_hook "$t" "$HOOK" "$(_fx '{"cwd":""}')"
		assert_hook_noop
	done
}
