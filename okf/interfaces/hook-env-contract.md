---
type: Interface
title: Agent plugin hook environment contract
description: The VITEST_AGENT_* environment surface a hook in the agent plugin, the sidecar, or a dispatched subagent may rely on, covering the pluginfinity session values, the MCP server's recovery file, CLI resolution, the PreToolUse allow list, and SubagentStop state-file pairing.
kind: runtime
resource: ../../plugin/hooks
status: draft
tags:
  - tdd
  - dx
  - compat
sources:
  - id: pluginfinity-config
    resource: ../../plugin/pluginfinity.config.ts
  - id: session-start-sh
    resource: ../../plugin/hooks/session/start.sh
  - id: common-sh
    resource: ../../plugin/hooks/lib/vitest-agent/common.sh
  - id: allowlist
    resource: ../../plugin/hooks/lib/vitest-agent/safe-mcp-ops.txt
  - id: pre-tool-use-mcp-sh
    resource: ../../plugin/hooks/pre-tool-use/mcp.sh
  - id: bash-hook-sh
    resource: ../../plugin/hooks/pre-tool-use/bash.sh
  - id: start-tdd-sh
    resource: ../../plugin/hooks/subagent/start-tdd.sh
  - id: stop-tdd-sh
    resource: ../../plugin/hooks/subagent/stop-tdd.sh
  - id: end-record-worker-sh
    resource: ../../plugin/hooks/session/end-record-worker.sh
  - id: engine-session-env
    resource: ../../packages/engine/src/programs/session-env.ts
generated:
  by: okfit/claude-code
  at: 2026-10-10T02:40:34Z
  body_sha256: b4ae9dab0a17eb72564690aa844a4c98ffa1a4e9417185f86c6b9d0a6ea76daf
---

# Agent plugin hook environment contract

## What stays stable

A hook script, the sidecar binary, or a dispatched subagent may rely on
four things. The session values below are present after `SessionStart` has
registered the agent. The CLI-resolution order holds. The allow list keeps
its line format. The SubagentStop state-file pairing keeps its shape. The
contract holds on both hosts the plugin builds for, except where a section
says Claude Code only.

## The session values

`pluginfinity.config.ts` declares five pluginfinity session-env values
under `env.vars`, each defaulting to `""`[^pluginfinity-config]:

```sh
VITEST_AGENT_CHAT_ID
VITEST_AGENT_CONVERSATION_ID
VITEST_AGENT_MAIN_AGENT_ID
VITEST_AGENT_AGENT_ID
VITEST_AGENT_SIDECAR_BIN
```

`session/start.sh` sets the four ids with `hook_env_set` after `agent
register-agent` resolves, and sets `VITEST_AGENT_SIDECAR_BIN` after `agent
sidecar-path` resolves[^session-start-sh]. The pluginfinity hook library
loads the values into every later hook, so a hook reads them as plain
variables with no sourcing step. On Claude Code the library also appends
them to `CLAUDE_ENV_FILE`, so the model's Bash tool subprocesses see them.
See [Decision 82](../decisions/82-session-values-through-pluginfinity-session-env.md).

The four ids are the canonical identifiers every attribution path keys on.
A consumer never calls an MCP tool to look up "the current session",
because the ids are already in the environment.

**Unset means not available.** Sourcing `hooks/lib/vitest-agent/common.sh`
unsets every declared name whose value is still `""`[^common-sh]. Before
registration, or when no sidecar resolves, a hook, the CLI, and the
sidecar therefore see the name unset rather than empty. A consumer must
still treat unset and empty as the same signal. Registration needs a
`transcript_path`, which only Claude Code sends, so on Copilot the ids
stay unset for the whole session. See [Limitation: Copilot sessions carry
no agent
attribution](../limitations/copilot-sessions-carry-no-agent-attribution.md).

