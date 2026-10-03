# Module

* [@vitest-agent/cli](cli.md) - A utility-only bin for LLM agents and humans — database management plus the hook-driven recording subcommands that populate SQLite with session/turn, TDD evidence, and workspace-history rows.
* [@vitest-agent/engine](engine.md) - The platform half of the sdk/engine split: Effect services and Live/Test layers, the SQLite databases assembled on @effected/store, XDG path resolution, hook-driven programs, and the one PlatformLive layer both front ends provide.
* [@vitest-agent/mcp](mcp.md) - The Model Context Protocol server (vitest-agent-mcp bin) exposing the action-keyed tool surface to LLM agents over stdio, built on Effect's native McpServer with no MCP SDK, tRPC, or zod.
* [@vitest-agent/plugin](plugin.md) - The carrier and the Vitest-API-aware half of the family: AgentPlugin, the internal AgentReporter lifecycle class, CoverageAnalyzer, ConfigValidation, and workspace discovery.
* [@vitest-agent/reporter](reporter.md) - The default VitestAgentReporterFactory, report files, the stream-mode live view's lifetime, and the reference surface for custom-reporter authors.
* [@vitest-agent/sdk](sdk.md) - The platform-free core of the vitest-agent family — schemas, contracts, errors, formatters, and pure utilities.
* [@vitest-agent/sidecar](sidecar.md) - A detached SEA binary spawned by the Claude Code hooks to remove Node cold-start from the per-Bash-call inject-env hot path, plus its four per-platform optionalDependencies children.
* [@vitest-agent/ui](ui.md) - The pure rendering-primitives library — the RunEvent reducer, shape-tailored dispatcher matrix, live Ink components, and synthesizers.
* [docs (website/)](website.md) - The RSPress 2.0 documentation site for the whole vitest-agent family, deployed to vitest-agent.dev via Cloudflare Pages, keyed off the plugin package's GitHub Release.
* [playground](playground.md) - A dogfooding sandbox workspace with intentional coverage gaps and a permanent deliberate bug, existing only as a live target for the Claude Code plugin's TDD orchestrator and MCP tools during development.
* [vitest-agent (Claude Code plugin)](claude-code-plugin.md) - The file-based Claude Code plugin at plugins/claude-code that turns the npm packages' persisted test data into agent behavior — hooks, a TDD orchestrator subagent, skill primitives, slash commands, and an MCP loader.
* [workspace](workspace.md) - The pnpm/Turbo monorepo root — workspace glob, build pipeline, tooling, and hooks shared by every package.
