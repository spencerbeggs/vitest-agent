#!/usr/bin/env bats
# tdd-artifact-bats.bats — issue #360: bats-only cycles never produced a
# test_failed_run / test_passed_run artifact because the Bash-command
# matcher in post-tool-use/tdd-artifact.sh only recognized
# vitest/jest/npm-run-test shapes. This suite locks in bats recognition:
# a bare `bats <path>`, `pnpm run test:bats` (and PM-script variants),
# `pnpm exec bats`, `npx bats`, and `bunx bats` must all be classified as
# test-runner invocations, while unrelated commands (`bats --version`,
# `pnpm run build`) must not record anything.
#
# Stub strategy: same pnpm/vitest-agent fake pattern as
# tdd-artifact-task-id.bats / cli-rename-cascade.bats.

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
}

# Last captured `record tdd-artifact` argv line (empty if none recorded).
_artifact_argv() {
	grep '^agent record tdd-artifact' "${BATS_ARGV_CAPTURE}" 2>/dev/null | tail -n1 || echo ""
}

@test "bare 'bats <path>' with exit 1 records test_failed_run with no --test-case-id" {
	run bash -c "bash '${TEST_DIR}/render-fixture.sh' '${FIXTURES_DIR}/post-tool-use-bash-bats-fail.json' | \
		bash '${HOOKS_DIR}/post-tool-use/tdd-artifact.sh'"
	[ "$status" -eq 0 ]
	local argv
	argv=$(_artifact_argv)
	[[ "$argv" == *"--artifact-kind test_failed_run"* ]]
	[[ "$argv" != *"--test-case-id"* ]]
}

@test "'pnpm run test:bats' with exit 0 records test_passed_run with no --test-case-id" {
	run bash -c "bash '${TEST_DIR}/render-fixture.sh' '${FIXTURES_DIR}/post-tool-use-bash-test-bats-pass.json' | \
		bash '${HOOKS_DIR}/post-tool-use/tdd-artifact.sh'"
	[ "$status" -eq 0 ]
	local argv
	argv=$(_artifact_argv)
	[[ "$argv" == *"--artifact-kind test_passed_run"* ]]
	[[ "$argv" != *"--test-case-id"* ]]
}

@test "'bats --version' (unrelated) records no artifact" {
	run bash -c "bash '${TEST_DIR}/render-fixture.sh' '${FIXTURES_DIR}/post-tool-use-bash-bats-version.json' | \
		bash '${HOOKS_DIR}/post-tool-use/tdd-artifact.sh'"
	[ "$status" -eq 0 ]
	local argv
	argv=$(_artifact_argv)
	[ -z "$argv" ]
}

@test "'pnpm run build' (unrelated) records no artifact" {
	run bash -c "bash '${TEST_DIR}/render-fixture.sh' '${FIXTURES_DIR}/post-tool-use-bash-build.json' | \
		bash '${HOOKS_DIR}/post-tool-use/tdd-artifact.sh'"
	[ "$status" -eq 0 ]
	local argv
	argv=$(_artifact_argv)
	[ -z "$argv" ]
}

# Issue #363: bats-matched invocations must pass --suite bats so the D2
# phase-transition validator can distinguish a bats run-level artifact
# (no test_case_id) from a vitest one, instead of denying it outright.

@test "bare 'bats <path>' with exit 1 passes --suite bats" {
	run bash -c "bash '${TEST_DIR}/render-fixture.sh' '${FIXTURES_DIR}/post-tool-use-bash-bats-fail.json' | \
		bash '${HOOKS_DIR}/post-tool-use/tdd-artifact.sh'"
	[ "$status" -eq 0 ]
	local argv
	argv=$(_artifact_argv)
	[[ "$argv" == *"--suite bats"* ]]
}

@test "'pnpm run test:bats' with exit 0 passes --suite bats" {
	run bash -c "bash '${TEST_DIR}/render-fixture.sh' '${FIXTURES_DIR}/post-tool-use-bash-test-bats-pass.json' | \
		bash '${HOOKS_DIR}/post-tool-use/tdd-artifact.sh'"
	[ "$status" -eq 0 ]
	local argv
	argv=$(_artifact_argv)
	[[ "$argv" == *"--suite bats"* ]]
}

@test "a vitest Bash invocation records no --suite flag (defaults to vitest)" {
	run bash -c "bash '${TEST_DIR}/render-fixture.sh' '${FIXTURES_DIR}/post-tool-use-bash-vitest.json' | \
		bash '${HOOKS_DIR}/post-tool-use/tdd-artifact.sh'"
	[ "$status" -eq 0 ]
	local argv
	argv=$(_artifact_argv)
	[[ "$argv" != *"--suite"* ]]
}
