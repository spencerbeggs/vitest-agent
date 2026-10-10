#!/bin/bash
# PostToolUse hook (scoped to agent_type=vitest-agent:tdd-task). Records
# tdd_artifacts rows reflecting what the orchestrator just did:
#  - Bash test run / run_tests MCP call -> test_passed_run / test_failed_run
#  - Edit/Write to *.test.* -> test_written
#  - Edit/Write to anything else -> code_written
#
# Per Decision D7, only hooks write artifacts; the agent never does.

set -euo pipefail

. "$(dirname "$0")/../lib/pluginfinity/hook.sh"
. "$(dirname "$0")/../lib/vitest-agent/common.sh"
hook_require_input

agent_type=$(hook_input agent_type)
if ! va_is_tdd_agent "$agent_type"; then
	hook_noop
	exit 0
fi

chat_id=$(hook_input session_id)
cwd=$(hook_input cwd)
tool_name=$(hook_input tool_name)

hook_debug "session_id=$chat_id tool=$tool_name cwd=$cwd"

if [ -z "$chat_id" ] || [ -z "$cwd" ]; then
	hook_noop
	exit 0
fi

cli=$(va_cli "$cwd") || {
	hook_noop
	exit 0
}

recorded_at=$(va_now)

# Issue #144 escape hatch: when the subagent's environment carries an explicit
# TDD task id (set for a detached session where neither the parent-session
# walk nor the conversation_id fallback resolves the right task), pass it
# through so `record tdd-artifact` bypasses chat-id -> session -> task
# resolution entirely. Ambient only: it is a deliberate per-dispatch override,
# not a session-env name.
tdd_task_id_arg=""
if [ -n "${VITEST_AGENT_TDD_TASK_ID:-}" ]; then
	tdd_task_id_arg="--tdd-task-id $VITEST_AGENT_TDD_TASK_ID"
fi

# Backfill test_cases.created_turn_id (BUG-2) and print the latest test case id
# for this session (BUG-1) as a `--test-case-id <id>` argument, or nothing.
latest_test_case_arg() {
	local out err rc id
	# Capture stderr separately (not 2>&1) so pnpm's stderr notices don't
	# corrupt the JSON the jq below parses for latestTestCaseId.
	err=$(mktemp)
	out=$(cd "$cwd" && $cli agent record test-case-turns \
		--chat-id "$chat_id" 2>"$err") || {
		rc=$?
		hook_log "record test-case-turns rc=$rc cc=$chat_id: $(cat "$err")"
	}
	rm -f "$err"
	hook_debug "record test-case-turns: $out"
	if [ -n "$out" ]; then
		id=$(printf '%s' "$out" | jq -r '.latestTestCaseId // empty' 2>/dev/null || echo "")
		if [ -n "$id" ] && [ "$id" != "null" ]; then
			printf -- '--test-case-id %s\n' "$id"
		fi
	fi
}

# record_artifact <kind> [extra args...]
record_artifact() {
	local kind=$1 out err rc
	shift
	err=$(mktemp)
	# shellcheck disable=SC2086
	out=$(cd "$cwd" && $cli agent record tdd-artifact \
		--chat-id "$chat_id" \
		--artifact-kind "$kind" \
		--recorded-at "$recorded_at" \
		"$@" $tdd_task_id_arg 2>"$err") || {
		rc=$?
		hook_log "record tdd-artifact kind=$kind rc=$rc cc=$chat_id: $(cat "$err")"
	}
	rm -f "$err"
	hook_debug "record tdd-artifact kind=$kind: $out"
}

mcp_op=$(va_mcp_op "$tool_name") || mcp_op=""

