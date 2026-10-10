#!/bin/sh
# start-mcp.sh — plugin MCP server loader, on pluginfinity's server library.
#
# Execs the project's own `node_modules/.bin/vitest-agent-mcp` when it is
# present (the carrier `@vitest-agent/plugin` links that bin into every
# consumer that depends on it — issue #412). The package manager is detected
# only to choose the install-command line in the not-installed message; the
# exec target is never a package-manager dispatch (`pnpm exec` / `yarn run` /
# `bunx`), which adds a dispatch layer and resolves bins differently per PM.
# The last resort is `npx --yes @vitest-agent/mcp@5`, pinned to the major the
# hooks were written for (Decision 30) — deliberately not the library's
# server_exec_bin, which would dispatch through the detected manager.
#
# Zero jq dependency at runtime: the `packageManager` field is read with
# grep/sed. Detection order: packageManager field first, then lockfiles
# (pnpm-lock.yaml, bun.lock, bun.lockb, yarn.lock, package-lock.json); npm is
# the default.
#
# Nothing but the server may write to stdout: it carries the MCP protocol.
# Positional args (e.g. `--noop=1` from the config) pass through verbatim.

set -eu
. "$PLUGINFINITY_LIB/server.sh"

# The user's project. Claude Code hands the server CLAUDE_PROJECT_DIR; a
# Copilot MCP server starts in the plugin root and cannot learn the project
# (server_project_dir returns 1), so fall back to the working directory there.
if ROOT=$(server_project_dir); then
	# Claude Code does not reliably propagate CLAUDE_PROJECT_DIR to MCP
	# children, so pin the server's data.db key explicitly.
	export VITEST_AGENT_REPORTER_PROJECT_DIR="$ROOT"
else
	ROOT=$(pwd)
	server_log "no project directory for the MCP server; using $ROOT"
fi

# detect_pm — prints one of npm/pnpm/yarn/bun. package.json's packageManager
# field wins outright over any lockfile (even a co-present one); otherwise the
# first lockfile present in source order wins; npm is the default.
detect_pm() {
	pm=""
	if [ -f "$ROOT/package.json" ]; then
		pm=$(grep -o '"packageManager"[[:space:]]*:[[:space:]]*"[^"]*"' "$ROOT/package.json" 2>/dev/null |
			sed -E 's/.*:[[:space:]]*"([a-z]+)@.*/\1/') || pm=""
	fi
	case "$pm" in
	npm | pnpm | yarn | bun)
		printf '%s\n' "$pm"
		return
		;;
	esac
	if [ -f "$ROOT/pnpm-lock.yaml" ]; then
		printf '%s\n' "pnpm"
	elif [ -f "$ROOT/bun.lock" ]; then
		printf '%s\n' "bun"
	elif [ -f "$ROOT/bun.lockb" ]; then
		printf '%s\n' "bun"
	elif [ -f "$ROOT/yarn.lock" ]; then
		printf '%s\n' "yarn"
	else
		printf '%s\n' "npm"
	fi
}

# install_line pm — prints the one install command line matching pm.
install_line() {
	case "$1" in
	pnpm) printf '  pnpm add -D @vitest-agent/plugin\n' ;;
	yarn) printf '  yarn add -D @vitest-agent/plugin\n' ;;
	bun) printf '  bun add -d @vitest-agent/plugin\n' ;;
	*) printf '  npm install --save-dev @vitest-agent/plugin\n' ;;
	esac
}

BIN="$ROOT/node_modules/.bin/vitest-agent-mcp"
if [ -x "$BIN" ]; then
	server_debug "exec $BIN"
	exec "$BIN" "$@"
fi

PM="$(detect_pm)"
server_log "vitest-agent-mcp is not installed in $ROOT; falling back to npx --yes @vitest-agent/mcp@5"
{
	printf 'vitest-agent plugin: vitest-agent-mcp is not installed in this project.\n'
	printf '\n'
	printf 'Detected package manager: %s\n' "$PM"
	printf 'Project directory: %s\n' "$ROOT"
	printf '\n'
	printf 'Install it with:\n'
	install_line "$PM"
	printf '\n'
	printf 'Falling back to `npx --yes @vitest-agent/mcp@5`, which will download it.\n'
} >&2

exec npx --yes @vitest-agent/mcp@5 "$@"
