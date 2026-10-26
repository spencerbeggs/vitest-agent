#!/usr/bin/env bats
# mcp-version.bats — hooks/lib/vitest-agent/mcp-version.sh: resolving the
# @vitest-agent/mcp version a project's server bin runs, and the version
# comparison that gates hook-injected tool-input fields (issue #275).

load common

setup() {
	. "$BATS_TEST_DIRNAME/../builds/claude/hooks/lib/vitest-agent/mcp-version.sh"
	P="$BATS_TEST_TMPDIR/project"
	mkdir -p "$P"
}

# _mcp <dir> <version>: write an @vitest-agent/mcp manifest under <dir>/node_modules.
_mcp() {
	mkdir -p "$1/node_modules/@vitest-agent/mcp"
	printf '{"name":"@vitest-agent/mcp","version":"%s"}\n' "$2" >"$1/node_modules/@vitest-agent/mcp/package.json"
}

@test "resolves mcp next to the carrier in pnpm's layout" {
	local store="$P/node_modules/.pnpm/@vitest-agent+plugin@6.0.0/node_modules"
	mkdir -p "$store/@vitest-agent/plugin"
	_mcp "$P/node_modules/.pnpm/@vitest-agent+plugin@6.0.0" 5.5.0
	# A stale hoisted copy must lose to the one the carrier resolves.
	_mcp "$P" 5.3.0
	ln -s "$store/@vitest-agent/plugin" "$P/node_modules/@vitest-agent/plugin"
	run va_mcp_version "$P"
	[ "$status" -eq 0 ]
	[ "$output" = 5.5.0 ]
}

@test "resolves mcp nested under the carrier in npm's layout" {
	mkdir -p "$P/node_modules/@vitest-agent/plugin"
	_mcp "$P/node_modules/@vitest-agent/plugin" 5.6.1
	run va_mcp_version "$P"
	[ "$output" = 5.6.1 ]
}

@test "resolves a hoisted or directly installed mcp" {
	_mcp "$P" 5.5.2
	run va_mcp_version "$P"
	[ "$output" = 5.5.2 ]
}

@test "fails printing nothing when mcp is not installed" {
	run va_mcp_version "$P"
	[ "$status" -ne 0 ]
	[ -z "$output" ]
}

@test "version comparison: releases at or above the minimum pass" {
	va_version_ge 5.5.0 5.5.0
	va_version_ge 5.5.1 5.5.0
	va_version_ge 5.10.0 5.5.0
	va_version_ge 6.0.0 5.5.0
}

@test "version comparison: older, prerelease, empty and garbage fail" {
	local v
	for v in 5.4.9 4.9.0 5.5.0-next.1 "" latest 5.5; do
		run va_version_ge "$v" 5.5.0
		[ "$status" -ne 0 ] || { echo "accepted: '$v'"; return 1; }
	done
}
