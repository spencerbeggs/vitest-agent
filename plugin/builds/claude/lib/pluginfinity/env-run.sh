# shellcheck shell=sh
# pluginfinity session env runner. `pluginfinity build` writes this file at
# lib/pluginfinity/env-run.sh into every target whose config declares `env`,
# and runs it as the first SessionStart entry; do not edit a copy under builds/.
#
# POSIX sh. Run as a script (`sh <path>`), with the SessionStart event on stdin.
# Writes nothing to stdout or stderr and always exits 0: every problem is a log
# line, and the shell's own job-control notices are redirected away.
#
# Once per SessionStart (every source) it resolves each declared name through
# rungs 1-5 (default, setup output, <project>/.env, <project>/.env.local, the
# environment this process inherited), then writes the resolved values to the
# session values file, points the project at this session, and on Claude
# appends `export NAME='value'` lines to CLAUDE_ENV_FILE for the Bash tool.
#
# The setup script runs under bash with cwd the project, the hook environment
# plus PLUGINFINITY_EVENT=SessionStart, and the event on stdin. Its stdout is
# NAME=value lines (blank and # lines ignored, values literal, later lines
# win); an undeclared name is skipped with a log line. It is bounded by
# _pf_env_setup_timeout seconds: on timeout the setup and every process it
# started are terminated (then killed after 1 s) and nothing it printed is
# kept; on a non-zero exit its valid lines are kept. With no project (a Copilot
# event with no cwd) setup is skipped with a log line.
#
# Under the session lock it keeps the names a same-id rerun finds recorded as
# set at rung 6, writes the values, then writes the session's done marker.

_pf_env_lib_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" 2>/dev/null && pwd) || exit 0
_pf_env_manual=1
_pf_env_component=hook
[ -r "$_pf_env_lib_dir/env.sh" ] || exit 0
# shellcheck source=/dev/null
. "$_pf_env_lib_dir/env.sh" || exit 0
[ -n "$_pf_env_names" ] || exit 0

_pf_r_tmp=$(mktemp -d "${TMPDIR:-/tmp}/pluginfinity-env.XXXXXX" 2>/dev/null) || {
	_pf_env_log "cannot create a temporary directory; session env not resolved"
	exit 0
}
trap 'rm -rf "$_pf_r_tmp" 2>/dev/null' EXIT

if [ -t 0 ]; then
	printf '{}' >"$_pf_r_tmp/input"
else
	cat >"$_pf_r_tmp/input" 2>/dev/null || :
fi

# A top-level string field of the event: jq when it works, else a plain match
# that keeps escape sequences as written (a session id holding one is invalid).
_pf_r_jq=
if command -v jq >/dev/null 2>&1 && jq -n 1 >/dev/null 2>&1; then _pf_r_jq=1; fi
_pf_r_field() {
	if [ -n "$_pf_r_jq" ]; then
		jq -r --arg k "$1" 'if type == "object" then (.[$k] // empty) | strings else empty end' \
			<"$_pf_r_tmp/input" 2>/dev/null || :
	else
		tr -d '\n' <"$_pf_r_tmp/input" | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p"
	fi
}

_pf_r_sid=$(_pf_r_field session_id)
[ -n "$_pf_r_sid" ] || _pf_r_sid=$(_pf_r_field sessionId)
_pf_r_cwd=$(_pf_r_field cwd)

