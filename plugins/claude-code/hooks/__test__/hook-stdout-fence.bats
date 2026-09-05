#!/usr/bin/env bats
# hook-stdout-fence.bats — regression coverage for issue #373.
#
# Claude Code parses a hook's stdout as ONE JSON object. Before the fix,
# `post-tool-use/test-run.sh` redirected only stderr on its two
# `vitest-agent agent record` calls, so `record test-case-turns`' own JSON
# result object was prepended to the hook payload and the host rejected the
# whole thing with "Hook output looks like a JSON object but is not valid
# JSON".
#
# Two layers are asserted here:
#   1. lib/hook-output.sh fences fd 1 — anything a sourcing script (or a CLI
#      it spawns) writes to stdout is diverted to stderr, and only the emit_*
#      helpers reach the real hook stdout on fd 3.
#   2. post-tool-use/test-run.sh emits exactly one object with a CLI stub that
#      deliberately prints to stdout.
#
# Every assertion reads stdout ALONE (stderr goes to /dev/null), because bats
# merges the two into $output by default and that would hide the very leak
# under test.

HOOKS_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../../../.." && pwd)"
LIB="${HOOKS_DIR}/lib/hook-output.sh"

setup() {
	BATS_TMPDIR="$(mktemp -d)"

	# Fake vitest-agent: prints a JSON result object on stdout, exactly like
	# the real `agent record test-case-turns` does.
	cat > "${BATS_TMPDIR}/vitest-agent" <<'STUB'
#!/bin/bash
echo '{"updated":190,"latestTestCaseId":null}'
echo 'some stderr diagnostic' >&2
exit 0
STUB
	chmod +x "${BATS_TMPDIR}/vitest-agent"

	cat > "${BATS_TMPDIR}/pnpm" <<'STUB'
#!/bin/bash
case "$1" in
	exec) shift; exec "$@" ;;
	*) exit 0 ;;
esac
STUB
	chmod +x "${BATS_TMPDIR}/pnpm"

	export PATH="${BATS_TMPDIR}:${PATH}"
}

teardown() {
	rm -rf "${BATS_TMPDIR}"
}

# Source the lib in a clean strict-mode shell and run $1, returning ONLY the
# real hook stdout. The redirections live INSIDE the helper: applying them to
# `run` itself would not reach the command bats executes.
lib_stdout() {
	env -i PATH="$PATH" LIB="$LIB" SNIPPET="$1" \
		bash -c 'set -euo pipefail; . "$LIB"; eval "$SNIPPET"' 2>/dev/null
}

# The same, returning ONLY stderr — where the fence diverts stray stdout.
lib_stderr() {
	env -i PATH="$PATH" LIB="$LIB" SNIPPET="$1" \
		bash -c 'set -euo pipefail; . "$LIB"; eval "$SNIPPET"' 2>&1 1>/dev/null
}

# Run a hook script with a JSON payload, returning ONLY its stdout.
run_hook_stdout() {
	local script="$1" payload="$2"
	printf '%s' "$payload" | bash "$script" 2>/dev/null
}

# ---------------------------------------------------------------------------
# lib/hook-output.sh — the fence
# ---------------------------------------------------------------------------

@test "fence: stray stdout from the sourcing script never reaches hook stdout" {
	run lib_stdout 'echo LEAK; emit_noop'
	[ "$status" -eq 0 ]
	[ "$output" = '{"continue": true, "suppressOutput": true}' ]
}

@test "fence: stray stdout from a spawned subprocess never reaches hook stdout" {
	run lib_stdout 'vitest-agent agent record test-case-turns; emit_noop'
	[ "$status" -eq 0 ]
	[ "$output" = '{"continue": true, "suppressOutput": true}' ]
}

@test "fence: diverted stdout is preserved on stderr rather than discarded" {
	run lib_stderr 'echo LEAK; emit_noop'
	[ "$status" -eq 0 ]
	[ "$output" = "LEAK" ]
}

@test "fence: command substitution still captures a subprocess stdout" {
	run lib_stdout 'v=$(printf captured); emit_additional_context PostToolUse "$v"'
	[ "$status" -eq 0 ]
	[ "$(jq -r '.hookSpecificOutput.additionalContext' <<< "$output")" = "captured" ]
}

