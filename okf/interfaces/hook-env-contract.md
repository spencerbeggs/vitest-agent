---
type: Interface
title: Claude Code hook environment contract
description: The VITEST_AGENT_* environment surface a Claude Code hook, the sidecar, or a dispatched subagent may rely on — the canonical UUIDs, the sidecar bin path, the CLI override, the resolution order, the PreToolUse allowlist, and the SubagentStop state-file pairing.
kind: runtime
resource: ../../plugins/claude-code/hooks
status: stable
tags:
  - tdd
  - dx
  - compat
sources:
  - id: session-start-sh
    resource: ../../plugins/claude-code/hooks/session/start.sh
  - id: detect-pm-sh
    resource: ../../plugins/claude-code/hooks/lib/detect-pm.sh
  - id: source-session-env-sh
    resource: ../../plugins/claude-code/hooks/lib/source-session-env.sh
  - id: allowlist
    resource: ../../plugins/claude-code/hooks/lib/safe-mcp-vitest-agent-ops.txt
  - id: pre-tool-use-mcp-sh
    resource: ../../plugins/claude-code/hooks/pre-tool-use/mcp.sh
  - id: bash-hook-sh
    resource: ../../plugins/claude-code/hooks/pre-tool-use/bash.sh
  - id: start-tdd-sh
    resource: ../../plugins/claude-code/hooks/subagent/start-tdd.sh
  - id: stop-tdd-sh
    resource: ../../plugins/claude-code/hooks/subagent/stop-tdd.sh
  - id: end-record-worker-sh
    resource: ../../plugins/claude-code/hooks/session/end-record-worker.sh
generated:
  by: okfit/claude-code
  at: 2026-09-25T17:01:39Z
  body_sha256: 10a2def6fe210a43d23993edfd968abeea0a58953ba3c68ac90c176a5894b092
---

# Claude Code hook environment contract

## What stays stable

Any hook script, the sidecar binary, or a dispatched subagent may rely on
these `VITEST_AGENT_*` environment variables being present after
`SessionStart` has run, on the resolution order the CLI-locating helper
follows, on the allowlist file's line format, and on the SubagentStop
state-file pairing shape. These are the promises this surface keeps stable
across changes to the hooks that populate it.

## The eight canonical exports

`session/start.sh` writes eight exports after `agent register-agent` (the
first seven) and `agent sidecar-path` (the eighth) resolve, `printf '%q'`
quoted so spaces, quotes, and newlines survive downstream
sourcing[^session-start-sh]:

```sh
export VITEST_AGENT_CHAT_ID="..."
export VITEST_AGENT_CONVERSATION_ID="..."
export VITEST_AGENT_MAIN_AGENT_ID="..."
export VITEST_AGENT_AGENT_ID="..."
export VITEST_AGENT_PROJECT_DIR="..."
export VITEST_AGENT_DATA_DIR="${CLAUDE_PLUGIN_DATA}"
export VITEST_AGENT_PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT}"
export VITEST_AGENT_SIDECAR_BIN="/abs/path/to/vitest-agent-sidecar"  # omitted when not resolvable
```

The four UUIDs (`CHAT_ID`, `CONVERSATION_ID`, `MAIN_AGENT_ID`, `AGENT_ID`)
are the canonical identifiers every attribution path keys on — a
consumer never needs to call an MCP tool to look up "the current session"
because these are already in the environment before any tool call happens.
`VITEST_AGENT_SIDECAR_BIN` is an absolute path to the platform-native
`vitest-agent-sidecar` binary and is **omitted entirely**, not set empty,
when the platform is unsupported or the optional dependency was skipped —
a consumer must treat an unset variable and an empty one as the same
"not available" signal.

**Writes go to two surfaces**, and a consumer needing the exports outside a
Bash-tool subprocess or the MCP server child must read from the second
one:

- `${CLAUDE_ENV_FILE}` — host-controlled, fire-order-numbered filename
  (typically `sessionstart-hook-N.sh`); Claude Code auto-sources this into
  Bash tool subprocesses and the MCP server child, but **not** into other
  hook subprocesses.
- `~/.claude/session-env/${chat_id}/vitest-agent-hook.sh` — a known
  filename other plugin hooks source explicitly via
  `source-session-env.sh`.

