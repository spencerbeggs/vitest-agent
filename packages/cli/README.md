# vitest-agent-cli

CLI bin for
[vitest-agent-plugin](https://github.com/spencerbeggs/vitest-agent).
Reads the SQLite database written by `AgentReporter` and reports test
status, overview, coverage, history, trends, and cache health on
demand.

This package is a required peer dependency of `vitest-agent-plugin`,
so you usually don't install it directly — modern pnpm and npm pull it
in automatically when you install the plugin.

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

All commands accept `--format markdown` (default) or `--format json`.

```bash
npx vitest-agent status      # Per-project pass/fail state
npx vitest-agent overview    # Test landscape summary
npx vitest-agent coverage    # Coverage gap analysis
npx vitest-agent history     # Flaky/persistent failure trends
npx vitest-agent trends      # Coverage trajectory over time
npx vitest-agent doctor      # Database health diagnostic
npx vitest-agent cache path  # Print the database file path
npx vitest-agent cache clean # Delete the database
npx vitest-agent show --project <name> --format auto
# Replay the latest cached run through the shape-tailored dispatcher
# in vitest-agent-ui. --format also accepts `agent`, `human`, or
# `json`; `auto` picks `human` for TTYs and `agent` otherwise.
# Multi-project workspaces render as a single workspace-aggregate
# frame, not one frame per project.
npx vitest-agent record test-case-turns --chat-id <id>
# Hook-driven command: links test cases to session turns and outputs
# {"updated": N, "latestTestCaseId": <id|null>}
```

## Documentation

See the
[main README](https://github.com/spencerbeggs/vitest-agent#readme)
and the
[CLI reference](https://github.com/spencerbeggs/vitest-agent/blob/main/docs/cli.md).

## License

[MIT](./LICENSE)
