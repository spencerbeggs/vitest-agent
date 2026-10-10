#!/usr/bin/env bats
# tdd-artifact-bats.bats — post-tool-use/tdd-artifact.sh recognizes bats runs
# (issue #360) and marks them `--suite bats` (issue #363), on both targets.

load common

HOOK=hooks/post-tool-use/tdd-artifact.sh

setup() {
	va_stub_cli '"agent record test-case-turns"*) printf '\''{"updated":0,"latestTestCaseId":null}\n'\'' ;;'
}

_artifact_argv() { grep '^agent record tdd-artifact' "$VA_CAPTURE" | tail -n1 || true; }

_run() {
	va_argv_reset
	va_hook "$1" "$HOOK" "$(va_fx "$2")"
	assert_hook_noop
}

@test "bare 'bats <path>' with exit 1 records test_failed_run, --suite bats, no --test-case-id" {
	for t in "${VA_TARGETS[@]}"; do
		_run "$t" post-tool-use-bash-bats-fail.json
		[[ "$(_artifact_argv)" == *"--artifact-kind test_failed_run"* ]]
		[[ "$(_artifact_argv)" == *"--suite bats"* ]]
		[[ "$(_artifact_argv)" != *"--test-case-id"* ]]
	done
}

@test "'pnpm run test:bats' with exit 0 records test_passed_run, --suite bats, no --test-case-id" {
	for t in "${VA_TARGETS[@]}"; do
		_run "$t" post-tool-use-bash-test-bats-pass.json
		[[ "$(_artifact_argv)" == *"--artifact-kind test_passed_run"* ]]
		[[ "$(_artifact_argv)" == *"--suite bats"* ]]
		[[ "$(_artifact_argv)" != *"--test-case-id"* ]]
	done
}

@test "'bats --version' and 'pnpm run build' record no artifact" {
	for t in "${VA_TARGETS[@]}"; do
		_run "$t" post-tool-use-bash-bats-version.json
		[ -z "$(_artifact_argv)" ]
		_run "$t" post-tool-use-bash-build.json
		[ -z "$(_artifact_argv)" ]
	done
}

@test "a vitest Bash invocation records no --suite flag (defaults to vitest)" {
	local fx
	fx=$(va_fx post-tool-use-bash-vitest.json '{"agent_type":"vitest-agent:tdd-task"}')
	for t in "${VA_TARGETS[@]}"; do
		va_argv_reset
		va_hook "$t" "$HOOK" "$fx"
		[[ "$(_artifact_argv)" == *"--artifact-kind test_passed_run"* ]]
		[[ "$(_artifact_argv)" != *"--suite"* ]]
	done
}

@test "the latest test case id is forwarded when the CLI reports one" {
	local fx
	va_stub_cli '"agent record test-case-turns"*) printf '\''{"updated":1,"latestTestCaseId":17}\n'\'' ;;'
	fx=$(va_fx post-tool-use-bash-vitest.json '{"agent_type":"vitest-agent:tdd-task"}')
	for t in "${VA_TARGETS[@]}"; do
		va_argv_reset
		va_hook "$t" "$HOOK" "$fx"
		[[ "$(_artifact_argv)" == *"--test-case-id 17"* ]]
	done
}
