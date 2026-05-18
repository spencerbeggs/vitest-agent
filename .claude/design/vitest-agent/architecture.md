---
status: current
module: vitest-agent-reporter
category: architecture
created: 2026-03-20
updated: 2026-05-18
last-synced: 2026-05-18
completeness: 90
related:
  - ./components.md
  - ./decisions.md
  - ./schemas.md
  - ./data-flows.md
  - ./file-structure.md
  - ./testing-strategy.md
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

For the consumer, the integration is one install: add `vitest-agent-plugin`
to a project, register `agentPlugin()` in `vitest.config.ts`, and install
the Claude Code plugin from the marketplace. Declaring the plugin pulls in
the reporter, CLI, MCP and sidecar packages — the reporter and SDK as regular
dependencies, the CLI and MCP as required peers that npm 7+ and pnpm
auto-install; the hook chain wires up; the MCP server is launched on demand
by the user's package manager. No runtime configuration beyond the plugin
call.

## Package landscape

The project is a pnpm monorepo. Seven publishable workspaces under
`packages/` plus a file-based Claude Code plugin at `plugin/` (not a
workspace).

| Workspace | Path | Role |
| --- | --- | --- |
| `vitest-agent-sdk` | `packages/sdk/` | Shared base. Schemas, migrations, errors, services, layers, formatters, the XDG path-resolution stack, the public reporter contract types, the `RunEvent` and `RenderState` schemas. No internal dependencies. |
| `vitest-agent-plugin` | `packages/plugin/` | The Vitest plugin. Owns the Vitest lifecycle, persistence, classification, baselines and trends, the run-event `PubSub` channel and the streaming-callback `onRunEvent` tap. Injects a reporter factory and feeds it the event stream; owns no rendering. |
| `vitest-agent-reporter` | `packages/reporter/` | The default reporter package and the reference package for custom-reporter authors. Ships `DefaultVitestAgentReporter` (the plugin's built-in factory, which owns the Ink live mount end to end), re-exports the contract types from the SDK plus the dispatch helpers, and declares `react` + `ink` as full deps. |
| `vitest-agent-ui` | `packages/ui/` | Pure rendering-primitives library. The `RunEvent` reducer, the shape-tailored dispatcher matrix and its 12 cells, the L1 MCP tool-pointer footer, the synthesizers and the Effect `RunEventChannel` PubSub. Knows nothing about the reporter lifecycle. |
| `vitest-agent-cli` | `packages/cli/` | The `vitest-agent` bin. Utility-only for 2.0: `doctor`, `db` (path / prune / reset / query), and the `agent` namespace for hook-driven plumbing (triage, wrapup, record, sidecar). Test-landscape queries moved to MCP. |
| `vitest-agent-mcp` | `packages/mcp/` | The `vitest-agent-mcp` bin. tRPC tool router, MCP resources, MCP prompts. |
| `vitest-agent-sidecar` | `packages/sidecar/` | Fast-path native binary for the per-Bash `inject-env` hot path. Ships a tsdown-built Node SEA executable distributed per-platform via four `optionalDependencies` sub-packages (`vitest-agent-sidecar-{darwin-arm64,linux-arm64,linux-x64,win32-x64}`). Added in T9.2. |
| `plugin/` (file-based) | `plugin/` | Claude Code plugin distributed via the marketplace as `vitest-agent@spencerbeggs`. Hooks, the TDD orchestrator subagent, slash commands, sub-skill primitives, the MCP loader. |

The seven npm workspaces release in lockstep. `vitest-agent-plugin` declares `vitest-agent-cli` and `vitest-agent-mcp` as required workspace `peerDependencies` (alongside the host-supplied Vitest peers `vitest`, `@vitest/runner`, `@vitest/coverage-v8`, `@vitest/coverage-istanbul`); its regular workspace `dependencies` are `vitest-agent-reporter` and `vitest-agent-sdk` only. The cli / mcp peers are required, not optional — there is no `peerDependenciesMeta`. Declaring `vitest-agent-plugin` still pulls in the whole `vitest-agent-*` family for a published consumer: npm 7+ and pnpm (with this repo's `autoInstallPeers: true`) auto-install required peers, and a peer-installed package lands at the consumer's top level, so its bin resolves — a transitively-nested regular dependency's bin would not. `vitest-agent-sidecar` reaches a consumer transitively through `vitest-agent-cli`, along with its four per-platform binaries. All six non-SDK packages pin `vitest-agent-sdk` at `workspace:*`. The four per-platform sidecar sub-packages are not counted among the seven primary workspaces — they carry only a prebuilt binary and an `os` / `cpu` declaration, and are published as `optionalDependencies` of `vitest-agent-sidecar`.

The dependency direction between CLI and sidecar is noteworthy: `vitest-agent-cli` depends on `vitest-agent-sidecar` (to call `resolveSidecarBinaryPath`), not the reverse. The parent `vitest-agent-sidecar` package has no workspace runtime dependencies — its only source file (`src/resolve-sidecar-binary-path.ts`) uses `createRequire` from `node:module` to resolve the per-platform package's bin path. The per-platform children declare `vitest-agent-sdk` as their only workspace `devDependency`, bundled into the SEA at build time — each child's `src/bin.ts` imports `dispatch` from the dedicated `vitest-agent-sdk/dispatch` entry point. The closing edge of the dependency graph is `vitest-agent-sidecar-<platform> → vitest-agent-sdk` (a true leaf), so there is no workspace dependency cycle: `pnpm install` issues no cyclic-dependency warning and `turbo boundaries` passes. `packages/sidecar/turbo.json` uses the normal topological task ordering (`^build:dev` / `^build:prod`) — the prior `dependsOn: []` cycle workaround is gone now that the cli→sidecar→cli edge no longer exists.

For per-package internals, load the matching file under
[./components/](./components/) via the [./components.md](./components.md)
index.

## How the pieces fit

At runtime there is one shared SQLite database (`data.db`) at a
deterministic XDG-derived path. Three independent processes touch it:

- **The Vitest plugin** runs inside `vitest run`. `agentPlugin()` from
  `vitest-agent-plugin` injects an internal `AgentReporter` Vitest-API
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
  routed to stdout, the GitHub Step Summary file or another target. The
  default factory is `DefaultVitestAgentReporter` from
  `vitest-agent-reporter`, which owns the Ink live mount end to end;
  users supply `reporter` only as an override. The plugin owns no
  rendering — it feeds the reporter the event stream and the kit.
- **The `vitest-agent` CLI** is a short-lived `@effect/cli` process. It
  resolves the same `dbPath` and reads cached data through `DataReader`.
  The `record` subcommand is the only writer on the CLI side; it is
  driven by the Claude Code plugin's hooks.
- **The `vitest-agent-mcp` server** is a long-lived stdio process built
  on `@modelcontextprotocol/sdk`. It opens the same database under a
  `ManagedRuntime` and exposes a tRPC tool router for read and write
  operations, plus MCP resources (vendored Vitest docs and a curated
  patterns library) and framing-only prompts.

The Claude Code plugin sits above all three. Its loader spawns the MCP
server through the user's package manager, its hooks invoke
`vitest-agent record` for session and turn capture, and its subagent and
skills turn the captured data into agent behavior. The npm packages
collect and store; the Claude Code plugin interprets.

The shared `vitest-agent-sdk` package is what makes this single-database
story work: every package depends on the same schemas, the same
`DataStore`/`DataReader` services and the same path resolver, so all
three processes converge on the same `data.db` from the same workspace
identity.

## Where to load next

| When you need to understand... | Load |
| --- | --- |
| a specific component or package | [./components.md](./components.md) — index pointing at the per-package sub-file |
| why a design choice has its current shape | [./decisions.md](./decisions.md) |
| what shape data takes (TS types, Effect Schemas, SQLite tables, reporter contract) | [./schemas.md](./schemas.md) |
| how data moves end to end (reporter, CLI, MCP, plugin spawn, idempotency) | [./data-flows.md](./data-flows.md) |
| where files live, the XDG data-path stack, package-manager detection | [./file-structure.md](./file-structure.md) |
| testing patterns, per-project counts, coverage targets | [./testing-strategy.md](./testing-strategy.md) |
| a retired or superseded decision | [./decisions-retired.md](./decisions-retired.md) |

The Claude Code plugin's internals (hooks, subagent, dogfood workflow)
live in [./components/plugin-claude.md](./components/plugin-claude.md).

## Key principles

- **Effect-first.** All I/O lives behind Effect services with live and
  test layer pairs. Domain shapes are Effect Schemas, re-exported from
  `vitest-agent-sdk`. Zod is reserved for tRPC tool input validation in
  the MCP package.
- **Lockstep release.** The seven npm packages share one version — a bump
  to any one bumps all seven. The plugin declares `vitest-agent-reporter`
  and `vitest-agent-sdk` as regular `dependencies` and `vitest-agent-cli`
  and `vitest-agent-mcp` as required `peerDependencies`, so consumers
  install only `vitest-agent-plugin` and the rest arrives at the matching
  version — the regular deps transitively, the required peers via npm 7+ /
  pnpm auto-install. `vitest-agent-sidecar` arrives through `vitest-agent-cli`
  along with its four per-platform binaries. The CLI and MCP packages are
  peers rather than regular deps because the auto-installed peer lands at
  the consumer's top level, so the `vitest-agent` and `vitest-agent-mcp`
  bins resolve for the Claude Code plugin's hook scripts — a nested regular
  dependency's bin would not. The
  Claude Code plugin can
  lag the npm packages. Runtime version sync is verifiable through
  `process.env.__PACKAGE_VERSION__`, which `rslib-builder` inlines into
  each package's bundle as a string at build time; an inlined-at-build
  constant avoids a runtime `package.json` read and surfaces a mismatch
  loudly when the invariant is broken (a hand-mixed install, a forgotten
  lockstep release).
- **One shared database, deterministic path.** `data.db` lives at
  `$XDG_DATA_HOME/vitest-agent/<workspaceKey>/data.db` (with the usual
  XDG fallback). The path is a function of workspace identity, not
  filesystem layout. Resolution fails loudly with
  `WorkspaceRootNotFoundError` rather than hashing a directory. See
  [./file-structure.md](./file-structure.md).
- **Plugin owns lifecycle, the reporter owns rendering.** The
  `VitestAgentReporter` contract is a single synchronous
  `render(input, kit)` returning `ReadonlyArray<RenderedOutput>`. The
  built-in `DefaultVitestAgentReporter` (in `vitest-agent-reporter`)
  consumes `input.reports` through the shape-tailored dispatcher matrix
  in `vitest-agent-ui` (4 run-shapes × 3 outcome classes, 12 cells,
  agent and Ink halves per cell) and — for `consoleMode === "ink"` —
  owns the Ink live-mount lifecycle end to end by subscribing to the
  kit's run-event channel. Multi-target output (console plus GitHub Step
  Summary) composes inside the default reporter rather than by chaining
  reporter factories. Users supply `AgentPlugin({ reporter })` only when
  they want to replace the built-in entirely; the `reporter` field is an
  override, not a composition slot. The plugin injects exactly one
  factory and never touches rendering.
- **Per-executor console matrix.** The plugin auto-detects the executor
  (`human` / `agent` / `ci`) and looks up `options.console.<slot>` to
  resolve a single `ConsoleMode` value (`passthrough` / `silent` / `ink` /
  `agent` / `ci-annotations`). The resolved mode drives stdout ownership
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
  packages are headless data infrastructure. The file-based plugin at
  `plugin/` is what turns that data into agent behavior — hooks for
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
  in `ink` mode via the default reporter's Ink live mount (which
  subscribes to the plugin's run-event channel), but every other console
  mode renders only at end-of-run.
- Coverage is shared across projects within a single Vitest run; only
  the first project alphabetically processes the global `CoverageMap`.
- File-to-test mapping is convention-based (`.test.`/`.spec.` strip);
  there is no import-graph analysis.
- The `RenderedOutput` `file` target is a reserved no-op; current
  routing dispatches `stdout` and `github-summary` only.
- Standalone `AgentReporter` usage from 1.x is gone. Consumers must
  install `vitest-agent-plugin` and use `agentPlugin()`; the reporter
  package no longer exports a Vitest-API class.
