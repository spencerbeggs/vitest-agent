#!/usr/bin/env bats
# test-location.bats — covers the invalid-test-location PreToolUse hook.
#
# The hook must be silent for anything that is not a discoverable test file,
# must deny only the creation of a new test at an invalid path, and must fail
# open on every error path. The fail-open cases are the load-bearing ones: a
# detector that cannot reason must never block work.

HOOK="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)/pre-tool-use/test-location.sh"

setup() {
	STUB_DIR="$(mktemp -d)"
}

teardown() {
	rm -rf "$STUB_DIR"
	unset VITEST_AGENT_CLI_CMD
}

# Point the hook at a fake CLI emitting $1 on stdout and exiting $2.
#
# The override env var is what makes this testable. Stubbing `vitest-agent` on
# PATH would not work: the hook resolves the CLI through detect-pm.sh, and
# `pnpm exec vitest-agent` ignores PATH order and finds the real binary.
_stub_cli() {
	cat >"$STUB_DIR/vitest-agent" <<EOF
#!/bin/bash
printf '%s\n' '${1}'
exit ${2:-0}
EOF
	chmod +x "$STUB_DIR/vitest-agent"
	export VITEST_AGENT_CLI_CMD="$STUB_DIR/vitest-agent"
}

_run_hook() {
	printf '%s' "$1" | bash "$HOOK"
}

@test "is silent for a file that is not a test file" {
	_stub_cli '{"verdict":"invalid","workspace":"w","suggestedPath":"/repo/__test__/a.ts"}'
	run _run_hook '{"tool_name":"Write","tool_input":{"file_path":"/repo/src/index.ts"}}'
	[ "$status" -eq 0 ]
	[[ "$output" == *'"suppressOutput": true'* ]]
}

@test "is silent for an unmatched tool" {
	run _run_hook '{"tool_name":"Bash","tool_input":{"command":"ls"}}'
	[ "$status" -eq 0 ]
	[[ "$output" == *'"suppressOutput": true'* ]]
}

@test "is silent for a valid location" {
	_stub_cli '{"verdict":"valid","workspace":"w","suggestedPath":null}'
	run _run_hook '{"tool_name":"Write","tool_input":{"file_path":"/repo/__test__/a.test.ts"}}'
	[ "$status" -eq 0 ]
	[[ "$output" == *'"suppressOutput": true'* ]]
}

@test "is silent for a deliberately excluded fixture test" {
	_stub_cli '{"verdict":"excluded","workspace":"w","suggestedPath":null}'
	run _run_hook '{"tool_name":"Write","tool_input":{"file_path":"/repo/__test__/fixtures/p/a.test.ts"}}'
	[ "$status" -eq 0 ]
	[[ "$output" == *'"suppressOutput": true'* ]]
}

@test "denies creating a new test at an invalid location" {
	_stub_cli '{"verdict":"invalid","workspace":"w","suggestedPath":"/repo/__test__/a.test.ts"}'
	run _run_hook '{"tool_name":"Write","tool_input":{"file_path":"/repo/lib/scripts/__test__/a.test.ts"}}'
	[ "$status" -eq 0 ]
	[[ "$output" == *'"permissionDecision": "deny"'* ]]
	[[ "$output" == *"/repo/__test__/a.test.ts"* ]]
}

@test "advises rather than denies when editing an existing misplaced test" {
	_stub_cli '{"verdict":"invalid","workspace":"w","suggestedPath":"/repo/__test__/a.test.ts"}'
	existing="$STUB_DIR/existing.test.ts"
	touch "$existing"
	run _run_hook "{\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"$existing\"}}"
	[ "$status" -eq 0 ]
	[[ "$output" == *"additionalContext"* ]]
	[[ "$output" != *'"permissionDecision": "deny"'* ]]
}

@test "advises on Read of a misplaced test" {
	# Read is matched deliberately: an agent reading a misplaced test is about to
	# reason about why it is not running, and the advisory is the answer. Read can
	# never be denied — it does not create anything.
	_stub_cli '{"verdict":"invalid","workspace":"w","suggestedPath":"/repo/__test__/a.test.ts"}'
	existing="$STUB_DIR/existing.test.ts"
	touch "$existing"
	run _run_hook "{\"tool_name\":\"Read\",\"tool_input\":{\"file_path\":\"$existing\"}}"
	[ "$status" -eq 0 ]
	[[ "$output" == *"additionalContext"* ]]
	[[ "$output" != *'"permissionDecision": "deny"'* ]]
}

