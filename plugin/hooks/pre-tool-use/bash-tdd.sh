#!/bin/bash
# PreToolUse hook for the tdd-task subagent — restricted Bash.
#
# Matches on agent_type='tdd-task'. Blocks the W2 restricted
# command list (--update, -u, --reporter=silent, --bail, -t,
# --testNamePattern) plus anti-patterns 5-7 from the spec
# (coverage.exclude / setupFiles / globalSetup / *.snap edits).
#
# Matched-but-not-blocked tool calls fall through (exit 0). Blocked
# calls return JSON with a permission decision of "deny" so Claude
# Code surfaces the rejection to the orchestrator.

set -euo pipefail

# shellcheck source=../lib/hook-output.sh
. "$(dirname "$0")/../lib/hook-output.sh"

hook_json=$(cat)

agent_type=$(echo "$hook_json" | jq -r '.agent_type // .matcher.agent_type // ""')

# Only restrict inside the tdd-task agent.
# shellcheck source=../lib/match-tdd-agent.sh
. "$(dirname "$0")/../lib/match-tdd-agent.sh"
if ! is_tdd_agent "$agent_type"; then
	emit_noop
	exit 0
fi

tool_name=$(echo "$hook_json" | jq -r '.tool_name // ""')

# We only restrict Bash, Edit, Write, MultiEdit.
case "$tool_name" in
	Bash|Edit|Write|MultiEdit) ;;
	*) emit_noop; exit 0 ;;
esac

if [ "$tool_name" = "Bash" ]; then
	command=$(echo "$hook_json" | jq -r '.tool_input.command // ""')
	# Anti-pattern set: any flag/path that weakens the test signal.
	forbidden_patterns=(
		'--update'
		' -u( |$)'
		'--reporter=silent'
		'--bail(=| )'
		' -t( |$)'
		'--testNamePattern'
		'\.snap'
	)
	for pattern in "${forbidden_patterns[@]}"; do
		if [[ "$command" =~ $pattern ]]; then
			emit_deny "tdd-task agent may not use $pattern (matched in: $command). Run tests via the run_tests MCP tool instead."
			exit 0
		fi
	done
	# Soft nudge: detect Vitest invocations across PM variants and
	# remind the orchestrator that run_tests is the preferred surface.
	# Allows the command through; the orchestrator can read the
	# additionalContext on its next turn and switch tools next time.
	# Match any of:
	#   1. Bare `vitest`/`jest` at the start of a command segment
	#      (start of string, or after `&&`, `||`, `;`, `|`). Anchoring
	#      avoids false positives like `grep vitest README.md`.
	#   2. `<pm> [exec/run/x ]<vitest|test>` for the package-manager
	#      runners npx/pnpx/pnpm/npm/yarn/bun/bunx. The intermediate
	#      `exec`/`run`/`x` is optional so we catch shorthand forms
	#      like `pnpm vitest run X` and single-word runners
	#      (`bunx vitest`, `pnpx vitest`).
	#   3. Bare bin path `./node_modules/.bin/vitest` (with or without
	#      the leading `./`).
	if echo "$command" | grep -E -q '(^|&&[[:space:]]*|\|\|[[:space:]]*|;[[:space:]]*|\|[[:space:]]*)(vitest|jest)([[:space:]]|$)|(^|[[:space:]])(npx|pnpx|pnpm|npm|yarn|bun|bunx)[[:space:]]+(exec[[:space:]]+|run[[:space:]]+|x[[:space:]]+)?(vitest|test)([[:space:]:]|$)|(^|[[:space:]])(\./)?node_modules/\.bin/(vitest|jest)([[:space:]:]|$)'; then
		nudge=$(cat <<'EOF'
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
- It returns a structured AgentReport (markdown or JSON) so you do
  not have to parse raw Vitest output.

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
		emit_additional_context "PreToolUse" "$nudge"
		exit 0
	fi
	emit_noop
	exit 0
fi

# Edit / Write / MultiEdit: block edits to config files that weaken
# the test signal.
file_path=$(echo "$hook_json" | jq -r '.tool_input.file_path // .tool_input.path // ""')
if [ -z "$file_path" ]; then
	emit_noop
	exit 0
fi

# Snapshot files
if [[ "$file_path" =~ \.snap$ ]]; then
	emit_deny "tdd-task agent may not edit snapshot files: $file_path. Snapshot mutations hide test changes."
	exit 0
fi

# vitest config files: scan content for coverage.exclude / setupFiles / globalSetup
case "$file_path" in
	*vitest.config.*|*vitest.workspace.*|*vite.config.*)
		new_content=$(echo "$hook_json" | jq -r '.tool_input.content // .tool_input.new_string // ""')
		if [ -n "$new_content" ] && (echo "$new_content" | grep -E -q 'coverage\.exclude|setupFiles|globalSetup'); then
			emit_deny "tdd-task agent may not edit coverage.exclude / setupFiles / globalSetup in $file_path. These are signal-suppression vectors."
			exit 0
		fi
		;;
esac

emit_noop
exit 0
