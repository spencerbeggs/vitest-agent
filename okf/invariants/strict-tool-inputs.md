---
type: Invariant
title: Strict MCP tool inputs — every served input rejects unknown keys
description: Every served MCP tool input rejects an unknown key at every object level, nested object, array element, and union branch, naming the accepted params instead of silently widening the query — pinned by served-schema-strict.test.ts.
tags: [mcp, security]
resource: ../../packages/mcp/src/server.ts
sources:
  - id: server-ts
    resource: ../../packages/mcp/src/server.ts
  - id: union-schema
    resource: ../../packages/mcp/src/tools/_union-schema.ts
  - id: served-schema-strict-test
    resource: ../../packages/mcp/__test__/served-schema-strict.test.ts
  - id: served-enum-drift-test
    resource: ../../packages/mcp/__test__/served-enum-drift.test.ts
  - id: union-schema-test
    resource: ../../packages/mcp/__test__/union-schema.test.ts
generated:
  by: okfit/claude-code
  at: 2026-09-25T17:01:39Z
  body_sha256: 7bd620d9ef8061631ac3a3ecb985fca82c314b48fc76170f8b3c5fe20f5dff74
---

# Strict MCP tool inputs — every served input rejects unknown keys

## Property

Every tool the MCP server serves rejects a payload key its schema does
not declare, and the rejection applies per object *level* — the top
level, a nested object, an array element, and the union branch a
discriminant selects — not per tool. The rejection names both the
offending key(s), path-qualified, and the accepted params at that level,
so a caller learns what was wrong rather than receiving a result computed
from a silently widened filter set[^server-ts]. The served
discriminant literals a union-rooted tool exposes (`action`, `kind`) also
come from one source — the tool core's own exported tuple — never a
separately hand-maintained enum, so a variant added to the union cannot
ship without also reaching the served schema[^served-enum-drift-test].

## Mechanism

Tools reach the server by two routes, and both are strict.

1. **`Tool.make` tools (23 of 30)** register through `@effected/mcp`'s
   `McpToolkit.layer(Kit)` in `ServerLayer`, never Effect's own
   `McpServer.toolkit`[^server-ts]. `McpToolkit.layer` is strict by
   default whatever a tool's `Tool.Strict` annotation says: it serves
   Effect's strict document (`Schema.toJsonSchemaDocument` with
   `onExcessProperty: "error"`, `additionalProperties: false` on every
   object node, made object-rooted), and it walks the raw payload
   against that served schema before decoding. A hit fails
   `McpSchema.InvalidParams` reading `Unrecognized parameter(s): <keys>.
   Accepted params: <list>`, with every unknown key path-qualified.
2. **The seven action-keyed tools** (`inventory`, `test`, `note`,
   `hypothesis`, `tdd_task`, `tdd_goal`, `tdd_behavior`) are
   `Tool.dynamic`, because core dies at registration on a union
   `parameters` schema. `strictUnionTool` serves Effect's strict
   document for the union, reshaped by `ToolInputSchema.objectRooted` to
   `type: "object"` + `oneOf` + `x-discriminator`. Core never re-decodes a
   dynamic tool, so `decodeStrictUnion` wraps each handler instead. It
   runs `ToolInputSchema.unknownKeys` against the served schema,
   selecting the union branch by the discriminant present, then decodes
   with `onExcessProperty: "error"`. Either rejection fails with the
   tool's declared `InvalidParams`[^union-schema].

Both routes reject before the handler runs, so a rejected call never
reaches a `DataReader` / `DataStore` call. The one wire difference is on
`2025-06-18`: a `Tool.make` rejection is a JSON-RPC `-32602` error, and
a union-tool rejection is an `isError` result.

The served discriminant literals follow the same single-source rule.
Each consolidated tool exports its literal tuple (`TEST_ACTIONS`,
`INVENTORY_KINDS`, and so on) right after its `Schema.Union`, pinned to
the union's discriminant type by a two-way conditional-type assertion.
The served `oneOf` is generated from that same union, so the tuple is
never typed into the served schema a second time.
`served-enum-drift.test.ts` asserts the served `oneOf` members match
the tuple at runtime[^served-enum-drift-test].

The regression guard is structural and table-driven at once.
`served-schema-strict.test.ts` pins the served tool count, runs
`McpToolAudit` over the listing, and walks every served schema asserting
`additionalProperties: false` on every object node. An `it.each` table
calls every tool but `run_tests` twice: once with a bogus extra key,
expecting a rejection that names it, and once with only its documented
params, expecting none. A guard test checks the case list equals the
full `tools/list` result minus `run_tests`[^served-schema-strict-test].
`union-schema.test.ts` covers `unionInputJsonSchema` and
`decodeStrictUnion` directly, including nested unknown keys and a key
from a sibling branch[^union-schema-test].

## What a refactor would have to break

Three changes would break this property, and each fails a test:

- **A tool registered through `McpServer.toolkit`.** It would decode
  with the library default `onExcessProperty: "ignore"` unless annotated
  `Tool.Strict`. `served-schema-strict.test.ts` covers every entry in
  `tools/list`, so the new tool cannot opt out by being left out of the
  table.
- **A `Tool.dynamic` tool whose handler skips `decodeStrictUnion`.** It
  would pass the served-schema walk, because the served document is
  still strict. It would fail the bogus-key call in the `it.each`
  table.
- **A union member added without extending the discriminant tuple.** It
  would fail `served-enum-drift.test.ts`, because the served schema is
  generated from the union.

See [Decision 50: Strict MCP Tool Inputs](../decisions/50-strict-mcp-tool-inputs.md)
for why unknown-key rejection is a rule for every level and every tool,
[Decision 60: Single-Source Served MCP
Discriminants](../decisions/60-single-source-served-mcp-discriminants.md)
for why the discriminant tuple lives with the union, [Decision 72: Adopt
the Effected Front-End Kit](../decisions/72-adopt-the-effected-front-end-kit.md)
for why the union tools are `Tool.dynamic` and not flat structs, and
[Interface: MCP tools](../interfaces/mcp-tools.md) for the tool surface
this contract applies to.

[^server-ts]: `../../packages/mcp/src/server.ts`
[^union-schema]: `../../packages/mcp/src/tools/_union-schema.ts`
[^served-schema-strict-test]: `../../packages/mcp/__test__/served-schema-strict.test.ts`
[^served-enum-drift-test]: `../../packages/mcp/__test__/served-enum-drift.test.ts`
[^union-schema-test]: `../../packages/mcp/__test__/union-schema.test.ts`
