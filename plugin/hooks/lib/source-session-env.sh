#!/bin/bash
# Source all session-env hook files for the current Claude Code session.
#
# Per the Claude Code hooks docs, ${CLAUDE_ENV_FILE} (used by SessionStart,
# Setup, CwdChanged, and FileChanged to write exports) is sourced into
# subsequent **Bash commands that Claude Code executes** — but NOT into
# subsequent hook subprocesses. This helper bridges that gap: hooks can
# call `source_session_env "$session_id"` and gain access to the union of
# all plugins' SessionStart-written exports, just like a Bash tool call
# would.
#
# Usage from a hook script (source the file, then call the function — the
# file does NOT auto-invoke from $1 anymore):
#
#   payload=$(cat)
#   session_id=$(echo "$payload" | jq -r '.session_id')
#   # shellcheck source=lib/source-session-env.sh
#   . "$(dirname "$0")/lib/source-session-env.sh"
#   source_session_env "$session_id"
#
# After this, env vars exported by any plugin's SessionStart hook (e.g.
# VITEST_AGENT_CHAT_ID, GH_TOKEN, GITHUB_REPOSITORY) are available in
# the current shell.
#
# Mirrors EnvLoader.loadSessionEnvFiles from claude-binary-plugin
# (packages/src/layers/EnvLoaderLive.ts) — same directory walk, same
# *hook*.sh filter, just in bash instead of Effect.

source_session_env() {
	local session_id="${1:-}"
	if [ -z "$session_id" ]; then
		return 0
	fi

	# Validate the session id shape. The session_id comes from the host
	# hook envelope (untrusted JSON); reject anything that could escape
	# the env dir or shell-glob unexpectedly.
	case "$session_id" in
		*/*|*..*|''|.|..|*[$'\n\r\t']*) return 0 ;;
	esac

	local env_dir="${HOME}/.claude/session-env/${session_id}"
	if [ ! -d "$env_dir" ]; then
		return 0
	fi

	# Relax errexit while sourcing per-session files so a malformed file
	# from another plugin doesn't abort the calling hook midway. Vars
	# exported by valid files still reach the caller's shell because the
	# function shares its scope.
	local _va_errexit_was_on=0
	case $- in *e*) _va_errexit_was_on=1; set +e ;; esac

	local f
	for f in "$env_dir"/*hook*.sh; do
		if [ -f "$f" ]; then
			# shellcheck disable=SC1090
			. "$f"
		fi
	done

	if [ "$_va_errexit_was_on" = "1" ]; then set -e; fi
}

# Do NOT auto-invoke from the sourcing script's positional args. An earlier
# version of this file ran `source_session_env "$1"` at file scope, which
# picked up the *caller's* $1 — false-firing whenever a hook script was
# invoked with positional args. Callers must invoke the function explicitly
# after sourcing the file.
