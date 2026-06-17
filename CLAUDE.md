# CLAUDE.md

This file provides guidance to Claude Code when working with code in this
repository.

## Workspace Layout

This is a pnpm monorepo. Workspaces are defined in `pnpm-workspace.yaml`:

| Workspace | Path | Purpose |
| --------- | ---- | ------- |
| `@vitest-agent/sdk` | `packages/sdk/` | Shared schemas, data layer, services, formatters, utilities, public reporter + dispatcher contracts (no internal deps) |
| `@vitest-agent/plugin` | `packages/plugin/` | Vitest plugin (`AgentPlugin`), internal reporter class, `CoverageAnalyzer`, `ConfigValidation`, `ReporterLive` |
| `@vitest-agent/reporter` | `packages/reporter/` | Default reporter package and reference package for custom-reporter authors: ships `DefaultVitestAgentReporter`, owns the Ink live-mount lifecycle (`_createLiveInk`), re-exports the `VitestAgentReporterFactory` contract types from sdk plus the dispatch helpers from ui |
| `@vitest-agent/cli` | `packages/cli/` | CLI bin (`vitest-agent`) |
| `@vitest-agent/mcp` | `packages/mcp/` | MCP server bin (`vitest-agent-mcp`) |
| `@vitest-agent/ui` | `packages/ui/` | Pure rendering-primitives library: shape-tailored dispatcher matrix (run-shape x outcome cells), reducer, agent + Ink render paths, synthesizers, PubSub channel. Knows nothing about the reporter lifecycle |
| `@vitest-agent/sidecar` | `packages/sidecar/` | Node Single Executable Application binary for the per-Bash-call `inject-env` hot path; prebuilt per-platform binaries ship via `optionalDependencies` |
| `docs` | `website/` | RSPress 2.0 user-facing documentation site for the whole family, deployed to `https://vitest-agent.dev` via Cloudflare Pages. Private (never published), versions independently |
| `playground` | `playground/` | Dogfooding sandbox — intentionally imperfect code for agent demos |

The seven publishable packages live under `packages/`. The `docs` site (`website/`) is a private workspace — it renders documentation and is never published. Four
per-platform sub-packages (`@vitest-agent/sidecar-{darwin-arm64,linux-arm64,linux-x64,win32-x64}` under `packages/sidecar-*/`) carry the prebuilt sidecar binaries and are pulled in as `optionalDependencies` of `@vitest-agent/sidecar`. The `plugin/` directory at the repo root is a file-based Claude Code plugin (NOT a pnpm workspace). Root-level configs (`turbo.json`, `biome.jsonc`, etc.) apply to all workspaces. To scope commands to a specific package, use `--filter='./packages/<name>'`.

