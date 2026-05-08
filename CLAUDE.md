# CLAUDE.md

This file provides guidance to Claude Code when working with code in this
repository.

## Workspace Layout

This is a pnpm monorepo. Workspaces are defined in `pnpm-workspace.yaml`:

| Workspace | Path | Purpose |
| --------- | ---- | ------- |
| `vitest-agent-sdk` | `packages/sdk/` | Shared schemas, data layer, services, formatters, utilities (no internal deps) |
| `vitest-agent-plugin` | `packages/plugin/` | Vitest plugin (`AgentPlugin`), internal reporter class, `CoverageAnalyzer`, `ReporterLive` |
| `vitest-agent-reporter` | `packages/reporter/` | Named `VitestAgentReporterFactory` implementations (no Vitest-API code) |
| `vitest-agent-cli` | `packages/cli/` | CLI bin (`vitest-agent`) |
| `vitest-agent-mcp` | `packages/mcp/` | MCP server bin (`vitest-agent-mcp`) |
| `playground` | `playground/` | Dogfooding sandbox — intentionally imperfect code for agent demos |

The five publishable packages live under `packages/`. The `plugin/`
directory at the repo root is a file-based Claude Code plugin (NOT a pnpm
workspace). Root-level configs (`turbo.json`, `biome.jsonc`, etc.) apply
to all workspaces. To scope commands to a specific package, use
`--filter='./packages/<name>'`.

The five packages release in lockstep; `vitest-agent-plugin` declares
`vitest-agent-reporter`, `vitest-agent-cli`, and `vitest-agent-mcp` as
required `peerDependencies`, and all five pin `vitest-agent-sdk` at
`workspace:*`.

**Legacy naming — watch out.** This whole system was originally a single
package called `vitest-agent-reporter` (pre-2.0). The 2.0 split kept that
name for the renderer-only package at `packages/reporter/`, while the
plugin lifecycle that used to live alongside the reporter now lives in
`vitest-agent-plugin` at `packages/plugin/`. Doc comments, tests, and
internal references throughout the codebase still occasionally use
`vitest-agent-reporter` in the legacy sense (meaning the whole system)
when they should say `vitest-agent-plugin`. When you encounter a
`vitest-agent-reporter` reference in prose or comments, check whether
it actually means the modern renderer package or whether it's a
dangling reference to what is now `vitest-agent-plugin`. Update as you
go.

## Project Status

`vitest-agent` 2.0 is a Vitest reporter, plugin, CLI, and MCP server family
for LLM coding agents. Six primary capabilities:

1. **`AgentPlugin` + `AgentReporter`** -- Vitest plugin (>= 4.1.0) with
   four-environment detection, reporter chain management, coverage threshold
   extraction, and pluggable rendering via `VitestAgentReporterFactory`.
2. **`vitest-agent` CLI** -- `@effect/cli`-based bin with `status`,
   `overview`, `coverage`, `history`, `trends`, `cache`, `doctor`, `record`,
   `triage`, and `wrapup` subcommands. All commands support `--format`.
3. **Suggested actions & failure history** -- actionable suggestions in
   console output, per-test failure persistence, and test classification
   (`stable`, `new-failure`, `persistent`, `flaky`, `recovered`).
4. **Coverage thresholds, baselines, and trends** -- Vitest-native
   `coverageThresholds`, aspirational `coverageTargets`, and auto-ratcheting
   baselines with per-project trend tracking.
5. **MCP server** -- 50 MCP tools via tRPC router, three-tier
   Objective→Goal→Behavior TDD hierarchy (10 CRUD tools), four MCP resources
   under two URI schemes (`vitest://docs/` and `vitest-agent://patterns/`),
   and six framing-only prompts.
6. **Claude Code plugin** -- file-based plugin at `plugin/` distributed via
   the Claude marketplace as `vitest-agent@spencerbeggs`. Ships a PM-detect
   spawn loader, lifecycle hooks, the `tdd-task` subagent (`context:fork`),
   `/tdd` slash command, and 14 sub-skill primitives. The plugin is the
   primary AI integration surface — the npm packages collect and store data;
   the plugin turns that data into agent behavior.

