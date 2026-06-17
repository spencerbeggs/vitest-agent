# @vitest-agent/sdk

[![npm](https://img.shields.io/npm/v/@vitest-agent/sdk?label=npm&color=cb3837)](https://www.npmjs.com/package/@vitest-agent/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)

> **Part of the [vitest-agent](https://vitest-agent.dev) ecosystem.** Most users want **[@vitest-agent/plugin](https://www.npmjs.com/package/@vitest-agent/plugin)**, which pulls this package in automatically. Install `@vitest-agent/sdk` directly only if you build tooling on the shared schemas or data layer.

The no-internal-deps base for the vitest-agent ecosystem. Carries the Effect Schemas, SQLite migrations and data layer, services and live layers, formatters, XDG path resolution, the public reporter and dispatcher contract types, and testing utilities.

## Features

- **Effect Schemas** — all domain types (`RunEvent`, `RenderState`, `CoverageTargets`, `TurnPayload`, identity types) defined with Effect Schema; runtime validation and TypeScript types from one source
- **SQLite data layer** — `DataStore` and `DataReader` Effect services with live and `:memory:` test layers; `ensureMigrated` for safe multi-project setups
- **XDG path resolution** — deterministic `dbPath` derivation from workspace identity with a five-source fallback chain
- **Reporter and dispatcher contracts** — `VitestAgentReporterFactory`, `ReporterKit`, `ResolvedReporterConfig`, `DispatchInputs` and the types consumed by every other package
- **Sidecar dispatch core** — `dispatch`, `injectEnv` and `exitCodeForTag` on the `@vitest-agent/sdk/dispatch` sub-path for a minimal SEA bundle
- **Test utilities** — `makeTestLayer`, `DataStoreTestLayer` and five preset factory functions on the `@vitest-agent/sdk/testing` sub-path

## Install

```bash
npm install @vitest-agent/sdk
# or
pnpm add @vitest-agent/sdk
```

## Quick start

```ts
import { Effect } from "effect";
import { DataReader } from "@vitest-agent/sdk";
import { singlePassingRun } from "@vitest-agent/sdk/testing";

const layer = singlePassingRun(":memory:");

await Effect.runPromise(
  Effect.provide(
    Effect.flatMap(DataReader, (r) => r.getLatestRun("default", null)),
    layer,
  ),
);
// returns the seeded run row
```

## Documentation

Package reference at [vitest-agent.dev/sdk](https://vitest-agent.dev/sdk).

## License

[MIT](LICENSE)
