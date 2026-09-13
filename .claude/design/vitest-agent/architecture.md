---
status: current
module: vitest-agent
category: architecture
created: 2026-03-20
updated: 2026-09-13
last-synced: 2026-09-13
completeness: 90
related:
  - ./components.md
  - ./decisions.md
  - ./schemas.md
  - ./data-flows.md
  - ./file-structure.md
  - ./testing-strategy.md
  - ./components/docs-site.md
  - ./components/engine.md
dependencies: []
---

# Architecture — `vitest-agent`

`vitest-agent` is a Vitest reporter, plugin, CLI and MCP server family that
captures test execution data into a SQLite database and exposes it to LLM
coding agents. A test run produces persisted runs, failures, coverage,
TDD lifecycle state and session/turn history; agents read that data through
the MCP server, the CLI or the file-based Claude Code plugin. This document
is the front door — load the sub-files below for the specifics.

The system is shaped around three layers stacked in importance: token
reduction in the reporter (necessary, not sufficient), persisted data in
SQLite (so failures are actionable across runs), and the Claude Code plugin's
TDD orchestrator (what turns the data into reliable agent behavior). The
agent+data+TDD loop is slower per cycle than ungated prompting, but it is
reliable enough that lower-tier subagents (Sonnet) succeed against tasks
dispatched by a stronger main model.

For the consumer, the integration is one install: add `@vitest-agent/plugin`
to a project, register `AgentPlugin()` in `vitest.config.ts`, and install
the Claude Code plugin from the marketplace. Declaring the plugin pulls in
the reporter, engine, CLI, MCP and sidecar packages — all regular
dependencies that install transitively — and, because the plugin is the
*carrier* that declares the `vitest-agent` and `vitest-agent-mcp` bins
itself, both bins land in the consumer's `node_modules/.bin` under every
package manager; the hook chain wires up; the Claude Code plugin's loader
execs that bin directly. No runtime configuration beyond the plugin call.

## Package landscape

The project is a pnpm monorepo. Eight publishable workspaces under `packages/`, the Claude Code plugin workspace at `plugins/claude-code/` and the `docs` documentation-site workspace at `website/`. `pnpm-workspace.yaml` globs `plugins/*`, so the Claude Code plugin is a workspace member like any other — the container is plural because hosting a second agent integration (a Copilot plugin) is a stated future goal, not because one exists today.

