#!/usr/bin/env bats
# sidecar-env-warn.bats — session/start.sh parses register-agent's JSON from
# stdout only, so a package manager's stderr WARN (pnpm's dual
# packageManager/devEngines notice, printed on every invocation) can neither
# zero the canonical ids nor corrupt the resolved sidecar path. Never fold
# stderr into a jq-parsed capture (2>&1).
#
# The ids land in the plugin's session env (hook_env_set), which a later hook
# reads; on Claude Code they also reach the model's shell through
# CLAUDE_ENV_FILE, and the MCP server's recovery file
# (~/.claude/session-env/<chat_id>/vitest-agent-hook.sh) is written there.

load common

setup() {
	FAKE_SIDECAR="$BATS_TEST_TMPDIR/vitest-agent-sidecar-fake"
	printf '#!/bin/bash\nexit 0\n' >"$FAKE_SIDECAR"
	chmod +x "$FAKE_SIDECAR"
	va_stub_cli "*register-agent*) echo '[WARN] Cannot use both \"packageManager\" and \"devEngines.packageManager\" in package.json. \"packageManager\" will be ignored' >&2
		printf '{\"agentId\":\"bats-agent-uuid\",\"conversationId\":\"bats-conv-uuid\",\"mainAgentId\":\"bats-main-uuid\"}\n' ;;
	*sidecar-path*) echo '[WARN] noise' >&2
		printf '%s\n' '$FAKE_SIDECAR' ;;"
	CLAUDE_ENV="$BATS_TEST_TMPDIR/claude-env.sh"
	: >"$CLAUDE_ENV"
}

_start() {
	va_hook "$1" hooks/session/start.sh "$(va_fx session-start.json)" CLAUDE_ENV_FILE="$CLAUDE_ENV"
}

# The session env values file pluginfinity's library keeps for the fixture's
# session.
_values() { cat "$BATS_TEST_TMPDIR/state/pluginfinity/vitest-agent/session/test-session-id-bats-001/env"; }

@test "the canonical ids reach the session env despite pnpm's stderr WARN" {
	for t in "${VA_TARGETS[@]}"; do
		_start "$t"
		assert_hook_exit 0
		_values | grep -qx 'VITEST_AGENT_CHAT_ID=test-session-id-bats-001'
		_values | grep -qx 'VITEST_AGENT_CONVERSATION_ID=bats-conv-uuid'
		_values | grep -qx 'VITEST_AGENT_MAIN_AGENT_ID=bats-main-uuid'
		_values | grep -qx 'VITEST_AGENT_AGENT_ID=bats-main-uuid'
		run grep -c WARN "$BATS_TEST_TMPDIR/state/pluginfinity/vitest-agent/session/test-session-id-bats-001/env"
		[ "$output" -eq 0 ]
	done
}

@test "the resolved sidecar path reaches the session env despite the WARN" {
	for t in "${VA_TARGETS[@]}"; do
		_start "$t"
		_values | grep -qx "VITEST_AGENT_SIDECAR_BIN=$FAKE_SIDECAR"
	done
}

@test "a later hook reads the ids SessionStart set" {
	for t in "${VA_TARGETS[@]}"; do
		va_stub_cli "*register-agent*) printf '{\"agentId\":\"a\",\"conversationId\":\"c\",\"mainAgentId\":\"m\"}\n' ;;"
		_start "$t"
		va_argv_reset
		va_hook "$t" hooks/pre-tool-use/mcp-run-tests.sh \
			"$(hook_fixture PreToolUse '{"session_id":"test-session-id-bats-001","tool_name":"mcp__plugin_vitest-agent_mcp__run_tests","tool_input":{"project":"p"}}')"
		[ "$(va_updated_input "$t" | jq -c ._sessionContext)" = '{"chatId":"test-session-id-bats-001","conversationId":"c","mainAgentId":"m"}' ]
		[ "$(va_updated_input "$t" | jq -r .project)" = p ]
	done
}

@test "on Copilot a bare mcp-run_tests from another server is not rewritten" {
	va_stub_cli "*register-agent*) printf '{\"agentId\":\"a\",\"conversationId\":\"c\",\"mainAgentId\":\"m\"}\n' ;;"
	_start copilot
	va_hook copilot hooks/pre-tool-use/mcp-run-tests.sh \
		"$(hook_fixture PreToolUse '{"session_id":"test-session-id-bats-001","tool_name":"mcp-run_tests","tool_input":{"project":"p"}}')"
	assert_hook_noop
}

@test "on Claude Code the ids also reach the model's shell and the MCP server's recovery file" {
	local recovery="$BATS_TEST_TMPDIR/home/.claude/session-env/test-session-id-bats-001/vitest-agent-hook.sh"
	_start claude
	grep -qx "export VITEST_AGENT_AGENT_ID='bats-main-uuid'" "$CLAUDE_ENV"
	grep -qx "export VITEST_AGENT_SIDECAR_BIN='$FAKE_SIDECAR'" "$CLAUDE_ENV"
	[ -f "$recovery" ]
	grep -qx 'export VITEST_AGENT_CONVERSATION_ID=bats-conv-uuid' "$recovery"
	grep -qx "export VITEST_AGENT_PROJECT_DIR=$(va_project)" "$recovery"
	run grep -c WARN "$recovery"
	[ "$output" -eq 0 ]
}

@test "on Copilot no MCP recovery file is written: its server cannot learn the project" {
	_start copilot
	[ ! -e "$BATS_TEST_TMPDIR/home/.claude/session-env/test-session-id-bats-001" ]
}

@test "no transcript path means no registration and no ids" {
	for t in "${VA_TARGETS[@]}"; do
		va_argv_reset
		va_hook "$t" hooks/session/start.sh "$(va_fx session-start.json '{"session_id":"no-transcript","transcript_path":""}')"
		assert_hook_exit 0
		[ -z "$(va_argv_grep 'agent register-agent')" ]
		[[ "$(va_context "$t")" == *"<vitest_agent_reporter>"* ]]
	done
}