The six original packages release in lockstep; `@vitest-agent/sidecar` is a new package that versions independently of that group. `@vitest-agent/plugin` declares `@vitest-agent/cli` and `@vitest-agent/mcp` as required `peerDependencies` (alongside the Vitest-side peers `vitest`, `@vitest/runner`, `@vitest/coverage-v8`, `@vitest/coverage-istanbul`), plus regular workspace `dependencies` on `@vitest-agent/reporter` and `@vitest-agent/sdk`. Required peers are still pulled for a published consumer — npm 7+ and pnpm (`autoInstallPeers: true`) auto-install required peers, and the published plugin carries concrete registry version ranges — so declaring `@vitest-agent/plugin` transitively brings `@vitest-agent/cli` and `@vitest-agent/mcp`, with their bins landing at the consumer's top level. The dependency flow is `plugin → reporter → ui → sdk`: the plugin no longer depends on `@vitest-agent/ui` (or `react` / `ink`) directly — `@vitest-agent/reporter` supplies the default reporter and the Ink live mount, and pulls `ui` / `react` / `ink` transitively. `@vitest-agent/sidecar` reaches a consumer transitively: it is a regular `dependency` of `@vitest-agent/cli`, which is itself a required peer of the plugin, so installing the plugin pulls `@vitest-agent/sidecar` and its four per-platform `optionalDependencies` automatically. In the dev workspace, the plugin's peers are `workspace:*` ranges that `autoInstallPeers` cannot satisfy from the registry, so the workspace root `package.json` declares `@vitest-agent/cli` and `@vitest-agent/mcp` directly as devDependencies, and `pnpm-workspace.yaml` adds a `publicHoistPattern` for both so their bins land in the root `node_modules/.bin` for the dogfood Claude Code plugin hooks; the root no longer lists `@vitest-agent/reporter`, `@vitest-agent/sidecar`, or `@vitest-agent/ui` directly.
Users typically configure the plugin with just
`AgentPlugin({ console, coverageTargets, transport? })` — the plugin
injects `DefaultVitestAgentReporter` from `@vitest-agent/reporter`, which
owns rendering and the Ink live mount end to end. Custom reporters
arrive via the plugin's `reporter` option. The Claude Code plugin's SessionStart hook resolves the
sidecar binary path once per session via `vitest-agent agent sidecar-path`,
exports `VITEST_AGENT_SIDECAR_BIN`; the PreToolUse Bash hook reads that
env var to exec the binary directly, falling back to the JS CLI when absent.
The six non-sidecar packages pin `@vitest-agent/sdk` at `workspace:*`.

**Legacy naming — watch out.** Pre-2.0 this whole system was one package, `vitest-agent-reporter`. The 2.0 split renamed that package to `@vitest-agent/reporter` at `packages/reporter/`; as of the 2.0 reporter-restructure that package ships `DefaultVitestAgentReporter` and owns the Ink live-mount lifecycle. The Vitest API lifecycle (persistence, classification, baselines, trends) lives in `@vitest-agent/plugin` at `packages/plugin/`. Prose and comments still occasionally say `vitest-agent-reporter` in the legacy whole-system sense when they should say `@vitest-agent/plugin` — update references as you encounter them.

## Project Status

**Pre-2.0 release: no backwards compatibility, no migration discipline.**
`vitest-agent` 2.0 has not shipped to npm. Every dev install on every
machine is disposable — when the schema changes, developers delete their
local `data.db` and start fresh. This means: do NOT write multi-step
SQLite migrations for schema changes that land before 2.0. Edit
`packages/sdk/src/migrations/0001_initial.ts` directly to define the
canonical shape; a single fresh-install migration is the entire migration
chain until 2.0 ships. Don't add `0003_*.ts`, don't ALTER, don't backfill
— just change the canonical schema. Same applies to breaking renames in
the SDK schemas, MCP tool surface, CLI flags, and any other public-facing
shape: pre-2.0 is the moment to break things cleanly. Post-2.0, the
standard incremental migration discipline applies.

`vitest-agent` 2.0 is a Vitest reporter, plugin, CLI, and MCP server family
for LLM coding agents. Six primary capabilities:

1. **`AgentPlugin` + `AgentReporter`** -- Vitest plugin (>= 4.1.0) with
   four-environment detection, reporter chain management, a `ConfigValidation`
   Effect service for coverage-config diagnostics, Full and UI-only operating
   modes gated by Vitest's native `coverage.enabled`, and pluggable rendering
   via `VitestAgentReporterFactory`.
2. **`vitest-agent` CLI** -- `@effect/cli`-based utility-only bin with a
   three-command tree: `doctor`, `db` (`path` / `prune` / `reset` /
   `query`), and `agent` -- a namespace for hook-driven plumbing
   (`triage`, `wrapup`, `record`, `register-agent`, `end-agent`,
   `inject-env`, `sidecar-path`). Test-landscape queries (status, overview, coverage,
   history, trends) moved to the MCP server. `--format` is scoped to
   `agent triage`, `agent wrapup`, `doctor`, and `db query`.
