---
type: Decision
status: draft
title: Effect-Native MCP Server
description: "Rebuilds @vitest-agent/mcp on Effect's own McpServer with strict registration, removing the MCP SDK, tRPC and zod, and serving every tool from one Effect Schema per tool instead of two hand-synced schema languages."
tags:
  - architecture
  - mcp
  - effect
generated:
  by: okfit/claude-code
  at: 2026-09-25T23:18:00Z
  body_sha256: 6f52566d10dc6ab693727c770e01494ceda93bcdef43ba371488786b8be41949
sources:
  - id: mcp-server-ts
    resource: ../../packages/mcp/src/server.ts
  - id: mcp-toolkit-ts
    resource: ../../packages/mcp/src/toolkit.ts
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

> **Amended by [Decision 72](72-adopt-the-effected-front-end-kit.md).**
> The local strict registrar this Decision introduced, its
> `UnexpectedToolError` envelope, and `McpServer.layerStdio` have been
> replaced by `@effected/mcp`'s `McpToolkit.layer` and `McpStdio`. The
> strict-registration paragraph below records why a strict registrar was
> needed at all; Decision 72 owns how it is done now.

`@vitest-agent/mcp` is rebuilt on Effect's own `McpServer`
(`effect/unstable/ai`): the tools in `Kit = Toolkit.make(...)`
(`packages/mcp/src/toolkit.ts`) are `Tool.make` values (seven of them `Tool.dynamic`), the six
prompts are `McpServer.prompt` layers, the server is one `Layer` over
`McpStdio.layer` (from `@effected/mcp`, over Effect's stdio protocol), and `@modelcontextprotocol/sdk`, `@trpc/server`
and `zod` are gone from the dependency graph.

**Shape.** One file per tool under `src/tools/` exports the Effect
Schema `parameters` / `success`, the discriminant tuple where
applicable, the `handle<Name>` `Effect`, and the `Tool.make` value
(annotated `Tool.Title` / `Readonly` / `Destructive` / `OpenWorld` /
`Idempotent`). No tool renders a markdown text channel: every successful
result carries the encoded result in `structuredContent`, because Claude
Code forwards only `structuredContent` to the model when a result
carries it (Effect-TS/effect#8316). The former
`RenderText` annotation survives in `src/annotations.ts` as a
`@deprecated` no-op nothing reads, removed at the next major. `toolkit.ts` gathers `Kit`, the `toolHandlers` record
(`satisfies Toolkit.HandlersFrom<typeof Kit.tools>`, so a tool without a
handler is a compile error), and `ToolsLayer = Kit.toLayer(toolHandlers)`.
`server.ts` exports `ServerLayer({ version })`, merging
`McpToolkit.layer(Kit)` provided with `ToolsLayer` and `PromptsLayer`,
all provided by `McpStdio.layer`, which also provides
`Logger.LogToStderr`. Handlers require
`DataReader | DataStore | ProjectDiscovery | McpSession`; `McpSession`
is a service carrying `{ cwd, currentSessionId, sessionContext }` that
replaces the tRPC-era context object.

**Strict registration, not `McpServer.toolkit`.** `McpServer.toolkit`
decodes arguments with Effect's default `onExcessProperty: "ignore"`
unless a tool is annotated `Tool.Strict`, which strips unknown keys —
exactly the silent-widening class [Decision
50](50-strict-mcp-tool-inputs.md) exists to forbid — and upstream's
strict path (Effect-TS/effect#8218) rejects with the first excess key
only and no accepted-params list. Every tool therefore registers
through a registrar that treats every tool as strict, names every
unknown key at every level with the accepted params, and serves
Effect's strict document made object-rooted. That registrar was
first a local port of `McpServer.registerToolkit` and is now
`@effected/mcp`'s `McpToolkit.layer`, with the seven union-parameter
tools registered as `Tool.dynamic` — see [Decision
72](72-adopt-the-effected-front-end-kit.md) and [Invariant: Strict
Tool Inputs](../invariants/strict-tool-inputs.md).

**Domain envelopes stay success-shaped.** `{ ok: false, error: { _tag,
…, remediation } }` is a member of each tool's `success` union, the same
posture the tRPC server used. A tool's `failure` is `Schema.Never`
unless it declares `InvalidParams` or `ToolRefusal` ([Decision
72](72-adopt-the-effected-front-end-kit.md)), and every handler treats
its `DataStoreError` as a defect. The `Toolkit` encoder
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

**Protocols.** `McpStdio.protocols` is `[v2026_07_28, v2025_11_25,
v2025_06_18]` (`v2025_03_26` was dropped). `2026-07-28` is the stateless revision
(SEP-2575): no `initialize`, no session; a client discovers with
`server/discover` and every request carries
`params._meta["io.modelcontextprotocol/protocolVersion"]`, and every
result, `tools/call` included, is wrapped in the stateless frame. Effect's
runtime (`effect/unstable/ai/internal/mcpRuntime.ts`) routes a request
carrying that `_meta` to its adapter, matches `initialize` against the
stateful adapters only, and sends anything else with no session to
`protocols[0]`, so the stateless adapter is listed first; at most one
stateless adapter is allowed. The stateful adapters
must stay because every shipping client (Claude Code's default stdio
session, Copilot, Cursor, the Inspector) opens with `initialize`, which
a server offering only `2026-07-28` answers with `METHOD_NOT_FOUND`;
measured with Claude Code 2.1.278, the default and
`MCP_PROTOCOL_NEGOTIATION=legacy` open `initialize` on `2025-11-25`, and
`MCP_PROTOCOL_NEGOTIATION=auto` opens `server/discover` then
`subscriptions/listen` on `2026-07-28`. `server/discover` advertises
every listed adapter in `supportedVersions`.

**Instructions.** `instructions` is a first-class `McpStdio.layer`
option: `server.ts` exports `SERVER_INSTRUCTIONS` (what the server is
for, call `help` first, the strict-input rule, read `structuredContent`
for every field, and how an expected domain error — an `ok: false`
success-shaped envelope — differs from an `isError` result) and passes it as `instructions`, which
surfaces in both the `initialize` result and the `server/discover`
result. `serverInfo.description` is just the one-line human summary.

**Process contract.** `McpStdio.layer` provides `Logger.LogToStderr` to
everything it provides, and `McpStdio.launch` provides it around the whole
launch, because Effect's default logger writes to stdout and stdout is
the JSON-RPC wire. `main.ts` hands the process to `@effected/mcp/guard`'s
`McpGuard.run`, which registers the crash guards before its `load` step
imports the server graph; `load` resolves `projectDir` / `dbPath`, builds
`McpSession.layer` from `sessionContextFromEnv(env)` plus the engine's
lazy recover thunk, and returns the layer for the guard to launch under
`NodeRuntime.runMain` with `McpStdio.teardown`, which maps stdin EOF (an
interrupt-only exit) to 0 instead of 130. The guard tracks when the server
is serving itself (see [Decision
51](51-the-mcp-server-survives-post-connect-crashes.md)).

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
What was gained by registering through a strict registrar instead: one
schema language end to end (Effect Schema for tool inputs, outputs and
prompt arguments), no MCP SDK / tRPC / zod dependencies, and unknown-key
rejection at every object level.

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
rewrite that form needed now comes from `@effected/mcp`'s
`ToolInputSchema.objectRooted`, applied to the union tools by
`McpToolkit.unionTool` ([Decision
73](73-adoption-helpers-live-in-the-kit.md)).

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
the majority of read-only tools. The six prompts serve a `title`, since
`McpServer.prompt` accepts one (`prompts/layer.ts`,
pinned by `prompts-layer.test.ts`). Retiring the markdown text channel
left `RenderText` a deprecated no-op export rather than a removal, so the
change ships as a minor; fields that hold markdown as data
(`triage_brief.markdown`, `wrapup_prompt.markdown`, `help.helpText`) are
unaffected.

## Related

- [`@vitest-agent/mcp`](../modules/mcp.md)
- [MCP Tool Surface](../interfaces/mcp-tools.md)
- [Strict Tool Inputs](../invariants/strict-tool-inputs.md)
- [Decision 50: Strict MCP Tool Inputs](50-strict-mcp-tool-inputs.md)
- [Decision 35: Framing-Only MCP Prompts](35-framing-only-mcp-prompts.md)
- [Decision 72: Adopt the Effected Front-End Kit](72-adopt-the-effected-front-end-kit.md)
- [Decision 73: Adoption Helpers Live in the Kit](73-adoption-helpers-live-in-the-kit.md)
