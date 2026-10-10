# shellcheck shell=bash
# Shared setup for the vitest-agent plugin's bats suites.
#
# Every suite runs the BUILT scripts under builds/<target>/ through
# pluginfinity's bats helper, once per target, so run `pluginfinity build`
# first. `run_hook` runs a hook the way its host runs it: under `env -i`, with
# the built entry's environment, HOME and XDG_STATE_HOME inside
# $BATS_TEST_TMPDIR, and Copilot hooks started from the plugin root.

load "$BATS_TEST_DIRNAME/../node_modules/pluginfinity/bats/pluginfinity.bash"

# Both hosts this plugin builds for.
VA_TARGETS=(claude copilot)

# The test's project directory (pluginfinity's shared one).
va_project() { _pf_project_dir; }

# va_fx <fixture> [overrides-json]: render __test__/fixtures/<fixture> with its
# __PROJECT__ placeholder set to the test project, merge the overrides, and
# print the path of the rendered copy.
va_fx() {
	local name=$1 overrides=${2:-} out
	[ -n "$overrides" ] || overrides='{}'
	out="$BATS_TEST_TMPDIR/fx-${name%.json}-$RANDOM.json"
	sed "s|__PROJECT__|$(va_project)|g" "$BATS_TEST_DIRNAME/fixtures/$name" |
		jq --argjson o "$overrides" '. + $o' >"$out"
	printf '%s\n' "$out"
}

# va_stub_cli [case-body]: write a fake `vitest-agent` that appends its argv to
# $VA_CAPTURE and then runs the optional case body (a bash `case "$*" in ...`
# arm list), and print its path. Hooks reach it through the
# VITEST_AGENT_CLI_CMD override, the first rung of their CLI resolution.
va_stub_cli() {
	local body=${1:-}
	mkdir -p "$BATS_TEST_TMPDIR/stubs"
	VA_CAPTURE="$BATS_TEST_TMPDIR/argv"
	: >"$VA_CAPTURE"
	VA_STUB="$BATS_TEST_TMPDIR/stubs/vitest-agent"
	{
		printf '#!/bin/bash\n'
		printf 'echo "$*" >> %q\n' "$VA_CAPTURE"
		if [ -n "$body" ]; then
			printf 'case "$*" in\n%s\nesac\n' "$body"
		fi
		printf 'exit 0\n'
	} >"$VA_STUB"
	chmod +x "$VA_STUB"
}

# va_hook <target> <script> <fixture-path> [run_hook options / VAR=value...]:
# run_hook with the CLI stub wired in and the plugin's data dir pinned under
# the test's temp dir on both hosts.
va_hook() {
	local target=$1 script=$2 fixture=$3
	shift 3
	run_hook "$target" "$script" "$fixture" \
		VITEST_AGENT_CLI_CMD="$VA_STUB" \
		CLAUDE_PLUGIN_DATA="$BATS_TEST_TMPDIR/data" \
		COPILOT_PLUGIN_DATA="$BATS_TEST_TMPDIR/data" \
		"$@"
}

# Captured CLI calls.
va_argv_count() { wc -l <"$VA_CAPTURE" | tr -d ' '; }
va_argv_nth() { sed -n "${1}p" "$VA_CAPTURE"; }
va_argv_grep() { grep -- "$1" "$VA_CAPTURE" | head -n1 || true; }
va_argv_reset() { : >"$VA_CAPTURE"; }

# va_decision <target>: the permission decision in $output, or "none".
va_decision() {
	case "$1" in
	claude) printf '%s' "$output" | jq -r '.hookSpecificOutput.permissionDecision // "none"' ;;
	copilot) printf '%s' "$output" | jq -r '.permissionDecision // "none"' ;;
	esac
}

# va_reason <target>: the permission decision reason in $output.
va_reason() {
	case "$1" in
	claude) printf '%s' "$output" | jq -r '.hookSpecificOutput.permissionDecisionReason // ""' ;;
	copilot) printf '%s' "$output" | jq -r '.permissionDecisionReason // ""' ;;
	esac
}

# va_context <target>: the additional context in $output, or "".
va_context() {
	case "$1" in
	claude) printf '%s' "$output" | jq -r '.hookSpecificOutput.additionalContext // ""' ;;
	copilot) printf '%s' "$output" | jq -r '.additionalContext // ""' ;;
	esac
}

# va_updated_input <target>: the replacement tool input in $output, or "null".
va_updated_input() {
	case "$1" in
	claude) printf '%s' "$output" | jq -c '.hookSpecificOutput.updatedInput // null' ;;
	copilot) printf '%s' "$output" | jq -c '.modifiedArgs // null' ;;
	esac
}

# va_session_env <NAME=value...>: write a --session-env seed file and print it.
va_session_env() {
	local file="$BATS_TEST_TMPDIR/session-$RANDOM.env" pair
	: >"$file"
	for pair in "$@"; do
		printf '%s\n' "$pair" >>"$file"
	done
	printf '%s\n' "$file"
}