**`VITEST_AGENT_PROJECT_DIR` is not a session value.** `common.sh` anchors
it to `hook_session_dir` (the session's project root) unless it is already
set, so an explicit per-command value always wins. `VITEST_AGENT_DATA_DIR`
and `VITEST_AGENT_PLUGIN_ROOT` are no longer exported; a hook finds the
plugin data directory with `va_state_dir`.

## The MCP server's recovery file (Claude Code only)

On Claude Code, `session/start.sh` also writes
`~/.claude/session-env/<chat_id>/vitest-agent-hook.sh`, holding `export`
lines for the four ids and `VITEST_AGENT_PROJECT_DIR`, each `printf '%q'`
quoted[^session-start-sh]. The write is guarded by `hook_supports
server-project`, and the chat id is rejected when it contains a path
separator, a dot-path, or a control character. The file is an interface of
the published MCP server, not hook plumbing.
`recoverSessionContextFromSessionEnv` in `@vitest-agent/engine` reads it at
tool-call time to recover attribution after a boot race or
`/reload-plugins`[^engine-session-env]. It stays until the engine reads
pluginfinity's session values directly. No hook reads it.

## `VITEST_AGENT_SIDECAR_BIN`

The PreToolUse Bash hook's Layer 2 reads this value directly rather than
probing `PATH`[^bash-hook-sh]. pnpm and npm hoist only direct-dependency
bins into `node_modules/.bin/`, so the transitive per-platform sidecar
package is never there. A consumer must check that the value is non-empty
and points at an executable before exec'ing it. Otherwise it falls back to
`vitest-agent agent inject-env` through the CLI resolution below. Both
paths run the same pure `injectEnv` and produce byte-identical output. See
[the agent plugin module](../modules/claude-code-plugin.md) for the
three-layer pipeline and [the sidecar module](../modules/sidecar.md) for
the binary.

## `VITEST_AGENT_CLI_CMD` override and CLI resolution order

Every hook that shells out to the CLI resolves it through `va_cli` in
`hooks/lib/vitest-agent/common.sh`, in this order[^common-sh]:

1. `$VITEST_AGENT_CLI_CMD` verbatim, when non-empty. This is an operator
   or test-harness override, expanded unquoted by call sites.
2. The **relative** path `node_modules/.bin/vitest-agent`, when
   `<dir>/node_modules/.bin/vitest-agent` is executable. That is the
   carrier's bin. The path is relative on purpose: call sites expand it
   unquoted, which a multi-word rung 1 requires, so an absolute path with a
   space would word-split. Every call site therefore runs behind a
   load-bearing `cd "<dir>" &&`.
3. `vitest-agent` on `PATH`.
4. Otherwise `va_cli` returns `1` and prints nothing, and the call site
   answers `hook_noop`. A missing CLI never blocks a tool call.

Hooks never dispatch through a package manager and never fall back to
`npx`. A hook fires far more often than the MCP server starts. A new hook
that needs the CLI must route through `va_cli`, never a hard-coded path.

## The PreToolUse allow list

`hooks/lib/vitest-agent/safe-mcp-ops.txt` is the contract for which of this
plugin's MCP tool calls are auto-permitted without a prompt[^allowlist].
The format is one operation name per line, with blank lines and
`#`-prefixed comments stripped before an exact-match lookup. The hook
strips the host's MCP prefix first with `va_mcp_op`. The action-keyed
consolidated tools (`tdd_task`, `tdd_goal`, `tdd_behavior`, `note`,
`hypothesis`, `inventory`, `test`) are listed alongside `register_agent`
and `tdd_artifact_list`. Listing a consolidated tool does **not** allow
every action on it. `pre-tool-use/mcp.sh` reads `tool_input.action` first
and returns no decision when it is `delete`, so a main-agent delete always
reaches the permission prompt[^pre-tool-use-mcp-sh]. Inside the `tdd-task`
subagent, `pre-tool-use/tdd-restricted.sh` denies a `tdd_goal` /
`tdd_behavior` delete outright ([Decision
D13](../decisions/d13-mcp-permits-agent-restricts.md)). The list ships in
the build, so an edit takes effect only after `pluginfinity build`.

## State-file pairing for SubagentStop

A `SubagentStop` payload carries `agent_type` but not the `agentId` minted
at `SubagentStart`. The bridge is a per-dispatch state file:

- `subagent/start-tdd.sh` writes one file per dispatch to
  `<plugin data>/active-subagents/<chat_id>/<ts>-<pid>.json`, where the
  plugin data directory is `va_state_dir`. The file holds `agentId`,
  `agentType`, `syntheticKey`, and `startedAt`[^start-tdd-sh].
- `subagent/stop-tdd.sh` pairs on `agentType` with the **oldest
  unconsumed** file, calls `vitest-agent agent end-agent` with its
  `agentId`, and removes the file[^stop-tdd-sh]. Pairing is deterministic
  for sequential same-type dispatches and approximate for concurrent ones,
  though the ended-agent count stays correct.
- `session/end-record-worker.sh` removes the closing session's
  `active-subagents/<chat_id>/` directory, so a file orphaned by a crashed
  stop hook does not accumulate[^end-record-worker-sh].

## Operator overrides a hook does not export

These `VITEST_*` variables are read by the family's binaries but never
written by a hook; a human (or a hook author debugging) sets them:

- `VITEST_AGENT_AUDIENCE` (`human | agent | ci`) overrides the audience the
  `vitest-agent` CLI detects; the root `--audience` / `--human` / `--agent`
  / `--ci` flags take precedence over it. Inside an agent session the
  CLI detects an agent audience, so `db reset`'s confirmation prompt is
  unreachable without `--yes`, `--human`, or `VITEST_AGENT_AUDIENCE=human`
  — and `VITEST_AGENT_AGENT_ID`, one of the session values above, blocks
  `db reset` outright. See [the CLI interface](cli.md).
- `VITEST_AGENT_CONSOLE` overrides the plugin's console mode for the
  detected executor, matched case-insensitively; a value that executor does
  not accept is ignored with one `[vitest-agent:plugin] ignoring
  VITEST_AGENT_CONSOLE=<value>: …` stderr line per run. See
  [AgentPluginOptions](agent-plugin-options.md).
- `VITEST_REPORTER_LOG_LEVEL` / `VITEST_REPORTER_LOG_FILE` turn on stderr
  diagnostics (and an NDJSON file). The `vitest-agent` CLI's records,
  migration records included, are NDJSON on stderr for an agent or CI
  audience and plain lines for a person (`--human`). The
  plugin's own debug records (NDJSON
  on stderr with component `vitest-agent:plugin`, for a human at a TTY too)
  need `debug`, `trace`, or `all`; a higher level such as `info` leaves them
  silent.

