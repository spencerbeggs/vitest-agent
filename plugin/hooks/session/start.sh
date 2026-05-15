#!/bin/bash
# SessionStart hook: orientation triage injection + sessions row write.
#
# Per Decision D1, the orientation triage report is injected here via
# additionalContext. The sessions row is written with
# triage_was_non_empty so acceptance metric #3 is queryable.

set -euo pipefail

# shellcheck source=../lib/hook-output.sh
. "$(dirname "$0")/../lib/hook-output.sh"
# shellcheck source=../lib/hook-debug.sh
. "$(dirname "$0")/../lib/hook-debug.sh"

_HOOK="session-start"

# Read and discard the JSON envelope to avoid broken-pipe; we re-read
# session_id and cwd below.
hook_json=$(cat)

chat_id=$(jq -r '.session_id // ""' <<< "$hook_json")
cwd=$(jq -r '.cwd // ""' <<< "$hook_json")
transcript_path=$(jq -r '.transcript_path // ""' <<< "$hook_json")
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$cwd}"

if [ -z "$chat_id" ] || [ -z "$PROJECT_DIR" ]; then
	# Nothing to inject and no session to record.
	emit_noop
	exit 0
fi

# shellcheck source=../lib/detect-pm.sh
. "$(dirname "$0")/../lib/detect-pm.sh"
pm_exec=$(detect_pm_exec "$PROJECT_DIR")

# 1. Generate the triage brief.
triage_md=$(cd "$PROJECT_DIR" && $pm_exec vitest-agent agent triage --format markdown 2>/dev/null || echo "")

# 2. Compute the triage_was_non_empty flag.
if [ -n "$triage_md" ]; then
	triage_flag="--triage-was-non-empty"
else
	triage_flag=""
fi

# 3. Write the sessions row.
project=$(jq -r '.name // "unknown"' < "$PROJECT_DIR/package.json" 2>/dev/null || echo "unknown")
started_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

hook_debug "$_HOOK" "INPUT session_id=$chat_id PROJECT_DIR=$PROJECT_DIR pm_exec=$pm_exec"

# shellcheck disable=SC2086
_session_out=$(cd "$PROJECT_DIR" && $pm_exec vitest-agent agent record session-start \
	--chat-id "$chat_id" \
	--project "$project" \
	--cwd "$PROJECT_DIR" \
	--agent-kind main \
	--started-at "$started_at" \
	$triage_flag 2>&1) || {
	hook_error "$_HOOK" "record session-start rc=$? cc=$chat_id PROJECT_DIR=$PROJECT_DIR: $_session_out"
}
hook_debug "$_HOOK" "record session-start: $_session_out"

# 3b. Register the main agent in the agent-taxonomy stores (per-project agents
# table + per-client session map). Captures git context + sets the
# canonical conversation_id and main_agent_id UUIDs that env-injection
# attribution depends on.
agent_id=""
conversation_id=""
main_agent_id=""
if [ -n "$transcript_path" ]; then
	# shellcheck disable=SC2086
	_register_out=$(cd "$PROJECT_DIR" && $pm_exec vitest-agent agent register-agent \
		--host-kind claude-code \
		--agent-type claude-code-main \
		--host-session-id "$chat_id" \
		--transcript-path "$transcript_path" \
		--cwd "$PROJECT_DIR" 2>&1) || {
		hook_error "$_HOOK" "register-agent rc=$? cc=$chat_id: $_register_out"
		_register_out=""
	}
	if [ -n "$_register_out" ]; then
		agent_id=$(echo "$_register_out" | jq -r '.agentId // ""' 2>/dev/null || echo "")
		conversation_id=$(echo "$_register_out" | jq -r '.conversationId // ""' 2>/dev/null || echo "")
		main_agent_id=$(echo "$_register_out" | jq -r '.mainAgentId // ""' 2>/dev/null || echo "")
		hook_debug "$_HOOK" "register-agent agentId=$agent_id conversationId=$conversation_id"
	fi
fi

