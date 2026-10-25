#!/usr/bin/env bats
# lockfile-drift.bats — the lockfile fingerprint that warns about a stale MCP
# server (issue #461), on both targets.
#
#   session/start.sh records the project lockfile's fingerprint in the plugin's
#   data dir (<data>/lockfile/<chat_id>); hooks/lockfile/check.sh re-hashes on
#   PostToolUse for an install-like Bash command and on UserPromptSubmit, warns
#   once on a mismatch, records the new fingerprint, and goes quiet. A second
#   SessionStart re-records, so a restart resets the warning.
#
# Scenarios: no lockfile, unchanged, changed (once), changed then restarted.

load common

CHAT_ID="test-session-id-bats-001"

setup() {
	va_stub_cli
	STATE="$BATS_TEST_TMPDIR/data/lockfile/$CHAT_ID"
}

_start() { va_hook "$1" hooks/session/start.sh "$(va_fx session-start.json)"; }
_prompt() { va_hook "$1" hooks/lockfile/check.sh "$(va_fx user-prompt-submit.json)"; }
_install() { va_hook "$1" hooks/lockfile/check.sh "$(va_fx post-tool-use-bash-pnpm-install.json)"; }
_bash() { # <target> <command>
	local o
	o=$(jq -nc --arg c "$2" '{tool_input: {command: $c}}')
	va_hook "$1" hooks/lockfile/check.sh "$(va_fx post-tool-use-bash-pnpm-install.json "$o")"
}
_lock() { printf 'lockfileVersion: 9\npackages:\n  %s\n' "$1" >"$(va_project)/pnpm-lock.yaml"; }
_reset() {
	rm -rf "$BATS_TEST_TMPDIR/data"
	rm -f "$(va_project)/pnpm-lock.yaml"
}

# The warning reaches whoever the host shows it to: on Claude Code both the
# user (systemMessage) and the agent (additionalContext), on Copilot the agent
# where PostToolUse context is read.
_assert_warned() { # <target> <event>
	assert_hook_exit 0
	case "$1:$2" in
	claude:*)
		[[ "$(printf '%s' "$output" | jq -r '.systemMessage')" == *"pnpm-lock.yaml changed at "* ]]
		[[ "$(printf '%s' "$output" | jq -r '.systemMessage')" == *"restart it with /mcp"* ]]
		[ "$(printf '%s' "$output" | jq -r '.hookSpecificOutput.hookEventName')" = "$2" ]
		[[ "$(va_context "$1")" == *"Worker forks emitted error"* ]]
		[[ "$(va_context "$1")" == *"total: 0"* ]]
		[[ "$(va_context "$1")" == *"not a test failure"* ]]
		;;
	copilot:PostToolUse)
		[[ "$(va_context "$1")" == *"Worker forks emitted error"* ]]
		[[ "$(va_context "$1")" == *"not a test failure"* ]]
		;;
	copilot:UserPromptSubmit)
		# Copilot drops UserPromptSubmit output; the fingerprint still advances.
		assert_hook_noop
		;;
	esac
}

# --- no lockfile -------------------------------------------------------------

@test "no lockfile: SessionStart records nothing and the check is a no-op" {
	for t in "${VA_TARGETS[@]}"; do
		_reset
		_start "$t"
		assert_hook_exit 0
		[ ! -e "$STATE" ]
		_prompt "$t"
		assert_hook_noop
		_install "$t"
		assert_hook_noop
		[ ! -e "$STATE" ]
	done
}

@test "a lockfile removed after SessionStart is a no-op, and a restart drops the stale record" {
	for t in "${VA_TARGETS[@]}"; do
		_reset
		_lock a
		_start "$t"
		[ -f "$STATE" ]
		rm "$(va_project)/pnpm-lock.yaml"
		_prompt "$t"
		assert_hook_noop
		_start "$t"
		[ ! -e "$STATE" ]
	done
}

# --- unchanged ---------------------------------------------------------------

@test "unchanged: SessionStart records the fingerprint and every check stays silent" {
	for t in "${VA_TARGETS[@]}"; do
		_reset
		_lock a
		_start "$t"
		assert_hook_exit 0
		[ -f "$STATE" ]
		[[ "$(cat "$STATE")" == "pnpm-lock.yaml "* ]]
		[ "$(cat "$STATE")" = "$(cd "$(va_project)" && printf 'pnpm-lock.yaml %s\n' "$(shasum -a 256 pnpm-lock.yaml | awk '{print $1}')")" ]
		_prompt "$t"
		assert_hook_noop
		_install "$t"
		assert_hook_noop
	done
}

@test "SessionStart records the fingerprint even when the CLI cannot be resolved" {
	for t in "${VA_TARGETS[@]}"; do
		_reset
		_lock a
		run_hook "$t" hooks/session/start.sh "$(va_fx session-start.json)" \
			CLAUDE_PLUGIN_DATA="$BATS_TEST_TMPDIR/data" COPILOT_PLUGIN_DATA="$BATS_TEST_TMPDIR/data" \
			VITEST_AGENT_CLI_CMD="$BATS_TEST_TMPDIR/no-such-cli"
		assert_hook_exit 0
		[ -f "$STATE" ]
	done
}

# --- changed -----------------------------------------------------------------

