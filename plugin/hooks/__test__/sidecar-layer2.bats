#!/usr/bin/env bats
# sidecar-layer2.bats — Phase D (T9.2) tests for Layer 2 binary-detection
# and JS-CLI fallback in pre-tool-use/bash.sh.
#
# Layer 2 runs after Layers 0 and 1 have passed.  Detection uses the
# VITEST_AGENT_SIDECAR_BIN env var (set by SessionStart via
# `vitest-agent agent sidecar-path`), NOT `command -v vitest-agent-sidecar`.
# When VITEST_AGENT_SIDECAR_BIN is non-empty and executable, the hook
# invokes it directly.  When it is absent or empty, the hook falls back to
# `$pm_exec vitest-agent agent inject-env ...`.
#
# Stub strategy:
#   Two separate capture files live in BATS_TMPDIR —
#     $BATS_SIDECAR_CAPTURE   — written by the fake vitest-agent-sidecar
#     $BATS_JSCLI_CAPTURE     — written by the fake vitest-agent (JS path)
#   Tests can assert "binary was used and JS was not" by checking line
#   counts: sidecar_count >= 1 && jscli_count == 0, and vice-versa.
#
#   install_sidecar_stub() writes the fake binary into BATS_STUB_DIR and
#   sets BATS_SIDECAR_BIN to its absolute path.  Binary-present tests pass
#   VITEST_AGENT_SIDECAR_BIN=${BATS_SIDECAR_BIN} into the hook subprocess.
#   Binary-missing tests add -u VITEST_AGENT_SIDECAR_BIN to env so the
#   ambient var (if any) does not bleed in.
#
# Ambient-env note: same issue as sidecar-prefilter.bats.  All Layer 2
# tests use a subagent context (env -u the two identity vars) so Layer 1
# does not short-circuit before Layer 2 runs.
#
# Parity contract: both stubs emit the same canned rewritten command so
# the hook's final updatedInput.command can be compared regardless of
# which path ran.

HOOKS_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
FIXTURES_DIR="${HOOKS_DIR}/fixtures"

BATS_SESSION_ID="test-session-id-bats-layer2-001"

# Canned rewritten command that BOTH stubs return.  Must be different
# from the raw input command so the hook emits an updatedInput rather
# than a noop.
CANNED_REWRITE='VITEST_AGENT_CONVERSATION_ID=bats-conv-001 VITEST_AGENT_AGENT_ID=bats-agent-001 vitest run'

setup() {
    BATS_TMPDIR="$(mktemp -d)"

    BATS_SIDECAR_CAPTURE="${BATS_TMPDIR}/sidecar-argv"
    BATS_JSCLI_CAPTURE="${BATS_TMPDIR}/jscli-argv"
    export BATS_SIDECAR_CAPTURE BATS_JSCLI_CAPTURE

    # Pre-create both capture files so line-count helpers work even when
    # a stub is never called.
    touch "${BATS_SIDECAR_CAPTURE}" "${BATS_JSCLI_CAPTURE}"

    # -----------------------------------------------------------------------
    # Fake vitest-agent-sidecar.
    # Called as: vitest-agent-sidecar inject-env --command <cmd> --cwd <dir>
    # Captures argv to BATS_SIDECAR_CAPTURE and emits CANNED_REWRITE on
    # stdout so the hook sees a real rewrite.
    # -----------------------------------------------------------------------
    # NOTE: not written into BATS_TMPDIR by default — individual tests that
    # want the binary-present branch write it via install_sidecar_stub().
    BATS_STUB_DIR="${BATS_TMPDIR}/stubs"
    mkdir -p "${BATS_STUB_DIR}"
    export BATS_STUB_DIR

    # -----------------------------------------------------------------------
    # Fake vitest-agent (JS CLI path).
    # Reached via: pnpm exec vitest-agent agent inject-env ...
    # The fake pnpm strips "exec" so argv[0] == "vitest-agent".
    # Captures argv to BATS_JSCLI_CAPTURE and emits CANNED_REWRITE so the
    # hook sees a real rewrite from the JS path too.
    # -----------------------------------------------------------------------
    cat > "${BATS_STUB_DIR}/vitest-agent" <<STUB
#!/bin/bash
echo "\$*" >> "\${BATS_JSCLI_CAPTURE}"
# Emit the canned rewrite when called for inject-env.
case "\$*" in
    *inject-env*) printf '%s\n' "${CANNED_REWRITE}" ;;
esac
exit 0
STUB
    chmod +x "${BATS_STUB_DIR}/vitest-agent"

    # Fake pnpm.
    cat > "${BATS_STUB_DIR}/pnpm" <<'STUB'
#!/bin/bash
case "$1" in
    exec) shift; exec "$@" ;;
    *)    exit 0 ;;
esac
STUB
    chmod +x "${BATS_STUB_DIR}/pnpm"

    export PATH="${BATS_STUB_DIR}:${PATH}"
}

