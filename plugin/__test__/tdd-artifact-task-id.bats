#!/usr/bin/env bats
# tdd-artifact-task-id.bats — issue #144 escape hatch pass-through, on both
# targets.
#
# post-tool-use/tdd-artifact.sh must pass `--tdd-task-id
# $VITEST_AGENT_TDD_TASK_ID` on every `record tdd-artifact` call when that env
# var is set and non-empty, and must NOT pass the flag at all when it is unset
# or empty — the escape hatch is an explicit, deliberate opt-in per issue #245
# (walkConversation is the default path; this is the last-resort override).
# It is ambient only, never a session-env name.

load common

HOOK=hooks/post-tool-use/tdd-artifact.sh

setup() {
	va_stub_cli '"agent record test-case-turns"*) printf '\''{"updated":0,"latestTestCaseId":null}\n'\'' ;;'
	FX=$(va_fx post-tool-use-write-test.json)
}

_artifact_argv() { grep '^agent record tdd-artifact' "$VA_CAPTURE" | tail -n1 || true; }

@test "passes --tdd-task-id when VITEST_AGENT_TDD_TASK_ID is set and non-empty" {
	for t in "${VA_TARGETS[@]}"; do
		va_argv_reset
		va_hook "$t" "$HOOK" "$FX" VITEST_AGENT_TDD_TASK_ID=42
		[[ "$(_artifact_argv)" == *"--tdd-task-id 42"* ]]
	done
}

@test "omits --tdd-task-id when VITEST_AGENT_TDD_TASK_ID is unset" {
	for t in "${VA_TARGETS[@]}"; do
		va_argv_reset
		va_hook "$t" "$HOOK" "$FX"
		[ -n "$(_artifact_argv)" ]
		[[ "$(_artifact_argv)" != *"--tdd-task-id"* ]]
	done
}

@test "omits --tdd-task-id when VITEST_AGENT_TDD_TASK_ID is set but empty" {
	for t in "${VA_TARGETS[@]}"; do
		va_argv_reset
		va_hook "$t" "$HOOK" "$FX" VITEST_AGENT_TDD_TASK_ID=
		[ -n "$(_artifact_argv)" ]
		[[ "$(_artifact_argv)" != *"--tdd-task-id"* ]]
	done
}
