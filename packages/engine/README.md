# @vitest-agent/engine

[![npm](https://img.shields.io/npm/v/@vitest-agent/engine?label=npm&color=cb3837)](https://www.npmjs.com/package/@vitest-agent/engine)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)

> **Part of the [vitest-agent](https://vitest-agent.dev) ecosystem.** Most users want **[@vitest-agent/plugin](https://www.npmjs.com/package/@vitest-agent/plugin)**, which pulls this package in automatically. Install `@vitest-agent/engine` directly only if you build tooling on the shared services or data layer.

The platform-dependent half of the vitest-agent ecosystem's former `@vitest-agent/sdk`. Carries the Effect services, live layers, the SQLite data layer, migrations, and platform resolution consumed by the CLI and MCP server.

## Features

- **Effect services and layers** — Context.Service definitions with live implementations for the data layer, path resolution, and platform detection
- **SQLite data layer** — `DataStore` and `DataReader` Effect services, migrations, and the process-level migration coordinator
- **Platform resolution** — XDG path resolution and workspace identity for the CLI and MCP server
- **Test utilities** — helpers on the `@vitest-agent/engine/testing` sub-path

## Install

```bash
npm install @vitest-agent/engine
# or
pnpm add @vitest-agent/engine
```

## Documentation

Package reference at [vitest-agent.dev/engine](https://vitest-agent.dev/engine).

## License

[MIT](LICENSE)
