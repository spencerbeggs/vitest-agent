# vitest-agent

Monorepo for developing the `vitest-agent` package family — a Vitest reporter and agent platform for LLM coding agents. Produces structured test output, persists data in SQLite at an XDG-derived path, and exposes test intelligence via CLI, MCP server, and Claude Code plugin.

## Workspaces

| Workspace | Path | Description |
| --- | --- | --- |
| `vitest-agent-plugin` | [packages/plugin](./packages/plugin/) | Vitest plugin + lifecycle (`AgentPlugin`, `AgentReporter`, `CoverageAnalyzer`) |
| `vitest-agent-reporter` | [packages/reporter](./packages/reporter/) | Named renderer factory implementations |
| `vitest-agent-ui` | [packages/ui](./packages/ui/) | Shared event-sourced renderer: the shape-tailored dispatcher matrix, the preassembled default reporter, React Ink components, `RunEvent` PubSub channel |
| `vitest-agent-sdk` | [packages/sdk](./packages/sdk/) | Shared schemas, data layer, services, formatters, utilities |
| `vitest-agent-cli` | [packages/cli](./packages/cli/) | `vitest-agent` CLI bin |
| `vitest-agent-mcp` | [packages/mcp](./packages/mcp) | `vitest-agent-mcp` MCP server bin |
| `playground` | [playground](./playground/) | Dogfooding sandbox — intentionally imperfect code for agent demos |

`vitest-agent-sdk` has no internal dependencies. The other five runtime packages each depend on it. `vitest-agent-plugin` declares `vitest-agent-reporter`, `vitest-agent-ui`, the CLI, and MCP packages as required peer dependencies, so a single `npm install vitest-agent-plugin` pulls them all on modern pnpm and npm.

## Plugin

| Component | Path | Description |
| --- | --- | --- |
| Claude Code plugin | `plugin/` | Hooks, skills, commands, MCP auto-registration |

The plugin is not a pnpm workspace — it's a directory of markdown, JSON, shell, and a zero-deps Node loader (`bin/mcp-server.mjs`) consumed by the Claude Code plugin system. See [plugin/README.md](plugin/README.md).

## Architecture

The package family has three entry points:

| Entry | Bin | Package | Purpose |
| --- | --- | --- | --- |
| Plugin | (library import) | `vitest-agent-plugin` | Vitest plugin producing SQLite-persisted test data |
| CLI | `vitest-agent` | `vitest-agent-cli` | Query test status, coverage, history, trends from the terminal |
| MCP Server | `vitest-agent-mcp` | `vitest-agent-mcp` | 29 action-keyed tools over stdio for LLM agent integration, plus MCP resources and prompts |

All three share the Effect service architecture and the same SQLite database in `vitest-agent-sdk` (`DataReader`, `DataStore`, `OutputRenderer`, output pipeline, formatters, etc.). The database location is derived from your root workspace's `package.json` `name` under `$XDG_DATA_HOME/vitest-agent/`.

## Development

```bash
pnpm install
pnpm run build
pnpm run test
pnpm run lint
pnpm run typecheck
```

## Testing the CLI locally

Run tests to populate the database:

```bash
pnpm run test
```

Query cached data via the CLI bin:

```bash
pnpm exec vitest-agent status
pnpm exec vitest-agent history
pnpm exec vitest-agent trends
pnpm exec vitest-agent doctor
pnpm exec vitest-agent show --project <name> --format auto
```

`vitest-agent show` replays the latest cached run through the shape-tailored dispatcher in `vitest-agent-ui`, picking the React Ink view for an interactive TTY (`--format auto`) and the markdown-flavored agent string otherwise. Pass `--format agent`, `--format human`, or `--format json` to force a specific output. Multi-project workspaces render as a single workspace-aggregate frame, not one frame per project.

## Testing the Claude Code plugin locally

Install dependencies (this also builds the packages so the plugin's MCP loader can resolve them):

```bash
pnpm install
```

Start Claude Code with the local plugin directory:

```bash
claude --debug --plugin-dir ./plugin
```

While in an active session, you can rebuild all packages without restarting:

```bash
pnpm run build
```

Changes to the compiled packages take effect immediately on the next tool call — no restart needed. The same applies to inline edits to hook shell scripts; they are re-sourced on every invocation.

A restart is only required when changing hook **registration** (adding, removing, or renaming hooks in `plugin/hooks/hooks.json` or `plugin/.claude-plugin/plugin.json`), since Claude Code reads those at startup. When in doubt, reboot.

### Sample agent prompts

Once the plugin is active, these prompts exercise the MCP tools, the CLI integration, and the TDD orchestrator. Run `pnpm run test` first so the database has data to query.

#### Query test status and coverage

```text
What's the current test status for this project? Summarize pass rates, any
failing tests, and which files are below the coverage targets.
```

```text
Show me the coverage trend for the playground package over the last few runs.
Are things improving or regressing?
```

```text
Have any tests been flaky or persistently failing recently? Pull the failure
history and highlight anything that's shown up more than once.
```

#### Run specific tests

```text
Run the playground test suite and give me a breakdown of what's covered
and what the gaps are.
```

```text
Run only playground/src/notebook.test.ts and tell me if all tests pass.
```

```text
Run the full test suite, then show me the coverage table for the playground
package specifically.
```

#### TDD orchestrator — fix a real problem

```text
The playground/src/notebook.ts module has at least one method that throws a
hard runtime error when called with bad input. Use TDD to find it: write a
failing test that reproduces the crash, then fix the code so the test passes
without breaking any existing tests.
```

```text
Use the TDD orchestrator to improve coverage in the playground package.
Start with the functions that have zero coverage, write failing tests first,
then implement fixes one at a time until the aspirational targets are met.
```

### Claude Channels Support

The Claude Code plugin has experimental support for [mcp push events](https://code.claude.com/docs/en/channels). If you want to try this locally add a `.mcp.json` to the project root:

```json
{
 "mcpServers": {
  "plugin:vitest-agent:mcp": {
   "command": "pnpm",
   "args": ["exec", "vitest-agent-mcp"]
  }
 }
}
```

Then you can will run Claude with the `--dangerously-load-development-channels` flag and authorize the channel.

```bash
claude --debug --plugin-dir ./plugin --dangerously-load-development-channels server:plugin:vitest-agent:mcp
```

The plugin works the same without this flag, but has better observability between the main and agent and the tdd orchestrator. NOTE: The config in the root `.mcp.json` file takes precedence over the plugin when you have both enabled.

## Package documentation

See [packages/reporter/README.md](packages/reporter/README.md) for the main user-facing documentation, including installation, configuration, MCP tools, and Claude Code plugin setup. See [packages/plugin/README.md](packages/plugin/README.md) for `AgentPlugin.discover()`, coverage level presets, and `AgentPlugin.runScript()` reference.

## License

[MIT](LICENSE)
