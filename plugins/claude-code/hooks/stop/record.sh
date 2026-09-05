#!/bin/bash
# Stop hook: record a hook_fire turn AND inject a tailored wrap-up nudge.
#
# Per spec W5: lighter-weight than SessionEnd (every turn vs end of
# session). Nudge content comes from the shared format-wrapup generator
# via the wrapup CLI subcommand.

set -euo pipefail

# shellcheck source=../lib/hook-output.sh
. "$(dirname "$0")/../lib/hook-output.sh"

hook_json=$(cat)

chat_id=$(jq -r '.session_id // ""' <<< "$hook_json")
cwd=$(jq -r '.cwd // ""' <<< "$hook_json")

if [ -z "$chat_id" ] || [ -z "$cwd" ]; then
	emit_noop
	exit 0
fi

# shellcheck source=../lib/detect-pm.sh
. "$(dirname "$0")/../lib/detect-pm.sh"
pm_exec=$(detect_pm_exec "$cwd")

# 1. Record the firing as a hook_fire turn.
fire_payload=$(jq -nc --arg cc "$chat_id" \
	'{type: "hook_fire", hook_kind: "Stop", chat_id: $cc}')
cd "$cwd" >/dev/null && $pm_exec vitest-agent agent record turn \
	--chat-id "$chat_id" \
	"$fire_payload" \
	>/dev/null 2>&1 \
	|| true

# 2. Compute the wrap-up nudge.
nudge=$(cd "$cwd" && $pm_exec vitest-agent agent wrapup \
	--chat-id "$chat_id" \
	--kind stop \
	--format markdown 2>/dev/null || echo "")

# 3. If non-empty, surface it via systemMessage. Claude Code's Stop
# envelope does not accept hookSpecificOutput.additionalContext —
# that field is restricted to PreToolUse / UserPromptSubmit /
# PostToolUse / PostToolBatch.
if [ -n "$nudge" ]; then
	emit_system_message "$nudge"
else
	emit_noop
fi

exit 0
