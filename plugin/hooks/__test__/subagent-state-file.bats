#!/usr/bin/env bats
# subagent-state-file.bats — Phase B (9.4) tests for the active-subagents
# state-file lifecycle.
#
# Tests (per spec §5 Phase B specific):
#   1. start-tdd.sh writes the JSON file with the correct fields.
#   2. stop-tdd.sh finds the right file by agent_type, calls end-agent with
#      the right agentId, removes the file.
#   3. end-record.sh removes the active-subagents/ dir for the closing chat_id.
#   4. Concurrent same-type pairing: two start files, same agent_type, different
#      mtimes, two consecutive stops drain oldest-first.
#
# Stub strategy: same pnpm/vitest-agent fake pattern as cli-rename-cascade.bats.
# The fake vitest-agent echoes argv to BATS_ARGV_CAPTURE and, when register-agent
# is called, emits a JSON payload with a predictable agentId so start-tdd.sh can
# extract and write it into the state file.

HOOKS_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
FIXTURES_DIR="${HOOKS_DIR}/fixtures"

# Shared chat_id used across tests. Must be a valid session-id shape
# (no slashes, no .., no whitespace) so source-session-env.sh won't reject it.
BATS_CHAT_ID="bats-phase-b-session-001"
BATS_MAIN_AGENT_ID="bats-main-agent-uuid-phase-b"

setup() {
    BATS_TMPDIR="$(mktemp -d)"
    BATS_ARGV_CAPTURE="${BATS_TMPDIR}/vitest-agent-argv"
    export BATS_ARGV_CAPTURE

    # --- fake vitest-agent ---
    # Handles two call patterns:
    #   agent register-agent ...  -> emits JSON with a predictable agentId
    #   anything else             -> captures argv, exits 0
    cat > "${BATS_TMPDIR}/vitest-agent" <<'STUB'
#!/bin/bash
echo "$*" >> "$BATS_ARGV_CAPTURE"
case "$*" in
    "agent register-agent"*)
        # Return a predictable agentId so start-tdd.sh can write it into
        # the state file. Include all fields the hook inspects.
        printf '{"agentId":"bats-subagent-agent-uuid-001","conversationId":"bats-conv-001","mainAgentId":"bats-main-agent-uuid-phase-b","idempotencyKey":"bats-key","idempotencyHit":false}\n'
        ;;
    "agent wrapup"*)
        # Return empty so stop-tdd.sh skips the note-recording branch.
        printf ''
        ;;
esac
exit 0
STUB
    chmod +x "${BATS_TMPDIR}/vitest-agent"

    # --- fake pnpm ---
    cat > "${BATS_TMPDIR}/pnpm" <<'STUB'
#!/bin/bash
case "$1" in
    exec) shift; exec "$@" ;;
    *)    exit 0 ;;
esac
STUB
    chmod +x "${BATS_TMPDIR}/pnpm"

    export PATH="${BATS_TMPDIR}:${PATH}"

    # Set up the session-env dir so source-session-env.sh finds VITEST_AGENT_MAIN_AGENT_ID.
    SESSION_ENV_DIR="${HOME}/.claude/session-env/${BATS_CHAT_ID}"
    mkdir -p "${SESSION_ENV_DIR}"
    cat > "${SESSION_ENV_DIR}/vitest-agent-hook.sh" <<EOF
export VITEST_AGENT_MAIN_AGENT_ID="${BATS_MAIN_AGENT_ID}"
export VITEST_AGENT_CHAT_ID="${BATS_CHAT_ID}"
export VITEST_AGENT_PROJECT_DIR="${FIXTURES_DIR}"
EOF

    # Ensure the active-subagents dir starts clean for each test.
    rm -rf "${SESSION_ENV_DIR}/active-subagents"
}

