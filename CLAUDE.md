# CLAUDE.md

This file provides guidance to Claude Code when working with code in this
repository.

## Workspace Layout

This is a pnpm monorepo. Workspaces are defined in `pnpm-workspace.yaml`:

| Workspace | Path | Purpose |
| --------- | ---- | ------- |
| `@vitest-agent/sdk` | `packages/sdk/` | Platform-free core: Effect Schemas, public reporter + dispatcher contracts, tagged errors, pure formatters and utils, the pure `./dispatch` entry, `./schemas/*.json` (no internal deps, no `node:`) |
| `@vitest-agent/engine` | `packages/engine/` | Platform half: Effect services and Live layers, SQLite client/migrator (`makeSqliteStack`), migrations, `PlatformLive` (the one platform layer both front ends provide), `resolveProjectDir`, hook programs, session recovery, `./testing` |
| `@vitest-agent/plugin` | `packages/plugin/` | Vitest plugin (`AgentPlugin`), internal reporter class, `CoverageAnalyzer`, `ConfigValidation`, `ReporterLive`; the carrier that declares the `vitest-agent` and `vitest-agent-mcp` bins |
| `@vitest-agent/reporter` | `packages/reporter/` | Default reporter package and reference package for custom-reporter authors: ships `DefaultVitestAgentReporter`, owns the Ink live-mount lifecycle (`_createLiveInk`), re-exports the `VitestAgentReporterFactory` contract types from sdk plus the dispatch helpers from ui |
| `@vitest-agent/cli` | `packages/cli/` | CLI bin (`vitest-agent`) |
| `@vitest-agent/mcp` | `packages/mcp/` | MCP server bin (`vitest-agent-mcp`) |
| `@vitest-agent/ui` | `packages/ui/` | Pure rendering-primitives library: shape-tailored dispatcher matrix (run-shape x outcome cells), reducer, agent + Ink render paths, synthesizers, PubSub channel. Knows nothing about the reporter lifecycle |
| `@vitest-agent/sidecar` | `packages/sidecar/` | Node Single Executable Application binary for the per-Bash-call `inject-env` hot path; prebuilt per-platform binaries ship via `optionalDependencies` |
| `docs` | `website/` | RSPress 2.0 user-facing documentation site for the whole family, deployed to `https://vitest-agent.dev` via Cloudflare Pages. Private (never published), versions independently |
| `playground` | `playground/` | Dogfooding sandbox — intentionally imperfect code for agent demos |
| `@vitest-agent/claude-code-plugin` | `plugins/claude-code/` | File-based Claude Code plugin (hooks, skills, agents, commands). Private tracking package — versioned by changesets, never published to npm |

The eight publishable packages live under `packages/`; four per-platform sub-packages (`@vitest-agent/sidecar-{darwin-arm64,linux-arm64,linux-x64,win32-x64}` under `packages/sidecar-*/`) carry the prebuilt sidecar binaries as `optionalDependencies` of `@vitest-agent/sidecar`. The Claude Code plugin at `plugins/claude-code/` is a workspace member (`plugins/*`) whose private `package.json` exists only so changesets can version it. Root-level configs (`turbo.json`, `biome.jsonc`, etc.) apply to all workspaces; scope commands with `--filter='./packages/<name>'`.

