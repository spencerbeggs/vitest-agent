#!/usr/bin/env bats
# bash-tdd.bats — the tdd-task PreToolUse restriction hook
# (hooks/pre-tool-use/bash-tdd.sh), on both targets.
#
# The forbidden-pattern list is a regex match against the whole command line,
# so every pattern in it must express a token, not a substring. `.snap` is the
# one that historically did not: it matched anywhere, so ordinary git/grep
# commands naming a file like `cells.snapshot.test.ts` were denied and the
# agent had to paraphrase the filename to get work through (issue #247).

load common

HOOK=hooks/pre-tool-use/bash-tdd.sh

setup() {
	va_stub_cli
}

# _run <target> <command> [agent_type]: a Bash call from the tdd-task agent.
_run() {
	local fx
	fx=$(hook_fixture PreToolUse "$(jq -nc --arg c "$2" --arg a "${3-vitest-agent:tdd-task}" \
		'{agent_type: $a, tool_name: "Bash", tool_input: {command: $c}}')")
	va_hook "$1" "$HOOK" "$fx"
}

@test "denies a command that edits a real snapshot file" {
	for t in "${VA_TARGETS[@]}"; do
		_run "$t" 'rm packages/ui/__test__/__snapshots__/cells.snap'
		assert_hook_exit 0
		[ "$(va_decision "$t")" = deny ]
	done
}

@test "denies a snapshot path followed by more command text" {
	for t in "${VA_TARGETS[@]}"; do
		_run "$t" 'git add foo.snap && git commit -m x'
		[ "$(va_decision "$t")" = deny ]
	done
}

@test "denies a quoted snapshot path" {
	for t in "${VA_TARGETS[@]}"; do
		_run "$t" 'git add "packages/ui/__test__/__snapshots__/a.snap"'
		[ "$(va_decision "$t")" = deny ]
	done
}

@test "allows a filename that merely starts with .snap" {
	for t in "${VA_TARGETS[@]}"; do
		_run "$t" 'grep -n dispatcher packages/ui/__test__/dispatcher/cells.snapshot.test.ts'
		assert_hook_exit 0
		[ "$(va_decision "$t")" = none ]
	done
}

@test "allows committing a message that names a .snapshot test file" {
	for t in "${VA_TARGETS[@]}"; do
		_run "$t" 'git commit -m "test(ui): add cells.snapshot.test.ts"'
		[ "$(va_decision "$t")" = none ]
	done
}

@test "allows a directory named __snapshots__ with no .snap operand" {
	for t in "${VA_TARGETS[@]}"; do
		_run "$t" 'ls packages/ui/__test__/__snapshots__'
		[ "$(va_decision "$t")" = none ]
	done
}

@test "still denies the other restricted flags" {
	for t in "${VA_TARGETS[@]}"; do
		_run "$t" 'vitest run --update'
		[ "$(va_decision "$t")" = deny ]
	done
}

@test "the run_tests nudge reaches Claude Code as context and is dropped on Copilot" {
	_run claude 'pnpm vitest run src/a.test.ts'
	[[ "$(va_context claude)" == *"<run_tests_nudge>"* ]]
	_run copilot 'pnpm vitest run src/a.test.ts'
	assert_hook_noop
}

@test "does nothing outside the tdd-task agent" {
	for t in "${VA_TARGETS[@]}"; do
		_run "$t" 'vitest run --update' ''
		assert_hook_noop
	done
}

@test "denies a snapshot edit, in either host's tool_input keys" {
	local fx
	for t in "${VA_TARGETS[@]}"; do
		fx=$(hook_fixture PreToolUse '{"agent_type":"vitest-agent:tdd-task","tool_name":"Edit","tool_input":{"file_path":"a/__snapshots__/x.snap","old_string":"a","new_string":"b"}}')
		va_hook "$t" "$HOOK" "$fx" --matcher "Bash|Edit|Write|MultiEdit"
		[ "$(va_decision "$t")" = deny ]
		fx=$(hook_fixture PreToolUse '{"agent_type":"vitest-agent:tdd-task","tool_name":"Edit","tool_input":{"path":"a/__snapshots__/x.snap","old_str":"a","new_str":"b"}}')
		va_hook "$t" "$HOOK" "$fx"
		[ "$(va_decision "$t")" = deny ]
	done
}

@test "denies a vitest config edit that adds setupFiles" {
	local fx
	fx=$(hook_fixture PreToolUse '{"agent_type":"vitest-agent:tdd-task","tool_name":"Edit","tool_input":{"file_path":"vitest.config.ts","old_string":"a","new_string":"setupFiles: [\"x\"]"}}')
	for t in "${VA_TARGETS[@]}"; do
		va_hook "$t" "$HOOK" "$fx"
		[ "$(va_decision "$t")" = deny ]
	done
}
