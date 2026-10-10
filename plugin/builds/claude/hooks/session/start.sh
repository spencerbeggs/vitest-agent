#!/bin/bash
# SessionStart hook: orientation triage injection + sessions row write.
#
# Per Decision D1, the orientation triage report is injected here as context.
# The sessions row is written with triage_was_non_empty so acceptance metric #3
# is queryable.
#
# Session values (the canonical chat / conversation / agent ids and the sidecar
# path) are set with hook_env_set, which records them in the plugin's session
# env: every later hook reads them as plain variables, and on Claude Code the
# model's Bash tool sees them too. The one hand-written file left is the MCP
# server's recovery surface, ~/.claude/session-env/<chat_id>/vitest-agent-hook.sh,
# which @vitest-agent/engine's recoverSessionContextFromSessionEnv reads at tool
# call time — an interface of the published MCP server, not hook plumbing.

set -euo pipefail

. "$(dirname "$0")/../lib/pluginfinity/hook.sh"
. "$(dirname "$0")/../lib/vitest-agent/common.sh"
hook_require_input

chat_id=$(hook_input session_id)
transcript_path=$(hook_input transcript_path)
PROJECT_DIR=$(hook_session_dir)

# Never run the CLI against the plugin root: a host that reports no project
# leaves hook_session_dir at the working directory, which on Copilot is the
# plugin itself.
if [ -z "$chat_id" ] || [ -z "$PROJECT_DIR" ] || [ "$PROJECT_DIR" = "$(hook_plugin_root)" ]; then
	hook_noop
	exit 0
fi

cli=$(va_cli "$PROJECT_DIR") || {
	hook_noop
	exit 0
}

# 1. Generate the triage brief.
triage_md=$(cd "$PROJECT_DIR" && $cli agent triage --format markdown 2>/dev/null || echo "")

# 2. Compute the triage_was_non_empty flag.
if [ -n "$triage_md" ]; then
	triage_flag="--triage-was-non-empty"
else
	triage_flag=""
fi

# 3. Write the sessions row.
project=$(va_project_name "$PROJECT_DIR")
started_at=$(va_now)

hook_debug "session_id=$chat_id PROJECT_DIR=$PROJECT_DIR cli=$cli"

# Capture stderr separately (never 2>&1): pnpm's config notices on stderr must
# not taint the recorded output, and folding them into a jq-parsed capture
# corrupts the JSON.
_session_err=$(mktemp)
# shellcheck disable=SC2086
_session_out=$(cd "$PROJECT_DIR" && $cli agent record session-start \
	--chat-id "$chat_id" \
	--project "$project" \
	--cwd "$PROJECT_DIR" \
	--agent-kind main \
	--started-at "$started_at" \
	$triage_flag 2>"$_session_err") || {
	_rc=$?
	hook_log "record session-start rc=$_rc cc=$chat_id PROJECT_DIR=$PROJECT_DIR: $(cat "$_session_err")"
}
rm -f "$_session_err"
hook_debug "record session-start: $_session_out"

# 3b. Register the main agent in the agent-taxonomy stores (per-project agents
# table + per-client session map). Captures git context + sets the canonical
# conversation_id and main_agent_id UUIDs that env-injection attribution
# depends on. Needs a transcript path, which only Claude Code sends.
agent_id=""
conversation_id=""
main_agent_id=""
if [ -n "$transcript_path" ]; then
	# Capture stderr separately, not via 2>&1: pnpm emits config notices to
	# stderr (e.g. the dual packageManager/devEngines WARN), and folding them
	# into stdout corrupts the JSON the jq calls below parse — silently zeroing
	# agentId and skipping the whole env block (sidecar binary included).
	_register_err=$(mktemp)
	_register_out=$(cd "$PROJECT_DIR" && $cli agent register-agent \
		--host-kind claude-code \
		--agent-type claude-code-main \
		--host-session-id "$chat_id" \
		--transcript-path "$transcript_path" \
		--cwd "$PROJECT_DIR" 2>"$_register_err") || {
		_rc=$?
		hook_log "register-agent rc=$_rc cc=$chat_id: $(cat "$_register_err")"
		_register_out=""
	}
	rm -f "$_register_err"
	if [ -n "$_register_out" ]; then
		agent_id=$(printf '%s' "$_register_out" | jq -r '.agentId // ""' 2>/dev/null || echo "")
		conversation_id=$(printf '%s' "$_register_out" | jq -r '.conversationId // ""' 2>/dev/null || echo "")
		main_agent_id=$(printf '%s' "$_register_out" | jq -r '.mainAgentId // ""' 2>/dev/null || echo "")
		hook_debug "register-agent agentId=$agent_id conversationId=$conversation_id"
	fi
fi

