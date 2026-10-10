#!/bin/bash
# PreToolUse hook for Bash: rewrite Vitest invocations with the canonical
# VITEST_AGENT_* env-var prefix so the reporter can attribute the run to the
# active agent.
#
# The session ids come from the plugin's session env (SessionStart set them
# with hook_env_set), so they are plain variables here. The command goes to
# `vitest-agent agent inject-env` (the native sidecar when one is installed),
# which matches it against the five documented Vitest patterns and returns
# either the original command (no match) or the command with the env prefix
# prepended.
#
# On a rewrite the hook allows the call with replacement input carrying the
# rewritten `command` and the other tool_input fields (description, timeout,
# run_in_background), because the replacement input REPLACES the whole object.

set -euo pipefail

_HOOK_DIR="$(dirname "$0")"
. "$_HOOK_DIR/../lib/pluginfinity/hook.sh"
. "$_HOOK_DIR/../lib/vitest-agent/common.sh"
hook_require_input

command_raw=$(hook_input tool_input.command)
cwd=$(hook_input cwd)
PROJECT_DIR=$(hook_session_dir)
[ -n "$PROJECT_DIR" ] || PROJECT_DIR="$cwd"

if [ -z "$command_raw" ] || [ -z "$PROJECT_DIR" ]; then
	hook_noop
	exit 0
fi

# Layer 0: bash regex prefilter — skips the sidecar when the command does not
# appear to invoke Vitest (~80–90% of Bash calls). Matches the bare vitest
# runner, conventional test-named PM scripts, and the node bin path. Scripts
# whose vitest invocation is hidden under a non-test name (e.g. `pnpm run ci`)
# are a deliberate speed-vs-completeness gap: only the sidecar's
# detectVitestScripts reads package.json and catches those. False positives
# are acceptable — Layer 2 gates correctness.
SIDECAR_PREFILTER_RE='(^|[[:space:]/])vitest([[:space:]/]|$)|(^|[[:space:]&|;])(npm|pnpm|yarn|bun|npx)([[:space:]]+(run|exec|x))?[[:space:]]+test([s]?|[:_-][a-z0-9_-]+)?([[:space:]]|$)|node[[:space:]]+([^[:space:]]+/)?(vitest|node_modules/\.bin/vitest)'
if ! [[ "$command_raw" =~ $SIDECAR_PREFILTER_RE ]]; then
	hook_noop
	exit 0
fi

# Layer 1: skip the sidecar when the active agent IS the main agent. The
# session's VITEST_AGENT_* values are already correct for the spawned Vitest
# process; only subagent-triggered Bash needs the prefix rewrite. Falls through
# (does NOT skip) when either value is missing — better to pay the sidecar
# than silently drop attribution.
if [ -n "${VITEST_AGENT_AGENT_ID:-}" ] &&
	[ -n "${VITEST_AGENT_MAIN_AGENT_ID:-}" ] &&
	[ "$VITEST_AGENT_AGENT_ID" = "$VITEST_AGENT_MAIN_AGENT_ID" ]; then
	hook_noop
	exit 0
fi

# Layer 2: prefer the native sidecar binary; fall back to the JS CLI.
# VITEST_AGENT_SIDECAR_BIN is set once per session by the SessionStart hook
# via `vitest-agent agent sidecar-path`, which resolves the binary's absolute
# path through require.resolve — the per-platform optionalDependency is NOT
# hoisted into node_modules/.bin/, so `command -v vitest-agent-sidecar` never
# finds it. When it is non-empty and executable, run it directly (no PM
# wrapper, no Node cold-start).
sidecar_bin=""
if [ -n "${VITEST_AGENT_SIDECAR_BIN:-}" ] && [ -x "${VITEST_AGENT_SIDECAR_BIN}" ]; then
	sidecar_bin="${VITEST_AGENT_SIDECAR_BIN}"
fi
if [ -n "$sidecar_bin" ]; then
	rewritten=$("$sidecar_bin" inject-env --command "$command_raw" --cwd "$PROJECT_DIR" 2>/dev/null) ||
		rewritten="$command_raw"
elif cli=$(va_cli "$PROJECT_DIR"); then
	# shellcheck disable=SC2086
	rewritten=$(cd "$PROJECT_DIR" && $cli agent inject-env --command "$command_raw" --cwd "$PROJECT_DIR" 2>/dev/null) ||
		rewritten="$command_raw"
else
	rewritten="$command_raw"
fi

if [ -z "$rewritten" ] || [ "$rewritten" = "$command_raw" ]; then
	# No rewrite needed — pass through.
	hook_noop
	exit 0
fi

hook_debug "rewrote command: $command_raw -> $rewritten"

# The replacement input REPLACES the whole tool_input: carry every field over
# and swap the command.
original=$(hook_input tool_input)
[ -n "$original" ] || original='{}'
updated=$(jq -c --arg cmd "$rewritten" '(if type == "object" then . else {} end) + {command: $cmd}' <<<"$original")
hook_allow "" "$updated"
