#!/bin/bash
# Shared helper for TDD-scoped hooks. Returns 0 if the supplied
# agent_type value identifies the tdd-task subagent, else 1.
#
# Claude Code emits `.agent_type` as `"vitest-agent:tdd-task"` in both
# SubagentStart hook payloads and PostToolUse/PreToolUse payloads inside
# the subagent's execution. The `plugin:` prefix form and bare `tdd-task`
# slug have never been observed in practice.

is_tdd_agent() {
	case "$1" in
		"vitest-agent:tdd-task") return 0 ;;
		*) return 1 ;;
	esac
}
