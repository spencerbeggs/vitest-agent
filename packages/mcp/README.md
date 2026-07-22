# @vitest-agent/mcp

[![npm](https://img.shields.io/npm/v/@vitest-agent/mcp?label=npm&color=cb3837)](https://www.npmjs.com/package/@vitest-agent/mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)

> **Part of the [vitest-agent](https://vitest-agent.dev) ecosystem.** Most users want **[@vitest-agent/plugin](https://www.npmjs.com/package/@vitest-agent/plugin)**, which pulls this package in automatically. Install `@vitest-agent/mcp` directly only if you run the MCP server standalone.

The `vitest-agent-mcp` MCP server bin. Exposes action-keyed tools over stdio that give LLM agents structured access to test data, coverage, history, failure signatures, TDD lifecycle state and more. Also surfaces six framing-only prompts.

## Features

- **29 action-keyed tools** — per-CRUD families collapse into single tools dispatching on an `action` discriminator; covers `test_status`, `test_overview`, `test_coverage`, `test_errors`, `run_tests`, `note`, `hypothesis`, `tdd_task`, `tdd_goal`, `tdd_behavior` and more
- **Six framing prompts** — `triage`, `why-flaky`, `regression-since-pass`, `explain-failure`, `tdd-resume`, `wrapup`
- **Idempotency middleware** — `tdd_task`, `tdd_goal`, `tdd_behavior` and `hypothesis` create-actions are idempotent on derived keys
- **Programmatic API** — `buildMcpServer` constructs the server without connecting a transport; `parseSessionEnvExports` and `recoverSessionContextFromSessionEnv` recover the host session context from the Claude Code plugin's session-env files, so agent attribution survives a plugin reload

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
