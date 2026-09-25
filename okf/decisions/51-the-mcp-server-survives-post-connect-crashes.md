---
type: Decision
status: draft
title: The MCP Server Survives Post-Connect Crashes
description: unhandledRejection and uncaughtException guards keep the MCP process alive after a client connects instead of dying mid-session.
tags: [architecture, mcp]
generated:
  by: okfit/claude-code
  at: 2026-09-25T23:18:00Z
  body_sha256: 830ad34bb1abd4fd0692a7b94cc1f7262c0ae6993ed363dd0fe03969d2c47b7f
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

`packages/mcp/src/main.ts` runs the server through `McpGuard.run` from
`@effected/mcp/guard`, which registers the `unhandledRejection` and
`uncaughtException` handlers before `load` imports the server graph, so
they also cover `dbPath` resolution and layer construction. The policy is
one declarative value, `{ onUncaught: "exitBeforeConnect", onRejection:
"log" }`: an unhandled rejection is logged to stderr and the server
continues unconditionally; an uncaught exception is logged and exits 1
only while the server is not yet serving. The guard owns the "serving"
signal itself, so `main.ts` keeps no connected flag of its own.

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
- The `policy` passed to `McpGuard.run` is the one place this policy is
  stated; changing the exit condition means changing that value, not
  hunting through `main.ts`'s event handlers.
- `bin-crash-resilience.e2e.test.ts` proves both halves against the built
  bin: an injected post-connect crash of either kind is logged and `ping`
  still answers, and an injected pre-load `uncaughtException` exits 1
  without ever serving or opening `data.db`.

## Related

- [Decision 50 — Strict MCP Tool Inputs](./50-strict-mcp-tool-inputs.md)
- [Decision 71 — Effect-Native MCP Server](./71-effect-native-mcp-server.md)
- [Decision 73 — Adoption helpers live in the kit](./73-adoption-helpers-live-in-the-kit.md)
