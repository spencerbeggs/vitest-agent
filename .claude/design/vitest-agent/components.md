---
status: current
module: vitest-agent-reporter
category: architecture
created: 2026-03-20
updated: 2026-06-12
last-synced: 2026-06-12
completeness: 90
related:
  - ./architecture.md
  - ./decisions.md
  - ./schemas.md
  - ./components/sdk.md
  - ./components/plugin.md
  - ./components/discover.md
  - ./components/reporter.md
  - ./components/ui.md
  - ./components/cli.md
  - ./components/mcp.md
  - ./components/sidecar.md
  - ./components/plugin-claude.md
  - ./components/docs-site.md
dependencies: []
---

# Components — `vitest-agent`

The system ships as seven publishable pnpm workspaces under `packages/`, a
file-based Claude Code plugin at `plugin/` and the `docs` documentation-site
workspace at `website/`. This document is an index — load the sub-file for
the package you're working on.

**Parent document:** [./architecture.md](./architecture.md)

## Sub-files

| File | Load when working on |
| ---- | -------------------- |
| [./components/sdk.md](./components/sdk.md) | services, layers, schemas, DataStore/DataReader, migrations, path resolution, formatters, the public reporter contract types, the `RunEvent`/`RenderState` schemas, utilities |
| [./components/plugin.md](./components/plugin.md) | `AgentPlugin`, the internal `AgentReporter` lifecycle class (with streaming hooks and the `onRunEvent` tap), `CoverageAnalyzer`, reporter-side utilities, coverage threshold extraction, the per-executor console matrix |
| [./components/discover.md](./components/discover.md) | `AgentPlugin.discover()`, the `DiscoverBuilder` thenable, `discoverProjects`, the `DiscoverStrategy` contract, the classifier helpers and the tag-injection transform |
| [./components/reporter.md](./components/reporter.md) | the default reporter package and custom-reporter reference: `DefaultVitestAgentReporter`, the live Ink mount it owns, the contract re-exports plus `buildDispatchInputs` / `resolveCellOptions` dispatch helpers |
| [./components/ui.md](./components/ui.md) | pure rendering-primitives library: `RunEvent` reducer, shape-tailored dispatcher matrix and its 12 cells, L1 MCP tool-pointer footer, synthesizers, `RunEventChannel` PubSub. No reporter or live mount after the reporter-package restructure |
| [./components/cli.md](./components/cli.md) | CLI commands (`doctor`, `db`, the `agent` namespace), the `record` subcommand and its hook-driven actions, `CliLive` |
| [./components/mcp.md](./components/mcp.md) | MCP tools, idempotency middleware, channel-event resolution, MCP resources, MCP prompts, the snapshot maintenance pipeline, `McpLive` |
| [./components/sidecar.md](./components/sidecar.md) | the `vitest-agent-sidecar` SEA binary for the per-Bash `inject-env` hot path, tsdown `exe` build, per-platform `optionalDependencies`, the binary-vs-JS-fallback contract |
| [./components/plugin-claude.md](./components/plugin-claude.md) | the Claude Code plugin: hooks, the TDD orchestrator agent, skills, slash commands, the dogfood system, the MCP loader |
| [./components/docs-site.md](./components/docs-site.md) | the `docs` workspace at `website/`: the RSPress 2.0 site, its Guide/Packages IA, the api-extractor generation pipeline (`apiModel.localPaths` → `website/lib/models`), the committed snapshot db and the Cloudflare Pages deploy |

Each sub-file is self-contained for its package and cross-references
[./decisions.md](./decisions.md) and [./schemas.md](./schemas.md)
where the rationale or schema details live.
