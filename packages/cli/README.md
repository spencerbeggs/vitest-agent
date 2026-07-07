# @vitest-agent/cli

[![npm](https://img.shields.io/npm/v/@vitest-agent/cli?label=npm&color=cb3837)](https://www.npmjs.com/package/@vitest-agent/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)

> **Part of the [vitest-agent](https://vitest-agent.dev) ecosystem.** Most users want **[@vitest-agent/plugin](https://www.npmjs.com/package/@vitest-agent/plugin)**, which pulls this package in automatically. Install `@vitest-agent/cli` directly only if you want the `vitest-agent` CLI on its own.

The `vitest-agent` CLI bin. Manages the local SQLite database, runs health diagnostics, and provides the hook-plumbing subcommands used by the Claude Code plugin's session and Bash hooks. Reads cached test data from SQLite — never runs tests or calls AI providers.

## Features

- **`doctor`** — five-point health diagnostic covering manifest assembly, latest-run integrity and staleness
- **`db`** — `path`, `prune`, `reset` and `query` subcommands for database lifecycle management
- **`agent`** namespace — `triage`, `wrapup`, `record`, `register-agent`, `end-agent`, `inject-env` and `sidecar-path` for hook-driven plumbing

## Install

```bash
npm install --save-dev @vitest-agent/cli
# or
pnpm add -D @vitest-agent/cli
```

`@vitest-agent/cli` is a regular dependency of `@vitest-agent/plugin` and installs with it automatically.

## Quick start

```bash
npx vitest-agent doctor
# example output (varies by environment)

npx vitest-agent db path
# prints the XDG-derived path to data.db

npx vitest-agent db query "SELECT count(*) FROM test_cases"
# example output (varies by environment)
```

## Documentation

CLI reference at [vitest-agent.dev/cli](https://vitest-agent.dev/cli).

## License

[MIT](LICENSE)
