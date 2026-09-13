#!/usr/bin/env bats
# bin-preference.bats — the carrier pattern (issue #412).
#
# `@vitest-agent/plugin` declares the `vitest-agent` / `vitest-agent-mcp`
# bins itself so a consumer that depends only on the plugin gets them linked
# into node_modules/.bin. The plugin's loaders and hooks therefore prefer
# that linked bin and only fall back to a package-manager dispatch (hooks)
# or `npx --yes` (MCP loader) when it is absent.
#
# Every case runs against a throwaway project directory so the repo's own
# node_modules/.bin never leaks into the assertions.

bats_require_minimum_version 1.5.0

PLUGIN_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
LOADER_SH="${PLUGIN_DIR}/bin/start-mcp.sh"
LOADER_MJS="${PLUGIN_DIR}/bin/start-mcp.mjs"
DETECT_PM="${PLUGIN_DIR}/hooks/lib/detect-pm.sh"

setup() {
	PROJECT="$(mktemp -d)"
	CAPTURE="${PROJECT}/argv"
	STUBS="${PROJECT}/stubs"
	mkdir -p "${PROJECT}/node_modules/.bin" "${STUBS}"
	export CAPTURE

	# A fake `npx` on PATH so the fallback branch is observable without a
	# network round-trip.
	cat > "${STUBS}/npx" <<'STUB'
#!/bin/bash
echo "npx $*" >> "$CAPTURE"
exit 0
STUB
	chmod +x "${STUBS}/npx"
	export PATH="${STUBS}:${PATH}"
	unset VITEST_AGENT_CLI_CMD
}

teardown() {
	rm -rf "${PROJECT}"
}

# link_bin <name> — drop an argv-echoing fixture at node_modules/.bin/<name>.
link_bin() {
	cat > "${PROJECT}/node_modules/.bin/$1" <<'STUB'
#!/bin/bash
echo "local $(basename "$0") $*" >> "$CAPTURE"
exit 0
STUB
	chmod +x "${PROJECT}/node_modules/.bin/$1"
}

# ---------------------------------------------------------------------------
# start-mcp.sh
# ---------------------------------------------------------------------------

@test "start-mcp.sh execs node_modules/.bin/vitest-agent-mcp when present" {
	link_bin vitest-agent-mcp
	run env CLAUDE_PROJECT_DIR="$PROJECT" sh "$LOADER_SH" --noop=1
	[ "$status" -eq 0 ]
	[ "$(cat "$CAPTURE")" = "local vitest-agent-mcp --noop=1" ]
	# Nothing printed on either stream on the happy path.
	[ -z "$output" ]
}

@test "start-mcp.sh exports VITEST_AGENT_REPORTER_PROJECT_DIR to the bin" {
	cat > "${PROJECT}/node_modules/.bin/vitest-agent-mcp" <<'STUB'
#!/bin/bash
echo "${VITEST_AGENT_REPORTER_PROJECT_DIR:-unset}" >> "$CAPTURE"
STUB
	chmod +x "${PROJECT}/node_modules/.bin/vitest-agent-mcp"
	run env CLAUDE_PROJECT_DIR="$PROJECT" sh "$LOADER_SH"
	[ "$status" -eq 0 ]
	[ "$(cat "$CAPTURE")" = "$PROJECT" ]
}

@test "start-mcp.sh falls back to npx --yes and prints the pnpm install line to stderr" {
	touch "${PROJECT}/pnpm-lock.yaml"
	run --separate-stderr env CLAUDE_PROJECT_DIR="$PROJECT" sh "$LOADER_SH" --noop=1
	[ "$status" -eq 0 ]
	[ "$(cat "$CAPTURE")" = "npx --yes @vitest-agent/mcp@4 --noop=1" ]
	[ -z "$output" ]
	[[ "$stderr" == *"vitest-agent-mcp is not installed"* ]]
	[[ "$stderr" == *"Detected package manager: pnpm"* ]]
	[[ "$stderr" == *"  pnpm add -D @vitest-agent/plugin"* ]]
	[[ "$stderr" == *"Falling back to \`npx --yes @vitest-agent/mcp@4\`"* ]]
}

