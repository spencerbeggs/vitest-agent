# vitest-agent agent plugin

An agent plugin for Claude Code and GitHub Copilot that integrates `vitest-agent` into your coding sessions. One source in this directory is built by [pluginfinity](https://github.com/spencerbeggs/pluginfinity) into `builds/claude/` and `builds/copilot/`. Provides MCP tools for test data queries, session context injection via hooks, a TDD orchestrator subagent, and sub-skill primitives for every step of the red-green-refactor cycle.

## Installation

### From the marketplace

```bash
# Add the plugin marketplace (one-time setup)
/plugin marketplace add spencerbeggs/bot

# Install the plugin for this project
/plugin install vitest-agent@spencerbeggs --scope project
```

This adds the plugin to your `.claude/settings.json`:

```json
{
  "enabledPlugins": {
    "vitest-agent@spencerbeggs": true
  }
}
```

### From a local directory (development)

```bash
# Claude Code
claude --plugin-dir ./plugin/builds/claude

# GitHub Copilot CLI
copilot --plugin-dir ./plugin/builds/copilot
```

Run `pnpm --filter @vitest-agent/ai-plugins build:dev` first if you changed the source.

## What the plugin provides

### MCP server (auto-registered)

The plugin registers the `vitest-agent` MCP server on both hosts (inline in `.claude-plugin/plugin.json` on Claude Code, `mcp.json` on Copilot). A zero-dependency POSIX shell launcher (`bin/start-mcp.sh`) `exec`-replaces itself with your project's `node_modules/.bin/vitest-agent-mcp`, which `@vitest-agent/plugin` links into every consumer. When that bin is missing it prints the install line for your package manager (detected from `packageManager` in `package.json` or your lockfile) on stderr and falls back to `npx --yes @vitest-agent/mcp@5`.

Install `@vitest-agent/plugin` as a dependency of your project so the server runs your installed version. See [Prerequisites](#prerequisites) below.

> **Copilot:** a Copilot MCP server starts in the plugin directory and cannot learn your project, so on Copilot the server falls back to the published package and cannot yet find your project's test database. The hooks and skills work; MCP-backed workflows are Claude Code only for now.

The server exposes 30 action-keyed tools and six framing-only prompts for common workflows. Every tool returns a typed `structuredContent` payload — read that field, not the result text; Claude Code forwards only `structuredContent` to the model when present. Use the `help` tool for the full tool list with parameters.

| Category | Tools |
| --- | --- |
| Queries | `test_status`, `test_overview`, `test_coverage`, `test_history`, `test_trends`, `test_errors`, `file_coverage`, `cache_health`, `configure` |
| Discovery | `inventory` (`kind: project \| module \| suite \| session`), `test` (`action: list \| get \| for_file`), `settings_list` |
| Execution | `run_tests` |
| Agent registration | `register_agent` |
| Notes | `note` (`action: create \| list \| get \| update \| delete \| search`) |
| Turns | `turn_search`, `failure_signature_get`, `acceptance_metrics` |
| Triage / wrap-up | `triage_brief`, `wrapup_prompt` |
| Hypotheses | `hypothesis` (`action: record \| validate \| list`) |
| TDD lifecycle | `tdd_task` (`action: start \| end \| get \| resume`), `tdd_phase_transition_request`, `tdd_progress_push` |
| TDD goal CRUD | `tdd_goal` (`action: create \| update \| delete \| get \| list`) |
| TDD behavior CRUD | `tdd_behavior` (`action: create \| update \| delete \| get \| list_by_goal \| list_by_tdd_task`) |
| TDD artifacts | `tdd_artifact_list` |
| Workspace history | `commit_changes` |
| Meta | `help`, `ping` |

### Hooks

Hook scripts run at lifecycle events on both hosts to record session data, inject context and gate tool calls. They are grouped by event under `hooks/`, source pluginfinity's hook library (generated into each build) and the plugin's own helpers in `hooks/lib/vitest-agent/`. Copilot fires a subset of the events and shows less of their output; see `CLAUDE.md` for the per-host differences.

| Script | Trigger | Behavior |
| --- | --- | --- |
| `session/start.sh` | `SessionStart` | Writes the session row; injects project test status and MCP tool reference into context; calls `vitest-agent agent register-agent` and stores the canonical `VITEST_AGENT_*` ids in the plugin's session env |
| `session/end-record.sh` | `SessionEnd` | Records the session-end timestamp, closes the agent row and computes the wrap-up note. On interactive exit it detaches a background worker (`session/end-record-worker.sh`) so Claude Code's exit teardown cannot cancel recording; on `/clear` and resume it runs synchronously |
| `pre-tool-use/mcp.sh` | `PreToolUse` (MCP tools) | Auto-allows non-destructive MCP tools without per-call prompts |
| `pre-tool-use/tdd-restricted.sh` | `PreToolUse` (tdd-task subagent) | Reads `tool_input.action` on the consolidated `tdd_goal` and `tdd_behavior` tools and denies the `delete` action inside the orchestrator |
| `pre-tool-use/bash-tdd.sh` | `PreToolUse` (Bash, tdd-task subagent) | Blocks `--update`, `--bail`, `--testNamePattern`; injects reminder to use `run_tests` MCP |
| `post-tool-use/tdd-artifact.sh` | `PostToolUse` (Write/Edit/run_tests, tdd-task) | Records `test_written`, `test_failed_run`, `test_passed_run`, `code_written` artifacts |
| `post-tool-use/test-quality.sh` | `PostToolUse` (Write/Edit, tdd-task) | Detects test-weakening edits; records `test_weakened` artifact |
| `subagent/start-tdd.sh` | `SubagentStart` | Creates a subagent session row for the dispatched tdd-task |
| `subagent/stop-tdd.sh` | `SubagentStop` | Runs `vitest-agent wrapup --kind tdd_handoff` and records the handoff note |
| `post-tool-use/record.sh` | `PostToolUse` (all) | Records tool-call turns for session analytics |
| `user-prompt-submit/record.sh` | `UserPromptSubmit` | Records user prompt turns |

The auto-allow list for `pre-tool-use/mcp.sh` lives at `hooks/lib/vitest-agent/safe-mcp-ops.txt`. The consolidated `tdd_goal` and `tdd_behavior` tools are on the list, so non-`delete` actions auto-allow; the `delete` action is denied at the runtime hook layer (`pre-tool-use/tdd-restricted.sh` reads `tool_input.action`) for the TDD orchestrator, and falls through to the host's standard permission prompt for the main agent.

Hooks log through pluginfinity's log library to `${XDG_STATE_HOME:-~/.local/state}/pluginfinity/vitest-agent/error.log`, and to `debug.log` when `PLUGINFINITY_DEBUG=1` is set. Read them with `pnpm exec pluginfinity logs` (`--debug`, `--follow`).

### Agent

| Agent | Invocation | Description |
| --- | --- | --- |
| `tdd-task` | `vitest-agent:tdd-task` | TDD orchestrator. Drives red-green-refactor cycles with evidence-based phase transitions and mandatory MCP gates. Cannot write production code without a preceding failing test. |

### Skills

| Skill | Description |
| --- | --- |
| `tdd` | Main TDD workflow: session lifecycle, phase transitions, goal/behavior hierarchy, channel events |
| `debugging` | Systematic failure diagnosis using `test_history`, `test_errors`, `test` (action `for_file`) |
| `coverage-improvement` | Systematic coverage improvement using `file_coverage`, `test_trends` |
| `configuration` | `AgentPlugin` setup and option reference |
| `interpret-test-failure` | Parse failure output, classify failure kind |
| `derive-test-name-from-behavior` | Name a test from a behavior description |
| `derive-test-shape-from-name` | Choose `it`, `describe/it`, parametric etc. from test name |
| `verify-test-quality` | Check written test for escape hatches and weak assertions |
| `run-and-classify` | Run tests via MCP, classify result, record artifact |
| `record-hypothesis-before-fix` | Gate 2 — record hypothesis before any non-test file edit |
| `commit-cycle` | Commit at green and refactor phase exit |
| `revert-on-extended-red` | Revert if stuck in red for more than 5 turns or 3 failed runs |
| `decompose-goal-into-behaviors` | Break a goal into atomic red-green-refactor behaviors |
| `operating-vitest-agent` | Operating the vitest-agent MCP tools: run_tests scoping, coverage-in-subset, console-leaks signal |
| `test-discovery` | Test-file layout and naming conventions (loads when you read test files) |
| `setup` | User-invoked: add `AgentPlugin` to the current project's `vitest.config.ts` |
| `configure` | User-invoked: view the resolved `@vitest-agent/plugin` configuration (read-only) |

Invoke a skill directly as `/vitest-agent:<skill>` on either host: `/vitest-agent:tdd <goal>` launches a TDD session, `/vitest-agent:setup` wires the plugin into your Vitest config. (These were the `/tdd`, `/setup` and `/configure` commands before the pluginfinity migration.)

## Prerequisites

`@vitest-agent/plugin` must be installed as a project dependency so the plugin's loader can spawn the MCP server through your package manager:

```bash
npm install --save-dev @vitest-agent/plugin
# or
pnpm add -D @vitest-agent/plugin
```

`@vitest-agent/mcp` (the MCP bin) and `@vitest-agent/cli` (the CLI) are regular dependencies of the plugin, so a single install brings both on every package manager.

Additional setup:

- `AgentPlugin` added to `vitest.config.ts` (use `/vitest-agent:setup` to automate this)
- Tests run at least once to populate the database

## How it works

After each `vitest` run, `AgentReporter` writes structured data to a SQLite database under your XDG data directory (default `$XDG_DATA_HOME/vitest-agent/<workspaceName>/data.db`, falling back to `~/.local/share/vitest-agent/<workspaceName>/data.db`). The location is derived from your root `package.json` `name`, so two worktrees of the same repo share history; override it via `vitest-agent.config.toml` (`cacheDir` or `projectKey`) at the workspace root. The MCP server reads this database on demand — no background process required.

The `SessionStart` hook queries the CLI at session start and injects a markdown summary with available tools, test status and an imperative preamble that directs the agent to use MCP tools and the TDD orchestrator.

## Development

The source is host-neutral; `builds/` is generated and committed. From the repository root:

```bash
# Rebuild both hosts after a source change, and check nothing is stale
pnpm --filter @vitest-agent/ai-plugins build:dev
pnpm --filter @vitest-agent/ai-plugins build:check

# Run the bats suites against both builds
pnpm test:bats

# Dogfood with the local build loaded
pnpm claude      # claude --plugin-dir plugin/builds/claude
pnpm copilot     # copilot --plugin-dir plugin/builds/copilot

# Watch the hook logs live
PLUGINFINITY_DEBUG=1 pnpm claude
pnpm exec pluginfinity logs --debug --follow
```

See `__test__/fixtures/README.md` for the fixture inventory.

## Repository

- GitHub: <https://github.com/spencerbeggs/vitest-agent>
- Issues: <https://github.com/spencerbeggs/vitest-agent/issues>
- License: MIT
