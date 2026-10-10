#!/usr/bin/env bats
# subagent-state-file.bats — the active-subagents state-file lifecycle, on both
# targets.
#
#   1. start-tdd.sh writes the JSON file with the correct fields.
#   2. stop-tdd.sh finds the right file by agent_type, calls end-agent with the
#      right agentId, removes the file.
#   3. end-record.sh removes the active-subagents directory for the closing
#      chat_id.
#   4. Concurrent same-type pairing: two start files, same agent_type,
#      different mtimes, two consecutive stops drain oldest-first.
#
# The state lives in the plugin's data directory (va_state_dir: the host's
# plugin data dir, which va_hook pins to $BATS_TEST_TMPDIR/data), one
# subdirectory per chat_id: <data>/active-subagents/<chat_id>/<ts>-<pid>.json.

load common

CHAT_ID="bats-phase-b-session-001"
MAIN_AGENT_ID="bats-main-agent-uuid-phase-b"

setup() {
	va_stub_cli '"agent register-agent"*) printf '\''{"agentId":"bats-subagent-agent-uuid-001","conversationId":"bats-conv-001","mainAgentId":"bats-main-agent-uuid-phase-b","idempotencyKey":"bats-key","idempotencyHit":false}\n'\'' ;;'
	SEED=$(va_session_env "VITEST_AGENT_MAIN_AGENT_ID=$MAIN_AGENT_ID" "VITEST_AGENT_CHAT_ID=$CHAT_ID")
	STATE_DIR="$BATS_TEST_TMPDIR/data/active-subagents/$CHAT_ID"
}

_start() {
	va_hook "$1" hooks/subagent/start-tdd.sh "$(va_fx subagent-start-tdd.json "{\"session_id\":\"$CHAT_ID\"}")" --session-env "$SEED"
}

_stop() {
	va_hook "$1" hooks/subagent/stop-tdd.sh "$(va_fx subagent-stop-tdd.json "{\"session_id\":\"$CHAT_ID\"}")" --session-env "$SEED"
}

_end() {
	va_hook "$1" hooks/session/end-record.sh "$(va_fx session-end.json "{\"session_id\":\"$CHAT_ID\",\"reason\":\"$2\"}")" --session-env "$SEED"
}

_state_file() { find "$STATE_DIR" -name '*.json' 2>/dev/null | head -1; }

_write_pair() {
	mkdir -p "$STATE_DIR"
	FILE_A="$STATE_DIR/1000000000-11111.json"
	FILE_B="$STATE_DIR/2000000000-22222.json"
	jq -cn '{agentId:"agent-uuid-ALPHA",agentType:"vitest-agent:tdd-task",syntheticKey:"bats-phase-b-session-001-subagent-1000000000-11111",startedAt:"2026-05-01T10:00:00Z"}' >"$FILE_A"
	jq -cn '{agentId:"agent-uuid-BETA",agentType:"vitest-agent:tdd-task",syntheticKey:"bats-phase-b-session-001-subagent-2000000000-22222",startedAt:"2026-05-01T10:01:00Z"}' >"$FILE_B"
	touch -t 202605010000 "$FILE_A"
	touch -t 202605010001 "$FILE_B"
}

# --- 1. start writes the state file -----------------------------------------

@test "start-tdd.sh writes a valid state file with every field" {
	local f
	for t in "${VA_TARGETS[@]}"; do
		rm -rf "$STATE_DIR"
		_start "$t"
		assert_hook_noop
		f=$(_state_file)
		[ -f "$f" ]
		run jq empty "$f"
		[ "$status" -eq 0 ]
		[ "$(jq -r .agentId "$f")" = bats-subagent-agent-uuid-001 ]
		[ "$(jq -r .agentType "$f")" = vitest-agent:tdd-task ]
		[[ "$(jq -r .syntheticKey "$f")" == "${CHAT_ID}-subagent-"* ]]
		[ -n "$(jq -r '.startedAt // empty' "$f")" ]
		# The file name is the synthetic key tail: <ts>-<pid>.
		[[ "$(basename "$f" .json)" =~ ^[0-9]+-[0-9]+$ ]]
	done
}

