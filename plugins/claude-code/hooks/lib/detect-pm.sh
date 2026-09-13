#!/bin/bash
# detect-pm.sh — shared package-manager detection and vitest-agent bin
# resolution for the hooks.
#
# Mirrors the PM detection in plugins/claude-code/bin/start-mcp.sh so the hook surface
# stays consistent for npm/pnpm/yarn/bun users (Decision 30).
#
# Usage:
#   source "${CLAUDE_PLUGIN_ROOT}/hooks/lib/detect-pm.sh"
#   pm_exec=$(detect_pm_exec "$cwd")  # e.g., "pnpm exec", "npx --no-install"
#   cli=$(detect_vitest_agent_bin "$cwd")  # relative local .bin, else "$pm_exec vitest-agent"
#
# Detection order:
#   1. `packageManager` field in <cwd>/package.json
#   2. Lockfile presence (pnpm-lock.yaml, bun.lock(b), yarn.lock, package-lock.json)
#   3. Default: npm

detect_pm_name() {
	local cwd="$1"
	local pkg_json="$cwd/package.json"

	# 1. packageManager field
	if [ -f "$pkg_json" ]; then
		local pm_field
		pm_field=$(jq -r '.packageManager // ""' "$pkg_json" 2>/dev/null || echo "")
		if [ -n "$pm_field" ]; then
			local name="${pm_field%%@*}"
			case "$name" in
				pnpm|npm|yarn|bun) echo "$name"; return 0 ;;
			esac
		fi
	fi

	# 2. Lockfile presence
	if [ -f "$cwd/pnpm-lock.yaml" ]; then echo pnpm; return 0; fi
	if [ -f "$cwd/bun.lock" ] || [ -f "$cwd/bun.lockb" ]; then echo bun; return 0; fi
	if [ -f "$cwd/yarn.lock" ]; then echo yarn; return 0; fi
	if [ -f "$cwd/package-lock.json" ]; then echo npm; return 0; fi

	# 3. Default
	echo npm
}

# Echoes the `<pm> <exec>` invocation prefix appropriate for the cwd.
detect_pm_exec() {
	local cwd="$1"
	local name
	name=$(detect_pm_name "$cwd")
	case "$name" in
		pnpm) echo "pnpm exec" ;;
		npm)  echo "npx --no-install" ;;
		yarn) echo "yarn run" ;;
		bun)  echo "bun x" ;;
		*)    echo "npx --no-install" ;;
	esac
}

# Echoes the command prefix that runs the `vitest-agent` CLI for the cwd.
#
# Preference order (issue #412 — the carrier `@vitest-agent/plugin` links the
# bin into every consumer, so the direct path is the common case):
#   1. $VITEST_AGENT_CLI_CMD when non-empty — an explicit override, echoed
#      verbatim (may be multi-word). Also how the bats suites route the hooks
#      at a stub instead of the repo's real linked bin.
#   2. `node_modules/.bin/vitest-agent` — RELATIVE — when the one under <cwd>
#      is executable.
#   3. `<pm> <exec> vitest-agent` via detect_pm_exec — the PM resolves it.
#
# Relative-path contract: every call site expands the result UNQUOTED so the
# multi-word forms (1 and 3) word-split into a command. An absolute path from
# rung 2 would word-split on any space in the project path and the bin would
# silently never run (every call is `2>/dev/null || true`). So rung 2 echoes
# the space-free relative path and relies on the call site doing
# `cd "$cwd" && $cli …` first — which every hook already does. Keep that `cd`.
#
# Usage:
#   cli=$(detect_vitest_agent_bin "$cwd")
#   (cd "$cwd" && $cli agent record turn ...)   # unquoted on purpose
detect_vitest_agent_bin() {
	local cwd="$1"
	if [ -n "${VITEST_AGENT_CLI_CMD:-}" ]; then
		echo "${VITEST_AGENT_CLI_CMD}"
		return 0
	fi
	if [ -x "$cwd/node_modules/.bin/vitest-agent" ]; then
		echo "node_modules/.bin/vitest-agent"
		return 0
	fi
	echo "$(detect_pm_exec "$cwd") vitest-agent"
}