teardown() {
    local env_dir="${HOME}/.claude/session-env/${BATS_SESSION_ID}"
    rm -f "${env_dir}/vitest-agent-hook.sh"
    rmdir "${env_dir}" 2>/dev/null || true

    rm -rf "${BATS_TMPDIR}"
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Place the fake vitest-agent-sidecar on PATH and set BATS_SIDECAR_BIN to
# its absolute path.  Binary-present tests pass VITEST_AGENT_SIDECAR_BIN
# into the hook subprocess via env(1) so the hook's Layer 2 env-var check
# finds the stub (the hook no longer uses `command -v` for detection).
install_sidecar_stub() {
    cat > "${BATS_STUB_DIR}/vitest-agent-sidecar" <<STUB
#!/bin/bash
echo "\$*" >> "\${BATS_SIDECAR_CAPTURE}"
# Emit the canned rewrite so the hook sees a real rewrite.
case "\$*" in
    inject-env*) printf '%s\n' "${CANNED_REWRITE}" ;;
esac
exit 0
STUB
    chmod +x "${BATS_STUB_DIR}/vitest-agent-sidecar"
    BATS_SIDECAR_BIN="${BATS_STUB_DIR}/vitest-agent-sidecar"
    export BATS_SIDECAR_BIN
}

# Remove the fake vitest-agent-sidecar (binary-absent branch).
remove_sidecar_stub() {
    rm -f "${BATS_STUB_DIR}/vitest-agent-sidecar"
}

sidecar_count() {
    wc -l < "${BATS_SIDECAR_CAPTURE}" | tr -d ' '
}

jscli_count() {
    wc -l < "${BATS_JSCLI_CAPTURE}" | tr -d ' '
}

# Build a subagent-context session-env file: AGENT_ID != MAIN_AGENT_ID so
# Layer 1 falls through to Layer 2.
write_subagent_session_env() {
    local env_dir="${HOME}/.claude/session-env/${BATS_SESSION_ID}"
    mkdir -p "$env_dir"
    cat > "${env_dir}/vitest-agent-hook.sh" <<'EOF'
export VITEST_AGENT_AGENT_ID="bats-subagent-uuid-layer2"
export VITEST_AGENT_MAIN_AGENT_ID="bats-main-uuid-layer2"
EOF
}

# Build a PreToolUse/Bash payload.
bash_payload() {
    local cmd="$1"
    local sid="${2:-${BATS_SESSION_ID}}"
    jq -n \
        --arg cmd "$cmd" \
        --arg sid "$sid" \
        '{
            session_id: $sid,
            cwd: "/Users/spencer/workspaces/spencerbeggs/vitest-agent",
            tool_name: "Bash",
            tool_use_id: "toolu_bats_layer2_001",
            tool_input: {
                command: $cmd,
                description: "bats layer2 test",
                timeout: 120000,
                run_in_background: false
            },
            hook_event_name: "PreToolUse"
        }'
}

# ---------------------------------------------------------------------------
# binary-present: hook uses the native sidecar, never touches the JS CLI
# ---------------------------------------------------------------------------

@test "Layer 2 binary-present: sidecar stub is invoked with inject-env" {
    install_sidecar_stub
    write_subagent_session_env
    local payload
    payload=$(bash_payload "vitest run" "${BATS_SESSION_ID}")
    run env -u VITEST_AGENT_AGENT_ID -u VITEST_AGENT_MAIN_AGENT_ID \
        VITEST_AGENT_SIDECAR_BIN="${BATS_SIDECAR_BIN}" \
        bash -c "echo '${payload}' | bash '${HOOKS_DIR}/pre-tool-use/bash.sh'"
    [ "$status" -eq 0 ]
    # Binary must have been called at least once.
    [ "$(sidecar_count)" -ge 1 ]
    # First captured argv must begin with "inject-env".
    local argv
    argv=$(head -n1 "${BATS_SIDECAR_CAPTURE}")
    [[ "$argv" == "inject-env"* ]]
}

@test "Layer 2 binary-present: JS CLI is NOT invoked when binary is available" {
    install_sidecar_stub
    write_subagent_session_env
    local payload
    payload=$(bash_payload "vitest run" "${BATS_SESSION_ID}")
    run env -u VITEST_AGENT_AGENT_ID -u VITEST_AGENT_MAIN_AGENT_ID \
        VITEST_AGENT_SIDECAR_BIN="${BATS_SIDECAR_BIN}" \
        bash -c "echo '${payload}' | bash '${HOOKS_DIR}/pre-tool-use/bash.sh'"
    [ "$status" -eq 0 ]
    # JS CLI capture file must remain empty.
    [ "$(jscli_count)" -eq 0 ]
}

