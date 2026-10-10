#!/bin/bash
# Records a tool_call turn payload for every PreToolUse event.
# Distinct from pre-tool-use/mcp.sh (which gates the MCP allowlist).
set -euo pipefail

. "$(dirname "$0")/../lib/pluginfinity/hook.sh"
. "$(dirname "$0")/../lib/vitest-agent/common.sh"
hook_require_input

chat_id=$(hook_input session_id)
cwd=$(hook_input cwd)
tool_name=$(hook_input tool_name)
tool_input=$(hook_input tool_input)
[ -n "$tool_input" ] || tool_input='{}'
tool_use_id=$(hook_input tool_use_id)

if [ -z "$chat_id" ] || [ -z "$cwd" ] || [ -z "$tool_name" ]; then
	hook_noop
	exit 0
fi

cli=$(va_cli "$cwd") || {
	hook_noop
	exit 0
}

payload=$(jq -nc \
	--arg tn "$tool_name" \
	--argjson ti "$tool_input" \
	--arg tuid "$tool_use_id" \
	'{type: "tool_call", tool_name: $tn, tool_input: $ti} + (if $tuid != "" then {tool_use_id: $tuid} else {} end)') ||
	payload=""

if [ -n "$payload" ]; then
	(cd "$cwd" && $cli agent record turn \
		--chat-id "$chat_id" \
		"$payload" \
		>/dev/null 2>&1) ||
		true
fi

hook_noop