| Workspace | Path | Role |
| --- | --- | --- |
| `@vitest-agent/sdk` | `packages/sdk/` | The platform-free core (rank 1). Effect Schemas, the public reporter and dispatcher contracts, tagged errors, pure formatters and utilities, the pure `./dispatch` entry, the `RunEvent` / `RenderState` schemas and the published `./schemas/*.json` documents. No internal dependencies, no `node:` imports, no `process` reads — enforced by a boundary test. |
| `@vitest-agent/engine` | `packages/engine/` | The platform half (rank 3). Effect services and Live layers, the SQLite client and migrator (`makeSqliteStack`), migrations, `PlatformLive` (the one composite both front ends and the plugin provide), `resolveProjectDir`, the hook programs the CLI wraps, MCP session recovery, and the `./testing` presets. Depends on sdk only; reads no `process` anywhere. |
| `@vitest-agent/plugin` | `packages/plugin/` | The Vitest plugin and the family's **carrier** (rank 5). Owns the Vitest lifecycle, persistence, classification, baselines and trends, the run-event `PubSub` channel and the streaming-callback `onRunEvent` tap; injects a reporter factory and owns no rendering. Declares the `vitest-agent` and `vitest-agent-mcp` bins as 4-line shims over `@vitest-agent/cli/main` and `@vitest-agent/mcp/main`, so a consumer that installs only the plugin gets both bins. |
| `@vitest-agent/reporter` | `packages/reporter/` | The default reporter package and the reference package for custom-reporter authors. Ships `DefaultVitestAgentReporter` (the plugin's built-in factory, which owns the Ink live mount end to end), re-exports the contract types from the SDK plus the dispatch helpers, and declares `react` + `ink` as full deps. |
| `@vitest-agent/ui` | `packages/ui/` | Pure rendering-primitives library. The `RunEvent` reducer, the shape-tailored dispatcher matrix and its 12 cells, the L1 MCP tool-pointer footer, the synthesizers and the Effect `RunEventChannel` PubSub. Knows nothing about the reporter lifecycle. |
| `@vitest-agent/cli` | `packages/cli/` | The `vitest-agent` bin (rank 4). Utility-only for 2.0: `doctor`, `db` (path / prune / reset / query), and the `agent` namespace for hook-driven plumbing (triage, wrapup, record, sidecar) — thin `effect/unstable/cli` wrappers over engine programs. `bin.ts` / `main.ts` (`./main`) / `index.ts` entry contract. |
| `@vitest-agent/mcp` | `packages/mcp/` | The `vitest-agent-mcp` bin (rank 4). Effect-native `McpServer` over stdio: 30 `Tool.make` tools in one `Toolkit` registered under a strict-input contract, six framing-only `McpServer.prompt` prompts. Same entry contract. |
| `@vitest-agent/sidecar` | `packages/sidecar/` | Fast-path native binary for the per-Bash `inject-env` hot path. Ships a tsdown-built Node SEA executable distributed per-platform via four `optionalDependencies` sub-packages (`@vitest-agent/sidecar-{darwin-arm64,linux-arm64,linux-x64,win32-x64}`). |
| `@vitest-agent/claude-code-plugin` | `plugins/claude-code/` | Claude Code plugin distributed via the marketplace as `vitest-agent@spencerbeggs`. Hooks, the TDD orchestrator subagent, slash commands, sub-skill primitives, the MCP loader. A private workspace with no build, no scripts and no npm publish — its `package.json` exists only so changesets has something to version. |
| `docs` | `website/` | RSPress 2.0 documentation site deployed to `vitest-agent.dev` via Cloudflare Pages. Generates per-package API reference from each package's API Extractor model. Private, versions independently, imports nothing from the runtime packages. See [./components/docs-site.md](./components/docs-site.md). |

The eight npm workspaces version independently per package — there is no shared release train. The dependency graph is a ranked DAG (Decision 70 in [./decisions.md](./decisions.md)): sdk 1 · ui 2 · the four `sidecar-*` 2 · engine 3 · reporter 3 · sidecar 3 · cli 4 · mcp 4 · plugin 5, every edge pointing to a strictly lower rank and `cli` / `mcp` never importing each other — `packages/plugin/__test__/workspace-layering.test.ts` reads every workspace manifest and fails on a violation. `@vitest-agent/plugin` declares `@vitest-agent/cli` and `@vitest-agent/mcp` as regular workspace `dependencies` (`workspace:*`) alongside `@vitest-agent/reporter`, `@vitest-agent/engine` and `@vitest-agent/sdk`, so a cli or mcp release auto-PATCH-bumps the plugin and re-pins their exact version; they publish as exact-pinned regular `dependencies` too — the earlier `savvy.build.ts` transform that promoted cli and mcp into required `peerDependencies` was removed because the peer declaration made pnpm's `autoInstallPeers` force wrong Effect versions into consuming repos (see D33). The bins do not rely on hoisting: the plugin is the carrier and ships both bins itself, so `node_modules/.bin/vitest-agent` and `vitest-agent-mcp` exist for every consumer under npm, pnpm, yarn and bun (proved by `bins-packed-install.e2e.test.ts`); under the hoisting managers `@vitest-agent/cli`'s own same-named bin shadows the carrier's shim — same program today. The host-supplied Vitest peers (`vitest`, `@vitest/coverage-v8`, `@vitest/coverage-istanbul`) stay declared as `peerDependencies`, at `^5.0.0` — the family dropped Vitest 4 rather than carry a dual range, shipping majors of `plugin`, `reporter` and `mcp` (see Decision 65 in [./decisions.md](./decisions.md)). Declaring `@vitest-agent/plugin` pulls in the whole `@vitest-agent/*` family for a published consumer transitively. `@vitest-agent/sidecar` reaches a consumer through `@vitest-agent/cli`, along with its four per-platform binaries. Every non-sdk package pins `@vitest-agent/sdk` at `workspace:*`; cli, mcp and plugin pin `@vitest-agent/engine` the same way. In the dev workspace the root `package.json` lists only `@vitest-agent/plugin` as a workspace devDependency and `pnpm-workspace.yaml` carries no `publicHoistPattern` — the carrier's built shims are what the dogfood hooks and loader find in the root `node_modules/.bin`. The four per-platform sidecar sub-packages are not counted among the eight primary workspaces — they carry only a prebuilt binary and an `os` / `cpu` declaration, and are published as `optionalDependencies` of `@vitest-agent/sidecar`.

The Claude Code plugin workspace versions on its own track and never reaches npm. `.changeset/config.json` lists `@vitest-agent/claude-code-plugin` under `versionFiles`, globbing `plugins/claude-code/.claude-plugin/plugin.json` at `$.version`, so one bump rewrites the tracking `package.json` and the marketplace manifest together; with `privatePackages: { tag: true, version: true }` CI cuts a `@vitest-agent/claude-code-plugin@<version>` git tag and a GitHub release and stops there. See Decision 64 in [./decisions.md](./decisions.md).

The whole family runs on **Effect v4** (`effect@4.0.0-beta.98`). Every package pins `effect` (and its `@effect/*` companions) to the `catalog:effect` catalog injected by `@effected/pnpm-plugin-effect` — note the catalog naming: `catalog:silk` is the v3 catalog (3.22.0), `catalog:effect` is v4. The v4 port collapsed several standalone `@effect/*` packages into core `effect/unstable/*` namespaces: `@effect/cli` → `effect/unstable/cli`, `@effect/sql` → `effect/unstable/sql`, and the non-node `@effect/platform` `FileSystem` / `Path` / `PlatformError` primitives into the core `effect` barrel; `@effect/platform-node` stays a separate edge package but renamed `NodeContext` → `NodeServices`. The data layer stays direct on `@effect/sql-sqlite-node` (v4, now on Node's built-in `node:sqlite`, so `better-sqlite3` is removed), and the granular `@effected/*` kit (`@effected/xdg`, `@effected/config-file`, `@effected/workspaces`) is adopted directly — NOT via `@effected/app` / `@effected/store`. See Decision 46 in [./decisions.md](./decisions.md).

The dependency direction between CLI and sidecar is noteworthy: `@vitest-agent/cli` depends on `@vitest-agent/sidecar` (to call `resolveSidecarBinaryPath`), not the reverse. The parent `@vitest-agent/sidecar` package has no workspace runtime dependencies — its only source file (`src/resolve-sidecar-binary-path.ts`) uses `createRequire` from `node:module` to resolve the per-platform package's bin path. The per-platform children declare `@vitest-agent/sdk` as their only workspace `devDependency`, bundled into the SEA at build time — each child's `src/bin.ts` imports the pure `dispatch(argv, io)` from the dedicated `@vitest-agent/sdk/dispatch` entry point and passes `process.cwd()`, `process.env` and a `readFileSync` wrapper as `io`, so the core itself never touches `process` or `node:fs`. The closing edge of the dependency graph is `@vitest-agent/sidecar-<platform> → @vitest-agent/sdk` (a true leaf), so there is no workspace dependency cycle: `pnpm install` issues no cyclic-dependency warning and `turbo boundaries` passes. `packages/sidecar/turbo.json` uses the normal topological task ordering (`^build:dev` / `^build:prod`) — the prior `dependsOn: []` cycle workaround is gone now that the cli→sidecar→cli edge no longer exists.

For per-package internals, load the matching file under
[./components/](./components/) via the [./components.md](./components.md)
index.

## How the pieces fit

At runtime there is one shared SQLite database (`data.db`) at a
deterministic XDG-derived path. Three independent processes touch it:

- **The Vitest plugin** runs inside `vitest run`. `agentPlugin()` from
  `@vitest-agent/plugin` injects an internal `AgentReporter` Vitest-API
  class via `configureVitest`. The reporter implements both the
  end-of-run `onTestRunEnd` hook and the streaming hooks
  (`onTestRunStart`, `onTestModuleQueued`, `onTestModuleStart`,
  `onTestCaseResult`, `onTestModuleEnd`). At run start (`onInit`) the
  reporter invokes the chosen `VitestAgentReporterFactory` with a
  run-start `ReporterKit` carrying an Effect `PubSub<RunEvent>` channel,
  so a live-painting reporter can subscribe before the first event. Each
  streaming callback publishes one `RunEvent` onto that channel and also
  tees it to the optional user-supplied `onRunEvent` callback. After
  tests finish, `onTestRunEnd` persists the run, computes classifications
  and trends, then calls the reporter's `render(input, kit)` with a
  second, health-aware `ReporterKit`; the returned `RenderedOutput[]` is
  routed to stdout, the GitHub Step Summary file, or the `.vitest/<scope>/`
  report directory (`run.json` and `summary.md`). The
  default factory is `DefaultVitestAgentReporter` from
  `@vitest-agent/reporter`, which owns the Ink live mount end to end;
  users supply `reporter` only as an override. The plugin owns no
  rendering — it feeds the reporter the event stream and the kit.
- **The `vitest-agent` CLI** is a short-lived `effect/unstable/cli` process. It
  resolves the same `dbPath` and reads cached data through `DataReader`.
  The `record` subcommand is the only writer on the CLI side; it is
  driven by the Claude Code plugin's hooks.
- **The `vitest-agent-mcp` bin** is a long-lived stdio process built
  on Effect's native `McpServer` (`effect/unstable/ai`). Its `main.ts`
  launches one `Layer` — 30 `Tool.make` tools registered under the strict
  `registerStrictToolkit` contract plus six framing-only prompts over
  `McpServer.layerStdio` — provided with the engine's `PlatformLive` over
  the same database, and exits 0 when stdin closes.

The Claude Code plugin sits above all three. Its loader execs the
consumer's `node_modules/.bin/vitest-agent-mcp` (the carrier's shim), its
hooks invoke `vitest-agent record` through the same `.bin`-first
resolution for session and turn capture, and its subagent and skills turn
the captured data into agent behavior. The npm packages collect and
store; the Claude Code plugin interprets.

The `@vitest-agent/sdk` core plus the `@vitest-agent/engine` platform half
are what make this single-database story work: every package depends on
the same schemas, and every process provides the same `PlatformLive`
(`DataStore` / `DataReader` / migrations / logger) and calls the same
`resolveProjectDir` and `resolveDataPath`, so all three converge on the
same `data.db` from the same workspace identity.

## Where to load next

| When you need to understand... | Load |
| --- | --- |
| a specific component or package | [./components.md](./components.md) — index pointing at the per-package sub-file |
| why a design choice has its current shape | [./decisions.md](./decisions.md) |
| what shape data takes (TS types, Effect Schemas, SQLite tables, reporter contract) | [./schemas.md](./schemas.md) |
| how data moves end to end (reporter, CLI, MCP, plugin spawn, idempotency) | [./data-flows.md](./data-flows.md) |
| where files live, the XDG data-path stack, package-manager detection | [./file-structure.md](./file-structure.md) |
| testing patterns, per-project counts, coverage targets | [./testing-strategy.md](./testing-strategy.md) |
| the documentation site, its API-reference generation pipeline, the Cloudflare Pages deploy | [./components/docs-site.md](./components/docs-site.md) |
| a retired or superseded decision | [./decisions-retired.md](./decisions-retired.md) |

The Claude Code plugin's internals (hooks, subagent, dogfood workflow)
live in [./components/plugin-claude.md](./components/plugin-claude.md).

## Key principles

- **Effect-first.** All I/O lives behind Effect services with live and
  test layer pairs. Domain shapes are Effect Schemas, exported from
  `@vitest-agent/sdk`; the services and layers live in
  `@vitest-agent/engine`. Effect Schema is the only schema language —
  the MCP server's tool inputs, outputs and prompt arguments are Effect
  Schemas served through Effect's own `McpServer` (no zod, no tRPC).
- **Platform-free core, one platform layer, process-owning front ends.**
  `@vitest-agent/sdk` may not import `node:*`, `@effect/platform-node`,
  `@effect/sql-sqlite-node` or `@effected/*` and may not reference
  `process`; `@vitest-agent/engine` may not reference `process` at all;
  `cli` and `mcp` confine it to `bin.ts` / `main.ts` / `version.ts` plus a
  one-directory allowlist. Per-package boundary tests enforce this. Every
  ambient input (`env`, `cwd`, `homeDir`) is a parameter the front end's
  `main.ts` passes in; `PlatformLive({ dbPath, env, … })` is the one
  composite every process provides. See Decision 70.
- **Independent per-package release.** Each npm package versions on its own — changesets no longer pins the family to a single shared version. The plugin ships `@vitest-agent/reporter`, `@vitest-agent/engine`, `@vitest-agent/sdk`, `@vitest-agent/cli` and `@vitest-agent/mcp` all as regular `dependencies` in the published manifest (cli and mcp exact-pinned from their source `workspace:*` ranges — see the package landscape above), so consumers install only `@vitest-agent/plugin` and the rest arrives transitively. `@vitest-agent/sidecar` arrives through `@vitest-agent/cli` along with its four per-platform binaries. The `vitest-agent` and `vitest-agent-mcp` bins resolve for the Claude Code plugin's hook scripts and loader because the plugin is the carrier that declares them — no hoisting, no pnpm plugin, no manual install step. The Claude Code plugin and `@vitest-agent/sidecar` likewise version independently. A release emits a per-package git tag `@vitest-agent/<pkg>@<version>` and one GitHub Release per package, not a single shared-version tag; the docs/deploy trigger keys on the plugin Release name containing `@vitest-agent/plugin`. Each package still inlines its own release version as `process.env.__PACKAGE_VERSION__` (via `rslib-builder` at build time) and re-exports it as a public `CURRENT_<PKG>_VERSION` constant, but nothing consumes those constants for a runtime cross-package check any more — see D36 in [./decisions.md](./decisions.md).
- **One shared database, deterministic path.** `data.db` lives at
  `$XDG_DATA_HOME/vitest-agent/<workspaceKey>/data.db` (with the usual
  XDG fallback). The path is a function of workspace identity, not
  filesystem layout. Resolution fails loudly with
  `WorkspaceRootNotFoundError` rather than hashing a directory. See
  [./file-structure.md](./file-structure.md).
- **Plugin owns lifecycle, the reporter owns rendering.** The
  `VitestAgentReporter` contract is a single synchronous
  `render(input, kit)` returning `ReadonlyArray<RenderedOutput>`. The
  built-in `DefaultVitestAgentReporter` (in `@vitest-agent/reporter`)
  consumes `input.reports` through the shape-tailored dispatcher matrix
  in `@vitest-agent/ui` (4 run-shapes × 3 outcome classes, 12 cells,
  agent and Ink halves per cell) and — for `consoleMode === "stream"` —
  owns the Ink live-mount lifecycle end to end by subscribing to the
  kit's run-event channel. Multi-target output (console plus GitHub Step
  Summary) composes inside the default reporter rather than by chaining
  reporter factories. Users supply `AgentPlugin({ reporter })` only when
  they want to replace the built-in entirely; the `reporter` field is an
  override, not a composition slot. The plugin injects exactly one
  factory and never touches rendering.
