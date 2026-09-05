#!/usr/bin/env bash
# render-fixture.sh — emit a hook fixture with __REPO_ROOT__ resolved.
#
# The fixtures under plugins/claude-code/hooks/fixtures/ are templates: the machine-specific
# repository root is stored as the literal token __REPO_ROOT__ so the suite is
# not pinned to one developer's checkout path. Hook scripts `cd "$cwd"` before
# shelling out to the CLI, so a stale absolute path makes the cd fail, the
# `|| true` swallow it, and every argv assertion fail on any other machine.
#
# The root is derived from this script's own location — NOT from
# `git rev-parse --show-toplevel`, which is unavailable when the tree is
# exported to a plain directory.
#
# Usage: bash render-fixture.sh <fixture.json>
# Invoke via `bash` — the repo's pre-commit hook strips the executable bit
# from .sh files, so the shebang alone is not enough.

set -euo pipefail

if [ "$#" -ne 1 ]; then
	echo "render-fixture.sh: expected exactly one argument (a fixture path), got $#" >&2
	exit 2
fi

fixture="$1"

if [ ! -f "$fixture" ]; then
	echo "render-fixture.sh: fixture not found: ${fixture}" >&2
	exit 1
fi

# __test__/ -> hooks/ -> claude-code/ -> plugins/ -> repo root
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"

# Use a sed delimiter that cannot appear in an absolute path.
sed "s|__REPO_ROOT__|${REPO_ROOT}|g" "$fixture"
