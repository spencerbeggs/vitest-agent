#!/usr/bin/env bats
# sidecar-prefilter.bats — Phase A (T9.2) tests for Layer 0 (bash regex
# prefilter) and Layer 1 (main-agent identity skip) in
# pre-tool-use/bash.sh.
#
# Layer 0 exits early — never touching the sidecar — when the command
# cannot possibly invoke Vitest.  Layer 1 exits early when the current
# agent IS the main agent (env vars match).  Both emit the noop JSON
# and leave BATS_ARGV_CAPTURE empty.
#
# Stub strategy: same pnpm/vitest-agent fake pattern as
# cli-rename-cascade.bats.  The fake pnpm strips "exec" and delegates;
# the fake vitest-agent appends its argv to BATS_ARGV_CAPTURE and exits
# 0.  A zero-line capture file means the sidecar was never reached.
#
# Ambient-env note: when these tests run inside Claude Code's Bash tool
# the host already exports VITEST_AGENT_AGENT_ID and
# VITEST_AGENT_MAIN_AGENT_ID with identical values (the running agent).
# Tests that expect the sidecar to be reached must therefore strip those
# ambient vars from the subprocess with
#   env -u VITEST_AGENT_AGENT_ID -u VITEST_AGENT_MAIN_AGENT_ID bash -c "..."
# so Layer 1 doesn't fire before the sidecar is ever called.
# Tests that assert Layer 1 suppression write a session-env file whose
# values override the ambient vars after source_session_env runs.

HOOKS_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
FIXTURES_DIR="${HOOKS_DIR}/fixtures"

# Session id used for all Layer 1 tests. Must be a valid session-id shape
# (no slashes, no .., no whitespace) so source-session-env.sh won't
# reject it.
BATS_SESSION_ID="test-session-id-bats-001"

setup() {
    BATS_TMPDIR="$(mktemp -d)"
    BATS_ARGV_CAPTURE="${BATS_TMPDIR}/vitest-agent-argv"
    export BATS_ARGV_CAPTURE
    # Pre-create the capture file so wc -l works even when the sidecar
    # is never called.
    touch "${BATS_ARGV_CAPTURE}"

    # Write the fake vitest-agent stub.
    cat > "${BATS_TMPDIR}/vitest-agent" <<'STUB'
#!/bin/bash
# Fake vitest-agent: capture argv and succeed silently.
echo "$*" >> "$BATS_ARGV_CAPTURE"
exit 0
STUB
    chmod +x "${BATS_TMPDIR}/vitest-agent"

    # Write the fake pnpm stub.
    cat > "${BATS_TMPDIR}/pnpm" <<'STUB'
#!/bin/bash
case "$1" in
    exec) shift; exec "$@" ;;
    *)    exit 0 ;;
esac
STUB
    chmod +x "${BATS_TMPDIR}/pnpm"

    export PATH="${BATS_TMPDIR}:${PATH}"
}

teardown() {
    # Remove any session-env files written during the test.
    local env_dir="${HOME}/.claude/session-env/${BATS_SESSION_ID}"
    rm -f "${env_dir}/vitest-agent-hook.sh"
    rmdir "${env_dir}" 2>/dev/null || true

    rm -rf "${BATS_TMPDIR}"
}

# Helper: count lines in the capture file (0 = sidecar never called).
# Returns "0" when the file doesn't exist or is empty.
sidecar_call_count() {
    if [ ! -f "${BATS_ARGV_CAPTURE}" ]; then
        echo "0"
        return 0
    fi
    local n
    n=$(wc -l < "${BATS_ARGV_CAPTURE}" | tr -d ' ')
    echo "${n:-0}"
}

# Helper: build a PreToolUse/Bash payload inline.
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
            tool_use_id: "toolu_bats_prefilter_001",
            tool_input: {
                command: $cmd,
                description: "bats test invocation",
                timeout: 120000,
                run_in_background: false
            },
            hook_event_name: "PreToolUse"
        }'
}

