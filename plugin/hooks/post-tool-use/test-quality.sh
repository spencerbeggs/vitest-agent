#!/bin/bash
# PostToolUse hook on Edit/Write/MultiEdit to test files
# (matcher: agent_type=tdd-task).
#
# Detects escape-hatch tokens in the new file content and records a
# tdd_artifacts(kind='test_weakened') when they appear. Specifically
# matches anti-patterns 2 and 8 from the spec's "5+3" set:
#   - it.skip / it.todo / it.fails / it.concurrent
#   - test.skip / test.todo / test.fails
#   - describe.skip / describe.todo
#   - .skipIf / .todoIf  (Vitest-specific dynamic skips)
#
# Snapshot mutations are caught by the W2 restricted PreToolUse hook
# (which blocks .snap edits outright); this hook handles the runtime
# escape-hatch tokens.

set -euo pipefail

# shellcheck source=../lib/hook-output.sh
. "$(dirname "$0")/../lib/hook-output.sh"

hook_json=$(cat)

agent_type=$(echo "$hook_json" | jq -r '.agent_type // ""')
# shellcheck source=../lib/match-tdd-agent.sh
. "$(dirname "$0")/../lib/match-tdd-agent.sh"
if ! is_tdd_agent "$agent_type"; then
	emit_noop
	exit 0
fi

tool_name=$(echo "$hook_json" | jq -r '.tool_name // ""')
case "$tool_name" in
	Edit|Write|MultiEdit) ;;
	*) emit_noop; exit 0 ;;
esac

file_path=$(echo "$hook_json" | jq -r '.tool_input.file_path // .tool_input.path // ""')
case "$file_path" in
	*.test.ts|*.test.tsx|*.test.js|*.test.jsx|*.spec.ts|*.spec.tsx|*.spec.js|*.spec.jsx) ;;
	*) emit_noop; exit 0 ;;
esac

chat_id=$(echo "$hook_json" | jq -r '.session_id // ""')
cwd=$(echo "$hook_json" | jq -r '.cwd // ""')
if [ -z "$chat_id" ] || [ -z "$cwd" ]; then
	emit_noop
	exit 0
fi

# Capture the new content from any of the Edit / Write / MultiEdit shapes.
new_content=$(echo "$hook_json" | jq -r '.tool_input.content // .tool_input.new_string // ""')
if [ -z "$new_content" ]; then
	# MultiEdit: scan the joined new strings.
	new_content=$(echo "$hook_json" | jq -r '[.tool_input.edits[]?.new_string // empty] | join("\n")')
fi

# Anti-pattern token scan. ERE doesn't recognize `\b`, so the
# previous `\bit\.skip\b` patterns never matched anything — the
# escape-hatch detection was a silent no-op. Use explicit character-
# class boundaries `(^|[^A-Za-z0-9_])...([^A-Za-z0-9_]|$)` which
# behave the same as `\b` on every BSD/GNU grep without needing the
# non-portable `-P` (PCRE) flag (macOS BSD grep does not ship `-P`).
# The two `.skipIf(` / `.todoIf(` patterns already had a literal `(`
# trailing them so they only need a leading boundary.
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
	if echo "$new_content" | grep -E -q "$pattern"; then
		matched="$pattern"
		break
	fi
done

if [ -z "$matched" ]; then
	emit_noop
	exit 0
fi

# shellcheck source=../lib/detect-pm.sh
. "$(dirname "$0")/../lib/detect-pm.sh"
pm_exec=$(detect_pm_exec "$cwd")

recorded_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
diff_excerpt=$(echo "$new_content" | head -c 4096)

cd "$cwd" >/dev/null && $pm_exec vitest-agent record tdd-artifact \
	--chat-id "$chat_id" \
	--artifact-kind "test_weakened" \
	--file-path "$file_path" \
	--diff-excerpt "$diff_excerpt" \
	--recorded-at "$recorded_at" \
	>/dev/null 2>&1 \
	|| true

# Emit a soft warning back to the orchestrator's transcript.
echo "WARNING: detected weakening token $matched in $file_path — recorded as tdd_artifacts(kind='test_weakened')" >&2

emit_noop
exit 0