# 3c. Propagate the canonical ids to the session env (every later hook, and
# the model's Bash tool on Claude Code).
if [ -n "$agent_id" ]; then
	hook_env_set VITEST_AGENT_CHAT_ID "$chat_id"
	hook_env_set VITEST_AGENT_CONVERSATION_ID "$conversation_id"
	hook_env_set VITEST_AGENT_MAIN_AGENT_ID "$main_agent_id"
	hook_env_set VITEST_AGENT_AGENT_ID "$main_agent_id"

	# Resolve the sidecar binary path once per session so the PreToolUse Bash
	# hook can skip the PATH lookup on every invocation.
	# `vitest-agent agent sidecar-path` resolves the absolute path via
	# require.resolve (traversing the transitive optionalDependency chain that
	# `command -v` cannot reach) and prints it on success, or prints nothing
	# and exits non-zero when no platform binary is installed.
	_sidecar_bin=$(cd "$PROJECT_DIR" && $cli agent sidecar-path 2>/dev/null) || _sidecar_bin=""
	if [ -n "$_sidecar_bin" ] && [ -x "$_sidecar_bin" ]; then
		hook_env_set VITEST_AGENT_SIDECAR_BIN "$_sidecar_bin"
		hook_debug "resolved sidecar binary: $_sidecar_bin"
	fi

	# The MCP server's call-time recovery surface (see the header). Only a host
	# whose MCP server can learn the project reads it: the engine matches the
	# file's VITEST_AGENT_PROJECT_DIR against the server's project.
	if hook_supports server-project; then
		env_dir="${HOME}/.claude/session-env/${chat_id}"
		case "$chat_id" in
		*/* | *..* | . | *[[:cntrl:]]*) env_dir="" ;;
		esac
		if [ -n "$env_dir" ] && mkdir -p "$env_dir" 2>/dev/null; then
			{
				printf 'export VITEST_AGENT_CHAT_ID=%q\n' "$chat_id"
				printf 'export VITEST_AGENT_CONVERSATION_ID=%q\n' "$conversation_id"
				printf 'export VITEST_AGENT_MAIN_AGENT_ID=%q\n' "$main_agent_id"
				printf 'export VITEST_AGENT_AGENT_ID=%q\n' "$main_agent_id"
				printf 'export VITEST_AGENT_PROJECT_DIR=%q\n' "$PROJECT_DIR"
			} >"${env_dir}/vitest-agent-hook.sh" 2>/dev/null || hook_log "failed to write ${env_dir}/vitest-agent-hook.sh"
		fi
	fi
fi

# 4. Build the context.
#
# An imperative preamble is ALWAYS injected — both to push the main agent
# toward the MCP tool surface (rather than re-running raw vitest via Bash) and
# to advertise the TDD orchestrator subagent as a delegate for any work that
# fits the red/green/refactor loop. The triage brief (or the empty-state
# fallback) follows the preamble so the agent reads the directives first.
mcp_prefix=$(hook_tool_prefix mcp 2>/dev/null) || mcp_prefix="mcp__plugin_vitest-agent_mcp__"
preamble="<EXTREMELY_IMPORTANT>
<vitest_agent_reporter>

This project ships with the vitest-agent MCP server. **Always prefer the \`${mcp_prefix}*\` tools over invoking \`vitest\` directly via Bash.** Every reporter run persists test results, errors, coverage, history, and turn data to a SQLite database, so the MCP query surface is the authoritative view of project state. Re-running \`vitest\` via Bash bypasses persistence and the post-tool-use hooks that record TDD artifacts, classifications, and failure signatures. Use \`run_tests\` for execution, \`help\` for the full tool list. The triage brief below lists the most useful tools paired with the situations that call for them.

**A specialized TDD task agent is available.** It enforces a strict red → green → refactor loop with evidence-bound phase transitions, per-cycle commits, hypothesis recording before any production-code edit, and anti-pattern detection (skipped tests, snapshot mutation, threshold downgrades, etc.). When the user asks for a feature, bug fix, or behavior change that is testable against this codebase's vitest suite, **delegate to the \`vitest-agent:tdd-task\` agent via the \`/vitest-agent:tdd <goal>\` skill instead of writing tests and code yourself.** Reserve direct work for: pure refactors with no behavioral change, exploratory spikes the user explicitly flags as throwaway, and non-code tasks (docs, configuration, dependency bumps).

If the user's request is ambiguous about whether it warrants TDD, ask once before delegating; do not silently bypass the orchestrator on testable work.

**This conversation's session id is \`$chat_id\`.** The MCP server recovers this id (and the canonical agent / conversation UUIDs) from the SessionStart-written environment, so session-aware tools attribute correctly without any explicit \`set_current_session_id\` call.

</vitest_agent_reporter>

<vitest_prompts>
Six framing prompts are exposed by the MCP server: \`triage\`, \`why-flaky\`, \`regression-since-pass\`, \`explain-failure\`, \`tdd-resume\`, \`wrapup\`. Load the \`operating-vitest-agent\` skill for the run_tests operating facts (no \`filter\` param, coverage-in-subset behavior, the consoleLeaks signal).
</vitest_prompts>
</EXTREMELY_IMPORTANT>"

# Prefer triage when non-empty; fall back to the empty-state message.
if [ -n "$triage_md" ]; then
	context="$preamble

$triage_md"
else
	context="$preamble

_No orientation signal yet (no failing tests, flaky tests, or open TDD sessions). Run \`run_tests({})\` to populate the database, or call \`help\` to see the full tool list._"
fi

hook_context "$context"
