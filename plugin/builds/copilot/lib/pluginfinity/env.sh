# shellcheck shell=sh
# pluginfinity session env. `pluginfinity build` writes this file into every
# target whose config declares `env`, at lib/pluginfinity/env.sh, with the
# declarations block below filled in; do not edit a copy under builds/, the
# next build overwrites it.
#
# POSIX sh. Writes nothing to stdout. Fails open: every problem is a log line
# and the variables keep what the chain could resolve.
#
# From a skill script or a monitor, two lines apply the session's values. Build
# the path from an absolute directory, before any cd: a relative $0 no longer
# resolves after one.
#   _pf_lib_dir="$(cd "$(dirname "$0")/../../../lib/pluginfinity" && pwd)"   # skills/<s>/scripts/x.sh
#   . "$_pf_lib_dir/env.sh"
# A script that resolves its own project sources first, changes directory, then
# loads for that project:
#   _pf_env_manual=1; . "$_pf_lib_dir/env.sh"; cd "$PROJECT_DIR"; env_load "" "$PROJECT_DIR"
#
# Precedence, lowest first: the config default, the setup script's output,
# <project>/.env, <project>/.env.local, the ambient environment (a declared
# name already set when this file is sourced), then _pf_env_set at run time.
# The SessionStart runner (env-run.sh) resolves the first five once and writes
# the result to the session values file; a reader takes that file as
# authoritative and evaluates the chain live (without setup) only for names the
# file lacks, or when there is no file at all.
#
# State, under ${XDG_STATE_HOME:-$HOME/.local/state}/pluginfinity/<plugin>/
# (directories and files created under umask 077):
#   session/<session id>/env      one NAME=value line per declared name, the
#                                 resolved value; the value is literal to the
#                                 end of the line
#   session/<session id>/set      provenance: one NAME per line for each name
#                                 last written by _pf_env_set (rung 6). A
#                                 SessionStart rerun under the same id keeps
#                                 these names' values and re-resolves the rest.
#   session/<session id>/done     written by the runner when it has finished
#   session/<session id>/lock/    a mkdir lock around every read-merge-write of
#                                 env and set; lock/at holds its epoch seconds
#   project/<cksum of dir>        line 1 the latest session id, line 2 the dir
#
# Locking: a writer waits up to about 5 s for the lock, removes one older than
# 10 s (or with no lock/at after 2 s) as stale, and on timeout logs and writes
# anyway (fail open).
#
# Claude runs an event's hooks in parallel, so a SessionStart hook may read
# before the runner has finished. In SessionStart only (PLUGINFINITY_EVENT),
# env_load with a session id but no values file waits up to 3 s for the
# runner's done marker, then resolves live with a log line. Other events never
# wait.
#
# Contract for callers (the hook library and the runner):
#   _pf_env_lib_dir   set before sourcing to this file's directory when
#                     _pf_lib_dir names another (the hook library's) directory.
#   _pf_env_manual=1  set before sourcing to skip the automatic env_load; the
#                     caller then calls env_load itself.
#   _pf_env_component the log component (hook|script|monitor); guessed if unset.
#   env_load [<session id> [<project dir>]]
#                     apply the chain into the current shell and export every
#                     declared name. With no session id, CLAUDE_CODE_SESSION_ID
#                     names the session when it is a valid id whose values file
#                     exists; otherwise the project pointer for <project dir>
#                     (default: CLAUDE_PROJECT_DIR or $PWD, walked up to the
#                     nearest .git) does. A <project dir> of - means no project:
#                     no pointer and no .env read. An invalid session id
#                     (empty, ., /, .., a backslash, a control character) is
#                     logged and nothing is read. Always returns 0.
#   env_reload        env_load again with the arguments the last one got.
#   _pf_env_set NAME VALUE
#                     rank-6 write: under the lock, update the session values
#                     file (atomically) and record NAME in the set file,
#                     export NAME in this shell and, on Claude with
#                     CLAUDE_ENV_FILE set, append `export NAME='VALUE'` to it.
#                     Returns 1, with a log line, for an undeclared name, a
#                     value holding a newline, or no valid session from the last
#                     env_load. It does not check the event: the caller does.
#                     The hook library's hook_env_set wraps it and always
#                     returns 0, so a refusal can never fail a hook.
#   _pf_env_declared NAME   0 when NAME is declared.

