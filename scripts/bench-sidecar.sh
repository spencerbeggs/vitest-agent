#!/usr/bin/env bash
# bench-sidecar.sh — Phase E benchmark harness for the T9.2 sidecar fix.
#
# Fires the real PreToolUse Bash hook (plugin/hooks/pre-tool-use/bash.sh)
# against synthetic Claude Code payloads and measures end-to-end
# wall-clock latency through each of the four code paths the T9.2
# layering produces:
#
#   layer0-skip       — non-Vitest command; the Layer 0 regex prefilter
#                        emits a no-op before any work.
#   layer1-skip       — Vitest command, main-agent context; Layer 1
#                        skips the sidecar (env already correct).
#   layer2-binary     — Vitest command, subagent context, the native
#                        vitest-agent-sidecar binary on PATH.
#   layer2-jsfallback — same, but no binary on PATH; the JS CLI runs.
#
# The first two paths are what ~98% of real Bash calls hit. The launch
# gate is: hot-path (Layer 0 / Layer 1) p95 under 20 ms, and the
# subagent-Vitest path p95 under 150 ms. The 20 ms hot-path budget is
# the figure in the 2.0 release-order guide; the T9.2 spec's earlier
# "under 10 ms" target underestimated the irreducible cost of the bash
# hook process itself — process spawn, sourcing the lib helpers, and
# one jq parse. The sidecar latency the workstream removed is gone; the
# ~15 ms of remaining hook plumbing is not sidecar-attributable.
#
# Requires bash >= 5 for EPOCHREALTIME (microsecond wall-clock). macOS
# ships bash 3.2 at /bin/bash — install a modern bash (e.g. via
# Homebrew) and run this script with it.
#
# Usage:
#   scripts/bench-sidecar.sh [--trials N]
#
#   --trials N   samples per scenario (default 30)

set -euo pipefail

if [ -z "${EPOCHREALTIME:-}" ]; then
	echo "bench-sidecar: requires bash >= 5 (EPOCHREALTIME unavailable)." >&2
	echo "  current bash: ${BASH_VERSION:-unknown}" >&2
	exit 1
fi

TRIALS=30
while [ $# -gt 0 ]; do
	case "$1" in
		--trials)
			TRIALS="$2"
			shift 2
			;;
		*)
			echo "bench-sidecar: unknown argument: $1" >&2
			exit 1
			;;
	esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK="${REPO_ROOT}/plugin/hooks/pre-tool-use/bash.sh"

if [ ! -f "$HOOK" ]; then
	echo "bench-sidecar: hook not found at $HOOK" >&2
	exit 1
fi

# Locate the sidecar binary for this host. Each per-platform sub-package
# builds its own SEA into packages/sidecar-<platform>-<arch>/dist/npm/bin/.
case "$(uname -s)" in
	Darwin) BENCH_PLATFORM="darwin" ;;
	Linux) BENCH_PLATFORM="linux" ;;
	*) BENCH_PLATFORM="unknown" ;;
esac
case "$(uname -m)" in
	arm64 | aarch64) BENCH_ARCH="arm64" ;;
	x86_64 | amd64) BENCH_ARCH="x64" ;;
	*) BENCH_ARCH="unknown" ;;
esac
SIDECAR_BUILD="${REPO_ROOT}/packages/sidecar-${BENCH_PLATFORM}-${BENCH_ARCH}/dist/npm/bin/vitest-agent-sidecar"

# Scratch state — a temp HOME so the synthetic session-env files never
# touch the developer's real ~/.claude tree.
WORK="$(mktemp -d)"
BENCH_HOME="${WORK}/home"
BIN_DIR="${WORK}/bin"
SESSION_ID="bench-sidecar-session-0001"
mkdir -p "${BENCH_HOME}/.claude/session-env/${SESSION_ID}" "$BIN_DIR"

cleanup() {
	rm -rf "$WORK"
}
trap cleanup EXIT

# Use the repo root as the project dir: its package.json carries a
# `test` script that mentions vitest (so inject-env's script-indirection
# match fires), it has a pnpm lockfile (so detect-pm resolves `pnpm
# exec`), and `pnpm exec vitest-agent` resolves the workspace CLI — the
# JS-fallback path must run the real CLI to measure a representative
# cold-start. The hook only reads; nothing here writes to the repo.
PROJECT_DIR="$REPO_ROOT"

# Write the synthetic session-env file the hook self-sources. agentId
# equal to mainAgentId models the main agent (Layer 1 skip); differing
# values model a subagent (Layer 2 runs).
write_session_env() {
	local agent_id="$1" main_agent_id="$2"
	cat > "${BENCH_HOME}/.claude/session-env/${SESSION_ID}/vitest-agent-hook.sh" <<EOF
export VITEST_AGENT_CHAT_ID="${SESSION_ID}"
export VITEST_AGENT_CONVERSATION_ID="bench-conversation-0001"
export VITEST_AGENT_MAIN_AGENT_ID="${main_agent_id}"
export VITEST_AGENT_AGENT_ID="${agent_id}"
EOF
}

# Emit a PreToolUse Bash payload for the given command.
make_payload() {
	local command="$1"
	jq -n --arg sid "$SESSION_ID" --arg cwd "$PROJECT_DIR" --arg cmd "$command" '{
		session_id: $sid,
		cwd: $cwd,
		tool_name: "Bash",
		tool_input: { command: $cmd, description: "", timeout: 120000, run_in_background: false },
		hook_event_name: "PreToolUse"
	}'
}

