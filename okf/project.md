---
type: Project
title: vitest-agent
description: What this project is, its boundaries, and its non-goals.
status: draft
generated:
  by: okfit/claude-code
  at: 2026-09-28T18:57:48Z
  body_sha256: 6e1e579cf47a9ef77c4c0acf2d76444a0d1e38973a746c5d806c155102bf86a7
---

# vitest-agent

## Purpose

`vitest-agent` turns a Vitest test run into structured, persisted intelligence
for LLM coding agents. A Vitest plugin (`AgentPlugin`, [Module
plugin](modules/plugin.md)) captures every run's results, coverage, and
console output and hands them to a reporter for rendering; an engine layer
([Module engine](modules/engine.md)) persists runs, failures, coverage,
baselines, trends, and TDD lifecycle state to a single per-workspace SQLite
database at a deterministic XDG-derived path; and a CLI ([Module
cli](modules/cli.md)) and an MCP server ([Module mcp](modules/mcp.md)) expose
that data to agents as commands and tools. A Claude Code plugin ([Module
claude-code-plugin](modules/claude-code-plugin.md)) is the primary AI
integration surface: it wires the MCP server in as a loader, drives
session/turn capture through lifecycle hooks, and enforces a strict TDD
red-green-refactor loop through a dedicated subagent. Consumers install one
package, `@vitest-agent/plugin`
(`packages/plugin/package.json`), which is the family's *carrier*: it
declares the `vitest-agent` and `vitest-agent-mcp` bins itself
(`packages/plugin/src/bin/vitest-agent.ts`,
`packages/plugin/src/bin/vitest-agent-mcp.ts`) and pulls in the reporter,
engine, CLI, MCP and sidecar packages as regular dependencies, so no
`publicHoistPattern`, pnpm plugin, or manual linking step is needed for the
bins to resolve in `node_modules/.bin` under any package manager
(`packages/plugin/__test__/bins-packed-install.e2e.test.ts`).

## The six primary capabilities

1. **`AgentPlugin` + `AgentReporter`.** A Vitest plugin
   (`packages/plugin/src/plugin.ts:316`, `export function AgentPlugin`)
   registered in `vitest.config.ts` (`vitest ^5.0.0`) that detects the
   executor (human / agent / CI), manages the reporter chain, runs a
   `ConfigValidation` service for coverage-config diagnostics, and gates Full
   vs. UI-only reporting modes on Vitest's native `coverage.enabled`. Rendering
   is pluggable via the `VitestAgentReporterFactory` contract ([Interface
   reporter-contract](interfaces/reporter-contract.md)).
2. **`vitest-agent` CLI.** An `effect/cli`-based utility bin
   (`packages/cli/src/commands/`) with a three-command tree: `doctor`, `db`
   (`path` / `prune` / `reset` / `query`), and `agent` — hook-driven plumbing
   (`triage`, `wrapup`, `record`, `register-agent`, `end-agent`, `inject-env`,
   `sidecar-path`, `check-test-path`). See [Interface cli](interfaces/cli.md).
3. **Suggested actions and failure history.** Per-test failure persistence and
   classification (`stable`, `new-failure`, `persistent`, `flaky`,
   `recovered`) computed in `packages/engine/src/layers/HistoryTrackerLive.ts`
   via `classifyTest`, surfaced as actionable suggestions in console output.
4. **Coverage policy, baselines, and trends.** A typed `coverageTargets`
   schema, dual-output `AgentPlugin.COVERAGE_LEVELS` /
   `COVERAGE_LEVELS_PER_FILE` presets (`packages/plugin/src/index.ts:64-67`)
   that return `{ thresholds, coverageTargets }`, three
   `AgentPlugin.COVERAGE_AUTOUPDATE` tolerance functions that pass straight
   into Vitest's native `coverage.thresholds.autoUpdate`, and per-project
   trend tracking. `ConfigValidation` catches mismatches between Vitest's
   native `coverage.thresholds` and `coverageTargets`.
