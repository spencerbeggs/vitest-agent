#!/bin/bash
# PreToolUse hook — invalid test location detector.
#
# A test file is discoverable only at <workspace>/src/** or
# <workspace>/__test__/**, excluding the helper directories under __test__/.
# Anywhere else, discovery silently collects nothing — which is exactly the
# failure mode of issue #184, where a test sat unrun and nothing said so.
#
# This hook never implements that rule. It applies one purely lexical
# prefilter (is the basename shaped like a test file?) and delegates every
# judgement to `vitest-agent agent check-test-path`, which shares its
# implementation with the discovery globs. Re-deriving the rule here in bash
# would recreate the two-sources-of-truth defect that caused issue #227.
#
# Denies only the CREATION of a new test at an invalid path — the file does
# not exist yet, so no existing layout can be broken. Everything else advises.
# Every error path fails open.

set -euo pipefail

# shellcheck source=../lib/hook-output.sh
. "$(dirname "$0")/../lib/hook-output.sh"
# shellcheck source=../lib/hook-debug.sh
. "$(dirname "$0")/../lib/hook-debug.sh"

hook_json=$(cat)

tool_name=$(echo "$hook_json" | jq -r '.tool_name // ""' 2>/dev/null || echo "")
case "$tool_name" in
	Read|Write|Edit|MultiEdit) ;;
	*) emit_noop; exit 0 ;;
esac

file_path=$(echo "$hook_json" | jq -r '.tool_input.file_path // ""' 2>/dev/null || echo "")
if [ -z "$file_path" ]; then
	emit_noop
	exit 0
fi

# Prefilter: purely lexical, no layout knowledge, no process spawn. The
# overwhelming majority of tool calls leave here at zero cost. Scoping to
# these extensions also keeps the hook off non-Vitest suites — the .bats
# files under plugin/hooks/__test__/ are correct where they are.
case "$(basename "$file_path")" in
	*.test.ts|*.test.tsx|*.test.js|*.test.jsx|*.spec.ts|*.spec.tsx|*.spec.js|*.spec.jsx) ;;
	*) emit_noop; exit 0 ;;
esac

# Resolve the CLI. VITEST_AGENT_CLI_CMD overrides for tests and for anyone
# who has the bin on PATH directly; otherwise route through the detected
# package manager the way every other hook does.
cli_cmd=${VITEST_AGENT_CLI_CMD:-}
if [ -z "$cli_cmd" ]; then
	cwd=$(echo "$hook_json" | jq -r '.cwd // ""' 2>/dev/null || echo "")
	[ -n "$cwd" ] || cwd="${CLAUDE_PROJECT_DIR:-.}"
	# shellcheck source=../lib/detect-pm.sh
	. "$(dirname "$0")/../lib/detect-pm.sh"
	pm_exec=$(detect_pm_exec "$cwd")
	cli_cmd="$pm_exec vitest-agent"
fi

# Unquoted on purpose — cli_cmd may carry a subcommand (e.g. "pnpm exec
# vitest-agent") and must word-split, matching the $pm_exec usage in
# post-tool-use/git-commit.sh.
# shellcheck disable=SC2086
if ! verdict_json=$($cli_cmd agent check-test-path "$file_path" 2>/dev/null); then
	hook_debug "check-test-path failed for $file_path"
	emit_noop
	exit 0
fi

verdict=$(echo "$verdict_json" | jq -r '.verdict // ""' 2>/dev/null || echo "")
if [ "$verdict" != "invalid" ]; then
	emit_noop
	exit 0
fi

suggested=$(echo "$verdict_json" | jq -r '.suggestedPath // ""' 2>/dev/null || echo "")

if [ "$tool_name" = "Write" ] && [ ! -e "$file_path" ]; then
	emit_deny "$(printf '%s is not a valid test location — Vitest will never collect it.\n\nTests are discoverable only under a workspace src/ or __test__/ directory. Write it to %s instead.' "$file_path" "$suggested")"
	exit 0
fi

emit_additional_context "PreToolUse" "$(printf 'Note: %s sits outside the discoverable test layout, so Vitest does not collect it and it never runs.\n\nTests are discoverable only under a workspace src/ or __test__/ directory. The corresponding valid location is %s.' "$file_path" "$suggested")"
exit 0