- **Per-executor console matrix.** The plugin auto-detects the executor
  (`human` / `agent` / `ci`) and looks up `options.console.<slot>` to
  resolve a single `ConsoleMode` value (`passthrough` / `silent` /
  `stream` / `agent` / `ci-annotations`). The resolved mode drives stdout
  ownership
  (anything non-`passthrough` strips Vitest's built-in console reporters
  and suppresses its native coverage table) and flows through
  `ReporterKit.config.consoleMode` to the reporter, which decides what to
  render. The plugin no longer instantiates the Ink mount itself — the
  default reporter does, off the run-event channel. The user-supplied
  `onRunEvent` callback is a read-only stream tee forwarded for every
  mode. The pre-2.0 `mode` + `strategy` pair is retired; see
  decisions D9 / D26 / D27 in
  [./decisions-retired.md](./decisions-retired.md).
- **The Claude Code plugin is the AI integration surface.** The npm
  packages are headless data infrastructure. The Claude Code plugin at
  `plugins/claude-code/` is what turns that data into agent behavior — hooks for
  session/turn capture, the TDD orchestrator subagent, the slash
  commands and the MCP loader. It ships separately through the Claude
  marketplace.
- **Agent-agnostic taxonomy.** Every action-table row carries
  `actor_type` (`'agent' | 'user' | 'system'`), `agent_id`, and
  `conversation_id` columns so test results, hypotheses, notes, and
  TDD phases all attribute back to a specific agent invocation
  identified by canonical UUIDs (not host-specific session ids). The
  SessionStart hook + `${CLAUDE_ENV_FILE}` auto-sourcing propagates
  the four canonical UUIDs into every subprocess; PreToolUse Bash
  hooks override the agent id when a subagent is the active actor.
  See [./decisions.md](./decisions.md) D16–D19,
  [./components/plugin-claude.md](./components/plugin-claude.md),
  and the *Attribution flow* section in
  [./data-flows.md](./data-flows.md).

## Current limitations

- Final-frame output (the agent-string and GHA Step Summary paths) is
  still written post-run in `onTestRunEnd`. Live progress *is* streamed
  in `stream` mode via the default reporter's Ink live mount (which
  subscribes to the plugin's run-event channel and renders the agent's
  run-shape view progressively), but every other console mode renders
  only at end-of-run.
- Coverage is shared across projects within a single Vitest run; only
  the first project alphabetically processes the global `CoverageMap`.
- File-to-test mapping is convention-based (`.test.`/`.spec.` strip);
  there is no import-graph analysis.
- The `RenderedOutput` `file` target is a reserved no-op; current
  routing dispatches `stdout`, `github-summary` and `report`. A `report`
  output carries a flat `filename` and lands in `.vitest/<scope>/` via
  Vitest 5's `createReport`; it is dropped when report files are disabled
  (`report: false`, or the `human` executor default).
- Standalone `AgentReporter` usage from 1.x is gone. Consumers must
  install `@vitest-agent/plugin` and use `agentPlugin()`; the reporter
  package no longer exports a Vitest-API class.
