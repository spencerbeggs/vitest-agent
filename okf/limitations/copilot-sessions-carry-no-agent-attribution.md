---
type: Limitation
title: Copilot sessions carry no agent attribution
description: Under GitHub Copilot the SessionStart hook registers no agent, because Copilot sends no transcript_path and HostKind has no copilot value, so the session ids stay unset; the TDD-scoped hooks key on agent_type, which is unmeasured on Copilot and may never fire.
bounds: ../interfaces/hook-env-contract.md
status: draft
tags:
  - tdd
  - compat
generated:
  by: okfit/claude-code
  at: 2026-10-10T02:40:34Z
  body_sha256: 9e54f485c84e830734b84bd7de4ede6f897bd277dd2cca508900e5e7c3206373
sources:
  - id: session-start-sh
    resource: ../../plugin/hooks/session/start.sh
  - id: common-sh
    resource: ../../plugin/hooks/lib/vitest-agent/common.sh
  - id: identity-schema
    resource: ../../packages/sdk/src/schemas/Identity.ts
  - id: pr-585
    resource: https://github.com/spencerbeggs/vitest-agent/pull/585
---

# Copilot sessions carry no agent attribution

## Trigger and symptom

The trigger is any GitHub Copilot session with the `plugin/builds/copilot`
plugin loaded. The recording hooks still write session and turn rows, but
no `agents` row is created for the main agent. `VITEST_AGENT_CHAT_ID`,
`_CONVERSATION_ID`, `_MAIN_AGENT_ID`, and `_AGENT_ID` stay unset for the
whole session, so runs, artifacts, and TDD rows carry no agent id. Inside
a `tdd-task` dispatch, the evidence-recording and restriction hooks may
not fire at all. The TDD phase gates then deny transitions for missing
evidence.

## Cause

- `session/start.sh` calls `agent register-agent` only when the payload
  carries a `transcript_path`, which only Claude Code sends. Without
  registration it sets none of the id session values.[^session-start-sh]
- The SDK's `HostKind` literal union lists `claude-code`,
  `claude-desktop`, `cursor`, `goose`, `chatgpt`, `mcp-inspector`, and
  `unknown`; it has no `copilot` value to register a Copilot agent
  under.[^identity-schema]
- The TDD-scoped hooks (`pre-tool-use/tdd-restricted.sh`,
  `pre-tool-use/bash-tdd.sh`, `post-tool-use/tdd-artifact.sh`,
  `post-tool-use/test-quality.sh`, and the `SubagentStart` /
  `SubagentStop` pair) gate on `va_is_tdd_agent "$agent_type"`, matching
  `vitest-agent:tdd-task`.[^common-sh] Whether Copilot's hook payloads carry
  `agent_type`, and how they spell it, has not been measured.[^pr-585]

## Why it is acceptable for now

Claude Code is the primary host, and attribution there is unchanged. On
Copilot the hooks fail open: a missing id or an unmatched agent type
produces a no-op rather than a blocked tool call.

## What a fix would take

Add a `copilot` member to `HostKind`, which is a change to a public SDK
schema. Teach `register-agent` to register without a transcript path.
Measure Copilot's `agent_type` in a live session and widen
`va_is_tdd_agent` to match it.

## Related

- [Limitation: The Copilot MCP server cannot locate the project](copilot-mcp-server-cannot-locate-the-project.md)
- [Decision 82 — Session Values Through pluginfinity Session Env](../decisions/82-session-values-through-pluginfinity-session-env.md)

[^session-start-sh]: `../../plugin/hooks/session/start.sh`
[^common-sh]: `../../plugin/hooks/lib/vitest-agent/common.sh`
[^identity-schema]: `../../packages/sdk/src/schemas/Identity.ts`
[^pr-585]: <https://github.com/spencerbeggs/vitest-agent/pull/585>
