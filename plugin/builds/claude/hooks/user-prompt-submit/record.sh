#!/bin/bash
# UserPromptSubmit hook: record the prompt + add a light nudge when the prompt
# looks failure-related.
#
# Per spec W5: nudge to use test_history / failure_signature_get before
# fixing. The text-match logic lives in format-wrapup.ts under
# kind=user_prompt_nudge so the rule stays DRY across the CLI and MCP tool.
# Copilot drops UserPromptSubmit output, so there the prompt is only recorded.

set -euo pipefail

. "$(dirname "$0")/../lib/pluginfinity/hook.sh"
. "$(dirname "$0")/../lib/vitest-agent/common.sh"
hook_require_input

chat_id=$(hook_input session_id)
cwd=$(hook_input cwd)
prompt=$(hook_input prompt)

hook_debug "session_id=$chat_id cwd=$cwd prompt_len=${#prompt}"

if [ -z "$chat_id" ] || [ -z "$cwd" ] || [ -z "$prompt" ]; then
	hook_noop
	exit 0
fi

cli=$(va_cli "$cwd") || {
	hook_noop
	exit 0
}

# 1. Record the prompt as a user_prompt turn.
# cc_message_id is intentionally omitted: the host envelope does not expose a
# per-message id, and stuffing the session id there breaks downstream "find
# the message that started this thread" queries against the UserPromptPayload
# schema's contract.
payload=$(jq -nc --arg p "$prompt" '{type: "user_prompt", prompt: $p}')

_turn_err=$(mktemp)
_turn_out=$(cd "$cwd" && $cli agent record turn \
	--chat-id "$chat_id" \
	"$payload" 2>"$_turn_err") || {
	_rc=$?
	hook_log "record turn user_prompt rc=$_rc cc=$chat_id: $(cat "$_turn_err")"
}
rm -f "$_turn_err"
hook_debug "record turn user_prompt: $_turn_out"

# 2. Compute the nudge (empty when the prompt isn't failure-related), only
# where the host reads UserPromptSubmit context.
if ! hook_supports context; then
	hook_noop
	exit 0
fi
nudge=$(cd "$cwd" && $cli agent wrapup \
	--chat-id "$chat_id" \
	--kind user_prompt_nudge \
	--user-prompt-hint "$prompt" \
	--format markdown 2>/dev/null || echo "")

# 3. Add it if non-empty.
if [ -n "$nudge" ]; then
	hook_context "$nudge"
else
	hook_noop
fi