# 3c. Propagate canonical IDs + plugin paths to subsequent Bash subprocesses,
# the MCP server child, and other plugin hooks. Writes to two surfaces:
#
#   - $CLAUDE_ENV_FILE  — host auto-sources into Bash-tool subprocs and MCP child
#   - ~/.claude/session-env/${session_id}/vitest-agent-hook.sh — other hooks
#     pick this up via lib/source-session-env.sh
#
# Both writes are idempotent across resumes (grep-guard each export) so the
# env file does not grow on every `/resume`. `printf %q` safely quotes
# values that could contain spaces or special chars (a transient
# registration error returning a non-UUID would otherwise produce a broken
# env file that silently breaks every subsequent Bash subproc).
if [ -n "$agent_id" ]; then
	# Compose the seven canonical exports.
	plugin_data_dir="${CLAUDE_PLUGIN_DATA:-}"
	plugin_root_dir="${CLAUDE_PLUGIN_ROOT:-}"
	declare -a _exports=(
		"VITEST_AGENT_CHAT_ID=$chat_id"
		"VITEST_AGENT_CONVERSATION_ID=$conversation_id"
		"VITEST_AGENT_MAIN_AGENT_ID=$main_agent_id"
		"VITEST_AGENT_AGENT_ID=$main_agent_id"
		"VITEST_AGENT_PROJECT_DIR=$PROJECT_DIR"
		"VITEST_AGENT_DATA_DIR=$plugin_data_dir"
		"VITEST_AGENT_PLUGIN_ROOT=$plugin_root_dir"
	)

	# Write per-session env file for other plugin hooks. Overwrite (not
	# append) since this file is plugin-owned per session.
	env_dir="${HOME}/.claude/session-env/${chat_id}"
	mkdir -p "$env_dir" 2>/dev/null || true
	hook_env_file="${env_dir}/vitest-agent-hook.sh"
	{
		for entry in "${_exports[@]}"; do
			name="${entry%%=*}"
			value="${entry#*=}"
			printf 'export %s=%q\n' "$name" "$value"
		done
	} > "$hook_env_file" 2>/dev/null || hook_error "$_HOOK" "failed to write $hook_env_file"

	# Write/refresh exports in $CLAUDE_ENV_FILE for Bash-tool subprocs and
	# the MCP server child. Idempotent: skip any var already present so
	# resumes don't duplicate exports.
	if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
		for entry in "${_exports[@]}"; do
			name="${entry%%=*}"
			value="${entry#*=}"
			if ! grep -q "^export ${name}=" "$CLAUDE_ENV_FILE" 2>/dev/null; then
				printf 'export %s=%q\n' "$name" "$value" >> "$CLAUDE_ENV_FILE"
			fi
		done
		hook_debug "$_HOOK" "synced VITEST_AGENT_* exports to CLAUDE_ENV_FILE and per-session dir"
	fi
fi

# 4. Build the additionalContext markdown.
#
# An imperative preamble is ALWAYS injected — both to push the main agent
# toward the MCP tool surface (rather than re-running raw vitest via Bash)
# and to advertise the TDD orchestrator subagent as a delegate for any
# work that fits the red/green/refactor loop. The triage brief (or the
# empty-state fallback) is appended below the preamble so the agent reads
# the directives first and the situational context after.
preamble="<EXTREMELY_IMPORTANT>
<vitest_agent_reporter>

This project ships with the vitest-agent MCP server. **Always prefer the \`mcp__vitest-agent_mcp__*\` tools over invoking \`vitest\` directly via Bash.** Every reporter run persists test results, errors, coverage, history, and turn data to a SQLite database, so the MCP query surface (\`test_status\`, \`test_overview\`, \`test_errors\`, \`test_history\`, \`test_coverage\`, \`failure_signature_get\`, \`turn_search\`, \`commit_changes\`, etc.) is the authoritative view of project state. Re-running \`vitest\` via Bash bypasses persistence and the post-tool-use hooks that record TDD artifacts, classifications, and failure signatures. Use \`run_tests\` for execution, \`help\` for the full tool list.

**A specialized TDD task agent is available.** It enforces a strict red → green → refactor loop with evidence-bound phase transitions, per-cycle commits, hypothesis recording before any production-code edit, and anti-pattern detection (skipped tests, snapshot mutation, threshold downgrades, etc.). When the user asks for a feature, bug fix, or behavior change that is testable against this codebase's vitest suite, **delegate to the tdd-task agent via the \`/tdd <goal>\` slash command (or by invoking \`plugin:vitest-agent:tdd-task\` through the Task tool) instead of writing tests and code yourself.** Reserve direct work for: pure refactors with no behavioral change, exploratory spikes the user explicitly flags as throwaway, and non-code tasks (docs, configuration, dependency bumps).

If the user's request is ambiguous about whether it warrants TDD, ask once before delegating; do not silently bypass the orchestrator on testable work.

**This conversation's session id is \`$chat_id\`.** The MCP server has already recovered this id (and the canonical agent / conversation UUIDs) from the SessionStart-written environment, so session-aware tools attribute correctly without any explicit \`set_current_session_id\` call.

</vitest_agent_reporter>

<vitest_resources>
MCP resources are available: \`vitest://docs/\` (Vitest upstream docs snapshot) and \`vitest-agent://patterns/\` (curated project patterns). Use \`ListMcpResourcesTool\` to explore, \`ReadMcpResourceTool\` to fetch pages — always load an index URI first. Six user-facing prompts are exposed as slash commands: \`/plugin:vitest-agent:mcp:triage\`, \`why-flaky\`, \`regression-since-pass\`, \`explain-failure\`, \`tdd-resume\`, \`wrapup\`. Load the \`vitest-context\` skill for the full navigation guide.
</vitest_resources>
</EXTREMELY_IMPORTANT>"

#    Prefer triage when non-empty; fall back to the empty-state message.
if [ -n "$triage_md" ]; then
	context="$preamble

$triage_md"
else
	context="$preamble

_No orientation signal yet (no failing tests, flaky tests, or open TDD sessions). Run \`run_tests({})\` to populate the database, or call \`help\` to see the full tool list._"
fi

# 5. Emit the hookSpecificOutput JSON for Claude Code to inject.
emit_additional_context "SessionStart" "$context"
