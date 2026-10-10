#!/usr/bin/env bats
# cli-rename-cascade.bats — every hook script that shells out to the
# vitest-agent CLI uses the `agent` subcommand namespace introduced in T8,
# never the pre-T8 `_internal` / bare `record` / bare `triage` / bare `wrapup`
# forms. Runs every hook from both builds.
#
# Strategy: every hook resolves the CLI through va_cli
# (hooks/lib/vitest-agent/common.sh), whose first rung is the
# VITEST_AGENT_CLI_CMD override — the seam va_hook uses to route each hook at a
# fake `vitest-agent` that records its argv, so each test can assert the exact
# subcommand path.

load common

setup() {
	va_stub_cli
}

# Every captured call uses the `agent` namespace.
_assert_agent_namespace() {
	run grep -E '^(record|wrapup|triage|_internal)|_internal' "$VA_CAPTURE"
	[ "$status" -ne 0 ]
}

@test "pre-tool-use/record.sh calls 'agent record turn'" {
	for t in "${VA_TARGETS[@]}"; do
		va_argv_reset
		va_hook "$t" hooks/pre-tool-use/record.sh "$(va_fx pre-tool-use-record.json)"
		assert_hook_noop
		[[ "$(va_argv_nth 1)" == agent\ record\ turn* ]]
	done
}

@test "pre-tool-use/bash.sh calls 'agent inject-env' when no main-agent identity is known" {
	for t in "${VA_TARGETS[@]}"; do
		va_argv_reset
		va_hook "$t" hooks/pre-tool-use/bash.sh "$(va_fx pre-tool-use-bash.json)"
		assert_hook_exit 0
		[[ "$(va_argv_nth 1)" == agent\ inject-env* ]]
	done
}

@test "pre-compact/record.sh calls only 'agent record turn'" {
	for t in "${VA_TARGETS[@]}"; do
		va_argv_reset
		va_hook "$t" hooks/pre-compact/record.sh "$(va_fx pre-compact.json)"
		assert_hook_noop
		[[ "$(va_argv_nth 1)" == agent\ record\ turn* ]]
		[ "$(va_argv_count)" -eq 1 ]
		_assert_agent_namespace
	done
}

@test "user-prompt-submit/record.sh records the prompt on both hosts and computes the nudge on Claude Code" {
	va_hook claude hooks/user-prompt-submit/record.sh "$(va_fx user-prompt-submit.json)"
	[[ "$(va_argv_nth 1)" == agent\ record\ turn* ]]
	[[ "$(va_argv_nth 2)" == agent\ wrapup* ]]
	# Copilot drops UserPromptSubmit output, so the nudge is not computed there.
	va_argv_reset
	va_hook copilot hooks/user-prompt-submit/record.sh "$(va_fx user-prompt-submit.json)"
	assert_hook_noop
	[[ "$(va_argv_nth 1)" == agent\ record\ turn* ]]
	[ "$(va_argv_count)" -eq 1 ]
}

@test "stop/record.sh records the firing on both hosts and computes the wrap-up on Claude Code" {
	va_hook claude hooks/stop/record.sh "$(va_fx stop.json)"
	[[ "$(va_argv_nth 1)" == agent\ record\ turn* ]]
	[[ "$(va_argv_nth 2)" == agent\ wrapup* ]]
	va_argv_reset
	va_hook copilot hooks/stop/record.sh "$(va_fx stop.json)"
	assert_hook_noop
	[[ "$(va_argv_nth 1)" == agent\ record\ turn* ]]
	[ "$(va_argv_count)" -eq 1 ]
}

@test "stop/record.sh shows a non-empty wrap-up as a Claude Code system message" {
	va_stub_cli '*wrapup*) echo "## Wrap up" ;;'
	va_hook claude hooks/stop/record.sh "$(va_fx stop.json)"
	assert_hook_json .systemMessage "## Wrap up"
}

@test "post-tool-use/test-quality.sh calls 'agent record tdd-artifact' on a weakened test" {
	local fx
	fx=$(hook_fixture PostToolUse '{"agent_type":"vitest-agent:tdd-task","tool_name":"Write","tool_use_id":"toolu_bats_weakened_001","tool_input":{"file_path":"/tmp/example.test.ts","content":"it.skip(\"skipped test\", () => { expect(1).toBe(1); });"},"tool_response":{"success":true}}')
	for t in "${VA_TARGETS[@]}"; do
		va_argv_reset
		va_hook "$t" hooks/post-tool-use/test-quality.sh "$fx"
		assert_hook_noop
		[[ "$(va_argv_nth 1)" == agent\ record\ tdd-artifact* ]]
		[[ "$(va_argv_nth 1)" == *"--artifact-kind test_weakened"* ]]
	done
}

@test "post-tool-use/record.sh records a tool_result turn and a file_edit turn" {
	for t in "${VA_TARGETS[@]}"; do
		va_argv_reset
		va_hook "$t" hooks/post-tool-use/record.sh "$(va_fx post-tool-use-record-write.json)"
		assert_hook_noop
		[ "$(va_argv_count)" -eq 2 ]
		[[ "$(va_argv_nth 1)" == agent\ record\ turn*'"type":"tool_result"'* ]]
		[[ "$(va_argv_nth 2)" == agent\ record\ turn*'"type":"file_edit"'* ]]
	done
}

