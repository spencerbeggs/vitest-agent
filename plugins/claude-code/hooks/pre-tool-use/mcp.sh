#!/usr/bin/env bash
# PreToolUse hook: auto-allow read-only and project-scoped MCP tools provided
# by the vitest-agent MCP server.
#
# The auto-allowed tools are listed in lib/safe-mcp-vitest-agent-ops.txt.
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
# Claude Code emits MCP tool names with a `mcp__plugin_<plugin>_<server>__<op>`
# prefix when the MCP server is bundled by a plugin (our case), and a bare
# `mcp__<server>__<op>` prefix when the user wires the MCP server directly via
# settings.json. Match both so the auto-allowlist works in both setups.
set -euo pipefail

# shellcheck source=../lib/hook-output.sh
. "$(dirname "$0")/../lib/hook-output.sh"

ENVELOPE=$(cat)
TOOL=$(echo "$ENVELOPE" | jq -r '.tool_name // empty')
if [ -z "$TOOL" ]; then
  emit_noop
  exit 0
fi

case "$TOOL" in
  mcp__plugin_vitest-agent_mcp__*)
    OP="${TOOL#mcp__plugin_vitest-agent_mcp__}" ;;
  mcp__vitest-agent_mcp__*)
    OP="${TOOL#mcp__vitest-agent_mcp__}" ;;
  *) emit_noop; exit 0 ;;
esac

ALLOW="${CLAUDE_PLUGIN_ROOT}/hooks/lib/safe-mcp-vitest-agent-ops.txt"
if [ ! -f "$ALLOW" ]; then
  emit_noop
  exit 0
fi

ACTION=$(echo "$ENVELOPE" | jq -r '.tool_input.action // empty' 2>/dev/null || true)
if [ "$ACTION" = "delete" ]; then
  emit_noop
  exit 0
fi

# Strip comments and blank lines, then check for an exact match.
if grep -vE '^[[:space:]]*(#|$)' "$ALLOW" | grep -Fxq "$OP"; then
  emit_allow "auto-allowed MCP tool: $TOOL"
else
  emit_noop
fi

exit 0
