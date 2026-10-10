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

# Opt-out. Checked before anything else so a consumer who hits a wrong deny
# (custom DiscoverStrategy the CLI's lexical detector missed, or any other
# false positive) can disable the hook entirely without touching the plugin.
# The library still loads first so it consumes stdin and owns the response.
. "$(dirname "$0")/../lib/pluginfinity/hook.sh"
case "${VITEST_AGENT_TEST_LOCATION_HOOK:-}" in
off | 0 | false)
	hook_noop
	exit 0
	;;
esac

. "$(dirname "$0")/../lib/vitest-agent/common.sh"
hook_require_input

tool_name=$(hook_input tool_name)
case "$tool_name" in
Read | Write | Edit | MultiEdit) ;;
*)
	hook_noop
	exit 0
	;;
esac

file_path=$(hook_input tool_input.file_path)
if [ -z "$file_path" ]; then
	hook_noop
	exit 0
fi

# Prefilter: purely lexical, no layout knowledge, no process spawn. The
# overwhelming majority of tool calls leave here at zero cost. Scoping to these
# extensions also keeps the hook off non-Vitest suites — the .bats files under
# plugin/__test__/ are correct where they are.
case "$(basename "$file_path")" in
*.test.ts | *.test.tsx | *.test.js | *.test.jsx | *.spec.ts | *.spec.tsx | *.spec.js | *.spec.jsx) ;;
*)
	hook_noop
	exit 0
	;;
esac

# Resolve the CLI through the shared helper: VITEST_AGENT_CLI_CMD overrides
# (tests, or anyone with the bin on PATH directly), then the project's own
# node_modules/.bin/vitest-agent, then `vitest-agent` on PATH.
cwd=$(hook_input cwd)
[ -n "$cwd" ] || cwd=$(hook_session_dir)
cli_cmd=$(va_cli "$cwd") || {
	hook_noop
	exit 0
}

# Unquoted on purpose — cli_cmd may carry a subcommand and must word-split.
# The `cd "$cwd"` is load-bearing: va_cli returns a RELATIVE node_modules/.bin
# path so a space in the project path cannot break the unquoted expansion.
# shellcheck disable=SC2086
if ! verdict_json=$(cd "$cwd" && $cli_cmd agent check-test-path "$file_path" 2>/dev/null); then
	hook_debug "check-test-path failed for $file_path"
	hook_noop
	exit 0
fi

verdict=$(printf '%s' "$verdict_json" | jq -r '.verdict // ""' 2>/dev/null || echo "")
if [ "$verdict" != "invalid" ]; then
	hook_noop
	exit 0
fi

suggested=$(printf '%s' "$verdict_json" | jq -r '.suggestedPath // ""' 2>/dev/null || echo "")

if [ "$tool_name" = "Write" ] && [ ! -e "$file_path" ]; then
	hook_deny "$(printf '%s is not a valid test location — Vitest will never collect it.\n\nUnder the default discovery layout, tests are collected only under a workspace src/ or __test__/ directory. Write it to %s instead.\n\nIf your project uses a custom DiscoverStrategy this check does not understand, set VITEST_AGENT_TEST_LOCATION_HOOK=off to disable this check.' "$file_path" "$suggested")"
	exit 0
fi

hook_context "$(printf 'Note: %s sits outside the discoverable test layout, so Vitest does not collect it and it never runs.\n\nUnder the default discovery layout, tests are collected only under a workspace src/ or __test__/ directory. The corresponding valid location is %s.' "$file_path" "$suggested")"