Both writes are idempotent on resume via a `grep -q` guard, so re-running
`SessionStart` on a resumed session does not duplicate exports.

**`export` is mandatory.** A bare `KEY=VAL` line sourced from either file
becomes a shell-script local, not an exported variable, and does not
propagate to any subprocess. A hook or script that reads one of these
values must confirm it was written with `export`, not assume the presence
of the line is enough.

## Reading the exports outside SessionStart

`PreToolUse`, `SubagentStart`, and every other non-`SessionStart` hook does
**not** receive `${CLAUDE_ENV_FILE}` auto-sourcing. Such a hook must source
`hooks/lib/source-session-env.sh` and call `source_session_env
"$session_id"` at entry[^source-session-env-sh]. The helper validates the
session-id shape (rejecting path separators, dot-paths, empty values, and
embedded CR/LF/tab — the id comes from untrusted hook-envelope JSON) before
walking `~/.claude/session-env/${session_id}/*hook*.sh` and sourcing every
match; the glob also picks up the host's own `sessionstart-hook-N.sh`
files as redundancy. A consumer of this helper gets the union of every
plugin's `SessionStart` exports, not only this plugin's — the filter is
`*hook*.sh`, not a vitest-agent-specific name.

## `VITEST_AGENT_SIDECAR_BIN`

Set once per session by `session/start.sh` via `vitest-agent agent
sidecar-path`[^session-start-sh]. A consumer (the PreToolUse Bash hook's
Layer 2) reads this variable directly rather than probing `PATH`, because
pnpm and npm only hoist *direct*-dependency bins into
`node_modules/.bin/` — a transitive `optionalDependencies` bin such as the
platform-specific sidecar package is never placed there, so a `command -v
vitest-agent-sidecar` probe always misses. The contract for a consumer:
check the variable is both non-empty and points at an executable file
before exec'ing it; when either check fails, fall back to `vitest-agent
agent inject-env` through the CLI resolution order below — the two paths
are guaranteed to produce byte-identical rewritten output because both run
the same pure `injectEnv` logic. See [the Claude Code plugin
module](../modules/claude-code-plugin.md) for the three-layer pipeline this
variable is Layer 2 of, and [the sidecar module](../modules/sidecar.md) for
the binary itself.

## `VITEST_AGENT_CLI_CMD` override and CLI resolution order

Every hook that shells out to the CLI resolves it through
`detect_vitest_agent_bin` in `hooks/lib/detect-pm.sh`, in this
order[^detect-pm-sh]:

1. `$VITEST_AGENT_CLI_CMD` verbatim, when non-empty — an explicit operator
   or test-harness override, echoed unquoted by call sites.
2. The **relative** path `node_modules/.bin/vitest-agent`, when
   `$cwd/node_modules/.bin/vitest-agent` is executable — the carrier's bin,
   present whenever `@vitest-agent/plugin` is installed. This rung
   deliberately returns a relative path, not an absolute one: call sites
   expand the result unquoted (required so rung 1, which may be
   multi-word, still splits correctly), so an absolute path containing a
   space would word-split and the bin would silently never run. Every call
   site therefore wraps the invocation in a load-bearing `cd "$cwd" &&`.
3. `vitest-agent` on `PATH`.
4. Otherwise the function returns `1` and prints nothing. Every call site
   must handle that by emitting its own no-op output and exiting `0`, so a
   missing CLI never blocks a tool call.

Hooks never dispatch through a package manager (`<pm> exec`) and never
fall back to `npx`: a hook fires far more often than the MCP server
starts, and a silent download or a dispatch that depends on which
package manager is installed is not acceptable on that path.

A consumer adding a new hook that needs the CLI must route through this
function rather than hard-coding a path or a package-manager command —
sixteen scripts (the fifteen hooks plus `bin/start-mcp.sh`'s own,
independent `.bin`-first preference for `vitest-agent-mcp`) already depend
on this exact order holding.

## The PreToolUse allowlist

`hooks/lib/safe-mcp-vitest-agent-ops.txt` is the contract a caller of the
MCP server relies on for which tool calls are auto-permitted without a
confirmation prompt[^allowlist]. Format: one operation name per line,
blank lines and `#`-prefixed comments stripped before an exact-match
lookup. The action-keyed consolidated tools (`tdd_task`, `tdd_goal`,
`tdd_behavior`, `note`, `hypothesis`, `inventory`, `test`) are listed
alongside `register_agent` and `tdd_artifact_list`. Listing a consolidated
tool name here does **not** allow every action inside it unconditionally —
`pre-tool-use/tdd-restricted.sh` separately inspects `tool_input.action`
on `tdd_goal`/`tdd_behavior` and denies `delete` regardless of allowlist
presence[^pre-tool-use-mcp-sh]. A caller must not infer "this tool is
listed, therefore every action on it is permission-free"; the allowlist
only ever widens which *tool names* skip the prompt, never which actions.
A newly deployed non-destructive MCP tool must be added here to get the
same treatment; a delete-capable tool must stay absent.

