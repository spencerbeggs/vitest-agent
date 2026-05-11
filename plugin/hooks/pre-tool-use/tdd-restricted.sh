#!/bin/bash
# PreToolUse hook for the tdd-task subagent — restricted MCP tools.
#
# Defense-in-depth for the tdd-task agent's `tools:` array. Even if the
# agent's tool registry drifts (or the agent attempts a tool not
# listed in its frontmatter), this hook explicitly denies destructive
# MCP calls so the safety property "tdd-task never deletes goals,
# behaviors, or its own evidence" stays load-bearing.
#
# Denied tools (matched on operation suffix; both bare and plugin-
# namespaced prefixes are accepted):
#   - tdd_goal_delete    — orchestrator must use status:'abandoned'
#   - tdd_behavior_delete — same
#   - tdd_artifact_record — D7 reserves artifact writes for hooks/CLI
#
# Non-orchestrator agents (main agent, other subagents) are unaffected
# and fall through to the standard permission flow. Delete tools are
# also intentionally omitted from `lib/safe-mcp-vitest-agent-ops.txt`,
# so the main agent surface still requires explicit user confirmation
# before a cascade-delete proceeds.

set -euo pipefail

# shellcheck source=../lib/hook-output.sh
. "$(dirname "$0")/../lib/hook-output.sh"

hook_json=$(cat)

agent_type=$(echo "$hook_json" | jq -r '.agent_type // .matcher.agent_type // ""')

# shellcheck source=../lib/match-tdd-agent.sh
. "$(dirname "$0")/../lib/match-tdd-agent.sh"
if ! is_tdd_agent "$agent_type"; then
	emit_noop
	exit 0
fi

tool_name=$(echo "$hook_json" | jq -r '.tool_name // ""')

action=$(echo "$hook_json" | jq -r '.tool_input.action // ""')

case "$tool_name" in
	mcp__plugin_vitest-agent_mcp__tdd_goal | mcp__vitest-agent_mcp__tdd_goal)
		if [ "$action" = "delete" ]; then
			emit_deny "tdd-task agent may not call tdd_goal({ action: 'delete' }). Use tdd_goal({ action: 'update', status: 'abandoned' }) instead. Deletes are reserved for the main agent and require explicit user confirmation."
			exit 0
		fi
		;;
	mcp__plugin_vitest-agent_mcp__tdd_behavior | mcp__vitest-agent_mcp__tdd_behavior)
		if [ "$action" = "delete" ]; then
			emit_deny "tdd-task agent may not call tdd_behavior({ action: 'delete' }). Use tdd_behavior({ action: 'update', status: 'abandoned' }) instead. Deletes are reserved for the main agent and require explicit user confirmation."
			exit 0
		fi
		;;
	mcp__plugin_vitest-agent_mcp__tdd_artifact_record | mcp__vitest-agent_mcp__tdd_artifact_record)
		emit_deny "tdd-task agent may not record artifacts directly. Per Decision D7, artifacts are written by the post-tool-use hooks observing your test runs and edits. Run the test (e.g. via run_tests) or make the file edit, and the hook will record the matching tdd_artifacts row."
		exit 0
		;;
esac

emit_noop
exit 0
