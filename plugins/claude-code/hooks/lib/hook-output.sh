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

# --- stdout fence -------------------------------------------------------
# Claude Code parses a hook's stdout as ONE JSON object, so any other byte
# written to fd 1 corrupts the payload — including stdout from a spawned
# `vitest-agent` CLI whose call site only remembered to redirect stderr
# (issue #373). Rather than trust every future call site, move the real
# hook stdout to fd 3 and point fd 1 at stderr: only the emit_* helpers
# below, which write explicitly to fd 3, can reach the host.
#
# Command substitution is unaffected — `$(cmd)` installs its own pipe on
# fd 1. Anything that detaches a background worker MUST close the
# inherited descriptor (`3>&-`) so the host's stream-close wait is not
# held open by the worker; see hooks/session/end-record.sh.
#
# The guard is deliberately NOT exported: a nested script that sources
# this lib must fence its own fd 1, not inherit the parent's fd 3.
if [ -z "${_VITEST_AGENT_HOOK_STDOUT_FENCED:-}" ]; then
	exec 3>&1 1>&2
	_VITEST_AGENT_HOOK_STDOUT_FENCED=1
fi

# Silent no-op response. Tells Claude Code "continue normally, nothing
# to inject, don't clutter the transcript with this response."
emit_noop() {
	printf '%s\n' '{"continue": true, "suppressOutput": true}' >&3
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
	}' >&3
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
	}' >&3
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
	}' >&3
}

# Escape hatch for a payload shape none of the helpers above cover — in
# practice PreToolUse `updatedInput`, whose object is tool-specific and so
# cannot be centralized here. Reads one already-encoded JSON object on stdin
# and writes it to the fenced descriptor:
#
#   jq -n --arg c "$cmd" '{ ... }' | emit_raw
#
# The caller still owes the JSON encoder (`jq -n --arg`, never string
# concatenation). This exists so the "only emit_* reaches the host" invariant
# stays true and greppable — a bare `jq -n ...` writing to fd 1 is diverted to
# stderr by the fence and the host sees an empty payload.
emit_raw() {
	cat >&3
}

# Top-level systemMessage. For events that DO NOT support
# hookSpecificOutput.additionalContext: Stop, SessionEnd, PreCompact,
# SubagentStop. Surfaces a warning-style message to the user and a
# system reminder to Claude. $1 = message text.
emit_system_message() {
	local msg="$1"
	jq -n --arg m "$msg" '{ systemMessage: $m }' >&3
}
