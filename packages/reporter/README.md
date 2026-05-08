# vitest-agent-reporter

[![npm version](https://img.shields.io/npm/v/vitest-agent-reporter)](https://www.npmjs.com/package/vitest-agent-reporter)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A Vitest reporter that gives LLM coding agents superpowers -- persistent
test intelligence, coverage analysis, failure history, and notes via MCP
tools.

## Features

- **SQLite persistence** -- normalized database replaces JSON files for
  richer queries and cross-run analysis
- **MCP server** -- 53 tools over stdio for deep integration with LLM
  agents (test data, notes, coverage, discovery, TDD hierarchy, run tests)
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
`vitest-agent-cli` for the CLI bin and
`vitest-agent-mcp` for the MCP server bin). If your package
manager is configured to skip peers, install them explicitly:

```bash
pnpm add -D vitest-agent-plugin vitest-agent-reporter vitest-agent-cli vitest-agent-mcp
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
tests and adjusts output automatically. Agents get 53 MCP tools for
querying test data, tracking coverage, managing TDD goals and behaviors,
and persisting notes -- with no manual MCP configuration.

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

- **MCP auto-registration** -- all 53 tools available immediately with
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
<summary>Full tool reference (53 tools)</summary>

| Tool | Description |
| --- | --- |
| `help` | List all tools with parameters and descriptions |
| `test_status` | Per-project pass/fail state from the most recent run |
| `test_overview` | Test landscape summary with per-project run metrics |
| `test_coverage` | Coverage gap analysis with per-metric thresholds and targets |
| `test_history` | Flaky/persistent/recovered tests with run visualization |
| `test_trends` | Per-project coverage trajectory with direction and sparkline |
| `test_errors` | Detailed test errors with diffs and stack traces |
| `test_for_file` | Find test modules that cover a given source file |
| `test_get` | Read a single test case in detail (state, errors, history, classification) |
| `file_coverage` | Per-file coverage with uncovered line ranges |
| `run_tests` | Execute vitest for specific files or projects; accepts `format: "markdown" \| "json"` |
| `cache_health` | Database health diagnostic |
| `configure` | View captured Vitest settings for a test run |
| `project_list` | List all projects with latest run summary |
| `test_list` | List test cases with state and duration |
| `module_list` | List test modules (files) with test counts |
| `suite_list` | List test suites (describe blocks) |
| `settings_list` | List Vitest config snapshots |
| `note_create` | Create a scoped note (global, project, module, suite, test, or free-form) |
| `note_list` | List notes with optional scope, project, and test filters |
| `note_get` | Read a note by ID |
| `note_update` | Update note content, pin state, or expiration |
| `note_delete` | Delete a note |
| `note_search` | Full-text search across note titles and content |
| `session_list` | List Claude Code sessions with optional project and kind filters |
| `session_get` | Read a Claude Code session by ID |
| `turn_search` | Search turn log entries by session, type, or timestamp |
| `failure_signature_get` | Read a failure signature by hash, with recent matching errors |
| `get_current_session_id` | Read the current Claude Code session ID stored for this workspace |
| `set_current_session_id` | Set the current Claude Code session ID for this workspace |
| `tdd_session_get` | Read a TDD session with phases, artifacts, run_id, and a Goals and Behaviors section |
| `hypothesis_list` | List hypotheses with optional session and outcome filters |
| `acceptance_metrics` | Compute phase-evidence integrity and compliance ratios |
| `triage_brief` | Orientation summary: recent runs, failures, and triage context |
| `wrapup_prompt` | Interpretive prompt-injection nudges for wrap-up hooks |
| `hypothesis_record` | Record a new agent hypothesis with optional evidence FKs |
| `hypothesis_validate` | Mark a hypothesis as confirmed, refuted, or abandoned |
| `tdd_session_start` | Open a new TDD session with a goal; accepts optional `runId` for idempotency re-keying |
| `tdd_session_end` | Close a TDD session with an outcome |
| `tdd_session_resume` | Get a markdown digest of an open TDD session |
| `tdd_phase_transition_request` | Request a TDD phase transition; validated against evidence artifacts |
| `tdd_goal_create` | Create a goal under a TDD session (idempotent on session + goal text) |
| `tdd_goal_get` | Read a goal with nested behaviors |
| `tdd_goal_update` | Update a goal's text or status |
| `tdd_goal_delete` | Hard-delete a goal and its behaviors, phases, and artifacts |
| `tdd_goal_list` | List goals for a session with nested behaviors, ordered by ordinal |
| `tdd_behavior_create` | Create a behavior under a goal (idempotent on goal + behavior text) |
| `tdd_behavior_get` | Read a behavior with its parent goal and dependencies |
| `tdd_behavior_update` | Update a behavior's text, suggested test name, status, or dependencies |
| `tdd_behavior_delete` | Hard-delete a behavior and its phases and artifacts |
| `tdd_behavior_list` | List behaviors by goal or session |
| `commit_changes` | Workspace git commit history joined with per-run changed files |
| `ping` | Health check — returns `{ pong: true }` |

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

The package family is now five packages — `vitest-agent` (the Vitest plugin and
lifecycle), `vitest-agent-reporter` (named renderer factory implementations),
`vitest-agent-sdk` (the shared library), `vitest-agent-cli` (the CLI bin),
and `vitest-agent-mcp` (the MCP server bin). The reporter, CLI and MCP
packages are required peer dependencies of `vitest-agent`, auto-installed
by pnpm and npm 7+. If your package manager skips peers, install them
explicitly. The `vitest-agent-mcp` bin name is unchanged; the CLI
bin was renamed from `vitest-agent-reporter` to `vitest-agent`.

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
  and the `subProject` input field was removed from the
  `test_history`, `suite_list`, and other MCP tools that previously
  accepted it.
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
