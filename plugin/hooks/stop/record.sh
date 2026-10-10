#!/bin/bash
# Stop hook: record a hook_fire turn AND surface a tailored wrap-up nudge.
#
# Per spec W5: lighter-weight than SessionEnd (every turn vs end of session).
# Nudge content comes from the shared format-wrapup generator via the wrapup
# CLI subcommand. It is shown as a system message where the host has one
# (Claude Code); Copilot has no system message on Stop, so there the firing is
# only recorded.

set -euo pipefail

. "$(dirname "$0")/../lib/pluginfinity/hook.sh"
. "$(dirname "$0")/../lib/vitest-agent/common.sh"
hook_require_input

chat_id=$(hook_input session_id)
cwd=$(hook_input cwd)

if [ -z "$chat_id" ] || [ -z "$cwd" ]; then
	hook_noop
	exit 0
fi

cli=$(va_cli "$cwd") || {
	hook_noop
	exit 0
}

# 1. Record the firing as a hook_fire turn.
fire_payload=$(jq -nc --arg cc "$chat_id" \
	'{type: "hook_fire", hook_kind: "Stop", chat_id: $cc}')
(cd "$cwd" && $cli agent record turn \
	--chat-id "$chat_id" \
	"$fire_payload" \
	>/dev/null 2>&1) ||
	true

# 2. Compute the wrap-up nudge, only where it can be shown.
if ! hook_supports system_message; then
	hook_noop
	exit 0
fi
nudge=$(cd "$cwd" && $cli agent wrapup \
	--chat-id "$chat_id" \
	--kind stop \
	--format markdown 2>/dev/null || echo "")

# 3. Surface it as a system message.
if [ -n "$nudge" ]; then
	hook_system_message "$nudge"
else
	hook_noop
fi
