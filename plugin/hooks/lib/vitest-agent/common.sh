#!/bin/bash
# common.sh — vitest-agent's own hook helpers, sourced AFTER the pluginfinity
# hook library (hooks/lib/pluginfinity/hook.sh, generated into each build).
#
# The pluginfinity library owns stdin, the response, logging (hook_log /
# hook_debug) and the session env. This file holds only what is specific to
# vitest-agent:
#
#   va_cli <dir>            resolve the vitest-agent CLI for a project
#   va_is_tdd_agent <type>  is this agent_type the tdd-task subagent?
#   va_mcp_op <tool-name>   strip this plugin's MCP prefix from a tool name
#   va_state_dir            per-plugin persistent state directory
#   va_lockfile_hash <dir>  fingerprint the project's lockfile (issue #461)
#   va_lockfile_state <id>  the per-session file that fingerprint is kept in
#   va_lockfile_mtime <dir> when the fingerprinted lockfile last changed
#   va_is_install_cmd <cmd> does a shell command (re)write a lockfile?
#
# Sourcing it also anchors VITEST_AGENT_PROJECT_DIR (see below) and unsets
# every empty session-env name, so a CLI the hook spawns sees "unset" rather
# than "set to empty" — the session env exports every declared name, at worst
# as "", while the CLI and sidecar treat a present-but-empty id as a value.
#
# Usage, from hooks/<event>/<name>.sh:
#   . "$(dirname "$0")/../lib/pluginfinity/hook.sh"
#   . "$(dirname "$0")/../lib/vitest-agent/common.sh"

# --- session env: empty means unset ----------------------------------------
# The declared names (pluginfinity.config.ts `env.vars`). A value nobody has
# set yet is "", which the CLI's attribution code and the sidecar's
# injectEnv read as a real (empty) id. Unset them so the old "absent until
# SessionStart registered the agent" contract holds.
for _va_name in VITEST_AGENT_CHAT_ID VITEST_AGENT_CONVERSATION_ID VITEST_AGENT_MAIN_AGENT_ID \
	VITEST_AGENT_AGENT_ID VITEST_AGENT_SIDECAR_BIN; do
	if [ -z "${!_va_name:-}" ]; then
		unset "$_va_name"
	fi
done
unset _va_name

# --- project anchor ----------------------------------------------------------
# Pin the project root every spawned `vitest-agent` CLI resolves data.db from
# to the SESSION's project (CLAUDE_PROJECT_DIR on Claude Code, the call's git
# root elsewhere) — the same root the MCP server loader uses — so hook-driven
# recording writes to the database the MCP server reads even when a hook fires
# from a sub-package cwd. An explicit VITEST_AGENT_PROJECT_DIR (a deliberate
# per-command override) is left untouched; it is deliberately NOT a declared
# session-env name for that reason.
if [ -z "${VITEST_AGENT_PROJECT_DIR:-}" ]; then
	VITEST_AGENT_PROJECT_DIR=$(hook_session_dir 2>/dev/null || true)
fi
if [ -n "${VITEST_AGENT_PROJECT_DIR:-}" ]; then
	export VITEST_AGENT_PROJECT_DIR
else
	unset VITEST_AGENT_PROJECT_DIR
fi

# --- CLI resolution ----------------------------------------------------------
# House hook-resolution order (never `<pm> exec`, never `npx`): a hook fires
# far more often than a server starts, so a silent multi-second `npx`
# download — or a package-manager dispatch whose behavior depends on which PM
# happens to be installed — is not acceptable on this hot path. Contrast with
# bin/start-mcp.sh, which starts once per session and may fall back to a
# major-pinned `npx` as a last resort.
#
# Resolution order:
#   1. $VITEST_AGENT_CLI_CMD override — word-split by the caller, never quoted
#      as one token. Also the seam every bats test uses to stub the CLI.
#   2. `<dir>/node_modules/.bin/vitest-agent` — the bin the
#      `@vitest-agent/plugin` carrier links into every consumer (issue #412) —
#      printed as a RELATIVE path, because call sites expand it unquoted after
#      `cd "<dir>"`, so a space in the project path cannot word-split it.
#   3. `vitest-agent` on PATH.
#   4. Fail: return 1 and print nothing. Every call site falls back to its own
#      no-op response — the resolution failing must never block a tool call.
#
#   cli=$(va_cli "$cwd") || { hook_noop; exit 0; }
#   (cd "$cwd" && $cli agent record turn ...)   # unquoted on purpose
va_cli() {
	local dir="$1"
	if [ -n "${VITEST_AGENT_CLI_CMD:-}" ]; then
		printf '%s\n' "${VITEST_AGENT_CLI_CMD}"
		return 0
	fi
	if [ -x "$dir/node_modules/.bin/vitest-agent" ]; then
		printf '%s\n' "node_modules/.bin/vitest-agent"
		return 0
	fi
	if command -v vitest-agent >/dev/null 2>&1; then
		printf '%s\n' "vitest-agent"
		return 0
	fi
	return 1
}

# --- agent matching ----------------------------------------------------------
# Claude Code sends `agent_type` as "vitest-agent:tdd-task" in SubagentStart
# payloads and in PreToolUse/PostToolUse payloads fired inside the subagent.
# Copilot names agents `<plugin>:<agent>` too, but whether its hook payloads
# carry the agent type at all is unmeasured.
va_is_tdd_agent() {
	case "$1" in
	"vitest-agent:tdd-task") return 0 ;;
	*) return 1 ;;
	esac
}