@test "fence: every emitter writes exactly one object to the fenced descriptor" {
	for emitter in 'emit_noop' 'emit_allow r' 'emit_deny r' \
		'emit_additional_context PostToolUse c' 'emit_system_message m'; do
		run lib_stdout "$emitter"
		[ "$status" -eq 0 ]
		echo "$output" | jq -e . >/dev/null
		[ "$(echo "$output" | jq -s 'length')" -eq 1 ]
	done
}

@test "fence: sourcing the lib twice does not double-redirect stdout" {
	run lib_stdout '. "$LIB"; emit_noop'
	[ "$status" -eq 0 ]
	[ "$output" = '{"continue": true, "suppressOutput": true}' ]
}

# ---------------------------------------------------------------------------
# post-tool-use/test-run.sh — the reported defect
# ---------------------------------------------------------------------------

@test "test-run: emits exactly one JSON object when the CLI prints to stdout" {
	payload=$(jq -cn --arg cwd "$REPO_ROOT" '{
		tool_name: "Bash",
		tool_input: { command: "pnpm test" },
		tool_response: { exit_code: 0 },
		cwd: $cwd,
		session_id: "11111111-2222-3333-4444-555555555555"
	}')
	run run_hook_stdout "${HOOKS_DIR}/post-tool-use/test-run.sh" "$payload"
	[ "$status" -eq 0 ]
	[ "$(echo "$output" | jq -s 'length')" -eq 1 ]
	[ "$output" = '{"continue": true, "suppressOutput": true}' ]
}

@test "test-run: failure path still emits exactly one object with the guidance" {
	payload=$(jq -cn --arg cwd "$REPO_ROOT" '{
		tool_name: "Bash",
		tool_input: { command: "pnpm test" },
		tool_response: { exit_code: 1 },
		cwd: $cwd,
		session_id: "11111111-2222-3333-4444-555555555555"
	}')
	run run_hook_stdout "${HOOKS_DIR}/post-tool-use/test-run.sh" "$payload"
	[ "$status" -eq 0 ]
	[ "$(echo "$output" | jq -s 'length')" -eq 1 ]
	[ "$(echo "$output" | jq -r '.hookSpecificOutput.hookEventName')" = "PostToolUse" ]
	echo "$output" | jq -r '.hookSpecificOutput.additionalContext' | grep -q "test_failure_guidance"
}

@test "test-run: a non-test command emits exactly one no-op object" {
	payload=$(jq -cn --arg cwd "$REPO_ROOT" '{
		tool_name: "Bash",
		tool_input: { command: "ls -la" },
		tool_response: { exit_code: 0 },
		cwd: $cwd,
		session_id: "11111111-2222-3333-4444-555555555555"
	}')
	run run_hook_stdout "${HOOKS_DIR}/post-tool-use/test-run.sh" "$payload"
	[ "$status" -eq 0 ]
	[ "$output" = '{"continue": true, "suppressOutput": true}' ]
}

# ---------------------------------------------------------------------------
# emit_raw — the escape hatch for tool-specific updatedInput payloads
# ---------------------------------------------------------------------------

@test "fence: emit_raw forwards a piped payload to the real hook stdout" {
	run lib_stdout 'jq -nc "{ a: 1 }" | emit_raw'
	[ "$status" -eq 0 ]
	[ "$(echo "$output" | jq -r '.a')" = "1" ]
	[ "$(echo "$output" | jq -s 'length')" -eq 1 ]
}

@test "fence: a hook that writes its payload with a bare jq is caught here" {
	# Every hook that sources hook-output.sh must route a statement-level
	# `jq -n` payload through emit_raw — a bare one lands on stderr once the
	# fence is installed, and the host sees an empty response. Count the
	# statement-level `jq -n` lines (column 1, so never a command
	# substitution) and require an emit_raw for each.
	for script in "${HOOKS_DIR}"/*/*.sh; do
		case "$script" in *"/__test__/"* | *"/lib/"*) continue ;; esac
		grep -q 'hook-output.sh' "$script" || continue
		bare=$(grep -c '^jq -n' "$script" || true)
		routed=$(grep -c '| emit_raw' "$script" || true)
		[ "$bare" -eq "$routed" ] || {
			echo "$script: $bare statement-level 'jq -n' but $routed '| emit_raw'"
			return 1
		}
	done
}
