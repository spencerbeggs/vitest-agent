#!/usr/bin/env bats
# cli-rename-cascade.bats — verify that every hook script that shells out to
# the vitest-agent CLI uses the new `agent` subcommand namespace introduced in
# T8, rather than the pre-T8 `_internal` / bare `record` / bare `triage` /
# bare `wrapup` forms.
#
# Strategy:
#   1. Create a temp bin dir with a fake `pnpm` that strips the `exec`
#      sub-command and delegates to `vitest-agent` (which is also stubbed).
#   2. The fake `vitest-agent` stub echoes its full argv to a capture file
#      so each test can assert the exact subcommand path.
#   3. Prepend the temp bin dir to PATH so both the hook's `detect_pm_exec`
#      and subsequent shell calls use the fakes.
#
# The stub intercepts the call at the right layer because:
#   - detect_pm_exec() returns "pnpm exec" for this repo (pnpm-lock.yaml)
#   - hooks call: $pm_exec vitest-agent agent <sub> ...
#                 = pnpm exec vitest-agent agent <sub> ...
#   - our fake pnpm strips "exec" and runs: vitest-agent agent <sub> ...
#   - our fake vitest-agent writes $* to BATS_ARGV_CAPTURE

HOOKS_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
FIXTURES_DIR="${HOOKS_DIR}/fixtures"

setup() {
    # Create a temp directory for the stubs and capture file.
    BATS_TMPDIR="$(mktemp -d)"
    BATS_ARGV_CAPTURE="${BATS_TMPDIR}/vitest-agent-argv"

    # Write the fake vitest-agent stub.
    cat > "${BATS_TMPDIR}/vitest-agent" <<'STUB'
#!/bin/bash
# Fake vitest-agent: capture argv and succeed silently.
echo "$*" >> "$BATS_ARGV_CAPTURE"
exit 0
STUB
    chmod +x "${BATS_TMPDIR}/vitest-agent"

    # Write the fake pnpm stub. It must handle:
    #   pnpm exec vitest-agent ...   -> vitest-agent ...
    #   pnpm exec which vitest-agent -> echo the stub path (for detect_pm_exec)
    # All other pnpm invocations are no-ops.
    cat > "${BATS_TMPDIR}/pnpm" <<'STUB'
#!/bin/bash
# Fake pnpm: strips "exec" and delegates.
case "$1" in
    exec)
        shift
        exec "$@"
        ;;
    *)
        exit 0
        ;;
esac
STUB
    chmod +x "${BATS_TMPDIR}/pnpm"

    # Export the capture path so the stub can write to it.
    export BATS_ARGV_CAPTURE

    # Prepend our stubs to PATH.
    export PATH="${BATS_TMPDIR}:${PATH}"
}

teardown() {
    rm -rf "${BATS_TMPDIR}"
}

# Helper: read the first captured argv line.
first_argv() {
    head -n1 "${BATS_ARGV_CAPTURE}" 2>/dev/null || echo ""
}

# Helper: read the Nth captured argv line (1-based).
nth_argv() {
    sed -n "${1}p" "${BATS_ARGV_CAPTURE}" 2>/dev/null || echo ""
}

# Helper: count how many times vitest-agent was called.
call_count() {
    wc -l < "${BATS_ARGV_CAPTURE}" 2>/dev/null | tr -d ' '
}

# ---------------------------------------------------------------------------
# pre-tool-use/record.sh
# ---------------------------------------------------------------------------

@test "pre-tool-use/record.sh calls 'agent record turn'" {
    run bash -c "cat '${FIXTURES_DIR}/pre-tool-use-record.json' | \
        bash '${HOOKS_DIR}/pre-tool-use/record.sh'"
    [ "$status" -eq 0 ]
    local argv
    argv=$(first_argv)
    [[ "$argv" == agent\ record\ turn* ]]
}

# ---------------------------------------------------------------------------
# pre-tool-use/bash.sh
# ---------------------------------------------------------------------------