@test "start-mcp.sh install line follows the packageManager field over a lockfile (no jq)" {
	touch "${PROJECT}/pnpm-lock.yaml"
	printf '{ "name": "x", "packageManager": "yarn@4.5.0" }\n' > "${PROJECT}/package.json"
	run --separate-stderr env CLAUDE_PROJECT_DIR="$PROJECT" PATH="${STUBS}:/usr/bin:/bin" sh "$LOADER_SH"
	[ "$status" -eq 0 ]
	[[ "$stderr" == *"Detected package manager: yarn"* ]]
	[[ "$stderr" == *"  yarn add -D @vitest-agent/plugin"* ]]
}

@test "start-mcp.sh install line covers bun and npm lockfiles" {
	touch "${PROJECT}/bun.lockb"
	run --separate-stderr env CLAUDE_PROJECT_DIR="$PROJECT" sh "$LOADER_SH"
	[[ "$stderr" == *"  bun add -d @vitest-agent/plugin"* ]]
	rm "${PROJECT}/bun.lockb"
	touch "${PROJECT}/package-lock.json"
	run --separate-stderr env CLAUDE_PROJECT_DIR="$PROJECT" sh "$LOADER_SH"
	[[ "$stderr" == *"  npm install --save-dev @vitest-agent/plugin"* ]]
}

@test "start-mcp.sh defaults to npm with no package.json and no lockfile" {
	run --separate-stderr env CLAUDE_PROJECT_DIR="$PROJECT" sh "$LOADER_SH"
	[ "$status" -eq 0 ]
	[[ "$stderr" == *"Detected package manager: npm"* ]]
}

# ---------------------------------------------------------------------------
# start-mcp.mjs
# ---------------------------------------------------------------------------

@test "start-mcp.mjs spawns node_modules/.bin/vitest-agent-mcp when present" {
	link_bin vitest-agent-mcp
	run --separate-stderr env CLAUDE_PROJECT_DIR="$PROJECT" node "$LOADER_MJS" --noop=1
	[ "$status" -eq 0 ]
	[ "$(cat "$CAPTURE")" = "local vitest-agent-mcp --noop=1" ]
	[ -z "$stderr" ]
}

@test "start-mcp.mjs falls back to the package manager and prints the install line" {
	touch "${PROJECT}/pnpm-lock.yaml"
	cat > "${STUBS}/pnpm" <<'STUB'
#!/bin/bash
echo "pnpm $*" >> "$CAPTURE"
exit 0
STUB
	chmod +x "${STUBS}/pnpm"
	run --separate-stderr env CLAUDE_PROJECT_DIR="$PROJECT" node "$LOADER_MJS" --noop=1
	[ "$status" -eq 0 ]
	[ "$(cat "$CAPTURE")" = "pnpm exec vitest-agent-mcp --noop=1" ]
	[[ "$stderr" == *"is not installed in this project"* ]]
	[[ "$stderr" == *"  pnpm add -D @vitest-agent/plugin"* ]]
}

# ---------------------------------------------------------------------------
# hooks/lib/detect-pm.sh — detect_vitest_agent_bin
# ---------------------------------------------------------------------------

@test "detect_vitest_agent_bin prefers node_modules/.bin/vitest-agent when executable (relative path)" {
	link_bin vitest-agent
	touch "${PROJECT}/pnpm-lock.yaml"
	run bash -c ". '$DETECT_PM'; detect_vitest_agent_bin '$PROJECT'"
	[ "$status" -eq 0 ]
	# Relative on purpose: call sites expand it unquoted after `cd "$cwd"`, so
	# an absolute path would word-split on a space in the project path.
	[ "$output" = "node_modules/.bin/vitest-agent" ]
}

@test "detect_vitest_agent_bin falls back to the package-manager exec prefix" {
	touch "${PROJECT}/pnpm-lock.yaml"
	run bash -c ". '$DETECT_PM'; detect_vitest_agent_bin '$PROJECT'"
	[ "$status" -eq 0 ]
	[ "$output" = "pnpm exec vitest-agent" ]
}

