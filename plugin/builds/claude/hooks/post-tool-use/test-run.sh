#!/bin/bash
# PostToolUse hook: detect vitest runs, associate the run with the current
# session, and suggest MCP tools for analysis when the run failed.

set -euo pipefail

. "$(dirname "$0")/../lib/pluginfinity/hook.sh"
. "$(dirname "$0")/../lib/vitest-agent/common.sh"
hook_require_input

command=$(hook_input tool_input.command)

# Does the command look like a test run? Matches `vitest`, `./vitest`,
# `npx vitest`, `pnpm exec vitest`, `pnpm vitest`, `bunx vitest`,
# `yarn vitest`, `pnpm test`, `npm test`, `bun test`, `yarn test`.
if ! printf '%s\n' "$command" | grep -qE '(^|/|npx[[:space:]]+|pnpm[[:space:]]+(exec[[:space:]]+)?|bunx[[:space:]]+|yarn[[:space:]]+)(vitest|jest)([[:space:]]|$)|([[:space:]]|^)(pnpm|npm|bun|yarn)[[:space:]]+(run[[:space:]]+)?test([[:space:]]|$)'; then
	hook_noop
	exit 0
fi

chat_id=$(hook_input session_id)
cwd=$(hook_input cwd)

# Associate the latest test run with the current session. Best-effort: errors
# are ignored so the hook never blocks on a DB failure. Both CLI calls discard
# stdout — `record test-case-turns` prints a JSON object that must not reach
# the host.
if [ -n "$chat_id" ] && [ -n "$cwd" ] && cli=$(va_cli "$cwd"); then
	(cd "$cwd" && $cli agent record run-trigger \
		--chat-id "$chat_id" \
		--invocation-method bash >/dev/null 2>&1) || true
	(cd "$cwd" && $cli agent record test-case-turns \
		--chat-id "$chat_id" >/dev/null 2>&1) || true
fi

exit_code=$(hook_input tool_response.exit_code)
[ -n "$exit_code" ] || exit_code=$(hook_input tool_response.code)
[ -n "$exit_code" ] || exit_code=0

if [ "$exit_code" != "0" ]; then
	hook_context "<test_failure_guidance>
Use MCP tools for analysis instead of re-running vitest via Bash:
- run_tests to re-run tests (uses Vitest programmatic API, updates the database)
- test({ action: 'get', fullName, project? }) for single-test drill-down with errors, history, and classification
- test_errors to search errors by type
- test_history to check if failures are flaky
- test({ action: 'for_file', filePath }) to find related tests
- file_coverage to check coverage for affected files
- note({ action: 'create', ... }) to record debugging findings

Prefer run_tests over vitest via Bash so results persist to the database and all query tools reflect the latest run.
</test_failure_guidance>"
else
	# Silent on success — repeated per-run tips desensitize the agent. The
	# failure path above is the only one that injects guidance.
	hook_noop
fi
