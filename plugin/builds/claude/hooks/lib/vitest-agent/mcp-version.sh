# shellcheck shell=bash
# Version gate for fields this plugin injects into MCP tool inputs.
#
# The MCP server's inputs are strict: an older server rejects any key it does
# not declare, so a newer hook that injects one would fail every call against
# a project still on an older @vitest-agent/mcp (the plugin and the npm
# packages release independently). SessionStart resolves the version of the
# server the loader would exec and records it as VITEST_AGENT_MCP_VERSION;
# an injecting hook compares it against the release that first accepted the
# field and injects only on a positive match. An unresolvable version means
# "do not inject".
#
# Pure bash plus jq; no hook library, so bats can source it directly.
#
# Usage:
#   . "$(dirname "$0")/../lib/vitest-agent/mcp-version.sh"

# The first @vitest-agent/mcp release whose run_tests accepts _callerCwd
# (issue #275).
VA_MCP_CALLER_CWD_MIN=5.5.0

# va_mcp_version <project-dir>: print the version of the @vitest-agent/mcp
# package the project's vitest-agent-mcp bin runs, or fail printing nothing.
# The bin is the @vitest-agent/plugin carrier's (issue #412), so resolve mcp
# the way Node would from the carrier's real directory: each ancestor's
# node_modules in turn, which covers pnpm's sibling layout, npm's nesting and
# hoisting, and a workspace link. A project without the carrier (mcp installed
# directly) starts the walk at the project itself.
va_mcp_version() {
	local project=$1 dir manifest version
	[ -n "$project" ] && [ -d "$project" ] || return 1
	dir=$project
	if [ -d "$project/node_modules/@vitest-agent/plugin" ]; then
		dir=$(cd "$project/node_modules/@vitest-agent/plugin" 2>/dev/null && pwd -P) || dir=$project
	fi
	while :; do
		manifest="$dir/node_modules/@vitest-agent/mcp/package.json"
		if [ -f "$manifest" ]; then
			version=$(jq -r '.version // empty' "$manifest" 2>/dev/null) || version=""
			[ -n "$version" ] || return 1
			printf '%s\n' "$version"
			return 0
		fi
		[ "$dir" != / ] && [ -n "$dir" ] || return 1
		dir=$(dirname "$dir")
	done
}

# va_version_ge <version> <minimum>: succeed when <version> is a release at or
# above <minimum> (both MAJOR.MINOR.PATCH). A prerelease of the minimum counts
# as below it; anything unparseable fails.
va_version_ge() {
	local v=$1 min=$2 core pre a b c x y z n
	core=${v%%-*}
	pre=""
	[ "$core" = "$v" ] || pre=1
	IFS=. read -r a b c <<<"$core"
	IFS=. read -r x y z <<<"$min"
	for n in "$a" "$b" "$c" "$x" "$y" "$z"; do
		case "$n" in '' | *[!0-9]*) return 1 ;; esac
	done
	((10#$a != 10#$x)) && { ((10#$a > 10#$x)); return; }
	((10#$b != 10#$y)) && { ((10#$b > 10#$y)); return; }
	((10#$c != 10#$z)) && { ((10#$c > 10#$z)); return; }
	[ -z "$pre" ]
}