@test "detect_vitest_agent_bin ignores a non-executable node_modules/.bin/vitest-agent" {
	touch "${PROJECT}/node_modules/.bin/vitest-agent"
	run bash -c ". '$DETECT_PM'; detect_vitest_agent_bin '$PROJECT'"
	[ "$status" -eq 0 ]
	[ "$output" = "npx --no-install vitest-agent" ]
}

@test "detect_vitest_agent_bin honors VITEST_AGENT_CLI_CMD over the local bin" {
	link_bin vitest-agent
	run env VITEST_AGENT_CLI_CMD="/custom/vitest-agent" bash -c ". '$DETECT_PM'; detect_vitest_agent_bin '$PROJECT'"
	[ "$status" -eq 0 ]
	[ "$output" = "/custom/vitest-agent" ]
}

@test "a hook routes through the local bin end to end (pre-tool-use/record.sh)" {
	link_bin vitest-agent
	local payload
	payload=$(jq -cn --arg cwd "$PROJECT" '{
		session_id: "bin-preference-001",
		cwd: $cwd,
		tool_name: "Read",
		tool_use_id: "toolu_bin_preference_001",
		tool_input: { file_path: "/tmp/example.ts" },
		hook_event_name: "PreToolUse"
	}')
	run bash -c "printf '%s' '$payload' | bash '${PLUGIN_DIR}/hooks/pre-tool-use/record.sh'"
	[ "$status" -eq 0 ]
	[ "$output" = '{"continue": true, "suppressOutput": true}' ]
	grep -q '^local vitest-agent agent record turn --chat-id bin-preference-001' "$CAPTURE"
}

@test "a hook runs the local bin when the project path contains a space" {
	local spaced="${PROJECT}/my project"
	mkdir -p "${spaced}/node_modules/.bin"
	local marker="${spaced}/ran"
	cat > "${spaced}/node_modules/.bin/vitest-agent" <<STUB
#!/bin/bash
printf '%s\n' "\$*" > "${marker}"
exit 0
STUB
	chmod +x "${spaced}/node_modules/.bin/vitest-agent"
	local payload
	payload=$(jq -cn --arg cwd "$spaced" '{
		session_id: "bin-preference-space-001",
		cwd: $cwd,
		tool_name: "Read",
		tool_use_id: "toolu_bin_preference_space_001",
		tool_input: { file_path: "/tmp/example.ts" },
		hook_event_name: "PreToolUse"
	}')
	run bash -c "printf '%s' '$payload' | bash '${PLUGIN_DIR}/hooks/pre-tool-use/record.sh'"
	[ "$status" -eq 0 ]
	[ "$output" = '{"continue": true, "suppressOutput": true}' ]
	[ -f "$marker" ]
	grep -q '^agent record turn --chat-id bin-preference-space-001' "$marker"
}

@test "test-location.sh runs the local bin when the project path contains a space" {
	local spaced="${PROJECT}/my project"
	mkdir -p "${spaced}/node_modules/.bin"
	local marker="${spaced}/ran"
	cat > "${spaced}/node_modules/.bin/vitest-agent" <<STUB
#!/bin/bash
printf '%s\n' "\$*" > "${marker}"
printf '{"verdict":"valid"}\n'
exit 0
STUB
	chmod +x "${spaced}/node_modules/.bin/vitest-agent"
	local payload
	payload=$(jq -cn --arg cwd "$spaced" --arg fp "${spaced}/src/example.test.ts" '{
		session_id: "bin-preference-space-002",
		cwd: $cwd,
		tool_name: "Write",
		tool_input: { file_path: $fp, content: "" },
		hook_event_name: "PreToolUse"
	}')
	run bash -c "printf '%s' '$payload' | bash '${PLUGIN_DIR}/hooks/pre-tool-use/test-location.sh'"
	[ "$status" -eq 0 ]
	[ -f "$marker" ]
	grep -q '^agent check-test-path ' "$marker"
}
