---
type: Invariant
title: Strict MCP tool inputs — every served input rejects unknown keys
description: Every served MCP tool input rejects an unknown key at every object level, nested object, array element, and union branch, naming the accepted params instead of silently widening the query — pinned by served-schema-strict.test.ts.
tags: [mcp, security]
resource: ../../packages/mcp/src/register-toolkit.ts
sources:
  - id: register-toolkit
    resource: ../../packages/mcp/src/register-toolkit.ts
  - id: served-schema-strict-test
    resource: ../../packages/mcp/__test__/served-schema-strict.test.ts
  - id: served-enum-drift-test
    resource: ../../packages/mcp/__test__/served-enum-drift.test.ts
  - id: register-toolkit-test
    resource: ../../packages/mcp/__test__/register-toolkit.test.ts
generated:
  by: okfit/claude-code
  at: 2026-09-22T19:35:29Z
  body_sha256: f7cc0235d57ecb9c616cb5f08bfbf7797076dc71910b05541a9fb9d2b942cf57
---

# Strict MCP tool inputs — every served input rejects unknown keys

## Property

Every tool the MCP server serves rejects a payload key its schema does
not declare, and the rejection applies per object *level* — the top
level, a nested object, an array element, and the union branch a
discriminant selects — not per tool. The rejection names both the
offending key(s), path-qualified, and the accepted params at that level,
so a caller learns what was wrong rather than receiving a result computed
from a silently widened filter set[^register-toolkit]. The served
discriminant literals a union-rooted tool exposes (`action`, `kind`) also
come from one source — the tool core's own exported tuple — never a
separately hand-maintained enum, so a variant added to the union cannot
ship without also reaching the served schema[^served-enum-drift-test].

## Mechanism