Effect service architecture: I/O encapsulated in Effect services with live
and test layer implementations. All data structures use Effect Schema
definitions. Schemas are re-exported from `vitest-agent-sdk` for consumer use.

**For architecture details (progressive loading — load only what you need):**

- `.claude/design/vitest-agent/architecture.md`
  Load when you need a system overview, package diagram, or to find which
  sub-doc covers a topic. This is the hub.
- `.claude/design/vitest-agent/components/<package>.md`
  Per-package deep dives (`sdk.md`, `plugin.md`, `reporter.md`, `cli.md`,
  `mcp.md`, `plugin-claude.md`). Load only the file for the package you
  are touching.
- `.claude/design/vitest-agent/schemas.md`
  Load when working with TypeScript types, Effect Schema definitions, or
  the SQLite tables.
- `.claude/design/vitest-agent/data-flows.md`
  Load when tracing one of the seven runtime flows (test run, CLI query,
  MCP tool call, TDD session, etc.).
- `.claude/design/vitest-agent/file-structure.md`
  Load when working on the repo layout, XDG path resolution, project keying
  - tag classification, or PM detection.
- `.claude/design/vitest-agent/decisions.md`
  Load when you need to understand "why" a design choice was made. Retired
  decisions live in `decisions-retired.md`.
- `.claude/design/vitest-agent/testing-strategy.md`
  Load when writing tests or reviewing testing patterns and coverage.

**For Claude Code plugin details:**

- `.claude/design/vitest-agent/components/plugin-claude.md`
  Load for the design doc covering hooks, the tdd-task agent, skills,
  commands, the MCP loader, and the dogfood workflow.
- `plugin/CLAUDE.md`
  Load for the file-based plugin's directory layout and quick-reference
  tables (hooks, skills, commands, hot-reload cost matrix).

## Database Location

The SQLite `data.db` lives at a deterministic XDG-derived path:

```text
$XDG_DATA_HOME/vitest-agent/<workspaceKey>/data.db
```

`<workspaceKey>` is the root `package.json` `name`, normalized for
filesystem safety (`@org/pkg` -> `@org__pkg`). Falls back to
`~/.local/share/vitest-agent/<workspaceKey>/data.db` when `XDG_DATA_HOME`
is unset.

Resolution precedence (highest first):

1. Programmatic `reporterOptions.cacheDir` option.
2. `cacheDir` field in `vitest-agent.config.toml` at the workspace root.
3. `projectKey` field in `vitest-agent.config.toml`.
4. Normalized workspace `name` (default).

Fails loudly with `WorkspaceRootNotFoundError` if no identity is resolvable.
No silent fallback to a path hash.

## Build Pipeline

