#!/usr/bin/env sh
# start-mcp.sh — plugin MCP server loader.
#
# Execs the project's own `node_modules/.bin/vitest-agent-mcp` when it is
# present (the carrier `@vitest-agent/plugin` links that bin into every
# consumer that depends on it — issue #412). The package manager is detected
# only to choose the install-command line in the not-installed message; the
# exec target is never a package-manager dispatch (`pnpm exec` / `yarn run` /
# `bunx`), which adds a dispatch layer and resolves bins differently per PM.
#
# Zero jq dependency at runtime: the `packageManager` field is read with
# grep/sed. Detection order mirrors start-mcp.mjs (packageManager field first,
# then lockfiles: pnpm-lock.yaml, bun.lock, bun.lockb, yarn.lock,
# package-lock.json; npm is the default).
#
# Positional args (e.g. `--noop=1` from plugin.json) pass through verbatim.

set -eu

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
export VITEST_AGENT_REPORTER_PROJECT_DIR="$ROOT"

# detect_pm — prints one of npm/pnpm/yarn/bun on stdout. package.json's
# packageManager field wins outright over any lockfile (even a co-present
# one); otherwise the first lockfile present in source order wins; npm is
# the default.
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
	elif [ -f "$ROOT/package-lock.json" ]; then
		printf '%s\n' "npm"
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
	exec "$BIN" "$@"
fi

PM="$(detect_pm)"
{
	printf 'vitest-agent plugin: vitest-agent-mcp is not installed in this project.\n'
	printf '\n'
	printf 'Detected package manager: %s\n' "$PM"
	printf 'Project directory: %s\n' "$ROOT"
	printf '\n'
	printf 'Install it with:\n'
	install_line "$PM"
	printf '\n'
	printf 'Falling back to `npx --yes @vitest-agent/mcp@4`, which will download it.\n'
} >&2

exec npx --yes @vitest-agent/mcp@4 "$@"
