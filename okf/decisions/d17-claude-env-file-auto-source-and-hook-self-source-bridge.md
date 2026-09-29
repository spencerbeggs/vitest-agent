---
type: Decision
title: CLAUDE_ENV_FILE Auto-Source and Hook Self-Source Bridge
description: Claude Code auto-sources CLAUDE_ENV_FILE only into Bash-tool subprocesses and the MCP server child, not into other hook subprocesses; every non-SessionStart hook bridges that gap by self-sourcing the per-session env files a shared library walks.
status: stable
tags:
  - architecture
  - dx
generated:
  by: okfit/claude-code
  at: 2026-09-29T20:39:41Z
  body_sha256: d22ca403fbbca7c93df8d6f74fa055647f1df31c57595be130f0a137d9e4839f
sources:
  - id: hooks-source-session-env
    resource: ../../plugins/claude-code/hooks/lib/source-session-env.sh
  - id: hooks-session-start
    resource: ../../plugins/claude-code/hooks/session/start.sh
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
---

# CLAUDE_ENV_FILE Auto-Source and Hook Self-Source Bridge

## Context

Claude Code's env-propagation surface, mapped empirically against the
running host, has an asymmetric shape:

- `SessionStart` (and `Setup`, `CwdChanged`, `FileChanged`) hooks have
  `${CLAUDE_ENV_FILE}` available and write `export KEY=VAL` lines to it.
  Files land at `~/.claude/session-env/<session_id>/sessionstart-hook-N.sh`,
  one file per plugin.
- Bash tool subprocesses and the MCP server child inherit the union of
  all plugins' exports automatically — Claude Code sources the directory
  when spawning these.
- Every other hook subprocess (`PreToolUse`, `SubagentStart`, etc.) does
  **not** auto-receive that sourcing. Per Claude Code's own docs,
  `CLAUDE_ENV_FILE` is available only to `SessionStart`, `Setup`,
  `CwdChanged`, and `FileChanged` hooks; other hook types have no access
  to the variable at all.

Without a bridge, identifiers the plugin needs everywhere — chat id,
conversation id, main agent id, project dir — would be visible to Bash
tool calls and the MCP server but invisible to the hooks that need to
record TDD artifacts, gate phase transitions, or resolve project paths.

## Decision

`plugins/claude-code/hooks/lib/source-session-env.sh` bridges the gap.
Every non-`SessionStart` hook starts by reading its JSON payload, pulling
`session_id` out of it, sourcing the library, and calling
`source_session_env "$session_id"`
(`plugins/claude-code/hooks/lib/source-session-env.sh`). The
function validates the session id shape against path-escape and
shell-glob characters, then walks
`~/.claude/session-env/${session_id}/*hook*.sh` and sources each file it
finds (`plugins/claude-code/hooks/lib/source-session-env.sh`),
temporarily relaxing `errexit` so one plugin's malformed file cannot
abort the sourcing hook mid-walk. After self-sourcing, a hook reads
identifiers from its environment exactly like the reporter, sidecar, and
MCP server do — the four access paths converge on one env-file
mechanism. See [Interface: hook-env-contract](../interfaces/hook-env-contract.md)
for the exported variable names this bridge makes available.

The write side lives in `session/start.sh`: on successful registration it
composes the canonical exports and writes them twice — once to
`$CLAUDE_ENV_FILE` (for the host's own auto-source into Bash/MCP), and
once to `~/.claude/session-env/${chat_id}/vitest-agent-hook.sh`
(`plugins/claude-code/hooks/session/start.sh`), the file the
bridge above walks for every other hook.

**Implementation parity:** the helper mirrors `EnvLoader.loadSessionEnvFiles`
from `claude-binary-plugin` (`packages/src/layers/EnvLoaderLive.ts`) — same
directory walk, same `*hook*.sh` filter — an access pattern already
battle-tested against the same Claude Code surface by another shipped
plugin.

**`export` is mandatory.** Bare `KEY=VAL` lines are sourced as shell-script
locals and do not propagate to the calling hook's environment; this is
documented as a hook invariant rather than left implicit, since a
plugin author who drops `export` produces a silently inert env file.

## Alternatives rejected

Relying on `CLAUDE_ENV_FILE` alone and accepting that non-`SessionStart`
hooks simply lack identifiers was rejected — it would mean every
`PreToolUse`/`PostToolUse` hook that records evidence or resolves project
paths would have to re-derive them from scratch on every invocation
instead of reading them once from `SessionStart`.

## Consequences

The bridge is per-session and file-based rather than a shared daemon or
socket, matching the identity model in
[Decision D18](d18-per-instance-identity-from-claude-plugin-data-and-session-id.md):
`session_id` is the join key, and the files live under a directory keyed
by it. Any future plugin export that needs to reach a non-`SessionStart`
hook writes into the same `~/.claude/session-env/<session_id>/` directory
and the existing bridge picks it up without changes on the read side.
