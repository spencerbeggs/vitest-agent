---
type: Decision
title: Sidecar CLI over mcp_tool Hooks
description: register_agent and its peers cannot be called via Claude Code's mcp_tool hook event, because its input field only substitutes ${path} values from the triggering event's own payload; hooks instead shell out to a CLI sidecar that generates and writes the needed values in one process.
status: stable
tags:
  - architecture
  - tdd
  - dx
generated:
  by: okfit/claude-code
  at: 2026-09-29T20:39:41Z
  body_sha256: a1c9d4bcdff139f61cee7a1cdeeecf7ec7002d3204de4c32ad73fed44c6c6b4b
sources:
  - id: cli-agent-register-agent
    resource: ../../packages/cli/src/commands/agent.ts
  - id: engine-register-agent-program
    resource: ../../packages/engine/src/programs/register-agent.ts
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
---

# Sidecar CLI over mcp_tool Hooks

## Context

Claude Code's `mcp_tool` hook event type lets a hook fire an MCP tool call
directly, but its `input` field only accepts `${path}` substitutions
pulled from the triggering event's own JSON payload. The `register_agent`
flow needs values that do not exist anywhere in that payload:
`clientNonce`, `startGitBranch`, `startGitCommitSha`, and
`startWorktreeDir` are all generated or computed inside the hook itself
(a random nonce, and git context read from the workspace). There is no
substitution syntax that can hand a hook-computed value to an `mcp_tool`
event's declarative input template, so that hook type cannot drive
`register_agent`.

## Decision

Every hook that needs to call `register_agent` (or its peers) shells out
to `vitest-agent agent register-agent`
(`packages/cli/src/commands/agent.ts`), a subcommand of the
`agent` namespace on the existing `@vitest-agent/cli` package — no
separate distribution, no separate release. The subcommand runs Node,
computes `clientNonce` and captures git context via the Effect-side
`RunContext` service inside `registerAgentEffect`
(`packages/engine/src/programs/register-agent.ts`), and
writes through to both the per-project `data.db` and the per-client
session map in a single process. Because the sidecar is a real process
rather than a declarative hook input, it can compute exactly the values
the `mcp_tool` event's substitution syntax cannot express, and pass them
straight into the same registration path the MCP server would otherwise
own.

## Alternatives rejected

- **`mcp_tool` hook event calling `register_agent` directly.** Rejected
  for the reason in Context: the input field cannot carry
  hook-computed values, only substitutions from the triggering payload.
- **A long-running daemon contacted over a Unix-domain socket**, so every
  hook (including the PreToolUse Bash hot path) could make a cheap RPC
  instead of spawning Node. Considered and rejected in favor of the
  three-layer bash prefilter plus a native SEA binary on the residual slow
  path (see [Decision 42](42-three-layer-sidecar-performance-fix.md)) —
  cheaper to operate, with no socket lifecycle or coordination directory
  to manage.

## Consequences

Node cold-start is an acceptable cost for `SessionStart` and
`SubagentStart`, since each fires once per session or subagent. It is
unacceptable for `PreToolUse` Bash interception, which fires on every
Bash tool call — that hot path is deliberately routed around the CLI
sidecar entirely by the three-layer bash prefilter and native SEA binary
from Decision 42, rather than by making the sidecar itself faster. The
sidecar pattern generalizes: any future hook that needs a computed value
an `mcp_tool` substitution cannot express reaches for the same `agent`
namespace rather than a new communication mechanism.
