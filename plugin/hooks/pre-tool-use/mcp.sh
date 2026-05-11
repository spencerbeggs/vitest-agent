#!/usr/bin/env bash
# PreToolUse hook: auto-allow read-only and project-scoped MCP tools provided
# by the vitest-agent MCP server.
#
# All 41 tools are listed in lib/safe-mcp-vitest-agent-ops.txt.
# Anything else (or a future tool not yet added to the list) falls through
# without a decision so the standard permission prompt fires.
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

# Strip comments and blank lines, then check for an exact match.
if grep -vE '^[[:space:]]*(#|$)' "$ALLOW" | grep -Fxq "$OP"; then
  emit_allow "auto-allowed MCP tool: $TOOL"
else
  emit_noop
fi

exit 0
