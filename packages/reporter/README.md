# vitest-agent-reporter

[![npm version](https://img.shields.io/npm/v/vitest-agent-reporter)](https://www.npmjs.com/package/vitest-agent-reporter)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A Vitest reporter that gives LLM coding agents superpowers -- persistent
test intelligence, coverage analysis, failure history, and notes via MCP
tools.

## Features

- **SQLite persistence** -- normalized database replaces JSON files for
  richer queries and cross-run analysis
- **MCP server** -- 29 action-keyed tools over stdio for deep integration
  with LLM agents (test data, notes, coverage, discovery, TDD hierarchy,
  run tests); tools emit both markdown `content[]` and `structuredContent`
  per MCP 2025-06-18 so clients can parse either channel
- **Claude Code plugin** -- auto-registers MCP tools, injects test
  context at session start, and provides teaching skills
- **Zero-config agent detection** -- uses
  [std-env](https://github.com/nicolo-ribaudo/std-env) to detect Claude
  Code, Cursor, Gemini CLI, Codex, Devin, and other agents automatically
- **Coverage thresholds and targets** -- Vitest-native threshold format
  plus aspirational targets with auto-ratcheting baselines
- **Coverage trends** -- tracks coverage direction across runs with
  tiered console output (green/yellow/red)
- **Failure history** -- per-test pass/fail tracking with classification:
  `stable`, `new-failure`, `persistent`, `flaky`, `recovered`
- **TDD goal and behavior tracking** -- three-tier Objective→Goal→Behavior hierarchy with CRUD, status lifecycle, dependency tracking, and evidence-bound phase transitions
- **Notes system** -- CRUD + full-text search for persisting debugging
  notes across sessions
- **GitHub Actions GFM** -- writes structured summaries to
  `GITHUB_STEP_SUMMARY` automatically in CI
- **CLI bin** -- query test status, coverage gaps, failure history, and
  trends from the command line

## Quick Start

Install the package:

```bash
npm install vitest-agent-plugin
```

Modern pnpm and npm auto-install the required peer dependencies
(`vitest-agent-reporter` for the renderer factories,
`vitest-agent-ui` for the shared event-sourced renderer + live React Ink
view, `vitest-agent-cli` for the CLI bin, and `vitest-agent-mcp` for the
MCP server bin). If your package manager is configured to skip peers,
install them explicitly:

```bash
pnpm add -D vitest-agent-plugin vitest-agent-reporter vitest-agent-ui vitest-agent-cli vitest-agent-mcp
```

Add `AgentPlugin` to your Vitest config with coverage thresholds and
aspirational targets:

```typescript
import { AgentPlugin } from "vitest-agent-plugin";
import { defineConfig } from "vitest/config";

export default async () => {
  const { projects, tags } = await AgentPlugin.discover();
  return defineConfig({
    plugins: [
      AgentPlugin({
        coverageThresholds: { lines: 80, branches: 80 },
        coverageTargets: { lines: 95, branches: 90 },
      }),
    ],
    test: {
      projects,
      tags,
      pool: "forks",
      coverage: {
        provider: "v8",
      },
    },
  });
};
```

Install the Claude Code plugin for the full agent experience:

```bash
# Add the plugin marketplace (one-time setup)
/plugin marketplace add spencerbeggs/bot

# Install the plugin for this project
/plugin install vitest-agent@spencerbeggs-bot --scope project
```

That's it. The plugin detects whether an agent, CI, or human is running
tests and adjusts output automatically. Agents get 29 action-keyed MCP
tools for querying test data, tracking coverage, managing TDD goals and
behaviors, and persisting notes -- with no manual MCP configuration.

## What Agents See

When tests fail, the reporter produces actionable markdown output with
classification labels, coverage gaps, and next steps. (Per-project
inline tag rollups and indented per-tag failure breakdowns are a
**terminal-output** feature rendered by `terminalReporter`; the
markdown formatter focuses on the failure / coverage / next-steps
sections shown below.)

````markdown
## x Vitest -- 2 failed, 10 passed (520ms)

Coverage regressing over 3 runs

### x `src/utils.test.ts`

- x **compressLines > compresses consecutive lines** [new-failure]
  Expected "1-3,5" but received "1,2,3,5"

  ```diff
  - Expected
  + Received

  - "1-3,5"
  + "1,2,3,5"
  ```

- x **compressLines > handles duplicates** [persistent]
  Expected [1,2] to equal [1]

### Coverage gaps

- `src/coverage.ts` -- Lines: 42% (threshold: 80%) -- uncovered: 65-80,95-110
- `src/utils.ts` -- Lines: 72% (target: 95%) -- uncovered: 42-50,99

### Next steps

- 1 new failure since last run
- 1 persistent failure across 3 runs
- Re-run: `pnpm vitest run src/utils.test.ts`
- Filter by tag: `pnpm vitest run --tags-filter "int"`
- Run `npx vitest-agent coverage` for gap analysis
- Run `npx vitest-agent trends` for coverage trajectory
````

When all tests pass and targets are met, output collapses to a single
summary line.

## How It Works

The plugin detects three environments and adapts behavior:

| Environment | Detection | Console | Database | GFM Summary |
| --- | --- | --- | --- | --- |
| Agent | `std-env` agent detection | Structured markdown | Yes | Auto |
| CI | `GITHUB_ACTIONS`, `CI=true` | Silent (existing reporters kept) | Yes | Yes |
| Human | No agent/CI vars detected | Silent (existing reporters kept) | Yes | No |

After each test run, `AgentReporter` writes structured data to a SQLite
database under your XDG data directory (default
`$XDG_DATA_HOME/vitest-agent/<workspaceName>/data.db`,
falling back to `~/.local/share/vitest-agent/<workspaceName>/data.db`).
The location is derived from your root `package.json` `name`, so two
worktrees of the same repo share history. Override the location via
`vitest-agent.config.toml` at the workspace root:

```toml
# Override the entire data directory
cacheDir = "./.vitest-agent-reporter"

# Or override just the workspace key
projectKey = "my-app-personal"
```

The MCP server and CLI both query this database on demand -- no
background process required.

## Claude Code Plugin

A companion [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
plugin provides the full agent-native experience:

```bash
# Add the plugin marketplace (one-time setup)
/plugin marketplace add spencerbeggs/bot

# Install the plugin for this project
/plugin install vitest-agent@spencerbeggs-bot --scope project
```

The plugin provides:

- **MCP auto-registration** -- all 29 tools available immediately with
  no manual `.mcp.json` configuration
- **SessionStart hook** -- injects project status and available tools
  into Claude's context at the start of each session
- **PostToolUse hook** -- detects test runs and suggests MCP tools for
  deeper analysis when tests fail
- **Skills** -- `/vitest-agent:tdd`,
  `/vitest-agent:debugging`,
  `/vitest-agent:configuration`
- **Commands** -- `/vitest-agent:setup` (add plugin to vitest
  config), `/vitest-agent:configure` (view/modify settings)

## MCP Tools

The package includes an MCP server (`vitest-agent-mcp`) that
exposes test data as tools over stdio transport. The Claude Code plugin
registers this automatically, but you can also start it manually:

```bash
npx vitest-agent-mcp
```

<details>
<summary>Full tool reference (29 tools)</summary>

Several CRUD families are consolidated into single action-keyed tools that dispatch on an `action` (or `kind`) discriminator.

| Tool | Actions | Description |
| --- | --- | --- |
| `help` | — | List all tools with parameters and descriptions |
| `ping` | — | Health check — returns `{ pong: true }` |
| `test_status` | — | Per-project pass/fail state from the most recent run |
| `test_overview` | — | Test landscape summary with per-project run metrics |
| `test_coverage` | — | Coverage gap analysis with per-metric thresholds and targets |
| `test_history` | — | Flaky/persistent/recovered tests with run visualization |
| `test_trends` | — | Per-project coverage trajectory with direction and sparkline |
| `test_errors` | — | Detailed test errors with diffs and stack traces |
| `test` | `list`, `get`, `for_file` | List test cases, read a single test case in detail, or find test modules that cover a source file |
| `file_coverage` | — | Per-file coverage with uncovered line ranges |
| `inventory` | `kind: project`, `module`, `suite`, `session` | Unified discovery across projects, test modules, suites, and Claude Code sessions; accepts an optional `id` for single-row lookup |
| `run_tests` | — | Execute vitest for specific files or projects; returns a `RunTestsResult` discriminated union (`ok` / `timeout` / `error`) carrying the full `AgentReport` and per-test classifications |
| `cache_health` | — | Database health diagnostic |
| `configure` | — | View captured Vitest settings for a test run |
| `settings_list` | — | List Vitest config snapshots |
| `register_agent` | — | Register the active agent in the `agents` table; idempotent on `(agentType, parentAgentId, clientNonce)` |
| `note` | `create`, `list`, `get`, `update`, `delete`, `search` | Scoped note CRUD plus full-text search across titles and content |
| `turn_search` | — | Search turn log entries by session, type, or timestamp |
| `failure_signature_get` | — | Read a failure signature by hash, with recent matching errors |
| `triage_brief` | — | Orientation summary: recent runs, failures, and triage context |
| `wrapup_prompt` | — | Interpretive prompt-injection nudges for wrap-up hooks |
| `acceptance_metrics` | — | Compute phase-evidence integrity and compliance ratios |
| `hypothesis` | `record`, `validate`, `list` | Record a hypothesis with optional evidence FKs, mark it confirmed/refuted/abandoned, or list with filters |
| `tdd_task` | `start`, `end`, `get`, `resume` | TDD session lifecycle; `start` and `end` are idempotent. Replaces the 1.x `tdd_session_*` family |
| `tdd_phase_transition_request` | — | Request a TDD phase transition; validated against evidence artifacts. Auto-promotes a behavior from `pending` to `in_progress` when accepted with a `behaviorId` |
| `tdd_goal` | `create`, `update`, `delete`, `get`, `list` | Goal CRUD under a TDD session; `create` is idempotent on `(sessionId, goal)`; `delete` is denied to the TDD orchestrator at the hook layer |
| `tdd_behavior` | `create`, `update`, `delete`, `get`, `list_by_goal`, `list_by_session` | Behavior CRUD under a goal; `create` is idempotent on `(goalId, behavior)`; `delete` is denied to the TDD orchestrator at the hook layer |
| `tdd_artifact_list` | — | List TDD artifacts (test files, runs, hypotheses) recorded by the plugin's post-tool-use hook |
| `commit_changes` | — | Workspace git commit history joined with per-run changed files |

All tools emit both markdown `content[]` for human-readable display and a typed `structuredContent` payload per MCP 2025-06-18 — clients can parse either channel.

</details>

See [docs/mcp.md](../docs/mcp.md) for the full MCP reference.

## CLI

The `vitest-agent` CLI queries the SQLite database for on-demand
test landscape queries. All commands accept `--format` to switch between
`markdown` (default) and `json` output.

```bash
npx vitest-agent status      # Per-project pass/fail state
npx vitest-agent coverage    # Coverage gap analysis
npx vitest-agent history     # Flaky/persistent failure trends
npx vitest-agent trends      # Coverage trajectory over time
npx vitest-agent doctor      # Database health diagnostic
npx vitest-agent cache path  # Print the database file path
npx vitest-agent cache clean # Delete the database
```

See [docs/cli.md](../docs/cli.md) for the full CLI reference.

## Documentation

| Guide | Description |
| --- | --- |
| [Configuration](../docs/configuration.md) | Plugin and reporter options, thresholds, targets, cache resolution |
| [Schemas](../docs/schemas.md) | Effect Schema definitions, programmatic access |
| [CLI Commands](../docs/cli.md) | Status, overview, coverage, history, trends, cache, and doctor commands |
| [MCP Server](../docs/mcp.md) | MCP tools reference, notes system, manual server usage |
| [Failure History](../docs/history.md) | Test classification and failure tracking |
| [Claude Code Plugin](../plugin/README.md) | Plugin installation, hooks, skills, and commands |

## Migrating from 1.x

Version 2.0 introduces three changes worth knowing about before you
upgrade:

### Database location moved

The SQLite database moved from `node_modules/.vite/vitest/<hash>/vitest-agent-reporter/data.db`
to `$XDG_DATA_HOME/vitest-agent/<workspaceName>/data.db`.
**No data migration is performed** — your first 2.0 run starts with a
fresh database. Coverage baselines, trends, and history all reset.
Existing data in `node_modules` is harmless and ignored.

If you want the old project-local layout, set this in
`vitest-agent.config.toml` at your workspace root:

```toml
cacheDir = "./.vitest-agent-reporter"
```

### Package split (peers auto-install)

The package family is now six packages — `vitest-agent-plugin` (the Vitest
plugin and lifecycle), `vitest-agent-reporter` (named renderer factory
implementations), `vitest-agent-ui` (the shared event-sourced renderer with
React Ink view and the `createLiveInk` / `eventSourcedReporter` exports),
`vitest-agent-sdk` (the shared library), `vitest-agent-cli` (the CLI bin),
and `vitest-agent-mcp` (the MCP server bin). The reporter, ui, CLI, and MCP
packages are required peer dependencies of `vitest-agent-plugin`,
auto-installed by pnpm and npm 7+. If your package manager skips peers,
install them explicitly. The `vitest-agent-mcp` bin name is unchanged; the
CLI bin was renamed from `vitest-agent-reporter` to `vitest-agent`.

### Console matrix replaces `mode` and `strategy` (breaking)

The pre-2.0 `mode` (`"auto" | "agent" | "silent"`) and `strategy` /
`consoleStrategy` (`"complement" | "own"`) options are gone. Console output
is now controlled by a per-executor matrix at `AgentPlugin({ console: { … } })`:

```typescript
AgentPlugin({
  console: {
    human?: "passthrough" | "silent" | "ink" | "agent",
    agent?: "passthrough" | "silent" | "agent",
    ci?:    "passthrough" | "silent" | "ci-annotations",
  },
});
```

The plugin auto-detects the executor (`human` / `agent` / `ci`) via
`EnvironmentDetector` and resolves a single `ConsoleMode` value from the
matching slot. Per-slot defaults: `human` → `"passthrough"`, `agent` →
`"agent"`, `ci` → `"passthrough"`. Any non-`"passthrough"` value strips
Vitest's console reporters and gives the plugin ownership of stdout (this
replaces the old `strategy: "own"`). To opt into the live React Ink view,
set the slot you want to `"ink"` and wire the new `onRunEvent` tap to
`createLiveInk` from `vitest-agent-ui`. See
[Configuration > `console`](../docs/configuration.md#console).

### `AgentReporter.onInit` is now async

`onInit` now returns `Promise<void>` so it can resolve dbPath
asynchronously. Vitest awaits the hook, so `AgentPlugin` users see no
change. Direct callers of `onInit` must await the promise.

## Tag-strategy migration

The 2.0 series replaces filename-driven project splitting with Vitest
4.1's native tag system. If you upgraded from an earlier 2.0 build,
expect the following breaking changes:

- `AgentPlugin.discover()` returns `{ projects, tags }` instead of
  `TestProjectInlineConfiguration[]`. Destructure the result and pass
  both to `test.projects` and `test.tags`.
- Project names lose their kind suffix — there is one project per
  workspace package, no more `pkg:unit` / `pkg:int` / `pkg:e2e`. Test
  kind is expressed as a Vitest tag (`unit`, `int`, `e2e`) injected
  by the plugin's transform; filter runs with
  `vitest --tags-filter "int"`.
- The per-kind override form on `discoverProjects()`
  (`{ unit?, int?, e2e? }` keyed by kind) is gone. Use the
  `tagStrategy` option or the `callback` form instead.
- The `--sub-project` flag was removed from the `record` CLI command,
  and the `subProject` input field was removed from `test_history`,
  the `inventory` tool's `suite` kind (1.x `suite_list`), and every
  other MCP tool that previously accepted it.
- The `sub_project` column was dropped from every persisted table
  (`test_runs`, `test_history`, `coverage_baselines`,
  `coverage_trends`, `notes`, `sessions`). Existing `data.db` files
  are wiped on first run by the drop-and-recreate migration.
- `splitProject` and `ProjectIdentity` were removed from the
  `vitest-agent-sdk` public API.

`Tag`, `TagStrategy`, `ModuleInfo`, `ClassifyBaseContext`,
`ClassifyExtendedContext`, and `TagOptions` are new public exports of
`vitest-agent-plugin` for callers that want to author their own
classification logic. See
[Configuration > Tag and TagStrategy API](../docs/configuration.md#tag-and-tagstrategy-api).

## Requirements

- Vitest >= 4.1.0
- Node.js >= 22

## License

[MIT](./LICENSE)
