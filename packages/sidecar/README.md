# vitest-agent-sidecar

Fast-path native binary for
[vitest-agent-plugin](https://github.com/spencerbeggs/vitest-agent).

Every Bash tool call from a Claude Code agent fires the plugin's
`pre-tool-use/bash.sh` hook, which detects Vitest invocations and
prepends the canonical `VITEST_AGENT_*` env prefix. Doing that work
through the full `vitest-agent` CLI pays ~505 ms of Node cold-start
latency per call. This package ships a Node Single Executable
Application (SEA) binary that runs the same logic with a fraction of
the startup cost.

The binary is generated from the same TypeScript that the
`vitest-agent-cli` `agent` namespace ships, so the JS fallback and the
native binary stay byte-identical.

## Install

```bash
npm install --save-dev vitest-agent-plugin
# vitest-agent-sidecar auto-installed via peerDependency
```

The platform-specific binary arrives through an `optionalDependencies`
sub-package (`vitest-agent-sidecar-<platform>`), mirroring the
esbuild / sharp distribution model. Supported platforms:

- `darwin-arm64`, `darwin-x64`
- `linux-arm64`, `linux-x64`
- `win32-x64`

On any other platform the launcher exits non-zero and the bash hook
falls back to the `vitest-agent` JS CLI.

## Subcommands

```bash
vitest-agent-sidecar inject-env --command "<cmd>" --cwd "<dir>"
vitest-agent-sidecar register-agent --host-kind <k> --agent-type <t> \
  --host-session-id <id> --transcript-path <path> --cwd <dir>
```

## License

[MIT](./LICENSE)
