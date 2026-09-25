#!/bin/bash
# detect-pm.sh — shared vitest-agent bin resolution for the hooks.
#
# House hook-resolution order (never `<pm> exec`, never `npx`): a hook fires
# far more often than a server starts, so a silent multi-second `npx`
# download — or a package-manager dispatch whose behavior depends on which
# PM happens to be installed on the machine running Claude Code — is not
# acceptable on this hot path. Contrast with bin/start-mcp.sh, which starts
# once per session and may fall back to a major-pinned `npx` as a last
# resort.
#
# Usage:
#   source "${CLAUDE_PLUGIN_ROOT}/hooks/lib/detect-pm.sh"
#   cli=$(detect_vitest_agent_bin "$cwd") || { emit_noop; exit 0; }
#
# Resolution order:
#   1. $VITEST_AGENT_CLI_CMD override — word-split by the caller, never
#      quoted as one token. Also the seam every bats test in this plugin
#      uses to stub the CLI, so the resolution order and the test seam are
#      the same mechanism.
#   2. `<cwd>/node_modules/.bin/vitest-agent` — the bin the `@vitest-agent/plugin`
#      carrier links into every consumer (issue #412) — RELATIVE path,
#      because call sites expand it unquoted after `cd "$cwd"`, so a space
#      in the project path cannot word-split it.
#   3. `vitest-agent` on PATH.
#   4. Fail: return 1 and print nothing, rather than "resolving" to an
#      empty command that silently no-ops downstream. Every call site must
#      handle this failure by falling back to its own no-op emission and
#      exiting 0 — the resolution failing must never block a tool call.

# Echoes the command that runs the `vitest-agent` CLI for the cwd, or
# returns 1 with no output when none of the three resolution rungs match.
#
# Usage:
#   cli=$(detect_vitest_agent_bin "$cwd") || { emit_noop; exit 0; }
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
	if command -v vitest-agent >/dev/null 2>&1; then
		echo "vitest-agent"
		return 0
	fi
	return 1
}
