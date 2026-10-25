#!/bin/bash
# Lockfile drift check (issue #461), registered on PostToolUse (Bash) and on
# UserPromptSubmit as the fallback.
#
# The vitest-agent MCP server is long-lived and caches resolved module paths at
# boot. When the lockfile is regenerated mid-session (pnpm install, a
# dependency bump, a branch switch) run_tests fails every file with "Worker
# forks emitted error" and total 0, and nothing says why. session/start.sh
# records the lockfile's fingerprint; this hook re-hashes it after an
# install-like Bash command and on every prompt, and on a mismatch tells the
# user (systemMessage) and the agent (additionalContext) once, then records
# the new fingerprint so the next unchanged prompt is silent. A restart
# re-records, so a warning never outlives the server it was about.
#
# Fails open everywhere: no lockfile, no recorded fingerprint, no writable
# state or no usable hash tool is a no-op.

set -euo pipefail

. "$(dirname "$0")/../lib/pluginfinity/hook.sh"
. "$(dirname "$0")/../lib/vitest-agent/common.sh"
hook_require_input

event=$(hook_event 2>/dev/null) || event=""

# On PostToolUse only a Bash command that can rewrite a lockfile re-hashes;
# everything else is left to the prompt fallback.
if [ "$event" = PostToolUse ]; then
	tool_name=$(hook_input tool_name)
	if [ "$tool_name" != "Bash" ]; then
		hook_noop
		exit 0
	fi
	command=$(hook_input tool_input.command)
	if ! va_is_install_cmd "$command"; then
		hook_noop
		exit 0
	fi
fi

chat_id=$(hook_input session_id)
PROJECT_DIR=$(hook_session_dir)
if [ -z "$chat_id" ] || [ -z "$PROJECT_DIR" ] || [ "$PROJECT_DIR" = "$(hook_plugin_root)" ]; then
	hook_noop
	exit 0
fi

state=$(va_lockfile_state "$chat_id") || {
	hook_noop
	exit 0
}

# No lockfile: nothing to compare.
current=$(va_lockfile_hash "$PROJECT_DIR") || {
	hook_debug "no lockfile under $PROJECT_DIR"
	hook_noop
	exit 0
}

_record() {
	if mkdir -p "$(dirname "$state")" 2>/dev/null && printf '%s\n' "$current" >"$state" 2>/dev/null; then
		hook_debug "lockfile fingerprint recorded: $current"
	else
		hook_log "failed to write the lockfile fingerprint to $state"
	fi
}

# No record yet (SessionStart ran without a lockfile, or did not run): this
# sighting is the baseline, not a change.
if [ ! -f "$state" ]; then
	_record
	hook_noop
	exit 0
fi

recorded=$(cat "$state" 2>/dev/null || echo "")
if [ "$current" = "$recorded" ]; then
	hook_noop
	exit 0
fi

# Changed. Record first so a second firing stays silent even if the response
# below is not shown on this host.
_record
lockfile=${current%% *}
changed_at=$(va_lockfile_mtime "$PROJECT_DIR")
hook_debug "lockfile changed: $recorded -> $current"

message="vitest-agent: ${lockfile} changed at ${changed_at}. The vitest-agent MCP server started before that and may hold stale module paths; restart it with /mcp or restart the session."
context="vitest-agent: ${lockfile} changed at ${changed_at}. The vitest-agent MCP server started before that and may hold stale module paths. Until it restarts, run_tests may fail every file with \"Worker forks emitted error\" and report total: 0. That is the stale server, not a test failure: do not diagnose it as one. Tell the user to restart the MCP server (/mcp) or the session, then rerun."

# Both the user and the agent get told where the host shows both; the library
# sends one response per run, so the combined shape goes through hook_raw on
# the host that honours it. Elsewhere, whichever half the host shows.
if hook_supports system_message && hook_supports context; then
	body=$(jq -nc --arg e "$event" --arg m "$message" --arg c "$context" \
		'{systemMessage: $m, hookSpecificOutput: {hookEventName: $e, additionalContext: $c}}')
	hook_raw "$(hook_host)" "$body"
elif hook_supports context; then
	hook_context "$context"
elif hook_supports system_message; then
	hook_system_message "$message"
else
	hook_noop
fi
