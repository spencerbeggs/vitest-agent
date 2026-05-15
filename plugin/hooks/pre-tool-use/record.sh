#!/bin/bash
# Records a tool_call turn payload for every PreToolUse event.
# Distinct from pre-tool-use-mcp.sh (which gates the MCP allowlist).
set -euo pipefail

# shellcheck source=../lib/hook-output.sh
. "$(dirname "$0")/../lib/hook-output.sh"

hook_json=$(cat)

chat_id=$(jq -r '.session_id // ""' <<< "$hook_json")
cwd=$(jq -r '.cwd // ""' <<< "$hook_json")
tool_name=$(jq -r '.tool_name // ""' <<< "$hook_json")
tool_input=$(jq -c '.tool_input // {}' <<< "$hook_json")
tool_use_id=$(jq -r '.tool_use_id // ""' <<< "$hook_json")

if [ -z "$chat_id" ] || [ -z "$cwd" ] || [ -z "$tool_name" ]; then
	emit_noop
	exit 0
fi

# shellcheck source=../lib/detect-pm.sh
. "$(dirname "$0")/../lib/detect-pm.sh"
pm_exec=$(detect_pm_exec "$cwd")

payload=$(jq -nc \
	--arg tn "$tool_name" \
	--argjson ti "$tool_input" \
	--arg tuid "$tool_use_id" \
	'{type: "tool_call", tool_name: $tn, tool_input: $ti} + (if $tuid != "" then {tool_use_id: $tuid} else {} end)')

cd "$cwd" >/dev/null && $pm_exec vitest-agent agent record turn \
	--chat-id "$chat_id" \
	"$payload" \
	>/dev/null 2>&1 \
	|| true

emit_noop
exit 0