# >>> pluginfinity env declarations (the build replaces this block)
_pf_env_names='VITEST_AGENT_CHAT_ID VITEST_AGENT_CONVERSATION_ID VITEST_AGENT_MAIN_AGENT_ID VITEST_AGENT_AGENT_ID VITEST_AGENT_SIDECAR_BIN'
_pf_env_default_VITEST_AGENT_CHAT_ID=''
_pf_env_default_VITEST_AGENT_CONVERSATION_ID=''
_pf_env_default_VITEST_AGENT_MAIN_AGENT_ID=''
_pf_env_default_VITEST_AGENT_AGENT_ID=''
_pf_env_default_VITEST_AGENT_SIDECAR_BIN=''
_pf_env_setup=''
_pf_env_setup_timeout=10
# <<< pluginfinity env declarations

_pf_env_dir="${_pf_env_lib_dir:-${_pf_lib_dir:-${_pf_log_dir:-.}}}"
if ! command -v pf_log >/dev/null 2>&1; then
	if [ -r "$_pf_env_dir/log.sh" ]; then
		_pf_log_dir="$_pf_env_dir"
		# shellcheck source=/dev/null
		. "$_pf_env_dir/log.sh"
	else
		pf_log() { return 0; }
		pf_debug() { return 0; }
		pf_debug_on() { return 1; }
	fi
fi
if [ -z "${PLUGINFINITY_PLUGIN:-}" ] && [ -r "$_pf_env_dir/host.sh" ]; then
	# shellcheck source=/dev/null
	. "$_pf_env_dir/host.sh" 2>/dev/null || :
fi
if [ -z "${_pf_env_component:-}" ]; then
	if command -v hook_log >/dev/null 2>&1; then
		_pf_env_component=hook
	elif command -v monitor_log >/dev/null 2>&1; then
		_pf_env_component=monitor
	else
		_pf_env_component=script
	fi
fi

_pf_env_log() { pf_log "$_pf_env_component" "env: $*"; }
_pf_env_debug() { pf_debug "$_pf_env_component" "env: $*"; }

_pf_env_cr=$(printf '\r')
_pf_env_nl='
'

# 0 when $1 is a declared name. The character check keeps eval safe.
_pf_env_declared() {
	case ${1:-} in
	'' | [0123456789]* | *[!ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_]*) return 1 ;;
	esac
	case " $_pf_env_names " in
	*" $1 "*) return 0 ;;
	esac
	return 1
}

# 0 when $1 looks like a variable name at all (declared or not).
_pf_env_is_name() {
	case ${1:-} in
	'' | [0123456789]* | *[!ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_]*) return 1 ;;
	esac
	return 0
}

