#!/usr/bin/env bash
# Elicitation hook (Claude Code only): answer the vitest-agent MCP server's
# session-id elicitation with this conversation's session id.
#
# Copilot has no Elicitation event; the config omits the entry there.
set -euo pipefail

. "$(dirname "$0")/../lib/pluginfinity/hook.sh"
hook_require_input

server=$(hook_input mcp_server_name)
# Accept "plugin:vitest-agent:mcp" (fully-qualified by Claude Code) or the bare
# "mcp" key for resilience. Also accept the legacy "vitest-agent" name in case
# an older plugin version is loaded.
case "$server" in
*":mcp" | "mcp" | *":vitest-agent" | "vitest-agent") ;;
*)
	hook_noop
	exit 0
	;;
esac

session_id=$(hook_input session_id)
if [ -z "$session_id" ]; then
	hook_noop
	exit 0
fi

# The library has no Elicitation helper, so send Claude Code's shape as is.
hook_raw claude "$(jq -nc --arg sid "$session_id" '{
	hookSpecificOutput: {
		hookEventName: "Elicitation",
		action: "accept",
		content: { sessionId: $sid }
	}
}')"
