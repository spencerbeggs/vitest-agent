#!/bin/bash
# detect-pm.sh — shared package-manager detection for record-* hooks.
#
# Mirrors the PM detection in plugins/claude-code/bin/start-mcp.sh so the hook surface
# stays consistent for npm/pnpm/yarn/bun users (Decision 30).
#
# Usage:
#   source "${CLAUDE_PLUGIN_ROOT}/hooks/lib/detect-pm.sh"
#   pm_exec=$(detect_pm_exec "$cwd")  # e.g., "pnpm exec", "npx --no-install"
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
