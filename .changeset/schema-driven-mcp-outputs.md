---
"vitest-agent-mcp": patch
"vitest-agent-sdk": patch
---

## Features

### Schema-driven MCP tool outputs with `structuredContent`

29 MCP tools now emit dual-channel responses per MCP 2025-06-18: human-readable markdown in `content[]` and a typed JSON object in `structuredContent`. Each tool declares an `outputSchema` derived from an Effect Schema, so clients can validate the structured payload against a discoverable contract instead of parsing markdown.

A new `structuredResult(text, data)` helper in `packages/mcp/src/server.ts` produces both channels from a single source-of-truth Schema, and `Schema.transformOrFail` codecs render markdown one-way from the typed payload. JSON Schema annotations (`title`, `description`, `examples`) survive the round trip so agents see field hints in the tool listing.

### Effect Schema to zod bridge

A new `packages/mcp/src/utils/effect-to-zod.ts` bridges Effect Schema to zod via `JSONSchema.make` plus zod 4's experimental `z.fromJSONSchema`, so the MCP SDK still receives the zod schema it expects in `outputSchema`. The bridge inlines `$ref`s recursively before handing the document to zod (zod 4's `fromJSONSchema` does not resolve refs), and wraps non-object roots in `z.object({}).catchall(z.unknown())` because the SDK's `normalizeObjectSchema` rejects `ZodUnion` outputs.

## Bug Fixes

### `Schema.Union` outputs no longer crash with `_zod` undefined

Before the bridge wrap, every tool whose output Schema was a `Schema.Union` (`inventory`, `test_status`, `cache_health`, `tdd_task`, several others) crashed at runtime with `Cannot read properties of undefined (reading '_zod')` because the MCP SDK's output validator could not unwrap the union into an object schema. The wrap preserves the structured payload contract while satisfying the SDK's object-only requirement.
