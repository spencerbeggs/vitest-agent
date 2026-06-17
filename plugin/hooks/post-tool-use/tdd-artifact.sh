#!/bin/bash
# PostToolUse hook (matcher: agent_type=tdd-task). Records
# tdd_artifacts rows reflecting what the orchestrator just did:
#  - Bash test run -> test_passed_run / test_failed_run
#  - Edit/Write to *.test.* -> test_written
#  - Edit/Write to anything else -> code_written
#
# Per Decision D7, only hooks write artifacts; the agent never does.

set -euo pipefail

# shellcheck source=../lib/hook-output.sh
. "$(dirname "$0")/../lib/hook-output.sh"
# shellcheck source=../lib/hook-debug.sh
. "$(dirname "$0")/../lib/hook-debug.sh"

_HOOK="post-tool-use-tdd-artifact"

hook_json=$(cat)

agent_type=$(echo "$hook_json" | jq -r '.agent_type // ""')
# shellcheck source=../lib/match-tdd-agent.sh
. "$(dirname "$0")/../lib/match-tdd-agent.sh"
if ! is_tdd_agent "$agent_type"; then
	emit_noop
	exit 0
fi

chat_id=$(echo "$hook_json" | jq -r '.session_id // ""')
cwd=$(echo "$hook_json" | jq -r '.cwd // ""')
tool_name=$(echo "$hook_json" | jq -r '.tool_name // ""')

hook_debug "$_HOOK" "INPUT session_id=$chat_id tool=$tool_name cwd=$cwd"

if [ -z "$chat_id" ] || [ -z "$cwd" ]; then
	emit_noop
	exit 0
fi

# shellcheck source=../lib/detect-pm.sh
. "$(dirname "$0")/../lib/detect-pm.sh"
pm_exec=$(detect_pm_exec "$cwd")

hook_debug "$_HOOK" "pm_exec=$pm_exec"

recorded_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