teardown() {
    # Clean up the session-env fragments we wrote.
    SESSION_ENV_DIR="${HOME}/.claude/session-env/${BATS_CHAT_ID}"
    rm -f "${SESSION_ENV_DIR}/vitest-agent-hook.sh"
    rm -rf "${SESSION_ENV_DIR}/active-subagents"
    rmdir "${SESSION_ENV_DIR}" 2>/dev/null || true

    rm -rf "${BATS_TMPDIR}"
}

# ---------------------------------------------------------------------------
# Helper: build a SubagentStart fixture with a given session_id and cwd.
# ---------------------------------------------------------------------------
subagent_start_fixture() {
    local session_id="${1:-${BATS_CHAT_ID}}"
    local cwd="${2:-/Users/spencer/workspaces/spencerbeggs/vitest-agent}"
    jq -n \
        --arg sid "$session_id" \
        --arg cwd "$cwd" \
        '{
            session_id: $sid,
            agent_type: "vitest-agent:tdd-task",
            cwd: $cwd,
            transcript_path: "/tmp/bats-subagent-transcript.jsonl",
            hook_event_name: "SubagentStart"
        }'
}

# ---------------------------------------------------------------------------
# Helper: build a SubagentStop fixture.
# ---------------------------------------------------------------------------
subagent_stop_fixture() {
    local session_id="${1:-${BATS_CHAT_ID}}"
    local cwd="${2:-/Users/spencer/workspaces/spencerbeggs/vitest-agent}"
    jq -n \
        --arg sid "$session_id" \
        --arg cwd "$cwd" \
        '{
            session_id: $sid,
            agent_type: "vitest-agent:tdd-task",
            parent_session_id: "bats-parent-session-id",
            cwd: $cwd,
            hook_event_name: "SubagentStop"
        }'
}

# ---------------------------------------------------------------------------
# Helper: build a SessionEnd fixture.
# ---------------------------------------------------------------------------
session_end_fixture() {
    local session_id="${1:-${BATS_CHAT_ID}}"
    local cwd="${2:-/Users/spencer/workspaces/spencerbeggs/vitest-agent}"
    local reason="${3:-user_ended}"
    jq -n \
        --arg sid "$session_id" \
        --arg cwd "$cwd" \
        --arg reason "$reason" \
        '{
            session_id: $sid,
            cwd: $cwd,
            reason: $reason,
            hook_event_name: "SessionEnd"
        }'
}

# ---------------------------------------------------------------------------
# Test 1 — start-tdd.sh writes a state file with correct fields
# ---------------------------------------------------------------------------

@test "start-tdd.sh writes active-subagents state file with correct fields" {
    local fixture
    fixture=$(subagent_start_fixture "$BATS_CHAT_ID")
    run bash -c "echo '${fixture}' | bash '${HOOKS_DIR}/subagent/start-tdd.sh'"
    [ "$status" -eq 0 ]

    local state_dir="${HOME}/.claude/session-env/${BATS_CHAT_ID}/active-subagents"
    # At least one .json file must exist.
    local file_count
    file_count=$(find "$state_dir" -name '*.json' 2>/dev/null | wc -l | tr -d ' ')
    [ "$file_count" -ge 1 ]
}

@test "start-tdd.sh state file contains agentId field" {
    local fixture
    fixture=$(subagent_start_fixture "$BATS_CHAT_ID")
    run bash -c "echo '${fixture}' | bash '${HOOKS_DIR}/subagent/start-tdd.sh'"
    [ "$status" -eq 0 ]

    local state_dir="${HOME}/.claude/session-env/${BATS_CHAT_ID}/active-subagents"
    local state_file
    state_file=$(find "$state_dir" -name '*.json' 2>/dev/null | head -1)
    [ -f "$state_file" ]

    local agent_id
    agent_id=$(jq -r '.agentId // empty' < "$state_file")
    [ -n "$agent_id" ]
    [ "$agent_id" = "bats-subagent-agent-uuid-001" ]
}

