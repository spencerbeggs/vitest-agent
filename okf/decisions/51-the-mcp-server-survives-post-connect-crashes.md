---
type: Decision
status: draft
title: The MCP Server Survives Post-Connect Crashes
description: unhandledRejection and uncaughtException guards keep the MCP process alive after a client connects instead of dying mid-session.
tags: [architecture, mcp]
generated:
  by: okfit/claude-code
  at: 2026-09-25T17:01:39Z
  body_sha256: 664ad07983fea8eaa264b3959b2ff01644a5a197a46b5e0d10964b44e176f153
---

# The MCP Server Survives Post-Connect Crashes

## Context

`vitest-agent-mcp` used to be a bare `main().catch(...)` with no
process-level guards. Under Node >= 15 an unhandled rejection anywhere
outside a tool call's own await chain terminates the process, which
closes the stdio transport and silently deregisters every tool from the
client's perspective — mid TDD session, with no recovery path and no
error the agent can act on.

## Decision

`packages/mcp/src/main.ts` registers `unhandledRejection`
(`main.ts:99-101`) and `uncaughtException` (`main.ts:106-115`) handlers
at module scope, before any async work, so they also cover `dbPath`
resolution and runtime construction. A module-level `transportConnected`
flag (`main.ts:27`) starts `false` and flips to `true` once
`server.connect(transport)` resolves (`main.ts:184`).
`unhandledRejection` logs to stderr and continues unconditionally.
`uncaughtException` logs to stderr, then exits only when the transport
has not connected yet — the policy is isolated in the pure
`shouldExitOnUncaughtException(transportConnected)` predicate
(`packages/mcp/src/utils/crash-guards.ts:26-27`, returning
`!transportConnected`) so it is testable and stated in exactly one
place.

**Trade-off accepted.** Surviving an `uncaughtException` contradicts
Node's own "do not resume normal operation" guidance, which exists
because arbitrary in-process state may be corrupt after an uncaught
throw. This process is an unusually good candidate for the exception:
it holds no long-lived mutable state outside SQLite's own transactions,
so a throw cannot leave the next tool call's bookkeeping
half-mutated. Weighed against that residual risk, silent process death
mid-session is the strictly worse outcome — it is the bug being fixed.
Before transport connect the calculus inverts: no client session exists
to preserve, so failing fast and loud beats spinning in a
half-initialized state.

**Scope boundary.** These module-scope guards are not the same layer as
the catch inside the tool-call boundary of Effect's own
`registerToolkit` (reached through `@effected/mcp`'s `McpToolkit.layer`),
which turns a thrown or defected tool handler into a scrubbed
`isError` result ("Tool execution failed due to an internal server
error.") and logs the cause on stderr. A throw
*inside* a tool call is caught at that registration boundary and never
threatens the process; the module-scope guards in `main.ts` exist for
whatever escapes that boundary entirely — a throw during layer
construction, module evaluation, or anywhere else outside a tool call's
own await chain.

## Alternatives rejected

- **A bare `main().catch(...)` with no process-level guards:** the
  status quo before this decision — any unhandled rejection or uncaught
  exception anywhere in the process terminated it, deregistering every
  tool with no diagnostic the agent could act on.
- **Always exiting on `uncaughtException`, matching Node's stock
  guidance:** rejected because this process's state is unusually safe to
  resume from (no long-lived mutable state outside SQLite transactions),
  and a killed mid-session process is a worse failure mode than a
  best-effort continuation.

## Consequences

- A stray throw anywhere outside a tool call's boundary no longer kills
  an active TDD session; the server logs to stderr and keeps serving.
- The crash-guard registration must stay the first thing `main.ts` does,
  ahead of any dynamic import of the server graph, so a throw during
  module evaluation is still reported on stderr instead of crashing
  silently with no diagnostic at all.
- `shouldExitOnUncaughtException` is the one place this policy is
  stated; changing the exit condition means changing this one pure
  function, not hunting through `main.ts`'s event handlers.

## Related

- [Decision 50 — Strict MCP Tool Inputs](./50-strict-mcp-tool-inputs.md)
- [Decision 71 — Effect-Native MCP Server](./71-effect-native-mcp-server.md)
