---
"@vitest-agent/mcp": minor
---

## Features

### MCP protocol 2026-07-28 and server instructions

The server now offers the stateless `2026-07-28` MCP protocol (SEP-2575) alongside the stateful `2025-11-25` and `2025-06-18` revisions. A client on `2026-07-28` skips the `initialize` handshake, discovers the server with `server/discover`, and carries the protocol version in every request's `_meta`; every result on that revision is wrapped in the stateless frame (`_meta["io.modelcontextprotocol/serverInfo"]`, `resultType: "complete"`). Clients that still open with `initialize` — Claude Code's default stdio session, Copilot, Cursor, the Inspector — keep negotiating `2025-11-25` or `2025-06-18` unchanged. Measured with Claude Code 2.1.278: the default (and `MCP_PROTOCOL_NEGOTIATION=legacy`) session opens with `initialize` on `2025-11-25`; `MCP_PROTOCOL_NEGOTIATION=auto` opens with `server/discover` on `2026-07-28`.

* `SERVER_INSTRUCTIONS` (exported) is now served as the MCP `instructions` field on both the `initialize` and the `server/discover` result: what the server is for, which tool to call first, the strict-input rule, and how to read the `structuredContent` / `content[0].text` channels and the `ok: false` domain-error envelopes versus an `isError` result.
* The `2025-03-26` protocol revision is no longer offered.

## Refactoring

* `registerStrictToolkit` is rebased line-for-line on Effect rc.116's `McpServer.registerToolkit`: it mirrors `Tool.Strict` (strict decode, `additionalProperties: false` on the served document, a defect for a strict dynamic tool), classifies failures by `Toolkit.FailureOrigin`, and reports internal failures through `ErrorReporter` before rendering the `UnexpectedToolError` envelope. Its handlers now require `McpSchema.McpRequestContext` in place of the legacy `McpServerClient`.
* A declared tool failure is no longer logged at error level before it is rendered, matching rc.116; internal failures and defects are still logged.
* `outputSchema` is served only when the result schema is object-rooted, because `@modelcontextprotocol/sdk`'s `ToolSchema` requires `outputSchema.type === "object"` while rc.116 accepts any JSON object (upstream: Effect-TS/effect#8315).