@test "start-tdd.sh state file contains agentType field" {
    local fixture
    fixture=$(subagent_start_fixture "$BATS_CHAT_ID")
    run bash -c "echo '${fixture}' | bash '${HOOKS_DIR}/subagent/start-tdd.sh'"
    [ "$status" -eq 0 ]

    local state_dir="${HOME}/.claude/session-env/${BATS_CHAT_ID}/active-subagents"
    local state_file
    state_file=$(find "$state_dir" -name '*.json' 2>/dev/null | head -1)
    [ -f "$state_file" ]

    local agent_type
    agent_type=$(jq -r '.agentType // empty' < "$state_file")
    # spec: file contains "claude-code-tdd-task" (the value passed to register-agent)
    [ -n "$agent_type" ]
}

@test "start-tdd.sh state file contains syntheticKey field" {
    local fixture
    fixture=$(subagent_start_fixture "$BATS_CHAT_ID")
    run bash -c "echo '${fixture}' | bash '${HOOKS_DIR}/subagent/start-tdd.sh'"
    [ "$status" -eq 0 ]

    local state_dir="${HOME}/.claude/session-env/${BATS_CHAT_ID}/active-subagents"
    local state_file
    state_file=$(find "$state_dir" -name '*.json' 2>/dev/null | head -1)
    [ -f "$state_file" ]

    local synthetic_key
    synthetic_key=$(jq -r '.syntheticKey // empty' < "$state_file")
    [ -n "$synthetic_key" ]
    # syntheticKey must start with the chat_id prefix
    [[ "$synthetic_key" == "${BATS_CHAT_ID}-subagent-"* ]]
}

@test "start-tdd.sh state file contains startedAt field" {
    local fixture
    fixture=$(subagent_start_fixture "$BATS_CHAT_ID")
    run bash -c "echo '${fixture}' | bash '${HOOKS_DIR}/subagent/start-tdd.sh'"
    [ "$status" -eq 0 ]

    local state_dir="${HOME}/.claude/session-env/${BATS_CHAT_ID}/active-subagents"
    local state_file
    state_file=$(find "$state_dir" -name '*.json' 2>/dev/null | head -1)
    [ -f "$state_file" ]

    local started_at
    started_at=$(jq -r '.startedAt // empty' < "$state_file")
    [ -n "$started_at" ]
}

@test "start-tdd.sh state file name is the synthetic key tail (prefix stripped)" {
    local fixture
    fixture=$(subagent_start_fixture "$BATS_CHAT_ID")
    run bash -c "echo '${fixture}' | bash '${HOOKS_DIR}/subagent/start-tdd.sh'"
    [ "$status" -eq 0 ]

    local state_dir="${HOME}/.claude/session-env/${BATS_CHAT_ID}/active-subagents"
    local state_file
    state_file=$(find "$state_dir" -name '*.json' 2>/dev/null | head -1)
    [ -f "$state_file" ]

    # The filename must NOT include the "${BATS_CHAT_ID}-subagent-" prefix.
    local basename
    basename=$(basename "$state_file" .json)
    # Must be just <ts>-<pid> form — does not start with the chat_id.
    [[ "$basename" != "${BATS_CHAT_ID}"* ]]
    # Must match the <digits>-<digits> shape (timestamp-pid).
    [[ "$basename" =~ ^[0-9]+-[0-9]+$ ]]
}

