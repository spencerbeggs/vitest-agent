# vitest-agent-cli

Utility CLI bin for [vitest-agent-plugin](https://github.com/spencerbeggs/vitest-agent). Manages the local SQLite database, runs health diagnostics and provides the hook-plumbing subcommands used by the Claude Code plugin's Bash and session hooks.

This package is a required peer dependency of `vitest-agent-plugin`, so you usually don't install it directly — modern pnpm and npm pull it in automatically when you install the plugin.

## Install

```bash
npm install --save-dev vitest-agent-plugin
# vitest-agent-cli auto-installed via peerDependency
```

If your package manager skips peers, install it explicitly:

```bash
pnpm add -D vitest-agent-cli
```

## Usage

### Diagnostics

```bash
npx vitest-agent doctor
# 5-point health diagnostic: manifest, latest-run integrity, staleness
```

### Database management

```bash
npx vitest-agent db path
# Print the deterministic XDG path of the database file

npx vitest-agent db prune --keep-recent 30
# Drop old sessions' turn history (default: keep 30 most recent)

npx vitest-agent db reset
# Wipe the database (human-only; blocked when VITEST_AGENT_AGENT_ID is set)

npx vitest-agent db query "<sql>"
# Run a read-only SQL query; emits a table or --format json
```

### Agent and hook subcommands

These subcommands are called by hook scripts and the Claude Code plugin. Humans rarely invoke them directly.

```bash
npx vitest-agent agent sidecar-path
# Print the absolute path of the installed platform SEA binary,
# or exit non-zero when no platform binary is resolvable

npx vitest-agent agent inject-env --command "<cmd>" --cwd "<dir>"
# Prepend VITEST_AGENT_* env vars when the command is a Vitest invocation

npx vitest-agent agent register-agent
# Register a new agent session; emits JSON with agentId, conversationId, etc.

npx vitest-agent agent end-agent
# Mark an agent session as ended

npx vitest-agent agent triage
# Report suggested actions based on the latest run

npx vitest-agent agent wrapup
# Summarize the test landscape at session end

npx vitest-agent agent record test-case-turns --chat-id <id>
# Link test cases to session turns; emits {"updated": N, "latestTestCaseId": <id|null>}
```

`doctor` and `db query` accept `--format markdown` (default) or `--format json`. `agent triage` and `agent wrapup` accept `--format markdown|json|silent`.

## Documentation

See the [main README](https://github.com/spencerbeggs/vitest-agent#readme) and the [CLI reference](https://github.com/spencerbeggs/vitest-agent/blob/main/docs/cli.md).

## License

[MIT](LICENSE)