case "$tool_name" in
	Bash)
		command=$(echo "$hook_json" | jq -r '.tool_input.command // ""')
		# Match common test-runner invocations.
		if echo "$command" | grep -E -q '(vitest|jest)|(npm|pnpm|yarn|bun) (run )?(test|vitest)'; then
			# Exit code surfacing differs by Claude Code version; check both.
			exit_code=$(echo "$hook_json" | jq -r '.tool_response.exit_code // .tool_response.code // 0')
			kind="test_passed_run"
			if [ "$exit_code" != "0" ]; then
				kind="test_failed_run"
			fi
			# Backfill test_cases.created_turn_id (BUG-2) and get latest test
			# case id for this session (BUG-1) in one call.
			test_case_id_arg=""
			# Capture stderr separately (not 2>&1) so pnpm's stderr notices don't
			# corrupt the JSON the jq below parses for latestTestCaseId.
			_turns_err=$(mktemp)
			_turns_out=$(cd "$cwd" && $pm_exec vitest-agent agent record test-case-turns \
				--chat-id "$chat_id" 2>"$_turns_err") || {
				_rc=$?
				hook_error "$_HOOK" "record test-case-turns rc=$_rc cc=$chat_id: $(cat "$_turns_err")"
			}
			rm -f "$_turns_err"
			hook_debug "$_HOOK" "record test-case-turns: $_turns_out"
			if [ -n "$_turns_out" ]; then
				latest_id=$(echo "$_turns_out" | jq -r '.latestTestCaseId // empty' 2>/dev/null || echo "")
				if [ -n "$latest_id" ] && [ "$latest_id" != "null" ]; then
					test_case_id_arg="--test-case-id $latest_id"
				fi
			fi
			_artifact_err=$(mktemp)
			# shellcheck disable=SC2086
			_artifact_out=$(cd "$cwd" && $pm_exec vitest-agent agent record tdd-artifact \
				--chat-id "$chat_id" \
				--artifact-kind "$kind" \
				--recorded-at "$recorded_at" \
				$test_case_id_arg 2>"$_artifact_err") || {
				_rc=$?
				hook_error "$_HOOK" "record tdd-artifact kind=$kind rc=$_rc cc=$chat_id: $(cat "$_artifact_err")"
			}
			rm -f "$_artifact_err"
			hook_debug "$_HOOK" "record tdd-artifact kind=$kind: $_artifact_out"
		fi
		;;
	mcp__plugin_vitest-agent_mcp__run_tests | mcp__vitest-agent_mcp__run_tests)
		# The orchestrator runs tests primarily through the run_tests
		# MCP tool, so a Bash-only matcher would silently miss every
		# real test execution and break evidence-based phase
		# transitions. Match both the plugin-namespaced tool name
		# (Claude Code emits `mcp__plugin_<plugin>_<server>__<op>` for
		# plugin-bundled MCP servers) and the legacy bare prefix.
		#
		# Claude Code surfaces MCP tool results with `tool_response`
		# as an array of `{ type, text }` content blocks, NOT a
		# `tool_response.content[]` object. `formatReportMarkdown`
		# emits `## ✅ Vitest -- ...` on success and
		# `## ❌ Vitest -- N failed, ...` on failure. `formatReportJson`
		# emits `{"report": {"reason": "passed"|"failed"|...}, ...}`.
		# Classify by markdown header first, fall back to JSON
		# `.report.reason`. If neither matches (timeout / run-failed
		# / unrecognized shape), skip the artifact write rather than
		# guess — silent misclassification breaks evidence-based
		# phase transitions far more than a missing artifact does.
		response_text=$(echo "$hook_json" | jq -r '
			if (.tool_response | type) == "array"
			then [.tool_response[] | select(.type? == "text") | .text] | join("\n")
			else (.tool_response | tostring)
			end
		')
		kind=""
		if echo "$response_text" | grep -q -E '^##[[:space:]]*✅[[:space:]]+Vitest'; then
			kind="test_passed_run"
		elif echo "$response_text" | grep -q -E '^##[[:space:]]*❌[[:space:]]+Vitest'; then
			kind="test_failed_run"
		else
			# JSON-format fallback. `.report.reason` is the AgentReport
			# pass/fail discriminator. The 2>/dev/null swallows non-JSON
			# inputs cleanly (jq prints a parse error on stderr otherwise).
			json_reason=$(echo "$response_text" | jq -r '.report.reason // empty' 2>/dev/null || true)
			case "$json_reason" in
				passed) kind="test_passed_run" ;;
				failed) kind="test_failed_run" ;;
				# interrupted -> no artifact (run was killed; not a clean signal).
				# error responses (VITEST_TIMEOUT / RUN_FAILED) lack .report
				# entirely so jq returns empty and we skip.
			esac
		fi
		if [ -n "$kind" ]; then
			# Backfill test_cases.created_turn_id (BUG-2) and get latest test
			# case id for this session (BUG-1). For MCP run_tests, post-test-run.sh
			# does NOT fire, so this is the only opportunity to backfill.
			test_case_id_arg=""
			# Capture stderr separately (not 2>&1) so pnpm's stderr notices don't
			# corrupt the JSON the jq below parses for latestTestCaseId.
			_turns_err=$(mktemp)
			_turns_out=$(cd "$cwd" && $pm_exec vitest-agent agent record test-case-turns \
				--chat-id "$chat_id" 2>"$_turns_err") || {
				_rc=$?
				hook_error "$_HOOK" "record test-case-turns rc=$_rc cc=$chat_id: $(cat "$_turns_err")"
			}
			rm -f "$_turns_err"
			hook_debug "$_HOOK" "record test-case-turns: $_turns_out"
			if [ -n "$_turns_out" ]; then
				latest_id=$(echo "$_turns_out" | jq -r '.latestTestCaseId // empty' 2>/dev/null || echo "")
				if [ -n "$latest_id" ] && [ "$latest_id" != "null" ]; then
					test_case_id_arg="--test-case-id $latest_id"
				fi
			fi
			_artifact_err=$(mktemp)
			# shellcheck disable=SC2086
			_artifact_out=$(cd "$cwd" && $pm_exec vitest-agent agent record tdd-artifact \
				--chat-id "$chat_id" \
				--artifact-kind "$kind" \
				--recorded-at "$recorded_at" \
				$test_case_id_arg 2>"$_artifact_err") || {
				_rc=$?
				hook_error "$_HOOK" "record tdd-artifact kind=$kind rc=$_rc cc=$chat_id: $(cat "$_artifact_err")"
			}
			rm -f "$_artifact_err"
			hook_debug "$_HOOK" "record tdd-artifact kind=$kind: $_artifact_out"
		fi
		;;
	Edit|Write|MultiEdit)
		file_path=$(echo "$hook_json" | jq -r '.tool_input.file_path // .tool_input.path // ""')
		if [ -z "$file_path" ]; then
			emit_noop
			exit 0
		fi
		case "$file_path" in
			*.test.ts|*.test.tsx|*.test.js|*.test.jsx|*.spec.ts|*.spec.tsx|*.spec.js|*.spec.jsx)
				kind="test_written"
				;;
			*)
				kind="code_written"
				;;
		esac
		_artifact_err=$(mktemp)
		_artifact_out=$(cd "$cwd" && $pm_exec vitest-agent agent record tdd-artifact \
			--chat-id "$chat_id" \
			--artifact-kind "$kind" \
			--file-path "$file_path" \
			--recorded-at "$recorded_at" 2>"$_artifact_err") || {
			_rc=$?
			hook_error "$_HOOK" "record tdd-artifact kind=$kind rc=$_rc cc=$chat_id file=$file_path: $(cat "$_artifact_err")"
		}
		rm -f "$_artifact_err"
		hook_debug "$_HOOK" "record tdd-artifact kind=$kind file=$file_path: $_artifact_out"
		;;
esac

emit_noop
exit 0