# The project: the event's cwd walked up to .git. Without one, Claude's rule
# for a script; Copilot runs hooks from the plugin root, which is no project.
case $_pf_r_cwd in
/*) _pf_r_proj=$(_pf_env_project_of "$_pf_r_cwd") ;;
*)
	if [ "${PLUGINFINITY_HOST:-}" = copilot ]; then
		_pf_r_proj=
		_pf_env_log "the event has no cwd; .env files not read"
	else
		_pf_r_proj=$(_pf_env_script_project)
	fi
	;;
esac

_pf_env_init

# Every process below $1, from one ps snapshot.
_pf_r_descendants() {
	ps -A -o pid= -o ppid= 2>/dev/null | awk -v root="$1" '
		{ parent[$1] = $2 }
		END {
			for (p in parent) {
				q = p
				for (i = 0; i < 64 && q != "" && q != 0 && q != 1; i++) {
					q = parent[q]
					if (q == root) { print p; break }
				}
			}
		}'
}

# Send signal $1 to process $2, to its process group when it leads one ($4 is
# the group id seen at the first signal), and to the pids in $3.
_pf_r_signal() {
	case ${2:-} in '' | 0 | 1 | *[!0123456789]*) return 0 ;; esac
	if [ "${4:-}" = "$2" ]; then kill -s "$1" -- "-$2" 2>/dev/null || :; fi
	# shellcheck disable=SC2086 # pids are words
	kill -s "$1" "$2" ${3:-} 2>/dev/null || :
}

# Rung 2: the setup script.
_pf_r_setup() {
	[ -n "$_pf_env_setup" ] || return 0
	_pf_r_script="$_pf_env_lib_dir/../../$_pf_env_setup"
	if [ ! -f "$_pf_r_script" ]; then
		_pf_env_log "setup script $_pf_env_setup is missing; skipped"
		return 0
	fi
	if [ -z "$_pf_r_proj" ]; then
		_pf_env_log "no project; setup script $_pf_env_setup skipped"
		return 0
	fi
	_pf_r_t=$_pf_env_setup_timeout
	case $_pf_r_t in '' | *[!0123456789]*) _pf_r_t=10 ;; esac
	# Its own process group where job control allows (bash, bash as sh), so a
	# timeout can signal the group; the descendant walk covers dash, which has no
	# job control without a terminal.
	set -m 2>/dev/null || :
	(
		CDPATH='' cd -- "$_pf_r_proj" 2>/dev/null || exit 1
		PLUGINFINITY_EVENT=SessionStart
		export PLUGINFINITY_EVENT
		exec bash "$_pf_r_script"
	) <"$_pf_r_tmp/input" >"$_pf_r_tmp/out" 2>"$_pf_r_tmp/err" &
	_pf_r_pid=$!
	set +m 2>/dev/null || :
	(
		sleep "$_pf_r_t"
		: >"$_pf_r_tmp/timedout"
		# One snapshot: by the KILL the orphans belong to init and no walk finds them.
		_pf_r_kids=$(_pf_r_descendants "$_pf_r_pid")
		_pf_r_pg=$(ps -o pgid= -p "$_pf_r_pid" 2>/dev/null | tr -d ' ')
		_pf_r_signal TERM "$_pf_r_pid" "$_pf_r_kids" "$_pf_r_pg"
		sleep 1
		_pf_r_signal KILL "$_pf_r_pid" "$_pf_r_kids" "$_pf_r_pg"
	) </dev/null >/dev/null 2>&1 &
	_pf_r_watch=$!
	if wait "$_pf_r_pid" 2>/dev/null; then _pf_r_rc=0; else _pf_r_rc=$?; fi
	# After a timeout the watcher still owes the KILL for anything that ignored TERM.
	if [ -e "$_pf_r_tmp/timedout" ]; then
		wait "$_pf_r_watch" 2>/dev/null || :
	else
		# Reaped inside the redirect: bash as sh prints "Terminated" for a killed job.
		{ kill "$_pf_r_watch" && wait "$_pf_r_watch"; } 2>/dev/null || :
	fi
	if pf_debug_on 2>/dev/null && [ -s "$_pf_r_tmp/err" ]; then
		head -n 20 "$_pf_r_tmp/err" | while IFS= read -r _pf_r_l; do _pf_env_debug "setup: $_pf_r_l"; done
	fi
	if [ -e "$_pf_r_tmp/timedout" ]; then
		_pf_env_log "setup script $_pf_env_setup timed out after ${_pf_r_t}s; its output is discarded"
		return 0
	fi
	[ "$_pf_r_rc" -eq 0 ] || _pf_env_log "setup script $_pf_env_setup exited $_pf_r_rc; keeping its valid lines"
	while IFS= read -r _pf_e_l || [ -n "$_pf_e_l" ]; do
		case $_pf_e_l in '' | '#'*) continue ;; esac
		_pf_e_k=${_pf_e_l%%=*}
		[ "$_pf_e_k" != "$_pf_e_l" ] || continue
		if _pf_env_declared "$_pf_e_k"; then
			_pf_e_v=${_pf_e_l#*=}
			eval "_pf_env_val_$_pf_e_k=\$_pf_e_v"
		elif _pf_env_is_name "$_pf_e_k"; then
			_pf_env_log "setup printed $_pf_e_k, which is not declared; skipped"
		fi
	done <"$_pf_r_tmp/out"
	return 0
}
_pf_r_setup

# Rungs 3-5.
_pf_env_live "$_pf_r_proj"

if _pf_env_valid_id "$_pf_r_sid"; then
	_pf_r_sd=$(_pf_env_session_dir "$_pf_r_sid")
	_pf_env_lock "$_pf_r_sd"
	# A same-id rerun keeps what _pf_env_set wrote (rung 6) and re-resolves the rest.
	_pf_env_keep_set "$_pf_r_sd"
	if _pf_env_write_values "$_pf_r_sd/env"; then _pf_r_ok=1; else _pf_r_ok=; fi
	_pf_env_unlock
	(umask 077 && : >"$_pf_r_sd/done") 2>/dev/null || :
	if [ -n "$_pf_r_ok" ] && [ -n "$_pf_r_proj" ]; then
		_pf_r_ptr=$(_pf_env_pointer_path "$_pf_r_proj")
		if (umask 077 && mkdir -p "$(dirname -- "$_pf_r_ptr")") 2>/dev/null &&
			printf '%s\n%s\n' "$_pf_r_sid" "$_pf_r_proj" >"$_pf_r_ptr.tmp.$$" 2>/dev/null &&
			mv -f "$_pf_r_ptr.tmp.$$" "$_pf_r_ptr" 2>/dev/null; then
			:
		else
			rm -f "$_pf_r_ptr.tmp.$$" 2>/dev/null
			_pf_env_log "cannot write the project pointer"
		fi
	fi
elif [ -z "$_pf_r_sid" ]; then
	_pf_env_log "the event has no session id; session values not written"
else
	_pf_env_log "invalid session id; session values not written"
fi

# shellcheck disable=SC2086 # the names are words
_pf_env_claude_export $_pf_env_names
exit 0