# --- MCP tool names ----------------------------------------------------------
# Print the operation name (e.g. `run_tests`) of one of this plugin's MCP
# tools, or return 1 for any other tool. Accepts this host's run-time prefix
# (hook_tool_prefix) only when it names this plugin, plus the bare
# `mcp__vitest-agent_mcp__` prefix a user gets by wiring the server directly in
# settings.json. Copilot's prefix is a bare `mcp-` shared by every server named
# `mcp`, so trusting it would auto-allow and rewrite other servers' tools; on
# Copilot only the namespaced spellings match until its plugin MCP tool naming
# is measured.
va_mcp_op() {
	local tool="$1" prefix
	prefix=$(hook_tool_prefix mcp 2>/dev/null) || prefix=""
	case "$prefix" in *vitest-agent*) ;; *) prefix="" ;; esac
	case "$tool" in
	mcp__plugin_vitest-agent_mcp__*) printf '%s\n' "${tool#mcp__plugin_vitest-agent_mcp__}" ;;
	mcp__vitest-agent_mcp__*) printf '%s\n' "${tool#mcp__vitest-agent_mcp__}" ;;
	*)
		if [ -n "$prefix" ] && [ "${tool#"$prefix"}" != "$tool" ]; then
			printf '%s\n' "${tool#"$prefix"}"
		else
			return 1
		fi
		;;
	esac
}

# --- persistent state --------------------------------------------------------
# The plugin's data directory: the host's plugin data dir when it hands one
# over, else a vitest-agent directory under the user's XDG state home. Never
# the plugin root, which changes on every update.
va_state_dir() {
	printf '%s\n' "${CLAUDE_PLUGIN_DATA:-${COPILOT_PLUGIN_DATA:-${XDG_STATE_HOME:-$HOME/.local/state}/vitest-agent}}"
}

# --- lockfile fingerprint (issue #461) ---------------------------------------
# The MCP server is long-lived and caches resolved module paths at boot, so a
# lockfile regenerated mid-session (an install, a dependency bump, a branch
# switch) leaves it holding stale paths: run_tests then fails every file with
# "Worker forks emitted error" and total 0, and nothing says why. SessionStart
# records the lockfile's fingerprint in a per-session state file; the
# lockfile/check.sh hook re-hashes after an install-like Bash command and on
# every prompt, warns once per change, and records the new fingerprint.

# The lockfiles, in the order the first match wins.
VA_LOCKFILES="pnpm-lock.yaml package-lock.json npm-shrinkwrap.json yarn.lock bun.lock bun.lockb"

# Print the first lockfile under <dir> as "<name> <sha256>", or return 1 when
# <dir> has none (or no hash tool is usable).
va_lockfile_hash() {
	local dir="$1" name f sum
	for name in $VA_LOCKFILES; do
		f="$dir/$name"
		[ -f "$f" ] || continue
		if command -v shasum >/dev/null 2>&1; then
			sum=$(shasum -a 256 "$f" 2>/dev/null | awk '{print $1}')
		elif command -v sha256sum >/dev/null 2>&1; then
			sum=$(sha256sum "$f" 2>/dev/null | awk '{print $1}')
		else
			sum=$(cksum "$f" 2>/dev/null | awk '{print $1 "-" $2}')
		fi
		[ -n "$sum" ] || return 1
		printf '%s %s\n' "$name" "$sum"
		return 0
	done
	return 1
}

# The lockfile's last-modified time under <dir>, ISO-8601 UTC; now when the
# host's stat is neither BSD nor GNU.
va_lockfile_mtime() {
	local dir="$1" name f epoch=""
	for name in $VA_LOCKFILES; do
		f="$dir/$name"
		[ -f "$f" ] || continue
		epoch=$(stat -f %m "$f" 2>/dev/null) || epoch=$(stat -c %Y "$f" 2>/dev/null) || epoch=""
		break
	done
	if [ -n "$epoch" ]; then
		date -u -r "$epoch" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null ||
			date -u -d "@$epoch" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null ||
			va_now
	else
		va_now
	fi
}

# Print the state file holding session <chat_id>'s recorded fingerprint, or
# return 1 for an id that cannot name a file.
va_lockfile_state() {
	local chat_id="$1"
	case "$chat_id" in
	"" | */* | *..* | . | *[[:cntrl:]]*) return 1 ;;
	esac
	printf '%s/lockfile/%s\n' "$(va_state_dir)" "$chat_id"
}

# Succeed when <command> looks like it (re)writes a lockfile: a package-manager
# install/add/update/remove (flags, with one optional argument each, allowed
# before the verb, as in `pnpm --filter x add y`), or a git command that moves
# the working tree to another commit. A false positive only re-hashes.
va_is_install_cmd() {
	local cmd="$1" flags pm git
	flags='([[:space:]]+-[^[:space:]]*([[:space:]]+[^-[:space:]][^[:space:]]*)?)*'
	pm="(^|[^[:alnum:]_./-])(pnpm|npm|yarn|bun|bunx|npx|corepack)${flags}[[:space:]]+(install|i|ci|add|update|up|upgrade|remove|rm|uninstall|un|dedupe|link|unlink|import|prune|patch-commit)([[:space:]]|\$)"
	git="(^|[^[:alnum:]_./-])git${flags}[[:space:]]+(checkout|switch|pull|merge|rebase|reset|stash|cherry-pick|revert|worktree)([[:space:]]|\$)"
	[[ "$cmd" =~ $pm ]] || [[ "$cmd" =~ $git ]]
}

# --- small helpers -----------------------------------------------------------
va_now() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

# The `name` of <dir>/package.json, or "unknown".
va_project_name() {
	jq -r '.name // "unknown"' <"$1/package.json" 2>/dev/null || printf 'unknown\n'
}
