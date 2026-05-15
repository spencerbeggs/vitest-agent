#!/bin/bash
# PreToolUse hook for Bash: rewrite Vitest invocations with canonical
# VITEST_AGENT_* env-var prefix so the reporter can attribute the run to
# the active agent.
#
# Reads the Bash command from the hook payload, sources the
# session-env-file dir to gain access to SessionStart-written exports
# (CLAUDE_ENV_FILE is auto-sourced into Bash tool subprocesses but NOT
# into hook subprocesses), then shells out to
# `vitest-agent agent inject-env`. The sidecar matches the command
# against the five documented Vitest patterns and returns either the
# original command (no match) or the command with the env prefix
# prepended.
#
# Hook returns a `hookSpecificOutput.updatedInput.command` that REPLACES
# the entire input object's `command` field while echoing back the other
# tool_input fields (description, timeout, run_in_background) per the
# PreToolUse contract.

set -euo pipefail

# shellcheck source=../lib/hook-output.sh
. "$(dirname "$0")/../lib/hook-output.sh"
# shellcheck source=../lib/hook-debug.sh
. "$(dirname "$0")/../lib/hook-debug.sh"
# shellcheck source=../lib/detect-pm.sh
. "$(dirname "$0")/../lib/detect-pm.sh"

_HOOK="pre-tool-use-bash"

hook_json=$(cat)

session_id=$(jq -r '.session_id // ""' <<< "$hook_json")
command_raw=$(jq -r '.tool_input.command // ""' <<< "$hook_json")
description=$(jq -r '.tool_input.description // ""' <<< "$hook_json")
timeout=$(jq -r '.tool_input.timeout // 120000' <<< "$hook_json")
run_in_background=$(jq -r '.tool_input.run_in_background // false' <<< "$hook_json")
cwd=$(jq -r '.cwd // ""' <<< "$hook_json")
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$cwd}"

if [ -z "$command_raw" ] || [ -z "$PROJECT_DIR" ]; then
	emit_noop
	exit 0
fi

# Self-source the session-env dir to pull in SessionStart-written
# exports (VITEST_AGENT_CHAT_ID, _CONVERSATION_ID, _MAIN_AGENT_ID,
# _AGENT_ID). Hook subprocesses do NOT get auto-source per the docs.
# shellcheck source=../lib/source-session-env.sh
. "$(dirname "$0")/../lib/source-session-env.sh"
if [ -n "$session_id" ]; then
	source_session_env "$session_id"
fi

# Shell out to the sidecar. The sidecar reads VITEST_AGENT_* from env
# and decides whether to rewrite the command.
pm_exec=$(detect_pm_exec "$PROJECT_DIR")
# shellcheck disable=SC2086
rewritten=$(cd "$PROJECT_DIR" && $pm_exec vitest-agent agent inject-env --command "$command_raw" --cwd "$PROJECT_DIR" 2>/dev/null) || rewritten="$command_raw"

if [ -z "$rewritten" ] || [ "$rewritten" = "$command_raw" ]; then
	# No rewrite needed — pass through.
	emit_noop
	exit 0
fi

hook_debug "$_HOOK" "rewrote command: $command_raw -> $rewritten"

# updatedInput REPLACES the entire input object — echo all fields.
jq -n \
	--arg cmd "$rewritten" \
	--arg desc "$description" \
	--argjson to "$timeout" \
	--argjson bg "$run_in_background" '{
		hookSpecificOutput: {
			hookEventName: "PreToolUse",
			permissionDecision: "allow",
			updatedInput: {
				command: $cmd,
				description: $desc,
				timeout: $to,
				run_in_background: $bg
			}
		}
	}'
