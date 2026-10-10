#!/usr/bin/env bats
# bin-preference.bats — the carrier pattern (issue #412), on both targets.
#
# `@vitest-agent/plugin` declares the `vitest-agent` / `vitest-agent-mcp` bins
# itself so a consumer that depends only on the plugin gets them linked into
# node_modules/.bin. The MCP launcher (bin/start-mcp.sh) prefers that linked
# bin and only falls back to a major-pinned `npx --yes` when it is absent.
# Hooks resolve the CLI through va_cli (hooks/lib/vitest-agent/common.sh)
# instead: override env var, then the linked bin, then `vitest-agent` on PATH,
# then fail open with no output — hooks never dispatch through a package
# manager and never fall back to `npx`.
#
# Every case runs under env -i on a controlled PATH holding only stubs and the
# tools the scripts need, so no real package manager or `vitest-agent` can be
# reached.

load common

setup() {
	PROJECT=$(cd "$(va_project)" && pwd -P)
	mkdir -p "$PROJECT/node_modules/.bin"
	CAPTURE="$BATS_TEST_TMPDIR/argv"
	: >"$CAPTURE"
	STUBS="$BATS_TEST_TMPDIR/stubs"
	mkdir -p "$STUBS"
	# Every runner is a stub that records its call; none can start a real server.
	local r tool
	for r in pnpm yarn bun bunx npx; do
		printf '#!/bin/sh\necho "%s $*" >> "%s"\nexit 0\n' "$r" "$CAPTURE" >"$STUBS/$r"
		chmod +x "$STUBS/$r"
	done
	# The tools the launcher, the hook library and the hooks run.
	for tool in sh bash jq cat mktemp rm date mkdir basename dirname grep sed env head sort tr wc pwd; do
		if command -v "$tool" >/dev/null 2>&1 && [ ! -e "$STUBS/$tool" ]; then
			ln -s "$(command -v "$tool")" "$STUBS/$tool"
		fi
	done
	SAFE_PATH="$STUBS"
}

# link_bin <name> [dir]: an argv-echoing fixture at <dir>/node_modules/.bin/<name>.
link_bin() {
	local dir=${2:-$PROJECT}
	mkdir -p "$dir/node_modules/.bin"
	printf '#!/bin/sh\necho "local $(basename "$0") $*" >> "%s"\nexit 0\n' "$CAPTURE" >"$dir/node_modules/.bin/$1"
	chmod +x "$dir/node_modules/.bin/$1"
}

# launch <target> [args...]: run the built launcher the way the host starts the
# server: Claude Code from the project with CLAUDE_PROJECT_DIR set; Copilot from
# the plugin root, with nothing naming the project (measured, Copilot CLI
# 1.0.92), so the server cannot learn it.
launch() {
	local t=$1
	shift
	local extra=()
	if [ "$t" = claude ]; then
		extra=(CLAUDE_PROJECT_DIR="$PROJECT")
		cd "$PROJECT"
	else
		cd "$PLUGIN_DIR/builds/copilot"
	fi
	run --separate-stderr env -i PATH="$SAFE_PATH" HOME="$BATS_TEST_TMPDIR/home" \
		XDG_STATE_HOME="$BATS_TEST_TMPDIR/state" PLUGINFINITY_HOST="$t" PLUGINFINITY_PLUGIN=vitest-agent \
		PLUGINFINITY_LIB="$PLUGIN_DIR/builds/$t/lib/pluginfinity" ${extra[@]+"${extra[@]}"} \
		sh "$PLUGIN_DIR/builds/$t/bin/start-mcp.sh" "$@"
}

# --- start-mcp.sh -----------------------------------------------------------

@test "start-mcp.sh execs node_modules/.bin/vitest-agent-mcp when present, printing nothing (Claude Code)" {
	link_bin vitest-agent-mcp
	launch claude --noop=1
	[ "$status" -eq 0 ]
	[ "$(cat "$CAPTURE")" = "local vitest-agent-mcp --noop=1" ]
	[ -z "$output" ]
	[ -z "$stderr" ]
}

@test "start-mcp.sh pins VITEST_AGENT_REPORTER_PROJECT_DIR to the project (Claude Code)" {
	printf '#!/bin/sh\necho "${VITEST_AGENT_REPORTER_PROJECT_DIR:-unset}" >> "%s"\n' "$CAPTURE" >"$PROJECT/node_modules/.bin/vitest-agent-mcp"
	chmod +x "$PROJECT/node_modules/.bin/vitest-agent-mcp"
	launch claude
	[ "$(cat "$CAPTURE")" = "$PROJECT" ]
}

@test "start-mcp.sh falls back to npx --yes @vitest-agent/mcp@5 and prints the pnpm install line on stderr" {
	touch "$PROJECT/pnpm-lock.yaml"
	launch claude --noop=1
	[ "$status" -eq 0 ]
	[ "$(cat "$CAPTURE")" = "npx --yes @vitest-agent/mcp@5 --noop=1" ]
	[ -z "$output" ]
	[[ "$stderr" == *"vitest-agent-mcp is not installed"* ]]
	[[ "$stderr" == *"Detected package manager: pnpm"* ]]
	[[ "$stderr" == *"  pnpm add -D @vitest-agent/plugin"* ]]
	[[ "$stderr" == *"Falling back to \`npx --yes @vitest-agent/mcp@5\`"* ]]
}