@test "Layer 2 binary-present: hook emits updatedInput with rewritten command" {
    install_sidecar_stub
    write_subagent_session_env
    local payload
    payload=$(bash_payload "vitest run" "${BATS_SESSION_ID}")
    run env -u VITEST_AGENT_AGENT_ID -u VITEST_AGENT_MAIN_AGENT_ID \
        VITEST_AGENT_SIDECAR_BIN="${BATS_SIDECAR_BIN}" \
        bash -c "echo '${payload}' | bash '${HOOKS_DIR}/pre-tool-use/bash.sh'"
    [ "$status" -eq 0 ]
    # Output must be valid JSON with hookSpecificOutput.updatedInput.command.
    local cmd
    cmd=$(echo "$output" | jq -r '.hookSpecificOutput.updatedInput.command // empty')
    [ -n "$cmd" ]
    [ "$cmd" = "${CANNED_REWRITE}" ]
}

# ---------------------------------------------------------------------------
# binary-missing: hook falls back to the JS CLI
# ---------------------------------------------------------------------------

@test "Layer 2 binary-missing: JS CLI is invoked with 'agent inject-env'" {
    remove_sidecar_stub
    write_subagent_session_env
    local payload
    payload=$(bash_payload "vitest run" "${BATS_SESSION_ID}")
    run env -u VITEST_AGENT_AGENT_ID -u VITEST_AGENT_MAIN_AGENT_ID \
        -u VITEST_AGENT_SIDECAR_BIN \
        bash -c "echo '${payload}' | bash '${HOOKS_DIR}/pre-tool-use/bash.sh'"
    [ "$status" -eq 0 ]
    # JS CLI must have been called.
    [ "$(jscli_count)" -ge 1 ]
    local argv
    argv=$(head -n1 "${BATS_JSCLI_CAPTURE}")
    [[ "$argv" == "agent inject-env"* ]]
}

@test "Layer 2 binary-missing: native sidecar is NOT invoked" {
    remove_sidecar_stub
    write_subagent_session_env
    local payload
    payload=$(bash_payload "vitest run" "${BATS_SESSION_ID}")
    run env -u VITEST_AGENT_AGENT_ID -u VITEST_AGENT_MAIN_AGENT_ID \
        -u VITEST_AGENT_SIDECAR_BIN \
        bash -c "echo '${payload}' | bash '${HOOKS_DIR}/pre-tool-use/bash.sh'"
    [ "$status" -eq 0 ]
    # Binary capture file must remain empty.
    [ "$(sidecar_count)" -eq 0 ]
}

@test "Layer 2 binary-missing: hook emits updatedInput with rewritten command" {
    remove_sidecar_stub
    write_subagent_session_env
    local payload
    payload=$(bash_payload "vitest run" "${BATS_SESSION_ID}")
    run env -u VITEST_AGENT_AGENT_ID -u VITEST_AGENT_MAIN_AGENT_ID \
        -u VITEST_AGENT_SIDECAR_BIN \
        bash -c "echo '${payload}' | bash '${HOOKS_DIR}/pre-tool-use/bash.sh'"
    [ "$status" -eq 0 ]
    local cmd
    cmd=$(echo "$output" | jq -r '.hookSpecificOutput.updatedInput.command // empty')
    [ -n "$cmd" ]
    [ "$cmd" = "${CANNED_REWRITE}" ]
}

# ---------------------------------------------------------------------------
# fallback parity: binary path and JS path produce the same updatedInput
# ---------------------------------------------------------------------------

@test "Layer 2 parity: binary and JS-fallback paths produce identical updatedInput.command" {
    write_subagent_session_env
    local payload
    payload=$(bash_payload "vitest run" "${BATS_SESSION_ID}")

    # Run with binary present: pass VITEST_AGENT_SIDECAR_BIN into the subprocess.
    install_sidecar_stub
    run env -u VITEST_AGENT_AGENT_ID -u VITEST_AGENT_MAIN_AGENT_ID \
        VITEST_AGENT_SIDECAR_BIN="${BATS_SIDECAR_BIN}" \
        bash -c "echo '${payload}' | bash '${HOOKS_DIR}/pre-tool-use/bash.sh'"
    [ "$status" -eq 0 ]
    local cmd_binary
    cmd_binary=$(echo "$output" | jq -r '.hookSpecificOutput.updatedInput.command // empty')

    # Reset capture files between the two runs.
    > "${BATS_SIDECAR_CAPTURE}"
    > "${BATS_JSCLI_CAPTURE}"

    # Run with binary absent: unset VITEST_AGENT_SIDECAR_BIN so the hook
    # falls through to the JS CLI.
    remove_sidecar_stub
    run env -u VITEST_AGENT_AGENT_ID -u VITEST_AGENT_MAIN_AGENT_ID \
        -u VITEST_AGENT_SIDECAR_BIN \
        bash -c "echo '${payload}' | bash '${HOOKS_DIR}/pre-tool-use/bash.sh'"
    [ "$status" -eq 0 ]
    local cmd_js
    cmd_js=$(echo "$output" | jq -r '.hookSpecificOutput.updatedInput.command // empty')

    # Both must be non-empty and equal.
    [ -n "$cmd_binary" ]
    [ -n "$cmd_js" ]
    [ "$cmd_binary" = "$cmd_js" ]
}
