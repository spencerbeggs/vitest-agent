---
type: Decision
title: Effect Schema Data Structures
description: Effect Schema is the family's only schema language; TypeScript types derive from it and JSON codecs run through its effectful decode/encode.
status: draft
tags:
  - architecture
  - effect
generated:
  by: okfit/claude-code
  at: 2026-09-25T23:18:00Z
  body_sha256: 4c18dbe4db85fe5b92c32bec66c1d06ae93f25944ee4e860995501d3a6837f4d
sources:
  - id: sdk-schemas-agent-report
    resource: ../../packages/sdk/src/schemas/AgentReport.ts
  - id: sdk-schemas-run-report-file
    resource: ../../packages/sdk/src/schemas/RunReportFile.ts
  - id: mcp-toolkit
    resource: ../../packages/mcp/src/toolkit.ts
  - id: mcp-package-json
    resource: ../../packages/mcp/package.json
---

# Effect Schema Data Structures

## Context

Report and manifest data has to be type-safe in TypeScript and
serializable to and from JSON, and the same shapes have to be usable from
three different runtimes (the Vitest reporter, the CLI, and the MCP
server) without three separate definitions drifting apart. Before the
Effect-native MCP server (see
[Decision 71](../decisions/71-effect-native-mcp-server.md), not yet
migrated into this bundle), MCP tool inputs were validated with zod for a
tRPC routing layer; that dependency and that routing layer are gone.

## Decision

Effect Schema is the only schema language in the family. Every data
structure — report shapes, coverage shapes, run-report envelopes,
plugin/reporter options, TDD hierarchy shapes, run events — is declared
once under `packages/sdk/src/schemas/` as an Effect `Schema.Struct` (or
`Schema.Class`, `Schema.Union`, `Schema.Record`, depending on the shape),
for example `ReportSummary`, `TestReport`, `ModuleReport`, and
`AgentReport` in `AgentReport.ts`,[^sdk-schemas-agent-report] and the
`.vitest/<scope>/run.json` envelope (`$schema`, `schemaVersion`,
`generatedAt`, `reports[]`) declared in
`RunReportFile.ts`.[^sdk-schemas-run-report-file] TypeScript
types derive from the schema value itself via `typeof Schema.Type` rather
than being hand-written and kept in sync by hand — every exported schema
in the family has a same-named `export type Foo = typeof Foo.Type`
sitting beside it. JSON encoding and decoding go through the v4 effectful
codecs, `Schema.decodeUnknownEffect` and `Schema.encodeUnknownEffect`,
rather than a hand-rolled parser or a second validation library: the MCP
server's action-keyed tools decode their raw payload with exactly this
codec (`Schema.decodeUnknownEffect(parameters)` with
`onExcessProperty: "error"`, run by `@effected/mcp`'s
`McpToolkit.unionHandler`), mapping a decode failure to
`McpSchema.InvalidParams` because a malformed call is the caller's to
fix.[^mcp-toolkit]

The MCP server's tool inputs, outputs, and prompt arguments are Effect
Schemas served through Effect's own `McpServer` (`effect/unstable/ai`).
There is no separate request-validation library anywhere in the family:
`packages/mcp/package.json`'s dependency list has no `zod` and no tRPC
package.[^mcp-package-json] Schemas compose with Effect services directly
— a service method's return type is `Effect.Effect<SomeSchema.Type,
SomeError>` — with no bridging layer translating between "the schema
world" and "the service world".

## Alternatives rejected

**A second validation library for MCP tool inputs (zod + tRPC).** This is
what the pre-`Decision 71` MCP server used: zod schemas validated tool
inputs, and tRPC handled routing. It meant two schema languages existed in
the family — Effect Schema for reports and options, zod for MCP tool
inputs — with no shared derivation between them, so a shape used in both
places had to be defined twice and kept in sync by hand. Retired
alongside the tRPC routing layer.

**Hand-written TypeScript interfaces plus a separate JSON Schema
generator.** Would decouple the runtime validation from the compile-time
type, reintroducing exactly the "two definitions of the same shape"
problem Effect Schema's `typeof Schema.Type` derivation exists to close.
The published JSON Schema documents (the repo-root `schemas/` tree,
shipped as `@vitest-agent/sdk/schemas/*.json`) are instead generated FROM
the Effect Schema definitions by `@effected/schemastore-cli`, not
maintained as a separate artifact.

**Vitest's or a coverage provider's own duck-typed shapes, promoted to
schemas.** Rejected specifically for external library data the SDK only
observes rather than owns — Vitest's `TestModule`/`TestCase` shapes and
the Istanbul `CoverageMap` interfaces stay plain TypeScript interfaces,
never Effect Schemas, because schemas exist to describe the family's own
data, not to re-describe a dependency's internals the family does not
control.

## Consequences

Every schema gets Effect's tooling for free: structural equality, typed
decode/encode failures that flow through the same `Cause` channel every
other Effect error does, and (for the MCP surface) automatic JSON Schema
generation for the tools a client discovers. A schema change is a single
edit under `packages/sdk/src/schemas/` that propagates to every consumer's
derived type at compile time, rather than a coordinated edit across a
TypeScript interface, a zod schema, and a hand-written JSON Schema
document. The cost is a steeper on-ramp for a contributor unfamiliar with
Effect v4's schema API — `Schema.decodeUnknownEffect` and
`Schema.encodeUnknownEffect` are not the same shape as a plain parse
function, and getting the codec direction wrong (decode vs. encode) fails
at the type level rather than silently, which is the intended trade.

See [Module: sdk](../modules/sdk.md) for where these schemas live and
[Interface: published-json-schemas](../interfaces/published-json-schemas.md)
for the generated-JSON-Schema contract this decision feeds.

[^sdk-schemas-agent-report]: `../../packages/sdk/src/schemas/AgentReport.ts`
[^sdk-schemas-run-report-file]: `../../packages/sdk/src/schemas/RunReportFile.ts`
[^mcp-toolkit]: `../../packages/mcp/src/toolkit.ts`
[^mcp-package-json]: `../../packages/mcp/package.json`