# Helper: write a session-env file exporting the two agent ID vars.
write_session_env() {
    local agent_id="$1"
    local main_agent_id="$2"
    local env_dir="${HOME}/.claude/session-env/${BATS_SESSION_ID}"
    mkdir -p "$env_dir"
    cat > "${env_dir}/vitest-agent-hook.sh" <<EOF
export VITEST_AGENT_AGENT_ID="${agent_id}"
export VITEST_AGENT_MAIN_AGENT_ID="${main_agent_id}"
EOF
}

# ---------------------------------------------------------------------------
# Layer 0 — no-match commands emit noop without invoking the sidecar.
#
# These tests do NOT need to strip ambient VITEST_AGENT_* vars because
# the hook exits at Layer 0 (before Layer 1 even runs) and therefore
# the sidecar is never reached regardless of the agent-ID env.
# ---------------------------------------------------------------------------

@test "Layer 0: 'ls' command emits noop and never calls the sidecar" {
    local payload
    payload=$(bash_payload "ls")
    run bash -c "echo '${payload}' | bash '${HOOKS_DIR}/pre-tool-use/bash.sh'"
    [ "$status" -eq 0 ]
    # Output must be the emit_noop JSON.
    local noop_json
    noop_json=$(echo "$output" | jq -r '.continue // empty')
    [ "$noop_json" = "true" ]
    local suppress
    suppress=$(echo "$output" | jq -r '.suppressOutput // empty')
    [ "$suppress" = "true" ]
    # Sidecar must not have been called.
    [ "$(sidecar_call_count)" -eq 0 ]
}

@test "Layer 0: 'git status' command emits noop and never calls the sidecar" {
    local payload
    payload=$(bash_payload "git status")
    run bash -c "echo '${payload}' | bash '${HOOKS_DIR}/pre-tool-use/bash.sh'"
    [ "$status" -eq 0 ]
    local noop_json
    noop_json=$(echo "$output" | jq -r '.continue // empty')
    [ "$noop_json" = "true" ]
    [ "$(sidecar_call_count)" -eq 0 ]
}

@test "Layer 0: 'echo hello' command emits noop and never calls the sidecar" {
    local payload
    payload=$(bash_payload "echo hello")
    run bash -c "echo '${payload}' | bash '${HOOKS_DIR}/pre-tool-use/bash.sh'"
    [ "$status" -eq 0 ]
    local noop_json
    noop_json=$(echo "$output" | jq -r '.continue // empty')
    [ "$noop_json" = "true" ]
    [ "$(sidecar_call_count)" -eq 0 ]
}

# ---------------------------------------------------------------------------
# Layer 0 — match commands fall through and DO invoke the sidecar.
#
# These tests strip the ambient VITEST_AGENT_AGENT_ID and
# VITEST_AGENT_MAIN_AGENT_ID from the subprocess so Layer 1 doesn't
# fire before the sidecar is reached.
# ---------------------------------------------------------------------------

@test "Layer 0: bare 'vitest' reaches the sidecar" {
    local payload
    payload=$(bash_payload "vitest")
    run env -u VITEST_AGENT_AGENT_ID -u VITEST_AGENT_MAIN_AGENT_ID \
        bash -c "echo '${payload}' | bash '${HOOKS_DIR}/pre-tool-use/bash.sh'"
    [ "$status" -eq 0 ]
    local cnt
    cnt=$(sidecar_call_count)
    [ "$cnt" -ge 1 ]
    local argv
    argv=$(head -n1 "${BATS_ARGV_CAPTURE}" 2>/dev/null || echo "")
    [[ "$argv" == "agent inject-env"* ]]
}

@test "Layer 0: 'vitest run' reaches the sidecar" {
    local payload
    payload=$(bash_payload "vitest run")
    run env -u VITEST_AGENT_AGENT_ID -u VITEST_AGENT_MAIN_AGENT_ID \
        bash -c "echo '${payload}' | bash '${HOOKS_DIR}/pre-tool-use/bash.sh'"
    [ "$status" -eq 0 ]
    [ "$(sidecar_call_count)" -ge 1 ]
    local argv
    argv=$(head -n1 "${BATS_ARGV_CAPTURE}" 2>/dev/null || echo "")
    [[ "$argv" == "agent inject-env"* ]]
}

