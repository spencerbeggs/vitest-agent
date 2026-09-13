---
"@vitest-agent/mcp": major
---

## Breaking Changes

### Rebuilt on Effect's native `McpServer`

The MCP server now runs on `effect/unstable/ai`'s `McpServer` over stdio. `@modelcontextprotocol/sdk`, `@trpc/server`, and `zod` are gone from the dependency tree. All 30 tool names and every `action` / `kind` discriminator value are unchanged.

### Exports removed

`buildMcpServer`, `startMcpServer`, `appRouter`, `McpContext`, `createCallerFactory`, `McpLive`, `parseSessionEnvExports`, and `recoverSessionContextFromSessionEnv` are no longer exported (the last two live in `@vitest-agent/engine`).

### Wire behavior changes

- **Unknown keys** are still rejected with a message naming the key and the accepted params, but the frame differs by protocol: on `2025-11-25` it is an `isError` tool result; on older protocols it is a JSON-RPC `-32602` error.
- **Numeric params are strict.** Strings such as `"limit": "5"` or `"timeout": "120"` are rejected — send numbers.
- **`tdd_progress_push`** emits its event as a standard `notifications/message` frame with logger `vitest-agent/channel`, replacing the custom `notifications/claude/channel` method.
- **`register_agent`** results with `ok: false` no longer set `isError`.
- Prompt titles are no longer advertised in `prompts/list`.
- All logs go to stderr; stdout carries only the protocol stream.
- A clean stdin close exits `0` (previously `130`). Startup failures exit `1` with a `startup failed:` line on stderr.
- Protocol versions are offered newest-first: `2025-11-25`, `2025-06-18`, `2025-03-26`.

## Features

### `./main` entry point

`main()` owns the process and is published at `@vitest-agent/mcp/main`; `bin.ts` is a shim over it so `@vitest-agent/plugin` can ship the same `vitest-agent-mcp` bin.

### New exports

- `ServerLayer` — the full server graph; `ToolsLayer`, `Kit`, and `toolHandlers` for the toolkit; `PromptsLayer` for the six prompts
- `McpSession` and the session helpers (`createSessionContextRef`, `createCurrentSessionIdRef`, `sessionContextFromEnv`)
- `registerStrictToolkit` — registers a toolkit whose inputs are strict at every object level
- `RenderText` and `withIdempotency`
- Every tool's `Input` / `Result` schema (for example `RunTestsInput`, `RunTestsResult`, `TddProgressPushInput`, `RegisterAgentResult`) with matching `*Type` type exports
