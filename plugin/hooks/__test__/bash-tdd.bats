#!/usr/bin/env bats
# bash-tdd.bats — covers the tdd-task PreToolUse Bash restriction hook.
#
# The forbidden-pattern list is a regex match against the whole command line,
# so every pattern in it must express a token, not a substring. `.snap` is the
# one that historically did not: it matched anywhere, so ordinary git/grep
# commands naming a file like `cells.snapshot.test.ts` were denied and the
# agent had to paraphrase the filename to get work through (issue #247).

HOOK="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)/pre-tool-use/bash-tdd.sh"

# Feed the hook a Bash tool call from the tdd-task agent.
_run_bash() {
	jq -n --arg cmd "$1" \
		'{agent_type: "vitest-agent:tdd-task", tool_name: "Bash", tool_input: {command: $cmd}}' |
		bash "$HOOK"
}

_is_deny() {
	[ "$(printf '%s' "$1" | jq -r '.hookSpecificOutput.permissionDecision // ""')" = "deny" ]
}

@test "denies a command that edits a real snapshot file" {
	run _run_bash 'rm packages/ui/__test__/__snapshots__/cells.snap'
	[ "$status" -eq 0 ]
	_is_deny "$output"
}

@test "denies a snapshot path followed by more command text" {
	run _run_bash 'git add foo.snap && git commit -m x'
	[ "$status" -eq 0 ]
	_is_deny "$output"
}

@test "denies a quoted snapshot path" {
	run _run_bash 'git add "packages/ui/__test__/__snapshots__/a.snap"'
	[ "$status" -eq 0 ]
	_is_deny "$output"
}

@test "allows a filename that merely starts with .snap" {
	run _run_bash 'grep -n dispatcher packages/ui/__test__/dispatcher/cells.snapshot.test.ts'
	[ "$status" -eq 0 ]
	! _is_deny "$output"
}

@test "allows committing a message that names a .snapshot test file" {
	run _run_bash 'git commit -m "test(ui): add cells.snapshot.test.ts"'
	[ "$status" -eq 0 ]
	! _is_deny "$output"
}

@test "allows a directory named __snapshots__ with no .snap operand" {
	run _run_bash 'ls packages/ui/__test__/__snapshots__'
	[ "$status" -eq 0 ]
	! _is_deny "$output"
}

@test "still denies the other restricted flags" {
	run _run_bash 'vitest run --update'
	[ "$status" -eq 0 ]
	_is_deny "$output"
}
