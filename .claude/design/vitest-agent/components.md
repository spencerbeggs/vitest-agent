---
status: current
module: vitest-agent-reporter
category: architecture
created: 2026-03-20
updated: 2026-05-12
last-synced: 2026-05-12
completeness: 90
related:
  - ./architecture.md
  - ./decisions.md
  - ./data-structures.md
dependencies: []
---

# Components — `vitest-agent`

The system ships as six pnpm workspaces under `packages/` plus a file-based
Claude Code plugin at `plugin/`. This document is an index — load the
sub-file for the package you're working on.

**Parent document:** [./architecture.md](./architecture.md)

## Sub-files

| File | Load when working on |
| ---- | -------------------- |
| [./components/sdk.md](./components/sdk.md) | services, layers, schemas, DataStore/DataReader, migrations, path resolution, formatters, the public reporter contract types, the `RunEvent`/`RenderState` schemas, utilities |
| [./components/plugin.md](./components/plugin.md) | `AgentPlugin`, the internal `AgentReporter` lifecycle class (with streaming hooks and the `onRunEvent` tap), `CoverageAnalyzer`, reporter-side utilities, coverage threshold extraction, the per-executor console matrix |
| [./components/reporter.md](./components/reporter.md) | named `VitestAgentReporterFactory` implementations, the `_kit-context.ts` helper, `defaultReporter` composition |
| [./components/ui.md](./components/ui.md) | event-sourced renderer: `RunEvent` reducer, agent-string renderer, React Ink tree, `eventSourcedReporter` factory, `createLiveInk()` live mount, `RunEventChannel` PubSub, synthesizers |
| [./components/cli.md](./components/cli.md) | CLI commands (including `show` which routes through `vitest-agent-ui`), the `record` subcommand and its hook-driven actions, `CliLive` |
| [./components/mcp.md](./components/mcp.md) | MCP tools, idempotency middleware, channel-event resolution, MCP resources, MCP prompts, the snapshot maintenance pipeline, `McpLive` |
| [./components/plugin-claude.md](./components/plugin-claude.md) | the Claude Code plugin: hooks, the TDD orchestrator agent, skills, slash commands, the dogfood system, the MCP loader |

Each sub-file is self-contained for its package and cross-references
[./decisions.md](./decisions.md) and [./data-structures.md](./data-structures.md)
where the rationale or schema details live.
