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

# Hoist dirname: compute once, reuse across all four lib sources.
# Avoids three extra dirname forks on every hook invocation.
_HOOK_DIR="$(dirname "$0")"

# shellcheck source=../lib/hook-output.sh
. "$_HOOK_DIR/../lib/hook-output.sh"
# shellcheck source=../lib/hook-debug.sh
. "$_HOOK_DIR/../lib/hook-debug.sh"
# shellcheck source=../lib/detect-pm.sh
. "$_HOOK_DIR/../lib/detect-pm.sh"

_HOOK="pre-tool-use-bash"

hook_json=$(cat)

# Single jq invocation for all six payload fields.
# command and description are base64-encoded because they can contain
# arbitrary bytes (newlines, tabs, quotes, $) that would break a plain
# newline-delimited read.  The four scalar fields (session_id, timeout,
# run_in_background, cwd) are safe to read as plain text lines.
# read returns 1 at EOF without a trailing newline; || true guards set -e.
{
	IFS= read -r session_id        || true
	IFS= read -r _b64_command      || true
	IFS= read -r _b64_description  || true
	IFS= read -r timeout           || true
	IFS= read -r run_in_background || true
	IFS= read -r cwd               || true
} < <(jq -r '
  (.session_id // ""),
  ((.tool_input.command // "") | @base64),
  ((.tool_input.description // "") | @base64),
  (.tool_input.timeout // 120000 | tostring),
  (.tool_input.run_in_background // false | tostring),
  (.cwd // "")
' <<< "$hook_json")
command_raw=$(printf '%s' "$_b64_command"     | base64 --decode)
description=$(printf '%s' "$_b64_description" | base64 --decode)
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$cwd}"

if [ -z "$command_raw" ] || [ -z "$PROJECT_DIR" ]; then
	emit_noop
	exit 0
fi

# Layer 0: bash regex prefilter — skips the sidecar when the command
# does not appear to invoke Vitest (~80–90% of Bash calls). Matches
# the bare vitest runner, conventional test-named PM scripts, and the
# node bin path. Scripts whose vitest invocation is hidden under a
# non-test name (e.g. `pnpm run ci`, `pnpm run check`) are a
# deliberate speed-vs-completeness gap: only the sidecar's
# detectVitestScripts reads package.json and catches those. False
# positives (non-Vitest commands that happen to match) are acceptable —
# Layer 2 gates correctness.
SIDECAR_PREFILTER_RE='(^|[[:space:]/])vitest([[:space:]/]|$)|(^|[[:space:]&|;])(npm|pnpm|yarn|bun|npx)([[:space:]]+(run|exec|x))?[[:space:]]+test([s]?|[:_-][a-z0-9_-]+)?([[:space:]]|$)|node[[:space:]]+([^[:space:]]+/)?(vitest|node_modules/\.bin/vitest)'
if ! [[ "$command_raw" =~ $SIDECAR_PREFILTER_RE ]]; then
	emit_noop
	exit 0
fi

# Self-source the session-env dir to pull in SessionStart-written
# exports (VITEST_AGENT_CHAT_ID, _CONVERSATION_ID, _MAIN_AGENT_ID,
# _AGENT_ID). Hook subprocesses do NOT get auto-source per the docs.
# shellcheck source=../lib/source-session-env.sh
. "$_HOOK_DIR/../lib/source-session-env.sh"
if [ -n "$session_id" ]; then
	source_session_env "$session_id"
fi

# Layer 1: skip the sidecar when the active agent IS the main agent.
# The auto-sourced VITEST_AGENT_* env is already correct for the
# spawned Vitest process; only subagent-triggered Bash needs the
# prefix rewrite. Falls through (does NOT skip) when either var is
# unset — better to pay the sidecar than silently drop attribution.
if [ -n "${VITEST_AGENT_AGENT_ID:-}" ] \
	&& [ -n "${VITEST_AGENT_MAIN_AGENT_ID:-}" ] \
	&& [ "$VITEST_AGENT_AGENT_ID" = "$VITEST_AGENT_MAIN_AGENT_ID" ]; then
	emit_noop
	exit 0
fi

# Layer 2: prefer the native sidecar binary; fall back to the JS CLI.
# VITEST_AGENT_SIDECAR_BIN is set by the SessionStart hook via
# `vitest-agent agent sidecar-path`, which resolves the binary's
# absolute path through require.resolve — the per-platform
# optionalDependency is NOT hoisted into node_modules/.bin/ so
# `command -v vitest-agent-sidecar` never finds it. When the env var
# is non-empty and executable, use it directly (no PM wrapper, no Node
# cold-start). Otherwise fall through to the JS CLI path.
sidecar_bin=""
if [ -n "${VITEST_AGENT_SIDECAR_BIN:-}" ] && [ -x "${VITEST_AGENT_SIDECAR_BIN}" ]; then
	sidecar_bin="${VITEST_AGENT_SIDECAR_BIN}"
fi
if [ -n "$sidecar_bin" ]; then
	rewritten=$("$sidecar_bin" inject-env --command "$command_raw" --cwd "$PROJECT_DIR" 2>/dev/null) \
		|| rewritten="$command_raw"
else
	pm_exec=$(detect_pm_exec "$PROJECT_DIR")
	# shellcheck disable=SC2086
	rewritten=$(cd "$PROJECT_DIR" && $pm_exec vitest-agent agent inject-env --command "$command_raw" --cwd "$PROJECT_DIR" 2>/dev/null) \
		|| rewritten="$command_raw"
fi

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