@test "post-tool-use/tdd-artifact.sh records test-case turns then the artifact on a run_tests pass" {
	for t in "${VA_TARGETS[@]}"; do
		va_argv_reset
		va_hook "$t" hooks/post-tool-use/tdd-artifact.sh "$(va_fx post-tool-use-run-tests-pass.json)"
		assert_hook_noop
		[[ "$(va_argv_nth 1)" == agent\ record\ test-case-turns* ]]
		[[ "$(va_argv_nth 2)" == agent\ record\ tdd-artifact*"--artifact-kind test_passed_run"* ]]
	done
}

@test "post-tool-use/tdd-artifact.sh classifies a failing run_tests result" {
	for t in "${VA_TARGETS[@]}"; do
		va_argv_reset
		va_hook "$t" hooks/post-tool-use/tdd-artifact.sh "$(va_fx post-tool-use-run-tests-fail.json)"
		[[ "$(va_argv_grep 'agent record tdd-artifact')" == *"--artifact-kind test_failed_run"* ]]
	done
}

@test "post-tool-use/tdd-artifact.sh classifies a JSON run_tests result by report.reason" {
	local fx
	fx=$(va_fx post-tool-use-run-tests-pass.json '{"tool_response":[{"type":"text","text":"{\"kind\":\"ok\",\"report\":{\"reason\":\"failed\"}}"}]}')
	for t in "${VA_TARGETS[@]}"; do
		va_argv_reset
		va_hook "$t" hooks/post-tool-use/tdd-artifact.sh "$fx"
		[[ "$(va_argv_grep 'agent record tdd-artifact')" == *"--artifact-kind test_failed_run"* ]]
	done
}

@test "post-tool-use/tdd-artifact.sh records test_written / code_written for edits" {
	for t in "${VA_TARGETS[@]}"; do
		va_argv_reset
		va_hook "$t" hooks/post-tool-use/tdd-artifact.sh "$(va_fx post-tool-use-write-test.json)"
		[[ "$(va_argv_nth 1)" == agent\ record\ tdd-artifact*"--artifact-kind test_written"* ]]
		va_argv_reset
		va_hook "$t" hooks/post-tool-use/tdd-artifact.sh "$(va_fx post-tool-use-edit-prod.json)"
		[[ "$(va_argv_nth 1)" == agent\ record\ tdd-artifact*"--artifact-kind code_written"* ]]
	done
}

@test "post-tool-use/test-run.sh records the run trigger and test-case turns" {
	for t in "${VA_TARGETS[@]}"; do
		va_argv_reset
		va_hook "$t" hooks/post-tool-use/test-run.sh "$(va_fx post-tool-use-bash-vitest.json)" --matcher Bash
		assert_hook_noop
		[[ "$(va_argv_grep 'agent record run-trigger')" == agent\ record\ run-trigger* ]]
		[[ "$(va_argv_grep 'agent record test-case-turns')" == agent\ record\ test-case-turns* ]]
	done
}

@test "post-tool-use/test-run.sh adds failure guidance after a failed run" {
	local fx
	fx=$(va_fx post-tool-use-bash-vitest.json '{"tool_response":{"exit_code":1}}')
	for t in "${VA_TARGETS[@]}"; do
		va_hook "$t" hooks/post-tool-use/test-run.sh "$fx" --matcher Bash
		[[ "$(va_context "$t")" == *"<test_failure_guidance>"* ]]
	done
}

@test "post-tool-use/git-commit.sh calls 'agent record run-workspace-changes' after git commit" {
	local project
	project=$(va_project)
	git -C "$project" init -q
	git -C "$project" -c user.name=bats -c user.email=bats@example.com commit -q --allow-empty -m "test: add new test"
	for t in "${VA_TARGETS[@]}"; do
		va_argv_reset
		va_hook "$t" hooks/post-tool-use/git-commit.sh "$(va_fx post-tool-use-bash-git-commit.json)" --matcher Bash
		assert_hook_noop
		[[ "$(va_argv_nth 1)" == agent\ record\ run-workspace-changes*"--message test: add new test"* ]]
		_assert_agent_namespace
	done
}

@test "subagent/start-tdd.sh calls 'agent record session-start' and, with a main agent, 'agent register-agent'" {
	local seed
	seed=$(va_session_env VITEST_AGENT_MAIN_AGENT_ID=fake-main-agent-uuid-001)
	for t in "${VA_TARGETS[@]}"; do
		va_argv_reset
		va_hook "$t" hooks/subagent/start-tdd.sh "$(va_fx subagent-start-tdd.json)" --session-env "$seed"
		assert_hook_noop
		[[ "$(va_argv_grep 'agent record session-start')" == agent\ record\ session-start* ]]
		[[ "$(va_argv_grep 'agent register-agent')" == *"--parent-agent-id fake-main-agent-uuid-001"* ]]
		_assert_agent_namespace
	done
}

