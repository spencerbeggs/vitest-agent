#!/usr/bin/env bash
# PreToolUse hook: auto-allow read-only and project-scoped MCP tools provided
# by the vitest-agent MCP server.
#
# The auto-allowed tools are listed in lib/vitest-agent/safe-mcp-ops.txt.
# Anything else (or a future tool not yet added to the list) falls through
# without a decision so the standard permission prompt fires.
#
# The allowlist is keyed by tool name, but the consolidated CRUD tools
# (tdd_goal, tdd_behavior, note) dispatch on an `action` field. A call whose
# `tool_input.action` is "delete" is never auto-allowed: it falls through to
# the standard permission prompt, so a destructive call (tdd_goal and
# tdd_behavior deletes cascade to phase and artifact history) always reaches
# the user.
#
# va_mcp_op accepts this host's prefix for the plugin's own server plus the
# bare `mcp__vitest-agent_mcp__` prefix a user gets by wiring the server
# directly in settings.json.
set -euo pipefail

. "$(dirname "$0")/../lib/pluginfinity/hook.sh"
. "$(dirname "$0")/../lib/vitest-agent/common.sh"
hook_require_input

tool=$(hook_input tool_name)
if [ -z "$tool" ]; then
	hook_noop
	exit 0
fi

op=$(va_mcp_op "$tool") || {
	hook_noop
	exit 0
}

allow="$(dirname "$0")/../lib/vitest-agent/safe-mcp-ops.txt"
if [ ! -f "$allow" ]; then
	hook_noop
	exit 0
fi

action=$(hook_input tool_input.action)
if [ "$action" = "delete" ]; then
	hook_noop
	exit 0
fi

# Strip comments and blank lines, then check for an exact match.
if grep -vE '^[[:space:]]*(#|$)' "$allow" | grep -Fxq "$op"; then
	hook_allow "auto-allowed MCP tool: $tool"
else
	hook_noop
fi
