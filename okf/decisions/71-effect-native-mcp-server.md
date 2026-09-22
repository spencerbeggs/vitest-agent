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
  at: 2026-09-22T19:35:29Z
  body_sha256: 62cd6a49787ea7326f25ea4f9e3808c67b4369808db3e68870375e6d05a1c77a
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
applicable, the `handle<Name>` `Effect`, and the `Tool.make` value
(annotated `Tool.Title` / `Readonly` / `Destructive` / `OpenWorld` /
`Idempotent`). No tool renders a markdown text channel: every successful
result's `content[0].text` is the encoded result as JSON, the same object
as `structuredContent`, because Claude Code forwards only
`structuredContent` to the model when a result carries it. The former
`RenderText` annotation survives in `src/annotations.ts` as a
`@deprecated` no-op nothing reads, removed at the next major. `toolkit.ts` gathers `Kit`, the `toolHandlers` record
(`satisfies Toolkit.HandlersFrom<typeof Kit.tools>`, so a tool without a
handler is a compile error — `packages/mcp/src/toolkit.ts:80-111`), and
`ToolsLayer = Kit.toLayer(toolHandlers)`
(`packages/mcp/src/toolkit.ts:118`). `server.ts` exports
`ServerLayer({ version })`
(`packages/mcp/src/server.ts:71-90`), merging
`registerStrictToolkit(Kit)` provided with `ToolsLayer` and
`PromptsLayer`, all provided by `McpServer.layerStdio` and
`Layer.succeed(Logger.LogToStderr, true)`. Handlers require
`DataReader | DataStore | ProjectDiscovery | McpSession`; `McpSession`
is a service carrying `{ cwd, currentSessionId, sessionContext }` that
replaces the tRPC-era context object.

**A local strict registrar over `McpServer.addTool`, not
`McpServer.toolkit`.** `McpServer.toolkit` decodes arguments with
Effect's default `onExcessProperty: "ignore"` unless a tool is annotated
`Tool.Strict`, which strips unknown keys — exactly the silent-widening
class [Decision 50](50-strict-mcp-tool-inputs.md) exists to forbid — and
rc.116's strict path (Effect-TS/effect#8218) rejects with the first
excess key only and no accepted-params list.
`register-toolkit.ts`'s `registerStrictToolkitEffect` is therefore a
line-for-line port of rc.116's `McpServer.registerToolkit` over the
public `addTool`, with the deviations enumerated in the file header and
re-checked on every rc bump: (i) every tool is treated as strict
whatever its `Tool.Strict` annotation (strict decode options, a die at
registration for a dynamic tool, as upstream does for a strict one), and
`collectUnknownKeys` walks the raw payload against the served JSON
Schema before decoding and fails with `McpSchema.InvalidParams` naming
every unrecognized key and the accepted params, qualified at every
object level, array element, and the union branch the discriminant
selects — the native strict decode stays behind it as a backstop;
(ii) the served input schema is Effect's own strict document
(`servedInputJsonSchema`: `Schema.toJsonSchemaDocument` with
`onExcessProperty: "error"`, which closes every object node) passed
through `objectRootedInputSchema`, which only inlines a bare `$ref` root
or `$ref` union member (a `$ref` root fails `McpSchema.ToolJson`'s
object-root requirement and would `orDie` at registration) and rewrites
a top-level `action` / `kind` union from `anyOf` to `oneOf` plus
`x-discriminator` — the registrar adds no `additionalProperties` of its
own; (iii) is retired: the success branch sends the encoded result as
JSON in `content[0].text`, as upstream does (Effect-TS/effect#8316); (iv) an internal
failure or defect renders the `UnexpectedToolError` envelope as
`structuredContent` with `isError: true` instead of rc.116's scrubbed
"Tool execution failed due to an internal server error." text, still
logged and `ErrorReporter.report`ed first; (v) `outputSchema` is served
only when the success document is object-rooted after the `$ref` hoist,
because `@modelcontextprotocol/sdk`'s `ToolSchema` requires
`outputSchema.type === "object"` even though rc.116's
`McpSchema.ToolOutputJson` accepts any JSON object — fixed upstream by
Effect-TS/effect#8326 in rc.117, not yet adopted; (vi) a non-object encoded result carries no
`structuredContent`. A declared `Error`-shaped failure maps to `{
isError: true, content: [{ text: message }] }` with no
`structuredContent`, upstream parity, and is no longer logged (rc.116
logs only the internal branch; no shipped tool declares a `failure`
schema). Interrupt-only causes propagate untouched. Input schemas decode
through `McpSchema.ToolJson` and output schemas through
`McpSchema.ToolOutputJson` (`McpSchema.ToolJsonSchema` no longer
exists); `addTool`'s handler requirement is `McpSchema.McpRequestContext`
rather than the legacy `McpServerClient`.

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

**Protocols.** `protocols` is `[v2026_07_28, v2025_11_25,
v2025_06_18]` (`ServerLayer` in `packages/mcp/src/server.ts`;
`v2025_03_26` was dropped). `2026-07-28` is the stateless revision
(SEP-2575): no `initialize`, no session; a client discovers with
`server/discover` and every request carries
`params._meta["io.modelcontextprotocol/protocolVersion"]`, and every
result, `tools/call` included, is wrapped in the stateless frame. rc.116's
runtime (`effect/unstable/ai/internal/mcpRuntime.ts`) routes a request
carrying that `_meta` to its adapter, matches `initialize` against the
stateful adapters only, and sends anything else with no session to
`protocols[0]`, so the stateless adapter is listed first; at most one
stateless adapter is allowed (a second fails the layer with
`Cause.IllegalArgumentError`, hence `Layer.orDie`). The stateful adapters
must stay because every shipping client (Claude Code's default stdio
session, Copilot, Cursor, the Inspector) opens with `initialize`, which
a server offering only `2026-07-28` answers with `METHOD_NOT_FOUND`;
measured with Claude Code 2.1.278, the default and
`MCP_PROTOCOL_NEGOTIATION=legacy` open `initialize` on `2025-11-25`, and
`MCP_PROTOCOL_NEGOTIATION=auto` opens `server/discover` then
`subscriptions/listen` on `2026-07-28`. `server/discover` advertises
every listed adapter in `supportedVersions`.

**Instructions.** `instructions` is a first-class `McpServer.layerStdio`
option in rc.116: `server.ts` exports `SERVER_INSTRUCTIONS` (what the
server is for, call `help` first, the strict-input rule, the
`structuredContent` / `content[0].text` dual channel, and how an
expected domain error — an `ok: false` success-shaped envelope — differs
from an `isError` result) and passes it as `instructions`, which
surfaces in both the `initialize` result and the `server/discover`
result. `serverInfo.description` is just the one-line human summary.

**Process contract.** `Layer.succeed(Logger.LogToStderr, true)` is
provided inside `ServerLayer` (`packages/mcp/src/server.ts:88`) and
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
`register-toolkit.ts` is a line-for-line port of Effect's own
`registerToolkit` with enumerated deviations that must be re-checked
against `McpServer.ts` on every release-candidate bump. This was judged
acceptable because the alternative was carrying a second schema language
forever, and the port carries its own unit test coverage
(`served-schema-strict.test.ts`, `server-protocols.test.ts`).

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
the majority of read-only tools. The six prompts serve a `title` again
since rc.116's `McpServer.prompt` accepts one (`prompts/layer.ts`,
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
