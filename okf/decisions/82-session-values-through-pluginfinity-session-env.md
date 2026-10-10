---
type: Decision
title: Session Values Through pluginfinity Session Env
description: The plugin's per-session ids and sidecar path are declared in pluginfinity.config.ts and set with hook_env_set, so every later hook reads them as plain variables; the hand-written session-env bridge is gone except one file the published MCP server still reads.
status: stable
supersedes: d17-claude-env-file-auto-source-and-hook-self-source-bridge.md
tags:
  - architecture
  - dx
generated:
  by: okfit/claude-code
  at: 2026-10-10T02:40:34Z
  body_sha256: a33d6ab9b334a212c239e3d8bdca22460e609f476db61588239eed5ecb505567
sources:
  - id: pluginfinity-config
    resource: ../../plugin/pluginfinity.config.ts
  - id: session-start-sh
    resource: ../../plugin/hooks/session/start.sh
  - id: common-sh
    resource: ../../plugin/hooks/lib/vitest-agent/common.sh
  - id: engine-session-env
    resource: ../../packages/engine/src/programs/session-env.ts
verified:
  - by: human:spencer
    at: 2026-10-10T02:23:56Z
---

# Session Values Through pluginfinity Session Env

## Context

Claude Code auto-sources `CLAUDE_ENV_FILE` into Bash tool subprocesses and
the MCP server child, but not into other hook subprocesses. [Decision
D17](d17-claude-env-file-auto-source-and-hook-self-source-bridge.md)
bridged that gap by hand: `SessionStart` wrote the exports twice, and every
other hook called `source_session_env` to walk
`~/.claude/session-env/<session_id>/*hook*.sh`. The bridge was Claude-only.
Copilot has no `CLAUDE_ENV_FILE`, and pluginfinity's hook library ships its
own session-env store that works on both hosts.

## Decision

`pluginfinity.config.ts` declares five session values under `env.vars`,
each defaulting to `""`: `VITEST_AGENT_CHAT_ID`,
`VITEST_AGENT_CONVERSATION_ID`, `VITEST_AGENT_MAIN_AGENT_ID`,
`VITEST_AGENT_AGENT_ID`, and `VITEST_AGENT_SIDECAR_BIN`.[^pluginfinity-config]
`session/start.sh` sets them with `hook_env_set` after `agent
register-agent` and `agent sidecar-path` resolve.[^session-start-sh] The
library loads them into every later hook, so a hook reads them as plain
variables with no sourcing step of its own; on Claude Code the library also
appends them to `CLAUDE_ENV_FILE`, so the model's Bash tool sees them.
`hooks/lib/vitest-agent/common.sh` unsets every declared name whose value is
still `""`, so the CLI and the sidecar keep seeing "unset" until
`SessionStart` has registered the agent, and anchors
`VITEST_AGENT_PROJECT_DIR` to `hook_session_dir`. That name is deliberately
not a session value, so an explicit per-command value still
wins.[^common-sh]

**One hand-written file stays, on Claude Code only.** `session/start.sh`
still writes `~/.claude/session-env/<chat_id>/vitest-agent-hook.sh` with
the four ids and `VITEST_AGENT_PROJECT_DIR`, guarded by `hook_supports
server-project`.[^session-start-sh] It is no longer hook plumbing. It is an
interface of the published MCP server: `@vitest-agent/engine`'s
`recoverSessionContextFromSessionEnv` reads it at tool-call time to recover
attribution after a boot race or `/reload-plugins`.[^engine-session-env]
Retiring it needs the engine to read pluginfinity's session values file
first, then a release of the MCP server.

## Alternatives rejected

- **Keep the `source_session_env` bridge.** Rejected: it reads a
  Claude-only directory, so Copilot hooks would get no ids at all, and it
  duplicates what the library already does on both hosts.
- **Drop the hand-written recovery file with the bridge.** Rejected for
  now: every published MCP server reads that file, and removing it would
  break attribution recovery for installed consumers until the engine is
  changed and released.

## Consequences

- `VITEST_AGENT_DATA_DIR` and `VITEST_AGENT_PLUGIN_ROOT` are no longer
  exported; hooks find the plugin data directory with `va_state_dir`.
- The `SubagentStop` pairing state moved from under
  `~/.claude/session-env/` to `<plugin data>/active-subagents/<chat_id>/`.
- `VITEST_AGENT_TDD_TASK_ID`, `VITEST_AGENT_CLI_CMD`, and
  `VITEST_AGENT_TEST_LOCATION_HOOK` stay ambient overrides, not session
  values.
- [Decision D18](d18-per-instance-identity-from-claude-plugin-data-and-session-id.md)'s
  per-instance identity rule (`session_id` as the join key) is unchanged.

## Related

- [Interface: hook environment contract](../interfaces/hook-env-contract.md)
- [Decision 80 — Build the Agent Plugin from One pluginfinity Source](80-build-the-agent-plugin-from-one-pluginfinity-source.md)

[^pluginfinity-config]: `../../plugin/pluginfinity.config.ts`
[^session-start-sh]: `../../plugin/hooks/session/start.sh`
[^common-sh]: `../../plugin/hooks/lib/vitest-agent/common.sh`
[^engine-session-env]: `../../packages/engine/src/programs/session-env.ts`