@test "Layer 0: 'pnpm test' reaches the sidecar" {
    local payload
    payload=$(bash_payload "pnpm test")
    run env -u VITEST_AGENT_AGENT_ID -u VITEST_AGENT_MAIN_AGENT_ID \
        bash -c "echo '${payload}' | bash '${HOOKS_DIR}/pre-tool-use/bash.sh'"
    [ "$status" -eq 0 ]
    [ "$(sidecar_call_count)" -ge 1 ]
    local argv
    argv=$(head -n1 "${BATS_ARGV_CAPTURE}" 2>/dev/null || echo "")
    [[ "$argv" == "agent inject-env"* ]]
}

@test "Layer 0: 'npm run test:int' reaches the sidecar" {
    local payload
    payload=$(bash_payload "npm run test:int")
    run env -u VITEST_AGENT_AGENT_ID -u VITEST_AGENT_MAIN_AGENT_ID \
        bash -c "echo '${payload}' | bash '${HOOKS_DIR}/pre-tool-use/bash.sh'"
    [ "$status" -eq 0 ]
    [ "$(sidecar_call_count)" -ge 1 ]
    local argv
    argv=$(head -n1 "${BATS_ARGV_CAPTURE}" 2>/dev/null || echo "")
    [[ "$argv" == "agent inject-env"* ]]
}

@test "Layer 0: 'node node_modules/.bin/vitest' reaches the sidecar" {
    local payload
    payload=$(bash_payload "node node_modules/.bin/vitest")
    run env -u VITEST_AGENT_AGENT_ID -u VITEST_AGENT_MAIN_AGENT_ID \
        bash -c "echo '${payload}' | bash '${HOOKS_DIR}/pre-tool-use/bash.sh'"
    [ "$status" -eq 0 ]
    [ "$(sidecar_call_count)" -ge 1 ]
    local argv
    argv=$(head -n1 "${BATS_ARGV_CAPTURE}" 2>/dev/null || echo "")
    [[ "$argv" == "agent inject-env"* ]]
}

@test "Layer 0: 'pnpm exec vitest --watch' reaches the sidecar" {
    local payload
    payload=$(bash_payload "pnpm exec vitest --watch")
    run env -u VITEST_AGENT_AGENT_ID -u VITEST_AGENT_MAIN_AGENT_ID \
        bash -c "echo '${payload}' | bash '${HOOKS_DIR}/pre-tool-use/bash.sh'"
    [ "$status" -eq 0 ]
    [ "$(sidecar_call_count)" -ge 1 ]
    local argv
    argv=$(head -n1 "${BATS_ARGV_CAPTURE}" 2>/dev/null || echo "")
    [[ "$argv" == "agent inject-env"* ]]
}

# ---------------------------------------------------------------------------
# Layer 0 — dash-suffixed test script names (PR #75 fix).
#
# The regex was widened from test([s]?|:[a-z_-]+)? to
# test([s]?|[:_-][a-z_-]+)? so dash-separated names like test-unit and
# test-e2e match alongside colon-separated names like test:int.
# ---------------------------------------------------------------------------

@test "Layer 0: 'pnpm run test-unit' reaches the sidecar (dash-suffix fix)" {
    local payload
    payload=$(bash_payload "pnpm run test-unit")
    run env -u VITEST_AGENT_AGENT_ID -u VITEST_AGENT_MAIN_AGENT_ID \
        bash -c "echo '${payload}' | bash '${HOOKS_DIR}/pre-tool-use/bash.sh'"
    [ "$status" -eq 0 ]
    [ "$(sidecar_call_count)" -ge 1 ]
    local argv
    argv=$(head -n1 "${BATS_ARGV_CAPTURE}" 2>/dev/null || echo "")
    [[ "$argv" == "agent inject-env"* ]]
}

@test "Layer 0: 'npm run test-e2e' reaches the sidecar (dash-suffix fix)" {
    local payload
    payload=$(bash_payload "npm run test-e2e")
    run env -u VITEST_AGENT_AGENT_ID -u VITEST_AGENT_MAIN_AGENT_ID \
        bash -c "echo '${payload}' | bash '${HOOKS_DIR}/pre-tool-use/bash.sh'"
    [ "$status" -eq 0 ]
    [ "$(sidecar_call_count)" -ge 1 ]
    local argv
    argv=$(head -n1 "${BATS_ARGV_CAPTURE}" 2>/dev/null || echo "")
    [[ "$argv" == "agent inject-env"* ]]
}

@test "Layer 0: 'yarn test-watch' reaches the sidecar (dash-suffix fix)" {
    local payload
    payload=$(bash_payload "yarn test-watch")
    run env -u VITEST_AGENT_AGENT_ID -u VITEST_AGENT_MAIN_AGENT_ID \
        bash -c "echo '${payload}' | bash '${HOOKS_DIR}/pre-tool-use/bash.sh'"
    [ "$status" -eq 0 ]
    [ "$(sidecar_call_count)" -ge 1 ]
    local argv
    argv=$(head -n1 "${BATS_ARGV_CAPTURE}" 2>/dev/null || echo "")
    [[ "$argv" == "agent inject-env"* ]]
}

@test "Layer 0: 'pnpm run testing' still emits noop (not a test script name)" {
    local payload
    payload=$(bash_payload "pnpm run testing")
    run bash -c "echo '${payload}' | bash '${HOOKS_DIR}/pre-tool-use/bash.sh'"
    [ "$status" -eq 0 ]
    local noop_json
    noop_json=$(echo "$output" | jq -r '.continue // empty')
    [ "$noop_json" = "true" ]
    [ "$(sidecar_call_count)" -eq 0 ]
}

# Layer 0 intentionally accepts false positives — Layer 2 gates
# correctness, not Layer 0.  Commands that merely mention "vitest" in a
# string reach the sidecar; that is acceptable behaviour.
@test "Layer 0 false-positive: 'echo vitest' reaches the sidecar (acceptable)" {
    local payload
    payload=$(bash_payload "echo vitest")
    run env -u VITEST_AGENT_AGENT_ID -u VITEST_AGENT_MAIN_AGENT_ID \
        bash -c "echo '${payload}' | bash '${HOOKS_DIR}/pre-tool-use/bash.sh'"
    [ "$status" -eq 0 ]
    # The word "vitest" is present so Layer 0 passes it through; we
    # assert the sidecar was called (not that the output is a rewrite).
    [ "$(sidecar_call_count)" -ge 1 ]
}

# ---------------------------------------------------------------------------
# Layer 1 — main-agent context emits noop and skips the sidecar.
#
# write_session_env sets AGENT_ID == MAIN_AGENT_ID.  The subprocess
# MUST NOT strip the ambient vars here — we want source_session_env to
# source the file (which overwrites the ambient values) and then have
# Layer 1 observe the match.  Because the file sets the same value for
# both vars, it doesn't matter whether ambient vars are equal or not;
# after source the values from the file dominate.  We keep ambient vars
# in place to mirror the real production context.
# ---------------------------------------------------------------------------

@test "Layer 1: AGENT_ID == MAIN_AGENT_ID emits noop and skips the sidecar" {
    write_session_env "uuid-main-0001" "uuid-main-0001"
    local payload
    payload=$(bash_payload "vitest run" "${BATS_SESSION_ID}")
    run bash -c "echo '${payload}' | bash '${HOOKS_DIR}/pre-tool-use/bash.sh'"
    [ "$status" -eq 0 ]
    # Output is the emit_noop JSON.
    local noop_json
    noop_json=$(echo "$output" | jq -r '.continue // empty')
    [ "$noop_json" = "true" ]
    local suppress
    suppress=$(echo "$output" | jq -r '.suppressOutput // empty')
    [ "$suppress" = "true" ]
    # Sidecar must not have been called.
    [ "$(sidecar_call_count)" -eq 0 ]
}

# ---------------------------------------------------------------------------
# Layer 1 — subagent context (IDs differ) falls through to the sidecar.
#
# The session-env file sets AGENT_ID != MAIN_AGENT_ID; after
# source_session_env those values override any ambient vars.  Layer 1
# must NOT skip.
# ---------------------------------------------------------------------------

@test "Layer 1: AGENT_ID != MAIN_AGENT_ID falls through and calls the sidecar" {
    write_session_env "uuid-subagent-0001" "uuid-main-0001"
    local payload
    payload=$(bash_payload "vitest run" "${BATS_SESSION_ID}")
    run env -u VITEST_AGENT_AGENT_ID -u VITEST_AGENT_MAIN_AGENT_ID \
        bash -c "echo '${payload}' | bash '${HOOKS_DIR}/pre-tool-use/bash.sh'"
    [ "$status" -eq 0 ]
    [ "$(sidecar_call_count)" -ge 1 ]
    local argv
    argv=$(head -n1 "${BATS_ARGV_CAPTURE}" 2>/dev/null || echo "")
    [[ "$argv" == "agent inject-env"* ]]
}

# ---------------------------------------------------------------------------
# Layer 1 — missing / partial env falls through (conservative: no silent skip).
#
# All three tests strip ambient vars so the hook sees only what the
# session-env file provides (or nothing).
# ---------------------------------------------------------------------------

@test "Layer 1: only AGENT_ID set (MAIN_AGENT_ID absent) falls through to sidecar" {
    local env_dir="${HOME}/.claude/session-env/${BATS_SESSION_ID}"
    mkdir -p "$env_dir"
    cat > "${env_dir}/vitest-agent-hook.sh" <<'EOF'
export VITEST_AGENT_AGENT_ID="uuid-only-agent"
EOF
    local payload
    payload=$(bash_payload "vitest run" "${BATS_SESSION_ID}")
    run env -u VITEST_AGENT_AGENT_ID -u VITEST_AGENT_MAIN_AGENT_ID \
        bash -c "echo '${payload}' | bash '${HOOKS_DIR}/pre-tool-use/bash.sh'"
    [ "$status" -eq 0 ]
    [ "$(sidecar_call_count)" -ge 1 ]
}

@test "Layer 1: only MAIN_AGENT_ID set (AGENT_ID absent) falls through to sidecar" {
    local env_dir="${HOME}/.claude/session-env/${BATS_SESSION_ID}"
    mkdir -p "$env_dir"
    cat > "${env_dir}/vitest-agent-hook.sh" <<'EOF'
export VITEST_AGENT_MAIN_AGENT_ID="uuid-only-main"
EOF
    local payload
    payload=$(bash_payload "vitest run" "${BATS_SESSION_ID}")
    run env -u VITEST_AGENT_AGENT_ID -u VITEST_AGENT_MAIN_AGENT_ID \
        bash -c "echo '${payload}' | bash '${HOOKS_DIR}/pre-tool-use/bash.sh'"
    [ "$status" -eq 0 ]
    [ "$(sidecar_call_count)" -ge 1 ]
}

@test "Layer 1: both vars unset (no session-env file) falls through to sidecar" {
    # No env file written — both vars remain unset inside the subprocess.
    local payload
    payload=$(bash_payload "vitest run" "${BATS_SESSION_ID}")
    run env -u VITEST_AGENT_AGENT_ID -u VITEST_AGENT_MAIN_AGENT_ID \
        bash -c "echo '${payload}' | bash '${HOOKS_DIR}/pre-tool-use/bash.sh'"
    [ "$status" -eq 0 ]
    [ "$(sidecar_call_count)" -ge 1 ]
}
