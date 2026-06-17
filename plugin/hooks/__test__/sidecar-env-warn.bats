#!/usr/bin/env bats
# sidecar-env-warn.bats — regression for the pnpm-stderr-WARN parse break.
#
# pnpm prints `[WARN] Cannot use both "packageManager" and
# "devEngines.packageManager" ...` to STDERR on every invocation. session/start.sh
# captured `register-agent` with 2>&1, folding that WARN into the JSON it parses
# with jq — which silently zeroed agentId and skipped the entire env block,
# including the VITEST_AGENT_SIDECAR_BIN export the PreToolUse hook needs.
#
# The fix captures stderr separately so stdout stays clean JSON. These tests
# reproduce the WARN via the fake pnpm and assert the env block is still written.
# Run on the pre-fix start.sh they fail (no env file / no SIDECAR_BIN export).
#
# Stub strategy mirrors cli-rename-cascade.bats: a fake pnpm on PATH strips
# "exec" and delegates, and a fake vitest-agent answers each subcommand. Here the
# fake pnpm also emits the real WARN to stderr, and the fake vitest-agent returns
# real JSON for register-agent and an executable path for sidecar-path.

HOOKS_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
FIXTURES_DIR="${HOOKS_DIR}/fixtures"

# Matches fixtures/session-start.json's session_id — the env file lands under
# ~/.claude/session-env/<session_id>/.
BATS_SESSION_ID="test-session-id-bats-001"

setup() {
    BATS_TMPDIR="$(mktemp -d)"
    BATS_ARGV_CAPTURE="${BATS_TMPDIR}/vitest-agent-argv"
    touch "${BATS_ARGV_CAPTURE}"
    export BATS_ARGV_CAPTURE

    # A real, executable file so start.sh's `[ -x "$_sidecar_bin" ]` check passes.
    BATS_FAKE_SIDECAR_BIN="${BATS_TMPDIR}/vitest-agent-sidecar-fake"
    printf '#!/bin/bash\nexit 0\n' > "${BATS_FAKE_SIDECAR_BIN}"
    chmod +x "${BATS_FAKE_SIDECAR_BIN}"
    export BATS_FAKE_SIDECAR_BIN

    # Fake vitest-agent: capture argv, and answer the subcommands start.sh parses.
    cat > "${BATS_TMPDIR}/vitest-agent" <<'STUB'
#!/bin/bash
echo "$*" >> "$BATS_ARGV_CAPTURE"
case "$*" in
    *register-agent*) printf '{"agentId":"bats-agent-uuid","conversationId":"bats-conv-uuid","mainAgentId":"bats-main-uuid"}\n' ;;
    *sidecar-path*)   printf '%s\n' "$BATS_FAKE_SIDECAR_BIN" ;;
    *)                : ;;
esac
exit 0
STUB
    chmod +x "${BATS_TMPDIR}/vitest-agent"

    # Fake pnpm: emit the real dual-field WARN to stderr (as pnpm 11 does on every
    # invocation), then strip "exec" and delegate. The WARN on stderr is exactly
    # what used to corrupt the parsed JSON.
    cat > "${BATS_TMPDIR}/pnpm" <<'STUB'
#!/bin/bash
echo '[WARN] Cannot use both "packageManager" and "devEngines.packageManager" in package.json. "packageManager" will be ignored' >&2
case "$1" in
    exec) shift; exec "$@" ;;
    *)    exit 0 ;;
esac
STUB
    chmod +x "${BATS_TMPDIR}/pnpm"

    export PATH="${BATS_TMPDIR}:${PATH}"

    ENV_DIR="${HOME}/.claude/session-env/${BATS_SESSION_ID}"
    ENV_FILE="${ENV_DIR}/vitest-agent-hook.sh"
    # Start clean so a stale file from a prior run can't mask a regression.
    rm -f "${ENV_FILE}"
}

teardown() {
    rm -f "${ENV_FILE}"
    rmdir "${ENV_DIR}" 2>/dev/null || true
    rm -rf "${BATS_TMPDIR}"
}

# CLAUDE_ENV_FILE is intentionally left unset so the hook writes only the
# per-session env file (and never appends to a real host env file under test).
run_start() {
    run env -u CLAUDE_ENV_FILE -u CLAUDE_PROJECT_DIR \
        bash -c "cat '${FIXTURES_DIR}/session-start.json' | bash '${HOOKS_DIR}/session/start.sh'"
}

@test "session/start.sh writes the env block despite pnpm's stderr WARN" {
    run_start
    [ "$status" -eq 0 ]
    # The WARN no longer zeroes agentId, so the gated env block runs and the file exists.
    [ -f "${ENV_FILE}" ]
    grep -q '^export VITEST_AGENT_AGENT_ID=' "${ENV_FILE}"
}

@test "session/start.sh persists VITEST_AGENT_SIDECAR_BIN despite pnpm's stderr WARN" {
    run_start
    [ "$status" -eq 0 ]
    grep -q '^export VITEST_AGENT_SIDECAR_BIN=' "${ENV_FILE}"
    # The persisted path is the resolved sidecar binary, not a WARN-corrupted value.
    grep -q "vitest-agent-sidecar-fake" "${ENV_FILE}"
}

@test "session/start.sh parses a clean agentId (no WARN text leaks into the canonical IDs)" {
    run_start
    [ "$status" -eq 0 ]
    # mainAgentId from the JSON drives VITEST_AGENT_AGENT_ID; a corrupted parse
    # would yield an empty or non-UUID value.
    grep -q '^export VITEST_AGENT_AGENT_ID=bats-main-uuid$' "${ENV_FILE}"
    run grep -c 'WARN' "${ENV_FILE}"
    [ "$output" -eq 0 ]
}
