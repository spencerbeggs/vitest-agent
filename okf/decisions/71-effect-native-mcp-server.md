---
type: Decision
status: draft
title: Effect-Native MCP Server
description: "Rebuilds @vitest-agent/mcp on Effect's own McpServer over a local strict registrar, removing the MCP SDK, tRPC and zod, and serving every tool from one Effect Schema per tool instead of two hand-synced schema languages."
tags:
  - architecture
  - mcp
  - effect
generated:
  by: okfit/claude-code
  at: 2026-09-16T17:26:02Z
  body_sha256: a9494cb6d6fb401a1e38b8076e5453a2184edb0a000b44ee974d60b09b936035
sources:
  - id: mcp-server-ts
    resource: ../../packages/mcp/src/server.ts
  - id: mcp-toolkit-ts
    resource: ../../packages/mcp/src/toolkit.ts
  - id: mcp-register-toolkit-ts
    resource: ../../packages/mcp/src/register-toolkit.ts
  - id: mcp-main-ts
    resource: ../../packages/mcp/src/main.ts
  - id: mcp-idempotency-ts
    resource: ../../packages/mcp/src/idempotency.ts
---

# Effect-Native MCP Server

## Context

The previous server registered every tool twice: a tRPC procedure with an
Effect Schema input in `tools/<name>.ts`, and a hand-synced zod
`inputSchema` in `server.ts`, bridged by an Effect-Schema →
JSON-Schema → `z.fromJSONSchema` adapter for outputs. Three shipped bugs
(a dead `tags` field, a drifted `validatedAt`, and missing enum literals)
were all the same hand-sync failure mode. That server also validated
inputs by dropping to the MCP TypeScript SDK's low-level
`setRequestHandler(ListToolsRequestSchema, …)` / `setRequestHandler(CallToolRequestSchema,
…)` because the SDK's high-level `registerTool` surface accepts only zod
shapes, mixing that low-level seam with the SDK's high-level
`registerResource` / `registerPrompt` API for everything else. Effect v4
ships an MCP server whose tools *are* Effect Schemas, so the second
schema language, the bridge, the MCP SDK, and the tRPC router could all
go together.

## Decision

`@vitest-agent/mcp` is rebuilt on Effect's own `McpServer`
(`effect/unstable/ai`): the tools in `Kit = Toolkit.make(...)`
(`packages/mcp/src/toolkit.ts:42-73`) are `Tool.make` values, the six
prompts are `McpServer.prompt` layers, the server is one `Layer` over
`McpServer.layerStdio`, and `@modelcontextprotocol/sdk`, `@trpc/server`
and `zod` are gone from the dependency graph.

**Shape.** One file per tool under `src/tools/` exports the Effect
Schema `parameters` / `success`, the discriminant tuple where
applicable, the markdown formatter, the `handle<Name>` `Effect`, and the
`Tool.make` value (annotated `Tool.Title` / `Readonly` / `Destructive` /
`OpenWorld` / `Idempotent` and, for a markdown text channel,
`RenderText`). `toolkit.ts` gathers `Kit`, the `toolHandlers` record
(`satisfies Toolkit.HandlersFrom<typeof Kit.tools>`, so a tool without a
handler is a compile error — `packages/mcp/src/toolkit.ts:80-111`), and
`ToolsLayer = Kit.toLayer(toolHandlers)`
(`packages/mcp/src/toolkit.ts:118`). `server.ts` exports
`ServerLayer({ version })`
(`packages/mcp/src/server.ts:45-67`), merging
`registerStrictToolkit(Kit)` provided with `ToolsLayer` and
`PromptsLayer`, all provided by `McpServer.layerStdio` and
`Layer.succeed(Logger.LogToStderr, true)`. Handlers require
`DataReader | DataStore | ProjectDiscovery | McpSession`; `McpSession`
is a service carrying `{ cwd, currentSessionId, sessionContext }` that
replaces the tRPC-era context object.