This project uses
[@savvy-web/rslib-builder](https://github.com/savvy-web/rslib-builder) to
produce dual build outputs via [Rslib](https://rslib.rs/) for each package:

| Output | Directory | Purpose |
| ------ | --------- | ------- |
| Development | `packages/<name>/dist/dev/` | Local development with source maps |
| Production | `packages/<name>/dist/npm/` | Published to npm and GitHub Packages |

Each source `package.json` is marked `"private": true` — **this is
intentional and correct**. The rslib-builder `transform()` callback rewrites
`exports`, sets `private: false`, and strips devDependencies on publish. Never
manually set `"private": false` in a source `package.json`.

Turbo orchestration: `types:check` runs first, then `build:dev` and
`build:prod` both depend on it. Cache excludes `*.md`, `.changeset/**`,
`.claude/**`, `.github/**`.

### Savvy-Web Tool References

| Package | Purpose | GitHub |
| ------- | ------- | ------ |
| rslib-builder | Build pipeline, dual output | [savvy-web/rslib-builder](https://github.com/savvy-web/rslib-builder) |
| commitlint | Conventional commit + DCO enforcement | [savvy-web/commitlint](https://github.com/savvy-web/commitlint) |
| changesets | Versioning, changelogs, release management | [savvy-web/changesets](https://github.com/savvy-web/changesets) |
| lint-staged | Pre-commit file linting via Biome | [savvy-web/lint-staged](https://github.com/savvy-web/lint-staged) |

TypeScript configuration in each package extends from:
`@savvy-web/rslib-builder/tsconfig/ecma/lib.json`.

## Commands

### Development

```bash
pnpm run lint              # Check code with Biome
pnpm run lint:fix          # Auto-fix lint issues
pnpm run lint:fix:unsafe   # Auto-fix including unsafe transforms
pnpm run lint:md           # Check markdown with markdownlint
pnpm run lint:md:fix       # Auto-fix markdown issues
pnpm run typecheck         # Type-check all packages via Turbo (runs tsgo per package)
pnpm run test              # Run all tests across all packages
pnpm run test:watch        # Run tests in watch mode
pnpm run test:coverage     # Run tests with v8 coverage report
```

### Building

```bash
pnpm run build             # Build the reporter package (dev + prod) via Turbo
pnpm run ci:build          # Same with CI=true and grouped output
```

To build a specific package, use the Turbo filter:

```bash
turbo run build:dev build:prod --filter='./packages/sdk'
turbo run build:dev build:prod --filter='./packages/cli'
turbo run build:dev build:prod --filter='./packages/mcp'
```

### Running a Specific Test

```bash
pnpm vitest run packages/sdk/__test__/resolve-data-path.test.ts
```

## Code Quality and Hooks

### Biome

Unified linter and formatter replacing ESLint + Prettier. Configuration
in `biome.jsonc` extends `@savvy-web/lint-staged/biome/silk.jsonc`.

### Commitlint

Enforces conventional commit format with DCO signoff. Configuration in
`lib/configs/commitlint.config.ts` uses the `CommitlintConfig.silk()`
preset.

### Husky Git Hooks

| Hook | Action |
| ---- | ------ |
| `pre-commit` | Runs lint-staged (Biome on staged files) |
| `commit-msg` | Validates commit message format via commitlint |
| `pre-push` | Runs tests for affected packages using Turbo |
| `post-checkout` | Package manager setup |
| `post-merge` | Package manager setup |

## Conventions

### Imports

- Use `.js` extensions for relative imports (ESM requirement).
- Use `node:` protocol for Node.js built-ins (e.g.,
  `import fs from 'node:fs'`).
- Separate type imports: `import type { Foo } from './bar.js'`.
- Cross-package imports use the package name
  (`import { DataStore } from "vitest-agent-sdk"`),
  never relative paths across package boundaries.

### Commits

All commits require:

1. Conventional commit format (`feat`, `fix`, `chore`, etc.).
2. DCO signoff: `Signed-off-by: Name <email>`.

### Publishing

The five packages publish to both GitHub Packages and npm with
provenance via the [@savvy-web/changesets](https://github.com/savvy-web/changesets)
release workflow. Releases happen in lockstep.

## Testing

- **Framework**: [Vitest](https://vitest.dev/) `^4.1.5` with v8
  coverage provider.
- **Pool**: Uses `forks` (not threads) for broader compatibility.
- **Config**: `vitest.config.ts` at the repo root is an async function
  that calls `AgentPlugin.discover()` to auto-detect projects and tag
  declarations, destructures `{ projects, tags }`, and threads both into
  `defineConfig({ test: { projects, tags } })`. Project-based filtering
  is still available via `--project`; test-kind filtering moved to
  Vitest-native tag expressions (e.g. `--test-name-pattern` or `-t int`).
- **Test file layout**: Tests live in `packages/*/__test__/*.test.ts`
  (flat directory). The `discoverProjects` scanner also recognises
  tests co-located under `src/` for backward compatibility.
  Test-kind differentiation comes from `TagStrategy` (default classifies
  `.e2e.`, `.int.`, and otherwise `unit` by filename), not from project
  splits — there is one Vitest project per workspace package.
- **CI**: `pnpm run ci:test` sets `CI=true` and enables coverage.

**For detailed testing and discovery guidance:**

- `.claude/design/vitest-agent/testing-strategy.md`
  Load when writing tests, reviewing patterns, or understanding coverage targets.
- `.claude/design/vitest-agent/components/discover.md`
  Load when working on `AgentPlugin.discover()`, `discoverProjects()`,
  `VitestProject`, or `DiscoveryOptions`.
