#!/bin/bash
# UserPromptSubmit hook: record the prompt + inject a light nudge when
# the prompt looks failure-related.
#
# Per spec W5: nudge to use test_history / failure_signature_get
# before fixing. The text-match logic lives in format-wrapup.ts under
# kind=user_prompt_nudge so the rule stays DRY across the CLI and
# MCP tool.

set -euo pipefail

# shellcheck source=../lib/hook-output.sh
. "$(dirname "$0")/../lib/hook-output.sh"
# shellcheck source=../lib/hook-debug.sh
. "$(dirname "$0")/../lib/hook-debug.sh"

_HOOK="user-prompt-submit-record"

hook_json=$(cat)

chat_id=$(jq -r '.session_id // ""' <<< "$hook_json")
cwd=$(jq -r '.cwd // ""' <<< "$hook_json")
prompt=$(jq -r '.prompt // ""' <<< "$hook_json")

hook_debug "$_HOOK" "INPUT session_id=$chat_id cwd=$cwd prompt_len=${#prompt}"

if [ -z "$chat_id" ] || [ -z "$cwd" ] || [ -z "$prompt" ]; then
	emit_noop
	exit 0
fi

# shellcheck source=../lib/detect-pm.sh
. "$(dirname "$0")/../lib/detect-pm.sh"
pm_exec=$(detect_pm_exec "$cwd")

hook_debug "$_HOOK" "pm_exec=$pm_exec"

# 1. Record the prompt as a user_prompt turn.
# cc_message_id is intentionally omitted: the Claude Code envelope does not
# expose a per-message id, and stuffing the session id there breaks downstream
# "find the message that started this thread" queries against the
# UserPromptPayload schema's contract.
payload=$(jq -nc --arg p "$prompt" '{type: "user_prompt", prompt: $p}')

_turn_out=$(cd "$cwd" && $pm_exec vitest-agent record turn \
	--chat-id "$chat_id" \
	"$payload" 2>&1) || {
	hook_error "$_HOOK" "record turn user_prompt rc=$? cc=$chat_id: $_turn_out"
}
hook_debug "$_HOOK" "record turn user_prompt: $_turn_out"

# 2. Compute the nudge (empty when the prompt isn't failure-related).
nudge=$(cd "$cwd" && $pm_exec vitest-agent wrapup \
	--chat-id "$chat_id" \
	--kind user_prompt_nudge \
	--user-prompt-hint "$prompt" \
	--format markdown 2>/dev/null || echo "")

# 3. Inject if non-empty.
if [ -n "$nudge" ]; then
	emit_additional_context "UserPromptSubmit" "$nudge"
else
	emit_noop
fi

exit 0
