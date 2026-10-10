#!/bin/bash
# Records a tool_result turn for PostToolUse. For Edit/Write/MultiEdit
# additionally records a file_edit turn so file_edit_history is queryable.
set -euo pipefail

. "$(dirname "$0")/../lib/pluginfinity/hook.sh"
. "$(dirname "$0")/../lib/vitest-agent/common.sh"
hook_require_input

chat_id=$(hook_input session_id)
cwd=$(hook_input cwd)
tool_name=$(hook_input tool_name)
tool_use_id=$(hook_input tool_use_id)
# tool_response.success: absent or true -> true, anything else -> false.
success=$(hook_input tool_response.success)
case "$success" in
"" | true) success=true ;;
*) success=false ;;
esac

hook_debug "session_id=$chat_id tool=$tool_name cwd=$cwd"

if [ -z "$chat_id" ] || [ -z "$cwd" ] || [ -z "$tool_name" ]; then
	hook_noop
	exit 0
fi

cli=$(va_cli "$cwd") || {
	hook_noop
	exit 0
}

# 1. Always record a tool_result turn.
result_payload=$(jq -nc \
	--arg tn "$tool_name" \
	--arg tuid "$tool_use_id" \
	--argjson ok "$success" \
	'{type: "tool_result", tool_name: $tn, success: $ok} + (if $tuid != "" then {tool_use_id: $tuid} else {} end)')

_turn_err=$(mktemp)
_turn_out=$(cd "$cwd" && $cli agent record turn \
	--chat-id "$chat_id" \
	"$result_payload" 2>"$_turn_err") || {
	_rc=$?
	hook_log "record turn tool_result rc=$_rc cc=$chat_id tool=$tool_name: $(cat "$_turn_err")"
}
rm -f "$_turn_err"
hook_debug "record turn tool_result: $_turn_out"

# 2. For Edit/Write/MultiEdit, additionally record a file_edit turn.
case "$tool_name" in
Edit | Write | MultiEdit)
	file_path=$(hook_input tool_input.file_path)
	if [ -z "$file_path" ]; then
		hook_noop
		exit 0
	fi
	case "$tool_name" in
	Edit) edit_kind="edit" ;;
	Write) edit_kind="write" ;;
	MultiEdit) edit_kind="multi_edit" ;;
	esac
	edit_payload=$(jq -nc \
		--arg fp "$file_path" \
		--arg ek "$edit_kind" \
		'{type: "file_edit", file_path: $fp, edit_kind: $ek}')
	_edit_err=$(mktemp)
	_edit_out=$(cd "$cwd" && $cli agent record turn \
		--chat-id "$chat_id" \
		"$edit_payload" 2>"$_edit_err") || {
		_rc=$?
		hook_log "record turn file_edit rc=$_rc cc=$chat_id file=$file_path: $(cat "$_edit_err")"
	}
	rm -f "$_edit_err"
	hook_debug "record turn file_edit file=$file_path: $_edit_out"
	;;
esac

hook_noop
