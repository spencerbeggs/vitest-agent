#!/usr/bin/env bats
# sidecar-prefilter.bats — Layer 0 (bash regex prefilter) and Layer 1
# (main-agent identity skip) in hooks/pre-tool-use/bash.sh, on both targets.
#
# Layer 0 answers with a no-op — never touching the sidecar — when the command
# cannot possibly invoke Vitest. Layer 1 answers with a no-op when the current
# agent IS the main agent (the session's ids match). The fake `vitest-agent`
# records its argv; an empty capture means the sidecar was never reached.
#
# The identity comes from the plugin's session env, seeded per test with
# --session-env; run_hook's env -i keeps the ambient VITEST_AGENT_* of a
# developer running the suite inside an agent session out of the hook.

load common

HOOK=hooks/pre-tool-use/bash.sh

setup() {
	va_stub_cli
}

_run() {
	local t=$1 cmd=$2
	shift 2
	va_hook "$t" "$HOOK" "$(va_fx pre-tool-use-bash.json "$(jq -nc --arg c "$cmd" '{tool_input: {command: $c, description: "bats", timeout: 120000, run_in_background: false}}')")" "$@"
}

_assert_skipped() {
	assert_hook_noop
	[ "$(va_argv_count)" -eq 0 ]
}

_assert_reached() {
	[ "$(va_argv_count)" -ge 1 ]
	[[ "$(va_argv_nth 1)" == "agent inject-env"* ]]
}

# --- Layer 0: commands that cannot run Vitest skip the sidecar --------------

@test "Layer 0: non-test commands answer with a no-op and never call the sidecar" {
	local cmd
	for t in "${VA_TARGETS[@]}"; do
		for cmd in 'ls' 'git status' 'echo hello' 'pnpm run testing'; do
			va_argv_reset
			_run "$t" "$cmd"
			_assert_skipped
		done
	done
}

# --- Layer 0: Vitest-shaped commands reach the sidecar ----------------------

@test "Layer 0: Vitest-shaped commands reach the sidecar" {
	local cmd
	for t in "${VA_TARGETS[@]}"; do
		for cmd in 'vitest' 'vitest run' 'pnpm test' 'npm run test:int' 'node node_modules/.bin/vitest' \
			'pnpm exec vitest --watch' 'pnpm run test-unit' 'npm run test-e2e' 'yarn test-watch' 'echo vitest'; do
			va_argv_reset
			_run "$t" "$cmd"
			assert_hook_exit 0
			_assert_reached
		done
	done
}

# --- Layer 1 ----------------------------------------------------------------

@test "Layer 1: AGENT_ID == MAIN_AGENT_ID answers with a no-op and skips the sidecar" {
	local seed
	seed=$(va_session_env VITEST_AGENT_AGENT_ID=uuid-main-0001 VITEST_AGENT_MAIN_AGENT_ID=uuid-main-0001)
	for t in "${VA_TARGETS[@]}"; do
		va_argv_reset
		_run "$t" "vitest run" --session-env "$seed"
		_assert_skipped
	done
}

@test "Layer 1: AGENT_ID != MAIN_AGENT_ID falls through and calls the sidecar" {
	local seed
	seed=$(va_session_env VITEST_AGENT_AGENT_ID=uuid-subagent-0001 VITEST_AGENT_MAIN_AGENT_ID=uuid-main-0001)
	for t in "${VA_TARGETS[@]}"; do
		va_argv_reset
		_run "$t" "vitest run" --session-env "$seed"
		_assert_reached
	done
}

@test "Layer 1: a partial identity falls through to the sidecar" {
	local only_agent only_main
	only_agent=$(va_session_env VITEST_AGENT_AGENT_ID=uuid-only-agent)
	only_main=$(va_session_env VITEST_AGENT_MAIN_AGENT_ID=uuid-only-main)
	for t in "${VA_TARGETS[@]}"; do
		va_argv_reset
		_run "$t" "vitest run" --session-env "$only_agent"
		_assert_reached
		va_argv_reset
		_run "$t" "vitest run" --session-env "$only_main"
		_assert_reached
	done
}

@test "Layer 1: no session identity at all falls through to the sidecar" {
	for t in "${VA_TARGETS[@]}"; do
		va_argv_reset
		_run "$t" "vitest run"
		_assert_reached
	done
}

@test "an empty session identity reaches the CLI as unset, not as empty" {
	va_stub_cli '*inject-env*) env | grep "^VITEST_AGENT_" | sort >> '"'$BATS_TEST_TMPDIR/env-seen'"' ;;'
	for t in "${VA_TARGETS[@]}"; do
		: >"$BATS_TEST_TMPDIR/env-seen"
		_run "$t" "vitest run"
		run grep -cE '^VITEST_AGENT_(AGENT_ID|CONVERSATION_ID|CHAT_ID|MAIN_AGENT_ID|SIDECAR_BIN)=' "$BATS_TEST_TMPDIR/env-seen"
		[ "$output" = 0 ]
		grep -q "^VITEST_AGENT_PROJECT_DIR=$(va_project)\$" "$BATS_TEST_TMPDIR/env-seen"
	done
}
