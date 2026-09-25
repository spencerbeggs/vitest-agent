---
type: Decision
status: draft
title: Strict MCP Tool Inputs
description: Every served MCP tool input rejects unknown keys at every object level instead of silently widening the query.
tags: [architecture, mcp]
generated:
  by: okfit/claude-code
  at: 2026-09-25T17:01:39Z
  body_sha256: 381bed5c54d4063e8a7f7ea570f4ffb2b5b1c79eacaea28c1a78a5c6ffcefe85
---

# Strict MCP Tool Inputs

## Context

Effect's `McpServer.toolkit` decodes tool arguments with the library
default `onExcessProperty: "ignore"`, so an unknown key is silently
stripped before the handler ever sees the payload. Two failure modes share
that root cause. A caller that misspells a filter parameter gets a
successful result computed from a wider filter set than it asked for —
`run_tests` would run the entire workspace and report green while the
agent believed it had scoped the run. And a served schema that simply
forgot to declare a parameter the handler accepts is indistinguishable,
from the wire, from one that ignored it on purpose. An agent cannot
detect either case from the response alone.

## Decision

Every served tool input is strict, and the rule applies per object
*level*, not per tool: an unknown key is rejected at the top level,
inside nested objects, inside array elements, and inside the union
branch a discriminant selects, with an error naming both the offending
key(s) — path-qualified — and the accepted params at that level.

Every tool registers through a registrar that treats it as strict
regardless of its `Tool.Strict` annotation, never through Effect's own
`McpServer.toolkit`. The served input is the document Effect itself
builds for a strict tool (`Schema.toJsonSchemaDocument` with
`onExcessProperty: "error"`, so every object node carries
`additionalProperties: false`), made object-rooted; a top-level union of
discriminated object shapes is served as `{ type: "object", oneOf,
"x-discriminator" }`. Before decoding, the raw payload is walked against
that served schema — through properties, the union branch the
discriminant selects, `allOf`, `items` and `prefixItems` — and any level
carrying an undeclared key fails with `McpSchema.InvalidParams` naming
every unknown key and the accepted params, so a rejected call never
reaches a `DataReader` / `DataStore` call. Since [Decision
72](72-adopt-the-effected-front-end-kit.md) the registrar is
`@effected/mcp`'s `McpToolkit.layer`, and the seven action-keyed tools,
registered as `Tool.dynamic`, run the same walk and strict decode
inside their handler through `decodeStrictUnion`.

Its retired zod-mechanics predecessor — a hand-synced `z.strictObject`
registration per tool — is superseded by this schema-walk approach;
see [Invariant: Strict Tool Inputs](../invariants/strict-tool-inputs.md)
for the enforcement contract this decision produces.

## Alternatives rejected

- **Partial adoption (strict on some tools, default-lenient on others):**
  rejected because a surface where unknown-key rejection is per-tool luck
  teaches an agent nothing it can rely on — the whole point is that a
  rejection is a promise, not a maybe.
- **Relying on Effect's own decode to reject excess properties:**
  unavailable when this rule was adopted — `McpServer.toolkit` decoded
  with `onExcessProperty: "ignore"` unconditionally. Effect-TS/effect#8218
  made it honour `Tool.Strict`, which now
  supplies the served closed document and a backstop decode, but its
  rejection names only the first excess key and none of the accepted
  params (`Expected no excess property at ["key"]`), and
  `ToolParameterValidationError` carries only that string. The
  pre-decode walk is kept for the message, not the enforcement.

## Consequences

- A misspelled or forgotten parameter now fails loudly with the
  offending key and the accepted set named, instead of silently running
  a wider query and reporting success.
- Every new tool must join `Kit` in `packages/mcp/src/toolkit.ts`, which
  `McpToolkit.layer` registers, never `McpServer.toolkit` directly, or it
  loses strict-input enforcement silently (or, if annotated
  `Tool.Strict`, keeps only upstream's first-key-only message). A new
  union-parameter tool goes through `strictUnionTool` +
  `decodeStrictUnion`.
- `RunTestsOk` echoes the resolved filter set on a required
  `scope: { project, files, tags }` field as the success-path
  counterpart to rejection: one field distinguishes "ran exactly what I
  asked" from "ran everything," with no inference from summary counts
  needed for the one tool (`run_tests`) whose scope narrowing cannot be
  fully validated by a schema walk alone.

## Related

- [Invariant: Strict Tool Inputs](../invariants/strict-tool-inputs.md)
- [Decision 71 — Effect-Native MCP Server](./71-effect-native-mcp-server.md)
