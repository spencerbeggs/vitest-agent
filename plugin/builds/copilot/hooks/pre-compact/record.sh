#!/bin/bash
# PreCompact hook: record the firing as a hook_fire turn for analytics.
#
# The earlier version also computed a "save what matters next" wrap-up
# (`agent wrapup --kind pre_compact`) and returned it as a systemMessage, but
# neither host shows a PreCompact system message or context (Claude Code's
# hooks docs; the hook library answers {} for it), so the wrap-up was never
# seen and is no longer computed here.

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

# 1. Record the firing.
fire_payload=$(jq -nc --arg cc "$chat_id" \
	'{type: "hook_fire", hook_kind: "PreCompact", chat_id: $cc}')
(cd "$cwd" && $cli agent record turn \
	--chat-id "$chat_id" \
	"$fire_payload" \
	>/dev/null 2>&1) ||
	true

hook_noop