@test "pre-tool-use/bash.sh calls 'agent inject-env'" {
    # Strip ambient VITEST_AGENT_AGENT_ID / VITEST_AGENT_MAIN_AGENT_ID so
    # Layer 1 (main-agent identity skip, added in T9.2) does not fire and
    # suppress the sidecar call before it happens.
    run env -u VITEST_AGENT_AGENT_ID -u VITEST_AGENT_MAIN_AGENT_ID \
        bash -c "cat '${FIXTURES_DIR}/pre-tool-use-bash.json' | \
        bash '${HOOKS_DIR}/pre-tool-use/bash.sh'"
    [ "$status" -eq 0 ]
    local argv
    argv=$(first_argv)
    # inject-env should be called; if no VITEST_AGENT_* env, rewrite is
    # identity (no-op output) but the CLI is still invoked.
    [[ "$argv" == agent\ inject-env* ]]
}

# ---------------------------------------------------------------------------
# pre-compact/record.sh
# ---------------------------------------------------------------------------

@test "pre-compact/record.sh calls 'agent record turn' then 'agent wrapup'" {
    run bash -c "cat '${FIXTURES_DIR}/pre-compact.json' | \
        bash '${HOOKS_DIR}/pre-compact/record.sh'"
    [ "$status" -eq 0 ]
    local first second
    first=$(nth_argv 1)
    second=$(nth_argv 2)
    [[ "$first" == agent\ record\ turn* ]]
    [[ "$second" == agent\ wrapup* ]]
}

@test "pre-compact/record.sh does not call bare 'record turn' or bare 'wrapup'" {
    run bash -c "cat '${FIXTURES_DIR}/pre-compact.json' | \
        bash '${HOOKS_DIR}/pre-compact/record.sh'"
    [ "$status" -eq 0 ]
    # No line should start with just "record" or "wrapup" (without "agent" prefix).
    if [ -f "${BATS_ARGV_CAPTURE}" ]; then
        run grep -E '^(record|wrapup|triage|_internal)' "${BATS_ARGV_CAPTURE}"
        [ "$status" -ne 0 ]
    fi
}

# ---------------------------------------------------------------------------
# user-prompt-submit/record.sh
# ---------------------------------------------------------------------------

@test "user-prompt-submit/record.sh calls 'agent record turn'" {
    run bash -c "cat '${FIXTURES_DIR}/user-prompt-submit.json' | \
        bash '${HOOKS_DIR}/user-prompt-submit/record.sh'"
    [ "$status" -eq 0 ]
    local first
    first=$(nth_argv 1)
    [[ "$first" == agent\ record\ turn* ]]
}

@test "user-prompt-submit/record.sh calls 'agent wrapup'" {
    run bash -c "cat '${FIXTURES_DIR}/user-prompt-submit.json' | \
        bash '${HOOKS_DIR}/user-prompt-submit/record.sh'"
    [ "$status" -eq 0 ]
    local second
    second=$(nth_argv 2)
    [[ "$second" == agent\ wrapup* ]]
}

# ---------------------------------------------------------------------------
# stop/record.sh
# ---------------------------------------------------------------------------

@test "stop/record.sh calls 'agent record turn' then 'agent wrapup'" {
    run bash -c "cat '${FIXTURES_DIR}/stop.json' | \
        bash '${HOOKS_DIR}/stop/record.sh'"
    [ "$status" -eq 0 ]
    local first second
    first=$(nth_argv 1)
    second=$(nth_argv 2)
    [[ "$first" == agent\ record\ turn* ]]
    [[ "$second" == agent\ wrapup* ]]
}

# ---------------------------------------------------------------------------
# post-tool-use/test-quality.sh
# (only fires for tdd-task agent + Edit/Write to test files)
# ---------------------------------------------------------------------------

@test "post-tool-use/test-quality.sh calls 'agent record tdd-artifact' on weakened test" {
    # Build a fixture with a weakened test pattern.
    local fixture
    fixture=$(jq -n '{
        session_id: "test-session-id-bats-001",
        agent_type: "vitest-agent:tdd-task",
        cwd: "/Users/spencer/workspaces/spencerbeggs/vitest-agent",
        tool_name: "Write",
        tool_use_id: "toolu_bats_weakened_001",
        tool_input: {
            file_path: "/tmp/example.test.ts",
            content: "it.skip(\"skipped test\", () => { expect(1).toBe(1); });"
        },
        tool_response: { success: true }
    }')
    run bash -c "echo '${fixture}' | bash '${HOOKS_DIR}/post-tool-use/test-quality.sh'"
    [ "$status" -eq 0 ]
    local argv
    argv=$(first_argv)
    [[ "$argv" == agent\ record\ tdd-artifact* ]]
}