**A local strict registrar over `McpServer.addTool`, not
`McpServer.toolkit`.** `McpServer.toolkit` decodes arguments with
Effect's default `onExcessProperty: "ignore"`, which strips unknown keys
— exactly the silent-widening class [Decision 50](50-strict-mcp-tool-inputs.md) exists to forbid.
`register-toolkit.ts` therefore adapts Effect's own `registerToolkit`
over the public `addTool` and: walks the raw payload against the served
JSON Schema before decoding and fails with `McpSchema.InvalidParams`
naming the unrecognized key(s) and the accepted params, qualified at
every object level, array element, and the union branch the discriminant
selects (`packages/mcp/src/register-toolkit.ts:272-380`); inlines `$ref`
roots and `$ref` union members, since a bare `$ref` root fails
`ToolJsonSchema`'s `type: "object"` requirement and would `orDie` at
registration (`packages/mcp/src/register-toolkit.ts:86-111`); sets
`additionalProperties: false` on every object node recursively
(`packages/mcp/src/register-toolkit.ts:112-162`); rewrites a top-level
`action` / `kind` union from `anyOf` to `oneOf` plus
`x-discriminator` (`packages/mcp/src/register-toolkit.ts:156-162`);
emits the dual channel — `structuredContent` is the encoded result,
`content[0].text` is the tool's `RenderText` markdown or the JSON
(`packages/mcp/src/register-toolkit.ts:366-367`); maps a declared,
`Error`-shaped failure to `{ isError: true, content: [{ text: message
}] }` with no `structuredContent`, upstream parity
(`packages/mcp/src/register-toolkit.ts:289`), and every other failure or
defect to the `UnexpectedToolError` envelope as `structuredContent` with
`isError: true` (`packages/mcp/src/register-toolkit.ts:294-295`), after
logging. Interrupt-only causes propagate untouched.

**Domain envelopes stay success-shaped.** `{ ok: false, error: { _tag,
…, remediation } }` is a member of each tool's `success` union, the same
posture the tRPC server used; `failure` stays `Schema.Never` and every
handler treats its `DataStoreError` as a defect. The `Toolkit` encoder
strips undeclared result keys, so a replay marker like
`_idempotentReplay` must be declared on the success struct it appears on
to survive encoding.

**Idempotency is a combinator, not middleware.** `withIdempotency(path,
handler)` in `packages/mcp/src/idempotency.ts:172` replaces the tRPC
middleware: it derives the key from the `idempotencyKeys` registry
(`packages/mcp/src/idempotency.ts:37`), looks up a persisted response via
`DataReader.findIdempotentResponse`, replays it with
`_idempotentReplay: true` on a hit, and otherwise runs the handler and
persists best-effort. A read failure or a corrupt row are both treated
as a miss, since the combinator's error channel is `never` and the worst
case tolerated is a duplicate write.

**Protocols.** `protocols` is `[v2025_11_25, v2025_06_18,
v2025_03_26]`, newest first, because the registry falls back to
`protocols[0]` for a client offering an unknown version
(`packages/mcp/src/server.ts:58`).

**Process contract.** `Layer.succeed(Logger.LogToStderr, true)` is
provided inside `ServerLayer` (`packages/mcp/src/server.ts:65`) and
again on the launched effect in `main.ts`
(`packages/mcp/src/main.ts:173`), because Effect's default logger writes
to stdout and stdout is the JSON-RPC wire. `main.ts` registers the crash
guards before any static import of the server graph
(`packages/mcp/src/main.ts:94-121`), resolves `projectDir` / `dbPath`,
builds `McpSession.layer` from `sessionContextFromEnv(env)` plus the
engine's lazy recover thunk, and launches under `NodeRuntime.runMain`
with a teardown that maps an interrupts-only cause to exit 0
(`packages/mcp/src/main.ts:194-201`) — stdin EOF interrupts the fiber
that built the stdio protocol, which `Runtime.defaultTeardown` would
otherwise report as exit 130. `transportConnected` is set from a
`Layer.effectDiscard` provided *by* the composed `Main` layer
(`packages/mcp/src/main.ts:182-187`), because `Layer.provide` builds its
dependency to completion before the dependent runs, which
`Layer.mergeAll`'s concurrency would not guarantee.

