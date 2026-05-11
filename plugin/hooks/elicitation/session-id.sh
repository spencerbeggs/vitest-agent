#!/usr/bin/env bash
set -euo pipefail
INPUT=$(cat)
SERVER=$(echo "$INPUT" | jq -r '.mcp_server_name // empty')
# Accept "plugin:vitest-agent:mcp" (fully-qualified by CC) or the bare
# "mcp" key for resilience. Also accept the legacy "vitest-agent"
# name in case an older plugin version is loaded.
case "$SERVER" in
  *":mcp" | "mcp" | *":vitest-agent" | "vitest-agent") ;;
  *) echo '{}'; exit 0 ;;
esac
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
if [ -z "$SESSION_ID" ]; then echo '{}'; exit 0; fi
jq -n --arg sid "$SESSION_ID" '{
  "hookSpecificOutput": {
    "hookEventName": "Elicitation",
    "action": "accept",
    "content": { "sessionId": $sid }
  }
}'
exit 0
