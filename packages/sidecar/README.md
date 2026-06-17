# @vitest-agent/sidecar

[![npm](https://img.shields.io/npm/v/@vitest-agent/sidecar?label=npm&color=cb3837)](https://www.npmjs.com/package/@vitest-agent/sidecar)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)

> **Part of the [vitest-agent](https://vitest-agent.dev) ecosystem.** Most users want **[@vitest-agent/plugin](https://www.npmjs.com/package/@vitest-agent/plugin)**, which pulls this package in automatically (it installs automatically with the CLI; you rarely add it directly).

A Node Single Executable Application (SEA) binary for the per-Bash-call `inject-env` hot path. Every Bash tool call from a Claude Code agent fires the plugin's `pre-tool-use/bash.sh` hook, which detects Vitest invocations and prepends the canonical `VITEST_AGENT_*` env prefix. Running that through the full `vitest-agent` CLI pays Node cold-start latency on every call; this binary runs the same logic with a fraction of the startup cost.

## Features

- **Native binary** — Node SEA wrapping the same `inject-env` TypeScript that ships in `@vitest-agent/cli`; JS fallback and binary stay byte-identical
- **Per-platform sub-packages** — `@vitest-agent/sidecar-darwin-arm64`, `@vitest-agent/sidecar-linux-arm64`, `@vitest-agent/sidecar-linux-x64`, `@vitest-agent/sidecar-win32-x64` as `optionalDependencies`; only the matching one installs
- **`resolveSidecarBinaryPath()`** — exported function that returns the absolute path of the installed binary, or `null` on unsupported platforms

## Install

```bash
npm install --save-dev @vitest-agent/plugin
# @vitest-agent/sidecar arrives transitively through @vitest-agent/cli
```

The plugin's SessionStart hook resolves the binary path once per session via `vitest-agent agent sidecar-path` and exports `VITEST_AGENT_SIDECAR_BIN`. The PreToolUse Bash hook reads that env var and execs the binary directly — no PATH lookup, no Node startup. On unsupported platforms the hook falls back to the `vitest-agent` JS CLI automatically.

## Documentation

Package reference at [vitest-agent.dev/sidecar](https://vitest-agent.dev/sidecar).

## License

[MIT](LICENSE)
