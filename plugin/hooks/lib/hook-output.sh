#!/bin/bash
# hook-output.sh — shared helpers for emitting Claude Code hook stdout.
#
# Every Claude Code hook with exit 0 MUST emit valid JSON on stdout.
# Anything else triggers "Hook output does not start with {, treating
# as plain text" warnings and discards any structured fields the hook
# tried to set (continue, suppressOutput, hookSpecificOutput, etc).
#
# This file centralizes the JSON shapes so individual hooks don't
# inline literal JSON or remember field names. All caller-provided
# strings flow through `jq -n --arg` so embedded quotes, newlines,
# and backslashes in user data cannot break the output.
#
# Usage:
#   source "${CLAUDE_PLUGIN_ROOT}/hooks/lib/hook-output.sh"
#   emit_noop                                  # silent no-op
#   emit_allow "$reason"                       # PreToolUse allow
#   emit_deny "$reason"                        # PreToolUse deny
#   emit_additional_context "$event" "$ctx"   # PreToolUse / UserPromptSubmit / PostToolUse / SessionStart / SubagentStart
#   emit_system_message "$msg"                 # Stop / SessionEnd / PreCompact / SubagentStop
#
# Each helper emits exactly one JSON object on stdout. Exit code is
# the caller's responsibility — helpers do not exit.

# Propagate the project-root anchor to any `vitest-agent` CLI this hook
# spawns. The CLI resolves `data.db` from VITEST_AGENT_PROJECT_DIR (falling
# back to its own cwd); pinning it to CLAUDE_PROJECT_DIR — the same root the
# MCP server loader uses — keeps hook-driven recording (artifacts, turns,
# session/agent rows) writing to the SAME database the MCP server reads.
# Without this, a hook that runs from a sub-package cwd resolves a different
# per-project `data.db` and the open TDD task ends up split across two files.
# Sourced under `set -euo pipefail`, so this stays assignment-only: `:=`
# leaves an already-set value untouched, and the `if` guard avoids the
# `[ ] && export` short-circuit that would trip `set -e` when unset.
: "${VITEST_AGENT_PROJECT_DIR:=${CLAUDE_PROJECT_DIR:-}}"
if [ -n "${VITEST_AGENT_PROJECT_DIR:-}" ]; then
	export VITEST_AGENT_PROJECT_DIR
fi

# Silent no-op response. Tells Claude Code "continue normally, nothing
# to inject, don't clutter the transcript with this response."
emit_noop() {
	printf '%s\n' '{"continue": true, "suppressOutput": true}'
}

# PreToolUse permission allow. $1 = full reason string shown to user.
emit_allow() {
	local reason="$1"
	jq -n --arg r "$reason" '{
		hookSpecificOutput: {
			hookEventName: "PreToolUse",
			permissionDecision: "allow",
			permissionDecisionReason: $r
		}
	}'
}

# PreToolUse permission deny. $1 = full reason string shown to user.
emit_deny() {
	local reason="$1"
	jq -n --arg r "$reason" '{
		hookSpecificOutput: {
			hookEventName: "PreToolUse",
			permissionDecision: "deny",
			permissionDecisionReason: $r
		}
	}'
}

# Inject additionalContext. Valid event names per Claude Code spec:
# PreToolUse, UserPromptSubmit, PostToolUse, SessionStart, SubagentStart,
# Setup. The hookEventName MUST match the firing event or the field
# is silently dropped. $1 = event name, $2 = markdown context.
emit_additional_context() {
	local event="$1"
	local ctx="$2"
	jq -n --arg e "$event" --arg c "$ctx" '{
		hookSpecificOutput: {
			hookEventName: $e,
			additionalContext: $c
		}
	}'
}

# Top-level systemMessage. For events that DO NOT support
# hookSpecificOutput.additionalContext: Stop, SessionEnd, PreCompact,
# SubagentStop. Surfaces a warning-style message to the user and a
# system reminder to Claude. $1 = message text.
emit_system_message() {
	local msg="$1"
	jq -n --arg m "$msg" '{ systemMessage: $m }'
}
