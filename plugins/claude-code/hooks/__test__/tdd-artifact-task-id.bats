#!/usr/bin/env bats
# tdd-artifact-task-id.bats — issue #144 escape hatch pass-through.
#
# post-tool-use/tdd-artifact.sh must pass `--tdd-task-id
# $VITEST_AGENT_TDD_TASK_ID` on every `record tdd-artifact` call when that
# env var is set and non-empty, and must NOT pass the flag at all when it
# is unset or empty — the CLI treats an empty `--tdd-task-id ""` the same
# as an absent flag, but the whole point of the escape hatch is an
# explicit, deliberate opt-in per issue #245 (walkConversation should be
# the default path; this is the last-resort override).
#
# Stub strategy: same pnpm/vitest-agent fake pattern as
# cli-rename-cascade.bats.

HOOKS_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
FIXTURES_DIR="${HOOKS_DIR}/fixtures"
TEST_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")" && pwd)"

setup() {
	BATS_TMPDIR="$(mktemp -d)"
	BATS_ARGV_CAPTURE="${BATS_TMPDIR}/vitest-agent-argv"

	cat > "${BATS_TMPDIR}/vitest-agent" <<'STUB'
#!/bin/bash
echo "$*" >> "$BATS_ARGV_CAPTURE"
case "$*" in
	"agent record test-case-turns"*)
		printf '{"updated":0,"latestTestCaseId":null}\n'
		;;
esac
exit 0
STUB
	chmod +x "${BATS_TMPDIR}/vitest-agent"

	cat > "${BATS_TMPDIR}/pnpm" <<'STUB'
#!/bin/bash
case "$1" in
	exec) shift; exec "$@" ;;
	*) exit 0 ;;
esac
STUB
	chmod +x "${BATS_TMPDIR}/pnpm"

	export BATS_ARGV_CAPTURE
	export PATH="${BATS_TMPDIR}:${PATH}"
}

teardown() {
	rm -rf "${BATS_TMPDIR}"
	unset VITEST_AGENT_TDD_TASK_ID
}

# Last captured `record tdd-artifact` argv line.
_artifact_argv() {
	grep '^agent record tdd-artifact' "${BATS_ARGV_CAPTURE}" | tail -n1
}

@test "passes --tdd-task-id when VITEST_AGENT_TDD_TASK_ID is set and non-empty" {
	export VITEST_AGENT_TDD_TASK_ID="42"
	run bash -c "bash '${TEST_DIR}/render-fixture.sh' '${FIXTURES_DIR}/post-tool-use-write-test.json' | \
		bash '${HOOKS_DIR}/post-tool-use/tdd-artifact.sh'"
	[ "$status" -eq 0 ]
	local argv
	argv=$(_artifact_argv)
	[[ "$argv" == *"--tdd-task-id 42"* ]]
}

@test "omits --tdd-task-id when VITEST_AGENT_TDD_TASK_ID is unset" {
	unset VITEST_AGENT_TDD_TASK_ID
	run bash -c "bash '${TEST_DIR}/render-fixture.sh' '${FIXTURES_DIR}/post-tool-use-write-test.json' | \
		bash '${HOOKS_DIR}/post-tool-use/tdd-artifact.sh'"
	[ "$status" -eq 0 ]
	local argv
	argv=$(_artifact_argv)
	[[ "$argv" != *"--tdd-task-id"* ]]
}

@test "omits --tdd-task-id when VITEST_AGENT_TDD_TASK_ID is set but empty" {
	export VITEST_AGENT_TDD_TASK_ID=""
	run bash -c "bash '${TEST_DIR}/render-fixture.sh' '${FIXTURES_DIR}/post-tool-use-write-test.json' | \
		bash '${HOOKS_DIR}/post-tool-use/tdd-artifact.sh'"
	[ "$status" -eq 0 ]
	local argv
	argv=$(_artifact_argv)
	[[ "$argv" != *"--tdd-task-id"* ]]
}