## State-file pairing for SubagentStop

Claude Code's `SubagentStop` hook payload carries `agent_type` but not the
`agentId` minted at the matching `SubagentStart` — a consumer cannot end
the right `agents` row from the stop payload alone. The bridge is a
per-dispatch state file:

- `subagent/start-tdd.sh` writes one file per dispatch to
  `~/.claude/session-env/${chat_id}/active-subagents/<ts>-<pid>.json`,
  holding `agentId`, `agentType`, `syntheticKey`, and
  `startedAt`[^start-tdd-sh].
- `subagent/stop-tdd.sh` pairs on `agentType`, matching the **oldest
  unconsumed** start file with the current stop (sorted by mtime
  ascending), reads `agentId` from the matched file, calls `vitest-agent
  agent end-agent` with that id, and removes the file[^stop-tdd-sh].
  Pairing is deterministic for sequential same-type dispatches and only
  approximate for concurrent same-type dispatches, though the ended-agent
  count stays correct either way.
- `session/end-record-worker.sh` removes the whole `active-subagents/`
  directory for the closing `chat_id` as janitorial cleanup, so a file
  orphaned by a crashed stop hook does not accumulate
  indefinitely[^end-record-worker-sh].

A consumer relying on this pairing must not assume a 1:1 timing guarantee
under concurrent same-type subagent dispatches — only that the file exists
between `SubagentStart` and a successful `SubagentStop`, and that stale
files are swept at session end.

## What a hook may rely on

- The eight canonical exports are present in both write-target files by
  the time any post-`SessionStart` hook or tool call runs, with
  `VITEST_AGENT_SIDECAR_BIN` being the one exception that may be absent.
- `detect_vitest_agent_bin`'s order (override, local `.bin`, `PATH`, fail
  open) never changes without every
  call site being updated in the same change — a hook must not special-case
  its own resolution.
- The allowlist grants tool-name-level auto-permission only; action-level
  gating is a separate, independently-checked hook.
- A `SubagentStart` state file exists for the lifetime of its dispatch and
  is guaranteed removed by session end, whether or not its matching
  `SubagentStop` ever fires cleanly.

See [Decision D17](../decisions/d17-claude-env-file-auto-source-and-hook-self-source-bridge.md)
and [Decision D18](../decisions/d18-per-instance-identity-from-claude-plugin-data-and-session-id.md)
for why this surface is shaped the way it is, and [the Claude Code plugin
module](../modules/claude-code-plugin.md) for how the rest of the plugin
consumes it.

[^session-start-sh]: `plugins/claude-code/hooks/session/start.sh:118` (canonical exports), `plugins/claude-code/hooks/session/start.sh:161` (sidecar-path resolution)
[^detect-pm-sh]: `plugins/claude-code/hooks/lib/detect-pm.sh:37` (`detect_vitest_agent_bin`)
[^source-session-env-sh]: `plugins/claude-code/hooks/lib/source-session-env.sh:28` (`source_session_env`)
[^allowlist]: `plugins/claude-code/hooks/lib/safe-mcp-vitest-agent-ops.txt`
[^pre-tool-use-mcp-sh]: `plugins/claude-code/hooks/pre-tool-use/mcp.sh`
[^start-tdd-sh]: `plugins/claude-code/hooks/subagent/start-tdd.sh:136`
[^stop-tdd-sh]: `plugins/claude-code/hooks/subagent/stop-tdd.sh:43`
[^end-record-worker-sh]: `plugins/claude-code/hooks/session/end-record-worker.sh`