# ---------------------------------------------------------------------------
# post-tool-use/record.sh
# ---------------------------------------------------------------------------

@test "post-tool-use/record.sh calls 'agent record turn' for tool_result" {
    run bash -c "cat '${FIXTURES_DIR}/post-tool-use-record-write.json' | \
        bash '${HOOKS_DIR}/post-tool-use/record.sh'"
    [ "$status" -eq 0 ]
    # First call is tool_result turn; second is file_edit turn.
    local first
    first=$(nth_argv 1)
    [[ "$first" == agent\ record\ turn* ]]
}

@test "post-tool-use/record.sh calls 'agent record turn' for file_edit" {
    run bash -c "cat '${FIXTURES_DIR}/post-tool-use-record-write.json' | \
        bash '${HOOKS_DIR}/post-tool-use/record.sh'"
    [ "$status" -eq 0 ]
    local cnt
    cnt=$(call_count)
    # Both tool_result and file_edit turns should be recorded.
    [ "$cnt" -ge 2 ]
    local second
    second=$(nth_argv 2)
    [[ "$second" == agent\ record\ turn* ]]
}

# ---------------------------------------------------------------------------
# post-tool-use/tdd-artifact.sh (Bash/run_tests path)
# ---------------------------------------------------------------------------

@test "post-tool-use/tdd-artifact.sh calls 'agent record test-case-turns' on vitest run" {
    run bash -c "cat '${FIXTURES_DIR}/post-tool-use-run-tests-pass.json' | \
        bash '${HOOKS_DIR}/post-tool-use/tdd-artifact.sh'"
    [ "$status" -eq 0 ]
    # Should call record test-case-turns then record tdd-artifact.
    local argv
    argv=$(grep 'agent record test-case-turns' "${BATS_ARGV_CAPTURE}" 2>/dev/null | head -n1 || echo "")
    [[ "$argv" == agent\ record\ test-case-turns* ]]
}

@test "post-tool-use/tdd-artifact.sh calls 'agent record tdd-artifact' on vitest run" {
    run bash -c "cat '${FIXTURES_DIR}/post-tool-use-run-tests-pass.json' | \
        bash '${HOOKS_DIR}/post-tool-use/tdd-artifact.sh'"
    [ "$status" -eq 0 ]
    local argv
    argv=$(grep 'agent record tdd-artifact' "${BATS_ARGV_CAPTURE}" 2>/dev/null | head -n1 || echo "")
    [[ "$argv" == agent\ record\ tdd-artifact* ]]
}

@test "post-tool-use/tdd-artifact.sh calls 'agent record tdd-artifact' on Write to test file" {
    run bash -c "cat '${FIXTURES_DIR}/post-tool-use-write-test.json' | \
        bash '${HOOKS_DIR}/post-tool-use/tdd-artifact.sh'"
    [ "$status" -eq 0 ]
    local argv
    argv=$(first_argv)
    [[ "$argv" == agent\ record\ tdd-artifact* ]]
}

@test "post-tool-use/tdd-artifact.sh calls 'agent record tdd-artifact' on Edit to prod file" {
    run bash -c "cat '${FIXTURES_DIR}/post-tool-use-edit-prod.json' | \
        bash '${HOOKS_DIR}/post-tool-use/tdd-artifact.sh'"
    [ "$status" -eq 0 ]
    local argv
    argv=$(first_argv)
    [[ "$argv" == agent\ record\ tdd-artifact* ]]
}

# ---------------------------------------------------------------------------
# post-tool-use/test-run.sh (Bash vitest invocation)
# ---------------------------------------------------------------------------