# 0 when $1 is a usable session id: not empty, not ., no /, no .., no \, no control character.
_pf_env_valid_id() {
	case ${1:-} in
	'' | . | */* | *..* | *\\*) return 1 ;;
	esac
	[ "$(printf '%s' "$1" | tr -d '[:cntrl:]')" = "$1" ]
}

_pf_env_state_root() {
	printf '%s\n' "${XDG_STATE_HOME:-${HOME:-/nonexistent}/.local/state}/pluginfinity/${PLUGINFINITY_PLUGIN:-unknown}"
}

# $1 as a physical path, or as given when it cannot be entered.
_pf_env_physical() {
	(CDPATH='' cd -- "$1" 2>/dev/null && pwd -P) || printf '%s\n' "$1"
}

# The project for directory $1: the nearest directory at or above it holding .git, else $1.
_pf_env_project_of() {
	_pf_e_p=$(_pf_env_physical "$1")
	_pf_e_q=$_pf_e_p
	while [ -n "$_pf_e_q" ] && [ "$_pf_e_q" != / ] && [ "$_pf_e_q" != . ]; do
		if [ -e "$_pf_e_q/.git" ]; then
			printf '%s\n' "$_pf_e_q"
			return 0
		fi
		_pf_e_q=$(dirname -- "$_pf_e_q")
	done
	printf '%s\n' "$_pf_e_p"
}

# The project of a script with no session: CLAUDE_PROJECT_DIR, else $PWD, walked to .git.
_pf_env_script_project() {
	_pf_env_project_of "${CLAUDE_PROJECT_DIR:-$PWD}"
}

_pf_env_key() {
	printf '%s' "$1" | cksum | awk '{ print $1 "-" $2 }'
}

_pf_env_pointer_path() { printf '%s/project/%s\n' "$(_pf_env_state_root)" "$(_pf_env_key "$1")"; }
_pf_env_session_dir() { printf '%s/session/%s\n' "$(_pf_env_state_root)" "$1"; }
_pf_env_values_path() { printf '%s/env\n' "$(_pf_env_session_dir "$1")"; }

# Sleep one tick (0.1 s) and count it in _pf_e_ticks; where sleep takes whole
# seconds only, sleep 1 and count ten.
_pf_env_nap() {
	if sleep 0.1 2>/dev/null; then
		_pf_e_ticks=$((_pf_e_ticks + 1))
	else
		sleep 1
		_pf_e_ticks=$((_pf_e_ticks + 10))
	fi
}

# Take the lock in session directory $1: mkdir with bounded retry (about 5 s).
# A lock older than 10 s, or one whose at file is still missing after 2 s, is
# stale and removed. On timeout, log and go on without it. Always returns 0.
_pf_env_lock() {
	_pf_e_lk="$1/lock"
	_pf_e_held=
	(umask 077 && mkdir -p "$1") 2>/dev/null || return 0
	_pf_e_ticks=0
	_pf_e_noat=0
	while [ "$_pf_e_ticks" -lt 50 ]; do
		if mkdir "$_pf_e_lk" 2>/dev/null; then
			date +%s >"$_pf_e_lk/at" 2>/dev/null || :
			_pf_e_held=1
			return 0
		fi
		_pf_e_at=$(cat "$_pf_e_lk/at" 2>/dev/null) || _pf_e_at=
		case $_pf_e_at in
		'' | *[!0123456789]*)
			_pf_e_noat=$((_pf_e_noat + 1))
			if [ "$_pf_e_noat" -gt 20 ]; then
				_pf_env_debug "removing a lock with no time as stale"
				rm -f "$_pf_e_lk/at" 2>/dev/null
				rmdir "$_pf_e_lk" 2>/dev/null
				_pf_e_noat=0
				continue
			fi
			;;
		*)
			_pf_e_now=$(date +%s 2>/dev/null) || _pf_e_now=$_pf_e_at
			if [ $((_pf_e_now - _pf_e_at)) -gt 10 ]; then
				_pf_env_debug "removing a stale lock"
				rm -f "$_pf_e_lk/at" 2>/dev/null
				rmdir "$_pf_e_lk" 2>/dev/null
				continue
			fi
			;;
		esac
		_pf_env_nap
	done
	_pf_env_log "the session values lock is held too long; writing without it"
	return 0
}

_pf_env_unlock() {
	if [ "${_pf_e_held:-}" = 1 ]; then
		rm -f "$_pf_e_lk/at" 2>/dev/null
		rmdir "$_pf_e_lk" 2>/dev/null
	fi
	_pf_e_held=
	return 0
}

# 0 when NAME $2 is listed in the set file of session directory $1.
_pf_env_was_set() {
	[ -r "$1/set" ] || return 1
	while IFS= read -r _pf_e_sl || [ -n "$_pf_e_sl" ]; do
		[ "$_pf_e_sl" != "$2" ] || return 0
	done <"$1/set"
	return 1
}

# Under the caller's lock: the names the set file lists keep their value from the
# values file in session directory $1 (a same-id SessionStart rerun).
_pf_env_keep_set() {
	[ -r "$1/set" ] && [ -r "$1/env" ] || return 0
	while IFS= read -r _pf_e_l || [ -n "$_pf_e_l" ]; do
		_pf_e_k=${_pf_e_l%%=*}
		[ "$_pf_e_k" != "$_pf_e_l" ] || continue
		_pf_env_declared "$_pf_e_k" || continue
		_pf_env_was_set "$1" "$_pf_e_k" || continue
		_pf_e_v=${_pf_e_l#*=}
		eval "_pf_env_val_$_pf_e_k=\$_pf_e_v"
	done <"$1/env"
	return 0
}

# The session id the pointer for project $1 names, when it names this very project.
_pf_env_pointer_read() {
	_pf_e_f=$(_pf_env_pointer_path "$1")
	[ -r "$_pf_e_f" ] || return 1
	_pf_e_ps=
	_pf_e_pd=
	{
		IFS= read -r _pf_e_ps || :
		IFS= read -r _pf_e_pd || :
	} <"$_pf_e_f" 2>/dev/null || return 1
	[ "$_pf_e_pd" = "$1" ] || return 1
	_pf_env_valid_id "$_pf_e_ps" || return 1
	printf '%s\n' "$_pf_e_ps"
}

# Every declared name back to its config default; nothing marked as read from a file.
_pf_env_init() {
	for _pf_e_n in $_pf_env_names; do
		_pf_env_declared "$_pf_e_n" || continue
		eval "_pf_env_val_$_pf_e_n=\${_pf_env_default_$_pf_e_n:-}; _pf_env_got_$_pf_e_n="
	done
}

# Parse a .env file into the current values: KEY=value or export KEY=value,
# one matching pair of quotes stripped, nothing expanded, declared names only.
_pf_env_dotenv() {
	[ -e "$1" ] || return 0
	if [ ! -f "$1" ] || [ ! -r "$1" ]; then
		_pf_env_log "cannot read $1; skipped"
		return 0
	fi
	while IFS= read -r _pf_e_l || [ -n "$_pf_e_l" ]; do
		_pf_e_l=${_pf_e_l%"$_pf_env_cr"}
		_pf_e_l=${_pf_e_l#"${_pf_e_l%%[! 	]*}"}
		case $_pf_e_l in
		'export '* | 'export	'*)
			_pf_e_l=${_pf_e_l#export}
			_pf_e_l=${_pf_e_l#"${_pf_e_l%%[! 	]*}"}
			;;
		esac
		_pf_e_k=${_pf_e_l%%=*}
		[ "$_pf_e_k" != "$_pf_e_l" ] || continue
		_pf_env_declared "$_pf_e_k" || continue
		_pf_e_v=${_pf_e_l#*=}
		case $_pf_e_v in
		\"*\")
			_pf_e_v=${_pf_e_v#\"}
			_pf_e_v=${_pf_e_v%\"}
			;;
		\'*\')
			_pf_e_v=${_pf_e_v#\'}
			_pf_e_v=${_pf_e_v%\'}
			;;
		esac
		eval "_pf_env_val_$_pf_e_k=\$_pf_e_v"
	done <"$1"
	return 0
}

# The ambient values captured when this file was sourced (rung 5).
_pf_env_ambient() {
	for _pf_e_n in $_pf_env_names; do
		_pf_env_declared "$_pf_e_n" || continue
		eval "_pf_e_h=\${_pf_env_hasamb_$_pf_e_n:-}"
		[ "$_pf_e_h" = 1 ] || continue
		eval "_pf_e_v=\${_pf_env_amb_$_pf_e_n:-}"
		case $_pf_e_v in
		*"$_pf_env_nl"*)
			_pf_env_log "ambient $_pf_e_n holds a newline; ignored"
			continue
			;;
		esac
		eval "_pf_env_val_$_pf_e_n=\$_pf_e_v"
	done
	return 0
}

# Rungs 3-5 over the current values, for project $1 (none when empty).
_pf_env_live() {
	if [ -n "${1:-}" ]; then
		_pf_env_dotenv "$1/.env"
		_pf_env_dotenv "$1/.env.local"
	fi
	_pf_env_ambient
}

# Read a session values file over the current values, marking each name it holds.
_pf_env_read_values() {
	while IFS= read -r _pf_e_l || [ -n "$_pf_e_l" ]; do
		_pf_e_k=${_pf_e_l%%=*}
		[ "$_pf_e_k" != "$_pf_e_l" ] || continue
		_pf_env_declared "$_pf_e_k" || continue
		_pf_e_v=${_pf_e_l#*=}
		eval "_pf_env_val_$_pf_e_k=\$_pf_e_v; _pf_env_got_$_pf_e_k=1"
	done <"$1"
	return 0
}

# Every declared name not marked as read from the values file.
_pf_env_missing() {
	for _pf_e_n in $_pf_env_names; do
		_pf_env_declared "$_pf_e_n" || continue
		eval "_pf_e_g=\${_pf_env_got_$_pf_e_n:-}"
		[ "$_pf_e_g" = 1 ] || return 0
	done
	return 1
}

# Export the current values into this shell.
_pf_env_apply() {
	for _pf_e_n in $_pf_env_names; do
		_pf_env_declared "$_pf_e_n" || continue
		eval "$_pf_e_n=\${_pf_env_val_$_pf_e_n:-}"
		export "${_pf_e_n?}"
	done
	return 0
}

# Print $1 single-quoted for a shell, with no newline after it.
_pf_env_squote() {
	_pf_e_r=$1
	_pf_e_o=
	while :; do
		case $_pf_e_r in
		*\'*)
			_pf_e_o="$_pf_e_o${_pf_e_r%%\'*}'\\''"
			_pf_e_r=${_pf_e_r#*\'}
			;;
		*)
			_pf_e_o="$_pf_e_o$_pf_e_r"
			break
			;;
		esac
	done
	printf "'%s'" "$_pf_e_o"
}

# Append `export NAME='value'` for each NAME given, from the current values, to CLAUDE_ENV_FILE.
# Only on Claude, and only when the host set CLAUDE_ENV_FILE.
_pf_env_claude_export() {
	[ "${PLUGINFINITY_HOST:-}" = claude ] || return 0
	if [ -z "${CLAUDE_ENV_FILE:-}" ]; then
		_pf_env_log "CLAUDE_ENV_FILE is not set; the Bash tool will not see the session values"
		return 0
	fi
	for _pf_e_n in "$@"; do
		eval "_pf_e_v=\${_pf_env_val_$_pf_e_n:-}"
		{
			printf 'export %s=' "$_pf_e_n"
			_pf_env_squote "$_pf_e_v"
			printf '\n'
		} >>"$CLAUDE_ENV_FILE" 2>/dev/null || {
			_pf_env_log "cannot append to CLAUDE_ENV_FILE"
			return 0
		}
	done
	return 0
}

# Write the current values of every declared name to values file $1, atomically.
_pf_env_write_values() {
	_pf_e_d=$(dirname -- "$1")
	(umask 077 && mkdir -p "$_pf_e_d") 2>/dev/null || {
		_pf_env_log "cannot create $_pf_e_d; session values not written"
		return 1
	}
	_pf_e_t="$1.tmp.$$"
	(
		umask 077
		for _pf_e_n in $_pf_env_names; do
			_pf_env_declared "$_pf_e_n" || continue
			eval "_pf_e_v=\${_pf_env_val_$_pf_e_n:-}"
			printf '%s=%s\n' "$_pf_e_n" "$_pf_e_v"
		done >"$_pf_e_t"
	) 2>/dev/null && mv -f "$_pf_e_t" "$1" 2>/dev/null && return 0
	rm -f "$_pf_e_t" 2>/dev/null
	_pf_env_log "cannot write $1"
	return 1
}

env_load() {
	_pf_env_arg_sid=${1:-}
	_pf_env_arg_proj=${2:-}
	_pf_env_sid=
	_pf_env_file=
	[ -n "$_pf_env_names" ] || return 0
	case $_pf_env_arg_proj in
	-) _pf_env_proj= ;;
	'') _pf_env_proj=$(_pf_env_script_project) ;;
	*) _pf_env_proj=$_pf_env_arg_proj ;;
	esac
	if [ -n "$_pf_env_arg_sid" ]; then
		if _pf_env_valid_id "$_pf_env_arg_sid"; then
			_pf_env_sid=$_pf_env_arg_sid
		else
			_pf_env_log "invalid session id; session values not read"
		fi
	elif [ -n "${CLAUDE_CODE_SESSION_ID:-}" ] && _pf_env_valid_id "$CLAUDE_CODE_SESSION_ID" &&
		[ -e "$(_pf_env_values_path "$CLAUDE_CODE_SESSION_ID")" ]; then
		# Claude gives a skill script and a monitor CLAUDE_CODE_SESSION_ID, so prefer
		# its own session over the pointer, which names the project's latest one.
		# It equals the hook session_id (measured on Claude Code 2.1.291); an id
		# whose values file is missing falls back to the pointer. Copilot sets no
		# such variable for a script, so it always takes the pointer.
		_pf_env_sid=$CLAUDE_CODE_SESSION_ID
	elif [ -n "$_pf_env_proj" ] && _pf_e_s=$(_pf_env_pointer_read "$_pf_env_proj"); then
		_pf_env_sid=$_pf_e_s
	fi
	[ -z "$_pf_env_sid" ] || _pf_env_file=$(_pf_env_values_path "$_pf_env_sid")
	# In SessionStart a parallel runner may not have finished: wait for its done marker.
	if [ -n "$_pf_env_arg_sid" ] && [ -n "$_pf_env_file" ] && [ ! -e "$_pf_env_file" ] &&
		[ "${PLUGINFINITY_EVENT:-}" = SessionStart ]; then
		_pf_e_done="$(_pf_env_session_dir "$_pf_env_sid")/done"
		_pf_e_ticks=0
		while [ ! -e "$_pf_e_done" ] && [ "$_pf_e_ticks" -lt 30 ]; do _pf_env_nap; done
		[ -e "$_pf_e_done" ] || _pf_env_log "the env runner had not finished after 3s; resolving live"
	fi
	_pf_env_init
	if [ -n "$_pf_env_file" ] && [ -r "$_pf_env_file" ]; then
		_pf_env_read_values "$_pf_env_file"
		if _pf_env_missing; then
			# A name the file lacks (declared after SessionStart) resolves live; file values win.
			_pf_env_init
			_pf_env_live "$_pf_env_proj"
			_pf_env_read_values "$_pf_env_file"
		fi
	else
		_pf_env_debug "no session values; resolving live"
		_pf_env_live "$_pf_env_proj"
	fi
	_pf_env_apply
	return 0
}

env_reload() {
	env_load "${_pf_env_arg_sid:-}" "${_pf_env_arg_proj:-}"
}

_pf_env_set() {
	_pf_e_sn=${1:-}
	_pf_e_sv=${2-}
	if ! _pf_env_declared "$_pf_e_sn"; then
		_pf_env_log "cannot set $_pf_e_sn: not a declared session variable"
		return 1
	fi
	case $_pf_e_sv in
	*"$_pf_env_nl"*)
		_pf_env_log "cannot set $_pf_e_sn: the value holds a newline"
		return 1
		;;
	esac
	if [ -z "${_pf_env_file:-}" ]; then
		_pf_env_log "cannot set $_pf_e_sn: no session"
		return 1
	fi
	# Under the lock, keep every other name as the file has it (a name it lacks keeps
	# its resolved value), then record NAME as set at rung 6.
	_pf_e_sd=$(dirname -- "$_pf_env_file")
	_pf_env_lock "$_pf_e_sd"
	if [ -r "$_pf_env_file" ]; then _pf_env_read_values "$_pf_env_file"; fi
	eval "_pf_env_val_$_pf_e_sn=\$_pf_e_sv"
	if ! _pf_env_write_values "$_pf_env_file"; then
		_pf_env_unlock
		return 1
	fi
	if ! _pf_env_was_set "$_pf_e_sd" "$_pf_e_sn"; then
		(umask 077 && printf '%s\n' "$_pf_e_sn" >>"$_pf_e_sd/set") 2>/dev/null ||
			_pf_env_log "cannot record $_pf_e_sn in the set file"
	fi
	_pf_env_unlock
	eval "$_pf_e_sn=\$_pf_e_sv"
	export "${_pf_e_sn?}"
	_pf_env_claude_export "$_pf_e_sn"
	return 0
}

# Capture the ambient values once, before anything here exports a declared name.
if [ "${_pf_env_captured:-}" != 1 ]; then
	_pf_env_captured=1
	for _pf_e_n in $_pf_env_names; do
		_pf_env_declared "$_pf_e_n" || continue
		eval "_pf_e_h=\${$_pf_e_n+x}"
		if [ "$_pf_e_h" = x ]; then
			eval "_pf_env_amb_$_pf_e_n=\$$_pf_e_n; _pf_env_hasamb_$_pf_e_n=1"
		else
			eval "_pf_env_hasamb_$_pf_e_n="
		fi
	done
fi

if [ "${_pf_env_manual:-}" != 1 ]; then
	env_load
fi
:
