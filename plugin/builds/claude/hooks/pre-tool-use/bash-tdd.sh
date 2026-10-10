#!/bin/bash
# PreToolUse hook for the tdd-task subagent — restricted Bash and edits.
#
# Matches on agent_type='vitest-agent:tdd-task'. Blocks the W2 restricted
# command list (--update, -u, --reporter=silent, --bail, -t, --testNamePattern)
# plus anti-patterns 5-7 from the spec (coverage.exclude / setupFiles /
# globalSetup / *.snap edits).
#
# Matched-but-not-blocked tool calls fall through with no decision. Blocked
# calls are denied so the host surfaces the rejection to the orchestrator.

set -euo pipefail

. "$(dirname "$0")/../lib/pluginfinity/hook.sh"
. "$(dirname "$0")/../lib/vitest-agent/common.sh"
hook_require_input

agent_type=$(hook_input agent_type)
[ -n "$agent_type" ] || agent_type=$(hook_input matcher.agent_type)

# Only restrict inside the tdd-task agent.
if ! va_is_tdd_agent "$agent_type"; then
	hook_noop
	exit 0
fi

tool_name=$(hook_input tool_name)

# We only restrict Bash, Edit, Write, MultiEdit.
case "$tool_name" in
Bash | Edit | Write | MultiEdit) ;;
*)
	hook_noop
	exit 0
	;;
esac

if [ "$tool_name" = "Bash" ]; then
	command=$(hook_input tool_input.command)
	# Anti-pattern set: any flag/path that weakens the test signal.
	forbidden_patterns=(
		'--update'
		' -u( |$)'
		'--reporter=silent'
		'--bail(=| )'
		' -t( |$)'
		'--testNamePattern'
		# `.snap` as a whole extension, not a substring: `cells.snapshot.test.ts`
		# is an ordinary source file and naming it in a grep or a commit message
		# must not be denied (issue #247).
		'\.snap([^A-Za-z0-9]|$)'
	)
	for pattern in "${forbidden_patterns[@]}"; do
		if [[ "$command" =~ $pattern ]]; then
			hook_deny "tdd-task agent may not use $pattern (matched in: $command). Run tests via the run_tests MCP tool instead."
			exit 0
		fi
	done
	# Soft nudge: detect Vitest invocations across PM variants and remind the
	# orchestrator that run_tests is the preferred surface. Allows the command
	# through; the orchestrator reads the context on its next turn. Match any of:
	#   1. Bare `vitest`/`jest` at the start of a command segment (start of
	#      string, or after `&&`, `||`, `;`, `|`), so `grep vitest README.md`
	#      does not match.
	#   2. `<pm> [exec/run/x ]<vitest|test>` for npx/pnpx/pnpm/npm/yarn/bun/bunx.
	#   3. Bare bin path `./node_modules/.bin/vitest` (with or without `./`).
	if printf '%s\n' "$command" | grep -E -q '(^|&&[[:space:]]*|\|\|[[:space:]]*|;[[:space:]]*|\|[[:space:]]*)(vitest|jest)([[:space:]]|$)|(^|[[:space:]])(npx|pnpx|pnpm|npm|yarn|bun|bunx)[[:space:]]+(exec[[:space:]]+|run[[:space:]]+|x[[:space:]]+)?(vitest|test)([[:space:]:]|$)|(^|[[:space:]])(\./)?node_modules/\.bin/(vitest|jest)([[:space:]:]|$)'; then
		nudge=$(
			cat <<'EOF'
<run_tests_nudge>
You are about to run a Vitest invocation via the Bash tool. The
vitest-agent plugin exposes a run_tests MCP tool that should
be your default surface for test execution.

Why run_tests is preferred:
- It writes test_runs, test_history, and failure_signatures rows that
  the evidence-based phase-transition validator depends on.
- The PostToolUse TDD-artifact hook reads its structured response and
  records test_failed_run / test_passed_run with the right metadata,
  so your tdd_artifacts citations are well-formed.
- It returns a structured AgentReport so you do not have to parse raw
  Vitest output.

Bash vitest is acceptable only when you specifically need a Vitest
CLI flag run_tests does not expose. The canonical case is
--coverage for coverage-gap analysis. For ordinary red-green-refactor
test runs, switch to:

  run_tests({ project: "<name>", files: ["<path>", ...] })

This Bash invocation will run as requested. Treat this nudge as a
soft prompt: next test run, prefer run_tests unless you genuinely
need the CLI flag.
</run_tests_nudge>
EOF
		)
		hook_context "$nudge"
		exit 0
	fi
	hook_noop
	exit 0
fi

# Edit / Write / MultiEdit: block edits to config files that weaken the test
# signal.
file_path=$(hook_input tool_input.file_path)
if [ -z "$file_path" ]; then
	hook_noop
	exit 0
fi

# Snapshot files
if [[ "$file_path" =~ \.snap$ ]]; then
	hook_deny "tdd-task agent may not edit snapshot files: $file_path. Snapshot mutations hide test changes."
	exit 0
fi

# vitest config files: scan content for coverage.exclude / setupFiles / globalSetup
case "$file_path" in
*vitest.config.* | *vitest.workspace.* | *vite.config.*)
	new_content=$(hook_input tool_input.content)
	[ -n "$new_content" ] || new_content=$(hook_input tool_input.new_string)
	if [ -n "$new_content" ] && (printf '%s\n' "$new_content" | grep -E -q 'coverage\.exclude|setupFiles|globalSetup'); then
		hook_deny "tdd-task agent may not edit coverage.exclude / setupFiles / globalSetup in $file_path. These are signal-suppression vectors."
		exit 0
	fi
	;;
esac

hook_noop
