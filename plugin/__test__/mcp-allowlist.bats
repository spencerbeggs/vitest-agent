#!/usr/bin/env bats
# mcp-allowlist.bats — hooks/pre-tool-use/mcp.sh, the PreToolUse hook that
# auto-allows vitest-agent MCP tools listed in
# hooks/lib/vitest-agent/safe-mcp-ops.txt, on both targets.
#
# The allowlist is tool-name keyed, but the consolidated CRUD tools dispatch on
# tool_input.action. A delete must never be auto-allowed (issue #526): it falls
# through with no permission decision so the host's standard prompt fires.

load common

HOOK=hooks/pre-tool-use/mcp.sh

setup() {
	va_stub_cli
}

# The plugin's own MCP tool prefix. Copilot's run-time prefix is a bare `mcp-`
# that does not name the plugin, so only the namespaced spelling counts as ours
# on either host.
_prefix() { printf 'mcp__plugin_vitest-agent_mcp__'; }

# _run <target> <tool-name> <tool_input-json>
_run() {
	local fx
	fx=$(hook_fixture PreToolUse "$(jq -nc --arg t "$2" --argjson i "$3" '{tool_name: $t, tool_input: $i}')")
	va_hook "$1" "$HOOK" "$fx"
}

@test "tdd_goal with a non-destructive action is auto-allowed" {
	for t in "${VA_TARGETS[@]}"; do
		_run "$t" "$(_prefix "$t")tdd_goal" '{"action":"create","goal":"x","tddTaskId":1}'
		assert_hook_exit 0
		[ "$(va_decision "$t")" = allow ]
	done
}

@test "tdd_goal action=delete falls through to the permission prompt" {
	for t in "${VA_TARGETS[@]}"; do
		_run "$t" "$(_prefix "$t")tdd_goal" '{"action":"delete","id":1}'
		assert_hook_noop
	done
}

@test "tdd_behavior with a non-destructive action is auto-allowed" {
	for t in "${VA_TARGETS[@]}"; do
		_run "$t" "$(_prefix "$t")tdd_behavior" '{"action":"list","goalId":1}'
		[ "$(va_decision "$t")" = allow ]
	done
}

@test "tdd_behavior action=delete falls through to the permission prompt" {
	for t in "${VA_TARGETS[@]}"; do
		_run "$t" "$(_prefix "$t")tdd_behavior" '{"action":"delete","id":1}'
		assert_hook_noop
	done
}

@test "note action=delete falls through to the permission prompt" {
	for t in "${VA_TARGETS[@]}"; do
		_run "$t" "$(_prefix "$t")note" '{"action":"delete","id":1}'
		assert_hook_noop
	done
}

@test "bare settings.json prefix is recognised and is also delete-aware" {
	for t in "${VA_TARGETS[@]}"; do
		_run "$t" "mcp__vitest-agent_mcp__tdd_goal" '{"action":"delete","id":1}'
		assert_hook_noop
		_run "$t" "mcp__vitest-agent_mcp__test_status" '{}'
		[ "$(va_decision "$t")" = allow ]
	done
}

@test "a tool with no action field is still auto-allowed" {
	for t in "${VA_TARGETS[@]}"; do
		_run "$t" "$(_prefix "$t")test_status" '{}'
		[ "$(va_decision "$t")" = allow ]
		[ "$(va_reason "$t")" = "auto-allowed MCP tool: $(_prefix "$t")test_status" ]
	done
}

@test "an unlisted tool falls through" {
	for t in "${VA_TARGETS[@]}"; do
		_run "$t" "$(_prefix "$t")not_a_tool" '{}'
		assert_hook_noop
	done
}

@test "another server's tool falls through" {
	for t in "${VA_TARGETS[@]}"; do
		_run "$t" "mcp__other_server__test_status" '{}'
		assert_hook_noop
	done
}

@test "the MCP-scoped PreToolUse entries keep their matchers on Claude Code only" {
	local claude copilot
	claude="$PLUGIN_DIR/builds/claude/hooks/hooks.json"
	copilot="$PLUGIN_DIR/builds/copilot/com.github.copilot/hooks/hooks.json"
	run jq -r '.hooks.PreToolUse[] | select(.hooks[0].args[-1] | endswith("pre-tool-use/mcp.sh")) | .matcher' "$claude"
	[ "$output" = 'mcp__(plugin_vitest-agent_mcp|vitest-agent_mcp)__.*' ]
	run jq -r '.hooks.PreToolUse[] | select(.bash | contains("pre-tool-use/mcp.sh")) | .matcher // "none"' "$copilot"
	[ "$output" = none ]
	run jq -r '.hooks.PreToolUse[] | select(.bash | contains("pre-tool-use/bash.sh")) | .matcher' "$copilot"
	[ "$output" = Bash ]
}

@test "on Copilot a bare mcp- tool from another server is never auto-allowed" {
	for op in note test test_status run_tests configure; do
		_run copilot "mcp-$op" '{}'
		assert_hook_noop
	done
}
