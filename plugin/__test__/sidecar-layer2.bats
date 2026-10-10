#!/usr/bin/env bats
# sidecar-layer2.bats — Layer 2 binary detection and JS-CLI fallback in
# hooks/pre-tool-use/bash.sh, on both targets.
#
# Layer 2 runs after Layers 0 and 1 have passed. Detection uses the session's
# VITEST_AGENT_SIDECAR_BIN (set by SessionStart via
# `vitest-agent agent sidecar-path`), NOT `command -v vitest-agent-sidecar`.
# When it is non-empty and executable, the hook runs it directly. Otherwise it
# falls back to the JS CLI (va_cli: override, then node_modules/.bin, then
# PATH) running `vitest-agent agent inject-env ...`.
#
# Both stubs emit the same canned rewrite, so the hook's replacement input can
# be compared whichever path ran. Every test runs in a subagent context
# (AGENT_ID != MAIN_AGENT_ID) so Layer 1 does not short-circuit.

load common

HOOK=hooks/pre-tool-use/bash.sh
CANNED_REWRITE='VITEST_AGENT_CONVERSATION_ID=bats-conv-001 VITEST_AGENT_AGENT_ID=bats-agent-001 vitest run'

setup() {
	va_stub_cli "*inject-env*) printf '%s\n' '$CANNED_REWRITE' ;;"
	SIDECAR="$BATS_TEST_TMPDIR/stubs/vitest-agent-sidecar"
	SIDECAR_CAPTURE="$BATS_TEST_TMPDIR/sidecar-argv"
	: >"$SIDECAR_CAPTURE"
	cat >"$SIDECAR" <<STUB
#!/bin/bash
echo "\$*" >> "$SIDECAR_CAPTURE"
case "\$*" in
	inject-env*) printf '%s\n' '$CANNED_REWRITE' ;;
esac
exit 0
STUB
	chmod +x "$SIDECAR"
	WITH_BIN=$(va_session_env VITEST_AGENT_AGENT_ID=bats-subagent-uuid-layer2 VITEST_AGENT_MAIN_AGENT_ID=bats-main-uuid-layer2 "VITEST_AGENT_SIDECAR_BIN=$SIDECAR")
	WITHOUT_BIN=$(va_session_env VITEST_AGENT_AGENT_ID=bats-subagent-uuid-layer2 VITEST_AGENT_MAIN_AGENT_ID=bats-main-uuid-layer2)
}

_run() {
	va_hook "$1" "$HOOK" "$(va_fx pre-tool-use-bash.json '{"tool_input":{"command":"vitest run","description":"bats layer2 test","timeout":120000,"run_in_background":false}}')" --session-env "$2"
}

_sidecar_count() { wc -l <"$SIDECAR_CAPTURE" | tr -d ' '; }

@test "binary present: the sidecar runs inject-env and the JS CLI does not" {
	for t in "${VA_TARGETS[@]}"; do
		va_argv_reset
		: >"$SIDECAR_CAPTURE"
		_run "$t" "$WITH_BIN"
		assert_hook_exit 0
		[ "$(_sidecar_count)" -ge 1 ]
		[[ "$(head -n1 "$SIDECAR_CAPTURE")" == "inject-env"* ]]
		[ "$(va_argv_count)" -eq 0 ]
	done
}

@test "binary present: the hook allows the call with the rewritten command and keeps the other fields" {
	for t in "${VA_TARGETS[@]}"; do
		_run "$t" "$WITH_BIN"
		[ "$(va_decision "$t")" = allow ]
		[ "$(va_updated_input "$t" | jq -r .command)" = "$CANNED_REWRITE" ]
		[ "$(va_updated_input "$t" | jq -r .description)" = "bats layer2 test" ]
		[ "$(va_updated_input "$t" | jq -r .timeout)" = 120000 ]
		[ "$(va_updated_input "$t" | jq -r .run_in_background)" = false ]
	done
}

@test "binary missing: the JS CLI runs 'agent inject-env' and the sidecar does not" {
	for t in "${VA_TARGETS[@]}"; do
		va_argv_reset
		: >"$SIDECAR_CAPTURE"
		_run "$t" "$WITHOUT_BIN"
		[[ "$(va_argv_nth 1)" == "agent inject-env"* ]]
		[ "$(_sidecar_count)" -eq 0 ]
		[ "$(va_updated_input "$t" | jq -r .command)" = "$CANNED_REWRITE" ]
	done
}

@test "a non-executable sidecar path falls back to the JS CLI" {
	local seed
	chmod -x "$SIDECAR"
	seed=$(va_session_env VITEST_AGENT_AGENT_ID=a VITEST_AGENT_MAIN_AGENT_ID=b "VITEST_AGENT_SIDECAR_BIN=$SIDECAR")
	for t in "${VA_TARGETS[@]}"; do
		va_argv_reset
		_run "$t" "$seed"
		[[ "$(va_argv_nth 1)" == "agent inject-env"* ]]
	done
}

@test "parity: binary and JS-fallback paths produce the same replacement command" {
	local via_bin via_js
	for t in "${VA_TARGETS[@]}"; do
		_run "$t" "$WITH_BIN"
		via_bin=$(va_updated_input "$t" | jq -r .command)
		_run "$t" "$WITHOUT_BIN"
		via_js=$(va_updated_input "$t" | jq -r .command)
		[ -n "$via_bin" ]
		[ "$via_bin" = "$via_js" ]
	done
}

@test "no rewrite from the sidecar lets the call through untouched" {
	va_stub_cli '*inject-env*) printf "%s\n" "vitest run" ;;'
	for t in "${VA_TARGETS[@]}"; do
		_run "$t" "$WITHOUT_BIN"
		assert_hook_noop
	done
}
