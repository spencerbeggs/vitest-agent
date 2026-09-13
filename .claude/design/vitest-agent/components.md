---
status: current
module: vitest-agent
category: architecture
created: 2026-03-20
updated: 2026-09-13
last-synced: 2026-09-13
completeness: 90
related:
  - ./architecture.md
  - ./decisions.md
  - ./schemas.md
  - ./components/sdk.md
  - ./components/engine.md
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

The system ships as eight publishable pnpm workspaces under `packages/`, the private Claude Code plugin workspace at `plugins/claude-code/` and the `docs` documentation-site workspace at `website/`. This document is an index — load the sub-file for the package you're working on.

**Parent document:** [./architecture.md](./architecture.md)

## Sub-files

| File | Load when working on |
| ---- | -------------------- |
| [./components/sdk.md](./components/sdk.md) | the platform-free core: schemas, the public reporter and dispatcher contract types, the `RunEvent`/`RenderState` schemas, tagged errors, pure formatters and utilities, the pure `./dispatch` entry, the published JSON Schema documents, the core boundary test |
| [./components/engine.md](./components/engine.md) | the platform half: Effect services and Live/Test layers, DataStore/DataReader, the SQLite stack and migrations, `PlatformLive`, `resolveProjectDir`, XDG path resolution, the hook programs and session recovery under `programs/`, the `./testing` presets, the no-`process` rule |
| [./components/plugin.md](./components/plugin.md) | `AgentPlugin`, the internal `AgentReporter` lifecycle class (with streaming hooks and the `onRunEvent` tap), `CoverageAnalyzer`, reporter-side utilities, coverage threshold extraction, the per-executor console matrix, the carrier bins, the workspace-layering and packed-install tests |
| [./components/discover.md](./components/discover.md) | `AgentPlugin.discover()`, the `DiscoverBuilder` thenable, `discoverProjects`, the `DiscoverStrategy` contract, the classifier helpers and the tag-injection transform |
| [./components/reporter.md](./components/reporter.md) | the default reporter package and custom-reporter reference: `DefaultVitestAgentReporter`, the live Ink mount it owns, the contract re-exports plus `buildDispatchInputs` / `resolveCellOptions` dispatch helpers |
| [./components/ui.md](./components/ui.md) | pure rendering-primitives library: `RunEvent` reducer, shape-tailored dispatcher matrix and its 12 cells, L1 MCP tool-pointer footer, synthesizers, `RunEventChannel` PubSub. No reporter or live mount after the reporter-package restructure |
| [./components/cli.md](./components/cli.md) | CLI commands (`doctor`, `db`, the `agent` namespace), the `record` subcommand and its hook-driven actions, the `bin.ts` / `main.ts` / `index.ts` entry contract, the process-boundary allowlist |
| [./components/mcp.md](./components/mcp.md) | the Effect-native MCP server: `ServerLayer`, `registerStrictToolkit`, the toolkit and per-tool files, `McpSession`, the `withIdempotency` combinator, channel-event resolution, `PromptsLayer`, `main.ts` and the in-process harness |
| [./components/sidecar.md](./components/sidecar.md) | the `@vitest-agent/sidecar` SEA binary for the per-Bash `inject-env` hot path, tsdown `exe` build, per-platform `optionalDependencies`, the binary-vs-JS-fallback contract |
| [./components/plugin-claude.md](./components/plugin-claude.md) | the Claude Code plugin: hooks, the TDD orchestrator agent, skills, slash commands, the dogfood system, the MCP loader |
| [./components/docs-site.md](./components/docs-site.md) | the `docs` workspace at `website/`: the RSPress 2.0 site, its Guide/Packages IA, the api-extractor generation pipeline (`apiModel.localPaths` → `website/lib/models`), the committed snapshot db and the Cloudflare Pages deploy |

Each sub-file is self-contained for its package and cross-references
[./decisions.md](./decisions.md) and [./schemas.md](./schemas.md)
where the rationale or schema details live.
