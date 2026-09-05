#!/usr/bin/env bats
# hook-output-project-dir.bats — covers the VITEST_AGENT_PROJECT_DIR
# propagation block sourced into every hook via lib/hook-output.sh.
#
# The block pins the project-root anchor that the `vitest-agent` CLI uses for
# `data.db` resolution to CLAUDE_PROJECT_DIR (the same root the MCP server
# loader uses), so hook-driven recording writes to the SAME database the MCP
# reads regardless of the firing tool's cwd. Without it, a hook running from a
# sub-package cwd resolves a different per-project data.db and the open TDD
# task is split across two files.
#
# Every assertion sources the lib under `set -euo pipefail` — the same mode the
# real hooks run in — so a regression that trips set -e (e.g. a bare
# `[ ] && export`) surfaces as a non-zero exit here.

LIB="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)/lib/hook-output.sh"

# Source the lib in a clean strict-mode subshell with a controlled environment,
# then print the resulting VITEST_AGENT_PROJECT_DIR. `env -i` strips inherited
# vars so each case starts from a known state.
_source_and_print() {
	env -i \
		CLAUDE_PROJECT_DIR="${1-}" \
		VITEST_AGENT_PROJECT_DIR="${2-}" \
		LIB="$LIB" \
		bash -c 'set -euo pipefail; . "$LIB"; printf "%s" "${VITEST_AGENT_PROJECT_DIR:-}"'
}

@test "derives VITEST_AGENT_PROJECT_DIR from CLAUDE_PROJECT_DIR when unset" {
	run _source_and_print "/repo/root" ""
	[ "$status" -eq 0 ]
	[ "$output" = "/repo/root" ]
}

@test "leaves an already-set VITEST_AGENT_PROJECT_DIR untouched" {
	run _source_and_print "/repo/root" "/explicit/override"
	[ "$status" -eq 0 ]
	[ "$output" = "/explicit/override" ]
}

@test "sourcing does not fail under set -e when both vars are unset" {
	run _source_and_print "" ""
	[ "$status" -eq 0 ]
	[ "$output" = "" ]
}

@test "the derived value is exported to child processes" {
	run env -i CLAUDE_PROJECT_DIR="/repo/root" LIB="$LIB" \
		bash -c 'set -euo pipefail; . "$LIB"; bash -c "printf %s \"\$VITEST_AGENT_PROJECT_DIR\""'
	[ "$status" -eq 0 ]
	[ "$output" = "/repo/root" ]
}
