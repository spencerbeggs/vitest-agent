#!/bin/bash
# PreCompact hook: record + inject "save what matters next" prompt.
#
# Per spec W5: before context compaction, agent decides what to
# preserve. Wrap-up content from formatWrapupEffect via the wrapup
# CLI (kind=pre_compact).

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

# 1. Record the firing.
fire_payload=$(jq -nc --arg cc "$chat_id" \
	'{type: "hook_fire", hook_kind: "PreCompact", chat_id: $cc}')
cd "$cwd" >/dev/null && $pm_exec vitest-agent agent record turn \
	--chat-id "$chat_id" \
	"$fire_payload" \
	>/dev/null 2>&1 \
	|| true

# 2. Compute the wrap-up nudge.
nudge=$(cd "$cwd" && $pm_exec vitest-agent agent wrapup \
	--chat-id "$chat_id" \
	--kind pre_compact \
	--format markdown 2>/dev/null || echo "")

# 3. Surface via systemMessage. Claude Code's PreCompact envelope
# does not accept hookSpecificOutput.additionalContext — that field
# is restricted to PreToolUse / UserPromptSubmit / PostToolUse /
# PostToolBatch.
if [ -n "$nudge" ]; then
	emit_system_message "$nudge"
else
	emit_noop
fi

exit 0