3. **Suggested actions & failure history** -- actionable suggestions in
   console output, per-test failure persistence, and test classification
   (`stable`, `new-failure`, `persistent`, `flaky`, `recovered`).
4. **Coverage policy, baselines, and trends** -- typed `coverageTargets`
   schema, dual-output `AgentPlugin.COVERAGE_LEVELS` /
   `COVERAGE_LEVELS_PER_FILE` presets that return `{ thresholds,
   coverageTargets }`, three `AgentPlugin.COVERAGE_AUTOUPDATE` tolerance
   functions that pass straight into Vitest's native
   `coverage.thresholds.autoUpdate`, and per-project trend tracking.
   Users set `coverage.thresholds` directly on Vitest's native config; the
   plugin's `ConfigValidation` service catches mismatches against
   `coverageTargets`.
5. **MCP server** -- 29 MCP tools via tRPC router. Action-keyed surface:
   per-CRUD families collapse into one tool each (`tdd_task`, `tdd_goal`,
   `tdd_behavior`, `note`, `hypothesis`, `inventory`, `test`) that dispatch
   on an `action` / `kind` discriminator. Also: `register_agent`,
   `tdd_artifact_list`, four MCP resources under two URI schemes
   (`vitest://docs/` and `vitest-agent://patterns/`), and six framing-only
   prompts.
6. **Claude Code plugin** -- file-based plugin at `plugin/` distributed via
   the Claude marketplace as `vitest-agent@spencerbeggs`. Ships a PM-detect
   spawn loader, lifecycle hooks, the `tdd-task` subagent (`context:fork`),
   `/tdd` slash command, and 15 skills (one TDD workflow skill, nine
   preloaded TDD primitives, one path-triggered test-layout skill, plus
   four standalone reference skills). The plugin is the primary AI
   integration surface — the npm packages collect and store data; the
   plugin turns that data into agent behavior. The plugin's PreToolUse
   Bash hook routes the `inject-env` hot path through the
   `@vitest-agent/sidecar` native binary (path resolved once per session by SessionStart and exported as `VITEST_AGENT_SIDECAR_BIN`), falling back to the JS CLI when
   the per-platform binary is absent.

Effect service architecture: I/O encapsulated in Effect services with live
and test layer implementations. All data structures use Effect Schema
definitions. Schemas are re-exported from `@vitest-agent/sdk` for consumer use.

**For architecture details (progressive loading — load only what you need):**

- `@./.claude/design/vitest-agent/architecture.md`
  Load when you need a system overview, package diagram, or to find which
  sub-doc covers a topic. This is the hub.
- `@./.claude/design/vitest-agent/components/<package>.md`
  Per-package deep dives (`sdk.md`, `plugin.md`, `reporter.md`, `cli.md`,
  `mcp.md`, `ui.md`, `plugin-claude.md`). Load only the file for the
  package you are touching.
- `@./.claude/design/vitest-agent/components/docs-site.md`
  Load when working on the `docs` site (`website/`): its Guide/Packages IA,
  the api-extractor model wiring, the committed snapshot db, or the
  Cloudflare deploy.
- `@./.claude/design/vitest-agent/schemas.md`
  Load when working with TypeScript types, Effect Schema definitions, or
  the SQLite tables.
- `@./.claude/design/vitest-agent/data-flows.md`
  Load when tracing one of the seven runtime flows (test run, CLI query,
  MCP tool call, TDD session, etc.).
- `@./.claude/design/vitest-agent/file-structure.md`
  Load when working on the repo layout, XDG path resolution, project keying
  - tag classification, or PM detection.
- `@./.claude/design/vitest-agent/decisions.md`
  Load when you need to understand "why" a design choice was made. Retired
  decisions live in `decisions-retired.md`.
- `@./.claude/design/vitest-agent/testing-strategy.md`
  Load when writing tests or reviewing testing patterns and coverage.

**For Claude Code plugin details:**

- `@./.claude/design/vitest-agent/components/plugin-claude.md`
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

