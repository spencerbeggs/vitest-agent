#!/usr/bin/env bats
# test-location.bats — the invalid-test-location PreToolUse hook
# (hooks/pre-tool-use/test-location.sh), on both targets.
#
# The hook must be silent for anything that is not a discoverable test file,
# must deny only the creation of a new test at an invalid path, and must fail
# open on every error path. The fail-open cases are the load-bearing ones: a
# detector that cannot reason must never block work.

load common

HOOK=hooks/pre-tool-use/test-location.sh
INVALID='{"verdict":"invalid","workspace":"w","suggestedPath":"/repo/__test__/a.test.ts"}'

# _stub <stdout> [exit]: a fake CLI that prints <stdout> for check-test-path.
_stub() {
	va_stub_cli "*check-test-path*) printf '%s\n' '$1'; exit ${2:-0} ;;"
}

# _run <target> <tool_name> <tool_input-json> [VAR=value...]
_run() {
	local t=$1 tool=$2 input=$3
	shift 3
	va_hook "$t" "$HOOK" "$(hook_fixture PreToolUse "$(jq -nc --arg n "$tool" --argjson i "$input" '{tool_name: $n, tool_input: $i}')")" "$@"
}

@test "is silent for a file that is not a test file" {
	_stub "$INVALID"
	for t in "${VA_TARGETS[@]}"; do
		_run "$t" Write '{"file_path":"/repo/src/index.ts"}'
		assert_hook_noop
		[ "$(va_argv_count)" -eq 0 ]
	done
}

@test "is silent for an unmatched tool" {
	_stub "$INVALID"
	for t in "${VA_TARGETS[@]}"; do
		_run "$t" Bash '{"command":"ls"}'
		assert_hook_noop
	done
}

@test "is silent for a valid location and for a deliberately excluded fixture test" {
	for t in "${VA_TARGETS[@]}"; do
		_stub '{"verdict":"valid","workspace":"w","suggestedPath":null}'
		_run "$t" Write '{"file_path":"/repo/__test__/a.test.ts"}'
		assert_hook_noop
		_stub '{"verdict":"excluded","workspace":"w","suggestedPath":null}'
		_run "$t" Write '{"file_path":"/repo/__test__/fixtures/a.test.ts"}'
		assert_hook_noop
	done
}

@test "denies creating a new test at an invalid location, naming the layout and the opt-out" {
	_stub "$INVALID"
	for t in "${VA_TARGETS[@]}"; do
		_run "$t" Write '{"file_path":"/repo/lib/scripts/__test__/a.test.ts","content":""}'
		[ "$(va_decision "$t")" = deny ]
		[[ "$(va_reason "$t")" == *"default discovery layout"* ]]
		[[ "$(va_reason "$t")" == *"VITEST_AGENT_TEST_LOCATION_HOOK=off"* ]]
		[[ "$(va_reason "$t")" == *"/repo/__test__/a.test.ts"* ]]
	done
}

@test "advises rather than denies for an existing misplaced test (context on Claude Code; Copilot has no PreToolUse context)" {
	local existing
	existing="$(va_project)/lib/a.test.ts"
	mkdir -p "$(dirname "$existing")"
	touch "$existing"
	_stub "$INVALID"
	for tool in Write Edit MultiEdit Read; do
		_run claude "$tool" "$(jq -nc --arg p "$existing" '{file_path: $p}')"
		[ "$(va_decision claude)" = none ]
		[[ "$(va_context claude)" == *"default discovery layout"* ]]
		_run copilot "$tool" "$(jq -nc --arg p "$existing" '{file_path: $p}')"
		assert_hook_noop
	done
}

@test "advises on Read of a misplaced test that does not exist on disk" {
	_stub "$INVALID"
	_run claude Read '{"file_path":"/repo/lib/missing.test.ts"}'
	[ "$(va_decision claude)" = none ]
	[[ "$(va_context claude)" == *"never runs"* ]]
}

@test "reads Copilot's own tool_input key for the path" {
	_stub "$INVALID"
	for t in "${VA_TARGETS[@]}"; do
		_run "$t" Write '{"path":"/repo/lib/scripts/__test__/b.test.ts","file_text":""}'
		[ "$(va_decision "$t")" = deny ]
	done
}

@test "fails open when the CLI exits non-zero or prints garbage" {
	for t in "${VA_TARGETS[@]}"; do
		_stub '' 1
		_run "$t" Write '{"file_path":"/repo/lib/a.test.ts"}'
		assert_hook_noop
		_stub 'not json'
		_run "$t" Write '{"file_path":"/repo/lib/a.test.ts"}'
		assert_hook_noop
	done
}

# The production resolution branch: no override, no local bin, nothing on
# PATH — va_cli fails and the hook must fail open. This branch has crashed
# before under set -u, so drive it for real, with debug logging on too.
@test "fails open when the CLI cannot be resolved at all" {
	local bare="$BATS_TEST_TMPDIR/bare-bin" tool
	mkdir -p "$bare"
	for tool in bash jq cat mktemp rm date mkdir basename dirname grep sed env head sort tr wc; do
		ln -sf "$(command -v "$tool")" "$bare/$tool"
	done
	for t in "${VA_TARGETS[@]}"; do
		run_hook "$t" "$HOOK" "$(hook_fixture PreToolUse '{"tool_name":"Write","tool_input":{"file_path":"/repo/lib/a.test.ts"}}')" \
			PATH="$bare" PLUGINFINITY_DEBUG=1
		assert_hook_noop
	done
}

@test "is silent when file_path is missing" {
	_stub "$INVALID"
	for t in "${VA_TARGETS[@]}"; do
		_run "$t" Write '{}'
		assert_hook_noop
	done
}

@test "opts out via VITEST_AGENT_TEST_LOCATION_HOOK=off|0|false without invoking the CLI" {
	local v
	_stub "$INVALID"
	for t in "${VA_TARGETS[@]}"; do
		for v in off 0 false; do
			va_argv_reset
			_run "$t" Write '{"file_path":"/repo/lib/scripts/__test__/a.test.ts"}' VITEST_AGENT_TEST_LOCATION_HOOK="$v"
			assert_hook_noop
			[ "$(va_argv_count)" -eq 0 ]
		done
	done
}

@test "does not opt out for an unrecognized VITEST_AGENT_TEST_LOCATION_HOOK value" {
	_stub "$INVALID"
	for t in "${VA_TARGETS[@]}"; do
		_run "$t" Write '{"file_path":"/repo/lib/scripts/__test__/a.test.ts"}' VITEST_AGENT_TEST_LOCATION_HOOK=nope
		[ "$(va_decision "$t")" = deny ]
	done
}
