# @vitest-agent/mcp

[![npm](https://img.shields.io/npm/v/@vitest-agent/mcp?label=npm&color=cb3837)](https://www.npmjs.com/package/@vitest-agent/mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)

> **Part of the [vitest-agent](https://vitest-agent.dev) ecosystem.** Most users want **[@vitest-agent/plugin](https://www.npmjs.com/package/@vitest-agent/plugin)**, which pulls this package in automatically. Install `@vitest-agent/mcp` directly only if you run the MCP server standalone.

The `vitest-agent-mcp` MCP server bin, built on Effect's native `McpServer` (`effect/unstable/ai`). Exposes action-keyed tools over stdio that give LLM agents structured access to test data, coverage, history, failure signatures, TDD lifecycle state and more. Also surfaces six framing-only prompts.

## Features

- **30 action-keyed tools** — one `Tool.make` per file, assembled into a single `Toolkit`; per-CRUD families collapse into single tools dispatching on an `action` discriminator; covers `test_status`, `test_overview`, `test_coverage`, `test_errors`, `run_tests`, `note`, `hypothesis`, `tdd_task`, `tdd_goal`, `tdd_behavior`, `tdd_progress_push` and more
- **Six framing prompts** — `triage`, `why-flaky`, `regression-since-pass`, `explain-failure`, `tdd-resume`, `wrapup`
- **Idempotent writes** — `tdd_task`, `tdd_goal`, `tdd_behavior` and `hypothesis` create-actions are idempotent on derived keys via the `withIdempotency` combinator; a replay carries `_idempotentReplay: true`
- **Strict tool inputs** — every served `inputSchema` is strict at every object level; an unknown key is rejected with an error naming it and listing the accepted params, instead of being stripped and running a wider query than the caller asked for
- **Session-surviving error handling** — a handler that dies returns a structured `UnexpectedToolError` envelope, every log line goes to stderr (stdout is the JSON-RPC wire), and a stray unhandled rejection after the transport connects is logged rather than killing the server mid-session
- **Programmatic API** — `ServerLayer({ version })` is the whole server as an Effect `Layer` over any `Stdio` implementation (the test harness runs it over in-memory queues); `Kit`, `toolHandlers`, `PromptsLayer`, `registerStrictToolkit` and `McpSession` are exported for embedding or extension
- **No MCP SDK, tRPC or zod** — the wire protocol, JSON Schema generation and input validation all come from `effect`; tool inputs and outputs are Effect `Schema` values end to end

## Install

```bash
npm install --save-dev @vitest-agent/mcp
# or
pnpm add -D @vitest-agent/mcp
```

`@vitest-agent/mcp` is a regular dependency of `@vitest-agent/plugin` and installs with it automatically.

## Quick start

```bash
npx vitest-agent-mcp
# starts the MCP server over stdio
# example output (varies by environment)
```

The server reads the SQLite database written by `AgentPlugin` via the same XDG-derived path, so a single test run populates data for all tools.

## Documentation

MCP reference and tool catalog at [vitest-agent.dev/mcp](https://vitest-agent.dev/mcp).

## License

[MIT](LICENSE)