## Cross-package version drift

The six original runtime packages release in lockstep; `@vitest-agent/sidecar` and the Claude Code marketplace plugin (`vitest-agent@spencerbeggs`) each version independently.
If you see a `[@vitest-agent/<pkg>] version drift: …` line on stderr
during a Vitest run, MCP startup, or CLI invocation, the imported
`@vitest-agent/*` versions do not match. The warning is informational —
the run continues — but it usually means a partially-upgraded install.
Reinstall the `@vitest-agent/*` packages so the versions match.

The check is wired at three points: the top of the `AgentPlugin()`
factory (compares against `CURRENT_SDK_VERSION` and
`CURRENT_REPORTER_VERSION`; one warning per mismatched peer, suppressed
after the first call in the same process), inside the `vitest-agent-mcp`
bin's `main()` (compares against `CURRENT_SDK_VERSION`), and at the top of
the `vitest-agent` CLI bin before `Command.run` (compares against
`CURRENT_SDK_VERSION`). Each runtime package exposes a
`CURRENT_<PKG>_VERSION` constant inlined by rslib-builder's
`process.env.__PACKAGE_VERSION__` substitution at build time, sourced
from the package's own `package.json#version`.

## Build Pipeline

This project uses
[@savvy-web/rslib-builder](https://github.com/savvy-web/rslib-builder) to
produce dual build outputs via [Rslib](https://rslib.rs/) for each package:

| Output | Directory | Purpose |
| ------ | --------- | ------- |
| Development | `packages/<name>/dist/dev/` | Local development with source maps |
| Production | `packages/<name>/dist/npm/` | Published to npm |

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

**For build pipeline and tooling rationale:**

- `@./.claude/design/vitest-agent/architecture.md`
  Load when you need the cross-package build, publish, or release-flow
  context behind these conventions.

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
in `biome.jsonc` extends `@savvy-web/silk/biome`.

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
  (`import { DataStore } from "@vitest-agent/sdk"`),
  never relative paths across package boundaries.

### Commits

All commits require:

1. Conventional commit format (`feat`, `fix`, `chore`, etc.).
2. DCO signoff: `Signed-off-by: Name <email>`.

### Publishing

All seven packages publish to npm with
provenance via the [@savvy-web/changesets](https://github.com/savvy-web/changesets)
release workflow. The six original packages release in lockstep; `@vitest-agent/sidecar` versions independently.

## Testing

- **Framework**: [Vitest](https://vitest.dev/) `^4.1.5` with v8
  coverage provider.
- **Pool**: Uses `forks` (not threads) for broader compatibility.
- **Config**: `vitest.config.ts` at the repo root is an async function
  that calls `AgentPlugin.discover()` to auto-detect projects and tag
  declarations, destructures `{ projects, tags }`, and threads both into
  `defineConfig({ test: { projects, tags } })`. Project-based filtering
  is still available via `--project`; test-kind filtering moved to
  Vitest-native tag expressions (e.g. `--tags-filter "int"`).
- **Test file layout**: Tests live in `packages/*/__test__/*.test.ts`
  (flat directory). The default discovery strategy also recognises
  tests co-located under `src/` for backward compatibility.
  Test-kind differentiation comes from `DiscoverStrategy.classify`
  (default classifies `.e2e.`, `.int.`, and otherwise `unit` by
  filename), not from project splits — there is one Vitest project
  per workspace package.
- **CI**: `pnpm run ci:test` sets `CI=true` and enables coverage.

**For detailed testing and discovery guidance:**

- `@./.claude/design/vitest-agent/testing-strategy.md`
  Load when writing tests, reviewing patterns, or understanding coverage targets.
- `@./.claude/design/vitest-agent/components/discover.md`
  Load when working on `AgentPlugin.discover()`, the `DiscoverBuilder`
  thenable, `discoverProjects()`, the `DiscoverStrategy` contract, or
  the classifier helpers.