@test "post-tool-use/test-run.sh calls 'agent record run-trigger'" {
    run bash -c "cat '${FIXTURES_DIR}/post-tool-use-bash-vitest.json' | \
        bash '${HOOKS_DIR}/post-tool-use/test-run.sh'"
    [ "$status" -eq 0 ]
    local argv
    argv=$(grep 'agent record run-trigger' "${BATS_ARGV_CAPTURE}" 2>/dev/null | head -n1 || echo "")
    [[ "$argv" == agent\ record\ run-trigger* ]]
}

@test "post-tool-use/test-run.sh calls 'agent record test-case-turns'" {
    run bash -c "cat '${FIXTURES_DIR}/post-tool-use-bash-vitest.json' | \
        bash '${HOOKS_DIR}/post-tool-use/test-run.sh'"
    [ "$status" -eq 0 ]
    local argv
    argv=$(grep 'agent record test-case-turns' "${BATS_ARGV_CAPTURE}" 2>/dev/null | head -n1 || echo "")
    [[ "$argv" == agent\ record\ test-case-turns* ]]
}

# ---------------------------------------------------------------------------
# post-tool-use/git-commit.sh
# ---------------------------------------------------------------------------

@test "post-tool-use/git-commit.sh calls 'agent record run-workspace-changes' after git commit" {
    # The fixture must have a real git repo in cwd; use the repo root.
    run bash -c "cat '${FIXTURES_DIR}/post-tool-use-bash-git-commit.json' | \
        bash '${HOOKS_DIR}/post-tool-use/git-commit.sh'"
    [ "$status" -eq 0 ]
    # If git has commits, vitest-agent should be called. If not (empty repo),
    # the script bails at the sha check. Assert no OLD form appears in argv.
    if [ -f "${BATS_ARGV_CAPTURE}" ]; then
        run grep -E '^(record|_internal)' "${BATS_ARGV_CAPTURE}"
        [ "$status" -ne 0 ]
    fi
    # If the call did happen, it must use the agent prefix.
    if [ -f "${BATS_ARGV_CAPTURE}" ] && [ -s "${BATS_ARGV_CAPTURE}" ]; then
        local argv
        argv=$(first_argv)
        [[ "$argv" == agent\ record\ run-workspace-changes* ]]
    fi
}

# ---------------------------------------------------------------------------
# subagent/start-tdd.sh
# ---------------------------------------------------------------------------

@test "subagent/start-tdd.sh calls 'agent record session-start'" {
    run bash -c "cat '${FIXTURES_DIR}/subagent-start-tdd.json' | \
        bash '${HOOKS_DIR}/subagent/start-tdd.sh'"
    [ "$status" -eq 0 ]
    local argv
    argv=$(grep 'agent record session-start' "${BATS_ARGV_CAPTURE}" 2>/dev/null | head -n1 || echo "")
    [[ "$argv" == agent\ record\ session-start* ]]
}

@test "subagent/start-tdd.sh calls 'agent register-agent'" {
    # register-agent is only called when VITEST_AGENT_MAIN_AGENT_ID is set
    # (sourced from session-env). Verify that when it IS called it uses the
    # new form by setting a fake env.
    local env_dir="${HOME}/.claude/session-env/test-session-id-bats-001"
    mkdir -p "$env_dir"
    local hook_env="${env_dir}/vitest-agent-hook.sh"
    echo "export VITEST_AGENT_MAIN_AGENT_ID=fake-main-agent-uuid-001" > "$hook_env"

    run bash -c "cat '${FIXTURES_DIR}/subagent-start-tdd.json' | \
        bash '${HOOKS_DIR}/subagent/start-tdd.sh'"
    [ "$status" -eq 0 ]

    rm -f "$hook_env"
    rmdir "$env_dir" 2>/dev/null || true

    local argv
    argv=$(grep 'agent register-agent' "${BATS_ARGV_CAPTURE}" 2>/dev/null | head -n1 || echo "")
    [[ "$argv" == agent\ register-agent* ]]
}