@test "advises on Read of a misplaced test that does not exist on disk" {
	# The Write-absent-file deny branch must not leak into Read: a Read of a path
	# that is not on disk still only advises.
	_stub_cli '{"verdict":"invalid","workspace":"w","suggestedPath":"/repo/__test__/a.test.ts"}'
	run _run_hook '{"tool_name":"Read","tool_input":{"file_path":"/repo/lib/scripts/__test__/a.test.ts"}}'
	[ "$status" -eq 0 ]
	[[ "$output" == *"additionalContext"* ]]
	[[ "$output" != *'"permissionDecision": "deny"'* ]]
}

@test "advises on MultiEdit of a misplaced test" {
	_stub_cli '{"verdict":"invalid","workspace":"w","suggestedPath":"/repo/__test__/a.test.ts"}'
	existing="$STUB_DIR/existing.test.ts"
	touch "$existing"
	run _run_hook "{\"tool_name\":\"MultiEdit\",\"tool_input\":{\"file_path\":\"$existing\"}}"
	[ "$status" -eq 0 ]
	[[ "$output" == *"additionalContext"* ]]
	[[ "$output" != *'"permissionDecision": "deny"'* ]]
}

@test "advises rather than denies when Write targets an existing file" {
	_stub_cli '{"verdict":"invalid","workspace":"w","suggestedPath":"/repo/__test__/a.test.ts"}'
	existing="$STUB_DIR/existing.test.ts"
	touch "$existing"
	run _run_hook "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$existing\"}}"
	[ "$status" -eq 0 ]
	[[ "$output" == *"additionalContext"* ]]
	[[ "$output" != *'"permissionDecision": "deny"'* ]]
}

@test "fails open when the CLI exits non-zero" {
	_stub_cli '' 1
	run _run_hook '{"tool_name":"Write","tool_input":{"file_path":"/repo/lib/a.test.ts"}}'
	[ "$status" -eq 0 ]
	[[ "$output" == *'"suppressOutput": true'* ]]
	[[ "$output" != *"deny"* ]]
}

@test "fails open when the CLI emits unparseable output" {
	_stub_cli 'not json'
	run _run_hook '{"tool_name":"Write","tool_input":{"file_path":"/repo/lib/a.test.ts"}}'
	[ "$status" -eq 0 ]
	[[ "$output" != *"deny"* ]]
}

# Every case above stubs VITEST_AGENT_CLI_CMD directly, which never
# exercises the production cli_cmd-resolution branch (no override set, PM
# detected from cwd via detect-pm.sh). That branch has crashed twice with an
# unbound-variable error under set -u — once on $pm_exec, once on hook_debug's
# missing second argument — with neither caught by the suite above. These two
# tests drive that branch for real: no VITEST_AGENT_CLI_CMD, a stub `npx` on
# PATH standing in for the resolved package-manager exec, and a cwd with no
# package.json/lockfile so detect_pm_exec deterministically falls back to
# "npx --no-install".
_stub_pm_failure() {
	bin_dir="$STUB_DIR/bin"
	mkdir -p "$bin_dir"
	cat >"$bin_dir/npx" <<'EOF'
#!/bin/bash
exit 1
EOF
	chmod +x "$bin_dir/npx"
}

@test "fails open when resolving the CLI via the package manager and the resolved command fails" {
	unset VITEST_AGENT_CLI_CMD
	_stub_pm_failure
	old_path="$PATH"
	export PATH="$STUB_DIR/bin:$PATH"
	run _run_hook "{\"tool_name\":\"Write\",\"cwd\":\"$STUB_DIR\",\"tool_input\":{\"file_path\":\"$STUB_DIR/a.test.ts\"}}"
	export PATH="$old_path"
	[ "$status" -eq 0 ]
	[[ "$output" == *'"suppressOutput": true'* ]]
	[[ "$output" != *"deny"* ]]
}

@test "fails open when hook debug mode is on and CLI resolution fails" {
	unset VITEST_AGENT_CLI_CMD
	_stub_pm_failure
	old_path="$PATH"
	export PATH="$STUB_DIR/bin:$PATH"
	export VITEST_AGENT_HOOK_DEBUG=1
	export VITEST_AGENT_HOOK_DEBUG_LOG="$STUB_DIR/debug.log"
	run _run_hook "{\"tool_name\":\"Write\",\"cwd\":\"$STUB_DIR\",\"tool_input\":{\"file_path\":\"$STUB_DIR/a.test.ts\"}}"
	export PATH="$old_path"
	unset VITEST_AGENT_HOOK_DEBUG
	unset VITEST_AGENT_HOOK_DEBUG_LOG
	[ "$status" -eq 0 ]
	[[ "$output" == *'"suppressOutput": true'* ]]
	[[ "$output" != *"deny"* ]]
}

@test "is silent when file_path is missing" {
	run _run_hook '{"tool_name":"Write","tool_input":{}}'
	[ "$status" -eq 0 ]
	[[ "$output" == *'"suppressOutput": true'* ]]
}