@test "start-tdd.sh state file is valid JSON" {
    local fixture
    fixture=$(subagent_start_fixture "$BATS_CHAT_ID")
    run bash -c "echo '${fixture}' | bash '${HOOKS_DIR}/subagent/start-tdd.sh'"
    [ "$status" -eq 0 ]

    local state_dir="${HOME}/.claude/session-env/${BATS_CHAT_ID}/active-subagents"
    local state_file
    state_file=$(find "$state_dir" -name '*.json' 2>/dev/null | head -1)
    [ -f "$state_file" ]

    run jq empty < "$state_file"
    [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# Test 2 — stop-tdd.sh finds the file by agent_type, calls end-agent,
#           removes the file
# ---------------------------------------------------------------------------

@test "stop-tdd.sh calls 'agent end-agent' with the agentId from the state file" {
    # First run start to create the state file.
    local start_fixture
    start_fixture=$(subagent_start_fixture "$BATS_CHAT_ID")
    bash -c "echo '${start_fixture}' | bash '${HOOKS_DIR}/subagent/start-tdd.sh'" || true

    # Verify state file was created.
    local state_dir="${HOME}/.claude/session-env/${BATS_CHAT_ID}/active-subagents"
    local state_file
    state_file=$(find "$state_dir" -name '*.json' 2>/dev/null | head -1)
    [ -f "$state_file" ]

    # Clear the argv capture so we see only stop's calls.
    > "${BATS_ARGV_CAPTURE}"

    local stop_fixture
    stop_fixture=$(subagent_stop_fixture "$BATS_CHAT_ID")
    run bash -c "echo '${stop_fixture}' | bash '${HOOKS_DIR}/subagent/stop-tdd.sh'"
    [ "$status" -eq 0 ]

    # end-agent must appear in the captured argv.
    local end_agent_call
    end_agent_call=$(grep 'agent end-agent' "${BATS_ARGV_CAPTURE}" 2>/dev/null | head -1 || echo "")
    [[ "$end_agent_call" == "agent end-agent"* ]]
}

@test "stop-tdd.sh passes --agent-id with the correct agentId" {
    local start_fixture
    start_fixture=$(subagent_start_fixture "$BATS_CHAT_ID")
    bash -c "echo '${start_fixture}' | bash '${HOOKS_DIR}/subagent/start-tdd.sh'" || true

    > "${BATS_ARGV_CAPTURE}"

    local stop_fixture
    stop_fixture=$(subagent_stop_fixture "$BATS_CHAT_ID")
    run bash -c "echo '${stop_fixture}' | bash '${HOOKS_DIR}/subagent/stop-tdd.sh'"
    [ "$status" -eq 0 ]

    local end_agent_call
    end_agent_call=$(grep 'agent end-agent' "${BATS_ARGV_CAPTURE}" 2>/dev/null | head -1 || echo "")
    [[ "$end_agent_call" == *"--agent-id bats-subagent-agent-uuid-001"* ]]
}

@test "stop-tdd.sh end-agent call does NOT pass --host-session-id" {
    # Spec §9.4: subagent end-agent must NOT pass --host-session-id.
    local start_fixture
    start_fixture=$(subagent_start_fixture "$BATS_CHAT_ID")
    bash -c "echo '${start_fixture}' | bash '${HOOKS_DIR}/subagent/start-tdd.sh'" || true

    > "${BATS_ARGV_CAPTURE}"

    local stop_fixture
    stop_fixture=$(subagent_stop_fixture "$BATS_CHAT_ID")
    run bash -c "echo '${stop_fixture}' | bash '${HOOKS_DIR}/subagent/stop-tdd.sh'"
    [ "$status" -eq 0 ]

    local end_agent_call
    end_agent_call=$(grep 'agent end-agent' "${BATS_ARGV_CAPTURE}" 2>/dev/null | head -1 || echo "")
    [[ "$end_agent_call" != *"--host-session-id"* ]]
}

@test "stop-tdd.sh removes the state file after calling end-agent" {
    local start_fixture
    start_fixture=$(subagent_start_fixture "$BATS_CHAT_ID")
    bash -c "echo '${start_fixture}' | bash '${HOOKS_DIR}/subagent/start-tdd.sh'" || true

    local state_dir="${HOME}/.claude/session-env/${BATS_CHAT_ID}/active-subagents"
    local state_file
    state_file=$(find "$state_dir" -name '*.json' 2>/dev/null | head -1)
    [ -f "$state_file" ]

    local stop_fixture
    stop_fixture=$(subagent_stop_fixture "$BATS_CHAT_ID")
    run bash -c "echo '${stop_fixture}' | bash '${HOOKS_DIR}/subagent/stop-tdd.sh'"
    [ "$status" -eq 0 ]

    # The state file must no longer exist.
    [ ! -f "$state_file" ]
}

@test "stop-tdd.sh exits 0 and emits noop when no state file exists" {
    # No start run — no state file.
    local stop_fixture
    stop_fixture=$(subagent_stop_fixture "$BATS_CHAT_ID")
    run bash -c "echo '${stop_fixture}' | bash '${HOOKS_DIR}/subagent/stop-tdd.sh'"
    [ "$status" -eq 0 ]
    # Should not call end-agent.
    if [ -f "${BATS_ARGV_CAPTURE}" ]; then
        run grep 'agent end-agent' "${BATS_ARGV_CAPTURE}"
        [ "$status" -ne 0 ]
    fi
}

# ---------------------------------------------------------------------------
# Test 3 — end-record.sh removes the active-subagents dir
# ---------------------------------------------------------------------------

@test "end-record.sh removes the active-subagents dir for the closing chat_id" {
    # Create a fake active-subagents dir with a dummy file.
    local state_dir="${HOME}/.claude/session-env/${BATS_CHAT_ID}/active-subagents"
    mkdir -p "$state_dir"
    echo '{"agentId":"orphan","agentType":"claude-code-tdd-task","syntheticKey":"k","startedAt":"2026-05-01T00:00:00Z"}' \
        > "${state_dir}/99999-99999.json"
    [ -f "${state_dir}/99999-99999.json" ]

    # Use a continuation reason (clear) so the shim runs the worker
    # synchronously — on true exit reasons the janitorial cleanup is
    # detached and would race this assertion.
    local end_fixture
    end_fixture=$(session_end_fixture "$BATS_CHAT_ID" "" clear)
    run bash -c "echo '${end_fixture}' | bash '${HOOKS_DIR}/session/end-record.sh'"
    [ "$status" -eq 0 ]

    # The entire active-subagents dir must be gone.
    [ ! -d "$state_dir" ]
}

@test "end-record.sh succeeds even when active-subagents dir does not exist" {
    # No state dir — rm -rf should be a no-op (not an error).
    local state_dir="${HOME}/.claude/session-env/${BATS_CHAT_ID}/active-subagents"
    [ ! -d "$state_dir" ]

    # Continuation reason keeps the worker in the foreground (see above).
    local end_fixture
    end_fixture=$(session_end_fixture "$BATS_CHAT_ID" "" clear)
    run bash -c "echo '${end_fixture}' | bash '${HOOKS_DIR}/session/end-record.sh'"
    [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# Test 4 — concurrent same-type pairing: two starts, two stops, oldest-first
# ---------------------------------------------------------------------------

@test "concurrent pairing: two starts drain oldest state file first on first stop" {
    local state_dir="${HOME}/.claude/session-env/${BATS_CHAT_ID}/active-subagents"

    # Write two state files manually with explicit names to control mtime ordering.
    # File A is older (lower ts), File B is newer.
    # Use compact JSON (-c) so grep -rl "\"agentType\":\"...\"" matches without spaces.
    mkdir -p "$state_dir"

    local file_a="${state_dir}/1000000000-11111.json"
    local file_b="${state_dir}/2000000000-22222.json"

    jq -cn '{
        agentId: "agent-uuid-ALPHA",
        agentType: "vitest-agent:tdd-task",
        syntheticKey: "bats-phase-b-session-001-subagent-1000000000-11111",
        startedAt: "2026-05-01T10:00:00Z"
    }' > "$file_a"

    jq -cn '{
        agentId: "agent-uuid-BETA",
        agentType: "vitest-agent:tdd-task",
        syntheticKey: "bats-phase-b-session-001-subagent-2000000000-22222",
        startedAt: "2026-05-01T10:01:00Z"
    }' > "$file_b"

    # Force mtime ordering: A older than B.
    touch -t 202605010000 "$file_a"
    touch -t 202605010001 "$file_b"

    # First stop — should pair with file_a (oldest).
    > "${BATS_ARGV_CAPTURE}"
    local stop_fixture
    stop_fixture=$(subagent_stop_fixture "$BATS_CHAT_ID")
    run bash -c "echo '${stop_fixture}' | bash '${HOOKS_DIR}/subagent/stop-tdd.sh'"
    [ "$status" -eq 0 ]

    # end-agent must have been called with agent-uuid-ALPHA (the oldest).
    local first_end_call
    first_end_call=$(grep 'agent end-agent' "${BATS_ARGV_CAPTURE}" 2>/dev/null | head -1 || echo "")
    [[ "$first_end_call" == *"--agent-id agent-uuid-ALPHA"* ]]

    # file_a must be gone; file_b must still exist.
    [ ! -f "$file_a" ]
    [ -f "$file_b" ]
}

@test "concurrent pairing: second stop drains the remaining (newer) state file" {
    local state_dir="${HOME}/.claude/session-env/${BATS_CHAT_ID}/active-subagents"
    mkdir -p "$state_dir"

    local file_a="${state_dir}/1000000000-11111.json"
    local file_b="${state_dir}/2000000000-22222.json"

    jq -cn '{
        agentId: "agent-uuid-ALPHA",
        agentType: "vitest-agent:tdd-task",
        syntheticKey: "bats-phase-b-session-001-subagent-1000000000-11111",
        startedAt: "2026-05-01T10:00:00Z"
    }' > "$file_a"

    jq -cn '{
        agentId: "agent-uuid-BETA",
        agentType: "vitest-agent:tdd-task",
        syntheticKey: "bats-phase-b-session-001-subagent-2000000000-22222",
        startedAt: "2026-05-01T10:01:00Z"
    }' > "$file_b"

    touch -t 202605010000 "$file_a"
    touch -t 202605010001 "$file_b"

    local stop_fixture
    stop_fixture=$(subagent_stop_fixture "$BATS_CHAT_ID")

    # First stop drains file_a.
    bash -c "echo '${stop_fixture}' | bash '${HOOKS_DIR}/subagent/stop-tdd.sh'" || true
    [ ! -f "$file_a" ]
    [ -f "$file_b" ]

    # Second stop should drain file_b (agent-uuid-BETA).
    > "${BATS_ARGV_CAPTURE}"
    run bash -c "echo '${stop_fixture}' | bash '${HOOKS_DIR}/subagent/stop-tdd.sh'"
    [ "$status" -eq 0 ]

    local second_end_call
    second_end_call=$(grep 'agent end-agent' "${BATS_ARGV_CAPTURE}" 2>/dev/null | head -1 || echo "")
    [[ "$second_end_call" == *"--agent-id agent-uuid-BETA"* ]]

    [ ! -f "$file_b" ]
}