@test "subagent/start-tdd.sh does not call '_internal register-agent'" {
    local env_dir="${HOME}/.claude/session-env/test-session-id-bats-001"
    mkdir -p "$env_dir"
    local hook_env="${env_dir}/vitest-agent-hook.sh"
    echo "export VITEST_AGENT_MAIN_AGENT_ID=fake-main-agent-uuid-001" > "$hook_env"

    run bash -c "cat '${FIXTURES_DIR}/subagent-start-tdd.json' | \
        bash '${HOOKS_DIR}/subagent/start-tdd.sh'"
    [ "$status" -eq 0 ]

    rm -f "$hook_env"
    rmdir "$env_dir" 2>/dev/null || true

    if [ -f "${BATS_ARGV_CAPTURE}" ]; then
        run grep '_internal' "${BATS_ARGV_CAPTURE}"
        [ "$status" -ne 0 ]
    fi
}

# ---------------------------------------------------------------------------
# subagent/stop-tdd.sh
# ---------------------------------------------------------------------------

@test "subagent/stop-tdd.sh calls 'agent wrapup'" {
    run bash -c "cat '${FIXTURES_DIR}/subagent-stop-tdd.json' | \
        bash '${HOOKS_DIR}/subagent/stop-tdd.sh'"
    [ "$status" -eq 0 ]
    local argv
    argv=$(grep 'agent wrapup' "${BATS_ARGV_CAPTURE}" 2>/dev/null | head -n1 || echo "")
    [[ "$argv" == agent\ wrapup* ]]
}

@test "subagent/stop-tdd.sh calls 'agent record turn' for handoff note" {
    # record turn is only called when wrapup returns non-empty AND
    # parent_session_id is set. Set up the fake to return a non-empty string.
    # The fake vitest-agent always succeeds with no output by default, so
    # wrapup will return empty and the record turn will be skipped.
    # Override: make vitest-agent print something when called for wrapup.
    cat > "${BATS_TMPDIR}/vitest-agent" <<'STUB'
#!/bin/bash
# Capture argv.
echo "$*" >> "$BATS_ARGV_CAPTURE"
# If this is a wrapup call, emit non-empty output so the hook records a note.
case "$*" in
    *wrapup*) echo "## TDD Handoff\nSome handoff content." ;;
esac
exit 0
STUB
    chmod +x "${BATS_TMPDIR}/vitest-agent"

    run bash -c "cat '${FIXTURES_DIR}/subagent-stop-tdd.json' | \
        bash '${HOOKS_DIR}/subagent/stop-tdd.sh'"
    [ "$status" -eq 0 ]
    local turn_call
    turn_call=$(grep 'agent record turn' "${BATS_ARGV_CAPTURE}" 2>/dev/null | head -n1 || echo "")
    [[ "$turn_call" == agent\ record\ turn* ]]
}

# ---------------------------------------------------------------------------
# session/start.sh
# ---------------------------------------------------------------------------

@test "session/start.sh calls 'agent triage'" {
    run bash -c "cat '${FIXTURES_DIR}/session-start.json' | \
        bash '${HOOKS_DIR}/session/start.sh'"
    [ "$status" -eq 0 ]
    local argv
    argv=$(grep 'agent triage' "${BATS_ARGV_CAPTURE}" 2>/dev/null | head -n1 || echo "")
    [[ "$argv" == agent\ triage* ]]
}

@test "session/start.sh calls 'agent record session-start'" {
    run bash -c "cat '${FIXTURES_DIR}/session-start.json' | \
        bash '${HOOKS_DIR}/session/start.sh'"
    [ "$status" -eq 0 ]
    local argv
    argv=$(grep 'agent record session-start' "${BATS_ARGV_CAPTURE}" 2>/dev/null | head -n1 || echo "")
    [[ "$argv" == agent\ record\ session-start* ]]
}

@test "session/start.sh calls 'agent register-agent'" {
    run bash -c "cat '${FIXTURES_DIR}/session-start.json' | \
        bash '${HOOKS_DIR}/session/start.sh'"
    [ "$status" -eq 0 ]
    local argv
    argv=$(grep 'agent register-agent' "${BATS_ARGV_CAPTURE}" 2>/dev/null | head -n1 || echo "")
    [[ "$argv" == agent\ register-agent* ]]
}

