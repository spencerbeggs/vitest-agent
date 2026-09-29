---
type: Decision
status: stable
title: Framing-Only MCP Prompts
description: The MCP server's six McpServer.prompt registrations return orienting messages toward tool composition rather than pre-fetching tool data server-side.
tags: [architecture, mcp]
generated:
  by: okfit/claude-code
  at: 2026-09-29T20:39:41Z
  body_sha256: 07209568f0ffd24a9ea4a6b68e8c72ed40c40da8d973574e6e38f9c7eb367377
verified:
  - by: human:spencer
    at: 2026-09-29T00:00:00Z
---

# Framing-Only MCP Prompts

## Context

An earlier form of this decision also registered an MCP resources surface
alongside the prompts, exposing a vendored Vitest documentation snapshot
and a curated patterns library under two URI schemes; that surface was
removed because a static documentation corpus gained little over shipping
the same content as a Claude Code skill, while imposing a real build-time
packaging cost. The prompts half was unaffected by that removal and is
the decision recorded here.

## Decision

The MCP server exposes six framing-only prompts alongside the toolkit:
`triage`, `why-flaky`, `regression-since-pass`, `explain-failure`,
`tdd-resume`, `wrapup` (`packages/mcp/src/prompts/layer.ts`, the
`PROMPT_NAMES` tuple). Each is registered with `McpServer.prompt` and
takes an Effect-Schema-validated, string-based argument set, returning
user-role messages that orient the agent toward the right tool
composition — no tool data is pre-fetched on the server. For example,
`Triage` (`packages/mcp/src/prompts/layer.ts`) takes an optional
`project` string and returns messages built by the pure `triagePrompt`
factory.

`PromptsLayer` is `Layer.mergeAll` of the six `McpServer.prompt` layers
(`packages/mcp/src/prompts/layer.ts`), merged with the strict
toolkit registration inside `ServerLayer`
(`packages/mcp/src/server.ts`) so tools and prompts register into the
same `McpServer` instance (see
[Decision 71](./71-effect-native-mcp-server.md)). Each prompt module
(`triage.ts`, `why-flaky.ts`, `regression-since-pass.ts`,
`explain-failure.ts`, `tdd-resume.ts`, `wrapup.ts`) keeps a pure,
independently unit-tested factory that owns the message text, separate
from `layer.ts`, which owns the names, descriptions, argument schemas,
and the mapping to `McpSchema.PromptMessage`
(`packages/mcp/src/prompts/layer.ts`). Prompt arguments are strings
on the wire (MCP `prompts/get` carries `Record<string, string>`), so
every parameter is `Schema.String`-based; `Schema.optionalKey` marks the
ones `prompts/list` advertises as not required
(`packages/mcp/src/prompts/layer.ts`).

`tdd-resume` is the one prompt with a server-side default: its factory
takes an optional `sessionId`
(`packages/mcp/src/prompts/tdd-resume.ts`) and, when the client omits
it, the text names the chat id the server recovered for this process from
`McpSession` — which is why `PromptsLayer` requires that service.

**Why "framing-only" prompts (vs pre-fetching tool data).** Pre-fetching
would invert the cost model: `triage` would have to call `triage_brief`
server-side just to emit one templated message, paying the database read
twice. Pre-fetching also couples the prompt result to database state at
prompt-selection time, which is one or two agent turns earlier than when
the agent actually uses the data — by then it is stale. Framing-only
prompts compose with existing tools instead: `triage` orients the agent
toward `triage_brief`, `failure_signature_get`, and `hypothesis`, and the
agent calls those tools at the right time. Argument validation lives in
the prompt schema, so a bad argument shows up at prompt selection as an
MCP protocol error rather than several turns later inside a tool call.

**Why `McpServer.prompt` rather than a tool per prompt.** Prompts are
templated message emitters, and `effect/ai`'s prompt registration
understands argument schemas natively; forcing them through the strict
toolkit would mean inventing a tool-per-prompt convention on top of a
surface designed for request/response tools. The one server-side input
across all six prompts is `tdd-resume`'s `sessionId` default, read from
`McpSession`.

## Alternatives rejected

- **Pre-fetch tool data inside the prompt handler and embed the result in
  the returned message**: rejected because it pays the same database read
  twice (once at prompt-selection time, once when the agent calls the
  tool it was pointed at) and binds the prompt's content to database
  state that may be stale by the time the agent acts on it.
- **Register each prompt as an MCP tool instead of using
  `McpServer.prompt`**: rejected because it would require inventing a
  tool-per-prompt convention and forgo the framework's native argument-schema
  handling for prompts.
- **A resources surface alongside the prompts** (the original form of this
  decision): rejected and removed — the corpus it would serve gained
  little over shipping the same content as a Claude Code skill, at the
  cost of shipping the content inside the package's own build output.

## Consequences

- Prompts cannot dynamically discover tools — a future "this prompt
  should expand to whatever tools are currently registered" need would
  require server-side enumeration this framing-only design does not
  support.
- Adding a seventh prompt means adding both a pure factory module and a
  `McpServer.prompt` registration in `layer.ts`, and appending its name to
  `PROMPT_NAMES` — a mismatch between the two is caught by
  `__test__/help-drift.test.ts`.
- Every prompt argument is a string on the wire regardless of its logical
  type, since MCP's `prompts/get` request carries only
  `Record<string, string>`; a prompt needing a structured argument must
  encode and decode it as a string.

## Related

- [Decision 71 — Effect-Native MCP Server](./71-effect-native-mcp-server.md)
- [Decision 50 — Strict MCP Tool Inputs](./50-strict-mcp-tool-inputs.md)
