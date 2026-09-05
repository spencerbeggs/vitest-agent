#!/bin/bash
# Shared error/debug logging for hooks.
#
# Error log (CLI failures, always-on): $VITEST_AGENT_HOOK_ERROR_LOG
#   Default: /tmp/vitest-agent-hook-errors.log
#
# Debug log (full input + all CLI calls): $VITEST_AGENT_HOOK_DEBUG_LOG
#   Set VITEST_AGENT_HOOK_DEBUG=1 to activate.
#   Default: /tmp/vitest-agent-hook-debug.log
#
# Usage:
#   . "$(dirname "$0")/lib/hook-debug.sh"
#   hook_debug "HOOK" "message"    # debug mode only
#   hook_error "HOOK" "message"    # always writes to error log

_HOOK_ERR_LOG="${VITEST_AGENT_HOOK_ERROR_LOG:-/tmp/vitest-agent-hook-errors.log}"
_HOOK_DBG_LOG="${VITEST_AGENT_HOOK_DEBUG_LOG:-/tmp/vitest-agent-hook-debug.log}"
_HOOK_DEBUG="${VITEST_AGENT_HOOK_DEBUG:-0}"

hook_debug() {
	[ "$_HOOK_DEBUG" = "1" ] || return 0
	printf '[%s] %s: %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$1" "$2" >> "$_HOOK_DBG_LOG"
}

hook_error() {
	printf '[%s] %s: %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$1" "$2" >> "$_HOOK_ERR_LOG"
}