@test "session/start.sh does not call 'triage' without 'agent' prefix" {
    run bash -c "cat '${FIXTURES_DIR}/session-start.json' | \
        bash '${HOOKS_DIR}/session/start.sh'"
    [ "$status" -eq 0 ]
    if [ -f "${BATS_ARGV_CAPTURE}" ]; then
        run grep -E '^triage' "${BATS_ARGV_CAPTURE}"
        [ "$status" -ne 0 ]
    fi
}

@test "session/start.sh does not call '_internal register-agent'" {
    run bash -c "cat '${FIXTURES_DIR}/session-start.json' | \
        bash '${HOOKS_DIR}/session/start.sh'"
    [ "$status" -eq 0 ]
    if [ -f "${BATS_ARGV_CAPTURE}" ]; then
        run grep '_internal' "${BATS_ARGV_CAPTURE}"
        [ "$status" -ne 0 ]
    fi
}

# ---------------------------------------------------------------------------
# session/end-record.sh
# ---------------------------------------------------------------------------

@test "session/end-record.sh calls 'agent record turn'" {
    run bash -c "cat '${FIXTURES_DIR}/session-end.json' | \
        bash '${HOOKS_DIR}/session/end-record.sh'"
    [ "$status" -eq 0 ]
    local argv
    argv=$(grep 'agent record turn' "${BATS_ARGV_CAPTURE}" 2>/dev/null | head -n1 || echo "")
    [[ "$argv" == agent\ record\ turn* ]]
}

@test "session/end-record.sh calls 'agent record session-end'" {
    run bash -c "cat '${FIXTURES_DIR}/session-end.json' | \
        bash '${HOOKS_DIR}/session/end-record.sh'"
    [ "$status" -eq 0 ]
    local argv
    argv=$(grep 'agent record session-end' "${BATS_ARGV_CAPTURE}" 2>/dev/null | head -n1 || echo "")
    [[ "$argv" == agent\ record\ session-end* ]]
}

@test "session/end-record.sh calls 'agent end-agent' when VITEST_AGENT_MAIN_AGENT_ID is set" {
    local env_dir="${HOME}/.claude/session-env/test-session-id-bats-001"
    mkdir -p "$env_dir"
    local hook_env="${env_dir}/vitest-agent-hook.sh"
    echo "export VITEST_AGENT_MAIN_AGENT_ID=fake-main-agent-uuid-001" > "$hook_env"

    run bash -c "cat '${FIXTURES_DIR}/session-end.json' | \
        bash '${HOOKS_DIR}/session/end-record.sh'"
    [ "$status" -eq 0 ]

    rm -f "$hook_env"
    rmdir "$env_dir" 2>/dev/null || true

    local argv
    argv=$(grep 'agent end-agent' "${BATS_ARGV_CAPTURE}" 2>/dev/null | head -n1 || echo "")
    [[ "$argv" == agent\ end-agent* ]]
}

@test "session/end-record.sh calls 'agent wrapup'" {
    run bash -c "cat '${FIXTURES_DIR}/session-end.json' | \
        bash '${HOOKS_DIR}/session/end-record.sh'"
    [ "$status" -eq 0 ]
    local argv
    argv=$(grep 'agent wrapup' "${BATS_ARGV_CAPTURE}" 2>/dev/null | head -n1 || echo "")
    [[ "$argv" == agent\ wrapup* ]]
}

@test "session/end-record.sh does not call '_internal end-agent'" {
    local env_dir="${HOME}/.claude/session-env/test-session-id-bats-001"
    mkdir -p "$env_dir"
    local hook_env="${env_dir}/vitest-agent-hook.sh"
    echo "export VITEST_AGENT_MAIN_AGENT_ID=fake-main-agent-uuid-001" > "$hook_env"

    run bash -c "cat '${FIXTURES_DIR}/session-end.json' | \
        bash '${HOOKS_DIR}/session/end-record.sh'"
    [ "$status" -eq 0 ]

    rm -f "$hook_env"
    rmdir "$env_dir" 2>/dev/null || true

    if [ -f "${BATS_ARGV_CAPTURE}" ]; then
        run grep '_internal' "${BATS_ARGV_CAPTURE}"
        [ "$status" -ne 0 ]
    fi
}