**`tdd_progress_push` changed its wire method.** Effect's server cannot
emit a custom method the previous server used; the tool keeps its
input/output contract but carries the enriched event on the standard
`notifications/message` frame instead (logger `vitest-agent/channel`).

## Alternatives rejected

**`McpServer.toolkit`.** Effect's own `Toolkit`-to-server binding decodes
arguments with `onExcessProperty: "ignore"` by default, silently
stripping a misspelled or extra key rather than rejecting it — the exact
bug class [Decision 50](50-strict-mcp-tool-inputs.md) exists to forbid (a
misspelled filter key would silently widen a query instead of failing).
What was gained by writing a local strict registrar instead: one schema
language end to end (Effect Schema for tool inputs, outputs and prompt
arguments), no MCP SDK / tRPC / zod dependencies, and unknown-key
rejection at every object level. What was sacrificed:
`register-toolkit.ts` is ~300 lines adapted from Effect's own
`registerToolkit` and must be tracked against `McpServer.ts` across
future release-candidate bumps. This was judged acceptable because the
alternative was carrying a second schema language forever, and the
adaptation carries its own unit test coverage
(`served-schema-strict.test.ts`).

**tRPC for MCP routing.** tRPC bought type-safe procedures, a
`createCallerFactory` for transport-free tests, and middleware, but it
required zod for input validation, so every tool input existed twice and
needed the Effect-Schema-to-JSON-Schema-to-zod bridge described in
Context. The transport-free testing seam survives in the current design
as `__test__/utils/caller.ts`'s `makeCaller`, which decodes params
through a tool's own schema and invokes its handler directly, without
tRPC.

**Effect Schema at the boundary via the MCP SDK's
`setRequestHandler`.** Before adopting tRPC, an earlier form used Effect
Schema directly against the low-level MCP SDK surface —
`tools/list` returning `Schema.toJsonSchemaDocument` per tool and
`tools/call` validating with `Schema.decodeUnknownEffect` — while
resources and prompts stayed on the SDK's high-level API, mixing the two
layers in one server. Effect's own `McpServer` takes Effect Schemas
directly at every surface, so that seam and the SDK dependency it
required are both gone; the `anyOf` → `oneOf` plus `x-discriminator`
rewrite that form needed now lives in `registerStrictToolkit`, where it
remains load-bearing rather than incidental.

## Consequences

The served schema behavior changed: input schemas now use
`Schema.optionalKey` (not `optional`) so the served `required` list is
accurate, and `Schema.Finite` (not `Number`) for numeric fields — the
old zod side used `z.coerce.number()`, so a stringified `"limit": "5"`
was silently accepted and is now rejected with a decode error on every
tool except `hypothesis record`'s `tddTaskId` / `sessionId`, which
deliberately preserves a `Union([Finite, FiniteFromString])`. Effect's
stdio protocol also interrupts an in-flight `tools/call` when stdin
closes immediately after it, which real MCP clients do not trigger in
practice since they keep stdin open, and `McpSession` today is unused by
the majority of read-only tools. `instructions` cannot be set through
`McpServer.layerStdio` at the pinned release candidate, so
`serverInfo.description` carries a one-line pointer and the `help` tool
remains the orientation surface; `McpServer.prompt` has no `title`
option either, so the six prompts lost their titles on the wire.

## Related

- [`@vitest-agent/mcp`](../modules/mcp.md)
- [MCP Tool Surface](../interfaces/mcp-tools.md)
- [Strict Tool Inputs](../invariants/strict-tool-inputs.md)
- [Decision 50: Strict MCP Tool Inputs](50-strict-mcp-tool-inputs.md)
- [Decision 35: Framing-Only MCP Prompts](35-framing-only-mcp-prompts.md)
