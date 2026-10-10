#!/bin/bash
# PostToolUse hook on Edit/Write/MultiEdit to test files
# (scoped to agent_type=vitest-agent:tdd-task).
#
# Detects escape-hatch tokens in the new file content and records a
# tdd_artifacts(kind='test_weakened') when they appear. Specifically matches
# anti-patterns 2 and 8 from the spec's "5+3" set:
#   - it.skip / it.todo / it.fails / it.concurrent
#   - test.skip / test.todo / test.fails
#   - describe.skip / describe.todo
#   - .skipIf / .todoIf  (Vitest-specific dynamic skips)
#
# Snapshot mutations are caught by the W2 restricted PreToolUse hook (which
# blocks .snap edits outright); this hook handles the runtime escape-hatch
# tokens.

set -euo pipefail

. "$(dirname "$0")/../lib/pluginfinity/hook.sh"
. "$(dirname "$0")/../lib/vitest-agent/common.sh"
hook_require_input

agent_type=$(hook_input agent_type)
if ! va_is_tdd_agent "$agent_type"; then
	hook_noop
	exit 0
fi

tool_name=$(hook_input tool_name)
case "$tool_name" in
Edit | Write | MultiEdit) ;;
*)
	hook_noop
	exit 0
	;;
esac

file_path=$(hook_input tool_input.file_path)
case "$file_path" in
*.test.ts | *.test.tsx | *.test.js | *.test.jsx | *.spec.ts | *.spec.tsx | *.spec.js | *.spec.jsx) ;;
*)
	hook_noop
	exit 0
	;;
esac

chat_id=$(hook_input session_id)
cwd=$(hook_input cwd)
if [ -z "$chat_id" ] || [ -z "$cwd" ]; then
	hook_noop
	exit 0
fi

# Capture the new content from any of the Edit / Write / MultiEdit shapes.
new_content=$(hook_input tool_input.content)
[ -n "$new_content" ] || new_content=$(hook_input tool_input.new_string)
if [ -z "$new_content" ]; then
	# MultiEdit: scan the joined new strings.
	new_content=$(hook_input tool_input.edits | jq -r '[.[]?.new_string // empty] | join("\n")' 2>/dev/null || true)
fi

# Anti-pattern token scan. ERE doesn't recognize `\b`, so use explicit
# character-class boundaries `(^|[^A-Za-z0-9_])...([^A-Za-z0-9_]|$)`, which
# behave the same as `\b` on every BSD/GNU grep without the non-portable `-P`.
# The `.skipIf(` / `.todoIf(` patterns carry a literal `(` so they only need a
# leading boundary.
weakened_patterns=(
	'(^|[^A-Za-z0-9_])it\.skip([^A-Za-z0-9_]|$)'
	'(^|[^A-Za-z0-9_])it\.todo([^A-Za-z0-9_]|$)'
	'(^|[^A-Za-z0-9_])it\.fails([^A-Za-z0-9_]|$)'
	'(^|[^A-Za-z0-9_])it\.concurrent([^A-Za-z0-9_]|$)'
	'(^|[^A-Za-z0-9_])test\.skip([^A-Za-z0-9_]|$)'
	'(^|[^A-Za-z0-9_])test\.todo([^A-Za-z0-9_]|$)'
	'(^|[^A-Za-z0-9_])test\.fails([^A-Za-z0-9_]|$)'
	'(^|[^A-Za-z0-9_])describe\.skip([^A-Za-z0-9_]|$)'
	'(^|[^A-Za-z0-9_])describe\.todo([^A-Za-z0-9_]|$)'
	'(^|[^A-Za-z0-9_])\.skipIf\('
	'(^|[^A-Za-z0-9_])\.todoIf\('
)

matched=""
for pattern in "${weakened_patterns[@]}"; do
	if printf '%s\n' "$new_content" | grep -E -q "$pattern"; then
		matched="$pattern"
		break
	fi
done

if [ -z "$matched" ]; then
	hook_noop
	exit 0
fi

cli=$(va_cli "$cwd") || {
	hook_noop
	exit 0
}

recorded_at=$(va_now)
diff_excerpt=$(printf '%s' "$new_content" | head -c 4096)

(cd "$cwd" && $cli agent record tdd-artifact \
	--chat-id "$chat_id" \
	--artifact-kind "test_weakened" \
	--file-path "$file_path" \
	--diff-excerpt "$diff_excerpt" \
	--recorded-at "$recorded_at" \
	>/dev/null 2>&1) ||
	true

hook_debug "detected weakening token $matched in $file_path — recorded as tdd_artifacts(kind='test_weakened')"

hook_noop