@test "subagent/start-tdd.sh skips register-agent without a main agent" {
	for t in "${VA_TARGETS[@]}"; do
		va_argv_reset
		va_hook "$t" hooks/subagent/start-tdd.sh "$(va_fx subagent-start-tdd.json)"
		[ -z "$(va_argv_grep 'agent register-agent')" ]
	done
}

@test "subagent/stop-tdd.sh calls 'agent wrapup' and records the handoff note" {
	va_stub_cli '*wrapup*) printf "## TDD Handoff\nSome handoff content.\n" ;;'
	for t in "${VA_TARGETS[@]}"; do
		va_argv_reset
		va_hook "$t" hooks/subagent/stop-tdd.sh "$(va_fx subagent-stop-tdd.json)"
		assert_hook_noop
		[[ "$(va_argv_grep 'agent wrapup')" == *"--kind tdd_handoff"* ]]
		[[ "$(va_argv_grep 'agent record turn')" == *"--chat-id test-parent-session-id-001"* ]]
	done
}

@test "session/start.sh calls 'agent triage', 'agent record session-start' and 'agent register-agent'" {
	for t in "${VA_TARGETS[@]}"; do
		va_argv_reset
		va_hook "$t" hooks/session/start.sh "$(va_fx session-start.json)"
		assert_hook_exit 0
		[[ "$(va_argv_nth 1)" == agent\ triage* ]]
		[[ "$(va_argv_grep 'agent record session-start')" == agent\ record\ session-start* ]]
		[[ "$(va_argv_grep 'agent register-agent')" == agent\ register-agent* ]]
		_assert_agent_namespace
	done
}

@test "session/start.sh injects the orientation context on both hosts" {
	for t in "${VA_TARGETS[@]}"; do
		va_hook "$t" hooks/session/start.sh "$(va_fx session-start.json)"
		[[ "$(va_context "$t")" == *"<vitest_agent_reporter>"* ]]
		[[ "$(va_context "$t")" == *"test-session-id-bats-001"* ]]
	done
}

@test "end-record-worker.sh calls 'agent record turn' and 'agent record session-end'" {
	for t in "${VA_TARGETS[@]}"; do
		va_argv_reset
		run_script "$t" hooks/session/end-record-worker.sh --env VITEST_AGENT_CLI_CMD="$VA_STUB" \
			test-session-id-bats-001 "$(va_project)" other
		[ "$status" -eq 0 ]
		[ -z "$output" ]
		[[ "$(va_argv_nth 1)" == agent\ record\ turn* ]]
		[[ "$(va_argv_nth 2)" == agent\ record\ session-end*"--end-reason other"* ]]
		[ -z "$(va_argv_grep 'agent end-agent')" ]
		_assert_agent_namespace
	done
}

@test "end-record-worker.sh calls 'agent end-agent' when VITEST_AGENT_MAIN_AGENT_ID is set" {
	for t in "${VA_TARGETS[@]}"; do
		va_argv_reset
		run_script "$t" hooks/session/end-record-worker.sh --env VITEST_AGENT_CLI_CMD="$VA_STUB" \
			--env VITEST_AGENT_MAIN_AGENT_ID=fake-main-agent-uuid-001 \
			test-session-id-bats-001 "$(va_project)" other
		[ "$status" -eq 0 ]
		[[ "$(va_argv_grep 'agent end-agent')" == *"--agent-id fake-main-agent-uuid-001 --host-session-id test-session-id-bats-001"* ]]
	done
}

@test "session/end-record.sh runs the worker synchronously on a clear (continuation) reason" {
	local seed
	seed=$(va_session_env VITEST_AGENT_MAIN_AGENT_ID=fake-main-agent-uuid-001)
	for t in "${VA_TARGETS[@]}"; do
		va_argv_reset
		va_hook "$t" hooks/session/end-record.sh "$(va_fx session-end.json '{"reason":"clear"}')" --session-env "$seed"
		assert_hook_noop
		# The clear path is synchronous, so the cascade is visible immediately,
		# and the worker inherited the session env from the shim.
		[[ "$(va_argv_nth 1)" == agent\ record\ turn* ]]
		[[ "$(va_argv_grep 'agent end-agent')" == *"--agent-id fake-main-agent-uuid-001"* ]]
	done
}

@test "session/end-record.sh answers at once on a true exit and finishes the work detached" {
	for t in "${VA_TARGETS[@]}"; do
		va_argv_reset
		va_hook "$t" hooks/session/end-record.sh "$(va_fx session-end.json '{"reason":"prompt_input_exit"}')"
		assert_hook_noop
		local i=0
		while [ -z "$(va_argv_grep 'agent record session-end')" ] && [ "$i" -lt 50 ]; do
			sleep 0.1
			i=$((i + 1))
		done
		[[ "$(va_argv_grep 'agent record session-end')" == *"--end-reason prompt_input_exit"* ]]
	done
}