## What a hook may rely on

- The four id session values are set by the time any post-`SessionStart`
  hook or Bash tool call runs, on a host that sends `transcript_path`.
  `VITEST_AGENT_SIDECAR_BIN` may be unset on any host.
- `va_cli`'s order (override, local `.bin`, `PATH`, fail open) never
  changes without every call site changing in the same edit.
- The allow list grants tool-name-level auto-permission for every action
  except `delete`, which `mcp.sh` always leaves to the prompt.
- A `SubagentStart` state file exists for the life of its dispatch and is
  removed by session end at the latest.

See [Decision 82](../decisions/82-session-values-through-pluginfinity-session-env.md)
and [Decision D18](../decisions/d18-per-instance-identity-from-claude-plugin-data-and-session-id.md)
for why this surface is shaped the way it is, and [the agent plugin
module](../modules/claude-code-plugin.md) for how the rest of the plugin
consumes it.

[^pluginfinity-config]: `../../plugin/pluginfinity.config.ts`
[^session-start-sh]: `../../plugin/hooks/session/start.sh`
[^common-sh]: `../../plugin/hooks/lib/vitest-agent/common.sh`
[^engine-session-env]: `../../packages/engine/src/programs/session-env.ts`
[^bash-hook-sh]: `../../plugin/hooks/pre-tool-use/bash.sh`
[^allowlist]: `../../plugin/hooks/lib/vitest-agent/safe-mcp-ops.txt`
[^pre-tool-use-mcp-sh]: `../../plugin/hooks/pre-tool-use/mcp.sh`
[^start-tdd-sh]: `../../plugin/hooks/subagent/start-tdd.sh`
[^stop-tdd-sh]: `../../plugin/hooks/subagent/stop-tdd.sh`
[^end-record-worker-sh]: `../../plugin/hooks/session/end-record-worker.sh`