@test "start-tdd.sh writes no state file when no main agent is known" {
	for t in "${VA_TARGETS[@]}"; do
		rm -rf "$STATE_DIR"
		va_hook "$t" hooks/subagent/start-tdd.sh "$(va_fx subagent-start-tdd.json "{\"session_id\":\"$CHAT_ID\"}")"
		assert_hook_noop
		[ -z "$(_state_file)" ]
	done
}

# --- 2. stop pairs, ends the agent and removes the file ----------------------

@test "stop-tdd.sh calls end-agent with the state file's agentId, without --host-session-id, and removes the file" {
	local f call
	for t in "${VA_TARGETS[@]}"; do
		rm -rf "$STATE_DIR"
		_start "$t"
		f=$(_state_file)
		[ -f "$f" ]
		va_argv_reset
		_stop "$t"
		assert_hook_noop
		call=$(va_argv_grep 'agent end-agent')
		[[ "$call" == "agent end-agent --agent-id bats-subagent-agent-uuid-001"* ]]
		[[ "$call" != *"--host-session-id"* ]]
		[ ! -f "$f" ]
	done
}

@test "stop-tdd.sh does nothing to agents when no state file exists" {
	for t in "${VA_TARGETS[@]}"; do
		rm -rf "$STATE_DIR"
		va_argv_reset
		_stop "$t"
		assert_hook_noop
		[ -z "$(va_argv_grep 'agent end-agent')" ]
	done
}

# --- 3. SessionEnd cleans up -------------------------------------------------

@test "end-record.sh removes the active-subagents dir for the closing chat_id" {
	for t in "${VA_TARGETS[@]}"; do
		mkdir -p "$STATE_DIR"
		echo '{"agentId":"orphan","agentType":"vitest-agent:tdd-task","syntheticKey":"k","startedAt":"2026-05-01T00:00:00Z"}' >"$STATE_DIR/99999-99999.json"
		# A continuation reason keeps the worker in the foreground; a true exit
		# would detach the cleanup and race this assertion.
		_end "$t" clear
		assert_hook_noop
		[ ! -d "$STATE_DIR" ]
	done
}

@test "end-record.sh succeeds when the active-subagents dir does not exist" {
	for t in "${VA_TARGETS[@]}"; do
		rm -rf "$STATE_DIR"
		_end "$t" clear
		assert_hook_noop
	done
}

# --- 4. concurrent same-type pairing -----------------------------------------

@test "concurrent pairing: the first stop drains the oldest state file" {
	for t in "${VA_TARGETS[@]}"; do
		rm -rf "$STATE_DIR"
		_write_pair
		va_argv_reset
		_stop "$t"
		[[ "$(va_argv_grep 'agent end-agent')" == *"--agent-id agent-uuid-ALPHA"* ]]
		[ ! -f "$FILE_A" ]
		[ -f "$FILE_B" ]
	done
}

@test "concurrent pairing: the second stop drains the newer file and none remain" {
	for t in "${VA_TARGETS[@]}"; do
		rm -rf "$STATE_DIR"
		_write_pair
		_stop "$t"
		va_argv_reset
		_stop "$t"
		[[ "$(va_argv_grep 'agent end-agent')" == *"--agent-id agent-uuid-BETA"* ]]
		[ "$(find "$STATE_DIR" -name '*.json' | wc -l | tr -d ' ')" -eq 0 ]
	done
}

@test "a stop never touches files in the hook's working directory when no state matches" {
	for t in "${VA_TARGETS[@]}"; do
		rm -rf "$STATE_DIR"
		mkdir -p "$STATE_DIR"
		touch "$(va_project)/keep-me.json"
		_stop "$t"
		[ -f "$(va_project)/keep-me.json" ]
	done
}
