#!/usr/bin/env bats
# mcp-allowlist.bats — covers hooks/pre-tool-use/mcp.sh, the PreToolUse hook
# that auto-allows vitest-agent MCP tools listed in
# hooks/lib/safe-mcp-vitest-agent-ops.txt.
#
# The allowlist is tool-name keyed, but the consolidated CRUD tools dispatch on
# tool_input.action. A delete must never be auto-allowed (issue #526): it falls
# through with no permission decision so Claude Code's standard prompt fires.

PLUGIN_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
HOOK="${PLUGIN_DIR}/hooks/pre-tool-use/mcp.sh"

# Run the hook with a PreToolUse envelope for $1 (tool name) and $2 (tool_input
# JSON), printing only the hook's stdout JSON.
_run_hook() {
	jq -n --arg t "$1" --argjson i "$2" '{tool_name: $t, tool_input: $i}' |
		CLAUDE_PLUGIN_ROOT="$PLUGIN_DIR" bash "$HOOK" 2>/dev/null
}

_decision() {
	printf '%s' "$1" | jq -r '.hookSpecificOutput.permissionDecision // "none"'
}

@test "tdd_goal with a non-destructive action is auto-allowed" {
	run _run_hook "mcp__plugin_vitest-agent_mcp__tdd_goal" '{"action":"create","goal":"x","tddTaskId":1}'
	[ "$status" -eq 0 ]
	[ "$(_decision "$output")" = "allow" ]
}

@test "tdd_goal action=delete falls through to the permission prompt" {
	run _run_hook "mcp__plugin_vitest-agent_mcp__tdd_goal" '{"action":"delete","id":1}'
	[ "$status" -eq 0 ]
	[ "$(_decision "$output")" = "none" ]
}

@test "tdd_behavior with a non-destructive action is auto-allowed" {
	run _run_hook "mcp__plugin_vitest-agent_mcp__tdd_behavior" '{"action":"list","goalId":1}'
	[ "$status" -eq 0 ]
	[ "$(_decision "$output")" = "allow" ]
}

@test "tdd_behavior action=delete falls through to the permission prompt" {
	run _run_hook "mcp__plugin_vitest-agent_mcp__tdd_behavior" '{"action":"delete","id":1}'
	[ "$status" -eq 0 ]
	[ "$(_decision "$output")" = "none" ]
}

@test "note action=delete falls through to the permission prompt" {
	run _run_hook "mcp__plugin_vitest-agent_mcp__note" '{"action":"delete","id":1}'
	[ "$status" -eq 0 ]
	[ "$(_decision "$output")" = "none" ]
}

@test "bare settings.json prefix is also delete-aware" {
	run _run_hook "mcp__vitest-agent_mcp__tdd_goal" '{"action":"delete","id":1}'
	[ "$status" -eq 0 ]
	[ "$(_decision "$output")" = "none" ]
}

@test "a tool with no action field is still auto-allowed" {
	run _run_hook "mcp__plugin_vitest-agent_mcp__test_status" '{}'
	[ "$status" -eq 0 ]
	[ "$(_decision "$output")" = "allow" ]
}

@test "an unlisted tool falls through" {
	run _run_hook "mcp__plugin_vitest-agent_mcp__not_a_tool" '{}'
	[ "$status" -eq 0 ]
	[ "$(_decision "$output")" = "none" ]
}