@test "on Copilot the launcher cannot see the project: no project pin, npx fallback, and an error.log line" {
	link_bin vitest-agent-mcp
	launch copilot --noop=1
	[ "$status" -eq 0 ]
	[ -z "$output" ]
	[ "$(cat "$CAPTURE")" = "npx --yes @vitest-agent/mcp@5 --noop=1" ]
	[[ "$stderr" == *"Project directory: $PLUGIN_DIR/builds/copilot"* ]]
	grep -q "server/start-mcp.sh: no project directory for the MCP server" "$BATS_TEST_TMPDIR/state/pluginfinity/vitest-agent/error.log"
}

@test "start-mcp.sh install line follows the packageManager field over a lockfile (no jq)" {
	touch "$PROJECT/pnpm-lock.yaml"
	printf '{ "name": "x", "packageManager": "yarn@4.5.0" }\n' >"$PROJECT/package.json"
	rm -f "$STUBS/jq"
	launch claude
	[ "$status" -eq 0 ]
	[[ "$stderr" == *"Detected package manager: yarn"* ]]
	[[ "$stderr" == *"  yarn add -D @vitest-agent/plugin"* ]]
	[ "$(cat "$CAPTURE")" = "npx --yes @vitest-agent/mcp@5" ]
}

@test "start-mcp.sh install line covers bun and npm lockfiles, and defaults to npm" {
	touch "$PROJECT/bun.lockb"
	launch claude
	[[ "$stderr" == *"  bun add -d @vitest-agent/plugin"* ]]
	rm "$PROJECT/bun.lockb"
	touch "$PROJECT/package-lock.json"
	launch claude
	[[ "$stderr" == *"  npm install --save-dev @vitest-agent/plugin"* ]]
	rm "$PROJECT/package-lock.json"
	launch claude
	[[ "$stderr" == *"Detected package manager: npm"* ]]
}

# --- va_cli, through a hook ------------------------------------------------

# record <target> <cwd> [VAR=value...]: run pre-tool-use/record.sh on a Read
# call from <cwd>, on the controlled PATH and with no CLI override.
record() {
	local t=$1 cwd=$2
	shift 2
	run_hook "$t" hooks/pre-tool-use/record.sh \
		"$(hook_fixture PreToolUse "$(jq -nc --arg c "$cwd" '{session_id: "bin-preference-001", cwd: $c, tool_name: "Read", tool_input: {file_path: "/tmp/example.ts"}}')")" \
		PATH="$SAFE_PATH" "$@"
}

@test "a hook runs the project's node_modules/.bin/vitest-agent" {
	link_bin vitest-agent
	for t in "${VA_TARGETS[@]}"; do
		: >"$CAPTURE"
		record "$t" "$PROJECT"
		assert_hook_noop
		grep -q '^local vitest-agent agent record turn --chat-id bin-preference-001' "$CAPTURE"
	done
}

@test "a hook runs the local bin when the project path contains a space" {
	local spaced="$PROJECT/my project"
	link_bin vitest-agent "$spaced"
	for t in "${VA_TARGETS[@]}"; do
		: >"$CAPTURE"
		record "$t" "$spaced"
		assert_hook_noop
		grep -q '^local vitest-agent agent record turn --chat-id bin-preference-001' "$CAPTURE"
	done
}

@test "a hook falls back to vitest-agent on PATH, ignoring a non-executable local bin" {
	touch "$PROJECT/node_modules/.bin/vitest-agent"
	printf '#!/bin/sh\necho "path vitest-agent $*" >> "%s"\n' "$CAPTURE" >"$STUBS/vitest-agent"
	chmod +x "$STUBS/vitest-agent"
	for t in "${VA_TARGETS[@]}"; do
		: >"$CAPTURE"
		record "$t" "$PROJECT"
		grep -q '^path vitest-agent agent record turn' "$CAPTURE"
	done
}

@test "a hook honors VITEST_AGENT_CLI_CMD over the local bin" {
	link_bin vitest-agent
	printf '#!/bin/sh\necho "override $*" >> "%s"\n' "$CAPTURE" >"$BATS_TEST_TMPDIR/custom-cli"
	chmod +x "$BATS_TEST_TMPDIR/custom-cli"
	for t in "${VA_TARGETS[@]}"; do
		: >"$CAPTURE"
		record "$t" "$PROJECT" VITEST_AGENT_CLI_CMD="$BATS_TEST_TMPDIR/custom-cli"
		grep -q '^override agent record turn' "$CAPTURE"
		run grep -c '^local ' "$CAPTURE"
		[ "$output" = 0 ]
	done
}

@test "with no CLI anywhere a hook fails open and never dispatches through a package manager" {
	touch "$PROJECT/pnpm-lock.yaml"
	for t in "${VA_TARGETS[@]}"; do
		: >"$CAPTURE"
		record "$t" "$PROJECT"
		assert_hook_noop
		[ ! -s "$CAPTURE" ]
	done
}

@test "test-location.sh runs the local bin when the project path contains a space" {
	local spaced="$PROJECT/my project"
	mkdir -p "$spaced/node_modules/.bin"
	printf '#!/bin/sh\necho "$*" >> "%s"\nprintf '"'"'{"verdict":"valid"}\\n'"'"'\n' "$CAPTURE" >"$spaced/node_modules/.bin/vitest-agent"
	chmod +x "$spaced/node_modules/.bin/vitest-agent"
	for t in "${VA_TARGETS[@]}"; do
		: >"$CAPTURE"
		run_hook "$t" hooks/pre-tool-use/test-location.sh \
			"$(hook_fixture PreToolUse "$(jq -nc --arg c "$spaced" --arg f "$spaced/src/example.test.ts" '{cwd: $c, tool_name: "Write", tool_input: {file_path: $f, content: ""}}')")" \
			PATH="$SAFE_PATH"
		assert_hook_noop
		grep -q '^agent check-test-path ' "$CAPTURE"
	done
}
