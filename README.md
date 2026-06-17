# vitest-agent

Monorepo for the `vitest-agent` package family — a Vitest plugin, reporter, CLI, MCP server and Claude Code plugin that turn a test run into structured intelligence for LLM coding agents. It produces shape-tailored console output, persists every run to SQLite at an XDG-derived path and exposes test status, coverage, failure history and trends over a CLI and an MCP server.

User documentation lives at [vitest-agent.dev](https://vitest-agent.dev). This README is the developer-facing hub for working in the repo itself.

## Packages

The seven publishable packages live under `packages/`. `@vitest-agent/sdk` has no internal dependencies; the dependency flow is `plugin → reporter → ui → sdk`, with the sidecar reaching consumers through the CLI.

| Package | Path | Purpose |
| --- | --- | --- |
| `@vitest-agent/plugin` | [packages/plugin](./packages/plugin/) | Vitest plugin (`AgentPlugin`), internal reporter, `CoverageAnalyzer`, `ConfigValidation` |
| `@vitest-agent/reporter` | [packages/reporter](./packages/reporter/) | Default reporter (`DefaultVitestAgentReporter`) and the Ink live-mount lifecycle; reference for custom-reporter authors |
| `@vitest-agent/ui` | [packages/ui](./packages/ui/) | Rendering primitives: the shape-tailored dispatcher matrix, reducer, agent and Ink render paths, `RunEvent` PubSub channel |
| `@vitest-agent/sdk` | [packages/sdk](./packages/sdk/) | Shared schemas, data layer, services, formatters, utilities and the public reporter contracts |
| `@vitest-agent/cli` | [packages/cli](./packages/cli/) | `vitest-agent` CLI bin |
| `@vitest-agent/mcp` | [packages/mcp](./packages/mcp/) | `vitest-agent-mcp` MCP server bin |
| `@vitest-agent/sidecar` | [packages/sidecar](./packages/sidecar/) | Node Single Executable Application for the per-Bash-call `inject-env` hot path; ships prebuilt per-platform binaries |

The sidecar's per-platform binaries ship as `optionalDependencies` from four sub-packages — `@vitest-agent/sidecar-darwin-arm64`, `-linux-arm64`, `-linux-x64` and `-win32-x64` under `packages/sidecar-*/`. The six original packages release in lockstep; `@vitest-agent/sidecar` versions independently.

`@vitest-agent/plugin` declares `@vitest-agent/cli` and `@vitest-agent/mcp` as required peer dependencies, so a single `npm install @vitest-agent/plugin` pulls the whole family on npm 7+ and pnpm with `autoInstallPeers`.

## Private workspaces

| Workspace | Path | Purpose |
| --- | --- | --- |
| `docs` | [website](./website/) | RSPress 2.0 documentation site deployed to [vitest-agent.dev](https://vitest-agent.dev) |
| `playground` | [playground](./playground/) | Dogfooding sandbox — intentionally imperfect code for agent demos |

The Claude Code plugin lives at [`plugin/`](./plugin/) and is a file-based plugin, not a pnpm workspace — a directory of markdown, JSON, shell and a zero-deps Node loader consumed by the Claude Code plugin system. See [plugin/README.md](./plugin/README.md).

## Entry points

| Entry | Bin | Package | Purpose |
| --- | --- | --- | --- |
| Plugin | library import | `@vitest-agent/plugin` | Vitest plugin producing SQLite-persisted test data |
| CLI | `vitest-agent` | `@vitest-agent/cli` | Hook-driven plumbing plus `doctor`, `db` and `agent` commands |
| MCP server | `vitest-agent-mcp` | `@vitest-agent/mcp` | Action-keyed tools over stdio for LLM agent integration, plus MCP resources and prompts |

All three share the Effect service architecture and the same SQLite database, located under `$XDG_DATA_HOME/vitest-agent/<workspaceKey>/data.db` where `<workspaceKey>` derives from the root `package.json` `name`.

## Requirements

- Node.js (this repo pins a version via `devEngines`)
- pnpm (this repo pins a version via `packageManager`)

## Development

```bash
pnpm install
pnpm run build
pnpm run test
pnpm run lint
pnpm run typecheck
```

To scope a command to one package, use a Turbo filter:

```bash
turbo run build:dev build:prod --filter='./packages/sdk'
```

Contributors: see [CONTRIBUTING.md](./CONTRIBUTING.md) for the full setup, commit and code-quality workflow, and [docs/dogfooding.md](./docs/dogfooding.md) for testing the system against its own playground.

## Documentation

User-facing documentation — installation, configuration, the CLI and MCP reference, the Claude Code plugin and per-package guides — lives at [vitest-agent.dev](https://vitest-agent.dev). The site source is the [website](./website/) workspace.

## License

[MIT](LICENSE)
