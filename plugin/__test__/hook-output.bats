#!/usr/bin/env bats
# hook-output.bats — the response contract every hook keeps, on both targets.
#
# A host parses a hook's stdout as ONE JSON object, so any other byte written
# to it corrupts the payload (issue #373). The pluginfinity hook library writes
# the response but has no stdout fence, so the guarantee rests on every CLI call
# site capturing or redirecting its output. This suite runs every hook against
# a `vitest-agent` that prints noise to stdout on every call and asserts the
# hook still answers with nothing or exactly one JSON object.
#
# It also pins the hook registrations the build generates from
# pluginfinity.config.ts.

load common

setup() {
	va_stub_cli '*) echo "noise: stray CLI stdout $*"; echo "{\"not\":\"the response\"}" ;;'
}

# Exactly one JSON object, or nothing.
_assert_single_response() {
	assert_hook_exit 0
	[ -z "$output" ] && return 0
	[ "$(printf '%s' "$output" | jq -s 'length')" = 1 ]
	printf '%s' "$output" | jq -e 'type == "object"' >/dev/null
	[[ "$output" != *"noise:"* ]]
	[[ "$output" != *'"not":"the response"'* ]]
}

@test "every hook answers with one JSON object even when the CLI prints to stdout" {
	local t entry script fixture
	local cases=(
		"hooks/session/start.sh|session-start.json"
		"hooks/user-prompt-submit/record.sh|user-prompt-submit.json"
		"hooks/pre-tool-use/record.sh|pre-tool-use-record.json"
		"hooks/pre-tool-use/bash.sh|pre-tool-use-bash.json"
		"hooks/pre-tool-use/test-location.sh|post-tool-use-write-test.json"
		"hooks/post-tool-use/test-run.sh|post-tool-use-bash-vitest.json"
		"hooks/post-tool-use/git-commit.sh|post-tool-use-bash-git-commit.json"
		"hooks/post-tool-use/record.sh|post-tool-use-record-write.json"
		"hooks/post-tool-use/tdd-artifact.sh|post-tool-use-run-tests-fail.json"
		"hooks/post-tool-use/test-quality.sh|post-tool-use-write-test.json"
		"hooks/stop/record.sh|stop.json"
		"hooks/pre-compact/record.sh|pre-compact.json"
		"hooks/subagent/start-tdd.sh|subagent-start-tdd.json"
		"hooks/subagent/stop-tdd.sh|subagent-stop-tdd.json"
		"hooks/session/end-record.sh|session-end.json"
	)
	local seed
	seed=$(va_session_env VITEST_AGENT_MAIN_AGENT_ID=m VITEST_AGENT_AGENT_ID=a VITEST_AGENT_CHAT_ID=c VITEST_AGENT_CONVERSATION_ID=v)
	git -C "$(va_project)" init -q
	git -C "$(va_project)" -c user.name=bats -c user.email=bats@example.com commit -q --allow-empty -m x
	for t in "${VA_TARGETS[@]}"; do
		for entry in "${cases[@]}"; do
			script=${entry%%|*}
			fixture=${entry#*|}
			# test-location needs a PreToolUse payload; reuse the write fixture's input.
			if [ "$script" = hooks/pre-tool-use/test-location.sh ]; then
				fixture=$(va_fx "$fixture" '{"hook_event_name":"PreToolUse"}')
			else
				# A failed run, so the hooks that add guidance on failure answer too.
				fixture=$(va_fx "$fixture" '{"tool_response":{"exit_code":1}}')
			fi
			va_hook "$t" "$script" "$fixture" --session-env "$seed"
			_assert_single_response || {
				echo "$t $script: $output" >&2
				return 1
			}
		done
	done
}

@test "the generated Claude Code hooks file pins the registrations" {
	local hooks="$PLUGIN_DIR/builds/claude/hooks/hooks.json"
	# The session env runner comes first, then start.sh with its 30 s budget and no matcher.
	[ "$(jq -r '.hooks.SessionStart | length' "$hooks")" = 2 ]
	[ "$(jq -r '.hooks.SessionStart[1].matcher // "none"' "$hooks")" = none ]
	[ "$(jq -r '.hooks.SessionStart[1].hooks[0].timeout' "$hooks")" = 30 ]
	[ "$(jq -r '[.hooks.PreToolUse[] | .matcher // ""] | join(",")' "$hooks")" = 'mcp__(plugin_vitest-agent_mcp|vitest-agent_mcp)__.*,mcp__(plugin_vitest-agent_mcp|vitest-agent_mcp)__run_tests,mcp__(plugin_vitest-agent_mcp|vitest-agent_mcp)__(tdd_goal|tdd_behavior|tdd_artifact_record),,Bash|Edit|Write|MultiEdit,Read|Write|Edit|MultiEdit,Bash' ]
	[ "$(jq -r '.hooks | keys | join(",")' "$hooks")" = 'Elicitation,ElicitationResult,PostToolUse,PreCompact,PreToolUse,SessionEnd,SessionStart,Stop,SubagentStart,SubagentStop,UserPromptSubmit' ]
	# No entry fails closed: every hook here records or advises, none guards.
	run grep -c PLUGINFINITY_FAIL_CLOSED "$hooks"
	[ "$output" = 0 ]
}

@test "the generated Copilot hooks file omits the elicitation events" {
	local hooks="$PLUGIN_DIR/builds/copilot/com.github.copilot/hooks/hooks.json"
	[ "$(jq -r '.hooks | keys | join(",")' "$hooks")" = 'PostToolUse,PreCompact,PreToolUse,SessionEnd,SessionStart,Stop,SubagentStop,UserPromptSubmit,subagentStart' ]
}

@test "the MCP server is declared on both hosts through the one launcher" {
	[ "$(jq -c '.mcpServers.mcp.args' "$PLUGIN_DIR/builds/claude/.claude-plugin/plugin.json")" = '["${CLAUDE_PLUGIN_ROOT}/bin/start-mcp.sh","--noop=1"]' ]
	[ "$(jq -r '.mcpServers.mcp.args[0]' "$PLUGIN_DIR/builds/copilot/mcp.json")" = '${PLUGIN_ROOT}/bin/start-mcp.sh' ]
}

@test "both manifests carry the package version" {
	local version
	version=$(jq -r .version "$PLUGIN_DIR/package.json")
	[ "$(jq -r .version "$PLUGIN_DIR/builds/claude/.claude-plugin/plugin.json")" = "$version" ]
	[ "$(jq -r .version "$PLUGIN_DIR/builds/copilot/plugin.json")" = "$version" ]
}