@test "concurrent pairing: after both stops no state files remain" {
    local state_dir="${HOME}/.claude/session-env/${BATS_CHAT_ID}/active-subagents"
    mkdir -p "$state_dir"

    local file_a="${state_dir}/1000000000-11111.json"
    local file_b="${state_dir}/2000000000-22222.json"

    jq -cn '{agentId:"agent-uuid-ALPHA",agentType:"vitest-agent:tdd-task",syntheticKey:"k1",startedAt:"2026-05-01T10:00:00Z"}' > "$file_a"
    jq -cn '{agentId:"agent-uuid-BETA",agentType:"vitest-agent:tdd-task",syntheticKey:"k2",startedAt:"2026-05-01T10:01:00Z"}' > "$file_b"
    touch -t 202605010000 "$file_a"
    touch -t 202605010001 "$file_b"

    local stop_fixture
    stop_fixture=$(subagent_stop_fixture "$BATS_CHAT_ID")

    bash -c "echo '${stop_fixture}' | bash '${HOOKS_DIR}/subagent/stop-tdd.sh'" || true
    bash -c "echo '${stop_fixture}' | bash '${HOOKS_DIR}/subagent/stop-tdd.sh'" || true

    # No .json files should remain.
    local remaining
    remaining=$(find "$state_dir" -name '*.json' 2>/dev/null | wc -l | tr -d ' ')
    [ "$remaining" -eq 0 ]
}