**Layering (the rank rule, issue #412).** Every workspace edge points to a strictly lower rank; `cli` and `mcp` never import each other. Enforced by `packages/plugin/__test__/workspace-layering.test.ts` plus per-package `__test__/boundaries.test.ts` source scans.

| Rank | Package(s) | Runtime workspace deps |
| ---- | ---------- | ---------------------- |
| 1 | `sdk` | none |
| 2 | `ui`, `sidecar-*` | sdk |
| 3 | `engine`, `reporter`, `sidecar` | engine → sdk; reporter → ui, sdk; sidecar → the four `sidecar-*` (optional) |
| 4 | `cli`, `mcp` | engine, sdk (+ sidecar for cli) |
| 5 | `plugin` (carrier) | cli, mcp, reporter, engine, sdk |
| — | root `vitest-agent` (dev) | plugin only |

**The carrier.** `@vitest-agent/plugin` is the one package a consumer installs: it depends on cli/mcp (exact-pinned) and declares `bin.vitest-agent` / `bin.vitest-agent-mcp` itself as four-line shims over `@vitest-agent/cli/main` and `@vitest-agent/mcp/main`, because pnpm links only direct-dependency bins (proven under npm/pnpm/yarn/bun by `packages/plugin/__test__/bins-packed-install.e2e.test.ts`). No `publicHoistPattern`, pnpm plugin, or manual step is involved — the workspace root devDepends on the plugin only; rationale in `.claude/design/vitest-agent/decisions.md` Decision 70. Users configure `AgentPlugin({ console, coverageTargets, transport?, report? })`; the plugin injects `DefaultVitestAgentReporter` from `@vitest-agent/reporter` unless a custom `reporter` is passed.

**Legacy naming — watch out.** Pre-2.0 the whole system was one package, `vitest-agent-reporter`; prose that still says it in the whole-system sense means `@vitest-agent/plugin` (the reporter package now owns only rendering and the Ink mount). Likewise, `@vitest-agent/sdk` text older than the #412 split may describe services, layers, migrations, or `./testing` that now live in `@vitest-agent/engine`.

## Project Status

**Post-2.0: incremental migration discipline applies.** 2.x is published
and consumers carry real `data.db` history, so schema changes land as NEW
migrations: add `packages/engine/src/migrations/0003_*.ts` and onward
(`0002_test_artifacts.ts` exists), register each in `migrations/index.ts`'s
`PROJECT_MIGRATIONS`, and never edit `0001_initial.ts` in place. A dead
table may be dropped and recreated in a new migration; a table with data
must be ALTERed and backfilled. Breaking renames in SDK schemas, the MCP
tool surface, and CLI flags are majors with changesets, not free edits.

Six primary capabilities:

1. **`AgentPlugin` + `AgentReporter`** -- Vitest plugin (>= 5.0.0) with
   environment detection, reporter chain management, a `ConfigValidation`
   service for coverage-config diagnostics, Full and UI-only modes gated by
   Vitest's native `coverage.enabled`, and pluggable rendering via
   `VitestAgentReporterFactory`.
2. **`vitest-agent` CLI** -- `effect/unstable/cli`-based utility-only bin with a
   three-command tree: `doctor`, `db` (`path` / `prune` / `reset` /
   `query`), and `agent` -- a namespace for hook-driven plumbing
   (`triage`, `wrapup`, `record`, `register-agent`, `end-agent`,
   `inject-env`, `sidecar-path`, `check-test-path`). Test-landscape queries
   (status, overview, coverage, history, trends) moved to the MCP server.
   `--format` is scoped to `agent triage`, `agent wrapup`, `doctor`, and
   `db query`.
3. **Suggested actions & failure history** -- actionable suggestions in
   console output, per-test failure persistence, and test classification
   (`stable`, `new-failure`, `persistent`, `flaky`, `recovered`).
4. **Coverage policy, baselines, and trends** -- typed `coverageTargets`
   schema, dual-output `AgentPlugin.COVERAGE_LEVELS` /
   `COVERAGE_LEVELS_PER_FILE` presets that return `{ thresholds,
   coverageTargets }`, three `AgentPlugin.COVERAGE_AUTOUPDATE` tolerance
   functions that pass straight into Vitest's native
   `coverage.thresholds.autoUpdate`, and per-project trend tracking.
   `ConfigValidation` catches mismatches between Vitest's native
   `coverage.thresholds` and `coverageTargets`.
5. **MCP server** -- Effect-native: `effect/unstable/ai`'s `McpServer` over
   stdio, no MCP SDK, no tRPC, no zod. 30 tools (`Tool.make`, one file per
   tool in `packages/mcp/src/tools/`) gathered into one `Toolkit` and six
   framing-only prompts (`McpServer.prompt`). Action-keyed surface:
   per-CRUD families collapse into one tool each (`tdd_task`, `tdd_goal`,
   `tdd_behavior`, `note`, `hypothesis`, `inventory`, `test`) that dispatch
   on an `action` / `kind` discriminator; also `register_agent` and
   `tdd_artifact_list`. Every served input is strict at every object level
   (`registerStrictToolkit` rejects unknown keys naming the accepted params).
   `tdd_progress_push` rides the standard `notifications/message` frame
   (logger `vitest-agent/channel`), not a custom channel method.
6. **Claude Code plugin** -- file-based plugin at `plugins/claude-code/`
   distributed via the Claude marketplace as `vitest-agent@spencerbeggs`. Ships an
   MCP loader (`bin/start-mcp.sh`: execs the project's own
   `node_modules/.bin/vitest-agent-mcp`, else prints a PM-specific install
   line on stderr and falls back to `npx --yes @vitest-agent/mcp`), lifecycle
   hooks that resolve the CLI via `detect_vitest_agent_bin`
   (`VITEST_AGENT_CLI_CMD` override → relative `node_modules/.bin/vitest-agent`
   → `<pm> exec vitest-agent`), the `tdd-task` subagent (`context:fork`),
   `/tdd` slash command, and 15 skills (one TDD workflow skill, nine
   preloaded TDD primitives, one path-triggered test-layout skill, plus
   four standalone reference skills). The plugin is the primary AI
   integration surface. Its PreToolUse Bash hook routes the `inject-env`
   hot path through the `@vitest-agent/sidecar` binary (resolved once per
   session by SessionStart as `VITEST_AGENT_SIDECAR_BIN`), falling back to
   the JS CLI when absent.

Effect service architecture: I/O encapsulated in Effect services with live
and test layer implementations (`@vitest-agent/engine`). All data structures
use Effect Schema definitions, exported from the platform-free
`@vitest-agent/sdk` core for consumer use.

**For architecture details (progressive loading — load only what you need):**

- `@./.claude/design/vitest-agent/architecture.md`
  Load when you need a system overview, package diagram, or to find which
  sub-doc covers a topic. This is the hub.
- `.claude/design/vitest-agent/components/<package>.md` (a family, not one file)
  Per-package deep dives (`sdk.md`, `engine.md`, `plugin.md`, `reporter.md`,
  `cli.md`, `mcp.md`, `ui.md`, `sidecar.md`, `plugin-claude.md`). Load only
  the file for the package you are touching.
- `@./.claude/design/vitest-agent/components/docs-site.md`
  Load when working on the `docs` site (`website/`).
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
  Load for the "why" behind a design choice (Decision 70: the carrier;
  Decision 71: the layering / boundary rules). Retired decisions live in
  `decisions-retired.md`.
- `@./.claude/design/vitest-agent/testing-strategy.md`
  Load when writing tests or reviewing testing patterns and coverage.

**For Claude Code plugin details:** `@./.claude/design/vitest-agent/components/plugin-claude.md`
(hooks, tdd-task agent, skills, MCP loader, dogfood workflow) and
`plugins/claude-code/CLAUDE.md` (layout and quick-reference tables).

## Database Location

The SQLite `data.db` lives at a deterministic XDG-derived path:

```text
$XDG_DATA_HOME/vitest-agent/<workspaceKey>/data.db
```

`<workspaceKey>` is the root `package.json` `name`, normalized for
filesystem safety (`@org/pkg` -> `@org__pkg`). The documented fallback when
`XDG_DATA_HOME` is unset is `~/.local/share/vitest-agent/<workspaceKey>/data.db`.

Known discrepancy (pre-existing, tracked as a follow-up): with `XDG_DATA_HOME` unset the reporter/MCP route (`resolveDataPath`) currently lands at `~/.vitest-agent/<workspaceKey>/` via `@effected/xdg`'s fallback while the hook/sidecar route (`resolveHookPaths`) uses `~/.local/share/vitest-agent/<workspaceKey>/`.

Resolution precedence (highest first):

1. Programmatic `reporterOptions.cacheDir` option.
2. `cacheDir` field in `vitest-agent.config.toml` at the workspace root.
3. `projectKey` field in `vitest-agent.config.toml`.
4. Normalized workspace `name` (default).

Fails loudly with `WorkspaceRootNotFoundError` if no identity is resolvable — no silent path-hash fallback.

## Cross-package versioning

Every `@vitest-agent/*` package versions independently (no lockstep `fixed` group); a change bumps only that package plus a patch ripple to its workspace dependents (`updateInternalDependencies: "patch"`). Consumers only install `@vitest-agent/plugin`, so family version skew is invisible to them; the former runtime drift check was removed, and each package's `CURRENT_<PKG>_VERSION` (inlined at build time) is a public introspection API nothing imports internally.

The Claude Code plugin versions through the private `@vitest-agent/claude-code-plugin` tracking package; `.changeset/config.json` maps its `versionFiles` to `plugins/claude-code/.claude-plugin/plugin.json` `$.version`. Write changesets naming `@vitest-agent/claude-code-plugin` for plugin-only changes — bumping `@vitest-agent/plugin` for a plugin edit forces a pointless npm publish.

## Build Pipeline

This project uses
[@savvy-web/rslib-builder](https://github.com/savvy-web/rslib-builder) to
produce dual build outputs via [Rslib](https://rslib.rs/) for each package:

| Output | Directory | Purpose |
| ------ | --------- | ------- |
| Development | `packages/<name>/dist/dev/` | Local development with source maps |
| Production | `packages/<name>/dist/npm/` | Published to npm |

Each source `package.json` is marked `"private": true` — **intentional**: the
build `transform()` rewrites `exports`, sets `private: false`, and strips
devDependencies on publish. Never set `"private": false` in source.

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
pnpm run build             # Build every package (dev + prod) via Turbo
pnpm run ci:build          # Same with CI=true and grouped output
```

To build a specific package, use the Turbo filter:

```bash
turbo run build:dev build:prod --filter='./packages/sdk'
turbo run build:dev build:prod --filter='./packages/engine'
turbo run build:dev build:prod --filter='./packages/cli'
turbo run build:dev build:prod --filter='./packages/mcp'
```

Run `pnpm run build` (prod) before the packed-install e2e and rebuild
`dist/dev` before any e2e that spawns a built bin. The API Extractor / tsdoc
pass runs inside the build (`dist/<target>/issues.json`) and is not a user
command — dispatch `tsdoctor` when a build reports `ae-*` issues.

### Running a Specific Test

```bash
pnpm vitest run packages/engine/__test__/resolve-data-path.test.ts
```

## Code Quality and Hooks

Biome (`biome.jsonc`, extends `@savvy-web/silk/biome`) lints and formats; commitlint (`lib/configs/commitlint.config.ts`, `CommitlintConfig.silk()`) enforces conventional commits with DCO signoff. Husky: `pre-commit` runs lint-staged (Biome on staged files), `commit-msg` runs commitlint, `pre-push` runs tests for affected packages via Turbo, `post-checkout` / `post-merge` do package-manager setup.

## Conventions

### Imports

- Use `.js` extensions for relative imports (ESM requirement).
- Use `node:` protocol for Node.js built-ins (e.g.,
  `import fs from 'node:fs'`).
- Separate type imports: `import type { Foo } from './bar.js'`.
- Cross-package imports use the package name
  (`import { DataStore } from "@vitest-agent/engine"`,
  `import { AgentReport } from "@vitest-agent/sdk"`),
  never relative paths across package boundaries.
- **Static imports everywhere.** Dynamic `await import(...)` is not a house
  pattern; the single sanctioned exception is `packages/mcp/src/main.ts`
  (crash guards must register before the server graph evaluates).

### Entry points and package boundaries

- **Front-end entry contract** (`cli`, `mcp`): `src/bin.ts` is a shebang shim,
  `src/main.ts` owns the process and is exported at `./main` (so the carrier
  can ship the same bin), `src/index.ts` is a side-effect-free barrel, and
  `CURRENT_<PKG>_VERSION` lives in `src/version.ts`.
- **Boundary tests** (`packages/{sdk,engine,cli,mcp}/__test__/boundaries.test.ts`):
  sdk imports no `node:*` / `@effect/platform-node` / `@effect/sql-sqlite-node`
  / `@effected/*` and never reads `process`; engine never reads `process` with
  no allowlist and never imports a front end; cli and mcp read `process` only
  through narrow allowlists (`bin.ts`, `main.ts`, `version.ts`, plus
  `commands/**` or `tools/run-tests.ts`) and never import each other; the
  token `process.env.__PACKAGE_VERSION__` may appear only in each package's
  `version.ts`. Details: `.claude/design/vitest-agent/decisions.md`
  Decision 71 and `components/engine.md`.

### Dependencies

- Effect v4 collapsed the standalone `@effect/*` packages into `effect/unstable/*` namespaces (`effect/unstable/cli`, `effect/unstable/sql`, `effect/unstable/ai`). The only separate `@effect/*` packages left are `@effect/platform-node` and `@effect/sql-sqlite-node`. All pin `catalog:effect` (v4); `catalog:silk` is the v3 catalog. Rationale in the architecture design doc.

### Commits

All commits require:

1. Conventional commit format (`feat`, `fix`, `chore`, etc.).
2. DCO signoff: `Signed-off-by: Name <email>`.

### Publishing

All eight `packages/` workspaces (plus the four `sidecar-*` platform packages) publish to npm with
provenance via the [@savvy-web/changesets](https://github.com/savvy-web/changesets)
release workflow: one git tag per package (`@vitest-agent/<pkg>@<version>`) plus one GitHub Release per package. `@vitest-agent/claude-code-plugin` releases the same way minus the npm step (`privatePackages: { tag: true, version: true }`). The pre-2.0 unified `1.0.0`/`1.0.1` tags were retroactively split per package and no longer exist.

## Testing

- **Framework**: [Vitest](https://vitest.dev/) `^5.0.0` with v8
  coverage provider.
- **Pool**: Uses `forks` (not threads) for broader compatibility.
- **Config**: `vitest.config.ts` at the repo root is an async function
  that calls `AgentPlugin.discover()` to auto-detect projects and tag
  declarations, destructures `{ projects, tags }`, and threads both into
  `defineConfig({ test: { projects, tags } })`. Project-based filtering
  is still available via `--project` (shorthand `-p`); test-kind
  filtering moved to Vitest-native tag expressions (e.g.
  `--tags-filter "int"`).
- **Test file layout**: tests live in `packages/*/__test__/*.test.ts`
  (flat). A test file is discoverable only under a workspace package's
  `src/` or `__test__/`, anchored at the package root; only `fixtures/`,
  `snapshots/`, and `utils/` directly under `__test__/` are excluded
  (issue #251). The rule is `classifyTestPath` in `@vitest-agent/sdk`'s
  `utils/test-location.ts`. Test kind (`unit` / `int` / `e2e`) comes from
  `DiscoverStrategy.classify` by filename suffix — one Vitest project per
  workspace package.
- **Filesystem in tests**: mount an `@effected/memfs` virtual volume instead of building a real temp tree; new filesystem-walking code takes an injected port (`WalkerFileSystem` from `@vitest-agent/plugin`) rather than importing `node:fs` directly.
- **`.e2e.test.ts` is mandatory for anything that spawns a process** or
  runs Vitest in-process: a plain `.test.ts` classifies as `unit` (5 s
  timeout) and times out in CI; the `e2e` tag gives 120 s plus retry.
- **Guardrail suites**: the four `boundaries.test.ts` files and
  `packages/plugin/__test__/workspace-layering.test.ts` (a new package needs a
  rank in `__test__/utils/workspace-graph.ts`).
- **MCP tools**: `packages/mcp/__test__/utils/harness.ts` runs the real
  `ServerLayer` in-process over `Stdio.layerTest` queues (exact served schemas
  and wire results); only crash guards and process lifecycle need the spawned
  bin (`*.e2e.test.ts`).
- **Packed-install e2e**: `packages/plugin/__test__/bins-packed-install.e2e.test.ts`
  installs the packed plugin into a scratch consumer under four PMs; needs
  `pnpm run build` (prod) and network, skips otherwise.
- **Engine layers in unit tests**: `makeTestLayer(":memory:")` and the preset
  factories ship from `@vitest-agent/engine/testing`.
- **CI**: `pnpm run ci:test` sets `CI=true` and enables coverage.

**For detailed testing and discovery guidance:**

- `@./.claude/design/vitest-agent/testing-strategy.md`
  Load when writing tests, reviewing patterns, or understanding coverage targets.
- `@./.claude/design/vitest-agent/components/discover.md`
  Load when working on `AgentPlugin.discover()`, the `DiscoverBuilder`
  thenable, `discoverProjects()`, the `DiscoverStrategy` contract, the
  `WalkerFileSystem` port, or the classifier helpers.