5. **MCP server.** An Effect-native server (`packages/mcp/src/toolkit.ts`)
   built on `effect/ai`'s `McpServer` over stdio — no MCP SDK, no
   tRPC, no zod (`packages/mcp/package.json` declares neither dependency). One
   file per tool under `packages/mcp/src/tools/`, gathered into a single
   `Toolkit` (`Toolkit.make`, `packages/mcp/src/toolkit.ts:42`) and registered
   under a strict-input contract, plus six framing-only
   `McpServer.prompt` prompts. See [Interface
   mcp-tools](interfaces/mcp-tools.md).
6. **Claude Code plugin.** A file-based plugin
   (`plugins/claude-code/.claude-plugin/plugin.json`) distributed via the
   Claude marketplace, providing an MCP loader that execs the consumer's own
   `node_modules/.bin/vitest-agent-mcp`, lifecycle hooks for session/turn
   capture, a `tdd-task` subagent enforcing evidence-bound
   red-green-refactor phase transitions, a `/tdd` slash command, and a set of
   preloaded TDD-primitive and reference skills. See [Module
   claude-code-plugin](modules/claude-code-plugin.md).

## Boundaries

The npm packages (`packages/sdk`, `packages/engine`, `packages/plugin`,
`packages/reporter`, `packages/ui`, `packages/cli`, `packages/mcp`,
`packages/sidecar` and its four per-platform children) are headless data
infrastructure: they capture, persist, and query test-run data, and render it
to a console, a GitHub Step Summary, or a report file. They own no agent
workflow of their own. The Claude Code plugin
(`plugins/claude-code/`) is what turns that data into agent behavior — it owns
the TDD orchestration loop, the hook-driven session/turn attribution, and the
slash-command surface; it consumes the npm packages' CLI and MCP bins rather
than reimplementing persistence or rendering. Vitest itself
(`^5.0.0`, a required peer dependency) owns test execution, coverage
instrumentation, and the reporter/task lifecycle API; this project only taps
into that lifecycle through `AgentPlugin` and one internal reporter class —
it does not run tests on its own and is not a test runner. Every process that
touches state converges on the single SQLite database resolved by
`resolveDataPath` / `resolveProjectDir` (see [Module
engine](modules/engine.md)); no process keeps its own copy of run data.

## Non-goals

- **Not a test runner.** `vitest-agent` has no execution engine of its own;
  `AgentPlugin` is a Vitest plugin, and every capability depends on Vitest
  already being invoked.
- **No import-graph analysis.** File-to-test mapping is convention-based (a
  `.test.` / `.spec.` filename strip); there is no static analysis of import
  graphs to associate source files with the tests that exercise them.
- **No standalone reporter class for direct consumption.** `@vitest-agent/reporter`
  no longer exports a bare Vitest-API reporter class; a consumer must install
  `@vitest-agent/plugin` and call `AgentPlugin()` rather than wiring a reporter
  directly into Vitest's `reporters` array.
- **No MCP SDK, no tRPC, no zod.** The MCP server is built entirely on
  Effect's own `McpServer` and Effect Schema for every tool input, output, and
  prompt argument (`packages/mcp/package.json` carries neither the official
  MCP SDK nor zod as a dependency).
- **No cross-package runtime version coordination.** Each `@vitest-agent/*`
  package inlines its own `CURRENT_<PKG>_VERSION`; nothing at runtime compares
  these constants across packages to enforce family-version consistency.
- **No shared release train.** Every publishable workspace versions
  independently; there is no lockstep version bump across the family (see
  [Module workspace](modules/workspace.md)).
- **No second agent-host integration yet.** `plugins/claude-code/` is the only
  populated member of the `plugins/*` workspace glob; a Copilot or other
  agent-host plugin is not shipped today.

Known present-day gaps in what the current implementation can do — not
deliberate exclusions — are tracked as Limitations rather than listed here;
see [limitations/index.md](limitations/index.md).