if [ "$tool_name" = "Bash" ]; then
	command=$(hook_input tool_input.command)
	# Match common test-runner invocations. The bats alternation (issue #360)
	# recognizes a bare `bats <path>` at the start of the command or after
	# `&&`/`;`/`|`, `pnpm exec bats`, `npx bats`, `bunx bats`, and a PM script
	# whose name contains `bats` (`pnpm run test:bats`, `npm run test:bats`,
	# `bun run test:bats`, `yarn test:bats`). The bare-`bats` half requires a
	# non-flag argument after `bats` so `bats --version` is excluded. The two
	# alternations are tested separately (issue #363) so a bats match can be
	# told apart from a vitest/jest match and the CLI told which suite recorded
	# the artifact — a PM-script name containing `bats` would otherwise also
	# satisfy the vitest pattern's substring match on `test`.
	bats_pattern='(^|[;&|]+)[[:space:]]*(pnpm exec |npx |bunx )?bats[[:space:]]+[^-]|(npm|pnpm|yarn|bun)[[:space:]]+(run[[:space:]]+)?[^[:space:]]*bats'
	vitest_pattern='(vitest|jest)|(npm|pnpm|yarn|bun) (run )?(test|vitest)'
	is_bats_match=0
	if printf '%s\n' "$command" | grep -E -q "$bats_pattern"; then
		is_bats_match=1
	fi
	if [ "$is_bats_match" -eq 1 ] || printf '%s\n' "$command" | grep -E -q "$vitest_pattern"; then
		# Exit code surfacing differs by Claude Code version; check both.
		exit_code=$(hook_input tool_response.exit_code)
		[ -n "$exit_code" ] || exit_code=$(hook_input tool_response.code)
		[ -n "$exit_code" ] || exit_code=0
		kind="test_passed_run"
		if [ "$exit_code" != "0" ]; then
			kind="test_failed_run"
		fi
		suite_args=()
		if [ "$is_bats_match" -eq 1 ]; then
			suite_args=(--suite bats)
		fi
		# shellcheck disable=SC2046
		record_artifact "$kind" $(latest_test_case_arg) ${suite_args[@]+"${suite_args[@]}"}
	fi
elif [ "$mcp_op" = "run_tests" ]; then
	# The orchestrator runs tests primarily through the run_tests MCP tool, so
	# a Bash-only matcher would silently miss every real test execution and
	# break evidence-based phase transitions.
	#
	# Claude Code surfaces MCP tool results with `tool_response` as an array of
	# `{ type, text }` content blocks. Since @vitest-agent/mcp retired its
	# markdown channel (#487) the text block is the result JSON,
	# `{"kind": "ok", "report": {"reason": "passed"|"failed"|...}, ...}`; older
	# servers sent a markdown headline (`## ✅ Vitest -- ...` /
	# `## ❌ Vitest -- N failed, ...`). Classify by that header first so both
	# keep working, then by JSON `.report.reason`. If neither matches
	# (timeout / run-failed / unrecognized shape), skip the artifact write
	# rather than guess — silent misclassification breaks evidence-based phase
	# transitions far more than a missing artifact does.
	response_text=$(hook_input tool_response | jq -r '
		if type == "array"
		then [.[] | select(.type? == "text") | .text] | join("\n")
		else tostring
		end
	' 2>/dev/null || hook_input tool_response)
	kind=""
	if printf '%s\n' "$response_text" | grep -q -E '^##[[:space:]]*✅[[:space:]]+Vitest'; then
		kind="test_passed_run"
	elif printf '%s\n' "$response_text" | grep -q -E '^##[[:space:]]*❌[[:space:]]+Vitest'; then
		kind="test_failed_run"
	else
		# JSON-format fallback. `.report.reason` is the AgentReport pass/fail
		# discriminator; non-JSON input parses to nothing.
		json_reason=$(printf '%s' "$response_text" | jq -r '.report.reason // empty' 2>/dev/null || true)
		case "$json_reason" in
		passed) kind="test_passed_run" ;;
		failed) kind="test_failed_run" ;;
			# interrupted -> no artifact (run was killed; not a clean signal).
			# error responses (VITEST_TIMEOUT / RUN_FAILED) lack .report
			# entirely so jq prints nothing and we skip.
		esac
	fi
	if [ -n "$kind" ]; then
		# For MCP run_tests, post-tool-use/test-run.sh does NOT fire, so this
		# is the only opportunity to backfill test-case turns.
		# shellcheck disable=SC2046
		record_artifact "$kind" $(latest_test_case_arg)
	fi
else
	case "$tool_name" in
	Edit | Write | MultiEdit)
		file_path=$(hook_input tool_input.file_path)
		if [ -z "$file_path" ]; then
			hook_noop
			exit 0
		fi
		case "$file_path" in
		*.test.ts | *.test.tsx | *.test.js | *.test.jsx | *.spec.ts | *.spec.tsx | *.spec.js | *.spec.jsx)
			kind="test_written"
			;;
		*)
			kind="code_written"
			;;
		esac
		record_artifact "$kind" --file-path "$file_path"
		;;
	esac
fi

hook_noop