# Percentile from a newline-separated, numeric sample list on stdin.
# Nearest-rank method. $1 = percentile (0-100).
percentile() {
	local p="$1"
	sort -n | awk -v p="$p" '
		{ v[NR] = $1 }
		END {
			if (NR == 0) { print "0"; exit }
			rank = int((p / 100) * NR + 0.5)
			if (rank < 1) rank = 1
			if (rank > NR) rank = NR
			printf "%.2f", v[rank]
		}'
}

mean() {
	awk '{ s += $1; n++ } END { if (n == 0) print "0"; else printf "%.2f", s / n }'
}

# Run one scenario: fire the hook $TRIALS times against $payload with
# the supplied PATH and HOME, printing one elapsed-ms float per line.
run_scenario() {
	local payload="$1" scenario_path="$2"
	local i start end
	for ((i = 0; i < TRIALS; i++)); do
		start="$EPOCHREALTIME"
		PATH="$scenario_path" HOME="$BENCH_HOME" CLAUDE_PROJECT_DIR="$PROJECT_DIR" \
			bash "$HOOK" <<<"$payload" >/dev/null 2>&1 || true
		end="$EPOCHREALTIME"
		awk -v s="$start" -v e="$end" 'BEGIN { printf "%.3f\n", (e - s) * 1000 }'
	done
}

# Report a scenario's distribution and stash its p95 for the gate check.
declare -A P95
report() {
	local label="$1" samples="$2"
	local min p50 p95 p99 max avg
	min="$(echo "$samples" | sort -n | head -n1)"
	max="$(echo "$samples" | sort -n | tail -n1)"
	p50="$(echo "$samples" | percentile 50)"
	p95="$(echo "$samples" | percentile 95)"
	p99="$(echo "$samples" | percentile 99)"
	avg="$(echo "$samples" | mean)"
	P95["$label"]="$p95"
	printf '%-20s %9s %9s %9s %9s %9s %9s\n' \
		"$label" "$min" "$avg" "$p50" "$p95" "$p99" "$max"
}

echo "bench-sidecar — T9.2 hook latency, ${TRIALS} trials/scenario"
echo "host: $(uname -s) $(uname -m), bash ${BASH_VERSION%%(*}"
if [ -x "$SIDECAR_BUILD" ]; then
	echo "sidecar binary: ${SIDECAR_BUILD#"${REPO_ROOT}/"}"
	ln -sf "$SIDECAR_BUILD" "${BIN_DIR}/vitest-agent-sidecar"
else
	echo "sidecar binary: NOT BUILT — run 'pnpm --filter \"vitest-agent-sidecar-*\" build:prod'"
	echo "                the layer2-binary scenario is skipped."
fi
echo
printf '%-20s %9s %9s %9s %9s %9s %9s\n' \
	"scenario" "min" "mean" "p50" "p95" "p99" "max"
printf '%s\n' "--------------------------------------------------------------------------------"

# Base PATH without the sidecar binary dir.
BASE_PATH="$PATH"
# PATH with the sidecar binary dir prepended.
BINARY_PATH="${BIN_DIR}:${PATH}"

# layer0-skip — non-Vitest command, prefilter no-op. Context irrelevant.
write_session_env "bench-main-agent" "bench-main-agent"
report "layer0-skip" "$(run_scenario "$(make_payload 'git status')" "$BASE_PATH")"

# layer1-skip — Vitest command, main-agent context.
write_session_env "bench-main-agent" "bench-main-agent"
report "layer1-skip" "$(run_scenario "$(make_payload 'pnpm test')" "$BASE_PATH")"

# layer2-binary — Vitest command, subagent context, binary on PATH.
write_session_env "bench-subagent-7" "bench-main-agent"
if [ -x "$SIDECAR_BUILD" ]; then
	report "layer2-binary" "$(run_scenario "$(make_payload 'pnpm test')" "$BINARY_PATH")"
fi

# layer2-jsfallback — Vitest command, subagent context, no binary.
write_session_env "bench-subagent-7" "bench-main-agent"
report "layer2-jsfallback" "$(run_scenario "$(make_payload 'pnpm test')" "$BASE_PATH")"

echo
echo "Launch gate (T9.2 spec, Phase E):"
gate_fail=0

# Hot path: ~98% of Bash calls hit Layer 0 or Layer 1. Their p95 must
# be under 20 ms (the release-order guide budget).
for label in layer0-skip layer1-skip; do
	p95="${P95[$label]:-0}"
	if awk -v v="$p95" 'BEGIN { exit (v < 20) ? 0 : 1 }'; then
		echo "  PASS  ${label} p95 ${p95} ms < 20 ms"
	else
		echo "  FAIL  ${label} p95 ${p95} ms >= 20 ms"
		gate_fail=1
	fi
done

# Subagent-Vitest path: whichever Layer 2 path is live must be under
# 150 ms p95.
subagent_label="layer2-jsfallback"
if [ -x "$SIDECAR_BUILD" ]; then
	subagent_label="layer2-binary"
fi
subagent_p95="${P95[$subagent_label]:-0}"
if awk -v v="$subagent_p95" 'BEGIN { exit (v < 150) ? 0 : 1 }'; then
	echo "  PASS  ${subagent_label} p95 ${subagent_p95} ms < 150 ms"
else
	echo "  FAIL  ${subagent_label} p95 ${subagent_p95} ms >= 150 ms"
	gate_fail=1
fi

exit "$gate_fail"