@test "changed: the prompt fallback warns once, records the new fingerprint, then is silent" {
	for t in "${VA_TARGETS[@]}"; do
		_reset
		_lock a
		_start "$t"
		before=$(cat "$STATE")
		_lock b
		_prompt "$t"
		_assert_warned "$t" UserPromptSubmit
		[ "$(cat "$STATE")" != "$before" ]
		_prompt "$t"
		assert_hook_noop
		_install "$t"
		assert_hook_noop
	done
}

@test "changed: an install-like Bash command warns on PostToolUse, then the prompt is silent" {
	for t in "${VA_TARGETS[@]}"; do
		_reset
		_lock a
		_start "$t"
		_lock b
		_install "$t"
		_assert_warned "$t" PostToolUse
		_prompt "$t"
		assert_hook_noop
	done
}

@test "changed: a Bash command that cannot touch the lockfile is ignored and the prompt still catches it" {
	for t in "${VA_TARGETS[@]}"; do
		_reset
		_lock a
		_start "$t"
		before=$(cat "$STATE")
		_lock b
		_bash "$t" "pnpm exec vitest run"
		assert_hook_noop
		[ "$(cat "$STATE")" = "$before" ]
		_bash "$t" "ls node_modules/.bin"
		assert_hook_noop
		[ "$(cat "$STATE")" = "$before" ]
		_prompt "$t"
		_assert_warned "$t" UserPromptSubmit
	done
}

@test "every package manager verb and a branch switch count as install-like" {
	local cmd
	for cmd in "pnpm install" "pnpm i" "pnpm add -D vitest" "pnpm --filter x update" "pnpm up --latest" "pnpm remove foo" \
		"npm install" "npm ci" "npm uninstall foo" "yarn add foo" "yarn install --immutable" "bun add foo" "bun install" \
		"git checkout feat/x" "git switch main" "git pull --rebase" "git rebase main" "cd pkg && pnpm install && pnpm test"; do
		_reset
		_lock a
		_start claude
		_lock b
		_bash claude "$cmd"
		echo "command: $cmd" >&2
		_assert_warned claude PostToolUse
	done
}

@test "a non-Bash PostToolUse is a no-op" {
	for t in "${VA_TARGETS[@]}"; do
		_reset
		_lock a
		_start "$t"
		_lock b
		va_hook "$t" hooks/lockfile/check.sh "$(va_fx post-tool-use-bash-pnpm-install.json '{"tool_name":"Read","tool_input":{"file_path":"pnpm-lock.yaml"}}')"
		assert_hook_noop
	done
}

@test "a lockfile first seen mid-session is a baseline, not a change" {
	for t in "${VA_TARGETS[@]}"; do
		_reset
		_start "$t"
		[ ! -e "$STATE" ]
		_lock a
		_prompt "$t"
		assert_hook_noop
		[ -f "$STATE" ]
		_lock b
		_prompt "$t"
		_assert_warned "$t" UserPromptSubmit
	done
}

# --- changed then restarted --------------------------------------------------

@test "changed then restarted: a new SessionStart re-records and the next prompt is silent" {
	for t in "${VA_TARGETS[@]}"; do
		_reset
		_lock a
		_start "$t"
		_lock b
		_start "$t"
		assert_hook_exit 0
		_prompt "$t"
		assert_hook_noop
		_install "$t"
		assert_hook_noop
	done
}

@test "changed then compacted: a compact SessionStart keeps the record and the next prompt still warns" {
	for t in "${VA_TARGETS[@]}"; do
		_reset
		_lock a
		_start "$t"
		_lock b
		va_hook "$t" hooks/session/start.sh "$(va_fx session-start.json '{"source":"compact"}')"
		assert_hook_exit 0
		_prompt "$t"
		_assert_warned "$t" UserPromptSubmit
		_prompt "$t"
		assert_hook_noop
	done
}

@test "SessionEnd on clear removes the session's fingerprint" {
	for t in "${VA_TARGETS[@]}"; do
		_reset
		_lock a
		_start "$t"
		[ -f "$STATE" ]
		va_hook "$t" hooks/session/end-record.sh "$(va_fx session-end.json '{"reason":"clear"}')"
		assert_hook_noop
		[ ! -e "$STATE" ]
	done
}

@test "the generated hooks files register the check on PostToolUse Bash and UserPromptSubmit on both hosts" {
	local claude="$PLUGIN_DIR/builds/claude/hooks/hooks.json"
	local copilot="$PLUGIN_DIR/builds/copilot/com.github.copilot/hooks/hooks.json"
	[ "$(jq -r '[.hooks.PostToolUse[] | select(.hooks[0] | tostring | contains("lockfile/check.sh")) | .matcher] | join(",")' "$claude")" = Bash ]
	[ "$(jq -r '[.hooks.UserPromptSubmit[] | select(.hooks[0] | tostring | contains("lockfile/check.sh"))] | length' "$claude")" = 1 ]
	[ "$(jq -r '[.hooks.PostToolUse[] | select(.bash | contains("lockfile/check.sh")) | .matcher] | join(",")' "$copilot")" = Bash ]
	[ "$(jq -r '[.hooks.UserPromptSubmit[] | select(.bash | contains("lockfile/check.sh"))] | length' "$copilot")" = 1 ]
}