Every tool registers through `registerStrictToolkit`
(`packages/mcp/src/register-toolkit.ts:506`), never Effect's own
`McpServer.toolkit`. Since rc.116 (Effect-TS/effect#8218) `McpServer`
honours `Tool.Strict` — `onExcessProperty: "error"` decode and a served
document closed at every object node — but only for tools annotated
strict, and its rejection reads `Expected no excess property at ["key"]`:
the first key only, with no list of what is accepted. The registrar
therefore treats every tool as strict whatever its annotation says, and
does four things per tool:

1. **Serves Effect's strict document.** `servedInputJsonSchema`
   (`register-toolkit.ts:323`) builds the input with
   `Schema.toJsonSchemaDocument(schema, { onExcessProperty: "error" })`
   — the same document rc.116 serves for a `Tool.Strict` tool, with
   `additionalProperties: false` on every object node emitted by Effect
   itself — and passes it through `objectRootedInputSchema`
   (`register-toolkit.ts:162`), which only reshapes the root: it inlines
   a `$ref` root and `$ref` union members through `inlineRootRefs`
   (`register-toolkit.ts:142`), since a `$ref` root (what Effect emits for
   any schema carrying an `identifier` annotation) fails MCP's
   `type: "object"` requirement and would `orDie` at registration, and it
   rewrites a top-level union whose members share a literal `action` /
   `kind` discriminant from `anyOf` to `type: "object"` + `oneOf` +
   `x-discriminator`. The object nodes are left exactly as Effect emitted
   them; the registrar no longer adds `additionalProperties` itself. A
   dynamic tool (a raw JSON Schema rather than an Effect Schema) dies at
   registration, as upstream does for a strict dynamic tool; none ships.
2. **Walks the raw payload before decoding.** `collectUnknownKeys`
   (`register-toolkit.ts:204`) resolves `$ref`s, selects the union branch
   by the discriminant value present in the payload, and recurses through
   `properties`, `items`, `prefixItems`, `oneOf` / `anyOf` / `allOf`,
   collecting every level that carries a key its schema does not declare.
   A hit fails `McpSchema.InvalidParams` with a message built by
   `formatUnknownKeys` (`register-toolkit.ts:279`): `Unrecognized
   parameter(s): <keys>. Accepted params: <list>` — every unknown key,
   path-qualified, each echoed key truncated to 200 characters. The walk
   exists solely to produce that message; the native strict decode stays
   behind it as a backstop. It runs before the tool's own Effect Schema
   decode, so a rejected call never reaches a `DataReader` / `DataStore`
   call.
3. **Sends one result, two channels.** `structuredContent` is the result
   encoded through the tool's `success` schema; `content[0].text` is the
   same encoded object as JSON, exactly as upstream sends it. No tool
   renders a markdown text channel — Claude Code forwards only
   `structuredContent` to the model when a result carries it, so a
   rendering there was never read.
4. **Maps failures.** A declared, `Error`-shaped failure becomes
   `{ isError: true, content: [{ text: message }] }` with no
   `structuredContent`; every other failure or defect is logged and
   returned as the `UnexpectedToolError` envelope, with
   `structuredContent` set and `isError: true`.

The served discriminant literals ride the same single-source discipline:
each consolidated tool (`test`, `inventory`, `note`, `hypothesis`,
`tdd_task`, `tdd_goal`, `tdd_behavior`) exports its literal tuple
(`TEST_ACTIONS`, `INVENTORY_KINDS`, and so on) immediately after its
`Schema.Union`, pinned to the union's own discriminant type by a two-way
conditional-type assertion at compile time. `objectRootedInputSchema`
derives the served `oneOf` + `x-discriminator` from that same union's generated
JSON Schema — the tuple is never independently re-typed into the served
schema — and `served-enum-drift.test.ts` asserts the served `oneOf`
members match the tuple at runtime[^served-enum-drift-test].

The regression guard is structural and table-driven at once:
`served-schema-strict.test.ts` walks every served schema over the
in-process harness asserting `additionalProperties: false` on every
object node, and an `it.each` table calls every tool but `run_tests` with
a bogus extra key (expecting rejection, naming the key) and with only its
documented params (expecting no rejection), with a guard test that the
case list equals the full `tools/list` result minus
`run_tests`[^served-schema-strict-test]. `register-toolkit.test.ts` covers
the registrar's schema transforms and payload walk directly at the unit
level[^register-toolkit-test].

## What a refactor would have to break

A new tool that registers through `McpServer.toolkit` directly, rather
than through `registerStrictToolkit`, would — unless annotated
`Tool.Strict` — serve a schema with the library default
`onExcessProperty: "ignore"`, with no `additionalProperties: false`
anywhere, and even when annotated would reject with upstream's
first-key-only message; either way `served-schema-strict.test.ts`'s sweep over every
served schema would fail the moment that tool's schema is walked, since
the guard test also asserts the case list covers every entry in
`tools/list`, so a new tool cannot silently opt out by never appearing in
the table. A tool core that added a union member without extending its
exported discriminant tuple would pass its own type-checking (the
two-way conditional assertion only catches a mismatch between the tuple
and the union, not a member added to only one of them incompletely) but
fail `served-enum-drift.test.ts`'s runtime comparison against the served
`oneOf`, since the served schema is generated straight from the union.
And building the served document without `onExcessProperty: "error"`,
or editing `collectUnknownKeys` to skip a node type — for example, to stop recursing into `prefixItems` — would surface
as a `served-schema-strict.test.ts` failure on any tool whose schema
actually uses that shape, rather than as a silent gap, because the sweep
walks every served schema's every node rather than sampling.

See [Decision 50: Strict MCP Tool Inputs](../decisions/50-strict-mcp-tool-inputs.md)
for why unknown-key rejection was made a per-level, all-tools rule rather
than adopted tool by tool, [Decision 60: Single-Source Served MCP
Discriminants](../decisions/60-single-source-served-mcp-discriminants.md)
for why the discriminant tuple lives with the union rather than in the
registrar, [Decision 71: Effect-Native MCP Server](../decisions/71-effect-native-mcp-server.md)
for why `registerStrictToolkit` exists as a local adaptation over
Effect's own `McpServer.addTool` rather than `McpServer.toolkit`, and
[Interface: MCP tools](../interfaces/mcp-tools.md) for the tool surface
this contract applies to.

[^register-toolkit]: `../../packages/mcp/src/register-toolkit.ts`
[^served-schema-strict-test]: `../../packages/mcp/__test__/served-schema-strict.test.ts`
[^served-enum-drift-test]: `../../packages/mcp/__test__/served-enum-drift.test.ts`
[^register-toolkit-test]: `../../packages/mcp/__test__/register-toolkit.test.ts`
