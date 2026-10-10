#!/bin/bash
# PreToolUse hook for the tdd-task subagent — restricted MCP tools.
#
# Defense-in-depth for the tdd-task agent's `tools:` array. Even if the
# agent's tool registry drifts (or the agent attempts a tool not listed in its
# frontmatter), this hook explicitly denies destructive MCP calls so the
# safety property "tdd-task never deletes goals, behaviors, or its own
# evidence" stays load-bearing.
#
# Denied (matched on operation name, any of this plugin's tool prefixes):
#   - tdd_goal { action: "delete" }      — orchestrator must use status:'abandoned'
#   - tdd_behavior { action: "delete" }  — same
#   - tdd_artifact_record                — D7 reserves artifact writes for hooks/CLI
#
# Non-orchestrator agents (main agent, other subagents) are unaffected and fall
# through to the standard permission flow. Deletes are also never auto-allowed
# by pre-tool-use/mcp.sh, so the main agent still confirms a cascade-delete.
#
# It fails open, as it always has: on Copilot the entry has no host matcher
# (the MCP tool spelling there is unmeasured), so it runs on every tool call,
# and a fail-closed crash would deny all of them.

set -euo pipefail

. "$(dirname "$0")/../lib/pluginfinity/hook.sh"
. "$(dirname "$0")/../lib/vitest-agent/common.sh"
hook_require_input

agent_type=$(hook_input agent_type)
[ -n "$agent_type" ] || agent_type=$(hook_input matcher.agent_type)

if ! va_is_tdd_agent "$agent_type"; then
	hook_noop
	exit 0
fi

op=$(va_mcp_op "$(hook_input tool_name)") || op=""
action=$(hook_input tool_input.action)

case "$op" in
tdd_goal)
	if [ "$action" = "delete" ]; then
		hook_deny "tdd-task agent may not call tdd_goal({ action: 'delete' }). Use tdd_goal({ action: 'update', status: 'abandoned' }) instead. Deletes are reserved for the main agent and require explicit user confirmation."
		exit 0
	fi
	;;
tdd_behavior)
	if [ "$action" = "delete" ]; then
		hook_deny "tdd-task agent may not call tdd_behavior({ action: 'delete' }). Use tdd_behavior({ action: 'update', status: 'abandoned' }) instead. Deletes are reserved for the main agent and require explicit user confirmation."
		exit 0
	fi
	;;
tdd_artifact_record)
	hook_deny "tdd-task agent may not record artifacts directly. Per Decision D7, artifacts are written by the post-tool-use hooks observing your test runs and edits. Run the test (e.g. via run_tests) or make the file edit, and the hook will record the matching tdd_artifacts row."
	exit 0
	;;
esac

hook_noop
