# vitest-agent-sidecar

Fast-path native binary for [vitest-agent-plugin](https://github.com/spencerbeggs/vitest-agent).

Every Bash tool call from a Claude Code agent fires the plugin's `pre-tool-use/bash.sh` hook, which detects Vitest invocations and prepends the canonical `VITEST_AGENT_*` env prefix. Doing that work through the full `vitest-agent` CLI pays ~505 ms of Node cold-start latency per call. This package ships a Node Single Executable Application (SEA) binary that runs the same logic with a fraction of the startup cost.

The binary is generated from the same TypeScript that the `vitest-agent-cli` `agent` namespace ships, so the JS fallback and the native binary stay byte-identical.

## Install

```bash
npm install --save-dev vitest-agent-plugin
# vitest-agent-sidecar auto-installed via peerDependency
```

The platform-specific binary arrives through an `optionalDependencies` sub-package (`vitest-agent-sidecar-<platform>`), mirroring the esbuild / sharp distribution model. Supported platforms:

- `darwin-arm64`
- `linux-arm64`, `linux-x64`
- `win32-x64`

When the plugin's SessionStart hook runs, it calls `vitest-agent agent sidecar-path` once to resolve the binary's absolute path via `require.resolve` and exports the result as `VITEST_AGENT_SIDECAR_BIN` for the duration of the session. The PreToolUse Bash hook reads that env var and execs the binary directly — no PATH lookup, no Node cold-start. On unsupported platforms the optional sub-package does not install, `resolveSidecarBinaryPath()` returns `null`, the env var is not set, and the hook falls back to the `vitest-agent` JS CLI.

## Subcommands

```bash
vitest-agent-sidecar inject-env --command "<cmd>" --cwd "<dir>"
```

The binary handles `inject-env` only — the per-Bash-call hot path, which is pure and fully self-contained. `register-agent` stays on the `vitest-agent` JS CLI: it touches a native SQLite binding that cannot be bundled into a JS SEA, and it fires only once per session, off the per-turn critical path. Moving `register-agent` into the binary is a tracked 2.x follow-up.

## License

[MIT](./LICENSE)
